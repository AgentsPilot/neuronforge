# Workplan: Admin Layout Standard — Slice L-12 (Admin users)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 18), §3 (rules 1 to 9), §4.13, §5.2 (T-5, T-7), §5.3, §5.4 K-1 (no strip), §5.5 (Refresh-only bar, part 6; "Admin users deliberately clears"), §5.7 (non-table content), §5.9, §5.10, §5.11, §5.12, §6.1, §6.2 C-2, C-3, C-4, C-5, C-8, C-12, C-14, §7.15, §9 F-85, §10 D-3 (a), D-5 (a), §12.3
**Skills applied:** `tenant-isolation-guard`: not triggered (no write, no service-role path, no caller-supplied id; the route is a cross-account admin list behind `requireAdmin` and is not touched). `business-os-entitlements`: not triggered (no import from `lib/business-os/entitlements/`, no tier or capability literal). `business-os-schema-check`: not triggered (no DB claim; only the payload fields the page already reads, `lib/admin/adminList-types.ts`). `bos-llm-call-standards`, `durable-queue-drain`: not applicable
**Branch:** `feature/admin-layout-l12`, cut by RM from `origin/main` at 82469a8a, the merge commit of the L-10 PR #324, so L-10 had already merged. Confirmed by Dev with `git branch --show-current`. **M-4 resolved:** not a stacked PR; the L-12 PR targets `main` and carries nothing from an open branch. The branch also carries three doc edits that record the L-10 merge (requirement, retrospective, L-10 workplan); they are kept
**Date:** 2026-10-12
**Status:** Built, awaiting SA code review + QA (2026-10-12, uncommitted). SA workplan review 2026-10-12: APPROVED WITH CONDITIONS; M-1 to M-5 and S-1 to S-5 applied to this file before coding (task 1)
**Path:** **UI short path** by classification: no shared source file changes. The only shared-folder edit is the registry entry in the shared guard's test file (the L-5, L-6, L-7, L-10 precedent). Under the user's fast-track for this standard: SA workplan review → Dev → SA code review + QA → RM

## Overview

L-12 moves the read-only **Admin users** page (`/admin/settings`, sidebar Settings → "Admin users") onto the standard. It is the last slice before the user halts. The page is small (`page.tsx`, 211 lines, one test file) and makes exactly one request, `GET /api/admin/admins`. It has **no write path**: no add, no remove, no role control, no dialog, no form, by an earlier decision (ADMIN_BOS_CLEANUP OQ-1 = B). L-12 gives it the shared header with the "Read-only" badge, the Refresh-only bar (Refresh leaves the header), the shared loading and error states, the read through `readAdminResponse` (closes F-85), UTC dates through `formatUtc`, the §5.7 card shell, and slate-400 / no per-page accent colours. There is **no KPI strip** (user decision D-5 (a), §7.15), no filter bar controls, no table and no drawer. The page joins the migrated-pages registry.

