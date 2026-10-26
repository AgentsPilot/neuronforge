/**
 * Public Website Scheduling Availability API
 * GET - Get available time slots for a service on a specific date
 *
 * This endpoint is used by the ProcessFlowSection on public websites.
 * It doesn't require user authentication - it looks up the website owner's
 * availability and returns available booking slots.
 */

import { NextRequest, NextResponse } from 'next/server';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { getUser } from '@/lib/auth';
import { resolvePublicOwner } from '@/lib/business-os/publicOwner';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { schedulingServiceRepository, schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { externalCalendarEventRepository } from '@/lib/repositories/ExternalCalendarEventRepository';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { windowsForDate } from '@/lib/scheduling/availabilityWindows';
import { generateTimeSlots, type TimeSlot } from '@/lib/scheduling/availableSlots';
import { safeTimezone, businessClock, businessDateKey } from '@/lib/scheduling/businessTime';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteAvailabilityAPI' });

/*
 * An address is optional; a BUSINESS is not.
 *
 * `user_code` was missing from this schema while `ProcessFlowSection` has always
 * sent it (`&user_code=`), so on a smart link the code was parsed away, the
 * subdomain branch was skipped, and resolution fell through to the signed-in
 * owner — which an anonymous client is not. The calendar answered 401 on the one
 * surface that cannot possibly have a session.
 *
 * Same three ways in as `website/booking/availability` and `payment-intent`:
 * subdomain, user code, or the owner in a preview.
 */
const AvailabilityQuerySchema = z.object({
  subdomain: z.string().optional(),
  user_code: z.string().optional(),
  service_id: z.string().uuid('Invalid service ID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
});

interface WeeklyAvailability {
  sunday: TimeSlot[];
  monday: TimeSlot[];
  tuesday: TimeSlot[];
  wednesday: TimeSlot[];
  thursday: TimeSlot[];
  friday: TimeSlot[];
  saturday: TimeSlot[];
}

interface AvailableSlot {
  start_time: string; // ISO datetime
  end_time: string;   // ISO datetime
  display_time: string; // Formatted for display
}

// Days of week mapping
const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/*
 * `generateTimeSlots` moved to `lib/scheduling/availableSlots` so the portal's
 * token route can answer the same question identically. See that file for why:
 * a client rescheduling their own booking was being asked to sign in as the
 * business, and got an empty diary instead of an error.
 */

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const subdomainParam = searchParams.get('subdomain');
    const userCodeParam = searchParams.get('user_code');
    const queryParams = {
      subdomain: subdomainParam && subdomainParam.trim() ? subdomainParam.trim() : undefined,
      user_code: userCodeParam && userCodeParam.trim() ? userCodeParam.trim() : undefined,
      service_id: searchParams.get('service_id') || '',
      date: searchParams.get('date') || ''
    };

    // Validate input
    const validationResult = AvailabilityQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid parameters', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { subdomain, user_code: userCode, service_id, date } = validationResult.data;

    let ownerId: string;

    // Track hidden service names for validation (only used for public access)
    let hiddenServiceNames: Set<string> = new Set();

    /*
     * Subdomain, user code, or the signed-in owner — the same three, in the same
     * order, as `website/booking/availability` and `payment-intent`.
     *
     * Through `resolvePublicOwner` rather than a fourth hand-rolled lookup: a
     * smart link carries a user code and no subdomain, and this route used to
     * skip straight past it to the authenticated branch, so a public client got
     * 401 for a calendar they were entitled to see.
     */
    let pageId: string | null = null;

    if (subdomain || userCode) {
      const owner = await resolvePublicOwner({ subdomain, userCode });

      if (!owner) {
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }

      ownerId = owner.userId;
      pageId = owner.pageId ?? null;

      /*
       * Hidden services come off the page's own services block, so this only
       * applies where a PAGE was resolved.
       *
       * A smart link resolves an owner and NO page — it does its own narrowing
       * through `servicesForLink` — so the absence of one is normal here, not a
       * failure. Guarded rather than left to throw into the catch, which would
       * log a warning on every smart-link request.
       */
      if (pageId) {
        try {
          const blockRepo = new WebsiteBlockRepository(supabaseServer);
          const blocksResult = await blockRepo.findByPageId(pageId);
          if (blocksResult.data) {
            const servicesBlock = blocksResult.data.find(b => b.block_type === 'services');
            if (servicesBlock) {
              const savedServices = (servicesBlock.content as Record<string, unknown>)?.services as Array<{ name: string; hidden?: boolean }> | undefined;
              if (savedServices && Array.isArray(savedServices)) {
                savedServices.forEach(s => {
                  if (s.name && s.hidden === true) {
                    hiddenServiceNames.add(s.name);
                  }
                });
              }
            }
          }
        } catch (err) {
          requestLogger.warn({ err }, 'Failed to fetch hidden service flags');
        }
      }
    } else {
      /*
       * ───────────────────────────────────────────────────────────────────────
       * NO SUBDOMAIN AND NO USER CODE MEANS "THE SIGNED-IN BUSINESS", and that
       * is a narrow thing to mean.
       *
       * This fallback exists for the owner's own screens, which legitimately
       * ask "what are MY free hours" with no identifier. It is also a trap for
       * anything public, and it caught the portal's reschedule panel: a client
       * following their own booking link asked here with a service id and a
       * date, was answered a bare 401, and the panel rendered that as an empty
       * diary. The owner testing it was signed in, so it worked for them every
       * time and the bug read as intermittent for months.
       *
       * The behaviour is unchanged for the owner. What changed is that the
       * refusal now SAYS WHICH QUESTION IT COULD NOT ANSWER, so the next
       * caller that arrives without an identifier learns that in one glance
       * instead of from a user report. A public caller wants
       * `?subdomain=` or `?user_code=`; a client acting on their own booking
       * wants the token route, which holds their credential.
       * ───────────────────────────────────────────────────────────────────────
       */
      const user = await getUser();
      if (!user) {
        requestLogger.warn(
          { service_id, date },
          'Availability asked with no subdomain, no user code and no session: nothing identifies the business'
        );
        return NextResponse.json(
          {
            success: false,
            code: 'no_business_identified',
            error:
              'This endpoint needs a subdomain or a user_code to know whose hours to return, '
              + 'unless the business itself is signed in.',
          },
          { status: 401 }
        );
      }
      ownerId = user.id;
    }

    // Get service details (for duration)
    const { data: service, error: serviceError } = await schedulingServiceRepository.findById(service_id, ownerId);

    if (serviceError || !service) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // Both flags: the Power toggle and draft/published are different questions,
    // and a service that is either switched off or unpublished is not bookable.
    if (!service.is_active || service.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Service is not available' },
        { status: 400 }
      );
    }

    // Check if service is hidden on website (only for public access)
    if (hiddenServiceNames.has(service.service_name)) {
      return NextResponse.json(
        { success: false, error: 'Service is not available' },
        { status: 400 }
      );
    }

    // Get business profile with availability
    const { data: profile, error: profileError } = await businessProfileRepository.findByUserId(ownerId);

    if (profileError || !profile || !profile.scheduling_availability) {
      return NextResponse.json({
        success: true,
        date,
        service_id,
        slots: [],
        message: 'No availability configured',
        /*
         * A code, because the message is English prose and the caller has to
         * branch on this.
         *
         * "No hours have been set at all" and "nothing free on this particular
         * day" are the same empty list to a client and completely different
         * things to the business: the first is a setting they have not filled
         * in, and it is the one gap that stops a website being published. The
         * editor's preview uses this to say so and offer the settings, rather
         * than showing the client-facing "no times for this date" to the person
         * who can fix it.
         */
        reason: 'no_availability_configured'
      });
    }

    // Handle both string and object formats (Supabase JSONB can be returned as string in some cases)
    let availability: WeeklyAvailability;
    if (typeof profile.scheduling_availability === 'string') {
      try {
        availability = JSON.parse(profile.scheduling_availability);
      } catch {
        return NextResponse.json({
          success: true,
          date,
          service_id,
          slots: [],
          message: 'Invalid availability format'
        });
      }
    } else {
      // scheduling_availability is typed as Record<string, {start,end}[]>; the
      // local WeeklyAvailability is a fixed-key interface, so TS needs the
      // double assertion to narrow (interfaces get no implicit index signature).
      availability = profile.scheduling_availability as unknown as WeeklyAvailability;
    }
    /*
     * The business's zone, from the row that actually holds it.
     *
     * This was hardcoded to 'UTC' behind a TODO asking for a
     * `business_profiles.timezone` column — which has never existed, and never
     * will: the settings page writes `user_preferences.timezone`, and that is
     * the platform's single authority for the clock. Until now every slot this
     * route offered a CLIENT was computed against UTC, so a business anywhere
     * else published, and accepted reschedules into, the wrong hours.
     */
    const { data: ownerPrefs } = await supabaseServer
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', ownerId)
      .maybeSingle();
    const timezone = safeTimezone(ownerPrefs?.timezone);

    // Get day of week for the requested date using UTC to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dayOfWeek = DAYS_OF_WEEK[dateObj.getUTCDay()];

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE CLOSED DAYS, WHICH THIS ROUTE DID NOT READ.
     *
     * It resolved hours from the weekday alone, so a business closed for a
     * holiday went on offering that day's slots here — and this is the route
     * the CLIENT's reschedule page asks. A client could therefore move their
     * appointment onto a day the business was shut, which is now refused at the
     * write: offering a time that is then refused is a dead end, so the slots
     * have to agree with the rule.
     *
     * `windowsForDate` is that rule, and the same function the public booking
     * page and the smart link already use. An unreadable list leaves the
     * ordinary hours published — the conservative choice for a page whose job
     * is to take bookings, and the same one its siblings make.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { data: timeOff, error: timeOffError } = await schedulingTimeOffRepository.list(ownerId, {
      from: date,
      to: date,
    });

    if (timeOffError) {
      requestLogger.warn(
        { err: timeOffError, ownerId, date },
        'Time off unreadable; publishing the ordinary hours'
      );
    }

    const dayAvailability = windowsForDate(availability, date, timeOff ?? []);

    requestLogger.info(
      { date, dayOfWeek, dayAvailability, allAvailability: availability },
      'Processing availability request'
    );

    if (dayAvailability.length === 0) {
      return NextResponse.json({
        success: true,
        date,
        service_id,
        slots: [],
        message: `No availability on ${dayOfWeek}`
      });
    }

    // Get existing bookings for this date
    const dayStart = date + 'T00:00:00.000Z';
    const dayEnd = date + 'T23:59:59.999Z';

    /*
     * All non-cancelled bookings block their slot — INCLUDING `pending`.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This listed three states on the reasoning that the enum was exhaustive
     * ("so listing the three non-cancelled states is equivalent to the prior
     * `.neq('status', 'cancelled')`"). It was not exhaustive: the public booking
     * route writes `pending` for a service awaiting payment or awaiting a quote,
     * and that value was in neither the type nor this list.
     *
     * So a held slot looked FREE. A client who booked a paid service and had not
     * yet paid, or who asked for a quote, could have their time sold to someone
     * else — and the owner would find two people booked for one slot with
     * nothing in the logs to explain it.
     *
     * `no_show` is NOT here: the owner has decided that meeting is not
     * happening, so its time goes back on sale.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * NOW ASKED OF THE APPOINTMENTS THEMSELVES
     *
     * `busyMeetings` is the one answer to "does this still occupy its slot",
     * shared with the conflict checks that each used to ask it their own way.
     * Two things improve by routing through it.
     *
     * The `limit: 500` is gone. It was a silent cap on a correctness question:
     * a busy diary's 501st appointment read as free time.
     *
     * And the window is now an OVERLAP rather than a containment — the same
     * semantics the external-calendar read below is commented as getting right,
     * and which this did not. An appointment starting before `dayStart` and
     * running into the morning was invisible, so its hours were back on sale.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const existingBookings = await busyMeetings(supabaseServer, ownerId, dayStart, dayEnd);

    // Get external calendar events overlapping this day via the repository. getBusySlots uses
    // proper overlap semantics (start < dayEnd AND end > dayStart), so multi-hour/all-day events
    // spanning into the day are correctly treated as busy. Every synced event is a busy block.
    const { data: busySlots } = await externalCalendarEventRepository.getBusySlots(ownerId, dayStart, dayEnd);
    const externalEvents = (busySlots || []).map(slot => ({ start_time: slot.start, end_time: slot.end }));

    // `duration_minutes` is genuinely nullable: 20260901_service_shape.sql drops the
    // NOT NULL so a service can exist without being booked against a span (courses,
    // products). A service with no duration has no time slots to offer, so answer with
    // an empty list rather than coercing to 0 and generating meaningless slots.
    // Surfaced by routing through schedulingServiceRepository - the previous raw query
    // returned an untyped row, so the null was never visible to the compiler.
    if (!service.duration_minutes) {
      return NextResponse.json({
        success: true,
        date,
        service_id,
        slots: [],
        message: 'Service has no duration configured'
      });
    }

    // Generate available slots
    const slots = generateTimeSlots(
      date,
      dayAvailability,
      service.duration_minutes,
      existingBookings || [],
      externalEvents,
      timezone,
      /* The gap between appointments, read at last — see `generateTimeSlots`.
         The owner's own grid applies the same rule, so the two agree. */
      service.buffer_minutes ?? 0
    );

    requestLogger.info(
      {
        subdomain,
        serviceId: service_id,
        date,
        dayOfWeek,
        dayAvailability,
        serviceDuration: service.duration_minutes,
        slotsCount: slots.length,
        slots: slots.slice(0, 3) // Log first 3 slots for debugging
      },
      'Generated availability slots'
    );

    return NextResponse.json({
      success: true,
      date,
      service_id,
      service_name: service.service_name,
      duration_minutes: service.duration_minutes,
      timezone,
      slots
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get availability');
    return NextResponse.json(
      { success: false, error: 'Failed to get availability' },
      { status: 500 }
    );
  }
}
