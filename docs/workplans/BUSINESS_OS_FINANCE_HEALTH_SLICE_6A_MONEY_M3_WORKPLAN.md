# Workplan: Business OS Finance & Business Health — Slice 6a (Money M-3: account economics and AI margin)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **6a**: §11E.1 to §11E.8 (AC-130 to AC-149), §13 checks 19 and 20, "SA Requirement Review — Slice 6a (M-3) — 2026-10-14", §0.3 SA-Q42 to SA-Q50 and SA-RR-6a, and §0.4 DF-5, DF-6 and DF-8.
**Decisions in force:**
- BD-9 (UTC calendar month).
- BD-12 (no FX; per currency only; never a cross-currency sum).
- BD-14 and BD-20 (test and live money count together, with no label and no switch).
- BD-15 (a paying Founding Partner is grouped under its paid tier, with a chip).
- BD-17 (refund-month rule; deferred with 4b, so the S4-W-3 note stays).
- BD-18 (AI cost means the cost we charged).
- BD-19 (cash received first; MRR in 5b).
- BD-22 (AI margin on revenue after tax, net of refunds and disputes; Stripe fees not deducted, and the page says so).
- BD-26 / DF-6 ("since it started" stays deferred; the 92-day cap is unchanged).
- DF-8 (no Stripe fee estimate; it moves to 6b with K-7 and the per-plan margin, BD-8).

