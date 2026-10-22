/**
 * Close the booking attempts nobody finished, and offer them a way back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A client who gives their details and is sent to pay gets an
 * `abandoned_bookings` row at `started`, and no booking — that is the whole
 * design: a booking written before the money holds a slot for somebody who may
 * never pay.
 *
 * `convertAttempt` closes the row when they finish. Nothing closed the ones who
 * did not. `sweepAbandoned()` has existed since the table was added and had no
 * caller anywhere, so every unfinished attempt sat at `started` for ever, the
 * partial index over `status = 'abandoned'` could never match a row, and
 * comments in `finalize` and the booking widget referred to "the sweeper" that
 * was never run.
 *
 * So this is the state machine's missing third edge, and the recovery email is
 * the only thing that ever reads the state it writes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDER MATTERS, AND IT IS SWEEP THEN SEND
 *
 * The sender reads `status = 'abandoned' AND recovery_email_sent_at IS NULL`.
 * Sweeping first means an attempt that went cold in the last few minutes is
 * recovered on this run rather than the next, which on a 30-minute window is
 * the difference between a useful email and a late one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { sweepAbandoned } from '@/lib/scheduling/abandonedBookings';
import { sendAbandonedRecoveries } from '@/lib/scheduling/abandonedRecovery';

const logger = createLogger({ module: 'AbandonedBookingsCron' });

export const maxDuration = 60;

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED, like every other cron here: this is a public URL and the
  // bearer secret is the only thing separating Vercel from anyone.
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
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const swept = await sweepAbandoned();

    /*
     * Separately caught. A failure to send must not undo the sweep: the rows
     * are correctly marked and the next run picks up the sending, whereas
     * reporting the whole job failed would hide that the state machine moved.
     */
    let recovered = 0;
    try {
      recovered = await sendAbandonedRecoveries(requestLogger);
    } catch (sendError) {
      requestLogger.error({ err: sendError }, 'Swept the attempts but could not send the recovery mail');
    }

    requestLogger.info(
      { swept, recovered, durationMs: Date.now() - startedAt },
      'Abandoned bookings run'
    );

    return NextResponse.json({ success: true, swept, recovered });
  } catch (error) {
    requestLogger.error({ err: error }, 'Abandoned bookings run failed');
    return NextResponse.json(
      { success: false, error: 'Abandoned bookings run failed' },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('abandoned-bookings', runJob);
