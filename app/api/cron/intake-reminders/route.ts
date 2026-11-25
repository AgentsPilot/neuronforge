/**
 * Intake reminder cron.
 *
 * One nudge, a day before the meeting, to a client who was sent an intake form
 * and has not filled it in. The rule and every exclusion live in
 * `IntakeReminderService`; this route is the clock and the door.
 *
 * HOURLY, and that is not a queue.
 *
 * Nothing is scheduled in advance: the question "who is unprepared for a
 * meeting tomorrow" is answered from the bookings themselves on each run, and
 * the reminder is stamped on the booking as it goes. So a run that is missed
 * costs nothing — the next one finds the same bookings still inside the window
 * — and a run that happens twice sends nothing twice.
 *
 * @module app/api/cron/intake-reminders
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';
import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
import { intakeReminderService } from '@/lib/services/IntakeReminderService';

const logger = createLogger({ module: 'IntakeRemindersCron' });

export const maxDuration = 60;

// Cron auth: lib/cron/cronAuth.ts, fail-closed (PROD-1b, A5).

async function runJob(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!isAuthorizedCronRequest(request, logger)) {
    requestLogger.warn('Unauthorized cron request');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await intakeReminderService.sendDue();

    requestLogger.info({ ...result, durationMs: Date.now() - startedAt }, 'Intake reminders run');

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Intake reminder run failed');
    return NextResponse.json(
      { success: false, error: 'Intake reminder run failed' },
      { status: 500 }
    );
  }
}

/**
 * Every proven Vercel cron run is recorded (admin reorganisation slice 5): the
 * job body, its auth check and its response are unchanged; recording never
 * fails the job. See lib/cron/cronRunRecorder.ts.
 */
export const GET = withCronRunRecord('intake-reminders', runJob);
