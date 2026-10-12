# Workplan: Admin Layout Standard — Slice L-9 (Business OS AI: Costs & credits tab)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 15), §4.11 (Costs tab), §4.15 row 2, §4.16 F, §4.17 (`STATUS_CLASS`, `Chip`), §5.4 (K-1 to K-10), §5.5, §5.6 (U-1 to U-10), §5.7, §5.9, §5.10, §5.11, §5.12, §6.1, §6.2 C-3, C-4, C-5, C-6, C-7, C-8, C-11, C-12, C-13, §7.12, §9 F-67, F-71, F-72, F-73, F-74, F-113, §10 D-2 (b), D-4 (a), D-15, §12.3; SA rulings SA-R-3, SA-R-4 (K-5), SA-R-11, R-7, R-9, and the L-8 workplan review Q-8 direction (F-113)
**Skills applied:** `bos-llm-call-standards` read for scope only: no AI call, no model setting, no route change (the tab stays two read-only `GET`s plus the picker's). `business-os-entitlements`: not triggered (no import from `lib/business-os/entitlements/`, no tier or capability literal). `business-os-schema-check`: not triggered (no DB claim beyond the payload fields the tab already reads, `costTypes.ts` / `leakTypes.ts`). `tenant-isolation-guard`: not triggered (no write, no service-role path). No queue
**Branch:** `feature/admin-layout-l9`, cut from `feature/admin-layout-l8b` at d5990480 (PR #320 open, contains #319). The L-9 PR targets `main` and carries L-8a / L-8b until they merge. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-12
**Status:** L-9a COMMITTED 2026-10-12 — 57132b85, PR #321 open (fast-track; SA code review approved, QA PASS WITH NOTES); awaiting checks + user merge; browser checks L9-B4 / L9-B5 owed. SA workplan review 2026-10-12: APPROVED WITH CONDITIONS (M-1 to M-3 applied before coding; see SA Workplan Review). **L-9b COMMITTED 2026-10-12** — fa599c13 on `feature/admin-layout-l9b` (cut from `feature/admin-layout-l9` at 703f6dcb), PR #322 open (fast-track; SA code review approved, QA PASS WITH NOTES); awaiting checks + user merge; browser checks QB-1 to QB-10 owed (leak check once only, per the SA ruling)
**Path:** **Full cycle** (SA L-8 workplan review Q-8, R-7): L-9 builds the `active` option on the shared `useAdminFilters` (F-113). Run under the user's fast-track: SA workplan review → Dev → SA code review + QA → RM commits and opens the PR (no user diff review). Recommended as **two PRs, L-9a then L-9b** (§9)

## Overview

L-9 moves the **Costs & credits** tab of `/admin/business-os-llm` onto the standard. Its purpose line already moved into the shared header in L-8a. What is left: a KPI strip, the shared filter bar with every filter in the URL, the shared business picker in place of the account `<select>` (a new request, SA-R-11), the shared states and JSON reads, the four report sections on the standard table constants with status chips, and the leak check panel restyled (its own date inputs and Run button stay: it is an on-demand check, not a page filter).

The one shared change is the **tab / URL coexistence rule** SA asked for at L-8 (Q-8, F-113). Costs and Activity are both kept mounted (hidden) once opened, and both own `range`, `from`, `to`, `account`. Without a rule each hook reads the other's writes as outside changes, so the hidden tab follows the visible tab and starts reads. L-9 adds an `active` option to `useAdminFilters` (a hidden tab's hook neither re-reads nor writes) and makes the page coordinate the address bar on a tab switch (§2.2).

No route, payload, request parameter, model, temperature or provider changes. The only request changes are the ones the standard forces: the business picker's search (`GET /api/admin/business-os/llm-usage/businesses`, an existing route the tab did not call) and the window presets the bar now offers (Today, This month, Custom, which the route already accepts).

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-d5990480)
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
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)

---

## 1. Analysis Summary (code verified at d5990480)

### 1.1 The tab today

| File | Lines | Today |
|---|---|---|
| `components/costs/CostsTab.tsx` | 283 | Owns `preset` (7 / 30 / 90) and `query` (`from`, `to`, `accountId`); one report read per query change, newest wins (sequence + abort), unmount abandons; a failed read clears the report. Bar: segmented "Last 7 / 30 / 90 days" (`:129-143`), From / To (UTC) **always shown** with "Apply dates" (`:145-169`), a **native `<select>` "Account"** listing only the accounts of the last all-accounts read (`:171-186`), "read at" in `text-slate-500` + an icon-only refresh named "Re-read the cost report" (`:188-202`). Reads with `response.json()` (`:80`, F-67); a network failure shows `err.message` (`:93`, §5.10 rule 4). Loading spinner, red error box, amber `costs-incomplete` box, two amber text lines (unreadable amounts, names failed), red "totals failed" line, a hand-built empty box. No URL, no Clear, no KPI |
| `components/costs/CostsSections.tsx` | 368 | Four `<section>` cards (h2, no accessible name, so not landmarks). Local table constants `TH`, `TH_NUM`, `TD`, `TD_NUM` with **`font-mono`** numbers (`:26-29`, F-71); no table wrapper / thead tint (F-72). Period check as page `Chip`s: "matches its rows" `info` (blue), "mismatch" `danger`, "not checked" `quiet` (`:69-97`). Fallback list dates hand-formatted `createdAt.slice(0, 16)` (`:278`, F-74). Spread "few examples" as `Chip warn`; the service name in `text-slate-500` (`:337`, T-5) |
| `components/costs/LeakCheckPanel.tsx` | 402 | Its own "Check from / to (UTC)" inputs (default yesterday) and a purple "Run leak check" button; one GET per press, never on mount; newest wins. Reads with `response.json()` (`:312`, F-67), network failure shows `err.message` (`:321`). Verdict boxes (red found, amber partial, slate-amber empty window, emerald clean). Account table at its own density (`text-xs`, `py-1.5 pr-3`, thead `text-slate-500`, F-72); numbers right + `tabular-nums`; status pills from `STATUS_CLASS` (`:63-68`, §4.17: text, no icon, no border); dates via the page's `formatInstant`; several `text-slate-500` information lines (T-5) |
| `costCopy.ts`, `costFormat.ts`, `costTypes.ts`, `leakCopy.ts`, `leakTypes.ts` | — | Copy; `formatUsd` / `formatCredits` / `formatCount` / `formatDay` / `utcDateDaysAgo` (UTC, sub-cent precision); wire types pinned by `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts` and `creditLeakCheck.wireTypes.test.ts` (run by `typecheck:bos-llm`) |

### 1.2 The routes (not touched)

| Route | Query (Zod, strict) | Notes |
|---|---|---|
| `GET /api/admin/business-os/credits/report` | `from`, `to` (both or neither, real `YYYY-MM-DD`, `from <= to`, at most **92** days, `to` at most one day ahead), `accountId` (UUID) | Neither date → the route's own last 30 days. 409 `platform_account` (a machine code) for a platform account. **READ-ONLY**, no audit (route header `:16-19`) |
| `GET /api/admin/business-os/credits/leak-check` | Same shape, at most **7** days | 409 `platform_account`. **READ-ONLY**: `lib/business-os/credits/creditLeakCheck.ts:6` "No write, no LLM call, no audit entry, no results table". It logs its findings (`bos_credit_leak_found` at error level per leaking account) and walks every business up to a 45 s deadline (`maxDuration = 60`) |
| `GET /api/admin/business-os/llm-usage/businesses` | `search` | The shared picker's source (C-6). Lists businesses incl. platform accounts (the picker ignores `platformAccountIds` on purpose) |

Consequences: the four whole-date windows of the standard plus `90d` all resolve to two whole dates the report route accepts; a linked (minute / instant) or one-sided window cannot be sent, so it is ignored on arrival (U-4), exactly as Activity does (L-8a §2.4). A custom window over 92 days reaches the route and shows its own message (rule 1), as typing one does today.

### 1.3 The page shell and the URL today (after L-8a)

`page.tsx` reads `?tab=` once, mounts Costs and Activity lazily and keeps them mounted (hidden), and writes `tab` with `replaceState(null, …)` from `window.location.href` (so every other parameter is kept). Activity's `useAdminFilters` owns `range, from, to, account, area, outcome, trigger, min_cost, sort`. Today a Settings or Costs URL may carry Activity's keys (harmless, F-113: only Activity reads them). **Once Costs owns `range` / `from` / `to` / `account` too, that stops being harmless.**

**Next 14.2 timing (the reason §2.2 is shaped as it is).** Next's patched `replaceState` syncs `useSearchParams` inside a `startTransition` (`app-router.js` 14.2.35, `applyUrlFromHistoryPushReplace`). A tab click is a discrete event, so the click's own render commits first with the **old** `useSearchParams` string; the new string arrives in a later transition render. A tab that mounts or becomes visible in the click's render therefore sees the previous tab's URL for one render. jsdom has no Next patch: the existing suites either fix the string (`activityTab.render`) or follow `window.location` at once (`activityLayout.render`), so neither reproduces this lag; §6.3 adds a test harness that does.

### 1.4 Who else depends on these files

| Dependent | What | Effect of L-9 |
|---|---|---|
| Every `useAdminFilters` page: Audit trail, AI cost & usage, Businesses, Messages, Activity | The hook | `active` is optional and defaults to `true`: every existing call is unchanged; their suites run unedited (V-1) |
| `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts`, `creditLeakCheck.wireTypes.test.ts` | Import `costTypes.ts` / `leakTypes.ts` | Both untouched |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | Walks `components/activity/` and lists four `activity*.ts` files | `activityFilters.ts` is edited (§2.4) but is not listed; no `.service` read added anywhere |
| `activityTab.render`, `activityLayout.render`, `activityDrillDown.render`, `page.render`, `ledgerPanel`, `lastChanged` | Render the page or the Activity tab | Only the cases named in §6.2 change; T-16 is expected to stay green **unedited** (§2.2) |
| Finance (`app/admin/finance/**`) | Does not use `useAdminFilters` (its own bar; the original picker) | Not touched |

---

## 2. Scope and decisions

### 2.1 In L-9

1. **Shared:** an `active` option on `useAdminFilters` (§2.2, F-113). No other shared export is added or changed.
2. **Page:** `page.tsx` coordinates the address bar on a tab switch and passes `active` to both filter tabs (§2.2).
3. **Costs:** filter spec in the URL (§2.4), the shared bar with the business picker (§2.3), a five-tile KPI strip (§2.5), the shared states and JSON reads (§2.6).
4. **Sections:** the standard table constants, numbers right + `tabular-nums`, `StatusChip` for the period check and "few examples", the fallback dates through the shared formatter (§2.7).
5. **Leak check panel:** restyled only; reads on `readJsonBody`; status pills → `StatusChip`; its own form stays (§2.8).
6. **Activity:** `ActivityTab` takes `active` (default `true`) and passes it to its hook; its window wrapper moves into a page-folder helper both tabs use (§2.4). No visible change.

### 2.2 Decision: tab / URL coexistence (SA L-8 Q-8, F-113) — the shared change

SA's direction, confirmed: (1) the address bar describes the **visible** tab only; (2) a hidden tab's hook neither re-reads nor writes; (3) on a tab switch the page writes `tab` plus the incoming tab's filters and drops the leaving tab's keys; (4) canonical names stay (U-5), no per-tab prefixes. Below is how, including the two places where the Next timing in §1.3 forces a detail.

