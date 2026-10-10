# Requirement: Admin Layout Standard

> **Last Updated**: 2026-10-09

**Created by:** BA
**Date:** 2026-10-09
**Status:** Draft. SA approved with conditions 2026-10-09; BA revised the same day (SA-R-3 to SA-R-14). User decisions recorded 2026-10-09 (§10), and the slice order re-cut to follow the sidebar sections. SA re-checked the edited sections 2026-10-09 (R-1 to R-17): **APPROVED, ready for the L-1a Dev workplan**, with conditions RC-1 to RC-8 carried into the L-1 workplans (SA re-check subsection). Final status "Approved" still needs user or TL sign-off (§12.1).
**Related:** [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md), [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md)

## Overview

Each `/admin` page was built separately. As a result, headers, filters (dropdowns vs chips, five different date pickers), tables, status chips and detail views all differ. For example, `/admin/analytics` ("AI cost & usage") and `/admin/business-os-llm?tab=activity` show related data but look almost nothing alike. This requirement defines **one admin layout standard**: header, KPI strip, filter bar, table, drawer, and empty/loading/error states. The shared components are built **once**, in four slices (L-1a to L-1d), and each of those slices ships together with **exactly one pilot page** that uses everything it adds. The work follows the **sidebar's section priority**: Monitor pages first (Health is the first pilot), then Businesses, then Settings. After the four shared slices, the remaining visible admin pages are migrated **one page per slice**, each slice its own PR, merged before the next page starts. **The sidebar itself (its sections, their order, the page positions and labels) and the `/admin` landing page (Health) never change.** Layout slices change no data, money, permission or API behaviour. Defects found on the way go to §9 and are not fixed here.

All paths are relative to the repository root. Line citations come from read-only surveys of the code on 2026-10-09 (worktree `neuronforge-admin-layout`, HEAD `88f97171`), spot-checked by BA. **Nothing has been checked in a browser.** Statements about light-OS rendering are inferred from the CSS, and are marked as such.

---

## Table of Contents

