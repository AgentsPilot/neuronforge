import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { emailSequenceStepRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'EmailSequenceStepDetailAPI' });
const auditTrail = AuditTrailService.getInstance();

const UpdateStepSchema = z.object({
  step_number: z.number().int().min(0).optional(),
  delay_minutes: z.number().int().min(0).optional(),
  subject: z.string().min(1).optional(),
  body_html: z.string().min(1).optional(),
  body_text: z.string().optional(),
});

// PUT /api/email/sequences/[id]/steps/[stepId] - Update step
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; stepId: string } }
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

    const { stepId } = params;
    const body = await request.json();
    const validated = UpdateStepSchema.parse(body);

    requestLogger.info({ userId: user.id, stepId }, 'Updating sequence step');

    const { data, error } = await emailSequenceStepRepository.update(stepId, user.id, validated);

    if (error) {
      requestLogger.error({ err: error, stepId }, 'Failed to update step');
      return NextResponse.json(
        { success: false, error: 'Failed to update step' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_SEQUENCE_STEP_UPDATED',
      entityType: 'email_sequence_step',
      entityId: stepId,
      userId: user.id,
      resourceName: data!.subject,
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

// DELETE /api/email/sequences/[id]/steps/[stepId] - Delete step
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; stepId: string } }
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

    const { stepId } = params;
    requestLogger.info({ userId: user.id, stepId }, 'Deleting sequence step');

    const { error } = await emailSequenceStepRepository.delete(stepId, user.id);

    if (error) {
      requestLogger.error({ err: error, stepId }, 'Failed to delete step');
      return NextResponse.json(
        { success: false, error: 'Failed to delete step' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_SEQUENCE_STEP_DELETED',
      entityType: 'email_sequence_step',
      entityId: stepId,
      userId: user.id,
      severity: 'warning',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
