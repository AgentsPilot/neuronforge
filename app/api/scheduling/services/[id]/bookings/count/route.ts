/**
 * GET /api/scheduling/services/[id]/bookings/count
 * Returns the count of bookings for a service
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'SchedulingServiceBookingsCountAPI' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: serviceId } = await params;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id, serviceId }, 'Counting bookings for service');

    // 2. Verify service belongs to user
    const serviceResult = await schedulingServiceRepository.findById(serviceId, user.id);
    if (serviceResult.error || !serviceResult.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // 3. Count bookings
    const countResult = await schedulingServiceRepository.countBookings(serviceId, user.id);

    if (countResult.error) {
      requestLogger.error({ err: countResult.error, serviceId }, 'Failed to count bookings');
      return NextResponse.json(
        { success: false, error: 'Failed to count bookings' },
        { status: 500 }
      );
    }

    // 4. Return count
    return NextResponse.json({
      success: true,
      count: countResult.data
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
