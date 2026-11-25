/**
 * Drain the queue of actions an insight automation asked for.
 *
 * Every fifteen minutes. Detection itself runs once a day at 03:30, so nothing
 * here is urgent — but a row that failed and backed off should not wait until
 * tomorrow for its retry, and an owner who turns an automation on wants to see
 * it do something the same morning.
 *
 * This route only drains. What gets queued is decided by AutomationManager,
 * which runs on /api/cron/insight-automations, and whether a queued row is
 * still worth sending is decided by the dispatcher at the moment of sending.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { drainInsightActions } from '@/lib/services/InsightActionDispatchService';

const logger = createLogger({ module: 'InsightActionsCron' });

export const runtime = 'nodejs';
/** Must stay BELOW the dispatcher's 90-second lease, or a live row is reclaimed. */
export const maxDuration = 60;

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5).

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!isAuthorizedCronRequest(request, logger)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainInsightActions();

    // Logged at info even when nothing happened: a queue that silently stops
    // draining looks identical to a queue with nothing in it.
    requestLogger.info(result, 'Insight action drain complete');

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Insight action drain failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Drain failed',
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
export const GET = withCronRunRecord('insight-actions', runJob);
