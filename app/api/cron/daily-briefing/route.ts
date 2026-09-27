/**
 * Morning Briefing Cron
 *
 * Runs hourly, not daily. One schedule cannot be 7am in every timezone, so each
 * run asks every opted-in business what time it is where they are and queues
 * the ones inside their morning window. UNIQUE(user_id, briefing_date) in the
 * ledger is what keeps that to one email per business per day.
 *
 * Vercel Cron config (vercel.json):
 * {
 *   "path": "/api/cron/daily-briefing",
 *   "schedule": "10 * * * *"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { processDueBriefings } from '@/lib/services/DailyBriefingDispatchService';

// The ledger's lease (90s) is set > maxDuration so an overrun function is
// provably dead and its row can be reclaimed safely.
export const runtime = 'nodejs';
export const maxDuration = 60;

const logger = createLogger({ module: 'DailyBriefingCron' });

/**
 * Fails CLOSED.
 *
 * This is a public URL and the bearer secret is the only thing separating a
 * Vercel invocation from an arbitrary caller. A missing CRON_SECRET in
 * production means the request cannot be authenticated, so it is refused —
 * deliberately unlike /api/cron/insight-metrics, which returns true in that
 * case and leaves itself open.
 */
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await processDueBriefings();

    requestLogger.info({ ...summary }, 'Morning briefing run complete');

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    requestLogger.error({ err: error }, 'Morning briefing run failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('daily-briefing', runJob);
