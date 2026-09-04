/**
 * The payment intent that settled a Stripe invoice, across API versions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-2025 the Invoice object carried `payment_intent` directly. That field was
 * REMOVED; settlement now hangs off `invoice.payments[].payment.payment_intent`,
 * and the list is not always inlined in a webhook payload — the payload is
 * serialized at the endpoint's configured API version, which nobody here
 * controls.
 *
 * Reading only the old field records every invoice payment with a null id, and
 * Stripe needs a payment intent or a charge to refund against — so each of those
 * payments is permanently unrefundable. That is not hypothetical: it is exactly
 * what happened to every payment plan installment on this platform.
 *
 * Lives here rather than inside the webhook route because the backfill needs the
 * same answer for money already collected. Two implementations of "where does
 * Stripe keep this now" would drift the next time Stripe moves it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/invoicePaymentIntent
 */

import type Stripe from 'stripe';

const asId = (value: unknown): string | null =>
  typeof value === 'string' ? value : (value as { id?: string })?.id ?? null;

type InvoicePayments = { data?: Array<{ payment?: { payment_intent?: unknown } }> };

/**
 * @param invoice   the invoice as received, in whichever shape
 * @param stripe    a client, so the caller owns construction and the key
 * @param account   the connected account the invoice lives on — required for
 *                  the re-fetch, since a direct-charge invoice is invisible from
 *                  the platform account
 */
export async function resolveInvoicePaymentIntent(
  invoice: Stripe.Invoice,
  stripe: Stripe,
  account: string | null
): Promise<string | null> {
  // Old shape.
  const legacy = asId((invoice as unknown as { payment_intent?: unknown }).payment_intent);
  if (legacy) return legacy;

  // New shape, when the payload inlined it.
  const inlined = asId(
    (invoice as unknown as { payments?: InvoicePayments }).payments?.data?.[0]?.payment?.payment_intent
  );
  if (inlined) return inlined;

  if (!invoice.id) return null;

  /*
   * New shape, not inlined — ask for it.
   *
   * One extra request on a path that runs once per payment, and it buys the
   * difference between a refundable payment and an unrefundable one.
   */
  try {
    const expanded = (await stripe.invoices.retrieve(
      invoice.id,
      { expand: ['payments'] } as Stripe.InvoiceRetrieveParams,
      account ? { stripeAccount: account } : undefined
    )) as unknown as { payments?: InvoicePayments };

    return asId(expanded.payments?.data?.[0]?.payment?.payment_intent);
  } catch {
    // The caller decides what a missing reference means. Here it is only
    // unknown — never guessed, because a wrong payment intent would refund
    // someone else's charge.
    return null;
  }
}
