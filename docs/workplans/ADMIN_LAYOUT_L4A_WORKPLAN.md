# Workplan: Admin Layout Standard — Slice L-4a (Businesses, list) + the shared filter-bar alignment fix

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (rows 9 and 9a), §3, §4.7, §5.3, §5.4 (K-1 to K-10), §5.5, §5.6 (U-1 to U-4, D-6), §5.7, §5.10, §5.11, §5.12, §6.1, §6.2 C-2, C-3, C-4, C-6, C-7, C-8, C-10, C-11, C-13, C-14, §7.7, §9 F-2, F-18 to F-27, F-88, §10 D-6 (a), D-8 (a), D-11 (a); SA rulings Q-16 and re-check R-6, R-7, R-8. Folded-in shared fix: user request 2026-10-11 (Audit trail filter-bar alignment), approved direction recorded in §2.2
**Branch:** `feature/admin-layout-l4`, cut from `feature/admin-layout-l3` (PR #298, since merged to main as `c5edc866`) and merged with `origin/main` (`c5edc866`, no file changes). The L-4a PR #300 targets `main` and holds only the L-4a commit. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Committed — PR #300 open (2026-10-11, commit 38c35a37; fast-track after SA code review approved and QA PASS WITH NOTES); awaiting checks + user merge. Workplan SA-reviewed — APPROVED WITH CONDITIONS (M-1 to M-5 applied before coding, S-1 to S-9 checked at code review). F-18 answered by the user (D-16: reload)
**Path:** **Full cycle by classification** (R-7): the folded-in fix changes three shared exports (`AdminFilterBar` gains a `help` line, the bar and `DatePresets` gain a label spacer that pages may use, and `AdminBusinessPicker`'s `hint` prop is replaced by `describedBy`). Run as SA workplan review → Dev → SA code review → QA → RM under the user's fast-track (RM commits and opens the PR after SA and QA, without a user diff review)

## Overview

L-4 moves `/admin/users` ("Businesses", 1,251-line `page.tsx`) onto the standard. It is split, as §7.7 allows. **L-4a** (this workplan) does the list: `AdminPageHeader`, a three-tile KPI strip from the stats the list route already returns, the filter bar with Search (held by the page, never in the URL) and Status (in the URL), the shared loading / error / empty states with no full-page spinner, `readAdminResponse` for the list read, the table on the standard classes, the dead "Advanced Filters" panel removed (D-11 (a)), and the four Businesses dialogs on `ADMIN_DIALOG_CLASS` (D-8 (a)). The row detail stays an inline expanded row in L-4a, unchanged, so every `source.guard` position check holds. **L-4b** (outline in §13) moves that detail into one page-level `AdminDrawer`.

Folded in at the user's request: every field in the shared filter bar sits on one label row (top-aligned), the Window presets get a visible "Window" label, and the business picker's two-line standing note moves out of the field column into one short help line under the whole bar, still linked to the picker input. Audit trail and AI cost & usage both benefit.

No route, payload, write, money or permission change. The credit, top-up, cleanup and delete flows behave exactly as before; only their dialogs' classes change.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-8d09d42d)
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
- [13. L-4b outline (row detail into the drawer)](#13-l-4b-outline-row-detail-into-the-drawer)

---

## 1. Analysis Summary (code verified at `8d09d42d`)

### 1.1 The page today

| Lines (`app/admin/users/page.tsx`) | What | Standard item |
|---|---|---|
| `:3-31` | Imports: `Eye`, `X`, `Lock` unused (F-21); `Filter` and `motion` used only by the dead panel and the detail | F-21 |
| `:135-155` | State: list, `stats`, `searchInfo`, `loading`, `error`, `expandedUserId`, the per-row detail maps, `filter` (default `'active'`), `searchTerm`, `showAdvancedFilters`, `auditFilters` | — |
| `:157-169` | Effect on `[filter]` fetches; a 300 ms debounce on `[searchTerm]` fetches **only when non-empty**, so emptying the box never re-reads (F-18) | §5.5 Clear, F-18 |
| `:171-234` | `fetchUsers`: `response.json()` directly, error message from `errorData.error`, else `response.statusText`, else a `SyntaxError` text reaches the page (F-20); on failure clears list, stats and search info | §5.10, C-4 |
| `:236-253` | Client-side filter of the returned rows by the search text, newest joined first | Kept |
| `:255-286` | `formatCost` (4 decimals, F-25), `formatNumber`, `formatDate` (relative "3h ago" alone, then local date), `isActiveUser` | §5.11 |
| `:288-368` | `handleViewUserDetails`: toggles the row, three parallel detail reads with `.json()`, caching rules (QA-P8 / O-3) | **L-4b** |
| `:433-462` | Light `ErrorDisplay` (`bg-red-50`, F-20) and an **early-return full-page spinner** on every read, which unmounts the search box while typing (F-19) | §5.10 |
| `:468-504` | Own `<header>` with h1, the `list-scope-note` purpose, a blue count pill and a **green** "active" pill (T-6), a "Filters" toggle, an icon-only Refresh with no name (F-22) | §5.3, F-22 |
| `:506-536` | Three plain tiles (not links): the filtered count, Active Users (30 days), New Today | §5.4, §7.7 |
| `:538-641` | Search box (no label) + status select (no label) + the **dead Advanced Filters panel**: 4 uncontrolled selects and an "Apply Filters" stub (F-2) | §5.5, D-11 (a) |
| `:643-653` | Capped / failed business-name search notices (amber text) | §5.10 Partial |
| `:655-813` | Table: `w-full`, mixed `px-6 py-4` / `px-4 py-4`, `text-slate-500` on information (T-5), 7 columns; first 100 rows; clickable `tr`; Actions = a chevron button with `title` only (A-2) | §5.7, A-2 |
| `:814-1230` | Inline expanded `<tr colSpan=7>`: BusinessOsPanel, user cards, login activity, plugins, AI spend, per-user audit, danger area (AD-1 gate + `TestAccountCleanupPanel`) | **L-4b** |
| `:1239-1245` | "Showing first 100 of N users" footer, only above 100 | §5.7 Count line |

### 1.2 The list payload (route unchanged)

`GET /api/admin/users?status=…&search=…` answers `{ success, data: User[], stats: { totalUsers, activeUsers, newUsersToday }, search?: { businessSearch, businessMatchesCapped, businessMatchLimit } }`. `stats.totalUsers` is the **filtered** count (`app/api/admin/users/route.ts:236`), which is why the existing labels say "shown" (`userName.ts` `countLabels`, SA C-15 (a)). Because the payload is not only under `data`, the read uses the `pick` option of `readAdminResponse` (built in L-1c for the audit route).

### 1.3 The Businesses dialogs

Four, not two: §4.1 counted six `DARK_DIALOG` copies across admin before the credits boost slices added two more on this page.

| File | Constant | Opened from |
|---|---|---|
| `components/CreditFormDialog.tsx:53`, `:247` | `DARK_DIALOG` | `CreditsBlock` (grant, take back) |
| `components/DeleteBusinessDialog.tsx:78`, `:662` | `DARK_DIALOG` + `sm:!max-w-2xl` | The danger area, hidden by `SHOW_AD1_DELETE_ENTRY = false` |
| `components/BoostCapDialog.tsx:29`, `:165` | `DARK_DIALOG` | `BoostBlock` (credits boost 6b) |
| `components/BoostReconcileDialog.tsx:21`, `:76` | `DARK_DIALOG` | `BoostBlock` (credits boost 6b) |

None contains "flex" in its class (the `adminDialog.ts` M-2 trap), and no test reads their classes.

### 1.4 The shared filter bar today (the user's alignment report)

| File | Fact |
|---|---|
| `AdminFilterBar.tsx:173` | Controls row is `flex flex-wrap items-end gap-3`: every item is bottom-aligned |
| `DatePresets.tsx:131` | The Window group has `aria-label="Window"` and **no visible label**, so its top sits a label-row lower than the labelled fields |
| `DatePresets.tsx:128-134` | The preset buttons are `py-1 text-xs` inside a `p-0.5` frame: about 30 px tall against about 34 px for the inputs and selects |
| `AdminBusinessPicker.tsx:355-359` | The optional `hint` renders as a `<p>` **inside the field column**, linked by `aria-describedby` (`:261`) |
| `audit-trail/page.tsx:906-914` | Audit trail passes a two-sentence hint (115 characters) and wraps the picker in `sm:w-72`, so that column is three lines taller than the others and, bottom-aligned, pushes its input up |
| `audit-trail/page.tsx:1006-1018` | A label-less one-click button ("BOS AI failures") sits among the labelled page fields |
| `analytics/components/AnalyticsFilterBar.tsx:164-168` | AI cost & usage passes no hint; all its page fields are labelled ("Scope", "Group by") |

### 1.5 Tests that pin the page

| Test | What it pins | L-4a effect |
|---|---|---|
| `users/__tests__/defaultFilter.render` | First request `status=active`; first combobox is the status select with value `active`; `count-card-label` and `count-pill` texts; search text never logged; "Search all users" (U-4); "No users found"; seven header texts exactly; empty cell `colspan=7`; no admin marker on a row | Two cases edited (§6.2); the rest stay green |
| `users/__tests__/businessOsPanel.render` (page cases) | Row click opens the detail (P-1 to QA-P8); h1 "Businesses"; P-4 reads `list-scope-note` and `count-pill`; capped notice; the error text | P-4 edited (§6.2); the rest stay green |
| `users/__tests__/source.guard` | `SCREEN_FILES` rules; `{isExpanded && (` → `danger-area` → `DeleteBusinessDialog` → `TestAccountCleanupPanel` positions in `page.tsx`; `SHOW_AD1_DELETE_ENTRY = false`; `onRemoved={() => { void fetchUsers(); }}` and `onDeleted` with the same body | All position checks hold **with no edit**: the detail block is not touched. Additive edits only (§5) |
| `lib/business-os/credits/__tests__/creditBands.guard` | Scans every non-test file under `app/admin/users/` for a comparison against 10, 20, 30, 60 or 0.1 to 0.6, and for a `LOW_THRESHOLD` / `LOW_LINE…` definition | New files must comply (no such comparison is planned) |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard` | Walks all product files for configured credit figures in copy | No figure in new copy; run in V-1 |
| `app/admin/components/layout/__tests__/layoutFolder.guard` | Shared-folder rules S-1 to S-10, L-1e F-1 (only the picker fetches); the migrated-pages registry | No new shared file; Businesses joins the registry in **L-4b** (§5, SA Q-8) |

### 1.6 Inbound links

Every link to `/admin/users` carries no parameter: the sidebar (`AdminSidebar.tsx:137`), Plans & entitlements (`AccountLookup.tsx:97`), the platform dashboard (`platform-dashboard/page.tsx:242`, `:521`). Health, Audit trail and AI cost & usage do not link here. Nothing to alias.

---

## 2. Scope and decisions

### 2.1 In L-4a

| # | Item | Standard / ruling |
|---|---|---|
| 1 | `AdminPageHeader`: h1 "Businesses", purpose = the existing scope sentence. The two header pills go (decorative, and the green one breaks T-6); the "Filters" toggle goes with the panel | §5.3, T-6, D-11 (a) |
| 2 | KPI strip, three tiles, from `stats` (§2.3) | §5.4, §7.7, K-9 |
| 3 | Filter bar: Search (label "Search", debounced, page state, never in the URL) + Status (label "Status", native select, options unchanged) + Clear + Read at + Refresh "Refresh the business list" | §5.5, D-6 (a), F-22 |
| 4 | URL: `status` only, through `useAdminFilters`; default `active` omitted (U-3); an invalid value is ignored (U-4) | §5.6, §7.7 |
| 5 | **The dead Advanced Filters panel is deleted** (4 uncontrolled selects, Cancel, the "Apply Filters" stub) | D-11 (a), F-2 |
| 6 | States: no early return; header, tiles and bar stay mounted; first read shows `AdminLoading`; later reads keep the table with `aria-busy` and spin Refresh; errors use the dark `AdminError` with "Try again"; the list read goes through `readAdminResponse` (route copy, else fixed copy, never a parser message or `statusText`) | §5.10, F-19, F-20 |
| 7 | Newest read wins for **every piece of read state** (SA M-5): rows, busy / loading, `error`, `stats`, `searchInfo` and `readAt` are set only by the newest read (a read sequence number). An older read that fails after a newer one started shows no error and clears nothing | §5.10 (loading state must be truthful once the bar stays mounted) |
| 8 | Table on `adminTable.ts` classes: one density, `scope="col"`, header texts unchanged (the seven-column pin), short id via `formatShortId` with the full id in `title`, `text-slate-500` information lifted to `text-slate-400` | §5.7, T-5 |
| 9 | The Actions chevron gets an accessible name ("Show details for {name}" / "Hide details for {name}") and `aria-expanded`; the row stays clickable | A-2, §5.8 D-2 (the drawer itself is L-4b) |
| 10 | Last Sign In and Joined: absolute `formatUtc` ("YYYY-MM-DD HH:mm UTC") with the relative age as a second, smaller line; "Never" kept. `formatDate` stays **byte-identical** (the detail block uses it); the age line comes from a new list-only helper that always returns a relative age ("Just now", "Nh ago", "Nd ago"), never a locale date, and never compares against 10, 20, 30 or 60 (SA M-3) | §5.11 (SA Q-9, M-3) |
| 11 | Capped / failed business-search notices → `AdminNotice` (same words, same test ids) | §5.10 Partial |
| 12 | Count line above the table (`ADMIN_COUNT_LINE`): "N users" or "Showing the first 100 of N users, newest first. Narrow the list with the search or the status." The footer goes | §5.7 Count line; F-27 stays open (100 cap kept) |
| 13 | Empty state stays **inside the table** (one `td colSpan={7}`, standard empty classes), words unchanged, "Search all users" kept (U-4) | §5.10 Empty; keeps the `colspan=7` pin |
| 14 | The four dialogs adopt `ADMIN_DIALOG_CLASS` and the title / description constants (§1.3) | D-8 (a), F-88 (SA Q-3 for the two boost dialogs) |
| 15 | Unused imports removed (F-21, incidental) | F-21 |
| 16 | **Folded-in shared fix**, §2.2 | User request 2026-10-11 |

### 2.2 Decision: the shared alignment fix (user-approved direction)

| Part | Change |
|---|---|
| One label row | `AdminFilterBar`'s controls row becomes `flex flex-wrap items-start gap-3`. Every field is "label row, then control". Items with no label of their own (Clear; the Read at + Refresh group) render a **label spacer** above them: an `aria-hidden`, `invisible` element carrying `ADMIN_FIELD_LABEL` and one non-breaking space, so its height is exactly a label's whatever the font metrics. The no-controls branch (Health, Jobs, Archiving) is **not touched**: same plain `div`, same DOM |
| Window label | `DatePresets` wraps the group in a field column with a visible `<span id={labelId} className={ADMIN_FIELD_LABEL}>Window</span>`; the group switches from `aria-label="Window"` to `aria-labelledby={labelId}`, so its accessible name is still exactly "Window" (every `getByRole('group', { name: 'Window' })` holds). The Custom row's Apply gets the spacer; the preset buttons go from `py-1` to `py-1.5` so the group is as tall as the inputs (SA Q-6) |
| Help line | `AdminFilterBar` gains `help?: { id: string; text: string; testId?: string }`, rendered as the **last line inside the bar** (`text-xs text-slate-400`, after the chips row). `AdminBusinessPicker`'s `hint?: string` is **replaced** by `describedBy?: string` (an id the page owns): the picker renders no note of its own and puts that id on the input's `aria-describedby`. Audit trail is the only page that passed a hint; it now owns one `useId()` and passes it to both |
| Spacer for pages | The spacer is exported as `AdminFieldSpacer` from `DatePresets.tsx` and re-exported by `AdminFilterBar.tsx` (where `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL` already come from), for a page field with no label: Audit trail's "BOS AI failures" button is wrapped with it |
| Help wording (Audit trail) | "Only accounts with a business profile can be found by name. Paste a full account id for any other account." (98 characters, down from 115; both phrases the audit test reads are kept, so its text assertions need no edit) |
| Requirement text | §5.5 Layout is amended at implementation: `items-start`; "every field is a label row then a control; a control with no label takes the spacer"; part 1 "with a visible Window label"; and a new rule "a standing note about one control is one help line under the bar, linked by `aria-describedby`, never inside the field column". §6.2 C-6 and C-8 notes record the API change |

Why `items-start` plus a spacer rather than `items-end` with equal heights, or `self-end` on the label-less items: a field column can grow below its control (the Custom row's "start after end" alert; any future note), and with `items-end` or `self-end` that pushes the other controls or the buttons down. A spacer pins every control to the same row whatever grows underneath (SA Q-4).

### 2.3 Decision: the KPI strip (§7.7, K-1 to K-10)

| Tile | Value | Mode | Sub-line | Colour |
|---|---|---|---|---|
| `countLabels(status).card` ("Users shown (active)" / "Users shown (inactive)" / "All users") | `formatCount(stats.totalUsers)` | Same-page filter tile → `status=all` (href `/admin/users?status=all`), `current` when status is `all` | — | Neutral |
| "Active users" | `formatCount(stats.activeUsers)` | Same-page filter tile → `status=active` (href `/admin/users`), `current` when status is `active` (the default, so it carries the purple ring on load) | "Last 30 days" | Neutral |
| "New today" | `formatCount(stats.newUsersToday)` | No target: `div role="group"` (there is no working "joined" filter; F-2) | — | Neutral |

`KpiStrip placeholderCount={3}` while the first read is in flight; hidden on error (K-10). Labels keep the existing words (`countLabels`, SA C-15 (a)), not §7.7's "Logins shown" (SA Q-10). Under the default Active filter tiles 1 and 2 show the same number (F-26, kept, D-11 (a)).

### 2.4 Decision: the search, Clear and F-18

- The search text lives in `useState` on the page, as today, and is never written to the URL or read from it (D-6 (a)). The status filter lives in `useAdminFilters` with a module-level spec in a new `usersFilters.ts`.
- **Clear** (§5.5 part 5) must put the view back to the defaults: status `active` and an empty search, with the list re-read. Clear is disabled when status is `active` and the search box is empty.
- Today an emptied search box never re-reads (F-18), so the list keeps showing the previous search's results under an empty box. **Decided by the user (D-16, "Yes, reload"); mechanism per SA M-1:** one rule. The debounce reads when, and only when, the current search text differs from the text of the last read **started**. A ref (`lastSearched`) is set inside `fetchUsers` at the start of every read, whoever started it (mount, status change, Refresh, Try again, a tile, the debounce). This covers "emptied after a search", skips the mount (the first read already sent `''`), and skips the double read when the status changes inside the 300 ms window.
- Clear sets the status default and an empty search together and produces **exactly one** request: the status effect when the status changed, else the debounce.

### 2.5 Decision: the open row across list reads (forced by F-19)

Today every list read unmounts the whole page behind the spinner, so an open row's detail is torn down and rebuilt: its own reads (the Business OS panel's two, the credits and top-ups blocks, the cleanup panel's probe) run again, and any half-typed input inside it is lost. Once the page stays mounted (F-19), the open detail **stays mounted** across a list read: fewer requests, nothing lost. It still disappears when its row leaves the list (a search, a status change, a removed account) or when the read fails and the list is cleared, as today. Recorded as a named forced change (SA Q-2). The cleanup panel's "report waits until Done, or unmount" rule is unaffected: Done still calls `fetchUsers`, the account leaves the list, the row unmounts.

### 2.6 Decision: copy and behaviour that stay verbatim

- The purpose sentence, every column header, "No users found", "Try adjusting your search or filter criteria", "No match among {status} users", "Search all users", both search notices, the status options' words, the placeholder "Search users by name, email, company..."
- `createLogger({ module: 'AdminUsersPage' })` and every `logger.debug` context (the "never logs the search text / raw body" tests read them). No `clientLogger` on this page, so no RC-1 logger mock is needed.
- `formatCost`, `getFilteredAuditLogs`, `handleViewUserDetails` and everything in the expanded detail (L-4b).
- `CreditsLeftCell` and `UserNameLine` are not edited (their Active badge colour is a pinned user decision, U-7). "Credits left" stays left-aligned: the cell mixes a band dot, a percent, a "trial" chip and words.
- `sessionEndedCopy: true` on the list read, as on AI cost & usage (L-2a): a 401 or 403 reads "Your admin session has ended. Sign in again." (SA Q-13).

### 2.7 Visible changes on `/admin/users` (named in the PR)

New header (no pills, no Filters button); three tiles, two of them links that set the status; the filter bar with labels, Clear, Read at and a named Refresh; no Advanced Filters panel; no full-page spinner and no white error box; a count line above the table; the standard table density; UTC times with the age underneath; named row toggles; the credit, delete and top-up dialogs with a visible close X in a light OS scheme; emptying the search box reloads the list (D-16); an open row stays open across a list read, so Refresh no longer re-reads an open detail (collapse and reopen does; SA N-1). On Audit trail and AI cost & usage: fields aligned on one label row, a visible "Window" label, and (Audit trail) the business note as one line under the bar.

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

| File | Change |
|---|---|
| `DatePresets.tsx` | Export `AdminFieldSpacer()` (`<span aria-hidden="true" className={ADMIN_FIELD_LABEL + ' invisible select-none'}>` with one `&nbsp;`). Root `items-end` → `items-start`. The group goes into a column with the visible "Window" label (`useId`), `aria-labelledby`. Preset buttons `py-1` → `py-1.5`. The Custom row `items-end` → `items-start`; Apply in a column under `AdminFieldSpacer`. The alert line keeps `w-full` |
| `AdminFilterBar.tsx` | Re-export `AdminFieldSpacer`. Controls row `items-end` → `items-start`. Clear and the Read at + Refresh group each sit in a column under `AdminFieldSpacer`. New `help` prop: `<p id={help.id} data-testid={help.testId} className="text-xs text-slate-400">` as the bar's last line. The no-controls branch keeps its DOM. **Only Refresh** converges on `ADMIN_BUTTON`, composed with its own layout classes (`flex items-center gap-2 transition-colors` plus `ADMIN_BUTTON`), in both bar branches; Clear's class string stays byte-identical (SA Q-7 narrowed, M-2) |
| `adminTable.ts` | Doc comment of `ADMIN_BUTTON` updated: the bar's Refresh now uses it; AdminStates' Try again still pending; Clear deliberately keeps its own quieter style (SA M-2). No value change |
| `AdminBusinessPicker.tsx` | `hint?: string` → `describedBy?: string`; delete the hint `<p>` and `hintId`; `aria-describedby={describedBy}`. Header comment and the `id` prop comment updated |

No new file, no new import from outside the folder, no green, no fetch (S-3, S-7, L-1e F-1 unchanged).

### 3.2 Audit trail (recorded cross-folder edit, user request 2026-10-11)

`audit-trail/page.tsx`: `const businessHelpId = useId();`; the picker gets `describedBy={businessHelpId}` and loses `hint`; its wrapper comment is shortened (the width is kept so the column does not stretch); the bar gets `help={{ id: businessHelpId, text: BUSINESS_HELP, testId: 'business-picker-hint' }}` (the existing test id moves to the help line); the "BOS AI failures" button is wrapped in a column under `AdminFieldSpacer`. Nothing else on the page changes. AI cost & usage needs no code change.

### 3.3 Businesses page folder (`app/admin/users/`)

| File | Change |
|---|---|
| `usersFilters.ts` (new, pure, no imports but the hook's types) | `USERS_FILTER_SPEC = { status: textFilter({ key: 'status', defaultValue: 'active', isValid }) }` where `isValid` accepts the three `StatusFilter` values; `USERS_WHAT = 'the business list'` |
| `components/BusinessesKpis.tsx` (new) | The three tiles of §2.3; props `stats`, `status`, `loading`, `hrefFor`, `apply`. Neutral only |
| `page.tsx` | Imports pruned (F-21); `filter` state → `useAdminFilters(USERS_FILTER_SPEC)` narrowed with `toStatusFilter`; `showAdvancedFilters` and the panel deleted; `readAt` state; `readSeq` and `lastSearched` refs; `fetchUsers` keeps its name, URL, options and debug logs, and reads through `readAdminResponse` with `pick` and `sessionEndedCopy: true`, a rejected fetch showing `ADMIN_NETWORK_ERROR`; failure still clears list, stats and notices; the early returns and `ErrorDisplay` are deleted; render = header → tiles → bar → content area (`ref`, `tabIndex={-1}`, `aria-busy`) holding the error, first-load, notices, count line and table; table classes from `adminTable.ts`; the toggle named with `aria-expanded`; `formatUtc` + relative line; **the expanded-row block from `{isExpanded && (` to its end is not edited** |
| `components/CreditFormDialog.tsx`, `DeleteBusinessDialog.tsx`, `BoostCapDialog.tsx`, `BoostReconcileDialog.tsx` | Delete `DARK_DIALOG`; `className={ADMIN_DIALOG_CLASS}` (Delete: `` `${ADMIN_DIALOG_CLASS} sm:!max-w-2xl` ``); titles take `ADMIN_DIALOG_TITLE_CLASS`; descriptions take `ADMIN_DIALOG_DESCRIPTION_CLASS`, except `BoostReconcileDialog`'s, which keeps its own `!text-slate-300` (its description is the body text, not a subtitle). Nothing else in these files changes |

**Focus after an action (§5.12 A-3).** The content area is always mounted. At the start of each list read the page records whether focus is inside the content area; if, when the read settles, focus was there and has fallen to `<body>` (the "Try again" button or the cleanup panel's Done went away with the old content), focus moves to the content area. A read started from the bar (Refresh, Clear, Status, a tile) never moves focus.

**creditBands compliance.** No new comparison against 10, 20, 30, 60 or 0.1 to 0.6 in any file under `app/admin/users/` (the 100-row cap stays written as `100`, which the guard's lookahead allows, as today).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/DatePresets.tsx` | modify | Window label, top alignment, spacer export, button height (§2.2) |
| `app/admin/components/layout/AdminFilterBar.tsx` | modify | Top alignment, `help` line, spacer re-export, `ADMIN_BUTTON` |
| `app/admin/components/layout/AdminBusinessPicker.tsx` | modify | `hint` → `describedBy` |
| `app/admin/components/layout/adminTable.ts` | modify | `ADMIN_BUTTON` doc comment only (SA M-2) |
| `app/admin/users/userName.ts` | modify | Dead `countLabels().pill` removed (SA S-1) |
| `app/admin/components/layout/__tests__/DatePresets.render.test.tsx` | modify | New Window-label and spacer cases |
| `app/admin/components/layout/__tests__/AdminFilterBar.render.test.tsx` | modify | New help-line and spacer cases |
| `app/admin/components/layout/__tests__/AdminBusinessPicker.render.test.tsx` | modify | 3 deliberate edits (§6.2) |
| `app/admin/audit-trail/page.tsx` | modify | Help line + `describedBy` + spacer (recorded cross-folder edit) |
| `app/admin/audit-trail/__tests__/businessPicker.render.test.tsx` | modify | Hint test: linkage and placement assertions (§6.2) |
| `app/admin/audit-trail/__tests__/filterDensity.render.test.tsx` | modify | "Window" added to the reachable-by-label list |
| `app/admin/users/usersFilters.ts` | create | Status spec (§3.3) |
| `app/admin/users/components/BusinessesKpis.tsx` | create | KPI tiles (§2.3) |
| `app/admin/users/page.tsx` | modify | §3.3 |
| `app/admin/users/components/CreditFormDialog.tsx` | modify | Dialog class |
| `app/admin/users/components/DeleteBusinessDialog.tsx` | modify | Dialog class |
| `app/admin/users/components/BoostCapDialog.tsx` | modify | Dialog class |
| `app/admin/users/components/BoostReconcileDialog.tsx` | modify | Dialog class |
| `app/admin/users/__tests__/businessesLayout.render.test.tsx` | create | §6.1 |
| `app/admin/users/__tests__/defaultFilter.render.test.tsx` | modify | 2 deliberate edits (§6.2) |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | modify | P-4 edit (§6.2) |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | Additive (§5) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 rows 9 / 9a, §5.5, §6.2 C-6 / C-8 notes, §7.7 as-built, §9, Change History |
| `docs/workplans/ADMIN_LAYOUT_L4A_WORKPLAN.md` | create | This file |

Not touched: `AdminSidebar.tsx`, `app/admin/layout.tsx`, `components/ui/*`, every route, `CreditsBlock`, `BoostBlock`, `BusinessOsPanel`, `CreditsLeftCell`, `UserNameLine`, `TestAccountCleanupPanel`, `lib/**`, the analytics folder, every other admin page.

---

## 5. Guard and registry changes

| Guard | Change | Why |
|---|---|---|
| `users/__tests__/source.guard` | Additive: `SCREEN_FILES` gains `usersFilters.ts` and `components/BusinessesKpis.tsx` (console, business-os import and repository rules then cover them). A new describe "the dialogs use the shared admin class (D-8 (a))": each of the four dialog files imports `ADMIN_DIALOG_CLASS` from the alias, passes it to `DialogContent`, and declares no `DARK_DIALOG`; plus a planted-sample self-test of the matcher. A new case "no dead Advanced Filters panel": `page.tsx` contains none of "Apply Filters", "showAdvancedFilters", "Has Agents", "Auth Provider" | D-8 (a), D-11 (a), keeps new files inside the existing rules |
| `users/__tests__/source.guard` positions | **No edit.** `{isExpanded && (`, `danger-area`, the dialog, the gate, the panel, `key={user.id}`, `onRemoved` / `onDeleted` bodies all stay in `page.tsx` | §7.7 moves them in L-4b |
| `layoutFolder.guard` | **No edit.** No new shared file; the two changed files keep their imports inside the folder; no new fetch, green, history write or landmark. Businesses joins `MIGRATED_PAGES` in **L-4b**, once the three detail reads stop calling `.json(` directly (SA Q-8) | S-1 to S-10 |
| `creditBands.guard`, `creditFigures.fromConfig.guard` | **No edit**; both run in V-1 over the new files | §1.5 |
| Entitlements registration | **No** import from `lib/business-os/entitlements/` is added (no file in this slice imports that module); `npm run test:bos-entitlements` still runs (V-2) | `business-os-entitlements` skill |

---

## 6. Tests

### 6.1 New

**`app/admin/users/__tests__/businessesLayout.render.test.tsx`** (jsdom; `next/navigation` mocked with a settable search string and a `replaceState` spy, as Audit trail's suites do; `@/lib/logger` mocked with `createLogger` only).

| # | Case |
|---|---|
| U-1 | Header: exactly one h1 "Businesses"; the purpose sentence; no "Filters" button; no "Apply Filters", "Email Verified", "Auth Provider", "Joined Date", "Has Agents" anywhere (D-11 (a)) |
| U-2 | KPI: three tiles in order; names "Users shown (active), 2", "Active users, 0", "New today, 0"; tile 1 is a link with href `/admin/users?status=all`, a plain click sends one request with `status=all` and no navigation; tile 2 has `aria-current` under the default; tile 3 is `role="group"`, not a link; placeholders during the first read; no tiles after a failed read |
| U-3 | URL: `?status=inactive` makes the **first** request `status=inactive` and the select shows it; choosing "All Users" writes `?status=all` by replace; choosing "Active (30 days)" writes no `status`; `?status=bogus` falls back to active and is cleaned; typing "dana" never writes `search` (no `replaceState` call contains it) |
| U-4 | F-19: while a slow second read is pending (search typed), the search input is the same DOM node, keeps its value and focus, the table stays, and the content area has `aria-busy="true"`; Refresh is named "Refresh the business list", is busy, and sends one request with the same `status` and `search`; "Read at HH:mm UTC" shows after a read |
| U-5 | F-20: a 502 with an HTML body → "Could not read the business list. Try again in a moment." (no "Unexpected token", no "SyntaxError"); a 500 with no JSON and `statusText: 'Internal Server Error'` → the fixed copy, not the status text; a rejected fetch → "Could not reach the server. Check your connection and try again."; a 401 → "Your admin session has ended. Sign in again."; a 500 with `{ error: 'Failed to fetch users' }` → that text; the error is `role="alert"` and carries no `bg-red-50` |
| U-6 | Success → failure → retry: a good first read; Refresh fails (error shown, rows and tiles gone); "Try again" (focused) succeeds: rows and tiles back, the error gone, and focus is on the content area, not `<body>` |
| U-7 | Clear: disabled at defaults; enabled after status "all" or a search; one click → **exactly one** request, `status=active` with an empty `search` (checked again after the debounce window), the box is empty, the URL has no `status`, Clear is disabled again (SA M-1) |
| U-7b | Mount: exactly **one** list request, and still exactly one after the 300 ms debounce window has passed (SA M-1; protects `defaultFilter`'s first-request pin) |
| U-8 | F-18 (D-16): typing "acme" then emptying the box sends a request with an empty `search` after the debounce; typing then changing the status within 300 ms sends no second request for the same text |
| U-9 | Newest wins (SA M-5): two list reads whose responses resolve in reverse order; the rows shown are the newer read's, and Refresh is not busy after both settle. Plus: an older read that **fails** and resolves last shows no error, keeps the newer rows, tiles and Read at |
| U-10 | Table: the seven header texts unchanged, each `th` has `scope="col"`; the toggle is named "Show details for Dana Cohen" with `aria-expanded="false"`, then "Hide details for Dana Cohen" / `"true"` after a click; the short id shows `formatShortId` with the full id in `title`; Last Sign In shows "YYYY-MM-DD HH:mm UTC" and the age line; a null sign-in shows "Never" |
| U-11 | Count line: "1 user" / "2 users" (singular and plural); with 101 rows, "Showing the first 100 of 101 users, newest first…" and exactly 100 rows |
| U-12 | An open row stays open across Refresh: the detail is not re-mounted, so the Business OS panel's two reads are not repeated (§2.5); a status change that drops the row closes it |
| U-13 | The capped and failed search notices render through `AdminNotice` with their existing test ids and words |

**Shared folder.**

| File | New case |
|---|---|
| `DatePresets.render` | A visible "Window" text exists, and the group's `aria-labelledby` points at it; the group's accessible name is exactly "Window"; Apply (Custom open) has an `aria-hidden` spacer sibling above it |
| `AdminFilterBar.render` | With `help`, one `<p>` with the given id, text and test id is the bar's last child, inside `role="search"`; without `help`, no such node; with controls, Clear and Refresh each have an `aria-hidden` spacer above them; the no-controls branch has no spacer and no help line (L-1a DOM unchanged); `AdminFieldSpacer` is the same function re-exported |

### 6.2 Edited deliberately (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `users/defaultFilter.render` "labels the filtered count shown, not total, in the card and the pill" | The `count-card-label` / `count-pill` assertions become the first tile's accessible name: "Users shown (active), 1", then after "All Users" "All users, 1". The test name drops "and the pill" | The header pills are removed (§5.3: no decorative pills; one was green, T-6); the tile keeps the same words |
| `users/defaultFilter.render` "never logs the raw list body" | `await findByTestId('count-pill')` → `await findByTestId('kpi-shown')` | Same wait, new anchor |
| `users/businessOsPanel.render` P-4 | `list-scope-note` → the purpose text found by `getByText(/Every login on the platform/)` inside the page header; `count-pill` "2" → the first tile's name contains "2" | `AdminPageHeader` renders the purpose without a test id; the pill is gone |
| `layout/AdminBusinessPicker.render` "the id prop overrides the input id only" | `hint="A note"` → `describedBy="note-id"`; the hint-id assertion becomes "the input's `aria-describedby` is `note-id`" | `hint` replaced by `describedBy` |
| `layout/AdminBusinessPicker.render` "shows no hint and no aria-describedby by default" | Renamed "no aria-describedby by default"; the `business-picker-hint` query is dropped | Same |
| `layout/AdminBusinessPicker.render` "shows a given hint and links it with aria-describedby" (+ the `withHint` harness prop) | Becomes "puts the given describedBy id on its own input only, and renders no note itself"; the harness prop becomes `describedBy` | Same |
| `audit-trail/businessPicker.render` "states out loud that only accounts with a profile can be found by name" | Text assertions unchanged; adds: the picker input's `aria-describedby` equals the help line's id; the help line is inside `role="search"` and is **not** inside the picker's field column | The note moved under the bar (user request) |
| `audit-trail/filterDensity.render` "every filter control is reachable by its label" | `'Window'` added to the `it.each` list (`getByLabelText` follows `aria-labelledby`) | Pins the new visible label |

### 6.3 Must stay green with no edit

`users/defaultFilter.render` (all other cases, including `status=active` first, the seven headers and `colspan=7`), `users/businessOsPanel.render` (all other page and panel cases), `users/creditsBlock.render`, `creditsLeftCell.render`, `boostBlock.render`, `boostBlock.actions.render`, `deleteBusinessDialog.render`, `userNameLine.render`, the three contract tests, `source.guard` positions; every Audit trail suite except the two above; every AI cost & usage suite, including `analytics.layout.render` (`getByRole('group', { name: 'Window' })` holds); `layoutFolder.guard`; Health and Jobs suites (no-controls bar branch); Archiving; `AdminSidebar.nav`; the two external credit guards; the `TestAccountCleanupPanel` suites.

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-1 | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics app/admin/archiving app/admin/__tests__ app/admin/components/__tests__ lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts --ci` | All green; suite and test counts recorded |
| V-2 | `npm run test:bos-entitlements` (it also runs `app/admin/users/__tests__`) | Green |
| V-3 | `npx jest app/api/admin/users --ci` | Green, untouched |
| V-4 | Scoped `tsc`: scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`; includes `next-env.d.ts`, `app/admin/users/**`, the shared folder and its tests, `app/admin/audit-trail/**`, `app/admin/analytics/**`, `components/ui/dialog.tsx`, `components/business-os/purge/TestAccountCleanupPanel.tsx`. **Run 1** with a canary `const canary: number = 'x';` in `usersFilters.ts` → exactly that TS2322 (plus any pre-existing errors, listed by file). **Run 2** without it → no error in a file this slice touched; pre-existing errors elsewhere in `page.tsx`'s untouched detail block (for example the `as any` audit filter cast) are listed, not fixed |
| V-5 | `npm run lint:hooks`; `npx eslint` on every touched file | Clean (no new warning on touched lines) |
| V-6 | Mutation checks (each reverted, md5 compared): (a) restore the early-return spinner → U-4 fails; (b) restore `response.statusText` as the message → U-5 fails; (c) put `search` into the spec (not page-only) → U-3 fails; (d) drop the `readSeq` check → U-9 fails; (e) drop the focus fallback → U-6 fails; (f) make `canClear` ignore the search → U-7 fails; (g) remove the F-18 branch → U-8 fails; (h) put `DARK_DIALOG` back in `BoostCapDialog.tsx` → the dialog-class guard fails; (i) re-add one Advanced Filters select → U-1 and the panel guard fail; (j) render the help line inside the picker column again → the audit `businessPicker.render` placement assertion fails; (k) restore `aria-label="Window"` without the visible label → the `DatePresets` and `filterDensity` Window cases fail; (l) remove the spacer above Clear → the `AdminFilterBar` spacer case fails; (m) set `sessionEndedCopy: false` → U-5's 401 case fails; (n) re-key the open detail by read count (remount on every read) → U-12 fails; (o) drop the "differs from the last read started" check in the debounce → the mount pin U-7b fails (SA M-1) | Each fails as stated |
| V-7 | `grep` `app/admin/users/page.tsx` for `statusText`, `bg-red-50`, `Apply Filters`, `showAdvancedFilters`, `text-slate-500` outside the expanded-row block, and count `.json(` (expected 3, all in `handleViewUserDetails`, moved in L-4b); `grep` the four dialogs for `DARK_DIALOG` (none) | As stated |
| V-8 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions match the plan; no file emptied |

### 7.1 Browser checks for TL / QA (signed-in admin, DevTools Network open, light and dark OS-scheme emulation)

> **Production rule (SA M-4): never submit** a grant, take-back, spending limit, reconcile, cleanup or deletion. Open, inspect, close with Escape or Cancel only.

| # | Check |
|---|---|
| B-1 | `/admin/users` loads with one `GET /api/admin/users?status=active&search=`; header "Businesses" and the purpose line; three tiles; the bar with Search, Status, Clear (disabled), Read at, Refresh; no shell title, no pills, no Filters button |
| B-2 | Type in Search: the box keeps focus and its text, no full-page spinner, one request after the pause, the table dims to busy and back; the address bar never shows the text |
| B-3 | Status "All Users": URL `?status=all` (no new Back entry), tile 1 reads "All users" and carries the ring; tile 2 click returns to active and the URL loses `status`; middle-click on tile 1 opens `?status=all` in a new tab |
| B-4 | Clear after a search and "All Users": one request back to active with no search, box empty, URL clean, Clear disabled |
| B-5 | Offline then Refresh: dark red box "Could not reach the server…", tiles gone; back online, Try again: list back, focus on the list area |
| B-6 | Open a row: the detail reads exactly as before (Business OS panel, cards, login activity, plugins, AI spend, audit, danger area); Refresh with it open: it stays open with no new panel requests |
| B-7 | Credits: open Give credits and Take back; with **light** emulation the close X computed `color` is `rgb(203, 213, 225)` and opacity 1, focus ring purple; Escape closes and focus returns. Top-ups: the spending-limit and reconcile dialogs, same check. **Never submit a grant, take-back, limit or reconcile in production**; close with Escape or Cancel. The Delete dialog is not reachable (`SHOW_AD1_DELETE_ENTRY = false`); its class is covered by the dialog-class guard and `deleteBusinessDialog.render` |
| B-8 | Danger area: the cleanup panel renders as before (the Delete… entry stays hidden). **Never run a cleanup or removal in production** |
| B-9 | Audit trail: the Window, Business, Search, Action Type, Severity and Entity Type labels sit on one row and their controls on one row; Clear, Refresh and "BOS AI failures" line up with the controls; the business note is one line under the bar; a screen reader (or the accessibility pane) gives the business input the note as its description |
| B-10 | AI cost & usage: Window, Business, Scope, Group by on one label row and one control row; Custom → From, To and Apply on the same rows; "start after end" alert below without moving the other controls |
| B-11 | Narrow window (about 700 px): the bar wraps; each wrapped line keeps labels above controls |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding (M-1 to M-5 applied 2026-10-11)
- [x] 2. F-18 product question answered by the user (D-16: reload when the box is emptied); mechanism per SA M-1
- [x] 3. Shared: `DatePresets` (label, spacer, alignment, button height) + its tests ✅
- [x] 4. Shared: `AdminFilterBar` (alignment, spacers, `help`, `ADMIN_BUTTON` on Refresh only) + its tests; `adminTable.ts` comment ✅
- [x] 5. Shared: `AdminBusinessPicker` `describedBy` + the three test edits ✅
- [x] 6. Audit trail: help line, `describedBy`, spacer; `businessPicker.render` and `filterDensity` edits ✅
- [x] 7. Businesses: the four dialogs on `ADMIN_DIALOG_CLASS` ✅
- [x] 8. Businesses: `usersFilters.ts`, `BusinessesKpis.tsx`; `userName.ts` (S-1 `pill` removed, S-4 `rowToggleName`) ✅
- [x] 9. Businesses `page.tsx`: imports, filters hook, read path, states, header, tiles, bar, notices, count line, table (detail block byte-identical) ✅
- [x] 10. `businessesLayout.render` (U-1 to U-13 with U-7b); the `defaultFilter`, `businessOsPanel` and `userNameLine` edits; `source.guard` additions ✅
- [x] 11. V-1 to V-8; results in Implementation Notes ✅
- [x] 12. Requirement: §1 row 9, §5.5 text, §6.2 C-6 / C-8 / C-10 notes, §7.7 as-built, §9 (F-2, F-19 to F-22 done; F-88; F-103 done, F-104 open), Change History ✅
- [ ] 13. Hand to SA code review, then QA (nothing committed by Dev)

---

## 9. Sizing

| Part | Days |
|---|---|
| Shared alignment fix + tests (steps 3-5) | 0.75 |
| Audit trail adoption + test edits (step 6) | 0.25 |
| Dialogs (step 7) | 0.25 |
| Page: read path, states, header, tiles, bar, URL (steps 8-9) | 1 |
| Table restyle, dates, toggle name (step 9) | 0.5 |
| Page tests and guard additions (step 10) | 0.75 |
| Verification and docs (steps 11-12) | 0.5 |
| **Total** | **about 4 days** |

Inside the "a few days" limit, at its top end. If SA prefers, the shared alignment fix can ship first as its own small full-cycle slice (about 1 day) and L-4a drops to about 3 days; Dev's recommendation is to keep it here, as the user asked, because the Businesses bar is its third consumer and is built on it.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `items-start` makes a page child with no label float up to the label row | Every current child audited (§1.4): Audit trail's one label-less button gets the spacer; AI cost & usage has none; Businesses has none. B-9 to B-11 check it |
| The `aria-labelledby` switch changes the group's name | The name is computed from the visible text "Window"; three suites query by that name and stay green with no edit |
| Removing `hint` breaks a consumer | Only Audit trail passes it (grep at `8d09d42d`); tsc V-4 covers both pages |
| The open detail no longer refreshes with the list (§2.5) | Named forced change; SA Q-2; U-12 pins the chosen behaviour |
| `useSearchParams` returns null in the existing users suites (no App Router) | The hook then uses defaults and writes nothing, so `status=active` first and the select change still work; the new suite mocks `next/navigation` for the URL cases |
| The boost dialogs are being changed by another session | They were last changed by credits boost 6b (`3e288bb7`, merged); the edit is three lines per file; any conflict is mechanical |
| The detail's untouched code has pre-existing type or lint findings | Not fixed here (§11); V-4 and V-5 report only on touched lines and list the rest |
| Clear disables itself after a click, so keyboard focus drops to `<body>` (all bar pages) | Found on the way, recorded (F-104), not fixed here unless SA rules otherwise (Q-12) |

---

## 11. Out of scope and found on the way

- **L-4b** (§13): the row detail into the drawer, the Open button, the three detail reads, the registry entry, F-23 and F-24.
- F-25 (`formatCost` 4 decimals), F-27 (100-row cap, unused sort params): open, unchanged.
- F-26 (tiles 1 and 2 equal under Active): kept by D-11 (a).
- `UserNameLine`'s Active badge stays its own neutral pill rather than a `StatusChip` (pinned user decision U-7).
- New findings to add to §9 at implementation: **F-103** the Businesses page has four `DARK_DIALOG` copies, not two (§1.3), corrected in §4.1 / §6.2 C-10 notes; **F-104** the shared bar's Clear disables itself on click, so keyboard focus falls to `<body>` on every bar page (UX, open, SA Q-12).

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Path and split: full cycle (three shared exports change, R-7) under the fast-track; L-4 split into L-4a (this) and L-4b (§13)? | Yes to both. The detail is about 420 lines with nine blocks, two nested dialogs and a destructive panel: a separate review surface |
| Q-2 | An open row's detail stays mounted across list reads (§2.5): fewer requests than today, nothing typed inside it lost. Alternative: re-key it per read so its reads repeat as today | Stay mounted. The remount was a side effect of the full-page spinner (F-19), not a feature, and it threw away input |
| Q-3 | The two credits boost dialogs adopt `ADMIN_DIALOG_CLASS` too, though D-8 (a) named two dialogs? | Yes: same defect (F-88), same page, three lines each |
| Q-4 | Alignment by `items-start` + an exported `AdminFieldSpacer`, rather than `self-end` on label-less items (no export)? | Spacer: robust when a field grows below its control (§2.2) |
| Q-5 | Picker API: replace `hint` with `describedBy` (page-owned id) and add the bar's `help` line, rather than keep `hint` for an in-column note? | Replace: one consumer, and keeping an in-column note invites the same misalignment back |
| Q-6 | Preset buttons `py-1` → `py-1.5` so the Window group is as tall as the inputs? | Yes; otherwise its control row ends 4 px short |
| Q-7 | Converge the bar's Refresh and Clear on `ADMIN_BUTTON` now (your L-1d Q-7 "when next touched")? | Yes; the only visible effect is the disabled cursor |
| Q-8 | Businesses joins `MIGRATED_PAGES` in L-4b, not L-4a (the three detail reads still call `.json(` until the detail moves)? | Yes; converting them now changes the detail's error edges, which L-4b owns |
| Q-9 | Last Sign In and Joined as `formatUtc` with the relative age as a second line, without building `formatUtcDate`? | Yes; no new export, and both are timestamps |
| Q-10 | Tile labels keep the existing words (`countLabels`, "Active users", "New today") rather than §7.7's "Logins shown" / "Active (30 days)"? | Keep: the "shown" wording is your C-15 (a) ruling and is pinned |
| Q-11 | F-18: re-read when the search box is emptied after a search (needed for Clear), pending the user's answer (§2.4)? | Yes, if the user agrees. **Answered by the user 2026-10-11: "Yes, reload"** (requirement §10 D-16): emptying the box reloads the list after the same ~300 ms debounce as typing, so everyone shows again; Clear relies on it. Mechanism ruled by SA (M-1) |
| Q-12 | F-104 (Clear disabling itself drops focus, shared): record only, or fix now with `aria-disabled` in the bar? | Record only; it is shared behaviour on two merged pages and needs its own check |
| Q-13 | `sessionEndedCopy: true` on the list read (as L-2a), so a 401/403 shows the session-ended sentence instead of the route's word? | Yes |
| Q-14 | The focus fallback rule (§3.3: only when focus was inside the content area and fell to `<body>`)? | Yes; it never moves focus on a bar-initiated read or on first load |

### Product question for the user (via TL, plain words)

> **Answered 2026-10-11 — "Yes, reload"** (requirement §10 D-16, §9 F-18). Kept below as asked.

**When an admin empties the search box on Businesses, should the list reload to show everyone again?** Today it does not: the list keeps showing the last search's results under an empty box, which looks like a full list but is not. The new "Clear" button needs the reload to work. Recommended: yes, reload (about a third of a second after the box is emptied, as typing already does). Alternative: keep today's behaviour for a hand-emptied box and reload only when Clear is pressed.

---

## 13. L-4b outline (row detail into the drawer)

Not planned in detail here; written up as its own workplan after L-4a merges (§3 rule 2).

| Area | Plan |
|---|---|
| Shape | One page-level `AdminDrawer` keyed by the selected account id (Q-16, R-8; the L-1d Audit trail pattern), rendered outside every state branch so focus has a place to land |
| Body | A new `components/BusinessDetail.tsx` holding the same blocks in the same order: BusinessOsPanel first, the user cards, login activity, plugins, AI spend (all products), per-user audit with its filter, danger area last (AD-1 gate + `TestAccountCleanupPanel`, keyed by the row, only with an email) |
| Opener | `OpenRowButton` ("Open details for {name}") inside the existing first cell (Q-16), so the seven-column pin holds; the row stays clickable; focus returns to the opener on close, or to the content area when the row has gone. Open point for SA: what the "Actions" column holds once the chevron goes (it must stay, for the pin) |
| Reads | The three detail reads stay page-owned (no `useDrawerResource`, R-6) and move to `readJsonBody`, keeping P-6, P-6b, P-6c and QA-P8 exactly (a failed section is re-read on reopen; a loaded one is not); newest-wins on a fast switch between rows |
| Dialogs | Credits, top-up and delete dialogs open from inside the drawer (already on `ADMIN_DIALOG_CLASS` from L-4a); Escape closes the dialog only, then the drawer |
| Cleanup panel | Closing the drawer unmounts the panel, which reports a pending CLEAN, exactly as collapsing the row does today |
| Guards | `source.guard` position checks (`{isExpanded && (` → `danger-area` → dialog → gate → panel) move to `BusinessDetail.tsx`, with the same order and the same `onRemoved` / `onDeleted` bodies; `creditBands.guard` covers the new file automatically; Businesses joins `MIGRATED_PAGES` |
| User items | F-23 ("Click to load" in Login Activity) and F-24 (two AI spend blocks) stay the user's; the drawer keeps both as they are unless the user decides |
| User request (2026-10-11) | The per-business **audit trail section** inside the detail starts **collapsed**, with an expand/collapse button (`aria-expanded`), so scrolling the detail does not run through the full audit table. Its data is still read as today; only its display is folded. Pin it with a test (collapsed by default; expand shows the rows; collapse hides them) |
| Path | UI short path if it builds no shared export; full cycle otherwise (R-7) |
| Size | About 2.5 to 3 days |

---

## Implementation Notes

**Dev, 2026-10-11.** Code complete on `feature/admin-layout-l4`, **uncommitted**. Built in the planned order: the shared fix first (steps 3 to 6, green on its own), then the page. Inside the estimate; the pre-approved "ship the shared fix alone" fallback was not needed.

### Results

| # | Check | Result |
|---|---|---|
| V-1 | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics app/admin/archiving app/admin/__tests__ app/admin/components/__tests__ lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts app/api/admin/users lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | ✅ 79 suites, 2,038 tests, all passed |
| V-2 | `npm run test:bos-entitlements` | ✅ exit 0; 235 suites, 6,520 tests |
| V-3 | `npx jest app/api/admin/users --ci` | ✅ 6 suites, 92 tests (untouched) |
| V-4 | Scoped `tsc` (scratch tsconfig in the session scratchpad, `extends` the worktree config, `incremental: false`; `next-env.d.ts`, `app/admin/users/**`, the shared folder, `app/admin/audit-trail/**`, `app/admin/analytics/**`, `components/ui/dialog.tsx`, `TestAccountCleanupPanel.tsx`) | ✅ Run 1 with `const canary: number = 'x';` in `usersFilters.ts`: exactly one error, `usersFilters.ts(32,7): error TS2322`. Run 2, canary removed (file ends on its last real line): exit 0, **no errors at all** in the scope (no pre-existing ones either) |
| V-5 | `npm run lint:hooks`; `npx eslint` on all 23 touched source and test files | ✅ `lint:hooks` clean. ESLint: 0 errors; no warning on a touched line. Remaining warnings are pre-existing: `users/page.tsx` 3 (`any` in `AuditLogEntry` and the detail block's audit-filter cast; 9 before, the unused imports and the two `exhaustive-deps` are gone), `audit-trail/page.tsx` 12 (12 before) |
| V-6 | Mutations (a) to (o), harness in the session scratchpad: apply, run the named tests, restore, compare md5 | ✅ all 15 red, all restored with equal md5: (a) U-4; (b) U-5 HTML 502 and statusText cases; (c) U-3 search-in-URL case; (d) both U-9 cases; (e) U-6 retry focus; (f) U-7 after-search case; (g) U-8 emptied box; (h) dialog-class guard for `BoostCapDialog.tsx`; (i) U-1 and the panel guard; (j) audit `businessPicker.render` placement; (k) `DatePresets` Window-label case and the new `filterDensity` visible-label case; (l) `AdminFilterBar` spacer case; (m) U-5 401; (n) U-12; (o) U-7b mount pin |
| V-7 | Greps on `users/page.tsx` | ✅ `statusText`: 1, in a comment only; `bg-red-50`: 1, the substring of `bg-red-500/20` in the untouched `getSeverityColor`; `Apply Filters` / `showAdvancedFilters`: 0; `text-slate-500` outside the detail block: 0; `.json(`: 3, all in `handleViewUserDetails` (L-4b). `DARK_DIALOG` in the four dialogs: 0 |
| V-8 | `git status --short` + `git diff --stat` before reading the diff | ✅ 21 modified + 4 new (this workplan, `usersFilters.ts`, `BusinessesKpis.tsx`, `businessesLayout.render.test.tsx`); 831 insertions, 517 deletions; no file emptied, no deletion-only file, nothing outside §4 |
| — | Detail block | ✅ Byte-identical: from `{/* Expanded Details Row */}` to `</React.Fragment>` (30,286 bytes) compared against the pre-edit copy, plus `handleViewUserDetails`, `formatCost` / `formatNumber` / `formatDate` and `getFilteredUsers`. `source.guard` position checks and the `onRemoved` / `onDeleted` bodies pass with no edit |
| — | Flake | The new suite run 3 more times: 31 / 31 each time |
| — | CSS-escape rule over the 25 changed and new files (the guard reads tracked files only) | ✅ no undecodable escape; no backslash in this workplan or the requirement |

### Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| DV-1 | The panel guard's words are `Apply Filters`, `showAdvancedFilters`, `Has Agents`, `All Providers`, `Unverified Only`, `Joined Date`, not "Auth Provider" / "Email Verified" | The untouched row detail's user card shows "Email Verified:" and "Auth Providers:", so those words would make the guard fail on code L-4a must not edit. U-1 still checks the DOM for all five §6.1 words (no row is open there) |
| DV-2 | `fetchUsers` is a stable `useCallback` that reads the status and search from a `query` ref, updated by an effect declared before the read effects | Keeps `onRemoved` / `onDeleted` as `void fetchUsers();` byte-identical, gives the read effects honest dependencies (no `eslint-disable`, S-6), and lets the debounce compare against `lastSearched` (M-1) |
| DV-3 | `userName.ts` gains `rowToggleName(fullName, email)` | S-4: the toggle's name is the person's name as the row shows it, else the email, else "this login". Pure and tested in U-10 |
| DV-4 | Two test strengthenings beyond §6.2: the audit hint test asserts the help line is a **direct child** of the bar; `filterDensity` gains one case "Window has a VISIBLE label" (besides `'Window'` in the `it.each` list) | Without them mutations (j) and (k) stayed green: a note placed beside the picker inside its wrapper is outside the picker's own column, and `getByLabelText('Window')` also matches a bare `aria-label` |
| DV-5 | The table keeps its old indentation inside the new content wrapper | So the row detail below shows zero diff (byte-identical, above). A comment says so |
| DV-6 | The empty state keeps the one `td colSpan={7}`, now `px-3 py-8 text-center` with the `AdminEmpty` typography; the large database icon is gone; "Search all users" takes `ADMIN_BUTTON` | §5.10 Empty inside the table (the `colspan=7` pin); words unchanged |
| DV-7 | The count line also shows "0 users" above an empty table | One rule for the line; the empty cell still says why |
| DV-8 | The first-cell chevron stays as decoration (`aria-hidden`, slate-500 lifted to slate-400); the named toggle is the Actions button | A-2 asks for the name on the control; the decorative icon is unchanged in meaning |

### Tests edited (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `users/defaultFilter.render` "labels the filtered count shown…" | Reads the first tile's name ("Users shown (active), 1", then "All users, 1"); "and the pill" dropped from the name | Header pills removed (§5.3, T-6) |
| `users/defaultFilter.render` "never logs the raw list body" | Waits on `kpi-shown` instead of `count-pill` | Same wait, new anchor |
| `users/businessOsPanel.render` P-4 | Purpose found by text inside the header (`banner`); count from the first tile's name | `AdminPageHeader` has no test id on the purpose; pill gone |
| `users/userNameLine.render` "total only under All users" | `countLabels` returns `{ card }` only | SA S-1: dead `pill` removed |
| `users/source.guard` | Additive: `SCREEN_FILES` gains `usersFilters.ts`, `components/BusinessesKpis.tsx`; new dialog-class describe (with planted samples) and the no-panel case | D-8 (a), D-11 (a) |
| `layout/AdminBusinessPicker.render` (3 cases + harness) | As §6.2 | `hint` replaced by `describedBy` |
| `layout/DatePresets.render`, `layout/AdminFilterBar.render` | Additive cases (§6.1, S-9) | New shared behaviour |
| `audit-trail/businessPicker.render`, `audit-trail/filterDensity.render` | As §6.2, plus DV-4 | The note moved under the bar; the visible Window label |

### User-visible changes

On **Businesses**: the standard header (no pills, no Filters button); three tiles, the first two links that set the status (Active carries the ring by default); the bar with labelled Search and Status, Clear, Read at and a named Refresh; the Advanced Filters panel is gone; no full-page spinner (the search box keeps its text and focus while the list re-reads) and a dark error box with Try again; the capped / failed search notices as amber notices; a count line above the table; the standard table density with UTC times and an age line, short ids with the full id on hover, and a named row toggle; emptying the search box reloads the list (D-16); an open row stays open across a list read (Refresh no longer re-reads an open detail; collapse and reopen does, SA N-1); the credit, top-up and delete dialogs on the shared class, with a visible close X in a light OS scheme (the reconcile description keeps its brighter text). On **Audit trail** and **AI cost & usage**: every field on one label row, a visible "Window" label, preset buttons as tall as the inputs; Refresh shows a not-allowed cursor while busy; on Audit trail the business note is one line under the bar, shortened to "Only accounts with a business profile can be found by name. Paste a full account id for any other account."

### Found on the way (listed, not fixed)

- `getFilteredUsers` sorts the `users` state array in place when there is no search (`filtered = users` then `.sort`): pre-existing, harmless today.
- The list's Login Activity cell still uses green for the login count and tick (`text-green-300` / `text-green-400`). Not in L-4a's scope (the cell is unchanged apart from the slate lift); a T-6 question for L-4b or the user.
- Opening a row in jsdom logs "Not implemented: window.scrollTo" from the detail's framer-motion animation (the existing row-opening suites do the same); test noise only.
- The shared layout files are LF in this worktree while git would store CRLF on the next touch (the warning on `git diff`); pre-existing and preserved, not changed.
- F-104 (Clear drops keyboard focus to `<body>`) stays open as ruled (Q-12).

## SA Review Notes

Workplan review: see the next section. Code review: see "SA Code Review — 2026-10-11" below it (Code Approved).

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11** against the requirement (§5.4, §5.5, §5.6, §5.7, §5.10, §5.11, §5.12, §6.1, §6.2 C-6 / C-8 / C-10, §7.7, D-6 (a), D-8 (a), D-11 (a), Q-16 / R-8, R-7, §9 F-items) and the shared folder as it is on `feature/admin-layout-l4` at `8d09d42d` (`AdminFilterBar.tsx`, `DatePresets.tsx`, `AdminBusinessPicker.tsx`, `adminTable.ts`, `adminDialog.ts`, `readAdminResponse.ts`, `useAdminFilters.ts`, `KpiStrip.tsx`, `AdminStates.tsx`, `layoutFolder.guard`), the Businesses page and its tests, and the Audit trail filter bar and tests.

**Status:** ✅ APPROVED WITH CONDITIONS. Dev applies M-1 to M-5 to this workplan before coding (no second SA pass needed for them; SA checks them at code review). S-1 to S-9 are code-review checks. No product question remains: the only one (F-18) is answered by the user (D-16).

**Scope confirmed:** no route, payload, write, money or permission change; no new import from `lib/business-os/entitlements/` (type-only included) in any file of this slice, so no entitlements registration is needed (V-2 still runs); the credit, top-up, cleanup and delete flows change only their dialogs' classes; every `source.guard` position check and both `onRemoved` / `onDeleted` bodies stay byte-identical; `creditBands.guard` and `creditFigures.fromConfig.guard` run unedited over the new files; the first request stays `status=active&search=` with the seven header texts and `colspan=7`; search is never read from or written to the URL.

### Rulings on §12

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Full cycle, and the L-4a / L-4b split: approved.** | R-7: three shared exports change (bar `help`, `AdminFieldSpacer`, picker `describedBy`). The detail (about 420 lines, a destructive panel, two nested dialogs) is its own review surface; §7.7 allows the split |
| Q-2 | **Stay mounted: approved**, as a named forced change in the PR. | The remount was a side effect of the full-page spinner (F-19), not a feature; it lost typed input and repeated reads. It matches L-4b, where the drawer is keyed by account id and a list read never remounts it. The open detail is still re-read by collapse and reopen (the block unmounts), which is the way to refresh it (N-1) |
| Q-3 | **Yes, both boost dialogs adopt `ADMIN_DIALOG_CLASS`.** `BoostReconcileDialog` keeps its own `!text-slate-300` description. | Same defect (F-88) on the same page; three lines each; the reconcile description is body text, not a subtitle |
| Q-4 | **`items-start` plus an exported `AdminFieldSpacer`: approved.** | `self-end` aligns to the tallest item, so the Custom row's "start after end" alert would push Clear and Refresh down. The spacer reuses `ADMIN_FIELD_LABEL`, so its height equals a label's under any font metrics. No new file, no new import outside the folder (S-3 holds) |
| Q-5 | **Replace `hint` with `describedBy` and add the bar's `help` line: approved.** | One consumer (Audit trail; AI cost & usage passes none; Activity and Costs still use the original picker, not the shared one). An in-column note is what caused the misalignment. Consequences accepted: the picker test's three cases edited, the Audit trail hint test keeps its text assertions and gains linkage and placement assertions; `business-picker-hint` moves to the help line. The page owns the id; a `describedBy` with no matching element is a page bug (S-9) |
| Q-6 | **`py-1` to `py-1.5`: approved.** | Computed: text-xs line 16 + py-1.5 12 + frame p-0.5 4 + border 2 = 34 px, equal to an input (text-sm 20 + 12 + 2). Visible on Audit trail and AI cost & usage as part of the user-requested alignment |
| Q-7 | **Refresh converges on `ADMIN_BUTTON`; Clear does NOT** (see M-2). | Refresh: the only visible delta is the not-allowed cursor while busy, on Health, Jobs, Archiving, Audit trail and AI cost & usage (trivial, accepted). Clear: `ADMIN_BUTTON` would add a filled `bg-slate-800` and lift its text to slate-200 on two merged pages, a visible surprise, and §5.5 part 5 calls Clear a quieter text button. The workplan's "only the disabled cursor" claim is wrong for Clear |
| Q-8 | **Registry entry waits for L-4b: approved.** | The registry asserts no direct `.json(` across the page's files; the three detail reads still call it until the detail moves, and converting them now changes error edges L-4b owns |
| Q-9 | **`formatUtc` plus a relative age as a second line: approved**, with M-3. | §5.11 allows relative only as a secondary hint; `formatUtc` already prints "UTC", so every cell names its zone while the seven pinned headers stay unchanged. No `formatUtcDate` (no consumer) |
| Q-10 | **Keep the existing tile words** (`countLabels(status).card`, "Active users", "New today"): approved; record as a §7.7 as-built deviation. | The "shown" wording is SA C-15 (a), pinned by tests; §7.7's "Logins shown" was drafted before that ruling |
| Q-11 | **F-18: reload when the box is emptied — decided by the user (D-16).** Mechanism per M-1. | User answer 2026-10-11, "Yes, reload" |
| Q-12 | **F-104: record only.** | Three merged suites pin Clear's `disabled` (`AdminFilterBar.render:94`, `auditTrail.layout.render:418`, `analytics.layout.render:624`); an `aria-disabled` change is shared behaviour on two merged pages and needs its own check. Open in §9 |
| Q-13 | **`sessionEndedCopy: true`: approved.** | RC-4 pattern already used by AI cost & usage (L-2a). The route answers `error` on every failure, so losing today's `errorData.message` fallback costs nothing (N-2) |
| Q-14 | **Focus fallback as written: approved**, page-local, with S-5. | It never moves focus on a bar-started read or the first load; it only rescues focus that fell to `<body>` because its element (Try again, cleanup Done) left with the old content (A-3 spirit) |

**Size (about 4 days) and the fallback:** keep the shared fix in L-4a, as the user asked, and build it first (steps 3 to 6, independently green). If the page steps run clearly past the estimate, Dev raises it to TL and the shared fix (steps 3 to 6 with their tests and the §5.5 / C-6 / C-8 text) may ship alone as its own PR; SA pre-approves that split with no new workplan review.

### Findings

**Must (apply to this workplan before coding)**

| # | Finding |
|---|---|
| M-1 | **F-18 mechanism (D-16).** Replace §2.4's two-branch rule with one rule: the debounce reads when, and only when, the current search text differs from the text of the last read **started** (a ref set inside `fetchUsers` at the start of every read, whoever started it). This covers "emptied after a search", skips the mount (the first read already sent `''`) and skips the double read when the status changes inside the 300 ms window. Clear sets the status default and an empty search together and must produce **exactly one** request (the status effect when the status changed, else the debounce). Tests: U-8 becomes unconditional (drop "if the user approves"); add a pin that the mount sends **exactly one** list request, still one after the debounce window has passed (protects `defaultFilter`'s first-request pin); U-7 asserts exactly one request after Clear. Add mutation (o): drop the "differs from the last read" check → the mount pin fails. Update §2.4, U-8, task 2 and §9 F-18 per D-16 |
| M-2 | **Q-7 correction.** Only Refresh adopts `ADMIN_BUTTON`, composed with its own layout classes (`flex items-center gap-2 transition-colors` plus `ADMIN_BUTTON`), in both bar branches. Clear's class string stays byte-identical. Update §3.1 and the `ADMIN_BUTTON` doc comment in `adminTable.ts` (AdminStates' Try again still pending; Clear deliberately its own style), adding `adminTable.ts` to §4 |
| M-3 | **`formatDate` is used inside the detail block** (`page.tsx:881`, `:892`), which L-4a must not change. Leave `formatDate` byte-identical; the two list cells use `formatUtc` plus a new list-only relative helper that always returns a relative age ("Just now", "Nh ago", "Nd ago"), never a locale date. The helper must not compare against 10, 20, 30 or 60 (creditBands guard: no "under 30 days" branch); the existing 1 / 24 / 7 cut-offs are fine |
| M-4 | **Browser checks in production: never submit** a grant, take-back, spending limit, reconcile, cleanup or deletion. Open, inspect, close with Escape or Cancel only. Delete "unless the TL intends" in B-7 and B-8. The Delete dialog is not reachable (`SHOW_AD1_DELETE_ENTRY = false`); its class is covered by the new dialog-class guard and `deleteBusinessDialog.render`, and B-7 says so |
| M-5 | **Newest read wins for every piece of read state**, not only the rows: `loading` / busy, `error`, `stats`, `searchInfo` and `readAt` are set only by the newest read. An older read that fails after a newer one started must not show an error or clear the list. Extend U-9 with that case (older failure resolving last) and keep mutation (d) |

**Should (checked at code review)**

| # | Finding |
|---|---|
| S-1 | `countLabels().pill` becomes dead once the pills go. Remove `pill` (type and three returns) and its doc comment from `userName.ts`; add the file to §4 (it is already in `SCREEN_FILES`) |
| S-2 | `usersFilters.ts` validates with the existing `toStatusFilter` / `StatusFilter` from `./userName` rather than restating the three strings |
| S-3 | Tile hrefs are `/admin/users` plus `hrefFor(patch)` (as `analytics/page.tsx:260`), never a bare `hrefFor`: for the default it returns `''`, and an empty href resolves to the current, filtered URL, so a middle-click on Active users would open "All" |
| S-4 | The toggle's name uses the name the row shows (the `userName.ts` display helper), falling back to the email; never "null" or "undefined" |
| S-5 | The focus fallback runs after commit (an effect keyed on the read settling), not inside the async read, because the old content leaves only on commit. The content area's `tabIndex={-1}` follows the existing admin precedent for a programmatic focus target (no stray outline). Page-local, not a shared export |
| S-6 | The effects that call `fetchUsers` add no `eslint-disable` without a reason comment; V-5 clean on touched lines |
| S-7 | Confirm in the diff that no `DialogContent` of the four dialogs has a direct-child `<button>` besides the primitive's close (the `[&>button]` selectors would restyle it). At plan time all four open with `DialogHeader` |
| S-8 | Requirement text at implementation: §5.5 Layout (`items-start`, spacer rule, help-line rule) and part 1 (visible "Window", `aria-labelledby`); part 5 notes Clear keeps its quieter style; §6.2 C-6 (`hint` replaced by `describedBy`; the note lives in the bar's `help`), C-8 (help line, spacer), C-10 (Businesses has four dialogs, F-103); §7.7 as-built (Q-10 tile words, L-4a / L-4b split) |
| S-9 | `AdminFilterBar.render` covers `help` absent and present; the picker's `describedBy` doc comment says the page owns the described element |

**Notes**

| # | Note |
|---|---|
| N-1 | After Q-2, the list's Refresh no longer re-reads an open detail; collapse and reopen does. Say so in the PR's visible-changes list (§2.7) |
| N-2 | `readAdminResponse` drops today's `errorData.message` fallback; the route (`app/api/admin/users/route.ts`) answers `error` on all three failure paths, so no copy is lost |
| N-3 | A hand-typed `?search=` is ignored and left in the address bar (U-2 keeps unknown params). Nothing links it; accepted |
| N-4 | The count line counts the rows after the page's own text filter (`filteredUsers.length`, as today's footer), while tile 1 shows the server's filtered `stats.totalUsers`; both are existing figures, no new arithmetic |
| N-5 | The required checks on `test:bos-entitlements` and the Jest gate already cover `app/admin/users/__tests__`; no CI change and no added CI time |

### Verdict

✅ **APPROVED WITH CONDITIONS.** Proceed to implementation after M-1 to M-5 are applied to this file. Path: full cycle under the user's fast-track (SA code review, then QA, then RM commits and opens the PR). No product question for the user.

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11** of the uncommitted diff on `feature/admin-layout-l4` against `HEAD` (`8d09d42d`).
**Status:** ✅ Code Approved. No must-fix. Proceed to QA, then RM.

### How it was checked

| Check | Result |
|---|---|
| `git status --short` + `git diff --stat` first | 21 modified + 4 new, 831 / 517; no file emptied, no deletion-only file, nothing outside §4 |
| Row detail byte-identical | Re-measured independently: from `{/* Expanded Details Row */}` to `</React.Fragment>` is 29,874 bytes with LF and 30,286 with the working copy's CRLF (the Dev's figure), equal to `HEAD` after line-ending normalisation. `handleViewUserDetails`, `formatDate`, `formatCost`, `formatNumber`, `getFilteredUsers`, `getFilteredAuditLogs`, `isActiveUser`, `formatActionName`, `getSeverityColor` also identical. `onRemoved` / `onDeleted` (`page.tsx:1210`, `:1223`) sit inside that block |
| Spot run | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics --ci`: 51 suites, 1,278 tests, all passed. `creditBands.guard`, `creditFigures.fromConfig.guard`, `app/admin/__tests__`: 14 suites, 402 tests, all passed |
| Line endings | `core.autocrlf=true`; index LF throughout; `users/page.tsx` working copy is uniformly CRLF (1,249 CRLF, 0 lone LF), new files LF; the shared folder's LF working copies are pre-existing. No mixed file, nothing to fix |
| Logging, `any`, entitlements | No `console.*` in any touched or new file; no added `any` (the two in `AuditLogEntry` are pre-existing); no import from `lib/business-os/entitlements/` (the only hits are route URL strings and comments in the two credit dialogs, unchanged) |
| Docs | No backslash in the workplan or the requirement |

### Must-fix conditions

| # | Verified at |
|---|---|
| M-1 | `page.tsx:224` `lastSearched` is set inside `fetchUsers` at the start of every read (`:241`); the debounce reads only when `searchTerm !== lastSearched.current` (`:341-349`). The `query` ref effect (`:329-331`) is declared before both read effects, so a status change inside the pause sends the current text and the debounce then skips. `clearAll` (`:363-366`) gives exactly one request either way. U-7, U-7b, U-8 pin it; mutation (o) recorded red |
| M-2 | `AdminFilterBar.tsx` RefreshButton `` `flex items-center gap-2 transition-colors ${ADMIN_BUTTON}` ``; Clear's class string byte-identical (pinned by a new exact-string case). `adminTable.ts` change is the doc comment only |
| M-3 | `formatDate` identical (above). `listAge` (`page.tsx:109-116`) compares only against 1 and 24 hours, never returns a locale date; `MS_PER_HOUR` named. `creditBands.guard` green |
| M-4 | §7.1 production rule present; B-7 / B-8 say never submit; Delete unreachable is stated |
| M-5 | `isNewest()` gates every read-state write: `fail()` on network and route failure, the success writes, and `setLoading(false)` + `settledReads` in `finally` (`:276-325`). An older failure that lands last changes nothing. U-9 (both cases) pins it |

### Should items

| # | Result |
|---|---|
| S-1 | `userName.ts` `countLabels` returns `{ card }` only; `userNameLine.render` edit recorded |
| S-2 | `usersFilters.ts` validates with `toStatusFilter(raw) === raw` |
| S-3 | `page.tsx:369-372` href is `` `/admin/users${hrefFor({ status })}` `` |
| S-4 | `rowToggleName` falls back to the email, then "this login"; tested (U-10) |
| S-5 | Focus fallback in a post-commit effect keyed on `settledReads` (`:355-360`); content area `tabIndex={-1}` with `focus:outline-none`; page-local |
| S-6 | No `eslint-disable` added; `fetchUsers` is a stable `useCallback` with honest deps |
| S-7 | Direct children of each of the four `DialogContent`s checked: only `DialogHeader`, `DialogFooter`, `p`, `form` and conditional `div` bodies. No raw `<button>` the `[&>button]` selectors could restyle |
| S-8 | Requirement §1 rows 9 / 9a, §5.5 Layout and parts 1 / 5, §6.2 C-6 / C-8 / C-10, §7.7 as-built, §9 (F-2, F-18 to F-22, F-88, F-103, F-104), §10 D-16, Change History all present |
| S-9 | `AdminFilterBar.render` covers help present and absent; the picker's `describedBy` doc comment says the page owns the element |

### Shared fix

- `items-start` on the controls row, the Window root and the Custom row; `AdminFieldSpacer` (`ADMIN_FIELD_LABEL` is `block … mb-1`, so the spacer is exactly a label's height) above Clear, the Read at + Refresh group, Apply, and Audit trail's "BOS AI failures". The no-controls branch DOM is unchanged (pinned).
- Visible "Window" `<span>` with `aria-labelledby`; the group's name is still exactly "Window" (`analytics.layout.render`, `auditTrail.layout.render` and `filterDensity` green). Preset buttons `py-1.5`.
- Help line is the bar's last child, `<p id>` linked from the picker input's `aria-describedby`; Audit trail owns one `useId()`. No other consumer passed `hint` (grep clean). AI cost & usage needed no code change and its suites pass.

### Deviations

| # | Ruling |
|---|---|
| DV-1 | Accepted: the panel guard must not fire on the untouched detail's "Email Verified:" / "Auth Providers:"; U-1 still checks the DOM for all five words |
| DV-2 | Accepted, and the better design: one `fetchUsers` identity keeps `onRemoved` / `onDeleted` byte-identical, and the `query` ref is ordered before the read effects |
| DV-3 | Accepted (S-4) |
| DV-4 | Accepted: both strengthenings close real gaps the planned assertions left (mutations (j) and (k)) |
| DV-5 | Accepted: keeps the detail at zero diff; reformat belongs to L-4b when the block moves |
| DV-6 | Accepted: one `td colSpan={7}`, words and condition unchanged from `HEAD`; the icon loss is cosmetic |
| DV-7 | Accepted: one rule for the count line |
| DV-8 | Accepted: the first-cell chevron is `aria-hidden`; the Actions button is the single named control with `aria-expanded`; the row stays clickable |

### Code Review Comments

1. `app/admin/users/__tests__/businessOsPanel.render.test.tsx:457` — P-4 scopes by `getByRole('banner')`. That works because the page renders alone in the test; in the app `AdminPageHeader` sits inside the admin layout's landmark, where a `<header>` is not a banner. Test-only, correct as written; if L-4b mounts the page inside a layout wrapper in tests, scope by the h1's parent instead. — Priority: Low (no action now)
2. `app/admin/users/page.tsx:646-648` — the count line counts `filteredUsers` (after the page's own text filter) while tile 1 shows the server's `stats.totalUsers` (N-4). Both are existing figures; recorded so QA does not report the difference under a search as a defect. — Priority: Low (no action)

### Optimisation Suggestions

- L-4b: when the detail moves, drop the DV-5 indentation carry-over and convert the three detail reads (Q-8), which then lets Businesses join `MIGRATED_PAGES`.
- F-104 (Clear drops keyboard focus) stays open as ruled; a shared `aria-disabled` change is its own small slice.

### Code Approved for QA: Yes

QA focus: B-1 to B-11 in §7.1 under the production rule (M-4: never submit a grant, take-back, limit, reconcile, cleanup or deletion); in particular B-4 (one request after Clear), B-6 (open row stays open across Refresh with no new panel requests), B-7 (close X in a light OS scheme), and B-9 / B-10 (one label row and one control row on Audit trail and AI cost & usage, including the Custom row with its alert).

## QA Testing Report

## QA Report — 2026-10-11

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A + B (Jest, jsdom render, mocked `fetch` and `next/navigation`), plus throwaway probe suites written by QA and deleted after the run. D (manual browser check) is listed for TL below: jsdom does no layout, so alignment, heights and the close X colour can only be checked in a browser.
**Focus:** ui, api (list read path), security (session copy, no new route), performance (exactly-N requests)
**Skipped:** browser checks (handed to TL with the production rule); live production writes (never, SA M-4)
**Input source:** TL prompt keywords + workplan §6, §7, §7.1

### Commands and results (run by QA in the worktree, uncommitted tree)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics app/admin/archiving app/admin/__tests__ app/admin/components/__tests__ lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts app/api/admin/users lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | ✅ 79 suites, 2,038 tests passed, exit 0 (80.2 s). No QA probe was in the run |
| 2 | `npm run test:bos-entitlements` (run after the probes were deleted, because it covers `app/admin/users/__tests__`) | ✅ 235 suites, 6,520 tests passed, exit 0 |
| 3 | Scoped `tsc` in the session scratchpad `qa-l4a/` (`extends` the worktree config, `noEmit`, `incremental: false`; `next-env.d.ts`, `app/admin/users/**`, the shared layout folder, `app/admin/audit-trail/**`, `app/admin/analytics/**`, `components/ui/dialog.tsx`, `TestAccountCleanupPanel.tsx`) | ✅ Run 1, with a canary file in the **scratchpad** (no worktree edit): exactly one error, `canary.ts(1,7): error TS2322`. Run 2, canary deleted: exit 0, no errors |
| 4 | QA probe suites (3 files, 33 cases): Businesses page 22, shared bar + dialogs 10, Audit trail page 1 | ✅ all green after three harness fixes in QA's own probes (loading copy wording, a `crypto.randomUUID` stub, a CSS selector escape); none was a product failure |
| 5 | Static: `console.*` and `lib/business-os/entitlements` imports in the 5 main touched / new source files; `.json(` in `users/page.tsx`; `DARK_DIALOG` in the dialogs | ✅ 0 / 0; 3 (all in `handleViewUserDetails`, L-4b); 0 |
| 6 | `git status --short` and `git diff --stat` after the probes were deleted | ✅ unchanged: 25 entries, 21 files, 831 insertions / 517 deletions. Nothing stashed or committed; `node_modules` not touched |

### Edge-case probes

| # | Probe | Result |
|---|---|---|
| P1 | Mount = exactly one request `status=active&search=`; four keystrokes inside the pause → exactly one more request carrying the final text; nothing after a second pause | ✅ |
| P2 | D-16: "acme" then emptied → exactly one reload with `search=` and `status=active`; nothing after | ✅ |
| P3 | Clear after "All Users" + a search → exactly one request `status=active&search=`; URL `?status=all` → no query; box empty; Clear disabled again | ✅ |
| P4 | Clear while a typed search is still inside the pause (status at default) → **zero** list requests, box empty, both rows still shown | ✅ Correct: the list on screen is already the default one (see Edge Case 2) |
| P5 | Refresh while typed text is inside the pause → one request carrying the text; the debounce adds none | ✅ |
| P6 | Status tiles: Ctrl, Meta, Shift click and middle `auxclick` do not apply in place (default not prevented, no request, URL unchanged); a plain click on tile 1 → one request `status=all`, URL `?status=all`; tile 2 (`href=/admin/users`) back to Active, URL clean; clicking the current tile sends nothing | ✅ |
| P7 | Newest wins: the newer read **fails** first, the older read **succeeds** last → the error stays, no rows or tiles from the older read, Refresh not busy | ✅ (Dev's U-9 covers the mirror cases) |
| P8 | Failure → Try again pending: error gone, "Reading the business list…" shown, content `aria-busy="true"`, no count line, no tiles, never "0 users"; on success, tiles back and focus on the content area | ✅ |
| P9 | Failure → Try again fails again: the error is back and focus is not on `<body>` | ✅ |
| P10 | 401 and 403 → "Your admin session has ended. Sign in again." in `role="alert"`; the route's own word ("Unauthorized" / "Forbidden") not shown | ✅ |
| P11 | 200 with a non-JSON body → "Could not read the business list…", no "Unexpected" / "SyntaxError" | ✅ |
| P12 | 200 with `success: false` → treated as a failure (alert), not as an empty list | ✅ |
| P13 | Rejected fetch → "Could not reach the server. Check your connection and try again."; Refresh then succeeds: rows back, alert gone | ✅ |
| P14 | Open row (Dana) stays open (`aria-expanded="true"`) across a status change that keeps her in the list, with no new detail requests; then Refresh returns a list without her → her row and detail simply disappear, Oren's toggle is "Show details for Oren Levi" / `false`, no crash | ✅ |
| P15 | Open row, then a failed list read → the row and detail are gone, the error shows, no crash | ✅ |
| P16 | Count line vs tile 1 under a search (SA finding 2): count line "1 user" (page text filter), tile 1 "Users shown (active), 2" (server count) | ✅ As designed (N-4), **not a defect** |
| P17 | Accessibility: one h1; Search and Status reachable by label; Refresh `aria-busy="true"` while reading and back after; content `aria-busy`; every `th` has `scope="col"`; exactly two tile links; "New today" is a `role="group"` named by its text | ✅ |
| P18 | A 200 without `stats` → no crash; rows and count line show | ✅ (tiles stay as placeholders; see Edge Case 3) |
| P19 | Outside URL change (the sidebar link to `/admin/users` while on `?status=all`) → a new read with `status=active`; the select shows Active | ✅ |
| P20 | Capped and failed search notices render, then disappear on the next read without them | ✅ |
| P21 | "Read at" after a failed read | Kept at the last successful time. Same as Audit trail and AI cost & usage (`setReadAt` only on success there too); recorded, not a defect |
| S1 | Shared bar: controls row `items-start` (no `items-end`); every direct child of the row begins with a label-class element (label, the Window label, or `AdminFieldSpacer`) | ✅ |
| S2 | Window group named exactly "Window" through `aria-labelledby` to a **visible** `ADMIN_FIELD_LABEL` span, no `aria-label`; every preset button `py-1.5` | ✅ |
| S3 / S4 | Help line is the bar's last child, its id is the picker input's `aria-describedby`, and it is not inside the picker's `sm:w-72` column; without `help`, neither the line nor `aria-describedby` exists | ✅ |
| S5 | Custom: Apply under an `aria-hidden` invisible spacer; the Custom row is `items-start`; the "start after end" alert is `w-full` inside the Custom row | ✅ |
| S6 | Refresh named "Refresh the x", `aria-busy="false"` at rest, carries `ADMIN_BUTTON` (`disabled:cursor-not-allowed`); Clear under a spacer and **without** `bg-slate-800` (M-2: its own quieter style) | ✅ |
| D1 to D3 | `CreditFormDialog` (give), `BoostCapDialog` (set), `BoostReconcileDialog`: every `ADMIN_DIALOG_CLASS` token on `DialogContent`, no bare `flex`; exactly one direct-child `<button>` (the primitive's Close X); `role="dialog"` with `aria-labelledby`; Escape closes; Cancel (`*-close`) closes; **no POST sent** | ✅ Never submitted. Focus return after Escape cannot be proven in jsdom: a bare `Dialog` with no admin class also leaves focus on `<body>` there (control case), so it is environmental and stays browser check B-7 |
| A1 | Audit trail page: help line is the bar's last child with the 98-character text; the picker input's `aria-describedby` equals its id, and that id is unique; Window label visible; controls row `items-start`, every child starts with a label or spacer; "BOS AI failures", Clear and the Refresh group each sit under an `aria-hidden` spacer; one h1; no `<p>` left in the picker column | ✅ |
| — | AI cost & usage: `app/admin/analytics` has no diff; every `AnalyticsFilterBar` child is labelled (Business, Scope span, Group by), so `items-start` floats nothing up; its suites passed in run 1 | ✅ |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Header: `AdminPageHeader`, one h1, purpose, no pills, no Filters button (§5.3, T-6) | ✅ | Pass | U-1, P17 |
| Three KPI tiles; tiles 1 and 2 set the status in place and are real links; tile 3 has no target; placeholders and K-10 (§5.4, §7.7) | ✅ | Pass | U-2, P6, P8 |
| Search page-only, never in the URL; Status in the URL, default omitted, invalid ignored (§5.6, D-6 (a)) | ✅ | Pass | U-3, P3, P19 |
| Clear back to the defaults with exactly one request (§5.5 part 5, SA M-1) | ✅ | Pass | U-7, P3, P4 |
| Emptying the search reloads the list (D-16) | ✅ | Pass | U-8, P2 |
| Dead Advanced Filters panel removed (D-11 (a)) | ✅ | Pass | U-1 and the panel guard |
| No full-page spinner; dark `AdminError`; `readAdminResponse` with session copy (§5.10, F-19, F-20) | ✅ | Pass | U-4, U-5, P8 to P13 |
| Newest read wins for every piece of read state (SA M-5) | ✅ | Pass | U-9, P7 |
| Focus fallback after an action unmounts the focused element (§5.12 A-3) | ✅ | Pass | U-6, P8, P9 |
| Standard table: `scope="col"`, UTC plus age line, short ids, named toggle with `aria-expanded`, seven headers, `colspan=7` (§5.7, A-2, §5.11) | ✅ | Pass | U-10, P14, P17 |
| Count line (§5.7) | ✅ | Pass | U-11, P16 |
| Open row across list reads (§2.5, SA Q-2) | ✅ | Pass | U-12, P14, P15 |
| Four dialogs on `ADMIN_DIALOG_CLASS` (D-8 (a), F-88) | ✅ | Pass | Dialog-class guard, D1 to D3; Delete covered by the guard and `deleteBusinessDialog.render` (unreachable in the UI) |
| Shared bar: one label row, visible Window label, help line under the bar linked by `aria-describedby`, Refresh on `ADMIN_BUTTON`, Clear unchanged (§5.5, C-6, C-8) | ✅ | Pass (DOM) | S1 to S6, A1. Pixel alignment needs B-9 to B-11 |
| Row detail block untouched (L-4b) | ✅ | Pass | `source.guard` positions green with no edit; SA re-measured byte-identical |
| No route, write, money or permission change; no entitlements import | ✅ | Pass | Run 1 (`app/api/admin/users`, authz surface guard), run 2, static check 5 |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. Request counts were exactly as specified in every probe (mount 1; typing burst 1; empty box 1; Clear 1, or 0 when nothing differs; Refresh during the pause 1; the current tile 0).

#### Edge Cases (nice to fix)

1. **"BOS AI failures" is about 4 px shorter than its neighbours** — Audit trail, `app/admin/audit-trail/page.tsx`. Severity: Low (cosmetic). The button is `text-xs py-1.5` (line 16 + 12 + border 2 = 30 px) while inputs, selects, Clear and Refresh are `text-sm py-1.5` (34 px). Its top now lines up (spacer); its bottom edge sits about 4 px above the others. Not a regression (same classes as before), and the slice did not promise it; TL can judge it in B-9.
2. **Clear during the typing pause sends no request** — `users/page.tsx` `clearAll`. Not a defect: when the status is already Active and the last read had no search, the list on screen is already the default one, so zero requests is correct. Recorded so "Clear sends exactly one request" is read as "at most one, and exactly one when the view differs".
3. **A 200 without `stats` leaves the tiles as placeholders while rows show** — `BusinessesKpis.tsx` (`firstLoad || !stats`). Not reachable: the list route always answers `stats`. No action.
4. **"Read at" stays at the last successful time while the error shows** — shared behaviour across Audit trail and AI cost & usage. No action in this slice.

### Browser checks for TL (signed-in admin, DevTools Network open, light and dark OS-scheme emulation)

> **Production rule (SA M-4): never submit** a grant, take-back, spending limit, reconcile, cleanup or deletion. Open, inspect, then close with Escape or Cancel only.

| # | Check |
|---|---|
| B-1 | `/admin/users` loads with exactly one `GET /api/admin/users?status=active&search=`; header "Businesses" and the purpose line; three tiles (Active users ringed); the bar shows Search, Status, Clear (disabled), Read at and Refresh; no pills, no Filters button, no Advanced Filters |
| B-2 | Type in Search: the box keeps focus and text; no full-page spinner; one request after the pause; the address bar never shows the text. Empty the box: one reload with `search=` (D-16) |
| B-3 | Status "All Users": URL `?status=all` with no new Back entry; tile 1 reads "All users" and is ringed. Tile 2 click: back to Active, URL loses `status`. Middle-click or Ctrl-click tile 1: opens `?status=all` in a new tab, current tab unchanged |
| B-4 | Clear after a search and "All Users": one request back to Active with an empty search; box empty; URL clean; Clear disabled |
| B-5 | DevTools Offline, then Refresh: dark red box "Could not reach the server…", tiles gone, no white box. Online, then Try again: list back and focus on the list area (not lost) |
| B-6 | Open a row: the detail reads as before. Refresh with it open: it stays open, with **no** new login-stats / audit-logs / stats / Business OS panel requests |
| B-7 | Credits: open Give credits and Take back; top-ups: the spending-limit and reconcile dialogs. With **light** emulation, the close X computed `color` is `rgb(203, 213, 225)` with opacity 1 and a purple focus ring; Escape closes and **focus returns to the opener** (jsdom cannot prove this). **Never submit.** Delete stays unreachable (`SHOW_AD1_DELETE_ENTRY = false`) |
| B-8 | Danger area: the cleanup panel renders as before. **Never run a cleanup or removal** |
| B-9 | Audit trail: the Window, Business, Search, Action Type, Severity and Entity Type labels on one row and the controls on one row; Clear, Refresh and "BOS AI failures" tops aligned with the controls (note Edge Case 1); the business note is one line under the bar; the accessibility pane gives the business input that note as its description |
| B-10 | AI cost & usage: Window, Business, Scope and Group by on one label row and one control row; Custom → From, To and Apply on the same rows; the "start after end" alert below without moving other controls |
| B-11 | About 700 px wide: the bar wraps, and each wrapped line keeps labels above controls |
| B-12 | Dark and light emulation: no white or light surfaces introduced on Businesses (error box, notices, empty state, dialogs) |

### Final Status

**Verdict: ✅ PASS WITH NOTES.** No bug of any severity. The notes are a Low cosmetic item, three behaviours recorded as correct by design, and the browser checks for TL. None of them blocks the commit.

- [x] All acceptance criteria pass in automated and jsdom testing — ready for commit under the fast-track
- [ ] Browser checks B-1 to B-12 — TL, signed-in admin, production rule

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | Dev workplan for L-4a (Businesses list) with the folded-in shared filter-bar alignment fix, and an outline for L-4b. Awaiting SA workplan review |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS: Q-1 to Q-14 ruled (Q-7 narrowed: Refresh adopts `ADMIN_BUTTON`, Clear does not); M-1 to M-5 before coding, S-1 to S-9 at code review. User answer to F-18 recorded (Q-11, D-16: reload when the search box is emptied) |
| 2026-10-11 | M-1 to M-5 applied; implemented | Dev: §2.1 items 7 and 10, §2.4, §3.1 (Refresh only on `ADMIN_BUTTON`, `adminTable.ts` comment), §4 (`adminTable.ts`, `userName.ts`), §6.1 (U-7, U-7b, U-8, U-9), §7 V-6 (o), §7.1 production rule and B-7 / B-8 amended per the SA review; tasks 1 to 12 done; Implementation Notes written (results, deviations DV-1 to DV-8, edited tests, user-visible changes, findings). Code complete, uncommitted |
| 2026-10-11 | SA code review | Code Approved, no must-fix: M-1 to M-5 and S-1 to S-9 verified in the diff; detail block re-measured byte-identical; DV-1 to DV-8 accepted; two Low notes (P-4 banner scoping, count line vs tile 1 under a search). Spot run 51 suites / 1,278 tests plus the credit and admin guards (14 / 402) green. Proceed to QA |
| 2026-10-11 | QA | PASS WITH NOTES, no bugs: run 1 79 suites / 2,038 tests, `test:bos-entitlements` 235 / 6,520, scoped tsc (scratch canary, then clean); 33 throwaway probe cases (exactly-N requests, D-16, Clear, tiles, newest-wins, retry, error copy, open row, a11y, shared bar, dialogs never submitted, Audit trail), deleted afterwards. One Low cosmetic edge case (BOS AI failures 4 px shorter); browser checks B-1 to B-12 listed for TL |
| 2026-10-11 | Committed + PR | RM fast-track: commit 38c35a37 on `feature/admin-layout-l4`, origin/main c5edc866 merged in (no file changes); re-run after merge: 79 suites / 2,038 tests, `test:bos-entitlements` 235 / 6,520, `lint:hooks` clean. PR #300 open against main; awaiting checks + user merge. Browser checks B-1 to B-12 owed |
