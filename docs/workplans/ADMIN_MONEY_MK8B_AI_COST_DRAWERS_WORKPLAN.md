# Workplan: Money MK-8b, the AI cost drawers (Page 2)

> **Last Updated**: 2026-10-26

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-8 row (the Page 2 half); §4.2 drawer column (AI cost → Summary & checks); §8 ("drawers have no buttons except 'Run leak check' (a read)"); Q-7 (accepted); SA-RR-MK SA-5 ("Reuse `useDrawerResource`… no new shared export") and the pins table (MK-8: "AC-145 only if a payload key is added"); FIN NG-1, BD-23; MK-10 user decision 2026-10-25 (rows open like the Businesses rows). Predecessor: [ADMIN_MONEY_MK8_FINANCE_DRAWERS_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK8_FINANCE_DRAWERS_WORKPLAN.md) ("The AI cost business drawer and the billing-period drawer are Page 2")
**Branch:** `feature/admin-money-mk8b-ai-cost-drawers` (from `origin/main` `35c97b4f`, MK-3a #517 merged; worktree `neuronforge-finance-mk8b`). **MK-3b (`feature/admin-money-mk3b-calls-tab`, local commit `5ccb0bd3`) must merge first; origin/main is merged into this branch before any code is written (Step 0).**
**Date:** 2026-10-26
**Status:** SA Approved with conditions (SA-WP-MK8B, 2026-10-26; C-1 to C-6 folded in below; all seven SA-Q defaults approved). **Code Complete (Dev, 2026-10-26), uncommitted**, built on MK-3b's branch (`5ccb0bd3` + `095699ef`, fast-forwarded on the coordinator's instruction before #518 merged); awaiting SA code review. Not pushed: origin/main is merged in after #518 merges
**Path:** Full cycle. No new route, no new repository method, no payload key and no migration. It is full cycle because it moves two tiny row-open pieces into the shared layout folder (SA-Q-MK8B-1, a shared export under LAY R-7) and because it changes money-page tables.

## Overview

The AI cost page's Summary & checks tab gains its two read-only side drawers (Q-7: a quick look from a list, with "Open full view" for the full page):

| Drawer | Opens from | Shows |
|---|---|---|
| **Business drawer** | Leak check result rows (one per business) | That business, for the page's window: Charged AI cost, credits and charges, Recorded AI cost, Recorded above charged, billing periods not matching; its billing periods (whole periods, with the check); and a **Run leak check** for it (the only button, a read, §8). "Open full view" goes to the AI cost page with that business picked |
| **Billing-period drawer** | Period check rows ("Per account and billing period") | One account's one period: stored against rebuilt from rows, figure by figure, with the check; then that business's figures for the window (the same block as the business drawer). "Open full view" goes to the AI cost page with that business picked, at the period check |

Every row that opens a drawer opens **the way a Businesses row opens** (MK-10, user decision 2026-10-25): the shared `OpenRowButton` in a narrow last column with an sr-only "Details" header, label "Open details for …", test id `row-open`, plus a mouse-only row click through the shared `rowOpenTarget`. Focus returns to the row's button on close. Each open sends one request.

Both drawers use **one read**: the existing credit report route, with the business's id and the dates the page is showing. It is byte-for-byte the request the page itself sends when that business is picked (Pin C row 7). It runs only when a drawer opens, so the page's load requests (T-12, Pin C, AC-173) do not change.

---

## Table of Contents

1. [Step 0 code facts](#1-step-0-code-facts)
2. [Design](#2-design)
3. [Files](#3-files)
4. [Files shared with MK-3b](#4-files-shared-with-mk-3b)
5. [Reads and routes](#5-reads-and-routes)
6. [Payload and pins](#6-payload-and-pins)
7. [Guards](#7-guards)
8. [Tests](#8-tests)
9. [Acceptance criteria](#9-acceptance-criteria)
10. [Task list](#10-task-list)
11. [Risks](#11-risks)
12. [Out of scope](#12-out-of-scope)
13. [Open questions for SA](#13-open-questions-for-sa)
14. [Business questions](#14-business-questions)

---

## 1. Step 0 code facts

Checked on `origin/main` `35c97b4f` (MK-3a merged), and on MK-3b's local commit `5ccb0bd3` in worktree `neuronforge-finance-mk3` where marked **[MK-3b]**. They are re-checked after MK-3b merges and origin/main is merged in.

### 1.1 The shared drawer and row-open pieces

| # | Fact | Where |
|---|---|---|
| CF-1 | `useDrawerResource(key, read)`: key `null` = idle, no read; a key set or changed starts ONE read with a fresh `AbortController`; newest wins; close, key change and unmount abort; reopening reads again; no stale frame (the state remembers its key). The page's `read` answers `{ ok, data } \| { ok: false, message }` | `app/admin/components/layout/useDrawerResource.ts` |
| CF-2 | `AdminDrawer` (`open`, `onClose`, `onReturnFocus`, `title`, `titleSuffix`, `testId`), `DrawerSection`, `DrawerFields`, `DrawerField` | `app/admin/components/layout/AdminDrawer.tsx` |
| CF-3 | `OpenRowButton({ label, onOpen, testId })`: icon only, `aria-label` and `title` are the label, 32 by 32 px, hands its button back for focus return | `app/admin/components/layout/OpenRowButton.tsx` |
| CF-4 | `rowOpenTarget(event)`: a row click opens only when the click is not on a control (`ROW_CONTROL_SELECTOR`, which includes `summary`) and not during a text selection, and it opens through the row's `[data-testid="row-open"]` button (`ROW_OPEN_TEST_ID`). Pure | `app/admin/components/layout/rowOpenClick.ts` |
| CF-5 | `ADMIN_TH_OPEN` / `ADMIN_TD_OPEN`, the narrow Open column (LF-8) | `app/admin/components/layout/adminTable.ts:43-45` |
| CF-6 | Finance's MK-8 / MK-10 drawer: `BusinessDrawerProvider` (one drawer, context), `useBusinessRowOpen()` → `{ header, rowProps(target), cell(target, label) }`, `businessTargetOf` (null for platform, deleted, unidentified), `openableRowClass(isOpen)` and `BusinessOpenHeader` (sr-only "Details"). The label is `BUSINESS_DRAWER.openDetails(name)` = "Open details for {name}". It reads `FinancePayload` from the finance route (`drawerReads.ts`) and renders `AccountHeader`, `AccountSummary`, client payments, overdue items and Plan billing | `app/admin/finance/components/BusinessDrawer.tsx`, `app/admin/finance/drawerReads.ts`, `app/admin/finance/financeCopy.ts:830` |
| CF-7 | The Businesses page's opener is the same: "Open details for …", `row-open` | `app/admin/users/page.tsx:670` |

### 1.2 The AI cost page

| # | Fact | Where |
|---|---|---|
| CA-1 | **[MK-3b]** `AiCostView` owns the one URL spec (`useAdminFilters(AI_COST_FILTER_SPEC)`, `hrefFor`), the one report read (`useCostReport`, keyed on window and business only), the strip, and the two tab panels. Summary & checks mounts `CostsTab` with `filters={{ window, account: reportAccountOf(account) ?? '' }}` | `app/admin/ai-cost/components/AiCostView.tsx` |
| CA-2 | **[MK-3b]** `reportSearch(window, account, now)` = `from=…&to=…[&accountId=…]` (whole UTC dates; a linked window → covering days; `system` → all businesses). `reportAccountOf(account)` = the UUID or null. `AI_COST_PATH = '/admin/ai-cost'`; `CALLS_ONLY_RESET` | `app/admin/ai-cost/aiCostFilters.ts` |
| CA-3 | **[MK-3b]** `useCostReport` reads `/api/admin/business-os/credits/report` (`REPORT_URL`) and maps 409 `platform_account` to `COSTS_PLATFORM_ACCOUNT` | `app/admin/ai-cost/useCostReport.ts` |
| CA-4 | **[MK-3b]** `CostsTab` is presentational: bar, states, `ChargedInWindowSection`, `PeriodsSection`, `BreakdownsSection`, `FallbackSection`, `SpreadSection`, then `#costs-leak` with `RecordedSection` and `LeakCheckPanel accountId={filters.account}` | `app/admin/business-os-llm/components/costs/CostsTab.tsx` |
| CA-5 | **[MK-3b]** `AiCostKpis` formats A-K1 to A-K3 through module-private `chargedValue`, `recordedValue`, `aboveTile` (Finance's `formatUsdSign`, 4 decimals, `atLeast`) | `app/admin/business-os-llm/components/costs/AiCostKpis.tsx` |
| CA-6 | `PeriodsSection`: 11 columns (Business, Period start, 8 figure columns, Check), one row per `CostPeriodLine` (`accountId`, `companyName` nullable, `periodStart`, `stored` nullable for an orphan period, `fromRows`, `matches`), a `tfoot` Total row. `CheckCell` shows "matches its rows", "mismatch" (with the rows' line) or "not checked" | `app/admin/business-os-llm/components/costs/CostsSections.tsx` |
| CA-7 | `fromRows` is present for every period whenever the rows were read (`creditReport.ts:393`), not only on a mismatch; `matches` is null when the period could not be checked (`:395`); orphan periods (rows, no totals row) have `stored` null (`:410-421`) | `lib/business-os/credits/creditReport.ts` |
| CA-8 | `FallbackSection` rows carry an `accountId`; review §4.2 gives the fallback list **no drawer** ("—, the list row links to Model pricing") | `CostsSections.tsx`; review §4.2 |
| CA-9 | `LeakCheckPanel({ accountId, accountLabel })`: its own window (yesterday by default, at most 7 days), its own Run button, `GET /api/admin/business-os/credits/leak-check?from&to[&accountId]`, the MK-3a block KPI "Businesses with uncharged calls", a result table of 9 columns with one `AccountRow` per finding (`leak-account-<id>`) plus an optional examples row (`<details>`, `colSpan={9}`). Platform accounts are never findings: they are filtered out (`creditLeakCheck.ts:581`) and reported apart as one line | `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx`, `leakTypes.ts` |
| CA-10 | The credit report route: `requireAdmin` first → strict Zod (`from`, `to`, `accountId` UUID; 92-day cap) → 409 `platform_account` (pure, `isPlatformAccount`, no read) → the reads. With `accountId`, only account-scoped reads run, with the validated id (totals, rows, R-a′, `listCallsInWindow`). No plan-row check, so a business charged without a plan is read normally | `app/api/admin/business-os/credits/report/route.ts` |
| CA-11 | Platform-ness is an env-based server fact (`SYSTEM_ADMIN_USER_ID`, all-zero UUID); the client cannot know it, and `CostPeriodLine` carries no flag | `lib/business-os/llm/callCatalog.ts:282` |
| CA-12 | **[MK-3b]** The Calls tab keeps its existing call drawer; its group-by-business rows drill, they do not open a business | `app/admin/analytics/components/CallsTab.tsx` |
| CA-13 | Pin C's table row 7 is exactly the request a drawer will send from the default window: report `from=2026-10-01&to=2026-10-16&accountId=<PIN_ACCOUNT>`, leak `from=2026-10-15&to=2026-10-15&accountId=<PIN_ACCOUNT>` | `app/admin/finance/__tests__/chargeChecksRequestPins.ts` |

### 1.3 Guards, pins and hygiene

| # | Fact | Where |
|---|---|---|
| CG-1 | The business-os-llm source guard forbids `@/lib/` imports in that folder (other than one named file) and allows `fetch(` in the costs folder only in `LeakCheckPanel.tsx` (G-5). New readers therefore live in `app/admin/ai-cost/` | `app/admin/business-os-llm/__tests__/source.guard.test.ts` |
| CG-2 | **[MK-3b]** `aiCost.source.guard.test.ts` walks `app/admin/ai-cost`, `app/admin/analytics`, the costs folder, `costCopy.ts`, `leakCopy.ts`, `costFormat.ts` for G-2 (no "USD " money string), G-3 (no reserved generic names) and G-4 (no Stripe mode); only `page.tsx` is barred from `fetch(` | `app/admin/ai-cost/__tests__/aiCost.source.guard.test.ts` |
| CG-3 | **[MK-3b]** C-14 registry entry `/admin/ai-cost (AI cost)` lists the page's files; the vocabulary guard has an explicit `FILES` list with per-file counts; contrast `PAGES['AI cost']` walks `app/admin/ai-cost`, the costs folder and `app/admin/analytics` | `layoutFolder.guard.test.ts:734-740`, `aiCostVocabulary.source.guard.test.ts:79-82, 221-224`, `contrast.lf1.source.guard.test.ts:67` |
| CG-4 | Layout folder `EXPECTED_SOURCES` lists `OpenRowButton.tsx` and `rowOpenClick.ts` (files, not exports) | `layoutFolder.guard.test.ts:150, 159` |
| CG-5 | Pin hashes after MK-3b (its workplan's Implementation Notes): Pin A `a130d560`, Pin B `a1b3db0c`, Pin C test `e57f2675` / table `64a565e9`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` + `b84e0c96`, AC-145 `33340751…2215`. T-12 is `app/admin/ai-cost/__tests__/aiCostRequests.render.test.tsx` | MK-3 workplan, MK-3b notes |
| CG-6 | `console.*`: **none** in any file this slice touches (AiCostView, AiCostKpis, CostsSections, LeakCheckPanel, rowOpenClick, OpenRowButton, Finance BusinessDrawer, costCopy, leakCopy) | grep at `5ccb0bd3` |
| CG-7 | Entitlements: no touched file imports `lib/business-os/entitlements/`; the skill's registration does not apply. `npm run test:bos-entitlements` still runs at handover | grep |
| CG-8 | Finance livemode guard: nothing here touches `lib/business-os/finance/**`; the new files name no Stripe mode (G-4 above scans them) | — |

---

## 2. Design

### 2.1 Reuse Finance's business drawer, or a variant? A variant on the same shell

The AI cost business drawer is **its own body on the shared shell**, not Finance's `BusinessDrawer`:

- **Different content (§4.2).** The review's AI cost drawer shows charged and recorded cost, **its billing periods** and **Run leak check**. Finance's drawer shows what the business paid us, AI margin, credits, client payments and overdue items, from `FinancePayload`, which has no billing periods and no Leak check.
- **Different read.** The credit report route with `accountId` returns exactly the AI cost figures (the same computation as the page with that business picked). The finance route would be a heavier read (revenue, takings, payment problems) that still lacks the periods.
- **Same shell.** `AdminDrawer`, `DrawerSection` / `DrawerFields`, `useDrawerResource`, `OpenRowButton`, `rowOpenTarget`, and Finance's provider-and-context shape (one provider, one drawer, a hook that is null without a provider so a standalone table is unchanged). No new shared component; SA-5 holds.

### 2.2 One provider, one drawer, two kinds

`AiCostDrawerProvider` (new, `app/admin/ai-cost/components/AiCostDrawers.tsx`) is mounted by `AiCostView` around the Summary & checks panel. It holds **one** `AdminDrawer` and one target:

```typescript
// app/admin/ai-cost/components/aiCostRowOpen.tsx
export type AiCostDrawerTarget =
  | { kind: 'business'; accountId: string; name: string | null }
  | { kind: 'period'; accountId: string; name: string | null; periodStart: string };
```

- Opening a row sets the target and remembers the opener (focus return, D-6). Opening another row while one is open switches the target (one new read; no stale frame, CF-1).
- **When openers exist.** Only when the page shows all businesses (`reportAccountOf(filters.account) === null`, so `system` counts as all) and a report is on screen. With a business picked the page is already the full view, so no openers and no "Details" column (MK-8 N-5 precedent; SA-Q-MK8B-4).
- **Inside the drawer** the provider value is `null` (a nested `Provider value={null}`), so the drawer's own Leak check result and periods list never render openers. One drawer at a time.
- **C-3 (SA-WP-MK8B).** Openers exist only while a report is on screen **and** all businesses are shown. While the page's report is loading or has failed there are no openers and no drawer read.

### 2.3 The read (both kinds): the credit report for that business, only on open

- **Key:** `from=<report.window.from>&to=<report.window.to>&accountId=<id>`, built in `aiCostDrawerReads.ts` with the same `URLSearchParams` order as `reportSearch`. The dates are **the dates the page is showing** (the response's own `window`), not a fresh `new Date()`, so the drawer and the strip cover exactly the same days, even across midnight UTC. When the window changes, the page's report re-reads, the key changes once the new report lands, and an open drawer reads again (MK-8 behaviour).
- **Request:** `GET /api/admin/business-os/credits/report?<key>`, `cache: 'no-store'`. It equals Pin C row 7 for the default window: the drawer reads exactly what the page would read with that business picked, so the drawer's figures equal the picked page's strip by construction.
- **Answer:** through `readAdminResponse(response, { what, sessionEndedCopy: true })`. A 409 whose message is `platform_account` becomes `COSTS_PLATFORM_ACCOUNT` (the page's own words); anything else is the route's reason or the shared fallback; a throw is `ADMIN_NETWORK_ERROR` (logged with `clientLogger.warn`, never an id). `useCostReport` (MK-3b) is not touched.
- **C-3 / C-4 (SA-WP-MK8B).** The key always uses `report.window` of the report on screen, never a fresh clock. Every failure path shows a shared state inside the drawer (never silent). The `clientLogger.warn` on a network failure carries no account id and no name; an abort logs nothing.
- **Leak check inside the business drawer:** `LeakCheckPanel` with `accountId` = the business, so a press sends the page's own leak request with `accountId` (Pin C row 7's leak literal). Nothing is sent until the button is pressed; closing the drawer unmounts the panel and aborts a run in flight (its existing unmount rule).

### 2.4 Business drawer: contents

Title: the business name, else "Business {short id}" (`formatShortId`).

| # | Section | Content | From |
|---|---|---|---|
| 1 | **AI cost in this window** | Window line "{from} to {to} (UTC)". Fields: Charged AI cost; Credits charged (units, "credits"); Charges; Recorded AI cost (Business OS calls); Recorded above charged (or "None" with the charged-above line, "Not available", "Unknown"); Billing periods not matching ("n of m checked", "Not checked", "Unknown"). "May be incomplete" when the report says so | `data.chargedInWindow`, `data.recorded`, `data.periods`, `data.mismatchedPeriods`, through **the strip's own value functions** (`chargedValue`, `recordedValue`, `aboveTile`, exported from `AiCostKpis.tsx`, SA-Q-MK8B-3), so the drawer prints exactly what the strip prints for that business picked |
| 2 | **Billing periods** | The whole-periods label (`COSTS_WHOLE_PERIODS_LABEL`, same words as the page). A compact list, one line per period: period start, credits, cost (`formatUsd`), charges, and the check chip (matches its rows / mismatch / not checked, the page's tones). An orphan period says "no totals row for this period" (the page's words). No opener inside | `data.periods` |
| 3 | **Leak check** | `LeakCheckPanel` with `accountId` and `accountLabel`, `variant="drawer"`: same controls, intro, verdicts and table, **without the page's block KPI** "Businesses with uncharged calls" (a count of one business is not that KPI; SA-Q-MK8B-5) | its own read, on press only |
| 4 | **Open full view** | Link to `/admin/ai-cost?<hrefFor({ tab: 'checks', …CALLS_ONLY_RESET, account: id })>`: the AI cost page with this business picked, in the same window | the page's `hrefFor` (passed into the provider) |

No other button (§8, NG-1, BD-23): the only controls are Run leak check (a read), the leak window inputs, the examples disclosure, the link and Close.

### 2.5 Billing-period drawer: contents

Title: the business name (or "Business {short id}"), `titleSuffix` "period from {day}".

| # | Section | Content | From |
|---|---|---|---|
| 1 | **This billing period** | The whole-periods label. The check chip. A three-column table: figure, **Stored** (the period's totals row), **Rebuilt from rows** (the ledger rows summed), for credits, owner, scheduled, external, corrections, cost, charges, fallback-priced. A figure that differs is marked (red text plus an sr-only "differs"). Stored missing → "no totals row for this period"; rows not read → "not checked" | **The drawer's own read** (`data.periods`, matched on `accountId` and `periodStart`), not the clicked row (SA-Q-MK8B-6). If the period is not in the new read (the window moved), the section says so |
| 2 | **This business in the window** | Section 1 of the business drawer (the same component) | the same read |
| 3 | **Open full view** | As the business drawer, with `#costs-periods` | `hrefFor` |

No Leak check here (§4.2 gives it to the business drawer only).

**C-5 (SA-WP-MK8B).** A differing figure is marked with text, not colour alone: the sr-only "differs" plus a visible text cue (for example "differs" beside the rebuilt value). Any colour used must pass the contrast guard; never `text-slate-500`. The clicked row supplies the title only, and only while the read loads (SA-Q-MK8B-6 ruling).

### 2.6 Row openers (MK-10 rules), per table

| Table | Opens | Opener | Not opened |
|---|---|---|---|
| **Period check** (`PeriodsSection`) | Billing-period drawer | Narrow last column, sr-only "Details" header; `OpenRowButton` label "Open details for {name}, period from {day}", `row-open`; row click through `rowOpenTarget`; open-row highlight | The `tfoot` Total row (an empty cell keeps the columns aligned); every row when a business is picked; standalone renders (no provider) |
| **Leak check result** (`LeakCheckPanel` → `AccountRow`) | Business drawer | Same; label "Open details for {name}". The examples row's `colSpan` grows from 9 to 10 only when the column is there | The examples row (its own `<tr>`, and `summary` is a control); the platform line (not a row, never a finding, CA-9); the drawer's own Leak check; a run scoped to one business |
| **Fallback list** | — | None (review §4.2) | All rows |
| **Breakdowns, spread, charged block, recorded block** | — | No per-business rows | — |
| **Calls tab** | — (call drawer unchanged) | None | Group-by-business rows keep drilling (CA-12) |

**Platform, deleted and unidentified rows get no opener:**
- **Deleted:** the report drops rows with no account (`creditReport.ts:323`), and the deleted-accounts total is one line in the charged block, not a row. Nothing to open.
- **Platform:** the Leak check never lists one (CA-9). The period table carries no platform flag (CA-11), and a platform account is not expected to have a credit period. If one ever appears and is opened, the read answers 409 and the drawer shows the page's own platform sentence (SA-Q-MK8B-2 asks whether to add a flag instead).
- **Unidentified:** every period and every leak finding has an account id with ledger rows or a plan. A missing name is a name-read gap, not an unknown business, so the opener stays and the label uses the short id.

**C-6 (SA-WP-MK8B).** The examples row's `colSpan` (9 → 10) and the Total row's extra empty cell change **only** when the Details column is present. Standalone renders (no provider) and a picked business keep today's column counts; §8.3 tests both.

**Calls (SA-WP-MK8B).** Nothing is owed: §4.2 gives Calls the call drawer that already exists (`CallsTab.tsx` mounts `AdminDrawer` with `AnalyticsCallDetails`), and §6 item 28 keeps the Calls table unchanged. Businesses-style openers on call rows would be a separate later UI change, not part of MK-8b.

### 2.7 Shared row-open pieces (SA-Q-MK8B-1)

The user asked for "the same button as we have there". To keep one source, the two tiny Finance-local pieces move to the shared layout folder, byte-identical:
- `openableRowClass(isOpen)` → `rowOpenClick.ts` (pure, a class string);
- `BusinessOpenHeader` → `OpenRowButton.tsx` as `OpenRowHeader` (the sr-only "Details" `th`).

Finance's `BusinessDrawer.tsx` imports them from there (its own names kept as re-exports, so no Finance caller changes). **SA-Q-MK8B-1 ruling:** the move is byte-identical; each Finance re-export carries a one-line comment naming the shared source; **nothing new may import the Finance names** (the AI cost files import from the shared folder only). No new file in the shared folder, so `EXPECTED_SOURCES` is unchanged. The AI cost hook `useAiCostRowOpen()` returns the same `{ header, rowProps, cell }` shape as Finance's `useBusinessRowOpen()`.

### 2.8 Rules kept

| Rule | How |
|---|---|
| Read-only (NG-1, BD-23, §8) | No write, no action button; Run leak check is a read |
| Load requests unchanged (T-12, Pin C, AC-173) | Both drawers read only on open; the Leak check only on press |
| `$` (USD-1..6) | Strip-equal values via `formatUsdSign` (4 decimals); lists via `costFormat.formatUsd` (already `$`), as the page does. AI cost is USD by definition: nothing to sum across currencies |
| Credits are units | Shown as credits, never with `$` |
| Repositories only, ≤ 1,000 rows | No new read; the report route's reads are unchanged |
| No Stripe mode | The new files name none (G-4) |
| Generic names (SA-11) | New identifiers are AI-specific (`AiCostDrawer…`, `aiCostDrawer…`) |

---

## 3. Files

### 3.1 Create

| File | Why |
|---|---|
| `app/admin/ai-cost/components/aiCostRowOpen.tsx` | The context, `AiCostDrawerTarget`, `useAiCostRowOpen()` (`header`, `rowProps`, `cell`), null without a provider. Imports only shared layout pieces, so the costs folder can import it without a cycle |
| `app/admin/ai-cost/components/AiCostDrawers.tsx` | `AiCostDrawerProvider`, the one `AdminDrawer`, `BusinessDrawerBody`, `PeriodDrawerBody`, the shared "AI cost in this window" part and the compact periods list |
| `app/admin/ai-cost/aiCostDrawerReads.ts` | `aiCostDrawerKey(window, accountId)`, `readAiCostDrawer(key, signal)` (the one `fetch` of this slice) |
| `app/admin/ai-cost/aiCostDrawerCopy.ts` | Drawer titles, section titles, labels, "Open details for …", "Open full view", "differs", "not in this window any more" |
| `app/admin/ai-cost/__tests__/aiCostDrawerReads.test.ts` | Key, URL, answer mapping |
| `app/admin/ai-cost/__tests__/aiCostDrawers.render.test.tsx` | Drawer bodies, reads, failure paths, read-only |
| `app/admin/ai-cost/__tests__/aiCostRowOpen.render.test.tsx` | Row-open cases per table, through the real page |

### 3.2 Change

| File | Why |
|---|---|
| `app/admin/ai-cost/components/AiCostView.tsx` **[MK-3b]** | Mount `AiCostDrawerProvider` around the Summary & checks panel, with `report?.window`, `enabled` (all businesses) and the full-view href builder from `hrefFor` |
| `app/admin/business-os-llm/components/costs/AiCostKpis.tsx` **[MK-3b]** | Export `chargedValue`, `recordedValue`, `aboveTile` (no render change; Pin A cases unchanged) |
| `app/admin/business-os-llm/components/costs/CostsSections.tsx` | `PeriodsSection`: header, row props, cell, the Total row's extra empty cell |
| `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx` | `AccountRow` opener; examples `colSpan`; optional `variant?: 'page' \| 'drawer'` (default `page`; `drawer` drops the block KPI) |
| `app/admin/components/layout/rowOpenClick.ts` | `openableRowClass` moved in (SA-Q-MK8B-1) |
| `app/admin/components/layout/OpenRowButton.tsx` | `OpenRowHeader` moved in (SA-Q-MK8B-1) |
| `app/admin/finance/components/BusinessDrawer.tsx` | Imports and re-exports the two moved pieces; no behaviour change |
| `app/admin/components/layout/__tests__/rowOpenClick.test.ts`, `OpenRowButton.render.test.tsx` | Cases for the moved pieces |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` **[MK-3b]** | C-14 entry `/admin/ai-cost (AI cost)` gains the four new non-test files |
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` **[MK-3b]** | `FILES` gains `aiCostDrawerCopy.ts` and `AiCostDrawers.tsx`, with their counts |
| Tests that mount the whole AI cost page and count period-table columns (if any) | Ruled update: one more column with all businesses; listed with before and after in the Implementation Notes |

### 3.3 Delete

None.

---

## 4. Files shared with MK-3b

MK-3b (`5ccb0bd3`, 53 files) touches these files that MK-8b also touches. None is edited before MK-3b merges and origin/main is merged in.

| File | MK-3b change | MK-8b change |
|---|---|---|
| `app/admin/ai-cost/components/AiCostView.tsx` | New: the page body, one spec, one report read, tabs | Mounts the drawer provider around the checks panel |
| `app/admin/business-os-llm/components/costs/AiCostKpis.tsx` | `tab` / `tabLink` props, cross-tab targets | Exports three value functions |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | C-14 entry for the page's MK-3b files | Adds the four new files to the same entry |
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | `FILES` and counts for the MK-3b files | Adds the two new files and counts |

Read but not edited (MK-3b files MK-8b depends on): `app/admin/ai-cost/aiCostFilters.ts` (`AI_COST_PATH`, `CALLS_ONLY_RESET`, `reportAccountOf`), `useCostReport.ts` (`REPORT_URL`, the 409 words), `CostsTab.tsx` (unchanged: the openers come through context), `app/admin/ai-cost/__tests__/aiCostRequests.render.test.tsx` (T-12, must stay green unedited), `aiCost.source.guard.test.ts` (its walk picks up the new files with no edit), `app/admin/__tests__/contrast.lf1.source.guard.test.ts` (MK-3b touched it; its `PAGES['AI cost']` walk picks up the new files and must pass unedited; SA-WP-MK8B).

SA-WP-MK8B checked `35c97b4f..5ccb0bd3` against this list: the files both slices edit are exactly the four above.

---

## 5. Reads and routes

| Read | When | New? | Justification |
|---|---|---|---|
| Credit report for one business (`GET …/credits/report?from&to&accountId`) | Drawer open (either kind), once per key | **No**: existing route, existing request shape (Pin C row 7) | The only read that has a business's charged, recorded and period figures for the window. Its guards apply as they are: `requireAdmin` first, strict Zod, 409 platform before any read, account-scoped reads with the validated id only, ≤ 1,000 rows per page with ceilings |
| Leak check for one business (`GET …/credits/leak-check?from&to&accountId`) | Run leak check pressed in the business drawer | **No**: existing route and request shape (Pin C row 7's leak literal) | §4.2: "a button that runs the Leak check for it" |

**No new route, no new repository method, no new table, no migration.** The page still sends one request on load on Summary & checks and two on Calls (T-12).

---

## 6. Payload and pins

**Payloads: unchanged.** No key is added to the credit report response, the leak check response or the finance payload. The wire-type pins (`creditReport.wireTypes.test.ts`, `creditLeakCheck.wireTypes.test.ts`) do not move.

| Pin / baseline | Moves? | Why |
|---|---|---|
| **Pin A** (`KpiStrip.callers.pin.render.test.tsx`, `a130d560` after MK-3b) | No | The drawers use no `KpiTile`; `AiCostKpis` only gains exports, and its render is unchanged |
| **Pin B** (`a1b3db0c`) | No | Finance strip untouched |
| **Pin C** test file (`e57f2675`) and table (`64a565e9`) | No | Load requests and the page's Leak check request are unchanged. The new drawer test **imports** row 7 read-only and asserts the drawer's requests equal it |
| **Pin D** (`1f7cf07a`) | No | Health untouched |
| **AC-145** (`33340751…2215`) | No | Finance payload untouched (MK-8 pins table: "AC-145 only if a payload key is added"; none is) |
| **AC-173** (`3a1a2dd4` + `b84e0c96`) | No | Finance request untouched; Finance's moved helpers render byte-identically |
| **MK-3 T-12** (`aiCostRequests.render.test.tsx`) | No | It pins every **load** request per tab and window; a drawer read runs only on open. The file stays byte-identical |
| C-14 registry, vocabulary `FILES` | Ruled list updates (§3.2) | New files registered |

All hashes are recomputed at Step 0 (after MK-3b) and at handover, and recorded in the Implementation Notes. **If any pin above moves, stop and ask SA.**

**C-2 (SA-WP-MK8B).** Pins A to D, AC-145, AC-173, the Pin C file and table, and T-12 must be byte-identical. Pin A must stay `a130d560` after the `AiCostKpis` exports (SA-Q-MK8B-3); the drawer calls those functions and never copies their logic. The drawer test imports Pin C row 7 read-only. The C-14 entry and the vocabulary `FILES` change by ruling only, with before and after recorded in the Implementation Notes.

---

## 7. Guards

| Guard | MK-8b |
|---|---|
| `requireAdminPage` / `requireAdmin` | No new page or route; the page sits under `app/admin/layout.tsx`; the two routes keep `requireAdmin` first. `test:authz-guard` run |
| Repositories only, ≤ 1,000 rows (FF-1d) | No new read; run unchanged |
| Tenant isolation | The drawer sends only the clicked row's id, the route's existing isolation applies (account-scoped reads with the validated id) |
| business-os-llm source guard (no `@/lib/`, G-5 fetchers) | `CostsSections.tsx` and `LeakCheckPanel.tsx` gain no `@/lib/` import and no `fetch(`; they import `@/app/admin/ai-cost/components/aiCostRowOpen` and shared layout pieces only. The reader is in `app/admin/ai-cost/` |
| `aiCost.source.guard` (G-2 USD, G-3 generic names, G-4 mode) | The new files are in its walk; must pass unedited |
| Vocabulary guard | New files added to `FILES`; drawer figures keep "Charged AI cost" and "Recorded AI cost" |
| Contrast guard | Walks the folder; new text uses `text-slate-300/400`, never `text-slate-500` |
| C-14 registry / layout folder | Entry updated; `EXPECTED_SOURCES` unchanged (no new shared file) |
| Finance source guards, livemode guard | Unaffected (no `lib/business-os/finance/**` change); run |
| `test:bos-entitlements`, `lint:hooks`, scoped `tsc` with a canary, `typecheck:bos-llm` (8 GB heap, checked for an OOM trace) | Run at handover |

---

## 8. Tests

### 8.1 Reads (`aiCostDrawerReads.test.ts`)

- The key is `from=…&to=…&accountId=…` from the given window, in `reportSearch`'s order; a custom and a linked-covering window keep their dates.
- 200 → `{ ok: true, data }`; 409 `platform_account` → the page's platform sentence; 400 with a reason → that reason; 401 / 403 → the session-ended words; 500 with no body → the shared fallback; a throw → `ADMIN_NETWORK_ERROR`, with a warn log carrying no id; an abort logs nothing.

### 8.2 Drawers (`aiCostDrawers.render.test.tsx`)

Happy path:
- Business drawer: one request, equal to Pin C row 7's report literal; title is the name (or "Business {short id}"); section 1 values equal what `AiCostKpis` prints for the same payload (charged, "At least" on `partial`, recorded, above "None" / "Not available" / "Unknown", periods not matching); credits shown as credits; the periods list with each chip and the orphan line; "Open full view" href is `/admin/ai-cost?account=<id>…` in the same window, with no Calls keys.
- Leak check in the drawer: no request until Run; Run sends one request equal to Pin C row 7's leak literal; no block KPI; no openers in its result.
- Period drawer: one request (same literal); stored and rebuilt columns for each figure; a mismatching figure is marked; the business-in-window section; the link carries `#costs-periods`.
- Read-only: the drawer's buttons are only Run leak check (business drawer), Close and the examples disclosure.

Failure paths:
- 500 → the shared `AdminError` in the drawer; the page behind it unchanged.
- 409 → the platform sentence as `AdminNotice`.
- Network failure → `ADMIN_NETWORK_ERROR`.
- Period not in the new read → the "not in this window any more" line.
- Close during a read → nothing set afterwards; reopen reads once more.
- Window change while open → exactly one new read; never the old figures under the new window (no stale frame).
- `chargedInWindow.status = 'unknown'` and `recorded.status = 'unknown'` → "Unknown" on those fields only.

### 8.3 Row open per table (`aiCostRowOpen.render.test.tsx`, the real `AiCostView`)

| Case | Period table | Leak result |
|---|---|---|
| Load sends exactly the T-12 requests (no drawer read) | ✅ | ✅ (and no leak request until Run) |
| A narrow last column with sr-only "Details", each row a `row-open` button labelled "Open details for …" | ✅ ("…, period from {day}") | ✅ |
| Button click opens the right drawer for the right business: one more request, with that row's id | ✅ (second business, not the first) | ✅ |
| Row click (on a plain cell) opens the same drawer, one request, through the button | ✅ | ✅ |
| Click on a control inside the row does not open (and a button click opens once, not twice) | ✅ | ✅ (the examples `summary`) |
| A click while text is selected in the row does not open | ✅ | ✅ |
| Escape closes; focus returns to that row's button, whichever path opened it | ✅ | ✅ |
| Open-row highlight on the open row only | ✅ | ✅ |
| No opener: Total row (period); examples row and platform line (leak) | ✅ | ✅ |
| Business picked: no column, no opener, column count as today | ✅ | ✅ |
| Name missing: label uses the short id | ✅ | ✅ |
| Opening a second row while open: one more request, the new title | ✅ | ✅ |

Plus: the fallback list, breakdowns and spread have no `row-open`; the Calls tab has no business opener.

### 8.4 Shared pieces

- `rowOpenClick.test.ts`: `openableRowClass(true/false)` returns the exact strings Finance used.
- `OpenRowButton.render.test.tsx`: `OpenRowHeader` renders a `th` with the shared class and an sr-only "Details".
- Finance's existing render tests (`financePage.render.test.tsx`, `financeDrawers.render.test.tsx`) run **unedited** as the proof the move is byte-identical.

### 8.5 Runs at handover

`app/admin/ai-cost`, `app/admin/business-os-llm`, `app/admin/analytics`, `app/admin/finance`, `app/admin/components`, `app/admin/__tests__`, `app/admin/users` (the Businesses row open), `app/api/admin/business-os/credits`, `app/api/admin/business-os/finance` (AC-145), `lib/business-os/credits`, `lib/admin` (Pin D), `lib/repositories` (range cap), `test:authz-guard`, `test:bos-entitlements`, `lint:hooks`, scoped `tsc` with a canary, `typecheck:bos-llm`, and the full gate once (the known Windows-only failures named).

---

## 9. Acceptance criteria

| ID | Criterion |
|---|---|
| MK8B-AC-1 | On Summary & checks with all businesses, every period-check row and every Leak check result row has the Businesses page's opener: a narrow last column with an sr-only "Details" header, an `OpenRowButton` labelled "Open details for …" with test id `row-open` |
| MK8B-AC-2 | A mouse click anywhere on such a row opens its drawer through that row's button (`rowOpenTarget`), never on a control inside the row and never while text is selected; the row has no tabIndex, role or ARIA of its own |
| MK8B-AC-3 | Each open sends exactly one request: the credit report route with that row's account id and the dates the page shows, equal to Pin C row 7 for the default window |
| MK8B-AC-4 | The page's load requests are unchanged on both tabs: T-12 (`aiCostRequests.render.test.tsx`) and the Pin C test pass unedited |
| MK8B-AC-5 | The business drawer shows that business's Charged AI cost, credits, charges, Recorded AI cost, Recorded above charged and billing periods not matching, printed exactly as the strip prints them for that business picked; its billing periods with the check; and a Run leak check that sends nothing until pressed and then one leak request for that business |
| MK8B-AC-6 | The billing-period drawer shows one account's one period, stored against rebuilt from rows, figure by figure, with differences marked, plus that business's figures for the window |
| MK8B-AC-7 | Both drawers are read-only: no button other than Run leak check (business drawer), Close and the examples disclosure; no write route is called |
| MK8B-AC-8 | "Open full view" goes to `/admin/ai-cost` with that business picked, in the same window, on Summary & checks (at `#costs-periods` from the period drawer) |
| MK8B-AC-9 | Escape or Close returns focus to the row's button, whichever path opened it; opening another row switches the drawer with one request and no stale figures |
| MK8B-AC-10 | No opener on: the period Total row, the leak examples row, the platform line, the fallback list, breakdowns, spread, the Calls tab, anything inside a drawer, and any row while a business is picked |
| MK8B-AC-11 | Failure paths show the shared states inside the drawer: route reason or fallback, the platform sentence on 409, the session-ended words on 401 / 403, the network sentence on a throw |
| MK8B-AC-12 | Every amount shows `$`, credits show as credits, nothing is added across currencies, and no new file names a Stripe mode or a reserved generic cost name |
| MK8B-AC-13 | No new route, repository method, payload key or migration; Pins A to D, AC-145 and AC-173 hashes equal origin/main's after MK-3b |
| MK8B-AC-14 | Finance's rows open exactly as before: the moved `openableRowClass` and "Details" header render byte-identically and Finance's render tests pass unedited |
| MK8B-AC-15 | The guards of §7 pass, with the C-14 entry and vocabulary `FILES` updated by ruling; no touched file has `console.*` |

---

## 10. Task list

- ✅ Step 0: after MK-3b merges, merge origin/main into this branch; re-check CF-1 to CG-8; record every pin hash (§6); run T-12 and Pin C green before any edit
  - **C-1 (SA-WP-MK8B):** the coordinator gives the go; then `git fetch` and `git merge --ff-only origin/main`. Re-check §1 and §4. If MK-3b's review changed the shape of `AiCostView`, the props of `AiCostKpis`, or the three value functions, record the change here and re-confirm SA-Q-MK8B-3 with SA before editing
- ✅ Step 1: move `openableRowClass` and `OpenRowHeader` to the shared folder; Finance re-exports; shared tests; Finance suites unedited and green
- ✅ Step 2: `aiCostDrawerReads.ts`, `aiCostDrawerCopy.ts`; read tests (§8.1)
- ✅ Step 3: `aiCostRowOpen.tsx`, `AiCostDrawers.tsx` (provider, both bodies); export the three value functions from `AiCostKpis.tsx`; drawer tests (§8.2)
- ✅ Step 4: openers in `PeriodsSection` and `LeakCheckPanel` (plus `variant`); mount the provider in `AiCostView`; row-open tests (§8.3)
- ✅ Step 5: guard list updates (C-14, vocabulary); ruled column-count updates, if any
- ✅ Step 6: runs (§8.5), pins re-checked, Implementation Notes

**Estimate:** about 1.5 to 2 days (shared move 0.25, reads and drawers 0.75, openers 0.25, tests 0.5, runs 0.25).

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | MK-3b changes again in review before it merges (AiCostView, AiCostKpis, guard lists) | No edit before the merge; Step 0 re-checks §1 and §4 |
| R-2 | A drawer read on load would break T-12 and Pin C | The key is null until a row is opened; T-12 and Pin C run unedited; the row-open test asserts the load requests first |
| R-3 | The drawer and the strip disagree around midnight UTC | The key uses the dates of the report on screen, not a fresh clock |
| R-4 | A platform account appears in the period table | Not expected (CA-9, CA-11); a 409 shows the page's platform sentence. SA-Q-MK8B-2 offers a payload flag instead |
| R-5 | The examples row's `colSpan` and the Total row drift by one when the column is added | Both covered in §8.3; the standalone renders (no provider) keep today's counts |
| R-6 | Moving the Finance pieces changes Finance rendering | Byte-identical move; Finance tests unedited as proof (MK8B-AC-14) |
| R-7 | The Leak check's 9-column table is wide in a drawer | It sits in the shared table wrap (horizontal scroll), as on the page; one business means one row |
| R-8 | `CostsSections.tsx` / `LeakCheckPanel.tsx` importing from `app/admin/ai-cost/` creates a cycle | The context lives in its own file that imports only shared layout pieces; the provider file imports it, never the reverse |

---

## 12. Out of scope

- Finance's drawers (MK-8, shipped) and any change to their content.
- Openers on the fallback list (review §4.2: none), the Calls tab's group-by-business rows and the call drawer (unchanged).
- Any new money source, write, Stripe call or FX (FIN NG-1 to NG-4); the Leak check's own rules, window or route.
- Changing the breakdowns or spread from whole periods to the window.

---

## 13. Open questions for SA

| # | Question | My recommended default |
|---|---|---|
| SA-Q-MK8B-1 | "The same button as there": move Finance's `openableRowClass` and the sr-only "Details" header into the shared layout folder (existing files `rowOpenClick.ts` and `OpenRowButton.tsx`, Finance re-exports), or keep AI cost-local copies with an equality test, or import them from Finance's `BusinessDrawer.tsx`? | **Move them** (one source, as MK-10 made `rowOpenTarget` shared so the pages cannot drift). No new shared file; a shared export under LAY R-7, so full cycle. Importing from Finance's drawer would pull its Plan billing module into the AI cost bundle |
| SA-Q-MK8B-2 | Period rows cannot tell a platform account (an env fact). Rely on "not expected" plus the drawer's 409 platform sentence, or add a `platform` flag to `CostPeriodLine` (a payload key; the credits wire-type pins move)? | **No flag.** Charges are on business accounts and the Leak check already filters platform accounts; the 409 path shows the page's own words. A flag is a payload change for a case not seen |
| SA-Q-MK8B-3 | Export `chargedValue`, `recordedValue`, `aboveTile` from `AiCostKpis.tsx` so the drawer prints exactly as the strip, or move them into a pure module? | **Export them** in place (smallest change; Pin A unchanged because the render is unchanged) |
| SA-Q-MK8B-4 | With a business picked, no openers at all (MK-8 N-5), or keep the period openers for the stored-against-rebuilt view? | **No openers when picked**: the page is then the full view, and the period table already shows the rows' figures on a mismatch |
| SA-Q-MK8B-5 | The Leak check in the business drawer: reuse `LeakCheckPanel` with `variant="drawer"` that drops the page's block KPI ("Businesses with uncharged calls" is a count over businesses, not one business's figure)? | **Yes**; everything else in the panel unchanged |
| SA-Q-MK8B-6 | The period drawer's stored and rebuilt figures: from the drawer's own read (one source for both sections; exact for one account, and follows a window change), or from the clicked row (instant, but possibly from an all-accounts read that stopped at a ceiling)? | **The drawer's own read**; the clicked row gives only the title while it loads |
| SA-Q-MK8B-7 | "Open full view": the AI cost page with that business picked (same window, Summary & checks), as a plain link like MK-8's, rather than also linking Finance's picked-business page? | **AI cost page only**, plain link; Finance's full view stays reachable from Finance |

**SA rulings (SA-WP-MK8B, 2026-10-26):** all seven defaults approved as written; the ruling details are in SA Review Notes and are folded into §2.2, §2.3, §2.5, §2.6, §2.7, §6 and §10 (C-1 to C-6).

---

## 14. Business questions

**None.** Every visible element is decided in the review: the drawers and their contents (§4.2, accepted with "agree with all recommendations"), the only button "Run leak check" (§8), the quick look with "Open full view" (Q-7), no drawer on the fallback list (§4.2), the call drawer only on Calls (§4.2), and the row-open behaviour (MK-10, user decision 2026-10-25). The choices in §13 are technical (where code lives, which read feeds a figure) or follow an existing precedent (MK-8 N-5).

---

## Implementation Notes

**Built to the approved workplan and SA-WP-MK8B C-1 to C-6.** Uncommitted, on `feature/admin-money-mk8b-ai-cost-drawers`.

**Step 0 / C-1.** On the coordinator's instruction (2026-10-26), I ran `git fetch` and then `git merge --ff-only origin/feature/admin-money-mk3b-calls-tab` (HEAD `095699ef`) before #518 merged. `095699ef` changes docs only (the review §12 row, the MK-3b retrospective and the MK-3 workplan), so `AiCostView`, the `AiCostKpis` props and the three value functions are exactly as planned against `5ccb0bd3`. **Nothing changed, so SA-Q-MK8B-3 needed no re-confirmation.** §1 and §4 hold. The baseline pins equal the table in §6, and T-12 is `c2891a35`.

**Files.**
- **New:**
  - `app/admin/ai-cost/components/aiCostRowOpen.tsx`
  - `app/admin/ai-cost/components/AiCostDrawers.tsx`
  - `app/admin/ai-cost/aiCostDrawerReads.ts`
  - `app/admin/ai-cost/aiCostDrawerCopy.ts`
  - tests: `aiCostDrawerReads.test.ts` (9 cases) and `aiCostDrawers.render.test.tsx` (16 cases)
- **Changed:**
  - `AiCostView.tsx`: the provider around Summary & checks.
  - `AiCostKpis.tsx`: the exports.
  - `CostsSections.tsx`: the period opener, plus `PeriodCheckChip`.
  - `LeakCheckPanel.tsx`: the row opener and `variant`.
  - `rowOpenClick.ts` and `OpenRowButton.tsx`: the shared move.
  - Finance's `BusinessDrawer.tsx`: re-exports, each with a one-line comment.
  - Two shared test files.
  - The C-14 entry and the vocabulary `FILES` (ruled).

**Deviations, for SA:**

| # | Planned | Built | Why |
|---|---|---|---|
| DV-1 | Export three value functions from `AiCostKpis.tsx` (SA-Q-MK8B-3) | The three, **plus a fourth, `periodsTile(report)`**, extracted from the component body (A-K4's value, its "of n checked" line and its red rule). The component now calls it | The drawer shows "Billing periods not matching" (§2.4). SA's C-2 says to call the strip's logic and never copy it, and that logic lived inline. The render is unchanged and Pin A is still `a130d560` |
| DV-2 | Reuse the page's check chip | `PeriodCheckChip({ matches })` extracted and exported from `CostsSections.tsx`. `CheckCell` uses it, and the drawer reuses it | Same words, tones and test ids, with no copy. The page markup is unchanged and the costs suites are green |
| DV-3 | C-5: an sr-only "differs" plus a visible text cue | A **visible** word "(differs)" in `text-red-300` beside the rebuilt value | A visible word is the text cue and is read by screen readers too. An extra sr-only copy would make it read twice. It is not colour alone, and the contrast guard passes |
| DV-4 | — | `AiCostDrawerProvider` takes `pageError`. If the page's report fails while a drawer is open, the drawer shows that error instead of loading forever | C-4: never silent. C-3 makes the key null whenever there is no settled report |
| DV-5 | Separate `aiCostRowOpen.render.test.tsx` (§3.1) | The row-open cases are in `aiCostDrawers.render.test.tsx`, through the real page | Same harness and fixtures. The §8.3 cases are all there |
| DV-6 | "Nothing new may import the Finance names" (Q-1 ruling) | Product code: nothing does. **Two shared-folder tests do** (`rowOpenClick.test.ts`, `OpenRowButton.render.test.tsx`), to assert that Finance's names are the shared function and component themselves (`toBe`) | This proves the re-export is not a copy (MK8B-AC-14). The layout folder guard passes. If SA prefers, these can move to a Finance test |

**C-3 as built.** The drawer window is `report.window` only when the report has settled (`report && !loading && !error`) and every business is shown (`reportAccountOf(account) === null`, so `system` counts). Otherwise the context is null: there are no openers, no Details column and no read. During a re-read the column goes away until the new report lands.

**Pins (LF-normalised SHA-256, at handover). All byte-identical, and no pin file is in the diff:**
- Pin A: `a130d560`
- Pin B: `a1b3db0c`
- Pin C: test `e57f2675`, table `64a565e9`
- Pin D: `1f7cf07a`
- AC-173: `3a1a2dd4` + `b84e0c96`
- AC-145: `33340751…2215`
- T-12 (`aiCostRequests.render.test.tsx`): `c2891a35`

T-12, the Pin C test and Pin A pass unedited (3 suites, 109 tests). The drawer test imports Pin C row 7 read-only: the drawer's report request and its Leak check request equal row 7.

**Ruled baselines:**
- C-14 `/admin/ai-cost (AI cost)` entry: 22 → 26 files (the four new non-test files).
- Vocabulary `FILES`: 21 → 23, with `AiCostDrawers.tsx` at 22 texts and `aiCostDrawerCopy.ts` at 31, measured with the guard's own scanner.
- `EXPECTED_SOURCES` is unchanged.

**Runs:**

| Run | Result |
|---|---|
| `app/admin/ai-cost`, `business-os-llm`, `analytics`, `finance`, `components`, `app/admin/__tests__` (guards), `users`, `lib/admin`, the credits and finance routes | 169 suites, 5,816 passed |
| `app/admin/ai-cost` alone | 7 suites, 189 passed |
| `npm run test:authz-guard` | 2 suites, 203 passed |
| `npm run test:bos-entitlements` | 308 suites, 9,264 passed |
| `npm run lint:hooks` | exit 0 |
| Scoped tsc (116 app files: the ai-cost folder, the costs components, the shared layout folder, Finance components and the touched tests; 8 GB heap) | 0 errors, no OOM trace. The canary in `AiCostDrawers.tsx` gave `(291,14) TS2322`; the file was restored and `cmp` identical |

`typecheck:bos-llm` was not run: no wire type changed.

**Logging.** No touched or new file calls `console.*`. The one match, in `layoutFolder.guard.test.ts:443`, is that guard's planted control string.

---

## SA Review Notes

_SA populates this section._

### SA Workplan Review (SA-WP-MK8B)

**Reviewed by SA — 2026-10-26**
**Status:** ✅ Approved with conditions (C-1 to C-6). Do not edit any code until MK-3b has merged and Step 0 is done.

**Fit.** The design fits the codebase:
- **Drawers:** a variant body on the shared drawer shell, Finance's provider-and-context shape, `useDrawerResource`, and one existing read on open. That is SA-5 as ruled.
- **Request:** the drawer's request is Pin C row 7 byte for byte, so the drawer and the picked page agree by construction.
- **No backend change:** no route, repository method, payload key or migration.
- **Placement:** the reader lives in `app/admin/ai-cost/`, which keeps the business-os-llm source guard (CG-1, G-5) intact.
- **409 answer:** I checked `readAdminResponse`. It returns the route's `error` verbatim together with the status, so `platform_account` on a 409 can be mapped to the page's sentence as planned.

**Rulings on §13**

| # | Ruling |
|---|---|
| SA-Q-MK8B-1 | **Move them, approved.** `openableRowClass` goes to `rowOpenClick.ts` and the sr-only "Details" header goes to `OpenRowButton.tsx` as `OpenRowHeader`, both byte-identical. No new file, so `EXPECTED_SOURCES` does not change. These are shared exports, so the full cycle applies, as already planned. Finance may keep its two old names as re-exports so its callers and tests stay unedited (MK8B-AC-14). Each re-export carries a one-line comment naming the shared source, and nothing new may import the Finance names. Importing from Finance's `BusinessDrawer.tsx` is rejected, for the bundle reason Dev gives. |
| SA-Q-MK8B-2 | **No flag, approved.** A payload key would move the credits wire pins for a case that has not been seen. The 409 path already shows the page's own words, and the Leak check never lists a platform account. |
| SA-Q-MK8B-3 | **Export in place, approved.** It is an export only, with no render change. Pin A must stay `a130d560`; if it moves, stop. The drawer must call these functions, never copy their logic. |
| SA-Q-MK8B-4 | **No openers when a business is picked, approved.** This follows the MK-8 N-5 precedent. |
| SA-Q-MK8B-5 | **`variant="drawer"` without the block KPI, approved.** It is optional, it defaults to `page`, and nothing else in the panel changes. |
| SA-Q-MK8B-6 | **The drawer's own read, approved.** The clicked row supplies the title only, and only while the read loads. |
| SA-Q-MK8B-7 | **AI cost page only, as a plain link, approved.** |

**The call drawer on Calls (TL question).** §4.2's Calls row gives the side drawer as "**Call drawer** (exists today): one call's details", and §6 item 28 says "AI cost → **Calls** (unchanged)". That drawer exists: `CallsTab.tsx` mounts `AdminDrawer` with `AnalyticsCallDetails`, carried over by MK-3b. §4.2 needs **nothing new**, so it is **not in MK-8b**, and the workplan is right to plan none.
- The MK-10 rule (user comment 2026-10-25) was written for Finance's business rows. §4.2 and item 28 keep the Calls table unchanged, so giving call rows the Businesses-style opener is not owed.
- If the user later wants call rows to open the same way, that is a separate small UI change, not part of this slice. It is not a question for now.

**Business questions: none.** I agree with §14. The drawers, their contents, the only button (§8), "Open full view" (Q-7), no drawer on the fallback list, and the row-open behaviour (MK-10) were all decided and approved. §13 is technical.

**MK-3b overlap list: checked, and complete.** I compared `35c97b4f..5ccb0bd3` with MK-8b's change list. The files both slices edit are exactly the four in §4. MK-3b also touched `contrast.lf1.source.guard.test.ts` and `aiCost.source.guard.test.ts`, but MK-8b only needs them to pass unedited. Add the contrast guard to §4's "read but not edited" line. `CostsSections.tsx`, `LeakCheckPanel.tsx`, `rowOpenClick.ts`, `OpenRowButton.tsx` and Finance's `BusinessDrawer.tsx` are not in MK-3b.

**Conditions**
1. **C-1 Step 0.** After MK-3b merges, merge origin/main in and re-check §1 and §4. If MK-3b's review changed the shape of `AiCostView`, the props of `AiCostKpis`, or the three value functions, record the change and re-confirm SA-Q-MK8B-3 before editing.
2. **C-2 No pin moves.** Pins A to D, AC-145, AC-173, the Pin C file and table, and T-12 must be byte-identical. The drawer test imports Pin C row 7 read-only. If any of them moves, stop and ask SA. The C-14 entry and the vocabulary `FILES` change by ruling, with before and after recorded.
3. **C-3 Openers exist only when a report is on screen and all businesses are shown.** The drawer key uses the window of the report on screen (`report.window`), never a fresh clock. While the page's report is loading or has failed, there are no openers and no drawer read.
4. **C-4 Never silent and no ids in logs.** Every failure path in §8.2 shows a shared state inside the drawer. The `clientLogger.warn` on a network failure carries no account id and no name. An abort logs nothing.
5. **C-5 Marking differences.** In the period drawer a differing figure is marked with text, not colour alone: the sr-only "differs" plus a visible text cue. The colour must pass the contrast guard; never `text-slate-500`.
6. **C-6 Column counts.** The examples row's `colSpan` and the Total row's extra cell change only when the Details column is present. Standalone renders and a picked business keep today's counts, and §8.3 tests both.

### Approval
[x] Workplan approved, with conditions C-1 to C-6. Estimate of 1.5 to 2 days accepted. Proceed after MK-3b merges.

### SA Code Review (SA-CR-MK8B)

**Code Review by SA — 2026-10-26** (uncommitted tree on `095699ef`, MK-3b's commits)
**Status:** ✅ Code Approved

**Conditions**

| # | Verdict |
|---|---|
| C-1 | ✅ Step 0 was re-checked on `095699ef`. Over `5ccb0bd3` that commit adds only docs, and `AiCostView`, the props of `AiCostKpis` and the value functions are as ruled. **Before the PR:** when #518 merges, merge origin/main in and re-run T-12 and Pin C. |
| C-2 | ✅ No pin moved. Pin A `a130d560`, Pin B, Pin C `e57f2675` / `64a565e9`, Pin D, AC-145, AC-173 and T-12 `c2891a35` are all unchanged. The only baselines that moved are the two ruled lists: the C-14 entry (22 → 26) and the vocabulary `FILES` (21 → 23). |
| C-3 | ✅ `drawerWindow` is non-null only when there is a report, it is not loading, there is no error and no business is picked (`reportAccountOf(...) === null`). When it is null, the context is null too, so no openers and no key. The key uses `report.window`, never a clock. A drawer read cannot happen at load. |
| C-4 | ✅ Every failure shows something: idle or loading shows `AdminLoading`, a 409 shows the platform notice, other failures show `AdminError`, a page failure shows `pageError` (DV-4), and a period gone from the window shows its line. The single `logger.warn({ err })` carries no id and no name, and an abort logs nothing. |
| C-5 | ✅ See DV-3. |
| C-6 | ✅ The extra Details column appears only when `opener` is set: the header, the row cell, the Total row's empty `<td />`, and `colSpan` 10 instead of 9. Standalone tables, picked-business tables and anything inside a drawer (where the context is null) keep today's counts. |

**Guards and standards**
- **Read-only:** the only buttons are Run leak check, the leak inputs and disclosure, the link and Close.
- **No backend change:** no route, repository method, payload key or migration. The one `fetch` is in `app/admin/ai-cost/aiCostDrawerReads.ts`. The business-os-llm folder gains no `@/lib/` import and no `fetch(` (G-5 holds).
- **No import cycle:** `aiCostRowOpen.tsx` imports only shared pieces, `costFormat` and its copy.
- **Money:** `$` comes through the strip's own functions and `formatUsd`. Credits are shown as units. Nothing is summed across currencies, and there is no Stripe mode.
- **Contrast:** slate-400/300, red-300 and purple-300 only; no slate-500.
- **Tenant isolation:** only the clicked row's id is sent, and the route's validation and account-scoped reads apply.
- **Shared move:** byte-identical. Finance keeps commented re-exports, and Finance tests are unedited.
- **`typecheck:bos-llm`:** not required, because no wire type changed.

**Rulings on the deviations**

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** `periodsTile` is the same extraction as SA-Q-MK8B-3, and the drawer must print A-K4 the way the strip does. The render is unchanged and Pin A still matches, which proves it. |
| DV-2 | **Accepted.** `PeriodCheckChip` is a single source for the chip. The page markup and test ids are unchanged. |
| DV-3 | **Accepted. It meets C-5 better than my wording did.** A visible word is the text cue and is read aloud once. An added sr-only copy would be read twice. |
| DV-4 | **Accepted.** It is required by C-4, so the drawer never waits silently on a failed page read. |
| DV-5 | **Accepted.** Same harness, and every §8.3 case is present. |
| DV-6 | **Accepted.** Tests that import the old Finance names to prove they are the shared ones are the proof Q-1 asked for. Product code imports only the shared names. |

### Code Review Comments
1. `AiCostDrawers.tsx`: the platform case is recognised by comparing the message text with `COSTS_PLATFORM_ACCOUNT`. That works, but it ties behaviour to the wording. If the read ever gains a `kind`, switch on that instead. Low; does not block.
2. "Open full view" is a plain `<a>`, so it loads the whole page again rather than navigating client-side. That matches MK-8's link and the Q-7 ruling, so it is accepted. Note for QA only.

### Code Approved for QA: Yes

## QA Testing Report

### QA — MK-8b, 2026-10-26

**Worktree:** `neuronforge-finance-mk8b`, branch `feature/admin-money-mk8b-ai-cost-drawers` on `f683d49f` (MK-3b merged), uncommitted. The source has been stable since 22:00, before every run below.

| | |
|---|---|
| **Test mode** | full |
| **Focus** | ui |
| **Skipped** | the live page (user, below) |
| **Input source** | the coordinator's list, MK8B-AC-1 to 15, SA-WP-MK8B C-1 to C-6 |

**Strategy used:**
- **A + B:** every suite and guard, each run alone. The combined group equals Dev's total exactly.
- **Code read:** the reader, the provider and both drawer bodies, the row-open hook, the two tables' openers, `useDrawerResource`, the report route's 409 and `readAdminResponse`, and the shared move.
- **One temporary, untracked probe through the real page, deleted afterwards.** It reuses Dev's harness and fixtures, and is not kept as a permanent test, though P2 should become one with the fix. `git status` is clean of `zz_*`. Its five cases:
  - **P1:** the drawer figures against the picked page's strip;
  - **P2:** an unchecked period in the period drawer;
  - **P3:** abort on close, and re-opening;
  - **P4:** openers while the page report is loading or has failed;
  - **P5:** a page failure while a drawer is open.
- **A scoped tsc with a canary.**

**Verdict: FAIL, one Medium bug (B-1), a small fix.** Everything else passes. Only B-1's fix and its test need re-checking.

#### 1. Billing-period drawer

| Item | Result | Evidence |
|---|---|---|
| Stored vs rebuilt correct, each difference marked "(differs)" as visible text | ✅ for a **checked** period | Dev's test: 100 against 120 credits marked "(differs)"; charges equal, no marker. The marker is a visible word in `text-red-300`, not colour alone (DV-3 / C-5). For a checked period the drawer's per-figure `!==` agrees with the report's `unitsEqual`: both compare the same integer units divided by the same scale (`toFigures`) |
| **…for an unchecked period** | ❌ **B-1** | See Issues |
| The business's window figures | ✅ | `WindowFigures` calls the strip's own `chargedValue`, `recordedValue`, `aboveTile` and `periodsTile`. Probe P1 shows they equal the picked page (row 2) |
| "Open full view" lands on the period table, that business picked, same window | ✅ | `/admin/ai-cost?account=<id>#costs-periods`, built by the page's `hrefFor` with `tabPatch('checks')`, so the window keys carry over and the Calls keys do not (Dev's test). A plain `<a>` (full reload), as SA noted |

#### 2. Business drawer

| Item | Result | Evidence |
|---|---|---|
| Window figures equal the AI cost page with that business picked, through the same strip functions | ✅ | **P1.** Picked page: "Charged AI cost, At least $1.50", "Recorded AI cost, $2.50", "Recorded above charged, $1.00", "Billing periods not matching, 1". Drawer: `At least $1.50`, `$2.50` (plus "Business OS calls"), `$1.00`, `1`. Identical values, from the same four functions |
| Billing periods | ✅ | `PeriodsList`, one line per period with `PeriodCheckChip` (the page's chip), no opener inside (Dev's test) |
| The per-business Leak check sends nothing until Run, then Pin C row 7's leak request | ✅ | Dev's test: the leak calls stay `[page]` until Run, then become `[page, ROW7.leak]`. No KPI inside the drawer (`variant="drawer"`) |
| Open full view | ✅ | `/admin/ai-cost?account=<id>` (Dev's test) |

#### 3. Reads

| Item | Result | Evidence |
|---|---|---|
| Exactly one request per open, byte-identical to Pin C row 7, using the report's dates | ✅ | Dev's tests: the report calls are `[page, ROW7.report]`. The key is `aiCostDrawerKey(report.window, id)`, built from `drawerWindow = report.window`, **never** `new Date()` (code read, C-3) |
| No drawer read at page load; T-12 and Pin C unedited | ✅ | The T-12 file is `c2891a35` and the Pin C file `e57f2675`, both byte-identical and green. `drawerWindow` is null until a report settles |
| Re-opening the same row doesn't re-read? | ℹ️ **It does re-read, by design** | `useDrawerResource` does **not** cache by key: closing sets the key to null and forgets the answer ("reopening the same key shows loading until its new read lands, never the earlier figures"). **P3:** close, then re-open the same row gives a 3rd report request. This is the shared hook's rule, the same in Finance's drawers. Switching between a business drawer and a period drawer of the **same** business shares one key, so it sends nothing |
| On close, the read aborts | ✅ | **P3:** with a read held open, the `AbortSignal` passed to `fetch` is not aborted while open and **aborted after Escape**. The abort logs nothing (`if (!signal.aborted)`) |

#### 4. Openers (MK-10 rules)

| Item | Result | Evidence |
|---|---|---|
| A row click opens once; a control or a text selection does not | ✅ | Dev's tests: a row click gives one request; the button opens once, not twice; a selection inside the row opens nothing; the examples disclosure (`summary`) opens nothing |
| Focus returns to the button; label, test id, Details column | ✅ | Escape returns focus to the row's `row-open` (Dev's test). The labels are "Open details for Acme Dental" / "…, period from {day}", and the header is the shared `OpenRowHeader` (sr-only "Details") |
| No opener on the Total row, examples row, platform line, fallback list, rows in a drawer, a picked business, loading or a failed report | ✅ | Dev's tests cover the Total row (empty `<td/>`), the examples row, the platform line, the fallback list, the drawer's own Leak result and a picked business. **P4:** **0** `row-open` while the page report is pending, and **0** after it failed (500) |
| Column counts change only with openers | ✅ | Standalone `PeriodsSection`: 11 columns, Total row 10 cells. Picked business: 11. Leak table with openers: 10, and the examples `colSpan` is 10 only then (C-6) |

#### 5. Failures

| Item | Result | Evidence |
|---|---|---|
| 409 platform shows the platform sentence (SA Low-1: does the text match fire?) | ✅ | **It fires with the real route body.** `credits/report/route.ts:154` answers `{ success: false, error: 'platform_account' }` with 409. `readAdminResponse` passes the route's `error` through verbatim (its rule 1). The reader maps `status === 409 && message === 'platform_account'` to `COSTS_PLATFORM_ACCOUNT`, and the provider shows it as `AdminNotice`. Dev's 409 test uses that exact body. SA's note (it is tied to wording) stands as Low |
| A network error or other errors show messages | ✅ | Dev's tests: a 500 shows the route's reason; a throw shows "Could not reach the server…". 401 / 403 give the session-ended words (`sessionEndedCopy: true`, code read) |
| A page error while a drawer is open shows that error (DV-4) | ✅ | **P5:** the drawer is open, then the page window changes and the page report fails. The drawer shows **"Page report broke."**, with **no** loading state |
| No account id or name in logs | ✅ | The only log is `logger.warn({ err }, 'AI cost drawer read threw')`, where `err` is the fetch's own error object (no URL in a browser `TypeError`). There is no other log in the new files (code read) |

#### 6. Finance unchanged

| Item | Result | Evidence |
|---|---|---|
| The shared move left Finance's drawers and tests unedited and passing | ✅ | `git diff -- app/admin/finance` touches **only** `components/BusinessDrawer.tsx`: the two pieces became re-exports (`export { openableRowClass }`, `BusinessOpenHeader = OpenRowHeader`), each with a one-line comment. The moved bodies are byte-identical in `rowOpenClick.ts` / `OpenRowButton.tsx`. **No Finance test file changed.** `app/admin/finance` passes **26/26, 909/909** |

#### 7. Pins and guards

| Pin | Expected | Got |
|---|---|---|
| Pin A | `a130d560` | ✅ |
| Pin B | unchanged | ✅ `a1b3db0c` |
| Pin C file / table | `e57f2675` / `64a565e9` | ✅ |
| Pin D | unchanged | ✅ `1f7cf07a` |
| AC-145 | `33340751` | ✅ `333407516ae0…2215` |
| AC-173 | unchanged | ✅ `3a1a2dd4` / `b84e0c96` |
| T-12 | `c2891a35` | ✅ |

`git diff --quiet HEAD` over the pin files, T-12, `app/api` and `lib` shows no change.

#### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/ai-cost` | 7/7, **189/189** |
| `app/admin/finance` (Finance unchanged) | 26/26, **909/909** |
| Dev's combined group: `ai-cost`, `business-os-llm`, `analytics`, `finance`, `components`, `app/admin/__tests__`, `users`, `lib/admin`, the credits and finance routes | **169/169, 5816/5816** (= Dev) |
| Guards: layout registry (C-14), vocabulary, contrast, range cap (FF-1d), AI cost source guard | 5/5, **861/861** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 308/308, **9264/9264** |
| `npm run lint:hooks` | exit 0 |
| Scoped tsc (391 app files: `app/admin/{ai-cost, business-os-llm, finance, components, __tests__}`, 8 GB) | canary `AiCostDrawers.tsx(292,7) TS2322`; restored with `cp`, `cmp` identical; clean run **exit 0, 0 errors**, with no OOM trace |

#### Issues Found

##### Bugs (must fix before commit)

**B-1: "(differs)" is shown on a period the check did not check. Severity: Medium.**

File: `app/admin/ai-cost/components/AiCostDrawers.tsx`, `PeriodPart`:

```typescript
const differs = stored !== null && fromRows !== null && stored[key] !== fromRows[key];
```

**What happens.** When the report's rows read is cut off at its ceiling, the report decides `canCheck = false`. Every period is then `matches: null` ("not checked"), **but `fromRows` still holds the partial sum of the rows that were read** (`creditReport.ts:393-395`). The drawer ignores `line.matches`. It prints the partial "Rebuilt from rows" numbers and marks every figure that differs from the stored total.

**Steps to reproduce (probe P2).**
1. Open the period drawer.
2. The drawer's read returns that period with `matches: null` and `fromRows` at 60 credits / $0.75 / 5 charges against stored 100 / $1.25 / 10, with `incomplete: true`.

**Expected:** the chip says "not checked", and no figure is marked as differing. The page itself shows only "not checked" for such a period; `CheckCell` shows rows figures **only** on a real mismatch.

**Actual:** the chip says "not checked", **and 4 figures carry "(differs)"** (for example "Credits 100 60 (differs)"). The drawer contradicts its own chip. It points the admin at a ledger error the check never established, and it happens on large windows, exactly when the ceiling is hit.

**Suggested fix.**
- Compute `differs` only when `line.matches === false`.
- When `line.matches === null` and `fromRows` is present, show the rebuilt column as "not checked", or keep the numbers with a note such as "Rows were read only in part, so these are not compared".
- Add P2 as a test.

The page's own words already exist ("not checked"). No pin is affected.

**Fixed by Dev (2026-10-26).** In `PeriodPart`, the period's own check now decides the drawer. There is no new copy.
- **The marker:** `differs` is computed only when `matches === false` (and both figures are present and unequal).
- **The rebuilt column:** it shows `rebuilt = matches === null ? null : fromRows`. When the check did not run, the partial rebuilt sum is not shown: the column reads "—" and the page's existing "not checked" chip carries the state.
- **A matching period:** `matches === true` shows the rebuilt figures with no marker.

New permanent tests in `aiCostDrawers.render.test.tsx`, "QA B-1", 3 cases:
- `false` marks only the figures that differ;
- `true` marks nothing;
- `null` is QA's probe P2: `incomplete` with `rows_ceiling`, a partial 60 / $0.75 / 6 rebuilt sum, the "not checked" chip, no "(differs)", the rebuilt cells "—", and "60" nowhere.

Re-runs:

| Run | Result |
|---|---|
| `app/admin/ai-cost` with the Pin C test and Pin A | 9 suites, 265 passed (T-12 included) |
| Guards (`app/admin/__tests__`, `app/admin/components`, business-os-llm source guard) | 45 suites, 2,093 passed |
| Scoped tsc | 0 errors; the canary gave `(296,14) TS2322`, and the file was restored `cmp` identical |

Pins unchanged: A `a130d560`, B `a1b3db0c`, C `e57f2675` / `64a565e9`, D `1f7cf07a`, AC-173 `3a1a2dd4` + `b84e0c96`, AC-145 `33340751…2215`, T-12 `c2891a35`.

##### Low / Info

- **SA Low-1:** the 409 is detected by matching message text. It **does** fire with the real route body, as shown above. A `kind` on the read would be sturdier; this does not block.
- **Re-open re-reads:** this is not a bug. The shared hook deliberately does not cache; that is MK-8 behaviour.
- **Open full view** is a plain `<a>` and reloads the whole page. Accepted by SA (Q-7).

#### User browser steps (signed in as an admin)

1. **AI cost**, Summary & checks, all businesses. The period table has a narrow last column with an open icon on each business row; none on Total. Click a row (not the icon). A drawer opens with one request:
   - the period's stored against rebuilt figures, with "(differs)" beside any mismatch;
   - that business's AI cost for the window;
   - **Open full view**.
   Press Escape: focus returns to that row's icon.
2. Pick that business in the page's picker. The strip shows the same figures as the drawer did, and the period table now has no open icons.
3. Go back to all businesses and run the **Leak check**. The result rows have open icons; the examples row and the platform line do not. Open one: the business drawer shows its window figures, its billing periods, and a **Run leak check** that sends nothing until pressed.
4. Select some text in a row: nothing opens.
5. On **Finance**, the business drawers and their row icons behave exactly as before.
6. **After B-1's fix:** on a long window that reports "may be incomplete", open a period that reads "not checked". No "(differs)" appears.

#### Final Status

- [ ] All acceptance criteria pass, ready for commit
- [x] **Issues found: B-1 (Medium) must be fixed before commit.** Everything else (AC-1 to 15 apart from B-1's part of AC-6, and C-1 to C-6) is verified. No pin moved, Finance is unchanged, and every guard, suite and the scoped tsc are green. Re-QA scope after the fix: the `PeriodPart` change, its new test, and a re-run of `app/admin/ai-cost` and the Pin C / T-12 suites.

#### QA re-test of B-1, 2026-10-26: PASS

Scope as set out above: the fix, its tests, the re-runs and the pins.

| Check | Result | Evidence |
|---|---|---|
| The fix in `PeriodPart` | ✅ | Code read. `rebuilt = matches === null ? null : fromRows`, and `differs = matches === false && stored !== null && rebuilt !== null && stored[key] !== rebuilt[key]`. So: **false** marks each differing figure; **true** shows the rebuilt figures with no marker; **null** shows "—" in the rebuilt column, hides the partial sum, and keeps the page's existing "not checked" chip. There is no new copy, and the "rows not read" line still appears only when there are no rows at all |
| The three new permanent tests ("MK-8b QA B-1") | ✅ | They cover each state. **false:** "120(differs)" and the cost marked; charges unmarked. **true:** the ok chip, the rebuilt value shown, 0 markers. **null**, my probe P2 with `incomplete: true` and `rows_ceiling`: "not checked", 0 markers, stored 100 still shown, the rebuilt credits / cost / charges each exactly "—", and the partial "60" absent |
| My original probe P2, re-run unchanged against the fix (temporary, deleted after) | ✅ | Before the fix: the chip "not checked" with **4** "(differs)" markers ("Credits 100 60 (differs)"). Now: "not checked", **0** markers, "Credits 100 —" |
| `app/admin/ai-cost`, T-12 included | ✅ | 7/7, **192/192** (189 + the 3 new tests) |
| Pin C and Pin A suites | ✅ | 2/2, 73/73 |
| Vocabulary and contrast guards | ✅ | 2/2, 315/315 |
| Scoped tsc (the same 391-file scope as before) | ✅ | exit 0, 0 errors |

**Pins, LF-normalised, all unchanged:** Pin A `a130d560`, Pin B `a1b3db0c`, Pin C `e57f2675` / `64a565e9`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` + `b84e0c96`, AC-145 `333407516ae0…2215`, T-12 `c2891a35`. `git diff --quiet HEAD` over the pin files, T-12, `app/api` and `lib` shows no change.

**Final status (supersedes the box above):**

- [x] **All MK-8b acceptance criteria and C-1 to C-6 pass. B-1 is fixed and verified. Ready for RM.**
- [ ] Issues found

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Created (Dev) | Page 2 drawers: business drawer (Leak check rows) and billing-period drawer (period check rows) on the shared shell, one existing read on open (Pin C row 7), MK-10 row open; no route, payload key or migration; no pin moves; overlap with MK-3b named; SA-Q-MK8B-1 to 7 |
| 2026-10-26 | SA workplan review (SA-WP-MK8B) | Approved with conditions C-1 to C-6. SA-Q-MK8B-1 to 7 approved as recommended (shared move with commented Finance re-exports). The call drawer already exists on Calls (§4.2 "exists today", §6 item 28), so nothing is owed in MK-8b. No business questions. MK-3b overlap list complete (add the contrast guard to the read-only line) |
| 2026-10-26 | SA-WP-MK8B folded in (Dev) | Status: approved with conditions; C-1 (Step 0 re-check after MK-3b, ff-only merge), C-2 (no pin moves, Pin A `a130d560`), C-3 (openers only with a report on screen and all businesses; key from `report.window`), C-4 (shared states, no ids in logs), C-5 (text marking of differences, contrast), C-6 (column counts only with the Details column) appended to §2, §6 and §10; Q-1 re-export rule; Calls owes nothing; contrast guard added to §4 read-but-not-edited |
| 2026-10-26 | Implemented (Dev) | Built on MK-3b's branch (ff `095699ef`, docs-only over `5ccb0bd3`; C-1 nothing changed). Drawers, row openers, shared move; DV-1 to DV-6 for SA; no pin moved (A `a130d560`, C `e57f2675`/`64a565e9`, T-12 `c2891a35`); 169 suites / 5,816; authz 203; entitlements 9,264; lint:hooks clean; scoped tsc 0 with canary |
| 2026-10-26 | SA code review (SA-CR-MK8B) | Code approved for QA. C-1 to C-6 met (merge origin/main in after #518, then re-run T-12 and Pin C); no pin moved; the only moved baselines are C-14 22 → 26 and vocabulary `FILES` 21 → 23. DV-1 to DV-6 accepted (DV-3 meets C-5 better than the original wording). Two Low notes, none blocking |
| 2026-10-26 | QA B-1 fixed (Dev) | `PeriodPart` marks "(differs)" only when the period's check says mismatch; an unchecked period's partial rebuilt sum is not shown; 3 permanent tests including QA's probe P2; no new copy; no pin moved |
