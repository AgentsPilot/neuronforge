# Workplan: Admin BOS Cleanup, Slice 1 (Admin users: show the truth, read-only)

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.10 (FR-AU1 to FR-AU5; FR-AU6 is **out**, OQ-1 = B), §9 slice 1 acceptance criteria, §10 TA-4 / TA-5 / TA-13, and **SA Review (2026-10-02) conditions C-1 to C-9** (binding; C-10 to C-15 belong to slice 5a and are not in this workplan)
**Branch:** `fix/admin-users-read-only`, cut from current `main` (`34d665b4` at time of writing). **RM creates it; Dev does not.** Other sessions use the main working tree on `main`, so RM should cut it in a separate worktree (mind the shared `node_modules` junction hazard when that worktree is removed later).
**Process:** Full cycle (security surface, required CI guard): Dev workplan → SA workplan review → Dev implement → SA code review → QA → user sees the uncommitted diff → user approval → RM
**Date:** 2026-10-02
**Status:** Code Complete (2026-10-02), awaiting SA code review. Implemented on `fix/admin-users-read-only` from `023dde98` in its own worktree; **nothing committed** (the user reviews the diff first). T-17 (manual browser check) is owed by the user/QA.
**Effort:** S, about 1 to 1.5 days (SA §E). The page is mostly deletion; most of the time goes on the guard, the tests and the doc.

## Overview

