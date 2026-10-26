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
import { settleInvoiceAtStripe } from '@/lib/payments/settleInvoiceAtStripe';

const logger = createLogger({ module: 'InvoiceMarkPaidAPI' });
const auditTrail = AuditTrailService.getInstance();

const MarkPaidSchema = z.object({
  /**
   * How the money arrived. Not 'card' by default — a card payment would have
   * come through a processor and produced its own transaction, so anything
   * marked by hand is almost certainly not one.
   */
  payment_method: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'other']).default('bank_transfer'),
  /**
   * Defaults to the invoice's own amount, and must EQUAL it when given.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THIS ONCE SAID "a part payment can say otherwise". IT COULD NOT.
   *
   * `settleInvoicePaid` marks the invoice `paid` and its plan stage `paid`
   * whatever figure it is handed. So recording ₪200 against a ₪400 invoice
   * closed the whole ₪400: the remaining ₪200 stopped being owed, vanished
   * from the client's balance, and nothing anywhere said it was missing.
   *
   * Holding a partial needs somewhere to hold it. `payment_invoices` has no
   * `amount_paid` column — there is nowhere to record "₪200 of ₪400" — so this
   * refuses the difference rather than silently rounding it up to settled. The
   * guard below says so in the error, because an owner who tries it is telling
   * us about money we have no way to keep.
   *
   * Still optional, and still defaulted: no caller in the app sends it, and
   * the common path is unchanged.
   * ───────────────────────────────────────────────────────────────────────────
   */
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
      .select('id, user_id, contact_id, booking_id, amount, currency, status, invoice_number, stripe_invoice_id')
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

    /*
     * A FIGURE THAT IS NOT THE WHOLE INVOICE IS REFUSED, NOT ROUNDED UP.
     *
     * Settlement closes the invoice and its plan stage outright, so a smaller
     * amount would quietly forgive the rest and a larger one would record less
     * money than arrived. Compared at cent precision: these are NUMERIC values
     * crossing JSON, and `400 !== 399.9999999` is a rejection no owner could
     * act on.
     */
    const requestedAmount = parsed.data.amount;
    if (requestedAmount !== undefined && Math.abs(requestedAmount - Number(invoice.amount)) > 0.005) {
      requestLogger.warn(
        { invoiceId: invoice.id, requestedAmount, invoiceAmount: invoice.amount },
        'Refused a mark-paid for part of an invoice'
      );
      return NextResponse.json(
        {
          success: false,
          error: `This records the whole invoice as paid, so it has to be for its full amount (${invoice.amount} ${String(invoice.currency).toUpperCase()}). Part payments are not supported yet.`,
        },
        { status: 400 }
      );
    }

    const result = await settleInvoicePaid(supabaseServer, {
      invoiceId: invoice.id,
      userId: user.id,
      contactId: invoice.contact_id,
      /* So the charge names the booking, not just the invoice. */
      bookingId: invoice.booking_id,
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

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * AND TELL STRIPE, IF STRIPE RAISED IT.
     *
     * Without this the invoice stays OPEN at Stripe after the owner records
     * cash, and in live mode the client still holds Stripe's own emailed link
     * to a working payment page. They could pay it again — and our own dedupe
     * would then hide that second charge completely, because `settleInvoicePaid`
     * finds this manual transaction and reports `alreadySettled`. Money taken
     * twice, recorded once, unrefundable from our UI.
     *
     * Only on a FRESH settlement. `alreadySettled` means a payment was already
     * recorded against this invoice, quite possibly by Stripe itself, and
     * paying out of band over the top of a real charge is not a correction.
     *
     * Awaited rather than fired and forgotten: it is one call, and the owner's
     * next move may well be to open Stripe and look. Never fatal — see the
     * module comment.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const stripeOutcome = result.alreadySettled
      ? 'skipped'
      : await settleInvoiceAtStripe({
          invoiceId: invoice.id,
          stripeInvoiceId: invoice.stripe_invoice_id as string | null,
          userId: user.id,
        });

    /*
     * Money arriving by hand is still money arriving.
     *
     * This used to promote the contact directly. It no longer decides that:
     * the one rule is `promote_contact_on_payment`, which fires on the
     * `payment_transactions` row this path records and resolves the business's
     * own client stage by `stage_type`.
     *
     * An earlier version of this note said "payment is not the relationship,
     * and a booking was confirmed is the one rule" — true of
     * `promote_contact_on_confirmed_booking`, which was DROPPED in 20260920
     * for the opposite reason: confirmation is free to come by, and money is
     * the evidence that someone bought something.
     *
     * What this path still owes is the confirmation itself — a booking held
     * pending because money was owed is confirmed once the money is recorded,
     * however it arrived.
     *
     * Scoped to `pending`, so a cancelled or completed booking is never
     * resurrected by a late settlement. Non-blocking: the payment is recorded
     * either way, and a board position is not worth failing a settlement over.
     */
    if (invoice.booking_id) {
      await supabaseServer
        .from('scheduling_bookings')
        .update({ status: 'confirmed', payment_status: 'paid', updated_at: new Date().toISOString() })
        .eq('id', invoice.booking_id)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .then(({ error }) => {
          if (error) {
            requestLogger.warn(
              { err: error, bookingId: invoice.booking_id },
              'Could not confirm the booking after a manual settlement (non-blocking)'
            );
          }
        });
    }

    if (result.alreadySettled) {
      return NextResponse.json({
        success: true,
        data: { transactionId: result.transactionId, alreadySettled: true, stripe: stripeOutcome },
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
          /* Whether Stripe's copy was closed too, so the trail can answer "why
             is that invoice still open at Stripe" without a log dive. */
          stripeSettlement: stripeOutcome,
        },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { invoiceId: invoice.id, transactionId: result.transactionId, stripe: stripeOutcome },
      'Invoice marked paid'
    );

    return NextResponse.json({ success: true, data: { ...result, stripe: stripeOutcome } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to mark invoice paid');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
