import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { emailSequenceRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'EmailSequenceDetailAPI' });
const auditTrail = AuditTrailService.getInstance();

const UpdateSequenceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  trigger_type: z.enum(['manual', 'contact_created', 'booking_confirmed', 'payment_received', 'tag_added']).optional(),
  trigger_config: z.record(z.any()).optional(),
  is_active: z.boolean().optional(),
});

// GET /api/email/sequences/[id] - Get single sequence
export async function GET(
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
    requestLogger.info({ userId: user.id, sequenceId: id }, 'Fetching email sequence');

    const { data, error } = await emailSequenceRepository.findById(id, user.id);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to fetch sequence');
      return NextResponse.json(
        { success: false, error: 'Sequence not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/email/sequences/[id] - Update sequence
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
    const validated = UpdateSequenceSchema.parse(body);

    requestLogger.info({ userId: user.id, sequenceId: id }, 'Updating email sequence');

    const { data, error } = await emailSequenceRepository.update(id, user.id, validated);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to update sequence');
      return NextResponse.json(
        { success: false, error: 'Failed to update sequence' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_SEQUENCE_UPDATED',
      entityType: 'email_sequence',
      entityId: id,
      userId: user.id,
      resourceName: data!.name,
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

// DELETE /api/email/sequences/[id] - Delete sequence
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
    requestLogger.info({ userId: user.id, sequenceId: id }, 'Deleting email sequence');

    const { error } = await emailSequenceRepository.delete(id, user.id);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to delete sequence');
      return NextResponse.json(
        { success: false, error: 'Failed to delete sequence' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_SEQUENCE_DELETED',
      entityType: 'email_sequence',
      entityId: id,
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
