# Retrospective: MK-4, Plans & subscriptions tab and MRR

> **Last Updated**: 2026-10-19

**MD links:** [ADMIN_MONEY_MK4_PLANS_SUBSCRIPTIONS_MRR_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK4_PLANS_SUBSCRIPTIONS_MRR_WORKPLAN.md) | **Branch:** `feature/admin-money-mk4-plans-subscriptions-mrr`, worktree `neuronforge-finance-m8`

## Overview

MK-4 puts MRR and `stripeMode` into the finance payload through `lib/admin/billing/financeMrr.ts`. It uses the same rule as the Subscriptions view, so the two figures are equal by construction. Revenue gains a "Recurring now" line. A new Plans & subscriptions tab shows the plan mix on top, with the list fetched when the tab opens. `/admin/subscriptions` now redirects to that tab, keeping `?status`, and the old page is deleted. There is no migration.

## What went well

- **There is one MRR rule across Finance and Subscriptions,** so the two figures cannot disagree.
- **SA's first review caught two real problems,** and both were fixed with proof (see below). FU-1 moved the orphaned copy and table into Finance, and the code was then approved.
- **The pins moved only as ruled.** AC-145 moved by the ruled update (`39b35743…` → `30275c29…`). AC-173 part B correctly did not move: SA's pin row had over-predicted it.

## What did not go well

- Dev ↔ SA back-and-forths: 1. SA-CR-MK4 was Fix Required:
  - CR-1: the mode label bypassed a guard. It now uses an explicit allow-list with planted controls.
  - CR-2: the MRR line had no label. It now shows a label in test mode only.
- Dev ↔ QA bug fix cycles: 1. QA passed with issues:
  - QA-MK4-1: three TS2741 errors that Dev's scoped `tsc` missed, because its config did not include those tests. Fixed, and the config now covers 121 files.
  - QA-MK4-2: a duplicated workplan block. Removed.
- Blocked handshakes: none.

## Conclusions & process improvements

- **Copy imported from outside a guarded folder can bypass the guard.** Guards should check what a file renders, not only its imports.
- **A scoped `tsc` config must include the test files of every touched folder.** Otherwise type errors in tests pass unseen, because ts-jest does not type-check.
- **A predicted pin move is a prediction.** Verify every pin that is predicted to move, and record the ones that did not move.
- **Next:** MK-5 (the strip re-cut plus $).

### Status: COMMITTED — feature/admin-money-mk4-plans-subscriptions-mrr — commit `44667683`, PR #476 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
