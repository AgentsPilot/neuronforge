# Workplan: Admin Archiving, Slice 3 (erasure, export, notice, switch on)

> **Last Updated**: 2026-09-27

**Developer:** Dev
**Requirement:** [ADMIN_ARCHIVING_MODULE_REQUIREMENT.md](/docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md), §13.3 Slice 3, FR-12, FR-14, C-5, C-6, C-7, C-8, C-17, AC-12, AC-13, AC-16
**Previous slice:** [ADMIN_ARCHIVING_SLICE_2B_WORKPLAN.md](/docs/workplans/ADMIN_ARCHIVING_SLICE_2B_WORKPLAN.md) (its §8 is the seed of this plan's live runbook)
**Branch:** `feature/admin-archiving-s3`, cut from `origin/feature/admin-archiving-s2b` at `71ea48fa`. PR #118 has since merged (`cb644f88` on `main`, 2026-09-27) and the branch tree equals `origin/main`, so T0 is a fast-forward.
**Process:** Full cycle: Dev workplan → SA workplan review → Dev implement → SA code review → QA → user → RM.
**Date:** 2026-09-27
**Status:** **Code Complete, NOT committed.** SA workplan review: approved with changes (R-1 to R-5 applied). Built on T1's assumptions at the user's request (2026-09-27). ⚠️ **T1 is still outstanding: nothing may be committed until the user's T1 results pass; if T1 fails, SA rules before any commit.** **No migration** (§1.2).

## Overview

Slice 3 makes the archive reachable by the person it belongs to, then switches runs on. Erasure deletes the account's archived rows and, newly (user-approved 2026-09-27), anonymise also clears `user_email`, `changes` and `resource_name` on live rows, so a row anonymised and later archived carries no personal data. Export includes archived rows, labelled. The admin audit screens show "Entries before <date> are archived". The last task flips `ARCHIVE_RUNS_ENABLED` to `true`, which **makes the Archive button live in PROD as soon as this PR deploys**.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Tenant Isolation Review](#6-tenant-isolation-review)
- [7. Live Runbook (user, after deploy)](#7-live-runbook-user-after-deploy)
- [8. Documentation](#8-documentation)
- [9. Open Questions for SA](#9-open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Measured on `feature/admin-archiving-s3` at `71ea48fa` (tree identical to `origin/main` at `cb644f88`).

### 1.1 As built

| Area | State | Slice 3 impact |
|---|---|---|
| `AuditTrailService.anonymizeUserData` (`:424-459`) | One `update` on `audit_trail` `WHERE user_id = $1`: nulls `user_id`, `actor_id`, `ip_address`, `user_agent`, `session_id`; `details = {anonymized:true}`. Leaves `user_email`, `changes`, `resource_name`. Returns a count. **No production caller** (SA §13.1, re-grepped) | Add 3 fields; then delete archived rows; return both counts |
| `AuditTrailService.exportUserData` (`:379-419`) | `select('*')` live rows `WHERE user_id`, newest first. Only caller: `scripts/test-audit-service.ts` | Merge archived rows, labelled |
| Direct `audit_trail` access in the service | Pre-existing (C-7). Not moved to a repository here | New archive access goes **only** through `ArchiveRepository` |
| `ArchiveRepository` | 11 methods; header says no method selects `payload`; per-user methods "arrive in Slice 3" | +2 methods; header and pins updated |
| `GET /api/admin/archiving` | Already returns `sources[].latestCutoff` from `getLatestCutoff` | **Not modified.** The notice reads it |
| `/api/admin/audit-trail` | On `requireAdmin` since PR #112 | **Not modified** (C-6) |
| `/api/admin/users/[id]/audit-logs` | Still an inline `AdminAccessService` check (parked, slice 4) | **Not modified** (C-6) |
| Pages to touch | `app/admin/audit-trail/page.tsx` (0 `console.*`), `app/admin/users/page.tsx` (0 `console.*`, per-user "Audit Trail" panel at `:1166`) | One `<ArchivedBeforeNotice />` line each |
| `lib/archiving/config.ts` | `ARCHIVE_RUNS_ENABLED = false` | → `true` (last task) |
| Admin handler census | No handler added | Counts unchanged; nothing to flag in CLAUDE.md |
| `console.*` in files to touch | 0 in all of them (`AuditTrailService.ts`, `ArchiveRepository.ts`, both pages) | None to convert |

### 1.2 No migration needed

| Slice 3 needs | Already live |
|---|---|
| `DELETE` on `archived_records` as `service_role` | M1: `GRANT SELECT, INSERT, DELETE … TO service_role` ("DELETE: Slice 3 erasure and purge") |
| Delete by account without a scan | M1: `archived_records_user_id_idx (user_id) WHERE user_id IS NOT NULL` |
| `SELECT` of `payload` for export | M1 grant above |
| `UPDATE` of `user_email`, `changes`, `resource_name` on `audit_trail` | The live policy `service_role_bypass_rls` (ALL); the service already updates this table. **T1 confirms the column grant and nullability live** before any code |
| No trigger re-fills `user_email` on UPDATE | `trigger_sync_audit_user_email` is `BEFORE INSERT` only (2a pre-check P02) |

**Flag condition:** if T1 shows any of the three columns `NOT NULL`, or `service_role` without `UPDATE` on one of them, Dev stops and reports to SA. It would need a different value (not a migration) or a grant (a migration).

### 1.3 Live `audit_trail` columns (business-os-schema-check)

From the RC-11 live read on 2026-09-18 ([BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md) §2.3), not from the repo script: `id`, `user_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `resource_name`, `changes`, `details`, `ip_address`, `user_agent`, `session_id`, `severity`, `compliance_flags`, `hash`, `created_at`, **`user_email`** (not in `create_audit_trail.sql`). Only `id`, `action`, `entity_type`, `created_at` are required. T1 re-reads the three columns this slice writes.

| Column | Personal data? | After anonymise |
|---|---|---|
| `user_id`, `actor_id`, `ip_address`, `user_agent`, `session_id` | Yes | `null` (today) |
| `details` | Can be | `{ anonymized: true }` (today) |
| **`user_email`** | Yes | **`null` (new)** |
| **`changes`** | Can be (before/after values) | **`null` (new)** |
| **`resource_name`** | Can be (a contact's name, an agent named after a person) | **`null` (new)** |
| `entity_id` | Only when `entity_type = 'user'` (it is then a user id) | **Kept** (Q-2) |
| `action`, `entity_type`, `severity`, `compliance_flags`, `created_at` | No | Kept |
| `hash` | No (one-way; tamper detection is off) | Kept |

---

## 2. Implementation Approach

### 2.1 Erasure: order and failure handling

`anonymizeUserData(userId)`:

1. Validate `userId` as a UUID (Zod). Refuse otherwise, before any query.
2. **Anonymise the live rows** (existing update, plus the three fields, §2.2).
3. **Delete the archived rows** via `archiveRepository.deleteArchivedForUser(userId)`.
4. Only when both succeed: write `DATA_ANONYMIZED` with `details: { recordsAnonymized, archivedRecordsDeleted, reason }`, and return `{ anonymized, archivedDeleted }`.

**Why live first, not archive first.** An archive run can be moving rows while erasure runs.

| Order | A run moves this user's rows between the two steps |
|---|---|
| Archive first, then live | Rows archived after step "delete archived" still carry `user_id` and all personal data, and nothing deletes them. **Silent leftover.** |
| **Live first, then archive** ✅ | Rows archived before the anonymise keep `user_id` and are deleted by step 3. Rows archived after it are already anonymised. Nothing is left |

A batch in flight is covered too (SA Q-1): the anonymise `UPDATE` waits on any row an open batch holds, and by the time it proceeds that row sits in `archived_records` with `user_id` intact, so step 3 deletes it. A re-run of erasure clears any remainder, as the backstop.

**Failure handling. Never silent:**

| Fails at | State left | What happens |
|---|---|---|
| Step 1 or 2 | Nothing changed | Throws. Pino `error` with `{ err }` |
| Step 3 | Live anonymised, archived rows remain (still keyed by `archived_records.user_id`, a real column with no FK) | Pino `error` `{ err, anonymized }` 'Erasure incomplete: archived rows not deleted', then **throws** `ErasureIncompleteError` carrying `anonymized`. No `DATA_ANONYMIZED` event, because erasure is not done |
| Re-run after any failure | Step 2 matches 0 rows; step 3 deletes | Idempotent. The event is written once, on the run that completes |

The return type changes from `number` to `{ anonymized: number; archivedDeleted: number }`. There is no caller to update.

### 2.2 Anonymise also clears three fields

The existing `update` payload gains `user_email: null`, `changes: null`, `resource_name: null`. Same statement, so the row is anonymised atomically. `AuditTrailService` keeps its pre-existing direct `audit_trail` access (C-7); this slice widens the payload and adds no new query to that table.

### 2.3 Rows anonymised before this fix

`anonymizeUserData` has never had a production caller, so none are expected. And `archived_records` is empty in PROD (runs are off). The user runs this **read-only** check (T1, and again as step 0 of §7). Every count is expected to be `0`:

```sql
-- Read-only. Rows anonymised before Slice 3 that still hold personal fields.
SELECT
  (SELECT count(*) FROM public.audit_trail WHERE action = 'DATA_ANONYMIZED')                  AS erasures_logged,
  (SELECT count(*) FROM public.audit_trail WHERE details = '{"anonymized": true}'::jsonb)     AS anonymised_rows,
  (SELECT count(*) FROM public.audit_trail
     WHERE details = '{"anonymized": true}'::jsonb
       AND (user_email IS NOT NULL OR changes IS NOT NULL OR resource_name IS NOT NULL))      AS anonymised_with_personal_fields,
  -- Information only (SA CR-1). No FK on user_id, so account deletion does NOT produce this pair;
  -- a non-zero count is unexplained: record it under the C-17 follow-up.
  (SELECT count(*) FROM public.audit_trail WHERE user_id IS NULL AND user_email IS NOT NULL) AS email_without_user,
  (SELECT count(*) FROM public.archived_records
     WHERE source = 'audit_trail' AND user_id IS NULL
       AND payload->>'user_email' IS NOT NULL)                                                AS archived_email_without_user;
```

- **`anonymised_with_personal_fields` = 0 and `archived_email_without_user` = 0 (expected):** proceed. No erasure path matches archived rows by `payload->>'user_email'` (the open C-17 question): after this fix no anonymised row carries an email, and none exist from before.
- **Either of those two > 0: stop and report to SA** (SA R-1). SA rules on any fix then. No data fix is pre-written.
- **`email_without_user` is information, not a stop** (SA R-1, corrected by SA CR-1). The live `audit_trail.user_id` has **no FK** (the 2026-09-18 `pg_constraint` read). Account deletion leaves an account's rows fully identified (its `user_id`, `user_email` and content), live and, once archived, in `archived_records`, and erasure by `user_id` **still reaches both**. The follow-up is that **account deletion never calls erasure**, so nothing erases a deleted account's history. So account deletion does **not** explain a non-zero count: record any count as **unexplained** in the QA report, under the C-17 follow-up (§8).

### 2.4 Export includes archived rows

`exportUserData(userId)`: validate the UUID, read live rows (unchanged), read archived rows via `archiveRepository.listArchivedForUser(userId, 'audit_trail')`, map each `payload` to an entry, and merge.

- Every entry carries `archived: boolean`. Archived ones also carry `archivedAt`. New type `GDPRExportLog = AuditLogEntry & { archived: boolean; archivedAt?: string }` in `lib/audit/types.ts`. `GDPRExport.logs` becomes `GDPRExportLog[]` and gains `archivedEvents: number`.
- Sorted newest first across both. `totalEvents`, `dateRange` and `summary` cover both.
- **An archived read failure throws.** An export that silently omits the archive is the failure BQ-7 rules out.
- `listArchivedForUser` pages with `.range()` in 1,000-row pages (the PostgREST row cap) ordered by `original_created_at DESC, id`, until a short page. The live read has the same cap today and is **not** changed. It is recorded here as pre-existing (§8), not fixed.

`listArchivedForUser` takes the source as a second argument (the requirement names only `userId`): the caller builds audit entries, and a future second source must not appear as fake audit rows. `deleteArchivedForUser(userId)` takes **no** source. Erasure removes every archived row of the account, whatever its source (AC-13: "no `archived_records` row remains for that `user_id`").

### 2.5 Repository methods

| Method | Query | Returns |
|---|---|---|
| `deleteArchivedForUser(userId)` | Refuse a non-UUID (no query). `delete({ count: 'exact' }).eq('user_id', userId)`. No `.select()`: no row content comes back | `{ data: number }` (rows deleted); a missing count is an error |
| `listArchivedForUser(userId, source)` | Refuse a non-UUID. `select('source_id, payload, archived_at').eq('user_id', userId).eq('source', source)`, paged | `{ data: Array<{ source_id, payload, archived_at }> }` |

Both are scoped by argument (CLAUDE.md Rule 4), so they take no `AllAccounts` suffix. The header gains their caller (`AuditTrailService` only) and one sentence: `listArchivedForUser` is the **only** method that selects `payload`, for the person's own export. No admin UI or route reads it (AC-14 unchanged). Neither throws; both follow the file's `{ data, error }` shape.

### 2.6 The "archived before" notice (C-6)

- `hooks/useLatestArchiveCutoff.ts`: fetches `GET /api/admin/archiving` once on mount and returns the `audit_trail` source's `latestCutoff` (or `null`). On a non-200 or a network error it returns `null`. The notice is advisory: the audit screens must not break because the archiving read failed, and the GET already logs its own failures with Pino.
- `app/admin/components/ArchivedBeforeNotice.tsx` (`'use client'`): renders nothing for `null`. Otherwise it shows one line, `Entries before <YYYY-MM-DD> are archived.` (UTC date of the cutoff), with an info icon and text, not colour alone, plus `role="note"`.
- Placed once at the top of `/admin/audit-trail` (under the header) and once inside the per-user "Audit Trail" panel in `app/admin/users/page.tsx`. **Neither route is edited.**
- The GET does about seven reads per call (counts, runs, admin labels). For a notice on two admin pages this is acceptable, and SA's C-6 names this route. It is not optimised here.
- Only a `succeeded` run sets the cutoff. After a `partial` run no notice shows until Continue finishes, which errs on the side of saying less.

### 2.7 Switch on (C-5), last task

`ARCHIVE_RUNS_ENABLED = true` in `lib/archiving/config.ts`, with the comment updated ("On since Slice 3; the flip is this reviewed diff"). Pins that move deliberately: `config.test.ts` U-C5 (`false` → `true`, now the pin test) and the GET route test's `runsEnabled` expectation. The POST route test already overrides the constant both ways and stays unedited.

⚠️ **On deploy, any admin can archive in PROD.** No restore exists (BQ-3). The user runs §7 as the first real run.

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/ArchiveRepository.ts` | modify | +`deleteArchivedForUser`, +`listArchivedForUser`; header (callers, `payload` exception) |
| `lib/services/AuditTrailService.ts` | modify | Anonymise: 3 fields, order, failure, return type. Export: merge archived |
| `lib/audit/types.ts` | modify | `GDPRExportLog`; `GDPRExport.logs`, `archivedEvents` |
| `hooks/useLatestArchiveCutoff.ts` | create | The notice's fetch |
| `app/admin/components/ArchivedBeforeNotice.tsx` | create | The notice (C-6) |
| `app/admin/audit-trail/page.tsx` | modify | One line: render the notice |
| `app/admin/users/page.tsx` | modify | One line: render the notice in the per-user panel |
| `lib/archiving/config.ts` | modify | `ARCHIVE_RUNS_ENABLED = true` (last) |
| `lib/repositories/__tests__/ArchiveRepository.test.ts` | modify | New method tests; method pin 11 → 13; `payload` pin |
| `lib/services/__tests__/AuditTrailService.erasureExport.test.ts` | create | Erasure and export |
| `app/admin/components/__tests__/ArchivedBeforeNotice.render.test.tsx` | create | Shows and hides |
| `lib/archiving/__tests__/config.test.ts` | modify | U-C5 → `true` |
| `app/api/admin/archiving/__tests__/route.test.ts` | modify | `runsEnabled` → `true` |
| `docs/REPOSITORY_STRATEGY.md`, the requirement, this workplan | modify | §8 |

Not touched: `app/api/admin/audit-trail/route.ts`, `app/api/admin/users/[id]/audit-logs/route.ts`, `GET /api/admin/archiving`, the runs route, any migration, `CLAUDE.md`.

---

## 4. Task List

- [x] **T0.** ✅ Done 2026-09-27 (now at `cb644f88`). Fast-forward the branch onto `origin/main` (`cb644f88`, PR #118 merged). Confirm `git diff origin/main` is empty apart from this workplan.
- [ ] **T1. Gate (user, read-only). ⚠️ OUTSTANDING.** Run the §2.3 check and this column check, and paste both results here. Stop per §1.2 or §2.3 if either says so. *The user chose to start implementation before T1 (2026-09-27). The code assumes: all three columns nullable, `service_role` can update them, `anonymised_with_personal_fields = 0` and `archived_email_without_user = 0`. **Nothing is committed until T1 passes; a failure goes to SA before commit.*** A third read-only query is a **drift check, not a stop** (SA CR-1): the 2026-09-18 live read found no FK on `audit_trail`; record whether that still holds:
  ```sql
  SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid = 'public.audit_trail'::regclass AND contype = 'f';
  -- Expect zero rows (no FK, as measured 2026-09-18). Any row is drift: record it for SA; it does not block.
  ```
  ```sql
  SELECT column_name, data_type, is_nullable,
         has_column_privilege('service_role', 'public.audit_trail', column_name, 'UPDATE') AS service_role_can_update
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'audit_trail'
    AND column_name IN ('user_email', 'changes', 'resource_name')
  ORDER BY column_name;
  -- Expect 3 rows, each is_nullable = YES and service_role_can_update = true.
  ```
- [x] **T2.** ✅ `ArchiveRepository`: the two methods (§2.5), header, tests.
- [x] **T3.** ✅ `lib/audit/types.ts`: `GDPRExportLog`, `archivedEvents`.
- [x] **T4.** ✅ `anonymizeUserData`: UUID check, 3 fields, live → archive order, `ErasureIncompleteError`, event details, return type. Tests.
- [x] **T5.** ✅ `exportUserData`: merge and label, throw on an archived read failure. Tests.
- [x] **T6.** ✅ Hook and `ArchivedBeforeNotice`; one line in each page. Render tests.
- [x] **T7.** ✅ Mutation checks (§5.5), each reverted.
- [x] **T8.** ✅ `npm test` (full suite; `AuditTrailService` is imported by about 20 route suites, which now load `ArchiveRepository` too), `npm run lint`, `next build`. The full suite is judged as **no new failures versus `main`** (SA R-5): `main` carries pre-existing red suites, so list any failure also red on `main` rather than fixing it here. `git diff --stat` before reading the diff.
- [x] **T9.** ✅ Docs (§8).
- [x] **T10. Last.** ✅ (uncommitted; RM commits it separately) `ARCHIVE_RUNS_ENABLED = true`, and move the two pins. Re-run the three archiving suites. **Its own final commit** (SA R-2): `feat: switch archiving runs on`, containing only `lib/archiving/config.ts` and the two pin files, so RM can revert it alone.

---

## 5. Test Plan

### 5.1 `ArchiveRepository` (existing fake builder)

| # | Case |
|---|---|
| R-1 | `deleteArchivedForUser(A)`: one `from('archived_records')`, `delete({count:'exact'})`, **exactly one filter** `eq('user_id', A)`, no `select`. Returns the count |
| R-2 | **Other accounts untouched:** the fake holds rows for A and B; after the call only A's rows are gone and B's count is unchanged |
| R-3 | Non-UUID, `''` → error, **no** `from()` call. A `null` count → error, not `0` |
| R-4 | `listArchivedForUser(A, 'audit_trail')`: filters `user_id = A` and `source`; selects `source_id, payload, archived_at`; pages until a short page (2 pages) |
| R-5 | Pins: method count 11 → 13; across the file only `listArchivedForUser` selects `payload` |

### 5.2 `AuditTrailService` erasure and export (new file; mocks `@supabase/supabase-js` and `ArchiveRepository`)

| # | Case |
|---|---|
| S-1 | The anonymise update payload has `user_email`, `changes`, `resource_name` all `null`, plus today's five `null`s and `details`, scoped `eq('user_id', A)` |
| S-2 | **Order:** the live update happens before `deleteArchivedForUser(A)`; returns `{ anonymized, archivedDeleted }`; `DATA_ANONYMIZED` details carry both counts |
| S-3 | Live update fails → throws, archive delete **not** called, no event |
| S-4 | Archive delete fails → throws `ErasureIncompleteError` with `anonymized`, Pino error logged, **no** `DATA_ANONYMIZED` event |
| S-5 | Non-UUID → throws before any query |
| S-6 | Export: live and archived merged newest first; `archived` is `false`/`true`; `archivedAt` present on archived; `totalEvents`, `archivedEvents`, `dateRange`, `summary` count both |
| S-7 | Export: archived read error → throws (no partial export) |
| S-8 | Source: `AuditTrailService.ts` contains no `archived_records` (C-7) |

### 5.3 Notice (jsdom, `fetch` mocked)

| # | Case |
|---|---|
| N-1 | `latestCutoff: '2025-09-27T08:00:00Z'` → "Entries before 2025-09-27 are archived.", `role="note"` |
| N-2 | `latestCutoff: null` → renders nothing |
| N-3 | 500 and network error → renders nothing, no throw |
| N-4 | Source: both pages render `<ArchivedBeforeNotice`; the only `fetch` URL in the hook is `/api/admin/archiving` |

### 5.4 Flag pin

`config.test.ts` U-C5: `expect(ARCHIVE_RUNS_ENABLED).toBe(true)`. The GET route test expects `runsEnabled: true`.

### 5.5 Mutation checks (Dev, 4)

| # | Mutation | Must fail |
|---|---|---|
| MU-1 | Drop `.eq('user_id', userId)` from `deleteArchivedForUser` | R-1, R-2 |
| MU-2 | Swap the order (archive delete before the live anonymise) | S-2, S-3 |
| MU-3 | Remove `user_email: null` from the anonymise payload | S-1 |
| MU-4 | `DATA_ANONYMIZED` is written even when the archive delete fails (SA R-4) | S-4 |

Must stay green, unedited: the admin-authz surface guard, `adminGate.writes.test.ts`, the no-deletion-paths guard (C-34), the purge descriptor invariants, `businessOwnedTables.test.ts`, `app/admin/audit-trail/__tests__/*`, the archiving page and runs route suites.

---

## 6. Tenant Isolation Review

Applied with the `tenant-isolation-guard` skill: both new methods run as the service role, keyed by a user id.

| Skill step | Finding |
|---|---|
| 1. Applies? | Yes: `supabaseServer`, RLS bypassed, and the row set is chosen by a `userId` argument |
| 2. Ownership pre-check | There is no parent to check: the id **is** the owner. The boundary is the caller, which must pass the **authenticated or admin-verified** user id and never a request-body value. There is no caller today (§13.1). Recorded as a contract in both method comments and in `anonymizeUserData`/`exportUserData`'s doc comments, so the first route that wires erasure inherits it. Fail closed on a non-UUID (R-3, S-5) |
| 3. Field allow-list | The only writes are a `delete` (no payload) and the anonymise `update`, whose payload is a fixed literal. Nothing is spread from input |
| 4. Scope-defeating three | **Trigger:** none on `archived_records`; `audit_trail`'s only trigger is `BEFORE INSERT`, so neither the delete nor the update fires it. **Upsert:** none. **Payload injection:** none (fixed payloads). The delete has exactly one filter, pinned by R-1 and MU-1 |
| 5. Global catalogue | n/a |
| 6. Runner | The archive runner is unchanged. The erasure/run race is handled by the order (§2.1) |
| 7. Tests | R-1, R-2 (another account untouched), R-3, S-5, MU-1 |

---

## 7. Live Runbook (user, after deploy)

Run in the Supabase SQL editor and on `/admin`. Paste the outputs into the QA report.

**Stop rules (SA R-3).**
- (a) The run ends `failed`: press Continue **once**. If it fails again, stop and send the run row and the Vercel log lines for the run id to Dev.
- (b) The run is `succeeded` but `live_left_before_cutoff > 0`, or `archived_by_run ≠ rows_archived` unless an erasure ran since the run (erasure deletes archived rows, QA note 1): stop, do not archive again, and send both step 3 outputs to Dev.
- (c) Stopping at any point is safe. Every batch is atomic, so nothing is ever half-moved.

**1. Counts before.**
```sql
SELECT
  (SELECT count(*) FROM public.audit_trail)                                                   AS live_total,
  (SELECT count(*) FROM public.audit_trail WHERE created_at < now() - interval '365 days')    AS live_eligible_365,
  (SELECT count(*) FROM public.archived_records WHERE source = 'audit_trail')                 AS archived_total,
  (SELECT count(*) FROM public.archive_runs)                                                  AS runs;
```
Also note the 365-day eligible count on `/admin/archiving`. The two may differ by a few rows, because each uses its own `now`.

**2. Run 365 from the page.** `/admin/archiving`, 365 days, Archive, then Confirm. If it ends `partial` (roughly 20,000+ rows), press Continue until it is `succeeded`. If it never goes partial, say so; Continue stays proven by tests (2b §8).

**3. Counts after, and the run row.**
```sql
SELECT id, status, retention_days, cutoff, rows_archived, batches, error_code, started_at, finished_at
FROM public.archive_runs ORDER BY started_at DESC LIMIT 1;

WITH r AS (SELECT id, cutoff, rows_archived FROM public.archive_runs ORDER BY started_at DESC LIMIT 1)
SELECT
  (SELECT count(*) FROM public.audit_trail a, r WHERE a.created_at < r.cutoff)          AS live_left_before_cutoff,  -- expect 0
  (SELECT count(*) FROM public.archived_records ar, r WHERE ar.archive_run_id = r.id)   AS archived_by_run,          -- expect = rows_archived
  (SELECT rows_archived FROM r)                                                         AS rows_archived;
```
Expect `status = 'succeeded'`, `error_code` null, and `archived_by_run` equal to step 1's eligible count, give or take the rows that crossed 365 days between the two reads (C-10). Otherwise apply stop rule (b).

**4. The audit events.** Expect one `ARCHIVE_RUN_STARTED` and one `ARCHIVE_RUN_COMPLETED`, with entity id = the run id. The filter UI is already proven by `filterOptions.test.ts`.
```sql
SELECT action, entity_id, created_at, details
FROM public.audit_trail WHERE entity_type = 'archive_run'
ORDER BY created_at DESC LIMIT 5;
```

**5. The notice shows.** `/admin/audit-trail` and one expanded user on `/admin/users` both read "Entries before <the run's cutoff date, UTC> are archived."

*Optional (AC-6 live):* Archive at 365 again. The new run is `succeeded` with `rows_archived = 0`.

---

## 8. Documentation

| Doc | Change |
|---|---|
| [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) § ArchiveRepository | Add the two methods to the table. Replace the "Slice 3: …" sentence with: per-user methods scoped by argument, called only by `AuditTrailService` erasure/export; `listArchivedForUser` is the one method that selects `payload`. Amend "never select `archived_records.payload`" to "…except for the person's own export". Tree comment line updated |
| Requirement §13.2 **C-17** | Rewrite: **fixed in Slice 3 (user-approved 2026-09-27).** Anonymise also nulls `user_email`, `changes`, `resource_name`. Erasure does not match archived rows by `payload->>'user_email'`: after the fix no anonymised row carries an email, and the T1 check found none from before. `entity_id` is kept (Q-2). Priority Info → done; slice 3. **Plus one follow-up line (SA R-1, corrected by CR-1):** account deletion never calls erasure, so a deleted account's rows stay fully identified (no FK on `user_id`), live and archived; erasure by `user_id` would still reach them. Any non-zero `email_without_user` is recorded as unexplained. Not fixed here; it needs its own item. **Plus (QA note 2):** whatever first calls erasure in production must flush the audit queue after it |
| Requirement §13.3 Slice 3 | "Deliberately NOT": drop the C-17 exclusion. Add the three fields to Scope |
| Requirement §9 | Tick AC-13 at code complete. Tick AC-16 and the live confirmations (AC-1 full, AC-4, AC-6 if the optional step is run, AC-9) after §7. AC-12 stays unit-level while the purge RPC is held |
| Requirement §13.4 | Tick "Slice 3 workplan reviewed" after SA. Status line: all slices done once §7 passes. Change History row |
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md), `CLAUDE.md` | **No change**: no handler added |
| Recorded, not fixed | The live export read has the PostgREST 1,000-row cap (pre-existing). Noted in the requirement's C-17 row as a follow-up for whoever wires export to a caller |

---

## 9. Open Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| **Q-1** | Erasure order: anonymise live first, then delete archived (§2.1)? The brief suggested the reverse | **Live first.** Archive-first leaves rows that a concurrent run archives in between, un-anonymised, with nothing to delete them. That is a silent leftover. Live-first's only failure state is loud (throws, retry completes) |
| **Q-2** | Anonymise keeps `entity_id`. It is a user id only on `entity_type = 'user'` rows (including the `DATA_ANONYMIZED` record itself, which must keep it as proof of erasure) | **Keep.** A bare UUID of an erased account is pseudonymous, and clearing it only on some rows needs a second, non-atomic update |

---

## Implementation Notes

**Dev, 2026-09-27.** Built on `feature/admin-archiving-s3` at `cb644f88`. Nothing committed. No migration. `CLAUDE.md` and `.claude/settings.local.json` untouched.

### Two change sets, for RM (SA R-2)

| Commit | Files |
|---|---|
| 1. Slice 3 (erasure, export, notice, docs) | `lib/repositories/ArchiveRepository.ts`, `lib/services/AuditTrailService.ts`, `lib/audit/types.ts`, `hooks/useLatestArchiveCutoff.ts` (new), `app/admin/components/ArchivedBeforeNotice.tsx` (new), `app/admin/audit-trail/page.tsx`, `app/admin/users/page.tsx`, tests (`lib/repositories/__tests__/ArchiveRepository.test.ts` pin 11 → 13, `ArchiveRepository.perUser.test.ts` new, `lib/services/__tests__/AuditTrailService.erasureExport.test.ts` new, `app/admin/components/__tests__/ArchivedBeforeNotice.render.test.tsx` new), `docs/REPOSITORY_STRATEGY.md`, the requirement, this workplan |
| 2. `feat: switch archiving runs on` (last, alone) | `lib/archiving/config.ts`, `lib/archiving/__tests__/config.test.ts`, `app/api/admin/archiving/__tests__/route.test.ts` |

### Verification

| Check | Result |
|---|---|
| Affected suites (archiving lib/route/page, both repository suites, the service suite, the notice, audit-trail and users pages, `lib/admin` incl. the authz guard and `adminGate.writes`, purge, `businessOwnedTables`, `lib/audit`) | **35 suites, 742 tests, all pass** (flag on) |
| New tests | Repository per-user 10 (S3-R1 to R5), service 9 (S-1 to S-8), notice 6 (N-1 to N-4) |
| Mutation checks (each restored, `cmp` byte-identical) | MU-1 (drop `user_id` filter) → S3-R1, S3-R2 fail. MU-2 (archive delete first) → S-2, S-3, S-4 fail. MU-3 (drop `user_email: null`) → S-1 fails. MU-4 (`DATA_ANONYMIZED` on a failed archive delete) → S-4 fails |
| Full `npm test` (R-5) | Branch: 552 suites run, **25 failed / 146 tests failed**. The same 25 suites run on `main` (the branch's changes stashed): **the same 25 fail, the same 146 tests**. **No new failures.** Pre-existing red on `main`: the 5 `__tests__/DeclarativeCompiler-*` and `v6-integration` (deleted modules), `lib/agentkit/v4/v4-generator`, 5 `lib/agentkit/v6/**`, `chat-v4/route.audit`, `bizql/date-anchors`, `usage/tokenUsageRepository.contract`, `orchestration/IntentClassifier`, `TokenBudgetManager`, 5 `lib/pilot/**` (ConditionalEvaluator ×2, StructuredTransforms ×3), `utils/featureFlags`, `website-builder/archetypes`, `selectTemplate` |
| ESLint, touched files | 0 errors; 28 warnings, all on pre-existing lines (`users/page.tsx` unused icons and `any`, `lib/audit/types.ts` `any`, `AuditTrailService.ts:568` `handleError` `any`) |
| `npm run lint:hooks` | Clean |
| `tsc` (8 GB) | 2,073 errors repo-wide, pre-existing; **0 in touched files** |
| `next build`, CI placeholder env | **Exit 0.** `/admin/archiving`, `/admin/audit-trail`, `/admin/users` build as dynamic. The `requireAdminPage` "Dynamic server usage" log lines are the usual build-time noise on every admin page |
| `git diff --stat` | 11 tracked files, insertions and small edits only; no deletion without insertion |

### Deviations from the plan (small)

| # | Deviation | Why |
|---|---|---|
| DV-1 | Per-user repository tests live in a new `ArchiveRepository.perUser.test.ts`; the existing suite only moves its method pin (11 → 13) and exempts the two per-user methods from the `AllAccounts` naming rule | Keeps the new stateful fake (S3-R2) out of a 530-line file; same tests as §5.1 |
| DV-2 | `ArchivedBeforeNotice` takes a `className` prop | The per-user panel needs bottom spacing; a wrapper `div` would leave an empty spaced box when nothing is archived |
| DV-3 | The hook logs a `warn` through `createLogger` on a failed read, then returns `null` | "Never swallow silently"; the admin pages already log client-side this way |
| DV-4 | S-8 forbids a `.from('archived_records')` query in the service, not the word | The service's comments name the table |
| DV-5 | T1 gains a third read-only query (the `audit_trail` FK) | SA R-1 reads the live `user_id` FK as `ON DELETE SET NULL`; the 2026-09-18 live read (LLM audit-trail workplan §2.3) found **no** FK. One query settles which, for the C-17 follow-up |

### For SA and QA

- **SA:**
  - the anonymise payload and the live-first order (`AuditTrailService.anonymizeUserData`);
  - `ErasureIncompleteError`, and that no `DATA_ANONYMIZED` is written on failure;
  - `deleteArchivedForUser`'s single filter and UUID refusal;
  - `listArchivedForUser` as the only `payload` read, and the updated repository header;
  - the caller contract comments;
  - DV-5, the FK discrepancy behind R-1.
- **QA:**
  - both notice placements, rendered with `latestCutoff` set, null and failing;
  - the users page notice fetches once per expanded user panel;
  - the §7 runbook after deploy.
  - The flag is **on**: once this deploys, the Archive button works in PROD.

## SA Review Notes

**Reviewed by SA — 2026-09-27**
**Status:** ✅ **APPROVED WITH CHANGES.** The changes are small, and SA checks them at code review.

The plan meets C-6, C-7, C-8 and the user-approved C-17 fix, and needs no migration. It edits neither parked audit route and flips the flag last. Tenant isolation was checked with the `tenant-isolation-guard` skill, and §6 is correct. There is no parent to pre-check, because the id is the owner. The contract that "the caller passes an authenticated or admin-verified id, never a body value" is recorded where the first future caller will read it. Both writes use fixed payloads, and nothing fires a trigger.

### Checks requested

| Check | Finding |
|---|---|
| `deleteArchivedForUser` cannot run unscoped | ✅ A UUID is refused before any query (R-3), there is exactly one `eq('user_id')` filter and no `select` (R-1), another account is left untouched (R-2), and MU-1 covers it. A `null` count is an error, not `0` |
| `DATA_ANONYMIZED` only on complete erasure | ✅ S-3/S-4: no event when either step fails, and it is written once on the run that completes. MU-4 is re-pointed at this (R-4) |
| The notice reads the existing GET and edits no parked route | ✅ The hook fetches only `/api/admin/archiving` (N-4). Neither `audit-trail` nor `users/[id]/audit-logs` is in §3's modify list. It fails quietly to "no notice" |
| Flip last, same PR | ✅ Safe. 2a gave the tables, lockdown and purge classification. 2b gave the gated POST, the claim, the atomic batch and audit. This slice gives erasure and export coverage (BQ-7), which is the only thing C-5 was waiting for. **R-2:** make the flip its own final commit, so it can be reverted alone if the live run misbehaves |
| Live runbook §7 | Mostly correct, but it needs explicit stop rules and two cuts (R-3). Stopping mid-way **is** safe: every batch is atomic, a `partial` run loses nothing, and rows already moved are in `archived_records`. What cannot be undone from the product is the move itself (no restore, K-2), so the stop rules say when **not** to press Archive or Continue again |

### Answers

- **Q-1: live first, then archived. Approved.** Archive-first leaves a silent leftover: rows a run archives between the two steps keep `user_id` and all their personal data, and nothing deletes them. Live-first also closes the in-flight case Dev accepted as a "narrow window". The anonymise `UPDATE` must take row locks on the account's rows. Any row an open batch holds `FOR UPDATE` makes the `UPDATE` wait until that batch commits. By then the row is gone from `audit_trail` and sits in `archived_records` with `user_id` intact, so step 3, which starts after step 2 returns, deletes it. A batch that starts after step 2 archives rows that are already anonymised. Keep "a re-run of erasure clears any remainder" as the backstop, and drop the "narrow window" caveat from §2.1.
- **Q-2: keep `entity_id`. Approved.** It is a user id only on `entity_type = 'user'` rows, and on `DATA_ANONYMIZED` it is the proof that erasure happened. A bare UUID of an erased account is pseudonymous. Clearing it on some rows only would need a second, non-atomic update.

### Required changes

1. **R-1 (High) Fix the T1 / §2.3 stop condition.** `email_without_user` is information, not a stop. ~~`email_without_user > 0` is **expected**. The live `audit_trail.user_id` FK is `ON DELETE SET NULL`, so every deleted account leaves rows with `user_id` null and `user_email` set.~~ *Corrected by SA code review CR-1 (2026-09-27):* The live `audit_trail.user_id` has **no FK** (the 2026-09-18 `pg_constraint` read). Account deletion leaves an account's rows fully identified (its `user_id`, `user_email` and content), live and, once archived, in `archived_records`, and erasure by `user_id` **still reaches both**. The follow-up is that **account deletion never calls erasure**, so nothing erases a deleted account's history. A non-zero count is therefore unexplained. Treat that count as **information**, record it in the QA report, and add one line to the requirement's C-17 row naming it as the account-deletion follow-up. Keep the real stop: `anonymised_with_personal_fields > 0` or `archived_email_without_user > 0` → **stop and report to SA**. **Delete the pre-written `BEGIN … COMMIT` data fix.** The expected count is 0, because erasure never had a caller. If it is not 0, SA rules on the fix then, rather than a transaction being run by hand in an editor that shows only the last result.
2. **R-2 (Medium) The flag flip is its own final commit** (`feat: switch archiving runs on`) containing only `config.ts` and the two pins. RM keeps it separate, so it can be reverted alone.
3. **R-3 (Medium) Tighten §7.**
   - Drop step 0: T1 already ran the same check, and nothing can change it in between, because erasure has no caller.
   - Drop `duplicate_source_ids`: the `UNIQUE (source, source_id)` constraint makes it always 0.
   - Step 4: keep the SQL query only. The UI filter is already proven by `filterOptions.test.ts`.
   - Add these stop rules:
     - (a) the run ends `failed` → press Continue **once**; if it fails again, stop and send the run row and the Vercel log lines for the run id to Dev;
     - (b) `succeeded` but `live_left_before_cutoff > 0`, or `archived_by_run ≠ rows_archived` → stop, do not archive again, send both outputs to Dev;
     - (c) stopping at any point leaves nothing half-moved.
4. **R-4 (Low) Swap MU-4** ("notice renders on `null`", UI-only) for "**`DATA_ANONYMIZED` is written even when the archive delete fails**", which must fail S-4. This keeps 4 mutation checks, all on data or privacy.
5. **R-5 (Low) T8 full `npm test` is judged as "no new failures versus `main`".** `main` carries pre-existing red suites unrelated to this slice, so "all green" is not achievable and would stall the handover.

### Approval

- [x] Workplan approved, conditional on R-1 to R-5
- [x] Slice 3 code review (below)

**Code Review by SA — 2026-09-27**
**Status:** ✅ **Code Approved for QA, with one doc fix before commit (CR-1).** T1 is still the commit gate: nothing is committed until T1's results pass.

Reviewed: `git diff` on `cb644f88` plus the six untracked files, against this workplan, requirement §13 (C-6, C-8, C-17 as rewritten) and CLAUDE.md. Tenant isolation re-checked with the `tenant-isolation-guard` skill. Read-only review; no file other than this workplan was touched.

#### Checks

| Area | Finding |
|---|---|
| `anonymizeUserData` | ✅ Zod UUID check throws before any query (S-5). The update payload adds `user_email`, `changes`, `resource_name` = `null` in the same statement, one filter `user_id` (S-1). Live first, then `deleteArchivedForUser` (S-2). A delete error **or** a `null` count throws `ErasureIncompleteError` with `anonymized`, after a Pino `error` (S-4). `DATA_ANONYMIZED` is written only after both steps (S-3, S-4, MU-4). A re-run is correct by inspection: step 1 matches 0 rows (their `user_id` is now null), step 2 deletes, the event is written. Not pinned by a test (CR-2) |
| `exportUserData` | ✅ UUID check; archived rows read through the repository, mapped from `payload`, labelled `archived: true` + `archivedAt`; live rows `archived: false`; `archivedEvents` counted; an archived-read error or missing data throws (S-7). No duplicate risk: a batch moves a row atomically, so no `source_id` is in both |
| `deleteArchivedForUser` | ✅ UUID refused before `from()`; one `delete({ count: 'exact' })`, exactly one filter `eq('user_id')`, no `select`, so no row content returns; missing count is an error, never 0; never throws. Another account untouched (S3-R2), MU-1 |
| `listArchivedForUser` | ✅ UUID refused first; `eq('user_id')` + `eq('source')`; `.range()` pages of 1,000 until a short page; stable order (`original_created_at DESC, id`). The only `payload` select in the file (S3-R5 source pin). Offset paging: see Optimisation |
| Tenant isolation (skill) | ✅ Service-role path, no parent to pre-check: the id is the owner, and the caller contract (authenticated or admin-verified id, never a body value) is written on all four methods and in `REPOSITORY_STRATEGY.md`. Fixed payloads, no upsert, no trigger fires (`trigger_sync_audit_user_email` is INSERT-only; `archived_records` has none). No caller exists today (§13.1) |
| Notice | ✅ `useLatestArchiveCutoff` fetches only `/api/admin/archiving` (N-4 pins the one URL); `null` on no cutoff (N-2), non-200 or network error (N-3). Client-safe: imports are `react`, a **type-only** `lib/archiving/types` (which itself imports types only), and `lib/logger`, which is plain Pino with `browser: { asObject: true }` and no server import. The two page edits are one import + one element each. Neither parked audit route is in the diff |
| Server code in client bundles | ✅ `AuditTrailService` now imports `ArchiveRepository` (and so `supabaseServer`) at module load. No `'use client'` file imports the service (the one hit, `app/admin/system-flow/page.tsx`, names it in a string). `next build` passed |
| Logging / Zod / types | ✅ No `console.*` in any touched file. No `any`; the one `as unknown as AuditLogEntry` on `payload` is justified by the comment (it is the whole source row, `to_jsonb`) |
| Flag flip (R-2) | ✅ Cleanly separable: exactly three files (`lib/archiving/config.ts`, `config.test.ts` U-C5, `route.test.ts` `runsEnabled`), and those files contain no other hunk. The rest of the slice has no dependency on the flag, so commit 1 is green on its own with the flag `false`. **Safe to flip:** the POST (2b) is `requireAdmin`-gated and still refuses on `false`, batches are atomic, `archived_records` is server-only with no FK, erasure and export now reach the archive (the only thing C-5 waited for), and no cron starts a run (AC-15). Revert = one commit |

#### Code Review Comments

1. **CR-1 (Medium, docs, before commit): correct the FK wording from R-1 (DV-5).** R-1 was wrong. See the DV-5 ruling below. Fix: §2.3 SQL comment and the `email_without_user` bullet, and the requirement's C-17 follow-up sentence. State: the live `audit_trail.user_id` has **no FK** (2026-09-18 `pg_constraint` read). Account deletion leaves the rows fully identified (the dead account's `user_id`, `user_email` and content), live and, once archived, in `archived_records`, and erasure by `user_id` **still reaches both**. The follow-up is that nothing erases a deleted account's history (account deletion does not call erasure), not that rows become unreachable. `email_without_user` stays **information only**, but it is not explained by account deletion; if it is > 0, record the count as unexplained under the same follow-up.
2. **CR-2 (Low): pin the re-run.** Add one service test: the archive delete fails once (S-4), then a second call succeeds → `deleteArchivedForUser` called twice, `DATA_ANONYMIZED` written once, with `recordsAnonymized: 0` and the archived count. Note in the doc comment that on a re-run the event's `recordsAnonymized` counts only that run (the first attempt's count is in the `ErasureIncompleteError` log line).

#### Optimisation Suggestions (non-blocking)

- `exportUserData` sorts `created_at` as strings. PostgREST and `to_jsonb` both render `timestamptz` in the session zone (UTC here), so it is correct today; compare with `Date.parse` if export gets a caller.
- `listArchivedForUser` uses offset paging. A run archiving this account's rows during an export can shift pages (a duplicate or a skip). No caller today; use keyset paging on `(original_created_at, id)` when export is wired, alongside the live read's 1,000-row cap already recorded in C-17.
- `/admin/users`: the notice mounts, and fetches the ~7-read GET, once per expanded user panel. Admin-only, mount-only, fails quiet: acceptable. If panels are opened in bulk, lift the hook to the page and pass the cutoff down.

#### Deviation rulings

| DV | Ruling |
|---|---|
| DV-1 | ✅ Accepted. Separate `perUser` suite; the existing method pin moves 11 → 13 deliberately and exempts only the two named per-user methods from the `AllAccounts` rule |
| DV-2 | ✅ Accepted. `className` avoids an empty spaced wrapper |
| DV-3 | ✅ Accepted. `createLogger` is client-safe (see Notice row); a `warn` on a failed read matches CLAUDE.md "never swallow" |
| DV-4 | ✅ Accepted. S-8 pins "no `.from('archived_records')` in the service", which is the C-7 property |
| DV-5 | ✅ Accepted, and it settles R-1 against SA. **The live read is right: there is no FK.** The user's 2026-09-18 `pg_constraint` read found only the pkey and `severity` constraints (LLM audit-trail workplan §2.3, "no FK on `user_id`", confirmed in that workplan's SA review). R-1 was taken from `supabase/SQL Scripts/create_audit_trail.sql:9`, which is stale; the live column comment ("Renamed from user_id to avoid PostgREST validation against auth.users") corroborates that the FK was dropped. **Keep the FK query in T1** as a cheap, read-only drift check, **not a stop**: zero rows confirms; a `SET NULL` row would bring back R-1's reading, and still needs no code change here, only the C-17 wording. |

#### Full suite (R-5)

✅ Accepted: 25 suites / 146 tests fail identically on the branch and on `main`, all in areas this slice does not touch (V4/V6/pilot, deleted-module suites, `tokenUsageRepository.contract`, `featureFlags`, website builder). Consistent with the known red on `main`. Judged as no new failures.

#### Code Approved for QA: **Yes**
Conditions: CR-1 before commit; T1 passes before any commit (a failure comes to SA); commit the flag flip last and alone (R-2). CR-2 before merge.

---

## QA Testing Report

**QA, 2026-09-27**
**Test mode:** full
**Strategy used:** A (Jest: the affected suites, plus a temporary page-level render test), C (a PGlite end-to-end script driving the real TypeScript), and mutation checks. D (Playwright) is not set up in this repo.
**Focus:** api, security, ui
**Skipped:** §7 live runbook (it runs on PROD after deploy; owed by the user, below). T1 (user, read-only) is also still owed.
**Input source:** prompt (TL brief) and §5 / §7 of this workplan

### Test coverage

| Acceptance criterion / plan item | Tested? | Result | Notes |
|---|---|---|---|
| AC-13 / C-8: erasure deletes every archived row of the account | ✅ | Pass | Unit S3-R1/R2, S-2, and E2E E3: A's 6 archived rows are gone and 0 traces of A remain in live or archive |
| C-17: anonymise also nulls `user_email`, `changes` and `resource_name` | ✅ | Pass | S-1, and E2E E3: all 4 of A's live rows have the 8 personal fields null and `details = {anonymized:true}` |
| Other accounts untouched | ✅ | Pass | S3-R2, and E2E E3: B's live and archived rows are byte-identical (md5 of every row) before and after A's erasure; the 3 system archive rows are kept |
| `ErasureIncompleteError` on a failed archive delete; no `DATA_ANONYMIZED` | ✅ | Pass | S-4, and E2E E2 (DELETE revoked on `archived_records`): throws with `anonymized = 4`, live rows anonymised, 6 archived rows kept, 0 events, Pino error logged with no email |
| Re-run completes the erasure; the event is written once | ✅ | Pass | E2E E3: returns `{anonymized: 0, archivedDeleted: 6}`, and one `DATA_ANONYMIZED` carrying both counts. E3b: a single-pass erasure of a third user returns `{2, 0}` |
| A non-UUID is refused before any query | ✅ | Pass | S3-R3, S-5, and E2E E5 (`''`, `'x'`, an injection string) |
| FR-14c: export includes archived rows, labelled | ✅ | Pass | S-6, and E2E E4: B exports 10 events (6 archived with `archivedAt`, 4 live without), newest first across both, with `dateRange` and `summary` covering both. A exports 0 after erasure |
| Export throws on an archived read failure | ✅ | Pass | S-7, and E2E E4 (SELECT revoked): throws "Failed to export archived user data: permission denied" |
| C-6 / FR-12 / AC-16: notice on `/admin/audit-trail` and in the users page panel | ✅ | Pass (unit) | See the notice states below. The live check is §7 step 5 (owed) |
| C-5: `ARCHIVE_RUNS_ENABLED = true` | ✅ | Pass | U-C5 pin. The E2E run used the **real** constant with no harness override: a 365-day run succeeded and moved 15 rows |
| C-7: the service never queries `archived_records` itself | ✅ | Pass | S-8 |
| §7 runbook SQL and T1 SQL parse and give the expected values | ✅ | Pass | E2E E6 (below) |

### Suites

Run on the worktree, flag on: **37 suites, 1,057 tests, all pass.** The set was archiving (lib, runner, GET and POST routes, page), both `ArchiveRepository` suites, the service suite, `app/admin/components`, the audit-trail and users page suites, `lib/admin` (including the authz surface guard), `adminGate.writes` (298 tests), purge (lib and route), `businessOwnedTables` and `lib/audit`. Dev reported 35 / 742 with a narrower selection. Mine adds `adminGate.writes`, `AdminSidebar.nav` and the purge commit route; minus those, the counts match. ESLint on the four source files: 0 errors, and 1 warning on the existing `AuditTrailService.ts:568`.

### Notice states, on both pages (temporary QA render test, deleted after the run)

The real `AuditTrailPage` and `UsersPage` were rendered, with `fetch` routed by URL. On the users page, a user row is expanded to open the per-user panel.

| `/api/admin/archiving` returns | `/admin/audit-trail` | `/admin/users` per-user panel |
|---|---|---|
| `latestCutoff: '2025-09-27T23:30:00Z'` | "Entries before 2025-09-27 are archived.", `role="note"` | Same text |
| `latestCutoff: null` | No note; the page renders | No note; the panel renders |
| 500 | No note; the page renders | No note; the panel renders |
| Network error | No note; the page renders | No note; the panel renders |

8 / 8 pass. On the users page, `/api/admin/archiving` is not called until a panel opens. It is then called once per opening: collapse and re-open makes a second call. This is known (§2.6) and noted below.

### Mutation checks (QA; different from Dev's MU-1 to MU-4)

Each file was backed up, mutated, tested and restored. Each restore was verified by SHA-256.

| # | Mutation | Killed by |
|---|---|---|
| QM-1 | `listArchivedForUser` drops `.eq('user_id', userId)` | S3-R4 |
| QM-2 | Export swallows an archived-read error (uses `[]`) | S-7 |
| QM-3 | The hook sets a cutoff on a 500 or network error (the notice shows on a failed read) | N-3 ×2, and the page-level test ×4 |
| QM-4 | `deleteArchivedForUser` skips the UUID check | S3-R3 ×3 |

### End-to-end on PGlite (`scratchpad/pgcheck/qa3-e2e.mjs`)

The harness applied M1 from this worktree. It seeded `audit_trail` with the full live column set and the `BEFORE INSERT` email trigger: 6 old and 4 recent rows for each of A and B, each carrying personal fields, plus 3 old system rows. Everything ran as `service_role`. esbuild bundled the real `ArchiveRepository`, the runs `POST` route and `AuditTrailService` from this worktree. Only the Supabase client, the logger, `requireAdmin` and `next/server` were stubbed. **31 / 31 checks pass.**

| Step | Result |
|---|---|
| E1 real run (365 days) | `succeeded`, 15 rows moved: A 4 live + 6 archived, B 4 live + 6 archived. The payload keeps `user_email`, and STARTED / COMPLETED were written through the real service |
| E2 erase A, DELETE revoked | `ErasureIncompleteError` (anonymized = 4). Live anonymised, archive intact, no `DATA_ANONYMIZED` |
| E3 grant restored, re-run | `{0, 6}`. A's archive is gone and A's live rows are fully anonymised. B is byte-identical. One `DATA_ANONYMIZED` |
| E4 export B | 10 events, 6 archived and labelled. Revoking SELECT makes the export throw |
| E6 §7 step 1 | `{live_total: 12, live_eligible_365: 0, archived_total: 9, runs: 1}` |
| E6 §7 step 3 | `succeeded`, `error_code` null, `live_left_before_cutoff` 0. **`archived_by_run` 9 ≠ `rows_archived` 15**, because A's erasure deleted 6 archived rows after the run (see Edge case 1) |
| E6 §7 step 4 | 2 rows, STARTED and COMPLETED, `entity_id` = the run id |
| E6 §2.3 check (after erasures) | `erasures_logged` 2, `anonymised_rows` 6, `anonymised_with_personal_fields` 0, `email_without_user` 0, `archived_email_without_user` 0 |
| E6 T1 column query | 3 rows, all `is_nullable = YES` and `service_role_can_update = true` (harness grants) |
| E6 T1 FK query | Parses; 0 rows on the harness, which has no FK. The live answer is still owed |

### Issues found

#### Bugs (must fix before commit)

None.

#### Performance issues (should fix)

1. **The users page notice re-reads the whole archiving overview on every panel open.** `GET /api/admin/archiving` makes about 7 reads per call, and collapsing and re-opening a panel calls it again. §2.6 accepts this for two admin pages. Low. If it matters later, the panel could share one read per page.

#### Edge cases (nice to fix)

1. **§7 stop rule (b) can fire falsely after an erasure.** `archived_by_run` counts rows still in `archived_records`. If any erasure (or a later purge) deletes archived rows between the run and the step 3 check, then `archived_by_run < rows_archived` with nothing wrong. The harness showed 9 against 15. Erasure has no production caller today, so the risk on the first live run is nil. Suggest a note on rule (b): "unless an erasure ran since". Low.
2. **The erasure event is queued, not written, when `anonymizeUserData` returns.** `log()` batches it, so a later failed flush, or a serverless exit before the flush, loses `DATA_ANONYMIZED` even though erasure completed. This is pre-existing batching behaviour and applies to every event. It matters more for proof of erasure, and belongs in whatever wires the first caller (for example, `await auditFlush()` after erasure). Low.
3. Export sorting compares `created_at` strings (`localeCompare`). Live and archived rows both come as Postgres ISO text, and the harness order was correct. Only mixed timestamp formats could misorder rows within one second. Info.

### Owed by the user

- **Before commit, T1 (read-only):** the §2.3 query, the column query and the FK query, with results pasted into T1. Stop if `anonymised_with_personal_fields > 0` or `archived_email_without_user > 0`, or if a column is `NOT NULL` or not updatable. Record `email_without_user` as information.
- **After deploy, §7:** (1) counts before; (2) run 365 from `/admin/archiving`, pressing Continue until `succeeded` if it goes partial; (3) the run row, `live_left_before_cutoff = 0` and `archived_by_run = rows_archived`; (4) STARTED and COMPLETED audit rows; (5) the notice reads "Entries before <cutoff date, UTC> are archived." on `/admin/audit-trail` and in one expanded user on `/admin/users`. Optionally, a second 365 run gives `rows_archived = 0`. Apply stop rules (a) to (c).

### Final status

- [x] All acceptance criteria that can be tested before deploy pass, with no bugs. **Ready for commit once T1 passes** (the SA code review is separate).
- [ ] The §7 live checks are owed after deploy.

---

## Commit Info

*(RM populates.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created | Slice 3 plan: erasure (live-first order, loud partial failure), anonymise also clears `user_email`/`changes`/`resource_name` (user-approved), read-only pre-existing-rows check, export with labelled archived rows, "archived before" notice without touching the parked routes, and the `ARCHIVE_RUNS_ENABLED` flip last. No migration. Live runbook from 2b §8 |
| 2026-09-27 | Dev: SA CR-1, CR-2 and QA notes 1, 2 applied (uncommitted) | CR-1: the no-FK wording in the section 2.3 SQL comment, the email_without_user bullet, R-1 (struck and corrected in place), section 8 and the requirement C-17 follow-up (account deletion never calls erasure); T1 FK query is now a drift check, not a stop. CR-2: service test S-4b (delete fails, re-run succeeds: delete called twice, one DATA_ANONYMIZED with recordsAnonymized 0) and the doc comment. QA 1: stop rule (b) excepts an erasure since the run. QA 2: requirement records that the first production caller of erasure must flush the audit queue. 35 suites / 743 tests green; flag-flip files unchanged |
| 2026-09-27 | Dev: Code Complete (uncommitted), T1 outstanding | T2 to T10 done on the user's instruction to start before T1. 35 affected suites / 742 tests green; 4 mutation checks fail as intended; full suite has no new failures versus `main` (same 25 suites, 146 tests); lint and `lint:hooks` clean; `next build` passes. Flag flip kept as its own change set (R-2). Five small deviations; DV-5 adds an FK read to T1 |
| 2026-09-27 | SA workplan review: APPROVED WITH CHANGES | Q-1: live-first approved (the anonymise UPDATE's row locks also close the in-flight batch case). Q-2: keep `entity_id`. R-1: `email_without_user` is expected from account deletion (live FK SET NULL), so it is information, not a stop; the pre-written data fix is removed. R-2: the flag flip is its own final commit. R-3: runbook trimmed, with explicit stop rules. R-4: MU-4 now guards the erasure event. R-5: full suite judged as no new failures versus `main` |
| 2026-09-27 | QA: PASS, no bugs | 37 suites / 1,057 tests green. 4 QA mutations (QM-1 to QM-4) all killed. Notice: 3 states × 2 pages pass on the real pages. PGlite E2E 31/31: real run, failed then completed erasure, B untouched, export labelled, §7 and T1 SQL parse. 1 performance note, 3 edge cases. T1 and §7 still owed by the user |
| 2026-09-27 | SA code review: CODE APPROVED FOR QA (conditions) | Erasure, export, both repository methods, the notice and the flag flip reviewed against C-6, C-8, C-17 and the `tenant-isolation-guard` skill: no High findings. CR-1 (Medium, docs, before commit): DV-5 settles R-1 against SA; the live `audit_trail.user_id` has no FK (2026-09-18 `pg_constraint` read; the repo script is stale), so §2.3 and the C-17 follow-up are reworded. The FK query stays in T1 as a non-stopping drift check. CR-2 (Low): pin the erasure re-run. DV-1 to DV-5 accepted; full suite accepted as no new failures versus `main`. The flag flip is cleanly separable and safe. T1 is still the commit gate |
