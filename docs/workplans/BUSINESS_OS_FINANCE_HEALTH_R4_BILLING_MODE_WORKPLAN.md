# Workplan: Finance R4, billing status for the current Stripe mode

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (BD-14, BD-15, BD-16); [P-8a workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md) SA condition **P8A-R4** (line 458) and its D-1; plan payments PF-15
**Branch:** `fix/bos-finance-r4-billing-mode` (from main `5e9a59f1`, P-8a fully merged)
**Date:** 2026-10-18
**Status:** Code Complete (uncommitted)
**Approval:** the user approved the fix on 2026-10-18. No migration.

## Overview

P8A-R4 (SA, quoted): *"Finance R-c′ (`BusinessOsFinanceReadRepository.ts:549`, `maybeSingle` with no mode filter) will error once an account has both a test and a live billing row. That happens to the owner account the day live keys arrive. It must be fixed before §9.5 row 14 (live keys)."* The all-accounts read R-c has the same flaw: its `FinanceReadDuplicateError` fails the whole read when an account has two rows. **Rule (approved):** Finance reads billing **status** for the current Stripe mode only, as P-8a does (PF-15). Revenue reads keep counting both modes (BD-14) and are not touched.

---

## 1. Code facts (at `5e9a59f1`)

| # | Fact | Where |
|---|---|---|
| CF-1 | R-c `listBillingStatusesAllAccounts` keyset-pages on `user_id` with no mode filter. Two rows for one account raise `FinanceReadDuplicateError`, so the whole read fails | `lib/repositories/BusinessOsFinanceReadRepository.ts:495-541` |
| CF-2 | R-c′ `findBillingStatusForAccount` runs `.eq('user_id').maybeSingle()` with no mode filter, so two rows return an error | same file `:549-568` |
| CF-3 | `UNIQUE (user_id, livemode)` allows one row per account per mode, so a test row plus a live row is legal | `20261025` |
| CF-4 | The finance source guard forbids the mode column in the repository's code (1c, BD-14), and forbids mode wording (`/livemode\|test.?mode\|live.?mode/i`) in **every** scanned finance file. Those are everything under `lib/business-os/finance`, `app/admin/finance`, the route, the repository and `payingSubscriptionStatuses.ts`. So `isLiveMode(...)` cannot appear in `financeHealthDeps.ts` either | `finance.source.guard.test.ts:97-104`, `:441-445`, `:655-692` |
| CF-5 | P-8a's one-mode reader already exists and filters on the mode: `listBillingRowsForModeAllAccounts(mode, opts)`, which keyset-pages on `id` at ≤ 1,000, with a ceiling of 20,000 that errors, and `findBillingRowForAccount(accountId, mode)`. P-8a's current-mode resolution is `currentStripeMode()` + `isLiveMode()`, and it fails closed on an unknown key | `lib/repositories/BusinessOsBillingAdminReadRepository.ts`; `lib/business-os/billing/stripeMode.ts` |
| CF-6 | The builder reaches R-c and R-c′ only through `FinanceHealthDeps['finance']`, whose names come from a `Pick` of the finance repository. The wiring is `financeHealthDeps.ts:126-127`. The snapshot job (8.2) picks R-c from the same wiring | `financeHealth.ts:255-258`, `:661-668`; `financeSnapshotDeps.ts:36` |
| CF-7 | AC-145 asserts each deps call by name and arguments (`'finance.listBillingStatusesAllAccounts': [[]]`) and hashes the payload. The route test mocks `financeHealthDeps`, so a wiring-only change leaves it byte-identical | `route.test.ts:1163-1260` |

## 2. The fix

**Option chosen: reuse P-8a's one-mode read repository through a small current-mode adapter outside the finance tree; rewire the two deps lines.**

- **New** `lib/admin/billing/currentModeBillingStatus.ts`. It holds two functions with the same signatures and result shapes as R-c and R-c′:
  - `listCurrentModeBillingStatusesAllAccounts(opts?)`;
  - `findCurrentModeBillingStatusForAccount(accountId)`.

  Each one:
  - resolves the mode with P-8a's `currentStripeMode()` / `isLiveMode()`. An unknown key returns an error, not a read (fail closed, as P-8a's 409);
  - calls P-8a's `businessOsBillingAdminReadRepository`;
  - maps each row field by field to `{ user_id, subscription_status, ended_at, bought_tier }`, so no Stripe id or other column travels on;
  - drops detached rows (`user_id` NULL), as R-c did;
  - keeps BD-16 as a defence: two rows for one account in one mode is an error. `UNIQUE (user_id, livemode)` makes that unreachable.

  Dependencies (the reader, the mode) are injectable for tests.
