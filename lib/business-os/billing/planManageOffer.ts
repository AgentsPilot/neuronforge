/**
 * What an owner who pays may do with their plan subscription in Settings →
 * Plan: cancel it, or reactivate it (plan payments P-7a.1; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.1, §4.2; SA C-1,
 * TQ-14).
 *
 * THE ONE PREDICATE behind the screen's buttons (`planPurchaseView` → my-plan)
 * and the cancel / reactivate routes' our-data step (planSubscriptionManage.ts
 * step 6), so a button appears exactly where the route gets past our own data.
 * What only Stripe knows (the flag now, a pending update) is checked by the
 * routes after a fresh read.
 *
 * Pure: no I/O, no clock of its own, NO IMPORT. The callers pass plain facts
 * from our billing record and the price-recognition switch (C-1: the same
 * switch the routes 404 on, and the only one under which the webhook records
 * a cancellation's end; BQ-1, user 2026-10-26: existing payers can always
 * manage their plan, even while sales are paused, so the CHECKOUT switch is
 * deliberately not an input).
 *
 * | Rule (first wins) | Answer |
 * |---|---|
 * | switch off | `none` / `switch_off` |
 * | no row, no subscription id | `none` / `not_subscribed` |
 * | `ended_at` set, or a status that is not live (`canceled`, `incomplete`, `incomplete_expired`, `paused`, unknown) | `none` / `not_active` |
 * | a renewal failure open (`past_due`, `unpaid`, or `failed_attempts > 0`) | `none` / `payment_failed` (P-7a.4 turns Cancel on here; until then the screen says "contact us") |
 * | `active` / `trialing` (TQ-14: a trial behaves as active), cancel flag set, period end unknown or past | `none` / `period_over` |
 * | `active` / `trialing`, cancel flag set | `cancelling`: may reactivate |
 * | `active` / `trialing` | `renewing`: may cancel |
 *
 * It refuses a billing ACTION, never a capability: nothing here calls the
 * entitlements module.
 *
 * @module lib/business-os/billing/planManageOffer
 */

/** The facts the predicate reads: OUR billing row only (SR-11: the view may make no Stripe call). */
export interface PlanManageFacts {
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  /** ISO, `current_period_end`. */
  currentPeriodEnd: string | null;
  endedAt: string | null;
  failedAttempts: number;
}

export interface PlanManageSwitches {
  /** `isPlanPriceRecognitionEnabled()` (C-1). */
  pricesEnabled: boolean;
}

export type PlanManageNoneReason = 'switch_off' | 'not_subscribed' | 'not_active' | 'payment_failed' | 'period_over';

export type PlanManageOffer = { kind: 'renewing' } | { kind: 'cancelling' } | { kind: 'none'; reason: PlanManageNoneReason };

/** Stripe statuses in which a subscription renews (TQ-14: `trialing` as `active`). */
export const MANAGEABLE_STATUSES: readonly string[] = ['active', 'trialing'];
/** Stripe statuses in which a renewal payment is outstanding (as `planPaymentNotice`). */
export const PAYMENT_FAILED_STATUSES: readonly string[] = ['past_due', 'unpaid'];

export function planManageOffer(facts: PlanManageFacts | null, switches: PlanManageSwitches, now: Date): PlanManageOffer {
  if (!switches.pricesEnabled) return { kind: 'none', reason: 'switch_off' };
  if (!facts || !facts.stripeSubscriptionId) return { kind: 'none', reason: 'not_subscribed' };
  if (facts.endedAt !== null) return { kind: 'none', reason: 'not_active' };

  const status = facts.subscriptionStatus;
  const failureOpen = (status !== null && PAYMENT_FAILED_STATUSES.includes(status)) || facts.failedAttempts > 0;
  if (failureOpen) return { kind: 'none', reason: 'payment_failed' };
  if (status === null || !MANAGEABLE_STATUSES.includes(status)) return { kind: 'none', reason: 'not_active' };

  if (facts.cancelAtPeriodEnd) {
    const periodEnd = facts.currentPeriodEnd === null ? Number.NaN : Date.parse(facts.currentPeriodEnd);
    if (!Number.isFinite(periodEnd) || periodEnd <= now.getTime()) return { kind: 'none', reason: 'period_over' };
    return { kind: 'cancelling' };
  }
  return { kind: 'renewing' };
}

/**
 * What the screen is sent (`PlanPurchaseWire.manage`): which control to show.
 * `null` when there is nothing to show at all, so a payload without a paid
 * plan is unchanged.
 */
export interface PlanManageWire {
  cancel: boolean;
  reactivate: boolean;
  /** A renewal failed: Cancel is not offered yet; the screen says "update your card, or contact us". */
  paymentFailed: boolean;
}

export function planManageWire(offer: PlanManageOffer): PlanManageWire | null {
  if (offer.kind === 'renewing') return { cancel: true, reactivate: false, paymentFailed: false };
  if (offer.kind === 'cancelling') return { cancel: false, reactivate: true, paymentFailed: false };
  if (offer.reason === 'payment_failed') return { cancel: false, reactivate: false, paymentFailed: true };
  return null;
}
