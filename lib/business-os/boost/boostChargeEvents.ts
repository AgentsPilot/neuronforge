/**
 * Refund and dispute events on a boost charge, as the Stripe webhook reads
 * them (credits boost slice 4b.1; requirement FR-35, FR-36, T-9, R-6; SA
 * Q-2, C-1, C-8; 4a SA N-1).
 *
 * Identity is ONLY the payment intent stored on our purchase row. A boost
 * payment is always a PaymentIntent charge (slice 3), so a refund's
 * `charge.payment_intent` and a dispute's `dispute.payment_intent` are set. A
 * charge or dispute without one cannot be a boost payment and keeps the legacy
 * path (SA Q-2: no charge-id lookup). Metadata is never read here: a charge
 * does not carry the session's metadata, and nothing in the event may choose a
 * row except our own stored identifier.
 *
 * @module lib/business-os/boost/boostChargeEvents
 */

import { z } from 'zod';

/** The four platform events slice 4b.1 handles. */
export const BOOST_CHARGE_EVENT_TYPES = [
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'charge.dispute.funds_reinstated',
] as const;
export type BoostChargeEventType = (typeof BOOST_CHARGE_EVENT_TYPES)[number];

export function isBoostChargeEventType(type: string): type is BoostChargeEventType {
  return (BOOST_CHARGE_EVENT_TYPES as readonly string[]).includes(type);
}

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{1,252}$/;
const CHARGE_ID = /^(ch|py)_[A-Za-z0-9_]{1,250}$/;
const DISPUTE_ID = /^(dp|du)_[A-Za-z0-9_]{1,250}$/;

const intentRef = z.union([
  z.string().regex(PAYMENT_INTENT_ID),
  z.object({ id: z.string().regex(PAYMENT_INTENT_ID) }).passthrough(),
]);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** The payment intent a refund or dispute event names, or null (then it is not a boost payment). */
export function paymentIntentOfChargeEvent(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = intentRef.safeParse((raw as { payment_intent?: unknown }).payment_intent);
  if (!parsed.success) return null;
  return typeof parsed.data === 'string' ? parsed.data : parsed.data.id;
}

const refundSchema = z.object({
  id: z.string().regex(CHARGE_ID),
  payment_intent: intentRef,
  amount_refunded: minor,
  currency: z.string().min(1).max(10),
  refunded: z.boolean().optional(),
});

const disputeSchema = z.object({
  id: z.string().regex(DISPUTE_ID),
  payment_intent: intentRef,
  status: z.string().min(1).max(64),
  currency: z.string().min(1).max(10),
});

export type BoostChargeEvent =
  | { kind: 'refund'; chargeId: string; paymentIntentId: string; amountRefundedMinor: number; currency: string; fullyRefunded: boolean | null }
  | { kind: 'dispute'; disputeId: string; paymentIntentId: string; status: string; currency: string };

export type BoostChargeParse = { ok: true; event: BoostChargeEvent } | { ok: false; issues: string[] };

/** Narrow a refund (Charge) or dispute (Dispute) object. Issues are paths and codes only, never values. */
export function parseBoostChargeEvent(type: BoostChargeEventType, raw: unknown): BoostChargeParse {
  const issues = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`);
  if (type === 'charge.refunded') {
    const parsed = refundSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: issues(parsed.error) };
    const v = parsed.data;
    return {
      ok: true,
      event: {
        kind: 'refund',
        chargeId: v.id,
        paymentIntentId: typeof v.payment_intent === 'string' ? v.payment_intent : v.payment_intent.id,
        amountRefundedMinor: v.amount_refunded,
        currency: v.currency,
        fullyRefunded: v.refunded ?? null,
      },
    };
  }
  const parsed = disputeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issues(parsed.error) };
  const v = parsed.data;
  return {
    ok: true,
    event: {
      kind: 'dispute',
      disputeId: v.id,
      paymentIntentId: typeof v.payment_intent === 'string' ? v.payment_intent : v.payment_intent.id,
      status: v.status,
      currency: v.currency,
    },
  };
}

/** SA C-1: Stripe sends `usd`, our row stores `USD`. */
export function sameCurrency(stripeCurrency: string, rowCurrency: string): boolean {
  return stripeCurrency.toUpperCase() === rowCurrency.toUpperCase();
}
