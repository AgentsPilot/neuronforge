# Workplan: Admin Layout Standard — Slice L-1d (table constants, drawer + Open-row button → pilot Audit trail, part 2)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (rows 3 and 4), §5.7, §5.8 (D-1 to D-8), §5.9, §5.10 (Partial notice), §5.11, §5.12 (A-1 to A-9), §6.1 (S-1 to S-10), §6.2 (C-3 `AdminNotice`, C-6, C-9, C-12 `info` tone, C-13, C-14), §7.4, §9 (F-29, F-31, F-56, F-65, F-66), §12.2 (L-1d line), §12.3; SA re-check R-3, R-6, R-8 (Q-16), RC-6, RC-7, R-11; L-1c workplan SA review Q-1 (RC-8 and the pre-authorised L-1e split), N-3, N-4; L-1c SA code review SF-1, N-2; L-1c QA report E-1 ([ADMIN_LAYOUT_L1C_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L1C_WORKPLAN.md))
**Branch:** `feature/admin-layout-l1d`, cut from `feature/admin-layout-l1c`; L-1c merged as PR #291 and the branch was fast-forwarded to `origin/main` `4530dfb4` before implementation, so its diff against `main` is L-1d only. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Code Complete — uncommitted, awaiting SA code review (Implementation Notes below)
**Path:** full cycle (new shared patterns, CLAUDE.md rule 7). Fast-track after SA + QA (user rule for these UI slices)

## Overview

