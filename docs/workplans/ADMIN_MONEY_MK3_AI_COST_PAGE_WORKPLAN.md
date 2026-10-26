# Workplan: Money MK-3, the AI cost page

> **Last Updated**: 2026-10-26

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §4 (Page 2), §5 (A-K1 to A-K5, the Leak check block KPI), §3.3 (LL-1 to LL-5), §3.4 (USD-1 to USD-6), §6 items 11 and 23 to 29, §7 C-2, C-3, C-6, C-7, §13 FC-1 / FC-4 / FC-5 / FC-6 / FC-9, §14 point 5, §12 MK-3 row; SA-RR-MK (SA-3, SA-6, SA-9, SA-11, guards, pins table row MK-3); SA-CR-MK2 Q-R1
**Branch:** `feature/admin-money-mk3-ai-cost-page` (from `origin/main` `6e19cbe4`; worktree `neuronforge-finance-mk3`). **MK-2 must merge first; origin/main is merged into this branch before any code is written (§12 Step 0).**
**Date:** 2026-10-26
**Status:** SA Approved with conditions (SA-WP-MK3, 2026-10-26; conditions 1 to 7 folded in below). Build **MK-3a only**, after MK-2 merges and this branch is fast-forwarded to origin/main. **MK-3a Code Approved (SA-CR-MK3A), QA passed (B-1, B-2, L-1 fixed), TL approved; committed `9868bbf6`, PR [#517](https://github.com/AgentsPilot/neuronforge/pull/517) opened 2026-10-26, auto-merge on**; MK-3b not started
**Path:** full cycle (sidebar, redirects, guard pins, a new shared export)

## Overview

Today the Money area shows AI cost on two pages: **Charge checks** (`/admin/finance/charges`, the charged figure, the period check, the fallback list and the Leak check) and **AI calls & usage (detail)** (`/admin/analytics`, every recorded call). MK-3 merges them into one page, **AI cost** at `/admin/ai-cost`, with two tabs, **Summary & checks** (`tab=checks`) and **Calls** (`tab=calls`). One window (This month by default) and one business picker serve both tabs. Under the header sit a fixed two-line **Charged vs Recorded legend** and one **KPI strip of five tiles, A-K1 to A-K5**, each with its leading or lagging pill. The Leak check gets its block KPI, **Businesses with uncharged calls**. Every amount shows as `$`. The old addresses redirect, keeping their query. The Health tile, every Finance link and every other in-app link point at the new page. The sidebar's Money section drops from three entries to two.

MK-3 also carries **C-7**, deferred from MK-7: the recorded AI cost block (the recorded figure, its notes and "Recorded above charged") moves from Finance to the AI cost page, and Finance keeps one line, "Recorded above charged", that links there.

The plan assumes **MK-2 has merged**. MK-2 gives the credit report route `chargedInWindow` (Finance's own computation, equal to F-K3 for the same window), sets the default window to This month, and labels the period table "Whole billing periods". MK-3 builds the page on that.

---

## Table of Contents

1. [Step 0 code facts](#1-step-0-code-facts)
2. [Design](#2-design)
3. [Files to create, change and delete](#3-files-to-create-change-and-delete)
4. [Files shared with MK-2](#4-files-shared-with-mk-2)
5. [Reads](#5-reads)
6. [Payload changes](#6-payload-changes)
7. [Pins and baselines that move](#7-pins-and-baselines-that-move)
8. [Guards](#8-guards)
9. [Tests](#9-tests)
10. [Acceptance criteria](#10-acceptance-criteria)
11. [Slice split](#11-slice-split)
12. [Task list](#12-task-list)
13. [Risks](#13-risks)
14. [Out of scope](#14-out-of-scope)
15. [Open questions for SA](#15-open-questions-for-sa)
16. [Business questions](#16-business-questions)

---

## 1. Step 0 code facts

Checked on `origin/main` `6e19cbe4`, and on the MK-2 worktree (`neuronforge-finance-health`, uncommitted) where marked **[MK-2]**.

### 1.1 Charge checks (`/admin/finance/charges`)

| # | Fact | Where |
|---|---|---|
| CF-1 | A client page with no data of its own: `AdminPageHeader` ("Charge checks", `COSTS_INTRO`, Read-only badge) plus `CostsTab` in a `Suspense`. No guard of its own (`app/admin/layout.tsx` runs `requireAdminPage`) | `app/admin/finance/charges/page.tsx` |
| CF-2 | `CostsTab` owns its URL hook (`useAdminFilters(COSTS_FILTER_SPEC, { active })`), the report read (sequence number, abort, newest wins), the 409 platform-account notice, the strip, the bar, the sections and the Leak check panel at the bottom | `app/admin/business-os-llm/components/costs/CostsTab.tsx` |
| CF-3 | The spec: `window` (whole dates, `wholeDateWindowFilter`, extra `90d`) and `account` (UUID only). **[MK-2]** default This month | `app/admin/business-os-llm/costsFilters.ts` |
| CF-4 | The strip, five tiles: Credits charged (whole periods), Charged AI cost (**[MK-2]** `chargedInWindow`), Charges (whole periods), Fallback-priced, Periods not matching (red above 0). No `indicator` | `app/admin/business-os-llm/components/costs/CostsKpis.tsx` |
| CF-5 | Sections: **[MK-2]** `ChargedInWindowSection` (`#costs-charged`, deleted accounts line), `PeriodsSection` (whole-periods label), `BreakdownsSection`, `FallbackSection`, `SpreadSection` | `CostsSections.tsx` |
| CF-6 | The Leak check: its own window (yesterday, at most 7 days), its own button and `GET /api/admin/business-os/credits/leak-check`; per-account findings with `status` (`clean`, `leak`, `incomplete`, `could_not_check`) and `counts.uncharged`; platform accounts reported apart (`result.platform`), never as a business | `LeakCheckPanel.tsx`, `leakTypes.ts` |
| CF-7 | Money is already printed with `$` by `costFormat.formatUsd` (adaptive decimals, sub-cent values kept). Labels still name the code: "Charged AI cost (USD)", "Not charged (USD)" | `costFormat.ts:39`, `costCopy.ts:104`, `leakCopy.ts:81` |
| CF-8 | The report route: `requireAdmin` first, strict Zod, 409 for a platform account, then **[MK-2]** `buildCreditReport` and `buildChargedAiCostInWindow` in parallel; returns `{ ...report, chargedInWindow }` | `app/api/admin/business-os/credits/report/route.ts` |
| CF-9 | **[MK-2]** `buildChargedAiCostInWindow` reads R-a / R-a′ through Finance's wiring and runs Finance's builder `summariseAiCost`; it keeps `figures` and drops `units` | `lib/business-os/finance/chargedAiCost.ts` |
| CF-10 | The page is in the C-14 registry (entry `/admin/finance/charges`), the contrast guard (`'Charge checks'`: the costs folder walk), the vocabulary guard (`app/admin/finance/charges/page.tsx`), and the business-os-llm source guard G-5 (`fetch(` only in `CostsTab` and `LeakCheckPanel`) | `layoutFolder.guard.test.ts:725-738`, `contrast.lf1.source.guard.test.ts:63`, `aiCostVocabulary.source.guard.test.ts:56`, `business-os-llm/__tests__/source.guard.test.ts:635-675` |
| CF-11 | Pin C mounts this page when its file exists, otherwise `business-os-llm?tab=costs`; its table pins the report and Leak check request literals | `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx:34-42`, `chargeChecksRequestPins.ts` |
| CF-12 | The redirect `/admin/business-os-llm?tab=costs` → `/admin/finance/charges` | `next.config.js:79-88` |

### 1.2 AI calls & usage (`/admin/analytics`)

| # | Fact | Where |
|---|---|---|
| CA-1 | A 548-line client page: its own URL hook (`ANALYTICS_FILTER_SPEC`), one read `GET /api/admin/token-usage/drill-down`, the strip `AnalyticsKpis`, the bar `AnalyticsFilterBar` (window, business, scope switch, group by), breadcrumbs, the run card, the table, `AnalyticsSummaryCards` below it, and the call drawer | `app/admin/analytics/page.tsx` |
| CA-2 | Spec: `scope` (default `bos`), `window` (default **30 days**, extras `24h` and `90d`, aliases `dateFrom` / `dateTo`, linked instants allowed), `account` (alias `user`, UUID or `system`), `category`, `group_by`, eight drill keys, `agent`, `execution` | `app/admin/analytics/analyticsFilters.ts:35-164` |
| CA-3 | 24 h, 7 d, 30 d and 90 d are sent **rolling** (`period=N`); Today, This month and Custom as whole UTC days; a linked window verbatim | `analyticsFilters.ts:166-240` |
| CA-4 | The strip: Business OS scope shows Recorded AI cost, Calls, Tokens, Avg cost per call; All scope shows Recorded AI cost and four category filter tiles. Amber on the 1,000-call cap | `components/AnalyticsKpis.tsx` |
| CA-5 | `AnalyticsSummaryCards` already shows Calls, Avg cost per call, Avg tokens per call, Input and Output tokens | `components/AnalyticsSummaryCards.tsx:30-42` |
| CA-6 | Money via `formatCost` (`Intl`, `USD` → prints `$`) | `analyticsTypes.ts:156` |
| CA-7 | 10 decorative breadcrumb chevrons use `text-slate-500`. The page is **not** in the contrast guard today | `page.tsx:364-490` |
| CA-8 | In the C-14 registry (entry `/admin/analytics`), the vocabulary guard (`page.tsx`, `AnalyticsKpis.tsx`, `AnalyticsFilterBar.tsx`), the drill-down owner-text guard (`PAGE`, `PAGE_DIR`), and Pin A (four `A2 AnalyticsKpis` cases) | `layoutFolder.guard.test.ts:555-570`, `ownerText.guard.test.ts:24-93`, `KpiStrip.callers.pin.render.test.tsx:287-290` |

### 1.3 Around the two pages

| # | Fact | Where |
|---|---|---|
| CX-1 | Sidebar Money: Finance, Charge checks (`/admin/finance/charges`), AI calls & usage (detail) (`/admin/analytics`). The nav test pins those hrefs and `NESTED_LISTED = ['/admin/finance/charges']` | `app/admin/components/AdminSidebar.tsx:124-153`; `app/admin/components/__tests__/AdminSidebar.nav.test.ts:99`, `:124-129` |
| CX-2 | Every in-app link to the two old paths: Finance `costsHref`, `analyticsHref`, `section3AnalyticsHref`, `k1AnalyticsHref` (tests only), `leakCheckHref`; the Health spend tile `analyticsLink` (`scope=bos&dateFrom&dateTo`, ISO instants); the Businesses panel (`scope=bos&user=`); the Activity cut-over notice (`scope=bos[&user=]`); the redundant Platform dashboard (two hrefs) | `app/admin/finance/financeLinks.ts:94-164`; `lib/admin/health/evaluateHealth.ts:409-412`, `:661-662`; `app/admin/users/components/BusinessOsPanel.tsx:399`; `app/admin/business-os-llm/components/activity/CutoverNotice.tsx:22-30`; `app/admin/platform-dashboard/page.tsx:280`, `:537` |
| CX-3 | Finance's recorded block (C-7): `RecordedCostLines` renders the recorded figure, its source, "Recorded above charged", the Leak check link, the Unknown notice, the deleted-accounts note and five distortion sentences. `RecordedAboveValue` is also used by `AccountSummary` | `app/admin/finance/components/RecordedCostLines.tsx`, `AiCostSection.tsx:100-123`, `financeCopy.ts:359-388` |
| CX-4 | The recorded read: the finance route binds two usage-log reads (all accounts: `adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow`, page 1,000, ceiling 10,000; one account: `tokenUsageRepository.listCallsInWindow`, page 1,000, ceiling 5,000), Business OS rows only, `end − 1 ms`, under `RECORDED_DEADLINE_MS` (2 s). `buildRecordedAiCost` turns the rows and Section 3's charged **units** into the payload | `app/api/admin/business-os/finance/route.ts:280-301`; `lib/business-os/finance/recordedCost.ts`; `financeHealth.ts:683-706`, `:1021-1046` |
| CX-5 | Only `app/api/admin/**` may import the admin analytics repository; inside the finance folder only the finance route may name a usage-log reader, and it calls exactly two methods | `AdminTokenUsageAnalyticsRepository.test.ts:327-337`; `finance.source.guard.test.ts:155-178`, `:1368-1422` |
| CX-6 | `BlockKpi` is Finance-local (used by `CreditsSection` and `TakingsSection`), a `div role="group"` with MK-0's `KpiIndicator` | `app/admin/finance/components/BlockKpi.tsx` |
| CX-7 | `formatUsdSign({ currency, amount }, { maxDecimals })` lives in Finance's format module and returns null for any code but USD. F-K3 prints with `{ maxDecimals: 4 }` | `app/admin/finance/financeFormat.ts:51`; `FinanceKpiStrip.tsx:196` |
| CX-8 | The shared folder guard's `EXPECTED_SOURCES` list | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts:131-152` |
| CX-9 | Pin D hashes the Health rules, metric labels, tile vocabulary and the leak cron entry. **No href is in its shape**: the spend tile's href is built in `evaluateHealth.ts` | `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts`; `lib/admin/health/rules.ts` |
| CX-10 | Pin hashes on `6e19cbe4` (LF-normalised SHA-256 of each file): Pin A `3fa2360a` (**[MK-2]** `5f537869`), Pin B `a1b3db0c`, Pin C test `98ea0507`, Pin C table `02813360` (**[MK-2]** `64a565e9`), Pin D `1f7cf07a`, AC-173 `3a1a2dd4` + helper `b84e0c96`, AC-145 `33340751…2215` | computed 2026-10-26 |
| CX-11 | `console.*` in the files MK-3 touches: **none in code**. The Platform dashboard's one mention is in a comment (already converted) | grep |
| CX-12 | Entitlements: no file MK-3 touches imports `lib/business-os/entitlements/` (the Businesses panel only names an `/api/.../entitlements/...` URL), so the `business-os-entitlements` skill's registration does not apply. `npm run test:bos-entitlements` still runs at handover | grep |

"The KpiStrip callers pin" in the brief is **Pin A** (`KpiStrip.callers.pin.render.test.tsx`), not a separate file.

---

## 2. Design

### 2.1 Route and tabs

| Item | Plan |
|---|---|
| Path | `/admin/ai-cost` (SA-6). A client page under `app/admin/layout.tsx`, which runs `requireAdminPage`; no guard of its own (the Charge checks precedent) |
| Header | `AdminPageHeader`: title **"AI cost"**, purpose **"What AI usage costs us, did we charge for it, and is the charging correct?"** (§14 point 5), Read-only badge |
| Legend | Fixed, two lines, under the header, on both tabs (§4): **Charged AI cost:** what Business OS AI actions cost us that we billed to a customer in credits (the credit ledger, from 29 Sep 2026). This is the business figure. **Recorded AI cost:** every AI call the system logged, charged or not, both products (the usage log). This is the operations figure. The two are never added |
| Tabs | APG tablist, manual activation (the Finance and Business OS AI pattern). **Summary & checks** (`tab=checks`, the default: no `tab` means checks) and **Calls** (`tab=calls`). The Calls panel mounts on first choice and stays mounted, hidden |
| Order | Header, legend, tabs, strip (the same on both tabs, BD-29), the tab's bar, the tab's content |
| URL state | **One spec** owned by the page (Finance's one-spec-with-`tab` pattern, `financeFilters.ts`, SA-W2): `tab`, `window`, `account`, then the Calls keys (`scope`, `category`, `group_by`, the drill keys, `agent`, `execution`). Each tab's bar writes the same `window` and `account`, so the window and the business are one value on both tabs. See SA-Q-MK3-2 |

### 2.2 The window

- Default **This month** on both tabs (C-6, Q-5). Choices: Today, 7 days, 30 days, This month, Custom, plus 90 days (Charge checks offered it).
- **7 days and 30 days are whole UTC days on both tabs**, as on Finance and Charge checks. The Calls request for them changes from rolling `period=N` to `dateFrom` / `dateTo` whole days, so the strip's recorded figure and the Calls total cover the same span (SA-Q-MK3-3).
- **24 hours is dropped** as a choice. A `range=24h` link is read and falls back to the default (U-4).
- **A linked window** (ISO instants, `dateFrom` / `dateTo`, from the Health tile) is kept on the Calls tab exactly, as today. The strip and Summary & checks use the whole UTC days that cover it, and the strip's window line says so: "Strip: 25 Oct 2026 to 26 Oct 2026, whole UTC days" (SA-Q-MK3-3).

### 2.3 The business

One picker. `account` takes a UUID, or `system` on the Calls tab (its existing drill value). The report and the strip take a UUID only. With `system`, the strip reads all businesses and says "All businesses: system calls belong to no business" (SA-Q-MK3-4). A platform account (409 from the report) shows the existing platform notice in place of the strip; the Calls content is unaffected.

### 2.4 The strip, A-K1 to A-K5

Built with the shared `KpiStrip` / `KpiTile` and MK-0's `indicator` (the word pill, the tooltip below the tile, equal-height tiles). Five tiles, no more. Every definition is one copy constant in `aiCostCopy.ts` (LL-4).

| # | Label | Value | Pill | Definition (tooltip line 1) | Opens | Colour |
|---|---|---|---|---|---|---|
| A-K1 | Charged AI cost | `chargedInWindow.costUsd` via `formatUsdSign(…, { maxDecimals: 4 })`, exactly as F-K3 prints. `partial` → "At least $x"; `unknown` → "Unknown" | Lagging | "What Business OS AI actions cost us that we charged credits for, in this window. Equal to Finance's Charged AI cost for the same window. If an amount cannot be read, this shows 'at least'; Finance's tile shows Unknown, because it compares months." (Q-R1) | Summary & checks → `#costs-charged` | Neutral |
| A-K2 | Recorded AI cost | `recorded.recordedUsd` (the usage log, Business OS scope, this window); "At least" when not exact; "Unknown" on a failed or late read. Sub-line "Business OS calls" | Lagging | "Every Business OS AI call the usage log recorded in this window, charged or not, priced from the model price table." | Calls tab, same window and business | Neutral |
| A-K3 | Recorded above charged | `recorded.aboveCharged`: the figure, "None" (with the charged-above line), "Not available" before 29 Sep 2026, "Unknown" | Leading | "Recorded AI cost minus Charged AI cost for the same window. Uncharged spend is a leak before it is a loss." | Summary & checks → `#costs-leak` | Neutral |
| A-K4 | Billing periods not matching | Today's rule (count, "of n checked", "Not checked", "Unknown") | Leading | "Billing periods whose stored total disagrees with the sum of their rows. A ledger error shows here before a customer sees a wrong balance." | Summary & checks → `#costs-periods` | Red above 0 (unchanged) |
| A-K5 | Fallback-priced charges | Today's count, sub-line "n reconciled" | Leading | "Charges priced from a fallback because the model had no price in the price table." | Summary & checks → `#costs-fallback` (the list links to Model pricing) | Neutral |

- On Summary & checks the four anchor tiles are anchors (today's K-6 rule: a link only while the section is drawn). On Calls they are same-page tab switches (`filter` with the real `?tab=checks…#anchor` href and an `apply` that switches tab). A-K2 is the reverse.
- "Credits charged" and "Charges" leave the strip (§6 item 23). They become figures in the Charged breakdown, **for the window** (`chargedInWindow.credits`, `.charges`), beside the total.
- A tile never shows another currency (USD-5). AI cost is USD by definition (CUR-5), so `formatUsdSign` cannot refuse here; if it ever returned null the tile shows "Unknown".

### 2.5 Summary & checks (`tab=checks`)

Blocks in the order of the strip (§4.2):

1. **Charged breakdown** (`#costs-charged`): today's `ChargedInWindowSection` (total, credits, charges, the deleted-accounts line), then `BreakdownsSection` and `SpreadSection` (unchanged; they stay whole-period figures, as MK-2 left them, and say so).
2. **Recorded vs charged and the Leak check** (`#costs-leak`): the **recorded block moved from Finance (C-7)**: the recorded figure, "Recorded above charged", the Unknown notice, the deleted-accounts note and the five distortion sentences, same words. Then the Leak check, now with its **block KPI**.
3. **Period check** (`#costs-periods`): today's table with MK-2's "Whole billing periods" label.
4. **Fallback list** (`#costs-fallback`): unchanged.

**The Leak check block KPI.** The shared `BlockKpi` (promoted, §2.9), label **"Businesses with uncharged calls"**, leading pill, definition "Businesses with at least one AI call recorded but not charged in the days the Leak check covered. Platform accounts are listed apart, never counted." Value: the count of findings with `counts.uncharged > 0` (SA-Q-MK3-5). "At least n" when any finding is `incomplete` or `could_not_check`. Before a check has run, the box shows "Not run yet" (§5: "shown only after a check has run"; SA-Q-MK3-5). It is counted from the Leak check's own result, so no read is added.

### 2.6 Calls (`tab=calls`)

Today's AI calls & usage content, moved into a tab component: the bar (window, business, scope switch, group by), breadcrumbs, run card, the "may be incomplete" notice, the scope notes, the table, the call drawer. Changes:

- `AnalyticsKpis` is removed. Its recorded cost becomes A-K2. Calls, tokens and average cost per call go into the tab's **summary cards** (§4.2), moved above the table, with a first card "Recorded AI cost, this view" (the drill-down total of the filtered view, so it is never mistaken for A-K2). The "vs previous period" line moves into that card. In All scope, the four category filters become a row of filter links in the cards (same href and apply, `aria-current` on the chosen one) (SA-Q-MK3-6).
- The scope notes say "The charged cost is on the Summary & checks tab" instead of "on Finance".
- 10 decorative chevrons go from `text-slate-500` to `text-slate-400` (the contrast guard joins the tab).

### 2.7 `$` display

- Strip tiles and the block KPI: `formatUsdSign` (reused, USD only) with `maxDecimals: 4`, the F-K3 call, so A-K1 and F-K3 print the same text for the same value.
- Tables and breakdown lines keep `costFormat.formatUsd`, which already prints `$` and keeps sub-cent precision a per-action cost needs (SA-Q-MK3-7).
- Tile and header labels drop "(USD)" (USD-1); the copy guard (USD-6) is extended to the AI cost files.
- No other currency can arise on this page, so the "plus n, not converted" note has no path here. Nothing is summed across currencies.

`formatUsdSign` stays in `app/admin/finance/financeFormat.ts` and is imported from there (SA-Q-MK3-8).

### 2.8 Redirects (`next.config.js`, temporary 307, the M-5 pattern)

| From | To | Kept |
|---|---|---|
| `/admin/finance/charges` | `/admin/ai-cost?tab=checks` | `range`, `from`, `to`, `account` |
| `/admin/analytics` | `/admin/ai-cost?tab=calls` | `scope`, `range`, `from`, `to`, `dateFrom`, `dateTo`, `user`, `account`, `category`, `group_by`, the drill keys, `agent`, `execution` |
| `/admin/business-os-llm` with `tab=costs` (existing) | **retargeted** to `/admin/ai-cost?tab=checks` (no chain of two redirects) | as today |

Next merges the incoming query with the destination's, and the destination's `tab` wins over an incoming one (the exchange-rates precedent). The old page files are deleted (the MK-4 Subscriptions precedent). The old API routes are unchanged.

### 2.9 Links, Health tile, sidebar, shared `BlockKpi`

| Place | Change |
|---|---|
| Health spend tile | `/admin/ai-cost?tab=calls&scope=bos&dateFrom=…&dateTo=…` (same instants); link label "open in AI cost, Calls". Pin D unchanged (CX-9) |
| Finance `financeLinks.ts` | `costsHref` and `leakCheckHref` → `/admin/ai-cost?tab=checks…`; `analyticsHref`, `section3AnalyticsHref`, `k1AnalyticsHref` → `/admin/ai-cost?tab=calls…`. With one window, every helper uses `wholeDayWindow` (the 7d / 30d custom-date workaround for the Calls page goes). Typed `AiCostHref` replaces `AnalyticsHref` |
| Finance account summary | Link labels "Charge checks" → "AI cost: Summary & checks"; "AI calls & usage" → "AI cost: Calls" |
| Finance Section 3 (C-7) | The recorded block becomes one line, "Recorded above charged: $x", with the link "Recorded AI cost and the Leak check, on AI cost" → `?tab=checks…#costs-leak` |
| Businesses panel, Activity cut-over notice | path `/admin/ai-cost?tab=calls`, keys as today (`scope`, `user`; aliases are read forever, U-9) |
| Platform dashboard (redundant) | its two hrefs → `/admin/ai-cost?tab=calls`; nothing else (SA-Q-MK3-9) |
| Sidebar Money | **Finance**, **AI cost** (`/admin/ai-cost`, icon `TrendingUp`, description "Charged and recorded AI cost, and the charge checks, Business OS"). Charge checks and AI calls & usage leave (C-3, sign-off by Q-1) |
| `BlockKpi` | **Moved** to `app/admin/components/layout/BlockKpi.tsx`, byte-identical markup; Finance's two callers import it from there; `EXPECTED_SOURCES` lists it. A new shared export: full cycle, SA review (CLAUDE.md rule 7) |

---

## 3. Files to create, change and delete

### 3.1 Create

| File | Why |
|---|---|
| `app/admin/ai-cost/page.tsx` | The page: `Suspense` around `AiCostView` |
| `app/admin/ai-cost/components/AiCostView.tsx` | Header, legend, tabs, strip, the two panels; owns the one URL hook |
| `app/admin/ai-cost/components/AiCostKpis.tsx` | A-K1 to A-K5 |
| `app/admin/ai-cost/aiCostFilters.ts` | One spec (tab, window, account, Calls keys); `reportSearch(filters, now)` (whole dates; linked → covering days) and the Calls request through `analyticsRequestParams`. Pure |
| `app/admin/ai-cost/aiCostCopy.ts` | Title, purpose, legend, tab labels, tile labels and the five definitions, window line, link labels |
| `app/admin/ai-cost/useCostReport.ts` | The report read lifted out of `CostsTab` unchanged (sequence, abort, newest wins, 409), so the strip has it on both tabs |
| `app/admin/business-os-llm/components/costs/RecordedSection.tsx` | The C-7 block on Summary & checks (from `RecordedCostLines`, same words) |
| `app/admin/analytics/components/CallsTab.tsx` | The old page body, controlled by the page's filters |
| `app/admin/components/layout/BlockKpi.tsx` | Moved from Finance |
| `app/api/admin/business-os/finance/recordedReads.ts` | The two usage-log reads bound once, used by the finance route and the report route (SA-Q-MK3-1) |
| Tests | §9 |

### 3.2 Change

| File | Why |
|---|---|
| `next.config.js` | Two redirects; the `tab=costs` one retargeted |
| `app/admin/components/AdminSidebar.tsx` | Money: Finance, AI cost |
| `app/api/admin/business-os/credits/report/route.ts` | The recorded read (bound, under the 2 s deadline), `recorded` in the payload, its counts on the info line |
| `app/api/admin/business-os/finance/route.ts` | Uses `recordedReads.ts`; same calls, same arguments |
| `lib/business-os/finance/chargedAiCost.ts` | Returns the charged **units** beside the figures (non-wire), and composes `buildRecordedAiCost` for the report route, so A-K3 is Finance's computation |
| `lib/business-os/credits/creditReportTypes.ts` | `CreditReportResponse` gains `recorded` |
| `app/admin/business-os-llm/costTypes.ts` | Client mirror of `recorded` |
| `app/admin/business-os-llm/costCopy.ts` | Title and labels; the recorded copy moved in from `financeCopy.ts`; "(USD)" out of tile labels |
| `app/admin/business-os-llm/leakCopy.ts` | Block KPI label, definition, "Not run yet" |
| `app/admin/business-os-llm/costsFilters.ts` | Its window field and request builder are reused by the page spec; `COSTS_FILTER_SPEC` retired |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | Takes filters and the report from the page; block order of §2.5; no fetch of its own |
| `app/admin/business-os-llm/components/costs/CostsSections.tsx` | Window credits and charges in the charged block; anchor ids |
| `app/admin/business-os-llm/components/costs/CostsFilterBar.tsx` | Bound to the page spec |
| `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx` | The block KPI; anchor `#costs-leak` |
| `app/admin/analytics/analyticsFilters.ts` | Default This month; 7d / 30d whole days; `24h` dropped; `ANALYTICS_PATH` → `/admin/ai-cost`; fields reused by the page spec |
| `app/admin/analytics/components/AnalyticsSummaryCards.tsx` | Above the table; "Recorded AI cost, this view", tokens, the comparison, the category filters |
| `app/admin/analytics/components/AnalyticsFilterBar.tsx` | Window choices; bound to the page spec |
| `app/admin/finance/financeLinks.ts` | §2.9 |
| `app/admin/finance/financeCopy.ts` | Link labels; recorded constants out; the one-line copy |
| `app/admin/finance/components/AiCostSection.tsx` | One line plus the link (C-7) |
| `app/admin/finance/components/RecordedCostLines.tsx` | Keeps `RecordedAboveValue` (the account summary uses it) and the one line |
| `app/admin/finance/components/CreditsSection.tsx`, `TakingsSection.tsx` | `BlockKpi` import path |
| `lib/admin/health/evaluateHealth.ts` | Spend tile href and link label |
| `app/admin/users/components/BusinessOsPanel.tsx` | One href |
| `app/admin/business-os-llm/components/activity/CutoverNotice.tsx` | One href |
| `app/admin/platform-dashboard/page.tsx` | Two hrefs (SA-Q-MK3-9) |

### 3.3 Delete

`app/admin/finance/charges/page.tsx`, `app/admin/analytics/page.tsx`, `app/admin/finance/components/BlockKpi.tsx` (moved), `app/admin/business-os-llm/components/costs/CostsKpis.tsx`, `app/admin/analytics/components/AnalyticsKpis.tsx`, `app/admin/finance/__tests__/chargeChecks.page.render.test.tsx` (replaced by the AI cost page test).

The component folders stay where they are (`business-os-llm/components/costs/`, `analytics/components/`), as M-5 kept the costs components (SA-Q59): moving them would move every test with them and is not in scope.

---

## 4. Files shared with MK-2

MK-2 (branch `feature/admin-money-mk2-one-ai-cost`, SA-approved, in QA) changes 24 files. MK-3 touches these of them; each is re-read after origin/main is merged in, and none is edited before then.

| File | MK-2 change | MK-3 change |
|---|---|---|
| `app/admin/business-os-llm/components/costs/CostsKpis.tsx` | Cost tile reads `chargedInWindow` | **Deleted**, replaced by `AiCostKpis` |
| `app/admin/business-os-llm/components/costs/CostsSections.tsx` | `ChargedInWindowSection`, whole-periods label | Window credits and charges; anchors |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | Renders the new section | Controlled; no fetch; block order |
| `app/admin/business-os-llm/costCopy.ts` | Charged block and whole-periods copy | Title, labels, recorded copy |
| `app/admin/business-os-llm/costTypes.ts` | `chargedInWindow` | `recorded` |
| `app/admin/business-os-llm/costsFilters.ts` | Default This month | Reused by the page spec |
| `app/api/admin/business-os/credits/report/route.ts` | `chargedInWindow` | `recorded` |
| `lib/business-os/credits/creditReportTypes.ts` | `CreditReportResponse` | `recorded` |
| `lib/business-os/finance/chargedAiCost.ts` | New | Units and the recorded composition |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` (Pin A) | Two `A2 CostsKpis` entries re-frozen | The three `A2 CostsKpis` and four `A2 AnalyticsKpis` cases removed, `A2 AiCostKpis` cases appended (§7) |
| `app/admin/finance/__tests__/chargeChecks.page.render.test.tsx` | Fixture gains `chargedInWindow` | Deleted |
| `app/admin/finance/__tests__/chargeChecksRequestPins.ts` (Pin C table) | Rows 1, 7, 9, 10 re-frozen | **Unchanged** |
| `app/admin/business-os-llm/__tests__/costsFilters.test.ts`, `costsLayout.render.test.tsx`, `costsTab.render.test.tsx` | Default window, fixtures | Mount through the page spec; strip assertions move to the AI cost tests |
| `app/api/admin/business-os/credits/report/__tests__/route.test.ts` | `chargedInWindow` cases | `recorded` cases |
| `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts` | `CreditReportResponse` | Same pin, wider type |
| `docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md` | MK-2 pin row | §12 MK-3 row (RM, at commit) |

MK-2 files MK-3 does **not** change: `financeHealth.ts` and its test, `BusinessOsCreditLedgerReadRepository.test.ts` and `creditReport.ts`. `chargedAiCost.test.ts` is only appended to (T-11). Pin C's test file is not an MK-2 file; it moves in MK-3 for its own reason (§7).

---

## 5. Reads

| Read | On which load | New? | Justification |
|---|---|---|---|
| Credit report (`GET …/credits/report`): totals, rows, names, R-a / R-a′ (MK-2) | Both tabs (the strip needs it) | No | Unchanged request (Pin C) |
| **Recorded AI cost**: `listCostPointsAllAccountsInWindow` (no business) or `listCallsInWindow` (one business), in the report route | Both tabs, inside the same report request | **New caller, no new method** | SA-3 ruled: "Reuse M-4's injected usage reads through the AI cost route; no new repository method." The same two calls Finance makes, with the same paging (1,000 per page; ceilings 10,000 and 5,000), Business OS rows only, under the same 2 s deadline. It feeds A-K2 and A-K3, and the C-7 block |
| Drill-down (`GET /api/admin/token-usage/drill-down`) | Calls tab only, when opened | No | Unchanged route; the request changes only for 7d / 30d (whole days, SA-Q-MK3-3) |
| Leak check | On the button only | No | Unchanged |
| Business picker | On typing | No | Unchanged |

No new repository method, no new table, no migration. Every list read stays at ≤ 1,000 rows per page (FF-1d range-cap guard, its allow-list unchanged). On Summary & checks the page sends **one** request on load; on Calls, two (the report and the drill-down).

---

## 6. Payload changes

**Credit report response** (`CreditReportResponse`, admin only):

```typescript
// lib/business-os/credits/creditReportTypes.ts
export interface CreditReportResponse extends CreditReport {
  chargedInWindow: CreditReportChargedInWindow;   // MK-2
  recorded: CreditReportRecordedInWindow;         // MK-3
}

/** Structurally the same as Finance's `FinanceRecordedAiCost` (pinned equal both ways). */
export interface CreditReportRecordedInWindow {
  status: 'ok' | 'partial' | 'unknown';
  recordedUsd: number | null;
  recordedExact: boolean;
  aboveCharged: { state: 'figure' | 'none' | 'not_available' | 'unknown'; usd: number | null };
  chargedAboveUsd: number | null;
}
```

Declared in the credits types (not imported from Finance), so `lib/business-os/credits` still does not import `lib/business-os/finance`. A type-level test pins it equal to `FinanceRecordedAiCost` both ways. The client mirror in `costTypes.ts` is pinned by the existing wire-types test. No row, id, session id, feature value or name is in it (AC-164 holds). The route's info line gains `recorded: { read, outcome, rows, completed, reachedCeiling, unreadable, ms }`: counts and flags, never an amount.

**Finance payload: unchanged.** C-7 is display only: `aiCost.recorded` still travels, and Finance now shows only its `aboveCharged`. **AC-145 does not move.**

**Drill-down payload: unchanged.**

---

## 7. Pins and baselines that move

Each move is one ruled re-freeze, with the before and after hash recorded in the Implementation Notes. Values below are on `6e19cbe4`; they are re-recorded at Step 0 after MK-2 is merged in.

| Pin | Moves? | Ruled re-freeze | Removal proof |
|---|---|---|---|
| **Pin A** (`KpiStrip.callers.pin.render.test.tsx`; this is also "the KpiStrip callers pin") | **Yes** | Remove `A2 CostsKpis loading`, `A2 CostsKpis`, `A2 CostsKpis no sections` and the four `A2 AnalyticsKpis` cases, with their fixtures and imports; append `A2 AiCostKpis loading`, `… figures`, `… at least`, `… unknown and not checked`, `… on the Calls tab (cross-tab targets)`. Every other entry byte-identical (re-run the whole pin) | `CostsKpis.tsx` and `AnalyticsKpis.tsx` no longer exist, and a grep shows no file under `app/` imports either. That is why their cases go, not because they changed |
| **Pin B** (`financeTiles.pin.render.test.tsx`) | No | — | F-K3 keeps its `#ai-cost` anchor; the strip is untouched |
| **Pin C** test file (`chargeChecksRequest.pin.render.test.tsx`) | **Yes** | `target()` mounts the AI cost page at `/admin/ai-cost?tab=checks&<state>` when `app/admin/ai-cost/page.tsx` exists (third side; the two older sides stay as dead branches or are removed, SA's choice). Nothing else in the file changes | The charges page file is deleted, so the old branch can no longer be reached |
| **Pin C** table (`chargeChecksRequestPins.ts`) | **No** | — | The report and Leak check requests are byte-identical across the move: that is the proof the merge kept Charge checks' requests |
| **Pin D** (`m5WordingOnly.pin.test.ts`) | No | — | The Health href lives in `evaluateHealth.ts`, outside Pin D's shape (SA preferred that) |
| **AC-145** (finance route `EXPECTED_SHA256`) | No | — | Finance payload unchanged (§6) |
| **AC-173** (`financeRequest.pin.render.test.tsx` + `financeRequestPins.ts`) | No | — | Finance request unchanged |

### 7.1 Pin plan per sub-slice (SA-WP-MK3 conditions 1 to 3)

Each sub-slice re-freezes Pin A **once** in its own PR, with the before hash, the after hash and a removal proof. No other Pin A case changes.

| Sub-slice | Pin A | Pin C | AC-145, AC-173, Pin B, Pin D |
|---|---|---|---|
| **MK-3a** | Remove the 3 `A2 CostsKpis` cases (`loading`, figures, `no sections`) and their fixture and import; append the 5 `A2 AiCostKpis` cases of §7. Removal proof: `CostsKpis.tsx` is deleted and no file under `app/` imports it, so the cases cannot run | Test file: only the mount target changes, to `/admin/ai-cost?tab=checks&<state>`; the two dead sides (the charges page and `business-os-llm?tab=costs`) are removed. Table `chargeChecksRequestPins.ts` byte-identical to **`64a565e9`** (its post-MK-2 hash) | Unchanged; hashes recomputed and recorded in the Implementation Notes. **If the finance payload changes at all, stop and ask SA** |
| **MK-3b** | Remove the 4 `A2 AnalyticsKpis` cases and their fixtures and import. Removal proof: `AnalyticsKpis.tsx` is deleted and no file under `app/` imports it | Unchanged (table and test file as MK-3a left them) | Unchanged; hashes recomputed |

**Other ruled baselines (not pins, each listed with its before and after in the Implementation Notes):** the C-14 registry, the nav test, the contrast `PAGES`, the vocabulary `FILES`, the owner-text guard's `PAGE`, the business-os-llm G-5 fetcher list, the finance source guard's usage-reader positive pin (if SA-Q-MK3-1 extracts the binding), and the redirect config tests.

---

## 8. Guards

| Guard | MK-3 change |
|---|---|
| `requireAdminPage` / `requireAdmin` | The page sits under `app/admin/layout.tsx`; the report route keeps `requireAdmin` first, and the new read runs after Zod and the 409. `test:authz-guard` run |
| Repositories only, ≤ 1,000 rows | No new method; the two existing reads page at 1,000; FF-1d run unchanged |
| Tenant isolation | With a business, only `listCallsInWindow` with exactly the validated id; the all-accounts read only with none (the finance route's rule, now shared) |
| Finance livemode guard | `chargedAiCost.ts` and `recordedReads.ts` name no Stripe mode; the finance source guard scans `chargedAiCost.ts` |
| Finance source guard (usage-log reader) | If SA-Q-MK3-1 = shared binding: the positive pin moves from the route to `recordedReads.ts` (still exactly two methods), and **neither route** names a usage-log method directly. Planted controls kept, **plus one new control that plants a third method in `recordedReads.ts`** (SA-WP-MK3, SA-Q-MK3-1). MK-3a |
| Admin analytics repository isolation | `recordedReads.ts` is under `app/api/admin/**`: passes |
| Vocabulary guard | `FILES` drops the two deleted pages and adds `aiCostCopy.ts`, `AiCostView.tsx`, `AiCostKpis.tsx`, `CallsTab.tsx`, `RecordedSection.tsx`. "AI cost" matches no forbidden phrase, so **no ALLOWED entry is needed** |
| `$` copy guard (USD-6) | A new scan over `app/admin/ai-cost`, the costs folder and `app/admin/analytics`, the Finance guard's rule and controls |
| Generic names (SA-11, FC-9) | The new guard also checks that `costs`, `grossMargin`, `operatingMargin` and `OtherCosts*` do not appear as identifiers in the AI cost files |
| C-14 registry | Two entries become one, `/admin/ai-cost (AI cost)`, listing every file of both tabs |
| Layout folder `EXPECTED_SOURCES` | Adds `BlockKpi.tsx` |
| Contrast `PAGES` | `'Charge checks'` becomes `'AI cost'`: `app/admin/ai-cost`, the costs folder and `app/admin/analytics` |
| Nav test | Money hrefs `['/admin/finance', '/admin/ai-cost']`; `NESTED_LISTED` empty; on-disk count re-ruled |
| No-old-path guard (new) | No non-test file under `app/`, `lib/`, `components/`, `hooks/` names `/admin/finance/charges` or `/admin/analytics` in code (comments stripped); `next.config.js` holds them as redirect sources only. With a planted control |
| `test:bos-entitlements` | Run at handover (no registration change expected, CX-12) |
| `lint:hooks`, scoped `tsc` with a canary, `typecheck:bos-llm` (wire types) | Run |

---

## 9. Tests

### 9.1 New

| # | Test | File |
|---|---|---|
| T-1 | Page renders header, legend (both lines), tabs; default tab Summary & checks; one report request on load and no drill-down request | `app/admin/ai-cost/__tests__/aiCostPage.render.test.tsx` |
| T-2 | `tab=calls`: the report request **and** the drill-down request; the strip is the same as on Summary & checks; switching tabs sends no new report read | same |
| T-3 | Strip: five tiles in order A-K1..A-K5, each with its pill and definition, `$` values; A-K1 equals the payload's `chargedInWindow` and prints like F-K3; "At least" on `partial`; "Unknown" on `unknown`; A-K4 red above 0; no tile shows "USD" | `aiCostKpis.render.test.tsx` |
| T-4 | Strip failure paths: report 500 (tiles Unknown, content error), 409 platform account (notice, Calls unaffected), recorded read failed or late (A-K2, A-K3 Unknown, the others unaffected) | same |
| T-5 | Tile targets: anchors on Summary & checks; tab switches with real hrefs on Calls; A-K2 opens Calls with the same window and business | same |
| T-6 | Leak block KPI: "Not run yet" before a run; the count of findings with `uncharged > 0`; platform calls not counted; "At least" with an incomplete or could-not-check finding | `leakPanel.render.test.tsx` (appended) |
| T-7 | The recorded block (C-7) on Summary & checks: same words as Finance's today; "Not available" before the cut-over; the deleted note only with no business | `recordedSection.render.test.tsx` |
| T-8 | One spec: window and business carry across a tab switch; a `24h` link falls back; a linked window stays exact on Calls and covers whole days in the report request; `system` keeps the strip on all businesses with its note | `aiCostFilters.test.ts` |
| T-9 | Redirects: `/admin/finance/charges` → `/admin/ai-cost?tab=checks`, `/admin/analytics` → `/admin/ai-cost?tab=calls`, `/admin/business-os-llm?tab=costs` → `/admin/ai-cost?tab=checks`; each temporary, each keeps its query keys (including `dateFrom`, `user`, `scope`), destination `tab` wins | `aiCostRedirect.config.test.ts` |
| T-10 | Route: `recorded` present; all-accounts read with no business, one-account read with exactly the id; deadline → `unknown` and the report still 200; A-K3 equals Finance's `aboveCharged` for the same window and fixtures; 401/403/400/409 make **no** read, the usage-log reads included | `credits/report/__tests__/route.test.ts` (appended) |
| T-11 | Equality: for the same window and rows, the report route's `recorded` equals Finance's `aiCost.recorded` (all businesses, one business, ceiling, failed read) | `lib/business-os/finance/__tests__/chargedAiCost.test.ts` (appended) |
| T-12 | Request table for **every request each tab makes, for each window choice** (SA-Q-MK3-2 ruling): on Summary & checks the report request for default, Today, 7d, 30d, This month, 90d, Custom, linked and `range=24h` (falls back to This month, U-4); on Calls the report request **and** the drill-down request for the same choices, plus `scope=all`, a drill and `system`. MK-3a pins the Summary & checks half, MK-3b the Calls half | `app/admin/ai-cost/__tests__/aiCostCallsRequest.render.test.tsx` |
| T-13 | No-old-path guard and the `$` / generic-names guard, each with planted controls | `app/admin/ai-cost/__tests__/aiCost.source.guard.test.ts` |
| T-14 | `BlockKpi` in the shared folder renders exactly as before for Finance's two callers | `app/admin/components/layout/__tests__/BlockKpi.render.test.tsx` |

### 9.2 Ruled updates (before and after recorded in the Implementation Notes)

Pin A and Pin C test file (§7); `chargeChecksRedirect.config.test.ts`; the eight analytics render tests (mount the AI cost page at `tab=calls`; default window This month; 7d / 30d whole days); `costsLayout`, `costsTab`, `costsFilters` tests; `AdminSidebar.nav.test.ts`; `layoutFolder.guard.test.ts`; `contrast.lf1.source.guard.test.ts`; `aiCostVocabulary.source.guard.test.ts`; `ownerText.guard.test.ts`; business-os-llm `source.guard.test.ts` (G-5); `finance.source.guard.test.ts` (if the binding is shared); `financeLinks.test.ts`; `financePage.render.test.tsx` (Section 3 links and the one line); `recordedCost.render.test.tsx`; `evaluateHealth.test.ts` (path); `activityTab.render.test.tsx` (cut-over link); `creditReport.wireTypes.test.ts`.

### 9.3 Runs at handover

`app/admin/ai-cost`, `app/admin/analytics`, `app/admin/business-os-llm`, `app/admin/finance`, `app/admin/components`, `app/admin/__tests__`, `app/api/admin/business-os/credits`, `app/api/admin/business-os/finance` (AC-145), `app/api/admin/token-usage`, `lib/business-os/finance`, `lib/business-os/credits`, `lib/admin`, `lib/repositories` (range cap, isolation), `test:authz-guard`, `test:bos-entitlements`, `lint:hooks`, scoped `tsc` with a canary, `typecheck:bos-llm` (with `NODE_OPTIONS=--max-old-space-size=8192`, checked for an OOM trace), and the full gate once.

---

## 10. Acceptance criteria

| ID | Criterion |
|---|---|
| MK3-AC-1 | `/admin/ai-cost` renders for an admin, with the header "AI cost", the §14 purpose line, the Read-only badge, and the two-line legend on both tabs |
| MK3-AC-2 | Two tabs, Summary & checks (default) and Calls, addressable by `tab=checks` / `tab=calls`, APG keyboard behaviour |
| MK3-AC-3 | One window (default This month) and one business serve both tabs; a tab switch keeps them and sends no new report read |
| MK3-AC-4 | The strip shows exactly five tiles, A-K1 to A-K5, in that order, each with its leading or lagging pill and its §5 definition as the tooltip, equal height |
| MK3-AC-5 | A-K1 equals Finance's charged AI cost for the same window and business, and prints the same text as F-K3 for This month; with an unreadable amount it shows "At least", and its definition says why F-K3 shows Unknown (Q-R1) |
| MK3-AC-6 | A-K2 and A-K3 come from the same read as Finance's recorded figures and equal them for the same window and business; a failed or late read shows Unknown on those two tiles only |
| MK3-AC-7 | Every money figure on the page shows `$`, never "USD " before an amount; nothing is added across currencies |
| MK3-AC-8 | The Leak check shows the block KPI "Businesses with uncharged calls" with its leading pill: "Not run yet" before a run, then the count, never counting platform accounts |
| MK3-AC-9 | The recorded AI cost block (C-7) is on Summary & checks with its words unchanged; Finance shows one "Recorded above charged" line linking to it |
| MK3-AC-10 | `/admin/finance/charges`, `/admin/analytics` and `/admin/business-os-llm?tab=costs` redirect temporarily to the right tab, keeping their query |
| MK3-AC-11 | No in-app link relies on a redirect: the Health tile, Finance, the Businesses panel, the Activity cut-over notice and the Platform dashboard point at `/admin/ai-cost` |
| MK3-AC-12 | The sidebar's Money section is Finance, AI cost |
| MK3-AC-13 | `BlockKpi` is a shared layout export; Finance's two block KPIs render byte-identically |
| MK3-AC-14 | The Pin C request table is unchanged; Pin A changes only as ruled; Pin B, Pin D, AC-145 and AC-173 are unchanged |
| MK3-AC-15 | No new repository method, no migration, every list read ≤ 1,000 rows per page; the report route still refuses 401/403/400/409 before any read |
| MK3-AC-16 | The guards of §8 pass, each with its planted control |
| MK3-AC-17 | Pin A moves once per sub-slice only as §7.1 rules (MK-3a: 3 `CostsKpis` cases out, 5 `AiCostKpis` cases in; MK-3b: 4 `AnalyticsKpis` cases out), each with before and after hashes and a removal proof; every other case byte-identical |
| MK3-AC-18 | The Pin C table is byte-identical to `64a565e9`; the Pin C test file changes only its mount target, and its two dead sides are gone (MK-3a) |
| MK3-AC-19 | AC-145, AC-173, Pin B and Pin D hashes are recomputed and equal origin/main's after MK-2; the finance payload is unchanged |
| MK3-AC-20 | A-K1 shows "At least $x" on an unreadable amount, never Unknown (Q-R1, SA-WP-MK3 condition 4) |
| MK3-AC-21 | No internal link relies on a redirect at any point: in MK-3a A-K2 opens the real `/admin/analytics`; MK-3b retargets it in the same PR that adds the `/admin/analytics` redirect |
| MK3-AC-22 | The window choices are Finance's except as recorded in the Implementation Notes (90 days kept, `since_start` not offered); a `range=24h` link falls back to This month |
| MK3-AC-23 | The mode-wording, vocabulary and C-14 guards pass with their lists updated by ruling; no touched file has `console.*` in code |
| MK3-AC-24 | The `recorded` wire type equals `FinanceRecordedAiCost` both ways by a type-level test (a field added on either side fails `tsc`), and `lib/business-os/credits` imports nothing from `lib/business-os/finance` |

**Which sub-slice owns which AC.**

| Sub-slice | ACs |
|---|---|
| **MK-3a** | 1, 3 (Summary & checks; the cross-tab half in MK-3b), 4, 5, 6, 7 (the strip and Summary & checks), 8, 9, 10 (`/admin/finance/charges` and `business-os-llm?tab=costs`), 11 (Finance's checks and leak links), 13, 14, 15, 16, 17 (its part), 18, 19, 20, 21 (its part), 22, 23, 24 |
| **MK-3b** | 2, 3, 7 (Calls), 10 (`/admin/analytics`), 11 (Health tile, Businesses panel, cut-over notice, Platform dashboard, Finance's Calls links), 12, 15, 16, 17 (its part), 19, 21 (its part), 22, 23 |

MK-3a ships the page with the Summary & checks tab only, so MK3-AC-2 (two tabs) is met when MK-3b adds Calls. In MK-3a the sidebar's Money section is Finance, AI cost, AI calls & usage (detail); MK3-AC-12 (two entries) belongs to MK-3b.

---

## 11. Slice split

My estimate is **about 4 to 4.5 days**, over the 3-day ceiling. The extra comes from the one shared window spec (two specs with different window meanings become one), moving the 548-line analytics page into a tab with its eight render tests, and C-7. Proposed split (SA-Q-MK3-10):

| Slice | Content | Effort |
|---|---|---|
| **MK-3a** | The page with **Summary & checks** only: route, header, legend, strip A-K1 to A-K5 (A-K2 opens `/admin/analytics` for now, a real page), the report route's `recorded` and the shared binding, C-7, the Leak block KPI and the `BlockKpi` promotion, `$`, the `/admin/finance/charges` redirect and the `tab=costs` retarget, Finance's checks and leak links, the sidebar entry replacing Charge checks, Pin A (`CostsKpis` cases), Pin C test file | about 2.5 days |
| **MK-3b** | The **Calls** tab: the one spec with the Calls keys, the analytics page into the tab, `AnalyticsKpis` into the summary cards, the `/admin/analytics` redirect, the Health tile, the Businesses panel, the cut-over notice, the Platform dashboard and Finance's Calls links, the sidebar down to two entries, Pin A (`AnalyticsKpis` cases), contrast and owner-text guards, the no-old-path guard | about 1.5 to 2 days |

Between the two, the sidebar shows Finance, AI cost, AI calls & usage (detail), and A-K2's link goes to a page that exists, so nothing relies on a redirect.

**Approved by SA-WP-MK3:** 4 to 4.5 days, split into MK-3a and MK-3b, each with its own PR, its own ruled baselines (§7.1) and its own ACs (§10). The coordinator's instruction is to build **MK-3a only** for now.

---

## 12. Task list

- ✅ Step 0: after MK-2 merges, merge origin/main into this branch; re-run the MK-2 suites; re-record every pin hash (§7) and re-check CF-1 to CX-12
- ✅ Step 1 (MK-3a): `BlockKpi` to the shared folder; Finance callers; `EXPECTED_SOURCES`; T-14
- ✅ Step 2 (MK-3a): server: `recordedReads.ts`; `chargedAiCost.ts` units and recorded composition; report route `recorded`; types and wire pins; T-10, T-11
- ✅ Step 3 (MK-3a part): page, copy, legend; T-1. ⬜ MK-3b: the one spec, `useCostReport`, the tab list, T-8 (DV-1)
- ✅ Step 4 (MK-3a): `AiCostKpis`; Pin A removal and append; T-3 to T-5
- ✅ Step 5 (MK-3a): Summary & checks blocks, `RecordedSection`, Leak block KPI; Finance one line (C-7); T-6, T-7
- ⬜ Step 6 (MK-3b): Calls tab (`CallsTab`, summary cards, window rules); T-2, T-12
- ✅ Step 7 (MK-3a part): the Charge checks redirect and retarget, Finance's links, the sidebar entry, the charges page deleted, Pin C test file, T-9 (charges), T-13. ⬜ MK-3b: the analytics redirect, the Health tile and other Calls links
- ✅ Step 8 (MK-3a part): guard updates (§8) and ruled test updates (§9.2)
- ✅ Step 9 (MK-3a): runs (§9.3), pins re-checked, Implementation Notes

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Merging two URL specs with different window meanings changes what an old Calls link shows (30 days default → This month; 7d rolling → whole days) | Decided by C-6 / Q-5 for the default; SA-Q-MK3-3 for 7d / 30d; T-12 pins every request |
| R-2 | The report route gains a usage-log read of up to 10,000 rows on every AI cost load | Same read and deadline Finance already runs on every Overview load; 2 s deadline, then Unknown on A-K2 / A-K3 only |
| R-3 | The breakdowns and spread stay whole-period figures under a window strip | Unchanged from MK-2 and labelled; changing them is not in MK-3's scope |
| R-4 | Rebasing on MK-2: seven of MK-2's files are rewritten here | No edit before the merge; §4 lists them; MK-2's tests re-run at Step 0 |
| R-5 | Pin A loses seven cases | Each removal is tied to a deleted component (§7 proof); every other entry byte-identical |
| R-6 | The Calls tab's strip can disagree with its own "Recorded AI cost, this view" card (scope All, a drill, the 1,000-call cap) | Different labels; the card says "this view"; A-K2 says "Business OS calls" |
| R-7 | The Platform dashboard is marked "do not extend or link" | Only two hrefs change; G-1 to G-5 stay green (SA-Q-MK3-9) |
| R-8 | Scope exceeds 3 days | §11 split |

---

## 14. Out of scope

- **The AI cost business drawer and the billing-period drawer** (the rest of MK-8). A separate later slice. MK-3 adds no drawer to Summary & checks; the Calls tab keeps its existing call drawer.
- Any new money source, write, Stripe call or FX (FIN NG-1 to NG-4); any other operating cost (§13).
- Changing the breakdowns or spread from whole periods to the window.
- Moving the costs and analytics component folders.
- The Leak check's own window, rules or route.
- The Business OS AI page's Settings and Activity tabs.

---

## 15. Open questions for SA

| # | Question | My recommended default |
|---|---|---|
| SA-Q-MK3-1 | The report route needs the two usage-log reads the finance route binds. Bind them once in a shared `app/api/admin/business-os/finance/recordedReads.ts` (both routes import it; the finance source guard's positive pin moves there), or bind them again in the report route with an equality test? | **Shared file**: one wiring, as SA preferred in RU-19 (MK-2). The helper sits under `app/api/admin/**`, beside the routes (the `app/api/crm/subscribers/buildAudience.ts` precedent) |
| SA-Q-MK3-2 | One page spec (`tab`, window, account and the Calls keys), with each tab's bar bound to it, or keep each tab's own hook with the save-and-restore coordination of the Business OS AI page? | **One spec** (Finance's pattern): the window and business are one value, which "one window and one picker" needs |
| SA-Q-MK3-3 | Window meaning: 7d / 30d as whole UTC days on both tabs (the Calls request changes from `period=N`), 24 h dropped, and a linked window exact on Calls but widened to its whole UTC days for the report and strip, with a window line saying so? | **Yes to all three**, so the strip and the Calls total cover the same span; the Health tile's exact window still opens exactly on Calls |
| SA-Q-MK3-4 | `account=system` (a Calls drill value) and the strip: read all businesses with the note "All businesses: system calls belong to no business"? | **Yes** |
| SA-Q-MK3-5 | The Leak block KPI counts findings with `counts.uncharged > 0` (not `undercharged`), "At least" when any finding is `incomplete` or `could_not_check`, and "Not run yet" before a run? | **Yes**: §5 defines it as "recorded but not charged"; undercharged calls are charged |
| SA-Q-MK3-6 | Calls tab: `AnalyticsKpis` removed (one strip per page); its figures become summary cards above the table, and in All scope the four category filters become filter links in the cards, not tiles? | **Yes** |
| SA-Q-MK3-7 | `formatUsdSign` (`maxDecimals: 4`) for the strip and block KPI only; tables keep `costFormat.formatUsd` (already `$`, sub-cent precision)? | **Yes**: the tile prints like F-K3; a per-action cost needs its sub-cent digits |
| SA-Q-MK3-8 | Import `formatUsdSign` from `app/admin/finance/financeFormat.ts`, or promote it to the shared `adminFormat.ts` together with `BlockKpi`? | **Import from Finance**: one shared export added in this slice (`BlockKpi`) is enough; promote later if a third page needs it |
| SA-Q-MK3-9 | The redundant Platform dashboard links to `/admin/analytics` twice. Retarget the two hrefs (no other edit), or leave them on the redirect? | **Retarget**: SA-6 says no internal link relies on a redirect; the change neither extends nor links the dashboard |
| SA-Q-MK3-10 | Split into MK-3a (Summary & checks, server, C-7, `BlockKpi`) and MK-3b (Calls tab, its redirect and links), each with its own PR? | **Yes** (§11) |
| SA-Q-MK3-11 | Pin C test file: keep the two older sides as dead branches, or remove them so the file mounts only the AI cost page? | **Remove them**: the charges page and the `tab=costs` tab no longer exist; the table stays byte-identical, which is the proof that matters |
| SA-Q-MK3-12 | The `recorded` wire type: declare it in `creditReportTypes.ts` and pin it equal to `FinanceRecordedAiCost` both ways, rather than import Finance's type into the credits module? | **Yes**: keeps the credits → finance direction clean (MK-2 kept finance → credits only) |

---

## 16. Business questions

**None.** Every visible change was decided in §4 (Page 2, accepted with "agree with all recommendations"), Q-1, Q-5, Q-9, Q-14 and C-7. The window rules in SA-Q-MK3-3 change how 7 days is counted on the Calls tab only, to match the rest of Money, and are left to SA as a technical consistency question (the Q-R1 precedent). If SA judges that a user would notice and care, it goes to the user through BA.

---

## Implementation Notes

### Conditions from SA-WP-MK3, and where each is applied

| # | Condition | Applied in |
|---|---|---|
| 1 | Pin A: one ruled re-freeze per sub-slice (MK-3a: 3 `CostsKpis` out, 5 `AiCostKpis` in; MK-3b: 4 `AnalyticsKpis` out), each with before and after hashes and a removal proof | §7.1, MK3-AC-17 |
| 2 | Pin C: only the mount target changes; the table stays byte-identical to `64a565e9` after the update; the two dead sides go in MK-3a | §7.1, MK3-AC-18 |
| 3 | AC-145, AC-173, Pin B and Pin D unchanged, with their hashes recomputed here; C-7 changes the Finance UI only; any finance payload change stops the work for a ruling | §7.1, MK3-AC-19, the Step 0 table below |
| 4 | A-K1 shows "at least" on an unreadable amount (Q-R1); no tile reads Unknown for that case | MK3-AC-20, T-3. **Read as:** on an unreadable amount no tile shows Unknown. A failed or late read still shows Unknown (T-4), because then there is no figure to bound. If SA meant something wider, I will ask before building T-4 |
| 5 | No internal link relies on a redirect; in MK-3a A-K2 opens the real `/admin/analytics`, and MK-3b retargets it together with the redirect | §11, MK3-AC-21 |
| 6 | Window-list differences from Finance recorded here; no `since_start` in this slice; `range=24h` falls back to This month (U-4 test) | The window record below, MK3-AC-22, T-8, T-12 |
| 7 | Mode-wording, vocabulary and C-14 guards green with their lists updated by ruling; no `console.*` in touched files | §8, MK3-AC-23 |

Also from the rulings: the extra planted control in `recordedReads.ts` (SA-Q-MK3-1, §8); T-12 pins every request each tab makes for each window choice (SA-Q-MK3-2, §9); the `recorded` type equality is type-level, and the credits module never imports from finance (SA-Q-MK3-12, MK3-AC-24).

### Window choices: the differences from Finance (condition 6)

§4 says the AI cost page uses "the same window choices as Finance". The plan differs in two ways, both accepted by SA:

| Choice | Finance | AI cost page | Why |
|---|---|---|---|
| 90 days | Not offered | **Kept** | Charge checks already offers it (`COSTS_WINDOW_EXTRAS = ['90d']`), so nobody loses a choice |
| Since start (`since_start`, DF-6) | Offered, only with a business picked | **Not offered in MK-3** | Not in this slice's scope. An inbound `range=since_start` falls back to This month (U-4) |

24 hours, which AI calls & usage offered, is **dropped** to match Finance, which has no 24-hour choice. A `range=24h` link falls back to This month (the U-4 test in T-8 and T-12).

**For the user, information only (SA's business-question check):** on the Calls tab, "7 days" now means the last 7 whole UTC days, as it does on Finance, instead of the last 168 hours. The same applies to "30 days". The coordinator passes this on; it is not a question.

### Step 0, to be filled after MK-2 merges

Steps: `git fetch`, then `git merge --ff-only origin/main` (the branch has no commits). Then re-record the hashes below and re-check CF-1 to CX-12.

| Pin or baseline | On `6e19cbe4` | Expected after MK-2 | Recorded at Step 0 |
|---|---|---|---|
| Pin A file | `3fa2360a` | `5f537869` | ✅ `5f537869` |
| Pin B | `a1b3db0c` | `a1b3db0c` | ✅ `a1b3db0c` |
| Pin C test file | `98ea0507` | `98ea0507` | ✅ `98ea0507` |
| Pin C table | `02813360` | `64a565e9` | ✅ `64a565e9` |
| Pin D | `1f7cf07a` | `1f7cf07a` | ✅ `1f7cf07a` |
| AC-173 test + helper | `3a1a2dd4` + `b84e0c96` | unchanged | ✅ `3a1a2dd4` + `b84e0c96` |
| AC-145 `EXPECTED_SHA256` | `33340751…2215` | unchanged | ✅ `33340751…2215` |

**Step 0 recorded 2026-10-26** on `origin/main` `f8d32d60` (MK-2 #516 merged; the branch fast-forwarded with `git merge --ff-only`, no stash, no commit). Every value equalled the expected one. CF-1 to CX-12 re-checked: only CF-8 / CF-9 / CX-10 moved, and as MK-2 said (`chargedInWindow` in the report route, `chargedAiCost.ts` on main).

### MK-3a build (2026-10-26, uncommitted)

**Built.**

| Part | Where |
|---|---|
| Page `/admin/ai-cost`: header "AI cost", the §14 purpose line, Read-only badge, the fixed two-line legend, then the report (`CostsTab`) | `app/admin/ai-cost/page.tsx`, `app/admin/ai-cost/aiCostCopy.ts` |
| Strip A-K1 to A-K5 with pills and one definition each (LL-4); `$` through Finance's `formatUsdSign(…, { maxDecimals: 4 })`, the F-K3 call; A-K1 "At least" on an unreadable amount or the ceiling, Unknown only on a failed read (Q-R1, condition 4); A-K2 opens the real `/admin/analytics` on the report's whole UTC days and business (condition 5) | `app/admin/business-os-llm/components/costs/AiCostKpis.tsx` (replaces `CostsKpis.tsx`, deleted) |
| Recorded block (C-7) on Summary & checks, with the Leak check, under `#costs-leak` (A-K3's target, always drawn) | `components/costs/RecordedSection.tsx`, `CostsTab.tsx` |
| Leak check block KPI "Businesses with uncharged calls" (leading), counted from the run's own result: findings with `counts.uncharged > 0`; "At least n" when an account was incomplete or unchecked, accounts were left, the deadline passed or the listing failed; "Not run yet" before a run | `components/costs/LeakCheckPanel.tsx`, `leakCopy.ts` |
| `BlockKpi` promoted to the shared folder, markup byte-identical (hash `99c6969c…` taken from the Finance copy on `f8d32d60`) | `app/admin/components/layout/BlockKpi.tsx`; Finance's `CreditsSection.tsx`, `TakingsSection.tsx` |
| Server: the two usage-log reads bound once (SA-Q-MK3-1); the report route runs them after the 409, under Finance's 2 s deadline, and returns `recorded` (Finance's builder against `chargedInWindow`'s units); the finance route takes the same binding | `app/api/admin/business-os/finance/recordedReads.ts`, `lib/business-os/finance/chargedAiCost.ts` (`buildChargedAiCostInWindowWithUnits`, `recordedInWindow`), `app/api/admin/business-os/credits/report/route.ts`, `app/api/admin/business-os/finance/route.ts`, `lib/business-os/credits/creditReportTypes.ts`, `app/admin/business-os-llm/costTypes.ts` |
| Finance (C-7): Section 3 keeps one line "Recorded above charged" linking to `/admin/ai-cost?tab=checks…#costs-leak`; the account summary's Costs link and the Leak check link go to `/admin/ai-cost?tab=checks` | `RecordedCostLines.tsx` (`RecordedAboveLine`), `AiCostSection.tsx`, `financeLinks.ts` (`costsHref`, `leakCheckHref`, new `aiCostRecordedHref`), `financeCopy.ts` |
| Redirects: `/admin/finance/charges` → `/admin/ai-cost?tab=checks` (new); `business-os-llm?tab=costs` retargeted there (no chain) | `next.config.js` |
| Sidebar: "Charge checks" becomes "AI cost" (`/admin/ai-cost`); AI calls & usage stays until MK-3b | `AdminSidebar.tsx` |
| Deleted | `app/admin/finance/charges/page.tsx`, `CostsKpis.tsx`, `app/admin/finance/components/BlockKpi.tsx` (moved), `chargeChecks.page.render.test.tsx` (replaced) |

**Pins (LF-normalised SHA-256 of each file; before = `f8d32d60`).**

| Pin | Before | After | Note |
|---|---|---|---|
| Pin A | `5f537869` | `4e2a93aa` | Ruled re-freeze once (condition 1): the 3 `A2 CostsKpis` cases and their fixture removed (`CostsKpis.tsx` deleted, nothing imports it); 5 `A2 AiCostKpis` cases appended (`loading` `c5bb8059…`, figures `6e3b63ef…`, `at least` `ade0938b…`, `unknown and not checked` `6597faff…`, `no sections, before the cut-over, one business` `f6e6e16a…`). Every other case byte-identical: 65 / 65 |
| Pin C test file | `98ea0507` | `e57f2675` | Ruled re-freeze (condition 2): mounts `/admin/ai-cost?tab=checks&<state>`; the two dead sides removed |
| Pin C table | `64a565e9` | `64a565e9` | **Unchanged**: the requests are byte-identical, 11 / 11 |
| Pin B | `a1b3db0c` | `a1b3db0c` | Unchanged |
| Pin D | `1f7cf07a` | `1f7cf07a` | Unchanged |
| AC-173 | `3a1a2dd4` + `b84e0c96` | same | Unchanged |
| AC-145 | `33340751…2215` | same | Unchanged; `financeTypes.ts`, `financeHealth.ts` and the finance route test are byte-identical to HEAD (finance payload unchanged, condition 3) |

**Ruled baselines and test updates (before → after).**

| # | File | Before | After |
|---|---|---|---|
| RU-1 | `layoutFolder.guard.test.ts` | `EXPECTED_SOURCES` without `BlockKpi.tsx`; entry `/admin/finance/charges (Charge checks)` with the page and `CostsKpis.tsx` | `BlockKpi.tsx` listed; entry `/admin/ai-cost (AI cost)` with `app/admin/ai-cost/page.tsx`, `AiCostKpis.tsx`, `RecordedSection.tsx` |
| RU-2 | `contrast.lf1.source.guard.test.ts` | `'Charge checks'`: the costs folder; Finance contains the charges page | `'AI cost'`: `app/admin/ai-cost` + the costs folder; Finance must not contain the charges page |
| RU-3 | `aiCostVocabulary.source.guard.test.ts` | 18 files incl. the charges page; W-13 / S-6 the Charge checks intro and title; W-14 `Charged AI cost (USD)`; M4-FR-1 rows in Finance's copy; S-8 `Charge checks`; S-10 "on Charge checks"; MIN_TEXTS AiCostSection 28, RecordedCostLines 7 | 21 files (charges page out; page, `aiCostCopy.ts`, `AiCostKpis.tsx`, `RecordedSection.tsx` in, no ALLOWED entry needed); W-13 / S-6 the AI cost purpose and title; W-14 `Charged AI cost`; M4-FR-1 rows in the cost copy, labels without "(USD)", the source ending "run the Leak check below."; S-8 `AI cost: Summary & checks`; S-10 "on AI cost"; MIN_TEXTS 27 and 5, new files 2 / 6 / 22 / 7 |
| RU-4 | business-os-llm `source.guard.test.ts` G-5 | expects `CostsKpis.tsx` | expects `AiCostKpis.tsx` and `RecordedSection.tsx` |
| RU-5 | `finance.source.guard.test.ts` | only the finance route names a usage-log reader, exactly two methods; bindings checked in the route | `recordedReads.ts` is that file (added to `FILES`), exactly two methods; neither route names a reader or method (new case, with a planted control); the third-method control planted in `recordedReads.ts` |
| RU-6 | `AdminSidebar.nav.test.ts` | Money `/admin/finance/charges`; `NESTED_LISTED` holds it; the Money words test names Charge checks | Money `/admin/ai-cost`; `NESTED_LISTED` empty; `/admin/ai-cost` on disk; words "AI cost" / "Charged and recorded AI cost, and the charge checks, Business OS". 28 hrefs, unchanged |
| RU-7 | `chargeChecksRedirect.config.test.ts` | `tab=costs` → `/admin/finance/charges`; 4 redirects | → `/admin/ai-cost?tab=checks` (destination tab wins); 5 redirects; new describe for `/admin/finance/charges` (4 query cases, spec read-back, old page gone) |
| RU-8 | `finance/__tests__/source.guard.test.ts` AC-158 | Section 3 renders `<RecordedCostLines … chargedShown />` | renders `<RecordedAboveLine … window={window} />` |
| RU-9 | `recordedCost.render.test.tsx` | the full block on Finance | the one line, its link, its states, SA-W98, the moved parts absent; the block's cases moved to `recordedSection.render.test.tsx` |
| RU-10 | `financeLinks.test.ts` | Costs link `/admin/finance/charges?` no tab; Leak link `/admin/finance/charges[?account]`; AC-193 "no tab" | `/admin/ai-cost?tab=checks&…`; Leak link `/admin/ai-cost?tab=checks[&account]#costs-leak`; AC-193 now "never the old address, tab=checks"; new `aiCostRecordedHref` describe |
| RU-11 | `financePage.render.test.tsx`, `financeAccount.render.test.tsx` | the Section 3 block with `RECORDED_LABEL` from Finance's copy | the one line; `RECORDED_LABEL` imported from the cost copy |
| RU-12 | `costsLayout.render.test.tsx` | mounts the charges page; C-12 for the old five tiles | mounts the AI cost page; C-12 rewritten for A-K1 to A-K5 (8 cases incl. Q-R1, the recorded states, pills, no "USD "); fixture gains `recorded` |
| RU-13 | `costsTab.render.test.tsx` | the Charge checks page case | the AI cost page case (h1 and legend); fixture gains `recorded` |
| RU-14 | `credits/report/__tests__/route.test.ts` | no usage-log fakes | the two readers faked at the boundary; `noReadHappened` covers them; new describe (7 cases) |
| RU-15 | `scripts/typecheck-bos-llm.ts` | — | one file added to `SCOPED_DIRS`: `lib/business-os/finance/__tests__/recordedInWindow.wireTypes.test.ts` (condition SA-Q-MK3-12) |

**New tests.** `app/admin/ai-cost/__tests__/aiCostPage.render.test.tsx` (T-1: 2), `app/admin/ai-cost/__tests__/aiCost.source.guard.test.ts` (T-13: G-1 old address, G-2 `$`, G-3 generic names, G-4 page purity, with planted controls: 40), `recordedSection.render.test.tsx` (T-7: 6), the leak block KPI in `leakPanel.render.test.tsx` (T-6: 9), `BlockKpi.render.test.tsx` (T-14: 3), the MK-3 describe in `financeHealth.test.ts` (T-11: 6 equality cases), `recordedInWindow.wireTypes.test.ts` (type-level, both ways).

**Deviations from the workplan, for SA.**

| # | Planned | Built | Why |
|---|---|---|---|
| DV-1 | `AiCostKpis` in `app/admin/ai-cost/components/`; `useCostReport` lifted out of `CostsTab`; one page spec with `tab` | `AiCostKpis` and `RecordedSection` in the costs folder (SA-Q59: the report's components stay together); the read stays in `CostsTab`; the page uses the report's spec and keeps the redirect's `tab=checks` untouched; no tab list | With one tab, nothing needs the read lifted or the spec merged. Both arrive in MK-3b, which needs them. Smaller MK-3a, same behaviour |
| DV-2 | §2.5 block order (charged, recorded and Leak check, periods, fallback) | The existing order kept (charged block, periods, breakdowns, fallback, spread), then recorded + Leak check under `#costs-leak` | No test or anchor moved; the strip's anchors reach every block. The reorder can come with MK-3b's layout if SA wants it |
| DV-3 | Pin A fifth case "on the Calls tab (cross-tab targets)" | "no sections, before the cut-over, one business" | There is no Calls tab in MK-3a |
| DV-4 | — | A-K3 reads Unknown when the charged side is not exact (an unreadable amount or the ceiling), Finance's R4-9 rule, by construction | A difference with a lower bound on one side is not a figure. A-K1 itself shows "At least" (condition 4). **SA to confirm** this reading of "no tile reads Unknown" |
| DV-5 | — | `leakCheckHref` has no production caller now (Section 3's link is `aiCostRecordedHref`); kept, retargeted and tested | Removing an export is outside MK-3a's scope; propose removal in MK-3b |
| DV-6 | Copy | A-K3's definition: "Recorded AI cost we did not charge is a leak before it is a loss" | The vocabulary guard refuses §4's "uncharged spend" (SA-Q51 list) |

**Runs (2026-10-26, on `f8d32d60` plus the working tree).**

| Run | Result |
|---|---|
| `app/admin/finance`, `app/admin/business-os-llm`, `app/admin/components`, `app/admin/__tests__`, `app/admin/ai-cost` (finance, business-os-llm, components, admin guards, redirects, Pin A, Pin B, Pin C, AC-173) | 90 suites, 3,395 passed |
| `lib/business-os/finance`, `lib/business-os/credits`, `app/api/admin/business-os/credits`, `app/api/admin/business-os/finance` (AC-145), `lib/admin` (Pin D) | 95 suites, 4,667 passed |
| `lib/repositories` (range cap, importer and isolation guards), `app/admin/analytics`, `app/api/admin/token-usage` | 131 suites, 3,082 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 308 suites, 9,264 passed |
| `lint:hooks` | exit 0 |
| Scoped `tsc` (48 touched TS files) with a canary | canary `TS2322` at `AiCostKpis.tsx(185,7)`; restored with `cp`, `cmp` identical (sha256 `223766f07cac8b59` before and after); clean run 0 errors |
| Wire-type canary | a field added to `CreditReportRecordedInWindow` fails `TS2344` in `recordedInWindow.wireTypes.test.ts`; restored, `cmp` identical |
| `typecheck:bos-llm` (`NODE_OPTIONS=--max-old-space-size=8192`, checked for an OOM trace) | passed: 587 files in scope, 11 errors, 0 new |
| One load flake | `costsLayout` C-4 timed out once inside a parallel run of 4 folders (84 s suite); passed alone and in the next full run |

## SA Review Notes

### SA Workplan Review (SA-WP-MK3)

**Reviewed by SA — 2026-10-26**
**Status:** ✅ Approved with conditions. Build MK-3a only after MK-2 has merged and this branch is rebased onto it.

**Rulings on §15**

| # | Ruling |
|---|---|
| SA-Q-MK3-1 | **Shared binding approved.** `recordedReads.ts` stays under `app/api/` and is server-only, so routerPlacement is not involved. The finance source guard's positive pin moves to this file and names exactly the two methods. Neither route names a usage-log method directly. Keep the planted controls, and add one control that plants a third method in `recordedReads.ts`. |
| SA-Q-MK3-2 | **One spec approved**, following Finance's pattern. T-12 must pin every request each tab makes, for each window choice. |
| SA-Q-MK3-3 | **Approved.** See the business-question check below. |
| SA-Q-MK3-4, 5, 7, 9, 10, 11, 12 | **Defaults approved.** For 12, the both-ways equality check is a type-level test, so a field added on either side fails `tsc`. The credits module must not import from finance. |
| SA-Q-MK3-6 | **Approved.** It is already decided by §4.2 and §6 item 27. |
| SA-Q-MK3-8 | **Import from Finance approved.** There is precedent: `PlanBillingBlock` imports `plansCopy`. The import also keeps the finance source guard's `formatUsdSign` reference where it is. `BlockKpi` is a different case: it is a component reused across pages, so it goes in the layout folder (MK-1 ruling). |
| Split / estimate | **4 to 4.5 days, split into MK-3a and MK-3b, approved.** Each part gets its own PR, its own ruled baselines and its own ACs. |

**Conditions**
1. **Pin A** gets one ruled re-freeze per sub-slice. MK-3a removes the 3 `CostsKpis` cases and appends the 5 `AiCostKpis` cases. MK-3b removes the 4 `AnalyticsKpis` cases. Each re-freeze records the before hash, the after hash and a removal proof (the removed component no longer exists, so its case cannot run). No other case changes.
2. **Pin C:** only the mount target changes. The table must be byte-identical to `64a565e9` (the post-MK-2 hash) after the rebase. The two dead sides are removed in MK-3a.
3. **AC-145, AC-173 and Pins B and D stay unchanged.** Recompute their hashes in the Implementation Notes. C-7 changes the Finance UI only. If the finance payload changes at all, stop and get a ruling.
4. **A-K1** shows "at least" on an unreadable amount (Q-R1). No tile reads Unknown.
5. **Links:** no internal link relies on a redirect. In MK-3a, A-K2 opens the real `/admin/analytics`. MK-3b retargets it at the same time as it adds the redirect.
6. **Window list:** §4 says the page uses "the same window choices as Finance". This plan keeps 90 days, which is not on Finance today, and does not offer Finance's `since_start`. Keeping 90 days is accepted, because Charge checks already offers it and nobody loses a choice. Do not add `since_start` in this slice. Record both differences in the Implementation Notes. A `range=24h` link falls back to This month (U-4 test).
7. Mode-wording, vocabulary and C-14 guards stay green with their lists updated by ruling. No `console.*` in touched files.

**Business-question check (asked by TL)**
- **SA-Q-MK3-6 (AnalyticsKpis strip removed; its figures become summary cards or filter links):** covered. §4.2's Calls row says "Call count, tokens and average cost per call become this tab's summary cards". §6 item 27 maps the rest to A-K2 and the summary cards. The user approved both on 2026-10-19 with "agree with all recommendations". **No question.**
- **SA-Q-MK3-3, the default and dropping 24 hours:** covered. §4 says "It uses the same window choices as Finance (**This month** by default)", Q-5 and C-6 set the default, and Finance has no 24-hour choice. **No question.**
- **SA-Q-MK3-3, 7 and 30 days as whole UTC days on Calls:** §4 does not say this in words. It follows from "same window choices as Finance", and it is needed so the strip and the Calls total cover the same span. That makes it a consistency ruling, the same kind as Q-R1, not a business trade-off. **No question.** Mention it to the user as information only: "On the Calls tab, '7 days' now means the last 7 whole days, as it does on Finance, instead of the last 168 hours."

### Approval
[x] Workplan approved, with conditions 1 to 7. Proceed to MK-3a after MK-2 merges.

### SA Code Review (SA-CR-MK3A)

**Code Review by SA — 2026-10-26**
**Status:** ✅ Code Approved. Reviewed against the uncommitted tree on `f8d32d60`. No fix is required. The follow-ups for MK-3b are listed below.

**SA-WP-MK3 conditions**

| # | Verdict |
|---|---|
| 1 Pin A | ✅ Re-frozen once, `5f537869` → `4e2a93aa`. The 3 `CostsKpis` cases are out, and the removal is proven: the file is deleted and nothing imports it. The 5 `AiCostKpis` cases are appended and the other cases are byte-identical (65/65). MK-3b re-freezes Pin A once more, for the `AnalyticsKpis` cases. |
| 2 Pin C | ✅ The test file moves `98ea0507` → `e57f2675` (mount target only; dead sides removed). The table stays `64a565e9`, 11/11. |
| 3 Unchanged pins | ✅ AC-145, AC-173, Pin B and Pin D keep the same hashes. `financeTypes.ts`, `financeHealth.ts` and the finance route test are byte-identical, so the finance payload did not change. In the finance route, the only change is that the two bindings moved into `recordedReads(adminReadContext)`; the context is the same and so is the `end − 1 ms` handling. |
| 4 A-K1 | ✅ An unreadable amount or the ceiling shows "At least". Unknown appears only on a failed read. See DV-4 for A-K3. |
| 5 Links | ✅ A-K2 opens `/admin/analytics?range=custom&from&to[&account]`, a real page. Those keys are that page's own (`range`/`from`/`to` from `adminWindow`, plus `account`). A custom window there is sent as whole days, so it covers the same days the report does. Finance's links go straight to `/admin/ai-cost?tab=checks`, so none relies on a redirect. |
| 6 Window list | ✅ Recorded in the Implementation Notes. |
| 7 Guards | ✅ See the guards section below. No `console.*` was added (the two hits are pre-existing text in a guard test and a script). Mode wording: the one hit in `financeCopy.ts` is on main already, not in this diff. |

**Guards and standards.**
- **Finance source guard:** `recordedReads.ts` is the one file that names a usage-log reader, with exactly two methods. Neither route names one, and the third-method planted control is in place.
- **Range cap:** both reads keep their existing page size and ceiling. The all-accounts read is stopped by the deadline signal (C-1 / FF-1d).
- **Layout folder:** `EXPECTED_SOURCES` lists `BlockKpi.tsx`, and the markup hash `99c6969c…` is pinned.
- **Repositories only:** both reads go through existing repository methods; there is no new method and no direct Supabase call. The account read stays `.eq('user_id')` by signature, and it runs only after Zod and the 409 for a platform account.
- **Admin gate:** `requireAdmin` is the first statement in the route. The page sits under `requireAdminPage` in the admin layout.
- **`$` and USD only:** both tile amounts go through `formatUsdSign(…, { maxDecimals: 4 })`; if it refuses, the tile shows Unknown, never another figure. No currency is summed.
- **Logging:** the log line carries the outcome, counts and flags, never an amount.
- **The `recorded` read never fails the report:** `runRecordedRead` never rejects, and RU-14 covers this.
- **Typecheck in CI:** `typecheck-bos-llm` gains exactly one file, and the canary was caught.

**Rulings on the deviations and copy**

| # | Ruling |
|---|---|
| DV-4 | **Satisfies condition 4.** That condition is about plain totals (A-K1, and A-K2 the same way). A-K3 is a difference, and when the charged side is only "at least", the difference has no lower bound: it is only an "at most". Showing Unknown is Finance's R4-9 rule and Q-R1's F-K3 precedent, and it keeps the two pages agreeing. Accepted as built. |
| DV-1 | **Accepted** for MK-3a, since there is only one tab. **MK-3b must** lift the read out of `CostsTab` and build the one page spec with `tab`, with T-12 pinning every request on both tabs (SA-Q-MK3-2). That is not optional in MK-3b. |
| DV-2 | **Accepted.** Keeping the existing order moves no anchor and no test. MK-3b either applies the §2.5 order or records that it keeps this one; either is fine. |
| DV-3 | **Accepted.** The fifth case fits MK-3a, and the Calls-tab case belongs in MK-3b's Pin A re-freeze. |
| DV-5 | **Accepted.** Remove `leakCheckHref` and its tests in MK-3b, together with Finance's Calls links. |
| DV-6 | **Accepted.** The copy is plain and passes the vocabulary guard. |
| Activity note "…counted by the Leak check on AI cost." | **Accepted.** It names the sidebar entry the admin can now see. |
| Account summary link "AI cost: Summary & checks" | **Accepted.** In MK-3a there is no tab list yet, so the page never shows the words "Summary & checks". MK-3b's tab must carry exactly that label, so the link and the tab agree. Low; it does not block. |

### Code Review Comments
1. `LeakCheckPanel.tsx`, `unchargedBusinessesValue`: when a run's listing fails and has no findings, the KPI reads "At least 0". That is true, but it says little. You could show Unknown when `listingFailed` is true and there are no accounts. Optional; Low.
2. `recordedInWindow.wireTypes.test.ts`: the two-way `Satisfies` check catches a required field added on either side. It does not catch an OPTIONAL field added on one side. This matches the existing `creditReport.wireTypes` pattern, so it is not a regression. If a tighter check is wanted later, use an exact `Equals<A, B>` helper for both pins together. Low; does not block.
3. `AdminSidebar.tsx`: the AI cost entry keeps the `UserCheck` icon from Charge checks. Choose the icon in MK-3b, when the entry also covers Calls. Style; does not block.

### Optimisation Suggestions
- MK-3a's report request now always includes the recorded read, under Finance's 2 s deadline and in parallel with the report. That is acceptable. If p95 rises in QA's timing check, the all-accounts read is the one to watch.

### Code Approved for QA: Yes

## QA Testing Report

### QA — MK-3a, 2026-10-26

**Worktree:** `neuronforge-finance-mk3`, branch `feature/admin-money-mk3-ai-cost-page` on `f8d32d60`, uncommitted. The source has been stable since 18:30, before every run below.

| Field | Value |
|---|---|
| Test mode | full |
| Focus | ui, api |
| Skipped | the live page (user, below) |
| Input source | the coordinator's list, the MK3-AC rows owned by MK-3a, and SA-WP-MK3 conditions 1 to 7 |

**Strategy used:**
- **A + B:** every suite and guard, each run alone.
- **A code read:** the page, the strip, the Leak KPI, `recordedReads.ts`, `chargedAiCost.ts`, the report route, the redirects and the links.
- **Next's own redirect code:** read in `node_modules/next` 14.2.35, to confirm which `tab` wins.
- **Two temporary, untracked probes, deleted afterwards.** `git status` is clean of `zz_*`, and neither probe is kept as a permanent test.
  - **(1) Equality on date-filtering fakes,** so no check can pass by coincidence:
    - the ledger's R-a / R-a′ and the usage log's two reads all filter seeded rows on their dates;
    - the seeded rows span October, November and the charging cut-over, and include deleted accounts and a 4-decimal amount.
    - The report route's exact path is then compared field by field with `buildFinanceHealth`. That path is `windowInstants` → `buildChargedAiCostInWindowWithUnits` ∥ `runRecordedRead` → `recordedInWindow`.
  - **(2) A render of `AiCostKpis` and the Leak KPI's value function.**
- **A scoped tsc with a canary,** plus `typecheck:bos-llm`.

**Verdict: PASS.** The ACs and conditions are met. There are **two Low bugs, both on the Leak block KPI, and one pre-existing Low link finding**. None blocks, but B-1 is a two-line fix worth taking before commit.

#### 1. The page

| Item | Result | Evidence |
|---|---|---|
| `/admin/ai-cost` header, purpose line, Read-only badge, two-line legend, then the Charge checks content | ✅ | `page.tsx`: `AdminPageHeader` "AI cost", the §14 purpose and the `Read-only` badge; the `ai-cost-legend` with **Charged AI cost** and **Recorded AI cost** (two `dt` / `dd` pairs); then `CostsTab`. T-1 render tests are green |
| The admin page gate holds | ✅ | The page sits under `app/admin/layout.tsx`, which calls `requireAdminPage`. `test:authz-guard` passes 203/203. The report and leak routes keep `requireAdmin` first |

#### 2. The strip A-K1 to A-K5

| Item | Result | Evidence |
|---|---|---|
| Five tiles, each with a pill and a definition, money as `$` | ✅ | Probe 2: test ids in order: cost, recorded, above, periods, fallback. Pills: lagging, lagging, leading, leading, leading. Each tooltip carries its `AI_COST_KPI_DEFINITIONS` constant. `$5.241`, `$3` and `$1.759` are shown, with **no "USD + digit"** anywhere. A-K4 is red above 0 |
| A-K1: "At least" on an unreadable amount or the ceiling; Unknown only on a failed read | ✅ | Probe 2: `partial` shows "At least $5.241" and never "Unknown"; `unknown` shows "Unknown", with no `$0`. Probe 1: an unreadable amount makes the route's `chargedInWindow` `partial` |
| A-K3: Unknown whenever the charged side is not exact (DV-4) | ✅ | Probe 1: with an unreadable amount, `aboveCharged.state = 'unknown'`, deep-equal to Finance's `aiCost.recorded`. Probe 2 renders "Unknown" |
| A-K2 links to the real `/admin/analytics`, same whole days and business | ✅ | Probe 2: href `/admin/analytics?range=custom&from=2026-11-01&to=2026-11-09&account=<id>`. `range`, `from`, `to` and `account` are that page's own keys (`analyticsFilters.ts:160, 170`), and its default scope is `bos`, the scope A-K2 counts. No redirect is involved |
| **This month: A-K1 = Finance F-K3 (date-filtering fake)** | ✅ | Probe 1. **All businesses:** route A-K1 `$5.241` = F-K3 `$5.241` = Section 3. The raw figures are equal and so is the printed text (the same `formatUsdSign(…, { maxDecimals: 4 })`). **One business:** `$1.2345` = `$1.2345`. Rows from 31 Oct 23:59:59.999 and earlier are correctly out |

#### 3. C-7

| Item | Result | Evidence |
|---|---|---|
| The recorded block is on Summary & checks | ✅ | `RecordedSection` sits under `#costs-leak` with the Leak check. T-7 render tests are green |
| Finance keeps exactly one "Recorded above charged" line, linking to `/admin/ai-cost?tab=checks…#costs-leak` | ✅ | `RecordedAboveLine` → `aiCostRecordedHref`: `?tab=checks`, the whole-day window, `account` when one is picked, and `#costs-leak`. RU-9, RU-10 and RU-11 tests are green |
| The recorded figures on AI cost equal Finance's for the same window | ✅ | Probe 1: the route's `recorded` is **deep-equal** to Finance's `aiCost.recorded` in every case: This month (recorded $3, above $1.75896, with the deleted accounts left out of the charged side, as R4-9 requires), one business, last month, across the cut-over (`not_available`), before the cut-over, an unreadable amount, and a **failed usage read** (A-K2 and A-K3 Unknown, A-K1 intact). Both sides read the same `[start, end)` span |

#### 4. The Leak KPI "Businesses with uncharged calls"

| Item | Result | Evidence |
|---|---|---|
| Counts only businesses with uncharged calls; never platform accounts | ✅ | Probe 2: findings with uncharged 2, 0 and 1 give **2**. Platform accounts are filtered out of `accounts` server-side (`creditLeakCheck.ts:581`, `!isPlatformAccount`) and reported apart under `platform` |
| "At least" when the run may have missed businesses; "Not run yet" before a run | ✅ | Probe 2: an incomplete account, the deadline or remaining accounts give "At least 1"; `null` gives "Not run yet" |
| **SA Low-1:** "At least 0" when the listing failed and there are no findings | ❌ **Bug B-1 (Low)** | See Issues |

#### 5. Redirects and links

| Item | Result | Evidence |
|---|---|---|
| `/admin/finance/charges` (with its query) → `/admin/ai-cost?tab=checks` | ✅ | `next.config.js`, temporary. Next 14.2.35 merges the query as "initial values, then **destination values**" (`prepare-destination.js:221-227`), so `range`, `from`, `to` and `account` arrive and the destination's `tab=checks` wins. RU-7 config tests are green |
| `business-os-llm?tab=costs` → `/admin/ai-cost?tab=checks` directly | ✅ | Retargeted, so there is no chain. The incoming `tab=costs` is overridden by the destination's `tab=checks` (same merge rule) |
| Finance links, the account summary link, the sidebar | ✅ | `costsHref` and `leakCheckHref` go to `/admin/ai-cost?tab=checks…`; `aiCostRecordedHref` as above; the sidebar "AI cost" entry is `/admin/ai-cost`. A grep finds **no** non-comment `/admin/finance/charges` in `app/`, `lib/`, `components/` or `hooks/` |
| The Health tile | n/a in MK-3a | By the workplan it is MK-3b's (§10, AC-11). In MK-3a it still opens the real `/admin/analytics`, so it relies on no redirect |
| No internal link relies on a redirect | ⚠️ **Finding L-1 (Low, pre-existing)** | See Issues |

#### 6. One read path

| Item | Result | Evidence |
|---|---|---|
| The report route's requests are unchanged | ✅ | Pin C table `64a565e9`, byte-identical (`git diff --quiet HEAD`), and the Pin C suite is green |
| `recordedReads.ts` is the only file naming the usage-log reads | ✅ | Of the finance and report routes, only `recordedReads.ts:116, :125` call `listCostPointsAllAccountsInWindow` / `listCallsInWindow`; the finance route names them in comments only. Other pre-existing callers outside these routes (health summary, account summary, leak check, entitlements report) are untouched. The finance source guard is green, with its third-method control |
| Paging ≤ 1,000 | ✅ | Both reads use their existing limits (`ADMIN_HEALTH_READ_LIMITS`, `TOKEN_USAGE_READ_LIMITS`), and the R-a paging is `CHARGED_LEDGER_READ`. The FF-1d range-cap guard is green |

#### 7. Pins and guards

| Pin | Expected | Got |
|---|---|---|
| Pin A | `4e2a93aa` | ✅ `4e2a93aa`. Case-level diff: exactly the 3 `A2 CostsKpis` cases out and the 5 `A2 AiCostKpis` cases in (62 − 3 + 5 = 64); every other case is byte-identical. Removal proof: `CostsKpis.tsx` no longer exists and nothing imports it |
| Pin C file | `e57f2675` | ✅ `e57f2675`. The diff is the mount target (`/admin/ai-cost?tab=checks&<state>`), the two dead sides removed, and comments |
| Pin C table | `64a565e9` | ✅ unchanged |
| Pin B / Pin D | unchanged | ✅ `a1b3db0c` / `1f7cf07a` |
| AC-173 | unchanged | ✅ `3a1a2dd4` / `b84e0c96` |
| AC-145 | unchanged | ✅ `333407516ae0…2215`. `financeTypes.ts`, `financeHealth.ts` and the finance route test are byte-identical to HEAD, so the finance payload did not change |

#### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/ai-cost` + `app/admin/business-os-llm` | 20/20, **926/926** |
| `app/admin/finance` (Pin B, Pin C, AC-173) | 26/26, **911/911** |
| `app/admin/components` (Pin A, C-14, `BlockKpi`) | 28/28, **923/923** |
| `app/admin/__tests__` (vocabulary, contrast, nav and page guards) | 16/16, **635/635** |
| `lib/business-os/finance` + `lib/business-os/credits` (the finance mode guard, the equality describe) | 57/57, **3277/3277** |
| Credits and finance routes (AC-145) + `lib/admin` (Pin D) | 38/38, **1390/1390** |
| `lib/repositories` (range cap, isolation, importer guards) + `app/admin/analytics` + `app/api/admin/token-usage` | 131/131, **3082/3082** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 308/308, **9264/9264** |
| `npm run lint:hooks` | exit 0 |
| `typecheck:bos-llm` (`NODE_OPTIONS=--max-old-space-size=8192`) | passed: **587 files in scope, 11 errors, 0 new**; exit 0, with no OOM trace |
| Scoped tsc, 555 app and lib files: `app/admin/{ai-cost, business-os-llm, finance, components, __tests__}`, the credits and finance routes, and `lib/business-os/{finance, credits}` | canary `AiCostKpis.tsx(186,7) TS2322`; restored with `cp`, `cmp` identical; clean run **exit 0, 0 errors** |

The totals equal Dev's three groups exactly (90 / 3,395; 95 / 4,667; 131 / 3,082).

#### Issues Found

**Bugs (Low; fix recommended, not blocking):**

1. **B-1: "At least 0" reads as "none found" when the check could not see the businesses.** File: `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx`, `unchargedBusinessesValue`.
   - **What happens.** Probe 2: with `listingFailed: true` and no findings, the KPI reads **"At least 0"**. The same happens with `deadlineReached` / `accountsRemaining: 30` and no findings.
   - **Why it misleads.** The KPI box is the first thing in the Leak panel, above the date fields. The sentence that explains it ("The list of businesses could not be read in full…") appears only in the results further down. "At least 0" is technically true but carries no information, and at a glance a user reads it as "0 businesses with uncharged calls". That is the reassuring answer, on the run least able to give it. On the page's leading leak signal, that is misleading enough to count as a bug, so I agree with SA's Low-1 and would fix it.
   - **Suggested display.** When the run was not complete **and** the count is 0:
     - show **"Unknown"** as the value;
     - add a chip (`BlockKpi` takes one), for example `{ tone: 'warn', label: 'Not every business was checked' }`;
     - or, if a chip is not wanted, use the value "Not every business checked".
     - Keep "At least n" for n ≥ 1, which is informative.
   - **Test.** One case each for `listingFailed` and `deadlineReached` with no findings.
2. **B-2: "Not run yet" after a failed run.** Same file.
   - **What happens.** When the leak route answers with an error, `run()` sets `result` to null, so the KPI says **"Not run yet"** while an error message is shown below. It was run; it failed.
   - **Suggested display.** Show **"Could not check"** (or "Unknown") while `error` is set, and keep "Not run yet" for no attempt.

**Finding L-1 (Low, pre-existing, outside MK-3a's listed links): a live link still relies on a redirect.**
- **Where.** `app/admin/system-config/priceApply.ts:27`, `CREDIT_PRICING_VIEW_URL = '/admin/business-os-llm?tab=costs'`, used by Model pricing's margin-review notice (`MarginReviewNotice.tsx:97`).
- **Effect.** It is unchanged on this branch (price review slice 8, `9111fb77`), and it already relied on the M-5 redirect before MK-3a. It now lands correctly in **one** hop, thanks to the retarget, but it is still a redirect.
- **Suggestion.** Point it at `/admin/ai-cost?tab=checks` (in MK-3a, or with MK-3b's link sweep).
- **Guard.** The new no-old-path guard (G-1) watches `/admin/finance/charges` and `/admin/analytics`, not `business-os-llm?tab=costs`. Adding that address would catch this one.

**Performance:** none measured. The report request now runs the recorded read in parallel, under Finance's 2 s deadline, as SA noted. No timing check was run against production data.

**Info (carried from MK-2):** A-K1 reads This month to the next UTC midnight, while F-K3 reads to `now`. They can differ only by a charge written between the two page reads.

#### User browser steps (signed in as an admin)

1. Open **Money → AI cost** (`/admin/ai-cost`). Expect:
   - the header "AI cost", its purpose line and the **Read-only** badge;
   - the two-line legend (Charged AI cost / Recorded AI cost);
   - then the strip of five tiles, each with a Leading or Lagging pill whose tooltip explains it;
   - amounts in `$`.
2. Open **Finance** in another tab. With **This month** on both, AI cost's **Charged AI cost** equals Finance's "Charged AI cost this month", to the same text.
3. Click **Recorded AI cost**. It opens AI calls & usage on the same dates (and business). Click **Recorded above charged**. It jumps to the recorded block and the Leak check.
4. On Finance, Section 3 shows one line, "Recorded above charged", and its link opens AI cost at the Leak check.
5. **Leak check:** the box reads "Not run yet". Run the check; the box shows the number of businesses with uncharged calls, never counting platform accounts. A partial run shows "At least n".
6. Visit `/admin/finance/charges?range=7d` and `/admin/business-os-llm?tab=costs`. Each lands directly on `/admin/ai-cost?tab=checks`, keeping the window.
7. The sidebar's Money section shows **AI cost** (no Charge checks).

#### Final Status

- [x] All MK-3a ACs and SA-WP-MK3 conditions verified. A-K1 = F-K3 and recorded = Finance, proven on date-filtering fakes. Only the ruled pins moved. Every guard and suite is green, and tsc and `typecheck:bos-llm` are clean. **PASS, ready for RM**, with B-1 (recommended before commit) and B-2 / L-1 as Low follow-ups.
- [ ] Issues found

#### QA fixes (Dev, 2026-10-26)

| Item | Fixed by Dev | Test |
|---|---|---|
| **B-1** | `unchargedBusinessesKpi(result, failed)` replaces `unchargedBusinessesValue`. A run that may have missed businesses (failed listing, deadline, accounts left, incomplete or unchecked accounts) and found none now shows **"Unknown"** with the warn chip **"Not every business was checked"**. With n ≥ 1 it still shows "At least n". A complete run with none shows an exact "0", with no chip | `leakPanel.render.test.tsx`: 3 cases (listing failed, deadline, accounts left), a render case (value and chip, never "At least 0"), a complete-run-zero case |
| **B-2** | While the panel holds an error, the box says **"Could not check"**; "Not run yet" only before any attempt | `leakPanel.render.test.tsx`: a 500 run turns "Not run yet" into "Could not check" |
| **L-1** | `app/admin/system-config/priceApply.ts`: `CREDIT_PRICING_VIEW_URL` = `/admin/ai-cost?tab=checks` (the link carries no window or business, so there are no params to map). The old-address guard G-1 now also refuses `business-os-llm?tab=costs`, in any key order, with planted controls | `priceDecision.render.test.tsx` (ruled: the href); `aiCost.source.guard.test.ts` (G-1 widened, a planted `tab=costs` in two orders, `tab=activity` passes, a comment passes; the margin link pinned) |

Copy (`leakCopy.ts`: `LEAK_KPI_UNKNOWN`, `LEAK_KPI_NOT_ALL_CHECKED`, `LEAK_KPI_COULD_NOT_CHECK`) passes the vocabulary guard. **Re-run:** the business-os-llm, system-config, admin guards, components (Pin A), finance (Pins B and C, AC-173), AI cost, `lib/admin` (Pin D) and the credits and finance routes (AC-145) suites: 140 suites, 4,985 passed. `test:authz-guard`: 203. `test:bos-entitlements`: 9,264. `lint:hooks`: exit 0. Scoped `tsc` on 51 files: 0 errors, and the canary was caught (`LeakCheckPanel.tsx(513,7)` TS2322), then restored with `cmp` identical. **No pin moved:** Pin A `4e2a93aa`, Pin B `a1b3db0c`, Pin C test `e57f2675` and table `64a565e9`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` + `b84e0c96`, AC-145 `33340751…2215`.

## Commit Info

### MK-3a

- **Branch:** `feature/admin-money-mk3-ai-cost-page` (on main `f8d32d60`, which had not moved at commit time; no merge needed)
- **Commit:** `9868bbf6` feat(admin): AI cost page, Summary & checks (MK-3a)
- **Deleted (as listed in Files):** `CostsKpis.tsx`, `app/admin/finance/charges/page.tsx`, `chargeChecks.page.render.test.tsx`, `app/admin/finance/components/BlockKpi.tsx` (moved to `app/admin/components/layout/`)
- **Pins:** Pin A `4e2a93aa`, Pin C file `e57f2675` (ruled); Pin C table `64a565e9`, AC-145 `33340751…`, AC-173, Pin B and Pin D unchanged
- **PR:** [#517](https://github.com/AgentsPilot/neuronforge/pull/517), auto-merge on (merge commit, via the merge queue)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Created (Dev) | MK-3 workplan: Step 0 facts for both pages, design (route, tabs, one window, strip A-K1..A-K5, legend, Leak block KPI, `$`, redirects, links, sidebar, shared `BlockKpi`), C-7 carried in, reads and payload, pin moves, guards, tests, MK3-AC-1 to MK3-AC-16, split into MK-3a / MK-3b, SA-Q-MK3-1 to SA-Q-MK3-12. No code |
| 2026-10-26 | SA workplan review (SA-WP-MK3) | Approved with conditions 1 to 7: SA-Q-MK3-1 to SA-Q-MK3-12 ruled, all defaults held; split MK-3a / MK-3b approved; Pin A re-frozen once per sub-slice; Pin C table byte-identical; AC-145 and AC-173 unchanged; window list differences recorded. Business-question check: none needed (§4, §4.2, §6 item 27, Q-5 / C-6); whole-day 7 and 30 days given to the user as information only |
| 2026-10-26 | SA-WP-MK3 conditions folded in (Dev) | Status set to SA Approved with conditions. §7.1 pin plan per sub-slice: Pin A once per sub-slice with removal proofs; the Pin C table must equal `64a565e9`; dead sides removed in MK-3a; AC-145, AC-173, Pin B and Pin D unchanged and recomputed. §8 adds the third-method planted control. T-12 covers every request each tab makes for each window choice. MK3-AC-17 to MK3-AC-24 added, and the ACs mapped to MK-3a and MK-3b. §11 records the approved split. New Implementation Notes: the conditions table, the window differences from Finance (90 days kept, `since_start` not offered, 24 hours dropped), the user-information line on 7 days, and the Step 0 hash table to fill after MK-2 merges. SA's section unchanged |
| 2026-10-26 | Dev: MK-3a built (uncommitted) | Step 0 on `f8d32d60` (MK-2 merged), all hashes as expected. MK-3a: AI cost page with the legend and A-K1..A-K5; recorded block (C-7) and the Leak block KPI under `#costs-leak`; `BlockKpi` shared; `recordedReads.ts` shared by both routes; report route `recorded`; Finance's one line and links; Charge checks redirect and retarget; sidebar entry. Pin A `5f537869` → `4e2a93aa`, Pin C test `98ea0507` → `e57f2675`; Pin C table, B, D, AC-145, AC-173 unchanged. RU-1 to RU-15, DV-1 to DV-6 (DV-4 for SA). Runs recorded |
| 2026-10-26 | SA code review (SA-CR-MK3A) | Code approved for QA. Conditions 1 to 7 met (Pin A `5f537869` → `4e2a93aa`; Pin C file `98ea0507` → `e57f2675`, table `64a565e9` unchanged; AC-145, AC-173, Pins B and D unchanged). DV-4 satisfies condition 4 (a difference follows R4-9). DV-1 to DV-3, DV-5, DV-6 and both copy changes accepted; MK-3b owes the read lift and one spec, removing `leakCheckHref`, and the "Summary & checks" tab label. Three Low comments, none blocking |
| 2026-10-26 | Dev: QA fixes B-1, B-2, L-1 | The Leak KPI shows Unknown plus a chip when an incomplete run found none, and "Could not check" after a failed run. The margin-review link points straight at `/admin/ai-cost?tab=checks`, and G-1 now refuses `business-os-llm?tab=costs`. Tests added; no pin moved; 140 suites / 4,985 passed; scoped tsc clean |
