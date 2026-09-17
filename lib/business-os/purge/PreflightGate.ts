// lib/business-os/purge/PreflightGate.ts
//
// T13 — the pre-flight external-state gate.
//
// ⚠️ DRY-RUN SLICE. Exactly ONE path of this gate is implemented: the
// skip-clean path for a business with no Stripe account on record (FR-8,
// AC-11). Everything else REFUSES.
//
// That asymmetry is the whole point. The requirement's failure semantics are
// "a failed read is not a 'no' — it refuses, loudly", and an unimplemented
// condition is a failed read by definition. So a business WITH Stripe connected
// gets `outcome: 'refused'` with `refusalReason: 'not_implemented'`, never a
// pass. The one thing this gate must never do is let a run proceed because a
// check it did not perform found nothing.
//
// ── What is NOT implemented, and must be before anything destructive ───────
//   C1  Active recurring subscription schedules   (/v1/subscription_schedules)
//   C2  Pending/uncaptured payments AND in-flight refunds
//                                                 (/v1/payment_intents, /v1/refunds)
//   C3  Unpaid invoices owed to the business      (/v1/invoices)
//
// Plus the six mandatory resilience bounds: time-windowed traversals, a page
// cap, a wall-clock budget below `maxDuration`, ≤2 global retries, 429-then-
// refuse, and the session result cache.
//
// C-20 note for whoever implements C2: the refund predicate must take its
// status vocabulary from `lib/payments/RefundService.ts` and
// `20260828b_payment_refund_ledger.sql` — `payment_refunds.status` is
// CHECK (status IN ('pending','succeeded','failed','canceled')) and the
// reconciler's queue is `WHERE status = 'pending'`. A gate that disagrees with
// the reconciler about what "in flight" means produces a FALSE ALL-CLEAR, which
// is the single failure mode in this design that fails toward deletion instead
// of refusal. Everything else here fails toward refusal.

import { createLogger } from '@/lib/logger';
import type { GateResult } from './types';

const logger = createLogger({ module: 'PurgePreflightGate' });

export interface GateInput {
  userId: string;
  /**
   * Whether the business has any Stripe account on record.
   *
   * `null` means the probe itself failed. Deliberately tri-state: treating an
   * unknown as "no Stripe" would convert a failed read into a clean skip,
   * which is exactly the false all-clear the design refuses.
   */
  hasStripe: boolean | null;
}

/**
 * Evaluate the gate.
 *
 * Returns `skipped` only when we positively know there is no Stripe account.
 * Every other input refuses.
 */
export async function evaluatePreflightGate(input: GateInput): Promise<GateResult> {
  const startedAt = Date.now();
  const evaluatedAt = new Date().toISOString();

  const base = {
    blocks: [],
    accountIds: [],
    nonBlocking: [],
    evaluatedAt,
    durationMs: 0,
  };

  if (input.hasStripe === null) {
    logger.warn({ userId: input.userId }, 'Gate refused — could not determine Stripe connection state');
    return {
      ...base,
      outcome: 'refused',
      refusalReason: 'provider_error',
      durationMs: Date.now() - startedAt,
    };
  }

  if (input.hasStripe === false) {
    // FR-8 / AC-11: not a failure, no warning surfaced to the user.
    logger.info({ userId: input.userId }, 'Gate skipped — no Stripe account connected');
    return {
      ...base,
      outcome: 'skipped',
      durationMs: Date.now() - startedAt,
    };
  }

  // Stripe IS connected, and C1/C2/C3 are not implemented. Refuse.
  logger.warn(
    { userId: input.userId },
    'Gate refused — Stripe is connected but the provider conditions are not implemented in this build'
  );
  return {
    ...base,
    outcome: 'refused',
    refusalReason: 'provider_error',
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Human-readable statement of what the gate did and did not check.
 *
 * Returned to the UI so the preview can show its own limits rather than
 * presenting a confident-looking result that omits them.
 */
export function describeGateCoverage(result: GateResult): {
  headline: string;
  unchecked: string[];
} {
  const unchecked = [
    'C1 — active recurring subscription schedules at Stripe',
    'C2 — pending or uncaptured payments, and in-flight refunds',
    'C3 — unpaid invoices owed to this business',
  ];

  if (result.outcome === 'skipped') {
    return {
      headline:
        'No Stripe account is connected to this business, so there is no external payment state to check. This is a clean skip, not a failure.',
      unchecked: [],
    };
  }

  if (result.outcome === 'refused') {
    return {
      headline:
        'The gate REFUSED. A Stripe account is connected, and the checks that would prove no money is in flight are not implemented in this build.',
      unchecked,
    };
  }

  return { headline: 'Gate evaluated.', unchecked };
}
