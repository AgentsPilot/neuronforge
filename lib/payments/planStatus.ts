/**
 * When a payment plan has stopped charging — and when it has not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `completed` ran to its end; `cancelled` was stopped early. Everything else —
 * `pending`, `active`, `past_due`, `paused` — is a plan Stripe may still charge
 * against. The schedule lives on Stripe, not here, so a row that merely looks
 * dormant is not evidence that nothing will be billed; `paused` in particular
 * is temporary by definition.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The test lives inline in `cancelPlan` as `alreadyStopped`, and it is about to
 * be asked a second time by the check that refuses to delete an account while
 * money is still moving. Two copies of "is this plan finished" would be two
 * chances to disagree about whether a client is still being billed.
 *
 * It is NOT in `PaymentPlanSubscriptionRepository` beside the type, which is
 * where it naturally belongs, because that module is jest-mocked by the tests
 * around plan cancellation — anything exported from it disappears for every
 * consumer that mocks it. A predicate over a string has no business being
 * mockable anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Statuses in which Stripe will raise no further charge for a plan. */
export const PLAN_STOPPED_STATUSES = ['completed', 'cancelled'] as const;

/**
 * Has this plan stopped charging?
 *
 * The inverse is the one that matters: anything else may still bill a client.
 * An unrecognised or missing status answers `false` deliberately — not knowing
 * is not the same as knowing it is finished, and the safe reading is that money
 * may still move.
 */
export function isPlanStopped(status: string | null | undefined): boolean {
  return PLAN_STOPPED_STATUSES.includes(status as (typeof PLAN_STOPPED_STATUSES)[number]);
}
