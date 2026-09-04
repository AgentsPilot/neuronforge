/**
 * Send a booking's confirmation email again.
 *
 *   POST /api/scheduling/bookings/[id]/confirmation
 *
 * The journey strip offers "Send again" on the confirmation step — a client who
 * lost the email, or never got it because their address was wrong at the time
 * and has since been fixed. Until now the only way to re-send was to recreate
 * the booking.
 *
 * `BookingEmailService.sendBookingConfirmation` already does the work, including
 * the calendar invite and the business's branding; this is the door to it.
 *
 * @module app/api/scheduling/bookings/[id]/confirmation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'BookingConfirmationAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: bookingId } = await params;

    /*
     * The booking is fetched here, before sending, for two reasons that are not
     * the email service's job: it scopes the booking to THIS user — the service
     * takes a userId but the route is what must refuse someone else's booking —
     * and it is where a cancelled booking is caught.
     */
    const { data: booking, error } = await schedulingBookingRepository.findById(bookingId, user.id);

    if (error || !booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    /*
     * Never once the booking has an outcome.
     *
     * The confirmation says "your appointment is booked" and carries a calendar
     * invite. Sending that for an appointment that was cancelled, missed, or has
     * already happened is worse than sending nothing — the client puts a dead
     * appointment back in their diary.
     *
     * Checked HERE and not only in the UI: the button is one caller, and a
     * booking's status can change between the page loading and the click.
     */
    if (
      booking.status === 'cancelled' ||
      booking.status === 'no_show' ||
      booking.status === 'completed'
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This booking already has an outcome recorded, so its confirmation cannot be sent again.',
        },
        { status: 409 }
      );
    }

    if (!booking.client_email) {
      return NextResponse.json(
        { success: false, error: 'This client has no email address on file.' },
        { status: 409 }
      );
    }

    const result = await BookingEmailService.sendBookingConfirmation(bookingId, user.id, {
      /*
       * No invoice with it.
       *
       * A resend is about the appointment, not about asking for money again —
       * attaching a payment link to a booking that has already been paid for is
       * how a client ends up paying twice.
       */
      skipInvoice: true,
    });

    if (!result.sent) {
      requestLogger.warn({ bookingId, error: result.error }, 'Confirmation resend failed');
      return NextResponse.json(
        { success: false, error: result.error || 'The email could not be sent.' },
        { status: 502 }
      );
    }

    auditTrail
      .log({
        action: 'BOOKING_CONFIRMATION_RESENT',
        entityType: 'scheduling_booking',
        entityId: bookingId,
        userId: user.id,
        severity: 'info',
        changes: { to: booking.client_email },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ bookingId }, 'Confirmation resent');

    return NextResponse.json({ success: true, data: { sentTo: booking.client_email } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to resend the confirmation');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
