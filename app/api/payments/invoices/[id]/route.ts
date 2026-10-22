import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { deleteInvoice, voidInvoice, InvoiceSettledError } from '@/lib/payments/invoiceLifecycle';
import { z } from 'zod';

const logger = createLogger({ module: 'PaymentInvoiceDetailAPI' });
const auditTrail = AuditTrailService.getInstance();

const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit_price: z.number(),
  total: z.number(),
});

const UpdateInvoiceSchema = z.object({
  amount: z.number().positive().optional(),
  // 'paid' is deliberately absent. Marking an invoice paid is a money event —
  // it must also record a payment_transactions row, or revenue cannot see the
  // money and no refund can ever be issued against it. This route was setting
  // the status alone, which is one of the ways invoices ended up settled with
  // nothing behind them.
  //
  // 'refunded' and 'partially_refunded' are absent for a different reason: they
  // are DERIVED by propagate_refund_to_invoice() from the invoice's payments,
  // so a value written here is silently overwritten.
  //
  // Use POST /api/payments/invoices/[id]/mark-paid instead.
  status: z.enum(['draft', 'sent', 'overdue', 'cancelled']).optional(),
  line_items: z.array(LineItemSchema).optional(),
  due_date: z.string().optional(),
  payment_terms: z.string().optional(),
  notes: z.string().optional(),
  internal_notes: z.string().optional(),
  sent_at: z.string().optional(),
  paid_at: z.string().optional(),
});

/**
 * One refusal for both void and delete. The client maps `INVOICE_PAID` to its
 * own wording; the details carry what the message needs to name.
 */
function settledInvoiceResponse(invoice: { invoice_number: string; amount: number | string }) {
  return NextResponse.json(
    {
      success: false,
      code: 'INVOICE_PAID',
      error:
        'This invoice has already been paid and cannot be voided or deleted. Refund the payment first.',
      details: {
        invoice_number: invoice.invoice_number,
        paid_amount: Number(invoice.amount) || 0,
      },
    },
    { status: 409 }
  );
}

// GET /api/payments/invoices/[id] - Get single invoice
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
    requestLogger.info({ userId: user.id, invoiceId: id }, 'Fetching payment invoice');

    const { data, error } = await paymentInvoiceRepository.findById(id, user.id);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to fetch invoice');
      return NextResponse.json(
        { success: false, error: 'Invoice not found' },
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

// PUT /api/payments/invoices/[id] - Update invoice
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
    const validated = UpdateInvoiceSchema.parse(body);

    requestLogger.info({ userId: user.id, invoiceId: id }, 'Updating payment invoice');

    /*
     * ── VOIDING GOES THROUGH THE LIFECYCLE, LIKE DELETING ───────────────────
     *
     * Cancelling is the one update that destroys standing: it tells the client
     * the invoice no longer applies. Doing that to an invoice they have already
     * paid would leave money received against a cancelled document.
     *
     * This branch used to check that and then write `status: 'cancelled'`
     * straight to the row — which left the invoice OPEN AT STRIPE. Observed on
     * INV-00042: local status `cancelled`, Stripe status `open`, amount_due 500,
     * `voided_at` null. The client still held a working hosted payment page for
     * a demand the business had withdrawn, and had they paid it the money would
     * have arrived against a cancelled document with no stage to settle.
     *
     * The DELETE handler below already carries the comment describing this exact
     * bug, because it was fixed there and not here. `voidInvoice` is that fix:
     * it refuses a settled invoice, voids at the processor FIRST, writes the
     * status, releases the plan stage and audits — one definition of voiding for
     * both callers.
     * ────────────────────────────────────────────────────────────────────────
     */
    if (validated.status === 'cancelled') {
      const { error: voidError } = await voidInvoice({
        invoiceId: id,
        userId: user.id,
        request,
        /*
         * This is the owner pressing "cancel this payment" on one invoice, so
         * the client is told. The bulk callers deliberately do not: they send
         * one email about the whole ending instead of one per invoice.
         */
        notifyClient: true,
      });

      if (voidError) {
        if (voidError instanceof InvoiceSettledError) {
          requestLogger.info(
            { userId: user.id, invoiceId: id },
            'Refused to void an invoice that has been paid'
          );
          return settledInvoiceResponse(voidError.invoice);
        }

        const notFound = voidError.message === 'Invoice not found';
        requestLogger.error({ err: voidError, id }, 'Failed to void invoice');
        return NextResponse.json(
          { success: false, error: notFound ? 'Invoice not found' : 'Failed to update invoice' },
          { status: notFound ? 404 : 500 }
        );
      }

      const { data: voided } = await paymentInvoiceRepository.findById(id, user.id);
      return NextResponse.json({ success: true, data: voided });
    }

    const { data, error } = await paymentInvoiceRepository.update(id, user.id, validated);

    if (error) {
      requestLogger.error({ err: error, id }, 'Failed to update invoice');
      return NextResponse.json(
        { success: false, error: 'Failed to update invoice' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'PAYMENT_INVOICE_UPDATED',
      entityType: 'payment_invoice',
      entityId: id,
      userId: user.id,
      resourceName: data!.invoice_number,
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

// DELETE /api/payments/invoices/[id] - Delete invoice
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

    // Through the shared lifecycle, which refuses a paid invoice AND voids it at
    // Stripe first. This route used to do the former and not the latter, so a
    // deleted invoice kept a working hosted payment page and money could arrive
    // for a document that no longer existed.
    const result = await deleteInvoice({ invoiceId: id, userId: user.id, request });

    if (result.error) {
      if (result.error instanceof InvoiceSettledError) {
        requestLogger.info(
          { userId: user.id, invoiceId: id },
          'Refused to delete an invoice that has been paid'
        );
        return settledInvoiceResponse(result.error.invoice);
      }

      const notFound = result.error.message === 'Invoice not found';
      requestLogger.error({ err: result.error, id }, 'Failed to delete invoice');
      return NextResponse.json(
        { success: false, error: notFound ? 'Invoice not found' : 'Failed to delete invoice' },
        { status: notFound ? 404 : 500 }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
