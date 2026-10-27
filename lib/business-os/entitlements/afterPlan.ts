/**
 * THE AFTER-PLAN RULE: the plan row as it will be once a paid tier ends after
 * an owner-started cancel (account-deletion lifecycle SX-2, user decision
 * BQ-20 2026-10-27; workplan docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md
 * §2.2; SA R-4, R-7).
 *
 * ── THE SINGLE AFTER-PLAN RULE ──────────────────────────────────────────────
 * Two callers, one rule, so the words and the write cannot drift apart:
 *
 *   - D3's `planEndingView` DESCRIBES it in the Cancel drawer ("Your plan moves
 *     to the free plan until {date}"), through `EntitlementService.previewAfterPlan`;
 *   - SX-2b's writer (webhook `customer.subscription.deleted`, SA Q-11) WRITES
 *     it onto the plan row.
 *
 * Neither may re-derive any part of it.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *   1. `tierExpiresAt` becomes `endsAt` (on a COPY: the input is never mutated,
 *      because it may be the service cache's own object).
 *   2. If the account's OWN cohort is still live when the tier really ends
 *      (`ownCohortAfterPaidTier`, the same derivation as P-7a.3's
 *      `freeAccessAfterPaidTier`, SA R-4a), nothing else changes. A Founding
 *      Partner, dated or open-ended, goes back to Founding Partner and is never
 *      moved down to the free cohort; an unexpired trial simply resumes.
 *   3. Otherwise the account moves to the configured after-plan cohort
 *      (`config/afterPlan.ts`): `cohort` is that id, `trialStartedAt` is
 *      `endsAt`, and `trialEndsAt` is `endsAt` plus that cohort's duration in
 *      force at `endsAt` (`historyAt`, never a literal). `cohortExpiresAt` is
 *      left alone: a cohort with a duration ignores it.
 *
 * Prior trial use is NOT read (BQ-20 is unconditional, SA BA-10.3): an account
 * that used its trial before still gets the free period.
 *
 * ── SX-2b ADDS THE REPEAT-CANCEL HALVING HERE ───────────────────────────────
 * User decision 2026-10-27: each repeat cancel halves the free period, 14 → 7
 * → 4 → 2 → 1 days, with a 1-day minimum. D3 describes the first-time period
 * only. SX-2b adds the halving INSIDE `afterPlanAccount` (it is the one rule),
 * so the Cancel drawer's `{until}` date and the date the writer stores stay
 * the same. It must never be applied in the writer or the view alone.
 *
 * Pure: no I/O, no clock, no cohort id (the test checks this file).
 *
 * @module lib/business-os/entitlements/afterPlan
 */

import type { EntitlementAccount } from './account';
import { AFTER_PLAN, type AfterPlanConfig } from './config/afterPlan';
import { ownCohortAfterPaidTier } from './freeAccess';
import { historyAt, type LifecycleInputs } from './lifecycle';

export interface AfterPlanResult {
  /** The row as it will be. Always a new object. */
  account: EntitlementAccount;
  /** True when the account moves to the after-plan cohort; false when its own cohort survives (or the move cannot be made). */
  moved: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function afterPlanAccount(
  account: EntitlementAccount,
  endsAt: string,
  inputs: LifecycleInputs,
  afterPlan: AfterPlanConfig = AFTER_PLAN
): AfterPlanResult {
  const ended: EntitlementAccount = { ...account, tierExpiresAt: endsAt };

  if (ownCohortAfterPaidTier(ended, inputs)) return { account: ended, moved: false };

  const endsAtMs = Date.parse(endsAt);
  const cohort = Object.prototype.hasOwnProperty.call(inputs.cohorts, afterPlan.cohort)
    ? inputs.cohorts[afterPlan.cohort]
    : undefined;
  const duration = cohort?.durationHistory && Number.isFinite(endsAtMs) ? historyAt(cohort.durationHistory, new Date(endsAtMs)) : null;
  // A misconfigured entry (unknown cohort, or one with no duration) cannot give
  // a dated free period. The invariant test keeps this unreachable; reaching it
  // describes today's lapse rather than inventing an endless free plan.
  if (!duration) return { account: ended, moved: false };

  return {
    account: {
      ...ended,
      cohort: afterPlan.cohort,
      trialStartedAt: new Date(endsAtMs).toISOString(),
      trialEndsAt: new Date(endsAtMs + duration.days * DAY_MS).toISOString(),
    },
    moved: true,
  };
}
