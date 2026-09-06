/**
 * GET /api/cron/channel-metrics-sync
 * Nightly pull of Facebook Page, Instagram, Google Business Profile and GA4 stats.
 *
 * Deliberately separate from /api/cron/insight-detect, which runs every 15
 * minutes across all users. Calling Meta 96 times a day per user is the fastest
 * route to a rate limit, and these platforms only update daily. insight-detect
 * still sees fresh numbers within 15 minutes of this job finishing.
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/channel-metrics-sync",
 *     "schedule": "30 4 * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { channelMetricsSyncService } from '@/lib/business-os/channel-insights/ChannelMetricsSyncService';

const logger = createLogger({ module: 'ChannelMetricsSyncCron' });

const CRON_SECRET = process.env.CRON_SECRET;

/** Bounded so one invocation cannot exceed the serverless execution limit. */
const MAX_CONNECTIONS_PER_RUN = 25;

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const authHeader = request.headers.get('authorization');
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      if (process.env.NODE_ENV === 'production') {
        requestLogger.warn('Unauthorized cron request');
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Runs hourly, but a healthy connection is only due after 20 hours — so
    // most runs do nothing. The frequency exists for the second number: a
    // connection carrying an error is retried after 3 hours instead of waiting
    // out a full day with no data.
    const results = await channelMetricsSyncService.syncDue(20, MAX_CONNECTIONS_PER_RUN, 3);
    const failed = results.filter(r => r.error);

    // Say plainly when the run hit its ceiling — otherwise a growing backlog
    // looks identical to a healthy run in the logs.
    const hitLimit = results.length === MAX_CONNECTIONS_PER_RUN;
    if (hitLimit) {
      requestLogger.warn(
        { processed: results.length },
        'Channel sync hit its per-run limit; remaining connections wait for the next run'
      );
    }

    requestLogger.info(
      {
        processed: results.length,
        failed: failed.length,
        daysWritten: results.reduce((sum, r) => sum + r.daysWritten, 0),
      },
      'Channel metrics cron complete'
    );

    return NextResponse.json({
      success: true,
      processed: results.length,
      failed: failed.length,
      hitLimit,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Channel metrics cron failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
