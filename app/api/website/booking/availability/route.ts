/**
 * Website Booking Availability API
 * GET - Fetch available time slots for public website booking widget
 *
 * This endpoint:
 * 1. Resolves the business by subdomain, user code, or the signed-in owner
 *    (the preview, where a draft page has no subdomain)
 * 2. Fetches available services from Scheduling capability
 * 3. Returns available time slots based on business availability settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { resolvePublicOwner } from '@/lib/business-os/publicOwner';
import { loadServicePaymentPlans, type ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';
import { busyMeetings, overlapsBusy } from '@/lib/scheduling/busyMeetings';
/* One slot rule for every public door into this diary. See the modules. */
import { slotStepMinutes } from '@/lib/scheduling/slotInterval';
import { offeredStarts, busySpansOn } from '@/lib/scheduling/offeredStarts';
/* The owner's synced calendar holds their time too — one definition, read by
   every surface that asks whether an hour is free. */
import { externalBusy } from '@/lib/scheduling/externalBusy';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { createLogger } from '@/lib/logger';
import { windowsForDate, hasAnyAvailability, type TimeOffEntry } from '@/lib/scheduling/availabilityWindows';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { safeTimezone, businessInstant, businessDateKey, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
import { bookableDaysFor } from '@/lib/scheduling/bookingWindow';

const logger = createLogger({ module: 'WebsiteBookingAvailabilityAPI' });

// Note: No default hours - availability must be explicitly configured
// This prevents showing booking slots before the business owner sets up their schedule

interface TimeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  available: boolean;
}

interface Service {
  /**
   * How many days ahead this service accepts bookings.
   *
   * The widget builds its date strip from this. Absent means the column was
   * null, and the caller falls back to the same 30 the repository defaults to
   * elsewhere rather than inventing a different number here.
   */
  advance_booking_days?: number | null;
  /**
   * How much warning the business needs before an appointment.
   *
   * Honoured when a client MOVES an appointment and ignored when one books it,
   * because the column never reached this list. Absent means null, and the
   * caller falls back to the same 24 the reschedule route uses.
   */
  min_notice_hours?: number | null;
  /**
   * The gap the business keeps AFTER this appointment.
   *
   * Spaces the starts together with the length (`slotInterval`) and widens what
   * counts as taken. This page honoured neither: it walked a flat half-hour and
   * knew nothing about the gap, while the sibling booking pages applied both.
   */
  buffer_minutes?: number | null;
  is_scheduled?: boolean;
  collection?: 'online' | 'invoice' | null;
  /** Bought outright, or quoted first. The booking modal's resolver reads it. */
  sale_mode?: 'direct' | 'proposal';
  /** How this service may be paid over time, where the business offers one. */
  paymentPlan?: ServicePaymentPlan;
  id: string;
  name: string;
  description: string | null;
  /*
   * Genuinely nullable. `20260901_service_shape.sql` dropped the NOT NULL so a
   * service can exist without being booked against a span — a course, a
   * product. Declaring it `number` made this assignment the one type error in
   * the file and, worse, told every reader below that a duration is always
   * there. The two slot calls now check before asking for slots.
   */
  duration_minutes: number | null;
  price: number | null;
  currency: string;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { searchParams } = new URL(request.url);
    const subdomain = searchParams.get('subdomain');
    const userCode = searchParams.get('user_code');
    const serviceId = searchParams.get('service_id');
    const date = searchParams.get('date'); // YYYY-MM-DD format
    const daysAhead = parseInt(searchParams.get('days') || '7', 10);

