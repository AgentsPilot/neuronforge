import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { emailSequenceEnrollmentRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'EmailEnrollmentsAPI' });
const auditTrail = AuditTrailService.getInstance();

const CreateEnrollmentSchema = z.object({
  sequence_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  status: z.enum(['active', 'paused']).default('active'),
  current_step_number: z.number().int().min(0).default(0),
  next_send_at: z.string().optional(),
});

// GET /api/email/enrollments - List enrollments
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const sequence_id = searchParams.get('sequence_id') || undefined;
    const contact_id = searchParams.get('contact_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    requestLogger.info({ userId: user.id, sequence_id, contact_id, status }, 'Listing enrollments');

    const { data, error } = await emailSequenceEnrollmentRepository.list(user.id, {
      sequence_id,
      contact_id,
      status,
      limit,
      offset
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to list enrollments');
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve enrollments' },
        { status: 500 }
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

// POST /api/email/enrollments - Enroll contact in sequence
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const validated = CreateEnrollmentSchema.parse(body);

    requestLogger.info({ userId: user.id, sequenceId: validated.sequence_id, contactId: validated.contact_id }, 'Enrolling contact in sequence');

    const { data, error } = await emailSequenceEnrollmentRepository.create({
      user_id: user.id,
      ...validated
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to enroll contact');
      return NextResponse.json(
        { success: false, error: 'Failed to enroll contact' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_ENROLLMENT_CREATED',
      entityType: 'email_sequence_enrollment',
      entityId: data!.id,
      userId: user.id,
      resourceName: `Contact ${validated.contact_id} → Sequence ${validated.sequence_id}`,
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, data }, { status: 201 });

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