The `/admin/settings` page ("Admin users" in the sidebar) lists, adds and removes admins in `system_settings_config.admin_users`, a store that grants nothing, and its first load writes to that store (V-20, V-21). This slice makes it a **truthful, read-only list** of who can open admin: the active rows of the `admin_users` table, plus addresses granted only by the `ADMIN_EMAILS` environment setting, with an overlap marker where removing the row alone would not revoke access (B-7). It adds one gated read route, `GET /api/admin/admins`, moves the one `ADMIN_EMAILS` parser into a shared module, deletes the two management routes (admin-authz slice 7, folded in), empties guard rule R4's allow-list (cap 2 → 0), and updates the access doc. No database change, no new way to become an admin.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify / Delete](#3-files-to-create--modify--delete)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Manual QA Check](#6-manual-qa-check)
- [7. Acceptance Criteria This Slice Closes](#7-acceptance-criteria-this-slice-closes)
- [8. Conditions Traceability (C-1 to C-9)](#8-conditions-traceability-c-1-to-c-9)
- [9. Logging Compliance (`console.*`)](#9-logging-compliance-console)
- [10. Risks and Rollback](#10-risks-and-rollback)
- [11. PR Body Draft](#11-pr-body-draft)
- [12. Open Points for SA](#12-open-points-for-sa)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Read on `main` `34d665b4`. Schema facts are SA's live measurement (requirement §A, TA-11); this slice changes no select, so it does not re-measure.

| Area | As built today | What this slice does |
|---|---|---|
| `app/admin/settings/page.tsx` (502 lines, `'use client'`) | Calls `GET`/`POST /api/admin/settings/admin-users` (`:61`, `:124`, `:161`) and `GET /api/admin/settings/platform-users` (`:82`). Add form, role picker (admin / super_admin), platform-user browser, remove buttons, Crown badge, "About Admin Roles" box. 4 `role` comparisons (`:322`, `:447`, `:457`, `:461`) that R4 exempts. Two silent `catch` blocks (`:69`, `:88`). 0 `console.*`. | Rewritten read-only, calling only `GET /api/admin/admins` (C-4). |
| `app/api/admin/settings/admin-users/route.ts` (258 lines) | `GET` upserts the caller as `super_admin` when the JSON list is empty (V-21); `POST` adds/removes. Both gated by `requireAdmin`. 2 R4 occurrences (`:210`, `:211`). | **Deleted** (C-5). |
| `app/api/admin/settings/platform-users/route.ts` (93 lines) | Lists every auth user via unpaged `auth.admin.listUsers()` (NF-5) for the add form. Gated. Only caller is the page. | **Deleted** (C-5). |
| `lib/services/AdminAccessService.ts` | Private `parseEnvAdminEmails()` (`:51-59`), called once in the constructor (`:70`), so the env is read at construction. `listAdmins()` swallows errors to `[]` (B-6). `isAdmin` step 3 grants env admins even when their table row is deactivated (B-7). | Parser moved out to a shared module; behaviour identical; `AdminAccessService.test.ts` passes **unedited** (C-2). |
| `lib/repositories/AdminUserRepository.ts` | `listActive()` returns `{ data, error }`, never throws, explicit columns, service role by design (documented in its header). Already imported directly by `app/api/admin/archiving/route.ts`, so a route reading it is an existing precedent. | **Unchanged.** The new route calls `adminUserRepository.listActive()` (C-1). No new repository or method, so the `new-repository` skill has nothing to scaffold. |
| Guard `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | R2 fails any `route.ts` whose comment-stripped code contains the substring `AdminAccessService` (`:1654-1660`; string literals count). R4 parked list has the two entries above (`:343-346`); `CAPS.R4 = { parked: 2, permanent: 0 }` (`:406`); caps are asserted by **equality** (ratchet, `:1061-1068`); every exemption's file must exist (`:971-978`). No R1 entry exists for the two settings routes (they were gated in slices 1/2), so slice 7's "delete the 2 R1 entries" is already moot. | R4 entries deleted, cap 2 → 0 (C-6). |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | 59 cases, pinned by `toHaveLength(59)`. Three are the doomed routes: `GET` + `POST settings/admin-users` (`:252-253`), `GET settings/platform-users` (`:272`). It mocks `AdminAccessService` wholesale and `supabaseServer` with a recording fake. | −3 cases, +1 (`GET /api/admin/admins`), pin 59 → 57 (C-5). |
| Sidebar / header | `AdminSidebar.tsx:179-184` "Admin users" → `/admin/settings`, description "Who can open admin". `AdminHeader.tsx:92` "Settings" link → `/admin/settings`. | **Untouched** (C-4). FR-AU5 becomes true by the page change alone. |
| `ADMIN_EMAILS` parsers | Two in app code and scripts: `AdminAccessService.ts:51` and `scripts/seed-admin-users.ts:38-46` (its own copy, CLI-only). | One shared parser for app code (C-2). The script's copy: see open point O-3. |
| Census (quick count from disk, to be re-derived at T-14) | 59 `route.ts` files / 89 exported handlers under `app/api/admin/` on `34d665b4`. The access doc's register lists rows 1 to 86 and says the census was last re-derived 2026-09-27 (84 / 55). | After: 58 files / 87 handlers (−2 files, −3 handlers, +1 file, +1 handler), confirmed by measurement, not arithmetic. |

**Deprecated / non-compliant code noticed, not extended:** the two deleted routes construct inline service-role reads (OI-9 debt); they go away entirely. `scripts/seed-admin-users.ts` has 11 `console.*` calls and an inline client; it is a CLI script outside `lib/`, `app/`, `components/`, and it is not touched (O-3).

---

## 2. Implementation Approach

### 2.1 Shared env parser: `lib/admin/adminEmailsEnv.ts` (C-2)

```typescript
/** Parse an ADMIN_EMAILS value (comma / semicolon / whitespace separated) into a lowercased set. */
export function parseAdminEmails(raw: string | undefined | null): Set<string>;

/** Read and parse process.env.ADMIN_EMAILS at CALL time (never at module load). */
export function readEnvAdminEmails(): Set<string>;
```

- The body is moved verbatim from `AdminAccessService.ts:51-59` (`split(/[,;\s]+/)`, `trim().toLowerCase()`, `filter(Boolean)`), split into a pure function plus a thin env reader so the parser is testable without touching `process.env`.
- **Read at call time is load-bearing.** `AdminAccessService.test.ts` sets `process.env.ADMIN_EMAILS` immediately before constructing the service and restores it afterwards. A module-level constant would freeze the value at import and break that suite, which must pass unedited.
- The module name does not contain `AdminAccessService` (R2). It lives beside `requireAdminRoute.ts` and `requireAdminPage.ts`. No logger (a pure function has nothing to log). Server-only by nature (the env var has no `NEXT_PUBLIC_` prefix); no client file imports it.
- `AdminAccessService.ts`: delete the private function, `import { readEnvAdminEmails } from '@/lib/admin/adminEmailsEnv'`, and the constructor line becomes `this.envAdminEmails = readEnvAdminEmails();`. Nothing else in the file changes, and the header comment gets one line naming the shared parser.

### 2.2 Route: `app/api/admin/admins/route.ts` (C-1, C-3)

`GET` only. Shape follows `app/api/admin/archiving/route.ts` (the `new-api-route` skill's admin variant):

1. `correlationId` from `x-correlation-id` or `crypto.randomUUID()`; `requestLogger = logger.child({ correlationId })`; `logger = createLogger({ module: 'AdminAdminsAPI' })`.
2. **First statement inside `try`:** `const gate = await requireAdmin(requestLogger); if (gate instanceof NextResponse) return gate;`. Nothing above it touches the request, the database or the env.
3. `const { data, error } = await adminUserRepository.listActive();`. On `error` (or `data === null`): log `requestLogger.error({ err: error }, 'Failed to load admin list')` and return **500** `{ success: false, error: 'Failed to load admin list', details: NODE_ENV === 'development' ? message : undefined }`. **Never an empty list** (B-6).
4. `const envEmails = readEnvAdminEmails();`
5. Build the response, comparing case-insensitively (the repository stores lowercase; the route lowercases again so the comparison does not depend on that):
   - `tableAdmins`: one entry per active row, in the repository's `created_at` ascending order: `{ email, linkedToLogin: user_id !== null, addedAt: created_at, notes, alsoInEnv }`.
   - `envOnlyAdmins`: addresses in `envEmails` with no active table row, sorted: `{ email }`.
   - A table admin whose email is also in the env appears **once**, in `tableAdmins`, with `alsoInEnv: true`.
   - An env address whose table row is **deactivated** appears under `envOnlyAdmins`, because `listActive()` does not return it and step 3 of `isAdmin` still grants it. That is the truthful listing (B-7).
6. Response: `{ success: true, data: { tableAdmins, envOnlyAdmins } }`. It is built by **explicit field picking**, never by spreading a row, so `id`, `user_id`, `granted_by`, `updated_at`, `is_active`, profile data and anything from `auth.admin.listUsers()` cannot leak (C-3).
7. One `requestLogger.info({ tableCount, envOnlyCount, overlapCount }, 'Admin list served')`. **Counts only, never addresses** (SA ADMIN_EMAILS ruling).
8. Outer `catch`: `requestLogger.error({ err }, …)` and the same guarded 500.
9. `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';` (as the archiving route).

- **No Zod:** no query, params or body is read; query strings are ignored, not parsed. The header comment says so and says that any future parameter gets a Zod schema first (C-1).
- **No audit row:** a read is not a state change (archiving precedent).
- **R2:** the string `AdminAccessService` must not appear anywhere in this file's code, including string literals and log messages. It may appear in comments (the guard strips them), but the header comment will refer to "the admin access service" in prose to keep a plain grep clean too.
- Response types (`AdminListTableEntry`, `AdminListEnvEntry`, `AdminListResponse`) live in the route file and are re-declared locally in the page. **Alternative (O-6):** a tiny `lib/admin/adminList-types.ts` imported by both. Default: the shared type file, since a drifted page type would hide a renamed field.

### 2.3 Page: `app/admin/settings/page.tsx` rewrite (C-3, C-4)

Stays `'use client'` (R8). Same shell classes (`bg-slate-800 border border-slate-700 rounded-xl p-6`, the existing blue info box, `text-sm text-slate-400`); no new component, colour or icon set (D-4).

| Element | Before | After |
|---|---|---|
| Fetches | `settings/admin-users` (GET, POST ×2), `settings/platform-users` | **only** `GET /api/admin/admins` (on mount and on the Refresh button) |
| Header title / badge / subtitle | "Admin Settings" / "System Config" / "Manage admin users and system settings" | "Admin users" / "Read-only" (same badge classes) / "Who can open admin. Read-only." (title and badge are O-5) |
| Add Admin button, add form, role picker, platform-user browser, manual email entry | present | **removed** |
| Per-row remove button, Crown icon, Admin / Super Admin badge | present | **removed** (FR-AU2) |
| "About Admin Roles" box | present | **removed**; the same blue box now carries FR-AU4 |
| Table admins section | — | heading "From the admin_users table"; per row: email; "Linked to a login: yes" / "Linked to a login: not yet"; "Added {date}"; `notes` if present; and, when `alsoInEnv`, the marker text **"Also in the environment setting: removing the row alone does not revoke access"** (existing `text-xs` slate/blue classes) |
| Environment admins section | — | heading **"Granted by the ADMIN_EMAILS environment setting"**; one row per address; if none, "No addresses beyond the table." |
| Empty table (no error) | "No admin users configured / Add admin users…" | "No active rows in the admin_users table." (truthful, distinct from an error) |
| Error state | banner then an empty list | the existing red banner style with "Could not load the admin list. Nothing is shown rather than a list that may be wrong." and **no list sections rendered at all**; covers a 500, a `success: false` body and a network rejection |
| Info box (FR-AU4) | — | Two lines: "Access comes from the admin_users table or the ADMIN_EMAILS environment setting. To add or remove an admin, run the seed script or SQL, as described in docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md § Bootstrapping Admins. Table changes reach every server within about a minute; an ADMIN_EMAILS change needs a redeploy." The doc path is plain text, not a link: the app does not serve `/docs` (C-4). |
| Logging | two silent `catch` blocks | `clientLogger.child({ module: 'AdminUsersPage' })` from `@/lib/logger/client` (TA-3, PR #168 precedent); one `logger.warn({ err, status }, 'Admin list request failed')`; no email in any log argument |
| State | 8 `useState`s | `status: 'loading' \| 'ready' \| 'error'` and the data; no `saving`, form or search state |

"Changes reach every server within about a minute" is C-4's wording; the redeploy clause is added because `ADMIN_EMAILS` is read at process start, so the minute only holds for table edits (see O-2).

### 2.4 Deletions (C-5)

`git rm app/api/admin/settings/admin-users/route.ts app/api/admin/settings/platform-users/route.ts`. The now-empty `app/api/admin/settings/` directory disappears with them. `system_settings_config.admin_users` rows stay in the database (OI-7 of the authz workplan); nothing reads or writes them after this slice.

### 2.5 Guard ratchet (C-6)

In `admin-authz-surface.guard.test.ts`:
- Delete both `R4_PARKED` entries, leaving `const R4_PARKED: ReadonlyArray<Exemption> = [];` with a short dated comment ("emptied 2026-10-xx by ADMIN_BOS_CLEANUP slice 1; admin-authz slice 7's routes deleted, the page rewritten without role comparisons; `CAPS.R4.parked` 2 → 0 in the same commit"), in the voice of the existing R1/R2 removal comments.
- `CAPS.R4: { parked: 0, permanent: 0 }`. **No other cap moves.** The new route adds no exemption.
- Update the R4 doc comment above the list ("Neither entry below reads `profiles`…") to say the list is empty.
- The W-8 regex fixture test (`:1713-1718`) stays: it tests the regex on a literal string, not the deleted file. Its comment that cites `admin-users/route.ts:211` gets "(file deleted 2026-10-xx; the shape is still pinned)".
- Optional, default yes (O-4): add R4 to the "R3 and R5 are genuinely zero" assertion (`:1071-1077`), renaming it "R3, R4 and R5 …".

### 2.6 `adminGate.writes.test.ts` (C-5)

- Remove the imports `adminUsersSettings` (`:175`) and `platformUsers` (`:185`) and the three cases at `:252-253` and `:272` (including the "Category C — the write hidden behind a GET" sub-heading, which then has no cases).
- Add `import * as adminsList from '../admins/route';` and, in a new dated block, `{ name: 'GET /api/admin/admins', call: () => adminsList.GET(req('/api/admin/admins', 'GET')) }`. It inherits the four denial cases (401 / 403 + `['audit_trail']` only / 403 on a throwing check / 401 on a throwing auth lookup), the pass-through case and the "no `@` in any denial log or body" sweep.
- `toHaveLength(59)` → `toHaveLength(57)`, with the arithmetic comment extended: "− 3 deleted with admin-authz slice 7's routes (ADMIN_BOS_CLEANUP slice 1) + 1 `admins#GET`, gated from birth = 57".
- The file header's sentence about "the 22nd (`settings/admin-users`)" is historical; it gets "(since deleted)" rather than a rewrite, so the narrative stays true.
- Pass-through check for the new case: `supabaseServer` is the recording fake, `from('admin_users')` resolves `{ data: [], error: null }`, so an admin gets 200.

### 2.7 Documentation (C-7)

Targeted `Edit` insertions only; no doc is rewritten whole.

`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`:
- **Register:** rows 47, 48, 49 kept for numbering but marked `~~struck~~` with state "🗑 deleted 2026-10-xx (ADMIN_BOS_CLEANUP slice 1, folding in admin-authz slice 7)". New row for `admins#GET` (number = next free, 87): "✅ gated, `requireAdmin` first statement, new in ADMIN_BOS_CLEANUP slice 1. Read-only list of active `admin_users` rows plus `ADMIN_EMAILS`-only addresses; reads `AdminUserRepository.listActive()`, not the service (R2); 500 on a read error, never an empty list; logs counts only."
- **Census re-measured from disk** (T-14) and the header line / "What is true" row / register heading updated with the measured figures and a note on how they were derived.
- **CI caps table:** R4 → **0** (was 2) / 0, note "Emptied 2026-10-xx: slice 7's routes deleted and the page rewritten read-only."
- **What is NOT true:** the "admin Settings screen has been retired" row is restated: the screen is not retired, it is now a **truthful read-only list**; the management routes are **deleted**; adding or removing an admin is the seed script or SQL.
- **Open items:** OI-2b restated as ✅ done in its new form (page kept read-only, routes deleted); OI-3 marked ✅ done, with the correction that the route uses `requireAdmin` and the repository, not the service (R2, B-6).
- **Components table:** add `lib/admin/adminEmailsEnv.ts` and `app/api/admin/admins/route.ts`.
- **§ Bootstrapping Admins:** add a short "Removing an admin" paragraph (SQL deactivate, plus remove from `ADMIN_EMAILS` and redeploy if present; within about 60 s for the table). The page now points here for "granted and revoked" (FR-AU4), and the section today only describes adding. See O-1.
- **Change History:** one row.

`docs/workplans/admin-authz-unification.md`: slice 7 status ⬜ → "✅ routes folded into ADMIN_BOS_CLEANUP slice 1; page kept, read-only" in the slice heading block and in the slice status table; task lines 7.2, 7.5, 7.6 marked done there with the same pointer; 7.3 / 7.4 marked "not done by decision (page kept, C-4)"; one Change History row. OI-7 is already raised in that workplan (`:1494`), so 7.10 is marked done by reference.

The requirement file is **not** edited by Dev.

---

## 3. Files to Create / Modify / Delete

| # | File | Action | What changes |
|---|------|--------|--------------|
| 1 | `lib/admin/adminEmailsEnv.ts` | **create** | `parseAdminEmails(raw)` + `readEnvAdminEmails()`, moved from the service (2.1). |
| 2 | `lib/admin/__tests__/adminEmailsEnv.test.ts` | **create** | Parser unit tests + a source assertion that the service uses the shared module (5.3). |
| 3 | `lib/services/AdminAccessService.ts` | modify | Delete private `parseEnvAdminEmails`; import `readEnvAdminEmails`; constructor line. Behaviour identical. |
| 4 | `app/api/admin/admins/route.ts` | **create** | `GET` only, `requireAdmin` first, `adminUserRepository.listActive()`, env split, explicit field picking, guarded 500, counts-only log (2.2). |
| 5 | `lib/admin/adminList-types.ts` | **create** (O-6) | Response types shared by route and page. |
| 6 | `app/api/admin/admins/__tests__/route.test.ts` | **create** | Route tests (5.1). File name ends `.test.ts`, so the guard's `/route\.(ts…)$` regex does not treat it as a route. |
| 7 | `app/admin/settings/page.tsx` | modify (rewrite) | Read-only page (2.3). Expected roughly 500 → 200 lines. |
| 8 | `app/admin/settings/__tests__/page.render.test.tsx` | **create** | jsdom render tests (5.2). |
| 9 | `app/api/admin/settings/admin-users/route.ts` | **delete** | C-5. |
| 10 | `app/api/admin/settings/platform-users/route.ts` | **delete** | C-5. |
| 11 | `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | −2 imports, −3 cases, +1 import, +1 case, pin 59 → 57, comments (2.6). |
| 12 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | R4 entries deleted, `CAPS.R4.parked` 2 → 0, comments, optional zero assertion (2.5). |
| 13 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | C-7 edits (2.7). |
| 14 | `docs/workplans/admin-authz-unification.md` | modify | Slice 7 status and tasks, Change History (2.7). |
| 15 | `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_1_WORKPLAN.md` | create (this file) | Workplan, then implementation notes. |

**Not touched:** `AdminUserRepository.ts`, `AdminSidebar.tsx`, `AdminHeader.tsx`, both nav tests, `lib/services/__tests__/AdminAccessService.test.ts` (must pass unedited), `scripts/seed-admin-users.ts`, any migration, the requirement file.

---

## 4. Task List

- [x] ✅ **T-0** Confirm `git branch --show-current` = `fix/admin-users-read-only` (RM-created, in its own worktree). If not, stop and escalate to TL. Record the base SHA here.
- [x] ✅ **T-1** Baseline: run `npm run test:authz-guard`, `npx jest app/api/admin/__tests__/adminGate.writes.test.ts lib/services/__tests__/AdminAccessService.test.ts lib/repositories/__tests__/AdminUserRepository.test.ts app/admin/components/__tests__` and record green counts. Run the full-project `tsc` once (5.5) to record the pre-existing error baseline.
- [x] ✅ **T-2** Create `lib/admin/adminEmailsEnv.ts` (2.1) and its test (5.3).
- [x] ✅ **T-3** Point `AdminAccessService.ts` at the shared reader. Run `AdminAccessService.test.ts` **unedited**: it must pass with no diff to the test file (`git diff --stat lib/services/__tests__` empty).
- [x] ✅ **T-4** Create `lib/admin/adminList-types.ts` (or local types, per O-6).
- [x] ✅ **T-5** Create `app/api/admin/admins/route.ts` (2.2). `grep -n AdminAccessService app/api/admin/admins/route.ts` returns nothing.
- [x] ✅ **T-6** Write the route tests (5.1); green.
- [x] ✅ **T-7** Rewrite `app/admin/settings/page.tsx` (2.3).
- [x] ✅ **T-8** Write the page render tests (5.2); green.
- [x] ✅ **T-9** `git rm` the two settings routes (C-5).
- [x] ✅ **T-10** Update `adminGate.writes.test.ts` (2.6); green at 57 cases.
- [x] ✅ **T-11** Guard: delete both R4 entries, `CAPS.R4.parked` 2 → 0, comments, optional R4 zero assertion (2.5). `npm run test:authz-guard` green.
- [x] ✅ **T-12** Deliberate-breakage checks (5.4): R4 with an empty allow-list, the ratchet, and R2 on the new route. Record the exact failure lines; revert each; re-run green.
- [x] ✅ **T-13** Reference sweep: `git grep -n "settings/admin-users\|settings/platform-users" -- app components lib hooks tests scripts` returns nothing (see O-7 for docs). `git grep -n "parseEnvAdminEmails"` returns nothing.
- [x] ✅ **T-14** Re-measure the census from disk (files, handlers, `requireAdmin` vs inline) with a scratch script in the session scratchpad, not committed; record method and figures here.
- [x] ✅ **T-15** Doc edits (2.7) in both docs. After each doc edit, `git diff --stat` on that file must show insertions roughly matching deletions and no large deletion (truncation hazard).
- [x] ✅ **T-16** Checks (5.5): targeted Jest run, `tsc` with exit code, ESLint on touched files, `npm run lint:hooks`.
- [ ] ⬜ **OWED by user/QA** (Dev cannot run a signed-in browser; steps in section 6 and Implementation Notes) **T-17** Manual check as a platform admin on `npm run dev` (section 6), recorded here.
- [x] ✅ **T-18** Fill Implementation Notes (deviations, measured figures, breakage output), set Status to Code Complete, and hand to TL for SA code review. **Do not commit**; leave the diff uncommitted for the user.

---

## 5. Test Plan

### 5.1 Route: `app/api/admin/admins/__tests__/route.test.ts`

Mocks as in `jobs-queues/__tests__/route.test.ts`: `@/lib/auth` (`getUser`), `@/lib/services/AdminAccessService` (`isAdmin`, consumed by `requireAdmin`), `@/lib/logger` (records every argument), and `@/lib/repositories/AdminUserRepository` (`adminUserRepository.listActive`). `process.env.ADMIN_EMAILS` set per test and restored in `afterEach`.

| # | Case | Asserts |
|---|---|---|
| R-1 | Happy path: 2 active rows (one with `user_id`, one `null`, one with `notes`), env `"Ops@Example.com; extra@x.io"` where `ops@example.com` is a table row | 200; `tableAdmins` in repository order with `linkedToLogin` true / false, `addedAt`, `notes`; the overlapping row has `alsoInEnv: true` and appears **once**; `envOnlyAdmins` = `[{ email: 'extra@x.io' }]` |
| R-2 | Case-insensitive overlap both ways (env upper case, row lower case; and a mixed-case row if the repository ever returned one) | no duplicate; marker set |
| R-3 | Env address whose row is deactivated (not in `listActive`) | listed under `envOnlyAdmins` |
| R-4 | `ADMIN_EMAILS` unset / empty | `envOnlyAdmins` = `[]`, all `alsoInEnv` false |
| R-5 | Repository returns `{ data: null, error }` | **500**, `success: false`, `error: 'Failed to load admin list'`; body has **no** `tableAdmins` / `envOnlyAdmins`, so nothing reads as an empty list; logger got `{ err }` |
| R-6 | `NODE_ENV` production vs development on R-5 | `details` absent in production, present in development |
| R-7 | Serialised body on R-1 | contains none of `user_id`, `granted_by`, `updated_at`, `is_active`, the row `id` values, or the planted `user_id` UUID |
| R-8 | Every logger argument on R-1 | `JSON.stringify` contains no `@` (counts only); the info call carries `tableCount`, `envOnlyCount`, `overlapCount` |
| R-9 | 401 signed out, 403 non-admin | `listActive` **not called** on either (gate first). The full four-case denial matrix lives in the shared list. |
| R-10 | Query string present (`?x=1`) | ignored, 200, same body (no parsing) |

### 5.2 Page: `app/admin/settings/__tests__/page.render.test.tsx` (jsdom)

Pattern as `app/admin/archiving/__tests__/page.render.test.tsx`; `global.fetch` is a `jest.fn` that records every URL and method; `@/lib/logger/client` mocked.

| # | Case | Asserts |
|---|---|---|
| P-1 | Loaded list | table emails, "Linked to a login: yes" / "not yet", "Added …", notes rendered |
| P-2 | Overlap | the marker text "Also in the environment setting: removing the row alone does not revoke access" appears on exactly the overlapping row |
| P-3 | Env section | heading "Granted by the ADMIN_EMAILS environment setting" and its address |
| P-4 | **No write controls** | no button or input whose accessible name matches `/add|remove|delete|grant|revoke/i`; no `Super Admin`, no `/\brole\b/i` text; no `input` elements at all; the only button is Refresh |
| P-5 | **No old routes** | across mount and a Refresh click, every `fetch` call URL is `/api/admin/admins`, method GET; none contains `settings/admin-users` or `settings/platform-users` |
| P-6 | Error state on 500 / `success: false` | error text shown; **neither** list heading rendered; "No active rows" text **not** shown |
| P-7 | Error state on network rejection | as P-6; logger `warn` called |
| P-8 | Empty table, no error | "No active rows in the admin_users table." |
| P-9 | FR-AU4 copy | the info box names `admin_users`, `ADMIN_EMAILS`, the doc path as text and no `<a>` pointing at `/docs` |

Plus a two-line source assertion (in the same file or a `page.source.guard.test.ts`) that the comment-stripped page source contains no `console.`, imports `@/lib/logger/client`, and contains neither old route path, so the guarantee does not depend only on what one render happened to call.

### 5.3 Env parser: `lib/admin/__tests__/adminEmailsEnv.test.ts`

| # | Case |
|---|---|
| E-1 | comma: `a@x.io,b@x.io` |
| E-2 | semicolon: `a@x.io;b@x.io` |
| E-3 | whitespace and newlines, leading/trailing separators, doubled separators: `"  a@x.io ,, ;\n b@x.io  "` |
| E-4 | mixed case lowercased; duplicates collapse (`A@X.io,a@x.io` → one) |
| E-5 | `undefined`, `null`, `''`, `' , ; '` → empty set |
| E-6 | `readEnvAdminEmails()` reads at call time: set env, call, change env, call again, get the new value |
| E-7 | Source: `AdminAccessService.ts` imports from `@/lib/admin/adminEmailsEnv` and its comment-stripped code has no `.split(` on the env value; `app/api/admin/admins/route.ts` imports the same module (one parser, C-2) |

### 5.4 Guard and deliberate breakage (C-6)

Run `npm run test:authz-guard` green after T-11. Then, one at a time, each reverted before the next and the final run green:

| # | Breakage | Expected failure |
|---|---|---|
| B-1 | Scratch file `lib/admin/__scratch_r4__.ts` with `export const f = (p: { role: string }) => p.role === 'admin';` | R4 "no access decision on a role value outside the allow-list" fails naming that file, with an **empty** allow-list |
| B-2 | Re-add one R4 parked entry (for an existing file) without touching the cap | ratchet: "R4: no more than 0 PARKED exemptions" fails with the RATCHET_HINT object, and the equality drift test fails |
| B-3 | Add `const x = 'AdminAccessService';` to `app/api/admin/admins/route.ts` | R2 fails naming the new route |

The exact failure lines go into Implementation Notes and the PR body.

### 5.5 Type-check, lint and regression

- **tsc, exit code checked (C-8):** `ts-jest` does not type-check here. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p <scratch tsconfig>` where the scratch config (in the session scratchpad) `extends` the repo `tsconfig.json` and lists only the touched `.ts`/`.tsx` files plus `next-env.d.ts` and the global type files under `"files"`; then `echo $?` must print **0**. If it is non-zero only because of pre-existing errors in **untouched** files pulled in transitively, record them, and fall back to the full-project method used in admin reorganisation slice 1: full `tsc --noEmit` on the branch and on a clean tree, compare the sorted error lists, and require **zero** errors in touched files. That fallback is O-8.
- ESLint on every touched code file: 0 errors. `npm run lint:hooks` green.
- Regression set: `npx jest lib/admin app/api/admin app/admin lib/services/__tests__/AdminAccessService.test.ts lib/repositories/__tests__/AdminUserRepository.test.ts`. Expected green except anything already red on `main` (recorded at T-1). Note: the shared tree has untracked probe tests from other sessions (`app/admin/audit-trail/__tests__/zz.probe.test.tsx`, `lib/audit/__tests__/__probe.test.ts`); they are not part of this branch and are excluded if they appear.

---

## 6. Manual QA Check

As a platform admin on `npm run dev` (dev database, read-only use):

1. Open `/admin/settings` from the sidebar "Admin users". The two real admins are listed under the table section, with "Linked to a login" and "Added".
2. With `ADMIN_EMAILS` set locally to one table address and one other address: the table row shows the overlap marker; the other address is under "Granted by the ADMIN_EMAILS environment setting".
3. DevTools Network: only `GET /api/admin/admins`; no request to `settings/admin-users` or `settings/platform-users`; no POST at all. Click Refresh: same.
4. No add, remove or role control anywhere on the page.
5. As a signed-in non-admin: `/admin/settings` redirects (layout guard); `GET /api/admin/admins` returns 403 with no list.
6. Header dropdown "Settings" link still opens the page; the sidebar entry is unchanged.

---

## 7. Acceptance Criteria This Slice Closes

| §9 criterion (read with C-9) | Proven by |
|---|---|
| The page lists exactly the active rows of `admin_users`, plus environment admins labelled separately, including the overlap marker | R-1 to R-4, P-1 to P-3 |
| Loading the page performs no write (neither the GET nor the POST of `settings/admin-users` is called) | P-5 + source assertion; the routes no longer exist (T-9, T-13) |
| There is no add, remove or role control on the page | P-4 |
| A non-admin is refused (page and the new route); a happy path and one failure path are tested | shared four-case denial list (2.6), R-9, R-5, layout guard (existing `requireAdminPage` tests), manual step 5 |
| All slices: happy path + failure path per new route; QA manual check | 5.1, section 6 |

---

## 8. Conditions Traceability (C-1 to C-9)

| Condition | Where |
|---|---|
| C-1 new route, repository read, no service import, no params | 2.2, T-5, B-3 |
| C-2 one env parser, service behaviour-identical, its test unedited | 2.1, T-2, T-3, E-7 |
| C-3 what the page shows and what the API returns; 500 not empty | 2.2, 2.3, R-1 to R-8, P-6 |
| C-4 page rewrite, read-only, doc path as text, sidebar untouched | 2.3, P-4, P-9 |
| C-5 delete the two routes, adminGate 59 → 57, grep clean, OI-7 recorded | 2.4, 2.6, T-9, T-10, T-13, O-7 |
| C-6 R4 entries deleted, cap 2 → 0, deliberate breakage, no other cap | 2.5, T-11, T-12, B-1, B-2 |
| C-7 access doc and authz workplan, PR body steps | 2.7, T-15, section 11 |
| C-8 route, page, parser tests; tsc with heap flag and exit code | 5.1 to 5.3, 5.5, O-8 |
| C-9 §9 read with C-3 | section 7 |

---

## 9. Logging Compliance (`console.*`)

Counted with `grep -c "console\."` on `34d665b4`.

| File | `console.*` | Plan |
|---|---|---|
| `app/admin/settings/page.tsx` | 0 | Stays 0. Its two **silent** `catch` blocks are replaced by one `clientLogger` warn (CLAUDE.md "never swallow errors"). Source assertion in 5.2. |
| `app/api/admin/admins/route.ts` (new) | 0 | Pino `createLogger` + `child({ correlationId })`, `{ err }` on errors, counts only. |
| `lib/admin/adminEmailsEnv.ts` (new) | 0 | No logging (pure). |
| `lib/admin/adminList-types.ts` (new) | 0 | Types only. |
| `lib/services/AdminAccessService.ts` | 0 | Already Pino. |
| `app/api/admin/settings/admin-users/route.ts` | 0 | Deleted. |
| `app/api/admin/settings/platform-users/route.ts` | 0 | Deleted. |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | 0 | Test. |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | 0 | Test. |
| New test files | 0 | — |
| `scripts/seed-admin-users.ts` (**not touched**, listed for the record) | 11 | CLI script outside the rule's `lib/`/`app/`/`components/` scope. Not converted here (O-3). |

No Pino conversion is needed in this slice: every touched file is already compliant (matches SA's TA-13 count).

---

## 10. Risks and Rollback

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| The new route trips **R2** because `AdminAccessService` appears in a string or log message | Medium if careless / blocks merge (required check) | 2.2 rule; T-5 grep; B-3 proves R2 still sees it |
| `AdminAccessService.test.ts` breaks because the env is read at import time | Low / test red | Reader runs at call time (2.1); E-6; the suite runs unedited at T-3 |
| The page shows **"no admins"** on a failed read (the very lie being removed) | Low / high trust impact | Route 500 with no list fields; page error state renders no list (R-5, P-6) |
| An operator reads "deactivate the row" as a revoke for an env admin | Medium / dangerous direction | Overlap marker (C-3) and the env section label; doc removal paragraph (O-1) |
| ADMIN_EMAILS addresses exposed beyond admins | Low | Behind `requireAdmin` only; logs carry counts only (R-8); denial bodies and logs swept for `@` by the shared list |
| Someone relied on the page to add an admin | Low (two admins, rare change) | PR body and doc carry the script/SQL steps; nothing it did granted access anyway |
| Census figures in the doc drift again | Medium / doc only | Re-measured from disk with the method written down (T-14) |
| Doc edit truncates a long doc (known agent hazard) | Low / high | Targeted `Edit`s only; `git diff --stat` after each (T-15) |
| Shared working tree with other sessions | Medium | Work only on the RM-created branch in its own worktree; never stage the other sessions' untracked files |

**Rollback:** one PR, no migration, no data change. `git revert` of the merge restores the old page, both routes (still gated, so no anonymous write reopens), the R4 entries together with `CAPS.R4.parked = 2` (same commit, so the equality ratchet stays green), the old `adminGate` list at 59, and the old parser location. The `system_settings_config.admin_users` rows were never touched. Slice 5a is a separate PR on disjoint files, so it is not taken out by this revert.

---

## 11. PR Body Draft

```markdown
## fix(admin): Admin users page shows the truth, read-only (ADMIN_BOS_CLEANUP slice 1)

### Why
`/admin/settings` ("Admin users") listed, added and removed admins in
`system_settings_config.admin_users`, a store that grants nothing. "Removing" an
admin there left their access intact, and opening the page could write to that
store. Real access comes from the `admin_users` table (and the `ADMIN_EMAILS`
environment setting).

### What changes
- New `GET /api/admin/admins`: `requireAdmin` first, reads
  `AdminUserRepository.listActive()`, adds addresses granted only by `ADMIN_EMAILS`,
  marks a table admin who is also in `ADMIN_EMAILS` ("removing the row alone does
  not revoke access"). 500 on a read error, never an empty list. Logs counts only.
- One `ADMIN_EMAILS` parser, `lib/admin/adminEmailsEnv.ts`, used by the access
  service (behaviour identical; its test passes unedited) and the new route.
- `/admin/settings` rewritten read-only: no add, remove or role control; the only
  request it makes is the new GET.
- Deleted `app/api/admin/settings/admin-users/route.ts` and
  `app/api/admin/settings/platform-users/route.ts` (admin-authz slice 7, folded in).
- Guard: R4 parked allow-list emptied, `CAPS.R4.parked` 2 -> 0. No other cap moved.
  `adminGate.writes` cases 59 -> 57.
- Docs: access doc register, census, caps, OI-2b / OI-3; authz workplan slice 7.

### Deliberate-breakage checks (guard)
<paste B-1, B-2, B-3 failure lines>

### How to add or remove an admin (there is no button, by decision OQ-1 = B)
**Add (either path, both idempotent on email, both re-activate a soft-revoked row):**
1. Script: in `.env.local` (pointing at the target Supabase project), set
   `ADMIN_EMAILS=existing@x.com,new.admin@x.com`, then run
   `npx tsx scripts/seed-admin-users.ts`.
2. SQL: add the address to the `VALUES` list in
   `supabase/migrations/20260701_seed_admin_users.sql` and run that statement in the
   Supabase SQL editor.
The new admin's `user_id` binds on their first admin request if they have no login
yet. Other servers see the change within about 60 seconds (cache).

**Remove:**
1. `UPDATE public.admin_users SET is_active = false WHERE lower(trim(email)) = lower(trim('person@x.com'));`
   Check that it reports **1 row**, then refresh the Admin users page.
   (A hand-inserted row can be mixed case; matching the stored value alone could revoke nothing, silently.)
2. If the address is also in `ADMIN_EMAILS` on Vercel, remove it there and redeploy.
   Until then the person **still has access** (the env setting grants it on its own).
   The page marks such admins.
3. Remove the address from `supabase/migrations/20260701_seed_admin_users.sql`'s `VALUES`
   list and from every `ADMIN_EMAILS` (including `.env.local`). Both add paths upsert
   `is_active = true`, so a re-run would silently re-activate the admin.
Revocation takes effect within about 60 seconds in the app, immediately in RLS.

Full reference: docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md § Bootstrapping Admins.

### Tests
<route / page / parser / guard / adminGate counts; tsc exit code>

### Rollback
`git revert` restores the old page and both routes (still gated) together with the
R4 entries and cap. No migration, no data change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 12. Open Points for SA

| # | Point | Dev default |
|---|---|---|
| **O-1** | FR-AU4 / C-4 point the page at § Bootstrapping Admins for how access is "granted **and revoked**", but that section only describes adding. C-7 does not list an edit there. | Add a short "Removing an admin" paragraph (the PR body's Remove steps) by targeted insertion. Otherwise the page points at a doc that does not answer half its sentence. |
| **O-2** | C-4's "changes reach every server within about a minute" is true for table edits only. `ADMIN_EMAILS` is read at process start (service constructor), so an env change needs a redeploy. | Page copy says both (2.3). |
| **O-3** | `scripts/seed-admin-users.ts:38-46` has a **third** `ADMIN_EMAILS` parser (same regex, returns an array). C-2 names only the service and the route. | Leave the script alone in this slice (a CLI script outside the rule's scope, 11 `console.*`, inline client by documented necessity) and record it as debt in the access doc's Change History row. Alternative: import the shared parser from the script, a two-line change, if SA wants strictly one parser. |
| **O-4** | C-6 says no other cap moves. Adding R4 to the existing "R3 and R5 are genuinely zero" assertion is not a cap change, and it makes "R4 is clean" a stated result rather than an implication of a 0 cap. | Add it. Drop if SA considers it outside C-6. |
| **O-5** | Header title "Admin Settings" and badge "System Config" also misdescribe the page. C-4 names only the subtitle. | Title "Admin users" (matches the sidebar), badge "Read-only", same classes. Copy only (D-4). |
| **O-6** | Response types: shared `lib/admin/adminList-types.ts` versus re-declared in the page. | Shared type file (a type-only import into a client file of a module with no runtime code). |
| **O-7** | C-5 says `git grep "settings/admin-users\|settings/platform-users"` must return nothing outside `.next/`. As written that cannot hold: dated historical docs (the authz requirement, the authz workplan, the identity sweep and Layer 2 workplans) cite those paths, and the access doc must still name rows 47 to 49 to mark them deleted. | Read C-5 as **code paths**: `git grep … -- app components lib hooks tests scripts` returns nothing. The `adminGate` header and the guard's W-8 comment keep historical wording marked "(since deleted)" without the literal path, so the code grep is clean. Historical docs are not rewritten. |
| **O-8** | C-8's "tsc on the touched files, check the exit code": a file-scoped `tsc` still type-checks transitively imported modules, some of which may carry pre-existing errors, which would make a non-zero exit meaningless. | Try the scratch-tsconfig run first and expect exit 0. If untouched transitive files make it non-zero, fall back to the full-project clean-tree comparison with zero errors in touched files, and record both outputs (5.5). |
| **O-9** | Census: on `34d665b4` a quick count gives 89 handlers in 59 files, while the register ends at row 86. At least the three invite handlers flagged on 2026-09-29 are unregistered. C-7 asks for a re-measured census. | Re-measure and state the true totals. Register only `admins#GET` (row 87) in this slice and list any other unregistered handlers by name in the Change History row, rather than registering unrelated routes in an authz-surface PR. If SA prefers the register complete, adding those rows is doc-only and small. |
| **O-10** | `AdminHeader.tsx:92` labels its link to this page "Settings". C-4 keeps the link. | Leave it unchanged (C-4). Noted only because the page is no longer a settings page. |

---

## Implementation Notes (Dev, 2026-10-02)

**Branch / base (T-0):** `fix/admin-users-read-only`, worktree `neuronforge-admin-users`, base `origin/main` **`023dde98`** (newer than the `34d665b4` this plan was read on; all baselines re-taken there). Nothing staged or committed; the two route deletions are plain working-tree deletions, not `git rm`.

### Baselines on `023dde98` (T-1)

| Check | Result |
|---|---|
| Guard, `adminGate.writes`, `AdminAccessService`, `AdminUserRepository`, `app/admin/components/__tests__` | 6 suites, **464 / 464** |
| Full-project `tsc` | Stopped by the 20-minute background limit before finishing (no output). Replaced by the W-1 scoped method below with a clean-base comparison |

### Results after implementation (T-16)

| Check | Result |
|---|---|
| Key suites (new route 15, new page 21, new parser 8, `AdminAccessService` **unedited** 10, `adminGate.writes` 288 = 57 cases, guard 119, `AdminSidebar.nav` 20, `business-os-llm` nav 5, `business-os-tiers` nav 6, `AdminUserRepository` 11) | 10 suites, **503 / 503** |
| Regression set (5.5: `lib/admin app/api/admin app/admin` + service + repository) | 87 suites, 2326 / 2327. The one failure is a 5 s timeout under load in `app/admin/business-os-invites/__tests__/page.render.test.tsx` (unchanged vs base); re-run alone: **52 / 52**. Not related to this slice |
| `git diff --stat lib/services/__tests__` | empty (the service test is unedited) |
| **tsc, scoped (W-1)**: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <scratch>/tsconfig.touched.json`, which `extends` the repo config with `"include": []`, `"incremental": false` and `"files"` = the 10 touched/new `.ts`/`.tsx` files + `types/*.d.ts` (`next-env.d.ts` does not exist in a fresh worktree). Program = 93 repo files (transitive imports), not the whole project | **exit 2**, 18 errors, **all in 6 untouched files** pulled in transitively (`lib/analytics/aiAnalytics.ts` 6, `lib/audit/admin-helpers.ts` 4, `lib/memory/MemorySummarizer.ts` 4, `lib/services/EmbeddingService.ts` 2, `lib/audit/ais-helpers.ts` 1, `lib/memory/MemoryConsolidationScheduler.ts` 1). **Zero errors in touched or new files** |
| **tsc, clean base**: same method on a `git archive 023dde98` copy (in a temporary worktree subdirectory so `node_modules` resolves by walking up; `paths`/`baseUrl`/`typeRoots` pointed at the copy; removed afterwards), roots = the base versions of the touched files incl. the two deleted routes | **exit 2**, 18 errors, **identical** to the branch list (sorted `diff`: no line added, none removed). Re-run after the last test edit: still identical |
| ESLint on the 10 touched code files | exit 0, 0 errors, 0 warnings (two unused-parameter warnings in the page test fixed by typing the fetch mock) |
| `npm run lint:hooks` | exit 0 |

### Deliberate breakage (T-12, W-10). Each reverted from a scratch backup; final runs green

| # | Breakage | Result |
|---|---|---|
| B-1 | `lib/admin/__scratch_r4__.ts` with `p.role === 'admin'` | ✕ `R4 — no access decision reads a user-writable role › no access decision on a role value outside the allow-list`: `"lib/admin/__scratch_r4__.ts — makes an access decision from a \`role\` value. profiles.role is USER-WRITABLE …"`, with an **empty** allow-list |
| B-2 | Re-add an R4 parked entry (`app/admin/settings/page.tsx`), cap left at 0 | ✕ `R4: no more than 0 PARKED exemptions` (`{ cap: 0, parked: 1, ratchet: "THE RATCHET RULE — this list may only SHRINK. …" }`), ✕ `the caps match the lists exactly — a slack cap is as bad as no cap`, ✕ `R3, R4 and R5 are genuinely zero` |
| B-3 | `const x = 'AdminAccessService';` in `app/api/admin/admins/route.ts` | ✕ `R2 — no route file resolves admin identity for itself`: `"app/api/admin/admins/route.ts — imports AdminAccessService directly. Route handlers must use \`requireAdmin\` …"` |
| B-4 | Both R4 entries deleted, `CAPS.R4.parked` left at **2** | ✕ `the caps match the lists exactly — a slack cap is as bad as no cap`: `{ rule: "R4", parked: 0, capParked: 2, permanent: 0, capPermanent: 0, ratchet: "THE RATCHET RULE — …" }` |
| B-5 | `adminUserRepository.listActive()` moved above `requireAdmin` in the route | ✕ route R-9 401 and 403 (`expect(mockListActive).not.toHaveBeenCalled()`: received 1 call); ✕ all four `adminGate.writes` denial cases for `GET /api/admin/admins` (401: `mockTablesTouched` received `["admin_users"]`, expected `[]`) |

### Sweeps (T-13, W-9)

- `git grep --untracked -n "settings/admin-users\|settings/platform-users" -- . ':!docs'` → nothing (exit 1).
- `git grep -n parseEnvAdminEmails` → nothing. The parser test checks the old name through a regex (`/parseEnv\w*Emails/`) so the grep stays empty once the test is tracked.
- `grep -n AdminAccessService app/api/admin/admins/route.ts` → nothing.

### Census (T-14, W-8)

A scratch Node script (not committed) walks `app/api/admin/**/route.ts` (skips `__tests__`), strips comments, counts exported `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS` functions or consts, and classifies `requireAdmin(` in the handler body vs a file that names the access service.

| Tree | Files | Handlers | `requireAdmin` | inline | open |
|---|---|---|---|---|---|
| `023dde98` (`git archive`) | 59 | 89 | 83 | 6 | 0 |
| branch | **58** | **87** | **81** | **6** | **0** |

Register vs measured on `023dde98`: 86 rows; the only handlers missing were `business-os/invites#GET`, `#POST` and `business-os/invites/[inviteId]/revoke#POST`. `requireAdmin` re-confirmed as the first statement of each (`invites/route.ts:79`, `:136`; `revoke/route.ts:34`). After the doc edit: 90 rows, 3 struck (47–49), **87 live = 87 measured**.

### Doc edits (T-15). Targeted `Edit`s only; `git diff --stat` after each

| File | Final stat | Notes |
|---|---|---|
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | +53 / −12 | Census header + "84 → 89 → 87" note with the method; "What is true" row; Settings row in "What is NOT true"; register heading (87), count line, rows 47–49 struck, rows 87–90 added; caps R4 → 0; Components (+2 rows); § Bootstrapping Admins "Removing an admin" (W-6 re-activation trap, timing, the `is_platform_admin()` asymmetry: SA suggestion 2, verified in `20260920a…rls.sql`, which reads the table only); OI-2b, OI-3 done; new **OI-12** (seed script's parser, O-3); Change History row |
| `docs/workplans/admin-authz-unification.md` | +14 / −13 | Slice 7 status in the heading block, the status table and the Slice Index: "routes folded into ADMIN_BOS_CLEANUP slice 1; page kept, read-only". Tasks per W-7: 7.1, 7.2, 7.5, 7.6, 7.9, 7.10 ticked with reasons; 7.3, 7.4 unticked (not done by decision); **7.7, 7.8 unticked (not exercised)**. One Change History row |
| this workplan | 540 lines before this section | Task boxes, Status, these notes |

### `new-api-route` checklist items that do not apply (W-10)

- **"Repository call passes `user.id`"**: not applicable. This is a cross-account admin list on a repository that uses the service role by design (documented in its header). There is no caller-supplied id, so `tenant-isolation-guard` has nothing to scope.
- **"Test covers 400"**: not applicable. The route reads no input; query strings are ignored (R-10), so there is no 400 path.

### Deviations from the plan, with reasons

1. **`git rm` → plain `rm`** for the two routes, so nothing is staged (the instruction was to leave everything uncommitted). The effect on the tree is the same.
2. **Gate placement.** The gate is the first statement **inside** `try`. `correlationId` and the child logger are built above it, as 2.2 specified. They touch neither the database nor the env.
3. **Extra route cases** beyond R-1 to R-10: R-2b (a table email with surrounding whitespace), R-3b (env-only addresses sorted), R-5b (`data: null` with no error → 500) and R-5c (a throwing repository → 500).
4. **Extra page cases**: P-3b ("No addresses beyond the table."), and five malformed-200 shapes under P-6 (W-3a). The source checks sit in the same file (5.2 allowed either).
5. **Concurrent Refresh**: the page drops a response that is not from its latest request. This is not in the plan. It stops a slow earlier response from overwriting a newer one, and it costs one ref.
6. **The parser test's comment stripper** removes line comments before block comments. The service's header has a `//` line containing `/admin/*`, which otherwise opens a fake block comment and swallows code. The page test uses the same order.
7. **Full-project tsc baseline (T-1) did not complete** in the 20-minute background limit. The W-1 scoped run plus the clean-base scoped comparison (both recorded above) is the evidence instead. The scoped run's exit code is 2 because of pre-existing errors in untouched transitive files. Per W-1, the gate is zero errors in touched files and no error outside the base list, and both hold.
8. **SA's three non-blocking suggestions, all taken**: `recordRefusedAccess` mocked in the route test (and asserted called once on the 403); the `ADMIN_EMAILS`-vs-`is_platform_admin()` note (register row 87 and the removal paragraph); the email as the React key on both lists.

### Owed: T-17 manual browser check (user / QA)

Dev cannot sign in to a browser. As a platform admin on `npm run dev` (read-only use of the dev database):

1. Sidebar "Admin users" → `/admin/settings`. Title "Admin users", badge "Read-only". The two real admins are under "From the admin_users table", each showing "Linked to a login" and "Added".
2. Set `ADMIN_EMAILS` locally to one table address plus one other address and restart `npm run dev` (it is read at process start). The table row shows "Also in the environment setting: removing the row alone does not revoke access". The other address is under "Granted by the ADMIN_EMAILS environment setting".
3. DevTools → Network: only `GET /api/admin/admins`; no `settings/admin-users` or `settings/platform-users` request; no POST. Click Refresh: same.
4. There is no add, remove or role control anywhere. The info box shows the doc path as text, not a link.
5. Signed in as a non-admin: `/admin/settings` redirects (layout guard). `GET /api/admin/admins` returns 403 with no list.
6. The header dropdown "Settings" link still opens the page, and the sidebar entry is unchanged.

## SA Review Notes

[SA will populate this section]

### SA Workplan Review (2026-10-02)

**Reviewed by SA — 2026-10-02**, against requirement conditions C-1 to C-9, CLAUDE.md, the authz guard (`admin-authz-surface.guard.test.ts`: R2 at `:1654-1670`, R4 at `:1724-1736`, `CAPS` at `:403-411`, the ratchet and equality tests at `:1036-1068`, the file-exists test at `:971-978`), `adminGate.writes.test.ts`, the `new-api-route` and `new-repository` skills, and the as-built code on `34d665b4`.
**Status: APPROVED WITH CONDITIONS (W-1 to W-10).** Dev may implement once the conditions are folded into the plan. None of them changes the approach; they close gaps in tests, checks and doc wording.

#### What SA verified on disk

| Check | Result |
|---|---|
| **Env parser read time** | ✅ Correct. `AdminAccessService.test.ts:40-45` sets `ADMIN_EMAILS`, calls `createForTest`, then restores it. The constructor calls `readEnvAdminEmails()` at construction, so the suite passes unedited. A module-level constant would break it. E-6 must restore the env in `afterEach`. |
| **Overlap logic** | ✅ Case-insensitive in the plan, with one tightening (W-4). Table emails are **not** guaranteed lowercase: `is_platform_admin()` (`20260920a…rls.sql:145-149`) lowercases both sides because a hand-inserted row can be mixed case (QA D-Q7). So the route's own normalisation is required, not belt-and-braces. |
| **Response shape** | ✅ Explicit field picking. `id`, `user_id`, `granted_by`, `updated_at` and `is_active` cannot leak. R-7 tests the serialised body, which is the right level. |
| **Error handling** | ✅ The 500 fires on `error` or `data === null`. `listActive()` returns `data ?? []` on success, so `null` means failure. The body has no list fields. The page side needs W-3. |
| **Logs** | ✅ Counts only (`tableCount`, `envOnlyCount`, `overlapCount`). `listActive()` logs `{ err }` only. R-8 sweeps for `@`. The client logger warn carries `{ err, status }`, with no address. |
| **R2** | ✅ The route reads the repository, and the T-5 grep plus B-3 cover it. The route test file is `__tests__/route.test.ts`, which `ROUTE_FILE_RE` (`/\/route\.(ts|…)$/`) does not match, so its mock of `@/lib/services/AdminAccessService` is not an R2 offence. |
| **R4 / caps / ratchet** | ✅ Delete both entries and set `CAPS.R4.parked` 2 → 0 in one commit. The equality test (`:1050-1068`) fails if either is done alone. No other cap moves. **But** R4 scans test files too (W-2). |
| **`adminGate.writes`** | ✅ 59 − 3 + 1 = 57. The proxy builder resolves `{ data: [], error: null }` for any chain including `.order()`, so the pass-through case gives 200. The 403 case's exact `['audit_trail']` list holds, because `requireAdmin` runs before `listActive()`. |
| **Leftover callers** | ✅ None. `git grep "settings/admin-users\|settings/platform-users" -- . ':!docs'` hits exactly three files, all of which this slice edits: `app/admin/settings/page.tsx` (`:61`, `:82`, `:124`, `:161`), `adminGate.writes.test.ts` (`:10`, `:175`, `:185`, `:252-253`, `:272`) and the guard's R4 entry (`:345`). Nothing under `components/`, `hooks/`, `scripts/`, `tests/`, `supabase/`, `.claude/` or the config files. `app/api/admin/settings/` holds only the two doomed routes. `listAdmins()` has no caller outside its own file. |
| **`new-api-route` checklist** | ✅ With two items not applicable, and the reasons must be recorded (W-10): "repository call passes `user.id`" (a cross-account admin list on a service-role repository that is documented as such; there is no caller-supplied id, so `tenant-isolation-guard` has nothing to scope) and "test covers 400" (no input). |
| **`new-repository`** | Not engaged. No repository or method is added. |
| **Lockout risk (authz workplan R-1)** | Not triggered. The deleted routes wrote to a store that grants nothing, so no grant path changes. The slice 0 P-1 re-confirmation that slice 7 called for is not needed here. |
| **Rollback** | ✅ Sound: one PR, no migration, no data change, and the caps and entries revert together. Addendum: if a later PR has edited the `adminGate` pin or `CAPS` before a revert, resolve the conflict so the pin equals `CASES.length` and each cap equals its list length. A revert brings back a **gated** GET that writes to a non-granting store. That is acceptable for a rollback. |

#### Conditions

1. **W-1: The scratch `tsconfig` must not type-check the whole project (O-8).** The repo `tsconfig.json` has an `"include"`. In `extends`, a child's `"files"` does **not** override the parent's `"include"`; each property is inherited separately. As written, the scratch run would type-check the whole project and the exit code would be meaningless. Set `"include": []` in the scratch config alongside `"files"`. The gate is: **zero errors in touched or new files, and no error that is not in the clean-tree baseline**. Record both commands with their exit codes. The full-project comparison fallback stands as Dev wrote it.
2. **W-2: R4 scans test files.** `SCANNED` excludes only the guard file itself (`:813`, `:837`). With an empty R4 allow-list, any test that writes a fixture such as `role === 'admin'` or `.filter(a => a.role === 'super_admin')` turns the required check red. P-4 asserts absence through text and accessible-name queries (`/super admin/i`, `/\brole\b/i`), never by embedding a comparison literal. The final `npm run test:authz-guard` run (T-16) comes **after** every new test file exists.
3. **W-3: The page never shows a list it cannot vouch for.**
   - (a) A 200 response is an **error** unless the body has `success === true` and both `tableAdmins` and `envOnlyAdmins` are arrays (`Array.isArray`). A malformed 200 must not render as "No active rows".
   - (b) If a Refresh fails after a successful load, the page **clears** the previous list and shows the error state. It never leaves a stale list on screen as if it were current.
   - Add (a) to P-6, and add **P-10** for (b): load OK, then refresh with a 500, then assert that neither list heading is rendered.
4. **W-4: One normaliser, both sides.** The route compares `email.trim().toLowerCase()` on the table side and the env side through a single local helper. The env side is already normalised by the parser. The page displays the stored email unchanged. R-2 must contain an **actual** mixed-case table row (for example `Ops@Example.com` in the repository mock against `ops@example.com` in the env), not a conditional "if the repository ever returned one".
5. **W-5: Type-only import (O-6).** The page imports the shared types with `import type { … } from '@/lib/admin/adminList-types'`. The types file has no runtime exports and imports nothing. Add a one-line assertion to the 5.2 source check that the page's import of that module is `import type`.
6. **W-6: The removal steps must name the re-activation trap (O-1).** Both add paths upsert `is_active = true`: the seed script, and `20260701_seed_admin_users.sql` (`ON CONFLICT … SET is_active = true`, which today lists **both** current admins). So a removed admin comes back the next time either is re-run with their address still in `.env.local`'s `ADMIN_EMAILS` or in the migration's `VALUES` list. The new "Removing an admin" paragraph in the access doc and the PR body's **Remove** steps add that step: also delete the address from the migration's `VALUES` list and from any `ADMIN_EMAILS` (local and Vercel).
7. **W-7: Slice 7's task list is accounted for line by line, and nothing is ticked that did not run.** In `admin-authz-unification.md`:
   - 7.1 done (OQ-1 = B, 2026-10-02; the SA TA-4 ruling);
   - 7.2 done;
   - 7.3 and 7.4 not done by decision (page kept read-only, C-4);
   - 7.5 done for the two route paths, while the `/admin/settings` part is not applicable (page kept);
   - 7.6 done, and its R1 half is moot (no R1 entries existed);
   - 7.7 and 7.8 **not exercised**: this slice changes no grant or revoke path. Leave them unticked, with that reason;
   - 7.9 done (PR body);
   - 7.10 done by reference to OI-7.

   The slice heading's status says "routes folded into ADMIN_BOS_CLEANUP slice 1; page kept, read-only". It is not a bare ✅ that implies 7.7 and 7.8 ran.
8. **W-8: The register is made complete (O-9 changed).** The register heading claims "Every admin handler", and C-7 requires a census measured from disk. So the three gated-but-unregistered invite handlers are registered in this PR as doc-only rows: `business-os/invites#GET`, `business-os/invites#POST` and `business-os/invites/[inviteId]/revoke#POST`. SA spot-checked that `requireAdmin` is the first statement of each (`invites/route.ts:79`, `:136`; `revoke/route.ts:34`). Dev re-confirms that at T-14 and records it. Afterwards, the count of **live (non-struck) register rows must equal the measured handler count**. The expected figure is 87 (89 − 3 + 1), but it is measured, not computed. Correct the register heading's count. The invite routes get no code change.
9. **W-9: The grep scope (O-7, ruled).** C-5's grep is read as "every tracked file except `docs/**`": `git grep -n "settings/admin-users\|settings/platform-users" -- . ':!docs'` returns nothing. That is wider than Dev's directory list, and it covers `tests/`, `supabase/`, `.claude/` and the config files. The historical docs are not rewritten. The access doc keeps rows 47 to 49 by name, struck through. The `adminGate` header and the W-8 fixture comment use "(since deleted)" wording without the literal path, as Dev proposed. Also `git grep -n parseEnvAdminEmails` returns nothing.
10. **W-10: Two more deliberate-breakage checks, plus the route header.** B-1 to B-3 stand. Add:
    - **B-4:** delete both R4 entries but leave `CAPS.R4.parked = 2`. Expect the equality drift test to fail with `RATCHET_HINT`. This is the direction this slice actually takes, and B-2 only proves the opposite one.
    - **B-5:** move `adminUserRepository.listActive()` above `requireAdmin` in the new route. Expect R-9 and the `adminGate` 401 "touches nothing" case to fail. R1 proves only that the gate is present, so this proves the position tests are real.

    Revert each one, re-run green, and paste all five outputs into Implementation Notes and the PR body. The route's header comment states: service-role repository by design (cross-account admin read, no caller-supplied id); no Zod because there is no input; the repository rather than the service because of R2 and B-6. Implementation Notes record the two `new-api-route` checklist items that do not apply, with these reasons.

#### Rulings on the open points

| # | Ruling |
|---|---|
| **O-1** | **Confirmed, extended by W-6.** Add the "Removing an admin" paragraph to § Bootstrapping Admins, using targeted insertion. Otherwise FR-AU4 points at a doc that answers only half of its sentence. |
| **O-2** | **Confirmed.** The env is read at service construction, so an `ADMIN_EMAILS` change needs a redeploy, and on Vercel any env change does anyway. The page copy states both timings. |
| **O-3** | **Confirmed: leave `scripts/seed-admin-users.ts` alone.** It is a CLI script outside rule 3's scope. Touching it pulls in 11 `console.*` and an inline client for a two-line gain, and its regex is identical today. Record the third parser as debt in the access doc's **Open Items** table (a new row), not only in Change History: Change History is not a tracker. |
| **O-4** | **Confirmed: add it.** Asserting that R4 is genuinely zero is within C-6's intent. It is not a cap change. Rename the test "R3, R4 and R5 are genuinely zero …". |
| **O-5** | **Confirmed.** Title "Admin users", badge "Read-only", same classes. Copy only (D-4). |
| **O-6** | **Confirmed: a shared `lib/admin/adminList-types.ts`**, subject to W-5. |
| **O-7** | **Decided: W-9.** Code-path reading accepted, with the grep widened to every tracked file outside `docs/`. |
| **O-8** | **Decided: W-1.** Try the scratch config first with `"include": []`. The fallback is the full-project clean-tree comparison. Both runs are recorded with exit codes. |
| **O-9** | **Changed: W-8.** Register the three invite handlers in this PR (doc-only), so the register matches the measured census. |
| **O-10** | **Confirmed.** `AdminHeader.tsx:92` "Settings" stays, under C-4. Relabelling it is a later copy change if the user wants one. |

#### Optimisation suggestions (non-blocking)

- In `route.test.ts`, mock `@/lib/audit/recordRefusedAccess` (or assert that it was called once on the 403). Then R-9's 403 case does not depend on the real audit path's bounded 2 s flush. The `jobs-queues` precedent does not mock it and still passes, so this is optional.
- In the access doc's new row or the removal paragraph, add one clause: an address granted **only** by `ADMIN_EMAILS` passes the app gates but **not** the database predicate `is_platform_admin()`, which reads only the table. That predicate matters little while admin reads use the service role, but it is true, and it is the kind of asymmetry this page exists to surface.
- Use the email as the React key on both lists. It is unique within each list, and the response deliberately carries no row `id`.

#### Questions for the user

None. Every point above is technical, and all of them are decided here.

### Workplan approval
- [x] Workplan approved **with conditions W-1 to W-10**. Dev implements with them folded in, and SA's code review checks each one.

### SA Code Review (2026-10-02)

**Code Review by SA — 2026-10-02**, on the uncommitted working tree of `fix/admin-users-read-only` (base `023dde98`).
**Status: APPROVED WITH CHANGES.** One small doc fix (CR-1) is needed before QA signs off. Everything else is non-blocking.

#### What SA re-ran or re-measured (Dev's claims were not taken on trust)

| Claim | SA result |
|---|---|
| Key suites green | ✅ Re-ran 6 suites (new route, new page, new parser, `AdminAccessService` unedited, `adminGate.writes`, authz guard): **461 / 461** (15 + 21 + 8 + 10 + 288 + 119, matching Dev's per-suite figures) |
| Service test unedited | ✅ `git diff --stat lib/services/__tests__` is empty |
| Scoped `tsc`: 18 pre-existing errors, 0 in touched files | ✅ Independent scratch config (`extends` the repo config, `"include": []`, `"files"` = the 10 touched/new code files): **exit 2, 18 errors**, all in the same 6 untouched files with the same per-file counts (`aiAnalytics` 6, `admin-helpers` 4, `MemorySummarizer` 4, `EmbeddingService` 2, `ais-helpers` 1, `MemoryConsolidationScheduler` 1). **0 in touched files.** SA did not re-run the clean-base comparison. The per-file match makes skipping it low-risk |
| ESLint clean | ✅ exit 0 on the 8 new or changed source and test files; no `console.*` in any touched code file |
| Census 87 / 81 + 6 + 0 / 58 files | ✅ SA's own scratch walker: **58 files, 87 handlers, 81 `requireAdmin`, 6 inline, 0 open**. Register: **87 live rows**, numbers unique, 47–49 struck |
| W-9 sweeps | ✅ `git grep --untracked "settings/admin-users\|settings/platform-users" -- . ':!docs'` → nothing; `parseEnvAdminEmails` appears only in docs |
| Guard ratchet | ✅ `CAPS.R4` `{0,0}`, both R4 entries removed, R4 added to the "genuinely zero" test (O-4), no other cap changed. The `super_admin` shape test still pins the pattern. Breakage outputs B-1..B-5 are recorded and consistent with the code (SA did not re-run them) |

#### Conditions check

| Condition | Result |
|---|---|
| **C-1** | ✅ `GET` only. `requireAdmin(requestLogger)` is the first statement inside `try`. Only the `correlationId` header read and the child logger come before it, as 2.2 specified, with no DB, env or body access. The route code does not mention `AdminAccessService`. It reads `adminUserRepository.listActive()` |
| **C-2** | ✅ Parser moved verbatim; the service still reads at construction. **Behaviour identical** |
| **C-3** | ✅ Explicit field picking: `email`, `linkedToLogin`, `addedAt`, `notes`, `alsoInEnv`. No `id`, `user_id`, `granted_by`, `updated_at`, `is_active`, profile or auth data (R-7 checks the serialised body with planted ids). An error gives a 500 `Failed to load admin list` with `details` in development only. `data: null` without an error, and a throwing repository, also give 500s. Labels and marker text match C-3 verbatim |
| **C-4** | ✅ `'use client'` kept. No add, remove or role control, and no form or input (P-4). Subtitle and FR-AU4 box as specified. The doc path is text, not a link. Sidebar and header link untouched |
| **C-5** | ✅ Two routes deleted; three cases out, one in; pin 59 → 57 |
| **C-6** | ✅ (see above) |
| **C-7** | ✅ In the access doc: register rows 47–49 struck; row 87 and invite rows 88–90 added; census re-measured from disk with the method recorded; R4 caps row at 0/0; the "What is NOT true" Settings row restated accurately (not retired, now a truthful read-only list); OI-2b and OI-3 done; OI-12 added; Change History row. In the authz workplan, slice 7's status is not a bare ✅, and 7.7/7.8 are unticked with the reason (W-7). Nothing was deleted wrongly in either doc |
| **C-8** | ✅ The route, page and parser tests cover every listed item, including R-2's actual mixed-case row (W-4) and P-10 (W-3b) |
| **C-9** | ✅ |
| **W-1..W-10** | ✅ All met. W-6: the re-activation trap is named in the doc's "Removing an admin" paragraph |
| Cross-link in `ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` | ✅ One §7 row, Last Updated bumped, one Change History row; the link target exists. Accurate |

#### Code Review Comments

1. **CR-1: `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:511`.** The removal SQL is `WHERE email = lower('person@x.com')`, which matches only a row stored in lowercase. W-4 rests on the fact (QA D-Q7) that a hand-inserted row **can** be mixed case, and the new page now shows such rows. Against a mixed-case row, the `UPDATE` **silently affects 0 rows**, while `is_platform_admin()` (which lowercases both sides) and any app check bound by `user_id` keep granting access. This is the revoke procedure, so it must not fail quietly. Change it to `WHERE lower(trim(email)) = lower(trim('person@x.com'))`, and add: "check that the `UPDATE` reports 1 row, then refresh the Admin users page". Make the same change in the PR body's Remove steps. **Priority: Medium (required before merge; doc only)**
2. **CR-2: `app/admin/settings/page.tsx:56-73`.** The stale-response guard (Deviation 5) is correct. It checks the request id after `await response.json()` and again in `catch`, so neither a late success nor a late failure from an older request can overwrite a newer one, and it also handles the StrictMode double-mount. But it has **no test**. Add one page case: hold the first fetch on a deferred promise, let the second resolve first, then release the first and assert that the second's result is still on screen. The Refresh button is disabled while loading, so in practice only the double-mount reaches this path. **Priority: Low**
3. **CR-3: `app/admin/settings/page.tsx:131`.** During a Refresh, the previous list stays on screen while `status === 'loading'`; only the button spins. W-3b requires clearing only on **failure**, which the page does, so this is acceptable. It is recorded here so QA does not report it as a defect. **Priority: Informational**
4. **CR-4: `app/api/admin/admins/route.ts:99-112`.** Table rows are not de-duplicated on the normalised email. `admin_users.email` is `UNIQUE` but case-sensitive, so `Ops@x.io` and `ops@x.io` could both exist, and both would show. That is what the table holds, and showing it is the page's job, so no change is requested. **Priority: Informational**

#### Optimisation Suggestions (non-blocking)

- `route.ts`: after the gate, `requestLogger.child({ adminId: gate.user.id })` would match the neighbouring routes (for example `business-os/invites#GET`) and record which admin was served the list. It is a user id, not an email, so it still fits "never an address".
- `ADMIN_IDENTIFICATION_AND_ACCESS.md:352` (the Components table's Tests row): add the three new test files.

#### Security summary

`requireAdmin` runs first and fails closed, with 401/403 before any read (R-9 and the four shared denial cases). There is no caller-supplied input. The service-role repository read is cross-account by design and documented. The response has no `user_id`, `granted_by` or profile data. Logs carry counts only on success and `{ err }` on failure, with no address (R-8, P-7). No RLS change, no migration, no write path.

### Code Approved for QA: Yes, conditional on CR-1

CR-1 is a one-line doc change. It needs no further SA pass if made as written. CR-2 can be done now or recorded as a follow-up. The T-17 manual browser check is still owed (QA / user).

## QA Testing Report

### QA Report (2026-10-02)

**QA — 2026-10-02**, on the uncommitted working tree of `fix/admin-users-read-only` (worktree `neuronforge-admin-users`, base `023dde98`).
**Test mode:** full
**Strategy used:** A + B (Jest unit and route/integration-style tests, re-run independently), source reading for the edge cases, and D written as a user checklist (T-17). No browser, no login, no database access in this session.
**Focus:** api, ui, security
**Skipped:** the live browser check (T-17): QA cannot sign in. It is written below for the user.
**Input source:** the TL trigger message (QA judgment within it)

**Verdict: PASS WITH NOTES.** No code bug. One doc bug (QA-1, the second half of SA's CR-1). T-17 is still owed by the user.

#### Test runs (re-run by QA, not taken from Dev's notes)

| Run | Result |
|---|---|
| Key set: new route (15), new page (21 → **22** with QA's P-11), new parser (8), `AdminAccessService` (10), `adminGate.writes` (288 = 57 cases), authz guard (119), `AdminSidebar.nav` (20), `business-os-llm` nav (5), `business-os-tiers` nav (6), `AdminUserRepository` (11) | 10 suites, **503 / 503** before P-11; page + guard re-run after P-11: **141 / 141** (22 + 119) |
| `lib/services/__tests__/AdminAccessService.test.ts` unedited | ✅ not in `git status`; `git diff --stat lib/services/__tests__` empty |
| Wider set: `app/admin app/api/admin lib/admin` + service + repository | 87 suites, **2326 / 2327**. The one failure is the known flake: `business-os-invites/__tests__/page.render.test.tsx` › "after a create, shows the link once…", a 5000 ms timeout under load (suite took 88 s). **Re-run alone: 52 / 52, passes.** Not related to this slice (no file in its import path changed) |
| Scoped `tsc` on the page, the page test (with P-11) and the route (scratch config: `"include": []`, `"files"` = those 3 + `types/*.d.ts`, heap 8192) | **exit 0, 0 errors** |
| ESLint on the page test after QA's edit | exit 0 |
| `git grep --untracked -n "settings/admin-users\|settings/platform-users" -- . ':!docs'` | nothing (exit 1). Also `api/admin/settings` → nothing; `parseEnvAdminEmails` → nothing; `app/api/admin/settings/` no longer exists |

#### Test added by QA (one case, closes SA CR-2)

`app/admin/settings/__tests__/page.render.test.tsx` › **P-11 (QA): a slow, failing earlier response cannot overwrite a newer good one.** It renders the page under `<StrictMode>` (two mount loads), holds the first fetch, lets the second render the list, then releases the first as a 500 and asserts: no error banner, both rows still shown, no warn logged. **Proven real:** with both `requestId !== latestRequest.current` checks commented out of `page.tsx` (scratch backup, restored, `cmp` identical afterwards), P-11 fails; restored, 22 / 22 pass. Nothing else was edited.

#### Test Coverage (§9 slice 1, read with C-9 / C-3)

| Acceptance criterion | Tested? | Result | Evidence |
|---|---|---|---|
| The page lists exactly the active rows of `admin_users`, plus environment admins labelled separately (seeded list), incl. the overlap marker | ✅ | Pass | Route: R-1 (2 seeded rows, repository order, env split, overlap listed once with `alsoInEnv`), R-2 (actual mixed-case row both ways), R-2b (whitespace), R-3 (deactivated row still in env → env-only), R-3b, R-4. Page: P-1, P-2 (marker on exactly one row), P-3, P-3b, P-8. "Active only" is the repository's `.eq('is_active', true)` (`AdminUserRepository.ts:114`, covered by `AdminUserRepository.test.ts`) |
| Loading the page performs **no write** (neither GET nor POST of `settings/admin-users` is called) | ✅ | Pass | P-5 (every fetch on mount and Refresh is `GET /api/admin/admins`); source test "names neither old management route"; both routes deleted and the grep is clean. The new route has no write and no audit call (`route.ts:86-139`) |
| No add, remove or role control on the page | ✅ | Pass | P-4 (one button, Refresh; no input/select/textarea/form; no "super admin" or "role" text) |
| A non-admin is refused (page and the new route); a happy path and one failure path tested | ✅ | Pass (page part: by existing tests + T-17) | Route: R-9 401 / 403 with `listActive` not called; four shared denial cases for `GET /api/admin/admins` in `adminGate.writes.test.ts` (incl. throwing checks and "touches nothing"); failure path R-5/R-5b/R-5c/R-6. Page: `app/admin/layout.tsx:40` `requireAdminPage()`, pinned by the guard ("layout … FIRST statement is the page guard") and `requireAdminPage.test.ts` (anonymous and non-admin redirected). The live redirect is T-17 step 6 |

No criterion is without evidence.

#### Edge cases probed

| Case | Covered by | Result |
|---|---|---|
| Empty table, env admins only | R-3b (route); page renders "No active rows…" plus the env list (P-8 + P-3 paths) | ✅ |
| Empty env (unset and `''`) | R-4, E-5 | ✅ |
| Duplicate / mixed-case emails | Env: E-4 collapses `A@X.io,a@x.io`. Env vs table: R-2, R-2b. Two table rows differing only in case (`email` is `UNIQUE` but case-sensitive): both listed, keys differ, so no React key clash. Untested, but truthful (SA CR-4) | ✅ / note |
| Whitespace and empty entries in `ADMIN_EMAILS` | E-3 (tabs, CRLF, doubled and trailing separators), E-5 (`' , ; '`) | ✅ |
| Repository error, `data: null`, throw | R-5, R-5b, R-5c (all 500, no list fields), R-6 (`details` dev-only) | ✅ |
| Non-admin gets 403 with nothing read | R-9 + `adminGate` 403 case (`['audit_trail']` only) | ✅ |
| Page: malformed 200 | P-6 ×7 (500, `success:false`, five malformed shapes) | ✅ |
| Page: failed refresh after success | P-10 | ✅ |
| Page: slow stale response | **P-11 (added by QA)** | ✅ |
| Page never calls the deleted routes | P-5 + source test + grep | ✅ |
| Leaks | R-7 (no `id`, `user_id`, `granted_by`, `updated_at`, `is_active` in the body), R-8 and P-7 (no `@` in any log argument) | ✅ |

#### Issues Found

**Bugs (must fix before commit)**

1. **QA-1: the PR body draft still carries the case-sensitive revoke SQL and omits the re-activation trap.** File: `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_1_WORKPLAN.md:403` (§11 "Remove" step 1). Severity: **Medium** (doc only, but this is the revoke procedure and the PR body is what the operator will copy).
   - SA CR-1 asked for the fix in the access doc **and** in the PR body. The access doc is fixed (`ADMIN_IDENTIFICATION_AND_ACCESS.md:511`, plus the "reports 1 row" check). The PR body draft still says `WHERE email = lower('person@x.com')`, which revokes nothing against a mixed-case row, and has no step 3 (remove the address from the seed migration's `VALUES` list and every `ADMIN_EMAILS`, or a re-run re-activates the row; SA W-6).
   - Expected: the PR body's Remove steps match the access doc's three steps. Actual: the old step 1 and no step 3.

**Performance issues:** none. One request per load; Refresh is disabled while loading.

**Edge cases (nice to fix / informational)**

1. The previous list stays visible while a Refresh is in flight (SA CR-3). It is cleared on failure (P-10). Acceptable.
2. `formatDate` shows "Invalid Date" if `created_at` were ever unparseable. Not reachable from a well-formed row. Informational.
3. The page's body check (`isAdminListBody`) checks that both lists are arrays, not the shape of each entry. The route builds them by explicit picking, so this only matters if the route changes. Informational.

#### T-17: the browser check, for the user

On `npm run dev`, signed in as a platform admin:

1. Click **Admin users** in the sidebar. The page is titled "Admin users", has a "Read-only" badge, and the subtitle says "Who can open admin. Read-only."
2. Under **From the admin_users table** you see both real admins. Each shows "Linked to a login: yes / not yet" and an "Added" date.
3. Open DevTools → Network, then reload. The only API call is `GET /api/admin/admins` (status 200). There is no `settings/admin-users` or `settings/platform-users` call and no POST. Click the Refresh icon: you see the same single GET.
4. There is no Add button, form, role picker, remove button or "Super Admin" badge. The blue box names `admin_users`, `ADMIN_EMAILS` and the doc path as plain text (not a link).
5. Optional: set `ADMIN_EMAILS` in `.env.local` to one of the table addresses plus one other address, and restart `npm run dev`. The table admin shows "Also in the environment setting: removing the row alone does not revoke access". The other address appears under **Granted by the ADMIN_EMAILS environment setting**. Restore `.env.local` afterwards.
6. Sign out, or use a private window with a non-admin account. Opening `/admin/settings` sends you away from admin. Opening `/api/admin/admins` directly returns 401 (signed out) or 403 (non-admin), with no list.
7. The header dropdown's "Settings" link still opens the same page.

#### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **QA-1** (doc only, Medium). The code needs no change. After QA-1 is fixed, the slice is ready for the user's diff review, with **T-17 owed by the user**.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-02 | Created | Dev workplan for ADMIN_BOS_CLEANUP slice 1 (option B, FR-AU1 to FR-AU5) under SA conditions C-1 to C-9. Ten open points for SA (O-1 to O-10). |
| 2026-10-02 | SA workplan review | **APPROVED WITH CONDITIONS (W-1 to W-10).** Verified on disk: env parser read at call time keeps `AdminAccessService.test.ts` unedited; no caller of the two deleted routes outside the three files this slice edits; `adminGate` 59 → 57 and R4 2 → 0 hold under the equality ratchet. Conditions: scratch tsconfig needs `"include": []` (W-1); R4 scans test files (W-2); page error state covers malformed 200 and failed refresh (W-3); one normaliser incl. mixed-case table rows (W-4); `import type` (W-5); removal steps name the seed re-activation trap (W-6); slice 7 tasks accounted line by line, 7.7/7.8 not ticked (W-7); invite handlers registered so register = census (W-8, O-9 changed); grep over all non-docs files (W-9); breakage checks B-4 and B-5 (W-10). No user questions. |
| 2026-10-02 | SA code review | **APPROVED WITH CHANGES.** SA re-ran the 6 key suites (461/461), scoped `tsc` (18 pre-existing errors in the same 6 untouched files, 0 in touched files), ESLint (clean), the census (87 / 81 + 6 + 0 / 58 files; 87 live register rows) and the W-9 sweeps. All match Dev's notes. C-1..C-9 and W-1..W-10 met. One required doc fix: the removal SQL must match the email case-insensitively (CR-1). Low: a test for the stale-response guard (CR-2). |
| 2026-10-02 | QA report | **PASS WITH NOTES.** Re-ran the key set (10 suites, 503/503) and the wider admin set (2326/2327; the one failure is the known `business-os-invites` timeout flake, 52/52 alone). Added P-11 (stale-response guard under StrictMode, closes CR-2; proven to fail with the guard removed). Scoped `tsc` exit 0; grep clean. All four §9 slice 1 criteria have evidence. QA-1 (Medium, doc): the §11 PR body still has the case-sensitive revoke SQL and no re-activation step. T-17 written as a user checklist, still owed. |
