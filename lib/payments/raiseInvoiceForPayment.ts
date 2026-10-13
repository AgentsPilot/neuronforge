/**
 * Put an invoice at Stripe so it can be paid, without Stripe telling anybody.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NEEDED AT ALL
 *
 * Paying in the portal means confirming the invoice's own
 * `confirmation_secret`, and that only exists once the invoice has been raised
 * AND finalised at Stripe.
 *
 * Before the portal, nothing ever raised one. Accepting a quote wrote a row in
 * our database, marked it `sent`, and redirected — Stripe was never told. The
 * Pay button then went to `/api/public/invoice/[id]/pay`, which created a
 * CHECKOUT SESSION on the spot. A session is not an invoice; it is a one-off
 * payment page Stripe builds on demand, which is why it worked whether or not
 * an invoice existed.
 *
 * The portal replaced that button with an embedded card form, which needs the
 * invoice. So the object the old flow created at click time now has to exist,
 * and this is what creates it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT MAKE IT SAFE
 *
 * 1. IDEMPOTENT. A fresh read first, then a Stripe idempotency key derived
 *    from our invoice id. Two tabs, a double-click, or a retried request
 *    cannot raise two invoices for one debt.
 *
 * 2. SILENT. `autoAdvance: false` on create and on finalise. Stripe's default
 *    for `send_invoice` is to email the customer on finalisation and then run
 *    its own dunning schedule — the client would get a second bill and a
 *    second set of chasers alongside ours.
 *
 * 3. NO NEW RECORDING PATH. It creates an invoice, never a standalone
 *    PaymentIntent, and never writes `owner_id` onto one. An invoice's
 *    PaymentIntent is Stripe's own and carries no metadata of ours, which is
 *    exactly what keeps `invoice.paid` the single recorder. Two handlers
 *    recording one payment is the collision that has already left ten invoices
 *    paid at Stripe and open in our database.
 *
 * Charges nobody. Finalising makes an invoice payable; it does not take money.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'payments', service: 'RaiseInvoiceForPayment' });

export type RaiseOutcome =
  | { ok: true; stripeInvoiceId: string }
  /** Already there. The common case on any second visit. */
  | { ok: true; stripeInvoiceId: string; existing: true }
  /** The business cannot take card payments at all. Not an error. */
  | { ok: false; reason: 'cannot_collect' }
  /** Nothing to bill: no address to bill it to, or no priced lines. */
  | { ok: false; reason: 'not_billable' }
  | { ok: false; reason: 'stripe_failed' };

interface LineItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
}

/**
 * Raise and finalise this invoice at Stripe, or report why not.
 *
 * Safe to call repeatedly: an invoice that already has a Stripe id is returned
 * untouched, and the idempotency key covers the window before our own write
 * lands.
 *
 * Never throws. Every caller is on a path where the client is mid-flow, and
 * failing their acceptance or their portal over a Stripe hiccup would be worse
 * than leaving them the bank-transfer details.
 */
export async function raiseInvoiceForPayment(
  invoiceId: string,
  userId: string
): Promise<RaiseOutcome> {
  try {
    /* Read fresh, never from a caller's copy: the whole point is to find out
       whether somebody else has already raised this one. */
    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select(
        'id, user_id, amount, currency, due_date, client_email, client_name, invoice_number, line_items, stripe_invoice_id'
      )
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!invoice) return { ok: false, reason: 'not_billable' };

    if (invoice.stripe_invoice_id) {
      return { ok: true, stripeInvoiceId: invoice.stripe_invoice_id as string, existing: true };
    }

    const capability = await resolvePaymentCollectionCapability(supabaseServer, userId);
    if (!capability.canCollect || !capability.accountId) {
      /* A transfer-only business. The invoice page and the portal both offer
         bank details, so this is a complete answer rather than a failure. */
      return { ok: false, reason: 'cannot_collect' };
    }

    const email = invoice.client_email?.trim();
    if (!email) {
      logger.info({ invoiceId }, 'Cannot raise at Stripe: the invoice names no client address');
      return { ok: false, reason: 'not_billable' };
    }

    const rawLines = Array.isArray(invoice.line_items) ? (invoice.line_items as LineItem[]) : [];
    const lineItems = rawLines
      .filter(item => Number(item?.unit_price ?? item?.total ?? 0) > 0)
      .map(item => ({
        description: String(item.description ?? invoice.invoice_number ?? 'Invoice'),
        quantity: Number(item.quantity ?? 1),
        /* Stripe works in minor units; nothing else in this codebase does. */
        unit_price: Math.round(Number(item.unit_price ?? item.total ?? 0) * 100),
        total: Math.round(Number(item.total ?? item.unit_price ?? 0) * 100),
      }));

    if (lineItems.length === 0) {
      logger.info({ invoiceId }, 'Cannot raise at Stripe: no priced lines');
      return { ok: false, reason: 'not_billable' };
    }

    const service = getStripeInvoiceService();

    const created = await service.createInvoice({
      connectAccountId: capability.accountId,
      customerEmail: email,
      customerName: invoice.client_name || email,
      lineItems,
      dueDate: invoice.due_date ? new Date(invoice.due_date as string) : new Date(),
      currency: String(invoice.currency ?? 'usd').toLowerCase(),
      description: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : undefined,
      metadata: { invoice_id: invoice.id as string },
      /* See the header: silent, and one invoice per debt. */
      autoAdvance: false,
      idempotencyKey: `raise_invoice_${invoice.id}`,
    });

    const finalized = await service.finalizeForPayment(created.invoiceId, capability.accountId);

    /*
     * Recorded before anybody can pay, so the next visit finds the id instead
     * of raising a second invoice. Non-fatal: the idempotency key still covers
     * a repeat, and refusing the payment over a failed write would be worse
     * than the duplicate it is guarding against.
     */
    const { error } = await supabaseServer
      .from('payment_invoices')
      .update({
        stripe_invoice_id: finalized.invoiceId,
        stripe_hosted_invoice_url: finalized.hostedInvoiceUrl,
        stripe_invoice_pdf: finalized.invoicePdf,
      })
      .eq('id', invoice.id)
      .eq('user_id', userId);

    if (error) {
      logger.error(
        { err: error, invoiceId, stripeInvoiceId: finalized.invoiceId },
        'Raised at Stripe but could not record the id'
      );
    }

    logger.info(
      { invoiceId, stripeInvoiceId: finalized.invoiceId, status: finalized.status },
      'Invoice raised at Stripe so it can be paid in the portal'
    );

    return { ok: true, stripeInvoiceId: finalized.invoiceId };
  } catch (err) {
    logger.error({ err, invoiceId }, 'Could not raise the invoice at Stripe');
    return { ok: false, reason: 'stripe_failed' };
  }
}
