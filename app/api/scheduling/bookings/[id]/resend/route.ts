/**
 * Send the same message again, whatever it was.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE `…/confirmation`
 *
 * The journey's "send again" always called the confirmation route, whatever
 * row it was attached to. On a booking whose last mail was a reschedule notice
 * or a cancellation, pressing it sent the CONFIRMATION — a cheerful "your
 * appointment is confirmed" one line under "you cancelled the meeting".
 *
 * That is why the link had to be hidden after an outcome was recorded: not
 * because resending was wrong, but because it would have sent the wrong thing.
 * The honest fix is to resend what is actually there, which became possible
 * when `email_sends.email_kind` started recording what each message was
 * (20261081).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RE-MAKES, IT DOES NOT RE-SEND
 *
 * Each kind is regenerated from the booking as it stands now, not replayed
 * from the stored body. A client who lost the email wants the CURRENT details
 * — the time it has now, the quote as it stands — and a replay of a superseded
 * message would be worse than nothing.
 *
 * Only the kinds that can be truthfully re-made are offered. A payment receipt
 * or a refund notice describes a transaction at a moment in time and is not
 * derivable from current state, so it is refused rather than approximated.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'BookingResendAPI' });

/**
 * The kinds a client can be sent again.
 *
 * Deliberately a short list rather than every value of `EmailKind`: each entry
 * below is a message this route can rebuild from the booking's current state
 * and still be telling the truth.
 */
const RESENDABLE = [
  'booking_confirmed',
  'booking_rescheduled',
  'missed_appointment',
  'meeting_cancelled',
  'booking_cancelled',
  'intake_requested',
] as const;

const bodySchema = z.object({
  kind: z.enum(RESENDABLE),
});

export async function POST(
  request: NextRequest,
  /* Not a Promise: this repo is on Next 14, where `params` is a plain object.
     The sibling routes in this folder are split between the two spellings —
     `await` on a non-thenable returns the value, so the wrong one still runs
     and only the types disagree. The neighbours this route works beside
     (`cancel`, `complete`, `no-show`, `meeting-cancel`) use this form. */
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: bookingId } = params;

    let kind: (typeof RESENDABLE)[number];
    try {
      kind = bodySchema.parse(await request.json()).kind;
    } catch {
      return NextResponse.json(
        { success: false, error: 'That message cannot be sent again.' },
        { status: 400 }
      );
    }

    const { data: booking, error } = await schedulingBookingRepository.findById(bookingId, user.id);
    if (error || !booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    if (!booking.client_email) {
      return NextResponse.json(
        { success: false, error: 'This client has no email address on file.' },
        { status: 409 }
      );
    }

    const result = await (async () => {
      switch (kind) {
        case 'booking_confirmed':
          return BookingEmailService.sendBookingConfirmation(bookingId, user.id, {
            isResend: true,
            /* The invoice was raised the first time. Raising a second one
               because the owner re-sent an email would be a real charge
               created by a cosmetic action. */
            skipInvoice: true,
          });

        case 'booking_rescheduled': {
          /*
           * The notice says "it moved from X to Y", so it needs the time it
           * moved FROM — which is the attempt before the current one.
           *
           * Without a previous attempt there is nothing truthful to say, and
           * the confirmation is the message that fits: it states the time as
           * it now stands, which is what a client who lost the mail wants.
           */
          const attempts = await schedulingBookingRepository.listAttempts(user.id, [bookingId]);
          const chain = attempts[bookingId] ?? [];
          const previous = chain.length > 1 ? chain[chain.length - 2] : null;
          if (!previous) {
            return BookingEmailService.sendBookingConfirmation(bookingId, user.id, {
              isResend: true,
              skipInvoice: true,
            });
          }
          return BookingEmailService.sendRescheduledEmail(
            bookingId,
            user.id,
            new Date(previous.start_time),
            { isResend: true }
          );
        }

        case 'missed_appointment':
          return BookingEmailService.sendMissedAppointmentEmail(bookingId, user.id, {
            isResend: true,
          });

        case 'meeting_cancelled':
          return BookingEmailService.sendCancellationEmail(bookingId, user.id, undefined, {
            /*
             * The owner's stored answer (20261083), not a fresh guess. The
             * client was told one of two opposite things the first time, and
             * a repeat that says the other one is worse than no repeat.
             */
            meetingOnly: { proposalContinues: booking.proposal_continues ?? true },
            offerRebooking: true,
            isResend: true,
          });

        case 'booking_cancelled':
          return BookingEmailService.sendCancellationEmail(
            bookingId,
            user.id,
            booking.cancellation_reason ?? undefined,
            { isResend: true }
          );

        case 'intake_requested':
          /*
           * No `isResend` here, and it is not an omission: that sender derives
           * it from `intake_sent_at`, which the first send stamps. A form going
           * out again with it already set IS the repeat, and passing a second
           * source of the same fact is how the two end up disagreeing.
           */
          return BookingEmailService.sendIntakeFormRequest(bookingId, user.id, { manual: true });
      }
    })();

    if (!result?.sent) {
      requestLogger.warn({ bookingId, kind, error: result?.error }, 'Resend failed');
      return NextResponse.json(
        { success: false, error: result?.error || 'The message could not be sent.' },
        { status: 502 }
      );
    }

    /* Non-blocking, like every audit call (CLAUDE.md rule). */
    AuditTrailService.getInstance()
      .log({
        action: 'BOOKING_EMAIL_RESENT',
        entityType: 'scheduling_booking',
        entityId: bookingId,
        userId: user.id,
        details: { kind },
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info({ bookingId, kind }, 'Message sent again');
    return NextResponse.json({ success: true, data: { kind } });
  } catch (err) {
    requestLogger.error({ err }, 'Resend failed');
    return NextResponse.json(
      {
        success: false,
        error: 'The message could not be sent.',
        details: process.env.NODE_ENV === 'development' ? String(err) : undefined,
      },
      { status: 500 }
    );
  }
}
