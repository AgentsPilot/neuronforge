import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { emailSequenceEnrollmentRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'EmailEnrollmentDetailAPI' });
const auditTrail = AuditTrailService.getInstance();

const UpdateEnrollmentSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
  current_step_number: z.number().int().min(0).optional(),
  next_send_at: z.string().optional(),
});

// PUT /api/email/enrollments/[id] - Update enrollment
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;
    const body = await request.json();
    const validated = UpdateEnrollmentSchema.parse(body);

    requestLogger.info({ userId: user.id, enrollmentId: id }, 'Updating enrollment');

    const { data, error } = await emailSequenceEnrollmentRepository.update(id, user.id, validated);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to update enrollment');
      return NextResponse.json(
        { success: false, error: 'Failed to update enrollment' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_ENROLLMENT_UPDATED',
      entityType: 'email_sequence_enrollment',
      entityId: id,
      userId: user.id,
      changes: validated,
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/email/enrollments/[id] - Cancel enrollment
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = params;
    requestLogger.info({ userId: user.id, enrollmentId: id }, 'Cancelling enrollment');

    const { data, error } = await emailSequenceEnrollmentRepository.cancel(id, user.id);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to cancel enrollment');
      return NextResponse.json(
        { success: false, error: 'Failed to cancel enrollment' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_ENROLLMENT_CANCELLED',
      entityType: 'email_sequence_enrollment',
      entityId: id,
      userId: user.id,
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
