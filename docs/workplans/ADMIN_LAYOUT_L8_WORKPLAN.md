# Workplan: Admin Layout Standard — Slice L-8 (Business OS AI: page header + Activity tab)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 14), §3 rule 1 (the two recorded L-8 cross-folder edits), §4.11, §5.3, §5.4 (K-1 to K-10), §5.5, §5.6 (U-1 to U-10), §5.7, §5.8 (D-1 to D-8), §5.9, §5.10, §5.11, §5.12, §6.1 (S-1 to S-10), §6.2 C-2, C-3, C-4, C-6, C-7, C-8, C-9, C-11, C-12, C-13, C-14, §7.11, §9 F-56, F-65, F-66, F-68, F-70, F-71, F-72, F-73, §10 D-2 (b), D-3 (a), D-4 (a), D-15, §12.3 (incl. the L-8-only item); SA rulings SA-R-3, SA-R-15, Q-2 / U-2 (L-1c M-1), re-check R-6, R-7, R-9, R-10, R-11, R-12
**Skills applied:** `bos-llm-call-standards` read for scope only: this slice adds **no** AI call, changes no model setting and no route (the page stays read-only, two `GET`s plus the picker's). `business-os-entitlements`: not triggered (no import from `lib/business-os/entitlements/`, no tier or capability literal; S-4 holds in the shared folder). `business-os-schema-check`: not triggered (no DB claim beyond the payload fields the tab already reads). No service-role path, no queue
**Branch:** `feature/admin-layout-l8`, cut from `feature/admin-layout-l7` (PR #316 open, carries #315). The L-8 PR targets `main` and carries L-6 / L-7 until they merge. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-12
**Status:** L-8a COMMITTED — f67ece30, PR #319 open (fast-track; awaiting checks + user merge). L-8b COMMITTED — 597ad7b6, PR #320 open (fast-track; SA + QA passed; awaiting checks + user merge; contains #319)
**Path:** **Full cycle** (R-6, R-7): L-8 builds the shared `useDrawerResource` (the Activity drill-down is the first drawer that owns a fetch) and extends the shared window extras with Activity's four existing choices. Run under the user's fast-track: SA workplan review → Dev → SA code review + QA → RM commits and opens the PR (no user diff review). Recommended as **two PRs, L-8a then L-8b** (§9)

## Overview

L-8 moves the Business OS AI page header and its **Activity** tab onto the standard. The other two tabs (Costs & credits = L-9, Settings = L-10) keep their bodies; the on-screen tab order (Settings, Costs & credits, Activity) is unchanged (R-12).

Page level: `AdminPageHeader` (h1 "Business OS AI", the "Read-only" badge as the neutral chip), a **per-tab purpose line** instead of the Settings subtitle on every tab (F-68), Left / Right arrow keys on the tabs, and `?tab=` kept. Activity: a four-tile KPI strip (§7.11), the shared filter bar with every filter in the URL (window with the standard five plus Activity's four extras, D-2 (b); the shared business picker labelled "Business"; Area, Outcome, Trigger; Minimum cost with its own Apply; Sort; Clear; Read at; "Refresh"), the shared states, the standard table, and the drill-down drawer rebuilt on `AdminDrawer` with the new shared `useDrawerResource`. The `business-os-llm/readJsonBody.ts` re-export is deleted and its two importers point at the shared file (R-10).

**One planned item cannot be done here:** the original `audit-trail/BusinessAccountPicker.tsx` is **still imported by the finance page** (`app/admin/finance/components/FinanceFilterBar.tsx:14`, on `main` and on all three `feature/bos-finance-health-*` branches), which this slice may not edit. L-8 removes Activity as an importer and leaves the file in place; the deletion moves to the finance adoption slice (§2.10, Q-1).

No route, payload, request parameter, model, temperature or provider changes. The only request change is the query string the URL can now pre-fill on the first read (an inbound link), which uses the route's existing parameters.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-5bd27cfc)
- [2. Scope and decisions](#2-scope-and-decisions)
- [3. Implementation Approach](#3-implementation-approach)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Guard and registry changes](#5-guard-and-registry-changes)
- [6. Tests](#6-tests)
- [7. Verification](#7-verification)
- [8. Task List](#8-task-list)
- [9. Sizing and split](#9-sizing-and-split)
- [10. Risks](#10-risks)
- [11. Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
- [12. Questions for SA](#12-questions-for-sa)
- [13. Product question for the user](#13-product-question-for-the-user)
- [Implementation Notes (L-8a)](#implementation-notes-l-8a)
- [Implementation Notes (L-8b)](#implementation-notes-l-8b)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)

---

## 1. Analysis Summary (code verified at `5bd27cfc`)

### 1.1 The page shell (`app/admin/business-os-llm/page.tsx`, 268 lines)

| Item | Today | Cite |
|---|---|---|
| Header | Hand-built `<header>`: h1 "Business OS AI" + a purple "Read-only" pill; `data-testid="page-subtitle"` shows `PAGE_SUBTITLE` (Settings copy) **on every tab** (F-68) | `:148-160` |
| Settings refresh | Icon-only button, `title="Re-read the settings"`, no aria-label (F-69), with "read at", hidden unless Settings | `:161-182` |
| Tabs | `nav role="tablist"`, three `role="tab"` buttons, purple underline, no arrow keys, every tab in the Tab order | `:184-204` |
| `?tab=` | Read once (`useState` initializer), written by `writeTabToUrl`: `window.history.replaceState(window.history.state, '', url)` | `:81-91`, `:105`, `:116-121` |
| Settings read | `response.json()` directly, parser message can reach the screen (F-67, L-10) | `:127-136` |
| Lazy tabs | Costs and Activity mount on first open and stay mounted, hidden | `:114-121`, `:207-213` |

**The tab writer and Next 14.2.** L-1c SA (U-2) verified in `app-router.js` 14.2.35 that a `replaceState` whose state already carries Next's `__NA` key takes Next's "internal call" branch: the URL changes but `useSearchParams` is never told. The page reads `?tab=` once, so the tab itself never noticed. **L-8 makes it matter:** the Activity KPI tiles are real links built by `useAdminFilters().hrefFor`, which projects onto the `useSearchParams` string (never `window.location`, to avoid a hydration mismatch). After a tab click with today's writer, that string still holds the old tab, so a middle-click on "Failed" would open `?outcome=failed` on the Settings tab. §2.2 decides.

### 1.2 The Activity tab (`components/activity/`, 1,028 lines across 9 files)

| File | Lines | Today |
|---|---|---|
| `ActivityTab.tsx` | 279 | Owns `preset` + `query` state (resolved dates); one list read per query change, newest wins (sequence + abort); a failed read clears the list; the platform-account 409 gets its own amber copy; a network failure shows `err.message` (§5.10 rule 4 breach); intro paragraph `ACTIVITY_INTRO` + "Times are UTC."; its own icon-only refresh with `aria-label="Re-read the AI activity"` and "read at"; renders `ActivityDrillDown` outside every branch |
| `ActivityFilters.tsx` | 200 | Six presets (Today, Yesterday, This week, Last week, This month, Last month), From / To (UTC) **always shown**, Minimum cost, **one Apply for dates and minimum cost together** (a preset click leaves a typed minimum cost in the box, F-73); the **original** `BusinessAccountPicker` labelled "Account" (`:20`, `:121`); Area / Outcome / Trigger native selects; Sort segmented; a chip "Business: {name}" with "Show all businesses" (clears the account only); no global Clear; no URL |
| `ActivityTable.tsx` | 189 | 15 columns, `text-xs`, number cells right-aligned without `tabular-nums` (F-71); a hand-built Open button (`focus:` not `focus-visible:`); `OutcomeLabel` in `text-emerald-300` (a second green, T-6); short ids and "Unknown" in `text-slate-500` (T-5) |
| `ActivityDrillDown.tsx` | 349 | Its own `Sheet` wiring (the template `AdminDrawer` was generalised from), its own idle / loading / error / ready machine with abort and newest-wins (`:257-294`); 404 → fixed `DRILL_DOWN_NOT_FOUND` decided on status before the body; non-JSON → fallback; network → `err.message`; `<section aria-labelledby>` blocks (regions) |
| `ActivityCountLine.tsx` | 28 | Count line, `text-xs text-slate-400` |
| `CutoverNotice.tsx`, `DeletedAccountsBucket.tsx`, `AuditSummaryLine.tsx`, `DrillDownCharges.tsx`, `RecordStateMarker.tsx` | 362 | Kept as they are (§2.9) |

Reads: `readJsonBody` imported from `../../readJsonBody` in `ActivityTab.tsx:45` and `ActivityDrillDown.tsx:60`; the re-export file `business-os-llm/readJsonBody.ts` is one line (R-10). No other importer in the repo.

### 1.3 The route (not touched)

`GET /api/admin/business-os/ai-activity` (Zod, `route.ts:93-131`) requires **both** `from` and `to` as `YYYY-MM-DD`, refuses a window over `MAX_WINDOW_DAYS` and a `to` in the future, takes `accountId` (UUID), `area` (enum from the catalog), `outcome` (`succeeded`, `failed`), `trigger` (`owner`, `scheduled`, `external`), `minCostUsd` (digits; three admin-worded messages shown verbatim, QA E-2), `sort` (`time`, `cost`). It answers the platform-account case with 409 `platform_account`. The drill-down route takes `actionId` only. Consequences for the URL contract: a linked (minute or instant) window and a one-sided window cannot be sent, so they are ignored on read (U-4, §2.4); an unknown area cannot be validated in the browser without importing the catalog (refused by the page guard), §2.4.

### 1.4 Who else depends on these files

| Dependent | What | Effect of L-8 |
|---|---|---|
| `app/admin/finance/components/FinanceFilterBar.tsx:14` + `financePage.render.test.tsx:39` (mock) | Import the **original** picker | Picker file stays (§2.10) |
| `audit-trail/__tests__/businessPicker.contract.test.ts` | Pins the original picker path and logging (RC-7) | Unchanged, stays green |
| `app/admin/components/__tests__/adminWindowPresets.test.ts:23` | Parity test imports `activityPresets.resolvePreset` | `activityPresets.ts` kept unchanged |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:77` (in `test:bos-entitlements`) | Lists `activityPresets.ts`, `activityTypes.ts`, `activityCopy.ts`, `activityDrillDownTypes.ts` and walks `components/activity/` | All kept; new files carry no `.service` read |
| `lib/business-os/credits/__tests__/aiActivity*.wireTypes.test.ts` | Import `activityTypes.ts` / `activityDrillDownTypes.ts` | Both untouched |
| `costsTab.render`, `page.render`, `ledgerPanel`, `leakPanel`, `lastChanged` | Render the page or its other tabs | Only the header pins move (§6.2) |

### 1.5 The shared folder today (what L-8 can reuse)

`AdminPageHeader` (title, purpose, badge, actions, asOf), `AdminFilterBar` (window, business, children, Clear, chips, help, Read at, Refresh), `DatePresets` (extras, `requireBothDates`), `adminWindow` (extras `24h` / `90d` only), `useAdminFilters` + `textFilter` + `hrefFor`, `AdminBusinessPicker` + `businessFilterChip`, `KpiStrip` / `KpiTile` (filter mode, no-target, `amber`), `StatusChip`, `adminTable` constants incl. `ADMIN_TH_NUM` / `ADMIN_TD_NUM` / `ADMIN_TD_ID` / `ADMIN_COUNT_LINE`, `AdminLoading` / `AdminError` / `AdminEmpty` / `AdminNotice`, `readJsonBody` / `readAdminResponse` / `ADMIN_NETWORK_ERROR`, `AdminDrawer` + `DrawerSection` / `DrawerFields` / `DrawerField` + `OpenRowButton`. `AdminDrawer`'s header says its D-7 states "arrive with `useDrawerResource` (L-8)". The guard (L-1e F-1) allows `fetch` only in `AdminBusinessPicker.tsx`.

---

## 2. Scope and decisions

### 2.1 In L-8

1. Page header on `AdminPageHeader`; per-tab purpose; badge as the neutral chip; Settings refresh kept in the header's action slot, Settings only, unchanged (until L-10).
2. Tabs: Left / Right arrow keys (roving `tabIndex`), `?tab=` kept, the writer's first argument corrected (§2.2).
3. Activity: KPI strip (§2.6), filter bar (§2.3), URL state (§2.4), states (§2.7), count line, table (§2.8), drawer on `AdminDrawer` + `useDrawerResource` (§2.5).
4. Shared: `useDrawerResource` (new), four window extras added to `adminWindow` (§2.3), comment-only corrections (§3.1).
5. Recorded cross-folder edits: delete `business-os-llm/readJsonBody.ts` and repoint its two importers (R-10). The picker deletion is **not** done (§2.10).
6. One-line edit in `components/costs/CostsTab.tsx` (its intro paragraph moves into the header), if SA allows it (§2.1 item 1, Q-4).

### 2.2 Decision: the header and the tabs

**Header.** `<AdminPageHeader title="Business OS AI" purpose={PURPOSE[tab]} badge={{ label: 'Read-only' }} actions={settingsActions} />`. The tablist renders right below it, unchanged in look (§5.3 "Tabs: below the header").

**Per-tab purpose (F-68).** The words already exist; they move, none is written new:

| Tab | Purpose line | Where it was |
|---|---|---|
| Settings | `PAGE_SUBTITLE` (unchanged words) | The header, on every tab |
| Costs & credits | `COSTS_INTRO` | First paragraph of `CostsTab.tsx:129`, removed there (Q-4) |
| Activity | `ACTIVITY_INTRO` + " " + `TIMES_ARE_UTC` | First paragraph of `ActivityTab.tsx:175-177`, removed there |

If SA rules the Costs paragraph must not move in L-8 (Q-4), the Costs header line is a short fallback for one slice, "What Business OS actions cost us and what we charged.", and L-9 replaces it with `COSTS_INTRO` when it removes the in-tab paragraph.

**Settings actions.** `actions` is always rendered and wraps today's "read at" + icon button in `<div hidden={!onSettings}>`, byte-equivalent inside, so `queryByTitle('Re-read the settings')` still finds a hidden element on Costs (`costsTab.render:330`). F-69 stays L-10.

**Arrow keys (A-4).** `onKeyDown` on the tablist: ArrowRight / ArrowLeft move **focus** to the next / previous tab, wrapping; Home / End to first / last. **Manual activation** (Enter / Space, which a `<button>` already gives): focusing a tab does not select it, because selecting Costs or Activity for the first time starts a read (WAI-ARIA APG: automatic activation only when a panel shows without latency). Roving `tabIndex`: the selected tab `0`, the others `-1` (Q-5).

**The `?tab=` writer (U-2, §1.1).** `writeTabToUrl` changes its first argument from `window.history.state` to `null`, the hook's mechanism, so Next syncs `useSearchParams` and the KPI tile hrefs carry the current tab. Unrelated parameters are still kept (the URL is built from `window.location.href`). This deliberately edits the spy test's "keeping history.state" half (§6.2 E-12) and needs SA to correct U-2's last sentence ("The page-level `?tab=` write on the BOS AI page keeps its own mechanism"), §7.11 ("either way the replaceState spy test stays green") and the §12.3 L-8 item (Q-2). The tab stays a page-level writer, not a `useAdminFilters` key: as a key, `tab=settings` would be omitted as the default (U-3) and today's `?tab=settings` writes would change.

### 2.3 Decision: the Activity filter bar (§5.5)

Order inside `AdminFilterBar` (`role="search"`):

| Part | Control | Notes |
|---|---|---|
| 1, 2 | Window: **Today · 7 days · 30 days · This month · Custom · Yesterday · This week · Last week · Last month** | Standard five, then Activity's four existing choices after them (D-2 (b)). Default `this_month` (unchanged). `requireBothDates` (the route needs both). From / To (UTC) appear under Custom only (today they are always shown) |
| 3 | Business: `AdminBusinessPicker` label "Business" | Chip "Business: {name}" / X "Remove business" via `businessFilterChip`; name = the picked name, else the first row's `companyName` when the payload is for that account (today's rule), else the short id (RC-6, no lookup) |
| 4 | Area, Outcome, Trigger (native selects, `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`), **Minimum cost (USD)** text input + its own button "Apply" named "Apply minimum cost", **Sort** (segmented, visible label "Sort", `aria-labelledby`, `aria-pressed`) | Area options from the payload; a URL area not (yet) in the list gets its own option so the select never shows "All areas" over an applied filter |
| 5 | Clear | Disabled at defaults; resets every filter incl. the typed minimum cost; keeps `tab` |
| 6 | Read at + Refresh | `readAt = payload.generatedAt`; `what="the AI activity"` → "Refresh the AI activity" (D-15) |

**Shared extras (D-2 (b)).** `ADMIN_WINDOW_EXTRAS` gains `yesterday`, `this_week`, `last_week`, `last_month` (U-6 names), with labels "Yesterday", "This week", "Last week", "Last month", resolved in `resolveWindow` to whole UTC dates with ISO weeks, exactly as `activityPresets.resolvePreset` (a parity test pins it, §6.3). Opt-in per page, as L-2a built it: AI cost & usage lists `['24h', '90d']` and is unaffected. The resolution is copied, not imported: the shared folder may not import a page folder (S-3).

**Typed input (§5.5 Apply semantics, F-73).** Custom dates apply with Custom's Apply (shared). The minimum cost applies with its own Apply or Enter. Its draft resets to the applied value whenever any applied filter changes (a preset, a select, Clear, a link), so a preset click discards an unapplied minimum cost. Two buttons show the word "Apply" only while Custom is open; they have distinct names ("Apply", "Apply minimum cost").

### 2.4 Decision: the URL contract (§5.6)

Module-level spec in a new `activityFilters.ts` (pure, no `'use client'`), keys written in this order:

| Field | URL keys | Parse (else default, U-4) | Route param |
|---|---|---|---|
| window | `range`, `from`, `to` | `windowFilter({ defaultValue: this_month, extras: the four })`, wrapped: a **linked** value (minute or instant bound) and a **one-sided** custom value are ignored, because the route needs two whole dates. **M-1:** the wrapper spreads `windowFilter(...)` and overrides `parse` only, so `keys`, `serialise` and `equals: windowEquals` are kept (a tab click is an outside change for the hook, and identity survives the re-parse only through a structural `equals`) | `from`, `to` (resolved once per filter change, so Refresh re-sends the same dates, as today) |
| account | `account` | UUID | `accountId` |
| area | `area` | lower snake case, 1 to 64 characters | `area` |
| outcome | `outcome` | `succeeded`, `failed` | `outcome` |
| trigger | `trigger` | `owner`, `scheduled`, `external` | `trigger` |
| minCost | `min_cost` | digits with an optional decimal part (the route's format rule; its size and precision rules stay with the route) | `minCostUsd` |
| sort | `sort` | `time`, `cost`; default `time` | `sort` (always sent, as today) |

No aliases: Activity had no URL. `tab` and `actionId` (B3, U-10) are not spec keys, so the hook keeps them. Inbound values the route would refuse in ways the browser cannot check (an area not in the catalog, a minimum cost over $1,000,000, a custom window over the route's day cap) reach the route and show **its own** message, as a typed value does today (QA E-2); Clear recovers (recorded page deviation from U-4, Q-7).

### 2.5 Decision: the drawer and `useDrawerResource` (§5.8, C-9, R-6)

**Shared hook** `useDrawerResource<T>(key, read)` in `app/admin/components/layout/useDrawerResource.ts`:

| Aspect | Rule |
|---|---|
| Signature | `key: string or null` (null = closed); `read: (key, signal) => Promise<DrawerRead<T>>`, where `DrawerRead<T>` is `{ ok: true; data: T }` or `{ ok: false; message: string }` |
| State | `{ kind: 'idle' }`, `{ kind: 'loading' }`, `{ kind: 'error'; message }`, `{ kind: 'ready'; data }` |
| Lifecycle | Key null → idle. Key set or changed → loading, one `read` with a fresh `AbortController`; the previous read is aborted and its result ignored (newest wins). Close (key null) aborts too. Reopening the same key after a close reads again (today's behaviour) |
| Rejection | A `read` that rejects while current → `ADMIN_NETWORK_ERROR` (§5.10 rule 3), never the rejection's message; a rejection after abort or supersession sets nothing |
| No fetch | The hook never calls `fetch` and never reads a body: the page's `read` does both, so L-1e F-1 ("only the picker fetches") and S-6 hold unchanged |
| Read identity | The latest `read` is kept in a ref; only `key` re-runs the effect (a page may pass an inline function) |
| Stale frame (M-4) | The hook keeps the key its state belongs to and returns `loading` whenever that key differs from the current one, so no render ever shows another key's data (A's body under B's title). Unmount while loading aborts and sets nothing (H-10); a rerender with key B after A is ready is `loading` on the very next render (H-11) |

**Activity drawer.** `ActivityDrillDown` keeps its name and props (`actionId`, `onClose`, `onReturnFocus`) and becomes: `useDrawerResource(actionId, readDrillDown)` + `AdminDrawer` (`testId="activity-drill-down"`, `title={DRILL_DOWN_TITLE}`, `titleSuffix` = the opened charge's action type when ready). `readDrillDown` (module-level): `fetch(DRILL_DOWN_URL?actionId, { signal })`; **status 404 first** → `DRILL_DOWN_NOT_FOUND` (body not read, QA-B2a-2); else `readJsonBody`; ok and `success === true` → data; else the route's `error` string, else `DRILL_DOWN_ERROR_FALLBACK`. Body: `AdminLoading what="the AI action"` (reads "Reading the AI action…", today's `DRILL_DOWN_LOADING` words), `AdminError testId="drill-down-error"`, or `DrillDownBody` with every section and its order kept, on `DrawerSection` / `DrawerFields` / `DrawerField`. Section testids and headings unchanged. Rendered once, outside every branch of `ActivityTab` (as today; L-2b M-4).

**Visible drawer changes (named in the PR):** title colour fixed for the light scheme (F-65) and the close button's purple focus ring (F-66), both from `AdminDrawer`; field text `text-xs` → `text-sm` (`DrawerFields`); sections are named groups, not regions (A-9); a network failure says "Could not reach the server. Check your connection and try again." instead of the browser's error text.

**Focus (D-6).** `onReturnFocus` focuses the opener if it is still connected, else the always-mounted content wrapper (`activity-content`, `tabIndex={-1}`), never `<body>` (the L-2b / L-4b precedent; a Refresh or an error can remove the opener's row while the drawer is open).

### 2.6 Decision: the KPI strip (§5.4, §7.11)

`components/activity/ActivityKpis.tsx`, inside the Activity panel above the bar. Shown when a payload is loaded and the window is not entirely before the cut-over; `KpiStrip loading` placeholders on the first read; hidden on an error (K-10). All values come from the payload already read (K-9).

| Tile | Value | Sub-line (K-8) | Target (K-6) | Colour |
|---|---|---|---|---|
| AI actions | `total` (exact even when `capped`, SA-R-15); `null` → "at least {shown}" when `capped`, else "Unknown" | none | Filter tile: clears Outcome and Area (patch `{ outcome: '', area: '' }`) | Neutral |
| Failed | count of shown rows with `outcome = failed` | "of the {shown} shown" when `capped` | Filter tile `outcome = failed`; `current` when applied, and then a click returns Outcome to all (toggle) | Neutral (D-4 (a)) |
| Cost (USD, net) | sum of `rows[].costUsd.net`, rows with `net = null` left out; every net null → "Unknown" | "of the {shown} shown" when `capped`; "{n} without a net figure left out" when some are null | Filter tile `sort = cost`; `current` when applied, toggles back to `time` | Neutral |
| Unresolved corrections | `unresolvedAdjustments` | none | **No target** (no filter exists, §7.11) | `amber` when > 0, **only** because the tab already shows the amber notice for it (K-5 (ii)); else neutral |

Each filter tile's href is `/admin/business-os-llm` + `hrefFor(patch)` (keeps `tab`, §2.2). Money uses the page's `formatUsd` (per-page precision kept, §5.11).

### 2.7 Decision: states and reads (§5.10)

| State | L-8 |
|---|---|
| First load | `AdminLoading what="the AI activity"` ("Reading the AI activity…", the same words as `ACTIVITY_LOADING`); the strip shows placeholders; the bar stays mounted |
| Refresh / filter change | Content kept, `aria-busy` on the content wrapper, Refresh spins (no change from today's keep-on-refresh) |
| Error | `AdminError testId="activity-error"` with "Try again" (re-runs the current read). Copy: the route's `error` string, else `ACTIVITY_ERROR_FALLBACK` (kept words), a network failure `ADMIN_NETWORK_ERROR` (forced change: today `err.message`). The list is cleared, as today |
| Platform account (409) | `AdminNotice testId="activity-platform-account"` with `PLATFORM_ACCOUNT_ERROR` (amber, as today) |
| Empty | `AdminEmpty message={ACTIVITY_EMPTY} testId="activity-empty"` + "Clear filters" when not at defaults |
| Notices (adjustments, names, unresolved, unreadable) | The existing amber list block kept (an `AdminNotice` holds one `<p>`, and this is a `<ul>`), text `text-xs` → `text-sm` |
| Cut-over, deleted-account bucket, audit summary | Unchanged components |

The list read keeps its own branching on `readJsonBody` (now imported from the shared folder) because the 409 code must be recognised before generic copy; `readAdminResponse` would return the code as the message. Newest wins and abort-on-unmount are kept as they are.

### 2.8 Decision: the table and count line (§5.7, F-71, F-72)

`ADMIN_TABLE_WRAP` / `ADMIN_TABLE` (`text-xs` → `text-sm`) / `ADMIN_THEAD` / `ADMIN_TH` / `ADMIN_TBODY` / `ADMIN_TD`; Cost, Credits, Calls / failed, Tokens on `ADMIN_TH_NUM` / `ADMIN_TD_NUM` (`tabular-nums`); short account id and grouping id on `ADMIN_TD_ID` (slate-400, T-5); "Unknown" cells slate-400; `aria-label` "AI actions" on the table. Open button → `OpenRowButton` (testId `activity-open-details`, same accessible name `OPEN_DETAILS_LABEL`, `focus-visible` ring). **Outcome → `StatusChip`** (`ok` "Succeeded" with `CheckCircle2`, `danger` "Failed" with the chip's own `AlertOctagon`, S-2; no icon prop is added): the page's `text-emerald-300` was a second green (T-6); `OutcomeLabel` keeps its name and is reused by the drawer and `DrillDownCharges`. Columns, their order and their words (`COLUMNS`) unchanged. Count line on `ADMIN_COUNT_LINE` (same classes), words unchanged.

### 2.9 Decision: what stays as it is

`CutoverNotice` (its blue box and both links), `DeletedAccountsBucket`, `AuditSummaryLine`, `RecordStateMarker`, `DrillDownCharges`, the drawer's corrections table, every copy string except those removed in §4, `format.ts`, `costFormat.ts`, `activityTypes.ts`, `activityDrillDownTypes.ts`, `activityPresets.ts` (kept for the two parity tests and the service-column guard). The Costs and Settings tab bodies. Their slate-500 information text and drawer-table densities are recorded, not changed (§11).

### 2.10 Decision: the original picker is not deleted (R-11 cannot be met in L-8)

`FinanceFilterBar.tsx:14` imports it on `main` and on `feature/bos-finance-health-1a`, `-1b` and `-2` (checked at `origin` 2026-10-12), and `financePage.render.test.tsx:39` mocks its path. L-8 may not edit `app/admin/finance/**`. So L-8: (1) removes Activity's import (the last non-finance importer), (2) leaves `audit-trail/BusinessAccountPicker.tsx` and `businessPicker.contract.test.ts` untouched, (3) corrects the three comments that say "L-8 deletes it" (`AdminBusinessPicker.tsx` header, the contract test header, the `layoutFolder.guard` G-6 comment) to "Finance keeps it until the finance adoption slice, which deletes it", and (4) records the move in requirement §1 / §3 rule 1 / §6.2 C-6 / §7.11 / §9 F-56, F-70 / §12.3 (Q-1).

### 2.11 Visible changes on `/admin/business-os-llm` (named in the PR)

1. The purpose line under the title follows the tab (F-68); the "Read-only" pill becomes the slate chip.
2. Tabs: arrow keys move between them; only the selected tab is in the Tab order.
3. Activity: four headline tiles; the window row adds 7 days, 30 days and Custom (D-2 (b)), From / To appear under Custom only; "Business" replaces "Account"; the business chip reads "Business: {name}" with an X; a Clear button; "Refresh" with a word instead of an icon-only button; Minimum cost has its own Apply; every filter is in the address bar and a reload or shared link reopens the same view.
4. Table text one step larger, numbers in tabular figures, Outcome as a chip.
5. Drawer: title readable in the light scheme, close focus ring, field text one step larger, network-failure sentence.
6. A network failure on the list says "Could not reach the server…" with "Try again".

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

| File | Change |
|---|---|
| `useDrawerResource.ts` | **New** (§2.5). No `'use client'` (a `.ts` hook, as `useAdminFilters.ts`); imports `react` and `./readAdminResponse` (`ADMIN_NETWORK_ERROR`) only |
| `adminWindow.ts` | `ADMIN_WINDOW_EXTRAS` + labels + `resolveWindow` branches for the four (§2.3); header comment names L-8 |
| `AdminDrawer.tsx` | Header comment only: D-7 states come from `useDrawerResource` + `AdminLoading` / `AdminError` in the body (no prop added: the page renders the state blocks, so the shell stays fetch-free and state-free) |
| `readJsonBody.ts` | Header comment only: the re-export is gone |
| `AdminBusinessPicker.tsx` | Header comment only (§2.10) |
| `__tests__/useDrawerResource.render.test.tsx` | **New** (§6.3) |
| `__tests__/adminWindow.test.ts`, `__tests__/DatePresets.render.test.tsx` | Extras cases (§6.2, §6.3) |
| `__tests__/layoutFolder.guard.test.ts` | `EXPECTED_SOURCES` + `useDrawerResource.ts`; G-6 comment (§5) |

### 3.2 Page folder (`app/admin/business-os-llm/`)

| File | Change |
|---|---|
| `page.tsx` | Header, per-tab purpose, Settings actions wrapper, tablist keys + roving `tabIndex`, `writeTabToUrl(null)`; header comment updated. Settings read untouched (L-10) |
| `activityFilters.ts` | **New**: spec, `ActivityFilters` type, `ACTIVITY_WINDOW_EXTRAS`, `ACTIVITY_DEFAULT_WINDOW`, `activityRouteSearch(filters, now)` (pure) |
| `components/activity/ActivityTab.tsx` | Hook state, route search memoised on `filters`, KPIs, bar, states, content wrapper, focus fallback, reads on the shared `readJsonBody` |
| `components/activity/ActivityFilterBar.tsx` | **New**, replaces `ActivityFilters.tsx` (deleted) |
| `components/activity/ActivityKpis.tsx` | **New** (§2.6) |
| `components/activity/ActivityTable.tsx` | Constants, `OpenRowButton`, `StatusChip` outcome |
| `components/activity/ActivityDrillDown.tsx` | `useDrawerResource` + `AdminDrawer` + shared sections (§2.5) |
| `components/activity/ActivityCountLine.tsx` | `ADMIN_COUNT_LINE` |
| `activityCopy.ts` | Remove `PRESET_LABELS` (and its `ActivityPreset` type import) and `SHOW_ALL_BUSINESSES` (no consumer left); add the KPI words and `APPLY_MIN_COST_LABEL` |
| `readJsonBody.ts` | **Deleted** (R-10) |
| `components/costs/CostsTab.tsx` | Remove the intro `<p>` and the `COSTS_INTRO` import (Q-4) |

### 3.3 Kept identical

Every request path and the parameters on each read for the same filter values; the platform-account wording; the newest-wins and abort behaviour of both reads; the drill-down's single `actionId` parameter; every testid the existing suites use except the account chip (`activity-account-chip`, unpinned, becomes `business-filter-chip`).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/useDrawerResource.ts` | create | C-9 hook (R-6) |
| `app/admin/components/layout/__tests__/useDrawerResource.render.test.tsx` | create | Hook contract |
| `app/admin/components/layout/adminWindow.ts` | modify | Four extras (D-2 (b)) |
| `app/admin/components/layout/__tests__/adminWindow.test.ts` | modify | Extras pin + parity |
| `app/admin/components/layout/__tests__/DatePresets.render.test.tsx` | modify | The four extras render after Custom |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Expected sources; G-6 comment |
| `app/admin/components/layout/AdminDrawer.tsx`, `readJsonBody.ts`, `AdminBusinessPicker.tsx` | modify (comments) | Stale "L-8" sentences |
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` | modify (comment) | Stale "L-8 deletes it" (Q-1) |
| `app/admin/business-os-llm/page.tsx` | modify | §2.2 |
| `app/admin/business-os-llm/activityFilters.ts` | create | §2.4 |
| `app/admin/business-os-llm/components/activity/ActivityFilterBar.tsx` | create | §2.3 |
| `app/admin/business-os-llm/components/activity/ActivityFilters.tsx` | delete | Replaced |
| `app/admin/business-os-llm/components/activity/ActivityKpis.tsx` | create | §2.6 |
| `app/admin/business-os-llm/components/activity/ActivityTab.tsx` | modify | §2.4, §2.7 |
| `app/admin/business-os-llm/components/activity/ActivityTable.tsx` | modify | §2.8 |
| `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx` | modify | §2.5 |
| `app/admin/business-os-llm/components/activity/ActivityCountLine.tsx` | modify | Constant |
| `app/admin/business-os-llm/activityCopy.ts` | modify | Copy moves (§3.2) |
| `app/admin/business-os-llm/readJsonBody.ts` | delete | R-10 |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | modify (one paragraph) | Purpose moves up (Q-4) |
| `app/admin/business-os-llm/__tests__/activityTab.render.test.tsx` | modify | §6.2 |
| `app/admin/business-os-llm/__tests__/activityDrillDown.render.test.tsx` | modify | §6.2 |
| `app/admin/business-os-llm/__tests__/page.render.test.tsx` | modify | §6.2 |
| `app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx` | create | §6.3 |
| `app/admin/business-os-llm/__tests__/activityFilters.test.ts` | create | §6.3 |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | modify | §5 G-1 to G-4 |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 14, §3, §5.6 U-2, §6.2 C-4 / C-6 / C-7 / C-9, §7.11 as built, §9, §12.3, Change History |

Not touched: any route, `lib/**`, `app/admin/finance/**`, `app/admin/audit-trail/BusinessAccountPicker.tsx`, `activityPresets.ts`, `activityTypes.ts`, `activityDrillDownTypes.ts`, the Settings and Costs bodies (beyond Q-4's paragraph), the sidebar.

---

## 5. Guard and registry changes

**BOS AI `source.guard.test.ts` (R-9: the existing "no `@/lib/`" rule needs no edit and is not edited).** New cases appended:

| # | Rule | Why |
|---|---|---|
| G-1 | No file under `app/admin/business-os-llm/` imports `@/app/admin/audit-trail/BusinessAccountPicker` and `readJsonBody.ts` does not exist in the folder. It never asserts the absence of the picker file itself (M-2: Finance still imports it) | L-8 end state for this page; a re-added import fails |
| G-2 | Every import of the shared folder uses the alias `@/app/admin/components/layout/` (S-1) | No relative path into the shared folder |
| G-3 | `components/activity/` has no direct `.json(` and no `fetch(` outside `ActivityTab.tsx` and `ActivityDrillDown.tsx` | Reads stay where they are |
| G-4 | `page.tsx` is the only file in the folder that writes history, and it never passes `window.history.state` | Pins the §2.2 correction |

Each gets a self-test on a planted string (no dead regex), as the folder's existing rules do.

**Shared `layoutFolder.guard.test.ts`.** `EXPECTED_SOURCES` gains `useDrawerResource.ts`; every existing rule then applies to it (S-3 allow-list, S-5, S-6 no `.json(` / no history write, L-1e F-1 no `fetch`). No new rule.

**Migrated-pages registry: deferred to L-10** (Q-3). An entry must list a file that imports `AdminPageHeader` (only `page.tsx`), and every listed file must have no direct `.json(`; `page.tsx` still reads Settings with `response.json()` (F-67, the L-10 fix). Registering now would need either the Settings read changed in L-8 (L-10 scope) or the registry rule weakened. Recorded in §1.

**Picker contract test:** unchanged apart from its header comment (§2.10).

---

## 6. Tests

### 6.1 Order

**Split tags (M-3).** **L-8a:** E-1 to E-4, E-8, E-9; T-1 to T-13, T-15, T-16; the `adminWindow` / `DatePresets` extras cases and the S-1 parity test; `activityFilters.test`; G-1 to G-4. **L-8b:** `useDrawerResource.render` H-1 to H-11, E-5 to E-7, E-10, T-14. Each half gets its own SA code review and QA; both PRs target `main` (L-8b is cut from the L-8a commit and never opened against the L-8a branch).

Before any source edit: run `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/finance --ci` on the branch as is and record the counts (baseline). The existing Activity suites are the characterisation suite: every case not listed in §6.2 must pass unedited at the end.

### 6.2 Edited deliberately (each named in the PR)

| # | File and case | Edit | Why |
|---|---|---|---|
| E-1 | `activityTab.render` "a network failure is shown as an error" | `'offline'` → `ADMIN_NETWORK_ERROR` | §5.10 rule 3 / 4 |
| E-2 | `activityTab.render` "every control has an accessible name…" | Labels: `'Account'` → `'Business'`; From / To checked after clicking Custom; preset list → the nine window buttons; adds "Apply minimum cost" and the "Sort" group | §2.3 (C-6 label, standard window) |
| E-3 | `activityTab.render` "typed dates and the minimum cost apply with Apply…" | Split: Custom → dates → "Apply" (window custom, This month unpressed); minimum cost → "Apply minimum cost"; nothing read while typing (kept) | §2.3 |
| E-4 | `activityTab.render` "choosing a tab writes ?tab= with replaceState, keeping history.state…" | `toHaveBeenLastCalledWith(null, '', …)`; the `history.state` equality line removed; `keep=1` and the hidden-but-mounted assertions kept; retitled | §2.2, Q-2 |
| E-5 | `activityDrillDown.render` "a network failure is shown as an error" | `'offline'` → `ADMIN_NETWORK_ERROR` | §5.10 |
| E-6 | `activityDrillDown.render` "each section is a region labelled by its heading id…" | `getByRole('region', …)` → `getByRole('group', …)`; adds "no region in the drawer" | A-9, `DrawerSection` |
| E-7 | `activityDrillDown.render` close button (`:464-474`) | **No edit expected**: `AdminDrawer` carries `[&>button]:text-slate-300` and the X stays a direct child of the dialog. Listed so a failure is read as a regression, not a pin | §12.3 L-8 item |
| E-8 | `page.render` "pins the subtitle…" (`:940-947`) | `getByTestId('page-subtitle')` → the header's purpose paragraph found by text on the Settings tab; the four content assertions kept | F-68 (the testid is gone with the hand-built header) |
| E-9 | `adminWindow.test` "are 24 hours and 90 days, labelled in words" | Pins the six extras and six labels; retitled | §2.3 |
| E-10 | `layoutFolder.guard` `EXPECTED_SOURCES` | + `useDrawerResource.ts` | §5 |

No other existing case is edited. `costsTab.render` (incl. `queryByTitle('Re-read the settings')` and "Re-read the cost report"), `ledgerPanel`, `leakPanel`, `lastChanged`, `costFormat`, `nav`, `activityPresets.test`, `adminWindowPresets.test`, `businessPicker.contract`, every finance suite, every audit-trail suite: green unedited.

### 6.3 New

**`app/admin/components/layout/__tests__/useDrawerResource.render.test.tsx`** (a tiny harness component):

| # | Case |
|---|---|
| H-1 | `null` key → idle, `read` never called |
| H-2 | Key → loading, then ready with the data; `read` called once with the key and a live signal |
| H-3 | `{ ok: false, message }` → error with that message, verbatim |
| H-4 | `read` rejects → error `ADMIN_NETWORK_ERROR`, never the rejection's text |
| H-5 | Key A then B before A settles: A's signal aborted; A resolving late sets nothing; B's data shown |
| H-6 | Close while loading: signal aborted, state idle, a late resolution sets nothing (no act warning) |
| H-7 | Reopen the same key after a close: a second `read` |
| H-8 | A new inline `read` on re-render does not start a second read for the same key |
| H-9 | A late rejection after abort sets nothing (no error flash) |
| H-10 | Unmount while loading: the signal is aborted, nothing is set, no act warning (M-4) |
| H-11 | Rerender with key B after A is ready: the very next render is `loading`, never A's data (M-4) |

**`adminWindow.test` / `DatePresets.render` additions (L-8a):** the four extras parse only when listed (AI cost & usage's `['24h', '90d']` still refuses `range=yesterday`); serialise to `range=…`; resolve to whole dates; in `DatePresets`, the four render after Custom with `aria-pressed` and a second click returns to the default. **Parity with `activityPresets.resolvePreset`** for `yesterday`, `this_week`, `last_week`, `last_month` over 50 instants including a Monday, a Sunday, 1 January and 1 March of a leap year lives in `app/admin/components/__tests__/` beside the existing parity test (S-1), so the shared folder's own tests never import a page folder.

**`app/admin/business-os-llm/__tests__/activityFilters.test.ts`** (pure): parse of every key incl. invalid values (U-4); linked and one-sided windows ignored; projection order and default omission; `activityRouteSearch` gives exactly today's parameter set for the default (`from`, `to`, `sort`) and the set filters only.

**`app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx`** (mocks `next/navigation` as `activityTab.render` does):

| # | Case |
|---|---|
| T-1 | Header: one h1 "Business OS AI"; the "Read-only" neutral chip; no `page-subtitle` testid; the purpose line is `PAGE_SUBTITLE` on Settings, `COSTS_INTRO` on Costs, `ACTIVITY_INTRO` + `TIMES_ARE_UTC` on Activity, and the Activity panel no longer repeats it |
| T-2 | Tabs: ArrowRight from Settings focuses Costs without selecting it (no report read); Enter selects it; ArrowLeft from Settings wraps to Activity; Home / End; only the selected tab has `tabIndex` 0 |
| T-3 | Inbound link `tab=activity&range=yesterday&account={uuid}&area=website&outcome=failed&trigger=owner&min_cost=0.01&sort=cost`: exactly **one** list read on mount, with `from` / `to` = yesterday, `accountId`, `area`, `outcome`, `trigger`, `minCostUsd`, `sort`; controls show those values; the chip shows the short id |
| T-4 | Invalid values (`range=48h`, `account=not-a-uuid`, `outcome=maybe`, `min_cost=abc`, `from=2026-10-01T10:00`, only `to=2026-10-01`) are each ignored: the default read (U-4) |
| T-5 | A filter change writes the URL by `replaceState(null, …)`, keeps `tab` and `actionId`, omits defaults; Clear removes every filter key, keeps `tab`, resets the typed minimum cost, one read |
| T-6 | F-73: type a minimum cost, click "Last month" → the input shows the applied (empty) value and the next read has no `minCostUsd` |
| T-7 | KPI values: total; `total` null + capped → "at least 2"; Failed counts failed rows, "of the 2 shown" when capped; Cost sums nets, leaves out a null net with the sub-line, "Unknown" when all null; Unresolved amber with "Needs a look" only when > 0 |
| T-8 | KPI links: Failed href `/admin/business-os-llm?tab=activity&outcome=failed`; a plain click applies (one read with `outcome=failed`, tile `aria-current`), a second click removes it; a ctrl-click does not apply; Unresolved is a `role="group"`, not a link |
| T-9 | Strip: placeholders on the first read; hidden on an error and when the window is entirely before the cut-over |
| T-10 | Error with "Try again" re-reads the same parameters; the platform-account notice has no "Try again" and keeps its words |
| T-11 | Refresh: named "Refresh the AI activity", re-sends the same `from` / `to` (memoised), table stays, `aria-busy` on the content wrapper while reading; "Read at HH:mm UTC" from `generatedAt` |
| T-12 | Empty with filters → "Clear filters" clears; without filters → no button |
| T-13 | Table: `tabular-nums` on the four number columns; Outcome is a chip with words and icon; no `text-emerald-` and no `text-slate-500` in the table |
| T-14 | Focus fallback: open a row's drawer, Refresh returns a list without that row, Escape → focus on `activity-content`, not `<body>` |
| T-15 | A URL area not in the payload's list shows as its own selected option, never "All areas" |
| T-16 | M-1: the `next/navigation` mock returns `new URLSearchParams(window.location.search)` on every render (not a fixed string); open Activity with `outcome=failed`, switch to Settings and back: zero further list reads, filters and table intact, no URL write beyond the two `tab` writes |

### 6.4 Must stay green with no edit

As listed under §6.2, plus `app/admin/components/layout/__tests__/**` except E-9 / E-10, `app/admin/components/__tests__/**`, `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` and the two Activity wire-type tests (via `test:bos-entitlements`), `lib/admin/__tests__/admin-authz-surface.guard.test.ts`.

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-0 | Baseline run (§6.1) before any source edit | Counts recorded |
| V-1 | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/finance app/admin/__tests__ lib/admin/__tests__ --ci` | All green; finance and audit-trail counts equal to V-0 (untouched) |
| V-2 | `npm run test:bos-llm` (required CI) and `npm run typecheck:bos-llm` | Green; unchanged (the page is outside both scopes; run because the page is Business OS AI) |
| V-3 | `npm run test:bos-entitlements` | Green (the service-column guard walks `components/activity/`; the wire-type tests import the unchanged types) |
| V-4 | Scoped `tsc -p` on a scratch tsconfig in the session scratchpad (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `app/admin/components/adminWindowPresets.ts`; `--listFilesOnly` first). Run 1 with a scratch `canary.ts` (`const canary: number = 'x';`) → exit 2 with exactly that TS2322; run 2 without → exit 0 | Both recorded |
| V-5 | `npm run lint:hooks`; `npx eslint` on every touched file | Clean |
| V-6 | Mutation checks, each reverted and the file's md5 compared: (a) `writeTabToUrl` back to `window.history.state` → E-4 and G-4 fail; (b) drop the linked-window wrapper → T-4 fails (a minute bound reaches the route); (c) resolve the window in the read instead of memoising on `filters` → T-11 fails with a mocked clock crossing midnight; (d) no draft reset on applied change → T-6 fails; (e) `useDrawerResource` sets the rejection's message → H-4 and E-5 fail; (f) drop the abort / current check → H-5, H-6 and the existing "drawer already closed" case fail; (g) read state from a `read` dependency instead of the ref → H-8 fails (two reads); (h) put a `fetch(` in `useDrawerResource.ts` → layout guard L-1e F-1 fails; (i) re-add the original picker import in `ActivityFilterBar.tsx` → G-1 fails; (j) recreate `business-os-llm/readJsonBody.ts` → G-1 fails; (k) colour Unresolved amber when 0 → T-7 fails; (l) Failed tile `href` built without `hrefFor` → T-8 fails (no `tab`); (m) `focus` the opener only → T-14 fails; (n) 404 decided after `readJsonBody` → the existing "HTML 404" case fails; (o) the Settings purpose shown on every tab → T-1 fails; (p) arrow keys select instead of focus → T-2 fails (a report read); (q) drop `equals` from the window wrapper → T-16 fails (M-1); (r) `useDrawerResource` returns the stored state without the key check → H-11 fails (M-4). **Split (M-3):** L-8a runs (a) to (d), (i) to (l), (o) to (q); L-8b runs (e) to (h), (m), (n), (r) | Each fails as stated |
| V-7 | (S-3) `git diff --stat 5bd27cfc -- app/api lib app/admin/finance app/admin/audit-trail/BusinessAccountPicker.tsx app/admin/business-os-llm/components/settings`; for L-8b, against the L-8a commit | Empty; `app/admin/business-os-llm/components/costs` shows only the one paragraph and its import |
| V-8 | `grep` the page folder for `console.`, `.json(` (outside `page.tsx`'s Settings read), `window.history.state`, `as any`, `text-emerald-`, `@/app/admin/audit-trail/`; (S-6) the shared folder for `getProviderFactory`, `@/lib/ai` and `fetch(` outside `AdminBusinessPicker.tsx` | None in code |
| V-9 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions plausible; no file emptied except the two deletions |

### 7.1 Browser checks for QA (signed-in admin, DevTools Network open, light and dark emulation)

The page writes nothing (every request is a `GET`), so every check is safe on the production database.

| # | Check |
|---|---|
| L8-B1 | `/admin/business-os-llm`: one h1 "Business OS AI", slate "Read-only" chip, Settings purpose line; the Settings refresh still in the header's right side; no shell title |
| L8-B2 | Tabs: Tab lands on the selected tab only; Left / Right move focus, Enter selects; the purpose line changes with the tab; the address bar shows `?tab=…`; reload keeps the tab |
| L8-B3 | Activity first open: one `ai-activity` request with this month; four tiles; window row Today, 7 days, 30 days, This month, Custom, Yesterday, This week, Last week, Last month |
| L8-B4 | Pick a business: label "Business", chip "Business: {name}" with X; the address bar gains `account=`; reload reopens the same view with one request |
| L8-B5 | **Next sync check (§2.2):** open the page on Settings, click the Activity tab, then hover / copy the "Failed" tile link: it contains `tab=activity`. Middle-click it: the new browser tab opens Activity with Outcome = Failed |
| L8-B6 | Type a minimum cost, click "Last month": the box empties, no `minCostUsd` sent; type again, "Apply minimum cost": one request with `minCostUsd` |
| L8-B7 | Clear: every filter back, `?tab=activity` kept, one request; Refresh: same `from` / `to`, table stays, "Read at" updates |
| L8-B8 | Open a row: one `drill-down?actionId=` request; title "AI action {type}"; every section present; Escape closes and focus returns to the Open button; the X is visible with a purple focus ring |
| L8-B9 | Light and dark emulation: header chip, tiles, bar, table, drawer title and X look the same (A-8); the selects' lists and date inputs are dark |
| L8-B10 | Offline + Refresh → "Could not reach the server…" with Try again; online + Try again restores |
| L8-B11 | Costs & credits and Settings tabs: their bodies unchanged apart from the moved purpose line |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding ✅ (M-1 to M-4 applied 2026-10-12 before coding)
- [x] 2. V-0 baseline run, counts recorded ✅ (L-8a)
- [x] 3. Shared: `adminWindow` extras + E-9 + parity and `DatePresets` cases ✅ (L-8a; parity in `app/admin/components/__tests__/`, S-1)
- [x] 4. ✅ (L-8b) Shared: `useDrawerResource.ts` + H-1 to H-11; guard E-10
- [x] 5. `activityFilters.ts` + its pure test ✅ (L-8a)
- [x] 6. ✅ (L-8a) `page.tsx`: header, per-tab purpose, Settings actions wrapper, tab keys, `writeTabToUrl(null)`; `CostsTab.tsx` paragraph (per Q-4)
- [x] 7. ✅ (L-8a) `ActivityFilterBar.tsx`, `ActivityKpis.tsx`, `ActivityTab.tsx` (hook, states, content wrapper; the focus fallback is L-8b with T-14), `ActivityCountLine.tsx`; delete `ActivityFilters.tsx`
- [x] 8. ✅ (L-8a) `ActivityTable.tsx` (constants, `OpenRowButton`, outcome chip)
- [x] 9. ✅ (L-8b) `ActivityDrillDown.tsx` on `useDrawerResource` + `AdminDrawer`; `AdminDrawer.tsx` header comment; E-5 to E-7, T-14 (focus fallback in `ActivityTab.tsx`); V-1 to V-9 for L-8b and the requirement row 14b (Implementation Notes (L-8b))
- [x] 10. ✅ (L-8a) Repoint both `readJsonBody` imports; delete `business-os-llm/readJsonBody.ts`; copy cleanup in `activityCopy.ts`
- [x] 11. ✅ (L-8a) Comment corrections (§2.10, §3.1; the `AdminDrawer.tsx` comment is L-8b); BOS AI guard G-1 to G-4
- [x] 12. ✅ (L-8a: E-1 to E-4, E-8, E-9 (+ E-9b); T-1 to T-13, T-15, T-16) Deliberate edits E-1 to E-8; new `activityLayout.render` T-1 to T-15
- [x] 13. ✅ (L-8a) V-1 to V-9; real output in Implementation Notes
- [x] 14. ✅ (L-8a) Requirement: §1 row 14, §3 rule 1, §5.6 U-2, §6.2 C-4 / C-6 / C-7 / C-9, §7.11 as built, §9 dispositions and new findings, §12.3 L-8 item, Change History
- [x] 15. ✅ (L-8a) Hand to SA code review + QA (nothing committed by Dev)

**Split as approved (M-3).** L-8a: tasks 2, 3, 5 to 8, 10 (both `readJsonBody` repoints and the re-export deletion; `OutcomeLabel` becomes the chip, visible in the drawer too), 11 (G-1 to G-4 and the picker comments), 12 (E-1 to E-4, E-8, E-9; T-1 to T-13, T-15, T-16), 13, 14. L-8b: tasks 4 and 9, the `AdminDrawer.tsx` header comment, E-5 to E-7, E-10, T-14, H-1 to H-11, and its own 13 / 14. Both PRs target `main`.

---

## 9. Sizing and split

| Part | Days |
|---|---|
| Header, tabs, tab writer, purpose (task 6) | 0.4 |
| Window extras + tests (task 3) | 0.3 |
| Filter spec, bar, URL, states, focus (tasks 5, 7) | 1.0 |
| KPI strip (task 7) | 0.4 |
| Table (task 8) | 0.3 |
| `useDrawerResource` + tests (task 4) | 0.5 |
| Drawer on the shared shell (task 9) | 0.4 |
| Test edits and new render cases (task 12) | 0.9 |
| Guards, cleanup, verification, docs (tasks 10, 11, 13, 14) | 0.6 |
| **Total** | **about 4.8 days** |

Over the "few days" slice size. **Recommended split** (Q-6), the same cut as L-2a / L-2b and L-4a / L-4b:

| Slice | Content | Days | Path |
|---|---|---|---|
| **L-8a** | Header, tabs, tab writer; Activity KPI strip, bar, URL, states, count line, table; window extras; the list's `readJsonBody` import repointed; `ActivityDrillDown` gets only its one-line import repoint so the re-export can be deleted here | about 3.2 | Full cycle (shared `adminWindow` behaviour; R-7) |
| **L-8b** | `useDrawerResource` + the drawer on `AdminDrawer` (E-5, E-6, H-1 to H-9, T-14) | about 1.6 | Full cycle (R-6: builds the shared hook) |

One workplan covers both (this file); L-8b is cut from `feature/admin-layout-l8` after L-8a's commit, by RM. If SA prefers one PR, the task order above already is that PR.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The tab writer change makes Next re-render the page on every tab click | It is the documented native-History path the hook already uses on every filter page; `useState` initialisers do not re-run; `activityTab.render` "kept mounted, hidden" stays; L8-B2 / L8-B5 confirm in a browser (jsdom has no Next patch) |
| Two hooks on one page later fight over `range` / `from` / `to` / `account` (L-9 gives Costs its own filters, and the hidden-but-mounted tabs share one address bar) | Not created by L-8 (Costs has no hook yet). Recorded as a new §9 finding for L-9 to rule (prefixed keys or ownership by the visible tab), Q-8 |
| A double list read on mount (filters parsed after the first render) | The hook parses synchronously in its `useState` initialiser; T-3 pins one read; the existing "read once on mount" case in `activityDrillDown.render` stays |
| Refresh shifts "today" after midnight | Route search memoised on `filters` (T-11, mutation (c)) |
| A stale opener after a Refresh | Focus fallback to the content wrapper (T-14) |
| The drawer's state flashes an error after close | Abort and current check in the hook (H-6, H-9) |
| The finance page breaks | The original picker is not touched; finance suites run in V-1 unedited |
| Information text below AA left on the tab | Recorded (§11), not silently left |

---

## 11. Out of scope and found on the way

- **R-11 not met:** the original picker stays for Finance (§2.10). New §9 finding (open, owner: the finance adoption slice, M-2): "the original `BusinessAccountPicker.tsx` is still imported by `app/admin/finance/components/FinanceFilterBar.tsx:14` and its path is mocked by `financePage.render.test.tsx:39`; its deletion moves from L-8 to the finance adoption slice". F-56 and F-70 rows say the original picker keeps `createLogger` until that slice.
- **New §9 finding (open, L-9):** Costs and Activity are both kept mounted and will both own `range`, `from`, `to`, `account` once Costs adopts the hook; L-9 must decide key ownership (Q-8).
- **New §9 finding (cos, open):** `text-slate-500` information text remains in `AuditSummaryLine`, `DeletedAccountsBucket`, `RecordStateMarker` ("None") and the Settings "read at" (T-5); the drawer's corrections and charges tables keep `text-xs`. Not layout-forced; listed for a later tidy-up.
- **New §9 finding (UX, open):** the cut-over notice uses a blue palette of its own, not the `info` chip / notice tones.
- **Page deviation (Q-7):** inbound values the browser cannot validate without the catalog reach the route and show its message (§2.4).
- **Stays as planned:** F-67 and F-69 (L-9 / L-10), B3 deep link (U-10), the Settings read, the registry entry (L-10, Q-3).
- **Done here:** F-65, F-66 (Activity drawer), F-68, F-71 / F-72 (Activity half), F-73, D-15 for Activity, F-70 for Activity (the finance half stays).

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | The original picker cannot be deleted (Finance imports it, §2.10). Accept: Activity stops importing it, the file and its contract test stay, the three "L-8 deletes it" comments are corrected, and the deletion moves to the finance adoption slice (recorded in §1, §3 rule 1, §6.2 C-6, §12.3)? | Yes. The alternative (edit `app/admin/finance/**`) is another session's folder |
| Q-2 | Change `writeTabToUrl` to `replaceState(null, …)` (Next syncs `useSearchParams`, so tile hrefs carry the tab), deliberately editing the spy test's "keeping history.state" half, and correct U-2 / §7.11 / §12.3 wording? Or keep today's writer and build tile hrefs from `window.location` in the page? | `null`. One mechanism on the page; `window.location` in render risks a hydration mismatch |
| Q-3 | Registry entry deferred to L-10 (page.tsx keeps a direct `.json(` for Settings until then), or register now by moving the Settings read onto `readJsonBody` (F-67's Settings half, an L-10 item)? | Defer to L-10 |
| Q-4 | Per-tab purpose: move `COSTS_INTRO` from the Costs body into the header (a one-paragraph edit in `CostsTab.tsx`, L-9's file), so no tab shows its intro twice? | Yes; fallback wording in §2.2 if not |
| Q-5 | Tabs: manual activation (arrows move focus, Enter / Space select) with roving `tabIndex`, plus Home / End? | Yes (first selection of Costs or Activity starts a read) |
| Q-6 | Split into L-8a (about 3.2 days) and L-8b (about 1.6 days) at the §9 cut, one workplan, both full cycle? | Yes |
| Q-7 | Record as a page deviation that an unknown-but-well-formed area, a minimum cost over the route's cap, or an over-long custom window from a link shows the route's message instead of being ignored (U-4)? The browser cannot hold the catalog (page guard) | Yes |
| Q-8 | Add the Costs / Activity key-ownership finding to §9 for L-9 now? | Yes |
| Q-9 | `useDrawerResource`: page passes `read(key, signal)` returning `{ ok, data }` or `{ ok, message }`; the hook maps a rejection to `ADMIN_NETWORK_ERROR`; no fetch and no body read inside the hook; `AdminDrawer` gets no new prop. Shape approved? | Yes |
| Q-10 | KPI toggles: Failed and Cost are toggle tiles (`current` + second click returns to the default), AI actions is a plain reset tile with no `current`? | Yes |
| Q-11 | Outcome as `StatusChip` (`ok` / `danger`) in the table and the drawer, removing the page's own green? | Yes (T-6) |
| Q-12 | Keep the list read on `readJsonBody` with page branching (the 409 code must be seen before generic copy) rather than `readAdminResponse`? | Yes |

---

## 13. Product question for the user

None. Every choice here is already decided by the requirement (D-2 (b) for the window choices, D-4 (a) for tile colours, D-15 for "Refresh") or is technical and goes to SA. **For your information:** the old business picker cannot be removed in this slice because the new Finance page still uses it; it will be removed when Finance moves to the shared picker. Nothing changes for you.

---

## Implementation Notes (L-8a)

**Dev, 2026-10-12.** Branch `feature/admin-layout-l8`, worktree `neuronforge-admin-layout`, cut point `5bd27cfc`. Nothing committed. L-8b (`useDrawerResource`, the drawer on `AdminDrawer`, H-1 to H-11, E-5 to E-7, E-10, T-14) not started.

### Files

| File | Action |
|---|---|
| `app/admin/components/layout/adminWindow.ts` | Four extras (`yesterday`, `this_week`, `last_week`, `last_month`), labels, `resolveWindow` branch (copied arithmetic, S-3); header comment |
| `app/admin/components/layout/readJsonBody.ts`, `AdminBusinessPicker.tsx` | Header comments only (re-export gone; original picker kept for Finance) |
| `app/admin/components/layout/__tests__/adminWindow.test.ts` | E-9, E-9b (below), new block for the four extras |
| `app/admin/components/layout/__tests__/DatePresets.render.test.tsx` | New block: the four render after Custom, toggle, Custom seeds dates |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | G-6 comment only |
| `app/admin/components/__tests__/adminWindowExtras.parity.test.ts` | **New** (S-1): parity with `activityPresets.resolvePreset` over 50 instants |
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` | Header comment only |
| `app/admin/business-os-llm/page.tsx` | `AdminPageHeader`, per-tab purpose, Settings actions wrapper, tab keys + roving `tabIndex`, `writeTabToUrl` passes `null`, header comment |
| `app/admin/business-os-llm/activityFilters.ts` | **New**: spec, window wrapper (M-1), `activityRouteSearch` |
| `app/admin/business-os-llm/activityCopy.ts` | `PRESET_LABELS`, its `ActivityPreset` import and `SHOW_ALL_BUSINESSES` removed; bar and KPI words added |
| `app/admin/business-os-llm/components/activity/ActivityTab.tsx` | Hook, memoised request, KPIs, bar, shared states, content wrapper with `aria-busy`, shared `readJsonBody` |
| `app/admin/business-os-llm/components/activity/ActivityFilterBar.tsx` | **New** (replaces `ActivityFilters.tsx`, deleted) |
| `app/admin/business-os-llm/components/activity/ActivityKpis.tsx` | **New** |
| `app/admin/business-os-llm/components/activity/ActivityTable.tsx` | Table constants, `OpenRowButton`, `OutcomeLabel` as `StatusChip` |
| `app/admin/business-os-llm/components/activity/ActivityCountLine.tsx` | `ADMIN_COUNT_LINE` |
| `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx` | One-line import repoint to the shared `readJsonBody` |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | Intro paragraph and `COSTS_INTRO` import removed (Q-4) |
| `app/admin/business-os-llm/readJsonBody.ts` | **Deleted** (R-10) |
| `app/admin/business-os-llm/__tests__/activityFilters.test.ts`, `activityLayout.render.test.tsx` | **New** |
| `app/admin/business-os-llm/__tests__/activityTab.render.test.tsx`, `page.render.test.tsx`, `source.guard.test.ts` | E-1 to E-4, E-8; G-1 to G-4 appended |

### Edited tests and why

| # | Case | Edit | Why |
|---|---|---|---|
| E-1 | `activityTab.render` "a network failure is shown as an error" | Expects `ADMIN_NETWORK_ERROR`, and not "offline" | §5.10 rules 3 and 4 |
| E-2 | `activityTab.render` "every control has an accessible name…" | "Business" for "Account"; From / To after Custom; the nine window buttons in order; "Apply minimum cost"; the "Sort" group | §2.3, C-6 |
| E-3 | `activityTab.render` "typed dates and the minimum cost apply with Apply…" | Split: Custom → dates → Apply; then minimum cost → "Apply minimum cost"; nothing read while typing kept | §2.3 |
| E-4 | `activityTab.render` "choosing a tab writes ?tab=…" | `toHaveBeenLastCalledWith(null, …)`, `history.state` asserted null, retitled; `keep=1` and hidden-but-mounted kept | Q-2 |
| E-8 | `page.render` "pins the subtitle…" | Found by text (a `<p>` inside the header) instead of the gone `page-subtitle` testid; content assertions kept | F-68 |
| E-9 | `adminWindow.test` "are 24 hours and 90 days…" | Six extras and labels; retitled | §2.3 |
| E-9b | `adminWindow.test` "serialises to range, compares by value, and round trips" | **Not listed in §6.2.** Its loop walked every `ADMIN_WINDOW_EXTRAS` member but parses with the page's two listed extras, so it now names `['24h', '90d']`; the four new extras round trip in their own block | Deviation: unavoidable once the shared list grows |

Every other existing case passed unedited, the drill-down suite included (E-5 to E-7 are L-8b).

### Deviations

- **E-9b** (above).
- **T-13** cannot assert "no `text-emerald-` in the table": the shared `StatusChip` `ok` tone is itself `text-emerald-300` (the single shared green, S-7). It asserts every `text-emerald-` element is inside a `[data-tone="ok"]` chip, and every `text-slate-500` element is a record-state marker (`RecordStateMarker` "None" is kept as is per §2.9; recorded as F-116).
- **T-16** opens with `range=last_week&outcome=failed`, not only `outcome=failed`: with no window in the URL the re-parse returns the default object itself, so mutation (q) would not be visible. The window value is what exercises `windowEquals`.
- **Read effect keyed on a memoised object**, not on the query string (`request = useMemo(() => ({ search }), [filters])`): a filters identity change reads, nothing else does. Keyed on the string, mutation (q) would survive T-16.
- **Typed minimum cost: format checked in the bar (QA-L8a-1 fix, supersedes "sent as typed").** A malformed amount ("abc", "5.", ".5", "-1", "1,000") is refused by the same `MIN_COST` rule the URL parse uses (`isMinCostValue`): an inline "Enter an amount like 0.25" (`role="alert"`), no request, nothing written to the URL. A well-formed amount (trimmed) still goes to the route, so its size and precision messages still show (QA E-2). Empty clears the filter. Recorded in §7.11.
- **Tablist look**: the shared header carries its own bottom rule, so the tablist sits under it on its own `border-b` baseline (two rules instead of one); tabs gain a focus-visible purple ring. No shared change.
- **Content wrapper** `activity-content` has `aria-busy` (T-11) but no `tabIndex` and no focus fallback: both are L-8b (T-14).
- **Struck "charged" figure** (`Amount`, shared with the drawer) moved from slate-500 to slate-400 with the table's T-5 fix.
- **Network failure detection**: the list read now wraps only `fetch` in its own `try` (a rejection there is a network failure); behaviour otherwise unchanged. No logger (the page guard bans `@/lib/`, as before).

### Visible changes on `/admin/business-os-llm` (L-8a)

1. Shared header: the "Read-only" pill becomes the slate chip; the purpose line follows the tab (Settings, Costs & credits and Activity each show their own intro; the Costs and Activity bodies no longer repeat it).
2. Tabs: Left / Right / Home / End move focus, Enter / Space select, only the selected tab is in the Tab order; a focus ring; the tabs sit on their own baseline under the header's rule.
3. Activity: four tiles (AI actions, Failed, Cost (USD, net), Unresolved corrections); window row Today, 7 days, 30 days, This month, Custom, Yesterday, This week, Last week, Last month, From / To only under Custom; "Business" picker with chip "Business: {name}" and X "Remove business"; Minimum cost with its own Apply; Sort with a visible label; Clear; "Read at HH:mm UTC" and a worded "Refresh"; every filter in the address bar.
4. Table: `text-sm`, tabular figures, Outcome as a chip (also in the drawer and its grouping table, still the old drawer shell), ids and "Unknown" in slate-400, the shared Open button with a focus-visible ring.
5. States: "Reading the AI activity…" (same words), a network failure says "Could not reach the server…" with Try again, any error has Try again (except the platform-account notice), an empty list offers "Clear filters" while a filter is on; the notices list is `text-sm`.

### Verification (real output)

| # | Check | Result |
|---|---|---|
| V-0 | Baseline, before any source edit: the full requested set | 58 suites, 1,614 tests, all passed. Per folder: finance 3 / 66, audit-trail 14 / 228, business-os-llm 11 / 430 |
| V-1 | `npx jest app/admin/business-os-llm app/admin/components/layout app/admin/components/__tests__ app/admin/audit-trail app/admin/finance app/admin/analytics lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | 61 suites, 1,812 tests, all passed. Finance 3 / 66 and audit-trail 14 / 228 (equal to V-0); business-os-llm 13 / 618; app/admin/components 21 / 585 |
| V-2 | `npm run test:bos-llm` | 23 suites, 625 tests passed (23 snapshots) |
| V-2 | `npm run typecheck:bos-llm` | "499 files in scope, 28 errors, 0 new … passed". It also reports one baseline entry now fixed (`app/api/onboarding/build/route.ts` TS18047), unrelated to this slice |
| V-3 | `npm run test:bos-entitlements` | 242 suites, 7,062 tests passed |
| V-4 | Scoped `tsc -p` (scratchpad tsconfig extending the worktree's; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`, the parity test, the picker contract test; `--listFilesOnly` first) | Run 1 with `canary.ts` (`const canary: number = 'x';`): exit 2, exactly one error, `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 without the canary: exit 0, no output |
| V-5 | `npm run lint:hooks`; `npx eslint` on the 23 touched or new source and test files | Both clean (eslint exit 0) |
| V-6 | Mutations (a), (b), (c), (d), (i), (j), (k), (l), (o), (p), (q): each applied, run, restored; md5 of the file equal after restore, `git diff` md5 equal before and after the whole run | All 11 RED. (a) E-4 + G-4; (b) T-4 minute bound + one-sided; (c) T-11; (d) T-6 (and T-5); (i) G-1 import; (j) G-1 re-export; (k) T-7; (l) T-8; (o) T-1; (p) T-2; (q) T-16 |
| V-7 | `git diff --stat 5bd27cfc -- app/api lib app/admin/finance app/admin/audit-trail/BusinessAccountPicker.tsx app/admin/business-os-llm/components/settings` | Empty (there is no `components/settings` folder; the Settings components sit at `components/*.tsx`, none touched). `components/costs`: `CostsTab.tsx` only, 3 deletions (the import name, the paragraph, its blank line) |
| V-8 | Greps in the page folder | No `console.`, no `window.history.state`, no `as any`, no `@/app/admin/audit-trail/` import. `.json(` remains only outside Activity: `page.tsx` (Settings read, L-10), `CostsTab.tsx` and `LeakCheckPanel.tsx` (L-9), `LedgerCheckPanel.tsx` (parked). `text-emerald-` remains in an `ActivityTable.tsx` comment and in `LeakCheckPanel.tsx` (Costs, L-9). Shared folder (S-6): no `getProviderFactory`, no `@/lib/ai`; `fetch(` only in `AdminBusinessPicker.tsx` |
| V-9 | `git diff --stat 5bd27cfc` before reading the diff | 20 tracked files, 639 insertions, 512 deletions; the only emptied files are the two planned deletions (`ActivityFilters.tsx`, `business-os-llm/readJsonBody.ts`); 7 new files |

Line endings preserved (page folder CRLF in the working copy, shared folder LF). No backslash in either MD.

### QA-L8a-1 fix

**Dev, 2026-10-12** (TL decision: fix before commit, nothing else).

| Item | Detail |
|---|---|
| Cause | A malformed applied minimum cost was written to the URL; the next outside change (a tab click) re-parsed it to `''`, so `filters` changed: one extra list read, the filter silently dropped |
| Fix | `activityFilters.ts` exports `isMinCostValue` (the `MIN_COST` rule), used by both the URL parse and the bar. `ActivityFilterBar.tsx`: `applyMinCost` (button and Enter) refuses a non-empty value that fails it: inline `role="alert"` "Enter an amount like 0.25" (`MIN_COST_FORMAT_PROBLEM` in `activityCopy.ts`) beside "Apply minimum cost", `aria-invalid` + `aria-describedby` on the input, no `setFilters` (no request, no URL write). The message clears on typing or on any applied change. Well-formed values (trimmed) still go to the route |
| Tests (`activityLayout.render`, describe "QA-L8a-1") | For each of "abc", "5.", ".5", "-1", "1,000": the inline message, `aria-invalid`, zero list requests, no `replaceState`, URL still `?tab=activity`, then Settings and back: zero requests. Enter refuses the same way; typing clears the message; "0.25" applies with exactly one request and `min_cost=0.25`. A well-formed but too-large "1000000" still reaches the route and shows its message |
| Mutation | Check made never-true in `ActivityFilterBar.tsx` → 6 failed (the five malformed cases and the Enter / valid case); restored, md5 equal (8e63b561…c48017 before and after) |
| Re-run | `npx jest app/admin/business-os-llm app/admin/components/layout --ci`: 29 suites, 1,145 tests passed. `npm run test:bos-llm`: 23 suites, 625 passed. `npx eslint` on the four touched files: clean; `npm run lint:hooks`: clean. Scoped `tsc`: canary run exit 2 with exactly `canary.ts(1,7): error TS2322`, clean run exit 0 |
| Files | `app/admin/business-os-llm/activityFilters.ts`, `activityCopy.ts`, `components/activity/ActivityFilterBar.tsx`, `__tests__/activityLayout.render.test.tsx` |
| Visible change | A malformed minimum cost now shows "Enter an amount like 0.25" next to Apply instead of the route's format message; the route's "less than $1,000,000" and "at most 10 decimal places" messages are unchanged |

### Out of scope, found on the way (listed, not fixed)

- `typecheck:bos-llm` reports a now-fixed baseline entry in `app/api/onboarding/build/route.ts` ("consider --update-baseline"): unrelated, not touched.
- The four §11 findings are recorded in the requirement as F-112 to F-117 (with F-114 the route's unknown-area copy, Q-7, and F-115 `activityPresets.ts`, S-4).

## Implementation Notes (L-8b)

**Dev, 2026-10-12.** Branch `feature/admin-layout-l8b`, worktree `neuronforge-admin-layout`, cut from the L-8a commit (HEAD `25bc0a8b`, code `f67ece30`). Nothing committed. Scope per SA M-3 / M-4 / Q-9 and SA code review (L-8a) comment 2.

### Files

| File | Action |
|---|---|
| `app/admin/components/layout/useDrawerResource.ts` | **New** (97 lines, LF, no `'use client'`): `useDrawerResource<T>(key, read)`, types `DrawerRead<T>`, `DrawerResourceState<T>`, `DrawerReader<T>`. Imports `react` and `./readAdminResponse` only. No `fetch`, no `.json(`, no history write |
| `app/admin/components/layout/__tests__/useDrawerResource.render.test.tsx` | **New**: H-1 to H-11 (13 cases; H-8 and H-11 each have a second case) |
| `app/admin/components/layout/AdminDrawer.tsx` | Header comment only (D-7 states come from `useDrawerResource` + `AdminLoading` / `AdminError` as children; no prop added, SA Q-9) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | E-10: `useDrawerResource.ts` in `EXPECTED_SOURCES`; an "Amended by L-8b" header paragraph. No rule change, no registry entry (L-10, SA Q-3) |
| `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx` | On `AdminDrawer` + `DrawerSection` / `DrawerFields` / `DrawerField` + `AdminLoading` / `AdminError` + `useDrawerResource`; module-level `readDrillDown(actionId, signal)` does the fetch and the body read (404 first, then `readJsonBody`, then the route's `error` or `DRILL_DOWN_ERROR_FALLBACK`); own `Sheet` wiring, `Section`, `Field` and the state machine removed |
| `app/admin/business-os-llm/components/activity/ActivityTab.tsx` | `contentRef` + `tabIndex={-1}` + `focus:outline-none` on `activity-content`; `returnFocus` falls back to it when the opener is detached; comments. The drawer stays rendered once, outside every branch |
| `app/admin/business-os-llm/activityCopy.ts` | `OPEN_DETAILS` and its stale comment deleted (SA code review L-8a comment 2); `DRILL_DOWN_LOADING` replaced by `DRILL_DOWN_WHAT = 'the AI action'` (the shared state reads "Reading the AI action…", the same words) |
| `app/admin/business-os-llm/__tests__/activityDrillDown.render.test.tsx` | E-5, E-6 (below) |
| `app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx` | T-14 (two cases) appended; header comment and one copy import |

### Edited tests and why

| # | Case | Edit | Why |
|---|---|---|---|
| E-5 | `activityDrillDown.render` "a network failure is shown as an error" | Expects `ADMIN_NETWORK_ERROR` and not "offline" | §5.10 rule 3; the hook maps a rejection to the shared words |
| E-6 | `activityDrillDown.render` "each section is a region labelled by its heading id…" | Retitled "named group"; `getByRole('region', …)` → `getByRole('group', …)`; adds "no region in the dialog" | A-9, `DrawerSection` |
| E-7 | `activityDrillDown.render` close button | **Not edited**, passes: the X is still a direct child of the dialog and carries `[&>button]:text-slate-300` from `AdminDrawer` | Pinned (§12.3 L-8 item) |

Every other existing case passed unedited, including the 404, the HTML 404 / 502, "a response for a drawer already closed never sets it", Escape-returns-focus and the section, title and heading pins.

### Deviations

- **Close-when-gone (L-1d QA B-1).** The Audit trail and AI cost & usage drawers render the loaded row, so they close when it leaves the data. The Activity drawer reads its own action from the server, so a list read that lands without the row (in flight when the row was opened) leaves the drawer **open on valid data**, and T-14 closes it with Escape as the approved workplan wrote it. The B-1 hazard itself (a hidden "open" state that a later read reopens unasked) cannot arise: one state, `openActionId`, drives the drawer and closing clears it. T-14 pins it: after the close, a read that brings the row back does not reopen the drawer and sends no second drill-down request. SA to confirm.
- **`DRILL_DOWN_LOADING` removed** with `OPEN_DETAILS`: the shared `AdminLoading` builds the sentence from `DRILL_DOWN_WHAT`, so the old constant had no consumer. Same words on screen. The `drill-down-loading` testid stays on a wrapper (no test pins it).
- **`drill-down-entry-fields`**: `DrawerFields` takes no testid, so a wrapper `div` carries it (the pinned case reads its text).
- **Closing clears the hook's answer** (an effect on key `null`), so reopening the same key shows `loading` until its new read lands instead of the earlier figures (H-7).
- **The drawer's error state has no "Try again"** (as before: reopening the row reads again). Not asked for; recorded only.

### Visible changes (L-8b)

1. Drawer title in slate-100 by an inline colour, readable in the light scheme (F-65); the close X keeps its slate-300 colour, at full opacity, with a purple focus ring (F-66); the panel gains `[color-scheme:dark]` and is full width up to `sm:max-w-3xl` by inline style, as every shared drawer.
2. Field text one step larger (`text-xs` → `text-sm`, `DrawerFields`); the action-type suffix sits after a real space (`ml-1` instead of `ml-2`).
3. Sections are named groups, not regions (screen-reader landmark list shrinks; headings and order unchanged).
4. Loading is the shared spinner line (same words); errors are the shared red block (`role="alert"`); a network failure says "Could not reach the server. Check your connection and try again." instead of the browser's text.
5. Closing the drawer after its row has left the list puts focus on the content area instead of `<body>`.

### Verification (real output)

| # | Check | Result |
|---|---|---|
| V-1 | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/finance lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | 54 suites, 1,652 tests, all passed. Finance 3 suites and audit-trail 14 suites green with no edit |
| V-2 | `npm run test:bos-llm` | 23 suites, 625 tests passed, 23 snapshots passed |
| V-2 | `npm run typecheck:bos-llm` | "499 files in scope, 28 errors, 0 new … passed" (plus the unrelated now-fixed baseline entry in `app/api/onboarding/build/route.ts`, as in L-8a) |
| V-3 | `npm run test:bos-entitlements` | 242 suites, 7,062 tests passed, exit 0 |
| V-4 | Scoped `tsc -p` (scratchpad `l8b/`, extends the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`; `--listFilesOnly` first: the hook, its test and the drawer listed) | Run 1 with `canary.ts` (`const canary: number = 'x';`): exit 2, exactly one error, `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 without it: exit 0, no output |
| V-5 | `npm run lint:hooks`; `npx eslint` on the 9 touched or new files | Both clean (exit 0, no output) |
| V-6 | Mutations (e), (f), (g), (h), (m), (n), (r): each applied by script, run, restored; file md5 equal after restore; `git diff` md5 equal before and after the run (`cc6dc847…`) | All 7 RED. (e) H-4 + E-5; (f) H-5, H-6, H-9 + "a response for a drawer already closed never sets it"; (g) H-8; (h) layout guard L-1e F-1 (both the per-file rule and "AdminBusinessPicker.tsx is the one file that fetches"); (m) T-14; (n) "HTML 404" + "404 shows the not-found line" (404 decided after the generic error branch); (r) both H-11 cases |
| V-7 | `git diff --stat HEAD -- app/api lib app/admin/finance app/admin/audit-trail app/admin/business-os-llm/components/costs` | Empty |
| V-8 | Greps | No `console.`, `as any`, `window.history.state` or `text-emerald-` in the touched sources; no `.json(` in `components/activity/`; shared folder: `fetch(` only in `AdminBusinessPicker.tsx`, no `getProviderFactory`, no `@/lib/ai` |
| V-9 | `git status --short` and `git diff --stat` before reading the diff | 7 modified, 2 new; 222 insertions, 173 deletions; no file emptied (`ActivityDrillDown.tsx` 91 / 161, from 349 to 279 lines, the state machine and local `Section` / `Field` gone) |

Line endings preserved: the page folder sources and `activityDrillDown.render` stay CRLF in the working copy (every line), the shared folder and `activityLayout.render` stay LF, the two new files are LF. No backslash in either MD.

TL fold-in (QA E-2): useDrawerResource wraps the read call in a same-tick try/catch so a synchronous throw shows ADMIN_NETWORK_ERROR; test H-4b; mutation (remove the catch) → red, restored md5-equal.

### Out of scope, found on the way (listed, not fixed)

- The drill-down error has no "Try again" (pre-existing).
- F-116 drawer half (the business short id and "Unknown" in slate-500; the corrections and charges tables in `text-xs`) left as is.
- QA L-8a E-1 (focus after "Try again" falls to `<body>`, shared `AdminError`) is not covered by the T-14 fallback; still open beside F-104.

## SA Review Notes

See the SA Workplan Review below.

## SA Workplan Review — 2026-10-12

**Reviewed by SA — 2026-10-12** (workplan stage, no code). Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l8`, HEAD `5bd27cfc`.
**Status:** APPROVED WITH CONDITIONS. M-1 to M-4 must be applied to this workplan before coding and are checked at code review. S-1 to S-6 are expected; a Dev who disagrees records why in Implementation Notes.

**Verified in code before ruling:** `FinanceFilterBar.tsx:14` imports the original picker and `financePage.render.test.tsx:39` mocks its path (Q-1 holds); the only importers of `business-os-llm/readJsonBody.ts` are `ActivityTab.tsx:45` and `ActivityDrillDown.tsx:60`, and nobody uses its `ApiBody` type re-export; `page.tsx:90` writes `replaceState(window.history.state, …)` and `activityTab.render.test.tsx:640-656` pins it; `AdminDrawer.tsx:35` carries `[&>button]:text-slate-300` and the focus ring, so the close-button test (`activityDrillDown.render.test.tsx:464-474`) needs no edit; `useAdminFilters` re-parses on every incoming string that differs from `lastKnown` and keeps identity only through each field's `equals` (`mergeKeepingIdentity`); `windowFilter` supplies `windowEquals`; `StatusChip` has fixed per-tone icons (`danger` = `AlertOctagon`, no icon prop); no test pins `COSTS_INTRO`; the route's unknown-`area` answer is Zod's default enum message.

### Rulings on Q-1 to Q-12

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved.** Activity stops importing the original picker; the file and `businessPicker.contract.test.ts` stay (header comment only); the three "L-8 deletes it" comments are corrected; the deletion moves to the finance adoption slice. No edit under `app/admin/finance/**` | Finance is another session's page and still imports it; deleting would break `main`. Recorded as a §9 finding (M-2) |
| Q-2 | **Approved: `writeTabToUrl` passes `null`.** E-4 flips to `toHaveBeenLastCalledWith(null, '', …)` and asserts `window.history.state` is `null` (not just drops the line). SA corrected U-2, §7.11 and §12.3 in the requirement today | One mechanism on the page (L-1c M-1). With the old first argument Next never syncs `useSearchParams`, so tile hrefs built by `hrefFor` would carry a stale `tab`. Building hrefs from `window.location` in render risks a hydration mismatch. **Consequence, see M-1** |
| Q-3 | **Approved: registry entry deferred to L-10** | Registering now needs either the Settings read changed (F-67, L-10 scope) or the registry rule weakened. Neither belongs in L-8 |
| Q-4 | **Approved: move `COSTS_INTRO` into the header now** (remove the paragraph and its import in `CostsTab.tsx`). Drop the fallback wording | Same page folder, so not a cross-folder edit (§3 rule 1). The header is L-8's; keeping both would show the intro twice for a slice, and the fallback is new copy. No test pins the paragraph. L-9's workplan inherits it |
| Q-5 | **Approved:** arrow keys move focus, Enter / Space select (manual activation), roving `tabIndex`, Home / End | Not a behaviour addition: A-4 and §7.11 already require arrow keys, and roving `tabIndex` with manual activation is the APG tablist pattern when selecting a panel starts a read. Home / End are part of the same pattern |
| Q-6 | **Approved: split L-8a / L-8b at the §9 cut, both full cycle, one workplan.** See M-3 | 4.8 days is over the slice size. L-8a is full cycle because it extends the shared `adminWindow` (R-7 precedent); L-8b because it builds `useDrawerResource` (R-6). The hook ships with exactly one consumer (SA-R-3) |
| Q-7 | **Approved as a recorded page deviation from U-4** | The browser cannot hold the catalog (page guard) or the route's caps without importing `@/lib/`. The bar stays mounted so Clear always recovers. The unknown-area message is Zod's default enum text, admin-only: record a §9 API-copy finding (own slice), not fixed here |
| Q-8 | **Approved: add the finding now, with SA's direction for L-9.** Direction: (1) the address bar describes the **visible** tab only; (2) a hidden tab's `useAdminFilters` neither re-reads nor writes (an `active` option on the hook, a shared change, so L-9 runs the full cycle); (3) on a tab switch the page writes `tab` plus the incoming tab's projection and drops the leaving tab's owned keys; (4) canonical names stay (U-5), no per-tab prefixes. L-9's workplan confirms or argues against it | Two mounted hooks owning `range` / `from` / `to` / `account` would each treat the other's write as an outside change and re-read, so the hidden tab would follow the visible tab's filters and start reads. Prefixes would break U-5 and every shared link. L-8 needs nothing built for it; until L-9, Settings and Costs URLs may carry Activity's keys, which is harmless (only Activity reads them) |
| Q-9 | **Approved with M-4.** `useDrawerResource(key, read)`; the page's `read(key, signal)` does the `fetch` and the body read and returns `{ ok: true, data }` or `{ ok: false, message }`; a rejection maps to `ADMIN_NETWORK_ERROR`; latest `read` in a ref; `AdminDrawer` gains no prop | Keeps L-1e F-1 (only the picker fetches) and S-6 (only `readJsonBody` reads bodies) true for the shared folder without a new guard exception. The 404-first rule stays in the page's `read`, where the status is known |
| Q-10 | **Approved.** Failed and Cost are toggle tiles; when `current`, their `href` is the toggled-off view (the L-2a `AnalyticsKpis.tsx:133` precedent), not the applied one. AI actions is a reset link with no `current` | Same-page filter mode as built in L-2a; a tile whose href re-applies what is already applied would be a dead link |
| Q-11 | **Approved with a correction (S-2):** `StatusChip` `ok` / `danger` in the table, drawer and `DrillDownCharges` (via `OutcomeLabel`), with the chip's own tone icons. No icon prop is added to `StatusChip` | Removes the second green (T-6). `StatusChip` fixes the icon per tone; adding a prop is a shared change nobody needs |
| Q-12 | **Approved:** the list read keeps `readJsonBody` with page branching | The 409 `platform_account` code must be seen before generic copy; `readAdminResponse` would surface the code as the message |

### Findings

**Must (apply to this workplan before coding):**

| # | Finding | Required change |
|---|---|---|
| M-1 | **Every tab click is now an outside change for the mounted Activity hook.** With `replaceState(null, …)` Next syncs `useSearchParams`, so `tab=settings` / `tab=activity` changes the incoming string, it differs from `lastKnown`, and the hook re-parses every field. The filters keep their identity only if every field's `equals` is structural. The plan's wrapped window field (linked and one-sided values ignored) must keep `equals: windowEquals`; if the wrapper rebuilds the field without it, `Object.is` on a fresh window object changes `filters`, the memoised route search changes, and **every tab switch starts a list read** | §2.4: the wrapper spreads `windowFilter(...)` and overrides `parse` only (keeps `keys`, `serialise`, `equals`). New case **T-16** in `activityLayout.render`: the `next/navigation` mock returns `new URLSearchParams(window.location.search)` on every render (not a fixed `mockSearch`); open Activity with `outcome=failed`, switch to Settings and back: zero further list reads, filters and table intact, no URL write beyond the two `tab` writes. New mutation **V-6 (q)**: drop `equals` from the wrapper → T-16 fails |
| M-2 | Q-1 records | §2.10 item (4) is Dev's task 14 and stays; in addition: a new §9 finding (open, owner: the finance adoption slice) naming `FinanceFilterBar.tsx:14` and `financePage.render.test.tsx:39`; F-56 and F-70 rows say the original picker keeps `createLogger` until that slice; G-1 asserts no **page-folder** import of the original picker and the absence of `business-os-llm/readJsonBody.ts`, never the absence of the picker file. §3 rule 1 and §6.2 C-6 lose "deletes the original picker" for L-8 (Dev, task 14). SA already corrected U-2, §7.11 and §12.3 |
| M-3 | Split execution (Q-6) | L-8a = header, tabs, tab writer, Costs paragraph, window extras, filter spec, bar, URL, KPI strip, states, count line, table, `OutcomeLabel` chip (visible in the drawer too: name it in the L-8a PR), both `readJsonBody` repoints and the re-export deletion, G-1 to G-4, E-1 to E-4, E-8, E-9, T-1 to T-13, T-15, T-16. L-8b = `useDrawerResource`, H-1 to H-11, E-5 to E-7, E-10, T-14 (focus fallback), the drawer on `AdminDrawer`, the `AdminDrawer.tsx` header comment. Each half gets its own SA code review and QA. **Both PRs target `main`**; L-8b is cut from the L-8a commit and is never opened against the L-8a branch (stacked-merge hazard: a PR merged into a parent branch never reaches `main`). Re-tag §6 / §7 / §8 items with their half before coding |
| M-4 | `useDrawerResource` stale frame and unmount | With state set in an effect, a key change A → B renders once with B's key and A's `ready` data (A's body under B's title). The hook keeps the key its state belongs to and returns `loading` whenever that key differs from the current one, so no render ever shows another key's data. Add **H-10** (unmount while loading: the signal is aborted, nothing is set, no act warning) and **H-11** (rerender with key B after A is ready: the very next render is `loading`, never A's data). Mutation **V-6 (r)**: return the stored state without the key check → H-11 fails |

**Should:**

| # | Finding |
|---|---|
| S-1 | The parity test for the four extras (vs `activityPresets.resolvePreset`) lives beside the existing one in `app/admin/components/__tests__/` (extend `adminWindowPresets.test.ts` or a sibling), not in `layout/__tests__/`, so the shared folder's own tests never import a page folder. `adminWindow.test.ts` keeps the page-independent extras cases (parse only when listed, serialise, whole dates, AI cost & usage still refuses `range=yesterday`) |
| S-2 | §2.8 and T-13: the Failed chip uses `StatusChip`'s `danger` icon (`AlertOctagon`), not `XCircle` (Q-11) |
| S-3 | V-7 diffs against the cut point, not `origin/main` (the branch carries L-6 / L-7): `git diff --stat 5bd27cfc -- app/api lib app/admin/finance app/admin/audit-trail/BusinessAccountPicker.tsx app/admin/business-os-llm/components/settings` is empty, and `app/admin/business-os-llm/components/costs` shows only the one paragraph and its import. For L-8b, against the L-8a commit |
| S-4 | New §9 finding (cos, open, L-10): after L-8a `activityPresets.ts` has no runtime consumer (only `activityPresets.test`, the two parity tests, `activityTab.render` expectations and the service-column guard listing). Kept as the parity oracle; L-10 decides whether to freeze the expectations as literal dates and delete it |
| S-5 | KPI sub-lines (K-8): when the list is `capped` **and** some nets are null, the Cost tile shows one sub-line joining both facts, not two; the counts and sum are memoised on the payload |
| S-6 | V-2 stays (`test:bos-llm` is a required check; `typecheck:bos-llm` too). Add a V-8 grep for `getProviderFactory`, `@/lib/ai` and `fetch(` in the shared folder outside `AdminBusinessPicker.tsx`: none |

**Notes:**

- N-1: No AI call, model setting, route, payload or DB change (bos-llm-call-standards, entitlements and schema-check not triggered). The page guard's `@/lib/` ban is not edited (R-9); `useDrawerResource.ts` imports `react` and `./readAdminResponse` only (S-3).
- N-2: An inbound bad `area` gives a 400 and "Try again" re-sends it; that is expected under Q-7. Clear in the mounted bar is the recovery; T-10 need not change.
- N-3: Browser checks L8-B1 to L8-B11 are read-only (every request is a `GET`, the picker's included); safe on the production database. L8-B5 is the only proof of the Next sync (jsdom has no Next patch): QA must not skip it. Add to L8-B2: switching tabs with an Activity filter applied sends no `ai-activity` request (M-1 in a real browser).
- N-4: The `<div hidden={!onSettings}>` wrapper for the Settings actions is accepted: it keeps `costsTab.render`'s `queryByTitle('Re-read the settings')` true and F-69 / D-15 for Settings stay L-10.
- N-5: Finance and audit-trail suites must stay green with zero edits (V-1 counts equal to V-0); the picker contract test changes in its header comment only.

### Verdict

**APPROVED WITH CONDITIONS — proceed to L-8a** once M-1 to M-4 are applied to this file. No product question for the user. SA corrected in the requirement today: §1 row 14 (status, split), new row 14b (L-8b), §5.6 U-2 last sentence, §7.11 (`?tab=` writer, picker deletion), §12.3 L-8 item, Change History.

### Approval
[x] Workplan approved — proceed to implementation (L-8a first), conditions M-1 to M-4

## SA Code Review (L-8a) — 2026-10-12

**Code Review by SA — 2026-10-12.** Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l8`, uncommitted, diffed against `5bd27cfc`.
**Status:** CODE APPROVED. No must-fix. Two Low items are carried to L-8b (below); nothing has to change before the L-8a commit.

### What was checked

| Area | Result |
|---|---|
| Diff shape (V-9) | `git diff --stat` first: 20 tracked files, 659 insertions, 523 deletions; the only emptied files are the two planned deletions (`business-os-llm/readJsonBody.ts`, `components/activity/ActivityFilters.tsx`); 7 new files. No truncation |
| Scope (V-7, S-3) | `git diff --stat 5bd27cfc -- app/api lib app/admin/finance app/admin/audit-trail/BusinessAccountPicker.tsx` is empty. `CostsTab.tsx` loses only the `COSTS_INTRO` import, the paragraph and its blank line. No route, payload, LLM call, model setting or DB change (bos-llm-call-standards, entitlements and schema-check not triggered) |
| M-1 | `activityFilters.ts:87-98` spreads `windowFilter(...)` and overrides `parse` only, so `keys`, `serialise` and `equals: windowEquals` survive. Traced through `useAdminFilters`: a tab click changes `incoming`, the hook re-parses, `mergeKeepingIdentity` returns `prev` because every field's `equals` holds, `filters` keeps its identity, the memoised `request` does not change, no read. The `rereads` bump re-runs the write effect, whose projection equals the current URL, so no write. T-16 (`activityLayout.render.test.tsx:586-611`) uses a `useSearchParams` mock that follows `window.location`, asserts one list read across Settings and back, and exactly two `replaceState(null, …)` calls carrying `tab` |
| Dev note: T-16 needs `range=last_week` | Sound. `parseAll` omits a field with no URL key, and `mergeKeepingIdentity` skips keys absent from `next`, so without a window key the window field is never compared and mutation (q) cannot show. A window value in the URL is the only way the test bites |
| Dev note: effect keyed on a memoised object, not the string | Sound, and accepted. `request = useMemo(() => ({ search }), [filters])` (`ActivityTab.tsx:80`) reads once per `filters` identity change and never otherwise. Keying on the string would hide an identity break (mutation (q)) whenever the dates happen to match, which is exactly what T-16 must catch. Double requests on the URL rewrite: none. The hook sets `lastKnown` before its own `replaceState(null, …)`, so Next's echo is skipped (`useAdminFilters.ts:158`, `:174`); T-3, T-4 (mount clean-up rewrite) and T-5 (Clear) each pin one read |
| `?tab=` writer (Q-2) | `page.tsx` `writeTabToUrl` passes `null`; unrelated params kept (URL built from `window.location.href`). E-4 flipped to `toHaveBeenLastCalledWith(null, '', …)` and asserts `history.state` is `null`. G-4 pins that `page.tsx` is the folder's only history writer and never names `window.history.state`, each rule proved on a planted string |
| Tabs keyboard (Q-5) | Roving `tabIndex` (selected 0, others -1); ArrowRight / ArrowLeft wrap, Home / End, `preventDefault` only on those keys; Enter / Space are the button's own click (manual activation); `role="tab"`, `aria-selected`, `aria-controls`, ids unchanged; focus-visible purple ring added. T-2 pins focus without selection and no report or list read until Enter |
| Window extras (D-2 (b), S-1) | `adminWindow.ts` copies the arithmetic (no page import); the shared folder's own tests stay page-free; the parity test sits in `app/admin/components/__tests__/adminWindowExtras.parity.test.ts` over 50 instants incl. a Monday, a Sunday, 1 January and 1 March of a leap year. AI cost & usage still lists `['24h', '90d']` and refuses `range=yesterday` (pinned). E-9b (loop narrowed to the two listed extras) is an unavoidable consequence of the shared list growing: accepted |
| Filter URL contract | Keys `range` / `from` / `to`, `account`, `area`, `outcome`, `trigger`, `min_cost`, `sort`, in that order; defaults omitted; `tab` and `actionId` kept (T-5). Linked and one-sided windows ignored (T-4). The route parameter set and order are unchanged for the same values (`activityRouteSearch`) |
| Shared picker | `ActivityFilterBar.tsx` uses `AdminBusinessPicker` + `businessFilterChip`; no page file imports the original (G-1). The original picker is untouched (V-7) and only three comments changed (picker header, contract test header, layout guard G-6). Finance 3 suites / 66 tests and audit-trail 14 / 228 green with no edit (294 tests, equal to V-0) |
| `readJsonBody` | Re-export deleted; both importers (`ActivityTab.tsx:43`, `ActivityDrillDown.tsx:60`) point at the shared file through the alias; no other importer anywhere (grep) |
| KPI tiles (Q-10, K-5, S-5) | Failed and Cost toggle (`current` → the toggled-off href); AI actions is a reset tile without `current`; Unresolved has no target and is amber only when greater than 0; Cost joins capped and missing-net into one sub-line; figures memoised on the payload; hidden on error and before the cut-over; placeholders on the first read |
| Outcome chip (Q-11, S-2) | `OutcomeLabel` = `StatusChip` `ok` / `danger` with the chip's own icons (`AlertOctagon` for Failed), no icon prop added; T-13 compares the icon with a reference `StatusChip` |
| Narrowed T-13 | Accepted. The only remaining green is the shared `ok` tone (S-7), and the only slate-500 is `RecordStateMarker`, recorded as F-116 |
| Min cost sent as typed | Accepted. The route's admin-worded messages still show (QA E-2); an invalid value lands in the URL but is ignored on reload (U-4) and a tab switch does not read it again (it does not parse, so the field keeps its value). **Superseded by the QA-L8a-1 fix (Dev, 2026-10-12):** the "tab switch does not read it again" reasoning did not hold (`parseAll` starts from the defaults, so the dropped field compares as `''` and the filters change). The bar now refuses a malformed amount with the URL parse's own format rule (inline message, no request, no URL write); only well-formed amounts reach the route, which keeps its size and precision messages. See "QA-L8a-1 fix" in the Implementation Notes |
| `COSTS_INTRO` moved (Q-4) | In `PURPOSE` in `page.tsx`; `CostsTab.tsx` changes only that paragraph |
| Page guard | The existing `@/lib/` rule is not edited (R-9); G-1 to G-4 appended, each with a self-test on a planted string |
| Standards | No `console.*`, no `any` in the touched sources; no new pattern; eslint clean on the seven main sources; no backslash in either MD |
| Line endings | Every blob is LF at HEAD with `core.autocrlf=true`. The working copy keeps each file's existing form (the page folder CRLF, the shared folder LF, the new files LF), and the diff shows no whole-file churn. All of it normalises to LF on commit |

**Tests run by SA:** `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/finance --ci`: 51 suites, 1,497 tests passed. `npx jest app/admin/analytics lib/business-os/credits/__tests__/serviceColumn.guard.test.ts --ci`: 9 suites, 275 passed. `npm run test:bos-llm`: 23 suites, 625 passed, 23 snapshots.

### Code Review Comments

1. `app/admin/business-os-llm/page.tsx:232` — the tablist keeps its own `border-b` under the shared header's `border-b`, so the tabs sit between two rules. **Cosmetic, acceptable as built; do not remove the tablist rule.** The tabs use `-mb-px border-b-2` to sit on a baseline, and without the nav rule the selected tab's purple underline would float with no line to sit on. If a single rule is wanted later, that is a shared header option (no rule when tabs follow), a shared change for a later slice, not a page hack. QA eyeballs it in L8-B9 — Priority: Low
2. `app/admin/business-os-llm/activityCopy.ts:201-202` — `OPEN_DETAILS` has no consumer any more (`OpenRowButton` renders its own "Open"), and its comment still calls it "the row button's visible text". It is the same kind of dead copy as `PRESET_LABELS` / `SHOW_ALL_BUSINESSES`, which this slice removed. **Carried to L-8b**, which edits the drawer copy in the same file: delete it there. Not a commit blocker — Priority: Low
3. `app/admin/analytics/analyticsFilters.ts:220` (not in this diff) — `ROLLING_PERIOD_DAYS[value.extra]` is typed `Record<string, number>`, so the widened `AdminWindowExtra` union compiles silently. It cannot be reached at runtime, because Analytics parses only `24h` / `90d` (pinned in `adminWindow.test`). Record it for the slice that next touches Analytics: narrow the lookup to `'24h' | '90d'` so a future extra fails type-check instead of sending `period=undefined`. No action in L-8a — Priority: Low

### Optimisation Suggestions

- `activityFilters.ts` is a new page-level module beside `activityTypes.ts`. It names no ledger column, so the service-column guard does not need it. If it ever grows a cost or service field, add it to `ACTIVITY_SCREEN_MODULES` in `serviceColumn.guard.test.ts`.
- The L-8a PR must name, under visible changes, the outcome chip that also shows in the still-old drawer and `DrillDownCharges` (M-3). Dev's list item 4 already does.

### For QA

L8-B1 to L8-B11 apply, minus the L-8b drawer items in L8-B8 (the drawer is still the old shell; only the outcome chip inside it is new). **L8-B5 is mandatory**: it is the only real-browser proof of the Next `useSearchParams` sync. **Also mandatory: the N-3 addition to L8-B2.** With an Activity filter applied, switching to Settings and back sends no `ai-activity` request.

### Code Approved for QA: Yes

## SA Code Review (L-8b) — 2026-10-12

**Reviewed by SA — 2026-10-12**
**Status:** ✅ Code Approved (no must-fix)

Diff against HEAD `25bc0a8b` on `feature/admin-layout-l8b`: 7 modified, 2 new (`useDrawerResource.ts` and its render test). `git diff --stat` checked first: no file emptied; `ActivityDrillDown.tsx` went from 349 to 279 lines (the old state machine and the local `Section` / `Field` gone). Nothing under `app/api` or `lib/` changed: no LLM, data or route change.

### What was checked

| Item | Result |
|---|---|
| Hook API (Q-9) | `useDrawerResource(key, read)`; imports only `react` and `./readAdminResponse`; no `fetch`, no body read. The latest `read` is in a ref, updated by an effect declared before the read effect, so a commit that changes both runs the new function (H-8 second case). The read effect depends on `[key]` only |
| Abort and newest-wins | A fresh `AbortController` per key; the cleanup sets `current = false` and aborts on key change, close and unmount. Both the resolve and the reject handler check `current` first, so a late answer or an `AbortError` sets nothing |
| Rejection | A current rejection maps to `ADMIN_NETWORK_ERROR`, never the rejection's text (H-4, E-5) |
| M-4 stale frame | The state is `Settled<T>` tagged with its key; the hook returns `loading` whenever the tag differs from the current key, so the first render after A to B is `loading` before any effect runs (H-11, both cases) |
| Close clears the answer | The `key === null` branch sets the stored answer to null, so reopening the same key shows `loading` until the new read lands (H-7) |
| H-1 to H-11 | Meaningful: a frame recorder proves "sets nothing" (frame count unchanged), not only the final text; `console.error` is spied and asserted uncalled in `afterEach`, so an act warning fails the case. H-10's "no warning" half is weaker under React 18 (it no longer warns on a set after unmount), but the unchanged frame count and the aborted signal carry it |
| Shared folder | No `'use client'` (a hook module, as `useAdminFilters.ts`; the consuming component carries it). `EXPECTED_SOURCES` gains `useDrawerResource.ts` (E-10) with an amendment paragraph; no rule change; L-1e F-1 (only the picker fetches) and S-6 green |
| `readDrillDown` | Module-level, stable identity. 404 decided on the status before any body read (QA-B2a-2); then `readJsonBody`; then the route's `error` string, else `DRILL_DOWN_ERROR_FALLBACK`. A rejected `fetch` is left to reject into the hook |
| Drawer body | `AdminDrawer` with `testId="activity-drill-down"`, `DRILL_DOWN_TITLE`, suffix = the opened charge's action type when ready. Every section kept in order (action, corrections, entry, group) with its heading and testid; `drill-down-entry-fields` and `drill-down-loading` kept on wrappers. The X stays a direct child of `SheetContent` (the children sit in a wrapper `div`), so E-7 passes unedited |
| Page placement | `ActivityDrillDown` rendered once at the end of `ActivityTab`, outside every state branch (`ActivityTab.tsx:280`) |
| Focus (D-6, T-14) | `returnFocus` focuses the opener when still connected, else `activity-content` (`tabIndex={-1}`, always mounted), never `<body>`. Same pattern as Audit trail (`audit-trail/page.tsx:1044`), Analytics, Messages and Users |
| Copy | `OPEN_DETAILS` removed (L-8a comment 2 closed); `DRILL_DOWN_LOADING` replaced by `DRILL_DOWN_WHAT`, same words on screen. No remaining reference to either |
| Edited tests | E-5 (the shared network words, and asserts "offline" is gone) and E-6 (`group`, not `region`, plus "no region in the dialog") are exactly the edits §6.2 approved; nothing else edited |
| Accessibility | Sections are named groups; no region inside the dialog (pinned by E-6); loading is `role="status"`, error `role="alert"` |
| Standards | No `console.*`, no `any`, no `@/lib/` import added (the page's source guard is green); lint and hooks lint clean per V-5 |
| Line endings | New files LF; the modified files show no whole-file churn in the diff; all normalise to LF on commit |

**Tests run by SA:** `npx jest app/admin/business-os-llm app/admin/components --ci`: 35 suites, 1,233 tests passed. `npm run test:bos-llm`: 23 suites, 625 tests, 23 snapshots passed.

### Ruling on the Dev deviation (no close-when-gone)

**Accepted as a recorded deviation. Close-when-gone is not required for this drawer.**

1. Close-when-gone was never a §5.8 rule. It was the L-1d / L-2a QA B-1 fix for drawers that **render the loaded row**: when the row leaves the data they have nothing true left to show, and a hidden "open" id could reopen the drawer unasked. This drawer reads its own action by id from the server, so what it shows stays correct whatever the list does.
2. The admin cannot change a filter while the drawer is open: the sheet is modal (focus trap, overlay). The list can only change under an open drawer through a read already in flight when the row was opened (a Refresh, or a filter read just started). Closing the drawer then would take the detail away from an admin who did nothing, which is the more confusing outcome. Leaving it open on valid data is the helpful one.
3. The B-1 hazard cannot occur: one state (`openActionId`) drives the drawer and closing clears it. T-14 pins it (no reopen when the row returns, and exactly one drill-down request).
4. Consistency: the rule to carry forward is "a drawer that renders a loaded row closes when the row leaves the data; a drawer that owns its read (`useDrawerResource`) stays open on its own data; both return focus to the opener, else to the content area". SA added this to the requirement §5.8 D-7 today, so later slices (L-9, L-10, Finance) do not have to decide it again.

### Code Review Comments

1. `app/admin/components/layout/useDrawerResource.ts:95` — if a key goes A (ready) to B and back to A without a close, the stored A answer shows again while A is re-read. That is A's data under A's title, so M-4 holds, and the Activity drawer cannot reach it (the drawer is modal and every key change passes through `null`, which clears the answer). Recorded for the hook's next consumer only; no action — Priority: Low
2. `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx:66` — the `readJsonBody` import sits below the type imports instead of with the other shared-folder imports at the top. Cosmetic — Priority: Low
3. The drawer's error state has no "Try again" (pre-existing; Dev recorded it). Reopening the row reads again, so no admin is stuck. Out of scope — Priority: Low

### Optimisation Suggestions

- The L-8b PR must list Dev's five visible changes (title colour and X focus ring, `text-sm` fields, groups instead of regions, shared loading / error states with the shared network sentence, the focus fallback).
- When a second `useDrawerResource` consumer arrives, consider a "Try again" on its `AdminError` through a `retry` the hook returns. Not now (SA-R-3: one consumer).

### For QA

The L8-B8 drawer-shell items now apply in full: in light and dark emulation the title is readable, the X is visible and shows a purple focus ring; Escape, overlay and X close the drawer; focus returns to the row's Open button. With DevTools set to offline, opening a row shows the shared network sentence, not the browser's text. The fallback to the content area (row gone from the list) is hard to time by hand; T-14 in Jest is its proof.

### Code Approved for QA: Yes

## QA Testing Report

L-8a: see "QA Report (L-8a) — 2026-10-12" below. L-8b: see "QA Report (L-8b) — 2026-10-12" below (PASS).

## QA Report (L-8a) — 2026-10-12

**QA — 2026-10-12.** Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l8`, uncommitted, base `5bd27cfc`.
**Test mode:** full (focus ui, api-read behaviour, a11y)
**Strategy used:** A (Jest + jsdom render probes with mocked `fetch` only) and the scoped `tsc`; D (manual browser) handed to TL as a checklist below, because jsdom has no Next `useSearchParams` patch
**Skipped:** L-8b items (drawer on `AdminDrawer`, `useDrawerResource`, H-1 to H-11, T-14, the L8-B8 drawer-shell items); live browser checks (listed for TL)
**Input source:** prompt keywords (TL trigger) + workplan §7.1 and SA "For QA"

### Commands run (real output)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/finance app/admin/analytics lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | 61 suites, 1,812 tests passed, exit 0 (equal to Dev V-1). One "worker process has failed to exit gracefully" notice, informational, no failure |
| Q-2 | `npm run test:bos-llm` | 23 suites, 625 tests passed, 23 snapshots passed |
| Q-3 | `npm run typecheck:bos-llm` | "499 files in scope, 28 errors, 0 new … passed" (plus the unrelated now-fixed baseline entry in `app/api/onboarding/build/route.ts`, as Dev reported) |
| Q-4 | `npm run test:bos-entitlements` | 242 suites, 7,062 tests passed |
| Q-5 | Scoped `tsc -p` in the session scratchpad `qa-l8a/` (extends the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`, the parity test, the picker contract test, `app/admin/analytics/**`; `--listFilesOnly` first) | Run 1 with `canary.ts` (`const canary: number = 'x';`): exit 2, exactly one error, `canary.ts(1,7): error TS2322`. Run 2 without it: exit 0, no output (104 app files in scope) |
| Q-6 | `npx eslint` on `page.tsx`, `activityFilters.ts`, `components/activity/*.tsx`, `adminWindow.ts`, `AdminBusinessPicker.tsx`, `CostsTab.tsx` | exit 0 |
| Q-7 | Greps in the page folder for `console.`, `window.history.state`, `as any` (outside tests); `git diff --stat 5bd27cfc -- app/api lib app/admin/finance app/admin/audit-trail/BusinessAccountPicker.tsx` | None in code (one comment word "any"); scope diff empty |

### Edge-case probes

One throwaway file, `app/admin/business-os-llm/__tests__/zz-qa-l8a.probe.test.tsx`, mocked `fetch` only, deleted after the run; `git status --short` identical before and after (20 modified, 7 untracked). Its `useSearchParams` mock is a store that **re-renders** on `replaceState(null, …)` and on `popstate`, and does not sync for a non-null state, which is closer to Next 14.2 than the suite's T-16 mock (that one only re-reads `window.location` when something else re-renders). 43 probes, all passed except the two behaviours recorded as findings below.

| # | Probe | Result |
|---|---|---|
| P1a | Tab switch with filters applied, nine clicks cycling Settings / Costs / Activity in both directions, for: every filter incl. a custom window, account, area, outcome, trigger, min cost, sort; an extra window; a standard preset; defaults only | ✅ Zero further `ai-activity` reads in every case; Settings read once, Costs report read once; filter keys in the URL unchanged, only `tab` changes |
| P1b | Same with the keyboard (Arrow / End + Enter / Space) | ✅ Zero further reads; focus stays on the activated tab |
| P1c | Opened on `?tab=settings&outcome=failed&range=this_week`, then Activity | ✅ No read until Activity is chosen, then exactly one read with this week + failed |
| P1d | An applied minimum cost the URL parser refuses (typed "abc"), then a tab switch | ❌ **One extra read, filter dropped** (QA-L8a-1 below) |
| P2a | Each of the 9 window buttons (except Custom, P2b) clicked → URL → remount on that URL | ✅ One read, request identical, the same button pressed, URL unchanged on reload |
| P2b | Every control set (Custom 2026-10-01 to 2026-10-04 + Apply, Area, Outcome succeeded, Trigger external, min cost " 1.5 " by Enter, Sort cost) → reload | ✅ URL `?tab=activity&range=custom&from=2026-10-01&to=2026-10-04&area=website&outcome=succeeded&trigger=external&min_cost=1.5&sort=cost`; reload sends the identical request once; " 1.5 " trimmed |
| P2c | Invalid / legacy inbound values: `range=24h`, `range=90d` (other pages' extras), `range=LAST_WEEK`, empty values, explicit `sort=time`, `area=Chat`, 65-character area, `min_cost` "1." / ".5" / "-1", custom from after to, 2026-02-30, instant bounds, `trigger=Owner` | ✅ Each: the default request (this month, `sort=time`) once, URL cleaned to `?tab=activity` |
| P2d | `accountId=<uuid>` (not an Activity key) | ✅ Ignored for the read; kept in the URL as an unrelated key (by design: the hook keeps keys it does not own) |
| P2e | Uppercase UUID account, duplicate `outcome` keys, `from` / `to` with no `range` | ✅ Accepted (first value wins, custom implied); URL rewritten once into canonical form |
| P3a | Outside change (popstate) to another filter state, then back | ✅ One read each, controls follow; one canonical-order rewrite (`range` before `trigger`), no write loop. Note: the hook only uses `replaceState`, so filter changes never create Back entries (U-2 by design); Back / Forward between filter states exists only across navigations |
| P3b | Popstate with only `tab` changed | ✅ Zero reads |
| P3c | Outside change to the bare `/admin/business-os-llm` while on Activity with a filter | ⚠️ Filters reset with one read (correct), but the Activity tab stays selected while the URL has no `tab` (E-2 below) |
| P4a | Success → 500 → Try again → success (same request string re-sent); Outcome change → 409 → platform-account notice (amber, no Try again, bar still mounted) → Clear → success; network reject → "Could not reach the server…" → Try again → success | ✅ Tiles and table hidden while in error, restored after |
| P4b | 409 for a picked business, chip "Remove business" | ✅ One read, back to the list, URL `?tab=activity` |
| P4c | Newest wins: a slow first answer (500) lands after the second (200) | ✅ Ignored, no error flash |
| P5 | Focus: KPI tile toggle (focus stays on the tile); Clear (jsdom keeps focus; browsers drop it, known F-104); Try again (focus falls to `<body>`, E-1); tabs keyboard (P1b) | ✅ / ⚠️ as noted |
| P6 | Costs and Settings: `COSTS_INTRO` once on the page (header), not in the Costs body; Settings refresh hidden on Costs and Activity, shown on Settings; standing note on Settings; one report read and one settings read across switches; no list read without Activity | ✅ |
| P7 | Exactly one list read per change: 8 window buttons, Area, Outcome, Trigger, min cost Apply, empty Apply (removes it), Sort, Cost / Failed / AI actions tiles, picker choice (chip "Business: Beta Co"), chip X, Clear, Refresh | ✅ +1 each. Same-value actions +0: This month again, typing a min cost, Apply with the same value, Apply with the same value plus spaces, Sort again, AI actions tile again |
| P8 | Custom: clicking Custom reads nothing; a one-sided Custom keeps Apply disabled; a preset afterwards reads once and hides From / To | ✅ |
| P9 | Accessibility in jsdom: one h1; tablist with 3 tabs, one `aria-selected`, each `aria-controls` points to a `tabpanel` labelled by its tab; one `role="search"` named "Filters"; no `section` / `region`; Area, Outcome, Trigger, Minimum cost (USD), Business labelled; Sort a named group; Clear disabled at defaults; "Refresh the AI activity" with `aria-busy`; three filter tiles are links with names, Unresolved a `group` named "Unresolved corrections, 0"; every `th` `scope="col"`; Outcome chip text "Succeeded" with an `aria-hidden` icon; every button and every visible input / select has an accessible name | ✅ |

### Test Coverage (acceptance)

| Acceptance criterion (workplan §2, §7.1 for L-8a) | Tested? | Result | Notes |
|---|---|---|---|
| Header: one h1, Read-only neutral chip, per-tab purpose, Settings actions on Settings only | ✅ | Pass | T-1, P6, P9 |
| Tabs: roving `tabIndex`, arrows / Home / End move focus, manual activation, `?tab=` by `replaceState(null, …)` | ✅ | Pass | T-2, E-4, P1b |
| Tab switch sends no `ai-activity` read (M-1, N-3) | ✅ | Pass (jsdom), with QA-L8a-1 | P1a to P1c; real browser owed (B-2) |
| KPI tiles: values, toggles, reset tile, Unresolved amber only above 0, no link | ✅ | Pass | T-7, T-8, P7, P9 |
| Filter bar: 5 + 4 windows, Business picker and chip, Area / Outcome / Trigger, min cost own Apply, Sort, Clear, Read at, Refresh | ✅ | Pass | E-2, P7, P8 |
| Every filter in the URL, round trip, invalid / legacy ignored | ✅ | Pass | T-3, T-4, P2 |
| Shared states incl. 409 platform account, network copy, Try again | ✅ | Pass | T-10, P4 |
| One list read per filter change; min cost apply semantics | ✅ | Pass | P7, T-6 |
| Standard table, Outcome `StatusChip` | ✅ | Pass | T-13, P9 |
| Costs and Settings unchanged apart from the moved purpose line | ✅ | Pass | P6; visual check owed (B-11) |
| Old drawer still opens / closes, focus returns | ✅ | Pass (unchanged suite) | `activityDrillDown.render` green with no edit; browser B-8 |

### Issues Found

#### Bugs (must fix before commit)

None of High or Medium severity.

1. **QA-L8a-1: a tab switch re-reads and silently drops an applied minimum cost the URL parser refuses** — Files: `app/admin/business-os-llm/activityFilters.ts` (`MIN_COST`), `components/activity/ActivityFilterBar.tsx` (`applyMinCost` sends the draft as typed) — Severity: **Low**
   - Steps: Activity → type "abc" (or "5.", ".5", "-1", "1,000") in Minimum cost → "Apply minimum cost" (the route's 400 message shows; the URL gets `min_cost=abc`) → click Settings.
   - Expected (SA code review row "Min cost sent as typed": "a tab switch does not read it again"; N-3): no `ai-activity` request on a tab switch.
   - Actual (probe P1d): the tab click is an outside change, the hook re-parses, `min_cost=abc` parses to the default `''`, so `filters` changes: **one list read** without `minCostUsd`, the URL is rewritten to `?tab=settings`, the box empties. The SA's reasoning assumed an invalid key is skipped by the merge, but `parseAll` starts from the defaults, so every field is present and the invalid one compares as `''`.
   - Impact: only after an admin has applied a malformed amount and seen the route's error; the effect is a self-recovery (error replaced by the unfiltered list). No write, no wrong data. Not a commit blocker.
   - Fix options for Dev / SA (L-8b or a follow-up): (a) correct the §7.11 / SA record to say so (doc only); or (b) refuse a malformed amount in the bar (the same `MIN_COST` rule) and keep only the size / precision messages with the route. Same mechanism would apply to any future typed field whose applied value can fail its own parser.

#### Performance Issues (should fix)

None. Reads are exactly one per change (P7) and zero per tab switch for every parseable state (P1a to P1c).

#### Edge Cases (nice to fix)

1. **E-1: focus after "Try again" falls to `<body>`.** `AdminError` unmounts its own button when the retry clears the error. Shared behaviour (every page using `AdminError onRetry`), same class as F-104 (Clear). L-8b's T-14 content-wrapper fallback could cover Activity; recommend recording beside F-104. Low.
2. **E-2: an outside navigation to the bare page leaves the tab and the URL apart.** On Activity with a filter, a sidebar link (or Back) to `/admin/business-os-llm` resets the Activity filters with one read (correct), but the page keeps Activity selected while the address bar has no `tab` (the page reads `?tab=` only on its first render; pre-existing). A reload then opens Settings. Low.
3. **E-3: two `Apply` buttons while Custom is open.** Distinct accessible names ("Apply", "Apply minimum cost"), as designed; visible text identical. Informational.

### Browser checklist for TL (signed-in admin, DevTools Network filtered to `ai-activity`, light and dark emulation; read-only, every request a GET)

| # | Check | Mandatory |
|---|---|---|
| B-1 (L8-B1) | `/admin/business-os-llm`: one h1 "Business OS AI", slate "Read-only" chip, Settings purpose line, Settings refresh on the header's right; no shell title | |
| B-2 (L8-B2 + N-3) | Tab lands on the selected tab only; Left / Right / Home / End move focus, Enter selects; purpose line follows the tab; `?tab=` in the address bar; reload keeps the tab. **With an Activity filter applied (e.g. Outcome Failed + Last week), switch to Settings, to Costs and back to Activity, by mouse and by keyboard: zero `ai-activity` requests** | **Yes** |
| B-3 (L8-B3) | Activity first open: one `ai-activity` request (this month); four tiles; window row Today, 7 days, 30 days, This month, Custom, Yesterday, This week, Last week, Last month; From / To only under Custom | |
| B-4 (L8-B4) | Pick a business: label "Business", chip "Business: {name}" with X; `account=` in the address bar; reload reopens the same view with one request | |
| B-5 (L8-B5) | **Next sync:** open on Settings, click Activity, hover / copy the Failed tile link: contains `tab=activity`. Middle-click it: the new browser tab opens Activity with Outcome Failed | **Yes** |
| B-6 (L8-B6) | Type a minimum cost, click Last month: box empties, no `minCostUsd`; type again, "Apply minimum cost": one request with `minCostUsd` | |
| B-7 (L8-B7) | Clear: every filter back, `?tab=activity` kept, one request; Refresh: same `from` / `to`, table stays, "Read at" updates | |
| B-8 (L8-B8, L-8a part only) | Open a row: one `drill-down?actionId=` request; the OLD drawer opens, Outcome shows as a chip inside it; Escape closes and focus returns to the Open button. Title colour / X ring are L-8b | |
| B-9 (L8-B9) | Light and dark: header chip, tiles, bar, table look the same; the two rules under the header and above the tabs acceptable (SA comment 1); select lists and date inputs dark | |
| B-10 (L8-B10) | Offline + Refresh: "Could not reach the server…" with Try again; online + Try again restores. Note where focus lands (E-1) | |
| B-11 (L8-B11) | Costs & credits and Settings bodies unchanged apart from the moved purpose line | |
| B-12 (QA-L8a-1) | Optional: apply "abc" as minimum cost, then switch tab: expect one `ai-activity` request (the recorded Low bug) | |

### Final Status

**Verdict: PASS WITH NOTES.** All L-8a acceptance criteria pass in Jest; no High or Medium bug. QA-L8a-1 (Low) and E-1 / E-2 are recorded for SA / L-8b and do not block the L-8a commit. The real-browser proofs B-2 (no request on a tab switch) and B-5 (Next search-params sync) are owed by TL; jsdom cannot prove the Next patch.

- [x] All acceptance criteria pass — ready for commit (with the notes above; B-2 and B-5 owed in a browser)
- [ ] Issues found — Dev must address before commit

## QA Report (L-8b) — 2026-10-12

**QA — 2026-10-12**
**Test mode:** full
**Strategy used:** A (Jest unit and render tests in jsdom, mocked `fetch` only), plus D listed for TL (browser, read-only). No route, data or LLM change, so no integration run.
**Focus:** ui, the shared hook, accessibility
**Skipped:** the browser itself (QA has no signed-in session); listed below for TL
**Input source:** TL prompt keywords + SA Code Review (L-8b) "For QA"

Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l8b`, uncommitted. `git diff --stat` before and after QA: 9 tracked files, 357 insertions, 180 deletions, plus the 2 new files. The code diff was identical after QA (probes deleted; nothing stashed or committed; `node_modules` untouched). The only file QA changed is this workplan.

### Commands run (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/finance lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | 54 suites, 1,652 tests passed (equal to Dev's V-1). One "worker failed to exit gracefully" notice, which was already there before this slice (a timer in another suite) |
| 2 | `npm run test:bos-llm` | 23 suites, 625 tests, 23 snapshots passed, exit 0 |
| 3 | `npm run typecheck:bos-llm` | "499 files in scope, 28 errors, 0 new (141.0s) … passed", exit 0 (plus the known fixed baseline entry `app/api/onboarding/build/route.ts`) |
| 4 | `npm run test:bos-entitlements` | 242 suites, 7,062 tests passed, exit 0 |
| 5 | Scoped `tsc -p` (scratchpad `qa-l8b/`, extends the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`). `--listFilesOnly`: 86 page and shared files, including `useDrawerResource.ts`, its test, `AdminDrawer.tsx` and `ActivityDrillDown.tsx` | Run 1 with `canary.ts`: exit 2, exactly `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 without it: exit 0, no output |
| 6 | `npx eslint` on the hook, its test, `ActivityDrillDown.tsx`, `ActivityTab.tsx`, `AdminDrawer.tsx`, `activityCopy.ts` | exit 0, no output |
| 7 | Greps | No `console.` or `as any` in the hook or the drawer. The only `fetch(` is `readDrillDown` in the page folder (none in the hook). No remaining `OPEN_DETAILS` (bare) or `DRILL_DOWN_LOADING` anywhere under `app/` |

### Edge-case probes (throwaway files, 26 cases, all deleted afterwards)

Two files:

- **Page-level render probe (22 cases):** `ActivityTab` and the full page. `fetch` is mocked by exact path. Drill-down answers are held as deferred promises, and the mock rejects on abort, like a real `fetch`.
- **Hook probe (4 cases):** `renderHook`.

Every page case ran with `console.error` spied and asserted uncalled, so an act warning would fail it. A `MutationObserver` also failed the case if the dialog ever showed one action's business under the other action's title suffix.

| # | Probe | Result |
|---|---|---|
| P1a | Open A. While loading, the dialog is named "AI action" and shows `role=status` "Reading the AI action…". A lands ("AI action type_alpha", Alpha). Escape. Open B: loading, no Alpha figures, title without a suffix. B lands. Escape. Open A again: loading (not the earlier A figures), a third request, then A's figures. After each Escape, focus is back on the right Open button | ✅ Pass (0 frame violations) |
| P1b | A in flight; close (A's signal aborted); open B; A answers late and is ignored (still loading); B lands and only B shows | ✅ Pass |
| P2a | Same row: open, land, close, open (loading, no old figures), close, open. Exactly 3 drill-down requests (one per open). The middle signal is aborted and the last is not. The middle read's late answer (carrying B's payload) sets nothing. The last read lands | ✅ Pass |
| P2b | Unmount while loading: signal aborted, a late answer sets nothing, no warning | ✅ Pass |
| P3 | Error states. Each sends one request and shows `role=alert` in the dialog, with no loading line, no body, and the dialog named "AI action".<br>• JSON 404 and HTML 404 → "This AI action could not be found."<br>• HTML 502, 400 with an object `error`, 200 `success:false` without an error, 200 body `null`, 200 body array, 200 `success:"true"` → "Could not read the AI action"<br>• 500, and 200 with a string `error` → that string<br>• Network rejection (`TypeError: Failed to fetch`) → "Could not reach the server. Check your connection and try again."<br>Never "Failed to fetch" or "Unexpected token" | ✅ Pass (11 cases) |
| P3b | A ready, close, open B, B rejects: the shared network sentence, no Alpha figures | ✅ Pass |
| P4a | X: named "Close", a direct child of the dialog. It closes, aborts the in-flight read and puts focus back on the opener | ✅ Pass |
| P4b | Overlay (pointer-down outside the panel): closes, focus back on the opener | ✅ Pass |
| P5a | Refresh held; open A; A lands; the list read lands without A, so the opener is detached. The drawer stays open on A's valid data (SA ruling). X close puts focus on `activity-content`, not `<body>`. A later Refresh brings A back: no reopen, and drill-down requests stay at 1 | ✅ Pass |
| P5b | List read fails (route 500) while the drawer is open: the drawer stays. There is exactly one dialog and one `activity-drill-down`, because it is rendered outside the state branches | ✅ Pass |
| P6 | Accessibility:<br>• dialog named "AI action type_alpha"<br>• the four sections are `group`s named Action / Corrections / Audit entry / Grouping id, with `h3` headings<br>• zero `region` in the dialog<br>• testids `drill-down-action`, `-corrections-section`, `-entry`, `-group`, `-entry-fields`, `-business`, `-cost`, `-credits`, `-group-single` present<br>• close button named "Close"<br>• title inline colour rgb(241, 245, 249) | ✅ Pass |
| P7 | Full page, drawer open, Settings tab clicked with `fireEvent` (which bypasses the modal): no extra drill-down or list request; the drawer stays open over the Settings panel (see E-1) | ✅ Pass (recorded) |
| H-a | Hook: key A ready, then B (no close), B ready, back to A. Frames: `A:loading, A:ready=dataA, B:loading, B:ready=dataB, A:loading`. Never another key's data; 3 reads | ✅ Pass |
| H-b | A current rejection that is itself an `AbortError` (not caused by our abort): the shared network sentence | ✅ Pass |
| H-c | A new inline `read` on every render: still one read | ✅ Pass |
| H-d | A `read` that throws synchronously (not async) | Throws out of the effect and unmounts the tree (E-2) |

### Test Coverage (acceptance)

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Drawer on the shared `AdminDrawer`, one per page, X a direct child | ✅ | Pass | P4a, P5b, P7 |
| `useDrawerResource`: newest wins, aborts on close / change / unmount, no late set | ✅ | Pass | P1b, P2a, P2b, H-a, plus Dev's H-1 to H-11 |
| M-4: never another action's data under the title; reopen shows loading | ✅ | Pass | P1a, P2a, H-a |
| One drill-down request per open, carrying only `actionId` | ✅ | Pass | P1a, P2a, P5a, existing case |
| 404 / HTML 404 / HTML 502 / route error / non-success 200 / network | ✅ | Pass | P3 (11 cases) |
| Focus return (Escape, X, overlay) and the content-area fallback | ✅ | Pass | P1a, P4a, P4b, P5a, T-14 |
| Close-when-gone not applied (SA ruling); no unasked reopen | ✅ | Pass | P5a |
| Accessibility (named dialog, named groups, no region, status, alert, "Close") | ✅ | Pass | P6, P3 |
| No console errors or act warnings | ✅ | Pass | Spied in every probe |
| L8-B8 in a real browser (light / dark, focus ring, offline) | ⚠️ | Owed | TL, below |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None. One request per open; tab switches and list reads start no drill-down request.

#### Edge Cases (nice to fix, none blocks)

1. **E-1: the drawer stays open if the tab changes under it.** `page.tsx` / `ActivityDrillDown.tsx`. Low, informational.
   - Forced by a synthetic click, the Activity panel hides but the portal drawer stays over Settings. No request is sent.
   - An admin cannot reach this. The sheet is modal (pointer blocked, focus trapped), and the tab writer uses `replaceState`, so browser Back leaves the page instead of changing tab.
   - No action.
2. **E-2: `useDrawerResource` does not catch a `read` that throws synchronously.** `app/admin/components/layout/useDrawerResource.ts:73`. Low, for the hook's next consumer.
   - A non-async `read` that throws before returning a promise escapes the effect and unmounts the tree. An async one gives the shared error instead.
   - `readDrillDown` is `async`, so Activity cannot reach this.
   - Suggestion for when a second consumer arrives: start the read as `Promise.resolve().then(() => readRef.current(key, signal))`, or state "read must be async" in the type's comment.
3. **E-3: SA comment 1 clarified.** H-a shows that A (ready) → B (ready) → A answers `loading`, because the stored answer is B's. Only A (ready) → B (in flight) → A shows A's earlier answer again, and it does so under A's own title. Activity cannot reach this, because every key change passes through `null`. Agrees with SA: no action.
4. **E-4: already there before L-8b, unchanged.** The drawer's error state has no "Try again". A 200 `success: true` without `data` is not guarded (same as HEAD; the route always sends `data`).

### Browser checklist for TL

Signed-in admin, `/admin/business-os-llm?tab=activity`, DevTools Network filtered to `drill-down`, light and dark emulation. Read-only: every request is a GET.

| # | Check | Result |
|---|---|---|
| B8-1 | Open a row: exactly one `drill-down?actionId=…` request; the "Reading the AI action…" spinner first; title "AI action {type}" once loaded | |
| B8-2 | Sections in order Action, Corrections, Audit entry, Grouping id, each with its heading; fields readable at the larger size; the type suffix after a real space | |
| B8-3 | Light emulation: the title is light text on the dark panel and readable; the X is visible (not faded) | |
| B8-4 | Dark emulation: title, X and sections look the same as in light | |
| B8-5 | Tab to the X: a purple focus ring with a dark offset (no white ring) | |
| B8-6 | Escape closes; focus returns to that row's Open button (visible focus ring on it) | |
| B8-7 | Reopen, close with the X: focus back on the Open button | |
| B8-8 | Reopen, click the dimmed area left of the panel: it closes, focus back on the Open button | |
| B8-9 | Open row A, close, open row B: B's title never shows A's figures, even for a moment; reopening A shows the spinner, not old figures | |
| B8-10 | DevTools Offline, open a row: red block "Could not reach the server. Check your connection and try again." (not "Failed to fetch"); close; back online, reopen: loads | |
| B8-11 | Console: no errors or React warnings across the above | |

### Final Status

**Verdict: PASS.**

- Every L-8b acceptance criterion and every requested probe passes in Jest. No bug of any severity.
- E-1 and E-2 are Low notes that Activity cannot reach. E-3 and E-4 are informational.
- TL owes the browser checks B8-1 to B8-11 (L8-B8 in full). They are read-only.

- [x] All acceptance criteria pass — ready for commit (browser checks owed by TL)
- [ ] Issues found — Dev must address before commit

## Commit Info

| Field | Value |
|---|---|
| Slice | L-8a |
| Branch | `feature/admin-layout-l8` |
| Commit | f67ece30 `feat(admin): admin layout standard L-8a — Business OS AI header, tabs, Activity filters and KPI strip` |
| Merge of origin/main | 29135d9f (origin/main 8a43eb36, clean, no file changes) |
| PR | [#319](https://github.com/AgentsPilot/neuronforge/pull/319), open against `main`, fast-track (SA + QA passed); awaiting checks + user merge |
| Tests after the merge | Requested Jest set 61 suites / 1,819 tests; `test:bos-llm` 23 / 625; `typecheck:bos-llm` passed; `test:bos-entitlements` 242 / 7,062; `lint:hooks` clean |
| Owed | Browser checks B-1 to B-12 (QA report), B-2 and B-5 mandatory |

| Field | Value |
|---|---|
| Slice | L-8b |
| Branch | `feature/admin-layout-l8b` (cut from `feature/admin-layout-l8` at 25bc0a8b) |
| Commit | 597ad7b6 `feat(admin): admin layout standard L-8b — Activity drawer on the shared drawer, useDrawerResource` |
| Merge of origin/main | Not needed: origin/main had no commits missing from the branch |
| PR | [#320](https://github.com/AgentsPilot/neuronforge/pull/320), open against `main`, fast-track (SA + QA passed); contains #319 (L-8a); awaiting checks + user merge |
| Tests | Requested Jest set 54 suites / 1,653 tests; `test:bos-llm` 23 / 625 (23 snapshots); `typecheck:bos-llm` passed (0 new); `test:bos-entitlements` 242 / 7,062; `lint:hooks` clean |
| Owed | Browser checks B8-1 to B8-11 (QA report), read only |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | L-8a committed, PR #319 | RM: commit f67ece30, origin/main merged (29135d9f), PR #319 opened under the fast-track; Status and Commit Info updated |
| 2026-10-12 | L-8b implemented | Dev: tasks 4 and 9; Implementation Notes (L-8b); Status updated. Uncommitted |
| 2026-10-12 | L-8b SA code review | SA: Code Approved for QA, no must-fix; deviation (no close-when-gone) accepted and written into requirement §5.8 D-7; 3 Low comments |
| 2026-10-12 | L-8b QA | QA: PASS, no bugs; 26 throwaway probes (deleted), scoped tsc canary, 2 Low edge notes (E-1, E-2); browser checklist B8-1 to B8-11 owed by TL |
| 2026-10-12 | L-8b committed, PR #320 | RM: TL fold-in line (QA E-2) added to Implementation Notes (L-8b); commit 597ad7b6; origin/main already contained (no merge); PR #320 opened under the fast-track; Status and Commit Info updated |
