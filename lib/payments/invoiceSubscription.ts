/**
 * Which subscription an invoice belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `invoice.subscription` DOES NOT EXIST on the API version this codebase pins
 * (`2025-10-29.clover`). Stripe moved it into `invoice.parent` in the Basil
 * release: a subscription invoice now says so through
 * `parent.subscription_details.subscription`, and the old top-level field is
 * gone from the object entirely.
 *
 * It was still being read in six places, every one of them through an `as any`
 * or an `as unknown as {...}` cast — which is exactly why nothing failed
 * loudly. The cast suppressed the type error, the field came back `undefined`,
 * and each caller took its "not a subscription invoice" branch. So a payment
 * plan charged perfectly in Stripe and recorded NOTHING locally: every period
 * after the first fell through `recordPlanPeriodPaid` untouched, and the money
 * list read "0 of 3 paid" while the client's card was debited every month.
 *
 * One reader, so there is one place to be wrong. The legacy field is still
 * checked as a fallback: events replayed from before the version bump, and
 * anything delivered on an older API version, still carry it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/invoiceSubscription
 */

import type Stripe from 'stripe';

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id ?? null;
}

/** The subscription id behind an invoice, or null if it is a one-off. */
export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  const fromParent = idOf(parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  // Pre-Basil deliveries and replayed events.
  return idOf((invoice as unknown as { subscription?: string | { id: string } }).subscription);
}

/**
 * The subscription's metadata as it stood when the invoice was finalised.
 *
 * An immutable snapshot Stripe attaches to the invoice, so the plan's terms can
 * be read without a second API call — and cannot be changed out from under a
 * webhook by an edit to the subscription after the fact.
 */
export function subscriptionMetadataFromInvoice(invoice: Stripe.Invoice): Stripe.Metadata {
  return invoice.parent?.subscription_details?.metadata ?? {};
}
