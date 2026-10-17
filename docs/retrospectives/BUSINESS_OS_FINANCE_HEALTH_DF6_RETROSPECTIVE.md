# Retrospective: Finance slice DF-6, "Since it started" for one account

> **Last Updated**: 2026-10-17

## Overview

DF-6 adds one window choice, "Since it started", offered only while one business is picked (BD-26). It runs from the charging cut-over instant (2026-09-29 16:50:53.914 UTC) to the request's `now`, so it can run past 92 days. The route resolves it with a pure branch of `resolveFinanceWindow`. The builder, every read, every ceiling and the payload shape are unchanged. With All businesses the choice is a 400. On the page it is a Finance-only window extra (`range=since_start`). The shared resolver maps it to `none`, the links out never carry it, and a bad link drops only the window (U-4). BQ-16 is still open with its default: client takings use the same window. There is no migration, no new read and no write. It ran under the BD-33 fast track: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11L](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_DF6_SINCE_START_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_DF6_SINCE_START_WORKPLAN.md)

**Branch:** `feature/bos-finance-health-df6` (cut from the 6b tip `ea56ad04`; 6b is merged), worktree `neuronforge-finance-m8`

---

## What went well

- **SA's requirement review narrowed the scope early.** SA approved the BA spec with conditions and applied E-75 to E-80. The main change made the window start at the cut-over only, so no plan-row or timezone facts are involved and every margin is a figure by construction.
- **The workplan found five gaps between the requirement and the code before any code was written.** The `formatUtc` label shape, the summary window line that did not exist yet, the `financeLinks.ts` import pin, the first request being built before the repair runs, and a one-line anchor slip. SA ruled on all of them up front (E-81 to E-84, DF6-R1 to DF6-R3).
- **No frozen pin was re-frozen.** When the first run showed that AC-173 hashes the route schema, Dev wrapped it in `parseFinanceQuery` instead of editing it (D-1). All seven pins and the AC-145 baseline stayed byte-identical.
- **There is exactly one first request.** With no business picked, the page sends the This-month request and never asks the route for a 400. The render test pins this as a single request.
- **Isolation was proven on the dependency calls.** For account A, every scoped read received only A, the all-accounts reads were not called, and B's id appeared in no call.
- **Test edits were capped and listed.** DF6-R3 allowed only named test edits (two, later three) and they were quoted verbatim. Every other test change was additions only (+77 tests, 4214 → 4291).

## What did not go well

- Number of Dev ↔ SA back-and-forths: 2. The requirement review was approved with conditions (E-75 to E-80). The workplan review was approved with conditions (E-81 to E-84, DF6-R1 to DF6-R3). The code review passed first time with no conditions, with D-1 to D-3 all approved.
- Number of Dev ↔ QA bug fix cycles: 0. QA passed with no bugs.
- Any blocked handshake and why: none. D-2 waited on an SA ruling, and SA made the test edit itself.
- **An SA ruling was wrong about a pin.** SA-Q96 and VL-21 said no pin reads the route enum, but AC-173 part B hashes from `const DATE =` to the end of `buildQuerySchema`. The first run caught it, and D-1 corrected SA-Q96.
- **A type error escaped Jest.** Widening `FinanceWindowChoice` broke `financeLinks.test.ts:36`. ts-jest stayed green, so only the scoped `tsc` found it. Fixing it needed a third test edit, so SA amended DF6-R3 (D-2).

## Conclusions & process improvements

- **Before ruling that "no pin reads X", grep every pin's hashed region.** Do not rely only on the pin file's name or header. AC-173's hashed region reaches into the route.
- **When widening a shared union type, list every test that types against it.** Add those tests to the scoped `tsc` before setting a cap on test edits.
- **Keep the scoped `tsc` with a canary as standard.** It caught a real defect for the second slice in a row (after 6b).
- **Wrapping a pinned block is better than re-freezing it.** D-1's `parseFinanceQuery` is a reusable pattern when frozen code needs a new branch.
- **Still owed to the user:** BQ-16, and the live steps L-148 to L-154 with checks 29 and 30 for the owner test account. These are AC-272 and the live halves of AC-267 and AC-268.

### Status: COMMITTED — feature/bos-finance-health-df6 — commit `fd7b7f02`, PR #450 (auto-merge on)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | DF-6 retrospective after the SA requirement review (E-75 to E-80), the SA workplan review (E-81 to E-84, DF6-R1 to DF6-R3), SA code approval with no conditions (D-1 to D-3 approved) and a QA pass with no bugs (AC-257 to AC-271); fast track BD-33, no migration, auto-merge allowed |

TL approval: APPROVED for RM (commit, PR, auto-merge)
