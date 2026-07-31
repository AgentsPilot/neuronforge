// app/api/book/manage/[token]/reschedule/route.ts
// Self-service booking reschedule endpoint

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken, BookingEmailService } from '@/lib/services/BookingEmailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'API', service: 'BookingReschedule' });

const rescheduleSchema = z.object({
  newStartTime: z.string().datetime(),
  newEndTime: z.string().datetime()
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
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;

    // Fetch booking
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        service_id,
        client_email,
        start_time,
        status,
        service:scheduling_services(
          duration_minutes,
          advance_booking_days,
          min_notice_hours,
          availability
        )
      `)
      .eq('id', bookingId)
      .eq('client_email', email)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Check if booking can be rescheduled
    const startTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, error: 'This booking cannot be rescheduled' },
        { status: 400 }
      );
    }

    if (hoursUntilBooking < 24) {
      return NextResponse.json(
        { success: false, error: 'Bookings must be rescheduled at least 24 hours in advance' },
        { status: 400 }
      );
    }

    // Return service availability info for the client to select a new time
    // The actual slot calculation would be handled by the website booking widget
    const service = booking.service as {
      duration_minutes: number;
      advance_booking_days: number;
      min_notice_hours: number;
      availability: Record<string, unknown>;
    };

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
      { success: false, error: 'Failed to fetch reschedule options' },
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
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;

    // Parse and validate body
    const body = await request.json();
    const validated = rescheduleSchema.parse(body);

    // Fetch booking
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, client_email, start_time, status')
      .eq('id', bookingId)
      .eq('client_email', email)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Validate booking can be rescheduled
    const currentStartTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (currentStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, error: 'This booking cannot be rescheduled' },
        { status: 400 }
      );
    }

    if (hoursUntilBooking < 24) {
      return NextResponse.json(
        { success: false, error: 'Bookings must be rescheduled at least 24 hours in advance' },
        { status: 400 }
      );
    }

    // Check for conflicts with the new time
    const { data: conflicts } = await supabaseServer
      .from('scheduling_bookings')
      .select('id')
      .eq('user_id', booking.user_id)
      .in('status', ['confirmed', 'completed'])
      .neq('id', bookingId)
      .lt('start_time', validated.newEndTime)
      .gt('end_time', validated.newStartTime);

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        { success: false, error: 'The selected time slot is not available' },
        { status: 409 }
      );
    }

    // Store previous time for email
    const previousDateTime = new Date(booking.start_time);

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update({
        start_time: validated.newStartTime,
        end_time: validated.newEndTime,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, error: 'Failed to reschedule booking' },
        { status: 500 }
      );
    }

    requestLogger.info({ bookingId, previousTime: booking.start_time, newTime: validated.newStartTime }, 'Booking rescheduled');

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
      { success: false, error: 'Failed to reschedule booking' },
      { status: 500 }
    );
  }
}
