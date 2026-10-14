/**
 * How a Stripe refund maps onto the refund ledger (`payment_refunds`).
 *
 * A LEAF on purpose (SA Q-SA-2): it imports nothing that does I/O, no
 * repository, no Stripe client, no Supabase. The Stripe webhook route and
 * `RefundService` both import it, and keeping it a leaf keeps `RefundService`'s
 * dependencies out of the webhook's test harness. Do not add an import here
 * that reaches the network or the database.
 *
 * Requirement: docs/requirements/STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md
 * Workplan:    docs/workplans/STRIPE_CONNECT_REFUND_WEBHOOK_WORKPLAN.md §3
 *
 * @module lib/payments/stripeRefundLedger
 */

// Another leaf (no imports of its own), so this module stays a leaf.
import { isUuidShaped } from './ownedLinkId';

/**
 * The Stripe refund metadata key that names the app's own ledger row (FR 15,
 * SA-3).
 *
 * `RefundService.refund()` writes it on every Stripe refund it creates, so the
 * webhook can find the app's row before the app has learned Stripe's refund id
 * (F1: the `refund.created` event can arrive before the app's own write). The
 * value is the ledger row's UUID and nothing else. The same name is already
 * read by `scripts/reconcile-stripe-payments.ts`'s exact-match path.
 */
export const REFUND_ROW_ID_METADATA_KEY = 'refund_row_id' as const;

// ── Slice 2: recording `refund.*` events (FR 5, FR 6, A-1, A-3) ─────────────

/** The four statuses the `payment_refunds.status` CHECK allows (SA-8, U-1). */
export type LedgerRefundStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';

/**
 * Stripe's refund status as a ledger status (FR 5).
 *
 * `requires_action` is still in flight, so it is `pending`. `null` and any
 * value Stripe has not documented return `null`: the caller records nothing on
 * a guess (SA Q-SA-3), because a guessed `pending` row would hold refund budget
 * in `refund_guard_before`, and a later `refund.updated` carries a real status.
 */
export function mapStripeRefundStatus(status: string | null | undefined): LedgerRefundStatus | null {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'pending':
    case 'requires_action':
      return 'pending';
    default:
      return null;
  }
}

/** What a Stripe status does to a ledger row's status. */
export type LedgerTransition =
  | { kind: 'apply'; status: LedgerRefundStatus; /** Log a warning: an undocumented move. */ warn: boolean }
  | { kind: 'noop' };

/**
 * The FR 6 transition table (SA-5, A-3). Statuses never move backwards.
 *
 * | Incoming    | Applies from                                            |
 * |-------------|---------------------------------------------------------|
 * | `pending`   | `failed` / `canceled` only with no Stripe id            |
 * | `succeeded` | `pending`; `failed` / `canceled` only with no Stripe id |
 * | `failed`    | `pending`, `succeeded`                                  |
 * | `canceled`  | `pending`, `succeeded` (`succeeded` → warn)             |
 *
 * `hasStripeId` is whether the row already has a `processor_refund_id`. A row
 * without one has had no Stripe verdict: its `failed` was written by the app's
 * catch path after a lost reply or a timeout, so Stripe may still say the money
 * moved. With one, `failed` / `canceled` is Stripe's own answer and final.
 *
 * That is also why `pending` applies to such a row (SA CR-1, amending A-3):
 * Stripe saying the refund exists and is in flight overrides the app's guess
 * of `failed`. If the row stayed `failed` while the event filled its Stripe id,
 * the later `succeeded` would become a no-op (a row WITH an id never moves from
 * `failed`), and the books would say failed for money that left.
 *
 * Status only: filling a missing `processor_refund_id` on a no-op is the
 * caller's decision, not this table's.
 */
