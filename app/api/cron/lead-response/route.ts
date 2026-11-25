/**
 * Drain the queue of replies owed to people who got in touch.
 *
 * Every five minutes, because the two things this carries are a fifteen-minute
 * delay and a two-day chase — the first of which would be meaningless on an
 * hourly cadence.
 *
 * The happy path does not wait for this: the alert path kicks the dispatcher in
 * the same request. This is what makes the promise survive a lambda that dies
 * holding it, and both paths go through the same claim RPC so they can never
 * both send.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { dispatchLeadResponses } from '@/lib/services/LeadResponseDispatchService';

const logger = createLogger({ module: 'LeadResponseCron' });

export const runtime = 'nodejs';
export const maxDuration = 60;

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5).

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!isAuthorizedCronRequest(request, logger)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await dispatchLeadResponses();

    // Logged at info even when nothing happened: a queue that silently stops
    // draining looks identical to a queue with nothing in it.
    requestLogger.info(result, 'Lead responses drained');
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Lead response drain failed');
    return NextResponse.json(
      { success: false, error: 'Lead response drain failed' },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('lead-response', runJob);
