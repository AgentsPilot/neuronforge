// app/api/book/manage/[token]/cancel/route.ts
// Self-service booking cancellation endpoint

import { resolvePortalAccess } from '@/lib/security/portalAccess';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { cancelBooking, clientCancellationReason } from '@/lib/services/BookingLifecycleService';
import { CLIENT_CANCEL_REASONS } from '@/lib/business-os/cancellationReasons';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
/* The meeting-only path: the same repository method and the same email variant
   the OWNER's `bookings/[id]/meeting-cancel` route has always used, so the two
   surfaces cannot end an appointment two different ways. */
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
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

  /*
   * Throttled before anything else: no session stands in front of this route.
   * The `ok` bucket counts volume; a rejected credential counts under the much
   * tighter failure budget below, which is the one that detects probing.
   */
  const throttle = await rateLimit(request, 'booking-cancel', RATE_LIMITS.write);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);

  try {
    // Verify token
    /*
     * Either a signed link or a booking id backed by the grant cookie.
     *
     * The id alone is never enough — it is what sits in the address bar
     * precisely because holding it grants nothing. `resolvePortalAccess` tells
     * the two apart by shape and requires a grant naming THIS booking for the
     * id form, so a cookie for one booking cannot open another.
     */
    const access = resolvePortalAccess(token, request.headers.get('cookie'));
    if (!access) {
      /*
       * A rejected token counts under the FAILURE budget, and once that budget
       * is spent the caller gets 429 instead of 401. This is the half that
       * detects anything: a client reloading is noise on the `ok` counter, but
       * a run of rejected tokens from one address is somebody trying keys.
       */
      const failures = await rateLimit(request, 'booking-cancel', RATE_LIMITS.write, 'failure');
      if (!failures.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);

      return NextResponse.json(
        { success: false, code: 'invalid_link', error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = access;

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
    /*
     * `payment_plan_id` and `parent_booking_id` are read for the branch below:
     * the first is a sale still being paid for in periods, the second means
     * this row is one session of a package. Either way the purchase outlives
     * this hour. (Kept out of the select string itself — PostgREST has no
     * comment syntax and supabase-js parses that string for its types.)
     */
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        contact_id,
        start_time,
        status,
        meeting_status,
        timezone,
        payment_plan_id,
        parent_booking_id,
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

    /*
     * ── A PACKAGE IS NOT CANCELLED FROM THE PORTAL ──────────────────────────
     *
     * A client holding a block of sessions may MOVE one; calling one off is
     * the owner's decision, because it is the owner who then decides whether
     * a replacement session is added and whether anything is returned. That is
     * the rule asked for, and it closes a worse hole than it looks:
     *
     * `purchaseOutlivesTheHour` below is `payment_plan_id || parent_booking_id`,
     * and a package CONTAINER has neither — its sessions are meetings on
     * itself, not child bookings. So a client pressing Cancel on the container
     * fell through to the whole-booking branch and called off the entire
     * block, every remaining session with it, on a package they had paid for
     * in full.
     *
     * Refused HERE rather than only in the portal, because the portal's button
     * is not the only way to reach this route.
     *
     * Counted off `scheduling_meetings`: a package is a booking with sessions
     * on it, which is the same fact `packageSessionLines` reads. One indexed
     * count, on a path that is already several queries deep.
     */
    const { count: sessionCount, error: sessionCountError } = await supabaseServer
      .from('scheduling_meetings')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('user_id', booking.user_id)
      .not('session_number', 'is', null);

    if (sessionCountError) {
      /* Unknown is not "no": refusing to guess here would let the whole-block
         cancellation through on a failed read, which is the thing being
         prevented. */
      requestLogger.error(
        { err: sessionCountError, bookingId },
        'Could not tell whether this booking is a package; cancellation refused'
      );
      return NextResponse.json(
        { success: false, code: 'not_cancellable', error: 'This booking cannot be cancelled' },
        { status: 400 }
      );
    }

    if ((sessionCount ?? 0) > 1) {
      return NextResponse.json(
        {
          success: false,
          code: 'package_not_cancellable',
          error: 'Sessions in a package cannot be cancelled here. Please contact the business.',
        },
        { status: 400 }
      );
    }

    /*
     * ── AND THE APPOINTMENT IS STILL OPEN ────────────────────────────────
     *
     * `status` stopped answering this when held and no-show began writing
     * `meeting_status` and leaving the job alone. Without it a meeting the
     * owner had already recorded as having taken place could still be moved
     * or called off from the client's own link.
     *
     * Checked HERE as well as on the page that draws the buttons: hiding a
     * control is a courtesy, refusing the write is the guard. A page left open
     * across the owner marking the meeting would otherwise still post.
     *
     * `no_show` passes deliberately — a missed appointment is unresolved, and
     * the client picking another time is the right next move.
     */
    if (booking.meeting_status === 'held' || booking.meeting_status === 'cancelled') {
      return NextResponse.json(
        {
          success: false,
          code: 'already_settled',
          error:
            booking.meeting_status === 'held'
              ? 'That meeting has already taken place.'
              : 'That meeting has already been cancelled.',
        },
        { status: 409 }
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
    /*
     * ── CALLING OFF THE HOUR IS NOT ALWAYS CALLING OFF THE PURCHASE ──────────
     *
     * This route ended the whole booking, whatever the client had bought. On a
     * single appointment that is right: the booking IS the hour. On a sale
     * still being paid for it is not, and it produced the worst pairing
     * available — the client lost the appointment AND the plan carried on
     * charging, because stopping a payment arrangement is deliberately the
     * owner's decision (see `planLive` in BookingLifecycleService).
     *
     * Measured 2026-10-25: a client cancelled one session of a two-period plan;
     * the booking went to `cancelled` and ₪250 was still due the following
     * week.
     *
     * Every scheduling platform draws the line the same way — Mindbody returns
     * the session to the client's pricing option and leaves the package
     * standing; Acuity cancels appointments one at a time and leaves the
     * refund to policy. The session goes back; the purchase does not.
     *
     * So: a sale that outlives the hour loses the HOUR — the same
     * `cancelMeeting` the owner's own "cancel meeting" button has always used,
     * recorded as the client's doing. The slot is freed either way
     * (`holdsSlot` is false for `meeting_status: 'cancelled'`), the booking
     * stays live so the session can be rearranged, and the plan is untouched,
     * exactly as it is on every other path.
     *
     * Everything above this line — the token, the owner match, the `confirmed`
     * check, the already-answered check and the service's notice window — is
     * unchanged and guards both branches.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const purchaseOutlivesTheHour =
      Boolean(booking.payment_plan_id) || Boolean(booking.parent_booking_id);

    if (purchaseOutlivesTheHour) {
      const meeting = await schedulingBookingRepository.cancelMeeting(
        bookingId,
        booking.user_id,
        /* The record of WHO, the same way the owner's route stamps `owner`. */
        'client'
      );

      if (meeting.error || !meeting.data) {
        requestLogger.error({ err: meeting.error, bookingId }, 'Failed to cancel the meeting');
        return NextResponse.json(
          { success: false, code: 'cancel_failed', error: 'Failed to cancel booking' },
          { status: 500 }
        );
      }

      requestLogger.info(
        { bookingId, reason, planId: booking.payment_plan_id, parentBookingId: booking.parent_booking_id },
        'Meeting cancelled by client; the purchase continues'
      );

      /*
       * The `meetingOnly` mail: it names the DATE rather than the service and
       * carries no money line, because none moved. Same variant the owner's
       * route sends, and it logs as `meeting_cancelled` rather than
       * `booking_cancelled` so the two stay distinguishable.
       *
       * `proposalContinues: true` — this branch is reached for a sale already
       * made, never for a quote awaiting an answer, so there is nothing to
       * tell the client is off.
       */
      BookingEmailService.sendCancellationEmail(bookingId, booking.user_id, reason, {
        meetingOnly: { proposalContinues: true },
      }).catch(err =>
        requestLogger.warn({ err, bookingId }, 'Meeting cancellation email failed (non-blocking)')
      );

      const meetingService = Array.isArray(booking.service) ? booking.service[0] : booking.service;
      notifyOwnerOfLead({
        ownerId: booking.user_id,
        contactId: booking.contact_id,
        kind: 'cancelled',
        contactName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Client',
        contactEmail: contact?.email,
        serviceName: meetingService?.service_name,
        startTime: booking.start_time,
        timezone: booking.timezone,
        reason,
        /* No money moved and no plan was stopped, so neither is reported here.
           The owner's alert for this one is about an hour that is now free. */
      }).catch(err => requestLogger.warn({ err, bookingId }, 'Owner alert failed (non-blocking)'));

      return NextResponse.json({
        success: true,
        message: 'Meeting cancelled successfully',
        /* So the portal can say which of the two happened rather than guess. */
        scope: 'meeting' as const,
        booking: {
          id: meeting.data.id,
          status: meeting.data.status,
          meetingStatus: 'cancelled',
        },
      });
    }

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
      /* The counterpart of `scope: 'meeting'` above, so the portal states what
         actually happened instead of assuming one of the two. */
      scope: 'booking' as const,
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