export function nextLedgerRefundStatus(
  current: LedgerRefundStatus,
  hasStripeId: boolean,
  incoming: LedgerRefundStatus
): LedgerTransition {
  switch (incoming) {
    case 'pending':
      // A lost-reply row (`failed` / `canceled`, no Stripe id) has no Stripe
      // verdict yet: Stripe's `pending` replaces the app's guess (CR-1).
      // pending → pending changes nothing, and a Stripe verdict stays.
      if ((current === 'failed' || current === 'canceled') && !hasStripeId) {
        return { kind: 'apply', status: 'pending', warn: false };
      }
      return { kind: 'noop' };
    case 'succeeded':
      if (current === 'pending') return { kind: 'apply', status: 'succeeded', warn: false };
      if ((current === 'failed' || current === 'canceled') && !hasStripeId) {
        return { kind: 'apply', status: 'succeeded', warn: false };
      }
      return { kind: 'noop' };
    case 'failed':
      if (current === 'pending' || current === 'succeeded') return { kind: 'apply', status: 'failed', warn: false };
      return { kind: 'noop' };
    case 'canceled':
      if (current === 'pending') return { kind: 'apply', status: 'canceled', warn: false };
      // Stripe documents `canceled` only from `requires_action`, so a succeeded
      // refund being canceled is applied (it is Stripe's word) but flagged.
      if (current === 'succeeded') return { kind: 'apply', status: 'canceled', warn: true };
      return { kind: 'noop' };
  }
}

/**
 * The ledger row id named in a Stripe refund's metadata, shape-checked only
 * (A-1, first check). Metadata is UNTRUSTED: a connected business can write
 * any value on a refund it makes in its own dashboard.
 *
 * - key absent or empty → `{ id: null }`
 * - not UUID-shaped → `{ id: null, malformedLength }`: only the LENGTH is ever
 *   logged, never the value (the same rule as `ownedOrNull`)
 * - UUID-shaped → `{ id }`, still to be read inside the proven payment and
 *   checked by `untrustedAppRowCheck`
 */
export function vetLedgerRowIdCandidate(
  metadata: Readonly<Record<string, string>> | null | undefined
): { id: string | null; malformedLength?: number } {
  const raw = metadata?.[REFUND_ROW_ID_METADATA_KEY];
  if (typeof raw !== 'string' || raw.length === 0) return { id: null };
  if (!isUuidShaped(raw)) return { id: null, malformedLength: raw.length };
  return { id: raw };
}

/** The ledger columns the A-1 checks read. */
export interface LedgerRowForMatch {
  source: string;
  processor_type: string;
  amount_minor: number;
  currency: string;
  processor_refund_id: string | null;
}

/** The Stripe refund fields the A-1 checks compare against. */
export interface StripeRefundForMatch {
  id: string;
  amount: number;
  currency: string | null;
}

/** Which A-1 check failed. A closed set, so the warn log's values are too. */
export type UntrustedRowCheck = 'source' | 'processor_type' | 'amount_minor' | 'currency' | 'processor_refund_id';

/**
 * The A-1 checks on a row reached through the metadata id (FR 3 b). Returns the
 * name of the first failing check, or `null` when the row is the app's own
 * Stripe refund for exactly this money.
 *
 * The row was already read inside the proven payment (`id` + `transaction_id`
 * + `user_id`), so a foreign row is never seen here. What remains is to stop a
 * business folding a dashboard refund into one of its own MANUAL rows, or into
 * a row for a different amount, currency or Stripe refund, which would
 * undercount what was returned.
 */
export function untrustedAppRowCheck(row: LedgerRowForMatch, refund: StripeRefundForMatch): UntrustedRowCheck | null {
  if (row.source !== 'app') return 'source';
  if (row.processor_type !== 'stripe') return 'processor_type';
  if (Number(row.amount_minor) !== refund.amount) return 'amount_minor';
  if (!refund.currency || row.currency.toUpperCase() !== refund.currency.toUpperCase()) return 'currency';
  if (row.processor_refund_id !== null && row.processor_refund_id !== refund.id) return 'processor_refund_id';
  return null;
}
