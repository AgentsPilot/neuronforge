// app/api/book/manage/[token]/reschedule/route.ts
// Self-service booking reschedule endpoint

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken, BookingEmailService } from '@/lib/services/BookingEmailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';
import { wallClockToInstant } from '@/lib/scheduling/wallClock';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment, activityRecord } from '@/lib/business-os/activityText';

const logger = createLogger({ module: 'API', service: 'BookingReschedule' });

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
        contact:crm_contacts(email),
        service:scheduling_services(min_notice_hours)
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

    const timeZone = ownerPrefs?.timezone || booking.timezone || 'UTC';

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

    const { data: conflicts } = await supabaseServer
      .from('scheduling_bookings')
      .select('id')
      .eq('user_id', booking.user_id)
      .in('status', ['confirmed', 'completed'])
      .neq('id', bookingId)
      .lt('start_time', newEndInstant)
      .gt('end_time', newStartInstant);

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        { success: false, code: 'slot_taken', error: 'The selected time slot is not available' },
        { status: 409 }
      );
    }

    // Store previous time for email
    const previousDateTime = new Date(booking.start_time);

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update({
        start_time: newStartInstant,
        end_time: newEndInstant,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, code: 'reschedule_failed', error: 'Failed to reschedule booking' },
        { status: 500 }
      );
    }

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

    // Send rescheduled email (non-blocking)
    BookingEmailService.sendRescheduledEmail(bookingId, booking.user_id, previousDateTime)
      .catch(err => requestLogger.warn({ err }, 'Rescheduled email failed (non-blocking)'));

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
