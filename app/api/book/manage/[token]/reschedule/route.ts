// app/api/book/manage/[token]/reschedule/route.ts
// Self-service booking reschedule endpoint

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';
import {
  rescheduleBooking,
  BookingSlotUnavailableError,
  BookingOnClosedDayError,
} from '@/lib/services/BookingLifecycleService';
import { notifyOwnerOfLead } from '@/lib/services/LeadAlertService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import { wallClockToInstant } from '@/lib/scheduling/wallClock';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment, activityRecord } from '@/lib/business-os/activityText';
import { safeTimezone } from '@/lib/scheduling/businessTime';

const logger = createLogger({ module: 'API', service: 'BookingReschedule' });

/**
 * How many times a client may move one booking from their own link.
 *
 * Two, then they talk to the business. Not a number the business sets: it is a
 * guard on a public link, and an owner can always move a booking themselves.
 */
const CLIENT_RESCHEDULE_LIMIT = 2;

/**
 * How many times the CLIENT has moved this booking.
 *
 * Counted from the timeline because only this route writes a
 * `booking_rescheduled` row — the owner's reschedule writes none — so the count
 * is self-service moves and nothing else. That asymmetry is the point: the
 * business can move a booking as often as it likes.
 *
 * An unreadable count answers 0, letting the move through. A client who cannot
 * reschedule and cannot be told why becomes a phone call for the owner; the
 * worst case the other way is one extra move.
 */
