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
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'WebsiteBookingAvailabilityAPI' });

// Default business hours if not configured
const DEFAULT_HOURS = {
  monday: { start: '09:00', end: '17:00', enabled: true },
  tuesday: { start: '09:00', end: '17:00', enabled: true },
  wednesday: { start: '09:00', end: '17:00', enabled: true },
  thursday: { start: '09:00', end: '17:00', enabled: true },
  friday: { start: '09:00', end: '17:00', enabled: true },
  saturday: { start: '09:00', end: '13:00', enabled: false },
  sunday: { start: '09:00', end: '13:00', enabled: false }
};

interface TimeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  available: boolean;
}

interface Service {
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
    const { data: businessProfile } = await supabaseServer
      .from('business_profiles')
      .select('scheduling_availability, company_name, timezone')
      .eq('user_id', ownerId)
      .single();

    const availabilitySettings = businessProfile?.scheduling_availability || DEFAULT_HOURS;
    const timezone = businessProfile?.timezone || 'UTC';

    // Fetch active services
    const { data: services, error: servicesError } = await supabaseServer
      .from('scheduling_services')
      .select('id, service_name, description, duration_minutes, price, currency, is_active')
      .eq('user_id', ownerId)
      .eq('is_active', true)
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
    const formattedServices: Service[] = (filteredServices || []).map(s => ({
      id: s.id,
      name: s.service_name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: s.price,
      currency: s.currency || 'USD'
    }));

    // Calculate available slots
    let slots: TimeSlot[] = [];

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
  availabilitySettings: Record<string, { start: string; end: string; enabled: boolean }>
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = [];
  const date = new Date(dateStr);
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  const daySettings = availabilitySettings[dayOfWeek];
  if (!daySettings?.enabled) {
    return slots;
  }

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
