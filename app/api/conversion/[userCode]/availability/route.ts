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
import { createLogger } from '@/lib/logger';
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
  duration_minutes: number;
  price: number | null;
  currency: string;
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
    const hasAvailabilityConfigured = !!(
      businessProfile.scheduling_availability &&
      typeof businessProfile.scheduling_availability === 'object' &&
      Object.keys(businessProfile.scheduling_availability).length > 0
    );

    // Fetch active services
    const { data: services, error: servicesError } = await supabaseServer
      .from('scheduling_services')
      .select('id, service_name, description, duration_minutes, price, currency')
      .eq('user_id', ownerId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (servicesError) {
      requestLogger.error({ err: servicesError }, 'Failed to fetch services');
      throw servicesError;
    }

    // Format services for response
    const formattedServices: Service[] = (services || []).map(s => ({
      id: s.id,
      name: s.service_name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: s.price,
      currency: s.currency || 'USD'
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
  durationMinutes: number,
  availability: Record<string, { start: string; end: string }>,
  timezone: string,
  startDate: string,
  daysAhead: number
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = [];
  const now = new Date();

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

  // Day name mapping
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Generate slots for each day
  for (let i = 0; i < daysAhead; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + i);

    const dayOfWeek = dayNames[currentDate.getDay()];
    const dayAvailability = availability[dayOfWeek];

    if (!dayAvailability || !dayAvailability.start || !dayAvailability.end) {
      continue;
    }

    // Parse availability times
    const [startHour, startMin] = dayAvailability.start.split(':').map(Number);
    const [endHour, endMin] = dayAvailability.end.split(':').map(Number);

    // Generate time slots (30-minute intervals)
    const slotInterval = 30; // minutes
    let currentTime = new Date(currentDate);
    currentTime.setHours(startHour, startMin, 0, 0);

    const dayEnd = new Date(currentDate);
    dayEnd.setHours(endHour, endMin, 0, 0);

    while (currentTime.getTime() + durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
      const slotEnd = new Date(currentTime.getTime() + durationMinutes * 60 * 1000);

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

  return slots;
}
