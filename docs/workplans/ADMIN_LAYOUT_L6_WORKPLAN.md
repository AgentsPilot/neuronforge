# Workplan: Admin Layout Standard — Slice L-6 (Signup Invites)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 11), §3, §4.9, §5.1, §5.3, §5.4 (K-1 to K-10, K-6 "tiles are not links" on Invites), §5.5, §5.6 U-1 exception (2), §5.7, §5.9, §5.10, §5.11, §5.12, §6.1 (S-1, S-3, S-6), §6.2 C-2, C-3, C-4, C-8, C-11, C-12, C-13, C-14, §7.9, §9 F-40, F-41, F-42, F-104, §10 D-3 (a), D-4 (a), D-7 (a), D-8 (a); SA rulings Q-3 (one alias line), SA-R-5 (history ban kept, guard extended), SA-R-10 (two tiles, "at least"), re-check R-7 (a page slice that builds a shared export runs the full cycle), R-16 (D-7 (a) confirmed)
**Skills applied:** none of the domain skills is triggered: no service-role write, no AI call, no queue, no DB claim, and no import from `lib/business-os/entitlements/` (the page and the shared folder import nothing from it; §2.9)
**Branch:** `feature/admin-layout-l6`, cut from `feature/admin-layout-l5` at `62fafda0`, then fast-forwarded to origin/main `4d383105` before coding (PRs #309 and #310 merged), so the L-6 PR carries only L-6. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-12
**Status:** Committed — 4d241b1e on `feature/admin-layout-l6`; PR #315 open (fast-track: SA approved, QA passed with QA-1, SF-1, SF-2 fixed); awaiting checks + user merge
**Path:** **UI short path by classification** (R-7): L-6 builds **no** shared export. Every shared part it uses already exists on the branch: `AdminPageHeader` with `actions`, `KpiStrip` / `KpiTile` in no-target mode with the `amber` status, `AdminFilterBar` with page controls, Clear, `canClear` and `readAt`, `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`, `AdminLoading` / `AdminError` / `AdminEmpty` / `AdminNotice`, `readAdminResponse` (with `sessionEndedCopy`) / `readJsonBody` / `ADMIN_NETWORK_ERROR`, `StatusChip` tones `info` / `ok` / `neutral` / `warn` / `danger`, the `adminTable` constants and `ADMIN_BUTTON`, `formatCount`. The only edit in the shared folder is the migrated-pages registry entry in its guard test (the L-3, L-4b and L-5 precedent). Run as SA workplan review → Dev → SA code review + QA → RM under the user's fast-track (RM commits and opens the PR after SA and QA, without a user diff review). **If SA rules that L-6 builds the deferred `formatUtcDate` (Q-6 option b), the slice becomes full cycle.** The recommendation avoids that

## Overview

L-6 moves `/admin/business-os-invites` (209-line `page.tsx`, six components, two helpers) onto the standard. The h1 becomes "Signup Invites", the sidebar label (D-3 (a)). The header is `AdminPageHeader` with "New invite" in its actions slot. A five-tile KPI strip (Pending, Accepted, Stopped halfway, Expired, Revoked) counts the rows the one GET already returns (§7.9, K-9); the tiles are **not links** (D-7 (a), K-6). Refresh moves into the shared filter bar, which holds the existing Search, State, Invite type and Issuer controls in the standard order with a Clear that is always rendered. **The filters stay in the page's own state and are never written to the URL** (D-7 (a)): this page keeps its guarantee that the shown-once invite link cannot survive a reload, and the guard is extended to prove it (SA-R-5). Loading, error and empty use the shared states; the page error no longer shows a raw "Failed to fetch". The list becomes the standard table: unique headers ("Email status", F-40), state and email status as `StatusChip`s with icons. The revoke form stays inline under its row (D-8). The create form and the shown-once link panel are restyled only and never import the URL hook. No route, request, payload, permission or write changes.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-62fafda0)
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
- [13. Product question for the user](#13-product-question-for-the-user)

---

## 1. Analysis Summary (code verified at `62fafda0`)

### 1.1 The page today

| File (lines) | What | Standard item |
|---|---|---|
| `page.tsx` (209) `:88-120` | Hand-built header: h1 "Business OS Signup Invites" (`:93`), a three-sentence purpose (`:94-97`), Refresh (`:100-108`, rounded, no aria-label, no focus ring) and "New invite" (`:109-117`, purple primary, disabled until the payload is read) | §5.3, D-3 (a), C-2 |
| `page.tsx` `:62-77` | One read: `fetch('/api/admin/business-os/invites', { cache: 'no-store' })`, `response.json().catch(() => null)`; a non-ok or non-success body throws the fixed sentence "Could not read invites. If this persists, the invites table may not be installed yet."; **a rejected fetch shows `err.message` ("Failed to fetch")** (`:73`) | §5.10 rules 3 and 4, C-4 |
| `page.tsx` `:122-129` | Error box (rose, `page-error` on the box) above everything; first-load "Reading invites…" as a bare `<p>`; a failed Refresh keeps the payload on screen under the error | §5.10, K-10 |
| `page.tsx` `:133-153` | `EnforcementNote`, then the amber "N signups stopped halfway" banner (`role="status"`, server summary `stoppedHalfway.count`) | K-5 (ii) source for the Stopped halfway tile |
| `page.tsx` `:158-178` | `CreatedLinkPanel` (keyed by invite id, so "Copied" never carries over) and `CreateInviteForm` | Shown-once link (the reason for D-7 (a)) |
| `page.tsx` `:180-204` | `<section>` (unnamed, not a landmark) with h2 "Invites (newest first)", `InviteFilters` only when the list is non-empty, the slate "Showing the newest N invites…" note when `truncated`, then `InviteList` | §5.5, §5.7, §5.10 Partial |
| `inviteFilter.ts` (90) | Pure filter: `InviteListFilter { state, inviteType, issuer, query }`, `EMPTY_INVITE_FILTER`, `filterInvites`, `isFilterActive`; the option lists. Compares no date (C-11 guard) | SA-R-5 (1) exact key list |
| `components/InviteFilters.tsx` (112) | Search (type `search`, sr-only label), State, Invite type, Issuer selects (sr-only labels), Clear **only when active** (`:96-105`), and the count "N of M shown" / "M invites" (`invite-filter-count`, `text-slate-500`) | §5.5 parts 4-6, T-5 |
| `components/InviteList.tsx` (204) | `w-full text-left text-sm` table, `px-3 py-2`, 10 columns, **two headed "Email"** (`:72`, `:79`) and a blank action header (`:81`); state and email status as coloured text spans without icons (`:31-49`, `:107-109`, `:163-169`); dates `YYYY-MM-DD` via a local `day()` (`:52-54`); facts stacked in the State cell (revoke reason, revoked by inviter, accepted account and level, stopped-halfway block, opened by an existing account); `text-slate-500` information text (`:85`, `:92`, `:99`, `:104`, `:160`); the empty `<p>` (`:60-64`) | §5.7, §5.9, §5.11, T-5, F-40 |
| `components/RevokeDialog.tsx` (100) | Inline form under the row (D-8: stays), `response.json().catch(() => null)` (`:49`), codes mapped through `ERROR_TEXT` | C-4, registry `.json(` rule, F-41 |
| `components/CreateInviteForm.tsx` (311) | The form; `response.json().catch(() => null)` (`:99`), codes mapped through `ERROR_TEXT`; `text-slate-500` on an unavailable type and its reason (`:142`, `:156`) | C-4, T-5 |
| `components/CreatedLinkPanel.tsx` (109) | Emerald panel, the link in a `code`, Copy / Copied, Close (aria-label "Close"); a `<section>` with no accessible name (not a landmark) | Styling only |
| `components/EnforcementNote.tsx` (47) | Undismissible note, amber (off, shadow) or emerald (enforce), `<section role="note">`; copy "Until signup from an invite is built…" (F-42) | **Deleted** (D-18, SA M-1); the live plan-enforcement fact moves to the header badge (§2.1 S-1) |
| `types.ts` (132) | The payload shapes. Untouched | — |

### 1.2 The payload (route unchanged)

`GET /api/admin/business-os/invites` → `data: { invites: InviteRow[] (newest, up to the 500 ceiling), stoppedHalfway: { count, inviteIds }, truncated, formOptions, enforcementMode }`. `stoppedHalfway` is derived on the server **over the same returned rows** (`lib/business-os/invites/adminInviteOps.ts:553-560`), so when `truncated` is true every count on this page, the banner's included, is a lower bound. Failures answer a **machine code**, not copy: `{ success: false, error: 'could_not_read_invites' }` (route `:97`, `:126`). That matters for §5.10 rule 1 (§2.5).

### 1.3 Who else renders this folder's code

Nobody. No file outside `app/admin/business-os-invites/` imports from it (`grep` at `62fafda0`: the only references to the path are the sidebar entry, the sidebar nav test and the folder's own guard).

### 1.4 Tests that pin the page

| Test | What it pins that L-6 must respect |
|---|---|
| `__tests__/source.guard.test.ts` (143) | **Exact file list** `:47-61`; imports only from inside the folder plus `react` and `lucide-react` (`:44`, `:63-72`); no `LanguageContext`; no plan name, price or plan-id literal (`:78-83`); no `console.*`; no `any`; **no `localStorage`, `sessionStorage`, `document.cookie` or `history.(push or replace)State`** (`:95-97`); `inviteFilter.ts` compares no date; no `fetch` in the filter or its controls (`:107-110`); a client page with no own guard; no admin decision; **every `fetch` targets `/api/admin/business-os/invites…`, at least 3 of them** (`:136-142`) |
| `__tests__/page.render.test.tsx` (781) | h1 "Business OS Signup Invites" (`:115-119`); state, accepted account, L2 parent, stopped-halfway banner and badges, enforcement note words "Nothing is enforced yet" and "internal demos only" (`:233-242`); a `searchbox` role; `page-error` on a 500; every filter combination by testid (`invite-state-filter`, `invite-type-filter`, `invite-issuer-filter`, `invite-search`); `invite-filter-count` words "0 of 7 shown" / "7 invites"; a button named exactly "Clear"; **filters never sent to the server** (`:365-372`); the 500-ceiling note `invite-list-truncated` (`:382-392`); **no filter controls over an empty list** (`:394-399`); the create flow, **link shown once**, fresh panel per invite, **link gone after a reload** (`:526-544`); revoke by the exact button names "Revoke", "Revoke invite"; email status chips by exact text (`^Sent$` etc., `:673-685`) and a dash when absent; friend invites |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` `:201-205` | The sidebar label "Signup Invites" and the route. No edit; the new h1 equals it |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | The registry (no own h1, no `.json(`, header import, alias only) once Invites joins |

---

## 2. Scope and decisions

### 2.1 In L-6

| # | Item | Standard |
|---|---|---|
| S-1 | Header via `AdminPageHeader`: h1 "Signup Invites", a one-sentence purpose, "New invite" in `actions`. **Badge (SA M-1, D-18):** from `payload.enforcementMode`, off / shadow → "Plans not enforced", enforce → "Plans enforced", `testId: 'enforcement-mode-badge'`, only once the payload is read (no badge while loading or on a first-load error). It is invite-signup GR-5's surface on the issuing page; no other words of the old note survive. No "As of" (the payload has no server clock) | §5.3, D-3 (a), D-18 |
| S-2 | KPI strip, five no-target tiles (§2.2) | §5.4, §7.9, SA-R-10, D-7 (a) |
| S-3 | Filter bar via `AdminFilterBar`, page-held state, no URL (§2.3) | §5.5, U-1 exception (2), D-7 (a) |
| S-4 | States: `AdminLoading` ("Reading invites…", the same words), `AdminError` (`page-error`, Try again), `AdminEmpty`, the truncation note as `AdminNotice` (§2.5) | §5.10, K-10 |
| S-5 | Every JSON read through the shared helpers: the list read through `readAdminResponse`; the create and revoke reads through `readJsonBody` (their code-to-sentence maps unchanged). No `.json(` left in the folder | C-4, §6.1 S-6, registry |
| S-6 | Table on the `adminTable` constants; unique headers ("Email status", F-40; an sr-only "Actions" header); "(UTC)" on the three date headers; `scope="col"`; `aria-label="Invites"`; T-5 text colours | §5.7, §5.11, §5.12 |
| S-7 | State and email status as `StatusChip`s with icons (§2.4); the stopped-halfway title inside its block as a `warn` chip | §5.9, A-7 |
| S-8 | `CreateInviteForm`, `CreatedLinkPanel`, `RevokeDialog`: styling only (T-5 colours, `rounded-lg`, A-1 focus rings). Same words, testids, structure, behaviour | §5.12 A-1, T-5, D-8 |
| S-9 | Guard: alias line, new file in the exact list, SA-R-5 assertions (1) to (3) plus a proposed (4) (§5) | SA Q-3, SA-R-5 |
| S-10 | Registry entry for Invites | C-14 |

### 2.2 Decision: the KPI strip (§7.9, K-1 to K-10)

New file `components/InviteKpis.tsx`, with a pure exported `countInvites(invites)` beside the component (tested directly). Order and sources as §7.9:

| Tile (testid) | Value | Colour | Target |
|---|---|---|---|
| Pending (`kpi-pending`) | rows with `state === 'pending'` | Neutral | None (`div role="group"`) |
| Accepted (`kpi-accepted`) | `state === 'accepted'` | Neutral | None |
| Stopped halfway (`kpi-stopped-halfway`) | `stoppedCount`, derived **once** in the page as `payload.stoppedHalfway?.count ?? 0` and passed to the strip (SA M-5), the **same value the banner reads** | `amber` ("Needs a look") when `stoppedCount >= 1`, else neutral; the banner renders when `stoppedCount > 0`, from the same value. K-5 (ii): the page already renders an amber banner for exactly this (`page.tsx:137`) | None |
| Expired (`kpi-expired`) | `state === 'expired'` | Neutral | None |
| Revoked (`kpi-revoked`) | `state === 'revoked'` | Neutral | None |

- **Values** through `formatCount` (thousands separators). Counts are over `payload.invites`, so they follow a create (the row is prepended) and a revoke (the row is replaced) without a read, as the list does. The Stopped halfway figure is the server's summary, so it moves only on a read, like the banner (unchanged behaviour; both show the same number at all times).
- **Not links** (D-7 (a), K-6): the no-target mode, with the K-7 name ("Pending, 3"; "Stopped halfway, 2, needs a look"). Tile content says nothing about clicking.
- **"At least" (SA-R-10, K-8):** when `payload.truncated` is true, every tile's sub-line reads `at least: the newest {N} only` (N = `formatCount(payload.invites.length)`); otherwise no sub-line. All five, the Stopped halfway tile included, because the server derives that count over the same returned rows (§1.2).
- **K-10:** while the first read is pending, `KpiStrip loading` with `placeholderCount={5}`; while the page shows an error, no strip (a failed Refresh hides the strip and keeps the list, the L-5 precedent; §2.5).
- No overlap is hidden: a stopped-halfway invite is also counted in its state tile (it is still pending, expired or revoked; `inviteFilter.ts:13-14`). Pending + Accepted + Expired + Revoked = the rows read.

### 2.3 Decision: the filter bar without the URL (§5.5, §7.9, D-7 (a))

`InviteFilters.tsx` keeps its name and becomes the page's bar: it renders `AdminFilterBar` with `what="invites"` (Refresh's name "Refresh invites"), `busy`, `readAt`, and, **when the read returned at least one invite**, the four controls as children plus `onClear` / `canClear={isFilterActive(filter)}`.

| Part (§5.5 order) | On Invites |
|---|---|
| 1-2 Window / Custom | **Not shown.** Invites has no date filter today and §7.9 says adding one is a behaviour change. The page's filter compares no date by rule (C-11 guard on `inviteFilter.ts`); a date filter would need a second date rule beside the server's. Not added |
| 3 Business | **Not shown.** Invites are not per business (an invite exists before its account does) |
| 4 Page filters | "Search" (visible label; `type="search"` kept, so the `searchbox` role and the testid stay; placeholder "Search email"; `maxLength 320`; applied as typed, client side, as today), "State", "Invite type", "Issuer" (visible labels; the same options, values and testids). Labels `ADMIN_FIELD_LABEL`, controls `ADMIN_FIELD_CONTROL`, each with `htmlFor` / `useId` |
| 5 Clear | Always rendered while the controls are; disabled at the defaults. Same reset (`EMPTY_INVITE_FILTER`) |
| 6 Read at + Refresh | "Read at HH:mm UTC" of the last successful read (client clock, as Businesses), Refresh on the right |
| 7 Chips | None: every filter is visible in its control |

- **Over an empty list** (zero invites read) and **before the first read** the bar is the Refresh-only plain `<div>`, as every Refresh-only page: there is nothing to filter, and the Invite type options arrive with the payload. This keeps today's "no filter controls over an empty list" behaviour (`page.render :394-399`). **Implementation note (SA M-3):** the bar decides "has controls" when `children` **or `onClear`** (or a window / business) is not `undefined` (`AdminFilterBar.tsx:145-146`). So `children`, `onClear` and `canClear` come from **one conditional object**, all three `undefined` over an empty list and before the first read, never three ternaries that can drift and never a `false` child. Mutation (p2) proves it.
- **State:** `useState<InviteListFilter>` in the page, as today. **No `useAdminFilters`, no `useSearchParams`, no `history.*`, no `router`.** A reload resets the filters (the accepted D-7 (a) consequence).
- **The count** "N of M shown" / "M invites" moves from the bar to the §5.7 count line above the table (`ADMIN_COUNT_LINE`, slate-400 instead of slate-500), same testid and words. Shown whenever at least one invite was read, so a filter that matches nothing still says "0 of 7 shown" above the empty state.
- **Search applies as typed**, not on debounce or Apply: it filters rows already on the page, sends nothing (pinned by `:365-372`). Recorded as a page note, not a deviation (§5.5 "Apply semantics" is about requests).

### 2.4 Decision: status text → `StatusChip` (§5.9)

Each chip keeps its testid; the email chip sits in a wrapper `span` that keeps the `title` (StatusChip takes no `title`, the L-5 pattern). Icons are `aria-hidden` and add no text, so the pinned exact texts (`^Sent$`, "Pending", "Revoked") hold.

| Today | Chip tone | Why |
|---|---|---|
| State Pending (sky) | `info` | Same colour; an open, informational state |
| State Accepted (emerald) | `ok` | Same colour; succeeded (T-6 allows it) |
| State Expired (slate) | `neutral` | Same colour; plain state word |
| State Revoked (rose) | **`neutral`** (recommended, Q-3) | A revoke is a deliberate admin act, not "needs action" or "failed" (§5.9 `danger`). Same reasoning as L-5's INACTIVE ruling. Alternative: keep `danger` |
| Email Not emailed (slate) | `neutral` | Same colour |
| Email Sent (emerald) | `ok` | The provider accepted it |
| Email Sent (not tracked) (pale emerald) | **`info`** (recommended, Q-4) | Not a proven outcome (T-6: one green, only for proven or succeeded); the words and the title say what it is. Alternative: `ok` |
| Email Not sent (rose) | `danger` | Failed |
| Email Unknown (amber) | **`warn`** (recommended, Q-4) | Keeps today's amber "look at this"; §5.9 `unknown` (dashed slate) would quieten a case the admin should check. Alternative: `unknown` |
| Stopped-halfway block title (amber text) | `warn` chip "Signup stopped halfway", the step / code / message / account / date lines unchanged under it | §5.9; the block keeps its testid and every word |
| "Opened by an existing account (date)" (amber text) | Unchanged amber text | A condition with a date, not a status; recorded |

### 2.5 Decision: states and error copy (§5.10)

- **First load:** header, strip placeholders and the Refresh-only bar stay mounted; the content area shows `AdminLoading what="invites"` ("Reading invites…", today's words).
- **Refresh:** the list stays; the content wrapper gets `aria-busy`; Refresh spins.
- **Errors** (through `readAdminResponse(response, { what: 'invites', sessionEndedCopy: true })`; **SA Q-2 / M-2: a status check on the helper's result, never a fork of the helper**):
  - 401 / 403 → the helper's `result.message`, "Your admin session has ended. Sign in again." (RC-4; every migrated page opts in);
  - any other failure, readable or not → a page constant with the §5.10 rule 2 words, **"Could not read invites. Try again in a moment."** The route answers a machine code (`could_not_read_invites`), so §5.10 rule 1 (show the route's string) would put a code on screen; the page shows its own constant instead, the Analytics Q-10 precedent (a recorded page deviation from rule 1). Today's tail "the invites table may not be installed yet" is dropped: it is false now that invite signup is live. The route answering a code instead of user copy is a new §9 F-item (API, open);
  - a rejected `fetch`, in its own `try` → `ADMIN_NETWORK_ERROR` instead of today's raw "Failed to fetch" (§5.10 rules 3 and 4, a forced fix);
  - shown by `AdminError` with `testId="page-error"` and Try again (`load`). A failed Refresh keeps the list on screen under the error (today's choice, kept) and hides the strip (K-10).
- **Empty:** `AdminEmpty` with testid `invite-list-empty` and today's sentences: "No invites yet." or, when a filter is on, "No invites match these filters." plus the "Clear filters" button (§5.10). The test reads `toHaveTextContent` (substring), so the added button text does not break it.
- **Partial:** the truncation note becomes `AdminNotice` (amber, §5.10 Partial) with the same testid on its text and the same words, placed above the table (Q-5).

### 2.6 Decision: header copy

- h1 "Signup Invites" (D-3 (a)); the shell has no title (L-1a).
- Purpose, one sentence (§5.3), keeping the two facts an admin must know: "Business OS signup is invite-only: create an invite for one email address, follow it here, and copy its link when you create it, because it is shown only once." No test pins the purpose text.
- "New invite": same words, same disabling (`!payload || creating`), the purple primary style with `rounded-lg` and the A-1 focus ring (T-7: primary buttons purple).

### 2.7 Decision: what stays as it is

| Item | Why |
|---|---|
| `RevokeDialog` inline under its row; its name and testid `revoke-dialog` | D-8; renaming (F-41) is cosmetic and touches the exact file list and two tests for no user-visible change (Q-8) |
| No drawer | §7.9 lists none, and opening a row in a drawer would move Revoke out of its row, a behaviour change against D-8. The stacked facts stay in the State cell (Q-7) |
| ~~`EnforcementNote` words, tones and place~~ | **Superseded by D-18 (SA M-1):** the note is deleted; the plan-enforcement fact is the header badge (S-1) |
| The stopped-halfway banner (words, `role="status"`, the runbook path, amber) | It is the K-5 (ii) source of the tile's colour; pinned words |
| `CreatedLinkPanel` emerald panel, words, keying by invite id, Copy / Copied, Close | The shown-once contract; pinned |
| `CreateInviteForm` fields, defaults, request body, error map | Pinned request body (`:457-467`) |
| Local `day()` for date-only cells (`YYYY-MM-DD` from the ISO string, UTC) | Already the §5.11 date form. The shared `formatUtcDate` is deferred (C-5); building it here would be a shared export and turn L-6 full cycle (Q-6) |
| The email cell's `font-mono text-xs` and the id spans | Unchanged look of the address; ids already mono |
| Revoke buttons all named "Revoke" | Pinned by two tests (`:576`, `:772`); a row-specific name is a later a11y item (§11) |
| `types.ts`, `inviteFilter.ts` logic and option lists | No behaviour change |

### 2.8 Visible changes on `/admin/business-os-invites` (named in the PR)

1. h1 "Signup Invites" (was "Business OS Signup Invites"); one-sentence purpose.
2. Refresh moves from the header to the filter bar, with "Read at HH:mm UTC".
3. A five-tile strip above the content (not clickable).
4. The filter row has visible labels; Clear is always there (disabled at the defaults); the count moves above the table.
5. The truncation note turns amber (a partial-data notice).
6. The table: standard density and colours, "Email status" header, "(UTC)" on date headers; states and email statuses as chips with icons; Revoked and Sent (not tracked) change colour if SA keeps Q-3 / Q-4 as recommended.
7. Errors: a network failure says "Could not reach the server…"; an ended session says so; any other failure says "Could not read invites. Try again in a moment." (the stale "may not be installed yet" tail is gone); "Try again" in the error box.
8. Empty filtered list: a "Clear filters" button.
9. The yellow note is gone (D-18); a "Plans not enforced" chip (or "Plans enforced") sits beside the title.

### 2.9 Entitlements module

Not touched and not imported. The page names no plan (its guard pins that); the shared folder may not import `lib/business-os/**` (§6.1 S-4). `InviteKpis.tsx` reads state words and counts only. So the `business-os-entitlements` skill is not triggered; `npm run test:bos-entitlements` is not part of this slice's gate (the required CI check runs it regardless).

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

No source change. One test edit: the registry entry (§5).

### 3.2 Page folder (`app/admin/business-os-invites/`)

| File | Change |
|---|---|
| `page.tsx` | Header via `AdminPageHeader` (`actions` = New invite; `badge` from `enforcementMode` once read, M-1, with a GR-5 / D-18 comment). `InviteKpis` under it. `InviteFilters` (the bar) next, always rendered. Content wrapper (`aria-busy` while a read is in flight with data on screen): `AdminError` (when `error`), `AdminLoading` (first read), then, with a payload: the banner, `CreatedLinkPanel`, `CreateInviteForm`, and the list block (h2, count line, `AdminNotice` when truncated, `InviteList`). One `stoppedCount` for the banner and the tile (M-5). `load()` through `readAdminResponse`, a status check, the page constant and `ADMIN_NETWORK_ERROR` (§2.5, M-2); `readAt` on success. Comment block updated (the D-7 (a) paragraph: why no URL). Still `'use client'`; still no logger |
| `components/InviteKpis.tsx` (new) | `countInvites(invites)` and `InviteKpis({ payload, loading })` per §2.2 |
| `components/InviteFilters.tsx` | Becomes the bar (§2.3). No `fetch` (pinned) |
| `components/InviteList.tsx` | Table constants, headers, chips (§2.4), T-5 colours, `AdminEmpty` with an optional `onClear` prop |
| `components/RevokeDialog.tsx` | `readJsonBody` instead of `.json().catch`; focus rings; same words and map |
| `components/CreateInviteForm.tsx` | `readJsonBody`; `text-slate-500` → slate-400 on information text; focus rings on the two buttons; `rounded-lg` shell. Same fields and body |
| `components/CreatedLinkPanel.tsx` | `rounded-xl` shell; A-1 focus rings on Copy and Close. **No new import** (it keeps `react`, `lucide-react`, `../types`) |
| `components/EnforcementNote.tsx` | **Deleted** (D-18, SA M-1) |

### 3.3 Order of placement (Q-1)

Region order holds: header → strip → bar → content. The create form and the shown-once panel stay where they are today, at the top of the content and above the list, so "New invite" opens the form near the header and the new link appears before the list. Moving them above the strip would break the fixed region order; moving them below the list would hide the link on a long list.

### 3.4 Kept identical (so the existing suites need no edit beyond §6.2)

Every testid, the button names ("New invite", "Clear", "Copy", "Copied", "Revoke", "Revoke invite", "Keep it", "Create"), the `searchbox` role, the option lists and values, the fetch URLs and bodies, the panel keying, the count words.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-invites/page.tsx` | modify | Header, strip, bar, states, read helper |
| `app/admin/business-os-invites/components/InviteKpis.tsx` | **create** | The five tiles (§2.2) |
| `app/admin/business-os-invites/components/InviteFilters.tsx` | modify | The bar (§2.3) |
| `app/admin/business-os-invites/components/InviteList.tsx` | modify | Table, chips, empty state |
| `app/admin/business-os-invites/components/RevokeDialog.tsx` | modify | `readJsonBody`, focus rings |
| `app/admin/business-os-invites/components/CreateInviteForm.tsx` | modify | `readJsonBody`, T-5, focus rings |
| `app/admin/business-os-invites/components/CreatedLinkPanel.tsx` | modify | Styling only |
| `app/admin/business-os-invites/components/EnforcementNote.tsx` | **delete** | D-18 (SA M-1): the note's words were false; its live fact is the header badge |
| `app/admin/business-os-invites/__tests__/source.guard.test.ts` | modify | §5 |
| `app/admin/business-os-invites/__tests__/page.render.test.tsx` | modify | §6.2 edits + new cases |
| `app/admin/business-os-invites/__tests__/inviteKpis.test.ts` | **create** | `countInvites` unit cases |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Registry entry + "Amended by L-6" note |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 11, §7.9 as built, §9 F-40 done, Change History |
| `docs/workplans/ADMIN_LAYOUT_L6_WORKPLAN.md` | create | This file |

Not touched: `types.ts`, `inviteFilter.ts` (logic and option lists; Q-9 if SA wants the keys renamed), every route, the sidebar, `components/ui/*`, every shared source file.

---

## 5. Guard and registry changes

All in `app/admin/business-os-invites/__tests__/source.guard.test.ts` unless stated. **Kept exactly:** `ALLOWED_PACKAGES = ['react', 'lucide-react']`; the `LanguageContext`, literal, `console.*`, `any` / `dangerouslySetInnerHTML` rules; **the `localStorage | sessionStorage | document.cookie | history.(push|replace)State` rule, unchanged in text and scope** (SA-R-5); the C-11 date rule and the "no fetch in the filter or its controls" rule; the client-page, no-own-guard, no-admin-decision and layout-first-statement rules; the fetch-target rule (`/api/admin/business-os/invites…`, at least 3).

| # | Edit | Why |
|---|---|---|
| G-1 | Exact file list `:47-61`: add `${ROOT}/components/InviteKpis.tsx` and **remove** `${ROOT}/components/EnforcementNote.tsx` (amended by SA M-1). Nothing else added or removed | The list is exact on purpose; a new file and a deleted file are deliberate edits (§7.9, D-18) |
| G-2 | Lift the inline `escaping` filter (`:65-70`) into a named `escapes(relative, specifier)` with the same body plus **one line first**: `if (specifier.startsWith('@/app/admin/components/layout/')) return false;` (trailing slash, so a look-alike `layoutX` cannot ride it). The `it.each` calls it | SA Q-3, the L-5 shape (SA L-5 Q-8, S-3). Note one difference from Tiers: here a non-relative, non-alias specifier must still be in `ALLOWED_PACKAGES` (`:67`), and that line is kept as it is, so `next/link`, `next/navigation` and `@/lib/...` stay refused |
| G-3 | Negative control: `escapes(page, '@/app/admin/components/layout/StatusChip')` → false; `'@/app/admin/components/AdminHeader'` → true; `'../components/layout/StatusChip'` → true; `'@/app/admin/components/layoutX/Foo'` → true; `'next/navigation'` → true | Proves the alias opens exactly the shared folder and the package list is unchanged |
| G-4 | **SA-R-5 (1), exact filter keys:** import `EMPTY_INVITE_FILTER` from `../inviteFilter` and assert `Object.keys(EMPTY_INVITE_FILTER).sort()` equals `['inviteType', 'issuer', 'query', 'state']`; and a source read of `inviteFilter.ts` asserting the `InviteListFilter` interface body declares exactly those four fields. `query` is the page-held search; `inviteType` is §7.9's "type" (Q-9). A comment says why: a fifth key (a window, a business) would be a filter that is not on the screen today, and the page writes none to the URL | SA-R-5 (1) |
| G-5 | **SA-R-5 (2):** `CreateInviteForm.tsx` and `CreatedLinkPanel.tsx` never mention `useAdminFilters` (code, comments stripped) and import nothing from `@/app/admin/components/layout/useAdminFilters`. Named cases, so a failure says which file | SA-R-5 (2) |
| G-6 | **SA-R-5 (3):** `it.each(allFiles)`: no Invites file mentions `useAdminFilters`, `useSearchParams`, `useRouter` or `next/navigation` (code, comments stripped). The last three are refused by the package rule already; naming them states the intent | SA-R-5 (3) |
| G-7 | **The transitive walker (Q-10, as amended by SA M-4):** (a) starts from every Invites file; (b) follows every relative and `@/` specifier (resolving `.ts`, `.tsx`, `/index.ts`, `/index.tsx`), into **any** folder, transitively, with a visited set; (c) matches multi-line `import … from`, side-effect `import '…'` and `export … from`; (d) skips only **statement-level** `import type` / `export type` (TypeScript erases them; `adminWindow.ts:30` imports `useAdminFilters` as a type only); an inline `{ type X, y }` counts as a value import (over-approximation fails loud, never silent); (e) **fails** on an `@/` or relative specifier it cannot resolve (never skips it); (f) asserts the reached set excludes `useAdminFilters.ts`, and that no reached file's code (comments stripped) contains `history.pushState` / `history.replaceState`, `useSearchParams`, `useRouter`, `next/navigation`, `localStorage`, `sessionStorage` or `document.cookie`; (g) a positive control: the reached set contains `AdminFilterBar.tsx`, `DatePresets.tsx`, `adminWindow.ts` and `readJsonBody.ts`, so an empty walk cannot pass (it also reaches `adminWindowPresets.ts`, outside the shared folder, through `DatePresets.tsx:40` and `adminWindow.ts:22`); (h) a fixture self-test: the specifier extractor sees a multi-line value import, a side-effect import, an `export … from` and an inline-`type` import, and skips a statement-level `import type` / `export type`; the resolver throws on an unresolvable specifier | SA-R-5 says Invites files do not call `history` themselves; this proves no module they pull in does either, so a later shared edit (for example `AdminFilterBar` starting to use the hook) fails here, not in production. Pure file reads inside the Jest gate (no CI time added) |
| G-8 | Header comment: an "Amended by L-6" paragraph naming G-1 to G-7 | Audit trail of the deliberate edits |
| G-9 | `layoutFolder.guard.test.ts` `MIGRATED_PAGES`: add `/admin/business-os-invites (Signup Invites)` with `page.tsx`, `components/InviteKpis.tsx`, `components/InviteFilters.tsx`, `components/InviteList.tsx`, `components/RevokeDialog.tsx`, `components/CreateInviteForm.tsx`, `components/CreatedLinkPanel.tsx` (**not** `EnforcementNote.tsx`: deleted by D-18, SA M-1, so the "lists files that exist" case would fail). `types.ts` and `inviteFilter.ts` are not listed (no markup, no read; the L-5 precedent). Plus the "Amended by L-6" header note; no rule change | Registry: header import, no own h1, no `.json(`, alias only |
| G-10 | `layoutFolder.guard` part (a), `AdminSidebar.nav.test.ts`, the authz surface guard | **No edit** | — |

---

## 6. Tests

### 6.1 New

Fixtures reuse the render suite's invented ids, emails and labels (`fixture-free`, "Fixture Paid", `invite-1`), never real plan ids (the guard's literal rule).

| Id | File | Asserts |
|---|---|---|
| T-1 | `page.render` | Header: exactly one h1, text exactly "Signup Invites" (anchored, so the old "Business OS Signup Invites" fails); "Business OS Signup Invites" appears nowhere; "New invite" and the `enforcement-mode-badge` sit inside the `<header>` (M-1); Refresh does not; no badge while the first read is pending |
| T-2 | `page.render` | Strip over the Slice 1c fixture (7 rows: 3 pending, 1 accepted, 2 expired, 1 revoked, `stoppedHalfway.count` 1): `kpi-pending` "3", `kpi-accepted` "1", `kpi-stopped-halfway` "1", `kpi-expired` "2", `kpi-revoked` "1", in that document order; every tile is `role="group"`, has no `href` and no link or button inside; names "Pending, 3" and "Stopped halfway, 1, needs a look" |
| T-3 | `page.render` | Colour: `kpi-stopped-halfway` `data-status="amber"` when the count is ≥ 1 and `neutral` at 0 and when an older server sends no summary; the other four always `neutral` |
| T-4 | `page.render` | "At least": with `truncated: true`, the exact sub-line text "at least: the newest 7 only" on one tile and its presence on all five (SA S-4: a wording change is one edit); with `truncated: false` or absent, none has a sub-line |
| T-5 | `page.render` | Live counts: after a create, `kpi-pending` goes from 1 to 2 with no new GET; after a revoke, `kpi-pending` 0 and `kpi-revoked` 1 |
| T-6 | `page.render` | K-10: while the first GET is pending, 5 `kpi-placeholder`s, the Refresh button and "Reading invites…"; on a first-load error, no strip, no placeholders |
| T-7 | `page.render` | States (M-2): a rejected `fetch` → `page-error` text exactly `ADMIN_NETWORK_ERROR`, and "Failed to fetch" appears nowhere; a 401 and a 403 → exactly the session-ended sentence; a 500 with `could_not_read_invites` and a body whose `json()` throws → exactly "Could not read invites. Try again in a moment.", and `could_not_read_invites`, "installed yet" and "Unexpected token" appear nowhere; "Try again" re-reads (2 GETs) and renders the list |
| T-8 | `page.render` | Refresh: named "Refresh invites", inside `role="search"` once invites exist; while a second read is pending it has `aria-busy="true"`, the list stays and the content wrapper has `aria-busy="true"`; a failed Refresh shows `page-error`, keeps `invite-row-invite-1` on screen and hides the strip; "Read at" appears after the first read |
| T-9 | `page.render` | Bar: the labels "Search", "State", "Invite type", "Issuer" are visible and each names its control (`getByLabelText`); Clear is rendered and **disabled** at the defaults, enabled after one change, and disabled again after a click; the bar order in the DOM is Search, State, Invite type, Issuer, Clear, Refresh |
| T-10 | `page.render` | **No URL write and no storage, at runtime:** spy on `window.history.pushState` and `replaceState`, type a search, change all three selects, click Clear, click Refresh, a failed Refresh and Try again (SA S-2), create an invite: neither spy is called and `window.location.href` (SA S-2), `search` and `hash` are identical before and after the whole sequence; `sessionStorage` and `localStorage` stay empty; the created link appears in no attribute of any element except the panel's `code` text |
| T-11 | `page.render` | Table: `getByRole('table', { name: 'Invites' })`; column headers in order "Email", "Plan", "Access", "Invited by", "Created (UTC)", "Link expires (UTC)", "State", "Email status", "First opened (UTC)", "Actions" (sr-only), **all unique**; every `th` has `scope="col"` |
| T-12 | `page.render` | Chips: `invite-state` `data-tone` per state (`info`, `ok`, `neutral`, and Revoked per Q-3), each with an `svg` except `neutral`; `invite-email-status` tones per §2.4 (Q-4) with the wrapper keeping the `title`; the stopped-halfway block holds a `warn` chip "Signup stopped halfway" and still every pinned line |
| T-13 | `page.render` | Empty: a filter that matches nothing shows "No invites match these filters." with a "Clear filters" button that restores all 7 rows; zero invites shows "No invites yet." with no "Clear filters" |
| T-14 | `page.render` | Order: header, strip, bar, then the content in this order: banner, created panel, form, list (document positions; the note is gone, M-1) |
| T-15 | `inviteKpis.test.ts` | `countInvites`: one row per state; an empty list; a row both pending and stopped halfway counts once in Pending; unknown state words are not counted (defensive; the row typed with `as unknown as InviteState`, never `any`, SA S-3) |
| T-17 | `page.render` | Badge modes (M-1): `enforce` → "Plans enforced"; `shadow` and `off` → "Plans not enforced"; no badge on a first-load error |
| T-16 | `source.guard` | G-3, G-4, G-5, G-6, G-7 and its self-test (§5) |

### 6.2 Edited deliberately (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `page.render :115-119` "is headed 'Business OS Signup Invites' (Slice 1a label)" | → "is headed 'Signup Invites', the sidebar label (D-3 (a))", asserting the h1 text **exactly** (an anchored match). A plain `toHaveTextContent('Signup Invites')` would also pass on the old title, so it would pin nothing | D-3 (a) |
| `page.render :233-242` "loads the invites … and the enforcement note" | → "… and the plan-enforcement badge" (SA M-1): the badge reads "Plans not enforced" for the fixture's mode, the `enforcement-note` testid is absent, and "internal demos only", "real invitees" and "not built yet" appear nowhere in `document.body`; plus the T-17 mode cases | D-18 |
| `page.render :244-253` "says so when there are no invites, and shows an error when the read fails" | No edit: it asserts only `page-error` presence | — |
| `page.render :394-399` "shows no filter controls over an empty list" | `queryByTestId('invite-filters')` → `queryByRole('search', { name: 'Filters' })` is absent, `queryByRole('searchbox')` is absent (SA Q-11) **and** `getByRole('button', { name: 'Refresh invites' })` is present. The testid `invite-filters` lived on the old filter row; the shared bar takes no testid (adding one is a shared export). Q-11 offers the alternative that needs no test edit | The bar is shared now; the pinned behaviour (no controls with nothing to filter) is kept |
| `source.guard` | G-1 to G-8 | §5 |
| `layoutFolder.guard` | G-9 | §5 |
| `page.render` | T-1 to T-14 appended | §6.1 |

### 6.3 Must stay green with no edit

Every other case in `page.render`, including: the filter combinations, "never sends the search or the filters to the server", the 500-ceiling note, the stopped-halfway banner and badges, "after a create, shows the link once…", "a second invite gets a fresh panel…", **"after a reload the link is gone"**, the server's refusal in plain words, both revoke cases, every Slice 2a and Slice 5a case. Every other `source.guard` case. `AdminSidebar.nav.test.ts`. `app/api/admin/business-os/invites/__tests__/*` (route untouched). Every shared-folder suite. `app/admin/__tests__/**` (the admin authz surface guard).

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-1 | `npx jest app/admin/business-os-invites app/admin/components/layout app/admin/components/__tests__ app/admin/__tests__ app/api/admin/business-os/invites --ci` | All green; counts recorded |
| V-2 | Scoped `tsc -p` on a scratch tsconfig **in the session scratchpad** (never committed; `extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/business-os-invites/**`, `app/admin/components/layout/**`, `app/admin/components/adminWindowPresets.ts`; `--listFilesOnly` first to confirm every Invites file and test is in scope). **Run 1** with a scratch-only `canary.ts` (`const canary: number = 'x';`) → exit 2 and exactly that TS2322. **Run 2** without it → exit 0, no output | Both runs recorded |
| V-3 | `npm run lint:hooks`; `npx eslint` on the touched files | Clean |
| V-4 | Mutation checks (each reverted; the file's md5 compared before and after): (a) drop the alias line → `source.guard` fails on `page.tsx`; (b) add `window.history.replaceState(null, '', '?state=revoked')` in the State `onChange` → the history rule and T-10 fail; (c) `import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters'` in `CreatedLinkPanel.tsx` → G-5 and G-6 fail (named for that file); (d) the same import in `page.tsx` → G-6 fails; (e) in `adminWindow.ts`, turn `import type { AdminFilterField }` into a value import → G-7 fails (proves the transitive walk; the file is reverted at once, it is shared code); (f) add `range: 'all'` to `EMPTY_INVITE_FILTER` and the interface → G-4 fails; (g) write the created link to `sessionStorage` in `CreatedLinkPanel.tsx` → the storage rule, T-10 and "after a reload the link is gone" checks fail; (h) give a tile `href="#pending"` → T-2 fails; (i) `status: 'amber'` on the Stopped halfway tile at 0 → T-3 fails; (j) drop the `truncated` sub-line → T-4 fails; (k) put back `<h1>Business OS Signup Invites` → T-1, the edited h1 case and the registry h1 rule fail; (l) `.json()` back in `RevokeDialog.tsx` → the registry `.json(` rule fails; (m) `sessionEndedCopy: false` → T-7 fails; (n) show `result.message` instead of the fixed sentence on a 500 → T-7 fails (the code reaches the screen); (o) rename the second header back to "Email" → T-11 fails; (p) pass `{showControls && fields}` (a `false` child) to the bar → the edited empty-list case fails; (p2) pass `onClear` while the list is empty → the edited empty-list case fails (M-3); (q) add a fetch to a non-invites URL in `InviteKpis.tsx` → the fetch-target rule fails; (r) render the old note sentence anywhere → the rewritten badge case fails (M-1); (s) map `shadow` to "Plans enforced" → the mode case fails (M-1) | Each fails as stated |
| V-5 | `grep` the folder for `.json(`, `err.message`, `text-slate-500`, `useAdminFilters`, `history.`, `useSearchParams`, `EnforcementNote`, `internal demos`, `real invitees`, `installed yet` (M-1) | None in code (comments that explain the ban may name it; the guards strip comments) |
| V-6 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions match the plan; no file emptied |

### 7.1 Browser checks for TL / QA (signed-in admin, DevTools Network open, light and dark OS scheme emulation)

**Never create or revoke an invite in production.** The local dev server reads the production database, so these checks only read, filter and open the form, then Cancel. Create, copy-once and revoke are covered by the Jest flows above (T-5, T-10 and the pinned create / revoke cases).

| # | Check |
|---|---|
| I-B1 | `/admin/business-os-invites` loads with one `GET /api/admin/business-os/invites`; header "Signup Invites", the purpose, "New invite" on the right; no shell title; no Refresh in the header |
| I-B2 | Five tiles in the order Pending, Accepted, Stopped halfway, Expired, Revoked; the four state tiles add up to the rows read; Stopped halfway equals the banner's number, amber with "Needs a look" only when the banner shows; no tile looks or behaves clickable (no pointer, no focus stop, no hover) |
| I-B3 | Filter bar: visible labels, the same options; each change filters instantly and **adds no request in the Network panel** and **does not change the address bar**; Clear disabled at the defaults, enabled after a change |
| I-B4 | Refresh: spinner, `aria-busy`, the list stays, one new GET, "Read at" updates; the address bar unchanged |
| I-B5 | Reload with a filter set: the filters return to their defaults (D-7 (a)) |
| I-B6 | Table: "Email status" header, "(UTC)" on the dates, chips with icons and the same words; the stopped-halfway block and "Opened by an existing account" lines unchanged; wide table scrolls inside its frame |
| I-B7 | "New invite" opens the form between the banner and the list; Tab order header → bar → content; **Cancel** closes it. Do not submit |
| I-B8 | Revoke on a pending row opens the inline form under the row; **Keep it** closes it. Do not submit |
| I-B9 | Offline (DevTools) then Refresh: "Could not reach the server…" with Try again; the list stays; the strip hides; back online + Try again restores it |
| I-B10 | Search for a string that matches nothing: "No invites match these filters." with Clear filters; the count line reads "0 of N shown" |
| I-B11 | Light and dark emulation: the page looks the same (A-8) |
| I-B12 | The chip beside the title reads "Plans not enforced" (production runs `shadow`); no yellow note anywhere (M-1, D-18) |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding ✅ (M-1 to M-5, S-1 to S-4 applied 2026-10-12)
- [x] 2. `source.guard`: G-1 to G-8 (G-7 as amended by M-4); run it red-then-green against a scratch mutation ✅
- [x] 3. `InviteKpis.tsx` + `inviteKpis.test.ts` (T-15) ✅
- [x] 4. `InviteFilters.tsx` as the bar; the edited empty-list case; T-9 ✅
- [x] 5. `page.tsx`: header, strip, bar, states, read helper, order; the edited h1 case; T-1 to T-8, T-10, T-14 ✅
- [x] 6. `InviteList.tsx`: table, chips, empty; T-11 to T-13 ✅
- [x] 7. `RevokeDialog.tsx`, `CreateInviteForm.tsx`, `CreatedLinkPanel.tsx`: helpers and styling; **delete `EnforcementNote.tsx`** and add the header badge (D-18, M-1) ✅
- [x] 8. `MIGRATED_PAGES` entry (G-9) ✅
- [x] 9. V-1 to V-6; record real output in Implementation Notes ✅
- [x] 10. Requirement: §1 row 11, §7.9 as built (with SA's rulings), §9 F-40 done (F-41 / F-42 dispositions as ruled), Change History ✅ (plus new F-109, F-110; count 108)
- [ ] 11. Hand to SA code review + QA (nothing committed by Dev) — handed back to TL 2026-10-12

---

## 9. Sizing

| Part | Days |
|---|---|
| Guard edits incl. the transitive walk (steps 2, 8) | 0.4 |
| Strip, bar, page (steps 3-5) | 0.6 |
| Table and chips (step 6) | 0.3 |
| Form, panel, revoke (step 7) | 0.15 |
| Tests (T-1 to T-16) | 0.5 |
| Verification and docs (steps 9-10) | 0.25 |
| **Total** | **about 2 to 2.5 days** |

One slice; under the "a few days" limit, no split.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A shared file the page imports starts to write the URL later, and the link guarantee is lost silently | G-7 walks the value imports into the shared folder; mutation (e) proves it bites |
| Passing `false` as the bar's children turns the empty-list bar into a filter bar | `children` passed as `undefined` (§2.3); mutation (p) |
| `readAdminResponse` rule 1 puts the route's machine code on screen | The page shows its own fixed sentence for every non-session failure (§2.5); T-7 and mutation (n) |
| A tile label collides with a pinned query (for example "Revoked", "Pending") | Every pinned state query is scoped `within(list)` or by testid; the tiles use `kpi-*` testids (never `invite-stopped-halfway`); V-1 |
| The icon inside a chip changes a pinned exact text (`^Sent$`) | Icons are `aria-hidden` SVGs and add no text (StatusChip comment); the email-status case stays unedited |
| Clear disables itself on click and focus falls to the body (F-104, shared) | Known and recorded; not fixed here (shared behaviour, its own check) |
| The h1 edit still passes on the old title | The edited case asserts the exact text; mutation (k) |
| A browser check creates or revokes a real invite | §7.1 forbids it; the steps stop at Cancel / Keep it |

---

## 11. Out of scope and found on the way

- **F-41** (`RevokeDialog` is a form, not a dialog): not renamed (Q-8); stays open.
- **F-42** (`EnforcementNote` copy likely stale): answered by the user (D-18, "Remove the note"); done in L-6 (SA M-1: note deleted, the plan-enforcement fact kept as the header badge).
- **F-109 (new, SA M-2):** the invites GET answers a machine code (`could_not_read_invites`) where CLAUDE.md's error format asks for user-facing copy. Open, API, a separate slice (no API change in L-6).
- **F-104** (Clear loses focus on click): shared, open.
- **Found:** today's error sentence ends "the invites table may not be installed yet", which is stale now that invite signup is live. Dropped in L-6 (SA Q-2 / M-2: the §5.10 rule 2 words instead).
- **Found:** every Revoke button in the list has the same name "Revoke", so a screen-reader user hears no row; a row-specific name needs two pinned tests edited. Recorded in §9 as F-110 (a11y, open).
- **Found:** a rejected list read showed "Failed to fetch" (fixed here, §2.5, forced by §5.10).

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Placement of the create form and the shown-once panel: at the top of the content (today's place, below the strip and the bar), or directly under the header? | Top of the content (§3.3). The region order stays fixed, the form stays above the list, and nothing about the link changes |
| Q-2 | Error copy: (a) keep today's fixed sentence for every non-session failure, because the route answers a machine code, plus session-ended for 401 / 403 and the network sentence for a rejected fetch; (b) the standard fallback "Could not read invites. Try again in a moment." instead of today's sentence | **(a)**, a recorded deviation from §5.10 rule 1 (the Analytics Q-10 precedent). The stale tail of the sentence is a copy question, listed in §11 |
| Q-3 | Revoked chip tone: `neutral` (recommended) or keep red as `danger`? | `neutral`: a revoke is an admin's decision, not a failure (same reasoning as the L-5 INACTIVE ruling); the words carry it |
| Q-4 | Email status tones: Sent (not tracked) `info` (not `ok`); Unknown `warn` (not `unknown`)? | Yes to both: one green only for a proven outcome; Unknown keeps today's amber prompt to check |
| Q-5 | The truncation note becomes the amber `AdminNotice` (§5.10 Partial), same words and testid? | Yes; it is exactly the partial-data case, and the tiles' "at least" points to it |
| Q-6 | Dates: keep the local `day()` (date-only `YYYY-MM-DD`, UTC) with "(UTC)" in the headers, or build the deferred shared `formatUtcDate` here (Invites is the first date-only page, C-5), which makes L-6 full cycle? | Keep `day()`. It already prints the §5.11 date form; building a one-line shared export is not worth a full cycle. `formatUtcDate` stays deferred, recorded in §1 |
| Q-7 | No drawer (§5.8 D-1 would open a detailed row in a drawer)? | No drawer in L-6: §7.9 lists none, and a drawer moves Revoke out of the row (D-8). Recorded deviation from §12.3's drawer item |
| Q-8 | F-41: rename `RevokeDialog` to `RevokeForm`? | No. Cosmetic; it moves the exact file list and the import for no visible change. F-41 stays open |
| Q-9 | SA-R-5 (1) names the keys `state`, `type`, `issuer` + search; the code's keys are `state`, `inviteType`, `issuer`, `query`. Pin the code's names (recommended), or rename the keys? | Pin the code's names. A rename is churn in a pure helper and its tests with no behaviour change; G-4's comment maps the two spellings |
| Q-10 | Add G-7 (the transitive walk into the shared folder) beyond SA-R-5's three assertions? | Yes. SA-R-5 relies on "the hook does it, Invites files do not": G-7 is what makes that true for every shared file Invites pulls in, now and after later shared edits. Pure file reads inside the Jest gate (S-10) |
| Q-11 | The empty-list case: edit the test to the bar's role (recommended), or keep the testid `invite-filters` on a `display: contents` wrapper around the four fields so the test needs no edit? | Edit the test. A layout-neutral wrapper just to keep a testid is a trick; the role assertion pins the same behaviour and adds the Refresh check |
| Q-12 | Path: UI short path under the user's fast-track (no shared export)? | Yes, unless Q-6 is ruled to build `formatUtcDate` |

---

## 13. Product question for the user

**The yellow note at the top of Signup Invites still says invite links are "for internal demos only" and "do not send them to real invitees", because signup from an invite "is not built yet".** Signup from an invite is now live and friend invites are on, so the note probably tells admins the opposite of what is true. Do you want the note's words updated (or the note removed), or left as they are? This redesign leaves the words exactly as they are unless you say otherwise; changing them is a small separate change.

**Answered (user, 2026-10-12): "Remove the note."** Recorded as **D-18** in requirement §10 and as the §9 F-42 disposition (std L-6). The note is removed in this slice; SA M-1 below rules what survives (the live plan-enforcement fact, as the header badge) and lists the deliberate edits. This supersedes §2.7's `EnforcementNote` row, §3.2's and §4's `EnforcementNote.tsx` rows, §11's F-42 line and the "unchanged in words" cell in §1.1.

---

## Implementation Notes

**Dev, 2026-10-12.** Branch `feature/admin-layout-l6` (worktree `neuronforge-admin-layout`, at origin/main `4d383105`). Nothing committed, nothing staged; the one deletion (`EnforcementNote.tsx`) is the planned D-18 deletion.

### What was built

| File | Change |
|---|---|
| `page.tsx` | `AdminPageHeader` (h1 "Signup Invites", one-sentence purpose, "New invite" in `actions`, the `enforcement-mode-badge` from `ENFORCEMENT_BADGE[payload.enforcementMode]` once read, no fallback; GR-5 / D-18 comment); `InviteKpis`; `InviteFilters` (the bar); content wrapper `invites-content` with `aria-busy` while a read runs over data; `AdminError` (`page-error`, Try again), `AdminLoading` ("Reading invites…"); banner, created panel, form, list block (h2, count line on `ADMIN_COUNT_LINE`, `AdminNotice` for truncation, `InviteList`). One `stoppedCount` (M-5). `load()`: fetch in its own `try` → `ADMIN_NETWORK_ERROR`; `readAdminResponse` with `sessionEndedCopy: true`; status check on the result: 401 / 403 → `result.message`, anything else → `INVITES_READ_FAILED` (M-2); `readAt` on success |
| `components/InviteKpis.tsx` (new) | `countInvites()` and the five no-target tiles; Stopped halfway `amber` when `stoppedCount >= 1`; sub-line `at least: the newest N only` on all five when `truncated` |
| `components/InviteFilters.tsx` | Renders `AdminFilterBar` (`what="invites"`, busy, readAt, Refresh); the four controls with visible labels (`useId`, `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`), testids kept; `children`, `onClear`, `canClear` from one conditional object, all `undefined` with no invites (M-3). No `fetch`, no URL hook |
| `components/InviteList.tsx` | `adminTable` constants, `aria-label="Invites"`, `scope="col"`, "Email status", "(UTC)" date headers, sr-only "Actions"; state and email status as `StatusChip`s (Q-3, Q-4 tones), the email chip in a `title` wrapper; the stopped-halfway block title as a `warn` chip; `text-slate-500` → slate-400; `AdminEmpty` with `onClearFilters`; Revoke button A-1 focus ring |
| `components/RevokeDialog.tsx`, `components/CreateInviteForm.tsx` | `readJsonBody` instead of `.json().catch`; same truthiness check (`!response.ok || !body || !body.success`), same maps; `rounded-lg` / `rounded-xl`, A-1 focus rings; T-5 colours on the form |
| `components/CreatedLinkPanel.tsx` | `rounded-xl`, A-1 focus rings on Copy and Close via a local constant. No new import |
| `components/EnforcementNote.tsx` | **Deleted** (D-18, M-1) |
| `__tests__/source.guard.test.ts` | G-1 to G-8 (G-7 as M-4: transitive value-import walker into any folder, visited set, multi-line / side-effect / `export … from` / dynamic `import()`, statement-level `import type` / `export type` skipped, inline `type` counted, throws on an unresolvable `@/` or relative specifier, `useAdminFilters.ts` banned from the reached set, the URL / storage ban on every reached file, positive control incl. `AdminFilterBar`, `DatePresets`, `adminWindow`, `readJsonBody`, `adminWindowPresets`, fixture self-tests) |
| `__tests__/page.render.test.tsx` | Three deliberate edits (below) + T-1 to T-14 and T-17 |
| `__tests__/inviteKpis.test.ts` (new) | T-15 (the unknown-state row typed `as unknown as InviteState`, S-3) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | G-9: the Signup Invites registry entry (7 files, no `EnforcementNote.tsx`) and the "Amended by L-6" note. No rule change |

G-7 reaches 21 files today: the 9 Invites files, `adminWindowPresets.ts` and 11 shared files (`AdminFilterBar`, `AdminPageHeader`, `AdminStates`, `DatePresets`, `KpiStrip`, `StatusChip`, `adminFormat`, `adminTable`, `adminWindow`, `readAdminResponse`, `readJsonBody`). `useAdminFilters.ts` is not reached (`adminWindow.ts:30` is a statement-level `import type`).

### Tests edited deliberately (each to be named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `page.render` "is headed 'Business OS Signup Invites' (Slice 1a label)" | → "is headed 'Signup Invites', the sidebar label (D-3 (a))", asserting the h1 `textContent` exactly | D-3 (a); a substring match would pass on the old title |
| `page.render` "loads the invites with their state, and the enforcement note" | → "… and the plan-enforcement badge": badge text exactly "Plans not enforced", `enforcement-note` absent, "internal demos only" / "real invitees" / "not built yet" nowhere in `document.body`; plus the T-17 `it.each` (enforce, shadow, off) | D-18, SA M-1 |
| `page.render` "shows no filter controls over an empty list" | `queryByTestId('invite-filters')` → no `search` named "Filters", no `searchbox`, no "Clear" button, and "Refresh invites" present | SA Q-11; the shared bar takes no testid |
| `source.guard` exact file list | + `components/InviteKpis.tsx`, − `components/EnforcementNote.tsx` | G-1 as amended by M-1 |
| `source.guard` import rule | Lifted into `escapes()` with the alias line first; the test title names the shared folder | G-2 (SA Q-3) |
| `layoutFolder.guard` `MIGRATED_PAGES` | + Signup Invites | G-9 |

### Verification (real output)

| # | Result |
|---|---|
| V-1 | `npx jest app/admin/business-os-invites app/admin/components/layout app/admin/components/__tests__ app/admin/__tests__ app/api/admin/business-os/invites lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` → **Test Suites: 39 passed, 39 total; Tests: 1225 passed, 1225 total** (59.4 s). Invites alone: 3 suites, 182 tests (`page.render` 76, `source.guard` 101, `inviteKpis` 5). No act() or console warnings from the Invites suites |
| V-2 | Scoped `tsc -p` on a scratch tsconfig in the session scratchpad (extends the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/business-os-invites/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`). `--listFilesOnly` listed every Invites source and test file. **Run 1** with a scratch-only `canary.ts` (`const canary: number = 'x';`): exit 2, exactly one error, `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Run 2** with the canary removed: exit 0, no output |
| V-3 | `npm run lint:hooks`: clean (`--max-warnings 0`). `npx eslint` on the 11 touched source and test files: exit 0, no output |
| V-4 | All 21 mutations red, each restored with md5 equal (below) |
| V-5 | `grep` of the Invites source (tests excluded) for `.json(`, `err.message`, `text-slate-500`, `useAdminFilters`, `history.`, `useSearchParams`, `EnforcementNote`, `internal demos`, `real invitees`, `installed yet`: **no match for any** |
| V-6 | `git diff --stat`: 11 tracked files, 1165 insertions, 359 deletions; the only deletion-only file is `EnforcementNote.tsx` (−47, planned); no file emptied. Untracked: `InviteKpis.tsx`, `inviteKpis.test.ts`, this workplan. `types.ts`, `inviteFilter.ts`, every shared source file and every route unchanged |

**Mutations** (a scratchpad runner applied each, ran the named suites, restored the original bytes in a `finally`, and compared md5; every one: exit 1, md5 equal):

| # | Mutation | Failed |
|---|---|---|
| (a) | drop the alias line in `escapes()` | 7: the import rule on `page.tsx`, `InviteKpis`, `InviteFilters`, `InviteList`, `RevokeDialog`, `CreateInviteForm`, and G-3 |
| (b) | `window.history.replaceState` in the State `onChange` | 3: the storage / history rule on `InviteFilters.tsx`, G-7 on `InviteFilters.tsx`, T-10 |
| (c) | import `useAdminFilters` in `CreatedLinkPanel.tsx` | 4: G-5 and G-6 (named for that file), G-7 "never reaches the URL hook" and G-7 on `useAdminFilters.ts` |
| (d) | the same import in `page.tsx` | 3: G-6 on `page.tsx`, both G-7 cases |
| (e) | `adminWindow.ts` `import type` → value import (shared file, restored at once) | 2: both G-7 cases |
| (f) | `range` in `EMPTY_INVITE_FILTER` and the interface | 2: both G-4 cases |
| (g) | `sessionStorage.setItem` of the link in `CreatedLinkPanel.tsx` | 3: the storage rule, G-7 on that file, T-10 |
| (h) | `href="#pending"` on the Pending tile | 1: T-2 |
| (i) | Stopped halfway amber at 0 | 2: T-3 "none" and "no summary" |
| (j) | drop the `truncated` sub-line | 1: T-4 |
| (k) | an own `<h1>Business OS Signup Invites</h1>` before the header | 3: T-1, the edited h1 case, the registry "no own <h1" rule on `page.tsx` |
| (l) | `.json()` back in `RevokeDialog.tsx` | 1: the registry `.json(` rule on `RevokeDialog.tsx` |
| (m) | `sessionEndedCopy: false` | 2: T-7 401 and 403 |
| (n) | `result.message` for every failure | 1: T-7 "a 500 with the route code, or a reply that is not JSON" |
| (o) | second header back to "Email" | 1: T-11 |
| (p) | `children: false` in the empty branch | 1: the edited empty-list case |
| (p2) | `onClear` passed in the empty branch (M-3) | 1: the edited empty-list case |
| (q) | `fetch('/api/admin/other')` in `InviteKpis.tsx` | 1: "writes only to its own two admin routes" |
| (r) | the old note sentence rendered in the content | 1: the rewritten badge case |
| (s) | `shadow` → "Plans enforced" | 1: T-17 shadow |

### Deviations from this workplan

- **Mutation (g):** the workplan expected "after a reload the link is gone" to fail too. It does not, and cannot: a write the page never reads back leaves nothing on screen after a remount. The write is caught by the storage rule, G-7 and T-10 (`sessionStorage.length` stays 0), which is the guarantee that matters.
- **T-3 title:** first run interpolated the wrong tuple element into the test name; the tuple order was fixed (no assertion change) and mutation (i) re-run red.
- **G-7 also follows dynamic `import('…')`** (over-approximation, not in M-4's list; fails loud, never silent).
- **G-7's positive control also asserts `adminWindowPresets.ts`** is reached (proves the walk leaves the shared folder, M-4 (b)).
- **The empty-list edit also asserts no "Clear" button** (an extra line beside Q-11's searchbox assertion).
- **Section `<section className="space-y-3">`**: the list block keeps its unnamed `<section>` (not a landmark), spacing moved from `mb-3` on children to the section.
- **Line endings:** the worktree checks these files out with CRLF (`core.autocrlf=true`; the index is LF). Fully rewritten and new Invites files were normalised to CRLF to match their neighbours; Git stores LF either way. The workplan, requirement and `layoutFolder.guard` stay LF as found.

### User-visible changes (for the PR)

1. h1 "Signup Invites" (was "Business OS Signup Invites"); one-sentence purpose; "New invite" on the right of the header.
2. The yellow note is gone (D-18); a "Plans not enforced" chip ("Plans enforced" when enforcing) beside the title.
3. Five KPI tiles: Pending, Accepted, Stopped halfway (amber "Needs a look" when at least 1), Expired, Revoked. Not clickable.
4. Refresh moves into the filter bar with "Read at HH:mm UTC"; the bar shows visible labels Search, State, Invite type, Issuer and a Clear that is always there (disabled at the defaults). Over an empty list it is Refresh only.
5. The "N of M shown" / "M invites" count sits above the table.
6. The truncation note is amber.
7. Table: standard density, "Email status" header, "(UTC)" on the dates; states and email statuses as chips with icons; Revoked is now slate (was red), Sent (not tracked) is sky (was pale green), Unknown stays amber.
8. Errors: offline says "Could not reach the server. Check your connection and try again."; an ended session says so; any other failure says "Could not read invites. Try again in a moment."; "Try again" in the error box. A failed Refresh keeps the list and hides the tiles.
9. An empty filtered list offers "Clear filters".

No route, request body, payload, permission or write changed. Filters are still never written to the URL, history or storage; a reload resets them.

### QA-1 + SF-1/SF-2 (folded in before commit, TL decision 2026-10-12)

| Item | Fix | Test | Mutation |
|---|---|---|---|
| QA-1 (Low, QA) | `page.tsx`: the badge label is read only when `Object.hasOwn(ENFORCEMENT_BADGE, payload.enforcementMode)`; any other mode (including `__proto__`, `constructor`, `toString`) shows no badge. Before, a plain lookup returned `Object.prototype` or a function | `page.render` “L-6 QA-1: an unknown enforcement mode %s shows no badge and the page still renders” (`__proto__`, `constructor`, `toString`; the h1 renders, no `enforcement-mode-badge`) | (t) back to the plain lookup: 3 failed (the three QA-1 cases), md5 equal |
| SF-1 (Low, SA) | `source.guard` `FROM_STATEMENT`: the statement body is `(?:(?!` word-boundary `import`/`export` word-boundary `)[^'";])*?`, so a statement also ends at the next `import` / `export` keyword | Extractor self-test gains `export type A = B` (no semicolon) followed by `import { e } from './afterTypeAlias';`, which must come out as a value import | (u) back to the old body: 1 failed (the extractor self-test), md5 equal |
| SF-2 (Low, SA) | `source.guard` `UNWALKABLE_IMPORT`: every reached file fails on `require(` or on an `import(` whose argument is not one plain string literal | `it.each` over the reached files, plus a self-test (`require` with a literal or a name, `import(name)`, a template literal and a concatenation caught; `import('./x')`, `import("./x")` and `typeof import('./x')` not caught) | (v) `require('./InviteList')` in `InviteKpis.tsx`: 1 failed (that file); (w) `import(name)` in the shared `adminTable.ts`: 1 failed (that file); both md5 equal, `adminTable.ts` unchanged in `git status` |

**Re-verification:**
- `npx jest app/admin/business-os-invites app/admin/components/layout --ci`: **Test Suites: 19 passed, 19 total; Tests: 710 passed, 710 total**. Invites: `page.render` 79, `source.guard` 123, `inviteKpis` 5.
- `npx eslint` on `page.tsx`, `page.render.test.tsx`, `source.guard.test.ts`: exit 0. `npm run lint:hooks`: clean.
- Scoped `tsc` (the same scratch tsconfig): canary run exit 2 with exactly `canary.ts(1,7): error TS2322`; clean run exit 0, no output.
- Line endings preserved (the three edited files stay CRLF throughout). No QA probe file in `git status`.

### Found, not fixed (out of scope)

- F-109 (route answers a machine code, SA M-2) and F-110 (every Revoke button named "Revoke") recorded in requirement §9.
- F-41 (`RevokeDialog` is a form) and F-104 (Clear loses focus on click, shared) stay open.

## SA Review Notes

The workplan review is the next section. Code review to follow.

## SA Workplan Review — 2026-10-12

**Reviewed by SA — 2026-10-12** (code verified at `62fafda0`: page, six components, both suites, `AdminPageHeader`, `KpiStrip`, `AdminFilterBar`, `AdminStates`, `StatusChip`, `readAdminResponse`, `adminWindow`, `DatePresets`, the route's error body, the invite-signup GR-5 and the Slice 0 workplan)
**Status:** APPROVED WITH CONDITIONS — apply M-1 to M-5 to this file before coding. No escalation; no open product question.

### Rulings on Q-1 to Q-12

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Approved: top of the content**, under header, strip and bar | Keeps the fixed region order; the shown-once link stays above a long list; no behaviour change |
| Q-2 | **Status check on the helper's result (never a fork of it), and drop the stale tail.** 401 / 403 → `result.message` (session ended, `sessionEndedCopy: true`); any other failure → a page constant with the §5.10 rule 2 words, "Could not read invites. Try again in a moment."; a rejected `fetch` (its own `try`) → `ADMIN_NETWORK_ERROR`. Recorded page deviation from §5.10 rule 1 (Analytics Q-10 precedent) | The route answers a machine code (`could_not_read_invites`, route `:97`, `:126`), so rule 1 would print a code. Today's tail "the invites table may not be installed yet" is false now that invite signup is live: the same class of stale words the user removed in D-18. Rule 2 is the standard's own fallback, so this is no new copy. The route returning a code instead of user copy is an API defect outside L-6 (no API change): Dev records it as a new §9 F-item |
| Q-3 | **Approved: Revoked → `neutral`** | A deliberate admin act, not a failure; same as the L-5 INACTIVE ruling |
| Q-4 | **Approved: Sent (not tracked) → `info`; Unknown → `warn`** | T-6 keeps one green for a proven outcome; Unknown keeps today's amber prompt |
| Q-5 | **Approved: amber `AdminNotice`**, same words and testid, above the table | Exactly the §5.10 Partial case, and the tiles' "at least" points to it |
| Q-6 | **Approved: keep the local `day()`**; `formatUtcDate` stays deferred, recorded in §1 row 11 | It already prints the §5.11 date form; building a one-line shared export would force a full cycle for no visible gain |
| Q-7 | **Approved: no drawer** (recorded deviation from §12.3's drawer item) | §7.9 lists none; a drawer would move Revoke out of its row against D-8 |
| Q-8 | **Approved: no rename**; F-41 stays open | Cosmetic; it churns the exact file list and imports |
| Q-9 | **Approved: pin the code's names** (`state`, `inviteType`, `issuer`, `query`), G-4's comment maps them to §7.9's spelling | SA-R-5 (1) is about the key count, not the spelling; with no URL (D-7 (a)) the free-text `query` held in page state is exactly what §7.9 allows |
| Q-10 | **Approved, with M-4's conditions** | SA-R-5 rests on "Invites files never call `history`"; G-7 makes it true for every module they pull in, and keeps it true after later shared edits. Skipping statement-level `import type` / `export type` is sound (TypeScript erases them) and is required, because `adminWindow.ts:30` imports `useAdminFilters` as a type |
| Q-11 | **Approved: edit the test** to the bar's role (`search` named "Filters" absent, "Refresh invites" present) and also assert the `searchbox` is absent | A `display: contents` wrapper kept only for a testid is a trick; the role pins the same behaviour |
| Q-12 | **Approved: UI short path under the user's fast-track** (SA code review + QA → RM) | No shared export is built (Q-6 ruled no; D-18 only removes a page file and uses the existing `badge` prop) |

### Findings

**Must-fix (apply to this workplan before coding)**

| # | Finding | Required change |
|---|---|---|
| M-1 | **D-18: the note goes, the live fact stays.** `EnforcementNote.tsx` renders two kinds of text. Outdated / false: "Until signup from an invite is built, invite links are for internal demos only: do not send them to real invitees, as they would expire first." Live and still true, driven by the payload's `enforcementMode`: "An invite records the plan it grants. Nothing is enforced yet, so every account has the full product." (off / shadow) or "Plans are enforced…" (enforce), plus the mode word. That live fact is invite-signup **GR-5** ("Honest status until enforcement … the admin UI states this"; Slice 0 workplan item 36 made this note the GR-5 surface on the issuing page), so it must not be lost, but it needs no box | (1) **Delete** `components/EnforcementNote.tsx` and its import. (2) Pass `badge` to `AdminPageHeader` from `payload.enforcementMode`: off / shadow → "Plans not enforced", enforce → "Plans enforced", `testId: 'enforcement-mode-badge'`, only once the payload is read (no badge while loading or on a first-load error). It is the existing neutral chip (§5.3: at most one factual state); no new shared code, no new colour. §2.1 S-1's "No badge" is reversed. (3) A short comment in `page.tsx` says why: GR-5, the note's stale words removed by D-18, the mode word comes only from the payload (no default, no fallback). (4) **Deliberate test edits, each named in the PR:** `source.guard` exact file list: **remove** `components/EnforcementNote.tsx`, **add** `components/InviteKpis.tsx` (G-1 amended); G-9 registry list **without** `EnforcementNote.tsx` (its "lists files that exist" case would fail otherwise); `page.render :233-242` "loads the invites … and the enforcement note" → "… and the plan-enforcement badge": badge reads "Plans not enforced" for the fixture's mode, `enforcement-note` testid absent, and "internal demos only", "real invitees" and "not built yet" appear nowhere in `document.body`; a new case for `enforce` → "Plans enforced" and for `shadow` → "Plans not enforced"; T-1 also asserts the badge is inside the `<header>`; T-14's content order drops the note (banner, panel, form, list). (5) Workplan sections to update: §1.1 row, §2.1 S-1, §2.7 row, §2.8 (new visible change: "the yellow note is gone; a 'Plans not enforced' chip beside the title"), §3.2, §4 (delete row), §8 task 7, §11 F-42, V-5 grep adds `EnforcementNote`, `internal demos`, `real invitees`, `installed yet`. (6) Mutations: (r) render the old sentence anywhere → the rewritten case fails; (s) map `shadow` to "Plans enforced" → the mode case fails. (7) Browser check I-B12: the chip beside the title reads "Plans not enforced" (production runs `shadow`); no yellow note |
| M-2 | **Q-2 as ruled above** | §2.5, §2.8 item 7 and T-7 change: a 500 with `could_not_read_invites`, and a body whose `json()` throws, show exactly "Could not read invites. Try again in a moment."; `could_not_read_invites`, "installed yet" and "Unexpected token" appear nowhere. Mutation (n) stands. Dev adds a §9 F-item: the invites GET answers a machine code where CLAUDE.md's error format asks for user-facing copy (open, API, separate slice) |
| M-3 | **The empty bar has a second trigger.** `AdminFilterBar.tsx:145-146` treats the bar as "has controls" when `children` **or `onClear`** (or a window / business) is not `undefined`. §2.3's note names only `children` | Over an empty list and before the first read, pass `children`, `onClear` and `canClear` all as `undefined` (one conditional object, not three ternaries that can drift). Add mutation (p2): pass `onClear` while the list is empty → the edited empty-list case fails |
| M-4 | **G-7 must be a real walker, not a layout-folder scan.** `DatePresets.tsx:40` and `adminWindow.ts:22` import `@/app/admin/components/adminWindowPresets`, outside the shared folder | The walker: (a) starts from every Invites file; (b) follows every relative and `@/` specifier (resolve `.ts`, `.tsx`, `/index.*`), into any folder, transitively, with a visited set; (c) matches multi-line `import … from`, side-effect `import '…'` and `export … from`; (d) skips only **statement-level** `import type` / `export type`; an inline `{ type X, y }` counts as a value import (over-approximation fails loud, never silent); (e) **fails** on an `@/` or relative specifier it cannot resolve (never skips it); (f) asserts the reached set excludes `useAdminFilters.ts`, and that no reached file's code (comments stripped) contains `history.pushState` / `history.replaceState`, `useSearchParams`, `useRouter`, `next/navigation`, `localStorage`, `sessionStorage` or `document.cookie`; (g) a positive control: the reached set contains `AdminFilterBar.tsx`, `DatePresets.tsx`, `adminWindow.ts` and `readJsonBody.ts`, so an empty walk cannot pass; (h) the fixture self-test as proposed. Pure file reads inside the Jest gate (no CI time added) |
| M-5 | **One number for the banner and the tile** | Derive `stoppedCount = payload.stoppedHalfway?.count ?? 0` once in the page; the banner renders when `stoppedCount > 0` and the tile is `amber` when `stoppedCount >= 1`, both from that value. It is the same fact as the banner (same server summary, same condition), which is what K-5 (ii) requires; one derivation keeps the two from drifting |

**Should-fix**

| # | Finding |
|---|---|
| S-1 | Record in §1 row 11 at implementation: page deviations Q-2 (error copy), Q-7 (no drawer), the U-1 exception (D-7 (a), tiles not links), `formatUtcDate` still deferred (Q-6), D-18 applied; the two new F-items (route machine code, M-2; every Revoke button named "Revoke", §11) |
| S-2 | T-10: also assert `window.location.href` is identical before and after the whole sequence (including a failed read and Try again), not only `search` and `hash` |
| S-3 | T-15: type the "unknown state" row with `as unknown as InviteState`, never `any` (test files are outside the guard's `any` scan, so review is where it is caught) |
| S-4 | T-4: assert the exact sub-line text on one tile and its presence on all five, so a wording change is one edit |

**Notes (no change required)**

- **D-7 (a) holds:** no `useAdminFilters`, no `useSearchParams`, no `router`, no `history`; filters live in `useState`; a reload resets them. The `localStorage | sessionStorage | document.cookie | history.(push|replace)State` rule is unchanged in text and scope (SA-R-5); G-4 to G-7 only add.
- **Alias via `escapes()`:** sound. The trailing slash in the prefix keeps `layoutX` out, and the existing `ALLOWED_PACKAGES` line still refuses `next/*` and `@/lib/*`. G-3's negative controls are the right set.
- **Tiles:** no-target mode (`div role="group"`), K-7 names, not links; K-5 colour only on Stopped halfway, sourced from the existing amber banner (same fact, M-5). "At least" on all five when `truncated` is correct, because the server derives `stoppedHalfway` over the same returned rows.
- **Network sentence** is a forced §5.10 rule 3 / rule 4 fix; the fetch needs its own `try`, because `readAdminResponse` never sees a rejected fetch.
- **Table (F-40):** "Email status", sr-only "Actions", "(UTC)" headers and `scope="col"` collide with no pinned query (every pinned query is by testid or `within(list)`; the button-name "Clear" query is exact and does not match "Clear filters").
- **Chips:** icons are `aria-hidden` and add no text, so `^Sent$` and the other exact texts hold; `neutral` carries no icon by type.
- **`RevokeDialog` inline under its row** (D-8) and `CreatedLinkPanel` / `CreateInviteForm` never importing the hook (G-5) are correct. `CreateInviteForm` and `RevokeDialog` reaching `readJsonBody` through the alias is allowed and covered by G-7.
- **h1 exact match** is required, as proposed: a substring match passes on the old title.
- **No data, API, permission or write change.** No logger is added (the guard refuses `@/lib/logger/client`; the page logs nothing today).
- **Mutations** (a) to (q) plus (p2), (r), (s) are the right set. (e) edits a shared file: revert it at once and compare md5, as planned.
- **Browser checks** read only: never create, copy or revoke an invite in production; stop at Cancel / Keep it. Add I-B12 (M-1).
- **Sizing:** about 2 to 2.5 days stands; M-1 adds about 0.1 day.
- **Path:** UI short path under the fast-track: SA code review + QA, then RM commits and opens the PR.

### Approval

[x] Workplan approved with conditions — apply M-1 to M-5 to this file, then proceed to implementation

## SA Code Review — 2026-10-12

**Code Review by SA — 2026-10-12** (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l6` at origin/main `4d383105`, uncommitted diff against HEAD)
**Status:** ✅ Code Approved — no must-fix. Two Low should-fix items on the G-7 extractor (SF-1, SF-2): fold in before commit if cheap, otherwise record as follow-ups; neither blocks QA or the commit.

### What was checked

- **Diff shape:** 11 tracked files modified or deleted, 3 untracked (`InviteKpis.tsx`, `inviteKpis.test.ts`, this workplan). The only deletion is `components/EnforcementNote.tsx` (planned, D-18). No shared source file, route, `types.ts` or `inviteFilter.ts` changed; the only shared-folder edit is the `layoutFolder.guard` registry entry.
- **Tests (spot run):** `npx jest app/admin/business-os-invites app/admin/components/layout --ci` gave 19 suites, 685 tests, all green.
- **G-7 independent check:** a TypeScript-AST reference walk (scratch script, `ts.createSourceFile`: `ImportDeclaration` / `ExportDeclaration` with `isTypeOnly` skipped, dynamic `import()`, `require`) over the same start set reaches the same **21 files** the Dev reports. The guard's regex extractor matches the AST per file on all 21 (value specifiers identical). No `require` and no non-literal `import()` anywhere in the reached set.

### M-1 to M-5, S-1 to S-4

| Item | Verdict | Evidence |
|---|---|---|
| M-1 (D-18) | ✅ | `page.tsx:161`: badge from `ENFORCEMENT_BADGE[payload.enforcementMode]` only once `payload` is read; an unknown mode gives `undefined`, so no badge (no default, no fallback). Off / shadow "Plans not enforced", enforce "Plans enforced"; `testId: 'enforcement-mode-badge'`; existing neutral chip via `AdminPageHeader`'s `badge` prop, no new shared code. GR-5 / D-18 comment at the `ENFORCEMENT_BADGE` constant. File deleted, import removed; no stale words left in source ("internal demos", "real invitees", "not built yet", "installed yet", `EnforcementNote` all absent). Tests: badge text exact, note testid absent, stale words absent from `document.body`, T-17 `it.each` for all three modes, T-1 asserts the badge is inside `<header>` and absent before the read, T-6 absent on a first-load error |
| M-2 | ✅ | `page.tsx:118-140`: the fetch alone in its own `try` → `ADMIN_NETWORK_ERROR`; `readAdminResponse` with `sessionEndedCopy: true`; status check on the result (`:137`), 401 / 403 → `result.message`, else `INVITES_READ_FAILED`. No fork of the helper. T-7 pins network, 401, 403, 500 with the route code and a body whose `json()` throws, each with the leak words absent |
| M-3 | ✅ | `InviteFilters.tsx:63-146`: one conditional object; the empty branch sets `children`, `onClear`, `canClear` all `undefined` together, which is exactly `AdminFilterBar`'s `hasControls` set (`AdminFilterBar.tsx:145-146`). Mutation (p2) reported red |
| M-4 | ✅ (see SF-1, SF-2) | `source.guard.test.ts:236-364`: relative and `@/` resolution with `.ts` / `.tsx` / `index.*`, into any folder, visited set; multi-line, side-effect, `export … from`, `export *`, dynamic `import()`; statement-level `import type` / `export type` skipped, inline `{ type X }` counted; throws on an unresolvable `@/` or relative specifier; `useAdminFilters.ts` banned from the reached set; the URL / storage ban on comment-stripped code of every reached file; positive control (5 files, incl. one outside the shared folder); fixture self-tests for the extractor, the resolver and the ban regex. Cannot pass on an empty walk |
| M-5 | ✅ | `page.tsx:159`: one `stoppedCount`; banner on `> 0`, tile `amber` on `>= 1`, both from it (`InviteKpis.tsx` takes it as a prop) |
| S-1 | ✅ | Requirement §1 row 11 records Q-2, Q-7, the U-1 exception, `formatUtcDate` deferred, D-18; §9 F-109 and F-110 added, count 108 |
| S-2 | ✅ | T-10 compares `href`, `search` and `hash` before and after the whole sequence, including a failed Refresh and Try again |
| S-3 | ✅ | `inviteKpis.test.ts`: `'superseded' as unknown as InviteState` |
| S-4 | ✅ | T-4: exact sub-line on one tile, `at least:` on all five, absent when `truncated` is false or missing |

### Other checks

- **D-7 (a):** no `history`, `location` write, `useSearchParams`, `useRouter`, `next/navigation`, `localStorage`, `sessionStorage` or `document.cookie` in any Invites file or anything it reaches; filters in `useState`. T-10 also spies on both history calls and checks storage length and that the link sits in no attribute.
- **`CreatedLinkPanel` / `CreateInviteForm`:** styling only (radius, A-1 focus rings, slate-400) plus, in the form, `readJsonBody` with the same truthiness check, error map and request body. The panel gains no import.
- **`escapes()`:** alias line first with the trailing slash; G-3 negative controls cover a sibling folder, the relative spelling, `layoutX` and `next/navigation`.
- **Tiles:** no-target `div role="group"` with K-7 names, no link or button inside (T-2); colour only on Stopped halfway (T-3).
- **Chips and table:** tones as ruled (Q-3, Q-4); `title` kept on a wrapper; headers unique, "(UTC)" on dates, `scope="col"`, sr-only "Actions", named table (T-11).
- **No data, API, permission or write change.** No `console.*`, no `any` (tests included). No new pattern.
- **Accessibility:** visible labels via `useId`; focus rings on every touched button and field; `aria-busy` on the content while a read runs over data. F-110 (identical "Revoke" names) recorded, not in scope.
- **Line endings:** source and test files CRLF in the working copy, LF in the index (`core.autocrlf`); the MDs LF. Git stores LF either way. No backslash in either MD.

### Code Review Comments

1. `app/admin/business-os-invites/__tests__/source.guard.test.ts:236` (SF-1) — `FROM_STATEMENT`'s body `[^'";]*?` stops only at a quote or a semicolon, not at the next statement keyword. A semicolon-less, quote-free `export type A = B` followed by a value `import { x } from './y'` is matched as **one** type-only statement, so `./y` is skipped: an under-approximation, the silent pass M-4 (d) rules out. Reproduced in isolation (`[['type ', './y']]`). Not reachable in today's 21 files (every statement ends in `;`, confirmed by the AST parity check), so it is a robustness gap, not a live miss. Suggested fix: let the lazy body also stop at a new `import` / `export` keyword (a negative lookahead for either word, inside the repeated character class group), and add that two-line case to the extractor self-test. — Priority: Low
2. `app/admin/business-os-invites/__tests__/source.guard.test.ts:238` (SF-2) — a dynamic `import()` with a template-literal or non-literal argument, and `require(…)`, are not seen at all. Neither occurs in the reached set today. Suggested: a self-test-backed check that fails if any reached file contains `import(` not followed by a quote, or `require(` (fails loud). — Priority: Low

### Optimisation Suggestions

- `source.guard.test.ts:58` `codeOf()` (existing helper, now also used by G-7): a string containing `/*` (e.g. a glob `'**/*.ts'`) would strip code up to the next `*/`, which could hide an import or a banned call. None in the reached set today. A later slice that moves this helper into a shared test util could strip comments with the TypeScript scanner instead.
- `InviteList.tsx:110`: a state word the client does not know makes `STATE_STYLE[invite.state]` undefined and the row throws on `style.tone`. Existing behaviour (the old code read `style.className`), and `countInvites` already tolerates it; worth a fallback chip in a later Invites slice.
- The URL ban lists the APIs M-4 named; `location.hash =` / `location.search =` / `location.assign` would also write the URL. Optional addition to `URL_OR_STORAGE`.

### Code Approved for QA: Yes

## QA Report — 2026-10-12

**QA — 2026-10-12**
**Test mode:** full
**Strategy used:** A + B (Jest: the slice's suites, the shared folder, the routes, the authz and Tailwind guards) plus throwaway jsdom probes (33 cases, deleted afterwards). D (browser) is listed for TL below: read only, never create / copy / revoke in production.
**Focus:** ui, security (shown-once link, no URL / storage), the payload as rendered
**Skipped:** live browser run (handed to TL as the checklist below); `npm run test:bos-entitlements` not run, because nothing in the diff imports `lib/business-os/entitlements/` (checked, §2.9)
**Input source:** prompt keywords (TL brief) + workplan §6 / §7

### Commands and results (real output)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest app/admin/business-os-invites app/admin/components/layout app/admin/components/__tests__ app/admin/__tests__ app/api/admin/business-os/invites lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **Test Suites: 39 passed, 39 total; Tests: 1225 passed, 1225 total** (65.1 s), exit 0. No `console.*`, no act() warning and no "Warning:" line in the output |
| Q-2 | Own scoped `tsc -p` in the session scratchpad `qa-l6/` (extends the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/business-os-invites/**`, `app/admin/components/layout/**`, `adminWindowPresets.ts`). `--listFilesOnly` listed all 12 Invites files incl. the 3 test files | **Run 1** with the scratch-only `canary.ts`: exit 2, exactly `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Run 2** canary removed: exit 0, no output. Scratch folder deleted |
| Q-3 | `npx eslint app/admin/business-os-invites app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | exit 0, no output |
| Q-4 | Throwaway probe `__tests__/zz-qa-l6.probe.test.tsx` (33 cases) | 29 pass on the first run; 1 probe-timing fix of my own (P1 waited for the error to clear, not for the read to finish), then pass; **3 fail = Bug QA-1** (P7b prototype keys). File deleted; `git status --short` identical to the start of the session |

### Edge cases probed

| # | Probe | Result |
|---|---|---|
| P1 | Shown-once link: create → search + state filter → Refresh → failed read ×4 (500 code, network reject, non-JSON 502, 401), each followed by Try again → remount. At all 11 checkpoints: `location.href` / `search` / `hash`, `history.length`, `history.state`, `sessionStorage`, `localStorage`, `document.cookie` unchanged; `pushState`, `replaceState`, `Storage.prototype.setItem` never called; the link in no attribute of any element; after remount the link is nowhere in the body | ✅ Pass. Observed: the panel stays on screen across an in-page Refresh, a failed read and Try again (React state only; same as `origin/main`, whose `load()` never cleared `created`). Not a regression |
| P2 | One GET per read: mount 1; four filter changes 0; Refresh double-clicked while busy +1 (button disabled); network failure +1; Try again +1. Every GET is exactly `/api/admin/business-os/invites`, no body | ✅ Pass |
| P3 | Success → failure → retry, 7 failures (500 code, non-JSON 502, 200 `success:false`, 200 `null` body, network, 401, 403): exact copy in `page-error` inside `role="alert"`; list kept; strip and placeholders gone; "Read at" keeps the last good time; no route code, "Failed to fetch", "Unexpected token", "unauthorized", "forbidden" anywhere; Try again restores the strip | ✅ Pass. The badge stays on a failed Refresh (last good read); absent on a first-load error |
| P3b | First-load failure: no strip, no placeholders, no badge, New invite disabled, Refresh-only bar; Try again renders list and bar | ✅ Pass |
| P4 | Focus after: Try again → `body`; Clear → stays on the now-disabled Clear in jsdom (falls to `body` in a browser, F-104, known); Clear filters → `body`; opening Revoke → `body` (no autofocus on the reason); Keep it → `body`. No POST sent | ⚠️ Edge case QA-2. Revoke open / Keep it unchanged from `origin/main`; Try again and Clear filters come with the shared `AdminError` / `AdminEmpty` |
| P5 | AND: state pending → 3; + type paid → 1; + issuer account → 1; + search "EXISTING" (case-insensitive) → 1; + search "pending" → 0 with "0 of 7 shown"; stopped_halfway alone → its row. Clear resets all four incl. search (`''`, `all` ×3), restores 7 rows, disables itself. Tiles ignore filters | ✅ Pass. Whitespace-only search: Clear stays disabled and 7 rows show (`isFilterActive` trims); spaces stay in the box. Harmless, unchanged logic |
| P5b | Filter on, then a Refresh that returns zero invites: the bar turns Refresh-only (filter invisible) but the empty state says "No invites match these filters." with Clear filters; when invites return the hidden filter is still applied (and visible again) | ⚠️ Edge case QA-3 (Low, rare) |
| P6 | Zero invites: Refresh-only bar with "Read at HH:mm UTC", no Clear, no count, no table, "No invites yet." without Clear filters, five tiles 0 neutral, no banner, no notice. One invite: "1 invite", "Pending, 1", no `aria-describedby`. 500 rows `truncated`: all five tiles "at least: the newest 500 only" via `aria-describedby`; amber notice; "500 invites" | ✅ Pass |
| P6b | Stopped halfway 0 / 1 / 2 / no summary: tile neutral / amber / amber / neutral; banner absent / present / present / absent; same number in both; "Needs a look" only with the banner. At 1234: tile "1,234", banner "1234" | ✅ Pass. The format gap cannot occur: the server counts over ≤ 500 returned rows |
| P7 | Mode `off`, `shadow` → "Plans not enforced"; `enforce` → "Plans enforced" (neutral chip inside `<header>`); `bogus`, missing, `''` → no badge | ✅ Pass |
| P7b | Mode `constructor` / `toString` / `__proto__` | ❌ **Bug QA-1** |
| P8 | Chips: Pending `info`, Accepted `ok`, Expired `neutral`, Revoked `neutral`; email Not emailed `neutral`, Sent `ok`, Sent (not tracked) `info`, Not sent `danger`, Unknown `warn`; exact texts; an `aria-hidden` svg on every non-neutral chip, none on neutral; wrapper keeps `title`; no status → "—"; stopped-halfway block has a `warn` chip "Signup stopped halfway" | ✅ Pass |
| P9 | A11y: one h1 "Signup Invites"; **zero `region` landmarks** with the panel, the form and an inline revoke all open; tiles `div role="group"`, no `href`, no `tabindex`, no link / button inside, no hover / pointer class; filters named by visible labels inside `search` "Filters"; `searchbox` present; Clear disabled at defaults; table "Invites", every `th scope="col"`, 10 unique headers in order (last "Actions", sr-only); no duplicate `id`; banner `role="status"`; Refresh "Refresh invites" `aria-busy="true"` + disabled while reading; content `aria-busy` true then false | ✅ Pass |
| P9b | Revoke (mocked fetch only): submit disabled under 3 characters; 409 → "This invite cannot be revoked: it was accepted or already revoked." in `role="alert"`; non-JSON and network → "The invite could not be revoked. Try again."; POSTs only to `/api/admin/business-os/invites/p/revoke`; no GET added; tiles unchanged | ✅ Pass |
| P9c | First load pending: one `role="status"` ("Reading invites…"), 5 `aria-hidden` placeholders, no badge, New invite disabled, Refresh `aria-busy="true"`, content `aria-busy="false"` | ✅ Pass |

### Test Coverage (against the brief)

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Header "Signup Invites", badge per mode, New invite in actions | ✅ | Pass, with QA-1 | P7, P9, T-1, T-17 |
| 5 no-target tiles; Stopped halfway amber at ≥ 1; "at least" when truncated | ✅ | Pass | P6, P6b, P9, T-2 to T-4 |
| Bar: page-held filters, never URL / history / storage; Clear; Read at; Refresh | ✅ | Pass | P1, P2, P5, T-9, T-10 |
| States: 401 / 403 session copy, fixed sentence, network sentence | ✅ | Pass | P3, T-7 |
| Table: "Email status", (UTC), `scope="col"`, unique headers | ✅ | Pass | P9, T-11 |
| StatusChips with icons | ✅ | Pass | P8, T-12 |
| Truncation `AdminNotice` | ✅ | Pass | P6 |
| RevokeDialog inline: open / cancel / errors | ✅ | Pass | P4, P9b |
| Filters never sent; one GET per read | ✅ | Pass | P2 |
| Browser, light + dark | ⚠️ | Not run by QA | Checklist for TL below |

### Issues Found

#### Bugs (must fix before commit)

1. **QA-1: an enforcement mode that names an `Object.prototype` key shows an empty badge or crashes the page** — File: `app/admin/business-os-invites/page.tsx` (`const badgeLabel = payload ? ENFORCEMENT_BADGE[payload.enforcementMode] : undefined;`) — Severity: **Low**
   - Steps to reproduce: a payload with `enforcementMode: '__proto__'` (or `'constructor'`, `'toString'`).
   - Expected: no badge, as the code comment and SA's M-1 verdict say ("an unknown mode gives `undefined`, so no badge").
   - Actual: `ENFORCEMENT_BADGE['__proto__']` is `Object.prototype`, so React throws "Objects are not valid as a React child" and the whole page unmounts; `constructor` / `toString` render an empty chip and log a React error.
   - Risk is very low (the server sends one of three config values). Fix: an own-property check (`Object.hasOwn(ENFORCEMENT_BADGE, mode)`) or a `switch`, plus one test case. Not a release blocker; Dev / SA decide whether to fold it into L-6. The same class as SA's note on `STATE_STYLE[invite.state]` (`InviteList.tsx:110`).

#### Performance Issues (should fix)

None. One GET per read; filtering is client side; the 500-row render is the same shape as on `origin/main`.

#### Edge Cases (nice to fix)

1. **QA-2: focus falls to `body`** after Try again and Clear filters (the shared `AdminError` / `AdminEmpty` button unmounts), after opening Revoke (no autofocus on the reason input) and after Keep it. The last two are unchanged from `origin/main`. Same class as F-104 (shared, open). Low.
2. **QA-3: a hidden active filter over an empty read.** With a filter on and a Refresh that returns zero invites, the bar hides the controls but the empty state says "No invites match these filters." (Clear filters works). Low, rare.
3. **Observed, unchanged:** the created-link panel stays on screen across an in-page Refresh, a failed read and Try again (React state only, never stored, gone on reload). Same as `origin/main`.

### Browser checks for TL (signed-in admin; DevTools Network + Application open; light and dark emulation; read only, NEVER create, copy or revoke a real invite)

I-B1 to I-B12 of §7.1, plus:

| # | Check |
|---|---|
| QA-B1 | Application tab: Session Storage, Local Storage and Cookies for the origin gain nothing after filtering, Refresh, Try again; the address bar never changes |
| QA-B2 | Offline → Refresh: network sentence, list kept, tiles gone, badge still shown; online → Try again: tiles back; "Read at" moves only on success |
| QA-B3 | Tab through the page: tiles take no focus stop; Clear disabled until a change; note where focus lands after Try again and Keep it (QA-2) |
| QA-B4 | Light and dark: chips readable (Revoked slate, Sent (not tracked) sky, Unknown amber, Not sent red); amber Stopped halfway tile only when the banner shows |

### Final Status
- [x] Every criterion in the brief passes in jsdom; one **Low** bug (QA-1) and two Low edge cases; no High or Medium open
- [ ] Browser checks (I-B1 to I-B12, QA-B1 to QA-B4) owed by TL

**Verdict: PASS WITH NOTES.** QA-1 is Low and does not block the fast-track; recommended as a one-line fix before RM if Dev is still in the file, otherwise a tracked follow-up.

## Commit Info

_(RM to populate)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Workplan written | Dev. Code verified at `62fafda0`. UI short path by classification (no shared export). 12 SA questions, 1 product question (F-42). Awaiting SA workplan review |
| 2026-10-12 | User answer F-42; SA workplan review | User: "Remove the note" (D-18). SA: APPROVED WITH CONDITIONS, M-1 to M-5 (note removed, plan-enforcement fact kept as the header badge; error copy drops the stale tail; bar's `onClear` trigger; G-7 walker conditions; one stopped-halfway number). Q-1 to Q-12 ruled |
| 2026-10-12 | Implemented | Dev: M-1 to M-5 and S-1 to S-4 applied to this file; code complete, uncommitted. Implementation Notes: built list, deliberate test edits, V-1 to V-6 results (39 suites / 1225 tests green, tsc canary proof, lint clean, 21 mutations red), deviations, user-visible changes |
| 2026-10-12 | SA code review | SA: Code Approved, no must-fix. M-1 to M-5 and S-1 to S-4 verified; G-7 matches an independent TypeScript-AST walk (21 files). Two Low should-fix items on the G-7 extractor (SF-1 semicolon-less `export type` can swallow the next import; SF-2 non-literal `import()` / `require` unseen), non-blocking. Spot run: 19 suites / 685 tests green |
| 2026-10-12 | QA report | QA: 39 suites / 1225 tests green; scoped tsc canary proof; eslint clean; 33 throwaway jsdom probes (deleted). PASS WITH NOTES: QA-1 (Low, prototype-key enforcement mode crashes / empties the badge), QA-2 / QA-3 Low edge cases; browser checklist for TL |
| 2026-10-12 | QA-1, SF-1, SF-2 folded in | Dev (TL decision after SA approval and QA PASS WITH NOTES): own-key badge lookup, extractor statement boundary, unwalkable-import check; tests and mutations (t) to (w) red; Status ready for RM |
| 2026-10-12 | Committed; PR #315 | RM: commit 4d241b1e on `feature/admin-layout-l6`; origin/main 4d383105 already contained (no-op merge); targeted Jest 39 suites / 1250 tests, test:bos-entitlements 239 / 6804, lint:hooks clean; PR #315 opened against main, not merged |
