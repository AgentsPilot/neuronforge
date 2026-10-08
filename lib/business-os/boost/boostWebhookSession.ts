/**
 * The boost checkout session, as the Stripe webhook reads it (credits boost
 * slice 4a; requirement R-6, T-4, T-7; SA C-3, C-8 a, Q-1, Q-3).
 *
 * Two things live here, shared by the resolver and the handler:
 *
 *   - `parseBoostSession`: the Zod narrowing of a Stripe Checkout Session from
 *     a signature-verified event. Everything the handler passes on to the
 *     repository has been checked here first, so a repository validation
 *     refusal (2b QA I-3) is unreachable from a well-formed event.
 *   - `findBoostPurchaseForSession`: which purchase row a session belongs to.
 *     One keyed read by session id. On a miss, ONLY if the session carries the
 *     boost marker and a UUID `client_reference_id` (written by our server when
 *     it created the session), a second read by that id (C-8 a). The result
 *     says how the row was found, because a row found by reference is treated
 *     differently: it is credited only when its stored session is NULL (C-3).
 *
 * Metadata never routes and never names an account: who a payment belongs to
 * is the row's `accountId` (SR-8, tenant-isolation-guard Step 6). The marker is
 * a cross-check (HP-3).
 *
 * A repository error is returned as `{ kind: 'error' }` with the failure, so the
 * caller decides: the resolver throws (release, SA Q-6), the handler classifies.
 *
 * @module lib/business-os/boost/boostWebhookSession
 */

import { z } from 'zod';

import {
  BOS_BOOST_PRODUCT_MARKER,
  BOS_PRODUCT_METADATA_KEY,
  LEGACY_PILOT_CREDIT_METADATA_KEYS,
} from '@/lib/business-os/billing/stripeMetadataKeys';
import type {
  BusinessOsBoostPurchase,
  BusinessOsBoostPurchaseRepository,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

/** The four platform events slice 4a handles (T-7). Refunds and disputes are 4b. */
export const BOOST_SESSION_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
] as const;
export type BoostSessionEventType = (typeof BOOST_SESSION_EVENT_TYPES)[number];

export function isBoostSessionEventType(type: string): type is BoostSessionEventType {
  return (BOOST_SESSION_EVENT_TYPES as readonly string[]).includes(type);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^cs_[A-Za-z0-9_]{1,191}$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{1,252}$/;

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** The fields 4a reads. Unknown fields are ignored (Stripe adds fields freely). */
const boostSessionSchema = z.object({
  id: z.string().regex(SESSION_ID),
  mode: z.literal('payment'),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  // Payment mode always has an intent once the session is completed; it may be
  // absent on an expired session.
  payment_intent: z
    .union([z.string().regex(PAYMENT_INTENT_ID), z.object({ id: z.string().regex(PAYMENT_INTENT_ID) }).passthrough()])
    .nullable()
    .optional(),
  amount_subtotal: minor.nullable(),
  amount_total: minor.nullable(),
  total_details: z.object({ amount_tax: minor.nullable().optional() }).passthrough().nullable().optional(),
  currency: z.string().min(1).max(10).nullable(),
  client_reference_id: z.string().max(200).nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

/** A narrowed session: only what the handler uses, in the repository's shape. */
export interface BoostSession {
  id: string;
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  paymentIntentId: string | null;
  amountSubtotalMinor: number | null;
  amountTaxMinor: number;
  amountTotalMinor: number | null;
  currency: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
}

export type BoostSessionParse = { ok: true; session: BoostSession } | { ok: false; issues: string[] };

/** Narrow a Stripe Checkout Session. Issues are field paths and codes only, never values. */
export function parseBoostSession(raw: unknown): BoostSessionParse {
  const parsed = boostSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`) };
  }
  const value = parsed.data;
  const intent = value.payment_intent;
  return {
    ok: true,
    session: {
      id: value.id,
      paymentStatus: value.payment_status,
      paymentIntentId: intent == null ? null : typeof intent === 'string' ? intent : intent.id,
      amountSubtotalMinor: value.amount_subtotal,
      amountTaxMinor: value.total_details?.amount_tax ?? 0,
      amountTotalMinor: value.amount_total,
      currency: value.currency,
      clientReferenceId: value.client_reference_id ?? null,
      metadata: value.metadata ?? {},
    },
  };
}

/** The session says it is a Business OS boost (the cross-check marker, never a route). */
export function hasBoostMarker(metadata: Record<string, unknown> | null | undefined): boolean {
  return (metadata ?? {})[BOS_PRODUCT_METADATA_KEY] === BOS_BOOST_PRODUCT_MARKER;
}

/**
 * The metadata disagrees with a boost row (HP-3): another product's marker, or
 * the agent-platform Pilot-Credit keys. Absent metadata does not disagree.
 */
export function boostMetadataDisagrees(metadata: Record<string, unknown> | null | undefined): boolean {
  const values = metadata ?? {};
  const product = values[BOS_PRODUCT_METADATA_KEY];
  if (typeof product === 'string' && product !== '' && product !== BOS_BOOST_PRODUCT_MARKER) return true;
  return LEGACY_PILOT_CREDIT_METADATA_KEYS.some((key) => {
    const value = values[key];
    return typeof value === 'string' && value !== '';
  });
}

/** The two reads this module makes. */
export type BoostPurchaseLookupPort = Pick<BusinessOsBoostPurchaseRepository, 'findBySessionIdForWebhook' | 'findByIdForWebhook'>;

/** The minimum of a session the lookup needs; works on a raw or a narrowed session. */
export interface SessionKeys {
  id: string;
  clientReferenceId: string | null;
  metadata: Record<string, unknown> | null;
}

export type BoostPurchaseLookup =
  /** Found by its own session id: the normal case. */
  | { kind: 'by_session'; row: BusinessOsBoostPurchase }
  /** Found by `client_reference_id` after a session-id miss (C-8 a). See C-3. */
  | { kind: 'by_reference'; row: BusinessOsBoostPurchase }
  /** No row. `marked`: the session claims to be a boost (→ deny metadata_mismatch). */
  | { kind: 'none'; marked: boolean }
  | { kind: 'error'; error: Error };

/** The keys of a raw Stripe session object, read defensively. */
export function sessionKeysOf(raw: unknown): SessionKeys | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { id?: unknown; client_reference_id?: unknown; metadata?: unknown };
  if (typeof value.id !== 'string') return null;
  return {
    id: value.id,
    clientReferenceId: typeof value.client_reference_id === 'string' ? value.client_reference_id : null,
    metadata: value.metadata && typeof value.metadata === 'object' ? (value.metadata as Record<string, unknown>) : null,
  };
}

/** Which purchase row this session belongs to. At most two keyed reads; never an account from the event. */
export async function findBoostPurchaseForSession(
  session: SessionKeys,
  purchases: BoostPurchaseLookupPort
): Promise<BoostPurchaseLookup> {
  if (SESSION_ID.test(session.id)) {
    const bySession = await purchases.findBySessionIdForWebhook(session.id);
    if (bySession.error) return { kind: 'error', error: bySession.error };
    if (bySession.data) return { kind: 'by_session', row: bySession.data };
  }

  const marked = hasBoostMarker(session.metadata);
  const reference = session.clientReferenceId;
  if (!marked || reference === null || !UUID_PATTERN.test(reference)) return { kind: 'none', marked };

  const byReference = await purchases.findByIdForWebhook(reference);
  if (byReference.error) return { kind: 'error', error: byReference.error };
  if (byReference.data) return { kind: 'by_reference', row: byReference.data };
  return { kind: 'none', marked };
}