    /**
     * How many days of OPEN/CLOSED to report, without computing any slots.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The date strips on the public pages offered every day in their window as
     * if it were bookable, and a visitor learned the business is closed on a
     * Saturday by picking it and waiting for "no available times". Over a
     * fortnight that is tedious; over the ninety days a business may accept, it
     * is unusable.
     *
     * Reported separately from `slots` because it must stay cheap:
     * `windowsForDate` is a pure read of hours already in memory, so ninety
     * days cost ninety array lookups. Asking the slot engine the same question
     * would be ninety database round trips for an answer the strip only needs
     * in order to grey a button.
     *
     * Capped, because this is a public endpoint and the number arrives from a
     * query string.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const closedDaysWindow = Math.min(
      Math.max(parseInt(searchParams.get('closed_days') || '0', 10) || 0, 0),
      120
    );

    /*
     * Who this calendar belongs to — resolved the same way every other public
     * booking route resolves it.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This route required a `subdomain` and did its own `website_pages` lookup,
     * and both facts broke the PREVIEW.
     *
     * A draft page has no subdomain (`app/website-preview/[id]/page.tsx`: "a
     * draft in the wizard has neither"), so the preview passes an empty string
     * and this answered 400 "Subdomain is required" — while the smart link
     * worked, because ITS identity is a path segment that cannot go missing.
     * Same services, same journey, and the calendar loaded on one surface and
     * not the other.
     *
     * `payment-intent` had already solved exactly this: subdomain OR user code,
     * and otherwise the signed-in owner. Preview works because the owner is
     * signed in. That resolution is now here too, so the two halves of one
     * booking cannot disagree about whose business it is.
     *
     * `resolvePublicOwner` also replaces the `.single()` this used to do, which
     * ERRORS on more than one row: subdomain `0kgjcy` carries a draft and a live
     * page, so that lookup returned a failure and this route answered 404 for a
     * business whose site is fine.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let ownerId: string;

    if (subdomain || userCode) {
      const owner = await resolvePublicOwner({
        subdomain: subdomain ?? undefined,
        userCode: userCode ?? undefined,
      });

      if (!owner) {
        requestLogger.warn({ subdomain, userCode }, 'Business not found');
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }

      ownerId = owner.userId;
    } else {
      // No address at all: the preview, where the owner is the caller.
      const user = await getUser();

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }

      ownerId = user.id;
    }

    // Fetch business profile for availability settings
    const { data: businessProfile, error: profileError } = await supabaseServer
      .from('business_profiles')
      .select('scheduling_availability, company_name')
      .eq('user_id', ownerId)
      .single();

    /*
     * The business's timezone lives on `user_preferences` — that is where the
     * settings page writes it. This route asked `business_profiles` for a
     * `timezone` column that has never existed, and Postgres rejects an entire
     * SELECT over one unknown column: the availability query returned nothing,
     * so a business with a full diary showed no times at all.
     */
    const { data: ownerPrefs } = await supabaseServer
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', ownerId)
      .maybeSingle();

    /*
     * Said out loud, because this failing looks exactly like success: a profile
     * that cannot be read yields no hours, and no hours renders as "no times
     * available" — a business with a full diary looking closed, with nothing
     * anywhere saying why. The error was previously discarded entirely.
     */
    if (profileError) {
      requestLogger.error({ err: profileError, ownerId }, 'Could not read business profile for availability');
    }

    // Check if availability has been explicitly configured
    // Asked of the windows, not of the keys: a profile whose every day is an
    // empty array has keys and no hours.
    const hasAvailabilityConfigured = hasAnyAvailability(businessProfile?.scheduling_availability);

    // If not configured, don't show any slots - require explicit configuration
    const availabilitySettings = hasAvailabilityConfigured
      ? businessProfile?.scheduling_availability
      : null;
    /*
     * `safeTimezone`, not `|| 'UTC'`.
     *
     * The bare fallback only catches null and empty. A stored zone that Intl
     * does not recognise — a legacy IANA name, a hand-edited row, a browser
     * guess from a locale we do not carry — passed straight through it and
     * threw downstream, taking the slot list down over a display detail. This
     * is the surface a CLIENT sees, so it must degrade to a diagnosably-wrong
     * zone rather than to no times at all.
     */
    const timezone = safeTimezone(ownerPrefs?.timezone);

