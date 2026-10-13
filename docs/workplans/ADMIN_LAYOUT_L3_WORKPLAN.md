# Workplan: Admin Layout Standard — Slice L-3 (Archiving)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 8), §3, §4.6, §5.3, §5.4 (K-1 to K-10), §5.5 (Refresh-only bar), §5.7, §5.9, §5.10, §5.11, §5.12, §6.1, §6.2 C-2, C-3, C-4, C-5, C-10, C-11, C-12, C-13, C-14, §7.6, §9 F-61 to F-64, F-88, §10 D-4 (a), D-8 (a); SA rulings Q-3 (one alias line), Q-12 (retention select stays Radix), re-check R-7 (a page slice that builds a shared export runs the full cycle)
**Branch:** `feature/admin-layout-l3`, cut from `feature/admin-layout-l2b` at `daa1d814` (PR #296, which carries L-2a #295; both open). The L-3 PR targets `main` and carries them until they merge. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Committed (2026-10-11) — commit 4bcf33d1 on `feature/admin-layout-l3`, PR #298 open against main (fast-track: SA code review approved, QA PASS WITH NOTES); awaiting checks + user merge
**Path:** **Full cycle by classification** (R-7): L-3 builds two shared exports no pilot needed, the `badge` prop of `AdminPageHeader` and the `neutral` tone of `StatusChip`. Both were deferred to "the first page with a factual badge" (§1 rows 1, 2, 3); the "Runs off" badge is that page. Run as SA workplan review → Dev → SA code review → QA → RM under the user's fast-track (RM commits and opens the PR after SA and QA, without a user diff review)

## Overview

L-3 moves `/admin/archiving` (540-line `page.tsx` + a 145-line dialog) onto the standard. The header becomes `AdminPageHeader` with the "Runs off" badge as a neutral chip and the server "As of" line. A four-tile KPI strip goes above the cards (§7.6). Refresh moves to the Refresh-only bar. Loading and error use the shared states, and the overview body is read through `readAdminResponse`. The run history becomes a standard table with numeric columns, and every status becomes a `StatusChip` (words + icon), which also fixes the invalid `div`-in-`span` nesting (F-62). The confirm dialog takes `ADMIN_DIALOG_CLASS`, so its close X becomes visible in a light OS scheme (D-8 (a), F-88). No route, request, payload or write changes. Continue still posts without a confirmation (F-63, the user's open decision).

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-daa1d814)
- [2. Scope and decisions](#2-scope-and-decisions)
- [3. Implementation Approach](#3-implementation-approach)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Guard and registry changes](#5-guard-and-registry-changes)
- [6. Tests](#6-tests)
- [7. Verification](#7-verification)
- [8. Task List](#8-task-list)
- [9. Sizing](#9-sizing)
- [10. Risks](#10-risks)
- [11. Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
- [12. Questions for SA](#12-questions-for-sa)

---

## 1. Analysis Summary (code verified at `daa1d814`)

### 1.1 The page today

| Lines | What | Standard item |
|---|---|---|
| `page.tsx:3-45` | Leading JSDoc; `source.guard` A-1 / A-2 tie "Runs are ON" to `ARCHIVE_RUNS_ENABLED` | Must stay the first block after `'use client'` and keep both phrases |
| `:50`, `:120-152` | `ui/badge` + `!` overrides; `RunStatus` renders a `Badge` (a `div`) inside a `span` in the Last run cell | F-62, §5.9 |
| `:73`, `format.ts` | Page-local `formatUtc` / `formatCount` (copies of the shared C-5 ones) | C-5 |
| `:170-189` | `load`: `fetch('/api/admin/archiving')` (one argument), `.json().catch(() => null)`, `err.message` shown on a rejected fetch, clears `overview` on failure | §5.10 JSON reads and rules 3, 4; the clear-on-failure is kept (§5.5) |
| `:211` | `sendRun`: `.json().catch(() => null)` on the POST body | §5.10 JSON reads |
| `:228-254` | Hand-built header wrapper, h1, purple "Runs off" `Badge`, purpose line, third-style Refresh with no `aria-busy` | §5.3, F-64 |
| `:256-268` | Run notice (`run-notice`, `role` alert or status), rose / emerald | Kept; error tone moves to the §5.10 red |
| `:270-290` | Hand-built error box (`page-error`) with "Try again"; "Reading the counts…" | C-3 |
| `:347-395` | Source card: `rounded-lg`, `dt` on `text-slate-500` uppercase, big `dd` numbers | §5.7 card rules, T-5 |
| `:398-428` | Radix retention `Select` + `DARK_SELECT` | **Stays** (SA Q-12) |
| `:430-444` | "Eligible now" for the selected retention; retention is local state of `SourceCard` | KPI source (§7.6) |
| `:481-538` | Run history table: own classes, `text-slate-500` head, numbers right-aligned but not tabular, raw `errorCode` in "Error", Continue button | §5.7, F-61 (user), F-63 (user) |
| `ArchiveConfirmDialog.tsx:41`, `:85-90` | `DARK_DIALOG` copy; title / description `!` classes; confirm note on `text-slate-500` | C-10, D-8 (a), F-88 |

### 1.2 The payload (route unchanged)

`GET /api/admin/archiving` answers `{ success, data: ArchivingOverview }` (`lib/archiving/types.ts:62-69`): `generatedAt`, `runsEnabled`, `sources[]` (`key`, `label`, `totalRows`, `oldestRecordAt`, `options[]` of `{ retentionDays, cutoff, eligibleRows }`, `archivedTotal`, `latestCutoff`, `lastRun`) and `runs[]` (newest first, at most `RUN_HISTORY_LIMIT` = 20). **Key corrections to §7.6:** rows now is `totalRows` (not `rowsNow`); the eligible count is `options[].eligibleRows`. There is one source today (`ARCHIVE_SOURCES` = audit trail). `generatedAt` is a server clock the page does not show yet.

### 1.3 Shared folder facts this plan depends on

| Fact | Consequence |
|---|---|
| `AdminPageHeader` has `title`, `purpose`, `asOf`, `actions`; **no `badge`** | L-3 builds `badge` (shared export) |
| `StatusChip` tones: `danger`, `warn`, `ok`, `info`, `unknown`; **no `neutral`** | L-3 builds `neutral` (shared export; §5.3 says the header badge is a neutral chip) |
| `KpiTile` statuses: `red`, `amber` only; anchor mode `href: '#…'` exists | Last run tile can be red or amber with no shared change; green and info would be new (§2.3) |
| `AdminFilterBar` with only `onRefresh` / `busy` / `what` is the plain `<div>` | Refresh-only bar, no `readAt` (the header shows the server "As of", §5.5 part 6) |
| `readAdminResponse({ what, sessionEndedCopy })`, `ADMIN_NETWORK_ERROR` | Overview read; never touches `fetch`, so the one-argument call stays |
| `ADMIN_DIALOG_CLASS` + title / description constants (Jobs uses them) | Dialog swap; Jobs keeps its `bg-sky-600` confirm, so Archiving keeps its own (no T-7 change here) |
| `ADMIN_TABLE*`, `ADMIN_TH_NUM` / `ADMIN_TD_NUM`, `ADMIN_COUNT_LINE`, `ADMIN_BUTTON` | Run history table and buttons |
| `formatUtc(iso or null)` and `formatCount` (C-5) | Replace `format.ts`; delete it |

### 1.4 Tests that pin the page

`page.render.test.tsx` (471 lines): testids `source-audit_trail`, `total-rows`, `oldest-record`, `eligible-rows`, `eligible-cutoff`, `archived-total` (exact `/^0$/`), `archived-before`, `last-run`, `run-history-panel`, `run-{id}`, `run-status-{id}`, `continue-{id}`, `runs-off-badge`, `run-notice` (exact `textContent`), `page-error`, `archive-button`, `archive-dialog`, `dialog-*`, `confirm-archive`, `owner-history-warning`, `retention-select`; button name `Archive` (exact); one-argument `fetch` (`toEqual(['/api/admin/archiving'])`). `source.guard.test.ts`: import allow-list, exactly one POST (in `page.tsx`), `RUNS_ROUTE` pin, no `console`, no `any`, the header-comment rule.

---

## 2. Scope and decisions

### 2.1 In L-3

| # | Change | Standard |
|---|---|---|
| 1 | Header → `AdminPageHeader` with `title="Archiving"` (sidebar label), the existing purpose sentence verbatim, `asOf={overview ? 'As of ' + formatUtc(generatedAt) + '.' : null}` (Jobs wording), `badge` "Runs off" (neutral chip, testid `runs-off-badge`) when the overview says runs are off | §5.3 |
| 2 | KPI strip, 4 tiles (§2.2) | §5.4, §7.6 |
| 3 | Refresh-only `AdminFilterBar` (`what="the archiving overview"`, `busy={loading}`): `aria-busy`, standard style, name "Refresh the archiving overview" | §5.5, F-64 |
| 4 | Overview read through `readAdminResponse` (`sessionEndedCopy: true`); the POST body through `readJsonBody`; no `.json(` left in the folder | §5.10, C-4 |
| 5 | `AdminLoading` ("Reading the archiving overview…") on the first read; `AdminError` (testid `page-error`, Try again) | §5.10, C-3 |
| 6 | Refresh keeps the content mounted with `aria-busy` on the content wrapper; a failed refresh still clears it (kept, §5.5) | §5.5, §5.10 |
| 7 | Source card → §5.7 card rules (`rounded-xl`, `dt text-xs text-slate-400`, `dd text-sm text-slate-200`, numbers `tabular-nums`); the card keeps every figure and testid | §5.7, T-5 |
| 8 | Run history → standard table (`ADMIN_TABLE*`, `aria-label="Run history"`, Rows archived and Batches through `ADMIN_TH_NUM` / `ADMIN_TD_NUM`), a count line, `AdminEmpty` "No runs yet." when empty. The count line reads the limit from `RUN_HISTORY_LIMIT` (`@/lib/archiving/config`), never a literal 20: "The latest {N} runs, newest first" when `runs.length === RUN_HISTORY_LIMIT`, otherwise "{N} runs, newest first" ("1 run, newest first" for one) (SA M-3) | §5.7 |
| 9 | Every run status → `StatusChip` (§2.4), in the table and the card's Last run | §5.9, F-62 |
| 10 | `ArchiveConfirmDialog` → `ADMIN_DIALOG_CLASS`, `ADMIN_DIALOG_TITLE_CLASS`, `ADMIN_DIALOG_DESCRIPTION_CLASS`; `DARK_DIALOG` deleted; the confirm note to slate-400 | C-10, D-8 (a), F-88, T-5 |
| 11 | Archive, Cancel and Continue buttons → `ADMIN_BUTTON` (A-1 focus ring); Confirm keeps `bg-sky-600` (Jobs parity) and gains the A-1 ring | A-1 |
| 12 | `format.ts` deleted; both files import C-5 | C-5 |
| 13 | "Not switched on yet" notes and "Eligible now" label off slate-500 | T-5 |

### 2.2 Decision: the KPI strip (§7.6, K-1 to K-10)

| Tile | Value (payload) | Sub-line | Target | Colour |
|---|---|---|---|---|
| Rows now | Sum of `sources[].totalRows` | — | `#sources` | Neutral |
| Eligible now | Sum, per source, of the **selected** option's `eligibleRows` | Exactly one source: "At {N} days, before {cutoff UTC}"; any other count: no sub-line (SA S-2). A missing selected option: value "—", sub-line "Not available" | `#sources` | Neutral |
| Archived total | Sum of `sources[].archivedTotal` | — | `#run-history` | Neutral |
| Last run | `runs[0]` status word (the §2.4 words), or "None yet" | "{started UTC} · {N} rows" | `#run-history` | Failed → `red`; Partial and Stalled → `amber`; Succeeded and Running → **neutral** (§2.3); none → neutral |

- Every figure is already in the page's one read (K-9). No thresholds (D-4 (a)). Same-page anchor tiles, as Jobs (K-6).
- **Tile test ids (SA M-1).** The tiles take `kpi-rows-now`, `kpi-eligible-now`, `kpi-archived-total` and `kpi-last-run`. The card's ids (`total-rows`, `archived-total`, `eligible-rows`, `last-run` and the rest) stay on the card only: a duplicate would make every existing `getByTestId` throw, and §6.3 promises those cases stay green with no edit.
- **Eligible now follows the select.** Today the retention is local state inside `SourceCard`. It is lifted to the page as `Partial<Record<ArchiveSourceKey, RetentionDays>>`, read as `retention[source.key] ?? DEFAULT_RETENTION_DAYS` so a source the payload adds later never reads `undefined` (SA S-1); the setter keeps the `isRetentionDays` check; passed to the card as `retentionDays` + `onRetentionChange`, so the tile and the card can never show different retentions. Still no refetch (C-9d, P-3 stays green).
- The card keeps its own figures and testids. With one source today the strip repeats them; the card stays the per-source detail (oldest record, "archived before", the select, Archive). SA Q-1.
- K-10: four fixed-height placeholders during the first read; the strip is hidden on error.
- Anchors: the source cards get a wrapper `<div id="sources">`; the run-history `<section>` gets `id="run-history"`.

### 2.3 Decision: Last run tile colours (deviation from §7.6, SA Q-2)

§7.6 maps Succeeded → green and Running → info. `KpiTile` has only `red` and `amber`; `info` is not a K-4 status at all, and a green tile status would read "Healthy" and need the S-7 one-green refactor of `StatusChip.tsx` (a third shared change). K-5 permits colour, it does not require it. **Proposal:** red and amber only; Succeeded and Running are neutral tiles whose value says the word. The chips in the table and the card keep the full map, green included (§2.4).

### 2.4 Decision: run status → chip tone (K-5 (i): the payload's own status)

| Run | Word (unchanged) | Tone |
|---|---|---|
| `running` + `isStale` | Stalled | `warn` |
| `running` | Running | `info` |
| `succeeded` | Succeeded | `ok` |
| `partial` | Partial | `warn` |
| `failed` | Failed | `danger` |

One pure function `runStatus(run): { label, tone }` replaces `statusBadge`; the tile maps `danger` → `red`, `warn` → `amber`, others → no status.

### 2.5 Decision: the header badge and the neutral tone (shared exports)

- `AdminPageHeader` gains `badge?: { label: string; testId?: string }` (data, not a node), rendered by the header as `<StatusChip tone="neutral">`. This enforces §5.3 ("at most one, a factual state, the neutral chip") in the type. With a badge, the h1 sits in `<div className="flex flex-wrap items-center gap-3">` with the chip; **without one the DOM is exactly today's** (Health, Jobs, Audit trail and AI cost & usage are unchanged). SA Q-3.
- `StatusChip` gains `neutral` (`border-slate-600 bg-slate-700/40 text-slate-300`) with **no icon** (§5.9: "optional"; a plain state word needs no glyph). The tone table's `icon` becomes optional for that tone only. SA Q-4.

### 2.6 Decision: copy that stays verbatim (recorded, not changed)

- **Run outcome sentences** (`RUN_MESSAGES`, `RUN_FAILED`) stay. The runs route answers a **code**, not admin copy, so §5.10 rule 1 ("show the route's string") would put `run_in_progress` on screen, which G-8 forbids. The POST uses `readJsonBody` and the page's own mapping. A rejected POST keeps "The run could not be started / continued." rather than `ADMIN_NETWORK_ERROR` (existing behaviour; SA Q-5).
- **The Error column keeps the raw `errorCode`** (`batch_failed`), styled as a code (`font-mono text-[11px]`). Rewording it is copy, F-61 is the user's (§9).
- **Continue posts without a confirmation** (F-63, the user's).
- The purpose sentence, "Runs off", "Not switched on yet", every card label and every dialog sentence are unchanged.

### 2.7 Visible changes on `/admin/archiving` (named in the PR)

1. A KPI strip of four tiles above the card. 2. "As of {time} UTC." under the purpose. 3. "Runs off" is a slate chip, not purple (only visible when runs are off). 4. Refresh in the standard style at the right of its own row, with a spinner and `aria-busy`. 5. "Reading the archiving overview…" instead of "Reading the counts…". 6. A network failure reads "Could not reach the server…" instead of the browser's own message (for example "Failed to fetch"); an unreadable error body reads "Could not read the archiving overview. Try again in a moment."; a 401 / 403 reads "Your admin session has ended. Sign in again." 7. Card figures are smaller (the big numbers move to the strip); labels are no longer upper case. 8. Run history in the standard table, with a count line and status chips with icons. 9. The dialog close X is visible in a light OS scheme. 10. Buttons get the purple focus ring. 11. An invalid timestamp shows "—" instead of the raw text (shared C-5 behaviour). 12. The chosen retention now survives a failed refresh and a Try again (it lives on the page, not in the card that unmounts on the clear); before, the card came back at 365 days (SA S-1). 13. The run notice's error tone is the §5.10 red instead of rose; its success tone stays emerald (SA S-8).

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

| File | Change |
|---|---|
| `StatusChip.tsx` | `StatusTone` adds `'neutral'`; the tone table is typed as the icon tones (`danger`, `warn`, `ok`, `info`, `unknown`, each `{ classes; icon: LucideIcon }`, icon required) plus `neutral: { classes; icon: null }`, so dropping an icon from any tone but `neutral` stays a type error (§5.9, SA M-4); render the icon only when present. The existing four-tone `it.each` is not edited; T-1 adds `neutral`. Header comment: "Amended by L-3: `neutral` (no icon) arrives with its first consumer, Archiving's header badge". No green added |
| `AdminPageHeader.tsx` | `badge?: { label: string; testId?: string }`; imports `StatusChip` (same folder, S-3). Conditional title row (§2.5). Header comment: "Amended by L-3: `badge` arrives with Archiving's Runs off" (SA M-4) |

### 3.2 Page folder (`app/admin/archiving/`)

| File | Change |
|---|---|
| `page.tsx` | Imports from the alias only. `runStatus` (§2.4) replaces `statusBadge`; `RunStatus` renders `StatusChip` with testid `run-status-{id}`. `load` takes the HealthGrid / Jobs shape (SA M-2): only `fetch('/api/admin/archiving')` (still one argument) sits inside the inner `try`, whose `catch` sets `ADMIN_NETWORK_ERROR` and `setOverview(null)`; then `readAdminResponse<ArchivingOverview>(response, { what: 'the archiving overview', sessionEndedCopy: true })`, whose not-ok branch sets `result.message` and `setOverview(null)`; `setLoading(false)` in `finally`. Nothing reads `err.message` (§5.10 rule 4). `sendRun` reads the body with `readJsonBody`; `RUNS_ROUTE` constant and its single POST untouched. Retention state lifted (§2.2). Region order: header → strip → bar → content (`aria-busy` wrapper holding notice, error, loading, `#sources`, `#run-history`). Leading JSDoc: "Runs are ON" and `ARCHIVE_RUNS_ENABLED` kept; the "text badge" sentence becomes "a status chip, words and icon". `DARK_SELECT` kept |
| `components/ArchivingKpis.tsx` (new) | `KpiStrip` + 4 `KpiTile`s from `overview` and the retention map; pure `lastRunTile(runs)` and `eligibleTile(sources, retention)` helpers exported for the test. No fetch, no POST |
| `components/ArchiveConfirmDialog.tsx` | Shared dialog constants, `ADMIN_BUTTON`, C-5 formatters; `DARK_DIALOG` and its comment removed |
| `format.ts` | Deleted |

`page.tsx` should land near 520 lines (the strip moves out, the header and states shrink, the table and lifted state add a little).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/StatusChip.tsx` | modify | `neutral` tone (shared export) |
| `app/admin/components/layout/AdminPageHeader.tsx` | modify | `badge` prop (shared export) |
| `app/admin/components/layout/__tests__/StatusChip.render.test.tsx` | modify | `neutral` cases |
| `app/admin/components/layout/__tests__/AdminPageHeader.render.test.tsx` | modify | `badge` cases + no-badge DOM pin |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Archiving entry in `MIGRATED_PAGES`; header note "Amended by L-3: Archiving joins the registry; no rule change" (SA M-4) |
| `app/admin/archiving/page.tsx` | modify | §3.2 |
| `app/admin/archiving/components/ArchivingKpis.tsx` | create | KPI strip |
| `app/admin/archiving/components/ArchiveConfirmDialog.tsx` | modify | C-10 |
| `app/admin/archiving/format.ts` | delete | C-5 |
| `app/admin/archiving/__tests__/source.guard.test.ts` | modify | Q-3 alias line |
| `app/admin/archiving/__tests__/page.render.test.tsx` | modify | One edit + new cases (§6) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 8; §7.6 key names and as-built; §9 F-62, F-64, F-88 (Archiving) done L-3; Change History |
| `docs/workplans/ADMIN_LAYOUT_L3_WORKPLAN.md` | create | This file |

Line endings kept per file (the archiving files are CRLF, the shared files LF). Nothing outside these files; no `components/ui` edit; no sidebar edit.

---

## 5. Guard and registry changes

| Guard | Edit | Why |
|---|---|---|
| `archiving/__tests__/source.guard.test.ts` `isAllowedImport` | **One line:** `if (specifier.startsWith('@/app/admin/components/layout/')) return true;` | SA Q-3 |
| Same file, the existing negative-control test | **Three assertions, no new test** (SA Q-6, M-5): `isAllowedImport(page, '@/app/admin/components/layout/StatusChip')` → `true`; `isAllowedImport(page, '@/app/admin/components/AdminHeader')` → `false` (a sibling of the shared folder); `isAllowedImport(page, '../components/layout/StatusChip')` → `false` (the relative spelling, S-1) | Proves the alias line is exactly as wide as intended |
| Same file, other rules | **No edit** (M-5: the alias line and the three assertions are the whole `source.guard` change; the `'./format'` positive assertion stays, N-2). Exactly one POST stays in `page.tsx`; `RUNS_ROUTE` stays `const RUNS_ROUTE = '/api/admin/archiving/runs';`; the new `ArchivingKpis.tsx` has no `fetch`; the header-comment rule keeps passing | — |
| `layoutFolder.guard.test.ts` `MIGRATED_PAGES` | Add `/admin/archiving (Archiving)`: `page.tsx`, `components/ArchiveConfirmDialog.tsx`, `components/ArchivingKpis.tsx` | Registry: header import, no own h1, no `.json(`, alias only |
| `layoutFolder.guard.test.ts` part (a) | **No edit expected.** `AdminPageHeader` → `StatusChip` is a same-folder import; no new green; no fetch, no `.json(`, no region | S-3 to S-8 |

---

## 6. Tests

### 6.1 New

| Id | File | Asserts |
|---|---|---|
| T-1 | `StatusChip.render` | `neutral`: a span, `data-tone="neutral"`, slate classes, `textContent` exactly the words, **no svg**, no green |
| T-2 | `AdminPageHeader.render` | `badge`: the chip sits beside the one h1, carries `data-tone="neutral"` and the testid; without `badge` the h1 is a direct child of the first `div` (today's DOM) and no chip renders |
| T-3 | `page.render` | Header: exactly one h1 "Archiving"; "As of 2026-09-26 12:00 UTC." from `generatedAt`; no `runs-off-badge` while runs are on; with runs off the badge is a neutral chip |
| T-4 | `page.render` | Strip (tile ids `kpi-*`, SA M-1): 4 tiles with values 12,345 / 1,111 / 0 / "None yet", hrefs `#sources` / `#sources` / `#run-history` / `#run-history`, `#sources` and `#run-history` exist; Eligible now follows the select (180 → 2,222) with still one fetch |
| T-5 | `page.render` | Last run tile `data-status`: failed → `red`, partial and stalled → `amber`, succeeded and running → `neutral`; accessible name per K-7 ("Last run, Failed, needs action") |
| T-6 | `page.render` | K-10: placeholders while the first read is pending, no tiles; on error no strip and no placeholders |
| T-7 | `page.render` | Table: `aria-label="Run history"`; Rows archived and Batches cells carry `text-right` and `tabular-nums`; chip tones per §2.4 via `data-tone`; count line "3 runs, newest first" and, at `RUN_HISTORY_LIMIT` runs, "The latest {RUN_HISTORY_LIMIT} runs, newest first" (the fixture length and the expected words both read the constant, SA M-3) |
| T-8 | `page.render` | F-62: no `div` inside a `span` anywhere in the rendered page (with runs and a last run) |
| T-9 | `page.render` | States: a rejected `fetch` → exactly `ADMIN_NETWORK_ERROR`; a 401 → the session-ended sentence; Refresh's name is "Refresh the archiving overview" and it has `aria-busy` while reading; during a refresh the card stays mounted and the content wrapper has `aria-busy="true"`; a failed refresh clears the counts (existing choice, pinned) |
| T-10 | `page.render` | Dialog: every class of `ADMIN_DIALOG_CLASS` is on the dialog element and its close button is a direct child (the Jobs pin, `jobsQueues.layout.render.test.tsx:260-266`) |
| T-11 | `page.render` | A rejected POST still reads "The run could not be continued." (pins §2.6, the page's own copy over `ADMIN_NETWORK_ERROR`) |

### 6.2 Edited deliberately (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `page.render` P-6 "shows the route message and a retry" | `within(error).getByRole('button', { name: 'Try again' })` → `screen.getByRole(...)` | `AdminError` puts the testid on the message element (RC-3); the button is its sibling |
| `source.guard` | Exactly the one alias line in `isAllowedImport`, plus the three Q-6 assertions inside the existing negative-control test; nothing else (SA M-5) | §5 |
| `layoutFolder.guard` | Registry entry + "Amended by L-3" header note; no rule change | §5 |
| `StatusChip.render`, `AdminPageHeader.render` | New cases appended | Shared exports |

### 6.3 Must stay green with no edit

Every other case in `page.render` (P-1 one-argument fetch, P-2, P-3 no refetch, G-1 to G-8, P-7), every other `source.guard` case, `ArchivedBeforeNotice.render`, the archiving route tests, `adminGate.writes`, `AdminSidebar.nav`, and every consumer of `AdminPageHeader` and `StatusChip` (Health, Jobs, Audit trail, AI cost & usage suites).

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-1 | `npx jest app/admin/archiving app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/analytics app/admin/components/__tests__ --ci` (archiving, shared folder, Health and Jobs, the other header and chip consumers) | All green; counts recorded |
| V-2 | `npx jest app/api/admin/archiving app/api/admin/__tests__/adminGate.writes.test.ts --ci` | Green, untouched |
| V-3 | `npm run test:bos-entitlements` | Green (no entitlements import; run per the standing rule) |
| V-4 | Scoped `tsc`: scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`; includes `next-env.d.ts`, `app/admin/archiving/**`, the shared folder and its tests, `lib/archiving/config.ts` and `types.ts`, `components/ui/dialog.tsx` and `select.tsx`, and the other `AdminPageHeader` / `StatusChip` consumers. **Run 1** with a canary `const canary: number = 'x';` in `ArchivingKpis.tsx` → exactly that TS2322. **Run 2** without it → zero errors | Both runs recorded |
| V-5 | `npm run lint:hooks`; `npx eslint` on the touched files | Clean |
| V-6 | Mutation checks (each reverted, md5 compared): (a) drop the alias line → `source.guard` fails on `page.tsx`; (b) put `DARK_DIALOG` back → T-10 fails; (c) map `failed` to `warn` → T-5 and T-7 fail; (d) `sessionEndedCopy: false` → T-9 fails; (e) give `neutral` an icon → T-1 fails; (f) add a second `method: 'POST'` in `ArchivingKpis.tsx` → "exactly one POST" fails; (g) flip "Runs are ON" in the JSDoc → A-2 fails | Each fails as stated |
| V-6b | SA S-3 mutations: (h) always wrap the h1 row in `AdminPageHeader` → T-2's no-badge DOM pin fails; (i) move retention back into `SourceCard` → T-4 "Eligible now follows the select" fails; (j) keep `overview` on a failed refresh → T-9's clear pin fails. Extra: (k) render a badge with no badge prop present → T-3 fails | Each fails as stated |
| V-7 | `grep` the archiving folder for `.json(`, `Badge`, `DARK_DIALOG`, `text-slate-500`, `./format`, `err.message` (SA M-2) | None |
| V-8 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions match the plan; no file emptied |

### 7.1 Browser checks for TL / QA (signed-in admin, DevTools Network open, light and dark OS scheme emulation)

| # | Check |
|---|---|
| L-B1 | `/admin/archiving` loads with one `GET /api/admin/archiving`; header "Archiving", purpose, "As of … UTC."; no shell title |
| L-B2 | Four tiles; Rows now, Archived total match the card; each tile jumps to its anchor; Tab order header → tiles → Refresh → content |
| L-B3 | Change retention to 180 then 90: the Eligible now tile and the card change together, no new request |
| L-B4 | Refresh: spinner, `aria-busy`, the card stays on screen, one new GET, "As of" updates |
| L-B5 | Run history: numbers right-aligned and aligned digits; chips with icons; Error column shows the code in mono |
| L-B6 | Open Archive: dark dialog in **both** schemes; with light emulation, the close X computed `color` is `rgb(203, 213, 225)` (slate-300) and opacity 1; focus ring purple; Escape closes and focus returns to Archive |
| L-B7 | Offline (DevTools) then Refresh: "Could not reach the server…" with Try again; counts cleared; back online + Try again restores them |
| L-B8 | No Confirm or Continue is clicked in production unless the TL intends to archive (runs are on) |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding (M-1 to M-5 applied 2026-10-11: §2.2, §2.1 row 8, §3.1, §3.2, §4, §5, §6.1, §6.2, §7)
- [x] 2. `StatusChip` `neutral` + T-1
- [x] 3. `AdminPageHeader` `badge` + T-2
- [x] 4. `source.guard` alias line (+ Q-6 negative control)
- [x] 5. `ArchiveConfirmDialog` → shared constants, `ADMIN_BUTTON`, C-5; T-10
- [x] 6. `page.tsx`: imports, `runStatus` + chips, header, bar, states, `readAdminResponse` / `readJsonBody`, lifted retention, card restyle, table, anchors; delete `format.ts`
- [x] 7. `ArchivingKpis.tsx` + T-4 to T-6
- [x] 8. Remaining `page.render` cases (T-3, T-7 to T-9, T-11) and the P-6 edit
- [x] 9. `MIGRATED_PAGES` entry
- [x] 10. V-1 to V-8; record results in Implementation Notes
- [x] 11. Requirement: §1 row 8, §7.6 keys and as-built, §9 F-62 / F-64 / F-88 (Archiving), Change History
- [ ] 12. Hand to SA code review, then QA (nothing committed by Dev) — handed to TL 2026-10-11

---

## 9. Sizing

| Part | Days |
|---|---|
| Shared exports + tests (steps 2-3) | 0.25 |
| Dialog (step 5) | 0.25 |
| Page + KPI component (steps 6-7) | 0.75 |
| Page tests (step 8) | 0.5 |
| Guards, verification, docs (steps 4, 9-11) | 0.25 |
| **Total** | **about 2 days** |

One slice; well under the "a few days" limit, no split.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A tile's accessible name contains "Archive" and steals `getByRole('button', { name: 'Archive' })` | Tiles are links, not buttons; RTL's string name match is exact |
| Adding a second argument to the overview `fetch` breaks P-1 and G-5 | The call stays `fetch('/api/admin/archiving')`; no `AbortController` added |
| The header JSDoc moves or loses "Runs are ON" | Edit only the status-chip sentence; A-1 / A-2 run in V-1 and mutation (g) |
| Lifting retention re-renders the Radix select and closes it mid-pick | The select is controlled by the same value either way; P-3 and G-4 exercise the picks |
| `AdminPageHeader` change shifts other pages' DOM | Conditional wrapper only with a badge; T-2 pins the no-badge DOM; all consumer suites in V-1 |

---

## 11. Out of scope and found on the way

- F-61 (raw `errorCode`) and F-63 (Continue without confirmation): the user's, kept as they are (§2.6).
- T-7 purple primary for Confirm: Jobs kept sky; a cross-page decision, not this slice.
- The source cards stay full width, one per source, not the §5.7 three-column card grid: each card holds a select, a dialog and a run button, and there is one source. Recorded deviation.
- Found on the way: nothing new yet; anything found during coding goes to §9.

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | With one source, the strip repeats the card's Rows now, Archived total and Last run. Build the §7.6 strip anyway, or no strip (K-1 "no filler")? | Build it, as §7.6 approved; the card keeps the per-source detail, and a second source makes the strip a real summary |
| Q-2 | Last run tile: red and amber only, Succeeded and Running neutral (§2.3), instead of §7.6's green and info? | Yes; avoids two more shared statuses and a "Healthy" label on a run |
| Q-3 | `badge` as data (`{ label, testId }`, header renders the neutral chip) rather than a `ReactNode`? | Data: it enforces §5.3 in the type |
| Q-4 | `neutral` chip with no icon? | Yes (§5.9 "optional") |
| Q-5 | The run POST keeps its own code-to-sentence mapping and its own network-failure sentence, not `readAdminResponse` / `ADMIN_NETWORK_ERROR` (§2.6)? | Yes; the route answers codes, and G-8 forbids showing them |
| Q-6 | Add the one negative-control assertion beside the alias line in `source.guard`? | Yes; it proves the alias does not open all of `app/admin/components` |
| Q-7 | Header "As of" from `generatedAt` and no "Read at" in the bar (Jobs pattern), rather than a client "Read at"? | Yes; one clock, the server's |
| Q-8 | Path: full cycle (two shared exports, R-7), under the user's fast-track? | Yes |

---

## Implementation Notes

**Dev, 2026-10-11.** Code complete on `feature/admin-layout-l3`, **uncommitted** (RM commits after SA code review and QA). `format.ts` is deleted in the working tree only (not staged).

### Files

| File | Change |
|---|---|
| `app/admin/components/layout/StatusChip.tsx` | `neutral` tone (`border-slate-600 bg-slate-700/40 text-slate-300`, `icon: null`); tone table typed as the five icon tones (icon required) plus `neutral: { classes; icon: null }` (M-4); the icon renders only when present; "Amended by L-3" header note |
| `app/admin/components/layout/AdminPageHeader.tsx` | `badge?: AdminPageHeaderBadge` (`{ label; testId? }`), rendered as `StatusChip tone="neutral"` in a `flex flex-wrap items-center gap-3` row with the h1; without a badge the h1 is a direct child of the first `div`, as before; "Amended by L-3" header note |
| `app/admin/archiving/page.tsx` | §3.2: shared header (badge "Runs off" only when the overview says runs are off), strip, Refresh-only bar, `AdminError` / `AdminLoading`, `load` in the Jobs shape (M-2), `readJsonBody` for the POST body, retention lifted (`Partial<Record>`, S-1), card restyle, `id="sources"` wrapper, `id="run-history"` on the existing section (no name, S-7), standard table with count line (M-3) and `AdminEmpty`, chips, `ADMIN_BUTTON` on Continue, run notice error tone red (S-8). JSDoc keeps "Runs are ON" and `ARCHIVE_RUNS_ENABLED`; the "text badge" sentence now says "status chip, words and icon"; a short Layout paragraph added. 565 lines (plan said about 520: the comments on the M-2 shape, the anchors and the busy wrapper) |
| `app/admin/archiving/components/ArchivingKpis.tsx` (new) | `ArchivingKpis`, plus the pure `runStatus`, `lastRunTile`, `eligibleTile`, `retentionFor` and the `RetentionChoice` type. No fetch, no POST |
| `app/admin/archiving/components/ArchiveConfirmDialog.tsx` | `ADMIN_DIALOG_CLASS` / title / description constants, `ADMIN_BUTTON` on Archive and Cancel, Confirm keeps `bg-sky-600` and gains the A-1 ring, confirm note slate-400, C-5 formatters; `DARK_DIALOG` and its comment removed |
| `app/admin/archiving/format.ts` | Deleted |
| Tests | `StatusChip.render` (+1 case), `AdminPageHeader.render` (+2), `source.guard` (+1 allow line, +3 assertions), `page.render` (+28 cases, 1 edited line, 4 imports), `layoutFolder.guard` (registry entry + header note) |
| Docs | Requirement §1 row 8, §6.2 C-2 / C-12, §7.6, §9 F-62 / F-64 / F-88 (Archiving) done, F-101 and F-102 added, Change History; this workplan |

### Tests edited (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `page.render` P-6 "shows the route message and a retry" | `within(error).getByRole('button', { name: 'Try again' })` → `screen.getByRole(...)`, with a comment | `AdminError` puts the testid on the message element (RC-3); the button is its sibling |
| `source.guard` | One alias line in `isAllowedImport`; three assertions in the existing negative-control test (alias allowed; `@/app/admin/components/AdminHeader` refused; `../components/layout/StatusChip` refused) | SA Q-3, Q-6, M-5 |
| `layoutFolder.guard` | Archiving entry in `MIGRATED_PAGES` (`page.tsx`, `ArchiveConfirmDialog.tsx`, `ArchivingKpis.tsx`); header "Amended by L-3"; no rule change | Registry |
| `StatusChip.render`, `AdminPageHeader.render` | Cases appended; the four-tone `it.each` untouched | Shared exports |

Every other existing case passed with no edit (P-1 one-argument fetch, P-2, P-3, G-1 to G-8, P-6 rest, P-7).

### Verification results

| # | Result |
|---|---|
| V-1 / V-2 | `npx jest app/admin/archiving app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/analytics app/admin/components/__tests__ app/api/admin/archiving app/api/admin/__tests__/adminGate.writes.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **61 suites, 1,807 tests, all passed** (every path existed). Archiving alone: 2 suites, 81 tests |
| V-3 | `npm run test:bos-entitlements`: 233 suites, 6,382 tests passed (one "worker failed to exit gracefully" warning, no failure) |
| V-4 | Scoped `tsc` (scratch tsconfig in the session scratchpad, never in the repo; archiving folder, shared folder and tests, `lib/archiving/config.ts` and `types.ts`, `components/ui/dialog.tsx`, `select.tsx`, `sheet.tsx`, analytics, audit-trail page, `HealthGrid.tsx`, `JobsQueuesView.tsx`). **Run 1** with `const canary: number = 'x';` appended to `ArchivingKpis.tsx`: exactly one error, `ArchivingKpis.tsx(141,7): error TS2322`, exit 2. Canary removed, md5 equal to before. **Run 2**: zero errors, exit 0. Extra type check of M-4: `ok` with `icon: null` gives `StatusChip.tsx(45,27): error TS2322: Type 'null' is not assignable to type 'LucideIcon'` (restored, md5 equal) |
| V-5 | `npm run lint:hooks`: exit 0. `npx eslint` on the 10 touched code and test files: exit 0, no output |
| V-6 / V-6b | Mutations, each run then restored, md5 equal to before for every touched file: (a) alias line dropped → 4 `source.guard` failures (page, dialog, KPI file, negative control); (b) `DARK_DIALOG` classes back → T-10 fails; (c) `failed` → `warn` → T-5 "failed" and T-7 tones fail; (d) `sessionEndedCopy: false` → T-9 401 fails; (e) `neutral` given `Info` → T-1 fails; (f) a second `method: 'POST'` in `ArchivingKpis.tsx` → "exactly one POST" fails; (g) see deviation 4: flipping both "Runs are ON" occurrences → A-2 fails; (h) header always wraps the h1 → T-2 no-badge pin fails; (i) retention back in `SourceCard` state → T-4 "follows the select" fails; (j) `overview` kept on a failed read → T-9 clear pin fails; (k) badge whenever an overview exists → T-3 "no badge while runs are on" fails |
| V-7 | `grep` of the archiving source files for `.json(`, `Badge`, `DARK_DIALOG`, `text-slate-500`, `./format`, `err.message`: none. (The `'./format'` assertion in `source.guard` stays, N-2) |
| V-8 | `git diff --stat feature/admin-layout-l2b`: 11 tracked files, 668 insertions, 215 deletions; `format.ts` −15 (the planned deletion); no file emptied. Untracked: `ArchivingKpis.tsx` (139 lines) and this workplan. Line endings kept: archiving files CRLF (the new file too), shared files and docs LF |

### Deviations

1. **`runStatus` lives in `ArchivingKpis.tsx`**, exported, not in `page.tsx`: the tile and the chips share one map, and the page imports the KPI file, so the reverse import would be a cycle. No new file.
2. **The run notice and the error box sit outside the `aria-busy` content wrapper** (§3.2 put them inside). `sendRun` re-reads the overview straight after setting the notice, and an `aria-busy` ancestor would hold back its announcement; Jobs keeps its error outside too. The wrapper holds `#sources` and `#run-history` (test id `archiving-content`).
3. **The run notice and the cards use `rounded-xl`** (§5.7 card radius) instead of `rounded-lg`.
4. **Mutation (g) flips both occurrences of "Runs are ON".** The header quotes the phrase a second time in its "switching off" paragraph, so flipping only the status sentence leaves A-2 green. Existing guard property, not changed here (no `source.guard` edit beyond M-5); recorded as requirement §9 F-102.
5. **Extra mutation (k)** and the extra cases (M-1 ids once each, S-1 retention survives a failed refresh, S-2 missing option, S-7 single Archive button, singular count line, no "As of" before the first read) were added beyond §6.1.

### User-visible changes on `/admin/archiving` (for the PR)

The 13 items of §2.7, as built. In short: a four-tile KPI strip; "As of {time} UTC." under the purpose; "Runs off" as a slate chip (only while runs are off); Refresh in the standard style with a spinner and `aria-busy`; "Reading the archiving overview…"; shared error sentences (network, unreadable body, session ended); smaller card figures, labels no longer upper case; run history as the standard table with a count line and status chips with icons; the dialog close X visible in a light OS scheme; purple focus rings on the buttons; "—" for an invalid timestamp; the chosen retention survives a failed refresh; the run notice's error tone is red, not rose.

### Out of scope, found on the way (listed, not fixed)

- Requirement §9 F-101 (SA S-6, the user's copy): after a rejected run POST, "could not be started / continued" may be wrong if the request reached the server; the re-read history shows the truth.
- Requirement §9 F-102: `source.guard` A-2 is satisfied by the quoted phrase alone (deviation 4).

## SA Review Notes

Workplan review: see "SA Workplan Review — 2026-10-11" below. The code review is added here at the code stage.

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11** (workplan stage, no code). Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l3` at `daa1d814` (PRs #295 / #296 open).
**Status:** APPROVED WITH CONDITIONS (M-1 to M-5 are workplan edits Dev makes before coding, no second SA pass; S-1 to S-8 checked at code review). One slice, about 2 days. Full cycle. No product question for the user.

**Verified against the code at `daa1d814`:** `archiving/page.tsx` (`statusBadge` `:124-138`, `RunStatus` `:145-152`, `load` `:170-189` clearing `overview` on failure, `sendRun` `:198-224` calling `load()` after every POST, header `:228-254`, error box `:270-288`, `SourceCard` with local retention `:340`, the `div`-in-`span` at `:384-385`, table `:487-537`); `ArchiveConfirmDialog.tsx` (`DARK_DIALOG` `:41`, confirm note `text-slate-500` `:136`); `format.ts` (returns the raw text on an invalid date; the shared `formatUtc` returns an em dash, already named as visible change 11); `source.guard.test.ts` (`isAllowedImport` `:55-69`, negative control `:96-109`, one-POST `:120-125`, fetch-target count `:127-140`, JSDoc A-1 / A-2 `:153-174`); `page.render.test.tsx` (P-6 `within(error)` `:409`; the fallback assertions `:408`, `:426` are substrings, so the shared fallback "Could not read the archiving overview. Try again in a moment." keeps them green); shared `StatusChip.tsx` (no `neutral`; the four-tone `it.each` in `StatusChip.render.test.tsx:18-42` expects one svg each and does not enumerate `neutral`), `AdminPageHeader.tsx` (no `badge`), `KpiStrip.tsx` (`KpiTileStatus = 'red' | 'amber'`, K-7 name `label, value, status`), `adminDialog.ts`, `readAdminResponse.ts`, `readJsonBody.ts` (catches the parser), `adminTable.ts` (`ADMIN_BUTTON`), `layoutFolder.guard.test.ts` (`EXPECTED_SOURCES`, `MIGRATED_PAGES`); `lib/archiving/config.ts:78` (`RUN_HISTORY_LIMIT`, importable under the guard); `route.ts:210` (`generatedAt` = server `now`). For the refresh-failure question: Jobs (`JobsQueuesView.tsx:349-355`, SA Q-11) and Audit trail (`audit-trail/page.tsx:706-711`) keep the previous data on a failed refresh.

### Rulings on Q-1 to Q-8

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Build the four-tile strip.** | K-1 forbids filler, not repetition: the four numbers are the page's real headline figures, and §7.6 approved them. The card becomes the per-source detail (oldest record, "archived before", the select, Archive), and every Monitor page now opens with a strip, so its absence here would be the inconsistency. With a second source the strip becomes a true summary at no cost |
| Q-2 | **Approved: red and amber only; Succeeded, Running and "None yet" are neutral tiles.** Record it in §7.6 as an as-built deviation. | K-5 (i) is met: `run.status` is in the page's own payload, and today's `statusBadge` already paints Failed rose and Partial / Stalled amber, so a red or amber tile repeats an existing signal and adds no rule. K-5 permits colour, it never requires it. §7.6's "Running → info" cannot be built at all (info is not a K-4 tile status), and a green tile would read "Healthy" for one run's outcome and needs the S-7 one-green refactor: a third shared change for no signal the chip does not already give. The chips keep the full map, green included |
| Q-3 | **Approved: `badge?: { label: string; testId?: string }`, rendered by the header as `StatusChip tone="neutral"`.** | §5.3 says at most one badge, a factual state, the neutral chip. Data enforces all three in the type; a `ReactNode` would let the next page pass a coloured chip or a decorative pill. Same-folder import (S-3) |
| Q-4 | **Approved: `neutral` has no icon.** | §5.9 lists the icon as required for danger, warn, ok and unknown, and "optional" for neutral. A-7 forbids colour as the only signal; a slate chip carries no colour meaning and its words are the whole signal, so there is nothing for an icon to back up. Type it so only `neutral` may lack an icon (M-4) |
| Q-5 | **Approved: the run POST keeps its own code-to-sentence map and its own network sentence.** Not `readAdminResponse`, not `ADMIN_NETWORK_ERROR`. | §5.10 rule 1 assumes the route's `error` is admin copy; the runs route answers codes (`run_in_progress`), which G-8 forbids on screen, so the page map is the copy. The network sentence is a write outcome worded for the button pressed and pinned by G-8; changing it is copy on a write path, not layout. One finding recorded for the user (S-6) |
| Q-6 | **Approved, and widened to three assertions inside the existing negative-control test** (no new test): the alias is allowed (`@/app/admin/components/layout/StatusChip` → true), a sibling of the shared folder is not (`@/app/admin/components/AdminHeader` → false), and the relative spelling into the shared folder is not (`../components/layout/StatusChip` → false, S-1). | Q-3's "one line" governs the allow-list, not the self-tests. The three assertions prove the line is exactly as wide as intended. No other `source.guard` edit (M-5) |
| Q-7 | **Approved: header "As of {time} UTC." from `generatedAt` (Jobs wording), no "Read at" in the bar.** | §5.5 part 6: a page whose header shows a server clock omits "Read at", so the page never shows two clocks. `generatedAt` is the route's `now` (`route.ts:210`) |
| Q-8 | **Full cycle, confirmed** (R-7), under the user's fast-track: SA code review, then QA, then RM. | L-3 builds two shared exports no pilot needed (`badge`, `neutral`), both used by every later page with a factual badge |

### Checks asked for by TL

| Check | Result |
|---|---|
| Retention lifted to page state: no refetch, tests kept | **Holds.** The select changes state only; the overview carries every option's count (C-9d), so P-3's single-fetch pin stays green. Side effect to name in the PR: the choice now survives a failed refresh and a Try again (today the card unmounted on the clear and came back at 365 days). A successful Refresh already kept it, so this is the more consistent behaviour. S-1 for the typing |
| Failed refresh still clears content | **Keep clearing. SA decision, not a product question.** §5.5 names Archiving (with Admin users) as a page that deliberately clears and says the choice is kept. Jobs and Audit trail keep stale data, but neither has a destructive action fed by the stale figures: here the Archive dialog shows "Records that will move" and the cutoff from the same overview, and stale counts in a confirm before an irreversible move are the hazard the clear exists for. With the clear, the strip hides (K-10) and "As of" disappears with the data, so nothing old looks current |
| Dialog adoption removes `DARK_DIALOG` | **Yes.** `ADMIN_DIALOG_CLASS` is a superset (palette, `[color-scheme:dark]`, close-X colour, opacity and focus ring) and contains no "flex" (SA M-2 of L-1b). V-7 greps `DARK_DIALOG`; mutation (b) proves T-10. The dialog's header comment about the "DARK_SELECT precedent" is rewritten to point at `adminDialog.ts` |
| Badge nesting fix (F-62) | **Fixed by construction:** `StatusChip` is a `<span>`, the cell wrapper is a `<span>`, and `ui/badge` leaves the folder. T-8 pins it page-wide |
| `source.guard` edit | **Exactly the one alias line in `isAllowedImport`, plus the three Q-6 assertions.** No other rule changes. The existing `'./format'` positive assertion stays: it tests the relative-path rule, not that the file exists (N-2) |
| No API or data change | **Confirmed.** §4 lists no route, repository, migration or `lib/` file. The one POST, `RUNS_ROUTE`, and the one-argument overview `fetch` are unchanged |
| Tests enumerated | **Yes** (T-1 to T-11, four deliberate edits, the must-stay-green list). Additions in M-1, S-3 |
| Mutation checks | **Good; three added** (S-3) |
| Browser checks | **Good**, including L-B6 (close X computed `rgb(203, 213, 225)`, opacity 1, light emulation). Additions in S-4 |
| Size | **About 2 days is right.** One slice; no tripwire needed |

### Findings

**Must (workplan edits before coding; no second SA pass):**

| # | Finding |
|---|---|
| M-1 | **Tile test ids must not reuse the card's.** `total-rows`, `archived-total`, `eligible-rows`, `last-run` and the rest stay on the card only; the tiles take `kpi-rows-now`, `kpi-eligible-now`, `kpi-archived-total`, `kpi-last-run`. A duplicate makes every existing `getByTestId` throw, and §6.3 promises those cases stay green with no edit. Say so in §2.2 |
| M-2 | **`load` takes the HealthGrid / Jobs shape:** only the `fetch` sits inside the inner `try`; its `catch` sets `ADMIN_NETWORK_ERROR`; the not-ok branch sets `result.message`; **both** failure branches `setOverview(null)`; `setLoading(false)` in `finally`. Nothing anywhere reads `err.message` (§5.10 rule 4). Add `err.message` to the V-7 grep |
| M-3 | **The count line reads the limit from `RUN_HISTORY_LIMIT` (`@/lib/archiving/config`, already allowed by the guard), never a literal 20.** "The latest {N} runs, newest first" when `runs.length === RUN_HISTORY_LIMIT`, otherwise "{N} runs, newest first" (singular for one) |
| M-4 | **`StatusChip` typing keeps the icon required for every tone except `neutral`**, for example a tone table typed as the icon tones plus `neutral: { classes; icon: null }`, so §5.9's "icon required for danger, warn, ok, unknown" stays a type error to break. The existing four-tone `it.each` is not edited; T-1 adds `neutral`. Header comments of `StatusChip.tsx`, `AdminPageHeader.tsx` and `layoutFolder.guard.test.ts` ("Amended by L-3: Archiving joins the registry; no rule change") updated |
| M-5 | **§5 and §6.2 record the guard edit as decided above:** the one alias line, plus the three Q-6 assertions in the existing negative-control test, and nothing else in `source.guard` |

**Should (checked at code review):**

| # | Finding |
|---|---|
| S-1 | Retention map typed `Partial<Record<ArchiveSourceKey, RetentionDays>>`, read as `retention[source.key] ?? DEFAULT_RETENTION_DAYS`, so a source the payload adds later never reads `undefined`. The setter keeps the `isRetentionDays` check. Name the survives-a-failed-refresh change in §2.7 |
| S-2 | Eligible now tile: with exactly one source, the sub-line "At {N} days, before {cutoff UTC}"; with any other count, **no sub-line** (drop the "At each source's chosen retention" sentence: `ArchiveSourceKey` has one member, so that branch cannot be reached by a typed fixture and would ship untested copy). When the selected option is missing, value "—" and sub-line "Not available", as the card says |
| S-3 | Three more mutations: (h) always wrap the h1 row in `AdminPageHeader` → T-2's no-badge DOM pin fails; (i) move retention back into `SourceCard` → T-4 "Eligible now follows the select" fails; (j) keep `overview` on a failed refresh → T-9's clear pin fails |
| S-4 | Browser checks: in light emulation, the retention select (trigger and open list) is still dark (`DARK_SELECT` unchanged, Q-12), and the KPI tiles and chips are legible. The "Runs off" chip cannot be seen in production while runs are on: it is verified by T-3 and T-2 only; never flip `ARCHIVE_RUNS_ENABLED` to look at it |
| S-5 | Requirement updates in the same PR: §7.6 key names (`totalRows`, `options[].eligibleRows`) and the as-built deviations (Last run colours, Q-2; cards stay full width, §11); §6.2 C-2 and C-12 note `badge` and `neutral` built in L-3; §1 row 8 path "full cycle" |
| S-6 | Found on the way, recorded in §9 for the user (owner: user, copy; no change here): after a rejected run POST the page says "The run could not be started / continued.", but the request may have reached the server before the connection failed. The page re-reads the overview straight after, so the history shows the truth; the sentence alone can be wrong |
| S-7 | `id="run-history"` goes on the existing run-history `<section>` without adding an accessible name (no new landmark region, A-9); `id="sources"` on a plain `<div>`. Tiles are anchor links (K-6), never buttons, so `getByRole('button', { name: 'Archive' })` keeps its single match |
| S-8 | The run notice's error tone moves to the §5.10 red; its success tone keeps emerald (a page file, outside S-7). No `role` or text change, so G-6 to G-8 stay green |

**Notes (no action):**

| # | Note |
|---|---|
| N-1 | The page has no logger and the guard's allow-list does not admit `@/lib/logger/client`. It has no `console.*`, so it is compliant; adding client logging would widen the guard and is not a layout item |
| N-2 | The `'./format'` positive assertion in `source.guard` stays after `format.ts` is deleted: `isAllowedImport` resolves paths and never checks existence |
| N-3 | Archiving and Jobs / Audit trail now differ on a failed refresh by design (§5.5); the reason is recorded in "Checks asked for by TL" above |

### Verdict

**APPROVED WITH CONDITIONS.** Dev applies M-1 to M-5 to this workplan, then codes; S-1 to S-8 are checked at SA code review. Full cycle (R-7) under the user's fast-track: SA code review → QA → RM commits and opens the PR. No product question for the user.

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11.** Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l3`, uncommitted, diffed against `daa1d814` (= HEAD).
**Status:** CODE APPROVED. No must-fix. Code approved for QA: **Yes**.

**Diff shape (V-8 re-checked first):** 11 tracked files, 681 insertions, 223 deletions; the only deletion is `app/admin/archiving/format.ts` (−15, planned); no file emptied. Untracked: `app/admin/archiving/components/ArchivingKpis.tsx` (139 lines) and this workplan. No file under `app/api/`, `lib/`, `supabase/` or `components/ui/` touched.

**Spot-run:** `npx jest app/admin/archiving app/admin/components/layout --ci`: 18 suites, 526 tests, all passed. Extra consumer run `npx jest app/admin/__tests__ app/admin/audit-trail app/admin/analytics --ci`: 34 suites, 699 tests, all passed.

### Conditions verified

| Item | Result | Where |
|---|---|---|
| M-1 tile ids | Tiles use `kpi-rows-now`, `kpi-eligible-now`, `kpi-archived-total`, `kpi-last-run`; card ids stay once each, pinned ("SA M-1" case) | `ArchivingKpis.tsx:120-135` |
| M-2 load shape | Only `fetch('/api/admin/archiving')` (one argument) in the inner `try`; its `catch` sets `ADMIN_NETWORK_ERROR` and `setOverview(null)`; not-ok branch sets `result.message` and `setOverview(null)`; `setLoading(false)` in `finally`; no `err.message`, no `.json(` in the folder | `page.tsx:195-223` |
| M-3 count line | Reads `RUN_HISTORY_LIMIT`, singular for one; T-7 builds the fixture from the constant | `page.tsx:171-174` |
| M-4 typing | `TONES` typed `Record<IconTone, { icon: LucideIcon }> & { neutral: { icon: null } }`: dropping an icon from any other tone is a type error (Dev also proved it, V-4). Render guarded `{Icon && …}`. "Amended by L-3" notes in all three headers | `StatusChip.tsx:24-49`, `:68`; `AdminPageHeader.tsx:11-15`; `layoutFolder.guard.test.ts:46-48` |
| M-5 `source.guard` | Exactly the one alias line plus the three assertions in the existing negative-control test; nothing else | `source.guard.test.ts:58`, `:110-112` |
| S-1 retention | `Partial<Record<ArchiveSourceKey, RetentionDays>>`, read through `retentionFor` (`?? DEFAULT_RETENTION_DAYS`); setter keeps `isRetentionDays`; lifted to page state, no refetch (P-3 and the 180 / 90 case pin one fetch); survives a failed refresh (pinned) | `ArchivingKpis.tsx:35-39`; `page.tsx:193`, `:262-264`, `:421-424` |
| S-2 Eligible sub-line | One source: "At {N} days, before {cutoff}"; otherwise none; missing option: "—" / "Not available" (pinned) | `ArchivingKpis.tsx:83-98` |
| S-3 mutations | (h), (i), (j) recorded red in Implementation Notes, plus (k) | — |
| S-4 browser checks | Left to QA (light-scheme select, tiles, chips; never flip `ARCHIVE_RUNS_ENABLED`) | — |
| S-5 requirement | §1 row 8, §6.2 C-2 / C-12, §7.6 keys and as-built deviation, §9 F-62 / F-64 / F-88 done, F-101 / F-102, Change History | requirement diff |
| S-6 | Recorded as §9 F-101, owner user | — |
| S-7 anchors | `id="run-history"` on the existing section with no accessible name; `id="sources"` on a plain `div`; tiles are `<a>`; single Archive button pinned | `page.tsx:301`, `:319-323` |
| S-8 notice tone | Error red (`border-red-500/40 bg-red-500/10 text-red-200`), success emerald; role and text unchanged | `page.tsx:281-293` |

### Other checks asked for by TL

| Check | Result |
|---|---|
| `neutral` tone typing | As M-4 above; T-1 pins no svg, slate classes, no green |
| Header without a badge | DOM identical: the h1 is still a direct child of the first `div`; the wrapper row exists only when `badge` is set. T-2 pins it (`children` length 3); Health, Jobs, Audit trail and AI cost & usage suites green |
| Failed refresh clears | Both failure branches clear `overview`; the strip, card and "As of" disappear (pinned by T-9) |
| Dialog | `ADMIN_DIALOG_CLASS` + title / description constants; `DARK_DIALOG` and the `!` copy gone; Cancel and Archive on `ADMIN_BUTTON`; Confirm keeps sky and gains the purple ring; note slate-400; T-10 pins the class and the close X as a direct child |
| Badge nesting (F-62) | `ui/badge` gone from the folder; chips are spans; the Last run cell is span-in-dd; T-8 pins no `span div` page-wide |
| Run POST copy | `RUN_MESSAGES`, `RUN_FAILED` and `runMessage` unchanged; only `.json().catch` became `readJsonBody`; one POST, `RUNS_ROUTE` unchanged; T-11 pins the rejected-POST sentence |
| Deviations 1–5 | All accepted. #1 (`runStatus` in the KPI file) avoids an import cycle. #2 (notice and error outside the `aria-busy` wrapper) is right: `sendRun` re-reads straight after setting the notice, and a busy ancestor would hold back the alert; Jobs does the same. #3 radius matches §5.7. #4 / F-102 correctly recorded, not fixed here. #5 extra cases welcome |
| API / data | None |
| Accessibility | One h1; tiles named per K-7 (`label, value, status`) with the sub-line as description; table `aria-label`; numeric headers and cells right-aligned and tabular; Refresh named and `aria-busy`; chips carry words and icon except the neutral badge (words only, ruled Q-4); `sr-only` Actions header kept |
| `console.*`, `any` | None in the touched source files (the page has no logger, N-1) |
| Line endings | Index LF for every file; working copies kept per file (archiving CRLF incl. the new file, shared folder and docs LF). No backslash in either MD |

### Code Review Comments

None at High or Medium.

1. `page.render.test.tsx` — deviation 2 (notice outside `archiving-content`) is not pinned; a later edit could move the notice inside the busy wrapper and nothing would fail. Optional one-line assertion in T-11 (the content wrapper does not contain the notice). — Priority: Low (not a commit blocker)

### Optimisation Suggestions

- `ArchivingKpis.tsx:92`: after the early return on a missing option, the `option ? … : 0` in the reduce cannot be reached; a type-guarded `filter` would drop it. Style only.
- On Try again after a failure, the placeholders and "Reading the archiving overview…" show together; this matches the first read (K-10) and needs no change.
- Requirement §1 row 8 still says "next SA code review"; RM updates it with the commit and PR.

### Code Approved for QA: Yes

**Verdict: CODE APPROVED, no must-fix.** Proceed to QA (including browser checks L-B1 to L-B8 and S-4), then RM under the fast-track.

## QA Testing Report

## QA Report — 2026-10-11

**QA — 2026-10-11** (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l3`, uncommitted, HEAD `daa1d814`)
**Test mode:** full
**Strategy used:** A (Jest unit / jsdom render, existing suites plus throwaway probes) and D (browser checklist for TL; jsdom cannot compute styles or real focus loss on disabled buttons)
**Focus:** ui, schema of the shared exports, accessibility
**Skipped:** live browser run (left to TL, list below); `ARCHIVE_RUNS_ENABLED` never flipped
**Input source:** prompt keywords from TL, plus the workplan's V-checks and L-B1 to L-B8 / S-4

### Commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/archiving app/admin/components/layout app/admin/__tests__ app/admin/audit-trail app/admin/analytics app/admin/components/__tests__ app/api/admin/archiving app/api/admin/__tests__/adminGate.writes.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **61 suites, 1,807 tests, all passed** (71.6 s; one "worker failed to exit gracefully" warning, no failure) |
| 2 | `npm run test:bos-entitlements` | **233 suites, 6,382 tests, all passed**, exit 0 (same worker warning) |
| 3 | Scoped `tsc` (QA's own scratch tsconfig in the session scratchpad `qa-l3/`, `extends` the worktree tsconfig, `incremental: false`; archiving folder, shared layout folder and tests, `lib/archiving/config.ts` + `types.ts`, `components/ui/dialog.tsx` + `select.tsx`, analytics, audit-trail page, HealthGrid, JobsQueuesView, jobs-queues page; 68 `app/admin` files in the program) | **Run 1** with a scratch canary file (a plain `const canary: number = 'x'` and an alias-resolved `lastRunTile([]).value` assigned to `number`): exactly those two TS2322 errors, exit 2, proving the checker runs and `@/` resolves. **Run 2** (canary replaced by a valid line): **0 errors, exit 0** |
| 4 | `npx eslint` on the archiving folder and the five touched shared files / tests | exit 0, no output |
| 5 | grep of archiving source for `.json(`, `DARK_DIALOG`, `text-slate-500`, `err.message`, `console.` | none |
| 6 | Throwaway probe suite (`zz.qaL3.probe.test.tsx` + a copy of the HEAD `AdminPageHeader` for a byte comparison), 47 cases | **47 passed** (2 first-run failures were errors in QA's own probes, corrected: a second source defaulted to 365 days; dom-testing-library maps every `<header>` to banner regardless of a `main` ancestor). Both files deleted; `git status --short` identical to before QA |

### Edge cases probed (throwaway tests, all deleted)

| Probe | Result |
|---|---|
| Success → failed Refresh → Try again, for 7 failures: network reject, 401, 403, 504 non-JSON, 500 with route copy, 200 `success:false`, 200 non-JSON | ✅ Each shows exactly its sentence (network: `ADMIN_NETWORK_ERROR`; 401 / 403: "Your admin session has ended. Sign in again."; unreadable: "Could not read the archiving overview. Try again in a moment."; 500: the route's own "Could not read the archiving overview"). Never "Failed to fetch", a parser message, "Unauthorized" or "Forbidden". Strip, placeholders, card, run history, "As of" and badge all gone; no "0" and no "None yet" on screen. Try again restores everything, the 180-day choice survives (tile and card both 2,222). Exactly 3 GETs, 0 POSTs |
| First read fails | ✅ No strip, no placeholders, no "Reading…" line, no links |
| During a Refresh | ✅ Refresh `aria-busy="true"`, content wrapper `aria-busy="true"`, tiles stay, no placeholders and no second loading line; back to `false` after |
| Retention 180 / 90: strip ↔ card ↔ dialog | ✅ Tile value, tile description ("At 90 days, before 2026-06-28 12:00 UTC"), card count and cutoff, dialog rows and retention all agree; one fetch total |
| Zero sources | ✅ Rows now 0, Eligible now 0 (no description), Archived total 0, Last run "None yet", no card, "No runs yet." (zeros are true here: there is nothing) |
| Several sources (typed cast) | ✅ Sums (12,350 / 107 / 1,120), no Eligible sub-line; a second source missing the selected option gives "—" / "Not available" |
| One source missing the selected option | ✅ Tile "Eligible now, —" described "Not available"; card "Not available"; Confirm disabled |
| Last run tile per status | ✅ failed → `red` "Last run, Failed, needs action"; partial → `amber`; running + stale → `amber` "Stalled"; running → neutral; succeeded → neutral; no runs → neutral "None yet"; description "{UTC} · {N} rows"; the card chip word always matches the tile |
| Run history at `RUN_HISTORY_LIMIT` and at 1 | ✅ "The latest 20 runs, newest first"; "1 run, newest first" |
| Invalid timestamps | ✅ "—" in the table, card, tile sub-line ("— · 4,321 rows"); no raw text anywhere. Header reads "As of —." (see Edge E-4) |
| Run POST outcomes (Continue): success, partial, `runs_not_enabled`, `run_in_progress`, `run_not_continuable`, `archive_batch_failed`, `run_unfinished`, `invalid_body`, unknown code, non-JSON 502, 401, rejected | ✅ Each keeps its sentence; `invalid_body`, unknown, non-JSON, 401 and rejected all read "The run could not be continued."; no notice contains `_`, "Unauthorized" or "Failed to fetch". One POST each, body `{ action: 'continue', runId }`, no dialog, then one re-read |
| Start rejected | ✅ "The run could not be started."; one POST, body `{ action: 'start', source: 'audit_trail', retentionDays: 365 }` |
| Double click on Confirm | ✅ One POST |
| Runs off | ✅ Continue and Confirm disabled; zero POSTs |
| Badge | ✅ Not while loading, not with runs on; with runs off a neutral span "Runs off", no svg |
| Header without badge vs HEAD | ✅ Markup byte-identical to the HEAD `AdminPageHeader` for Health-, Jobs-, Audit-trail- (with actions) and AI-cost-shaped props |
| Focus: Escape, close X, Cancel | ✅ Each closes the dialog and focus returns to Archive; the X is named "Close" and is a direct child of the dialog |
| Focus: Confirm → success → re-read | ✅ Focus returns to Archive |
| Focus: Confirm → success → failed re-read | ⚠️ Card unmounts (clear by design), focus on `body` (E-2) |
| Focus: Continue → run no longer continuable | ⚠️ Continue unmounts, focus on `body` (E-2, existed before L-3) |
| Focus: Try again | ⚠️ Error box unmounts, focus on `body` (E-1, shared, every migrated page) |

### Accessibility (jsdom, page rendered inside `<main>` as in the shell)

| Check | Result |
|---|---|
| One h1 "Archiving" | ✅ |
| Tiles | ✅ Four `<a>` links, hrefs `#sources`, `#sources`, `#run-history`, `#run-history`, both targets exist; names "Rows now, 12,345", "Eligible now, 1,111", "Archived total, 0", "Last run, Failed, needs action"; sub-lines are descriptions |
| Table | ✅ `aria-label="Run history"`, 10 column headers, all `scope="col"` (Actions `sr-only`) |
| Chips | ✅ Run chips (table and card) carry words + one svg; the neutral badge carries words only |
| Dialog | ✅ Name "Archive old records?", description the source sentence |
| Refresh | ✅ Name "Refresh the archiving overview", visible text "Refresh", `aria-busy` false at rest, true while reading |
| Landmarks | ✅ No region, navigation, complementary, contentinfo or form; both `<header>` elements sit inside `main` / `section`, so neither is a banner (the old page had the same two headers); F-62 holds page-wide (no `span div` / `span p`); combobox named "Keep records live for" |

### Test Coverage

| Acceptance criterion (workplan §2.1, §2.2, §2.7) | Tested? | Result | Notes |
|---|---|---|---|
| Header: title, purpose, "As of", neutral "Runs off" badge only when off | ✅ | Pass | T-3 + probes; no-badge DOM byte-identical |
| 4-tile strip, values, anchors, K-7 names, K-10 | ✅ | Pass | T-4 to T-6 + probes |
| Last run red / amber only | ✅ | Pass | Every status probed |
| Eligible follows the select, sub-line only with one source, missing option | ✅ | Pass | Probes incl. dialog agreement |
| Refresh-only bar, `aria-busy`, content stays on refresh | ✅ | Pass | |
| Shared states; failed refresh clears; retry restores; retention survives | ✅ | Pass | 7 failure shapes |
| Standard table, count line, chips, `scope=col` | ✅ | Pass | Limit and singular |
| Dialog on `ADMIN_DIALOG_CLASS`, Escape / X / Cancel focus return | ✅ (jsdom) | Pass | Computed close-X colour is a browser check |
| Run POST copy kept, never raw codes, exactly one POST, Continue without confirm | ✅ | Pass | 12 outcomes + start |
| No API / data change | ✅ | Pass | Diff touches no route, lib, migration |
| Entitlements | ✅ | Pass | No import; suite green anyway |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues

None. One GET on load, one per Refresh / Try again, one POST plus one GET per run action; no request on select change or dialog open.

#### Edge Cases (nice to fix, none blocking)

1. **E-1 — Try again drops focus to `body`.** Low. The shared `AdminError` unmounts with its button; identical on Health, Jobs, Audit trail and AI cost & usage, so a cross-page item for the shared folder, not L-3.
2. **E-2 — Continue (and Confirm followed by a failed re-read) can leave focus on `body`.** Low. Continue unmounts once the run is no longer continuable; this existed before L-3. Analytics fixed the same pattern with a focusable content wrapper (QA-B1); a candidate follow-up for Archiving.
3. **E-3 — Deviation 2 is not pinned** (SA code review comment 1): nothing fails if the run notice moves inside the `aria-busy` wrapper. Low.
4. **E-4 — An invalid `generatedAt` reads "As of —."** Low and theoretical (the route sets it from the server clock); every other invalid time correctly reads "—".

### Browser checks for TL (signed-in admin, DevTools Network open; light **and** dark OS-scheme emulation; never click Confirm or Continue unless you intend to archive; never flip `ARCHIVE_RUNS_ENABLED`)

| # | Check |
|---|---|
| B-1 (L-B1) | One `GET /api/admin/archiving` on load; header "Archiving", purpose, "As of … UTC."; no shell title; no "Runs off" chip (runs are on) |
| B-2 (L-B2) | Four tiles; Rows now and Archived total equal the card; each tile jumps to its anchor; Tab order header → tiles → Refresh → card |
| B-3 (L-B3) | Retention 180 then 90: Eligible now tile (value and sub-line) and card change together; no new request |
| B-4 (L-B4) | Refresh: spinner, `aria-busy`, card stays, exactly one new GET, "As of" updates. Note where keyboard focus lands after Refresh (button is disabled while reading) |
| B-5 (L-B5) | Run history: numbers right-aligned with tabular digits; chips with icons; Error column in mono; count line |
| B-6 (L-B6) | Open Archive in both schemes: dialog dark; in light emulation the close X computed `color` is `rgb(203, 213, 225)` and `opacity` 1; purple focus ring; Escape and X close and return focus to Archive; then Cancel |
| B-7 (S-4) | In light emulation the retention select trigger **and** the open list stay dark; tiles and chips legible |
| B-8 (L-B7) | DevTools offline, Refresh: "Could not reach the server…" with Try again; strip, card and "As of" gone, no zeros; back online, Try again restores them, retention choice kept |
| B-9 (L-B8) | No Confirm / Continue in production unless archiving is intended |
| B-10 | Accessibility tree (DevTools): the page header is not a banner landmark inside `main` |

### Final Status

- [x] All acceptance criteria pass in Jest / jsdom — **PASS WITH NOTES**: no bugs; four Low edge cases (E-1 to E-4), none introduced as a regression by L-3 except the cosmetic E-4; browser checks B-1 to B-10 owed by TL
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Workplan written | Dev: L-3 plan on `feature/admin-layout-l3`; full cycle proposed (header `badge`, chip `neutral`); 8 SA questions; about 2 days |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS: Q-1 to Q-8 ruled (strip built; Last run red / amber only; `badge` as data; `neutral` without icon; run POST keeps its own copy; three negative-control assertions; server "As of"; full cycle); failed refresh keeps clearing; M-1 to M-5 before coding, S-1 to S-8 at code review; no product question |
| 2026-10-11 | Implemented | Dev: M-1 to M-5 applied to this workplan; code complete, uncommitted; V-1 to V-8 green (61 suites / 1,807 tests; canary-proven scoped tsc; 11 mutations each red); deviations and user-visible changes in Implementation Notes; requirement records updated |
| 2026-10-11 | QA | PASS WITH NOTES: 61 suites / 1,807 tests and entitlements 233 / 6,382 green; canary-proven scoped tsc clean; 47 throwaway probes passed (deleted); no bugs, 4 Low edge cases; browser checks B-1 to B-10 for TL |
| 2026-10-11 | Committed + PR | RM fast-track: commit 4bcf33d1, origin/main e3c9789d merged in (no file changes), PR #298; Jest 61 / 1,807, entitlements 233 / 6,382, lint:hooks clean |
