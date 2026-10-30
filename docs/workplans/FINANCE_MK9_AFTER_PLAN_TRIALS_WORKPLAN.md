# Workplan: MK9 trial-to-paid leaves out after-plan free periods (MK5BFU-FU-2)

> **Last Updated**: 2026-10-30

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.4, row MK5BFU-FU-2 (found in [FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md](/docs/workplans/FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md), "20261098 (D3.1, after-plan moves)")
**Branch:** `fix/finance-mk9-exclude-after-plan-trials` (worktree `neuronforge-mk9fu2`, off origin/main `a0804002`)
**Date:** 2026-10-30
**Status:** Code Complete, SA code-approved 2026-10-30 (uncommitted, for QA)

## Overview

D3.1 (migration 20261098, `AFTER_PLAN.cohort = 'trial'`) moves an owner who cancelled a paid plan to cohort `trial` with fresh trial dates. When that free period ends, MK-9 "Trial to paid" on the admin Finance page counts it as an ended trial that was paid, and paid before the end, because the first payment predates the period. Repeat cancellers would inflate the rate. **User decision 2026-10-30:** do it now. An owner who comes back to a free period after a paid plan already converted once, so for MK-9 they are not a trial. On 2026-10-30 production had 0 such rows and 1 real trial, so the change is preventive and no figure on the page moves today.

---

## The rule

**A plan row with `after_plan_moves > 0` is not in the MK-9 trial base.** It counts in neither "Trials ended in this window", "Still running", "Paid" nor the rate.

- `after_plan_moves` is never reset (D3.1, user U-1). An account that has had one after-plan free period has paid at least once, so it stays out for good, whatever its cohort is later.
- **"First payment before the trial start" is NOT added as a second exclusion.** Reasons:
  1. **No row can predate the column.** The column (`integer NOT NULL DEFAULT 0`) and its only writer (`afterPlanMove.ts`) shipped together in 20261098. Before that no code moved an owner to a free cohort after a cancel, so `0` is the true value for every older row. The belt-and-braces check would protect against a case that cannot exist.
  2. **It would change the meaning for other cases.** An admin granting a fresh trial to an owner who paid in the past, or a trial whose start comes from a pin set after a payment, would also leave the base. Whether those count is a business question (below). It is not part of the user's decision.
  3. **The page and the checker would drift.** The trial start is derived in TypeScript from the cohort settings and the pins (`deriveLifecycle`). The SQL checker cannot repeat that, so MK9-C2 could no longer apply the same rule.

## Where the rule lives

| Piece | File | Change |
|---|---|---|
| Is this row an after-plan period? | `lib/business-os/finance/planGroups.ts` | New `isAfterPlanRow(row)`: `after_plan_moves > 0` |
| MK-9's trial list | `lib/business-os/finance/planGroups.ts` | New `trialsForTrialToPaid(rows, config, now)`: `isTrialRow` and not `isAfterPlanRow`, mapped through `trialEndOf`. **The one list** both the first-payment ask and the count use |
| The builder | `lib/business-os/finance/financeHealth.ts` | The two hand-written `filter(isTrialRow).map(trialEndOf)` sites (the ask, around line 905, and the count, around line 1546) call `trialsForTrialToPaid` |
| `trialsToPaid`, `trialAccountsToAsk` | `payingBreakdown.ts`, `firstPaymentAsk.ts` | **Unchanged.** They receive the already-filtered list |

Because the ask and the count are built from the same list, the ask stays a superset of what `trialsToPaid` reads by the same construction as before (MK5B-FU-1). An after-plan row is no longer asked about at all.

## The plan walk

`pagePlans` selects `PLAN_COLUMNS`, which does **not** contain `after_plan_moves`. That is deliberate in 20261098: the hot entitlement read must not change. So:

