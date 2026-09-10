/**
 * GET /api/scheduling/services/[id]
 * PUT /api/scheduling/services/[id]
 * PATCH /api/scheduling/services/[id]
 * DELETE /api/scheduling/services/[id]
 * Individual scheduling service endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingServiceAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema for updates
const updateServiceSchema = z.object({
  service_name: z.string().min(1).optional(),
  /*
   * Nullable, because clearing a description has to be expressible.
   *
   * `.optional()` alone accepts a string or nothing at all, and rejects `null`
   * — so an owner who emptied the field sent `description: null`, Zod threw,
   * and the WHOLE request was refused. The visible symptom was that the service
   * NAME would not save: nothing in the payload saved, and the one field that
   * failed was not the one being blamed.
   */
  description: z.string().nullable().optional(),
  duration_minutes: z.number().min(5).max(10080).nullable().optional(), // Null for a product
  // Two facts that decide this service's client journey. A product has no
  // duration, and a free service is not collected at all — both arrive null.
  is_scheduled: z.boolean().optional(),
  collection: z.enum(['online', 'invoice']).nullable().optional(),
  // The third: can a client buy this outright, or is it quoted per job?
  // Absent means 'direct', matching the column default, so an older
  // client that does not send it leaves the service unchanged.
  sale_mode: z.enum(['direct', 'proposal']).optional(),
  price: z.number().min(0).nullable().optional(),
  currency: z.enum(['USD', 'EUR', 'ILS', 'GBP']).optional(),
  buffer_minutes: z.number().min(0).max(1440).optional(), // Max 24 hours
  max_bookings_per_day: z.number().min(1).nullable().optional(),
  advance_booking_days: z.number().min(0).optional(),
  min_notice_hours: z.number().min(0).optional(),
  availability: z.record(z.any()).optional(),
  is_active: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'inactive']).optional(),
  // Payment options
  payment_type: z.enum(['full', 'installments']).optional(),
  installment_count: z.number().min(1).max(24).nullable().optional(),
  installment_frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']).nullable().optional(),
  first_payment_due: z.enum(['on_booking', 'days_after']).nullable().optional(),
  first_payment_days: z.number().min(0).max(365).nullable().optional()
});

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
    requestLogger.info({ userId: user.id, serviceId }, 'Fetching scheduling service');

    // 2. Get service
    const result = await schedulingServiceRepository.findById(serviceId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, serviceId }, 'Failed to fetch service');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch service' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      service: result.data
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

    // 2. Validate input
    const body = await request.json();
    const validated = updateServiceSchema.parse(body);
    requestLogger.info({ userId: user.id, serviceId, updates: Object.keys(validated) }, 'Updating scheduling service');

    // 3. Update service
    //
    // The schema tolerates nulls on the instalment fields because older clients
    // send them; the columns do not. A null here means "leave it alone", not
    // "write null", so those keys are dropped rather than forwarded.
    const NULLABLE_ONLY_IN_TRANSIT = [
      'installment_count',
      'installment_frequency',
      'first_payment_due',
      'first_payment_days',
    ] as const;

    const updates: Record<string, unknown> = { ...validated };
    NULLABLE_ONLY_IN_TRANSIT.forEach(key => {
      if (updates[key] === null) delete updates[key];
    });

    const result = await schedulingServiceRepository.update(
      serviceId,
      user.id,
      updates as Parameters<typeof schedulingServiceRepository.update>[2]
    );

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, serviceId }, 'Failed to update service');
      return NextResponse.json(
        { success: false, error: 'Failed to update service' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_SERVICE_UPDATED',
        userId: user.id,
        entityType: 'scheduling_service',
        entityId: serviceId,
        resourceName: result.data.service_name,
        changes: validated,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Return success
    requestLogger.info({ serviceId, userId: user.id }, 'Service updated successfully');
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

// PATCH handler - alias for PUT (partial updates)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(request, context);
}

export async function DELETE(
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
    requestLogger.info({ userId: user.id, serviceId }, 'Deleting scheduling service');

    // 2. Get service first (for audit trail)
    const getResult = await schedulingServiceRepository.findById(serviceId, user.id);
    if (getResult.error || !getResult.data) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    // 3. Delete service (checks for bookings first)
    const result = await schedulingServiceRepository.delete(serviceId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, serviceId }, 'Failed to delete service');
      return NextResponse.json(
        { success: false, error: 'Failed to delete service' },
        { status: 500 }
      );
    }

    // 4. Check if deletion was blocked by existing bookings
    if (!result.data?.deleted) {
      requestLogger.warn({ serviceId, userId: user.id, bookingCount: result.data?.bookingCount }, 'Cannot delete service with existing bookings');
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot delete service with existing bookings',
          bookingCount: result.data?.bookingCount
        },
        { status: 409 }
      );
    }

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_SERVICE_DELETED',
        userId: user.id,
        entityType: 'scheduling_service',
        entityId: serviceId,
        resourceName: getResult.data.service_name,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 7. Return success
    requestLogger.info({ serviceId, userId: user.id }, 'Service deleted successfully');
    return NextResponse.json({
      success: true,
      message: 'Service deleted successfully'
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