    /*
     * What this business publicly sells.
     *
     * Through `listBookable` rather than the `.eq('is_active').eq('status')`
     * pair this used to repeat. Both flags still have to hold — `is_active` is
     * the owner's Power toggle and `status` is draft versus published — and
     * `BOOKABLE` is the one definition of that, which three public routes were
     * restating by hand. The order comes with it, so the same catalogue no
     * longer arrives in a different sequence on each surface.
     */
    const { data: services, error: servicesError } =
      await schedulingServiceRepository.listBookable(ownerId);

    if (servicesError) {
      requestLogger.error({ err: servicesError }, 'Failed to fetch services');
      throw servicesError;
    }

    // If specific service requested, filter
    const filteredServices = serviceId
      ? services?.filter(s => s.id === serviceId)
      : services;

    // Format services for response
    // One definition of "can this business be paid", shared with the refund
    // path and the owner-facing checks. Reading `charges_enabled` inline here
    // was correct but was one of several copies, and the copies disagreed —
    // this one also let a placeholder/mock account id read as ready.
    const capability = await resolvePaymentCollectionCapability(supabaseServer, ownerId);
    const processorReady = capability.canCollect;

    /*
     * How each service may be paid over time.
     *
     * The conversion route has always sent this and THIS one never did, so an
     * instalment plan showed its split on a smart link and nowhere on the
     * business's own booking page — which is why `BookingWidget` computed an
     * `activePlan` from a field its data source never supplied, and its entire
     * plan display was unreachable. The client saw one price and was told
     * nothing about the schedule they were agreeing to.
     */
    const plansByService = await loadServicePaymentPlans(ownerId);

    const formattedServices: Service[] = (filteredServices || []).map(s => ({
      id: s.id,
      name: s.service_name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: s.price,
      currency: s.currency || 'USD',
      // The two facts the widget builds its journey from.
      is_scheduled: s.is_scheduled !== false,
      /* How far ahead the strip may run, and how soon it may start. */
      advance_booking_days: s.advance_booking_days ?? null,
      min_notice_hours: s.min_notice_hours ?? null,
      buffer_minutes: s.buffer_minutes ?? null,
      collection: s.collection ?? null,
      sale_mode: s.sale_mode ?? 'direct',
      paymentPlan: plansByService[s.id],
    }));

    // Calculate available slots (only if availability is configured)
    let slots: TimeSlot[] = [];

