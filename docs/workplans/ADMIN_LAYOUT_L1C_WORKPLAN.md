# Workplan: Admin Layout Standard — Slice L-1c (URL filter state, full filter bar and date presets → pilot Audit trail, part 1)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1, §3, §5.3, §5.5, §5.6 (U-1 to U-10 and the inbound-link table), §5.10, §5.11, §5.12, §6.1 (S-1 to S-10), §6.2 (C-2, C-3, C-4, C-5, C-6, C-7, C-8, C-14), §7.3, §9 (F-28, F-29, F-30, F-31, F-34, F-35, F-56, F-73), §10 (D-2, D-3, D-6, D-12, D-15), §12.2, §12.3; SA re-check R-3, R-4, R-11, RC-1, RC-6, RC-7, RC-8; SA-R-1, SA-R-8, SA-R-17, SA-R-18; L-1b workplan §4.2 (N-1 to N-4) and SA L-1b workplan review Q-13 lean ([ADMIN_LAYOUT_L1B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L1B_WORKPLAN.md))
**Branch:** `feature/admin-layout-l1c`, cut from `origin/main` `6e5c4b7e` (includes L-1a #285, L-1b #287, finance #284, flaky-test fix #286). Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Committed 2026-10-11 (1752d93d) — PR #291 open against main, fast-track (SA code review approved, QA pass with notes); awaiting checks + user merge. Browser checks B-1 to B-14 owed
**Path:** full cycle (new shared patterns, CLAUDE.md rule 7)

## Overview

L-1c adds the URL filter state hook (`useAdminFilters`, C-7), the full filter bar (window presets, Custom From/To (UTC) + Apply, a business slot, a page-filters slot, Clear, "Read at" + Refresh, active chips; C-8) and the pure window module that reuses `adminWindowPresets.ts`. It ships them with exactly one pilot, Audit trail part 1 (`/admin/audit-trail`): header, filter bar, URL and states. The content stays cards with the inline expand until L-1d. **RC-8 is applied:** the shared business picker (C-6) moves to L-1d, so the original `audit-trail/BusinessAccountPicker.tsx` sits in bar position 3 for one slice, unchanged (§2.2). No route, request shape, data, permission or action changes; the forced visible changes are listed in §3.10. Estimate: about 4 to 5 days (§9), the top of "a few days".

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary-code-verified-at-6e5c4b7e)
2. [Scope and the RC-8 decision](#2-scope-and-the-rc-8-decision)
3. [Implementation Approach and Component APIs](#3-implementation-approach-and-component-apis)
4. [The URL contract on Audit trail](#4-the-url-contract-on-audit-trail)
5. [The C-14 guard changes](#5-the-c-14-guard-changes)
6. [Tests](#6-tests)
7. [Verification](#7-verification)
8. [Task List](#8-task-list)
9. [Sizing](#9-sizing)
10. [Risks](#10-risks)
11. [Out of scope](#11-out-of-scope)
12. [Questions for SA](#12-questions-for-sa)

---

## 1. Analysis Summary (code verified at `6e5c4b7e`)

### 1.1 Files this slice touches, as they are today

| File | As built (line numbers at `6e5c4b7e`) | L-1c change |
|---|---|---|
| `app/admin/audit-trail/page.tsx` (1,263 lines) | `createLogger` at module scope `:20`, `:27` (client file, F-56); `useAuth` user unused `:285` (F-29); `FilterState` `:98-107` (`action`, `severity`, `dateFrom`, `dateTo`, `searchTerm`, `entityType`, `userId`); `EMPTY_FILTERS` `:109-117`; `filtersFromUrl` `:124-135` read **once** in a `useState` initializer `:300-302`, never written back; `accountFilterLabel` `:168-175` (F-31); one `fetch` `:329` then `response.json()` `:330` with no `response.ok` check (F-34); error `data.error` or `'Failed to fetch audit logs'` `:338`, `:341`; two effects on `[filters]` `:348-355` (F-28); early-return full-page spinner `:476-482`; own `<header>` with h1 "Audit Trail", "System Config" badge (F-30), Export CSV and an icon-only Refresh with `title` only `:487-516`; `ArchivedBeforeNotice` `:519`; filter card `:527-713`: heading "Filters", "BOS AI failures" preset `:532-543` (rose when active), account chip `:544-568` (testid `account-filter-chip`, X `aria-label="Show every account"`, `title` = full id), `BusinessAccountPicker` `:584-587`, Search `:590-603`, Action Type `:606-634`, Severity `:637-650`, two `datetime-local` inputs "From Date" / "To Date" `:655-676`, Entity Type `:679-695`, "Clear All Filters" as the last control `:704-711`; error box `:716-724`; results card with a second "Refresh" `:770-777` (F-35) and pagination `:779-820`; cards `:826-934`; inline expand `:937-1254` | Migrated (§3.8) |
| `app/admin/audit-trail/BusinessAccountPicker.tsx` (342 lines) | `createLogger` `:46-48`; `BUSINESS_SEARCH_PATH` `:51`; one `fetch` + `response.json()` `:128-137`; fetch only once `open` `:157-165` (no mount fetch); hardcoded ids `audit-business-picker` / `audit-business-options`; fixed label "Account" `:217-219`; blue ring `:246`; permanent hint `:336-339` | **Not edited in L-1c** (RC-8, §2.2). Rendered in bar slot 3 |
| `app/admin/components/layout/AdminFilterBar.tsx` (43 lines) | Refresh part only: plain `<div className="flex flex-wrap items-end gap-3">`, Refresh with `aria-label="Refresh {what}"`, `aria-busy`, disabled while busy. Props `onRefresh`, `busy`, `what`. Consumers: `HealthGrid.tsx:90`, `JobsQueuesView.tsx:384` | Full form (§3.4); Health and Jobs render identically (no new prop passed) |
| `app/admin/components/layout/AdminStates.tsx` (57 lines) | `AdminLoading`, `AdminError` (RC-3 testid on the message element) | Gains `AdminEmpty` (§3.6) |
| `app/admin/components/layout/AdminPageHeader.tsx` (36 lines) | `title`, `purpose`, `asOf`; no `badge` / `actions` | Gains `actions` (§3.6). `badge` stays unbuilt: Audit trail has no factual badge (F-30 removes the decorative one) |
| `app/admin/components/layout/readAdminResponse.ts` (66 lines) | OK only when `response.ok && body.success === true`, data = `body.data` | Gains an optional `pick` (§3.6): the audit route returns `logs` and `pagination` at the top level, not under `data` |
| `app/admin/components/layout/adminFormat.ts` (34 lines) | `formatUtc`, `formatCount` | Gains `formatUtcTime` (§3.6, "Read at HH:mm UTC") |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` (387 lines) | `EXPECTED_SOURCES`; S-3 `ALLOWED_EXACT` (react, lucide-react, next/link, next/navigation, ui sheet, ui dialog, logger/client); S-6 already names `useAdminFilters.ts` as the only file allowed to write history; registry = Health, Jobs | §5 |
| `app/admin/components/adminWindowPresets.ts` (86 lines) | Pure, no imports, no `'use client'`. `ADMIN_WINDOW_PRESETS` (`today`, `7d`, `30d`, `this_month`), `ADMIN_WINDOW_CHOICES` (+ `custom`), `resolveAdminWindow(preset, now)` → inclusive UTC dates, `isRealDate`, `todayUtc`, `customRangeProblem` (finance's route rules: 92-day cap, not after today). Imported by `financeUrl.ts`, `FinanceFilterBar.tsx`, the finance route and `lib/business-os/finance/financeWindow.ts` | **Not edited.** Reused through one named S-3 exception (SA Q-13 lean, §5) |
| `app/api/admin/audit-trail/route.ts` + `lib/audit/requestSchemas.ts` | `date_from` / `date_to`: any `Date.parse`-able string up to 64 chars, passed **verbatim** to `.gte` / `.lte('created_at', …)`; `action` / `entity_type` match `^[A-Za-z0-9_]{1,64}$`; `severity` enum `info`, `warning`, `critical`; `user_id` a UUID; `search` up to 200 chars, applied in memory to one page (F-33) | **Not edited.** The page maps its window onto these params (§4.3) |

### 1.2 Inbound links (they must keep opening the same view)

| Source | Exact link today | Verified at |
|---|---|---|
| Health figure links | `/admin/audit-trail?action=…&severity=…&date_from=YYYY-MM-DDTHH:mm&date_to=YYYY-MM-DDTHH:mm` (minute form, UTC wall clock, `toAuditDateParam`) | `lib/admin/health/evaluateHealth.ts:400-407`, `lib/admin/health/windows.ts:49-51`; fixture `app/admin/__tests__/health.render.test.tsx:76` |
| Businesses panel | `/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&user_id=<uuid>` plus `&search=<groupId>` when a group id exists | `app/admin/users/components/BusinessOsPanel.tsx:74-79` |
| Activity cutover notice | `/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29T16:51` plus `&user_id=<uuid>` | `app/admin/business-os-llm/components/activity/CutoverNotice.tsx:22-29`, `activityCopy.ts:77` |
| Audit trail's own keys | `action`, `severity`, `date_from`, `date_to`, `search`, `entity_type`, `user_id` | `page.tsx:124-135` |

None of these link builders is edited (§5.6: emitters move to canonical names only in their own slice).

### 1.3 Existing test facts this plan depends on

| Test | Fact |
|---|---|
| All 9 Audit trail render tests (`accountChipLabel`, `aiCostPrecision`, `businessPicker.render`, `filterDensity`, `presetAndDeepLink`, `resourceAndBusiness`, `searchTotals`, `userEmailFallback`, `userNameAndPlaceholder`) | Each mocks `@/lib/logger` with `createLogger` only (RC-1). Five mock `next/navigation` as `useSearchParams: () => new URLSearchParams(mockSearch)` (a fresh object every render, same string); four do not mock it, so `useSearchParams()` returns `null` outside the App Router (the page's own comment `:286`). Fetch mocks are `{ ok, json }` or `{ ok, status, json }` only |
| `businessPicker.render.test.tsx` | `:389` "filters by the id in the URL on arrival **and leaves the URL alone**" (asserts `window.location.search` still has `user_id`). `:402` "still only asks for the log list and the archive notice on mount" (F-28 pin, SA-R-17). AC-B13 log tests read the calls routed to `record` through the `@/lib/logger` mock. `BUSINESS_SEARCH_PATH` imported from `../BusinessAccountPicker` |
| `filterDensity.render.test.tsx` | `it.each` labels `Account`, `Search`, `Action Type`, `Severity`, `From Date`, `To Date`, `Entity Type` (`:77-91`); "Clear All Filters" clears every filter (`:94-114`); "Clear All Filters is the LAST control" (`:116-127`) |
| `presetAndDeepLink.render.test.tsx` | Preset by testid `preset-bos-ai-failures`; error shown from `{ ok: false, body: { error: 'Failed to fetch audit logs' } }`; deep link first request contains `user_id=`; chip testid `account-filter-chip` contains the short id; X by label "Show every account" |
| `accountChipLabel.render.test.tsx` | Chip testid `account-filter-chip`; name from loaded rows (business name, then `users.email`, then `users.full_name`, else short id); full id in a `title` inside the chip; exactly one list request |
| `filterOptions.guard.test.ts` | Source pins on `page.tsx`: option values only `all` + the three severities; `@/lib/audit/filterOptions`, `buildActionFilterGroups({ audiences: OPERATOR_AUDIENCES })`, `AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED` (never the literal), `interface AiActionDetailsView`, the AI-entry guards |
| `businessPicker.contract.test.ts` | `PICKER` = the original path; walks `app/admin/audit-trail`, `app/api/admin/audit-trail`, `lib/audit` for `lib/business-os` module edges (at least 8 files) |
| `app/admin/components/layout/__tests__/AdminFilterBar.render.test.tsx` | Refresh name, `aria-busy`, no `search` / `region` role, "shows no Read at" — all with only `onRefresh` / `busy` / `what` |
| Health and Jobs | `health.render`, `health.layout.render`, `jobsQueues.render`, `jobsQueues.layout.render` render `AdminFilterBar` with the three L-1a props only, and pin no `search` role |

### 1.4 The finance page divergence (read only; `app/admin/finance/**` is not edited)

`financeUrl.ts` and `FinanceView.tsx` (PR #284) keep their own URL contract: keys `preset`, `from`, `to`, `accountId` (not U-5's `range` and `account`); `preset` is written even at its default (U-3 omits defaults); writes go through `router.replace` (Q-2 says `history.replaceState` inside `useAdminFilters` only); an invalid link shows a notice and resets everything (U-4 ignores a bad value silently, per filter). `FinanceFilterBar.tsx` imports the original picker (N-4). This is recorded for the finance adoption slice, which can read `preset` / `accountId` as aliases of `range` / `account` with no break to existing links. Q-14 proposes a §9 row.

### 1.5 Logging (CLAUDE.md "non-compliant files you touch")

`page.tsx` has no `console.*`. It calls `createLogger` in a client file (F-56); it is converted to `clientLogger.child({ module: 'AdminAuditTrailPage' })` because it is touched (SA Q-6), which forces the RC-1 test mocks. `BusinessAccountPicker.tsx` is not touched in L-1c, so its `createLogger` stays until the shared picker replaces it on this page (L-1d).

---

## 2. Scope and the RC-8 decision

### 2.1 In L-1c

| Area | In L-1c |
|---|---|
| Shared folder, new | `useAdminFilters.ts` (C-7: the hook, `textFilter`); `adminWindow.ts` (C-8 pure: window value, `windowFilter`, `resolveWindow`, labels, linked-window wording; reuses `adminWindowPresets.ts`); `DatePresets.tsx` (C-8: the Window segmented control + Custom From/To (UTC) + Apply + inline error); tests for each |
| Shared folder, extended | `AdminFilterBar.tsx` (C-8 full form: `role="search"` when it holds controls, window, business slot, page-filters slot, Clear, `readAt`, active chips); `AdminStates.tsx` (`AdminEmpty`, C-3, deferred from L-1a/L-1b); `AdminPageHeader.tsx` (`actions`, deferred from L-1a); `readAdminResponse.ts` (`pick`); `adminFormat.ts` (`formatUtcTime`) |
| Guard | `layoutFolder.guard.test.ts`: expected files, the one named S-3 exception plus its C-14 check, S-6 non-vacuous, registry entry for Audit trail (§5) |
| Pilot | `app/admin/audit-trail/page.tsx` (header, bar, URL, states, logger); new `app/admin/audit-trail/auditTrailFilters.ts` (the page's filter spec and its request-param builder, pure) |
| Tests edited | RC-1 logger mock in the 9 Audit trail render tests; `businessPicker.render` `:389`; `filterDensity.render` (date labels, Clear position); `AdminFilterBar.render` (additions only) — exact edits in §6.2 |
| Tests new | `adminWindow.test.ts`, `useAdminFilters.render.test.tsx`, `DatePresets.render.test.tsx` (shared); `auditTrailFilters.test.ts`, `auditTrail.layout.render.test.tsx` (pilot) |
| Docs | Requirement §1 (status, deferrals); §9 F-97 if SA agrees (Q-14) |

### 2.2 RC-8: the shared business picker moves to L-1d

**Decision: apply RC-8.** L-1c without the picker is already about 4 to 5 days (§9): a new hook with a subtle re-read rule, a full filter bar with presets and a custom range, a 1,263-line page and 11 test files. The picker generalisation (342 lines, `useId`, `label` / `hint` props, purple ring, `clientLogger`, the chip, `readJsonBody` instead of `.json(`) plus its test fallout (RC-7 contract re-pointing, the AC-B13 log routing, the `BUSINESS_SEARCH_PATH` import, the "Account" label pin, the chip rename) adds about a day, which would take the slice past "a few days" (§3 rule 3).

What moves to L-1d, to be named in L-1d's PR (§7.3 pre-authorises it):

| Moves to L-1d | Why it moves with the picker |
|---|---|
| C-6 `AdminBusinessPicker` (label "Business", `useId`, Escape, arrows, pasted UUID, RC-6 no mount fetch) | The component itself |
| The "Business: {name} [X]" chip and F-31 (`accountFilterLabel` ordering and `user_email`) | C-6 says the chip belongs to the picker; changing the chip twice would edit the same tests twice |
| RC-7 (`businessPicker.contract.test.ts` covers the shared picker and keeps covering the original until L-8) | Nothing to cover until the shared picker exists |
| F-56 for the picker | The original file is not touched in L-1c |
| `filterDensity` "Account" → "Business"; `businessPicker.render` imports `BUSINESS_SEARCH_PATH` from the shared picker; chip testid and X label edits in `accountChipLabel`, `presetAndDeepLink`, `businessPicker.render` | Test edits caused by the picker swap |
| The L-1c line of §12.2 about the picker | Becomes an L-1d criterion |

**Interim state (one slice):** bar slot 3 renders the original `BusinessAccountPicker` unchanged (label "Account", its own hint and blue ring), in a fixed-width wrapper. The account chip keeps its exact text ("Account {label}"), its X label ("Show every account"), its `title` and its testid, and moves into the bar's active-chips row (§5.5 part 7) as a generic chip. The URL key becomes `account` (with `user_id` as the read alias) in L-1c, because that is the hook's job, not the picker's.

### 2.3 Deferred exports (recorded in §1 by Dev, SA-R-3 rule)

| Export | First consumer |
|---|---|
| `AdminNotice` (amber notice) | L-1d: the search caveat ("Search scans only the current page…") becomes a notice with the count line, which L-1d restyles. Nothing amber on Audit trail part 1 |
| `formatUtcDate` | No consumer in part 1 (custom dates are native inputs; the linked chip uses `formatUtc` or the verbatim minute). Expected L-1d (table time column) or later |
| `AdminPageHeader` `badge` | First page with a factual badge ("Read-only", "Runs off") |
| `AdminFilterBar` window **extras** (D-2 (b): `yesterday`, `this_week`, `last_week`, `last_month`, `24h`, `90d`) | Audit trail has no window extras. First consumer L-2a (AI cost & usage), L-8 or L-9; `DatePresets` takes them as an additive prop then |
| `KpiTile` same-page filter mode | L-2a (unchanged, R-7) |

---

## 3. Implementation Approach and Component APIs

All shared `.tsx` files start with `'use client'`. `useAdminFilters.ts` and `adminWindow.ts` are plain modules (the guard requires `'use client'` for `.tsx` only). Shared files import only from the S-3 allow-list plus the one named exception (§5). Explicit slate classes (T-1, T-2); meaningful text slate-400 or lighter (T-5); purple accent (T-7); focus ring `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500` (A-1); no `<section>`, no `role="region"` (A-9); no `cn()` (S-9). No shared file in L-1c logs.

### 3.1 `adminWindow.ts` (C-8, pure)

```ts
import {
  ADMIN_WINDOW_PRESETS, isRealDate, resolveAdminWindow, type AdminWindowPreset,
} from '@/app/admin/components/adminWindowPresets';

/** What the Window control holds. */
export type AdminWindowValue =
  | { kind: 'none' }                                              // no window: every date (Audit trail's default)
  | { kind: 'preset'; preset: AdminWindowPreset }                 // U-6 standard set
  | { kind: 'custom'; from: string | null; to: string | null }    // whole UTC dates, at least one set
  | { kind: 'linked'; from: string | null; to: string | null };   // minute form or ISO instant, verbatim (U-7)

export const ADMIN_WINDOW_LABELS: Record<AdminWindowPreset | 'custom', string>;
  // Today, 7 days, 30 days, This month, Custom

/** One filter field owning the keys range, from, to (U-5, U-6, U-7). */
export function windowFilter(options: {
  defaultValue: AdminWindowValue;
  /** Legacy names, read forever and never written (U-9), e.g. date_from → from. */
  aliases?: Readonly<Record<string, 'from' | 'to'>>;
}): AdminFilterField<AdminWindowValue>;

/** The dates or bounds a value means at `now`. Pages map this onto their own server params (U-8). */
export type ResolvedWindow =
  | { kind: 'none' }
  | { kind: 'dates'; from: string | null; to: string | null }     // inclusive UTC calendar dates
  | { kind: 'linked'; from: string | null; to: string | null };   // verbatim
export function resolveWindow(value: AdminWindowValue, now: Date): ResolvedWindow;

/** "Linked window 2026-10-10 09:00 to 2026-10-11 09:00 UTC" (one-sided: "from … UTC" / "up to … UTC"). */
export function linkedWindowLabel(value: { from: string | null; to: string | null }): string;

export function windowEquals(a: AdminWindowValue, b: AdminWindowValue): boolean;
```

**Parsing** (`windowFilter`'s `parse`, after the hook has applied the aliases):

| Input | Result |
|---|---|
| `range` is one of the four presets | `{ kind: 'preset' }`. Any `from` / `to` is dropped (the URL is rewritten without them) |
| `from` / `to` present, `range` absent, `custom`, or not a known value | `range=custom` implied (U-7). Each bound is classified: a **date** (`YYYY-MM-DD`, `isRealDate`), a **minute** (`YYYY-MM-DDTHH:mm`, a real date and 00:00 to 23:59), an **instant** (ISO with seconds optional, fraction optional, and `Z` or a `+HH:MM` / `-HH:MM` offset; `Date.parse` finite). A bound of any other form is ignored (U-4) |
| Every present bound is a date | `{ kind: 'custom' }`; if both are present and `from > to`, both are ignored (U-4) and the value is the default |
| Any present bound is a minute or an instant | `{ kind: 'linked' }`, bounds kept **byte for byte** (U-7, SA-R-1). No ordering check: the route has always been given these as sent |
| `range=custom` with no usable bound, or nothing at all | `undefined` → the field's default |

**Serialising:** default → nothing (U-3). `preset` → `range=<id>`. `custom` and `linked` → `range=custom` plus `from` / `to` for the bounds that are set, verbatim. `none` (when it is not the page default) → nothing: no page in L-1c has another default, so this branch is pinned by a unit test only.

**`resolveWindow`:** `preset` → `resolveAdminWindow(preset, now)` (inclusive UTC dates; U-8: Today = today, "N days" = the last N UTC calendar days including today, This month = the 1st to today). `custom` → its dates. `linked` → its raw bounds. This replaces C-8's "reuses `activityPresets.ts`" (SA Q-13 lean; doc correction in §12 Q-2).

**`linkedWindowLabel`:** a date shows as is; a minute shows with the `T` replaced by a space (it is already a UTC wall clock, `windows.ts:47`; it is never passed through `Date`, which would read it as local time); an instant shows as `formatUtc(instant)` without its trailing " UTC" (so "+02:00" values show in UTC, F-58 discipline). One "UTC" ends the sentence.

### 3.2 `useAdminFilters.ts` (C-7)

```ts
export interface AdminFilterField<V> {
  /** Canonical URL keys this field owns (U-5). */
  keys: readonly string[];
  /** Legacy key → canonical key. Read forever, never written (U-9). The canonical key wins when both are present. */
  aliases?: Readonly<Record<string, string>>;
  defaultValue: V;
  /** `get` returns a canonical key's value after aliasing, or null. Undefined = absent or invalid → default (U-4). */
  parse: (get: (key: string) => string | null) => V | undefined;
  /** Canonical keys → values. Never called for the default (U-3) or for a page-only field. */
  serialise: (value: V) => Readonly<Record<string, string>>;
  /** SA-R-8 / D-6: held in state, read from an inbound link, never written. */
  pageOnly?: boolean;
  /** Default: Object.is. */
  equals?: (a: V, b: V) => boolean;
}

export type AdminFilterSpec<S> = { readonly [K in keyof S]: AdminFilterField<S[K]> };

export interface AdminFilters<S> {
  filters: S;                                  // identity-stable: a new object only when a value changed
  setFilters: (patch: Partial<S>) => void;     // applies at once and writes the URL by replace
  clear: () => void;                           // every field to its default (page-only included)
  isDefault: boolean;                          // drives Clear's disabled state
}

export function useAdminFilters<S extends Record<string, unknown>>(spec: AdminFilterSpec<S>): AdminFilters<S>;

/** One string param: empty means absent; `isValid` false means ignored (U-4). */
export function textFilter(options: {
  key: string; defaultValue: string; aliases?: readonly string[];
  isValid?: (raw: string) => boolean; pageOnly?: boolean;
}): AdminFilterField<string>;
```

**Behaviour, rule by rule:**

| Rule | How |
|---|---|
| First state (no extra render, no extra request) | `useState(() => parseAll(searchParams))`, so the page's first fetch sees the URL's filters exactly as `filtersFromUrl` did. `useSearchParams()` returning `null` (outside the App Router, as in 4 existing tests) means every field takes its default and nothing is written |
| Aliases (U-9) | `get(key)` returns the canonical key's non-empty value, else the first non-empty alias mapped to it. The canonical key wins when both are present |
| Invalid values (U-4) | A field whose `parse` returns `undefined` takes its default. The page never throws on a link |
| Write (U-2, Q-2) | One effect on `[filters]`: build the projection from `window.location.search` (delete every key and alias the spec owns, keep everything else in its order, e.g. `tab`), append each non-default, non-page-only field's `serialise` output in spec order; keep `window.location.hash`. If the resulting path + search + hash differs from the current one, set `lastKnown` to the new search string and call `window.history.replaceState(null, '', url)` (SA M-1: with `null`, Next 14.2 copies its own keys onto the entry and syncs `useSearchParams`). Never `pushState`, never `router.replace`. This one path covers the mount rewrite of aliases, the clean-up of invalid values and every later change |
| Defaults omitted (U-3) | `serialise` is never called for a value equal to its default; Clear therefore removes every filter param and keeps `tab` |
| Page-only (SA-R-8) | Parsed from an inbound link, never serialised; its key is deleted from the projection, so an inbound `search` leaves the address bar after the first render (Q-6) |
| Re-read only on an outside change (Q-2 ruling, SA M-1) | `incoming = searchParams?.toString()`. **One** `lastKnown` ref: set synchronously from the first `incoming`, just before each write, and to `incoming` on each re-read. An effect on `[incoming]` re-parses iff `incoming !== lastKnown` (our own write echoed by Next is skipped; Back to an earlier written URL after an outside reset is re-read). The re-parse covers **every** field, page-only included (search goes to its default unless the new URL carries it), and sets state only for fields that differ (`equals`), so identity holds. Tests never depend on `useSearchParams` updating after a write |
| Identity | `setFilters(patch)` returns the previous object when every patched field `equals` its current value. The page's `useEffect([filters])` (F-28) therefore fires exactly as often as today |

The file is the only one in the folder allowed to call `history.replaceState` (S-6, already in the guard). It imports `useSearchParams` from `next/navigation` and React only.

### 3.3 `DatePresets.tsx` (C-8)

```ts
export interface DatePresetsProps {
  value: AdminWindowValue;
  onChange: (next: AdminWindowValue) => void;
}
export function DatePresets(props: DatePresetsProps);
```

- `role="group" aria-label="Window"`; buttons Today, 7 days, 30 days, This month, Custom, each `type="button"` with `aria-pressed`; active `bg-purple-500/20 text-purple-200`, inactive `text-slate-300 hover:bg-slate-800` (CostsTab / Activity). With `none` or `linked`, no button is pressed (the linked window shows as a chip, §3.4).
- A preset click calls `onChange({ kind: 'preset' })` at once and **discards any unapplied typed dates**; the inputs show the applied values (F-73).
- Custom click opens the range row (local UI state; nothing is applied yet). The inputs start from the applied custom dates, or from the applied preset's resolved dates, else empty.
- Range row: two native `<input type="date">` labelled **"From (UTC)"** and **"To (UTC)"** (visible `<label htmlFor>`, `useId` ids, `[color-scheme:dark]`), and **"Apply"**. Apply is disabled while both are empty. One-sided is allowed (today either `datetime-local` could be used alone). If both are set and From is after To: an inline `role="alert"` "The start date must not be after the end date" (the same words as `customRangeProblem`) and `onChange` is not called, so nothing is fetched. The finance-only rules of `customRangeProblem` (92-day cap, not after today) are **not** applied: they are the finance route's rules, not the audit route's (Q-11).
- The applied custom value is `{ kind: 'custom', from, to }` with empty inputs mapped to `null`.

### 3.4 `AdminFilterBar.tsx` (C-8 full form)

```ts
export interface AdminActiveChip {
  key: string;
  /** Visible text, e.g. "Account Acme Dental" or "Linked window … UTC". */
  label: string;
  /** Optional hover text on the label (the full id). */
  title?: string;
  testId?: string;
  /** "Remove {filter}" (§5.5 part 7); a page may keep an existing pinned label. */
  removeLabel: string;
  onRemove: () => void;
}

export interface AdminFilterBarProps {
  onRefresh: () => void;            // unchanged
  busy: boolean;                    // unchanged
  what: string;                     // unchanged
  /** ISO time of the last successful read: "Read at HH:mm UTC" (§5.5 part 6). Omit beside a server "As of". */
  readAt?: string | null;
  /** Part 1 + 2. Time-windowed pages only. */
  windowControl?: { value: AdminWindowValue; defaultValue: AdminWindowValue; onChange: (next: AdminWindowValue) => void };
  /** Part 3: the business picker. */
  business?: ReactNode;
  /** Part 4: the page's own labelled native controls. */
  children?: ReactNode;
  /** Part 5: Clear is rendered when set; disabled when `canClear` is false. */
  onClear?: () => void;
  canClear?: boolean;
  /** Part 7: chips the controls cannot show at a glance. */
  chips?: readonly AdminActiveChip[];
}
```

- **Role.** `role="search" aria-label="Filters"` only when any of `windowControl`, `business`, `children`, `onClear` is passed; otherwise the exact L-1a plain `<div>` (Health and Jobs pass none of them, so their DOM is unchanged and their pins hold).
- **Order** (fixed, §5.5): `DatePresets` → business slot → `children` → Clear (text button "Clear", `disabled={!canClear}`) → `ml-auto` group with "Read at HH:mm UTC" (`text-xs text-slate-400`, only when `readAt` is set) and the unchanged Refresh button. The chips row renders below as a second line inside the same bar element, only when there is at least one chip.
- **Linked-window chip.** When `windowControl.value.kind === 'linked'`, the bar adds its own chip first: label `linkedWindowLabel(value)`, `removeLabel="Remove linked window"`, `testId="linked-window-chip"`; removing it calls `onChange(defaultValue)` (U-7: back to the page default).
- **Chip markup:** `<span data-testid>` → `<span title>{label}</span>` → `<button type="button" aria-label={removeLabel}>` with `X` (`aria-hidden`). Classes `inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200`; the X keeps a 20 px target.
- Field-label class for pages, exported as a constant so page labels match: `ADMIN_FIELD_LABEL = 'block text-[11px] text-slate-400 mb-1'` and `ADMIN_FIELD_CONTROL` (native control classes, `[color-scheme:dark]`, purple focus ring).

### 3.5 `auditTrailFilters.ts` (pilot, pure)

```ts
export interface AuditFilters {
  window: AdminWindowValue;  // default { kind: 'none' }
  account: string;           // '' = every account
  action: string;            // 'all'
  severity: string;          // 'all'
  entityType: string;        // 'all'
  search: string;            // '' ; page-only
}

export const AUDIT_FILTER_SPEC: AdminFilterSpec<AuditFilters> = {
  window:     windowFilter({ defaultValue: { kind: 'none' }, aliases: { date_from: 'from', date_to: 'to' } }),
  account:    textFilter({ key: 'account', defaultValue: '', aliases: ['user_id'], isValid: isUuid }),
  action:     textFilter({ key: 'action', defaultValue: 'all', isValid: isIdentifier }),
  severity:   textFilter({ key: 'severity', defaultValue: 'all', isValid: isSeverity }),
  entityType: textFilter({ key: 'entity_type', defaultValue: 'all', isValid: isIdentifier }),
  search:     textFilter({ key: 'search', defaultValue: '', pageOnly: true }),
};

/** The route's query, in today's exact param order. */
export function auditRequestParams(filters: AuditFilters, page: number, pageSize: number, now: Date): URLSearchParams;
```

- Validators mirror the route's schema (the schema's `IDENTIFIER` is not exported, and `lib/audit` stays untouched): identifier = letters, digits and underscore, 1 to 64 characters; severity = `info`, `warning`, `critical`; account = the UUID shape the original picker uses; `search` at most 200 characters (the route's cap) else ignored. A value the route would refuse with a 400 is now ignored on arrival instead (U-4; named in §3.10).
- `auditRequestParams` keeps today's order and names: `action`, `severity`, `entity_type`, `date_from`, `date_to`, `search` (only when `search.trim()` is non-empty, unchanged), `user_id`, `page`, `page_size`. Window mapping (U-8, no API change):

| Resolved window | `date_from` | `date_to` |
|---|---|---|
| `none` | absent | absent |
| `dates` (preset or custom) | `<from>T00:00:00.000Z` | `<to>T23:59:59.999999Z` (SA S-1: `created_at` has microsecond precision) |
| `linked` | the bound verbatim | the bound verbatim |

Whole dates are sent as explicit UTC instants because the route hands the value straight to `.gte` / `.lte`: a bare `2026-10-05` as `date_to` would stop at that day's midnight and drop the whole To day (the exact trap `CUTOVER_AUDIT_DATE_TO` documents), and a `Z` makes the bound UTC whatever the database's timezone (§5.11). Both forms pass the route's `Date.parse` check (Q-5).

### 3.6 Small shared additions

| Export | Shape | Consumer |
|---|---|---|
| `AdminEmpty` (in `AdminStates.tsx`) | `{ message: string; hint?: string; onClear?: () => void; testId?: string }` → `<div className="rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center">`, sentence `text-sm text-slate-200`, hint `text-xs text-slate-400`, a "Clear filters" button only when `onClear` is set | Audit trail empty list |
| `AdminPageHeader` `actions` | `actions?: ReactNode`, rendered right (`flex items-center gap-2`). Refresh never goes here (§5.3) | Export CSV |
| `readAdminResponse` `pick` | `pick?: (body: Readonly<Record<string, unknown>>) => T`; used only on the ok branch, default `body.data`. Failure precedence (§5.10, RC-4) unchanged. Still reads only `ok`, `status`, `json()` (RC-2) | Audit route (`logs`, `pagination` at the top level) |
| `formatUtcTime` (in `adminFormat.ts`) | `"HH:mm UTC"` through `Date` → `toISOString`, em dash for null or invalid | The bar's "Read at" |

### 3.7 What the old picker needs from the bar (interim, RC-8)

The bar's business slot gets `<div className="w-full sm:w-72"><BusinessAccountPicker selectedAccountId={filters.account} onSelect={(account) => setFilters({ account })} /></div>`. The wrapper keeps the picker's permanent hint from stretching the flex row. The picker file is not edited.

### 3.8 Audit trail pilot: `page.tsx`

**Imports.** `@/lib/logger/client`; shared parts through the alias (S-1): `AdminPageHeader`, `AdminFilterBar` (+ `type AdminActiveChip`, `ADMIN_FIELD_LABEL`, `ADMIN_FIELD_CONTROL`), `AdminLoading`, `AdminError`, `AdminEmpty`, `readAdminResponse` + `ADMIN_NETWORK_ERROR`, `useAdminFilters`; `AUDIT_FILTER_SPEC`, `auditRequestParams`, `type AuditFilters` from `./auditTrailFilters`. Dropped: `createLogger`, `FilterState`, `EMPTY_FILTERS`, `filtersFromUrl`, and the icons this slice orphans (`Filter`, `RefreshCw`). F-29's pre-existing unused code (`useAuth` user, `Calendar`, `User`, `getSeverityColor`) is **left** (open, not this slice).

**State.** `const { filters, setFilters, clear, isDefault } = useAdminFilters(AUDIT_FILTER_SPEC)` replaces `useState(filtersFromUrl)`. Every `filters.userId` → `filters.account`, `searchTerm` → `search`, `dateFrom` / `dateTo` → `window`. The two `[filters]` effects stay exactly as they are (F-28, SA-R-17). `readAt` state (ISO) set after each successful read.

**Read loop** (the HealthGrid shape): build `auditRequestParams(filters, currentPage, pageSize, new Date())`; only the `fetch` of `/api/admin/audit-trail?…` sits in the inner `try` (the request string is unchanged); its `catch` logs `{ err }` and shows `ADMIN_NETWORK_ERROR`. Then `readAdminResponse(response, { what: WHAT, sessionEndedCopy: true, pick: (body) => ({ logs: body.logs, pagination: body.pagination }) })` with `WHAT = 'the audit trail'`. Not ok → `setError(result.message)`, rows kept on screen (as today). Ok → `setLogs`, `setPagination` when present (as today), `setReadAt`. `finally` → `setLoading(false)`.

**Render order** (§5.1):

1. `AdminPageHeader` — title **"Audit trail"** (D-3 (a)); purpose kept word for word; `actions` = the Export CSV button, unchanged (F-4 not fixed); no badge (F-30).
2. `AdminFilterBar` — `what={WHAT}`, `busy={loading}`, `onRefresh={() => void fetchLogs()}`, `readAt`, `windowControl={{ value: filters.window, defaultValue: { kind: 'none' }, onChange: (window) => setFilters({ window }) }}`, `business` = the old picker (§3.7), `onClear={clear}`, `canClear={!isDefault}`, `chips` = the account chip when `filters.account` is set: label `Account ${accountFilterLabel(logs, filters.account)}`, `title` = the full id, `testId="account-filter-chip"`, `removeLabel="Show every account"` (all unchanged until L-1d), `onRemove={() => setFilters({ account: '' })}`. Children, in today's order: Search (label "Search", `id="audit-search"`, held by the hook as page-only, applied per keystroke as today, Q-7), Action Type (with the "(hidden from this list)" option kept), Severity, Entity Type, then the "BOS AI failures" toggle (`aria-pressed`, testid kept, purple when active per T-7).
3. `AdminError` (`testId="audit-error"`, `onRetry={() => void fetchLogs()}`) when there is an error.
4. `ArchivedBeforeNotice` (moved from above the filters to above the content; the component is not edited).
5. Content `<div aria-busy={loading}>`: first read in flight with no rows and no error → `AdminLoading what={WHAT}` ("Reading the audit trail…"); otherwise the results card (count line and pagination unchanged, **its Refresh removed**, F-35) and then the cards, or `AdminEmpty` ("No audit events match these filters.", hint "Try a wider window or fewer filters.", `onClear` only when `!isDefault`) when there are no rows and no error.

**Removed:** the early-return spinner (§5.10), the own `<header>`, the "System Config" badge, the header icon Refresh, the filter card shell and its "Filters" heading, the two `datetime-local` inputs, "Clear All Filters", the light-on-dark error box.

**Not changed:** the cards, the inline expand and everything inside it, `getActionIcon`, `formatDate` (local time; §5.11 UTC lands with the table in L-1d), the CSV export, pagination behaviour and its `text-slate-500` lines, the account-label function, `AiActionDetails`, the route.

### 3.9 The mount-request pin (F-28, SA-R-17) — why it holds

| Possible extra request | Why it cannot happen |
|---|---|
| A second list read on mount | The first state is computed synchronously from the URL (as `filtersFromUrl` was); the hook's mount write is a `replaceState`, not a state change; `filters` keeps its identity, so the `[filters]` effects run once, exactly as today |
| A read caused by the URL echo | Next's patched `replaceState` updates `useSearchParams` to the string the hook just wrote, which equals `lastWritten`, so nothing is re-parsed |
| A business-list read | The old picker fetches only once it is opened (unchanged); the shared picker (L-1d) carries RC-6 |
| A read from the bar | No shared part calls `fetch`. Refresh calls the page's `fetchLogs` |

The pin "only asks for the log list and the archive notice on mount" is not edited and is also asserted with an alias link in the new pilot test (§6.1).

### 3.10 Visible changes on `/admin/audit-trail` (all forced by the standard; named in the PR)

1. Title "Audit Trail" → "Audit trail"; the "System Config" pill is gone; Export CSV stays top right.
2. The filter card becomes the standard bar: Window presets **added** (Today, 7 days, 30 days, This month, Custom); no preset is pressed by default and the page still shows every date (Q-3).
3. **Custom range precision (SA-R-18):** From (UTC) / To (UTC) are whole UTC dates with an Apply button, instead of two minute-precision local-time `datetime-local` inputs. A To date now includes that whole UTC day. Inbound minute links (Health tiles, the cutover notice) are still honoured to the minute and show as a "Linked window … UTC" chip with an X. A legacy bare-date `date_to` now includes the whole To day (it stopped at that day's midnight before; SA N-2).
4. Filters are written to the address bar (`range`, `from`, `to`, `account`, `action`, `severity`, `entity_type`), by replace (no Back entries), so a view can be shared by copying its link. Old links (`date_from`, `date_to`, `user_id`) still work and are rewritten to the new names. Search is never written, and a `search` in an inbound link is applied and then dropped from the address bar.
5. A link with a value the page cannot use (unknown severity, malformed id, or a date in another format, e.g. `2026-09-25 10:30` or seconds without an offset, which the old page forwarded because `Date.parse` accepted it; SA M-4) now opens the page with that filter at its default, instead of the route's "invalid query" error or an unvalidated range.
6. One Refresh, in the bar, named "Refresh the audit trail", with "Read at HH:mm UTC" beside it. "Clear All Filters" becomes "Clear", sits before Refresh, and is disabled when nothing is filtered.
7. The account chip keeps its words and moves to a row under the bar. "BOS AI failures" shows its pressed state (purple, `aria-pressed`).
8. Loading no longer blanks the page: header and bar stay, the list area shows "Reading the audit trail…". Errors show in the standard red box with "Try again"; a non-JSON answer shows "Could not read the audit trail. Try again in a moment."; a network failure shows the fixed network sentence; a 401/403 shows "Your admin session has ended. Sign in again." (Q-9). A non-2xx answer is now an error even if its body says success (F-34).
9. The empty list reads "No audit events match these filters." with a "Clear filters" button when filters are on.

---

## 4. The URL contract on Audit trail

### 4.1 Keys

| Canonical key | Field | Default (omitted) | Read aliases | Written |
|---|---|---|---|---|
| `range` | window | absent (no window) | — | yes |
| `from` | window | absent | `date_from` | yes, verbatim |
| `to` | window | absent | `date_to` | yes, verbatim |
| `account` | account | `''` | `user_id` | yes |
| `action` | action | `all` | — | yes |
| `severity` | severity | `all` | — | yes |
| `entity_type` | entityType | `all` | — | yes |
| `search` | search | `''` | — | **never** (page-only) |

Order of written keys: `range`, `from`, `to`, `account`, `action`, `severity`, `entity_type`, after any unrelated params. The route still receives its own names (`date_from`, `date_to`, `user_id`, …), §3.5.

### 4.2 Round trips the tests pin

| Arriving URL (query) | Address bar after mount | First request (date and account params) |
|---|---|---|
| (none) | unchanged | none |
| `action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10:30&date_to=2026-09-26T10:30` (Health) | `range=custom&from=2026-09-25T10%3A30&to=2026-09-26T10%3A30&action=BUSINESS_AI_ACTION_FAILED` | `date_from=2026-09-25T10:30`, `date_to=2026-09-26T10:30` (byte for byte, as today) |
| `entity_type=ai_action&date_to=2026-09-29T16:51&user_id=<id>` (cutover) | `range=custom&to=2026-09-29T16%3A51&account=<id>&entity_type=ai_action` | `date_to=2026-09-29T16:51`, `user_id=<id>` |
| `action=BUSINESS_AI_ACTION_FAILED&user_id=<id>&search=<group>` (Businesses) | `account=<id>&action=BUSINESS_AI_ACTION_FAILED` | `search=<group>`, `user_id=<id>` |
| `date_from=2026-09-25T10:30` (one-sided minute `from`, SA M-4) | `range=custom&from=2026-09-25T10%3A30` | `date_from=2026-09-25T10:30`, no `date_to` |
| `range=7d` | unchanged | `date_from=<today-6>T00:00:00.000Z`, `date_to=<today>T23:59:59.999999Z` |
| `range=custom&from=2026-10-01&to=2026-10-05` | unchanged | `date_from=2026-10-01T00:00:00.000Z`, `date_to=2026-10-05T23:59:59.999999Z` |
| `from=2026-10-05&to=2026-10-01` | cleaned to no window | none |
| `range=bogus&severity=catastrophic&account=nope&action=a'b` | cleaned to nothing | none of them |
| `date_from=2026-09-01&from=2026-09-10` | `range=custom&from=2026-09-10` (canonical wins) | `date_from=2026-09-10T00:00:00.000Z` |
| `tab=x&severity=info` (unrelated key) | `tab=x&severity=info` | `severity=info` |

---

## 5. The C-14 guard changes (`layoutFolder.guard.test.ts`)

| # | Change | Detail |
|---|---|---|
| G-1 | `EXPECTED_SOURCES` | Add `DatePresets.tsx`, `adminWindow.ts`, `useAdminFilters.ts` |
| G-2 | **The one named S-3 exception** (SA Q-13 lean) | `ALLOWED_EXACT` gains `@/app/admin/components/adminWindowPresets`, with a comment naming the ruling and why (a `lib/` file and a route import it, so it cannot move into `layout/`) |
| G-3 | Its safety check | New `it`: `app/admin/components/adminWindowPresets.ts` has **zero** import or export-from specifiers (`specifiersOf(codeOf(...))` is empty) and does not start with `'use client'`. So the exception can never let anything else in |
| G-4 | Self-tests for G-2 | `isAllowedImport('@/app/admin/components/adminWindowPresets')` true; `'@/app/admin/components/adminWindowPresetsX'`, `'@/app/admin/components/adminWindowPresets/x'` and `'@/app/admin/components/health/HealthTile'` false |
| G-5 | S-6 made non-vacuous | New `it`: `useAdminFilters.ts` matches `HISTORY_WRITE` (like the existing `readJsonBody.ts` check); and no file in the folder matches `history.pushState` |
| G-6 | Registry: Audit trail entry | `{ page: '/admin/audit-trail (Audit trail, part 1)', files: ['app/admin/audit-trail/page.tsx', 'app/admin/audit-trail/auditTrailFilters.ts'] }`. The original `BusinessAccountPicker.tsx` is **not** listed: it is unmigrated (it still calls `.json(`) and is replaced on this page in L-1d. Existing per-entry assertions apply (files exist; `AdminPageHeader` imported through the alias; no `<h1`; no `.json(`; alias only) |
| G-7 | Header comment | One paragraph "Amended by L-1c" listing G-1 to G-6 |

The S-2 names (`useAdminFilters`, `adminWindow`, `DatePresets`) are allowed. The new files hold no green, no `--v2-`, no `dark:` (`[color-scheme:dark]` is already covered by the self-test), no `<section>`.

---

## 6. Tests

### 6.1 New

| File | Happy path | Failure path(s) |
|---|---|---|
| `layout/__tests__/adminWindow.test.ts` | Every row of §3.1's parse table; serialise round trip for preset, custom (two-sided and one-sided) and linked (minute and instant, byte for byte); `resolveWindow` with a fixed `now` for each preset including a month boundary (delegates to `resolveAdminWindow`); `linkedWindowLabel` for minute, `Z` instant, `+02:00` instant shown in UTC, one-sided both ways | Garbage bounds, `2026-02-30`, `25:00` minute, `range=custom` with nothing → `undefined`; reversed dates → `undefined`; a minute is never passed through `Date` (a `TZ`-independent assertion: label equals the input with a space) |
| `layout/__tests__/useAdminFilters.render.test.tsx` (harness component; `next/navigation` mocked with a mutable `mockSearch`; `replaceState` and `pushState` spied) | Defaults omitted (no write on a clean URL); `setFilters` writes by `replaceState` with **`null` as the first argument** (SA M-1; the entry carries a Next-like `{ __NA: true }` state, so passing the state along would be caught) and never `pushState`; `tab` and the hash kept; aliases read and rewritten on mount; canonical wins over alias; page-only read and never written (and stripped); `clear` keeps `tab`; an outside change (new `mockSearch` + rerender) re-parses; our own echo does not; Back after a reset (the string returns to an earlier written value) is re-parsed; an outside change resets the page-only search; `filters` identity stable across rerenders (an effect counter on `[filters]` stays 1) | Invalid values ignored and stripped; `useSearchParams` returning `null` → defaults and no write; `setFilters` with equal values → same object, no write |
| `layout/__tests__/DatePresets.render.test.tsx` | `role="group"` named Window, five buttons in order, `aria-pressed` on the active preset only; preset click → `onChange` preset; Custom shows "From (UTC)" / "To (UTC)" date inputs with `[color-scheme:dark]` and Apply; Apply → custom value; one-sided Apply; inputs start from the applied preset's dates | From after To → `role="alert"` and no `onChange`; Apply disabled with both empty; a preset click after typing discards the draft (F-73); `none` and `linked` press nothing |
| `app/admin/audit-trail/__tests__/auditTrailFilters.test.ts` | `auditRequestParams` keeps today's param order and names; window mapping (none, dates → `Z` instants, linked verbatim); `search` only when trimmed non-empty; `user_id` from `account` | Spec validators: bad identifier, unknown severity, non-UUID account, over-long search → default |
| `app/admin/audit-trail/__tests__/auditTrail.layout.render.test.tsx` (pilot; new file so the existing pins stay exact, the `health.layout` / `jobsQueues.layout` precedent; RC-1 mock) | Exactly one level-1 heading "Audit trail" while loading and once loaded; no "System Config"; Export CSV present; exactly one button whose name starts with "Refresh", named "Refresh the audit trail"; "Read at" shown after a read; `role="search"` named Filters; header and bar mounted while the first read is pending, with "Reading the audit trail…"; each §4.2 row (address bar via `window.location.search`, request via the fetch mock); a preset click → one more request with `Z` instants and `range=7d` in the address bar; Custom + Apply; typing a search → request has `search`, address bar never does; Clear → address bar keeps only the unrelated key; linked chip text for the Health and cutover links and its X back to no window; `pushState` never called; the mount pin with the Health alias link (exactly one list request plus the archive notice) | 500 with a non-JSON body → the fallback sentence; rejected fetch → `ADMIN_NETWORK_ERROR` and `logger.error` called; 403 → the session sentence; a failed Refresh keeps the cards on screen; From after To → alert and no extra request; empty list → `AdminEmpty` with "Clear filters" only when filtered |
| Extended: `AdminFilterBar.render`, `AdminStates.render`, `AdminPageHeader.render`, `readAdminResponse.test`, `adminFormat.test` | Bar: `role="search"` only with controls; DOM order window → business → children → Clear → Refresh; Clear disabled by `canClear={false}`, calls `onClear`; "Read at 14:02 UTC" from `readAt`; chips with title and X label; the linked chip from `windowControl` and its X → `defaultValue`. `AdminEmpty` sentence, hint, button only with `onClear`. Header `actions` rendered, still one h1. `pick` on ok. `formatUtcTime` | Bar with only the L-1a props renders no `search` role, no chips row, no Read at (the existing cases, unchanged); no region role in any mode; `pick` not called on a failure; `formatUtcTime(null)` and an invalid value → em dash |

Every new `.render.test.tsx` carries the `@jest-environment jsdom` docblock and asserts with `toBeTruthy()` / `toBe()` (no jest-dom in this repo).

### 6.2 Edited deliberately

| File | Edit | Why |
|---|---|---|
| All 9 Audit trail render tests | Add `jest.mock('@/lib/logger/client', …)` returning `clientLogger.child` → `{ error, warn, info, debug }`. In `businessPicker.render` the four methods route to the file's existing `record`, so the AC-B13 "never logs a name" assertions still see every page log line. The `@/lib/logger` mock stays (the original picker still uses `createLogger`) | RC-1 |
| `businessPicker.render.test.tsx` `:389` | "filters by the id in the URL on arrival and leaves the URL alone" → **"filters by the id in the URL on arrival and rewrites user_id to account by replace"**: first request still has `user_id=<ACME>`; `window.location.search` is `?account=<ACME>` with no `user_id`; `replaceState` called with the prior `history.state`; `pushState` not called; `history.length` unchanged | U-9, R-4 |
| `businessPicker.render.test.tsx` `:198-201` comment | "the URL is a record of arrival and is deliberately never written to" → the URL is the hook's projection; the assertion (next request drops `user_id`) is unchanged | Comment would be false |
| `filterDensity.render.test.tsx` `:77-91` | Remove `From Date` and `To Date` from the `it.each`; add one case: after clicking "Custom", "From (UTC)" and "To (UTC)" are reachable by label. `Account` stays until L-1d | The date inputs are now the standard Custom range |
| `filterDensity.render.test.tsx` `:94-114` | "Clear All Filters" → the "Clear" button (`getByRole('button', { name: 'Clear' })`); the comment about the spinner swapping the card out is removed (the bar stays mounted now); assertions unchanged | §5.5 part 5 |
| `filterDensity.render.test.tsx` `:116-127` | "is still the last control in the card" → **"Clear follows the page filters and precedes Refresh"** (Entity Type, then Clear, then "Refresh the audit trail", by `compareDocumentPosition`) | §5.5 order; §7.3 names this edit |
| `filterDensity.render.test.tsx` header comment | Amended paragraph naming L-1c and the two moves | Audit trail of guard changes |
| `AdminFilterBar.render.test.tsx` | Additions only (§6.1); the 4 L-1a cases unchanged | — |
| `layoutFolder.guard.test.ts` | §5 | C-14 |

### 6.3 Must stay green with no edit

`businessPicker.render` `:402` mount pin and every other picker case; `accountChipLabel.render` and `presetAndDeepLink.render` assertions (chip testid, text, `title`, "Show every account", the error text "Failed to fetch audit logs" via rule 1, `user_id=` in the first request); `searchTotals`, `resourceAndBusiness`, `userEmailFallback`, `userNameAndPlaceholder`, `aiCostPrecision` assertions; `filterOptions.guard`; `businessPicker.contract` (it walks `app/admin/audit-trail`, which gains two clean files); `health.*`, `jobsQueues.*`; the other shared tests; `AdminHeader.render`, `AdminSidebar.nav`; `app/admin/components/__tests__/adminWindowPresets.test.ts`; `app/admin/finance/__tests__/*` (incl. `finance.source.guard`, which lists the presets path); `app/admin/business-os-llm/__tests__/*`; `app/api/admin/audit-trail/__tests__/*`, `lib/audit/__tests__/*`; `lib/admin/__tests__/admin-authz-surface.guard.test.ts`; `app/__tests__/tailwind-css-escape.guard.test.ts`.

---

## 7. Verification (Dev, before handover; QA repeats the type check)

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ --ci` | all green |
| V-2 | `npx jest app/admin/finance app/admin/business-os-llm app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | all green, no edit |
| V-3 | Mutation checks, each restored afterwards: (a) pass `window.history.state` instead of `null` → the spy cases fail (SA M-1); (b) make the hook return a fresh `filters` object each render → the mount pin fails (two list requests); (c) serialise the page-only field → "search is never written" fails; (d) drop the `date_from` alias → the Health round trip fails; (e) remove the G-2 allow-list line → the S-3 case for `adminWindow.ts` fails | each red, then green |
| V-4 | `npm run test:bos-entitlements` | green (nothing imports `lib/business-os/entitlements`; S-4) |
| V-5 | Scoped type check: a scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`, absolute `include` of `next-env.d.ts`, every shared source and test, `adminWindowPresets.ts`, the Audit trail page, `auditTrailFilters.ts` and the 13 Audit trail tests, `HealthGrid.tsx` and `JobsQueuesView.tsx` (the other bar consumers). **Run 1:** canary `const canary: number = 'x';` in `useAdminFilters.ts` → exactly that TS2322. **Run 2:** canary removed → zero errors. Never a whole-repo `tsc` | both runs recorded |
| V-6 | `npx eslint <touched files> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0`, then `npx eslint <touched files>` | no hook violation (`useAdminFilters` is a real hook; `DatePresets` uses `useId` / `useState` in a component); no new findings |
| V-7 | `git diff --stat` before reading the diff | insertions where expected, no blanked file; absent: `components/ui/*`, `lib/**`, `app/api/**`, `app/admin/finance/**`, `app/admin/components/adminWindowPresets.ts`, `app/admin/audit-trail/BusinessAccountPicker.tsx`, `businessPicker.contract.test.ts`, `AdminSidebar.tsx`, `app/admin/layout.tsx`, Health and Jobs sources |
| V-8 (QA, browser) | Signed in as an admin, DevTools Network open, light **and** dark colour-scheme emulation (SA Q-8). See §7.1 | one line or screenshot per item in the QA report |

The worktree's `node_modules` is a junction to the main checkout; never remove or replace it. No `git stash`, no `git worktree remove`.

### 7.1 Browser URLs to try (V-8)

| # | Do | Expect |
|---|---|---|
| B-1 | On `/admin`, click every Health figure link that opens the audit trail (failed AI actions, critical events, …) | Same rows as on `main`; address bar shows `range=custom&from=…&to=…` plus the filter; the "Linked window … UTC" chip shows the same minutes as the tile's window; the request's `date_from` / `date_to` are byte-identical to `main` (compare in Network) |
| B-2 | `/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29T16%3A51&user_id=<a business id>` (the cutover link; or click it on `/admin/business-os-llm?tab=activity` with a business picked) | Chip "Linked window up to 2026-09-29 16:51 UTC" and the account chip; address bar `range=custom&to=…&account=…&entity_type=ai_action`; request carries `date_to=2026-09-29T16:51` and `user_id` |
| B-3 | From `/admin/users`, open a business, use its "AI failures" audit link (with and without a group id) | Request carries `action`, `user_id` and (when present) `search`; the Search box shows the group id; the address bar has no `search` |
| B-4 | Click 7 days, pick Severity Critical, then copy the address bar into a new tab | `?range=7d&severity=critical`; the new tab shows the same view; Back from the first tab leaves the page in one step (no history entries were added) |
| B-5 | Custom: From 2026-10-01, To 2026-10-05, Apply | `?range=custom&from=2026-10-01&to=2026-10-05`; request `date_from=2026-10-01T00:00:00.000Z`, `date_to=2026-10-05T23:59:59.999999Z`; rows from 5 October appear |
| B-6 | Custom with From after To | Inline alert, no request in Network |
| B-7 | `/admin/audit-trail?range=bogus&severity=catastrophic&account=nope&action=a%27b` | Page loads at its defaults with no error; address bar cleaned to `/admin/audit-trail` |
| B-8 | `/admin/audit-trail?utm=x&severity=info`, then Clear | `utm=x` kept throughout; after Clear only `?utm=x`; Clear then disabled |
| B-9 | Type in Search | Rows filter as before (one request per keystroke, as on `main`); the address bar never shows the text |
| B-10 | Both schemes | One h1; bar at rest; date inputs and native select popups dark; focus ring visible on presets, Clear, Refresh, chip X; "Read at" readable; throttled reload keeps header and bar with "Reading the audit trail…"; offline Refresh shows the red box with the network sentence and Try again; a filter with no matches shows the empty sentence and "Clear filters" |
| B-11 (SA M-5) | Change one filter | Network shows exactly one new list request and no second one from the URL sync; in the console `history.state.__NA === true` after the write (Next's keys kept) |
| B-12 (SA M-5) | Open `/admin/audit-trail` clean, filter (e.g. 7 days), then click "Audit trail" in the sidebar; then press Back | The sidebar click gives the defaults, a clean address bar and one request; Back gives the filtered view and its URL, in agreement |
| B-13 (SA M-5) | Reload after a filter change | Same view, one list request |
| B-14 (SA M-5) | Click 7 days, then 7 days again | Every date again (no `range` in the address bar, no `date_from` / `date_to` in the request), other filters kept (SA M-2) |

---

## 8. Task List

- [x] ✅ T-1 `adminWindow.ts` + `adminWindow.test.ts`
- [x] ✅ T-2 `useAdminFilters.ts` (`useAdminFilters`, `textFilter`, `AdminFilterField`, `AdminFilterSpec`) + `useAdminFilters.render.test.tsx`
- [x] ✅ T-3 `DatePresets.tsx` + `DatePresets.render.test.tsx`
- [x] ✅ T-4 `AdminFilterBar.tsx` full form (`AdminActiveChip`, `ADMIN_FIELD_LABEL`, `ADMIN_FIELD_CONTROL`, `readAt`, slots, Clear, chips) + test additions; Health and Jobs suites unchanged and green
- [x] ✅ T-5 `AdminEmpty`, header `actions`, `readAdminResponse` `pick`, `formatUtcTime` + test additions
- [x] ✅ T-6 `layoutFolder.guard.test.ts` G-1 to G-5
- [x] ✅ T-7 RC-1 logger mocks in the 9 Audit trail render tests; suite green (11 suites, 157 tests) **before** any page edit
- [x] ✅ T-8 `auditTrailFilters.ts` + `auditTrailFilters.test.ts`
- [x] ✅ T-9 `page.tsx` migration (§3.8)
- [x] ✅ T-10 Edits to `businessPicker.render` and `filterDensity.render` (§6.2); new `auditTrail.layout.render.test.tsx` (plus one unplanned edit, see Implementation Notes D-1)
- [x] ✅ T-11 G-6 registry entry; G-7 comment
- [x] ✅ T-12 Requirement §1: L-1c notes record the RC-8 move and the deferred exports; L-1d row gains the picker; §12.2 picker criterion moved to L-1d (F-97, C-8, S-3 were SA's corrections)
- [x] ✅ T-13 Verification V-1 to V-7; results recorded below
- [x] ✅ T-14 Hand over to TL for SA code review (uncommitted)

---

## 9. Sizing

| Part | Estimate |
|---|---|
| `adminWindow.ts` + tests | 0.5 day |
| `useAdminFilters.ts` + tests (the re-read rule and identity are the subtle part) | 1 day |
| `DatePresets.tsx`, `AdminFilterBar` full form + tests | 1 day |
| Small shared additions + tests | 0.25 day |
| `auditTrailFilters.ts` + tests | 0.25 day |
| Page migration | 0.75 day |
| Test edits (RC-1 × 9, two deliberate files) + pilot layout test | 0.75 day |
| Guard, mutation checks, type check, docs | 0.5 day |
| **Total** | **about 5 days** (4 to 5 with no surprises) |

With the picker it would be about 6 days, past "a few days" (§3 rule 3), hence RC-8. If SA wants L-1c smaller still, the next candidate is `AdminEmpty` (move it to L-1d with the table), which saves very little; nothing else in the slice can move without leaving the bar half built.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The hook returns a new `filters` object on a re-render or an echo, the `[filters]` effect fires again, and the mount pin breaks (F-28) | Identity rule in §3.2; effect-counter test in the hook suite; the mount pin with an alias link in the pilot test; mutation V-3 (b) |
| The hook re-parses its own write and loops | `lastWritten` / `lastSeen` rule; jsdom's mock returns the pre-write string forever, which the hook test exercises; real Next echoes the written string |
| A Health minute link loses its window or shifts by the browser's offset | Minute bounds are never passed through `Date`; forwarded verbatim; byte-for-byte round-trip tests; browser B-1 compares requests with `main` |
| A whole-date To silently drops its last day | `T23:59:59.999Z` mapping, unit-tested; browser B-5 |
| An inbound `search` (Businesses group id) is lost | Read as page-only before the first fetch; pilot test and B-3 |
| RC-1: a render test without the client-logger mock throws on import | T-7 first, suite green before the page changes |
| Health or Jobs DOM changes through the shared bar | New props are optional; the no-props branch is the exact L-1a markup; their render suites run in V-1 unedited |
| The S-3 exception widens over time | G-3 pins zero imports and no `'use client'` in `adminWindowPresets.ts`; G-4 refuses near-miss paths |
| Old picker looks out of place in the bar for one slice | Pre-authorised (RC-8); fixed-width wrapper; replaced in L-1d |
| Type errors invisible to ts-jest | V-5 with a canary first |
| Shared `node_modules` junction, shared stash list | No `git worktree remove`, no `git stash` |

---

## 11. Out of scope

The shared business picker, its chip and F-31 (L-1d, RC-8); `audit-trail/BusinessAccountPicker.tsx` and `businessPicker.contract.test.ts` (unchanged; RC-7 in L-1d; deletion in L-8, R-11); cards → table, inline expand → drawer, severity chip, UTC row times, the count line "N matching events", pagination restyle, `AdminNotice` (L-1d); F-28 request sequencing (SA-R-17), F-29 unused code, F-4 / F-32 CSV, F-33 search scope; search debounce (Q-7); `app/admin/finance/**` (divergence recorded, §1.4); `app/admin/components/adminWindowPresets.ts` and its test; `activityPresets.ts`; the Health, Businesses and cutover link builders; `lib/audit/**` (its comments still mention `datetime-local`, harmless) and every route; `components/ui/*`; `lib/utils.ts`; `AdminSidebar.tsx`, its nav test, `app/admin/layout.tsx` (X-1 to X-3); window extras (D-2 (b), first consumer L-2a); `KpiTile` same-page mode (L-2a); any new CI workflow or npm script.

---

## 12. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | **RC-8.** Apply it: the shared picker (C-6), its chip, F-31 and RC-7 move to L-1d; the original picker sits in bar slot 3 for one slice; the account chip keeps its exact words, testid and X label until then | Apply (§2.2, §9). L-1d becomes table + drawer + picker, still moderate because its drawer renders from the loaded row (no `useDrawerResource`) |
| Q-2 | **Final ruling on L-1b Q-13:** keep `adminWindowPresets.ts` in place; one exact-path S-3 exception; a C-14 check that it has zero imports and no `'use client'`; C-8 corrected to "`resolveWindow` reuses `adminWindowPresets.ts`" | Approve as leaned (§5 G-2 to G-4). Who edits §6.2 C-8 and §6.1 S-3 wording: SA as a doc correction, or Dev in T-12? |
| Q-3 | **Audit trail's default window** is "no window" (every date, as today): no preset pressed and nothing in the URL. The alternative, an "All time" button, is a new extra that D-2 (b) says needs the user | No window by default, no new button. If SA thinks the empty Window group reads badly, this becomes a user question, not a Dev choice |
| Q-4 | **Linked windows:** minute-form and instant bounds both show as the linked chip, press no preset, and are written back as `range=custom` with `from` / `to` verbatim (U-7 "custom implied") | Approve. Custom (whole dates) and linked share `range=custom`; the value's form tells them apart on reload |
| Q-5 | **Whole dates on the wire:** presets and Custom send `date_from=<from>T00:00:00.000Z` and `date_to=<to>T23:59:59.999Z` | Approve. A bare date as `date_to` would cut the To day at midnight (`.lte`), and `Z` pins UTC whatever the database timezone. Both pass the route's `Date.parse` check; no API change |
| Q-6 | **Mount rewrite scope:** the hook writes its projection whenever it differs, so beyond the U-9 alias rewrite it also strips invalid values (U-4) and an inbound `search` (page-only). A reload after a Businesses deep link therefore loses the group-id search | Approve: the address bar then always equals the view (U-1), and the search text leaves the current history entry (SA-R-8's reason). Alternative: leave an inbound `search` in the URL until the admin changes a filter |
| Q-7 | **Search timing:** §5.5 says search applies on debounce; today Audit trail sends a request per keystroke | Keep per keystroke in L-1c. A debounce changes request sequencing, which SA-R-17 says this slice must not do deliberately. Record a §9 note, or leave it to F-33's eventual fix |
| Q-8 | **`readAdminResponse` `pick`:** an optional selector for routes whose payload is not under `data` (the audit route returns `logs` and `pagination` at the top level) | Approve. The other choices are a route change (out of scope) or a second copy of the §5.10 precedence in the page |
| Q-9 | **Session copy:** Audit trail opts in to `sessionEndedCopy` (401/403 → "Your admin session has ended. Sign in again.") | Opt in, as Jobs did; named in the PR. The pinned "Failed to fetch audit logs" case has no 401/403 status and stays on rule 1 |
| Q-10 | **"Read at" format:** `HH:mm UTC` (§5.5 text) through a new `formatUtcTime`, or the full `formatUtc` date-time | `HH:mm UTC` as the standard says. The full date would help only a tab left open overnight |
| Q-11 | **Custom-range validation:** only "From after To" (and real dates); one-sided allowed; Apply disabled when both are empty. Not `customRangeProblem`'s 92-day cap or "not after today", which are the finance route's rules | Approve. A later page whose route has a cap passes its own validator then (additive prop) |
| Q-12 | **Hook API:** multi-key fields (the window owns `range` / `from` / `to`) with an alias map; identity-stable state; re-read only when `useSearchParams` differs from both the last seen and the last written string; `null` search params → defaults and no write; page-only fields keep their value across outside URL changes unless the new URL carries them | Approve the shape in §3.2. It is the C-7 spec ("key, default, parse, serialise, aliases") with `keys` plural so a window can be one field |
| Q-13 | **Registry entry:** `page.tsx` and `auditTrailFilters.ts` only; the original picker is excluded (it still calls `.json(`) | Approve. The shared picker in L-1d is checked by part (a) of C-14 instead |
| Q-14 | **Finance divergence** (§1.4: `preset` / `accountId`, default written, `router.replace`, reset-all notice) | Add a §9 row (F-97, "open: the finance adoption slice reads `preset` / `accountId` as aliases"), recorded not fixed; L-1c does not edit finance |
| Q-15 | **`ArchivedBeforeNotice`** moves from between the header and the filters to just above the content (§5.1 region order), unedited | Approve |
| Q-16 | **"BOS AI failures"** stays a page control in bar slot 4, gains `aria-pressed`, and its active colour changes from rose to the purple accent (T-7) | Approve. Clicking it still only sets the action (no toggle-off), as today |

---

---

## Implementation Notes (Dev, 2026-10-11)

### Files

| File | Action |
|---|---|
| `app/admin/components/layout/useAdminFilters.ts` | new (C-7 hook, `textFilter`, `AdminFilterField`, `AdminFilterSpec`) |
| `app/admin/components/layout/adminWindow.ts` | new (C-8 pure window: parse, serialise, `windowFilter`, `resolveWindow`, `linkedWindowLabel`, `windowEquals`, `boundForm`) |
| `app/admin/components/layout/DatePresets.tsx` | new (Window group, Custom row, `ADMIN_FIELD_LABEL`, `ADMIN_FIELD_CONTROL`) |
| `app/admin/components/layout/AdminFilterBar.tsx` | full form; the L-1a markup kept exactly for the no-new-props branch |
| `app/admin/components/layout/AdminStates.tsx` | `AdminEmpty` |
| `app/admin/components/layout/AdminPageHeader.tsx` | `actions` |
| `app/admin/components/layout/readAdminResponse.ts` | `pick` (typed overload, S-2) |
| `app/admin/components/layout/adminFormat.ts` | `formatUtcTime` |
| `app/admin/audit-trail/auditTrailFilters.ts` | new (spec + `auditRequestParams` + `isSearchActive`) |
| `app/admin/audit-trail/page.tsx` | migrated (§3.8) |
| `app/admin/components/layout/__tests__/` | new `adminWindow.test.ts`, `useAdminFilters.render.test.tsx`, `DatePresets.render.test.tsx`; additions to `AdminFilterBar.render`, `AdminStates.render`, `AdminPageHeader.render`, `readAdminResponse.test`, `adminFormat.test`; guard G-1 to G-7 |
| `app/admin/audit-trail/__tests__/` | new `auditTrailFilters.test.ts`, `auditTrail.layout.render.test.tsx`; RC-1 mock in the 9 render tests; `businessPicker.render` and `filterDensity.render` per §6.2; `presetAndDeepLink.render` (D-1) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | T-12 only (§1 rows 3 and 4 notes; §12.2 picker criterion moved to L-1d) |

### Deviations (for SA)

| # | Deviation | Why |
|---|---|---|
| D-1 | `presetAndDeepLink.render.test.tsx` "asks for one account's failures" now reads the first **list** request instead of `fetchedUrls(fetchMock)[0]`. §6.3 listed it as "no edit" | With the early-return spinner gone (§5.10) and the notice rendered unconditionally (M-3), `ArchivedBeforeNotice` mounts with the page and, as a child, its effect runs before the page's, so the archive request now comes first. Request count is unchanged (the mount pin and the new pilot pin both hold); only the order of two independent mount requests changed. Assertions on the list request are unchanged |
| D-2 | `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` are defined in `DatePresets.tsx` and re-exported from `AdminFilterBar.tsx` (pages import them from the bar, as planned) | `DatePresets` uses them too; defining them in the bar would make the two files import each other. `ADMIN_FIELD_CONTROL` carries no width (pages size each control), so a page width class never fights a `w-full` |
| D-3 | `readAdminResponse` takes `pick` through a second options type (`ReadAdminResponseOptionsWithPick<T>`) rather than an optional field on the existing one | S-2: `T` is inferred from the pick's return, so no `any` and no cast at the call site. Behaviour exactly as planned (ok branch only) |
| D-4 | `useAdminFilters<S extends object>` (not `Record<string, unknown>`) | An `interface` such as `AuditFilters` has no index signature and is not assignable to `Record<string, unknown>` |
| D-5 | The page logs `{ status }` on a non-ok answer ("Failed to fetch audit logs"); before, a `success: false` body was not logged | The HealthGrid / Jobs shape; carries no name or search text (AC-B13 still green) |
| D-6 | Identity-stable `filters`: re-clicking "BOS AI failures" when already active, or choosing the same select value, no longer refetches (before, every `setFilters({ ...filters })` made a new object) | Required by the identity rule (§3.2); not a sequencing change. Refresh still re-reads |

### Verification results

| # | Result |
|---|---|
| V-1 + V-2 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm app/admin/finance app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **76 suites, 1,640 tests, all passed** (every path existed) |
| V-3 | Each mutation red, then restored (md5 of each mutated file matches its pre-mutation copy): (a) `replaceState(window.history.state, …)` → 3 failed (two hook cases + `businessPicker.render` rewrite case; the hook harness now arrives with a Next-like `{ __NA: true }` state so this is caught there too); (b) `filters: { ...filters }` returned each render → 16 failed (mount pins, identity cases; the page loops); (c) page-only field serialised → 4 failed; (d) `date_from` alias dropped → 3 failed (Health round trips); (e) G-2 allow-list line removed → 3 failed (S-3 for `adminWindow.ts` and `DatePresets.tsx`, G-4 self-test) |
| V-4 | `npm run test:bos-entitlements`: 230 suites, 6,219 tests, all passed |
| V-5 | Scoped `tsc` (scratch tsconfig in the session scratchpad: `next-env.d.ts`, every shared source and test, `adminWindowPresets.ts`, the page, `auditTrailFilters.ts`, all 13 Audit trail tests, `HealthGrid.tsx`, `JobsQueuesView.tsx`). Run 1 with canary in `useAdminFilters.ts`: exactly `useAdminFilters.ts(204,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2, canary removed (md5 back to the pre-canary copy): **0 errors** |
| V-6 | Hooks config (`--no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0`) on every touched file: clean. Default config: 0 errors; 12 warnings, all in `page.tsx` and **identical to `HEAD`'s 12** (F-29 unused `Calendar`, `User`, `user`, `getSeverityColor`, `idx`; 6 pre-existing `any`; the pre-existing `exhaustive-deps` on the F-28 effect). No new findings |
| V-7 | `git diff --stat` checked before reading the diff: no blanked file; none of `components/ui/*`, `lib/**`, `app/api/**`, `app/admin/finance/**`, `adminWindowPresets.ts`, `BusinessAccountPicker.tsx`, `businessPicker.contract.test.ts`, sidebar, layout, Health or Jobs sources is touched. Line endings preserved (layout files LF, Audit trail files CRLF in the working copy) |

### User-visible changes on `/admin/audit-trail` (for the PR body)

1. Title "Audit Trail" becomes "Audit trail"; the "System Config" pill is gone; Export CSV stays top right.
2. The filter card becomes the standard filter bar. New Window presets: Today, 7 days, 30 days, This month, Custom. None is pressed by default and the page still shows every date. Clicking the pressed preset again goes back to every date.
3. Custom From (UTC) / To (UTC) are whole UTC dates with an Apply button, replacing the two minute-precision local-time inputs. A To date includes that whole UTC day. From after To shows an inline message and asks nothing. Emptying both and pressing Apply goes back to every date. Links from Health tiles and the AI activity cutover notice are still honoured to the minute and show as a "Linked window … UTC" chip with an X. A legacy bare-date `date_to` link now includes the whole To day.
4. Filters are written to the address bar (`range`, `from`, `to`, `account`, `action`, `severity`, `entity_type`) by replace, so no Back entries are added and a view can be shared by copying its link. Old links (`date_from`, `date_to`, `user_id`) still work and are rewritten to the new names. Search is never written; a `search` in an inbound link fills the Search box and leaves the address bar, so a reload of a Businesses deep link keeps the account and action but not the search.
5. A link with a value the page cannot use (unknown severity, malformed id, unknown action name, or a date in another format) opens the page with that filter at its default, instead of an "invalid query" error.
6. One Refresh, in the bar, named "Refresh the audit trail", with "Read at HH:mm UTC" beside it (the second Refresh above the list is gone). "Clear All Filters" becomes "Clear", sits before Refresh, and is disabled when nothing is filtered.
7. The account chip keeps its words and its X ("Show every account") and moves to a row under the bar; the account picker itself is unchanged until L-1d. "BOS AI failures" shows its pressed state (purple, announced as pressed).
8. Loading no longer blanks the page: header and bar stay, and the list area says "Reading the audit trail…". Errors show in the standard red box with "Try again"; a non-JSON answer shows "Could not read the audit trail. Try again in a moment."; a network failure shows "Could not reach the server. Check your connection and try again."; a 401/403 shows "Your admin session has ended. Sign in again."; a non-2xx answer is an error even if its body says success. On a failed refresh the rows already shown stay.
9. An empty list reads "No audit events match these filters." with "Try a wider window or fewer filters." and a "Clear filters" button when filters are on.
10. The "Entries before … are archived" notice now sits just above the list (it was above the filters).

### Out-of-scope issues seen (listed, not fixed)

| # | Issue | Where |
|---|---|---|
| O-1 | The Export CSV button has no `type="button"` and its icon has no `aria-hidden` (kept unchanged, F-4 scope) | `page.tsx` header actions |
| O-2 | The 12 pre-existing ESLint warnings in `page.tsx` (F-29 unused code, `any` in `details` / `changes` rendering, the F-28 effect deps) | `page.tsx` |
| O-3 | `lib/audit/requestSchemas.ts` comments still describe `datetime-local` values (already noted in §11) | `lib/audit/requestSchemas.ts` |

## SA Review Notes

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11** (workplan stage, no code). Verified at `6e5c4b7e` in this worktree: `audit-trail/page.tsx` (`:300-302` read-once state, `:329-330` fetch + `.json(`, `:348-355` the two `[filters]` effects, `:476-482` early-return spinner, `:519` `ArchivedBeforeNotice`), the 11 Audit trail test files (fetch mocks all `{ ok, json }` with `success: true`; no test pins "Refresh", the h1 text, "System Config" or the spinner), `filterOptions.guard`, `adminWindowPresets.ts` (zero imports, no `'use client'`), `layoutFolder.guard.test.ts` (`ALLOWED_EXACT`, `HISTORY_WRITE`), `evaluateHealth.ts` `auditLink` + `windows.ts` `toAuditDateParam`, `BusinessOsPanel.tsx` `auditLink`, `CutoverNotice.tsx` `cutoverLinks`, `lib/audit/requestSchemas.ts` (`Date.parse` refine), the route's `success: true` envelope, and Next `14.2.35` `app-router.js` (`replaceState` patch, `copyNextJsInternalHistoryState`).

**Status:** APPROVED WITH CONDITIONS (M-1 to M-5). Proceed to implementation once the conditions are folded in; no re-review of the workplan is needed.

### Rulings on Q-1 to Q-16

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved: RC-8 applied.** C-6, its chip, F-31 and RC-7 move to L-1d. L-1d (table constants, drawer from the loaded row, picker) estimates at about 4 to 5 days; if the L-1d workplan comes out larger, the picker swap is pre-authorised to split into its own slice **L-1e** (same page, run straight after L-1d, before L-2a). SA updated §6.2 C-6's slice column | ~5 days here vs ~6 with the picker; §7.3 pre-authorises the move; Audit trail stays shippable (R-3) |
| Q-2 | **Final: keep `adminWindowPresets.ts` in place**, one exact-path S-3 exception, G-3 pins zero specifiers and no `'use client'`, G-4 near-miss self-tests. **SA made the doc corrections** (§6.1 S-3, §6.2 C-8); Dev does not edit them in T-12 | A `lib/` file and the finance route import it; it has zero imports, so the exception leaks nothing; reuse before creating |
| Q-3 | **Approved: default "no window", no "All time" button.** Consistent with D-2 (b) (no new extras without the user) and needs no user decision, **with M-2** (a way back to "every date" other than Clear) | Same rows as today by default; adding a button would be a new extra |
| Q-4 | **Approved.** Linked bounds are written back as `range=custom` + verbatim `from` / `to`; the form tells custom and linked apart on reload | U-7 "custom implied"; byte-for-byte forwarding (SA-R-1) |
| Q-5 | **Approved, with S-1** (`date_to` = `<to>T23:59:59.999999Z`, not `.999Z`) | The route forwards verbatim to `.lte`; `created_at` has microsecond precision, so `.999Z` drops the last 999 microseconds of the day. `Date.parse` accepts six digits (checked: same ms value) |
| Q-6 | **Approved: strip an inbound `search` on the first rewrite.** A reload of a Businesses deep link loses the group-id search (the view stays scoped by account and action). Acceptable, not a product question: it is exactly D-6 (a) as the user chose it ("a shared link opens the same view with an empty search box"), and it takes the text out of the current history entry (SA-R-8). The hook must **not** keep page-only params it did not write. Named in the PR (already §3.10 item 4) | One rule for every page-only key; no "sometimes in the URL" state |
| Q-7 | **Approved: per keystroke in L-1c.** SA recorded it as **§9 F-98** (fix with F-28 / F-33) | Debounce changes request sequencing (SA-R-17) |
| Q-8 | **Approved** (`pick`, ok branch only; RC-2 surface unchanged) | No route change; one copy of the §5.10 precedence |
| Q-9 | **Approved** (`sessionEndedCopy` opt-in; named in the PR) | RC-4 opt-in; the pinned case carries no status, stays on rule 1 |
| Q-10 | **Approved:** "Read at HH:mm UTC" via `formatUtcTime` | §5.5 part 6 text |
| Q-11 | **Approved:** From after To + real dates only; one-sided allowed; no finance cap | The audit route has no cap; the finance rules are the finance route's |
| Q-12 | **Approved, with M-1** (mechanism and the single last-known string) | C-7 shape with plural `keys` is right |
| Q-13 | **Approved:** registry = `page.tsx` + `auditTrailFilters.ts`; the original picker excluded | It still calls `.json(`; replaced in L-1d |
| Q-14 | **Approved: recorded, not fixed.** SA added **§9 F-97**; Dev does not add it in T-12 | Finance is out of scope; aliases keep its links working later |
| Q-15 | **Approved, with M-3** | §5.1 order |
| Q-16 | **Approved** (slot 4, `aria-pressed`, purple, no toggle-off; the Action select still resets it) | T-7; no behaviour change |

### Findings

| # | Severity | Finding / condition |
|---|---|---|
| M-1 | **must** | **History mechanism.** With `replaceState(window.history.state, …)` the state already carries `__NA`, so Next 14.2's patch takes its "internal call" branch (`app-router.js:447-451`) and never runs `applyUrlFromHistoryPushReplace`: `useSearchParams` keeps the arrival string, so the §3.2 / §3.9 premise "Next echoes the string the hook wrote" is false, and an in-app link to the URL Next still believes in (the sidebar "Audit trail" link while filtered, when the page was opened clean) changes nothing the hook can see, leaving the view filtered under a clean address bar (U-1). **Use `window.history.replaceState(null, '', url)`**: Next's patch then copies `__NA` and the tree onto the entry itself and syncs `useSearchParams` (the documented Next native-History usage). SA corrected U-2 and C-7. Also: (a) keep **one** `lastKnown` ref (initialised synchronously from the first `useSearchParams` string; set to the written string just before each write; set to `incoming` on each re-read) and re-read iff `incoming !== lastKnown`. Two refs compared with "either" go stale: after a sidebar reset, Back to the earlier written URL would equal the old `lastWritten` and be ignored. (b) An outside change re-parses **every** field, page-only included (search goes to its default unless the new URL carries it), so opening a URL reproduces the view. (c) Test and doc edits that follow: the hook suite asserts `null` as the first argument (not the prior `history.state`); `businessPicker.render :389` asserts the same; V-3 (a) becomes "pass `window.history.state` instead of `null` → the spy case fails"; add hook cases for Back-after-reset (string returns to an earlier written value → re-parsed) and outside change resetting search. The BOS AI page's own `?tab=` write is not touched |
| M-2 | **must** | **A way back to "every date".** With default `none` and no "All time" button, once an admin clicks 7 days the only route back is Clear, which also wipes action, severity and account; today the date inputs can simply be emptied. Generic rule in `DatePresets` (needs `defaultValue`, already in `windowControl`): **clicking the pressed preset applies the page default** (a no-op on pages whose default is that preset), and **Apply with both inputs empty applies the page default** (enabled only while a custom window is applied, otherwise disabled as planned). Tests in `DatePresets.render` and one pilot case (7 days → click 7 days again → no `date_from` / `date_to`, no `range` in the address bar) |
| M-3 | **must** | **F-28 pin.** `ArchivedBeforeNotice` is rendered unconditionally, outside every loading / empty / error / content branch, so it mounts once and never remounts on a read. Inside the content branch it would refetch on each loading toggle and break the mount pin. Pilot test: the notice's request count stays 1 after a filter change |
| M-4 | **must** | **Parser forms.** `date_from` / `date_to` values that today's page forwarded because `Date.parse` accepted them but that are none of the three U-7 forms (e.g. `2026-09-25 10:30`, seconds without an offset) are now ignored (U-4). No emitter produces them; add "or a date in another format" to §3.10 item 5 and name it in the PR. Also add the round-trip row for the one-sided minute `from` (only `date_from`) to §4.2 and its test |
| M-5 | **must** | **Browser plan additions** (QA, V-8): **B-11** after a filter change, Network shows exactly one new list request and no second one from the URL sync; in the console `history.state.__NA === true` after a write (Next's keys kept). **B-12** while filtered (opened clean), click "Audit trail" in the sidebar → defaults, clean address bar, one request; then Back → the filtered view and its URL agree. **B-13** reload after a filter change → same view, one list request. **B-14** 7 days then 7 days again → every date (M-2) |
| S-1 | should | `date_to` for whole dates = `<to>T23:59:59.999999Z` (Q-5). Update §3.5, §4.2 and the tests |
| S-2 | should | `pick` casts `body.logs` / `body.pagination` exactly as the page trusts them today; type the pick's return so no `any` enters (CLAUDE.md rule 6) |
| N-1 | note | An inbound instant with an unencoded `+02:00` decodes to a space and is ignored (U-4). No emitter sends instants to Audit trail; the hook writes `%2B` |
| N-2 | note | A legacy bare-date `date_to` now includes the whole To day (it stopped at midnight before). Correct under U-7; name it with §3.10 item 3 |
| N-3 | note | The account chip keeps "Show every account" (not "Remove {filter}") and the picker keeps "Account" for one slice: accepted interim under RC-8; L-1d makes both standard |
| N-4 | note | §7.3's listed edits to `accountChipLabel`, `presetAndDeepLink` and `searchTotals` move to L-1d with the picker; verified that none of them pins anything L-1c changes. The 9 RC-1 mock edits and the two deliberate files in §6.2 are the complete L-1c test-edit list |
| N-5 | note | Scope verified: no `finance/**`, `lib/**`, routes, `adminWindowPresets.ts`, original picker, `businessPicker.contract`, sidebar, layout or Health / Jobs source edits; V-7 enforces it. Health and Jobs must render byte-identical through the no-new-props branch of the bar |

### Checks against the brief

| Check | Result |
|---|---|
| URL contract incl. aliases | ✅ U-3/U-4/U-5/U-9 per §4.1; canonical wins over alias; unrelated keys and hash kept |
| Health minute links byte-for-byte | ✅ `auditLink` emits `date_from=YYYY-MM-DDTHH%3Amm`; the page reads the decoded minute, forwards it verbatim and `URLSearchParams` re-encodes identically, so the request string is unchanged |
| Cutover link | ✅ one-sided `date_to` minute → linked chip "up to … UTC"; `user_id` alias → `account` |
| history.state preservation / no pushState | ✅ after M-1 (Next copies its keys onto a `null` state; G-5 + spies pin no `pushState`) |
| Defaults omitted | ✅ |
| F-28 mount pin | ✅ synchronous first state, identity-stable `filters`, no fetch in shared parts; with M-1 the sync is an `ACTION_RESTORE` on the same tree (no remount, no request) and with M-3 the notice mounts once |
| Route param mapping | ✅ dates as `Z` instants with end-of-day `.lte` (S-1 for microseconds); linked verbatim; route and request order unchanged |
| Scope | ✅ N-5 |
| Test edits enumerated | ✅ N-4 |
| Size | ✅ about 5 days, at the top of "a few days" with RC-8 |
| Verification | ✅ V-1 to V-8 plus M-5; canary type check; mutation checks (V-3 (a) inverted by M-1) |

### Doc corrections made by SA (requirement)

§5.6 U-2 and §6.2 C-7 (M-1 mechanism, single last-known string); §6.1 S-3 (the one named exception); §6.2 C-6 slice column (L-1d); §6.2 C-8 (`resolveWindow` reuses `adminWindowPresets.ts`); §9 F-97, F-98 and the count (98); §1 L-1c status; Change History. **T-12 for Dev therefore shrinks to:** §1 L-1c / L-1d notes (RC-8 move, deferred exports) and the §12.2 picker criterion moved to L-1d.

### Verdict

**APPROVED WITH CONDITIONS.** Implement with M-1 to M-5 folded in (and S-1, S-2 unless Dev finds a concrete reason not to, recorded here). No product question for the user.

### Approval

[x] Workplan approved — proceed to implementation (conditions M-1 to M-5)

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11** (uncommitted worktree `feature/admin-layout-l1c`, base `6e5c4b7e`)
**Status:** ✅ Code Approved (no must-fix; two optional should-fixes below, neither needs re-review)

`git diff --stat` checked first: 22 modified files (+837 / -400) and 10 new files, no blanked file. Read the full diff and every new file. Spot-ran `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ app/admin/components/health app/admin/components/jobs app/api/admin/audit-trail lib/audit app/admin/finance --ci`: **63 suites, 1,085 tests, all passed**. Hooks ESLint config (`--max-warnings 0`) on the hook, `DatePresets`, `adminWindow`, the bar, `auditTrailFilters` and `page.tsx`: clean; default config on the new / shared sources: clean.

### Verification against the conditions

| Item | Result |
|---|---|
| M-1 mechanism | ✅ `useAdminFilters.ts:160` `window.history.replaceState(null, '', url)`; no `pushState` anywhere in the folder (G-5 pins it); no `router.replace`. **One** `lastKnown` ref (`:138`), initialised synchronously from the first `useSearchParams` string, set just before each write (`:159`) and to `incoming` on each re-read (`:145`); re-read iff `incoming !== lastKnown` (`:144`). The re-read parses **every** field (`parseAll`, page-only included) and merges with `equals`, so identity holds. Tests cover echo skipped, jsdom no-echo, outside change, Back-after-reset, search reset, no-op outside change keeping the object. `businessPicker.render` asserts `replaceState(null, '', …)`. BOS AI `?tab=` code untouched (no `business-os-llm/**` in the diff) |
| Health minute links | ✅ `auditTrail.layout.render.test.tsx` "a Health link reaches the route byte for byte" asserts the full request string equals main's (`date_from=2026-09-25T10%3A30…&page=1&page_size=20`); address bar `range=custom&from=…&to=…&action=…` |
| Cutover link | ✅ one-sided minute `to` → linked chip "Linked window up to 2026-09-29 16:51 UTC", `user_id` → `account`, request keeps `date_to` + `user_id` |
| Legacy aliases | ✅ `getterFor` (`useAdminFilters.ts:69-80`): canonical wins; aliases deleted from the projection (`:122`) and never written |
| Defaults omitted | ✅ `projectSearch` skips `equals(value, default)` (`:126`); clean URL → no write |
| M-4 invalid values | ✅ `adminWindow.ts:45-72` accepts only date / minute / instant (instant requires `Z` or an offset); `2026-09-25 10:30` and seconds-without-offset are null → ignored. Validators in `auditTrailFilters.ts:35-45` mirror `AdminAuditTrailQuerySchema` (identifier, severity enum, UUID, 200-char search). One-sided minute `from` row pinned |
| M-2 | ✅ `DatePresets.tsx:82` second click on the pressed preset → `defaultValue`; `:91-95` Apply with both empty → default, enabled only while a custom window is applied (`:76`). Pilot case pins no `range`, no `date_from` / `date_to` |
| M-3 + F-28 pin | ✅ `ArchivedBeforeNotice` rendered once outside every branch (`page.tsx` after the error box); pilot pins "notice read once, still once after a filter change" and "Health alias link costs exactly one list request plus the notice". The two `[filters]` effects are byte-identical to main |
| D-1 (request order) | ✅ **Accepted.** The notice is a child, so its mount effect runs before the page's: two independent GETs swap order, the count is unchanged and pinned. The edited assertion now selects the list request by path, which is the more honest test |
| S-1 | ✅ `auditTrailFilters.ts:78` `T23:59:59.999999Z`. Route side verified: `lib/audit/requestSchemas.ts:116-119` `dateFilter` is `max(64)` + `Date.parse` finite; the string is 27 chars and `Date.parse` returns the same ms as the `.999Z` form (checked); the route forwards it verbatim to `.lte('created_at', …)`, and Postgres `timestamptz` takes 6 fractional digits natively. No 400 risk |
| S-2 | ✅ `readAdminResponse.ts` `ReadAdminResponseOptionsWithPick<T>` (D-3): `T` is inferred from `pick`, no `any`; the page's casts are from `unknown` (`body.logs as AuditLogEntry[]`), the same trust as before. Failure precedence untouched; `pick` only on the ok branch |
| D-2, D-4, D-5 | ✅ Accepted (no import cycle; `S extends object` is the correct bound for interfaces; the `{ status }` log carries no name or search text) |
| D-6 (no refetch on re-selecting the same value) | ✅ **Accepted.** It is a direct consequence of the identity rule that protects the F-28 pin; the old refetch was incidental (`{ ...filters }` made a new object), the bar's Refresh is the explicit re-read, and nothing pinned the old behaviour. Name it in the PR body |
| Health / Jobs unchanged | ✅ Both call `<AdminFilterBar what busy onRefresh />` only; the no-controls branch is the L-1a markup (`ReadAt` returns `null` without `readAt`); their render suites pass unedited |
| Guard G-1 to G-7 | ✅ Meaningful: G-3 parses the presets file's specifiers (empty) and its first line; G-4 refuses near-miss paths; G-5 makes S-6 non-vacuous and adds a `pushState` ban with its own self-tests; G-6 adds the registry entry; G-7 header paragraph |
| Scope | ✅ No `app/admin/finance/**`, `lib/**`, `app/api/**`, `BusinessAccountPicker.tsx`, `adminWindowPresets.ts`, `components/ui/*`, sidebar or layout file in the diff |
| Accessibility | ✅ `role="search" aria-label="Filters"` only when controls are passed; `role="group" aria-label="Window"`; `aria-pressed` on presets, Custom and "BOS AI failures"; visible `<label htmlFor>` with `useId` on From (UTC) / To (UTC); `role="alert"` for From after To; chip X has `aria-label` and a 20 px target; purple focus ring on every new control; decorative icons `aria-hidden` |
| Logging / types | ✅ No `console.*` in any touched file; page now on `clientLogger.child` (F-56). No new `any` (the 4 remaining in `page.tsx` are pre-existing F-29 / O-2) |
| Line endings | ✅ New files are CRLF in the working copy with `core.autocrlf=true`, so they are stored LF like their neighbours; modified layout files stay LF in the working copy, `page.tsx` stays CRLF; the index is LF throughout |

### Code Review Comments

| # | File:line | Comment | Priority |
|---|---|---|---|
| SF-1 | `app/admin/components/layout/useAdminFilters.ts:132` | The hook depends on `spec` being referentially stable (it is in every effect and `useCallback` dep list). Audit trail passes a module constant, so nothing is wrong today, but an inline spec on a future page would give a new `setFilters` every render and re-run both effects each render. Add one JSDoc line: "`spec` must be a module-level constant". Optional before commit; otherwise in L-1d | Low (should) |
| SF-2 | `app/admin/audit-trail/page.tsx:296-303` | The comment still calls this line "the single definition of a search is active", but the definition now lives in `auditTrailFilters.ts:96` (which carries the same paragraph). Shorten the page comment to a pointer. Optional before commit | Low (should) |
| N-1 | `useAdminFilters.ts:143-161` | Theoretical: two filter writes A then B, with Next's echo of A committing after B's write, would read A as an outside change and revert to A. Next's restore runs in a transition that is batched with B's, and the only rapid input (Search) is page-only and never writes, so this is not reachable by normal use. Recorded, no action | Note |
| N-2 | `page.tsx` content branch | On a failed **first** read the results count card still renders (with zeros) under the red box. Same as main (the old page also showed the card under its error box); L-1d's table rework is the place to revisit | Note |
| N-3 | `DatePresets.tsx:101` | Applied dates are trusted to be `YYYY-MM-DD` because `type="date"` guarantees it in every supported browser; a non-supporting browser would send an unparsable bound and get the route's 400 in the red box, not a crash. No action | Note |

### Optimisation Suggestions

- The Search input repeats `ADMIN_FIELD_CONTROL`'s classes inline (it needs `pl-8`); fine for one slice, consider a padding-free variant when L-1d touches the bar again.

### Verdict

**✅ CODE APPROVED for QA.** No must-fix. SF-1 and SF-2 are comment-only and may be folded in before commit without another SA pass. QA must still run V-8 (B-1 to B-14, both colour schemes), with B-11 and B-12 being the real-browser proof of the M-1 mechanism, which jsdom cannot show.

### Code Approved for QA: Yes

## QA Report — 2026-10-11

**QA — 2026-10-11** (uncommitted worktree `feature/admin-layout-l1c`; re-run after SA's SF-1 / SF-2 comment fold-in landed at 10:08; md5 of `page.tsx` and `useAdminFilters.ts` confirmed unchanged across the final run)
**Test mode:** full
**Strategy used:** A + B (Jest unit and jsdom render; the route's Zod schema parsed directly) + scoped type check. D (browser) handed to TL: it needs a signed-in admin, and B-11 / B-12 are the only real proof of the M-1 Next 14.2 `replaceState` sync, which jsdom cannot show
**Focus:** ui, schema (URL contract), api (request mapping against `AdminAuditTrailQuerySchema`)
**Skipped:** browser checks B-1 to B-14 (checklist below, for TL); ESLint re-run (SA ran both configs clean on the same files)
**Input source:** TL prompt (steps 1 to 5)

### Commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm app/admin/finance app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **76 suites, 1,640 tests, all passed** (77.9 s). Re-run after the SF-1 / SF-2 edits, with the QA throwaway file present: 77 suites, 1,701 tests, all passed. One "worker process has failed to exit gracefully" warning; the entitlements run, which contains no L-1c file, shows the same warning, so it is pre-existing and not from this slice |
| 2 | `npm run test:bos-entitlements` | **230 suites, 6,219 tests, all passed** (nothing in the diff imports `lib/business-os/entitlements`) |
| 3 | Scoped `tsc` (scratch tsconfig in the session scratchpad; `extends` the worktree tsconfig; `incremental: false`; 44 files: `next-env.d.ts`, every `layout/` source and test, `adminWindowPresets.ts`, every `audit-trail/` source and all 13 tests, `HealthGrid.tsx`, `JobsQueuesView.tsx`) | Run 1, canary in a **scratch** file (imports `useAdminFilters`, then `const canary: number = 'x'`): exactly `canary.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2, canary excluded: **0 errors**. Repeated after the SF edits: 0 errors |
| 4 | Throwaway `app/admin/audit-trail/__tests__/qaTmpL1c.render.test.tsx` (the real page and hook in jsdom, with the pilot test's mocks) | **60 / 60 passed**. Deleted afterwards. `git status --short` is back to the same 32 entries. No stash, no commit, `node_modules` untouched |

### Edge-case table

Source: the throwaway test. Every row also asserts four things: the built request passes `AdminAuditTrailQuerySchema.safeParse`; mount makes exactly one list request and one archive-notice request; every `replaceState` call has `null` as its first argument; `pushState` is never called.

| Arriving query | Address bar after mount | Request (relevant params) | Result |
|---|---|---|---|
| `date_from=2026-10-01` | `?range=custom&from=2026-10-01` | `date_from=2026-10-01T00:00:00.000Z`, no `date_to` | ✅ |
| `date_to=2026-10-05` | `?range=custom&to=2026-10-05` | `date_to=2026-10-05T23:59:59.999999Z` (N-2: the whole day) | ✅ |
| `user_id=<uuid>` | `?account=<uuid>` | `user_id=<uuid>` | ✅ |
| `date_to=2026-09-29T16:51` and `…T16%3A51` | `?range=custom&to=2026-09-29T16%3A51` (both) | `date_to=2026-09-29T16:51`, verbatim | ✅ |
| `from=…T10:30&to=…T10:30` (canonical, no `range`) | `range=custom` implied, minutes kept | verbatim | ✅ |
| `date_from=2026-09-25T10:30:00Z` | `?range=custom&from=2026-09-25T10%3A30%3A00Z` | verbatim | ✅ |
| `date_to=2026-09-25T23:59:59.999999Z` | kept | verbatim; schema accepts | ✅ |
| `from=…T10:30:00%2B02:00` | `…%2B02%3A00` | `2026-09-25T10:30:00+02:00` | ✅ |
| `from=…T10:30:00+02:00` (unencoded `+`) | cleaned | none (SA N-1, known) | ✅ as designed |
| `to=…T10:30:00.123-05:00` | kept | verbatim | ✅ |
| `…T10:30:00` (seconds, no offset); `2026-09-25 10:30` | cleaned | none (M-4) | ✅ |
| `2026-02-30`, `2026-02-30T10:00`, `…T24:00`, `abc` | cleaned | none | ✅ |
| `date_from=abc&date_to=2026-10-05` | `?range=custom&to=2026-10-05` | one-sided `date_to` | ✅ |
| `date_from=2026-10-05&date_to=2026-10-01` (From after To) | cleaned | none | ✅ |
| `from=2026-10-05&to=2026-10-05` | kept | `T00:00:00.000Z` to `T23:59:59.999999Z` | ✅ |
| reversed minute bounds | kept verbatim | verbatim (no ordering check, by design) | ✅ as designed |
| `date_from=2026-09-25&date_to=2026-09-29T16:51` (a date and a minute) | linked, kept | `date_from=2026-09-25` is sent as a **bare** date (see E-2) | ✅ as designed |
| `range=bogus`; `range=custom` alone; `range=month` | cleaned | none | ✅ |
| `range=bogus&from=2026-10-01&to=2026-10-02` | `range=custom&…` | Z instants | ✅ |
| `range=7d&from=…&to=…` | `?range=7d` (bounds dropped) | the 7-day window as Z instants | ✅ |
| `range=today`; `range=this_month` | kept | Z instants from `resolveAdminWindow` | ✅ |
| `severity=catastrophic`; `CRITICAL`; `all` | cleaned | none | ✅ |
| `account=nope`; `user_id=nope` | cleaned | no `user_id` | ✅ |
| `user_id=<a>&account=<b>` | `?account=<b>` | `user_id=<b>` (canonical wins) | ✅ |
| `account=nope&user_id=<valid>` | cleaned | no `user_id` (E-3) | ✅ as designed |
| `action=a'b`; `action=USER%20LOGIN`; a 65-character action; `entity_type=a-b` | cleaned | none | ✅ |
| `action=SOMETHING_NEW` (well-formed, unregistered) | kept | sent | ✅ |
| `search=x` | cleaned (search leaves the URL) | `search=x`; the Search box is filled | ✅ |
| a 201-character `search` | cleaned | none | ✅ |
| every key empty (`severity=&action=&…`) | cleaned | none | ✅ |
| `utm=x&severity=info&tab=y` | `?utm=x&tab=y&severity=info` | `severity=info` | ✅ |
| `severity=info&severity=critical` | `?severity=info` | the first value wins | ✅ |
| `utm=x&user_id=<uuid>#frag`, then Clear | `?utm=x&account=<uuid>#frag`, then `?utm=x#frag`; Clear is then disabled | — | ✅ |
| clean URL | no `replaceState` call at all; Clear disabled | — | ✅ |
| UUID agreement: nil UUID, upper case, version digit `9` | the page sends `user_id` exactly when the route schema accepts it | — | ✅ |
| Schema parsed directly: `…T23:59:59.999999Z`, `…T00:00:00.000Z`, `…T16:51`, `…+02:00` | `safeParse` succeeds; the 6-digit fraction gives the same ms as `.999Z` | — | ✅ |
| Behaviour: Apply with both inputs emptied (custom applied) → every date, other filters kept. 30 days → `range=30d`, pressed. 30 days again → every date. Same Severity chosen again → no request. Warning → exactly one request. The archive notice is still read once | — | — | ✅ |
| Behaviour: our own write echoed (mock search set to the written string) → no re-read, typed search kept. Outside change (popstate + new search params) → re-parsed, one request, page-only search reset, preset unpressed. Back to the earlier written `range=7d` → re-read, one request | — | — | ✅ |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| Exactly one h1, text "Audit trail", while loading and once loaded | ✅ |
| `role="search"` named "Filters": exactly one, with Refresh inside it; no `region` role | ✅ |
| `role="group"` "Window" holds Today / 7 days / 30 days / This month / Custom; all `aria-pressed="false"` by default; the pressed state follows the applied preset | ✅ |
| "BOS AI failures" `aria-pressed` goes from false to true | ✅ |
| "From (UTC)" / "To (UTC)" reachable by label, `type="date"` | ✅ |
| Refresh is named "Refresh the audit trail"; `aria-busy="true"` while reading, `"false"` after | ✅ |
| Error: `role="alert"` with the server message and "Try again". From after To: `role="alert"` "The start date must not be after the end date" (pilot test) | ✅ |
| Empty: "No audit events match these filters." + "Try a wider window or fewer filters."; "Clear filters" only when filtered | ✅ |

### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| U-1: address bar = view; search never written | ✅ | Pass | Except E-1 (an outside change that parses to the current state) |
| U-2: replace only, `null` state, never `pushState` | ✅ | Pass (jsdom) | The real Next sync is B-11 / B-12 |
| U-3: defaults omitted; Clear keeps unrelated keys and the hash | ✅ | Pass | |
| U-4: invalid values ignored, per filter | ✅ | Pass | 20+ rows above |
| U-7: minute / instant / one-sided, verbatim | ✅ | Pass | |
| U-9: aliases read and rewritten; canonical wins | ✅ | Pass | |
| S-1 / Q-5: whole dates as Z instants; route accepts `.999999Z` | ✅ | Pass | Schema parsed directly |
| M-2: a way back to every date (toggle-off, Apply-empty) | ✅ | Pass | |
| M-3 / F-28: mount pin (one list + one notice); one request per change | ✅ | Pass | |
| §5.10 states (loading keeps header + bar, error, network, 403, empty) | ✅ | Pass | Dev's pilot suite, re-run green |
| Health / Jobs bar unchanged | ✅ | Pass | Their suites are unedited and green |
| Browser B-1 to B-14 | ⚠️ | Not run | Needs a signed-in admin; TL checklist below |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. Each filter change makes one request; identity holds (D-6).

#### Edge Cases (nice to fix; none blocks)

1. **E-1: An outside URL change that parses to the current state does not clean the address bar.** The `useAdminFilters.ts` write effect runs on `[filters]` only. Seen: from the default state, an outside change to `?severity=catastrophic&user_id=nope` leaves the state unchanged (correct, U-4) and makes no request (correct), but the address bar keeps `?severity=catastrophic&user_id=nope`. Likewise, an in-app link to `?user_id=<X>` while `account=<X>` is already applied keeps the legacy name. The view is right; only U-1's "the address bar always equals the view" is untrue until the next filter change. It is reachable only by an in-app link, or Back, to a junk or alias URL while already at the same filters. Severity: Low. Suggest for L-1d: also run the projection after a re-read.
2. **E-2: A linked window that mixes a bare date with a minute or instant sends the bare date verbatim** (`date_from=2026-09-25`, which means midnight in the database's timezone, not `T00:00:00.000Z`). Same as `main`, and no emitter produces it. Severity: Low; record only.
3. **E-3: `account=nope&user_id=<valid>` opens every account.** The canonical key's non-empty value wins even when invalid, and is then ignored. This matches "canonical wins", and no emitter mixes the two. Record only.

### Browser checklist for TL (V-8)

Use a signed-in admin with DevTools Network filtered to `audit-trail`. Run the checks with both dark and light colour-scheme emulation. Record one line per item here.

| # | Open / do | Must see |
|---|---|---|
| B-1 | `/admin`: click each Health figure link that opens the audit trail | Address bar `?range=custom&from=YYYY-MM-DDTHH%3Amm&to=…&action=…` (`date_from` / `date_to` gone). Chip "Linked window … to … UTC" with the tile's minutes. The request's `date_from` / `date_to` are byte-identical to the link (`…T10%3A30`, no `Z`); the rows match `main` |
| B-2 | `/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29T16%3A51&user_id=<business uuid>` | Chips "Linked window up to 2026-09-29 16:51 UTC" and "Account …". Address bar `?range=custom&to=2026-09-29T16%3A51&account=<uuid>&entity_type=ai_action`. Request has `date_to=2026-09-29T16%3A51&user_id=<uuid>` |
| B-3 | `/admin/users` → a business → its AI-failures audit link (with and without a group id) | Request has `action=BUSINESS_AI_ACTION_FAILED`, `user_id`, and `search=<group>` when present. The Search box shows the group id; the address bar never shows `search` |
| B-4 | Click 7 days, choose Severity Critical, copy the URL into a new tab; then press Back in the first tab | `?range=7d&severity=critical`; the new tab shows the same rows. Back leaves the page in one step (no added history entries) |
| B-5 | Custom: From 2026-10-01, To 2026-10-05, Apply | `?range=custom&from=2026-10-01&to=2026-10-05`. Request `date_from=2026-10-01T00%3A00%3A00.000Z`, `date_to=2026-10-05T23%3A59%3A59.999999Z`, status 200 (not 400). Rows from 5 Oct appear |
| B-6 | Custom with From after To, Apply | Inline red "The start date must not be after the end date"; no new request |
| B-7 | `/admin/audit-trail?range=bogus&severity=catastrophic&account=nope&action=a%27b` | Page at its defaults with no error. Address bar is just `/admin/audit-trail`. One 200 request with no filters |
| B-8 | `/admin/audit-trail?utm=x&severity=info`, then Clear | `utm=x` kept throughout; after Clear the URL is `?utm=x` and Clear is disabled |
| B-9 | Type in Search | One request per keystroke (as on `main`), each with `search=`; the address bar never shows the text |
| B-10 | Both schemes | One h1 "Audit trail"; date inputs and select popups dark; focus ring visible on presets, Custom, Apply, Clear, Refresh, chip X; "Read at HH:mm UTC" readable. Slow 3G reload: header + bar stay, with "Reading the audit trail…". Offline Refresh: red box with the network sentence and "Try again". A filter with no matches: the empty sentence and "Clear filters" |
| B-11 | Change one filter (e.g. Severity) | Exactly **one** new list request (none from the URL sync). Console: `history.state.__NA === true` after the write |
| B-12 | Open `/admin/audit-trail` clean → click 7 days → click "Audit trail" in the sidebar → press Back | Sidebar click: defaults, clean address bar, 7 days unpressed, one request. Back: 7 days pressed, `?range=7d`, view and URL agree |
| B-13 | After a filter change, reload | Same view and URL; one list request (+ the archive notice) |
| B-14 | Click 7 days, then 7 days again (with Severity set) | No `range` in the URL, no `date_from` / `date_to` in the request, Severity kept |

### Final Status

- [x] All automated acceptance checks pass and no bug was found. **Verdict: PASS WITH NOTES.** The notes are E-1 to E-3 (Low; no fix needed in this slice) and the browser checks B-1 to B-14, which need a signed-in admin. If TL's browser pass is clean, the slice is ready for RM.
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created (Dev workplan) | L-1c scope from §7.3 and the SA re-check conditions (R-3, R-4, RC-1, RC-6 to RC-8) plus the L-1b SA Q-13 lean; code, inbound links and test mocks verified at `6e5c4b7e`; RC-8 applied (picker to L-1d); finance URL divergence recorded; 16 questions for SA |
| 2026-10-11 | Dev implementation | Code complete, uncommitted: M-1 to M-5, S-1, S-2 folded into §3.2, §3.5, §3.10, §4.2, §6.1, §7 (V-3 (a) inverted, B-11 to B-14); tasks ticked; Implementation Notes (files, deviations D-1 to D-6, verification V-1 to V-7, user-visible changes, out-of-scope issues) |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS: Q-1 to Q-16 ruled; must-fix M-1 (`replaceState(null, …)` so Next 14.2 syncs, single last-known string, full re-parse on outside change), M-2 (way back to "every date"), M-3 (notice mounted once), M-4 (parser forms, one-sided `from` row), M-5 (browser B-11 to B-14); S-1, S-2; SA made the requirement corrections (U-2, C-7, S-3, C-6, C-8, F-97, F-98) |
| 2026-10-11 | SA code review | CODE APPROVED for QA: M-1 to M-5, S-1, S-2 verified in code; D-1 to D-6 accepted; 63 suites / 1,085 tests re-run green; optional comment-only SF-1, SF-2; notes N-1 to N-3 |
| 2026-10-11 | QA | PASS WITH NOTES: 76 suites / 1,640 tests and entitlements 230 / 6,219 green; scoped tsc canary then 0 errors; 60-case throwaway URL / schema / a11y suite green and deleted; no bugs; edge cases E-1 to E-3 (Low); browser B-1 to B-14 handed to TL |
| 2026-10-11 | RM commit + PR | Commit 1752d93d on `feature/admin-layout-l1c`; origin/main merged in (5b354100, clean; brought finance 1b, credits boost 6b, SECURITY DEFINER 4a — no `app/admin/components/layout` or `audit-trail` files); post-merge 76 suites / 1,648 tests, entitlements 233 / 6,382, hooks lint clean; PR #291 open, not merged |
