/**
 * The ONE home of "is this plan subscription set to end?" (plan payments
 * follow-ups C-3; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_FOLLOWUPS_C3_WORKPLAN.md §2.1; SA
 * W-3, W-4).
 *
 * Why there are two predicates. Stripe can say "set to end" in two ways
 * (X-2, sandbox 2026-10-26): `cancel_at_period_end: true` (which also sets
 * `cancel_at` to the period end), or `cancel_at` ALONE, as the dashboard's
 * "cancel at end of period" may write it.
 *
 *   hasCancelDate          FRESH readers deciding what to do NOW (the cancel /
 *                          reactivate engine, the upgrade refusal): any end date
 *                          set counts, whenever it falls (SA Q-6)
 *   isSetToEndThisPeriod   what we STORE in `cancel_at_period_end` (the webhook
 *                          mirror, the engine's mirror and heal) and what the
 *                          reconcile compares it with (Step B): "this plan will
 *                          not renew". A `cancel_at` LATER than the current
 *                          period end does not count, because the plan renews
 *                          at least once more and saying "ends" would deny a
 *                          charge that will happen (SA Q-4)
 *
 * The stored column's name says "at period end"; it now also holds an EARLY
 * `cancel_at` (a dashboard custom date). Access still runs to our paid-through
 * date (SA-P8), so every date shown stays true.
 *
 * Pure: no I/O, no clock, NO IMPORT. Status-blind by design (a trialing plan
 * set to end at its trial end is `true`); callers check ended / status first.
 *
 * @module lib/business-os/billing/subscriptionCancelling
 */

export interface CancelDateFacts {
  cancelAtPeriodEnd: boolean;
  /** Stripe's `cancel_at`, unix seconds. Absent, null, 0, negative or not finite → no date. */
  cancelAt?: number | null;
}

export interface CancelPeriodFacts extends CancelDateFacts {
  /** The LATEST item period end of the same read, unix seconds (clover: the period is on the item). */
  periodEnd: number | null;
}

/** Why a subscription reads as set to end, for the logs (ids only beside it). */
export type CancelSource = 'flag' | 'cancel_at' | 'cancel_at_after_period' | null;

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Fresh readers: the flag OR any `cancel_at` date (the body P-7a.1 C-3 shipped as `isCancelling`). */
export function hasCancelDate(facts: CancelDateFacts): boolean {
  return facts.cancelAtPeriodEnd || positive(facts.cancelAt) !== null;
}

/**
 * The stored flag: the flag, OR a `cancel_at` at or before the period end, OR
 * a `cancel_at` when the period end cannot be read (fail toward "will not
 * renew": only Reactivate is offered, and it clears `cancel_at`, X-2).
 */
export function isSetToEndThisPeriod(facts: CancelPeriodFacts): boolean {
  if (facts.cancelAtPeriodEnd) return true;
  const cancelAt = positive(facts.cancelAt);
  if (cancelAt === null) return false;
  const periodEnd = positive(facts.periodEnd);
  return periodEnd === null || cancelAt <= periodEnd;
}

/** Which rule made it set to end; `cancel_at_after_period` = a date that does NOT count yet. */
export function cancelSourceOf(facts: CancelPeriodFacts): CancelSource {
  if (facts.cancelAtPeriodEnd) return 'flag';
  if (positive(facts.cancelAt) === null) return null;
  return isSetToEndThisPeriod(facts) ? 'cancel_at' : 'cancel_at_after_period';
}

/** The latest item period end, unix seconds (clover: the period is on the items). */
export function latestItemPeriodEnd(items: ReadonlyArray<{ currentPeriodEnd: number | null }>): number | null {
  const ends = items.map((item) => item.currentPeriodEnd).filter((value): value is number => value !== null);
  return ends.length > 0 ? Math.max(...ends) : null;
}
