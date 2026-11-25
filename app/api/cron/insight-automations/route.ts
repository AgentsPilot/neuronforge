/**
 * Insight Automations Cron Job
 *
 * This endpoint is called by Vercel Cron to run due automations.
 * It runs every 5 minutes to:
 * 1. Find automations that are due for checking
 * 2. Run detectors to see if conditions are met
 * 3. Trigger kernel processes for matching automations
 *
 * Vercel Cron config (add to vercel.json):
 * crons: [{ "path": "/api/cron/insight-automations", "schedule": "every 5 min" }]
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { supabaseServer } from '@/lib/supabaseServer';
import { AutomationManager } from '@/lib/business-os/insight/automation';

const logger = createLogger({ module: 'InsightAutomationsCron' });

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5).

interface AutomationStats {
  automationsChecked: number;
  automationsExecuted: number;
  automationsSkipped: number;
  automationsFailed: number;
  totalItemsProcessed: number;
  totalValueImpact: number;
}

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify authorization
  if (!isAuthorizedCronRequest(request, logger)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  try {
    requestLogger.info('Starting insight automations cron job');

    const stats: AutomationStats = {
      automationsChecked: 0,
      automationsExecuted: 0,
      automationsSkipped: 0,
      automationsFailed: 0,
      totalItemsProcessed: 0,
      totalValueImpact: 0,
    };

    const manager = new AutomationManager(supabaseServer);

    // Get and run due automations
    const results = await manager.runDueAutomations();

    // Aggregate stats
    for (const result of results) {
      stats.automationsChecked++;

      switch (result.status) {
        case 'executed':
          stats.automationsExecuted++;
          stats.totalItemsProcessed += result.itemsProcessed || 0;
          stats.totalValueImpact += result.valueImpact || 0;
          break;
        case 'skipped':
          stats.automationsSkipped++;
          break;
        case 'failed':
          stats.automationsFailed++;
          break;
      }
    }

    const duration = Date.now() - startTime;

    requestLogger.info(
      {
        duration,
        stats,
      },
      'Insight automations cron job completed'
    );

    return NextResponse.json({
      success: true,
      data: {
        duration,
        ...stats,
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Insight automations cron job failed');

    return NextResponse.json(
      {
        success: false,
        error: 'Cron job failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('insight-automations', runJob);

// Also support POST for manual triggering in development
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { success: false, error: 'POST only allowed in development' },
      { status: 405 }
    );
  }

  return GET(request);
}
