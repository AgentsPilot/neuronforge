/**
 * THE AFTER-PLAN RULE: the plan row as it will be once a paid tier ends after
 * an owner-started cancel (account-deletion lifecycle SX-2 / SX-2b, user
 * decision BQ-20 2026-10-27; D3 workplan
 * docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md §2.2, SA R-4,
 * R-7; D3.1 workplan docs/workplans/BUSINESS_OS_D3_1_FREE_COHORT_AFTER_CANCEL_WORKPLAN.md
 * §4, SA DR-4, S-2, S-3, S-4, S-11).
 *
 * ── THE SINGLE AFTER-PLAN RULE ──────────────────────────────────────────────
 * Two callers, one rule, so the words and the write cannot drift apart:
 *
 *   - D3's `planEndingView` DESCRIBES it in the Cancel drawer ("Your plan moves
 *     to the free plan until {date}"), through `EntitlementService.previewAfterPlan`;
 *   - SX-2b's writer (`lib/business-os/billing/afterPlanMove.ts`, from the
 *     webhook `customer.subscription.deleted`, SA Q-11) WRITES it onto the
 *     plan row.
 *
 * Neither may re-derive any part of it. Both pass the stored repeat-cancel
 * count (`history.priorMoves`); it is required, so no caller can silently
 * describe a first-time period (SA code review comment 1, AC-D31.5).
 *
 * ── THE RULE (SA DR-4: this order, fixed and tested) ────────────────────────
 *   0. An unreadable `endsAt` moves nothing (`skip: 'no_end_date'`).
 *   1. PAID THROUGH (SA S-11 as replaced by PLAN PAYMENTS condition 3): the
 *      rule NEVER writes `tierExpiresAt`, in either direction. If the row is
 *      paid through LATER than `endsAt` plus the renewal settlement margin, or
 *      holds a tier with no end date, the subscription ended while paid access
 *      still runs: nothing moves (`skip: 'paid_through_after_end'`). The writer
 *      alerts on it; the preview then reads `unknown`.
 *   2. SURVIVAL: if the account's OWN cohort is still live when the tier
 *      really ends at `endsAt` (`ownCohortAfterPaidTier`, the same derivation
 *      as P-7a.3's `freeAccessAfterPaidTier`, SA R-4a), nothing changes
 *      (`skip: 'own_cohort_survives'`). A Founding Partner, dated or
 *      open-ended, goes back to Founding Partner and is never moved down to
 *      the free cohort; an unexpired trial simply resumes.
 *   3. HALVING (user decision 2026-10-27, SA S-3): the free period is
 *      `max(minimumDays, ceil(base / divisor ^ priorMoves))` days. `base` is
 *      the after-plan cohort's duration in force at `endsAt` (`historyAt`,
 *      never a literal); `divisor` and `minimumDays` come from
 *      `config/afterPlan.ts`. 14 → 7 → 4 → 2 → 1 → 1 today. A misconfigured
 *      entry (no such cohort, no duration, a bad divisor or minimum) moves
 *      nothing (`skip: 'after_plan_misconfigured'`), never an endless plan.
 *   4. START (SA S-2): the free period starts when paid access REALLY ends,
 *      `freeFrom = max(endsAt, tierSettlementEndsAt(row.tierExpiresAt))`. A
 *      period-end cancel starts one settlement margin after `endsAt`; an
 *      immediate cancel of an already lapsed tier starts at `endsAt`. So the
 *      margin never eats the free period, and the 1-day minimum is one day.
 *      `trialStartedAt = freeFrom`, `trialEndsAt = freeFrom + days`.
 *   5. GRACE PIN (SA S-4): a `graceEndsAt` pin EARLIER than the new
 *      `trialEndsAt` is stale (an earlier lapse or admin op) and is cleared,
 *      so the free cohort lapses as the drawer promises; a later pin is kept.
 *
 * `cohortExpiresAt` is left alone: a cohort with a duration ignores it. The
 * input is never mutated (it may be the service cache's own object). Prior
 * trial use is NOT read (BQ-20 is unconditional, SA BA-10.3): an account that
 * used its trial before still gets the free period.
 *
 * Pure: no I/O, no clock, no cohort id (the test checks this file).
 *
 * @module lib/business-os/entitlements/afterPlan
 */

import type { EntitlementAccount } from './account';
import { AFTER_PLAN, type AfterPlanConfig } from './config/afterPlan';
import { ownCohortAfterPaidTier } from './freeAccess';
import { historyAt, tierSettlementEndsAt, type LifecycleInputs } from './lifecycle';

/** Why nothing moved. A closed list: the writer logs it, the preview reads it. */
export type AfterPlanSkip = 'no_end_date' | 'paid_through_after_end' | 'own_cohort_survives' | 'after_plan_misconfigured';

