/**
 * Send the refund confirmation again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The confirmation fires once, at the moment the refund is recorded, and only
 * if the owner left "notify the client" ticked. So there were three ordinary
 * ways for a client to end up with no word that their money had been returned:
 * the switch was off, the mail bounced, or the refund arrived through a path
 * with nobody to ask — a webhook, an automation block, the Stripe dashboard.
 *
 * And nothing could put it right. The stage menu offered "Send receipt", which
 * `sendInvoice` refuses outright on a refunded invoice — correctly, since the
 * document it builds carries a live pay button for money the client was just
 * given back. The one email that IS honest after a refund had no button at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SENDS THE SAME EMAIL, NOT A NEW KIND OF ONE
 *
 * Straight through `notifyRefund`, the one place that decides who hears about a
 * refund and what it says. A second template here would be a second thing to
 * keep true about money that has already moved.
 *
 *   POST /api/payments/invoices/[id]/resend-refund-confirmation
 *
 * @module app/api/payments/invoices/[id]/resend-refund-confirmation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { createLogger } from '@/lib/logger';
import { getUser } from '@/lib/auth';
import { notifyRefund } from '@/lib/payments/notifyRefund';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'InvoiceResendRefundAPI' });
const auditTrail = AuditTrailService.getInstance();

/** The only input is the invoice, and it still gets checked. */
const ParamsSchema = z.object({ id: z.string().uuid() });

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

    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid invoice id' }, { status: 400 });
    }

    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('id, user_id, currency, refunded_amount, refund_status, invoice_number')
      .eq('id', parsed.data.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

    /*
     * Nothing came back, so there is nothing to confirm.
     *
     * Reads `refunded_amount` rather than `status`: a refund can land on an
     * invoice that was never marked paid, which leaves `status` reading `sent`
     * while the money has genuinely gone back — the same trap `hasBeenRefunded`
     * documents with a live row.
     */
    const refundedAmount = Number(invoice.refunded_amount ?? 0);
    if (refundedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Nothing has been refunded on this invoice.' },
        { status: 409 }
      );
    }

    /*
     * The transaction the money came back from.
     *
     * `notifyRefund` works outwards from it — to the booking, or to the invoice
     * when there is no booking — so it is the one thing this has to find. A
     * refunded invoice with no transaction behind it is the shape the whole
     * settlement path exists to prevent, and there is nothing honest to send
     * about it.
     */
    const { data: transaction } = await supabaseServer
      .from('payment_transactions')
      .select('id')
      .eq('invoice_id', invoice.id)
      .eq('user_id', user.id)
      .in('status', ['refunded', 'succeeded'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!transaction) {
      requestLogger.warn({ invoiceId: invoice.id }, 'Refunded invoice with no payment behind it');
      return NextResponse.json(
        { success: false, error: 'No payment is recorded against this invoice.' },
        { status: 409 }
      );
    }

    /*
     * `notifyContact: true` because this IS the owner asking. On the automatic
     * paths that flag carries the owner's choice at refund time; here the
     * choice is the button they just pressed.
     */
    const sent = await notifyRefund({
      userId: user.id,
      transactionId: transaction.id as string,
      refundAmount: refundedAmount,
      currency: String(invoice.currency ?? ''),
      notifyContact: true,
    });

    auditTrail
      .log({
        action: 'REFUND_CONFIRMATION_RESENT',
        entityType: 'payment_invoice',
        entityId: invoice.id,
        userId: user.id,
        resourceName: invoice.invoice_number,
        changes: { refundedAmount, sent },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ invoiceId: invoice.id, sent }, 'Refund confirmation resend requested');

    /*
     * `sent: false` is a 200, not an error.
     *
     * Nothing went wrong — there is simply no address to send to, which is a
     * fact about the client's record rather than a failure of this request.
     * The caller says so in its own words instead of showing a red toast about
     * a system that worked.
     */
    return NextResponse.json({ success: true, data: { sent } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to resend the refund confirmation');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
