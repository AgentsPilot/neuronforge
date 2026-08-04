/**
 * Insight Metrics Computation Cron Job
 *
 * This endpoint is called by Vercel Cron to compute derived metrics for all users.
 * It runs daily at 3 AM UTC to:
 * 1. Compute daily metrics for the previous day
 * 2. Compute weekly metrics (on Mondays)
 * 3. Compute monthly metrics (on 1st of month)
 *
 * Vercel Cron config (add to vercel.json):
 * {
 *   "crons": [{
 *     "path": "/api/cron/insight-metrics",
 *     "schedule": "0 3 * * *"
 *   }]
 * }
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { MetricsComputeService } from '@/lib/business-os/insight/metrics';

const logger = createLogger({ module: 'InsightMetricsCron' });

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

interface ComputeStats {
  usersProcessed: number;
  metricsComputed: number;
  errors: number;
  periodTypes: string[];
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
    requestLogger.info('Starting insight metrics cron job');

    const stats: ComputeStats = {
      usersProcessed: 0,
      metricsComputed: 0,
      errors: 0,
      periodTypes: [],
    };

    // Determine which period types to compute based on date
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday
    const dayOfMonth = today.getDate();

    const periodTypesToCompute: Array<'daily' | 'weekly' | 'monthly'> = ['daily'];

    // Compute weekly metrics on Monday
    if (dayOfWeek === 1) {
      periodTypesToCompute.push('weekly');
    }

    // Compute monthly metrics on 1st of month
    if (dayOfMonth === 1) {
      periodTypesToCompute.push('monthly');
    }

    stats.periodTypes = periodTypesToCompute;

    // Get all users with business_events (active users)
    const { data: activeUsers, error: usersError } = await supabaseServer
      .from('business_events')
      .select('user_id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
      .limit(1000);

    if (usersError) {
      throw usersError;
    }

    // Get unique user IDs
    const userIds = [...new Set(activeUsers?.map((u) => u.user_id) || [])];

    requestLogger.info(
      { userCount: userIds.length, periodTypes: periodTypesToCompute },
      'Processing users for metrics'
    );

    // Process each user
    const metricsService = new MetricsComputeService(supabaseServer);

    for (const userId of userIds) {
      try {
        for (const periodType of periodTypesToCompute) {
          // Get period boundaries for yesterday (we compute metrics for completed periods)
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);

          const { start, end } = MetricsComputeService.getPeriodBoundaries(yesterday, periodType);

          const result = await metricsService.computeAllMetrics(userId, periodType, start, end);

          if (result.data) {
            stats.metricsComputed += result.data.length;
          }
        }

        stats.usersProcessed++;
      } catch (error) {
        requestLogger.error(
          { err: error, userId },
          'Failed to compute metrics for user'
        );
        stats.errors++;
      }
    }

    const duration = Date.now() - startTime;

    requestLogger.info(
      {
        duration,
        stats,
      },
      'Insight metrics cron job completed'
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
    requestLogger.error({ err: error, duration }, 'Insight metrics cron job failed');

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
