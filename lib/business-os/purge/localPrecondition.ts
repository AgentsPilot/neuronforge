// lib/business-os/purge/localPrecondition.ts
//
// Slice 2, control 2 — the local-only blocking-state precondition.
//
// ── This is a LITERAL SUBSET of slice 4's gate ─────────────────────────────
// Same tables, same statuses, same predicate. It must not diverge by one
// value. If it does, slice 4 stops being a replacement and becomes a
// reconciliation between two gates that disagree — and the reconciliation would
// have to be done by whoever is least equipped to do it, at the moment a
// customer is trying to delete their business.
//
// Slice 4 will read these same conditions FROM STRIPE, which is authoritative.
// This reads them from the local mirror, which is not. That is the whole
// difference, and it is why this is a subset rather than an alternative.
//
// ── Why this exists at all, given control 1 ────────────────────────────────
// Control 1 (SA-S5) refuses whenever `resolveUserConnectAccounts()` returns
// anything at all, which removes the entire provider-state class — including
// the residual nothing local can see: Stripe-dashboard state with no local row.
//
// It would be easy to conclude this control is therefore redundant. It is not.
// **Locally-originated blocking state exists with no Stripe account anywhere**:
// a manually-issued invoice sitting `sent` or `overdue`, a manual payment row
// left `pending`. Control 1 never fires for such a business, because it has no
// Connect account — and its books are still mid-flight. Neither control
// subsumes the other.

/**
 * One blocking condition: a table, the statuses that count as "in flight", and
 * the requirement condition it implements.
 *
 * Expressed as DATA rather than as four hand-written queries so that slice 4
 * can diff its own condition set against this one mechanically. Two lists of
 * strings can be compared; four bespoke queries cannot.
 */
export interface LocalBlockingCondition {
  /** Requirement condition id — C1, C2 or C3. */
  condition: 'C1' | 'C2' | 'C3';
  table: string;
  /** Statuses that block. Matched with `.in('status', …)` — equality only. */
  statuses: readonly string[];
  /** Shown to the operator when this condition blocks. */
  label: string;
}

/**
 * The four predicates, verbatim from the requirement.
 *
 * ⚠️ Changing any status string here silently changes what "in flight" means.
 * If the reconciler and the gate disagree about that, the gate produces a FALSE
 * ALL-CLEAR — the single failure mode in this design that fails toward deletion
 * rather than toward refusal. Everything else fails safe; this does not.
 *
 * The vocabulary is borrowed, not invented: `payment_refunds.status` is
 * `CHECK (status IN ('pending','succeeded','failed','canceled'))` per
 * `20260828b_payment_refund_ledger.sql`, and the reconciler's own queue is
 * `WHERE status = 'pending'`.
 */
export const LOCAL_BLOCKING_CONDITIONS: readonly LocalBlockingCondition[] = [
  {
    condition: 'C1',
    table: 'payment_plan_subscriptions',
    statuses: ['pending', 'active', 'past_due', 'paused'],
    label: 'recurring payment plan(s) still running',
  },
  {
    condition: 'C2',
    table: 'payment_transactions',
    statuses: ['pending'],
    label: 'payment(s) still pending',
  },
  {
    condition: 'C2',
    table: 'payment_refunds',
    statuses: ['pending'],
    label: 'refund(s) still in flight',
  },
  {
    condition: 'C3',
    table: 'payment_invoices',
    statuses: ['sent', 'overdue'],
    label: 'unpaid invoice(s) owed to this business',
  },
] as const;

export interface LocalBlockingHit {
  condition: 'C1' | 'C2' | 'C3';
  table: string;
  count: number;
  label: string;
}

export type LocalPreconditionResult =
  | { outcome: 'clear' }
  | { outcome: 'blocked'; hits: LocalBlockingHit[] }
  /** A condition could not be read. Never treated as "clear". */
  | { outcome: 'refused'; reason: string };

/**
 * Decide from the counted rows.
 *
 * A `null` count means the read failed, and that refuses. The rule from the
 * requirement is "a failed read is not a 'no'" — an unreadable condition is
 * indistinguishable from a blocking one, so it must be treated as the worse of
 * the two.
 */
export function decideLocalPrecondition(
  counts: ReadonlyArray<{ condition: 'C1' | 'C2' | 'C3'; table: string; label: string; count: number | null }>
): LocalPreconditionResult {
  const unreadable = counts.filter((c) => c.count === null);
  if (unreadable.length > 0) {
    return {
      outcome: 'refused',
      reason: `could not read blocking state for: ${unreadable.map((c) => c.table).join(', ')}`,
    };
  }

  const hits = counts
    .filter((c) => (c.count ?? 0) > 0)
    .map<LocalBlockingHit>((c) => ({
      condition: c.condition,
      table: c.table,
      count: c.count as number,
      label: c.label,
    }));

  return hits.length > 0 ? { outcome: 'blocked', hits } : { outcome: 'clear' };
}
