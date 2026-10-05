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

    // Look up business profile by userCode
    // Note: timezone column doesn't exist in business_profiles, use 'UTC' as default
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
      // How this service may be paid over time.
      //
      // The config endpoint beside this one already returned it, and this one
      // did not — and this is the one the booking page reads its services from.
      // So a service sold in instalments was presented on a smart link as a
      // single price, and the client agreed to something other than what the
      // business had configured.
      paymentPlan: plansByService[s.id]
    }));

    // Default timezone (column doesn't exist in business_profiles)
    const timezone = 'UTC';

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
      daysAhead
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
  daysAhead: number
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

  const { data: existingBookings } = await supabaseServer
    .from('scheduling_bookings')
    .select('start_time, end_time')
    .eq('user_id', userId)
    .neq('status', 'cancelled')
    .gte('start_time', startDate)
    .lt('start_time', endDate.toISOString());

  // Generate slots for each day
  for (let i = 0; i < daysAhead; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + i);

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
    const dateKey = [
      currentDate.getFullYear(),
      String(currentDate.getMonth() + 1).padStart(2, '0'),
      String(currentDate.getDate()).padStart(2, '0'),
    ].join('-');

    // A day is a LIST of windows — a morning and an evening are two, with a gap
    // the client cannot book. Reading only the first would quietly hide the
    // second; reading `.start` off the list, which is what this did, hid both.
    for (const window of windowsForDate(availability, dateKey, timeOff)) {
      const [startHour, startMin] = window.start.split(':').map(Number);
      const [endHour, endMin] = window.end.split(':').map(Number);

      // Generate time slots (30-minute intervals)
      const slotInterval = 30; // minutes
      const blockMinutes = durationMinutes ?? slotInterval;
      let currentTime = new Date(currentDate);
      currentTime.setHours(startHour, startMin, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(endHour, endMin, 0, 0);

      while (currentTime.getTime() + blockMinutes * 60 * 1000 <= dayEnd.getTime()) {
        const slotEnd = new Date(currentTime.getTime() + blockMinutes * 60 * 1000);

        // Check if slot is in the past
        const isPast = currentTime < now;

        // Check for conflicts with existing bookings
        const hasConflict = (existingBookings || []).some(booking => {
          const bookingStart = new Date(booking.start_time);
          const bookingEnd = new Date(booking.end_time);
          return (
            (currentTime >= bookingStart && currentTime < bookingEnd) ||
            (slotEnd > bookingStart && slotEnd <= bookingEnd) ||
            (currentTime <= bookingStart && slotEnd >= bookingEnd)
          );
        });

        slots.push({
          start: currentTime.toISOString(),
          end: slotEnd.toISOString(),
          available: !isPast && !hasConflict
        });

        // Move to next slot
        currentTime = new Date(currentTime.getTime() + slotInterval * 60 * 1000);
      }
    }
  }

  return slots;
}