**Note on the brief.** The TL brief places the admin delete-user / business feature (PRs #216 to #276) on this page. It is not here: that feature lives on **Businesses** (`/admin/users`, sidebar Businesses section), which was migrated in L-4a / L-4b. "Admin users" is `/admin/settings` (`AdminSidebar.tsx`, the Settings entry with href `/admin/settings`). This plan therefore has no dangerous dialog to restyle; §1.3 proves the page writes nothing and §6 pins that it stays so.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope and decisions](#2-scope-and-decisions)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Guard and registry changes](#5-guard-and-registry-changes)
6. [Tests](#6-tests)
7. [Verification](#7-verification)
8. [Task List](#8-task-list)
9. [Sizing, path and split](#9-sizing-path-and-split)
10. [Risks](#10-risks)
11. [Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
12. [Questions for SA](#12-questions-for-sa)
13. [Questions for the user](#13-questions-for-the-user)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 The page today (`app/admin/settings/page.tsx`)

| Lines | What | Standard item |
|---|---|---|
| `:1-21` | `'use client'`; header comment (ADMIN_BOS_CLEANUP slice 1, FR-AU1 to FR-AU5, SA W-3, W-5) | comment gains an L-12 paragraph |
| `:26-29` | `import type { AdminListData }` (W-5, pinned type-only); `clientLogger.child({ module: 'AdminUsersPage' })` | kept |
| `:31` | `ADMIN_LIST_URL = '/api/admin/admins'` | kept |
| `:36-45` | `isAdminListBody`: `success === true` and both lists arrays, else error (SA W-3a) | shape check kept, applied to `result.data` |
| `:47-49` | `formatDate`: `toLocaleDateString('en-US', …)` in the **browser's** time zone ("Jul 1, 2026") | §5.11 → `formatUtc` |
| `:58-80` | `load()`: newest-wins ref; `fetch(ADMIN_LIST_URL, { method: 'GET' })`; **`response.json()` before checking `ok` (F-85)**; any failure → `setData(null)` + `'error'` (W-3b) | read via `readAdminResponse`; clearing kept (§5.5) |
| `:91-111` | Hand-built header: h1, purple "Read-only" pill, purpose "Who can open admin. Read-only.", icon-only Refresh (`aria-label="Refresh"`, `title`) | `AdminPageHeader` + Refresh-only bar |
| `:113-123` | Error box, fixed sentence "Could not load the admin list. Nothing is shown rather than a list that may be wrong." (`bg-red-500/20`, `backdrop-blur-xl`) | `AdminError` |
| `:125-129` | Spinner only while there is no data (first load) | `AdminLoading` |
| `:131-193` | Two `<section>` cards (`bg-slate-800 p-6`), `h2 text-xl` with blue `Shield` icons; `<li>` inner cards; overlap marker `text-blue-300` | §5.7 card shell, T-7 |
| `:195-208` | Always-shown access info box (`data-testid="access-info"`), blue palette | neutral standing note (Q-4) |

`console.*` in touched files: **0** in `page.tsx`, **0** in `page.render.test.tsx`. `layoutFolder.guard.test.ts` has 1 occurrence, which is a string literal inside its own `CONSOLE` regex self-test (`:395`), not a call. No `any` in `page.tsx`.

### 1.2 The route (not touched)

`app/api/admin/admins/route.ts`: one handler, `GET` (`:86`). `requireAdmin` is the first statement in the `try` (`:92`). Reads `adminUserRepository.listActive()` (active rows, oldest first), compares with `ADMIN_EMAILS`, answers `{ success: true, data: { tableAdmins, envOnlyAdmins } }`; any failure is a 500 with `error: 'Failed to load admin list'` (`:67`, `:74-84`). Logs counts only, never an address. Its tests (`app/api/admin/admins/__tests__/route.test.ts`) are not touched.

### 1.3 Write paths: none (verified)

| Check | Result |
|---|---|
| Requests in `page.tsx` | Exactly one `fetch`, `:63`: `fetch(ADMIN_LIST_URL, { method: 'GET' })`. Nothing else with `method`, `POST`, `PUT`, `PATCH`, `DELETE` |
| Route methods | `route.ts` exports only `GET` |
| Controls | One button (Refresh). No input, select, textarea, form, dialog. Pinned by `page.render` P-4 |
| Old management routes | `settings/admin-users` and `settings/platform-users` deleted (76cd380b); pinned absent by the page's source cases |
| Role UI | None; P-4 asserts the word "role" never appears in the page text; `admin-authz-surface.guard` R4 is at zero |

So there is no confirmation text, typed confirm, danger wording or disabled-state rule to preserve. The equivalent invariant for this page is **"still read-only, still exactly that one GET"**, and §6 pins it in every state (ready, loading, refreshing, error, retry), not only in the ready state as today.

### 1.4 Admin authz (unchanged)

The page is guarded by inheritance: `app/admin/layout.tsx:41` awaits `requireAdminPage()` (the `admin_users` source of truth). The data is behind `requireAdmin` in the route (`route.ts:92`). L-12 edits neither file, adds no `route.ts` under `app/admin/**` (R3), and writes no role comparison anywhere (R4). New test code must not contain a `role` equality comparison: R4 scans test files too (the `page.render` header W-2 note), so absence is asserted only through text and accessible-name queries, as today.

### 1.5 Who else depends on these files

| Dependent | Effect |
|---|---|
| `AdminSidebar.tsx` / `AdminSidebar.nav.test.ts` | Name "Admin users" and href unchanged; not touched (§3 rule 9). The h1 already equals the sidebar label (D-3 (a)) |
| `lib/admin/adminList-types.ts` | Read type-only; not touched (its W-5 source case stays) |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | Must stay green unedited |
| `app/__tests__/tailwind-css-escape.guard.test.ts` | Must stay green (no backslash-hex in any edited file or this MD) |

---

## 2. Scope and decisions

### 2.1 In L-12

| Item | Decision | Source |
|---|---|---|
| Header | `AdminPageHeader` title "Admin users", purpose "Who can open admin." (the trailing "Read-only." moves into the badge, Q-1), `badge={{ label: 'Read-only', testId: 'read-only-badge' }}` (the L-5 precedent), no `actions`, no `asOf` (the payload carries no server clock) | §5.3, §7.15 |
| KPI strip | **None** | D-5 (a), §7.15, K-1 |
| Filter bar | Refresh-only `AdminFilterBar` (plain `<div>`), `what="the admin list"` → button "Refresh the admin list", `readAt` = client time of the last successful read (the Messages / Invites precedent) | §5.5 part 6, §7.15 |
| Content | Always-mounted content wrapper `data-testid="admin-users-content"` with `aria-busy` while a read is in flight | §5.10 |
| States | First load: `AdminLoading what="the admin list"`. Error: `AdminError` (`testId="admin-list-error"`, Try again → same `load`). Refresh with data: lists stay, Refresh spins | §5.10 |
| Read | `readAdminResponse<AdminListData>(response, { what: 'the admin list', sessionEndedCopy: true })`, then the W-3a shape check on `result.data`; `ADMIN_NETWORK_ERROR` on a rejected fetch | §5.10, C-4, F-85 |
| Failure | **Keeps clearing** the lists (W-3b, §5.5 "Admin users deliberately clears"), and also clears "Read at" (Q-3) | §5.5 |
| Cards | Both lists stay cards (§5.7: "admin-user lists stay as cards"); shell `rounded-xl border border-slate-700 bg-slate-800/40 p-4`; `h2 text-sm font-semibold text-white`; one column (Q-5) | §5.7 |
| Dates | "Added {formatUtc(addedAt)}", e.g. "Added 2026-07-01 10:00 UTC" (Q-2) | §5.11, C-5 |
| Colour | Blue `Shield` icons → `text-slate-400`, `aria-hidden`; `Mail` icons `aria-hidden`; overlap marker `text-blue-300` → `text-sky-300` (the §5.9 info hue, words unchanged, Q-4); access info box → neutral note (Q-4); no slate-500 / 600 information text | T-5, T-7, A-2 |
| `StatusChip` | Only the header badge (neutral). No other state on the page is a chip (Q-6) | §5.9 |
| Table constants, `AdminDrawer`, `OpenRowButton`, `useAdminFilters`, `adminDialog` | **Not used**: no table, no row detail, no filters, no dialog on this page | §7.15 |

### 2.2 The read and states

```text
load():
  requestId = ++latestRequest.current                     (unchanged: newest wins)
  setStatus('loading')                                    (data kept while refreshing)
  try   response = await fetch(ADMIN_LIST_URL, { method: 'GET' })     (byte-identical line)
  catch (err)
        if stale: return
        logger.warn({ err }, 'Admin list request failed')            (P-7 shape kept)
        fail(ADMIN_NETWORK_ERROR); return
  result = await readAdminResponse<AdminListData>(response, { what: 'the admin list', sessionEndedCopy: true })
  if stale: return
  if result.ok and isAdminListData(result.data)
        setData(result.data); setReadAt(now ISO); setStatus('ready')
  else
        logger.warn({ status: response.status }, 'Admin list request failed')   (no address, no body)
        fail(result.ok ? UNUSABLE : result.message)

fail(message): setData(null); setReadAt(null); setError(message); setStatus('error')
UNUSABLE = 'Could not read the admin list. Try again in a moment.'  (same words as the shared fallback)
```

**S-5 applied:** the UNUSABLE literal duplicates the shared fallback (the helper does not export it; the Invites and Messages precedent). A-5 asserts that the malformed-200 row and the non-JSON row show identical text, so a drift between the page literal and the helper fails a test. **N-2:** the non-ok log carries `status` only, never `result.message`.

| Answer | Today | L-12 |
|---|---|---|
| 200 `{ success: true, data }` with both arrays | lists | lists (unchanged) |
| 500 with the route sentence | page sentence "Could not load the admin list. Nothing is shown …" | "Failed to load admin list" (rule 1, the route's own string; Q-7) |
| 200 `{ success: false, error }` | page sentence | the route's `error` string (rule 1) |
| 200 `success: true` with a bad shape (W-3a) | page sentence | "Could not read the admin list. Try again in a moment." |
| Non-JSON body (proxy 502 page) | page sentence (after a swallowed parser throw) | "Could not read the admin list. Try again in a moment." |
| 401 / 403 | page sentence | "Your admin session has ended. Sign in again." |
| `fetch` rejected | page sentence | `ADMIN_NETWORK_ERROR` |

In every failure row: no list, no "No active rows" line, no "Read at", the access info box still shown, a Try again button. The older page never showed a raw or parser message; that stays true.

### 2.3 What stays as it is

The request (URL, method, init object), the newest-wins ref, the W-3a shape rule, the W-3b clearing, the log message and the no-address rule, the type-only import, every list word, both h2 texts, every `data-testid` (`table-admin`, `env-admin`, `access-info`), the empty-list sentences, the access info words, the env list order (route-sorted) and the table order (oldest first).

### 2.4 Visible changes on `/admin/settings` (named in the PR)

1. Header: "Read-only" is a grey chip (was a purple pill); the purpose reads "Who can open admin."; no Refresh in the header.
2. Under the header, a bar with "Read at HH:mm UTC" and a text "Refresh" button (was an icon-only button top right).
3. First load shows "Reading the admin list…" in the content area (was a bare spinner).
4. Errors: the shared red box with Try again; the words now come from the route or the shared fixed sentences (§2.2).
5. "Added" dates read "YYYY-MM-DD HH:mm UTC" (were "Jul 1, 2026" in the browser's time zone, which could be a day off).
6. Cards on the standard shell, smaller headings, grey icons instead of blue; the overlap line sky instead of blue; the access info box neutral instead of blue.

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

**No source change.** Used as they are: `AdminPageHeader` (with `badge`), `AdminFilterBar` (Refresh-only branch, `readAt`), `AdminLoading`, `AdminError`, `readAdminResponse` + `ADMIN_NETWORK_ERROR`, `formatUtc`. One test-file edit: the registry entry (§5).

### 3.2 Page folder (`app/admin/settings/`)

- `page.tsx` only. It stays one file (about 200 lines after the change); splitting a 211-line page into components would add review surface for no gain. Imports only through the alias `@/app/admin/components/layout/…` (S-1).
- `isAdminListBody` becomes `isAdminListData(data: unknown): data is AdminListData` (both arrays), because `readAdminResponse` has already checked `success === true`.
- `formatDate` is deleted; `formatUtc` is used directly. Not `formatUtcDate`: it accepts only date-only strings and would print an em dash for every `created_at` timestamp (pinned by a test, §6.3 A-8).
- **Q-2 re-checked against the real helper (RM note, 2026-10-12).** `formatUtcDate` is on `main` in `app/admin/components/layout/adminFormat.ts` (from finance #318). It returns the em dash for null or for any value that `isRealDate` rejects, and otherwise returns the value's own text unchanged, without going through `Date`. `isRealDate` (`app/admin/components/adminWindowPresets.ts`) accepts only `YYYY-MM-DD`. `addedAt` is `created_at`, an ISO instant ("2026-07-01T10:00:00.000Z"), so `formatUtcDate(addedAt)` would print "—" on every row. Converting first (`formatUtcDate(formatUtc(x).slice(0, 10))`) is the in-page slicing C-5 forbids. **Result: the Q-2 ruling stands, full `formatUtc`.** A-8 and S-3 pin it, and mutation (e) proves it.
- Header comment: one L-12 paragraph (what moved, the clearing rule kept, F-85 closed).

No `console.*`, no `any`, no `@/lib/` import beyond the two already there (`adminList-types` type-only, `logger/client`).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/settings/page.tsx` | modify | Header, Refresh-only bar, shared states, read on `readAdminResponse` (no `.json(`), `formatUtc`, card shell, T-5 / T-7 colours, comment |
| `app/admin/settings/__tests__/page.render.test.tsx` | modify | Deliberate edits E-1 to E-5 (§6.2) and new source cases (§6.4) |
| `app/admin/settings/__tests__/adminUsersLayout.render.test.tsx` | create | Layout, state and read-only pins A-1 to A-12 (§6.3) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Registry entry + "Amended by L-12" header paragraph (§5) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify (TL / Dev at code complete) | §1 row 18, §7.15 as built, §9 F-85 done and F-124 to F-127 added, Change History |
| `docs/workplans/ADMIN_LAYOUT_L12_WORKPLAN.md` | create | This plan (TL moves the draft into the branch) |

**Not touched:** `app/api/admin/admins/**`, `lib/**` (incl. `adminList-types.ts`, `AdminUserRepository.ts`, `requireAdminPage`), `app/admin/layout.tsx`, `app/admin/components/AdminSidebar.tsx` and its nav test, every shared source file in `app/admin/components/layout/`, `app/admin/users/**` (Businesses, incl. the delete feature), every other admin page.

---

## 5. Guard and registry changes

**Shared `layoutFolder.guard.test.ts`:** one `MIGRATED_PAGES` entry, after Business OS AI:

```ts
{
  // L-12: header with the Read-only badge, the Refresh-only bar, shared
  // states, the read on readAdminResponse (F-85). No strip (D-5 (a)), no
  // filters, no table, no drawer, no dialog: the page is read-only.
  page: '/admin/settings (Admin users)',
  files: ['app/admin/settings/page.tsx'],
},
```

It runs the existing four rules unchanged: the file exists, imports `AdminPageHeader` through the alias, has no own `<h1`, no direct `.json(`, and reaches the shared folder only through the alias. Header paragraph: "Amended by L-12: Admin users joins the registry; no rule change and no shared source change." No rule change.

**Page-level guard.** The page has no `source.guard` file of its own; its source pins live in `page.render`'s "source" block. L-12 extends that block (§6.4) rather than creating a new guard file, so no alias line is needed in any page import guard.

**`admin-authz-surface.guard`:** no edit; must stay green (R3, R4, R6).

---

## 6. Tests

### 6.1 Order

Baseline first, on the branch before any edit: `npx jest app/admin/settings app/admin/components/layout lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`, counts recorded. Then (**M-1**) the **invariant halves** of A-11 and A-12, named A-11i and A-12i, are written **first and run green on the unchanged page** (the L-7 characterisation precedent), so the read-only invariant is proved before and after the change. They hold only what is true both before and after: no `input`, `select`, `textarea`, `form` or `role="dialog"` in the ready, loading, refreshing and error states; no button whose name matches the write verbs; every button's accessible name starts with "Refresh" or is "Try again"; every fetch call deep-equals `['/api/admin/admins', { method: 'GET' }]` across mount and Refresh (Refresh found by a name starting with "Refresh"). **A-11i and A-12i are not edited in task 3.** The exact sets ({Refresh} in ready and loading, {Try again, Refresh} in error), the "after Try again" state and the Try again call are A-11x and A-12x, written in task 5 after the change.

### 6.2 Edited deliberately in `page.render.test.tsx` (each named in the PR)

| # | Case | Edit | Why |
|---|---|---|---|
| E-1 | P-1 | "Added Jul 1, 2026" → "Added 2026-07-01 10:00 UTC"; "Added Aug 15, 2026" → "Added 2026-08-15 09:30 UTC" | §5.11, `formatUtc` |
| E-2 | P-4 | `toHaveAccessibleName('Refresh')` → `'Refresh the admin list'`. Still exactly one button, no input / select / textarea / form, no add / remove / delete / grant / revoke button, no "super admin", no "role" text | Refresh moves to the bar (§7.15 "P-4 … → Refresh") |
| E-3 | P-5, P-10 | Button query `{ name: 'Refresh' }` → `{ name: 'Refresh the admin list' }` | Same |
| E-4 | `ERROR_TEXT` and P-6, P-7, **P-8**, P-10, P-11 | The page sentence regex is replaced by the exact §2.2 words per case, read from `getByTestId('admin-list-error')` inside `role="alert"`: 500 → "Failed to load admin list"; 200 `success: false` → "nope"; each malformed 200 → "Could not read the admin list. Try again in a moment."; rejection → `ADMIN_NETWORK_ERROR`. **M-3:** P-8's and P-11's "no error shown" checks both become "no `role="alert"`", and `ERROR_TEXT` is **deleted**, so no case can pass on a sentence the page no longer prints. P-8 is named in the PR's deliberate-edit list. `expectNoList()` and every list-absence assertion unchanged | §5.10 copy precedence (Q-7) |
| E-5 | File header comment | One line: "L-12: Refresh renamed, error words per §5.10, dates in UTC" | Traceability |

Unchanged: P-2, P-3, P-3b, P-9, the P-11 race mechanics (StrictMode, held first response), the P-7 logger assertion (`{ err: Error }`, message 'Admin list request failed', no "@" in any log call), the four existing source cases.

### 6.3 New: `adminUsersLayout.render.test.tsx`

Same `stubFetch` shape as `page.render` (plus a reply whose `json()` throws, for non-JSON); `console.error` / `console.warn` spied in every case and asserted not called; no `role` equality comparison anywhere in the file (R4).

| # | Case |
|---|---|
| A-1 | Header: exactly one h1 "Admin users"; purpose "Who can open admin."; `read-only-badge` with text "Read-only" and `data-tone="neutral"`; no button inside `<header>` |
| A-2 | Bar: not `role="search"`; after load "Read at" followed by two digits, a colon, two digits and " UTC" (**S-2:** the Messages / Invites pattern, no fake timers, so `waitFor` cannot stall); one button named "Refresh the admin list" with visible text "Refresh" |
| A-3 | Refresh while loaded: lists stay mounted while the second read is pending; content `aria-busy="true"` then `"false"`; button disabled and `aria-busy` while pending |
| A-4 | First load: `role="status"` "Reading the admin list…"; header, bar and `access-info` present; no list; Refresh disabled |
| A-5 | Error copy matrix (§2.2): 500 route sentence, 200 `success: false`, malformed 200, non-JSON, 401, 403, rejection; each inside `role="alert"` with exactly the expected text in `admin-list-error`, no list, no "Read at", `access-info` still shown; never "Failed to fetch", never a `SyntaxError` / "Unexpected token" text. **S-5:** the malformed-200 row and the non-JSON row show identical text |
| A-6 | Try again: re-reads (one more call, same URL and init) and recovers to the lists |
| A-7 | Failed refresh after a good load: lists and "Read at" cleared, error shown (W-3b kept, §5.5) |
| A-8 | Dates: `addedAt` with "+02:00" → the UTC time ending "UTC"; "2026-07-01T00:30:00.000Z" shows "2026-07-01" whatever the process time zone; an unparseable value → "Added —"; never "1970" |
| A-9 | T-5 / T-7: in the ready, loading and error states no element on the page has `text-slate-500`, `text-slate-600`, any `blue-` or `purple-` text / bg / border class (purple focus rings excepted by matching only `text-`, `bg-`, `border-` prefixes), `dark:` or `--v2-`. **M-2:** the one exemption is the shared `AdminLoading` spinner `svg` inside `role="status"` (`text-purple-500`, required by §5.10); the case asserts that it is the only element with a purple text class |
| A-10 | Icons: every `svg` in the header, cards and info box is `aria-hidden` |
| A-11i | **Read-only invariant** (task 2, green on the unchanged page, not edited after; M-1): in ready, loading, refreshing and error: no input, select, textarea, form or `role="dialog"`; no button named add / remove / delete / grant / revoke / save / edit; every button's name starts with "Refresh" or is "Try again" |
| A-12i | **Request invariant** (task 2, same rule): across mount and Refresh every call deep-equals `['/api/admin/admins', { method: 'GET' }]` |
| A-11x | **Exact sets** (task 5): buttons are exactly {Refresh} in ready and loading and {Try again, Refresh} in error; the same read-only checks after Try again |
| A-12x | **Request pin incl. Try again** (task 5): mount, Refresh and Try again each add exactly one call deep-equal to `['/api/admin/admins', { method: 'GET' }]`; one call on mount |

### 6.4 New source cases (in `page.render`'s "source" block)

| # | Case | Why |
|---|---|---|
| S-1 | The code contains the literal `fetch(ADMIN_LIST_URL, { method: 'GET' })` exactly once and `fetch(` exactly once | Byte-identical request |
| S-2 | No `.json(` in the code; `readAdminResponse` imported from the alias path | F-85, C-4 |
| S-3 | No `formatUtcDate(`, no `toLocaleDateString`, no `toLocaleString` | A-8's reason, §5.11 |
| S-4 | No word-bounded `any` type annotation (`: any`, `as any`, `<any>`) | CLAUDE.md rule 6 |

Each with a planted-string self-test so no regex is dead (the guard precedent). **S-3:** all four run on the comment-stripped `code` the block already builds, not on `source`, so the header comment can name `fetch` or "any" freely; S-4's self-test also proves "company", "many" and `anyOf` do not match.

### 6.5 Must stay green with no edit

`app/api/admin/admins/__tests__/route.test.ts`, `AdminSidebar.nav.test.ts`, every shared-folder suite, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/__tests__/tailwind-css-escape.guard.test.ts`.

**Mutation runs** (each reverted, recorded in the Implementation Notes): (a) put `const body = await response.json()` back → the registry rule and S-2 fail; (b) change the init to `{ method: 'POST' }` → A-12i, A-12x and S-1 fail; (c) stop clearing data on failure → A-7 and P-10 fail (as built it survives, because the status hides the lists too; (c2), breaking both locks, and (c3), keeping "Read at", fail instead; see Implementation Notes); (d) add a `<input>` to the bar area → A-11i and P-4 fail (N-4: (b) and (d) recorded with the failing case names); (e) swap `formatUtc` for `formatUtcDate` → A-8 and S-3 fail.

---

## 7. Verification

| # | Command | Expect |
|---|---|---|
| V-1 | `npx jest app/admin/settings app/admin/components/layout app/admin/components/__tests__/AdminSidebar.nav.test.ts app/api/admin/admins lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | All green; counts = baseline + new cases |
| V-2 | Scoped `tsc --noEmit` on a scratch tsconfig over `app/admin/settings/**` and `app/admin/components/layout/**`, canary first (the L-9 QA method) | Canary fails, then exit 0 |
| V-3 | `npm run lint:hooks` | Clean |
| V-4 | `git diff --stat 82469a8a -- app/api lib tests app/admin/layout.tsx app/admin/components/AdminSidebar.tsx app/admin/users app/admin/components/layout ':!app/admin/components/layout/__tests__'` (**S-1:** a plain `*` pathspec crosses `/` and would match the guard test this slice edits on purpose) | Empty |
| V-5 | `grep` `app/admin/settings` for `console.`, `as any`, `: any`, `.json(` (only in the test stubs), `text-slate-500`, `blue-`, `method:` (exactly the one GET line) | As stated |
| V-6 | `git diff --stat` before reading the diff (truncation hazard): no file emptied or deletion-only | As stated |

### 7.1 Browser checks for QA / TL

Signed-in admin, DevTools Network and Console open, light and dark emulation. **Every check is read-only**: the page has no control that changes anything. Do not follow the sidebar to Businesses (`/admin/users`) during these checks; its delete and credit actions are live and are **do not click in prod**.

| # | Check | Kind |
|---|---|---|
| QB-1 | `/admin/settings`: h1 "Admin users", grey "Read-only" chip, purpose "Who can open admin."; nothing clickable in the header | read-only |
| QB-2 | Bar under the header: "Read at HH:mm UTC" (your UTC clock) and a text "Refresh" button; the accessibility pane names it "Refresh the admin list" | read-only |
| QB-3 | Network **filtered to Fetch/XHR or `/api/`** (S-4: in production Next prefetches the sidebar links as `_rsc=` requests, which the shell makes, not the page): on load exactly one `GET /api/admin/admins`; press Refresh: exactly one more, same URL, method GET, no payload; no other `/api/` request | read-only |
| QB-4 | Both cards: every email, "Linked to a login: yes / not yet", "Added YYYY-MM-DD HH:mm UTC", notes; the overlap line on any row also in `ADMIN_EMAILS` | read-only |
| QB-5 | Throttle to Slow 3G and Refresh: the lists stay on screen, the button spins and is disabled, "Read at" updates after | read-only |
| QB-6 | Hard reload under Slow 3G: "Reading the admin list…" with the header and bar already shown; the info box shown | read-only |
| QB-7 | DevTools offline, press Refresh: "Could not reach the server. Check your connection and try again." with Try again; lists and "Read at" gone; info box still shown. Back online, Try again: lists return | read-only |
| QB-8 | Info box: same words, neutral colours, the doc path as plain text (no link) | read-only |
| QB-9 | Keyboard: within the main content, Tab reaches Refresh (and Try again in the error state) with a purple focus ring, and no other stop (S-4: Tab continues into the sidebar; **do not press Enter on a sidebar link**, see the Businesses warning above) | read-only |
| QB-10 | Light and dark emulation: header chip, bar, cards, error box, info box look the same in both | read-only |
| QB-11 | Console: no errors or React warnings through all of the above | read-only |

Not checked in the browser (jsdom covers them): 401 / 403 session words, a non-JSON 502, a malformed 200.

---

## 8. Task List

- [x] ✅ 1. Confirm branch `feature/admin-layout-l12`; apply SA M-1 to M-5 and S-1 to S-5 to this file; baseline run (§6.1), counts recorded
- [x] ✅ 2. Write A-11i and A-12i (invariant only, M-1); run them green on the unchanged page
- [x] ✅ 3. `page.tsx`: header, Refresh-only bar, content wrapper, states, read on `readAdminResponse`, `formatUtc`, cards and colours, comment (A-11i / A-12i not edited)
- [x] ✅ 4. `page.render` edits E-1 to E-5 (incl. P-8, `ERROR_TEXT` deleted, M-3); source cases S-1 to S-4 with self-tests
- [x] ✅ 5. `adminUsersLayout.render` A-1 to A-10, A-11x, A-12x
- [x] ✅ 6. Registry entry and header paragraph; mutation runs (a) to (e), reverted
- [x] ✅ 7. V-1 to V-6; Implementation Notes; requirement §1 row 18, §7.15 as built, §9 (F-85 done; F-124 to F-127; count 121 → 125), Change History

---

## 9. Sizing, path and split

| Part | Estimate |
|---|---|
| Tasks 2 to 3 (pins first, then the page) | about 0.5 day |
| Tasks 4 to 6 (tests, registry, mutations) | about 0.5 day |
| Task 7 (verification, docs) | about 0.25 day |
| **Total** | **about 1 to 1.25 days, one PR** (roughly 120 to 160 lines of source changed, 300 to 350 lines of tests) |

**Split recommendation: no split.** The L-4a / L-4b split existed because Businesses had a KPI strip, a filter bar, a table, a drawer and four dialogs. Admin users has none of those: one file, one GET, two cards. Splitting would produce a slice with nothing in it.

**Path: UI short path.** No shared source file changes, no new pattern; the registry entry is a shared-folder test edit (L-5, L-6, L-7, L-10). If SA rules any shared change is needed (none is planned), it becomes full cycle (R-7).

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The read-only invariant weakens unnoticed in a state the old P-4 never checked (error, loading) | A-11 in every state, written and green before the change (§6.1) |
| R-2 | The request changes shape (init object, extra header) while moving to `readAdminResponse` | The `fetch` line is not edited; S-1 literal pin; A-12 deep-equal pin; mutation (b) |
| R-3 | A list stays on screen after a failed read (W-3b regression) | `fail()` clears data and "Read at" in one place; A-7, P-10, mutation (c) |
| R-4 | `formatUtcDate` picked by mistake prints "—" for every date | S-3, A-8, mutation (e) |
| R-5 | A new test writes a `role` comparison and trips R4 | Accessible-name and text queries only; `admin-authz-surface.guard` in V-1 |
| R-6 | Registry array conflicts with L-10's entry; a stacked PR lands in a parent branch (the #221 incident) | Resolved (M-4): cut from `origin/main` 82469a8a after #324 merged; the PR targets `main` |
| R-7 | Route words "Failed to load admin list" read worse than the old page sentence | SA Q-7 offers the alternative; either way no raw or parser text reaches the screen |

---

## 11. Out of scope and found on the way

**Dispositions this slice closes (at code complete):** F-85 (done: the body is read through `readAdminResponse`, status first, no `.json(`).

**New findings for §9 (reported, not fixed):**

| # | Finding | Citation | Sev | Disposition |
|---|---|---|---|---|
| F-124 | The Admin users page lives at `/admin/settings`, a path that names neither the page nor its sidebar label; anyone reading a link or a log sees "settings". Renaming is a route move (old links, sidebar href, nav test), not a layout change | `app/admin/components/AdminSidebar.tsx` (Settings → Admin users entry, href `/admin/settings`); `app/admin/settings/page.tsx` | cos | open (found in the L-12 workplan; needs its own slice and a redirect for old links) |
| F-125 | "Added {date}" is the row's `created_at`. Re-granting a soft-revoked admin (`upsertByEmail` sets `is_active: true` on the existing row) keeps the first creation time, so the page can show an "Added" date older than the current grant | `lib/repositories/AdminUserRepository.ts` (`upsertByEmail`, `listActive`); `app/api/admin/admins/route.ts` (`addedAt: row.created_at`) | UX | open (found in the L-12 workplan; a data meaning question, NEEDS DATA, its own full-cycle slice if wanted) |
| F-126 | `upsertByEmail` writes `user_id: input.userId ?? null`, `granted_by: input.grantedBy ?? null` and `notes: input.notes ?? null`. A re-seed through it would therefore unlink a bound admin and also erase who granted the row and its note. **Latent:** it has no runtime caller today, only its unit test (`lib/repositories/__tests__/AdminUserRepository.test.ts`); `scripts/seed-admin-users.ts` does its own upsert and resolves the user id first. An unlinked row neither grants nor revokes access: the email path still matches, and `AdminAccessService.isAdmin` re-binds it (`bindUserId`) on that admin's next check | `lib/repositories/AdminUserRepository.ts` (`upsertByEmail` payload) | data (latent) | open, owner: the first slice that wires `upsertByEmail` (ADMIN_IDENTIFICATION_AND_ACCESS future item 4, "Admin management UI/API"). Found in the L-12 workplan; restated per SA M-5 |
| F-127 | Admin email addresses reach server-side Pino logs at the live sites `bindUserId` (info, on self-heal), the repository's `findByEmail` / `bindUserId` / `deactivateByEmail` error logs, and `AdminAccessService`'s env-fallback warn (on every check for an env-only admin). `upsertByEmail`'s two log calls are the latent ones. The admin list route, by contrast, logs counts only. These are operator addresses, not customer data, and the logger is server-only | `lib/repositories/AdminUserRepository.ts`; `AdminAccessService` (env-fallback warn) | cos | open, its own logging slice or a logging-privacy sweep (privacy hygiene, not a priority). Found in the L-12 workplan; re-aimed per SA M-5 |

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Purpose line: today "Who can open admin. Read-only." With the "Read-only" badge beside the h1, keep the trailing words or drop them? | Drop: "Who can open admin." (one sentence, §5.3; the badge carries the state; matches the sidebar description) |
| Q-2 | "Added" date: full `formatUtc` ("2026-07-01 10:00 UTC") or date only? `formatUtcDate` cannot take a timestamp, and slicing the string in the page is the pattern C-5 exists to stop | Full `formatUtc`; no new shared export |
| Q-3 | On a failed read, clear "Read at" together with the lists (it would otherwise name the time of a list no longer shown)? | Yes, clear both |
| Q-4 | Colours: the overlap marker `text-blue-300` → `text-sky-300` (the §5.9 info hue; it is a caveat, not a warning) and the always-shown access info box from blue to a neutral note (`rounded-xl border border-slate-700 bg-slate-800/40 p-4`, `Info` icon slate-400, text slate-300 / slate-400). Not `AdminNotice`: amber means "something is missing", which this note does not say (the L-10 standing-note precedent) | As written |
| Q-5 | Cards: one column (stacked, as today) or the §5.7 grid `md:grid-cols-2`? The table card holds notes and the overlap line and is usually longer than the env card | One column, recorded as a page deviation (L-3, L-10 precedent) |
| Q-6 | Figures "Linked to a login: yes / not yet" and "Added …" stay inline spans, not a `<dl>`. A `dt` / `dd` split changes the text content P-1 pins ("Linked to a login: yes" would lose its space) | Keep spans, recorded deviation; no chip for "not yet" (no payload status says it needs action, K-5 spirit) |
| Q-7 | Error copy: follow §5.10 rule 1 (the route's "Failed to load admin list"), or keep the page's own sentence "Could not load the admin list. Nothing is shown rather than a list that may be wrong." for every failure as a page deviation (the L-2a Q-10 / L-6 Q-2 precedent)? | Follow §5.10. The route's words are readable admin copy (not a machine code, unlike L-6), and the safety the old sentence described is kept by behaviour (lists cleared) and pinned (A-5, A-7) |
| Q-8 | `sessionEndedCopy: true` (401 / 403 → "Your admin session has ended. Sign in again.")? | Yes (L-5, L-6, L-10 precedent) |
| Q-9 | Keep the page in one file (no `components/` split), with the source pins added to `page.render`'s existing "source" block rather than a new `source.guard` file? | Yes; one registry file |
| Q-10 | Write A-11 / A-12 first and run them green on the unchanged page (characterisation, L-7 precedent) before touching `page.tsx`? | Yes |

---

## 13. Questions for the user

None. Every change is presentation; the only new words are the shared fixed sentences already used on other admin pages, and the KPI strip question was already answered (D-5 (a): no strip on this page).

---

## SA Review Notes

## SA Review (workplan) — 2026-10-12

**Reviewed by SA — 2026-10-12**
**Status:** APPROVED WITH CONDITIONS. M-1 to M-5 must be applied to this file before coding (task 1) and are checked at code review. S-1 to S-5 are expected; a Dev who disagrees records why in Implementation Notes. No product question for the user.

**Path:** UI short path confirmed, under the admin-layout fast-track (SA code review + QA, then RM). No shared source file changes; the only shared-folder edit is the registry entry in `layoutFolder.guard.test.ts` (the L-5, L-6, L-7, L-10 precedent). No data, API, money, LLM or authz change.

### What SA verified in the code (worktree at 07e308d3, page files unchanged since 76cd380b)

| # | Claim | Verified |
|---|---|---|
| 1 | Read-only, one GET | `page.tsx:63` is the only `fetch`, `fetch(ADMIN_LIST_URL, { method: 'GET' })`; no other `method:`, no `form`, `input`, `select`, `textarea` or dialog; one button (Refresh, `:100-109`). `app/api/admin/admins/route.ts` exports only `GET` (`:86`), `requireAdmin` is the first statement in the `try` (`:92`). The plan keeps the request line untouched, and S-1 (literal, once) plus A-12 (deep equal on every call) pin it. Correct |
| 2 | Authz unchanged | `app/admin/layout.tsx` (`requireAdminPage`) and the route are on the "not touched" list and V-4 checks them. R3 (no `route.ts` under `app/admin`), R4 (role comparisons, scans tests too, `CAPS.R4` 0 / 0) and R6 stay green unedited. The plan's "accessible-name and text queries only" rule is the right way to keep R4 at zero |
| 3 | No shared source change | Every export the plan uses exists with the needed shape: `AdminPageHeader` `badge` (renders the `neutral` `StatusChip`, which carries `data-tone` and the `testId`, Plans precedent `read-only-badge`), `AdminFilterBar` no-controls branch with `readAt`, `AdminLoading`, `AdminError` (`testId` on the message `p`, `onRetry`), `readAdminResponse` with `sessionEndedCopy`, `ADMIN_NETWORK_ERROR`, `formatUtc` (em dash for null or invalid, through `Date`, so an offset value prints its UTC time). `formatUtcDate` takes date-only strings only, so the plan's choice of `formatUtc` is required, not taste |
| 4 | The read order | `readAdminResponse` never throws (`readJsonBody` catches the parser), so calling it outside the `try` that wraps `fetch` is safe; the stale check after it is what keeps P-11's held first response from overwriting the second |
| 5 | Error copy table (§2.2) | Traced through `readAdminResponse`: 500 with the route body gives "Failed to load admin list" (rule 1); 200 `success: false, error: 'nope'` gives "nope"; `{ success: true }` with no data or a bad shape passes the helper and fails `isAdminListData`, so UNUSABLE; a body of `'ok'` or a throwing `json()` gives the fallback; 401 / 403 give the session words. Every row is correct |
| 6 | Registry | The four existing rules apply as stated (files exist, `AdminPageHeader` through the alias, no own `<h1`, no direct `.json(`, alias only). One file is the whole page; nothing else in the folder has markup or a read. Placing the entry after Business OS AI needs the L-10 base (M-4) |
| 7 | `console.*` | 0 in `page.tsx` and `page.render.test.tsx`; the one hit in `layoutFolder.guard.test.ts` is a string inside its own regex self-test. Nothing to flag |

### Rulings on Q-1 to Q-10

| # | Ruling | Why |
|---|---|---|
| Q-1 | **Approved: purpose "Who can open admin."** | §5.3 wants one sentence; the badge now carries "Read-only", and saying it twice in the header adds nothing |
| Q-2 | **Approved: full `formatUtc`**, no new shared export | A grant time is an instant, not a calendar date; `formatUtcDate` would print an em dash for every row, and slicing in the page is what C-5 forbids. The extra "HH:mm UTC" is honest, not noise |
| Q-3 | **Approved: clear "Read at" with the lists** | It differs from L-10 N-1 (where Read at kept the last good time) for a reason: there the cards stayed on screen, here the list is deliberately cleared (§5.5 "Admin users deliberately clears"), so a clock naming a list that is no longer shown would be a false statement |
| Q-4 | **Approved as written** | Sky is the §5.9 info hue and the overlap line is a caveat; the access box is a standing note, not "something is missing", so not `AdminNotice` (the L-10 standing-note precedent). Words unchanged |
| Q-5 | **Approved: one column, recorded as a page deviation in §7.15 as built** | Same as L-3 and L-10: two cards of very different length; a two-column grid would leave a short env card beside a long table card |
| Q-6 | **Approved: keep the inline spans, record the deviation** | These are row metadata inside a list item, not card figures; a `dl` split would change the pinned text for no reader gain. No chip for "not yet" (K-5 spirit: the payload carries no status saying it needs action) |
| Q-7 | **Approved: follow §5.10 rule 1, the route's own words.** No page deviation | §5.10 is explicit: the route's `error` string when the body is readable JSON. The L-2a Q-10 / L-6 Q-2 deviations existed because those routes answered machine codes; "Failed to load admin list" is admin-readable copy (CLAUDE.md error format). The old sentence's promise ("nothing is shown rather than a list that may be wrong") is kept by behaviour, not by words: `fail()` clears the list, and A-5, A-7 and P-10 pin it. R-7 is accepted |
| Q-8 | **Approved: `sessionEndedCopy: true`** | Every `readAdminResponse` page except Health opts in; the gate's 401 / 403 bodies are not page copy |
| Q-9 | **Approved: one file, source cases in `page.render`'s existing "source" block** | A 211-line page with no components does not need a `source.guard` file; one registry entry |
| Q-10 | **Approved, with M-1** | Characterisation first is right (L-7 precedent), but as written A-11 and A-12 cannot be green on the unchanged page (see M-1) |

### Out-of-scope findings (check 6)

- **F-124 (route path named "settings"): correctly out of scope.** A route move with old links, the sidebar href and its nav test is not a layout change. Cosmetic.
- **F-125 ("Added" is `created_at`, kept across a re-grant): correctly out of scope.** A data-meaning question, NEEDS DATA; the page only shows what the route sends. UX.
- **F-126 (`upsertByEmail` unlinks a bound admin): correctly out of scope, and lower than written.** SA checked the callers: `upsertByEmail` has **no runtime caller** (only its own unit test, `lib/repositories/__tests__/AdminUserRepository.test.ts`; `scripts/seed-admin-users.ts` does its own upsert and resolves the user id first). Even if called, an unlinked row does not grant or revoke access: the email path still matches and `AdminAccessService.isAdmin` re-binds it (`bindUserId`) on that admin's next check. The real loss is that the same payload also writes `granted_by: null` and `notes: null`, so a re-seed through it would erase who granted the row and its note. Not a security issue and not a priority flag; it belongs to whichever slice first wires `upsertByEmail` (ADMIN_IDENTIFICATION_AND_ACCESS future item 4, "Admin management UI/API") (M-5).
- **F-127 (`upsertByEmail` logs the email): correctly out of scope, and mis-aimed.** The cited method is dead code; the live places that log an admin's address are `bindUserId` (info, on self-heal), the error logs of `findByEmail`, `bindUserId` and `deactivateByEmail`, and `AdminAccessService.isAdmin`'s env-fallback warn (on every check for an env-only admin). These are operator addresses in server-side Pino logs, not customer data, and the logger is server-only. Privacy hygiene, low; not a priority flag to the user. Its own small logging slice (or a logging-privacy sweep) if wanted (M-5).

### Findings

**Must (apply to this file before coding):**

| # | Where | Finding | Required change |
|---|---|---|---|
| M-1 | §6.1, §6.3 A-11, A-12; task 2 | A-11 and A-12 are to be green on the unchanged page, but the unchanged page has no "Try again" (its error box has no button), its Refresh is named "Refresh", not "Refresh the admin list", and A-11's error-state set is {Try again, Refresh}. As written both cases fail before the change, so they prove nothing about "before" | Split each case. **Task 2 (before the change):** the invariant only: no `input`, `select`, `textarea`, `form` or `role="dialog"` in ready, loading, refreshing and error; no button whose name matches the write verbs; every button's accessible name starts with "Refresh" or is "Try again"; every fetch call deep-equals `['/api/admin/admins', { method: 'GET' }]` across mount and Refresh (Refresh found by a name that starts with "Refresh"). Run green on the unchanged page and say so in Implementation Notes. **Task 5 (after):** the exact sets ({Refresh} ready and loading, {Try again, Refresh} error), the "after Try again" state, and the Try again call in A-12. The invariant cases are not edited in task 3 |
| M-2 | §6.3 A-9 | A-9 forbids any `purple-` text class in the loading state, but the shared `AdminLoading` spinner is `text-purple-500` (`AdminStates.tsx:24`), as §5.10 requires. A-9 fails on the standard itself, or tempts a page-side workaround | A-9 excludes exactly the `role="status"` spinner `svg` (or asserts the only purple text class on the page is that spinner's), and keeps every other rule. The focus-ring exception stays (prefix matching already excludes `ring-purple-500`) |
| M-3 | §6.2 E-4 | `ERROR_TEXT` is also used by P-8 (`page.render.test.tsx:123`) and P-11 (`:239`) as "no error shown". If the constant stays as the old regex those two pass vacuously after the change (the sentence never appears); if it is deleted they fail to compile. The plan lists P-8 as unchanged | E-4 covers P-8 and P-11: both assert "no `role="alert"`"; `ERROR_TEXT` is deleted so nothing can pass on a sentence the page no longer prints. Name P-8 in the PR's deliberate-edit list |
| M-4 | Header "Branch", R-6 | L-10 is PR #324, open and unmerged. Cutting L-12 from the L-10 commit and opening its PR before #324 merges is a stacked PR, which has already landed a merge into a parent branch instead of main (the #221 incident) | Cut from `main` after #324 merges (preferred). If Dev must start earlier from the L-10 head, the L-12 PR targets `main` and is not opened until #324 has merged; RM merges `origin/main` and confirms the L-10 merge commit is an ancestor of `origin/main` before opening |
| M-5 | §11 F-126, F-127; task 7 | The §9 rows will be copied into the requirement, and as written they mis-state reach (see "Out-of-scope findings" above) | F-126: add "no runtime caller today (only its unit test; the seed script has its own upsert)" and "also nulls `granted_by` and `notes`"; Sev `data` (latent); disposition "open, owner: the first slice that wires `upsertByEmail` (ADMIN_IDENTIFICATION_AND_ACCESS future item 4)". F-127: re-aim at the live sites (`bindUserId` info, the repository's `findByEmail` / `bindUserId` / `deactivateByEmail` error logs, `AdminAccessService` env-fallback warn) with `upsertByEmail` as the latent one; Sev `cos` (privacy hygiene, operator addresses, server logs only); disposition "open, its own logging slice" |

**Should:**

| # | Where | Finding |
|---|---|---|
| S-1 | §7 V-4 | A git pathspec `*` matches across `/` by default, so `app/admin/components/layout/*.ts` also matches `__tests__/layoutFolder.guard.test.ts`, which this slice edits on purpose; V-4 will not be empty. Use `-- app/admin/components/layout ':!app/admin/components/layout/__tests__'` (plus the other paths) or the `:(glob)` magic |
| S-2 | §6.3 A-2 | "Fake system time, exact value" with Jest fake timers can stall `waitFor`. Follow the Messages / Invites precedent (a pattern of two digits, colon, two digits, then " UTC", inside the bar), or use `jest.useFakeTimers({ advanceTimers: true })` with `setSystemTime` if the exact value is wanted |
| S-3 | §6.4 S-1 to S-4 | Run them on the comment-stripped `code` the block already builds, not on `source`, so the L-12 header paragraph can name `fetch` or "any" freely. S-4's self-test also proves "company", "many" and `anyOf` do not match |
| S-4 | §7.1 QB-3, QB-9 | QB-3: tell QA to filter Network to Fetch/XHR or `/api/`: in production Next prefetches the sidebar links (RSC requests carrying `_rsc=`), which are reads the shell makes, not the page; without that note "no other request from the page" looks failed. QB-9: scope "no other stop" to the main content; Tab continues into the sidebar, and QA must not press Enter on a sidebar link (the Businesses warning) |
| S-5 | §2.2 UNUSABLE | The literal duplicates the shared fallback words (accepted: the Invites and Messages precedent, since the helper does not export them). A-5 must assert the malformed-200 row and the non-JSON row show identical text, so a drift between the page literal and the helper fails a test |

**Notes:**

- N-1: The "do not click on Businesses in prod" warning is right and stays. Opening `/admin/users` is itself a read, but its delete and credit dialogs are live, and nothing in this slice needs that page; keeping QA off it is the cheap control. With S-4 the keyboard check cannot wander there either.
- N-2: The non-ok log carries `status` only, never `result.message` (the route's words carry no address today; keep it that way). P-7's `{ err }` shape on the network path is unchanged.
- N-3: QB-1 to QB-11 cover all six visible changes in §2.4. 401 / 403, non-JSON 502 and malformed 200 are jsdom-only, correctly.
- N-4: Mutation runs (a) to (e) are the right set; (b) and (d) are the proof of the read-only invariant and must be recorded with the failing case names.

### Approval

[x] Workplan approved with conditions M-1 to M-5. Apply them to this file, then proceed to implementation.

**Dev, conditions applied (2026-10-12, before coding):** M-1 (§6.1, §6.3 A-11i / A-12i / A-11x / A-12x, task list), M-2 (A-9 spinner exemption), M-3 (E-4 covers P-8 and P-11, `ERROR_TEXT` deleted), M-4 (header: the branch is cut from `origin/main` 82469a8a, the #324 merge commit, so no stacked PR; R-6 resolved), M-5 (§11 F-126 / F-127 restated), S-1 (V-4 pathspec), S-2 (A-2 pattern, no fake timers), S-3 (source cases on `code`, S-4 self-test words), S-4 (QB-3 filter, QB-9 scope), S-5 (§2.2 note and A-5 equality case). Q-2 was re-checked against the real `formatUtcDate` from #318 (§3.2): the ruling stands.

---

## Implementation Notes (L-12)

**Code complete 2026-10-12 (Dev), uncommitted on `feature/admin-layout-l12` at 82469a8a.**

### What was built

- `app/admin/settings/page.tsx`: `AdminPageHeader` (title, purpose "Who can open admin.", `badge` "Read-only" with `read-only-badge`); `AdminFilterBar` with no controls (plain `<div>`), `what` "the admin list", `readAt` set to the client clock on each good read; an always-mounted `admin-users-content` wrapper with `aria-busy`; `AdminError` (`admin-list-error`, Try again → `load`) and `AdminLoading`; the read per §2.2 (the `fetch` line unchanged; a rejection logs `{ err }` and shows `ADMIN_NETWORK_ERROR`; `readAdminResponse` with `sessionEndedCopy`; `isAdminListData` on the ok branch; a non-ok or unusable answer logs `{ status }` only and shows the route's words or UNUSABLE); one `fail()` that clears the lists, "Read at" and sets the error; `formatUtc` for "Added"; cards on the §5.7 shell, `h2` `text-sm font-semibold`, inner items `rounded-lg border-slate-700 bg-slate-900/40`; icons slate-400 and `aria-hidden`; the overlap line `text-sky-300`; the access note a neutral card with an `Info` icon. `formatDate`, `isAdminListBody`, `RefreshCw` and `AlertCircle` removed. Header comment gains an L-12 paragraph.
- `app/admin/settings/__tests__/adminUsersLayout.render.test.tsx` (new): A-11i, A-12i (written first), A-1 to A-10, A-11x, A-12x; `console.error` / `console.warn` spied and asserted silent in every case.
- `app/admin/settings/__tests__/page.render.test.tsx`: E-1 to E-5 (P-1, P-4, P-5, P-6 ×7, P-7, P-8, P-10, P-11, header comment; `ERROR_TEXT` deleted, an `expectError` helper reads the exact words from `admin-list-error`); source cases S-1 to S-4 plus one self-test case.
- `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts`: the `/admin/settings (Admin users)` registry entry and the "Amended by L-12" paragraph. No rule change.

### Verification (real output)

| # | Result |
|---|---|
| Baseline (§6.1) | `app/admin/settings app/admin/components` + authz guard + tailwind guard: 25 suites, 825 tests, all green |
| Task 2 | A-11i (2 cases) and A-12i (1 case) on the **unchanged** page: 3 passed |
| After task 3, before task 4 | A-11i / A-12i still green unedited; the 12 failures were exactly the planned edits (P-1, P-4, P-5, P-6 ×7, P-7, P-10). P-8 and P-11 were passing vacuously, as SA M-3 predicted |
| V-1 | `app/admin/settings app/admin/components app/api/admin/admins` + authz guard + tailwind guard: **27 suites, 875 tests, all green**. The settings folder alone: 53 (page.render 30, adminUsersLayout.render 23) |
| `npm run test:bos-llm` | 23 suites, 625 tests, green |
| `npm run typecheck:bos-llm` | 28 errors, **0 new**, passed (one baseline entry reported fixed, `app/api/onboarding/build/route.ts`, not this slice) |
| V-2 | Scoped `tsc` (scratch tsconfig over `app/admin/settings/**` and `app/admin/components/layout/**`): canary `zz-canary.ts` failed with TS2322 (exit 2), then exit 0 without it; scratch files deleted |
| V-3 | `npm run lint:hooks`: clean |
| V-4 | Empty |
| V-5 | `page.tsx`: no `console.`, no `.json(`, one `method:` line (the GET), no `text-slate-500`, no `blue-`; the only ": any" hit is the comment words "it: anything". Test hits are the deliberate self-test strings |
| V-6 | `git diff --numstat`: no file emptied or deletion-only (`page.tsx` 155 / 138, `page.render` 69 / 15, guard 10 / 0; the new test 443 lines) |

**Mutation runs** (on `page.tsx`, restored from a scratch copy after each; checksum 79bb4f16 matched afterwards):

| # | Mutation | Failing cases |
|---|---|---|
| (a) | `response.json()` added back | registry "has no own <h1 and no direct .json(", S-2, A-5 non-JSON 502, A-5 S-5 equality |
| (b) | init `{ method: 'POST' }` | P-5, S-1, **A-12i** "across mount and Refresh", A-6, **A-12x** |
| (c) | stop clearing `data` in `fail()` | **A-7b** "good load, failed Refresh, held Try again: loading only; then the lists return" (after SA F-1; before A-7b it survived, see below) |
| (c2) | stop clearing `data` **and** render the lists whenever `data` is set | P-10, A-7 |
| (c3) | stop clearing "Read at" | A-7 |
| (d) | an `<input>` beside the bar | P-4, **A-11i** "loading, ready, refreshing and ready again", **A-11i** "error", **A-11x** |
| (e) | `formatUtcDate` for "Added" | P-1, S-3, A-8 offset instant, A-8 just after midnight |

**Mutation (c) is killed by A-7b (SA F-1, applied 2026-10-12).** In the first run it survived. Dev's claim that this was "a design fact, not a test gap" was wrong, as SA showed. While the error shows, the status hides the lists. But Try again puts the status back to `loading`, and an uncleared list would then reappear for the whole read: a stale list on screen with no error, which is the W-3b case. A-7b covers it: a good load, then a failed Refresh, then Try again with the reply held. While held, it asserts `expectNoList()`, no "Read at" and the `role="status"` loading text; after a good answer is released, the lists return. Re-run of (c) after the fix: **1 failed (A-7b), 53 passed**. `page.tsx` was restored from the scratch copy, and its checksum 79bb4f16 matched. No page change. (c2) and (c3) are unchanged.

### Deviations from the plan

1. **Console spies scope.** The `console.error` / `console.warn` spies (§6.3) are file-level hooks, so they also wrap A-11i / A-12i. That adds a check around the invariant cases without changing their bodies (M-1 says they are not edited). They stay green.
2. **How the `page.render` edits were made.** E-1 to E-5 were applied as one scripted exact-string replacement: each target was asserted to occur exactly once before it was replaced. Everything after that used Edit.
3. **A-2.** It matches "Read at" plus a `[0-9]{2}:[0-9]{2} UTC` pattern (S-2). `[0-9]` is used instead of a backslash class, so the new file has no backslash-hex sequence for the Tailwind decoder to read.

### User-visible changes

As §2.4 lists them, with no additions.

### Out of scope, recorded (not fixed)

F-124 to F-127 are in requirement §9 as restated by SA M-5. F-85 is done.

## SA Code Review

**Code Review by SA — 2026-10-12** (uncommitted worktree on `feature/admin-layout-l12` at 82469a8a; the requirement, retrospective and L-10 workplan edits are L-10 merge records and were not reviewed here)
**Status:** APPROVED WITH FIXES. One test-only fix (F-1), no source change. RM may proceed once F-1 is in and green; SA does not need a re-review, QA confirms the new case in its report.

SA re-ran: `npx jest app/admin/settings app/admin/components/layout/__tests__/layoutFolder.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: 5 suites, 524 tests, all green. V-4 pathspec (`app/api lib tests app/admin/layout.tsx app/admin/components/AdminSidebar.tsx app/admin/users app/admin/components`, excluding `layout/__tests__`) against 82469a8a: empty.

### Checklist

| # | Check | Result |
|---|---|---|
| 1 | M-1 to M-5, S-1 to S-5 | Met. M-1: A-11i / A-12i are separate from A-11x / A-12x and hold only the invariant (names starting "Refresh" or "Try again", deep-equal GET). M-2: A-9 collects purple text elements and allows only the `role="status"` spinner `svg`; purple `bg` / `border` throw. M-3: `ERROR_TEXT` gone; P-8 and P-11 assert no `role="alert"`. M-4: base 82469a8a is the #324 merge on main. M-5: §11 rows restated. S-1: V-4 pathspec used. S-2: A-2 uses the `[0-9]{2}:[0-9]{2} UTC` pattern, no fake timers. S-3: S-1 to S-4 run on `code`; S-4 self-test includes "company", "many rows", `anyOf`. S-4: QB-3 / QB-9 reworded. S-5: A-5 has the malformed-200 vs non-JSON equality case |
| 2 | Request and read-only | The call expression `fetch(ADMIN_LIST_URL, { method: 'GET' })` is byte-identical; the line itself lost `const ` because `response` is declared before the `try` so `readAdminResponse` can run outside it. Accepted: S-1 pins the call expression, A-12i / A-12x deep-equal every call. One `fetch(`, one `method:`. Read-only is pinned in loading, ready, refreshing, error and after Try again (A-11i, A-11x, P-4) |
| 3 | Authz | `app/admin/layout.tsx`, `app/api/admin/admins/**` untouched; no `route.ts` added; no role comparison in either test file; `admin-authz-surface.guard` green unedited |
| 4 | Shared source / routes / lib | None changed. The only shared-folder edit is the registry entry and its header paragraph |
| 5 | `readAdminResponse`, Q-7 | `readAdminResponse<AdminListData>(response, { what: WHAT, sessionEndedCopy: true })`; non-ok shows `result.message` (route words per §5.10 rule 1), ok-but-bad-shape shows UNUSABLE, rejection shows `ADMIN_NETWORK_ERROR`. A-5 pins all seven rows with exact text. Non-ok log is `{ status }` only (N-2) |
| 6 | Failure clears lists and Read at | `fail()` sets `data` and `readAt` to null in one place, on both failure paths. A-7 pins Read at gone. See F-1 for the gap in pinning "data cleared" |
| 7 | `formatUtc` | `Added {formatUtc(admin.addedAt)}`; `formatDate` removed; S-3 and A-8 (offset instant, midnight, unreadable value) pin it |
| 8 | Colour | Page: no `purple`, no `blue`, no `slate-500` / `slate-600`; overlap line `text-sky-300`; icons slate-400. A-9 enforces it in ready, loading and error, with the spinner as the only purple |
| 9 | Test honesty | `ERROR_TEXT` deleted; `expectError` reads the exact text of `admin-list-error`; P-8 and P-11 assert no alert, so neither can pass vacuously |
| 10 | Registry | Entry `/admin/settings (Admin users)` with `app/admin/settings/page.tsx`, after Business OS AI; "Amended by L-12" header paragraph; no rule change; guard green |
| 11 | Mutation (c) | **Not adequately pinned; see F-1** |
| 12 | Deviation 2 (scripted edits) | `page.render.test.tsx` read in full against the diff. The only changes are the planned ones: header paragraph, the `ADMIN_NETWORK_ERROR` import, the constants (`REFRESH`, `ROUTE_ERROR`, `UNUSABLE`), `expectError`, P-1 dates, P-4 / P-5 / P-10 names, P-6 / P-7 / P-10 exact words, P-8 / P-11 no alert, and the appended source cases. P-2, P-3, P-3b, P-9, the P-7 logger assertion, the P-11 race mechanics and the four older source cases are unchanged. No collateral damage |
| 13 | `console.*`, `any` | None in `page.tsx` (S-4 and the existing console source case pin it). The new test file's `console` spies are assertions, not logging. No `any` in either test file |

### Code Review Comments

1. **F-1** `app/admin/settings/__tests__/adminUsersLayout.render.test.tsx` — Priority: Medium. **The Implementation Notes' claim that mutation (c) survives "by design, not a test gap" is not right.** The render condition `data && status !== 'error'` hides a stale list only while the status is `error`. When the admin presses Try again (or Refresh) after a failed refresh, `load()` sets the status to `loading`; if `fail()` had not cleared `data`, the condition is true again and **the list the failed read could not confirm reappears on screen, with no error, for the whole retry** (and `AdminLoading` is suppressed because `data` is set). So in the retry state, clearing `data` is the only lock, not a second one, and no test reaches that state: A-7 and P-10 stop at the error, and A-11x / A-12x start their error from a first load with no data. Add one case (A-7b): good load, failed Refresh, then Try again with a held reply (`heldFetch`); while it is pending assert `expectNoList()`, no "Read at", and the `role="status"` loading text shown; then release a good answer and assert the lists return. Re-run mutation (c) and record that A-7b now fails, and replace the "survived by design" paragraph in the Implementation Notes with that result. No page change is needed: the code is correct, only the pin is missing.

### Optimisation Suggestions

- The `error` state is not reset on `load()` start; it is hidden by the status, so this is harmless. No change asked.
- A-11x's `expectReadOnly()` in the retry-loading state would also catch F-1's regression if it were run after a good load; F-1's dedicated case is clearer, so no change to A-11x.

### Code Approved for QA: Yes (with F-1 to be added before RM commits)

## QA Testing Report

### QA Report

**QA — 2026-10-12** (uncommitted worktree on `feature/admin-layout-l12` at 82469a8a)
**Test mode:** full
**Strategy used:** A (Jest, jsdom) for the suites and throwaway probes; D (browser) owed, no browser tools in this session
**Focus:** ui, api (client read path), security (read-only, one GET)
**Skipped:** QB-1 to QB-11 in a real browser (owed to TL / user, see below)
**Input source:** TL prompt + workplan §6 / §7
**Verdict:** **PASS WITH NOTES**

#### Runs (real output)

| Run | Result |
|---|---|
| `npx jest app/admin/settings app/admin/components --ci` | 24 suites, 735 tests, all green |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | 1 suite, 119 tests, green |
| `app/__tests__/tailwind-css-escape.guard.test.ts` | 1 suite, 6 tests, green |
| `app/api/admin/admins` route tests (6.5, no edit) | 1 suite, 15 tests, green |
| `npm run test:bos-llm` | 23 suites, 625 tests, 23 snapshots, green |
| `npm run typecheck:bos-llm` | 499 files, 28 errors, 0 new, passed (one baseline entry reported fixed, `app/api/onboarding/build/route.ts`, not this slice) |
| `npm run lint:hooks` | clean |

#### Probes (throwaway `zz*.test.tsx` in `app/admin/settings/__tests__/`, 24 cases, all green, deleted)

| Probe | Result |
|---|---|
| Happy path | One h1 "Admin users"; `read-only-badge` "Read-only"; purpose "Who can open admin."; button named "Refresh the admin list" with text "Refresh"; "Read at HH:mm UTC"; 2 table rows, 1 env row; "+02:00" instant shows "Added 2026-07-01 21:30 UTC", a Z instant "Added 2026-08-15 09:30 UTC"; "not yet" and the overlap line shown; no alert; one fetch |
| 401, 403, 403 with non-JSON body | "Your admin session has ended. Sign in again." |
| 500 with `error` / 200 `success: false` with `error` | The route's words ("Failed to load admin list", "nope") |
| Network rejection | `ADMIN_NETWORK_ERROR` |
| Non-JSON 502, non-JSON 200, `data: null`, env list missing, list as object, body `null`, body array, `success: "true"` string, 500 with no or blank `error` | All the identical words "Could not read the admin list. Try again in a moment." |
| Every failure row | `role="alert"`, exact text in `admin-list-error`, no list, no "No active rows", no "Read at", `access-info` still shown, Try again present; no "SyntaxError", "Unexpected token", "Failed to fetch", "undefined" or "null" anywhere in the page text |
| Success then failed Refresh | While pending: lists stay, content `aria-busy="true"`, Refresh disabled. After the 500: lists and "Read at" cleared, alert shown |
| Failed Refresh then held Try again (SA F-1 state) | No list, no "Read at", no alert, the loading status shown; after a good answer the lists return. The code is right; the test pin SA asked for (A-7b) is not in the suite yet |
| Try again then success | Focus lands on `document.body`: the Try again button unmounts on click. Known shared follow-up (AdminError focus), not an L-12 defect |
| Empty lists | "No active rows in the admin_users table." and "No addresses beyond the table."; "Read at" shown; no alert |
| Read-only in every state | Loading, ready, refreshing, error, retry, recovered: no input, select, textarea, form, dialog or link; only "Refresh the admin list" and "Try again" buttons; every fetch call deep-equals `['/api/admin/admins', { method: 'GET' }]` |
| Rapid double Refresh | The second click is ignored (button disabled while busy): 2 calls total, newer list shown |
| Stale response (StrictMode, two mount reads) | Newer answer released first, then the older one (success or rejection): the older never wins; no alert, "Read at" kept |
| Colour | In loading, ready, empty and every error state: no `purple`, `blue`, `indigo` or `violet` text / bg / border class except the shared spinner `svg` inside `role="status"`; no `text-slate-500` / `text-slate-600`; no `dark:` or `--v2-`. The overlap line is `text-sky-300` (SA Q-4 approved). The shared neutral badge uses `border-slate-600`, a border, not information text |

#### Request line vs HEAD

The call expression `fetch(ADMIN_LIST_URL, { method: 'GET' })` and `ADMIN_LIST_URL = '/api/admin/admins'` are identical to HEAD (read via `git show HEAD:` into the scratchpad). The statement lost `const ` because `response` is now declared before the `try`, as SA accepted. One `fetch(`, one `method:` in the page.

#### git status

Exactly the Dev's 8 entries (6 modified, 2 untracked: `adminUsersLayout.render.test.tsx` and this workplan). No zz files left.

#### Issues Found

**Bugs (must fix before commit)**

1. **SA F-1 not yet applied** — Severity: Medium (test-only) — File: `app/admin/settings/__tests__/adminUsersLayout.render.test.tsx`. No case covers "failed Refresh, then a held Try again", so mutation (c) still survives. QA confirmed by probe that the current code behaves correctly in that state; the pin is what is missing. Dev adds A-7b, re-runs mutation (c), and corrects the "survived by design" paragraph in the Implementation Notes. QA then confirms A-7b is green.

**Performance issues:** none.

**Edge cases (known, shared, not L-12)**

1. Focus falls to `document.body` when Try again is pressed (the button unmounts), and stays there after recovery. The shared AdminError focus follow-up already tracked for the standard.

#### Browser checks owed

QB-1 to QB-11 are **owed** (no browser tools in this session). All are read-only on `/admin/settings`. Do not follow the sidebar to Businesses (`/admin/users`) and click nothing there in prod.

#### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit (F-1 test pin only; no source change). No High severity bug open

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Workplan drafted | Dev: L-12 plan for `/admin/settings` (Admin users); code read at 8cc62d79 (page identical on main f99249b3); no write path found; no strip (D-5 (a)); no split; UI short path; SA Q-1 to Q-10; findings F-124 to F-127 |
| 2026-10-12 | SA workplan review | SA: APPROVED WITH CONDITIONS (code read at 07e308d3). Q-1 to Q-10 approved (Q-7: the route's words per §5.10 rule 1, no deviation). Must M-1 (split A-11 / A-12 into a before-and-after invariant and post-change exact sets), M-2 (A-9 exempts the shared loading spinner), M-3 (P-8 and P-11 off `ERROR_TEXT`), M-4 (no stacked PR on #324), M-5 (F-126 / F-127 restated: `upsertByEmail` has no runtime caller; neither is a priority security or privacy issue). Should S-1 to S-5 |
| 2026-10-12 | Conditions applied; L-12 built | Dev: M-1 to M-5 and S-1 to S-5 applied before coding; M-4 resolved (cut from `origin/main` 82469a8a after #324 merged); Q-2 re-checked against the real `formatUtcDate` (#318), ruling stands. Built and verified, uncommitted (Implementation Notes): settings folder 53 tests, V-1 27 suites / 875 tests, test:bos-llm 625, typecheck:bos-llm 0 new, lint:hooks clean, scoped tsc with canary, mutation (c) survives by design (double lock), (c2) and (c3) added |
| 2026-10-12 | SA code review | SA: APPROVED WITH FIXES. All M-1 to M-5 and S-1 to S-5 met; request call byte-identical (the `const` moved before the `try`, accepted); authz, shared source, routes and lib untouched; Q-7 copy, `formatUtc`, colours, registry and test edits verified; scripted `page.render` edits have no collateral damage; 524 tests green on SA's run. F-1 (test-only, Medium): mutation (c) is a real gap, because after a failed refresh a Try again puts the status back to loading and an uncleared list would reappear; add A-7b (failed refresh, then a held Try again shows no list) and re-record mutation (c) |
| 2026-10-12 | QA | QA: PASS WITH NOTES. settings + components jest 24 suites / 735; authz guard 119; tailwind guard 6; admins route 15; test:bos-llm 625; typecheck:bos-llm 0 new; lint:hooks clean. 24 throwaway probes green and deleted (happy path, error-copy matrix incl. 401 / 403 / non-JSON / malformed, failed Refresh clears lists and Read at, held Try again shows no list, empty lists, read-only and one GET in every state, stale answer never wins, colours). Fetch call identical to HEAD; git status = Dev's 8 entries. Open: SA F-1 (A-7b) not yet in the suite (Medium, test-only). Known shared follow-up: focus to body after Try again. QB-1 to QB-11 owed |
| 2026-10-12 | SA F-1 applied | Dev: A-7b added to `adminUsersLayout.render.test.tsx` (good load, failed Refresh, held Try again: no list, no Read at, loading text; then the lists return). Mutation (c) re-run: A-7b fails (1 failed, 53 passed), restored, checksum matched; the "survived by design" note replaced. The `notJson` helper's escaped quotes rewritten as a template literal, so the test file holds no backslash. No page change. Settings folder 54 tests |
