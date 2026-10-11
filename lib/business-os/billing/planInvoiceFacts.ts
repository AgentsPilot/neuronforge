/**
 * The facts of one Business OS plan invoice, read from Stripe's payload
 * (plan payments P-3b.2, workplan §3.1, §3.2 "the handler decides", §3.7).
 *
 * Pure: no I/O, no logging, no clock. The caller passes the invoice, its FULL
 * line list (fetched when the event's list was truncated, CF-2) and a lookup
 * from a price id to the tier it sells (the price catalog, through the plan
 * lookup keys). Either it returns the facts the apply function needs, or a
 * refusal reason; it never guesses a missing value.
 *
 * | Fact          | Rule                                                                     |
 * |---------------|--------------------------------------------------------------------------|
 * | tier          | The plan lines with a POSITIVE amount (an upgrade's credit line for the  |
 * |               | old tier is negative and ignored). Two tiers there → `mixed_tiers`. No   |
 * |               | positive plan line ($0 invoice) → the tier of the plan lines             |
 * | period        | From those same lines (`line.period`): the latest end, the earliest      |
 * |               | start. Never from the subscription fetched now, so a late replay carries |
 * |               | its own period                                                           |
 * | amount        | `amount_paid` for a paid invoice, `amount_due` for a failed one          |
 * | tax           | Sum of `total_taxes[].amount` (Basil); legacy `tax` as a fallback         |
 * | paidAt        | `status_transitions.paid_at`; required on a paid invoice                 |
 * | assignsPlan   | SA-P8 / SA-P16c: `amount_paid > 0`, or a discounted `subscription_cycle` |
 * |               | invoice (a 100% coupon still renews the plan). A $0 trial invoice does   |
 * |               | not. C-3 carry-forward (requirement CF-6, owner P-4): a $0               |
 * |               | `subscription_update` paid from the credit balance does not either      |
 * | bosUserIdClaim| `bos_user_id` on the subscription snapshot, else on the invoice. A       |
 * |               | CROSS-CHECK only: it never chooses the account (SR-8)                    |
 *
 * The currency is returned as Stripe states it; the USD rule (SA-P15) is the
 * caller's, so a refusal can still record the amounts.
 *
 * @module lib/business-os/billing/planInvoiceFacts
 */

import type Stripe from 'stripe';

import { priceIdOfLine } from '@/lib/payments/invoiceLinePrices';
import { subscriptionIdFromInvoice, subscriptionMetadataFromInvoice } from '@/lib/payments/invoiceSubscription';
import { BOS_USER_ID_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';

export type PlanInvoiceKind = 'paid' | 'failed';

export type PlanInvoiceFactsRefusal =
  /** A required field is missing or unreadable (ids, period, amount, paid_at on a paid invoice). */
  | 'malformed_invoice'
  /** Positive plan lines sell two different tiers. */
  | 'mixed_tiers'
  /** No line names a plan price the catalog knows (the router said it did: a race with the catalog). */
  | 'no_plan_line';

/** What can be read even from an invoice that is refused: ids and amounts for the money history. */
export interface PlanInvoiceIdentity {
  invoiceId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  bosUserIdClaim: string | null;
  currency: string | null;
  amountMinor: number | null;
  amountTaxMinor: number | null;
  paidAt: string | null;
}

export interface PlanInvoiceFacts {
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
  bosUserIdClaim: string | null;
  /** Lower-case ISO code as Stripe states it; the USD check is the caller's. */
  currency: string;
  tier: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  amountTaxMinor: number;
  /** Required (non-null) for a paid invoice; null for a failed one. */
  paidAt: string | null;
  assignsPlan: boolean;
  billingReason: string | null;
}

export type PlanInvoiceFactsResult =
  | { ok: true; facts: PlanInvoiceFacts }
  | { ok: false; reason: PlanInvoiceFactsRefusal; identity: PlanInvoiceIdentity };

type Ref = string | { id?: string | null } | null | undefined;

function idOf(ref: Ref): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return ref.id ?? null;
}

function isMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isoFromUnix(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

/** Sum of the Basil `total_taxes[].amount`; the legacy integer `tax` when the Basil field is absent. */
function taxOf(invoice: Stripe.Invoice): number | null {
  const basil = (invoice as unknown as { total_taxes?: Array<{ amount?: unknown }> | null }).total_taxes;
  if (Array.isArray(basil)) {
    let sum = 0;
    for (const entry of basil) {
      if (!isMinor(entry?.amount)) return null;
      sum += entry.amount;
    }
    return sum;
  }
  if (basil === null) return 0;
  const legacy = (invoice as unknown as { tax?: unknown }).tax;
  if (legacy === undefined || legacy === null) return 0;
  return isMinor(legacy) ? legacy : null;
}

function claimOf(invoice: Stripe.Invoice): string | null {
  const fromSubscription = subscriptionMetadataFromInvoice(invoice)[BOS_USER_ID_METADATA_KEY];
  if (fromSubscription) return fromSubscription;
  const fromInvoice = invoice.metadata?.[BOS_USER_ID_METADATA_KEY];
  return fromInvoice ? fromInvoice : null;
}

/** Did a discount apply? Any entry in the invoice's `discounts`. */
function isDiscounted(invoice: Stripe.Invoice): boolean {
  const discounts = (invoice as unknown as { discounts?: unknown }).discounts;
  return Array.isArray(discounts) && discounts.length > 0;
}

/** The ids and amounts readable from any invoice, for a refusal row. */
export function planInvoiceIdentity(invoice: Stripe.Invoice, kind: PlanInvoiceKind): PlanInvoiceIdentity {
  const amount = kind === 'paid' ? invoice.amount_paid : invoice.amount_due;
  const currency = typeof invoice.currency === 'string' && invoice.currency ? invoice.currency.toLowerCase() : null;
  return {
    invoiceId: typeof invoice.id === 'string' && invoice.id ? invoice.id : null,
    customerId: idOf(invoice.customer as Ref),
    subscriptionId: subscriptionIdFromInvoice(invoice),
    bosUserIdClaim: claimOf(invoice),
    currency,
    amountMinor: isMinor(amount) ? amount : null,
    amountTaxMinor: taxOf(invoice),
    paidAt: isoFromUnix(invoice.status_transitions?.paid_at),
  };
}

/**
 * Read the facts of a plan invoice. `lines` is the COMPLETE line list;
 * `tierOfPrice` answers the tier a price sells, or null for a price that is
 * not a plan price.
 */
export function planInvoiceFacts(
  invoice: Stripe.Invoice,
  lines: readonly Stripe.InvoiceLineItem[],
  tierOfPrice: (priceId: string) => string | null,
  kind: PlanInvoiceKind
): PlanInvoiceFactsResult {
  const identity = planInvoiceIdentity(invoice, kind);
  const refuse = (reason: PlanInvoiceFactsRefusal): PlanInvoiceFactsResult => ({ ok: false, reason, identity });

  const { invoiceId, customerId, subscriptionId, currency, amountMinor, amountTaxMinor, paidAt } = identity;
  if (!invoiceId || !customerId || !subscriptionId || !currency || amountMinor === null || amountTaxMinor === null) {
    return refuse('malformed_invoice');
  }
  if (kind === 'paid' && paidAt === null) return refuse('malformed_invoice');

  const planLines: Array<{ tier: string; amount: number; start: number; end: number }> = [];
  for (const line of lines) {
    const priceId = priceIdOfLine(line);
    if (!priceId) continue;
    const tier = tierOfPrice(priceId);
    if (!tier) continue;
    const { amount } = line;
    const start = line.period?.start;
    const end = line.period?.end;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) return refuse('malformed_invoice');
    if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || start <= 0) {
      return refuse('malformed_invoice');
    }
    planLines.push({ tier, amount, start, end });
  }
  if (planLines.length === 0) return refuse('no_plan_line');

  // An upgrade's credit for the unused time on the OLD tier is a negative line:
  // only what the customer is charged for names the tier (§3.2).
  const positive = planLines.filter((l) => l.amount > 0);
  const deciding = positive.length > 0 ? positive : planLines;
  const tiers = [...new Set(deciding.map((l) => l.tier))];
  if (tiers.length !== 1) return refuse('mixed_tiers');

  const periodStart = isoFromUnix(Math.min(...deciding.map((l) => l.start)));
  const periodEnd = isoFromUnix(Math.max(...deciding.map((l) => l.end)));
  if (!periodStart || !periodEnd) return refuse('malformed_invoice');

  const billingReason = typeof invoice.billing_reason === 'string' ? invoice.billing_reason : null;
  const assignsPlan =
    kind === 'paid' &&
    ((invoice.amount_paid ?? 0) > 0 || (billingReason === 'subscription_cycle' && isDiscounted(invoice)));

  return {
    ok: true,
    facts: {
      invoiceId,
      customerId,
      subscriptionId,
      bosUserIdClaim: identity.bosUserIdClaim,
      currency,
      tier: tiers[0],
      periodStart,
      periodEnd,
      amountMinor,
      amountTaxMinor,
      paidAt,
      assignsPlan,
      billingReason,
    },
  };
}
