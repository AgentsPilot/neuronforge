/**
 * GET /api/scheduling/bookings/[id]
 * PUT /api/scheduling/bookings/[id]
 * DELETE /api/scheduling/bookings/[id]
 * Individual scheduling booking endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema for updates
const updateBookingSchema = z.object({
  // Booking time updates
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  timezone: z.string().optional(),
  // Client info updates
  client_first_name: z.string().min(1).optional(),
  client_last_name: z.string().optional(),
  client_email: z.string().email().optional(),
  client_phone: z.string().optional(),
  // Status updates
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
  cancellation_reason: z.string().optional(),
  // Payment updates
  payment_status: z.enum(['pending', 'paid', 'refunded']).optional(),
  payment_id: z.string().optional(),
  // Notes
  notes: z.string().optional(),
  internal_notes: z.string().optional(),
  // Reminder tracking
  reminder_24hr_sent: z.boolean().optional(),
  reminder_2hr_sent: z.boolean().optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId }, 'Fetching booking');

    // 2. Get booking
    const result = await schedulingBookingRepository.findById(bookingId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to fetch booking');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch booking' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      booking: result.data
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = updateBookingSchema.parse(body);

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId, updates: Object.keys(validated) }, 'Updating booking');

    // 3. Update booking
    const result = await schedulingBookingRepository.update(bookingId, user.id, validated);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, error: 'Failed to update booking' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_UPDATED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: bookingId,
        resourceName: `Booking for ${result.data.client_first_name} ${result.data.client_last_name || ''}`.trim(),
        changes: validated,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Sync calendar event if booking has one (non-blocking)
    if (result.data.external_calendar_event_id) {
      schedulingServiceRepository.findById(result.data.service_id, user.id)
        .then(serviceResult => {
          if (serviceResult.data && result.data) {
            // If booking was cancelled, delete the calendar event
            if (validated.status === 'cancelled' || validated.status === 'no_show') {
              CalendarSyncService.deleteCalendarEvent(result.data, user.id)
                .catch(err => requestLogger.warn({ err, bookingId }, 'Calendar event delete failed'));
            } else {
              // Otherwise update the calendar event
              CalendarSyncService.updateCalendarEvent(result.data, serviceResult.data, user.id)
                .catch(err => requestLogger.warn({ err, bookingId }, 'Calendar event update failed'));
            }
          }
        })
        .catch(err => requestLogger.warn({ err }, 'Failed to get service for calendar sync'));
    }

    // 6. Return success
    requestLogger.info({ bookingId, userId: user.id }, 'Booking updated successfully');
    return NextResponse.json({
      success: true,
      booking: result.data
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId }, 'Deleting booking');

    // 2. Get booking first (for audit trail)
    const getResult = await schedulingBookingRepository.findById(bookingId, user.id);
    if (getResult.error || !getResult.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 3. Delete booking
    const result = await schedulingBookingRepository.delete(bookingId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to delete booking');
      return NextResponse.json(
        { success: false, error: 'Failed to delete booking' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_DELETED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: bookingId,
        resourceName: `Booking for ${getResult.data.client_first_name} ${getResult.data.client_last_name || ''}`.trim(),
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Return success
    requestLogger.info({ bookingId, userId: user.id }, 'Booking deleted successfully');
    return NextResponse.json({
      success: true,
      message: 'Booking deleted successfully'
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
