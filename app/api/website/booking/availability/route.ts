/**
 * Website Booking Availability API
 * GET - Fetch available time slots for public website booking widget
 *
 * This endpoint:
 * 1. Looks up the business by subdomain
 * 2. Fetches available services from Scheduling capability
 * 3. Returns available time slots based on business availability settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { createLogger } from '@/lib/logger';
import { windowsForDay, hasAnyAvailability } from '@/lib/scheduling/availabilityWindows';
import { supabaseServer } from '@/lib/supabaseServer';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

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
    const serviceId = searchParams.get('service_id');
    const date = searchParams.get('date'); // YYYY-MM-DD format
    const daysAhead = parseInt(searchParams.get('days') || '7', 10);

    if (!subdomain) {
      return NextResponse.json(
        { success: false, error: 'Subdomain is required' },
        { status: 400 }
      );
    }

    // Look up website and owner
    const { data: websitePage, error: pageError } = await supabaseServer
      .from('website_pages')
      .select('user_id')
      .eq('subdomain', subdomain)
      .single();

    if (pageError || !websitePage) {
      requestLogger.warn({ subdomain }, 'Website not found');
      return NextResponse.json(
        { success: false, error: 'Website not found' },
        { status: 404 }
      );
    }

    const ownerId = websitePage.user_id;

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
    const timezone = ownerPrefs?.timezone || 'UTC';

    // Fetch active services
    const { data: services, error: servicesError } = await supabaseServer
      .from('scheduling_services')
      // Both flags. This route checked only `is_active`, the exact mirror of
      // the conversion routes checking only `status` — so a draft service was
      // bookable on the website and a deactivated one on the smart links.
      .select('id, service_name, description, duration_minutes, price, currency, is_active, status, is_scheduled, collection, sale_mode')
      .eq('user_id', ownerId)
      .eq('is_active', true)
      .eq('status', 'active')
      .order('service_name');

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
    }));

    // Calculate available slots (only if availability is configured)
    let slots: TimeSlot[] = [];

    if (hasAvailabilityConfigured && availabilitySettings) {
      if (date && serviceId) {
        // Fetch specific date slots
        const selectedService = formattedServices.find(s => s.id === serviceId);
        if (selectedService) {
          slots = await calculateDaySlots(
            ownerId,
            date,
            selectedService.duration_minutes,
            availabilitySettings
          );
        }
      } else if (serviceId) {
        // Fetch slots for next N days
        const selectedService = formattedServices.find(s => s.id === serviceId);
        if (selectedService) {
          const today = new Date();
          for (let i = 0; i < daysAhead; i++) {
            const dayDate = new Date(today);
            dayDate.setDate(today.getDate() + i);
            const dateStr = dayDate.toISOString().split('T')[0];
            const daySlots = await calculateDaySlots(
              ownerId,
              dateStr,
              selectedService.duration_minutes,
              availabilitySettings
            );
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
        .neq('status', 'cancelled');

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
  availabilitySettings: unknown
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = [];
  const date = new Date(dateStr);
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  // The editor writes an array of windows per day. This asked for `.enabled` on
  // that array, got `undefined`, and returned no slots for every day of the
  // week — the same failure the public booking page had, with a different
  // guess about the shape. Both now ask one normaliser instead.
  const windows = windowsForDay(availabilitySettings, dayOfWeek);
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
    const slotStart = new Date(date);
    slotStart.setHours(currentHour, currentMin, 0, 0);

    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

    // Don't add slots that end after business hours
    if (slotEnd.getHours() < endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() <= endMin)) {
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
