/**
 * Conversion Booking Availability API
 * GET - Fetch available time slots for standalone booking page (userCode-based)
 *
 * This endpoint:
 * 1. Looks up the business by userCode
 * 2. Fetches available services from Scheduling capability
 * 3. Returns available time slots based on business availability settings
 *
 * This is a PUBLIC endpoint - no authentication required
 * Used by standalone conversion pages (/c/[userCode]/book)
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadServicePaymentPlans } from '@/lib/business-os/servicePaymentPlan';
import { createLogger } from '@/lib/logger';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { windowsForDate, hasAnyAvailability } from '@/lib/scheduling/availabilityWindows';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { busyMeetings, overlapsBusy } from '@/lib/scheduling/busyMeetings';
import { externalBusy } from '@/lib/scheduling/externalBusy';
import { businessInstant, safeTimezone, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
/* How far ahead a business takes bookings — one number, read by the repository
   that stamps it and every strip that obeys it. */
import { bookableDaysFor } from '@/lib/scheduling/bookingWindow';

const logger = createLogger({ module: 'ConversionBookingAvailabilityAPI' });

interface RouteParams {
  params: Promise<{ userCode: string }>;
}

interface TimeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  available: boolean;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  /** Null where the service declares no length — a product, or a fee-per-client. */
  duration_minutes: number | null;
  price: number | null;
  currency: string;
  /** Does booking this involve picking a time? Decides the date step. */
  is_scheduled: boolean;
  /** How the money arrives. Decides the payment step. */
  collection: 'online' | 'invoice' | null;
  /** Whether this is bought outright or quoted first. Decides where the journey ends. */
  sale_mode: 'direct' | 'proposal';
  /**
   * How much warning the business needs, and how far ahead it will take a
   * booking. Both were configured, respected by the sibling surfaces, and
   * ignored here — so a smart link could sell an hour starting in ten minutes,
   * or one eight months out.
   */
  min_notice_hours: number | null;
  advance_booking_days: number | null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { userCode } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, userCode });

  try {
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('service_id');
    const date = searchParams.get('date'); // YYYY-MM-DD format
    const daysAhead = parseInt(searchParams.get('days') || '7', 10);

    // Validate userCode format (alphanumeric, 6-10 chars)
    if (!userCode || !/^[a-z0-9]{6,10}$/i.test(userCode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user code format' },
        { status: 400 }
      );
    }

    // Look up business profile by userCode.
    // `business_profiles.timezone` does not exist — naming it would make
    // PostgREST reject this whole select. The zone is read from
    // `user_preferences` below.
    const { data: businessProfile, error: profileError } = await supabaseServer
      .from('business_profiles')
      .select('user_id, scheduling_availability, company_name, user_code')
      .eq('user_code', userCode.toLowerCase())
      .single();

    if (profileError || !businessProfile) {
      requestLogger.warn({ userCode }, 'Business not found');
      return NextResponse.json(
        { success: false, error: 'Business not found' },
        { status: 404 }
      );
    }

    const ownerId = businessProfile.user_id;

    // Check if availability has been explicitly configured
    // Asked of the windows, not of the keys. A profile whose every day is an
    // empty array has keys and no hours — it would have reported "configured"
    // and then produced nothing, which is the report that hid this bug.
    const hasAvailabilityConfigured = hasAnyAvailability(businessProfile.scheduling_availability);

    // Fetch active services
    /*
     * What this business publicly sells — the shared base set.
     *
     * The `.eq('is_active').eq('status')` pair this repeated is `BOOKABLE`, and
     * restating it per surface is what let the website and the smart links
     * disagree about a deactivated service in the first place. Which services
     * THIS link then offers is still its own business, decided below by
     * `servicesForLink`.
     */
    const { data: services, error: servicesError } =
      await schedulingServiceRepository.listBookable(ownerId);

    if (servicesError) {
      requestLogger.error({ err: servicesError }, 'Failed to fetch services');
      throw servicesError;
    }

    // Format services for response
    // A smart link sells the same services the website does, so it has to
    // describe them the same way.
    const plansByService = await loadServicePaymentPlans(ownerId);

    const formattedServices: Service[] = (services || []).map(s => ({
      id: s.id,
      name: s.service_name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: s.price,
      currency: s.currency || 'USD',
      // Normalised the same way the sibling route does, so the two cannot
      // disagree about a service: a null `is_scheduled` means an older row that
      // predates the column, and those were appointments.
      is_scheduled: s.is_scheduled !== false,
      collection: s.collection ?? null,
      /*
       * Selected but never returned, until now.
       *
       * The exact shape of the `paymentPlan` bug described below: the column
       * was in the SELECT, so it looked handled, and the mapper dropped it —
       * which meant a service the business sells by quotation was presented on
       * a smart link as a direct booking. The client would be walked to a
       * confirmation for work whose price nobody had stated.
       */
      sale_mode: s.sale_mode === 'proposal' ? 'proposal' : 'direct',
      min_notice_hours: s.min_notice_hours ?? null,
      advance_booking_days: s.advance_booking_days ?? null,
      // How this service may be paid over time.
      //
      // The config endpoint beside this one already returned it, and this one
      // did not — and this is the one the booking page reads its services from.
      // So a service sold in instalments was presented on a smart link as a
      // single price, and the client agreed to something other than what the
      // business had configured.
      paymentPlan: plansByService[s.id]
    }));

    /*
     * ── THE BUSINESS'S OWN CLOCK ────────────────────────────────────────────
     *
     * This read `'UTC'`, with a comment correctly noting that
     * `business_profiles.timezone` does not exist — and then stopped there.
     * So every hour on a smart link was quoted in UTC while the owner's
     * availability windows mean local time: a business open 09:00–17:00 in
     * Jerusalem had its day published starting at 11:00 its own time, and the
     * sibling subdomain page, which reads the real zone, published it at 09:00.
     *
     * `user_preferences` is where the zone lives (CLAUDE.md § Currency &
     * Timezone). `safeTimezone` keeps UTC as the fallback, so a business that
     * has never been asked behaves exactly as before.
     */
    const { data: ownerPrefs } = await supabaseServer
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', ownerId)
      .maybeSingle();

    const timezone = safeTimezone(ownerPrefs?.timezone);

    // If no service_id or date requested, return business info and services
    if (!serviceId || !date) {
      return NextResponse.json({
        success: true,
        businessName: businessProfile.company_name || 'Business',
        timezone,
        services: formattedServices,
        hasAvailabilityConfigured
      });
    }

    // If availability not configured, return empty slots
    if (!hasAvailabilityConfigured) {
      return NextResponse.json({
        success: true,
        businessName: businessProfile.company_name || 'Business',
        timezone,
        services: formattedServices,
        slots: [],
        hasAvailabilityConfigured: false
      });
    }

    // Find the selected service
    const selectedService = formattedServices.find(s => s.id === serviceId);
    if (!selectedService) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // Calculate available time slots
    const slots = await calculateAvailableSlots(
      ownerId,
      selectedService.duration_minutes,
      businessProfile.scheduling_availability,
      timezone,
      date,
      daysAhead,
      selectedService.min_notice_hours ?? 24,
      bookableDaysFor(selectedService.advance_booking_days)
    );

    return NextResponse.json({
      success: true,
      businessName: businessProfile.company_name || 'Business',
      timezone,
      services: formattedServices,
      slots,
      hasAvailabilityConfigured: true
    });
  } catch (error) {
    requestLogger.error({ err: error, userCode }, 'Failed to get availability');
    return NextResponse.json(
      { success: false, error: 'Failed to get availability' },
      { status: 500 }
    );
  }
}

