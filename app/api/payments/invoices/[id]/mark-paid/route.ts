/**
 * Record that an invoice was paid outside the app.
 *
 * Cash, a bank transfer, a card machine — money that arrived without a
 * processor event to tell us about it.
 *
 * This exists because `PUT /api/payments/invoices/[id]` used to accept
 * `status: 'paid'`, which set the invoice's status and nothing else. The invoice
 * then looked settled while no payment existed: invisible to revenue, which
 * reads transactions, and impossible to refund, which also reads transactions.
 * Marking an invoice paid is a money event, not a field edit, so it has its own
 * route and goes through the one settle path.
 *
 *   POST /api/payments/invoices/[id]/mark-paid
 *
 * @module app/api/payments/invoices/[id]/mark-paid
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { settleInvoicePaid } from '@/lib/payments/invoiceSettlement';

const logger = createLogger({ module: 'InvoiceMarkPaidAPI' });
const auditTrail = AuditTrailService.getInstance();

const MarkPaidSchema = z.object({
  /**
   * How the money arrived. Not 'card' by default — a card payment would have
   * come through a processor and produced its own transaction, so anything
   * marked by hand is almost certainly not one.
   */
  payment_method: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'other']).default('bank_transfer'),
  /** Defaults to the invoice's own amount; a part payment can say otherwise. */
  amount: z.number().positive().optional(),
  paid_at: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: invoiceId } = await params;
    const parsed = MarkPaidSchema.safeParse(await request.json().catch(() => ({})));

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    // Scoped by the session's user, so naming another business's invoice id
    // finds nothing.
    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('id, user_id, contact_id, amount, currency, status, invoice_number')
      .eq('id', invoiceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'This invoice was cancelled and cannot be marked paid.' },
        { status: 409 }
      );
    }

    const result = await settleInvoicePaid(supabaseServer, {
      invoiceId: invoice.id,
      userId: user.id,
      contactId: invoice.contact_id,
      amount: parsed.data.amount ?? invoice.amount,
      currency: invoice.currency,
      paidAt: parsed.data.paid_at,
      paymentMethod: parsed.data.payment_method,
      // Not 'stripe': no processor was involved, and claiming one would make
      // the refund path try to return money through an account that never
      // received it.
      processorType: 'manual',
      // A manual payment has no Stripe account, and saying so explicitly is
      // what stops the refund path treating it as unrecorded.
      accountContext: {
        stripe_connect_account_id: null,
        charge_account_kind: 'platform',
        account_resolution: 'recorded',
      },
      description: `Invoice ${invoice.invoice_number}`,
      metadata: { source: 'manual_mark_paid', notes: parsed.data.notes ?? null },
    });

    if (result.alreadySettled) {
      return NextResponse.json({
        success: true,
        data: { transactionId: result.transactionId, alreadySettled: true },
      });
    }

    auditTrail
      .log({
        action: 'INVOICE_MARKED_PAID',
        entityType: 'payment_invoice',
        entityId: invoice.id,
        userId: user.id,
        resourceName: invoice.invoice_number,
        severity: 'warning',
        changes: {
          amount: parsed.data.amount ?? invoice.amount,
          paymentMethod: parsed.data.payment_method,
          transactionId: result.transactionId,
        },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { invoiceId: invoice.id, transactionId: result.transactionId },
      'Invoice marked paid'
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to mark invoice paid');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
