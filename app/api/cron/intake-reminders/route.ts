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
import { intakeReminderService } from '@/lib/services/IntakeReminderService';

const logger = createLogger({ module: 'IntakeRemindersCron' });

export const maxDuration = 60;

// Verify cron secret to ensure only Vercel can call this
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without a secret (local manual triggering).
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Fail CLOSED, for the same reason the payment drain does: this is a public
  // URL and the bearer secret is the only thing separating Vercel from anyone.
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
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
