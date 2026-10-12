# Workplan: Admin Layout Standard — Slice L-10 (Business OS AI: Settings tab)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 16), §4.11 (Settings tab), §4.16 E, §4.17 (`Chip`), §5.2 T-5, §5.3, §5.4 (K-1 to K-10), §5.5 (Refresh-only bar, part 6), §5.7 (non-table content), §5.9, §5.10, §5.11, §5.12, §6.1, §6.2 C-2, C-3, C-4, C-5, C-8, C-11, C-12, C-14, §7.13, §9 F-67 (Settings half), F-69, F-75, F-115, F-116 (Settings half), F-120, §10 D-4 (a), D-15, §12.3; SA rulings SA-R-3, SA-R-4 (K-5, all tiles neutral), R-7, R-9; the L-8 workplan review Q-3 (registry deferred to L-10); the L-9b code review F-120 ruling ("take it with L-10 or the next Costs touch, with its own render case")
**Skills applied:** `bos-llm-call-standards` read for scope only: no AI call, no model setting, no route change (the tab stays one read-only `GET`). `business-os-entitlements`: not triggered (no import from `lib/business-os/entitlements/`, no tier or capability literal). `business-os-schema-check`: not triggered (no DB claim; only payload fields the tab already reads, `types.ts`). `tenant-isolation-guard`: not triggered (no write, no service-role path). No queue
**Branch:** `feature/admin-layout-l10`, cut from `feature/admin-layout-l9b` at 4438d20a. That branch stacks the open PRs #319 (L-8a), #320 (L-8b), #321 (L-9a), #322 (L-9b); the L-10 PR targets `main` and carries them until they merge. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-12
**Status:** ✅ Merged 2026-10-12 — PR #324 (merge commit 82469a8a), fast-track (SA code review APPROVED WITH FIXES, F-1 to F-3 applied; QA PASS WITH NOTES). Commits b43bce03 (Settings) and 38fae090 (task 9, F-120), merged with origin/main (8cc62d79, 07e308d3). Browser checks QB-1 to QB-12 owed. SA workplan review 2026-10-12: APPROVED WITH CONDITIONS; M-1 to M-6 and S-1 to S-4 applied to this file before coding. Task 9 (F-120) is two files only, separable for its own commit (M-6)
**Path:** **UI short path** by classification: no shared source file changes (the only shared-folder edit is the registry entry in the shared guard's test file, the L-5 / L-6 / L-7 precedent). If SA rules any shared export is needed (Q-3 is the only candidate, and the plan avoids it), the slice becomes full cycle (R-7)

## Overview

L-10 finishes the Business OS AI page (`/admin/business-os-llm`) by moving its **Settings** tab onto the standard: a four-tile neutral KPI strip, the Refresh-only bar (Refresh leaves the header), the shared loading / error / empty states, the read through `readAdminResponse` (the last `.json(` in `page.tsx` goes), `StatusChip` instead of the page's own `Chip` on the area cards and call rows, shared UTC times, and slate-400 for every information line. The page then joins the migrated-pages registry (deferred here by SA L-8 Q-3). As a separate, last task it also takes F-120 (two Costs amber lines onto the shared notice), which SA ruled could go with L-10. The tab is read-only today and stays read-only: one `GET`, no writer, no break-glass (business-os-llm slices 3 and 4 not built; verified in §1.3).

## Table of Contents

1. [Analysis Summary](#1-analysis-summary-code-verified-at-4438d20a)
2. [Scope and decisions](#2-scope-and-decisions)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Guard and registry changes](#5-guard-and-registry-changes)
6. [Tests](#6-tests)
7. [Verification](#7-verification)
8. [Task List](#8-task-list)
9. [Sizing and path](#9-sizing-and-path)
10. [Risks](#10-risks)
11. [Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
12. [Questions for SA](#12-questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## 1. Analysis Summary (code verified at 4438d20a)

### 1.1 The Settings tab today

| Part | Today | Where |
|---|---|---|
| Header | Shared `AdminPageHeader` since L-8a: h1 "Business OS AI", "Read-only" neutral chip, purpose `PAGE_SUBTITLE` on Settings | `page.tsx:257-285` |
| Refresh | In the header's `actions`, wrapped in `<div hidden={!onSettings}>`: "read at {date time} UTC" in `text-slate-500` plus an icon-only button with `title="Re-read the settings"`, **no aria-label**, `h-5 w-5` icon (F-69, §4.16 E). §5.3 says Refresh is never in the header | `page.tsx:261-284` |
| Read | `fetch('/api/admin/business-os/llm-settings')` then `response.json()` directly: a non-JSON body puts a parser message on screen, a network failure shows the browser's text (F-67, Settings half). The last `.json(` in `page.tsx` | `page.tsx:231-248` |
| States | Error: own red box, `data-testid="page-error"`, no Try again. Loading: own spinner "Reading the settings…" only while there is no payload. Empty: none, zero areas render a blank panel (F-75). Failed refresh keeps the cards and shows the error above them | `page.tsx:341-371` |
| Standing note | `<p data-testid="page-standing-note">` in `text-slate-500` (information text, T-5) | `page.tsx:337-339` |
| KPI strip | None | — |
| Area card | `<article>` in `rounded-xl border border-slate-700 bg-slate-800/40` (already the §5.7 card shell); the title is an `<h3>` **inside** the disclosure `<button>`; chips from the page's own `Chip` (`warn` amber, `quiet` slate, `accent` purple) | `AreaCard.tsx:121-195` |
| Call row | Field labels, the call-name caption and "(code default: …)" in `text-slate-500`; the "Configured: off" chip is `Chip warn` with a `title` | `CallRow.tsx:82-90`, `:110-116`, `:180-189` |
| Excluded call row | Caption `text-slate-600`, reason `text-slate-500` | `ExcludedCallRow.tsx:37-47` |
| Stored row panel | Key and "Written at …" in `text-slate-500`; time via the page's `formatInstant` | `StoredRowPanel.tsx:33`, `:49`, `:56` |
| Last changed line | Time via `formatInstant` (null-safe; an unparseable value is shown raw) | `LastChangedLine.tsx:43-44` |
| Expanded card notes | "read-only note" and "marker legend" in `text-slate-500` | `AreaCard.tsx:201`, `:225` |

### 1.2 The route (not touched)

`GET /api/admin/business-os/llm-settings` (`app/api/admin/business-os/llm-settings/route.ts:53-87`): `requireAdmin` first; 200 `{ success: true, data: SettingsPayload }`; 500 `{ success: false, error: 'Could not read the Business OS AI settings' }` (a user-facing sentence, so §5.10 rule 1 shows it verbatim); 401 / 403 from the shared gate. `SettingsPayload` is `{ areas: AreaView[], generatedAt: string }` (`types.ts`). The `…/ledger` route is the parked panel's only reader and is not called by the mounted page (pinned by `page.render` R-T4).

### 1.3 Read-only: verified

| Check | Result |
|---|---|
| Network calls from the Settings tab | Exactly one: `fetch('/api/admin/business-os/llm-settings')` with no `init` (default `GET`), on mount and on Refresh (`page.tsx:235`, `:250-252`, `:273`) |
| Write paths | **None.** No `method:`, no `POST` / `PATCH` / `PUT` / `DELETE`, no `<form>`, no `<input>`, `<select>` or `<textarea>` in `page.tsx`, `AreaCard.tsx`, `CallRow.tsx`, `ExcludedCallRow.tsx`, `StoredRowPanel.tsx`, `LastChangedLine.tsx`, `Marker.tsx`. The only buttons are the card disclosure, the stored-row disclosure and Refresh. `page.render` "the excluded rows are inert" and R-T1 pin the absence of controls |
| Both route files | `llm-settings/route.ts` and `llm-settings/ledger/route.ts` export `GET` only |
| Parked writer surface | `LedgerCheckPanel.tsx` is a reader (`GET …/ledger`) and is not mounted (FR-3; `source.guard` R-T4) |
| Record | Matches the business-os-llm record: slices 3 (writer) and 4 (break-glass) are not built; changing a value is still `npm run bos:llm-settings` (runbook §3), as the page header comment says (`page.tsx:24-27`) |

So the rule "leave any write path byte-identical" has nothing to protect beyond the one `GET`, whose request (URL, method, no init, no body) stays byte-identical.

### 1.4 Who else depends on these files

| Dependent | On what | L-10 effect |
|---|---|---|
| `app/api/admin/health-summary/route.ts:53`, `:92` | `areaOffSummary` from `areaState.ts` | None: `areaState.ts` is not edited; the KPI strip only calls it |
| `components/activity/RecordStateMarker.tsx:14` | `Chip` | `Chip.tsx` stays (Activity's; F-116 tidy-up) |
| Activity files, `LedgerCheckPanel.tsx` | `formatInstant`, `toSinceParam` in `format.ts` | `format.ts` stays; only the Settings files move to `formatUtc` |
| `costsTab.render.test.tsx:366` | `queryByTitle('Re-read the settings')` | Edited (§6.2) |
| `activityLayout.render.test.tsx:434` | **page-wide** count of `kpi-placeholder` = 4 while the Activity tab loads | Must stay green: Settings regions render only while Settings is shown (§2.2, R-1) |
| `activityLayout.render` / `tabCoexistence.render` / `costsLayout.render` | Stub the Settings read with `{ areas: [], generatedAt: null }` | Green: on a hidden Settings tab nothing new renders; `generatedAt: null` gives no "Read at" |
| `tests/helpers/bos-llm-admin-fixtures.ts` `stubFetch` | Returns `{ ok, status, json }` | Compatible with `readAdminResponse` (it reads only `ok`, `status`, `json()`, RC-2) |
| `lib/business-os/llm/__tests__/adminSettingsView.test.ts` | The fixtures only | None |

---

## 2. Scope and decisions

### 2.1 In L-10

1. The Settings read through `readAdminResponse` (`what: 'the settings'`, `sessionEndedCopy: true`, Q-2); a rejected `fetch` shows `ADMIN_NETWORK_ERROR`. `page.tsx` has no `.json(` left (F-67 Settings half).
2. Refresh leaves the header: a Refresh-only `AdminFilterBar` (plain `<div>`, §5.5) in the Settings panel, `what="the settings"` (accessible name "Refresh the settings", D-15, F-69), `readAt={payload?.generatedAt ?? null}` ("Read at HH:mm UTC", the Costs / Activity precedent). The header gets no `actions` on any tab. The slate-500 "read at" line goes with it (F-116 Settings half).
3. KPI strip `SettingsKpis.tsx`: four tiles per §7.13, all neutral (SA-R-4, D-4 (a)); §2.3.
4. Shared states: `AdminLoading what="the settings"` (the words "Reading the settings…" are today's), `AdminError testId="page-error" onRetry={load}`, `AdminEmpty` for zero areas (F-75, copy in Q-5), the content area `aria-busy` while reading.
5. The standing note: same words, same place above the cards, `text-slate-400` (T-5); kept non-amber (`page.render` R-T3).
6. Area card and call row chips on `StatusChip` (§5.9, F-62 pattern), keeping every test id and every `title` through a wrapper span (the L-5 PlanCard precedent, no shared change); tones in §2.4.
7. T-5 across the mounted Settings components: every `text-slate-500` / `text-slate-600` information line becomes `text-slate-400` (§2.5).
8. Times on the Settings components through the shared `formatUtc` (C-5): `LastChangedLine.tsx`, `StoredRowPanel.tsx` (§2.6).
9. Area cards gain a stable `id` so the two anchor tiles have a target.
10. The page joins the migrated-pages registry (§5).
11. **Separate last task, F-120:** the Costs "unreadable amounts" and "names failed" lines onto `AdminNotice` (§2.8).

### 2.2 Decision: where the Settings regions sit, and when they render

Inside the Settings `tabpanel`, in the §5.1 order: **KPI strip → bar → standing note → content area** (error, loading, empty, cards). The standing note stays between the bar and the cards because "the reason a card can be wrong has to be read before the card is" (`page.tsx:329-336`) and it is a §5.10 "partial" caveat about the content; it is not a filter-bar help line (it is about the values, not one control).

**Rendering rule (amended by SA M-1):** the strip, the bar and the state blocks (error, loading, empty, cards) render only while Settings is the visible tab (`onSettings &&`), exactly as the state blocks do today. **The standing note is the exception:** it keeps rendering on every tab, inside the Settings panel, hidden with it (today's `hidden={!onSettings}`), because `costsTab.render:365` asserts it is present and not visible on Costs. The content-area wrapper that carries `aria-busy` is always mounted while Settings is shown (§5.8 D-7 focus fallback). Why: Costs and Activity are kept mounted hidden, and Settings is kept mounted hidden behind them; a page-wide query in a hidden-tab suite (`activityLayout.render:434`, four `kpi-placeholder` while Activity loads) would otherwise count Settings' placeholders too. The read itself is unchanged: on mount, whatever tab is shown (today's behaviour; switching back to Settings does not re-read).

The header passes no `actions`, so its DOM on every tab is the plain shared header with the badge. The page header comment (`page.tsx:49-55`, "unchanged until L-10") is rewritten.

### 2.3 Decision: the KPI strip (§5.4, §7.13)

Every value comes from the payload already read (K-9), counted with the card's own rules so a tile and the cards can never disagree.

| Tile | Value | Sub-line | Target | Colour |
|---|---|---|---|---|
| Areas | `areas.length` | — | none (not a link, K-6) | neutral |
| Calls | Sum over areas of `calls.length + (excludedCalls ?? []).length`, the card's `call-count-chip` rule (FR-9, `AreaCard.tsx:114-117`) | — | none | neutral |
| Calls configured off | Sum of `areaOffSummary(area).offCalls` (the card's "N calls configured off" chips) | "plus N areas configured off" when any `areaShowsOff` (Q-1) | anchor `#bos-llm-area-{area}` of the first area with `offCalls > 0` or `areaShowsOff`; none when there is none | neutral |
| Row issues | Sum of `areaIssues.length` (the card's `area-issue-chip`) | — | anchor to the first area with `areaIssues.length > 0`; none when 0 | neutral |

- SA Q-1: the Calls configured off tile links when either `offCalls` or `areaShowsOff` is above 0. S-3: `KPI_AREAS_OFF(n)` handles the singular ("plus 1 area configured off"). S-4: `SettingsKpis.tsx` binds `area.excludedCalls ?? []` as `AreaCard.tsx` does (QA EDGE-1). S-2: each anchor href is built inline in the `href` prop (a template string stored in a variable widens to `string` and fails the `#${string}` type).
- Numbers via `formatCount`. Labels and the sub-line in `copy.ts`. No tile names an area (so `page.render`'s `getByText(areaName)` stays unique).
- K-10: placeholders (4) while the first read has no payload and no error; on an error the strip is hidden (the L-5 precedent: a failed refresh keeps the cards, hides the strip).
- All neutral (SA-R-4): the payload carries no status, and Health's `settings.off` rule counts "areas or calls", which is not this sum. The cards' amber chips stay as they are.
- Anchor target: `AreaCard`'s `<article>` gains the id `bos-llm-area-{area}` (built as a template string from `area.area`; area names are catalogue identifiers such as `chat`, `insights`). The anchor scrolls to the collapsed card, whose header already shows the matching chip; it does not expand the card (no new behaviour). The page's tab writer already drops the hash on a tab switch (L-9a).

### 2.4 Decision: chips on `StatusChip` (§5.9)

| Chip (test id) | Today | L-10 | Why |
|---|---|---|---|
| `state-chip` "Configured: off" | `Chip warn` | `StatusChip warn` (amber + `AlertTriangle`) | Same meaning, now with the icon (A-7) |
| `calls-off-chip` "N calls configured off" | `Chip warn` | `StatusChip warn` | As above |
| `area-issue-chip` "N row issues" | `Chip warn` | `StatusChip warn` | As above |
| `call-state-chip` "Configured: off" (`title` CALL_OFF_TITLE) | `Chip warn` | `StatusChip warn` in a `<span data-testid title>` wrapper | Keeps the pinned `title` |
| `call-count-chip` "N calls" | `Chip quiet` | `StatusChip neutral` | Plain state words |
| `set-per-call-chip` "N set per call" (`title`) | `Chip accent` (purple) | `StatusChip info` in a wrapper (Q-4) | Purple is reserved for the active preset, focus and primary buttons (T-7) |

`StatusChip` takes `children: string`, so each label is built as one template string ("3 calls", "1 row issue"); the words do not change. Where a `title` is pinned, the wrapper span carries `data-testid` and `title` and the chip inside carries no test id (`page.render` reads `getByTestId('set-per-call-chip').getAttribute('title')` and the text through the wrapper). Visible change: chips become `text-xs px-2` (was `text-[11px] px-1.5`) and the warn chips gain an icon.

`Chip.tsx` is not deleted: `RecordStateMarker.tsx` (Activity) still uses it (noted on F-116).

### 2.5 Decision: T-5 on the Settings components

| Line | File | Today | L-10 |
|---|---|---|---|
| "read at …" | `page.tsx:267` | slate-500 | removed (the bar's "Read at") |
| Standing note | `page.tsx:337` | slate-500 | slate-400 |
| Read-only note, marker legend | `AreaCard.tsx:201`, `:225` | slate-500 | slate-400 |
| Field label, call-name caption, "(code default: …)" | `CallRow.tsx:85`, `:182`, `:112` | slate-500 | slate-400 |
| Excluded caption / reason | `ExcludedCallRow.tsx:39`, `:44` | slate-600 / slate-500 | slate-400 both (Q-6) |
| Stored-row key, "Written at …" | `StoredRowPanel.tsx:49`, `:56` | slate-500 | slate-400 |

The excluded rows stay visibly quieter than configurable rows through their own darker shell (`border-slate-800 bg-slate-900/40`), which is unchanged; their "quiet, not amber" intent (`ExcludedCallRow.tsx:30-33`) holds. Amber issue lines, lock reasons and the area-off caveat are inline caveats, not notices, and stay as they are.

### 2.6 Decision: times (§5.11, C-5)

`LastChangedLine.tsx` and `StoredRowPanel.tsx` print through the shared `formatUtc` (same "YYYY-MM-DD HH:mm UTC" through `Date`). Their absent-time branches keep their words: `formatUtc` answers an em dash for null or an unreadable value, and the components treat that as "(time not recorded)" / "No write timestamp recorded". **Recorded change:** an unparseable timestamp, which `formatInstant` showed raw, now reads as not recorded (never reachable from a real row; the route sends ISO). `format.ts` stays (Activity and the parked panel use `formatInstant` / `toSinceParam`); `lastChanged.render`'s `formatInstant` case stays green unedited. **S-1:** each file decides "not recorded" once (the `formatUtc` result compared to the em dash, the `HealthGrid.tsx` / `adminFormat.ts` precedent); the `LastChangedLine.tsx` header paragraph that names `formatInstant` is rewritten, keeping the 1970 reason; the `page.tsx` header's "the only network calls are two `GET`s" is corrected to one Settings `GET` (the ledger reader is parked).

### 2.7 Decision: the read and states (§5.10, C-3, C-4)

```text
load():
  setLoading(true); setError(null)          (unchanged: data stays, error clears)
  try   response = await fetch('/api/admin/business-os/llm-settings')   (byte-identical)
  catch setError(ADMIN_NETWORK_ERROR); setLoading(false); return
  result = await readAdminResponse<SettingsPayload>(response, { what: 'the settings', sessionEndedCopy: true })
  ok     -> setPayload(result.data)
  not ok -> setError(result.message)          (payload kept: a failed refresh keeps the cards)
  finally setLoading(false)
```

| Answer | Today | L-10 |
|---|---|---|
| 200 success | cards | cards (unchanged) |
| 500 with the route sentence | that sentence | that sentence (rule 1) |
| Non-JSON body (proxy 502 page) | parser message | "Could not read the settings. Try again in a moment." |
| 401 / 403 | the gate's string | "Your admin session has ended. Sign in again." (Q-2) |
| `fetch` rejected | browser text ("Failed to fetch") | `ADMIN_NETWORK_ERROR` |

`AdminError` keeps the `page-error` test id (on the message, RC-3) and adds Try again, which calls the same `load`. No abort and no newest-wins are added: Refresh and Try again cannot overlap a read (Refresh is disabled while busy; the error and its Try again are cleared when a read starts), which is today's behaviour.

### 2.8 Decision: F-120 (Costs amber lines) — recommended in L-10, as its own last task

**Recommendation: take it in L-10, as task 9, separate from the Settings work and with its own render case.** Reasons: it is two JSX blocks in `CostsTab.tsx`; the page's registry entry lands in this slice and lists `CostsTab.tsx`, so closing the page's last non-standard amber lines here leaves the registered page fully on the standard; waiting for "the next Costs change" has no date.

What changes: `costs-unreadable` and `costs-names-failed` each become their own `AdminNotice` (test id on the text element, so `toHaveTextContent` pins hold), same words, same order, after the incomplete notice. **No merge into one notice and no new copy:** each states a different missing thing (§5.10 Partial), and all three conditions at once is the rare worst case. If SA prefers one merged notice (SA's own L-9b concern), that needs new copy and becomes Q-7's other branch; if SA prefers to defer, task 9 is dropped with no effect on tasks 1 to 8.

### 2.9 What stays as it is

The request; `types.ts`, `areaState.ts`, `markers.ts`, `format.ts`, `Chip.tsx`, `Marker.tsx`; `LedgerCheckPanel.tsx` (parked, not mounted, still `.json(` and slate-500: slice 3's to revisit); the tabs, `?tab=` handling and the Costs / Activity bodies (except task 9); every copy string except the new KPI labels, sub-line and empty sentence; the one-card-at-a-time expansion; the disclosure markup (F-122); the header purpose and badge; every test id.

### 2.10 Visible changes on `/admin/business-os-llm?tab=settings` (named in the PR)

1. No Refresh in the header on any tab; on Settings a bar under the strip reads "Read at HH:mm UTC" and a text "Refresh" button (was an icon with only a hover title, and "read at" with the date).
2. A strip of four plain tiles: Areas, Calls, Calls configured off, Row issues; the last two jump to the first card that has one.
3. Errors: the shared red box with Try again; a non-JSON answer or a dropped connection shows fixed words instead of a parser or browser message; an ended session says so.
4. Zero areas shows a sentence instead of an empty panel.
5. Chips: slightly larger, amber ones with a warning icon, "set per call" sky instead of purple.
6. Lighter grey for the standing note, field labels, captions, legends, excluded-call text and stored-row lines.
7. (Task 9) On Costs, "unreadable amounts" and "names failed" as amber notice boxes instead of amber text lines.

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

**No source change.** Used as they are: `AdminPageHeader` (no `actions`), `KpiStrip` / `KpiTile` (anchor and no-target modes), `AdminFilterBar` (Refresh-only branch), `AdminLoading` / `AdminError` / `AdminEmpty` / `AdminNotice`, `StatusChip` (`warn`, `neutral`, `info`), `readAdminResponse` + `ADMIN_NETWORK_ERROR`, `formatUtc`, `formatCount`. One test-file edit: the registry entry (§5).

### 3.2 Page folder (`app/admin/business-os-llm/`)

- `page.tsx`: the read (§2.7); header without `actions`; the Settings panel per §2.2; `RefreshCw` / `AlertCircle` / `formatInstant` imports removed; header comment's L-8a paragraph replaced by an L-10 paragraph.
- `components/SettingsKpis.tsx` (new): props `{ payload: SettingsPayload | null; firstLoad: boolean }`; the CostsKpis shape.
- `copy.ts`: `SETTINGS_WHAT`, the four KPI labels, `KPI_AREAS_OFF(n)` sub-line, `SETTINGS_EMPTY` (Q-5).
- `AreaCard.tsx`, `CallRow.tsx`: `StatusChip` (§2.4), slate-400 (§2.5), the article `id` (§2.3).
- `ExcludedCallRow.tsx`, `StoredRowPanel.tsx`, `LastChangedLine.tsx`: slate-400, `formatUtc` (§2.5, §2.6).
- Task 9 only: `components/costs/CostsTab.tsx` two blocks (§2.8).

No `console.*`, no `any`, no `@/lib/` import (the BOS AI guard's rule is not edited, R-9).

### 3.3 Kept identical

The `fetch` call line, the mount effect, `loading` / `error` / `payload` semantics (data kept on failure), the expansion state, `TABS`, `writeTabToUrl`, `owns`, `PURPOSE`.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-llm/page.tsx` | modify | Read on `readAdminResponse`, no `.json(`; Refresh into a Refresh-only bar; strip; shared states; empty; standing note slate-400; header comment |
| `app/admin/business-os-llm/components/SettingsKpis.tsx` | create | The four-tile neutral strip (§2.3) |
| `app/admin/business-os-llm/copy.ts` | modify | KPI labels, sub-line, `SETTINGS_WHAT`, `SETTINGS_EMPTY` |
| `app/admin/business-os-llm/components/AreaCard.tsx` | modify | `StatusChip`, slate-400, article `id` |
| `app/admin/business-os-llm/components/CallRow.tsx` | modify | `StatusChip` (wrapper for the `title`), slate-400 |
| `app/admin/business-os-llm/components/ExcludedCallRow.tsx` | modify | slate-400 |
| `app/admin/business-os-llm/components/StoredRowPanel.tsx` | modify | `formatUtc`, slate-400 |
| `app/admin/business-os-llm/components/LastChangedLine.tsx` | modify | `formatUtc` |
| `app/admin/business-os-llm/components/costs/CostsTab.tsx` | modify (task 9) | F-120 |
| `app/admin/business-os-llm/__tests__/settingsLayout.render.test.tsx` | create | §6.3 |
| `app/admin/business-os-llm/__tests__/costsTab.render.test.tsx` | modify | §6.2 E-1; task 9 case F-1 |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | modify | G-7, G-8 (§5) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Registry entry + "Amended by L-10" header paragraph (§5) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 16 now; at code complete §7.13 as built, §9 dispositions and new findings |
| `docs/workplans/ADMIN_LAYOUT_L10_WORKPLAN.md` | create | This plan |

Not touched: any route, `lib/**`, `tests/helpers/**`, `types.ts`, `areaState.ts`, `markers.ts`, `format.ts`, `Chip.tsx`, `Marker.tsx`, `LedgerCheckPanel.tsx`, `components/activity/**`, `components/costs/*` other than `CostsTab.tsx` (task 9), every shared source file, the sidebar.

---

## 5. Guard and registry changes

**BOS AI `source.guard.test.ts`** (R-9: the "no `@/lib/`" rule is not edited). New cases, each with a planted-string self-test (no dead regex), as G-1 to G-6 do:

| # | Rule | Why |
|---|---|---|
| G-7 (SA M-2) | **Walked, not listed:** `page.tsx` plus every `.ts` / `.tsx` directly under `components/` (not its subfolders, which G-3, G-5 and G-6 own), excluding by name `LedgerCheckPanel.tsx` (F-123) and `Chip.tsx` (Activity's, F-116). A walk case asserts `AreaCard.tsx`, `CallRow.tsx` and `SettingsKpis.tsx` are in scope. Each file: no word-bounded `text-slate-500` / `text-slate-600` class (self-test: `border-slate-600` and `text-slate-400` do not match), no import of `./Chip` / `../Chip`, no import of `formatInstant`; `fetch(` only in `page.tsx` | T-5, §5.9, C-5; reads stay where they are |
| G-8 (SA M-3) | (a) Walked: no file in the page folder calls `.json(` except those in `PARKED_JSON`, which holds exactly `components/LedgerCheckPanel.tsx`; (b) no screen file other than `LedgerCheckPanel.tsx` itself names `LedgerCheckPanel` in code (`codeOf`), so neither `page.tsx` nor a card can mount it; (c) the exception expires loudly: a case asserts the parked file still contains `.json(`, so the day slice 3 converts it, this case fails and the exception must be deleted (the L-9a `JSON_UNTIL_L9B` pattern) | F-67 closed for the mounted page; the parked panel is slice 3's |

G-1 (no original picker), G-2 (alias only), G-3 / G-5 / G-6 (Activity and Costs folders) and G-4 (history writer) need no edit and cover the new file by walking the folder.

**Shared `layoutFolder.guard.test.ts`:** a registry entry for `/admin/business-os-llm (Business OS AI)` listing every mounted file with markup or a read: `page.tsx`, `SettingsKpis.tsx`, `AreaCard.tsx`, `CallRow.tsx`, `ExcludedCallRow.tsx`, `StoredRowPanel.tsx`, `LastChangedLine.tsx`, `Marker.tsx`, the Activity files (`ActivityTab`, `ActivityKpis`, `ActivityFilterBar`, `ActivityTable`, `ActivityCountLine`, `ActivityDrillDown`, `DrillDownCharges`, `AuditSummaryLine`, `CutoverNotice`, `DeletedAccountsBucket`, `RecordStateMarker`) and the Costs files (`CostsTab`, `CostsKpis`, `CostsFilterBar`, `CostsSections`, `LeakCheckPanel`), and (SA M-4) the three filter-spec modules `activityFilters.ts`, `costsFilters.ts` and `tabWindowFilter.ts` (they import the shared folder, so the alias rule bites on them). **Not listed, with the reason in a comment (the G-6 precedent):** `LedgerCheckPanel.tsx` (parked, not mounted, still `.json(`); `Chip.tsx` (no markup rule at stake, Activity-only consumer); plain modules with no markup and no read (`types.ts`, `copy.ts`, `*Copy.ts`, `*Types.ts`, `format.ts`, `costFormat.ts`, `markers.ts`, `areaState.ts`, `tabWindowFilter.ts`, `activityPresets.ts`). The entry asserts the existing four rules (files exist, `AdminPageHeader` imported by one of them, no own `<h1`, no direct `.json(`, alias only). Plus the header paragraph "Amended by L-10: Business OS AI joins the registry; no rule change and no shared source change". No rule change.

---

## 6. Tests

### 6.1 Order

Baseline first, on the branch as is: `npx jest app/admin/business-os-llm app/admin/components --ci` and `npm run test:bos-llm`, counts recorded. `page.render.test.tsx` (the Settings characterisation suite, 1,086 lines) and `lastChanged.render.test.tsx` must pass **unedited** at the end; every other existing case not listed in §6.2 too.

### 6.2 Edited deliberately (each named in the PR)

| # | Test | Edit | Why |
|---|---|---|---|
| E-1 | `costsTab.render:366` | `queryByTitle('Re-read the settings')` not visible → `queryByRole('button', { name: 'Refresh the settings', hidden: true })` is null on Costs, and present again on Settings | F-69 / D-15: the control is renamed and moves into the Settings panel, which renders it only on Settings (§2.2) |

No other edit is expected. `page.render`'s subtitle pin, standing-note pins (words, position before the cards, no amber or red class), area-name lookups, chip test ids and `title`s, "excluded rows are inert" and the `page-error` absence all hold by construction (§2.4, §2.5).

### 6.3 New: `settingsLayout.render.test.tsx`

Page rendered through `BusinessOsLlmSettingsPage` with a mocked `fetch` (the `stubFetch` shape, plus local answers for the failure cases); `console.error` / `console.warn` spied in every case.

| # | Case |
|---|---|
| S-1 | Header: exactly one h1, the badge, no button inside `<header>` on Settings, Costs or Activity |
| S-2 | Bar: plain `<div>` (no `role="search"`), "Read at 09:00 UTC" from `generatedAt`, button "Refresh the settings"; not in the document on Costs or Activity |
| S-3 | Refresh: one more call, same URL, called with one argument (no `init`, so `GET`, no body); cards stay mounted while the second read is pending; content area `aria-busy="true"` then `"false"`; the button is disabled while busy |
| S-4 | Requests: on mount exactly one call to `/api/admin/business-os/llm-settings`; no `/ledger`; across S-1 to S-12 no call carries a `method` or a body |
| S-5 | Loading: `AdminLoading` "Reading the settings…" (`role="status"`), header and tabs present, four `kpi-placeholder`, no bar data |
| S-6 | Errors: 500 with the route sentence → that sentence in `page-error` inside `role="alert"`; non-JSON → "Could not read the settings. Try again in a moment."; 403 → the session sentence; `fetch` rejection → `ADMIN_NETWORK_ERROR`, never "Failed to fetch"; Try again re-reads and recovers |
| S-7 | Failed refresh: cards kept, error shown, strip hidden (K-10) |
| S-8 | Empty: zero areas → `AdminEmpty` with `SETTINGS_EMPTY`, no Clear filters button; strip shows Areas 0, Calls 0 and no links |
| S-9 | KPI values on the seed fixture and on a planted fixture (one area off, one area on with two calls off, one area with row issues, chat with excluded calls, one area with no `excludedCalls` key, S-4): the four values, the singular "plus 1 area configured off" sub-line (S-3), every tile `data-status="neutral"`; Areas and Calls are not links; the two others link to the right `#bos-llm-area-…`, and that id exists on the card |
| S-10 | Chips: tones (`data-tone`) per §2.4, an `aria-hidden` icon on every warn chip, the words unchanged, `set-per-call-chip` and `call-state-chip` still carry their `title` |
| S-11 | T-5: with every card expanded and the stored row open, no element in the Settings panel has `text-slate-500` or `text-slate-600` |
| S-12 | Times: `updatedAt` / `lastChangedBy.at` with `+02:00` → the UTC time ending "UTC"; null → the absent words; no "1970" |
| F-1 (task 9, in `costsTab.render`) | Report with `unreadableAmounts: 3` and `sections.names: 'failed'`: each line inside an amber `AdminNotice`, words unchanged, no `role="alert"`; (SA M-6) with all three conditions set exactly three `AdminNotice` boxes render in the order incomplete, unreadable, names failed, and `costs-incomplete` is unchanged |

Plus the G-7 / G-8 planted-string self-tests and one **mutation run** each, reverted (recorded in the Implementation Notes): (a) put `.json(` back in `page.tsx` → G-8 and the registry fail; (b) restore `text-slate-500` on the standing note → G-7 and S-11 fail; (c) give the Calls configured off tile `status="amber"` → S-9 fails; (d) render the Settings strip on every tab → `activityLayout.render:434` fails.

### 6.4 Must stay green with no edit

`page.render`, `lastChanged.render`, `ledgerPanel.render`, `activityTab.render`, `activityLayout.render`, `activityDrillDown.render`, `tabCoexistence.render`, `costsLayout.render`, `leakPanel.render`, `nav.test`, every shared-folder suite, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/__tests__/tailwind-css-escape.guard.test.ts`, `npm run test:bos-llm`.

---

## 7. Verification

| # | Command | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/business-os-llm app/admin/components lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | All green; counts = baseline + new cases |
| V-2 | `npm run test:bos-llm` | Green |
| V-3 | `npm run typecheck:bos-llm` | 0 new |
| V-4 | Scoped `tsc` on a scratch tsconfig over `app/admin/business-os-llm/**` and `app/admin/components/layout/**`, canary first (the L-9 QA method) | Canary fails, then exit 0 |
| V-5 | `npm run lint:hooks` | Clean |
| V-6 | `git diff --stat 4438d20a -- app/api lib tests app/admin/components/layout/*.ts app/admin/components/layout/*.tsx app/admin/business-os-llm/components/activity app/admin/business-os-llm/components/LedgerCheckPanel.tsx app/admin/business-os-llm/types.ts app/admin/business-os-llm/areaState.ts app/admin/business-os-llm/format.ts` | Empty |
| V-7 | `grep` the page folder for `console.`, `as any`, `: any`, `.json(` (only `LedgerCheckPanel.tsx`), `text-slate-500` / `text-slate-600` in the Settings files (none), `method:` (none) | As stated |
| V-8 | `git diff --stat` before reading the diff (the truncation hazard): no file emptied or deletion-only | As stated |

### 7.1 Browser checks for QA / TL (signed-in admin, DevTools Network and Console open, light and dark emulation). Read-only: nothing on this tab can change a setting

| # | Check |
|---|---|
| QB-1 | `/admin/business-os-llm` (Settings): header shows the title, the "Read-only" chip and the Settings purpose; **no** Refresh in the header. Switch to Costs and Activity: still none in the header |
| QB-2 | Settings strip: four plain tiles (no coloured border); Areas and Calls match the cards (Calls includes chat's not-configurable calls); Areas and Calls are not clickable |
| QB-3 | If any call or area is configured off, or any row issue exists: the tile is a link and jumps to the first card showing that chip; else the tile shows 0 and is not a link |
| QB-4 | Bar: "Read at HH:mm UTC" and a text "Refresh" button. Press Refresh: Network shows exactly one `GET /api/admin/business-os/llm-settings`, nothing else (no `/ledger`, no other method); cards stay on screen while reading |
| QB-5 | Tab to Costs and back to Settings: no new settings request; the strip and bar return as they were |
| QB-6 | Chips: amber ones with a warning icon, "N calls" grey, "N set per call" sky; hovering "set per call" and a call's "Configured: off" still shows the explanation |
| QB-7 | Expand a card: read-only note, legend, field labels, call-name captions and "(code default: …)" readable; excluded chat calls still look quieter than the configurable ones |
| QB-8 | Open "Stored row": "Written at … UTC"; the last-changed line shows a UTC time or "(time not recorded)" |
| QB-9 | DevTools offline, press Refresh: "Could not reach the server. Check your connection and try again." with Try again; cards stay; strip hidden. Back online, Try again: recovers |
| QB-10 | Light and dark emulation: strip, bar, chips, error box and card text look right in both |
| QB-11 | Console: no errors or React warnings through all of the above |
| QB-12 (task 9) | Costs: only if an "unreadable amounts" or "names failed" line shows naturally, it is an amber box with an icon; otherwise skip (jsdom F-1 covers it) |

Still owed from earlier slices on this page (not L-10): L9-B4 / L9-B5 (real Next tab sync), the L-9b QB-1 to QB-10.

---

## 8. Task List

- [x] ✅ 1. Baseline run (§6.1), counts recorded
- [x] ✅ 2. `copy.ts` additions; `SettingsKpis.tsx`
- [x] ✅ 3. `page.tsx`: read on `readAdminResponse`, header without actions, Settings panel regions and states, standing note slate-400, header comment
- [x] ✅ 4. `AreaCard.tsx` and `CallRow.tsx`: `StatusChip`, slate-400, article `id`
- [x] ✅ 5. `ExcludedCallRow.tsx`, `StoredRowPanel.tsx`, `LastChangedLine.tsx`: slate-400, `formatUtc`
- [x] ✅ 6. `settingsLayout.render.test.tsx` S-1 to S-12; E-1 in `costsTab.render`
- [x] ✅ 7. Guards: G-7, G-8 with self-tests; registry entry and header paragraph; mutation runs (a) to (d), reverted
- [x] ✅ 8. V-1 to V-8; Implementation Notes; requirement §1 row 16, §7.13 as built (SA M-5: the test edit is `costsTab.render:366`, not `page.render`; page deviations: area cards stay one full-width column, the card title stays an `h3` inside the disclosure button (F-122), `Suspense fallback={null}` (Q-8)); §9 (M-5): F-122 and F-123 added, count 119 to 121, F-118 widened with the Settings anchor tiles, F-67 Settings half / F-69 / F-75 done, F-115 closed by decision, F-116 Settings half done with the `Chip.tsx` note, F-120 done if task 9 lands; Change History
- [x] ✅ 9. (Separate, droppable; SA M-6: its own commit in the L-10 PR, named separately in the PR body) F-120: `CostsTab.tsx` two notices + F-1; re-run V-1, V-2; §9 F-120 disposition

---

## 9. Sizing and path

| Part | Estimate |
|---|---|
| Tasks 2 to 5 (code) | about 0.75 day |
| Tasks 6 and 7 (tests, guards, mutations) | about 0.75 day |
| Task 8 (verification, docs) | about 0.25 day |
| Task 9 (F-120) | about 0.25 day |
| **Total** | **about 2 days, one PR** (diff roughly 350 to 450 lines of source and 450 of tests) |

One slice, no split: it is smaller than L-9a or L-9b. **Path: UI short path** (no shared source change, no new pattern; the registry entry is a shared-folder test edit, as in L-5, L-6 and L-7). Under the user's fast-track for this standard: SA workplan review → Dev → SA code review + QA → RM.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Settings placeholders or bar rendered on a hidden tab break page-wide queries in the Activity / Costs suites (`activityLayout.render:434`) | Render rule §2.2; mutation (d) proves the suite catches it |
| R-2 | `StatusChip` drops a pinned `title` or test id | Wrapper spans (§2.4); `page.render` R-T11 / chip cases run unedited; S-10 |
| R-3 | An area name in a KPI tile makes `page.render`'s `getByText(areaName)` ambiguous | No tile shows an area name (§2.3); anchors carry it only in `href` |
| R-4 | `page.render`'s R-T3 "standing note is not amber or red" | slate-400 only; the note is not `AdminNotice` |
| R-5 | The `formatUtc` swap changes a visible time | Same format through `Date`; only the unparseable-value branch changes (§2.6); S-12 |
| R-6 | Task 9 stacks three amber notices on Costs | Each states a different missing fact; rare together; droppable (§2.8, Q-7) |
| R-7 | Stacked branch: a merge of #319 to #322 conflicts with L-10 | L-10 touches only Settings files, `page.tsx`'s Settings parts, `CostsTab.tsx` (two blocks) and guard files; RM merges `origin/main` before the PR |

---

## 11. Out of scope and found on the way

**Dispositions this slice closes (at code complete):** F-67 Settings half (done), F-69 (done), F-75 empty-state half (done; the Suspense half per Q-8), F-116 Settings half (done; Activity half stays open, and its note gains "`Chip.tsx` survives for `RecordStateMarker` only"), F-115 (per Q-9), F-120 (task 9, or stays open if SA drops it).

**New findings for §9 (reported, not fixed):**

| # | Finding | Citation | Sev | Disposition |
|---|---|---|---|---|
| F-122 | The area card's title `<h3>` sits inside its disclosure `<button>`: headings are not valid button content, and a button's children are presentational, so the area name is not exposed as a heading (the page has no heading between the h1 and the cards). The APG accordion shape (heading wrapping a button) would shrink the click target from the whole card header to the title, a behaviour change | `components/AreaCard.tsx:126-140` | a11y | open (found in the L-10 workplan; a disclosure redesign, its own UI short-path slice) |
| F-123 | `LedgerCheckPanel.tsx` (parked since 2026-09-24, not mounted) still reads with `response.json()` and uses `text-slate-500`; it is the page folder's one `.json(` after L-10 and is left out of the registry by name | `components/LedgerCheckPanel.tsx:148`, `:105-113`, `:243`, `:253` | cos | open, owner: business-os-llm slice 3 (the writer), which re-mounts the panel and must move it onto `readJsonBody` / the shared states then |

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | "Calls configured off": the tile sums the cards' `offCalls`, which `areaOffSummary` sets to 0 for an area that is itself off (RC-4). So with an area off the tile can read 0. Add the sub-line "plus N areas configured off" (counted with the same `areaShowsOff`), or label the tile "Configured off" and count areas plus calls (Health's rule, which SA-R-4 says is not the tab's sum)? | Sub-line, tile label unchanged; one rule (`areaOffSummary`), no new count |
| Q-2 | `sessionEndedCopy: true` on the Settings read (401 / 403 → "Your admin session has ended. Sign in again.")? | Yes, the L-5 precedent; the route's gate strings are not admin-worded copy for this page |
| Q-3 | The two anchor tiles target `#bos-llm-area-{area}` on the collapsed card, with no auto-expand. Acceptable, or no-target tiles instead (no `id` added)? | Anchors as §7.13 says; no expand (expanding would be new behaviour) |
| Q-4 | `set-per-call-chip` tone: `info` (sky, `Info` icon) or `neutral`? Purple (`accent`) is not allowed (T-7) | `info`: it is informational and stays distinguishable from the neutral call count |
| Q-5 | Empty-state words (new copy): "No Business OS AI areas came back from the settings read." with no hint and no Clear | As written |
| Q-6 | Excluded call caption and reason to slate-400 (T-5), keeping their darker shell as the "quiet" signal? | Yes |
| Q-7 | F-120 (task 9): take it in L-10 as two separate `AdminNotice`s (recommended), merge into one notice (new copy), or defer to the next Costs change? | Two separate notices in L-10, as the last, droppable task |
| Q-8 | F-75's other half, `Suspense fallback={null}`: keep it and record why (the bail-out frame is replaced on hydration; a loader there would flash, and it cannot know the tab's purpose before `useSearchParams` resolves), or render `AdminLoading`? | Keep `null`, recorded as a page deviation; close F-75 |
| Q-9 | F-115 (`activityPresets.ts`, owner L-10): keep it as the parity oracle for the shared window extras (no change), or freeze the expectations as literal dates and delete it? | Keep it; close F-115 as "kept as the oracle, by decision". Deleting it edits four test files outside this tab for no user-visible gain |
| Q-10 | Registry entry lists the Activity and Costs component files too (the page is one registry entry), leaving out `LedgerCheckPanel.tsx` and `Chip.tsx` by name. Agree? | Yes |

No product question for the user: every change is presentation, and the only new words are the KPI labels, one sub-line and the empty sentence.

---

## SA Review Notes

## SA Review (workplan) — 2026-10-12

**Reviewed by SA — 2026-10-12**
**Status:** APPROVED WITH CONDITIONS. M-1 to M-6 must be applied to this file before coding (task 1) and are checked at code review. S-1 to S-4 are expected; a Dev who disagrees records why in Implementation Notes. No product question for the user.

**Path:** UI short path confirmed, under the admin-layout fast-track (SA code review + QA, then RM). No shared source file changes; the only shared-folder edit is the registry entry in `layoutFolder.guard.test.ts` (the L-5 / L-6 / L-7 precedent). No data, API, money or LLM change.

### What SA verified in the code (at 4438d20a)

| # | Claim | Verified |
|---|---|---|
| 1 | Read-only, no write path | `llm-settings/route.ts` and `llm-settings/ledger/route.ts` export `GET` only (`:53`, `:112`), `requireAdmin` first. In `page.tsx` and every `components/*.tsx` except the parked `LedgerCheckPanel.tsx` there is no `method:`, no `POST` / `PATCH` / `PUT` / `DELETE`, no `<form>`, `<input>`, `<select>` or `<textarea>`; the one `fetch` is `page.tsx:235` with no `init`. The only other writer surface for these rows (`app/api/admin/system-config/route.ts:223`) refuses `bos_llm_area_*` keys. The plan keeps the request byte-identical (§2.7) and S-3 / S-4 pin it |
| 2 | No shared source change | Every export the plan uses already exists with the needed shape: `KpiTile` anchor mode (`href: #…`) and no-target mode, `KpiStrip` placeholders, `AdminFilterBar` no-controls branch with `readAt`, `AdminLoading` / `AdminError` (`testId` on the message, `onRetry`) / `AdminEmpty` / `AdminNotice`, `StatusChip` `warn` / `neutral` / `info`, `readAdminResponse` with `sessionEndedCopy`, `ADMIN_NETWORK_ERROR`, `formatUtc`, `formatCount`; `AdminPageHeader.actions` is optional. `StatusChip` has no `title` prop, so the wrapper span (L-5 PlanCard precedent) is the right way to keep the two pinned titles without a shared change |
| 3 | Layout-only scope | Payload fields only (`types.ts` `SettingsPayload`, `AreaView`); `areaState.ts` reused, not edited, so Health's `areaOffSummary` consumer (`health-summary/route.ts`) is untouched; no `@/lib/` import |
| 4 | File list and "not touched" list | Correct against the folder. Activity has 11 component files and Costs 5, exactly as the registry list names them; `Chip.tsx` stays for `RecordStateMarker.tsx:14`; `format.ts` stays for the Activity files and `LedgerCheckPanel.tsx`. One addition to the registry list (M-4) |
| 5 | Test edits | `Re-read the settings` is pinned only at `costsTab.render:366` (grep over `app`, `lib`, `tests`); `page.render` has no title, Refresh, "read at" or loading-text pin, so §7.13's "Test edits: page.render" line is stale (M-5). `lastChanged.render` passes unedited: its absent-time cases use `at: null`, which `formatUtc` maps to the em dash, and its `formatInstant` case imports `format.ts`, which stays. `costsTab.render:466` reads `costs-unreadable` with `toHaveTextContent`, which holds with `AdminNotice`'s test id on the `<p>` |
| 6 | Hidden-tab rendering | `activityLayout.render:434` (four `kpi-placeholder` page-wide) and `:533` (`getByText('Read at 12:00 UTC')` page-wide) would both see a hidden Settings strip or bar, because `getByTestId` / `getByText` do not skip `hidden`. Gating the strip, bar and states on `onSettings` is required, not only tidy |

### Ruling on the hidden-tab rendering and the `active` rule (check 7)

**Approved: render the strip, bar and states only while Settings is visible.** No conflict with the L-9a `active` rule: that rule governs which `useAdminFilters` hook owns the address bar, and Settings has no filters, no hook and no URL key (`TAB_KEYS.settings = []`). The Settings bar is the Refresh-only plain `<div>`: it never reads or writes the URL. The read stays on mount whatever tab is shown (today's behaviour), and gating is a render decision only, so no read is added or lost on a tab switch (QB-5). The anchor tiles add a hash entry; the tab writer already drops the hash on a switch (L-9a Q-6), so a Settings anchor cannot leak onto Costs or Activity. A Back across that entry is the F-118 case (M-5).

The standing note is the exception: it must keep rendering on every tab, hidden by its panel, because `costsTab.render:365` asserts `getByTestId('page-standing-note')` is present and not visible on Costs (M-1).

### Rulings on Q-1 to Q-10

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved: sub-line, label unchanged, one rule (`areaOffSummary`).** The tile counts `offCalls`; the sub-line "plus N areas configured off" (singular for 1, S-3) shows when any `areaShowsOff`; the tile links when either count is above 0 | It counts exactly what the cards' chips say, so a tile and a card cannot disagree. Health's "areas or calls" rule stays out (SA-R-4). A tile reading 0 with a link is explained by its own sub-line |
| Q-2 | **Approved: `sessionEndedCopy: true`** | Every other `readAdminResponse` page except Health opts in (Analytics, Audit trail, Archiving, Businesses, Plans, Invites, Messages, Jobs). Costs and Activity on this page do not (they branch on `readJsonBody`, L-9 N-1); the intra-page difference is acceptable and needs no change |
| Q-3 | **Approved: anchors to the collapsed card, no auto-expand.** Build the href inline as `` `#bos-llm-area-${area.area}` `` (S-2) | §7.13 names "first area with any" as the target and K-6 anchor mode exists. Expanding on a hash would be new behaviour and would fight the one-at-a-time expansion |
| Q-4 | **Approved: `info`** | §5.9 lists `info` for informational; it keeps the per-call count distinguishable from the neutral call count, and purple is reserved (T-7). The `Info` icon is `aria-hidden`; the words carry the meaning |
| Q-5 | **Approved as written**: "No Business OS AI areas came back from the settings read." No hint, no Clear | Not reachable from a healthy catalogue; the sentence says what is empty and there is no filter to clear |
| Q-6 | **Approved** | T-5 has no exception for quieter rows; the darker shell keeps the "quiet, not amber" intent of `ExcludedCallRow.tsx:30-33` |
| Q-7 | **Approved: F-120 in L-10 as two separate `AdminNotice`s, task 9, in its own commit (M-6)** | This meets the L-9b ruling's two conditions: the layout decision is now made (three separate notices, each a different missing fact, same words, no new copy) and it has its own render case (F-1). Merging would need new copy and would re-open `costs-incomplete`, which L-9b just approved. The triple case is rare; separate boxes are the honest rendering of three separate facts. Droppable with no effect on tasks 1 to 8 |
| Q-8 | **Approved: keep `fallback={null}`, record as a page deviation, close F-75** | Same as Analytics, Audit trail and Finance (`Suspense fallback={null}`); a loader there would flash before `useSearchParams` resolves and cannot know the tab's purpose line |
| Q-9 | **Approved: keep `activityPresets.ts` as the parity oracle; close F-115 "kept by decision"** | Deleting it edits four test files outside this tab for no user-visible gain; the oracle is what proves the shared window extras match the old presets |
| Q-10 | **Approved with one addition (M-4)**: list the Activity and Costs files too, exclude `LedgerCheckPanel.tsx` and `Chip.tsx` by name with the reason in a comment, and also list the three filter-spec modules | One page, one entry. The filter modules are listed by the Audit trail, Businesses and Messages entries, and they import the shared folder, so the alias rule bites on them |

### F-120 and the new findings (checks 8 and 9)

- **F-120: in scope as task 9** (Q-7). It is two JSX blocks on the same page whose registry entry lands here, it stays layout-only, and it is isolated in its own commit.
- **F-122: correctly out of scope.** Moving the `<h3>` out of the disclosure `<button>` (the APG heading-wraps-button shape) changes the click target from the whole card header to the title row, which is a behaviour change, not a layout move. Its own UI short-path slice. Until then the area card also keeps `h3` rather than the §5.7 `h2` card title (a heading inside a button is not exposed anyway, so changing the level alone would fix nothing): record it with F-122 (M-5).
- **F-123: correctly out of scope.** The panel is parked and not mounted (R-T4); its only reader returns with slice 3, which must move it onto `readJsonBody` and the shared states when it re-mounts it. G-8 names it as the one exception and M-3 makes the exception expire loudly.

### Findings

**Must (apply to this file before coding):**

| # | Where | Finding | Required change |
|---|---|---|---|
| M-1 | §2.2 rendering rule | The rule names "strip, bar and states" but does not say what happens to the standing note; gating it on `onSettings &&` would break `costsTab.render:365` (`getByTestId('page-standing-note')` on Costs) and that suite is meant to need only E-1 | State in §2.2: the standing note keeps rendering on every tab, inside the Settings panel, hidden with it (today's `hidden={!onSettings}`); only the strip, the bar and the state blocks are gated with `onSettings &&`. The content-area wrapper that carries `aria-busy` is always mounted while Settings is shown (D-7) |
| M-2 | §5 G-7 | G-7 is a hand list of seven files; a Settings component added later would escape it, which is what the folder's "WALKED rather than listed" rule (`source.guard.test.ts:36-38`) exists to prevent. The colour regex must not trip on `border-slate-600` (`Chip.tsx:19`) | G-7 walks `page.tsx` plus every `.ts` / `.tsx` directly under `components/` (not its subfolders, which G-3, G-5 and G-6 own), excluding by name `LedgerCheckPanel.tsx` (F-123) and `Chip.tsx` (Activity's, F-116). Add a walk case asserting `AreaCard.tsx`, `CallRow.tsx` and `SettingsKpis.tsx` are in scope. Colour rule: a word-bounded `text-slate-500` or `text-slate-600` class (as G-6's `SLATE_500`, widened to 600), its self-test proving `border-slate-600` and `text-slate-400` do not match |
| M-3 | §5 G-8 | The proposed guard checks only that `AreaCard.tsx` does not import the parked panel; `page.tsx` could mount it and bring a `.json(` back on screen. The exception can also outlive its reason | G-8: (a) no screen file other than `LedgerCheckPanel.tsx` itself names `LedgerCheckPanel` in code (`codeOf`, walked); (b) `PARKED_JSON` holds exactly that one file, and a case asserts the file still contains `.json(`, so the day slice 3 converts it the exception fails and must be deleted (the L-9a `JSON_UNTIL_L9B` pattern) |
| M-4 | §5 registry entry | The filter-spec modules are left out as "plain modules", but the Audit trail, Businesses and Messages entries list theirs, and these import the shared folder | Add `app/admin/business-os-llm/activityFilters.ts`, `costsFilters.ts` and `tabWindowFilter.ts` to the entry. Keep every other exclusion as written, with the reason in the entry's comment |
| M-5 | Task 8, requirement edits | Records owed at code complete | §7.13 as built: the test edit is `costsTab.render:366` (not `page.render`, the §7.13 line is stale); page deviations recorded: area cards stay one full-width column (not the §5.7 grid: one card expands at a time and its body is long), the card title stays an `h3` inside the disclosure button (F-122), `Suspense fallback={null}` (Q-8). §9: add F-122 and F-123 and update the count line (119 to 121); widen F-118 with the Settings anchor tiles as one more Back-across-an-anchor source (record, do not fix); F-67 Settings half, F-69, F-75 done; F-115 closed by decision; F-116 Settings half done with the `Chip.tsx` note; F-120 done if task 9 lands |
| M-6 | Task 9 | F-120 is a Costs change riding in a Settings PR | Task 9 is its own commit in the L-10 PR (so it can be reverted alone), named separately in the PR body. F-1 also asserts `costs-incomplete` is unchanged and that, with all three conditions set, exactly three `AdminNotice` boxes render in the order incomplete, unreadable, names failed |

**Should:**

| # | Where | Finding |
|---|---|---|
| S-1 | §2.6, comments | In `LastChangedLine.tsx` and `StoredRowPanel.tsx`, decide "not recorded" once per file (`formatUtc` result compared to the em dash, the `HealthGrid.tsx:43` / `adminFormat.ts:43` precedent) and rewrite the `LastChangedLine.tsx` header paragraph (`:24-31`), which names `formatInstant`; keep the 1970 reason. While rewriting the `page.tsx` header, also correct "the only network calls are two `GET`s" (`:25-26`): the mounted page makes one Settings `GET` (the ledger reader is parked) |
| S-2 | §2.3 | Build each anchor href inline in the `href` prop; a template string stored in a variable first widens to `string` and will not satisfy `` `#${string}` `` |
| S-3 | §2.3, copy | `KPI_AREAS_OFF(n)` handles the singular ("plus 1 area configured off"); S-9 plants one area off to pin it |
| S-4 | S-9 | Bind `area.excludedCalls ?? []` in `SettingsKpis.tsx` as `AreaCard.tsx` does (QA EDGE-1), and plant one area without `excludedCalls` in S-9 so the strip counts it and does not throw |

**Notes:**

- N-1: "Read at" comes from `payload.generatedAt`, so a failed refresh keeps the last good time; that is the §5.5 meaning of Read at. Correct as planned.
- N-2: the visible changes in §2.10 are complete; QB-1 to QB-12 cover them. Light / dark emulation (QB-10) stays.
- N-3: mutation (d) is the right proof for M-1's gating; keep it.

### Approval

[x] Workplan approved with conditions M-1 to M-6. Apply them to this file, then proceed to implementation.

---

## Implementation Notes (L-10)

**Dev — 2026-10-12.** Uncommitted on `feature/admin-layout-l10` (RM commits). M-1 to M-6 and S-1 to S-4 were written into this file before coding (§2.2, §2.3, §2.6, §5, §6.3, §8); no S-item was declined.

### What was built

| File | Change |
|---|---|
| `page.tsx` | Read on `readAdminResponse` (`SETTINGS_WHAT`, `sessionEndedCopy`), rejected fetch → `ADMIN_NETWORK_ERROR`; the `fetch` call itself is unchanged (same URL, no init), while its statement became an assignment inside its own `try` (QA O-2); no `.json(`. Header without `actions`. Settings panel: `SettingsKpis` (hidden on an error), the Refresh-only `AdminFilterBar` (`readAt` = `generatedAt`), the standing note (always rendered, slate-400, M-1), then `settings-content` (`aria-busy`) with `AdminError` (`page-error`, Try again), `AdminLoading`, `AdminEmpty`, the cards. Header comment: the L-8a sentence replaced, an L-10 paragraph added, "two `GET`s" corrected (S-1). `AlertCircle`, `RefreshCw`, `formatInstant` imports gone |
| `components/SettingsKpis.tsx` (new) | Four neutral tiles (§2.3); hrefs inline (S-2); `excludedCalls ?? []` (S-4) |
| `copy.ts` | `SETTINGS_WHAT`, `SETTINGS_EMPTY`, four KPI labels, `KPI_AREAS_OFF(n)` with the singular (S-3) |
| `components/AreaCard.tsx` | `StatusChip` (`warn`, `neutral`, `info` in a `title` wrapper); article `id`; read-only note and legend slate-400 |
| `components/CallRow.tsx` | `call-state-chip` as a `title` wrapper around `StatusChip warn`; three slate-500 lines → slate-400 |
| `components/ExcludedCallRow.tsx` | Caption and reason slate-400 (Q-6) |
| `components/StoredRowPanel.tsx`, `LastChangedLine.tsx` | `formatUtc`, the em dash decided once per file as "not recorded" (S-1); header paragraph rewritten; key and "Written at" slate-400 |
| `__tests__/settingsLayout.render.test.tsx` (new) | S-1 to S-12 (18 cases); `console.error` / `console.warn` asserted empty in every case. After SA code review: the stub records any URL that is neither the settings read nor a Costs / Activity read (a ledger read included) and every case asserts that list empty (F-1); the `call-state-chip` title must equal `CALL_OFF_TITLE` (F-3) |
| `__tests__/costsTab.render.test.tsx` | E-1 only |
| `__tests__/source.guard.test.ts` | G-7 (walked; self-test incl. `border-slate-600`; walk case) and G-8 (a) to (c) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | Registry entry (27 files incl. the three filter modules, M-4; corrected from "30", SA code review F-2) and the "Amended by L-10" paragraph; no rule change |
| **Task 9 only:** `components/costs/CostsTab.tsx`, `__tests__/costsLayout.render.test.tsx` | F-120: two `AdminNotice`s; F-1 (two cases, M-6). **These two files are task 9 and nothing else**, so RM can commit them on their own |

No shared source file changed; no route, `lib/`, `tests/helpers/`, `types.ts`, `areaState.ts`, `format.ts`, `Chip.tsx`, `LedgerCheckPanel.tsx` or Activity file changed.

### Verification (real output)

| # | Result |
|---|---|
| Baseline (before any edit) | `npx jest app/admin/business-os-llm app/admin/components --ci`: 38 suites, 1,347 tests passed |
| V-1 | `npx jest app/admin/business-os-llm app/admin/components lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **41 suites, 1,652 tests passed** |
| V-2 | `npm run test:bos-llm`: 23 suites, 625 tests, 23 snapshots passed, exit 0 |
| V-3 | `npm run typecheck:bos-llm`: "499 files in scope, 28 errors, 0 new", passed (the same already-fixed baseline entry `app/api/onboarding/build/route.ts` TS18047 as L-9) |
| V-4 | Scoped `tsc -p` on a scratchpad tsconfig (`extends` the worktree's, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-llm/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`; 95 `app/admin` files): run 1 with the canary exit 2, exactly `canary.ts(1,7): error TS2322`; run 2 without it **exit 0** |
| V-5 | `npm run lint:hooks`: clean |
| V-6 | `git diff --stat 4438d20a --` routes, `lib`, `tests`, shared sources, `components/activity`, `LedgerCheckPanel.tsx`, `types.ts`, `areaState.ts`, `format.ts`: empty |
| V-7 | No `console.`, `as any`, `: any` or `method:` in the page folder's code; `.json(` only in `LedgerCheckPanel.tsx` (G-8) |
| V-8 | `git diff --stat`: 13 modified, 3 new (two code, the workplan); 404 insertions, 117 deletions in tracked files; no file emptied or deletion-only. Every changed file has uniform CRLF endings |
| Mutations (each reverted from a scratchpad copy, then the full V-1 set re-run green) | (a) a `.json(` call back in `page.tsx` → G-8 and the registry fail (2); (b) the standing note back to slate-500 → G-7 and S-11 fail (2); (c) `status="amber"` on the Calls configured off tile → S-9 fails (2); (d) the strip rendered on every tab → `activityLayout.render` fails (1) |

### Deviations

1. **F-1 lives in `costsLayout.render`, not `costsTab.render`** (the plan said `costsTab.render`). `costsTab.render` also holds E-1, a Settings edit; putting F-1 elsewhere keeps task 9 to two files, so it can be its own commit (M-6).
2. **The settings stub in `settingsLayout.render` never answers the Costs / Activity reads.** S-1 opens both tabs; their reads otherwise land after the test and React's act warnings fail the console assertion of every later case.
3. **`settings-content` and `settings-empty` are new test ids** (additive) for the content area and the empty state. `page-error` is now on the `AdminError` message (RC-3), not on a wrapper `div`; `page.render` only asserts its absence.
4. No other deviation. The tone, sub-line, empty sentence and anchors are as SA ruled (Q-1 to Q-5).

### User-visible changes

As §2.10, items 1 to 7.

### Out of scope, recorded (not fixed)

F-122 and F-123 added to requirement §9; F-118 widened (Settings anchor tiles). The L-9b QB checks and L9-B4 / L9-B5 are still owed from earlier slices.

---

## SA Code Review

**Code Review by SA — 2026-10-12**
**Status:** APPROVED WITH FIXES (F-1 to F-3 below, all Low, test or doc only; none changes product code, and QA may run in parallel with them)

Reviewed the uncommitted change against HEAD 4438d20a (13 modified, 3 new; `git diff --stat` 417 insertions, 125 deletions, no file emptied or deletion-only).

### Checks

| # | Check | Result |
|---|---|---|
| 1 | M-1: strip, bar and states gated on `onSettings`; standing note always rendered, hidden with its panel | Met. `page.tsx`: `SettingsKpis` and `AdminFilterBar` behind `onSettings &&`; the error, loading, empty and cards inside the gated `settings-content`; `page-standing-note` ungated with `hidden={!onSettings}`, slate-400 |
| 2 | `aria-busy` | Correct. On `settings-content` (always mounted while Settings shows), true during any read incl. Refresh; S-3 pins false, true, false. The bar's own button carries `aria-busy` and `disabled` from the shared bar |
| 3 | M-2: G-7 walked, word-bounded, two named exclusions, walk case | Met. Filter is `page.tsx` plus files directly under `components/`; `LedgerCheckPanel.tsx` and `Chip.tsx` excluded by name; self-test proves `border-slate-600` and `text-slate-400` do not match; walk case lists `AreaCard`, `CallRow`, `SettingsKpis` and excludes `costs/` |
| 4 | M-3: G-8 (a) every file, (b) panel named nowhere else, (c) exception expires | Met. (c) asserts the single parked file still contains `.json(` |
| 5 | M-4: registry entry | Met. One entry, 27 files: `page.tsx`, the three filter-spec modules, 7 Settings components (incl. `SettingsKpis`, `Marker`), all 11 Activity and all 5 Costs components; checked against the folder listing, nothing with markup or a read is missing. `LedgerCheckPanel.tsx` and `Chip.tsx` excluded by name with the reason in the comment. Header comment amended, no rule change |
| 6 | M-5: requirement records | Met. §1 row 16, §7.13 as built (test-edit line corrected to `costsTab.render:366`, three page deviations), F-67, F-69, F-75 done, F-115 closed by decision, F-116 Settings half, F-118 widened, F-120 done, F-122 and F-123 added, count 119 to 121. No backslash in either MD |
| 7 | M-6: task 9 is exactly two files and separable | Met. `CostsTab.tsx` (two `AdminNotice`s, same words and test ids) and `costsLayout.render` (F-1, two cases incl. exactly three notices in order and `costs-incomplete` unchanged) carry nothing else; no Settings file or test depends on them, and `costsTab.render:466` (`toHaveTextContent`) holds either way. RM can commit them alone |
| 8 | Read-only, request byte-identical | Met. The one call is still the settings `fetch` with the URL only and no `init`; S-3 asserts every call has exactly one argument and the stub asserts `init` is undefined. No `method:`, form or input anywhere in the page folder's code |
| 9 | Read through `readAdminResponse` with `sessionEndedCopy` | Met. `what: SETTINGS_WHAT`, `sessionEndedCopy: true`; rejected fetch sets `ADMIN_NETWORK_ERROR`; failure keeps the payload (stale cards stay, strip hides per K-10, Read at keeps the last good time, N-1). No `.json(` in `page.tsx` |
| 10 | Anchor ids | Match. Both tiles build the `#bos-llm-area-` href inline (S-2); `AreaCard` sets the article `id` to `bos-llm-area-` plus the area; S-9 resolves both hrefs to the right card via `getElementById` |
| 11 | `StatusChip` wrapper spans | `set-per-call-chip` and `call-state-chip` keep their test ids and `title`s on the wrapper span (L-5 precedent); the other three chips pass `testId` straight to `StatusChip`. Words unchanged (children as one string, which `StatusChip` requires) |
| 12 | No shared source, route, lib or LLM change | Confirmed: `git diff 4438d20a --stat` over `lib`, `app/api`, `tests` and the shared layout sources is empty; the only shared-folder edit is the registry test |
| 13 | No `console.*`, no `any` | Confirmed over the page folder's non-test code |
| 14 | Times | `LastChangedLine` and `StoredRowPanel` decide "not recorded" once per file against `formatUtc`'s em dash (S-1); S-12 pins the UTC conversion, both absent sentences and no 1970 |
| 15 | Verification re-run by SA | V-1 set: 41 suites, 1,652 tests passed |

### Mutation spot-check (SA, reverted; checksums of all three files matched the pre-mutation copies afterwards)

| Mutation | Caught by |
|---|---|
| `CallRow.tsx` caption back to `text-slate-600` | G-7 (`CallRow.tsx`) and S-11 |
| `AreaCard.tsx` gains a `r.json()` export | G-8 (a) and the registry's C-14 (b) |
| Standing note gated with `onSettings &&` (alone) | `costsTab.render` "the Costs & credits tab mounts the report and hides the settings controls" (M-1 holds) |
| Settings bar ungated | S-1 and `costsTab.render` E-1 |

### Deviations

1. F-1 in `costsLayout.render`: accepted; it is what keeps task 9 to two files.
2. Unanswered Costs and Activity reads in `settingsLayout.render`: accepted, and it hides no real warning. Those tabs' data paths render in `costsLayout.render`, `costsTab.render`, `activityLayout.render` and `page.render`, none of which silences the console, and a run of those four suites printed no React warning. The cost is narrower: the stub answers every non-settings URL with a pending promise, so an unexpected request (a ledger read) would be swallowed silently. See F-1.
3. `page-error` on the message element: accepted (RC-3 shape, as every other migrated page). `page.render` only asserts its absence, and the S-6 cases pin the exact message text and that the alert contains it.

### Code Review Comments

1. `__tests__/settingsLayout.render.test.tsx:179-185` — the case is titled "no ledger request" but asserts only that the settings URL was called once; because the stub (`:50`) parks any other URL, a ledger request would pass. Add an assertion that no call's URL contains `/llm-settings/ledger`, and preferably make the stub park only the known Costs and Activity URL prefixes and fail on any other URL. — Priority: Low (F-1)
2. Implementation Notes, "What was built", registry row — says "30 files"; the entry lists 27. Correct the number. — Priority: Low (F-2)
3. `__tests__/settingsLayout.render.test.tsx:358` — the `call-state-chip` title is checked only with `toBeTruthy()`, and no other suite pins it. Assert it equals `CALL_OFF_TITLE` so the wrapper keeps the exact hover text (the set-per-call title is already pinned in `page.render:812`). — Priority: Low (F-3)

### Optimisation Suggestions

- None blocking. The K-10 choice (strip hidden on an error even with stale cards) is commented where it is made.

### Code Approved for QA: Yes

Fixes F-1 to F-3 are test and doc only; the Dev applies them before RM commits, and SA needs no second pass unless product code changes.

---

## QA Testing Report

**QA — 2026-10-12**
**Verdict:** PASS WITH NOTES. No bugs found. The notes are the browser checks QB-1 to QB-12, which are owed, and three observations below.
**Test mode:** full (UI short path, fast-track)
**Strategy used:** A + B in jsdom (the existing suites plus throwaway QA probes), static grep, and a diff check. D (browser) was not possible in this session; see below
**Focus:** ui, api (read path), security (read-only, no write)
**Skipped:** QB-1 to QB-12 browser checks. The Claude in Chrome tools were not available to this agent (no ToolSearch or browser tool in its tool set), so no connected browser could be listed. They are owed to TL or the user
**Input source:** prompt keywords (TL brief) plus workplan §6 and §7
**Ran in parallel with the SA code review.** SA F-1 to F-3 are test and doc only. If they land unchanged in product code, this verdict stands without a re-run.

### Suites run (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l10`, uncommitted on 4438d20a)

| Command | Result |
|---|---|
| `npx jest app/admin/business-os-llm app/admin/components lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **41 suites, 1,652 tests passed** (matches Dev V-1 and SA) |
| The authz guard and the tailwind guard alone | 2 suites, 125 tests passed |
| `npm run test:bos-llm` | 23 suites, 625 tests and 23 snapshots passed, exit 0 |
| `npm run typecheck:bos-llm` | 499 files in scope, 28 errors, **0 new**, passed (the same fixed baseline entry, `app/api/onboarding/build/route.ts` TS18047, as L-9) |
| `npm run lint:hooks` | clean, exit 0 |

### QA probes (throwaway, `zz*`, run and then deleted)

QA ran one probe file of 20 cases against the working tree. It also used a temporary copy of HEAD's `page.tsx` (from `git show HEAD:…`) to compare the fetch counts on a tab switch. Result: **20 of 20 passed.** One case failed on the first run because a probe regex matched the tile label. QA fixed the probe and re-ran it; it was not a product fault.

| Area | Probe | Result |
|---|---|---|
| Happy path | Seed fixture: 4 `settings-kpi-*` tiles, the "Refresh the settings" button, "Read at 09:00 UTC", call-count chips, `settings-content` with `aria-busy="false"`, no `page-error` | Pass |
| 401 | "Your admin session has ended. Sign in again."; the gate string is not shown | Pass |
| 403 | The same session sentence | Pass |
| 500 with an error string | The route sentence verbatim in `page-error`, inside `role="alert"`, with Try again | Pass |
| Network rejection | `ADMIN_NETWORK_ERROR` ("Could not reach the server…"), never "Failed to fetch" | Pass |
| Non-JSON body (502, and 200) | "Could not read the settings. Try again in a moment."; no parser text | Pass |
| Any failure | Strip hidden (no tiles, no placeholders); the bar is still present; no "Read at" when there is no payload | Pass |
| Recovery | A success, then Refresh answers 500: cards kept, strip hidden, "Read at" keeps the last good time (N-1). Then Try again answers success: error gone, strip back with the new count. 3 settings reads in total | Pass |
| Recovery from a failed first read | Try again shows 4 `kpi-placeholder` and "Reading the settings…" (`role="status"`) and clears the error, then the cards render | Pass |
| Focus after Try again | Focus lands on `BODY` because the Try again button unmounts. This is the known shared follow-up, recorded only (O-1) | Noted |
| Empty | Zero areas: `settings-empty` with `SETTINGS_EMPTY`, no Clear filters, Areas 0, Calls 0, no link in the panel | Pass |
| Tab switching (L-10) | On Costs and on Activity: 0 Settings tiles; no "Refresh the settings" button, even when queried with `hidden: true`; the standing note is present and not visible. Back on Settings: 4 tiles and "Read at" are back | Pass |
| Fetch count compared with HEAD | Settings reads before and after a Costs round-trip and an Activity round-trip: L-10 1 then 1, HEAD 1 then 1. No re-read was added | Pass, identical to HEAD |
| Anchor tiles | Calls configured off links to `#bos-llm-area-scheduling` (the first area that is off), and `getElementById` returns that card. Row issues links to `#bos-llm-area-crm`, which exists. Every `#…` href in the panel resolves. Areas and Calls are not links. Every tile has `data-status="neutral"` | Pass |
| Tiles with no target | No area or call off and no row issue: no `<a>` in the panel, both tiles read 0, no sub-line. A non-switchable area with `configuredEnabled: false` is not counted, which is the card's own rule | Pass |
| Sub-line | With 1 area off: "plus 1 area configured off". With 2 areas off: "plus 2 areas configured off". A payload where only areas are off links the tile while its value is 0 (SA Q-1; the sub-line explains it) | Pass |
| S-4, missing `excludedCalls` | One area without the key, and separately every area without it: no throw; Calls counts `calls` only | Pass |
| Costs: unreadable alone | One amber `AdminNotice` with the words `UNREADABLE_AMOUNTS(1)`, no names-failed notice, no `role="alert"` | Pass |
| Costs: names failed alone | One amber notice with `NAMES_FAILED` | Pass |
| Costs: both, without incomplete | Two boxes, unreadable first | Pass |
| Costs: all three | Three boxes in the order incomplete, unreadable, names failed; the incomplete text is unchanged | Pass |

### Static checks

| Check | Result |
|---|---|
| Dark-mode classes: word-bounded `text`, `bg`, `border`, `ring` or `divide` with `slate-500` or `slate-600`, in `page.tsx`, `SettingsKpis.tsx`, `AreaCard.tsx`, `CallRow.tsx`, `ExcludedCallRow.tsx`, `StoredRowPanel.tsx`, `LastChangedLine.tsx` and `Marker.tsx` | None. Under `components/*.tsx`, the only slate-500 and slate-600 left are in the excluded `LedgerCheckPanel.tsx` and `Chip.tsx` |
| `console.`, `as any`, `: any` or `method:` in `page.tsx` and `components/*.tsx`, the parked panel aside | None |
| `.json(` in the page folder's code | Only `LedgerCheckPanel.tsx:148` (the G-8 exception). The match at `page.tsx:62` is a comment |
| The fetch call, checked with `git diff -- app/admin/business-os-llm/page.tsx` | The call expression `fetch('/api/admin/business-os/llm-settings')` is identical: one argument, no init. The statement around it changed from `const response = await fetch(…)` to `response = await fetch(…)`, inside an inner try that catches the rejection (O-2). The request on the wire is unchanged |
| `git status` after the probes were deleted | Exactly the Dev's 16 entries (13 modified, 3 new); no `zz*` file anywhere in the worktree |

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| The header has no actions; Refresh sits in a Refresh-only bar, on Settings only (F-69, D-15) | ✅ | Pass | Suites S-1 and S-2, plus the tab-switch probe |
| The read goes through `readAdminResponse` with the right wording for 401 and 403, 500, non-JSON and a network failure (F-67) | ✅ | Pass | Probes cover every branch |
| Four neutral tiles, counted by the card rules, with anchors to existing ids (§7.13, SA Q-1, S-3, S-4) | ✅ | Pass | Probes plus S-9 |
| Shared loading state, error with Try again, and empty state (F-75) | ✅ | Pass | Probes |
| Strip, bar and states render only on Settings; the standing note is always rendered and hidden with its panel (M-1) | ✅ | Pass | Probe, plus `activityLayout.render` and `costsTab.render` green |
| No added read on a tab switch (QB-5, in jsdom) | ✅ | Pass | 1 then 1, the same as HEAD |
| T-5: slate-400 in the Settings files | ✅ | Pass | Grep, plus S-11 and G-7 |
| `StatusChip` tones, with the titles kept (§2.4) | ✅ | Pass | Suite S-10; `page.render` unedited and green |
| UTC times (C-5) | ✅ | Pass | Suite S-12; `lastChanged.render` green |
| Registry entry, G-7 and G-8 | ✅ | Pass | Included in the 1,652 |
| F-120: two separate notices, in order, words unchanged (M-6) | ✅ | Pass | Probes plus F-1 |
| Browser checks QB-1 to QB-12 (light and dark, console, offline, real anchors) | ⚠️ | Owed | No browser tool was available to QA |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The tab reads the settings once on mount and once per Refresh or Try again. It does not read on a tab switch, the same as HEAD.

#### Edge Cases and observations (no fix asked for in this slice)

1. **O-1, focus after Try again (Low, known shared follow-up).** When Try again succeeds, the Try again button unmounts and focus falls to `BODY`. This is the known shared §5.8 follow-up, not an L-10 fault. Recorded only.
2. **O-2, the fetch call is byte-identical but its statement is not (Info).** The diff turns `const response = await fetch(…)` into an assignment inside an inner try. The URL, the single argument and the missing init are unchanged, so the request is the same. The Implementation Notes say "the `fetch` line is byte-identical"; that holds for the call expression only.
3. **O-3, jest worker force-exit warning (Info).** The V-1 run prints "A worker process has failed to exit gracefully". All suites pass. QA did not trace the warning to an L-10 suite in this session.

The QA probes parked every request other than the settings read, as the Dev suite's stub does, so they do not prove the absence of a ledger request either. That gap is SA F-1.

### Final Status

- [x] All automated acceptance criteria pass and no bug is open. Ready for RM once SA F-1 to F-3 (test and doc only) are applied. QB-1 to QB-12 are owed to TL or the user in a signed-in browser, in light and dark, with DevTools Network and Console open
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Workplan written | Dev: Settings tab analysis (code verified at 4438d20a; read-only confirmed, no write path), plan for the strip, Refresh-only bar, states, read, chips, T-5, times, registry entry, G-7 / G-8; F-120 recommended as a separate last task; new findings F-122, F-123; Q-1 to Q-10. Awaiting SA workplan review |
| 2026-10-12 | SA workplan review | SA: APPROVED WITH CONDITIONS (M-1 to M-6, S-1 to S-4). Read-only verified (both routes `GET` only, no write path in the Settings files); no shared source change; UI short path under the fast-track. Hidden-tab gating approved, no conflict with the L-9a `active` rule; standing note stays rendered on every tab (M-1). G-7 walked not listed (M-2); G-8 covers every file and the parked exception expires (M-3); registry adds the three filter modules (M-4); requirement records (M-5); F-120 approved as task 9 in its own commit (M-6). Q-1 to Q-10 ruled (all approved, Q-10 with M-4). F-122, F-123 out of scope. No product question |
| 2026-10-12 | M-1 to M-6, S-1 to S-4 applied; L-10 implemented | Dev: conditions written into §2.2, §2.3, §2.6, §5, §6.3, §8 before coding; tasks 1 to 9 done, uncommitted; task 9 (F-120) confined to `CostsTab.tsx` and `costsLayout.render` for its own commit. 41 suites / 1,652 tests, `test:bos-llm` 23 / 625, `typecheck:bos-llm` 0 new, scoped `tsc` canary then clean, `lint:hooks` clean; mutations (a) to (d) bite. Implementation Notes (L-10) added. Awaiting SA code review + QA |
| 2026-10-12 | SA code review | SA: APPROVED WITH FIXES (F-1 to F-3, Low, test or doc only). M-1 to M-6 met in code; read-only with the request byte-identical; `readAdminResponse` with `sessionEndedCopy`; gating, standing note and `aria-busy` correct; anchor ids match; wrapper spans keep titles and test ids; no shared, route, lib or LLM change; no `console.*` or `any`; task 9 two files and separable. SA mutation spot-check (four, reverted, checksums verified) all caught; V-1 re-run 41 suites, 1,652 tests. Deviations 1 to 3 accepted; deviation 2 hides no real warning but lets an unexpected request pass silently (F-1). F-2 registry count 30 to 27; F-3 pin the exact call-off title. Code approved for QA |
| 2026-10-12 | QA report | QA: PASS WITH NOTES, no bugs. V-1 set 41 suites / 1,652 tests (authz + tailwind guards 125); `test:bos-llm` 23 / 625 / 23 snapshots; `typecheck:bos-llm` 0 new; `lint:hooks` clean. 20 throwaway probes (happy path, 401, 403, 500, network, non-JSON, recovery, empty, tab switch with a fetch count equal to HEAD's, anchors, singular and plural sub-line, missing `excludedCalls`, Costs notices alone, together and in order) all passed, then deleted; `git status` shows the Dev's 16 files only. Fetch call expression identical (O-2). Focus falls to body after Try again (O-1, known shared follow-up). QB-1 to QB-12 owed: no browser tool available to QA |
| 2026-10-12 | SA fixes F-1 to F-3 applied | Dev: test and doc only, no product code. F-1: the `settingsLayout.render` stub records every URL outside the settings read and the Costs / Activity prefixes, and each case asserts none; F-3: the `call-state-chip` title equals `CALL_OFF_TITLE`; F-2: registry count corrected to 27; QA O-2: Implementation Notes say the fetch call (not the line) is unchanged |
| 2026-10-12 | Committed + PR (RM) | Commit A b43bce03 (tasks 1 to 8, Settings) and commit B 38fae090 (task 9, F-120, SA M-6) on `feature/admin-layout-l10`; origin/main merged (8cc62d79, 07e308d3; clean). Re-run after the merge: V-1 set 41 suites / 1,657 tests, `test:bos-llm` 23 / 625, `typecheck:bos-llm` 0 new, `test:bos-entitlements` 242 / 7,167, `lint:hooks` clean. PR #324 opened, not merged |
| 2026-10-12 | Merged | PR #324 merged by the user (merge commit 82469a8a). Browser checks QB-1 to QB-12 still owed |
