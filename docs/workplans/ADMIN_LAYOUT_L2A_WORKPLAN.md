# Workplan: Admin Layout Standard — Slice L-2a (AI cost & usage, part 1: header, KPI strip, filter bar, states, URL)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 6), §4.3, §5.1 to §5.12, §6.1 (S-1 to S-10), §6.2 C-6, C-7, C-8, C-11, C-14, §7.5 (L-2a), §9 F-43, F-44, F-48, F-54, F-55, F-94, §10 D-2 (b), D-3 (a), D-4 (a), D-6 (a), D-9 (a), D-10 (a), D-15, §12.3; SA rulings Q-13, Q-14, SA-R-4 (K-5), SA-R-11, SA-R-14; SA re-check R-7, R-13, R-17, RC-1, RC-6; L-1c / L-1d / L-1e workplans and their SA reviews ([L-1c](/docs/workplans/ADMIN_LAYOUT_L1C_WORKPLAN.md), [L-1d](/docs/workplans/ADMIN_LAYOUT_L1D_WORKPLAN.md), [L-1e](/docs/workplans/ADMIN_LAYOUT_L1E_WORKPLAN.md))
**Branch:** `feature/admin-layout-l2a`, at `origin/main` `39680689` (L-1d PR #292 and L-1e PR #293 merged, so the PR carries only L-2a; SA M-4). Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Code complete — SA approved, QA B-1 fixed — awaiting QA re-check (2026-10-11, uncommitted)
**Path:** **full cycle** (SA re-check R-7: L-2a builds the same-page filter mode of `KpiTile`, a shared export no pilot needed). After SA code review + QA, RM commits and opens the PR (user fast-track for these UI slices)

## Overview

L-2a moves the top half of `/admin/analytics` onto the standard: the shared page header ("AI cost & usage", D-3 (a)), the KPI strip (§7.5, R-13), the filter bar with every filter in the URL (§5.5, §5.6), the shared business picker (C-6), and the shared states (§5.10). It builds three small shared additions that no pilot needed: the **same-page filter mode** of `KpiTile` (Q-14, R-7) with the hook helper it needs, the bar's **window extras** `24 hours` / `90 days` (D-2 (b), deferred from L-1c), and the K-4 **amber** tile status (deferred from L-1b). The table, status glyphs, Trend column, call-detail modal and agent-detail expand are untouched; they are L-2b. The route is unchanged. Request shapes are unchanged except the forced changes named in §3.10.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-3fa57ff5)
- [2. Scope and decisions](#2-scope-and-decisions)
- [3. Implementation Approach and APIs](#3-implementation-approach-and-apis)
- [4. The URL contract on AI cost & usage](#4-the-url-contract-on-ai-cost--usage)
- [5. Guard and registry changes](#5-guard-and-registry-changes)
- [6. Tests](#6-tests)
- [7. Verification](#7-verification)
- [8. Task List](#8-task-list)
- [9. Sizing and the split decision](#9-sizing-and-the-split-decision)
- [10. Risks](#10-risks)
- [11. Out of scope](#11-out-of-scope)
- [12. Questions for SA](#12-questions-for-sa)

---

## 1. Analysis Summary (code verified at `3fa57ff5`)

### 1.1 The page today (`app/admin/analytics/page.tsx`, 1,690 lines, one client file)

| Lines | What | L-2a? |
|---|---|---|
| `:1-29` | Imports; `linkedWindow.ts` helpers (`:29`) | yes |
| `:31-140` | Types (`DrillDownItem`, `Filters`, `FilterLabels`, `DrillDownResponse`, …) | moved verbatim |
| `:143-193` | `Scope`, `UNPAGED_ROW_CAP`, `PERIOD_OPTIONS` (`24h 7d 30d 90d Custom`, `:150-156`), `BREAKDOWN_OPTIONS` (with icons, `:158-169`), `BOS_HIDDEN_DIMENSIONS`, `BOS_DRILL_ORDER`, `breakdownOptionsFor`, `bosDrillTarget` | moved; `PERIOD_OPTIONS` removed; icons dropped from `BREAKDOWN_OPTIONS` |
| `:198-229` | `ContextChips` (table cell) | no (L-2b) |
| `:232-238` | `export default function AdminCostAnalytics` in `<Suspense>` (pinned by `ownerText.guard`) | kept |
| `:240-290` | State: read-once `scope` (`:245`), `linkedWindow` (`:250`), `clearLinkedWindow` with its own `replaceState(window.history.state, …)` (`:256-262`), `breakdownBy` (`:264`), read-once `?user=` into `filters` / `filterLabels` (`:265-272`), `period` (`:280`), custom-range state (`:281-284`) | replaced by the hook |
| `:291-379` | `fetchData`: `URLSearchParams({ breakdownBy, scope })`, then provider … execution, category (`:296-308`); linked window verbatim, custom range **mixed UTC/local** (`:315-316`, F-54), else `period=N` (`:317-319`); the one `fetch(` (`:321`); `!response.ok` → 400 sentence or "Failed to fetch data" (`:325-333`); **`response.json()`** (`:335`, F-43); error clears items and totals (`:360-363`); effect (`:369-379`) | rewired |
| `:381-452` | `handleRowClick` (drill + BOS redirect) | setter calls only |
| `:459-476` | `handleScopeToggle` (C3-4 cleanup in one event) | setter calls only |
| `:478-491` | `removeFilter`, `clearAllFilters` | replaced |
| `:493-506` | `formatCost` (2 to 4 decimals), `formatNumber` (compact) | moved to `analyticsFormat` in the types file |
| `:508-539` | `handlePeriodSelect` (Custom **auto-applies** today minus 30 days, local `setDate`), `handleApplyDateRange` (From after To → `date-range-error`) | replaced by `DatePresets` |
| `:558-585` | **Early-return** full-page spinner and error box (F-55) | replaced |
| `:590-644` | Header: h1 "Token Usage Analytics" + "BI System" pill; `role="switch"` scope button (`data-testid="scope-toggle"`, **emerald** when on, `:598-611`); period buttons, active `bg-purple-500` (`:613-634`); icon-only Refresh, no name (`:636-642`, F-48) | replaced |
| `:646-660` | "Linked window" chip, X "Clear the linked window" | replaced by the bar's chip |
| `:663-679` | `scope-notes` (emerald "Business OS only" pill `:666`; 1,000-call note); `incomplete-banner` (`:673-678`, amber text) | restyled, moved into content |
| `:682-710` | Custom row (two date inputs, Apply, `date-range-error`) | replaced by `DatePresets` |
| `:713-860` | `grid grid-cols-5` (F-44): Total Spend card (not a link; ±% red up / green down, `:724-731`); in All scope 4 category `<button>`s with a purple/emerald/blue/orange palette (`:740-857`) | replaced by `KpiStrip` |
| `:863-1030` | `grid grid-cols-12` (F-44): aside with Active Filters card + "Clear all" (`:869-948`; X buttons unnamed, F-48), Group By list of 10 buttons with `data-testid="group-by-*"` (`:951-977`), Quick Stats (`:980-1004`), Top Token Consumers (`:1007-1029`) | Active Filters and Group By leave the aside; Quick Stats and Top consumers stay |
| `:1033-1173` | Breadcrumbs (`setFilters` / `setFilterLabels` calls) | setter calls only |
| `:1176-1690` | Table (Trend, glyphs, colSpan 6 / 9), agent-detail expand, call-detail modal | **no** (L-2b) |

`app/admin/analytics/linkedWindow.ts` (54 lines): `parseLinkedWindow` (both bounds, ISO **with an offset**, ordered, else ignored), `urlWithoutLinkedWindow`, `formatLinkedBound`. Imported only by the page and `linkedWindow.render.test.tsx`.

No `console.*` in the page (checked). No logger today.

### 1.2 The route (`app/api/admin/token-usage/drill-down/route.ts`, unchanged)

| Fact | Lines |
|---|---|
| `breakdownBy` enum, default provider | `:50-52` |
| Dimensions: 1 to 200 chars, no control characters | `:41-43`, `:53-59` |
| `user`: UUID or `system`; `agent`: UUID or `no-agent`; `execution`: UUID or `single-` + UUID | `:60-66` |
| `category` enum; `period` 1 to 365; `dateFrom` / `dateTo` = `z.string().datetime({ offset: true })` | `:67-70` |
| `scope` bos / all; BOS refuses agent, execution, non-all category, agent/execution breakdown (400) | `:73`, `:79-90` |
| 400 body `{ success: false, error: 'Invalid query parameters' }`; 500 `'Internal server error'` / `'Failed to fetch data'` | `:224-231`, `:284`, `:967`, `:1035` |
| `dateFrom` absent → now minus `period` (default 30) days; `dateTo` absent → now | `:241-249` |
| 200 body is top-level (`items`, `totals`, `categoryTotals`, `comparison`, `possiblyIncomplete`, …), not under `data` | `:127-140` of the page's type |

Checked with the installed zod 3.25.76: `datetime({ offset: true })` **accepts** `2026-10-11T23:59:59.999999Z` and **rejects** the minute form `2026-09-29T16:51`. So a minute-form bound (U-7) cannot be forwarded to this route; §3.5 keeps today's refusal.

### 1.3 Inbound link builders (must keep opening the same view)

| Source | Builder (exact) | Emits | Pinned by |
|---|---|---|---|
| Health spend tile | `lib/admin/health/evaluateHealth.ts:409-412` `analyticsLink(start, end)` | `/admin/analytics?scope=bos&dateFrom=<ISO Z>&dateTo=<ISO Z>` | `lib/admin/health/__tests__/evaluateHealth.test.ts:570-577` |
| Businesses panel | `app/admin/users/components/BusinessOsPanel.tsx:273-274` (`<Link>`) | `/admin/analytics?scope=bos&user=<id>` | (no test pins the href) |
| Activity cutover notice | `app/admin/business-os-llm/components/activity/CutoverNotice.tsx:22-30` `cutoverLinks(accountId)` | `/admin/analytics?scope=bos` or `…&user=<id>` | `activityTab.render.test.tsx:439`, `:456` |
| Sidebar, finance, platform dashboard | `AdminSidebar.tsx:104`; `finance/financeCopy.ts:105` `AI_LINK_HREF`; `platform-dashboard/page.tsx:275`, `:532` | `/admin/analytics` | sidebar nav test |

None of these builders is edited (§5.6: emitters move to canonical names only in their own slice). The requirement's §5.6 citation for the Businesses panel (`:74-78`, `:247-252`) is stale; the link is at `:273-274` today (Dev corrects it in §5.6 at T-10).

### 1.4 Shared folder facts this plan depends on

| Fact | Where |
|---|---|
| `useAdminFilters` has `filters`, `setFilters(patch)`, `clear`, `isDefault`; **no href helper**; the URL is written by `replaceState(null, …)` in one effect; `projectSearch` drops every spec key and alias, keeps unrelated keys | `useAdminFilters.ts:116-201` |
| `windowFilter({ defaultValue, aliases })`; `AdminWindowValue` kinds `none` / `preset` (4 presets) / `custom` / `linked`; `parseWindow` (`range` preset, else bounds, minute or instant → `linked`, dates → `custom`) | `adminWindow.ts:27-31`, `:82-99`, `:126-140` |
| `DatePresets`: four presets + Custom, active `bg-purple-500/20 text-purple-200` + `aria-pressed`; one-sided Apply allowed; From after To → `role="alert"` "The start date must not be after the end date" | `DatePresets.tsx:39`, `:89-102`, `:104-107`, `:109-139` |
| `AdminFilterBar` fixed order window → business → page filters → Clear → Read at + Refresh; linked-window chip (testid `linked-window-chip`, X "Remove linked window") | `AdminFilterBar.tsx:132-188` |
| `KpiTile`: one `<a>`, `href` typed `` `#${string}` `` only, status `red` only; K-7 name | `KpiStrip.tsx:29`, `:84-123` |
| `AdminBusinessPicker` + `businessFilterChip` (key `account`, "Business: {name}", X "Remove business"); no fetch on mount (RC-6) | `AdminBusinessPicker.tsx:108`, `:368-383` |
| `readAdminResponse(response, { what, sessionEndedCopy?, pick? })` | `readAdminResponse.ts:55-78` |
| Consumers of what L-2a edits: `KpiStrip` (Jobs `JobsQueuesView.tsx:40`, `:131-160`), bar (Health `HealthGrid.tsx`, Jobs, Audit trail), `adminWindow` / `useAdminFilters` (Audit trail `auditTrailFilters.ts`, page) | grep |

### 1.5 Tests that pin today's page

| File | Pins L-2a touches |
|---|---|
| `__tests__/scope.render.test.tsx` (138) | `scope-toggle` `aria-checked`; `scope-notes` text ("legacy-tagged", "USD", "1,000"); `incomplete-banner` contains "lower"; route failure shows "Failed to fetch data" (`:107-111`); 400 shows "not valid" (`:113-118`); Custom → two date inputs → From after To → `date-range-error` "start date is after the end date" (`:121-137`) |
| `__tests__/bosLens.render.test.tsx` (369) | `category-card-total` / `-creation` …; `group-by-*` testids clicked as buttons (`:154-157`, P-1, P-2); `scope-toggle` click; colSpan 6 / 9 (table, untouched); P-11 deep link `user=` |
| `__tests__/bosLens.qa.render.test.tsx` (102) | `category-card-memory` click; text "Category: Memory"; `scope-toggle` |
| `__tests__/linkedWindow.render.test.tsx` (181) | `parseLinkedWindow` / `urlWithoutLinkedWindow` units; testid `linked-window`; buttons `24h` / `7d` / `30d` / `90d`; X "Clear the linked window"; active class `bg-purple-500` (`:157-167`); URL keeps `scope=bos` and `user=` after clearing (`:133-155`) |
| `app/api/admin/token-usage/drill-down/__tests__/ownerText.guard.test.ts` | Reads **only** `page.tsx`: never names `userPrompt`, `inputData`, `outputData`, `systemPrompt`, `pilotSteps`, `inputSchema`, `outputSchema`; page contains `export default function AdminCostAnalytics` |

All four render tests mock `@/lib/logger` with `createLogger` only and `next/navigation` with a fixed `useSearchParams` (RC-1 applies: see §6.2).

---

## 2. Scope and decisions

### 2.1 In L-2a

1. Header → `AdminPageHeader`: h1 **"AI cost & usage"** (D-3 (a)), purpose "What Business OS and agent-platform AI calls cost, by provider, model and feature." "BI System" pill removed. No badge.
2. KPI strip per §7.5 and R-13 (§3.6), with the new same-page filter tile mode.
3. Filter bar (§3.7): Window (standard five + extras 24 hours, 90 days; default 30 days), Business (shared picker), page filters Scope and Group by, Clear, Read at + Refresh, chips.
4. Every filter in the URL (§4), with the legacy aliases `dateFrom`, `dateTo`, `user`.
5. States (§3.9): no early returns; KPI placeholders; `AdminLoading` / `AdminError`; reads through `readAdminResponse`.
6. Forced: F-54 UTC custom range; F-55; F-43; F-44 (strip and the main grid); F-48 (Refresh, chip X).
7. Page split, scoped to what L-2a touches (§2.2).
8. Registry entry, `ownerText.guard` widened to the folder, the four render tests edited (RC-1 and the listed edits).

### 2.2 Decision: split the page, but only the parts L-2a rewrites

The page is 1,690 lines in one client file. L-2a rewrites about 600 of them (state, fetch, header, bar, KPI strip, aside cards) and leaves the table, modal and agent panel (about 500 lines) to L-2b. Rewriting in place would leave a 1,500-line diff in one file that SA must read alongside untouched L-2b code.

**Decided:** four new files in `app/admin/analytics/`, each either a verbatim move or the new code L-2a writes anyway; the L-2b half stays in `page.tsx` unedited apart from setter calls.

| New file | Contents | Kind |
|---|---|---|
| `analyticsTypes.ts` | The types `:31-140`, `Scope`, `BreakdownDimension`, `BREAKDOWN_OPTIONS` (labels only, icons dropped: the select has none), `BOS_HIDDEN_DIMENSIONS`, `BOS_DRILL_ORDER`, `breakdownOptionsFor`, `bosDrillTarget`, `UNPAGED_ROW_CAP`, `formatCost`, `formatNumber` | **verbatim move** (no logic edit; SA can read it with `git diff --color-moved`) |
| `analyticsFilters.ts` | The filter spec, validators, request-param builder, BOS normalisation and drill-patch helpers (§3.5). Pure, no React (mirrors `auditTrailFilters.ts`) | new |
| `components/AnalyticsKpis.tsx` | The strip for both scopes (§3.6) | new (replaces `:713-860`) |
| `components/AnalyticsFilterBar.tsx` | The bar wiring: window, picker, scope switch, group-by select, chips (§3.7) | new (replaces `:590-711` and the aside's two cards) |

`page.tsx` keeps state, fetch, content layout, breadcrumbs, table, agent panel and call modal; it drops to about 1,150 lines. L-2b extracts the table and drawers in its own slice. No behaviour moves silently: every behavioural change is in §3.10.

### 2.3 Decision: drill-down state goes into the URL in L-2a

U-1 says every applied filter is in the URL and the page and URL always agree. Drill clicks (row → filter + next group-by) and breadcrumbs set filters, so leaving them in React state would put L-2a in breach of U-1 between L-2a and L-2b. They go into the URL now, through the same hook: a drill click is one `setFilters` patch (filter + `groupBy`), a breadcrumb is one patch, the scope switch is one patch (C3-4 cleanup in the same event, as today). The table code in `page.tsx` changes only its setter calls.

**Labels are not filters.** The readable label of a drilled row (an agent name, an account name) stays React state, keyed by dimension and id, and is used only while its id is the applied value (the L-1e `pickedBusiness` pattern). After a reload the chip and breadcrumb show the value itself (a UUID as `formatShortId`), as the business chip already does for an inbound id (SA-R-11, RC-6: no lookup).

### 2.4 Decision: the account filter becomes the shared business picker in L-2a

As §7.5 says. Bar slot 3 is `AdminBusinessPicker` (label "Business"), bound to `filters.account`. The chip is `businessFilterChip`. A drill click on a User row sets the same `account` filter and records its label. SA-R-11 holds: in the All scope an agent-platform user id arriving by link (or by drill) still filters and shows as a short-id chip, but cannot be found by name in the picker. No fetch on mount (RC-6).

### 2.5 Not in L-2a

Table, status glyph → chip, Trend column, UTC execution times, decorative green in the modal, call-detail modal → drawer, agent-detail expand → drawer, Quick stats / Top consumers moved below the table (all L-2b, §7.5). F-47 (unused `DollarSign`, `BarChart3` imports, disposition open): left as is; only imports this slice makes unused are removed.

---

## 3. Implementation Approach and APIs

### 3.1 `useAdminFilters.ts`: `hrefFor` (shared, new)

```typescript
export interface AdminFilters<S> {
  // … unchanged …
  /**
   * The search string the URL WOULD have after `setFilters(patch)`: '' or '?a=b'.
   * Same projection as the write (U-3 defaults omitted, aliases dropped,
   * unrelated keys such as `tab` kept). No pathname: the page prepends its own.
   */
  hrefFor: (patch: Partial<S>) => string;
}
```

- Computed from the hook's state and the `useSearchParams` string (not `window.location`), so it is the same on the server and the client (no hydration mismatch).
- **No `usePathname`.** Every existing page test mocks `next/navigation` with `useSearchParams` only; adding `usePathname` to the hook would throw in all of them (Audit trail's eight render tests included). The page prepends its path constant.
- Pure helper `projectSearch` reused; `mergeKeepingIdentity` reused for the patched state. Memoised on `[filters, incoming, spec]`.

### 3.2 `KpiStrip.tsx`: the same-page filter mode, the plain tile and `amber` (shared)

```typescript
export type KpiTileStatus = 'red' | 'amber';

interface KpiTileBase { label: string; value: string; sub?: string | null; status?: KpiTileStatus | null; testId?: string }

/** K-6 same-page filter tile (Q-14, R-7). */
export interface KpiTileFilter {
  /** The filtered view as a real link: `${PAGE_PATH}${hrefFor(patch)}`. */
  href: string;
  /** Applies the same patch through the page's useAdminFilters. */
  apply: () => void;
  /** This tile's filter is the applied one (a toggle tile): aria-current and the purple ring. */
  current?: boolean;
}

export type KpiTileProps = KpiTileBase & (
  | { href: `#${string}`; filter?: never }   // anchor (L-1b, unchanged for Jobs)
  | { filter: KpiTileFilter; href?: never }  // same-page filter (L-2a)
  | { href?: never; filter?: never }         // no target: not a link (K-6)
);
```

- **Filter mode** renders `<a href={filter.href}>`. `onClick`: if the event is already prevented, or it is not button 0, or `metaKey` / `ctrlKey` / `shiftKey` / `altKey` is held, do nothing (the browser opens the href); otherwise `preventDefault()` and `filter.apply()`. Middle click raises `auxclick`, not `click`, so it always uses the href. Copy-link copies the href. One write path: the hook (Q-14).
- `current`: `aria-current="true"` and the classes `border-purple-500 ring-1 ring-purple-500/50` instead of the neutral border (T-7 accent). Not combined with a status (no caller needs both; a status wins if both are given).
- **No-target tile:** a `<div role="group" aria-label={name}>` with the same look and no hover style. Not a `<button>`, not a `<section>`, not a region (K-6, A-9). `role="group"` carries the K-7 name, which a plain `div` may not.
- `amber`: "Needs a look", `AlertTriangle`, `border-amber-500/40`, `text-amber-300`, copied from Health `STATUS_STYLES.amber` (`HealthTile.tsx:53-58`), as `red` was (S-3 forbids the import). No green is added (S-7 count unchanged).
- Jobs' four tiles keep `href: '#…'` and render byte-identical (`jobsQueues.layout.render :154` "four tile links … none is a button" unedited).
- The cross-page `next/link` mode is **not** built: every AI cost & usage tile targets the same page (SA-R-3). It stays deferred to the finance adoption slice.

### 3.3 `adminWindow.ts`: the window extras (shared, deferred from L-1c, D-2 (b))

```typescript
export const ADMIN_WINDOW_EXTRAS = ['24h', '90d'] as const;          // only what a page keeps today (D-2 (b)); later pages add theirs
export type AdminWindowExtra = (typeof ADMIN_WINDOW_EXTRAS)[number];
export const ADMIN_WINDOW_EXTRA_LABELS: Readonly<Record<AdminWindowExtra, string>> = { '24h': '24 hours', '90d': '90 days' };

export type AdminWindowValue = /* existing kinds */ | { kind: 'extra'; extra: AdminWindowExtra };

export function parseWindow(get, extras: readonly AdminWindowExtra[] = []): AdminWindowValue | undefined; // `range` is accepted as an extra only if the page lists it
export function windowFilter(options: { defaultValue; aliases?; extras?: readonly AdminWindowExtra[] }): AdminFilterField<AdminWindowValue>;
```

- `serialiseWindow` → `{ range: '24h' }` / `{ range: '90d' }`; `windowEquals` compares the extra.
- `resolveWindow` for an extra: `90d` → `dates` (today minus 89 days to today, U-8's "N days" rule, the same as Costs' 90 days, `CostsTab.tsx:43`, `:52-53`); `24h` → `linked` with the two instants `now − 24 h` and `now` (an exact rolling window; that is what "24 hours" means). AI cost & usage does **not** use `resolveWindow` for its presets or extras (it sends `period=N`, Q-13, §3.5); the branch exists so the union stays total and `DatePresets` can seed its inputs. See Q-2.
- A page that does not pass `extras` sees no change: Audit trail's `?range=90d` is still ignored (U-4).

### 3.4 `DatePresets.tsx` and `AdminFilterBar.tsx` (shared)

- `DatePresets` gains `extras?: readonly AdminWindowExtra[]` (buttons after Custom, in the same `role="group"`, same classes, `aria-pressed`, same "second click goes to the default" rule, SA M-2) and `requireBothDates?: boolean` (Apply is enabled only when both inputs hold a date; the "both empty → default" rule does not apply). `draftFrom` seeds from an extra's `dates` resolution; a `linked` resolution seeds empty, as today for linked values.
- `AdminFilterBar.windowControl` passes both through. No other bar change; Health, Jobs and Audit trail pass neither, so their DOM is unchanged.
- `ADMIN_WINDOW_LABELS` is unchanged ("7 days", "30 days", …).

### 3.5 `analyticsFilters.ts` (page, pure)

```typescript
export interface AnalyticsFilters {
  scope: Scope;                      // 'bos' default
  window: AdminWindowValue;          // { kind: 'preset', preset: '30d' } default
  account: string;                   // '' default; request param `user`
  category: string;                  // 'all' default
  groupBy: BreakdownDimension;       // 'provider' default; request param `breakdownBy`
  provider: string; model: string; activity: string; requestType: string;
  feature: string; component: string; endpoint: string; agent: string; execution: string; // '' defaults
}
export const ANALYTICS_PATH = '/admin/analytics';
export const ANALYTICS_DEFAULT_WINDOW: AdminWindowValue;
export const ANALYTICS_FILTER_SPEC: AdminFilterSpec<AnalyticsFilters>;
export function analyticsRequestParams(f: AnalyticsFilters, now: Date): URLSearchParams;
export function normaliseForScope(f: AnalyticsFilters): Partial<AnalyticsFilters>; // {} when nothing to fix
export function scopeSwitchPatch(next: Scope, f: AnalyticsFilters): Partial<AnalyticsFilters>;
export function drillPatch(keep: Partial<AnalyticsFilters>): Partial<AnalyticsFilters>; // breadcrumbs, "All Data"
export function rowClickPatch(item: { id: string }, f: AnalyticsFilters): Partial<AnalyticsFilters>; // the switch at :391-447, verbatim logic
```

**Window field.** `windowFilter({ defaultValue: 30 days, aliases: { dateFrom: 'from', dateTo: 'to' }, extras: ['24h', '90d'] })`, with its `parse` narrowed for this route (U-4, parity with `linkedWindow.ts`): a `custom` value needs **both** dates; a `linked` value needs **both** bounds in the instant form (with an offset) and from not after to. Anything else is ignored (default 30 days, URL cleaned). Reason: the route accepts only offset instants (§1.2), and today's page accepts only that pair.

**Request mapping** (U-8; Q-13; route unchanged). Param order is today's (`:296-319`): `breakdownBy`, `scope`, then provider, model, activity, request_type, feature, component, endpoint, user, agent, execution, category, then the window.

| Window | Sent | Note |
|---|---|---|
| 24 hours / 7 days / 30 days / 90 days | `period=1` / `7` / `30` / `90` | rolling server window, unchanged (Q-13, F-94) |
| Today, This month | `dateFrom=<from>T00:00:00.000Z`, `dateTo=<to>T23:59:59.999999Z` | new presets send explicit bounds (Q-13); end of day with microseconds (L-1c SA S-1) |
| Custom (two whole dates) | same as Today | **F-54 fixed**: both bounds UTC (today `from` is UTC midnight, `to` is local 23:59:59) |
| Linked (two instants) | both verbatim | as today |

`category` is sent only when not `all` (as `:308`).

**Validators** mirror the route (§1.2): dimensions 1 to 200 chars and no control character; `account` UUID or `system`; `agent` UUID or `no-agent`; `execution` UUID or `single-` + UUID; `category` creation / execution / memory / system; `group_by` one of the ten; `scope` bos / all. A value the route would refuse with a 400 is ignored on arrival (U-4). Values set by clicks are not re-validated (they come from the route).

**`drillPatch(keep)` (SA M-1).** Today a breadcrumb replaces the whole filter object, so the patch names all eleven drill, business and category fields (provider, model, activity, requestType, feature, component, endpoint, account, agent, execution, category), each set to its default unless kept, and never names `groupBy`, `scope` or `window`. "All Data" is `drillPatch({})`. One unit test per breadcrumb level, including a business from the Businesses link being dropped by a breadcrumb, as today.

**`normaliseForScope`.** In the BOS scope: `agent`, `execution` → '', `category` → 'all', `groupBy` agent / execution → provider (exactly `handleScopeToggle`'s cleanup, `:462-472`). The page applies it in two places: the request builder always builds from `{ ...filters, ...normaliseForScope(filters) }`, so a refused combination is never sent; and an effect writes the patch back with `setFilters` when it is not empty, so the URL and the controls converge. The fetch is keyed on the request string (§3.8), so this write-back sends **no** second request. It only fires for a hand-edited or stale link (`?scope=bos&category=memory`, `?group_by=agent`); no builder emits one.

### 3.6 `components/AnalyticsKpis.tsx`

Props: `scope`, `totals`, `categoryTotals`, `comparison`, `possiblyIncomplete`, `category` (applied), `firstLoad`, `tile(patch)` → `{ href, apply }`.

| Scope | Tiles (in order) | Target | Status |
|---|---|---|---|
| BOS (4, R-13) | Total spend, Calls, Tokens, Avg cost per call | group by provider / activity / model / none | Total spend **amber** "Needs a look" when `possiblyIncomplete` (K-5 (ii): the page already renders the amber `incomplete-banner` for the same condition, `:673-678`); all else neutral |
| All (5, R-13) | Total spend, Creation, Execution, Memory, System | group by provider; then `category` toggle (`current` when applied; a click on the applied one goes back to `all`, as `:743-748`) | as above for Total spend; categories neutral |

| Tile | Value | Sub-line |
|---|---|---|
| Total spend | `formatCost(totals.cost)` | In the All scope first `"{tokens} tokens"` (SA M-2: the All strip has no Tokens tile); then `"+4.2% vs previous period"` from `comparison.changes.costPct` (**text only**, §7.5); then "may be incomplete" when `possiblyIncomplete` (K-8), joined by " · " |
| Calls | `formatCount(totals.calls)` | — |
| Tokens | `formatNumber(totals.tokens)` (compact, as today) | `"{in} in · {out} out"` (`formatNumber`) |
| Avg cost per call | `formatCost(cost / calls)`, em dash when no calls (§5.7) | — |
| Creation … System | `formatCost(categoryTotals.x.cost)` | `"{pct}% of spend · {tokens} tokens · {description}"` (the four descriptions kept from `:766`, `:796`, `:826`, `:856`) |

**K-5 ruling on the ±% colour: neutral.** The red-up / green-down colour (`:726`) is neither a status the payload carries (`comparison` has numbers, no status) nor an existing notice for a condition; it is a page-invented signal, and green-for-down is decorative green (T-6). §7.5 already says "as text, no red/green". No new threshold; nothing green on the KPI strip or filter bar (the L-2b half is unchanged; SA N-2).

**Category palette → neutral** (T-6: emerald on Execution is decorative green; T-7: no per-page accents). The selected category is shown by `current` (purple ring + `aria-current`).

Testids kept so the presence pins hold: `category-card-total`, `category-card-creation`, `-execution`, `-memory`, `-system`; new: `kpi-calls`, `kpi-tokens`, `kpi-avg-cost`. Loading (K-10): `KpiStrip loading placeholderCount={scope === 'bos' ? 4 : 5}` until the first successful read. Error: strip hidden.

**Quick stats stays a card** in the aside in both scopes, unchanged (R-13: in the All scope it is where Calls, Tokens and Avg cost live; in the BOS scope it repeats three tile figures and adds Avg tokens/call and input/output, so removing it would lose data). L-2b moves it below the table (§7.5).

### 3.7 `components/AnalyticsFilterBar.tsx`

`AdminFilterBar` with, in §5.5 order:

| Part | Control |
|---|---|
| 1-2 Window | `windowControl={{ value, defaultValue: 30 days, onChange, extras: ['24h', '90d'], requireBothDates: true }}` → Today, 7 days, 30 days, This month, Custom, 24 hours, 90 days. Custom opens From (UTC) / To (UTC) + Apply |
| 3 Business | `AdminBusinessPicker selectedAccountId={filters.account}`; `onSelect` records the picked name and calls `setFilters({ account })` |
| 4 Scope | The existing `role="switch"` button, testid `scope-toggle`, `aria-checked`, text "Business OS only", now with a visible field label "Scope" (`ADMIN_FIELD_LABEL`, linked by `aria-labelledby` to the label AND the button's own text, so the name reads "Scope Business OS only", SA M-3) and the purple active style `bg-purple-500/20 text-purple-200` (emerald removed, T-6). One click, as today (see Q-7) |
| 4 Group by | Native `<select>` labelled "Group by" (`ADMIN_FIELD_CONTROL`), testid `group-by-select`; options from `breakdownOptionsFor(scope)` with `data-testid="group-by-{value}"` on each `<option>` (so the P-1 / P-2 presence pins hold unedited) |
| 5 Clear | `onClear={clear}`, `canClear={!isDefault}`: every filter to its default, **including scope (BOS) and window (30 days)** (§5.5 part 5) |
| 6 Read at + Refresh | `readAt` = last successful read; `what` = "AI cost and usage" → "Refresh AI cost and usage" |
| 7 Chips | Linked window (bar's own). Business (`businessFilterChip`). Category "Category: {label}" (testid `filter-chip-category`, X "Remove category") in the All scope. One chip per applied drill filter: "Provider: …", "Model: …", "Activity: …", "Request type: …", "Feature: …", "Component: …", "Endpoint: …", and in the All scope "Agent: …", "Execution: …" (testid `filter-chip-{key}`, X "Remove {name in lower case}") |

Chip label = the recorded label while its id is applied, else the value (UUIDs via `formatShortId`, full value in `title`). Today's card had no chip for request type, feature, component and endpoint (only breadcrumbs); L-2a adds them (§5.5 part 7: one chip per non-default filter the controls cannot show).

### 3.8 `page.tsx` (rewired, L-2b half untouched)

- `const { filters, setFilters, clear, isDefault, hrefFor } = useAdminFilters(ANALYTICS_FILTER_SPEC)`; `labels` and `pickedBusiness` as React state (§2.3).
- `const effective = useMemo(() => ({ ...filters, ...normaliseForScope(filters) }), [filters])`; `const query = analyticsRequestParams(effective, new Date()).toString()`. The query holds dates at day precision only, so it is stable within a UTC day.
- `fetchData(query)`: `fetch(`/api/admin/token-usage/drill-down?${query}`, { cache: 'no-store' })` in its own `try` (a rejection → `ADMIN_NETWORK_ERROR` + `logger.error({ err }, …)`); then `readAdminResponse(response, { what: 'AI cost and usage', sessionEndedCopy: true, pick })` with a typed `pick` of the top-level body (no `any`). On failure: status 400 → the page's existing sentence "The selected filters or dates are not valid. Check the date range and try again." (Q-10); otherwise `result.message` (§5.10). Items and totals cleared, as today (`:362-363`). On success: the same setters as `:341-359`, plus `setReadAt(new Date().toISOString())`.
- `useEffect(() => { fetchData(query) }, [query])`: one request per distinct query; Refresh calls `fetchData(query)` (same query, §5.5).
- `useEffect` for the normalise write-back (§3.5).
- `handleRowClick` → `setFilters(rowClickPatch(item, filters))` + label record; the call-row branch (`setSelectedCall`) unchanged. `handleScopeToggle` → `setFilters(scopeSwitchPatch(next, filters))`, `setSelectedCall(null)`, `setExecutionDetails(null)`, as `:473-474`. Breadcrumbs → `setFilters(drillPatch({ … }))` with the same kept keys as `:1037-1157`; "All Data" keeps today's meaning (drill filters, account and category cleared; scope, window and group-by kept).
- `tile(patch)` = `{ href: ANALYTICS_PATH + hrefFor(patch), apply: () => setFilters(patch) }`.
- Logger: `clientLogger.child({ module: 'AdminCostAnalytics' })` (one `error` line, `{ err }` only, on a rejected fetch).

### 3.9 States and layout (§5.10, §5.1)

Order: `AdminPageHeader` → `AnalyticsKpis` (hidden on error) → `AnalyticsFilterBar` → content.

| State | Content area |
|---|---|
| First read | `AdminLoading what="AI cost and usage"` ("Reading AI cost and usage…"); KPI placeholders |
| Later read | current content kept, `aria-busy` on the content wrapper, Refresh spins |
| Error | `AdminError` (`testId="analytics-error"`, `onRetry`) in place of the content; header and bar stay |
| Partial | `AdminNotice testId="incomplete-banner"` with today's sentence (contains "lower bound"), above the content |
| Notes | `scope-notes` paragraph kept (text unchanged, "Business OS only:" as plain words instead of the emerald pill) at the top of the content |
| Empty | the table's own "No data found" row stays (L-2b) |

Main grid (F-44): `grid grid-cols-1 gap-6 xl:grid-cols-12`, aside `xl:col-span-3`, table `xl:col-span-9`.

### 3.10 Visible and request changes on `/admin/analytics` (named in the PR)

1. h1 "AI cost & usage", purpose line; "BI System" pill gone (D-3 (a)).
2. Window labels: Today, 7 days, 30 days, This month, Custom, 24 hours, 90 days (D-2 (b)); active style `bg-purple-500/20` + `aria-pressed`. **Today** and **This month** are new; they send explicit UTC bounds (Q-13).
3. **Custom no longer auto-applies** "last 30 days" when clicked; it opens From (UTC) / To (UTC) and applies on Apply (§5.5). Both dates required, as today.
4. **Custom range is whole UTC days** (F-54): totals for a custom range can shift by the admin's UTC offset (§10 "For your information").
5. A legacy date-only `?dateFrom=2026-09-25&dateTo=2026-09-26` (no builder emits it) was ignored and now opens that custom range (U-7). Minute-form and one-sided bounds stay ignored, as today.
6. Business picker replaces the read-once `?user=`; chip "Business: {name or short id}" instead of the card's "User: Account 99999999".
7. Scope stays one click; the active colour is purple, not green. Group by is a select in the bar.
8. **Clear** resets every filter to the page default, including scope (Business OS only), window (30 days) and group by (Provider); today's "Clear all" kept scope, period and group by (SA M-4). The breadcrumb "All Data" keeps its old meaning.
9. Chips for request type, feature, component and endpoint (new); every chip X is named "Remove {filter}" (F-48).
10. The URL always reflects the view (scope omitted when BOS, window omitted when 30 days); inbound legacy keys are rewritten to `range` / `from` / `to` / `account` by replace (U-9).
11. KPI strip: BOS 4 tiles, All 5 tiles; every linked tile is a real link (middle-click opens the filtered view); ±% is plain text; category tiles neutral with a purple ring when selected; Total spend amber "Needs a look" when the 1,000-call cap was hit.
12. Loading and errors no longer replace the page (F-55); a non-JSON body shows the fixed sentence, not a parser message (F-43); route errors other than 400 show the route's own words ("Internal server error", "Failed to fetch data") instead of the page's "Failed to fetch data" for all; 401 / 403 show the session-ended sentence.
13. A filter change that yields the same request no longer sends a second identical request.

---

## 4. The URL contract on AI cost & usage

### 4.1 Keys

| Field | Canonical key(s) | Aliases (read, never written) | Default (omitted) | Accepted | Request |
|---|---|---|---|---|---|
| scope | `scope` | — | `bos` | `bos`, `all` | `scope` (always sent) |
| window | `range`, `from`, `to` | `dateFrom` → `from`, `dateTo` → `to` | `range=30d` | `today`, `7d`, `30d`, `this_month`, `24h`, `90d`; `custom` with two whole dates; two offset instants, ordered (linked) | `period` or `dateFrom` / `dateTo` (§3.5) |
| account | `account` | `user` | '' | UUID or `system` | `user` |
| category | `category` | — | `all` | creation, execution, memory, system (All scope) | `category` |
| groupBy | `group_by` | — | `provider` | the ten dimensions (eight in BOS) | `breakdownBy` (always sent) |
| provider, model, activity, feature, component, endpoint | same names | — | '' | 1 to 200 chars, no control chars | same names |
| requestType | `request_type` | — | '' | as above | `request_type` |
| agent | `agent` | — | '' | UUID or `no-agent` (All scope) | `agent` |
| execution | `execution` | — | '' | UUID or `single-` + UUID (All scope) | `execution` |

**Page-only keys: none** (the page has no free-text search, D-6 does not arise). Labels and the picked business name are page state, never in the URL. The drill state is in the URL (§2.3). The open call or agent detail is not (U-10).

### 4.2 Round trips the tests pin

| # | Arrive with | Request | Address bar after mount | View |
|---|---|---|---|---|
| R-1 | Health: `?scope=bos&dateFrom=2026-09-25T08:14:00.000Z&dateTo=2026-09-26T08:14:00.000Z` | `scope=bos`, both bounds verbatim, no `period` | `?range=custom&from=…&to=…` | linked chip "Linked window 2026-09-25 08:14 to 2026-09-26 08:14 UTC" |
| R-2 | Businesses / Activity: `?scope=bos&user=<uuid>` | `user=<uuid>`, `period=30` | `?account=<uuid>` | chip "Business: 99999999…" |
| R-3 | `?scope=all&user=<uuid>` | `scope=all`, `user=<uuid>` | `?scope=all&account=<uuid>` | as today |
| R-4 | Cutover, no account: `?scope=bos` | `scope=bos`, `period=30` | clean | default |
| R-5 | `?dateFrom=2026-09-25T08:14&dateTo=2026-09-26T08:14` (minute) | `period=30`, no `dateFrom` | clean | default |
| R-6 | `?dateFrom=2026-09-25&dateTo=2026-09-26` | `dateFrom=2026-09-25T00:00:00.000Z`, `dateTo=2026-09-26T23:59:59.999999Z` | `?range=custom&from=2026-09-25&to=2026-09-26` | Custom pressed, inputs filled |
| R-7 | `?account=A&user=B` | `user=A` | `?account=A` | canonical wins |
| R-8 | `?range=24h` / `?range=90d` / `?range=today` (fake clock) | `period=1` / `period=90` / today's two UTC bounds | unchanged | the extra / preset pressed |
| R-9 | `?scope=bos&category=memory&group_by=agent` | no `category`, `breakdownBy=provider`; **exactly one request** | clean | default |
| R-10 | Junk: `?range=week&group_by=nope&account=xyz&scope=maybe` | all defaults | clean | default |
| R-11 | All scope, click the Memory tile | one new request with `category=memory` | `?scope=all&category=memory` | tile `aria-current`, chip "Category: Memory"; the tile's href was `/admin/analytics?scope=all&category=memory` |
| R-12 | Ctrl-click (or meta, shift) the Memory tile | none | unchanged | `apply` not called, default not prevented |
| R-13 | Drill: group by feature, click "Row feature" | `feature=feature-1`, `breakdownBy=component` | `?group_by=component&feature=feature-1` | chip "Feature: Row feature" |
| R-14 | Clear | defaults | clean | BOS, 30 days |

Every case also asserts **no** `pushState` and that writes use `replaceState(null, …)` (spy), as the L-1c tests do.

---

## 5. Guard and registry changes

| File | Change | Why |
|---|---|---|
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | Registry (part (b)) gains `'/admin/analytics (AI cost & usage)'` with files `page.tsx`, `analyticsTypes.ts`, `analyticsFilters.ts`, `components/AnalyticsKpis.tsx`, `components/AnalyticsFilterBar.tsx`. No new shared file, so `EXPECTED_SOURCES` and part (a) are unchanged | §12.3 "added to the registry"; the page then must import `AdminPageHeader`, have no own `<h1` and no direct `.json(` in any listed file |
| `app/api/admin/token-usage/drill-down/__tests__/ownerText.guard.test.ts` | G-2 / G-3 read **every non-test `.ts` / `.tsx` under `app/admin/analytics/`** (walk, not just `page.tsx`); a new case asserts the walk finds at least the five files; the "reads the real files" case still requires `export default function AdminCostAnalytics` in `page.tsx` | The split moves code out of `page.tsx`; without this the owner-text guard would silently stop covering it. Strengthening only |

`npm run test:bos-entitlements`: no file in this slice imports `lib/business-os/**` (S-4 holds for the shared folder; the page imports nothing from `lib/` except `@/lib/logger/client`).

---

## 6. Tests

### 6.1 New

| File | Covers |
|---|---|
| `app/admin/components/layout/__tests__/KpiStrip.render.test.tsx` (extended) | Filter mode: an `<a>` with the given href, named per K-7; plain click → `apply` called once and `defaultPrevented` true; ctrl, meta, shift, alt and right-button clicks → `apply` not called, default not prevented; `current` → `aria-current="true"` and the purple ring classes, no neutral border. Plain tile: `role="group"` with the K-7 name, no link, no button. Amber: "Needs a look", hidden icon, amber border, name ends "needs a look". Anchor mode unchanged (existing cases unedited) |
| `app/admin/components/layout/__tests__/useAdminFilters.render.test.tsx` (extended) | `hrefFor`: '' for a patch back to all defaults; drops aliases present in the URL; keeps `tab`; omits page-only and default values; does not write history and does not change state |
| `app/admin/components/layout/__tests__/adminWindow.test.ts` (extended) | `?range=24h` / `90d` parse only when listed; serialise / equals; `resolveWindow` for both extras (fake clock) |
| `app/admin/components/layout/__tests__/DatePresets.render.test.tsx` (extended) | Extras render after Custom, `aria-pressed`, second click → default; `requireBothDates` disables Apply with one input; without the props the "five buttons in order" pin is unedited |
| `app/admin/analytics/__tests__/analyticsFilters.test.ts` | Every §4.1 validator both ways; `analyticsRequestParams` param order and every §3.5 mapping row (incl. microseconds and `Z`); `normaliseForScope`; `scopeSwitchPatch`; `drillPatch`; `rowClickPatch` for each dimension in both scopes (the P-4 / P-5 / P-10 / P-11 paths at unit level); the ported `parseLinkedWindow` cases (offset instants accepted; one-sided, minute, reversed, garbage refused; date-only now **custom**) |
| `app/admin/analytics/__tests__/analytics.layout.render.test.tsx` | One h1 "AI cost & usage", no "BI System"; region order header → strip → bar → content; first read: placeholders + "Reading AI cost and usage…", header and bar mounted; error: strip hidden, `analytics-error` text, "Try again" refetches; non-JSON body → "Could not read AI cost and usage. Try again in a moment."; fetch rejects → `ADMIN_NETWORK_ERROR` and one logged `{ err }`; 403 → session-ended sentence; 400 → the page sentence; BOS 4 tiles / All 5 tiles with names and targets; amber Total spend with `possiblyIncomplete`; ±% sub-line has no red/green class; round trips R-1 to R-14 with the replaceState spy; mount pin (exactly one drill-down request for R-1, R-2, R-9); picker does not fetch on mount (RC-6); Refresh named "Refresh AI cost and usage", same query, "Read at" updates |

### 6.2 Edited deliberately (each listed in the PR with its reason)

| File | Edit | Reason |
|---|---|---|
| all four analytics render tests | add `jest.mock('@/lib/logger/client', …)` (the `AdminHeader.render` / Audit trail pattern) | RC-1: the page and the shared picker call `clientLogger.child` at module scope |
| `scope.render.test.tsx` `:107-111` | the generic failure now expects the route's own string ("Invalid query parameters"), not "Failed to fetch data" | §5.10 rule 1 (the 400 case at `:113-118` is unedited: the page keeps its 400 sentence, Q-10) |
| `scope.render.test.tsx` `:121-137` | the From-after-To alert is the shared one: `getByRole('alert')` with "The start date must not be after the end date" (testid `date-range-error` gone) | `DatePresets` owns the Custom row (§5.5 part 2) |
| `bosLens.render.test.tsx` `:154-157` (`groupBy` helper) | `fireEvent.change(getByTestId('group-by-select'), { target: { value: dim } })` instead of clicking a button | Group by is a native select (§7.5); the per-option testids keep P-1 / P-2 unedited |
| `bosLens.qa.render.test.tsx` | none beyond RC-1 (the tile is still `category-card-memory`, a click still applies, "Category: Memory" is the chip text) | — |
| `linkedWindow.render.test.tsx` | `parseLinkedWindow` / `urlWithoutLinkedWindow` unit blocks removed (ported to `analyticsFilters.test.ts`; the second function no longer exists); testid `linked-window` → `linked-window-chip`; button names `24h`, `7d`, `30d`, `90d` → "24 hours", "7 days", "30 days", "90 days"; X "Clear the linked window" → "Remove linked window"; the active-class pin `bg-purple-500` (`:157-167`) → `aria-pressed` "true" / "false"; after clearing, the URL check expects `account=<id>` and **no** `scope` (BOS is the default, U-3; `user` rewritten, U-9) and no `from` / `to` / `dateFrom` / `dateTo` | the standard's labels, chip, active state and URL contract |

`linkedWindow.ts` is deleted (its parse rule moves into `analyticsFilters.ts`; the hook owns the URL; the bar owns the chip label).

### 6.3 Must stay green with no edit

`bosLens.render` P-1 to P-12 (apart from the helper), `bosLens.qa.render`, the shared folder tests not listed above, `AdminBusinessPicker.render` and `businessPicker.contract`, the eight Audit trail render tests, the Jobs render and source guards (four tile links, 11 buttons), the Health render / layout / source guards, `evaluateHealth.test` (link builder), `activityTab.render` (cutover links `:439`, `:456`), `app/admin/users/__tests__`, `AdminSidebar.nav.test`, the drill-down route tests.

---

## 7. Verification

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/analytics app/api/admin/token-usage --ci` | all green |
| V-2 | `npx jest app/admin/audit-trail app/admin/__tests__ lib/admin/health app/admin/business-os-llm app/admin/users app/admin/finance app/admin/components/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | all green, no edit (Audit trail, Health incl. the spend-link builder, Jobs, Activity incl. the cutover links, Businesses, sidebar) |
| V-3 | Mutation checks, each restored (md5 before = after): (a) drop `preventDefault` in the filter tile → the KpiStrip plain-click case and R-11 fail; (b) let a ctrl-click call `apply` → the modifier cases and R-12 fail; (c) `hrefFor` without the alias drop → the `hrefFor` alias case fails; (d) remove the `user` alias → R-2, R-3, `bosLens` "honours a deep link" and P-11 fail; (e) remove the `dateFrom` / `dateTo` aliases → R-1 and the linked-window render cases fail; (f) drop the analytics window narrowing (accept minute and one-sided) → R-5 fails (and its request would be a route 400); (g) map the custom `to` back to `new Date(to + 'T23:59:59').toISOString()` and run under `TZ=Asia/Jerusalem` → the F-54 unit row fails; (h) remove the `normaliseForScope` merge from the request → R-9 and the BOS `afterEach` refusal check fail; (i) key the fetch effect on the filters object instead of the query string → the R-9 one-request pin fails; (j) drop `extras` from the window spec → R-8 fails; (k) drop the amber status → the amber tile cases fail; (l) remove the folder walk from `ownerText.guard` and plant `inputData` in `AnalyticsKpis.tsx` → only the walked version catches it | each named test red, then green after restore |
| V-4 | `npm run test:bos-entitlements` | green (no entitlements import anywhere in the slice) |
| V-5 | Scoped `tsc` (SA-R-14): scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`, absolute `include` of `next-env.d.ts`, the shared folder and its tests, `adminWindowPresets.ts`, `components/ui/sheet.tsx`, `app/admin/analytics/**`, the Audit trail page + `auditTrailFilters.ts` + its tests, `components/jobs/JobsQueuesView.tsx` (the `KpiTileProps` union consumer), `components/health/HealthGrid.tsx`. **Run 1:** canary `const canary: number = 'x';` in `KpiStrip.tsx` → exactly that TS2322. **Run 2:** canary removed → zero errors | both runs recorded |
| V-6 | `npm run lint:hooks`, then `npx eslint <touched files>` | no hook violation; no new findings (removed-icon imports clean) |
| V-7 | `git diff --stat origin/main` **before reading the diff** (SA M-4: the branch is on `origin/main`); then `git diff --color-moved origin/main -- app/admin/analytics` | insertions where expected, no blanked file; `analyticsTypes.ts` shows as moved lines. Absent: `app/api/**`, `lib/**`, `components/ui/*`, `app/admin/audit-trail/**` sources, `app/admin/components/jobs/**`, `app/admin/components/health/**`, `app/admin/business-os-llm/**`, `app/admin/users/**`, `app/admin/finance/**`, `AdminSidebar.tsx`, `app/admin/layout.tsx`, `adminWindowPresets.ts`, `AdminBusinessPicker.tsx` |
| V-8 (QA / TL, browser) | Signed in as an admin, DevTools Network open, light **and** dark scheme emulation (SA Q-8). §7.1 | one line or screenshot per item |

The worktree's `node_modules` is a junction to the main checkout: never remove or replace it. No `git stash`, no `git worktree remove`, no commit by Dev.

### 7.1 Browser checks for TL (V-8)

| # | Do | Expect |
|---|---|---|
| A-B1 | Open `/admin/analytics` | h1 "AI cost & usage" + purpose; 4 tiles (BOS); bar with Window (30 days pressed), Business, Scope (on), Group by, Clear (disabled), Read at, Refresh; one drill-down request with `scope=bos&period=30`; **no** `llm-usage/businesses` request |
| A-B2 | Health landing → click the AI spend figure | lands with the linked chip, URL rewritten to `range=custom&from&to`, same total as the Health figure (while under 1,000 calls), one request |
| A-B3 | Businesses → a business → "Open in AI cost & usage" | URL `?account=<id>`, chip "Business: …" (short id), one request with `user=` |
| A-B4 | `/admin/business-os-llm?tab=activity` cutover link (if shown) | opens with `scope=bos` (URL clean) or `?account=` |
| A-B5 | Click "Business OS only" off | 5 tiles; URL `?scope=all`; one request |
| A-B6 | Click the Memory tile; then click it again | URL gains then loses `category=memory`; purple ring and chip appear then go; one request each; **no** page reload |
| A-B7 | Middle-click (or Ctrl-click) the Execution tile | a new tab opens at `/admin/analytics?scope=all&category=execution` with that view; the current tab is unchanged |
| A-B8 | Group by → Feature; click a row; click the breadcrumb "All Data" | URL tracks `group_by` / `feature`; chips follow; "All Data" clears the drill but keeps scope and window |
| A-B9 | Reload after A-B8's row click | same view; chip shows the raw value (no name) |
| A-B10 | Window: Today, This month, 24 hours, 90 days, Custom (pick two dates, Apply) | requests: today's UTC bounds, month bounds, `period=1`, `period=90`, `dateFrom=<from>T00:00:00.000Z` / `dateTo=<to>T23:59:59.999999Z`; Custom does nothing until Apply; From after To → the red alert, no request |
| A-B11 | Clear | every filter back to default: BOS, 30 days, provider; URL clean |
| A-B12 | DevTools offline → Refresh | red alert "Could not reach the server…" with Try again; header and bar stay |
| A-B13 | A window over 1,000 calls (if available) | Total spend tile amber "Needs a look", sub "may be incomplete"; amber notice above the content |
| A-B14 | Keyboard: Tab through tiles, bar, chips | purple focus rings; Enter on a tile applies it; every chip X announces "Remove …" |
| A-B15 | Narrow the window to a phone width | strip and main grid wrap (F-44); no sideways page scroll |
| A-B16 | After any filter change, in the console | `history.state.__NA === true`; Back leaves the page (no Back entries per filter) |

---

## 8. Task List

- [x] ✅ T-1 `adminWindow.ts` extras + `DatePresets.tsx` / `AdminFilterBar.tsx` props (§3.3, §3.4) + their test extensions
- [x] ✅ T-2 `useAdminFilters.ts` `hrefFor` (§3.1) + test extension
- [x] ✅ T-3 `KpiStrip.tsx` filter mode, plain tile, amber (§3.2) + test extension; Jobs suite green unedited
- [x] ✅ T-4 `analyticsTypes.ts` (move, S-4 exceptions noted) and `analyticsFilters.ts` (§3.5) + `analyticsFilters.test.ts`
- [x] ✅ T-5 `components/AnalyticsKpis.tsx` and `components/AnalyticsFilterBar.tsx` (§3.6, §3.7)
- [x] ✅ T-6 `page.tsx` rewiring, states, layout; delete `linkedWindow.ts` (§3.8, §3.9)
- [x] ✅ T-7 Test edits (§6.2) and `analytics.layout.render.test.tsx`
- [x] ✅ T-8 Registry and `ownerText.guard` (§5)
- [x] ✅ T-9 Verification V-1 to V-7; results under Implementation Notes
- [x] ✅ T-10 Requirement: §1 row 6 status; §5.6 Businesses citation `:273-274`; §1 notes on what L-2a built (same-page tile mode, `hrefFor`, extras, amber, plain tile) and what stays deferred (cross-page tile mode, other K-4 statuses); page deviations Q-7 / Q-10 / Q-4 (S-3); Change History
- [x] ✅ T-11 Hand over to TL for SA code review (uncommitted)

---

## 9. Sizing and the split decision

| Part | Days |
|---|---|
| Shared: extras + `requireBothDates` (0.4), `hrefFor` (0.25), tile modes + amber (0.4), their tests | 1.05 |
| `analyticsTypes.ts` move + `analyticsFilters.ts` + unit tests | 0.8 |
| KPI and bar components | 0.6 |
| Page rewiring, states, layout | 0.8 |
| Test edits + layout render test (R-1 to R-14) | 0.75 |
| Guard / registry, mutations, tsc, lint, docs | 0.5 |
| **Total** | **about 4.5 days** |

**Decision: one slice.** It is at the top of "a few days" (L-1c was approved at about 5). The shared additions are small and each is used on this page in the same PR (SA-R-3), and the bar, URL and KPI strip are tied: the tiles' hrefs come from the same hook the bar writes through. **Fallback, if SA prefers smaller:** L-2a1 = header, states, bar, URL (incl. extras, picker, drill state), the existing cards kept as they are; L-2a2 = KPI strip with the same-page tile mode, `hrefFor`, amber and the plain tile (the R-7 full-cycle part), about 2.5 + 2 days. See Q-1.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A second request from the URL write, the alias rewrite or the normalise write-back | The fetch is keyed on the request string; R-1, R-2 and R-9 pin exactly one request; V-3 (i) |
| A stale or hand-made link sends a combination the route refuses (400) | Validators mirror the route; `normaliseForScope` is applied to the request itself; the BOS refusal `afterEach` in both `bosLens` files stays |
| `hrefFor` on the server differs from the client | Built from `useSearchParams` and state only; no `window` |
| The tile anchor triggers a full navigation in some browsers | `preventDefault` on plain left click only; A-B6 checks for no reload; V-3 (a) |
| Day-precision query string changes at UTC midnight while the page is open | Only for Today / This month / Custom-relative seeds; a new day is a new window, so one new request is correct |
| Clear now also resets scope and window, which an admin used to keeping them may notice | Named in the PR (§3.10 item 8); it is the standard's rule; "All Data" keeps the narrow clear |
| The four category descriptions make the sub-line long | It wraps (`text-xs`); A-B15 checks narrow widths |
| `linkedWindow.ts` deletion breaks an importer | Only the page and its test import it (grep, §1.1) |

---

## 11. Out of scope

L-2b items (§2.5); F-94 (rolling presets, user decision); F-47 and F-49, F-52 (open); any route change; moving the link builders to canonical names (Health, Businesses, Activity); the cross-page `next/link` tile mode and the `green`, `not_measured`, `unavailable` tile statuses (no consumer here); the `neutral` chip tone; `useDrawerResource` (L-8).

---

## 12. Questions for SA

| # | Question | Dev lean |
|---|---|---|
| Q-1 | Size: one slice of about 4.5 days, or the pre-planned split L-2a1 (bar, URL, states, header) / L-2a2 (KPI strip + tile mode) | One slice (§9) |
| Q-2 | Window extras as a new `extra` kind, opt-in per page through `windowFilter({ extras })` and `DatePresets extras`, built for `24h` and `90d` only. `resolveWindow`: `90d` = the last 90 UTC calendar days (Costs' rule); `24h` = the instant pair now minus 24 h to now, returned as `linked`. AI cost & usage itself maps both to `period=N` and never resolves them | As stated |
| Q-3 | `requireBothDates` on `DatePresets` for this page: Apply needs both dates, as today. Reason: a To-only window cannot be sent (the route would take "now minus 30 days" as the start); From-only would work, but today's page does not allow it either | Add the prop |
| Q-4 | The analytics window parse is narrowed: linked = both offset instants, ordered (today's `linkedWindow.ts` rule, because the route refuses the minute form); custom = both dates. The one widening: a legacy date-only `dateFrom`/`dateTo` pair now opens as a custom range (§3.10 item 5) | As stated |
| Q-5 | `KpiTileProps` as a three-way union (anchor / filter / no target); filter mode `{ href, apply, current }`; `current` = `aria-current="true"` + purple ring; the no-target tile is a `div role="group"` with the K-7 name | As stated |
| Q-6 | `hrefFor(patch)` returns '' or `?query` and the page prepends its path, so the hook needs no `usePathname` (which every existing `next/navigation` mock lacks) | As stated |
| Q-7 | Scope stays the one-click `role="switch"` button in bar part 4, with a visible "Scope" field label and purple instead of emerald, rather than a native select. §5.5 part 4 names selects and text inputs; a binary toggle as a select adds a click and changes five tests for no gain | Keep the switch |
| Q-8 | Drill-down filters go into the URL in L-2a (§2.3), labels stay React state, no lookup after a reload | As stated |
| Q-9 | Clear resets everything, scope and window included (§5.5); the breadcrumb "All Data" keeps today's narrower clear | As stated |
| Q-10 | A 400 keeps the page's existing sentence instead of the route's "Invalid query parameters" (a page override of §5.10 rule 1, already pinned by `scope.render :113-118`); every other failure follows §5.10 with `sessionEndedCopy` on | Keep the override |
| Q-11 | The fetch effect is keyed on the request query string, not on the filters object, so identical queries never repeat and the normalise write-back costs nothing | As stated |
| Q-12 | The split in §2.2: `analyticsTypes.ts` (verbatim move), `analyticsFilters.ts`, `components/AnalyticsKpis.tsx`, `components/AnalyticsFilterBar.tsx`; `ownerText.guard` walks the folder | As stated |
| Q-13 | Category tiles neutral (no palette), descriptions kept in the sub-line; the ±% sub-line plain text (K-5, §7.5) | As stated |
| Q-14 | Chips for every applied drill filter, adding the four that had none (request type, feature, component, endpoint) | Add them |
| Q-15 | Quick stats stays in the aside in both scopes in L-2a (moved below the table in L-2b) | As stated |

---

## Implementation Notes

**Dev, 2026-10-11.** One slice; the Q-1 tripwire (about 5 days) was not reached. Uncommitted on `feature/admin-layout-l2a` at `origin/main` `39680689`. Line endings preserved: the shared folder is LF; `app/admin/analytics/**` and `ownerText.guard.test.ts` are CRLF in this checkout and stay CRLF (new analytics files are LF; git normalises them).

### Files

| File | Action |
|---|---|
| `app/admin/components/layout/adminWindow.ts` | `extra` kind, `ADMIN_WINDOW_EXTRAS`, `ADMIN_WINDOW_EXTRA_LABELS`, `parseWindow(get, extras)`, `windowFilter({ extras })`; every switch on the kind handles `extra` (S-7); `resolveWindow` 90d → dates, 24h → linked, with the S-6 comment |
| `app/admin/components/layout/DatePresets.tsx` | `extras` (after Custom, same group and classes, `aria-pressed`, second click → default) and `requireBothDates`; `draftFrom` seeds from an extra |
| `app/admin/components/layout/AdminFilterBar.tsx` | `windowControl.extras` / `requireBothDates` passed through (no DOM change for Health, Jobs, Audit trail) |
| `app/admin/components/layout/useAdminFilters.ts` | `hrefFor(patch)` (`useCallback` on `[filters, incoming, spec]`, Q-6) |
| `app/admin/components/layout/KpiStrip.tsx` | `KpiTileProps` three-way union; filter mode; no-target `div role="group"`; `amber`. Anchor mode markup unchanged for Jobs |
| `app/admin/analytics/analyticsTypes.ts` | new: the moved types, dimensions and formatters (S-4 exceptions below) |
| `app/admin/analytics/analyticsFilters.ts` | new: spec, validators, `narrowAnalyticsWindow`, `analyticsRequestParams`, `normaliseForScope`, `scopeSwitchPatch`, `drillPatch`, `rowClickPatch`, `DIMENSION_FIELD` |
| `app/admin/analytics/components/AnalyticsKpis.tsx` | new: the strip for both scopes |
| `app/admin/analytics/components/AnalyticsFilterBar.tsx` | new: the bar, the Scope switch, the Group by select, the chips |
| `app/admin/analytics/page.tsx` | rewired (1,690 → 1,029 lines); the L-2b half has only the renames listed below |
| `app/admin/analytics/linkedWindow.ts` | deleted (planned) |
| tests | see "Tests" below |
| `layoutFolder.guard.test.ts`, `ownerText.guard.test.ts` | registry entry; folder walk (§5, S-9 header line updated) |

### How the SA conditions landed

| # | Where |
|---|---|
| M-1 | `drillPatch` names all eleven drill, business and category fields and never `groupBy` / `scope` / `window`; "All Data" = `drillPatch({})` (page `clearAllFilters`). `analyticsFilters.test.ts` "drillPatch: one case per breadcrumb level": All Data + the nine breadcrumb levels + the business-from-link case |
| M-2 | `AnalyticsKpis`: in the All scope the Total spend sub-line starts with "{tokens} tokens"; pinned in `analytics.layout.render` ("All: Total spend keeps the total tokens first…", sub-line `100 tokens`) |
| M-3 | `aria-labelledby="{labelId} {textId}"`: name "Scope Business OS only"; pinned by `getByRole('switch', { name: 'Scope Business OS only' })` |
| M-4 | header branch line, §3.10 item 8 (group by), V-7 base `origin/main` |
| S-1 | `narrowAnalyticsWindow` orders by `Date.parse`; test "orders bounds by time, not by string" (a `+03:00` / `Z` pair both ways); every old `parseLinkedWindow` case ported |
| S-2 | validators mirror `route.ts`: case-insensitive UUID, `system`, `no-agent`, `single-` + UUID, 1 to 200 chars, code points 0 to 31 and 127 refused (written as a char-code loop, no escape sequences) |
| S-3 | requirement §1 row 6 records Q-7, Q-10, Q-4 |
| S-4 | see "Deviations" 1 |
| S-5 | see "Mechanical renames in the L-2b half" |
| S-6 | comment on the `24h` branch of `resolveWindow` |
| S-7 | `serialiseWindow`, `windowEquals`, `resolveWindow`, `draftFrom` and `narrowAnalyticsWindow` all handle `extra`; `auditTrailFilters.ts` unedited |
| S-8 | mutation (g) ran as `TZ=Asia/Jerusalem` for the whole Jest process (environment of the `npx jest` call); a temporary probe test in the same run asserted `getTimezoneOffset()` = -180 and passed, then was deleted |
| S-9 | `ownerText.guard` header: "Jest is a required check on main, so this guard runs on every PR" |

### Deviations from the workplan text

1. `analyticsTypes.ts` is a move with named exceptions (S-4, say so in the PR): `export` added to every moved declaration; `BREAKDOWN_OPTIONS` lost its icons; `formatCost` / `formatNumber` became module functions (bodies identical, de-indented); `FilterLabels` and `PERIOD_OPTIONS` were not moved (labels are now `DrillLabels`, keyed by filter, in `AnalyticsFilterBar.tsx`). 111 of its 150 non-blank lines match `origin/main` `page.tsx` lines exactly; the rest are the header comment and the `export` lines.
2. `rowClickPatch` writes the old `switch` as two tables (`DIMENSION_FIELD`, `NEXT_DIMENSION`) with the same outcomes; `bosDrillTarget` moved unchanged and is fed the filters under their dimension names. Every path is pinned in `analyticsFilters.test.ts` and the bosLens P-cases still pass unedited.
3. The request-type chip test id is `filter-chip-request_type` (the URL key), like the `group-by-request_type` option.
4. `AdminError` sits in the content area under the bar; the agent-detail panel condition also gained `showContent &&` (one line in the L-2b half) so a stale panel never shows beside an error.
5. Total spend no longer carries the small "Business OS" / "All" badge: the Scope switch states it.
6. Breadcrumb text after a reload (no recorded label) is the value, ids shortened as `xxxxxxxx…`; the execution crumb's old fallback "Exec: xxxxxxxx..." is replaced by the same short id.
7. Tile targets: Total spend → group by provider; Calls → activity; Tokens → model; Avg cost per call has no target (plain tile).
8. `ownerText.guard` G-2 / G-3 titles now read "no page file names …" (they cover the folder).

### Mechanical renames in the L-2b half (S-5)

In the breadcrumbs: `filters.user` → `filters.account`, `filters.request_type` → `filters.requestType` (conditions and class expressions); `{filterLabels.x}` → `{labelOf('x')}`; each `setFilters({ … }); setFilterLabels({ … });` pair → `setFilters(drillPatch({ … }))` with the same kept keys. `scope` and `breakdownBy` are now local constants read from the normalised filters, so `ContextChips`, the table header, the colSpan and the footer read them unchanged. The main grid is wrapped in `{showContent && ( … )}` without re-indenting the untouched lines; `col-span-3` / `col-span-9` → `xl:col-span-3` / `xl:col-span-9` (F-44). Nothing else in the table, the modal or the agent panel changed.

### Tests

New: `analyticsFilters.test.ts` (64 tests), `analytics.layout.render.test.tsx` (41 tests: header and states, errors incl. F-43 / network / 403 / 400, KPI strip incl. M-2 and amber, R-1 to R-14, Custom on Apply with whole UTC days, scope switch; the shared `afterEach` checks no `pushState`, every `replaceState` with `null`, no picker read on mount (RC-6) and no refused Business OS request). Extended: `KpiStrip.render` (+12), `useAdminFilters.render` (+4), `adminWindow` (+6), `DatePresets.render` (+5); existing cases unedited.

Edited deliberately (each to list in the PR):

| File | Edit | Reason |
|---|---|---|
| all four analytics render tests | add the `@/lib/logger/client` mock | RC-1 |
| `scope.render.test.tsx` | the generic failure expects the route string "Invalid query parameters" (test renamed) | §5.10 rule 1; the 400 case is unedited (Q-10) |
| `scope.render.test.tsx` | From after To: `findByRole('alert')` with "The start date must not be after the end date" | the shared `DatePresets` owns the Custom row |
| `bosLens.render.test.tsx` | `groupBy` helper: waits for the option testid, then `fireEvent.change` on `group-by-select` | Group by is a native select |
| `bosLens.qa.render.test.tsx` | RC-1 only | — |
| `linkedWindow.render.test.tsx` | unit blocks removed (ported); `linked-window` → `linked-window-chip`; button names → "24 hours" / "7 days" / "30 days" / "90 days"; X → "Remove linked window"; class pin → `aria-pressed`; after clearing: `account` kept, no `user`, no `scope`, no `from` / `to` / `dateFrom` / `dateTo` | the standard's labels, chip, active state and URL contract |
| `layoutFolder.guard.test.ts` | registry entry `/admin/analytics (AI cost & usage)` with five files | §12.3 |
| `ownerText.guard.test.ts` | folder walk + "the walk finds" case; header line | §5, S-9 (strengthening only) |

### Verification (2026-10-11)

| # | Result |
|---|---|
| V-1 / V-2 | `npx jest app/admin/analytics app/api/admin/token-usage app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/business-os-llm app/admin/users lib/admin/health lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts app/admin/finance app/admin/components/__tests__ --ci`: **90 suites, 2,426 tests, all passed**. The only console output is a pre-existing jsdom `window.scrollTo` notice from `app/admin/users/__tests__/businessOsPanel.render.test.tsx` (unedited) |
| V-3 | all twelve mutation runs red, each restored with md5 equal, `git status` identical before and after: (a) KpiStrip plain click + R-11; (b) KpiStrip ctrl + R-12 ctrl; (c) the `hrefFor` alias case (the mutation removes the alias drop in `projectSearch`, which the write path shares, so four write-path cases also fail); (d) R-2, R-3, R-7, R-2 chip, scope "honours a deep link", P-11; (e) R-1, R-1 chip, R-5, R-6 (x2) and all five linkedWindow page cases; (f) R-5 and eight narrowing unit cases; (g) under `TZ=Asia/Jerusalem` (probe: offset -180, passed) the F-54 row fails, and Today / This month too (they share the whole-day helper); (h) R-9 (its request and the shared refusal `afterEach`); bosLens stays green (no bosLens case arrives with a refused combination); (i) R-9 one-request pin; (j) R-8 24h, R-8 90d, R-8 pressed, and the narrowing extras case; (k) the amber unit case, "a status wins over current", and the layout amber case; (l) with the walk, the planted `inputData` in `AnalyticsKpis.tsx` turns G-2 red; with the walk removed, G-2 stays green (the plant is missed) and only the new "walk finds" case is red |
| V-4 | `npm run test:bos-entitlements`: 233 suites, 6,382 tests, all passed |
| V-5 | scoped `tsc` (scratch tsconfig, never committed). Run 1, canary `const canary: number = 'x';` appended to `KpiStrip.tsx`: exactly one error outside `page.tsx`, `KpiStrip.tsx(224,7): error TS2322: Type 'string' is not assignable to type 'number'`. Canary removed, md5 equal. Run 2: **zero errors in any file this slice wrote**; the 19 remaining are all in untouched L-2b lines of `page.tsx` (`unknown` / `{}` rendered as `ReactNode` in `ContextChips` and the call modal), and the same 19 appear for `origin/main`'s `page.tsx` (checked with a transient copy, deleted) |
| V-6 | `npm run lint:hooks`: exit 0. `npx eslint` on every touched file: 0 errors, 3 warnings, all pre-existing in `page.tsx` (`DollarSign`, `BarChart3` unused, F-47; `availableFilters` assigned but never read). The hooks config on the touched files: clean |
| V-7 | `git diff --stat origin/main`: 18 tracked files, 839 insertions, 1,032 deletions (docs included); the only deletion-only file is `linkedWindow.ts` (planned). Six new files (above). Absent, as required: `app/api/**` sources, `lib/**`, `components/ui/*`, Audit trail sources, Jobs and Health components, `business-os-llm`, `users`, `finance`, `AdminSidebar.tsx`, `app/admin/layout.tsx`, `adminWindowPresets.ts`, `AdminBusinessPicker.tsx`, and the three inbound link builders and their tests. No `console.*`, no escape sequences, every `any` is the existing commented fetch stub in tests |

### User-visible changes on `/admin/analytics`

As §3.10 items 1 to 13, all built. In short: the title "AI cost & usage" with a purpose line; the KPI strip (Business OS: Total spend, Calls, Tokens, Avg cost per call; All: Total spend and four neutral category tiles), each linked tile a real link, Total spend amber "Needs a look" when the 1,000-call cap was hit, the change vs the previous period as plain text; one filter bar (Window with Today, 7 days, 30 days, This month, Custom, 24 hours, 90 days; Business picker; Scope switch, now purple; Group by select; Clear; Read at; Refresh); chips for every filter the controls cannot show; every filter in the address bar; Custom applies on Apply in whole UTC days; Clear resets scope, window and group by too; loading and errors no longer replace the page.

### QA B-1 fix

Fixed by Dev (2026-10-11): `fail()` in `page.tsx` now also calls `setHasLoaded(false)`, so a read after a failed read (Try again, Refresh, a filter change) shows the first-read state: KPI placeholders and "Reading AI cost and usage…", with the header and bar on screen. Before, it showed "Total spend, $0.00", zero Quick stats and "No data found". New render test in `analytics.layout.render.test.tsx`: "QA B-1: after success, a failure, then Try again with a pending read, shows placeholders and "Reading…", never zeros". Mutation (remove the line): that test red, every other test green, `page.tsx` md5 equal after restore. Re-run: `npx jest app/admin/analytics app/admin/components/layout --ci` 22 suites, 558 tests, all passed; hooks lint on `page.tsx` exit 0 (default ESLint: the same 3 older warnings); scoped tsc 19 errors, all the older `page.tsx` L-2b ones, 0 elsewhere. SA N-2 applied to the §3.6 text.

### Out of scope, found while working (listed, not fixed)

1. `page.tsx` has 19 pre-existing TypeScript errors in the L-2b half (`metadata` values of type `unknown` rendered in JSX); `next.config.js` ignores them. L-2b rewrites those lines.
2. `availableFilters` in `page.tsx` is set from every response and never read (pre-existing lint warning).
3. `businessOsPanel.render.test.tsx` prints a jsdom `window.scrollTo` "not implemented" error (framer-motion); unrelated to this slice.

## SA Review Notes

Workplan review: see "SA Workplan Review — 2026-10-11" below. The code review is added here at the code stage.

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11** (workplan stage, no code). Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l2a`, fast-forwarded to `origin/main` `39680689` (L-1a to L-1e merged).
**Status:** APPROVED WITH CONDITIONS (M-1 to M-4 before code review; S-1 to S-9 checked at code review). One slice; no split row. No product question for the user.

**Verified against the code at `39680689`:** `app/admin/analytics/page.tsx` (state `:240-290`, fetch `:291-379`, row click `:381-452`, scope toggle `:459-476`, `clearAllFilters` `:487-491`, Custom auto-apply `:508-525`, header and switch `:590-644`, Total spend card `:713-733`, category buttons `:740-857`, Quick stats `:980-1004`, breadcrumbs `:1036-1157`); `linkedWindow.ts`; the route's Zod schema `route.ts:47-90` and its 400 body `:224-231` and date defaults `:241-249`; `useAdminFilters.ts`, `adminWindow.ts`, `DatePresets.tsx`, `AdminFilterBar.tsx`, `KpiStrip.tsx`, `readAdminResponse.ts`, `AdminBusinessPicker.tsx` (`businessFilterChip`), `adminWindowPresets.ts`; `auditTrailFilters.ts:75-80` (the only other `resolveWindow` caller); `HealthTile.tsx` `STATUS_STYLES.amber`; `CostsTab.tsx:43-53` (90 days = today minus 89 to today); the four analytics render tests; `ownerText.guard.test.ts`; `layoutFolder.guard.test.ts` registry.

**Route date rules checked with the installed zod 3.25.76** (`z.string().datetime({ offset: true })`): accepted `2026-10-11T00:00:00.000Z`, `2026-10-11T23:59:59.999999Z` (Date.parse truncates to ms, so the route's from-not-after-to refine works), `2026-09-25T08:14:00.000Z`, `+03:00` offsets; refused `2026-09-29T16:51` (minute) and `2026-09-25` (date). So every value in the §3.5 mapping table is accepted, and the minute form must stay ignored on this page (§1.2 is correct). The shared `boundForm` instant pattern requires a colon offset, so it is narrower than zod (never a 400 from it).

**Inbound links, byte for byte:** `evaluateHealth.ts:409-412` emits `scope=bos&dateFrom=<toISOString>&dateTo=<toISOString>` (ordered, `Z`, ms): accepted by the narrowed parse and forwarded verbatim (R-1). `BusinessOsPanel.tsx:274` and `CutoverNotice.tsx:22-30` emit `scope=bos` and `user=<id>`: `scope=bos` is the default, `user` is the `account` alias (R-2, R-4). No builder is edited and their pins (`evaluateHealth.test.ts:570-577`, `activityTab.render.test.tsx:439`, `:456`) stay unedited (V-2). Dev's §1.3 correction of the §5.6 citation (`:273-274`, not `:74-78` / `:247-252`) is right.

### Rulings on Q-1 to Q-15

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **One slice.** Pre-authorised fallback: if the build passes about 5 days, Dev stops at the L-2a1 boundary of §9 (header, states, bar, URL incl. extras, picker, drill state; old cards rewired to the hook), hands that over alone, and SA adds the L-2a2 row then | 4.5 days is inside the L-1c precedent (about 5, approved as one). The tiles' hrefs come from the hook the bar writes through, so a split would force throwaway interim wiring of the old cards; both halves build shared exports, so both would be full cycle anyway |
| Q-2 | **Approved: a new `extra` kind, opt-in per page.** `90d` resolves to `dates` (today minus 89 days to today): the U-8 rule and exactly Costs' 90 days (`CostsTab.tsx:52-53`), which L-9 will reuse. `24h` resolves to `linked` (now minus 24 h, now): the honest meaning of "24 hours". AI cost & usage maps both to `period=1` / `period=90` and never resolves them (Q-13; F-94 stays as recorded: on this page the labels keep the rolling server meaning) | Extending `ADMIN_WINDOW_PRESETS` is not an option (finance and its route re-resolve those ids). See S-6 for the `24h` comment |
| Q-3 | **Approved: `requireBothDates`.** | A To-only request makes the route start at now minus 30 days, a wrong window; From-only is not allowed today either. Keeps today's behaviour |
| Q-4 | **Approved.** Linked = both bounds in the instant form, ordered by time; custom = both whole dates; minute-form and one-sided bounds ignored (default 30 days, URL cleaned). The date-only legacy pair opening as custom is accepted (U-7 lists the date form; no builder emits it). Record the minute / one-sided narrowing as a page deviation from U-7 in §1 (S-3) | The route's Zod refuses the minute form (verified above) and a To-only bound means a wrong start; the route is not changed in a layout slice |
| Q-5 | **Approved.** Three-way union; filter mode `{ href, apply, current }`; `current` = `aria-current="true"` + purple ring; the no-target tile is `div role="group"` with the K-7 name. **Jobs' 11-button pin holds** (filter tiles are `<a>`, the plain tile is a `div`, Jobs keeps `href: '#…'` byte-identical). **Health's region pin holds** (Health renders no `KpiStrip`; `group` is not a landmark; no `<section>` is added, S-8) | K-6 and Q-14 as written: real link, plain left click `preventDefault` + `apply`, modified / middle click and copy-link use the href |
| Q-6 | **Approved: `hrefFor` returns '' or `?query`; the page prepends `ANALYTICS_PATH`.** Return it through `useCallback` on `[filters, incoming, spec]` | Adding `usePathname` to the hook would break every existing `next/navigation` mock (Audit trail's eight tests included); the path is a page constant anyway |
| Q-7 | **Approved: keep the one-click `role="switch"`**, with the visible "Scope" label, purple not emerald. Condition M-3 on its accessible name. Record it in §1 as a page deviation from §5.5 part 4 (select or text input) | Keeps today's behaviour and five tests; a binary toggle as a select adds a click for no gain |
| Q-8 | **Approved: drill state in the URL in L-2a (U-1); labels are page state; after a reload the chip and breadcrumb show the value (UUIDs as `formatShortId`), no lookup** | U-1 would otherwise be breached between L-2a and L-2b; no lookup keeps RC-6's no-fetch-on-mount rule. Provider, model and similar values are readable as they are |
| Q-9 | **Approved, and standard-forced (no user question).** Clear resets every filter to the page default (§5.5 part 5), which includes scope, window **and group by** (both are page filters in §7.5, and `isDefault` drives Clear's disabled state). The breadcrumb "All Data" keeps today's narrower reset (drill filters, business, category). See M-4 for the exact semantics | Today the card's "Clear all" and "All Data" call the same `clearAllFilters` (`:487-491`, `:1037`), so the narrow reset stays one click away, and every chip has its own X |
| Q-10 | **Approved as a recorded page deviation from §5.10 rule 1:** status 400 shows the page's existing sentence; every other failure follows `readAdminResponse` with `sessionEndedCopy: true`. Implement it as a status check on the helper's result, not a fork of the helper. Record in §1 (S-3) | The route's "Invalid query parameters" is less useful to an admin than the pinned sentence (`scope.render :113-118`); with validators mirroring the route a 400 should now be rare |
| Q-11 | **Approved: the fetch effect is keyed on the request query string.** Refresh and Try again re-run the same string | No second request from the alias rewrite, the junk clean-up or the normalise write-back; R-1, R-2, R-9 pin exactly one request |
| Q-12 | **Approved: the split and the `ownerText.guard` walk.** Guard intent verified: "these names must not appear anywhere in the route or the page, comments included"; after the split, page code lives in five files, so walking every non-test `.ts` / `.tsx` under `app/admin/analytics/` keeps the intent (strengthening only). Keep the "reads the real files" case on `page.tsx`, add the walk-finds-at-least-five case | Without the walk, moved types (the call-detail shapes) would leave the guard's view silently |
| Q-13 | **Approved: neutral category tiles, ±% as plain text; Total spend amber "Needs a look" only when `possiblyIncomplete`.** K-5 (ii) is met: the page already renders the amber `incomplete-banner` for exactly that condition (`:673-678`), and it stays (as `AdminNotice`) | No status in the payload for ±%; red-up / green-down is a page-invented signal and green-for-down is decorative (T-6); no new threshold |
| Q-14 | **Approved: one chip per applied drill filter, including the four new ones.** | §5.5 part 7: the controls cannot show these values; the X names follow F-48 |
| Q-15 | **Approved: Quick stats stays in the aside in L-2a; L-2b moves it below the table.** | In the All scope it holds Calls and Avg cost (R-13); removing or moving it here would lose data or widen the slice |

### The two visible behaviour changes in §3.10

| Change | Ruling | User question? |
|---|---|---|
| Clear also resets scope (to Business OS only), window (to 30 days) and group by (to Provider) | **Standard-forced.** §5.5 part 5 says Clear resets all filters to the page defaults, and scope and group by are page filters on this page (§7.5). The standard does not allow a partial Clear, because Clear's disabled state is "every filter at its default". Today's narrower reset is kept on the breadcrumb "All Data", and each chip has its own X, so nothing the admin could do before is lost | No |
| Custom no longer applies "last 30 days" on the click; it opens From (UTC) / To (UTC) and applies on Apply | **Standard-forced.** §5.5 "Apply semantics" (typed inputs apply on Apply) and the shared `DatePresets` already behave so on Audit trail. The inputs open pre-filled with the applied window's dates (30 days → the last 30 UTC days), so one Apply click gives what the old click gave | No |

Both are named in the PR (§3.10 items 3 and 8). No product question for the user.

### Findings

**Must (before code review)**

| # | Where | Finding |
|---|---|---|
| M-1 | §3.5 `drillPatch`, §3.8 breadcrumbs | Today a breadcrumb **replaces** the whole filter object (`setFilters({ provider: filters.provider })`, `:1043` to `:1155`), so it also drops every deeper drill key, the business (`user`) and the category; it keeps group by, scope and window. A `Partial` patch merged by the hook keeps everything it does not name. `drillPatch(keep)` must therefore return every one of the eleven drill / business / category fields, set to its default unless kept, and never touch `groupBy`, `scope`, `window`. "All Data" = `drillPatch({})`. `analyticsFilters.test.ts` pins one case per breadcrumb level (incl. that a business arriving from the Businesses link is dropped by a breadcrumb, as today) |
| M-2 | §3.6 Total spend tile | Today the Total Spend card's sub-line shows the total tokens (`:724` "{tokens} tokens"). In the All scope the new strip has no Tokens tile and Quick stats has only input, output and per-call tokens, so the total token figure would disappear from the page (R-13: "no data moves"). Keep "{tokens} tokens" in the Total spend sub-line in the All scope (first, then ±%, then "may be incomplete", joined by " · "); a render test pins it |
| M-3 | §3.7 part 4 Scope | Linking the switch only to the "Scope" label by `aria-labelledby` would make its name "Scope" and drop "Business OS only", which is what the on/off state refers to. Its name must contain "Business OS only" (e.g. `aria-labelledby="{labelId} {textId}"`, read "Scope Business OS only"). Pin the name in `analytics.layout.render` |
| M-4 | Header, §3.10 item 8, V-7 | The branch is now on `origin/main` `39680689` (L-1d and L-1e merged): update the header's branch line (the PR no longer carries #292 / #293) and V-7's diff base (`origin/main`, not `feature/admin-layout-l1e`). §3.10 item 8 must also name group by (today's "Clear all" kept it too) |

**Should (checked at code review)**

| # | Where | Finding |
|---|---|---|
| S-1 | §3.5 window parse | Order linked bounds by `Date.parse`, never by string (offsets differ). Port every `parseLinkedWindow` case and add one pair whose string order and time order disagree (`+03:00` against `Z`) |
| S-2 | §3.5 validators | Mirror the route's patterns exactly, including the case-insensitive UUID pattern (`route.ts:29`, `/i`), and the 200-char / control-character rule for dimensions. A value the route accepts must never be dropped by the page |
| S-3 | T-10 | Record in §1 row 6 as page deviations: Q-7 (switch, not select), Q-10 (400 sentence), Q-4 (minute-form and one-sided bounds not honoured on this page, U-7, because the route refuses them) |
| S-4 | §2.2 `analyticsTypes.ts` | Not quite verbatim: `BREAKDOWN_OPTIONS` loses its icons and `formatCost` / `formatNumber` move from closures to module functions. Say so in the PR so the `--color-moved` reader expects those lines |
| S-5 | §3.8, L-2b half | The rename `user` → `account` and `request_type` → `requestType` touches reads in the untouched half (Subtotal at about `:1318`, `ContextChips`, the table header). Allowed as mechanical renames; list them in the Implementation Notes so "setter calls only" stays accurate |
| S-6 | §3.3 `resolveWindow` for `24h` | Add a comment: the result depends on the clock to the millisecond, so a page must never key a request on it; AI cost & usage maps the extra to `period=1`. `DatePresets` seeds empty inputs from it, as for a linked value |
| S-7 | §3.4 extras | Every `switch` on `AdminWindowValue.kind` must handle `extra` (`serialiseWindow`, `windowEquals`, `resolveWindow`, `draftFrom`); `auditTrailFilters.ts` gets no edit because Audit trail never lists an extra (V-5 covers it) |
| S-8 | V-3 (g) | `TZ` must be set for the whole Jest process (`TZ=Asia/Jerusalem npx jest …`), not inside a test; QA records `new Date().getTimezoneOffset()` from that run to prove the offset was in effect before calling the mutation caught |
| S-9 | `ownerText.guard` | It is touched, so update its stale header line "no CI workflow runs Jest yet" (Jest is a required check on main now) |

**Notes (no action required)**

- N-1: The page has no newest-wins guard; a slow older response can overwrite a newer one. Same as today and as Audit trail; not required here. If Dev adds one, it is a ref counter, not a new pattern.
- N-2: In the All scope a drilled User row writes `account`, so the chip reads "Business: {label}" even for an agent-platform user. Accepted under SA-R-11.
- N-3: The Total spend, Calls and Tokens tiles set group by only and carry no `current`; the Group by select shows the result. Clicking the tile for the group by already applied sends no request (Q-11). Fine.
- N-4: 4.5 days is at the top of "a few days"; the Q-1 tripwire applies.

### Verdict

**APPROVED WITH CONDITIONS.** Dev fixes M-1 to M-4 in this workplan (small edits) and proceeds to implementation without a second SA pass; SA checks M-1 to M-4 and S-1 to S-9 at code review. One slice. No product question for the user: both §3.10 behaviour changes are forced by §5.5.

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11** (uncommitted worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l2a`, base `origin/main` `39680689`).
**Status:** ✅ Code Approved. No must-fix. Fast-track: QA next, then RM.

**Diff shape (checked before reading):** `git diff --stat origin/main`: 18 tracked files, 839 insertions, 1,032 deletions; the only deletion-only file is `app/admin/analytics/linkedWindow.ts` (planned; no importer left, grep). Six untracked additions (two tests, `analyticsFilters.ts`, `analyticsTypes.ts`, `components/` with two files, this workplan). Absent as required: `app/api/**` sources, `lib/**`, the three inbound link builders and their pins, Jobs / Health components, `adminWindowPresets.ts`, `AdminBusinessPicker.tsx`.

### What was verified

| Item | Result |
|---|---|
| M-1 `drillPatch` | `analyticsFilters.ts:272-299`: all eleven fields, default unless kept, never `groupBy` / `scope` / `window`. Every breadcrumb in `page.tsx:384-509` keeps exactly the keys of `origin/main` `page.tsx:1043-1155` (compared line by line); "All Data" = `drillPatch({})` |
| M-2 | `AnalyticsKpis.tsx:73-79`: All scope Total spend sub-line starts with "{tokens} tokens" |
| M-3 | `AnalyticsFilterBar.tsx:184`: `aria-labelledby` = label id + text id, name "Scope Business OS only" |
| M-4 | Header, §3.10 item 8 and V-7 base updated |
| S-1 | `narrowAnalyticsWindow` (`analyticsFilters.ts:140-156`) orders by `Date.parse`; the `+03:00` / `Z` disagreement case is pinned both ways; every old `parseLinkedWindow` case is ported |
| S-2 | Validators match `route.ts:29-75` (case-insensitive UUID, `system`, `no-agent`, `single-` + UUID, 1 to 200 chars, code points 0-31 and 127, the ten dimensions, the five categories, `bos` / `all`). Checked with the installed zod: every instant `boundForm` accepts (incl. seconds-less `T08:14Z` and 7-digit fractions) is accepted by `datetime({ offset: true })`, so no page-accepted window can 400 (see N-1 for the reverse) |
| S-3 | Requirement §1 row 6 records Q-7, Q-10, Q-4 |
| S-4 to S-9 | As listed in Implementation Notes; S-6 comment at `adminWindow.ts:194-197`; S-7 every switch on `kind` handles `extra` (`serialiseWindow`, `windowEquals`, `resolveWindow`, `draftFrom`, `narrowAnalyticsWindow`, `analyticsRequestParams`); `auditTrailFilters.ts` unedited; S-9 header line updated |
| KpiTile three modes | Anchor branch (`KpiStrip.tsx:200-213`) emits the same attributes in the same order and the identical class string as `origin/main`, so Jobs is byte-identical; the Jobs layout pin (four links, 11 buttons) passes unedited. Filter mode: `<a href>`, plain left click only (`defaultPrevented`, `button === 0`, no meta / ctrl / shift / alt) gets `preventDefault` + `apply`; middle click raises `auxclick` and never reaches it; `aria-current="true"` + purple ring; a status wins. No-target tile: `div role="group"` with the K-7 name, no landmark, no button |
| `hrefFor` | `useAdminFilters.ts:200-206`: `projectSearch` over `mergeKeepingIdentity`, from `useSearchParams` and state only, no `usePathname`, writes nothing |
| `extra` kind | Opt-in per page (`parseWindow(get, extras)`); Audit trail unchanged; `90d` = today minus 89 days (U-8), `24h` = linked instants with the S-6 comment |
| `DatePresets` | Extras after Custom in the same group, same classes, `aria-pressed`, second click to default through `pickPreset`; `requireBothDates` gates both `canApply` and `apply` |
| URL contract | Aliases `dateFrom` / `dateTo` → `from` / `to`, `user` → `account`; request param order identical to `origin/main` `page.tsx:296-319`; `period=1/7/30/90` for the rolling windows; Today / This month / Custom as `T00:00:00.000Z` / `T23:59:59.999999Z` (route-accepted); linked verbatim |
| Fetch keyed on the query | `page.tsx:132`, `:201-203`; `fetchData` has no dependencies; the normalise write-back (`:208-211`) cannot send a second request; R-9 pins exactly one |
| Row click | `rowClickPatch` + `NEXT_DIMENSION` reproduce the `origin/main` switch at `:381-452` for all ten dimensions, BOS redirect via the moved `bosDrillTarget` |
| K-5 colours | Strip: no green; amber only with `possiblyIncomplete`; ±% is plain text; categories neutral. (The L-2b half still carries green / emerald; see N-2) |
| `ownerText.guard` | The folder walk keeps the guard's intent and strengthens it; the "reads the real files" case is kept; the walk-finds case excludes tests |
| Deviations 1-9 | All acceptable. 5 (the Business OS / All badge on Total spend dropped) is covered by the Scope switch; 6 (short id instead of "Exec: …") follows Q-8 |
| tsc claim | Re-run by SA with a scratch tsconfig: the slice's files plus the shared folder, Jobs, Health and Audit trail consumers give 19 errors, all in `page.tsx`; a scratch copy of `origin/main`'s `app/admin/analytics` gives 19 errors with **identical messages** (all TS2322 `unknown` → `ReactNode`), at the same lines shifted by the removed code (ContextChips and the call modal). Claim confirmed; none is in a line this slice wrote |
| Logging, `any`, lint | No `console.*`; one `clientLogger.child` with `{ err }`; no new `any` (the `pick` cast is `unknown`-mediated and commented); eslint 0 errors, 3 pre-existing warnings in `page.tsx` |
| Entitlements | No import from `lib/business-os/entitlements/` in the slice |
| Docs | No backslash in this workplan or in the requirement's added lines |

**Tests run by SA:** `npx jest app/admin/analytics app/api/admin/token-usage app/admin/components/layout app/admin/components/__tests__ lib/admin/health app/admin/business-os-llm app/admin/users --ci`: 59 suites, 1,748 tests passed. `npx jest app/admin/audit-trail app/admin/__tests__ app/admin/finance lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: 31 suites, 678 tests passed (Jobs pins, Audit trail, tailwind escape guard included). Inbound link builders and their tests are unedited and pass.

### Code Review Comments

| # | Where | Comment | Priority |
|---|---|---|---|
| — | — | No must-fix and no should-fix | — |

### Notes (no action required)

- **N-1** `adminWindow.ts:61` (`INSTANT`): the page drops instants whose offset is written `+0300` or `+03`, which the route's zod accepts. Narrower, never a 400, and no builder emits them (Health uses `toISOString`). Already ruled acceptable at the workplan stage; recorded for L-2b / later pages.
- **N-2** §3.6 says "nothing green on this page after L-2a"; true for the KPI strip and the bar only. The table, Top consumers and the agent panel in the L-2b half still use green / emerald (`page.tsx:360`, `:537`, `:572-576`, `:592`, `:614`, `:629`, `:666`, `:759`). L-2b owns them; the PR text should not claim the whole page.
- **N-3** `page.tsx:247-250`: the tile `href` is built from the raw `filters`, the request from `effective`. They differ only for one render on a stale Business OS link, before the normalise write-back converges. Harmless.
- **N-4** No newest-wins guard on the fetch (workplan N-1, unchanged behaviour).
- **N-5** Requirement §1 rows 4 and 4a still say "PR #292 / #293 open" although both are on `origin/main`. Not this slice's edit; RM may refresh them with row 6 at commit.

### Optimisation Suggestions

- L-2b: drop the three pre-existing unused names in `page.tsx` (`DollarSign`, `BarChart3`, `availableFilters`) when it rewrites that half.

### Code Approved for QA: Yes

## QA Testing Report

## QA Report — 2026-10-11

**QA — 2026-10-11** (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l2a`, uncommitted code as handed over, after SA code review)
**Test mode:** full
**Strategy used:** A + B (Jest unit and jsdom render, incl. throwaway probe tests against the real page) + scoped `tsc`; D (browser) listed for TL below. Playwright is not installed.
**Focus:** ui, api (request params), schema (route Zod parity)
**Skipped:** live browser run (TL owns it, checklist below)
**Input source:** prompt keywords (TL trigger) + workplan §4.2, §7

### Commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/analytics app/api/admin/token-usage app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/business-os-llm app/admin/users app/admin/finance lib/admin/health lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **86 suites, 2,366 tests, all passed** (100 s). (Dev's 90 / 2,426 also included `app/admin/components/__tests__`.) |
| 2 | `npm run test:bos-entitlements` | **6,382 tests passed**, exit 0 |
| 3 | Scoped `tsc` (scratch tsconfig in the session scratchpad, `extends` the worktree tsconfig, `incremental: false`; includes the shared layout folder + tests, `adminWindowPresets.ts`, `components/ui/sheet.tsx`, `app/admin/analytics/**`, `app/admin/audit-trail/**`, `JobsQueuesView.tsx`, `HealthGrid.tsx`, `ownerText.guard.test.ts`). Run 1 with a canary scratch file (`const canary: number = 'x'`, importing `analyticsFilters`) | 20 errors: the canary's `TS2322` plus 19 in `page.tsx`. None in any other file |
| 4 | Same, canary file deleted | **19 errors, all in `app/admin/analytics/page.tsx`; zero in any other file the slice touched** (shared folder, `analyticsFilters.ts`, `analyticsTypes.ts`, both components, Jobs / Health / Audit trail consumers, tests) |
| 5 | `origin/main`'s `page.tsx` (+ its `linkedWindow.ts`) type-checked from a scratch copy | Same 19 messages (16 × `unknown` → `ReactNode`, 3 × `{}` → `ReactNode`) on the **same 19 source lines** (diffed line text: identical). The 3 extra `TS2307` there are module-resolution noise from the scratch location. Pre-existing L-2b debt, not introduced here |
| 6 | Throwaway probe suite `app/admin/analytics/__tests__/zzqa.probe.render.test.tsx` (35 cases, real page, same harness as `analytics.layout.render`, same `afterEach` invariants: no `pushState`, every `replaceState(null, …)`, no picker read on mount, no refused BOS request) | **35 / 35 passed**; one probe documents bug B-1. File deleted; `git status --short` identical before and after |

### Edge cases probed

| Case | Result |
|---|---|
| Health `analyticsLink` (built exactly as `evaluateHealth.ts:409-412`, ISO `Z` with and without ms) | ✅ exactly one request, query string **byte-identical** to `origin/main`'s param building (`breakdownBy=provider&scope=bos&dateFrom=…&dateTo=…`, no `period`) |
| BusinessOsPanel `?scope=bos&user=<id>`; `cutoverLinks(id)` and `cutoverLinks(null)` (real import); sidebar `/admin/analytics` | ✅ one request each, byte-identical to main (`…&user=<id>&period=30` / `…&period=30`) |
| Reload of the rewritten Health URL (`range=custom&from=<ISO>&to=<ISO>`) | ✅ same request as the original link, linked chip shown |
| Legacy date-only `dateFrom=2026-09-25&dateTo=2026-09-26` | ✅ custom: `2026-09-25T00:00:00.000Z` / `2026-09-26T23:59:59.999999Z`, URL `?range=custom&from=2026-09-25&to=2026-09-26`, one request. Reversed date pair → ignored |
| Minute form; one-sided `dateFrom` only; one-sided `dateTo` only; `range=custom&from=` only | ✅ ignored: `period=30`, URL clean, identical to main |
| Mixed offsets: `+03:00` from vs `Z` to, string order wrong but time order right | ✅ linked, sent verbatim (matches main) |
| Mixed offsets: string order right, time order reversed; reversed `Z` pair | ✅ ignored (matches main) |
| Scope All → BOS from `scope=all&account&category=memory&group_by=agent&provider&agent&execution` | ✅ one request `breakdownBy=provider&scope=bos&provider=openai&user=<id>&period=30` (agent, execution, category gone; provider and business kept, as main); URL `?account=<id>&provider=openai`; back to All restores nothing |
| Category tile click / second click / Ctrl-Meta-Shift click | ✅ (existing R-11 / R-12; alt and right button at `KpiStrip` unit level) |
| Clear | ✅ resets scope, window, group by (existing R-14) |
| Each breadcrumb level (M-1): from `scope=all&range=7d&group_by=feature&provider&model&activity&account&agent` click "gpt-x", then "openai", then "All Data" | ✅ deeper keys and business dropped each time; `scope`, `range=7d`, `group_by` kept; one request per click |
| Business arriving by link dropped by a breadcrumb | ✅ as main |
| Drill provider → model → activity (BOS) | ✅ one request per click, URL tracks, chips show row labels, BOS never goes to `agent` |
| Reload after a drill | ✅ same request, chip shows the raw value |
| Same request after a URL write: Total spend tile with group by already provider; Calls tile clicked twice | ✅ no second request |
| 24 hours / 7 days / 90 days → `period=1` / `7` / `90`; Today / This month → whole-day UTC instants; Custom → whole UTC days | ✅ each parsed through a copy of the route's window rules (`z.string().datetime({ offset: true })`, `period` 1 to 365, from ≤ to): all accepted. Second click on a pressed button → back to 30 days, URL clean |
| Custom: From only / To only → Apply disabled (`requireBothDates`); From after To → shared alert, no request | ✅ |
| Business picker: no read on mount; focus → list; pick → `user=<id>` request, `?account=<id>`, chip "Business: Acme Dental" | ✅ |
| Every chip (business, category, provider, model, activity, request type, feature, component, endpoint, agent, execution) | ✅ each X named "Remove …", removes only its key, one request per removal; ends at `?scope=all` |
| 400 → page sentence; 403 → session copy; non-JSON → fixed fallback; network → network copy (existing); **401** → "Your admin session has ended. Sign in again." in `role="alert"`, header + bar kept, strip hidden (probe) | ✅ |
| Later read (filter change with a pending response): header, strip, bar, content kept; content grid `aria-busy="true"`; Refresh `aria-busy="true"` | ✅ |
| Amber Total spend only with `possiblyIncomplete` (existing); no `emerald` / `green` anywhere in the strip or bar markup, both scopes (probe; the L-2b half still has green, SA N-2) | ✅ |
| Call row → "Call Details" modal; All-scope agent panel expands ("Hide details") | ✅ L-2b half still works |
| **After an error, the next read (filter change, Refresh or Try again)** | ❌ **B-1** below |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| One h1 "AI cost & usage", no "BI System" | ✅ |
| Strip children are `<a>` (filter tiles) or `div role="group"` (Avg cost per call); no buttons in the strip, both scopes | ✅ |
| Scope switch accessible name "Scope Business OS only", `aria-checked` | ✅ |
| Group by: native select labelled "Group by" | ✅ |
| Filter bar `role="search"` named "Filters" | ✅ |
| Refresh named "Refresh AI cost and usage", `aria-busy` while reading | ✅ |
| Errors in `role="alert"` (route error, 401, 403, network, From after To) | ✅ |

### Issues Found

#### Bugs (must fix before commit)

1. **B-1: after a failed read, the next read shows made-up zeros ("$0.00" tiles and "No data found")** — File: `app/admin/analytics/page.tsx` (`fetchData` → `fail`, `showContent`, `AnalyticsKpis firstLoad`) — Severity: **Medium**
   - Steps to reproduce: open the page (the first read succeeds) → the next read fails (500, a network blip, 403) → click Try again or Refresh, or change any filter, while the new read is in flight.
   - Expected (§5.10, K-10): no figures until data has been read: KPI placeholders and "Reading AI cost and usage…" (after an error there is no current content to keep). `origin/main` showed its spinner in this case (`if (loading && items.length === 0)`).
   - Actual: `fail()` zeroes `items` / `totals` but `hasLoaded` stays `true`. As soon as `setError(null)` runs, the strip renders figures that look real (`Total spend, $0.00`, `Calls 0`, …), the table shows "No data found", and Quick stats shows zeros, for as long as the request takes (the drill-down route can take seconds). Probe output: `{"total":"Total spend, $0.00","loadingStatus":"absent","noData":true}`.
   - Suggested fix: in `fail`, also `setHasLoaded(false)`, so the next read shows the placeholders and "Reading…". Add one render test: success → 500 → Try again with a pending response → placeholders and "Reading AI cost and usage…", no "$0.00".

#### Performance Issues (should fix)

None. One request per distinct query confirmed on every inbound link, the alias rewrite, the normalise write-back, tile clicks on the applied group by, and drill clicks.

#### Edge Cases (nice to fix)

1. **E-1 (pre-existing, SA N-4):** no newest-wins guard. Two quick tile clicks (for example Memory, then Execution) can let the slower, older response overwrite the newer view while the URL and the tile say otherwise. Same as `origin/main`; a ref counter would close it.
2. **E-2:** `?account=junk&user=<uuid>` uses neither value. The hook reads the non-empty canonical key, which is then refused, and does not fall back to the alias. No builder emits this; noted only.

### Browser checks for TL (signed-in admin, light AND dark scheme emulation, DevTools Network open)

Workplan §7.1 A-B1 to A-B16 stand as written. Additionally:
- **A-B17 (B-1 re-check after the fix):** load the page, set DevTools offline, click Refresh (network alert), go back online, click Try again. Tiles show placeholders and the content shows "Reading AI cost and usage…" until the data arrives. No "$0.00" or "No data found" may flash.
- **A-B18:** in the All scope, Tab to a category tile and press Enter. It applies in place (no page reload, the URL gains `category=`). Shift+Enter or Ctrl+Enter opens the href in a new window or tab instead.
- **A-B19:** after a drill (A-B8), right-click a KPI tile → Copy link, and paste it into a new tab. The same filtered view opens.
- **A-B20:** in light and dark, the scope switch, the pressed window buttons, the selected category's purple ring and the amber Total spend stay readable, and there is no green on the strip or the bar.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit (B-1, Medium; a small fix plus one test). Everything else passes. The QA re-check after the fix covers B-1 plus a re-run of `npx jest app/admin/analytics --ci`

**Verdict: FAIL** (one Medium bug, B-1). No High bugs. Once B-1 is fixed and its test is green, QA expects PASS.

### QA re-check — 2026-10-11

**Scope:** B-1 only, plus the analytics and shared-layout suites. The fix: `fail()` in `page.tsx` now also calls `setHasLoaded(false)` (see "QA B-1 fix" under Implementation Notes).

| Check | Result |
|---|---|
| Throwaway probe `zzqa.recheck.render.test.tsx` (17 cases). Three failure kinds (500, network rejection, 403) × five triggers (Try again, Refresh, Group by change, scope switch, window button). Each case: success, then the failure, then the trigger with the next read held open | ✅ 15 / 15. While the read was pending: KPI placeholders, `role="status"` "Reading AI cost and usage…", no Total spend tile, and no "$0.00", "No data found" or Quick stats. The h1 and the filter bar stayed. Once the held read resolved: placeholders and status gone, "Total spend, $1.50", Quick stats back, no "No data found" |
| No regression: success, then a filter change with a pending read | ✅ current content kept (no placeholders), content grid `aria-busy="true"` |
| First read fails, then Try again succeeds | ✅ renders normally |
| `npx jest app/admin/analytics app/admin/components/layout --ci` | ✅ **22 suites, 558 tests, all passed** (Dev's new B-1 test included) |
| Clean-up | Probe file deleted; `git status --short` shows the same 24 entries as before and no `zzqa` file. Nothing stashed or committed by QA |

B-1 is closed. Nothing else from the first report is open (E-1 and E-2 are notes, not fixes).

**Final verdict: PASS.** Ready for RM (fast-track). TL's browser checks A-B1 to A-B20 still apply, A-B17 included.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Workplan written | Dev. Awaiting SA workplan review (full cycle, R-7) |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS. Q-1 to Q-15 ruled (one slice with a pre-authorised L-2a1 tripwire; both §3.10 behaviour changes standard-forced, no user question); M-1 to M-4 before code review, S-1 to S-9 at code review |
| 2026-10-11 | Implemented (code complete, uncommitted) | Dev. M-4 edits to this workplan (branch line, §3.10 item 8, V-7 base) and M-1 / M-2 / M-3 notes in §3.5 to §3.7; T-1 to T-11 done; results, deviations, renames and edited tests under Implementation Notes |
| 2026-10-11 | SA code review | CODE APPROVED, no must-fix. M-1 to M-4 and S-1 to S-9 verified; tsc claim re-run and confirmed (19 identical errors on `origin/main`); 90 suites re-run green; notes N-1 to N-5 |
| 2026-10-11 | QA report | QA. Jest subset 86 suites / 2,366 tests green; entitlements 6,382 green; scoped tsc clean outside the 19 pre-existing `page.tsx` errors (identical on `origin/main`); 35 throwaway probes (inbound links byte-identical to main, route Zod parity, M-1 breadcrumbs, chips, picker, states, a11y). **FAIL** on B-1 (Medium): after a failed read, the next read shows $0.00 tiles and "No data found" instead of placeholders |
| 2026-10-11 | QA re-check | QA. B-1 fix verified: 17 probes (500 / network / 403 × Try again, Refresh, filter change, scope switch, window button) show placeholders and "Reading…" while pending, never zeros, then render normally; analytics + layout suites 22 / 558 green. **PASS** |
