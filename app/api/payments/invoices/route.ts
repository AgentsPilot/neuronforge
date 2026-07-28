import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'PaymentInvoicesAPI' });
const auditTrail = AuditTrailService.getInstance();

const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit_price: z.number(),
  total: z.number(),
});

const CreateInvoiceSchema = z.object({
  contact_id: z.string().uuid().optional(),
  invoice_number: z.string().optional(), // Will auto-generate if not provided
  amount: z.number().positive(),
  currency: z.string().default('USD'),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).default('draft'),
  line_items: z.array(LineItemSchema).default([]),
  due_date: z.string().optional(),
  payment_terms: z.string().default('Due upon receipt'),
  notes: z.string().optional(),
  internal_notes: z.string().optional(),
});

// GET /api/payments/invoices - List invoices
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

    requestLogger.info({ userId: user.id, status, contact_id }, 'Listing payment invoices');

    const { data, error } = await paymentInvoiceRepository.list(user.id, {
      status,
      contactId: contact_id,
      limit,
      offset
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to list invoices');
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve invoices' },
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

// POST /api/payments/invoices - Create invoice
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
    const validated = CreateInvoiceSchema.parse(body);

    // Auto-generate invoice number if not provided
    let invoice_number = validated.invoice_number;
    if (!invoice_number) {
      const { data: nextNumber } = await paymentInvoiceRepository.getNextInvoiceNumber(user.id);
      invoice_number = nextNumber || 'INV-00001';
    }

    requestLogger.info({ userId: user.id, invoiceNumber: invoice_number }, 'Creating payment invoice');

    const { data, error } = await paymentInvoiceRepository.create({
      user_id: user.id,
      ...validated,
      invoice_number
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to create invoice');
      return NextResponse.json(
        { success: false, error: 'Failed to create invoice' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'PAYMENT_INVOICE_CREATED',
      entityType: 'payment_invoice',
      entityId: data!.id,
      userId: user.id,
      resourceName: invoice_number,
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
