# Workplan: Business OS Finance & Business Health — Slice 1b

> **Last Updated**: 2026-10-10

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), slice **1b** (§0.1, §9, §10.0, §10.5, §10.8 R-b, §11).
**Builds on:** slice 1a, merged to `main` as PR #284 (merge `5a6fff13`). [Slice 1a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md) · [Slice 1a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md)
**SA rulings implemented:** SA-Q7, SA-Q10 (§0.3), and the 1a rulings that still apply: SA-W1 (narrowing to a picked business), SA-WR-1 (admin-written text dropped in the wiring), SA-WR-3 (AC-42 spies at the repository boundary), SA-WR-4 (pure builders take their inputs as parameters), SA-WR-5 (platform accounts labelled), SA-WR-7 (scratch tsconfig, canary).
**Date:** 2026-10-10
**Branch:** `feature/bos-finance-health-1b` (cut by RM from `origin/main` `5a6fff13`; confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`). `node_modules` is a junction to the main checkout: never `git worktree remove`, never `git stash`.
**Status:** Code Complete. SA workplan review APPROVED WITH CONDITIONS (SA-WR-8 to SA-WR-13 applied). Uncommitted, awaiting SA code review. See [Implementation Notes](#implementation-notes).

## Overview

Slice 1b completes slice 1 of the admin page `/admin/finance`. It adds **Section 4 (Credits)**, tiles **K-2** (accounts far over allowance) and **K-4** (gifted credits outstanding), the new named all-accounts read **R-b** `listLotsWithDrawsAllAccounts` on the credit lot repository, and the **SA-Q7 refactor** of `adminCreditPercent.ts`: one shared calculation, two outputs. The Businesses list keeps its percent-only "Credits left" column, unchanged in behaviour, and its existing tests pass without edits.

The slice has no migration, no SQL function, no write, no LLM call and no audit entry. Credits are units, not money: no currency appears in Section 4.

Six points need an SA ruling before code (§ [Questions for SA](#questions-for-sa-before-code), SA-W9 to SA-W14). One of them (SA-W9) is a gap between the requirement's SQL check 5 and the schema: deleted accounts' lots.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [R-b: the new lot read](#r-b-the-new-lot-read)
- [SA-Q7: one core, two projections](#sa-q7-one-core-two-projections)
- [Section 4, K-2 and K-4: pure functions](#section-4-k-2-and-k-4-pure-functions)
- [The builder and the route](#the-builder-and-the-route)
- [With a business picked (AC-42 re-run)](#with-a-business-picked-ac-42-re-run)
- [Failure matrix](#failure-matrix)
- [Multi-currency and units](#multi-currency-and-units)
- [The page](#the-page)
- [Guard table, line by line](#guard-table-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

Every file below was opened at `5a6fff13` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| The pass's output type has no count by construction | `lib/business-os/credits/adminCreditPercent.ts:57-62` (`AdminCreditsLeft`), `:64-68` (`AdminCreditsPass`) |
| The deps type, with `getSnapshots` injectable for tests only | `adminCreditPercent.ts:78-87` |
| Budget written as `2 * 1000` for the credit-figure guard | `adminCreditPercent.ts:94-95`; paging `{ pageSize: 1_000, ceiling: 5_000 }` `:101` |
| The internal `Position` already holds `anchor`, `allowance`, `trial` | `adminCreditPercent.ts:117-121` |
| `computeByAccount`: snapshots and anchors in parallel, the window rule, the 92-day trial cut-off, the range, chunked totals, "never a partial sum" on the ceiling, per-account `used` | `adminCreditPercent.ts:124-231` (ceiling `:193-194`, `used` loop `:202-225`) |
| `readAdminCreditsLeft`: seam mapping, the 2 s race, unref'd timer, warn on timeout / failure, one info line with counts only | `adminCreditPercent.ts:237-291` (`resolveAccountId` `:249`, info `:285-286`) |
| The Businesses list is the one caller today | `app/api/admin/users/route.ts:27-28, 188-195, 218-221`; the cell `app/admin/users/components/CreditsLeftCell.tsx:39-51` |
| The production wiring of the pass (plan anchors batch + totals) | `lib/business-os/credits/adminCreditPercentDeps.ts:17-19` ("the one caller is `GET /api/admin/users`"), `:30-36` |
| `creditPercentLeft` refuses allowance ≤ 0 and works in micro-credits | `lib/business-os/credits/creditBands.ts:89-111`; `roundToLedger` `creditBalance.ts:26-28` |
| Allowance = the owner card's figure (plan allowance only, no lots) | `lib/business-os/entitlements/creditAllowanceView.ts:88-106` |
| The one definition of gifted credits at an instant | `lib/business-os/credits/creditLots.ts:1-37` (header), `:93-99` (`<=` expiry), `:130-155` (`extraCreditsAt`, `null` on any unreadable figure, negative clamped + `hasInconsistentLot`) |
| Lot repository: header (service role, every read `.eq('user_id')`, callers paragraph), column lists, read limits | `lib/repositories/BusinessOsCreditLotRepository.ts:29-45`, `:150-152` (`CREDIT_LOT_COLUMNS`, `CREDIT_LOT_DRAW_COLUMNS`), `:154-159` (`ROWS_CEILING: 1000`, `MAX_IDS_PER_REQUEST: 200`) |
| Lot mapping carries admin text (`reason`, `idempotencyKey`, `sourceRef`, `actorAdminId`) | `BusinessOsCreditLotRepository.ts:113-147`, `mapDraw` `:246-258`, `mapLot` `:260-279` |
| Logging on failure never logs the error object (CR11a-1) | `BusinessOsCreditLotRepository.ts:297-308` |
| The account-scoped read, the shape R-b copies | `BusinessOsCreditLotRepository.ts:419-460` (`range(0, ceiling - 1)`, `>= ceiling` → error, draws in chunks of 200) |
| `user_id` on lots and draws is `ON DELETE SET NULL` | `supabase/migrations/20261017_business_os_credit_lots.sql:25, 70`; source CHECK `:27`; admin-grant shape `:47` (`actor_admin_id`, `reason` NOT NULL) |
| Lot repository tests: recording client, the `listLotsWithDraws` block, source guards | `lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts:412-506`, `:535-559` (exactly two `.rpc(`, no write verb, never `*`) |
| G3: exact list + non-vacuity + barrel | `lib/business-os/credits/__tests__/creditLots.test.ts:178-190` (`SYMBOLS`, incl. `extraCreditsAt` and `'credits/creditLots'`), `:201-228` (`ALLOWED_LIST`), `:264-272` (non-vacuity, test files exempt), `:289-293` (barrel) |
| `Pick<…>` precedent for the lot repository | `lib/business-os/credits/adminCreditPositionDeps.ts:46-50, 58` |
| Finance 1a builder: account check first, `settle`d reads, names only from rows read | `lib/business-os/finance/financeHealth.ts:82-104` (deps), `:168-178`, `:192-206`, `:248-254` |
| Finance 1a wiring: override rows dropped (SA-WR-1) | `lib/business-os/finance/financeHealthDeps.ts:34-42, 45-67` |
| Finance types and tiles | `lib/business-os/finance/financeTypes.ts:206` (`FinanceTileId`), `:225-234` (`FinancePayload`) |
| Finance rules: vocabulary, data rules, green set, colouring | `lib/business-os/finance/financeRules.ts:25` (`FinanceMetric`), `:41-47`, `:56-83`, `:89-92`, `:131-158` |
| `classifyAccounts` returns `groupByAccount` | `lib/business-os/finance/planGroups.ts:97, 116-183` |
| Route: one info line, `no-store` everywhere | `app/api/admin/business-os/finance/route.ts:144-161` |
| UI: KPI strip renders K-1, K-3, K-5 only; view section order | `app/admin/finance/components/FinanceKpiStrip.tsx:36-51`; `FinanceView.tsx:89-96` |
| `formatCredits` already exists | `app/admin/finance/financeFormat.ts:12-14` |
| Finance source guard: scanned files, "only planGroups.ts and the wiring import from entitlements" | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:34-41, 103-106, 108-117` |
| Non-gate importer entries (stay as they are) | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:375-379` (`adminCreditPercent.ts`), `:462-482` (finance) |
| RC-15: the 8a wiring pin and the finance wiring pin | `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts:160-166, 197-198, 205-206, 397-408, 422-434` |
| Ledger read repository caller list | `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:1037-1085` (`adminCreditPercentDeps.ts` and the three finance files already listed) |
| Credit bands guard scans every product file in `lib/business-os/credits/` | `lib/business-os/credits/__tests__/creditBands.guard.test.ts:26-32, 50-56, 61-67` |
| "No Date from an anchor" pin on `adminCreditPercent.ts` | `lib/business-os/credits/__tests__/creditPeriod.test.ts:159-174` |
| Credit-figure guard: `adminCreditPercent.ts` in `SOURCES`; builder names that force a listing | `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts:32, 116-160 (143), 168-174, 278-284` |
| Account seam: no raw user id into `getSnapshots` | `lib/business-os/entitlements/__tests__/accountSeam.guard.test.ts:200-296` (`:280`) |
| N-10 already scans the whole finance directory | `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:83-89, 105, 132-133` |
| Names read: 200 ids per request | `lib/repositories/BusinessProfileRepository.ts:34-35, 681` |
| Live tables (1b): totals 6 rows; lots 1 row (`admin_grant`); draws 1 row (`reversal`) | `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_LIVE_SCHEMA.md:82-86` |

---

## Scope

Exactly the 1b row of requirement §10.0.

| In 1b | Out (slice 2 or later) |
|---|---|
| S1-FR-21 to S1-FR-24 (Section 4); the 1b parts of S1-FR-4, S1-FR-5, S1-FR-9 | Anything in slice 2 or later; boost lots in Section 4 (slice 4; R-b already returns them) |
| Tiles K-2, K-4 | K-6, K-7 |
| Read R-b `listLotsWithDrawsAllAccounts` | Any change to `listLotsWithDraws` or the lot writers |
| SA-Q7 refactor of `adminCreditPercent.ts` (one core, two projections) | Any change to the Businesses list's output or tests |
| G3 and lot-repository caller-list updates | FU-4 (shared ledger read for Section 3 and K-1), parked |
| ACs tagged 1b and the 1b re-runs (see [AC mapping](#ac-mapping)) | AC-13 (slice 2) |

---

## Questions for SA before code

Each has a recommendation, which I build unless SA rules otherwise.

| # | Issue | Recommendation |
|---|---|---|
| **SA-W9** | **Deleted accounts' lots.** `user_id` on lots and draws is `ON DELETE SET NULL` (migration `:25, :70`), so a deleted account's admin grant stays with `user_id` NULL. SQL check 5 (§13) counts every `admin_grant` lot, so it would include them in "outstanding". Nobody can use those credits. The requirement does not say which reading K-4 takes, and AC-11 compares K-4 with check 5. | R-b returns every lot, NULL `user_id` included (like R-a; the caller decides). **K-4 and the gifted column exclude lots with no account.** They are counted in a one-line note ("N credits on deleted accounts, not counted") and in the window figures (the grant did happen). **BA edit:** check 5 adds `and l.user_id is not null` to `grants`, with a comment line. The alternative is to count them in K-4 and leave check 5 as it is, but that overstates what is outstanding. |
| **SA-W10** | **Where the 150% lives.** BD-11 says thresholds are data. K-2's rule is "count ≥ 1" (`atLeast`), which Health's model holds. The per-account cut, 150% of allowance, is a parameter of the **metric**, and Health's condition kinds have no per-entity threshold (`shareAtLeast` is a share of a total). | A data constant beside the rules in `financeRules.ts`: `FINANCE_METRIC_PARAMS = { farOverAllowancePercent: 150 }`, an integer validated at use (100 to 1000; invalid → K-2 `unavailable` with the rules-invalid headline, logged like a rule error). The payload carries the value, so the tile's subtitle says "150%" from data, never from a literal in the page. An AC-20-style test proves that changing it to 120 changes the count with no code change. No new condition kind. |
| **SA-W11** | **The plan walk at its cap (20,000) and Section 4.** AC-37 covers a failed walk ("credits section unknown"). For a capped walk the account list is incomplete, so K-2 would be a lower bound, and §7.1 says K-2 cannot be inexact. | **Capped walk → Section 4 `unknown` and K-2 `unavailable`**, and the pass is not called, so there is never a partial sum. K-4 does not depend on the walk (it reads lots, not accounts), so it still renders. A capped walk means more than 20,000 accounts, which is far past the pass's own scale trigger (1,000 accounts, `adminCreditPercent.ts:39-40`). |
| **SA-W12** | **Section 4 failure split.** AC-16 says a failed totals read makes "the whole credits section Unknown". AC-38 says a failed lots read makes "the gifted column and K-4 Unknown; the rest renders". The two reads are independent. | The [failure matrix](#failure-matrix) below. In short: pass failed → section `unknown` (the table, the over-allowance counts and K-2 are Unknown), but **K-4 still shows its value** (the tile does not depend on the totals). Lots failed → the gifted column, the gifted summary line, the window grants line and K-4 are Unknown; the rest renders. SA to confirm. |
| **SA-W13** | **How the finance wiring reaches the pass's reads.** The pass needs `findPeriodAnchorsBatch` (plan repository) and `listTotalsForAccountsInRange` (ledger read repository). Wiring them directly in `financeHealthDeps.ts` would grow the RC-15 finance pin from two methods to three. | **Reuse `adminCreditPercentDeps()`** inside `financeHealthDeps.ts`. The finance wiring then names neither method, so the RC-15 pin stays `['findEntitlementInputs', 'pagePlans']` and the ledger caller list is untouched. `adminCreditPercentDeps.ts` changes only its header comment, which today says "the one caller is `GET /api/admin/users`". |
| **SA-W14** | **Admin text on lot rows.** SA-Q10 mandates "the existing column lists", which include `reason`, `idempotency_key`, `source_ref` and `actor_admin_id`. Section 4 needs none of the text. | The SA-WR-1 precedent: **the wiring maps each lot to a narrow `FinanceLot`** (`id`, `accountId`, `source`, `creditsGranted`, `expiresAt`, `createdAt`, `actorAdminId`, and draws as `kind`, `credits`, `createdAt`). `reason`, `idempotencyKey`, `sourceRef`, `creditValueVersion` and the draws' `reason` / `actorAdminId` / `idempotencyKey` never reach the builder, the payload or a log. `actorAdminId` is used only for a **count** of distinct granting admins and never leaves the builder. A test with a planted reason pins it. |

Smaller points, recorded so the review can strike them out:
- **SA-W15. Table size.** S1-FR-21 says one row per account. Today there are 8. I cap the **displayed** rows at 200 (`ADMIN_IDENTITY_CHUNK`, so the names read is one request), sorted by % used, with "Showing 200 of N". The summary line and K-2 always count every account.
- **SA-W16. Names.** Section 4 makes its own `findNames` call for the displayed rows (ids taken from plan rows already read), separate from Section 3's. Folding the two into one call would change the 1a builder test's exact-argument assertion for no gain.
- **SA-W17. "% used"** is shown in tenths, floored (`floor(usedMicro × 1000 / allowanceMicro)`), so 149.95% shows as 149.9% and never rounds up into the K-2 band. A row with `used > 0` that floors to 0.0 shows "<0.1%".

---

## Analysis Summary

| Area | Touched how |
|---|---|
| Credit-percent pass | `adminCreditPercent.ts`: the internal pass returns positions; `readAdminCreditsLeft` projects them to today's output; a new `readAdminCreditPositions` returns them for the finance route (SA-Q7) |
| Lot repository | New named all-accounts read R-b; header updated |
| Finance builder | New pure `creditsSection.ts`; `financeHealth.ts` gains the credits and lots deps, Section 4, K-2, K-4; `financeRules.ts` gains K-2 / K-4 |
| Wiring | `financeHealthDeps.ts` wires the pass through `adminCreditPercentDeps()` and the lots through a `Pick<…>` with the narrow mapping |
| Route | The one info line carries the new statuses and counts; nothing else changes |
| Page | K-2 and K-4 in the strip; new Section 4 after Section 3 |
| Tables read (1b) | `business_os_credit_totals` (through the existing pass), `business_os_credit_lots`, `business_os_credit_lot_draws` (LS:82-86, live-verified). No new column is named: R-b uses the existing column lists |
| Not touched | `readAdminCreditsLeft`'s signature and output, the users route and its tests, `CreditsLeftCell.tsx`, `creditLots.ts`, the lot writers, every Health file, the 1a reads |

---

## Implementation Approach

1. **Refactor first, behind the existing tests.** The SA-Q7 split is done before any finance code, and `adminCreditPercent.test.ts`, `route.creditsLeft.test.ts` and the users `route.test.ts` must pass **byte-identical** (`git diff --exit-code` on the three files). New tests for the second projection go in a **new** file, so the existing one is never opened for editing.
2. **Repository, then pure functions, then the builder, then the UI**, each with its tests (the 1a order).
3. **The builder stays pure at the repository boundary** (SA-WR-4). It receives `AdminCreditPercentDeps` and a lots dep, and calls the real `readAdminCreditPositions` and the real `extraCreditsAt`. Tests fake only the reads, as in 1a.
4. **No new pattern.** The narrow mapping in the wiring is SA-WR-1's. The `Pick<…>` on the lot repository is `adminCreditPositionDeps.ts`'s. The integer micro-credit arithmetic is `creditBands.ts`'s and `creditLots.ts`'s.

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/credits/__tests__/adminCreditPositions.test.ts` | Tests of the new projection and of projection parity with `readAdminCreditsLeft` (the existing test file is not edited) |
| `lib/business-os/finance/creditsSection.ts` | Pure: `buildCreditsSection(input)` → Section 4 figures, K-2 count, K-4 total, window grants. Names `extraCreditsAt` (G3) |
| `lib/business-os/finance/__tests__/creditsSection.test.ts` | AC-8, AC-11 (method), AC-17, AC-19, SA-W9, SA-W17, sorting, the cap |
| `app/admin/finance/components/CreditsSection.tsx` | Section 4: summary line, table, notes |

### Modify

| File | Change |
|---|---|
| `lib/business-os/credits/adminCreditPercent.ts` | SA-Q7: `computeByAccount` → `computePositions` returning `AdminCreditPosition`; private `toCreditsLeft` projection; a private budget runner shared by both readers; new export `readAdminCreditPositions`; header (what it answers, tenant isolation) updated. Imports unchanged |
| `lib/business-os/credits/adminCreditPercentDeps.ts` | Header comment only: two callers (SA-W13) |
| `lib/repositories/BusinessOsCreditLotRepository.ts` | R-b `listLotsWithDrawsAllAccounts()`; header: the all-accounts exception and the finance caller |
| `lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts` | New `describe('listLotsWithDrawsAllAccounts')`; the file's header sentence "every read scopes by `user_id`" gets the one named exception |
| `lib/business-os/credits/__tests__/creditLots.test.ts` | G3 `ALLOWED_LIST`: five entries under a "Finance & business health slice 1b" comment |
| `lib/business-os/finance/financeTypes.ts` | `FinanceTileId` + `'k2_far_over_allowance' \| 243 |
| `lib/business-os/finance/financeRules.ts` | `FinanceMetric` + `'accountsFarOverAllowance'`; vocabulary entries for K-2, K-4; `FINANCE_RULES.k2_far_over_allowance` (amber, `atLeast` 1) and `k4_gifted_outstanding: []`; K-2 in `FINANCE_GREEN_ELIGIBLE`; `FINANCE_METRIC_PARAMS` (SA-W10) |
| `lib/business-os/finance/financeHealth.ts` | Deps `credits: AdminCreditPercentDeps` and `lots`; the pass chained on the plan walk; Section 4; K-2, K-4; Section 4 names call; counts |
| `lib/business-os/finance/financeHealthDeps.ts` | `credits: adminCreditPercentDeps()`; `lots` through `Pick<BusinessOsCreditLotRepository, 'listLotsWithDrawsAllAccounts' \| 120 |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | New describes: Section 4, K-2, K-4, failure matrix, AC-42 for 1b, the lot-text test. Existing 1a cases unchanged except the shared fake gaining the two new deps |
| `lib/business-os/finance/__tests__/financeRules.test.ts` | K-2 / K-4 colouring, AC-19, the SA-W10 data test, vocabulary |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Non-vacuity adds `creditsSection.ts`; new pins: the wiring calls exactly `listLotsWithDrawsAllAccounts` and `listLotsWithDraws` on the lot repository, and no finance file names `recordLot`, `reverseLot` or a lot RPC name |
| `app/api/admin/business-os/finance/route.ts` | The info line adds `sections.credits`, `tiles.k2/k4` and the credit counts |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | The mocked wiring gains `credits` and `lots`; AC-42 through the route for 1b; the info line has no credit figure |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | Five tiles: K-1, K-2, K-3, K-4, K-5 |
| `app/admin/finance/components/FinanceView.tsx` | `<CreditsSection>` after `<AiCostSection>` |
| `app/admin/finance/financeCopy.ts` | Section 4 and tile strings |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Fixture gains `credits`, `k2`, `k4`; AC-8, AC-16, AC-21, AC-38 render cases |
| `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` | §0.1 and Change History now; results after each stage |

Not modified, on purpose: `adminCreditPercent.test.ts`, `app/api/admin/users/route.ts` and its tests, `CreditsLeftCell.tsx`, `creditLots.ts`, `enforcementPoints.test.ts`, `businessOsEntitlements.imports.guard.test.ts`, `BusinessOsCreditLedgerReadRepository(.test).ts`, `creditFigures.fromConfig.guard.test.ts`, `serviceColumn.guard.test.ts`, every Health file, `lib/repositories/index.ts` (the class and singleton are already exported, and no new type needs the barrel).

`console.*` in the files to modify: none (counted: `adminCreditPercent.ts`, `adminCreditPercentDeps.ts`, `BusinessOsCreditLotRepository.ts` and the finance and page files all 0). The CLAUDE.md flag-and-convert rule has nothing to convert.

---

## R-b: the new lot read

`BusinessOsCreditLotRepository.listLotsWithDrawsAllAccounts`, per SA-Q10 and §10.8.

| Item | Spec |
|---|---|
| Signature | `async listLotsWithDrawsAllAccounts(): Promise<RepositoryResult<BusinessOsCreditLotRow[]>>`. No argument: there is no account to pass, so none can be omitted by mistake (SEC-3: "named all-accounts methods, never by omitting an account argument") |
| Client | Service role (constructor default). **Header:** a new "ALL ACCOUNTS (named, SA-Q10)" paragraph says this is the one read without `.eq('user_id')`, why (an admin platform figure, behind `requireAdmin`; no owner RLS client can read other accounts' lots), that it is read-only, and that its one caller is `lib/business-os/finance/financeHealthDeps.ts`, reached only from `GET /api/admin/business-os/finance` when no business is picked. The CALLERS paragraph (`:40-44`) adds the finance wiring. The sentence "Every read adds `.eq('user_id', accountId)`" (`:37`) names this exception |
| Lots query | `.from('business_os_credit_lots').select(CREDIT_LOT_COLUMNS).order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, ceiling - 1)`. No `user_id` filter (NULL `user_id` included). No `source` filter: every source is returned and the caller filters `admin_grant` (slice 4 reuses it for boost lots) |
| Draws query | For the lot ids, in chunks of `MAX_IDS_PER_REQUEST` (200): `.from('business_os_credit_lot_draws').select(CREDIT_LOT_DRAW_COLUMNS).in('lot_id', chunk).order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, ceiling - 1)`. No `user_id` filter (a draw's `user_id` equals its lot's, migration `:100`) |
| Ceiling | `CREDIT_LOT_READ_LIMITS.ROWS_CEILING` (1,000) for the lots read and for each draws chunk. **Reached (`>=`) → error** `too_many_lots` / `too_many_draws`, `data: null`, never a partial list (the `listLotsWithDraws` rule, `:433, :449`). It stays at 1,000 because each read is one request, and Supabase's default `max-rows` is 1,000: a larger `range` would be cut silently at 1,000 and the `>=` check would never fire. Slice 4 (boost lots) pages it if volume requires |
| Mapping | The existing `mapLot` / `mapDraw` (an unreadable figure, id or date makes the whole read an error, never a 0) |
| Logging | Success: `info` (cross-account) `{ method, lots, draws, durationMs }`. Failure: the existing `fail` (warn, message and SQLSTATE only, CR11a-1) |
| Result | `{ data: lots with draws attached, error: null }`; `[]` with one query when there is no lot |
| Writes | None. The file keeps exactly two `.rpc(` and no write verb (the source guard at `:539-542` stays green) |

**Tests** (`BusinessOsCreditLotRepository.test.ts`, the existing recording client):
1. Lots then draws, exact columns, **no `eq` call at all** on either query, the two `order` calls, `range(0, 999)`, `in('lot_id', …)`; draws attached to their lots; a lot with `user_id` NULL and a `boost_purchase` lot are both returned.
2. No lot → `[]` and one query.
3. The lots read at the ceiling → `too_many_lots`; a draws chunk at the ceiling → `too_many_draws`; both `data: null`.
4. 201 lots → two draws chunks (200, 1).
5. An unreadable figure → error, never a 0.
6. A read error → `{ data: null, error }`, logged at warn without `details`; info line on success carries counts only (no id, no figure).

---

## SA-Q7: one core, two projections

All in `lib/business-os/credits/adminCreditPercent.ts`. No new file names `creditAllowanceForDisplay`, `getSnapshots` or the period helpers, so the credit-figure, account-seam and period guards gain no entries (§12.2).

### The core

```ts
/** One account's credit position in its current period. Counts: finance route only. */
export type AdminCreditPosition =
  | { kind: 'position'; allowance: number; used: number; trial: boolean }
  | { kind: 'no_allowance' }
  | { kind: 'unknown' };
```

`computeByAccount` is renamed `computePositions` and returns `Map<string, AdminCreditPosition>` plus `error`. Its body is today's, line for line, except the tail of the loop at `:217-224`: instead of calling `creditPercentLeft`, it stores `{ kind: 'position', allowance: position.allowance, used: roundToLedger(used), trial: position.trial }`. An unreadable totals figure (`:209-212`) stores `{ kind: 'unknown' }`, as today. The reads, their order, chunking, range, ceiling and the 92-day trial rule do not change, so the "calls grow per chunk" test (`adminCreditPercent.test.ts:322`) sees the same calls.

### Projection 1: the Businesses list (unchanged behaviour)

`toCreditsLeft(position: AdminCreditPosition): AdminCreditsLeft`, private:
- `position` → `creditPercentLeft(position.used, position.allowance)`; `null` → `unknown`; `less_than_one` → `{ kind: 'less_than_one', trial }`; otherwise `{ kind: 'percent', value, trial }`. This is today's `:217-224`, moved. `roundToLedger` is applied once in the core, and `roundToLedger` of an already-rounded value is the same value, so the percentage is identical.
- `no_allowance` / `unknown` pass through.

`readAdminCreditsLeft` keeps its exact signature, its `AdminCreditsLeft` output (no count reaches it, AC-43), its log messages and fields, and its `outcome` values.

### Projection 2: the finance route

```ts
export interface AdminCreditPositionsPass {
  outcome: 'ok' | 'failed' | 'timeout';
  /** Keyed by the CALLER's id. On 'failed' / 'timeout' every id is { kind: 'unknown' }. */
  byUserId: Map<string, AdminCreditPosition>;
}
export async function readAdminCreditPositions(
  userIds: readonly string[],
  deps: AdminCreditPercentDeps,
  log: AdminCreditPercentLogger,
  options: { now?: Date; budgetMs?: number } = {}
): Promise<AdminCreditPositionsPass>
```

It maps ids through `resolveAccountId` as `readAdminCreditsLeft` does (the account seam; identity today), and runs the same budget and failure rules. Logs: warn `'Admin credit positions pass timed out; every row shows unknown'` / `'…failed; …'`, and info `'Admin credit positions pass served'` with `{ outcome, accounts, ms, position, no_allowance, unknown }` (counts only, never a figure, the `:285-286` rule).

### The shared budget runner

The race, the unref'd timer, `clearTimeout` in `finally` and the timeout / failed / ok branching (`:255-290`) move into one private `runWithinBudget(accountOf, compute, budgetMs, log, messages, project)`. Each reader passes its own messages (the list's strings verbatim) and its projection. The list's log lines are therefore byte-identical, which the existing tests assert.

### Proof the list is unchanged

- `adminCreditPercent.test.ts` (every kind, failure isolation, the budget, calls per chunk, and the owner-card parity block at `:352`), `app/api/admin/users/__tests__/route.creditsLeft.test.ts` and `route.test.ts` pass with `git diff --exit-code` on all three.
- New `adminCreditPositions.test.ts`: (a) **projection parity**: over a 12-account fixture (monthly, trial, no allowance, no plan row, unavailable snapshot, unreadable figure, below 1%, at 100%, over 100%, anchor on the 31st), `readAdminCreditPositions` then `toCreditsLeft`-equivalent maths equals `readAdminCreditsLeft` for every id; (b) positions carry `allowance` and `used` exactly (6 dp); (c) a trial sums from its anchor; (d) failure and timeout → every id `unknown`, one warning, no figure in any log call; (e) the same read calls as the list for the same ids.
- `KNOWN_NON_GATE_IMPORTERS` for `adminCreditPercent.ts` (`:375-379`): the imports stay `creditAllowanceForDisplay`, `getEntitlementService`, `resolveAccountId`, so the entry is untouched and `test:bos-entitlements` proves it.
- New code in the file keeps the guards' rules: no cut-off literal (60 / 30 / 20 / 10, or 0.1 to 0.6) in a comparison (credit bands guard), no `new Date(anchor)` or `Date.parse(period_start)` (period pin), no bare `2000` (credit-figure guard), no raw user id into `getSnapshots` (seam guard).

---

## Section 4, K-2 and K-4: pure functions

### `creditsSection.ts`

```ts
export interface FinanceLot {            // the narrow lot (SA-W14), built in the wiring
  id: string;
  accountId: string | null;
  source: 'admin_grant' | 'boost_purchase';
  creditsGranted: number;
  expiresAt: string | null;
  createdAt: string;
  actorAdminId: string | null;           // counted, never returned
  draws: ReadonlyArray<{ kind: 'reversal'; credits: number; createdAt: string }>;
}

export function buildCreditsSection(input: {
  accountIds: readonly string[];                          // plan rows, or [picked]
  groupOf: (accountId: string) => FinanceGroupKey | undefined;
  tierLabelOf: (key: FinanceGroupKey) => string | null;
  positions: ReadonlyMap<string, AdminCreditPosition> | null;  // null: the pass failed / timed out
  lots: readonly FinanceLot[] | null;                     // null: the lots read failed or hit its ceiling
  window: { start: Date; end: Date };
  now: Date;
  farOverAllowancePercent: number;                        // FINANCE_METRIC_PARAMS (SA-W10)
  displayCap: number;                                     // 200 (SA-W15)
}): CreditsSectionResult
```

Per account (integer micro-credits, `Math.round(x × 1e6)`, the `creditBands.ts` / `creditLots.ts` method):

| Figure | Rule |
|---|---|
| `allowance`, `used`, `trial` | From the position. Allowance ≤ 0, non-finite, or a product that is not a safe integer → the row is `unknown` (the `creditPercentLeft` refusal, `creditBands.ts:90-95`) |
| `% used` | `floor(usedMicro × 1000 / allowanceMicro)` tenths (SA-W17) |
| Over allowance | `usedMicro > allowanceMicro` (§8.4: "used > allowance") |
| Far over (K-2) | `usedMicro × 100 >= allowanceMicro × farOverAllowancePercent`. 150% → yes; 149.9% → no (AC-19) |
| Gifted outstanding | `extraCreditsAt(admin_grant lots of this account, now)`. `null` → that row's gifted figure is Unknown. No lot → 0 |

Section-level:

| Figure | Rule |
|---|---|
| `overAllowance`, `farOverAllowance` | Counts over **every** account in `accountIds` with a position (not only the displayed rows) |
| K-4 `giftedOutstanding` | `extraCreditsAt` over the `admin_grant` lots **with an account** (SA-W9), summed in micro-credits per account then across. Any account's `null` → K-4 Unknown (never a partial sum). Includes lots of an account that has no plan row, so K-4 can exceed the column's sum; the payload counts `accountsNotListed` and the page says so |
| Deleted accounts | Outstanding on lots with `accountId` NULL, as its own figure (SA-W9), never in K-4 |
| `inconsistentLots` | Accounts whose `extraCreditsAt` reported `hasInconsistentLot` (shown as a note, never hidden) |
| Window grants | Over `admin_grant` lots (deleted accounts included): `granted` = Σ `creditsGranted` with `createdAt ∈ [start, end)`; `takenBack` = Σ reversal draws with `createdAt ∈ [start, end)` on `admin_grant` lots; `grantingAdmins` = distinct `actorAdminId` over the grants in the window; `grants` = their count |
| Rows | Sorted: `position` rows by % used descending, then `no_allowance`, then `unknown`; ties by `accountId` ascending. Sliced to `displayCap`; `shown` and `accounts` reported |

`boost_purchase` lots are skipped by the `admin_grant` filter (slice 4 adds them; R-b already returns them).

**Tests** (`creditsSection.test.ts`): AC-8 (no lots → gifted 0 per row, K-4 0, exact); AC-19 (150% → far over; 149.9% → not; exactly 100% → not over, 100.0%); AC-17 (one `unknown` position → only that row Unknown; counts exclude it); AC-11 method (the gifted figure equals SQL check 5's arithmetic on a fixture: granted 100.5, reversal 40, expired lot ignored, lot with `expiresAt === now` expired, the `<=` rule); SA-W9 (a NULL-account lot is in the deleted figure and the window grants, never in K-4); window grants with a draw outside the window; a lot created after `now` ignored (the `extraCreditsAt` rule); inconsistent lot clamped and counted; trial position; sorting and the cap at 200 (201 accounts → 200 rows, counts over 201); the SA-W10 parameter at 120 changes the count; `lots === null` → gifted column, K-4 and window grants Unknown, the rest present; `positions === null` → section figures `null`. The fixture builds no tier literal (tiers from `config.tierOrder`).

### K-2 and K-4 in `financeRules.ts`

```ts
export type FinanceMetric = 'aiCostMonth' | 'aiCostPrevSpan' | 'foundingNoEndDate' | 'accountsFarOverAllowance';
// vocabulary
k2_far_over_allowance: { metrics: ['accountsFarOverAllowance'], flags: [] },
k4_gifted_outstanding: { metrics: [], flags: [] },
// rules (BD-11: any account over 150% = amber)
k2_far_over_allowance: [{ id: 'credits.farOver', priority: 1, colour: 'amber',
  description: 'Accounts at or over the far-over-allowance line',
  condition: { kind: 'atLeast', metric: 'accountsFarOverAllowance', value: 1 } }],
k4_gifted_outstanding: [],
// green: K-2 joins K-1 and K-3; K-4 never green (informational, §7.1)
export const FINANCE_METRIC_PARAMS = { farOverAllowancePercent: 150 } as const;
```

| Tile | Measurement | Result |
|---|---|---|
| K-2 | Section 4 figures present → `{ accountsFarOverAllowance: { value: n, exact: true } }` | n ≥ 1 → amber with the rule's description; 0 → green "All clear" |
| K-2 | Section 4 `unknown` (pass failed / timed out / ceiling, walk failed or capped) | `unavailable` "Unknown" (grey) |
| K-4 | Lots read ok | `neutral` (grey) with the value and the information headline "Admin-granted, not taken back, not expired"; never green |
| K-4 | Lots read failed or reached its ceiling | `unavailable` "Unknown" |

**Tests** (`financeRules.test.ts`): AC-19 through the tile (1 → amber, 0 → green); K-2 null → unavailable; K-4 value 0 → neutral with value (AC-8); K-4 null → unavailable; the vocabulary refuses `aiCostMonth` on K-2; `FINANCE_RULES` validates; an invalid `farOverAllowancePercent` (99, 1001, 1.5) → K-2 unavailable with the rules-invalid headline (SA-W10); changing the count rule's `value` to 2 in data makes one account green (AC-20 style).

---

## The builder and the route

### `financeHealth.ts`

New deps (both `Pick`-narrow; no writer reachable):

```ts
credits: AdminCreditPercentDeps;   // findPeriodAnchorsBatch, listTotalsForAccountsInRange (+ getSnapshots in tests)
lots: {
  allAccounts: () => Promise<RepoResult<FinanceLot[]>>;        // R-b, mapped narrow in the wiring
  forAccount: (accountId: string) => Promise<RepoResult<FinanceLot[]>>;  // listLotsWithDraws, mapped narrow
};
```

Flow, added to the 1a flow (`:168-206`):
1. Unchanged: with `accountId`, the plan check runs first (`:170-178`).
2. The `Promise.all` gains two entries:
   - **lots:** `settle(() => accountId !== null ? deps.lots.forAccount(accountId) : deps.lots.allAccounts())`;
   - **credit positions**, chained on the plan walk's own promise so it starts as soon as the account list exists and runs beside the ledger reads: walk failed or capped → `null` and **no pass call** (AC-37, SA-W11); otherwise `readAdminCreditPositions(ids, deps.credits, logger, { now })` with `ids` = the walked rows' `user_id`s, or `[accountId]`.
3. Section 4: `buildCreditsSection(...)` with `groupOf` from the 1a classification (`classified.groupByAccount`) and `tierLabelForGroup`.
4. Names for the displayed rows: one `settle(() => deps.findNames(ids))`, `ids` = displayed rows minus platform accounts (SA-WR-5 labelling, as Section 3). Ids come only from plan rows already read. A names failure → "name unavailable" on those rows; the figures still render.
5. Tiles K-2, K-4 via `colourFinanceTile`; the logger interface gains `info` (the pass logs one info line, counts only).
6. `FinanceHealthCounts` gains `creditAccounts`, `creditsPass` (`ok` / `failed` / `timeout` / `skipped`), `positions` (counts by kind), `lots` (rows or `null`), `creditRowsShown`. No credit figure.

### `financeHealthDeps.ts`

```ts
import { adminCreditPercentDeps } from '@/lib/business-os/credits/adminCreditPercentDeps';
import { businessOsCreditLotRepository, type BusinessOsCreditLotRepository, type BusinessOsCreditLotRow }
  from '@/lib/repositories/BusinessOsCreditLotRepository';

/** Read only (SA-Q10): the two lot reads, never a writer. */
const lotReads: Pick<BusinessOsCreditLotRepository, 'listLotsWithDrawsAllAccounts' | 'listLotsWithDraws'> =
  businessOsCreditLotRepository;

/** SA-W14: only what Section 4 needs crosses this line; admin-written text never does. */
export function toFinanceLot(row: BusinessOsCreditLotRow): FinanceLot { /* field by field, no spread */ }
```

`credits: adminCreditPercentDeps()` (SA-W13) and `lots: { allAccounts: () => map(lotReads.listLotsWithDrawsAllAccounts()), forAccount: (id) => map(lotReads.listLotsWithDraws(id)) }`. The mapping is field by field, never a spread, so a column added to the repository later cannot travel by accident. The header gains the lot paragraph (service role, read only, the narrow mapping).

### The route

`route.ts` changes only the info line (`:146-157`): `sections.credits`, `tiles.k2`, `tiles.k4`, and the new counts. `no-store`, the gate, Zod and the 404 / 500 paths are untouched.

---

## With a business picked (AC-42 re-run)

The tenant-isolation-guard read invariant (SEC-3). The only caller-supplied id is `accountId`, validated as a UUID, rejected if it is a platform account, and checked against the plan table first. Then:

| Read | All businesses | One business picked |
|---|---|---|
| Account list for Section 4 | The walked plan rows | `[accountId]` |
| Credit positions | `readAdminCreditPositions(walked ids)` → `getSnapshots(ids)`, `findPeriodAnchorsBatch(chunk)`, `listTotalsForAccountsInRange(chunk, …)` (`.in('user_id', …)` on named ids, never "all") | The same calls, each with exactly `[accountId]` |
| Lots | **R-b** `listLotsWithDrawsAllAccounts()` | `listLotsWithDraws(accountId)` (`.eq('user_id')` on both queries, `:428, :443`) |
| Names | Displayed rows' ids | `[accountId]` (unless platform, which cannot pass the route) |

**With `accountId` set, R-b gets zero calls**, as do `pagePlans`, R-a and R-c (1a). R-d stays the one documented platform-wide exception (no account, no amount). There is no write path, so the guard's write steps do not apply.

**Required test (SA-WR-3 shape, extended):** spies on `getSnapshots`, `findPeriodAnchorsBatch`, `listTotalsForAccountsInRange`, `lots.forAccount`, `lots.allAccounts`, `findNames`. With `accountId` set: every account-scoped call receives exactly `[accountId]` / `accountId`; `lots.allAccounts` has zero calls; the names lookup receives only `[accountId]`. Repeated through the route in `route.test.ts`.

---

## Failure matrix

Never a 500 for a failed read; never a partial sum (SA-Q8, §8.4, AGG-3).

| What fails | Section 4 | K-2 | K-4 | Gifted column / window grants |
|---|---|---|---|---|
| Nothing | `ok` | value, amber / green | value, grey | values |
| Plan walk failed (AC-37) | `unknown` | Unknown (grey) | value (lots are independent) | not shown (no table) |
| Plan walk capped (SA-W11) | `unknown` | Unknown | value | not shown |
| Pass failed / timed out / totals ceiling (AC-16) | `unknown` | Unknown | value (SA-W12) | not shown |
| One account unreadable (AC-17) | `ok`, that row Unknown | counts the others | — | — |
| Lots read failed or ceiling (AC-38) | `ok` | value | Unknown | Unknown; the rest of the section renders |
| Names failed | `ok`, "name unavailable" | — | — | — |

Section 4 is never `partial`: there is no "at least" for a per-account percentage.

---

## Multi-currency and units

- **Credits are not money.** Every Section 4 figure and K-2 / K-4 is in **credits**, the platform's own unit, stored at 6 decimal places (`numeric`, LS:83-86). No currency is attached, none is shown, and no Section 4 figure is ever added to a money figure (§8.4 "Currency: None").
- **No cost column is read.** The totals read selects `user_id, period_start, credits_total` only (ledger repository header `:39`). The lot columns hold credits; `credit_value_version` is read by the existing column list but dropped in the wiring (SA-W14) and never converted to money.
- No FX, no `exchange_rates`, no USD label in Section 4 (CUR-3). A source test asserts that `creditsSection.ts` and `CreditsSection.tsx` contain no `USD` and no `cost`.
- **Timezone:** allowance vs used is on each account's own credit period (TZ-3, the pass's period selector); "granted / taken back in the window" uses the UTC window bounds, labelled UTC; gifted outstanding is "now".

---

## The page

- **KPI strip** (`FinanceKpiStrip.tsx`): K-1, K-2, K-3, K-4, K-5, each with label, value, `STATUS_STYLES[status].label` text and the headline (AC-21). K-2's subtitle shows `farOverAllowancePercent` from the payload ("At or over 150% of this period's allowance"). K-4's value is formatted with `formatCredits`; a K-4 tile never shows a currency. Grid `sm:grid-cols-3 lg:grid-cols-5`.
- **Section 4** (`CreditsSection.tsx`), after Section 3 (S1-FR-5), in the 1a `FinanceSection` frame (heading, subtitle with source and "credit period per account; grants in the window, UTC", status, Retry):
  - summary line (S1-FR-22): accounts over allowance; accounts at or over the line (= K-2); total gifted outstanding (= K-4); credits granted and taken back in the window, and how many admins granted;
  - table (S1-FR-21): business (or "Platform account" / "name unavailable"), plan group (config label for tiers), allowance, used, % used (with "trial" marker), over allowance (Yes / No), gifted outstanding; native `<table>` with `<th scope>` (1a deviation 3); "Showing N of M" when capped;
  - notes: gifted credits are **not consumed yet** (until credit deduction slice 9, `creditLots.ts:18-20`), so "outstanding" is what remains available, not "unused" (§8.4); deleted accounts' credits not counted (SA-W9); inconsistent lots, when any;
  - per-row "Unknown" and "No allowance" in text.
- Copy strings in `financeCopy.ts`; no figure, threshold or tier literal in the page.

---

## Guard table, line by line

| Guard | 1b trips it? | Exact change |
|---|---|---|
| `enforcementPoints.test.ts` (non-gate importers) | **No.** `adminCreditPercent.ts` keeps its three imports (`:375-379`); `creditsSection.ts` and the finance changes import nothing from the module; `planGroups.ts` and `financeHealthDeps.ts` keep their symbols (`:462-482`) | None. `test:bos-entitlements` proves it. The finance source guard still pins "only `planGroups.ts` and the wiring import from the module" |
| `businessOsEntitlements.imports.guard.test.ts` (RC-15) | **No** under SA-W13: the finance wiring calls `adminCreditPercentDeps()`, never `businessOsAccountPlanRepository.findPeriodAnchorsBatch`, so the pin `['findEntitlementInputs', 'pagePlans']` (`:205-206, :422-434`) holds; `adminCreditPercentDeps.ts`'s own pin (`:397-408`) is unchanged | None. (If SA rejects SA-W13: `FINANCE_METHODS` gains `findPeriodAnchorsBatch`) |
| `BusinessOsCreditLedgerReadRepository.test.ts` caller list (`:1037-1085`) | **No.** No new file names the ledger read repository: `financeHealth.ts` imports the `AdminCreditPercentDeps` type from `adminCreditPercent.ts`, and the wiring calls `adminCreditPercentDeps()`. Both files are already listed | None |
| **G3 in `creditLots.test.ts`** (`:178-228`, exact list + non-vacuity `:264-272`) | **Yes** | Add under `// Finance & business health slice 1b (SA-Q10): …`: `lib/business-os/finance/financeHealthDeps.ts` (names `businessOsCreditLotRepository` / `BusinessOsCreditLotRepository` in the `Pick<…>`), `lib/business-os/finance/creditsSection.ts` (calls `extraCreditsAt`; its import path contains `credits/creditLots`), and the tests that name a symbol: `lib/business-os/finance/__tests__/creditsSection.test.ts`, `lib/business-os/finance/__tests__/financeHealth.test.ts` (mocks the lot repository for the SA-W14 test), `lib/business-os/finance/__tests__/finance.source.guard.test.ts` (the lot-call pin). Non-vacuity: both product entries really name a symbol. `financeHealth.ts`, `financeTypes.ts`, the route and the page name none (the builder takes `FinanceLot`, defined in `creditsSection.ts` with no lot symbol); the source guard asserts it |
| **`BusinessOsCreditLotRepository.test.ts`** | **Yes** (new method) | The six R-b tests above; the source guards (`:535-559`) stay green unedited: no write verb, exactly two `.rpc(`, never `*` |
| `creditFigures.fromConfig.guard.test.ts` | **No.** No new file names a builder in `BUILDERS` (`:168-174`). `adminCreditPercent.ts` is already in `SOURCES` (`:143`): the new code adds no bare credit figure; the budget stays `2 * 1000`, the ceiling `5_000` | None |
| `accountSeam.guard.test.ts` | **No.** The second reader maps ids through `resolveAccountId` and hands `getSnapshots` the resolved ids, the existing shape | None |
| `creditBands.guard.test.ts` | Scans `adminCreditPercent.ts` (`:30`, `:50-56`). Must stay green: no cut-off comparison is added there (the 150% comparison lives in `lib/business-os/finance/`, outside its scope) | None |
| `creditPeriod.test.ts` "no Date from an anchor" (`:159-174`) | Scans `adminCreditPercent.ts`. Must stay green: the refactor moves no anchor into `new Date` / `Date.parse` | None |
| `serviceColumn.guard.test.ts` (N-10) | **No.** It already scans the whole finance directory (`:87-89`); Section 4 reads no `service` column | None |
| `tierLiteral.forbidden.test.ts` and the finance tier-literal guard | Could trip; must not | Tier labels from config; fixtures from `config.tierOrder` |
| Admin authz surface guard | No (no new route or page) | None; re-run |
| `AdminSidebar.nav.test.ts`, Health suites | No | Re-run unchanged |
| Finance source guard (`finance.source.guard.test.ts`) | Extended | Non-vacuity adds `creditsSection.ts`; new pins: the wiring's lot calls are exactly `listLotsWithDrawsAllAccounts` and `listLotsWithDraws` (planted negative control with `recordLot`); no finance file names `recordLot`, `reverseLot`, `business_os_record_credit_lot`, `business_os_reverse_credit_lot`; `creditsSection.ts` / `CreditsSection.tsx` contain no `USD` / `cost` |
| L8, BD-26, `businessOwnedTables`, purge descriptors, `adminReadMethods`, billing / boost pins | No | None |

**No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate or `test:bos-entitlements`.

---

## AC mapping

T-numbers: T1 `BusinessOsCreditLotRepository.test.ts` (R-b block), T2 `adminCreditPositions.test.ts` (new), T3 `adminCreditPercent.test.ts` (**unchanged**, re-run), T4 users `route.creditsLeft.test.ts` + `route.test.ts` (**unchanged**, re-run), T5 `creditsSection.test.ts`, T6 `financeRules.test.ts`, T7 `financeHealth.test.ts`, T8 `finance.source.guard.test.ts`, T9 finance `route.test.ts`, T10 `financePage.render.test.tsx`, T11 `creditLots.test.ts` (G3). QA = a recorded manual step.

| AC | Test / check |
|---|---|
| AC-8 | T5 "no lots → gifted 0, K-4 0"; T6 "K-4 value 0 → neutral, grey"; T10 "K-4 shows 0, grey, with its text state" |
| AC-11 | T5 pins the arithmetic of check 5 (after the SA-W9 edit) and the trial sum; QA: SQL checks 4 and 5 vs Section 4 and K-4 |
| AC-16 | T7 "totals read fails / times out / reaches 5,000 → Section 4 unknown, K-2 unavailable, other sections ok"; T10 "Could not load this section" for Section 4 with the rest rendered |
| AC-17 | T2 "an unreadable figure → only that account unknown"; T5 "one unknown row, counts exclude it"; T10 "Unknown" in that row |
| AC-19 | T5 (150% far over; 149.9% not); T6 (1 → amber; 0 → green) |
| AC-21 (re-run) | T10: all five tiles show a `STATUS_STYLES` text state |
| AC-26 (1b) | T7 "picked business: Section 4, K-2, K-4 narrow to it; every credit and lot read gets exactly the id" |
| AC-27 (re-run) | T7 / T9 / T10: a failing credits or lots read → that part `unknown`, route 200, the others render |
| AC-28 (re-run) | T8 write-verb pins over the new files; T1 the lot repository still has exactly two `.rpc(`; `git diff --stat` shows no migration |
| AC-30 (re-run) | T9 "the info line carries counts and statuses only: no credit figure, no name"; T2 "the pass logs counts only"; T1 "R-b logs counts only"; no `console.` (T8) |
| AC-31 (re-run) | `test:bos-entitlements`, `test:authz-guard`, Health, nav, G3, lot repository, credit bands, period, credit-figure, seam, RC-15, ledger caller list: all pasted |
| AC-32 (1b) | QA manual: K-2, K-4 and Section 4 visible; cross-check with SQL checks 4 and 5; switch to one business |
| AC-37 (credits clause) | T7 "plan walk fails → Section 4 unknown, no pass call, K-4 still shows" |
| AC-38 | T7 "R-b fails / hits its ceiling → gifted column, window grants and K-4 Unknown; table and K-2 render"; T1 ceiling → error |
| AC-42 (re-run) | T7 SA-WR-3 test extended (above); T9 through the route |
| AC-43 | T3 and T4 pass with `git diff --exit-code` on the three files; T2 projection parity; review: `AdminCreditsLeft` unchanged |
| AC-44 (re-run) | Scoped `tsc` with canary (V-11) |

---

## Verification plan

The worktree already has the `node_modules` junction (RM). Never `git worktree remove`, never `git stash`.

Before SA code review, Dev runs these and pastes command, exit code and counts:

| # | Command | Evidence |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/business-os/credits/__tests__/adminCreditPositions.test.ts lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts --ci` | Suites / tests passed |
| V-2 | `npx jest lib/business-os/credits/__tests__/adminCreditPercent.test.ts app/api/admin/users --ci` **and** `git diff --exit-code -- lib/business-os/credits/__tests__/adminCreditPercent.test.ts app/api/admin/users` | Pass; exit 0 on the diff (unedited, AC-43) |
| V-3 | `npx jest lib/business-os/credits/__tests__/creditLots.test.ts lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/credits/__tests__/creditPeriod.test.ts lib/business-os/credits/__tests__/serviceColumn.guard.test.ts lib/business-os/credits/__tests__/adminCreditPosition.wireTypes.test.ts --ci` | Pass (G3 with the new entries; the others unedited) |
| V-4 | `npm run test:bos-entitlements` | Exit 0 (enforcementPoints, RC-15, seam, credit-figure, tier literal, ledger caller list) |
| V-5 | `npm run test:authz-guard` | Exit 0 |
| V-6 | `npx jest lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci` | Pass, no test file edited |
| V-7 | `npm run lint:hooks` | Exit 0 |
| V-8 | `npx eslint <every touched file>` | Clean |
| V-9 | `npm run typecheck:bos-llm` | 0 new errors (`lib/business-os/credits/` is in its scope) |
| V-10 | `npm run schema:check` if the worktree has database credentials; otherwise record that R-b names only the existing column lists, already live-read by slice 11c, and LS:85-86 | Output or the note |
| V-11 | **Scoped `tsc` with a canary (AC-44)** | Canary TS2322 line, then the clean run |
| V-12 | `git diff --stat` before reading the diff | No deletion-only file; no `supabase/migrations` path; `adminCreditPercent.ts` shows a modest diff, not a rewrite |

**V-11 procedure** (SA-WR-7): a tsconfig in the session scratchpad with an absolute `extends` to the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `include` = `types/**/*.d.ts` + every touched and new `.ts` / `.tsx` file. Plant `const __canary: number = 'x';` in `lib/business-os/finance/creditsSection.ts`; run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <it>`; it **must** report TS2322 at the canary, or the run is not evidence. Remove the canary, re-run, record every diagnostic: zero in touched files; pre-existing ones attributed (1a found three, outside the diff: `MemoryManager.ts` ×2, `CalibrationSessionRepository.ts`). Delete the scratch config.

---

## Logging

- New log lines: R-b `info` `{ method, lots, draws, durationMs }`; the positions pass `info` `{ outcome, accounts, ms, position, no_allowance, unknown }` and its two warns. Counts and timing only.
- The route's one accountability line (SA-Q11) gains statuses and counts; still no figure, name, email or admin id other than the caller's `adminId`.
- Never logged: a credit figure (allowance, used, gifted, granted), a lot's `reason`, an `actorAdminId`, an idempotency key, a business name.
- Errors as `{ err }`; repository failures keep CR11a-1 (message and SQLSTATE only).
- `console.*`: none (T8 pins it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The SA-Q7 refactor changes a Businesses list figure | Existing tests unedited and `git diff --exit-code` (V-2); projection parity test (T2); the read calls are asserted identical |
| R-2 | Route latency: the pass runs after the plan walk, under its own 2 s budget, against a route p95 target of 2 s | Chained on the walk's promise and run beside the ledger reads; today's volumes are 8 accounts and 6 totals rows; `durationMs` recorded in QA (L-13 / FU-5); SA-Q8's split trigger applies |
| R-3 | Admin text on lot rows reaches the payload or a log | Narrow mapping in the wiring (SA-W14), a planted-reason test, and the builder type cannot hold it |
| R-4 | R-b's 1,000 ceiling is reached once boost lots exist | Error, never partial (K-4 Unknown); slice 4 owns paging when boosts open |
| R-5 | K-4 and SQL check 5 disagree on deleted accounts | SA-W9, plus the BA edit to check 5 |
| R-6 | A new guard trips that §12.2 does not list (the 1a SA-W2 lesson) | Every guard that names `adminCreditPercent.ts` or a lot symbol was opened and is in the guard table; V-3 and V-4 run them all |
| R-7 | The G3 list goes stale (a listed file stops naming a symbol) | Non-vacuity check covers product entries; test entries listed only where they name a symbol |
| R-8 | The node_modules junction | Never `git worktree remove` or `git stash`; stop rather than `npm install` through it |

---

## Estimate

About **3.5 days**, inside the 3 to 4 day target.

| Day | Work |
|---|---|
| 1 | SA-Q7 refactor + `adminCreditPositions.test.ts` (V-2 green before anything else); R-b + tests; G3 entries |
| 2 | `creditsSection.ts` + tests; `financeRules.ts` K-2 / K-4 + tests; types |
| 3 | Builder, wiring (narrow mapping), route info line + tests; page (strip, Section 4, copy) + render tests |
| 3.5 | V-1 to V-12, the canary run, fixes; results pasted; requirement §0.1 updated |

---

## Task List

- ✅ 0. SA workplan review; rulings SA-W9 to SA-W17 approved as recommended; SA-WR-8 to SA-WR-13 applied in the code
- ✅ 1. Branch `feature/bos-finance-health-1b` confirmed (`git branch --show-current`); junction present
- ✅ 2. SA-Q7 refactor in `adminCreditPercent.ts`; `adminCreditPositions.test.ts` (parity through the public `creditPercentLeft`, SA-WR-12); V-2 green with the existing files unedited
- ✅ 3. `adminCreditPercentDeps.ts` header (SA-W13: two callers; SA-WR-11 tenant-isolation wording) and `adminCreditPercent.ts` TENANT ISOLATION paragraph (SA-WR-11)
- ✅ 4. R-b + header + tests (T1)
- ✅ 5. G3 `ALLOWED_LIST` entries (T11): four, not five (see Implementation Notes, D-1)
- ✅ 6. `financeTypes.ts`, `financeRules.ts` (K-2, K-4, `FINANCE_METRIC_PARAMS`, SA-WR-8 headline) + tests (T6)
- ✅ 7. `creditsSection.ts` + tests (T5), incl. SA-WR-9
- ✅ 8. `financeHealth.ts` + `financeHealthDeps.ts` (narrow lots, SA-W14) + tests (T7), incl. AC-42 1b, SA-WR-8 and SA-WR-10
- ✅ 9. `finance.source.guard.test.ts` extensions (T8), incl. the SA-WR-11 pins
- ✅ 10. Route info line + route tests (T9), incl. SA-WR-13
- ✅ 11. `FinanceKpiStrip.tsx`, `CreditsSection.tsx`, `FinanceView.tsx`, `financeCopy.ts` + render tests (T10)
- ✅ 12. Verification V-1 to V-12, outputs pasted in [Implementation Notes](#implementation-notes)
- ⬜ 13. Requirement §0.1 and Change History: NOT edited by Dev this round (the BA is editing the requirement in parallel; instruction from TL). Hand-over to SA code review, uncommitted ✅

---

## Implementation Notes

**Dev, 2026-10-10.** Built on `feature/bos-finance-health-1b`, uncommitted. No migration, no SQL function, no write, no LLM call, no audit entry.

### Files

| File | Action | Lines (now) | Diff |
|---|---|---|---|
| `lib/business-os/credits/adminCreditPercent.ts` | modify (SA-Q7) | 386 | +137 / -42 |
| `lib/business-os/credits/adminCreditPercentDeps.ts` | modify (header only) | 41 | +11 / -6 |
| `lib/business-os/credits/__tests__/adminCreditPositions.test.ts` | create | 248 | new |
| `lib/business-os/credits/__tests__/creditLots.test.ts` | modify (G3 list) | 305 | +11 / -0 |
| `lib/repositories/BusinessOsCreditLotRepository.ts` | modify (R-b + header) | 559 | +74 / -4 |
| `lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts` | modify (header sentence + R-b block) | 689 | +132 / -2 |
| `lib/business-os/finance/creditsSection.ts` | create | 277 | new |
| `lib/business-os/finance/__tests__/creditsSection.test.ts` | create | 303 | new |
| `lib/business-os/finance/financeTypes.ts` | modify | | +80 / -4 |
| `lib/business-os/finance/financeRules.ts` | modify | 235 | +84 / -7 |
| `lib/business-os/finance/financeHealth.ts` | modify | 552 | +170 / -9 |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | | +56 / -3 |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | modify | 809 | +361 / -2 (the two removed lines are the import and the `logger()` fake, both widened) |
| `lib/business-os/finance/__tests__/financeRules.test.ts` | modify | 231 | +107 / -1 |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | modify | 183 | +64 / -0 |
| `app/api/admin/business-os/finance/route.ts` | modify (info line) | 180 | +17 / -3 |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | 472 | +98 / -1 |
| `app/admin/finance/components/CreditsSection.tsx` | create | 165 | new |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | modify | 67 | +23 / -8 |
| `app/admin/finance/components/FinanceView.tsx` | modify | 101 | +5 / -3 |
| `app/admin/finance/financeCopy.ts` | modify | 158 | +45 / -1 |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify | 393 | +170 / -1 |

Not modified, as planned: `adminCreditPercent.test.ts`, `app/api/admin/users/**` and its tests, `app/admin/users/**` (incl. `CreditsLeftCell.tsx` and its render test), `creditLots.ts`, `enforcementPoints.test.ts`, `businessOsEntitlements.imports.guard.test.ts`, the ledger read repository and its test, `creditFigures.fromConfig.guard.test.ts`, `serviceColumn.guard.test.ts`, every Health file, `lib/repositories/index.ts`. `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` shows as modified in `git status`: that is the BA's parallel edit, not Dev's.

### SA required changes: where each landed

| Item | Where |
|---|---|
| **SA-WR-8** K-2 never green with an Unknown account | `financeRules.ts`: `colourFinanceTile` gains a per-tile `lowerBoundHeadline` option; `colourFarOverAllowanceTile` passes `exact: unknownAccounts === 0` and the headline `accountsNotReadHeadline(n)` ("1 account could not be read" / "N accounts could not be read"). `no_allowance` rows are not Unknown. Tests: `financeRules.test.ts` (1 unknown + 0 far → amber with that headline, not the ledger line; 1 unknown + 1 far → amber from the rule; all read + 0 → green) and the same three through the builder in `financeHealth.test.ts` |
| **SA-WR-9** NULL-account lot out of K-4 | `creditsSection.test.ts` "AC-11 + SA-WR-9": an independent `checkFive` helper types out edited check 5 (`user_id is not null`, `expires_at > now`, `greatest(0, granted - draws)`); K-4 equals it (60.5) and is not 60.5 + 30; the deleted lot is its own figure (30) and still in the window figures |
| **SA-WR-10** fake `getSnapshots`, real service in production | `financeHealth.test.ts` and the finance `route.test.ts` inject `credits.getSnapshots` (real resolutions of config plans, no figure typed). Wiring test: `Object.keys(financeHealthDeps().credits)` equals `adminCreditPercentDeps()`'s two keys and has no `getSnapshots` |
| **SA-WR-11** finance files clear of the builders and the service | Source-guard pin over every `lib/business-os/finance/` product file, comments included (planted control). TENANT ISOLATION paragraph of `adminCreditPercent.ts` and the `adminCreditPercentDeps.ts` header now name both callers and where their ids come from |
| **SA-WR-12** parity through the public formula | `adminCreditPositions.test.ts`: each list value is compared with `creditPercentLeft(position.used, position.allowance)` from `creditBands.ts`; non-vacuity asserts all four kind pairs occur |
| **SA-WR-13** route log line | `counts.creditAccounts` and `counts.creditsPass` (plus `creditPositions`, `creditLots`, `creditRowsShown`, `creditNamesFound`), `sections.credits`, `tiles.k2` / `k4`. Route test asserts them and that no credit figure is logged |
| **SA-W14** admin text never in payload or logs | Wiring `toFinanceLot` (field by field; source-guard pin: no spread, no `reason` / `idempotencyKey` / `sourceRef` / `creditValueVersion` in the mapper). `financeHealth.test.ts`: planted reason and keys on a lot AND a draw, through the real wiring with the repository faked, for all businesses and for a picked one: not in the result, any builder log, or any repository log; the admin id is not either |

### Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| D-1 | G3 gains **four** entries, not five: `creditsSection.test.ts` is not listed | It names none of the G3 symbols (it tests through `buildCreditsSection` and types check 5 out independently). Non-vacuity does not check test entries, so listing it would be a silent stale entry |
| D-2 | Gifted figures sit at section level (`FinanceCreditsSection.gifted`), not inside `figures`; `farOverAllowancePercent` likewise | So K-4 and the payload keep the gifted figures when the pass fails and `figures` is null (SA-W12) |
| D-3 | Count field names: `creditPositions`, `creditLots`, `creditNamesFound` (plan: `positions`, `lots`) | Prefixed so the one flat `counts` object in the route line cannot be confused with Section 3's |
| D-4 | `accountsNotListed` is null when the walk failed or was capped, and counts accounts with non-zero (or unreadable) gifted credits and no table row | "No plan row" cannot be known without the account list |
| D-5 | Requirement §0.1 / Change History not edited (task 13) | TL instruction: the BA edits the requirement in parallel |

No new pattern: the narrow mapping is SA-WR-1's, the `Pick<...>` is `adminCreditPositionDeps.ts`'s, the micro-credit arithmetic is `creditBands.ts`'s.

### Verification results (V-1 to V-12)

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/business-os/credits/__tests__/adminCreditPositions.test.ts lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts --ci` | 13 suites, **597 tests passed** |
| V-2 | `npx jest lib/business-os/credits/__tests__/adminCreditPercent.test.ts app/api/admin/users --ci` | 7 suites, **116 passed** |
| V-2 | `git diff --exit-code -- lib/business-os/credits/__tests__/adminCreditPercent.test.ts app/api/admin/users app/admin/users` | **exit 0** (byte-identical) |
| V-2b | `npx jest app/admin/users --ci` (the "Credits left" cell and the list's guards) | 10 suites, **293 passed** |
| V-3 | `npx jest .../creditLots.test.ts .../creditBands.guard.test.ts .../creditPeriod.test.ts .../serviceColumn.guard.test.ts .../adminCreditPosition.wireTypes.test.ts --ci` | 5 suites, **223 passed** (G3 with the new entries) |
| V-3b | Not-tripped guards run anyway: `BusinessOsCreditLedgerReadRepository.test.ts`, `businessOsEntitlements.imports.guard.test.ts` (RC-15), `enforcementPoints.test.ts`, `creditFigures.fromConfig.guard.test.ts`, `accountSeam.guard.test.ts`, `tierLiteral.forbidden.test.ts` | 6 suites, **294 passed**, none edited |
| V-4 | `npm run test:bos-entitlements` | **exit 0**, 228 suites, 6,074 tests |
| V-5 | `npm run test:authz-guard` | **exit 0**, 2 suites, 203 tests |
| V-6 | `npx jest lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci` | 6 suites, **274 passed**, no file edited |
| V-7 | `npm run lint:hooks` | **exit 0** |
| V-8 | `npx eslint <the 22 touched .ts/.tsx files>` | **exit 0, clean** (one unused-arg warning in the builder test fixed) |
| V-9 | `npm run typecheck:bos-llm` | **passed**: 486 files in scope, 28 errors, **0 new** (one baseline entry reported as fixed, outside this diff) |
| V-10 | `npm run schema:check` | Not run (no database credentials in the worktree). R-b names only the existing `CREDIT_LOT_COLUMNS` / `CREDIT_LOT_DRAW_COLUMNS`, already live-read by slice 11c (LS:85-86); the repository test pins both lists to the migration's columns |
| V-11 | Scoped `tsc`: scratch config OUTSIDE the worktree (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `include` = `types/**/*.d.ts`, `next-env.d.ts` and the 22 touched / new files) | Canary `const __canary: number = 'x';` in `creditsSection.ts` → `creditsSection.ts(279,7): error TS2322: Type 'string' is not assignable to type 'number'.` (exit 2). Canary removed → **0 errors, exit 0**. No pre-existing diagnostic surfaced in this scope. Scratch config deleted |
| V-12 | `git diff --stat` | 19 tracked files, +1,659 / -103; 5 new files. **No deletion-only file**; no `supabase/migrations` path; `adminCreditPercent.ts` +137 / -42 (the reader body moved into the shared runner, not a rewrite) |

**`console.*`:** 0 calls in every touched file (the one regex match is the finance source guard's own `/\bconsole\./` pin). Nothing to flag or convert.

**Not done / owed:** requirement §0.1 and Change History (BA, D-5); QA manual check AC-32 (K-2, K-4 and Section 4 against SQL checks 4 and 5, one business picked, `durationMs` with Section 4 on, SA-WR-13).

### Fix round 1

SA note 2 and QA note 2: the credit-positions pass must never turn the route into a 500.

- **Fix, finance side only.** In `financeHealth.ts` the pass call is wrapped in a `try` / `catch`. A throw is logged as `{ read: 'credit_positions', err }`, "Finance read failed". It becomes a `failed` pass with every id `unknown`. The result is the usual failure shape: Section 4 `unknown`, K-2 unavailable, `counts.creditsPass: 'failed'`. K-4 keeps its value, because it rests on the lots read only (D-2).
- **`resolveAccountId` not moved.** `adminCreditPercent.ts` is untouched this round. Moving the call inside the shared runner's `try` would need a `catch`. That would change the Businesses list's behaviour on a throw: it would return `failed` plus a warning instead of throwing. So the fix is on the finance side only, as the coordinator allowed.
- **Test.** `route.test.ts` adds "fix round 1: the positions pass THROWS → still 200…". It asserts:
  - a 200 response;
  - Section 4 `unknown` and K-2 `unavailable`;
  - K-4 still showing its value;
  - Sections 1 and 3 `ok`;
  - the `credit_positions` error line, and no route-level 500 line;
  - in the info line, `creditsPass: 'failed'`.
- **Negative control.** With the `catch` replaced by a rethrow, the test fails (1 failed of 31). Restoring the `catch` makes it pass.
- **Results:**

  | Check | Result |
  |---|---|
  | Finance suites (V-1 set) | 13 suites, 598 tests passed |
  | Businesses list (`adminCreditPercent.test`, `app/api/admin/users`, `app/admin/users`) | 17 suites, 409 passed |
  | `git diff --exit-code` on the list's tests | exit 0 |
  | `test:bos-entitlements` | exit 0 (6,074 tests) |
  | `test:authz-guard` | exit 0 (203 tests) |
  | `lint:hooks` | exit 0 |
  | ESLint on the touched files | clean |
  | Scoped `tsc`, config outside the worktree | canary caught at `financeHealth.ts(557,7)` TS2322; with the canary removed, 0 errors; config deleted |
- **Left for the user:** the `metricParams?: unknown` test hook, and a literal zero allowance shown as "Unknown".

---

## SA Workplan Review

**Reviewed by SA — 2026-10-10**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed to implementation, applying SA-WR-8 to SA-WR-13 as you build. No re-review of the workplan is needed; SA checks these at code review. BA applies the requirement edits E-5 to E-7 below.

**How it was checked.** Against `5a6fff13`, opening the cited files rather than trusting the citations. Confirmed:
- `adminCreditPercent.ts:57-87, 117-231, 237-291` (the `computeByAccount` tail at `:217-224`, the ceiling at `:193-194`, and the budget race with the unref'd timer);
- `adminCreditPercentDeps.ts:30-36`, which calls exactly `findPeriodAnchorsBatch` and `listTotalsForAccountsInRange`;
- the lot repository header `:29-45`, the column lists and `ROWS_CEILING` 1,000 at `:150-159`, CR11a-1 `fail` at `:297-308`, and `listLotsWithDraws` at `:419-460` (both queries use `.eq('user_id')`; `>=` → `too_many_lots` / `too_many_draws`);
- `extraCreditsAt` at `creditLots.ts:130-155`, whose input type is structural, so the narrow `FinanceLot` satisfies it;
- G3 at `creditLots.test.ts:178-293`, which is a text match with comments included, plus the non-vacuity check;
- RC-15's `FINANCE_WIRING` regex, which counts only `businessOsAccountPlanRepository.<m>(` in the finance wiring;
- the ledger caller list at `:1071`;
- the credit-figure guard's `BUILDERS` (`\bname\b` over code);
- the account-seam scan, which needs an `EntitlementService` import plus a `.getSnapshots(` call in the same file;
- `jest.config.js:14` maps `server-only`;
- the users-route tests mock `adminCreditPercent` by factory, and that route imports only `readAdminCreditsLeft`.

The workplan matches the code wherever it was checked.

### Rulings SA-W9 to SA-W17

| # | Ruling |
|---|---|
| **SA-W9** | **Approved.** K-4 and the gifted column exclude lots whose `user_id` is NULL. Those lots are shown as a separate "deleted accounts, not counted" figure, and the window figures still include them. **BA edit E-5** gives the exact text. |
| **SA-W10** | **Approved.** `FINANCE_METRIC_PARAMS = { farOverAllowancePercent: 150 }` lives beside the rules. It must be an integer from 100 to 1000, validated when used: an invalid value makes K-2 `unavailable` with the rules-invalid headline, logged at `error`. The payload carries the value. There is no new condition kind. |
| **SA-W11** | **Approved.** If the plan walk is capped, Section 4 is `unknown` and K-2 is `unavailable`, and the positions pass is **not called**. K-4 still renders. AC-37's wording is extended by **E-7**. |
| **SA-W12** | **Approved as the failure matrix.** K-4 still shows its value when the totals pass fails: the tile depends only on the lots read, and AC-16's "whole section Unknown" refers to the section, not to the tile. |
| **SA-W13** | **Approved, verified.** The finance wiring calls `adminCreditPercentDeps()`, so it names neither of the pass's repository methods. Effect on the guards: the RC-15 pin stays `['findEntitlementInputs', 'pagePlans']`; `adminCreditPercentDeps.ts`'s own pin is unchanged; the ledger caller list is not tripped (the wiring and builder are already listed, and `creditsSection.ts` must not name the ledger repository); `enforcementPoints` is not tripped (`adminCreditPercent.ts` keeps its three imports, and the finance files gain none from the module); N-10 is not tripped (no `service` column is read). See SA-WR-11 for the two side effects. |
| **SA-W14** | **Approved.** The wiring maps each lot field by field to `FinanceLot`, never with a spread. `reason`, `idempotencyKey`, `sourceRef`, `creditValueVersion` and the draws' admin fields never reach the builder, the payload or a log. `actorAdminId` is used only for a distinct count. A planted-reason test pins this. |
| **SA-W15** | **Approved.** At most 200 rows are displayed, with "Showing 200 of N". The counts, K-2 and K-4 always cover every account. |
| **SA-W16** | **Approved.** Section 4 makes its own names call, with ids taken only from plan rows already read. |
| **SA-W17** | **Approved.** "% used" is shown in tenths, rounded down, with "<0.1%" for a small non-zero figure. The comparisons (over allowance, at or over the far line) use integer micro-credits, never the displayed value. |

**Also confirmed:**
- **R-b** meets SA-Q10. It is a named, no-argument, all-accounts read with the existing column lists. It errors at its ceiling (`>=`) and never returns a partial list. It is read-only, and the source guards stay unedited.
- **SA-Q7.** One core feeds two projections, and `AdminCreditsLeft` is untouched. `roundToLedger` is idempotent, so the list's figures are identical. Running `git diff --exit-code` on `adminCreditPercent.test.ts` and `app/api/admin/users` is the right proof (V-2).
- **AC-42 re-run.** With a business picked, every read is scoped to it: the positions pass gets `[accountId]` for `getSnapshots`, the anchors and the totals; the lot read is `listLotsWithDraws(accountId)`; the names call gets `[accountId]`. R-b gets zero calls, and so do `pagePlans`, R-a and R-c. R-d remains the one documented exception.
- **Guard table:** correct line by line.
- **AC mapping:** every 1b AC and every 1b re-run is mapped (8, 11, 16, 17, 19, 21, 26, 27, 28, 30, 31, 32, 37, 38, 42, 43, 44).
- **Canary:** the scoped `tsc` canary procedure is as SA-WR-7 set it.
- **Estimate:** 3.5 days, accepted. If day 3 slips, report it at the end of day 3 rather than cut tests.

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-8 (Medium). K-2 must not be green when some account is Unknown.** AC-17 lets a single account be Unknown, and the counts then exclude it. In that case "0 far over" is a lower bound, so K-2 must not show green "All clear". This would break §7.1's "green only when the pass was complete".
   - **Required:** K-2's measurement is `exact: false` whenever any listed account's position is `unknown`. The `atLeast 1` rule still fires on a count of 1 or more, because a lower bound proves it.
   - With no match and the figure inexact, the tile is **amber**. Its headline is K-2-specific, for example "N accounts could not be read", passed to `colourFinanceTile` as a per-tile option. It is never the ledger's "Total is a minimum; not all charges counted".
   - `no_allowance` rows are not Unknown and do not make the figure inexact.
   - Tests: one Unknown plus zero far over → amber with that headline; one Unknown plus one far over → amber from the rule; all readable plus zero → green.
   - Requirement edit **E-6**.
2. **SA-WR-9 (Medium). SA-W9 test.** Build an AC-11-style fixture in `creditsSection.test.ts` that includes one lot with `accountId: null`, and assert it is left out of K-4 exactly as edited check 5 leaves it out.
3. **SA-WR-10 (Low). Keep the finance tests off the real entitlement service.** Every finance test passes a fake `credits.getSnapshots`, so the real `getEntitlementService()` is never reached; this applies to `financeHealth.test.ts` and the finance `route.test.ts`. A wiring test asserts that `financeHealthDeps().credits` has exactly the two keys of `adminCreditPercentDeps()` and **no** `getSnapshots`, which proves production reads the real service.
4. **SA-WR-11 (Low). Keep the finance files clear of two guards.**
   - No finance file may contain `creditAllowanceForDisplay`, `ownerCreditUsage`, `describePlanOffer`, `describeInviteOffer` or `buildCustomerPlanView`, even in a comment. The credit-figure completeness test would otherwise demand a `SOURCES` entry.
   - No finance file may import `EntitlementService`; otherwise the account-seam scan applies.
   - Extend the finance source guard to pin both rules.
   - Update `adminCreditPercent.ts`'s **TENANT ISOLATION** paragraph (`:34-37`): ids now also come from the finance route's own plan walk or its validated, existence-checked picked id, and never from raw request input. Update the `adminCreditPercentDeps.ts` header the same way: two callers.
5. **SA-WR-12 (Low). Projection-parity test.** Do not re-type the percent formula. Compare `readAdminCreditsLeft` with the public `creditPercentLeft(position.used, position.allowance)` from `creditBands.ts`, so the test cannot mirror its own maths.
6. **SA-WR-13 (Low).** The route's info line includes `creditAccounts` and `creditsPass` (already planned). They make the pass's 1,000-account scale trigger (`adminCreditPercent.ts:39-40`) visible from the finance route too. QA records `durationMs` with Section 4 on.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-1b)

- **E-5 (SA-W9).**
  - In §13 check 5, change the `grants` CTE to the following. The comment contains no apostrophe and not the word "into", per the §13 paste rules.

    ```sql
    with grants as (
      -- Lots of deleted accounts (user_id NULL) are left out, as on the page (SA-W9).
      select l.id, l.credits_granted, l.expires_at
      from public.business_os_credit_lots l
      where l.source = 'admin_grant'
        and l.user_id is not null
    ),
    ```

  - In §7.1, append to the K-4 row's Metric cell: "Lots of deleted accounts (`user_id` NULL) are not counted; the page shows them as their own figure (SA-W9)."
- **E-6 (SA-WR-8).** In §7.1, replace the K-2 row's "Inexact figure" cell with: "When any listed account's figure is Unknown (AC-17), the count is a lower bound: the rule still fires at count >= 1; with no match the tile is amber 'N accounts could not be read', never green (AGG-3)". Replace its "Green-eligible" cell with: "Yes, when the pass was complete and no listed account is Unknown".
- **E-7 (SA-W11).** In AC-37, after "Section 1 `partial` with 'at least'", add: ", and the credits section `unknown` with K-2 grey (no positions pass is run; SA-W11); K-4 still renders". In S1-FR-24, after "or when the plan walk failed", add: "or reached its cap".

---

## SA Code Review

**Code Review by SA — 2026-10-10**
**Status:** ✅ **APPROVED. Code approved for QA.** I found no blocking issue. The two Low notes below are optional.

**How it was checked.** I read every changed file: 19 tracked files (+1,659 / −103) and 5 new ones.
- **Line endings.** `git ls-files --eol` gives `i/lf w/lf`, and the `--ignore-all-space` stat is unchanged. The CRLF warnings come from `core.autocrlf` only; no file has its line endings rewritten.
- **My own test runs (all green):**
  - finance lib, route and page; `adminCreditPercent`; `adminCreditPositions`; `app/api/admin/users`; G3 `creditLots`; the lot repository: 21 suites, 753 tests;
  - `npm run test:bos-entitlements`: 228 suites, 6,074 tests;
  - `npm run test:authz-guard`: 203 tests.

### Required changes from the workplan review

| Item | Verdict |
|---|---|
| **SA-WR-8** | ✅ `colourFarOverAllowanceTile` passes `exact: unknownAccounts === 0` and a K-2-specific `lowerBoundHeadline` ("N accounts could not be read"). `no_allowance` rows are not counted as Unknown. Allowance ≤ 0 or a non-safe figure counts as Unknown. All three cases are tested, both in the rules tests and through the builder. |
| **SA-WR-9** | ✅ `creditsSection.test.ts` has an independent `checkFive` with `user_id is not null`. K-4 = 60.5, not 60.5 + 30. The deleted lot is its own figure and is still in the window figures. |
| **SA-WR-10** | ✅ Both finance test files fake `getSnapshots`. The wiring test asserts `credits` has exactly `adminCreditPercentDeps()`'s two keys and no `getSnapshots`. |
| **SA-WR-11** | ✅ The source guard pins the builder names and `EntitlementService` over every finance product file, comments included, with a planted control. The TENANT ISOLATION paragraphs of `adminCreditPercent.ts:41-48` and `adminCreditPercentDeps.ts` now name both callers. |
| **SA-WR-12** | ✅ The parity test uses the public `creditPercentLeft`, with a non-vacuity check over all four kinds. |
| **SA-WR-13** | ✅ The route line carries `creditAccounts`, `creditsPass`, `creditPositions`, `creditLots` and `creditRowsShown`, plus `sections.credits` and `tiles.k2` / `k4`. It holds no figure. |
| **SA-W14** | ✅ `toFinanceLot` copies field by field with no spread, and the source guard pins this. A planted reason or key on a lot and on a draw stays out of the payload, the builder logs and the repository logs, both for all businesses and for a picked one. |

### Other checks

- **SA-Q7 refactor.** `git diff --exit-code` on `adminCreditPercent.test.ts`, `app/api/admin/users` and `app/admin/users` exits **0**. I read the diff itself:
  - the core now stores `{ position, allowance, used: roundToLedger(used), trial }`;
  - `toCreditsLeft` calls `creditPercentLeft(used, allowance)`, which is the old line 217 moved, and `roundToLedger` is idempotent;
  - `no_allowance` / `unknown` pass through;
  - the list's three log messages are verbatim, and its counts keys are unchanged.

  Behaviour is identical, and `AdminCreditsLeft` is untouched.
- **R-b** (`BusinessOsCreditLotRepository.ts:483-530`):
  - it has no argument and no `.eq`;
  - a lots read or any draws chunk that reaches 1,000 rows (`>=`) fails with `too_many_lots` / `too_many_draws`, never a partial list; this is tested;
  - the info line carries counts only, and errors use CR11a-1 `fail`;
  - the source guards are unedited and still green.
- **AC-42.** With a business picked, `getSnapshots`, the anchors and the totals each get exactly `[A]`, and `lots.forAccount(A)` is called once. `lots.allAccounts` and `pagePlans` get zero calls, and names get only `[A]`. If the business has no plan row, the route takes the 404 path and no credit or lot read runs.

### Deviations

| # | Ruling |
|---|---|
| D-1 | **Approved.** `creditsSection.test.ts` names no G3 symbol. Listing it would leave a stale entry that the non-vacuity check cannot catch. |
| D-2 | **Approved.** It is required for SA-W12: K-4 and the gifted figures survive `figures: null`. |
| D-3 | **Approved.** The `credit…` prefix keeps the counts apart in the flat `counts` object. |
| D-4 | **Approved.** "No plan row" cannot be known without the account list, so null is honest. |
| D-5 | Noted. The BA owns the requirement edits. |

### Code Review Comments

1. `lib/business-os/finance/financeHealth.ts` (deps): `metricParams?: unknown` is a test seam on the production type, the same pattern as `rules?`. **Optional:** type it `typeof FINANCE_METRIC_PARAMS | unknown` with a comment. Priority: **Low**.
2. `financeHealth.ts`, `positionsPromise`: this relies on `readAdminCreditPositions` never throwing, which is its documented contract. If it ever threw synchronously (for example in `resolveAccountId`), `Promise.all` would reject and the route would return a 500 instead of Section 4 `unknown`. **Optional:** wrap it in `settle`-style handling. Priority: **Low**.

### Code Approved for QA: **Yes**

QA still owes AC-32: K-2, K-4 and Section 4 against SQL checks 4 and edited check 5, one business picked, and `durationMs` with Section 4 on.

---

## QA Report

**QA — 2026-10-10**
**Test mode:** full (1b ACs and the 1b re-runs)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 4 and 5 (QA does not run SQL against production). Steps for the user are L-14 to L-22 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every 1b AC that Jest can test passes. AC-11 and AC-32 (1b) wait on the user's manual check. Two Low notes, neither blocking.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-finance-health-1b`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/business-os/credits/__tests__/adminCreditPositions.test.ts lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts --ci` (T1, T2, T5 to T10) | exit 0; **13 suites, 597 passed** |
| Q-2 | `npx jest lib/business-os/credits/__tests__/adminCreditPercent.test.ts app/api/admin/users app/admin/users --ci` (T3, T4 and the Businesses list UI) | exit 0; **17 suites, 409 passed** |
| Q-2b | `git diff --exit-code -- lib/business-os/credits/__tests__/adminCreditPercent.test.ts app/api/admin/users app/admin/users` | **exit 0**: byte-identical; `git status` shows nothing under those paths (AC-43) |
| Q-3 | `npx jest` creditLots (G3), creditBands.guard, creditPeriod, serviceColumn.guard, adminCreditPosition.wireTypes, the ledger read repository test, RC-15 imports guard, enforcementPoints | exit 0; **8 suites, 457 passed** |
| Q-4 | `npm run test:bos-entitlements` | exit 0; **228 suites, 6,074 passed** |
| Q-5 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-6 | `npx jest lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci` | exit 0; **6 suites, 274 passed**; no Health or nav file in the diff |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | Scoped `tsc`. Config: `tsconfig.qa-1b.json` in the session scratchpad (**outside the worktree**), with an absolute `extends` to the worktree `tsconfig.json`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 22 changed and new `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `creditsSection.ts`): exit 2, `lib/business-os/finance/creditsSection.ts(278,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Canary removed** (file restored from a byte copy; `cmp` identical): exit 0, **0 diagnostics** |
| Q-9 | `git diff --stat`, `git status --short` | 19 tracked files (+1,661 / −103), 5 new; no deletion-only file; no migration path |

### Test Coverage (1b ACs and 1b re-runs)

| AC | Result | Evidence |
|---|---|---|
| AC-8 | ✅ Pass | T5 "AC-8: no lots → every row 0, K-4 exactly 0 …"; T6 "a read value, 0 included → neutral (grey) …"; T10 "AC-8: no gifted credits → K-4 shows 0, grey, with its text state" |
| AC-11 | ⬜ NOT-TESTED (live) / ✅ method | T5 "AC-11 + SA-WR-9: K-4 equals check 5 …" (an independent `checkFive` helper, with the `user_id is not null` edit); T2 "a trial sums every period from its anchor". Live match: L-17, L-18 |
| AC-16 | ✅ Pass | T7 `it.each` "AC-16: the totals read fails / reaches its ceiling → Section 4 unknown, K-2 unavailable, K-4 still shows"; T2 "a hung pass times out → every id unknown" (the builder treats any outcome other than `ok` as no positions); T10 "AC-16: Section 4 could not load → its own Retry …" |
| AC-17 | ✅ Pass | T5 "AC-17: one unknown account → only that row unknown; the counts exclude it"; T5 "an account missing from the pass, or a figure that cannot be compared exactly, is unknown"; T10 table renders "Unknown" in words |
| AC-19 | ✅ Pass | T5 "AC-19: 150% is far over; 149.9% is not; exactly 100% is not over"; T6 "AC-19 through the tile: 1 → amber; 0 … → green" |
| AC-21 (re-run) | ✅ Pass | T10 "AC-21: all five tiles show a text state" |
| AC-26 (1b) | ✅ Pass | T7 "positions pass, lots and names narrow to [A]; R-b gets ZERO calls" |
| AC-27 (re-run) | ✅ Pass | T9 "AC-27 (slice 1b): a failed credit pass and a failed lot read → 200, credits unknown, K-4 unavailable, the rest renders"; T7 / T10 |
| AC-28 (re-run) | ✅ Pass | T8 "names no lot writer and no lot RPC" over every finance file; the lot repository source guards are unedited and green; Q-9 no migration |
| AC-30 (re-run) | ✅ Pass | T9 "AC-30 / SA-WR-13 (slice 1b): … no credit figure"; T2 "logs one info line with counts by kind and timing only"; T1 "success logs counts only"; T8 no `console` |
| AC-31 (re-run) | ✅ Pass | Q-3 to Q-6 |
| AC-32 (1b) | ⬜ NOT-TESTED | Manual L-14 to L-22 below |
| AC-37 (credits clause) | ✅ Pass | T7 "AC-37 / SA-W11: the plan walk fails → Section 4 unknown, NO pass call, K-4 still shows"; "SA-W11: the plan walk capped at 20,000 → …" |
| AC-38 | ✅ Pass | T7 "AC-38: the lots read fails → gifted column, window and K-4 unknown; the table and K-2 render"; T1 ceiling → `too_many_lots` / `too_many_draws`; T10 "AC-38" |
| AC-42 (re-run) | ✅ Pass | T7 1b AC-42 block (pass, lots and names narrow to `[A]`, R-b zero calls; picked id with no plan row → no credit or lot read); T9 "AC-42 (slice 1b) through the route" and "all businesses: the named all-accounts lot read, never the one-account read" |
| AC-43 | ✅ Pass | Q-2 + Q-2b (byte-identical tests, 409 passing); T2 "projection parity … the public creditPercentLeft (SA-WR-12)" and "makes exactly the same read calls as the list" |
| AC-44 (re-run) | ✅ Pass | Q-8 |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| K-2 when an account is Unknown | Confirmed, never green | `financeRules.ts` `colourFarOverAllowanceTile`: `exact: unknownAccounts === 0`, so no match + inexact → amber "N accounts could not be read". `no_allowance` does not count as Unknown. T6 and T7 SA-WR-8 (1 unknown + 0 far → amber; 1 unknown + 1 far → amber from the rule; all read + 0 → green) |
| NULL-`user_id` lot out of K-4 | Confirmed | `creditsSection.ts:170-172` puts it on its own `deleted` list; `:191-192` gives it its own figure; it stays in `windowGrants` (`:207`). T5 SA-WR-9 (K-4 = 60.5, not 60.5 + 30); T7 "SA-W9" |
| R-b at its 1,000 ceiling | Confirmed, error, never partial | `BusinessOsCreditLotRepository.ts:496` `>=` → `too_many_lots`; `:515` → `too_many_draws`; `data: null` → K-4 / gifted Unknown. T1 |
| Plan walk capped → Section 4 unknown | Confirmed | `financeHealth.ts:254-256`: a capped or failed walk → `null`, and no pass is called; `:400` status `unknown`. T7 SA-W11 |
| Totals read fails, K-4 still shows (D-2) | Confirmed | `buildCreditsSection` returns `gifted` even when `figures` is null (`creditsSection.ts:215-217`); K-4 depends only on lots (`financeHealth.ts:460-463`). T7 AC-16, T10 AC-16 |
| A business picked → account-scoped reads only | Confirmed | `financeHealth.ts` lots: `forAccount(accountId)` vs `allAccounts()`; the pass gets the walk ids or `[accountId]`. T7 / T9 spies: R-b zero calls |
| Admin reason text never in payload or logs | Confirmed | `financeHealthDeps.ts:60-71` `toFinanceLot`, field by field, no `reason` / key / `sourceRef`; T8 "never with a spread"; T7 planted reason on a lot and a draw, for all businesses and for one picked, absent from the result, builder logs and repository logs |
| 200-row table cap | Confirmed | `creditsSection.ts:273` `slice(0, displayCap)`; counts use every account (`:268`); `FINANCE_LIMITS.CREDIT_ROWS_SHOWN` 200. T5 "201 accounts → 200 rows; every count covers all 201"; T10 "Showing N of M" |
| % used in tenths, rounded down | Confirmed | `creditsSection.ts:257` `Math.floor(usedMicro × 1000 / allowanceMicro)`; `CreditsSection.tsx:71-75` "<0.1%" for a non-zero figure under a tenth. Comparisons use micro-credits, not the displayed value. T5 SA-W17 |
| Zero allowance | Confirmed (see note 1) | `creditsSection.ts:90` allowance ≤ 0 → row `unknown` (no division). A withheld or absent allowance is `no_allowance` upstream (`adminCreditPercent.ts:187-189`). T5 `position(0, 5)` → unknown |
| Granted minus taken back below 0 | Confirmed | `creditLots.ts:147-148` clamps the lot to 0 and sets `hasInconsistentLot`; counted in `inconsistentAccounts` and shown as a note. T5 "an inconsistent lot is clamped to 0 and counted" |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found in code. The positions pass is chained on the plan walk and runs beside the ledger reads under its own 2 s budget. `durationMs` with Section 4 on is owed from the live run (L-22).

#### Edge Cases (nice to fix, Low)
1. **A literal zero allowance shows as "Unknown", not "No allowance"** (`lib/business-os/finance/creditsSection.ts:90`). It also counts toward K-2's "N accounts could not be read" (amber). This matches the Businesses list, where `creditPercentLeft(used, 0)` is unknown too. It only happens if a plan resolves an allowance of exactly 0 rather than a withheld one. Low; a product call, not a defect.
2. **The positions pass's id mapping runs outside its `try`** (`lib/business-os/credits/adminCreditPercent.ts:295`, `resolveAccountId`). If that ever threw, `positionsPromise` (`financeHealth.ts:254`) is not `settle`d, so the route would return 500 instead of Section 4 `unknown`. Today `resolveAccountId` is the identity and cannot throw, so this is not reachable. Low.

### Manual live steps (continuing from 1a's L-13): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for §13 checks 4 and 5 (read-only; QA did not run them).

| # | Step | Expected |
|---|---|---|
| L-14 | Open `/admin/finance` (This month, All businesses) | Five tiles in order: K-1, K-2, K-3, K-4, K-5, each with a text state. Section 4 "Credits" follows the AI cost section |
| L-15 | K-2 | Its subtitle shows "150%" from the payload. Amber if at least one account is at or over 150% of its period allowance; green "All clear" only if none is and every account was read; amber "N accounts could not be read" if any row in the table says Unknown and none is far over |
| L-16 | K-4 | Grey, with a credits figure (never a currency) and the line "Admin-granted, not taken back, not expired"; never green |
| L-17 | **SQL check 5** vs K-4 (AC-11) | K-4 = `outstanding_not_expired`. The section's window line for This month: credits granted / taken back in the window (check 5 does not split by window; compare against the lot dates by eye if a grant happened this month). If a deleted account had a grant, the page shows it as its own "deleted accounts, not counted" note |
| L-18 | **SQL check 4** vs the table's "Used" column (AC-11) | For each account whose latest `period_start` is its **current** period, Used = `credits_total`. An older `period_start` → the page shows 0 used. A trial account sums every row since its trial anchor, so it can exceed the single row shown. Over allowance = Yes only when Used > Allowance |
| L-19 | Table details | Rows sorted by % used, highest first, then "No allowance", then "Unknown". % used in tenths, rounded down ("<0.1%" for a tiny non-zero figure); trial rows marked. Summary line: over allowance count; at-or-over-150% count = K-2's figure; total gifted = K-4. No "Showing N of M" today (8 accounts, under 200) |
| L-20 | Pick one business with the picker | URL gains `accountId` only. Section 4 shows one row for it; K-2 counts only that business (0 or 1); K-4 = that business's own outstanding gifted credits (re-run check 5 with `and l.user_id = '<id>'` added to the `grants` CTE to compare) |
| L-21 | Back to All businesses, then reload | The same five tiles and Section 4 figures return; the URL is unchanged |
| L-22 | Dev-server log | One "Admin read the Business OS finance page" line per load, now with `sections.credits`, `tiles.k2` / `k4`, `counts.creditAccounts`, `counts.creditsPass` (`ok`), `creditPositions`, `creditLots`, `creditRowsShown`, plus one "Admin credit positions pass served" and one "Credit lots of all accounts read" line (counts only, no credit figure, no name, no reason). **Record `durationMs`** for All businesses and for one business (target p95 under 2 s) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every 1b AC that Jest can test passes, and no bug is open.** AC-11 and AC-32 (1b) need the user's manual run (L-14 to L-22) before commit. The two Low notes do not block.

---

## Commit Info

_(RM to complete.)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-10 | Created (Dev) | Slice 1b workplan against `5a6fff13` on `feature/bos-finance-health-1b`: scope, the R-b spec, the SA-Q7 one-core-two-projections refactor with the Businesses list unchanged and its tests unedited, Section 4 / K-2 / K-4 as pure tested functions, the picked-business scoping (AC-42 re-run), the failure matrix, units, the guard table line by line, the AC mapping, the verification plan with the scoped `tsc` canary, risks and estimate. Raises SA-W9 to SA-W17. No code written. |
| 2026-10-10 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W9 to SA-W17 approved as recommended. SA-W13 verified against RC-15, the ledger caller list, `enforcementPoints` and N-10. Required changes: SA-WR-8 (K-2 never green when an account is Unknown), SA-WR-9 to SA-WR-13. Requirement edits E-5 (check 5 `user_id is not null`, K-4 row), E-6 (K-2 inexact) and E-7 (capped walk) are for BA. Recorded in requirement §0.3 (SA-WP-1b) and its Change History. |
| 2026-10-10 | Implemented (Dev) | Slice 1b built, uncommitted: SA-Q7 refactor, R-b, Section 4, K-2, K-4, page; SA-WR-8 to SA-WR-13 and the SA-W14 narrowing applied with tests. Verification V-1 to V-12 pasted in Implementation Notes. Deviations D-1 to D-5. |
| 2026-10-10 | SA code review: **APPROVED** | All 24 files read. SA-WR-8 to SA-WR-13 and SA-W14 verified in code. D-1 to D-4 approved. SA-Q7 refactor: the list's behaviour is identical, and `git diff --exit-code` on its tests exits 0. R-b errors at its 1,000-row ceiling, and AC-42 holds. SA re-ran 21 suites / 753 tests, `test:bos-entitlements` (6,074 tests) and `test:authz-guard` (203 tests), all green. Two optional Low notes. Code approved for QA. |
