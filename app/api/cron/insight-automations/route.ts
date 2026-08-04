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
import { supabaseServer } from '@/lib/supabaseServer';
import { AutomationManager } from '@/lib/business-os/insight/automation';

const logger = createLogger({ module: 'InsightAutomationsCron' });

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without secret
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // If no secret configured, allow (but log warning)
  if (!cronSecret) {
    logger.warn('CRON_SECRET not configured - cron endpoint is unprotected');
    return true;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

interface AutomationStats {
  automationsChecked: number;
  automationsExecuted: number;
  automationsSkipped: number;
  automationsFailed: number;
  totalItemsProcessed: number;
  totalValueImpact: number;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Verify authorization
  if (!verifyCronSecret(request)) {
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
