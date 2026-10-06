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
import { SLOT_HOLDING_STATUSES } from '@/lib/business-os/bookingStatus';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { createLogger } from '@/lib/logger';
import { windowsForDate, hasAnyAvailability, type TimeOffEntry } from '@/lib/scheduling/availabilityWindows';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { safeTimezone, businessInstant, businessDateKey, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';

const logger = createLogger({ module: 'WebsiteBookingAvailabilityAPI' });

// Note: No default hours - availability must be explicitly configured
// This prevents showing booking slots before the business owner sets up their schedule

interface TimeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  available: boolean;
}

interface Service {
  is_scheduled?: boolean;
  collection?: 'online' | 'invoice' | null;
  /** Bought outright, or quoted first. The booking modal's resolver reads it. */
  sale_mode?: 'direct' | 'proposal';
  /** How this service may be paid over time, where the business offers one. */
  paymentPlan?: ServicePaymentPlan;
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
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

    if (hasAvailabilityConfigured && availabilitySettings) {
      if (date && serviceId) {
        // Fetch specific date slots
        const selectedService = formattedServices.find(s => s.id === serviceId);
        if (selectedService) {
          slots = await calculateDaySlots(
            ownerId,
            date,
            selectedService.duration_minutes,
            availabilitySettings,
            timezone,
            timeOff
          );
        }
      } else if (serviceId) {
        // Fetch slots for next N days
        const selectedService = formattedServices.find(s => s.id === serviceId);
        if (selectedService) {
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
              timeOff
            );
            dayKey = shiftBusinessDateKey(dayKey, 1);
            slots.push(...daySlots);
          }
        }
      }
    }

    // Fetch existing bookings to mark unavailable slots
    if (slots.length > 0 && serviceId) {
      const startDate = slots[0].start;
      const endDate = slots[slots.length - 1].end;

      const { data: bookings } = await supabaseServer
        .from('scheduling_bookings')
        .select('start_time, end_time')
        .eq('user_id', ownerId)
        .gte('start_time', startDate)
        .lte('end_time', endDate)
        // A booking that will not happen does not hold its slot — that is
      // `cancelled` AND `no_show`, which this asked as "not cancelled" and so
      // kept a no-show's time shut. See `SLOT_HOLDING_STATUSES`.
      .in('status', SLOT_HOLDING_STATUSES);

      // Mark overlapping slots as unavailable
      if (bookings && bookings.length > 0) {
        slots = slots.map(slot => {
          const slotStart = new Date(slot.start).getTime();
          const slotEnd = new Date(slot.end).getTime();

          const hasConflict = bookings.some(booking => {
            const bookingStart = new Date(booking.start_time).getTime();
            const bookingEnd = new Date(booking.end_time).getTime();
            return (slotStart < bookingEnd && slotEnd > bookingStart);
          });

          return {
            ...slot,
            available: !hasConflict
          };
        });
      }
    }

    requestLogger.info(
      { subdomain, serviceId, slotsCount: slots.length, servicesCount: formattedServices.length },
      'Availability fetched'
    );

    return NextResponse.json({
      success: true,
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
  timeOff: TimeOffEntry[]
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

  // First window only, for now: the loop below walks hours and minutes as
  // scalars rather than as instants, so it cannot resume after a gap without
  // being rewritten. A business with a split day gets its morning here and its
  // full set on the public booking page. Named rather than silent, because a
  // missing afternoon looks identical to a closed one.
  const daySettings = windows[0];

  const [startHour, startMin] = daySettings.start.split(':').map(Number);
  const [endHour, endMin] = daySettings.end.split(':').map(Number);

  let currentHour = startHour;
  let currentMin = startMin;

  while (currentHour < endHour || (currentHour === endHour && currentMin + durationMinutes <= endMin)) {
    /* The wall clock the owner typed, as the instant the business means by it. */
    const slotStart = businessInstant(
      dateStr,
      `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`,
      timezone
    );
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

    /*
     * Whether the slot ends after closing, compared as wall-clock minutes
     * rather than by reading `slotEnd`'s hours — those would come back in the
     * server's zone and let a slot run past closing time.
     */
    const endMins = currentHour * 60 + currentMin + durationMinutes;
    if (endMins <= endHour * 60 + endMin) {
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: true
      });
    }

    // Move to next slot (30-minute intervals)
    currentMin += 30;
    if (currentMin >= 60) {
      currentHour += 1;
      currentMin -= 60;
    }
  }

  return slots;
}
