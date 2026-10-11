# Workplan: Admin Layout Standard — Slice L-4b (Businesses, row detail into the drawer)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 9a), §3, §4.7, §5.7, §5.8 (D-1 to D-8), §5.9, §5.10, §5.11, §5.12 (A-1 to A-9), §6.1, §6.2 C-3, C-4, C-9, C-12, C-13, C-14, §7.7, §9 F-23, F-24, §12.3; SA rulings Q-16, re-check R-6, R-7, R-8; L-1d SA Q-10 (rows open through the button) and the L-1d QA B-1 fix; L-2a QA B-1; L-2b SA M-4 (one page-level drawer outside every branch); [L-4a workplan](/docs/workplans/ADMIN_LAYOUT_L4A_WORKPLAN.md) §13 (outline, including the user request of 2026-10-11), SA workplan review Q-2 / Q-8 / N-1, SA code review comment 1 and the "L-4b" optimisation note
**Branch:** `feature/admin-layout-l4b`, cut from `feature/admin-layout-l4` (L-4a, PR #300 open, not yet merged). The L-4b PR targets `main` and carries the L-4a commit until #300 merges. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Code Complete (uncommitted) — SA workplan review APPROVED WITH CONDITIONS; M-1 to M-5 applied to this file before coding (M-5 in part, see Implementation Notes deviation 1); awaiting SA code review + QA
**Path:** **UI short path by classification** (R-7): no shared export is built and no file in `app/admin/components/layout/` changes except one registry entry in its guard test (as L-3 did). `useDrawerResource` is **not** built here (§2.2). Because the slice moves the destructive-flow guards (cleanup, delete) and puts confirmation dialogs inside a modal drawer, Dev asks for the SA workplan review TL has already scheduled, then runs under the user's fast-track: SA workplan review → Dev → SA code review + QA → RM commits and opens the PR (no user diff review)

## Overview

L-4b finishes `/admin/users` ("Businesses"). The row detail that L-4a left as an inline expanded `<tr colSpan=7>` (about 420 lines inside `page.tsx`) moves into **one page-level `AdminDrawer`** keyed by the open account id (Q-16, R-8), opened by an `OpenRowButton` inside the existing first cell. The blocks stay the same and in the same order: the Business OS panel first, the danger area last. The page-owned simple blocks (user information, timeline, security, login activity, plugins, AI spend, audit) take `DrawerSection` / `DrawerFields`. The per-business audit section **starts collapsed** behind an expand/collapse button (user request, 2026-10-11). The three detail reads move to `readJsonBody`, so Businesses joins the migrated-pages registry.

No route, payload, write, money or permission change. The credit, top-up, cleanup and delete flows are the same components with the same props; only where they are mounted changes (inside the drawer instead of inside a table row).

## Table of Contents

1. [Analysis Summary](#1-analysis-summary-code-verified-at-9ea1cb3c)
2. [Scope and decisions](#2-scope-and-decisions)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Guard and registry changes](#5-guard-and-registry-changes)
6. [Tests](#6-tests)
7. [Verification](#7-verification)
8. [Task List](#8-task-list)
9. [Sizing](#9-sizing)
10. [Risks](#10-risks)
11. [Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
12. [Questions for SA](#12-questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## 1. Analysis Summary (code verified at `9ea1cb3c`)

### 1.1 The detail today (`app/admin/users/page.tsx`, 1,249 lines)

| Lines | What | L-4b |
|---|---|---|
| `:58-63` | `SHOW_AD1_DELETE_ENTRY = false` (AU-2: the Delete… entry is hidden; un-hiding is one line) | Moves to the detail file, same value, same comment |
| `:133-175` | `UserLoginStats`, `UserDetailedStats`, `UNREADABLE_STATS`, `AuditLogEntry` (two `any` fields) | Types move to `types.ts`; the constant moves with the reads |
| `:201-207`, `:215` | `expandedUserId`, `deleteDialogUserId`, the per-account maps (`userLoginStats`, `userAuditLogs`, `userDetailedStats`, `loadingUserDetails`) and `auditFilters` | Drawer state replaces `expandedUserId`; the maps move to a page-folder hook; the delete-dialog state moves into the detail |
| `:393-417` | `formatCost` (4 decimals, F-25 open), `formatNumber`, `formatDate` (relative, then a **local** date; detail only since L-4a M-3) | `formatCost` / `formatNumber` move unchanged; `formatDate` is deleted (§5.11, §2.6) |
| `:426-506` | `handleViewUserDetails`: toggles; skips the reads when all four parts are loaded (stats sections must both be non-null, O-3); three parallel `fetch` + **three `.json()`**; login stats and audit stored only on `ok`; a not-ok or `success !== true` stats answer stores `UNREADABLE_STATS`; any rejection (network, or a parser error in any of the three bodies) lands in one `catch` that marks stats unreadable unless a result is already held | Moves to `useBusinessDetails`; the open/close part becomes the drawer's; `.json()` becomes `readJsonBody` (§2.4) |
| `:508-545` | `getFilteredAuditLogs`, `formatActionName`, `getSeverityColor` | Move to the audit section; `getSeverityColor` is replaced by `StatusChip` (§2.6) |
| `:696-818` | Row: clickable `tr` (`cursor-pointer`, `onClick` opens), decorative chevron in the first cell, the Login Activity cell (count in `text-green-300`, tick `text-green-400`, or "Click to load", F-23), the Actions cell = the named toggle with `aria-expanded` | First cell gets the `OpenRowButton`; the row click and the toggle go (§2.3) |
| `:820-1236` | `{isExpanded && (` → `<tr><td colSpan={7}>`: loading spinner ("Loading user details..."), else a `motion.div` holding: `BusinessOsPanel`; three cards (User Information, Account Timeline, Security); Login Activity (only when login stats exist); Connected Plugins (`plugins-card`); AI spend, all products (`ai-spend-card`, F-24); Audit Trail (own select, `ArchivedBeforeNotice`, up to 50 entries); danger area (`danger-area`: gate → Delete… + `DeleteBusinessDialog` → `TestAccountCleanupPanel` keyed by the row, only with an email) | Becomes `components/BusinessDetail.tsx` inside the drawer |

**The Login Activity column depends on the detail reads.** The list cell shows a login count only for an account whose detail has been opened (the read fills `userLoginStats`); otherwise "Click to load" (F-23). So the three reads must stay **page-owned and outlive the drawer**: closing the drawer must not abort them or drop their results. This decides §2.2.

### 1.2 The shared parts L-4b uses (unchanged)

| Export | Where | Fact that matters here |
|---|---|---|
| `AdminDrawer`, `DrawerSection`, `DrawerFields`, `DrawerField` | `layout/AdminDrawer.tsx` | No fetch, no loading state (R-6). `onCloseAutoFocus` is prevented and the page's `onReturnFocus` called. `DrawerSection` takes a string `title` only (no slot beside the heading) |
| `OpenRowButton` | `layout/OpenRowButton.tsx` | Visible "Open", caller's full `aria-label` starting with "Open", hands back the button |
| `readJsonBody` | `layout/readJsonBody.ts` | Never throws; `null` = no readable body |
| `StatusChip` | `layout/StatusChip.tsx` | Tones `danger`, `warn`, `info`, `unknown` used by Audit trail's severity map (`audit-trail/page.tsx:302-313`) |
| `AdminLoading` | `layout/AdminStates.tsx` | "Reading {what}…" |
| `formatUtc` | `layout/adminFormat.ts` | "YYYY-MM-DD HH:mm UTC" |

`components/ui/sheet.tsx` and `components/ui/dialog.tsx` are both `@radix-ui/react-dialog` (1.1.20, dismissable layer 1.1.11). Radix keeps a layer stack: Escape and an outside pointer act on the **highest** layer only, and a modal `DialogContent` prevents focus-outside dismissal. A credit or boost dialog opened from inside the drawer is therefore the top layer: Escape closes it alone, and the drawer stays (§2.5 pins it).

### 1.3 Tests that pin the detail

| Test | What it pins | L-4b effect |
|---|---|---|
| `users/__tests__/source.guard` | `SCREEN_FILES` rules; in `page.tsx`: `{isExpanded && (` → `danger-area` → gate → `delete-business-open` / `DeleteBusinessDialog` → `TestAccountCleanupPanel`; one dialog, one panel; panel `key={user.id}`, `lockedEmail={user.email}`, `onRemoved` / `onDeleted` bodies `void fetchUsers();`; `{user.email ? (` before the panel; the panel import line; AU-C4 (no DB function name) over `page.tsx` and the panel | Re-expressed for `BusinessDetail.tsx` (§5.1), same intent |
| `users/__tests__/businessOsPanel.render` (page cases) | P-1 to P-6c, QA-P7, QA-P8 open the detail by clicking `row-business`; P-5 reads `User ID:`; QA-P8 closes and reopens by clicking the row again; P-4 scopes the purpose by `getByRole('banner')` | Open through the Open button; close through the drawer; P-5 label; P-4 scoping (§6.2) |
| `users/__tests__/businessesLayout.render` | U-10 "Show / Hide details for Dana Cohen" with `aria-expanded`; U-12 opens by clicking `row-business` and pins "stays open across Refresh, closes when a status change drops the row" | U-10 becomes the Open button; U-12 through the drawer (§6.2) |
| `users/__tests__/defaultFilter.render` | Seven header texts (`:128`), empty cell `colspan=7` (`:164`) | Untouched **if** the Actions column stays; edited to six if SA rules Q-2 (b) |
| `creditsBlock.render`, `boostBlock.render`, `boostBlock.actions.render`, `deleteBusinessDialog.render`, `creditsLeftCell.render`, the three contract tests | The blocks and dialogs mounted directly | No edit: the components do not change |
| `lib/business-os/credits/__tests__/creditBands.guard` | Every non-test file under `app/admin/users/`: no comparison against 10, 20, 30, 60 or 0.1 to 0.6, no `LOW_THRESHOLD` / `LOW_LINE…` | The new files must comply (nothing planned compares; the audit `slice(0, 50)` and the age helper's 1 / 24 already pass) |
| `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard` | No configured credit figure in product copy | No new copy with a figure |
| `layout/__tests__/layoutFolder.guard` registry | Each registered file: exists, no `<h1`, no direct `.json(`, layout only through the alias; one file imports `AdminPageHeader` | Businesses joins (§5.2) |

---

## 2. Scope and decisions

### 2.1 In L-4b

1. **One page-level `AdminDrawer`**, rendered once, unconditionally, after and outside the always-mounted content wrapper and every `error` / `hasLoaded` branch (L-2b SA M-4). `open={isOpen && selected !== null}`; the body only when `selected` is non-null, as `<BusinessDetail key={selected.id} … />`.
2. **Drawer state** the L-1d way (after its QA B-1 fix): `isOpen` + `openId` + an opener ref; closing clears only `isOpen` (the body stays through the slide-out); `selected` is looked up by id among the **rows on screen** (`filteredUsers.slice(0, LIST_ROW_CAP)`), so a drawer never shows an account whose Open button is not on the page; an effect ends the open state when `selected` becomes null (close-when-gone), so a later read that brings the row back never reopens it.
3. **Focus** (D-6): `onReturnFocus` focuses the opener if it is still connected, else the content wrapper (`users-content`, `tabIndex={-1}`, already always mounted since L-4a). Never `<body>`.
4. **Opener**: `OpenRowButton` inside the existing first cell, before the business name, where the decorative chevron sits today (Q-16, R-8). Label `Open details for {rowToggleName(full_name, email)}` (the S-4 helper of L-4a: the name the row shows, else the email, else "this login"). Test id `row-open`.
5. **Reads**: the three detail reads stay page-owned, moved into a page-folder hook `useBusinessDetails.ts`, each body read through `readJsonBody` with the status checked first (§2.4). The caching rule is unchanged (QA-P8, O-3).
6. **Body**: `components/BusinessDetail.tsx` with the same blocks in the same order (§2.6). The audit block is `components/BusinessAuditSection.tsx`, **collapsed by default** (§2.7).
7. **Dialogs inside the drawer**: Give credits / Take back (`CreditFormDialog`), the two boost dialogs, Delete (gated off) open from inside the drawer, unchanged. Escape closes only the top layer (§2.5).
8. **Registry**: Businesses joins `MIGRATED_PAGES` (SA L-4a Q-8): no direct `.json(` remains in the page's own files.
9. **T-5 / T-6 / §5.11 inside the detail and the Login Activity cell**: information text off `text-slate-500`; decorative greens removed; every detail time in UTC (§2.6).
10. **The DV-5 indentation carry-over is dropped**: the table body is re-indented to its real depth now that no byte-identical detail sits under it (SA L-4a optimisation note).

### 2.2 Decision: no `useDrawerResource` (R-6), page-local reads

R-6 said the first page whose drawer **owns** a fetch builds `useDrawerResource`, and verified then that "the Businesses panel fetches inside its own components, which L-4 keeps", naming the Activity drill-down as the hook's source (L-8). L-4b keeps that, for three reasons:

| Reason | Detail |
|---|---|
| The reads are a per-account cache, not a drawer resource | Their results feed the list's Login Activity column (§1.1) and are reused on reopen (QA-P8). D-7's "abort on close" would drop a read the list needs and change request counts that QA-P8 pins |
| The panel reads stay in their components | `BusinessOsPanel`, `CreditsBlock`, `BoostBlock` own their reads and states, with their own render tests (R-6 as ruled) |
| A shared export built here makes this a full-cycle slice for a hook whose first honest consumer is Activity | R-7; the shape would be fitted to the wrong page |

So the drawer shows the hook's state: `AdminLoading` while the account's reads run (as today's spinner), then the body. No abort, no newest-wins machinery is needed: every result is stored under its own account id, so a late answer can never show under another account (§10).

### 2.3 Decision: the Open button plus the whole-row click (Q-1, user decision D-17), and the Actions column (Q-2)

- **Row click (D-17, SA M-1).** The user decided "whole row clickable" (2026-10-11), a recorded page deviation from L-1d SA Q-10 within §5.8 D-2. Built to the SA Q-1 rules:
  1. The `tr` keeps `onClick` and `cursor-pointer`; **no** `tabIndex`, `role`, `onKeyDown` or ARIA on the `tr`: it is a mouse extra, not exposed as a control.
  2. The handler returns without opening when the click target's `closest('button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]')` lies inside the row. This includes the Open button itself, so a click on Open opens once, not twice.
  3. It returns without opening when the user is selecting text: `window.getSelection()` is non-collapsed with its anchor or focus node inside the row (a selection elsewhere on the page does not block the row).
  4. Otherwise it calls the same `openRow(user, opener)` as the button, with `opener` = **that row's Open button**, found inside the clicked row, never the `tr` and never null; focus therefore returns to the row's Open button whichever path opened it.
  5. The Open button stays the only keyboard path and keeps its label.
  6. The drawer stays page-level, outside the table (SA M-4), which also keeps clicks inside the drawer and its portaled dialogs from bubbling (React bubbles through portals along the component tree) to any `tr`.

  The row keeps its hover tint and gets `bg-slate-700/20` while its account is open in the drawer (as the expanded row did).
- **The Actions column (Q-2 ruled (b)).** With the toggle gone it would hold nothing, so it is **removed (six columns)**. `defaultFilter`'s seven-header case and `colspan=7` case, and U-10's header list, are edited deliberately, keeping their intent: no Status / Auth role column, Credits left present, and the empty cell spans every column, asserted as `colspan` equal to the number of `columnheader`s plus the literal `6`. This revises SA Q-16's "seven-column pin holds with no edit" (recorded in requirement §7.7). (a) (an em dash column) and (c) (Open in the Actions cell) are not built.

### 2.4 Decision: the three reads on `readJsonBody` (the error edges L-4b owns)

The status is read first, the body only on `ok`. Same requests, same cache rule, same per-section outcomes, with one deliberate difference: **a body that is not JSON now affects only its own section.** Today a parser error in any of the three bodies jumps to the shared `catch`, so the sections after it are never stored.

| Case | Today | L-4b |
|---|---|---|
| login-stats `ok`, readable | stores `body.data` | Same |
| login-stats `ok`, not JSON | throws: audit and stats skipped; stats marked unreadable unless held | Login stats not stored (refetched next open); audit and stats processed normally |
| login-stats not `ok` | not stored | Same |
| audit `ok`, readable | stores `body.data` or `[]` | Same |
| audit `ok`, not JSON | throws (as above) | Not stored (refetched next open). Never stored as `[]`, which would cache "no events" for good |
| audit not `ok` | not stored | Same |
| stats `ok`, `success: true` with `data` | `{ tokens ?? null, plugins ?? null }` | Same |
| stats `ok`, `success !== true` or no `data` | `UNREADABLE_STATS` | Same |
| stats `ok`, not JSON | throws: unreadable unless held | Unreadable unless held (the `catch` rule, kept for this case) |
| stats not `ok` | `UNREADABLE_STATS` (logged) | Same |
| any `fetch` rejects (network) | `Promise.all` rejects: nothing stored; stats unreadable unless held | Same (P-6c) |
| first open of an account | `auditFilters[id] = 'all'` | Same |

Logging is unchanged: the existing facts-only `debug` line for the stats body and the `error` lines (`createLogger({ module: 'AdminUsersPage' })` stays; the hook takes the page's module name so log queries do not change).

### 2.5 Decision: dialogs inside the drawer (D-8)

The credit, boost and delete dialogs stay where they are in the component tree (inside `BusinessOsPanel` / `CreditsBlock` / `BoostBlock` and the danger area), so they now open from inside the drawer. Facts relied on (§1.2): Radix's layer stack makes the open dialog the top layer, so **Escape closes the dialog only, and a second Escape closes the drawer**; a click inside the dialog (portaled to `body`) does not count as outside the drawer, because the lower layer ignores outside pointers while a higher modal layer is open; a modal dialog's focus moving out of the drawer does not dismiss it. Focus inside the drawer returns to the dialog's trigger through Radix (the dialogs are opened from real buttons). These are pinned in jsdom where jsdom can show them (Escape order, the drawer staying open, no POST) and checked in a browser for focus return and stacking (§7.1).

### 2.6 Decision: the body, block by block

Same blocks, same order. `DrawerSection` / `DrawerFields` where it changes no behaviour; the words of every label kept, colons dropped (the field grid separates label and value).

| # | Block | In the drawer |
|---|---|---|
| 1 | `BusinessOsPanel accountId userName` | Unchanged component, first. Its own headings are `h3` / `h4`, valid under the drawer's `h2` title |
| 2 | User Information | `DrawerSection "User information"`: Full Name (else "N/A"), Company and Phone (only when present, as today), User ID (`font-mono`, full id). No role row (SA-5a-1, P-5) |
| 3 | Account Timeline | `DrawerSection "Account timeline"`: Created, Last Sign In, Last Updated (only when present). Each value is `formatUtc` with the age line under it (§5.11; the L-4a list rule, SA Q-9 / M-3); "Never" when there is no sign-in. `formatDate` (local date) is deleted |
| 4 | Security | `DrawerSection "Security"`: Email Verified ("Yes" / "No"; the ✓ / ✗ marks stay as text), Auth Providers (the purple provider chips kept; "None" lifted from `text-slate-500` to `text-slate-400`, T-5) |
| 5 | Login Activity | `DrawerSection "Login activity"`, only when login stats exist (as today): Total Logins, Failed Logins, Unique IPs, Last Login IP (`font-mono`), numbers `tabular-nums`. The coloured icons go (decoration, T-6) |
| 6 | Connected Plugins | `DrawerSection "Connected plugins"` with test id `plugins-card`: first line "N/M active" (only when readable), then the chips; unreadable → "The connected plugins could not be read." (red text kept); none → "No plugins connected". An inactive chip gains the word "inactive" so state is not colour alone (A-7); the green dot becomes the chip's own colour (T-6) |
| 7 | AI spend, all products | `DrawerSection` with the existing title "AI spend, all products (30 days; may be incomplete above 1,000 calls)" and test id `ai-spend-card`: Input Tokens, Output Tokens, LLM Calls, Total Cost (`formatCost`, 4 decimals, F-25 open) as fields; Cost by Model kept as its list (input number blue kept, output number green → slate-200, T-6). F-24 (two AI spend blocks) stays the user's: both blocks kept |
| 8 | Audit Trail | `BusinessAuditSection` (§2.7) |
| 9 | Danger area | Kept as its own rose-bordered block with test id `danger-area` and its `h3` (a destructive area keeps its warning frame). Inside, byte-equivalent: the gate, Delete… + `DeleteBusinessDialog` (open state now local to the detail), the email branch, `TestAccountCleanupPanel key={user.id} lockedEmail={user.email} tone="admin-dark"`, the no-email sentence lifted to `text-slate-400` (T-5). `onRemoved` / `onDeleted` call `void refreshList();` (the page passes `refreshList={fetchUsers}`) |

The `motion.div` expand animation goes (the drawer slides in; framer-motion is no longer imported by the page, which also ends the jsdom "window.scrollTo" noise L-4a recorded). The loading spinner becomes `AdminLoading` with `what="the business details"` ("Reading the business details…"; no test pins the old words).

**Drawer title:** the business name when the row has one, else the person's name as the row shows it (`rowToggleName`); suffix: the short id (`formatShortId`), so the dialog's accessible name is, for example, "Acme Therapy 99999999…". Test id `users-drawer`.

### 2.7 Decision: the audit section starts collapsed (user request, 2026-10-11)

- `DrawerSection "Audit trail"` (test id `detail-audit`), heading as usual. Its first child is one button, test id `detail-audit-toggle`, text **"Show audit events"** / **"Hide audit events"**, `aria-expanded`, `aria-controls` pointing at the folded part (`useId`). `ADMIN_BUTTON` style, purple focus ring (A-1).
- **Collapsed by default, every time an account is opened** (state local to the section; the drawer body unmounts on close, so a reopen starts collapsed).
- The folded part holds what the block shows today, unchanged in data: the event-type select (now with a visible label "Event type", purple ring instead of blue, its `stopPropagation` dropped because the drawer sits under no row), `ArchivedBeforeNotice`, and the list (up to 50 entries, "No audit logs found" when none). The select's value stays in the page's per-account map, so a chosen filter survives a reopen as today.
- **The fold is always rendered (SA M-2).** `ArchivedBeforeNotice` reads `/api/admin/archiving` on mount (`useLatestArchiveCutoff`), so mounting the fold on expand would send a request. The fold is one container that is always in the document (`id` from `useId`, `hidden={!expanded}`), its children always mounted; `aria-controls` therefore always resolves.
- **Data is read exactly as today**: the audit read is one of the three opening reads, whether or not the section is expanded, and the archive cutoff is read once per open, as per expand today. Expanding or collapsing sends nothing.
- In the list: time as `formatUtc` (was local date + local time); severity as `StatusChip` with the Audit trail mapping (critical → danger "Critical", warning → warn "Warning", info → info "Info", anything else → unknown); label text off `text-slate-500` (T-5).

---

## 3. Implementation Approach

### 3.1 `app/admin/users/useBusinessDetails.ts` (new, page-folder hook)

`useBusinessDetails(logger)` owns `loginStats`, `auditLogs`, `detailedStats`, `loading` (all `Record<string, …>` keyed by account id), `auditFilters` + `setAuditFilter(id, value)`, and `loadDetails(user)`: the body of today's `handleViewUserDetails` minus the toggle, with the §2.4 table applied (three `fetch` calls in one `Promise.all`, `readJsonBody` per body, status first). Exports `UNREADABLE_STATS` for the tests' reference only if needed (otherwise module-private). No `.json(`; no `console`; no `lib/business-os` import. The cache check reads the current maps, so the hook keeps today's "skip when all four parts are held" rule exactly.

A hook rather than more lines in `page.tsx` so the page drops to about 650 lines and the read rules sit in one file the registry and the guards can name. It is page-local (not in the shared folder), so it is not a new shared pattern.

### 3.2 `app/admin/users/components/BusinessDetail.tsx` (new)

Props: `user: User`, `loginStats?: UserLoginStats`, `detailedStats?: UserDetailedStats`, `auditLogs: AuditLogEntry[]`, `auditFilter`, `onAuditFilterChange`, `isLoading: boolean`, `refreshList: () => Promise<void>`. Holds `SHOW_AD1_DELETE_ENTRY = false` (with the AU-2 comment) and the delete-dialog open state. Renders §2.6. `'use client'`.

### 3.3 `app/admin/users/components/BusinessAuditSection.tsx` (new)

Props: `logs`, `filter`, `onFilterChange`. Holds the collapsed state, `getFilteredAuditLogs`, `formatActionName`, the severity map. Renders §2.7.

### 3.4 `app/admin/users/usersFormat.ts` (new, pure)

`ageLine(iso)` (today's `listAge`, renamed because the detail uses it too; same 1 / 24 cut-offs, never a locale date), `formatCost`, `formatNumber` (moved unchanged from `page.tsx`). No comparison the credit-band guard refuses.

### 3.5 `app/admin/users/types.ts` (modified)

Gains `AdminUserRow` (today's page-local `User`), `UserLoginStats`, `UserDetailedStats`, `AuditLogEntry` (its two `any` fields become `unknown`: neither is read by the screen; removes two of the three pre-existing ESLint `any` warnings) and `AuditEventFilter = 'all' | 'login' | 'security' | 'settings'` (replaces the `as any` cast on the select, the third warning). Type-only, still imports nothing.

### 3.6 `app/admin/users/page.tsx` (modified)

- Imports: drop `motion`, the detail-only icons, `ArchivedBeforeNotice`, `DeleteBusinessDialog`, `TestAccountCleanupPanel`, `BusinessOsPanel`, `ChevronDown` / `ChevronUp`; add `AdminDrawer`, `OpenRowButton`, `BusinessDetail`, `useBusinessDetails`, `ageLine`.
- State: `isOpen`, `openId`, `opener` ref; the maps from the hook; `selected` by id among the rows on screen; the close-when-gone effect; `openRow(user, button)` = set opener, `openId`, `isOpen`, then `void loadDetails(user)`; `returnFocus`.
- Row: first cell `flex items-start gap-3` with `OpenRowButton` then the business / name / short id block; the `tr` keeps `onClick` and `cursor-pointer` under the D-17 rules (§2.3: ignore controls and text selection, opener = the row's Open button, nothing on the `tr` for keyboard or ARIA); the open row tinted; Login Activity cell: count `text-slate-200`, tick icon dropped, failed count kept red (a failure is not decoration), "Click to load" unchanged (F-23, the user's); Actions column removed (Q-2 (b)).
- The table body re-indented to its real depth (§2.1 item 10).
- After the content wrapper: the single `AdminDrawer` (§2.1 item 1).
- `fetchUsers` unchanged (identity, query ref, newest-wins, focus fallback of L-4a). It is passed as `refreshList`.

### 3.7 What does not change

`BusinessOsPanel`, `CreditsBlock`, `CreditFormDialog`, `BoostBlock`, `BoostCapDialog`, `BoostReconcileDialog`, `DeleteBusinessDialog`, `TestAccountCleanupPanel`, `CreditsLeftCell`, `UserNameLine`, `BusinessesKpis`, `usersFilters.ts`, every route, `components/ui/*`, every file in `app/admin/components/layout/` (source), the list read, filters, tiles, bar, states and URL of L-4a.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/users/page.tsx` | modify | Drawer state and the page-level drawer; Open button in the first cell; row click and toggle removed; Actions column (Q-2); detail block, reads and detail helpers moved out; Login Activity cell greens (T-6); re-indent |
| `app/admin/users/components/BusinessDetail.tsx` | create | The drawer body (§2.6), the danger area and `SHOW_AD1_DELETE_ENTRY` |
| `app/admin/users/components/BusinessAuditSection.tsx` | create | The collapsed audit section (§2.7) |
| `app/admin/users/useBusinessDetails.ts` | create | The three reads on `readJsonBody`, the per-account maps, the cache rule (§2.4) |
| `app/admin/users/usersFormat.ts` | create | `ageLine`, `formatCost`, `formatNumber` shared by the list and the detail |
| `app/admin/users/types.ts` | modify | The row, detail and audit types (§3.5) |
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | create | §6.1 |
| `app/admin/components/__tests__/ArchivedBeforeNotice.render.test.tsx` | modify | N-4 read the notice's use in `users/page.tsx`; it now reads `BusinessAuditSection.tsx` (Implementation Notes deviation 3) |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | §5.1 |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | modify | §6.2 |
| `app/admin/users/__tests__/businessesLayout.render.test.tsx` | modify | §6.2 |
| `app/admin/users/__tests__/defaultFilter.render.test.tsx` | modify (Q-2 (b) only) | §6.2 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | One registry entry, no rule change (§5.2) |
| `app/admin/components/layout/OpenRowButton.tsx` | modify (comment only) | SA S-1: the doc comment says the button is the keyboard path and a page may add a row click as a mouse extra under D-2 (Businesses, D-17). No prop, export or behaviour change |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 9a, §7.7 as-built, §9 (F-23 / F-24 notes, new F-105 / F-106, L-4a's Login Activity green item), §12.3 ticks for Businesses, Change History |
| `docs/workplans/ADMIN_LAYOUT_L4B_WORKPLAN.md` | create | This file |

No file under `app/api/`, `lib/`, `components/` or `supabase/` is touched. In `app/admin/components/layout/` only the `OpenRowButton.tsx` doc comment (S-1) and the guard's registry entry change. No import from `lib/business-os/entitlements/` (type-only included) is added anywhere.

---

## 5. Guard and registry changes

### 5.1 `users/__tests__/source.guard` (deliberately re-expressed, intent kept)

| Today (in `page.tsx`) | After (intent) |
|---|---|
| `SCREEN_FILES` list | Gains `components/BusinessDetail.tsx`, `components/BusinessAuditSection.tsx`, `useBusinessDetails.ts`, `usersFormat.ts`, so the console, `lib/business-os`, call-catalog and repository rules cover them. The "one file imports the band module" case then covers them too |
| `{isExpanded && (` → `danger-area` → `DeleteBusinessDialog`: "opened from the expanded row only, inside the danger area" | **Page side:** `page.tsx` has exactly one `<AdminDrawer`, exactly one `<BusinessDetail`, and the `<BusinessDetail` sits between `<AdminDrawer` and `</AdminDrawer>`; the drawer's `open=` is `{isOpen && selected !== null}`; `page.tsx` contains no `<DeleteBusinessDialog`, no `<TestAccountCleanupPanel`, no `data-testid="danger-area"` and no `SHOW_AD1_DELETE_ENTRY` (so no row can carry a danger area); the page passes `refreshList={fetchUsers}`. **Detail side** (`BusinessDetail.tsx`): one `<DeleteBusinessDialog`; `danger-area` found; `<DeleteBusinessDialog` and `delete-business-open` after it; `onDeleted` body `void refreshList();` |
| AU-C5: `const SHOW_AD1_DELETE_ENTRY = false;` exactly once; gate after `danger-area`; button and dialog after the gate; dialog before the panel | Same assertions, read from `BusinessDetail.tsx` |
| AU-C2 / C3: panel import line in the page; no `cleanupApiTypes`; one panel, after `danger-area`; `key={user.id}`, `lockedEmail={user.email}`, `onRemoved` body; `{user.email ? (` right before | Same assertions, read from `BusinessDetail.tsx`, with the body `void refreshList();`. The page imports neither the panel nor `cleanupApiTypes` |
| AU-C4: no DB function name in the page and the panel | File list gains `BusinessDetail.tsx` |
| Panel-words case on `page.tsx` | Unchanged (the moved user card no longer sits in `page.tsx`, so the DV-1 exclusions become unnecessary; the words list stays as is to keep the diff small) |

**Exact strings (SA M-3).** Detail side, read from `BusinessDetail.tsx` (comments removed by `codeOf` unless stated):

- `const SHOW_AD1_DELETE_ENTRY = false;` exactly once (same regex as AU-C5 today).
- Order: `data-testid="danger-area"` → `{SHOW_AD1_DELETE_ENTRY && (` → `data-testid="delete-business-open"` and `<DeleteBusinessDialog` → `{user.email ? (` → `<TestAccountCleanupPanel`; exactly one `<DeleteBusinessDialog` and one `<TestAccountCleanupPanel`.
- Panel props: `key={user.id}`, `lockedEmail={user.email}`; `{user.email ? (` is the last thing before the panel (same regex as today).
- The exact panel import line `import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';`; no `cleanupApiTypes`.
- `onDeleted` and `onRemoved` bodies `void refreshList();`, each with its comment carried word for word, matched on the raw source: `// FR-A9: after a deletion the row reads "No Business OS business".` and `// AU-C2: CLEAN only, once the admin clicks Done (or the panel unmounts); the row leaves the list.`
- `refreshList(` appears exactly twice in the code (the two bodies).

Page side, read from `page.tsx`: exactly one `<AdminDrawer`, exactly one `<BusinessDetail`, and the `<BusinessDetail` sits between `<AdminDrawer` and `</AdminDrawer>`; `open={isOpen && selected !== null}`; `refreshList={fetchUsers}` exactly once; no `<DeleteBusinessDialog`, no `<TestAccountCleanupPanel`, no `DeleteBusinessDialog` or `TestAccountCleanupPanel` name at all, no `data-testid="danger-area"`, no `SHOW_AD1_DELETE_ENTRY`, no `cleanupApiTypes`. AU-C4 covers `page.tsx`, `BusinessDetail.tsx` and the panel. Each old assertion maps to one new one; the map is in Implementation Notes.

The "never the collapsed row" half of the old position check is also pinned by render (§6.1 D-1: with no drawer open, the document has no `danger-area`, no cleanup panel, no `bos-panel`).

### 5.2 `layoutFolder.guard` registry

New entry, no rule change: `/admin/users (Businesses)` with files `app/admin/users/page.tsx`, `usersFilters.ts`, `useBusinessDetails.ts`, `usersFormat.ts`, `components/BusinessesKpis.tsx`, `components/BusinessDetail.tsx`, `components/BusinessAuditSection.tsx`. Comment: the panel, credit, boost and delete components are deliberately **not** listed: each still reads its own route with `.json(` (`BusinessOsPanel`, `CreditsBlock`, `CreditFormDialog`, `BoostBlock`, `BoostCapDialog`, `BoostReconcileDialog`, `DeleteBusinessDialog` 2) and their error copy is pinned by their own render and contract tests; converting them is not a layout change (the Audit trail picker precedent, G-6). **Q-5** asks SA to confirm the list.

### 5.3 Unchanged

`creditBands.guard`, `creditFigures.fromConfig.guard` (run over the new files), `admin-authz-surface.guard` (no new route or page file; `BusinessDetail.tsx` is not a special-file name), `tailwind-css-escape.guard` (no backslash in any new file or doc).

---

## 6. Tests

### 6.1 New: `app/admin/users/__tests__/businessDetail.render.test.tsx`

jsdom; the `businessesLayout.render` harness (logger mock with `createLogger`, `next/navigation` mocked with a settable search string); a routed fetch mock that records every URL and method; fixtures for login stats, audit logs (three entries: a login, a password change, a settings change, severities info / warning / critical), stats, the panel's two routes and the credits route (recorded bodies reused from `businessOsPanel.render`).

| # | Case |
|---|---|
| D-1 | Mount: no dialog in the document; no `danger-area`, no cleanup panel, no `bos-panel` anywhere (the "never the collapsed row" intent) |
| D-2 | Each row's first cell holds one button named "Open details for Dana Cohen" with the visible word "Open"; the `tr` has no `tabindex` and no `role` (D-17 rule 1); six headers, no "Actions" (Q-2 (b)) |
| D-3 | Open: exactly one dialog, named "Acme Therapy 99999999…"; exactly one request each to `login-stats`, `audit-logs`, `stats`, and exactly one `/api/admin/archiving` read (as per expand today, SA M-2); "Reading the business details…" while they are pending; then the blocks in order: `bos-panel`, "User information", "Account timeline", "Security", "Login activity", `plugins-card`, `ai-spend-card`, `detail-audit`, `danger-area` (document order) |
| D-4 | A row with no business: title is the person's name; a row with no name: the email |
| D-5 | Timeline: Created "2026-09-01 00:00 UTC" with an age line; a null sign-in reads "Never"; no locale date string |
| D-6 | **Audit collapsed by default (user request; SA M-2):** `detail-audit-toggle` named "Show audit events", `aria-expanded="false"`, `aria-controls` names the fold, which is in the document and carries `hidden`; the "Event type" select is not reachable by role and none of the three events is visible. Click → "Hide audit events", `aria-expanded="true"`, the fold loses `hidden`, the three events, the select and the archive notice show. Click again → collapsed, `hidden` back. **No request to any URL is sent by either click** |
| D-7 | Audit, expanded: the event-type select (label "Event type") filters to the login event; severities render as chips with words "Critical", "Warning", "Info"; times as "YYYY-MM-DD HH:mm UTC"; close and reopen: the section is collapsed again and, once expanded, the select still shows the chosen filter (page map, as today) |
| D-8 | **Close returns focus to the opener:** Escape → the dialog is gone and `document.activeElement` is Dana's Open button; same for the X button |
| D-9 | **Open row disappears** (L-1d B-1): drawer open, Refresh answers a list without Dana → the dialog closes, focus is on `users-content`, never `<body>`; Refresh again with Dana back → the dialog stays closed; Open still opens it |
| D-10 | **Drawer outside every branch** (L-2b M-4): drawer open, Refresh fails (500) → the dialog closes through its `open` prop, the error shows, focus is on `users-content` |
| D-11 | **Nested dialog Escape order (SA M-5):** open Dana; click `credits-give` → a second dialog; Escape → only the credit dialog closes, `users-drawer` is still in the document and still open, and the focused element is `credits-give` inside it; Escape again → the drawer closes and focus is on Dana's Open button. No POST was sent at any point |
| D-12 | Same as D-11 for the boost spending-limit dialog (opened from `boost-block`), when the boost route answers a business with top-ups enabled: after the first Escape focus is on the boost dialog's trigger inside the still-open drawer, after the second on Dana's Open button; no POST. An overlay click on the nested dialog stays browser check B-6 (jsdom cannot express Radix's pointer-down-outside on the overlay faithfully) |
| D-13 | **No extra fetch on reopen when cached (QA-P8 / O-3):** open, close, reopen → still exactly one request each to `login-stats`, `audit-logs`, `stats`; the panel's two routes are read again (the panel remounts, as collapse-and-reopen did, SA L-4a N-1) |
| D-14 | Reopen after a failed stats read reads `stats` again (the QA-P8 failing half, through the drawer) |
| D-15 | **Per-section parse failures (§2.4):** login-stats answers `ok` with an HTML body → the Login activity section is absent, the plugins and AI spend sections show their data, the audit events show when expanded; reopen reads `login-stats` again. Audit answers `ok` with an HTML body → expanded shows "No audit logs found", and a reopen reads `audit-logs` again (never cached as empty) |
| D-16 | Danger area: the cleanup panel is mounted once, inside `danger-area`, locked to `dana@example.com`; a row without an email shows "This login has no email, so it cannot be removed here."; no `delete-business-open` (gate off) |
| D-17 | Closing the drawer unmounts the cleanup panel (it is no longer in the document), as collapsing the row did |
| D-18 | The Login Activity cell: "Click to load" before opening; after opening, "1 logins" with the count not in a green class; a failed count stays red |
| D-19 | Plugins: an inactive plugin chip carries the word "inactive"; no `bg-green-400` in the drawer |
| D-20 | Headings: exactly one `h1` on the page (counted with `querySelectorAll`, SA S-6: the header is `aria-hidden` while the modal is open); inside the dialog, the title is the only `h2`; every `DrawerSection` has exactly one heading (L-1d M-4) |
| D-21 | **Row click (D-17):** a click on a non-interactive part of a row (the business name, the Contact cell, the Credits left cell) opens the drawer with exactly one request each to the three reads; Escape returns focus to **that row's Open button** |
| D-22 | A click on the Open button sends exactly one request each to the three reads (the row handler ignored it, rule 2) |
| D-23 | A non-collapsed selection inside the row (`window.getSelection` mocked) → a row click opens nothing and sends nothing; a selection outside the row does not block it (rule 3) |
| D-24 | Keyboard: focus the Open button, press Enter → the drawer opens (rule 5) |

### 6.2 Edited deliberately (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `businessOsPanel.render` `openRowWithStats`, P-6c, QA-P7 | **No edit (SA M-1):** their `row-business` clicks are now the D-17 row-click path and keep it tested | — |
| `businessOsPanel.render` QA-P8 | **Only the close step changes (SA M-4):** "close" = Escape on the dialog; "reopen" stays the row click; the request-count assertions byte-identical. A row click on an open row is never used as "close" (it is a reopen, never a toggle) | Same rule (O-3), through the drawer |
| `businessOsPanel.render` P-5 | `getByText('User ID:')` → `getByText('User ID')` inside the dialog | Field labels drop the colon (§2.6) |
| `businessOsPanel.render` P-4 | `getByRole('banner')` → the h1's enclosing `header` (`getByRole('heading', { level: 1 }).closest('header')`) | SA L-4a code review comment 1: a `<header>` is a banner only outside a landmark; once a dialog has been open, Radix's `aria-hidden` on siblings also hides it from role queries. Scoping by the h1 holds in both |
| `businessesLayout.render` U-10 "the row toggle is named for the person…" | Becomes "the Open button is named for the person": `Open details for Dana Cohen`, visible "Open", no `aria-expanded`; the S-4 fallback case unchanged | The toggle is gone |
| `businessesLayout.render` U-10 headers | Six headers (Q-2 (b)) | Q-2 |
| `businessesLayout.render` U-12 | The opening row click stays (D-17 path). The request-count assertions stay byte-identical (SA M-4); the Refresh button and the "settled" wait are found with `hidden: true` while the modal drawer is open (Radix sets `aria-hidden` on the page), and the case also asserts the dialog is open after Refresh and gone after the status change. U-12 has no close step: the status change that drops the row is the close | Same behaviour, now a modal drawer |
| `defaultFilter.render` "seven columns in all" and "the empty state spans all seven columns" | Six headers (no "Actions"); `colspan` equal to the number of `columnheader`s and the literal `6`; names say six; the no-Status / no-Auth-role assertions unchanged | Q-2 (b) |
| `source.guard` | §5.1 | The detail moved |
| `layoutFolder.guard` | §5.2 | Registry |
| `ArchivedBeforeNotice.render` N-4 | Reads `users/components/BusinessAuditSection.tsx` instead of `users/page.tsx` | The audit block moved (found at implementation) |

### 6.3 Must stay green with no edit

`creditsBlock.render`, `boostBlock.render`, `boostBlock.actions.render`, `deleteBusinessDialog.render`, `creditsLeftCell.render`, `userNameLine.render`, the three contract tests, every `businessesLayout.render` case not listed above (U-1 to U-9, U-11, U-13 including the mount pin U-7b), every `defaultFilter.render` case not listed above, the `BusinessOsPanel` component cases, the `TestAccountCleanupPanel` suites, every shared-folder suite (no source change there), Audit trail, AI cost & usage, Archiving, Health and Jobs suites, `creditBands.guard`, `creditFigures.fromConfig.guard`, the authz surface guard.

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-1 | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics app/admin/archiving app/admin/__tests__ app/admin/components/__tests__ components/business-os/purge lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts app/api/admin/users lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | All green; suite and test counts recorded |
| V-2 | `npm run test:bos-entitlements` (covers `app/admin/users/__tests__`) | Green |
| V-3 | `npx jest app/api/admin/users --ci` | Green, untouched |
| V-4 | Scoped `tsc`: scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`; includes `next-env.d.ts`, `app/admin/users/**`, `app/admin/components/layout/**`, `components/ui/dialog.tsx`, `components/ui/sheet.tsx`, `components/business-os/purge/TestAccountCleanupPanel.tsx`, `app/admin/components/ArchivedBeforeNotice.tsx`. **Run 1** with a canary file **in the scratchpad** (`const canary: number = 'x';`, no worktree edit) → exactly that TS2322. **Run 2** without it → no error | As stated |
| V-5 | `npm run lint:hooks`; `npx eslint` on every touched and new file | Clean; no warning on a touched line; the three pre-existing `any` warnings of `page.tsx` gone (§3.5) |
| V-6 | Mutation checks (harness in the scratchpad; each applied, the named tests run, restored, md5 compared): (a) empty the close-when-gone effect → D-9; (b) replace the focus fallback with `opener.current?.focus()` → D-9, D-10; (c) pass a no-op `onReturnFocus` → D-8; (d) start the audit section expanded → D-6; (e) let the toggle's click call `loadDetails` → D-6 "no request"; (f) drop the cache check in `loadDetails` → D-13 and QA-P8; (g) treat unreadable stats as cached (skip the null check) → D-14 and QA-P8; (h) store `[]` for an unreadable audit body → D-15; (i) restore one shared `try` around all three body reads (a parse failure skips the rest) → D-15; (j) key `BusinessDetail` by `readAt` → U-12; (k) add a page-level `keydown` listener that closes the drawer on Escape → D-11; (l) move `<DeleteBusinessDialog` above the gate in `BusinessDetail.tsx` → `source.guard` AU-C5; (m) change `onRemoved` to call nothing → `source.guard` AU-C2; (n) put one `.json(` back in `useBusinessDetails.ts` → the registry case; (o) render the drawer inside the `!error && hasLoaded` branch → D-10; (p) drop the interactive-child check in the row handler → D-22; (q) drop the selection check → D-23; (r) pass the `tr` as the opener on a row click → D-21 focus; (s) render the audit fold's children only when expanded → D-6 | Each fails as stated |
| V-7 | `grep` `app/admin/users/page.tsx` for `.json(` (0), `isExpanded` (0), `motion` (0), `formatDate` (0), `text-slate-500` (0), `text-green-` (0); the new files for `console.` (0) and `lib/business-os` (0) | As stated |
| V-8 | `git status --short` + `git diff --stat` **before** reading the diff (truncation hazard) | Insertions and deletions match §4; no file emptied; no deletion-only file other than the moved block in `page.tsx` (its counterpart insertions are in the two new components) |
| V-9 | CSS-escape rule over the changed files; no backslash in this workplan or the requirement | Clean |

### 7.1 Browser checks for TL / QA (signed-in admin, DevTools Network open, light and dark OS-scheme emulation)

> **Production rule: never submit** a grant, take-back, spending limit, reconcile, cleanup or deletion. Open, inspect, close with Escape, Cancel or X only.

| # | Check |
|---|---|
| B-1 | `/admin/users`: each row's first cell shows an "Open" button before the business name; a click on a blank part of a row opens it (D-17); drag-selecting a row's text does not; one click on Open sends one set of `login-stats` / `audit-logs` / `stats` reads; six columns, no Actions (Q-2 (b)) |
| B-2 | Open a business: the drawer slides in from the right, dark in both schemes, title "Business name" plus the short id; exactly one `login-stats`, `audit-logs`, `stats` request plus the panel's reads; "Reading the business details…" then the blocks in order (Business OS panel first, danger area last) |
| B-3 | The audit section shows only "Show audit events"; expanding shows the filter, the archive note and the events with no new request; collapsing hides them; close and reopen: collapsed again |
| B-4 | Escape, the X and an overlay click each close the drawer and focus lands on that row's Open button (visible purple ring) |
| B-5 | Give credits: the dialog opens on top of the drawer; Tab stays inside the dialog; Escape closes **only** the dialog, focus returns to "Give credits" inside the drawer; a second Escape closes the drawer. Same for Take back and, where a business has top-ups, the spending-limit and reconcile dialogs. **Never submit** |
| B-6 | A click inside an open credit dialog does not close the drawer behind it; a click on the dimmed area outside both closes the dialog first (Radix top layer), not the drawer |
| B-7 | The cleanup panel inside the danger area renders as before; Delete… is not shown. **Never run a cleanup** |
| B-8 | With a business open, close it, reopen it: no second `login-stats` / `audit-logs` / `stats` request (cached), the panel reads again |
| B-9 | Login Activity column: "Click to load" for an unopened business; the count after opening, not green |
| B-10 | Narrow window (about 700 px): the drawer is full width, scrolls vertically, the X stays reachable |
| B-11 | Light-scheme emulation: drawer close X `rgb(203, 213, 225)` with opacity 1 and a purple focus ring; dialog X the same on top of it |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding (M-1 to M-5 applied: §2.3, §2.7, §3.6, §4, §5.1, §6.1, §6.2, §7 V-6 / B-1, §10, §11)
- [x] 2. `types.ts` (row, detail and audit types; `unknown` for the two unread fields; `AuditEventFilter`)
- [x] 3. `usersFormat.ts` (`ageLine`, `formatCost`, `formatNumber`)
- [x] 4. `useBusinessDetails.ts` (§2.4, cache rule unchanged)
- [x] 5. `BusinessAuditSection.tsx` (§2.7)
- [x] 6. `BusinessDetail.tsx` (§2.6, danger area, `SHOW_AD1_DELETE_ENTRY`)
- [x] 7. `page.tsx`: drawer state, close-when-gone, focus return, Open button, row click (Q-1), Actions column (Q-2), Login Activity cell, re-indent, the page-level drawer
- [x] 8. `source.guard` re-expressed (§5.1); `layoutFolder.guard` registry (§5.2)
- [x] 9. `businessDetail.render` D-1 to D-24; the §6.2 edits
- [x] 10. V-1 to V-9; results in Implementation Notes
- [x] 11. Requirement: §1 row 9a, §7.7 as-built, §9 (F-23 / F-24 notes, F-105, F-106, the Login Activity green item done), §12.3 for Businesses, Change History
- [ ] 12. Hand to SA code review and QA (nothing committed by Dev)

---

## 9. Sizing

| Part | Days |
|---|---|
| Types, format helpers, `useBusinessDetails` with the §2.4 edges (tasks 2-4) | 0.5 |
| `BusinessAuditSection` and `BusinessDetail` (tasks 5-6) | 0.75 |
| Page wiring, drawer state, Open button, column and cell changes (task 7) | 0.5 |
| Guards and registry (task 8) | 0.25 |
| New suite D-1 to D-20 and the edits (task 9) | 0.75 |
| Verification, mutations (a) to (p), docs (tasks 10-11) | 0.5 |
| **Total** | **about 3 days** |

At the top of the outline's 2.5 to 3 days: the nested-dialog cases (D-11, D-12) and the per-section parse edges (D-15) are the parts the outline did not cost. No split is proposed: the guards, the drawer and the reads move together or the position guard fails in between.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A nested dialog's Escape also closes the drawer | Radix layer stack (§1.2); D-11 / D-12 pin it; mutation (k); B-5 / B-6 in a browser |
| Focus is lost when the open account leaves the list (cleanup Done, a status change by Back / Forward) | Close-when-gone effect + content-wrapper fallback (L-1d B-1); D-9 / D-10; mutations (a), (b), (o) |
| The drawer's modal `aria-hidden` hides the page from role queries in tests | Tests that query the page while the drawer is open close it first, or scope inside the dialog; P-4 rescoped (§6.2) |
| Moving the detail breaks a guard's intent silently | Each position assertion is re-expressed with the same order and bodies (§5.1), plus a render pin for "never on the collapsed row" (D-1); mutations (l), (m) |
| A late answer for account A shows under account B | Every result is stored under its own account id and the drawer reads the open id's slot; no shared "current" state to overwrite |
| Changing parse-failure edges hides a section that showed before | §2.4 table: only sections that were skipped by another section's parse failure change, and they now show their own data; D-15 pins both directions |
| The cleanup panel's "report on unmount" fires a list read while the drawer closes | Same as collapsing the row today; the read lands, the row may leave, and focus falls back (D-9) |
| A row click fires on a control or a text selection (D-17) | Rules (2) and (3) of §2.3: the handler ignores any click whose target sits in a button, link, form control, label, summary or `role="button"` / `role="link"` / contenteditable inside the row, and any click while a non-collapsed selection touches the row; D-22 / D-23; mutations (p), (q) |
| Focus returns to the `tr` or nowhere after a row-click open | Rule (4): the opener is always that row's Open button; D-21; mutation (r) |
| `creditBands.guard` scans the new files | No comparison against its values (the age helper uses 1 and 24; the audit list `slice(0, 50)`) |

---

## 11. Out of scope and found on the way

- **F-23** ("Click to load" in Login Activity) and **F-24** (two AI spend blocks): the user's; kept as they are. With the whole-row click kept (D-17), "Click to load" is literal again.
- **F-25** (`formatCost` 4 decimals), **F-27** (100-row cap): open, unchanged.
- The panel, credit, boost and delete components keep their own `.json(` reads (§5.2); not a layout change.
- `TestAccountCleanupPanel` renders a named `<section>` (a region landmark) inside the drawer: an existing shared Business OS component outside the admin folder; A-9 binds the admin layout components only. Recorded, not changed.
- New findings for §9 at implementation:
  - **F-105** (UX, open): a failed login-stats or audit read is not stated in the detail: Login activity is simply absent, and the audit section says "No audit logs found". Pre-existing; L-4b keeps it (stating it would be new copy and a new state; its own small slice if wanted).
  - **F-106** (data, open): closing and reopening an account while its first reads are still running starts a second set of the three reads, and the first set's end clears the loading state early. Pre-existing (collapse and re-expand did the same); harmless because both sets write the same account's slots.
  - **F-107** (data, open; SA N-1): if the drawer is closed (Escape) while a cleanup delete is in flight, the panel unmounts before it sets `cleanPending`, so `onRemoved` never fires and the deleted account stays listed until the next Refresh. Pre-existing (collapsing the row did the same); a shared Business OS component outside the admin folder, its own slice if wanted.
  - L-4a's "Login Activity cell uses green" item: **done L-4b** (T-6).

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Rows open only through the Open button (L-1d Q-10), so the Businesses row loses its whole-row click? | Yes: same rule as Audit trail and AI cost & usage, one tested path, no clickable `tr` around a button. **Superseded by the user's decision D-17 (2026-10-11): "Whole row clickable".** On Businesses a click anywhere on a row also opens the drawer; the Open button stays the keyboard path and the focus-return target. A recorded page deviation from L-1d Q-10 (§5.8 D-2 allows it). Design rules: SA Workplan Review, ruling Q-1 |
| Q-2 | The Actions column once the toggle goes: (a) keep it with an em dash (pins untouched); (b) remove it (six columns; the seven-column and `colspan=7` pins edited, intent kept); (c) Open button there (refused, Q-16) | (b): an always-empty column breaks §5.7 and reads as a missing control; Q-16's aim (Open in the first cell, no new column) still holds |
| Q-3 | No `useDrawerResource` in L-4b (§2.2): reads stay page-owned in a page-folder hook, because their results feed the list's Login Activity column and the reopen cache; the hook stays with L-8? | Yes (R-6 as ruled). Path: UI short path by R-7, run with your workplan and code review under the fast-track |
| Q-4 | The §2.4 error edges: a non-JSON body affects only its own section (today it skips the others); an unreadable audit body is never cached as empty | Yes; it is the only behaviour change in the reads, and D-15 pins it |
| Q-5 | Registry entry lists the page's own seven files and leaves the panel, credit, boost and delete components out (they keep their own `.json(` reads, as the Audit trail picker was left out under G-6)? | Yes |
| Q-6 | Block restyle (§2.6): page-owned blocks on `DrawerSection` / `DrawerFields` with the label words kept and colons dropped; detail times on `formatUtc` + age line; audit severity on `StatusChip`; inactive plugins say "inactive"; decorative greens removed; the danger area keeps its own rose frame | Yes; all display-only, §5.8 D-5, §5.9, §5.11, A-7, T-5, T-6 |
| Q-7 | Audit section (user request): one "Show / Hide audit events" button as the section's first child (not a button inside the `h3`, which would need a shared `DrawerSection` change and a full cycle); the filter select folds with the list; collapsed on every open; the chosen filter still remembered per account | Yes |
| Q-8 | Drawer title = business name, else the person's name; suffix = short id | Yes |

### Product question for the user (via TL, plain words)

**Answered by the user 2026-10-11 (D-17): "Whole row clickable".** The text below is kept as it was asked.

None needed for the build. One thing the user will notice and may want to weigh in on, depending on SA's ruling on Q-1: **today an admin can click anywhere on a business row to open it; after this change only the "Open" button at the start of the row opens it** (the same as the Audit trail page). If the user would rather keep the whole-row click, it is a two-line difference.

---

## Implementation Notes

**Dev, 2026-10-11. Code complete, uncommitted** on `feature/admin-layout-l4b` (worktree `neuronforge-admin-layout`, merged with origin/main 3c709fe5, which carries L-4a #300). Nothing committed or stashed.

### What was built

| File | Result |
|---|---|
| `app/admin/users/page.tsx` | 1,249 → 662 lines. Drawer state the L-1d way (`isOpen`, `openId`, opener ref), `selected` looked up among the rows on screen, the close-when-gone effect, `returnFocus` (opener if connected, else `users-content`). `OpenRowButton` (`row-open`) in the first cell; the D-17 row click (`handleRowClick`: ignores `ROW_CONTROL_SELECTOR` targets inside the row and a selection touching the row, opener = that row's Open button); Actions column removed (six columns, `colSpan={6}`); Login Activity count `text-slate-200` with no tick, failures red; table body re-indented to its real depth. One `AdminDrawer` (`users-drawer`) after the content wrapper, `open={isOpen && selected !== null}`, `<BusinessDetail key={selected.id} … refreshList={fetchUsers} />`. `framer-motion`, `formatDate`, `listAge`, the detail types and the detail helpers are gone from the page |
| `app/admin/users/components/BusinessDetail.tsx` (new) | §2.6 blocks in order; `AdminLoading what="the business details"`; danger area byte-equivalent (gate, Delete… + dialog with local open state, email branch, panel), `SHOW_AD1_DELETE_ENTRY = false` with the AU-2 comment; `onDeleted` / `onRemoved` bodies `void refreshList();` with their comments word for word |
| `app/admin/users/components/BusinessAuditSection.tsx` (new) | `DrawerSection "Audit trail"` (`detail-audit`), the toggle (`detail-audit-toggle`, `aria-expanded`, `aria-controls`), the fold always mounted with `hidden` (SA M-2), "Event type" select (no cast), `ArchivedBeforeNotice`, up to 50 events with `formatUtc` times and the Audit trail severity chip mapping |
| `app/admin/users/useBusinessDetails.ts` (new) | The three reads, `readJsonBody` per body with the status first (§2.4), the cache rule unchanged, the S-2 facts-only line (`{ section, status }`, "User detail body could not be read") for an unreadable `ok` body; `useCallback` with honest deps (S-3); logger module name `AdminUsersPage` |
| `app/admin/users/usersFormat.ts` (new) | `ageLine` (was `listAge`, 1 / 24 cut-offs only), `formatCost`, `formatNumber` |
| `app/admin/users/types.ts` | `AdminUserRow`, `UserLoginStats`, `UserDetailedStats`, `AuditLogEntry` (`changes` / `details` now `unknown`), `AuditEventFilter` |
| `app/admin/components/layout/OpenRowButton.tsx` | Doc comment only (S-1) |

### Verification (real output)

| # | Result |
|---|---|
| V-1 | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics app/admin/archiving app/admin/__tests__ app/admin/components/__tests__ components/business-os/purge lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts app/api/admin/users lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` → **Test Suites: 85 passed, 85 total; Tests: 2163 passed, 2163 total** (the new suite has 28 cases) |
| V-2 | `npm run test:bos-entitlements` → **Test Suites: 236 passed, 236 total; Tests: 6601 passed, 6601 total** |
| V-3 | `npx jest app/api/admin/users --ci` → 6 suites, 92 tests passed (untouched) |
| V-4 | Scoped `tsc` (scratch tsconfig in the session scratchpad, `extends` the worktree tsconfig, `noEmit`, `incremental: false`; `next-env.d.ts`, `app/admin/users/**`, `app/admin/components/layout/**`, `components/ui/dialog.tsx`, `components/ui/sheet.tsx`, `TestAccountCleanupPanel.tsx`, `ArchivedBeforeNotice.tsx` and its test). **Run 1** with a canary file in the scratchpad only → exit 2, exactly one error: `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Run 2** without it → exit 0, no output |
| V-5 | `npm run lint:hooks` → clean. `npx eslint` on all 14 touched or new code files → no output (0 problems). The pre-change `page.tsx` had 3 `no-explicit-any` warnings (`:169`, `:170`, `:1089`); all three are gone |
| V-6 | Mutations (a) to (s): **all 19 red**, each restored, md5 of the four mutated files equal before and after (harness in the scratchpad). (a) D-9; (b) D-9, D-10; (c) D-8, D-9, D-10, D-11, D-12; (d) D-6, D-7; (e) D-6; (f) QA-P8, D-13; (g) QA-P8, D-14; (h) D-15b; (i) D-15a; (j) U-12; (k) D-11, D-12; (l) AU-C5; (m) AU-C2 / AU-C3; (n) the registry case for `useBusinessDetails.ts`; (o) **see deviation 2**: the page-side guard case; (p) D-22; (q) D-23; (r) D-21 ×3; (s) D-6 |
| V-7 | `page.tsx`: `.json(` 0, `isExpanded` 0, `motion` 0, `formatDate` 0, `text-slate-500` 0, `text-green-` 0. New files: `console.` 0, `lib/business-os` 0, `.json(` 0. `stopPropagation`: 1, the Delete… button's, carried byte-equivalent (S-4); no new one |
| V-8 | `git status --short`: 10 modified (the 7 code / test files of §4, `ArchivedBeforeNotice.render.test.tsx`, `OpenRowButton.tsx`, the requirement) and 6 new (4 code files, the new suite, this workplan). `git diff --stat`: 10 files, 463 insertions, 890 deletions; `page.tsx` 259 / 846 (the moved block, its insertions are in the new components). No file emptied, no deletion-only file. Line endings kept per file (CRLF files stay CRLF; LF files and the new files are LF, like the L-4a files) |
| V-9 | No backslash in this workplan or the requirement. The only backslashes in the new components (one line in each of `BusinessDetail.tsx` and `BusinessAuditSection.tsx`) belong to the word-boundary title-case regex moved from `page.tsx`; `tailwind-css-escape.guard` is green |

### Deviations

1. **SA M-5 built in part (escalated).** The first Escape on the credit dialog (D-11) or the spending-limit dialog (D-12) closes only that dialog and the drawer stays open (pinned), and the second Escape returns focus to the row's Open button (pinned). Focus does **not** return to `credits-give` / `boost-cap-set` after the first Escape: both dialogs are mounted by state with no Radix `DialogTrigger`, so Radix's modal close handler calls `triggerRef.current?.focus()` on a null ref and focus falls to `<body>` (the drawer's focus trap is paused under the nested dialog, and its mutation observer only watches its own subtree). This was equally true in the expanded row before L-4b. The fix is a change in `CreditsBlock.tsx` / `BoostBlock.tsx`, which this slice keeps unchanged (§3.7; TL: credit / boost flows identical), so it is recorded as **F-108** (requirement §9, disposition SA) and left for TL / SA. D-11 / D-12 pin what holds: the trigger is still in the open drawer, focus is on a connected node, no POST. B-5 will show the browser behaviour.
2. **Mutation (o) is caught by `source.guard`, not D-10.** Moving the drawer into the `!error && hasLoaded` branch unmounts it with the branch on a failed Refresh; in jsdom that is indistinguishable from closing through the `open` prop (same focus fallback, no dialog). The page-side guard case now also pins that, from the loaded branch's opening to `<AdminDrawer`, every brace and parenthesis is closed again. With that, (o) is red.
3. **One more pinned test edited:** `app/admin/components/__tests__/ArchivedBeforeNotice.render.test.tsx` N-4 ("both admin audit screens render it") read `users/page.tsx`; it now reads `users/components/BusinessAuditSection.tsx`. Same intent. Not in §6.2's list because §1.3 had missed it.
4. **U-12** finds Refresh with `hidden: true` while the drawer is open and waits on it directly instead of `settled()` (Radix hides the page from role queries under a modal); request counts byte-identical (M-4).
5. **No `h4` in the drawer sections.** The audit event's action name and "Cost by Model" are bold `p` text, not `h4`, so each `DrawerSection` keeps exactly one heading (D-20, L-1d M-4).
6. **Audit events are an `ul` / `li` list** (was a `div` stack), each with `data-testid="detail-audit-event"`; the layout is a 2 / 4-column grid sized for the drawer instead of the 12-column grid.

### Edited tests, with reasons

| Test | Edit | Reason |
|---|---|---|
| `businessOsPanel.render` QA-P8 | Both "close" steps: `fireEvent.click(row)` → Escape on the dialog; request counts byte-identical | M-4: a row click is a reopen, never a toggle |
| `businessOsPanel.render` P-4 | `getByRole('banner')` → the h1's `closest('header')` | SA L-4a code review comment 1 |
| `businessOsPanel.render` P-5 | `getByText('User ID:')` → `within(dialog).getByText('User ID')` | Drawer labels drop the colon |
| `businessesLayout.render` U-10 | Six headers; "the row toggle…" → "the Open button is named for the person, shows the word Open, and is not a toggle" | Q-2 (b); the toggle is gone |
| `businessesLayout.render` U-12 | Refresh found with `hidden: true`; asserts the dialog stays open across Refresh and is gone after the status change | Modal drawer (deviation 4) |
| `defaultFilter.render` | "six columns in all" (no Actions); empty cell `colspan` = number of column headers and `'6'` | Q-2 (b) |
| `source.guard` | Re-expressed per M-3 (map below); `SCREEN_FILES` gains the four new files | The detail moved |
| `layoutFolder.guard` | Registry entry `/admin/users (Businesses)` with the seven files and the exclusion comment | §5.2, Q-5 |
| `ArchivedBeforeNotice.render` N-4 | Reads `BusinessAuditSection.tsx` instead of `page.tsx` | Deviation 3 |

`openRowWithStats`, P-6c, QA-P7 and the U-12 opening keep their `row-business` clicks (the D-17 path, M-1).

### M-3: old → new `source.guard` assertion map

| Old assertion (on `page.tsx`) | New assertion |
|---|---|
| exactly one `<DeleteBusinessDialog` | the same, on `BusinessDetail.tsx`; and the page names `DeleteBusinessDialog` nowhere |
| `{isExpanded && (` exists and `danger-area` follows it | page: exactly one `<AdminDrawer`, one `<BusinessDetail` between `<AdminDrawer` and `</AdminDrawer>`, `open={isOpen && selected !== null}`, the drawer outside the loaded branch (deviation 2); no `danger-area` in the page; detail: `danger-area` exists |
| `<DeleteBusinessDialog` after `danger-area` | the same, on the detail |
| `delete-business-open` after `danger-area` | the same, on the detail |
| `onDeleted` body `void fetchUsers();` | `onDeleted` body `void refreshList();`, plus its FR-A9 comment word for word (raw source); `refreshList(` exactly twice; page: `refreshList={fetchUsers}` exactly once |
| AU-C5: `const SHOW_AD1_DELETE_ENTRY = false;` exactly once; gate after `danger-area`; button and dialog after the gate; dialog before the panel | the same four, on the detail; the page names `SHOW_AD1_DELETE_ENTRY` nowhere |
| AU-C2 / C3: the panel import line exact | the same, on the detail; the page names `TestAccountCleanupPanel` nowhere |
| no `cleanupApiTypes` | the same, on the detail and on the page |
| one `<TestAccountCleanupPanel`, after `danger-area` (which follows `{isExpanded && (`) | the same, on the detail (`danger-area` must exist) |
| panel `key={user.id}`, `lockedEmail={user.email}` | the same, on the detail |
| `onRemoved` body `void fetchUsers();` | `onRemoved` body `void refreshList();`, plus its AU-C2 comment word for word (raw source) |
| `{user.email ? (` right before the panel | the same, on the detail |
| AU-C4 over `page.tsx` and the panel | over `page.tsx`, `BusinessDetail.tsx` and the panel |

### User-visible changes

- A business opens in a side panel from the right instead of expanding under its row: the "Open" button at the start of the row, or a click anywhere else on the row (not on a button, link or field, and not while selecting text). Escape, the X or a click outside closes it and puts focus back on that row's Open button.
- The Actions column (the chevron toggle) is gone: six columns.
- The panel's title is the business name (or the person's name, or the email) with the short id.
- Inside, the same blocks in the same order, as labelled fields: times are "YYYY-MM-DD HH:mm UTC" with an age line (no more local dates); an inactive plugin says "inactive"; decorative green and coloured icons are gone; severity shows as "Info" / "Warning" / "Critical" chips.
- The audit trail starts collapsed behind "Show audit events" every time a business is opened; the chosen event type is still remembered per business.
- The Login Activity count in the list is no longer green.
- "Reading the business details…" replaces "Loading user details...".
- A login-stats or audit answer that is not JSON now hides only its own section; before, it also hid the plugins and AI spend sections.

### Out of scope, found on the way (listed, not fixed)

- **F-108** (deviation 1): the credit and top-ups dialogs return focus to `<body>` on close.
- The new suite logs React `act()` warnings from `CreditsBlock` / `BoostBlock` reads that land after a test's last assertion (their own effects, still settling when a test ends; `businessOsPanel.render` shows none). Noise only, all 28 cases pass; a later tidy-up could await `credits-block` / `boost-block` settling in the cases that end early.

## SA Review Notes

Workplan review: see the next section.

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11** against the requirement (§5.7, §5.8 D-1 to D-8, §5.10, §5.11, §5.12, §7.7, §9 F-23 / F-24, §11 Q-16, re-check R-6 / R-7 / R-8), the L-4a workplan (§13 outline, SA workplan review Q-2 / Q-8 / N-1, SA code review comment 1 and the L-4b note), L-1d (SA Q-10, QA B-1 and its fix), L-2b SA M-4, and the code at `9ea1cb3c`: `users/page.tsx` (row `:696-818`, detail `:820-1236`, reads `:426-506`), `AdminDrawer.tsx`, `OpenRowButton.tsx`, `ArchivedBeforeNotice.tsx` with `hooks/useLatestArchiveCutoff.ts`, `TestAccountCleanupPanel.tsx` (`:415-560`), `users/__tests__/source.guard` (`:293-345`), `defaultFilter.render` (`:126-168`), `businessOsPanel.render` QA-P8 (`:545-580`), `eslint.config.mjs`.

**Status:** ✅ APPROVED WITH CONDITIONS. Dev applies M-1 to M-5 to this workplan before coding (no second SA pass; SA checks them at code review). S-1 to S-8 are code-review checks. No product question remains: Q-1 is decided by the user (D-17).

**Scope confirmed:** no route, payload, write, money or permission change; the credit, top-up, cleanup and delete components keep their props and code, only their mount point moves; no new import from `lib/business-os/` in any new file (the `source.guard` rule over `SCREEN_FILES` enforces it), so no entitlements registration is needed (V-2 still runs); `creditBands.guard` and `creditFigures.fromConfig.guard` run unedited over the new files; the QA-P8 / O-3 cache rule is unchanged (skip only when login stats, audit, tokens and plugins are all held); the Login Activity column still fills from the page-owned cache, which outlives the drawer; the danger area, the cleanup panel and the Delete gate are never mounted while the drawer is closed (Radix unmounts closed content; `AdminDrawer` passes no `forceMount`; D-1 and D-17 pin it).

### User decision D-17 (2026-10-11): whole row clickable

The user answered Dev's product question: on Businesses, a click anywhere on a row also opens the drawer. This is a **recorded page deviation from L-1d SA Q-10** ("rows open only through the Open button", followed by Audit trail and AI cost & usage). §5.8 D-2 allows it ("clicking anywhere on the row may also open it, but the button is the keyboard path"), so the standard itself is not changed. Recorded in requirement §10 Answers as D-17 and in §12 Q-1 above.

### Rulings on §12

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Decided by the user (D-17): whole row clickable, built to these rules.** (1) The `tr` gets `onClick` and `cursor-pointer`; **no** `tabIndex`, `role`, `onKeyDown` or ARIA on the `tr`: it is a mouse extra, not exposed as a control. (2) The handler returns without opening when the click target's `closest('button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]')` lies inside the row; this includes the Open button itself, so a click on Open opens once, not twice. (3) It returns without opening when the user is selecting text: `window.getSelection()` is non-collapsed with its anchor or focus node inside the row (a selection elsewhere on the page does not block the row). (4) Otherwise it calls the same `openRow(user, opener)` as the button, with `opener` = **that row's Open button**, found inside the clicked row, never the `tr` and never null; focus therefore returns to the row's Open button whichever path opened it. (5) The Open button stays the only keyboard path and keeps its label. (6) The drawer stays page-level, outside the table (SA M-4), which is also what keeps clicks inside the drawer and its portaled dialogs from bubbling (React bubbles through portals along the component tree) to any `tr`. Tests and mutations: M-1 | Accessible (no nested-interactive role, one keyboard path), safe (never fires on a control or a text selection) and the same opener and focus rules as the button |
| Q-2 | **(b): remove the Actions column (six columns).** The `defaultFilter` "seven columns" and "colspan=7" cases and U-10's header list are edited deliberately, intent kept: no Status / Auth role column, Credits left present, and the empty cell spans every column, asserted as `colspan` equal to the number of `columnheader`s (stronger than a literal), plus the literal `6`. Record in §7.7 as-built that this revises SA Q-16's "seven-column pin holds with no edit" | Q-16 kept the pin only because the Open button needed a home; its real intent (opener in the first cell, no new column) holds. With D-17 the column would never hold anything; an em dash in every row of a column with no purpose is noise, not "never blank" (§5.7). (c) stays refused (Q-16, R-8, D-2) |
| Q-3 | **UI short path confirmed; no `useDrawerResource` (R-6 as ruled, hook stays with L-8).** Run under the user's fast-track: this review, then SA code review + QA, then RM | No shared export is built or changed (S-1's comment edit is documentation only). The three reads are a per-account cache feeding the list column and the reopen rule, not a drawer resource. Q-16's "abort on switch" does not apply: the drawer is modal, so no switch happens without a close, and every result lands in its own account's slot |
| Q-4 | **Approved: a body that is not JSON affects only its own section; an unreadable audit body is never cached as empty.** With S-2 (log the parse failure) | It removes a defect (one bad body skipping two good sections), changes no request count, and D-15 pins both directions. `stats` keeps "unreadable unless held" |
| Q-5 | **Approved as listed** (`page.tsx`, `usersFilters.ts`, `useBusinessDetails.ts`, `usersFormat.ts`, `BusinessesKpis.tsx`, `BusinessDetail.tsx`, `BusinessAuditSection.tsx`), with the comment naming the excluded components and why | G-6 precedent; converting the panel, credit, boost and delete reads changes their pinned error copy and is not a layout change |
| Q-6 | **Approved**, with: every existing test id kept (`bos-panel`, `plugins-card`, `ai-spend-card`, `danger-area`, `delete-business-open`, `test-account-cleanup-panel`); label words kept verbatim (colons dropped only); the F-24 title verbatim; the danger area keeps its own rose frame and `h3`, not a `DrawerSection` | Display-only; §5.8 D-5, §5.9, §5.11, A-7, T-5, T-6 |
| Q-7 | **Approved: one "Show / Hide audit events" button as the section's first child**, collapsed on every open, filter remembered per account. **With M-2: the folded part is always rendered and hidden with the `hidden` attribute, never unmounted** | A button inside the `h3` would change `DrawerSection` (shared) for one page. M-2 is forced by `ArchivedBeforeNotice` reading on mount |
| Q-8 | **Approved: title = the business name, else `rowToggleName`; suffix = `formatShortId`.** The business name is used only when `businessLabel(user)` is not the muted placeholder ("No Business OS business" must never be a title) | The dialog is named for what the row shows first |

### Findings

**Must (apply to this workplan before coding)**

| # | Finding |
|---|---|
| M-1 | **D-17 through the whole plan.** Rewrite §2.3 (row click kept per the Q-1 ruling, rules (1) to (6)), §3.6 Row, §10 (replace the "removing the row click" risk with "a row click fires on a control or a selection", mitigated by rules (2) / (3)), §11 (F-23's "Click to load" is literal again; drop the note). Tests: D-2 becomes "first cell holds one Open button; the `tr` has no `tabindex` and no `role`"; add **D-21** a click on a non-interactive part of a row (the business name, the Contact cell, the Credits left cell) opens the drawer with exactly one request each to the three reads, and Escape returns focus to **that row's Open button**; **D-22** a click on the Open button sends exactly one request each (the row handler ignored it); **D-23** a non-collapsed selection inside the row (mock `window.getSelection`) → a row click opens nothing and sends nothing; a selection outside the row does not block it; **D-24** keyboard: focus the Open button, press Enter → opens. §6.2: the `businessOsPanel.render` and `businessesLayout.render` row-click openings **stay as they are** (they are now the D-17 path and keep it tested); only the closes change (QA-P8 and U-12 close with Escape or the X, because a row click while open is a reopen, never a toggle). V-6: replace (p) with **(p)** drop the interactive-child check → D-22; **(q)** drop the selection check → D-23; **(r)** pass the `tr` (or nothing) as the opener on a row click → D-21 focus. §7.1 B-1: a click on a blank part of a row opens; drag-selecting a row's text does not; one click on Open sends one set of reads |
| M-2 | **`ArchivedBeforeNotice` reads `/api/admin/archiving` on mount** (`useLatestArchiveCutoff`). If the folded part mounts on expand, expanding sends a request, breaking the user's "data read as today, expanding sends nothing" and D-6. The fold is a container that is **always rendered** (`id` from `useId`, `hidden={!expanded}`), its children always mounted; `aria-controls` therefore always resolves. D-3 asserts exactly one `/api/admin/archiving` read per open, as today; D-6 asserts **no request to any URL** on expand or collapse, and that while collapsed the select is not reachable by role and the fold carries `hidden`. Add mutation **(s)**: render the fold's children only when expanded → D-6 fails |
| M-3 | **`source.guard` re-expression, exact strings.** Detail side (`BusinessDetail.tsx`): `const SHOW_AD1_DELETE_ENTRY = false;` exactly once; order `danger-area` → `{SHOW_AD1_DELETE_ENTRY && (` → `delete-business-open` and `<DeleteBusinessDialog` → `{user.email ? (` → `<TestAccountCleanupPanel`; one dialog, one panel; panel `key={user.id}`, `lockedEmail={user.email}`; the exact panel import line; no `cleanupApiTypes`; `onDeleted` and `onRemoved` bodies `void refreshList();` with their FR-A9 / AU-C2 comments carried verbatim; `refreshList(` appears exactly twice in the code (the two bodies). Page side: as in §5.1, plus `refreshList={fetchUsers}` exactly once and the page names neither the panel nor the dialog. AU-C4 covers `page.tsx`, `BusinessDetail.tsx` and the panel. Each old assertion maps to one new one; list the mapping in Implementation Notes |
| M-4 | **QA-P8 and U-12 edits keep their request-count assertions byte-identical**; only the close step changes. A row click on an open row must not be used as "close" anywhere |
| M-5 | **D-11 / D-12 also pin focus:** after the first Escape the focused element is the dialog's trigger (`credits-give`, the boost trigger) inside the still-open drawer; after the second, Dana's Open button. Add an overlay-click case for the nested dialog only if jsdom can express it; otherwise it stays B-6 |

**Should (checked at code review)**

| # | Finding |
|---|---|
| S-1 | `OpenRowButton.tsx`'s doc comment says it is "the one way to open a row: no clickable `tr` around it". Change the comment only (no prop, export or behaviour change, path unchanged): the button is the keyboard path; a page may add a row click as a mouse extra under D-2, which Businesses does (D-17). Add the file to §4 as "comment only" |
| S-2 | A body that `readJsonBody` returns as `null` on an `ok` answer logs one facts-only line (section name and status, never the body) on the existing page logger, so the §2.4 change does not make a failure silent where the old `catch` logged it |
| S-3 | `useBusinessDetails.loadDetails` reads the current maps (no stale closure): a `useCallback` with honest deps or refs; no `eslint-disable` without a reason. The row click and the button call the same `openRow` |
| S-4 | The delete button's `e.stopPropagation()` may stay (byte-equivalent danger area) but the detail adds no new `stopPropagation`: nothing inside the drawer sits under a row |
| S-5 | `BusinessDetail.tsx` props are typed; `refreshList: () => Promise<void>`; no `any` added; `AuditLogEntry`'s two fields become `unknown` and the `as any` cast on the select goes (V-5) |
| S-6 | D-20 counts `h1` with `querySelectorAll` (the page's header is `aria-hidden` while the modal is open, so a role query would find none) |
| S-7 | Requirement at implementation: §7.7 as-built (D-17 row click as a page deviation from L-1d Q-10; six columns revising Q-16's pin; the audit fold), §9 F-105, F-106, F-107, the Login Activity green item done, Change History |
| S-8 | `creditBands.guard` over the new files: `ageLine` keeps the 1 / 24 cut-offs only; no new comparison anywhere in the detail or the audit section |

**Notes**

| # | Note |
|---|---|
| N-1 | **F-107 (pre-existing, record in §9, not fixed):** if the drawer is closed (Escape) while a cleanup delete is in flight, the panel unmounts before it sets `cleanPending`, so `onRemoved` never fires and the deleted account stays listed until the next Refresh. Collapsing the row did the same; a drawer's Escape makes it easier to reach. The panel is a shared Business OS component outside the admin folder; its own slice if wanted. The production browser rule (never run a cleanup) keeps QA away from it |
| N-2 | Escape inside the cleanup panel's confirm input closes the drawer and discards the typed confirmation. Safe direction (nothing is sent); accepted |
| N-3 | The panel's configuration probe (`GET` on mount) and `BusinessOsPanel`'s two reads run once per open, as per expand today (SA L-4a N-1) |
| N-4 | F-106 stays recorded; an in-flight set would change request counts and is not a layout change |
| N-5 | `next/core-web-vitals` does not enable `jsx-a11y/click-events-have-key-events`, so the row `onClick` needs no lint disable; the keyboard equivalent is the Open button by design |

**Sizing:** about 3 days, confirmed. D-17 adds about a quarter day (handler, D-21 to D-24, three mutations) and saves most of the planned row-click test edits.

### Verdict

✅ **APPROVED WITH CONDITIONS.** Apply M-1 to M-5 to this file, then implement. Path: UI short path under the user's fast-track (SA code review + QA, then RM commits and opens the PR, no user diff review). No product question for the user.

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved (no must-fix)

Reviewed uncommitted on `feature/admin-layout-l4b` (base `3c709fe5`) against the SA workplan review (D-17 rules 1 to 6, Q-2 to Q-8, M-1 to M-5, S-1 to S-8, N-1 to N-5), the Implementation Notes (M-3 map, deviations 1 to 6) and the requirement. `git status --short`: 10 modified, 6 new; `git diff --stat`: 10 files, 463 insertions, 890 deletions; no file emptied, no deletion-only file. `core.autocrlf=true` and every touched file is LF in the index, so no line-ending churn reaches the commit (the new files are CRLF on disk, not LF as V-8 says; git normalises them on add, no action). Spot run: `npx jest app/admin/users app/admin/components --ci` gives 34 suites, 974 tests, all passed. `npx eslint` on the five code files plus `types.ts`: 0 problems.

### Checks

| Check | Result |
|---|---|
| D-17 rule 1 | `page.tsx:526-532`: the `tr` has `onClick` and `cursor-pointer` only; no `tabIndex`, `role`, `onKeyDown` or ARIA. D-2 pins it |
| D-17 rule 2 | `page.tsx:50-51`: the selector is the ruled list word for word; `page.tsx:364-367` returns when the `closest` control lies inside the row, so a click on Open opens once. D-22 pins it (a double open would send two sets of reads) |
| D-17 rule 3 | `page.tsx:54-59`: non-collapsed selection with the anchor or focus node inside the row; a selection elsewhere does not block. D-23 pins both halves |
| D-17 rule 4 | `page.tsx:369-371`: opener = the clicked row's `row-open` button, never the `tr`, never null (returns if absent); `openRow` is the same function the button calls. D-21 pins focus return to that button, for three cell targets |
| D-17 rule 5 | `OpenRowButton` keeps its label; D-24 pins Enter |
| D-17 rule 6 | `page.tsx:638-659`: one `AdminDrawer`, after the content wrapper, outside every branch; portaled clicks have no `tr` ancestor in the React tree |
| One set of reads per open | `openRow` calls `loadDetails` once; the `setLoading` before the first `await` is batched with `setOpenId` / `setIsOpen`, so the body never mounts in a pre-loading render (no stray panel or archive read). D-3 / D-21 / D-22 pin one request per read |
| QA-P8 / O-3 cache | `useBusinessDetails.ts:67-74` is the old skip condition verbatim; deps honest (S-3); QA-P8 counts byte-identical, only the close step changed (M-4) |
| Login Activity column | Still fed from `details.loginStats` (`page.tsx:521`), which outlives the drawer; D-18 pins it |
| Audit fold | `BusinessAuditSection.tsx:96`: always mounted, `hidden={!expanded}`, `aria-controls` resolves; state local, so every open starts collapsed. D-6 pins zero requests on expand and collapse; D-3 pins one archiving read per open |
| §2.4 per-section parse | `useBusinessDetails.ts:88-145` matches the table; an unreadable audit body is never stored as `[]`; the S-2 facts-only line is present. D-15a / D-15b pin it |
| `source.guard` re-expression | Matches the M-3 map. Page side: one drawer, one detail between its open and close tags, the exact `open=` string, `refreshList={fetchUsers}` once, no danger-area part named. Detail side: the `SHOW_AD1_DELETE_ENTRY = false` regex; order danger area, gate, button and dialog, email branch, panel; panel props and the exact import line; both bodies `void refreshList();` with the FR-A9 and AU-C2 comments matched on raw source; `refreshList(` exactly twice; AU-C4 over page, detail and panel |
| Deviation 2 (brace balance) | Sound. The slice from `{!error && hasLoaded && (` to `<AdminDrawer` balances only when the branch has closed before the drawer; moving the drawer inside leaves the branch's `(` and `{` open, so the tally fails. A missing marker, or a drawer placed before the branch, gives an empty slice and fails the length check, so it cannot pass vacuously. It fails safe: a stray unbalanced parenthesis in JSX text turns it red, never green |
| Danger area never mounted while closed | The body renders only under `selected &&` inside Radix content without `forceMount`; D-1 and D-17 pin it. The danger area is byte-equivalent to the old expanded row (only `aria-hidden` on the icon and the T-5 lift of the no-email sentence) |
| Credit / boost / cleanup / delete flows | Those components are untouched; only their mount point moved. D-11 / D-12 pin no POST; the §6.3 suites are green with no edit |
| Entitlements, credit guards | No `lib/business-os` import in any new file (the `SCREEN_FILES` rule covers them); `ageLine` keeps the 1 / 24 cut-offs only (S-8) |
| `stopPropagation` | One, the Delete… button's, carried byte-equivalent (S-4); none added |
| Types | Props typed; `refreshList: () => Promise<void>`; `changes` / `details` now `unknown`; the select's `as any` replaced by `toAuditEventFilter` (S-5) |
| Logging | Pino only; no `console.*` in any touched or new file |
| Six-column pins | U-10 and `defaultFilter` edited with intent kept; `colspan` asserted against the header count plus the literal `6` (Q-2) |
| Docs | No backslash in the workplan or the requirement; F-105 to F-108, §7.7, D-17 and Change History present (S-7) |

### Code Review Comments

1. None at High or Medium.
2. `__tests__/businessDetail.render.test.tsx` D-11 / D-12: the first-Escape assertion is `document.activeElement?.isConnected`, which `<body>` also satisfies. It honestly pins only "the drawer stays open, the trigger is still in it, no POST", which is what deviation 1 says. Keep as is; tighten when F-108 is fixed. Priority: Low
3. `page.tsx:642`: in the close-when-gone path (`selected` becomes null) the drawer slides out with an empty title and body during its exit animation. Cosmetic, the row has left the list; no action. Priority: Low

### F-108 ruling (deviation 1, M-5 built in part)

**Accepted as a recorded follow-up. No fix in L-4b.** Reasons:

- Pre-existing, not a regression: the dialogs open from state with no Radix trigger, and the expanded row lost focus to `<body>` the same way. L-4b improves what surrounds it (the drawer stays open on the first Escape; the second returns focus to the row's Open button, both pinned).
- The fix is not small or contained. It needs an opener ref in `CreditsBlock.tsx` (Give and every per-lot Take back) and `BoostBlock.tsx` (Set limit, Back to default, reconcile), plus an optional focus-return prop through `CreditFormDialog`, `BoostCapDialog` and `BoostReconcileDialog`: five money-UI files whose suites §6.3 requires to stay green with no edit. That changes the credit and top-ups flows this slice promised to leave identical, under a fast-track with no user diff review.
- Keyboard users are not stranded: the drawer's focus scope resumes once the nested dialog closes, and Escape still closes the drawer to a defined place.

F-108's disposition in requirement §9 is updated by SA to "open, own UI short-path slice". Expected shape when taken: each block keeps a ref to the button that opened its dialog, and the dialog takes an optional `onCloseAutoFocus` that calls `preventDefault` and focuses that ref when connected; display-only, no change to submit, refresh or money logic; D-11 / D-12 then assert `activeElement` equals the trigger. **QA (B-5):** in a browser, after the first Escape in each nested dialog, confirm the drawer stays open and one Tab puts focus back inside the drawer.

### Optimisation Suggestions

- The `act()` warnings from `CreditsBlock` / `BoostBlock` in the new suite (Implementation Notes) are noise only; a later tidy-up can await `credits-block` / `boost-block` settling in the cases that end early.

### Code Approved for QA: Yes

No must-fix. QA proceeds per §7.1 (including the B-5 note above); then RM commits and opens the PR under the user's fast-track. The PR names the deliberately edited tests (§6.2 plus `ArchivedBeforeNotice.render` N-4).

## QA Testing Report

## QA Report — 2026-10-11

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A + B (Jest jsdom render and source guards, routed fetch mock recording every URL and method) + throwaway probe suite (24 cases, deleted afterwards) + scoped `tsc`; D (browser) handed to TL as a checklist, because the production rule forbids submitting anything and QA has no signed-in browser in this session
**Focus:** ui, api (detail reads), security (danger area mount, no POST), accessibility
**Skipped:** live browser checks (listed below for TL)
**Input source:** prompt keywords (TL trigger) + workplan §6 / §7 / SA notes for QA

### Commands and results (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/users app/admin/components/layout app/admin/audit-trail app/admin/analytics app/admin/archiving app/admin/__tests__ app/admin/components/__tests__ components/business-os/purge lib/business-os/credits/__tests__/creditBands.guard.test.ts lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts app/api/admin/users lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | exit 0. **Test Suites: 85 passed, 85 total; Tests: 2163 passed, 2163 total** (162.6 s). Matches Dev's V-1 |
| 2 | `npm run test:bos-entitlements` | exit 0. **Test Suites: 236 passed, 236 total; Tests: 6601 passed, 6601 total** (154.1 s) |
| 3 | Scoped `tsc -p` scratch `tsconfig.qa.json` (in the session scratchpad; `extends` the worktree tsconfig, `noEmit`, `incremental: false`; `next-env.d.ts`, `app/admin/users/**`, `app/admin/components/layout/**`, `components/ui/dialog.tsx`, `components/ui/sheet.tsx`, `TestAccountCleanupPanel.tsx`, `ArchivedBeforeNotice.tsx` + its render test). Run 1 with `canary.ts` in the scratchpad | exit 2, exactly one error: `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` |
| 3b | Same config, canary removed | exit 0, no output |
| 4 | `npx eslint` on `page.tsx`, `BusinessDetail.tsx`, `BusinessAuditSection.tsx`, `useBusinessDetails.ts`, `usersFormat.ts`, `types.ts`, `OpenRowButton.tsx` | exit 0, no output |
| 5 | grep: `.json(` in `page.tsx`, `useBusinessDetails.ts`, `BusinessDetail.tsx`, `BusinessAuditSection.tsx`; `console.` in the five page-owned code files; any `entitlements` import | 0 / 0 / 0 / 0; no `console.`; no entitlements import (only a word in a `types.ts` comment), so no registration needed |
| 6 | Probe suite `app/admin/users/__tests__/zzqa-l4b.render.test.tsx` (harness copied from `businessDetail.render`, no POST ever sent) | **24 passed, 24 total** (after one fix to the probe itself: the Try again button is a sibling of `users-error`). File removed from the worktree after the run; `git status --short` identical to the start (10 modified, 6 untracked) |

### Edge-case probes (throwaway, deleted)

| # | Probe | Result |
|---|---|---|
| Q1 | Drawer open, type a search that hides the open row (local filter, then the debounced read) | Pass: drawer closes at once, focus on `users-content` (never `<body>`); one debounced read; clearing the search brings Dana back and the drawer stays closed |
| Q2 | Drawer open, URL status change (Back / Forward, D-16 path via `useSearchParams` rerender) answering a list without Dana | Pass: drawer closes, focus not on `<body>`; returning to the default status brings Dana back, drawer stays closed |
| Q3 | Success, then a failing Refresh (500) with the drawer open, then Try again | Pass: drawer closes, error shows, focus on `users-content`; retry restores the list with the drawer still closed; Login Activity count still "1" (cache outlived the error branch); reopen sends no detail read (1/1/1) |
| Q4 | Overlay pointer-down | Pass: drawer closes, focus on Dana's Open button |
| Q5a | Click on the icon inside the Open button | Pass: one set of reads (row handler ignores it) |
| Q5b | Row click on the first-cell padding, the `tr` itself, "Click to load", the Joined cell, the short id | Pass (5 cases): opens with exactly one set of reads; Escape returns focus to that row's Open button |
| Q5c | Click on injected controls inside a row: `a > span`, `input`, `[role=button]`, `label`, `[contenteditable=true]`, `select`, `textarea`, `summary`, `[role=link]` | Pass: nothing opens, zero detail reads |
| Q6 | Selection: anchor outside the row with focus inside (blocks); selection in another row (does not block); collapsed selection inside (does not block) | Pass all three; total reads 1/1/1 |
| Q7 | Open Dana (expand audit), close, open Oren, close, reopen Dana | Pass: each account read once (1/1/1 each); audit collapsed on every open (`aria-expanded=false`, fold `hidden`); Login Activity filled for both opened rows, "Click to load" for the unopened one; `/api/admin/archiving` 3 reads and cleanup `check` 3 reads for 3 opens (once per open, as before) |
| Q8a | Take back dialog (a take-back-able lot) from inside the drawer | Pass: first Escape closes only the dialog, drawer `data-state=open`; second Escape closes the drawer, focus on the Open button; no POST. Focus after the first Escape is `BODY` (F-108, already recorded) |
| Q8b | Reconcile dialog from inside the drawer | Pass: same Escape order; no POST |
| Q8c | Pointer-down on the nested credit dialog's overlay (2 overlays present) | Pass: credit dialog closes, drawer stays open; no POST (jsdom can express it after all; B-6 still worth a look in a browser) |
| Q9 | Close-when-gone (Refresh drops Dana) | Pass: no `danger-area`, no cleanup panel, no `bos-panel`, no `users-drawer` in the DOM |
| Q10 | Title fallbacks: empty company name, `business` undefined, no name and no email, whitespace-only name | Pass: "Dana Cohen 99999999…", "Dana Cohen 99999999…", "this login cccccccc…", "nobody@example.com cccccccc…"; the muted placeholders are never a title |
| Q11 | Accessibility (jsdom) | Pass: one `h1` closed and open; 6 `th`, all `scope="col"`, 6 unique texts; every body `tr` has no `tabindex`, `role` or `aria-*`; Open buttons named "Open details for Dana Cohen" / "Oren Levi" / "nobody@example.com"; dialog named "Acme Therapy 99999999…" (D-3); every `DrawerSection` group has exactly one heading; audit toggle `aria-controls` resolves to the fold; each severity chip has words plus an `aria-hidden` icon. Landmarks: none on the closed page; in the drawer only two pre-existing `section`s (`bos-panel`, unnamed so not a region; `test-account-cleanup-panel`, named, already recorded in §11). L-4b adds none |
| Q12 | Two row clicks before the reads land (jsdom only) | Two sets of reads (2/2/2). Not reachable the same way in a browser: the modal overlay takes the second click. See Edge Case 1 |
| Q13 | Space on the Open button; the drawer X has a name | Pass: opens; "Close" button present |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| One page-level drawer, outside every branch | ✅ | Pass | D-10, Q3, `source.guard` brace check |
| Whole-row click under D-17 rules 1 to 6 | ✅ | Pass | D-2, D-21 to D-24, Q5a to Q6, Q11 |
| Actions column removed (six columns) | ✅ | Pass | D-2, U-10, `defaultFilter`, Q11 |
| Open row disappears while open (status, Refresh, search, D-16 reload, error) | ✅ | Pass | D-9, D-10, U-12, Q1, Q2, Q3, Q9 |
| Focus return after Escape / X / overlay / row-click open | ✅ | Pass | D-8, D-21, Q4, Q5b |
| Exactly one set of detail reads per open; cache reuse on reopen | ✅ | Pass | D-3, D-13, D-14, QA-P8, Q3, Q7 |
| Audit collapsed by default, always mounted, zero requests on toggle | ✅ | Pass | D-6, D-7, Q7 |
| Per-section `readJsonBody` failure | ✅ | Pass | D-15a / D-15b |
| UTC times, StatusChip severities | ✅ | Pass | D-5, D-7, Q11 |
| Nested dialogs: Escape closes only the top layer | ✅ | Pass | D-11, D-12, Q8a to Q8c; focus to trigger is F-108 (accepted follow-up) |
| Danger area / cleanup panel never mounted while closed | ✅ | Pass | D-1, D-17, Q9 |
| Title fallbacks | ✅ | Pass | D-4, Q10 |
| Login Activity column still filled | ✅ | Pass | D-18, Q3, Q7 |
| Browser behaviour (stacking, colours, real pointer, Tab in nested dialogs) | ⚠️ | Not run by QA | Browser checklist below for TL |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None.

#### Edge Cases (nice to fix)

1. **Double-click on a row** (Low, pre-existing in kind). In jsdom two clicks before the reads land send two sets of reads (Q12, the F-106 class). In a browser the second click of a double-click lands on the modal overlay, which Radix treats as an outside pointer: expect the drawer to open and close at once, with focus back on the Open button. The expanded row toggled open then closed on a double-click too. Recorded for B-1; no change asked.
2. **F-108 confirmed for Take back** (Low, already recorded and accepted by SA): after the first Escape in the Take back dialog focus is on `<body>`, as for Give and the spending limit.

### Browser checks for TL (signed-in admin, DevTools Network open, light and dark OS-scheme emulation)

> **Production rule: never submit** a grant, take-back, spending limit, reconcile, cleanup or deletion. Open, look, close with Escape, Cancel or X only.

| # | Check |
|---|---|
| B-1 | `/admin/users`: "Open" before each business name; six columns, no Actions. A click on a blank part of a row opens it; drag-selecting a row's text does not. One click on Open sends one `login-stats`, one `audit-logs`, one `stats`. A double-click on a row: note what happens (expected open then close, focus on Open; Edge Case 1) |
| B-2 | Drawer slides in from the right, dark in both schemes, title = business name + short id (a login with no business: the person's name); "Reading the business details…" then the blocks, Business OS panel first, danger area last |
| B-3 | Audit section shows only "Show audit events"; expanding shows the Event type filter, the archive note and the events with **no new request**; collapsing hides them; close and reopen: collapsed again |
| B-4 | Escape, X and an overlay click each close the drawer; focus lands on that row's Open button with a visible purple ring (also after a row-click open) |
| B-5 | Give credits, Take back (a business with a take-back-able lot), Set limit and Reconcile: each opens on top of the drawer; Tab stays in the dialog; the **first Escape closes only the dialog** and the drawer stays open; then **one Tab puts focus back inside the drawer** (SA F-108 note: focus goes to `<body>` first); a second Escape closes the drawer to the row's Open button. **Never submit** |
| B-6 | A click inside an open credit dialog does not close the drawer; a click on the dimmed area outside closes the dialog first, not the drawer |
| B-7 | Danger area shows the cleanup panel as before; no "Delete…". **Never run a cleanup** |
| B-8 | Close and reopen a business: no second `login-stats` / `audit-logs` / `stats`; the panel reads again |
| B-9 | Login Activity column: "Click to load" for an unopened business; the count after opening, not green; failures red |
| B-10 | About 700 px wide: the drawer is full width, scrolls, the X stays reachable |
| B-11 | Light-scheme emulation: drawer X `rgb(203, 213, 225)`, opacity 1, purple focus ring; the nested dialog's X the same on top |
| B-12 | Drawer open, type in the search (if reachable) or use Back / Forward to a status that drops the row: the drawer closes and focus is not lost to the page top |

### Final Status

- [x] All acceptance criteria pass in jsdom — ready for commit (browser checks B-1 to B-12 owed by TL; no High or Medium issue open)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES** (notes: Edge Case 1 double-click, F-108 confirmed for Take back; browser checklist owed).

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | Dev workplan for L-4b (Businesses row detail into one page-level `AdminDrawer`), from the L-4a workplan §13 outline, including the user request (audit section collapsed by default), SA L-4a code review comment 1 (P-4 scoping) and the deferred registry entry. UI short path by classification (R-7: no shared export; no `useDrawerResource`, R-6). Awaiting SA workplan review |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS. User decision D-17 recorded (whole row clickable, a page deviation from L-1d Q-10; rules for controls, text selection, keyboard path and focus return). Q-2 (b) six columns; Q-3 short path; Q-4 to Q-8 approved. Must M-1 to M-5 (D-17 through the plan; the audit fold always rendered because `ArchivedBeforeNotice` reads on mount; exact guard re-expression; QA-P8 / U-12 counts unchanged; nested-dialog focus). Should S-1 to S-8; notes N-1 to N-5 (F-107) |
| 2026-10-11 | Implemented | Dev: M-1 to M-5 applied to this file, then tasks 2 to 11 built (M-5 in part: focus return to the nested dialog's trigger recorded as F-108 and escalated). V-1 85 suites / 2163 tests green, V-2 236 / 6601 green, scoped tsc canary then clean, lint clean, mutations (a) to (s) all red and restored. Requirement §1 row 9a, §7.7, §9 (F-105 to F-108), Change History. Uncommitted, for SA code review and QA |
| 2026-10-11 | SA code review | Code approved, no must-fix. D-17 rules 1 to 6, the read and cache rules, the audit fold, the `source.guard` re-expression (M-3 map) and deviation 2's brace-balance check verified; 34 suites / 974 tests green on spot run. F-108 accepted as a recorded follow-up (own UI short-path slice); QA to check B-5 focus by Tab in a browser |
| 2026-10-11 | QA | PASS WITH NOTES. V-1 85 suites / 2163 tests green, `test:bos-entitlements` 236 / 6601 green, scoped tsc canary then clean, eslint clean; 24 throwaway probes (row removal by search / URL / error, retry, overlay, controls and selection, cache across accounts, Take back and Reconcile nested Escape, overlay on nested dialog, title fallbacks, accessibility) all pass, then deleted. No bugs; edge cases: double-click on a row, F-108 also on Take back. Browser checks B-1 to B-12 for TL |