L-1d finishes Audit trail. The cards become a standard table built on the shared table constants (C-13). The inline expand becomes one page-level `AdminDrawer` (C-9), opened from an `OpenRowButton` in a new first column (R-8). The drawer renders the row that is already loaded, so there is no new request and no `useDrawerResource` (R-6). Severity shows as a `StatusChip` (this adds the `info` tone). The search caveat becomes the first `AdminNotice` (C-3). The slice also fixes QA E-1 in `useAdminFilters`. **Decision (§2.2): the business picker swap (C-6, its chip, F-31, RC-6, RC-7 and the picker test edits) moves to its own slice L-1e**, as SA pre-authorised at the L-1c review (Q-1). L-1d without the picker is about 4 days; with it, about 5.5. Requests, pagination, Export CSV, permissions and actions do not change. The forced visible changes are listed in §3.8.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary-code-verified-at-e99c89b5)
2. [Scope and the L-1e decision](#2-scope-and-the-l-1e-decision)
3. [Implementation Approach and Component APIs](#3-implementation-approach-and-component-apis)
4. [The C-14 guard changes](#4-the-c-14-guard-changes)
5. [Tests](#5-tests)
6. [Verification](#6-verification)
7. [Task List](#7-task-list)
8. [Sizing](#8-sizing)
9. [Risks](#9-risks)
10. [Out of scope](#10-out-of-scope)
11. [Questions for SA](#11-questions-for-sa)
12. [Appendix: L-1e outline](#12-appendix-l-1e-outline-its-own-workplan-follows-l-1d)

---

## 1. Analysis Summary (code verified at `e99c89b5`)

### 1.1 Files this slice touches, as they are today

| File | Today (line refs) |
|---|---|
| `app/admin/audit-trail/page.tsx` (1,176 lines) | `accountFilterLabel` `:158-165`; `AiActionDetailsView` + `AiActionDetails` allow-list `:177-263` (`AiDetailValue` tiles `:216-224`); state `:274-298` (`expandedLog` `:279`); `fetchLogs` `:300-341`; the two `[filters]` effects `:343-350` (F-28 pin, unchanged); `getSeverityIcon` `:352-359`; `getSeverityColor` `:361-368` (unused, F-29); `formatDate` local time with seconds `:430-440`; `exportLogs` `:450-469` (F-4 not fixed); chips `:471-486`; header `:491-503`; bar `:505-629` (old picker `:515-526`); error `:631`; notice `:636`; content `:638-1173`: count line + pager card `:644-730` (search caveat `:668-671`), cards `:733-1170` (card header `:750-844`, hand-built severity badge `:769-777`, compliance chip `:783-787`, the "Resource:" / "Entity id:" / "User:" / "Business:" line `:800-843`, inline expand `:847-1166`; the AI detection line `:905`, the generic-dump line `:1125`) |
| `app/admin/components/layout/useAdminFilters.ts` | Re-read effect `:147-152`; write effect `:157-165`, deps `[filters, spec, hasRouter]`. E-1: an outside change that parses to the current state leaves `filters` unchanged, so the write effect never runs and the address bar keeps the junk or alias string |
| `app/admin/components/layout/StatusChip.tsx` | Tones `danger`, `warn`, `ok`, `unknown` (`:19`, `:30-35`); `info` deferred to its first consumer (SA Q-4) |
| `app/admin/components/layout/AdminStates.tsx` | `AdminLoading`, `AdminError`, `AdminEmpty`; `AdminNotice` deferred to L-1d |
| `components/ui/sheet.tsx` (read only, never edited) | Close button `:68`: `text-[var(--v2-text-muted,…)]` and `focus:ring-ring focus:ring-offset-2` (F-66: no colour token, and a white offset on a dark panel); it is a **direct child** of `SheetPrimitive.Content`. Title `:111`: `text-[var(--v2-text-primary,…)]` joined with the caller's class by a plain `cn()` (F-65) |
| Template (read only): `business-os-llm/components/activity/ActivityDrillDown.tsx` | `Field` `:76-85` (`<div className="contents">` + `dt`/`dd`), `Section` `:87-98` (**a `<section aria-labelledby>`**, which S-8 forbids in the shared folder), Sheet wiring `:297-347` (`onCloseAutoFocus` with `preventDefault` + the caller's `onReturnFocus` `:307-310`; `[&>button]:text-slate-300` + inline `backgroundColor`; `SheetTitle` `:319`). `ActivityTable.tsx:146-158` is the Open button (`PanelRightOpen`, `onOpen(id, event.currentTarget)`). **Neither file is edited** (the Activity drawer moves in L-8) |

### 1.2 What the drawer needs (R-6 check)

The expand panel reads only fields of the loaded row: `id`, `entity_id`, `entity_type`, `severity`, `compliance_flags`, `user_id` + `users` + `user_email`, `business`, `resource_name`, `details`, `changes`, `action`, `created_at`. There is no fetch in `:847-1166`. **So the drawer renders from the row and `useDrawerResource` is not built** (R-6, expected L-8).

### 1.3 Test facts this plan depends on

| Fact | Where |
|---|---|
| Four render tests find a row through its card: `closest('div.rounded-xl')` and the inline labels "Resource:", "Entity id:", "User:", "Business:" | `resourceAndBusiness.render` `:109-115` and every case; `userEmailFallback.render` `:89-95`, `:109`, `:121`, `:134`, `:142`; `userNameAndPlaceholder.render` `:84-89` |
| Three tests open the expand by clicking row text, then read a tile through `parentElement` | `aiCostPrecision.render` `:94-96`; `userEmailFallback.render` `:98-102`, `:145-147` (`findByText('User', { selector: 'div' })`); `userNameAndPlaceholder.render` `:100-104` |
| The card title is an `h3`, queried as a heading | `auditTrail.layout.render` `:474`, `:480` |
| The resource test bans an em dash anywhere on screen | `resourceAndBusiness.render` `:168-171` (written for the resource placeholder) |
| The count line and pager words are pinned, and the pager label is found through the Next button's parent | `searchTotals.render` `:106-111`, `:133`, `:156-161`, `:177`; totals 14332 / 717 |
| Static guard reads `page.tsx` for the AI allow-list and the two detection lines | `filterOptions.guard` `:23`, `:80-101` |
| Every Audit trail fetch mock is `{ ok, json }` (some add `status`); jsdom has Radix portals (Activity precedent) | all render tests; `activityDrillDown.render` `:488-497` (Escape + focus return) |
| The shared guard's S-8 refuses any `<section` in the shared folder | `layoutFolder.guard.test.ts` `SECTION` |

### 1.4 Logging

`page.tsx` has no `console.*` (L-1c converted it). Every new shared file logs nothing, or uses `clientLogger.child` if it must (none needs to). Nothing to flag.

---

## 2. Scope and the L-1e decision

### 2.1 In L-1d

| Area | In L-1d |
|---|---|
| Shared, new | `adminTable.ts` (C-13 class constants, `formatShortId`); `AdminDrawer.tsx` (C-9: `AdminDrawer`, `DrawerSection`, `DrawerFields`, `DrawerField`); `OpenRowButton.tsx` (C-9) |
| Shared, extended | `StatusChip.tsx` (`info` tone, first consumer: severity Info); `AdminStates.tsx` (`AdminNotice`, first consumer: the search caveat); `useAdminFilters.ts` (E-1 fix) |
| Pilot | `app/admin/audit-trail/page.tsx`: cards → table; inline expand → drawer; severity → chip; caveat → notice; count line and pager restyled |
| Guard | `layoutFolder.guard.test.ts`: expected files, registry label (§4) |
| Tests | New: `adminTable.test.ts`, `AdminDrawer.render.test.tsx`, `OpenRowButton.render.test.tsx`, `auditTrail.table.render.test.tsx`. Extended: `StatusChip.render`, `AdminStates.render`, `useAdminFilters.render`. Edited deliberately: §5.2 |
| Docs | Requirement §1 (status; the L-1e row; deferrals); §12.2 picker criterion moved to L-1e |

### 2.2 The picker moves to L-1e (pre-authorised, L-1c SA review Q-1)

**Decision: split.** Measured against the code:

| Part | Days |
|---|---|
| Table constants, `info` tone, `AdminNotice` + tests | 0.5 |
| `AdminDrawer` family + `OpenRowButton` + tests (focus trap, Escape, return focus, F-65/F-66) | 1 |
| Page: table, drawer body moved out of the cards, count line, pager | 1 |
| Test edits (5 files) + new pilot table test | 0.75 |
| E-1 fix + tests | 0.25 |
| Guard, mutation checks, type check, docs | 0.5 |
| **L-1d total** | **about 4 days** |
| Picker generalisation (342 lines: `useId`, `label` / `id` / `placeholder` / `hint`, purple ring, `readJsonBody`, `clientLogger`), its own render test, the chip and F-31, RC-6, RC-7 contract rewrite, the page swap, and edits in 5 test files | about 1.5 |

Together that is about 5.5 days, past "a few days" (§3 rule 3) and past SA's 4 to 5 day estimate. The two halves are also separate review surfaces: drawer focus and a11y, against a combobox plus a contract with another surface's route. **L-1e** runs straight after L-1d, on the same page and before L-2a (§12 outlines it). Until then the interim from L-1c stays for one more slice (SA N-3): the original picker in bar slot 3, labelled "Account", and the chip "Account {label}" with X "Show every account". F-56 for the picker, F-31, RC-6, RC-7 and §7.3's picker test edits all move with it.

### 2.3 Deferred exports (recorded in §1, SA-R-3)

| Export | Why not here | First consumer |
|---|---|---|
| `ADMIN_TH_NUM` / `ADMIN_TD_NUM` (C-13 numeric cells) | The Audit trail table has **no numeric column** (Q-2) | The first table with a number column: L-2b (Cost USD, tokens) or L-3 |
| `formatUtcDate` | The time column is date + time (`formatUtc`) | Unchanged: first page with a date-only column |
| `useDrawerResource` | The drawer renders from the loaded row (R-6) | L-8 (unchanged) |
| `AdminBusinessPicker` (C-6) | §2.2 | L-1e |

---

## 3. Implementation Approach and Component APIs

All shared files are `'use client'` where they render, import only from the S-3 allow-list, and are reached by pages through the alias `@/app/admin/components/layout/` (S-1).

### 3.1 `adminTable.ts` (C-13, pure)

Class constants from §5.7, so pages keep their own `<table>` markup (SA Q-15):

| Constant | Value |
|---|---|
| `ADMIN_TABLE_WRAP` | `overflow-x-auto rounded-xl border border-slate-700` |
| `ADMIN_TABLE` | `min-w-full text-left text-sm text-slate-300` |
| `ADMIN_THEAD` | `bg-slate-800/60` |
| `ADMIN_TH` | `px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400` (pages add `scope="col"`) |
| `ADMIN_TBODY` | `divide-y divide-slate-800` |
| `ADMIN_TD` | `px-3 py-2 align-top` |
| `ADMIN_TD_ID` | `font-mono text-[11px] text-slate-400` (pages put the full id in `title`) |
| `ADMIN_COUNT_LINE` | `text-xs text-slate-400` |
| `ADMIN_BUTTON` | The Health "style A" button already used by Refresh and "Try again": `rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed` + the A-1 focus ring. First consumer: the pager (§7.4 "restyled with the shared button style"). `AdminStates` and `AdminFilterBar` are **not** refactored to use it (no churn in two pinned files) |

Plus `formatShortId(id: string | null): string`, which gives the first 8 characters + "…", or an em dash for null or empty. It joins `adminTable.ts` rather than `adminFormat.ts` because it is a table-cell rule (§5.7 Ids). No numeric constants (§2.3).

### 3.2 `StatusChip` `info` tone

`info: { classes: 'border-sky-500/40 bg-sky-500/15 text-sky-300', icon: Info }` (§5.9), and `StatusTone` gains `'info'`. The green constant stays the only one (S-7). `neutral` stays deferred.

### 3.3 `AdminNotice` (C-3)

```ts
export interface AdminNoticeProps {
  /** What is missing or partial, in one or two sentences (§5.10 Partial). */
  children: ReactNode;
  testId?: string;
}
```

A `<div>` with `rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200` and an `AlertTriangle` icon (`aria-hidden`), with the testid on the text element (the RC-3 pattern). **No role:** the notice is static, not a status change, so it is neither `alert` nor `status` (the pilot pins exactly one `role="status"` while loading). It is not a landmark (A-9).

### 3.4 `AdminDrawer` family (C-9) — `AdminDrawer.tsx`

```ts
export interface AdminDrawerProps {
  open: boolean;
  /** Escape, overlay click and X all call this (D-6). */
  onClose: () => void;
  /** Called once the drawer has closed. The opener is not a Radix trigger, so focus goes back by hand (D-6). */
  onReturnFocus: () => void;
  title: string;
  /** Optional `font-mono text-sm text-slate-400` suffix (D-5). */
  titleSuffix?: string;
  testId?: string;
  children: ReactNode;
}
export function AdminDrawer(props: AdminDrawerProps): JSX.Element;
export function DrawerSection(props: { title: string; testId?: string; children: ReactNode }): JSX.Element;
export function DrawerFields(props: { children: ReactNode }): JSX.Element; // the dl grid
export function DrawerField(props: { label: string; testId?: string; children: ReactNode }): JSX.Element;
```

| Rule | How |
|---|---|
| D-4 shell | `<Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>` + `<SheetContent side="right" aria-describedby={undefined}>` with class `w-full overflow-y-auto border-slate-700 bg-slate-900 p-6 text-slate-200 sm:max-w-3xl [color-scheme:dark] [&>button]:text-slate-300 [&>button]:opacity-100 [&>button]:focus:ring-purple-500 [&>button]:focus:ring-offset-slate-900` and inline `style={{ backgroundColor: 'rgb(15 23 42)' }}` (the Activity mechanism: the inline value beats the sheet's `--v2-bg` class whatever the CSS order) |
| F-66 | The `[&>button]:focus:…` child selectors give the sheet's X a purple ring with a dark offset, not the colourless `ring-ring` and a white offset. The X stays a **direct child** of the dialog content (the sheet renders it there; nothing wraps `children` around it), so `[&>button]` reaches it and L-8's `activityDrillDown.render :464-474` still holds |
| F-65 | `SheetTitle` gets `className="mb-4 text-lg font-semibold"` and inline `style={{ color: 'rgb(241 245 249)' }}` (slate-100). An inline colour beats any class, so the `--v2-text-primary` token cannot win in the light scheme |
| D-5 | `DrawerSection` is `<div role="group" aria-labelledby={useId()}>` + `<h3 className="text-sm font-semibold text-slate-100">`. It is a `div`, not `section`: S-8 forbids `<section` in the shared folder, and a named group is not a landmark (A-9). `DrawerFields` is `<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">`. `DrawerField` is the Activity `Field` (`<div className="contents">` + `dt` `text-slate-400` + `dd` `text-slate-200 break-words`) |
| D-6 | Focus trap, Escape and overlay come from Radix. `onCloseAutoFocus={(e) => { e.preventDefault(); onReturnFocus(); }}` |
| D-7 | Not used: no loading, error or 404 states, because nothing is fetched (R-6). They arrive with `useDrawerResource` in L-8 |
| Logging | None (no failure path inside the shell) |

### 3.5 `OpenRowButton` (C-9) — `OpenRowButton.tsx`

```ts
export interface OpenRowButtonProps {
  /** Full accessible name, starting with the visible word: "Open details for …" (D-2, WCAG 2.5.3). */
  label: string;
  /** Receives the button, so the page can return focus to it (D-6). */
  onOpen: (opener: HTMLButtonElement) => void;
  testId?: string;
}
```

The button shows "Open" + `PanelRightOpen h-3 w-3` (`aria-hidden`), with `type="button"`, the Activity classes, and the A-1 `focus-visible` purple ring in place of Activity's `focus:`. It does not check that the label starts with "Open"; the pilot passes `Open details for {event} at {time}`.

### 3.6 E-1 fix in `useAdminFilters` (QA E-1)

Add `const [rereads, setRereads] = useState(0)`. The re-read effect (`:147-152`) also calls `setRereads((n) => n + 1)` after it sets `lastKnown`. The write effect's deps become `[filters, spec, hasRouter, rereads]`. Effect:

| Case | Result |
|---|---|
| Outside change that alters the state | Same as today: `filters` and `rereads` change in one batch, so the write effect runs **once**, with the new filters |
| Outside change that parses to the current state (junk, or `user_id=X` while `account=X` is applied) | `filters` keeps its identity (no fetch, the F-28 pin holds), and `rereads` alone re-runs the write effect. It projects the state and writes only if the URL differs. **This cleans the address bar** |
| Next's echo of our own write | Skipped before any `setRereads` (`incoming === lastKnown`), so nothing changes |
| Mount | The re-read effect returns early (`incoming === lastKnown`), so the first render and requests are unchanged |

SF-1's JSDoc line ("`spec` must be a module-level constant") is already at `:132-135`; nothing else changes in the hook.

### 3.7 Audit trail pilot: `page.tsx`

**Imports added:** `ADMIN_*` + `formatShortId` from `adminTable`, `AdminDrawer`, `DrawerSection`, `DrawerFields`, `DrawerField`, `OpenRowButton`, `StatusChip` + `type StatusTone`, `AdminNotice`, `formatUtc` (all through the alias). **Dropped:** `ChevronDown`, `ChevronUp` (orphaned). `getSeverityIcon` is **removed** (the chip carries the icon), along with the icons only it used (`AlertCircle`, `CheckCircle`, `Info`, `AlertTriangle`), once each is confirmed unused elsewhere in the file. F-29's existing unused code (`useAuth` user, `Calendar`, `User`, `getSeverityColor`) is **left** (still open, not this slice).

**State:** `expandedLog` → `openId: string | null` + `const opener = useRef<HTMLButtonElement | null>(null)`. `selected = openId === null ? null : logs.find((l) => l.id === openId) ?? null`. While the drawer is open it is modal, so the filters, Refresh and the pager cannot be used and `logs` cannot change under it. On close: `setOpenId(null)`. **The two `[filters]` effects and `fetchLogs` are not touched** (F-28).

**Severity:** `SEVERITY_TONE: Record<string, StatusTone> = { critical: 'danger', warning: 'warn', info: 'info' }`. Any other stored value shows as `unknown`, with the raw word. Words: "Critical", "Warning", "Info", or the raw value.

**Content render order** (inside the existing `<div aria-busy>`; loading branch unchanged):

1. **Count line + pager row** (`flex flex-wrap items-center justify-between gap-3`), with no card shell. The left side is `ADMIN_COUNT_LINE` with **today's words**: "Showing {showing} of {total} audit logs" + "(Page n of m)", or under a search "Showing {showing} matches on this page" + "(Page n)". `total` and `showing` go through `formatCount` (§5.11, Q-5). The right side is the pager: First, Previous, the label, Next and Last as `ADMIN_BUTTON`, the label a `<span>` sibling of the buttons in the same container (the `searchTotals` locator). The enable and disable logic is unchanged. **The row renders unless there is an error with no rows** (fixes SA N-2: no zero-count card under a failed first read; the pager stays reachable under a search with no matches on this page).
2. **`AdminNotice`** (`testId="audit-search-caveat"`), shown when `isSearchActive`, with the words unchanged: "Search scans only the current page of results. Use the Action, Entity Type, Severity and date filters for complete results."
3. **Empty:** `AdminEmpty`, unchanged (when `logs.length === 0 && !error`).
4. **Table** (when `logs.length > 0`): `ADMIN_TABLE_WRAP` > `<table className={ADMIN_TABLE} aria-label="Audit events" data-testid="audit-table">`. One `<tr data-testid="audit-row">` per row. Columns:

| # | Header (`scope="col"`, unique) | Cell |
|---|---|---|
| 1 | Details | `OpenRowButton` with `testId="audit-open-details"` and label `Open details for {getActionLabel(action)} at {formatUtc(created_at)}` |
| 2 | Time (UTC) | `formatUtc(created_at)`, `whitespace-nowrap` |
| 3 | Event | `getActionIcon` + `getActionLabel` (`text-slate-200`); `compliance_flags`, when any, on a second line `text-[11px] text-sky-300` (kept visible on the row, as on the card) |
| 4 | Severity | `StatusChip` (`testId="audit-severity"`) |
| 5 | Entity | `entity_type` |
| 6 | Resource | `resource_name`; **when there is none**, "Entity id " + `formatShortId(entity_id)` in `ADMIN_TD_ID` with `title` = the full id. The id is labelled as an id and is never shown as a name; no "missing" word and no em dash (the resource decision kept, `testId="audit-cell-resource"`) |
| 7 | Business | `business.company_name`, or an em dash `text-slate-500` (§5.7 "never blank", Q-4; `testId="audit-cell-business"`) |
| 8 | User | `auditUserLabel(log)` when `user_id` is set; when the label is the bare id, `formatShortId` + `title` in `ADMIN_TD_ID`. A system row shows an em dash (`testId="audit-cell-user"`) |

5. **The drawer**, outside the table and rendered once: `<AdminDrawer open={selected !== null} onClose={() => setOpenId(null)} onReturnFocus={() => opener.current?.focus()} title={selected ? getActionLabel(selected.action) : ''} titleSuffix={selected ? formatUtc(selected.created_at) : undefined} testId="audit-drawer">{selected && <AuditEventBody log={selected} />}</AdminDrawer>`.

**`AuditEventBody({ log })`** is a function **in `page.tsx`**. It holds the same content as the expand, in the same order. Its parameter stays `log`, so the `filterOptions.guard` lines `:905` / `:1125` keep their exact text and the guard needs no edit (Q-9):

| Block | Becomes |
|---|---|
| Metadata tiles `:851-898` | `DrawerSection "Event"` > `DrawerFields`: Event ID (full, `font-mono text-xs break-all`), Time (UTC) (`formatUtc`), Recorded (the raw `created_at`, mono, for full precision: the table drops seconds), Severity (`StatusChip`), Entity type, Entity ID (full, mono), Resource (only when named), User (only when `user_id`; `auditUserLabel`), Business (only when named), Compliance (only when any) |
| `AiActionDetails` `:233-263` | `DrawerSection "AI action details"` > `DrawerFields`, one `DrawerField` per allow-listed field, omitted when undefined (the `AiDetailValue` rule). `AiActionDetailsView`, `asText`, `asCount`, `asList`, `asUsd` are unchanged (FR-A5) |
| AIS blocks `:910-1120` (score changes, score calculated, normalization started / completed / ranges, execution details) | Moved **verbatim** under `DrawerSection` titles "Score change", "Score", "Normalization", "Execution". These are legacy AgentsPilot events; their markup and colours are not restyled (out of scope; they never appear for Business OS rows) |
| Generic details `:1125-1139`, changes `:1142-1164` | `DrawerSection "Event details"` and `"Changes made"`, with the same key / value and `JSON.stringify` rendering. The guard line at `:1125` keeps its exact condition text |

**Removed:** the cards, `expandedLog`, the chevrons, the hand-built severity badge (`:769-777`), `getSeverityIcon`, `formatDate` (local time; §5.11 UTC replaces it in table and drawer), the "Results Count & Pagination" card shell.

**Not changed:** requests (no fetch on open), `fetchLogs`, both `[filters]` effects, `exportLogs` (F-4), pagination behaviour, the bar, the old picker and the account chip (L-1e), `accountFilterLabel` (F-31 is L-1e), `auditUserLabel`, `getActionIcon`, `getActionLabel`, the route.

### 3.8 Visible changes on `/admin/audit-trail` (all forced by the standard; named in the PR)

1. Cards → a table with one density; each row opens in a right-side drawer through its "Open" button (D-1, D-2). Clicking row text no longer opens anything.
2. Times are UTC "YYYY-MM-DD HH:mm UTC" (they were local time with seconds). The drawer keeps the exact stored timestamp ("Recorded").
3. Severity is a chip with text + icon; Info moves from blue to sky (§5.9).
4. A row with no business, or a system row with no user, shows an em dash in that cell (§5.7). Before, the line was omitted.
5. Long ids in the table are shortened (full id on hover and in the drawer).
6. The search caveat is an amber notice above the table.
7. Counts have thousands separators ("14,332").
8. On a failed first read, the zero-count line no longer shows under the red box (SA N-2).
9. The address bar is cleaned after an outside change that resolves to the current filters (QA E-1).

---

## 4. The C-14 guard changes

`layoutFolder.guard.test.ts`:

| Change | Why |
|---|---|
| `EXPECTED_SOURCES` += `AdminDrawer.tsx`, `OpenRowButton.tsx`, `adminTable.ts` | G-1: the scan cannot be empty |
| Registry entry label `'/admin/audit-trail (Audit trail, part 1)'` → `'/admin/audit-trail (Audit trail)'`; files unchanged (`page.tsx`, `auditTrailFilters.ts`); the G-6 comment updated (the original picker still sits on the page until L-1e) | The page is registered; only the label is stale |
| The header comment gains one L-1d paragraph | Audit trail of guard changes |

No rule changes. The new files must already pass S-2 (names), S-3 (`@/components/ui/sheet` and `lucide-react` are allowed), S-5, S-6 (no `.json(`), S-7 (no green; sky and amber only) and S-8 (`role="group"`, no `<section`).

---

## 5. Tests

Every new `.render.test.tsx` carries the `@jest-environment jsdom` docblock. Assertions use `toBeTruthy()` / `toBe()`, as the Audit trail suites do.

### 5.1 New

| File | Happy path | Failure path(s) |
|---|---|---|
| `layout/__tests__/adminTable.test.ts` | §5.7 classes are present in each constant (wrap, table, th, td, tbody, count line, button with its focus ring); `formatShortId` → 8 chars + "…" | `formatShortId(null)` and `''` → em dash; no constant contains `font-mono` except `ADMIN_TD_ID`; no `py-4` / `px-6` |
| `layout/__tests__/AdminDrawer.render.test.tsx` (harness: an opener button + `AdminDrawer`) | Closed → no dialog. Open → `role="dialog"` named by the title, with the suffix shown. The content class has `[color-scheme:dark]`, `[&>button]:text-slate-300` and `[&>button]:focus:ring-purple-500`, and the inline background. The title's inline colour is `rgb(241, 245, 249)` (F-65). The X (`name: 'Close'`) is a **direct child** of the dialog. `DrawerSection` is `role="group"` named by its h3, with no `<section>` and no region. `DrawerField` renders `dt`/`dd` inside the `dl` | Escape → `onClose` once; with `open` then false, `onReturnFocus` is called and **the opener has focus** (mutation V-3 a). The X click → `onClose`. Tab from the last focusable stays inside the dialog (trap) |
| `layout/__tests__/OpenRowButton.render.test.tsx` | Visible text "Open", accessible name = `label`, the icon is `aria-hidden`; click → `onOpen` receives the button element | `type="button"` (no form submit); the focus ring is `focus-visible` purple, not `ring-ring` |
| `app/admin/audit-trail/__tests__/auditTrail.table.render.test.tsx` (pilot; a new file, so the L-1c pins stay exact; RC-1 mocks) | One `table` named "Audit events"; the 8 headers in order, all unique; one row per log; Time cell `2026-10-10 09:00 UTC`; severity chips "Critical" / "Warning" / "Info" with `data-tone` danger / warn / info; an unknown severity → unknown tone with its word; the Open button is in the first cell with name `Open details for User Login at 2026-10-10 09:00 UTC`; clicking it opens the drawer titled "User Login", with Event ID and Recorded (exact ISO); an AI row shows the "AI action details" section and **no** "Event details" section; a non-AI row with details shows "Event details"; Escape closes and **focus returns to that row's Open button**; opening and closing the drawer adds **no request** (fetch call count unchanged; mutation V-3 d); the search caveat is an `AdminNotice` only while searching; the count line is "Showing 2 of 2 audit logs"; "Previous" carries the shared button class | A failed **first** read shows the red box and no count line (N-2); a failed Refresh keeps the table rows; a row with no business and a system row show an em dash in Business / User; a 20-row page and its pager still page by the unfiltered total |
| Extended: `StatusChip.render` | `info` → sky classes, the `Info` icon `aria-hidden`, textContent exactly the words | The S-7 green constant is still the only green (existing case unchanged) |
| Extended: `AdminStates.render` | `AdminNotice`: amber classes, the testid on the text, the icon `aria-hidden` | No `role` attribute at all (not alert, not status), no region |
| Extended: `useAdminFilters.render` (E-1) | An outside change to `severity=catastrophic&user_id=nope` from the defaults → `filters` is the same object, `effectRuns` stays 1, and `window.location.search` becomes `''` by `replaceState(null, …)`. An outside change to `user_id=X` while `account=X` is applied → same object, address bar `?account=X` | Next's echo of our own write still causes **no** extra `replaceState` (spy count unchanged; mutation V-3 b) |

### 5.2 Edited deliberately

| File | Edit | Why |
|---|---|---|
| `resourceAndBusiness.render.test.tsx` | `cardFor` → `rowFor` (`closest('tr')`). The inline-label queries become cell testids: named → the `audit-cell-resource` text is the name and does not contain the entity id; nameless → the resource cell reads "Entity id " + the short id, its `title` is the full id, and it never shows the id as a name. "Does not dress the missing name as an error" is **scoped to the resource cell** (the em dash is now the §5.7 rule for Business / User, Q-4). "Renders nothing at all when no business profile" → the Business cell is an em dash and carries no name. Same for an unnamed business. Mixed page by rows | Cards → table (§7.4) |
| `userEmailFallback.render.test.tsx` | `cardContaining` → `rowContaining` (`tr`). `getByText(/^User:/)` → the `audit-cell-user` text (E-1, E-2 exact; E-3 short id + full `title`; E-4 system row = em dash). `userTileAfterExpanding` → click the row's Open button, then `findByText('User', { selector: 'dt' })`; the tile is its `parentElement` (the `contents` div holds the `dd`) | Same |
| `userNameAndPlaceholder.render.test.tsx` | `userLineContaining` → the row's user cell; R-1 opens through the Open button and reads the `dt` / `dd`; R-2 / R-3 assert the short id + `title` (the bare id is now shortened, §5.7) | Same |
| `aiCostPrecision.render.test.tsx` | `renderedCost`: click `getByRole('button', { name: /^Open details for/ })` instead of the row text. `findByText('Estimated Cost')` + `parentElement` still work (`dt` inside `div.contents` with its `dd`). The 8 value assertions are unchanged | Same |
| `auditTrail.layout.render.test.tsx` `:469-485` | `findByRole('heading', { level: 3, name: 'User Login' })` (2×) → `findByRole('cell', { name: /User Login/ })`; the test name "keeps the cards on screen" → "keeps the rows on screen" | The card `h3` is gone |
| `searchTotals.render.test.tsx` | Positive assertions `of 14332 audit logs` (`:133`, `:177`) → `of 14,332 audit logs`. The negative check at `:160` also asserts the formatted form is absent, so it stays non-vacuous. The pager locator is unchanged | §5.11 `formatCount` (Q-5) |
| `layoutFolder.guard.test.ts` | §4 | C-14 |

### 5.3 Must stay green with no edit

`filterOptions.guard` (the AI allow-list and the two detection lines stay in `page.tsx`, with the same text); `businessPicker.render` (whole file, including the mount pin `:429-437` and the hint); `businessPicker.contract`; `accountChipLabel.render`; `presetAndDeepLink.render`; `filterDensity.render` ("Account" stays until L-1e); `auditTrailFilters.test`; the rest of `auditTrail.layout.render`; every shared test not listed in §5.1; `health.*`, `jobsQueues.*` (they use `StatusChip`'s other tones and the bar's L-1a branch); `app/admin/finance/**` (it mocks the original picker, which is unchanged); `app/admin/business-os-llm/__tests__/*` (`ActivityDrillDown` untouched); `app/api/admin/audit-trail/__tests__/*`; `lib/audit/__tests__/*`; `admin-authz-surface.guard`; `tailwind-css-escape.guard`.

---

## 6. Verification

| # | Step | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ --ci` | all green |
| V-2 | `npx jest app/admin/finance app/admin/business-os-llm app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | all green, no edit |
| V-3 | Mutation checks, each restored afterwards: (a) remove `onReturnFocus()` from `onCloseAutoFocus` → the `AdminDrawer` focus case and the pilot focus case fail; (b) remove `rereads` from the write effect's deps → the E-1 hook cases fail; (c) remove the inline title colour → the F-65 case fails; (d) add a `fetch('/api/admin/audit-trail?…')` in the Open handler → the pilot "no request on open" case fails; (e) drop `[&>button]:focus:ring-purple-500` from the content class → the F-66 class case fails; (f) render the severity chip with no text → the StatusChip words case fails | each red, then green |
| V-4 | `npm run test:bos-entitlements` | green (nothing imports `lib/business-os/entitlements`; S-4) |
| V-5 | Scoped type check: a scratch tsconfig in the session scratchpad (never committed) that `extends` the worktree `tsconfig.json`, with `incremental: false` and an absolute `include` of `next-env.d.ts`, every shared source and test, `adminWindowPresets.ts`, `components/ui/sheet.tsx`, the Audit trail page, `auditTrailFilters.ts`, the old picker and the 14 Audit trail tests, plus `HealthGrid.tsx` and `JobsQueuesView.tsx`. **Run 1:** canary `const canary: number = 'x';` in `AdminDrawer.tsx` → exactly that TS2322. **Run 2:** canary removed → zero errors. Never a whole-repo `tsc` | both runs recorded |
| V-6 | `npx eslint <touched files> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0`, then `npx eslint <touched files>` | no hook violation (`DrawerSection` calls `useId` in a component; the page's new `useRef` is at top level); no new findings |
| V-7 | `git diff --stat` against `feature/admin-layout-l1c` **before reading the diff** | insertions where expected, no blanked file. Absent: `components/ui/*`, `lib/**`, `app/api/**`, `app/admin/finance/**`, `app/admin/business-os-llm/**`, `app/admin/audit-trail/BusinessAccountPicker.tsx`, `businessPicker.*`, `accountChipLabel`, `presetAndDeepLink`, `filterDensity`, `filterOptions.guard`, `AdminSidebar.tsx`, `app/admin/layout.tsx`, Health and Jobs sources |
| V-8 (QA / TL, browser) | Signed in as an admin, DevTools Network open, with light **and** dark colour-scheme emulation (SA Q-8). §6.1 | one line or screenshot per item in the QA report |

The worktree's `node_modules` is a junction to the main checkout: never remove or replace it. No `git stash`, no `git worktree remove`, no commit by Dev.

### 6.1 Browser checks (V-8)

| # | Do | Expect |
|---|---|---|
| D-B1 | Open `/admin/audit-trail` (both schemes) | One table, compact density (`py-2`), headers small caps and unique, Time in UTC, severity chips with text + icon, short mono ids with the full id on hover, no sideways page scroll on a narrow window (the table scrolls inside its frame) |
| D-B2 | Tab to the first row's "Open", press Enter | The drawer slides in from the right. **Title readable in the light scheme** (near-white on dark), X visible (slate-300). **SA M-2, record computed values in the light AND the dark scheme** (DevTools, Elements, Computed): the dialog's `h2` `color` is `rgb(241, 245, 249)`; the X button's `color` is slate-300 (`rgb(203, 213, 225)` or its oklch equivalent) and its `opacity` is `1`; the dialog's `background-color` is `rgb(15, 23, 42)` |
| D-B3 | Tab inside the drawer | Focus stays inside; the X shows a **purple** ring with a dark offset (F-66), not white. **SA M-2:** with the X focused by Tab, record its computed `box-shadow`: it carries the purple-500 ring colour and a dark (slate-900) offset, not white. One line per scheme |
| D-B4 | Press Escape | The drawer closes and focus is back on that row's "Open" button (visible ring) |
| D-B5 | Reopen; click the overlay; reopen; click X | Each closes it; focus returns each time |
| D-B6 | Open a Business OS AI row (`entity_type=ai_action`) | The "AI action details" section with the allow-listed fields only (cost at its stored precision), and no "Event details" dump |
| D-B7 | Network panel while opening and closing several rows | **No request** |
| D-B8 | Type a search | The amber notice with the caveat appears above the table; the count line says "matches on this page" |
| D-B9 | Page with Next / Last | Same rows and requests as `main`; the buttons use the shared style and are disabled at the ends |
| D-B10 | E-1 (SA S-3 recipe; typing in the address bar reloads the page and only tests the mount rewrite). On `/admin/audit-trail` at the defaults, run `history.pushState(null, '', '?severity=catastrophic')` in the DevTools console (Next 14.2 syncs it to `useSearchParams`, an outside change). Then pick an account, and run `history.pushState(null, '', '?user_id=<that id>')` | Each time: the view is unchanged, there is no new request in Network, and the address bar goes back to `/admin/audit-trail` (first case) or `?account=<that id>` (second case) |
| D-B11 | Export CSV | Same file as `main` |
| D-B12 | L-1c's B-1 to B-14 | Still owed from PR #291; re-run on this branch if TL has not run them on L-1c |

---

## 7. Task List

- [x] ✅ T-1 `adminTable.ts` + `adminTable.test.ts`
- [x] ✅ T-2 `StatusChip` `info` tone; `AdminNotice`; test additions
- [x] ✅ T-3 `AdminDrawer.tsx` (`AdminDrawer`, `DrawerSection`, `DrawerFields`, `DrawerField`) + `AdminDrawer.render.test.tsx`
- [x] ✅ T-4 `OpenRowButton.tsx` + `OpenRowButton.render.test.tsx`
- [x] ✅ T-5 E-1 in `useAdminFilters.ts` + hook test additions; Audit trail suites green before any page edit (13 suites, 198 tests)
- [x] ✅ T-6 `layoutFolder.guard.test.ts` (§4)
- [x] ✅ T-7 `page.tsx`: the table, `AuditEventBody`, the drawer, the count line + pager, the notice (§3.7)
- [x] ✅ T-8 Test edits (§5.2) + the new `auditTrail.table.render.test.tsx`
- [x] ✅ T-9 Verification V-1 to V-7; results recorded under Implementation Notes
- [x] ✅ T-10 Requirement doc sweep (SA M-1): §1 row 4 notes, §6.2 C-6, §7.3, §7.4, §9 F-31 / F-56 / F-70, §12.2 (heading, pilot list, L-1d line, new L-1e line), Change History. SA had already added row 4a
- [x] ✅ T-11 Hand over to TL for SA code review (uncommitted)

---

## 8. Sizing

About **4 days** (§2.2 table), within "a few days". L-1e (the picker) is about 1.5 days on its own.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| The drawer title or X loses to a `--v2-` class in the light scheme (F-65, F-66) | Inline colour for the title; child selectors for the X; render-test assertions; browser D-B2 / D-B3 |
| Focus does not return (the opener is not a Radix trigger) | `onCloseAutoFocus` + `preventDefault` + the opener ref (the Activity mechanism, already proven); shared and pilot tests; mutation V-3 (a) |
| Moving the expand body breaks the FR-A5 allow-list guard | The body stays in `page.tsx` with its `log` parameter and the exact guard lines; `filterOptions.guard` runs unedited in V-1 |
| The table adds a request, or changes sequencing (F-28) | No fetch in any new part; the pilot "no request on open" case; `businessPicker.render`'s mount pin runs unedited |
| E-1 fix causes a write loop or an extra request | The echo is skipped before the counter; `filters` identity is unchanged; the hook test asserts the spy count, the effect counter and no extra fetch |
| The `searchTotals` negative check goes vacuous after `formatCount` | It asserts both the raw and the formatted totals are absent |
| A Radix portal leaves `aria-hidden` / `pointer-events` on the body between tests | Each test closes the drawer or unmounts; the Activity suite is the precedent |

---

## 10. Out of scope

The business picker swap, its chip and F-31 (L-1e); the numeric cell constants (§2.3); F-4 (CSV escaping); F-29 (unused code); F-28 / F-98 (search sequencing and debounce); restyling the legacy AIS blocks; row click to open (D-2 "may"; the button is the path, Q-10); the drawer's open row in the URL (U-10); the Activity drawer (L-8); `components/ui/sheet.tsx`.

---

## 11. Questions for SA

| # | Question | Dev lean |
|---|---|---|
| Q-1 | **L-1e split** (§2.2): the picker swap, chip, F-31, RC-6, RC-7 and the picker test edits move to L-1e, run straight after L-1d; the L-1c interim stays one more slice | Split (pre-authorised; about 4 + 1.5 days instead of 5.5) |
| Q-2 | `ADMIN_TH_NUM` / `ADMIN_TD_NUM` are not built: Audit trail has no numeric column (SA-R-3) | Defer to the first numeric table (L-2b) |
| Q-3 | A **Resource** column is added to §7.4's seven, so the resource-name decision (name vs labelled id) stays visible on the row | Add it (8 columns; it was on the card) |
| Q-4 | §5.7 "never blank" puts an em dash in Business / User where the card omitted the line ("blank is honest"). The resource cell keeps its own rule: no em dash, the id labelled as an id | Em dash in Business / User; the resource test's no-em-dash check is scoped to the resource cell |
| Q-5 | The count line keeps today's words ("Showing X of Y audit logs" / "Showing N matches on this page"), not §7.4's "N matching events", because the search-honesty wording (FR-A4b) is pinned and more precise. The numbers get `formatCount` | Keep the words, add separators |
| Q-6 | Drawer title = the event label; suffix = `formatUtc(created_at)`; the "Recorded" field keeps the exact ISO, because the table drops seconds | As stated |
| Q-7 | `ADMIN_BUTTON` is a new C-13 constant (first consumer: the pager). `AdminStates` and `AdminFilterBar` keep their identical inline classes for now | Add; converge them when either file is next touched |
| Q-8 | E-1 mechanism: a re-read counter in the write effect's deps (§3.6), not a direct write inside the re-read effect | Counter: one write path stays the only place that writes |
| Q-9 | `AuditEventBody` stays in `page.tsx` (no guard edit; the page stays about 1,150 lines) rather than moving to a new file and re-pointing `filterOptions.guard` | Stay in `page.tsx` |
| Q-10 | Rows open only through the Open button (D-2 allows a row click too) | Button only: no nested-interactive row, and the tests pin one path |

---

## 12. Appendix: L-1e outline (its own workplan follows L-1d)

| Part | Content |
|---|---|
| Shared | `AdminBusinessPicker.tsx` generalised from the original: `label` (default "Business"), `id?`, `placeholder?`, `hint?`, `useId` for the input and listbox (two on one page do not collide), filter-bar size + purple ring, `readJsonBody` (S-6), `clientLogger.child` (F-56), its own `BUSINESS_SEARCH_PATH`, `onSelect(accountId, name | null)`, **no fetch on mount** (RC-6), plus `businessFilterChip({ accountId, name, onRemove })` → `AdminActiveChip` "Business: {name}" or the short id, X "Remove business", testid `business-filter-chip`. The original file is not edited (Activity and Finance still import it; deleted in L-8) |
| Page | Swap in bar slot 3; the chip's name comes from the picked option, then the loaded rows (`accountFilterLabel` reordered per F-31: company name → full name → `user_email` → `users.email`), then the short id |
| Tests | New `AdminBusinessPicker.render`; RC-7 contract rewrite (both pickers, shared file on the surface); edits: `filterDensity` "Account" → "Business"; `businessPicker.render` import, chip testid, X label, log message; `accountChipLabel` testid + F-31 cases; `presetAndDeepLink` testid + X label |

---

## Implementation Notes

**Dev, 2026-10-11.** All of T-1 to T-10 done on `feature/admin-layout-l1d` (tip `4530dfb4` = `origin/main` after L-1c merged as #291), **uncommitted**. SA M-1 to M-4 and S-1 to S-5 are all implemented; nothing was declined.

### Files

| File | Action |
|---|---|
| `app/admin/components/layout/adminTable.ts` | new: C-13 constants, `ADMIN_BUTTON`, `formatShortId` |
| `app/admin/components/layout/AdminDrawer.tsx` | new: `AdminDrawer`, `DrawerSection`, `DrawerFields`, `DrawerField` |
| `app/admin/components/layout/OpenRowButton.tsx` | new |
| `app/admin/components/layout/StatusChip.tsx` | `info` tone (sky, `Info` icon) |
| `app/admin/components/layout/AdminStates.tsx` | `AdminNotice` |
| `app/admin/components/layout/useAdminFilters.ts` | E-1: `rereads` counter, with the M-3 (a) comment at the write effect's deps |
| `app/admin/audit-trail/page.tsx` | table, `AuditEventBody`, one drawer, count line and pager, notice (§3.7) |
| `app/admin/components/layout/__tests__/adminTable.test.ts`, `AdminDrawer.render.test.tsx`, `OpenRowButton.render.test.tsx` | new |
| `app/admin/audit-trail/__tests__/auditTrail.table.render.test.tsx` | new (17 cases) |
| `StatusChip.render`, `AdminStates.render`, `useAdminFilters.render` | extended (cases added, none edited) |
| `layoutFolder.guard.test.ts` + six Audit trail render tests | edited deliberately (table below) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | T-10 doc sweep (M-1) |

Untouched, as required: `app/admin/finance/**`, `lib/**`, `app/api/**`, `components/ui/*`, `app/admin/audit-trail/BusinessAccountPicker.tsx`, `businessPicker.render` / `.contract`, `accountChipLabel`, `presetAndDeepLink`, `filterDensity`, `filterOptions.guard`, the sidebar, `app/admin/layout.tsx`, the Activity drawer, Health and Jobs sources.

### How each SA condition was met

| # | Done as |
|---|---|
| M-1 | Requirement: §1 row 4 notes (built exports; deferrals Q-2, Q-5, Q-7, `formatUtcDate`, `useDrawerResource`; the full definition of done moves to the end of L-1e), §6.2 C-6 slice → L-1e, §7.3 outcome sentence, §7.4 (Resource column, count-line words, definition of done at L-1e), §9 F-31, F-56 (picker), F-70 → L-1e, §12.2 heading, pilot list and a new L-1e line, Change History row. Targeted edits only |
| M-2 | §6.1 D-B2 and D-B3 now ask for the computed values in both schemes (title `color`, X `color` and `opacity`, dialog background, X `box-shadow` when focused) |
| M-3 | (a) comment at the write effect's deps. (b) hook cases: an outside change that alters state writes exactly once; mount with a clean URL writes nothing and runs the `[filters]` effect once, and an alias on mount is rewritten exactly once; Next's echo adds no write. (c) `businessPicker.render` mount pin unedited and green |
| M-4 | One heading per section: `AiActionDetails` is a `DrawerSection "AI action details"` with no inner h4; "Event details" and "Changes made" drop their h4s. `AiDetailValue` is now the wrapper that returns null before a `DrawerField` exists; the 13 fields stay named. The legacy AIS blocks keep their h4s verbatim. Pinned by the pilot case "each section has exactly one heading" |
| S-1 | Separate `isOpen`; close clears only `isOpen` and keeps `openId`, so the content does not blank during the slide-out |
| S-2 | `SEVERITY_TONE` / `SEVERITY_WORD` typed `Partial<Record<string, …>>`, resolved with `?? 'unknown'` / `?? severity`. Also hardened: an own-key check, so a stored value such as "constructor" cannot resolve to an `Object.prototype` member (pinned in the pilot) |
| S-3 | D-B10 rewritten with the `history.pushState` console recipe, both cases |
| S-4 | A literal space before the suffix span. Tests assert the exact dialog name **and** the title's `textContent` (see deviation 4) |
| S-5 | `width: '100%'` inline beside the background; `w-full` dropped; pinned (`style.width`, and no `w-full` class) |

### Deviations from the workplan (each small; for SA to confirm)

1. **Inline colours in comma form:** `rgb(15, 23, 42)` and `rgb(241, 245, 249)`, not `rgb(15 23 42)`. Same colour in a browser; jsdom's style parser silently drops the space-separated form, so the D-4 / F-65 tests could not pin it otherwise. (The Activity drawer's own `rgb(15 23 42)` is therefore not seen by jsdom at all; not touched, L-8.)
2. **`formatShortId` leaves an id of 8 characters or fewer whole** (no "…" when nothing was cut), e.g. a fixture entity id `e-1`. Full-length ids get the 8 characters + "…" exactly as planned.
3. **E-1 junk case uses `severity=catastrophic&range=bogus`** instead of `severity=catastrophic&user_id=nope`: `user_id=nope` is a valid account alias and changes state, so it is not "parses to the current state". The alias case (`user_id=X` while `account=X`) is its own test.
4. **S-4 needed a second assertion.** jsdom's accessible-name computation pads every element with spaces whatever its CSS, so mutation (h) at first survived the role-name assertion. The shared and pilot tests now also assert the `h2`'s `textContent` is exactly "User Login 2026-10-10 09:00 UTC", which only the literal space produces. The suffix span's margin went from `ml-2` to `ml-1` beside the space.
5. **`onReturnFocus` is asserted as called, not called exactly once:** Radix runs its unmount auto-focus more than once in jsdom. Focus landing on the opener is asserted exactly.
6. **AIS section titles:** "Score change", "Score", "Normalization" (refresh started and refresh completed, mutually exclusive actions), "Normalization ranges" (the ranges-used block, which can sit beside either), "Execution". Two groups never share a name.
7. **Small additions:** `AdminDrawer` wraps `children` in a `space-y-6` div (the X stays a direct child; pinned); pager buttons gained `type="button"`; the pager label's page count also goes through `formatCount`; testids `audit-table`, `audit-count`, `audit-recorded`, `audit-event-fields`, `audit-ai-details`, `audit-event-details`, `audit-changes`; a literal space replaces the `ml-2` margin before "(Page n of m)" in the count line, so its text reads "… audit logs (Page 1 of 3)".
8. **Mutations (b) and (g) are the same edit** (remove `rereads` from the deps); run once.

### Verification (real output)

| Step | Result |
|---|---|
| V-1 + V-2, one run: `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm app/admin/finance app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **80 suites, 1,726 tests, all passed** |
| Audit trail suites before the page edit (T-5) | 13 suites, 198 tests passed |
| V-4 `npm run test:bos-entitlements` | 233 suites, 6,382 tests passed |
| V-5 scoped tsc (scratch tsconfig, 52 files: the shared folder and its tests, the Audit trail page, filters, old picker and 14 tests, `adminWindowPresets.ts`, `components/ui/sheet.tsx`, `HealthGrid.tsx`, `JobsQueuesView.tsx`, `next-env.d.ts`) | Run 1, canary in `AdminDrawer.tsx`: exactly `AdminDrawer.tsx(134,7): error TS2322: Type 'string' is not assignable to type 'number'.`, exit 2. Canary removed (md5 back to `2002c162…`, 0 canary lines). Run 2: exit 0, no output |
| V-6 hooks config on every touched source and test | exit 0, no findings |
| V-6 default ESLint | `page.tsx`: 12 warnings, 0 errors, the **same 12** as `main`'s copy (F-29 unused code, the pre-existing `any`s, `fetchLogs` deps); every other touched file clean |
| V-7 diff | 15 tracked files modified + 7 new + this workplan; no blanked or deletion-only file; nothing out of scope |

### Mutation checks (each red, then restored; md5 before = after for every one)

| # | Mutation | Failed |
|---|---|---|
| a | drop `onReturnFocus()` from `onCloseAutoFocus` | `AdminDrawer.render` Escape and X focus cases; pilot "focus returns to that row's Open button" |
| b = g | drop `rereads` from the write effect's deps | `useAdminFilters.render` E-1 junk case and alias case |
| c | drop the title's inline colour | `AdminDrawer.render` F-65 |
| d | `fetch` in the page's open handler | pilot "opening and closing rows asks the route for nothing" |
| e | drop `[&>button]:focus:ring-purple-500` | `AdminDrawer.render` D-4 class case |
| f | chip renders no words | `StatusChip.render`: all five tone cases, `info` included |
| h | drop the literal space before the suffix | `AdminDrawer.render` exact-name case; pilot drawer-name case |
| i | drop the inline `width` | `AdminDrawer.render` D-4 case |

### The nine visible changes on `/admin/audit-trail` (for the PR)

1. Cards → one table with one density; each row opens in a right-side drawer through its "Open" button. Clicking row text no longer opens anything.
2. Times are UTC "YYYY-MM-DD HH:mm UTC" (they were local time with seconds); the drawer keeps the exact stored timestamp as "Recorded".
3. Severity is a chip with words and an icon; Info moves from blue to sky.
4. A row with no business, or a system row with no user, shows an em dash in that cell (the card omitted the line).
5. Long ids in the table are shortened (full id on hover and in the drawer).
6. The search caveat is an amber notice above the table.
7. Counts have thousands separators ("14,332").
8. On a failed first read, the zero-count line no longer shows under the red box.
9. The address bar is cleaned after an outside change that resolves to the current filters (QA E-1).

### Every edited test, with its reason (for the PR)

| Test | Edit | Reason |
|---|---|---|
| `resourceAndBusiness.render` | `cardFor` → `rowFor` (`closest('tr')`); cell testids replace the inline labels; nameless resource reads "Entity id" + short id with the full id in `title`; the no-defect-word check is scoped to the Resource cell; "renders nothing" for a missing or unnamed business → an em dash and no name | Cards → table (§7.4); §5.7 "never blank" (SA Q-4) |
| `userEmailFallback.render` | `cardContaining` → `rowContaining`; the User cell replaces "User:"; E-3 short id + `title`; E-4 em dash; the tile is opened through the Open button and read as `dt` / `dd` | Cards → table; inline expand → drawer; §5.7 Ids |
| `userNameAndPlaceholder.render` | the user line is the User cell; R-1 opens through the Open button; R-2 / R-3 assert the short id + `title` | Same |
| `aiCostPrecision.render` | opens through the Open button instead of clicking row text; the 8 value assertions unchanged | Inline expand → drawer |
| `auditTrail.layout.render` | `heading level 3 "User Login"` (2×) → `cell "User Login"`; test name "cards" → "rows" | The card h3 is gone |
| `searchTotals.render` | positive checks read "14,332"; the negative check refuses the formatted form too | §5.11 `formatCount` (SA Q-5) |
| `layoutFolder.guard` | three expected files; registry label "Audit trail"; G-6 comment (picker until L-1e); L-1d header paragraph | C-14 |

### Found, not fixed (out of scope)

- The legacy "Execution" block renders a literal `0` when `total_executions` is `0` (`{log.details.total_executions && …}`), moved verbatim; AIS rows only.
- F-29 unused code (`useAuth` user, `Calendar`, `User`, `getSeverityColor`) and the page's pre-existing `any`s remain (the 12 ESLint warnings above).
- The Activity drawer's inline `rgb(15 23 42)` is invisible to jsdom, so no Activity test can pin its background (L-8 adopts `AdminDrawer`).

### QA B-1 fix (and QA E-1, low) — Dev, 2026-10-11

Fixed by Dev, `page.tsx` only:

- **B-1 (Medium, also SA code review finding 1).** The drawer's `open` was `isOpen && selected !== null`. When the open row left `logs` (a read in flight landing after the open, a search keystroke, Back/Forward), the drawer closed but `isOpen` stayed true, because Radix does not call `onOpenChange` for a prop change. A later read that brought the row back reopened the drawer unasked, and focus fell to `<body>` because the opener had unmounted. Now:
  - a `useEffect` on `[isOpen, selected]` clears `isOpen` and `openId` when `selected` becomes null while open. S-1 still holds for every ordinary close: Escape, X and overlay clear only `isOpen`, so the content does not blank during the slide-out;
  - `onReturnFocus` focuses the opener only if it is still connected; otherwise it focuses the content area (`div aria-busy`, now with a ref, `tabIndex={-1}` and `focus:outline-none`; not in the tab order). The h1 lives in the shared `AdminPageHeader`, which this fix does not touch;
  - the state comment no longer claims that modal freezes `logs`.
- **E-1 (Low, A-7).** An empty or missing stored severity now shows the word "Unknown" with the `unknown` tone, instead of an icon with no words.

Tests, in `auditTrail.table.render.test.tsx`:
- **New regression case (QA's probe):** a Refresh is in flight, the admin opens the second row, and the read lands without that row. Checks: the drawer is closed, focus is on a connected element and not `<body>`, and a later read that brings the row back leaves the drawer closed. The fetch mock gained a `deferred` answer to hold a read open.
- **Severity case extended:** a row with severity `""` reads `Unknown` with the `unknown` tone.

Mutation checks (md5 before = after for both):
- (j) empty the effect's body: the B-1 case fails;
- (k) replace the focus fallback with `opener.current?.focus()`: the B-1 case fails.

Re-run results:
- `npx jest app/admin/audit-trail app/admin/components/layout --ci`: 29 suites, 545 tests, all passed.
- Hooks ESLint on `page.tsx` and the pilot test: exit 0.
- Default ESLint: the same 12 baseline warnings in `page.tsx`, 0 errors.
- Scoped tsc (`tsconfig.l1d.json`): exit 0, no output.

Edge E-2 (the legacy "Execution" block's bare `0`) stays out of scope, as listed above.

## SA Review Notes

The workplan review is the next section. The code review is added below it after implementation.

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11**
**Status:** ✅ APPROVED WITH CONDITIONS (M-1 to M-4 are part of the implementation; S-1 to S-5 are expected unless Dev records why not under Implementation Notes)

Checked against the code at the branch tip: `components/ui/sheet.tsx` (X at `:68`, title at `:111`), `lib/utils.ts` (`cn` is a plain join), `package.json` (`tailwindcss ^4`, `next ^14.2.33`, `@testing-library/user-event ^14.6.1`), `useAdminFilters.ts:136-180`, `StatusChip.tsx`, `adminFormat.ts` (`formatUtc` ends in " UTC", `formatCount`), `ActivityDrillDown.tsx:297-347`, `filterOptions.guard.test.ts`, `layoutFolder.guard.test.ts` (S-8 = `<section` and `role="region"` only), the page's headings (`:239`, `:765`, `:1004`, `:1078`, `:1127`, `:1144`) and the test locators in §1.3.

### Rulings on Q-1 to Q-10

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved: split. L-1e takes C-6, its chip, F-31, F-56 (picker), F-70, RC-6, RC-7 and the picker test edits.** SA added row 4a (L-1e) to requirement §1 and set the L-1d status | Exercises the L-1c Q-1 pre-authorisation: 4 + 1.5 days instead of 5.5, and the drawer (focus, a11y) and the combobox (keyboard, contract with another route) are separate review surfaces. The §2.2 sizing is credible against the 1,176-line page and five test files |
| Q-2 | **Approved: `ADMIN_TH_NUM` / `ADMIN_TD_NUM` not built.** Recorded in §1 as deferred to the first table with a number column | SA-R-3: no export without a consumer; Audit trail has no numeric column |
| Q-3 | **Approved: 8 columns, Resource added** | The name-or-labelled-id decision was visible on the card; dropping it would hide a pinned behaviour inside the drawer. §7.4's list is a minimum, not a ceiling; the wrapper scrolls |
| Q-4 | **Approved: em dash in Business / User; the resource cell keeps its own rule**, and the no-em-dash assertion is scoped to the resource cell | §5.7 "never blank" is the newer, page-wide rule; the resource rule was about not dressing a missing name as an error, which still holds in its own cell |
| Q-5 | **Approved: keep today's words, add `formatCount`.** Record the deviation from §7.4's "N matching events" in §1 | FR-A4b's wording is more precise (the total is unfiltered, search is page-only) and is pinned; §7.4's phrase would be false under a search |
| Q-6 | **Approved** (title = event label, suffix = `formatUtc`, "Recorded" = the stored value) | The stored value from PostgREST carries its offset, so it is self-describing and keeps sub-second precision the table drops. See S-4 for the title's accessible name |
| Q-7 | **Approved: `ADMIN_BUTTON` in `adminTable.ts`**, first consumer the pager. Record in §1 that `AdminStates` and `AdminFilterBar` converge on it when next touched | §5.7 Pagination names the shared button style; refactoring two pinned files now is churn |
| Q-8 | **Approved: the re-read counter**, with M-3 | One write path stays the only writer of the URL. Verified: the re-read effect returns early on mount and on our own echo, so the counter never moves there; on an outside change `setState` and `setRereads` batch in one effect, so the write effect runs once; `filters` identity is unchanged when nothing parses differently, so the page's two `[filters]` effects do not run (F-28 mount pin and request count hold); the write effect writes only when the URL differs and records `lastKnown` first, so Next's echo is skipped: no loop |
| Q-9 | **Approved: `AuditEventBody` stays in `page.tsx`**, parameter named `log` | `filterOptions.guard` reads `page.tsx` for the exact lines `log.entity_type === AI_ACTION_ENTITY_TYPE && log.details` and the single line holding both `log.details && !log.action.startsWith('AIS_')` and `log.entity_type !== AI_ACTION_ENTITY_TYPE`, and bans `Object.entries(details)`. Keep the generic dump as `Object.entries(log.details)` and keep that condition on one line |
| Q-10 | **Approved: rows open only through the Open button** | D-2 makes the row click optional; a clickable `tr` containing a button is a nested-interactive pattern and a second path to test |

### Checks

| Area | Result |
|---|---|
| Scope | ✅ No `finance/**`, `lib/**`, `app/api/**`, old picker, `components/ui/**`, sidebar, `app/admin/layout.tsx` or Activity drawer edits; V-7 lists them as must-be-absent |
| `AdminDrawer` vs `ActivityDrillDown` | ✅ Same mechanism: `onOpenChange` to `onClose`, `aria-describedby={undefined}`, `onCloseAutoFocus` with `preventDefault` + `onReturnFocus`, inline background. Escape, overlay and X come from Radix |
| X direct child (C-9) | ✅ `sheet.tsx:67-71` renders `{children}` and then `SheetPrimitive.Close` as siblings inside `SheetPrimitive.Content`; whatever `AdminDrawer` passes as children, the X stays a direct child, so `[&>button]` reaches it and `activityDrillDown.render :464-474` keeps holding in L-8 |
| F-65 title | ✅ `cn` is a plain join (verified), so no class can be guaranteed to beat `text-[var(--v2-text-primary,…)]`; an inline `color` beats any class without editing `sheet.tsx`. Correct. Proof in the browser: M-2 |
| F-66 X | ✅ in principle. Tailwind is v4 (variants stack left to right), so `[&>button]:focus:ring-purple-500` compiles to `.cls > button:focus` (specificity 0,2,1), which beats the sheet's `.focus:ring-ring:focus` (0,2,0); `[&>button]:opacity-100` and `[&>button]:text-slate-300` (0,1,1) beat `opacity-70` and the token colour (0,1,0). Specificity, not order, so S-9 holds. jsdom only sees the class string: M-2 |
| `DrawerSection` | ✅ `div role="group"` + `aria-labelledby` on its `h3` is a named group, not a landmark: A-9 and S-8 hold (the guard matches only `<section` and `role="region"`). Heading order: the sheet's `SheetTitle` is Radix's `h2`, sections `h3`, the moved AIS blocks keep their `h4` under an `h3` (valid). See M-4 for duplicates |
| Table semantics | ✅ `aria-label`, `scope="col"` on 8 unique headers, the Open button in the first cell, name starting with the visible word "Open" (WCAG 2.5.3) |
| R-6 | ✅ The expand reads only the loaded row (`:847-1166`); the drawer renders `logs.find(...)`; no `useDrawerResource`, no D-7 states; the pilot test counts fetch calls across open and close (mutation V-3 d) |
| E-1 | ✅ with M-3 (Q-8) |
| Test edits | ✅ Enumerated in §5.2 (6 files + the guard); the must-stay-green list in §5.3 is complete for the touched surfaces |
| Verification | ✅ Scoped tsc with canary, hooks lint, mutation checks, diff-stat-first. Browser plan needs M-2 and S-3 |

### Findings

| # | Level | Finding | Required action |
|---|---|---|---|
| M-1 | must | **Doc sweep for the split.** SA did §1 row 4a and the L-1d status only. Several places still assign the picker to L-1d | In T-10: §1 row 4 notes ("Gains from L-1c" → the picker part now goes to L-1e; "meets the full definition of done" → at the end of L-1e, because §12.3's filter-bar item includes the Business picker); §6.2 C-6 slice column → L-1e; §7.4 (and the §7.3 sentence about C-6 moving) → L-1e; §12.2 L-1d criterion: move the `AdminBusinessPicker` sentence to a new L-1e line; §9 dispositions of F-31, F-56 (picker part) and F-70 → L-1e; §1 L-1d notes record the deferrals (Q-2, Q-5, Q-7, `formatUtcDate`, `useDrawerResource`) |
| M-2 | must | **F-65 / F-66 are only provable in a real browser.** The render tests pin class strings and the inline style; whether Tailwind emits the `[&>button]:focus:` rule in the order expected is visible only in computed styles | D-B2 and D-B3 record computed values in the **light** scheme (and dark): the dialog `h2` `color` is `rgb(241, 245, 249)`; the X `color` is slate-300 and `opacity` is 1; with the X focused (Tab to it), its `box-shadow` carries the purple ring colour and a dark offset, not white. One line each in the QA report, as L-1b S-3 did for the dialog X |
| M-3 | must | **E-1 counter must be self-explaining and fully pinned** | (a) A comment at the write effect's deps saying `rereads` is there so an outside change that parses to the current state still re-projects the URL (E-1), otherwise a later reader removes an apparently unused dependency. (b) Hook tests add: an outside change that **does** alter the state causes exactly one `replaceState` (not two), and mount causes no `replaceState` and no extra effect run beyond today's. (c) The pilot keeps the `businessPicker.render` mount pin `:429-437` unedited (already in §5.3) |
| M-4 | must | **No duplicate headings in the drawer, and the AI allow-list rule kept** | Inside `DrawerSection "AI action details"`, drop `AiActionDetails`' own `h4` "AI Action Details"; inside "Event details" and "Changes made", drop the inner `h4`s at `:1127` and `:1144`. Each section has exactly one heading, its `h3`. The `AiDetailValue` rule "omitted when undefined" stays a wrapper that returns `null` before rendering a `DrawerField` (the 13 allow-listed fields stay named, no `Object.entries(details)`). The legacy AIS blocks keep their inner `h4`s verbatim |
| S-1 | should | **The drawer blanks during its 300 ms slide-out.** `title={selected ? … : ''}` and `{selected && …}` clear the content the moment `openId` becomes null, while Radix still animates the closed panel | Keep a separate `isOpen` boolean for `open`, and leave `openId` set on close (it is replaced on the next open; a stale id that is no longer in `logs` simply resolves to null). The pilot's focus-return and "no request" cases are unaffected |
| S-2 | should | `SEVERITY_TONE: Record<string, StatusTone>` lets TypeScript treat a lookup as always defined, so the `unknown` fallback is not type-enforced | Type it `Partial<Record<string, StatusTone>>` (same for the word map) and resolve with `?? 'unknown'` / `?? raw` |
| S-3 | should | **D-B10 cannot be done by typing in the address bar**: that reloads the page and only exercises the mount rewrite, which already worked | Recipe: on `/admin/audit-trail` at the defaults, run `history.pushState(null, '', '?severity=catastrophic')` in the DevTools console (Next 14.2 syncs it to `useSearchParams`, an outside change). Expect no request in Network and the address bar back to `/admin/audit-trail`. Repeat with `?user_id=<id>` while `account=<id>` is applied |
| S-4 | should | **The dialog's accessible name runs the title and suffix together**: `SheetTitle` holds the label and a `span` with `ml-2`, so the name computes as "User Login2026-10-10 09:00 UTC" (margin is not a space; Activity has the same) | Render a literal space before the suffix span. The shared and pilot tests assert the name exactly: "User Login 2026-10-10 09:00 UTC" |
| S-5 | should | **`w-full` against the sheet's `w-3/4` is decided by CSS order**, which S-9 forbids relying on (both are 0,1,0; at `sm` and up `max-w-3xl` caps either, so the visible difference is small, but the rule is the rule) | Put `width: '100%'` in the same inline `style` as the background (the mechanism D-4 already uses), and drop `w-full` from the class; `sm:max-w-3xl` still caps it. Pin it in the shared render test |
| N-1 | note | The sheet's X rings on `focus`, not `focus-visible`, so a mouse click on X also shows the ring for the instant before the drawer closes. Accepted: `sheet.tsx` is not edited | — |
| N-2 | note | Two rows with the same event in the same minute get the same Open-button name. Table navigation gives screen-reader users the row context; not a blocker | — |
| N-3 | note | Prefer `userEvent.tab()` (installed, v14) for the focus-trap case; `fireEvent.keyDown` with Tab also works because Radix's FocusScope handles the key itself | — |
| N-4 | note | `getSeverityColor`, `useAuth` user, `Calendar`, `User` stay (F-29 open, not this slice). The icons `getSeverityIcon` used (`AlertCircle`, `CheckCircle`, `Info`, `AlertTriangle`) are removed only if unused after the edit; `npx eslint` in V-6 catches a leftover | — |

### Implementation conditions (summary for Dev)

1. M-1 to M-4 are done in this slice; S-1 to S-5 are expected, or a one-line reason under Implementation Notes.
2. Mutation checks V-3 (a) to (f) run as listed, plus: (g) remove `rereads` from the write effect deps → M-3 (b)'s new cases or the E-1 cases fail; (h) remove the literal space of S-4 → the exact-name case fails; (i) drop the inline `width` of S-5 → its render case fails.
3. The QA browser report includes M-2's computed values and S-3's recipe, in both schemes.
4. The PR names the nine visible changes of §3.8 and lists every edited test with its reason (§5.2).

### Verdict

**APPROVED WITH CONDITIONS — proceed to implementation.** No product question for the user.

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved (no must-fix; two Low items are optional follow-ups)

Reviewed uncommitted on `feature/admin-layout-l1d` (base `4530dfb4`). `git diff --stat` first: 15 modified + 8 new, insertions and deletions where expected, no blanked or deletion-only file.

### Checks

| Area | Result |
|---|---|
| Scope | ✅ No `lib/**`, `app/api/**`, `components/ui/**`, `app/admin/finance/**`, `app/admin/business-os-llm/**`, `BusinessAccountPicker.tsx`, picker contract test, `AdminSidebar.tsx` or `app/admin/layout.tsx` in the diff |
| M-1 doc sweep | ✅ Requirement §1 row 4, §6.2 C-6, §7.3, §7.4, §9 F-31 / F-56 / F-70, §12.2 moved to L-1e; targeted edits only |
| M-2 | ✅ D-B2 / D-B3 ask for computed values in both schemes (QA owes them) |
| M-3 | ✅ Comment at `useAdminFilters.ts:168-176`; hook cases for the junk case, the alias case, a state-changing outside change writing once, mount with no write, and the echo; `businessPicker.render` unedited and green |
| M-4 | ✅ One `h3` per section; `AiDetailValue` (`page.tsx:241-244`) returns null before a `DrawerField`; the 13 fields stay named; legacy AIS `h4`s kept verbatim; pinned by the pilot "exactly one heading" case |
| S-1 | ✅ `isOpen` / `openId` split (`page.tsx:639-640`); close clears only `isOpen` |
| S-2 + hardening | ✅ `Partial<Record<…>>` + `?? 'unknown'` / `?? severity`; own-key check (`page.tsx:292`) so "constructor" resolves to `unknown`, pinned in the pilot |
| S-3 | ✅ D-B10 uses the `history.pushState` recipe, both cases |
| S-4 | ✅ Literal space (`AdminDrawer.tsx:83-85`); name and `h2` `textContent` both asserted. Deviation 4 accepted: jsdom pads accessible names, so `textContent` is the right second pin |
| S-5 | ✅ `width: '100%'` inline (`AdminDrawer.tsx:42`), no `w-full`; pinned. The sheet's `right` variant has no `sm:max-w-*`, so `sm:max-w-3xl` is not an order contest either |
| D-6 drawer | ✅ Escape, overlay and X all come from Radix through `onOpenChange` to `onClose`; `onCloseAutoFocus` prevents default and calls `onReturnFocus`; the pilot returns focus to the row's own Open button (tested) |
| X direct child | ✅ `sheet.tsx:65-70` renders `{children}` then `SheetPrimitive.Close` inside Content; `AdminDrawer` wraps its children in a `div`, so the X is the only direct `button` child and `[&>button]` reaches only it (pinned) |
| F-65 | ✅ Inline `color: rgb(241, 245, 249)` on `SheetTitle` beats the sheet's `text-[var(--v2-text-primary…)]` regardless of scheme or CSS order |
| F-66 | ✅ `.x>button` (0,1,1) beats the X's `text-[var(--v2-text-muted…)]` and `opacity-70` (0,1,0); `.x>button:focus` (0,2,1) beats the `focus:ring-ring` / `focus:ring-offset-2` colours (0,2,0). Browser proof is M-2 |
| Deviation 1 (comma `rgb`) | ✅ Accepted: identical colour in a browser and the only form jsdom keeps |
| Deviations 2, 3, 5, 6, 7, 8 | ✅ Accepted as recorded |
| Table semantics | ✅ `aria-label="Audit events"`, 8 `th scope="col"`, unique headers, Open button in the first cell, name starts with the visible word "Open" (WCAG 2.5.3); no clickable `tr` (Q-10) |
| R-6 no fetch on open | ✅ `openRow` (`page.tsx:787-791`) only sets state; the body renders the loaded row; the pilot counts fetch calls across open and close |
| E-1 | ✅ `rereads` bumps only after the `incoming === lastKnown` early return, so mount and Next's echo never move it; an outside change batches `setState` + `setRereads` into one write-effect run; `filters` identity is kept, so the page's `[filters]` effects and the F-28 mount pin are unaffected; the write records `lastKnown` before `replaceState`, so no loop |
| Allow-list guard | ✅ `page.tsx` keeps `log.entity_type === AI_ACTION_ENTITY_TYPE && log.details` and the one-line generic condition with `Object.entries(log.details)`; `filterOptions.guard` green unedited |
| Shared folder guard | ✅ Three expected files added, label updated, no rule change; new files are sky / amber only, `div role="group"`, no `<section` |
| Accessibility | ✅ Icons `aria-hidden`; `AdminNotice` has no role (does not disturb the one-`status` pin); `DrawerSection` is a named group, not a landmark; `type="button"` on Open and pager buttons |
| Logging / `any` | ✅ No `console.*` in any touched file. The page's `any`s are pre-existing lines moved verbatim (F-29 / legacy AIS blocks) |
| Line endings | ✅ LF, matching `HEAD` for every touched file; no backslash in the workplan or the requirement diff |
| Tests (SA spot run) | ✅ `npx jest app/admin/components/layout app/admin/audit-trail app/admin/business-os-llm app/admin/finance lib/audit --ci`: 57 suites, 1,192 tests passed. `npx eslint` on the six shared sources: clean |
| Edited tests | ✅ None weakened: each card locator became a row / cell locator with an equal or stricter assertion (exact `textContent`, `title` holds the full id, E-4 waits for the drawer before asserting no User field) |

### Code Review Comments

1. `app/admin/audit-trail/page.tsx:1205` — `open={isOpen && selected !== null}`: if the open row leaves `logs` while the drawer is up, the panel closes but `isOpen` stays `true`, and a later read that brings the same row back would reopen the drawer unasked. Reachable only by an outside URL change while the modal is open (the filters use `replaceState`; the bar and pager are blocked by the modal), so not a blocker. Optional follow-up: clear `isOpen` when `selected` resolves to null. — Priority: Low
2. `app/admin/components/layout/__tests__/AdminDrawer.render.test.tsx` — no overlay-click case; Escape and X are pinned, the overlay is Radix behaviour and is covered by browser check D-B5. Optional. — Priority: Low

### Optimisation Suggestions

- `app/admin/audit-trail/__tests__/auditTrail.table.render.test.tsx:130` — `(global as any).fetch` follows the sibling suites' convention but carries no CLAUDE.md rule 6 comment; add a one-line reason (or a typed cast) when the file is next touched.
- `ADMIN_BUTTON` convergence in `AdminStates` / `AdminFilterBar` stays as recorded (Q-7).

### Code Approved for QA: Yes

QA must still record M-2's computed values (light and dark) and the S-3 D-B10 recipe. No must-fix before commit.

## QA Report — 2026-10-11

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A + B (Jest unit and jsdom render: the existing suites plus a throwaway edge-case suite), scoped `tsc` with a canary, lint. D (browser) is handed to TL as a checklist because it needs a signed-in admin
**Focus:** ui, schema (types), security (no new request, AI allow-list), every §12.2 L-1d criterion
**Skipped:** browser checks D-B1 to D-B12 (they need a signed-in admin session; listed below for TL)
**Input source:** TL prompt + workplan §5, §6, SA workplan review and SA code review

### Commands and results (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/components/layout app/admin/audit-trail app/admin/__tests__ app/admin/components/__tests__ app/admin/business-os-llm app/admin/finance app/api/admin/audit-trail lib/audit lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **Test Suites: 80 passed, 80 total. Tests: 1726 passed, 1726 total** (75.9 s). One "worker process has failed to exit gracefully" notice; the slowest suite was the 69 s `jobsQueues.retry`, which is not an L-1d file |
| 2 | `npm run test:bos-entitlements` | **Test Suites: 233 passed, 233 total. Tests: 6382 passed, 6382 total** (92.5 s). Nothing in the diff imports `lib/business-os/entitlements` |
| 3 | Scoped tsc, run 1. Scratch `tsconfig.qa.json` in the session scratchpad: extends the worktree `tsconfig.json`, `incremental: false`, and includes `next-env.d.ts`, the whole shared folder and its tests, `adminWindowPresets.ts`, `components/ui/sheet.tsx`, every Audit trail source and test, `HealthGrid.tsx` and `JobsQueuesView.tsx`. It also includes a scratch `canary.ts` that imports `formatShortId` and `AdminDrawerProps` through the `@/` alias and declares `const qaCanary: number = formatShortId(null)` | Exit 2 with exactly one error: `qa-l1d/canary.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.` This proves both the scope and the alias resolution |
| 4 | Scoped tsc, run 2: canary corrected to `string`, same config | **Exit 0, no output** |
| 5 | `npx eslint <7 touched sources> --no-config-lookup --no-inline-config --config eslint.hooks.config.mjs --max-warnings 0` | Exit 0 |
| 6 | `npx eslint <7 touched sources>` | 0 errors and 12 warnings, all in `page.tsx`. They are the same 12 Dev recorded (F-29 unused code, pre-existing `any`s, `fetchLogs` deps). No `console.*` in any touched source |
| 7 | Throwaway suite `app/admin/audit-trail/__tests__/zzqa.l1d.render.test.tsx` (22 cases, below), deleted afterwards | 21 cases passed, plus 1 probe that confirmed B-1. `git status --short` had 23 lines before and after. No stash, no commit, `node_modules` untouched |

### Edge cases (throwaway tests on the real pilot page, RC-1 mocks)

| # | Case | Result |
|---|---|---|
| 1 | Open via the button; close via Escape (existing pilot case), the X, and an overlay pointerdown | ✅ Each one closes the drawer, and focus returns to that row's Open button every time. This also covers SA code review comment 2 at page level |
| 2 | Open a second row while one is open. In jsdom, `fireEvent` gets past the modal; a real browser blocks the click with `pointer-events: none` | ✅ Only one dialog, now named for the second row. Escape returns focus to the second row's button |
| 3 | AI row with every allow-listed field, plus an extra key `extra: 'SECRET'`, and `groupId` absent | ✅ The terms are exactly Area through Models (12; Grouping ID is omitted). `Outcome` = "failed (E42)", `Calls` = "1,200", cost `$0.0000002`. "SECRET" is never rendered. No "Event details" and no "Changes made". The Event group has User and Business, and no Resource (the row has no resource name) |
| 4 | Legacy AIS rows: `AIS_SCORE_CALCULATED` (with `changes`) and `AIS_NORMALIZATION_REFRESH_COMPLETED` | ✅ A "Score" group showing 1.50, with no "Event details" or "Changes made". The "Normalization" group keeps its h4 "Normalization Ranges Updated" and the "✓ Changed" marker |
| 5 | Non-AI row with details and changes | ✅ "Event details" (the nested object as JSON) and "Changes made" (before and after) |
| 6 | Row with no details, no changes, no resource and a system user | ✅ Only the "Event" group. No User, Business or Resource fields |
| 7 | No request on open (existing pilot case, R-6) | ✅ Green in run 1 |
| 8 | 0 rows | ✅ `AdminEmpty` and no table. The count line reads "Showing 0 of 0 audit logs", as it did before the slice |
| 9 | 1 row; 20 rows with a total of 45 (existing pilot case) | ✅ 1 row and no pager. The 20 rows page by the unfiltered total |
| 10 | Missing business or user | ✅ Em dash in the Business and User cells (existing pilot case) |
| 11 | Long ids: a bare user id and a nameless resource | ✅ The User cell shows `abcdef12…` with `title` = the full id. The Resource cell shows "Entity id 11112222…" with `title` = the full id and no em dash. The drawer shows both full ids |
| 12 | Severity `notice`, `constructor` (existing), `__proto__` and `hasOwnProperty` | ✅ `unknown` tone with the raw word |
| 13 | Severity `""` and `null` | ⚠️ `unknown` tone and an icon, but **no words** (Edge E-1) |
| 14 | Count line with search off: total 14332, 717 pages | ✅ "Showing 20 of 14,332 audit logs (Page 1 of 717)"; pager label "Page 1 of 717" |
| 15 | Count line with search on | ✅ "Showing 20 matches on this page (Page 1)"; pager label "Page 1". Neither "14,332" nor "14332" appears anywhere on screen |
| 16 | Pagination after closing the drawer: Next, then Last (page 2 reuses the same ids) | ✅ Requests `page=2` and `page=3`; the drawer stays closed |
| 17 | E-1: mount at the defaults | ✅ Zero `replaceState` calls |
| 18 | E-1: outside change to `?severity=catastrophic` | ✅ Exactly one `replaceState(null, …)`. The URL goes back to `/admin/audit-trail`, with no new list request |
| 19 | E-1: outside change to `?user_id=X` while `account=X` is applied | ✅ Exactly one `replaceState`. The URL goes back to `?account=X`, with no new list request |
| 20 | Outside change that alters the state (`?severity=critical`) | ✅ Exactly one new request, with `severity=critical`, and zero `replaceState` calls (the URL is already canonical) |
| 21 | Health deep links | ✅ The L-1c cases in `auditTrail.layout.render` are green and were not edited for this slice: "a Health link reaches the route byte for byte", the linked-window chip, and "a Health alias link costs exactly one list request…" |
| 22 | Export CSV | ✅ One download. The content is byte-for-byte the old 6 columns of the loaded page (`…,info,System` / `…,ai_action,,warning,<id>`) |
| 23 | A Refresh is in flight → Open a row → the read lands **without** that row → a later read brings the row back | ❌ **Bug B-1** |
| 24 | Legacy "Execution" block with `total_executions: 0` and `total_tokens_used: 0` | ⚠️ A bare "0" is rendered after the Event group (Edge E-2, pre-existing) |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| Exactly one `h1`, including while the drawer is open | ✅ |
| 8 headers, all `scope="col"`, unique and in order | ✅ (pilot case, checked again) |
| Open buttons are named "Open details for {event} at {UTC time}", with the visible text "Open" and the icon `aria-hidden` | ✅ |
| The drawer is `role="dialog"` with the exact name "Business Ai Action Completed 2026-10-10 08:30 UTC", and the h2's textContent has the literal space | ✅ |
| Every drawer group is named by an `h3` (through `aria-labelledby`), with one heading per group | ✅ |
| No `role="region"` and no `<section>` on the page or in the drawer | ✅ 0 and 0 |
| Severity chips have words and an `aria-hidden` svg | ✅ (except E-1's empty severity) |

### Issues Found

#### Bugs (must fix before commit)

1. **B-1: a stale `isOpen` reopens the drawer by itself, and focus drops to `<body>`.** File: `app/admin/audit-trail/page.tsx` (`open={isOpen && selected !== null}`, `openRow`, `onClose`). Severity: **Medium**. This is SA code review comment 1. QA raises it from Low because it is reachable **without** an outside URL change. The modal blocks the bar and the pager only after it opens. A read that is already in flight still lands, and the Open buttons stay enabled while a read runs, because the table stays mounted under `aria-busy`. Search reads on every keystroke, so a slow read is an ordinary moment to click Open. Browser Back/Forward is not blocked by the modal either.
   - Steps to reproduce: rows are loaded → start a read (Refresh, or type in Search) → while it is in flight, click a row's Open → the read answers without that row → later, a read includes that row again (clear the search, Refresh, or page back).
   - Expected: when the open row leaves the list, the drawer closes as a real close (state cleared, focus somewhere sensible), and it never reopens without a click.
   - Actual (probe output): after the first read the dialog disappears because `selected` became null. Radix does not call `onOpenChange` for a prop change, so `isOpen` stays `true`, and `document.activeElement` is `BODY` because the opener was unmounted. After the later read: `rows= 2 dialog open = true name= User Login 2026-10-10 09:00 UTC body pe= none`. The drawer pops open unprompted, and the page behind it is locked.
   - Fix direction (Dev's choice): clear `isOpen` when `selected` resolves to null, either in the fetch success path or in an effect on `[isOpen, selected]`. When `opener.current` is no longer connected to the document, return focus to an element that is. Keep the probe above as a pilot regression case.

#### Performance Issues (should fix)

None. Opening and closing rows makes no request, and the E-1 fix adds no request and exactly one `replaceState`.

#### Edge Cases (nice to fix)

1. **E-1: an empty or null severity renders a chip with no words** (A-7; §5.9 says "Text is always present"). `SeverityChip` falls back to the raw value, which is `""` or `null`. This is probably unreachable, because the table appears to enforce a severity CHECK, so it is Low. Fix: use the word "Unknown" when the raw value is empty.
2. **E-2: a stray "0" in the legacy Execution block.** The **outer** condition `log.details && (total_executions || total_tokens_used) && …` renders "0" when both values are 0. Dev recorded only the inner one. Pre-existing, moved verbatim, AIS rows only.
3. **E-3 (observation):** "Showing 0 of 0 audit logs" still shows above the empty state when a read succeeds with no rows. This is unchanged from before and matches N-2's scope, which covers the error case only.

### Browser checklist for TL (V-8: signed-in admin, DevTools Network open, light AND dark scheme emulation)

| # | Do | Record |
|---|---|---|
| D-B1 | Open `/admin/audit-trail` in each scheme | One table at `py-2` density. Small-caps, unique headers. Time as "YYYY-MM-DD HH:mm UTC". Severity chips with words and an icon. Short mono ids with the full id on hover. On a narrow window the table scrolls inside its frame and the page does not scroll sideways |
| D-B2 | Tab to the first Open and press Enter | The drawer slides in from the right. Computed values (Elements → Computed), **light and dark**: dialog `h2` `color` = `rgb(241, 245, 249)`; X `color` = `rgb(203, 213, 225)` (or the oklch slate-300 equivalent) and `opacity` = `1`; dialog `background-color` = `rgb(15, 23, 42)`; dialog width capped at `max-w-3xl` (768 px) on desktop |
| D-B3 | Tab around inside the drawer | Focus stays inside. With the X focused by keyboard, its `box-shadow` carries purple-500 (`rgb(168, 85, 247)` or the oklch equivalent) and a dark slate-900 offset, **not white**. One line per scheme |
| D-B4 | Press Escape | The drawer closes, with a visible focus ring on that row's Open |
| D-B5 | Reopen and click the overlay; reopen and click the X | Each one closes the drawer and focus returns to the Open button. The content does not blank during the slide-out (SA S-1) |
| D-B6 | Open a Business OS AI row (`entity_type=ai_action`) | "AI action details" with the allow-listed fields only and the cost at its stored precision. No "Event details" dump |
| D-B7 | Watch the Network panel while opening and closing several rows | No request |
| D-B8 | Type a search | The amber caveat notice appears above the table, and the count line reads "… matches on this page (Page n)" |
| D-B9 | Use Next, Last, Previous and First | Same requests as `main` (only `page=` changes). The buttons use the shared style and are disabled at the ends and while a read is loading |
| D-B10 | At the defaults, run `history.pushState(null, '', '?severity=catastrophic')` in the console. Then pick an account and run `history.pushState(null, '', '?user_id=<that id>')` | Each time: the view is unchanged and there is **no new request**. The address bar goes back to `/admin/audit-trail`, then to `?account=<that id>` |
| D-B11 | Export CSV | Same file as `main` (6 columns, loaded page) |
| D-B12 | L-1c's B-1 to B-14 | Re-run on this branch if they have not been run on L-1c yet (still owed from PR #291) |
| D-B13 (after Dev fixes B-1) | In DevTools → Network, throttle to "Slow 3G". Click Refresh, then immediately Open a row. Then type a search that excludes the row and clear it again | The drawer never reopens by itself, and focus is never lost to the page body |

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address B-1 before commit

**Verdict: FAIL (narrow).** Everything in §12.2 L-1d that jsdom can prove passes:
- The drawer traps focus, closes on Escape, the X and the overlay, and returns focus to the opener. The X is a direct child of the dialog.
- Rows open only through the Open button, and the cards are gone.
- Pagination, Export CSV and requests are unchanged.
- E-1 is fixed with exactly one `replaceState`.
- The scoped tsc caught the canary, then ran clean.
- 80 + 233 suites are green.

One Medium bug, B-1, is still open. This slice goes to RM without user review, so it should be fixed first. The fix is a few lines. After it, re-check only B-1's regression case, the pilot suite and `useAdminFilters.render`, not the full cycle. The light-scheme readability items (M-2) stay with TL in the browser either way.

### QA re-check — 2026-10-11

Scope: Dev's "QA B-1 fix (and QA E-1, low)", `page.tsx` only. I re-checked it with a throwaway suite `zzqa.recheck.render.test.tsx` (7 cases, all passed, then deleted). `git status --short` still shows 23 lines. No stash, no commit.

| # | Case | Result |
|---|---|---|
| 1 | The original B-1 probe: a Refresh is in flight → Open the first row → the read lands without it → a later Refresh brings it back | ✅ The drawer closes when the row leaves. Focus goes to the connected content `div` (`aria-busy`, `tabIndex=-1`), not `<body>`, and the body is not left at `pointer-events: none`. After the row comes back the drawer **stays closed**, and a click on Open still opens it normally |
| 2 | Variant: a search keystroke whose read excludes the open row, then clearing the search | ✅ Closes, focus is not on `<body>`, and it never reopens |
| 3 | Variant: a history change while the drawer is open. Forward goes to `?severity=warning` (whose read lacks the row); Back goes to the defaults (the row returns) | ✅ Closes on Forward, focus is not on `<body>`, and it does not reopen on Back |
| 4 | Ordinary closes: Escape, the X and the overlay (I wrapped `AdminDrawer` to record its props on every render) | ✅ Every render with `open=false` during the close still carries the title "Business Ai Action Completed", so the content does not blank during the slide-out (S-1 holds). Focus returns to that row's Open button each time |
| 5 | Severity `""` and `null`, in the table and in the drawer | ✅ "Unknown" with the `unknown` tone and an `aria-hidden` icon in the table, and "Unknown" in the drawer's Severity field |
| 6 | `npx jest app/admin/audit-trail app/admin/components/layout --ci` | **Test Suites: 29 passed, 29 total. Tests: 545 passed, 545 total** |

Note (Low, no action needed for this slice): when the opener is gone, focus lands on the content area, which has `focus:outline-none`. Focus is kept on the page, but a keyboard user sees no ring there. This is acceptable as a fallback.

**Re-check verdict: PASS.** B-1 and E-1 are fixed. Edge cases E-2 (the legacy bare "0", pre-existing) and E-3 (observation) stay out of scope. The browser checklist D-B1 to D-B13 is still owed by TL, including M-2's computed values in the light and the dark scheme.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Workplan written | Dev: L-1d scope (table, drawer, Open button, `info` tone, `AdminNotice`, E-1); picker split to L-1e (pre-authorised Q-1); 10 SA questions |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS: Q-1 to Q-10 ruled (split confirmed); must M-1 to M-4 (doc sweep, browser computed-style proof of F-65 / F-66, E-1 comment and pins, one heading per drawer section), should S-1 to S-5. SA added the L-1e row (4a) and the L-1d status to requirement §1 |
| 2026-10-11 | Implemented (uncommitted) | Dev: T-1 to T-10; M-1 to M-4 and S-1 to S-5 all done; 8 recorded deviations; V-1 to V-7 green (80 suites / 1,726 tests; entitlements 233 / 6,382; scoped tsc canary then clean); mutations (a) to (i) each red then restored. Implementation Notes added; browser plan D-B2, D-B3, D-B10 updated (M-2, S-3) |
| 2026-10-11 | SA code review | CODE APPROVED for QA: M-1 to M-4 and S-1 to S-5 verified, deviations 1 to 8 accepted, no must-fix; two Low optional items (drawer reopen after an outside change, no overlay-click unit case); SA spot run 57 suites / 1,192 tests green |
| 2026-10-11 | QA report | QA: FAIL (narrow). Green: 80 suites / 1,726 tests and entitlements 233 / 6,382; scoped tsc caught the canary, then ran clean; 24 edge cases run. Bug B-1 (Medium; SA comment 1, raised because it is reachable through a read already in flight): a stale `isOpen` reopens the drawer by itself, and focus drops to the body. Edge cases E-1 to E-3. Browser checklist D-B1 to D-B13 for TL |
| 2026-10-11 | QA re-check | QA: **PASS**. B-1 fixed: the drawer never reopens unasked after a Refresh in flight, a search keystroke or a Back/Forward change, and focus never lands on `<body>`. Ordinary closes keep the content during the slide-out and return focus to the opener. E-1 fixed ("Unknown"). Audit trail + shared layout suites: 29 suites / 545 tests green |
