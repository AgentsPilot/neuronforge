/**
 * POST /api/scheduling/bookings/[id]/cancel
 * Cancel a booking with optional reason
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { cancelBooking } from '@/lib/services/BookingLifecycleService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingCancelAPI' });

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

    // 3. Cancel — status, calendar and client notification together.
    //
    // The sequence lives in BookingLifecycleService so that the chat cancels a
    // booking the same way this route does. It used to live here, which meant
    // cancelling from anywhere else updated a status and stopped there.
    const result = await cancelBooking({
      bookingId,
      userId: user.id,
      reason: validated.reason,
      request,
      logger: requestLogger
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to cancel booking');
      const notFound = result.error.message === 'Booking not found';
      return NextResponse.json(
        { success: false, error: notFound ? 'Booking not found' : 'Failed to cancel booking' },
        { status: notFound ? 404 : 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      booking: result.data!.booking,
      client_notified: result.data!.clientNotified
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