/**
 * Calculate available time slots for booking
 */
async function calculateAvailableSlots(
  userId: string,
  /**
   * Null where the service declares no length. Not coerced to an hour: a
   * missing duration is missing information, and inventing sixty minutes is
   * what made every service implicitly an appointment. The slot grid's own
   * interval is the smallest honest block to hold.
   */
  durationMinutes: number | null,
  /** Raw JSON from the profile; shapes are normalised by `windowsForDay`. */
  availability: unknown,
  timezone: string,
  startDate: string,
  daysAhead: number,
  /** Hours of warning the business needs. 24 where the service is silent, which
   *  is the default the portal's reschedule route already applies. */
  noticeHours: number,
  /** How far ahead it takes bookings, already resolved by `bookableDaysFor`. */
  advanceDays: number
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = [];
  const now = new Date();

  /*
   * The closed days, once, for the whole window the loop below walks.
   *
   * Unreadable leaves it empty, which publishes the ordinary weekly hours —
   * what this endpoint has always done, and the safer of the two wrongs for a
   * page whose job is to take bookings.
   */
  const endKey = [
    new Date(new Date(startDate).getTime() + daysAhead * 86400000).getFullYear(),
    String(new Date(new Date(startDate).getTime() + daysAhead * 86400000).getMonth() + 1).padStart(2, '0'),
    String(new Date(new Date(startDate).getTime() + daysAhead * 86400000).getDate()).padStart(2, '0'),
  ].join('-');

  const offResult = await schedulingTimeOffRepository.list(userId, {
    from: startDate.slice(0, 10),
    to: endKey,
  });
  const timeOff = offResult.data ?? [];

  // Get existing bookings for the date range
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + daysAhead);

  /*
   * ── THE SHARED DEFINITION OF A TAKEN HOUR ───────────────────────────────
   *
   * This had its own query, and it disagreed with every other availability
   * surface in three ways:
   *
   *   · `.neq('status','cancelled')` — so a MISSED appointment went on
   *     blocking its hour for ever, which is the exact bug the meeting
   *     outcomes were separated from the job's status to fix;
   *   · it read `scheduling_bookings`, not `scheduling_meetings`, so it saw a
   *     different set of rows from the public booking page;
   *   · it windowed by CONTAINMENT on `start_time` alone, so an appointment
   *     starting before the range and running into it was invisible.
   *
   * A smart link is one of the ways a client reaches the booking page, and it
   * was offering a different set of hours from the page itself.
   */
  const busy = await busyMeetings(
    supabaseServer,
    userId,
    startDate,
    endDate.toISOString()
  );

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND THE OWNER'S OWN CALENDAR.
   *
   * A synced Google or Outlook event holds the owner's time as surely as an
   * appointment booked here. Every sibling surface reads them — the subdomain
   * booking page, the owner's free-slots, the portal's reschedule — and this
   * one did not, so the SAME hour for the SAME business was correctly withheld
   * at `/site/{subdomain}/book` and offered at `/c/{userCode}/book`.
   *
   * `PublicBookingPage` renders at both addresses and picks its endpoint by
   * which one it is serving, so the difference was invisible from the UI: one
   * page, two rules.
   *
   * Overlap semantics, so an all-day or multi-hour event running into the
   * window counts. Failure is non-fatal: a calendar we cannot read must not
   * take the booking page down, and the slot stays offered rather than the
   * page breaking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const ownerCalendar = await externalBusy(userId, startDate, endDate.toISOString());

  /* Same half-open test as the meetings, so a calendar event ending at 10:00
     does not withhold the 10:00 slot. */
  const overlapsExternal = (start: Date, end: Date) =>
    overlapsBusy(start, end, ownerCalendar);

  // Generate slots for each day
  for (let i = 0; i < daysAhead; i++) {
    /*
     * This DATE's windows: the weekday's hours with time off applied.
     *
     * Was the weekday alone, which is why a smart link went on offering slots
     * on a day the business was closed — `scheduling_availability_exceptions`
     * was read by nothing at all.
     *
     * The date key is built from the local date parts rather than
     * `toISOString()`, which would name the UTC day and, for a business ahead of
     * UTC, subtract a day from every closed-day comparison.
     */
    /* Walked as a STRING, so the day cannot drift: derived from a Date's parts
       it was the SERVER's day, and a business ahead of UTC lost its first. */
    const dateKey = shiftBusinessDateKey(startDate.slice(0, 10), i);

    // A day is a LIST of windows — a morning and an evening are two, with a gap
    // the client cannot book. Reading only the first would quietly hide the
    // second; reading `.start` off the list, which is what this did, hid both.
    for (const window of windowsForDate(availability, dateKey, timeOff)) {
      // Generate time slots (30-minute intervals)
      const slotInterval = 30; // minutes
      const blockMinutes = durationMinutes ?? slotInterval;

      /* `09:00` means nine o'clock WHERE THE BUSINESS IS. `setHours` on a Date
         means nine o'clock where the server is, which on Vercel is UTC — so
         the published day was shifted by the owner's whole offset. */
      let currentTime = businessInstant(dateKey, window.start, timezone);
      const dayEnd = businessInstant(dateKey, window.end, timezone);

      while (currentTime.getTime() + blockMinutes * 60 * 1000 <= dayEnd.getTime()) {
        const slotEnd = new Date(currentTime.getTime() + blockMinutes * 60 * 1000);

        // Check if slot is in the past
        const isPast = currentTime < now;

        // Check for conflicts with existing bookings
        /* Half-open, so back-to-back appointments are bookable. The three
           hand-written comparisons this replaces treated an end that equalled
           a start as a clash. */
        const hasConflict = overlapsBusy(currentTime, slotEnd, busy);

        /*
         * The same four gates the other surfaces apply. This endpoint checked
         * two of them, so a smart link offered hours the subdomain withheld:
         * an hour the owner is busy in elsewhere, an hour too soon to prepare
         * for, and an hour further out than the business takes bookings.
         */
        const hasExternalConflict = overlapsExternal(currentTime, slotEnd);
        const tooSoon = currentTime.getTime() < now.getTime() + noticeHours * 60 * 60 * 1000;
        const tooFar = currentTime.getTime() > now.getTime() + advanceDays * 24 * 60 * 60 * 1000;

        slots.push({
          start: currentTime.toISOString(),
          end: slotEnd.toISOString(),
          available: !isPast && !hasConflict && !hasExternalConflict && !tooSoon && !tooFar
        });

        // Move to next slot
        currentTime = new Date(currentTime.getTime() + slotInterval * 60 * 1000);
      }
    }
  }

  return slots;
}
