# Workplan: Admin Archiving, Slice 2 (runs and records)

> **Last Updated**: 2026-09-26

**Developer:** Dev
**Requirement:** [ADMIN_ARCHIVING_MODULE_REQUIREMENT.md](/docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md), §13.3 Slice 2, decision D-1 (§13.5), conditions C-1, C-3, C-4, C-5, C-7, C-9 to C-16, TQ-1 to TQ-5
**Previous slice:** [ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md](/docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md) (PR #114)
**Branch:** `feature/admin-archiving-s2`, cut from `origin/feature/admin-archiving-s1` (`1556112e`) and **rebased onto `origin/main` `9d3b2a8b`** (PR #114's merge commit; identical tree, clean rebase) at T-a0. The split is confirmed (§3, SA Q-2): RM cuts `feature/admin-archiving-s2b` from `main` after 2a merges.
**Process:** Full cycle per PR: Dev workplan → SA workplan review → Dev implement → SA code review → QA → user → RM. This slice touches data and security, so the short UI path does not apply.
**Date:** 2026-09-26
**Status:** **2a Code Complete** (awaiting SA code review). Pre-check run on PROD 2026-09-26: 5/5 PASS. M1 written, **not applied anywhere**: the user applies it by hand on PROD after code review (§5 steps 2–4). Not committed: RM commits after user approval. 2b not started.

## Overview

Slice 2 builds the archive itself and the controls to run it, and keeps it switched off in production. It adds migration **M1** (two tables, the atomic move function `archive_audit_trail_batch`, and a locked-down access model), the run methods on `ArchiveRepository`, `POST /api/admin/archiving/runs`, the real archived total, last run and run history on `/admin/archiving`, the confirm dialog and Continue, the three audit events, and both table-classification registries. It removes the unguarded `AuditTrailService.applyRetentionPolicy()`. Runs stay refused server-side (`ARCHIVE_RUNS_ENABLED = false`, 409 `runs_not_enabled`) until Slice 3 adds the erasure and export paths. The move function is proven on production data by a dry run that always rolls back.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Split Recommendation (2a / 2b)](#3-split-recommendation-2a--2b)
- [4. Migration M1 (draft)](#4-migration-m1-draft)
- [5. Production Migration Runbook (user, by hand)](#5-production-migration-runbook-user-by-hand)
- [6. Files to Create / Modify](#6-files-to-create--modify)
- [7. Task List](#7-task-list)
- [8. Test Plan](#8-test-plan)
- [9. Manual QA Check](#9-manual-qa-check)
- [10. Acceptance Criteria This Slice Closes](#10-acceptance-criteria-this-slice-closes)
- [11. Conditions Traceability](#11-conditions-traceability)
- [12. Tenant Isolation Review](#12-tenant-isolation-review)
- [13. Schema Claims and How They Are Verified](#13-schema-claims-and-how-they-are-verified)
- [14. Documentation This Slice Owes](#14-documentation-this-slice-owes)
- [15. Logging Compliance (`console.*`)](#15-logging-compliance-console)
- [16. Open Questions for SA](#16-open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [Implementation Notes](#implementation-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Measured on `feature/admin-archiving-s2` at `1556112e` (identical tree to `origin/main` `9d3b2a8b`).

| Area | What Slice 2 touches | Evidence read |
|---|---|---|
| DB (new) | `public.archive_runs`, `public.archived_records`, `public.archive_audit_trail_batch(uuid, timestamptz, integer)` in one migration, M1 | Requirement §5, §13.5; precedent `supabase/migrations/20261005_business_os_entitlements.sql` (RLS on with no policies, `REVOKE ALL` not an enumeration, stated `service_role` GRANT, INVOKER + `search_path = ''`, `REVOKE ALL ON FUNCTION … FROM public, anon, authenticated`) |
| DB (existing) | `public.audit_trail` is **read and deleted from** by the function only. Its schema, indexes and policies are unchanged | `supabase/SQL Scripts/create_audit_trail.sql` (repo copy, **drifted** from live per F-2, so every live fact goes through the FR-15 pre-check, §5 step 1) |
| Repository | `ArchiveRepository` gains read methods (archived total, run list, latest cutoff) and run methods (create, claim for continue, stale takeover, run batch, finish) | `lib/repositories/ArchiveRepository.ts`; `.claude/skills/new-repository/SKILL.md`; `TokenUsageRepository` header precedent |
| API | `GET /api/admin/archiving` extended; new `POST /api/admin/archiving/runs` | `app/api/admin/archiving/route.ts`; `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` (admin POST: `safeParse`, `invalid_body`, audit `.catch` then `await auditTrail.flush()`); `.claude/skills/new-api-route/SKILL.md` § Admin-only routes |
| Runner | The time-boxed batch loop, as a small server-only module so it can be unit-tested without Next | `app/api/business-os/purge/commit/route.ts:48` (`maxDuration = 60` precedent) |
| Page | Archived total, last run, latest cutoff and run history become real; confirm dialog; Continue | `app/admin/archiving/page.tsx`; `components/ui/dialog.tsx`, `badge.tsx`, `select.tsx` (C-15) |
| Audit catalogue | 3 events and their metadata; `archive_run` entity type | `lib/audit/events.ts` (`AUDIT_EVENTS`, `EVENT_METADATA`), `lib/audit/types.ts` (`AUDIT_ENTITY_TYPES`); `lib/audit/filterOptions.ts` derives the admin filters (C-16); `lib/audit/requestSchemas.ts` keeps both server-only by construction (`CLIENT_WRITABLE_EVENTS` / `CLIENT_WRITABLE_ENTITY_TYPES` are allow-lists) |
| Purge registry | `archived_records` → `optional:activityHistory`, `user_id`, `LEAF`, `snapshot: 'ids'`; `archive_runs` → `never`, global scope (C-4) | `lib/business-os/purge/descriptors.ts:296` (the `audit_trail` row), `:308-310` (`never` helper), `__tests__/classification-baseline.json` (frozen levels, count 124) |
| Ownership registry | `archived_records` in `USER_OWNED_TABLES` (C-14) | `lib/business-os/businessOwnedTables.ts:121`; the scan at `lib/business-os/__tests__/businessOwnedTables.test.ts:47-63` |
| Service | `applyRetentionPolicy()`, the `retentionPolicy` config field and the `RetentionPolicy` type are deleted (C-13) | `lib/services/AuditTrailService.ts:14,46-50,466-485`; `lib/audit/types.ts:213-229`. Grep over `app lib scripts components hooks types` finds no other reference |
| Guards | `adminGate.writes.test.ts` gains the POST case (58 → 59). The admin-authz guard file is **not** edited (C-1) | `app/api/admin/__tests__/adminGate.writes.test.ts:130-305` |

**Not touched:** `audit_trail` DDL and policies, `AuditTrailRepository`, `AuditTrailService.log()` / `exportUserData` / `anonymizeUserData` (Slice 3), the two audit-trail admin routes (C-6, Slice 3), any cron, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, the shared UI primitives.

---

## 2. Implementation Approach

### 2.1 How a run works

```
POST /api/admin/archiving/runs
  requireAdmin (first statement, C-1)
  → Zod discriminated union, .strict()            400 invalid_body
  → ARCHIVE_RUNS_ENABLED?                          409 runs_not_enabled   (C-5; nothing read or written)
  → takeOverStaleRuns(now)                          running + no sign of life for 5 min → partial / 'interrupted' (TQ-1)
  → start:    createRun(source, retentionDays, cutoffFor(days, now), startedBy = admin)
                                                    409 run_in_progress on the partial unique index
              audit ARCHIVE_RUN_STARTED (non-blocking)
    continue: claimRunForContinue(runId, now)       409 run_not_continuable (0 rows) / 409 run_in_progress (index)
  → runArchive(): batches until 0 selected, or the 45 s budget runs out, or a batch fails
  → finishRun(succeeded | partial | failed)
  → audit ARCHIVE_RUN_COMPLETED / _FAILED on succeeded / failed only (C-9f); await flush
  → 200 { run, outcome }  |  500 archive_batch_failed (run recorded as failed, Continue offered)
```

- **The cutoff is computed once, on the server, at start** (`cutoffFor(days, now)`, the same function the overview uses) and stored on the run. Continue never receives a cutoff from the client; it reads the stored one from the claimed row (FR-3, AC-6). The move function also refuses any cutoff that differs from the run's (§4.3), so the property holds even if the TypeScript side regressed.
- **Signs of life.** `last_batch_at` is written by the move function after every batch **and by the Continue claim**. The claim must write it: otherwise a run that was `partial` for days would look stale to a second, concurrent Continue the instant it was claimed, and both requests could work on it. A start leaves it `NULL`, so staleness reads `COALESCE(last_batch_at, started_at)` (TQ-1).
- **Why a 5-minute takeover cannot hit a live request.** `maxDuration = 60` kills any request long before 5 minutes, so a run still `running` after 5 minutes of silence can only belong to a dead request. No lease, heartbeat job or claim token is needed (TQ-1). The takeover is one conditional `UPDATE`; with PostgREST the `COALESCE` is written as `.or('last_batch_at.lt.<t>,and(last_batch_at.is.null,started_at.lt.<t>)')` with `<t> = now − 5 min` computed on the server. Clock skew between Vercel and the database is seconds against a 5-minute margin.
- **A batch failure** marks the run `failed` with `error_code = 'batch_failed'`, writes `ARCHIVE_RUN_FAILED`, and answers **500** `archive_batch_failed` with the run id. The batch itself was rolled back in the database (FR-5), so Continue resumes safely (C-12).
- **If `finishRun` itself fails** after a good batch, the run stays `running`, becomes stale after 5 minutes, is flipped to `partial`, and Continue finishes it (the next batch selects 0 rows → `succeeded`). The system heals without a second recovery path.
- **Batch size** is 1,000 (TQ-3), carried as `batchSize` on the source registry entry and passed as the function argument. The function refuses anything outside 1..5,000.

### 2.2 Shared config and types (`lib/archiving/config.ts`, `types.ts`)

`config.ts` still imports nothing (client-safe). Additions:

```typescript
export const ARCHIVE_SOURCES = [
  { key: 'audit_trail', label: 'Audit trail', batchSize: 1000 },
] as const;

export const ARCHIVE_RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type ArchiveRunStatus = (typeof ARCHIVE_RUN_STATUSES)[number];

/** A running run with no sign of life for this long belongs to a dead request (TQ-1). */
export const STALE_RUN_AFTER_MS = 5 * 60_000;

/** Unchanged: still false. Slice 3 flips it (C-5). */
export const ARCHIVE_RUNS_ENABLED = false;
```

The database function name is **not** put here. It lives in the repository (server-only) as a typed `Record<ArchiveSourceKey, string>`, so a new registry entry without a function is a compile error and no database object name reaches the browser bundle (see Q-6).

`types.ts` gains `ArchiveRunSummary` (`id`, `source`, `status`, `retentionDays`, `cutoff`, `rowsArchived`, `batches`, `startedBy`, `startedByLabel`, `startedAt`, `lastBatchAt`, `finishedAt`, `errorCode`, `isStale`), and the overview gains `archivedTotal`, `latestCutoff` and `lastRun` per source and `runs` (newest 20) at the top level. The POST response type is `{ run: ArchiveRunSummary; outcome: 'succeeded' | 'partial' }`.

### 2.3 Validation (`lib/validation/archiving.ts`)

```typescript
export const archiveRunRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), source: archiveSourceKeySchema, retentionDays: retentionDaysSchema }).strict(),
  z.object({ action: z.literal('continue'), runId: z.string().uuid() }).strict(),
]);
```

`.strict()` is the field allow-list (§12): a body carrying `cutoff`, `startedBy`, `status` or `batchSize` is a 400, not silently ignored.

### 2.4 Repository (`lib/repositories/ArchiveRepository.ts`)

Header updated: it now **writes**, and still only from `requireAdmin`-gated routes. Naming (Q-7): methods that read or move rows **across accounts** (`archived_records`, `audit_trail`) keep the `…AllAccounts` suffix (C-7, Rule 4 met by name). Methods on `archive_runs` use plain names, because that table has no `user_id` at all: it is platform bookkeeping, not account data, so there is no account scope to omit.

| Method | Query | Slice |
|---|---|---|
| `countArchivedAllAccounts(source)` | `from('archived_records').select('id', { count: 'exact', head: true }).eq('source', source)`; a null count is an **error**, never `0` (Slice 1 rule) | 2a |
| `listRuns({ limit = 20 })` | explicit column list, `order('started_at', { ascending: false })`, `limit` | 2a |
| `getLatestCutoff(source)` | `select('cutoff').eq('source', source).eq('status', 'succeeded').order('cutoff', { ascending: false }).limit(1)`; `null` when none (TQ-5; ordering by **cutoff**, see Q-5) | 2a |
| `takeOverStaleRuns(now)` | `update({ status: 'partial', error_code: 'interrupted', finished_at: now })` where `status = 'running'` and the `.or(…)` staleness filter; returns ids flipped | 2b |
| `createRun({ source, retentionDays, cutoff, startedBy })` | insert with an explicit field list, `status: 'running'`; `23505` on `archive_runs_one_running_per_source` → `{ kind: 'conflict' }`, else `{ kind: 'created', run }` | 2b |
| `claimRunForContinue(runId, now)` | `update({ status: 'running', last_batch_at: now, finished_at: null, error_code: null }).eq('id', runId).in('status', ['partial', 'failed']).select(…)`; 0 rows → `not_continuable`; `23505` → `conflict` | 2b |
| `runBatchAllAccounts(source, runId, cutoff, batchSize)` | `rpc(BATCH_FUNCTIONS[source], { p_run_id, p_cutoff, p_batch_size })`; the reply is validated as exactly one row of three non-negative integers, otherwise an error | 2b |
| `finishRun(runId, { status, errorCode, now })` | `update(…).eq('id', runId).eq('status', 'running')`; 0 rows → error (logged; the run heals via takeover) | 2b |

All methods return `{ data, error }` or a discriminated result and never throw. No method selects `payload`: no archived content ever passes through the server (AC-14).

### 2.5 Runner (`lib/archiving/server/runArchive.ts`)

```typescript
export async function runArchive(deps: {
  repo: Pick<ArchiveRepository, 'runBatchAllAccounts' | 'finishRun'>;
  run: ArchiveRunRow;           // the created or claimed row: its cutoff is the only cutoff used
  batchSize: number;            // from the registry
  budgetMs: number;             // 45_000 from the route
  clock: () => number;          // injected for tests
  logger: Logger;
}): Promise<{ outcome: 'succeeded' | 'partial' | 'failed'; run: ArchiveRunRow }>;
```

It checks the budget **before** starting each batch, logs one structured line per batch (`runId`, `source`, `retentionDays`, `selected`, `inserted`, `deleted`, `elapsedMs`; never a payload), and returns after `finishRun`. It lives under `lib/archiving/server/` so the page's source guard can forbid that folder outright (§8.6).

### 2.6 Routes

- **`app/api/admin/archiving/runs/route.ts`** (new): `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`, `POST` only. Order exactly as §2.1. Body is read with `request.json().catch(() => null)` so a malformed body is a 400, not a 500. Errors to the client are short codes (`invalid_body`, `runs_not_enabled`, `run_in_progress`, `run_not_continuable`, `archive_batch_failed`, `Internal server error`); `details` only when `NODE_ENV === 'development'`.
- **Audit (C-16, C-9f).** `ARCHIVE_RUN_STARTED` after `createRun` succeeds (never on Continue); `ARCHIVE_RUN_COMPLETED` / `ARCHIVE_RUN_FAILED` on the terminal state; nothing for `partial`. `entityType: 'archive_run'`, `entityId: run.id`, `userId` and `actorId` = the admin (Q-8), `details: { source, retentionDays, cutoff, rowsArchived, batches, correlationId }`, severity `warning` (started, completed) and `critical` (failed). `.catch(…)` then `await auditTrail.flush()` before responding, the WC-7 precedent: a serverless instance can freeze the moment it responds.
- **`app/api/admin/archiving/route.ts`** (GET, extended in 2a): adds `archivedTotal`, `latestCutoff`, `lastRun` per source and `runs` (newest 20), each run with `isStale` derived from `STALE_RUN_AFTER_MS`. GET stays **read-only**: it never performs the takeover, it only reports staleness. `startedByLabel` is resolved from `AdminUserRepository.listActive()` (existing method, no new DB code) and falls back to a short id for a former admin (Q-9). Emails are never logged. Any failed read is still a 500 with no partial payload.

### 2.7 Page (`app/admin/archiving/page.tsx`)

- **2a (read-only display):** archived total (a measured number now, including a real `0`), "Archived before" = `latestCutoff` or "None yet", last run (status `Badge` with a text label, when, rows), and a run-history table: Started (UTC), By, Retention, Cutoff (UTC), Rows archived, Batches, Status, Finished, Error code. "No runs yet" when the list is empty (now true, so allowed). The Archive button stays disabled exactly as in Slice 1.
- **2b (actions):** the Archive button opens a Radix `Dialog` (C-15) showing the source, the retention chosen, the cutoff ("about <UTC>; the exact time is fixed when you confirm"), the rows that will move (the selected option's eligible count), "Archived records can't be viewed or restored from the product" (K-2), and for 180 or 90 days the K-1 sentence: **"Business owners will see only the last N days of their own activity history from now on."** Confirm posts `{ action: 'start', source, retentionDays }`. While `runsEnabled` is false, Confirm is disabled with "Not switched on yet" (Q-1). A `partial` or `failed` run, or a `running` run marked stale, gets a **Continue** button that posts `{ action: 'continue', runId }` (also disabled while runs are off). After any POST the overview is refetched. 409 and 500 codes map to plain sentences ("Another run is in progress", "This run can't be continued", "The batch failed; nothing was lost. Press Continue to retry").
- **Status badges** (not colour alone): Running, Stalled, Succeeded, Partial, Failed.

### 2.8 Registries and the removed method

- `descriptors.ts`: `archived_records` added next to `audit_trail` with the same level, scope and band, `snapshot: 'ids'` (C-4; the 250,000-row snapshot ceiling). `archive_runs` added to `EXCLUDED` via `never('archive_runs', G, …)`: global scope because it has no `user_id`. `classification-baseline.json` gains both rows and its count moves 124 → 126, deliberately, in the same diff. The new `archived_records.archive_run_id → archive_runs` edge is a NO ACTION FK whose parent is `never`, so it cannot constrain a purge.
- `businessOwnedTables.ts`: `archived_records: 'The person\'s own archived activity history. Like audit_trail, it follows the account, not the business.'` (C-14). ⚠️ The ownership scan reads each `CREATE TABLE` up to its first `);` and flags any mention of `user_id`, **including in a comment**. The `archive_runs` statement must therefore not contain the string `user_id` anywhere, or it will demand a classification it does not need.
- `AuditTrailService.ts`: `applyRetentionPolicy()` deleted, `retentionPolicy` removed from the constructor config, `RetentionPolicy` removed from the import. `lib/audit/types.ts`: the `RetentionPolicy` interface and the `retentionPolicy?` field deleted (C-13, FR-16). AC-17 is verified by grep in code review: after this, the only statement anywhere that deletes `audit_trail` rows by age is the move function.

---

## 3. Split Recommendation (2a / 2b)

**Recommendation: split, with the boundary moved slightly from §13.3's suggestion.**

| PR | Contains | Observable at the end (PROD) | PROD migration |
|---|---|---|---|
| **2a** `feature/admin-archiving-s2` | M1 + its source test; both registries + baseline (C-4, C-14); `applyRetentionPolicy` removal (C-13); repository **read** methods; GET extension; the page's read-only display of archived total, "archived before", last run and run history | Tables exist and are locked down (AC-11 live); the dry run has proven the function (AC-5, AC-6); the page shows archived total **0**, "None yet", "No runs yet" — read through the new grants by the real service role | **M1**, applied before 2a deploys |
| **2b** `feature/admin-archiving-s2b` | Audit catalogue (C-16); run schema; repository **run** methods; runner; `POST …/runs`; dialog + Continue; `adminGate.writes` case; admin handler count docs | The dialog opens with the right numbers and the K-1 sentence; Confirm is disabled; a hand-crafted POST gets 409 `runs_not_enabled` | None |

**Why split.** (1) M1 is the only part that is security-bearing, applied by hand and hard to change afterwards; a PR that is only M1 and its readers keeps SA's review on C-3 and the grants. (2) The FR-15 pre-check can reshape M1 (for example if live `audit_trail.id` is not a uuid, or orphan `user_id`s exist). Settling that before the route is written avoids rework. (3) 2a's deploy is itself the proof that the grants work for `service_role` through PostgREST, before any write path exists.

**Why the GET and display move into 2a** (a deviation from §13.3, Q-2): without them 2a would ship repository methods that nothing calls, and an M1 apply that nothing exercises. With them every 2a method has a caller and 2a has a visible result.

**Cost:** one extra review cycle. 2b is then pure TypeScript with no migration.

**C-14 and C-4 land in 2a with M1** either way. If SA prefers one PR, the same task order applies (2a tasks then 2b tasks) with a commit boundary between them, and §5 is unchanged.

---

## 4. Migration M1 (draft)

**File:** `supabase/migrations/20261010_admin_archiving_runs.sql` (the next free date prefix after `20261009`; re-checked against `main` at T-a2).

This is the draft SA reviews for shape. Dev finalises it at T-a2 after the pre-check output (§5 step 1) is in.

### 4.1 Header (summary of what the file's comment block carries)

- What it is, and that **nothing writes to these tables until Slice 3** flips `ARCHIVE_RUNS_ENABLED`.
- **Apply order:** pre-check → M1 → access check → dry run, all before 2a deploys (§5).
- **The single copy (R-5) of all runbook SQL:** the step 1 pre-check (moved in from `ADMIN_ARCHIVING_SLICE_2_PRECHECK.sql`, now deleted), the step 3 access check (§5.3), the step 4 dry run and "nothing kept" query (§5.4), and the guarded rollback (§5.5). No `scripts/*.sql` copies (Q-14).
- Why INVOKER, why separate statements (C-3, with the snapshot explanation), why `REVOKE ALL` and a stated `GRANT`, why `archive_runs` has no FK on `started_by` (RC-9 precedent), why no GIN index (F-3), why no `destination` column (C-9a), why no lz4 (C-9c).

### 4.2 Tables, indexes and privileges

```sql
BEGIN;

-- No migration-level lock_timeout (SA R-1): it existed only for the dropped
-- FK to auth.users. Every object below is new, so nothing else is locked.

-- The run log. Created first because archived_records references it.
-- Never archived and never purged: it holds counts, not content.
CREATE TABLE public.archive_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text        NOT NULL,
  retention_days integer     NOT NULL CHECK (retention_days IN (365, 180, 90)),
  cutoff         timestamptz NOT NULL,
  status         text        NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  rows_archived  bigint      NOT NULL DEFAULT 0 CHECK (rows_archived >= 0),
  batches        integer     NOT NULL DEFAULT 0 CHECK (batches >= 0),
  started_by     uuid        NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_batch_at  timestamptz NULL,
  finished_at    timestamptz NULL,
  error_code     text        NULL CHECK (error_code ~ '^[a-z_]{1,64}$')
);

-- One running run per source (FR-8, TQ-1). A second start hits this and gets 409.
CREATE UNIQUE INDEX archive_runs_one_running_per_source
  ON public.archive_runs (source) WHERE status = 'running';
CREATE INDEX archive_runs_started_at_idx ON public.archive_runs (started_at DESC);

-- One row per archived record. No GIN index: the space saving is the point (F-3).
CREATE TABLE public.archived_records (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text        NOT NULL,
  source_id           text        NOT NULL,
  -- Deliberately NO foreign key to auth.users (SA R-1, supersedes C-11): ON DELETE
  -- SET NULL would null this column while the payload keeps the personal data, so
  -- erasure and purge by user_id could no longer find the row.
  user_id             uuid        NULL,
  original_created_at timestamptz NOT NULL,
  payload             jsonb       NOT NULL,
  archived_at         timestamptz NOT NULL DEFAULT now(),
  archive_run_id      uuid        NOT NULL REFERENCES public.archive_runs(id),
  CONSTRAINT archived_records_source_row_unique UNIQUE (source, source_id)           -- FR-6
);
CREATE INDEX archived_records_source_created_idx
  ON public.archived_records (source, original_created_at);
CREATE INDEX archived_records_user_id_idx
  ON public.archived_records (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.archive_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archived_records ENABLE ROW LEVEL SECURITY;
-- No policies at all: nothing reads these with a user session.

REVOKE ALL ON TABLE public.archive_runs, public.archived_records
  FROM PUBLIC, anon, authenticated;

-- State the positive side, and take away what the Supabase defaults gave that
-- this module must not have (20261005 lesson: an omitted privilege is not a revoked one).
REVOKE UPDATE, TRUNCATE ON TABLE public.archived_records FROM service_role; -- archive rows are immutable
REVOKE DELETE, TRUNCATE ON TABLE public.archive_runs     FROM service_role; -- the run log is never deleted
GRANT SELECT, INSERT, DELETE ON TABLE public.archived_records TO service_role; -- DELETE: Slice 3 erasure + purge
GRANT SELECT, INSERT, UPDATE ON TABLE public.archive_runs     TO service_role;
```

Plain `CREATE TABLE` (no `IF NOT EXISTS`) on purpose: a taken name makes the apply fail and roll back as one transaction (which is why the pre-check no longer needs a names-free row, SA R-2), whereas a silent skip over a same-named table would hide exactly the drift F-2 warns about. A failed apply can simply be re-run once the cause is fixed.

The only foreign key is `archive_run_id → archive_runs` (internal; kept per SA R-1). `archived_records_user_id_idx` stays, because erasure and purge find rows by `user_id`.

### 4.3 The move function (C-3, D-1)

```sql
CREATE OR REPLACE FUNCTION public.archive_audit_trail_batch(
  p_run_id     uuid,
  p_cutoff     timestamptz,
  p_batch_size integer
)
RETURNS TABLE (selected_count integer, inserted_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_ids      uuid[];
  v_selected integer;
  v_inserted integer;
  v_deleted  integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'archive_audit_trail_batch: batch size % out of range', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- (1) Select and lock the batch, oldest first. No exclusions for this source (FR-9, BQ-5).
  SELECT array_agg(s.id) INTO v_ids
  FROM (
    SELECT a.id
    FROM public.audit_trail a
    WHERE a.created_at < p_cutoff
    ORDER BY a.created_at, a.id
    LIMIT p_batch_size
    FOR UPDATE
  ) s;
  v_selected := COALESCE(cardinality(v_ids), 0);

  -- (2) Copy. A SEPARATE statement from (3): sub-statements of one statement share
  -- one snapshot, so a data-modifying CTE could not see these rows in (3) (C-3).
  INSERT INTO public.archived_records
    (source, source_id, user_id, original_created_at, payload, archive_run_id)
  SELECT 'audit_trail', a.id::text, a.user_id, a.created_at, to_jsonb(a), p_run_id
  FROM public.audit_trail a
  WHERE a.id = ANY (v_ids)
  ON CONFLICT (source, source_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- (3) Delete ONLY rows that now exist in the archive (FR-5, FR-6).
  DELETE FROM public.audit_trail a
  WHERE a.id = ANY (v_ids)
    AND EXISTS (
      SELECT 1 FROM public.archived_records r
      WHERE r.source = 'audit_trail' AND r.source_id = a.id::text
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- The rows are locked, so every selected row is either newly copied or already
  -- archived. Anything else means a row was NOT archived and was kept: stop.
  IF v_deleted <> v_selected THEN
    RAISE EXCEPTION 'archive_audit_trail_batch: invariant broken (selected %, deleted %)',
      v_selected, v_deleted;
  END IF;

  -- (4) Bookkeeping, and the ONLY guard on run state: this run, this source, still
  -- running, with exactly this cutoff. Done last and in the same transaction, so the
  -- run's count can never disagree with the archive, and a takeover or a wrong
  -- cutoff rolls the whole batch back.
  UPDATE public.archive_runs r
     SET rows_archived = r.rows_archived + v_deleted,
         batches       = r.batches + CASE WHEN v_selected > 0 THEN 1 ELSE 0 END,
         last_batch_at = now()
   WHERE r.id = p_run_id
     AND r.source = 'audit_trail'
     AND r.status = 'running'
     AND r.cutoff = p_cutoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'archive_audit_trail_batch: run % is not running with this cutoff; % rows rolled back',
      p_run_id, v_deleted;
  END IF;

  RETURN QUERY SELECT v_selected, v_inserted, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_audit_trail_batch(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_audit_trail_batch(uuid, timestamptz, integer)
  TO service_role;

COMMIT;
```

Design notes for SA:

- **`FOR UPDATE`, blocking, with `lock_timeout = '5s'`** (Q-3). A concurrent `UPDATE` of an old row (only `anonymizeUserData`, which has no caller) would otherwise commit between the copy and the delete and be lost from the archived copy. `SKIP LOCKED` was rejected: if every remaining eligible row were locked, the batch would select 0 and the run would report "done" while rows remain. A lock wait over 5 s fails the batch; the run becomes `failed`, and Continue retries.
- **The run-state guard is the final `UPDATE`, not an up-front check** (Q-4). A takeover can change the status between an up-front check and the end, so the final `UPDATE` must carry the guard anyway; a second, earlier check would be a copy to keep in sync. A wrong run costs one rolled-back batch. This ordering is also what lets the dry run prove AC-5 *after* both writes (§5.4, D-1).
- **The invariant** is what makes the `EXISTS` guard observable: without `EXISTS`, a row that failed to copy would be deleted and `deleted = selected` would still hold. That path is covered by source pin M-2 and by the Dev mutation check "`EXISTS` removed" (§8.8), not by DDL on PROD (SA Q-12).
- **Returns three counts**, so "0 selected" (done) is distinguishable from "selected but nothing moved" (which the invariant turns into an error), and the logs can show `inserted < selected` (rows already archived by an earlier attempt).
- **INVOKER needs these privileges for `service_role`:** `SELECT, DELETE` on `audit_trail` (pre-check P09 confirms), `SELECT, INSERT` on `archived_records`, `SELECT, UPDATE` on `archive_runs`. All granted above.

---

## 5. Production Migration Runbook (user, by hand)

*Cut to four steps plus a conditional rollback by SA R-2 (2026-09-26). Single copy of the SQL (R-5): since T-a2 the **M1 migration header** (`supabase/migrations/20261010_admin_archiving_runs.sql`) is the only copy of every query below, each inside one block comment so it can be pasted exactly as written. The temporary `ADMIN_ARCHIVING_SLICE_2_PRECHECK.sql` has been deleted. This section keeps only the steps, what each proves, and when to stop.*

There is no branch database: every step runs in the **Supabase SQL editor on PROD**. The editor shows **only the result of the last statement**, so every step is a single statement, or a `DO` block that reports by raising an error on purpose.

> ⚠️ **Never flip `ARCHIVE_RUNS_ENABLED` on a local checkout.** Local dev points at the production database, so a local run would archive production rows.

| Step | When | What | Stop if |
|---|---|---|---|
| 1 | **Now**, before Dev writes M1 (read-only, safe any time) | Pre-check: one read-only `SELECT`, five rows, each `PASS` or `STOP` → send the output to Dev | Any `STOP`, or an error instead of five rows (see §5.1) |
| 2 | After SA code review of 2a, before 2a merges and deploys | Apply M1: one paste, one transaction | The apply errors. Nothing is left behind; send the error to Dev |
| 3 | Straight after step 2 | Access check (AC-11): one `SELECT`, one row of nine booleans (seven, plus two for `service_role` after CR-1) | Any value is `false` → run the rollback |
| 4 | Straight after step 3 | Dry run (one `DO` block), then the one-line "nothing kept" query | The error text does not start with `DRY RUN PASS`, or the query returns anything but `0, 0` → send both to Dev. Nothing was kept either way |
| — | Only if step 3 or 4 fails, **after reverting the 2a deploy** | Rollback | It refuses if `archived_records` has rows (impossible while runs are off) |

Send the output of steps 1, 3 and 4 back to Dev; Dev records it under Implementation Notes.

### 5.1 Step 1: pre-check (FR-15)

**Run on PROD 2026-09-26: all five rows PASS** (Implementation Notes). **Now in:** the M1 header, STEP 1 (strictly read-only: one `SELECT` over the system catalogues, no DDL, no DML, no `SET` / `SET ROLE`; runs as the editor's default role). Checked by Dev against a local Postgres 16 (PGlite) with a clean fake `audit_trail` (five `PASS`) and a deliberately broken one (five `STOP`).

| Row | STOP when | Why |
|---|---|---|
| P01 | `id` or `user_id` is not `uuid`, or `created_at` is not `timestamp with time zone NOT NULL` (or any of them is missing) | The function's types assume these |
| P02 | Any trigger on `audit_trail` fires on `DELETE` | A `BEFORE DELETE` trigger can silently cancel the move's delete |
| P03 | Any rule exists on `audit_trail` | An `ON DELETE DO INSTEAD` rule would do the same |
| P06 | Any foreign key in another table points at `audit_trail` | Deleting a referenced audit row would fail every batch |
| P09 | `service_role` lacks `SELECT` or `DELETE` on `audit_trail` | The function is `SECURITY INVOKER`, so it runs with `service_role`'s own rights |

Dropped by SA R-1 / R-2: P04, P05, P07 (orphan `user_id`s; moot with no FK to `auth.users`), P08 (a plain `CREATE TABLE` already fails on a taken name and the transaction rolls back), P10 to P12.

### 5.2 Step 2: apply M1

Paste the whole of `supabase/migrations/20261010_admin_archiving_runs.sql` into the SQL editor and run it once. It is one transaction: an error leaves nothing behind, and the file can be run again after the cause is fixed. Apply it **before** 2a's code deploys, because the extended GET reads the new tables. M1 is additive, so applying it early is safe.

### 5.3 Step 3: access check (AC-11)

One `SELECT` (in the M1 header) returning **one row of nine booleans, all of which must be `true`** (the last two were added for SA CR-1 / QA live check 3):

| # | Expression |
|---|---|
| 1–4 | `NOT has_table_privilege(<role>, <table>, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')` for `anon` and `authenticated` × `archived_records` and `archive_runs` |
| 5–6 | `NOT has_function_privilege(<role>, 'public.archive_audit_trail_batch(uuid, timestamptz, integer)', 'EXECUTE')` for `anon` and `authenticated` |
| 7 | `NOT prosecdef` for the function (it is `SECURITY INVOKER`) |
| 8–9 | `NOT has_table_privilege('service_role', <table>, 'REFERENCES, TRIGGER')` for both tables: proves the CR-1 `REVOKE ALL` landed in what was pasted |

`has_*_privilege` already counts `PUBLIC` grants, so a function left executable by `PUBLIC` shows `false` in 5 and 6. The service-role positive side is proven by the dry run (which runs as `service_role`) and by the page loading after deploy (M-a4). The 10-row catalogue report and the live `SET ROLE` probe of the first draft are dropped (R-2).

### 5.4 Step 4: dry run on real rows (AC-5, AC-6, AC-4 per C-10)

One self-rolling-back `DO` block (Q-11), in the M1 header. It picks a cutoff that makes the 10 oldest real rows eligible (more if several share a timestamp), does `SET LOCAL ROLE service_role` so the grants are exercised, runs three checks, and **always ends by raising its report as an error**, which rolls the whole block back. No DDL: no temporary function or trigger is created on PROD (Q-12).

| Check | What it proves |
|---|---|
| **D-1** (AC-5) | A batch against a run whose status is not `running` raises at the final guard, **after** its copy and delete have run, and both tables are unchanged afterwards |
| **D-2** (AC-4 per C-10, was D-4 + D-6) | Draining a running run leaves 0 rows before the cutoff; archived rows for the run = eligible rows before; `rows_archived` agrees; every archived `payload` equals `to_jsonb` of the live row it came from |
| **D-3** (AC-6, was D-7) | One more call returns `0 / 0 / 0` and changes nothing; no `source_id` is archived twice |

Expected: an error whose text starts `DRY RUN PASS:` and lists D-1 to D-3. Then the "nothing kept" query must return `0, 0`:

```sql
SELECT (SELECT count(*) FROM public.archive_runs)     AS runs_kept,
       (SELECT count(*) FROM public.archived_records) AS archived_kept;
```

The block holds row locks on a few dozen of the **oldest** audit rows for about a second; new audit entries are inserts of new rows and are not blocked. If the editor refuses `SET LOCAL ROLE service_role`, remove that line and run it as the editor's role; the logic checks still hold, and 2a's deploy then proves the service-role grants through the real app (M-a4).

### 5.5 Rollback (only if step 3 or 4 fails)

Revert the 2a deploy first (the extended GET reads these tables). Then run the guarded rollback from the M1 header: a `DO` block that refuses if `archived_records` holds any row (they would be the only copy), and otherwise drops the function and both tables. While `ARCHIVE_RUNS_ENABLED` is false no row can have been archived, so the refusal cannot trigger in Slice 2.

---

## 6. Files to Create / Modify

| File | Action | PR | Reason |
|------|--------|----|--------|
| `supabase/migrations/20261010_admin_archiving_runs.sql` | create | 2a | M1 (§4) |
| `supabase/migrations/__tests__/admin-archiving.migration.test.ts` | create | 2a | Source-level pins on M1 (§8.1), after the entitlements precedent |
| `lib/business-os/purge/descriptors.ts` | modify | 2a | C-4 |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | 2a | +2 rows, count 124 → 126, deliberate |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify | 2a | `descriptorsForRun` assertion (C-4, AC-12) |
| `lib/business-os/businessOwnedTables.ts` | modify | 2a | C-14 |
| `lib/services/AuditTrailService.ts` | modify | 2a | Remove `applyRetentionPolicy` and its config (C-13) |
| `lib/audit/types.ts` | modify | 2a, 2b | 2a: remove `RetentionPolicy` / `retentionPolicy?`. 2b: `archive_run` in `AUDIT_ENTITY_TYPES` |
| `lib/archiving/config.ts` | modify | 2a | `batchSize`, `ARCHIVE_RUN_STATUSES`, `STALE_RUN_AFTER_MS` |
| `lib/archiving/types.ts` | modify | 2a, 2b | Run summary, overview fields, POST response |
| `lib/repositories/ArchiveRepository.ts` | modify | 2a, 2b | Read methods (2a), run methods (2b), header |
| `lib/repositories/__tests__/ArchiveRepository.test.ts` | modify | 2a, 2b | New methods; U-R10 method-count pin 3 → 6 (2a) → 11 (2b), deliberately |
| `app/api/admin/archiving/route.ts` | modify | 2a | GET extension |
| `app/api/admin/archiving/__tests__/route.test.ts` | modify | 2a | I-4 key-set pin changes deliberately; new cases |
| `app/admin/archiving/page.tsx` | modify | 2a, 2b | Display (2a); dialog, Continue (2b) |
| `app/admin/archiving/__tests__/page.render.test.tsx` | modify | 2a, 2b | P-5 "Not available yet" pins replaced; dialog cases |
| `app/admin/archiving/__tests__/source.guard.test.ts` | modify | 2b | Allow `@/components/ui/dialog` and POST to `/api/admin/archiving/runs` only; forbid `@/lib/archiving/server` |
| `lib/archiving/__tests__/config.test.ts` | modify | 2a | Registry shape, statuses, stale constant; `ARCHIVE_RUNS_ENABLED === false` stays |
| `lib/validation/archiving.ts` + `__tests__/archiving.test.ts` | modify | 2b | `archiveRunRequestSchema` |
| `lib/audit/events.ts` | modify | 2b | 3 events + `EVENT_METADATA` (C-16) |
| `lib/audit/__tests__/archivingEvents.test.ts` | create | 2b | Events registered, metadata severities valid, server-only (not in the client allow-lists), filter options include them |
| `lib/archiving/server/runArchive.ts` + `__tests__/runArchive.test.ts` | create | 2b | Runner (§2.5) |
| `app/api/admin/archiving/runs/route.ts` + `__tests__/route.test.ts` | create | 2b | POST (§2.6) |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | 2b | One case; `toHaveLength(58)` → `59` with its comment |
| `docs/REPOSITORY_STRATEGY.md` | modify | 2a, 2b | §14 |
| `docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md` | modify | 2a | §14 |
| `docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md` | modify | 2a | One line under C-11 in §13.2: superseded by the Slice 2 SA review (SA R-1) |
| ~~`docs/workplans/ADMIN_ARCHIVING_SLICE_2_PRECHECK.sql`~~ | added, then **deleted** | 2a | The step 1 pre-check the user ran on 2026-09-26. Its query now lives only in the M1 header (R-5: one copy); the file never reaches a commit |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | 2b | §14 |
| `CLAUDE.md` | **flagged, not edited** | 2b | §14: user approval at diff review |
| `docs/workplans/ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md` | add | 2a | This workplan |

**Explicitly not modified:** `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (C-1: `git diff main -- <file>` empty), `components/ui/*`, `supabase/SQL Scripts/create_audit_trail.sql`, the two audit-trail admin routes, `AuditTrailRepository.ts`.

---

## 7. Task List

### Slice 2a (M1, registries, read side)

- [x] ✅ **T-a0** Confirm branch `feature/admin-archiving-s2`; rebase onto `origin/main` (`9d3b2a8b`, no conflicts expected: identical tree). If on any other branch, stop and escalate to TL. *(Done 2026-09-26: `git fetch origin && git rebase origin/main` was clean; `git log -1` = `9d3b2a8b` "Merge pull request #114". `.claude/settings.local.json` was set aside and restored byte for byte (same SHA-1); no `git stash` used.)*
- [x] ✅ **T-a1** *(user)* Run the pre-check (§5.1) and send the five rows. *(Done 2026-09-26 on PROD: **5/5 PASS**, recorded in Implementation Notes. No STOP condition.)*
- [x] ✅ **T-a2** Write M1 (§4), adjusted to the pre-check. Re-check the date prefix against `main`. Put the single copy of the runbook SQL in its header (pre-check, access check, dry run D-1 to D-3 + "nothing kept" query, guarded rollback) and delete `ADMIN_ARCHIVING_SLICE_2_PRECHECK.sql` in the same commit (R-5). No FK to `auth.users`, no migration-level `lock_timeout` (R-1).
- [x] ✅ **T-a2b** Add the one-line C-11 supersession note to requirement §13.2 (R-1).
- [x] ✅ **T-a3** `admin-archiving.migration.test.ts` (§8.1, pins M-1 to M-8, M-10, M-11); green.
- [x] ✅ **T-a4** Purge descriptors + baseline + `descriptorsForRun` assertion; `descriptors.invariant.test.ts` green.
- [x] ✅ **T-a5** `USER_OWNED_TABLES` entry; `businessOwnedTables.test.ts` green (and prove it would be red without the entry by running it once with the line removed).
- [x] ✅ **T-a6** Remove `applyRetentionPolicy`, its config and type. Grep `app lib scripts components hooks types` for `applyRetentionPolicy|RetentionPolicy|retentionPolicy`: expect 0. Grep for `.from('audit_trail')` with `.delete(`: expect 0 (AC-17).
- [x] ✅ **T-a7** `config.ts` / `types.ts` additions; config tests.
- [x] ✅ **T-a8** Repository read methods + tests.
- [x] ✅ **T-a9** GET extension + route tests.
- [x] ✅ **T-a10** Page read-only display + render tests.
- [x] ✅ **T-a11** Docs: REPOSITORY_STRATEGY (read methods), purge requirement (§14).
- [x] ✅ **T-a12** Checks: `npm test -- lib/archiving lib/validation/__tests__/archiving lib/repositories app/api/admin app/admin lib/admin lib/business-os/purge lib/business-os/__tests__/businessOwnedTables supabase/migrations/__tests__ lib/audit lib/services`; `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` checking the **exit code**, not a grep count (schema-check skill Rule 7), no new errors in touched files; ESLint on touched files: 0 findings; `npm run lint:hooks`; `npx next build` with the CI placeholder env.
- [x] ✅ **T-a13** Self-review against §11; the two M1 mutation checks of §8.8; `console.` in touched files: 0; status → Code Complete; notify TL for SA code review.
- [ ] **T-a14** *(user, after SA code review, before merge)* §5 steps 2 to 4 (apply, access check, dry run). Dev records the outputs. QA runs M-a1 and M-a3 to M-a6.

*T-a2 to T-a13 done 2026-09-26; results and deviations in [Implementation Notes](#implementation-notes).*

### Slice 2b (runs, POST, dialog, audit)

- [ ] **T-b0** RM cuts `feature/admin-archiving-s2b` from `main` after 2a merges; Dev confirms the branch.
- [ ] **T-b1** Audit catalogue: 3 events, metadata, `archive_run`; `archivingEvents.test.ts`; existing `lib/audit/__tests__` green.
- [ ] **T-b2** `archiveRunRequestSchema` + tests.
- [ ] **T-b3** Repository run methods + tests (including the insert-payload column pin, §8.2).
- [ ] **T-b4** Runner + tests.
- [ ] **T-b5** POST route + tests. Authz guard green with **no** edit (C-1).
- [ ] **T-b6** `adminGate.writes.test.ts` case, 58 → 59.
- [ ] **T-b7** Page dialog + Continue + tests; source guard updated.
- [ ] **T-b8** Docs: REPOSITORY_STRATEGY (run methods), ADMIN_IDENTIFICATION_AND_ACCESS counts; flag the CLAUDE.md line to the user.
- [ ] **T-b9** Checks as T-a12; the four Dev mutation spot-checks in §8.8 (the M1 ones, `EXISTS` and `status = 'running'`, are run in 2a at T-a13).
- [ ] **T-b10** Self-review; status → Code Complete; notify TL.

---

## 8. Test Plan

All Jest unless stated. Jest cannot run PL/pgSQL, so the function's behaviour is proven by the dry run (§5.4) and its shape by source tests (§8.1). No test touches a live database.

### 8.1 `supabase/migrations/__tests__/admin-archiving.migration.test.ts` (2a, source-level)

Comment-stripped SQL, same helper style as `business-os-entitlements.migration.test.ts`.

| # | Pin |
|---|---|
| M-1 | Function is `LANGUAGE plpgsql`, `SECURITY INVOKER`, `SET search_path = ''`; the file contains no `SECURITY DEFINER` |
| M-2 | C-3 shape: inside the function body, the select (`FOR UPDATE`), the `INSERT … ON CONFLICT (source, source_id) DO NOTHING` and the `DELETE … AND EXISTS (… archived_records …)` are **three separate statements, in that order**; no `WITH` clause contains `INSERT` or `DELETE` (no data-modifying CTE) |
| M-3 | The final `UPDATE public.archive_runs` carries `status = 'running'` and `cutoff = p_cutoff` and is followed by `IF NOT FOUND THEN RAISE`; the invariant `v_deleted <> v_selected` raises |
| M-4 | `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE … TO service_role`, and no other `GRANT … ON FUNCTION` |
| M-5 | Both tables: `ENABLE ROW LEVEL SECURITY`; the file has no `CREATE POLICY`; `REVOKE ALL … FROM PUBLIC, anon, authenticated` (an `ALL`, never an enumeration); the stated `service_role` grants and revokes of §4.2 |
| M-6 | `CHECK (retention_days IN (365, 180, 90))` matches `RETENTION_DAYS_OPTIONS` (parsed from the SQL and compared to the constant, so the two cannot drift) |
| M-7 | The status `CHECK` lists exactly `ARCHIVE_RUN_STATUSES` |
| M-8 | Partial unique index on `archive_runs (source) WHERE status = 'running'` |
| ~~M-9~~ | *Dropped (SA R-4)* |
| M-10 | `UNIQUE (source, source_id)`, and `archived_records` has **no** `REFERENCES auth.users` (amended by SA R-1; C-11 superseded) |
| M-11 | The `archive_runs` `CREATE TABLE` statement, up to its first `);`, does not contain `user_id` (keeps the ownership scan honest, §2.8) |
| ~~M-12~~ | *Dropped (SA R-4)* |
| ~~M-13~~ | *Dropped (SA R-4)* |

### 8.2 Repository (`ArchiveRepository.test.ts`, fake PostgREST builder)

| # | Method | Case |
|---|---|---|
| R-1 | `countArchivedAllAccounts` | `archived_records`, `head: true`, `.eq('source', …)`; count returned; `count: null` → error, not `0`; supabase error → error, no throw |
| R-2 | `listRuns` | explicit columns (never `*`, never `payload`), ordered `started_at` desc, limit 20 default; error path |
| R-3 | `getLatestCutoff` | filters `status = 'succeeded'` and `source`, orders by `cutoff` desc, limit 1; none → `null`; error path |
| R-4 | `takeOverStaleRuns` | updates only `status = 'running'` rows with the `.or(…)` staleness filter at `now − 300,000 ms`; sets `partial`, `interrupted`, `finished_at` |
| R-5 | `createRun` | insert payload is exactly `{ source, retention_days, cutoff, status: 'running', started_by }`; `23505` naming the partial index → `conflict`; another error → error |
| R-6 | `createRun` | **column pin:** the insert keys are a subset of the `archive_runs` columns parsed from M1 (closes the schema-check blind spot for `.insert()` payloads) |
| R-7 | `claimRunForContinue` | `.in('status', ['partial', 'failed'])`, sets `running`, `last_batch_at = now`, clears `finished_at` / `error_code`; 0 rows → `not_continuable`; `23505` → `conflict` |
| R-8 | `runBatchAllAccounts` | `rpc('archive_audit_trail_batch', { p_run_id, p_cutoff: ISO, p_batch_size })`; a reply that is not exactly one row of three non-negative integers → error; supabase error → error |
| R-9 | `finishRun` | `.eq('status', 'running')`; 0 rows → error |
| R-10 | all | No method selects `payload`; read methods issue no write call; method count pinned (6 in 2a, 11 in 2b) |

### 8.3 Runner (`runArchive.test.ts`, fake repo and clock)

| # | Case |
|---|---|
| X-1 | Batches until `selected = 0`, then `finishRun('succeeded')`; outcome `succeeded` |
| X-2 | The clock passes 45 s before the next batch → `finishRun('partial')`; no batch starts after the budget |
| X-3 | A batch error → `finishRun('failed', 'batch_failed')`; outcome `failed`; no further batch |
| X-4 | Every batch receives the run's stored cutoff and the registry's `batchSize` |
| X-5 | One log line per batch with counts and `elapsedMs`, and no payload or email in any logged argument |
| X-6 | `finishRun` failing is logged and reported, not thrown |

### 8.4 `POST /api/admin/archiving/runs` (integration; mocks as in the Slice 1 route test)

| # | Case | Expect |
|---|---|---|
| P-1 | Signed out | **401**, repository not called |
| P-2 | Non-admin | **403**, repository not called |
| P-3 | Admin check throws | **403**, repository not called |
| P-4 | Bodies: `retentionDays` 30, 366, 0, -90, `"365"`, missing; unknown `source`; `action` missing or unknown; `runId` not a uuid; malformed JSON; extra keys `cutoff`, `startedBy`, `status`, `batchSize` | **400** `invalid_body`, repository not called (AC-3 route half) |
| P-5 | Valid body, `ARCHIVE_RUNS_ENABLED = false` (the real constant) | **409** `runs_not_enabled`, repository **not called**; an invalid body with runs off is still 400 (Zod first, C-5) |
| *(constant mocked to `true` for P-6 to P-14)* | | |
| P-6 | Start, batches run to 0 | **200**, `outcome: 'succeeded'`; `createRun` got the server cutoff for the chosen days and `startedBy = admin id`; `STARTED` then `COMPLETED` audited; flush awaited |
| P-7 | Start, budget runs out | **200**, `outcome: 'partial'`; `STARTED` only, **no** second event (C-9f) |
| P-8 | Start, `createRun` → conflict | **409** `run_in_progress`; no audit event |
| P-9 | Continue, claim → `not_continuable` | **409** `run_not_continuable` |
| P-10 | Continue, claim → `conflict` | **409** `run_in_progress` |
| P-11 | Continue from `failed` | **200**; batches use the **stored** cutoff; **no** `STARTED` event |
| P-12 | Batch fails | **500** `archive_batch_failed` with the run id; run finished `failed`; `FAILED` audited |
| P-13 | Repository throws / unexpected error | **500** `Internal server error`; `details` only in development |
| P-14 | Takeover runs before start and before continue, and never before auth or Zod |
| P-15 | Source rules: `POST`'s first statement is `await requireAdmin(`; `maxDuration = 60`; no `AdminAccessService`, `profiles`, `app_metadata`, `supabase`, `console.` in the file; `POST` is the only export verb |

### 8.5 `GET /api/admin/archiving` (2a additions to the Slice 1 test)

- Payload carries `archivedTotal`, `latestCutoff`, `lastRun` per source and `runs` at the top level (the Slice 1 key-set pin `['generatedAt', 'runsEnabled', 'sources']` changes deliberately).
- A null archived count with no error → 500 (Slice 1's CR-3 rule extended).
- `isStale` true only for `running` runs silent for over 5 minutes (fake timers).
- `startedByLabel` is the admin's email when active and a short id otherwise. (No separate "logs never contain `@`" test: dropped by SA R-6; the route logs no emails by construction.)
- GET makes no write call (no takeover).

### 8.6 Page (jsdom)

| # | Case | PR |
|---|---|---|
| G-1 | Archived total shows a measured `0`; "Archived before" shows "None yet"; history shows "No runs yet"; "Not available yet" no longer appears | 2a |
| G-2 | With runs in the payload: one row each, newest first, status badges carry text | 2a |
| G-3 | The Archive button opens the dialog; it shows the source, the selected retention, the cutoff and the eligible count for that retention | 2b |
| G-4 | **AC-8:** choosing 180 or 90 shows the K-1 sentence with that number; 365 does not show it | 2b |
| G-5 | `runsEnabled: false` → Confirm disabled with "Not switched on yet"; no POST possible | 2b |
| G-6 | `runsEnabled: true` → Confirm posts exactly `{ action: 'start', source: 'audit_trail', retentionDays }`, then refetches | 2b |
| G-7 | Continue appears for `partial`, `failed` and stale `running`, not for `succeeded` or live `running`; posts `{ action: 'continue', runId }` | 2b |
| G-8 | 409 and 500 codes map to the plain sentences; no raw error text | 2b |
| G-9 | Dialog is keyboard-operable: opens on Enter, closes on Escape, focus returns to the button | 2b |

**Source guard** (2b update): the page may import only `react`, `lucide-react`, `@/components/ui/*`, `@/lib/archiving/config` and `@/lib/archiving/types` (so **not** `@/lib/archiving/server/*`); the only `fetch` targets are `GET /api/admin/archiving` and `POST /api/admin/archiving/runs`; no `console.`.

### 8.7 Registries and catalogue

- `descriptorsForRun('reset' | 'purge', { activityHistory: true, … })` includes `archived_records` with `snapshot: 'ids'`; with `activityHistory: false` it does not; `archive_runs` is never returned for any option combination (AC-12 behaviour, C-4).
- SA-S3 baseline test passes with the two new rows.
- `businessOwnedTables.test.ts` "classifies every table that carries a user_id" passes.
- `archivingEvents.test.ts`: the 3 events are in `AUDIT_EVENTS` with `EVENT_METADATA`; `archive_run` is in `AUDIT_ENTITY_TYPES`; neither is in `CLIENT_WRITABLE_EVENTS` / `CLIENT_WRITABLE_ENTITY_TYPES`; `buildActionFilterGroups()` offers the 3 events (AC-9's "selectable in the filters", C-16).

### 8.8 Mutation spot-checks (Dev only; QA does not repeat them, SA R-3)

Four, each of which must turn at least one test red, then be reverted and hash-checked:

| # | Mutation | Must fail | PR |
|---|---|---|---|
| MU-1 | `EXISTS` clause removed from the M1 `DELETE` | M-2 | 2a |
| MU-2 | `status = 'running'` removed from the final `UPDATE` | M-3 | 2a |
| MU-3 | `requireAdmin` moved below `request.json()` | P-15 | 2b |
| MU-4 | The `ARCHIVE_RUNS_ENABLED` check removed | P-5 | 2b |

### 8.9 SQL-level proof

The dry run (§5.4) is the executable proof for AC-5 (D-1), AC-4 as reworded by C-10 (D-2), AC-6 (D-3), and the service-role grants (it runs as `service_role`). The retention CHECK and the one-running-run index are Postgres guarantees pinned by M-6 and M-8 (SA R-2). QA records the dry run's output in the QA report.

### 8.10 Existing suites that must stay green

`lib/admin/__tests__/admin-authz-surface.guard.test.ts` (unchanged file), `app/api/admin/__tests__/*`, `lib/business-os/purge/__tests__/*` (including `no-deletion-paths.guard.test.ts`, C-34), `lib/business-os/__tests__/businessOwnedTables.test.ts`, `lib/audit/__tests__/*`, `app/admin/audit-trail/__tests__/*`, `app/admin/components/__tests__/AdminSidebar.nav.test.ts`, `lib/repositories/__tests__/*`.

---

## 9. Manual QA Check

E2E is not set up; QA records these in the QA report. **Nothing here starts a real run** (runs stay off until Slice 3).

### 2a

| # | Step | Expected |
|---|---|---|
| M-a1 | §5 step 3 output (access check) | One row, nine values, all `true` |
| ~~M-a2~~ | *Dropped with the live `SET ROLE` probe (SA R-2)* | — |
| M-a3 | §5 step 4 output, then the "nothing kept" query | `DRY RUN PASS: …` with D-1 to D-3; then `0`, `0` |
| M-a4 | After 2a deploys, open `/admin/archiving` as an admin | Archived total **0**, "Archived before: None yet", "No runs yet"; no console errors. This is the service role reading the new tables through PostgREST, so it proves the grants in the real app |
| M-a5 | `npm run schema:check` against PROD after the apply | The new selects on `archive_runs` / `archived_records` pass (schema-check skill Rule 1) |
| M-a6 | Grep: `applyRetentionPolicy` in `app lib scripts components hooks types` | No match (AC-17) |

### 2b

| # | Step | Expected |
|---|---|---|
| M-b1 | Open the dialog at 365, 180 and 90, keyboard only | Retention, cutoff and row count match the card; K-1 sentence only at 180 and 90; Escape closes |
| M-b2 | Confirm button | Disabled, "Not switched on yet" |
| M-b3 | In DevTools, `fetch('/api/admin/archiving/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', source: 'audit_trail', retentionDays: 365 }) })` | **409** `runs_not_enabled` |
| M-b4 | Same with `retentionDays: 30` | **400** `invalid_body` |
| M-b5 | Same request signed out / as a non-admin | **401** / **403** |
| M-b6 | `SELECT count(*) FROM public.archive_runs;` | `0`: nothing was started |
| M-b7 | `/admin/audit-trail` action filter | Lists the three archive events (none exist yet, but they are selectable) |

---

## 10. Acceptance Criteria This Slice Closes

Per requirement §13.3 Slice 2 "Closes".

| AC | Closed here | Proof | PR |
|---|---|---|---|
| **AC-3** | ✅ Route half (schema half was Slice 1) | P-4, M-b4 | 2b |
| **AC-5** | ✅ Strict, per D-1 | Dry run D-1; M-3 | 2a |
| **AC-7** | ✅ | P-8, P-10; partial unique index pinned by M-8 | 2a (DB), 2b (route) |
| **AC-8** | ✅ | G-4, M-b1 | 2b |
| **AC-10** | ✅ For POST (GET was Slice 1); caps unchanged | P-1 to P-3, P-15, `adminGate.writes` case, guard file unchanged, M-b5 | 2b |
| **AC-11** | ✅ Live | §5 step 3, M-a1 | 2a |
| **AC-12** | ✅ Classification + `descriptorsForRun` assertion (live purge impossible while the RPC is held) | §8.7 | 2a |
| **AC-17** | ✅ | T-a6 grep, M-a6; C-34 guard green | 2a |
| **AC-1** | ◐ Every field now real (archived total, last run); live confirmation with a real run is Slice 3 | G-1, G-2, M-a4 | 2a |
| **AC-4** | ◐ Proven in the dry run (C-10 form) and the runner tests; live in Slice 3 | D-2, X-1 | 2a, 2b |
| **AC-6** | ◐ Proven in the dry run and route tests; live in Slice 3 | D-3, P-11 | 2a, 2b |
| **AC-9** | ◐ Events registered and selectable; written only when a run happens (Slice 3) | §8.7, P-6, P-7, P-12, M-b7 | 2b |
| **AC-18** | ◐ For files touched in this slice | §15, P-15, source guard | 2a, 2b |

Not closed in Slice 2: AC-13 and AC-16 (Slice 3).

---

## 11. Conditions Traceability

| Condition | How Slice 2 meets it |
|---|---|
| **C-1** Caps untouched; `requireAdmin` first | P-15 pins the position; guard file not in the diff |
| **C-3** PL/pgSQL, separate statements, INVOKER, empty search_path, REVOKE/GRANT | §4.3; M-1 to M-4; mutation checks MU-1, MU-2 |
| **C-4** Purge classification in the M1 PR, `snapshot: 'ids'`, `archive_runs` never, `descriptorsForRun` assertion | §2.8, T-a4, §8.7 |
| **C-5** Runs off; 409 after auth and Zod; button disabled | §2.1, P-5, G-5; constant unchanged |
| **C-7** All access via `ArchiveRepository`; all-accounts reads named so | §2.4 (Q-7 on run-table naming) |
| **C-9** (a) no `destination`, (b) no exclusions field, (c) no lz4, (e) two route files, (f) no event on `partial` | §4.2 by construction (M-9 dropped, SA R-4), config test, §2.6, P-7 |
| **C-10** AC-4 measured over `created_at < cutoff` | Dry run D-2 |
| ~~**C-11**~~ `user_id` FK `ON DELETE SET NULL` | **Superseded by SA R-1:** no FK, so erasure by `user_id` still finds archived rows after account deletion. Pinned by M-10 (amended); requirement note at T-a2b |
| **C-12** Continue from `partial` and `failed`; a new Start after `failed` takes a new cutoff | §2.1, P-11, R-7 |
| **C-13** `applyRetentionPolicy` removed with its config and type | T-a6 |
| **C-14** `archived_records` in `USER_OWNED_TABLES` in the M1 PR | T-a5 |
| **C-15** Radix `dialog` / `select` / `badge`; no browser `confirm()` | §2.7, source guard |
| **C-16** Events and entity type in the existing catalogue; filters derive them | T-b1, §8.7 |
| **D-1** Database function, strict atomic batches | §4.3, dry run |
| **TQ-1** Partial unique index, `last_batch_at`, 45 s in 60 s, 5-min takeover to `partial` | §2.1, §4.2, R-4, X-2 |
| **TQ-3** INVOKER, 1,000-row batches | §4.3, config |
| **TQ-5** `getLatestCutoff` built here | §2.4 (Q-5) |

---

## 12. Tenant Isolation Review

Applied with the `tenant-isolation-guard` skill. The route runs as the **service role** and acts on a **caller-supplied run id**, so the skill applies.

| Skill step | Finding |
|---|---|
| 1. Applies? | Yes: service role, and `runId` comes from the body. But `archive_runs` holds no tenant data and has no `user_id`: it is platform bookkeeping, and the caller must be a platform admin. The run's effect (the batch) is **cross-account by design**, bounded by the run's **stored** cutoff |
| 2. Ownership pre-check | There is no owner to check a run against. The equivalent is: the run id is only ever used through `claimRunForContinue`, whose `WHERE id = $1 AND status IN ('partial','failed')` either returns the stored row or 0 rows (409). Nothing is written for a run that was not claimed, and the function re-checks run, source, status and cutoff in the same transaction as the move |
| 3. Field allow-list | `.strict()` Zod schemas. `createRun` builds its insert field by field: `source` (registry enum), `retention_days` (enum), `cutoff` (server-computed), `status` (`'running'`), `started_by` (`gate.user.id`). Nothing from the body is spread. P-4 injects `cutoff`, `startedBy`, `status`, `batchSize` and expects 400 |
| 4. Scope-defeating three | **Triggers:** none on the new tables; `audit_trail`'s live triggers are unknown until P02, and a DELETE-affecting one is a stop condition. **Upsert:** none; `ON CONFLICT DO NOTHING` inside the function on fixed columns, with values taken from the row, not the caller. **Payload injection:** closed by `.strict()` and the field-by-field insert |
| 5. Global catalogue | n/a |
| 6. Runner scoping | The runner deliberately does **not** scope to one account (the requirement is cross-account maintenance). What bounds it is the stored cutoff, checked inside the function's final guard (M-3) |
| 7. Tests | P-4 (injection), P-9 (unclaimable id → 409, no batch), P-11 (stored cutoff used), M-3 (cutoff in the guard) |

---

## 13. Schema Claims and How They Are Verified

Applied with the `business-os-schema-check` skill. Measured on `feature/admin-archiving-s2` at `1556112e`.

| Claim this plan relies on | Source | Verified live by |
|---|---|---|
| `audit_trail.id` is `uuid`, `created_at` is `timestamptz NOT NULL`, `user_id` is `uuid` | Repo script `supabase/SQL Scripts/create_audit_trail.sql` (**drifted**, F-2) | Pre-check P01 (stop if different) |
| No DELETE-blocking trigger or rule on `audit_trail` | SA §13.1 (repo only) | P02, P03 |
| `service_role` can `SELECT` and `DELETE` `audit_trail` | Same script (`GRANT ALL … TO service_role`) | P09 |
| Nothing references `audit_trail(id)` | Not asserted anywhere | P06 |
| The new tables' columns match what the repository reads and writes | M1 (new) | M-a5 `npm run schema:check` for selects; R-6 pins the insert payload to M1's column list (the skill lists `.insert()` payloads as a blind spot of the script) |

The pre-check always returns **exactly five rows** (P01, P02, P03, P06, P09), each an aggregate with its own PASS/STOP, so "no trigger" is a PASS row saying `no triggers`, never a missing row. Fewer than five rows, or an error, means the query did not run as intended, not that everything is fine (skill Rule 7). The `audit_trail.user_id → auth.users` link is no longer a claim this plan relies on: `archived_records` has no FK to `auth.users` (SA R-1), so orphan ids cannot fail a batch.

---

## 14. Documentation This Slice Owes

| Doc | Change | PR |
|---|---|---|
| [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) § ArchiveRepository | Replace "Planned (slice 2)" with the read methods (2a) and the run methods (2b); state that it now writes, only from `requireAdmin` routes; `archive_runs` has no `user_id`; the batch goes through `archive_audit_trail_batch` | 2a, 2b |
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) | Counts **81 → 82 handlers, 52 → 53 route files, 75 → 76 via `requireAdmin`, 6 inline, 0 open**, at every place they appear (lines 43, 55, 65, 84, 91, 478 as of `1556112e`); row **82** `archiving/runs` `POST`, ✅ gated, `requireAdmin` first statement; one Change History row; Last Updated. Re-measure before editing: `main` may have moved (Slice 1 CR-1 lesson) | 2b |
| `CLAUDE.md` § Key Documentation, admin row | "81 admin handlers (52 route files) … 75 via `requireAdmin`" → 82 / 53 / 76. **Not edited by Dev: flagged to the user at diff review** | 2b |
| [BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) | It lists tables by classification (`audit_trail` at the opt-in table, §8 for `never`). Add `archived_records` beside `audit_trail` under the activity-history checkbox, `archive_runs` under §8 `never`, and a Change History row. `descriptors.ts` stays the authority; the doc only mirrors it | 2a |
| [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md) | **No change:** it does not list `audit_trail` or other platform tables (grep, 2026-09-26) | — |
| Archiving requirement §13.4 | SA ticks "Slice 2 workplan reviewed" | SA |
| This workplan | Pre-check, apply, AC-11 and dry-run outputs recorded under Implementation Notes | 2a |

---

## 15. Logging Compliance (`console.*`)

Checked with grep on 2026-09-26 against the files this slice modifies: `AuditTrailService.ts`, `lib/audit/events.ts`, `lib/audit/types.ts`, `descriptors.ts`, `businessOwnedTables.ts`, `ArchiveRepository.ts`, `lib/repositories/index.ts`, `app/api/admin/archiving/route.ts`, `app/admin/archiving/page.tsx`, `lib/archiving/config.ts`, `lib/archiving/types.ts`, `lib/validation/archiving.ts`, `adminGate.writes.test.ts`, `AdminUserRepository.ts` (read only). **All 0.** New files use `createLogger`; the page does not log. Nothing to flag or convert.

---

## 16. Open Questions for SA

**All 14 answered by SA on 2026-09-26** (see [SA Review Notes](#sa-review-notes) § Answers). Dev's proposals were accepted except Q-12 (D-5 dropped: no DDL on PROD) and Q-14 (migration header only, confirmed). The table is kept as the record of what was asked.

| # | Question | Dev's proposal |
|---|---|---|
| **Q-1** | C-5 says "the page disables the Archive button"; §13.3 says "the confirm dialog opens". Both at once? | The Archive button **opens** the dialog (so QA can check its numbers and the K-1 sentence in PROD, AC-8), and the dialog's **Confirm** is disabled with "Not switched on yet". Continue buttons are disabled too. The server refuses regardless |
| **Q-2** | Split, and where? | Split. 2a = M1, registries, `applyRetentionPolicy` removal, repository **read** methods, GET extension and the read-only display; 2b = run methods, runner, POST, dialog, Continue, audit events. Moving the GET and display into 2a (unlike §13.3's 2a) gives every 2a method a caller and makes the M1 apply observable (§3) |
| **Q-3** | `FOR UPDATE` (blocking, `lock_timeout = '5s'`) or `FOR UPDATE SKIP LOCKED` in the select? | Blocking with a 5 s lock timeout. `SKIP LOCKED` can report "done" while locked eligible rows remain |
| **Q-4** | The function writes `archive_runs` (count, batches, `last_batch_at`) itself, and its only run-state guard is that final `UPDATE` (run, source, `running`, cutoff), plus an invariant `deleted = selected`. Acceptable, given §5.3 describes it as returning only "the number moved"? | Yes. The count can never disagree with the archive, a takeover or wrong cutoff rolls the batch back, and it returns three counts so "done" is unambiguous |
| **Q-5** | `getLatestCutoff`: "the cutoff of the newest `succeeded` run" (TQ-5), or the **latest cutoff** among succeeded runs? | The latest cutoff (`ORDER BY cutoff DESC`). A 365-day run after a 90-day run has an earlier cutoff; "newest run" would understate what is archived. Everything before the maximum succeeded cutoff is archived |
| **Q-6** | Slice 1's Q-2 put both the batch size and the batch function name in the registry. OK to keep the function name in the repository instead? | Yes: `batchSize` in the client-safe registry; the function name in a typed `Record<ArchiveSourceKey, string>` in the server-only repository, so no DB object name ships to the browser and a missing entry is a compile error |
| **Q-7** | Naming: `…AllAccounts` on `archive_runs` methods too? | No. Keep it for methods over `archived_records` / `audit_trail` (account data read or moved across accounts). `archive_runs` has no `user_id`, so plain names (`createRun`, `listRuns`, …) are accurate |
| **Q-8** | Audit entries: `userId` = the admin (the pricing-route precedent), or `null` with the admin only in `actorId`? | The admin in both. It lands in the admin's own activity history, which is where an admin action belongs; `archive_runs` stays the permanent record either way |
| **Q-9** | Run history "By" column: resolve the admin's email with the existing `AdminUserRepository.listActive()`, or show a short id? | Email via `listActive()` (one extra read, no new DB code), with a short-id fallback for a former admin. Never logged |
| **Q-10** | GET reports `isStale` for silent `running` runs, and the page offers Continue on them (the POST's takeover flips then claims). GET itself never writes. OK? | Yes. Otherwise a crashed run shows "Running" with no way to resume until someone starts a new run |
| **Q-11** | The dry run is a `DO` block that always ends by raising its report, not the literal `BEGIN; …; ROLLBACK;`. OK? | Yes (§5.5): the editor shows only the last result, and an explicit `BEGIN` followed by an error can leave a pooled session in an aborted transaction. The raised report gives the same "nothing kept" guarantee with no path that commits |
| **Q-12** | The dry run's D-5 creates a temporary trigger on `archived_records` (rolled back) to prove the `EXISTS` guard on live data. Keep, or rely on M-2's source pin? | Keep. It is the only executable proof that an uncopied row is never deleted; it locks only the new, unused table |
| **Q-13** | Add Slice 1's `GET /api/admin/archiving` to `adminGate.writes.test.ts` as well (58 → 60), or only the new POST (58 → 59)? | Only the POST, as briefed. The GET already has its own 401/403/"reads nothing" cases (Slice 1 I-1 to I-3) |
| **Q-14** | Keep the pre-check, post-check, dry run and rollback SQL in the migration header and this workplan only, or also as `scripts/*-archiving-*.sql` files like the entitlements module? | Header and workplan only. One copy of each script, where the person applying the migration already is |

---

## SA Review Notes

**Reviewed by SA — 2026-09-26**
**Status:** ✅ **APPROVED WITH CHANGES.** The design is sound, and D-1, C-1, C-3 to C-5, C-7, C-9, C-10, C-12 to C-16 and TQ-1/3/5 are all met. The changes below are one design correction (R-1) and cuts for simplicity (R-2 to R-5). None needs a re-review; SA checks them at code review of 2a and 2b. The user asked for simplicity, and the PROD runbook as drafted is too long to run confidently by hand. This review keeps every check that protects data (atomic batches, the lockdown, no row lost) and removes the rest.

### M1 design: rulings

| Point | Ruling |
|---|---|
| **Final `UPDATE` as the only run-state guard, recording the count** | ✅ **Keep.** It is in the same transaction as the move, so the run log cannot disagree with the archive, and a takeover or a wrong cutoff rolls the whole batch back. It also gives a one-call proof of AC-5 (call it on a non-running run: both writes happen, then the raise undoes them). No up-front check. |
| **`deleted ≠ selected` invariant raise** | ✅ **Keep.** It costs one line and turns "a selected row was not archived" into a rolled-back batch instead of a silent partial. It is also what makes a regression that drops the `EXISTS` guard observable. |
| **`FOR UPDATE` + `lock_timeout = '5s'` vs `SKIP LOCKED`** | ✅ **Blocking `FOR UPDATE`, as proposed.** `SKIP LOCKED` could report "done" while locked eligible rows remain. That is a false success, which is worse than a failed batch that Continue retries. Keep the function-level `SET lock_timeout = '5s'`. |
| **FK `archived_records.user_id → auth.users ON DELETE SET NULL`** | ❌ **Drop the FK** (R-1). This **supersedes C-11**, which SA wrote on 2026-09-25 and which was wrong. `ON DELETE SET NULL` nulls only the **column**. The `payload` still carries the `user_id` and the personal data (IP, user agent, `details`). So once an account is deleted, Slice 3's erasure (`DELETE … WHERE user_id = $1`) and the purge could **no longer find those rows**, and the personal data would stay behind, unreachable. A plain indexed `uuid` column keeps the id, so erasure works whenever it runs. Dropping the FK also removes the `SHARE ROW EXCLUSIVE` lock on `auth.users` during the apply (sign-ups blocked), the orphan pre-check P07, and a batch that fails forever on one orphan id. Keep `archived_records_user_id_idx`. Keep the FK `archive_run_id → archive_runs` (internal, harmless). |
| **Grants** | ✅ **Approved as drafted.** RLS on with no policies; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; `service_role` gets SELECT/INSERT/DELETE on `archived_records` (DELETE for Slice 3 erasure and purge; no UPDATE, because archive rows are immutable) and SELECT/INSERT/UPDATE on `archive_runs` (no DELETE); function `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`. `ON CONFLICT DO NOTHING` needs INSERT only, so the INVOKER privileges suffice. |

### Required changes (priority order)

1. **R-1 (High) Drop the `auth.users` FK** (above). Also drop pre-check P07 and the migration-level `SET LOCAL lock_timeout` (it existed only for that FK). Invert source pin M-10 to "`UNIQUE (source, source_id)`, and `archived_records` has **no** `REFERENCES auth.users`". In the 2a PR, add one line under C-11 in the requirement's §13.2: *"Superseded by the Slice 2 SA review (2026-09-26): no FK, so erasure by `user_id` still finds archived rows after account deletion."*
2. **R-2 (High) Cut the PROD runbook to four steps, plus a rollback used only if needed** (see "The user's runbook" below):
   - **Pre-check: 5 rows**, one statement: P01 (types of `id`, `created_at`, `user_id`), P02 (triggers), P03 (rules), P06 (inbound FKs), P09 (service_role SELECT/DELETE). Drop P04, P05, P07, P08 (a plain `CREATE TABLE` already fails on a taken name, and the transaction rolls back), P10, P11, P12.
   - **Access check (AC-11): one `SELECT` returning one row of seven booleans**, all of which must be `true`: `NOT has_table_privilege` for anon and authenticated × both tables (4), `NOT has_function_privilege` for anon and authenticated on the function (2), and `NOT prosecdef` for the function (1). `has_*_privilege` already counts `PUBLIC` grants. **Drop the 10-row catalogue report and the live `SET ROLE` probe.** The service-role positive side is proven by the dry run (which runs as `service_role`) and by the page loading after deploy (M-a4).
   - **Dry run: three checks, no DDL.** Keep the self-rolling-back `DO` block (Q-11) and `SET LOCAL ROLE service_role`. Keep only: **D-1** (AC-5: non-running run → raises → both tables unchanged); **D-4 + D-6 merged** (drain the eligible rows: 0 left before the cutoff, archived = eligible, `rows_archived` agrees, payloads identical); **D-7** (re-run is a no-op, no duplicates). **Drop D-2** (a CHECK and a unique index are Postgres guarantees, already pinned by M-6/M-8), **D-3** (the same guard line as D-1) and **D-5** (Q-12: no temporary function or trigger created on PROD, even rolled back). Keep the one-line "nothing kept" query after it.
3. **R-3 (Medium) Mutation spot-checks: 12 → 4**, Dev only (QA does not repeat them): gate moved below `request.json()` (P-15); runs-enabled check removed (P-5); `EXISTS` removed (M-2); `status = 'running'` removed from the final `UPDATE` (M-3).
4. **R-4 (Medium) Trim the migration source test** to M-1 to M-8, M-10 (as amended by R-1) and M-11. Drop M-9, M-12 and M-13.
5. **R-5 (Low) One copy of the runbook SQL.** From T-a2 on, the migration header is the authoritative copy of the pre-check, access check, dry run and rollback. §5 of this workplan shrinks to the step table, the stop conditions and a pointer to the header. No `scripts/*.sql` copies (Q-14).
6. **R-6 (Low) Drop the "logs never contain `@`" GET test** (§8.5). The route logs no emails by construction, and one existing Slice 1 source rule covers `console.`.

### Answers to Q-1 to Q-14

| # | SA answer |
|---|---|
| **Q-1** | **Yes, both:** the Archive button opens the dialog (so AC-8 is checkable in PROD); Confirm and Continue are disabled with "Not switched on yet"; the server refuses regardless. This clarifies C-5 |
| **Q-2** | **Split confirmed, with the GET and read-only display in 2a.** Every 2a method has a caller, and the M1 apply is observable. C-4 and C-14 land in 2a with M1 |
| **Q-3** | **Blocking `FOR UPDATE` + 5 s `lock_timeout`** (see rulings) |
| **Q-4** | **Accepted:** the final `UPDATE` guard, the invariant and the three-count return (see rulings). Supersedes the "returns only the number moved" wording in requirement §5.3 |
| **Q-5** | **Latest cutoff (`ORDER BY cutoff DESC`)** among succeeded runs. That is what "entries before X are archived" means. TQ-5 wording is clarified accordingly |
| **Q-6** | **Accepted:** `batchSize` in the client-safe registry, the function name in a typed `Record` in the server-only repository |
| **Q-7** | **Accepted:** `…AllAccounts` only on methods over `archived_records` / `audit_trail`; plain names on `archive_runs` |
| **Q-8** | **Admin in both `userId` and `actorId`**, as proposed |
| **Q-9** | **Email via the existing `AdminUserRepository.listActive()`, short-id fallback.** There are two admins, so a name beats a UUID. No new DB code, and no separate "no `@` in logs" test (R-6) |
| **Q-10** | **Accepted:** GET reports `isStale` without writing; Continue on a stale run goes through the POST's takeover then claim |
| **Q-11** | **Accepted:** a self-rolling-back `DO` block that raises its report. The reasoning (the editor shows only the last result, and an aborted pooled session) is correct |
| **Q-12** | **Drop D-5** (R-2). No DDL on PROD for a test. The `EXISTS` guard is pinned by M-2, made observable by the invariant, and covered by a mutation check (R-3) |
| **Q-13** | **Only the POST (58 → 59)** |
| **Q-14** | **Migration header only**, and the workplan points to it (R-5) |

### The user's PROD runbook after these cuts

| Step | What | Stop if |
|---|---|---|
| 1 | Pre-check (one read-only `SELECT`, 5 rows) → send the output to Dev | `id`/`user_id` not `uuid` or `created_at` not `timestamptz NOT NULL`; any trigger that fires on DELETE; any rule; any inbound FK to `audit_trail`; service_role lacks SELECT or DELETE |
| 2 | Apply M1 (one paste, one transaction), before 2a deploys | The apply errors. Nothing is left behind; send the error to Dev |
| 3 | Access check (one `SELECT`, one row of 7 booleans) | Any value is `false` → run the rollback |
| 4 | Dry run (one `DO` block), then the one-line "nothing kept" query | The error text does not start with `DRY RUN PASS`, or the query returns anything but `0, 0` → send both to Dev. Nothing was kept either way |
| — | Rollback, only if step 3 or 4 fails, after reverting the 2a deploy | It refuses if `archived_records` has rows (impossible while runs are off) |

### Other notes (no action unless stated)

- The `CLAUDE.md` admin-handler count edit (81 → 82 / 52 → 53 / 75 → 76) stays **flagged for the user at diff review**. It is not an implementation task. Updating `ADMIN_IDENTIFICATION_AND_ACCESS.md` in 2b is approved.
- The `adminGate.writes` pin 58 → 59 and the purge baseline 124 → 126 are intended pin moves.
- Pre-existing, out of scope: the **live** `audit_trail.user_id` FK has the same SET-NULL-leaves-payload property. That is an erasure gap for C-17's follow-up item, not for this slice.

### Approval

- [x] Workplan approved, conditional on R-1 to R-6. Proceed with 2a
- [x] 2a code review (approved with conditions, see below)
- [ ] 2b code review

### Code Review by SA — 2026-09-26 (Slice 2a)

**Status:** ✅ **Code Approved for QA, with one condition that must land before the PROD apply (CR-1).** CR-2 and CR-3 are small and should land in the same commit. Nothing here needs a re-review: SA checks CR-1 by reading the diff of M1 and the M-5 pin.

Reviewed read-only (no file touched except this section): `git diff` against `9d3b2a8b` plus the three untracked files. Affected suites re-run by SA: **11 suites, 323 tests, all passing** (migration pins, route, page, repository, config, purge invariants + baseline + no-deletion guard, `businessOwnedTables`, admin-authz guard).

#### What was verified

| Area | Result |
|---|---|
| **M1 move function, statement order (C-3)** | ✅ Select `FOR UPDATE` → `INSERT … ON CONFLICT DO NOTHING` → `DELETE … AND EXISTS (archived_records)` → `deleted <> selected` raise → final `UPDATE` guard, each a separate statement. No data-modifying CTE. An empty batch (`v_ids` null) still passes through the guard, so a re-run on a finished or taken-over run raises too |
| **SECURITY INVOKER, `search_path = ''`** | ✅ Every relation is schema-qualified; the only unqualified names (`now`, `cardinality`, `array_agg`, `to_jsonb`, operators) live in `pg_catalog`, which is always searched. Column defaults (`gen_random_uuid()`) are bound at `CREATE TABLE`, so the empty path does not affect them. OUT column names (`selected_count` …) collide with no table column |
| **Final guard and invariant (D-1)** | ✅ Run id, `source = 'audit_trail'`, `status = 'running'`, `cutoff = p_cutoff`, last, same transaction, `IF NOT FOUND THEN RAISE`. The invariant is sound under blocking `FOR UPDATE` |
| **RLS / client roles** | ✅ RLS on both tables, no policy, `REVOKE ALL … FROM PUBLIC, anon, authenticated` on both tables and the function; `EXECUTE` only to `service_role` |
| **No FK to `auth.users` (R-1)** | ✅ `archived_records.user_id` is a plain indexed `uuid`; `archive_runs.started_by` has no FK either. M-10 pins it |
| **Runbook in the header** | ✅ Exactly one `/*` and one `*/` in the file (Postgres nests block comments, so a stray `/*` inside would have swallowed the migration). Each step is one statement or one `DO` block. The dry run is genuinely self-rolling-back: it ends in an unconditional `RAISE EXCEPTION`, which undoes every insert, delete and the `SET LOCAL ROLE`, and D-1's inner `BEGIN … EXCEPTION` sub-block rolls back to its savepoint. The rollback refuses when `archived_records` holds a row and drops child before parent |
| **Registries (C-4, C-14)** | ✅ `archived_records`: `optional:activityHistory`, `user_id` scope, `ORDER.LEAF`, `snapshot: 'ids'`; `archive_runs`: `never`, global. Baseline 124 → 126 deliberate. `USER_OWNED_TABLES` entry present; M-11 keeps `archive_runs` out of the ownership scan |
| **`applyRetentionPolicy` removal (C-13, AC-17)** | ✅ Method, config default, `RetentionPolicy` type and `retentionPolicy?` field gone. SA re-grepped: 0 hits for `applyRetentionPolicy\|RetentionPolicy\|retentionPolicy` in `app lib scripts components hooks types`; the only `DELETE FROM … audit_trail` in `supabase/` is M1's |
| **Repository (C-7, Q-7)** | ✅ Three new read methods, no `insert/update/upsert/delete/rpc` anywhere in the file, named column list, no `payload`. `…AllAccounts` on `archived_records`, plain names on `archive_runs`; header and REPOSITORY_STRATEGY say why. A `null` count is an error, never `0` |
| **GET: `adminUserRepository.listActive()` (Q-9)** | ✅ No authz or PII leak. `requireAdmin` is still the first statement; the admin list is read only when there are runs; only the emails of admins who started a listed run reach the response, and only to an admin; the warning on failure logs `err` alone, never an email; the fallback is `Admin <first 8 of the uuid>`. The authz guard is unchanged and green |
| **Standards** | ✅ Pino only, 0 `console.` in touched files; Zod not applicable (GET takes no input, query ignored); no new `any` |
| **`trigger_sync_audit_user_email` / `user_email`** | ✅ **Correctly deferred to Slice 3.** It is `BEFORE INSERT` on `audit_trail`; M1 never inserts there, and `to_jsonb(a)` carries `user_email` into `payload` like any other column. The anonymise-then-archive gap is the C-17 class, not a Slice 2 defect. See CR-3 for where it must be recorded |

#### Code Review Comments

1. **CR-1 — `supabase/migrations/20261010_admin_archiving_runs.sql` §3 (privileges): `service_role` keeps privileges it does not need.** Priority: **Medium. Fix before the PROD apply** (after the apply it costs another hand-run migration). The file revokes `UPDATE, TRUNCATE` / `DELETE, TRUNCATE` from `service_role` by enumeration, so the Supabase default `ALL` still leaves it `REFERENCES` and `TRIGGER` on both tables (and `MAINTAIN` on Postgres 17). That contradicts the header's own rule ("REVOKE ALL, never an enumeration: a list goes stale when Postgres adds a privilege") and its claim that the service-role side is *stated*: the same kind of comment-versus-reality gap as the 20261005 lesson. SA approved the enumerated form in §4.2, so this is SA's miss as much as Dev's. **Fix:** add `service_role` to the `REVOKE ALL ON TABLE public.archive_runs, public.archived_records FROM …` line (or a separate `REVOKE ALL … FROM service_role;`), drop the two enumerated service-role `REVOKE`s, keep the two `GRANT`s exactly as they are. Foreign-key checks run as the table owner, so `service_role` needs no `REFERENCES`. Update the M-5 pin to match, and re-run the migration test and, if possible, the PGlite pass
2. **CR-2 — M1 header, runbook wording.** Priority: Low. (a) The rollback says "revert the 2a deploy FIRST", but by T-a14 steps 2 to 4 run **before** 2a merges, so there is normally nothing to revert. Say "if 2a is already deployed, revert it first". (b) Step 4 in the header says what PASS looks like but not what to do otherwise; add "anything else: stop, do not merge, send the text to Dev" (the workplan §5 says it, but the header is the single copy per R-5). (c) Optional: prefix the `── STEP n …` heading lines with `-- ` so a selection that includes a heading still runs
3. **CR-3 — the `user_email` / anonymise-then-archive gap must have one authoritative home.** Priority: Low. Today it lives only in this workplan's Implementation Notes, which close with the slice. Add one line to requirement §13's **C-17** row (or the Slice 3 plan in §13.3): "whoever fixes C-17 also nulls `user_email`; Slice 3 decides whether erasure also matches archived rows by `payload->>'user_email'`". No code change

#### Rulings on Dev's deviations

| # | Ruling |
|---|---|
| **D-1** block comment for the runbook | ✅ Approved. It is what makes R-5 usable. SA verified a single `/*` … `*/` pair |
| **D-2** unreadable admin list → short-id labels, not 500 | ✅ Approved. A label is not a measurement; counts and runs still fail closed. Covered by A-4 |
| **D-3** `RUN_HISTORY_LIMIT` in `config.ts` | ✅ Approved. Keeps `types.ts` types-only (U-C7) |
| **D-4** "Archived before" as a second line; "Not available" fallback | ✅ Approved. The fallback is unreachable |
| **D-5** GET throws → 500 on an impossible run row | ✅ Approved. Consistent with Slice 1 CR-3 ("never show a value the server cannot vouch for"); the DB CHECKs make it unreachable today. Covered by A-7 |

**Deliberate pin moves accepted:** route I-4 key set; repository method count 3 → 6; page P-5 → G-1/G-2; purge baseline 124 → 126. `lib/admin/__tests__/admin-authz-surface.guard.test.ts` is untouched (C-1).

#### Optimisation Suggestions (not blocking)

- Dry run D-1: also require `SQLERRM LIKE '%is not running with this cutoff%'`, so D-1 cannot pass on some other error (today a human reads it in the report; D-2 would fail anyway).
- `lastRun` is found among the newest 20 runs of **all** sources. Correct with one source; when a second source is added, read each source's last run directly or a quiet source will show "No runs yet".
- `AuditTrailService.ts` keeps two pre-existing unused imports (Dev's ESLint note). The file is touched, so dropping them is cheap; not required.
- Pre-existing, not this slice: `descriptors.ts`'s `audit_trail` note says "user_id is SET NULL on the auth FK", while Dev's side note (from the LLM audit-trail workplan) says the live column has **no** FK, and SA's own "Other notes" above assumed the FK. Neither was re-measured; whoever takes the C-17 follow-up should measure it once and correct both.

#### Code Approved for QA: **Yes**, conditional on CR-1 landing before §5 step 2 (the PROD apply). CR-2 and CR-3 in the same commit.

---

## Implementation Notes

**Dev, 2026-09-26.** Slice 2a code complete on `feature/admin-archiving-s2` (rebased on `origin/main` `9d3b2a8b`). Not committed. **M1 not applied anywhere.**

### Pre-check output (T-a1, PROD, 2026-09-26, run by the user)

| Row | Status | Detail |
|---|---|---|
| P01 column types | PASS | `id = uuid NOT NULL; created_at = timestamp with time zone NOT NULL; user_id = uuid` |
| P02 triggers that fire on DELETE | PASS | `trigger_sync_audit_user_email` (does not fire on DELETE) |
| P03 rules on audit_trail | PASS | no rules |
| P06 foreign keys pointing at audit_trail | PASS | none |
| P09 service_role can SELECT and DELETE audit_trail | PASS | `select = true, delete = true` |

No STOP, so M1 was written as drafted in §4 (with R-1 applied). Nothing in the output changed the design.

### `trigger_sync_audit_user_email`: does it matter?

Read-only, from the repo (not re-measured): its definition is recorded in `docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md` §2.3 from the user's `pg_get_functiondef` read (2026-09-19), and its `CREATE TRIGGER` line in `business-os-business-data-purge-schema-dump.md:626`. It is `BEFORE INSERT … FOR EACH ROW` and sets `NEW.user_email` from `auth.users` when `NEW.user_id` is not null (a non-`STRICT` `SELECT … INTO`, so it never raises). So `audit_trail` has a live **`user_email`** column that the repo's creation script does not show (F-2 drift again). P01 only checks the three columns the function needs, so it did not list it.

| Question | Answer |
|---|---|
| **M1?** | **No effect.** The trigger fires only on INSERT into `audit_trail`; the move function only selects and deletes there, and inserts into `archived_records`, which has no trigger. `to_jsonb(a)` copies the whole row, so `payload` carries `user_email` automatically, exactly as it carries every other column. Verified in PGlite with the trigger and column reproduced (§ Local verification) |
| **Slice 3 erasure?** | **Confirmed fine for rows that still have their `user_id`.** Erasure (C-8) deletes archived rows `WHERE user_id = $1`; `archived_records.user_id` is a real column copied from the row, and with no FK (R-1) it survives account deletion. The payload, `user_email` included, goes with the row |
| **The gap it exposes** | ⚠️ A row whose `user_id` was **nulled before it was archived** keeps `user_email` (and `changes`, `resource_name`) in the payload but can no longer be found by `user_id`. Today that happens only through `AuditTrailService.anonymizeUserData`, which sets `user_id = null` but does **not** clear `user_email` (it has no production caller). This is the same class as **C-17** (anonymise leaves personal data on live rows), now with one more column, and it becomes an archive problem only once such rows are archived. **Recorded for Slice 3 / the C-17 follow-up, not fixed here:** whichever fixes C-17 should also null `user_email`, and Slice 3 should decide whether erasure also matches archived rows by `payload->>'user_email'` |
| **Side note** | The LLM audit-trail workplan records the live `audit_trail.user_id` as having **no** FK; SA's note (§ SA Review, "Other notes") assumed a SET NULL FK. P05 was dropped from the pre-check, so this was not re-measured. It does not affect Slice 2 either way |

### Local verification of M1 (not PROD)

There is no Postgres on this machine and no branch database, so M1 was exercised on **PGlite (Postgres 16) in the scratchpad**, never against any Supabase project. The fake setup reproduced: `anon` / `authenticated` / `service_role` (with `BYPASSRLS`), Supabase-style default privileges granting ALL on new tables and functions to all three, `audit_trail` with `user_email` and `trigger_sync_audit_user_email`, and 27 rows (two sharing a timestamp). The runbook blocks were cut from the M1 header text itself, so what ran is what the user will paste.

| Step | Result |
|---|---|
| 1 Pre-check | 5 PASS (`trigger_sync_audit_user_email` listed, not flagged) |
| 2 Apply M1 | Applied cleanly in one transaction |
| 3 Access check | All seven `true` (the default ALL grants to `anon`/`authenticated` were removed by the REVOKEs) |
| 4 Dry run | `DRY RUN PASS: eligible=10 \| D-1 raised: … is not running with this cutoff; 5 rows rolled back \| D-1 PASS (AC-5) \| D-2 PASS (AC-4): 0 left, 10 archived, run log agrees, payloads identical \| D-3 PASS (AC-6)` |
| Nothing kept | `0, 0`; live `audit_trail` still 27 rows |
| service_role | no UPDATE on `archived_records`, no DELETE on `archive_runs`, SELECT/INSERT/DELETE on `archived_records` |
| Rollback | Dropped both tables and the function |
| Mutation: `status = 'running'` removed from the guard | Dry run reports `DRY RUN FAIL` on D-1, D-2 and D-3 |

### Verification (T-a12, T-a13)

| Check | Result |
|---|---|
| Affected suites (`lib/archiving lib/validation/__tests__/archiving lib/repositories app/api/admin app/admin lib/admin lib/business-os/purge lib/business-os/__tests__/businessOwnedTables supabase/migrations/__tests__ lib/audit lib/services`) | **111 suites, 2,080 tests, all passing**. Includes the admin-authz guard (file unchanged), `app/api/admin/__tests__/*`, `no-deletion-paths.guard`, the purge invariants + SA-S3 baseline, `businessOwnedTables` |
| New / changed tests | migration pins 20 (M-1 to M-8, M-10, M-11); repository 23 (+10); route 38 (+19: A-1 to A-8, I-4 pin moved); page 16 (G-1, G-2 replace P-5); config 28 (+3); purge C-4 6 (new, in `descriptors.invariant.test.ts`, now 40) |
| `businessOwnedTables` red without the entry (T-a5) | Yes: it listed exactly `["archived_records"]`, and not `archive_runs` (M-11 holds) |
| Mutation checks MU-1 (`EXISTS` removed), MU-2 (`status = 'running'` removed) | Each turns M-2 / M-3 red (1 failure each); file restored, SHA-1 `a04732f5…` matches |
| `tsc --noEmit` (8 GB heap, `--typeRoots` pointed at the parent `node_modules/@types`, because the worktree has no `node_modules`) | Ran to completion (exit 2 with 2,069 errors, all pre-existing); **0 in touched files** |
| ESLint on the 16 touched TS files | **0 errors**; 8 warnings, all pre-existing lines (`any` in `lib/audit/types.ts`, two unused imports in `AuditTrailService.ts`) |
| `npm run lint:hooks` | Pass |
| `next build` with the CI placeholder env | **Pass** (exit 0). The log carries the usual pre-existing "Dynamic server usage" lines from other routes |
| `console.` in touched files | 0 |
| AC-17 grep | `applyRetentionPolicy|RetentionPolicy|retentionPolicy` in `app lib scripts components hooks types`: **0**. `.from('audit_trail')…delete(` in `app`/`lib`: **0**. `scripts/` still has 10 test-cleanup deletes by `action`/test user (never by age), pre-existing dev scripts |

### Deviations

| # | Deviation | Why |
|---|---|---|
| **D-1** | The runbook SQL sits in **one `/* … */` block** in the M1 header, not `--` comment lines | `--`-prefixed SQL cannot be pasted: the editor would run nothing. A block comment lets each step be copied exactly as written, and the apply ignores it. Pinned implicitly: the migration test strips block comments before checking |
| **D-2** | The admin email lookup in GET **does not fail the page**: if `admin_users` cannot be read, runs show `Admin <8 chars>` and a warning is logged | A label is not a measurement, so the "any failed read → 500" rule (which protects counts) does not need to apply. Route test A-4 |
| **D-3** | `RUN_HISTORY_LIMIT` (20) lives in `config.ts`, not `types.ts` | `types.ts` stays types-only (Slice 1's U-C7 pin) |
| **D-4** | Page: "Archived before" is a second line under the archived total, and the Slice 1 fallback for a missing option reads "Not available" instead of the removed constant | Keeps the card at four columns; the fallback is unreachable (the route always sends three options) |
| **D-5** | GET validates each run row (status, source, retention, numeric count) and **throws → 500** on an impossible value rather than rendering it | The history must never show a run as something it is not; the DB CHECKs make this unreachable today. Route test A-7 |

### For SA and QA to look at

- **M1** (`supabase/migrations/20261010_admin_archiving_runs.sql`): the C-3 statement order, the `EXISTS` guard, the invariant, the final guard, the grants, and that `archived_records.user_id` has no FK (R-1).
- **The GET's new dependency on `adminUserRepository.listActive()`** (SA Q-9). No other admin route reads `admin_users` directly for labels; the authz guard does not restrict it (it forbids `AdminAccessService` in routes, not the repository).
- **Deliberate pin moves:** route I-4 key set; repository method count 3 → 6 and the naming rule; page P-5 replaced by G-1/G-2; purge baseline 124 → 126.
- **QA live checks owed after the user applies M1 (T-a14):** M-a1, M-a3 (paste the outputs), then M-a4 (page reads 0 / none yet / No runs yet), M-a5 (`npm run schema:check`), M-a6.
- **Admin handler count:** 2a adds **no** handler (GET already existed), so neither `ADMIN_IDENTIFICATION_AND_ACCESS.md` nor CLAUDE.md changes in 2a. The 81 → 82 edit belongs to 2b.
- `.claude/settings.local.json` is modified in the worktree from before this work and **must not be committed**.

### Post-review fixes (Dev, 2026-09-26)

| Item | Fix |
|---|---|
| **SA CR-1** (Medium, before the PROD apply) | M1 §3 now runs `REVOKE ALL ON TABLE public.archive_runs, public.archived_records FROM PUBLIC, anon, authenticated, service_role;` and keeps the two explicit `GRANT`s unchanged. The two enumerated service-role `REVOKE`s are gone. The function's `REVOKE ALL` also names `service_role` before its `GRANT EXECUTE`. The header's design note says the same. **M-5 pin updated:** the table revoke names `service_role`; every `REVOKE` in the file must be `REVOKE ALL` (no enumeration); the only table `GRANT`s are exactly the two. The function pin (M-4) names `service_role` too. Migration test: 21 tests, green |
| **SA CR-2** (runbook wording, all in the M1 header) | (a) Rollback heading: "if 2a is already deployed, revert it first" (and the apply-order summary). (b) Step 4 and the "nothing kept" query now say: anything else, stop, do not merge, send the full text to Dev. (c) Every `── STEP` / `── ROLLBACK` heading line is prefixed with `-- `, so a selection that includes one still runs. (d) **QA live check 3 folded into the access check:** two more booleans, `NOT has_table_privilege('service_role', <table>, 'REFERENCES, TRIGGER')` for both tables, so it is still one `SELECT`, now nine values. Step 3 also says what to do on a false |
| **SA CR-3** | One line added to requirement §13.2 **C-17**: anonymise also leaves `user_email`; whoever fixes C-17 nulls it; Slice 3 decides whether erasure also matches archived rows by `payload->>'user_email'`. C-17's slice column now reads 3 |
| **Optional cleanup** | The two unused imports in `AuditTrailService.ts` (`ChangeSet`, `generateDiff`) removed. Nothing else changed |

Re-verified after the fixes:

| Check | Result |
|---|---|
| Migration test | 21/21 |
| Affected suites (same set as T-a12) | **111 suites, 2,081 tests, all passing** |
| QA's PGlite script, re-run against the updated M1 (`scratchpad/pgcheck/qa-m1-v2.mjs`: a copy of QA's `qa-m1.mjs` whose header split also accepts the new `-- ──` headings; logic unchanged) | Pre-check 5 PASS; apply clean; access check **all nine `true`**; `service_role` now holds exactly SELECT/INSERT/DELETE on `archived_records` and SELECT/INSERT/UPDATE on `archive_runs`, with **REFERENCES, TRIGGER, TRUNCATE all `false`** on both; `DRY RUN PASS` (D-1 to D-3); nothing kept 0/0; adversarial X1–X16 unchanged (every refusal still refuses, the committed move still archives with full payload fidelity, 9/9 `user_email` keys carried); rollback refuses with rows and drops cleanly when empty; a second apply fails on the existing table and changes nothing. The `archive_run_id` FK insert works without REFERENCES |
| ESLint on the touched files | 0 errors; 6 warnings, all pre-existing (`any`); the two unused-import warnings are gone |
| `next build` (CI placeholder env) | Pass |

---

## QA Testing Report

**QA — 2026-09-26 (Slice 2a)**
**Test mode:** full, 2a scope only (nothing from 2b exists yet)
**Strategy used:** A + B (Jest: unit, route integration with mocks, source pins), C (M1 runbook run end to end on a local PGlite / Postgres 16 in the scratchpad, never on any Supabase project), plus 6 mutation spot-checks. D (E2E) is not set up. The manual page checks M-a4 to M-a6 need PROD after the apply, so they are listed as owed.
**Focus:** schema, security, api, ui
**Skipped:** E2E (not installed). Live PROD checks (owed to the user, see below)
**Input source:** prompt keywords from TL (the §8.8 "QA does not repeat" note was overridden by the brief: 4 SA mutations plus 2 of QA's choosing)

Tested against the uncommitted worktree **including SA's CR-1, which is still open**. The file was not changed by QA: every mutation was restored and checked by SHA-256 (see the end of this section).

### Test runs

| Set | Suites | Tests | Result |
|---|---|---|---|
| Brief set: `lib/archiving`, `ArchiveRepository`, `app/api/admin/archiving`, `app/admin/archiving`, the migration test, `businessOwnedTables`, `lib/business-os/purge` (descriptors, baseline, invariant, no-deletion guard, Reset order), `lib/audit`, the admin-authz guard, `app/api/admin/__tests__` | 18 | 697 | ✅ all pass |
| Suites that exercise `AuditTrailService` (audit routes, Stripe, website, `aiActionAudit`, briefing, insight-detect, onboarding build, test-audit, effort estimator, `AuditTrailRepository`, `app/admin/audit-trail`) | 19 | 212 | ✅ 18 pass. ❌ `chat-v4/route.audit.test.ts` crashes the Node process (`profile read failed for OWNER-TEXT-MARKER-c1 cancel`). **Pre-existing, not 2a:** the same crash reproduces with HEAD's `AuditTrailService.ts` and `lib/audit/types.ts` swapped in (then restored, hash checked) |
| Dev's T-a12 set (`lib/archiving lib/validation/__tests__/archiving lib/repositories app/api/admin app/admin lib/admin lib/business-os/purge businessOwnedTables supabase/migrations/__tests__ lib/audit lib/services`) | 111 | 2,080 | ✅ matches Dev's numbers exactly |
| AC-17 grep `applyRetentionPolicy\|RetentionPolicy\|retentionPolicy` in `app lib scripts components hooks types` | — | — | ✅ 0 hits (M-a6 on the code) |

### Mutation spot-checks (6, each reverted, SHA-256 matched after every one)

| # | Mutation | Turned red | Result |
|---|---|---|---|
| QM-1 | Gate position: `await archiveRepository.listRuns(...)` inserted above `requireAdmin` | I-1, I-2, I-3 (reads before the gate), I-10 (position pin): 4 failed | ✅ caught |
| QM-2 | Runs-enabled: 2a has **no** enforcement check (the POST is 2b), only the mirror `runsEnabled: ARCHIVE_RUNS_ENABLED`; mutated to `true` | I-4: 1 failed | ✅ caught |
| QM-3 | `AND EXISTS (… archived_records …)` removed from the M1 `DELETE` | M-2: 1 failed | ✅ caught |
| QM-4 | `AND r.status = 'running'` removed from the final `UPDATE` | M-3: 1 failed | ✅ caught |
| QM-5 | `archived_records` removed from `USER_OWNED_TABLES` | "classifies every table that carries a user_id": 1 failed | ✅ caught |
| QM-6 (QA's choice) | `isStale` no longer requires `status === 'running'` (a finished run could offer Continue in 2b) | A-2, A-6 "a finished run is never stale": 2 failed | ✅ caught |

### M1 runbook, run by QA on PGlite (Postgres 16)

The setup copies Supabase: roles `anon`, `authenticated` and `service_role` (BYPASSRLS), with the Supabase default privileges (ALL on new tables and functions to all three). It also reproduces `audit_trail` with `user_email`, `severity` and `details`, the `trigger_sync_audit_user_email` BEFORE INSERT trigger, and 43 rows (three sharing one timestamp). The five runbook blocks were cut from the M1 header text itself.

| Step | Expected | Actual |
|---|---|---|
| 1 Pre-check | 5 PASS | ✅ 5 PASS; P02 lists `trigger_sync_audit_user_email`, not flagged |
| 2 Apply M1 | clean | ✅ applied in one transaction |
| 3 Access check | 7 `true` | ✅ all 7 `true` |
| 4 Dry run | `DRY RUN PASS` | ✅ `DRY RUN PASS: eligible=10 \| D-1 raised: … is not running with this cutoff; 5 rows rolled back \| D-1 PASS (AC-5) \| D-2 PASS (AC-4): 0 left, 10 archived, run log agrees, payloads identical \| D-3 PASS (AC-6)` |
| Nothing kept | `0, 0` | ✅ `0, 0`; `audit_trail` still 43 rows |
| Rollback on an empty archive | drops everything | ✅ both tables and the function gone; re-apply afterwards works; a second apply over existing tables errors (`relation "archive_runs" already exists`) and changes nothing |
| Rollback with archived rows | refuses | ✅ `ROLLBACK REFUSED: archived_records holds rows, and they are the only copy`; objects intact |

**Adversarial cases.** Each ran as `service_role` in its own committed transaction unless stated. After every case, the counts (live 43, archived 0, runs 3, rows_logged 0) were **unchanged**.

| # | Attempt | Outcome |
|---|---|---|
| X1 / X2 | Batch on a `succeeded` / `partial` run | Raised `not running with this cutoff; 9 rows rolled back` |
| X3 | Running run, cutoff widened to `now()` (would have archived all 43) | Raised; `43 rows rolled back` |
| X4 | Running run, cutoff 1 ms off the stored one | Raised |
| X5 | Unknown run id | Raised on the `archive_run_id` FK (before the guard is reached) |
| X6 / X7 | Batch size 0 / 5001 | Raised `out of range` |
| X8 / X9 | Call as `anon` / `authenticated` | `permission denied for function` |
| — | `anon` / `authenticated` SELECT on both tables, INSERT into `archive_runs` | All 6 denied |
| X10 | A second `running` run for the same source | Unique violation on `archive_runs_one_running_per_source` (AC-7, DB half) |
| X11 | `retention_days = 30` | CHECK violation |
| X12 / X13 | `service_role` UPDATE `archived_records` / DELETE `archive_runs` | Denied |
| X14–X16 | A real committed move: a batch of 4, then a drain, then a re-run | Returned 4/4/4, then 5/5/5, then 0/0/0. `rows_archived` = archived rows = 9; 0 left before the cutoff; payloads carry `user_email` (the trigger's column comes through `to_jsonb`); `user_id` and `created_at` match the payload; no duplicate `source_id` |

**SA's CR-1 confirmed live:** after the apply, `service_role` still holds **REFERENCES and TRIGGER on both tables** (`TRUNCATE` and the intended UPDATE/DELETE are gone). QA then ran SA's proposed fix on a **scratch copy** of M1: `service_role` added to the `REVOKE ALL`, the two enumerated revokes dropped, the grants kept. The result: `service_role` holds exactly SELECT/INSERT/DELETE on `archived_records` and SELECT/INSERT/UPDATE on `archive_runs`. The access check, the dry run (PASS), the adversarial set and the rollback refusal all behave the same. The `archive_run_id` FK insert still works without REFERENCES, because FK checks run as the owner. So the fix is safe to make as SA worded it.

### Page states (jsdom, `page.render.test.tsx` 16 + `source.guard.test.ts` 9)

| State | Test | Result |
|---|---|---|
| No runs | G-1: measured `0` archived, "None yet", "No runs yet" | ✅ |
| Runs present | G-2: total and latest cutoff in UTC, last run status in words, rows newest first with text badges, Running / Partial, no start or continue control in 2a | ✅ |
| Admin email fallback | Page renders `startedByLabel` as given (`ops@example.com` and `Admin bbbbbbbb`). The route decides it: A-2 (email), A-3 (former admin → short id), A-4 (unreadable admin list → short ids, page still 200), A-5 (list not read when there are no runs) | ✅ |
| Error state | P-6: the route message and a retry with no counts; an HTML 504 shows friendly text; a retry recovers | ✅ |
| Route fails closed | A-7 (six cases) / I-7 / CR-3: any failed or null count, or any impossible run row → 500 with no partial data | ✅ |

### Test Coverage (2a ACs)

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-5 (non-running run changes nothing) | ✅ | Pass | Dry run D-1; X1–X4; M-3; QM-4 |
| AC-7 (one running run, DB half) | ✅ | Pass | X10; M-8. Route half is 2b |
| AC-11 (client roles locked out) | ✅ locally | Pass | Access check 7/7; X8, X9, six denied table ops. **Live check owed (M-a1)** |
| AC-12 (purge classification) | ✅ | Pass | `descriptors.invariant` C-4 block + baseline 126; QM-5 |
| AC-17 (`applyRetentionPolicy` gone) | ✅ | Pass | grep 0; `no-deletion-paths.guard` green |
| AC-1 (every field real) | ◐ | Pass (tests) | G-1, G-2, A-1, A-2; live M-a4 owed; real run is Slice 3 |
| AC-4 / AC-6 | ◐ | Pass (dry run) | D-2, D-3, X14–X16; live in Slice 3 |
| AC-18 (logging) | ✅ | Pass | I-9, I-10, source guard: no `console.`, no email logged |

### Issues Found

#### Bugs (must fix before commit)
1. **SA CR-1: `service_role` keeps REFERENCES and TRIGGER on `archive_runs` and `archived_records`**: File: `supabase/migrations/20261010_admin_archiving_runs.sql` §3. Severity: **Medium**. It must land before the PROD apply (§5 step 2).
   - Steps to reproduce: apply M1 on a database with Supabase default privileges; `has_table_privilege('service_role', 'public.archived_records', 'TRIGGER')`.
   - Expected: only the stated grants.
   - Actual: `true` for REFERENCES and TRIGGER on both tables.
   - Data safety: TRIGGER lets a service-role caller add a trigger to the archive. Even then, the `EXISTS` guard and the invariant prevent loss (a discarded insert makes the batch raise). The fix above is verified on a scratch copy. After Dev applies it, QA asks for a re-run of the migration test (the M-5 pin changes) and of the PGlite pass (`scratchpad/pgcheck/qa-m1.mjs`, about 5 s).

#### Performance Issues (should fix)
None found.

#### Edge Cases (nice to fix)
1. X5: with an unknown run id, the batch fails on the FK rather than at the guard. The effect is the same (nothing changes); only the error text differs. No action.
2. Pre-existing and unrelated: `app/api/business-os/chat-v4/__tests__/route.audit.test.ts` crashes the Jest worker on this branch and on HEAD alike. It belongs with the known "Jest is not in CI / reds on main" item, not to this slice.
3. Already raised by SA (optimisations): `lastRun` is picked from the newest 20 runs of all sources (fine with one source); D-1 does not check the error text.

### Live checks owed to the user after the PROD apply (T-a14)

| # | When | Check | Pass if |
|---|---|---|---|
| M-a1 | Right after the apply | §5 step 3 access check | One row, all 7 `true` |
| M-a3 | Right after | §5 step 4 dry run, then "nothing kept" | Text starts `DRY RUN PASS` with D-1 to D-3; then `0, 0` |
| CR-1 | Right after | `SELECT has_table_privilege('service_role','public.archived_records','REFERENCES, TRIGGER'), has_table_privilege('service_role','public.archive_runs','REFERENCES, TRIGGER');` | Both `false` (confirms the CR-1 fix landed in what was pasted) |
| M-a4 | After 2a deploys | Open `/admin/archiving` as an admin | Archived total 0, "Archived before: None yet", "No runs yet", no console errors |
| M-a5 | After the apply | `npm run schema:check` against PROD | The new selects pass |
| M-a6 | After merge | `applyRetentionPolicy` grep on `main` | 0 |
| — | Any time | `SELECT count(*) FROM public.archive_runs;` | `0` (nothing started) |

### Test Outputs / Logs

```text
Test Suites: 18 passed, 18 total   Tests: 697 passed, 697 total      (brief set)
Test Suites: 111 passed, 111 total Tests: 2080 passed, 2080 total    (Dev's T-a12 set)
-- access [{"anon_no_archived_records":true,…,"function_is_invoker":true}]
-- svc privs (as written) REFERENCES rec=true runs=true; TRIGGER rec=true runs=true
-- svc privs (CR-1 fix)   REFERENCES rec=false runs=false; TRIGGER rec=false runs=false
-- nothing kept [{"runs_kept":0,"archived_kept":0}]
```

Restoration: QA backed up all 23 changed and untracked files with SHA-256 before starting. After every mutation, the file was restored from the backup and re-hashed. The final `sha256sum -c` passed on all 23 files. The workplan was re-baselined once because SA wrote its code review into it during QA. Apart from this section and its Change History row, QA changed nothing.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **CR-1 only** (Medium, verified fix). Everything else in 2a passes. Once CR-1 lands and the migration test and PGlite pass are re-run green, 2a is ready for commit and the PROD apply

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | Created | Slice 2 workplan against requirement §13.3 Slice 2, D-1 and C-1 to C-17. Draft M1 (tables, locked-down grants, the C-3-shaped INVOKER move function with a final run-state guard and a deleted = selected invariant), the run lifecycle (45 s budget, 5-minute takeover to `partial`, Continue on the stored cutoff), the POST route, page and audit design, both registries and the `applyRetentionPolicy` removal. Recommends splitting into 2a (M1 and the read side) and 2b (runs, POST, dialog, audit). Includes the user's PROD runbook with exact SQL (FR-15 pre-check, apply, AC-11 checks, a self-rolling-back dry run proving AC-5, AC-6 and AC-4, guarded rollback), the test plan, manual QA, doc updates and 14 open questions. No code written |
| 2026-09-26 | SA workplan review: APPROVED WITH CHANGES | M1 rulings: the final-UPDATE guard, the invariant, blocking `FOR UPDATE` and the grants are kept. **The `auth.users` FK is dropped** (R-1, supersedes C-11: SET NULL would hide archived personal data from erasure after account deletion). Runbook cut to 4 steps (5-row pre-check, 7-boolean access check, 3-check dry run with no DDL) plus a conditional rollback; mutation checks 12 → 4; migration pins trimmed; the header holds the single copy of the SQL. Q-1 to Q-14 answered; the 2a/2b split is confirmed with the GET and display in 2a; the CLAUDE.md count stays flagged for the user |
| 2026-09-26 | Dev: SA changes applied; T-a0 done; pre-check SQL delivered | **R-1:** `auth.users` FK removed from `archived_records` (§4.2), migration-level `lock_timeout` removed, P07 dropped, M-10 inverted, C-11 marked superseded (§11) with a requirement-note task (T-a2b). **R-2:** §5 rewritten to 4 steps + guarded rollback (5-row pre-check; access check of 7 booleans; dry run D-1 AC-5, D-2 drain/AC-4, D-3 re-run/AC-6, no DDL); the 10-row catalogue report, `SET ROLE` probe and D-2/D-3/D-5 of the draft removed; M-a2 dropped. **R-3:** mutation checks 12 → 4, Dev only (§8.8). **R-4:** M-9, M-12, M-13 dropped. **R-5:** the M1 header is the single SQL copy; the step 1 query lives in `ADMIN_ARCHIVING_SLICE_2_PRECHECK.sql` until T-a2 moves it into the header and deletes the file. **R-6:** "no `@` in logs" GET test dropped. **T-a0:** rebased onto `origin/main` `9d3b2a8b` (clean). **T-a1:** pre-check SQL written (one read-only `SELECT`, P01/P02/P03/P06/P09, PASS/STOP per row), verified on a local Postgres 16 (PGlite) against a clean fake table (5 PASS) and a broken one (5 STOP). Waiting on the user's output before M1 is written |
| 2026-09-26 | Pre-check PASS on PROD; Dev: Slice 2a Code Complete | User ran the pre-check on PROD: 5/5 PASS (recorded). T-a1 to T-a13 done: M1 written with the runbook in its header (pre-check file deleted), migration pins, purge + ownership registries, `applyRetentionPolicy` removed, repository read methods, GET extension, read-only page display, docs. `trigger_sync_audit_user_email` / `user_email` assessed: no effect on M1; erasure by `user_id` fine; the anonymise-then-archive gap recorded for Slice 3 / C-17. M1 exercised end-to-end on local PGlite (never on a real DB). 111 suites / 2,080 tests green, `next build` passes. Five deviations recorded |
| 2026-09-26 | SA code review of Slice 2a: APPROVED FOR QA WITH CONDITIONS | M1 statement order, INVOKER + empty `search_path`, client-role lockdown, RLS, final guard, invariant and no `auth.users` FK all verified; the runbook's dry run is self-rolling-back and the rollback refuses on archived rows. Registries (C-4, C-14), the `applyRetentionPolicy` removal (AC-17 re-grepped) and the read-only repository are correct; the GET's admin-label lookup leaks nothing. D-1 to D-5 approved. **CR-1 (Medium, before the PROD apply):** `REVOKE ALL` from `service_role` instead of the enumerated revokes, which leave it `REFERENCES`/`TRIGGER` (and `MAINTAIN` on PG 17). CR-2 (runbook wording) and CR-3 (record the `user_email` gap under C-17) are Low. `user_email` trigger finding correctly deferred to Slice 3. SA re-ran 11 suites / 323 tests: green |
| 2026-09-26 | QA of Slice 2a: PASS except CR-1 | 18 suites / 697 tests (brief set) and 111 / 2,080 (Dev's set) green. The `chat-v4` audit test crashes on HEAD too (pre-existing). 6 mutations (gate position, runs-enabled mirror, `EXISTS`, `status = 'running'`, `USER_OWNED_TABLES` entry, `isStale`) all caught. M1 runbook on PGlite: pre-check 5 PASS, apply, access 7/7, `DRY RUN PASS`, nothing kept 0/0, rollback drops or refuses correctly. 16 adversarial cases changed nothing. SA's CR-1 confirmed live (`service_role` keeps REFERENCES/TRIGGER), and its fix verified on a scratch copy. Live checks owed after the PROD apply are listed |
| 2026-09-26 | Dev: post-review fixes (CR-1, CR-2, CR-3) | CR-1: `REVOKE ALL … FROM … service_role` on both tables and the function, the two GRANTs kept, M-5/M-4 pins updated. CR-2: runbook headings prefixed `-- `, rollback wording, step 4 failure instruction, access check extended to nine booleans with the `service_role` REFERENCES/TRIGGER checks. CR-3: `user_email` gap recorded under C-17 for Slice 3. Two unused imports removed. Re-verified: migration test 21/21, 111 suites / 2,081 tests, QA's PGlite pass (all nine true, service_role exact), ESLint 0 errors, `next build` passes |
