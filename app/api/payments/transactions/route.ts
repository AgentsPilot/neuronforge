import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentTransactionRepository } from '@/lib/repositories/PaymentRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'PaymentTransactionsAPI' });
const auditTrail = AuditTrailService.getInstance();

const CreateTransactionSchema = z.object({
  contact_id: z.string().uuid().optional(),
  stripe_payment_intent_id: z.string().optional(),
  stripe_charge_id: z.string().optional(),
  stripe_customer_id: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().default('USD'),
  status: z.enum(['pending', 'succeeded', 'failed', 'refunded']).default('pending'),
  payment_method: z.string().optional(),
  description: z.string().optional(),
  invoice_id: z.string().uuid().optional(),
  metadata: z.record(z.any()).default({}),
});

// GET /api/payments/transactions - List transactions
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
    const status = searchParams.get('status') || undefined;
    const contact_id = searchParams.get('contact_id') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    requestLogger.info({ userId: user.id, status, contact_id }, 'Listing payment transactions');

    const { data, error } = await paymentTransactionRepository.list(user.id, {
      status,
      contactId: contact_id,
      limit,
      offset
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to list transactions');
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve transactions' },
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

// POST /api/payments/transactions - Create transaction
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
    const validated = CreateTransactionSchema.parse(body);

    requestLogger.info({ userId: user.id, amount: validated.amount }, 'Creating payment transaction');

    const { data, error } = await paymentTransactionRepository.create({
      user_id: user.id,
      ...validated
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to create transaction');
      return NextResponse.json(
        { success: false, error: 'Failed to create transaction' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'PAYMENT_TRANSACTION_CREATED',
      entityType: 'payment_transaction',
      entityId: data!.id,
      userId: user.id,
      resourceName: `Payment $${data!.amount}`,
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