- **`financeHealthDeps.ts`:** the two `finance.*` billing lines now call the adapter, and the header comment says so. The names, signatures and the `FinanceHealthDeps` type are unchanged, so the builder, the route, the snapshot job and AC-145 are untouched.
- **`BusinessOsFinanceReadRepository.ts`:** R-c and R-c′ stay, because they are the `Pick` type source. Their doc comments say they are no longer wired (R4) and why. Removing them means moving the type and shrinking two pins (the finance table pin and the billing-table reader list), so it is follow-up **R4-FU-1**, not done here.

**Why this option, not a mode parameter:** a mode parameter would have to be named and passed from the route or the deps. Both are scanned finance files, where any mode wording fails CF-4, and the repository's code may not name the column. Moving the mode out of the finance tree keeps every guard as it is. It also keeps one current-mode resolution (P-8a's) and one mode-filtered reader of the table (P-8a's, D-1). **No guard is changed.**

**Effect today:** every billing row is a test row and the key is a test key, so the page and the snapshots are unchanged. Once live keys arrive, the status (paying, plan group, K-3) counts live rows only, and the owner's old test row stops counting, which is the approved rule. Revenue (R-d, R-k, R-m and the rest) still counts both modes (BD-14).

## 3. Tests

| Test | What it proves |
|---|---|
| `lib/admin/billing/__tests__/currentModeBillingStatus.test.ts` (new), through the **real** P-8a repository over a recording fake client | **Two-row case, all accounts:** an account with a test row and a live row returns exactly one row, the current mode's, for both a test key and a live key, and no duplicate error. **Two-row case, one account:** the same account returns its current-mode row and no error, for both modes. Every query carries the mode filter. Detached rows are dropped. Only the four status fields travel. A same-mode duplicate (planted) is an error. An unknown key returns an error with zero queries. A repository error is passed on. `opts` reach the reader. Paging at 1,000 is asserted with a full page plus the next one |
| `financeHealthDeps` wiring (source assertion in the same new file) | The two billing lines call the adapter and no longer call R-c or R-c′ |
| Existing finance, route (AC-145), snapshot and repository suites | Unchanged and passing |

## 4. Guards

- **Unchanged:** the finance source guard (mode wording, table pin), the billing-table reader list, the range-cap guard (no new `.limit`; the adapter adds none), the vocabulary guard, `test:authz-guard` (no route change; `requireAdmin` stays first), `test:bos-entitlements` (no entitlements import) and `lint:hooks`.
- **Frozen pins and the AC-145 hash** (`39b35743…56ea`): not edited, recomputed at handover. If one moved, work would stop.
- No `console.*` in any touched file (counts in the notes).

## 5. Risk

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A missing or unknown `STRIPE_SECRET_KEY` now makes the billing-status sections fail (fallback shown), where before they read | Fail closed by design (PF-15), the same as P-8a. Production has the key; a local checkout without it shows the section fallback, not a wrong figure |
| R-2 | The status counts change on the live-key day | That is the approved rule; it is recorded in the notes so the live-key checklist expects it |
| R-3 | Two dead methods remain in the finance repository | Comments mark them unwired; R4-FU-1 removes them with the type move |
| R-4 | The adapter's file sits outside the finance guard's scan | It holds no finance figure, only a status read. Its own test pins its columns and its mode filter |

## Implementation Notes

**2026-10-18, Dev. Implemented as §2, uncommitted. No guard, pin, route, builder or migration change.**

| File | Change |
|---|---|
| `lib/admin/billing/currentModeBillingStatus.ts` | New. `listCurrentModeBillingStatusesAllAccounts(opts?)` and `findCurrentModeBillingStatusForAccount(accountId)`. Each resolves the mode with P-8a's `currentStripeMode()` / `isLiveMode()` and reads through P-8a's `businessOsBillingAdminReadRepository`. Rows are mapped to the four status fields, detached rows are dropped, and a same-mode duplicate is an error. An unknown key fails closed with zero queries. No `.limit` of its own. `console.*`: 0 |
| `lib/business-os/finance/financeHealthDeps.ts` | The two billing lines call the adapter; one import; header and inline comment. `console.*`: 0 |
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | Comments only: R-c and R-c′ are marked NOT WIRED (R4), kept as the deps type source; R4-FU-1 removes them. `console.*`: 0 |
| `lib/admin/billing/__tests__/currentModeBillingStatus.test.ts` | New, 17 tests (see §3), through the real P-8a reader over a recording client |

**Two-row case (test row + live row for one account):**
- All accounts: a live key gives the live row only and a test key gives the test row only, with no duplicate error. Every query carries the mode filter.
- One account: the current-mode row comes back with no `maybeSingle` error. A control shows the unfiltered query on the same table errors, which is the bug being fixed.

**D-1:** the test first used real tier names as `bought_tier` fixtures, which tripped the entitlements FR-12 tier-literal guard. They are now neutral strings (`tier_a`, `tier_b`), with no guard edit.

**Flake note:** the first combined run showed 5 failures in `app/admin/finance` while it ran in parallel with `tsc`. The same suites re-run alone passed 687 of 687. No finance file there was touched.

**Runs:**

| Run | Result |
|---|---|
| `app/admin/finance` | 20 suites, 687 passed (re-run alone) |
| `lib/business-os/finance` | 20 suites, 1953 passed |
| Finance route (`app/api/admin/business-os/finance`, AC-145 included) | 2 suites, 122 passed |
| `lib/repositories` | 112 suites, 2684 passed |
| `lib/business-os/billing` (touched) | 38 suites, 3601 passed |
| Vocabulary guard | 182 passed |
| Range-cap guard | 21 passed (no new baseline entry) |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 296 suites, 8938 passed |
| `lint:hooks` | exit 0 |
| ESLint on the three code files | clean |
| Scoped tsc with a canary | The scope was the adapter, its test, `financeHealthDeps.ts` and `financeSnapshotDeps.ts`. The canary gave TS2322 at `currentModeBillingStatus.ts(137,7)`. The file was restored byte-identical (sha256 `b00a3ce4…e349`), and the clean run had 0 errors in scope |

**Pins** (HEAD blob plus `git diff --quiet`): all seven are unchanged.
- AC-173 `3a1a2dd4…`
- helper `b84e0c96…`
- A `30f5fc24…`
- B `24ff0da7…`
- C `98ea0507…`
- helper `02813360…`
- D `1f7cf07a…`

`route.test.ts` and `route.ts` are unchanged too, and AC-145 `39b35743…56ea` is present and passing.

**Follow-ups:**
- **R4-FU-1:** remove R-c and R-c′ from the finance repository, and their tests. This means moving the deps type off the repository `Pick`, then shrinking the finance table pin and the billing-table reader list, unless another read still uses the table.
- **Live-key checklist:** on the live-key day, paying, plan groups and K-3 switch to live rows (§2 Effect). Expect the owner's test subscription to stop counting as paying.

### SA-R4 fixes (Fix Required, 2026-10-18)

- **R4-C1 (High), fixed by Dev.** `routerPlacement.guard.test.ts:1078` allows only listed repository callers inside `lib/business-os/billing/`. The adapter and its test moved to `lib/admin/billing/` (P-8a's home) with the code unchanged. Only these were edited:
  - the `@module` comment;
  - the test's relative `../stripeMode` type import, which became `@/lib/business-os/billing/stripeMode`;
  - the import in `financeHealthDeps.ts`;
  - the path in the finance repository comment.

  No allow-list was widened. The guard plus `lib/admin/billing` ran 4 suites, 97 passed. My earlier billing run had missed this guard because it lives under `app/api/stripe`.
- **R4-C2, fixed.** BD-37 is in requirement §0.2, with a log line and a Change History row.
- **R4-C3, fixed.** R4-FU-1 is in §0.4 as the next Finance follow-up (pins and a type).

**Full `npm test` (Windows, this worktree):** 1578 suites (1550 passed, 20 failed, 8 skipped) and 39,968 tests (39,763 passed, 140 failed, 65 skipped), in 788 s. **Not green locally.** The 20 failing suites are all outside this diff:
- Windows path-separator guards (`oneAddressPolicy`, `publicEndpointsAreThrottled`, the CRM contact-drawer guards and the onboarding guards);
- `supabaseFetch` (dev ceiling);
- `lib/pilot` ConditionalEvaluator / StructuredTransforms;
- v4 / v6 agentkit;
- orchestration;
- the OpenAI pricing adapter.

A sample of them re-run alone fails the same way. None imports or scans a changed file; the guard failures list unrelated files with backslash paths. None is in billing, finance or repositories.

**Other checks:**
- `test:bos-entitlements`: 296 suites, 8938 passed.
- `test:authz-guard`: 2 suites, 203 passed.
- Scoped tsc on the moved files: the canary gave TS2322 at `currentModeBillingStatus.ts(137,7)`. The file was restored byte-identical (sha256 `cfa3deea…29ab4`, 135 lines). The first clean run still printed the canary line, so I re-ran it with a fresh config, and that run had 0 errors in scope.
- Pins: all seven unchanged, and `route.test.ts` unchanged.

## SA Review Notes

### SA Review (workplan and code)

**Reviewed by SA, 2026-10-18. Reviewed: the uncommitted tree on `fix/bos-finance-r4-billing-mode` (from main `5e9a59f1`).**
**Status: Code Approved (SA-R4, after the R4-C1..C3 re-check, 2026-10-18).** It was first Fix Required on R4-C1 alone.

**Re-check (SA).**
- **R4-C1:** the adapter and its test now live in `lib/admin/billing/`. `financeHealthDeps.ts` imports it from there (`:65`), and no allow-list changed. The coordinator re-ran the placement guard: 39 of 39 passed.
- **R4-C2:** BD-37 is recorded (requirement `:125`, plus the §0.2 log line).
- **R4-C3:** R4-FU-1 is listed in §0.4 (`:294`).
- **`BusinessOsFinanceReadRepository.ts`:** its diff is **comments only**. Every added line is in a doc comment and no code line changed, so it has no runtime effect.

**The 140 local Windows failures are not caused by R4.**
- `jest --findRelatedTests` on the two files that change behaviour (`financeHealthDeps.ts` and the adapter) lists **5 suites**, and SA ran them all: **303 of 303 passed**. They are the finance route, the history route, the snapshot cron route, the adapter test and `financeHealth.test.ts`.
- No pilot, agentkit, orchestration or pricing suite depends on those two files.
- Sampled failures:
  - `lib/pilot/__tests__/ConditionalEvaluator.contains_any.test.ts` fails with `TypeError: context.isConditionalCoercionEnabled is not a function`, a pre-existing mock/code mismatch in the pilot engine;
  - `lib/orchestration/__tests__/IntentClassifier.test.ts` and `lib/agentkit/v6/compiler/__tests__/LogicalIRCompiler.test.ts` also fail;
  - none of them imports or scans a changed file.
- CI on Linux is the gate.

#### Finding

| # | Issue | Priority |
|---|---|---|
| R4-C1 | **`npm test` is red.** `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts:1078` fails with "billing modules touch the database only through the allow-listed repository caller (SA P1-C6, P-2a M-1)". `currentModeBillingStatus.ts` imports `BusinessOsBillingAdminReadRepository` from `lib/business-os/billing/`, and that folder may reach the data layer only through its one allow-listed caller. The workplan's "no guard change" claim is therefore wrong. **Fix:** move the adapter (and its test) **unchanged to `lib/admin/billing/currentModeBillingStatus.ts`**. That is P-8a's home for admin billing code that needs the data layer (P-8a §5.2, `subscriptionsDeps.ts`), and it is the same reader's existing folder. Point the `financeHealthDeps.ts` import at it. **Do not** widen the placement allow-list. Re-run the placement guard, the finance suites, `test:bos-entitlements` and the full `npm test` | **High** |

#### Ruling: the Finance mode guard

**Legitimate structure, not a bypass, with the adapter in `lib/admin/billing/`.** The finance guard's `MODE_WORDING` rule (`finance.source.guard.test.ts:659-690`) keeps every finance file mode-agnostic, because Finance never filters **revenue** by mode (BD-14). The user's 2026-10-18 rule moves only billing **status** to the current mode (PF-15). That decision belongs to billing-owned code, which already owns `currentStripeMode`, and Finance still names no mode.

**Condition R4-C2:** record the rule in the Finance requirement as a numbered user decision (**BD-37**: "billing status is read for the current Stripe mode only; revenue keeps both modes (BD-14)"), with a pointer from BD-14 and BD-16. Two pins hold it in place: the adapter test's existing "wires both billing-status names to the current-mode functions" and "no longer calls the unfiltered R-c or R-c′" (`:244`, `:249`).

#### Verified (on the current code; re-checked after R4-C1)

| Item | Result |
|---|---|
| Test row plus live row for one account | ✅ Both reads tolerate it. Live key: one row per account, the live one, and no duplicate error. Test key: the test rows only. R-c′'s control case shows the unfiltered read errors on the same fixture (the bug), and the filtered one does not |
| Same-mode duplicate | ✅ It is still an error, never a guess (`CurrentModeBillingDuplicateError`, planted test). UNIQUE (`user_id`, `livemode`) makes it unreachable, and the check stays as a belt |
| Revenue unchanged | ✅ Only the two billing-status wiring lines changed. `countRevenueRows`, layer A and layer B still call the finance repository, both modes (BD-14) |
| Mode failure | ✅ It fails closed. An unknown key returns an error with **zero queries** (tested for both reads), so Section 1 shows "paying unknown" as before, and the wrong mode is never shown. In an environment with no Stripe key the same Unknown applies; that is honest |
| Columns and fields | ✅ Only `user_id`, `subscription_status`, `ended_at` and `bought_tier` cross. The panel read's customer id stops in the adapter (tested) |
| Repositories and paging | ✅ All reads go through `BusinessOsBillingAdminReadRepository`. The all-accounts read keyset-pages at ≤ 1,000 (test: a full page is followed by the next), and the ceiling is an error. The FF-1d `rangeCap` guard passes |
| Pins | ✅ AC-145 `39b35743…56ea` is unchanged (the hash constant is present, and the finance route suite passes). SA recomputed the other six: `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`. The payload shape is unchanged |
| SA run | Placement guard, adapter test, `lib/business-os/finance`, the finance route and FF-1d: **2151 of 2152 passed**; the one failure is R4-C1 |

#### Ruling: R4-FU-1

**A follow-up, not in this PR.** Removing R-c and R-c′ means moving the `FinanceHealthDeps` `Pick` type off the repository and shrinking two pins (the finance table pin and the billing-table reader list). That is a pin-touching refactor that a must-ship fix before live keys should not carry. The "NOT WIRED" doc comments are acceptable meanwhile. **Condition R4-C3:** schedule R4-FU-1 as the next Finance follow-up, listed in §0.4, so the dead methods do not linger.

#### Code Approved for QA: Yes (R4-C1 to R4-C3 met and re-checked)

## QA Testing Report

**QA — 2026-10-18** (worktree `neuronforge-finance-m8`, branch `fix/bos-finance-r4-billing-mode` on `5e9a59f1`, uncommitted. Verified on the tree **after R4-C1**: the adapter and its test moved to `lib/admin/billing/` at 20:41, stable since)
**Test mode:** full
**Strategy used:**
- **A + B:** Jest suites, run one at a time on the settled tree.
- A code read of the adapter, the wiring and the callers.
- A scoped tsc with a canary.

**Focus:** api, security
**Skipped:** none. Nothing here needs a browser look before live keys.
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.** R4-C1 is confirmed fixed: the billing placement guard is green with no allow-list change. R4-C2 is recorded (BD-37 in the requirement), and R4-C3 too (R4-FU-1 in §0.4).

### Behaviour

| Case | Result | Evidence |
|---|---|---|
| Test row plus live row for one account: the all-accounts read succeeds, one row per account for the current mode | ✅ | adapter test "live key: one row per account, the live one, and no duplicate error"; "test key: the test rows only, the owner once, the detached row dropped" |
| The same account, one-account summary: the current-mode status, not the fallback | ✅ | "live key: the live row, no maybeSingle error"; "test key: the test row"; "control: without the mode filter the same account errors (the bug being fixed)" |
| Test key shows test rows; live key shows live rows | ✅ | the four tests above, through the **real** P-8a reader over a recording client; every query carries the mode filter |
| Mode cannot be resolved: fail closed, existing fallback | ✅ | "an unknown key fails closed with zero queries", for both reads. The adapter returns an error, so the builder takes its existing failed-billing-read path ("paying unknown" and the section fallback), unchanged in `financeHealth.ts` |
| A real duplicate in one mode is still caught | ✅ | "a same-mode duplicate (planted…) is an error, never a guess" (`CurrentModeBillingDuplicateError`) |
| Revenue unchanged, both modes | ✅ | only the two billing-status lines in `financeHealthDeps.ts` changed. `financeHealth.ts`, `boostRevenue.ts`, `planRevenue.ts`, the finance route and `app/admin/finance` are `git diff --quiet` against HEAD. The finance repository diff is comments only. AC-145 `39b35743…56ea` is present and the route suite is green (122/122) |
| Fields and paging | ✅ | only the four status fields travel (the customer id stops in the adapter); pages at 1,000 with a next page; both callers pass no `opts`, so the reader's defaults apply (1,000 per page, 20,000 ceiling as an error) |

### Suite runs (each alone, on the settled tree)

| Suite | Result |
|---|---|
| Billing placement guard `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` (R4-C1) | **1/1, 39/39** |
| `lib/admin/billing` (the adapter test, 17 cases, moved here) | 3/3, 58/58 |
| `lib/business-os/billing` | 37/37, 3584/3584 (= Dev's 3,601 − the 17 moved tests) |
| `app/admin/finance` | 20/20, **687/687** alone, and again **687/687 while a tsc run loaded the machine**. Dev's 5 parallel failures did not reproduce. They are the known load flake: no file there is touched |
| `lib/business-os/finance` | 20/20, 1953/1953 |
| The finance route `app/api/admin/business-os/finance` | 2/2, 122/122 |
| `lib/repositories` | 112/112, 2684/2684. A first run shared the machine with the entitlements suite, and 3 scan guards failed to finish (load); alone they are green |
| Vocabulary guard | 182/182 |
| Range-cap guard | 21/21, no baseline entry |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 296/296, 8938/8938 |
| `npm run lint:hooks` | exit 0 |

**Scoped tsc:**
- Config in the scratchpad covering the adapter, its test, `financeHealthDeps.ts`, `financeSnapshotDeps.ts`, `financeHealth.ts`, `financeSnapshotJob.ts` and the finance repository.
- A canary in `lib/admin/billing/currentModeBillingStatus.ts` gave `(137,7) TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

**Pins (LF-normalised):** `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, all unchanged.

**A QA process note (no product effect):** my first canary attempt ran **while the adapter was being moved**. It appended to the old path, which no longer existed, and so created a stray 33-byte untracked file holding only the canary line. QA deleted it at once, checking its size and content first. `git status` then showed only Dev's files, and the canary was redone on the new path as above.

### Issues Found
- **Bugs:** none.
- **Performance:** none. The same one-mode keyset read P-8a already uses.
- **Notes for the live-key day:** as Dev recorded, paying, plan groups and K-3 switch to live rows, and the owner's test subscription stops counting as paying. That is BD-37, by design. R4-FU-1 (remove the unwired R-c / R-c′) is the next Finance follow-up.

### Final Status
- [x] All R4 behaviours pass on the post-R4-C1 tree. No bugs. **Ready for RM** once SA records the R4-C1 re-check.
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created and implemented (Dev) | R-c / R-c′ rewired to P-8a's one-mode reader through `currentModeBillingStatus.ts`; no guard, pin, route or migration change. Implementation Notes with counts; R4-FU-1 recorded |
| 2026-10-18 | SA review | Fix Required (SA-R4): R4-C1 move the adapter to lib/admin/billing (the billing placement guard fails; no allow-list widening); R4-C2 record BD-37 in the Finance requirement; R4-C3 schedule R4-FU-1 (removal deferred). The mode ruling is a legitimate structure. Verified: dual-mode tolerance, same-mode duplicate, revenue unchanged, fail-closed mode, paging, pins |
| 2026-10-18 | SA-R4 fixes (Dev) | R4-C1 adapter moved to lib/admin/billing (no allow-list change); R4-C2 BD-37 recorded; R4-C3 R4-FU-1 in §0.4; full npm test run (20 environment failures outside the diff) |
| 2026-10-18 | SA re-check | Code Approved (SA-R4): adapter moved to lib/admin/billing, BD-37 and R4-FU-1 recorded, repository diff comments only; the 140 local Windows failures are outside the related-test set (the 5 related suites: 303 passed) |
