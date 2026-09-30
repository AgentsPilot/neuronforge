// app/api/book/manage/[token]/cancel/route.ts
// Self-service booking cancellation endpoint

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';
import { cancelBooking, clientCancellationReason } from '@/lib/services/BookingLifecycleService';
import { CLIENT_CANCEL_REASONS } from '@/lib/business-os/cancellationReasons';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'API', service: 'BookingCancel' });

const cancelSchema = z.object({
  /*
   * REQUIRED, from the client's list.
   *
   * Mandatory on every cancellation surface — see `cancellationReasons`. The
   * client's list is the short one: somebody who came to cancel an appointment is
   * not filling in a form, and a long list gets its first item clicked.
   */
  reason_code: z.enum(CLIENT_CANCEL_REASONS),
  /** Whatever they typed. The textarea that used to BE the reason. */
  reason: z.string().max(1000).optional()
});

// POST /api/book/manage/[token]/cancel
// Cancel the booking
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Verify token
    const decoded = verifyBookingToken(token);
    if (!decoded) {
      return NextResponse.json(
        { success: false, code: 'invalid_link', error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;

    /*
     * The body is NO LONGER optional, and a parse failure must not be swallowed.
     *
     * This used to be a try/catch that continued "without reason" on any error.
     * Now that `reason_code` is required, that same catch would have quietly
     * cancelled the booking with no code at all — the requirement satisfied in
     * the schema and defeated in the handler, which is worse than not having it.
     */
    const parsed = cancelSchema.safeParse(await request.json().catch(() => ({})));

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          code: 'reason_required',
          error: 'Please choose a reason for cancelling.',
          details: process.env.NODE_ENV === 'development' ? parsed.error.errors : undefined,
        },
        { status: 400 }
      );
    }

    const reason: string | undefined = parsed.data.reason;
    const reasonCode = parsed.data.reason_code;

    // Fetch booking with contact email via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    /*
     * The service comes too, for its `min_notice_hours` — the same rule the
     * reschedule route applies. Both said "24 hours" whatever the business had
     * configured.
     */
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        contact_id,
        start_time,
        status,
        timezone,
        contact:crm_contacts(email, first_name, last_name),
        service:scheduling_services(min_notice_hours, service_name)
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, code: 'not_found', error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Get contact email from JOIN and verify it matches the token
    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
    const contactEmail = contact?.email || '';
    if (contactEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { success: false, code: 'not_found', error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Validate booking can be cancelled
    const startTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, code: 'not_cancellable', error: 'This booking cannot be cancelled' },
        { status: 400 }
      );
    }

    // The service's own notice period, not a hardcoded day — see the query above.
    const bookingService = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const noticeHours =
      (bookingService as { min_notice_hours?: number } | null)?.min_notice_hours ?? 24;

    if (hoursUntilBooking < noticeHours) {
      return NextResponse.json(
        {
          success: false,
          // A code, not a sentence: this page is read in three languages and
          // the reason was arriving in English regardless.
          code: 'too_late',
          hours: noticeHours,
          error: `Bookings must be cancelled at least ${noticeHours} hours in advance`,
        },
        { status: 400 }
      );
    }

    /*
     * The same cancellation the owner's route performs.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This wrote the status itself, then bolted the email and the calendar on
     * afterwards — so everything added to `cancelBooking` since reached bookings
     * the OWNER cancelled and not the ones a client did. Most consequentially
     * the quote withdrawal, whose own comment describes the failure exactly: a
     * client still holding a live link could accept next week a job the business
     * had already written off. A client cancelling a quoted consultation is
     * precisely when that happens, and it was the one path that did not withdraw.
     *
     * The guards above stay here, because they are this surface's alone: the
     * token, the `confirmed` check and the service's notice window are what
     * separate a client cancelling their own booking from the owner cancelling
     * anybody's.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const cancellation = await cancelBooking({
      bookingId,
      userId: booking.user_id,
      /*
       * The prefix is the record of WHO cancelled, and the only thing that
       * distinguishes this from the owner doing it. Built by the service that
       * owns the wording, because the dashboard gap matches on it: a second
       * copy of the string here is a cancellation the owner never hears about.
       */
      /*
       * Still the prefixed prose, unchanged.
       *
       * `CLIENT_CANCELLED_PREFIX` is what the `booking_cancelled` gap and
       * `CashCancelledUnrefundedDetector` parse to know the client cancelled.
       * The structured columns below are what they should read instead, but
       * moving them is its own change — so both are written and nothing breaks.
       */
      reason: clientCancellationReason(reason),
      cancelReason: reasonCode,
      cancelNote: reason,
      cancelledBy: 'client',
      request,
      logger: requestLogger,
    });

    if (cancellation.error || !cancellation.data) {
      requestLogger.error({ err: cancellation.error }, 'Failed to cancel booking');
      return NextResponse.json(
        { success: false, code: 'cancel_failed', error: 'Failed to cancel booking' },
        { status: 500 }
      );
    }

    const updatedBooking = cancellation.data.booking;
    requestLogger.info(
      {
        bookingId,
        reason,
        invoicesCancelled: cancellation.data.invoicesCancelled,
        amountHeld: cancellation.data.amountHeld,
      },
      'Booking cancelled by client'
    );

    /*
     * And tell them (non-blocking).
     *
     * A cancellation is the most time-critical thing this platform can say. The
     * briefing lists them, but "tomorrow at 9" learned tomorrow morning is too
     * late to refill — which is the whole reason this one is immediate rather
     * than batched with the rest.
     */
    const cancelledService = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    notifyOwnerOfLead({
      ownerId: booking.user_id,
      contactId: booking.contact_id,
      kind: 'cancelled',
      contactName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Client',
      contactEmail: contact?.email,
      serviceName: cancelledService?.service_name,
      startTime: booking.start_time,
      timezone: booking.timezone,
      reason,
      // What the business is now holding for an appointment that is not
      // happening. The alert named the time and the reason and never this.
      amountHeld: cancellation.data.amountHeld || undefined,
      heldCurrency: cancellation.data.heldCurrency,
      // Still charging, and left running deliberately — the owner decides.
      planStillCharging: cancellation.data.planLive,
    }).catch(err => requestLogger.warn({ err, bookingId }, 'Owner alert failed (non-blocking)'));

    return NextResponse.json({
      success: true,
      message: 'Booking cancelled successfully',
      booking: {
        id: updatedBooking.id,
        status: updatedBooking.status
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error cancelling booking');
    return NextResponse.json(
      { success: false, code: 'cancel_failed', error: 'Failed to cancel booking' },
      { status: 500 }
    );
  }
}