async function clientMoveCount(userId: string, bookingId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from('crm_activities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('activity_type', 'booking_rescheduled')
    .eq('source_entity_id', bookingId);

  if (error) {
    logger.warn({ err: error, bookingId }, 'Could not count reschedules; allowing the move');
    return 0;
  }

  return count ?? 0;
}


/**
 * Accepts the slot strings this platform actually produces.
 *
 * `z.string().datetime()` demands a UTC `Z` suffix, and the availability API
 * emits a naive local wall-clock time — `2026-09-09T09:00:00`, built as
 * `${date}T${slotStartStr}:00` — because a business's hours are local hours,
 * not instants. So every reschedule a client attempted was rejected with a 400
 * before it reached any logic, while the ORIGINAL booking went through: the
 * create route takes a plain `z.string()` for the same value.
 *
 * Validated by shape rather than left unchecked, and with an offset and a `Z`
 * still allowed, so a caller that does send a zoned time is not broken by this.
 */
const LOCAL_OR_ZONED_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

const rescheduleSchema = z.object({
  newStartTime: z.string().regex(LOCAL_OR_ZONED_DATETIME, 'Invalid start time'),
  newEndTime: z.string().regex(LOCAL_OR_ZONED_DATETIME, 'Invalid end time')
});

// GET /api/book/manage/[token]/reschedule
// Returns available slots for rescheduling
export async function GET(
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

    // Fetch booking with contact email via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        service_id,
        contact_id,
        start_time,
        status,
        contact:crm_contacts(email),
        service:scheduling_services(
          duration_minutes,
          advance_booking_days,
          min_notice_hours,
          availability
        )
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

    // Check if booking can be rescheduled
    const startTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, code: 'not_reschedulable', error: 'This booking cannot be rescheduled' },
        { status: 400 }
      );
    }

    /*
     * Say it BEFORE offering times, not after they pick one.
     *
     * The POST refuses a third move anyway, but a picker that shows a month of
     * slots and then rejects the chosen one is the rudest possible way to state
     * a rule. Same count, same limit, read here so the page can lead with it.
     */
    const usedMoves = await clientMoveCount(booking.user_id, bookingId);

    if (usedMoves >= CLIENT_RESCHEDULE_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          code: 'reschedule_limit',
          limit: CLIENT_RESCHEDULE_LIMIT,
          error: `This booking has already been moved ${CLIENT_RESCHEDULE_LIMIT} times`,
        },
        { status: 400 }
      );
    }

    // Read before the notice check, because the notice period is a property of
    // the SERVICE and the check below has to use it.
    const service = booking.service as {
      duration_minutes: number;
      advance_booking_days: number;
      min_notice_hours: number;
      availability: Record<string, unknown>;
    };

    /*
     * The service's own notice period, not a hardcoded day.
     *
     * `min_notice_hours` was loaded, defaulted to 24 further down, and then
     * ignored: the test said `< 24` and the message said "24 hours" whatever
     * the business had configured. A clinic asking for 48 hours' notice let
     * clients move an appointment 30 hours out, and one asking for 2 refused a
     * change 20 hours out while telling them the rule was 24.
     */
    const noticeHours = service?.min_notice_hours ?? 24;

    if (hoursUntilBooking < noticeHours) {
      return NextResponse.json(
        {
          success: false,
          // The sentence is composed on the client, which owns the dictionary:
          // this page is read in three languages and the reason was arriving in
          // English regardless. `hours` travels with the code so the message can
          // state the real rule.
          code: 'too_late',
          hours: noticeHours,
          error: `Bookings must be rescheduled at least ${noticeHours} hours in advance`,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      bookingId: booking.id,
      serviceId: booking.service_id,
      userId: booking.user_id,
      currentStartTime: booking.start_time,
      serviceConfig: {
        durationMinutes: service?.duration_minutes || 60,
        advanceBookingDays: service?.advance_booking_days || 30,
        minNoticeHours: service?.min_notice_hours || 24
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching reschedule options');
    return NextResponse.json(
      { success: false, code: 'load_failed', error: 'Failed to fetch reschedule options' },
      { status: 500 }
    );
  }
}

// POST /api/book/manage/[token]/reschedule
// Reschedule the booking to a new time
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

    // Parse and validate body
    const body = await request.json();
    const validated = rescheduleSchema.parse(body);

    // Fetch booking with contact email via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    /*
     * The service comes too, for `min_notice_hours`.
     *
     * This path did not load it, so GET offered slots by the service's rule
     * while POST refused them by a hardcoded 24. A client on a 2-hour-notice
     * service could pick a time the page had just shown them and be told it was
     * too late.
     */
    const { data: bookingData, error } = await supabaseServer
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

    if (error || !bookingData) {
      return NextResponse.json(
        { success: false, code: 'not_found', error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Get contact email from JOIN and verify it matches the token
    const postContact = Array.isArray(bookingData.contact) ? bookingData.contact[0] : bookingData.contact;
    const postContactEmail = postContact?.email || '';
    if (postContactEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { success: false, code: 'not_found', error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Use alias to avoid conflict with earlier 'booking' variable
    const booking = bookingData;

    // Validate booking can be rescheduled
    const currentStartTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (currentStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, code: 'not_reschedulable', error: 'This booking cannot be rescheduled' },
        { status: 400 }
      );
    }

    // The same rule GET applied when it offered these slots. See the note there.
    const bookingService = Array.isArray(bookingData.service)
      ? bookingData.service[0]
      : bookingData.service;
    const noticeHours =
      (bookingService as { min_notice_hours?: number } | null)?.min_notice_hours ?? 24;

    if (hoursUntilBooking < noticeHours) {
      return NextResponse.json(
        {
          success: false,
          code: 'too_late',
          hours: noticeHours,
          error: `Bookings must be rescheduled at least ${noticeHours} hours in advance`,
        },
        { status: 400 }
      );
    }

    /*
     * How many times has the CLIENT moved this one already?
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Unlimited self-service moves are a way not to pay. A booking's invoice is
     * due on the day of the appointment, and the overdue chase now waits for
     * the session to happen — so a client who moves the date whenever it gets
     * close is never chased at all, because the session never arrives.
     *
     * Counted from the timeline rather than a column: only THIS route writes a
     * `booking_rescheduled` row, so the count is client moves and nothing else.
     * The owner can still move it as often as they like, which is the intended
     * asymmetry — this is a limit on self-service, not on the business.
     *
     * Failing to read the count lets the move through. A client who cannot
     * reschedule and cannot tell why is a phone call for the owner, and the
     * worst case here is one extra move.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const movesSoFar = await clientMoveCount(bookingData.user_id, bookingId);

    if (movesSoFar >= CLIENT_RESCHEDULE_LIMIT) {
      requestLogger.info({ bookingId, movesSoFar }, 'Client reschedule limit reached');
      return NextResponse.json(
        {
          success: false,
          code: 'reschedule_limit',
          limit: CLIENT_RESCHEDULE_LIMIT,
          error: `This booking has already been moved ${CLIENT_RESCHEDULE_LIMIT} times`,
        },
        { status: 400 }
      );
    }

    // Check for conflicts with the new time
    /*
     * The slot is a wall clock; the column is an instant.
     *
     * The picker sends `2026-09-23T13:00:00` — one in the afternoon where the
     * business is — and `start_time` is a `timestamptz`. Postgres reads a
     * string with no offset as UTC, so 13:00 went in as 13:00Z and came back,
     * rendered correctly in the business's own zone, as 09:00. Four hours were
     * lost between the button and the database, and the confirmation page, the
     * email and the diary all repeated the wrong hour faithfully.
     *
     * Converted once, here, before anything reads it — including the conflict
     * check below, which was comparing a wall clock against stored instants and
     * so could clear a slot that was already taken.
     */
    const { data: ownerPrefs } = await supabaseServer
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', booking.user_id)
      .maybeSingle();

    // Validated, not merely defaulted — see the same change in
    // `website/booking/availability`. The zone stamped on the booking stays the
    // second choice, so a business that has since moved does not drag an
    // already-agreed appointment with it.
    const timeZone = safeTimezone(ownerPrefs?.timezone || booking.timezone);

    // The language the business works in — what its own history is written in.
    const { data: ownerProfile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', booking.user_id)
      .maybeSingle();
    const ownerLocale = ownerProfile?.language || 'en';
    const newStartInstant = wallClockToInstant(validated.newStartTime, timeZone);
    const newEndInstant = wallClockToInstant(validated.newEndTime, timeZone);

    requestLogger.info(
      { bookingId, timeZone, picked: validated.newStartTime, stored: newStartInstant },
      'Converted picked wall clock to an instant'
    );

    /*
     * The same reschedule the owner's route performs.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This wrote the booking row itself and bolted the calendar and the email
     * on afterwards — a second implementation of a verb that already had one,
     * which is exactly the shape the cancel page had before it was routed
     * through `cancelBooking`. Anything added to the shared reschedule reached
     * the owner's bookings and not the ones a CLIENT moved, which is the path
     * most moves actually take.
     *
     * Two consequences of the move, both deliberate:
     *
     *   · The double-booking check is now the canonical one
     *     (`SLOT_HOLDING_STATUSES`), which counts a `pending` booking as
     *     holding its slot. This route only counted `confirmed` and
     *     `completed`, so a client could be handed a time another booking was
     *     already holding.
     *   · The move is written to the audit trail, which it never was.
     *
     * The guards above stay here: the token, the `confirmed` check and the
     * service's notice window are this surface's alone.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const rescheduled = await rescheduleBooking({
      bookingId,
      userId: booking.user_id,
      startTime: newStartInstant,
      endTime: newEndInstant,
      request,
      logger: requestLogger,
    });

    if (rescheduled.error) {
      // The slot went while they were choosing. Same code and status this route
      // has always answered with, so the page keeps its own wording for it.
      if (rescheduled.error instanceof BookingSlotUnavailableError) {
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: 'The selected time slot is not available' },
          { status: 409 }
        );
      }

      /*
       * The day is closed, which a client cannot overrule.
       *
       * They are only ever offered slots that already exclude the closed days
       * (`website/scheduling/availability` applies them), so reaching this
       * means a page left open across the owner recording a holiday. Answered
       * as `slot_taken` deliberately: the page already has wording for "that
       * time is gone, choose another", which is exactly the instruction, and
       * the client has no business being told about the owner's holiday.
       */
      if (rescheduled.error instanceof BookingOnClosedDayError) {
        requestLogger.info(
          { bookingId, startTime: newStartInstant },
          'Client picked a time on a day that is now closed'
        );
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: 'The selected time slot is not available' },
          { status: 409 }
        );
      }

      requestLogger.error({ err: rescheduled.error }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, code: 'reschedule_failed', error: 'Failed to reschedule booking' },
        { status: 500 }
      );
    }

    const updatedBooking = rescheduled.data!.booking;

    requestLogger.info({ bookingId, previousTime: booking.start_time, newTime: newStartInstant }, 'Booking rescheduled');

    /*
     * The move itself, on the contact's timeline.
     *
     * Only the EMAIL about a reschedule was ever recorded, so the drawer showed
     * that a message went out and never what changed. An owner asking "has this
     * client moved their appointment before?" had nothing to read, and no
     * detector could count it.
     *
     * Both times are stored as instants and the sentence is composed at render,
     * so it reads in the owner's language and in the business's timezone.
     */
    if (booking.contact_id) {
      crmActivityRepository.create({
        user_id: booking.user_id,
        contact_id: booking.contact_id,
        activity_type: 'booking_rescheduled',
        /*
         * Composed now, in the business's language, because this records what
         * happened rather than labelling a control — the same as a note somebody
         * typed. Switching the dashboard later must not re-narrate the past.
         *
         * The facts travel alongside the sentence so the row can still open to
         * show the before and after.
         */
        title: activitySentence(
          'booking_rescheduled',
          {
            from: activityMoment(booking.start_time, ownerLocale, timeZone) || '',
            to: activityMoment(newStartInstant, ownerLocale, timeZone) || '',
          },
          ownerLocale
        ),
        description: JSON.stringify({
          kind: 'booking_rescheduled',
          from: booking.start_time,
          to: newStartInstant,
          // Recorded with the row, so the history keeps reading in the hours
          // that were agreed even if the business later moves timezone.
          timeZone,
        }),
        auto_logged: true,
        source_capability: 'scheduling',
        source_entity_id: bookingId,
        activity_date: newStartInstant,
      }).catch(err => requestLogger.warn({ err }, 'Reschedule activity logging failed (non-blocking)'));
    }

    /*
     * The client's email and the owner's calendar are BOTH done by
     * `rescheduleBooking` above — and were done here as well until this route
     * started calling it. Left in place, the client received two "your
     * appointment has moved" emails for one move.
     *
     * The calendar helper this used, `updateOwnerCalendarEvent`, ends at the
     * same `CalendarSyncService.updateCalendarEvent` the service calls, so
     * nothing is lost by dropping it.
     */

    /*
     * And tell them (non-blocking), with both times.
     *
     * "Moved" on its own is not usable — the owner needs to know what to stop
     * expecting as well as what to expect.
     */
    const movedService = Array.isArray(bookingData.service)
      ? bookingData.service[0]
      : bookingData.service;
    notifyOwnerOfLead({
      ownerId: bookingData.user_id,
      contactId: bookingData.contact_id,
      kind: 'moved',
      contactName:
        [postContact?.first_name, postContact?.last_name].filter(Boolean).join(' ') || 'Client',
      contactEmail: postContact?.email,
      serviceName: movedService?.service_name,
      // `bookingData` was read BEFORE the reschedule, so it still holds the old
      // start — which is the half of "moved" the owner needs, to know what to
      // stop expecting as well as what to expect.
      startTime: newStartInstant,
      previousStartTime: bookingData.start_time,
      timezone: timeZone,
    }).catch(err => requestLogger.warn({ err, bookingId }, 'Owner alert failed (non-blocking)'));

    return NextResponse.json({
      success: true,
      message: 'Booking rescheduled successfully',
      booking: {
        id: updatedBooking.id,
        startTime: updatedBooking.start_time,
        endTime: updatedBooking.end_time
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Error rescheduling booking');
    return NextResponse.json(
      { success: false, code: 'reschedule_failed', error: 'Failed to reschedule booking' },
      { status: 500 }
    );
  }
}