    /*
     * The closed days, once, for the whole window.
     *
     * Read before the loop below rather than inside it: the answer is the same
     * for every day it walks, and one request beats `daysAhead` of them. A
     * failure here leaves the list EMPTY, which publishes the ordinary weekly
     * hours — the behaviour this endpoint has always had, and the safer of the
     * two wrongs for a page whose job is to take bookings.
     */
    let timeOff: TimeOffEntry[] = [];
    if (hasAvailabilityConfigured && availabilitySettings) {
      const from = date || businessDateKey(new Date(), timezone);
      const to = date || shiftBusinessDateKey(from, daysAhead);
      const offResult = await schedulingTimeOffRepository.list(ownerId, { from, to });
      if (offResult.error) {
        requestLogger.warn(
          { err: offResult.error, ownerId },
          'Time off unreadable; publishing the ordinary weekly hours'
        );
      }
      timeOff = offResult.data ?? [];
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE DIARY IS READ BEFORE THE SLOTS ARE MADE, NOT AFTER.
     *
     * This endpoint used to lay a flat half-hourly grid across the day and
     * then mark whatever clashed. That is what leaves time standing in the
     * corner: a 45-minute service with a 15-minute gap, booked at 09:00 and
     * 11:00, has 09:45 to 11:00 genuinely free and the grid lands on 09:45 and
     * 10:30 — both clashing — so an hour the owner can see in their diary is
     * offered to nobody.
     *
     * `offeredStarts` packs each FREE stretch instead, and to do that it has to
     * know what is taken while the starts are being placed. So the read moves
     * up here, over the same window `timeOff` already uses, and is passed down.
     *
     * Both halves fail soft, as they did below: a diary we cannot read must not
     * take the booking page down. An empty list simply means nothing is known
     * to be taken, which is this endpoint's long-standing behaviour.
     * ───────────────────────────────────────────────────────────────────────
     */
    let busy: Array<{ start_time: string; end_time: string }> = [];
    if (hasAvailabilityConfigured && availabilitySettings && serviceId) {
      const from = date || businessDateKey(new Date(), timezone);
      const to = date || shiftBusinessDateKey(from, daysAhead);
      /* The whole window, edge to edge on the business's own clock. */
      const rangeStart = businessInstant(from, '00:00', timezone).toISOString();
      const rangeEnd = businessInstant(shiftBusinessDateKey(to, 1), '00:00', timezone).toISOString();

      const [meetings, externalEvents] = await Promise.all([
        busyMeetings(supabaseServer, ownerId, rangeStart, rangeEnd),
        externalBusy(ownerId, rangeStart, rangeEnd),
      ]);
      busy = [...meetings, ...externalEvents];
    }

    if (hasAvailabilityConfigured && availabilitySettings) {
      if (date && serviceId) {
        // Fetch specific date slots
        const selectedService = formattedServices.find(s => s.id === serviceId);
        /* A service with no duration has no span to offer slots for — a course,
           a product. Empty list rather than coercing the null to 0, which would
           generate slots of no length. Same rule as the owner-side route. */
        if (selectedService?.duration_minutes) {
          slots = await calculateDaySlots(
            ownerId,
            date,
            selectedService.duration_minutes,
            availabilitySettings,
            timezone,
            timeOff,
            busy,
            selectedService.buffer_minutes ?? 0
          );
        }
      } else if (serviceId) {
        // Fetch slots for next N days
        const selectedService = formattedServices.find(s => s.id === serviceId);
        /* Same as the single-date branch above: no duration, no slots. */
        if (selectedService?.duration_minutes) {
          /*
           * "The next N days" counted where the BUSINESS is. This walked the
           * server's calendar and then took the UTC day of each result, so for
           * a business behind UTC the list began on tomorrow and the owner's
           * actual today was never offered.
           */
          let dayKey = businessDateKey(new Date(), timezone);
          for (let i = 0; i < daysAhead; i++) {
            const daySlots = await calculateDaySlots(
              ownerId,
              dayKey,
              selectedService.duration_minutes,
              availabilitySettings,
              timezone,
              timeOff,
              busy,
              selectedService.buffer_minutes ?? 0
            );
            dayKey = shiftBusinessDateKey(dayKey, 1);
            slots.push(...daySlots);
          }
        }
      }
    }

    /*
     * ── WHEN, AS WELL AS WHETHER ────────────────────────────────────────────
     *
     * WHETHER is already settled: `calculateDaySlots` placed these starts out
     * of the FREE stretches of the day, so an hour the owner is busy in — an
     * appointment here, or an event on their synced calendar — never came back
     * marked available. That read used to happen down here, after a flat grid
     * had been laid across the day, which is why the diary is now read before
     * the slots are made.
     *
     * WHEN is this block's own business, and occupancy was once the only test
     * this route applied. So on the subdomain booking page a client could pick:
     *
     *   · an hour that has already gone — 09:00 this morning, at two in the
     *     afternoon, with nothing to say it had passed;
     *   · an hour inside the notice the business asked for, which the portal's
     *     reschedule route has always refused;
     *   · an hour beyond `advance_booking_days`, which this route returns to
     *     the client and then ignores itself.
     *
     * The business set all three. One of its two booking pages applied none.
     */
    if (slots.length > 0 && serviceId) {
      const selectedService = formattedServices.find(s => s.id === serviceId);
      const noticeHours = selectedService?.min_notice_hours ?? 24;
      const advanceDays = bookableDaysFor(selectedService?.advance_booking_days);
      const now = Date.now();
      const earliest = now + noticeHours * 60 * 60 * 1000;
      const latest = now + advanceDays * 24 * 60 * 60 * 1000;

      slots = slots.map(slot => {
        const startsAt = new Date(slot.start).getTime();
        const withinWindow = startsAt >= earliest && startsAt <= latest;
        /*
         * Belt and braces, over the SAME list the starts were placed from.
         * `offeredStarts` has already removed anything that clashes, gap
         * included; this cannot withhold an hour that one offered, and it
         * costs nothing to keep the occupancy test visible at the point the
         * answer is assembled.
         */
        const hasConflict = busy.length > 0 && overlapsBusy(slot.start, slot.end, busy);

        return {
          ...slot,
          available: slot.available && withinWindow && !hasConflict,
        };
      });
    }

    requestLogger.info(
      { subdomain, serviceId, slotsCount: slots.length, servicesCount: formattedServices.length },
      'Availability fetched'
    );

    /*
     * Which of the next N days the business simply does not work.
     *
     * `windowsForDate` already folds the weekly hours together with time off —
     * an `unavailable` exception closes the date, and `custom_hours` reopens it
     * — so a holiday greys out exactly like a Sunday, which is what the client
     * needs to see.
     *
     * Empty when nothing was asked for, and empty when the business has no
     * hours configured at all: that case is already reported through `reason`,
     * and greying every day would say "closed for ninety days" about a setting
     * the owner has not filled in yet.
     */
    const closedDates: string[] = [];

    if (closedDaysWindow > 0 && hasAvailabilityConfigured && availabilitySettings) {
      let cursor = businessDateKey(new Date(), timezone);

      for (let i = 0; i < closedDaysWindow; i++) {
        if (windowsForDate(availabilitySettings, cursor, timeOff).length === 0) {
          closedDates.push(cursor);
        }
        cursor = shiftBusinessDateKey(cursor, 1);
      }
    }

    return NextResponse.json({
      success: true,
      /* The days in that window with no hours at all, so a strip can grey them
         instead of letting a visitor discover it one click at a time. */
      closedDates,
      businessName: businessProfile?.company_name || subdomain,
      timezone,
      availabilityConfigured: hasAvailabilityConfigured,
      // Whether a card can actually be charged. Without it the widget would
      // show a payment step for a business that has not connected Stripe.
      processorReady,
      services: formattedServices,
      slots: slots.filter(s => s.available), // Only return available slots
      totalSlots: slots.length,
      availableSlots: slots.filter(s => s.available).length
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Availability fetch failed');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch availability' },
      { status: 500 }
    );
  }
}

