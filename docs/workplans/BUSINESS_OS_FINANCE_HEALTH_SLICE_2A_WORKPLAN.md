# Workplan: Business OS Finance & Business Health — Slice 2a (Takings)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), slice **2a** (§0.1, §6.2 CUR-1 / CUR-2, §11A.0 to §11A.4, §11A.7 to §11A.10, §12, §13 checks 7 to 9, "SA Requirement Review — Slice 2").
**Live facts:** [BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md) (cited as **LC**).
**Builds on:** slice 1a (PR #284) and slice 1b (PR #290), both on `main`. [1a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md) · [1b workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md) · [1a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md) · [1b retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_RETROSPECTIVE.md)
**Layout standard:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md). The new block uses the shared parts; the page shell is **not** migrated (DF-4).
**SA rulings implemented:** SA-Q13 (scale 100, refunds by `amount`), SA-Q15 (keyset, page 1,000, ceiling 5,000, `reachedCeiling`), SA-Q16 (Stripe guards not tripped, run unchanged), SA-Q17 (one route, `durationMs`), SA-Q18 (shared parts through the alias), SA-Q19 (refunds by `created_at`), findings S2-F1, S2-F4, S2-F6, S2-F8, and the nine "Conditions for the 2a workplan". Still in force from slice 1: SA-W1 / AC-42 (narrow to a picked business), SA-WR-3 (spies at the repository boundary), SA-WR-4 (pure builders take their inputs as parameters), SA-WR-5 (platform accounts labelled), SA-WR-7 (scratch tsconfig, canary).
**Date:** 2026-10-11
**Branch:** `feature/bos-finance-health-2` (cut by RM from `origin/main` `a66b4c41`; confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`). `node_modules` is a junction to the main checkout: never `git worktree remove`, never `git stash`, never commit (RM commits after the user has seen the diff).
**Status:** Code Complete (uncommitted). SA workplan review APPROVED WITH CONDITIONS; SA-WR-14 to SA-WR-19 applied. Awaiting SA code review.

## Overview

Slice 2a adds **Section 2 block B, "Takings through the platform"**: what clients paid the businesses through AgentPilot, per currency. It shows gross, refunded and net (net of refunds only) per currency, refunds dated by `created_at`, recorded processor fees grouped by **fee currency** (never deducted), payment counts by processor, the number of businesses with takings, and a per-business table capped at 200 rows. It is **not our revenue** (BD-1), and test and real client payments are shown together and treated as real (BD-13).

It builds the **currency-grouping helper** (CUR-1, CUR-2, AC-13), deferred from slice 1 (DF-1). It adds four named reads to `BusinessOsFinanceReadRepository`: **R-e, R-e′, R-f, R-f′**. It extends the one existing route and the one builder, adds a new block, and changes no KPI tile.

There is no migration, no SQL function, no write, no LLM call, no audit entry and no new query parameter.

Ten points need an SA ruling before code (§ [Questions for SA](#questions-for-sa-before-code), SA-W18 to SA-W27). Three are gaps between the requirement and the code or the SQL checks (SA-W18, SA-W19, SA-W20). None reopens a business decision.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [The reads: R-e, R-e′, R-f, R-f′](#the-reads-r-e-r-e-r-f-r-f)
- [Money maths: the currency helper](#money-maths-the-currency-helper)
- [The takings builder](#the-takings-builder)
- [The builder, the wiring and the route](#the-builder-the-wiring-and-the-route)
- [With a business picked (AC-65, AC-42 re-run)](#with-a-business-picked-ac-65-ac-42-re-run)
- [Failure matrix](#failure-matrix)
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

Every file below was opened at `a66b4c41` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| The finance repository header: why a separate repository, service role, account scope by signature, "every read here filters `livemode = true`" (must be narrowed to layer A in 2a) | `lib/repositories/BusinessOsFinanceReadRepository.ts:7-16`, `:18-23`, `:25-33`, `:35-38` |
| Read limits constant, UUID pattern, the guard error, `fail` (warn for a guard refusal, error otherwise) | `BusinessOsFinanceReadRepository.ts:68-72`, `:74`, `:76-81`, `:105-112` |
| R-c: keyset on `user_id`, `.gt`, `.order`, `.limit(size)`, short page stops, info line with counts and timing | `BusinessOsFinanceReadRepository.ts:123-164` (`:141-157` loop, `:159` info) |
| R-c′: the account-scoped shape (UUID check first, `.eq('user_id')`) | `BusinessOsFinanceReadRepository.ts:170-190` |
| The repository test: recording client with a fixed builder method list (`select, eq, not, gt, order, limit, maybeSingle`) | `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts:45-71` (`:54`) |
| `FINANCE_READ_LIMITS` equality pin (must gain two keys) | `BusinessOsFinanceReadRepository.test.ts:92` |
| No-write pin, no aggregate select, no writer repository named, one-caller pin (text-based: any file whose text contains `BusinessOsFinanceReadRepository`) | `BusinessOsFinanceReadRepository.test.ts:239-266`, `:268-292` |
| The barrel exports the class, singleton, limits, error and row types | `lib/repositories/index.ts:89-95` |
| The tripped guard: `FILES` includes the repository, and the layer-B rule forbids `payment_transactions\|payment_refunds\|payment_plan_` in every file | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:39-46` (`:43`), `:86-88` |
| The same guard's comment stripper and non-vacuity check | `finance.source.guard.test.ts:50-53`, `:56-67` |
| `FINANCE_LIMITS` (display caps live here) | `lib/business-os/finance/financeHealth.ts:87-97` |
| The deps' `finance` Pick (gains four methods) | `financeHealth.ts:121-124` |
| `FinanceHealthCounts` (gains a `takings` group) | `financeHealth.ts:160-180` |
| Account check first; the settled `Promise.all` (gains two reads) | `financeHealth.ts:223-233`, `:268-282` |
| The Section 4 names pattern (names only for ids from rows read, platform labelled) | `financeHealth.ts:379-401` |
| The payload assembly | `financeHealth.ts:478-499` |
| The wiring's finance block | `lib/business-os/finance/financeHealthDeps.ts:105-109` |
| Wire types: "money figures are numbers converted ONCE from exact integer sums"; section status; the payload | `lib/business-os/finance/financeTypes.ts:11-13`, `:21`, `:163-173` |
| The route's one info line (gains `sections.takings` and `counts.takings`) | `app/api/admin/business-os/finance/route.ts:146-173` |
| Route Zod: `.strict()`, so an unknown key such as `currency` is refused (AC-46) | `route.ts:67-90` (`:76`) |
| The route test's mocked deps and `allReads()` (AC-45 / AC-46 cover any method added to `mockDeps.finance`) | `app/api/admin/business-os/finance/__tests__/route.test.ts:57-79`, `:195-206` |
| The page's section order | `app/admin/finance/components/FinanceView.tsx:90-97` |
| The section frame: no badge slot; `unknown` replaces the children with "Could not load this section" and Retry | `app/admin/finance/components/FinanceSection.tsx:22-29`, `:51-63` |
| Page formatters (`formatUsd` only for money) | `app/admin/finance/financeFormat.ts:8-23` |
| The page guard: imports from `lib/business-os/finance/` are type-only | `app/admin/finance/__tests__/source.guard.test.ts:44-52` |
| `toUnits(value, scale)`: number or numeric string, `NaN` when unreadable, `Math.round(n * scale)` | `lib/business-os/credits/creditReport.ts:136-139` (SA cited `:136`) |
| Shared parts: `StatusChip` tones (`neutral` has no icon), `ADMIN_TH_NUM` / `ADMIN_TD_NUM`, `ADMIN_COUNT_LINE`, `formatCount`, `AdminEmpty`, `AdminNotice` | `app/admin/components/layout/StatusChip.tsx:25-28, 40-49`; `adminTable.ts:17-34, 40`; `adminFormat.ts:32-34`; `AdminStates.tsx:71-87, 102-111` |
| Layout folder guard: expected sources (no change in 2a) and the migrated-pages registry (finance not in it, unchanged) | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts:81-98`, `:469-517` |
| Payment schema: `payment_transactions.id` UUID, `user_id NOT NULL … ON DELETE CASCADE`, `amount DECIMAL(10,2)`, `currency TEXT DEFAULT 'USD'` | `supabase/migrations/20260722_create_payment_tables.sql:72-97` |
| Refunds: `user_id NOT NULL … CASCADE`, `amount NUMERIC(12,2) CHECK (> 0)`, `amount_minor BIGINT`, `currency NOT NULL`, status CHECK `pending / succeeded / failed / canceled` | `supabase/migrations/20260828b_payment_refund_ledger.sql:33-51` |
| Fees: `processor_fee NUMERIC(12,2)`, `fee_currency TEXT`, NULL = "not yet known, never assume zero" | `supabase/migrations/20260904_processor_fees.sql:39, 45, 47-48` |
| `processor_type TEXT`, nullable, no CHECK | `supabase/migrations/20260723_enhance_payments.sql:60, 76` |
| Live: 110 payments (USD 60, ILS 50), 41 refunds (all succeeded), fees on 51 of 110, all in USD; `processor_type` stripe 71 / manual 39; no `livemode` column in layer B | LC §1, §2, §3, §4 |
| `adminReadMethods.guard` pins an explicit method list; R-e / R-f names are not in it | `lib/repositories/__tests__/adminReadMethods.guard.test.ts:479-490` |
| The payment write-lockdown source scan only looks for WRITE verbs near `.from('<table>')` | `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts:306-372` |
| Names read chunks at 200 internally | `lib/repositories/BusinessProfileRepository.ts:35, 687` |
| `test:bos-entitlements` includes `lib/repositories/__tests__` (so the finance repository test runs there too) | `package.json:23` |

`console.*` count in every file to modify: **0** (grep over the repository, the barrel, `lib/business-os/finance/*.ts`, the route and every `app/admin/finance` file). The CLAUDE.md flag-and-convert rule has nothing to convert.

---

## Scope

Exactly the 2a row of requirement §11A.0.

| In 2a | Out (2b or later) |
|---|---|
| The currency helper `currencyGroups.ts` (CUR-1, CUR-2, S2-CUR-1 to S2-CUR-7, AC-13) | Section 6 block B, R-g to R-i′, the reminder read R-j |
| R-e, R-e′, R-f, R-f′ in `BusinessOsFinanceReadRepository` | `formatUtcDate` (2b, full cycle, R-7) |
| Section 2 block B: takings per currency (gross, refunded, net), refunds, fees by fee currency, payments by processor, businesses with takings, per-business table capped at 200 (S2-FR-1 to S2-FR-14) | Any KPI tile (§11A.6: none in slice 2) |
| The finance source-guard narrowing and the positive table pin (S2-F1) | The page shell (DF-4), URL param renames, `useAdminFilters` |
| ACs tagged 2a (see [AC mapping](#ac-mapping)) | AC-56 to AC-64, AC-67, AC-74; filtering test businesses (DF-3) |

---

## Questions for SA before code

Each has a recommendation, which I build unless SA rules otherwise. Numbering continues from 1b (SA-W17).

| # | Issue | Recommendation |
|---|---|---|
| **SA-W18** | **"Counted" payments vs SQL check 7.** S2-FR-2 counts only `succeeded` / `refunded` payments in the sums; S2-FR-6 counts businesses with "a counted payment"; S2-FR-5 counts processors "from the same rows". But check 7's `payment_rows` and `businesses` (`count(*)`, `count(distinct t.user_id)`) count **every** status. AC-47 compares "payments, gross and businesses" with check 7. The two agree only while `other_status_rows` is 0 (true today, LC §3). | **Every 2a figure is over counted payments** (succeeded or refunded): the payment count, businesses (overall and per currency), processors, fees and the per-business table. Other statuses are only counted ("N payments with another status not counted"). **BA edit to check 7:** add `count(distinct t.user_id) filter (where t.status in ('succeeded', 'refunded')) as businesses_counted`, and AC-47 compares payments with `succeeded_rows + refunded_rows` and businesses with `businesses_counted`. ASCII, no apostrophe, no "into", one result set. |
| **SA-W19** | **A currency or a business with refunds but no payment in the window.** Refunds are dated by `created_at` (SA-Q19), so a refund can fall in a window that has no payment in its currency, or for that business. S2-FR-2 puts **net** on the takings line, and S2-FR-7 builds table rows from payments. As written, that refund's net has no line, and the business has no row. | **Takings lines and table rows are the union of the keys seen in payments and in succeeded refunds.** A refund-only line shows payments 0, gross `0.00` (its currency has rows, so this is not the "USD 0.00 for a currency with no rows" case S2-FR-8 forbids), refunded, and a negative net. "Businesses with takings" still counts only businesses with a counted payment. The empty state ("No client payments recorded in this window") is decided by payments alone. |
| **SA-W20** | **An unreadable amount and the net.** S2-CUR-3 excludes and counts an unreadable amount, never as 0. It does not say what that does to net or to the block status. Slice 1a's precedent: an unreadable amount makes the figure inexact (`aiCost.ts:148-149`, SA-1 / QA-1). | **A currency with any unreadable payment or refund amount shows net "Unknown"** on that line and on the affected table rows; its gross and refunded exclude the value and say "excludes N unreadable". **The block is `partial`** with an `AdminNotice` ("N amounts could not be read and are not counted"). An unreadable **fee** is left out of its fee line and counted in the fee note; it never changes net (fees are never deducted), but it **does** make the block `partial`, because that fee line is then a lower bound (corrected per SA-WR-14). |
| **SA-W21** | **Processor values.** `processor_type` is nullable with no CHECK (`20260723_enhance_payments.sql:60, 76`); live values are `stripe` and `manual` (LC §1). | Count per stored value, trimmed and lower-cased. Labels live in `financeCopy.ts` only (`stripe` → "Stripe", `manual` → "Manual: recorded by the business; no processor fee"). Any other value is shown as its stored text; NULL or empty → "Not recorded". No processor literal in `lib/`. |
| **SA-W22** | **The one-caller pin is text-based.** `BusinessOsFinanceReadRepository.test.ts:268-292` lists every file whose text contains `BusinessOsFinanceReadRepository`. A new `takings.ts` that imports the row types from the repository would join that list. Condition 3 says the pin stays unchanged. | **`takings.ts` declares its own structural input types** (`TakingsPaymentInput`, `TakingsRefundInput`). `financeHealth.ts`, already on the list, passes the repository rows, which are structurally compatible; `tsc` proves the fit. The pin's list is not edited. |
| **SA-W23** | **`FINANCE_READ_LIMITS` equality test.** `BusinessOsFinanceReadRepository.test.ts:92` pins the constant to exactly two keys. | Edit that one assertion to the four keys (`CLIENT_PAGE_SIZE: 1000`, `CLIENT_CEILING: 5_000` added). It is neither the no-write pin nor the one-caller pin, which stay byte-identical. |
| **SA-W24** | **Where the "Not our revenue" chip goes.** `FinanceSection.tsx:22-29` has no badge slot, and in the `unknown` state it renders no children (`:51-63`), so a chip placed in the children would vanish exactly when the block fails. | Add one optional prop to the page-local frame: `badge?: { tone: StatusTone; label: string }`, rendered with the shared `StatusChip` beside the heading in every state. The existing sections pass nothing, so their DOM is unchanged. This is a page-local component, not the page shell (DF-4). |
| **SA-W25** | **CUR-5 and the helper's input.** (a) CUR-5 routes AI cost through the helper "wherever it is shown beside other money". In 2a, Section 3 stays where it is, labelled USD, and layer-B money is in its own block; nothing is shown beside it. (b) SA-Q13 says PostgREST returns the money columns as JSON numbers, but the ledger's numeric columns arrive as strings in this repo's fixtures. | (a) **Section 3 is not changed in 2a.** CUR-5 applies when a later slice puts AI cost beside other money (slice 6, margin). (b) The helper converts through the existing `toUnits(value, 100)` (`creditReport.ts:136-139`), which accepts a number **or** a numeric string, then applies the whole-hundredths test. A change in PostgREST's serialisation then cannot zero the block. No new conversion is written. |
| **SA-W26** | **Wire format of money.** `financeTypes.ts:11-13`: money figures are numbers converted ONCE from exact integer sums. The alternative is to send integer hundredths. | **Follow the precedent.** Sums are integer hundredths in Node; each figure is divided by 100 once, at the payload edge. The page formats with exactly 2 decimals (`formatMoney`). |
| **SA-W27** | **`schema:check` cannot see the new selects.** They pass exported column constants, and the script replays literal selects only (skill, "Blind spots"). | Columns are confirmed live by LC §1 (OpenAPI, 2026-10-11): every selected column is listed there. SQL checks 7 to 9 also name every one except `id` and `processor_type` (both in LC §1). Dev runs `npm run schema:check` if credentials exist and records the result either way. No extra SQL check is proposed. |

---

## Analysis Summary

| Area | Touched how |
|---|---|
| Finance read repository | Four new named reads (R-e, R-e′, R-f, R-f′), two column constants, two limit keys, header paragraphs (layer B, no `livemode`, keyset on `id`) |
| Currency helper (new, pure) | `currencyGroups.ts`: code normalisation, scale-100 conversion with the unreadable rule, grouping into one line per currency, sorted, "Unknown currency" last; no cross-currency total |
| Takings builder (new, pure) | `takings.ts`: per-currency lines, refund lines, fee lines, processors, businesses, the per-business rows and the cap, the honesty states |
| Builder | `financeHealth.ts`: two settled reads in the existing `Promise.all`, the takings section, its names call, the counts |
| Wiring | `financeHealthDeps.ts`: four more methods in the existing `finance` block |
| Route | Info line only (`sections.takings`, `counts.takings`); header comment. Zod, gate, 404 / 500 and `no-store` unchanged |
| Page | New `TakingsSection.tsx` under "Our revenue"; `FinanceSection` gains an optional badge; `formatMoney`; copy |
| Tables read (2a) | `payment_transactions`, `payment_refunds` (LC §1, §5). No new column beyond LC §1 |
| Not touched | Every slice-1 read, Section 1 / 3 / 4 logic, the KPI strip, the URL, the filter bar, the shared layout folder, Health, the Businesses list, the Stripe and payment code |

---

## Implementation Approach

1. **Repository first, behind the existing pins.** R-e to R-f′ with their tests; the no-write pin and the one-caller pin pass unedited (V-1).
2. **Pure code next:** `currencyGroups.ts`, then `takings.ts`, each with its tests (the 1a / 1b order). Both take everything as parameters (SA-WR-4) and read no clock.
3. **Builder, wiring, route**, then the **page**.
4. **Guard edits last**, each with a planted negative control, so a rule that cannot match is caught.
5. **No new pattern.** Named all-accounts / account-scoped pairs are R-c / R-c′'s. Keyset paging is R-c's (on `id`). `reachedCeiling` is R-a's `>=` rule (`BusinessOsCreditLedgerReadRepository.ts:155-163`). The scale conversion is `toUnits`. The names lookup is Section 4's. The shared parts are imported through the alias, as the migrated pages do.

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/finance/currencyGroups.ts` | Pure CUR-1 / CUR-2 helper: `normaliseCurrencyCode`, `toHundredths`, `groupByCurrency`. No import from a repository or the entitlements module |
| `lib/business-os/finance/__tests__/currencyGroups.test.ts` | AC-13, AC-48 (helper half), the scale and unreadable rules, the exact export list |
| `lib/business-os/finance/takings.ts` | Pure `buildTakings(input)`: lines, refunds, fees, processors, businesses, rows, cap, honesty states. Structural input types (SA-W22) |
| `lib/business-os/finance/__tests__/takings.test.ts` | AC-47 (method), AC-49 to AC-54, SA-W18 to SA-W20 |
| `app/admin/finance/components/TakingsSection.tsx` | The block: chip, lines, refunds, fees, processors, businesses, the table, notes, empty and partial states |

### Modify

| File | Change |
|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | R-e, R-e′, R-f, R-f′; `FINANCE_CLIENT_PAYMENT_COLUMNS`, `FINANCE_CLIENT_REFUND_COLUMNS`; row types `FinanceClientPaymentRow`, `FinanceClientRefundRow`, `FinanceClientReadResult<T>`; `FINANCE_READ_LIMITS` + `CLIENT_PAGE_SIZE`, `CLIENT_CEILING`; header (below) |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Recording client gains `gte`, `lt`; four new `describe` blocks; the `:92` equality gains two keys (SA-W23). Pins at `:239-292` unedited |
| `lib/repositories/index.ts` | Export the two new column constants and row types (new-repository skill, Step 4) |
| `lib/business-os/finance/financeTypes.ts` | `FinanceTakingsSection` and its figure types; `FinancePayload.takings` |
| `lib/business-os/finance/financeHealth.ts` | `finance` Pick + four methods; `FINANCE_LIMITS.TAKINGS_ROWS_SHOWN: 200`; two settled reads; the takings section; its names call; `counts.takings` |
| `lib/business-os/finance/financeHealthDeps.ts` | Four wiring lines in the `finance` block; header line for layer B |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | New describes: takings all businesses, picked business (AC-65), failures (AC-66), names; the shared fake gains the four methods |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Narrow `:86-88`; the positive table pin; the `livemode` method-body rule; non-vacuity adds the 2a files (see [Guard table](#guard-table-line-by-line)) |
| `app/api/admin/business-os/finance/route.ts` | Info line: `sections.takings`, `counts.takings`; header mentions slice 2a |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | `mockDeps.finance` gains four mocks (so `allReads()` covers AC-45 / AC-46); new cases: the payload, AC-46 `currency` key, AC-65 and AC-66 through the route, the info line (AC-69) |
| `app/admin/finance/components/FinanceView.tsx` | `<TakingsSection>` directly after `<RevenuePanel>` |
| `app/admin/finance/components/FinanceSection.tsx` | Optional `badge` prop (SA-W24) |
| `app/admin/finance/financeCopy.ts` | Every 2a string, processor labels (SA-W21); `PAGE_PURPOSE` mentions business takings |
| `app/admin/finance/financeFormat.ts` | `formatMoney(amount, currency)`: `"USD 1,234.56"`, `"Unknown currency 12.00"`, exactly 2 decimals |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Fixture gains `takings`; render cases for AC-48, AC-51, AC-52, AC-53, AC-54, AC-55, AC-68 |
| `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` | §0.1 slice 2 row links this workplan; Change History row (this step). Status updates at each later stage |

**Not modified, on purpose:** the shared layout folder and its guard, `adminWindowPresets.ts`, `financeUrl.ts`, `FinanceFilterBar.tsx`, `FinanceKpiStrip.tsx`, `financeRules.ts`, `aiCost.ts`, `creditsSection.ts`, `planGroups.ts`, every Health file, `AdminSidebar`, the payment writer repositories, every Stripe file, `enforcementPoints.test.ts`, the RC-15 guard, the ledger caller list, G3.

---

## The reads: R-e, R-e′, R-f, R-f′

All in `BusinessOsFinanceReadRepository`, service role (constructor default, `:99-103`). Every method returns `{ data, error }` and never throws (it uses `fail`, `:105-112`).

### Shared rules

| Item | Spec |
|---|---|
| Range | `{ from: Date; to: Date }`, half-open `from <= col < to`. Refused before any query (guard error) when either is not a valid `Date` or `from >= to`. The builder passes the window's `start` / `end` (`ResolvedFinanceWindow`, `financeWindow.ts:26-33`) |
| Options | `opts?: { pageSize?: number; ceiling?: number }`, for tests (AC-51 with a small ceiling). Defaults `FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE` (1,000, PostgREST's `max-rows`) and `CLIENT_CEILING` (5,000). Each must be an integer from 1 to its default, or the read is refused (the R-c checks at `:132-137`) |
| Paging | **Keyset on `id`** (UUID): `.order('id', { ascending: true })`, `.limit(size)` with `size = min(pageSize, ceiling - rows.length)`, and from page two `.gt('id', last)`. Stops on a short page. `.gt` is a separate top-level filter (SA-Q15) |
| Ceiling | `>=` rule: when `rows.length >= ceiling`, stop, and return **the rows with `reachedCeiling: true`** (SA-Q15). It never errors on the ceiling (unlike R-c) |
| Result | `RepositoryResult<FinanceClientReadResult<T>>`, with `FinanceClientReadResult<T> = { rows: T[]; reachedCeiling: boolean }` (the R-a shape, defined here so the repository imports no type from another repository) |
| Mode | **No `livemode` filter** on any of the four (BD-13, S2-T-2) |
| Status | **No status filter in the query.** Every status is read, so other statuses can be counted (S2-FR-2, S2-FR-3) |
| Logging | All-accounts: `info` `{ method, rows, reachedCeiling, durationMs }`. Account-scoped: `debug` `{ method, rows, reachedCeiling }` (the R-c′ convention, no account id at info). Never an amount, a currency or an id |
| Writes | None. The no-write pin (`:252-254`) and no-aggregate pin (`:256-258`) hold unedited |

### Columns (exact, exported)

| Constant | Columns | Excluded on purpose |
|---|---|---|
| `FINANCE_CLIENT_PAYMENT_COLUMNS` | `id, user_id, amount, currency, status, paid_at, processor_fee, fee_currency, processor_type` | `contact_id`, `metadata`, every Stripe id, `net_amount`, `refunded_amount`, `failure_reason`, `invoice_id`, `service_id`, `booking_id` (client data or unused; S2-FR-26 rule applied early) |
| `FINANCE_CLIENT_REFUND_COLUMNS` | `id, user_id, amount, currency, status, created_at` | `amount_minor` (SA-Q13), `reason`, `metadata`, `transaction_id`, `invoice_id`, the Stripe ids, `refund_fee` |

### The four methods

| # | Signature | Query |
|---|---|---|
| **R-e** | `listClientPaymentsAllAccountsPaidInRange(range, opts?)` | `.from('payment_transactions').select(FINANCE_CLIENT_PAYMENT_COLUMNS).gte('paid_at', from).lt('paid_at', to)` + keyset |
| **R-e′** | `listClientPaymentsForAccountPaidInRange(accountId, range, opts?)` | UUID check first (`UUID_PATTERN`, `:74`), then the same with `.eq('user_id', accountId)` |
| **R-f** | `listClientRefundsAllAccountsCreatedInRange(range, opts?)` | `.from('payment_refunds').select(FINANCE_CLIENT_REFUND_COLUMNS).gte('created_at', from).lt('created_at', to)` + keyset |
| **R-f′** | `listClientRefundsForAccountCreatedInRange(accountId, range, opts?)` | UUID check first, then the same with `.eq('user_id', accountId)` |

A payment with `paid_at` NULL is never in a window (none today: 110 of 110 set, LC §1). That is the requirement's definition (§11A.2).

### Header changes

- The opening line names slice 2a and reads R-e to R-f′.
- **WHY A SEPARATE REPOSITORY** gains: the layer-B payment tables have writer and owner-scoped repositories, several pinned by the Stripe webhook placement guards (LC §5). These reads therefore live here, read-only. Those repositories are named in words only.
- **ACCOUNT SCOPE** lists the two new pairs.
- **LIVE MODE ONLY** becomes **"LIVE MODE (layer A only)"**: the billing and boost reads filter `livemode = true`; the client-payment reads have no `livemode` column and, by decision BD-13, no mode filter.
- **PAGING:** layer B pages by keyset on `id` and returns rows plus `reachedCeiling`; R-c still errors on its ceiling.

### Tests (`BusinessOsFinanceReadRepository.test.ts`)

The recording client's method list (`:54`) gains `gte` and `lt`.

1. **Columns:** each constant equals its exact list; neither contains `contact_id`, `metadata`, `livemode` or `amount_minor`.
2. **R-e / R-f:** exact table, columns, `gte` / `lt` on the right column with ISO strings, `order('id', asc)`, `limit(1000)`. **No `eq` call at all** and no `livemode` argument anywhere. Info line with counts only.
3. **Keyset:** a full first page, then `gt('id', <last id>)`, stopping on a short page.
4. **Ceiling:** with `{ ceiling: 3, pageSize: 2 }` and enough rows, the result has 3 rows and `reachedCeiling: true`, with `error: null`. Exactly 3 rows also gives `true` (the `>=` rule). 2 rows gives `false`.
5. **R-e′ / R-f′:** `.eq('user_id', A)` on every page. A malformed id (`''`, `'not-a-uuid'`, the `' or 1=1` string) is refused **before** `from` is called, `{ data: null, error }`, warn. No info line carries the id.
6. **Bad range or options:** `from >= to`, an invalid `Date`, `pageSize` 0 / 1001 / 1.5, `ceiling` 0 / 5001 → refused before querying.
7. **Read error** → `{ data: null, error }`, logged at error, never throws.

---

## Money maths: the currency helper

`lib/business-os/finance/currencyGroups.ts`: pure, no clock, no I/O. Imports only `toUnits` from `@/lib/business-os/credits/creditReport` (already a finance dependency, `financeWindow.ts:16`).

```ts
/** CUR-2: trimmed, upper-cased, exactly three letters A to Z; anything else is null ("Unknown currency"). */
export function normaliseCurrencyCode(raw: unknown): string | null;

/**
 * S2-CUR-3: one amount as an integer number of hundredths, or null when unreadable.
 * Unreadable = missing, not finite, or not a whole number of hundredths:
 * abs(n * 100 - Math.round(n * 100)) > 1e-6. Conversion through toUnits(value, 100).
 */
export function toHundredths(raw: unknown): number | null;

/** One line per normalised currency. There is no function here that returns a total across lines. */
export interface CurrencyLine<F extends string> {
  /** Null = the "Unknown currency" line. */
  currency: string | null;
  /** Integer hundredths per field, summed in this currency only. */
  sums: Record<F, number>;
}

/** Groups entries by normalised currency; sorted by code, the Unknown line last. */
export function groupByCurrency<F extends string>(
  entries: Iterable<{ currency: unknown; field: F; hundredths: number }>,
  fields: readonly F[]
): CurrencyLine<F>[];

export const CURRENCY_SCALE = 100;
```

| Rule | How |
|---|---|
| Scale 100 (SA-Q13) | `toUnits(raw, 100)` gives `Math.round(n * 100)`; `n` is re-derived the same way (`typeof raw === 'number' ? raw : Number(raw)`) for the whole-hundredths test. The largest value, 10^10 × 100, is a safe integer; the sum is checked with `Number.isSafeInteger` and an overflow makes the line unreadable (it cannot happen at today's volumes, but it is never silent) |
| Unreadable | Returned as `null`; the **caller** counts it. The helper never turns it into 0 |
| CUR-2 | `String(raw).trim().toUpperCase()`, then `/^[A-Z]{3}$/`; NULL, empty, `US`, `USDX` → null |
| No cross-currency total (S2-CUR-1) | The module's exports are exactly the five names above (pinned by `Object.keys` in the test). No export returns a number built from more than one line |
| No FX (CUR-3) | No `exchange_rates`, no rate (source guard) |
| Sort (S2-CUR-5) | By code ascending; the Unknown line last |

**Tests (`currencyGroups.test.ts`):** AC-13 (USD, `usd`, ILS, NULL → three lines; `" ils "` → ILS; `US`, `USDX` → Unknown); scale (`12.34` → 1234; `0.1 + 0.2` → 30; `'12.34'` string → 1234; `12.345`, `NaN`, `Infinity`, `null`, `''`, `{}` → null); a 10^10 value stays exact; sort order with Unknown last; the export list is exactly `['CURRENCY_SCALE', 'groupByCurrency', 'normaliseCurrencyCode', 'toHundredths']` plus the type-only `CurrencyLine` (which does not appear at runtime).

---

## The takings builder

`lib/business-os/finance/takings.ts`: pure (SA-WR-4).

```ts
export interface TakingsPaymentInput {        // structural (SA-W22): no repository import
  id: string; user_id: string | null; amount: unknown; currency: unknown; status: string | null;
  processor_fee: unknown; fee_currency: unknown; processor_type: string | null;
}
export interface TakingsRefundInput {
  id: string; user_id: string | null; amount: unknown; currency: unknown; status: string | null;
}
export function buildTakings(input: {
  payments: { rows: readonly TakingsPaymentInput[]; reachedCeiling: boolean } | null;  // null: R-e failed
  refunds: { rows: readonly TakingsRefundInput[]; reachedCeiling: boolean } | null;    // null: R-f failed
  isPlatformAccount: (accountId: string) => boolean;
  displayCap: number;                                                                    // TAKINGS_ROWS_SHOWN
}): TakingsResult;
```

| Figure | Rule |
|---|---|
| Counted payment | `status` (trimmed) is `succeeded` or `refunded`. Any other status, including NULL, is counted in `otherStatusPayments` and left out of everything else (SA-W18) |
| Gross per currency | Σ hundredths of `amount` over counted payments, by the payment's own `currency` (CUR-4) |
| Refunded per currency | Σ hundredths of `amount` over refunds with `status` `succeeded`, by the refund's own `currency`. Any other status → `refundsNotCompleted`, amount left out (S2-FR-3, AC-50) |
| Net per currency | `gross - refunded` in hundredths, **only when exact**: null when R-e reached its ceiling, R-f failed or reached its ceiling, or the line has an unreadable payment or refund amount (S2-FR-8, SA-W20). Never a lower bound minus a figure |
| Lines | The union of currencies with a counted payment or a succeeded refund (SA-W19), through `groupByCurrency` |
| Per line | `payments` (count), `gross`, `refunded`, `net`, `businesses` (distinct `user_id` with a counted payment in that currency), `unreadable` (count) |
| Refund lines (S2-FR-3) | One per refund currency: `refunds` (count of succeeded), `refunded` |
| Fees (S2-FR-4, S2-CUR-4) | Over counted payments with a non-null `processor_fee`: grouped by **`fee_currency`** (never `currency`). A fee with no or a malformed fee currency → the Unknown line. An unreadable fee → `unreadableFees`, left out (SA-W20). `feesRecordedOn` = counted payments with a readable fee; `of` = counted payments. Fees never touch gross or net |
| Processors (S2-FR-5) | Counts per `processor_type` (trimmed, lower-cased; NULL / empty → `null` = "Not recorded") over counted payments (SA-W21). Counts only |
| Businesses (S2-FR-6) | Distinct non-null `user_id` with a counted payment, overall and per line |
| Table rows (S2-FR-7) | Key `(user_id, currency)` over counted payments and succeeded refunds (SA-W19): payments, gross, refunded, net (same exactness rule). Sorted by currency (Unknown last), then gross descending, then `user_id` ascending. Sliced to `displayCap`; `rowsTotal` reported. A NULL `user_id` row is kept as `accountId: null` ("Unknown business", defensive; cannot occur, S2-F6). `isPlatform` set per row |
| Exactness flags | `paymentsExact = !payments.reachedCeiling`; `refundsState`: `ok`, `partial` (ceiling) or `unknown` (R-f failed). On `paymentsExact = false`, every gross and count is "At least" (AGG-3) |
| Status | R-e failed → `unknown` (no figures). Else `partial` if R-e or R-f reached its ceiling, R-f failed, or any unreadable amount or fee exists; else `ok` |
| Empty | No counted payment **and** no succeeded refund → no line, no row, `empty: true`; status `ok` (AC-52). No payment but refunds → lines from refunds; the "No client payments recorded in this window" sentence still shows |

All sums stay integer hundredths inside the builder. The payload values are divided by 100 once (SA-W26).

**Tests (`takings.test.ts`):** AC-47 method (a fixture's figures equal an independent `checkSevenAndEight` helper written in the test, the 1b `checkFive` approach); AC-48 (USD, `usd`, ILS, NULL for payments and for refunds → three lines each); AC-49 (an ILS payment with a USD fee: the fee only on the USD fee line, the ILS line has no fee field, net unchanged, "recorded on 1 of 1"); AC-50 (a succeeded refund with no payment in the window counts; a `pending` refund is "not completed", its amount left out); AC-51 (ceiling on either side → "At least" flags, net null, `partial`); AC-52 (empty → no line, `ok`); AC-53 (`12.345`, NaN, a `pending` payment → counted, never 0; net null on that line; `partial`); AC-54 (sort, the 200 cap with 201 keys, the NULL id row, a platform account flagged); SA-W19 (refund-only currency and refund-only business); SA-W21 (processor NULL, `Stripe ` → `stripe`, an unknown value kept).

---

## The builder, the wiring and the route

### `financeHealth.ts`

- `finance: Pick<…, … | 'listClientPaymentsAllAccountsPaidInRange' | 'listClientPaymentsForAccountPaidInRange' | 'listClientRefundsAllAccountsCreatedInRange' | 'listClientRefundsForAccountCreatedInRange'>` (`:121-124`).
- `FINANCE_LIMITS.TAKINGS_ROWS_SHOWN: 200` (`:87-97`, data, S2-FR-7).
- The `Promise.all` (`:268-282`) gains two settled reads, so they run beside every slice-1 read:
  - `settle(() => accountId !== null ? deps.finance.listClientPaymentsForAccountPaidInRange(accountId, range) : deps.finance.listClientPaymentsAllAccountsPaidInRange(range))`
  - the same for refunds.
  - `range = { from: window.start, to: window.end }`.
- Failures logged with the existing `failed(read, err)` (`:221`): `client_payments`, `client_refunds`.
- `buildTakings(...)`, then **names for the rows shown only** (the Section 4 pattern, `:379-401`): ids = shown rows with a non-null `accountId` that are not platform accounts; one `settle(() => deps.findNames(ids))`, skipped when empty. Each row gets `name` and `nameStatus` (`found` / `missing` / `unavailable` / `platform`, plus `unknown_business` for a NULL id). A names failure never fails the block.
- `payload.takings = { status, scope: accountId ? 'one' : 'all', figures }` (S2-FR-12).
- `counts.takings`: `{ payments: number | null, refunds: number | null, paymentsCeiling, refundsCeiling, otherStatusPayments, refundsNotCompleted, unreadableAmounts, unreadableFees, currencies, rowsShown, rowsTotal, namesFound }`. Counts and booleans only.

### `financeHealthDeps.ts`

Four lines in the `finance` block (`:105-109`), each a direct delegation to `businessOsFinanceReadRepository`. The header's finance bullet adds "and the client payments and refunds (layer B, slice 2a)". No other import.

### `financeTypes.ts`

```ts
export interface FinanceTakingsLine {
  currency: string | null;          // null = "Unknown currency"
  payments: number; gross: number; refunded: number | null; net: number | null;
  businesses: number; unreadable: number;
}
export interface FinanceRefundLine { currency: string | null; refunds: number; refunded: number }
export interface FinanceFeeLine { currency: string | null; fees: number; payments: number }   // currency = fee currency
export interface FinanceTakingsRow {
  accountId: string | null; name: string | null;
  nameStatus: 'found' | 'missing' | 'unavailable' | 'platform' | 'unknown_business';
  currency: string | null; payments: number; gross: number; refunded: number | null; net: number | null;
}
export interface FinanceTakingsFigures {
  empty: boolean; paymentsExact: boolean; refundsState: FinanceSectionStatus;
  lines: FinanceTakingsLine[]; refundLines: FinanceRefundLine[] | null; refundsNotCompleted: number | null;
  feeLines: FinanceFeeLine[]; feesRecordedOn: number; countedPayments: number; unreadableFees: number;
  processors: Array<{ processorType: string | null; payments: number }>;
  businesses: number; otherStatusPayments: number; unreadableAmounts: number;
  rows: FinanceTakingsRow[]; rowsTotal: number;
}
export interface FinanceTakingsSection { status: FinanceSectionStatus; scope: 'all' | 'one'; figures: FinanceTakingsFigures | null }
```

Every money field sits in an object that also has a `currency` key. That is what the AC-48 payload test walks.

### The route

Only the info line (`route.ts:151-173`): `sections.takings: payload.takings.status` and `counts` (which now carries `counts.takings`). The header gains one sentence for slice 2a. Zod, the gate, the 404 / 500 paths and `no-store` are untouched: **no new query parameter**, and `.strict()` (`:76`) still refuses `currency` (AC-46).

---

## With a business picked (AC-65, AC-42 re-run)

The tenant-isolation-guard **read** invariant. The service role is used, and the only caller-supplied id is `accountId`. It is validated as a UUID (`route.ts:74`), refused if it is a platform account (`:126-128`), and checked against the plan table **before** any read (`financeHealth.ts:225-233`). Nothing writes, so the write steps of the guard (pre-check before a write, field allow-list) do not apply. There is no trigger, no upsert and no caller-supplied payload.

| Read | All businesses | One business picked |
|---|---|---|
| Client payments | **R-e** | **R-e′(accountId)**: `.eq('user_id')` on every page; UUID refused before query |
| Client refunds | **R-f** | **R-f′(accountId)** |
| Names | Ids from takings rows already read | Only `accountId`, and only if it appears in a row read |

With `accountId` set, **R-e and R-f have zero calls**, as `pagePlans`, R-a, R-c and R-b already have (AC-42). "Businesses with takings" reads 1 or 0 (S2-FR-11).

**Required test (SA-WR-3 shape):** in `financeHealth.test.ts` and through the route in `route.test.ts`, with spies on all four methods and `findNames`. With `accountId`: R-e′ and R-f′ each receive exactly `accountId` (and the window range); R-e and R-f have zero calls; names receive at most `[accountId]`. The scope itself is enforced in the repository (`.eq('user_id')` on every page, T1), not in the builder: names are taken only from rows already read (SEC-5), and with a business picked those rows come only from R-e′ and R-f′.

---

## Failure matrix

Never a 500 for a failed read (SA-Q8). Never a lower bound minus a figure (S2-FR-8).

| What happens | Block status | Gross / counts | Refunded | Net | Fees | Table |
|---|---|---|---|---|---|---|
| Nothing wrong | `ok` | exact | exact | exact | exact | rows |
| R-e failed (AC-66) | `unknown`: "Could not load this section" + Retry | — | — | — | — | — |
| R-e at its ceiling (AC-51) | `partial` + notice | "At least" | exact | **Unknown** | "At least" note | rows, net Unknown |
| R-f failed (AC-66) | `partial` + "Refunds could not be read" | exact | **Unknown** | **Unknown** | exact | refunded / net Unknown |
| R-f at its ceiling (AC-51) | `partial` + notice | exact | "At least" | **Unknown** | exact | net Unknown |
| An unreadable amount (AC-53, SA-W20) | `partial` + notice with the count | excludes it | excludes it | Unknown on that line | — | net Unknown on that row |
| An unreadable fee | `partial` + count in the fee note | — | — | — | excludes it | — |
| A payment with another status | `ok` | left out, counted | — | — | — | — |
| Names failed | `ok` | — | — | — | — | "Name unavailable" |
| Every slice-1 read failed | `ok` (independent) | — | — | — | — | — |

---

## The page

`TakingsSection.tsx` (client, `import type` only from `lib/business-os/finance/`), rendered in `FinanceView` **directly after `<RevenuePanel>`** and before `<AccountsByPlanSection>` (§11A.0 page order).

- **Frame:** `FinanceSection` with `id="takings"`, title "Takings through the platform", subtitle "Client payments recorded by the businesses · {window} UTC · Covers businesses that still exist" (S2-FR-1), the section status, and `badge={{ tone: 'neutral', label: 'Not our revenue' }}` (SA-W24).
- **Takings per currency:** a table (`ADMIN_TABLE_WRAP`, `ADMIN_TABLE`, `ADMIN_THEAD`, `ADMIN_TH` / `ADMIN_TH_NUM`, `ADMIN_TBODY`, `ADMIN_TD` / `ADMIN_TD_NUM`), `aria-label="Takings per currency"`, `scope="col"`. Columns: Currency, Payments, Gross, Refunded, Net of refunds (fees not deducted), Businesses. Money cells carry the code (`formatMoney`), so every money cell names its currency. Counts via the shared `formatCount`. "At least" and "Unknown (a read was cut off)" in words.
- **Refunds:** one line per refund currency, the "not completed" count, and the note "A refund counts in the month it was made, which may differ from the month of its payment."
- **Recorded processor fees:** one line per fee currency; "Fees recorded on N of M payments in this window"; the note "A fee can be charged in another currency than its payment, so fees are never deducted from takings." Only recorded fees, never an estimate.
- **Payments by processor:** counts with the SA-W21 labels.
- **Businesses with takings:** overall count.
- **Per-business table:** Business, Currency, Payments, Gross, Refunded, Net; `ADMIN_COUNT_LINE` "Showing N of M"; "Platform account", "Name unavailable", "Unknown business" in words.
- **Cannot produce (S2-FR-10):** one short list: failed client payments (shown in a later update), refund fees, net after fees, one total across currencies.
- **States:** `AdminEmpty` for "No client payments recorded in this window" and, in the refunds part, "No refunds in this window" (no currency line, no `0.00`, AC-52). `AdminNotice` for each partial cause. A missing value is "Unknown" or "—", never blank.
- **BD-13:** no test-mode label, note or switch anywhere in the block (AC-55).
- **Copy:** every string in `financeCopy.ts` (S2-FR-14). No figure, currency code, processor literal or threshold is typed in the component.

The KPI strip still holds exactly K-1 to K-5 (AC-68): `FinanceKpiStrip.tsx` is not touched.

---

## Guard table, line by line

| Guard | 2a trips it? | Exact change |
|---|---|---|
| **`lib/business-os/finance/__tests__/finance.source.guard.test.ts:86-88`** (layer-B rule over every `FILES` entry; `FILES` includes the repository at `:43`) | **Yes** (S2-F1) | **1. Narrow.** `const LAYER_B_FREE = FILES.filter((f) => f !== REPOSITORY)` with `REPOSITORY = 'lib/repositories/BusinessOsFinanceReadRepository.ts'`, and `it.each(LAYER_B_FREE)` on the same regex. The builder, wiring, `takings.ts`, `currencyGroups.ts`, route, page, billing and presets files still never name a payment table. Non-vacuity: `LAYER_B_FREE.length === FILES.length - 1`, and it contains `takings.ts`, `currencyGroups.ts`, `TakingsSection.tsx`. **2. Positive pin.** `tablesOf(code) = [...code.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)].map(m => m[1])` over the comment-stripped repository; its unique sorted set **equals exactly** `['business_os_billing_accounts', 'business_os_billing_events', 'business_os_boost_purchases', 'payment_refunds', 'payment_transactions']`. 2b adds its three tables to this list. An explicit `not.toContain('payment_reminders')` (R-j owns it). **Planted negative controls:** `tablesOf("x.from('payment_reminders')")` is `['payment_reminders']`; the set check fails on a planted extra; `tablesOf` finds at least five tables in the real file (the extractor is not dead) |
| Same file: **new rules** (§12.1 source guards) | Added | (a) **No `livemode` in a layer-B method body:** the bodies of the four 2a methods are sliced from the comment-stripped repository (from `async <name>(` to the next `async ` or the class's closing brace) and must not match `/livemode/`; a planted body with `.eq('livemode', true)` is caught; each slice is non-empty. (b) **No `exchange_rates`** in any `FILES` entry. (c) **`currencyGroups.ts` export list** pinned exactly (also in its own test). (d) `takings.ts`, `currencyGroups.ts` and `TakingsSection.tsx` contain no `livemode` and no `/test.?mode/i` (AC-55). Non-vacuity (`:56-67`) adds `currencyGroups.ts`, `takings.ts`, `TakingsSection.tsx` |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Extended | Four `describe` blocks (above); the recording client gains `gte`, `lt`; `:92` gains two keys (SA-W23). **No-write pin (`:252-254`), no-aggregate pin (`:256-258`), writer-name pin (`:260-266`) and one-caller pin (`:268-292`) unedited** (SA-W22) |
| Stripe webhook placement guards: `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts`, `lib/payments/__tests__/planSurfaces.guard.test.ts` | **No** (SA-Q16, verified by SA) | None. Run unchanged and paste (V-5). Any trip goes to SA, never a list edit |
| `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` (who writes the payment tables, `:306-372`) | **No.** It looks for a write verb within 200 characters after `.from('<table>')`; the new reads have none, and the file is not a client module | None. Run unchanged (V-5) |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | **No** (explicit list, `:479-490`) | None. Run unchanged |
| `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts` | **No** (2a has no reminder read) | None. Run unchanged |
| `app/admin/finance/__tests__/source.guard.test.ts` | **No**, by construction | `TakingsSection.tsx` imports only types from `lib/business-os/finance/` (`:44-52`), no repository, no `server-only`, no `console.` |
| Shared layout folder guard (C-14) `layoutFolder.guard.test.ts` | **No.** No shared file is added or changed; the finance page is not in the registry (`:469-517`) and is not added (DF-4) | None. Run unchanged |
| `enforcementPoints.test.ts`, `tierLiteral.forbidden.test.ts`, RC-15, ledger caller list, G3, `creditFigures.fromConfig.guard`, `accountSeam.guard` | **No.** No new import from the entitlements module, no tier or capability literal, no ledger / lot / plan repository name in a new file | None. `test:bos-entitlements` proves it (V-3) |
| `serviceColumn.guard.test.ts` (N-10, scans the finance dir) | **No.** No `service` column is read | None |
| `businessOwnedTables` / purge descriptors | **No.** No new table | None |
| Admin authz surface guard | **No.** No new route or page | Run (V-4) |
| `AdminSidebar.nav.test.ts`, Health suites | **No** | Run unchanged |

**No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate, and the repository test also runs in `test:bos-entitlements`.

---

## AC mapping

T-numbers: **T1** `BusinessOsFinanceReadRepository.test.ts`, **T2** `currencyGroups.test.ts` (new), **T3** `takings.test.ts` (new), **T4** `financeHealth.test.ts`, **T5** `finance.source.guard.test.ts`, **T6** finance `route.test.ts`, **T7** `financePage.render.test.tsx`, **T8** `app/admin/finance/__tests__/source.guard.test.ts`. QA = a recorded manual step.

| AC | Test / check |
|---|---|
| **AC-13** | T2: USD + `usd` + ILS + NULL → three lines; `" ils "` → ILS; `US`, `USDX` → Unknown; the export list holds no cross-currency total |
| **AC-45** | T6: 401 and 403 (incl. the `profiles.role`-only admin) with zero calls on every `mockDeps.finance` method (the four new ones included through `allReads()`) |
| **AC-46** | T6: every AC-4, AC-33, AC-34 case still 400 with zero layer-B reads; new case `?currency=USD` → 400 |
| **AC-47** | T3 against an independent check-7 / check-8 helper; QA: SQL checks 7 and 8 against the page (V-11, with the SA-W18 edit) |
| **AC-48** | T2 (helper), T3 (payments and refunds), T6 payload walker (every money key has a sibling `currency`; no top-level money field), T7 (each money cell shows a code; no element renders a total across currencies), T5 (export list) |
| **AC-49** | T3 (ILS payment, USD fee); T7 (fee line and note); QA: check 9 summed per fee currency |
| **AC-50** | T3 (refund with no payment in the window; `pending` refund not completed) |
| **AC-51** | T1 (injected small ceiling → `reachedCeiling`); T3 (flags, net null); T4 (status `partial`); T7 ("At least", net "Unknown (a read was cut off)", notice) |
| **AC-52** | T3 (`empty`, `ok`); T7 (both sentences, no currency line, no `0.00`) |
| **AC-53** | T3 (unreadable and other-status counted, never 0); T7 (the counts in words) |
| **AC-54** | T3 (sort, cap 200 of 201, NULL id, platform); T4 (names only for shown ids from rows read); T7 ("Showing 200 of 201", "Platform account", "Unknown business"); no "Deleted business" string anywhere (T5 grep over the 2a files) |
| **AC-55** | T1 (no `livemode` argument on any 2a query); T5 (method-body rule, planted); T7 (no test-mode text in the block) |
| **AC-65** (2a) | T4 and T6: R-e′ and R-f′ receive exactly the id; R-e and R-f zero calls; names at most `[accountId]` |
| **AC-66** (2a) | T4 and T6: R-e fails → takings `unknown`, every slice-1 section still renders, 200; R-f fails → refunded and net Unknown, gross shown, `partial`; T7 renders both |
| **AC-68** | T7: `StatusChip` with words, table constants on number cells, currency on every money cell, "Unknown" / "—" for missing, `AdminNotice`, `AdminEmpty`, `aria-label` and `scope="col"`; the KPI strip still renders exactly five tiles |
| **AC-69** | T6: the info line carries `sections.takings` and `counts.takings` (counts and booleans only); a planted amount (`9876.54`), a currency code and a business name appear in no log call; T1: the repository info line carries no amount or id |
| **AC-70** | T5 write-verb pins over the new files; T1 no-write pin unedited; V-9 `git diff --stat` shows no `supabase/migrations` path |
| **AC-71** | V-3 to V-6: every §12.2 slice-2 row, the three Stripe guards unchanged, AC-31's list re-run, results pasted |
| **AC-72** | V-8: scoped `tsc` with a canary planted in `takings.ts` |
| **AC-73** (2a) | QA manual steps L-23 to L-29 below |

---

## Verification plan

The worktree has the `node_modules` junction. Never `git worktree remove`, never `git stash`, never `npm install` through the junction.

Before SA code review, Dev runs these and pastes the command, exit code and counts. Exit codes are read from the tool itself, never from a pipe (schema-check skill, Rule 7).

| # | Command | Evidence |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Suites and tests passed |
| V-2 | **Businesses-list suites:** `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | Pass; diff exit 0 (2a touches none of them) |
| V-3 | `npm run test:bos-entitlements` | Exit 0 (enforcementPoints, tier literal, RC-15, ledger and lot caller lists, the finance repository test) |
| V-4 | `npm run test:authz-guard` | Exit 0 |
| V-5 | **Guards, run unchanged:** `npx jest app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts lib/payments/__tests__/planSurfaces.guard.test.ts lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts app/admin/components/layout/__tests__/layoutFolder.guard.test.ts lib/business-os/credits/__tests__/serviceColumn.guard.test.ts lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci` and `git diff --exit-code` on each of those test files | Pass; no guard file edited except the finance source guard |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint <every touched and new file>` | Clean |
| V-8 | **Scoped `tsc` with a canary (AC-72)**, procedure below | Canary TS2322 reported, then the clean run |
| V-9 | `git diff --stat`, read before the diff | No deletion-only file, no `supabase/migrations` path, no shared layout file, no line count drop in the requirement |
| V-10 | `npm run schema:check` if the worktree has credentials; otherwise the SA-W27 note | Output or the note |
| V-11 | **Read-only SQL checks 7, 8 and 9 for the user** (§13), at QA time | See the table below |

**V-8 procedure** (SA-WR-7). Write a tsconfig **outside the worktree**, in the session scratchpad, with an absolute `extends` to the worktree's `tsconfig.json`, `compilerOptions: { noEmit: true, incremental: false }`, and `include` = the worktree's `types/**/*.d.ts` plus every touched and new `.ts` / `.tsx` file (absolute paths). Plant `const __canary: number = 'x';` in `lib/business-os/finance/takings.ts`. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>` and record its own exit code. It **must** report TS2322 at the canary, or the run is not evidence. Remove the canary, re-run, and record every diagnostic: zero in touched files, and any pre-existing one attributed by path (1a found three outside the diff). The scratch config is never written into the worktree.

**V-11, the user's read-only SQL checks.** Run in the Supabase SQL editor, with the page on "This month" and "All businesses":

| Check | Page figure | Match |
|---|---|---|
| 7 | Takings per currency: payments, gross, businesses | payments = `succeeded_rows + refunded_rows`; gross = `gross`; businesses = `businesses_counted` (after the SA-W18 edit; equal to `businesses` while `other_status_rows` is 0); "other status" = `other_status_rows` |
| 8 | Refunds per currency; refunded; not completed | `succeeded_rows`, `refunded`, `not_completed_rows`; `refunded_minor` = `refunded × 100` for USD and ILS |
| 9 | Fee lines | per `fee_currency`, Σ `fees` over its rows equals the page's fee line; Σ `rows_with_fee` equals "recorded on N" |

**Manual QA steps (AC-73, continuing from 1b's L-22).** `npm run dev` from `neuronforge-finance-health`, signed in as a platform admin.

| # | Step | Expected |
|---|---|---|
| L-23 | Open `/admin/finance` | "Takings through the platform" sits directly under "Our revenue", with the "Not our revenue" chip, its subtitle (UTC, "Covers businesses that still exist") and its own status |
| L-24 | Read the block for This month; run checks 7 to 9 | Every row of V-11 matches; one line per currency (USD, ILS), no line adds two currencies, no test-mode wording |
| L-25 | Look at the fees | Fees appear on the USD fee line only, including the fees of ILS payments; net is not reduced by any fee |
| L-26 | Switch to 30d, then a custom range | The figures follow the window; the URL changes in place |
| L-27 | Pick one business, then reload the URL | The block narrows to that business ("Businesses with takings" 1 or 0); the reload reproduces the view |
| L-28 | As a non-admin, then signed out, call `/api/admin/business-os/finance` | 403 / 401, `no-store`, no figures |
| L-29 | Read the dev-server log | One "Admin read the Business OS finance page" line with `sections.takings`, `counts.takings` (counts only) and `durationMs`; no amount, currency total or name. **Record `durationMs` (SA-Q17)** |

---

## Logging

- **New lines:** R-e / R-f `info` `{ method, rows, reachedCeiling, durationMs }`; R-e′ / R-f′ `debug` `{ method, rows, reachedCeiling }`; repository guard refusals `warn` (existing `fail`); builder read failures `error` `{ read: 'client_payments' | 'client_refunds' | 'takings_names', err }` through the existing `failed`.
- **The route's accountability line** gains `sections.takings` and `counts.takings`. Counts and booleans only.
- **Never logged:** an amount, a fee, a currency total, a currency code list, a business name, an email, an account id at info (the route's validated `accountId` filter is the existing exception, as in slice 1).
- Errors as `{ err }`. No `console.*` (T5 and T8 pin it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A float error makes a sum off by a cent | Integer hundredths only, through `toUnits`; the whole-hundredths test; a safe-integer check; T2 cases `0.1 + 0.2` and 10^10 |
| R-2 | A cross-currency total slips into the payload or the page | Export-list pin, payload walker (AC-48), render check, review |
| R-3 | A guard trips that §12.2 does not list (the 1a SA-W2 lesson) | Every guard that scans the finance files, the repositories folder or the payment tables was opened and is in the guard table; V-3 to V-5 run them all |
| R-4 | Net shown on a lower bound | One rule (`net` only when exact), tested on every cause (AC-51, R-f failure, SA-W20) |
| R-5 | The SQL checks and the page disagree on "counted" | SA-W18 BA edit; identical today (`other_status_rows` 0, LC §3) |
| R-6 | Route latency with two more reads | They run concurrently in the existing `Promise.all`; 110 + 41 rows today; `durationMs` recorded (L-29); the SA-Q8 split rule stands |
| R-7 | Client data travels | Exact column lists without `contact_id` / `metadata` (T1); the payload carries ids, amounts and counts only |
| R-8 | The junction | Never `git worktree remove` or `git stash`; stop rather than `npm install` |
| R-9 | The requirement file is rewritten whole and loses lines (the 1a / 1b lesson) | Targeted in-place edits only; line count checked (at least 1,425) and `git diff --stat` read after each edit |

---

## Estimate

About **2.5 days**, as the requirement sets (§11A.0).

| Day | Work |
|---|---|
| 0.5 | R-e to R-f′, header, barrel, T1 (V-1 green on the repository first) |
| 1.0 | `currencyGroups.ts` + T2; `takings.ts` + T3 |
| 1.5 | Builder, wiring, types, route info line; T4, T6 |
| 2.0 | `TakingsSection.tsx`, `FinanceSection` badge, `formatMoney`, copy, view order; T7; the finance source-guard edits (T5) |
| 2.5 | V-1 to V-10, the canary run, fixes; results pasted; requirement §0.1 status |

If day 2 ends with V-1 not green, I report it to TL then (SA: "report at the end of day 2 if it slips").

---

## Task List

- ✅ 0. SA workplan review (APPROVED WITH CONDITIONS); rulings SA-W18 to SA-W27 applied, SA-WR-14 to SA-WR-19 built in
- ✅ 1. Branch `feature/bos-finance-health-2` confirmed (`git branch --show-current`); junction present; nothing committed
- ✅ 2. R-e, R-e′, R-f, R-f′, column constants, limits, header; barrel exports; T1 (pins unedited, `:92` per SA-W23; new SA-WR-19 test)
- ✅ 3. `currencyGroups.ts` + T2 (AC-13)
- ✅ 4. `takings.ts` + T3 (AC-47 method, AC-48 to AC-54, SA-W18 to SA-W21, SA-WR-14, SA-WR-15)
- ✅ 5. `financeTypes.ts`; `financeHealth.ts` (reads, section, names, counts); `financeHealthDeps.ts`; T4 (AC-65, AC-66)
- ✅ 6. Route info line and header; T6 (AC-45, AC-46, AC-65, AC-66, AC-69, payload walker)
- ✅ 7. `FinanceSection` badge; `TakingsSection.tsx`; `FinanceView` order; `financeCopy.ts`; `formatMoney`; T7 (AC-48, AC-51 to AC-55, AC-68, SA-WR-17, SA-WR-18)
- ✅ 8. Finance source guard: narrow `:86-88`, the positive table pin (SA-WR-16), the `livemode` method-body rule, `exchange_rates`, export list, wording, processor literal, money arithmetic (SA-WR-18), non-vacuity; planted controls (T5)
- ✅ 9. V-1 to V-10, outputs pasted in Implementation Notes
- ⬜ 10. Requirement §0.1 status and Change History at hand-over: **not done by Dev** (the BA is editing the requirement in parallel, E-8 to E-10; TL instruction: Dev does not edit it this round)
- ⬜ 11. Hand over to SA code review, uncommitted

---

## Implementation Notes

**Dev, 2026-10-11.** All code uncommitted on `feature/bos-finance-health-2`. No migration, no write, no LLM call, no audit entry, no new query parameter.

### Files

| File | Action | Lines (now) | Diff |
|---|---|---|---|
| `lib/business-os/finance/currencyGroups.ts` | create | 113 | new |
| `lib/business-os/finance/takings.ts` | create | 300 | new |
| `app/admin/finance/components/TakingsSection.tsx` | create | 340 | new |
| `lib/business-os/finance/__tests__/currencyGroups.test.ts` | create | 127 | new |
| `lib/business-os/finance/__tests__/takings.test.ts` | create | 393 | new |
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | modify | 457 | +236 / −8 |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | modify | 507 | +215 / −2 |
| `lib/repositories/index.ts` | modify | 365 | +13 / −2 |
| `lib/business-os/finance/financeTypes.ts` | modify | 337 | +94 / −0 |
| `lib/business-os/finance/financeHealth.ts` | modify | 673 | +125 / −7 |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | 131 | +12 / −1 |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | modify | 1,047 | +238 / −0 |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | modify | 350 | +168 / −1 |
| `app/api/admin/business-os/finance/route.ts` | modify | 188 | +9 / −1 |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | 633 | +129 / −1 |
| `app/admin/finance/components/FinanceSection.tsx` | modify | 88 | +24 / −4 |
| `app/admin/finance/components/FinanceView.tsx` | modify | 104 | +5 / −2 |
| `app/admin/finance/financeCopy.ts` | modify | 230 | +74 / −2 |
| `app/admin/finance/financeFormat.ts` | modify | 35 | +13 / −1 |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify | 673 | +281 / −1 |

The requirement MD was **not** touched by Dev (the BA's E-8 to E-10 edits are the only change in it).

### Where each SA ruling landed

| Ruling | Where |
|---|---|
| SA-W18 / **SA-WR-15** | `takings.ts` `isCountedPayment` / `isCompletedRefund`: `status === 'succeeded' \|\| status === 'refunded'` on the stored value, no trim, no case change. T3 `it.each` over `Succeeded`, `' succeeded'`, `'succeeded '`, `REFUNDED`, `null` (payments) and `Succeeded`, `' succeeded'` (refunds): all "another status" / "not completed" |
| SA-W19 | `takings.ts`: lines from one `groupByCurrency` over counted payments AND succeeded refunds; rows keyed `(user_id, currency)` over both. T3 refund-only currency (EUR: payments 0, gross 0, net −5) and refund-only business |
| SA-W20 / **SA-WR-14** | Unreadable payment or refund amount → that line's and that row's net null, block `partial`; unreadable fee → left out of its fee line, counted (`unreadableFees`), block `partial`, net unchanged. T3 tests each cause on its own plus a readable control. The SA-W20 cell above is corrected |
| SA-W21 | Processor key trimmed + lower-cased in `takings.ts` (no literal); labels in `financeCopy.ts` `PROCESSOR_LABELS`; T5 rule: no `'stripe'` / `'manual'` literal in any `lib/` finance file (planted control) |
| SA-W22 | `takings.ts` declares `TakingsPaymentInput` / `TakingsRefundInput`; imports nothing from a repository. One-caller pin unedited and green |
| SA-W23 | Only the `FINANCE_READ_LIMITS` equality changed (four keys). No-write, no-aggregate, writer-name and one-caller pins byte-identical |
| SA-W24 / **SA-WR-17** | `FinanceSection` optional `badge`, rendered with the shared `StatusChip` (`testId` `section-<id>-badge`) beside the heading in every state; no badge → the old DOM. T7: chip in `ok`, `partial`, `unknown`; Accounts, AI cost, Credits have no badge and no `[data-tone]` |
| SA-W25 | Section 3 untouched; `toHundredths` converts through `toUnits(value, 100)` and runs the whole-hundredths test on the same parsed `n` (see D-1) |
| SA-W26 / **SA-WR-18** | Sums are integer hundredths; `toMoney = h / 100` once in `takings.ts`. `formatMoney` uses `minimumFractionDigits = maximumFractionDigits = 2` with grouping. T7: `(10 + 20) / 100` → `USD 0.30`; `1234567890123 / 100` → `USD 12,345,678,901.23`; `EUR -5.00`; `ILS -1,234.50`; `Unknown currency 12.00`. T5 rule: no `app/admin/finance` file adds or subtracts two money fields (`gross` / `refunded` / `net` / `fees`), with planted controls |
| SA-W27 | `npm run schema:check` not run: the worktree has no `.env.local` (only `.env.example`), so there are no credentials. Columns stand on LC §1 |
| **SA-WR-16** | T5: `fromCallsOf(code)` (every `.from(`) must equal `tablesOf(code).length` (literal matches) in the comment-stripped repository, then the unique set equals the five tables. Planted control: `this.supabase.from(TABLE)...` gives 2 calls and 1 literal, so the counts differ |
| **SA-WR-19** | New test in T1 (`slice 2a: the payment writers are named in words only`): the repository source contains none of `PaymentRepository`, `PaymentRefundRepository`, `PaymentPlanSubscriptionRepository`, the names built from parts; planted control. The header names them in words ("the client payment repository, the refund repository and the client plan repository") |

### Deviations

| # | Deviation | Why |
|---|---|---|
| D-1 | **Whole-hundredths tolerance widens with magnitude:** `abs(n·100 − round(n·100)) <= max(1e-6, abs(n·100) · 4ε)` instead of a flat `1e-6` (S2-CUR-3). Identical to `1e-6` below about 1.1e9 hundredths (11 million in any currency). | Measured: with a flat `1e-6`, about 12% of valid two-decimal values up to 1e10 (refunds are `NUMERIC(12,2)`, max 9,999,999,999.99) are wrongly "unreadable" through float rounding alone, e.g. `5344746814.64 × 100` is off by 6.1e-5. Payments (`DECIMAL(10,2)`, max 99,999,999.99) are unaffected (0 of 200,000 random values). The widened tolerance stays a few ulps, far below the 0.5 of a third decimal, so `9999999999.995` and `12.345` are still unreadable. T2 pins both. **SA to confirm**; reverting to a flat `1e-6` is a one-line change. |
| D-2 | `CurrencyLine` gained `unreadable: Record<F, number>` and `overflow: boolean`; `groupByCurrency` entries accept `hundredths: number \| null`. Export list unchanged (four runtime names + the type). | An unreadable amount must still create its line and be counted on it (SA-W20: "net Unknown on that line"), and the planned safe-integer check needs a place to report an overflow without being silent. |
| D-3 | The four public methods delegate to one private `pageClientRows`, each passing its own `() => this.supabase.from('<literal>').select(<columns>)`. | One paging implementation; the literal `.from(` stays in each public method, so the SA-WR-16 count rule holds. The T5 `livemode` body rule scans the four methods **and** `pageClientRows`. |
| D-4 | `TakingsSection.tsx` imports its wire types on ONE line. | The page guard (`app/admin/finance/__tests__/source.guard.test.ts:44-52`) checks the `from` line itself starts with `import type`; a wrapped import fails it. |
| D-5 | Extra T5 rules beyond the guard table: no processor literal in the finance `lib/` (SA-W21) and the money-arithmetic rule (SA-WR-18). Both have planted controls. | The SA conditions asked for them. |

### Verification (real output)

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | exit 0; **14 suites, 838 tests passed** |
| V-2 | `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`; `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | exit 0; **21 suites, 530 tests passed**; diff exit 0 |
| V-3 | `npm run test:bos-entitlements` | exit 0; **235 suites, 6,638 tests passed** |
| V-4 | `npm run test:authz-guard` | exit 0; **2 suites, 203 tests passed** (Jest's "worker failed to exit gracefully" notice, no failure) |
| V-5 | The three Stripe guards, `paymentTablesWriteLockdownMigration`, `adminReadMethods.guard`, `AdminJobsQueuesRepository`, `layoutFolder.guard`, `serviceColumn.guard`, `lib/admin/health`, `AdminSidebar.nav`, run unchanged; `git diff --exit-code` on all of them | exit 0; **14 suites, 746 tests passed**; diff exit 0 (no guard file edited but the finance source guard) |
| T5 alone | `npx jest lib/business-os/finance/__tests__/finance.source.guard.test.ts --ci` | **317 tests passed** (inside V-1) |
| V-6 | `npm run lint:hooks` | exit 0 |
| V-7 | `npx eslint` on the 20 touched and new `.ts` / `.tsx` files | exit 0, no output |
| V-8 | Scoped `tsc`: config in the session scratchpad (absolute `extends`, `noEmit`, `incremental: false`, `include` = `types/**/*.d.ts`, `next-env.d.ts` and the 20 files). Canary `const __canary: number = 'x';` appended to `takings.ts` | Canary run: `lib/business-os/finance/takings.ts(301,7): error TS2322` reported. Canary removed (`grep -c __canary` = 0). Clean run: **0 errors in touched files**; 3 pre-existing errors outside the diff, pulled in transitively: `lib/pilot/insight/MemoryManager.ts(60,48)` TS2769, `(126,40)` TS2339, `lib/repositories/CalibrationSessionRepository.ts(315,7)` TS2741 |
| V-9 | `git status --short`, `git diff --stat` | 15 code files modified + the BA's requirement edit, 5 new code files; 2,167 insertions / 42 deletions overall; no deletion-only file; no `supabase/migrations` path; no shared layout file |
| V-10 | `npm run schema:check` | Not run: no credentials in the worktree (SA-W27 note) |
| V-11 | SQL checks 7 to 9 | For QA, after the BA's E-8 edit |

**`console.*`:** 0 in every touched file. The one match, `finance.source.guard.test.ts`, is the pre-existing guard pattern `/\bconsole\./`, not a call.

### Not done

- Task 10 (requirement §0.1 status and Change History): left for the BA / TL, per the instruction not to edit the requirement this round.
- V-11 and L-23 to L-29: QA.

### Fix round 1 (2026-10-12)

SA approved, D-1 included. QA returned PASS WITH ISSUES, with no bugs. Three Low fixes, all uncommitted:

| Item | Fix | Test |
|---|---|---|
| **QA-2** (`TakingsSection.tsx` gross) | `FinanceTakingsLine` and `FinanceTakingsRow` gain `unreadablePayments` (unreadable PAYMENT amounts only; `takings.ts` fills it from the gross side). Gross reads "At least …" when the payments read was cut off **or** `unreadablePayments > 0`, on lines and on rows. Net stays plain "Unknown" | `Fixed by Dev:` T7 adds two cases. (1) An unreadable payment gives "At least USD 150.50" on the line and "At least USD 150.00" on the row, net "Unknown", and the other line stays plain. (2) An unreadable refund only leaves gross plain. T3 pins `unreadablePayments` 0 for an unreadable refund. Existing literals gain the field |
| **SA-1** (net text) | `readCutOff` is now `!paymentsExact` or `refundsState === 'partial'`. A FAILED refunds read gives net plain "Unknown"; "Unknown (a read was cut off)" is shown only for a ceiling | `Fixed by Dev:` T7's refunds-failed case now asserts two plain "Unknown" (refunded and net) and no cut-off text anywhere in the block. The ceiling cases still assert the cut-off text |
| **SA-2 / QA-3** (`BusinessOsFinanceReadRepository.ts` log) | The pager's message comes from its date column: refund reads log "Client refund rows of all accounts read" / "… of one account read"; payment reads are unchanged | `Fixed by Dev:` T1's log test now asserts the exact message for each of the four reads (no test asserted it before) |

**Re-run (real output):**
- Finance suites (V-1): exit 0, 14 suites, 840 tests.
- Narrowed finance source guard plus the repository test: exit 0, 2 suites, 410 tests.
- Businesses-list suites (V-2): exit 0, 21 suites, 530 tests; `git diff --exit-code` 0.
- `test:bos-entitlements`: exit 0, 235 suites, 6,638 tests.
- `test:authz-guard`: exit 0, 2 suites, 203 tests.
- `lint:hooks`: exit 0. ESLint on the 20 touched code files: exit 0.
- Scoped `tsc` (config in the scratchpad): the canary is caught at `takings.ts(307,7)` TS2322, then removed. The clean run has 0 errors in touched files and the same 3 errors outside the diff (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts` ×1).

---

## SA Workplan Review

**Reviewed by SA — 2026-10-11, against `a66b4c41`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed to implementation, applying SA-WR-14 to SA-WR-19 as you build. No re-review of the workplan is needed; SA checks them at code review. BA applies E-8 to E-10 below. Coding does not wait for them, but V-11 and QA do.

**How it was checked.** I opened the cited files:
- `BusinessOsFinanceReadRepository.ts:144, 177, 203, 208`: the only `.from(` calls today, three layer-A tables;
- its test: the recording client at `:52`, the `FINANCE_READ_LIMITS` equality at `:92`, the no-write, no-aggregate and writer-name pins, and the one-caller pin at `:268-292`. The one-caller pin is a case-sensitive text match on `BusinessOsFinanceReadRepository`, so a file that imports nothing from the repository stays off it;
- `finance.source.guard.test.ts:39-46, 86-88`;
- `paymentTablesWriteLockdownMigration.test.ts:306-372`: it flags only a write verb within 200 characters after `.from('<table>')`, in browser modules or user-cookie server files;
- `adminReadMethods.guard.test.ts:479-490`, an explicit list;
- `layoutFolder.guard.test.ts:81-98`;
- `creditReport.ts:136-139`: `toUnits` accepts a number or a numeric string;
- requirement check 7 as it stands now: `count(*)` and `count(distinct t.user_id)` over every status.

**Confirmed:**
- **R-e to R-f′:** named pairs; UUID refused before any query; `.eq('user_id')` on every page; keyset on `id` with `.gt` as its own filter; page 1,000; ceiling 5,000 with the `>=` rule, returning rows plus `reachedCeiling` ("At least"); no `livemode`; no status filter; exact column lists with no client data; never throw.
- **Guards really not tripped:** the three Stripe guards, the payment write-lockdown scan, `adminReadMethods`, `AdminJobsQueuesRepository`, the layout folder guard, and the entitlements suite (no new import from the module).
- **The `finance.source.guard` plan is right:** the narrowing, the positive table pin, the `livemode` method-body rule, and the planted negative controls.
- **The AC mapping is complete:** AC-13, AC-45 to AC-55, AC-65, AC-66 and AC-68 to AC-73.
- **Scoped `tsc`:** the canary goes in `takings.ts`, with the scratch config outside the worktree.
- **The 2.5-day estimate is accepted.**

### Rulings SA-W18 to SA-W27

| # | Ruling |
|---|---|
| **SA-W18** | **Approved.** Every 2a figure is computed over counted payments (succeeded or refunded). Match the status **exactly**, with no trim and no case change, so that the page and SQL check 7 cannot differ (SA-WR-15). BA edit **E-8**. |
| **SA-W19** | **Approved.** Lines and table rows are the union of the keys from counted payments and from succeeded refunds. A refund-only line shows payments 0, gross 0.00, its refunded amount and a negative net. "Businesses with takings" counts only businesses with a counted payment. BA edit **E-9**. |
| **SA-W20** | **Approved, with one correction (SA-WR-14).**<br>• An unreadable payment or refund amount: that line's net, and the net of the affected rows, is "Unknown"; the block is `partial` with the count.<br>• An unreadable **fee** is left out of its fee line and counted, and it **does** make the block `partial`, because that fee line is then a lower bound. This is what your failure matrix and status rule already say. The SA-W20 cell's "changes neither net nor the block status" is wrong about the status.<br>BA edit **E-10**. |
| **SA-W21** | **Approved.**<br>• Count per stored value, trimmed and lower-cased.<br>• Labels live only in `financeCopy.ts`; any other value is shown as its text, and NULL or empty reads "Not recorded".<br>• No processor literal in `lib/`. |
| **SA-W22** | **Approved, verified.** `takings.ts` declares its own structural input types, so the one-caller pin stays byte-identical. |
| **SA-W23** | **Approved.** Edit only the `:92` equality to the four keys. The no-write, no-aggregate, writer-name and one-caller pins stay byte-identical. |
| **SA-W24** | **Approved.** `FinanceSection` gets an optional `badge` prop, rendered with the shared `StatusChip` beside the heading in every state, including `unknown`. Existing sections pass nothing and their DOM is unchanged (SA-WR-17). This is page-local, not DF-4. |
| **SA-W25** | **Approved.** (a) Section 3 is unchanged in 2a; CUR-5 waits for slice 6. (b) Convert through `toUnits(value, 100)`, which accepts a number or a numeric string. The whole-hundredths test uses the same parsed `n`. |
| **SA-W26** | **Approved, and safe.** Sums are integer hundredths. Each figure is divided by 100 once; the result is the nearest double to an exact two-decimal value, and formatting with exactly two decimals prints it exactly at these magnitudes (below 2^53 / 100). Conditions (SA-WR-18): the page never adds or subtracts money (net comes from the server), and `formatMoney` uses a fixed two-decimal format. |
| **SA-W27** | **Accepted.** LC §1 (live OpenAPI, 2026-10-11) lists every selected column. Run `schema:check` if credentials exist and record the result or the note. |

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-14 (Medium).** Correct the SA-W20 cell in this workplan: an unreadable fee makes the block `partial` and is named in the fee note. It never changes net. Test both causes of `partial` separately.
2. **SA-WR-15 (Low).** The "counted" test is `status === 'succeeded' || status === 'refunded'` on the stored value, and a refund counts only when `status === 'succeeded'`, matching checks 7 and 8 exactly. Any other value, including a padded or upper-case one, is "other status" and is counted as such.
3. **SA-WR-16 (Low).** Make the positive table pin airtight:
   - assert that the number of `.from(` calls in the comment-stripped repository equals the number of string-literal matches, so a `.from(TABLE)` cannot escape;
   - add a planted control with a non-literal argument.
4. **SA-WR-17 (Low).** Render tests for the badge:
   - the chip "Not our revenue" shows in `ok`, `partial` and `unknown`;
   - the Accounts, AI cost and Credits sections render no chip.
5. **SA-WR-18 (Low). `formatMoney`:**
   - fixed two decimals (`minimumFractionDigits` = `maximumFractionDigits` = 2) with a thousands separator;
   - tests: 0.1 + 0.2 summed in hundredths renders "USD 0.30"; 12,345,678,901.23 renders exactly; a negative net renders with a minus sign and its code;
   - a source rule that no `app/admin/finance` file adds or subtracts two money fields.
6. **SA-WR-19 (Low).** The repository header names the payment writer and owner-scoped repositories in words only. Add one **new** test, not an edit of the existing writer-name pin, asserting that the file does not contain `PaymentRepository`, `PaymentRefundRepository` or `PaymentPlanSubscriptionRepository`. Build the strings from parts, as the existing pin does.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-2a)

- **E-8 (SA-W18).**
  - In §13 check 7, add a comment line after the third: `-- The page counts payments and businesses over succeeded and refunded rows only.`
  - Replace the `gross` line and the line after it with:

    ```sql
      sum(t.amount) filter (where t.status in ('succeeded', 'refunded')) as gross,
      count(*) filter (where t.status in ('succeeded', 'refunded')) as counted_payments,
      count(distinct t.user_id) filter (where t.status in ('succeeded', 'refunded')) as businesses_counted,
      count(distinct t.user_id) as businesses
    ```

  - The text stays ASCII, with no apostrophe and no "into", and one result set.
  - **AC-47:** replace "payments, gross, businesses (check 7)" with "counted payments, gross and businesses (check 7 `counted_payments`, `gross`, `businesses_counted`)".
  - **S2-FR-2:** "payments (count)" becomes "payments (count of counted payments: succeeded or refunded)".
- **E-9 (SA-W19).**
  - **S2-FR-2:** append "Lines are the currencies with a counted payment or a succeeded refund in the window; a refund-only line shows payments 0, gross 0.00 and a negative net."
  - **S2-FR-7:** after "one row per business and currency", add "(from counted payments and succeeded refunds)".
  - **S2-FR-8:** the first sentence becomes "No counted payment and no succeeded refund in the window → no currency line; with no counted payment the block says 'No client payments recorded in this window'".
- **E-10 (SA-W20).** Append to S2-CUR-3: "An unreadable payment or refund amount makes that currency line's net, and the net of the affected per-business rows, 'Unknown', and the block `partial` with a notice. An unreadable fee is left out of its fee line and counted in the fee note; it makes the block `partial` but never changes net."

---

## SA Code Review

**Code Review by SA — 2026-10-11**
**Status:** ✅ **APPROVED. Code approved for QA.** Nothing blocks QA. The two Low notes below are optional.

**How it was checked.** I read every changed and new file: 15 modified and 5 new.

**My own runs (all green):**
- finance lib, page and route, `BusinessOsFinanceReadRepository.test.ts`, the narrowed source guard, the three Stripe guards, `paymentTablesWriteLockdownMigration`, and the shared layout folder: 34 suites, 1,381 tests;
- `test:bos-entitlements`: 235 suites, 6,638 tests;
- `test:authz-guard`: 203 tests;
- `git diff --exit-code` on `app/api/admin/users`, `app/admin/users` and `lib/business-os/credits` exits 0, so the Businesses list is unchanged.

### Deviations

| # | Ruling |
|---|---|
| **D-1** | **Approved: correct, and the simplest safe rule.**<br>**The error is bounded.** `n` is the double nearest to a two-decimal value `d`, so `n = d(1+δ₁)`, and `n·100` rounds once more, `(1+δ₂)`, with `abs(δ) ≤ ε/2` each. The error of `n·100` against the exact `100d` is therefore at most about `abs(n·100)·ε`, and the tolerance `max(1e-6, abs(n·100)·4ε)` covers it with a 4× margin.<br>**A third decimal is still caught.** It sits at least 0.1 hundredths from an integer, and at the column maximum (about 1e12 hundredths) the tolerance is about 9e-4.<br>**Below about 1.1e9 hundredths the rule is the flat 1e-6.**<br>**Why not parse the string?** Parsing the decimal string exactly would need PostgREST to send strings, which it does not for these columns; the string path already goes through the same `toUnits`.<br>T2 pins `12.345`, `9999999999.995`, a 1e10 value and `0.1 + 0.2`. |
| **D-2** | **Approved.** `unreadable` and `overflow` on `CurrencyLine` are what make SA-W20 and the safe-integer check visible. The export list is unchanged and still has no cross-currency total. |
| **D-3** | **Approved.** One private pager. Each public method keeps its own literal `.from('<table>')`, and the `livemode` body rule also scans `pageClientRows`. |
| **D-4** | **Approved.** Required by the page guard's single-line `import type` check. |

### Required changes and checks

| Item | Verdict |
|---|---|
| **SA-WR-14** | ✅ An unreadable fee is left out of its fee line and counted, and makes the block `partial` (`takings.ts:269`). Net is unchanged. Each cause is tested on its own. |
| **SA-WR-15** | ✅ `status === 'succeeded' \|\| status === 'refunded'`, and refunds need `=== 'succeeded'`, with no trim and no case change (`takings.ts:94-95`). Padded and capitalised values are tested as other status. |
| **SA-WR-16** | ✅ `fromCallsOf(code) === tablesOf(code).length`, and the set equals the five tables. The planted `.from(TABLE)` gives counts of 2 against 1. |
| **SA-WR-17** | ✅ The chip shows in `ok`, `partial` and `unknown`. The other sections have no badge and no `[data-tone]`. |
| **SA-WR-18** | ✅ `formatMoney` uses a fixed two decimals with grouping. Tests cover `USD 0.30`, `12,345,678,901.23` and negatives. The no-money-arithmetic rule has planted controls. |
| **SA-WR-19** | ✅ A new test checks that the three payment writer class names are absent, building the names from parts. The header names them in words only. |
| **Negative controls** | ✅ Present for every new rule: table extractor, non-literal `.from`, a planted extra table, the `livemode` body slicer (and layer A still matches), `exchange_rates`, wording, processor literal, and money arithmetic. |

**Also verified:**
- **Picked business.** R-e′ and R-f′ get exactly the id. The UUID is refused before any query, and `.eq('user_id')` is applied on every page. R-e and R-f get zero calls, and names come only from rows read. This is tested in the builder and through the route.
- **Currency.**
  - No sum across currencies: separate `groupByCurrency` lines.
  - Fees are grouped by `fee_currency`.
  - Codes are trimmed and upper-cased; anything not three letters goes to Unknown.
  - Refund-only lines and rows follow E-9.
  - Counted payments match the new check 7 (E-8).
- **Reads.** Ceiling 5,000 with the `>=` rule, returning rows plus "At least", and net "Unknown" whenever a read was cut off. There is no `livemode` on layer B.
- **Route.** `requireAdmin` is still first. Pino logs carry counts and booleans only, with no amount or currency.
- **Tenant headers.** The repository header documents the layer-B pairs, the service role and BD-13. `git diff --stat` shows no migration path.

### Code Review Comments

1. `app/admin/finance/components/TakingsSection.tsx:136, 141`: when the refunds read **failed**, net reads "Unknown (a read was cut off)". S2-FR-8 says plain "Unknown" in that case, and the notice "Refunds could not be read" already explains it. **Optional fix:** use `readCutOff` only for the ceilings (`!f.paymentsExact || f.refundsState === 'partial'`). Priority: **Low**.
2. `lib/repositories/BusinessOsFinanceReadRepository.ts` (`pageClientRows`): the info and debug messages say "Client payment rows…" for the refund reads too. The `method` field tells them apart. **Optional:** use "Client payment or refund rows…". Priority: **Low**.

### Code Approved for QA: **Yes**

QA owes V-11 (checks 7 to 9 after E-8) and L-23 to L-29, including `durationMs`.

---

## QA Report

**QA — 2026-10-11**
**Test mode:** full (2a ACs)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 7 to 9 (QA does not run SQL against production). The steps for the user are L-23 to L-31 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every 2a AC that Jest can test passes. AC-47 and AC-73 (2a) wait on the user's manual check. Three Low notes, none blocking; D-1 still needs SA's confirmation.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-finance-health-2`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` (T1 to T8) | exit 0; **14 suites, 838 passed** |
| Q-2 | Businesses list: `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | exit 0; **21 suites, 530 passed**; diff **exit 0** (untouched) |
| Q-3 | Unchanged guards: the three Stripe guards (`routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`), `paymentTablesWriteLockdownMigration`, `adminReadMethods.guard`, `AdminJobsQueuesRepository`, `layoutFolder.guard`, `serviceColumn.guard`, `AdminSidebar.nav`, `lib/admin/health`; then `git diff --exit-code` on all of them | exit 0; **14 suites, 746 passed**; diff **exit 0** |
| Q-4 | The narrowed finance source guard plus the page source guard: `npx jest lib/business-os/finance/__tests__/finance.source.guard.test.ts app/admin/finance/__tests__/source.guard.test.ts --ci` | exit 0; **2 suites, 324 passed** |
| Q-5 | `npm run test:bos-entitlements` | exit 0; **235 suites, 6,638 passed** |
| Q-6 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | Scoped `tsc`. Config: `tsconfig.qa-2a.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 20 changed and new `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `takings.ts`): exit 2, `lib/business-os/finance/takings.ts(301,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: exit 2 with **0 diagnostics in changed or new files**. The 3 that remain are pre-existing and outside the diff (`MemoryManager.ts(60,48)` TS2769, `(126,40)` TS2339; `CalibrationSessionRepository.ts(315,7)` TS2741), the same three seen in 1a |
| Q-9 | `git diff --stat`, `git status --short` | 16 tracked files (+2,169 / −42), 7 new; no deletion-only file; no migration path |

### Test Coverage (2a ACs)

| AC | Result | Evidence |
|---|---|---|
| AC-13 | ✅ Pass | T2 (`currencyGroups.test.ts`): USD / `usd` / ILS / NULL → three lines, Unknown last; `" ils "` → ILS; `US`, `USDX` → Unknown; "is exactly the four runtime names" (no cross-currency total) |
| AC-45 | ✅ Pass | T6 "AC-45: the four takings reads are in allReads(), so every 401 / 403 / 400 case proves zero calls on them" plus the existing 401, 403 and `profiles.role` cases |
| AC-46 | ✅ Pass | T6 "AC-46: ?currency=USD → 400, no read"; the AC-4 / 33 / 34 cases re-run green |
| AC-47 | ⬜ NOT-TESTED (live) / ✅ method | T3 "payments, gross, businesses, other statuses; refunds, refunded, not completed; net per currency" (an independent check-7 / check-8 helper). Live match: L-24, L-25 |
| AC-48 | ✅ Pass | T2; T3 "USD, usd, ILS and NULL → three lines for payments and three for refunds"; T6 "every money key sits beside a currency, and no money key is top-level"; T7 "AC-48: every money cell names its currency; nothing adds two currencies"; T5 export list |
| AC-49 | ✅ Pass (Jest), live part manual | T3 "an ILS payment with a USD fee: the fee on the USD fee line only; net unchanged; recorded on 1 of 1"; T7 "AC-49". Check 9 match: L-26 |
| AC-50 | ✅ Pass | T3 "a succeeded refund with no payment in its currency → a line …"; `it.each` refund statuses → "not completed", amount left out |
| AC-51 | ✅ Pass | T1 small-ceiling `reachedCeiling`; T3 payments / refunds at the ceiling; T4 "the payments read at its ceiling → takings partial"; T7 both AC-51 render cases |
| AC-52 | ✅ Pass | T3 "no payment and no refund → empty, no line, no row, ok"; T7 "AC-52: an empty window → both sentences; no currency line and no 0.00" |
| AC-53 | ✅ Pass | T3 unreadable payment (12.345, NaN), unreadable refund, unreadable fee alone, other statuses `it.each`; T7 "AC-53 … counted in words" |
| AC-54 | ✅ Pass | T3 sort / NULL id / platform and "201 keys → 200 rows shown, rowsTotal 201"; T4 names only for the non-platform rows shown; T7 "AC-54 … never 'Deleted business'" |
| AC-55 | ✅ Pass | T1 no `livemode` on any 2a query; T5 method-body rule (planted control); T7 "AC-55: no test-mode label, note or switch" |
| AC-65 (2a) | ✅ Pass | T4 "exactly the id and the window range; zero all-accounts calls; names at most [id] …"; T6 "AC-65 through the route" |
| AC-66 (2a) | ✅ Pass | T4 R-e fails / R-e throws / R-f fails; T6 both through the route (200); T7 both render cases |
| AC-68 | ✅ Pass | T7 "AC-68: labelled tables with column headers, number cells right-aligned and tabular; the KPI strip still has exactly five tiles"; SA-WR-17 chip tests |
| AC-69 | ✅ Pass | T6 "AC-69: … no amount, currency code or name in any log call"; the repository info line carries counts only (`BusinessOsFinanceReadRepository.ts:442-447`) |
| AC-70 | ✅ Pass | T5 write-verb pins; T1 no-write pin unedited; Q-9 no migration |
| AC-71 | ✅ Pass | Q-3 (Stripe guards unchanged and green), Q-4, Q-5, Q-6 |
| AC-72 | ✅ Pass | Q-8 |
| AC-73 (2a) | ⬜ NOT-TESTED | Manual L-23 to L-31 below |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Multi-currency, never summed across currencies | Confirmed | `currencyGroups.ts:83-105` keeps one map entry per code; nothing adds two lines. The UI never adds money (T5 SA-WR-18 rule); T6 payload walker |
| Fee currency differs from charge currency | Confirmed | `takings.ts:193-210` groups fees by `fee_currency` only; fees never touch gross or net. T3 / T7 AC-49 |
| Lowercase or padded currency codes | Confirmed | `normaliseCurrencyCode` trims and upper-cases (`currencyGroups.ts:32-36`); `" ils "` → ILS; `US` / `USDX` / non-string → Unknown, never USD |
| Refund-only currency or business | Confirmed | Lines and rows are the union (`takings.ts:137-143, 241-246`): payments 0, gross 0.00, negative net; "businesses with takings" counts payers only. T3 SA-W19 |
| Unreadable amount or fee | Confirmed | An amount: excluded, counted, that line's and row's net `null`, block `partial` (`takings.ts:161, 263, 268-269`). A fee: excluded, counted, `partial`, net unchanged (`:196-198`). Never 0 |
| A third decimal | Confirmed | `toHundredths` returns null for `12.345` / `'12.345'`, and at the largest magnitude (`9999999999.995`). T2 |
| Very large amounts (D-1) | Confirmed, needs SA's confirmation | Tolerance `max(1e-6, |n·100|·4ε)` (`currencyGroups.ts:58`): equal to 1e-6 below about 1.1e9 hundredths; keeps valid `NUMERIC(12,2)` values readable; a third decimal is still caught. T2 pins both. Sums are checked for the safe-integer range (overflow flagged, `partial`). `formatMoney` prints 12,345,678,901.23 exactly (T7) |
| 5,000 ceiling, "at least" | Confirmed | `BusinessOsFinanceReadRepository.ts:432-434` `>=` → `reachedCeiling: true` with rows (not an error); gross and counts "At least", net "Unknown (a read was cut off)" (`TakingsSection.tsx:137-142`) |
| Empty data | Confirmed | `empty: true`, no line, status `ok`; both sentences, no `0.00` |
| Picked business | Confirmed | `financeHealth.ts` picks R-e′ / R-f′ when `accountId` is set; the repository adds `.eq('user_id')` on every page after a UUID check (`:401-403, :425`); R-e / R-f zero calls (T4, T6) |
| 200-row cap | Confirmed | `takings.ts:255` slice to `displayCap` (200); `rowsTotal` covers all; "Showing N of M" (T7) |
| One section fails, others render | Confirmed | Both reads `settle`d in the shared `Promise.all`; R-e throwing → takings `unknown`, everything else ok (T4) |
| No client data or money in logs | Confirmed | The column lists exclude `contact_id` / `metadata` (T1); `counts.takings` holds counts and booleans only; T6 planted amount / code / name absent from every log call |
| Two decimals, no float artefacts | Confirmed | Integer hundredths, divided by 100 once (`takings.ts:105`); `formatMoney` uses fixed 2 / 2 digits (`financeFormat.ts`); "USD 0.30" for 0.10 + 0.20 (T2, T3, T7) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found in code. Both reads run in the existing `Promise.all`; the takings names call is one extra request after the reads. `durationMs` is owed from the live run (L-31).

#### Edge Cases / notes (Low)
1. **D-1 widens the requirement's whole-hundredths tolerance** (`lib/business-os/finance/currencyGroups.ts:58`). S2-CUR-3 still says a flat `1e-6`. The change is sound and tested, but it needs SA's confirmation and a BA wording edit in S2-CUR-3, so the requirement and the code do not disagree. Low.
2. **A line's gross is shown as a plain figure when one of its payment amounts is unreadable** (`app/admin/finance/components/TakingsSection.tsx:137`). "At least" is driven only by the ceiling. The excluded amount is counted in a notice and net is "Unknown", as S2-CUR-3 asks, but the gross itself is then a lower bound without saying so. It cannot happen today (`DECIMAL(10,2)` columns). Low; a copy choice for SA.
3. **The refund reads log "Client payment rows …"** (`lib/repositories/BusinessOsFinanceReadRepository.ts:444, 447`). The `method` field tells them apart. Cosmetic. Low.

### Manual live steps (continuing from 1b's L-22): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for §13 checks 7 to 9 (read-only; QA did not run them). Page on **This month**, **All businesses** unless a step says otherwise.

| # | Step | Expected |
|---|---|---|
| L-23 | Open `/admin/finance` | "Takings through the platform" sits directly under "Our revenue" and above Accounts by plan. It shows the "Not our revenue" chip, the subtitle (client payments recorded by the businesses, window UTC, "Covers businesses that still exist") and its own status. No test-mode wording anywhere in the block |
| L-24 | **SQL check 7** vs "Takings per currency" (AC-47) | Per currency: Payments = `counted_payments`; Gross = `gross`, to the cent; Businesses = `businesses_counted`. "Payments with another status" = Σ `other_status_rows` (0 today). One line per currency (USD, ILS today); no line adds two currencies |
| L-25 | **SQL check 8** vs the refunds part (AC-47, AC-50) | Per currency: refunds = `succeeded_rows`; refunded = `refunded`; "not completed" = Σ `not_completed_rows`. Then on the takings line: Net = Gross − Refunded for that currency (do the subtraction by hand; the page does not) |
| L-26 | **SQL check 9** vs the fee lines (AC-49) | For each `fee_currency`, Σ `fees` over its rows = that fee line (today everything on USD, including fees of ILS payments). Σ `rows_with_fee` = "Fees recorded on N"; Σ `payment_rows` = "of M". Net is not reduced by any fee. The never-deducted note is shown |
| L-27 | Per-business table and processors | Rows sorted by currency, then gross highest first; every money cell names its currency; "Showing N of M" only if over 200 rows. Processor counts: Stripe and the manual label ("recorded by the business; no processor fee"); the counts add up to the counted payments |
| L-28 | Switch to 30d, then a custom range (e.g. the previous month) | The figures follow the window (re-run checks 7 and 8 with that range to spot-check); the URL changes in place |
| L-29 | Pick one business that has takings, then reload the URL | Only that business's rows; "Businesses with takings" is 1; lines and fees narrow to it. Spot-check by adding `and t.user_id = '<id>'` to check 7. The reload reproduces the view. A business with no takings shows "No client payments recorded in this window" |
| L-30 | Signed out and as a non-admin, call `/api/admin/business-os/finance` | 401 / 403 with `Cache-Control: no-store` and no figures |
| L-31 | Dev-server log | One "Admin read the Business OS finance page" line per load with `sections.takings` and `counts.takings` (counts and booleans only), plus the repository's "… of all accounts read" info lines with counts. No amount, currency code, name or email. **Record `durationMs`** for All businesses and for one business (target p95 under 2 s; SA-Q17) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every 2a AC that Jest can test passes, and no bug is open.** AC-47 and AC-73 (2a) need the user's manual run (L-23 to L-31) before commit. D-1 needs SA's confirmation and a BA wording edit. The other two Low notes do not block.

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created (Dev) | Slice 2a workplan: R-e to R-f′ (keyset on `id`, page 1,000, ceiling 5,000, rows plus `reachedCeiling`, no `livemode`), the currency helper at scale 100, the pure takings builder, the route's info line, the new block on the shared layout parts, the finance source-guard narrowing and positive table pin (S2-F1), AC mapping, verification plan with the scoped `tsc` canary and SQL checks 7 to 9. Raises SA-W18 to SA-W27. No code changed. |
| 2026-10-11 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W18 to SA-W27 approved (W20 corrected: an unreadable fee makes the block partial). Required changes SA-WR-14 to SA-WR-19. Requirement edits E-8 (check 7 `counted_payments` / `businesses_counted`, AC-47, S2-FR-2), E-9 (refund-only lines and rows) and E-10 (unreadable amounts) are for BA. Recorded in requirement §0.3 (SA-W18 to SA-W27, SA-WP-2a) and its Change History. |
| 2026-10-11 | Implemented (Dev): **Code Complete**, uncommitted | R-e to R-f′, `currencyGroups.ts`, `takings.ts`, the builder, wiring and route info line, `TakingsSection.tsx`, the `FinanceSection` badge, `formatMoney`, the finance source-guard narrowing and new rules. SA-WR-14 to SA-WR-19 applied; the SA-W20 cell corrected. Deviations D-1 to D-5 (D-1, the magnitude-aware whole-hundredths tolerance, needs SA's confirmation). V-1 to V-10 results in Implementation Notes. |
| 2026-10-11 | SA code review: **APPROVED** | All 20 code files read. D-1 to D-4 approved (D-1's tolerance proven: rounding error is at most about `abs(n·100)·ε`, so a 4ε margin is safe and a third decimal is still caught). SA-WR-14 to SA-WR-19 and the planted controls verified. SA re-ran 34 suites / 1,381 tests, `test:bos-entitlements` (6,638) and `test:authz-guard` (203), all green; Businesses-list diff exit 0. Two optional Low notes. Code approved for QA. |
