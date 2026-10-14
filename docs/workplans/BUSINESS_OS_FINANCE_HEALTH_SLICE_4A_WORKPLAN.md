# Workplan: Business OS Finance & Business Health — Slice 4a (Boost revenue)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), slice **4a** (§0.1 row 4, §0.4 DF-5, §11C.1 to §11C.4, §11C.6 to §11C.8 (ACs tagged 4a), §13 check 14, "SA Requirement Review — Slice 4", §0.3 SA-Q25 to SA-Q31 and SA-RR-4).
**Decisions in force:** BD-9 (UTC calendar month), BD-12 (no FX, per currency only), BD-14 (test and live platform money together, no switch), BD-15 and BD-16 (not touched by 4a), DF-5 (refunds and disputes count in the purchase month; user question pending, so the rule is kept in one place).
**Builds on:** slices 1a, 1b, 2a, 2b and 1c, all on `main` at `15300d29`. [2a workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md) · [1c workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_WORKPLAN.md) · [2a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_RETROSPECTIVE.md) · [2b retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_RETROSPECTIVE.md) · [1c retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_RETROSPECTIVE.md)
**Layout standard:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md). The section uses the shared parts; the page shell is **not** migrated (DF-4).
**SA rulings implemented:** SA-Q25 (K-5 follows the filter window), SA-Q26 (`minorUnitsPerMajor` is the one source; integer cents are hundredths only when it returns 100; never `toUnits` or × 100), SA-Q27 (the layer-B pager: keyset on `id`, ceiling 5,000, "At least", net Unknown), SA-Q28 / DF-5 (purchase month, one place), SA-Q30 (stored package id and version, no entitlements import), findings S4-F1 and S4-F2. Still in force: SA-W1 / AC-42 (narrow to a picked business), SA-W22 (structural input types, one-caller pin unedited), SA-WR-3 (spies at the repository boundary), SA-WR-4 (pure builders), SA-WR-7 (scratch tsconfig, canary), SA-WR-15 (statuses matched exactly), SA-WR-16 (every `.from(` a literal), SA-WR-18 (the page never adds or subtracts money).
**Date:** 2026-10-13
**Branch:** `feature/bos-finance-health-4` (cut by RM from `main` `15300d29`; confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`). `node_modules` is a junction to the main checkout: never `git worktree remove`, never `git stash`, never `npm install`, never commit (RM commits after the user has seen the diff).
**Status:** Planning. Awaiting SA workplan review.

## Overview

Slice 4a turns the "Our revenue" panel into a real section and shows **what credit boosts earned us**, per currency, for the filter window. A purchase counts in the window when its `paid_at` falls in it (whole UTC days, half-open). Each currency line shows purchases, gross charged, of which tax, refunded, held in open disputes, lost in disputes, **net**, and credits sold. Below it sit a by-package table, keyed by the `package_id` and `package_version` stored on each purchase, and a "Deleted accounts" line. **K-5 shows the boost net** for the same window. Plan revenue keeps its one-line placeholder until slice 5.

It adds **one read pair** to `BusinessOsFinanceReadRepository`, **R-k** and **R-k′**, on the table the repository already reads for R-d. It adds one pure builder, `boostRevenue.ts`, and extends the existing builder, wiring, route log line, revenue panel and KPI strip.

There is no migration, no SQL function, no new table, no write, no LLM call, no audit entry, no entitlements import and no new query parameter.

Eight points need an SA ruling before code ([Questions for SA](#questions-for-sa-before-code), SA-W47 to SA-W54). Two are gaps between the requirement and the code: K-5's value has no currency slot (SA-W47), and check 14 cannot verify the deleted-accounts net (SA-W51). None reopens a business decision.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [The reads: R-k and R-k′](#the-reads-r-k-and-r-k)
- [Money maths: minor units, exact](#money-maths-minor-units-exact)
- [The boost revenue builder](#the-boost-revenue-builder)
- [DF-5: the refund-month rule in one place](#df-5-the-refund-month-rule-in-one-place)
- [The builder, the wiring and the route](#the-builder-the-wiring-and-the-route)
- [K-5](#k-5)
- [With a business picked (AC-96)](#with-a-business-picked-ac-96)
- [Failure matrix](#failure-matrix)
- [The page](#the-page)
- [Entitlements registration check](#entitlements-registration-check)
- [Tenant isolation check](#tenant-isolation-check)
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

Every file below was opened at `15300d29` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| Header: why a separate repository (the boost purchase repository named in words only), service role, account scope by signature, no read filters by mode, paging | `lib/repositories/BusinessOsFinanceReadRepository.ts:12-21`, `:40-45`, `:47-65`, `:67-73`, `:75-84` |
| `FINANCE_READ_LIMITS` (`CLIENT_PAGE_SIZE` 1,000, `CLIENT_CEILING` 5,000) | `BusinessOsFinanceReadRepository.ts:121-128` |
| `FinanceClientReadResult<T>` (`rows`, `reachedCeiling`), `FinanceClientRange`, `FinanceClientReadOptions` | `BusinessOsFinanceReadRepository.ts:213-228` |
| R-d `countRevenueRows`: a head count of `business_os_boost_purchases` with `paid_at` not null; the table is already read here | `BusinessOsFinanceReadRepository.ts:393-418` (`:402-404`) |
| `rangeFilter`: `'paid_at' \| 'created_at'`, refuses an invalid or empty range before querying, `gte` / `lt` as ISO strings | `BusinessOsFinanceReadRepository.ts:594-604` |
| `pageClientRows`: UUID check first, `prepare()` inside the `try`, page / ceiling checks against `CLIENT_*`, keyset on `id`, `.eq('user_id')` on every page when scoped, `>=` ceiling returns rows with `reachedCeiling: true`, info (all accounts) or debug (one account) with counts only, never throws | `BusinessOsFinanceReadRepository.ts:631-688` |
| Migration: `id uuid`, `user_id uuid` nullable, `ON DELETE SET NULL` | `supabase/migrations/20261030_business_os_boost_purchases.sql:6-7`, `:47` |
| Amounts are `integer` minor units; `credits_total numeric(18,6)` | `20261030_…sql:14`, `:19`, `:25-28` |
| CHECKs `status_known`, `currency_usd`, `amounts_not_negative`, `refund_within_total`, `paid_family_complete` | `20261030_…sql:51`, `:59`, `:77`, `:79`, `:83` |
| Only index `(user_id, livemode, created_at)`; none on `paid_at` | `20261030_…sql:89` |
| `minorUnitsPerMajor(currency: string)`: pure, no import; calls `.trim()`, so it must never get a non-string; returns 1, 1000 or 100 | `lib/payments/refundMath.ts:44-49` |
| `minorUnitsPerMajor` already imported outside `lib/payments` (no caller pin anywhere in a test) | `lib/business-os/currency.ts:15`, `lib/business-os/entitlements/retailRate.ts:21`; `grep -rn refundMath` over `lib app` tests: only `refundMath.test.ts` and `currency.formatMinorAmount.test.ts` |
| `toUnits(value, scale)` and `CREDIT_SCALE = 1e6` | `lib/business-os/credits/creditReport.ts:89`, `:136-139` |
| Currency helper: `CURRENCY_SCALE` 100, `normaliseCurrencyCode`, `groupByCurrency` (takes integer hundredths or `null`; one line per normalised code; Unknown last; `overflow`) | `lib/business-os/finance/currencyGroups.ts:27`, `:32-36`, `:63-105` |
| Takings precedent: structural inputs, exact status match, `toMoney = h / CURRENCY_SCALE` once | `lib/business-os/finance/takings.ts:43-62`, `:95`, `:106` |
| Builder: `finance` Pick, `FINANCE_LIMITS`, `K5_NONE_YET` / `K5_RECORDED`, the settled `Promise.all`, the revenue panel from R-d, K-5 colour, the K-5 tile with `value: null`, the counts | `lib/business-os/finance/financeHealth.ts:173-188`, `:129-149`, `:151-153`, `:380-440`, `:530-536`, `:730-735`, `:781`, `:799-848` |
| Wiring: the `finance` block | `lib/business-os/finance/financeHealthDeps.ts:112-134` |
| Wire types: `FinanceRevenueSection { status, state }`; `FinanceMeasured` (a bare number); `FinanceTile.value` ("K-5: none"); the payload | `lib/business-os/finance/financeTypes.ts:145-150`, `:159-163`, `:165-174`, `:176-190` |
| K-5 rules are empty (information only), vocabulary has no metric; `colourFinanceTile` returns `unavailable` on a null measurement and `neutral` with `information` otherwise | `lib/business-os/finance/financeRules.ts:48`, `:96`, `:172-204`; `FINANCE_UNKNOWN_HEADLINE` `:133` |
| Route: `.strict()` query; the one info line with `sections`, `tiles`, `counts`, `durationMs` | `app/api/admin/business-os/finance/route.ts:91`, `:173-204` |
| Route test: `mockDeps.finance`, `allReads()` covers every `mockDeps.finance` method (AC-45 / AC-46 shape), payload key list, takings money walker | `app/api/admin/business-os/finance/__tests__/route.test.ts:75-83`, `:276-288`, `:426-427`, `:585-599` |
| Revenue panel: a plain `<section>` with `data-testid="section-revenue"`, words only | `app/admin/finance/components/RevenuePanel.tsx:1-41` |
| K-5 in the strip renders `value={null}` | `app/admin/finance/components/FinanceKpiStrip.tsx:63-64` |
| Section frame: optional badge; `unknown` replaces the children with "Could not load this section" and Retry | `app/admin/finance/components/FinanceSection.tsx:36-37`, `:71-85` |
| View order: `RevenuePanel` then `TakingsSection`; `windowLabel` | `app/admin/finance/components/FinanceView.tsx:51`, `:97-98` |
| `formatMoney`, `formatCredits`, `atLeast` | `app/admin/finance/financeFormat.ts:15-18`, `:24-26`, `:33-35` |
| Copy: `TILE_LABELS`, `AT_LEAST`, the four `REVENUE_*` strings, `TAKINGS_NET_CUT_OFF` | `app/admin/finance/financeCopy.ts:36-44`, `:50`, `:56-60`, `:187` |
| Finance source guard: `FILES`, `REPOSITORY`, `LAYER_B_FREE`; tier-literal rule; entitlements importers; LOT symbols (G3 kept narrow); `REPOSITORY_TABLES` pin; `LAYER_B_METHODS` body rule; repository-wide `livemode` rule; `MONEY_ARITHMETIC`; `AMOUNT_ARITHMETIC`; the 1c wording and mode rules | `lib/business-os/finance/__tests__/finance.source.guard.test.ts:68-79`, `:144-149`, `:165-168`, `:212-216`, `:271-291`, `:305-341`, `:352-356`, `:399-411`, `:543-558`, `:567-603` |
| Repository test: recording client methods (`select, eq, not, gt, gte, lt, or, order, limit, maybeSingle`); `FINANCE_READ_LIMITS` equality; writer names absent (`BoostPurchase` included); one-caller pin | `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts:77-104` (`:86`), `:130-135`, `:531-537`, `:539-565` |
| Boost repository scan guards pin only the `…ForWebhook` finders and `listForReconcile`, over `app/` | `lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts:612-635` |
| The barrel exports the finance repository (its comment still says "live-mode", stale since 1c) | `lib/repositories/index.ts:86-111` |
| `test:bos-entitlements` includes `lib/repositories/__tests__` | `package.json:23` |
| Section 4's lot code (4b's, untouched in 4a): `extraCreditsAt` imported only here | `lib/business-os/finance/creditsSection.ts:31` |
| Boost package ids (`starter`, `plus`, `max`) are not tier ids, so a stored package id cannot trip the tier-literal rule | `lib/business-os/entitlements/config/boostPackages.ts:73`, `:88`, `:104` (read only; not imported) |

`console.*` count in every file to modify: **0** (grep over the repository, the barrel, `lib/business-os/finance/*.ts`, the route and every `app/admin/finance` file). The CLAUDE.md flag-and-convert rule has nothing to convert.

---

## Scope

Exactly the 4a row of requirement §11C.2.

| In 4a | Out (4b, slice 5 or later) |
|---|---|
| R-k and R-k′ in `BusinessOsFinanceReadRepository` | R-l and R-l′ (boost problems), Section 6 block A (4b) |
| "Our revenue" as a section with its own status (S4-FR-1) | K-5's dispute rule in `FINANCE_RULES` (4b, SA-Q29) |
| Boosts per currency, dated by `paid_at` in the window: purchases, gross charged, of which tax, refunded, held in open disputes, lost in disputes, net, credits sold (S4-FR-2) | Bought credits in Section 4; `creditsSection.ts` (4b, SA-Q31) |
| A by-package table from the stored `package_id` / `package_version` (S4-FR-3, SA-Q30) | Plan revenue amounts and MRR (slice 5); the plans line only says amounts come later (S4-FR-4) |
| A "Deleted accounts" line, all businesses only (S4-W-7) | Any tile colour for K-5 (4a keeps it grey) |
| **K-5 shows the boost net for the filter window** (S4-FR-7, SA-Q25) | A refund date (DF-5: needs a writer-side change in the boost module) |
| The finance source-guard additions for 4a (each with a planted control) | Stripe fees (BD-7, slice 6); a test-account filter (DF-3); the page shell (DF-4) |
| ACs tagged 4a: AC-87 to AC-101 | AC-102 to AC-107 |

---

## Questions for SA before code

Each has a recommendation, which I build unless SA rules otherwise. Numbering continues from 1c (SA-W46).

| # | Issue | Recommendation |
|---|---|---|
| **SA-W47** | **K-5's value has no slot for a currency.** `FinanceTile.value` is `FinanceMeasured { value, exact }`, a bare number (`financeTypes.ts:159-174`). S4-FR-7 needs "USD 10.00", "N currencies, see Our revenue", "No data yet" or "Unknown". A bare 10 would break the 2a rule that every money figure sits beside its currency, and `exact: false` would mean "At least", which S4-W-8 forbids for net. | Add an **optional** `money?: FinanceTileMoney` to `FinanceTile`, set on K-5 only; `value` stays `null` for K-5. `FinanceTileMoney = { kind: 'one'; currency: string \| null; net: number } \| { kind: 'several'; currencies: number } \| { kind: 'none' } \| { kind: 'unknown'; reason: 'failed' \| 'cut_off' \| 'unreadable' }`. Optional, so the K-1 to K-4 tiles and every existing fixture are unchanged. **States:** read failed → `unavailable` (state "Could not check"), headline `Unknown`, value "Unknown". No counted purchase → `neutral`, headline "No data yet", no value. One currency → `neutral`, value `formatMoney(net, currency)`. Several → `neutral`, "N currencies, see Our revenue". Net unknown (ceiling or unreadable) → `neutral`, value "Unknown". The headline is always the information line from `colourFinanceTile` (K-5 rules stay `[]`), so 4b's rule slots in without moving anything. With several currencies where one line's net is Unknown, the tile still says "N currencies, see Our revenue": the section says which line is unknown. |
| **SA-W48** | **What "unreadable" removes: one amount or the whole purchase?** S4-W-4 excludes "unreadable amounts" from sums and makes net Unknown on that line. If only the bad field is dropped, a purchase with a readable `amount_refunded_minor` and an unreadable `amount_total_minor` would still lower "refunded", and held / lost would mix a known refund with an unknown total. | **Row level.** A counted purchase is *unreadable* when any of `amount_total_minor`, `amount_tax_minor` or `amount_refunded_minor` is not a JSON number that is a safe integer `>= 0`, or refunded `>` total, or its currency is not a three-letter code (`normaliseCurrencyCode` gives `null`, so `minorUnitsPerMajor` is never called with it), or `minorUnitsPerMajor(code) !== 100`. An unreadable purchase adds **no money** to any sum, is counted (`unreadable` on its line and package row, `unreadablePurchases` on the block), and makes that line's and that package row's gross, tax and refunded "At least", and their held, lost and net Unknown. Its `credits_total` still counts if readable (credits are not money). The block is `partial`. **Numeric strings are unreadable** for the money columns: they are `integer`, which PostgREST sends as JSON numbers; a string would mean the column changed, and that should show, not be parsed. (`credits_total` is `numeric` and goes through `toUnits`, which accepts a numeric string, as in 1b.) |
| **SA-W49** | **Which limits R-k uses.** `pageClientRows` defaults to `CLIENT_PAGE_SIZE` / `CLIENT_CEILING` (`:645-652`). New `BOOST_*` keys would mean editing the equality pin at `BusinessOsFinanceReadRepository.test.ts:130-135` and generalising the pager's checks. | **Reuse `CLIENT_PAGE_SIZE` (1,000) and `CLIENT_CEILING` (5,000) unchanged**, as SA-Q27 asks ("ceiling 5,000"). The header's PAGING paragraph says R-k and R-k′ use the same pager and limits. No new key; the equality pin is untouched. |
| **SA-W50** | **The revenue payload's shape and status.** Today `revenue = { status, state }`, driven by R-d (`financeHealth.ts:530-536`), and K-5's headline comes from `state` (`K5_RECORDED`, `K5_NONE_YET`). S4-FR-4 keeps R-d for the plans line, S4-FR-10 adds `boosts`, and S4-FR-5 sets the section status. | `FinanceRevenueSection` becomes `{ status, state, plans, boosts }`. **`state` is kept unchanged** (R-d's platform-wide existence, still logged as before). **`plans`** is `'recorded' \| 'none' \| 'unknown'` from `planInvoicesPaid` only, for the plans line. **`boosts`** is the S4-FR-10 object (below). **Section status:** `unknown` only when R-d **and** R-k both failed (the frame then shows "Could not load this section"); `partial` when exactly one failed, or the boost part is `partial`; else `ok`. `K5_NONE_YET` and `K5_RECORDED` are deleted (K-5 now comes from the boost read, SA-W47). The 1c tests AC-75 to AC-77 that assert K-5's old headline are rewritten to AC-94 / AC-95; AC-76's meaning moves to "a paid boost alone: plans line 'No plan payment recorded', boost amounts shown". |
| **SA-W51** | **Check 14 cannot verify the deleted-accounts net.** It has `deleted_account_purchases` per row but no deleted-accounts money, so the "Deleted accounts" line's net (S4-W-7) has no SQL cross-check. Zero such rows exist today (§11C.1), so it only matters later. | **BA edit to check 14:** add one column after `deleted_account_purchases`: `coalesce(sum(b.amount_total_minor - b.amount_refunded_minor) filter (where b.user_id is null and b.status in ('paid', 'partially_refunded', 'refunded')), 0) as deleted_account_net_minor,`. Per row, net is `total - refunded` for those three statuses and 0 for `disputed` / `dispute_lost` (whose remainder is exactly what held and lost subtract), so this equals the page's net. ASCII, no apostrophe, no "into", still one result set. AC-97 then also compares this column. If SA prefers no edit, the deleted net rests on the Jest case alone. |
| **SA-W52** | **Where the section's page code goes.** S4-FR-1 makes the panel a section with a status, but `RevenuePanel.tsx` is a plain `<section>` (`:1-41`). The caption on K-5 must name the window (SA-Q25), but `FinanceKpiStrip` gets no window label (`:36-43`). | **Rewrite `RevenuePanel.tsx` in place** over `FinanceSection` with `id="revenue"`, which keeps `data-testid="section-revenue"`, so the page-order tests (`financePage.render.test.tsx:366`, `:656`) still hold. It gains `windowLabel` and `onRetry` props. No new component file. `FinanceKpiStrip` gains a `windowLabel` prop, used only in K-5's caption. `FinanceSection.tsx` is not changed. |
| **SA-W53** | **DF-5: "keep the refund-month rule in one place".** The rule has no line of its own: it is a side effect of reading refunds off the purchase row that R-k selected by `paid_at`. If the user picks "the month the refund happened", that becomes a second, dated read. | One function in `boostRevenue.ts`, `refundsAndDisputesOf(row)`, documented as **the DF-5 rule**. It is the only code that reads `amount_refunded_minor` or the two dispute statuses, and returns `{ refunded, held, lost }` in minor units for one purchase, counted in the purchase's own window. One copy constant holds the S4-W-3 note. A source test pins both (the field name and the dispute literals appear in that function only). Switching to (b) then means feeding this function from a dated refund read instead of the purchase row, and changing one sentence. Nothing else moves. |
| **SA-W54** | **"No boost amount through `toUnits`" vs credits sold.** SA-Q26 bans `toUnits` and `× 100` for amounts, but S4-W-6 converts `credits_total` through `toUnits` at the credit scale. The wire also needs one division (hundredths to a number, the 2a `toMoney`). | In `boostRevenue.ts`: **`toHundredths` is never named; `toUnits(` appears exactly once, with `credits_total` and `CREDIT_SCALE`**; no `* 100`, `*100` or `CURRENCY_SCALE *`. The wire divides integer cents by `CURRENCY_SCALE` once (`/ CURRENCY_SCALE`), which is correct only because a row is readable only when `minorUnitsPerMajor(code) === 100` (SA-W48). The source test asserts all of this with planted controls. |

---

## Analysis Summary

| Area | Touched how |
|---|---|
| Finance read repository | One new named pair (R-k, R-k′), one column constant, one row type, header paragraphs. Reuses `pageClientRows` and `rangeFilter('paid_at', …)` |
| Boost revenue builder (new, pure) | `boostRevenue.ts`: the paid-family literal, the row readability rule, per-currency lines, by-package rows, the deleted-accounts line, the DF-5 function, exactness flags, the K-5 summary |
| Builder | `financeHealth.ts`: one settled read in the existing `Promise.all`; the revenue section (status, `plans`, `boosts`); K-5 from the boost result; `counts.boosts` |
| Wiring | `financeHealthDeps.ts`: two more methods in the existing `finance` block |
| Route | Info line only (`sections.revenueBoosts`, `counts.boosts`); header sentence. Zod, the gate, 404 / 500 and `no-store` unchanged |
| Page | `RevenuePanel.tsx` rewritten over `FinanceSection`; `FinanceKpiStrip.tsx` K-5 value and caption; `FinanceView.tsx` props; copy |
| Tables read | `business_os_boost_purchases` only, already pinned for R-d. No new column beyond the migration |
| Not touched | Every other read, Sections 1, 3, 4 and 6, the takings block, `financeRules.ts`, `creditsSection.ts`, `currencyGroups.ts` (its export pin holds), `FinanceSection.tsx`, the shared layout folder, Health, the Businesses list, the boost module, every Stripe file |

---

## Implementation Approach

1. **Repository first, behind the existing pins.** R-k and R-k′ through the existing pager, with their tests. The no-write, writer-name and one-caller pins pass unedited, and so do the table pin and the `FINANCE_READ_LIMITS` equality (V-1).
2. **Pure builder next:** `boostRevenue.ts` with its tests, including the migration-literal test (the SA-W2 precedent). It takes everything as parameters (SA-WR-4), reads no clock and imports no repository (SA-W22).
3. **Builder, wiring, types, route**, then the **page**.
4. **Guard additions last**, each with a planted negative control (2b conclusion 1).
5. **No new pattern.** The all-accounts / account-scoped pair, the pager, the range filter and `reachedCeiling` are R-e's. The currency lines are `groupByCurrency`'s. Structural inputs are `takings.ts`'s. `minorUnitsPerMajor` already has callers outside `lib/payments`. The section frame and the shared parts are the takings block's.

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/business-os/finance/boostRevenue.ts` | Pure `buildBoostRevenue(input)`: `BOOST_PAID_FAMILY`, the readability rule, lines, packages, deleted accounts, the DF-5 function, exactness, the K-5 summary. Structural input type (SA-W22) |
| `lib/business-os/finance/__tests__/boostRevenue.test.ts` | AC-87 (method), AC-88 (builder half), AC-89 to AC-94, AC-97; SA-W48, SA-W53; the migration-literal test |

### Modify

| File | Change |
|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | R-k, R-k′; `FINANCE_BOOST_PURCHASE_COLUMNS`; `FinanceBoostPurchaseRow`; header (below) |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | A separate import line (the 2a / 2b / 1c imports stay byte-identical); a `slice 4a` column describe and a `describe.each` over R-k / R-k′. Pins at `:130-135` and `:510-565` unedited |
| `lib/repositories/index.ts` | Export `FINANCE_BOOST_PURCHASE_COLUMNS` and the type `FinanceBoostPurchaseRow`; correct the stale "live-mode" comment (`:86-88`) |
| `lib/business-os/finance/financeTypes.ts` | `FinanceBoost*` types; `FinanceRevenueSection` gains `plans` and `boosts` (SA-W50); `FinanceTile.money?` and `FinanceTileMoney` (SA-W47); header sentence for slice 4a |
| `lib/business-os/finance/financeHealth.ts` | `finance` Pick + two methods; one settled read; the revenue section; K-5; `counts.boosts`; delete `K5_NONE_YET` / `K5_RECORDED`; header paragraph |
| `lib/business-os/finance/financeHealthDeps.ts` | Two delegation lines in the `finance` block; header bullet |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | Fake gains the two methods; the revenue-panel describe (`:424-460`) rewritten for `plans` / K-5; new describes for boosts (all businesses, picked business, failures, K-5) |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | A new `slice 4a` describe (see [Guard table](#guard-table-line-by-line)); the comment above `REPOSITORY_TABLES` names R-k. No existing rule edited |
| `app/api/admin/business-os/finance/route.ts` | Info line: `sections.revenueBoosts`, `counts.boosts`; header sentence |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | `mockDeps.finance` gains two mocks (so `allReads()` covers AC-99); payload, money walker over `revenue.boosts` and `tiles.k5.money`, AC-96 through the route, the info line (AC-98) |
| `app/admin/finance/components/RevenuePanel.tsx` | Rewritten over `FinanceSection` (SA-W52): plans line, boost lines table, package table, deleted-accounts line, notes, "cannot produce" list |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | K-5 value from `money`, caption with the window (`windowLabel` prop) |
| `app/admin/finance/components/FinanceView.tsx` | Pass `windowLabel` and `onRetry` to `RevenuePanel`, `windowLabel` to the strip |
| `app/admin/finance/financeCopy.ts` | Every 4a string, placed with the `REVENUE_*` block (`:56-60`); `REVENUE_RECORDED` and `REVENUE_NONE_YET` replaced (S4-FR-12) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Fixture gains `revenue.plans` / `revenue.boosts`; AC-75 to AC-77 render cases rewritten; new cases for AC-90 to AC-97 render halves; AC-81 kept |

**Not modified, on purpose:** `currencyGroups.ts` (its five-name export pin, `finance.source.guard.test.ts:368-373`), `financeRules.ts` (K-5's rule is 4b), `creditsSection.ts` and `CreditsSection.tsx` (4b), `FinanceSection.tsx`, `financeFormat.ts` (`formatMoney`, `formatCredits`, `atLeast` reused as they are), `takings.ts`, `paymentProblems.ts`, the shared layout folder and its guard, every boost module file and its repository, every Stripe file, `enforcementPoints.test.ts`, the requirement MD (TL records the workplan link).

---

## The reads: R-k and R-k′

All in `BusinessOsFinanceReadRepository`, service role (constructor default, `:286-290`). Both return `{ data, error }` and never throw (the pager's `fail`, `:292-299`).

### Shared rules

| Item | Spec |
|---|---|
| Range | `FinanceClientRange` (`:219-222`), half-open `from <= paid_at < to`, through the existing `rangeFilter('paid_at', range)` (`:594-604`): refused before any query when either end is not a valid `Date` or `from >= to`. The builder passes `window.start` / `window.end` |
| Options | `FinanceClientReadOptions` (`:225-228`), for tests only. Defaults and bounds are `CLIENT_PAGE_SIZE` 1,000 and `CLIENT_CEILING` 5,000 (SA-W49), checked by the pager (`:645-652`) |
| Paging | The existing `pageClientRows` (`:631-688`): keyset on `id` (UUID), `.gt('id', last)` from page two, stops on a short page |
| Ceiling | `>=` rule: at 5,000 rows, the rows read with `reachedCeiling: true`, never an error (SA-Q27) |
| Result | `RepositoryResult<FinanceClientReadResult<FinanceBoostPurchaseRow>>` |
| Mode | **No `livemode` anywhere**: not selected, not filtered, not named in the code (BD-14; the 1c rule `finance.source.guard.test.ts:352-356`) |
| Status | **No status filter in the query.** Every status with `paid_at` in range is read; the builder applies the paid family and counts the rest (S4-W-2) |
| Logging | R-k: `info` `{ method, rows, reachedCeiling, durationMs }`; R-k′: `debug` `{ method, rows, reachedCeiling }` (the pager's lines, `:676-683`). Never an amount, a currency, a package or an id |
| Writes | None. No-write pin (`:523-525`) and no-aggregate pin (`:527-529`) unedited |

### Columns (exact, exported)

| Constant | Columns | Excluded on purpose |
|---|---|---|
| `FINANCE_BOOST_PURCHASE_COLUMNS` | `id, user_id, status, package_id, package_version, currency, amount_total_minor, amount_tax_minor, amount_refunded_minor, credits_total, paid_at` (§11C.6, exactly) | `livemode` (BD-14), `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_dispute_id`, `receipt_url`, `flag_reason`, `lot_id` (S4-FR-9), `checkout_expires_at`, `status_changed_at`, `created_at` (never a revenue date, S4-W-1), the price and version snapshots |

```ts
/** One boost purchase, as "Our revenue" reads it (slice 4a). No Stripe id, no receipt, no lot. */
export interface FinanceBoostPurchaseRow {
  id: string;
  user_id: string | null;            // NULL: the account was deleted (ON DELETE SET NULL)
  status: string | null;
  package_id: string | null;
  package_version: number | null;
  currency: string | null;
  amount_total_minor: number | null; // integer minor units (cents for USD)
  amount_tax_minor: number | null;
  amount_refunded_minor: number | null;
  credits_total: number | string | null; // numeric(18,6): a number or a numeric string
  paid_at: string | null;
}
```

### The two methods

| # | Signature | Query |
|---|---|---|
| **R-k** | `listBoostPurchasesAllAccountsPaidInRange(range, opts?)` | `pageClientRows('listBoostPurchasesAllAccountsPaidInRange', () => this.supabase.from('business_os_boost_purchases').select(FINANCE_BOOST_PURCHASE_COLUMNS), this.rangeFilter('paid_at', range), 'Boost purchase rows', null, opts)` |
| **R-k′** | `listBoostPurchasesForAccountPaidInRange(accountId, range, opts?)` | The same with `{ accountId }`: UUID checked first (`:641-643`), then `.eq('user_id', accountId)` on every page |

Each `.from(` names the table as a literal, so the SA-WR-16 count (`fromCallsOf(code) === tables.length`) still holds and the set stays the eight tables. A purchase with `paid_at` NULL is never in a window; that is the definition (S4-W-1), and `flagged_mismatch` rows have no `paid_at` (§11C.1).

### Header changes

- The opening block names slice 4a and reads R-k, R-k′: the platform's own boost purchases, layer A.
- **ACCOUNT SCOPE** lists the new pair under ALL ACCOUNTS and ONE ACCOUNT.
- **TEST AND LIVE MODE** adds R-k / R-k′ to layer A's "counts test and real rows together".
- **PAGING:** "R-e to R-k′ use one pager", with the `CLIENT_*` limits (SA-W49).
- The boost purchase repository stays named in words only (`:531-537`).

### Tests (`BusinessOsFinanceReadRepository.test.ts`)

The recording client already has `gte` and `lt` (`:86`). A new import line keeps the earlier ones byte-identical.

1. **Columns:** `FINANCE_BOOST_PURCHASE_COLUMNS` equals the exact list; it contains none of `livemode`, `stripe_`, `receipt_url`, `flag_reason`, `lot_id`, `created_at`, `status_changed_at`.
2. **R-k, one page:** table `business_os_boost_purchases`, the exact columns, `gte('paid_at', '2026-10-01T00:00:00.000Z')`, `lt('paid_at', '2026-11-01T00:00:00.000Z')` (**AC-88's query half**, S4-F2), `order('id', asc)`, `limit(1000)`; no `eq`, `not`, `or` or `gt`; `JSON.stringify(q)` has no `livemode`.
3. **AC-88 microsecond boundary on the query:** with a range of `[2026-11-01T00:00:00.000Z, 2026-12-01T00:00:00.000Z)` the query carries exactly those ISO strings on `gte` / `lt`; the database applies the microsecond rule (`timestamptz` compared with the half-open bounds).
4. **Keyset:** a full first page, then `gt('id', <last id>)`, stopping on a short page.
5. **Ceiling:** `{ ceiling: 3, pageSize: 2 }` → 3 rows, `reachedCeiling: true`, `error: null`; exactly 3 → `true`; 2 → `false`.
6. **R-k′:** `.eq('user_id', A)` on every page; a malformed id (`''`, `'not-a-uuid'`, `"' or 1=1"`) refused **before** `from` is called, `{ data: null, error }`, warn; no info line carries the id.
7. **Bad range or options** → refused before querying. **Read error** → `{ data: null, error }`, logged at error, never throws.

These run as a `describe.each` over R-k / R-k′, the 2a shape (`:386-508`).

---

## Money maths: minor units, exact

All in `boostRevenue.ts`. It imports `minorUnitsPerMajor` from `@/lib/payments/refundMath` (pure, no import of its own), `normaliseCurrencyCode`, `groupByCurrency` and `CURRENCY_SCALE` from `./currencyGroups`, and `toUnits` and `CREDIT_SCALE` from `@/lib/business-os/credits/creditReport` (already a finance dependency through `currencyGroups.ts:24`).

```ts
/** SA-W48: one purchase's money in integer minor units, or null when any part is unreadable. */
function readMoney(row: BoostPurchaseInput): { code: string; total: number; tax: number } | null;
// readable only when:
//   code = normaliseCurrencyCode(row.currency) is not null
//   minorUnitsPerMajor(code) === 100           (SA-Q26: the one definition; USD today)
//   total, tax and refunded are each typeof 'number', Number.isSafeInteger, >= 0
//   refunded <= total
```

| Rule | How |
|---|---|
| Scale | Integer cents **are** hundredths when, and only when, `minorUnitsPerMajor(code) === 100`. They go to `groupByCurrency` as they are (`hundredths: row.amount_total_minor`). Never `toHundredths`, never `toUnits`, never `* 100` (SA-Q26, SA-W54) |
| `minorUnitsPerMajor` input | Only a normalised, non-null code (it calls `.trim()`, `refundMath.ts:45`). A null code makes the purchase unreadable without calling it |
| Unreadable | Row level (SA-W48): the purchase adds no money anywhere, is counted, and the figures it touches become "At least" (gross, tax, refunded) or Unknown (held, lost, net). Never 0 |
| Sums | Inside `groupByCurrency`, which flags `overflow` past the safe-integer range (a line with `overflow` is treated as unreadable, never silent) |
| Wire | Each sum divided by `CURRENCY_SCALE` once, at the edge (the 2a `toMoney`, SA-W26). `formatMoney` prints exactly two decimals |
| Credits sold | `toUnits(row.credits_total, CREDIT_SCALE)`: an integer number of micro-credits, summed per currency line and per package, divided by `CREDIT_SCALE` once. `NaN` (unreadable credits) is counted and makes credits sold "At least" on that line; it never touches money |
| No FX | No rate, no `exchange_rates`, no export that adds two lines (BD-12) |

**Tests (`boostRevenue.test.ts`):** 1000 → 10.00 and 1999 → 19.99 on the wire (AC-90); 1.5, -1, `Number.MAX_SAFE_INTEGER + 2`, `'1000'`, `null` total on a paid row, refunded 1200 on total 1000, a NULL currency, and a mocked `minorUnitsPerMajor` returning 1000 for the row's code: each unreadable, counted, net Unknown, block `partial`, never 0 (AC-90). A `jest.mock('@/lib/payments/refundMath')` spy proves the builder asks `minorUnitsPerMajor` with the normalised code and never with `null`.

---

## The boost revenue builder

`lib/business-os/finance/boostRevenue.ts`: pure (SA-WR-4).

```ts
export interface BoostPurchaseInput {        // structural (SA-W22): no repository import
  id: string; user_id: string | null; status: string | null;
  package_id: string | null; package_version: number | null; currency: unknown;
  amount_total_minor: unknown; amount_tax_minor: unknown; amount_refunded_minor: unknown;
  credits_total: unknown;
}

/** S4-W-2: the statuses that count, matched exactly (SA-WR-15). Checked against the migration CHECKs by a test. */
export const BOOST_PAID_FAMILY = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'] as const;

export function buildBoostRevenue(input: {
  purchases: { rows: readonly BoostPurchaseInput[]; reachedCeiling: boolean } | null;   // null: R-k / R-k′ failed
  scope: 'all' | 'one';
}): BoostRevenueResult;   // { status, lines, packages, deletedAccounts, notes, k5 }
```

| Figure | Rule |
|---|---|
| Counted purchase | `status` is exactly one of `BOOST_PAID_FAMILY`. Any other status, NULL included, goes to `otherStatusPurchases` and nowhere else (S4-W-2, AC-89) |
| Purchases | Count of counted purchases per line, unreadable ones included (as 2a's `payments`) |
| Gross charged | Σ `amount_total_minor` of readable counted purchases |
| Of which tax | Σ `amount_tax_minor` (shown, not deducted) |
| Refunded, held, lost | From `refundsAndDisputesOf(row)` only ([DF-5](#df-5-the-refund-month-rule-in-one-place)): refunded = Σ `amount_refunded_minor`; held = Σ `total - refunded` over `disputed`; lost = the same over `dispute_lost` |
| Net | `gross - refunded - held - lost`, **only when exact**: null when R-k reached its ceiling, or the line has an unreadable purchase or an overflow (S4-W-8, SA-W48). Never a lower bound minus a figure |
| Credits sold | Σ `credits_total` (see Money maths) |
| Lines | `groupByCurrency` over counted purchases, one per normalised code, sorted, Unknown last (S4-W-5) |
| Packages | Key `(currency, package_id, package_version)` as stored (SA-Q30): purchases, gross, refunded, net (same exactness rule), `unreadable`. Sorted by currency (Unknown last), then `package_id` ascending, then `package_version` ascending; a NULL id or version sorts last within its currency and is shown as "Not recorded" (defensive: both are NOT NULL). **No cap**: the keys are bounded by the catalogue's packages and versions. Deleted accounts' purchases are in these rows too (all-businesses totals) |
| Deleted accounts | `scope === 'all'` only: one line per currency over counted purchases with `user_id` NULL: purchases and net (same exactness rule). `scope === 'one'` → `null` (S4-FR-8). A currency with no deleted purchase has no line; no deleted purchase at all → `[]` ("No purchases from deleted accounts") |
| Exactness | `exact = !reachedCeiling`. When false: purchases, gross, tax, refunded and credits sold are "At least"; held, lost and net are null ("Unknown (a read was cut off)") on every line, package and deleted line (S4-W-8, AC-93) |
| Notes | `{ empty, exact, otherStatusPurchases, unreadablePurchases, refundOrDispute }`. `refundOrDispute` is true when any line has refunded, held or lost above 0, or any of them is unknown because of a dispute or refund row (it drives the S4-W-3 note, AC-91) |
| Status | Read failed → `unknown`, everything null. Else `partial` when the ceiling was reached, or any unreadable purchase, unreadable credits or other-status row exists; else `ok` |
| Empty | No counted purchase → `lines: []`, `packages: []`, `deletedAccounts: []` (or null with a business picked), `empty: true`, status `ok` (AC-94) |
| K-5 summary | `k5`: `failed` (read failed); `none` (empty); `one` with the line's currency and net, or `unknown` (`cut_off` / `unreadable`) when that net is null; `several` with the line count (SA-W47) |

All sums stay integer minor units (and integer micro-credits) inside the builder; the payload values are divided once.

**Tests (`boostRevenue.test.ts`):**
- **AC-87 method:** a fixture's figures equal an independent `checkFourteen(rows)` helper written in the test from check 14's SQL (grouping sets: per package and `ALL`), the 1b `checkFive` approach.
- **AC-88 builder half:** a row given once counts once; the builder never looks at `paid_at` or `created_at` (the source test pins that `paid_at` and `created_at` are not read in `boostRevenue.ts`).
- **AC-89:** each of the five statuses counts; planted `pending`, `flagged_mismatch` and NULL statuses are left out and counted.
- **Migration-literal test (S4-W-2):** read `supabase/migrations/20261030_business_os_boost_purchases.sql`, extract the `paid_family_complete` `NOT IN (…)` list and the `status_known` `IN (…)` list; `BOOST_PAID_FAMILY` equals the first exactly and is a subset of the second. A planted extra status in the extracted text fails (control).
- **AC-90, AC-91, AC-92 (builder half), AC-93, AC-94, AC-97:** as named; AC-91 covers a partial refund, a full refund, `disputed` with an earlier partial refund (held = total - refunded) and `dispute_lost`.
- **SA-W48:** each unreadable case listed under Money maths.
- **K-5 summary:** each of the five kinds.

---

## DF-5: the refund-month rule in one place

```ts
/**
 * DF-5 (SA-Q28): a boost refund or dispute counts in the window of the PURCHASE
 * (its paid_at), as recorded on the purchase today. No refund or dispute date
 * is stored, so a later refund lowers an earlier month. This is the ONLY code
 * that reads amount_refunded_minor or the two dispute statuses. If the user
 * chooses "the month the refund happened", this function is fed from a dated
 * refund read instead of the purchase row; nothing else changes.
 */
function refundsAndDisputesOf(row: ReadableBoost): { refunded: number; held: number; lost: number };
```

- The S4-W-3 note is one constant, `REVENUE_REFUND_TIMING_NOTE` in `financeCopy.ts`, shown whenever `notes.refundOrDispute` is true.
- **Source pin (T4):** in `boostRevenue.ts`, `amount_refunded_minor`, `'disputed'` and `'dispute_lost'` appear only inside the body of `refundsAndDisputesOf` and in `BOOST_PAID_FAMILY` / `BoostPurchaseInput`. A planted read of `amount_refunded_minor` outside the function fails (control).

---

## The builder, the wiring and the route

### `financeHealth.ts`

- `finance: Pick<…, … | 'listBoostPurchasesAllAccountsPaidInRange' | 'listBoostPurchasesForAccountPaidInRange'>` (`:173-188`).
- The `Promise.all` (`:380-440`) gains one settled read, so it runs beside every other read (S4-FR-14):
  - `settle(() => accountId !== null ? deps.finance.listBoostPurchasesForAccountPaidInRange(accountId, takingsRange) : deps.finance.listBoostPurchasesAllAccountsPaidInRange(takingsRange))`. The range is the existing `takingsRange = { from: window.start, to: window.end }` (`:374`), renamed `windowRange` since two blocks now share it.
- A failure is logged with the existing `failed('boost_purchases', err)` (`:326`).
- `buildBoostRevenue({ purchases: boostPurchases.data, scope })`. **No names call**: the block shows no business (packages and the deleted line are not per business).
- The revenue section (SA-W50):
  - `plans`: `revenueResult.data ? (planInvoicesPaid > 0 ? 'recorded' : 'none') : 'unknown'`.
  - `state`: unchanged (`:531-536`).
  - `boosts`: `{ status, scope, lines, packages, deletedAccounts, notes }`; `lines`, `packages` and `notes` null only when `unknown` (S4-FR-10).
  - `status`: `unknown` when both reads failed, `partial` when one failed or `boosts.status` is `partial`, else `ok`.
- **K-5** (`:730-735`, `:781`): see [K-5](#k-5).
- `counts.boosts`: `{ rows: number | null, ceiling: boolean, counted, otherStatus, unreadable, currencies, packages, deletedAccountPurchases }`. Counts and booleans only.
- Delete `K5_NONE_YET` / `K5_RECORDED` (`:151-153`); a grep shows no other user (V-9).
- Header: a "OUR REVENUE (slice 4a)" paragraph, and R-k in the account-scope list of all-accounts methods not called when a business is picked.

### `financeHealthDeps.ts`

Two delegation lines in the `finance` block (`:112-134`), each a direct call on `businessOsFinanceReadRepository`. The header's finance bullet adds "and the boost purchases paid in the window (layer A, slice 4a)". No other import.

### `financeTypes.ts`

```ts
export interface FinanceBoostLine {
  currency: string | null;                  // null = "Unknown currency"
  purchases: number; gross: number; tax: number; refunded: number;
  held: number | null; lost: number | null; net: number | null;
  creditsSold: number;
  unreadable: number;                       // purchases with an unreadable amount (excluded, never 0)
  unreadableCredits: number;
}
export interface FinanceBoostPackageRow {
  currency: string | null; packageId: string | null; packageVersion: number | null;
  purchases: number; gross: number; refunded: number; net: number | null; unreadable: number;
}
export interface FinanceBoostDeletedLine { currency: string | null; purchases: number; net: number | null; unreadable: number }
export interface FinanceBoostNotes {
  empty: boolean; exact: boolean; otherStatusPurchases: number; unreadablePurchases: number; refundOrDispute: boolean;
}
export interface FinanceBoostRevenue {
  status: FinanceSectionStatus; scope: 'all' | 'one';
  lines: FinanceBoostLine[] | null; packages: FinanceBoostPackageRow[] | null;
  /** Null with a business picked (S4-FR-8) or when the read failed. */
  deletedAccounts: FinanceBoostDeletedLine[] | null;
  notes: FinanceBoostNotes | null;
}
export interface FinanceRevenueSection {
  status: FinanceSectionStatus;
  state: FinanceRevenueState;               // R-d, unchanged
  plans: 'recorded' | 'none' | 'unknown';   // S4-FR-4
  boosts: FinanceBoostRevenue;              // S4-FR-10
}
export type FinanceTileMoney =
  | { kind: 'one'; currency: string | null; net: number }
  | { kind: 'several'; currencies: number }
  | { kind: 'none' }
  | { kind: 'unknown'; reason: 'failed' | 'cut_off' | 'unreadable' };
// FinanceTile gains:  money?: FinanceTileMoney;   // K-5 only (SA-W47)
```

Every money field sits in an object that also has a `currency` key. That is what the AC-92 payload walker checks.

### The route

Only the info line (`route.ts:173-204`): `sections.revenueBoosts: payload.revenue.boosts.status`, and `counts` (which now carries `counts.boosts`). The header gains one sentence for slice 4a. Zod (`.strict()`, `:91`), the gate, the 404 / 500 paths and `no-store` are untouched: **no new query parameter**.

---

## K-5

| Situation | `status` (state word) | Headline | Value shown | Caption |
|---|---|---|---|---|
| R-k / R-k′ failed | `unavailable` ("Could not check") | `Unknown` | "Unknown" | "Credit boosts; plans in a later update · {window} UTC" |
| No counted purchase | `neutral` ("For information") | "No data yet" | none | same |
| One currency, net exact | `neutral` | "Net of refunds and disputes" | `formatMoney(net, currency)`, e.g. "USD 10.00" | same |
| One currency, net unknown (ceiling or unreadable) | `neutral` | "Net of refunds and disputes" | "Unknown" (never "At least", S4-W-8) | same |
| Several currencies | `neutral` | "Net of refunds and disputes" | "N currencies, see Our revenue" | same |

- The colour goes through `colourFinanceTile('k5_our_revenue', rules.k5_our_revenue, measurement, …)`, with `measurement = null` when the read failed and `{ metrics: {}, information: headline }` otherwise. K-5 rules stay `[]`, so it is never red, amber or green in 4a (it is not in `FINANCE_GREEN_ELIGIBLE`). 4b adds its dispute metric to the same call.
- The tile's `money` comes from the builder's `k5` summary, so K-5 and the section show the same figure from the same read (SA-Q25).
- K-5 no longer depends on R-d: R-d failing changes the plans line, not K-5.
- The strip never adds two currencies: it prints one `money.net` or a count of currencies.

---

## With a business picked (AC-96)

The tenant-isolation-guard **read** invariant. The service role is used, and the only caller-supplied id is `accountId`. It is validated as a UUID (route Zod), refused if it is a platform account, and checked against the plan table **before** any read (`financeHealth.ts:330-338`). Nothing writes.

| Read | All businesses | One business picked |
|---|---|---|
| Boost purchases | **R-k** | **R-k′(accountId, range)**: `.eq('user_id')` on every page; UUID refused before the query |
| Revenue existence | R-d | R-d, unchanged: the platform-wide exception (AC-42), plans line only |
| Names | none | none |

With `accountId` set, **R-k has zero calls**, the deleted-accounts line is `null` (not shown), and K-5 shows that business's net.

**Required test (SA-WR-3 shape):** in `financeHealth.test.ts` and through the route in `route.test.ts`, with spies on both methods and `countRevenueRows`. With `accountId`: R-k′ receives exactly `accountId` and the window range; R-k has zero calls; `countRevenueRows` is called with no argument.

---

## Failure matrix

Never a 500 for a failed read (SA-Q8). Never a lower bound minus a figure.

| What happens | Section status | Plans line | Boost part | Lines: gross / tax / refunded / credits | Held / lost / net | K-5 |
|---|---|---|---|---|---|---|
| Nothing wrong | `ok` | recorded / none | lines | exact | exact | value |
| R-k failed (AC-95) | `partial` | as R-d says | "Could not load" | — | — | "Unknown", Could not check |
| R-d failed | `partial` | "Could not check" | lines | exact | exact | value (unchanged) |
| Both failed | `unknown`: "Could not load this section" + Retry | — | — | — | — | "Unknown" |
| R-k at its ceiling (AC-93) | `partial` + notice | as R-d | lines | "At least" | **Unknown (a read was cut off)** | "Unknown" |
| An unreadable purchase (AC-90) | `partial` + notice with the count | as R-d | lines | "At least" on that line, "excludes N unreadable" | Unknown on that line | "Unknown" if that is the one line |
| An other-status row (AC-89) | `partial` + count | as R-d | lines | left out | unchanged | unchanged |
| No counted purchase (AC-94) | `ok` | as R-d | "No credit boosts paid in this window" | — | — | "No data yet" |
| Every other section's read failed | independent | — | — | — | — | — |

---

## The page

`RevenuePanel.tsx` (client, `import type` only from `lib/business-os/finance/`), still directly under the KPI strip and above `TakingsSection` (`FinanceView.tsx:97-98`).

- **Frame:** `FinanceSection` with `id="revenue"`, title "Our revenue", subtitle "Credit boosts paid, all businesses · {window} UTC" or "Credit boosts paid, this business · {window} UTC" (S4-FR-1), the section status, `onRetry`. No badge.
- **Plans line** (`data-testid="revenue-plans"`): "Plan payments: amounts are shown in a later update" (`recorded`), "No plan payment recorded" (`none`), "Plan payments: could not check" (`unknown`) (S4-FR-4).
- **Boosts per currency:** a table (`ADMIN_TABLE_WRAP`, `ADMIN_TABLE`, `ADMIN_THEAD`, `ADMIN_TH` / `ADMIN_TH_NUM`, `ADMIN_TBODY`, `ADMIN_TD` / `ADMIN_TD_NUM`), `aria-label="Credit boosts per currency"`, `scope="col"`. Columns: Currency, Purchases, Gross charged, Of which tax, Refunded, Held in open disputes, Lost in disputes, Net, Credits sold. Money cells through `formatMoney` (the currency in every cell); counts through the shared `formatCount`; credits through `formatCredits`. "At least" and "Unknown (a read was cut off)" in words. The Net header carries "Net of refunds and disputes (Stripe fees not deducted; includes any tax)" (S4-W-6).
- **By package:** a table, `aria-label="Credit boosts by package"`: Currency, Package (`{package_id} v{package_version}`, or "Not recorded"), Purchases, Gross charged, Refunded, Net.
- **Deleted accounts** (all businesses only): one line per currency, "Deleted accounts: N purchases, net USD x" (S4-W-7); "No purchases from deleted accounts" when empty. Never a name.
- **Notes:** the S4-W-3 refund-timing note when `notes.refundOrDispute`; `AdminNotice` for each partial cause (ceiling, unreadable count, other-status count).
- **Cannot produce (S4-FR-13):** one short list: real Stripe fees, the date of a refund or dispute, plan revenue (a later update), one total across currencies.
- **States:** `AdminEmpty` "No credit boosts paid in this window" (no currency line, no `0.00`, AC-94). The boost part says "Could not load" when R-k failed and the section is `partial`.
- **BD-14:** no test-mode label, note or switch (S4-FR-6, AC-81).
- **Copy:** every string in `financeCopy.ts`, next to `REVENUE_*` (S4-FR-12). No figure, currency code, package id or status literal is typed in the component.

`FinanceKpiStrip.tsx`: K-5's `value` comes from `tile.money` (the [K-5](#k-5) table), and its `sub` is the caption with `windowLabel`. K-1 to K-4 are unchanged; the strip still holds exactly five tiles.

---

## Entitlements registration check

Following the `business-os-entitlements` skill, row by row:

| Tripwire | 4a |
|---|---|
| A file outside the module **newly** imports from it | **No.** Package labels are the stored `package_id` / `package_version` (SA-Q30); `boostPackages.ts` was read for this workplan only and is not imported. The finance guard's "only `planGroups.ts` and the wiring import the module" (`finance.source.guard.test.ts:165-168`) holds |
| A listed file's symbol set changes | **No.** No registered importer is edited |
| A tier name as a literal | **None.** Package ids are not tier ids; test fixtures use `starter`, which is not in `tierOrder`. `tierLiteral.forbidden` and the finance tier rule (`:144-149`) prove it |
| A capability id literal, a catalog or matrix change | None |
| A gate | None: display only, refuses nothing |

`npm run test:bos-entitlements` runs before handover (V-3): the diff touches `lib/repositories/__tests__`, which that suite includes.

---

## Tenant isolation check

Following the `tenant-isolation-guard` skill:

- **Service role, caller-supplied id:** yes, `accountId`, validated as a UUID by the route behind `requireAdmin`, and checked against the plan table before any read. R-k′ refuses a malformed id before any query and filters `.eq('user_id', accountId)` on every page.
- **No write**, no trigger, no upsert, no payload: the write half of the guard does not apply. The no-write pin is unedited.
- **Picked business:** R-k′ receives exactly that id; R-k is not called (AC-96). R-d stays the one documented platform-wide exception: head counts, no account, no amount.
- **Deleted accounts:** rows with `user_id` NULL are read only by R-k (all accounts). They are shown as a line, never attributed to anyone, and never reachable with a business picked (`.eq('user_id', id)` cannot match NULL).
- **No Stripe or customer data:** the column list carries no Stripe id, receipt URL, flag reason or lot id (S4-FR-9, AC-98).

---

## Guard table, line by line

| Guard | 4a trips it? | Exact change |
|---|---|---|
| **`finance.source.guard.test.ts` table pin** (`REPOSITORY_TABLES`, `:271-291`) | **No** (SA-RR-4, verified): `business_os_boost_purchases` is already one of the eight (R-d) | **Run unchanged.** The two new `.from('business_os_boost_purchases')` calls are literals, so `fromCallsOf(code) === tables.length` and `>= 8` still hold. Only the comment above `REPOSITORY_TABLES` gains "R-k and R-k′ read the boost table too" |
| Same file, repository-wide `livemode` rule (`:352-356`) and `MODE_WORDING` (`:570`, `:601-603`) | **No** | Nothing selects or names the mode column; the copy carries no mode wording |
| Same file, layer-B rule over `LAYER_B_FREE` (`:123`, `:132-134`) | **No** | `boostRevenue.ts` and the page name no payment table and no boost table (S4-FR-11: table-free builder) |
| Same file, `LAYER_B_METHODS` body rule (`:305-341`) | **No** | Not edited; R-k / R-k′ are layer A and covered by the repository-wide rule. The 4a describe checks their bodies are found (non-vacuity) |
| Same file, tier literal (`:144-149`), entitlements importers (`:165-168`), SA-WR-11 (`:225-231`), LOT symbols / G3 (`:212-216`), processor literal (`:394-396`), status literal (`:478-483`), reminder vocabulary (`:461-463`), due dates (`:510-512`) | **No** | None of these words or imports appear in the 4a files; the run proves it |
| Same file, `MONEY_ARITHMETIC` on page files (`:399-411`) and `AMOUNT_ARITHMETIC` (`:543-558`) | **No** | The page prints server figures only; net comes from the builder |
| **Same file, new `slice 4a` describe** | Added | (a) Non-vacuity: `FILES` contains `boostRevenue.ts` and `RevenuePanel.tsx`; the R-k / R-k′ bodies are found in the repository. (b) `boostRevenue.ts` never names `toHundredths`; names `toUnits(` exactly once, with `credits_total` and `CREDIT_SCALE`; contains no `* 100`, `*100` or `CURRENCY_SCALE *` (SA-Q26, SA-W54). (c) `boostRevenue.ts` reads neither `paid_at` nor `created_at` (AC-88: the query decides). (d) The DF-5 pin (SA-W53). (e) `boostRevenue.ts` imports no repository and no Supabase client (SA-W22). (f) The page files add or subtract none of `held`, `lost`, `tax`, `creditsSold`, `gross`, `refunded`, `net` (the SA-WR-18 rule extended to the new fields). (g) No `exchange_rates` and no cross-currency export: `boostRevenue.ts`'s exports are pinned exactly (`BOOST_PAID_FAMILY`, `BoostPurchaseInput`, `BoostRevenueResult`, `buildBoostRevenue`). (h) No Stripe or lot column name (`stripe_`, `receipt_url`, `flag_reason`, `lot_id`) in the repository's boost column constant, the builder or the page. **Each rule has a planted negative control** |
| `BusinessOsFinanceReadRepository.test.ts` | Extended | New describes (above). **`FINANCE_READ_LIMITS` equality (`:130-135`), no-write (`:523-525`), no-aggregate (`:527-529`), writer-name (`:531-537`, `BoostPurchase` included) and one-caller (`:539-565`) pins unedited** (SA-W22, SA-W49) |
| `BusinessOsBoostPurchaseRepository.test.ts` (SA Q-1 / C-5 identifier pins, `:612-635`) | **No** (SA-RR-4, verified): finance never names a `…ForWebhook` finder, `listForReconcile` or the boost repository | Run unchanged and paste (V-5) |
| Boost repository caller lists | **None exists** beyond those identifier pins (§11C.7); finance never imports the boost repository, its types or its status constant (`BOOST_PAID_FAMILY` is finance's own literal) | Nothing |
| Stripe webhook placement guards: `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`, `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts`, `lib/payments/__tests__/planSurfaces.guard.test.ts` | **No** (SA-RR-4): the builder is under `lib/business-os/finance/`, never `lib/business-os/billing/` (S4-FR-11). Importing `lib/payments/refundMath` adds no file to any of their scans | Run all three unchanged and paste (V-5). Any trip goes to SA, never a list edit |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts`, `businessOwnedTables` | **No**: no new table; the boost table's purge classification is unchanged | Run (inside V-3) |
| `enforcementPoints.test.ts`, `tierLiteral.forbidden.test.ts`, RC-15, ledger caller list, `accountSeam.guard` | **No**: no entitlements import (SA-Q30), no tier literal, no ledger change | `test:bos-entitlements` proves it (V-3) |
| G3 in `creditLots.test.ts`, `BusinessOsCreditLotRepository.test.ts` | **No**: no lot code in 4a (4b) | Run (inside V-3) |
| `app/admin/finance/__tests__/source.guard.test.ts` | **No**, by construction | `RevenuePanel.tsx` and `FinanceKpiStrip.tsx` import only types from `lib/business-os/finance/`, no repository, no `server-only`, no `console.` |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `paymentTablesWriteLockdownMigration.test.ts`, `AdminJobsQueuesRepository.test.ts` | **No** | Run unchanged (V-5) |
| Shared layout folder guard `layoutFolder.guard.test.ts` | **No**: no shared file changed; finance not in the registry (DF-4) | Run unchanged (V-5) |
| `serviceColumn.guard.test.ts`, Health suites, `AdminSidebar.nav.test.ts` | **No** | Run unchanged (V-5) |
| Admin authz surface guard | **No**: no new route or page | `test:authz-guard` (V-4) |

**No new CI job and no added PR critical-path time:** every new test runs in the existing Jest gate, and the repository test also runs in `test:bos-entitlements`.

---

## AC mapping

T-numbers: **T1** `BusinessOsFinanceReadRepository.test.ts`, **T2** `boostRevenue.test.ts` (new), **T3** `financeHealth.test.ts`, **T4** `finance.source.guard.test.ts`, **T5** finance `route.test.ts`, **T6** `financePage.render.test.tsx`, **T7** `app/admin/finance/__tests__/source.guard.test.ts`. QA = a recorded manual step.

| AC | Test / check |
|---|---|
| **AC-87** | T2 against the independent `checkFourteen` helper (per package and `ALL`; net = gross - refunded - held - lost); QA: check 14 against the page (V-11) |
| **AC-88** | T1: `gte('paid_at', start)` / `lt('paid_at', end)` with ISO strings on both reads, including a month-boundary range (S4-F2); T2: a row given once counts once; T4: the builder reads no `paid_at` / `created_at`. The database applies the microsecond rule; QA can confirm with check 14's bounds |
| **AC-89** | T2: the five statuses count; planted `pending`, `flagged_mismatch`, NULL left out and counted; the migration-literal test; T6: "N purchases with another status not counted" |
| **AC-90** | T2: 1000 → 10.00, 1999 → 19.99; each SA-W48 unreadable case (incl. a mocked `minorUnitsPerMajor` ≠ 100) counted, excluded, net Unknown, `partial`; T4: the `toUnits` / `toHundredths` / × 100 rule; T6: "USD 10.00", "USD 19.99" |
| **AC-91** | T2: partial refund, full refund, `disputed` with an earlier partial refund, `dispute_lost`; the note flag; T4: DF-5 pin; T6: the note shown when a refund or dispute amount is non-zero, absent otherwise |
| **AC-92** | T2 (USD + a planted second currency → two lines); T3 (K-5 `several`, 2); T5 payload walker (every money key in `revenue.boosts` and `tiles.k5.money` has a sibling `currency`; no top-level money field); T6 ("2 currencies, see Our revenue"; no element renders a total across currencies); T4 (export pin) |
| **AC-93** | T1 (injected small ceiling → `reachedCeiling`); T2 (flags, held / lost / net null); T3 (section `partial`, K-5 `unknown` / `cut_off`); T6 ("At least", "Unknown (a read was cut off)", notice, K-5 "Unknown") |
| **AC-94** | T2 (`empty`, `ok`); T3 (K-5 neutral "No data yet"); T6 (the sentence, no currency line, no `0.00`) |
| **AC-95** | T3: owner-purchase fixture (Starter, 1000, 5,000 credits) → K-5 `neutral`, `money { one, USD, 10 }`; R-k failing → K-5 `unavailable` "Unknown", boost part "Could not load", every other section present, 200 (also T5); T6: "USD 10.00", caption, grey, no green style |
| **AC-96** | T3 and T5: R-k′ receives exactly the id and the window range; R-k zero calls; `deletedAccounts` null; `countRevenueRows` called with no argument |
| **AC-97** | T2: a NULL `user_id` purchase in the totals, its package row and the deleted line; T6: the line in words, no name; QA: check 14's `deleted_account_purchases` (and `deleted_account_net_minor` if SA-W51 is accepted) |
| **AC-98** | T1: the column list (no Stripe id, receipt URL, flag reason, lot id); T5: the payload carries none of those keys; the info line carries `sections.revenueBoosts` and `counts.boosts` only (a planted amount `9876.54`, a currency code and a package id appear in no log call); T1: the repository info line carries no amount or id |
| **AC-99** | T5: 401, 403 (incl. the `profiles.role`-only admin) and every AC-4, AC-33, AC-34 400 case plus an unknown key, with zero calls on both new reads (they are in `mockDeps.finance`, so `allReads()` covers them) |
| **AC-100** | T4 write-verb pins over the new files; T1 no-write pin unedited; V-9 `git diff --stat` shows no `supabase/migrations` path; T4 repository-wide `livemode`; V-3 to V-5 every §11C.7 row with the three webhook guards unchanged; V-8 scoped `tsc` with a canary |
| **AC-101** | QA manual steps L-49 to L-56 below |

**1c tests superseded (SA-W50):** AC-75, AC-76 and AC-77 in T3 (`financeHealth.test.ts:427-449`) and T6 (`:383-407`) assert K-5's old headline and the "recorded" copy. They are rewritten to the 4a meaning (plans line from R-d, K-5 from R-k). AC-39 (revenue check failed) becomes the R-d-failed row of the failure matrix. AC-81 (no mode or webhook wording) stays and is re-run over the new copy.

---

## Verification plan

The worktree has the `node_modules` junction. Never `git worktree remove`, never `git stash`, never `npm install` through the junction.

Before SA code review, Dev runs these and pastes the command, exit code and counts. Exit codes are read from the tool itself, never from a pipe.

| # | Command | Evidence |
|---|---|---|
| V-1 | **Finance suites:** `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Suites and tests passed |
| V-2 | **Businesses-list suites, unchanged:** `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | Pass; diff exit 0 (4a touches none of them) |
| V-3 | `npm run test:bos-entitlements` | Exit 0 (enforcementPoints, tier literal, purge descriptors, `businessOwnedTables`, the lot and ledger caller lists, the boost and finance repository tests) |
| V-4 | `npm run test:authz-guard` | Exit 0 |
| V-5 | **Guards, run unchanged:** `npx jest app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts lib/payments/__tests__/planSurfaces.guard.test.ts lib/payments/__tests__/refundMath.test.ts lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts lib/business-os/boost lib/business-os/billing lib/repositories/__tests__/adminReadMethods.guard.test.ts lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts lib/business-os/credits/__tests__/serviceColumn.guard.test.ts app/admin/components/layout lib/admin/health app/admin/components/__tests__/AdminSidebar.nav.test.ts --ci`, then `git diff --exit-code` on each of those paths | Pass; no guard file edited except the finance source guard |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint <every touched and new file>` | Clean |
| V-8 | **Scoped `tsc` with a canary (AC-100)**, procedure below | Canary TS2322 reported, then the clean run |
| V-9 | `git diff --stat`, read **before** the diff: no deletion-only file, no `supabase/migrations` path, no shared layout file, the requirement MD not in the diff from Dev. `grep -rn "K5_NONE_YET\|K5_RECORDED\|REVENUE_RECORDED\|REVENUE_NONE_YET" app lib` returns nothing | Output pasted |
| V-10 | `npm run schema:check` if the worktree has credentials; otherwise the note: every selected column is in migration `20261030` (`:6-32`) and in §11C.1's live column list, and check 14 names all but `id` | Output or the note |
| V-11 | **Read-only SQL check 14 for QA / the user** (§13), at QA time | Table below |

**V-8 procedure** (SA-WR-7). Write a tsconfig **outside the worktree**, in the session scratchpad, with an absolute `extends` to the worktree's `tsconfig.json`, `compilerOptions: { noEmit: true, incremental: false }`, and `include` = the worktree's `types/**/*.d.ts`, `next-env.d.ts` and every touched and new `.ts` / `.tsx` file, tests included (absolute paths). Plant `const __canary: number = 'x';` in `lib/business-os/finance/boostRevenue.ts`. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch config>` and record its own exit code. It **must** report TS2322 at the canary, or the run is not evidence. Remove the canary (`grep -c __canary` = 0), re-run, and record every diagnostic: zero in touched files, any pre-existing one attributed by path. The scratch config is never written into the worktree.

**V-11, the read-only SQL check.** Check 14 (and checks 15 and 16, which back 4b, may be run in the same sitting for information). Run in the Supabase SQL editor, with the page on "This month" and "All businesses". Boost amounts in the check are minor units: divide by 100 to compare.

| Check 14 column | Page figure |
|---|---|
| `currency`, `package = ALL` row | The currency line |
| `purchases` | Purchases |
| `gross_minor`, `tax_minor`, `refunded_minor` | Gross charged, Of which tax, Refunded (× 100) |
| `held_in_open_disputes_minor`, `lost_in_disputes_minor` | Held in open disputes, Lost in disputes |
| `net_minor` | Net, and K-5 when there is one currency |
| `credits_sold` | Credits sold |
| each `package` row (`starter v1`) | The by-package row |
| `deleted_account_purchases` (and `deleted_account_net_minor`, SA-W51) | The Deleted accounts line |

**The user's own test boost must appear:** the Starter purchase of 2026-10-12 (USD 10.00, 5,000 credits, test mode, counted as real per BD-14). It is in "This month" (October 2026, UTC) and in "30d".

**Manual QA steps (AC-101, continuing from 1c's L-48).** `npm run dev` from `neuronforge-finance-health`, signed in as a platform admin.

| # | Step | Expected |
|---|---|---|
| L-49 | Open `/admin/finance` (This month, All businesses) | "Our revenue" is a section with a status chip and a subtitle naming the window (UTC) and "Credit boosts paid, all businesses"; it sits above "Takings through the platform" |
| L-50 | Read the boost line; run check 14 | USD: 1 purchase, gross USD 10.00, tax USD 0.00, refunded USD 0.00, held and lost USD 0.00, net USD 10.00, 5,000 credits sold; every V-11 row matches. By package: "starter v1". Deleted accounts: none. No test-mode wording |
| L-51 | Read K-5 | "USD 10.00", caption "Credit boosts; plans in a later update · {window} UTC", grey ("For information"), not green |
| L-52 | Read the plans line | "Plan payments: amounts are shown in a later update" (the user's Basic invoice is recorded) |
| L-53 | Switch to 30d, then a custom range that ends before 2026-10-12 | 30d still shows the purchase; the earlier range shows "No credit boosts paid in this window", no `0.00`, K-5 "No data yet" |
| L-54 | Pick the owner business, then reload the URL; then pick a business with no boost | Owner: the same line, no Deleted accounts line, K-5 "USD 10.00"; the reload reproduces it. Other business: the empty sentence, K-5 "No data yet" |
| L-55 | As a non-admin, then signed out, call `/api/admin/business-os/finance` | 403 / 401, `no-store`, no figures |
| L-56 | Read the dev-server log | One "Admin read the Business OS finance page" line with `sections.revenueBoosts` and `counts.boosts` (counts only) and `durationMs`; no amount, currency total, package id or name. **Record `durationMs`** (S4-FR-14: p95 under 2 s) |

---

## Logging

- **New lines:** R-k `info` `{ method, rows, reachedCeiling, durationMs }`; R-k′ `debug` `{ method, rows, reachedCeiling }`; guard refusals `warn` (existing `fail`); a builder read failure `error` `{ read: 'boost_purchases', err }` through the existing `failed`.
- **The route's accountability line** gains `sections.revenueBoosts` and `counts.boosts`. Counts and booleans only (S4-FR-10, SEC-8).
- **Never logged:** an amount, a net, a currency code, a package id, a business name, an account id at info (the route's validated `accountId` filter is the existing exception).
- Errors as `{ err }`. No `console.*` (T4 and T7 pin it).

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Cents multiplied by 100 (a USD 10.00 boost shown as USD 1,000.00) | `minorUnitsPerMajor` gate, no `toUnits` / `toHundredths` / × 100 (source rule with controls, SA-W54), wire tests 1000 → 10.00 and 1999 → 19.99 |
| R-2 | A cross-currency total in K-5 or the payload | K-5 shows one currency or a count; payload walker; export pin; render check |
| R-3 | Net shown on a lower bound | One rule (net only when exact), tested on the ceiling, on an unreadable purchase and on overflow |
| R-4 | DF-5 changes after the user answers | The rule lives in one function and one sentence, pinned (SA-W53) |
| R-5 | A guard trips that §11C.7 does not list | Every guard naming the boost table, the boost repository, `lib/payments` or the finance files was opened and is in the guard table; V-3 to V-5 run them all |
| R-6 | The 1c revenue tests silently keep asserting old meanings | They are listed and rewritten explicitly (SA-W50); V-9 greps the deleted constants |
| R-7 | Route latency | One more concurrent read on a 1-row table (no `paid_at` index; a sequential scan of a tiny table); `durationMs` recorded at L-56 |
| R-8 | The junction | Never `git worktree remove`, `git stash` or `npm install`; stop and report instead |
| R-9 | Another agent's parallel requirement edits appear in the diff | Dev does not edit the requirement; V-9 checks the stat; `git diff --stat` before reading any diff (the truncation lesson) |

---

## Estimate

About **2.5 days**, as the requirement sets (§11C.2, S4-F5).

| Day | Work |
|---|---|
| 0.5 | R-k, R-k′, column constant, row type, header, barrel; T1 (V-1 green on the repository first) |
| 1.0 | `boostRevenue.ts` + T2 (incl. the migration-literal test and `checkFourteen`) |
| 1.5 | Types, builder, wiring, route info line; T3, T5 (incl. the rewritten 1c revenue cases) |
| 2.0 | `RevenuePanel.tsx`, `FinanceKpiStrip.tsx`, `FinanceView.tsx`, copy; T6; the 4a source-guard describe (T4) |
| 2.5 | V-1 to V-10, the canary run, fixes; results pasted |

If day 2 ends with V-1 not green, I report it to TL then.

---

## Task List

- ✅ 0. SA workplan review; apply the rulings on SA-W47 to SA-W54 (and SA-WR-32 to SA-WR-35)
- ✅ 1. Branch `feature/bos-finance-health-4` confirmed (`git branch --show-current`); junction present; nothing committed
- ✅ 2. R-k, R-k′, `FINANCE_BOOST_PURCHASE_COLUMNS`, `FinanceBoostPurchaseRow`, header; barrel; T1 (pins unedited)
- ✅ 3. `boostRevenue.ts` + T2 (AC-87 method, AC-88 builder half, AC-89 to AC-94, AC-97, SA-W48, SA-W53, migration literal)
- ✅ 4. `financeTypes.ts`; `financeHealth.ts` (read, section, K-5, counts; delete the two K-5 constants); `financeHealthDeps.ts`; T3 (AC-93, AC-95, AC-96, rewritten 1c cases)
- ✅ 5. Route info line and header; T5 (AC-92 walker, AC-95, AC-96, AC-98, AC-99)
- ✅ 6. `RevenuePanel.tsx`, `FinanceKpiStrip.tsx`, `FinanceView.tsx`, `financeCopy.ts`; T6 (AC-90 to AC-97 render halves, AC-81 re-run)
- ✅ 7. Finance source guard: the `slice 4a` describe with planted controls; the `REPOSITORY_TABLES` comment (T4)
- ✅ 8. V-1 to V-9, outputs pasted in Implementation Notes (V-10 is the note; V-11 is QA's)
- ✅ 9. Hand over to SA code review, uncommitted. The requirement MD is not edited by Dev (TL records the workplan link and status)

---

## Implementation Notes

**Implemented by Dev, 2026-10-13/14, uncommitted on `feature/bos-finance-health-4`.**

### Files

| File | Action |
|---|---|
| `lib/business-os/finance/boostRevenue.ts` | Created (pure builder, 359 lines) |
| `lib/business-os/finance/__tests__/boostRevenue.test.ts` | Created (T2, 46 tests) |
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | R-k, R-k′, `FINANCE_BOOST_PURCHASE_COLUMNS`, `FinanceBoostPurchaseRow`, header (account scope, mode, paging) |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | Separate import line; 4a column describe; `describe.each` over R-k / R-k′; R-k′ id refusals. Existing describes unedited (R-d, limits, no-write, writer names, one-caller) |
| `lib/repositories/index.ts` | Exports; stale "live-mode" comment corrected |
| `lib/business-os/finance/financeTypes.ts` | `FinanceBoost*` types, `FinanceRevenueSection { status, state, plans, boosts }`, `FinanceTileMoney`, `FinanceTile.money?` |
| `lib/business-os/finance/financeHealth.ts` | One settled read in the `Promise.all`; revenue section; K-5 from the boost result; `counts.boosts`; `K5_NONE_YET` / `K5_RECORDED` deleted; `takingsRange` renamed `windowRange` |
| `lib/business-os/finance/financeHealthDeps.ts` | Two delegation lines; header bullet |
| `app/api/admin/business-os/finance/route.ts` | `sections.revenueBoosts`; header paragraph. Zod, gate, 404 / 500, `no-store` untouched |
| `app/admin/finance/components/RevenuePanel.tsx` | Rewritten over `FinanceSection` (`id="revenue"`) |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | K-5 value from `money`, caption with `windowLabel` |
| `app/admin/finance/components/FinanceView.tsx` | Props passed |
| `app/admin/finance/financeCopy.ts` | 4a strings; `REVENUE_NONE_YET`, `REVENUE_RECORDED`, `REVENUE_COULD_NOT_CHECK`, `REVENUE_SUBTITLE` replaced |
| T3, T4, T5, T6 | As in the task list; details below |

`console.*` in every touched file: **0** (nothing to flag or convert).

### Where each SA ruling landed

| Ruling | Where |
|---|---|
| SA-W47 / SA-WR-34 | `FinanceTile.money?` set only on K-5 (`{ ...tile(...), money }`). T3 "SA-WR-34" asserts K-1 to K-4 have no `money` key; T5 asserts the same on the wire and walks `tiles.k5.money`; T4 pins that the strip names `money.net` only inside `formatMoney(money.net, money.currency)` and `money.currencies` only inside `k5SeveralCurrencies(...)`, and reads `.money` from `k5` only (planted controls) |
| SA-W48 | `minorOf()`: `typeof === 'number'`, safe integer, `>= 0`. A numeric string is unreadable (T2 cases for total, tax and refund). Unreadable is per purchase: no money anywhere, counted, credits still counted |
| SA-W49 | R-k / R-k′ go through `pageClientRows` with no options: `CLIENT_PAGE_SIZE` / `CLIENT_CEILING`. `FINANCE_READ_LIMITS` equality pin unedited |
| SA-W50 / SA-WR-32 | `plans` from `planInvoicesPaid`; `state` unchanged. The R-d repository describe is **unedited**. New T3 test: "a test-mode plan invoice alone (R-d counts it) → plans recorded and state recorded"; "a paid boost alone → plans none, boost line shown"; "nothing paid → plans none, K-5 'No data yet'". AC-81's render rule re-run unchanged over five 4a states |
| SA-W51 | BA's E-30 (not Dev). T2's `checkFourteen` computes `deleted_account_net_minor` exactly as the E-30 SQL and AC-97 compares against it |
| SA-W52 | As ruled; `FinanceSection.tsx` untouched; `data-testid="section-revenue"` kept, page-order tests pass unedited |
| SA-W53 / SA-WR-35 | `refundsAndDisputesOf` is the only reader of the refunded amount and the two dispute literals; `REVENUE_REFUND_TIMING_NOTE` is the one copy line, used only by `RevenuePanel.tsx`. Both pinned in T4 with planted controls |
| SA-WR-33 | With a business picked the plans line reads "Plan payments, all businesses: amounts are shown in a later update" (or "… none recorded", "… could not check"); T6 render test |
| SA-W54 | In `boostRevenue.ts` the only `toUnits(` call is `toUnits(row.credits_total, CREDIT_SCALE)`; no `toHundredths`, no `* 100`; exactly one `/ CURRENCY_SCALE`, behind `minorUnitsPerMajor(code) !== 100`. T4 pins all of it |

### Deviations from the workplan text (none changes a ruling)

1. `BoostPurchaseInput.credits_total` is `number | string | null`, not `unknown`, so the single `toUnits` call can name `credits_total` directly (the SA-W54 pin). The repository row fits it.
2. `refundsAndDisputesOf(row, total)` takes the raw row plus the validated total and returns `null` when the refund is unreadable or above the total. That keeps every read of the refunded amount inside the DF-5 function (SA-W53), so `readMoney` delegates that check to it.
3. `BoostRevenueResult` also carries `counts { counted, unreadableCredits, deletedAccountPurchases }` for the info line, and `counts.boosts` gains `unreadableCredits`. These are counts only. The pinned export list (4 names) is unchanged.
4. K-5's new headlines are the constants `K5_NO_DATA_YET` ("No data yet") and `K5_NET_HEADLINE` ("Net of refunds and disputes") in `financeHealth.ts`. When the read fails, K-5 uses the default `FINANCE_UNKNOWN_HEADLINE` ("Unknown"), so `financeHealth.ts` no longer imports `FINANCE_COULD_NOT_CHECK_HEADLINE`. That export stays in `financeRules.ts`, which is not edited.
5. Existing tests edited beyond the listed 1c cases, all mechanical:
   - In T3:
     - the wiring list grew from thirteen reads to fifteen;
     - the first "all businesses" test asserts the new `revenue` shape and the K-5 "No data yet" headline.
   - In T5:
     - `toHaveLength(13)` became `toHaveLength(15)`;
     - `seed()` adds a boost row.
   - In T6:
     - the fixture's `k5` and `revenue` now have the 4a shape;
     - the `REVENUE_*` import lines are replaced.
6. `RevenuePanel.tsx` imports its types on one line: T7 requires `import type` on the same line as `from`.
7. The empty state also shows the cut-off notice when the read hit its ceiling and every row read had another status. This edge case was not in the table.

### Verification (real output)

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` | Exit 0. **17 suites, 1,438 tests passed** (re-run after the V-8 type fix: same) |
| V-2 | `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`; `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | Exit 0, **28 suites, 646 tests**; diff exit **0** |
| V-3 | `npm run test:bos-entitlements` | Exit 0, **251 suites, 7,365 tests** |
| V-4 | `npm run test:authz-guard` | Exit 0, **2 suites, 203 tests** |
| V-5 | The V-5 list plus `lib/business-os/purge/__tests__/descriptors.invariant.test.ts`; then `git diff --exit-code` on every path | Exit 0, **75 suites, 3,035 tests**. These passed: `routerPlacement.guard`, `invoiceIntentsStayUnowned.guard`, `planSurfaces.guard`, `BusinessOsBoostPurchaseRepository.test`, `descriptors.invariant`. Diff exit **0** (no guard file edited except the finance source guard) |
| V-6 | `npm run lint:hooks` | Exit 0 |
| V-7 | `npx eslint` on all 17 touched / new code and test files | Exit 0, clean |
| V-8 | Scratch `tsconfig.4a.json` outside the worktree (absolute `extends`, `noEmit`, `incremental: false`, `types/**/*.d.ts`, `next-env.d.ts`, the 17 files); canary `const __canary: number = 'x';` in `boostRevenue.ts` | **Canary run:** exit 2, `boostRevenue.ts(361,7): error TS2322` at the canary. The first canary run also caught two real errors in `summarise` (the `flatMap` entry typing); I fixed them and re-ran. **Clean run** (`grep -c __canary` = 0): exit 2, **0 errors in touched files**. Three pre-existing errors are in untouched files reached through imports: `lib/pilot/insight/MemoryManager.ts(60,48)` TS2769 and `(126,40)` TS2339, and `lib/repositories/CalibrationSessionRepository.ts(315,7)` TS2741 |
| V-9 | `git diff --stat` (read first); deletion-only check; grep | 16 modified tracked files, 1,949 insertions and 140 deletions. That count includes the requirement MD, which carries BA's parallel E-30 to E-32 edits; Dev did not edit it. New untracked files: `boostRevenue.ts`, `boostRevenue.test.ts` and this workplan. **No file has deletions without insertions.** No `supabase/migrations` path and no shared layout file. The grep for `K5_NONE_YET\|K5_RECORDED\|REVENUE_RECORDED\|REVENUE_NONE_YET` over `app lib` finds one hit only: the 1c guard's planted-control string at `finance.source.guard.test.ts:589`, which is intentional and unedited |
| V-10 | Note | No database credentials in the worktree. Every selected column is in migration `20261030` (`:6-32`), and check 14 names all of them except `id` |

### Not done / open

- V-11 (check 14) and the manual QA steps L-49 to L-56 are QA's.
- Jest printed "A worker process has failed to exit gracefully" on the multi-suite `app/admin/finance` runs, with exit 0. I did not investigate it, and I did not compare against `main`.

---

## SA Workplan Review

**Reviewed by SA — 2026-10-13, against `15300d29`**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed, applying SA-WR-32 to SA-WR-35 as you build; SA checks them at code review. BA applies E-30 to E-32 below. Coding does not wait for them, but V-11 and QA do. DF-5 stays on default (a), purchase month, and is isolated by SA-W53.

**How it was checked.** I opened the code:
- **The repository:** `pageClientRows` (`:631-688`) with the `CLIENT_PAGE_SIZE` / `CLIENT_CEILING` checks at `:645-652`, and `rangeFilter('paid_at' | 'created_at', …)` (`:594`).
- **The boost read pair:** R-k and R-k′ are a named all-accounts / account-scoped pair: UUID refused first, `.eq('user_id')` on every page, keyset on `id`, ceiling 5,000 with "At least".
- **Helpers:** `CREDIT_SCALE = 1e6` at `creditReport.ts:89`; `minorUnitsPerMajor` trims and lower-cases, so it is only ever given a normalised non-null code (SA-W48), as SA-Q26 requires.
- **K-5:** follows the window (`takingsRange` is reused).
- **The old K-5 headlines:** `K5_NONE_YET` / `K5_RECORDED` have one product user, `financeHealth.ts:733`.
- **Guards, verified untouched:**
  - the table pin stays at eight;
  - the boost repository's identifier pins are not named;
  - the webhook placement guards are untouched (the builder is under `finance/`, not `billing/`);
  - purge, `businessOwnedTables` and the entitlements registration are untouched (no new table, no entitlements import; package ids are stored values).
- **AC mapping:** complete for AC-87 to AC-101.
- **The canary** (V-8) follows SA-WR-7.
- **The 2.5-day estimate:** accepted.

### Rulings SA-W47 to SA-W54

| # | Ruling |
|---|---|
| **SA-W47** | **Approved.** An optional `money?: FinanceTileMoney` on K-5 only; `value` stays null for K-5. The money is printed only through `formatMoney` (SA-WR-34). |
| **SA-W48** | **Approved: unreadable is decided per row.** A purchase with any unreadable money field adds no money anywhere and is counted. Numeric strings in the `integer` money columns are unreadable, which surfaces a schema change instead of parsing it. Credits remain counted when readable. |
| **SA-W49** | **Approved.** Reuse `CLIENT_PAGE_SIZE` and `CLIENT_CEILING`; the `FINANCE_READ_LIMITS` equality pin stays untouched. |
| **SA-W50** | **Approved, with one condition (SA-WR-32).** It is acceptable to rewrite 1c's **K-5 headline and panel-sentence** assertions, because §11C (S4-FR-4, S4-FR-7) supersedes them. 1c's **behaviour** must stay pinned: R-d with no mode filter, where any paid plan invoice or paid boost counts, test mode included. The R-d repository test stays unedited, and a builder test pins that a test-mode invoice alone gives plans `recorded`. AC-81 is unchanged. BA records the supersession with **E-31**. |
| **SA-W51** | **Approved.** BA edit **E-30** (exact text below). Per row, net is `total - refunded` for `paid`, `partially_refunded` and `refunded`, and 0 for `disputed` / `dispute_lost`, so the column equals the page's deleted-accounts net. |
| **SA-W52** | **Approved.** `RevenuePanel.tsx` is rewritten in place over `FinanceSection` (`id="revenue"`, so the `section-revenue` test id is kept). `windowLabel` is added to the strip for K-5's caption only. `FinanceSection.tsx` is not changed. |
| **SA-W53** | **Approved.** `refundsAndDisputesOf(row)` is the one DF-5 function, and `REVENUE_REFUND_TIMING_NOTE` is the one copy line, both pinned by the source test. Switching to (b) later changes only that function's input and that sentence. |
| **SA-W54** | **Approved.** In `boostRevenue.ts`, `toUnits(` appears once (credits at `CREDIT_SCALE`), `toHundredths` never appears, and there is no `× 100`. Money is divided by `CURRENCY_SCALE` once at the edge, which is valid only because a row is readable only when `minorUnitsPerMajor` returns 100. |

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-32 (Medium). Keep 1c's R-d behaviour pinned while its K-5 wording is rewritten.**
   - The repository test's R-d describe is **not edited**: events `eq` = `kind` only; boosts filtered only by `paid_at` not null; no `livemode`.
   - Builder tests:
     - a test-mode `invoice_paid` count alone gives `revenue.plans === 'recorded'` and `state === 'recorded'`;
     - a paid boost alone gives plans `'none'` and the boost line shown;
     - nothing paid gives plans `'none'` and K-5 "No data yet".
   - AC-81's wording rules run unchanged.
2. **SA-WR-33 (Low). The plans line in the picked view.** R-d is platform-wide, so with a business picked the plans line must say so ("Plan payments, all businesses: …"), or it reads as that business's plans (E-32). Add a render test.
3. **SA-WR-34 (Low). Keep `money` on K-5 only.**
   - A type-and-builder test: K-1 to K-4 never carry `money`.
   - The strip prints `money` only through `formatMoney` (kind `one`) or the copy strings (`several`, `none`, `unknown`), never a bare number.
   - The 2a payload walker covers `tiles.k5.money`.
4. **SA-WR-35 (Low). The DF-5 source pin also covers the copy.** `REVENUE_REFUND_TIMING_NOTE` is used only by `RevenuePanel.tsx`, with a planted control. The pinned list of `boostRevenue.ts` exports is exact.

### Requirement edits (BA applies; recorded in §0.3 as SA-WP-4a)

- **E-30 (SA-W51, check 14 and AC-97).**
  - In §13 check 14, add one comment line after the line `-- The row with package ALL is the currency line; no row adds two currencies.`:

    ```sql
    -- deleted_account_net_minor is the net of purchases whose account was deleted.
    ```

  - Directly after the line `count(*) filter (where b.user_id is null) as deleted_account_purchases,`, add:

    ```sql
      coalesce(sum(b.amount_total_minor - b.amount_refunded_minor)
        filter (where b.user_id is null and b.status in ('paid', 'partially_refunded', 'refunded')), 0) as deleted_account_net_minor,
    ```

  - The text stays ASCII only, with no apostrophe in a comment and no "into", and is still one result set.
  - Append to AC-97: " Its net matches check 14's `deleted_account_net_minor`."
- **E-31 (SA-W50).** Add after AC-77 in §11B.4: "**Slice 4a note (SA-W50):** AC-75 to AC-77's K-5 headlines and panel sentences are superseded by S4-FR-4 (plans line) and S4-FR-7 (K-5 shows the boost net). Their R-d rule (no mode filter; any paid plan invoice or paid boost counts) stays pinned by the repository test."
- **E-32 (SA-WR-33).** Append to the S4-FR-4 requirement cell: " With a business picked, the line says it covers all businesses (\"Plan payments, all businesses: …\"), because R-d reads no account (AC-42)."

---

## SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** ✅ **APPROVED. Code approved for QA.** No conditions.

**How it was checked.** I read every changed and new code and test file: `boostRevenue.ts` and its test, the repository, builder, wiring, route, `RevenuePanel.tsx`, `FinanceKpiStrip.tsx`, `FinanceView.tsx`, the copy, the types and the barrel.

**My own runs (all green):**
- the finance lib, page and route, the finance repository test, `BusinessOsBoostPurchaseRepository.test.ts`, and the three webhook placement guards (`routerPlacement`, `invoiceIntentsStayUnowned`, `planSurfaces`): 21 suites, 1,576 tests;
- `test:bos-entitlements`: 251 suites, 7,365 tests;
- `test:authz-guard`: 203 tests.

### Checks

| Item | Verdict |
|---|---|
| **SA-WR-32** | ✅ The repository test diff is **166 / 0**, so the R-d describe is unedited. T3 pins that a test-mode plan invoice alone gives plans `recorded` and state `recorded`, a paid boost alone gives plans `none` with the boost line shown, and nothing paid gives `none` and "No data yet". AC-81 re-runs over the new states. |
| **SA-WR-33** | ✅ `PLANS_TEXT.one` reads "Plan payments, all businesses: …" in all three states, with a render test. |
| **SA-WR-34** | ✅ `money` is set only on K-5 (`{ ...tile(...), money }`). `k5Value` prints only `formatMoney(money.net, money.currency)` or copy strings. K-1 to K-4 carry no `money` (T3, T5), and T4 pins it with planted controls. |
| **SA-WR-35** | ✅ `refundsAndDisputesOf` is the only reader of the refunded amount and the dispute literals. `REVENUE_REFUND_TIMING_NOTE` is used only by `RevenuePanel.tsx`. Both are pinned with planted controls. |
| **SA-W48** | ✅ `minorOf` accepts only `typeof === 'number'`, a safe integer and `>= 0`, so a numeric string is unreadable (tested for total, tax and refund). An unreadable purchase adds no money anywhere; its credits still count. |
| **SA-W54** | ✅ The one `toUnits(` is `toUnits(row.credits_total, CREDIT_SCALE)`. There is no `toHundredths` and no `× 100`, and exactly one `/ CURRENCY_SCALE`, reached only after `readMoney` checks `minorUnitsPerMajor(code) === 100`. |
| **Currency decimals** | ✅ `minorUnitsPerMajor` is the only source and is called only with a normalised non-null code. Lines come from `groupByCurrency`. K-5 prints one currency or "N currencies, see Our revenue". Nothing sums across currencies. |
| **Reads** | ✅ R-k / R-k′ go through `pageClientRows` with `rangeFilter('paid_at')`: keyset on `id`, ceiling 5,000. At the ceiling, gross, tax, refunded and credits show "At least", held, lost and net show "Unknown (a read was cut off)", and K-5 shows "Unknown". There is no `livemode`. The column list has no Stripe id, receipt, flag reason or lot. |
| **Picked business** | ✅ R-k′ gets exactly the id and R-k gets zero calls; `deletedAccounts` is null. R-d is called with no argument (T3, T5). |
| **Route** | ✅ `requireAdmin` is still first (`route.ts:118`). The info line adds `revenueBoosts` and `counts.boosts`, with counts only; a planted amount, currency or package appears in no log call. |
| **K-5** | ✅ It follows the window (`windowRange`) and prints with its currency. Its caption names the window. It is neutral, never green, and has no rule in 4a. |

### Deviations

| # | Ruling |
|---|---|
| `credits_total: number \| string \| null` | **Approved.** It matches the repository row, and `toUnits` accepts both forms, so the single call names the field directly (the SA-W54 pin). |
| DF-5 function also checks that the refund is readable and at most the total | **Approved, and better.** Every read of the refunded amount stays inside the one DF-5 function, and `readMoney` delegates to it. A bad refund makes the whole purchase unreadable (SA-W48). |
| Read counts 13 → 15 (T3 wiring list, T5 `allReads()` length) | **Approved.** This is mechanical: two new methods on the `finance` Pick, and the new reads stay covered by AC-99's zero-calls assertion. |
| D-3 to D-7 (extra counts, K-5 headline constants, one-line type import, cut-off notice on an empty-but-capped read) | **Approved.** All are counts, copy or a more honest state. |

### Jest "worker failed to exit gracefully"

**It is not introduced by 4a.**
- The 4a diff adds no timer, interval, effect or `AbortController`. `boostRevenue.ts` is pure, and the page changes are render-only.
- I reproduced the warning on `app/admin/finance` (3 suites, exit 0).
- The same warning already appeared on the finance and admin suites in the slice 1a and 2a reviews, before any 4a code existed. It comes from the existing page fetch hook and jsdom teardown.
- It can be tracked separately (run `--detectOpenHandles` on `financePage.render.test.tsx`). It does not block 4a.

### Code Approved for QA: **Yes**

QA owes V-11 (check 14 with `deleted_account_net_minor`, after E-30) and L-49 to L-56: the owner test purchase "USD 10.00" on K-5 and in Our revenue, and the picked-business view.

---

## QA Report

**QA — 2026-10-14**
**Test mode:** full (AC-87 to AC-101)
**Strategy used:** A (unit) + B (route and builder integration with mocked deps), re-run from the worktree; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and §13 SQL checks 14 to 16 (QA does not run SQL against production). The steps for the user are L-49 to L-58 below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every 4a AC that Jest can test passes. AC-101 and the live half of AC-87 / AC-97 are owed by the user. Two Low notes, neither blocking.

### Test runs (worktree `neuronforge-finance-health`, branch `feature/bos-finance-health-4`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts --ci` (T1 to T7, the finance source guard included) | exit 0; **17 suites, 1,438 passed** |
| Q-2 | Businesses list: `npx jest app/api/admin/users app/admin/users lib/business-os/credits/__tests__/adminCreditPercent.test.ts lib/business-os/credits/__tests__/adminCreditPositions.test.ts --ci`, then `git diff --exit-code -- app/api/admin/users app/admin/users lib/business-os/credits` | exit 0; **28 suites, 646 passed**; diff **exit 0** |
| Q-3 | V-5 set, run unchanged: the three webhook placement guards, `refundMath.test`, `BusinessOsBoostPurchaseRepository.test`, `lib/business-os/boost`, `lib/business-os/billing`, `adminReadMethods.guard`, `paymentTablesWriteLockdownMigration`, `AdminJobsQueuesRepository`, `serviceColumn.guard`, `app/admin/components/layout`, `lib/admin/health`, `AdminSidebar.nav`, `purge/descriptors.invariant`; then `git diff --exit-code` on every path | exit 0; **75 suites, 3,035 passed**; diff **exit 0** |
| Q-4 | `npm run test:bos-entitlements` | exit 0; **251 suites, 7,365 passed** |
| Q-5 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-6 | `npm run lint:hooks` | exit 0 |
| Q-7 | **Jest "A worker process has failed to exit gracefully" warning** | **Reproduced, but not on a 4a suite.** It printed (with exit 0, all passing) on the Businesses-list run (Q-2), on `test:bos-entitlements` and on `test:authz-guard`; the last two contain no 4a file and none of their files is in the diff. It did **not** print on Q-1, nor on `npx jest app/admin/finance --ci` run twice (110 / 110 each). Re-runs with `--detectOpenHandles` (which runs in band): the Businesses-list set (28 suites, 646 passed), `app/admin/finance` (110 passed) and the two authz guards (203 passed) report **no open handle** and no warning. Conclusion: an intermittent multi-worker teardown warning in this environment, pre-existing and not caused by 4a |
| Q-8 | Scoped `tsc`. Config: `tsconfig.qa-4a.json` in the session scratchpad (**outside the worktree**), with an absolute `extends`, `noEmit`, `incremental: false`, and `include` = `types/**/*.d.ts` + the 17 changed and new `.ts` / `.tsx` files | **Canary** (`const __qaCanary: number = "qa-canary";` appended to `boostRevenue.ts`): exit 2, `lib/business-os/finance/boostRevenue.ts(360,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Restored** from a byte copy (`cmp` identical, `grep -c qaCanary` = 0). Re-run: exit 2 with **0 diagnostics in changed or new files**. The 3 that remain are pre-existing and outside the diff (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts` ×1) |
| Q-9 | `git diff --stat`; constant grep | 16 tracked files (+1,951 / −140), 3 new; no deletion-only file; no migration path. `K5_NONE_YET`, `K5_RECORDED`, `REVENUE_RECORDED`, `REVENUE_NONE_YET`: no product hit (only the 1c guard's planted-control string) |

### Test Coverage (AC-87 to AC-101)

| AC | Result | Evidence |
|---|---|---|
| AC-87 | ✅ Pass (Jest), live part manual | T2 "the currency line equals the ALL row; net = gross - refunded - held - lost"; "each by-package row equals its check 14 row" (independent `checkFourteen`). Check 14: L-50 |
| AC-88 | ✅ Pass | T1 "one page: … paid_at in the range as ISO strings (AC-88)" and "AC-88 / S4-F2: a month-boundary window carries exactly its half-open ISO bounds", both for R-k and R-k′; T2 "n rows → n purchases", "a row with no date at all still counts: the read decided the window"; T4 the builder reads no `paid_at` / `created_at` |
| AC-89 | ✅ Pass | T2 `it.each(BOOST_PAID_FAMILY)` counts; planted `pending`, `flagged_mismatch`, NULL, differently cased → left out, counted, partial; migration-literal test with planted control; T6 "AC-89: other-status purchases are counted in words" |
| AC-90 | ✅ Pass | T2 "1000 → 10.00 and 1999 → 19.99 on the wire, never × 100"; `it.each(UNREADABLE)`; "a currency with other than two decimals (mocked) is unreadable"; "asks minorUnitsPerMajor with the normalised code"; T4 `toUnits` / `toHundredths` / × 100 rule; T6 "USD 10.00", "USD 19.99" |
| AC-91 | ✅ Pass | T2 `it.each` (partial refund, full refund, disputed after a partial refund, dispute_lost); "a won dispute is back in paid … no note"; T4 DF-5 pin; T6 "AC-91: the refund-timing note shows … and only then" |
| AC-92 | ✅ Pass | T2 "USD and a planted EUR → two lines, sorted, K-5 'several', no total anywhere"; T3 "AC-92: two currencies → K-5 several"; T5 payload walker; T6 "AC-92: … K-5 '2 currencies, see Our revenue'" |
| AC-93 | ✅ Pass | T1 ceiling → `reachedCeiling` (no error); T2 "counts and amounts stay (shown as 'At least'); held, lost and net are null"; T3 "AC-93"; T6 "AC-93 … K-5 'Unknown'" |
| AC-94 | ✅ Pass | T2 "no counted purchase → … ok; K-5 none"; T6 "nothing paid → 'No credit boosts paid in this window', no currency line, no 0.00; K-5 'No data yet'" |
| AC-95 | ✅ Pass (Jest), live part manual | T3 "AC-95: the owner purchase → USD 10.00 line, … K-5 grey with USD 10"; "R-k fails → K-5 unavailable 'Unknown' … every other section present"; T5 / T6 the same through the route and the page |
| AC-96 | ✅ Pass | T3 "exactly the id and the window range; deletedAccounts null; K-5 is that business's net; plans stay platform-wide"; T5 "AC-96 through the route" |
| AC-97 | ✅ Pass (Jest), live part manual | T2 "AC-97: the deleted-accounts line equals deleted_account_purchases and deleted_account_net_minor; never a name"; T3; T6 |
| AC-98 | ✅ Pass | T1 column allow-list (no Stripe id, receipt, flag reason, lot, `livemode`, `created_at`); T5 payload has no Stripe / lot field; T5 "AC-98: the info line carries sections.revenueBoosts and counts.boosts …; no boost amount, package or currency in any log call"; T1 repository log lines counts only |
| AC-99 | ✅ Pass | T5 "AC-99: R-k and R-k′ are in allReads(); signed out, a non-admin and an invalid query each make zero boost reads" |
| AC-100 | ✅ Pass | T4 write-verb pins and the repository-wide `livemode` rule; T1 no-write pin unedited; Q-3 webhook guards unchanged; Q-8; Q-9 no migration |
| AC-101 | ⬜ NOT-TESTED | Manual L-49 to L-58 below |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Integer cents never multiplied by 100 | Confirmed | `boostRevenue.ts`: `minorOf` takes the integer as it is; the only `toUnits` is on `credits_total`; one `/ CURRENCY_SCALE` at the edge (`toMoney`); readable only when `minorUnitsPerMajor(code) === 100` (`readMoney`). T4 pins it |
| Numeric string amount → unreadable, whole purchase excluded | Confirmed | `minorOf` requires `typeof === 'number'`; `readMoney` returns null, so the purchase adds no money anywhere, is counted, and its line's net is Unknown (T2 `UNREADABLE` cases for total, tax, refunded) |
| Refund greater than the total | Confirmed | `refundsAndDisputesOf` returns null when `refunded > total` → unreadable, never a negative net (T2) |
| Partial and full refund | Confirmed | Net = total − refunded; a full refund nets to a real 0 (T2 "a full refund nets to 0: one, USD, 0") |
| Open vs lost dispute | Confirmed | `disputed` → held = total − refunded; `dispute_lost` → lost = the same; both out of net. A won dispute (back to `paid`) counts in full (T2) |
| Mismatch row with no `paid_at` | Confirmed | Never read: R-k / R-k′ filter `paid_at` in `[start, end)`, and NULL fails both bounds. A `flagged_mismatch` row that somehow had `paid_at` is "another status", counted, never in revenue (T2) |
| Deleted account (`user_id` NULL) on its own line | Confirmed | `deleted = counted.filter(user_id === null)` → `deletedAccounts` per currency (all businesses only); also in the totals and package rows; never named (T2 / T3 / T6 AC-97) |
| Multi-currency; unknown currency's decimals | Confirmed, see note 2 | One line per normalised code, Unknown last; NULL code → unreadable without calling `minorUnitsPerMajor`; a zero- or three-decimal code → unreadable on its own line (T2) |
| Month boundary in UTC on `paid_at` | Confirmed | The query carries the window's half-open ISO bounds (T1 month-boundary case); the builder never reads a date (T4); the database applies the microsecond rule |
| 5,000 ceiling: "at least", net Unknown | Confirmed | `pageClientRows` `>=` returns rows with `reachedCeiling`; `netOf` returns null when not exact; held / lost null; K-5 `unknown` / `cut_off` |
| Picked business | Confirmed | R-k′ with exactly the id (UUID refused first, `.eq('user_id')` every page); R-k zero calls; deleted line null; the plans line reads "Plan payments, all businesses: …" (SA-WR-33, T6) |
| K-5 shows a currency and follows the window | Confirmed | K-5 money from the builder's `k5` summary over the same window read (`windowRange`); `formatMoney(net, currency)` prints the code; caption with the window label |
| Test-mode plan invoice still marks plans "recorded" | Confirmed | T3 "SA-WR-32: a test-mode plan invoice alone (R-d counts it) → plans recorded and state recorded"; R-d repository describe unedited |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. One more concurrent read on a one-row table; `durationMs` owed from L-58.

#### Edge Cases / notes (Low)
1. **The Jest worker-exit warning (Q-7) is intermittent and pre-existing.** It appeared on suite sets that 4a does not touch and never with `--detectOpenHandles`. Not a 4a defect; worth a separate look if it starts to fail CI.
2. **Any three-letter code not on `refundMath`'s zero- or three-decimal lists is treated as two-decimal** (`lib/payments/refundMath.ts:44-49`, used by `boostRevenue.ts` `readMoney`). This is the shared single definition SA-Q26 chose, and boosts are USD only today. A future currency with other decimals would need adding to those lists. Low.

### Manual live steps (continuing from 1c's L-48): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for §13 checks 14 to 16 (read-only; QA did not run them). Boost amounts in check 14 are in minor units: divide by 100 to compare. Page on **This month**, **All businesses** unless a step says otherwise.

| # | Step | Expected |
|---|---|---|
| L-49 | Open `/admin/finance` | "Our revenue" is a section with a status chip, the subtitle "Credit boosts paid, all businesses · <window> UTC", above "Takings through the platform" |
| L-50 | Read the boost line; run **check 14** | USD line: Purchases 1 (`purchases`), Gross charged USD 10.00 (`gross_minor` 1000), Of which tax USD 0.00 (`tax_minor`), Refunded USD 0.00, Held and Lost USD 0.00, **Net USD 10.00** (`net_minor` 1000), Credits sold 5,000 (`credits_sold`). By package: one row **"starter v1"** equal to its check 14 row. Deleted accounts: "No purchases from deleted accounts" (`deleted_account_purchases` 0, `deleted_account_net_minor` 0). No refund-timing note. No test-mode wording |
| L-51 | Read K-5 | **"USD 10.00"**, headline "Net of refunds and disputes", caption "Credit boosts; plans in a later update · <window> UTC", grey ("For information"), not green |
| L-52 | Read the plans line | "Plan payments: amounts are shown in a later update" (your test Basic invoice is recorded) |
| L-53 | **Check 15** (for information; it backs 4b) | One `paid` USD row with `recorded_total_minor` 1000; no `disputed` and no `flagged_mismatch` row. Nothing on the page depends on it in 4a |
| L-54 | **Check 16** (for information; it backs 4b) | One boost lot with 5,000 credits. Confirm the Credits section's gifted outstanding / K-4 do **not** include these 5,000 (gifted is admin grants only) |
| L-55 | Switch to 30d, then a custom range ending before 2026-10-12 | 30d still shows the purchase and USD 10.00 on K-5. The earlier range shows "No credit boosts paid in this window", no `0.00`, and K-5 "No data yet". The URL changes in place |
| L-56 | Pick your own business, reload the URL, then pick a business with no boost | Yours: the same USD 10.00 line, no Deleted accounts line, the plans line reading "Plan payments, all businesses: …", K-5 "USD 10.00"; the reload reproduces it. The other business: the empty sentence and K-5 "No data yet" |
| L-57 | Signed out, then as a non-admin, call `/api/admin/business-os/finance` | 401 / 403 with `Cache-Control: no-store`, no figures |
| L-58 | Dev-server log | One "Admin read the Business OS finance page" line per load with `sections.revenueBoosts` and `counts.boosts` (counts and booleans only), plus "Boost purchase rows …" with counts. No amount, currency, package id or name. **Record `durationMs`** for All businesses and for your business (target p95 under 2 s) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every 4a AC that Jest can test passes, and no bug is open.** AC-101 and the check 14 halves of AC-87 / AC-97 need the user's manual run (L-49 to L-58) before commit. The two Low notes do not block.

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Workplan written (Dev) | Slice 4a, boost revenue: R-k / R-k′, `boostRevenue.ts`, "Our revenue" as a section, K-5 value. SA-W47 to SA-W54 raised. No code changed |
| 2026-10-13 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W47 to SA-W54 approved. W50 is allowed to rewrite 1c's K-5 wording tests provided the R-d behaviour stays pinned (SA-WR-32). Required changes SA-WR-32 to SA-WR-35. Requirement edits E-30 (check 14 `deleted_account_net_minor`, AC-97), E-31 (1c AC-75 to AC-77 superseded note) and E-32 (plans line platform-wide in the picked view) are for BA. Guards verified not tripped; estimate 2.5 days accepted. |
| 2026-10-14 | SA code review: **APPROVED** | All changed and new files read. SA-WR-32 to SA-WR-35, SA-W48 and SA-W54 verified; deviations approved. SA re-ran 21 suites / 1,576 tests (including the boost repository and the three webhook guards), `test:bos-entitlements` (7,365) and `test:authz-guard` (203), all green. The Jest worker-exit warning predates 4a (4a adds no timer or effect). Code approved for QA. |
