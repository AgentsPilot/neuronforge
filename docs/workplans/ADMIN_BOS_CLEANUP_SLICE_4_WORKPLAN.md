# Workplan: Admin BOS Cleanup, Slice 4 (audit trail names and search placeholder; archiving header comment)

> **Last Updated**: 2026-10-03

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.3 FR-AT1..FR-AT3, §4.4 FR-AR1..FR-AR2, V-4..V-7 (§2), TA-10, TA-11 (§10), §8 Privacy, Honesty and Logging, and the slice 4 lines of §9.
**Branch:** `fix/admin-audit-archiving-fixes` @ `56383fb4` (`origin/main`; slices 1, 2, 3 and 5a merged). Worktree `neuronforge-admin-audit`. Created by RM.
**Process (lighter, approved by the user):** no separate SA requirement review. Dev workplan → SA workplan review (once) → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-03
**Status:** Code Complete
**Effort:** S, about 5 to 6.5 hours of Dev time. Breakdown in [section 11](#11-effort-estimate).

## Overview

The admin audit trail has never shown a person's name. The route asks a `users` table for `full_name`. That table does not exist in `public`, and the route discards the error, so every row arrives with no user and the page prints the raw account id (OI-18, R-20). This slice gets the name from `profiles.full_name` through a new admin read method on `UserProfileRepository`, logs a failed lookup through the request logger, and keeps the page loading when the lookup fails. It also corrects the search placeholder, which offers to search by "agent". Finally, it rewrites the archiving page's header comment, which still says runs "cannot happen yet" although `ARCHIVE_RUNS_ENABLED` is `true`.

No database change, no new route, no change to the gate, the sidebar or the confirm dialog.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Manual QA Check](#6-manual-qa-check)
- [7. Acceptance Criteria Traceability](#7-acceptance-criteria-traceability)
- [8. Logging Compliance and Recorded Debt](#8-logging-compliance-and-recorded-debt)
- [9. Risks and Rollback](#9-risks-and-rollback)
- [10. PR Body Draft](#10-pr-body-draft)
- [11. Effort Estimate](#11-effort-estimate)
- [12. Open Points for SA](#12-open-points-for-sa)

---

## 1. Analysis Summary

### 1.1 The audit-trail route (`app/api/admin/audit-trail/route.ts`)

| Line(s) on `56383fb4` | As built | Consequence |
|---|---|---|
| `:17-20` | An inline service-role client built at module scope (OI-9 debt). | Used for the `audit_trail` read **and** the `users` read. |
| `:89-131` | `audit_trail` read, `select('*')`, filters, order, range. | Not changed by this slice (TA-10: the inline read moves only if it is the read being fixed). |
| `:155-170` | In-memory search over `resource_name`, `entity_id`, `user_email`, `action`, and the JSON text of `details` and `changes`. | This is what the placeholder must describe (FR-AT3). It does **not** match a person's name or a business name: both are attached after filtering. |
| `:176-190` | `.from('users').select('id, email, full_name').in('id', userIds)`; `if (!usersError && users)`. | **Never worked.** `public.users` exists in no migration and is the only `.from('users')` in the repository (admin-authz OI-18; the phantom register lists `users` under P6 "Tables that do not exist"). The error is discarded, so `usersMap` is always `{}`. Schema-check Rule 5 shape: **Never worked**, the value is used. The requirement makes the product call: rebuild from a real source. |
| `:204-206` | A comment says the business-name read was "deliberately NOT extended to the `users` read above". | Goes stale when the `users` read is removed. Rewritten. |
| `:220-249` | Business names via `businessProfileRepository.findAdminIdentitiesByUserIds`, one batched call, error **and** rejection both logged and survived, `businessLookup: 'ok' \| 'failed'`. | The precedent this slice copies for person names. |
| `:255-264` | Each row gets `users: usersMap[user_id]` (always `undefined` today) and `business`. | |

**TA-10 candidate checked.** `findAdminIdentitiesByUserIds` selects `BUSINESS_ADMIN_IDENTITY_COLUMNS` = `user_id, company_name, vertical, sub_vertical` from `business_profiles`. It returns a **business** name, not a person's name. So TA-10's fallback applies: a `profiles` name read on an admin repository method.

**Where the name comes from.** `profiles` is one row per auth user, keyed by `id` (= the auth user id = `audit_trail.user_id`). `UserProfileRepository` already reads `profiles.full_name` for the admin Businesses list (`ADMIN_PROFILE_LIST_COLUMNS = 'id, full_name, company, created_at, updated_at'`, `listForAdmin`, caller `app/api/admin/users/route.ts`). `profiles` has **no email column** (admin-authz OI-18), which is fine: the requirement asks for names.

### 1.2 The page (`app/admin/audit-trail/page.tsx`)

- `:65-68` types `users?: { email?: string; full_name?: string } | null`.
- The row line (`:898`), the expanded "User" tile (`:940`) and the account chip (`accountFilterLabel`, `:146-151`) all use `users.email || users.full_name || user_id`. With `users` always empty in production, every one of them has always shown the id (or, for the chip, the business name or a truncated id).
- `:573` placeholder: `"Search by agent, user email, or name..."` (V-5).
- After this slice the route sends `users: { full_name }` only, so the chain resolves to **full name, then id**. The page logic needs no change for names to appear.

### 1.3 The archiving page (`app/admin/archiving/page.tsx`)

- `:14-22` header section "Starting a run, and why it cannot happen yet", written for the off state (V-6).
- `lib/archiving/config.ts:64` `ARCHIVE_RUNS_ENABLED = true` (on since archiving Slice 3, C-5; a code constant, so switching it is a reviewed diff). `app/api/admin/archiving/route.ts:211` reports it as `runsEnabled`; `app/api/admin/archiving/runs/route.ts:134` refuses with 409 `runs_not_enabled` when it is `false`.
- What the page does when runs are off, as built: a "Runs off" badge beside the title (`:225-229`); Continue disabled with the note "Not switched on yet" when a continuable run exists (`:474-477`, `:518-519`); the confirm dialog's Confirm disabled with the same note (`ArchiveConfirmDialog.tsx:129-138`); no request sent; a 409 from the server shows "Archiving is not switched on yet." (`page.tsx:72`).
- The confirm dialog is not touched (FR-AR2, V-7).

### 1.4 Tenant isolation and privacy

The route runs as the service role across every account, by design, behind `requireAdmin` (first statement). The new read is **read-only**, takes ids that come from the `audit_trail` rows the route already loaded (not from the request), fires no trigger and writes nothing. None of the tenant-isolation-guard skill's scope-defeating shapes apply; the admin gate is the boundary, as it already is for the business-name read. The new method follows the owner-repository admin-read discipline (OI-9 template): "Admin" in the name, allow-listed columns, `{ data, error }` and never throws, and registered in the `adminReadMethods.guard.test.ts` caller guard so only `app/api/admin/**` can call it.

**Privacy (§8).** The new read selects exactly `id, full_name`. `profiles.full_name` is already shown across accounts on `/admin/users` (`listForAdmin`), so no new field reaches any admin screen. The read the code *intended* (`id, email, full_name`) would have added email; this one does not. The response's `users` object carries `full_name` only. Not changed by this slice, and recorded: the route's `select('*')` on `audit_trail` already sends `user_email`, `details` and `changes` to the page.

### 1.5 Schema-check status (TA-11)

Dev has no database access this cycle. The claims above rest on the code, the migrations folder, the phantom register and admin-authz OI-18. **SA confirms them live** (columns listed in O-1) and records the ref and result in this workplan before code review is approved (T-10).

---

## 2. Implementation Approach

### 2.1 Repository: `UserProfileRepository.findAdminNamesByIds` (new method)

```typescript
/** What an admin screen may know about a person from `profiles`: the display name only. */
export interface AdminProfileName {
  id: string;
  full_name: string | null;
}
/** The only columns `findAdminNamesByIds` selects. Exported for tests. */
export const ADMIN_PROFILE_NAME_COLUMNS = 'id, full_name';

/**
 * ADMIN ONLY (ADMIN_BOS_CLEANUP slice 4, TA-10): display names for the accounts
 * on one admin audit-trail page. Every account, by design; the caller is
 * app/api/admin/audit-trail/route.ts behind requireAdmin (caller guard in
 * adminReadMethods.guard.test.ts). One `.in('id', …)` per chunk of
 * ADMIN_IDENTITY_CHUNK ids, never one read per row. Accounts without a profile
 * row are simply absent. Names are never logged, only counts.
 */
async findAdminNamesByIds(userIds: readonly string[]): Promise<RepositoryResult<AdminProfileName[]>>
```

- Deduplicates, returns `{ data: [], error: null }` without a query for an empty list, chunks with the existing `ADMIN_IDENTITY_CHUNK` (200; imported from `BusinessProfileRepository`, which this file already imports from). The audit page size is capped at 200 (`MAX_ADMIN_PAGE_SIZE`), so one request per page in practice.
- `profiles` is keyed by `id`; filtering `.in('id', chunk)` is this file's documented equivalent of the `user_id` scope (file header).
- Catches, logs `{ err, requested }` at `error`, returns `{ data: null, error }`. Logs `{ requested, found }` at `debug` on success.
- No change to `listForAdmin` or `findById`. No barrel change (the route imports the singleton directly, like `app/api/admin/users/route.ts`).

### 2.2 Route: replace the `users` read

Replace `:176-190` with a block shaped like the business-name block:

```typescript
const userNames = new Map<string, string | null>();
let userLookup: 'ok' | 'failed' = 'ok';
if (userIds.length > 0) {
  try {
    const names = await userProfileRepository.findAdminNamesByIds(userIds);
    if (names.error || !names.data) {
      userLookup = 'failed';
      requestLogger.error({ err: names.error, requested: userIds.length },
        'User name lookup failed; audit logs served without user names');
    } else {
      for (const row of names.data) userNames.set(row.id, row.full_name);
    }
  } catch (lookupError: unknown) {
    userLookup = 'failed';
    requestLogger.error({ err: lookupError, requested: userIds.length },
      'User name lookup threw; audit logs served without user names');
  }
}
```

Per row: `users` = `undefined` when the lookup failed (the key drops out of the JSON), `{ full_name }` when the account has a non-empty name, otherwise `null`. The body gains `userLookup` next to `businessLookup`, with the same meaning ("unknown", not "none"). Nothing renders it today, the same as `businessLookup` (O-4).

Also in the route:
- Import `userProfileRepository` from `@/lib/repositories/UserProfileRepository`.
- Rewrite the header comment (`:4-7`): the inline client now serves the `audit_trail` read only; names and business names go through repositories.
- Rewrite the stale `:204-206` paragraph (the `users` read it refers to is gone).
- The final `debug` line gains `userNamesResolved: userNames.size` and `userLookup`. No name is ever logged.
- The `audit_trail` read, the search, pagination, the gate, Zod and the business-name block are unchanged. The two lookups stay sequential, matching the existing code (O-6).

### 2.3 Page: placeholder and one type comment

- `:573` placeholder → **`"Search by email, action, resource or entity ID…"`** (SA ruling on O-2, W4-2; Dev's original proposal was "…resource name or ID…"). Every term maps to a field the route matches: `user_email`, `action`, `resource_name`, `entity_id`. "Name" is qualified as *resource* name because search does not match a person's or a business's name. The JSON `details`/`changes` match is not listed; a placeholder names the main fields, and listing a subset claims nothing false.
- `:65-68`: one comment line on `users` saying the route fills `full_name` from `profiles` and never sends `email`. No logic change, no style change (D-4).

### 2.4 Archiving page: header comment only

Replace `:14-22` (the "Starting a run, and why it cannot happen yet" section) with, in substance:

```text
── Starting a run, and what switches runs off ─────────────────────────────
Runs are ON. `ARCHIVE_RUNS_ENABLED` in lib/archiving/config.ts is `true`
(since archiving Slice 3, C-5), and the overview reports it as `runsEnabled`.
The Archive button opens a confirm dialog (FR-4, C-15) showing the retention,
the cutoff, the rows that will move and, at 180 or 90 days, what owners lose
(K-1). Continue appears on a partial, failed or stalled run and resumes it on
its stored cutoff. Both send `POST /api/admin/archiving/runs`. Nothing here
runs on a timer or on load: only an admin's click starts anything (AC-15).

Switching runs off is a reviewed code change: set `ARCHIVE_RUNS_ENABLED` to
`false` (a constant, not an env var). The overview then says
`runsEnabled: false`, and this page shows a "Runs off" badge by the title,
disables Confirm and Continue with the note "Not switched on yet", and sends
no request (SA Q-1). The server refuses regardless (409 `runs_not_enabled`,
C-5), which this page shows as "Archiving is not switched on yet."
```

The other sections of that header are unchanged. No code line changes. (W4-6: the header has no Table of Contents.)

### 2.5 Phantom register: `docs/workplans/business-os-phantom-column-remediation.md`

Targeted `Edit` insertions only, **after SA confirms `public.users` is missing live** (T-10):
- A new `### P6c — Admin audit trail user names (resolved by ADMIN_BOS_CLEANUP slice 4)` after P6b: the `users` table, measured ref (SA's), query `audit-trail` user-name read, shape **Never worked** (error discarded, names always empty), resolution **Rebuilt** from `profiles.full_name` via `UserProfileRepository.findAdminNamesByIds`; email not rebuilt (privacy, and `profiles` has none). Notes that the P6 "Tables that do not exist" entry `users` is resolved at this site only.
- A Change History row.
- `> **Last Updated**` stays `2026-10-03`.

Also one targeted insertion in `docs/workplans/admin-authz-unification.md`: a "Resolved 2026-10-03 by ADMIN_BOS_CLEANUP slice 4" note on the OI-18 row (O-5).

---

## 3. Files to Create / Modify

| File | Action | Change |
|---|---|---|
| `lib/repositories/UserProfileRepository.ts` | modify (about +45) | `AdminProfileName`, `ADMIN_PROFILE_NAME_COLUMNS`, `findAdminNamesByIds` (2.1). |
| `app/api/admin/audit-trail/route.ts` | modify (about +35 / −20) | Replace the `users` read; `userLookup`; comments; debug counts (2.2). |
| `app/admin/audit-trail/page.tsx` | modify (+1 / −1, plus one comment line) | Placeholder; `users` type comment (2.3). |
| `app/admin/archiving/page.tsx` | modify (comment only, about +16 / −9) | Header section rewritten (2.4). |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | modify | Unit tests for the new method; add it to `ADMIN_METHODS` (5.1). |
| `app/api/admin/audit-trail/__tests__/route.userName.test.ts` | **create** | Names, failures, logging, no `users` read (5.2). |
| `app/api/admin/audit-trail/__tests__/noUsersTable.guard.test.ts` | **create** | Source guard (5.3). |
| `app/api/admin/audit-trail/__tests__/route.businessName.test.ts` | modify (mocks only) | Mock `UserProfileRepository`; drop the now-dead `users` table branch and `mockUserRows` (5.5). |
| `app/admin/audit-trail/__tests__/userNameAndPlaceholder.render.test.tsx` | **create** | Name renders; placeholder text (5.4). |
| `app/admin/archiving/__tests__/source.guard.test.ts` | modify | Header-comment check (5.6, O-3). |
| `docs/workplans/business-os-phantom-column-remediation.md` | modify (targeted Edit) | P6c and a Change History row (2.5). |
| `docs/workplans/admin-authz-unification.md` | modify (targeted Edit) | OI-18 resolved note (2.5, O-5). |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_4_WORKPLAN.md` | create (this file) | Workplan. |

**Deleted:** none.

**Explicitly not touched:** `ArchiveConfirmDialog.tsx` (FR-AR2), `lib/archiving/config.ts`, `BusinessProfileRepository.ts`, `lib/repositories/index.ts`, `lib/audit/requestSchemas.ts`, `route.validation.test.ts`, `app/api/admin/__tests__/auditAdminGate.test.ts` (both must pass **unedited**), the other audit-trail page tests, the admin authz guard, `AdminSidebar.tsx`, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (OI-9 still holds: the `audit_trail` read stays inline), and `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md`.

---

## 4. Task List

**SA conditions carried in (SA Review — slice 4, 2026-10-03).** These govern where they differ from sections 2 to 7.

| # | Folded into | What changes |
|---|---|---|
| W4-1 | T-3 | `findAdminNamesByIds` JSDoc states it runs on the default service-role client (`supabaseServer`), "Intentionally bypasses RLS — admin-only context" on `profiles`, and that the boundary is `requireAdmin` on the only caller plus the caller guard. |
| W4-2 | T-2 (R-4), T-5, section 6 step 3, section 10 | Placeholder is exactly `"Search by email, action, resource or entity ID…"` (Unicode ellipsis). |
| W4-3 | T-2 (U-4, U-5, U-7, U-9) | U-7 adds "names loaded, business lookup returns an error" and "names loaded, business lookup throws", asserting no fixture name in `JSON.stringify` of every log argument. U-4/U-5 assert `err` is the exact error object / rejection (identity). U-9: the logger mock's `child` is a spy, asserted called with the request's `x-correlation-id`. |
| W4-4 | T-2 (N-2, N-6) | N-2 asserts each chunk's exact `.in('id', …)` argument. N-6: the guard file's logger mock records calls locally, and on the success path no log argument contains a `full_name` value. |
| W4-5 | T-4, T-2 (U-2) | Names are trimmed and stored only when non-empty. U-2 adds `''` and `'   '`, both giving `users: null`. |
| W4-6 | T-6, T-2 (A-1, A-2) | A-2 is symmetric: `/Runs are ON/` is in the header exactly when `ARCHIVE_RUNS_ENABLED` is `true`; "cannot happen yet" absent while it is `true`. 2.4's mention of a header TOC is dropped (that header has none). |
| W4-7 | T-10 | P6c and the OI-18 note (disposition cell, plus one Change History row in `admin-authz-unification.md`) cite SA §A's measurement. Insertions only (the OI-18 row line excepted). |
| W4-8 | T-4 | The route's header comment and the `:204-206` paragraph must not claim the `audit_trail` read moved: it stays inline (OI-9). |
| W4-9 | T-2, T-8, T-11 | Tests first and seen failing; `tsc` judged on its own result; nothing committed; `console.*` stays 0. |

- [x] ✅ **T-1 Baselines** on `56383fb4`: run `app/api/admin/audit-trail/__tests__`, `app/admin/audit-trail/__tests__`, `app/admin/archiving/__tests__`, `lib/repositories/__tests__/adminReadMethods.guard.test.ts` and `app/api/admin/__tests__/auditAdminGate.test.ts`; record pass counts. `grep -c "console\."` on the four code files (expect 0 each, section 8). `git grep -n "from('users')"` over `app lib components hooks` (expect exactly one hit, `route.ts:183`).
- [x] ✅ **T-2 Tests first.** Write 5.1 to 5.4 and 5.6. Run on the unchanged code; confirm each fails for the intended reason (for example U-1 gets `users` undefined, S-1 finds `from('users')`, R-4 finds the old placeholder). Record which failed.
- [x] ✅ **T-3 Repository** (2.1). Run 5.1.
- [x] ✅ **T-4 Route** (2.2), one edit. Update the business-name test's mocks (5.5). Run 5.2, 5.3, 5.5.
- [x] ✅ **T-5 Page placeholder and type comment** (2.3). Run 5.4 and the existing page suites.
- [x] ✅ **T-6 Archiving header comment** (2.4). Run 5.6 and `page.render.test.tsx`.
- [x] ✅ **T-7 Regression.** All T-1 suites plus the new ones; `route.validation.test.ts` and `auditAdminGate.test.ts` **unedited** (`git diff --exit-code 56383fb4 -- <both>`). Then `npx jest app/admin app/api/admin lib/repositories`; record counts and any known flake.
- [x] ✅ **T-8 Type check and lint.** Scoped `tsc` with a scratch tsconfig in the scratchpad (`extends` the repo tsconfig, `files` = the four code files and new tests), `NODE_OPTIONS=--max-old-space-size=8192`, judged by `tsc`'s **own exit code**, compared with the same run on a `git archive` export of `56383fb4`. `npx eslint` on the four code files: 0 errors, no new warnings. `npm run lint:hooks` exits 0.
- [x] ✅ **T-9 Sweeps.** `git diff --stat` shows only section 3's files, with no doc showing deletions it should not. Re-run the T-1 grep: **0** hits for `from('users')`. `console.*` still 0 in each file.
- [x] ✅ **T-10 Schema check (TA-11). Owner: SA**, read-only, before code review is approved: the O-1 columns, with ref and result recorded under SA Review Notes. Then Dev writes the phantom register P6c (2.5) with SA's ref and confirms `git diff --stat` shows insertions only for both docs.
- [x] ✅ **T-11** Fill in Implementation Notes, tick tasks, set status Code Complete. Leave everything **uncommitted**.
- [ ] **T-12** (QA / user) Manual check, section 6.

---

## 5. Test Plan

All mocks follow the existing audit-trail route tests: `@/lib/auth`, `AdminAccessService`, a capturable `@/lib/logger` whose `.child()` returns the same spies, and a `@supabase/supabase-js` proxy that records every table passed to `from()`.

### 5.1 Repository: `adminReadMethods.guard.test.ts` (extended)

| # | Case |
|---|---|
| N-1 | Selects exactly `ADMIN_PROFILE_NAME_COLUMNS` (pinned to `'id, full_name'`) from `profiles`, with `.in('id', ids)`. No `email`, no other column. |
| N-2 | Deduplicates; 201 unique ids make two `.in()` queries (chunk 200), never one per id. |
| N-3 | Empty input returns `{ data: [], error: null }` and issues no query. |
| N-4 | A database error returns `{ data: null, error }` and does not throw. |
| N-5 | `findAdminNamesByIds` added to `ADMIN_METHODS`: called only from `app/api/admin/**` (the existing `it.each`). |

### 5.2 Route: `route.userName.test.ts` (new)

| # | Case | Acceptance |
|---|---|---|
| U-1 | Rows for an account with a profile name get `users: { full_name: 'Dana Cohen' }`; `Object.keys(users)` is exactly `['full_name']` (no email, nothing else). | FR-AT1, §8 |
| U-2 | An account with no profile row, or `full_name: null`, gets `users: null`, never a placeholder string. | FR-AT1 |
| U-3 | ONE call to `findAdminNamesByIds` per page, with the unique ids; not called for an empty page. | Batching |
| U-4 | The lookup returns `{ data: null, error }`: status 200, every audit row served, no `users` key on the rows, `userLookup: 'failed'`, and `requestLogger.error` called with `{ err }` and the "User name lookup failed" message. | FR-AT2 |
| U-5 | The lookup **rejects**: same as U-4 (the "threw" message). | FR-AT2 |
| U-6 | The happy path reports `userLookup: 'ok'`, and business names still attach (the two lookups are independent: a failed name lookup leaves `business` intact, and vice versa). | Regression |
| U-7 | No person's name appears in any log argument, on the happy, failed and thrown paths (the AC-B13 pattern). | Privacy |
| U-8 | Across every case, the tables passed to the inline client's `from()` are exactly `['audit_trail']`; `users` never appears. | "Never reads `users`" (behavioural) |

### 5.3 Source guard: `noUsersTable.guard.test.ts` (new)

With comments stripped (the existing `source.guard` helper pattern):
- S-1: `route.ts` contains no `.from('users')` / `.from("users")`.
- S-2: `route.ts` calls `.from(` exactly once (the `audit_trail` read), so a second inline read cannot come back without a deliberate test change.
- S-3: `route.ts` calls `userProfileRepository.findAdminNamesByIds(`.

### 5.4 Page: `userNameAndPlaceholder.render.test.tsx` (new)

Renders the real page in jsdom with a mocked route, as `resourceAndBusiness.render.test.tsx` does.
- R-1: a row with `users: { full_name: 'Dana Cohen' }` shows "User: Dana Cohen" on the row line, and "Dana Cohen" in the expanded User tile.
- R-2: a row with `users: null` still shows the account id (the unchanged fallback).
- R-3: a row with no `users` key (failed lookup) renders and shows the id; the page does not error.
- R-4: `#audit-search` has the new placeholder exactly, and its placeholder does not match `/agent/i`.

### 5.5 Existing route test: `route.businessName.test.ts` (mocks only)

Add `jest.mock('@/lib/repositories/UserProfileRepository', …)` resolving `{ data: [], error: null }`, and remove the dead `users` branch and `mockUserRows`. No assertion changes. Without the mock the real singleton would still work against the proxy (it would read `profiles` and get `[]`), but an explicit mock keeps the suite about business names.

### 5.6 Archiving: `source.guard.test.ts` (extended, O-3)

Reading the **raw** source (comments kept), on the page's leading JSDoc block only:
- A-1: it names `ARCHIVE_RUNS_ENABLED`.
- A-2: while `ARCHIVE_RUNS_ENABLED` is `true` (imported from `lib/archiving/config`), it does not contain "cannot happen yet".

### 5.7 Unchanged suites that must stay green

`route.validation.test.ts`, `auditAdminGate.test.ts` (both unedited; their mocked reads return no rows, so the name lookup is not reached), the other eight audit-trail page suites (their fixtures carry `users: { email }`, a shape the page still accepts), and archiving `page.render.test.tsx`.

---

## 6. Manual QA Check

As a platform admin, on `npm run dev`, desktop:

1. `/admin/audit-trail`: rows for an account whose profile has a name show "User: <name>" on the row and in the expanded tile, not a UUID. An account without a profile name still shows its id. The page loads.
2. Filter by one account with the business picker: the chip still shows the business name (unchanged precedence).
3. The search box reads "Search by email, action, resource or entity ID…". Searching an action (for example `SECURITY_UNAUTHORIZED_ACCESS`) and an email still filter as before.
4. Network tab: the route's JSON `users` objects hold `full_name` only; the body has `userLookup: "ok"`.
5. `/admin/archiving`: no visible change. With runs on, no "Runs off" badge and Archive / Confirm work as before. (The header comment is code only; SA checks it at code review.)

A failed lookup is covered by U-4/U-5 and is not forced manually.

---

## 7. Acceptance Criteria Traceability

| §9 slice 4 criterion / requirement | Covered by |
|---|---|
| Audit rows show user names for users who have a profile name | 2.1, 2.2; N-1, U-1, U-2, R-1; QA 1 |
| A failed name lookup is logged and the page still loads (tested) | 2.2; U-4, U-5, R-3 |
| The route never reads `users` (FR-AT1, TA-10) | U-8, S-1, S-2; T-9 grep |
| The placeholder no longer mentions agents (FR-AT3) | 2.3; R-4; QA 3 |
| The archiving header comment matches `ARCHIVE_RUNS_ENABLED` (FR-AR1) | 2.4; A-1, A-2; SA code review |
| No change to the confirm dialog (FR-AR2) | Section 3 "not touched"; T-9 `git diff --stat` |
| TA-10: an existing repository, never `users`; the inline `audit_trail` read not moved | 1.1, 2.1, 2.2 |
| TA-11: schema confirmed before coding is approved | T-10, O-1 |
| §8 Privacy: no field beyond what admin already shows | 1.4; N-1, U-1, U-7 |
| §8 Logging: touched files have no `console.*` | Section 8; T-1, T-9 |
| All slices: happy path and a failure path for each new repository method | N-1..N-4 |

---

## 8. Logging Compliance and Recorded Debt

`grep -c "console\."` on `56383fb4`:

| File | `console.*` |
|---|---|
| `app/api/admin/audit-trail/route.ts` | 0 |
| `app/admin/audit-trail/page.tsx` | 0 (uses the client Pino logger) |
| `app/admin/archiving/page.tsx` | 0 |
| `lib/repositories/UserProfileRepository.ts` | 0 |

No conversion needed; T-9 re-counts.

Recorded, not fixed:
- **OI-9:** the `audit_trail` read itself stays on the route's inline service-role client (TA-10).
- The route's `audit_trail` `select('*')` sends `user_email`, `details` and `changes` to the page. Pre-existing and by design for a compliance browser; not widened here.
- Search does not match person or business names (they are attached after filtering). The placeholder now says so implicitly; adding them to search is not in scope.
- Search runs in memory over a window of `pageSize × 5` rows, so a match beyond that window is never found. Pre-existing; the placeholder does not promise otherwise (SA optimisation note).

---

## 9. Risks and Rollback

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| SA finds `profiles.full_name` or `profiles.id` differs live from the code's use | Low / Med | T-10 before code approval; `listForAdmin` already reads both in production. |
| A full name reaches a log line | Low / Med | Counts only in the repository and the route; U-7. |
| The new read slows the page | Low / Low | One indexed primary-key `.in()` per page (≤200 ids). |
| A name lookup failure looks like "no name" | Low / Low | `users` key absent plus `userLookup: 'failed'`, as for business names (U-4). |
| Doc edits damage the phantom register or the authz workplan | Low / Med | Targeted `Edit` only; `git diff --stat` shows insertions only (T-10). |

**Rollback:** one PR, no migration, no data, no gate or register change. Reverting it restores the phantom `users` read, so names go back to empty with the error discarded: the state that shipped until now, harmless but silent. The placeholder and the archiving comment revert with it. Partial reverts are safe in any combination.

---

## 10. PR Body Draft

```markdown
## fix(admin): audit trail shows user names; honest search placeholder and archiving comment (ADMIN_BOS_CLEANUP slice 4)

### What changes
- **Audit trail names (FR-AT1, FR-AT2).** The route asked a `users` table that does not exist and discarded the error, so the admin audit trail has never shown a person's name (OI-18, R-20). Names now come from `profiles.full_name` through a new admin read, `UserProfileRepository.findAdminNamesByIds` (one batched read per page, columns `id, full_name` only, callable only from `app/api/admin/**`). A failed lookup is logged with the request's correlation id and the page still loads; the body says `userLookup: 'failed'` rather than pretending there is no name.
- **Search placeholder (FR-AT3).** "Search by agent, user email, or name..." becomes "Search by email, action, resource or entity ID…", which matches the fields the route searches.
- **Archiving header comment (FR-AR1).** It said runs "cannot happen yet". Runs are on (`ARCHIVE_RUNS_ENABLED = true`). It now says so, what switches them off, and what the page does when they are off. Comment only; the confirm dialog is unchanged (FR-AR2).
- Phantom register: P6c records `users` (measured live by SA at <ref>), resolved at this site.

### Privacy
The name read selects `id, full_name` only, a field `/admin/users` already shows across accounts. No email or other profile field is added to any response.

### Not changed
The `audit_trail` read (still inline, OI-9), the search behaviour, business names, the archiving dialog and config, the gate, the sidebar.

### Tests
- Repository: columns pinned, batching, empty input, error result, caller guard.
- Route: names attach; no-profile rows get `null`; error and rejection both logged and survived; no name in any log; the inline client reads `audit_trail` only.
- Source guard: no `.from('users')`, one inline read.
- Page: the name renders; a missing `users` key still renders; placeholder text.
- Archiving: header names `ARCHIVE_RUNS_ENABLED` and no longer says runs cannot happen.

### Rollback
Revert the PR. No migration or data. The reverted state is the previous one: names empty, error discarded.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 11. Effort Estimate

| Part | Estimate |
|---|---|
| Baselines (T-1) | 0.25 h |
| Tests written first and seen failing (T-2) | 2 to 2.5 h |
| Repository method (T-3) | 0.5 h |
| Route (T-4) and business-name test mocks | 0.75 h |
| Placeholder and archiving comment (T-5, T-6) | 0.5 h |
| Regression, scoped `tsc`, lint, sweeps (T-7 to T-9) | 1 to 1.5 h |
| Docs and notes (T-10 Dev part, T-11) | 0.5 h |
| **Total** | **about 5.5 to 6.5 h (S).** Excludes T-10's live check (SA) and T-12 (QA / user). |

---

## 12. Open Points for SA

| # | Point | Dev proposal |
|---|---|---|
| **O-1** | **Columns and tables to verify live (TA-11), read-only, with ref.** Dev has no database access. | SA confirms: **`public.users` missing** (expected PGRST205 / 42P01; this is what makes P6c true); **`profiles.id`, `profiles.full_name`** exist (the new select, as a whole-select probe `select('id, full_name')`); and, because the new placeholder makes claims about them, the search fields **`audit_trail.user_email`, `audit_trail.resource_name`, `audit_trail.entity_id`, `audit_trail.action`, `audit_trail.details`, `audit_trail.changes`**, plus **`audit_trail.user_id`** (the join key). Recorded under SA Review Notes; Dev then writes P6c. |
| **O-2** | **Placeholder wording.** The requirement proposes "Search by email, name, action or ID…". Search does not match a person's or a business's name, only `resource_name`, so a bare "name" would now mislead, because names appear on the rows. | **"Search by email, action, resource name or ID…"**. If SA prefers the requirement's wording, it is a one-string change. |
| O-3 | A test on a code comment (5.6). The §9 criterion is "the header comment matches `ARCHIVE_RUNS_ENABLED`", which only a comment read can check, but comment tests are unusual. | Keep A-1/A-2 (two assertions, raw source, header block only). Drop them if SA judges this disproportionate; SA code review then checks the comment by eye. |
| O-4 | `userLookup: 'ok' \| 'failed'` and dropping the `users` key on failure copy the `businessLookup` precedent. Nothing renders either flag. | Keep, for symmetry and so a failed lookup is not served as "no name". The alternative (`users: null` on failure, no flag) is simpler but repeats the honesty gap the business-name work closed. |
| O-5 | Marking admin-authz OI-18 resolved is an edit to another programme's workplan. | One targeted insertion on the OI-18 row ("Resolved 2026-10-03 by ADMIN_BOS_CLEANUP slice 4, PR #…"). Drop it if SA prefers the phantom register alone. |
| O-6 | The business-name and person-name lookups are independent and could run in parallel (`Promise.all` over two never-throwing calls). | Keep them sequential, like the existing code: one extra primary-key round trip per page on an admin screen. Parallel only if SA asks. |
| O-7 | The page's `users.email` branches (row line, User tile, account chip) can no longer be hit from the route, because `profiles` has no email. `audit_trail.user_email` is already in each row and could feed them. | No change: the requirement asks for names, and showing email first would hide the name on most rows. The type comment (2.3) records it. Showing `log.user_email` as a fallback after the name is a possible later UI change, not this slice. |
| O-8 | Method placement. TA-10 says "an admin repository method". | On `UserProfileRepository` (the owner of `profiles`), following the slice 2b owner-repository admin-read discipline (`listForAdmin`), not a new repository. |

---

## Implementation Notes

**Dev, 2026-10-04.** Branch `fix/admin-audit-archiving-fixes` @ `56383fb4`, worktree `neuronforge-admin-audit`. Everything uncommitted.

| Task | Result |
|---|---|
| T-1 | Baseline on `56383fb4`: the five audit/archiving/repository/gate paths = **15 suites, 256 tests, all pass**. `console.*` = 0 in all four code files. `from('users')`: 1 hit, `route.ts:183`. |
| T-2 | Tests written first and run while the four code files were still byte-identical to `56383fb4` (`git diff --quiet 56383fb4 -- <four files>`): **30 failed, 54 passed** across the 5 new/extended suites. Every N-*, S-*, A-*, U-1..U-6, U-8 (non-empty pages), U-9, the U-7 "names loaded" cases and the caller-guard entry failed for the intended reason (for example U-1 `users` undefined, U-8 an extra `users` table, U-9 no "user name lookup failed" on the child, N-* method missing). Passing on old code, by design: R-1..R-3 (page logic unchanged; regression pins), U-7's two failed-lookup cases (vacuous on old code, as SA §E predicted; the "names loaded" cases carry the weight), U-8 empty page. R-4 first failed for the wrong reason (the input renders after the first load); the test was fixed to wait for the field and re-proved against a `git show 56383fb4` copy of the page in the scratchpad: **R-4 fails on the old placeholder, R-1..R-3 pass**. |
| T-3 | `findAdminNamesByIds` + `AdminProfileName` + `ADMIN_PROFILE_NAME_COLUMNS`. JSDoc states the service-role client, "intentionally bypasses RLS on `profiles` — admin-only context", and the `requireAdmin` + caller-guard boundary (W4-1). |
| T-4 | Route: `users` read replaced; names trimmed and stored only when non-empty (W4-5); `userLookup`; header and `:204-206` comments rewritten without claiming the `audit_trail` read moved (W4-8); one `// any:` comment on the pre-existing `any`s (SA optimisation note). Business-name test: `UserProfileRepository` mocked, dead `users` branch and `mockUserRows` removed, no assertion changed. |
| T-5 | Placeholder `"Search by email, action, resource or entity ID…"` (W4-2); `users` type comment (O-7: the `users.email` branches stay, unreachable from the route). |
| T-6 | Archiving header rewritten; A-1/A-2 symmetric with `ARCHIVE_RUNS_ENABLED` (W4-6). |
| T-7 | Targeted: **18 suites, 296 tests, all pass** (baseline 15 / 256; +40 new). `route.validation.test.ts` and `auditAdminGate.test.ts` unedited (`git diff --exit-code 56383fb4` clean). Wide `npx jest app/admin app/api/admin lib/admin lib/repositories`: **153 suites, 3451 tests, all pass**, no flake seen. |
| T-8 | Scoped `tsc` (scratch tsconfig, `"include": []`, `files` = the four code files and six touched tests, `NODE_OPTIONS=--max-old-space-size=8192`): **exit 0, 0 errors**. Baseline on `git show 56383fb4` copies in the scratchpad, same config (relative imports rewritten to `@/`, `paths` fallback to the repo's `node_modules/@types` then `node_modules`): **exit 0, 0 errors**. ESLint on the ten touched code/test files: **0 errors**; warnings unchanged per file against `git show` copies via stdin (route 5 → 4, page 12 → 12, others 0 → 0). `npm run lint:hooks`: exit 0. |
| T-9 | `from('users')` over `app lib components hooks`: **0**. `console.*`: 0 in all four. `ArchiveConfirmDialog.tsx`, `lib/archiving/config.ts`, `BusinessProfileRepository.ts`, `lib/repositories/index.ts`, `docs/admin/` untouched. |
| T-10 | P6c written in the phantom register with SA §A's measurement (`56383fb4`, 42P01 / 42703, two negative controls) and a Change History row: **13 insertions, 0 deletions**. `admin-authz-unification.md`: note appended to the OI-18 disposition cell plus one Change History row: **2 insertions, 1 deletion (the OI-18 row line)**; the slice-4 history row at `:892` left as it was (W4-7, O-5). |

**Deviations.**
- **U-9 added** (W4-3c): the test's logger mock gives the child its own spies, so it proves the failure is logged on the child bound to the request's `x-correlation-id`, not merely that `child` was called. The PR body's correlation-id claim is therefore kept.
- **U-2 also covers a padded name** (`'  Avi Levi  '` → `'Avi Levi'`) and a debug-count case (`userNamesResolved` counts real names only), both following from W4-5.
- **Trimming lives in the route, not the repository.** The repository returns `profiles` rows as stored; the route decides what counts as a name to show (W4-5 is a route condition).
- **5.3 S-2** checks both the list of literal `.from('…')` tables (`['audit_trail']`) and the raw count of `.from(`, plus a negative control on the S-1 pattern.
- **Baseline `tsc` used `git show` copies, not `git archive`** (per the task brief), with relative imports rewritten to `@/` so they resolve from the scratchpad.

## SA Review Notes

### SA Review — slice 4 (2026-10-03)

**Reviewed by SA — 2026-10-03.** **Scope:** one combined review of the requirement for slice 4 (§4.3 FR-AT1..FR-AT3, §4.4 FR-AR1..FR-AR2, §9 slice 4, TA-10, TA-11, the §8 Privacy, Honesty and Logging NFRs as they apply) **and** this workplan, under the lighter process the user approved. There was no separate requirement review.
**Ref:** `fix/admin-audit-archiving-fixes` @ `56383fb4` (`origin/main`). The only change in the working tree is this untracked workplan. Code read on that ref.
**Status:** ✅ **Approved with conditions.** Dev may implement once W4-1..W4-9 are carried into the task list. This section governs where it differs from sections 2 to 7.

#### A. Schema check (TA-11, Dev's O-1), measured live and read-only

**Method:** the `business-os-schema-check` skill, Rules 1, 2 and 5. A scratchpad script ran `select(cols).limit(0)` with the service role against the live project in `.env.local`. It probed one column at a time, then the whole selects, then the new method's exact shape with its `.in('id', …)` filter. Then it ran four `head: true` counts (no rows returned) to check that the fields the placeholder names actually hold data. Nothing was written and no DDL ran. `npm run schema:check` was not used: the route's `audit_trail` read is `select('*')`, and that is one of its blind spots.

| Probe | Live result | Meaning |
|---|---|---|
| `users(id)` and `users(id, email, full_name)` | ❌ **42P01** `relation "public.users" does not exist` | **Confirmed.** The route's read has always failed, and the error was discarded. Rule 5 shape: **Never worked**, and the value is used. Rebuild, as planned |
| `profiles(id, full_name)` whole select, and each column alone | ✅ OK | The new select is valid |
| `profiles(id, full_name).in('id', [uuid]).limit(0)` | ✅ OK | The new method's exact shape, filter included |
| `profiles(email)` | ❌ 42703 | Confirms admin-authz OI-18: `profiles` has no email. Email is not rebuilt |
| `audit_trail.user_id, user_email, resource_name, entity_id, action, details, changes` (each alone, then all together) | ✅ all exist | The join key and every field the search matches |
| `audit_trail.created_at, severity, entity_type` | ✅ | The route's filters and order (checked as well, since the read is `select('*')`) |
| **Negative control 1:** `audit_trail(definitely_not_a_column_sa_s4)` | ❌ 42703 | The probe really reports a missing column |
| **Negative control 2:** `definitely_not_a_table_sa_s4(id)` | ❌ 42P01 | The probe really reports a missing table, with the same code as `users` |
| Population (head counts) | `audit_trail` 59,150 rows: `user_email` set on 54,447, `resource_name` on 33,287, `entity_id` on 59,049, `user_id` on 59,119. `profiles` 13 rows, `full_name` set on 7 | "Email" in the placeholder is honest. **6 of 13 accounts have no profile name**, so the U-2 / R-2 fallback is the common path, not an edge case |

Dev records this table's ref (`56383fb4`, live, 2026-10-03, SA) in phantom register P6c (T-10).

#### B. Requirement findings (the requirement part of this review)

| # | Finding | Effect |
|---|---|---|
| B4-1 | **TA-10 confirmed.** `findAdminIdentitiesByUserIds` selects `user_id, company_name, vertical, sub_vertical`: a business name, not a person's. So the fallback applies: a `profiles` name read on an admin repository method. `UserProfileRepository` owns `profiles` and already holds the slice 2b admin read `listForAdmin`, so no new repository is needed. The inline `audit_trail` read stays (OI-9), as TA-10 allows | O-8 accepted |
| B4-2 | **FR-AT3's proposed text is wrong in two places.** (a) "name": search matches `resource_name` only. Person and business names are attached **after** filtering (`route.ts:155-177`), and once this slice ships, names will be visible on the rows, so "name" would invite a search that silently finds nothing. (b) "ID": search matches `entity_id` only. It does not match the event id or the account id, and the account id is the id an admin is most likely to paste. The page's own labels are "Resource" (`page.tsx:885, 958`) and "Entity ID" (`:923`) | O-2 ruling below. FR-AT3 note added to the requirement |
| B4-3 | **FR-AR1 as worded would make the comment go stale again.** "Say runs are on" is a statement about a constant's current value. If the constant is flipped to `false`, the comment becomes the same kind of lie V-6 found. The comment can say it, but a test must tie it to the constant | W4-6 |
| B4-4 | **Privacy claim (§8) checked: correct.** The new read selects `id, full_name`. `full_name` is already on a cross-account admin screen: `ADMIN_PROFILE_LIST_COLUMNS` feeds `/admin/users` through `app/api/admin/users/route.ts`, and `app/admin/adminDisplayName.ts` reads it too. The response's `users` object narrows from the intended `{ id, email, full_name }` to `{ full_name }`. It is not message text, a prompt, a payload or a client's contact detail, so it is metadata under §8. The `select('*')` that sends `user_email`, `details` and `changes` is pre-existing and recorded in section 8, not widened | No change |
| B4-5 | **FR-AT2 is met by the design.** Both the `{ error }` result and a rejected promise are logged on the request logger, and the rows are still served | Tested by U-4 and U-5, strengthened by W4-3 |

#### C. Rulings on the open points

| # | Ruling |
|---|---|
| **O-1** | Done (§A). All of Dev's claims are confirmed, and no new phantom was found |
| **O-2** | **Overruled in part.** Use **`"Search by email, action, resource or entity ID…"`**. It uses the page's own labels ("Resource", "Entity ID"), every term maps to a field the route matches, and it promises no person or business name, no account id and no event id. It also drops a word of length against Dev's version. R-4 pins this exact string and also asserts it does not match `/agent/i`. Note added to the requirement (FR-AT3) |
| O-3 | **Keep the comment test, made symmetric** (W4-6). Two assertions on the raw header block are proportionate for the one comment that guards the most destructive button in admin |
| O-4 | **Accept** `userLookup: 'ok' \| 'failed'`, and drop the `users` key when the lookup failed. Same precedent and reason as `businessLookup`: "unknown" must not be served as "no name" |
| **O-5** | **Accept, as targeted insertions only.** Append a "Resolved 2026-10-03 by ADMIN_BOS_CLEANUP slice 4 (PR #…)" note to the **disposition cell** of the OI-18 row in `admin-authz-unification.md`, and add one Change History row to that doc. Leave its dated history rows unchanged, including the slice-4 row at `:892` ("OI-18 … is still open"): they record what was true then. Check `git diff --stat` on that doc: insertions only, 0 deletions apart from the one line that holds the OI-18 row |
| O-6 | **Sequential is fine.** One primary-key `.in()` on a 13-row table, on an admin page. `Promise.all` is not worth a new shape in this route |
| **O-7** | **No change to the page logic in this slice.** The `users.email` branches can no longer be reached, but they are harmless. Removing them would mean editing the eight existing page suites whose fixtures use `users: { email }`, which is churn out of proportion to the slice. The type comment (2.3) records it. Whether an unnamed account should show its `user_email` instead of the account id is a product choice, and it goes to the user (§F). Not this slice |
| O-8 | **Accept**, on `UserProfileRepository` (B4-1) |

#### D. Repository pattern check (`new-repository` skill, `findAdminNamesByIds`)

| Checklist item | Verdict |
|---|---|
| Returns `{ data, error }` and never throws | ✅ as designed (try/catch, `{ data: null, error }`). N-4 tests it |
| Batched in chunks, one `.in()` per chunk, deduplicated, empty input makes no query | ✅ the same as `findAdminIdentitiesByUserIds`. Importing `ADMIN_IDENTITY_CHUNK` creates no cycle: `BusinessProfileRepository` does not import `UserProfileRepository` |
| Allow-listed columns, never `*` | ✅ `ADMIN_PROFILE_NAME_COLUMNS = 'id, full_name'`, pinned by N-1 |
| `user_id` scoping | ✅ The equivalent here is `.in('id', chunk)`, as the file header documents. It is cross-account by design, so it must say so (next row) |
| **Service-role use documented** | ⚠️ **Not yet.** The planned JSDoc says "Every account, by design", but it never says that the default client is `supabaseServer` and bypasses RLS on `profiles`. The skill requires that to be stated (W4-1) |
| Caller restriction | ✅ **Right.** `adminReadMethods.guard.test.ts` restricts it to `app/api/admin/**`, and the required admin authz CI guard makes every route there call `requireAdmin`. The regex `\.findAdminNamesByIds\(` matches the planned call site. The limit, already recorded for the other methods: the guard proves where the method is called from, not that the gate runs first. The gate test `auditAdminGate.test.ts` covers that for this route |
| Types in `types.ts` and barrel export | Waived, consistent with the slice 2b methods (`AdminProfileListRow` lives in the repository file; the route imports the singleton directly). No barrel change |
| No `'use client'` importer | ✅ `page.tsx` consumes the JSON only |
| Unit tests: happy path and error path | ✅ N-1..N-4, plus W4-4 |

**Import side effects on the unedited suites.** The route now imports `UserProfileRepository`, which loads `@/lib/supabaseServer`. `route.validation.test.ts` and `auditAdminGate.test.ts` both mock `@supabase/supabase-js`, so the extra import is safe. `auditAdminGate`'s builder resolves `data: []`, so `userIds` is empty and the new read is never reached. Its ordered `['audit_trail']` refusal assertion is not affected. The "unedited" claim in 5.7 holds.

#### E. Will the U-* tests prove what they claim?

- **U-8 is sound for the inline client.** Both repositories are module-mocked, so the recorded `from()` list is only the route's own reads. Leave it like that. If the user-profile repository were unmocked, `supabaseServer` would come from the same mocked `createClient`, and `profiles` would appear in the list legitimately.
- **U-7 as written is mostly vacuous.** On the failed and thrown paths, no name ever exists in memory, so "no name in the logs" cannot fail there. The paths that matter are the ones where names **were** loaded and something else then logs: the name lookup succeeds and the business lookup fails or throws, and the happy-path final `debug`. W4-3 adds them.
- **The correlation id is claimed, not tested.** The PR body says the failure is "logged with the request's correlation id". The logger mock makes `child()` return the same object, so nothing proves it. Either assert it (W4-3), or remove the claim from the PR body.
- **The repository's own logging** is outside U-7 because the repository is mocked there, and the guard file's logger mock records nothing. W4-4 covers it.

#### F. For the user (business terms, non-blocking, not this slice)

**Q-SA4-1.** About half the accounts (6 of 13 today) have no name in their profile. After this slice, their audit rows will still show a long account id, as they do now. The audit row already carries the person's sign-in email, and search already matches it. Should those rows show the **email** when there is no name? It would make rows readable for everyone, and it would put people's sign-in emails on the screen where today they appear only in search. SA recommends yes, as a later small UI change. It does not block slice 4.

#### Conditions (carry into the task list)

| # | Condition | Priority |
|---|---|---|
| **W4-1** | The `findAdminNamesByIds` JSDoc states that the method runs on the default service-role client (`supabaseServer`) and **intentionally bypasses RLS on `profiles`** for a cross-account admin read, and that the boundary is `requireAdmin` on the only caller plus the caller guard. One sentence, in the skill's wording ("Intentionally bypasses RLS — admin-only context") | High |
| **W4-2** | Placeholder = `"Search by email, action, resource or entity ID…"` (O-2), with the Unicode ellipsis as in Dev's draft. R-4, QA step 3 and the PR body use this exact string | High |
| **W4-3** | Route tests: (a) **U-7** also covers "names loaded, business lookup returns an error" and "names loaded, business lookup throws". It asserts that `JSON.stringify` of every log argument across all levels contains no fixture name. (b) **U-4 / U-5** assert that `err` is the exact error object or rejection the mock produced (identity, not just truthy). (c) Make the logger mock's `child` a spy, and assert it was called with the `correlationId` from the request's `x-correlation-id` header, or remove "with the request's correlation id" from the PR body. SA prefers the assertion | Medium |
| **W4-4** | Repository tests: **N-6**. The guard file's logger mock records calls (a local capture, not a shared helper), and on the success path the repository's log arguments contain no `full_name` value. **N-2** asserts the two chunks' exact `.in('id', …)` arguments, as the business-identity test does | Medium |
| **W4-5** | Route: only non-empty names go into `userNames`. Trim the name, and store it only when the result is not empty. Then `users` is `{ full_name }` exactly when a name exists, and the debug count `userNamesResolved: userNames.size` means what it says. U-2 adds `full_name: ''` and `'   '` cases, both giving `users: null` | Medium |
| **W4-6** | Archiving header: keep "Runs are ON" in substance, and make A-2 **symmetric**: assert that the header's "Runs are ON" phrase is present **if and only if** `ARCHIVE_RUNS_ENABLED` is `true` (`expect(/Runs are ON/.test(header)).toBe(ARCHIVE_RUNS_ENABLED)`), and that "cannot happen yet" is absent while it is `true`. Then flipping the constant forces the comment to be edited in the same reviewed diff. Also drop "The Table of Contents of that header" from 2.4: that header has none | Medium |
| **W4-7** | P6c and the OI-18 note (O-5) are written only after this review, with §A's ref. For both docs, `git diff --stat` shows insertions and no deletions, apart from the single OI-18 row line that receives the note | Medium |
| **W4-8** | The route's header comment and the stale `:204-206` paragraph are rewritten as planned. The rewrite must not claim that the `audit_trail` read moved: it is still inline (OI-9) | Low |
| **W4-9** | Process as planned: tests first and seen failing (T-2); `tsc` judged by its own exit code (T-8); nothing committed. `console.*` stays at 0 in all four code files (confirmed on `56383fb4`: SA re-ran the T-1 grep, 1 hit for `from('users')`, at `route.ts:183`) | Low |

#### Optimisation suggestions (non-blocking)

- `route.ts:149` `searchInJSON(obj: any)` and the `(log: any)` callbacks are pre-existing uncommented `any`s in a file this slice edits. Adding one `// any: audit_trail is read with select('*') and has no generated type` comment is enough (rule 6). Do not retype them in this slice.
- The search runs in memory over a window of `pageSize × 5` rows, so a match beyond that window is never found. This is pre-existing, and the placeholder does not promise otherwise. Record it in section 8 under "Recorded, not fixed".

#### Approval

- [x] Requirement for slice 4 approved, with FR-AT3's wording corrected (O-2, requirement note dated 2026-10-03).
- [x] Workplan approved, **with conditions W4-1..W4-9**. Proceed to implementation. SA code review then checks W4-1..W4-9, the archiving comment against `lib/archiving/config.ts:59-64`, and that P6c cites §A.

### SA Code Review (2026-10-04)

**Code Review by SA — 2026-10-04.** **Ref:** `fix/admin-audit-archiving-fixes` @ `56383fb4` plus the uncommitted working tree (10 modified files, 3 new tests, this workplan). Read with `git diff`; base copies via `git show 56383fb4:<path>` into the SA scratchpad. Nothing in the worktree was overwritten, stashed or committed.
**Status:** ✅ **Code Approved.** No blocking finding. Low items below are optional or belong to RM.

#### Dev claims, re-measured by SA

| Claim | SA result |
|---|---|
| Targeted 18 suites / 296 tests | ✅ Re-run: **18 / 296 pass** |
| Wide `app/admin app/api/admin lib/admin lib/repositories`: 153 / 3451 | ✅ Re-run: **153 / 3451 pass**. One "worker failed to exit gracefully" warning, no failure (known teardown noise, not this slice) |
| Scoped `tsc` 0 errors | ✅ Re-run with SA's own scratch tsconfig (`include: []`, `files` = the 4 code files + 6 touched tests): **exit 0**. Base side not re-run; Dev's base result accepted, since the new side is clean |
| `from('users')` 1 → 0 | ✅ `git grep` over `app lib components hooks`: **0**. Base `route.ts` had it (S-1 regex run against the `git show` copy: matches; S-2 list on base = `['audit_trail', 'users']`) |
| 30 new tests fail on the old code | ⚠️ **Not re-measured as a count** (would need swapping files in a shared worktree). Spot-proven instead: S-1, S-2 and A-2 all fail on the base sources (base archiving header: "Runs are ON" absent, "cannot happen yet" present); by reading, U-1/U-8 fail on base (the proxy answers `users` with `[]`, so `users` is undefined and `from()` sees `users`), and N-* fail because the method did not exist. Consistent with the claim |
| `console.*` stays 0 | ✅ 0 in all four code files |
| `route.validation.test.ts`, `auditAdminGate.test.ts` unedited | ✅ Not in `git status` |

#### Conditions

| # | Verdict | Evidence |
|---|---|---|
| W4-1 | ✅ | `UserProfileRepository.ts:186-203`: names `supabaseServer`, "intentionally bypasses RLS on `profiles` — admin-only context", the `requireAdmin` + caller-guard boundary, and that the ids come from loaded rows, not the request |
| W4-2 | ✅ | `page.tsx:579` is exactly `Search by email, action, resource or entity ID…` (U+2026); R-4 pins it and asserts no `/agent/i` |
| W4-3 | ✅ | U-7 has both "names loaded, business lookup errors / throws" cases, each first proving the names flowed, then checking `JSON.stringify` of every argument on both loggers. U-4/U-5 use `toBe` identity on `err`. U-9: the child has its own spies, `child` is asserted with the header's `correlationId`, and the root logger's `error` is asserted unused, so the correlation-id claim is real |
| W4-4 | ✅ | N-2 asserts both chunks' exact `.in('id', …)` arrays (with duplicates fed in); N-6 records locally and asserts `{ requested: 2, found: 2 }` and no name |
| W4-5 | ✅ | `route.ts:210-212` trims and stores only non-empty; U-2 covers `null`, `''`, `'   '`, no profile, and a padded name; the debug count case asserts `userNamesResolved: 2` |
| W4-6 | ✅ | `source.guard.test.ts` A-2 is `expect(/Runs are ON/.test(header)).toBe(ARCHIVE_RUNS_ENABLED)` on the raw leading JSDoc, plus "cannot happen yet" absent while `true`. The header text is accurate against `lib/archiving/config.ts:58-64` (constant, not env, `true` since Slice 3, 409 `runs_not_enabled`), `app/api/admin/archiving/runs/route.ts:136`, the `runs-off-badge` next to the `h1` (`page.tsx:233-237`), "Not switched on yet" on Continue (`page.tsx:484`) and Confirm (`components/ArchiveConfirmDialog.tsx:137`), and the 409 message at `page.tsx:80` |
| W4-7 | ✅ | `admin-authz-unification.md` 2+/1− (the one OI-18 line); phantom register 13+/0−; P6c cites §A's ref, both negative controls and the 42P01/42703 codes; the anchor link resolves. The requirement's 3 insertions are SA's own 2026-10-03 note and history row |
| W4-8 | ✅ | Header (`route.ts:4-9`) and the business-name paragraph (`:236-238`) both say the `audit_trail` read is still the inline one (OI-9) |
| W4-9 | ✅ | See the table above |

Also checked: `findAdminNamesByIds` dedupes, chunks by `ADMIN_IDENTITY_CHUNK` (import creates no cycle: `BusinessProfileRepository` does not import `UserProfileRepository`), makes no query for an empty list, never throws, and logs counts only. It is in `ADMIN_METHODS`, so its callers are limited to `app/api/admin/**`. The route has no read of `users` left. `users` is omitted when the lookup fails and `userLookup` is set; both failure paths log on `requestLogger` with `{ err }`. Privacy: the only added field is `full_name` (`ADMIN_PROFILE_NAME_COLUMNS = 'id, full_name'`, and `Object.keys(users)` is pinned to `['full_name']`). The `route.businessName.test.ts` edit is limited to the mocks, as 5.5 planned.

#### Code Review Comments

1. `lib/repositories/UserProfileRepository.ts:220`: the catch path logs `requested: userIds.length` (before dedupe), but the success path logs `unique.length`. These are counts only, so privacy is not affected, but the same field means two things. Optional: hoist `unique` above the `try`, or accept. — Priority: Low
2. `app/admin/archiving/page.tsx:15-16`: A-2 ties only the phrase "Runs are ON" to the constant. If someone flips the constant to `false` and deletes only that phrase, the sentence's "is `true`" survives and the test still passes. A reviewed diff would catch that, so no change is required. — Priority: Low
3. `docs/workplans/admin-authz-unification.md` (OI-18 cell): "(PR #…)" is a placeholder. **RM fills it in at PR time**, as was done for earlier slices. — Priority: Low (RM)
4. Implementation Notes: the brief cites "deviations 1–6", but the notes list five bullets. The content is complete. This is only a counting note for the PR body. — Priority: Low

#### Optimisation Suggestions

- None beyond comment 1. O-6 (sequential lookups) still holds.

#### Code Approved for QA: **Yes**

---

## QA Testing Report

### QA Report (2026-10-04)

**QA — 2026-10-04**
**Ref:** `fix/admin-audit-archiving-fixes` @ `56383fb4` plus the uncommitted working tree. Nothing stashed, swapped or committed. Old-code checks ran against `git show 56383fb4` copies in the QA scratchpad (jest `--rootDir <worktree> --roots <scratch> --modulePaths <worktree>/node_modules`).
**Test mode:** full
**Strategy used:** A + B (Jest unit and mocked-client integration). D (manual browser check) goes to the user, because QA cannot sign in. The checklist is below.
**Focus:** api, ui, security (privacy of logs), schema (live facts taken from SA §A; QA has no database access)
**Skipped:** live browser check (no sign-in), handed to the user. No database access.
**Input source:** the trigger prompt (QA judgment within it)
**Verdict:** ✅ **PASS WITH NOTES.** No bugs. One test gap closed by a new QA suite. The notes are non-blocking.

#### Test runs (re-run by QA)

| Suite | Result |
|---|---|
| `app/admin/audit-trail/__tests__/userNameAndPlaceholder.render.test.tsx` (new) | 4 / 4 pass |
| `app/api/admin/audit-trail/__tests__/noUsersTable.guard.test.ts` (new) | 4 / 4 pass |
| `app/api/admin/audit-trail/__tests__/route.userName.test.ts` (new) | 20 / 20 pass |
| `app/api/admin/audit-trail/__tests__/route.businessName.test.ts` (mocks edited) | 12 / 12 pass |
| `app/api/admin/audit-trail/__tests__/route.validation.test.ts` (unedited) | 21 / 21 pass |
| `app/api/admin/__tests__/auditAdminGate.test.ts` (unedited) | 12 / 12 pass |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` (extended) | 31 / 31 pass |
| `app/admin/archiving/__tests__/source.guard.test.ts` (extended) | 25 / 25 pass |
| **Those 8 together** | **8 suites, 129 tests, all pass** |
| Wide: `npx jest app/admin app/api/admin lib/admin lib/repositories` | **153 suites, 3451 tests, all pass** (matches Dev and SA). The new QA suite was added after this run |
| **New QA suite** `app/api/admin/audit-trail/__tests__/route.searchAndNames.qa.test.ts` | **8 / 8 pass.** ESLint exit 0. Scoped `tsc` exit 0 |

- **Unedited suites:** `git diff --exit-code 56383fb4 -- route.validation.test.ts auditAdminGate.test.ts` gives exit 0.
- **Fails on old code**, run against the `git show 56383fb4` route:
  - `route.userName.test.ts`: **17 fail, 3 pass.** The 3 that pass are the ones Dev predicted: the two U-7 failed-lookup cases, which pass trivially on the old code, and the U-8 empty page. This is the count SA did not re-measure.
  - The QA suite: **7 fail, 1 pass.** Q-2 passes on both sides, as a regression pin. Every old-code failure is the missing name or `userLookup`. The search assertions themselves passed on the old code, which confirms that search behaviour did not change.
- **Sweeps:**
  - `console.*` is 0 in all four code files.
  - `from('users')` / `from("users")` in non-test code under `app lib components hooks`: 0.
  - `ArchiveConfirmDialog.tsx` and `lib/archiving/` are not in the diff (FR-AR2).

#### Coverage: slice 4 acceptance criteria → evidence

| Criterion (§9 slice 4 / §4.3–4.4) | Tested? | Result | Evidence |
|---|---|---|---|
| Audit rows show user names for users who have a profile name (FR-AT1) | ✅ | Pass | U-1, U-2 (null, `''`, `'   '`, no profile, padded name trimmed), R-1, Q-1, Q-5. Repository: N-1 (columns pinned to `id, full_name`), N-2, N-3. Live: 7 of 13 profiles have a name (SA §A) |
| A failed name lookup is logged and the page still loads, tested (FR-AT2) | ✅ | Pass | U-4 (error result) and U-5 (rejection): 200, rows served, `users` key absent, `userLookup: 'failed'`, exact `err` identity. U-9: logged on the correlation-id child. R-3: the page renders a row with no `users` key. U-6: each lookup's failure leaves the other's data intact |
| The route never reads `users` (FR-AT1, TA-10) | ✅ | Pass | U-8 (`from()` = `['audit_trail']` on every path), S-1, S-2, QA grep 0 |
| The placeholder no longer mentions agents (FR-AT3, SA wording) | ✅ | Pass | R-4 exact string plus `not.toMatch(/agent/i)`. **New:** Q-1 proves each field the placeholder names (email, action, resource, entity ID) is matched by the route's search, case-insensitive. Q-2 proves a person's name is not matched, which is why the placeholder does not offer "name" |
| The archiving header comment matches `ARCHIVE_RUNS_ENABLED` (FR-AR1) | ✅ | Pass | A-1, A-2 (symmetric). QA checked each claim in the comment against the code: `config.ts:64` is `true`, the "Runs off" badge is at `page.tsx:235`, "Not switched on yet" is at `page.tsx:484` and in the dialog at `:137`, and the 409 message is at `page.tsx:80` |
| No change to the confirm dialog (FR-AR2) | ✅ | Pass | `git diff --stat 56383fb4 -- app/admin/archiving/ lib/archiving/` shows only `page.tsx` (comment lines only) and `source.guard.test.ts` |
| §8 Privacy: no field beyond what admin already shows | ✅ | Pass | `Object.keys(users) == ['full_name']` (U-1). N-1 pins the columns |
| §8 Logging: no person name in any log line; no `console.*` | ✅ | Pass | U-7, including the "names loaded, business lookup fails or throws" paths, and N-6. `console.*` = 0 |
| A happy path and a failure path for each new repository method | ✅ | Pass | N-1..N-4, N-6 |
| Caller restriction (`app/api/admin/**` only) | ✅ | Pass | N-5 (`ADMIN_METHODS`) |
| A visible browser check of the critical path | ⚠️ | Owed by the user | Checklist below |

**Gaps:** one, now closed. Before this report, no route test exercised the in-memory search, so FR-AT3's claim ("describes what search actually matches") rested on reading the code. QA added `route.searchAndNames.qa.test.ts` (Q-1..Q-5). No other gaps.

#### Edge cases probed

| Case | Finding | Evidence |
|---|---|---|
| A page where no row has a `user_id` | No lookup is made. Every row gets `users: null` (key present) and `userLookup: 'ok'`. The page hides the User field when `user_id` is null (`page.tsx:901, 942`) | **Q-4 (new)**. Before this, only the zero-row page (U-3) was covered |
| Duplicate user ids across rows | The route dedupes with `new Set`, and the repository dedupes again. One call per page | U-3 (route), N-2 (the repository is fed duplicates) |
| More than 200 distinct users (chunking) | **The route cannot reach it.** `page_size` is capped at 200 (`lib/audit/requestSchemas.ts:125,157`), and a search window is cut back to `pageSize` before the lookup, so a page holds at most 200 ids, which is one chunk. The repository still chunks by `ADMIN_IDENTITY_CHUNK` | N-2 (201 ids → two `.in()` calls with exact arrays) |
| The name lookup succeeds and the business lookup fails, and the reverse | Independent: each failure drops only its own key and sets only its own flag. No name is logged on either path | U-6 (both directions), U-7 (names loaded, business errors or throws) |
| Search still matches `user_email` / `resource_name` / `entity_id` (and `action`) | Yes. Unchanged by this slice, and matched rows carry names | **Q-1 (new)**. Q-3: the lookup receives only the ids of rows that survived search |
| Filters combined with names | `user_id` and `severity` still reach the query as `.eq()`, and the filtered rows carry the name | **Q-5 (new)** |
| CSV export | **No change and no names.** `exportLogs` (`page.tsx:437-448`) writes `Timestamp, Action, Entity, Resource, Severity, User`, and User is `log.user_id \|\| 'System'`. So the screen now shows a name where the CSV shows the account id. The comment at `:429-436` already records that page and CSV differ, and that the CSV's quoting must be fixed before any column is widened. Reported only, not changed | Code read |
| The page renders a row whose user has no name | Shows the account id on the row line and in the User tile | R-2 (`users: null`), R-3 (no `users` key) |
| Account filter chip (side effect) | The chip's `email → full_name` fallback could not fire before, because `users` was always undefined. Filtering by an account with a profile name but no business profile now labels the chip with the person's name instead of a truncated id. This is an improvement and already pinned | `accountChipLabel.render.test.tsx` "falls back to the full name" (`:164`) |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. There is one extra primary-key `.in()` per page, on a 13-row table.

**Edge cases / notes (non-blocking):**
1. **The CSV export does not include names.** The screen shows "User: Dana Cohen", but the export shows the account id. This divergence already existed for business names and is recorded in the code. Adding a column first requires the CSV quoting fix (`page.tsx:429-436`). Recorded for the user, not this slice.
2. **About half the accounts still show an id.** 6 of 13 profiles have no name (SA §A), so for them the visible change is nil. This is SA's Q-SA4-1 (email fallback), and it remains the user's call.
3. SA comment 1 (`UserProfileRepository.ts:220` logs `requested` as the count before dedupe on the error path) is a Low inconsistency, accepted or optional.

#### Browser checklist (for the user — QA cannot sign in)

As a platform admin, on `npm run dev` from this worktree, at desktop width:

1. Open `/admin/audit-trail`. The page loads with no error banner.
2. Find a row from an account that has a profile name. The row line reads **"User: <name>"**, not a long id.
3. Expand that row. The **User** tile shows the same name.
4. Find a row from an account without a profile name (about half of them). It still shows the **account id**. This is expected.
5. The search box placeholder reads exactly **"Search by email, action, resource or entity ID…"**, with no "agent".
6. Search an action, for example `SECURITY_UNAUTHORIZED_ACCESS`. The matching rows appear and still show names.
7. Search a sign-in email fragment. The matching rows appear.
8. Search a person's name that is visible on a row. **No results** is the expected, correct behaviour (names are not searchable, which is why the placeholder does not offer "name").
9. Pick one account with the business picker, and add a severity filter. The rows narrow, names still show, and the chip shows the business name. For an account with no business profile, the chip shows the person's name.
10. DevTools → Network → the `audit-trail` request:
    - each row's `users` is `{ "full_name": "…" }` or `null`, and never contains an email;
    - the body has `"userLookup": "ok"` and `"businessLookup": "ok"`.
11. Optional: click **Export CSV**. The User column still holds account ids (note 1). This is expected.
12. Open `/admin/archiving`. **No visible change**: no "Runs off" badge, and Archive → the confirm dialog opens as before. Do not confirm a run just for this check.

A failed name lookup is covered by U-4, U-5 and R-3, and is not forced manually.

#### Final Status
- [x] All acceptance criteria pass on automated evidence, ready for the user's diff review once the browser checklist is done
- [ ] Issues found — none blocking

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-03 | Created | Dev workplan for slice 4: audit-trail names from `profiles.full_name` via `UserProfileRepository.findAdminNamesByIds`, placeholder, archiving header comment. Status Planning, awaiting SA workplan review. |
| 2026-10-04 | Code Complete (Dev) | W4-1..W4-9 carried into the task list and implemented. Implementation Notes added. Tests first and seen failing; targeted 18 suites / 296 tests and wide 153 suites / 3451 tests green; scoped `tsc` exit 0 both sides; ESLint 0 errors, no new warnings; P6c and the OI-18 note written. Uncommitted. |
| 2026-10-04 | SA code review | **Code Approved for QA.** W4-1..W4-9 all met. SA re-ran the targeted suites (18 / 296), the wide set (153 / 3451) and a scoped `tsc` (exit 0), and found 0 `from('users')` hits. The guards were spot-proven failing against `git show 56383fb4` copies. The archiving header was checked against config, route, badge, dialog and the 409 message. Four Low comments, none blocking (log count field, A-2 phrase-only tie, OI-18 "PR #…" for RM, deviations count). |
| 2026-10-04 | QA | **PASS WITH NOTES.** Re-ran: the 8 named suites 129 / 129, wide 153 / 3451. `route.userName` against the old route: 17 fail / 3 pass, as predicted. New QA suite `route.searchAndNames.qa.test.ts` (8 tests: search fields named by the placeholder, names not searchable, rows without `user_id`, filter + names); 7 of them fail on old code. No bugs. Notes: CSV export still has ids, not names; 6 of 13 accounts show an id. Browser checklist owed by the user. |
| 2026-10-03 | SA review (requirement and workplan) | **Approved with conditions W4-1..W4-9.** Live read-only probe: `public.users` missing (42P01), `profiles(id, full_name)` valid with its `.in('id')` filter, `profiles.email` missing, every `audit_trail` search field present, plus two negative controls. 6 of 13 profiles have no name. O-2 overruled in part: the placeholder is "Search by email, action, resource or entity ID…". The archiving comment test is made symmetric with `ARCHIVE_RUNS_ENABLED`. The repository JSDoc must state the RLS bypass. The log and correlation-id tests are strengthened. One non-blocking user question (Q-SA4-1, email fallback). |
