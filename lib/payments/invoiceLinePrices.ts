/**
 * Which prices an invoice charges for, read from its lines.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `line.price` DOES NOT EXIST on the API version this codebase pins
 * (`2025-10-29.clover`). Since the Basil release a line names its price through
 * `line.pricing.price_details.price` (a price id, or the price object when the
 * caller expanded it). Reading the old field returns `undefined` without any
 * error, which is how `invoice.subscription` silently broke payment plans (see
 * `invoiceSubscription.ts`).
 *
 * One reader, so there is one place to be wrong. The legacy `line.price` is
 * still checked as a fallback: events replayed from before the version bump,
 * and anything delivered by an endpoint on an older API version, carry it.
 *
 * `truncated` reports `lines.has_more`: an event embeds only the first page of
 * lines, so a caller that must see every price cannot trust a truncated list.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/invoiceLinePrices
 */

import type Stripe from 'stripe';

export interface InvoiceLinePrices {
  /** Distinct price ids, in the order their lines appear. */
  readonly priceIds: string[];
  /** Lines that carry no price at all (neither the Basil nor the legacy field). */
  readonly unpricedLines: number;
  /** True when the invoice has more lines than the ones embedded in it. */
  readonly truncated: boolean;
}

type PriceRef = string | { id?: string | null } | null | undefined;

function idOf(ref: PriceRef): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return ref.id ?? null;
}

/** The price id behind one invoice line, or null if the line carries none. */
export function priceIdOfLine(line: Stripe.InvoiceLineItem): string | null {
  // Basil: the SDK types `price` as a string, but an expanded fetch returns the
  // object, so both are accepted.
  const basil = idOf(line.pricing?.price_details?.price as PriceRef);
  if (basil) return basil;

  // Pre-Basil deliveries and replayed events.
  return idOf((line as unknown as { price?: PriceRef }).price);
}

export function invoiceLinePriceIds(invoice: Stripe.Invoice): InvoiceLinePrices {
  const lines = invoice.lines?.data ?? [];
  const priceIds: string[] = [];
  let unpricedLines = 0;

  for (const line of lines) {
    const priceId = priceIdOfLine(line);
    if (!priceId) {
      unpricedLines += 1;
    } else if (!priceIds.includes(priceId)) {
      priceIds.push(priceId);
    }
  }

  return { priceIds, unpricedLines, truncated: invoice.lines?.has_more === true };
}
