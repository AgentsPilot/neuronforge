import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentTransactionRepository } from '@/lib/repositories/PaymentRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'PaymentTransactionDetailAPI' });
const auditTrail = AuditTrailService.getInstance();

const UpdateTransactionSchema = z.object({
  status: z.enum(['pending', 'succeeded', 'failed', 'refunded']).optional(),
  payment_method: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  failure_reason: z.string().optional(),
  paid_at: z.string().optional(),
});

// GET /api/payments/transactions/[id] - Get single transaction
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
    requestLogger.info({ userId: user.id, transactionId: id }, 'Fetching payment transaction');

    const { data, error } = await paymentTransactionRepository.findById(id, user.id);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to fetch transaction');
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
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

// PUT /api/payments/transactions/[id] - Update transaction
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
    const validated = UpdateTransactionSchema.parse(body);

    requestLogger.info({ userId: user.id, transactionId: id }, 'Updating payment transaction');

    const { data, error } = await paymentTransactionRepository.update(id, user.id, validated);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to update transaction');
      return NextResponse.json(
        { success: false, error: 'Failed to update transaction' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'PAYMENT_TRANSACTION_UPDATED',
      entityType: 'payment_transaction',
      entityId: id,
      userId: user.id,
      resourceName: `Payment $${data!.amount}`,
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
