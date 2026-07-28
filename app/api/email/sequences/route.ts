import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { emailSequenceRepository } from '@/lib/repositories/EmailAutomationRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'EmailSequencesAPI' });
const auditTrail = AuditTrailService.getInstance();

const CreateSequenceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger_type: z.enum(['manual', 'contact_created', 'booking_confirmed', 'payment_received', 'tag_added']),
  trigger_config: z.record(z.any()).default({}),
  is_active: z.boolean().default(false),
});

// GET /api/email/sequences - List sequences
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
    const trigger_type = searchParams.get('trigger_type') || undefined;
    const is_active = searchParams.get('is_active') === 'true' ? true : searchParams.get('is_active') === 'false' ? false : undefined;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    requestLogger.info({ userId: user.id, trigger_type, is_active }, 'Listing email sequences');

    const { data, error } = await emailSequenceRepository.list(user.id, {
      trigger_type,
      is_active,
      limit,
      offset
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to list sequences');
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve sequences' },
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

// POST /api/email/sequences - Create sequence
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
    const validated = CreateSequenceSchema.parse(body);

    requestLogger.info({ userId: user.id, sequenceName: validated.name }, 'Creating email sequence');

    const { data, error } = await emailSequenceRepository.create({
      user_id: user.id,
      total_sent: 0,
      total_opened: 0,
      total_clicked: 0,
      ...validated
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to create sequence');
      return NextResponse.json(
        { success: false, error: 'Failed to create sequence' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'EMAIL_SEQUENCE_CREATED',
      entityType: 'email_sequence',
      entityId: data!.id,
      userId: user.id,
      resourceName: validated.name,
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
