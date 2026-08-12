/**
 * Public Website Scheduling Availability API
 * GET - Get available time slots for a service on a specific date
 *
 * This endpoint is used by the ProcessFlowSection on public websites.
 * It doesn't require user authentication - it looks up the website owner's
 * availability and returns available booking slots.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { schedulingServiceRepository, schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { externalCalendarEventRepository } from '@/lib/repositories/ExternalCalendarEventRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteAvailabilityAPI' });

// Subdomain is optional - if not provided, authenticated user is used
const AvailabilityQuerySchema = z.object({
  subdomain: z.string().optional(),
  service_id: z.string().uuid('Invalid service ID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
});

interface TimeSlot {
  start: string; // HH:mm
  end: string;   // HH:mm
}

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

/**
 * Generate time slots for a given day based on availability and service duration
 *
 * Note: Availability times (e.g., "09:00" to "17:00") are in the business owner's timezone.
 * We construct slot times as if they're in UTC for simplicity, then display them
 * with the correct timezone formatting.
 */
function generateTimeSlots(
  date: string,
  dayAvailability: TimeSlot[],
  durationMinutes: number,
  existingBookings: { start_time: string; end_time: string }[],
  externalEvents: { start_time: string; end_time: string }[],
  _timezone: string = 'UTC'
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  // Availability times (e.g., "14:00" to "17:00") are in the business owner's local time.
  // We generate slots as "date + time" strings that represent wall-clock time,
  // NOT UTC. The client displays these directly without timezone conversion.

  const now = new Date();
  const nowHours = now.getHours();
  const nowMinutes = now.getMinutes();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = date === todayStr;

  for (const window of dayAvailability) {
    // Parse window times (HH:mm format)
    const [startHour, startMin] = window.start.split(':').map(Number);
    const [endHour, endMin] = window.end.split(':').map(Number);

    // Convert to minutes for easier math
    const windowStartMins = startHour * 60 + startMin;
    const windowEndMins = endHour * 60 + endMin;

    // Generate slots in this window
    let slotStartMins = windowStartMins;

    while (slotStartMins + durationMinutes <= windowEndMins) {
      const slotEndMins = slotStartMins + durationMinutes;

      const slotHour = Math.floor(slotStartMins / 60);
      const slotMinute = slotStartMins % 60;
      const endSlotHour = Math.floor(slotEndMins / 60);
      const endSlotMinute = slotEndMins % 60;

      // Format as HH:mm
      const slotStartStr = `${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`;
      const slotEndStr = `${String(endSlotHour).padStart(2, '0')}:${String(endSlotMinute).padStart(2, '0')}`;

      // Create datetime strings (these are wall-clock time, not UTC)
      const startDateTime = `${date}T${slotStartStr}:00`;
      const endDateTime = `${date}T${slotEndStr}:00`;

      // Check if slot is in the past (for today only)
      const isPastSlot = isToday && (slotHour < nowHours || (slotHour === nowHours && slotMinute <= nowMinutes));

      // Check if slot overlaps with any existing booking
      // Note: bookings are stored with timezone info, need to compare carefully
      const overlapsBooking = existingBookings.some(booking => {
        // Extract just the time portion for comparison (simplified)
        const bookingStart = new Date(booking.start_time);
        const bookingEnd = new Date(booking.end_time);
        const bookingStartMins = bookingStart.getHours() * 60 + bookingStart.getMinutes();
        const bookingEndMins = bookingEnd.getHours() * 60 + bookingEnd.getMinutes();
        return slotStartMins < bookingEndMins && slotEndMins > bookingStartMins;
      });

      // Check if slot overlaps with any external calendar event
      const overlapsExternal = externalEvents.some(event => {
        const eventStart = new Date(event.start_time);
        const eventEnd = new Date(event.end_time);
        const eventStartMins = eventStart.getHours() * 60 + eventStart.getMinutes();
        const eventEndMins = eventEnd.getHours() * 60 + eventEnd.getMinutes();
        return slotStartMins < eventEndMins && slotEndMins > eventStartMins;
      });

      // Only add slot if it doesn't overlap with anything and is in the future
      if (!overlapsBooking && !overlapsExternal && !isPastSlot) {
        // Format display time (12-hour format)
        const displayHour = slotHour % 12 || 12;
        const amPm = slotHour >= 12 ? 'PM' : 'AM';

        slots.push({
          start_time: startDateTime,
          end_time: endDateTime,
          display_time: `${displayHour}:${String(slotMinute).padStart(2, '0')} ${amPm}`
        });
      }

      // Move to next slot (30-minute increments)
      slotStartMins += 30;
    }
  }

  return slots;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const subdomainParam = searchParams.get('subdomain');
    const queryParams = {
      subdomain: subdomainParam && subdomainParam.trim() ? subdomainParam.trim() : undefined,
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

    const { subdomain, service_id, date } = validationResult.data;

    let ownerId: string;

    // Track hidden service names for validation (only used for public access)
    let hiddenServiceNames: Set<string> = new Set();

    // If subdomain is provided, look up website owner (public access)
    // Otherwise, use authenticated user (preview mode)
    if (subdomain) {
      const pageRepo = new WebsitePageRepository(supabaseServer);
      const { data: websitePage, error: pageError } = await pageRepo.findBySubdomainAny(subdomain);

      if (pageError || !websitePage) {
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }
      ownerId = websitePage.user_id;

      // Fetch hidden service names from the services block content
      try {
        const blockRepo = new WebsiteBlockRepository(supabaseServer);
        const blocksResult = await blockRepo.findByPageId(websitePage.id);
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
    } else {
      // Authenticated access - use current user
      const user = await getUser();
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
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

    if (!service.is_active) {
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
        message: 'No availability configured'
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
    const timezone = 'UTC'; // TODO: Add timezone column to business_profiles if needed

    // Get day of week for the requested date using UTC to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dayOfWeek = DAYS_OF_WEEK[dateObj.getUTCDay()];
    const dayAvailability = availability[dayOfWeek] || [];

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

    // All non-cancelled bookings block their slot. The status enum is exhaustive
    // ('confirmed' | 'cancelled' | 'completed' | 'no_show'), so listing the three
    // non-cancelled states is equivalent to the prior `.neq('status', 'cancelled')`.
    const { data: existingBookings } = await schedulingBookingRepository.list(ownerId, {
      status: ['confirmed', 'completed', 'no_show'],
      startDate: dayStart,
      endDate: dayEnd,
      limit: 500,
    });

    // Get external calendar events overlapping this day via the repository. getBusySlots uses
    // proper overlap semantics (start < dayEnd AND end > dayStart), so multi-hour/all-day events
    // spanning into the day are correctly treated as busy. Every synced event is a busy block.
    const { data: busySlots } = await externalCalendarEventRepository.getBusySlots(ownerId, dayStart, dayEnd);
    const externalEvents = (busySlots || []).map(slot => ({ start_time: slot.start, end_time: slot.end }));

    // Generate available slots
    const slots = generateTimeSlots(
      date,
      dayAvailability,
      service.duration_minutes,
      existingBookings || [],
      externalEvents,
      timezone
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