**Hook: `useAdminFilters(spec, options?: { active?: boolean })`**, default `active: true` (today's behaviour exactly).

| When | Behaviour |
|---|---|
| Mount, active | As today: the first state is parsed synchronously from `useSearchParams` (inbound links work, one read on mount) |
| Mount, **inactive** | The first state is the **defaults**; the URL is not parsed. Reason: a tab mounted by a click renders with the previous tab's (stale) `useSearchParams` string (§1.3), so parsing it would hand the leaving tab's `range` / `account` to the new tab and start a read with them |
| While inactive | The re-read effect does nothing (an incoming string is neither parsed nor recorded) and the write effect does nothing. `setFilters` / `clear` still update state (nothing in a hidden panel can call them); `hrefFor` still answers |
| Becoming active (false → true) | `lastKnown` is set to the current incoming string **without parsing it** (the tab's own state wins: the page has just written it, below), then the write effect runs once: if the projection of the state onto `window.location` differs, it is written (`replaceState(null, …)`), else nothing is written |
| Active again | Exactly today's rules: an outside change re-parses, Next's echo of our own write does not |
| Becoming inactive | Nothing (the page owns the keys from now on) |

**Page: who is active.** `active` for a tab is `tab === id && urlTab === id`, where `urlTab` is the tab named by the page's own `useSearchParams` (`null` outside the App Router, where the condition is just `tab === id`). The second half is the Next timing: a tab becomes active only in the render where `useSearchParams` already shows the page's tab write, so its first incoming string is the URL the page wrote, never the leaving tab's. In the click's own render the newly visible tab is briefly inactive: it renders its kept state (or its defaults on a first visit) and starts no read beyond its own mount read. In jsdom with a `window.location`-following mock both halves agree in the same render.

**Page: the tab write.** `chooseTab(next)` from `current` (unchanged when `next === current`, apart from today's `tab` write):

1. Read `window.location.href`. Save the leaving tab's own keys (keys and aliases of its spec, in their URL order) into a page ref, `saved[current]`.
2. Delete **every** key owned by any tab's spec (the union of the Costs and Activity specs), so a stray key of the other tab never survives a switch (address bar = visible tab only).
3. Set `tab=next` (in place, as today) and append `saved[next]`.
4. One `replaceState(null, '', url)`.

Because the hidden tab neither re-read nor wrote, `saved[next]` is exactly that tab's projection when it was left, so its activation write in the hook finds nothing to change: **one write per tab switch**, as today (the existing T-16, "only the two tab writes", stays green unedited). If the two ever differ (a hidden setState, a future bug), the activation write corrects the URL in a second write rather than leaving it wrong. The union of keys is computed in the page from the two module-level specs (`Object.values(spec)` keys and alias keys), not by a new shared export (Q-2).

**Why not lift both hooks into `page.tsx`** (one writer computing the whole URL): it changes `ActivityTab` / `CostsTab` into prop-driven components, which edits most of `activityTab.render`, `activityDrillDown.render` and `costsTab.render` (all render the tabs alone), and the lazy mount still needs the inactive-mount rule for the stale string. The stash keeps the tabs self-contained and the shared change to one option (Q-1).

**Settings and hash.** Settings has no hook: its URL is `tab=settings` plus unrelated parameters. A tab switch also drops the URL hash (`#costs-periods` from a KPI anchor tile, §2.5): an anchor belongs to the tab that rendered it (Q-6).

**What stays as today:** the page reads `tab` once (a later soft navigation to the bare page path does not move the tab; §10 records the consequence); `?tab=` values; unrelated parameters such as `keep=1` or a future `actionId` (B3) are kept.

### 2.3 Decision: the Costs filter bar (§5.5)

`components/costs/CostsFilterBar.tsx` (new), inside `AdminFilterBar` (`role="search"`):

| Part | Control | Notes |
|---|---|---|
| 1, 2 | Window: **Today · 7 days · 30 days · This month · Custom · 90 days** | Standard five, then the tab's existing extra after them (D-2 (b); "Last 7 / 30 days" become the standard "7 days" / "30 days", the same windows). Default **30 days** (unchanged). `requireBothDates` (the route takes both or neither). From / To (UTC) appear under Custom only (today they are always shown); "Apply dates" → the shared "Apply"; From after To → the shared inline error, no read |
| 3 | Business: `AdminBusinessPicker`, label "Business" | **Forced (SA-R-11):** replaces the `<select>`; searches every business through the existing businesses route (a new request for this tab, only while the list is open, RC-6). A business with no charges in the window now gives the empty state (it could not be chosen before). Chip via `businessFilterChip`: name = the name the picker showed, else the report's `accounts` name for that id, else the short id (no lookup, RC-6) |
| 4 | none | Costs has no page filter |
| 5 | Clear | Disabled at defaults (30 days, every business); keeps `tab` |
| 6 | Read at + Refresh | `readAt = report.generatedAt`; `what="the cost report"` → "Refresh the cost report" (D-15) |

The leak check follows the chosen business as today (`accountId` + the chip's name for its scope line).

### 2.4 Decision: the URL contract for Costs (§5.6)

New pure module `costsFilters.ts` (no React, no `'use client'`), keys written in this order:

| Field | URL keys | Parse (else default, U-4) | Route param |
|---|---|---|---|
| window | `range`, `from`, `to` | `wholeDateWindowFilter({ defaultValue: 30d, extras: ['90d'] })`: the shared `windowFilter` with a **linked** value and a **one-sided** custom value ignored (the route takes two whole dates). Spreads the shared field and overrides `parse` only, so `keys`, `serialise` and `equals: windowEquals` are kept (L-8 SA M-1) | `from`, `to`, resolved once per filter change (Refresh and Try again re-send the same dates, as today) |
| account | `account` | UUID | `accountId` |

`costsRouteSearch(filters, now)` returns `from=…&to=…[&accountId=…]`, the tab's request today. No aliases (Costs had no URL). The default 30 days resolves to today minus 29 to today, exactly `presetQuery(30)` today; 7 days and 90 days likewise (`adminWindow.resolveWindow`, whose `90d` comment already says "as Costs' 90 days").

**The window wrapper is shared by the two tabs.** Activity's private `activityWindowFilter` (L-8a, `activityFilters.ts:88-99`) moves to a new page-folder module `tabWindowFilter.ts` as `wholeDateWindowFilter({ defaultValue, extras })`; `activityFilters.ts` calls it with its own default and extras. Same code, same behaviour: `activityFilters.test` and T-16 run unedited (Q-3).

### 2.5 Decision: the KPI strip (§5.4, §7.12)

`components/costs/CostsKpis.tsx` (new), above the bar, as Activity. Placeholders on the first read (K-10), hidden on an error, every value from the payload already read (K-9). Five tiles (K-1):

| Tile | Value | Sub-line (K-8) | Target (K-6) | Colour (K-5) |
|---|---|---|---|---|
| Credits charged | `grandTotal.stored.creditsTotal` (`formatCredits`) | "may be incomplete" when `incomplete` | Anchor `#costs-periods` | Always neutral (SA M-1: under `incomplete` the sub-line only, never amber) |
| Cost (USD) | `grandTotal.stored.costUsd` (`formatUsd`, per-page precision) | same | Anchor `#costs-periods` | Always neutral |
| Charges | `grandTotal.stored.charges` | same | Anchor `#costs-breakdowns` | Always neutral |
| Fallback-priced | `fallback.count` | "{reconciled} reconciled" when count > 0; "may be incomplete" joined when `incomplete` | Anchor `#costs-fallback` | Always neutral (no rule, D-4 (a)) |
| Periods not matching | `mismatchedPeriods` | "of {checked} checked" when some periods were not checked; "Not checked" as the value when none was (the check is skipped when the rows read failed or stopped at its ceiling, `creditReport.ts:387`); "may be incomplete" joined when `incomplete` | Anchor `#costs-periods` | `red` ("Needs action") when > 0, also under `incomplete`: the tab already shows the mismatch as a red `danger` chip and a red summary line (`CostsSections.tsx:69-108`, K-5 (ii)); else neutral ("Not checked" included) |

**SA M-1 (applied 2026-10-12):** under `incomplete` every one of the five tiles gets the "may be incomplete" sub-line (joined with any other sub-line, `; `), and **no** tile turns amber: the amber `costs-incomplete` notice directly below already says it, and five amber tiles would drown the one red tile. The sub-line stays the shared tile's slate-400 (no shared change).

When `sections.totals` is `failed`, the four totals-based values read "Unknown" (no status), and Fallback-priced reads "Unknown" when `sections.rows` is `failed`. Anchor tiles are links only while their section is rendered (an empty or failed report has no sections), otherwise no-target tiles. Sections gain `id`s equal to their test ids. **No margin tile:** the payload has no credit price, so a margin would be a new computation from data the page does not have (K-9, NEEDS DATA); not proposed.

Placement: strip first, then the bar, as Activity (§5.1 region order). Grid as the shared strip (`xl:grid-cols-5`, five tiles fill it).

### 2.6 Decision: states and reads (§5.10)

| State | L-9 |
|---|---|
| First load | `AdminLoading what="the cost report"` ("Reading the cost report…", today's words) in a wrapper keeping `data-testid="costs-loading"`; strip placeholders; bar mounted |
| Refresh / filter change | Content kept, `aria-busy` on an always-mounted content wrapper (`costs-content`), Refresh spins |
| Error | `AdminError testId="costs-error"` with "Try again" (re-runs the current read). Copy: the route's `error` string, else **"Could not read the cost report. Try again in a moment."** (today's words without the full stop, now the shared sentence shape), a network failure `ADMIN_NETWORK_ERROR` (forced: today `err.message`). The report is cleared, as today |
| Platform account (409) | Recognised before generic copy, as Activity (L-8 Q-12): `AdminNotice testId="costs-platform-account"` with `COSTS_PLATFORM_ACCOUNT` (SA M-2, one constant for the report and the leak check): "That is a platform account, not a business, so it has no charges here. Clear the business to see every business; a leak check over every business counts platform AI calls." No Try again |
| Empty | `AdminEmpty message={COSTS_EMPTY} hint={COSTS_EMPTY_HINT} testId="costs-empty"` + "Clear filters" when not at defaults |
| Incomplete | `AdminNotice testId="costs-incomplete"` with `COSTS_INCOMPLETE` and the reasons (same words; the amber is now the shared notice's, §6.2 E-9) |
| Unreadable amounts, names failed | Unchanged amber text lines (`costs-unreadable`, `costs-names-failed`), not layout-forced |
| Totals failed | Unchanged red line `costs-totals-failed` (`SECTION_FAILED`) |
| Window line | `costs-window` kept; `text-slate-500` → `text-slate-400` (T-5) |

The read keeps its own branching on `readJsonBody` (shared), not `readAdminResponse`, because the 409 code must be seen before generic copy (the L-8 Q-12 precedent). Newest wins, abort and unmount handling are kept as they are. No `.json(` remains in `components/costs/`.

### 2.7 Decision: the four sections (§5.7, F-71, F-72, F-74)

| Item | L-9 |
|---|---|
| Section shell | Card kept (§5.7 non-table content: four differently-shaped blocks), `rounded-xl border border-slate-700 bg-slate-800/40 p-4`, h2 unchanged; each shell gets `id` = its test id (anchor targets) |
| Tables | `ADMIN_TABLE_WRAP` / `ADMIN_TABLE` / `ADMIN_THEAD` / `ADMIN_TH` / `ADMIN_TBODY` / `ADMIN_TD`; every number column on `ADMIN_TH_NUM` / `ADMIN_TD_NUM` (`tabular-nums`, not `font-mono`, F-71); one density (F-72); each table gets an `aria-label` (its section or breakdown title). Local `TH` / `TH_NUM` / `TD` / `TD_NUM` deleted. Header words unchanged (they are already unique per table) |
| Period check | `StatusChip`: "matches its rows" → `ok` (green: a period proven equal to its rows is a proven-clear state, T-6; today blue `info`), "mismatch" → `danger`, "not checked" → `unknown` (§5.9 "could not check"). Words and test ids kept (Q-5) |
| "few examples" | `StatusChip` `warn`, words and test id kept |
| Codes (action type, breakdown keys, period start) | Keep `font-mono` text (codes, not numbers); period start via the page's `formatDay` (already UTC through `Date`) |
| Fallback list | "When (UTC)" values through the shared `formatUtc` (null-safe, through `Date`, F-74; reads "2026-09-18 08:00 UTC"); group id as `formatShortId` on `ADMIN_TD_ID` with the full group id and the action id in `title` (§5.7 Ids) |
| Spread | Service name `text-slate-500` → `text-slate-400` (T-5) |
| Missing values | Em dash, as today |

`Chip.tsx` stays (Settings uses it until L-10).

### 2.8 Decision: the leak check panel (§7.12 last bullet)

It is an on-demand check, not a page filter, so it keeps its own form: "Check from (UTC)" / "Check to (UTC)" inputs (default yesterday), the purple "Run leak check" button (T-7 primary), the scope line, never run on mount. Restyle only:

| Item | L-9 |
|---|---|
| Inputs | `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` (the bar's field classes); test ids and labels kept |
| Run button | Same words, purple kept, `focus-visible` ring added |
| Read | `fetch` in try / catch → network failure `ADMIN_NETWORK_ERROR`; body through `readJsonBody`; not ok → the route's `error` string, else "Could not run the leak check" (kept words); 409 `platform_account` → the same `COSTS_PLATFORM_ACCOUNT` constant as the tab (SA M-2), in its error / notice slot without "Try again" |
| Error | `AdminError testId="leak-error"` without "Try again" (Run is the retry) |
| Verdicts | Kept as they are (they are results, not states): red found, emerald clean (the proven-clear green, T-6), amber partial and empty-window. The amber partial verdict moves onto `AdminNotice` (same classes) only if SA wants it (Q-7); default keep |
| Account table | Shared table constants (F-72), numbers on `ADMIN_TD_NUM` (F-71), thead slate-400 (T-5), `aria-label` "Leak check by business" |
| Status pills | `STATUS_CLASS` deleted; `StatusChip`: `leak` → `danger`, `could_not_check` → `unknown`, `incomplete` → `warn`, `clean` → `neutral` (today slate, kept neutral: a row-level "No leak" stays quiet, the verdict carries the green). Words (`LEAK_STATUS_TEXT`) and `leak-status` test id kept (Q-5) |
| Dates | Window and read-at through the shared `formatUtc` (same "YYYY-MM-DD HH:mm UTC" text as `formatInstant`; an unreadable value becomes an em dash instead of the raw string) |
| T-5 | `leak-scope`, `leak-not-run`, `leak-window`, `LEAK_TWO_NIGHTS` lines `text-slate-500` → `text-slate-400` |

### 2.9 What stays as it is

Every copy string except those listed in §3.2; `costFormat.ts`, `costTypes.ts`, `leakTypes.ts`, `leakCopy.ts`, `format.ts`; the report's section order and every test id the suites use; the leak check's request and its one-run-at-a-time rule; the Settings tab (L-10); the page's Settings read with `response.json()` (L-10).

### 2.10 Visible changes on `/admin/business-os-llm?tab=costs` (named in the PR)

1. Five headline tiles above the bar (Periods not matching red only when a period disagrees; every tile carries a "may be incomplete" sub-line when the report is incomplete, none turns amber, SA M-1).
2. Window row: Today, 7 days, 30 days, This month, Custom, 90 days; From / To appear under Custom only, with "Apply"; a reversed range is refused inline.
3. "Business" search picker instead of the "Account" list; a chip "Business: {name}" with X; a Clear button; "Refresh" with a word ("Refresh the cost report") instead of an icon.
4. Every filter in the address bar (`range`, `from`, `to`, `account`); a reload or a shared link reopens the same view. Switching tabs no longer leaves one tab's filters in the address bar of another.
5. Tables one density, numbers in tabular figures; period check "matches its rows" is green, "not checked" dashed grey; leak statuses as chips with icons.
6. A network failure says "Could not reach the server…" with Try again; a platform account gets a sentence instead of `platform_account`.
7. Fallback times end in "UTC"; group ids shortened (full id on hover).
8. **Deliberate change from L-8 (SA M-3):** a stray Activity key on a Settings or Costs URL (for example `?tab=settings&outcome=failed`) no longer pre-filters Activity's first open: Activity opens at its defaults and the key is dropped on the switch (X-5). Nothing emits such a link today.

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

| File | Change |
|---|---|
| `useAdminFilters.ts` | `options?: { active?: boolean }` (§2.2): the initializer, the re-read effect (inactive: return; activation: adopt `incoming` as `lastKnown`, no parse), the write effect (inactive: return; `active` in its deps). Header comment gains the coexistence paragraph. Nothing else changes (`hrefFor`, `textFilter`, the types) |
| `__tests__/useAdminFilters.render.test.tsx` | New `describe` A-1 to A-9 (§6.3); every existing case unedited |

No new file, no new export beyond the option, so `layoutFolder.guard` needs no edit (S-6: history is still written only in `useAdminFilters.ts`).

### 3.2 Page folder (`app/admin/business-os-llm/`)

| File | Change |
|---|---|
| `page.tsx` | `urlTab` from the page's `useSearchParams`; `owns(id)`; `saved` ref; `chooseTab` per §2.2 (stash, drop the union of spec keys and the hash, set `tab`, append the stash, one `replaceState(null, …)`); `<CostsTab active={owns('costs')} />`, `<ActivityTab active={owns('activity')} />`; header comment |
| `tabWindowFilter.ts` | **New**: `wholeDateWindowFilter` (moved from `activityFilters.ts`) |
| `activityFilters.ts` | Uses `wholeDateWindowFilter`; no behaviour change |
| `costsFilters.ts` | **New**: `CostsFilters`, `COSTS_FILTER_SPEC`, `COSTS_DEFAULT_WINDOW`, `COSTS_WINDOW_EXTRAS = ['90d']`, `costsRouteSearch` |
| `components/costs/CostsTab.tsx` | Hook (`active` prop), memoised route search, `picked` name state, KPIs, bar, content wrapper, states, reads on `readJsonBody`; the `accounts` list state and `PRESETS` removed |
| `components/costs/CostsFilterBar.tsx` | **New** (§2.3) |
| `components/costs/CostsKpis.tsx` | **New** (§2.5) |
| `components/costs/CostsSections.tsx` | §2.7 |
| `components/costs/LeakCheckPanel.tsx` | §2.8 |
| `components/activity/ActivityTab.tsx` | `active?: boolean` prop (default `true`) passed to the hook; nothing else |
| `costCopy.ts` | Add `COSTS_WHAT`, the five KPI labels and sub-lines, `COSTS_ERROR_FALLBACK`, `COSTS_PLATFORM_ACCOUNT` (Q-4) |

### 3.3 Kept identical

The report request for the same filter values (`from`, `to`, `accountId`); the leak check request; newest-wins and abort for both reads; every test id the suites use (`costs-tab`, `costs-loading`, `costs-error`, `costs-empty`, `costs-incomplete`, `costs-window`, `costs-periods`, `period-row`, `period-check-*`, `costs-mismatch-summary`, `period-total-row`, `breakdown-*`, `costs-fallback*`, `fallback-row`, `costs-spread*`, `spread-row`, `spread-few-examples`, all `leak-*`) except `costs-account-filter` and `costs-controls` (the select and its wrapper are gone).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/useAdminFilters.ts` | modify | `active` option (F-113) |
| `app/admin/components/layout/__tests__/useAdminFilters.render.test.tsx` | modify (new cases only) | A-1 to A-9 |
| `app/admin/business-os-llm/page.tsx` | modify | §2.2 |
| `app/admin/business-os-llm/tabWindowFilter.ts` | create | §2.4 |
| `app/admin/business-os-llm/activityFilters.ts` | modify | Uses the moved wrapper |
| `app/admin/business-os-llm/costsFilters.ts` | create | §2.4 |
| `app/admin/business-os-llm/costCopy.ts` | modify | §3.2 |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | modify | §2.3, §2.5, §2.6 |
| `app/admin/business-os-llm/components/costs/CostsFilterBar.tsx` | create | §2.3 |
| `app/admin/business-os-llm/components/costs/CostsKpis.tsx` | create | §2.5 |
| `app/admin/business-os-llm/components/costs/CostsSections.tsx` | modify | §2.7 |
| `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx` | modify | §2.8 |
| `app/admin/business-os-llm/components/activity/ActivityTab.tsx` | modify (one prop) | `active` |
| `app/admin/business-os-llm/__tests__/costsTab.render.test.tsx` | modify | §6.2 |
| `app/admin/business-os-llm/__tests__/leakPanel.render.test.tsx` | modify (new cases only) | §6.3 L-1 to L-4 |
| `app/admin/business-os-llm/__tests__/costsLayout.render.test.tsx` | create | §6.3 C-1 to C-12 |
| `app/admin/business-os-llm/__tests__/tabCoexistence.render.test.tsx` | create | §6.3 X-1 to X-9 |
| `app/admin/business-os-llm/__tests__/costsFilters.test.ts` | create | §6.3 |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | modify (new cases only) | §5 G-5, G-6 |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 15, §6.2 C-7, §7.12 as built, §9 F-67 / F-71 / F-72 / F-74 / F-113 dispositions and new findings, §12.3, Change History |

Not touched: any route, `lib/**`, `app/admin/finance/**`, `app/admin/audit-trail/**`, every other shared file, `components/activity/**` except `ActivityTab.tsx`'s one prop, the Settings tab, `Chip.tsx`, the wire types, the sidebar.

---

## 5. Guard and registry changes

**BOS AI `source.guard.test.ts`** (R-9: the "no `@/lib/`" rule is not edited; the new files import only the shared folder through the alias, page-folder modules, `react`, `lucide-react`). New cases appended, each with a planted-string self-test, as G-1 to G-4:

| # | Rule | Why |
|---|---|---|
| G-5 | `components/costs/` has no direct `.json(`, and `fetch(` only in `CostsTab.tsx` and `LeakCheckPanel.tsx` (the picker's fetch lives in the shared folder) | F-67 closed for Costs and the leak check; reads stay where they are |
| G-6 | `components/costs/` has no `text-slate-500`, no `font-mono` on a number cell constant (no local `TD_NUM`), and no `STATUS_CLASS` | T-5, F-71, §4.17 |

G-1 (no original picker import), G-2 (alias only) and G-4 (`page.tsx` the only history writer, never `window.history.state`) already walk every file in the folder and cover the new files with no edit.

**Shared `layoutFolder.guard.test.ts`:** no edit (no new file; S-6 still holds).

**Migrated-pages registry: still deferred to L-10** (SA L-8 Q-3). After L-9 the folder's only direct `.json(` calls are `page.tsx` (the Settings read) and `components/LedgerCheckPanel.tsx` (Settings, parked panel), both L-10 scope (F-67 Settings half). Registering now would need the registry rule weakened. Recorded in §1.

---

## 6. Tests

### 6.1 Order

**Split tags.** **L-9a:** A-1 to A-9, X-1 to X-12, `costsFilters.test`, C-1 to C-8, C-12, E-1 to E-8, G-5. **L-9b:** C-9 to C-11, E-9, L-1 to L-4, G-6.

Before any source edit: `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/finance --ci` on the branch as is, counts recorded (V-0). The existing Costs, leak and Activity suites are the characterisation suite: every case not listed in §6.2 must pass unedited at the end.

### 6.2 Edited deliberately (each named in the PR)

All in `costsTab.render.test.tsx` (no `next/navigation` mock: `useSearchParams` is `null`, so the hook writes nothing there):

| # | Case | Edit | Why |
|---|---|---|---|
| E-1 | "a network failure is shown as an error" | `'offline'` → `ADMIN_NETWORK_ERROR` | §5.10 rules 3 / 4 |
| E-2 | "a preset re-reads with its window" | `'Last 7 days'` → `'7 days'` | Standard window labels (D-2 (b)) |
| E-3 | "the account filter is a choice from the report's own accounts…" | Rewritten and retitled "the business picker replaces the account select": no `costs-account-filter`; the stub answers the businesses route; pick "Beta Bakery" → one read with `accountId=B`; chip "Business: Beta Bakery" | SA-R-11 (forced) |
| E-4 | "custom dates are sent as typed…" | Click "Custom" first; `'Apply dates'` → `'Apply'` | Shared Custom + Apply |
| E-5 | "refresh re-reads the same query" | `'Re-read the cost report'` → `'Refresh the cost report'` | D-15 |
| E-6 | "switching tabs keeps the chosen window and account, and does not re-read (CR-N2)" | `'7 days'`; the account through the picker; "kept" asserted on the pressed preset and the business chip | Same intent, new controls |
| E-7 | The two CR-N2 "slower earlier …" cases | `'Last 7 days'` → `'7 days'` | Labels |
| E-8 | "a failed re-read clears the previous report…" | Button name → `'Refresh the cost report'` | D-15 |
| E-9 | "an amber incomplete banner…" | `banner.className` → the notice container's className (`banner.closest('div')`), still `/amber/`; words and reasons unchanged | The test id sits on the `AdminNotice` text element (RC-3) |

No other existing case is edited: `leakPanel.render` (all 13), `activityTab.render`, `activityLayout.render` (T-16 included), `activityDrillDown.render`, `page.render`, `ledgerPanel`, `lastChanged`, `costFormat.test`, `nav`, every shared-folder suite, every Audit trail / AI cost & usage / Businesses / Messages / Finance suite: green unedited.

### 6.3 New

**`useAdminFilters.render.test.tsx`, new `describe('active (L-9, F-113)')`** (the file's harness, a controllable `useSearchParams` mock, a `replaceState` spy):

| # | Case |
|---|---|
| A-1 | Mount inactive with `?range=7d&account=X`: the defaults; no write; `hrefFor` still answers |
| A-2 | Inactive: an incoming change (`?range=90d`) is not parsed (same `filters` object, the `[filters]` effect does not re-run) and nothing is written |
| A-3 | Activation when the URL already equals the projection: no write, no re-parse |
| A-4 | Activation when the URL lacks the projection (`?tab=x`, state 7 days): exactly one write, `replaceState(null, '', '?tab=x&range=7d')`, unrelated key kept |
| A-5 | Activation adopts the stale incoming string: a later echo of it is not an outside change (no re-parse, no write) |
| A-6 | Active again after activation: an outside change re-parses (today's rule resumes); our own echo does not |
| A-7 | `setFilters` while inactive changes state and writes nothing; on activation the new state is written once |
| A-8 | Becoming inactive writes nothing and changes nothing |
| A-9 | `active` omitted: identical to `active: true` (one existing reading-and-writing case re-run with the option passed explicitly) |

**`tabCoexistence.render.test.tsx`** (page level). Two `next/navigation` mocks in two `describe`s: (i) follows `window.location` on every render (as `activityLayout.render`); (ii) **lagging**: returns a `synced` string the test moves to `window.location.search` only through a `sync()` helper (`act` + `rerender`), the way Next's transition delivers it (§1.3):

| # | Case |
|---|---|
| X-1 | `?tab=costs&range=7d&account=A` → one report read with 7 days and `accountId=A`; click Activity → URL `?tab=activity` (no Costs key), Activity reads its default This month with no `accountId`, Costs reads nothing more |
| X-2 | Back to Costs → URL `?tab=costs&range=7d&account=A` in **one** write; zero further report and list reads; the 7 days pressed and the chip shown |
| X-3 | On Costs, pick 90 days → URL `range=90d`; the hidden Activity starts no read; back on Activity its own window is pressed |
| X-4 | Activity `?tab=activity&outcome=failed&range=last_week` → Settings: URL `?tab=settings` (keys dropped) → Activity: `outcome` and `range` back in one write, no read |
| X-5 | A stray key of the other tab never survives a switch (`?tab=costs&outcome=failed` → Activity: no `outcome`, default read). **SA M-3 extension:** `?tab=settings&outcome=failed` → Activity opens at its defaults and `outcome` is gone (a deliberate change from L-8, §2.10 item 8) |
| X-6 | Unrelated parameters (`keep=1`, `actionId`) survive every switch; the hash is dropped on a switch (Q-6) |
| X-7 | **Lagging:** Costs with 7 days, click Activity (first visit) before `sync()`: Activity's one read is This month, never 7 days; after `sync()` no further read and no further write |
| X-8 | **Lagging:** revisit Costs before `sync()`: no report read, state kept; after `sync()` none either, one write in total |
| X-9 | **Lagging:** Clear on Costs after a switch keeps `tab=costs` and removes only Costs keys; one read |
| X-10 | **Lagging (SA M-3):** Costs → Activity → Costs with no `sync()` between the clicks: one write per click, no further report read and one Activity mount read in total, the final URL carries the Costs keys; after `sync()` no further read and no write |
| X-11 | **(SA M-3)** An outside change on the visible, active tab still re-parses at page level: `?tab=costs&range=90d` set from outside, then sync → one report read over 90 days, "90 days" pressed. The same kind of change while Costs is hidden (the page on Activity) reads nothing |
| X-12 | **(SA M-3)** Deep link `?tab=costs&range=90d`: one read spanning 89 days (from to to), "90 days" pressed; then Activity's first visit reads This month and the URL has no `range` |

**`costsFilters.test.ts`** (pure): every key incl. invalid values (U-4: `range=48h`, `range=yesterday` (not a Costs extra), `account=not-a-uuid`, a minute bound, a one-sided `to` → default); projection order and default omission; `costsRouteSearch` for the default equals today's `presetQuery(30)` parameters (`from`, `to`, no `accountId`); 7 days and 90 days span 6 and 89 days.

**`costsLayout.render.test.tsx`** (page at `?tab=costs`, the `window.location` mock):

| # | Case |
|---|---|
| C-1 | Bar: window buttons in order Today, 7 days, 30 days, This month, Custom, 90 days; "30 days" pressed; "Business" picker; Clear disabled; "Refresh the cost report"; "Read at HH:mm UTC" from `generatedAt` |
| C-2 | Inbound link `range=custom&from=2026-07-01&to=2026-07-31&account=A` → exactly one read with those dates and `accountId`; Custom pressed with the dates shown; the chip shows the report's name for A |
| C-3 | Invalid values ignored, one default read (U-4) |
| C-4 | A preset click writes `replaceState(null, …)` keeping `tab`, omits the default; Clear removes every Costs key, keeps `tab`, one read |
| C-5 | From after To → inline error, no read, no URL write (F-73 / shared rule) |
| C-6 | Refresh and Try again re-send the same `from` / `to` across a mocked midnight; content kept with `aria-busy` |
| C-7 | 409 `platform_account` → the `costs-platform-account` notice whose text is exactly `COSTS_PLATFORM_ACCOUNT` (SA M-2), no Try again, strip hidden |
| C-8 | Empty with a business picked → "Clear filters"; without filters no button |
| C-9 | Sections: number cells have `tabular-nums`, no `font-mono` number cell; check chips `ok` / `danger` / `unknown` with words and icon; fallback time ends in "UTC"; no `text-slate-500` in the tab |
| C-10 | Each section has its `id`; tables have names |
| C-11 | The leak panel follows the picked business (scope "Checking one business: {name}"), and returns to every business when the picker is cleared (SA S-6) |
| C-12 | KPI strip: values and formats; Periods not matching red "Needs action" only when > 0; "of N checked" and "Not checked"; under `incomplete` every tile carries "may be incomplete" in its sub-line, the four totals tiles keep `data-status="neutral"`, and Periods not matching is `red` when `mismatchedPeriods > 0` and `incomplete` are both set (SA M-1); "Unknown" for failed sections; anchors `#costs-periods` / `#costs-breakdowns` / `#costs-fallback` only while those sections render; placeholders on the first read; hidden on an error |

**`leakPanel.render.test.tsx`, new cases** (L-9b): L-1 a network failure → `ADMIN_NETWORK_ERROR`; L-2 a non-JSON body (`json` rejects) → "Could not run the leak check", never a parser message; L-3 409 `platform_account` → exactly `COSTS_PLATFORM_ACCOUNT` (SA M-2), no "Try again"; L-4 status chips: `leak` danger with icon, `could_not_check` unknown, `incomplete` warn, `clean` neutral, words unchanged; number cells `tabular-nums`; no `text-slate-500`.

### 6.4 Must stay green with no edit

As §6.2 lists, plus `lib/business-os/credits/__tests__/**` (via `test:bos-entitlements`), the two wire-type tests (via `typecheck:bos-llm`), `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/admin/components/__tests__/**`.

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-0 | Baseline (§6.1) before any source edit | Counts recorded |
| V-1 | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/finance app/admin/__tests__ lib/admin/__tests__ --ci` | All green; Audit trail, AI cost & usage, Businesses, Messages and Finance counts equal to V-0 (every other `useAdminFilters` page unchanged); Activity T-16 green unedited |
| V-2 | `npm run test:bos-llm` (required CI) and `npm run typecheck:bos-llm` | Green, unchanged (run because the tab is Business OS AI money data; the wire types are pinned there) |
| V-3 | `npm run test:bos-entitlements` | Green (the credits guards; no entitlements import added) |
| V-4 | Scoped `tsc -p` on a scratch tsconfig in the session scratchpad (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `app/admin/components/adminWindowPresets.ts`; `--listFilesOnly` first). Run 1 with a scratch `canary.ts` (`const canary: number = 'x';`) → exit 2 with exactly that TS2322; run 2 without → exit 0 | Both recorded |
| V-5 | `npm run lint:hooks`; `npx eslint` on every touched file | Clean |
| V-6 | Mutation checks, each reverted and the file's md5 compared: (a) the re-read effect ignores `active` → A-2 and X-3 fail; (b) the write effect ignores `active` → A-1 / X-1 fail (Costs keys reappear on Activity); (c) an inactive mount parses the URL → X-7 fails (Activity reads 7 days); (d) activation re-parses instead of adopting → A-5 and X-8 fail (Costs resets, extra read); (e) `owns` without the `urlTab` half → X-7 fails; (f) the page drops only the leaving tab's keys → X-5 fails; (g) the page does not append the stash → X-2 fails (two writes) and T-16 fails; (h) the Costs window wrapper rebuilt without `equals` → X-2 fails (a read on return); (i) route search resolved per read → C-6 fails; (j) Periods tile red at 0 → C-12 fails; (k) a `.json(` back in `CostsTab.tsx` → G-5 fails; (l) the network catch shows `err.message` → E-1 fails; (m) `TD_NUM` back to `font-mono` → C-9 / G-6 fail; (n) `STATUS_CLASS` pills back → L-4 / G-6 fail; (o) (SA M-1) a totals tile turned `amber` under `incomplete` → C-12 fails. **Split:** L-9a runs (a) to (l) and (o); L-9b runs (m), (n) | Each fails as stated |
| V-7 | `git diff --stat d5990480 -- app/api lib app/admin/finance app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/business-os-llm/components/settings app/admin/business-os-llm/components/AreaCard.tsx app/admin/business-os-llm/components/LedgerCheckPanel.tsx`; for L-9b against the L-9a commit. **SA S-3:** also `git diff --stat d5990480 -- app/admin/components` | Empty; `components/activity` shows only the one prop in `ActivityTab.tsx`; `app/admin/components` shows only `layout/useAdminFilters.ts` and `layout/__tests__/useAdminFilters.render.test.tsx` |
| V-8 | `grep` the page folder for `console.`, `.json(` (outside `page.tsx`'s Settings read and `LedgerCheckPanel.tsx`), `window.history.state`, `as any`, `text-slate-500` under `components/costs/`, `@/lib/` other than `ledgerCheckCopy`; the shared folder for `fetch(` outside `AdminBusinessPicker.tsx` | None in code |
| V-9 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions plausible; no file emptied |

### 7.1 Browser checks for QA (signed-in admin, DevTools Network open, light and dark emulation)

Every request on this tab is a `GET`, the leak check included: it writes nothing, makes no AI call and adds no audit row (`creditLeakCheck.ts:6`). It is still a heavy read (every business, up to 45 s) and it logs each leaking account at error level, so on production QA runs it **once, for one business and one day** (L9-B10), never the all-business default repeatedly.

| # | Check |
|---|---|
| L9-B1 | `/admin/business-os-llm?tab=costs`: five tiles, then the bar (Today … Custom, 90 days; 30 days pressed), one `credits/report` request |
| L9-B2 | 7 days: the address bar gains `range=7d`; reload reopens 7 days with one request |
| L9-B3 | Business picker: type a name, one `llm-usage/businesses` request while the list is open; pick → chip, `account=` in the address bar, one report request; a business with no charges → the empty sentence with "Clear filters" |
| L9-B4 | **Coexistence (Next sync, only provable here):** on Costs with 7 days and a business, click Activity: the address bar shows `?tab=activity` with no Costs key, one `ai-activity` request for this month with no `accountId`, **no** `credits/report` request. Back to Costs: the address bar shows the Costs keys again, **no** request of either kind |
| L9-B5 | On Activity set Outcome = Failed, go to Settings: `?tab=settings` only; back to Activity: `outcome=failed` back, no request |
| L9-B6 | Tiles: Periods not matching red only when a period disagrees; on an incomplete report every tile says "may be incomplete" and none is amber (SA M-1); a tile click scrolls to its section |
| L9-B7 | Custom with From after To: inline message, no request |
| L9-B8 | Offline + Refresh → "Could not reach the server…" with Try again; online + Try again restores |
| L9-B9 | Sections: numbers aligned in tabular figures, chips with icons, fallback times with "UTC", short group ids with the full id on hover |
| L9-B10 | Leak check (once, one business, one day): one `leak-check` request on Run only; status chips; table density matches the sections |
| L9-B11 | Light and dark emulation: tiles, bar, chips, tables, picker list and date inputs look the same (A-8) |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding (M-1 to M-3 applied 2026-10-12: §2.5, §2.6, §2.8, §2.10 items 1 and 8, §6.1, §6.3 X-5, X-10 to X-12, C-7, C-12, L-3, V-6 (o), L9-B6, Q-4; S-3, S-5, S-6 also written in)
- [x] 2. V-0 baseline run, counts recorded (Implementation Notes)
- [x] 3. Shared: `useAdminFilters` `active` + A-1 to A-9 (L-9a)
- [x] 4. `tabWindowFilter.ts` (move), `activityFilters.ts` repoint, `costsFilters.ts` + `costsFilters.test` (L-9a)
- [x] 5. `page.tsx` coordination + `ActivityTab` prop + `tabCoexistence.render` X-1 to X-12 (+ X-8b) (L-9a)
- [x] 6. `CostsTab.tsx`, `CostsFilterBar.tsx`, `CostsKpis.tsx`, copy; E-1 to E-8; C-1 to C-8, C-12; G-5 (L-9a)
- [x] 7. V-1 to V-9 for L-9a; requirement §1 row 15, §6.2 C-7, §7.12 as built, §9, Change History; hand to SA code review + QA (nothing committed by Dev)
- [x] 8. `CostsSections.tsx` (§2.7) + C-9, C-10, E-9 (L-9b)
- [x] 9. `LeakCheckPanel.tsx` (§2.8) + L-1 to L-4, C-11; G-6 (L-9b)
- [x] 10. V-1 to V-9 for L-9b; requirement row and §9 dispositions (F-71, F-72, F-74); hand to SA code review + QA (nothing committed by Dev)

---

## 9. Sizing and split

| Part | Days |
|---|---|
| `active` option + A-1 to A-9 (task 3) | 0.6 |
| Window wrapper move + Costs spec + pure test (task 4) | 0.3 |
| Page coordination + coexistence suite with the lagging mock (task 5) | 0.8 |
| Costs bar, picker, URL, states, KPI strip + tests (task 6) | 1.3 |
| Sections restyle + tests (task 8) | 0.5 |
| Leak panel restyle + reads + tests (task 9) | 0.5 |
| Guards, verification, docs (tasks 7, 10) | 0.7 |
| **Total** | **about 4.7 days** |

Over the few-days slice size. **Recommended split** (Q-8), the same cut as L-8a / L-8b:

| Slice | Content | Days | Path |
|---|---|---|---|
| **L-9a** | Shared `active`; page coordination; Costs filters, bar, picker, URL, KPI strip, states, reads (F-67 Costs half, F-113) | about 3.5 | **Full cycle** (shared hook change) |
| **L-9b** | Sections on the table constants and chips; leak panel restyle and reads (F-67 leak half, F-71, F-72, F-74) | about 1.2 | UI short path (no shared export), fast-track |

L-9b is cut from the L-9a commit by RM; both PRs target `main` (stacked-merge hazard). If SA prefers one PR, the task order is that PR.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The Next sync lag makes a newly visible tab read with the previous tab's filters | Inactive mount takes the defaults; activation is gated on the page's `useSearchParams` naming the tab; the lagging-mock cases X-7 to X-9 and mutations (c), (e); L9-B4 in a real browser |
| An activation write races Next's delivery of the page's write | The page writes the incoming tab's projection itself (stash), so the activation write normally finds nothing to do; X-2 / T-16 pin one write per switch |
| Next never syncs (a future Next change) | Tabs would stay inactive after a click: reads still follow the filters, only the address bar stops following. Degrades to "URL not updated", never to wrong data; L9-B4 is the live check |
| A soft navigation to the bare page path (sidebar link while on the page) leaves the visible tab inactive until the next tab click | Pre-existing: the page reads `tab` once, so it already shows a tab the URL does not name. Recorded as a new §9 finding (UX, open), not fixed (it would change the "read once" rule) |
| Another `useAdminFilters` page changes behaviour | `active` defaults to `true` and every changed line is behind `active === false` or the activation edge; all five pages' suites run unedited (V-1) |
| The picker offers a platform account and the routes answer a machine code | Recognised before generic copy in both reads (C-7, L-3); copy per Q-4 |
| A leak check run on production during QA adds error-level log lines | Read-only; QA runs it once, for one business and one day (§7.1) |

---

## 11. Out of scope and found on the way

- **New §9 finding (UX, open):** a soft navigation to `/admin/business-os-llm` without `tab` while the page is open keeps the shown tab (the page reads `tab` once) and, after L-9, leaves that tab's filters out of the address bar until the next tab click (§10). **Widened (SA S-5):** a Back across an anchor history entry (`#costs-…`, from a KPI anchor tile) can likewise land on a URL naming a different tab than the one shown; the visible tab then stays inactive until the next tab click (read-once page). Recorded, not fixed in L-9.
- **New §9 finding (API, open):** the report and leak-check routes answer the platform-account case with the machine code `platform_account` (as the AI activity route does); the tab maps it to its own sentence (Q-4). Same class as F-109 / F-114; its own slice.
- **New §9 finding (cos, open):** the costs `unreadable` and `names-failed` lines are amber `text-xs` lines rather than the shared notice; kept (not layout-forced).
- **Stays as planned:** the Settings read and `LedgerCheckPanel` `.json(` (F-67 Settings half, L-10); the registry entry (L-10); `formatUtcDate` stays deferred (Costs' only date-only column already prints through `formatDay`, a `Date`-based UTC formatter; Q-9).
- **Done here:** F-113 (L-9a); F-67 Costs and leak halves; F-71, F-72 (Costs and leak halves, closing both); F-73 for Costs (shared bar); F-74; D-15 for Costs; SA-R-11 (forced picker change).
- **Requirement §9 count line** ("Count: 109 items") predates F-112 to F-117; corrected with this slice's additions.

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Coexistence mechanism (§2.2): `active` on the hook (inactive mount = defaults; activation adopts the incoming string and writes only if needed) + the page gating `active` on its own `useSearchParams` naming the tab + a page-side stash so one write per switch carries the incoming tab's keys. Approved over lifting both hooks into `page.tsx`? | Yes: one optional hook argument, tabs stay self-contained, existing suites unedited, and it is the only shape I found that is correct under Next's transition-delayed `useSearchParams` |
| Q-2 | The page computes the union of tab-owned keys from the two specs itself (`Object.values(spec)` keys + alias keys) rather than a new shared `filterKeysOf(spec)` export | Page-local (no second shared change; SA-R-3) |
| Q-3 | Move Activity's private window wrapper to `tabWindowFilter.ts` and use it for Costs, rather than copying it | Move (one rule for "the route takes two whole dates"; Activity behaviour pinned by its suites, unedited) |
| Q-4 | A platform account picked on Costs: the report and leak routes answer 409 `platform_account`. Show a Costs sentence in an `AdminNotice`, or follow §5.10 rule 1 and show `platform_account`? **Applied wording (SA M-2):** "That is a platform account, not a business, so it has no charges here. Clear the business to see every business; a leak check over every business counts platform AI calls." (one constant, `COSTS_PLATFORM_ACCOUNT`, for both reads) | The sentence (the Activity precedent, L-8 Q-12); the machine code goes to §9 as an API finding |
| Q-5 | Chip tones: period check "matches its rows" `info` → `ok` (green), "not checked" → `unknown`; leak `could_not_check` amber → `unknown`, `clean` stays `neutral`. Words unchanged | Yes (§5.9 meanings; T-6 allows green for a proven-equal period). If SA prefers no colour change for "matches", keep `info` |
| Q-6 | A tab switch drops the URL hash (a Costs anchor tile's `#costs-periods`) | Yes (an anchor belongs to the tab that drew it) |
| Q-7 | Leak verdict boxes: keep all four as they are (results, not states), or move the amber partial verdict onto `AdminNotice`? | Keep (the emerald clean verdict is the proven-clear green; the red found verdict is not an error) |
| Q-8 | Split L-9a (about 3.5 days, full cycle) / L-9b (about 1.2 days, UI short path, fast-track), both PRs to `main` | Yes |
| Q-9 | `formatUtcDate` stays deferred (Costs' date-only column already uses `formatDay`, `Date`-based UTC) | Yes (no export without a need, SA-R-3) |
| Q-10 | KPI colours: Periods not matching red when > 0 (K-5 (ii), the red mismatch chip and line); all five tiles amber "may be incomplete" under `incomplete` (K-5 (ii), the amber notice); Fallback-priced otherwise neutral; anchors only while the section renders | Yes |

---

## 13. Product question for the user

None. The choices are already decided by the requirement (D-2 (b): the standard five plus 90 days; D-4 (a): tile colours; D-15: "Refresh"; SA-R-11: the business picker) or are technical and go to SA. **For your information:** the business list on this tab now searches every business, not only those with charges in the window, so picking one that had no AI charges shows "No charges recorded in this window" where before it could not be picked. Switching between the Costs and Activity tabs no longer mixes their filters in the address bar.

---

## SA Review Notes

## SA Workplan Review — 2026-10-12

**Reviewed by SA — 2026-10-12**
**Status:** ✅ APPROVED WITH CONDITIONS. M-1 to M-3 must be applied to this file before coding (task 1) and are checked at code review. S-1 to S-7 are expected; a Dev who disagrees records why in Implementation Notes. No product question for the user.

### What SA verified in the code (at d5990480)

| Claim | Verified |
|---|---|
| `active` defaulting to `true` leaves the five other pages unchanged | `useAdminFilters.ts` has one call shape; Audit trail, AI cost & usage, Businesses, Messages and Activity call it without options. Every behaviour change in §2.2 sits behind `active === false` or the false-to-true edge, so with the option omitted the initializer, both effects and `hrefFor` run exactly as today |
| T-16 stays green unedited | `activityLayout.render.test.tsx:589-612` asserts one list read, the controls, and exactly two `replaceState(null, …)` calls whose `tab` is `settings` then `activity`. It does not assert the other parameters of the first write, so dropping `range` / `outcome` on the way to Settings and appending them on the way back still gives two writes, and Activity's activation finds the projection already present (no third write) |
| Fixed-string suites unaffected | `activityTab.render` mocks `useSearchParams` with a fixed `mockSearch`. A click on Activity from `mockSearch = ''` leaves Activity inactive for the rest of that test (the fixed string never names it); it then mounts at defaults (what `''` parses to anyway) and still reads; E-4 asserts only the page's own tab write. Green unedited, as claimed |
| Next timing (§1.3) | Correct: the page and every tab read the same `SearchParamsContext`, so in one render they see one string; the click render carries the old string. Gating `active` on the page's own string is therefore sound and cannot disagree with the tab's `incoming` |
| Leak check is read-only | `leak-check/route.ts` exports `GET` only (`:95`), `requireAdmin` first, Zod strict, no audit; `creditLeakCheck.ts` has no insert / update / upsert / delete / rpc write. With `accountId` the run checks **only that account** (`:548-553`) and skips the platform count (`:719`), so a one-business, one-day run is a small read, not the 45 s every-business walk |
| Both routes answer 409 `platform_account` | `report/route.ts:126`, `leak-check/route.ts:130` |
| Shared tile has no amber sub-line | `KpiStrip.tsx:159-161`: the sub-line is `text-slate-400` only; status is `red` or `amber` on the whole tile |

### Coexistence design: SA trace

Traced each requested scenario through the proposed hook and page. All hold.

| Scenario | Result |
|---|---|
| Double reads | First visit: the inactive mount takes `defaultsOf(spec)`, one mount read; activation adopts the incoming string without a `setState`, so `filters` keeps its identity and the memoised route search does not change. Deep link: active from the first render (the page and the tab see the same string), one parse, one read |
| Write loops | Inactive never writes; the activation write records `lastKnown` before writing, so Next's echo is skipped; the page writes only on a click. No path writes in response to its own echo |
| Lost filters on return | The hidden tab neither parses nor records, so its state is exactly what it had; the stash puts its projection back in the URL; activation finds nothing to change. If the state moved while visible-but-inactive (A-7, the lag window), the activation write corrects the URL in a second write: the state wins, never the stale URL |
| Back / Forward | Tab switches and filter changes are `replaceState`, so they make no Back entries (as today). Back leaves the page; returning remounts it, `tab` is read once, the visible tab parses the last written URL and reopens its view. The hidden tab's kept state goes with the unmount, as today. An active tab still re-parses an outside change (A-6) |
| Deep links | `?tab=activity&outcome=failed`: Activity active at mount, parses, one read; Costs not mounted. `?tab=costs&range=90d`: Costs active at mount, `90d` is a Costs extra, one read over 90 days. `?tab=costs&range=yesterday` / `?tab=activity&range=90d`: not that tab's value, ignored (U-4), default read |
| Legacy aliases | Neither Costs nor Activity has aliases (both had no URL). The union deletion includes alias keys anyway, so a future alias cannot survive a switch |
| Stray keys | Dropped on the first switch (X-5). One **deliberate change** from L-8: a Settings or Costs URL that carries Activity's keys used to open Activity filtered on its first click (it parsed the URL at mount); now it opens at defaults. Nothing emits such a link (Health links to the bare page; Activity's tiles carry `tab=activity`). Named in M-3 |

### Rulings on Q-1 to Q-10

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved: `active` on the hook + page-gated activation + page stash, one write per switch.** Not lifting both hooks into the page | It is the only shape that is correct under Next's transition-delayed `useSearchParams` without making both tabs prop-driven; one optional argument, and the inactive-mount rule would be needed by the lifted design anyway |
| Q-2 | **Approved: the union of tab-owned keys is page-local**, computed from the two module-level specs (`keys` plus alias keys), never a hand-written key list | No second shared export without a second user (SA-R-3); deriving it from the specs keeps a future key from leaking across tabs |
| Q-3 | **Approved: move** Activity's wrapper to `tabWindowFilter.ts` and use it for Costs | One rule for "the route takes two whole dates"; it carries the M-1 equality rule (spread `windowFilter`, override `parse` only) for both tabs |
| Q-4 | **Approved: a Costs sentence in an `AdminNotice`, not the machine code. Wording corrected (M-2)** | Activity precedent (L-8 Q-12). The proposed text sends the admin to the leak check below, which follows the picked business and answers the same 409 |
| Q-5 | **Approved as proposed**: "matches its rows" `ok`, "not checked" `unknown`, leak `could_not_check` `unknown`, `incomplete` `warn`, `leak` `danger`, `clean` `neutral`; words and test ids kept | §5.9 meanings: a period proven equal to its rows is "clear"; "could not check" is `unknown`. `clean` stays quiet so the green verdict box carries the result and a long table is not a wall of green |
| Q-6 | **Approved: a tab switch drops the hash** | An anchor belongs to the tab that drew it; a stale `#costs-periods` on Activity points at a hidden element |
| Q-7 | **Approved: keep all four verdict boxes** | They are results of an action, not page states |
| Q-8 | **Approved: split L-9a / L-9b, both PRs to `main`.** L-9a full cycle; L-9b UI short path; both under the fast-track (SA code review + QA, then RM) | 4.7 days is over the slice size; the cut isolates the shared change. RM: L-9b is cut from the L-9a commit and targets `main`, so it carries L-9a until that merges (no stacked base) |
| Q-9 | **Approved: `formatUtcDate` stays deferred** | No export without a need (SA-R-3); `formatDay` is already `Date`-based UTC |
| Q-10 | **Partly approved.** Periods not matching: red ("Needs action") when > 0, also under `incomplete`, else neutral; "Not checked" value when none was checked: neutral. Anchors only while their section renders: approved. **Under `incomplete`: the "may be incomplete" sub-line on all five tiles, but no amber status on any tile (M-1)** | §7.12 decides the colour column: the first four tiles are Neutral, and the incomplete case is a sub-line on the whole strip (the K-8 lower-bound pattern). K-5 (ii) permits amber but does not require it; five amber tiles would repeat the amber notice that sits directly below and drown the one red tile. The shared tile has no amber sub-line (`KpiStrip.tsx:159-161`), so the sub-line stays slate-400: no shared change |

### Findings

**Must (apply before coding):**

| # | Where | Finding | Required change |
|---|---|---|---|
| M-1 | §2.5, §2.10 item 1, C-12, L9-B6, mutation list | KPI colours under `incomplete` (Q-10 ruling) | Under `incomplete`: sub-line "may be incomplete" (joined with any other sub-line) on all five tiles, **no** `amber` status. Credits charged, Cost (USD), Charges, Fallback-priced: always neutral. Periods not matching: `red` when > 0 regardless of `incomplete`, else neutral. C-12 asserts `data-status="neutral"` on the four tiles under `incomplete` and `red` on Periods with `mismatchedPeriods > 0` and `incomplete` both set. Add mutation (o): a tile turned amber under `incomplete` → C-12 fails |
| M-2 | Q-4, `costCopy.ts` `COSTS_PLATFORM_ACCOUNT`, C-7, L-3 | The proposed sentence points at "the leak check below", which follows the picked business and refuses the same platform id (`leak-check/route.ts:130`); platform calls are counted only when the check runs over every business (`creditLeakCheck.ts:719`) | Use one constant for both reads: "That is a platform account, not a business, so it has no charges here. Clear the business to see every business; a leak check over every business counts platform AI calls." C-7 and L-3 assert this constant. The leak panel's 409 shows it in its error / notice slot without "Try again" |
| M-3 | §6.3 `tabCoexistence.render`, §2.10 | Three scenarios SA traced are not pinned | Add: **X-10 (lagging)** Costs → Activity → Costs with no `sync()` between the clicks: one write per click, no report read and one Activity mount read in total, final URL carries the Costs keys; after `sync()` no further read and no write. **X-11** an outside change on the visible, active tab still re-parses at page level (set `?tab=costs&range=90d` as an outside change, sync: one report read over 90 days, "90 days" pressed), and the same change while Costs is hidden reads nothing. **X-12** deep link `?tab=costs&range=90d`: one read spanning 89 days, "90 days" pressed; then Activity first visit reads This month and the URL has no `range`. Extend **X-5** with `?tab=settings&outcome=failed` → Activity opens at defaults and `outcome` is gone; name this in §2.10 and the PR as a deliberate change from L-8 (a stray Activity key no longer pre-filters Activity's first open) |

**Should:**

| # | Where | Finding |
|---|---|---|
| S-1 | §2.2 page | Compute `urlTab` as `searchParams ? tabFromParam(searchParams.get('tab')) : null`, so "the tab the URL names" has one rule with the read-once (an unknown or missing value names Settings). Behaviour is the same today (Settings has no hook) but a raw `get('tab')` is a second reading of the same parameter |
| S-2 | §3.1 hook | Read the option once as a primitive (`const active = options?.active ?? true`) and put the boolean, never the options object, in effect dependencies (an inline `{ active }` is a new object every render). Detect activation with a previous-active ref inside the re-read effect, and keep the re-read effect declared before the write effect so the adoption of `lastKnown` happens before the activation write in the same commit. A-3 / A-4 / A-5 pin it |
| S-3 | V-7 | Add `app/admin/components` to the diff check: only `layout/useAdminFilters.ts` and its render test may change. `components/activity` still shows the one prop in `ActivityTab.tsx` only (as written) |
| S-4 | Comments and §9 | `page.tsx` header: the paragraph "The Activity filter hook then sees each tab click as an outside change and re-parses to the same filters" is no longer true after L-9a; replace it with the coexistence rule. The hook's header gains the `active` paragraph (planned). F-113 → done (L-9a) in §9 with the rule in one sentence |
| S-5 | §10 / §11 open UX finding | Widen the recorded finding: besides a soft navigation to the bare path, a Back across an anchor (`#costs-…`) history entry can land on a URL naming a different tab than the one shown, and the visible tab then stays inactive until the next tab click (read-once page). Record, do not fix in L-9 |
| S-6 | C-11 / L9-B10 | C-11 also asserts the leak scope returns to every business when the picker is cleared. L9-B10: QA picks a business in the bar **before** pressing Run and confirms in Network that the `leak-check` request carries `accountId` |
| S-7 | §2.6 / §2.8 | Keep the first-read `isCurrent()` check ahead of every `setState` after `readJsonBody` (newest wins stays exactly as today); E-tests already cover the slower-earlier cases, no new case needed |

**Notes:**

- N-1: the tab does not opt in to the "session ended" copy for 401/403 (RC-4 is opt-in; Activity did not either). Consistent; no change.
- N-2: in the click render a visible-but-inactive tab's `hrefFor` is built from the previous string for one transition render (Activity tile hrefs). Corrected on the next render; no action.
- N-3: at activation the tab's state wins over the URL. The page always writes that state itself, so the only way they differ is an outside navigation into a disowned tab (S-5), where "the address bar is corrected to what is shown" is the right failure.
- N-4: `costsFilters.test` parity with today's `presetQuery(30)` is the proof that the default request is unchanged; keep it as written.

### Ruling: the leak check on production during QA

**Allowed once, narrowly; everything else jsdom only.** One run on production, with **one business picked in the bar** (so the request carries `accountId`) and **one day** (From = To). Verified above: `GET` only, admin-gated, no write, no audit, no AI call, and with `accountId` the run checks that one account and skips the platform count, so it is a small read, not the 45 s every-business walk. If that run logs `bos_credit_leak_found` at error level, it is a **true finding** about real money: QA records it in the QA report and tells TL; it is not a reason to avoid the run. **Never** run the every-business default on production, never repeat the run, and keep the 409, network and non-JSON cases (L-1 to L-3) in jsdom.

### Test and verification review

The enumerated tests cover the hook (A-1 to A-9), the page under both mocks (X-1 to X-9, plus M-3), the pure contract, the layout and the KPI rules; the mutation list maps each design rule to a failing case, including the two Next-timing rules ((c), (e)) that only the lagging harness can catch. `test:bos-llm` and `typecheck:bos-llm` stay in V-2 (the wire types are pinned there); `test:bos-entitlements` in V-3. L9-B4 and L9-B5 are the only proof of the real Next sync: QA must not skip them.

### Verdict

**APPROVED WITH CONDITIONS — proceed to L-9a** once M-1 to M-3 are applied to this file. L-9b follows on the L-9a commit (UI short path, fast-track). No product question for the user. SA set requirement §1 row 15 (L-9a) and added row 15b (L-9b) today.

### Approval

[x] Workplan approved — proceed to implementation (L-9a first), conditions M-1 to M-3

## Implementation Notes (L-9a)

**Dev, 2026-10-12. Code complete, nothing committed** (RM commits after SA code review + QA). Branch `feature/admin-layout-l9`. L-9b (sections, leak panel) not started.

### What was built

| File | Change |
|---|---|
| `app/admin/components/layout/useAdminFilters.ts` | `options?: { active?: boolean }`, read once as a boolean (S-2); inactive mount = defaults (no parse); re-read effect (declared first) returns while inactive and, on the false-to-true edge (a `wasActive` ref inside the effect), adopts `incoming` as `lastKnown` without parsing; write effect returns while inactive, `active` in its deps; header paragraph. No new export (the option type is inline) |
| `app/admin/components/layout/__tests__/useAdminFilters.render.test.tsx` | New `describe` A-1 to A-9 (A-9 run twice: option omitted, and `true`); every existing case unedited |
| `app/admin/business-os-llm/page.tsx` | `urlTab = searchParams ? tabFromParam(searchParams.get('tab')) : null` (S-1); `owns(id)`; `saved` ref; `writeTabToUrl(from, to, saved)`: save the leaving tab's keys, delete the union of both specs' keys and aliases (`ownedKeys`, Q-2), drop the hash (Q-6), set `tab`, append the incoming tab's saved keys, one `replaceState(null, …)`; same tab = today's write; `active` passed to both tabs; the stale header paragraph replaced by the coexistence rule (S-4) |
| `app/admin/business-os-llm/tabWindowFilter.ts` | **New**: `wholeDateWindowFilter({ defaultValue, extras })`, Activity's wrapper moved unchanged (Q-3) |
| `app/admin/business-os-llm/activityFilters.ts` | Uses `wholeDateWindowFilter`; the private wrapper removed |
| `app/admin/business-os-llm/costsFilters.ts` | **New**: `CostsFilters`, `COSTS_FILTER_SPEC` (`range, from, to, account`), `COSTS_DEFAULT_WINDOW` (30 days), `COSTS_WINDOW_EXTRAS` (`90d`), `costsRouteSearch` |
| `app/admin/business-os-llm/costCopy.ts` | `COSTS_WHAT`, `COSTS_ERROR_FALLBACK`, `COSTS_PLATFORM_ACCOUNT` (M-2 wording, one constant for both reads), the KPI labels and sub-lines |
| `components/costs/CostsTab.tsx` | Shared hook with `active`; memoised route search; `picked` name; KPI strip; bar; always-mounted `costs-content` with `aria-busy`; shared loading, error (Try again), platform notice, empty (Clear filters); `readJsonBody`, `ADMIN_NETWORK_ERROR`; newest wins unchanged (S-7); the `accounts` list state, `PRESETS`, `presetQuery`, the select and the "read at" span removed; window line slate-400 |
| `components/costs/CostsFilterBar.tsx` | **New** (§2.3) |
| `components/costs/CostsKpis.tsx` | **New** (§2.5 with M-1) |
| `components/costs/CostsSections.tsx` | One line: `SectionShell` gets `id={testId}` (see deviation 2) |
| `components/activity/ActivityTab.tsx` | The `active` prop only (default `true`), passed to the hook |
| `__tests__/costsTab.render.test.tsx` | E-1 to E-8 as §6.2 (E-7 in two cases); two helpers added (`BUSINESSES_PATH` answer, `pickBusiness`) |
| `__tests__/costsFilters.test.ts`, `costsLayout.render.test.tsx`, `tabCoexistence.render.test.tsx` | **New** |
| `__tests__/source.guard.test.ts` | New `describe` G-5 (planted-string self-test, folder walk, per-file rule); no existing case edited |

### Verification (real output)

| # | Result |
|---|---|
| V-0 baseline (before any source edit) | The task's jest set (§6.1 folders + `lib/admin/__tests__/admin-authz-surface.guard.test.ts` + `app/__tests__/tailwind-css-escape.guard.test.ts`): **80 suites, 2402 tests, all passed**. JSON baseline of `audit-trail`, `analytics`, `users`, `messages`, `finance`, `components`: 65 suites, 1650 tests |
| V-1 after | Same set: **83 suites, 2501 tests, all passed** (+3 suites, +99 tests). The other-pages JSON compared suite by suite: 65 suites, 1660 tests; the **only** difference is `useAdminFilters.render.test.tsx` 25 → 35 (A-1 to A-9); Audit trail, AI cost & usage, Businesses, Messages, Finance and every other shared suite equal to V-0. T-16 green unedited |
| V-2 | `npm run test:bos-llm`: 23 suites, 625 tests passed. `npm run typecheck:bos-llm`: "499 files in scope, 28 errors, 0 new", passed (it also reports one baseline entry already fixed, `app/api/onboarding/build/route.ts` TS18047, unrelated to this slice) |
| V-3 | `npm run test:bos-entitlements`: 242 suites, 7062 tests passed |
| V-4 | Scratch tsconfig in the session scratchpad (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`). `--listFilesOnly` listed the canary and 93 files under `app/admin`. Run 1 with `canary.ts` (`const canary: number = 'x';`): exit 2, exactly one error, `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 without the canary: exit 0 |
| V-5 | `npm run lint:hooks`: exit 0. `npx eslint` on all 17 touched files: clean (one unused import in the new `costsLayout.render` fixed) |
| V-6 | Mutations (a) to (l) and (o), each applied by an exact replacement, run, restored from the original bytes, md5 equal before and after (all 13 equal). (a) A-2, A-4, X-1 to X-4, X-6 to X-9, X-11, X-12 fail; (b) A-1, A-5, A-7, X-1 to X-4, X-7, X-8, X-8b, X-10, X-11 fail; (c) A-1, A-5, X-7 fail; (d) A-4, A-5, A-7, X-8b fail; (e) X-7, X-8b, X-10, X-11 fail; (f) both X-5 cases fail; (g) X-2, X-4, X-8, X-8b, X-10 and **T-16** fail; (h) X-11 and the `costsFilters.test` equality case fail; (i) C-6 fails; (j) C-12 fails; (k) G-5 (`CostsTab.tsx`) fails; (l) E-1 fails; (o) C-12 (the M-1 case) fails |
| V-7 | `git diff --stat d5990480 -- app/api lib app/admin/finance app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/business-os-llm/components/settings app/admin/business-os-llm/components/AreaCard.tsx app/admin/business-os-llm/components/LedgerCheckPanel.tsx`: empty. `components/activity`: `ActivityTab.tsx` only, 3 insertions, 2 deletions (the prop). S-3: `app/admin/components`: only `layout/useAdminFilters.ts` and `layout/__tests__/useAdminFilters.render.test.tsx` |
| V-8 | No `console.` in the page folder; `.json(` only in `page.tsx` (Settings, L-10), `LedgerCheckPanel.tsx` (L-10) and `LeakCheckPanel.tsx` (L-9b); no `window.history.state`, no `as any`; `@/lib/` only in comments; shared-folder `fetch(` only in `AdminBusinessPicker.tsx`. `text-slate-500` under `components/costs/` remains only in `CostsSections.tsx` (spread service) and `LeakCheckPanel.tsx`, both L-9b (G-6) |
| V-9 | `git diff --stat`: no file emptied, no deletion-only file; line endings preserved (CRLF files stayed CRLF, LF files LF; new files LF like the L-8 page-folder modules) |

### Deviations

1. **G-5 carries one named exception until L-9b:** `LeakCheckPanel.tsx` keeps its `response.json()` (its read moves in L-9b, §2.8, F-67 leak half), so G-5 lists it in `JSON_UNTIL_L9B`; L-9b empties that list. `fetch(` is still allowed only in `CostsTab.tsx` and `LeakCheckPanel.tsx`.
2. **Section `id`s moved from L-9b into L-9a** (one line in `CostsSections.tsx`): the L-9a anchor tiles point at `#costs-periods`, `#costs-breakdowns`, `#costs-fallback`, and without the ids they would be dead links until L-9b. C-12 asserts the ids; C-10 (table names) stays in L-9b.
3. **The incomplete box stays as it is in L-9a** (the move onto `AdminNotice` is E-9, tagged L-9b): `costsTab.render`'s "amber banner" case therefore runs unedited here.
4. **Fallback-priced reads "Unknown" whenever the rows were not read** (`sections.rows !== 'ok'`), not only when `failed`: under a failed totals read the rows are `skipped` and `fallback.count` is 0, which would read as a real zero.
5. **Mutation mapping:** by design activation never re-parses, so (h) cannot fail X-2 as §7 V-6 predicted; X-11 gained an outside change that only adds an unrelated key (no read), which (h) fails, plus the `costsFilters.test` equality case. Likewise (d) cannot fail X-8 as written (the synced string equals the state); **X-8b** was added (a Costs change in the lag window must survive activation), which (d) fails, as does A-5.
6. **X-8 "one write in total"** is read as one write for the revisit click (two clicks, two writes overall).
7. **`CostsTab.tsx` was replaced with the Write tool** rather than Edit (most of the file changed); content checked through the diff and every test, CRLF restored. Noted because the brief asked for Edit on existing files.

### User-visible changes (L-9a, on `/admin/business-os-llm?tab=costs`)

1. Five headline tiles above the bar (Credits charged, Cost (USD), Charges, Fallback-priced, Periods not matching); Periods not matching is red only when a period disagrees; an incomplete report adds "may be incomplete" to every tile, none turns amber; tiles jump to their section.
2. Window row Today, 7 days, 30 days, This month, Custom, 90 days (default 30 days); From / To only under Custom with "Apply"; a reversed range is refused inline.
3. "Business" search picker instead of the "Account" list (searches every business; a business with no charges shows "No charges recorded in this window" with "Clear filters"); chip "Business: {name}" with X; Clear; "Refresh" with a word.
4. Every filter in the address bar (`range`, `from`, `to`, `account`); a reload or shared link reopens the same view. Switching between Costs and Activity no longer mixes their filters in the address bar, and drops a `#…` anchor.
5. A network failure says "Could not reach the server…" with Try again; a platform account gets a sentence instead of `platform_account`.
6. **Deliberate change from L-8:** a stray Activity key on a Settings or Costs URL no longer pre-filters Activity's first open.

### Tests edited, with reasons

Only `costsTab.render.test.tsx`, cases E-1 to E-8 exactly as §6.2 (E-1 network words; E-2 / E-7 "7 days"; E-3 rewritten for the picker; E-4 Custom then "Apply"; E-5 / E-8 "Refresh the cost report"; E-6 the picker and chip). No other existing case in any suite was edited; `source.guard` and `useAdminFilters.render` only gained new cases.

### Out of scope, recorded (not fixed)

- F-118 to F-121 in the requirement §9 (read-once tab vs soft navigation / Back across an anchor, S-5; the credits routes' `platform_account` code; the Costs amber text lines; the stale `ActivityTab` header sentence about "an outside change", kept because V-7 limits that file to the prop).
- `typecheck:bos-llm` reports a baseline entry that is already fixed (`app/api/onboarding/build/route.ts`), unrelated; for whoever owns that baseline.
- **For L-9b:** Q-5 chip tones (period check and leak statuses), S-6 / C-11 (leak scope back to every business when the picker is cleared), E-9, G-6, the leak panel's `readJsonBody` read and L-3 with `COSTS_PLATFORM_ACCOUNT` (the constant already exists).

## SA Code Review (L-9a) — 2026-10-12

**Code Review by SA — 2026-10-12**
**Status:** ✅ Code Approved. No must-fix. Fast-track: proceed to QA, then RM.

### What SA checked

| Area | Result |
|---|---|
| Diff shape | `git status --short` + `git diff --stat`: 11 modified (608 insertions, 268 deletions), 8 new; no file emptied, no deletion-only file. Nothing under `app/api`, `lib`, other admin pages, `activityLayout.render` or `activityTab.render` changed (T-16 and the fixed-string suites unedited) |
| Shared hook `useAdminFilters.ts` | `active` read once as a primitive (`options?.active ?? true`), only the boolean in deps (S-2). Inactive mount: `defaultsOf(spec)`, no parse. Re-read effect declared before the write effect; `wasActive` ref updated inside it; inactive returns before reading or recording; the false-to-true edge adopts `incoming` as `lastKnown` without `setState`. Write effect returns while inactive, `active` in deps, so activation writes once only if the projection differs. With the option omitted: `wasActive` starts `true`, `activated` is never true, both guards are no-ops, and the extra `active` dep never changes, so the default path is behaviourally identical (A-9 pins omitted and `true`). StrictMode double-run on mount cannot fake an edge (the ref starts equal to `active`) |
| Page `page.tsx` | `urlTab` via `tabFromParam` (S-1); `owns(id)` = shown AND URL names it, null-router fallback. `writeTabToUrl(from, id, saved)`: saves the leaving tab's keys, deletes the union derived from both specs (keys + aliases, Q-2), clears the hash (Q-6), sets `tab`, appends the incoming saved keys, one `replaceState(null, …)`; same-tab click keeps today's single write. Stale header paragraph replaced (S-4). Traced first visit, revisit, lag-window change (state wins on activation), deep links: all as the SA workplan trace |
| `CostsTab.tsx` rewrite (deviation 7), against HEAD line by line | Kept: newest-wins sequence + abort (CR-N2), the unmount cleanup, payload cleared on failure, the `costs-window` / `costs-incomplete` / `costs-unreadable` / `costs-names-failed` / `costs-totals-failed` / `costs-empty` / `costs-error` / `costs-loading` / `costs-tab` testids, the four sections in order, the leak panel fed the chosen account and its label. Removed as planned: `PRESETS`, `presetQuery`, the `accounts` list, the `<select>` (`costs-account-filter`), the controls row, the "read at" span (now the bar's). Changed as planned: `readJsonBody` (never throws, so dropping the outer `catch` loses nothing), network failure → `ADMIN_NETWORK_ERROR`, 409 `platform_account` → `AdminNotice` with `COSTS_PLATFORM_ACCOUNT`, `isCurrent()` ahead of every `setState` (S-7), route search memoised on `filters` (Refresh / Try again resend the same dates), loading suppressed while an error shows. The default request equals the old `presetQuery(30)` (`costsFilters.test`, N-4) |
| Costs filters / bar / picker / URL | `costsFilters.ts`: `range, from, to, account`, no aliases, `90d` extra, UUID-only account, two-whole-dates wrapper shared via `tabWindowFilter.ts` (Q-3, Activity's code moved unchanged, `windowEquals` kept). Picker replaces the select (SA-R-11); chip name = picked, else the report's, else short id |
| KPI strip (M-1) | The four totals tiles never carry a status; Periods not matching `red` when > 0, under `incomplete` too; "may be incomplete" joined into every sub-line; anchors only while sections render; section shells carry `id` = testid (deviation 2, accepted: without it the L-9a tiles would be dead links). Deviation 4 (Fallback-priced "Unknown" unless `sections.rows === 'ok'`) accepted: a skipped rows read reports `count: 0`, which would read as a real zero |
| M-2 constant | One `COSTS_PLATFORM_ACCOUNT`, wording as ruled; the route answers `error: 'platform_account'` with 409 (`report/route.ts:126`) |
| G-5 `JSON_UNTIL_L9B` (deviation 1) | Accepted for one slice: the list names only `LeakCheckPanel.tsx`, and L-9b must empty it |
| Mutations (deviations 5, 6) | Accepted: activation never re-parses by design, so (h) is caught by the X-11 unrelated-key case and the `costsFilters.test` equality case; (d) by X-8b and A-5. The X-8 "one write" reading (one per click) matches M-3's X-10 wording |
| Standards | No LLM, data or API change; `@/lib/` only in a comment; no `console.*`, no `any`; no backslash in either MD; the requirement edits (§1 rows 15 / 15b, C-7, §7.12, F-67, F-113, F-118 to F-121, count 119) are accurate |
| Tests run by SA | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages --ci`: **78 suites, 2310 tests, all passed** (Audit trail, Analytics, Businesses, Messages suites green and unedited). `npm run test:bos-llm`: **23 suites, 625 tests passed** |

### Code Review Comments

1. Line endings (V-9) — verified: the new files are LF and `CostsTab.tsx` stayed CRLF, as Dev states; every index entry is `i/lf` with `core.autocrlf=true`, so the commit is LF throughout. No action — Priority: none (confirmation)
2. `app/admin/business-os-llm/components/activity/ActivityTab.tsx` header — the L-8a sentence about a tab click being "an outside change" is now stale; recorded as F-121 and held by V-7. Fix it when the file is next touched (L-9b or L-10) — Priority: Low
3. `app/admin/business-os-llm/components/costs/CostsTab.tsx:84` — `picked` is not reset on Clear or chip removal. Harmless (the name is used only when `picked.accountId === filters.account`); no change needed — Priority: Low (note only)

### Optimisation Suggestions

- None for L-9a. For L-9b: empty `JSON_UNTIL_L9B`, move the incomplete box onto `AdminNotice` (E-9), and fix the F-121 sentence if `ActivityTab.tsx` is opened.

### Code Approved for QA: Yes

QA must run L9-B4 / L9-B5 (the real Next sync, which jsdom cannot prove) and keep to the production leak-check ruling: one run, one business, one day.

## QA Testing Report

## QA Report (L-9a) — 2026-10-12

**QA — 2026-10-12**
**Test mode:** full (from the prompt: tab coexistence, the other `useAdminFilters` pages, Costs states, KPI rules, anchors, accessibility)
**Strategy used:** A + B (Jest, jsdom, mocked `fetch` only) + scoped `tsc`. D (browser) is listed for TL below: QA had no signed-in browser session, so **L9-B4 / L9-B5 were not run by QA** even though the SA code review asked for them
**Focus:** ui, the two GET reads (mocked), regression of the shared hook
**Skipped:** browser checks L9-B1 to L9-B11 (no browser in this session; listed for TL, with L9-B4 / L9-B5 mandatory) and the production leak check (L9-B10, one run under the SA ruling), left to TL with the browser checks
**Input source:** prompt keywords + workplan §7

### Commands and results (real output, worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l9`, uncommitted)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/business-os-llm app/admin/components app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/finance lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **83 suites, 2501 tests, all passed** (92.5 s), the same as Dev's V-1. Audit trail, AI cost & usage, Businesses, Messages, Finance and Activity suites all green. Jest also printed one "a worker process has failed to exit gracefully" message (teardown noise, no failure) |
| 2 | `npm run test:bos-llm` | **23 suites, 625 tests, 23 snapshots passed**, exit 0 |
| 3 | `npm run typecheck:bos-llm` | "499 files in scope, 28 errors, 0 new", **passed**, exit 0 (it again reports the already-fixed baseline entry `app/api/onboarding/build/route.ts` TS18047, unrelated) |
| 4 | `npm run test:bos-entitlements` | **242 suites, 7062 tests passed**, exit 0 |
| 5 | Scoped `tsc -p` (scratch `tsconfig.qa.json`: extends the worktree config, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`) | `--listFilesOnly`: 93 files under `app/admin` plus the canary. Run 1 with `canary.ts`: **exit 2**, exactly one error `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 without it: **exit 0** |
| 6 | `npx eslint` on the 11 touched source and new test files | exit 0, clean |
| 7 | `git diff --stat HEAD -- app/api lib app/admin/finance app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/business-os-llm/components/settings` | Empty. `app/admin/components`: only `layout/useAdminFilters.ts` and its render test |
| 8 | Probe sensitivity check: the stash-append line in `page.tsx` replaced, the QA walk probe run, the file restored | The walk fails in all three harness modes; md5 equal before and after the restore (83435c35…) |

### Edge cases (throwaway probes: 35 tests in two `__tests__/zzqa-*` files, mocked `fetch`; deleted afterwards, `git status --short` the same as before)

| # | Probe | Result |
|---|---|---|
| Q-1 | Full walk: Settings → Costs (7 days + a business through the picker) → Activity (Last week + Outcome failed), then 12 switches covering every ordered pair (S→C, C→A, A→C, C→S, S→A, A→S …). Run in three harnesses: `useSearchParams` follows the URL; lagging with `sync()` after each click; lagging with no sync at all | ✅ Every switch: **exactly one `replaceState`** and **zero reads** of either route. The URL shows only the visible tab (`?tab=settings`; `?tab=costs&range=7d&account=…`; `?tab=activity&range=last_week&outcome=failed`). Each tab's controls are restored: on Costs, 7 days pressed and the chip "Business: Alpha Studio"; on Activity, Last week pressed and Outcome failed. Final settle: no write, no read |
| Q-2 | Deep links `?tab=costs&range=90d` / `range=today` / `range=last_week` (an Activity value) / reversed custom / one-sided custom / `account=not-a-uuid&range=7d` | ✅ One read each; spans of 89 / 0 / 29 / 29 / 29 / 6 days; no `accountId`; URL cleaned to the valid projection; no Activity read |
| Q-3 | `?tab=activity&outcome=failed` | ✅ One list read with `outcome=failed`, no report read. Switch to Costs: one write, `?tab=costs`, Costs reads 30 days |
| Q-4 | `?tab=settings&outcome=failed&range=7d` (lagging) | ✅ Activity opens at defaults with one read and no `outcome`; URL `?tab=activity` (the M-3 deliberate change) |
| Q-5 | `?tab=activity&range=90d` (a Costs-only value) | ✅ Activity ignores it and cleans the URL; Costs' first visit reads 30 days |
| Q-6 | Hash: an Activity URL with `#something`, then Settings | ✅ Hash dropped. A same-tab click on Costs with `#costs-periods`: one tab write, hash and filters kept, no read |
| Q-7 | Back/Forward-like outside change: Activity shown, URL replaced with `?tab=costs&range=7d` | ⚠️ Informational (S-5 / F-118, already recorded, not fixed). Nothing reads. Clicking Costs opens it at **30 days**: the outside `range=7d` is not honoured, because it was stashed as Activity's. Going back to Activity takes **2 writes**: the page appends the stashed `range=7d`, then Activity's activation corrects it. Final URL correct, no read. It corrects itself |
| Q-8 | Success → failure (500 JSON) → Try again → success | ✅ The route's words show inside `role="alert"`; report, sections and strip cleared; Refresh and Try again re-send the identical query; Try again restores sections and strip |
| Q-9 | Network failure (fetch rejects) | ✅ "Could not reach the server. Check your connection and try again." (never "Failed to fetch"); Try again restores |
| Q-10 | Non-JSON 502 / JSON body without a string error / 200 with `success:false` | ✅ Fallback sentence (no parser text) / fallback sentence / the route's `error` |
| Q-11 | 409 `platform_account` | ✅ The `COSTS_PLATFORM_ACCOUNT` sentence in the notice; no Try again, no alert, no strip; the code itself never shown |
| Q-12 | Newest wins: a slow 30-day read released after the 7-day read | ✅ The 7-day window stays; `costs-content` reads `aria-busy="false"` afterwards |
| Q-13 | Custom with From after To → Apply; then To emptied → Apply | ✅ Inline `role="alert"`, no read, no URL write; the one-sided range is refused too |
| Q-14 | 90 days; Custom 2026-01-01 to 2026-06-30 | ✅ 90 days spans 89 days, URL `range=90d`. The over-cap custom range is sent (the cap stays with the route), the route's "at most 92 days" shows, and the URL keeps the custom window |
| Q-15 | Pick a business with no charges | ✅ Empty sentence, chip "Business: Beta Bakery", URL `account=…`, tiles have no target. "Clear filters" → one read without `accountId`, URL `?tab=costs`, chip gone, Clear disabled |
| Q-16 | Chip X; an unknown UUID in a deep link | ✅ X → one read without `accountId`, URL clean. Unknown id → chip "Business: 33333333…" (short id, no lookup) |
| Q-17 | KPI colours: incomplete + 0 mismatches; incomplete + 2 mismatches; complete + 0; incomplete + none checked | ✅ All five `data-status="neutral"`, each with "may be incomplete", no amber class / Periods `red`, the rest neutral, name "Periods not matching, 2, …" / all neutral, no sub-line / "Not checked", neutral |
| Q-18 | Anchors | ✅ Credits, Cost and Periods → `#costs-periods`; Charges → `#costs-breakdowns`; Fallback → `#costs-fallback`. Each id exists once and is a `section` |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| One h1 (Costs alone, and with Costs + Activity both mounted) | ✅ |
| Tablist: 3 tabs, every `aria-controls` resolves, the selected tab has `aria-selected`, one visible tabpanel | ✅ |
| Tiles: links whose accessible name starts with the label | ✅ |
| Labelled controls: combobox "Business" (exactly one visible across both mounted tabs); From (UTC) / To (UTC) under Custom | ✅ |
| Clear disabled at defaults, enabled after 7 days | ✅ |
| Refresh named "Refresh the cost report"; `aria-busy` true while reading; the content wrapper `aria-busy` true with sections kept | ✅ |
| Errors `role="alert"` (route error, Custom inline); loading `role="status"` | ✅ |
| No `region` landmark; one visible `search` landmark; no duplicate `id` with both tabs mounted | ✅ |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. No extra reads on any tab switch, in any order (Q-1).

#### Edge Cases (nice to fix)

1. **Outside navigation into a hidden tab** (Q-7): when an outside URL names a tab other than the visible one, the next switch ignores its filters, and the return switch takes two writes before it corrects itself. File: `app/admin/business-os-llm/page.tsx`. Severity: Low. Already recorded as S-5 / F-118 (read-once tab): not a new finding, no action for L-9a.
2. Jest's "worker process has failed to exit gracefully" message on the 83-suite run: teardown noise, no failing test. Severity: Low, observation only.

### Browser checks for TL (signed-in admin, DevTools Network open, light and dark emulation; read-only)

| # | Check | Required |
|---|---|---|
| L9-B4 | Costs at 7 days + a business → click Activity: address bar `?tab=activity` with no Costs key; one `ai-activity` request (this month, no `accountId`); no `credits/report`. Back to Costs: the Costs keys return, **no request** of either kind | **Mandatory** (real Next sync) |
| L9-B5 | Activity Outcome = Failed → Settings: `?tab=settings` only; back to Activity: `outcome=failed` returns, no request | **Mandatory** |
| L9-B1 | `?tab=costs`: five tiles, then the bar (Today … Custom, 90 days; 30 days pressed), one `credits/report` | Yes |
| L9-B2 | 7 days → `range=7d`; reload reopens 7 days with one request | Yes |
| L9-B3 | Picker: one `llm-usage/businesses` request while open; pick → chip, `account=`, one report request; a business with no charges → empty + "Clear filters" | Yes |
| L9-B6 | Periods not matching red only when a period disagrees; incomplete → every tile "may be incomplete", none amber; a tile click scrolls to its section | Yes |
| L9-B7 | Custom with From after To: inline message, no request | Yes |
| L9-B8 | Offline + Refresh → "Could not reach the server…" + Try again; back online + Try again restores | Yes |
| L9-B11 | Light and dark: tiles, bar, chip, picker list, date inputs | Yes |
| Extra | Deep links `?tab=costs&range=90d` (one request, 90 days pressed) and `?tab=settings&outcome=failed`, then Activity (defaults, `outcome` gone); Back after a tile anchor click (S-5: expect the recorded behaviour) | Recommended |
| L9-B10 | Leak check on production under the SA ruling: pick **one business in the bar first**, From = To (one day), Run **once**; Network shows one `leak-check` request with `accountId`. Never the every-business default, never a repeat. A `bos_credit_leak_found` log is a true finding: record it and tell TL. Otherwise skip | Optional, once |
| L9-B9 | Section styling | L-9b |

### Final Status

**Verdict: PASS WITH NOTES.** No bugs. Every acceptance point that can be probed in jsdom passes, all four required commands are green, and the scoped `tsc` was proven live with the canary, then ran clean. Notes: the two Low observations above (one already recorded as S-5 / F-118). L9-B4 / L9-B5 are mandatory and were not run by QA; TL owes them, because jsdom cannot prove the real Next sync.

- [x] All acceptance criteria testable in jsdom pass — ready for commit (RM); browser checks owed by TL
- [ ] Issues found — Dev must address before commit

## Commit Info

| Item | Value |
|---|---|
| Slice | L-9a |
| Branch | `feature/admin-layout-l9` |
| Commit | 57132b85 `feat(admin): admin layout standard L-9a — Costs filters, KPI strip, tab/URL coexistence` |
| Merge with origin/main | b32f119d (clean; one docs workplan came in, nothing under `app/admin/**`) |
| PR | #321 (base `main`; contains #319 and #320 while they are open) |
| Tests at merge | admin Jest 83 suites / 2501 tests; `test:bos-llm` 23 / 625; `typecheck:bos-llm`, `test:bos-entitlements` (7062), `lint:hooks` green |

## Implementation Notes (L-9b)

**Dev, 2026-10-12. Code complete, nothing committed** (RM commits after SA code review + QA). Branch `feature/admin-layout-l9b`, cut from `feature/admin-layout-l9` at 703f6dcb. UI short path, fast-track.

### What was built

| File | Change |
|---|---|
| `components/costs/CostsSections.tsx` | Local `TH` / `TH_NUM` / `TD` / `TD_NUM` deleted; every table on `ADMIN_TABLE_WRAP` / `ADMIN_TABLE` / `ADMIN_THEAD` / `ADMIN_TH` / `ADMIN_TH_NUM` / `ADMIN_TBODY` / `ADMIN_TD` / `ADMIN_TD_NUM`, `scope="col"` on every header, an `aria-label` on every table ("Per account and billing period", "Breakdown by action type / area / service / trigger", "Fallback-priced charges", "Spread per action type"). Period check and "few examples" on `StatusChip` (Q-5: `ok`, `danger`, `unknown`; `warn`), words and test ids kept. Fallback "When (UTC)" via `formatUtc` (F-74); group id via `formatShortId` on `ADMIN_TD_ID`, full group id and action id in `title` (new test id `fallback-group-id` on that cell). Spread service name slate-400. Codes keep `font-mono`. Header comment. `Chip.tsx` no longer imported here (Settings still uses it) |
| `components/costs/LeakCheckPanel.tsx` | Read: `fetch` in its own try / catch (network → `ADMIN_NETWORK_ERROR`), body through `readJsonBody`, newest-wins check before every `setState` (S-7); not ok → 409 `platform_account` → `COSTS_PLATFORM_ACCOUNT` in an `AdminNotice` (`leak-platform-account`), else the route's `error`, else "Could not run the leak check" in `AdminError` (`leak-error`), neither with "Try again". `STATUS_CLASS` → `STATUS_TONE` + `StatusChip` (`leak` danger, `could_not_check` unknown, `incomplete` warn, `clean` neutral). Account table on the shared classes, `aria-label` "Leak check by business", numbers on `ADMIN_TD_NUM`. Inputs on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` (labels and test ids kept); Run keeps its words and purple, gains the focus ring. Window, read-at and example "first call" through `formatUtc` (the page's `formatInstant` import gone). `leak-scope`, `leak-not-run`, `leak-window`, `LEAK_TWO_NIGHTS` slate-500 → slate-400. Four verdict boxes unchanged (Q-7). Header comment |
| `components/costs/CostsTab.tsx` | The incomplete box on `AdminNotice testId="costs-incomplete"` (E-9), same words and reasons; `AlertTriangle` import removed |
| `components/activity/ActivityTab.tsx` | Header comment only (F-121, SA L-9a Low note 1): a tab switch starts no read because the page passes `active` |
| `__tests__/costsTab.render.test.tsx` | E-9 (one line) |
| `__tests__/leakPanel.render.test.tsx` | New `describe` L-1 to L-4; two imports added; the 13 existing cases unedited |
| `__tests__/costsLayout.render.test.tsx` | New `describe` C-9, C-10, C-11; header comment |
| `__tests__/source.guard.test.ts` | G-5: `JSON_UNTIL_L9B` removed, so no file in the costs folder is exempt from "no `.json(`" (SA L-9a "For L-9b"); new `describe` G-6 (planted-string self-test, folder walk, per-file rule: no `text-slate-500`, no local `TH` / `TD` / `TH_NUM` / `TD_NUM` constant, no class string both monospace and right-aligned or tabular, no `STATUS_CLASS`) |

No shared-folder file changed; no route, payload, request parameter, data or money change; no AI call. The registry stays deferred to L-10 (Settings' `page.tsx` and `LedgerCheckPanel.tsx` still read with `.json(`).

### Verification (real output)

| # | Result |
|---|---|
| V-1 | `npx jest app/admin/business-os-llm app/admin/components lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **40 suites, 1472 tests, all passed**. `app/admin/business-os-llm` alone: 16 suites, 730 tests |
| V-2 | `npm run test:bos-llm`: 23 suites, 625 tests, 23 snapshots passed, exit 0. `npm run typecheck:bos-llm`: "499 files in scope, 28 errors, 0 new", passed, exit 0 (the same already-fixed baseline entry `app/api/onboarding/build/route.ts` TS18047 as L-9a, unrelated) |
| V-3 | `npm run test:bos-entitlements`: 242 suites, 7062 tests passed, exit 0 |
| V-4 | Scratch `tsconfig.l9b.json` in the session scratchpad (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`, plus the canary). `--listFilesOnly`: 93 files under `app/admin` and the scratch `canary.ts`. Run 1 with `canary.ts` (`const canary: number = 'x';`): exit 2, exactly one error, `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 with the canary deleted and removed from the include: exit 0 |
| V-5 | `npm run lint:hooks`: exit 0. `npx eslint` on the 8 touched files: exit 0, clean |
| V-6 | (m) a local `TD_NUM = '… text-right font-mono …'` used for the first period figure → G-6 (`CostsSections.tsx`) and C-9 fail; (n) `STATUS_CLASS` pills back in place of `StatusChip` → G-6 (`LeakCheckPanel.tsx`) and L-4 fail. Each applied by exact replacement in the scratchpad script, run, restored from the saved bytes, md5 equal before and after (`CostsSections.tsx` 2c2ad272…, `LeakCheckPanel.tsx` 16feb950…). Extra: the three components swapped for their L-9a (HEAD) versions → G-5 (`LeakCheckPanel.tsx` `.json(`), G-6 (both files), L-1, L-2, L-3, L-4, C-9, C-10 fail (9 cases); E-9 and C-11 pass there by design (E-9 is a selector change; C-11 pins S-6 behaviour that already held); all three files restored, md5 equal (`CostsTab.tsx` 212a50b3…) |
| V-7 | `git diff --stat HEAD -- app/api lib app/admin/finance app/admin/audit-trail app/admin/analytics app/admin/users app/admin/messages app/admin/components app/admin/business-os-llm/components/settings app/admin/business-os-llm/components/AreaCard.tsx app/admin/business-os-llm/components/LedgerCheckPanel.tsx app/admin/business-os-llm/page.tsx`: empty. `components/activity`: `ActivityTab.tsx` only, the header comment (3 lines for 1) |
| V-8 | No `console.` and no `as any` in code in the page folder; `.json(` only in `page.tsx` (Settings) and `LedgerCheckPanel.tsx` (both L-10); no `text-slate-500` under `components/costs/`; `@/lib/` only `ledgerCheckCopy` in `LedgerCheckPanel.tsx` |
| V-9 | `git status --short`: 8 modified, no new file, nothing deleted. `git diff --stat`: 583 insertions, 203 deletions; no file emptied, no deletion-only file. Line endings preserved: the CRLF files (`CostsSections.tsx`, `LeakCheckPanel.tsx`, `CostsTab.tsx`, `ActivityTab.tsx`, `costsTab.render`, `leakPanel.render`, `source.guard`) are all-CRLF, `costsLayout.render` all-LF as at HEAD |

### Deviations

1. **Platform-account slot in the leak panel:** an `AdminNotice` with its own test id `leak-platform-account` (as the tab's `costs-platform-account`), not inside `AdminError`. §2.8 says "its error / notice slot without Try again"; the notice matches the tab's own treatment of the same sentence.
2. **Example "first call" times** in the leak panel also go through `formatUtc` (§2.8 named the window and read-at). Same text as `formatInstant`; with it the panel no longer imports `../../format`.
3. **Run button** text `text-xs` → `text-sm`, to sit with the `text-sm` bar-class inputs beside it. Words, purple and test id kept.
4. **New test id `fallback-group-id`** on the fallback group-id cell (for C-9); no existing test id changed or removed.
5. **G-5 edited, not only extended:** the `JSON_UNTIL_L9B` list and its use were removed (planned in L-9a deviation 1 and SA "For L-9b"); the case now asserts `json: false` for every costs file.

### User-visible changes (L-9b, on `/admin/business-os-llm?tab=costs`)

1. The section tables share one look and density with the rest of the admin: a framed table with a tinted header row, numbers right-aligned in tabular figures (no longer monospace).
2. Period check chips with icons: "matches its rows" is now green (was blue), "mismatch" red, "not checked" dashed grey; "few examples" amber with an icon.
3. Fallback-priced times end in "UTC" and are converted through the clock (an offset timestamp shows its UTC time); group ids are shortened, with the full group id and action id on hover.
4. The "may be incomplete" box is the shared amber notice (same words).
5. Leak check: date inputs and Run look like the filter bar's; statuses are chips with icons (a leak red, "could not check" dashed grey instead of amber, partly read amber, clean grey); the table matches the sections; a network failure says "Could not reach the server…"; a platform account gets the tab's sentence instead of `platform_account`; an unreadable answer says "Could not run the leak check" instead of a parser message; grey information lines are a step lighter (slate-400).

### Tests edited, with reasons

- `costsTab.render.test.tsx` "an amber incomplete banner…" (E-9): `banner.className` → `banner.closest('div')?.className`, still `/amber/`; the test id now sits on the `AdminNotice` text element (RC-3).
- `source.guard.test.ts` G-5 per-file case: expects `json: false` for every file (the one-slice exception removed, deviation 5).
- No other existing case edited; `leakPanel.render` (13), `costsLayout.render` (C-1 to C-8, C-12) and every other suite green unedited.

### Out of scope, recorded (not fixed)

- F-120 (Costs "unreadable amounts" / "names failed" amber lines → `AdminNotice`): **not in the L-9b plan** (§2.6 keeps them; §11 records them open), so left as is. A one-line change each if TL wants it in this PR.
- The `typecheck:bos-llm` baseline entry already fixed (`app/api/onboarding/build/route.ts`), unrelated, as in L-9a.
- `page.tsx` (Settings) keeps two `text-slate-500` lines (`:267`, `:337`) and `AdminBusinessPicker.tsx:347` one (an option's id); outside the costs folder and this slice (L-10 / shared).

## SA Code Review (L-9b) — 2026-10-12

**Code Review by SA — 2026-10-12**
**Status:** ✅ Code Approved. No must-fix. Fast-track: proceed to QA, then RM.

### What SA checked

| Area | Result |
|---|---|
| Diff shape | `git status --short` + `git diff --stat`: 10 modified (8 code / test, 2 docs), 659 insertions, 214 deletions; no new, deleted, emptied or deletion-only file. Nothing under `app/api`, `lib` or `app/admin/components` changed. No data, API, request, money or LLM change |
| `CostsSections.tsx` | Local `TH` / `TH_NUM` / `TD` / `TD_NUM` gone; all seven tables on `ADMIN_TABLE_WRAP` / `ADMIN_TABLE` / `ADMIN_THEAD` / `ADMIN_TH(_NUM)` / `ADMIN_TBODY` / `ADMIN_TD(_NUM)`, `scope="col"` on every header (the empty spread header included), a unique `aria-label` on every table. Every number cell on `ADMIN_TD_NUM` (right, `tabular-nums`, no `font-mono`); codes keep `font-mono` on plain `ADMIN_TD`. Check chips per Q-5 (`ok` / `danger` / `unknown`), words and test ids kept. Fallback "When (UTC)" via `formatUtc` (`:308`); group id via `formatShortId` on `ADMIN_TD_ID`, `title` = full group id plus action id, undefined when both are null (`:269`, `:316`). Section `id`s already in place from L-9a |
| "few examples" `warn` (`:380`) | **Acceptable.** It is a caveat on how far the percentiles can be trusted (partial confidence, §5.9 warn), not a failure and not "could not check"; amber is what the row showed before, so the meaning does not move |
| `LeakCheckPanel.tsx` read (`:353-384`) | Same request: `GET`, same URL, same `from` / `to` / optional `accountId`, same abort signal. `fetch` in its own try / catch: a superseded or aborted run returns silently; a network failure says `ADMIN_NETWORK_ERROR` and clears the result. Body through `readJsonBody` (never throws, so the dropped outer `catch` loses nothing, and `finally` still clears `running` on every path, early returns included). `isCurrent()` ahead of every `setState` (S-7). Not ok / null body / `success !== true`: 409 `platform_account` (the route's code, `leak-check/route.ts:130`) → `COSTS_PLATFORM_ACCOUNT` in `AdminNotice` (no role, no Try again); else the route's own string (its other answers are human sentences: `:111`, the Zod issue at `:120`, `:181`); else the kept "Could not run the leak check" in `AdminError` (`role="alert"`, no `onRetry`). Never on mount, unchanged |
| Leak panel UI | Own form kept, on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` (wrapping `label`s, so each input keeps its accessible name); Run keeps words, purple and test id, gains the focus ring. `STATUS_CLASS` → `STATUS_TONE` + `StatusChip` per Q-5. Account table on the shared classes, "Leak check by business"; the examples row's `colSpan={9}` matches nine headers. Four verdict boxes untouched (Q-7); their icons keep every lucide import in use. Window, read-at and "first call" via `formatUtc` |
| `CostsTab.tsx` (E-9) | Incomplete box on `AdminNotice testId="costs-incomplete"`, same words and reasons; `AlertTriangle` import removed (no other use). The E-9 test edit (`closest('div')`) is the RC-3 consequence: justified |
| Guards | G-5: `JSON_UNTIL_L9B` removed; every costs file asserts `json: false` (deviation 5, as SA asked for L-9b). G-6: the planted-string self-test proves each regex rejects and accepts the right strings, the walk proves both files are in scope, the per-file case checks all four rules. Dev's mutation runs (m), (n) and the HEAD swap show G-6, C-9, C-10 and L-1 to L-4 bite |
| `ActivityTab.tsx` | Header comment only (F-121), accurate to the L-9a design |
| Deviations 1 to 5 | All accepted. 1: the notice matches the tab's own treatment of the same sentence, and it is not an error. 2: same text, one formatter. 3: `text-sm` sits with the `text-sm` inputs. 4: additive test id. 5: the planned removal |
| Standards | No `console.*`; no new `any` (the `(global as any).fetch` at `leakPanel.render.test.tsx:129` is pre-existing); `@/lib/` only in comments in the costs folder; no backslash in either MD. Line endings: index `i/lf` for all; the CRLF files fully CRLF, `costsLayout.render` and both MDs LF as at HEAD |
| Requirement edits | §1 row 15b, §7.12 as built, F-67 / F-71 / F-72 / F-74 / F-121 done, F-120 open: accurate against the diff |
| Tests run by SA | `npx jest app/admin/business-os-llm --ci`: **16 suites, 730 tests passed**. `npm run test:bos-llm`: **23 suites, 625 tests, 23 snapshots passed** |

### Code Review Comments

1. `app/admin/business-os-llm/__tests__/source.guard.test.ts` G-6 `MONO_NUMBER` — the regex matches class words inside one string literal, so `${ADMIN_TD_NUM} font-mono` (a constant name, not the word `text-right`) would pass G-6. C-9 and L-4 check the rendered cells and would catch it, so the rule is covered — Priority: Low (note only)
2. `app/admin/business-os-llm/components/costs/CostsSections.tsx:168` and `FiguresCells` — the Total label keeps `text-slate-200` explicitly while the figure cells now inherit `ADMIN_TABLE`'s `text-slate-300` (was `text-slate-200` via the old `TD_NUM`). One step lighter, the same as every other admin table — Priority: Low (note only)
3. `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx:353-384` — the outer `try` now has only `finally`. Correct today because nothing after `fetch` can throw; if a later edit adds a throwing step there, it becomes an unhandled rejection from `void run()` — Priority: Low (note for the next editor)

### F-120 ruling

**Leave open; do not fold into L-9b.** It is outside the approved L-9b plan (§2.6 deliberately kept those lines), it is a visible change with no test planned for it, and moving both lines onto `AdminNotice` can stack up to three amber notices under the strip (incomplete, unreadable, names failed), which is a layout decision (one merged notice or three), not a one-liner. Take it with L-10 or the next Costs touch, with its own render case.

### Optimisation Suggestions

- If G-6 is touched again, also reject `ADMIN_TD_NUM` composed with `font-mono` in a template literal (comment 1).

### Code Approved for QA: Yes

QA keeps to the production leak-check ruling (one run, one business, one day); the 409, network and non-JSON cases stay in jsdom (L-1 to L-3).

## QA Report (L-9b) — 2026-10-12

**QA — 2026-10-12**
**Test mode:** full (UI short path, fast-track)
**Strategy used:** A (Jest, jsdom, mocked `fetch` only) + scoped `tsc`; D (browser) handed to TL as a checklist, since QA has no browser
**Focus:** ui, api (the leak read's request and states), accessibility
**Skipped:** the production leak-check run (L9-B10): QA has no signed-in browser; it stays with TL under the SA ruling (one run, one business picked first, From = To). No other skip
**Input source:** prompt keywords (TL trigger) + workplan §7.1

### Commands and results (real output, worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l9b`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/business-os-llm app/admin/components lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **40 suites, 1472 tests passed**, 45.9 s |
| Q-2 | `npm run test:bos-llm` | **23 suites, 625 tests, 23 snapshots passed**, exit 0 |
| Q-3 | `npm run typecheck:bos-llm` | "499 files in scope, 28 errors, 0 new", passed, exit 0 (the same already-fixed baseline entry `app/api/onboarding/build/route.ts` TS18047 as L-9a, unrelated) |
| Q-4 | Scoped `tsc -p` on a scratch `tsconfig.json` in the session scratchpad `qa-l9b/` (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`) | `--listFilesOnly`: 93 files under `app/admin` plus the scratch `canary.ts`. Run 1 with the canary: exit 2, exactly `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2, canary deleted and dropped from `include`: **exit 0** |
| Q-5 | Throwaway probes: `__tests__/zzqa-l9b-leak.render.test.tsx` (22 cases) and `__tests__/zzqa-l9b-sections.render.test.tsx` (8 cases), mocked `fetch`, `console.error` / `console.warn` spied in every case | **30 / 30 passed** (one first-run failure was a probe bug: `getAllByTestId` on zero rows; fixed to `queryAllByTestId`). Both files deleted; `git status --short` identical to before (the same 10 modified files, no new file); source diff stat unchanged |

### Edge cases probed

| Area | Case | Result |
|---|---|---|
| Leak states | Network rejection (`TypeError: Failed to fetch`) | `ADMIN_NETWORK_ERROR`, never the browser text; result cleared; inside `role="alert"`; no "Try again"; Run enabled again. The next successful run clears the error and leaves no alert |
| | 409 `platform_account` | `COSTS_PLATFORM_ACCOUNT` in `leak-platform-account`, no `role="alert"`, no "Try again", `leak-not-run` hidden; the next good run removes it. A 400 carrying `platform_account` gets the same notice (keyed on the code, not the status) |
| | 400 / 500 / 403 with a route `error` string | That string, in `role="alert"` |
| | 500 with no `error`, `error` an object, 200 without `success`, `success: 'true'` (string), body an array, body `null`, non-JSON with `ok: false` and with `ok: true` | "Could not run the leak check"; no parser text |
| | 200 `success: false` with `error` | The route's string |
| | While running | Previous error cleared at once; Run disabled and reads "Checking…" |
| Newest wins | Overlapping runs from the UI | Not reachable: Run is disabled while a run is in flight (existing test). Reachable paths probed: unmount during a pending `fetch` then an `AbortError` rejection, and unmount while the body is still being read: nothing set, no React warning, no console error; the signal is aborted |
| Request | Same GET as HEAD (the request-building lines are unchanged in the diff) | URLs exactly `…/leak-check?from=2026-10-01&to=2026-10-01`, then `…&accountId={A}`, then back without `accountId`; `init` has only `signal` (no method, no body) |
| C-11 | Scope follows the picked business, returns to every business when cleared | Dev's C-11 (through the real page and picker) green; QA's rerender probe: scope line "Checking one business: Alpha Studio" → "Checking every Business OS business", request drops `accountId` |
| Verdicts | found / clean / partial / empty window (`end <= start`, 0 businesses) | Each its own box; no account table when `accounts` is empty; "0 businesses checked" |
| Times | Offsets → UTC | Window `+02:00` / `-05:00` → "2026-09-28 00:00 UTC to 2026-09-29 00:00 UTC"; example first call `+05:30` → "07:00 UTC"; fallback `-03:00` → next-day "02:30 UTC"; `-00:30` crossing the year → "2027-01-01 00:29 UTC"; period start `+02:00` → the previous UTC day |
| | Unreadable instant | Em dash ("read at —", fallback "When"), never the raw string |
| Numbers | Huge | 9e15 → "9,000,000,000,000,000", 1e21 full digits, $987,654,321.12, no exponent; NaN / Infinity → em dash |
| Sections | Zero rows everywhere | Renders; period table header + Total row only (as at HEAD); no fallback / spread table; five tables named |
| | Missing data | Null group and action id → "—" with no `title`; only one id → `title` names only that one; an id of 8 chars or fewer shown whole; null company → short account id; null spread figures → "—" (no "null" / "NaN") |
| | Failed sections | `costs-breakdowns-failed`, `costs-fallback-failed`, `costs-spread-failed` render |
| | Group id | `bbbbbbbb…` shown, `title` "Group {full id} · Action {id}" (C-9 and probe) |
| Chips | Period check | `ok` emerald, `danger` red with the "rows:" line, `unknown` dashed; each with an `aria-hidden` icon and its words; "few examples" `warn` |
| | Leak statuses | `danger` / `unknown` / `warn` / `neutral` (L-4), icon on all but neutral |
| Incomplete box | Through the page | `AdminNotice` `<p data-testid="costs-incomplete">`, amber wrapper, no `alert`; words plus reasons, an unknown reason shown as its code |
| Focus | Run focused, then clicked | jsdom: focus stays on the button while it is disabled and after the error appears (the code moves no focus; the error is announced through `role="alert"`). jsdom does not apply the browser's focus fix-up for a disabled element, so the real behaviour is browser check QB-6 |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| Tables named + `scope="col"` | All seven section tables and "Leak check by business" named; every `th` has `scope="col"` (47 headers in the full probe) |
| Chips | Text always present; meaning tones carry an `aria-hidden` icon |
| Leak form | `getByLabelText('Check from (UTC)')` / `('Check to (UTC)')` find the date inputs (wrapping labels) |
| Run | `getByRole('button', { name: 'Run leak check' })`; `focus-visible:ring-2` present |
| Errors | `leak-error` inside `role="alert"` (an improvement: at HEAD the leak error had no role) |
| Landmarks | `queryAllByRole('region')` = 0 in the panel and in the four sections (no named `section`) |
| T-5 | No `text-slate-500` in the panel or sections |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. No request added; the leak check still runs only on Run.

#### Edge Cases (nice to fix, none a regression)

1. **The platform-account notice in the leak panel is silent to a screen reader** — `LeakCheckPanel.tsx` — Low. It appears as the answer to Run, but `AdminNotice` has no live role (by design, for standing caveats), so nothing is announced; a sighted user sees it. At HEAD the same case showed the raw code with no role either, so not a regression. If fixed later: wrap that slot in `role="status"`, not `alert`.
2. **Empty spread header** — `CostsSections.tsx` spread table, last `<th scope="col" />` — Low, pre-existing at HEAD. A column header with no name (the "few examples" / "fallback left out" column). A visually hidden word would give it one.
3. **A success body whose `data` is not a payload** (`{ success: true, data: {} }`) would throw in `Result` on `result.window.start`; `{ success: true }` with no `data` shows the "not run" line silently — `LeakCheckPanel.tsx` — Low, pre-existing (HEAD casts the same way); the route never answers that.
4. SA comments 1 to 3 stand as SA noted them; QA found nothing further there.

### Browser checks for TL (signed-in admin, DevTools Network + Console open; light and dark emulation; read-only)

| # | Check |
|---|---|
| QB-1 (L9-B9) | `/admin/business-os-llm?tab=costs`: section tables framed with a tinted header, one density; numbers right-aligned in tabular figures (not monospace); action types / keys / period starts still monospace |
| QB-2 | Period check chips: "matches its rows" green with a tick, "mismatch" red with its "rows:" line, "not checked" dashed grey; "few examples" amber with an icon |
| QB-3 | Fallback-priced list: "When (UTC)" values end in "UTC"; group ids short ("xxxxxxxx…"), hover shows "Group … · Action …" |
| QB-4 | An incomplete report (only if one shows naturally; else skip): the amber notice reads the same words and reasons |
| QB-5 | Leak panel before any run: "Check from (UTC)" / "Check to (UTC)" look like the filter bar's date fields, Run purple, scope line readable (slate-400), **no** `leak-check` request on load |
| QB-6 | Focus, observed on the one allowed run (QB-7): Tab to Run and press Enter; note where focus lands while the button is disabled and after it re-enables. Record it; not a blocker |
| QB-7 (L9-B10, SA ruling) | **Once only.** Pick one business in the bar first; set From = To = one day; press Run once. Network: exactly one `GET …/leak-check?from=D&to=D&accountId=<that id>`. Result: status chips with icons, the table matching the sections' density, window and read-at ending in "UTC". If it reports a leak, that is a true finding: record it and tell TL. Never run with the picker empty, never repeat |
| QB-8 | Clear the business: the scope line returns to "Checking every Business OS business" — **do not press Run** |
| QB-9 (L9-B11) | Light and dark emulation: chips, tables, notice, date inputs (native picker) and Run look right in both |
| QB-10 | Console: no errors or React warnings through all of the above |

Still owed from L-9a (not L-9b): L9-B4 and L9-B5 (the real Next tab sync).

### Final Status

**Verdict: PASS WITH NOTES.**

- [x] All L-9b acceptance criteria pass in jsdom; 40 / 1472, `test:bos-llm` 23 / 625, `typecheck:bos-llm` 0 new, scoped `tsc` clean after the canary
- [x] No bugs; three Low edge cases (none a regression) recorded for a later slice
- [ ] Browser checks QB-1 to QB-10 owed by TL (QA has no browser)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Workplan written | Dev: L-9 analysis, coexistence design (F-113), Costs migration plan, tests, verification, split L-9a / L-9b, Q-1 to Q-10 |
| 2026-10-12 | SA workplan review | SA: APPROVED WITH CONDITIONS. Q-1 to Q-9 approved (Q-4 wording corrected); Q-10 partly (no amber tile under `incomplete`, sub-line only). M-1 KPI colours, M-2 platform-account sentence, M-3 coexistence tests X-10 to X-12 and the X-5 Settings variant. S-1 to S-7, N-1 to N-4. Leak check on production: once, one business, one day |
| 2026-10-12 | M-1 to M-3 applied; L-9a implemented | Dev: M-1 (§2.5, §2.10, C-12, L9-B6, V-6 (o)), M-2 (§2.6, §2.8, Q-4, C-7, L-3), M-3 (X-5 extension, X-10 to X-12, §2.10 item 8) written in; S-3, S-5, S-6 too. L-9a code complete, uncommitted; Implementation Notes (L-9a) added |
| 2026-10-12 | SA code review (L-9a) | SA: Code Approved, no must-fix. Shared hook default path verified identical; page coordination, the `CostsTab.tsx` rewrite (checked line by line against HEAD), M-1 to M-3 and deviations 1 to 7 accepted. 78 admin suites / 2310 tests and `test:bos-llm` 23 / 625 green. Two Low notes (F-121, `picked` not reset); line endings confirmed |
| 2026-10-12 | QA report (L-9a) | QA: PASS WITH NOTES. 83 suites / 2501 tests, `test:bos-llm` 23 / 625, `typecheck:bos-llm` 0 new, `test:bos-entitlements` 242 / 7062, scoped `tsc` canary proven then clean. 35 throwaway probes (tab walk in three harnesses, deep links, states, KPI rules, anchors, a11y) all green, then deleted. No bugs. QA had no browser, so L9-B4 / L9-B5 were not run and are owed by TL |
| 2026-10-12 | L-9a committed, PR opened | RM: commit 57132b85, merged origin/main (b32f119d, clean), PR #321 open (fast-track); awaiting checks + user merge |
| 2026-10-12 | L-9b implemented | Dev: tasks 8 to 10. Sections and leak panel on the shared table classes and `StatusChip` (Q-5), fallback and leak times via `formatUtc`, leak read on `readJsonBody` with the shared network sentence and `COSTS_PLATFORM_ACCOUNT`, incomplete box on `AdminNotice` (E-9), G-5 exception removed, G-6 added, F-121 comment fixed. C-9 to C-11, L-1 to L-4, E-9; mutations (m), (n). Uncommitted; Implementation Notes (L-9b) added |
| 2026-10-12 | SA code review (L-9b) | SA: Code Approved, no must-fix. Deviations 1 to 5 accepted; "few examples" `warn` acceptable; leak read verified as the same request, newest-wins kept. F-120 ruled: stays open (not folded). Three Low notes. `app/admin/business-os-llm` 16 / 730 and `test:bos-llm` 23 / 625 green |
| 2026-10-12 | QA report (L-9b) | QA: PASS WITH NOTES. 40 suites / 1472 tests, `test:bos-llm` 23 / 625, `typecheck:bos-llm` 0 new, scoped `tsc` canary proven then clean. 30 throwaway probes (leak states, request parity, scope follow / clear, verdicts, UTC offsets, huge and missing data, chips, a11y, focus) all green, then deleted. No bugs; three Low edge cases (platform notice silent to screen readers, empty spread header, malformed success data), none a regression. Browser checks QB-1 to QB-10 owed by TL |
| 2026-10-12 | L-9b committed (RM) | Commit fa599c13 on `feature/admin-layout-l9b`; origin/main already contained, no merge commit. Tests: 40 suites / 1472, `test:bos-llm` 23 / 625, `typecheck:bos-llm` passed, `test:bos-entitlements` 242 / 7062, `lint:hooks` clean. PR #322 open (contains #319, #320, #321); awaiting checks + user merge |