1. [Progress](#1-progress)
2. [Problem, goals and scope](#2-problem-goals-and-scope)
3. [Process and discipline](#3-process-and-discipline)
4. [Survey: how each page differs today](#4-survey-how-each-page-differs-today)
5. [The standard](#5-the-standard)
6. [Shared components](#6-shared-components)
7. [Per-page migration plan](#7-per-page-migration-plan)
8. [Page order](#8-page-order)
9. [Found, not in scope](#9-found-not-in-scope)
10. [User decisions](#10-user-decisions)
11. [Questions for SA](#11-questions-for-sa)
12. [Acceptance criteria and definition of done](#12-acceptance-criteria-and-definition-of-done)
13. [SA Review — 2026-10-09](#sa-review--2026-10-09)
14. [Change History](#change-history)

---

## 1. Progress

> The single source of truth for this work. Every SA ruling, PR, merge and deferral is recorded here.

**Path per slice.** L-1a to L-1d are **full cycle** (they introduce a new shared pattern, CLAUDE.md rule 7). Each one ships its shared components together with **exactly one pilot page** in the same PR, and the pilot uses every new export (SA-R-3). The later page slices, L-2a to L-12, use the **UI short path**, except where a page slice builds a shared export that no pilot needed: **that slice runs the full cycle** (SA re-check R-6, R-7). Known today: L-2a (same-page `KpiTile` mode), and whichever slice first builds `useDrawerResource` (not L-1d and not L-2b, whose detail views render from the row already loaded; expected L-8). "NEEDS DATA" follow-ups and any API fix are separate full-cycle slices, listed as their own rows and run only if the user asks for them (§10).

**Order.** Slices follow the sidebar's section priority (user, 2026-10-09): **Monitor → Businesses → Settings**, and within a section the sidebar order where possible. §8 gives the reasons for each position.

| # | Page / item | Section | Slice | Status | PR | SA ruling / notes |
|---|---|---|---|---|---|---|
| 0 | The standard (this document) | — | L-0 | SA re-checked — APPROVED (ready for L-1a workplan; conditions RC-1 to RC-8) | — | SA 2026-10-09: Q-1..Q-16 ruled; history.replaceState via a hook-owned state; wrap, never edit, `components/ui`; `cn()` unchanged; each L-1 slice lands with one pilot page; 4 doc corrections made by SA (SA-R-1, R-2, R-15, R-16). BA 2026-10-09: SA-R-3..R-14 addressed. User 2026-10-09: "all recommended; D-14: b", plus the sidebar-order instruction (§10 Answers). BA re-cut the slices: pilots re-picked from the Monitor section. SA re-check 2026-10-09: R-1..R-17 ruled (all approved; R-6 and R-7 as "a page slice that builds a shared export runs the full cycle"); conditions RC-1..RC-8; 5 doc corrections made by SA. User sign-off 2026-10-09 ("update my request and let's start!") — document APPROVED |
| 1 | Shell, page header, states, JSON read helpers, UTC formatters, Refresh, shared-folder guard → pilot **Health** (`/admin`) | Monitor | L-1a | 🟡 PR #285 open — awaiting required checks + user merge. Commit `4655d6c5` (merged origin/main `a8333bab`). Workplan SA-approved with conditions 2026-10-09; code SA-APPROVED 2026-10-09 (no must-fix; CR-1, CR-4 carried to L-1b); QA PASS WITH NOTES 2026-10-09 (E-1..E-3, no bugs); user approved the diff 2026-10-10. Owed after merge: browser check (light + dark) | — | **Full cycle.** Workplan: [ADMIN_LAYOUT_L1A_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L1A_WORKPLAN.md). Recorded cross-folder edits: `AdminChrome`, `AdminHeader` (+ test), `business-os-llm/readJsonBody.ts` becomes a one-line re-export. Health's strict guards (region count, `GREEN_STYLE`, single fetch) stay green; §7.1. Deferred exports (SA re-check R-2, SA workplan review 2026-10-09 rulings 3c and 10), each built with the first pilot that uses it: `AdminEmpty`, `AdminNotice`, `formatUtcDate`, `formatCount`, the `badge` and `actions` props of `AdminPageHeader`, the filter controls, presets, Clear and active chips of `AdminFilterBar`, and its `readAt` ("Read at") prop (L-1c, first consumer Audit trail) |
| 2 | KPI strip/tile, status chip, admin dialog class → pilot **Scheduled jobs & queues** | Monitor | L-1b | ⬜ not started | — | **Full cycle.** 3 of the 6 dialogs adopt the class here. §7.2 |
| 3 | URL filter state, filter bar + date presets, business picker → pilot **Audit trail, part 1** (header, filter bar, URL, states) | Monitor | L-1c | ⬜ not started | — | **Full cycle.** Content stays cards until L-1d. If the workplan exceeds a few days, the picker moves to L-1d (same page). §7.3 |
| 4 | Table constants, drawer + Open-row button → pilot **Audit trail, part 2** (cards → table, inline expand → drawer) | Monitor | L-1d | ⬜ not started | — | **Full cycle.** Audit trail meets the full per-page definition of done at the end of this slice. §7.4 |
| 5 | Audit trail KPI counts (severity aggregates) | Monitor | L-X1 | Not planned (D-12 (a)) | — | **NEEDS DATA. Full cycle**, not a layout slice. Kept so it is not lost; the user may ask for it at any time |
| 6 | AI cost & usage, part a: header, KPI strip, filter bar, states | Monitor | L-2a | ⬜ not started | — | **Full cycle** (SA re-check R-7: it builds the same-page filter mode of `KpiTile`). §7.5 |
| 7 | AI cost & usage, part b: table + call-detail drawer | Monitor | L-2b | ⬜ not started | — | UI short path (SA re-check R-6: the call-detail view renders from the loaded row, so no `useDrawerResource` here). §7.5 |
| 8 | Archiving | Monitor | L-3 | ⬜ not started | — | UI short path. Its dialog adopts the class here (D-8 (a)). §7.6 |
| 9 | Businesses (`/admin/users`) | Businesses | L-4 | ⬜ not started | — | UI short path. May split: L-4a list, L-4b detail into drawer. Dead filter panel removed, three tiles kept (D-11 (a)). §7.7 |
| 10 | Plans & entitlements | Businesses | L-5 | ⬜ not started | — | UI short path. §7.8 |
| 11 | Signup Invites | Businesses | L-6 | ⬜ not started | — | UI short path. Filters not in the URL (D-7 (a)). §7.9 |
| 12 | Messages | Businesses | L-7 | ⬜ not started | — | UI short path. **Reply hidden** (D-14 (b), a UI-only change). No KPI strip (D-13 (a)). Baseline test first. §7.10 |
| 13 | Messages KPI counts (unfiltered counts by status) | Businesses | L-X2 | Not planned (D-13 (a)) | — | **NEEDS DATA. Full cycle.** Kept so it is not lost |
| 14 | Business OS AI: page header + **Activity** tab | Settings | L-8 | ⬜ not started | — | UI short path, **or full cycle if it builds `useDrawerResource`** (expected: the Activity drill-down is the first drawer that owns a fetch; SA re-check R-6). Deletes the `readJsonBody` re-export and the original `audit-trail/BusinessAccountPicker.tsx` (recorded cross-folder edits). §7.11 |
| 15 | Business OS AI: **Costs & credits** tab | Settings | L-9 | ⬜ not started | — | UI short path. The account select becomes the business picker (new request, SA-R-11). §7.12 |
| 16 | Business OS AI: **Settings** tab | Settings | L-10 | ⬜ not started | — | UI short path. All tiles neutral (SA-R-4). §7.13 |
| 17 | Model pricing (`/admin/system-config`) | Settings | L-11 | ⬜ not started | — | UI short path. **Depends on the model price review work** (worktree `neuronforge-model-pricing`) merging. If it has not merged when L-11's turn comes, L-12 runs first and L-11 goes last. §7.14 |
| 18 | Admin users (`/admin/settings`) | Settings | L-12 | ⬜ not started | — | UI short path. §7.15 |
| — | Dialog close-button fix for the remaining 3 dialogs (Archiving, Businesses ×2) as one extra slice | — | L-D | Not planned (D-8 (a)) | — | The 3 dialogs adopt the class in their own slices (L-3, L-4) |
| — | Messages reply fix (route stub, hardcoded `admin_id`, `console.*`) | — | — | Not planned (D-14 (b)) | — | Former L-10r, removed. Stays in §9 F-1 / F-11 for a separate decision; would be its own full-cycle API slice |
| — | Activity exact "Failed" count for the whole window; Businesses unfiltered "All logins" count | — | — | Not planned | — | NEEDS DATA. Listed so they are not lost; each would be its own full-cycle slice if asked for |
| — | Business OS finance health page | — | — | Future adopter | — | Being built in another session. It adopts this standard from the start. Not specified here |

**Slice ids across revisions.** §11 and the SA Review use the ids of the first draft. The first BA response table uses the ids of the SA-R-3 re-cut (previous revision). They map as follows:

| Content | First draft | Previous revision (SA-R-3 re-cut) | Current (sidebar order, 2026-10-09) |
|---|---|---|---|
| Shell, header, states, JSON helper, UTC formatter (+ Refresh, shared-folder guard) | L-1a | L-1a, pilot Admin users | L-1a, pilot **Health** |
| KPI strip, status chip, dialog class | part of L-1c | L-1b, pilot Jobs | L-1b, pilot **Jobs** (unchanged) |
| URL hook, filter bar, presets, business picker | L-1b | L-1c, pilot BOS AI Costs + page header | L-1c, pilot **Audit trail part 1** |
| Table constants | part of L-1c | L-1c | L-1d |
| Drawer + Open-row button | part of L-1c | L-1d, pilot BOS AI Activity | L-1d, pilot **Audit trail part 2** |
| Health | L-6 | L-6 | L-1a |
| AI cost & usage | L-3 | L-3 | L-2a + L-2b |
| Scheduled jobs & queues | L-7 | L-1b | L-1b |
| Audit trail | L-5 | L-5 | L-1c + L-1d |
| Audit trail counts | L-5x | L-5x | L-X1 (not planned) |
| Archiving | L-10 | L-9 | L-3 |
| Businesses | L-4 | L-4 | L-4 |
| Plans & entitlements | L-9 | L-8 | L-5 |
| Signup Invites | L-8 | L-7 | L-6 |
| Messages reply fix | (UD-7 (a)) | L-10r | removed (D-14 (b)) |
| Messages | L-12 | L-10 | L-7 |
| Messages counts | — | L-10x | L-X2 (not planned) |
| BOS AI page header | L-2a | L-1c | L-8 |
| BOS AI Activity tab | L-2a | L-1d | L-8 |
| BOS AI Costs & credits tab | L-2b | L-1c | L-9 |
| BOS AI Settings tab | L-2c | L-2 | L-10 |
| Model pricing | L-13 | L-11 | L-11 |
| Admin users | L-11 | L-1a | L-12 |
| Remaining 3 dialogs | — | L-D | L-D (not planned) |

User decisions were renumbered in the previous revision: the first draft's UD-1..UD-10 (minus UD-4) and SA-U-1..SA-U-4 are D-1..D-14 in §10, each showing its old id.

---

## 2. Problem, goals and scope

### 2.1 Problem

| Area | Today |
|---|---|
| Title | Every page renders its own `<h1>`, **and** `AdminHeader` renders a second one (`app/admin/components/AdminHeader.tsx:72`). For nine visible views it reads "Admin Console" (`:41`). Several page titles also differ from the sidebar label. |
| Headline numbers | Only Health (tiles), Businesses (3 plain tiles) and AI cost & usage (cards) have any. Their styles, clickability and colour rules all differ. |
| Filters | Six date-range implementations. Dropdowns on one page, chips on another. The business picker is used on two pages, and a native `<select>` on a third. Almost nothing is kept in the URL. |
| Refresh | Six button styles: text+icon, icon-only with no name, icon with `title` only, icon with aria-label. They are labelled "Refresh" or unlabelled. |
| Tables | Different densities (`py-4` to `py-1`), different numeric alignment (right, left, font-mono, tabular-nums, none). Status shown as a glyph only, colour+text, or icon+text. |
| Row detail | A drawer (Activity), hand-built modals (Analytics, Messages), inline expanding rows (Businesses, Audit trail), or nothing. |
| States | Full-page spinners that unmount the filters, light-themed error boxes on a dark page, and raw parser errors ("Unexpected token <") shown to the admin. |
| Theme | `/admin` does not load `app/v2/globals-v2.css`, so `--v2-*` tokens resolve to nothing. `dark:` is inert because no `.dark` class is set. `cn()` is a plain join, so a page's class cannot override a primitive's class. This has already made one close button invisible. |

### 2.2 Goals

| # | Goal |
|---|---|
| G-1 | Every visible admin page has the same regions, in the same order: header, KPI strip (where it applies), filter bar, content, drawer, states. |
| G-2 | The shared parts exist **once** in code. Pages compose them and do not copy them. |
| G-3 | Filters are in the URL, so a view can be shared by copying its link. Existing inbound links keep working. Two deliberate exceptions: free-text search, and the Signup Invites page (§5.6 U-1). |
| G-4 | Status is never shown by colour alone. Pages are usable by keyboard, and readable whether the OS is in light or dark mode. |
| G-5 | Migration is incremental, one page per slice, in sidebar section order. No big-bang redesign and no side quests. |

### 2.3 Scope

**In scope:** the visible admin menu (`app/admin/components/AdminSidebar.tsx:84-190`), which is 12 pages / 14 views:

| Section | Page | Route |
|---|---|---|
| Monitor | Health | `/admin` |
| Monitor | AI cost & usage | `/admin/analytics` |
| Monitor | Scheduled jobs & queues | `/admin/jobs-queues` |
| Monitor | Audit trail | `/admin/audit-trail` |
| Monitor | Archiving | `/admin/archiving` |
| Businesses | Businesses | `/admin/users` |
| Businesses | Plans & entitlements | `/admin/business-os-tiers` |
| Businesses | Signup Invites | `/admin/business-os-invites` |
| Businesses | Messages | `/admin/messages` |
| Settings | Business OS AI (Settings, Costs & credits, Activity) | `/admin/business-os-llm` |
| Settings | Model pricing | `/admin/system-config` |
| Settings | Admin users | `/admin/settings` |

The shell (`AdminChrome`, `AdminHeader`) is in scope only as far as L-1a needs it.

**Fixed by the user (2026-10-09) — hard constraint on every slice:**

| # | What never changes | Why / how it is kept |
|---|---|---|
| X-1 | The sidebar's **sections and their order**: Monitor → Businesses → Settings | User: Monitor is the most important section, then Businesses, then Settings. `AdminSidebar.tsx` is **not edited by any slice**; `AdminSidebar.nav.test.ts:86-275` (order and labels) stays green with no edit |
| X-2 | The **pages inside each section, their positions and their sidebar labels** | As X-1. Renaming a page's own h1 to match its sidebar label (D-3 (a)) is allowed: it changes the page, never the sidebar |
| X-3 | The **`/admin` landing page is Health** | User: Health is the most important page. `app/admin/layout.tsx` and the `/admin` route are not changed; L-1a migrates Health in place and keeps it the landing page |

**Out of scope:**
- The hidden "AgentsPilot (parked)" group (decision D-3 of the reorganisation requirement). Its pages must keep working, but they do not adopt the standard.
- Any change to the sidebar or the landing page (X-1 to X-3).
- Any change to data, money, permissions, API routes or route parameters.
- Changes to `components/ui/*` primitives used by the Business OS app (SA Q-4: wrap, never edit).
- Fixing defects (§9).
- Sorting by column, pagination redesign, CSV export redesign, drawer deep links. These are possible later items, not part of the standard v1.

**Future adopters:** the Business OS finance health page (another session) and any new admin page. A new admin page adopts the standard from its first PR.

---

## 3. Process and discipline

| Stage | Path |
|---|---|
| L-0 (this doc) | BA → SA review → BA revision → user answers §10 (done 2026-10-09) → SA re-checks the edited sections → approved on user or TL sign-off |
| L-1a / L-1b / L-1c / L-1d (shared components + one pilot page each) | **Full cycle**: Dev workplan → SA workplan review → Dev → SA code review → QA → user reads diff → TL → RM |
| L-2a to L-12 (page migrations) | **UI-only short path**: user → Dev → SA code review + QA in parallel → user reads diff → RM. **Exception (SA re-check R-6, R-7): a page slice that builds a shared export no pilot needed runs the full cycle** (L-2a for the same-page filter tile; the slice that first builds `useDrawerResource`, expected L-8) |
| L-X1, L-X2, L-D and any "NEEDS DATA" or API item | Not planned under the user's answers. If asked for later: full cycle (L-D: UI short path), as its own slice, never mixed into a layout slice |

Rules for every layout slice:

1. **One page per slice.** A page slice touches that page's folder, its tests, and nothing else. An L-1 slice touches the shared folder and its one pilot page. Recorded exceptions: the one-line edit to a page guard that adds the shared-folder alias (SA Q-3); in L-1a, `AdminChrome`, `AdminHeader` and its test, and the one-line `readJsonBody` re-export in `business-os-llm`; in L-8, deleting that re-export and deleting the original `audit-trail/BusinessAccountPicker.tsx` once its last importer (Activity) has moved to the shared picker.
2. **Never touch page N+1 while page N is open.** A slice merges before the next page starts.
3. **A few days max.** If the workplan shows more, split the slice into L-na / L-nb, each still on one page.
4. **No behaviour or data change** unless the standard or a recorded user decision forces it. Each page's forced changes are listed in §7.
5. **No data, money, permission or API change.** If a KPI needs a number the page cannot already get, **STOP**. Mark it NEEDS DATA, and it becomes its own full-cycle slice.
6. **Found a defect?** Add it to §9. Do not fix it in the layout slice.
7. **Nothing is committed before the user has read the diff.**
8. **Every stage is recorded in §1** (ruling, PR, merge, deferral), per the standing "always update main requirement" preference.
9. **The sidebar and the landing page are fixed** (§2.3 X-1 to X-3). No slice edits `AdminSidebar.tsx`, its nav test, `app/admin/layout.tsx`, or which page `/admin` shows.

---

## 4. Survey: how each page differs today

Abbreviations: **AH** = `AdminHeader`. **dup-h1** = the page `<h1>` plus the AH `<h1>`. **json()** = `response.json()` called with no guard, so a parser message can reach the screen.

### 4.1 Shell

| Item | Today | Citation |
|---|---|---|
| Layout | Server component, `requireAdminPage()`. **Imports no CSS** | `app/admin/layout.tsx:41-47` |
| Chrome | Always dark: `min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-slate-800 text-white`; `main` is `flex-1 overflow-y-auto p-6`, with no max width | `AdminChrome.tsx:32`, `:47` |
| AH title | `<h1>` from a pathname switch with 5 cases. Analytics, Archiving, Audit trail, Businesses, Tiers, Invites, BOS AI, Model pricing and Admin users fall through to "Admin Console" | `AdminHeader.tsx:34-43`, `:72` |
| AH mobile menu | Icon button with no aria-label | `AdminHeader.tsx:64-69` |
| Theme | `dark:` follows the `.dark` class (`app/globals.css:50`), and only `V2ThemeProvider` sets it. That provider is never mounted under admin, so **`dark:` is inert**. `--background` / `--foreground` follow the OS (`globals.css:52-55`, `:85-90`). `--v2-*` is defined only in `app/v2/globals-v2.css`, which is never loaded under admin | survey C §Dark mode |
| `cn()` | `classes.filter(Boolean).join(' ')`. This is not tailwind-merge, although `tailwind-merge` is installed | `lib/utils.ts:1-3` |
| Dialog palette | `DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100'` is copied into 6 files | `ArchiveConfirmDialog.tsx:41`, `CancelQueueItemDialog.tsx:48`, `DrainNowDialog.tsx:38`, `RetryQueueItemDialog.tsx:51`, `CreditFormDialog.tsx:53`, `DeleteBusinessDialog.tsx:78` |
| Dialog close button | `text-[var(--v2-text-muted,var(--foreground))]` resolves to `#171717` in light OS mode, on a `bg-slate-900` dialog. The X is **likely near-invisible** (inferred). This is the same class of bug as the fixed Activity drawer close | `components/ui/dialog.tsx:101` |
| Tests | Sidebar order and labels; AH heading "Health" at `/admin`; AH has exactly 2 buttons and no links | `AdminSidebar.nav.test.ts:86-275`, `AdminHeader.render.test.tsx:75-110` |

### 4.2 Health — `/admin`

| Dimension | Today |
|---|---|
| Header | `<header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">`, h1 "Health", purpose line, "As of … UTC" (`HealthGrid.tsx:62-74`). dup-h1 (AH says "Health") |
| KPI | 7 tiles are the page content (`evaluateHealth.ts:888-900`). `STATUS_STYLES` gives text label + icon + border per status (`HealthTile.tsx:38-84`). The tile is a `<section>` and is not clickable; only the figure links and page link are (`HealthTile.tsx:91-170`, plain `<a>` at `:119-125`, `:140-146`). Rules are shown in a `<details>` disclosure (`:151-167`) |
| Filters & URL | None. The route rejects any query param (`app/api/admin/health-summary/route.ts:129-139`) |
| Refresh | Text+icon "Refresh", `px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg`, aria-busy (`HealthGrid.tsx:76-85`) |
| Table / detail | None |
| States | "Loading…" (`:94`). Error `<p role="alert">` with the server's `error` verbatim (`:88-92`, `:45`). `.json().catch(() => null)` (`:40`) |
| Theme | Hardcoded slate. No `dark:` or `--v2` |
| Guard tests | `health.source.guard.test.ts`: green only in `GREEN_STYLE`, referenced exactly twice; never the word "OK"; no `@/lib/business-os` import. `health.render.test.tsx`: exactly one fetch with `{cache:'no-store'}` (`:116-121`); **`getAllByRole('region').length === tiles.length`** (`:144-145`); error text 'Forbidden' verbatim (`:239-243`); Refresh by name. `health.qa-slice5.render.test.tsx:114` |

### 4.3 AI cost & usage — `/admin/analytics`

| Dimension | Today |
|---|---|
| Header | h1 "Token Usage Analytics" plus a "BI System" pill (`page.tsx:590-593`). No purpose line. Not responsive. Title ≠ sidebar "AI cost & usage". AH shows "Admin Console" |
| KPI | `grid grid-cols-5` with fixed columns (`:713`). A "Total Spend" card (not clickable, ±% vs previous period, red up / green down) (`:715-732`). In the All scope, 4 clickable category `<button>` cards (`:737-859`). In BOS scope only 1 of the 5 columns is used. A "Quick Stats" side rail (`:980-1004`) and "Top Token Consumers" (`:1007-1029`) |
| Filters & URL | A scope switch (`:598-611`). Period buttons 24h/7d/30d/90d/Custom; the active one is `bg-purple-500` (`:150-156`, `:613-634`). Custom uses two `<input type="date">` + Apply. Dates mix UTC and local (`:314-316`, `:508-525`). A "Linked window" chip with X, cleared by `history.replaceState` (`:646-660`, `:256-262`). No business picker (`?user=` read once, `:265-272`). "Group By" is a list of 10 buttons (`:951-977`). An active-filters card + "Clear all" (`:869-948`). The URL is **read once** (scope, user, dateFrom, dateTo) |
| Refresh | Icon-only, no aria-label (`:636-642`) |
| Table | Native table, thead `bg-slate-900/50 text-xs uppercase`, rows `px-4 py-4` (loose), numerics right-aligned (`:1176-1353`). Status is a **glyph only** (✓ / ✗ in colour) (`:1274-1280`). Trend column is always "-" (`:1299-1302`) |
| Row detail | Aggregate row click drills down (`:381-452`). Call row opens a **hand-built framer-motion modal** with no Escape, no focus trap and no close label (`:1456-1687`). Agent details expand inline (`:1360-1453`) |
| States | Full-page spinner replaces the header (`:558-567`). Full-page error box (`:569-585`). An OK response with a non-JSON body shows a raw SyntaxError (`:335`, `:361`). Empty row "No data found" (`:1210-1217`) |
| Theme | Hardcoded slate + six accent colours |
| Guard tests | `scope.render`, `bosLens.render`, `bosLens.qa.render`, `linkedWindow.render` (**active preset class contains `bg-purple-500`**, `:157-168`; buttons "24h", "7d", "30d", "90d"; "Clear the linked window"). Testids `category-card-*`, `group-by-*`, `table-col-*`, `date-range-error`. `ownerText.guard.test.ts` pins `export default function AdminCostAnalytics` |

### 4.4 Scheduled jobs & queues — `/admin/jobs-queues`

| Dimension | Today |
|---|---|
| Header | Same family as Health (`JobsQueuesView.tsx:297-310`). The purpose sentence is **pinned verbatim** by the guard. dup-h1 |
| KPI | None. Queue cards are `rounded-xl border border-slate-700 bg-slate-800 p-4` with a `<dl>` of figures (`:205`, `:182-235`) |
| Filters & URL | None. The route rejects params (`app/api/admin/jobs-queues/route.ts:45`). The per-queue item panel has 4 state "tabs" (aria-pressed) and Previous/Next (`QueueItemsPanel.tsx:225-239`, `:312-329`) |
| Refresh | Same style as Health (`:312-321`) |
| Table | Jobs: `w-full text-left text-sm`, thead `text-xs uppercase text-slate-500`, cells `py-2 pr-4` (`:347-366`, `:109-175`). Items: `text-xs`, `py-1 pr-3` (`QueueItemsPanel.tsx:254-305`) |
| Status | `Badge` with `TONE_CLASSES` (bordered, words, **no icon**) (`:49-54`, `:89-99`) |
| Row detail | None. "View items" expands inline. Actions open `ui/dialog` with `DARK_DIALOG` |
| States | "Loading…" (`:329`); error `role="alert"` with the server error verbatim (`:279`); panel fixed strings (`QueueItemsPanel.tsx:52-53`) |
| Guard tests | `jobsQueues.source.guard.test.ts`: View has **exactly one `fetch(`** (`:118-122`); "Drain" exactly once; no "OK"; green only in `GREEN_STYLE`. `jobsQueues.render.test.tsx`: **exactly 11 buttons** on the page, each card's buttons exactly `['Drain now','View items']` (`:101-115`). 68 cases across items/drain/cancel/retry |

### 4.5 Audit trail — `/admin/audit-trail`

| Dimension | Today |
|---|---|
| Header | h1 "Audit Trail" + "System Config" badge (wrong: the page is under Monitor) + purpose line; "Export CSV" and an icon-only refresh (`page.tsx:487-513`). AH shows "Admin Console" |
| KPI | None. A results line "Showing x of N audit logs" (`:757-764`) |
| Filters & URL | A filter card with a 4-column grid (`:527-578`). Preset "BOS AI failures" (`:532-543`); account chip (`:544-568`); **BusinessAccountPicker** (`:584-587`); search; action, severity and entity native selects; **two `datetime-local` inputs, no presets** (`:655-676`); "Clear All Filters" (`:704-711`). The URL is **read once** (`:300-302`, keys `:124-135`) and never written back |
| Refresh | Two: a header icon (`:506-513`) and a text "Refresh" (`:770-777`) |
| Content | **Cards, not a table** (`:835-933`). Severity badge icon + text (`:859-867`). Server pagination of 20 per page (`:779-820`) |
| Row detail | Inline expand with a large panel (`:938-1254`) |
| States | Spinner only on first load (`:476-482`). Error box (`:716-724`). `response.ok` is never checked (`:329-339`) |
| Guard tests | 11 files in `__tests__/`. Notably: `businessPicker.render` "**leaves the URL alone**" (`:389`) and "only asks for the log list and the archive notice on mount" (`:402`); `filterDensity.render` (every control reachable by label; **Clear All is the LAST control** in the grid); `filterOptions.guard` |

### 4.6 Archiving — `/admin/archiving`

| Dimension | Today |
|---|---|
| Header | `<header className="border-b border-slate-700">` wrapper (differs), h1 "Archiving", optional "Runs off" badge, purpose line (`page.tsx:228-242`). AH shows "Admin Console" |
| KPI | None. Per-source card `rounded-lg border border-slate-700 bg-slate-800/40 p-4` with a `<dl>` of rows now / oldest / archived total / last run (`:347-395`), and "Eligible now" (`:430-444`) |
| Filters & URL | A per-source Radix `Select` for retention with `DARK_SELECT` (`:161`, `:398-428`). No URL |
| Refresh | Third style: `rounded border border-slate-600 px-3 py-2`, no aria-busy (`:244-252`) |
| Table | Run history `w-full text-left text-sm text-slate-300`, cells `py-2 pr-4`, numerics right (`:481-538`). Status `ui/badge` + `!` overrides, text only (`:124-138`) |
| Row detail | None. Archive opens a `ui/dialog` |
| States | Error box with "Try again" (`:270-288`); body error verbatim when it is a string (`:179`); `.json().catch` inline (`:177`) |
| Guard tests | `source.guard.test.ts`: **imports limited** to react, lucide-react, `@/components/ui/*`, `@/lib/archiving/config` or `types`, and files inside `app/admin/archiving` (`:55-69`). Importing from `app/admin/components/` fails it. `page.render.test.tsx` (471 lines, many testids) |

### 4.7 Businesses — `/admin/users`

| Dimension | Today |
|---|---|
| Header | h1 "Businesses", purpose `list-scope-note`, total/active pills, "Filters" toggle, icon-only refresh with **no accessible name** (`page.tsx:469-502`). AH shows "Admin Console" |
| KPI | 3 tiles that are not clickable (`:507-535`): shown or all users, Active (30 days), New today. Under the default Active filter, tiles 1 and 2 show the same number |
| Filters & URL | Search, debounced, refetches only when non-empty (`:161-169`); status native select, default active (`:553-561`); **dead "Advanced Filters"**: 4 uncontrolled selects + an "Apply Filters" stub (`:565-636`). No dates, no picker, no Clear, no URL |
| Table | `w-full`, thead `px-4 py-3`, body mixes `px-6 py-4` / `px-4 py-4` (`:656-745`); 7 columns; first 100 rows only (`:702`, `:1238-1244`). Status icon + text (`UserNameLine.tsx:60-79`), credits dot + % (`CreditsLeftCell.tsx:56-69`) |
| Row detail | **Inline expanded `<tr colSpan=7>`** with 7 blocks: BOS panel, cards, login tiles, plugins, AI spend, per-user audit, danger area (`:815-1228`) |
| States | **Full-page spinner on every fetch**, which unmounts the search box (`:452-458`). **Light** `ErrorDisplay` `bg-red-50` (`:434-450`). Raw SyntaxError or statusText (`:199-227`) |
| Guard tests | `defaultFilter.render` (**exactly seven columns**, `:128`; empty state spans 7 columns, `:164`); `source.guard` (delete-dialog page position `{isExpanded && (` → danger area → dialog, `:289-301`; `SHOW_AD1_DELETE_ENTRY=false`; `TestAccountCleanupPanel` once, after the danger area). External: `creditBands.guard.test.ts` scans every file under `app/admin/users` |

### 4.8 Plans & entitlements — `/admin/business-os-tiers`

| Dimension | Today |
|---|---|
| Header | h1 "Business OS Tiers" (≠ sidebar), "Read-only" badge, purpose + note, "Refresh" text+icon (`page.tsx:72-99`) |
| KPI | None. Inline counts (`:137`; `NotBuiltPanel.tsx:36`; `PlanCard.tsx:150`, `:180`) |
| Filters & URL | None. `AccountLookup` is a raw UUID text field + "Look up" (`AccountLookup.tsx:104-121`) |
| Content | 4 `PlanCard` articles (`page.tsx:157-161`); `EntitlementSnapshot` `<dl>` + a small table (`EntitlementSnapshot.tsx:45-101`) |
| States | Error `page-error` showing `err.message`; json() can show a raw SyntaxError (`page.tsx:54`, `:60`; `AccountLookup.tsx:62`, `:71`) |
| Guard tests | `source.guard.test.ts`: **every file imports nothing outside `app/admin/business-os-tiers`** (packages allowed) (`:57-82`); at least 6 files. `page.render`: no button label may match save, assign, apply, reset, launch, grant or revoke (`:317-326`). **An "Apply" or "Reset" button breaks it** |

### 4.9 Signup Invites — `/admin/business-os-invites`

| Dimension | Today |
|---|---|
| Header | h1 "Business OS Signup Invites" (**pinned**, `page.render :115`), purpose, "Refresh", "New invite" (`page.tsx:90-117`) |
| KPI | None. Count text (`InviteFilters.tsx:107-109`); amber "stopped halfway" banner (`page.tsx:137-153`) |
| Filters & URL | Search (client-side), State, Invite type and Issuer selects, "Clear" shown only when active (`InviteFilters.tsx:31-105`). No dates. The source guard **forbids `history.pushState` / `replaceState`** (`source.guard.test.ts:91-93`) |
| Table | `w-full text-left text-sm`, `px-3 py-2`, 10 columns, **two headed "Email"** (`InviteList.tsx:68-82`). Status is text with colour, no icon (`:31-49`). Dates YYYY-MM-DD |
| Row detail | None. Facts are stacked in the State cell (`:106-161`); revoke is an inline form |
| States | Fixed copy only, no raw text (`page.tsx:67-69`) |
| Guard tests | `source.guard.test.ts`: **exact file list** of the folder (`:47-60`); **imports only from inside the folder** + react + lucide-react (`:44`, `:62-71`); this forbids `components/ui` or any shared component |

### 4.10 Messages — `/admin/messages`

| Dimension | Today |
|---|---|
| Header | h1 "Contact Messages" + a "Messages" pill that repeats the title; unread pill; no purpose line; "Mark All Read"; icon-only refresh, no label (`page.tsx:322-360`). AH also says "Contact Messages" |
| KPI | None |
| Filters & URL | Search (clearing it does not refetch, `:71`); status select with no `[color-scheme:dark]` (`:379-388`). No URL |
| Table | `w-full`, `px-6 py-4` (loose) (`:394-419`). Status pill with colour + text (`:245-277`). Relative local dates "3h ago" (`:296-307`) |
| Row detail | **Hand-built modal** with no Escape, no focus trap and no close label (`:511-702`), plus a second hand-built Reply modal (`:705-778`) |
| States | **Early-return full-page spinner on every fetch** (`:309-315`). **No error state**: a failed GET shows "No messages found" (`:92-94`) |
| Guard tests | **None for the page.** API gate tests only (`app/api/admin/__tests__/adminGate.writes.test.ts:308-343`) |

### 4.11 Business OS AI — `/admin/business-os-llm`

| Dimension | Today |
|---|---|
| Header | h1 "Business OS AI" + "Read-only" badge; the subtitle is **Settings copy shown on every tab** (`page.tsx:148-157`). Refresh appears on Settings only: `title`, **no aria-label**, `h-5` (`:161-182`). Tabs are `role="tablist"` with purple underline, no arrow keys (`:184-204`); on-screen order Settings, Costs & credits, Activity (`TABS`, `:72-76`). `?tab=` is written by `history.replaceState` (`:86-91`). AH shows "Admin Console" |
| KPI | None on any tab |
| Settings tab | `AreaCard` articles with count chips (`AreaCard.tsx:122-168`). Loading purple spinner; **json() → raw message** (`page.tsx:128`, `:136`); no empty state |
| Costs tab | Segmented presets "Last 7 / 30 / 90 days" (`CostsTab.tsx:132-146`, active `bg-purple-500/20 text-purple-200`); From/To (UTC) + "Apply dates"; **native `<select>` for account**, not the picker (`:174-189`); icon refresh with aria-label (`:191-205`). Table constants `TH`, `TH_NUM`, `TD`, `TD_NUM` (font-mono) (`CostsSections.tsx:26-29`). `LeakCheckPanel` has its own date inputs and density (`:337-377`). json() → raw (`CostsTab.tsx:81`, `:94`; `LeakCheckPanel.tsx:312`, `:321`) |
| Activity tab | Presets Today, Yesterday, This/Last week, This/Last month (`activityPresets.ts:10-47`); From/To (UTC), Minimum cost, Apply; **BusinessAccountPicker**, imported from the audit-trail folder (`ActivityFilters.tsx:20`, `:120-122`); Area/Outcome/Trigger selects; Sort segmented; chip clears the account only (`:185-197`). **No filter in URL.** Table `min-w-full text-left text-xs`, thead `bg-slate-800/60 text-[11px] uppercase`, cells `px-3 py-2`, numerics right but not tabular (`ActivityTable.tsx:121-187`). Outcome text + icon (`:52-64`). "Open" button in the first column → **drawer** |
| Drawer | `ActivityDrillDown.tsx:296-347` on `components/ui/sheet`: `w-full overflow-y-auto border-slate-700 bg-slate-900 p-6 text-slate-200 sm:max-w-3xl [&>button]:text-slate-300` + inline `backgroundColor: 'rgb(15 23 42)'` (`:316-317`); focus returned via `onCloseAutoFocus` (`:307-310`); idle/loading/error/ready states with abort and newest-wins (`:257-294`) |
| States | `readJsonBody` + fixed fallback copy (Activity and drawer only) |
| Guard tests | `source.guard.test.ts`: **no `@/lib/` import** in any file under this directory (`:111-117`). `activityDrillDown.render`: dialog has class `[&>button]:text-slate-300` and **Close is a direct child of the dialog** (`:464-474`). `costsTab.render`: **`costs-account-filter` is a `<select>`** with option texts (`:262-276`). `activityTab.render`: **replaceState spy** keeps `history.state` + other params (`:640-656`); labels 'From (UTC)', 'Account', etc. (`:516-518`). `page.render`: subtitle text pinned (`:940-947`) |

### 4.12 Model pricing — `/admin/system-config`

| Dimension | Today |
|---|---|
| Header | h1 "Model pricing", purpose, icon refresh with aria-label (`page.tsx:240-261`). AH shows "Admin Console" |
| Content | A collapsible card (`:291-332`), a green info box (`:340-370`), a table with numerics right + font-mono, `px-6 py-4` (`:378-521`); inline row edit |
| States | **Early-return spinner** blanks the page on Refresh (`:229-235`); error banners; save/sync show `error.message` verbatim including parser text (`:155-214`); empty list = header-only table |
| Guard tests | `source.guard.test.ts`: **the whole `handleSyncPricing` and the whole Sync button are pinned VERBATIM** (`:37-90`, `:145-176`); counted fetch occurrences (`:96-118`); h1 regex (`:138-143`). `pages.render.test.tsx` R-1 to R-10 |

### 4.13 Admin users — `/admin/settings`

| Dimension | Today |
|---|---|
| Header | h1 "Admin users", "Read-only" pill, purpose, refresh with aria-label + title (`page.tsx:91-111`). AH shows "Admin Console" |
| Content | Two `<section>` cards, each with a `<ul>` of `<li>` cards (`:134-189`); an info box that is always shown (`:196-208`) |
| States | Spinner only while there is no data; fixed error copy; data cleared on failure (`:113-129`, `:77`) |
| Guard tests | `page.render.test.tsx` P-4: **the only button is Refresh**, with no input, select, textarea or form (`:140-151`); the word "role" never appears; the stale-response race test |

### 4.14 Cross-page comparison matrix

Legend: ✅ meets the standard already. ◐ partly. ✗ no. — not applicable.

| Page | Single h1 = sidebar label | Purpose line | KPI strip | Std date presets | Business picker | Clear | Refresh (std) | Filters in URL | Table std | Num right + tabular | Status text+icon | Drawer | No raw parser error | Light-OS safe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Health | ◐ dup-h1 | ✅ | ◐ tiles | — | — | — | ◐ "Refresh" | — | — | — | ✅ | — | ✅ | ✅ |
| AI cost & usage | ✗ | ✗ | ◐ | ◐ 24h/7/30/90 | ✗ | ◐ | ✗ icon-only | ◐ read once | ◐ loose | ◐ right only | ✗ glyph | ✗ modal | ✗ | ✗ modal |
| Jobs & queues | ◐ dup-h1 | ✅ | ✗ | — | — | — | ◐ "Refresh" | — | ◐ | ✗ | ◐ no icon | — | ◐ server text | ✗ dialog X |
| Audit trail | ✗ | ✅ | ✗ | ✗ datetime | ✅ | ✅ | ✗ two | ◐ read once | ✗ cards | — | ✅ | ✗ inline | ✅ | ✅ |
| Archiving | ✗ AH | ✅ | ✗ | — | — | — | ✗ 3rd style | — | ◐ | ◐ right | ◐ no icon | — | ✅ | ✗ dialog X |
| Businesses | ✗ AH | ✅ | ◐ not clickable | ✗ | ✗ | ✗ | ✗ no name | ✗ | ✗ mixed | ◐ | ✅ | ✗ inline | ✗ | ✗ dialog X |
| Plans & entitlements | ✗ | ✅ | ✗ | — | — | — | ◐ | — | ◐ | — | ◐ text | — | ✗ | ✅ |
| Signup Invites | ✗ | ✅ | ✗ | ✗ | ✗ | ◐ | ◐ | ✗ guard forbids | ◐ | — | ◐ no icon | ✗ in-cell | ✅ | ✅ |
| Messages | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ no name | ✗ | ✗ loose | — | ◐ | ✗ modal | ✗ no error | ✗ select, modal |
| BOS AI Settings | ✗ AH | ✗ shared copy | ✗ | — | — | — | ✗ no aria | ◐ tab only | — | — | ✅ chips | — | ✗ | ✅ |
| BOS AI Costs | ✗ AH | ✅ intro | ✗ | ◐ 7/30/90 | ✗ select | ✗ | ✅ | ✗ | ◐ | ◐ mono | ◐ | — | ✗ | ✅ |
| BOS AI Activity | ✗ AH | ✅ intro | ✗ | ◐ other set | ✅ | ◐ account only | ✅ | ✗ | ✅ template | ◐ not tabular | ✅ | ✅ template | ✅ | ◐ title (F-65) |
| Model pricing | ✗ AH | ✅ | ✗ | — | — | — | ◐ icon | — | ◐ loose | ✅ mono | ◐ | — | ✗ | ✅ |
| Admin users | ✗ AH | ✅ | ✗ | — | — | — | ◐ icon | — | — cards | — | ◐ text | — | ✅ | ✅ |

### 4.15 The six date-range implementations

| # | Where | Presets | Custom | Time basis | URL |
|---|---|---|---|---|---|
| 1 | AI cost & usage `analytics/page.tsx:150-156`, `:613-709` | 24h, 7d, 30d, 90d | 2 × date + Apply | **Mixed UTC and local** (`:314-316`) | Read once; linked window clears via `replaceState` |
| 2 | Costs `CostsTab.tsx:43-55`, `:132-172` | Last 7, 30, 90 days (segmented) | From/To (UTC) + "Apply dates" | UTC | No |
| 3 | Activity `activityPresets.ts:10-47`, `ActivityFilters.tsx:74-116` | Today, Yesterday, This/Last week (ISO), This/Last month | From/To (UTC) + Apply | UTC | No |
| 4 | Learning system (parked) `learning-system/page.tsx:70`, `:321-327` | 7d, 30d, 90d | None | Local | No |
| 5 | Platform dashboard (parked) `platform-dashboard/page.tsx:37-42` | 7d, 30d, 90d, 1y | None | — | No |
| 6 | Audit trail `audit-trail/page.tsx:655-676` | None | 2 × `datetime-local` | Local input, sent as given | Read once (`date_from`, `date_to`) |

### 4.16 Refresh-button styles

| Style | Pages |
|---|---|
| A. Text "Refresh" + icon, bordered `bg-slate-800 border-slate-700 px-3 py-1.5`, aria-busy | Health, Jobs & queues |
| B. Text "Refresh" + icon, other classes | Plans & entitlements, Signup Invites, Audit trail (results bar) |
| C. Bordered `rounded border-slate-600 px-3 py-2`, no aria-busy | Archiving |
| D. Icon-only, **no accessible name** | AI cost & usage, Businesses, Messages, Audit trail (header) |
| E. Icon-only, `title` only, no aria-label | BOS AI Settings |
| F. Icon-only with aria-label | BOS AI Costs ("Re-read the cost report"), Activity ("Re-read the AI activity"), Model pricing ("Refresh"), Admin users |

### 4.17 Status-chip implementations

| Implementation | Where | Text | Icon |
|---|---|---|---|
| `STATUS_STYLES` (label + icon + border) | `HealthTile.tsx:38-84` | ✅ | ✅ |
| `Badge` + `TONE_CLASSES` (bordered) | `JobsQueuesView.tsx:49-99` | ✅ | ✗ |
| `ui/badge` + `!` overrides | `archiving/page.tsx:124-138` | ✅ | ✗ |
| Glyph ✓ / ✗ | `analytics/page.tsx:1274-1280` | ✗ | glyph only |
| `Chip` tones + `RecordStateMarker` | `business-os-llm/components/Chip.tsx:18-25`, `RecordStateMarker.tsx:30-108` | ✅ | ✅ (marker) |
| Outcome label | `ActivityTable.tsx:52-64` | ✅ | ✅ |
| Severity badge | `audit-trail/page.tsx:859-867` | ✅ | ✅ |
| `UserNameLine` / `CreditsLeftCell` | `users/components/*` | ✅ | ✅ / dot |
| `STATE_STYLE` / `EMAIL_STYLE` | `InviteList.tsx:31-49` | ✅ | ✗ |
| `getStatusBadge` pills | `messages/page.tsx:245-277` | ✅ | partly |
| `STATUS_CLASS` pills | `LeakCheckPanel.tsx:63-68` | ✅ | ✗ |
| PlanCard chips | `PlanCard.tsx:56-116` | ✅ | ✗ |

---

## 5. The standard

### 5.1 Target page (wireframe)

```text
+--------------------------------------------------------------------------------------------+
| AdminHeader (shell): [menu]                               Fri 9 Oct 2026   Admin  [Sign out]|  <- no title
+--------------------------------------------------------------------------------------------+
| AI cost & usage                                                     [Read-only]            |  <- h1 (= sidebar label)
| What Business OS and agent-platform AI calls cost, by provider, model and feature.         |  <- one-line purpose
|--------------------------------------------------------------------------------------------|
| +----------------+ +----------------+ +----------------+ +----------------+                |
| | Total spend    | | Calls          | | Tokens         | | Avg cost/call  |                |  <- KPI strip (3-5)
| | $412.18        | | 18,204         | | 9.1 M          | | $0.0226        |                |     whole tile = link
| | ! Needs a look | |                | | 6.8 M in       | |                |                |     status = icon+text
| | may be partial | |                | | 2.3 M out      | |                |                |
| +----------------+ +----------------+ +----------------+ +----------------+                |
|--------------------------------------------------------------------------------------------|
| Window [Today][7 days][30 days][This month][Custom]  Business [Search a business...  v]     |  <- filter bar
| (Custom:) From (UTC) [2026-10-01] To (UTC) [2026-10-09] [Apply]                            |
| Area [All areas v]  Outcome [All v]                     [Clear]  Read at 14:02 UTC [Refresh]|
| Business: Eyal Fitness  [x]                                                                |  <- active chips
|--------------------------------------------------------------------------------------------|
| 214 actions, newest first                                                                  |  <- count line
| +----------------------------------------------------------------------------------------+ |
| | DETAILS | TIME (UTC)        | BUSINESS      | AREA    | OUTCOME     |   COST USD | CRED | |
| |---------+-------------------+---------------+---------+-------------+------------+------| |
| | [Open]  | 2026-10-09 13:58  | Eyal Fitness  | crm     | (x) Failed  |    0.0123  |   12 | |
| | [Open]  | 2026-10-09 13:41  | Unnamed 3fa2  | booking | (v) Succeed |    0.0051  |    5 | |
| +----------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------- +-------------------+
                                                                         | AI action  crm.x [X]|  <- drawer (right,
                                                                         |--------------------|     sm:max-w-3xl)
                                                                         | Action             |
                                                                         |  Time   2026-10-.. |
                                                                         |  Cost   0.0123 USD |
                                                                         | Audit entry        |
                                                                         |  ...               |
                                                                         +--------------------+
```

Region order is fixed: **header → KPI strip → filter bar → content → (drawer)**. Regions that do not apply are omitted. They are not left as empty boxes.

### 5.2 Surface and theme rules (apply to every region)

| # | Rule |
|---|---|
| T-1 | Admin is **always a dark surface**, whatever the OS mode. Shared components use explicit slate classes only. |
| T-2 | Shared components **never** use `--v2-*` tokens or `dark:` variants. Both are inert or undefined under `/admin` (§4.1). |
| T-3 | Shared components **never rely on `cn()` to override a primitive's class**. When a primitive ships a token class (sheet, dialog, select), the admin wrapper wins by a child selector (`[&>button]:…`), an inline `style`, or by not using the primitive. The `ActivityDrillDown` approach (`:311-317`) is the template. |
| T-4 | Native form controls render dark: `[color-scheme:dark]` is set once on the `AdminChrome` root (L-1a). Dialogs and sheets render outside the chrome (they portal to `body`), so **`ADMIN_DIALOG_CLASS` and `AdminDrawer` carry `[color-scheme:dark]` themselves** (SA Q-9, SA-R-7). `--v2-*` is not defined for admin. |
| T-5 | Meaningful text is **slate-400 or lighter** on slate-800/900. `text-slate-500` is only for decoration, never for information (it is roughly 3.7:1 on slate-900, which is below AA for small text). |
| T-6 | Only one green, and only for proven-clear or succeeded states. Green is never used as decoration (Health `GREEN_STYLE` discipline, `HealthTile.tsx:33-43`). |
| T-7 | Accent colour is purple (`purple-500`). It is used for the active preset, focus rings and primary buttons. No per-page accent palettes. |

### 5.3 Header

| Element | Rule | Base |
|---|---|---|
| Wrapper | `<header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">` | `HealthGrid.tsx:62` |
| Title | Exactly one `<h1 className="text-xl font-semibold text-white">` per page. The text equals the **sidebar label** (D-3 (a), decided) | HealthGrid `:64` |
| Purpose | One sentence, `<p className="mt-1 max-w-3xl text-sm text-slate-400">`, saying what the page is for. Tabs: the purpose line is per tab | HealthGrid `:65` |
| Badge | At most one, and only a factual state ("Read-only", "Runs off"). Rendered with the status chip (`neutral` tone). Decorative pills ("BI System", "System Config", "Messages") are removed | — |
| Actions | Right side: page actions only ("New invite", "Export CSV"). **Refresh is not here** (it lives in the filter bar, §5.5) | — |
| As-of | Optional `text-xs text-slate-400` line ("As of 14:02 UTC …") when the page shows a server clock | HealthGrid `:70-73` (moved off slate-500 per T-5) |
| Tabs | Below the header: `role="tablist"`, underline style of `business-os-llm/page.tsx:184-204`, **plus Left/Right arrow keys** and the tab in `?tab=` | — |
| Shell | `AdminHeader` no longer renders a page title (§6, C-1). The sidebar is not changed (§2.3 X-1, X-2) | — |

### 5.4 KPI strip

| # | Rule |
|---|---|
| K-1 | **3 to 5 tiles.** A page with fewer than 3 meaningful headline numbers has **no strip** (D-5 (a), decided). Do not pad it with filler. |
| K-2 | Grid `grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5`. It is responsive, unlike today's `grid-cols-5`. |
| K-3 | A tile = label (`text-sm font-medium text-white`), value (`text-2xl font-semibold tabular-nums text-white`), optional sub-line (`text-xs text-slate-400`), and a status row when coloured. |
| K-4 | **Colour = Health `STATUS_STYLES`** (`HealthTile.tsx:38-84`): card border + accent, and **always the icon + text label** (Needs action / Needs a look / Healthy / Not measured yet / Could not check). `neutral` tiles show **no status row** and use the `border-slate-700` card. |
| K-5 | A tile is coloured **only** from (i) a status that the page's own payload already carries (an aggregate of per-item statuses from that payload is allowed), or (ii) an amber or red notice that the page already renders for the same condition. A page **never re-computes a status from a rule that lives elsewhere** (for example `lib/admin/health/rules.ts`, which the BOS AI and Jobs pages cannot import anyway): a client copy of a server rule is a second source of truth. **No new thresholds** in a layout slice. Where neither (i) nor (ii) applies, the tile is neutral (D-4 (a), decided). (SA-R-4.) |
| K-6 | **The whole tile is a link** to its detail: either the same page with a filter set (a URL change, §5.5) or another page. The tile is an `<a>`, **never a `<button>` and never a `<section>`**. This keeps the Jobs "exactly 11 buttons" and Health "region count" tests valid. **Same-page tile (SA Q-14):** it renders `<a href>` for the filtered view; a plain left click calls `preventDefault` and applies the filter through `useAdminFilters`; a modified click, a middle click or copy-link uses the href. **Cross-page tile:** `next/link`. **Same-page anchor tile** (Jobs `#jobs` / `#queues`): a plain `<a href="#…">`. A tile with no possible target is not a link and says nothing about clicking. On a page that keeps no filters in its URL (Signup Invites, D-7 (a)), tiles are not links. |
| K-7 | Each tile's accessible name reads label, value and status, for example "Total spend, $412.18, needs a look". |
| K-8 | A figure that is a lower bound or covers only the rows shown says so in its sub-line ("at least", "of the 500 shown"). This is the Health lower-bound pattern (`evaluateHealth.ts:499-513`). |
| K-9 | KPIs use **only data the page already fetches**. Anything else is NEEDS DATA → a separate full-cycle slice. |
| K-10 | Loading: tiles render as fixed-height placeholders, so there is no layout jump. Error: the strip is hidden and the page error state shows. |

### 5.5 Filter bar

**Layout:** one block, `flex flex-wrap items-end gap-3`, below the KPI strip and above the content. When it holds filter controls it is `<div role="search" aria-label="Filters">`. **A bar that holds only Refresh is a plain `<div>`** with no role (SA-R-13). The bar never renders a `<section>` or `role="region"` (§5.12 A-9). Its parts appear in a fixed order:

| Order | Control | Rule |
|---|---|---|
| 1 | **Window** | Segmented `role="group" aria-label="Window"`, buttons with `aria-pressed`. Active `bg-purple-500/20 text-purple-200`, inactive `text-slate-300 hover:bg-slate-800` (Costs / Activity, `CostsTab.tsx:132-146`). Standard set: **Today · 7 days · 30 days · This month · Custom**, then any extra choice the page already has today, shown after the five (D-2 (b), decided; no new extras without asking the user). Shown only on time-windowed pages |
| 2 | Custom range | Appears when Custom is chosen: native `<input type="date" className="[color-scheme:dark] …">` labelled **"From (UTC)" / "To (UTC)"** + **"Apply"**. If From is after To, an inline error (`role="alert"`) is shown and nothing is fetched (Analytics `date-range-error` behaviour) |
| 3 | **Business** | The shared business picker (generalised `BusinessAccountPicker`, §6 C-6), label **"Business"**. Shown only on pages whose data is per business |
| 4 | Page filters | Native `<select>` / text inputs, each with a visible `<label>` (`text-[11px] text-slate-400` field label, Activity `FIELD`). Native, not Radix (SA Q-12). **Free-text search is held by the page and never written to the URL** (SA-R-8, D-6 (a), decided) |
| 5 | **Clear** | Text button "Clear". Always rendered; disabled when every filter is at its page default. Resets all filters to the page defaults |
| 6 | Read-at + **Refresh** | Pushed right (`ml-auto`). "Read at HH:mm UTC" (`text-xs text-slate-400`) + one button: text **"Refresh"** + `RefreshCw h-4 w-4` (spins while busy), `aria-busy`, `aria-label="Refresh {what}"`, `rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700` (Health style A). **Read-at is omitted on a page whose header already shows a server "As of"** (Health, Jobs), so the page never shows two clocks (SA re-check) |
| 7 | Active chips | Row below: one chip per non-default filter that the controls cannot show at a glance (business, linked window). Each chip has an X with aria-label "Remove {filter}" |

**A page with no filters** (Health, Jobs, Plans, Model pricing, Admin users, BOS AI Settings) still renders the bar with only part 6, as a plain `<div>`, so **Refresh is in the same place on every page**.

**Refresh behaviour:** re-runs the current query unchanged. It does not touch the URL or the filters. Visible data stays on screen while reading (no unmount). It updates "Read at". On failure, the page keeps its existing choice of keeping the stale data or clearing it. Admin users and Archiving deliberately clear (`settings/page.tsx:77`, `archiving/page.tsx:184`), and that is kept.

**Apply semantics:** presets, selects and the business picker apply at once. Typed inputs (custom dates, minimum cost, search) apply on "Apply", or on debounce for search. A preset click **discards** unapplied typed input, and the inputs show the applied values. This resolves F-73.

### 5.6 Filter-bar URL contract

| # | Rule |
|---|---|
| U-1 | Every applied filter is written to the URL. Filters on the page and in the URL are always the same. Opening the URL reproduces the view. **Two deliberate exceptions:** (1) **free-text search is never written** (it holds emails and names, which would land in browser history and in server request logs on reload or share; SA-R-8, D-6 (a)). A page that reads `search` from an inbound link today (Audit trail) keeps reading it. (2) **Signup Invites writes no filters to the URL** (D-7 (a); reason and visual conformance in §7.9). |
| U-2 | Writes **replace** the current history entry, so they create no Back entries. Unrelated params (`tab`) are kept. **Mechanism (SA Q-2):** `window.history.replaceState(window.history.state, '', url)`, inside `useAdminFilters` only, never `router.replace`. The hook owns filter state and the URL is its projection; the hook refreshs `useSearchParams` only when the search string differs from the last one it wrote. |
| U-3 | Params equal to the page default are **omitted** (clean URLs). Clear removes every filter param and keeps `tab`. |
| U-4 | Unknown or invalid values are ignored silently (that filter falls back to its default). The page never errors on a bad link. |
| U-5 | **Canonical names** (approved, SA Q-10): `range`, `from`, `to`, `account`; page filters use lower snake_case (`entity_type`, `min_cost`, `group_by`). |
| U-6 | `range` values: `today`, `7d`, `30d`, `this_month` (SA: the existing `activityPresets.ts` id, not `month`), `custom`, plus the extras pages keep under D-2 (b) (`yesterday`, `this_week`, `last_week`, `last_month`, `24h`, `90d`). |
| U-7 | `from` / `to`: a UTC date `YYYY-MM-DD` (inclusive calendar days), **a UTC minute `YYYY-MM-DDTHH:mm` (the form Health's audit links and the Activity cutover link emit today, `lib/admin/health/windows.ts:49-51`, `activityCopy.ts:77`), forwarded to the route verbatim as today**, or a full ISO instant with offset (a **linked window** from another page). A one-sided window (only `to`, as the cutover link sends) is valid. If `from`/`to` are present without `range`, `range=custom` is implied. (SA-R-1, corrected by SA.) An instant window shows as the chip "Linked window {from} to {to} UTC" with an X (Analytics pattern, `analytics/page.tsx:646-660`). Removing the chip returns to the page default. |
| U-8 | Preset semantics, all UTC: Today = today 00:00 to now. "N days" = the last N UTC calendar days including today. This month = the 1st to now. Extras follow `activityPresets.ts` (ISO weeks). A page maps the resolved window onto **its existing server params**, so no API change is made (Analytics keeps `period=N` for presets, a rolling window; F-94). |
| U-9 | **Legacy aliases are read and never written, and are never removed** (links may be bookmarked). When an alias is read, the page rewrites the URL to canonical names by replace. |
| U-10 | The drawer's open row is **not** in the URL in v1 (B3 deep link stays planned, `ActivityTab.tsx:22-23`). |

**Existing inbound links that must keep working:**

| Link source | Target and params | Handling |
|---|---|---|
| Health figure links (`evaluateHealth.ts:377-384`) | `/admin/audit-trail?action&severity&date_from&date_to` | `date_from`/`date_to` = aliases of `from`/`to` (instants → linked window). `action`, `severity` stay page params |
| Health spend tile (`evaluateHealth.ts:386-389`) | `/admin/analytics?scope=bos&dateFrom&dateTo` | `dateFrom`/`dateTo` = aliases. `scope` stays a page param |
| Health settings / jobs / tiers links | `/admin/business-os-llm`, `/admin/jobs-queues#jobs` / `#queues`, `/admin/business-os-tiers` | No params. The anchors `#jobs` / `#queues` must still exist |
| Businesses panel (`users/components/BusinessOsPanel.tsx:74-78`, `:247-252`) | Audit trail with `user_id` and others; analytics `?scope=bos&user=` | `user_id` (audit) and `user` (analytics) = aliases of `account` |
| Activity tab (`activityTab.render.test.tsx:439`, `:456`) | `/admin/analytics?scope=bos&user=` | As above |
| Activity cutover notice (`CutoverNotice.tsx:22-30`) | `/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29T16:51&user_id=`; `/admin/analytics?scope=bos&user=` | `date_to` alone, minute form (U-7). Added by SA (SA-R-2) |
| Audit trail own keys (`audit-trail/page.tsx:124-135`) | `action, severity, date_from, date_to, search, entity_type, user_id` | Kept, plus the aliases above. `search` is read, never written (U-1, SA-R-8) |
| BOS AI tabs | `?tab=settings` / `costs` / `activity` | Unchanged |

Outbound link builders (Health, Businesses, Activity) may keep emitting the legacy names. Moving them to canonical names is optional and is done only in the slice of the page that **emits** them.

### 5.7 Content: table

Template: Activity (`ActivityTable.tsx:121-187`), with numeric styling unified.

| Element | Class / rule |
|---|---|
| Wrapper | `overflow-x-auto rounded-xl border border-slate-700` |
| Table | `min-w-full text-left text-sm text-slate-300`, plus an `aria-label` or sr-only `<caption>` |
| Head | `bg-slate-800/60`; `th` `px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400`, `scope="col"`. Header texts unique (no two "Email") |
| Body | `divide-y divide-slate-800`; `td` `px-3 py-2 align-top`. **One density for all pages** (it replaces `py-4` / `px-6` and `py-1`) |
| Numbers | **Right-aligned + `tabular-nums` + `whitespace-nowrap`**, header right-aligned too. Not `font-mono`. Money: fixed decimals per page unit, currency in the header ("Cost USD") |
| Ids | Shortened `font-mono text-[11px]`, full id in `title` (Activity `:160-162`) |
| Missing value | "Unknown" or an em dash, never blank |
| Status | Status chip (§5.9) |
| Count line | Above the table, `text-xs text-slate-400`: "N items" / "Showing the top N of M, newest first" |
| Footer totals | `tfoot` row, `font-medium text-slate-200`, numbers per the rule above |
| Pagination | Not changed by the standard. Existing server paging (Audit trail) keeps its controls, restyled with the shared button style |
| Wide tables | Scroll horizontally inside the wrapper. The page does not scroll sideways |

**Non-table content** (Health tiles, queue cards, plan cards, archiving source cards, BOS AI area cards, admin-user lists) stays as cards. The standard applies as follows:

| Rule | |
|---|---|
| Card shell | `rounded-xl border border-slate-700 bg-slate-800/40 p-4`; title `<h2 className="text-sm font-semibold text-white">` |
| Figures | `<dl>`, `dt` `text-xs text-slate-400`, `dd` `text-sm text-slate-200`, numbers `tabular-nums` |
| Status | The status chip. Health tiles keep their own `STATUS_STYLES` card (they are the reference) |
| Grid | `grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3` |
| When to use a table instead | Homogeneous records that are listed, filtered or opened one by one (audit events, messages, invites) use the table. Cards are for a small fixed set of differently-shaped things |

### 5.8 Content: open a row (drawer)

Template: `ActivityDrillDown.tsx:296-347`.

| # | Rule |
|---|---|
| D-1 | A row with more detail than its cells opens a **right-side drawer** (`AdminDrawer`, §6 C-9). No hand-built modals and no inline expanding rows. |
| D-2 | The opener is a first-column button: "Open" + `PanelRightOpen` icon, with an accessible name naming the row ("Open details for …"). Clicking anywhere on the row may also open it, but the button is the keyboard path. |
| D-3 | A row whose purpose is **drilling into a filtered view** (Analytics aggregate rows) is a link that sets the filter. That is navigation, not "open a row". |
| D-4 | Drawer: `side="right"`, `w-full sm:max-w-3xl`, `bg-slate-900 p-6 text-slate-200`, `[color-scheme:dark]`, inline `backgroundColor: 'rgb(15 23 42)'`, close button colour **and focus ring** set by child selector. The title colour is set so it cannot lose to the sheet's token class (F-65). |
| D-5 | Title `text-lg font-semibold text-slate-100` + optional `font-mono text-sm text-slate-400` suffix. Body = `Section` (h3 `text-sm font-semibold text-slate-100`, `aria-labelledby`) and `Field` (`dl` grid `grid-cols-[max-content_1fr]`). The section is not a landmark region (A-9). |
| D-6 | Escape, overlay click and X close it. Focus is trapped inside. **Focus returns to the opener** (`onCloseAutoFocus` → opener ref). |
| D-7 | Data: idle / loading / error / ready, with abort on close and newest-wins. A 404 has fixed copy. Bodies are read through `readJsonBody` (§5.10). |
| D-8 | Actions on a row (Give credits, Delete, Revoke) live **inside** the drawer or the row's action cell. Confirmations use `ui/dialog` with the shared admin dialog class (§6 C-10). |

### 5.9 Status chip

| Tone | Classes (border, bg, text) | Icon (lucide, `aria-hidden`) | Meaning |
|---|---|---|---|
| danger | `border-red-500/40 bg-red-500/15 text-red-300` | `AlertOctagon` or `XCircle` | Needs action / failed |
| warn | `border-amber-500/40 bg-amber-500/15 text-amber-300` | `AlertTriangle` | Needs a look / partial / stalled |
| ok | `border-emerald-500/40 bg-emerald-500/15 text-emerald-300` (**the only green**) | `CheckCircle2` | Healthy / succeeded / clear |
| info | `border-sky-500/40 bg-sky-500/15 text-sky-300` | `Info` | Running / unread / informational |
| neutral | `border-slate-600 bg-slate-700/40 text-slate-300` | optional | Plain state words |
| unknown | `border-dashed border-slate-600 bg-slate-800/60 text-slate-400` | `CircleDashed` or `HelpCircle` | Not measured / could not check |

Shape: `inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap` (Jobs `Badge`, `JobsQueuesView.tsx:89-99`). **Text is always present.** The icon is required for danger, warn, ok and unknown. Rendered as `<span>`, never `<div>` (fixes F-62).

### 5.10 States

| State | Rule |
|---|---|
| Loading (first) | Header, KPI placeholders and filter bar **stay mounted**. The content area shows `RefreshCw h-5 w-5 animate-spin text-purple-500` + "Reading {what}…" (`text-sm text-slate-300`). **No early-return full-page spinners.** |
| Loading (refresh / filter change) | Keep the current content, set `aria-busy` on the content area, and spin Refresh. |
| Error | `role="alert"` box `rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200` + `AlertCircle` + "Try again" button. |
| Error copy | (1) the route's own `error` string, when the body is readable JSON (our routes return user-facing copy per CLAUDE.md); (2) otherwise the page's **fixed fallback** "Could not read {what}. Try again in a moment."; (3) a network failure → the fixed "Could not reach the server. Check your connection and try again."; (4) **never** `err.message` from a parser and never `response.statusText`. |
| JSON reads | Every fetch body goes through `readJsonBody` (`app/admin/business-os-llm/readJsonBody.ts:17-24`, moving to the shared folder in L-1a), and the status is checked before the body. `response.json()` is never called directly. |
| Empty | `rounded-xl border border-slate-700 bg-slate-800/40 p-8 text-center`: a plain sentence ("No AI actions match this window and these filters.") + a hint + a "Clear filters" button when filters are active. |
| Partial / incomplete | Amber notice `rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200` stating what is missing, above the content. |
| Session ended | 401/403 → the fixed "Your admin session has ended. Sign in again." (Jobs `SESSION_ENDED` pattern). |

State containers are plain elements, never landmark regions (A-9).

### 5.11 Dates and numbers

| Item | Rule |
|---|---|
| Time zone | **UTC everywhere** on admin. Column headers say "(UTC)", or the page's intro says "Times are UTC" once. |
| Date-time | `YYYY-MM-DD HH:mm` (UTC), one shared formatter generalised from `jobsFormat.ts:14` (`formatUtc`). |
| Date | `YYYY-MM-DD`. |
| Relative | Allowed only as a secondary hint next to the absolute time ("3 h ago"), never alone. |
| Counts | `toLocaleString('en-US')` thousands separators, `tabular-nums`. |
| Money | Per-page precision is kept (no data change). Currency is always named. Never summed across currencies (CLAUDE.md). |

### 5.12 Keyboard and accessibility

| # | Rule |
|---|---|
| A-1 | Every interactive element has a visible focus ring: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500`. No `ring-ring` token (it has no colour, F-66). |
| A-2 | Every icon-only button has an `aria-label`. `title` alone is not enough. |
| A-3 | Escape closes the drawer, dialogs and the picker list. Focus returns to the opener. |
| A-4 | Segmented controls use `role="group"` + `aria-pressed`. Tabs use `role="tablist"` + arrow keys. |
| A-5 | Tab order: header actions → KPI tiles → filter bar → content → pagination. |
| A-6 | Exactly one `<h1>` per page. Regions use `h2`, drawer sections `h3`. |
| A-7 | Status is never colour alone (§5.9). |
| A-8 | **Both colour schemes:** every shared component and every migrated page is checked in light and in dark scheme (SA Q-8: browser emulation of the light/dark preference counts). Admin looks the same in both. |
| A-9 | **Shared components never render a landmark region**: no `role="region"` and no `<section>` with an accessible name. This keeps Health's region-count test valid (SA-R-13). The filter bar is `role="search"` only when it holds filter controls (§5.5). |

---

## 6. Shared components

Location: **`app/admin/components/layout/`** (approved, SA Q-1). Everything is `'use client'` except pure helpers.

### 6.1 Rules for the shared folder

These rules are enforced by C-14, which ships in L-1a (SA-R-6, SA Q-1, Q-3, Q-7).

| # | Rule | Why |
|---|---|---|
| S-1 | Pages import the folder **only through the alias** `@/app/admin/components/layout/`. Relative paths into the folder stay refused by page guards | One recognisable line per page guard (SA Q-3) |
| S-2 | **No file in the folder is named** `page`, `layout`, `template`, `default`, `loading`, `error`, `not-found`, `global-error` or `route` (any extension) | These are Next special-file names, and they match the render-entry rule of the required admin access guard (`admin-authz-surface.guard.test.ts:882-883`) |
| S-3 | **Import allow-list:** react, lucide-react, next/link, next/navigation, `@/components/ui/sheet`, `@/components/ui/dialog`, `@/lib/logger/client`, and files inside the folder. Nothing else | Page guards check only their own files; without this, one allow-list line in a page guard would let any import in transitively |
| S-4 | **Never** imports `@/lib/business-os/**` (the entitlements module included, even type-only), repositories, Supabase or `server-only`, and **writes no plan-tier or capability literal** | So no layout slice ever touches the required entitlements invariants check |
| S-5 | No `var(--v2-`, no `dark:`, no `console.`. Logging is `clientLogger.child({ module })` from `@/lib/logger/client` (SA Q-6) | T-2; CLAUDE.md logging |
| S-6 | No direct `.json(` outside `readJsonBody`. `history.pushState` / `history.replaceState` appear only in the `useAdminFilters` file | §5.10; SA Q-2 |
| S-7 | Exactly one green constant | T-6 |
| S-8 | No landmark regions: no `role="region"`, no `<section>` with an accessible name | A-9, SA-R-13 |
| S-9 | No override that relies on `cn()` ordering (checked in code review; `cn()` stays a plain join, SA Q-5) | T-3 |
| S-10 | The guard runs inside the existing Jest gate: pure file reads, no new workflow, no npm script, no added CI time | SA Q-7; standing "no added CI time" preference |

### 6.2 Components

| # | Component | Built from (generalises) | What is new, and why | Gaps to close in the generalisation | Slice |
|---|---|---|---|---|---|
| C-1 | Shell change in `AdminHeader` and `AdminChrome` | `AdminHeader.tsx:34-43`, `:64-72`; `AdminChrome.tsx:32` | Remove the page-title `<h1>` and the dead `getPageTitle` / `usePathname` use (SA Q-11: safe, all 28 pages render their own h1), so each page owns the single h1; add aria-label "Open menu" to the mobile button; `[color-scheme:dark]` on the `AdminChrome` root (Q-9). The sidebar is not touched (§2.3 X-1) | `AdminHeader.render.test.tsx` "keeps the page title" (heading "Health" at `/admin`) becomes "renders no heading"; add "the menu button is named Open menu"; "exactly 2 buttons, no links" unchanged. Temporary exposure accepted: Analytics, Businesses, Messages and Model pricing show no h1 while their early-return spinner shows, until their own slice | L-1a |
| C-2 | `AdminPageHeader` | `HealthGrid.tsx:62-86` | Props: `title`, `purpose`, `badge?`, `actions?`, `asOf?`. Exists so the h1, purpose and badge rules (§5.3) cannot drift. Its first consumer is the page it is generalised from (Health) | — | L-1a |
| C-3 | `AdminStates` (`AdminLoading`, `AdminError`, `AdminEmpty`, `AdminNotice`) | `ActivityTab.tsx:207-257`, `archiving/page.tsx:270-288`, Costs `costs-empty` | One place for §5.10 copy and classes | Error copy precedence (§5.10) is built in. Health uses `AdminLoading` and `AdminError`; `AdminEmpty` and `AdminNotice` are built in the first pilot that uses them (likely L-1c Audit trail), recorded in §1 at workplan | L-1a (loading, error); L-1b or L-1c (empty, notice) |
| C-4 | `readJsonBody` + `readAdminResponse` | `business-os-llm/readJsonBody.ts:17-24` | Move to the shared folder. Add a small helper that returns `{ ok, status, body, message }` with the §5.10 precedence. Neither helper calls `fetch` (Health's single-fetch pin, §7.1). **L-1a turns the old `business-os-llm/readJsonBody.ts` into a one-line re-export** (a recorded cross-folder edit); **L-8 points its importers (Activity tab and drawer) at the shared file and deletes it** (SA-R-3; deleting slice moved from L-1d to L-8, re-check R-10) | Free of `@/lib/` (§6.1 S-3) | L-1a |
| C-5 | `formatUtc`, `formatUtcDate`, `formatCount` | `components/jobs/jobsFormat.ts:14-28` | Shared, so every page prints time the same way. Health's "As of" is the first consumer (`formatUtc`); an export Health does not use moves to the first pilot that does | `jobsFormat` stays for Jobs until L-1b, where Jobs moves to the shared formatter | L-1a (L-1b / L-1c for exports Health does not use) |
| C-6 | `AdminBusinessPicker` | `audit-trail/BusinessAccountPicker.tsx` (342 lines) | Generalise the original rather than fork it | **Hardcoded DOM ids** `audit-business-picker` / `audit-business-options` (`:217`, `:228`, `:251`) → `useId()`; **fixed "Account" label** (`:217-219`) → `label` prop, default "Business"; no `id` / `placeholder` / `hint` props; the permanent hint (`:336-339`) → optional; input `text-sm py-1.5` + **blue** ring (`:246`) → filter-bar size + purple ring; logger `createLogger` in client (`:46`) → `clientLogger.child` (Q-6); the chosen business is not echoed → include the "Business: {name} [X]" chip (Activity `:185-197`), with a short id until a name is known. **First consumer: Audit trail (L-1c)**, the page the original was built for. Later consumers move in their own slices: AI cost & usage L-2a, Activity L-8, Costs L-9. **The original file stays in the audit-trail folder until L-8**, because Activity imports it (`ActivityFilters.tsx:20`); L-8 deletes it (recorded cross-folder edit) | L-1c (moves to L-1d if the L-1c workplan exceeds a few days) |
| C-7 | `useAdminFilters` (URL filter state) | `business-os-llm/page.tsx:81-91` (`writeTabToUrl`), Analytics linked window `:250-262`, audit `filtersFromUrl` `:124-135` | A typed spec per page (`{ key, default, parse, serialise, aliases }`) → state and URL kept in step per §5.6. Writes by `window.history.replaceState(window.history.state, '', url)` inside this file only (Q-2). The hook owns filter state; it refreshs `useSearchParams` only when the search string differs from the last one it wrote. A spec key may be marked page-only (free-text search, SA-R-8): it is held in state and never written | First pilot is Audit trail (L-1c): it exercises the aliases `date_from` / `date_to` / `user_id`, the minute form and instants (U-7), and a read-only `search`; it must keep Audit trail's mount-request pin (F-28, SA-R-17). The Activity replaceState spy (`activityTab.render.test.tsx:640-656`) is first met in L-8 and must stay green there. Tests never depend on `useSearchParams` updating after a write (jsdom has no Next patch) | L-1c |
| C-8 | `AdminFilterBar` + `DatePresets` + `resolveWindow` | Costs segmented `CostsTab.tsx:132-172`, `activityPresets.ts:10-47` (pure, tested) | Standard set + the page's existing extras (D-2 (b)); Custom with From/To (UTC) + Apply + validation; Clear; Read-at + Refresh; active chips. **L-1a builds only the Read-at + Refresh part** (the bar as a plain `<div>`); L-1c builds the rest | `resolveWindow` reuses `activityPresets.ts` logic (it already has tests, `activityPresets.test.ts`) | L-1a (Refresh part), L-1c (rest) |
| C-9 | `AdminDrawer` + `useDrawerResource` + `DrawerSection` / `DrawerField` + `OpenRowButton` | `ActivityDrillDown.tsx:76-98` (Section, Field), `:257-294` (state machine), `:296-347` (Sheet wiring); `ActivityTable.tsx:121-155` (Open button) | Generic shell: open/onClose/returnFocus, title slot, loading/error blocks, palette override, `[color-scheme:dark]` (SA-R-7). First consumer: Audit trail (L-1d), one page-level drawer keyed by the selected row. **`useDrawerResource` is built in L-1d only if the Audit trail drawer fetches**; if it renders from the row already loaded, the hook moves to the first drawer that fetches (L-2b or L-4), re-check R-6 | Close button colour `[&>button]:text-slate-300` + **focus ring** (F-66); **title colour must win** over `text-[var(--v2-text-primary,…)]` (F-65), via inline style or child selector; the close button stays **a direct child of the dialog**, so `activityDrillDown.render.test.tsx:464-474` still holds when Activity adopts the drawer in L-8 | L-1d |
| C-10 | `ADMIN_DIALOG_CLASS` (+ optional `AdminDialogContent`) | `DARK_DIALOG` × 6 | One constant instead of 6 copies, plus the **close-button colour fix** the copies lack (`dialog.tsx:101`), plus `[color-scheme:dark]` (SA-R-7) | **No one-time swap** (SA Q-5): Jobs adopts it in L-1b (3 dialogs); Archiving (1) in L-3 and Businesses (2) in L-4 (D-8 (a), decided: no L-D) | L-1b |
| C-11 | `KpiStrip` + `KpiTile` | `HealthTile.tsx:38-84` (`STATUS_STYLES`, `GREEN_STYLE`) | `<a>` tile (K-6); Health keeps its own tiles. **L-1b builds the anchor and cross-page tile modes** (Jobs tiles link to `#jobs` / `#queues`). **The same-page filter mode (Q-14) needs `useAdminFilters` (L-1c) and is first used by AI cost & usage (L-2a)**, so it is built there, re-check R-7 | `health.source.guard` scans an explicit list of three Health files (`app/admin/page.tsx`, `HealthTile.tsx`, `HealthGrid.tsx`), so the shared folder's single green constant (S-7) does not affect it | L-1b (anchor, cross-page); L-2a (same-page filter mode) |
| C-12 | `StatusChip` | Jobs `Badge` + `TONE_CLASSES` (`JobsQueuesView.tsx:47-99`), `Chip.tsx:18-25` | Tones + icon (§5.9) | One green constant; `<span>` only | L-1b |
| C-13 | `AdminTable` class constants (`TABLE`, `TH`, `TH_NUM`, `TD`, `TD_NUM`, `TABLE_WRAP`) | `CostsSections.tsx:26-29`, `ActivityTable.tsx:121-155` | Constants, not a component that owns the data. Pages keep their `<table>` markup (SA Q-15). **Moved from L-1c to L-1d**: Audit trail's table arrives in L-1d | `TD_NUM` = `tabular-nums`, not `font-mono` | L-1d |
| C-14 | Shared-folder guard + migrated-pages registry | — | One Jest file in `app/admin/components/layout/__tests__/`. Part (a): the §6.1 rules. Part (b): a registry of migrated pages, **starting with the L-1a pilot** (Health); each registered page asserts it imports `AdminPageHeader`, has no own `<h1`, and has no direct `.json(`. The assertions scan the page's **files**, not only `page.tsx` (Health renders through `components/health/HealthGrid.tsx`), re-check R-1 | Runs inside the existing Jest gate (S-10) | L-1a |

**Not built (reuse or skip):** a date-picker library (native inputs are enough); a Radix popover/table/tooltip (not installed, not needed); a toast (no page needs one for layout).

**An export the pilot does not use is not built in that slice.** It moves to the first slice whose pilot needs it, and the move is recorded in §1 (SA-R-3: no unconsumed shared code on main). Where that first consumer is a page slice (L-2a onwards), SA rules whether the slice runs the full cycle (re-check R-6, R-7).

**How shared components meet per-page import guards:** Archiving, Plans & entitlements and Signup Invites forbid imports from outside their folder. Each page slice adds **exactly one alias prefix**, `@/app/admin/components/layout/`, to its guard, as a deliberate test edit recorded in §1 (SA Q-3). The safety moves to C-14, which limits what the shared folder itself may import (§6.1). The BOS AI "no `@/lib/`" guard needs **no edit**, because the shared folder is not under it (first exercised in L-8, re-check R-9).

---

## 7. Per-page migration plan

Each subsection lists KPIs (data the page already has), filters, content, forced behaviour changes, and the tests that need deliberate edits. "No behaviour change" means: same requests, same data, same actions and same permissions. Only presentation, URL state and the forced items listed change. Subsections follow the slice order (§8): Monitor (§7.1 to §7.6), Businesses (§7.7 to §7.10), Settings (§7.11 to §7.15). The four L-1 pilots (§7.1 to §7.4) also list the shared parts their slice builds; each pilot adopts **every** earlier shared part as well, so it ends fully on the standard (Audit trail at the end of L-1d).

### 7.1 L-1a — Health (`/admin`), pilot — Monitor

**Shared parts built in this slice:** C-1 (shell change and chrome colour scheme), C-2 `AdminPageHeader`, C-3 states (loading and error; empty and notice move to the first pilot that uses them), C-4 read helpers, C-5 formatters (exports Health does not use move on), the Refresh part of C-8, C-14 guard (registry starts with Health).

**Why Health is the first pilot:** it is first in the Monitor section and is the `/admin` landing page the user named as most important; it is the smallest page (`app/admin/page.tsx` 20 lines, `components/health/HealthGrid.tsx` 105 lines); and it is already the source of the header (§5.3) and the Refresh style (§5.5). It stays the landing page (§2.3 X-3).

KPI strip: **none**. The 7 tiles **are** the page's headline content and stay as they are (the reference). **Changes:** `AdminPageHeader` (h1 "Health", purpose line, "As of" through the `asOf` prop and the shared formatter, F-58); Refresh in a plain-`<div>` bar (text "Refresh", aria-label "Refresh the health summary"); "Loading…" → `AdminLoading`; the error → `AdminError`, keeping the server's text verbatim (§5.10 rule 1); `.json().catch(() => null)` → `readJsonBody`, status checked first; `createLogger` in `HealthGrid.tsx` → `clientLogger.child` (F-56, converted because the file is touched). **`HealthTile.tsx` is not edited in L-1a** (SA re-check): the figure links stay plain `<a>` (F-57 stays open), so the `GREEN_STYLE` file and the slice-5 QA probes are untouched.

**Strict guards this pilot keeps green, with no weakening:**

| Guard | Pin | How the slice keeps it |
|---|---|---|
| `health.render.test.tsx:144-145` | `getAllByRole('region').length === tiles.length` | The header, the bar and the states render no landmark region (A-9, S-8) |
| `health.render.test.tsx:116-121` | Exactly one `fetch`, with `{cache:'no-store'}` | Refresh calls the page's existing fetch function; `readJsonBody` / `readAdminResponse` only read a `Response` and never call `fetch` (C-4) |
| `health.source.guard.test.ts` | Green only inside `GREEN_STYLE`, referenced exactly twice; the guard scans the explicit list `app/admin/page.tsx`, `HealthTile.tsx`, `HealthGrid.tsx` | L-1a adds no green to those files. Health does not adopt `StatusChip` (its tiles keep `STATUS_STYLES`) |
| `health.source.guard.test.ts` | Never the word "OK" | No new Health copy contains it; the guard scans Health files only |
| `health.source.guard.test.ts` | Every listed file starts with `'use client'`; no runtime import of `@/lib/business-os`, repositories, `server-only` or the health rules | The page stays a client file; the shared folder meets S-3 / S-4 |
| `health.render.test.tsx:239-243` | Error text "Forbidden" shown verbatim | §5.10 rule 1 (the route's own `error` string) |
| `health.qa-slice5.render.test.tsx:114` | Read at workplan | Dev lists what it pins and how it holds |

**Test edits:** `health.render` Refresh by name → "Refresh the health summary"; `AdminHeader.render.test.tsx` "heading Health at `/admin`" → "renders no heading", plus "the menu button is named Open menu" (C-1). **Recorded cross-folder edits:** `AdminChrome.tsx`; `AdminHeader.tsx` and `AdminHeader.render.test.tsx` (C-1); `business-os-llm/readJsonBody.ts` → one-line re-export (C-4). `AdminSidebar.tsx` and `app/admin/layout.tsx` are not touched (X-1 to X-3).

### 7.2 L-1b — Scheduled jobs & queues, pilot — Monitor

**Shared parts built in this slice:** C-11 `KpiStrip` / `KpiTile` (anchor and cross-page modes), C-12 `StatusChip`, C-10 `ADMIN_DIALOG_CLASS`, plus any C-3 / C-5 export Health did not use and Jobs does.

| KPI | Source (`JobsQueuesView`, `lib/admin/jobs/jobsQueuesTypes.ts:110-119`) | Click target | Colour |
|---|---|---|---|
| Jobs | Count of `jobs[]`; sub-line splits it by each job's **own** status word from the payload | `#jobs` | **Neutral** (SA-R-4: a page-side "worst status" could disagree with Health tiles 6 and 7, which report "Not measured yet" when a job has no run) |
| Queues | Count of `queues[]`; sub-line splits it by each queue's own status word | `#queues` | **Neutral** (same reason) |
| Stuck items | Sum of `figures.stuck` | `#queues` | Red ("Needs action") when ≥ 1: the payload's queue status is already red for this condition (K-5 (i)) |
| Dead-lettered (24 h) | Sum of `figures.deadLettered24h` | `#queues` | Red when ≥ 1 (same) |

Tiles are `<a>`, so the **11-button test still holds**. **Forced:** `AdminPageHeader` (the pinned purpose sentence is unchanged); `Badge` → `StatusChip` (adds icons); the three dialogs (Cancel, Drain now, Retry) adopt `ADMIN_DIALOG_CLASS`, which fixes the light-scheme X if F-88 is real; QA records whether F-88 was seen (for information; D-8 (a) means the other 3 dialogs wait for their own slices either way); Refresh in a plain-`<div>` bar; "As of" via the shared formatter (F-60); `createLogger` in `JobsQueuesView.tsx` and `QueueItemsPanel.tsx` → `clientLogger.child` (F-56, Q-6: converted because the files are touched). **Test edits:** `jobsQueues.render` Refresh name; `jobsQueues.source.guard` green referenced exactly twice (moves to the shared chip → rule rewritten); the "exactly one `fetch(`" rule still holds (KPIs reuse the same fetch); the pinned header sentence is unchanged.

### 7.3 L-1c — Audit trail, part 1 (header, filter bar, URL, states), pilot — Monitor

**Shared parts built in this slice:** C-7 `useAdminFilters`, C-8 full filter bar + `DatePresets` + `resolveWindow`, C-6 `AdminBusinessPicker`, plus any C-3 / C-5 export earlier pilots did not use and Audit trail does (likely `AdminEmpty`). If the workplan exceeds a few days, C-6 moves to L-1d and the Audit trail picker swap moves with it (same page; named in L-1d's PR).

**Why Audit trail pilots the filter parts (and not AI cost & usage):** Audit trail already has every filter part the standard needs on one page: the business picker the shared one is generalised from, a date range, a URL read with legacy keys (`date_from`, `date_to`, `user_id`, `search`), minute-form and one-sided inbound links (Health figure links, the cutover notice), and a Clear. That exercises the hardest parts of the URL contract (U-7, U-9, the page-only search) on day one. Its content change (cards → table, inline expand → drawer) is split out to L-1d so each part stays a few days. AI cost & usage (1,690 lines, needing the KPI strip, the filter bar and the drawer at once) cannot be a pilot within a few days, so it follows as a normal page slice (§7.5).

KPI strip: **none** (D-12 (a)). One number (`pagination.total`) does not meet K-1, so the count line shows "N matching events". Audit trail counts stay NEEDS DATA (L-X1, not planned).

**Header:** `AdminPageHeader` (h1 "Audit trail" per D-3 (a); purpose line kept; "System Config" badge removed, F-30; "Export CSV" in the actions slot, unchanged, F-4 not fixed).

**Filters → bar:** Window (the standard five **added**, where today there are none; `datetime-local` → the standard Custom; aliases `date_from`/`date_to`, minute form honoured exactly, instants → linked window chip); Business (C-6, label "Business", replaces the original picker + account chip, F-31); "BOS AI failures" preset kept as a page chip; Search (**read from inbound links, never written**, SA-R-8, D-6 (a)), Action, Severity, Entity selects; Clear (before Refresh); one Refresh (F-35). **Content stays cards** with the inline expand until L-1d.

**Forced:**
- Filters **written** to the URL (contradicts `businessPicker.render :389` "leaves the URL alone" → deliberate edit).
- **Custom range precision (SA-R-18):** the Custom range goes from minute precision (`datetime-local`) to whole dates. Inbound minute links (Health tiles, the cutover notice) are still honoured exactly (U-7).
- States through `AdminStates`; `response.ok` checked via `readAdminResponse` (F-34).
- **F-28 stays open** (SA-R-17): this slice must not deliberately change Audit trail request sequencing (the "only asks for the log list and the archive notice on mount" pin). Because the hook's first use is on this page, the pin is the hook's proof that it adds no requests. If the hook changes sequencing anyway, that is a named forced change with its test.
- The shared picker uses `clientLogger.child` (F-56 for the picker). Any `console.*` found in `audit-trail/page.tsx` is flagged per CLAUDE.md Logging.

**Interim state:** after L-1c the page meets the header, filter-bar, URL and states parts of §12.3 and is in the C-14 registry; the table and drawer items are met in L-1d.

**Test edits:** `businessPicker.render` (URL, mount requests), `filterDensity.render` ("Clear All is the LAST control" → Clear is before Refresh), `accountChipLabel.render` (the chip moves into the picker), `presetAndDeepLink.render`, `searchTotals.render`; `businessPicker.contract` (its `PICKER` path and surface list must cover the shared picker, and the original until L-8; SA re-check RC-7); `businessPicker.render` imports `BUSINESS_SEARCH_PATH` from the shared picker. The original `audit-trail/BusinessAccountPicker.tsx` stays (Activity imports it) and is deleted in L-8.

### 7.4 L-1d — Audit trail, part 2 (table + drawer), pilot — Monitor

**Shared parts built in this slice:** C-13 table constants, C-9 `AdminDrawer` + `DrawerSection` / `DrawerField` + `OpenRowButton` (+ `useDrawerResource` only if the Audit trail drawer fetches, R-6).

**Changes:** **cards → table** (Open, Time (UTC), Event, Severity chip, Entity, Business, User), with the shared table constants and one density; severity badge → `StatusChip`; **inline expand → one page-level `AdminDrawer` keyed by the selected row** (same panel content, as `DrawerSection` / `DrawerField`; the Q-16 pattern, now first proven here); the count line "N matching events"; existing server pagination (20 per page) kept, restyled with the shared button style. The drawer's close button and title are readable in the light scheme (F-65, F-66 fixed in the shared component). **No change** to requests, pagination or Export CSV.

**Test edits:** card-based queries and testids in the Audit trail render tests (Dev lists each at workplan); `searchTotals.render` if it counts cards. Audit trail now meets the full §12.3 definition of done.

### 7.5 L-2a / L-2b — AI cost & usage — Monitor

Planned as two slices from the start (1,690-line file): **L-2a** header, KPI strip, filter bar, states, URL; **L-2b** table, status chips, call-detail drawer, agent-detail drawer.

| KPI | Source (`/api/admin/token-usage/drill-down`) | Click target | Colour |
|---|---|---|---|
| Total spend (USD, est.) | `totals` cost; sub "±x% vs previous" from `comparison` (as text, **no red/green**) | Group by provider | Amber "Needs a look" with sub "may be incomplete" when `possiblyIncomplete` (existing amber banner, K-5 (ii)); else neutral |
| Calls | `totals` calls | Group by activity | Neutral |
| Tokens | `totals` tokens; sub in/out (Quick Stats) | Group by model | Neutral |
| Avg cost per call | Existing Quick Stats calculation | — (not a link) | Neutral |
| *(All scope only)* Creation, Execution, Memory, System | The 4 category cards become tiles that filter when clicked, as today (D-10 (a)) | Same-page filter (category) | Neutral |

**Tile count under D-10 (a) and K-1 (re-check R-13):** in the **BOS scope**, the strip is Total spend, Calls, Tokens, Avg cost per call (4 tiles). In the **All scope**, the strip is Total spend + the 4 category tiles (5 tiles, the K-1 maximum, the same five cards as today); Calls, Tokens and Avg cost per call move into the "Quick stats" card below the table, beside "Top Token Consumers", where those figures sit today as a side rail.

**L-2a** — filters → bar: Window (the standard five + the page's existing extras `24h` and `90d`, D-2 (b); default 30d kept); Business (C-6) replaces the read-once `?user=`; the **scope** switch stays as a page filter (`scope`); Group By becomes a native `<select>` labelled "Group by" in the bar (it changes the table, not the data). The active-filters card → the chip row; "Clear all" → Clear. **Builds the same-page filter mode of `KpiTile`** (Q-14) for the category tiles and the Total spend / Calls / Tokens links (R-7). **Forced:**
- URL state for all filters (`range, from, to, account, scope, group_by, …` with aliases `dateFrom`/`dateTo`/`user`).
- **Business picker vs `?user=` (SA-R-11):** the picker searches Business OS businesses only. In the All scope, an agent-platform user id arriving in a link still filters as today and shows as a short-id chip, but such a user cannot be picked from the list.
- **UTC windows (F-54, SA Q-13):** allowed as a named forced change. The custom range labelled "(UTC)" is the window queried; the route is unchanged. Presets keep `period=N` (a rolling server window, F-94). New presets that Analytics lacks today (Today, This month) send explicit `dateFrom`/`dateTo`, which the route already accepts. Custom-range totals can shift by the admin's UTC offset (stated in §10 for the user's information).
- Full-page loading/error → states (F-55, F-43); the responsive grid (F-44); icon buttons named (F-48); header h1 "AI cost & usage" (D-3 (a)), "BI System" pill removed.

**L-2b** — the table on the shared constants, one density; status glyph → chip (F-45); **Trend column removed** (D-9 (a), F-46); execution times in UTC (F-50); no decorative green (F-51); the call-detail **hand-built modal → `AdminDrawer`** (F-53); agent details' inline expand → the drawer (§5.8 D-1); aggregate rows stay drill-down links (§5.8 D-3); "Top Token Consumers" and "Quick stats" kept as cards below the table.

**Test edits:** `linkedWindow.render` active class `bg-purple-500` (`:157-168`) → the new active class; button names "24h"… → standard labels plus the kept extras; `scope.render` "Custom", "Apply", two `input[type=date]` (kept); `bosLens.render` testids `category-card-*`, `group-by-*` (buttons → select), empty colSpan (one column fewer, D-9 (a)); `ownerText.guard` default-export name (kept).

### 7.6 L-3 — Archiving — Monitor

| KPI | Source (`GET /api/admin/archiving`) | Click target | Colour |
|---|---|---|---|
| Rows now | `sources[].rowsNow` (sum) | Source card | Neutral |
| Eligible now | Selected retention's eligible count | Source card | Neutral |
| Archived total | `sources[].archivedTotal` | Run history | Neutral |
| Last run | Newest `runs[]` status | Run history | Existing `statusBadge` map (`page.tsx:124-138`, K-5 (i)): Failed → red, Partial/Stalled → amber, Succeeded → green, Running → info |

(Field names follow the survey's description of the payload. Dev confirms the exact keys at workplan.)

Filters: none page-wide. The per-source retention select **stays as it is** (Radix + `DARK_SELECT`) inside its card: it is not a filter-bar control, so swapping it is not forced (SA Q-12). **Forced:** `ui/badge` + `!` → `StatusChip` (F-62); Refresh → Refresh (F-64); `ArchiveConfirmDialog` adopts `ADMIN_DIALOG_CLASS` (D-8 (a)). **Test edits:** `source.guard` import allow-list (`:55-69`) gains the one alias line; `page.render` testids kept.

### 7.7 L-4 — Businesses — Businesses

| KPI | Source (`GET /api/admin/users`, `stats`) | Click target | Colour |
|---|---|---|---|
| Logins shown | `stats.totalUsers` (the **filtered** count) | `status=all` | Neutral |
| Active (30 days) | `stats.activeUsers` | `status=active` | Neutral |
| New today | `stats.newUsersToday` | Not a link (no working "joined" filter, F-2) | Neutral |

Note: under the default Active filter, tiles 1 and 2 show the same number (F-26). **All three tiles are kept** (D-11 (a)). An unfiltered "All logins" count is **NEEDS DATA** (not planned, §1).

Filters → bar: Search (debounced, **held by the page, never written to the URL**, SA-R-8) + Status select (default active, kept) + Clear + Refresh. No Window, no Business (the page *is* the business list). **The dead Advanced Filters panel is removed** (D-11 (a), F-2): its 4 uncontrolled selects and the "Apply Filters" stub did nothing. **Forced:** URL state for `status` only; the full-page spinner remount (F-19) and the light `ErrorDisplay` (F-20) → states; refresh gets a name (F-22); table density unified; **the inline expanded row → one page-level `AdminDrawer` keyed by the selected id** (SA Q-16), holding the same blocks in the same order (BusinessOsPanel first, danger area last); the confirmation dialogs (credits, delete) stay Radix dialogs opened from inside the drawer and adopt `ADMIN_DIALOG_CLASS` (D-8 (a)). The **Open button sits inside the existing first cell**, not in a new column, so the `defaultFilter.render` seven-column pin holds with no edit (Q-16). **Test edits:** `source.guard` page-position checks `{isExpanded && (` → danger area → dialog (`:289-301`) move to the drawer file; `creditBands.guard` scans the folder (a new drawer file must comply). **Split:** L-4a list (header/KPI/bar/table/states, panel removal), L-4b detail → drawer.

### 7.8 L-5 — Plans & entitlements — Businesses

| KPI | Source (`/entitlements/plans`, `types.ts:49-60`) | Click target | Colour |
|---|---|---|---|
| Enforcement | `enforced` / `mode` | Banner anchor | Existing banner tones (K-5 (ii)): amber when not enforced, green when enforced (`EnforcementBanner.tsx:37-53`) |
| Plans on sale | Plans active and available to buy | Plans grid | Neutral |
| Withheld with no gate | `withheldWithoutGate.length` | That list | Neutral (no rule; D-4 (a)) |
| Cannot be sold | `notBuilt.length` | Not-built panel | Neutral |

Filters: none (bar with Refresh only, a plain `<div>`). `AccountLookup` stays a raw id field (switching to the picker is a behaviour change → §9 F-39). **Forced:** JSON reads via `readJsonBody` (F-37); h1 "Plans & entitlements" (D-3 (a), F-36). **Test edits:** `source.guard` import allow-list (`:57-82`) gains the one alias line; `page.render` button-label rule (save, assign, apply, reset, launch, grant, revoke). "Refresh" and "Clear" pass it, and there is no "Apply" because there is no Custom date here. The page imports nothing from the entitlements module through the shared folder (S-4).

### 7.9 L-6 — Signup Invites — Businesses

| KPI | Source (client counts over `invites[]`) | Click target | Colour |
|---|---|---|---|
| Pending | state = pending | None (D-7 (a)) | Neutral |
| Accepted | state = accepted | None | Neutral |
| Stopped halfway | `stoppedHalfway.count` | None | Amber when ≥ 1 (the existing amber banner, K-5 (ii)) |
| Expired | state = expired | None | Neutral |
| Revoked | state = revoked | None | Neutral |

The first draft's single "Expired or revoked" tile counted two states but linked to one; it is split into two tiles (SA-R-10), which keeps the strip at 5. When the payload's `truncated` flag is set, every tile shows the K-8 sub-line "at least" (the counts cover only the invites returned).

**Filters stay out of the URL — a deliberate exception to U-1 (D-7 (a), decided).** Reason: when an admin creates an invite, the invite link is shown **once** (`CreatedInvite.link`) and must not survive a reload. The folder's source guard bans `history.pushState` / `replaceState` for exactly that reason (`source.guard.test.ts:91-97`). Keeping the page free of any URL writing is the simplest way to keep that guarantee obvious.

- **How the bar still conforms visually:** the page uses the shared `AdminFilterBar` with the same order, classes and labels as every other page: Search, State, Invite type, Issuer, Clear (always rendered, disabled at the defaults), Read-at + Refresh on the right. No Window or Business (today's filters compare no dates; adding them is a behaviour change). Filter values are held in the page's own state, as today. The only visible differences from other pages: a reload resets the filters to their defaults, a filtered view cannot be shared by link, and the KPI tiles are not links (K-6).
- **Guard: extended, not edited (SA-R-5).** The `history.*State` ban on Invites files stays exactly as it is. Added assertions: (1) the Invites filter state has an **exact key list**: `state`, `type`, `issuer`, plus the free-text search held in the page only; (2) `CreateInviteForm` and `CreatedLinkPanel` **never import `useAdminFilters`**; (3) **no Invites file imports `useAdminFilters`**.

**Forced:** the second "Email" column renamed "Email status" (F-40); status text → `StatusChip`; h1 "Signup Invites" (D-3 (a)). **Test edits:** the exact file list (`:47-60`) if files are added; the import allow-list gains the one alias line (`:44`, `:62-71`); Clear visibility (always rendered); `page.render` h1 pin (`:115`) → "Signup Invites".

### 7.10 L-7 — Messages — Businesses

**Reply is hidden (D-14 (b), decided).** The Reply control and the Reply modal are **not rendered** in the redesigned page until the reply is fixed. This is a **UI-only change**: no route, request or data changes; the broken `/replay` route, F-1 and F-11 stay in §9 for a separate decision (no fix slice is planned). **SA re-check ruling (R-15):** the Reply control, the Reply modal and their handler are **removed from the page component** (no unreachable code left behind); the `/reply` route and every API file are not touched. **This page has no tests:** the slice first adds a baseline render test of today's behaviour (allowed: tests are not behaviour), then migrates; the hidden Reply gets its own assertion ("no Reply control is rendered").

KPI strip: **none** (D-13 (a), SA-R-9). The page could only count over the list the server returns, and the server has already filtered that list by status and search (`api/admin/messages/route.ts:35-37`), so "Unread" would read 0 under the Replied filter. Correct counts would need a new server count (L-X2, not planned).

Filters: Search (**never written to the URL**, SA-R-8), Status (in the URL as `status`), Clear, Refresh; no Window (no date filter today). **Forced:** the early-return spinner (F-17) → states; **an error state for a failed GET** (today it shows "No messages found", F-9); the detail **hand-built modal → AdminDrawer**; Reply hidden (above); relative dates → absolute UTC + relative hint; the native select gets `[color-scheme:dark]`; h1 "Messages" (D-3 (a)), the repeating "Messages" pill removed. `console.error` calls are flagged (F-8) and are converted only if the user approves, per CLAUDE.md Logging.

### 7.11 L-8 — Business OS AI: page header + Activity tab — Settings

**Why Activity is the first Business OS AI slice** (the on-screen tab order is Settings, Costs & credits, Activity, and is not changed): Activity already has the drawer and the picker the shared ones were generalised from, so its diff is the smallest, and it holds the last importers of two leftovers this slice deletes (the `readJsonBody` re-export and the original audit-trail picker). Re-check R-12.

**Page level:** `AdminPageHeader` (h1 "Business OS AI", badge "Read-only"); a **per-tab purpose line** replaces the shared Settings subtitle (F-68); Left/Right arrow keys on tabs; `?tab=` kept (the existing tab writer may stay or become a `useAdminFilters` key; either way the replaceState spy test stays green). The Settings tab's own refresh button stays where it is, in the header's action slot on the Settings tab only, until L-10 moves it into the bar.

Activity (`GET /api/admin/business-os/ai-activity`, `activityTypes.ts:100-124`):

| KPI | Source | Click target | Colour |
|---|---|---|---|
| AI actions | `total` is exact whenever it is present, even when the list is `capped` (`ActivityCountLine.tsx:12-21`). Null → "at least {rows shown}" when `capped`, else "Unknown" (corrected by SA, SA-R-15) | Clears outcome/area filters | Neutral |
| Failed | Count of `rows` with `outcome='failed'`. Exact only when `!capped`; otherwise "of the N shown" (K-8). Exact window count = **NEEDS DATA** (not planned, §1) | `?outcome=failed` | Neutral (no rule, D-4 (a)) |
| Cost USD (net) | Sum of `rows[].costUsd.net` (null → excluded + note); same capped rule | Sort by cost | Neutral |
| Unresolved corrections | `unresolvedAdjustments` | Rows with corrections (no filter exists → **tile not a link** unless SA finds one) | Amber when > 0, **only because** the tab already shows an amber notice for it (`ActivityTab.tsx:236-252`, K-5 (ii)); else neutral |

Filters → standard bar: Window (the standard five + the existing set kept as extras, D-2 (b); default `this_month` kept); Custom; Business (C-6); Area, Outcome, Trigger; Minimum cost; Sort stays a segmented control in the bar. **Forced changes:** all filters in the URL (`range, from, to, account, area, outcome, trigger, min_cost, sort`); global Clear; Refresh is text + icon; a preset click discards unapplied typed input (F-73); table text goes `text-xs` → `text-sm`, numbers `tabular-nums` (F-71, F-72); the drawer is rebuilt on `AdminDrawer` (no visible change except the title colour fix, F-65, and the close focus ring, F-66). **Recorded cross-folder edits:** the `business-os-llm/readJsonBody.ts` re-export is deleted and its importers point at the shared file (C-4); `audit-trail/BusinessAccountPicker.tsx` is deleted once `ActivityFilters.tsx` uses the shared picker (C-6), after checking nothing else imports it. **Test edits:** `activityTab.render` labels 'Account' → 'Business' (`:516-518`), URL expectations, the replaceState spy (kept green by Q-2); `activityDrillDown.render` close-button class assertion (`:464-474`) if the class moves into `AdminDrawer`; `page.render` subtitle pin (`:940-947`) → per-tab purpose; `source.guard` stays green (no `@/lib/` in page files).

### 7.12 L-9 — Business OS AI: Costs & credits tab — Settings

Costs & credits (`GET /api/admin/business-os/credits/report`, `costTypes.ts:81-111`):

| KPI | Source | Click target | Colour |
|---|---|---|---|
| Credits charged | `grandTotal.stored.creditsTotal` | Periods section anchor | Neutral |
| Cost USD | `grandTotal.stored.costUsd` | Periods section | Neutral |
| Charges | `grandTotal.stored.charges` | Breakdowns section | Neutral |
| Fallback-priced | `fallback.count` (sub: `reconciled`) | Fallback section | Neutral (no rule; D-4 (a)) |
| Periods not matching | `mismatchedPeriods` | Periods section | Uses the tab's existing mismatch chip tone (`CostsSections.tsx:69-97`, K-5 (ii)); otherwise neutral |

The whole strip shows the amber "may be incomplete" sub-line when `incomplete` (existing amber notice, `CostsTab.tsx:234-247`). **Forced:**
- **The account `<select>` becomes the business picker, with a new request (SA-R-11).** Today the select lists only the accounts in the report. The picker searches every business through `/api/admin/business-os/llm-usage/businesses`, an existing route the tab does not call today. Choosing a business with no charges in the window therefore shows the empty state, where today it could not be chosen.
- Presets move to the standard set (7d and 30d kept, 90d kept as an extra per D-2 (b), default 30d kept); filters in the URL.
- JSON reads through `readJsonBody` (F-67); `TD_NUM` font-mono → tabular-nums (F-71, F-72); fallback dates via the shared formatter (F-74).
- `LeakCheckPanel` keeps its own run-on-demand date inputs (it is an action, not a page filter) but adopts the table constants and states.

**Test edits:** `costsTab.render` `<select>` + option texts (`:262-276`), 'Apply dates' → 'Apply', 'Re-read the cost report' → 'Refresh the cost report' (D-15), `costs-incomplete` /amber/ (kept). `source.guard` stays green (no `@/lib/` in page files).

### 7.13 L-10 — Business OS AI: Settings tab — Settings

`GET /api/admin/business-os/llm-settings`

| KPI | Source | Click target | Colour |
|---|---|---|---|
| Areas | Count of areas | — | Neutral |
| Calls | Sum of the per-area call counts (`AreaCard.tsx:144-168` chips) | — | Neutral |
| Calls configured off | Sum of "configured off" | First area with any | **Neutral** |
| Row issues | Sum of "row issues" | First area with any | **Neutral** |

All four tiles are neutral (SA-R-4): the payload carries no status for these counts, and Health's `settings.off` rule counts "areas **or** calls", which is not the tab's sum, so borrowing it would be a second, disagreeing source of truth.

**Forced:** Refresh moves from the header into the bar (aria-label "Refresh the settings", F-69); JSON reads via `readJsonBody` (F-67); an empty state for no areas (F-75). **Test edits:** `page.render` 'Re-read the settings' button query; standing note class (kept non-amber).

### 7.14 L-11 — Model pricing — Settings

KPI strip: **none** (D-5 (a)). **Dependency:** the worktree `neuronforge-model-pricing` holds an SA-reviewed "model price review" requirement that **replaces Sync**, and the source guard pins the Sync handler and button **verbatim** (`source.guard.test.ts:37-90`, `:145-176`). A layout slice before that work merges would collide with it. **Rule:** L-11 starts only after the price-review slices merge, and the page is re-surveyed then. If they have not merged when L-11's turn comes, L-12 (Admin users) runs first and L-11 goes last. Planned changes: header, bar (Refresh), table constants (`px-6 py-4` → standard), states (no early-return, F-81; empty-list text, F-84), icon buttons get aria-labels (F-83), effective date → UTC (F-82).

### 7.15 L-12 — Admin users (`/admin/settings`) — Settings

KPI strip: **none** (D-5 (a)). Its candidate counts (rows in the table, not yet linked, env-only addresses) are list sizes, not headlines. **Changes:** `AdminPageHeader` (h1 "Admin users", badge "Read-only"); the bar with Refresh only (plain `<div>`); lists stay as cards; dates → UTC formatter; the body is read via `readAdminResponse` (F-85); on failure the page keeps clearing its data (§5.5). The page already logs through `clientLogger` (Q-6). **Test edits:** P-4 "the only button is Refresh" → "Refresh"; the stale-response race test stays.

---

## 8. Page order

| Order | Slice | Section | Shared parts → page | Why here |
|---|---|---|---|---|
| 1 | L-0 | — | Standard | Nothing starts until SA re-checks the edited sections (R-1 to R-17) |
| 2 | L-1a | Monitor | Shell, header, states, read helpers, formatters, Refresh, guard → **Health** | First in Monitor and the landing page; the smallest page; already the header and Refresh reference |
| 3 | L-1b | Monitor | KPI strip, status chip, dialog class → **Scheduled jobs & queues** | Existing status tones, 3 of the 6 dialogs, and the 11-button pin proves the tiles-are-links rule |
| 4 | L-1c | Monitor | URL filter state, filter bar + presets, business picker → **Audit trail part 1** | Has the picker, a date range, legacy URL keys and minute-form inbound links: proves the hardest filter parts |
| 5 | L-1d | Monitor | Table constants, drawer + Open button → **Audit trail part 2** | Cards → table and inline expand → drawer on the same page; finishes Audit trail |
| 6 | L-2a | Monitor | **AI cost & usage part a** (+ same-page tile mode) | Second in Monitor, but it needs every shared part, so it follows the pilots. 1,690 lines → planned as two slices |
| 7 | L-2b | Monitor | **AI cost & usage part b** | Table and drawer half |
| 8 | L-3 | Monitor | **Archiving** | Last Monitor page |
| 9 | L-4 | Businesses | **Businesses** (may split a/b) | First in Businesses |
| 10 | L-5 | Businesses | **Plans & entitlements** | Sidebar order |
| 11 | L-6 | Businesses | **Signup Invites** | Sidebar order; guard extended (D-7 (a)) |
| 12 | L-7 | Businesses | **Messages** | Sidebar order; Reply hidden (D-14 (b)); baseline test first |
| 13 | L-8 | Settings | **Business OS AI: page header + Activity** | First in Settings; deletes the two leftovers |
| 14 | L-9 | Settings | **Business OS AI: Costs & credits** | — |
| 15 | L-10 | Settings | **Business OS AI: Settings tab** | Finishes Business OS AI |
| 16 | L-11 | Settings | **Model pricing** | Sidebar order, **only if** the model price review work has merged; otherwise it swaps with L-12 and goes last |
| 17 | L-12 | Settings | **Admin users** | Last in Settings |

**Not planned under the user's answers:** L-D (D-8 (a)), L-X1 (D-12 (a)), L-X2 (D-13 (a)), the Messages reply fix (D-14 (b)). Each can be asked for later as its own slice.

**How this order was set.** The user chose the pilot principle (D-1 (a): each shared building block ships with one real page that uses it) and asked that the sidebar's section priority decide the order: Monitor first, then Businesses, then Settings, with Health as the most important page (2026-10-09). The pilots are therefore taken from the Monitor section: Health, Scheduled jobs & queues and Audit trail keep their Monitor positions 1, 3 and 4. AI cost & usage (Monitor position 2) is the one exception: it uses the KPI strip, the filter bar and the drawer together, and at 1,690 lines it cannot be a pilot within a few days, so it comes right after the shared parts exist. Business OS AI is first in Settings, and its tabs run Activity, Costs & credits, Settings (§7.11 gives the reason).

---

## 9. Found, not in scope

Severity: **sec** security, **data** data/correctness, **UX**, **cos** cosmetic. Disposition: **std L-x** = resolved incidentally by the standard in that slice; **user** = the user decides if and when; **SA** = SA rules; **open** = backlog.

| # | Finding | Citation | Sev | Disposition |
|---|---|---|---|---|
| F-1 | **Messages reply is broken.** The page posts to `/reply` but the route is `/replay` → 404, and the failure is silent. The route itself is a stub (`TODO`, `console.log`) with `admin_id: 'admin-user-id'` hardcoded | `messages/page.tsx:152`, `:161`; `api/admin/messages/[id]/replay/route.ts:48`, `:69-73` | data | user. D-14 (b): Reply is hidden in L-7; the fix is not planned and stays here for a separate decision (it would be its own full-cycle API slice) |
| F-2 | **Businesses "Apply Filters" is a stub.** The 4 advanced selects are uncontrolled and do nothing | `users/page.tsx:565-636` | UX | std L-4 (D-11 (a): the panel is removed) |
| F-3 | **"Sync Latest Pricing" is meant to be parked but is live** and clickable | `system-config/page.tsx:305-321`, `:185-218` | data | open (model price review work) |
| F-4 | **Audit trail CSV export does not escape values**: no quoting, no formula-injection guard; it exports only the loaded page; `revokeObjectURL` is never called | `audit-trail/page.tsx:455-474` | sec | open |
| F-5 | Messages PATCH writes the raw request body to `.update(body)` with no validation | `api/admin/messages/[id]/route.ts:26-31` | sec | open |
| F-6 | Messages GET builds `.or(...)` by string interpolation of the search | `api/admin/messages/route.ts:42` | sec | open |
| F-7 | Messages GET makes one replies query per message (N+1) | `api/admin/messages/route.ts:53-66` | data | open |
| F-8 | `console.*`: Messages page ×6; Messages routes ×9 | `messages/page.tsx:93,118,143,195,216,345`; `route.ts:48,70`; `[id]/route.ts:37,43,69,75`; `replay/route.ts:54,72,81` | cos | user (flag + convert on approval, CLAUDE.md Logging) |
| F-9 | Messages has no error state: a failed GET shows "No messages found"; PATCH/DELETE/reply failures are silent | `messages/page.tsx:92-94`, `:108`, `:135`, `:161`, `:209` | UX | GET: std L-7. Action failures: user |
| F-10 | Messages DELETE is a hard delete behind browser `confirm()` | `messages/page.tsx:202`; `[id]/route.ts:63-66` | data | open |
| F-11 | The Messages reply path would double-PATCH status and email_sent, duplicating the route's update | `messages/page.tsx:165-172`; `replay/route.ts:59-66` | data | open (with F-1) |
| F-12 | "Mark All Read" fires N parallel PATCHes behind `confirm()` | `messages/page.tsx:333-353` | UX | open |
| F-13 | No migration for `contact_messages` / `message_replies` in the repo | survey C §1k | data | open |
| F-14 | Messages has no page tests at all | — | data | std L-7 (baseline test added) |
| F-15 | Messages effect deps omit `fetchMessages`; lucide icons given a `title` prop | `messages/page.tsx:67`, `:77`, `:265`, `:268` | cos | open |
| F-16 | Messages: clearing the search does not refetch | `messages/page.tsx:71` | UX | user |
| F-17 | Messages early-return spinner unmounts the page on every keystroke | `messages/page.tsx:309-315` | UX | std L-7 |
| F-18 | Businesses: clearing the search does not refetch | `users/page.tsx:163` | UX | user |
| F-19 | Businesses full-page spinner remounts the filter bar while typing | `users/page.tsx:452-458` | UX | std L-4 |
| F-20 | Businesses light-themed `ErrorDisplay` on a dark page; raw SyntaxError / statusText | `users/page.tsx:434-450`, `:199-227` | UX | std L-4 |
| F-21 | Businesses unused imports Eye, X, Lock | `users/page.tsx:8`, `:17`, `:27` | cos | open |
| F-22 | Businesses refresh button has no accessible name | `users/page.tsx:497-502` | UX | std L-4 |
| F-23 | Businesses "Login Activity" column says "Click to load" until expanded | `users/page.tsx:765-784` | UX | user |
| F-24 | Two "AI spend" blocks in the Businesses detail (BOS USD vs all products) | `BusinessOsPanel.tsx:215`; `users/page.tsx:1016-1072` | UX | user |
| F-25 | Businesses `formatCost` shows at least 4 decimals | `users/page.tsx:255-261` | cos | open |
| F-26 | Under the default Active filter the "Active Users" tile duplicates tile 1 | `users/page.tsx:507-535` | UX | user (D-11 (a): both tiles kept; an unfiltered count would be NEEDS DATA) |
| F-27 | Businesses shows the first 100 rows only; the route's `sortBy`/`sortOrder` are unused | `users/page.tsx:702`, `:1238-1244`; `api/admin/users/route.ts:100-101` | UX | open |
| F-28 | Audit trail: two effects on `[filters]` → on page > 1, a filter change fetches the old page, then page 1 | `audit-trail/page.tsx:348-355` | data | open (SA-R-17: L-1c must not deliberately change request sequencing) |
| F-29 | Audit trail unused code: `useAuth` user, Calendar/User imports, `getSeverityColor` | `audit-trail/page.tsx:7`, `:285`, `:366-373` | cos | open |
| F-30 | Audit trail header badge "System Config" although the page is under Monitor | `audit-trail/page.tsx:493` | cos | std L-1c |
| F-31 | `accountFilterLabel` never reads `user_email` and orders fields differently from `auditUserLabel` | `audit-trail/page.tsx:146`, `:168-175` | UX | std L-1c (chip moves into the picker) |
| F-32 | Audit CSV columns differ from the page (no Business column; old `resource_name` meaning) | `audit-trail/page.tsx:447-454` | data | open (with F-4) |
| F-33 | Audit search filters one page window in memory, not the whole log | `audit-trail/page.tsx:730-753` | data | open |
| F-34 | Audit trail never checks `response.ok` | `audit-trail/page.tsx:329-339` | UX | std L-1c |
| F-35 | Audit trail has two refresh buttons | `audit-trail/page.tsx:506-513`, `:770-777` | cos | std L-1c |
| F-36 | Plans h1 "Business OS Tiers" ≠ sidebar "Plans & entitlements" | `business-os-tiers/page.tsx:76` | cos | std L-5 (D-3 (a)) |
| F-37 | Plans: a raw parser message can reach the UI (page and AccountLookup) | `business-os-tiers/page.tsx:54`, `:60`; `AccountLookup.tsx:62`, `:71` | UX | std L-5 |
| F-38 | Plans fetch without `cache: 'no-store'` | `business-os-tiers/page.tsx:53` | data | open |
| F-39 | AccountLookup needs a pasted UUID (no picker) and uses a plain `<a href>` | `AccountLookup.tsx:94-121` | UX | user |
| F-40 | Invites: two columns headed "Email" | `InviteList.tsx:72`, `:79` | UX | std L-6 |
| F-41 | Invites `RevokeDialog` is named a dialog but is an inline form | `RevokeDialog.tsx:6-8`, `:64-98` | cos | open |
| F-42 | Invites `EnforcementNote` copy "Until signup from an invite is built…" is likely stale | `EnforcementNote.tsx:40-41` | UX | user |
| F-43 | Analytics: an OK response with a non-JSON body shows a raw SyntaxError | `analytics/page.tsx:335`, `:361` | UX | std L-2a |
| F-44 | Analytics grids are not responsive (`grid-cols-5`, `grid-cols-12`) | `analytics/page.tsx:713`, `:863-866`, `:1033` | UX | std L-2a |
| F-45 | Analytics status is a colour glyph only | `analytics/page.tsx:1274-1280` | UX | std L-2b |
| F-46 | Analytics "Trend" column is always "-" | `analytics/page.tsx:1299-1302` | UX | std L-2b (D-9 (a): column removed) |
| F-47 | Analytics unused imports DollarSign, BarChart3 | `analytics/page.tsx:9`, `:11` | cos | open |
| F-48 | Analytics icon buttons have no aria-label (refresh, modal close, chip X) | `analytics/page.tsx:636`, `:892`, `:1486` | UX | std L-2a (refresh, chip X) / L-2b (modal close) |
| F-49 | Analytics Subtotal vs Total ignores the feature/component/endpoint/user/request_type filters | `analytics/page.tsx:1318` | data | open |
| F-50 | Analytics execution times are browser-local; elsewhere they are UTC | `analytics/page.tsx:1405`, `:1413`, `:1662` | UX | std L-2b |
| F-51 | Analytics call cost uses green as decoration | `analytics/page.tsx:1507` | cos | std L-2b |
| F-52 | Analytics `availableFilters` is fetched but never rendered | `analytics/page.tsx:344` | cos | open |
| F-53 | Analytics hand-built modal: no Escape, no focus trap | `analytics/page.tsx:1456-1687` | UX | std L-2b |
| F-54 | Analytics custom range mixes UTC and local time | `analytics/page.tsx:314-316`, `:508-525` | data | std L-2a (SA Q-13: allowed as a named forced change) |
| F-55 | Analytics full-page loading and error replace the header and filters | `analytics/page.tsx:558-585` | UX | std L-2a |
| F-56 | `createLogger` (server logger factory) used in client files | `HealthGrid.tsx:15`; `BusinessAccountPicker.tsx:46-48`; `JobsQueuesView.tsx:29`; `QueueItemsPanel.tsx:36` | cos | SA Q-6 ruled: converted to `clientLogger.child` in the slice that owns the file (Health L-1a, Jobs L-1b, shared picker L-1c; the original picker file is deleted in L-8) |
| F-57 | Health figure links are plain `<a>` (full reload) | `HealthTile.tsx:119-125`, `:140-146` | cos | open (SA re-check: not in L-1a, `HealthTile.tsx` is not edited) |
| F-58 | Health "As of" is sliced from an ISO string (safe only while the server sends Z) | `HealthGrid.tsx:22-28` | data | std L-1a |
| F-59 | Jobs page-level failure shows server text while the panel and dialogs never do | `JobsQueuesView.tsx:279` | cos | open |
| F-60 | Jobs `formatUtc(view.now).slice(11)` | `JobsQueuesView.tsx:308` | cos | std L-1b |
| F-61 | Archiving shows the raw `errorCode` in the history Error column | `archiving/page.tsx:519` | UX | user |
| F-62 | Archiving `Badge` renders a `<div>` inside a `<span>` (invalid nesting) | `components/ui/badge.tsx:30`; `archiving/page.tsx:384-385` | cos | std L-3 |
| F-63 | Archiving "Continue" posts without confirmation; Start has a dialog | `archiving/page.tsx:320` | UX | user |
| F-64 | Archiving Refresh has no aria-busy and its own style | `archiving/page.tsx:244-252` | cos | std L-3 |
| F-65 | Possible dark-on-dark drawer title in light OS mode (`text-[var(--v2-text-primary,…)]` vs `text-slate-100`, plain-join `cn`) — unverified | `components/ui/sheet.tsx:111`; `ActivityDrillDown.tsx:319` | UX | std L-1d (shared drawer) / L-8 (Activity drawer adopts it) |
| F-66 | Sheet close focus ring `focus:ring-ring` has no colour token | `components/ui/sheet.tsx:68` | UX | std L-1d (shared drawer) / L-8 (Activity) |
| F-67 | Parser messages reach the screen in BOS AI Settings, Costs, Leak check | `business-os-llm/page.tsx:128`, `:136`; `CostsTab.tsx:81`, `:94`; `LeakCheckPanel.tsx:312`, `:321` | UX | std L-9 (Costs, Leak check) / L-10 (Settings) |
| F-68 | BOS AI page subtitle is Settings copy shown on every tab | `business-os-llm/page.tsx:157` | cos | std L-8 |
| F-69 | BOS AI Settings refresh: `title` only, no aria-label, larger icon | `business-os-llm/page.tsx:170-180` | UX | std L-10 |
| F-70 | Picker labelled "Account" vs "Business" elsewhere; hardcoded ids collide if two are on a page; permanent hint; blue ring | `BusinessAccountPicker.tsx:217-251`, `:336-339` | UX | std L-1c (or L-1d) |
| F-71 | Numeric styling differs (font-mono, tabular-nums, neither) | `CostsSections.tsx:29`; `LeakCheckPanel.tsx:121-129`; `ActivityTable.tsx:170-175` | cos | std L-8 / L-9 |
| F-72 | Three table densities within one page (Activity, Costs, Leak) | survey BOS AI §Found 8 | cos | std L-8 / L-9 |
| F-73 | Activity: a typed-but-unapplied minimum cost stays in the input after a preset click; no global clear | `ActivityFilters.tsx:57-70` | UX | std L-8 (§5.5 Apply semantics, built in L-1c) |
| F-74 | Costs fallback list hand-formats dates (no UTC suffix, no null-safety) | `CostsSections.tsx:278` | data | std L-9 |
| F-75 | BOS AI Settings: no empty state for empty areas; Suspense fallback null | `business-os-llm/page.tsx:96`, `:251-264` | UX | std L-10 |
| F-76 | Model pricing copy says Sync "fetches current rates from OpenAI and Anthropic"; the route writes a hardcoded catalogue | `system-config/page.tsx:207`, `:356`; `api/admin/system-config/pricing/sync/route.ts:10-34` | data | open (model price review) |
| F-77 | Model pricing units disagree: "per 1,000 tokens" vs "Cost/Token" vs stored per token | `system-config/page.tsx:350-353`, `:389-392`; `sync/route.ts:20` | data | open (model price review) |
| F-78 | Model pricing shared `saving` flag shows "Syncing..." during a row save | survey C §2k | cos | open |
| F-79 | `pricing/route.ts` exports unused POST and DELETE handlers | `api/admin/system-config/pricing/route.ts:269`, `:331` | sec | open |
| F-80 | Model pricing save/sync show `error.message` incl. parser text | `system-config/page.tsx:155-214` | UX | std L-11 for save; the Sync path is pinned verbatim → user |
| F-81 | Model pricing early-return spinner blanks the page on Refresh | `system-config/page.tsx:229-235` | UX | std L-11 |
| F-82 | Model pricing effective date shown in local time | `system-config/page.tsx:485` | cos | std L-11 |
| F-83 | Model pricing icon buttons and `pricing-toggle` lack aria-labels | `system-config/page.tsx:322-332`, `:417-515` | UX | std L-11 |
| F-84 | Model pricing empty list shows a header-only table | `system-config/page.tsx:378-521` | UX | std L-11 |
| F-85 | Admin users calls `response.json()` before checking `ok` (generic banner, never raw) | `settings/page.tsx:65` | cos | std L-12 |
| F-86 | `AdminHeader` mobile menu button has no aria-label | `AdminHeader.tsx:64-69` | UX | std L-1a |
| F-87 | Duplicate `<h1>` on every page; AH says "Admin Console" for 9 views | `AdminHeader.tsx:34-43`, `:72` | UX | std L-1a |
| F-88 | `ui/dialog` close button likely near-invisible in light OS mode in all 6 admin dialogs (inferred) | `components/ui/dialog.tsx:101` + the 6 files in §4.1 | UX | std L-1b (Jobs ×3, QA confirms or not); Archiving in L-3, Businesses ×2 in L-4 (D-8 (a)) |
| F-89 | `DARK_DIALOG` copied into 6 files | §4.1 | cos | std L-1b + page slices (as F-88) |
| F-90 | `cn()` is a plain join; tailwind-merge is installed but unused | `lib/utils.ts:1-3` | cos | open (SA Q-5: `cn()` unchanged, out of scope) |
| F-91 | `--v2-*` is unresolved under `/admin`; `components/ui` primitives fall back to light values (`select.tsx` `white`, `card.tsx:8` `bg-white`, `badge.tsx:10`) | survey C §components/ui | UX | std (wrappers, T-2/T-3) |
| F-92 | Possible: soft navigation from a V2 page leaves `.dark` + inline `--v2-*` on `<html>` (no provider cleanup) — inference, unverified | `lib/design-system-v2/theme-provider.tsx:92-134` | UX | open (TS to verify) |
| F-93 | No colour token for `ring` in `globals.css` / `tailwind.config.js` (affects any `ring-ring` user) | survey BOS AI §sheet | cos | std (A-1) for admin |
| F-94 | AI cost & usage "7 days" (and 30, 90) is a rolling server period (`period=N`, the last N × 24 hours), while every other admin page means the last N UTC calendar days (U-8). After L-2a one label still carries two meanings across pages | `analytics/page.tsx:150-156`; SA Q-13 | data | user (added by SA-R-12) |

**Count: 94 items** (4 known + 89 from the surveys + 1 from the SA review).

---

## 10. User decisions

> This is the complete list of choices for you, the product owner. Please answer by number (for example "D-2: b"). Each item says what changes depending on your answer. Technical questions have already been settled by the architect and are not listed here.
>
> **Answered 2026-10-09** — see "Answers" at the end of this section. The questions are kept as they were asked.

**D-1. In what order are the pages redone?** (was SA-U-1)
- Options: (a) New order: Admin users, then Scheduled jobs & queues, then Business OS AI (Costs tab, then Activity tab), then your order for the rest: Business OS AI Settings tab, AI cost & usage, Businesses, Audit trail, Health, Signup Invites, Plans & entitlements, Archiving, Messages, Model pricing. (b) Your original order, starting with Business OS AI.
- Recommendation: (a). Each shared building block is shipped together with one real page that uses it, so nothing unused sits in the code and every part is proven on a real page straight away.
- What changes: (a) the first changes you see are on two small pages (Admin users, then Scheduled jobs & queues); Business OS AI comes third and fourth. (b) the shared parts would be built first with no page using them for some weeks; the architect advises against this.

**D-2. Which date choices does every page offer?** (was UD-1)
- Options: (a) Exactly your five everywhere: Today, 7 days, 30 days, This month, Custom. (b) Your five everywhere, and a page keeps any extra choices it already has, shown after the five. No new extras without asking you.
- Recommendation: (b). Nothing an admin uses today disappears, and the first five are always the same and in the same place.
- What changes: (a) Activity loses Yesterday, This week, Last week and Last month; Costs and AI cost & usage lose 90 days; AI cost & usage loses 24 hours. (b) nothing is lost.

**D-3. When a page title differs from its menu label, which one wins?** (was UD-5)
- Where they differ today: "Token Usage Analytics" vs "AI cost & usage"; "Business OS Tiers" vs "Plans & entitlements"; "Business OS Signup Invites" vs "Signup Invites"; "Contact Messages" vs "Messages"; "Audit Trail" vs "Audit trail".
- Options: (a) The menu label wins everywhere. (b) Each page keeps its own title.
- Recommendation: (a). The admin clicks "AI cost & usage" and lands on a page with the same name.
- What changes: (a) those five pages are renamed when their turn comes. (b) the titles stay as they are.

**D-4. Colours for numbers that have no warning rule today** (was UD-2)
- Most new headline numbers (failed AI actions, fallback-priced charges, plans withheld with no gate, and others) have no red or amber limit anywhere today.
- Options: (a) Show them in plain grey until you set limits. (b) Set limits now, number by number.
- Recommendation: (a). A number turns red or amber only where the page already warns about the same thing today (for example stuck queue items, or invites stopped halfway).
- What changes: (a) the redesign adds no new warnings. (b) I list candidate limits for you to approve; each approved limit becomes its own reviewed piece of work, outside the redesign.

**D-5. Pages with no real headline numbers (Admin users, Model pricing)** (was UD-3)
- Options: (a) No row of number tiles on those pages. (b) Show counts anyway, for example "3 admins, 1 not linked".
- Recommendation: (a). Counting list rows adds noise. Health keeps its own tiles, which already are its headline.
- What changes: (a) those pages start straight with their list. (b) a row of small count tiles is added above the list.

**D-6. Is the search box text kept in the page link?** (was SA-U-4)
- Every page keeps its dates, business and dropdown choices in the page link, so you can copy the link and someone else opens the same view.
- Options: (a) Search text is not kept in the link. (b) Search text is kept like the other choices.
- Recommendation: (a). Searches are usually emails or names; in the link they would end up in browser history and in server logs.
- What changes: (a) a shared link opens the same view with an empty search box. (b) the search is restored too, and the emails or names travel with the link.

**D-7. Signup Invites: are its filters kept in the page link?** (new)
- When you create an invite, its link is shown once and must be gone if the page is reloaded. To keep that protection simple and certain, the plan is that Signup Invites does not keep its filters in the page link at all.
- Options: (a) Signup Invites keeps no filters in the link. Otherwise it looks and works like every other page: the same filter row in the same place, the same Clear and Refresh. (b) Keep its filters in the link like every other page. The architect considers this safe as long as the invite-creation parts never touch the link, and would check it again first.
- Recommendation: (a). It is a small page that is rarely shared, and protecting the one-time invite link matters more.
- What changes: (a) reloading the page resets its filters; a filtered view cannot be shared by link; the number tiles at the top are not clickable (use the State dropdown instead). (b) filters survive a reload and can be shared, and the tiles become clickable; one extra check by the architect first.

**D-8. The close button (X) in confirmation boxes may be invisible in light mode** (was SA-U-3)
- Six confirmation boxes may show a near-invisible X when the computer is set to light mode. Nobody has seen it yet. It will be checked on Scheduled jobs & queues, which fixes 3 of the 6.
- Options: (a) Fix the other 3 (Archiving, and two on Businesses) when each of those pages gets its turn. (b) If the check confirms the problem, fix the other 3 at once, as one small extra piece of work.
- Recommendation: (a), unless you have seen it happen.
- What changes: (a) Businesses and Archiving keep the issue until their turn. (b) one small extra piece of work right after Scheduled jobs & queues.

**D-9. AI cost & usage: the "Trend" column** (was UD-8)
- It always shows "-".
- Options: (a) Remove it. (b) Keep it.
- Recommendation: (a). It has never shown anything.
- What changes: (a) one column fewer. (b) no change.

**D-10. AI cost & usage: the category cards** (was UD-9)
- In the "Both products" view, the cards Creation, Execution, Memory and System are both numbers and filter buttons.
- Options: (a) They become number tiles that filter when clicked. (b) They become a "Category" dropdown in the filter row, and the tiles show totals only.
- Recommendation: (a). Same behaviour as today in the new look, as long as there are 5 tiles or fewer.
- What changes: (a) clicking a category tile filters, as today. (b) the category is picked from a dropdown.

**D-11. Businesses: unfinished filters and a duplicate tile** (was UD-10)
- The "Advanced Filters" panel does nothing (its Apply button was never finished). Under the default "Active" view, two of the three tiles show the same number.
- Options: (a) Remove the dead panel; keep all three tiles. (b) Keep the dead panel until it is built properly. (c) As (a), and also drop the duplicate tile.
- Recommendation: (a). Removing controls that do nothing loses nothing, and three tiles keep the row meaningful. A true "all logins" number would need a server change.
- What changes: (a) panel gone, three tiles. (b) the panel stays and still does nothing. (c) panel gone and only two numbers left, which is below the minimum of three, so that page shows no number tiles at all.

**D-12. Audit trail: headline numbers** (was UD-6)
- Numbers such as "critical events in this period" need a new count from the server.
- Options: (a) No number tiles on Audit trail. (b) No tiles in the redesign, plus a separate, fully reviewed piece of work later that adds the counts.
- Recommendation: (a) for now; you can ask for (b) at any time.
- What changes: (a) the page shows "N matching events" above the list. (b) adds that extra piece of work after the Audit trail redesign.

**D-13. Messages: headline numbers** (was SA-U-2)
- The Messages list arrives already filtered, so a count like "Unread" would read 0 whenever another filter is on. Correct counts need a new count from the server.
- Options: (a) No number tiles on Messages. (b) No tiles in the redesign, plus a separate, fully reviewed piece of work later that adds correct counts.
- Recommendation: (a) for now.
- What changes: (a) the page starts straight with the list. (b) adds that extra piece of work after the Messages redesign.

**D-14. Messages: the Reply button is broken** (was UD-7)
- Replies never send, and the failure is silent. The redesign would move Reply into the new side panel.
- Options: (a) Fix Reply first, as its own fully reviewed piece of work, then redesign the page. (b) Hide Reply in the redesign until it is fixed. (c) Move it as it is, still broken.
- Recommendation: (a) or (b). Do not move a broken button into a fresh design. If Messages is low priority, choose (b).
- What changes: (a) an extra piece of work before Messages; Reply works afterwards. (b) no Reply button for now. (c) the broken button carries over into the new design.

**For your information (no decision needed):**
- AI cost & usage: after its redesign, a custom date range means whole days in UTC, as on every other admin page. Totals for a custom range can therefore shift by a few hours' worth compared with today.
- AI cost & usage: "7 days" there will still mean the last 7 × 24 hours, while on the other pages it means the last 7 calendar days (UTC). This is recorded as F-94 for a later decision.

**Answers (user, 2026-10-09):** "all recommended; D-14: b." On the order, the user added: "on the order, i like the order today of the sections, meaning, monitoring and analytics is the most important section. then businesses and then settings. i would like to keep the sections order, and the first page when opening the admin url should be the health, as that is the most important."

| # | Answer | Consequence in this document |
|---|---|---|
| D-1 | **(a)**, the pilot principle: each shared building block ships with one real page that uses it | Kept for L-1a to L-1d. The pilots are re-picked from the Monitor section and the whole order follows the sidebar sections (the user's added instruction): §1, §7, §8. The page list in option (a)'s text is superseded by §8 |
| D-2 | **(b)** | The standard five everywhere, plus each page's existing extras after them (Activity: Yesterday, This/Last week, Last month; Costs: 90 days; AI cost & usage: 24 hours, 90 days). No new extras. §5.5, U-6, §7.5, §7.11, §7.12 |
| D-3 | **(a)** | Each page's h1 becomes its sidebar label in its own slice: Audit trail (L-1c), AI cost & usage (L-2a), Plans & entitlements (L-5), Signup Invites (L-6), Messages (L-7). The sidebar itself is not touched (§2.3 X-2) |
| D-4 | **(a)** | Tiles are coloured only per K-5; every other tile is neutral. No thresholds proposed |
| D-5 | **(a)** | No KPI strip on Admin users (L-12) or Model pricing (L-11) |
| D-6 | **(a)** | Free-text search is never written to the URL (U-1 exception (1)); inbound `search` on Audit trail is still read |
| D-7 | **(a)** | Signup Invites writes no filters to the URL; guard extended with assertions (1) to (3); tiles are not links. §7.9 |
| D-8 | **(a)** | No L-D slice. Archiving's dialog adopts the class in L-3, Businesses' two in L-4. QA still records on Jobs whether F-88 is seen |
| D-9 | **(a)** | The Trend column is removed in L-2b |
| D-10 | **(a)** | Category tiles filter when clicked. Within K-1's five-tile maximum: All scope = Total spend + 4 categories; Calls, Tokens and Avg cost per call move into the Quick stats card (§7.5, re-check R-13) |
| D-11 | **(a)** | The dead Advanced Filters panel is removed in L-4; all three tiles kept |
| D-12 | **(a)** | No KPI strip on Audit trail; L-X1 not planned |
| D-13 | **(a)** | No KPI strip on Messages; L-X2 not planned |
| D-14 | **(b)** | Reply is hidden in the Messages redesign (L-7), a UI-only change. No reply-fix slice is planned (former L-10r removed); F-1 and F-11 stay in §9 for a separate decision |
| D-15 (added during L-1a review) | **Refresh** | The standard's reload button is labelled "Refresh" (accessible name "Refresh {what}"), not "Re-read": the more familiar word, and what most admin pages already say. Applied in L-1a (shared button, Health); the Business OS AI tabs change from "Re-read" to "Refresh" in their own slices. "Read at HH:mm UTC" is unchanged |
| Order (added) | Keep the sidebar sections and their order (Monitor → Businesses → Settings); `/admin` opens on Health | Hard constraint §2.3 X-1 to X-3 and §3 rule 9; migration order Monitor → Businesses → Settings (§8) |

---

## 11. Questions for SA

All 16 questions were ruled by SA on 2026-10-09 (see the SA Review below). The BA suggestions are kept as the record. They use the slice and decision ids of the first draft; see the mapping in §1. Rulings whose wording names a pilot page that changed in the 2026-10-09 re-order (Q-2, Q-3, Q-5, Q-7, Q-11, Q-13, Q-14, Q-16) are listed for restating in the second BA response table (R-items).

| # | Question | BA suggestion |
|---|---|---|
| Q-1 | Location of the shared components. | `app/admin/components/layout/`. It is admin-only, beside the shell, and outside every page folder whose guard scans "every file under the page dir". |
| Q-2 | URL sync: `window.history.replaceState` vs `router.replace`. The BOS AI test spies on `replaceState` (`activityTab.render.test.tsx:640-656`), and the tab writer already uses it. Does the installed Next 14 minor version sync `useSearchParams` with native `replaceState`? The Invites guard forbids `history.*State` (`:91-93`). | `history.replaceState` (no re-render storm, matches the existing tests), provided the Next version supports it. The Invites guard is edited deliberately in L-8. |
| Q-3 | How shared components satisfy the per-page import allow-lists (Archiving `:55-69`, Tiers `:57-82`, Invites `:44`, `:62-71` + exact file list, BOS AI "no `@/lib/`"). | Each page's slice adds exactly `@/app/admin/components/layout/*` to its allow-list. Shared files avoid `@/lib/` imports where cheap, so the BOS AI rule stays meaningful. |
| Q-4 | Fix the `components/ui` sheet/dialog primitives, or wrap them for admin? The Business OS app also uses the primitives (`CreditHistoryPanel`, `UsageCard`). | Admin-local wrappers (`AdminDrawer`, `ADMIN_DIALOG_CLASS`). Leave `components/ui` unchanged. |
| Q-5 | `cn()`: adopt `tailwind-merge`, or keep the plain join? Also: may L-1c swap all 6 `DARK_DIALOG` copies for the shared constant at once (it fixes F-88 everywhere), or must each page wait for its slice? | Keep `cn()` unchanged (global blast radius; separate decision). Allow the one-time dialog swap in L-1c, since it is a class-only change that fixes a visible bug. |
| Q-6 | Logger in client components: `clientLogger.child({ module })` from `@/lib/logger/client`, vs `createLogger` (used in 4 client files). | `clientLogger.child`. Pages convert in their own slice. |
| Q-7 | A CI/source guard that keeps migrated pages on the standard: a registry of migrated pages, each asserting it uses `AdminPageHeader`, has no own `<h1>`, has no direct `response.json()`, no `--v2-`, no `dark:`. It must add no CI time (runs inside the existing Jest gate). | Yes, built in L-1a with an empty registry. Each page slice adds its page. |
| Q-8 | How to verify contrast in light OS mode, given there is no E2E tool. | QA manual check with the OS in light and in dark mode for every slice (recorded in the QA report), plus a Jest guard that shared files contain no `var(--v2-` and no `dark:`. |
| Q-9 | Set `color-scheme: dark` (and optionally admin values for `--v2-*`) once on `AdminChrome`, as a safety net for primitives and native controls? | Set `color-scheme: dark` on the chrome in L-1a. Do **not** define `--v2-*` (T-2 says shared code never depends on them, and defining them would hide future misuse). |
| Q-10 | Canonical URL param names (`range`, `from`, `to`, `account`) vs adopting an existing set (`date_from`, `date_to`, `user_id`). | `range`/`from`/`to`/`account` + permanent read aliases. |
| Q-11 | Removing the title from `AdminHeader` (C-1): do any parked pages rely on it, lacking their own `<h1>`? | Remove it. If a parked page lacks an h1, accept it (parked) or keep a fallback for parked paths only. |
| Q-12 | Filter-bar controls: native `<select>` everywhere (Costs test asserts a `<select>`, `ui/select` is Radix with light fallbacks), including replacing Archiving's Radix retention select? | Native, styled with `[color-scheme:dark]`. |
| Q-13 | Analytics custom/preset windows become UTC calendar days (F-54). Is that a "data change" that must leave the layout slice? | Treat it as part of the standard (the window the admin picks is the one queried), but record it as a visible behaviour change in L-3. |
| Q-14 | `KpiTile` same-page targets: `next/link` to `?…` (soft navigation), which the URL hook must then pick up, or an `onClick` that calls the hook's setter? | A `Link` with `replace` + `scroll={false}` so middle-click and copy-link work, with the hook reading from `useSearchParams`. |
| Q-15 | The table as class constants vs an `<AdminTable>` component. | Constants + `OpenRowButton`. Pages keep their markup, which keeps test edits small. |
| Q-16 | Businesses drawer: the detail fetches 3+ endpoints and hosts dialogs. One page-level `AdminDrawer` keyed by the selected id, or one per row? | A single page-level drawer. |

---

## 12. Acceptance criteria and definition of done

### 12.1 L-0 (this document)

- [x] SA has reviewed and ruled on Q-1 to Q-16. The rulings are recorded in §1 and in the SA Review section (2026-10-09).
- [x] BA has revised the document for SA-R-3 to SA-R-14 (2026-10-09; see the first "BA response" in the SA Review).
- [x] The user has answered D-1 to D-14 (§10), and the answers are recorded there (2026-10-09), with the added sidebar-order instruction applied (§2.3, §3, §8).
- [x] SA has re-checked the edited sections (R-1 to R-17 in the second BA response table): APPROVED 2026-10-09, conditions RC-1 to RC-8 (SA re-check subsection).
- [ ] The status moves to Approved only on explicit user or TL sign-off.

### 12.2 L-1a / L-1b / L-1c / L-1d (shared components + one pilot page each)

Every L-1 slice:

- [ ] Its shared components (the "Slice" column of §6.2) exist in `app/admin/components/layout/`, each with unit or render tests (happy path + one failure path).
- [ ] **Exactly one pilot page** is migrated in the same PR (L-1a Health; L-1b Scheduled jobs & queues; L-1c Audit trail part 1; L-1d Audit trail part 2), and it **uses every new export** of the slice. An export the pilot does not use is not built yet; it moves to the first slice whose pilot needs it, and §1 records the move.
- [ ] The pilot page meets the per-page definition of done (§12.3). For Audit trail, L-1c meets the header, filter-bar, URL and states items, and L-1d meets the rest.
- [ ] **No other page is migrated.** The only edits outside the shared folder and the pilot are the recorded ones (§3 rule 1). `AdminSidebar.tsx`, its nav test and `app/admin/layout.tsx` are not touched (§3 rule 9).
- [ ] The shared-folder guard (C-14, shipped in L-1a) is green for every §6.1 rule, and the pilot is in its registry.
- [ ] QA checked the shared parts and the pilot in **both colour schemes**, per the SA Q-8 list (page at rest; KPI tile focus ring; date input and native select popups dark; drawer or dialog open with X visible, title readable, focus ring visible; error state; empty state), each as a screenshot or a one-line observation.
- [ ] QA ran `tsc --noEmit` on a scratch tsconfig (not committed) that covers the shared folder and the pilot page, **after first proving the scope bites with one deliberate canary error**, and recorded both runs in the QA report (SA-R-14). No CI job is added.
- [ ] The existing Jest gate stays green, with no added CI time.

Per slice:

- [ ] **L-1a:** the `AdminHeader` change ships with its test edited deliberately (C-1); every visible page shows exactly one `<h1>` once its spinner is gone (Q-11); `/admin` still opens on Health (X-3); Health's region-count, single-fetch, `GREEN_STYLE`, "never OK", client-file and verbatim-error pins hold with only the Refresh name edited; `business-os-llm/readJsonBody.ts` is a one-line re-export; the chrome root carries `[color-scheme:dark]`.
- [ ] **L-1b:** one green constant in the shared folder; the Jobs 11-button and single-`fetch(` pins hold; Health's guards are untouched; QA records whether the dialog X problem (F-88) was seen.
- [ ] **L-1c:** `AdminBusinessPicker` supports a label, generated ids (two on one page do not collide), Escape, arrow keys, a pasted UUID, and the chip with X. `useAdminFilters` round-trips every Audit trail param, omits defaults, reads the aliases `date_from` / `date_to` / `user_id` (date, minute form and instant; a one-sided window), rewrites to canonical names by replace, ignores invalid values, keeps unrelated params, and never writes a page-only key (search). QA opens, by hand, a Health figure link, a Businesses panel link and the cutover-notice link into Audit trail and sees the same view as before. The "only asks for the log list and the archive notice on mount" pin holds, or its change is a named forced change (F-28).
- [ ] **L-1d:** `AdminDrawer` traps focus, closes on Escape and overlay, returns focus to the opener, and its close button and title are readable in the **light** scheme (QA); its close button is a direct child of the dialog; Audit trail rows open in the drawer, the cards are gone, and pagination, Export CSV and requests are unchanged.

### 12.3 Per-page definition of done (every L-2a to L-12 slice, and the pilot page of each L-1 slice)

- [ ] Only this page's folder and its tests changed (plus the one alias line in the page's import guard, SA Q-3, and the recorded exceptions in §3 rule 1). The sidebar and the landing page are unchanged (§3 rule 9).
- [ ] Header: one h1 = the sidebar label (D-3 (a)), a one-line purpose, at most one factual badge.
- [ ] KPI strip per §7 (or none, as §7 says). Every tile is a link or plainly not clickable. Colours only per K-5. Text + icon on every coloured tile.
- [ ] Filter bar per §5.5. Filters are in the URL, except free-text search (never written) and the Signup Invites exception (D-7 (a)). Existing inbound links (§5.6 table) still open the same view. Clear and Refresh behave as specified. A Refresh-only bar is a plain `<div>`.
- [ ] Table per §5.7: one density, numbers right + tabular, unique headers, status chips with text.
- [ ] Rows with detail open in `AdminDrawer`. Escape works and focus returns.
- [ ] Loading keeps the header and filters mounted. Errors use fixed or route copy and never a parser message. The empty state is a sentence.
- [ ] Every icon-only button has an aria-label. Focus rings are visible. No shared component adds a landmark region.
- [ ] QA checked the page in the light **and** dark scheme, per the SA Q-8 list.
- [ ] QA ran the scoped `tsc --noEmit` with a canary first (as in §12.2) and recorded it.
- [ ] Same requests, same data, same actions as before, except the forced changes listed in §7, each named in the PR.
- [ ] Every guard or render test that changed is listed in the PR with the reason.
- [ ] Any new finding is added to §9, not fixed.
- [ ] The page is added to the migrated-pages registry (C-14).
- [ ] §1 is updated with the PR, the SA ruling and the merge.
- [ ] **L-7 only:** no Reply control is rendered, and a test asserts it (D-14 (b)).
- [ ] **L-8 only:** the `readJsonBody` re-export and the original `audit-trail/BusinessAccountPicker.tsx` are deleted and nothing imports either old path; the Activity replaceState spy test is green; "Close is a direct child of the dialog" holds.

---

## SA Review — 2026-10-09

**Reviewed by SA — 2026-10-09** (requirement stage; no code exists). Worktree `neuronforge-admin-layout`, HEAD `88f97171`.
**Status:** APPROVED WITH CONDITIONS.

Verified against the code: the 6 `DARK_DIALOG` copies; `cn()` plain join; dialog and sheet close buttons are direct children of Content (`dialog.tsx:101`, `sheet.tsx:68`), so `[&>button]:` wins; the Archiving, Tiers and Invites import guards; the BOS AI `@/lib/` rule (it scans only its own folder); the replaceState spy test; the Jobs "1 + 5 + 5 buttons" test; the Health region-count test; `readJsonBody` uses `response.json()` inside a try (so every existing fetch mock keeps working); the Health, Businesses and Activity link builders; the KPI payload fields for Activity, Costs, Analytics, Businesses, Jobs and Invites. Installed Next is **14.2.35**.

### Rulings on §11

| # | Ruling | Rationale |
|---|---|---|
| Q-1 | **`app/admin/components/layout/` approved.** No file in it may be named `page`, `layout`, `template`, `default`, `loading`, `error`, `not-found`, `global-error` or `route`. | Admin-only, beside the shell, outside every page guard. Those names are Next special files and match the R8 render-entry regex of the required Admin authz surface guard (`admin-authz-surface.guard.test.ts:882-883`). |
| Q-2 | **`window.history.replaceState(window.history.state, '', url)`, inside `useAdminFilters` only. Not `router.replace`.** The hook owns filter state; the URL is a projection of it. It refreshs `useSearchParams` only when the search string differs from the last one it wrote. | Next 14.2.35 patches `replaceState` unconditionally (`app-router.js:447-456`): it copies Next's internal state and dispatches a restore, so `useSearchParams` stays in sync with no server round trip. `router.replace` refetches the RSC payload on every filter change. Passing `history.state` keeps the existing spy test green. jsdom has no patch, so tests must not depend on `useSearchParams` updating after a write, which a hook-owned state already avoids. |
| Q-3 | **Each page slice adds exactly one alias prefix, `@/app/admin/components/layout/`, to its guard. Relative paths into the folder stay refused.** The safety then moves to a new guard on the shared folder (Q-7) that limits *its* imports to: react, lucide-react, next/link, next/navigation, `@/components/ui/sheet`, `@/components/ui/dialog`, `@/lib/logger/client`, and files inside the folder. Never `@/lib/business-os/**` (entitlements included), repositories, Supabase or `server-only`. | Page guards check only their own files. Without a guard on the shared folder, one allow-list line would let any import in transitively. The BOS AI guard needs **no edit**, because the shared folder is not under it. |
| Q-4 | **Wrap. `components/ui/*` is not edited by any layout slice.** | `sheet` and `dialog` have about 30 consumers outside admin (Business OS app, CRM, payments, scheduling). A token change there is an app-wide visual change. |
| Q-5 | **`cn()` stays a plain join; `tailwind-merge` is out of scope.** **No one-time swap of the 6 `DARK_DIALOG` copies:** each page adopts `ADMIN_DIALOG_CLASS` in its own slice. | Merging changes the result of every `cn()` call in the app (`dialog.tsx:85-93` relies on the plain join). The dialog swap touches 3 page folders. With the SA slice order the Jobs pilot fixes 3 of the 6 first. F-88 is inferred, not seen; if QA confirms it on Jobs, the user may pull the other 3 forward as one small slice (SA-U-3). |
| Q-6 | **`clientLogger.child({ module })` from `@/lib/logger/client` in every shared file.** `createLogger` in client files (F-56) is converted only in the slice of the page that owns the file. | Already used by `AdminHeader`, `settings` and `system-config`. A converted file is a "touched file", so the CLAUDE.md logging rule applies there. |
| Q-7 | **Yes, as one Jest file in `app/admin/components/layout/__tests__/`.** Part (a) is shared-folder hygiene: the Q-3 import list; no `var(--v2-`, no `dark:`, no `console.`; no direct `.json(` outside `readJsonBody`; `history.*State` only in the hook file; no Next special file names; exactly one green constant; no `role="region"`. Part (b) is the registry of migrated pages: it **starts with the L-1a pilot, not empty**, and each page asserts it imports `AdminPageHeader`, has no own `<h1`, and has no direct `.json(`. | Pure `fs` reads inside the existing Jest gate. No workflow, no npm script, no added wall time on the critical path (well under a second in one shard). |
| Q-8 | **QA browser check in both colour schemes, every slice.** The preview tools or the DevTools "prefers-color-scheme: light / dark" emulation count. That is exactly the media query `--background`/`--foreground` follow, so the OS does not need to be switched. QA records, per scheme: page at rest; KPI tile focus ring; date input and native select popups (dark); drawer or dialog open (X visible, title readable, focus ring visible); error state; empty state. Each item is a screenshot or a one-line observation. Jest backs it with the Q-7 part (a) checks. | No E2E tool exists, and adding one needs its own review. |
| Q-9 | **Set `[color-scheme:dark]` on the `AdminChrome` root in L-1a, and also inside `ADMIN_DIALOG_CLASS` and `AdminDrawer`. Do not define `--v2-*`.** | Radix dialogs and sheets portal to `body`, outside the chrome, so they do not inherit the chrome's value (SA-R-7). Parked pages get dark native controls too, consistent with their always-dark surface. |
| Q-10 | **`range`, `from`, `to`, `account`, plus permanent read aliases. The preset id is `this_month`, not `month`.** | It reuses the existing `activityPresets.ts` ids, which already have tests. U-6 corrected (SA-R-16). |
| Q-11 | **Remove the title. It is safe.** All 28 `page.tsx` files render their own h1 (Health and Jobs through `HealthGrid` / `JobsQueuesView`). The only exposure is temporary: Analytics, Businesses, Messages and Model pricing have no h1 while their early-return spinner shows, until each page's own slice. Test edits: `AdminHeader.render.test.tsx` "keeps the page title" becomes "renders no heading"; add "the menu button is named Open menu"; "exactly 2 buttons, no links" stays unchanged. Remove `getPageTitle` and its `usePathname` use (dead code). | No other test reads the AdminHeader title (checked). |
| Q-12 | **Native `<select>` for every filter-bar control. Archiving's per-source Radix retention select stays as it is.** | It sits inside a card and is not a filter-bar control; swapping it is not forced. |
| Q-13 | **The F-54 UTC fix is allowed in L-3 as a named forced change.** The route is unchanged, and the window labelled "(UTC)" must be the window that is queried. **Analytics presets keep `period=N`** (a rolling server window). The semantic difference from U-8 calendar days is recorded in §9 (SA-R-12), not fixed. New presets that Analytics lacks today (Today, This month) send explicit `dateFrom`/`dateTo`, which the route already accepts. | No API change. One label keeps two meanings on one page until someone decides otherwise; that is honest and small. |
| Q-14 | **A same-page tile renders `<a href={hrefFor(patch)}>`. A plain left click calls `preventDefault` and the hook's `apply(patch)`; a modified click, a middle click or copy-link uses the href. Cross-page tiles use `next/link`.** | One write path (the hook) and no RSC refetch, while links stay real links. |
| Q-15 | **Class constants + `OpenRowButton` approved. No `<AdminTable>` component.** | Smallest test edits; pages keep their markup and testids. |
| Q-16 | **One page-level `AdminDrawer` keyed by the selected id.** The confirmation dialogs (credits, delete) stay Radix dialogs opened from inside it. The Businesses Open button sits **inside the existing first cell**, not in a new column. | One fetch lifecycle, and abort on switch. Keeps the `defaultFilter.render` seven-columns pin with no edit. |

### Findings

| # | Severity | Finding | Owner |
|---|---|---|---|
| SA-R-1 | must-fix | U-7 accepted only `YYYY-MM-DD` or a full ISO instant. Health's audit links (`windows.ts:49-51`) and the cutover link (`activityCopy.ts:77`) send `YYYY-MM-DDTHH:mm`. Under U-4 that value would be dropped silently, and **every Health tile link into Audit trail would lose its window.** | **Corrected by SA** in U-7 (minute form, forwarded verbatim; one-sided window valid). |
| SA-R-2 | must-fix | The inbound-link table missed `CutoverNotice.tsx:22-30` (audit `entity_type` + `date_to` + `user_id`; analytics `scope` + `user`). | **Corrected by SA** (row added in §5.6). |
| SA-R-3 | must-fix | **Slicing.** L-1a/b/c as written merge about 13 shared components with **no consumer**, and §12.2 forbids a pilot. That is dead code on main for weeks, and it is designed blind. **Ruling: each L-1 slice = its shared components + exactly one pilot page that uses every new export, in the same PR.** Re-cut: **L-1a** shell (C-1, chrome color-scheme) + C-2 header + C-3 states + C-4 read helpers + C-5 formatters + the Refresh part of the bar → pilot **Admin users** (smallest; P-4 test edit only). **L-1b** C-11 KPI strip/tile + C-12 status chip + C-10 dialog class → pilot **Scheduled jobs & queues** (3 of the 6 dialogs, existing tones, the 11-button pin). **L-1c** C-7 URL hook + C-8 filter bar/presets/`resolveWindow` + C-6 picker + C-13 table constants → pilot **BOS AI Costs** tab + the BOS AI page header. **L-1d** C-9 drawer + `OpenRowButton` → pilot **BOS AI Activity**. Then Settings tab, AI cost & usage, Businesses, Audit trail, Health, Invites, Plans, Archiving, Messages, Model pricing. If the L-1c workplan exceeds a few days, the picker generalisation moves to L-1d. Every L-1 slice keeps the full cycle. BA rewrites §1, §8 and §12.2 to match. C-4: L-1a makes `business-os-llm/readJsonBody.ts` a one-line re-export (a recorded cross-folder edit), and it is deleted in L-1d. | BA |
| SA-R-4 | must-fix | **K-5 is too loose.** It allows colour from `lib/admin/health/rules.ts`, which the BOS AI and Jobs pages cannot import (guards; the C-21 type-only pattern). A client copy of a server rule is a second source of truth, which is the C-10R hazard. **Ruling:** a tile is coloured only from (i) a status the page's payload already carries (an aggregate of per-item statuses is fine), or (ii) an amber/red notice the page already renders for the same condition. Consequences: **L-2c Settings tiles are neutral** (the payload carries no status; Health's `settings.off` counts "areas **or** calls", which is not the tab's sum). **L-7 "Jobs" and "Queues" summary tiles are neutral counts**: a client "worst status" would disagree with Health tiles 6/7, which report "Not measured yet" when a job has no run. The Stuck and Dead-lettered (24 h) tiles may be red, because the payload's queue statuses already make them red. | BA (§5.4, §7.1, §7.6) |
| SA-R-5 | must-fix | **The Invites `history.*State` ban is not a style rule.** It stops the shown-once invite link from surviving a reload (`source.guard.test.ts:95-97`; `CreatedInvite.link`). L-8 keeps the ban on Invites files as it is (they will not call `history` themselves; the hook does). It **adds** assertions that the Invites filter spec has an exact key list (`state`, `type`, `issuer`; no free text, SA-R-8) and that `CreateInviteForm` and `CreatedLinkPanel` never import the hook. §7.8 says to "edit" the guard; that changes to "extend". | BA (§7.7) |
| SA-R-6 | must-fix | §6 has no rule for what the shared folder may import or how its files may be named. Add the Q-1 file-name ban, the Q-3 import list, "never imports `lib/business-os/entitlements` and writes no tier or capability literal" (so no slice ever touches the required entitlements invariants check), and the Q-7 guard as part of L-1a. | BA (§6) |
| SA-R-7 | should-fix | T-4/Q-9: `color-scheme` on the chrome does not reach portaled dialogs and sheets. `ADMIN_DIALOG_CLASS` and `AdminDrawer` must carry `[color-scheme:dark]` themselves. | BA (§5.2, §6 C-9/C-10) |
| SA-R-8 | should-fix | **Free-text search is not written to the URL.** It holds emails and names, which would land in browser history and in server request logs on reload or share. Selects, dates and account ids are written. Audit `search` stays a **read** alias (the Businesses panel sends a group id). It is an exception to U-1, stated in §5.6. | SA ruling; BA to record. User may override (SA-U-4) |
| SA-R-9 | should-fix | Messages KPIs (§7.11) count over a list the **server already filtered** by status and search (`api/admin/messages/route.ts:35-37`), so "Unread" reads 0 under the Replied filter. Mark them **NEEDS DATA**; L-12 ships without a strip unless the user wants a count slice (SA-U-2). | BA |
| SA-R-10 | should-fix | Invites: "Expired or revoked" counts two states but links to `state=expired` only. Split it, or make it not a link. The payload has `truncated`, so the tiles need the K-8 "at least" sub-line when it is set. | BA (§7.7) |
| SA-R-11 | should-fix | The Costs account `<select>` lists only the accounts in the report. The picker searches every business through a **new request** (`/api/admin/business-os/llm-usage/businesses`), so a pick can return empty. Name this as a forced change with its request in L-2b (now L-1c). The same applies to Analytics `?user=` in the All scope (agent-platform users are not in the picker; an inbound id shows as a short-id chip). | BA (§7.1, §7.2) |
| SA-R-12 | should-fix | Add F-94 to §9: Analytics "7 days" is a rolling server period (`period=N`), while elsewhere it means UTC calendar days (U-8). Disposition: user. | BA (§9) |
| SA-R-13 | should-fix | Landmarks: shared components never render `role="region"` (no `<section>` with an accessible name), so the Health region-count pin holds. The bar is `role="search"` only when it holds filter controls; a Refresh-only bar is a plain `div`. | BA (§5.5, §5.10) |
| SA-R-14 | should-fix | ts-jest does not type-check, and no required job type-checks `app/admin`. Each L-1 and page slice's QA runs `tsc --noEmit` on a scratch tsconfig (not committed) that covers the shared folder + the slice's page, with **one deliberate canary error first, to prove the scope bites**. QA records it. No CI job is added. | BA (§12.2, §12.3) |
| SA-R-15 | note | §7.1 "AI actions" said "at least when capped". `total` is exact whenever present (`ActivityCountLine.tsx:12-21`). | **Corrected by SA** |
| SA-R-16 | note | U-6 `month` → `this_month` (Q-10). | **Corrected by SA** |
| SA-R-17 | note | Scope check. These are layout-forced and acceptable: F-73 (preset discards typed input), F-9 GET error state, F-31, F-50, F-58, Audit trail cards → table, presets added to Audit trail. **F-28** stays **open**: L-5 must not deliberately change Audit trail request sequencing (the "only the log list and the archive notice on mount" pin). If the hook changes it anyway, that is a named forced change with its test. **UD-7 (a)** "fix reply first" is a full-cycle API slice (route stub, hardcoded `admin_id`, `console.*`), never part of L-12. | — |
| SA-R-18 | note | L-5: the Custom range goes from minute precision (`datetime-local`) to dates. List it as a visible change in §7.4. Inbound minute links are still honoured (U-7). | BA (§7.4) |
| SA-R-19 | note | **UD-4 is technical**, not a product choice: SA has ruled one slice per tab, which SA-R-3 supersedes. Move it out of §10. All other UD items are genuine product choices. Q-13 is technical, but the user should know that custom-range totals on AI cost & usage shift by the admin's UTC offset. | BA (§10) |
| SA-R-20 | note | Build: `useSearchParams` in admin pages is safe from the Next 14 Suspense bail-out, because `app/admin/layout.tsx` reads cookies (dynamic). The required Build check confirms it per slice. The React hooks guard is fine (`useAdminFilters` and `useDrawerResource` are real hooks). | — |

### User decisions to add to §10 (SA)

| # | Question | SA recommendation |
|---|---|---|
| SA-U-1 | The page order changes so that each shared part is proved on a real page as it is built: **Admin users** and **Scheduled jobs & queues** move to first, then Business OS AI Costs, then Activity. The rest keep your order. | Accept. Each shared part merges with a page that uses it, so nothing unused sits on main. |
| SA-U-2 | **Messages headline numbers** would need a new count from the server (today's list is already filtered). | No strip on Messages now. A separate reviewed slice later, if wanted. |
| SA-U-3 | If QA confirms on Jobs that the dialog close X is near-invisible in light mode, fix the remaining 3 dialogs (Archiving, Businesses ×2) **now, as one small slice**, or wait for those pages' slices? | Wait, unless you have seen it bite. |
| SA-U-4 | **Search text is not kept in the link** (privacy: emails would end up in browser history and server logs). Links still carry dates, business and dropdown choices. | Accept. |

### Verdict

**APPROVED WITH CONDITIONS.** The standard is buildable as written once SA-R-3 to SA-R-6 are fixed by BA. The SA corrections (SA-R-1, R-2, R-15, R-16) are already made. Conditions before the L-1a workplan:

1. BA resolves SA-R-3 to SA-R-6 and folds in the should-fix items SA-R-7 to SA-R-14.
2. The user answers UD-1 to UD-10 (minus UD-4) and SA-U-1 to SA-U-4.
3. SA re-checks only the edited sections. No full re-review is needed.

### BA response — 2026-10-09 (SA findings)

The SA text above uses the first draft's ids (old L-7 = Jobs, old L-8 = Invites, old §7.x numbering, UD-x). The §1 mapping table translates them. Decisions are D-1..D-14 in §10. The section numbers in this table are updated to the current layout; slice ids cited here are current ids.

| SA item | Where it is addressed |
|---|---|
| SA-R-1, SA-R-2, SA-R-15, SA-R-16 | Corrected by SA; kept unchanged (§5.6 U-6, U-7, inbound-link table; §7.11 "AI actions") |
| SA-R-3 | §1 (slices re-cut, id map, full cycle vs short path note); §3 (process, rule 1 exceptions); §6.2 Slice column; §7.1–§7.4 (the four pilots); §8; §12.2. Rule "an export the pilot does not use is not built yet" in §6.2 and §12.2. **The pilots themselves were re-picked on 2026-10-09** (second table below) |
| SA-R-4 | §5.4 K-5 in SA's wording; §7.2 Jobs/Queues tiles neutral, Stuck and Dead-lettered red; §7.13 Settings tiles all neutral; other §7 colour cells cite K-5 (i) or (ii) |
| SA-R-5 | §7.9: ban kept as is, guard extended (exact key list; `CreateInviteForm` and `CreatedLinkPanel` never import `useAdminFilters`; no Invites file imports it). **BA went one step stricter than SA-R-5, as directed by TL:** Invites writes no filters to the URL at all. **The user chose this (D-7 (a), 2026-10-09). SA to confirm on re-check** (R-16) |
| SA-R-6 | §6.1 (S-1 to S-10), C-14 in §6.2, shipped in L-1a |
| SA-R-7 | §5.2 T-4; §5.8 D-4; §6.2 C-9 and C-10 |
| SA-R-8 | §5.5 part 4; §5.6 U-1 exception (1) and inbound table; §6.2 C-7 page-only keys; §7.3, §7.7, §7.9, §7.10; the user confirmed it (D-6 (a)) |
| SA-R-9 | §7.10 (no strip, NEEDS DATA); §1 row L-X2 (not planned, D-13 (a)) |
| SA-R-10 | §7.9 (Expired and Revoked split into two tiles; "at least" sub-line when `truncated`) |
| SA-R-11 | §7.12 forced changes (picker request, empty result possible); §7.5 (`?user=` in the All scope) |
| SA-R-12 | §9 F-94 (count 94); §5.6 U-8; §10 "For your information" |
| SA-R-13 | §5.5 layout; §5.10; §5.12 A-9; §6.1 S-8; §7.1 (Health region-count pin) |
| SA-R-14 | §12.2 and §12.3 (scoped `tsc --noEmit` with a canary, recorded by QA) |
| SA-R-17 | §7.3 (F-28 stays open, now in L-1c); §9 F-28. The reply fix: the user chose D-14 (b), so no fix slice is planned (former L-10r removed) and Reply is hidden in L-7 (§7.10) |
| SA-R-18 | §7.3 (Custom range precision named as a visible change) |
| SA-R-19 | UD-4 removed from §10; the Q-13 offset note is in §10 "For your information" |
| SA-R-20 | No change needed |
| SA-U-1 to SA-U-4 | §10 D-1, D-13, D-8, D-6 (all answered (a), 2026-10-09) |
| Rulings Q-5, Q-12, Q-16 | §6.2 C-10 and §7.2/§7.6/§7.7 (no one-time dialog swap; L-D not planned, D-8 (a)); §7.6 (Archiving retention select stays Radix); §7.4 and §7.7 (one page-level drawer; Businesses Open button inside the first cell) |

### BA response — 2026-10-09 (user decisions and sidebar-order re-cut): items for SA to re-check

The user answered §10 ("all recommended; D-14: b") and asked that the work follow the sidebar's section priority (Monitor → Businesses → Settings) with Health first and the sidebar and landing page unchanged. BA re-picked the pilots from the Monitor section and re-ordered the page slices. **SA re-checks only the items below** and the sections they cite. Several SA rulings name a pilot page that changed; those are flagged "restate".

| # | Item | Where | BA suggestion |
|---|---|---|---|
| R-1 | **L-1a pilot is now Health** (was Admin users). Health's strict pins must hold with only the Refresh name edited: region count (`health.render :144-145`), exactly one `fetch` with `no-store` (`:116-121`), `GREEN_STYLE` referenced exactly twice and "never OK" (`health.source.guard`, explicit 3-file list), `'use client'` on every listed file, verbatim "Forbidden". **Restate Q-7:** the registry starts with Health, whose h1 lives in `components/health/HealthGrid.tsx`, so the registry assertions must scan the page's files, not only `page.tsx`. **Restate Q-11:** the AdminHeader test that pins heading "Health" at `/admin` becomes "renders no heading", and Health is the first page whose single h1 is proven | §6.2 C-1, C-4, C-14; §7.1; §12.2 L-1a | Approve. `readJsonBody` / `readAdminResponse` must never call `fetch` |
| R-2 | Exports Health does not use (`AdminEmpty`, `AdminNotice`, possibly `formatUtcDate`, `formatCount`) move to the first pilot that does (L-1b or L-1c), per the SA-R-3 rule | §6.2 C-3, C-5; §7.1 | Approve; Dev records the move in §1 at workplan |
| R-3 | **L-1c and L-1d both pilot Audit trail** (filters half, then table + drawer half), instead of the TL-suggested pairing Audit trail / AI cost & usage. Reason: AI cost & usage (1,690 lines) needs the KPI strip, the filter bar and the drawer together and cannot be a pilot within a few days; Audit trail split in two keeps each slice a few days and each slice still has one pilot page | §1; §7.3; §7.4; §8; §12.2 | Approve. Between L-1c and L-1d Audit trail is half-migrated (cards with inline expand); acceptable because the two slices run back to back |
| R-4 | **Restate Q-2:** the hook's first pilot is now Audit trail, not the BOS AI page. It must keep the "only asks for the log list and the archive notice on mount" pin (F-28, SA-R-17), and it deliberately edits "leaves the URL alone". The Activity replaceState spy is first met in L-8. L-1c exercises the aliases `date_from` / `date_to` / `user_id`, the minute form, instants and the one-sided cutover link | §6.2 C-7; §7.3; §12.2 L-1c | Approve |
| R-5 | Table constants (C-13) move from L-1c to L-1d, because Audit trail's table arrives in L-1d | §6.2 C-13; §7.4 | Approve |
| R-6 | `useDrawerResource`: if Audit trail's expand panel renders from the row already loaded, the hook is not built in L-1d and moves to the first drawer that fetches (L-2b if the call-detail modal fetches, else L-4 Businesses). That would put new shared code in a page slice | §6.2 C-9; §1; §3 | That page slice runs the full cycle |
| R-7 | The same-page filter mode of `KpiTile` (Q-14) needs `useAdminFilters` (L-1c) and Jobs' tiles are anchors, so its first consumer is AI cost & usage (L-2a), a page slice. **Restate Q-14** for that slice | §5.4 K-6; §6.2 C-11; §7.5 | L-2a runs the full cycle |
| R-8 | **Restate Q-16:** the page-level drawer keyed by the selected id is now first proven on Audit trail (L-1d), before Businesses (L-4) | §7.4; §7.7 | Approve |
| R-9 | **Restate Q-3:** the BOS AI "no `@/lib/`" guard is first exercised in L-8 (not L-1c / L-1d); no edit expected. The one-line alias edits now land in L-3 (Archiving), L-5 (Plans), L-6 (Invites) | §6.2 last paragraph; §7.6, §7.8, §7.9 | Approve |
| R-10 | The `readJsonBody` re-export now lives from L-1a until L-8 (weeks, not days). Keep SA's re-export, or have L-1a repoint the two importers (Activity tab, drawer) and delete the old file at once | §6.2 C-4; §3 rule 1; §7.11 | Keep the re-export (SA-R-3 as ruled; only the deleting slice changes) |
| R-11 | The original `audit-trail/BusinessAccountPicker.tsx` stays in the audit-trail folder after L-1c (Activity imports it, `ActivityFilters.tsx:20`) and is deleted in L-8, a recorded cross-folder edit | §3 rule 1; §6.2 C-6; §7.11 | Approve |
| R-12 | Business OS AI slices run Activity → Costs & credits → Settings, the reverse of the on-screen tab order (Settings, Costs & credits, Activity), which is not changed. Reason: Activity is the smallest diff and holds the last importers of both leftovers | §7.11; §8 | Approve |
| R-13 | D-10 (a) vs K-1 in the All scope: Total spend + 4 category tiles = 5 tiles; Calls, Tokens and Avg cost per call move into the Quick stats card below the table. BOS scope: 4 tiles | §7.5 | Approve |
| R-14 | Hard constraint X-1 to X-3: no slice edits `AdminSidebar.tsx`, `AdminSidebar.nav.test.ts` or `app/admin/layout.tsx`. No new guard: the existing nav test already pins order and labels | §2.3; §3 rule 9; §12.2; §12.3 | Approve, no new guard |
| R-15 | D-14 (b): Reply is hidden in L-7 as a UI-only change (no route or request change); F-1 / F-11 stay open. Confirm hiding a control on user instruction is in scope for a short-path layout slice | §7.10; §12.3 | Approve |
| R-16 | D-7 (a) is now the user's decision: Invites writes no filters to the URL, guard extended with assertions (1) to (3). SA had asked to confirm BA's stricter version | §7.9 | Approve |
| R-17 | **Restate Q-5 and Q-13** for the new ids: Q-5's "Jobs pilot fixes 3 of the 6 first" still holds, and D-8 (a) means no L-D; Q-13's forced UTC change now lands in L-2a (was L-3) | §6.2 C-10; §7.5; §9 F-54, F-88 | Approve, ids only |

### SA re-check — 2026-10-09

**Re-checked by SA — 2026-10-09** (requirement stage, no code). Scope: R-1 to R-17 and the sections they cite. Verified against the code at HEAD `88f97171`: `health.render.test.tsx` (fetch mock is `{ ok, status, json }` only; `health-error` textContent pinned to exactly "Forbidden"; Refresh by name; region count; `@/lib/logger` mocked with `createLogger` only), `health.source.guard.test.ts` (explicit 3-file list; green, "OK", console, import rules), `health.qa-slice5.render.test.tsx` (renders `HealthTile` alone), `AdminHeader.render.test.tsx`, `AdminChrome.tsx`, `business-os-llm/readJsonBody.ts` and its two importers, the BOS AI import guard (bans `@/lib/` and named modules only), `audit-trail/page.tsx` (one `fetch(`, at `:329`), the 11 Audit trail test files, `analytics/page.tsx` (one `fetch(`, at `:321`), `AdminSidebar.tsx` labels, and the authz guard's render-entry regex.

**Status:** APPROVED. Ready for the L-1a Dev workplan. Conditions RC-1 to RC-8 below are carried into the named workplans; none blocks L-1a from starting.

#### Rulings on R-1 to R-17

| # | Ruling | Rationale |
|---|---|---|
| R-1 | **Approved, with RC-1 to RC-4.** Restated Q-7: each registry entry is an **explicit file list** (Health: `app/admin/page.tsx`, `components/health/HealthGrid.tsx`, `components/health/HealthTile.tsx`), each file must exist, "imports `AdminPageHeader`" holds for at least one file, "no `<h1`" and "no `.json(`" hold for every file. Restated Q-11: `AdminHeader.render` "keeps the page title" becomes "renders no heading"; `health.render` adds "exactly one level-1 heading, named Health" | A folder scan cannot work (Health lives in `app/admin/` root plus `components/health/`); an explicit list mirrors `health.source.guard` |
| R-2 | **Approved.** L-1a builds `AdminLoading`, `AdminError`, `formatUtc` only. `AdminEmpty`, `AdminNotice`, `formatUtcDate`, `formatCount`, and the `badge` / `actions` props of `AdminPageHeader` are built by the first pilot that uses them; Dev records each move in §1 | Health uses none of them; SA-R-3 forbids unconsumed shared code |
| R-3 | **Approved.** Audit trail between L-1c and L-1d is a coherent, shippable page | Verified: the expand panel renders from the row already loaded (single fetch), so cards + inline expand keep working under the new header, bar, URL and states; every C-14 registry assertion is met by part 1 |
| R-4 | **Approved, with RC-6.** Restated Q-2 unchanged in mechanism; first pilot Audit trail. `businessPicker.render :389` "leaves the URL alone" becomes "rewrites `user_id` to `account` by replace" (U-9) | The mount pin is the hook's proof that it adds no request |
| R-5 | **Approved** (C-13 to L-1d) | Audit trail's table arrives in L-1d |
| R-6 | **Approved as: `useDrawerResource` is not built in L-1d or L-2b; the page slice that first builds it runs the full cycle** (expected L-8) | Verified: Audit trail and the Analytics call modal both render from the loaded row. The Businesses panel fetches inside its own components, which L-4 keeps. The Activity drill-down is the first drawer whose shell owns a fetch, and is the hook's source |
| R-7 | **Approved: L-2a runs the full cycle.** Restated Q-14 unchanged in mechanism; first consumer AI cost & usage | A shared export built in a page slice is a new pattern used by every later page (CLAUDE.md rule 7); it needs a reviewed workplan |
| R-8 | **Approved.** Restated Q-16: one page-level `AdminDrawer` keyed by the selected row, first proven on Audit trail. Audit trail's Open button is the new first column (§5.8 D-2); the Businesses "inside the first cell" rule still applies in L-4 | Audit trail has no column-count pin; Businesses does |
| R-9 | **Approved.** Restated Q-3: alias lines land in L-3, L-5, L-6; the BOS AI guard needs no edit in any slice | Verified: it bans `@/lib/` and named modules; `@/app/admin/components/layout/` passes |
| R-10 | **Approved: keep the re-export until L-8.** It re-exports both `readJsonBody` and the `ApiBody` type | One line, passes the BOS AI guard (verified), and keeps L-1a out of BOS AI page files |
| R-11 | **Approved, with RC-7** | Verified importers: Audit trail page, Activity filters, and two Audit trail tests (`businessPicker.contract`, `businessPicker.render`) |
| R-12 | **Approved** | Slice order is internal; the on-screen tab order is not changed |
| R-13 | **Approved** | All scope: the strip is the same five cards as today, and Calls / Tokens / Avg cost already sit in Quick stats; BOS scope: 4 tiles. K-1 holds in both, no data moves |
| R-14 | **Approved, no new guard.** Consistent in §1, §2.3, §3 rule 9, §12.2, §12.3 | Order and labels: `AdminSidebar.nav.test.ts`. Landing: `health.render` imports `app/admin/page.tsx` and asserts Health tiles. Layout: the required authz guard. All three would go red on a change |
| R-15 | **Approved: remove** the Reply control, modal and handler from the page component; route untouched (§7.10 updated by SA) | A hidden-but-present path is dead code (SA code review item 8); D-14 (b) is a recorded user decision, so rule 4 allows it |
| R-16 | **Approved** (D-7 (a)) | Stricter than SA-R-5 and simpler to keep true; the user chose it |
| R-17 | **Approved, ids only.** Q-5: Jobs fixes 3 of 6 dialogs in L-1b, Archiving in L-3, Businesses in L-4. Q-13: F-54 is a named forced change in L-2a | — |

#### New findings (conditions)

| # | Severity | Finding / condition | Slice |
|---|---|---|---|
| RC-1 | must | Every existing page test mocks `@/lib/logger` with `createLogger` only. `@/lib/logger/client` re-exports from that same module, so once a pilot file imports `clientLogger`, `clientLogger.child(...)` at module scope throws on import. Each affected test adds a `jest.mock('@/lib/logger/client', …)` (the `AdminHeader.render` pattern). A recorded, mechanical test edit: `health.render` in L-1a; the 5 Jobs render tests in L-1b; the Audit trail render tests in L-1c | L-1a, L-1b, L-1c |
| RC-2 | must | `readJsonBody` / `readAdminResponse` read only `response.ok`, `response.status` and `response.json()`. No `headers`, `text()` or `clone()`: every existing fetch mock provides only those three | L-1a |
| RC-3 | must | `AdminError` places the caller's `data-testid` on the **message element**, with the icon `aria-hidden` and "Try again" outside it, so `health-error` textContent stays exactly "Forbidden" with no test edit | L-1a |
| RC-4 | must | `readAdminResponse` message precedence is §5.10 (1) to (4) for every status. The "session ended" copy for 401/403 is **opt-in per page** (default off). Health does not opt in, so the server's text stays verbatim | L-1a |
| RC-5 | must | C-14 part (a) in L-1a asserts **at most one** green constant (none exists until `StatusChip`); L-1b tightens it to exactly one | L-1a, L-1b |
| RC-6 | must | The shared picker never fetches on mount to resolve a name for an inbound id: short-id chip until the admin picks. Otherwise the F-28 mount pin breaks | L-1c |
| RC-7 | must | `businessPicker.contract.test.ts` pins the original picker path and the audit surface. L-1c re-points it to cover the shared picker (and the original until L-8); S-4 already bans `@/lib/business-os/**` in the shared folder | L-1c |
| RC-8 | should | L-1c is the largest L-1 slice (hook, full bar, presets, picker, a 1,263-line page, about 7 test files). Dev decides at workplan whether C-6 moves to L-1d (pre-authorised in §7.3). If it moves, the old picker sits in bar position 3 for one slice | L-1c |

Doc corrections made by SA: §1 path note and rows L-2a, L-2b, L-8; §3 short-path exception; §5.5 part 6 (Read-at omitted beside a server "As of"); §7.1 and §9 F-57 (`HealthTile.tsx` not edited in L-1a); §7.3 test edits (picker contract and render tests); §7.10 (Reply removed, R-15).

**Slice sizes.** L-1a: small (about 2 days). L-1b: moderate. L-1c: the largest, with the RC-8 fallback. L-1d: moderate. Each merges on its own with its pilot, and Audit trail is shippable between L-1c and L-1d (R-3).

#### L-1a scope for the Dev workplan

| Area | Contents |
|---|---|
| New, `app/admin/components/layout/` | `AdminPageHeader` (`title`, `purpose`, `asOf`; no `badge` / `actions` yet); `AdminLoading`; `AdminError` (RC-3, optional "Try again"); `readJsonBody` (moved) + `readAdminResponse` (RC-2, RC-4); `formatUtc` (Date-based, from `jobsFormat.ts`); the Refresh-only `AdminFilterBar` (plain `div`, Refresh button with `aria-busy`, optional Read-at); render or unit tests for each (happy + one failure path); the C-14 guard file (part (a) per §6.1 with RC-5; part (b) registry = Health, per R-1) |
| Shell | `AdminHeader.tsx`: remove the `<h1>`, `getPageTitle` and `usePathname`; `aria-label="Open menu"` on the menu button; the date line and Sign out unchanged. `AdminChrome.tsx`: `[color-scheme:dark]` on the root |
| BOS AI (one line) | `business-os-llm/readJsonBody.ts` → re-export of `readJsonBody` and `ApiBody` |
| Health pilot | `HealthGrid.tsx` only: `AdminPageHeader` (h1 "Health", purpose sentence unchanged, "As of" through `formatUtc` on `text-slate-400`); Refresh bar, no Read-at, aria-label "Refresh the health summary", calling the existing `load`; `AdminLoading`; `AdminError` with testid `health-error`; `readAdminResponse` with status checked first; `clientLogger.child`. Still `'use client'`, no green, no "OK", no console, no `<section>` / region. `app/admin/page.tsx` and `HealthTile.tsx` are not edited |
| Tests deliberately edited | `health.render.test.tsx`: Refresh query → "Refresh the health summary"; logger mock (RC-1); add the single-h1 assertion. `AdminHeader.render.test.tsx`: "keeps the page title" → "renders no heading"; add "the menu button is named Open menu"; "exactly 2 buttons, no links" unchanged |
| Tests that stay green with no edit | `health.source.guard`, `health.qa-slice5.render`, `AdminSidebar.nav`, the BOS AI guards and Activity tests, the authz surface guard |
| Not touched | `AdminSidebar.tsx`, `app/admin/layout.tsx`, `components/ui/*`, `lib/utils.ts`, every other page |

#### Verdict

**APPROVED. Ready for the L-1a Dev workplan.** The workplan must show RC-1 to RC-5 and the scope table above. RC-6 to RC-8 go into the L-1c workplan. Moving the document status to Approved still needs user or TL sign-off (§12.1).

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Created (BA draft) | Survey of 12 visible pages / 14 views; the standard (§5); 13 shared components; per-page plans L-2 to L-13; 93 found-not-in-scope items; 10 user decisions; 16 SA questions. Awaiting SA review. |
| 2026-10-09 | SA review (requirement stage) | APPROVED WITH CONDITIONS. Rulings Q-1 to Q-16; findings SA-R-1 to SA-R-20; 4 user decisions added (SA-U-1 to SA-U-4). SA corrected U-6, U-7, the inbound-link table (cutover link) and the Activity "AI actions" KPI row. BA to fix SA-R-3 to SA-R-6 (pilot-per-slice re-cut, K-5 colour source, Invites link guard, shared-folder guard). |
| 2026-10-09 | BA revision after SA review | Slices re-cut per SA-R-3: L-1a (Admin users), L-1b (Jobs & queues), L-1c (BOS AI Costs + page header), L-1d (BOS AI Activity), each shared slice with one pilot page; remaining pages renumbered L-2 to L-11; L-5x, L-10x, L-10r, L-D as separate rows. K-5 tightened (SA-R-4). Invites: history ban kept, guard extended, filters kept out of the URL as a deliberate exception (SA-R-5, D-7). Shared-folder rules §6.1 and guard C-14 (SA-R-6). SA-R-7 to SA-R-14 folded in. §10 rewritten as the single final list D-1 to D-14. BA response table added to the SA Review. |
| 2026-10-09 | User decisions recorded; slices re-cut to sidebar order | User: "all recommended; D-14: b", plus keep the sidebar sections and order (Monitor → Businesses → Settings) and Health as the `/admin` landing page. Answers recorded in §10 with their consequences. Hard constraint added (§2.3 X-1 to X-3, §3 rule 9). Pilots re-picked from Monitor: L-1a Health, L-1b Jobs (unchanged), L-1c Audit trail part 1 (filters), L-1d Audit trail part 2 (table constants moved here + drawer). Page slices renumbered in sidebar order: L-2a/L-2b AI cost & usage, L-3 Archiving, L-4 Businesses, L-5 Plans, L-6 Invites, L-7 Messages (Reply hidden, D-14 (b)), L-8 BOS AI header + Activity, L-9 Costs & credits, L-10 Settings tab, L-11 Model pricing (depends on the price review merging), L-12 Admin users. L-10r removed; L-5x / L-10x renamed L-X1 / L-X2 and L-D kept, all not planned under the answers. §1, §6.2, §7, §8, §9 dispositions, §12 and the id map updated. Second BA response table lists R-1 to R-17 for SA re-check. Status: awaiting SA re-check. |
| 2026-10-09 | SA re-check (R-1 to R-17) | APPROVED, ready for the L-1a Dev workplan. R-1 to R-17 approved; R-6 and R-7 ruled as "a page slice that builds a shared export runs the full cycle" (L-2a; `useDrawerResource` not in L-1d or L-2b, expected L-8). New conditions RC-1 to RC-8 (logger mocks, read-helper surface, error testid, session copy opt-in, green-constant count, picker mount fetch, picker contract test, L-1c size). SA corrected §1, §3, §5.5, §7.1, §7.3, §7.10 and §9 F-57. L-1a scope listed for Dev. §12.1 SA re-check ticked. |