**Builds on:** slices 1a, 1b, 1c, 2a, 2b, 4a and 5a, all on `main` at `d05eb0a4` (5a = PR #383). See the [5a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md) and the [5a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_RETROSPECTIVE.md).

**SA rulings implemented:**
- SA-Q42: the accounts table is built only with `tab=accounts`.
- SA-Q43: key `tab`, value `accounts`, absent = Overview, written with replace; page-local tabs with the L-8a keyboard rules; no new shared export.
- SA-Q44: keys `sort`, `group`, `show`, Zod enums, defaults omitted from the URL; accepted only with the tab (E-48).
- SA-Q45: `readMoney` (boosts) and `readPlanMoney` (plans) are exported; the two export pins are updated in the same diff; `refundsAndDisputesOf` stays private (E-44).
- SA-Q46: `summariseAiCost` also returns the per-account map (non-wire, cost units).
- SA-Q47: a partial refund of a taxed boost is Unknown.
- SA-Q48: "Not available" when the window starts before the cut-over.
- SA-Q49: money-only accounts are shown as Unknown/held, "No plan row".
- SA-Q50: full cycle, one workplan, one PR; FIN 4b stays paused until merge.
- Findings S6-F1 to S6-F6 and requirement edits E-44 to E-48.

**Still in force:**
- SA-W1 / AC-42: the view narrows to a picked business; the picked view makes no platform-wide read.
- SA-W22: structural input types (no data-layer import in a builder).
- SA-W48 / SA-W64: unreadable is decided per row.
- SA-W54: no × 100; money never through `toUnits` or `toHundredths`.
- SA-WR-3: spies at the repository boundary.
- SA-WR-4: builders are pure.
- SA-WR-7: scratch tsconfig outside the worktree, with a canary.
- SA-WR-18: the page never adds or subtracts money.
- SA-W63: an absent part is an exact 0 only when its read succeeded and was not cut off.

**Date:** 2026-10-14
**Branch:** `feature/bos-money-m3`. RM cut it from `main` `d05eb0a4`; I confirmed it with `git branch --show-current` in worktree `neuronforge-finance-health`. `node_modules` is a junction to the main checkout, so:
- never run `git worktree remove`, `git stash` or `npm install`;
- never commit. The user pre-authorised M-3 to go from an SA code review and a QA pass straight to RM commit and one PR, with **no user diff review**. This workplan and SA's two reviews are therefore the gate.

The worktree already holds BA's uncommitted edits to `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` and `docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md`. Dev does not edit either; TL records this workplan's link.

**Status:** Code Complete. SA workplan review APPROVED WITH CONDITIONS (SA-WR-41 to SA-WR-45 applied); awaiting SA code review. Uncommitted.

## Overview

Slice 6a answers "across all accounts, who paid us what, what did their AI cost us, and which accounts are worth it?" (§11E). For the owner test account in October 2026, the row must read: paid us **USD 89.00** after tax (plan 79.00 + boost 10.00, tax 0), charged AI cost **USD X** (check 19), AI margin **USD 89.00 − X**.

What it adds:
- An **Accounts** tab on Finance, with all businesses only. The tab is in the URL (`tab=accounts`); absent means Overview, which is today's page, unchanged.
- One pure builder, `lib/business-os/finance/accountEconomics.ts`. It makes one row per account from rows the route **already reads**: the R-a ledger rows, the R-k boost rows, the R-m plan rows, the plan walk and the credit-positions pass. The table is sorted, filtered and capped at 200 on the server, with an honest count line.
- A **platform AI margin line** over every account, taken before any filter or cap and never summed across currencies.
- Each account row links to the M-1 one-account view, on the same window.
- An **"AI margin (USD)"** line in the M-1 account summary, built by the same builder from the account-scoped reads.

What it leaves out: no migration, no SQL function, no new table, no write, no LLM call, no audit entry and **no new repository method**. It adds no new read either; the only extra I/O is one names request of at most 200 ids, and only on the tab. It adds no entitlements import and no tier written as a literal.

**Sixteen points need an SA ruling before code** ([Questions for SA](#questions-for-sa-before-code), SA-W74 to SA-W89). Nine are places where the requirement does not fit the code:
- SA-W74: the payload key `accounts` is already taken.
- SA-W75: revenue and AI cost have different scales.
- SA-W77: no per-account Founding Partner fact exists.
- SA-W78: Section 4 caps its rows before the Accounts tab could use them.
- SA-W79: the ledger's unreadable amounts are counted platform-wide only.
- SA-W81: two boost edge rows behave differently in E-45 and in check 19.
- SA-W82: M3-W-4 (a) and M3-W-6 disagree on an Unknown-currency line.
- SA-W83: a tier group cannot be a static Zod enum without a tier literal.
- SA-W85: the route 404s a platform account, so its row cannot link.

None reopens a business decision.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [M3.1 URL, route and payload](#m31-url-route-and-payload)
- [M3.2 The readers and the AI cost map](#m32-the-readers-and-the-ai-cost-map)
- [M3.3 The pure builder `accountEconomics.ts`](#m33-the-pure-builder-accounteconomicsts)
- [M3.4 Wiring in `financeHealth.ts`](#m34-wiring-in-financehealthts)
- [M3.5 The M-1 summary line](#m35-the-m-1-summary-line)
- [M3.6 Failure matrix](#m36-failure-matrix)
- [M3.7 The page](#m37-the-page)
- [Entitlements registration check](#entitlements-registration-check)
- [Tenant isolation check](#tenant-isolation-check)
- [Guard table, line by line](#guard-table-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Checklist before SA code review](#checklist-before-sa-code-review)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I opened every file below at `d05eb0a4` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| `summariseAiCost` already builds a full per-account map in ledger cost units, then cuts it to the top 10 | `lib/business-os/finance/aiCost.ts:89`, `:118-125`, `:136-144` |
| Deleted accounts (`user_id` NULL) go to their own bucket, never into `byAccount` | `aiCost.ts:118-121` |
| An unreadable ledger amount counts as 0 and is counted **platform-wide only** (no per-account count) | `aiCost.ts:91`, `:95-104`, `:149` |
| An account on the ledger with no plan row is grouped `unknown_held`, never dropped (the SA-Q49 precedent) | `aiCost.ts:127-133` |
| `aiCost.ts` imports the `CreditLedgerRow` type from the ledger repository, so it is on that repository's caller list | `aiCost.ts:22`; `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:1072-1079` |
| `COST_SCALE` 1e10, `CREDIT_SCALE` 1e6; `CURRENCY_SCALE` 100 | `lib/business-os/credits/creditReport.ts:89-90`; `lib/business-os/finance/currencyGroups.ts:27` |
| `groupByCurrency`: integer sums per normalised currency, `unreadable` per field, `overflow`, Unknown currency last; nothing adds two lines | `currencyGroups.ts:83-105` |
| Boost paid family is an exported constant; the builder counts only those statuses | `lib/business-os/finance/boostRevenue.ts:79`, `:258-260` |
| `readMoney` (private) returns `{ total, tax, refunded, held, lost }` in minor units or null; its return type `ReadableMoney` is private; it does **not** check tax ≤ total | `boostRevenue.ts:107-113`, `:155-165` |
| `refundsAndDisputesOf` (private) is the only reader of `amount_refunded_minor` and the two dispute statuses | `boostRevenue.ts:128-152` |
| `readPlanMoney` (private) returns `{ code, amount, tax }` or null; it refuses tax > amount | `lib/business-os/finance/planRevenue.ts:114-123` |
| `PLAN_PAYMENT_KIND` is exported; plan rows are counted only with that kind | `planRevenue.ts:70-71`, `:200-203` |
| Credits rows are computed for every walked account, sorted, then **sliced to the display cap** | `lib/business-os/finance/creditsSection.ts:212-276` (`:265-273`) |
| `classifyAccounts` returns `groupByAccount` and per-group Founding Partner **counts**; there is no per-account Founding Partner fact | `lib/business-os/finance/planGroups.ts:136-140`, `:193`, `:196-200` |
| `tierLabelForGroup(config, key)` | `planGroups.ts:250-252` |
| The builder: `TABLE_ROWS_SHOWN` 200; `FINANCE_LIMITS` | `lib/business-os/finance/financeHealth.ts:157`, `:159-183` |
| Builder deps, input and counts types | `financeHealth.ts:204-267`, `:269-275`, `:278-362` |
| The plan walk and the positions pass (a failed or capped walk runs no pass) | `financeHealth.ts:429-448` |
| One settled `Promise.all` over every read, R-k / R-k′ at `:522-526`, R-m / R-m′ at `:528-532` | `financeHealth.ts:459-533` |
| Section 1 classification; Section 3's `summariseAiCost` call, its names call and `coverage` from `cutoverClamp` | `financeHealth.ts:568-575`, `:577-623` (`:587-595`, `:599-616`); `:426` |
| Our revenue: `buildBoostRevenue`, the `planLabelOf` callback, `buildPlanRevenue`, the combiner | `financeHealth.ts:629-692` |
| Section 4: `buildCreditsSection` with `displayCap`, then names for the shown rows | `financeHealth.ts:744-791` |
| The payload already has a key **`accounts`** (Section 1, "Accounts by plan") | `financeHealth.ts:996`; `lib/business-os/finance/financeTypes.ts:384-398` (`:391`), `:96-102` |
| `FinanceGroupKey` = `trial` / `founding_partner` / `comped` / `tier:${string}` / `unknown_held` / `tier_set` | `financeTypes.ts:61` |
| `FinanceCreditRow`, `FinanceCreditsFigures`, `FinanceCreditsSection` | `financeTypes.ts:497`, `:523`, `:551` |
| Charging cut-over 2026-09-29 16:50:53.914 UTC; `cutoverClamp` gives `after_cutover` / `starts_before_cutover` / `entirely_before_cutover` | `lib/business-os/credits/aiActivity.ts:146`, `:219-225` |
| Route: strict Zod schema with four keys; repeated key 400; a platform account id is a 404; `findNames` binding; one `info` line | `app/api/admin/business-os/finance/route.ts:94-117`, `:136-139`, `:154-157`, `:167`, `:186-219` |
| Page URL: four keys, pinned in order by a test; parse and serialise | `app/admin/finance/financeUrl.ts:30`, `:37-68`, `:71-80`; `app/admin/finance/__tests__/financeUrl.test.ts:86-88` |
| The view: `setQuery` with `router.replace(…, { scroll: false })`; `onPick`; header and summary only with a business picked | `app/admin/finance/components/FinanceView.tsx:55-58`, `:62-68`, `:121-148` |
| Account summary lines (AI cost, boosts, plan, total, credits, group) | `app/admin/finance/components/AccountSummary.tsx:183-202` |
| `financeLinks.ts` imports only the wire types, pinned by the page guard | `app/admin/finance/financeLinks.ts:23`; `app/admin/finance/__tests__/source.guard.test.ts:167-171` |
| `formatMoney` (exactly 2 dp), `formatUsd` (2 to 4 dp, Section 3's), `atLeast` | `app/admin/finance/financeFormat.ts:15`, `:20`, `:33` |
| `groupLabel` for a group (server tier label, else the copy) | `app/admin/finance/components/AccountsByPlanSection.tsx:44-46`; `financeCopy.ts:193` |
| Shared table constants, `StatusChip`, `AdminNotice`, `AdminEmpty`, `formatCount` | `app/admin/components/layout/adminTable.ts:17-37`; `StatusChip.tsx:59`; `AdminStates.tsx:71`, `:102`; `adminFormat.ts:34` |
| The L-8a tab pattern on Business OS AI: APG tablist, manual activation, roving `tabIndex`, Home / End | `app/admin/business-os-llm/page.tsx:121-143`, `:227-245`, `:285-297` |
| Names: one `.in()` chunk is 200 ids | `lib/repositories/BusinessProfileRepository.ts:35`, `:681-686` |
| Finance source guard: `FILES`, write verb, `token_usage`, tier literal, entitlements importers, `REPOSITORY_TABLES`, `livemode`, exchange rate, `currencyGroups` export pin, `MONEY_ARITHMETIC` | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:77-84`, `:123-137`, `:164-168`, `:185-188`, `:291-321`, `:366-376`, `:379-385`, `:388-393`, `:417-431` |
| Same file, 4a: `TIMES_100`, the DF-5 pin, the refund-note pin, purity, `MONEY_4A`, the **boost export pin** | `:655-676`, `:684-716`, `:718-741`, `:745-751`, `:754-766`, **`:769-775`** |
| Same file, 5a: `IMPURE`, the **plan export pin**, the `ourRevenue` pin, `KIND_LITERAL`, `MONEY_5A`, dim text | `:880-893`, **`:917-922`**, `:924-929`, `:932-942`, `:944-959`, `:972-977` |
| Page guard: wire types only, no `console.`, `router.replace` not push, M-1 dim-text rule, links-file imports | `app/admin/finance/__tests__/source.guard.test.ts:50-62`, `:70-75`, `:132-141`, `:167-171` |
| Caller lists naming finance files: finance repository; ledger repository; plan repository; lots | `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts:561-563`; `BusinessOsCreditLedgerReadRepository.test.ts:1072-1079`; `businessOsEntitlements.imports.guard.test.ts:186-199`; `lib/business-os/credits/__tests__/creditLots.test.ts:227-238` |
| N-10 raw-`service` guard scans the finance lib, route and page | `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:87-89`, `:93-104` |
| Entitlement non-gate registrations for finance: `planGroups.ts`, `financeHealthDeps.ts` | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:515-535` |
| Route tests: `allReads()` covers every mocked read; "an unknown key" is `name` | `app/api/admin/business-os/finance/__tests__/route.test.ts:316-322`, `:383` |
| `test:bos-entitlements`, `test:authz-guard`, `lint:hooks` | `package.json:20`, `:23`, `:25` |

`console.*` count in every file to modify is **0**. I grepped `aiCost.ts`, `boostRevenue.ts`, `planRevenue.ts`, `creditsSection.ts`, `planGroups.ts`, `financeHealth.ts`, `financeTypes.ts`, `route.ts`, `financeUrl.ts`, `financeLinks.ts`, `financeCopy.ts`, `FinanceView.tsx`, `AccountSummary.tsx` and `FinanceFilterBar.tsx`. CLAUDE.md's flag-and-convert rule therefore has nothing to convert.

Flagged, not touched: `app/admin/finance/useFinanceData.ts:14-17` still uses the server `createLogger` in a client file (FU-5a-2, fixed in M-6). This slice does not modify that file.

---

## Scope

This is exactly §11E.2. One PR (SA-Q50).

| In | Out |
|---|---|
| The **Accounts** tab (all businesses only), built only with `tab=accounts` (SA-Q42) | Any new read or repository method |
| URL and route keys `tab`, `sort`, `group`, `show`; `sort` / `group` / `show` without `tab=accounts` is a 400 (E-48) | MRR (5b) |
| A pure builder: one row per account; server-side sort and filter **before** the 200-row cap; an honest count line | Margin per current plan, K-7, the Stripe fee estimate (6b, DF-8) |
| The platform AI margin line over **every** account, before filter and cap (E-47), never summed across currencies | Recorded-but-not-charged cost (M-4, BD-18) |
| Each row links to the M-1 one-account view, carrying the window | "Since it started" (DF-6, BD-26) |
| The **AI margin (USD)** line in the M-1 account summary | The Money sidebar section (M-5); the page shell (M-6) |
| | Plan refunds and disputes (not recorded before PAY P-6b); FX (BD-12); CSV export; FIN 4b (paused) |

ACs: AC-130 to AC-149.

---

## Questions for SA before code

Each question has a recommendation, and I build the recommendation unless SA rules otherwise. Numbering continues from 5a (SA-W73).

| # | Issue | Recommendation |
|---|---|---|
| **SA-W74** | **The payload key `accounts` is taken.** M3-FR-11 says "the route adds an `accounts` section to the payload". `FinancePayload.accounts` is already Section 1, "Accounts by plan" (`financeTypes.ts:391`, `financeHealth.ts:996`), read by the page, the header and the summary. | Two **optional** keys. `accountEconomics?: FinanceAccountEconomicsSection` is present only with `tab=accounts` and no business picked. `accountMargin?: FinanceAccountMargin` is present only with a business picked (M3-FR-8). Both keys are **absent**, not `null`, otherwise, so the all-businesses Overview payload is byte-for-byte what it is today (AC-145). **TL/BA note:** M3-FR-11 should name `accountEconomics` (I do not edit the requirement). |
| **SA-W75** | **Revenue and AI cost have different scales.** Revenue is integer minor units (hundredths, behind the `minorUnitsPerMajor === 100` gate). Charged cost is integer ledger units at `COST_SCALE` = 1e10 (`creditReport.ts:90`). An exact margin needs one common scale. The 4a and 5a rules ban `* 100` and `CURRENCY_SCALE *` (`finance.source.guard.test.ts:655`, `:858`). | **Integer subtraction at the ledger scale.** One named constant, `MINOR_TO_COST_UNITS = COST_SCALE / CURRENCY_SCALE` (1e8). Then `marginUnits = afterTaxMinor * MINOR_TO_COST_UNITS - costUnits`, checked with `Number.isSafeInteger` (overflow gives Unknown; the safe range is about **USD 900,719** per figure, `Number.MAX_SAFE_INTEGER / 1e10`, for revenue × 1e8 and for cost units alike, the same bound `aiCost.ts` already has; corrected per SA-WR-41). The result is divided **once**, by `COST_SCALE`, at the edge. The 6a guard pins: exactly one `* MINOR_TO_COST_UNITS`, no `* 100`, no `CURRENCY_SCALE *`, no `toUnits(` and no `toHundredths`. **Alternative:** subtract two wire floats (`minor / CURRENCY_SCALE - units / COST_SCALE`). That is simpler, but the final step is no longer exact, and check 19 rounds to 6 dp, so I do not recommend it. |
| **SA-W76** | **The formatter for cost and margin.** M3-FR-3 says "money through `formatMoney`", which prints exactly two decimals (`financeFormat.ts:15`). Section 3 prints AI cost with `formatUsd`, 2 to 4 decimals (`:20`). With `formatMoney`, a cost of 0.1234 prints as 0.12 while the margin is 88.8766 → 88.88. The row then does not add up visibly, and AC-134's comparison with Section 3 is text against different text. | **Paid us** goes through `formatMoney` (minor units, exactly two decimals). **AI cost** and **AI margin** go through `formatUsd`, as Section 3 prints its cost. The table then reads 89.00 / 0.1234 / 88.8766, and the cost cell equals Section 3's text on the same render. |
| **SA-W77** | **No per-account Founding Partner fact.** M3-FR-3 asks for the plan group "with the Founding Partner chip, BD-15". `classifyAccounts` counts Founding Partners **per group** (`planGroups.ts:196-200`). It returns `groupByAccount` and nothing per account (`:136-140`). M-1's header can use the count only because its view holds one account. | `ClassifiedAccounts` gains one **non-wire** field, `foundingPartnerNote: ReadonlySet<string>`. It is filled under exactly the `:198` condition (a tier group, the champion cohort, and a current period), so the chip and Section 1's note cannot differ. `planGroups.ts` gains **no import**, so its `KNOWN_NON_GATE_IMPORTERS` symbol set (`enforcementPoints.test.ts:515-535`) is unchanged. A `planGroups.test.ts` case pins that the set's size equals the sum of `foundingPartners` over the groups. |
| **SA-W78** | **Section 4 caps its rows before the tab could use them.** The Accounts tab needs "Credits used" for **every** account, so it can sort by it before its own cap. `buildCreditsSection` computes every walked account's row, then slices to `displayCap` (`creditsSection.ts:265-273`). | `CreditsSectionResult` gains one **non-wire** field, `rowByAccount: ReadonlyMap<string, CreditsSectionRow>`, holding every row before the slice. This is the SA-Q46 argument: one computation, so Section 4 and the tab cannot differ. Section 4's wire `rows` are unchanged. Alternative: call `buildCreditsSection` a second time with an unbounded cap. That works, but it computes everything twice, so I do not recommend it. |
| **SA-W79** | **The shape of the SA-Q46 map, and per-account unreadable.** M3-W-6 says "a ledger unreadable amount makes that account's figure Unknown". `summariseAiCost` counts unreadable amounts only platform-wide (`aiCost.ts:91`, `:97-104`). | `AiCostSummary` gains one **non-wire** field: `units: { byAccount: ReadonlyMap<string, { cost: number; rows: number; unreadable: number }>; deleted: { cost; rows; unreadable }; total: { cost; rows; unreadable } }`, in ledger cost units. The private `UnitBucket` gains `unreadable`, incremented in the same `add`. `figures` and `top` are unchanged, so Section 3's wire is byte-identical. The platform line's cost is `units.total.cost`, the same integer that `figures.costUsd` is divided from (`aiCost.ts:150`), so AC-134 holds by construction. |
| **SA-W80** | **How the readers are exported (SA-Q45).** `readMoney`'s return type is the private interface `ReadableMoney` (`boostRevenue.ts:107-113`). `readPlanMoney` returns an inline type. Neither reader filters on status or kind. The builders filter first (`:258-260`; `planRevenue.ts:201-203`). | Export the **two functions only**. The pins become exactly `['BOOST_PAID_FAMILY', 'BoostPurchaseInput', 'BoostRevenueResult', 'buildBoostRevenue', 'readMoney']` and `['PLAN_PAYMENT_KIND', 'PlanPaymentInput', 'PlanRevenueResult', 'buildPlanRevenue', 'readPlanMoney']`, each with a reason comment naming SA-Q45. `accountEconomics.ts` types the results structurally (`NonNullable<ReturnType<typeof readMoney>>`), so no type export is added. It applies the same counted filters through the exported `BOOST_PAID_FAMILY` and `PLAN_PAYMENT_KIND`, never a status or kind literal. The `KIND_LITERAL` positive pin (`:932-942`) and the DF-5 tokens (`:684`) therefore stay true. |
| **SA-W81** | **Two boost edge rows: E-45 against check 19.** (i) `readMoney` does not refuse tax > total, unlike `readPlanMoney` (`planRevenue.ts:121`). Under E-45 a `paid` boost with tax 120 on a total of 100 gives after-tax −20; check 19 gives −20 too. (ii) A row with status `paid` but `refunded > 0`. E-45, which has no status, gives `net` (tax 0) or inexact. Check 19 branches on status first and gives total − tax. Neither row exists live: 1 row, tax 0 (§11E.1). | (i) **Inexact (Unknown)** when `tax > net` on the no-refund branch, in `accountEconomics.ts` only. `readMoney` and 4a stay unchanged, because a negative "paid us" is impossible money. (ii) **Follow E-45** (S6-F2 chose the status-free rule on purpose), and record the divergence in the SQL notes for QA. Both cases get a unit test. |
| **SA-W82** | **An Unknown-currency line, and the order of the margin labels.** M3-W-4 (a) puts "no Unknown-currency line" under the condition whose failure reads "n/a, different currency" (M3-W-5). M3-W-6 says an unreadable row makes the margin Unknown. A currency that does not normalise is an unreadable row, not another currency (FU-5a-1 is the same shape). Several conditions can also fail at once. | An Unknown-currency line gives margin **Unknown**, never "n/a". One precedence, applied to rows and to the platform line: **Not available** (the window starts before the cut-over) > **n/a, different currency** (any normalised non-USD line) > **Unknown** (a failed or ceiling read, an unreadable row, an inexact refund, overflow, or an Unknown-currency line) > the figure. A test is written for each pair. |
| **SA-W83** | **The `group` filter values.** A tier group's key is `tier:<id>` (`financeTypes.ts:61`). A static Zod enum of tiers needs either tier literals (`tierLiteral.forbidden`, finance rule `:164-168`) or an entitlements import in the route (a new registration). | The route accepts `group` by **shape**: `^(trial\|founding_partner\|comped\|unknown_held\|tier_set\|tier:[a-z0-9_-]{1,40})$`. A malformed value gets a 400. The builder matches the key against `groupByAccount`, so a well-formed tier that is not configured matches no row and gives "No accounts match this filter", not an error. The dropdown options come from the **server** (`accountEconomics.groupOptions`, built from Section 1's seeded groups with their `tierLabel`), so the page writes no tier. The log line records `group` as its kind (`'tier'` for any tier key), never a tier id (the M2-FR-11 precedent). |
| **SA-W84** | **`tab` with a business picked, and `tab=overview`.** M3-FR-1 says that with a business picked there is no tab, and the page drops it. The requirement does not say what the route does with `tab=accounts&accountId=…`. | The route returns **400** for `tab` together with `accountId` (one more `superRefine` issue). `tab` accepts only `accounts`: `tab=overview` is a 400, and absent means Overview. The page parser mirrors both rules, falling back to defaults with `FINANCE_URL_NOTICE`. |
| **SA-W85** | **A platform account's row cannot link.** M3-FR-7: "each named or short-id row links" to `?accountId=<id>`. The route 404s a platform id (`route.ts:154-157`). | A platform row shows the existing platform label (AC-131) and has **no link**, like the Deleted accounts row. A test pins this. |
| **SA-W86** | **The Deleted accounts row and the filters.** M3-W-8 places it last, outside the cap. M3-FR-5's filters do not say whether it survives a plan-group filter or "Negative AI margin". | The Deleted row shows only when `group` is all. With `show=negative`, it shows only when its own margin is a negative figure. With `show=active` it always shows: it exists only when a NULL-`user_id` row was read. It never counts in "Showing x of N". **"Paid us or used AI in this window"** means at least one counted revenue row (a paid-family boost, or a plan invoice of the paid kind with an amount above 0, or an unreadable such row) **or** at least one ledger row in the window. |
| **SA-W87** | **Sort details that M3-FR-4 leaves open.** These are: where accounts with no revenue go under "Paid us"; how a lower bound ranks; and where a money-only account ("No plan row") goes under "Credits used". | **Paid us:** first accounts whose revenue is all USD, by USD after-tax highest first (an "At least" figure ranks by its bound); then accounts with any non-USD line, by their lowest non-USD code and then that line's amount; then accounts with no revenue; ties by id. **AI margin:** figures lowest first; then Not available, n/a and Unknown, ordered by AI cost highest first; ties by id. **AI cost:** cost highest first, compared in integer units; Unknown last. **Credits used:** `usedTenths` highest first; then "No allowance"; then Unknown and "No plan row"; ties by id. Every comparison runs on the server, before the cap. |
| **SA-W88** | **What the Accounts tab shows.** M3-FR-1 names the tabs but not what each contains. | The **filter bar** (window and picker) stays above both tabs. The Accounts tab body shows the always-on notes (M3-FR-9), the platform line, the sort / group / show controls, the count line, and the table or `AdminEmpty`. The KPI strip and the six sections belong to Overview. Picking a business from either tab drops `tab`, `sort`, `group` and `show`. |
| **SA-W89** | **A tab switch is a new request.** The tab is a route parameter (SA-Q42), so switching tabs refetches the whole payload: the same reads, plus one names call on Accounts. | Accept it: it is the Q42 trade-off. QA records `durationMs` for both tabs (M3-FR-16, p95 under 2 s). The Overview request is unchanged. |

---

## Analysis Summary

| Area | Touched how |
|---|---|
| Readers | `boostRevenue.ts`: `readMoney` exported (S6-F1). `planRevenue.ts`: `readPlanMoney` exported. No behaviour change |
| Section 3 sums | `aiCost.ts`: the non-wire `units` map with a per-account unreadable count (SA-Q46, SA-W79). Wire unchanged |
| Section 4 | `creditsSection.ts`: the non-wire `rowByAccount` (SA-W78). Wire unchanged |
| Section 1 classifier | `planGroups.ts`: the non-wire `foundingPartnerNote` set (SA-W77). No import change |
| New builder | `accountEconomics.ts`: pure; the money and margin rules, the rows, sort, filter, cap, platform line and Deleted row |
| Orchestrator | `financeHealth.ts`: input `accountsTab`; the builder called only with the tab (all businesses) or for the picked margin; one names call ≤ 200; counts |
| Types | `financeTypes.ts`: `FinanceAccountEconomicsSection`, its row, platform line, margin, and two optional payload keys |
| Route | `route.ts`: Zod `tab` / `sort` / `group` / `show` and their `superRefine` rules; the info line; header |
| Page | `financeUrl.ts` (four new keys); `financeLinks.ts` (`accountViewHref`); `FinanceView.tsx` (page-local tabs); new `FinanceTabs.tsx`, `AccountsTab.tsx`, `AccountEconomicsTable.tsx`; `AccountSummary.tsx` (margin line); `financeCopy.ts` |
| Tables read | None new. R-a, R-k, R-m, the plan walk, R-c and the positions pass are already read on every all-businesses request; R-a′, R-k′ and R-m′ on every picked request |
| Not touched | Every repository and its tests (no method, no caller); `financeHealthDeps.ts` (no new dep); `ourRevenue.ts`; `currencyGroups.ts`; `takings.ts`; `paymentProblems.ts`; `FinanceKpiStrip.tsx`; `RevenuePanel.tsx`; `useFinanceData.ts`; every file under `lib/business-os/billing/`, `app/api/stripe/`, `lib/payments/`, `lib/business-os/entitlements/`; every migration; the requirement MDs |

---

## Implementation Approach

1. **Baseline test first (AC-145).** Before any product file changes, I add the route test "Overview unchanged". It records the exact read calls and arguments, the `findNames` calls, and the payload's top-level key list for an all-businesses request, as literals. It must pass on unchanged `d05eb0a4` code. It then guards every later step.
2. **Non-wire additions next**, each with a unit test and its wire unchanged: the two reader exports with their pins, the `aiCost` units map, `creditsSection.rowByAccount`, and `planGroups.foundingPartnerNote`.
3. **The pure builder** with its own tests, including an independent `checkNineteen` helper that re-implements check 19's SQL rules in plain TypeScript (the 5a `checkSeventeen` precedent).
4. **Types, wiring and route**: `financeHealth.ts`, then the route's Zod fields and info line.
5. **The page**: URL, links, tabs, table and the summary line.
6. **Guards last**, each new rule with a planted negative control (4a conclusion 2, 5a conclusion 2).
7. **End-of-day-1 report** (S6-F6): if the builder and route are not green at the end of day 1, I report to TL.
8. **No new pattern.** The pure-builder and structural-input shape is `planRevenue.ts`'s. The `tierLabelOf` callback is `aiCost`'s. The non-wire fields are SA-W59's `netMinorByCurrency`. Names for shown rows only is SA-W73's. The page-local tablist is L-8a's. URL state through `router.replace` is the existing Finance rule.

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/finance/accountEconomics.ts` | Pure `buildAccountEconomics(input)` and `buildAccountMargin(input)` ([M3.3](#m33-the-pure-builder-accounteconomicsts)) |
| `lib/business-os/finance/__tests__/accountEconomics.test.ts` | AC-131 to AC-141 and AC-143 builder halves; E-45 table; SA-W75, SA-W81, SA-W82, SA-W86, SA-W87; `checkNineteen` / `checkTwenty` helpers |
| `app/admin/finance/components/FinanceTabs.tsx` | Page-local tablist (Overview, Accounts), the L-8a keyboard rules, no export outside the folder |
| `app/admin/finance/components/AccountsTab.tsx` | The tab body: notes, platform line, controls, count line, table or empty state |
| `app/admin/finance/components/AccountEconomicsTable.tsx` | The table: one row per account, then the Deleted row; links through `accountViewHref` |
| `app/admin/finance/__tests__/accountsTab.render.test.tsx` | AC-130, AC-136, AC-139, AC-140, AC-141, AC-143, AC-144 render halves; keyboard |

### Modify

| File | Change |
|---|---|
| `lib/business-os/finance/boostRevenue.ts` | `export` on `readMoney` (SA-Q45); a header line. No logic change |
| `lib/business-os/finance/planRevenue.ts` | `export` on `readPlanMoney`; a header line. No logic change |
| `lib/business-os/finance/aiCost.ts` | `UnitBucket.unreadable`; non-wire `units` on `AiCostSummary` (SA-W79) |
| `lib/business-os/finance/creditsSection.ts` | Non-wire `rowByAccount` (SA-W78) |
| `lib/business-os/finance/planGroups.ts` | Non-wire `foundingPartnerNote` (SA-W77) |
| `lib/business-os/finance/financeTypes.ts` | `FinanceAccountsTabQuery`, `FinanceAccountEconomicsSection`, `FinanceEconomicsRow`, `FinanceEconomicsPlatformLine`, `FinanceAccountMargin`, `FinanceMarginValue`; two **optional** keys on `FinancePayload` (SA-W74) |
| `lib/business-os/finance/financeHealth.ts` | `FinanceHealthInput.accountsTab`; the builder call; names ≤ 200; `counts.accountEconomics`; header |
| `app/api/admin/business-os/finance/route.ts` | Zod `tab` / `sort` / `group` / `show`; E-48 and SA-W84 rules; input passes `accountsTab`; info line; header |
| `app/admin/finance/financeUrl.ts` | `FinanceQuery` gains `tab`, `sort`, `group`, `show`; `FINANCE_URL_KEYS` gains four keys; parse and serialise rules |
| `app/admin/finance/financeLinks.ts` | `accountViewHref(accountId, window)`: literals only, still imports only the wire types |
| `app/admin/finance/financeCopy.ts` | Tab, column, note, label, count-line and empty-state strings |
| `app/admin/finance/components/FinanceView.tsx` | Tabs when no business is picked; Overview body unchanged; `onPick` drops the four tab keys |
| `app/admin/finance/components/AccountSummary.tsx` | "AI margin (USD)" line under "Paid us, total" (M3-FR-8) |
| `lib/business-os/finance/__tests__/{aiCost,boostRevenue,planRevenue,creditsSection,planGroups,financeHealth}.test.ts` | Cases for each non-wire addition; wiring; failure matrix |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | The two export pins updated (E-44); the DF-5 pin extended to `accountEconomics.ts` (E-44); a new `slice 6a` describe |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | AC-145 baseline; AC-146; E-48; SA-W84; AC-147 info line |
| `app/admin/finance/__tests__/financeUrl.test.ts` | The key-order pin (`:88`) becomes eight keys; round trip; defaults omitted; malformed fallback |
| `app/admin/finance/__tests__/financeLinks.test.ts` | `accountViewHref` parsed back through `parseFinanceUrl` (AC-144) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Tabs present only with no business; Overview unchanged |
| `app/admin/finance/__tests__/financeAccount.render.test.tsx` | The summary margin line (AC-142 render half) |
| `app/admin/finance/__tests__/source.guard.test.ts` | New 6a page rules ([Guard table](#guard-table-line-by-line)) |

**Not modified, on purpose:**
- `financeHealthDeps.ts` (no new dep, so its entitlements symbol set is unchanged).
- Every repository and repository test.
- `ourRevenue.ts`, `currencyGroups.ts` (its export pin `:388-393`), `takings.ts`, `paymentProblems.ts`, `financeRules.ts`.
- `FinanceKpiStrip.tsx`, `RevenuePanel.tsx`, `FinanceFilterBar.tsx`, `useFinanceData.ts`.
- `enforcementPoints.test.ts`, every migration, and the requirement MDs.

---

## M3.1 URL, route and payload

**Route schema** (`route.ts:94-117`): four new optional fields, still `.strict()`.

| Key | Zod | Default (omitted from the URL) |
|---|---|---|
| `tab` | `z.enum(['accounts'])` | absent = Overview |
| `sort` | `z.enum(['ai_cost', 'margin', 'paid', 'credits'])` | `ai_cost` |
| `group` | `z.string().regex(GROUP_SHAPE)` (SA-W83) | all |
| `show` | `z.enum(['all', 'active', 'negative'])` | `all` |

`superRefine` adds two issues, each a 400 through the existing `INVALID_QUERY` path:
- `sort`, `group` or `show` present while `tab !== 'accounts'` (E-48);
- `tab` together with `accountId` (SA-W84).

The repeated-key rule (`:136-139`) covers the new keys unchanged. The route passes `accountsTab: tab ? { sort, group, show } : null` to the builder.

**Page URL** (`financeUrl.ts`): `FinanceQuery` gains `tab: 'accounts' | null`, `sort`, `group` and `show`, with defaults. `FINANCE_URL_KEYS` becomes `['preset', 'from', 'to', 'accountId', 'tab', 'sort', 'group', 'show']`. The pin at `financeUrl.test.ts:88` is updated to that list.

The parse rules mirror the route:
- a malformed value, `sort` / `group` / `show` without `tab=accounts`, or `tab` with `accountId` gives the defaults plus `FINANCE_URL_NOTICE`;
- the group shape is the same regex, defined once as `FINANCE_GROUP_SHAPE` in `financeUrl.ts` and imported by the route. This is a new import direction (route → `app/admin/finance/`; today the route imports only the shared `app/admin/components/adminWindowPresets`). The page cannot import a runtime constant from `lib/business-os/finance/` (types only, `source.guard.test.ts:50-58`). Alternative, if SA prefers: two copies, with a route test pinning that they are equal. SA rules this under SA-W83.

`serialiseFinanceUrl` writes `tab` only for Accounts, and `sort` / `group` / `show` only with the tab and only when they are not the default.

**Payload** (SA-W74):
- `accountEconomics` is present only when `accountsTab !== null` and `accountId === null`;
- `accountMargin` is present only when `accountId !== null`;
- both are absent otherwise.

---

## M3.2 The readers and the AI cost map

- **`boostRevenue.ts:155`** → `export function readMoney(...)`. **`planRevenue.ts:115`** → `export function readPlanMoney(...)`. Neither body changes. `refundsAndDisputesOf` stays private and remains the only code that reads the refunded amount or the dispute statuses (SA-Q45).
- **`aiCost.ts`** (SA-W79):
  - `UnitBucket` gains `unreadable: number`. `add` increments it when this row's cost was unreadable. The credits-unreadable count stays global, because the tab shows no credits-charged column.
  - `AiCostSummary` gains `units: { byAccount, deleted, total }` (non-wire, ledger cost units).
  - `figures` and `top` are computed exactly as today. A test checks that `figures.costUsd === units.total.cost / COST_SCALE`, and that the sum over `byAccount` plus `deleted` equals `total`.
- **`creditsSection.ts`** (SA-W78): `rowByAccount` holds every row before `rows.slice(0, input.displayCap)`. It is null whenever `figures` is null.
- **`planGroups.ts`** (SA-W77): `foundingPartnerNote` is added under the `:198` condition.

---

## M3.3 The pure builder `accountEconomics.ts`

**Purity (M3-FR-11, SA-WR-4, SA-W22).** The file:
- imports no repository, no Supabase, no entitlements path, no `server-only` and no clock;
- imports no `CreditLedgerRow` type, so the ledger caller list (`BusinessOsCreditLedgerReadRepository.test.ts:1072-1079`) is unchanged;
- takes the AI cost as the `units` map, not as ledger rows;
- imports `readMoney`, `BOOST_PAID_FAMILY` and type `BoostPurchaseInput` from `./boostRevenue`; `readPlanMoney`, `PLAN_PAYMENT_KIND` and type `PlanPaymentInput` from `./planRevenue`; `groupByCurrency`, `normaliseCurrencyCode` and `CURRENCY_SCALE` from `./currencyGroups`; `COST_SCALE` from `@/lib/business-os/credits/creditReport`; and types from `./financeTypes`;
- receives plan labels through `tierLabelOf` (the aiCost precedent) and `isPlatform` as a callback.

**Input (structural):**

```ts
interface AccountEconomicsInput {
  scope: 'all' | 'one';
  accountId: string | null;                       // 'one': the picked id
  coverage: FinanceCoverage;                      // Section 3's, from cutoverClamp
  aiCost: { units: AiCostUnits; reachedCeiling: boolean } | null;  // null: the ledger read failed
  boosts: { rows: readonly BoostPurchaseInput[]; reachedCeiling: boolean } | null;
  plans: { rows: readonly PlanPaymentInput[]; reachedCeiling: boolean } | null;
  walk: { accountIds: readonly string[]; capped: boolean } | null;  // null: the plan walk failed
  groupOf: (id: string) => FinanceGroupKey | undefined;
  foundingPartner: (id: string) => boolean;
  tierLabelOf: (key: FinanceGroupKey) => string | null;
  credits: ReadonlyMap<string, CreditsSectionRow> | null;          // null: no pass, or it failed
  isPlatform: (id: string) => boolean;
  query: { sort; group: string | null; show };    // 'all' only
  cap: number;                                    // TABLE_ROWS_SHOWN, 200
  groupOptions: ReadonlyArray<{ key: FinanceGroupKey; tierLabel: string | null }>;
}
```

### Paid us, after tax (M3-W-2, E-45, BD-22)

Per row, in integer minor units of its own currency:

| Source | Counted when | After tax |
|---|---|---|
| Plan | `row.kind === PLAN_PAYMENT_KIND` | `readPlanMoney(row)` null → **unreadable**; else `amount − tax` (0 for a zero invoice: not a payment, M2-W-5) |
| Boost | `row.status` in `BOOST_PAID_FAMILY` | `readMoney(row)` null → **unreadable**; else, with `net = total − refunded − held − lost`: `net === 0` → 0; `refunded === 0` → `net − tax`, or **inexact** if `tax > net` (SA-W81 (i)); `tax === 0` → `net`; otherwise **inexact** (SA-Q47) |

The boost step reads only the reader's result `{ total, tax, refunded, held, lost }`. It names no status and no column, so the DF-5 pin extended to this file allows **zero** tokens (E-44).

Rows are grouped per account (deleted rows under the Deleted key) and then per currency through `groupByCurrency`, with fields `plan`, `boosts` and `afterTax`. An unreadable or inexact row enters as `hundredths: null`, so it is counted in `unreadable` and adds nothing. A line is **exact** when:
- its read was not at the ceiling;
- `unreadable.afterTax === 0`;
- there is no `overflow`;
- its currency is not null.

The row's "plan X · boosts Y" sub-line is the `plan` and `boosts` sums of the **same** currency line. Only `afterTax` is shown as the line's figure. An inexact line shows "At least" for the total. If the line holds an inexact refund, it shows **Unknown** instead (M3-W-6: a net after a refund cannot be a lower bound). Nothing adds two lines: the file exports no function that takes two currencies.

### AI cost (M3-W-3, BD-18)

The cost is `units.byAccount.get(id)` (deleted: `units.deleted`).

| Case | Cell |
|---|---|
| Ledger read failed (`aiCost === null`) | Unknown on every row |
| `coverage === 'entirely_before_cutover'` | The cut-over notice, never `$0` (Section 3's AC-40) |
| `reachedCeiling` | "At least" |
| The account's `unreadable > 0` | Unknown |
| No ledger rows | An exact 0 |

### AI margin (M3-W-4 to M3-W-7; SA-W75, SA-W82)

The first rule that applies wins:

1. `coverage !== 'after_cutover'` → **Not available** ("Not available: AI cost is charged only from 29 Sep 2026").
2. Any line with a normalised non-USD currency → **n/a, different currency**. There is no partial USD margin.
3. Any of the following → **Unknown**:
   - the ledger, boost or plan read failed or is at its ceiling;
   - the cost is not exact;
   - the USD line is not exact;
   - there is an Unknown-currency line;
   - the subtraction overflows.
4. Otherwise `marginUnits = usdAfterTaxMinor * MINOR_TO_COST_UNITS − costUnits`, sent as `marginUnits / COST_SCALE`. If the account has no revenue line, the margin is a figure, `−cost`, with `noRevenue: true` ("No revenue in this window").

The comparison constant `MARGIN_CURRENCY = 'USD'` is declared once, with a comment citing BD-12 and BD-22. The ledger is USD by construction (CUR-5).

### Which accounts (M3-FR-2, SA-Q49)

The list is the union of:
- the plan walk's ids, when the walk succeeded and was not capped;
- every non-NULL `user_id` in the ledger, boost and plan rows that is not in the walk. These are flagged `noPlanRow`, grouped `unknown_held`, and their credits cell reads "No plan row".

When the walk failed or was capped, the list holds only the money ids, the tab is `partial`, and `notes.walkIncomplete` shows the M3-FR-2 sentence. A platform id carries `kind: 'platform'`, no name lookup and no link (SA-W85).

### Filter, sort, cap (M3-FR-4 to M3-FR-6, SA-W86, SA-W87)

1. Build every row.
2. Apply `group` (match on the account's group; with the walk failed, only `noPlanRow` rows have a group) and `show`.
3. Sort with the comparator of the chosen option (SA-W87). Ties go by account id.
4. `matching = rows.length`. Take `shown = rows.slice(0, cap)`.
5. Append the Deleted row under SA-W86.

`counts: { accounts, matching, shown, notListed: matching − shown }`.

The builder returns `shownIds`, the non-platform ids of the shown rows, at most 200, for the one names call.

### Platform line (M3-W-9, E-47)

The platform line is computed over **every** row, the Deleted row included, **before** the filter. It uses the same per-row inputs, merged per currency through `groupByCurrency` (one call over every row's entries; never two lines added). Its cost is `units.total.cost`. Its margin follows the same four rules, applied to all accounts together. It also carries `accountsCovered` so the page can say "every account".

### `buildAccountMargin` (M3-FR-8)

`buildAccountMargin` is the same rows code with `scope: 'one'`. It runs on the picked account's own reads and returns that account's `{ paid, aiCost, margin }`, using the **same** functions, so AC-142 holds by construction. It does no names call and no sort.

### Status (M3-FR-10)

- `unknown` when the ledger, boost and plan reads all failed.
- `partial` when any of these holds: one of those reads failed or is at its ceiling; there is an unreadable row or an inexact refund; the walk failed or was capped; the positions pass failed or was skipped.
- `ok` otherwise.

---

## M3.4 Wiring in `financeHealth.ts`

- `FinanceHealthInput` gains `accountsTab: FinanceAccountsTabQuery | null`.
- **No new read and no change to the `Promise.all`** (`:459-533`). The builder runs after Section 4 (`:744-791`), because it needs `units` (`:587-595`), `classified` (`:568-570`), `builtCredits.rowByAccount`, `boostPurchases.data`, `planPayments.data`, `plansResult.data` and `clamp.coverage` (`:426`).
- **All businesses with the tab:** `buildAccountEconomics`, then one `findNames(shownIds)` call, made only when `shownIds.length > 0`. That is at most 200 ids, one chunk (`BusinessProfileRepository.ts:35`). The names are attached with the existing four-state `nameStatus` mapping (the `:605-616` shape). A names failure logs `failed('account_names', …)` and gives `unavailable`.
- **All businesses without the tab:** the builder is **not called** and `findNames` gets no extra call (AC-145).
- **A business picked:** `buildAccountMargin` on R-a′ / R-k′ / R-m′. No names call.
- `counts.accountEconomics`: `{ built: false }` when the builder was not called; otherwise `{ built: true, status, accounts, matching, shown, deletedRow, noPlanRow, namesFound, sort, group: kindOf(group), show }`. These are counts and enum words only (M3-FR-14).

---

## M3.5 The M-1 summary line

`AccountSummary.tsx` gains one `Line`, "AI margin (USD)", directly under "Paid us, total" (`:193-195`). It selects from `payload.accountMargin` only: a figure through `formatUsd`, or "No revenue in this window" with the figure, "n/a, different currency", "Unknown" or "Not available …". The component does no arithmetic and no `.reduce(` (the AC-112 rule, `source.guard.test.ts:161-164`).

---

## M3.6 Failure matrix

Each line is one read failing alone. The Overview always renders, and every other section is unchanged.

| Read fails | AI cost column | Paid us column | Margin | Credits | Tab status | Notice |
|---|---|---|---|---|---|---|
| R-a ledger | Unknown | as read | Unknown | as read | partial | "AI cost could not be loaded" |
| R-k boosts | as read | Unknown (the plan part still shows) | Unknown | as read | partial | "Boost payments could not be loaded" |
| R-m plans | as read | Unknown (the boost part still shows) | Unknown | as read | partial | "Plan payments could not be loaded" |
| Plan walk | as read | as read | as read | Unknown (no pass) | partial | M3-FR-2 sentence (money-only list) |
| Positions pass | as read | as read | as read | Unknown | partial | "Credits could not be loaded" |
| Names | names "Unavailable" | — | — | — | unchanged | none (the existing precedent) |
| R-a, R-k and R-m together | — | — | — | — | **unknown** | "Could not load" + Retry |

---

## M3.7 The page

**`FinanceTabs.tsx`** (page-local, SA-Q43):
- the APG tablist, with **manual activation**: Left / Right / Home / End move focus, and Enter / Space select;
- a roving `tabIndex`, with `aria-controls` / `aria-labelledby` pairs, following `business-os-llm/page.tsx:227-245` and `:285-297`;
- no export from the shared layout folder (SA-R-3).

Selecting a tab calls `setQuery`, the existing `router.replace(…, { scroll: false })` (`FinanceView.tsx:55-58`). It sets `tab` and resets `sort` / `group` / `show` to their defaults on leaving Accounts.

**`FinanceView.tsx`**:
- With `query.accountId === null`, it renders the tabs. Overview renders today's body unchanged (`:121-148`), and Accounts renders `AccountsTab` from `data.accountEconomics`.
- With a business picked there are no tabs.
- `onPick` and the chip's remove set `tab: null` and the defaults (M3-FR-1).

**`AccountsTab.tsx`** shows, in this order:
1. The always-on notes (M3-FR-9, from `financeCopy.ts`).
2. The S4-W-3 refund-timing sentence, only when `notes.refundOrDispute` (the 4a condition). It uses the **same** `REVENUE_REFUND_TIMING_NOTE`, so the SA-WR-38 user list becomes **three** files. The alternative is an `AccountsTab`-owned pointer line; see the guard table, row "SA-WR-38".
3. The platform line, labelled "All accounts, before any filter".
4. Three `select`s for sort / group / show. The options for group come from `groupOptions` (server labels; no tier in the page).
5. The count line through `formatCount`: "Showing x of N accounts" and, when cut, "N more accounts not listed; narrow with a filter".
6. The table, or `AdminEmpty` with "No accounts match this filter".

**`AccountEconomicsTable.tsx`**:
- Uses the shared table constants. Money, cost and credit cells are `ADMIN_TD_NUM`.
- The business cell holds a name, else `formatShortId`, else the platform label. Each linked row's link is a Next `<Link>` to `accountViewHref(id, data.window)`.
- The Founding Partner chip is a `StatusChip` when `foundingPartner`, and "No plan row" is a note.
- The Deleted row comes last, with no link.
- The components only **select and format**: no `.sort(`, no `.reduce(`, no `+` / `-` between money fields, no `.filter(` over rows (M3-FR-13).

**`financeLinks.ts`**: `accountViewHref(accountId, window)` returns `/admin/finance?preset=<p>[&from&to]&accountId=<id>`. It uses literal keys only, so the file still imports only the wire types (`:23`).

**Copy:** all new strings go in `financeCopy.ts`, with no dim text (`text-slate-400` floor) and no test-mode wording.

---

## Entitlements registration check

I followed the `business-os-entitlements` skill row by row.

| Tripwire | 6a |
|---|---|
| A file outside the module **newly** imports from it | **No.** `accountEconomics.ts` imports nothing from it. Labels arrive as `tierLabelOf`, built in `financeHealth.ts` from `tierLabelForGroup` (a finance file, `planGroups.ts:250`). The route matches `group` by shape (SA-W83), so it needs no import. The finance guard "only `planGroups.ts` and the wiring import the module" (`:185-188`) proves it |
| A listed file's symbol set changes | **No.** `planGroups.ts` gains a return field, not an import. `financeHealthDeps.ts` is not edited (`enforcementPoints.test.ts:515-535`) |
| A tier name as a literal | **None.** The group regex holds no tier id. Fixtures take tiers from `getEntitlementConfig().tierOrder` (the `finance.source.guard.test.ts:61` precedent). `tierLiteral.forbidden.test.ts` and the finance tier rule (`:164-168`) run |
| A capability id literal; a catalog or matrix change | None |
| A gate | None: display only, and nothing is refused |

`npm run test:bos-entitlements` runs before handover (V-4).

---

## Tenant isolation check

I followed the `tenant-isolation-guard` skill.

- **Service role, caller-supplied id.** The only caller-supplied id is still `accountId`, which is UUID-validated behind `requireAdmin`. The route refuses a platform id (`route.ts:154-157`), and the builder checks the id against the plan table **before** any read (`financeHealth.ts:405-415`). `tab=accounts` with `accountId` is now a 400 (SA-W84), so the tab can never mix the platform-wide build with a picked id.
- **The new keys** are enums, or the group shape. None of them is an id or reaches a query: they only order and select rows already read.
- **No write**, no trigger, no upsert and no payload, so the write half of the skill does not apply.
- **Picked business.** `buildAccountMargin` sees only R-a′ / R-k′ / R-m′, which already take exactly that id. No all-accounts read is added to the picked view (AC-42 holds).
- **Names** are looked up only for ids taken from rows already read and shown (≤ 200). They are never looked up for a platform account or for NULL. The Deleted row is never named or linked.
- **Links** carry only the id and the window (AC-144). A platform row has no link (SA-W85).

---

## Guard table, line by line

| Guard | 6a trips it? | Exact change |
|---|---|---|
| **`finance.source.guard.test.ts` boost export pin** (`:769-775`) | **Yes** (SA-Q45) | List becomes exactly `BOOST_PAID_FAMILY, BoostPurchaseInput, BoostRevenueResult, buildBoostRevenue, readMoney`; title and a reason comment name SA-Q45 / E-44. No other export |
| **Same file, plan export pin** (`:917-922`) | **Yes** (SA-Q45) | List becomes exactly `PLAN_PAYMENT_KIND, PlanPaymentInput, PlanRevenueResult, buildPlanRevenue, readPlanMoney`; reason comment. No other export |
| **Same file, DF-5 pin** (`:684-716`) | **Extended** (E-44) | A new case: `accountEconomics.ts`'s code contains **zero** `DF5_TOKENS` (`amount_refunded_minor`, `'disputed'`, `'dispute_lost'`). Planted control: the file's code plus `r.amount_refunded_minor` is caught. The `boostRevenue.ts` cases are unedited |
| Same file, the refund-note pin SA-WR-35 / SA-WR-38 (`:718-741`) | **Yes, only if** `AccountsTab.tsx` reuses the sentence | Recommended: allowed users become exactly `[RevenuePanel.tsx, AccountSummary.tsx, AccountsTab.tsx]`, with a planted fourth user as the control. Still one constant and one sentence (the SA-W58 (a) reasoning) |
| Same file, every `FILES` rule: write verb (`:123-131`), aggregate / `token_usage` (`:134-137`), tier literal (`:164-168`), cohort literal, entitlements importers (`:185-188`), `livemode` (`:366-376`), exchange rate (`:379-385`), processor literal (`:409-415`), `MONEY_ARITHMETIC`, `MONEY_4A`, `MONEY_5A` over `app/admin/finance/` | No; they apply to the new files automatically (the `walk`) | Run unchanged |
| Same file, `REPOSITORY_TABLES` (`:291-321`) | **No** (no repository change) | Run unchanged |
| Same file, `currencyGroups.ts` export pin (`:388-393`), `ourRevenue.ts` pin (`:924-929`), `KIND_LITERAL` positive pin (`:932-942`, still exactly the repository and `planRevenue.ts`) | **No** | Run unchanged |
| **Same file, new `slice 6a` describe** | Added | See the list after this table |
| `app/admin/finance/__tests__/source.guard.test.ts` | No, by construction | New rules: below |
| `BusinessOsFinanceReadRepository.test.ts` caller list (`:561-563`), limits, no-write | **No** (no method, no new caller) | Run unchanged |
| `BusinessOsCreditLedgerReadRepository.test.ts` caller list (`:1072-1079`) | **No**: `accountEconomics.ts` takes `units`, not `CreditLedgerRow` | Run unchanged; T8 (c) pins that the builder does not name the type |
| `businessOsEntitlements.imports.guard.test.ts` plan-repository list (`:186-199`) | **No**: `planGroups.ts` keeps its one type import | Run unchanged |
| `creditLots.test.ts` balance-core namers (`:227-238`) | **No**: `accountEconomics.ts` names no lot symbol; it reads `CreditsSectionRow` as a type only | Run unchanged |
| `BusinessOsBillingEventRepository.test.ts` caller list | **No** | Run unchanged |
| `serviceColumn.guard.test.ts` (N-10, AGG-6) | **No**: per-account cost never reads `service` | Run unchanged (it walks `lib/business-os/finance`, so the new file is scanned) |
| `tierLiteral.forbidden.test.ts`, `enforcementPoints.test.ts` | **No** | `test:bos-entitlements` (V-4) |
| Webhook placement: `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`, `firstPaymentStamp.guard` | **No**: nothing under `lib/business-os/billing/` | Run unchanged (V-6) |
| `layoutFolder.guard.test.ts`; contrast LF-1 guard | **No**: no file in the shared folder; Finance is still not in the contrast walk (DF-4) | Run; new files held to `text-slate-400` by the page rule |
| `financeUrl.test.ts` key pin (`:86-88`) | **Yes** | Updated to the eight keys |
| Finance route test "an unknown key" (`:383`, `name`) | No | Run; new cases added |
| Admin authz surface guard | **No**: no new route or page | `test:authz-guard` (V-5) |

**The new `slice 6a` describe in `finance.source.guard.test.ts`.** Every rule has a planted negative control.

- **(a) Non-vacuity.** `FILES` contains `accountEconomics.ts` and the three new page files. `LAYER_B_FREE` contains `accountEconomics.ts`.
- **(b) Scale (SA-W75):**
  - no `toHundredths`, no `toUnits(`, no `* 100`, no `CURRENCY_SCALE *`;
  - exactly one `* MINOR_TO_COST_UNITS`;
  - exactly one `/ CURRENCY_SCALE` and one `/ COST_SCALE`;
  - `MINOR_TO_COST_UNITS = COST_SCALE / CURRENCY_SCALE` declared once.
- **(c) Pure.** `read(file)` does not match `IMPURE` (`:880`). There is no `CreditLedgerRow`, `BusinessOsCreditLedger`, `business_os_` or `payment_` in the code, and no `new Date(` or `Date.now(`.
- **(d) Readers, not rows.** The file calls `readMoney(` and `readPlanMoney(`. It names no `amount_total_minor`, `amount_tax_minor` or `amount_minor`, so money is read **only** through the exported readers. It filters with `BOOST_PAID_FAMILY` and `PLAN_PAYMENT_KIND`.
- **(e) Exports pinned exactly:** `AccountEconomicsInput`, `buildAccountEconomics`, `buildAccountMargin`. No export takes or returns a total across currencies, and the file has no `exchange_rates`, `fx` or `rate`.
- **(f) `'USD'` is written once.** `MARGIN_CURRENCY` is the only `'USD'` literal in the file.
- **(g) No `livemode`, `stripe_` or mode wording** in the builder, the three page files or the new copy.

**New rules in `app/admin/finance/__tests__/source.guard.test.ts`** (each with a planted control):
- `AccountsTab.tsx`, `AccountEconomicsTable.tsx` and `FinanceTabs.tsx` contain no `.sort(`, `.reduce(` or `.filter(` (M3-FR-13, AC-147). A new `MONEY_6A` rule (a copy of `MONEY_5A`'s shape over `afterTax|planAfterTax|boostsAfterTax|costUsd|marginUsd`, so `MONEY_5A` itself is not edited) checks that no page file adds or subtracts any of them.
- The four new or edited page files have no dim text (the M-1 rule, `:132-141`).
- `financeLinks.ts` still imports only `@/lib/business-os/finance/financeTypes` (`:167-171`, unchanged).
- `FinanceTabs.tsx` is not exported outside `app/admin/finance` (no file under `app/admin/components/` imports it).

No new CI job and no added critical-path time: every new test runs in the existing Jest gate (`feedback-no-added-ci-time`).

---

## AC mapping

| T | Test file |
|---|---|
| T1 | `accountEconomics.test.ts` (new) |
| T2 | `aiCost.test.ts` |
| T3 | `boostRevenue.test.ts` / `planRevenue.test.ts` (readers unchanged, now exported) |
| T4 | `creditsSection.test.ts` / `planGroups.test.ts` |
| T5 | `financeHealth.test.ts` |
| T6 | `finance.source.guard.test.ts` |
| T7 | finance `route.test.ts` |
| T8 | `financeUrl.test.ts` / `financeLinks.test.ts` |
| T9 | `financePage.render.test.tsx` |
| T10 | `accountsTab.render.test.tsx` (new) |
| T11 | `financeAccount.render.test.tsx` |
| T12 | `app/admin/finance/__tests__/source.guard.test.ts` |
| QA | A recorded manual step / SQL check |

| AC | Test / check |
|---|---|
| **AC-130** | T9: no business picked → tablist with Overview (selected) and Accounts; `tab=accounts` in the URL → Accounts selected on mount (a reload); a business picked → no tablist, and `onPick` writes no `tab`. T10: keyboard (Left / Right / Home / End move focus; Enter selects; roving `tabIndex`). T8: `tab` round trip; `tab` with `accountId` → notice |
| **AC-131** | T1: 8 walk ids plus one money-only id → 9 rows, the extra one `noPlanRow` and `unknown_held`; a NULL-`user_id` row → Deleted row last, outside the cap; a platform id → `kind: 'platform'`, no name id, no link (SA-W85). T10: labels render |
| **AC-132** | T1 against `checkNineteen` (an independent TS port of check 19's SQL): `usdAfterTaxMinor / 100` equals the row; an ILS line on its own; plan and boost parts in the same currency. QA: check 19 |
| **AC-133** | T1, one case per row: plan 7900 / tax 500 → 74.00; boost `paid` 1000 / tax 100 → 9.00; `refunded` in full → 0; `partially_refunded` tax 0 → total − refunded; `partially_refunded` tax > 0 → Unknown net and margin; `disputed` and `dispute_lost` → 0. Plus SA-W81 (i) (tax > net → Unknown) and (ii) (status `paid` with a refund, E-45's result) |
| **AC-134** | T1: each account's cost equals `units.byAccount`; the platform line's cost equals `units.total.cost / COST_SCALE`, unchanged by any filter or cap and including the Deleted bucket. T5: platform line text equals Section 3's `figures.costUsd` on the same payload. QA: check 19 `ai_cost_usd`, check 20 |
| **AC-135** | T1: USD 8900 after tax, cost 1.2345 → margin 87.7655 (integer units, SA-W75); no revenue → `−cost`, `noRevenue: true`; negative allowed; equals `checkNineteen`'s `ai_margin_usd`. QA: check 19 |
| **AC-136** | T1: an ILS boost alone, and ILS beside USD → `other_currency`, the ILS line on its own, no USD-only margin; the platform line → `other_currency`. T6 (e): no export adds two currencies. T7: payload walker finds no money key without a `currency` beside it in `accountEconomics` (except USD-only cost and margin fields, named `costUsd` / `marginUsd`). T10: "n/a, different currency" |
| **AC-137** | T1: `reachedCeiling` on each of R-a, R-k and R-m in turn → "At least" on that part and margin Unknown on every row; status `partial`. T5: injected small ceiling through the fake repository gives the same. T10: the notice |
| **AC-138** | T5: each of ledger, boosts, plans, plan walk and positions failing alone → Unknown in its column only (walk: the M3-FR-2 notice, money-only list), tab `partial`, every Overview section present; all three money reads failing → tab `unknown`. T7: 200 in every case |
| **AC-139** | T1: `coverage` `starts_before_cutover` and `entirely_before_cutover` → `not_available` on every row and the platform line; revenue and cost still present (entirely before: the cost notice). T10: the sentence. QA: a window from 2026-09-15 |
| **AC-140** | T1: a fixture with numbers, n/a, Unknown, Not available, a second currency and ties; each of the four sorts orders as SA-W87; 201 accounts where the account ranked 201 by AI cost is ranked 1 by margin → absent under the default, present under `sort=margin` |
| **AC-141** | T1: `group` and each `show` option narrow rows; "Negative AI margin" excludes n/a, Unknown and Not available; the platform line is identical under every filter (deep-equal). T7: the route passes the parsed filters to the builder |
| **AC-142** | T5: the owner fixture (plan 7900, boost 1000, tax 0, cost X) → the tab row's margin equals `accountMargin` for the same window, and both equal 89.00 − X; `revenue.totals` still reads USD 89.00 (tax included). T11: the summary line renders under "Paid us, total". QA: L-75 to L-80 |
| **AC-143** | T1: 250 accounts → 200 shown, `matching` 250, `notListed` 50, Deleted row extra. T5: `findNames` receives ≤ 200 ids, each taken from the rows read, no platform id. T10: "Showing 200 of 250 accounts" and the "50 more" sentence |
| **AC-144** | T8: `accountViewHref` parsed back through `parseFinanceUrl` gives exactly `{ preset, from, to, accountId }` and no other key, for every preset and custom. T10: each linked row's `href`; Deleted and platform rows have no link |
| **AC-145** | T7: the baseline test written **before** any product change (step 1) passes unchanged at the end: without `tab`, the same read calls with the same arguments, the same `findNames` calls and the same top-level payload keys; no `accountEconomics` or `accountMargin` key |
| **AC-146** | T7: malformed `tab`, `sort`, `group` and `show` → 400; `sort` / `group` / `show` without `tab` → 400 (E-48); `tab` with `accountId` → 400 (SA-W84); 401 and 403 → zero calls on every read in `allReads()`. T8: the page falls back to defaults with `FINANCE_URL_NOTICE` |
| **AC-147** | T12: no `.sort(`, `.reduce(`, `.filter(` or money arithmetic in the tab components. T7: the info line carries `sections.accountEconomics` and `counts.accountEconomics` as statuses, counts, booleans and enum words only (a planted amount, name, currency and tier id appear in no log call); the payload has no `stripe_`, `livemode` or tier literal key. T1: a test-mode and a live row count together with no mode field |
| **AC-148** | V-1 to V-11 below; V-10: `git diff --stat` shows no migration, no repository file and no `lib/business-os/billing/` path; T6 write-verb rule over the new file; V-9 scoped `tsc` with canary |
| **AC-149** | QA L-75 to L-80 (below; QA's list governs) and V-12 (checks 19 and 20) |

---

## Verification plan

The worktree has the `node_modules` junction. Never run `git worktree remove`, `git stash` or `npm install` through it. Before SA code review, I run every command below and paste the command, its own exit code and the counts. Exit codes are read from the tool, never from a pipe.

| # | Command | Evidence |
|---|---|---|
| V-1 | **Finance suites:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Suites and tests passed |
| V-2 | **`app/admin/users`** (the M-1 links back): `npx jest app/admin/users --ci`, then `git diff --exit-code -- app/admin/users app/api/admin/users` | Pass; exit 0 |
| V-3 | **Layout and picker guards:** `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm/__tests__/source.guard.test.ts --ci` | Pass; layout folder and contrast named in the output |
| V-4 | `npm run test:bos-entitlements` | Exit 0 |
| V-5 | `npm run test:authz-guard` | Exit 0 |
| V-6 | **Billing guards and caller lists, unchanged:** `npx jest lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts lib/business-os/credits/__tests__/creditLots.test.ts lib/business-os/credits/__tests__/serviceColumn.guard.test.ts lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts lib/payments/__tests__/planSurfaces.guard.test.ts --ci`, then `git diff --exit-code -- lib/repositories lib/business-os/billing lib/business-os/credits lib/business-os/entitlements app/api/stripe lib/payments supabase` | Pass; exit 0 |
| V-7 | `npm run lint:hooks` | Exit 0 |
| V-8 | `npx eslint <every touched and new file>` | Clean |
| V-9 | **Scoped `tsc` with a canary**, procedure below | The canary reports TS2322, then the clean run |
| V-10 | `git diff --stat` and `git diff --numstat`, read **before** the diff (the truncation lesson):<ul><li>no file that loses lines without gaining any;</li><li>no `supabase/`, `lib/repositories/` or `lib/business-os/billing/` path;</li><li>no requirement MD from Dev.</li></ul> | Output pasted |
| V-11 | `npm run schema:check` if the worktree has credentials; otherwise the note "no new column is read: every field is already read by R-a, R-k and R-m (§11E.1)" | Output or the note |
| V-12 | **Read-only SQL checks 19 and 20, for the user / QA** (§13) | Table below |

**V-9 procedure (SA-WR-7).**
1. Write a tsconfig **outside the worktree**, at `C:\Users\Barak\AppData\Local\Temp\claude\…\scratchpad\tsconfig.6a.json`, with:
   - an absolute `extends` to the worktree's `tsconfig.json`;
   - `compilerOptions: { noEmit: true, incremental: false }`;
   - `include` = the worktree's `types/**/*.d.ts`, `next-env.d.ts`, and every touched and new `.ts` / `.tsx` file, tests included, as absolute paths.
2. Plant `const __canary: number = 'x';` in `lib/business-os/finance/accountEconomics.ts`.
3. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>` and record its own exit code. It **must** report TS2322 at the canary, or the run is not evidence.
4. Remove the canary (`grep -c __canary` must be 0) and re-run.
5. Record every diagnostic: zero in touched files, and any pre-existing one attributed by path. The scratch config is never written into the worktree.

**V-12, the read-only SQL checks, for the user.** Run checks 19 and 20 in the Supabase SQL editor. In **both**, replace `null` in the `p` block with `'2026-10-01 00:00:00+00'`, so the October figures reproduce in any month (the SA-WR-40 precedent). Compare with Finance → **Accounts**, **This month** in October, or Custom 2026-10-01 to the last day. Ledger cost is USD at the ledger scale. Revenue is in minor units, so divide by 100.

| Check | Column | Expected (live facts, §11E.1) | Page figure |
|---|---|---|---|
| 19 | owner account (`5f63adbd…`) `usd_revenue_after_tax_minor` | **8900** (plan 7900 + boost 1000, tax 0) | "Paid us, after tax" **USD 89.00**, sub-line "plan USD 79.00 · boosts USD 10.00" |
| 19 | owner `other_currencies` / `inexact_revenue_rows` | `''` / 0 | One USD line; margin shown |
| 19 | owner `ai_cost_usd` | X (its charged cost in October) | "AI cost, charged" USD X (`formatUsd`, up to 4 dp) |
| 19 | owner `ai_margin_usd` | **89 − X** (rounded to 6 dp by the SQL) | "AI margin" USD 89 − X; the M-1 summary line the same |
| 19 | each other account (6 on the ledger in October) | `usd_revenue_after_tax_minor` 0, margin −cost | Margin −cost with "No revenue in this window" |
| 19 | row order | `order by 5 desc` = AI cost highest first | The default sort |
| 20 | `usd_revenue_after_tax_minor` / `other_currency_rows` / `inexact_revenue_rows` | 8900 / 0 / 0 (if no other account paid in October) | Platform line "Paid us, after tax" USD 89.00 |
| 20 | `ai_cost_usd` | Sum over the 6 accounts | Platform line AI cost = Section 3's total on Overview |
| 20 | `ai_margin_usd` | 89 − total cost | Platform line AI margin |

Known divergences, both absent live: SA-W81 (ii), a status-`paid` row with a refund; and SA-W81 (i), tax > net, which the page shows as Unknown while the SQL gives a negative figure.

**Manual QA steps (proposal; QA's list governs, 5a retro conclusion 4).** Run `npm run dev` from `neuronforge-finance-health`, signed in as a platform admin.

| # | Step | Expected |
|---|---|---|
| L-75 | `/admin/finance` → **Accounts**, This month (October 2026) | The tab is selected and `tab=accounts` is in the address bar. The notes show. The platform line says "All accounts, before any filter". Rows are by AI cost, highest first. The owner account shows USD 89.00 after tax, its charged AI cost, and the margin from check 19. Its plan group ("Essentials") carries the Founding Partner chip if its period is current. Its credits show "used / allowance (%)" |
| L-76 | Sort by AI margin, then by AI cost; Show "Paid us or used AI"; group Essentials | Order changes on the server (`sort` / `show` / `group` in the URL); the count line updates; the platform line never changes |
| L-77 | Click the owner row | The one-account view on the same window: no tabs; the summary's "AI margin (USD)" equals the row's margin. "Paid us, total" still USD 89.00 |
| L-78 | Back on Accounts, Custom 2026-09-15 to 2026-10-14 | Every margin and the platform line read "Not available: AI cost is charged only from 29 Sep 2026"; revenue and cost still show with the cut-over notice |
| L-79 | Run checks 19 and 20 (V-12) | Every row matches |
| L-80 | Read the dev-server log for both tabs | One "Admin read the Business OS finance page" line each, with `sections.accountEconomics` (`not_built` on Overview), `counts.accountEconomics` (counts and enum words only; `group` as a kind), and `durationMs`. No amount, name, currency total or tier id. **Record `durationMs` for both tabs** (M3-FR-16, p95 under 2 s) |

---

## Logging

- **No new log line in the builder.** `accountEconomics.ts` is pure and logs nothing.
- **`financeHealth.ts`:** one more `failed('account_names', err)` on a names failure. This is the existing `error { read, err }` shape.
- **The route's accountability line** gains:
  - `sections.accountEconomics`: `'not_built' | 'ok' | 'partial' | 'unknown'`;
  - `counts.accountEconomics`: counts, booleans and enum words only (M3-FR-14, SEC-8).
- **`group` is logged as its kind** (`'all' | 'trial' | 'founding_partner' | 'comped' | 'tier' | 'unknown_held' | 'tier_set'`), never a tier id (SA-W83).
- **Never logged:**
  - an amount, a margin, a cost or a currency total;
  - a business name;
  - a tier id or label;
  - an account id beyond the existing validated `accountId` filter.
- Errors go as `{ err }`. No `console.*` (T6 and the page guard pin it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Margin off by a scale factor (cents against 1e-10 USD) | One named `MINOR_TO_COST_UNITS`; guard (b) pins exactly one multiply and one division each; a unit test with 8900 minor and 1.2345 USD gives 87.7655 exactly |
| R-2 | A cross-currency sum in a row, the platform line or the payload | `groupByCurrency` only; no export takes two currencies (T6 (e)); the payload walker (T7); AC-136 fixtures |
| R-3 | The rows and Section 3 disagree on cost | One sum: `units` comes from the same `summariseAiCost` pass (SA-Q46, SA-W79); T5 compares the texts |
| R-4 | DF-5 tokens leak into the new builder | Readers only (T6 (d)); the DF-5 pin extended with zero tokens and a planted control (E-44) |
| R-5 | The Overview payload changes by accident | The baseline test is written first and must stay green (AC-145); optional keys absent, not null (SA-W74) |
| R-6 | The page sorts or filters | Server only; page rules ban `.sort(` / `.filter(` / `.reduce(` in the tab components (T12) |
| R-7 | The URL keeps `sort` / `show` on Overview or with a business | Serialise writes them only with the tab; `onPick` drops them; route 400 (E-48, SA-W84) mirrored by the parser (T8) |
| R-8 | Route latency on the Accounts tab | No new read; one names call ≤ 200; O(rows) builder (≤ 20,000 ledger + 10,000 money rows); `durationMs` for both tabs at L-80 |
| R-9 | A guard trips that §11E.6 does not list | Every caller list naming a finance file (ledger, finance, plan, lots, billing) and N-10 was opened and is in the guard table; V-6 runs them all |
| R-10 | A tier id reaches the log through `group` | Logged as its kind (SA-W83); T7 plants a tier id and asserts it is in no log call |
| R-11 | Another agent's requirement edits appear in the diff | Dev never edits the requirement; V-10 reads the stat first; RM decides what joins the PR |
| R-12 | The junction | Never `git worktree remove`, `git stash` or `npm install`; stop and report instead |
| R-13 | Known noise: the Jest worker-exit warning (FU-4a-3) and the load-sensitive render suites outside this diff (FU-5a-3) | Cite the follow-up; do not re-investigate |
| R-14 | No user diff review (pre-authorised) | Each SA-W is ruled before code; the checklist below is filled with evidence; SA re-checks every guard row at code review |

---

## Estimate

About **3 days**, as S6-F6 accepted. I report at the end of day 1 if the builder and route are not green.

| Day | Work |
|---|---|
| 0.25 | AC-145 baseline route test (green on unchanged code) |
| 0.5 | Reader exports and their pins; `aiCost` units map; `creditsSection.rowByAccount`; `planGroups.foundingPartnerNote`; T2 to T4 |
| 1.0 | `accountEconomics.ts` with T1 (including `checkNineteen` / `checkTwenty`) |
| 1.5 | Types, `financeHealth.ts` wiring, route Zod and info line; T5, T7. **End-of-day-1 checkpoint** (S6-F6) |
| 2.25 | `financeUrl.ts`, `financeLinks.ts`, `FinanceTabs.tsx`, `AccountsTab.tsx`, `AccountEconomicsTable.tsx`, `FinanceView.tsx`, `AccountSummary.tsx`, copy; T8 to T11 |
| 3.0 | The 6a guard describe and page rules (T6, T12); V-1 to V-11 and the canary; results pasted |

---

## Task List

- [x] ✅ 0. SA workplan review; apply the rulings on SA-W74 to SA-W89 (all approved; SA-WR-41 to SA-WR-45 applied)
- [x] ✅ 1. Branch `feature/bos-money-m3` confirmed (`git branch --show-current`); junction present; nothing committed
- [x] ✅ 2. AC-145 baseline route test, green on unchanged code
- [x] ✅ 3. `export` `readMoney` and `readPlanMoney`; the two export pins updated with reason comments (E-44); T3
- [x] ✅ 4. `aiCost.ts` units map (SA-W79); `creditsSection.ts` `rowByAccount` (SA-W78); `planGroups.ts` `foundingPartnerNote` (SA-W77); T2, T4
- [x] ✅ 5. `accountEconomics.ts` + T1
- [x] ✅ 6. `financeTypes.ts`; `financeHealth.ts` (input, builder calls, names, counts); T5
- [x] ✅ 7. Route Zod (E-48, SA-W84, SA-W83 shape), input, info line, header; T7. End-of-day-1: builder and route green in the same session, no report needed
- [x] ✅ 8. `financeUrl.ts`, `financeLinks.ts`; T8
- [x] ✅ 9. `FinanceTabs.tsx`, `AccountsTab.tsx`, `AccountEconomicsTable.tsx`, `FinanceView.tsx`, `AccountSummary.tsx`, `financeCopy.ts`; T9 to T11
- [x] ✅ 10. The 6a guard describe and the DF-5 extension (T6); page rules (T12); the refund-note pin (three users, planted fourth)
- [x] ✅ 11. V-1 to V-11 with their own exit codes; canary; outputs pasted in Implementation Notes
- [x] ✅ 12. Hand over to SA code review, uncommitted. The requirement MDs are not edited by Dev

---

## Checklist before SA code review

- [x] ✅ `git branch --show-current` = `feature/bos-money-m3`; nothing committed; no stash used
- [x] ✅ `git diff --stat` read **before** the diff: no deletion-only file; no migration, repository or billing path; no requirement MD from Dev
- [x] ✅ The AC-145 baseline test was written first and is still green, unedited (hunk proof below)
- [x] ✅ `boostRevenue.ts` and `planRevenue.ts` export lists are exactly the pinned five names each; `refundsAndDisputesOf` still private
- [x] ✅ `accountEconomics.ts` contains zero DF-5 tokens and reads money only through the two readers
- [x] ✅ No new import from the entitlements module; `planGroups.ts` / `financeHealthDeps.ts` symbol sets unchanged; no tier literal (fixtures from `tierOrder`)
- [x] ✅ Margin in integer ledger units: one `* MINOR_TO_COST_UNITS`, one `/ COST_SCALE`, one `/ CURRENCY_SCALE` (besides the constant's declaration); no × 100
- [x] ✅ No total across currencies in any export, payload field or element; the platform line covers every account before filter and cap
- [x] ✅ Without `tab`: no `accountEconomics` key and no extra `findNames` call; with a business picked: `accountMargin` only, no all-accounts read
- [x] ✅ `findNames` for the Accounts tab receives ≤ 200 ids, none platform, none NULL
- [x] ✅ Platform and Deleted rows have no link; every link carries only the id and the window
- [x] ✅ Tab components hold no `.sort(`, `.filter(`, `.reduce(` or money arithmetic
- [x] ✅ Every new guard rule has a planted negative control
- [x] ✅ No `console.*`; Pino only; errors as `{ err }`; no amount, name or tier id in a log
- [x] ✅ V-1 to V-11 pasted with their own exit codes; the canary reported TS2322 before the clean run
- [x] ✅ `npm run test:bos-entitlements` and `npm run test:authz-guard` green on the final diff

---

## Implementation Notes

**Dev, 2026-10-14/15.** Built on `feature/bos-money-m3` (worktree `neuronforge-finance-health`), uncommitted, no stash, no worktree command.

### Files

Created (7):
- `lib/business-os/finance/accountEconomics.ts`
- `lib/business-os/finance/__tests__/accountEconomics.test.ts`
- `app/admin/finance/components/FinanceTabs.tsx`
- `app/admin/finance/components/AccountsTab.tsx`
- `app/admin/finance/components/AccountEconomicsTable.tsx`
- `app/admin/finance/__tests__/accountsTab.render.test.tsx`
- this workplan (pre-existing, untracked)

Modified product files (14): `boostRevenue.ts`, `planRevenue.ts`, `aiCost.ts`, `creditsSection.ts`, `planGroups.ts`, `financeTypes.ts`, `financeHealth.ts` (all under `lib/business-os/finance/`); `app/api/admin/business-os/finance/route.ts`; `app/admin/finance/financeUrl.ts`, `financeLinks.ts`, `financeCopy.ts`, `components/FinanceView.tsx`, `components/AccountSummary.tsx`.

Modified tests (12): `aiCost`, `boostRevenue`, `planRevenue`, `creditsSection`, `planGroups`, `financeHealth`, `finance.source.guard` (all `lib/business-os/finance/__tests__/`); finance `route.test.ts`; `financeUrl.test.ts`, `financeLinks.test.ts`, `financePage.render.test.tsx`, `financeAccount.render.test.tsx`, `app/admin/finance/__tests__/source.guard.test.ts`.

Not touched: every repository and repository test, `financeHealthDeps.ts`, `ourRevenue.ts`, `currencyGroups.ts`, `FinanceFilterBar.tsx`, `useFinanceData.ts`, every billing / Stripe / payments / entitlements / migration path, the requirement MDs.

### SA-WR-41 to SA-WR-45

| Item | Done |
|---|---|
| SA-WR-41 | SA-W75 row corrected to about USD 900,719. Tests in `accountEconomics.test.ts` § SA-WR-41: revenue at `floor(MAX_SAFE_INTEGER / 1e8)` minor gives the exact figure on the row and the platform line, one more minor gives Unknown on both; cost units past `MAX_SAFE_INTEGER` give cost and margin Unknown (row and platform line), `MAX_SAFE_INTEGER` itself gives the figure |
| SA-WR-42 | Purity pin of `financeUrl.ts` (no `'use client'`, no `react` / `next/*`, no `server-only`, runtime import only `adminWindowPresets`) with five planted controls, in `finance.source.guard.test.ts` 6a describe. Route tests: `tab=accounts&group=tier:no-such-tier` → 200, no rows; `group=tier:Bad!` and `group=vip` → 400 |
| SA-WR-43 | `marginText` prints `formatUsd` (sign kept: "USD -0.1234", tested in the tab and the summary); headers "AI cost, charged (USD)" and "AI margin (USD)"; the cost cell is `atLeast(formatUsd(costUsd), exact)`, Section 3's own expression, pinned equal to `formatUsd(1.2345)` in the render test and to Section 3's `costUsd` per account in `financeHealth.test.ts` |
| SA-WR-44 | The AC-145 baseline was written first and run green on unchanged `d05eb0a4` code (61/61). It is never edited afterwards: `git diff -U0` of `route.test.ts` has exactly two hunks, `@@ -1076,0 +1077,99 @@` (the baseline, byte-identical to the scratch copy taken when it went green) and `@@ -1123,0 +1223,155 @@` (the 6a describe, appended after `source`). It pins every read call with its arguments, the four `findNames` calls, the ten top-level keys, and the SHA-256 of the whole payload on a frozen clock |
| SA-WR-45 | Each updated export pin has a planted sixth export that must fail (`refundedOf` for boosts, `PLAN_TOTAL_ACROSS_CURRENCIES` for plans) |

### Deviations from the workplan (none changes a ruling)

1. **The route also imports `FINANCE_ACCOUNTS_SORTS` and `FINANCE_ACCOUNTS_SHOWS` from `financeUrl.ts`**, not only `FINANCE_GROUP_SHAPE`, so the page and the route share one definition of all three. `financeUrl.ts` stays pure (pinned).
2. **`buildAccountMargin` takes `{ coverage, aiCost, boosts, plans, accountId }`** rather than the full input with `scope: 'one'`; `scope` was dropped from `AccountEconomicsInput` because the two functions already separate the cases. Both run the same private `buildPaid` / `buildCost` / `buildMargin`.
3. **`AccountSummary`'s `accountMargin` prop is optional** (absent or null reads "Unknown"), so the existing M-1 render tests stay unedited.
4. **`FinanceHealthInput.accountsTab` is required**, so `financeHealth.test.ts`'s `run` helper gained one parameter (`accountsTab = null`); no assertion changed.
5. **`financeUrl.test.ts`**: the existing four-key object literals gained the four tab defaults (`...OVERVIEW`); the key-order pin is now the eight keys, as planned.
6. **Wire shape** (not fixed by the workplan): `paid.lines[]` of `{ currency, afterTax, exact, planAfterTax, boostsAfterTax }` plus `paid.failed`; `aiCost` is `figure | unknown | before_cutover`; `margin` is `figure | not_available | other_currency | unknown`; credits is `position | no_allowance | unknown | no_plan_row`.
7. **Empty filter result**: "No accounts match this filter" with no table, so the Deleted row is not shown then either (M3-FR-10 "no table").
8. **With the plan walk incomplete** (failed or capped), money-only accounts are not flagged `noPlanRow` (the walk cannot prove they have none); their group is whatever the capped walk classified, else none.
9. **`counts.accountEconomics.group`** has an extra kind `'other'`, unreachable through the route's shape check.

### Known differences from SQL check 19 (for QA; E-51)

- SA-W81 (i): a paid boost whose tax exceeds its amount → Unknown on the page; check 19 gives a negative figure. Unit-tested.
- SA-W81 (ii): a status-`paid` boost with a refund recorded → E-45's net; check 19 uses total − tax. Unit-tested.
- Not in E-51, found while porting: a readable **zero-amount** plan invoice in a non-USD currency makes no line on the page (M2-W-5), while check 19 counts it as an other-currency row and returns a null margin. Absent live (the one plan invoice is USD 79.00).

### Verification (own exit codes, read from the tool, never a pipe)

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | exit 0; **25 suites, 2029 tests passed**; no console output |
| V-2 | `npx jest app/admin/users --ci`; `git diff --exit-code -- app/admin/users app/api/admin/users` | exit 0, **25 suites, 601 tests**; diff exit 0 |
| V-3 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm/__tests__/source.guard.test.ts --ci` | exit 0; **47 suites, 1735 tests**; `layoutFolder.guard.test.ts` and `contrast.lf1.source.guard.test.ts` in the run |
| V-4 | `npm run test:bos-entitlements` | exit 0; **267 suites, 7986 tests** |
| V-5 | `npm run test:authz-guard` | exit 0; **2 suites, 203 tests** |
| V-6 | the nine billing / caller-list / N-10 / placement suites; then `git diff --exit-code -- lib/repositories lib/business-os/billing lib/business-os/credits lib/business-os/entitlements app/api/stripe lib/payments supabase` | exit 0; **9 suites, 423 tests**; diff exit 0 (caller lists unchanged) |
| V-7 | `npm run lint:hooks` | exit 0 |
| V-8 | `npx eslint` on all 32 touched and new `.ts` / `.tsx` files | exit 0, no output |
| V-9 | Scoped `tsc` (scratch `tsconfig.6a.json` outside the worktree: absolute `extends`, `noEmit`, `incremental: false`, `types/**/*.d.ts` and the 32 files) | Canary run: exit 2, **TS2322 at the canary** (`accountEconomics.ts`), plus two TS2339 in my own new test (an `it.each` union), fixed. Canary removed (`grep -c __canary` = 0). Clean run: **exit 0, 0 diagnostics** |
| V-10 | `git diff --stat` / `--numstat`, read first | 28 tracked files, 2064 insertions, 65 deletions; **no file with deletions and no insertions**; no `supabase/`, `lib/repositories/` or `lib/business-os/billing/` path. The two requirement MDs in the stat are BA's pre-existing edits, not Dev's |
| V-11 | `schema:check` | Not run (no credentials in the worktree: only `.env.example`). No new column is read: every field is already read by R-a, R-k and R-m (§11E.1) |
| V-12 | Checks 19 and 20 | For QA / the user, as in the Verification plan |

ts-jest did not report the V-9 test typing error, so the scoped `tsc` is the only type gate on test files here.

### `console.*` and logging

Every file touched has **0** `console.*` (the finance and page guards enforce it). No new log line in the builder; `financeHealth.ts` adds `failed('account_names', err)`; the route line adds `sections.accountEconomics` and `counts.accountEconomics` (counts, booleans, enum words; `group` as its kind). Still flagged, not touched: `useFinanceData.ts` (FU-5a-2).

### Not done here

- Manual QA L-75 to L-80 and SQL checks 19 / 20 (QA).
- `durationMs` for both tabs (QA, L-80).

### Fix round 1 (QA B-1)

- **Fixed by Dev:** `AccountEconomicsTable.tsx` now links a row only when `row.kind !== 'platform' && !row.noPlanRow`. A "No plan row" account cannot be opened: the one-account view checks the plan table first and answers "Business not found".
- **Test:** `accountsTab.render.test.tsx` gains a case: a "No plan row" account has no link, normal accounts keep theirs (`accountViewHref`), and the platform row stays unlinked. The AC-144 case no longer expects a link on the "No plan row" fixture.
- **Guard:** `app/admin/finance/__tests__/source.guard.test.ts` pins the exact link rule. It also checks that the file has exactly one `<Link` and that it is gated by `linked`. A planted control shows the old platform-only rule is caught.
- **Flake fixed:** the "malformed tab key" render case now uses a fetch that never resolves. It had answered with a payload that only had the tab's fields while the default Overview rendered, and that raced the assertion.
- **Re-run:**
  - Finance suites: exit 0, 25 suites, 2032 tests.
  - `app/admin/finance`: exit 0 on two consecutive runs, 8 suites, 272 tests.
  - `lint:hooks`: exit 0. ESLint on the 3 touched files: exit 0, no output.
  - Scoped `tsc`: the canary run exits 2 with TS2322 at the canary only; the clean run exits 0 with 0 errors.
  - `git diff --stat`: 28 files, 2083 insertions, 65 deletions, and no file has deletions without insertions.

---

## SA Workplan Review

**Reviewed by SA — 2026-10-14, against `d05eb0a4`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed, applying SA-WR-41 to SA-WR-45 as you build; SA checks them at code review. BA applies E-49 to E-51 below. Coding does not wait for them; QA does.

**How it was checked.** I opened the code:
- **The pins this slice trips:**
  - the boost export pin (`finance.source.guard.test.ts:769-775`) and the plan export pin (`:917-922`) each pin exactly four names today, and each becomes five;
  - the refund-note pin (`:718-742`) allows exactly `[RevenuePanel, AccountSummary]` today;
  - `financeUrl.test.ts:86-88` pins the four keys.

  Each is a real trip, and the workplan edits each one with a reason.
- **The DF-5 pin** scans only `boostRevenue.ts` today; the extension to `accountEconomics.ts` with zero tokens and a planted control is right.
- **`financeUrl.ts`** imports only `adminWindowPresets` and has no `'use client'`, so it is a pure module.
- **The route** already imports one pure page-side module (`adminWindowPresets`).
- **`formatUsd`** is `USD x` with 2 to 4 decimals.
- **`aiCost.ts`** sums integers at `COST_SCALE` (1e10) and divides once.
- **Unchanged:** no repository method is touched. The caller lists (finance, ledger, lot, plan, billing-event), the table pin, N-10 and the four billing placement guards stay unchanged and are run.
- **AC mapping:** AC-130 to AC-149 are all mapped.
- **The canary:** V-9 follows SA-WR-7.
- **Estimate:** about 3 days, with the AC-145 baseline test first, is accepted.

### SA-W75: the scale (checked)

**Exact.** `MINOR_TO_COST_UNITS = COST_SCALE / CURRENCY_SCALE = 1e10 / 1e2 = 1e8`, an exact integer, so `afterTaxMinor × 1e8` is exact while it is a safe integer. Cost is not counted twice:
- `units.byAccount` comes from the same `summariseAiCost` pass as Section 3, over the same R-a rows;
- every row is added once, adjustments under their own account, deleted rows under `deleted`;
- the margin uses each account's own units once;
- the platform line uses `units.total`.

**One correction.** The safe range is **not** "about USD 90 million". `Number.MAX_SAFE_INTEGER` / 1e10 ≈ **USD 900,719**, for revenue × 1e8 and for cost units alike. That is the same bound `aiCost.ts` already has today. At today's volumes it is far away, and overflow gives Unknown, never a wrong figure. It must be stated correctly and tested at the boundary (SA-WR-41).

### Rulings SA-W74 to SA-W89

| # | Ruling |
|---|---|
| **SA-W74** | **Approved.** Two optional keys: `accountEconomics` (tab, all businesses) and `accountMargin` (picked). Both are absent otherwise, so the Overview payload is unchanged (AC-145). BA edit **E-49**. |
| **SA-W75** | **Approved, with the bound corrected** (above and SA-WR-41). |
| **SA-W76** | **Approved.** "Paid us" goes through `formatMoney`; AI cost and AI margin go through `formatUsd`, so the cost cell equals Section 3's text. BA edit **E-50**. |
| **SA-W77** | **Approved.** The non-wire `foundingPartnerNote` set has no import change, and its size equals the sum of `foundingPartners` (pinned). |
| **SA-W78** | **Approved.** The non-wire `rowByAccount` comes from one computation; Section 4's wire is unchanged. |
| **SA-W79** | **Approved.** The non-wire `units` map with a per-account `unreadable`. Section 3's wire is byte-identical, and `figures.costUsd === units.total.cost / COST_SCALE` is pinned. |
| **SA-W80** | **Approved.** Export the two functions only; each pin goes to exactly five names, with an SA-Q45 comment. No status or kind literal appears in the new builder. |
| **SA-W81** | **Approved.** (i) Tax above net on the no-refund branch is inexact (Unknown) in `accountEconomics.ts` only. (ii) Follow E-45; a `paid` row with a refund cannot be produced by the boost transition function (a refund moves the status). Both divergences from check 19 are recorded for QA (**E-51**). |
| **SA-W82** | **Approved.** An Unknown-currency line gives Unknown. Precedence: Not available > n/a > Unknown > the figure, tested pairwise. |
| **SA-W83** | **Approved: import `FINANCE_GROUP_SHAPE` from `financeUrl.ts`**, one definition. This is acceptable layering because `financeUrl.ts` is a pure module: no `'use client'`, no React, no server-only import, its one import being `adminWindowPresets`. That is the same reason the route already imports `adminWindowPresets`. Required: a pin that keeps it pure (SA-WR-42). Do not use two copies. |
| **SA-W84** | **Approved:** `tab` with `accountId` returns 400; `tab` accepts only `accounts`; the page parser mirrors this. |
| **SA-W85** | **Approved:** a platform row has the platform label and no link (pinned). |
| **SA-W86** | **Approved:** the Deleted row shows only with group = all. With `show=negative` it shows only when its margin is a negative figure; with `show=active` it is always shown; it never counts in "Showing x of N". |
| **SA-W87** | **Approved**, as written. A lower bound ranks by its bound, and every comparison runs on the server before the cap. |
| **SA-W88** | **Approved:** the filter bar sits above both tabs; the Accounts body holds the notes, platform line, controls, count line and the table or empty state; picking a business drops the four tab keys. |
| **SA-W89** | **Approved:** a tab switch refetches (the Q42 trade-off). QA records `durationMs` for both tabs. |

**Refund-note pin.** `AccountsTab.tsx` reusing `REVENUE_REFUND_TIMING_NOTE` is approved: exactly three allowed users and a planted fourth (the SA-W58 (a) reasoning).

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-41 (Medium). The safe-range bound.** Correct the workplan text to about USD 900,719. Test at the boundary:
   - an account and the platform line whose after-tax × 1e8 or cost units pass `Number.MAX_SAFE_INTEGER` give **Unknown** (overflow), never a figure;
   - one just below gives the exact figure.
2. **SA-WR-42 (Medium). Keep `financeUrl.ts` pure.** If the route imports `FINANCE_GROUP_SHAPE` from it, a source rule (with a planted control) pins that `financeUrl.ts` has no `'use client'`, no `react` or `next/*` import, and no `server-only`, and imports only `@/app/admin/components/adminWindowPresets` and type-only paths. A route test pins that a well-formed unknown tier key is 200 with "No accounts match this filter", and a malformed one is 400.
3. **SA-WR-43 (Low). Formatting.** A negative margin renders with its sign through `formatUsd` (for example "USD -0.1234"). The cost and margin headers say "(USD)". The cost cell's text equals Section 3's `formatUsd` text for the same account and window (AC-134).
4. **SA-WR-44 (Low). Overview is byte-identical.** The AC-145 baseline route test is written first, green on unchanged code, and is **not edited** afterwards. Paste the hunk list of `route.test.ts` showing it is untouched by later steps.
5. **SA-WR-45 (Low). Planted control on the new export pins.** Each of the two updated pins plants a sixth export and must turn red.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-6a)

- **E-49 (M3-FR-11, SA-W74).** Replace "the route adds an `accounts` section to the payload only when `tab=accounts` and no business is picked (SA-Q42)." with "the route adds an optional `accountEconomics` section to the payload only when `tab=accounts` and no business is picked (SA-Q42), and an optional `accountMargin` (the M3-FR-8 line) only when a business is picked; both keys are absent otherwise, and `accounts` stays Section 1 (SA-W74)."
- **E-50 (M3-FR-3, SA-W76).** Replace "Money through `formatMoney`, numbers in `ADMIN_TD_NUM` cells." with "\"Paid us\" through `formatMoney` (exactly two decimals, currency named); AI cost and AI margin through `formatUsd` (2 to 4 decimals, as Section 3 prints its cost, so the cost cell equals Section 3's text); numbers in `ADMIN_TD_NUM` cells."
- **E-51 (§13 "Slice 6a checks" intro, SA-W81).** Append: "Known differences, by design (SA-W81): a paid boost whose tax is above its amount shows Unknown on the page while check 19 gives a negative figure; and the page applies the status-free rule of E-45 to a paid boost with a refund recorded, which the boost transition function never produces. Neither row exists today."

---

## SA Code Review

**Code Review by SA — 2026-10-15** (uncommitted tree on `feature/bos-money-m3`, 28 tracked files at +2064/−65, plus 6 new files)
**Status:** ✅ **Code Approved.** Nothing blocks QA. The three Low items are follow-ups, not conditions. BA applies E-52.

### Required changes SA-WR-41 to SA-WR-45: all verified in code

| Item | Verdict |
|---|---|
| **SA-WR-41** | ✅ `buildMargin` checks `Number.isSafeInteger` on both `revenueUnits` and `marginUnits`, and `buildCost` checks the cost units. The tests sit at the boundary, `floor(MAX_SAFE_INTEGER / 1e8)` against one more minor unit, and at `MAX_SAFE_INTEGER` against one past it. Both the row and the platform line give Unknown, and the paid figure stays shown. |
| **SA-WR-42** | ✅ The purity rule allows no `'use client'`, no React or Next, no `server-only`, and only `adminWindowPresets` at runtime. It has five planted controls. `financeUrl.ts`'s only other import is a type-only import of `financeTypes`, which the rule allows. Route tests: `tier:no-such-tier` gives 200 with no rows; `tier:Bad!` and `vip` give 400. |
| **SA-WR-43** | ✅ `marginText` → `formatUsd`, so the sign is kept. The headers read "AI cost, charged (USD)" and "AI margin (USD)". `costText` is `atLeast(formatUsd(..), exact)`, which is Section 3's expression. |
| **SA-WR-44** | ✅ `git diff -U0` of `route.test.ts` shows exactly two hunks: `+1077,99` (the AC-145 baseline, inserted whole) and `+1223,155` (the 6a block). No existing line was edited (`-1076,0`, `-1123,0`). |
| **SA-WR-45** | ✅ Each export pin has a planted sixth export (`refundedOf` and `PLAN_TOTAL_ACROSS_CURRENCIES`), and each must fail. |

### Deviations: all approved

1. **The route imports the sort and show lists as well as the group regex.** ✅ This is better: one definition of all three, and `z.enum` takes the readonly tuples. `financeUrl.ts` is still pure (pinned), and the SA-W83 rule pins that only `financeUrl.ts` defines the group shape.
2. **`scope` dropped from the builder input.** ✅ The two entry points already separate the cases, and both run the same private `buildPaid`, `buildCost` and `buildMargin`, so AC-142 holds by construction.
3. **`accountMargin` optional on `AccountSummary`.** ✅ A missing margin reads "Unknown". The page always passes `data.accountMargin ?? null`.
4. **`accountsTab` required in the input.** ✅ The compiler forces every caller to decide.
5. **The URL-key test literals.** ✅
6. **The wire shape.** ✅ Discriminated kinds only, never a total across currencies.
7. **An empty filter shows the sentence, with no table and no Deleted row.** ✅ This follows M3-FR-10. The platform line above it still covers every account.
8. **An incomplete walk flags no "No plan row".** ✅ It is honest: absence cannot be proved. The status is `partial` and `ECON_WALK_INCOMPLETE` names what is missing.
9. **The `'other'` group kind.** ✅ It cannot be reached through the route, so it is harmless.

### The third check-19 difference: the page is right

A readable plan invoice of zero is not a payment (M2-W-5). The plan revenue panel already drops it, so letting it turn an account to "n/a, different currency" would contradict the page's own revenue figure. **No code change.** E-52 (BA) appends the following to the "Slice 6a checks" intro, after "Neither row exists today.":

"A third, also by design (SA-CR-6a): a readable plan invoice of zero in a currency other than USD makes no line on the page (M2-W-5, a zero invoice is not a payment), so the margin stays a figure, while check 19 counts it as an other-currency row and returns a null margin. The page is right. No such row exists today."

### Verified (section 4 of the brief)

- **Margin only for USD.** The margin exists only for USD: there is one `'USD'` literal, pinned, and any non-USD line gives `other_currency`.
- **Scale.** The factor is `1e10/1e2 = 1e8`, an exact integer. There is exactly one multiply and exactly one division by `COST_SCALE` (pinned).
- **AI cost.** It comes from `summary.units`, built in the same `summariseAiCost` pass, with no second ledger walk.
- **E-45 and Q47.** `boostAfterTax` reads the reader result only: net 0 gives 0; no refund gives net minus tax, or inexact when tax is above net; no tax gives net; otherwise inexact. There are no DF-5 tokens, and the extension has planted controls.
- **Sort, filter and cap.** Filter, then sort with an id tie-break, then slice to 200, all on the server. "Showing x of N" uses `matching`, and `notListed` is reported.
- **Platform line.** Built from every account's money before any filter or cap, with the Deleted accounts included. Lines come from `groupByCurrency`, so currencies are never summed.
- **400 responses.** `tab` with `accountId`, and `sort`, `group` or `show` without the tab, each give 400 with no read (10 cases).
- **Links.** A platform row and the Deleted row have no link. A link carries only the id and the window.
- **Refund-note pin.** Exactly three files, with a planted fourth.
- **Untouched paths.** `git diff` is empty for `lib/repositories`, `lib/business-os/{billing,credits,entitlements}`, `app/api/stripe`, `lib/payments` and `supabase`.
- **Logging.** The info line carries counts and enum words only. `group` is logged as its kind, and a planted tier id or amount reaches no log call.
- **Admin gate.** `requireAdmin` is still the first statement (route source test).
- **`console.*`.** None in the new files.

### Code Review Comments (Low; follow-ups, not conditions)

1. **`FinanceTabs.tsx`.** The tab that is not selected has an `aria-controls` that names a panel which is not rendered, because only the selected panel mounts. Screen readers tolerate this. A follow-up can render both panels with `hidden` on the inactive one. Priority: Low.
2. **`accountEconomics.ts` `buildCost` against Section 3.** An account with an unreadable cost amount, or with cost units past the safe range, reads Unknown on the tab. Section 3 still prints a figure for the same account, counting the unreadable amount as 0. The tab is the more honest of the two, so AC-134 ("the cost cell equals Section 3") holds only for readable rows inside the safe range. QA should test AC-134 on readable data only. Priority: Low.
3. **`AccountsTab.tsx` group select.** A well-formed tier from the URL that is not in `groupOptions` leaves the select showing "All plan groups" while the filter is applied (the empty sentence is correct). A follow-up can add the current value as an option. Priority: Low.

### Re-run by SA

| Run | Result |
|---|---|
| The finance suites, the guards and the page (V-1 scope) | exit 0, **25 suites, 2029 tests** |
| `npm run test:authz-guard` | exit 0, **2 suites, 203 tests** |
| `npm run test:bos-entitlements` | exit 0, **267 suites, 7986 tests** |

Each matches the Dev's figure.

### Code Approved for QA: Yes

---

## QA Report

**QA — 2026-10-15**
**Test mode:** full (AC-130 to AC-149)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree **one heavy run at a time**; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 19 and 20 (QA does not run SQL against production). The steps for the user are L-75 to L-88 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. One Low bug (B-1, a link that leads to "Business not found" for a money-only account). It shows no wrong figure and does not block the commit and PR the user authorised. Every AC from AC-130 to AC-149 that Jest can test passes. AC-132, AC-134, AC-135 and AC-142 (SQL halves) and AC-149 are owed by the user.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-money-m3`, uncommitted; each command run alone)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` (T1 to T12) | exit 0; **25 suites, 2,029 passed** |
| Q-2 | `npx jest app/admin/users --ci`; `git diff --exit-code -- app/admin/users app/api/admin/users` | exit 0; **25 suites, 601 passed**; diff **exit 0 (empty)** |
| Q-3 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/business-os-llm/__tests__/source.guard.test.ts --ci` | exit 0; **47 suites, 1,735 passed**. PASS: `layoutFolder.guard`, `contrast.lf1.source.guard`, `businessPicker.contract`, BOS-LLM `source.guard`. No load timeouts this time |
| Q-4 | Billing guards and caller lists: `BusinessOsBillingEventRepository.test`, `BusinessOsCreditLedgerReadRepository.test`, `businessOsEntitlements.imports.guard`, `creditLots.test`, `serviceColumn.guard`, `firstPaymentStamp.guard`, `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`; then `git diff --exit-code -- lib/repositories lib/business-os/billing lib/business-os/credits lib/business-os/entitlements app/api/stripe lib/payments supabase` | exit 0; **9 suites, 423 passed**; diff **exit 0 (empty)** |
| Q-5 | `npm run test:bos-entitlements` | exit 0; **267 suites, 7,986 passed** |
| Q-6 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-7 | `npm run lint:hooks` | exit 0 |
| Q-8 | Scoped `tsc`. Config: `tsconfig.qa-6a.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 32 added or modified `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `accountEconomics.ts`): exit 2, `lib/business-os/finance/accountEconomics.ts(517,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-9 | `git diff --stat` / `--numstat` | 28 tracked files (+2,067 / −65), 7 new; **no deletion-only file**; nothing under `supabase/`, `lib/repositories/` or `lib/business-os/billing/` |

### AC-145 baseline (step 3)

`git diff -U0 app/api/admin/business-os/finance/__tests__/route.test.ts` has exactly **two hunks, both pure insertions** (numstat 254 / 0):
- `@@ -1076,0 +1077,99 @@`: the `describe('AC-145 baseline: the Overview request is unchanged by slice 6a')` block;
- `@@ -1123,0 +1223,155 @@`: the `describe('slice 6a: the Accounts tab through the route')` block, appended after `source`.

No pre-existing line of the file is edited, and the baseline passes in Q-1. QA cannot replay history, so "written first and green on unchanged code" rests on Dev's record (SA-WR-44). The current tree is consistent with it: the baseline sits before the 6a block, and nothing in it was edited.

### Test Coverage (AC-130 to AC-149)

| AC | Result | Evidence |
|---|---|---|
| AC-130 | ✅ Pass | T9 tablist (Overview selected; `tab=accounts` on mount; none with a business; `onPick` writes no `tab`); T10 keyboard and roving `tabIndex`; T8 round trip and `tab` + `accountId` → notice |
| AC-131 | ✅ Pass | T1 walk ids plus a money-only id (`noPlanRow`, `unknown_held`); NULL `user_id` → Deleted row last, outside the cap; platform `kind: 'platform'`; T10 labels |
| AC-132 | ✅ Pass (Jest), live part manual | T1 against `checkNineteen`; ILS on its own line; plan and boost parts. Check 19: L-84 |
| AC-133 | ✅ Pass | T1 per-row cases (plan 7900 / 500 → 74.00; boost 1000 / 100 → 9.00; full refund → 0; partial refund with tax 0; partial refund with tax → Unknown; disputed / lost → 0; SA-W81 (i) and (ii)); `boostAfterTax` (`accountEconomics.ts:61-67`) |
| AC-134 | ✅ Pass (Jest), live part manual | T1 per-account cost from `units.byAccount`; the platform cost from `units.total` (deleted included, unchanged by filter or cap); T5 platform text equals Section 3's `figures.costUsd`; T2 `figures.costUsd === units.total.cost / COST_SCALE`. Checks 19 / 20: L-84, L-85 |
| AC-135 | ✅ Pass (Jest), live part manual | T1 8900 minor − 1.2345 → 87.7655 exactly; no revenue → `−cost`, `noRevenue`; negative kept; equals `checkNineteen`. Check 19: L-84 |
| AC-136 | ✅ Pass | T1 ILS alone and beside USD → `other_currency`, the ILS line on its own; platform line `other_currency`; T6 (e) no cross-currency export; T7 payload walker; T10 "n/a, different currency" |
| AC-137 | ✅ Pass | T1 the ceiling on each of R-a, R-k and R-m → "At least" on that part, margin Unknown on every row, `partial`; T5 the same through the fake repository; T10 the notice |
| AC-138 | ✅ Pass | T5 each of ledger / boosts / plans / walk / positions failing alone → Unknown in its column only (walk: notice, money-only list), `partial`, Overview present; all three money reads → `unknown`; T7 200 (R-k case through the route) |
| AC-139 | ✅ Pass (Jest), live part manual | T1 `starts_before_cutover` and `entirely_before_cutover` → `not_available` on every row and the platform line (`buildMargin` rule 1, `accountEconomics.ts:171`); T10 the sentence. Live: L-82 |
| AC-140 | ✅ Pass | T1 four sorts on the mixed fixture with ties by id; the row ranked 201 under the default appears under `sort=margin`. The sort runs before `slice(0, cap)` (`accountEconomics.ts:356-360`) |
| AC-141 | ✅ Pass | T1 group and each `show` option; "Negative AI margin" excludes n/a / Unknown / Not available (`isNegative`, `:298`); the platform line is deep-equal under every filter; T7 the parsed filters reach the builder |
| AC-142 | ✅ Pass (Jest), live part manual | T5 owner fixture: tab row margin = `accountMargin` = 89.00 − X; `revenue.totals` still USD 89.00; T11 the summary line under "Paid us, total"; T7 picked route → `accountMargin`, no all-accounts read. Live: L-81 |
| AC-143 | ✅ Pass | T1 250 → 200 shown, `matching` 250, `notListed` 50, Deleted row extra; T5 / T7 exactly one `findNames` call of ≤ 200 ids, none platform; T10 "Showing 200 of 250 accounts" and "50 more" |
| AC-144 | ✅ Pass, with B-1 | T8 `accountViewHref` parsed back gives exactly `{ preset, from, to, accountId }`; T10 hrefs; no link on platform or Deleted rows. **But see B-1:** a `noPlanRow` row is linked, and its target answers 404 |
| AC-145 | ✅ Pass | T7 baseline (read calls with arguments, four `findNames` calls, ten top-level keys, payload SHA-256 on a frozen clock) green and unedited (hunk proof above); T7 "the Overview line says not_built …" |
| AC-146 | ✅ Pass | T7 malformed `tab` / `sort` / `group` / `show` → 400; `sort` / `group` / `show` without the tab → 400; `tab` + `accountId` → 400 (route `superRefine`); `group=tier:Bad!` and `group=vip` → 400; a well-formed unknown tier → 200, no rows; 401 / 403 zero reads; T8 page fallback with `FINANCE_URL_NOTICE` |
| AC-147 | ✅ Pass | T12 no `.sort(` / `.reduce(` / `.filter(` / money arithmetic in the tab components (planted controls); T7 the info line holds statuses, counts and enum words (a planted tier id, amount, name and currency appear in no log call); no `stripe_` / `livemode` / tier literal in the payload |
| AC-148 | ✅ Pass | Q-4 caller lists and billing guards unchanged; T6 write-verb rule; Q-9 no migration or repository path; Q-8 |
| AC-149 | ⬜ NOT-TESTED | Manual L-75 to L-88 below |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Margin only when all revenue is USD and exact | Confirmed | `buildMargin` (`accountEconomics.ts:170-182`): Not available > other currency > Unknown (any read failed or cut off, inexact cost, Unknown-currency line, inexact USD line) > figure |
| Mixed currency → "n/a, different currency" | Confirmed | `otherCurrency` set by any normalised non-USD line (`:142`); no partial USD margin |
| Ceiling or failed read → Unknown | Confirmed | `readsCut` (`:173-175`) |
| Window before 29 Sep → "Not available" | Confirmed | `coverage !== 'after_cutover'` (`:171`); cost shows the cut-over state when entirely before (`:163`) |
| Over ~USD 900,719 → Unknown | Confirmed | `Number.isSafeInteger` on cost units (`:165`), on revenue × 1e8 and on the difference (`:180`); SA-WR-41 boundary tests both sides |
| Negative margin keeps its sign | Confirmed | `formatUsd` with sign; T10 / T11 "USD -0.1234" |
| Partial refund of a taxed boost → Unknown | Confirmed | `boostAfterTax` returns null when `refunded > 0 && tax > 0` (`:66`); the line's `afterTax` is null, so the margin is Unknown (`:176`) |
| Paid boost with tax > amount → Unknown | Confirmed | `refunded === 0 && tax > net` → null (`:64`); E-51 records the check-19 difference |
| Zero-amount plan invoice | Confirmed | Readable `amount === 0` adds no line and no revenue row (`:96`); a USD zero-only account reads "No revenue" with `−cost`. Dev's extra E-51 note (a non-USD zero invoice) holds |
| Money or AI use but no plan row | Confirmed (see B-1) | Union of walk, ledger and money ids (`:313-315`); `noPlanRow` + `unknown_held` + "No plan row" credits (`:318-319`, `:185`) |
| Incomplete plan walk | Confirmed | Only money ids listed; `noPlanRow` not claimed (deviation 8); `notes.walkIncomplete`; status `partial` (`:381`) |
| Sort and filter server-side before the 200 cap, honest count | Confirmed | `filter` → `sort` → `slice(0, cap)`; `counts.matching` / `notListed` (`:356-360`, `:394`) |
| Platform line over all accounts, before filter and cap, never across currencies | Confirmed | Built from `all` (every counted row, deleted included) and `units.total`, before the filter (`:343-353`); `groupByCurrency` per currency; non-USD → `other_currency` |
| `tab` + `accountId` → 400; sort / group / show without tab → 400 | Confirmed | Route `superRefine` |
| Malformed or unknown group | Confirmed | Malformed → 400 (`FINANCE_GROUP_SHAPE`); well-formed but unconfigured → 200 with "No accounts match this filter" (SA-WR-42, by design) |
| Platform rows have no link | Confirmed | `linked = row.kind !== 'platform'` (`AccountEconomicsTable.tsx:170`) |
| Row link opens the M-1 view with the window | Confirmed for plan-row accounts; **not** for a `noPlanRow` account (B-1) | `accountViewHref` (`financeLinks.ts:97-106`) |
| No money in logs | Confirmed | Builder logs nothing; the route line carries `sections.accountEconomics` and `counts.accountEconomics` (counts, enum words; `group` as its kind); T7 planted values absent |

### Issues Found

#### Bugs (must fix before commit)
None at High or Medium severity.

**B-1 (Low): a "No plan row" account is linked, but its target answers "Business not found".** File: `app/admin/finance/components/AccountEconomicsTable.tsx:170` (`const linked = row.kind !== 'platform';`).
- **Steps:**
  1. Have the ledger, a boost or a plan invoice hold an account that has no row in `business_os_account_plans` (the fixture in `accountsTab.render.test.tsx:108`, `noPlanRow: true`).
  2. Open the Accounts tab and click that row's link.
- **Expected:** either no link (as for platform and Deleted rows) or a view that opens.
- **Actual:** the link is rendered. The M-1 view checks the plan table first (`financeHealth.ts:466` → `account_not_found`), so the route returns 404 and the page shows the error with Retry.
- **Impact:** no wrong figure, only a dead end. It is reachable only for money-only accounts, and none may exist today: check 19 lists every account with ledger or money rows, so a row missing from Section 1 would reveal it.
- **Fix:** one line, `row.kind !== 'platform' && !row.noPlanRow`, plus a render assertion. With the walk incomplete, `noPlanRow` is unknown (deviation 8) and such rows stay linked; that residual is acceptable.
- Fix before the PR or as a follow-up, SA's call.

#### Performance Issues (should fix)
None found in code. No new read; one names call of ≤ 200 ids on the tab only. `durationMs` for both tabs is owed (L-88).

#### Edge Cases / notes (Low)
1. Dev's E-51 addition (a readable zero-amount plan invoice in a non-USD currency: no line on the page, an other-currency row in check 19) is confirmed by reading `addPlan` (`accountEconomics.ts:96`). It is absent live, and BA could add it to the E-51 note.
2. The Jest worker-exit warning (FU-4a-3) did not appear in these one-at-a-time runs.

### Manual live steps (continuing from 5a's L-74): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. For checks 19 and 20, replace `null` in the `p` block with `'2026-10-01 00:00:00+00'`. Ledger cost is USD. Revenue in the checks is minor units, so divide by 100. Use **This month** in October 2026, or **Custom 2026-10-01 to 2026-10-31**.

| # | Step | Expected |
|---|---|---|
| L-75 | `/admin/finance`, then click the **Accounts** tab | The tab is selected, `tab=accounts` is in the address bar, and the filter bar stays above. The notes show. The platform line is labelled "All accounts, before any filter". Rows are ordered by AI cost, highest first, with "Showing x of N accounts" |
| L-76 | Find your test account | **Paid us, after tax: USD 89.00**, with the sub-line "plan USD 79.00 · boosts USD 10.00". **AI cost, charged (USD)**: its October cost X. **AI margin (USD)**: **89 − X** (sign kept). Plan group "Essentials" with the Founding Partner chip if current. Credits "used / allowance (%)". Other accounts with AI use and no revenue show `−cost` and "No revenue in this window" |
| L-77 | Reload the page | It stays on Accounts with the same rows |
| L-78 | Sort by **AI margin**, then **Paid us**, then **Credits**, then back to **AI cost** | The order changes each time (server-side: `sort=` in the URL), and the count line holds. The platform line never changes |
| L-79 | Show **"Paid us or used AI"**, then **"Negative AI margin"**; group **Essentials**, then a group with no accounts | Rows narrow, and the count line follows. "Negative AI margin" lists only figures below zero. An empty filter shows "No accounts match this filter". The platform line never changes. `group` / `show` are in the URL |
| L-80 | Back to Overview | `sort`, `group` and `show` leave the URL; Overview is exactly as before 6a |
| L-81 | On Accounts, click **your account's row link** | The one-account view on the same window, with no tabs. The summary shows **"AI margin (USD)"** under "Paid us, total", equal to the row's margin. "Paid us, total" still USD 89.00 and K-5 USD 89.00 |
| L-82 | Accounts with **Custom 2026-09-15 to 2026-10-14** | Every margin and the platform line read "Not available: AI cost is charged only from 29 Sep 2026"; revenue and cost still show |
| L-83 | Hand-edit the URL: `?tab=accounts&accountId=<your id>`, then `?preset=this_month&sort=margin` | The page falls back to defaults with the notice. Through the API (`/api/admin/business-os/finance?…`) both give 400 |
| L-84 | **Check 19** (October literal) | Your account: `usd_revenue_after_tax_minor` 8900, `other_currencies` '' , `inexact_revenue_rows` 0, `ai_cost_usd` = X, `ai_margin_usd` = 89 − X, all matching your row. Every other account's cost and margin (−cost) match its row. Row order = the default sort. **B-1 check:** every account in check 19 should also appear in Section 1 (Overview, Accounts by plan); if one does not, it is a "No plan row" row, and its link will dead-end |
| L-85 | **Check 20** (October literal) | `usd_revenue_after_tax_minor` 8900 (if no other account paid in October), `other_currency_rows` 0, `inexact_revenue_rows` 0, `ai_cost_usd` = the platform line's AI cost = Section 3's total on Overview, `ai_margin_usd` = the platform line's margin |
| L-86 | Pick a business from the picker while on Accounts | The tabs disappear, and `tab` / `sort` / `group` / `show` leave the URL |
| L-87 | Signed out, then as a non-admin, call `/api/admin/business-os/finance?tab=accounts` | 401 / 403, `no-store`, no figures |
| L-88 | Dev-server log, one load each of **Overview** and **Accounts** | Overview: `sections.accountEconomics: 'not_built'`, `counts.accountEconomics: { built: false }`. Accounts: status, counts, sort, show and `group` as a kind. No amount, name, currency total or tier id. **Record `durationMs` for both tabs** (target p95 under 2 s) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every AC that Jest can test passes; one Low bug (B-1, no wrong figure).** It does not block the pre-authorised commit and PR. Fixing it first is a one-line change, at SA's discretion. The SQL and manual parts (L-75 to L-88) are owed by the user.

---

## Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created (Dev) | Slice 6a (Money M-3) workplan: scope, SA-W74 to SA-W89, the pure builder `accountEconomics.ts`, the reader exports and AI cost map (SA-Q45, SA-Q46), the guard table with the two export pins and the DF-5 extension (E-44), AC-130 to AC-149 mapping, verification plan with checks 19 and 20, risks, estimate about 3 days. Awaiting SA workplan review |
| 2026-10-14 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W74 to SA-W89 approved. W75: the scale is exact; the bound is corrected to about USD 900,719. W83: one definition of the group regex, imported from a pinned-pure `financeUrl.ts`. The refund-note pin gets three users. Required changes SA-WR-41 to SA-WR-45. Requirement edits E-49 (payload keys), E-50 (formatters) and E-51 (check 19 differences) are for BA. |
| 2026-10-15 | Implemented (Dev): Code Complete | Slice 6a built per the SA-approved workplan; SA-WR-41 to SA-WR-45 applied (SA-W75 bound corrected to about USD 900,719). Task list and checklist ticked; Implementation Notes record files, nine deviations, a third check-19 difference (zero-amount non-USD invoice) and V-1 to V-11 with exit codes. Uncommitted, awaiting SA code review |
| 2026-10-15 | SA code review: **Code Approved** | SA-WR-41 to SA-WR-45 verified in code; route.test.ts has exactly two inserted hunks (baseline unedited); deviations 1 to 9 approved; third check-19 difference ruled page-right (E-52 for BA); 3 Low follow-ups (tab aria-controls, cost cell vs Section 3 on unreadable or overflow rows, group select for an unlisted tier). SA re-run: finance 25/2029, authz-guard 2/203, bos-entitlements 267/7986, all exit 0 |