export interface AfterPlanResult {
  /** The row as it will be. Always a new object. */
  account: EntitlementAccount;
  /** True when the account moves to the after-plan cohort. */
  moved: boolean;
  /** The free period's length in days when `moved`; otherwise `null`. */
  days: number | null;
  /** Set exactly when `moved` is false. */
  skip?: AfterPlanSkip;
}

/** The account's after-plan history. Required: there is no silent "first time". */
export interface AfterPlanHistory {
  /** How many free-after-cancel moves the account has had (the plan row's `after_plan_moves`). */
  priorMoves: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The halved length: `max(minimumDays, ceil(baseDays / divisor ^ priorMoves))`.
 *
 * A `priorMoves` that is not a non-negative integer counts as 0 (the database
 * CHECK makes that unreachable from a row; the caller logs it). `null` when the
 * base or the repeat settings cannot give a length.
 */
export function afterPlanDays(baseDays: number, priorMoves: number, repeat: AfterPlanConfig['repeat']): number | null {
  if (!Number.isInteger(baseDays) || baseDays < 1) return null;
  if (!repeat || !Number.isFinite(repeat.divisor) || repeat.divisor <= 1) return null;
  if (!Number.isInteger(repeat.minimumDays) || repeat.minimumDays < 1) return null;
  const moves = Number.isInteger(priorMoves) && priorMoves > 0 ? priorMoves : 0;
  // Closed-form ceil equals step-by-step ceil for integers (workplan §4). A huge
  // count makes the power Infinity, so the quotient is 0 and the minimum wins.
  return Math.max(repeat.minimumDays, Math.ceil(baseDays / Math.pow(repeat.divisor, moves)));
}

export function afterPlanAccount(
  account: EntitlementAccount,
  endsAt: string,
  inputs: LifecycleInputs,
  history: AfterPlanHistory,
  afterPlan: AfterPlanConfig = AFTER_PLAN
): AfterPlanResult {
  const unchanged = (skip: AfterPlanSkip): AfterPlanResult => ({ account: { ...account }, moved: false, days: null, skip });

  // 0. An unreadable end moves nothing.
  const endsAtMs = Date.parse(endsAt);
  if (!Number.isFinite(endsAtMs)) return unchanged('no_end_date');
  const margin = inputs.renewalSettlementMarginHistory;
  const hasTier = account.tier !== null && account.tier !== '';

  // 1. Paid through after the end: the rule never extends or shortens a paid tier.
  if (hasTier) {
    if (account.tierExpiresAt === null) return unchanged('paid_through_after_end');
    const endsSettledMs = Date.parse(tierSettlementEndsAt(new Date(endsAtMs).toISOString(), margin));
    if (Date.parse(account.tierExpiresAt) > endsSettledMs) return unchanged('paid_through_after_end');
  }

  // 2. The account's own cohort outlives the plan, at the instant the preview uses (SA comment 4).
  if (ownCohortAfterPaidTier({ ...account, tierExpiresAt: endsAt }, inputs)) return unchanged('own_cohort_survives');

  // 3. The halved length, from config.
  const cohort = Object.prototype.hasOwnProperty.call(inputs.cohorts, afterPlan.cohort)
    ? inputs.cohorts[afterPlan.cohort]
    : undefined;
  const base = cohort?.durationHistory ? historyAt(cohort.durationHistory, new Date(endsAtMs)) : null;
  const days = base ? afterPlanDays(base.days, history.priorMoves, afterPlan.repeat) : null;
  if (days === null) return unchanged('after_plan_misconfigured');

  // 4. The free period starts when paid access really ends (S-2).
  const paidSettledMs =
    hasTier && account.tierExpiresAt !== null ? Date.parse(tierSettlementEndsAt(account.tierExpiresAt, margin)) : NaN;
  const freeFromMs = Number.isFinite(paidSettledMs) ? Math.max(endsAtMs, paidSettledMs) : endsAtMs;
  const trialEndsMs = freeFromMs + days * DAY_MS;

  // 5. A stale grace pin earlier than the new end is cleared; a later one is kept (S-4).
  const graceMs = account.graceEndsAt === null ? NaN : Date.parse(account.graceEndsAt);
  const graceEndsAt = Number.isFinite(graceMs) && graceMs < trialEndsMs ? null : account.graceEndsAt;

  return {
    account: {
      ...account,
      cohort: afterPlan.cohort,
      trialStartedAt: new Date(freeFromMs).toISOString(),
      trialEndsAt: new Date(trialEndsMs).toISOString(),
      graceEndsAt,
    },
    moved: true,
    days,
  };
}
