/**
 * POST /api/scheduling/bookings/[id]/cancel
 * Cancel a booking with optional reason
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingCancelAPI' });
const auditTrail = AuditTrailService.getInstance();

const cancelBookingSchema = z.object({
  reason: z.string().optional()
});

export async function POST(
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
    const validated = cancelBookingSchema.parse(body);

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId, reason: validated.reason }, 'Cancelling booking');

    // 3. Cancel booking
    const result = await schedulingBookingRepository.cancel(bookingId, user.id, validated.reason);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to cancel booking');
      return NextResponse.json(
        { success: false, error: 'Failed to cancel booking' },
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
        action: 'SCHEDULING_BOOKING_CANCELLED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: bookingId,
        resourceName: `Booking for ${result.data.client_first_name} ${result.data.client_last_name || ''}`.trim(),
        metadata: { reason: validated.reason },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Delete calendar event if booking had one (non-blocking)
    if (result.data.external_calendar_event_id) {
      CalendarSyncService.deleteCalendarEvent(result.data, user.id)
        .catch(err => requestLogger.warn({ err, bookingId }, 'Calendar event delete failed'));
    }

    // 6. Send cancellation email (non-blocking)
    BookingEmailService.sendCancellationEmail(bookingId, user.id, validated.reason)
      .catch(err => requestLogger.warn({ err, bookingId }, 'Cancellation email failed'));

    // 7. Return success
    requestLogger.info({ bookingId, userId: user.id }, 'Booking cancelled successfully');
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
