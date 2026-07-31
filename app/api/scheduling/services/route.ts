/**
 * POST /api/scheduling/services
 * GET /api/scheduling/services
 * Scheduling services endpoints - create and list services
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingServicesAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema
const createServiceSchema = z.object({
  service_name: z.string().min(1),
  description: z.string().optional(),
  duration_minutes: z.number().min(5).max(10080), // Up to 7 days (10080 minutes) for multi-day courses/retreats
  price: z.number().min(0).optional(),
  currency: z.enum(['USD', 'EUR', 'ILS', 'GBP']).optional(),
  buffer_minutes: z.number().min(0).max(120).optional(),
  max_bookings_per_day: z.number().min(1).nullable().optional(),
  advance_booking_days: z.number().min(0).optional(),
  min_notice_hours: z.number().min(0).optional(),
  availability: z.record(z.any()).optional(),
  is_active: z.boolean().optional(),
  status: z.enum(['draft', 'active']).optional(),
  // Payment options
  payment_type: z.enum(['full', 'installments']).optional(),
  installment_count: z.number().min(1).max(24).optional(),
  installment_frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']).optional(),
  first_payment_due: z.enum(['on_booking', 'days_after']).optional(),
  first_payment_days: z.number().min(0).max(365).optional()
});

export async function POST(request: NextRequest) {
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
    const validated = createServiceSchema.parse(body);

    requestLogger.info({ userId: user.id, serviceName: validated.service_name }, 'Creating scheduling service');

    // 3. Create service
    const result = await schedulingServiceRepository.create({
      user_id: user.id,
      ...validated
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create service');
      return NextResponse.json(
        { success: false, error: 'Failed to create service' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_SERVICE_CREATED',
        userId: user.id,
        entityType: 'scheduling_service',
        entityId: result.data!.id,
        resourceName: result.data!.service_name,
        metadata: {
          duration_minutes: result.data!.duration_minutes,
          price: result.data!.price
        },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Return success
    requestLogger.info({ serviceId: result.data!.id, userId: user.id }, 'Service created successfully');
    return NextResponse.json({
      success: true,
      service: result.data
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

export async function GET(request: NextRequest) {
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

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    requestLogger.info({ userId: user.id, activeOnly }, 'Listing scheduling services');

    // 3. Get services
    const result = await schedulingServiceRepository.listAll(user.id, activeOnly);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list services');
      return NextResponse.json(
        { success: false, error: 'Failed to list services' },
        { status: 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      services: result.data
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