// Helper to calculate time slots for a specific day
async function calculateDaySlots(
  _ownerId: string,
  dateStr: string,
  durationMinutes: number,
  /** Raw JSON from the profile; shapes are normalised by `windowsForDay`. */
  availabilitySettings: unknown,
  /**
   * The BUSINESS's zone. The opening hours below are wall clocks the owner
   * typed ("09:00"), and the slots leave here as instants. Without this the
   * conversion between the two ran in the SERVER's zone — UTC on Vercel — so a
   * business open 09:00 in New York published its slots at 09:00 UTC, which is
   * 05:00 in its own reception. Every client saw a different wrong hour.
   */
  timezone: string,
  /**
   * The business's closed days and short days, already fetched for the whole
   * window the caller is asking about.
   *
   * Passed in rather than queried here: this function is called once per day in
   * a loop up to `daysAhead` long, and reading the table inside it would be one
   * request per day for an answer that does not change between them.
   */
  timeOff: TimeOffEntry[],
  /**
   * Everything already in the diary across the whole window — appointments and
   * synced calendar events together, read once by the caller.
   *
   * Here rather than fetched inside, for the same reason as `timeOff`: this is
   * called once per day in a loop up to `daysAhead` long.
   */
  busy: Array<{ start_time: string; end_time: string }>,
  /** The service's own gap, kept after each appointment. */
  bufferMinutes: number
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = [];
  /*
   * The weekday is derived inside `windowsForDate` now — by the same noon-UTC
   * trick this spelled out, kept in one place as `weekdayNameFor` so a fourth
   * call site cannot get it wrong. (`new Date('2026-09-21')` is midnight UTC,
   * and reading its weekday in any zone behind UTC gives the day before.)
   */

  // The editor writes an array of windows per day. This asked for `.enabled` on
  // that array, got `undefined`, and returned no slots for every day of the
  // week — the same failure the public booking page had, with a different
  // guess about the shape. Both now ask one normaliser instead.
  /*
   * The weekday's hours, with this DATE's time off applied.
   *
   * Was `windowsForDay(availabilitySettings, dayOfWeek)` — the weekly pattern
   * and nothing else, which is why a business closed for a holiday went on
   * publishing slots for it. `windowsForDate` reads the same pattern and then
   * subtracts the closed days and clamps the short ones.
   */
  const windows = windowsForDate(availabilitySettings, dateStr, timeOff);
  if (windows.length === 0) {
    return slots;
  }

  /*
   * EVERY window, not just the first.
   *
   * This read `windows[0]`, and said so — a business with a split day got its
   * morning here and its full day on the sibling booking page. Same business,
   * same date, two different sets of hours depending on which address the
   * client arrived at, with the afternoon simply missing from one of them.
   *
   * The scalar walk below is per-window, so resuming after the midday gap is
   * the loop it already was, run again from the second window's opening time.
   */
  /*
   * ─────────────────────────────────────────────────────────────────────────
   * THE SAME TIMES THE OTHER PUBLIC PAGES OFFER, FROM THE SAME ARITHMETIC.
   *
   * This walked a flat half-hour — `currentMin += 30` — which was the fourth
   * copy of that literal in the product and the one on its busiest door. It
   * had nothing to do with the service: a 50-minute appointment was offered at
   * 09:00 AND 09:30, two times that cannot both be taken, and a 20-minute one
   * got two starts an hour instead of three.
   *
   * `slotStepMinutes` spaces the starts by the appointment plus the gap kept
   * after it, so a day of them tiles exactly, and `offeredStarts` packs each
   * FREE stretch from its own beginning so an opening that holds the
   * appointment is never left unoffered.
   *
   * THE FLAT GRID IS STILL WALKED ALONGSIDE, and both lists are returned: this
   * endpoint answers with every candidate and an `available` flag so the widget
   * can draw a taken hour greyed rather than silently missing. Only membership
   * of the packed list makes one bookable.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const toMins = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
  };
  const toClock = (at: number) =>
    `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;

  const step = slotStepMinutes(durationMinutes, bufferMinutes);
  /* What is taken on THIS day, on the business's clock, widened by the gap —
     the same conversion the sibling pages run. */
  const busySpans = busySpansOn({ date: dateStr, timezone, rows: busy, bufferMinutes });

  for (const daySettings of windows) {
    const windowStartMins = toMins(daySettings.start);
    const windowEndMins = toMins(daySettings.end);

    const packed = offeredStarts({
      windowStart: windowStartMins,
      windowEnd: windowEndMins,
      durationMinutes,
      stepMinutes: step,
      busy: busySpans,
    });
    const bookable = new Set(packed);

    const grid: number[] = [];
    for (let at = windowStartMins; at + durationMinutes <= windowEndMins; at += step) {
      grid.push(at);
    }

    for (const at of Array.from(new Set([...grid, ...packed])).sort((a, b) => a - b)) {
      /* The wall clock the owner typed, as the instant the business means by
         it. Never `setHours`, which would resolve in the server's zone. */
      const slotStart = businessInstant(dateStr, toClock(at), timezone);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        /* The caller then ANDs this with the notice and advance windows, which
           are facts about when rather than about whether. */
        available: bookable.has(at)
      });
    }
  }

  return slots;
}
