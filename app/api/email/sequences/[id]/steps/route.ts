import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { emailSequenceStepRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'EmailSequenceStepsAPI' });
const auditTrail = AuditTrailService.getInstance();

const CreateStepSchema = z.object({
  step_number: z.number().int().min(0),
  delay_minutes: z.number().int().min(0).default(0),
  subject: z.string().min(1),
  body_html: z.string().min(1),
  body_text: z.string().optional(),
});

// GET /api/email/sequences/[id]/steps - List steps for a sequence
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

    const sequenceId = params.id;
    requestLogger.info({ userId: user.id, sequenceId }, 'Listing sequence steps');

    const { data, error } = await emailSequenceStepRepository.list(sequenceId, user.id);

    if (error) {
      requestLogger.error({ err: error, sequenceId }, 'Failed to list steps');
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve steps' },
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

// POST /api/email/sequences/[id]/steps - Create step in sequence
export async function POST(
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

    const sequenceId = params.id;
    const body = await request.json();
    const validated = CreateStepSchema.parse(body);

    requestLogger.info({ userId: user.id, sequenceId, stepNumber: validated.step_number }, 'Creating sequence step');

    const { data, error } = await emailSequenceStepRepository.create({
      sequence_id: sequenceId,
      user_id: user.id,
      sent_count: 0,
      opened_count: 0,
      clicked_count: 0,
      ...validated
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to create step');
      return NextResponse.json(
        { success: false, error: 'Failed to create step' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_SEQUENCE_STEP_CREATED',
      entityType: 'email_sequence_step',
      entityId: data!.id,
      userId: user.id,
      resourceName: `Step ${validated.step_number}: ${validated.subject}`,
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
