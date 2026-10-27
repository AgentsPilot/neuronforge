// lib/business-os/entitlements/config/afterPlan.ts
//
// WHERE AN ACCOUNT GOES WHEN ITS PAID PLAN ENDS AFTER A CANCEL.
//
// Account-deletion lifecycle requirement, SX-2 / BQ-20 (user decision,
// 2026-10-27): when an owner-started cancel ends a paid plan, the account moves
// to the free cohort for that cohort's configured duration (14 days today), and
// then follows that cohort's normal lapse (grace, then paused).
//
// Workplan docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md §2.2,
// SA Q-10. Named here, in config, so that:
//
//   - no cohort id is written in `afterPlan.ts` or `planEndingView.ts`;
//   - a later "real free plan" is a one-line change in this file;
//   - the choice is reviewed like any other config change. SX-2b WRITES this
//     cohort onto a plan row (it is a grant, not a display list), which is why
//     SA Q-10 asks for it to join the drift snapshot. D3 ships the invariant
//     test only (`afterPlan.test.ts`: grantable, and a cohort WITH a duration);
//     SX-2b adds the snapshot line before it writes.

import type { CohortId } from './cohorts';

export interface AfterPlanConfig {
  /** The cohort a cancelled paid plan moves to. Must have a `durationHistory` (an end date). */
  cohort: CohortId;
}

export const AFTER_PLAN: AfterPlanConfig = {
  cohort: 'trial',
};