- `pagePlans` gets one **opt-in** option, `withAfterPlanMoves`. When it is set, the select is `PLAN_COLUMNS, after_plan_moves` and every row's count is checked: a value that is not a non-negative integer fails the page (an error, never 0, the same rule as `toAfterPlanMoveState`).
- `BusinessOsAccountPlan` gets an optional `after_plan_moves?: number`, present only on rows read with that option.
- **Only the Finance wiring** (`financeHealthDeps.ts`) sets it. The Subscriptions wiring, the credit leak check and the entitlement report are untouched: they do not compute MK-9. The nightly snapshot job reuses `financeHealthDeps().plans` (`financeSnapshotDeps.ts`), so its walk reads the count too and ignores it. The column is `NOT NULL` with a `>= 0` CHECK, so the new count check cannot fail that walk.
- In the builder, a row **without** the field counts as `0` (today's behaviour). Production cannot produce such a row, because the Finance wiring always asks for the column and the repository refuses a row without a readable count. Test fixtures written before this change have no field, so they keep their figures.
- **Deploy order:** 20261098 is applied on production (D3.1 #556 merged and live), so the column exists. Selecting it on an environment without 20261098 would fail the Finance walk, so the page would show "Unknown" rather than a wrong number.

**Impact on the guards:**

| Guard | Impact |
|---|---|
| Range-cap guard (`rangeCap.source.guard.test.ts`, 11 entries, 17 call sites) | None. `pagePlans` uses `.limit()`, and no `.range()` is added |
| RC-15 (`businessOsEntitlements.imports.guard.test.ts`) | None. The Finance wiring still calls `pagePlans` and `findEntitlementInputs` only |
| First-payment stamp guard | None. Not touched |
| AC-145 (route test, `EXPECTED_CALLS` and `EXPECTED_SHA256`) | None. The route test mocks `financeHealthDeps`, so the walk's arguments (`{ afterUserId: null, limit: 500 }`) are unchanged, and its fixture has no after-plan row |

## Pins and hashes

No pin or hash is expected to move. AC-145's payload hash stays `38897cd3…4edf` because its fixture has no after-plan row. The after-plan cases are added **deliberately** to new tests and not to the AC-145 fixture, so the AC-145 bytes keep proving that nothing else changed. Pins A to D, AC-173 and T-12 are on files this slice does not touch.

## The page note

`PAYING_BREAKDOWN.limits` (shown under "Trial to paid") gets one sentence: *"An owner back on a free period after cancelling a paid plan is not counted as a trial: they already paid."* The render test reads the constant, so it follows.

## The SQL checker

`scripts/check-bos-finance-trials.sql` (MK9-C2) adds `and r.after_plan_moves = 0` to its trial set, so its all-time totals stay an upper bound of the page's figures under the same rule.

## Converted this month

**Not affected.** It counts the accounts paying now whose first plan payment is in the current UTC month, over every non-platform plan row. It does not use the trial list. The first-payment read's month question (`firstPaymentIn`) is unchanged; only the trial ids asked beside it can shrink. An after-plan account's first payment predates its free period, so it was never this month's conversion. If it does fall in this month (cancelled the same month it first paid), it is still asked for and counted through the month question.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BusinessOsAccountPlanRepository.ts` | modify | `after_plan_moves?` on the row type; `pagePlans({ withAfterPlanMoves })` |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | The Finance walk asks for the count |
| `lib/business-os/finance/planGroups.ts` | modify | `isAfterPlanRow`, `trialsForTrialToPaid` |
| `lib/business-os/finance/financeHealth.ts` | modify | Both MK-9 sites use `trialsForTrialToPaid` |
| `app/admin/finance/financeCopy.ts` | modify | The note line |
| `scripts/check-bos-finance-trials.sql` | modify | MK9-C2 applies the same exclusion |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts` | modify | The option's select and its count check |
| `lib/business-os/finance/__tests__/planGroups.test.ts` | modify | `isAfterPlanRow`, `trialsForTrialToPaid` |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | modify | Excluded, still counted, mixed, ask superset |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | modify | Builder and snapshot job never ask for the count; both MK-9 lists via `trialsForTrialToPaid` |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify | RC-15: the Finance wiring asks for the count |
| `docs/workplans/FINANCE_MK9_AFTER_PLAN_TRIALS_WORKPLAN.md` | create | This workplan |
| `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` | modify | §0.4 row and Change History |

## Task List

- ✅ Step 1: This workplan
- ✅ Step 2: Repository option and row type, with tests
- ✅ Step 3: `isAfterPlanRow` and `trialsForTrialToPaid`, with tests
- ✅ Step 4: Builder sites, with builder tests (excluded, counted, mixed, ask superset)
- ✅ Step 5: Finance wiring, with a source guard
- ✅ Step 6: Page note
- ✅ Step 7: SQL checker
- ✅ Step 8: Suites, guards, typechecks and lint
- ✅ Step 9: FIN §0.4 and Change History

## Business question (for BA/SA, not blocking)

- **BQ-FU2-1:** should an account that paid a plan in the past and was later given a fresh trial **by an admin** (not by the after-plan move) also leave the MK-9 base? Today it stays in, and when its trial ends it counts as paid before the end. That is the "first payment before the trial start" rule declined above. Default: no change until asked. On 2026-10-30 production had 1 trial row in total.

## Implementation Notes

**Built 2026-10-30, uncommitted, on `fix/finance-mk9-exclude-after-plan-trials` (off origin/main `a0804002`).**

**As planned, with one change:** the wiring pin (`pagePlans({ ...options, withAfterPlanMoves: true })`) lives in the RC-15 file (`businessOsEntitlements.imports.guard.test.ts`), not in `finance.source.guard.test.ts`. RC-15's "only the repository layer names `businessOsAccountPlanRepository`" rule refused the repository's name in the finance guard. The finance guard keeps two new rules: the builder and the snapshot job never ask for the count themselves, and `financeHealth.ts` builds both MK-9 lists through `trialsForTrialToPaid` and names no `isTrialRow`.

**Plan mix unchanged.** `classifyAccounts` still puts an after-plan account in the Trial group: it is in the trial cohort. Only the MK-9 base changes.

**Tests added:**

| File | Cases |
|---|---|
| `BusinessOsAccountPlanRepository.test.ts` | Without the option: no after-plan column. With it: `, after_plan_moves` only (no subscription id), returned on the row. A missing, null, negative, fractional or string count fails the page |
| `planGroups.test.ts` | `isAfterPlanRow` (1, 3, 0, no field); an after-plan row is left out (and is still `isTrialRow`); a real trial is kept with `trialEndOf`'s end; a mixed set keeps only the real trials, in order |
| `financeHealth.test.ts` | Excluded (E and F out: 1 ended, 0 running, asked `[C]`); control with moves 0 (old figures: 2 ended, 1 running, asked `[C, E]`); a real trial still counted; mixed set, with the ask a superset of the ids the count reads and no after-plan id asked; Converted this month identical with and without moves |
| `finance.source.guard.test.ts` | The two rules above |
| `businessOsEntitlements.imports.guard.test.ts` (RC-15) | The wiring asks for the count, with a planted control |

**Runs (2026-10-30):**

| Run | Result |
|---|---|
| `lib/business-os/finance`, `app/admin/finance`, the finance route (AC-145), the plan repository, range-cap guard, first-payment stamp guard, RC-15, `lib/admin/billing`, after-plan move tests | 77 suites, 3,789 tests, green after the RC-15 fix (the first run failed only RC-15, see above) |
| `npm run test:authz-guard` | 2 suites, 203 tests |
| `npm run test:bos-entitlements` | 331 suites, 9,892 tests |
| `typecheck:bos-llm` (8 GB) | Passed: 621 files, 11 errors, 0 new |
| Scoped tsc (8 GB, the 10 touched TS files) | Exit 0, 0 errors, no OOM. A canary file with a TS2322 gave exit 2 |
| `npm run lint:hooks` | Exit 0 |
| Not run | `npm run build`; the checker on production (read only, optional) |

**Pins and hashes:** none moved. AC-145 `EXPECTED_SHA256` stays `38897cd3295ae0c5e865503cf0394453c38f532b0ec87866610126281b1e4edf` and `EXPECTED_CALLS` is unchanged (the route test mocks the wiring, and its fixture has no after-plan row). The range-cap guard stays at 11 entries and 17 call sites. Pins A to D, AC-173 and T-12 are on files this slice does not touch.

## SA Review Notes

**Code Review by SA — 2026-10-30**
**Status:** ✅ Code Approved (no must-fix; two conditions before merge, below)

Reviewed the uncommitted diff in `neuronforge-mk9fu2` (12 files) against origin/main `a0804002`. Re-ran the touched suites myself: planGroups, financeHealth, finance source guard, plan repository, RC-15, finance route (AC-145) — 7 suites, 1,989 tests, green.

### Rulings on the questions asked

| # | Question | Ruling |
|---|---|---|
| SA-FU2-1 | Correctness of the rule | ✅ `trialsForTrialToPaid` = `isTrialRow && !isAfterPlanRow`, mapped through the unchanged `trialEndOf`. Both builder sites (the ask ~L911, the count ~L1553) now call it, and the source guard pins exactly two calls and no `isTrialRow` left in the builder. |
| SA-FU2-2 | Ask stays a superset of the count | ✅ By construction: `trialAccountsToAsk` and `trialsToPaid` receive the same list. An after-plan id is no longer asked; it was never counted either. |
| SA-FU2-3 | Converted this month unaffected | ✅ Its `accountIds` is still every non-platform plan row (`planRows.map(user_id)`), and `firstPaymentIn: month` is unchanged; only the trial ids beside it can shrink. The with/without-moves equality test covers it. `firstPaymentsAll` may still contain an after-plan account's payment via the month question, but `trialsToPaid` iterates the trial list only, so it is ignored. |
| SA-FU2-4 | Extra column on the plan walk: snapshot job | ✅ Safe. `financeSnapshotDeps` reuses `financeHealthDeps().plans`, so the nightly walk reads the column and ignores it (`walkPlans` only pages and caps). The column is `integer NOT NULL DEFAULT 0` with `CHECK (after_plan_moves >= 0)` (20261098), so the new per-row validation cannot fail on a migrated database. No plan row is spread into the payload or a snapshot write. |
| SA-FU2-5 | Extra column: entitlement reads | ✅ `PLAN_COLUMNS` is untouched; `findPlanForAccount` / `findEntitlementInputs` and the hot entitlement read select exactly what they did. The Subscriptions wiring, credit leak check, entitlement report and launch route call `pagePlans` without the option, and the repository test pins that the default select names no after-plan column. The optional `after_plan_moves?` on the row type forces nothing on writers. |
| SA-FU2-6 | Fail-closed on a bad count | ✅ Correct choice (an error, never 0), consistent with `toAfterPlanMoveState`. Cost: on a database without 20261098 the whole Finance walk fails ("Unknown"), not just MK-9 — acceptable because the column is constrained and 20261098 is on production (D3.1 #556, and 20261100 after it is applied). |
| SA-FU2-7 | RC-15 and range-cap | ✅ The wiring pin correctly lives in the RC-15 file (the only test file allowed to name the plan repository), with a planted negative control. No `.range()` added; `pagePlans` keeps `.limit()` clamped 1–1000; range-cap allow-list unchanged (11 / 17). No new import from `lib/business-os/entitlements/` in the diff, so the entitlements checklist is not triggered. |
| SA-FU2-8 | CLAUDE.md rules | ✅ DB access only in the repository (rule 1); no `console.*` in any touched file; Pino `{ err }` on the failure path unchanged; no `any` added (the `unknown` read of the count is the right narrowing); no new pattern (an opt-in select flag on an existing method, scoped by the wiring). Service-role walk is the existing admin all-accounts read; no tenancy change. |
| SA-FU2-9 | Dev's rule choice (no "first payment before trial start" exclusion) | ✅ Sound. The user's decision names the after-plan free period, the count is the exact, stored, never-reset marker of it, and the SQL checker can repeat it (`after_plan_moves = 0`), so page and MK9-C2 cannot drift. Adding the date rule would silently decide BQ-FU2-1 without the user. Keep BQ-FU2-1 open with default "no change". |

### Code Review Comments

1. `lib/business-os/billing/afterPlanMove.ts` (context, not this diff) — the count is set by an owner-started cancel of a Stripe plan subscription, not by a proven first payment. A subscription that ended without ever being charged (a 100 % coupon, or any $0 first invoice) would put a never-paid owner out of the MK-9 base. Inside the user's decision wording ("after cancelling a paid plan"), zero rows today, and a rate under 10 trials is not shown anyway. Priority: Low — record under BQ-FU2-1 as BQ-FU2-2, no code change.
2. `financeHealth.test.ts` "mixed set" — the superset assertion only checks `C`; it is true by construction, so this is fine, but the test name promises more than it checks. Priority: Low (optimisation, not blocking).
3. `BusinessOsAccountPlanRepository.ts` `pagePlans` — the error message names no row id (good, DR-10-style). No change.

### Conditions before merge (not code fixes)

- **C-1:** `npm run build` (ship drill step 1) was not run; RM runs it, and the scoped typecheck for the touched files, before commit.
- **C-2:** Any environment the branch deploys to (Preview included) must have 20261098 applied, otherwise the Finance page and the nightly snapshot walk fail closed. Production: applied. The optional read-only MK9-C2 run on production should return the same totals as before (0 after-plan rows on 2026-10-30), which the user or the session can run; I did not re-query production in this review.
- **C-1 run (RM, 2026-10-30):** scoped `tsc` on the 10 touched `.ts` files (temp tsconfig extending `tsconfig.json`, `NODE_OPTIONS=--max-old-space-size=8192`): exit 0, 0 diagnostics, no OOM (temp config deleted). `npm run build`: `Compiled successfully`, then stopped at Collecting page data only because the worktree has no `.env.local` (`Missing Supabase environment variables`, `/api/admin/execution-stats`). CI's required Build (`next build`) check is the build proof.
- **C-2 satisfied (RM, 2026-10-30):** 20261098 is applied on production, and the coordinator ran the read-only MK9-C2 checker (`scripts/check-bos-finance-trials.sql`) on production on 2026-10-30: `trial_accounts = 1`, `paid = 0`, matching the page rule with 0 after-plan rows.

### Optimisation Suggestions

- Consider a one-line note in `financeSnapshotDeps.ts` that its walk now carries `after_plan_moves` (read and ignored), so the next reader of the snapshot does not wonder why.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-30**
**Test mode:** full
**Strategy used:** A + B (Jest unit and builder-integration with mocked repositories), plus ad hoc edge-case tests run from a scratch copy outside the repo (no repo file added). No live DB run (see Skipped).
**Focus:** api, schema, performance (select unchanged for other walkers)
**Skipped:** the prod run of `scripts/check-bos-finance-trials.sql`. No Supabase SQL tool was available in the QA session, so it was not run. The change is one `and r.after_plan_moves = 0` line. 20261098 makes the column `integer NOT NULL DEFAULT 0` with `CHECK (after_plan_moves >= 0)`, so `= 0` in SQL is exactly the complement of the page's `> 0`. `npm run build` was not run (SA C-1, owned by RM).
**Input source:** prompt keywords (TL brief, 10 items)

### Test Coverage

| # | Criterion | Tested? | Result | Notes |
|---|---|---|---|---|
| 1 | Happy path: a real trial is still counted | ✅ | Pass | Dev's "a real trial is still counted" and control cases, plus QA's: a real trial on page 2 of the walk is counted and asked |
| 2 | After-plan row out of ended, running, paid and the ask, still Trial in the plan mix | ✅ | Pass | Dev's builder cases. QA added a check that the `accounts.figures.groups` output is identical with moves 2 and moves 0 (Trial count 1), while the trials figures go to 0 |
| 3 | Mixed set: the ask is a superset of what the count reads, no after-plan id asked | ✅ | Pass | Both lists come from `trialsForTrialToPaid` (source guard: exactly 2 calls, no `isTrialRow` in `financeHealth.ts`). The ask is `[C]` with E and F excluded. On SA comment 2: QA's two-page case asserts the exact ask (`[F]`), not only membership |
| 4 | Converted this month is unchanged | ✅ | Pass | Dev's with/without-moves equality. QA added: an after-plan account whose first payment is in this month still counts as Converted (`converted` is identical with moves 1 and 0) |
| 5 | Bad counts fail the page; without the option the select is unchanged | ✅ | Pass | Repository `it.each`: missing, null, -1, 1.5 and `'1'` all give `data: null` and an error, with the bad row placed second. NaN and Infinity also fail `Number.isInteger`. Without the option the select has no `after_plan` and the row has no field. QA added: a failed plan page gives trials `status: 'unknown'`, never 0 |
| 6 | Nightly snapshot job works with the extra column | ✅ | Pass | `financeSnapshotDeps` reuses `page.plans`, so it reads the column. Its rows only feed `classifyAccounts`, and no plan row is spread into the output. `financeSnapshotJob.test.ts` and `financeSnapshot.test.ts` are green. The source guard confirms the job never names `withAfterPlanMoves` |
| 7 | Page note copy and copy guards | ✅ | Pass | `PAYING_BREAKDOWN.limits` is rendered once (`PayingBreakdownSection.tsx:114`). `payingBreakdown.render.test.tsx`, `usdCopy.source.guard.test.ts` and `source.guard.test.ts` are green |
| 8 | Pins: AC-145, range-cap, RC-15 | ✅ | Pass | `EXPECTED_SHA256 = '38897cd3…4edf'` (route test untouched, `git diff` empty). `EXPECTED_CALLS` is unchanged. Range-cap `BASELINE_ENTRIES = 11`, `BASELINE_CALL_SITES = 17` (file untouched, green). RC-15 green, including the new wiring pin |
| 9 | Suites and checks | ✅ | Pass | See Test Outputs |
| 10a | Edge: moves on a later row | ✅ | Pass | QA: two-page walk with an after-plan E and a real F on page 2. Two `pagePlans` calls; E is out, F is counted and asked (`[F]`), and Trial in the plan mix = 2. In the repository, the bad-count row is second, so every row is checked. QA also confirmed the real wiring passes `{ afterUserId, limit, withAfterPlanMoves: true }` (it spreads, so keyset paging is kept) |
| 10b | Edge: a trial with a first payment in a previous month | ✅ | Pass | QA: a real trial that ended 2026-11-03 and was paid 2026-10-25 gives ended 1, paid 1, paid before end 1 (unchanged behaviour; this is BQ-FU2-1's territory) |
| 10c | Edge: livemode | ⚠️ | Pass (analysis) | The trial set is mode-agnostic on both the page and the checker. `livemode` only scopes the first-payment read, which this slice does not touch. `planBillingHandler` refuses events whose mode differs from the server's, so a deployment only moves its own mode's cancellations. See Edge Case 1 |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. Only the Finance walk adds one integer column. The Subscriptions wiring, the credit leak check, the entitlement report and the launch route still call `pagePlans` without the option. `PLAN_COLUMNS` is unchanged.

#### Edge Cases (nice to fix)
1. **The after-plan count is not tied to a Stripe mode** (Low, existing D3.1 design, not this slice). If a test-mode deployment ever shares the production database, a test-mode cancellation would set `after_plan_moves` on a real account and keep it out of the live MK-9 base for good. The D3.1 cohort move itself has the same exposure. No action unless environments share a DB.
2. **The prod checker was not run by QA** (no SQL tool in the session). Worth one read-only run (SA C-2). Expected on 2026-10-30, with 0 after-plan rows: the same totals as the pre-change checker (`trial_accounts = 1`).

### Test Outputs / Logs

| Run | Result |
|---|---|
| `jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts lib/repositories/__tests__/rangeCap.source.guard.test.ts lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts --ci` | 65 suites, 3,589 tests passed. `exchangeRatesTab.render` and `chargeChecksRequest.pin.render` did not fail, so no re-run was needed |
| `npm run test:authz-guard` | 2 suites, 203 tests passed |
| `npm run test:bos-entitlements` | 331 suites, 9,892 tests passed |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck:bos-llm` | `621 files in scope, 11 errors, 0 new (319.0s)`, passed |
| Scoped tsc (temp tsconfig extending `tsconfig.json`, the 10 touched `.ts` files, 8 GB) | Exit 0, 0 errors, no OOM. A canary (`const x: string = isAfterPlanRow(...)`) gave TS2322, so the config does check types. The temp config was deleted |
| `npm run lint:hooks` | Exit 0 |
| QA ad hoc builder cases (scratch copy of `financeHealth.test.ts`, outside the repo, `-t QAFU2`) | 6 passed: multi-page walk, plan mix identical, previous-month first payment, after-plan this-month Converted, wiring arguments, failed page gives unknown |

### Final Status
- [x] All acceptance criteria pass — ready for commit (subject to SA conditions C-1 and C-2)
- [ ] Issues found — Dev must address before commit

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Created and built (Dev) | MK5BFU-FU-2: rule `after_plan_moves > 0` out of the MK-9 base; the opt-in walk column; the checker; the page note. Uncommitted |
| 2026-10-30 | SA code review: approved (SA-FU2-1..9) | No must-fix. Ask/count superset, Converted this month, snapshot and entitlement reads confirmed safe; Dev's single-rule choice upheld, BQ-FU2-1 stays open; Low note BQ-FU2-2 (a never-charged cancelled subscription also sets the count). Conditions: C-1 build before commit, C-2 20261098 on any deploy target |
| 2026-10-30 | QA report (QA): PASS | Full mode, no bugs. 65 + 2 + 331 suites green, typecheck:bos-llm 0 new, scoped tsc 0, lint:hooks 0, pins unmoved, 6 ad hoc edge cases green (scratch only). Prod checker not run (no SQL tool); 2 Low edge notes |
| 2026-10-30 | SA C-1 run (RM) | Scoped tsc on touched files: 0 errors, no OOM. `npm run build` compiled; page-data step failed only on missing env vars; CI Build is the proof |
| 2026-10-30 | SA C-2 recorded (RM) | 20261098 applied on prod; read-only MK9-C2 checker run on prod by the coordinator: `trial_accounts = 1`, `paid = 0`, 0 after-plan rows |
