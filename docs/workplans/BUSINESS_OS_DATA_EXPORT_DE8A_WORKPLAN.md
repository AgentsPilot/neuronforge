# Workplan: Business OS Data Export — DE-8a Export foundation (Phase 1 cut)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) §0.2 DX-4, §0.3.2 / §0.3.3, **§0.4.1 (binding over §0.3 for Phase 1)**, §0.4.1 H, §0.10 (DE-10a placement)
**Branch:** `feature/data-export-de8a` (worktree `neuronforge-de8a`, from `origin/main` `b160102d`, 2026-10-17; merged up to `origin/main` `fdaf90c1`, DE-7 PR #446, before any code: merge, not rebase)
**Date:** 2026-10-17
**Status:** SA code-approved + QA PASS 2026-10-17; committed by RM. SA workplan review: approved with C-1…C-11 (below); implementation record §12.1.
**Depends on:** DE-7 merged (DE-7 is uncommitted in worktree `neuronforge-de7`; it edits `descriptors.ts`, `classificationTypes.ts`, `limits.ts` and flips `PLANNED_TABLES_ALLOWED` to `false`). DE-8a code starts only after DE-7 is on `origin/main`, then this branch is rebased.

## Overview

DE-8a lays the database and data-layer ground for the Phase 1 "Download my data" zip. It ships **one jobs table** (`business_os_data_exports`), **one start function** that enforces "one at a time, three per rolling 24 hours" inside the database, the **private bucket** `business-data-exports` (50 MB), a **repository** for the table, the purge / ownership / export / test-account-cleanup **registrations**, the **audit event names**, and **`fflate`** as a direct dependency. It ships no route, no cron, no UI and no zip code: those are DE-8b (§0.4.1 B). Everything is applied to PROD by TL after deploy, with a pre-check, a checker (VERDICT), a probe and a rollback.

One finding changes the shape SA estimated: **adding a table with a foreign key to `auth.users`, a new purge descriptor and a new bucket forces a regenerated test-account cleanup function** (generator drift test + guard G-10). So DE-8a carries **two** hand-applied migrations, `20261074` (this slice) and `20261075` (generated cleanup), exactly as finance 4b.1 does with its `20261072` + `20261073` (§3.5).

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Implementation approach and key decisions](#2-implementation-approach-and-key-decisions)
3. [Migration design (20261074)](#3-migration-design-20261074)
4. [Bucket](#4-bucket)
5. [Repository](#5-repository)
6. [Registrations, audit events, dependency](#6-registrations-audit-events-dependency)
7. [Cron (DE-8b, not built here)](#7-cron-de-8b-not-built-here)
8. [Tests](#8-tests)
9. [Scripts for TL (pre-check, checker, probe, rollback)](#9-scripts-for-tl-pre-check-checker-probe-rollback)
10. [PROD apply plan](#10-prod-apply-plan)
11. [Files to create / modify](#11-files-to-create--modify)
12. [Task list](#12-task-list)
13. [Risks](#13-risks)
14. [Open questions for SA](#14-open-questions-for-sa)
15. [Business calls (plain terms, with defaults)](#15-business-calls-plain-terms-with-defaults)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. Analysis summary

### 1.1 What DE-8a owns, and what it does not (§0.4.1 B, verbatim split)

| In DE-8a | In DE-8b (not here) |
|---|---|
| Migration: jobs table only, partial unique index, start RPC (limit + stale-run rule), private bucket (50 MB) + `pg_policies` assertion | Start route `POST /api/business-os/data-exports`, download-again route |
| Repository (`new-repository`) | The zip builder (records + files, CSV injection, README, DX-10 name) |
| §0.3.3 registrations for the table and the bucket | Pre-flight and finished-size ceiling (§0.4.1 C) |
| Audit event **names** (no emitter) | Daily `/api/cron/data-export` (3-day sweep incl. orphans + 60% size watch) |
| `fflate` dependency | Storage upload / signed URL / remove / list helpers (Q-5) |
| Tests: 2nd concurrent start and 4th in 24 h refused; a 91 s old `running` row does not block | Everything behind `isBusinessOsDataExportEnabled` |

**Not in Phase 1 at all (§0.4.1 A / F):** parts table, claim / reap RPCs, leases, retries, drain, QStash, email, the in-app export page, "send export to owner".

### 1.2 What it touches

| Area | Touch |
|---|---|
| DB | New table `public.business_os_data_exports`, new function `public.business_os_data_export_start(uuid, uuid, text)`, new bucket row in `storage.buckets`. Regenerated `public.operator_test_account_cleanup(...)` (generated, §3.5) |
| Repositories | New `lib/repositories/BusinessOsDataExportJobRepository.ts` (+ types, index export, unit test) |
| Registries | `PURGE_DESCRIPTORS` (+1), `STORAGE_DESCRIPTORS` (+1), `PurgeArea` (+`'data_exports'`), `USER_OWNED_TABLES` (+1), classification baseline JSON, admin delete area label map, cleanup generator |
| Audit | `lib/audit/events.ts` (+6 names + metadata), `lib/audit/eventAudience.ts` (+6) |
| Package | `package.json` / `package-lock.json`: `fflate` as a direct dependency (already installed, §6.4) |
| Routes, crons, UI | **None** |

### 1.3 Facts measured for this plan (2026-10-17)

| # | Fact | Where | Result |
|---|---|---|---|
| V-1 | Highest migration on `origin/main` and on all 327 remote branches | `git ls-tree` over every `origin/*` | `20261071_website_images_bucket_lockdown.sql` |
| V-2 | Highest in any local worktree (`neuronforge-*`, `.claude/worktrees/*`) | `ls supabase/migrations` | `20261071` |
| V-3 | Numbers **reserved in workplans** but not yet files | grep over every worktree's docs | `20261072` reserved **twice** (finance-health 4b.1 *and* model-pricing slice 8: a collision, flagged to TL), `20261073` (finance 4b.1 cleanup regen). **`20261074` and `20261075` are mentioned nowhere** |
| V-4 | `fflate` in the tree | `package-lock.json` L10396 | **0.8.3**, one hoisted copy, MIT, no `dev: true`; required by `jspdf` (^0.8.1, a direct prod dependency), `pdfkit` (^0.8.3), `png-js` (^0.8.2). No source file imports it today |
| V-5 | Precedent RPC with an in-DB daily limit | `20261023_business_os_friend_invites.sql` | `SECURITY INVOKER`, `pg_advisory_xact_lock(hashtextextended('…:' || id, 0))`, count-then-insert under the lock, REVOKE from PUBLIC/anon/authenticated/service_role then GRANT EXECUTE to service_role |
| V-6 | Precedent private bucket + "no policy" assertion | `20260916a_purge_snapshots_bucket.sql` | `INSERT … storage.buckets` works from the SQL editor; `COMMENT ON storage.buckets` / `DROP POLICY` do **not** (42501, not owner). Assertion reads `pg_policies` |
| V-7 | Latest bucket migration style | `20261071_website_images_bucket_lockdown.sql` | `BEGIN; SET LOCAL lock_timeout = '5s'; …; DO $$ post-condition $$; COMMIT;` and variable assignment `x := (SELECT …)` |
| V-8 | Test-account cleanup reviews **every** FK to `auth.users` | `20261047_…audit_actor.sql` `fk_review`, guard **G-10** | An FK nobody classified → G-10 `BLOCKED` "A link to the login nobody has reviewed" for **every** account |
| V-9 | Cleanup SQL is generated from the descriptors and pinned | `scripts/__tests__/testAccountCleanupSql.test.ts` "drift: the committed SQL is what the generator writes" | A new descriptor or bucket fails the drift test until regenerated; a regenerated plan needs a **new dated function migration** (applied files are never edited) |
| V-10 | Cleanup chain head | `cleanupFunctionVersion.generated.ts` = `789e4758d674b561` (20261047). `20261047` is **not** in the test's `APPLIED` pins | TL confirms on PROD (pre-check Q9) before it can be `PREVIOUS` |
| V-11 | Reconciler on a descriptor whose table is not live | `SchemaReconciler.ts` L15 | `missingDeletable` → **blocks** purge / admin delete (R-8). A live table without a descriptor → `unclassified` → **blocks** too. Either order has a window (§10, R-1) |
| V-12 | SECDEF surface guard | `supabase/__tests__/security-definer-surface.guard.test.ts` | The phrase `SECURITY DEFINER` inside a DO body or string literal is finding F-2; any `.sql` outside the three migration dirs may not contain it (O-1). Checker / probe must test `prosecdef` without writing the phrase |
| V-13 | SQL editor "into" hazard | memory + cleanup test "SQL editor hygiene" | The word must not appear in comments or string literals. The SQL keyword in `INSERT INTO` / `RETURNING … INTO` is fine (20261023, 20261069 applied) |
| V-14 | `admin_users.user_id` | `20260701_create_admin_users.sql` | Nullable until the admin signs in (self-heals on first check). Relevant to Q-2 |
| V-15 | Deletion area labels | `app/admin/users/deletionCopy.ts` `DELETION_AREA_LABELS: Record<DeletionAreaView, string>`, `app/admin/users/types.ts` | A new `PurgeArea` needs one label line (tsc-forced) |
| V-16 | PGlite harness | finance 4b.1 workplan V-9 | `@electric-sql/pglite` 0.5.8 (Postgres 18.3, WASM) in an earlier session scratchpad. Local-only evidence, **not** a CI dependency |

---

## 2. Implementation approach and key decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **The start function is `SECURITY INVOKER`**, EXECUTE for `service_role` only, `SET search_path = pg_catalog, public, pg_temp`, every name schema-qualified. **This deviates from the §0.4.1 text ("SECURITY DEFINER") and needs an SA ruling (Q-1)** | Callable only by `service_role`, which already holds the table privileges and bypasses RLS, so DEFINER buys nothing. INVOKER fails closed: if a future grant ever reached `authenticated`, the body would run with `authenticated`'s rights, which have no table privileges at all. Same choice SA made for friend invites (20261023) and finance 4b.1 (SA-Q69). If SA wants DEFINER, the only change is the keyword plus the guard's R-a…R-d (already met by the REVOKE/GRANT lines) |
| D-2 | **Table is service-role only.** RLS enabled, **no policy**, table-level `REVOKE ALL … FROM PUBLIC, anon, authenticated` | No browser path needs it: the owner reads status through DE-8b/DE-9 routes, admins through DE-10a routes. DE-0b showed what Supabase default privileges hand to `anon`/`authenticated` on a new public table. A policy would be one more thing to keep right for no product gain (Q-4) |
| D-3 | **Limits are literals in the function**, mirrored by one TS constant that a test pins to the SQL (Q-10) | A parameter could be loosened by a caller bug. The literal is the rule; the TS mirror lets DE-8b show "next export possible at …" without a second source |
| D-4 | **Rolling 24 h window**, counting `running`, `ready`, `expired`; never `failed` | §0.3.2 "rolling 24 h"; §0.4.1 A "a failed job does not count" |
| D-5 | **Stale run = `running` and `created_at` older than 90 s**, turned into `failed` / `timeout` by the start function itself, under the same lock | §0.4.1 A: no reaper cron. Only `running`: a Phase 2 `queued` row is not dead after 90 s (Phase 2 replaces this rule with leases) |
| D-6 | **`requested_by` has no foreign key** (Q-2). `requested_by_kind` `owner`/`admin`; a CHECK forces `requested_by = user_id` when `owner` | An FK to `auth.users` would be a second, non-tenancy link the cleanup must classify as `actor` (G-10 counts other accounts naming the login). The admin identity is also in the audit row (`actor_id`). A deleted admin leaves an id that resolves to nobody, which is fine for a 3-day export |
| D-7 | **Rows are never deleted by the app.** `ready` → `expired` (object removed), kept as metadata until Purge / account deletion | "Last exported" (DE-9), admin status (DE-10a) and the 3-per-day count read the row. A row holds dates, counts and bytes, never content (business call B-1) |
| D-8 | **Storage helpers wait for DE-8b** (Q-5). DE-8a ships only the pure path builder `exportObjectPath(userId, jobId)` = `${userId}/${jobId}/1.zip` | Nothing writes to the bucket until DE-8b; the helpers are tested best with their writer. Keeps DE-8a near SA's ~1 d |
| D-9 | **Cleanup regenerated in this PR** as `20261075` (Q-3) | Forced by the drift test (V-9) and G-10 (V-8); same pattern as finance 4b.1 |
| D-10 | **`durable-queue-drain` is not used** | No queue, no claim, nothing drains. The start function is a synchronous one-request path whose only concurrency question (two clicks) is closed by a lock + unique index, not by a claim/lease. DE-8b's daily sweep is idempotent (guarded `ready → expired`, object removal is idempotent) and two overlapping runs are harmless, the same as `credit-leak-check` ("NOT A QUEUE DRAIN"). Only Step 8 (fail-closed `CRON_SECRET`) is borrowed, in DE-8b. Phase 2's drain will need the skill in full |
| D-11 | **No entitlements import.** The export is a data right, not a plan feature | `business-os-entitlements` therefore does not apply; `npm run test:bos-entitlements` is still run because its suite covers migrations, repositories, purge invariants, ownership and audit tests (§8.4) |

### 2.1 Tenant isolation — how it holds (tenant-isolation-guard)

1. **Who can call the function.** `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE … TO service_role`. A browser session (anon key or user JWT) gets 42501 from PostgREST; the checker and probe prove it on PROD.
2. **Where `p_user_id` comes from.** Only the server, through the repository on `supabaseServer`: DE-8b's owner route passes `user.id` from `supabase.auth.getUser()` (session), DE-10a's admin route passes the **path** id after `requireAdmin` (the `/api/admin/users/[id]/…` exception, SA-3). Never a body field, never a header. DE-8b/DE-10a route tests assert an injected body `userId` is ignored.
3. **What the function can touch.** It takes no job id. Every statement on the table filters `user_id = p_user_id`, and the only row it inserts carries `user_id = p_user_id`. So the function can reach another tenant only if the server hands it that tenant's id, which (2) rules out. The migration test pins "every `FROM`/`UPDATE public.business_os_data_exports` in the body is followed by `user_id = p_user_id`" (§8.1).
4. **Repository.** Every per-account method takes `(jobId, userId)` and filters `.eq('id', jobId).eq('user_id', userId)`. A job id from a URL is not a capability: a foreign id returns `null`, never another tenant's row. Write payloads are built field by field inside the repository (no spread of caller input). The only cross-account reads are the two sweep methods (§5.2, M-9 / M-11), documented as the cron exception; their effects are scoped by **the row's own** `user_id` (skill Step 6).
5. **No trigger, no upsert** on the table, so none of the "scope-defeating three" exist.

---

## 3. Migration design (20261074)

**File:** `supabase/migrations/20261074_business_os_data_exports.sql` — one transaction, pasted by TL in the SQL editor after deploy. Number re-checked by RM at PR time against `origin/main`, every remote branch and every worktree (V-1…V-3).

### 3.1 Shape of the file

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- (a) pre-guard DO block: refuse and apply nothing if the table, the function
--     or the bucket already exists, or if anon/authenticated may CREATE in
--     schema public (precedent 20261047).
-- (b) CREATE TABLE + constraints
-- (c) indexes
-- (d) RLS on, privileges
-- (e) CREATE FUNCTION + REVOKE / GRANT
-- (f) bucket row
-- (g) post-condition DO block (raises -> whole transaction rolls back)
NOTIFY pgrst, 'reload schema';
COMMIT;
```

### 3.2 Table

```sql
CREATE TABLE public.business_os_data_exports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_by        uuid        NOT NULL,          -- no FK, D-6
  requested_by_kind   text        NOT NULL,
  status              text        NOT NULL DEFAULT 'running',
  failure_reason      text        NULL,
  bytes               bigint      NULL,
  file_count          integer     NULL,
  row_count           integer     NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz NULL,
  ready_at            timestamptz NULL,
  expires_at          timestamptz NULL,
  expired_at          timestamptz NULL,
  owner_downloaded_at timestamptz NULL,              -- Q-7, for DE-10a's "owner has not downloaded"
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_os_data_exports_status_check
    CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  CONSTRAINT business_os_data_exports_kind_check
    CHECK (requested_by_kind IN ('owner', 'admin')),
  CONSTRAINT business_os_data_exports_owner_is_requester
    CHECK (requested_by_kind <> 'owner' OR requested_by = user_id),
  CONSTRAINT business_os_data_exports_failure_reason_check
    CHECK (failure_reason IS NULL OR failure_reason IN ('over_ceiling', 'timeout', 'error')),
  CONSTRAINT business_os_data_exports_failed_has_reason
    CHECK ((status = 'failed') = (failure_reason IS NOT NULL)),
  CONSTRAINT business_os_data_exports_finished_shape
    CHECK ((status IN ('queued', 'running')) = (finished_at IS NULL)),
  CONSTRAINT business_os_data_exports_ready_shape
    CHECK ((status IN ('ready', 'expired')) = (ready_at IS NOT NULL)),
  CONSTRAINT business_os_data_exports_expiry_shape
    CHECK ((ready_at IS NULL AND expires_at IS NULL) OR expires_at = ready_at + interval '3 days'),
  CONSTRAINT business_os_data_exports_expired_shape
    CHECK ((status = 'expired') = (expired_at IS NOT NULL)),
  CONSTRAINT business_os_data_exports_download_shape
    CHECK (owner_downloaded_at IS NULL OR ready_at IS NOT NULL),
  CONSTRAINT business_os_data_exports_counts_check
    CHECK ((bytes IS NULL OR bytes >= 0) AND (file_count IS NULL OR file_count >= 0) AND (row_count IS NULL OR row_count >= 0))
);
```

- `queued` is in the CHECK now so Phase 2 does not alter it (§0.4.1 A); Phase 1 never writes it.
- `part_no` is not a column: Phase 1 writes one part, always `1`, and the path already has the Phase 2 shape (`{user_id}/{job_id}/1.zip`). Phase 2's parts table hangs off `id`.
- No `updated_at` trigger (the repository sets it): a trigger on a table the cleanup empties is guard G-17's business, and none is needed.
- No business name, file name or email in any column (§0.4.1 E "Never").

### 3.3 Indexes

| Index | Definition | Serves |
|---|---|---|
| `business_os_data_exports_one_in_progress` | `UNIQUE (user_id) WHERE status IN ('queued', 'running')` | **One at a time**, the hard guarantee even if the lock were missing (SQ-E8) |
| `business_os_data_exports_user_created` | `(user_id, created_at DESC)` | The 24 h count, "latest export", admin status list |
| `business_os_data_exports_ready_expiry` | `(expires_at) WHERE status = 'ready'` | DE-8b's daily sweep |

### 3.4 RLS and privileges

```sql
ALTER TABLE public.business_os_data_exports ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY: service role only (D-2).
REVOKE ALL ON TABLE public.business_os_data_exports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_data_exports TO service_role;
```

`DELETE` is for the purge engine and the test-account cleanup (both service role); the app itself never deletes rows (D-7).

### 3.5 The start function — exact semantics

```sql
CREATE FUNCTION public.business_os_data_export_start(
  p_user_id uuid, p_requested_by uuid, p_requested_by_kind text)
RETURNS TABLE (result_outcome text, result_job_id uuid, result_retry_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER                               -- Q-1
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_in_progress_since timestamptz;
  v_third_newest      timestamptz;
  v_job_id            uuid;
BEGIN
  -- 1. Guard every input (programmer errors raise; they are never a user outcome).
  IF p_user_id IS NULL OR p_requested_by IS NULL OR p_requested_by_kind IS NULL
     OR p_requested_by_kind NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'data export start: invalid arguments';
  END IF;
  IF p_requested_by_kind = 'owner' AND p_requested_by <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'data export start: an owner export must be requested by the owner';
  END IF;

  -- 2. Serialise every start for this account (two clicks, owner + admin at once).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('business_os_data_export:' || p_user_id::text, 0));

  -- 3. Stale-run rule: a running row older than 90 s belongs to a killed function.
  UPDATE public.business_os_data_exports AS job
     SET status = 'failed', failure_reason = 'timeout', finished_at = now(), updated_at = now()
   WHERE job.user_id = p_user_id
     AND job.status = 'running'
     AND job.created_at < now() - interval '90 seconds';

  -- 4. One at a time.
  v_in_progress_since := (
    SELECT min(job.created_at) FROM public.business_os_data_exports AS job
     WHERE job.user_id = p_user_id AND job.status IN ('queued', 'running'));
  IF v_in_progress_since IS NOT NULL THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, v_in_progress_since + interval '90 seconds';
    RETURN;
  END IF;

  -- 5. Three per rolling 24 h; failed exports do not count; admin-started ones do.
  v_third_newest := (
    SELECT job.created_at FROM public.business_os_data_exports AS job
     WHERE job.user_id = p_user_id
       AND job.status IN ('running', 'ready', 'expired')
       AND job.created_at > now() - interval '24 hours'
     ORDER BY job.created_at DESC
     OFFSET 2 LIMIT 1);
  IF v_third_newest IS NOT NULL THEN
    RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, v_third_newest + interval '24 hours';
    RETURN;
  END IF;

  -- 6. Start. The unique index is the backstop if step 2 were ever removed.
  BEGIN
    INSERT INTO public.business_os_data_exports AS new_job (user_id, requested_by, requested_by_kind, status)
    VALUES (p_user_id, p_requested_by, p_requested_by_kind, 'running')
    RETURNING new_job.id INTO v_job_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, now() + interval '90 seconds';
    RETURN;
  END;

  RETURN QUERY SELECT 'started'::text, v_job_id, NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_data_export_start(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.business_os_data_export_start(uuid, uuid, text) TO service_role;
```

| Outcome | When | `result_retry_at` | DE-8b maps to |
|---|---|---|---|
| `started` | No live run, fewer than 3 counted in 24 h | NULL | proceeds, `result_job_id` is the new row |
| `in_progress` | A `running` (or Phase 2 `queued`) row younger than 90 s | when that row turns stale (its `created_at` + 90 s) | 409 "an export is already being prepared" |
| `daily_limit` | 3 counted rows in the last 24 h | the 3rd newest counted row's `created_at` + 24 h, i.e. the moment the count drops to 2 | 409 with the time the next export is allowed (§0.3.2) |
| raises 22023 | NULL / unknown kind / owner kind with a different requester | — | 500 (a server bug, never user input) |
| raises 23503 | `p_user_id` is not an auth user (FK) | — | 500 |

Notes:
- `now()` is the transaction start; PostgREST runs each RPC in its own transaction, so the time is consistent inside one call.
- Boundaries: a row exactly 90 s old is still live (`<`), one exactly 24 h old no longer counts (`>`). The probe tests 89 s / 91 s and 23 h 59 m / 24 h 1 s.
- `failed` rows never count, so an account above the Phase 1 ceiling can retry as often as it likes, one at a time. Each such attempt ends at the cheap pre-flight (§0.4.1 C). DE-8b also puts the route behind the existing request throttle (`lib/security/rateLimit.ts`) so a loop of failures cannot hammer the builder (R-6).

### 3.6 Cleanup regeneration (20261075, generated)

`npx tsx scripts/generate-test-account-cleanup-sql.ts` after these generator edits (precedent: finance 4b.1 §8.6):

| Generator change | Effect |
|---|---|
| History comment + `FUNCTION_MIGRATION = '20261075_operator_test_account_cleanup_data_exports'` | New dated function file |
| `PREVIOUS_FUNCTION_MIGRATION` = the head on `origin/main` at write time: `20261047_…audit_actor`, **or** `20261073_…boost_reversal_events` if finance 4b.1 merged first | Rollback restores the previous function byte for byte |
| `APPLIED` pins in `testAccountCleanupSql.test.ts` gain `20261047` (and its rollback) with their sha256, **after TL confirms on PROD** that the live function returns stamp `789e4758d674b561` (pre-check Q9) | "never edited once applied" holds |
| Nothing else by hand | The table enters the plan from its descriptor (step A, `user_id`), its `user_id` FK becomes `tenancy` in `fk_review` automatically (`tenancyForeignKeys()`), and the bucket joins the G-12 and storage lists from `STORAGE_DESCRIPTORS` |
| `FUNCTION_REQUIRED_TABLES` | **Not** extended if the table is reached only through the generated dynamic `format('%I')` SQL (to be confirmed when generating; if the generator emits static SQL naming it, add `{ table: 'business_os_data_exports', migration: '20261074_business_os_data_exports' }` so `20261075` refuses until `20261074` is applied) |

Outputs (all generated, never hand-edited): `supabase/migrations/20261075_operator_test_account_cleanup_data_exports.sql`, `supabase/SQL Scripts/20261075_operator_test_account_cleanup_data_exports_rollback.sql`, `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql`, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` (new stamp).

### 3.7 Post-condition DO block (inside 20261074)

Raises, and so rolls the whole file back, unless all of these hold. It never writes the phrase that the SECDEF guard treats as finding F-2; it reads `pg_proc.prosecdef`.

1. Table exists; `relrowsecurity` true; zero rows in `pg_policies` for it.
2. For `anon`, `authenticated` and PUBLIC: no table privilege of the 7 (`has_table_privilege`) and no column privilege (`has_any_column_privilege`) for SELECT / INSERT / UPDATE / REFERENCES.
3. `service_role` has SELECT, INSERT, UPDATE, DELETE.
4. The partial unique index exists and its `indexdef` carries `WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]))`.
5. Function exists; `prosecdef` is false (true if SA rules DEFINER); `proconfig` holds `search_path=pg_catalog, public, pg_temp`; `has_function_privilege` EXECUTE false for `anon` and `authenticated`, true for `service_role`; no PUBLIC entry in `proacl`.
6. Bucket row: `public = false`, `file_size_limit = 52428800`, `allowed_mime_types = ARRAY['application/zip']`.
7. No `pg_policies` row on `storage.objects` whose `qual || with_check` mentions `business-data-exports` (AC-36 pattern).
8. No trigger on the table; exactly one FK, `user_id → auth.users ON DELETE CASCADE`.

---

## 4. Bucket

| Property | Value | Source |
|---|---|---|
| id / name | `business-data-exports` | §0.3.2 SQ-A4 |
| `public` | `false` | §0.3.2 |
| `file_size_limit` | `52428800` (50 MB) | §0.4.1 A (Phase 2 raises it to 250 MB) |
| `allowed_mime_types` | `{application/zip}` | §0.3.2 |
| Policies | **None** for any role on any verb; asserted, not dropped (V-6) | §0.3.2, 20260916a |
| Path | `{user_id}/{job_id}/1.zip`, built only by `exportObjectPath(userId, jobId)` from two validated uuids | §0.4.1 A / E (never the business name) |
| Signed URLs | 120 s owner, 60 s admin, minted by DE-8b / DE-10a routes only | §0.4.1 A, §0.3.4 |
| Retention | 3 days; enforcer = DE-8b's daily cron (sweep + orphans). **Nothing writes to the bucket before DE-8b** | §0.4.1 A, Q-6 |

Inserted with a plain `INSERT … storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (…)` without `ON CONFLICT`: the pre-guard has already refused if it exists, so a pre-existing bucket with other settings can never be silently kept. **The global upload limit check is not needed for Phase 1** (§0.4.1 A: 50 MB equals the Supabase default); pre-check Q4 still reads the other buckets' limits so TL sees nothing is below it.

---

## 5. Repository

**File:** `lib/repositories/BusinessOsDataExportJobRepository.ts`, following `new-repository`: `SupabaseClient` injected (default `supabaseServer`, documented: service-role table, D-2), `createLogger({ service: 'BusinessOsDataExportJobRepository' })`, `{ data, error }` results (never throws), explicit column constant (no `select('*')`), singleton, types in `lib/repositories/types.ts`, exported from `index.ts`. Not a soft-delete table: no `softDelete` and no `delete` method (D-7).

### 5.1 Types

```typescript
export type DataExportJobStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';
export type DataExportFailureReason = 'over_ceiling' | 'timeout' | 'error';
export type DataExportRequesterKind = 'owner' | 'admin';

export interface DataExportJob {
  id: string; user_id: string; requested_by: string; requested_by_kind: DataExportRequesterKind;
  status: DataExportJobStatus; failure_reason: DataExportFailureReason | null;
  bytes: number | null; file_count: number | null; row_count: number | null;
  created_at: string; finished_at: string | null; ready_at: string | null;
  expires_at: string | null; expired_at: string | null; owner_downloaded_at: string | null;
  updated_at: string;
}

export type DataExportStartOutcome =
  | { outcome: 'started'; jobId: string }
  | { outcome: 'in_progress'; retryAt: string }
  | { outcome: 'daily_limit'; retryAt: string };
```

### 5.2 Methods (exact semantics)

Inputs are validated with Zod inside the repository (uuids, enums, non-negative integers). Invalid input returns `{ data: null, error }` **without a DB call**. Logs carry ids, counts, bytes and durations only (§0.3.2 Logs).

| # | Method | Query | Returns |
|---|---|---|---|
| M-1 | `start({ userId, requestedBy, requestedByKind })` | `rpc('business_os_data_export_start', { p_user_id, p_requested_by, p_requested_by_kind })`; first row parsed with Zod; an unknown outcome or a missing `result_job_id` on `started` is an error | `DataExportStartOutcome` |
| M-2 | `findById(jobId, userId)` | `.eq('id').eq('user_id').maybeSingle()` | job or `null` (foreign id = `null`) |
| M-3 | `findLatestForUser(userId)` | `.eq('user_id').order('created_at', desc).limit(1)` | job or `null` |
| M-4 | `listForUser(userId, { limit })` | same order, `limit` 1…20 (default 10) | jobs |
| M-5 | `markReady(jobId, userId, { bytes, fileCount, rowCount })` | `update({ status:'ready', bytes, file_count, row_count, finished_at, ready_at, expires_at: ready_at + 3 d, updated_at })` `.eq('id').eq('user_id').eq('status','running')` `.select(COLUMNS).maybeSingle()`; one `Date` gives all three times so the expiry CHECK holds | updated job, or `null` when the row was no longer `running` (the stale rule took it: DE-8b then removes the object it uploaded) |
| M-6 | `markFailed(jobId, userId, reason, counts?)` | `update({ status:'failed', failure_reason, finished_at, …counts })`, same three filters | updated job or `null` |
| M-7 | `markOwnerDownloaded(jobId, userId)` | `update({ owner_downloaded_at: now })` `.eq('id').eq('user_id').eq('status','ready').is('owner_downloaded_at', null)` | `true` if first download recorded, `false` otherwise |
| M-8 | `expireOtherReady(userId, keepJobId)` | `update({ status:'expired', expired_at, updated_at })` `.eq('user_id').eq('status','ready').neq('id', keepJobId)` `.select('id')` | ids now expired; DE-8b removes their objects ("a newer export replaces the old one", §0.4.1 A) |
| M-9 | `listDueForExpiry(now, limit)` — **cross-account, cron only** | `.eq('status','ready').lte('expires_at', now).order('expires_at').limit(≤500)`, columns `id, user_id` | `{ id, user_id }[]` |
| M-10 | `markExpired(jobId, userId)` | `update(expired)` `.eq('id').eq('user_id').eq('status','ready')` | `true` / `false` (idempotent) |
| M-11 | `findJobsByIds(jobIds)` — **cross-account, cron only** | `.in('id', chunk ≤ 100)` columns `id, user_id, status` | rows; DE-8b's orphan sweep treats an object as orphaned unless a row exists **with the same `user_id` as the object's folder** and status `running` / `ready` |

None of the update calls combines `.or()` with `.select()` (the PostgREST 42703 bug, memory). M-9 and M-11 carry the comment `// Cross-account by design: the daily sweep has no user context; every effect it takes is scoped by the row's own user_id (tenant-isolation-guard Step 6).` and take no caller-supplied input other than ids parsed from our own bucket listing.

### 5.3 Pure policy constants

**File:** `lib/business-os/data-export/jobPolicy.ts` (pure, no imports):

```typescript
export const EXPORT_JOB_POLICY = {
  BUCKET: 'business-data-exports',
  BUCKET_FILE_SIZE_LIMIT_BYTES: 52_428_800,
  DAILY_LIMIT: 3,
  DAILY_WINDOW_HOURS: 24,
  STALE_RUNNING_SECONDS: 90,
  RETENTION_DAYS: 3,
  OWNER_SIGNED_URL_TTL_SECONDS: 120,
  ADMIN_SIGNED_URL_TTL_SECONDS: 60,
} as const;
export const exportObjectPath = (userId: string, jobId: string): string => `${userId}/${jobId}/1.zip`;
```

`exportObjectPath` throws on a non-uuid argument (it is the only path builder; a `../` can never reach Storage). The Phase 1 size ceilings (§0.4.1 C) stay for DE-8b in `limits.ts`, next to `ROW_CEILING`.

---

## 6. Registrations, audit events, dependency

### 6.1 Purge / ownership / export (§0.3.3, table and bucket only — no parts table in Phase 1)

| Registry | Entry |
|---|---|
| `PURGE_DESCRIPTORS` (`descriptors.ts`, `IN_SCOPE`) | `{ table: 'business_os_data_exports', level: 'purge', area: 'data_exports', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'ids', export: exclude(EXPORT_REASON.EXPORT_ITSELF), notes: … }`. `snapshot: 'ids'` because the snapshot must not copy another copy of the business (§0.3.3). LEAF: its only FK is to `auth.users`, no inbound FK, no trigger |
| `EXPORT_REASON` | new `EXPORT_ITSELF: 'the export itself: a short-lived copy of this account\'s data'` |
| `STORAGE_DESCRIPTORS` | `{ bucket: 'business-data-exports', level: 'purge', pathPrefix: '{user_id}/', purpose: 'Phase 1 "Download my data" zips, kept 3 days. Private, no policy (AC-36 pattern).', export: { kind: 'exclude', reason: EXPORT_REASON.EXPORT_ITSELF } }`. So an admin delete commit removes the account's exports at once (§0.3.3) |
| `PurgeArea` (`types.ts`) | `+ 'data_exports'` (closed union, D-5). Plus `DeletionAreaView` and `DELETION_AREA_LABELS` in `app/admin/users/` gain `data_exports: 'Data exports'` (a label line tsc forces, not a UI change; Q-11) |
| `USER_OWNED_TABLES` | `business_os_data_exports: 'An export request belongs to the person; it survives a Reset (an owner may export, then start over); Purge and account deletion remove it. Not business-owned: an agent-platform user with no business_profiles row can export too.'` (§0.3.3) |
| `classification-baseline.json` | `count` + 1, `levels.business_os_data_exports = 'purge'`, a dated note (precedent finance 4b.1) |
| `accountDeletionPolicy.ts` | **No change.** It is `@deprecated` (purge slice 3a) and its default verdict for a `USER_OWNED_TABLES` entry not in its exceptions is `delete`, which is §0.3.3's ruling. Its test is run to confirm |
| Export classification (`exportClassification.test.ts`) | Covered by the two `exclude` entries; `PLANNED_TABLES_ALLOWED` is already `false` after DE-7, so `exclude` is the only legal choice. `PLANNED_FILES_ALLOWED` stays DE-8b's to flip |

### 6.2 Audit event names (no emitter in DE-8a)

| Event | Severity | Flags | Audience | Emitted by (later) |
|---|---|---|---|---|
| `DATA_EXPORT_REQUESTED` | info | GDPR, SOC2 | shared | DE-8b (owner), DE-10a (admin as actor) |
| `DATA_EXPORT_READY` | **critical** (same as `DATA_EXPORTED`, which it replaces in DE-9) | GDPR, SOC2 | shared | DE-8b |
| `DATA_EXPORT_FAILED` | warning | GDPR | shared | DE-8b |
| `DATA_EXPORT_DOWNLOADED` | info | GDPR | shared | DE-8b |
| `DATA_EXPORT_EXPIRED` | info | GDPR | shared | DE-8b cron |
| `DATA_EXPORT_DOWNLOADED_BY_ADMIN` | **critical** (B-2) | GDPR, SOC2 | shared | DE-10a, write-ahead `writeNow` |

`entityType: 'user'`, `entityId` = the account, `details.job_id`; no new entity type. Severities are SA's call (Q-9); the admin one is also business call B-2. `eventAudience.test.ts` and `filterOptions.test.ts` cover the new names.

### 6.3 Measure script

`scripts/measure-data-export-size.sql` from the §0.3.7 M-1 text (owed to "DE-8a's workplan"), plus one line for the new bucket. Read-only, starts with `SET default_transaction_read_only = on;`, no "into". It is what the user re-runs when the daily 60 % watch fires (Phase 2 decision).

### 6.4 `fflate`

Already installed (V-4): `fflate@0.8.3`, one hoisted copy, pulled in by `jspdf` (direct prod dependency), `pdfkit`, `png-js`. Making it direct = `npm install fflate@0.8.3 --save-exact`: one line in `package.json` `dependencies` and one in `package-lock.json` `packages[""].dependencies`; the `node_modules/fflate` lock entry (version, integrity) does not change, so **no new code enters the install** and `npm ci` time does not move. It is pinned exactly so a later `jspdf` bump cannot move the zip library under us. Rule-7 approval is §0.3.2 SQ-A4 / §0.4.1 A (`fflate` only). Nothing imports it until DE-8b; no unused-dependency check exists in the repo (`knip` / `depcheck` absent).

---

## 7. Cron (DE-8b, not built here)

§0.4.1 B puts the daily `/api/cron/data-export` (sweep + size watch) in DE-8b. DE-8a **does not** touch `vercel.json`. What DE-8a gives it: M-8…M-11, `EXPORT_JOB_POLICY`, the bucket. For the record, DE-8b's route will copy `credit-leak-check`: `runtime = 'nodejs'`, fail-closed `CRON_SECRET` (`durable-queue-drain` Step 8), `withCronRunRecord`, counts-only logs, a slot that clashes with no existing job (e.g. `25 5 * * *`).

The SA-4 lesson ("one enforcer, shipped with the bucket") holds because **the writer and the enforcer ship in the same PR (DE-8b)**; DE-8a's bucket stays empty. If SA prefers the enforcer to land with the bucket, the cron moves here for about +0.5 d (Q-6). DE-8b must also mark long-dead `running` rows of owners who never retried (Q-12), so DE-10a's status line never shows an old "in progress".

---

## 8. Tests

All new tests are Jest file scans or mocked-client unit tests that run in the existing Tests job in milliseconds: **no added critical-path CI time**, no DB in CI.

### 8.1 Migration test — `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts`

Precedent: `plugin-connections-token-column-lockdown.migration.test.ts` (DE-0b). Reads the migration, checker, pre-check, probe and rollback (LF-normalised) and asserts:

| # | Assertion |
|---|---|
| MT-1 | One `BEGIN`…`COMMIT`, `SET LOCAL lock_timeout`, `NOTIFY pgrst, 'reload schema'` last before `COMMIT` |
| MT-2 | The table's column list and types are exactly §3.2; `requested_by` has **no** `REFERENCES`; exactly one FK (`user_id → auth.users ON DELETE CASCADE`) |
| MT-3 | Status CHECK lists exactly `queued, running, ready, failed, expired`; reason CHECK exactly `over_ceiling, timeout, error`; kind CHECK `owner, admin`; the owner-is-requester CHECK |
| MT-4 | The partial unique index on `(user_id)` with predicate exactly `status IN ('queued', 'running')` |
| MT-5 | `ENABLE ROW LEVEL SECURITY`; no `CREATE POLICY` anywhere; `REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated`; **no** `GRANT` to `anon` / `authenticated` / `PUBLIC` anywhere in the file |
| MT-6 | Function: `SECURITY INVOKER` (or DEFINER per Q-1), `SET search_path = pg_catalog, public, pg_temp`; REVOKE from PUBLIC, anon, authenticated, service_role **after** the CREATE, then GRANT EXECUTE to `service_role` only |
| MT-7 | The advisory lock is the first statement after the input guards and before any table statement |
| MT-8 | Stale rule: `status = 'running'` (not `queued`) and `interval '90 seconds'` with `<` |
| MT-9 | Daily count: statuses exactly `('running', 'ready', 'expired')` — **`failed` absent** —, `interval '24 hours'` with `>`, `OFFSET 2 LIMIT 1` |
| MT-10 | Tenant scope: every `FROM public.business_os_data_exports` / `UPDATE public.business_os_data_exports` in the body is followed (same statement) by `user_id = p_user_id`; the INSERT names `p_user_id` |
| MT-11 | The literals 3, 24, 90, 3 days, 52428800, `business-data-exports` equal `EXPORT_JOB_POLICY` (D-3) |
| MT-12 | Bucket INSERT: `false`, `52428800`, `ARRAY['application/zip']`; no `ON CONFLICT`; no `COMMENT ON` / `DROP POLICY` on storage (V-6); the `pg_policies` assertion names the bucket |
| MT-13 | Post-condition DO block present and covers §3.7 items 1–8 |
| MT-14 | Editor hygiene: no "into" in any comment or string literal (the `INSERT INTO` / `RETURNING … INTO` keywords excepted, counted exactly); the SECDEF phrase never inside a DO body or literal (V-12) |
| MT-15 | Companion files exist; pre-check and checker start with `SET default_transaction_read_only = on;`; checker ends in a `VERDICT` row; probe ends by raising (rollback); rollback drops the function before the table and refuses while the bucket holds objects |
| MT-NC | **Negative controls** (the detectors can fail): a planted copy with `'failed'` in the counted list fails MT-9; one with a statement missing `user_id = p_user_id` fails MT-10; one with `GRANT SELECT … TO authenticated` fails MT-5; one with `status IN ('queued','running')` in the stale rule fails MT-8; one with `ON CONFLICT DO NOTHING` on the bucket fails MT-12 |

### 8.2 Repository test — `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts`

Mocked `SupabaseClient` injected through the constructor; one block per method (M-1…M-11):

- **M-1** maps each RPC outcome; passes exactly `{ p_user_id, p_requested_by, p_requested_by_kind }`; an unknown outcome, an empty result or `started` without a job id → `error`; an RPC error → `error`, never throws. Invalid uuid / kind → error and **the RPC is never called**.
- **M-2…M-4** every query carries `.eq('user_id', userId)`; a foreign job id → `null` (the PGRST116 path too); explicit columns, never `*`.
- **M-5 / M-6** filters `id`, `user_id`, `status = 'running'`; `expires_at − ready_at` is exactly 3 days; a row no longer running → `null`; the payload holds only the allow-listed keys (no `user_id`, `id` or `status` from the caller).
- **M-7 / M-10** idempotent (`false` the second time).
- **M-8** never expires `keepJobId`; scoped by `user_id`.
- **M-9 / M-11** chunking (≤ 100 ids), limit ≤ 500; the cross-account comment is present (source scan).
- **Tenant-isolation negative control:** with the mock returning nothing for `(foreignJobId, myUserId)`, `markReady` / `markFailed` / `markOwnerDownloaded` do not report success.

### 8.3 Concurrency and rate-limit evidence

| Claim | Evidence | Where |
|---|---|---|
| A 2nd start while one runs is refused | Probe P2 (same transaction) + MT-4 (unique index) + MT-7 (lock) | PROD probe, Jest |
| A 4th start in 24 h is refused, with the right retry time | Probe P4 | PROD probe |
| A 91 s old `running` row does not block; an 89 s one does | Probe P5 / P6 | PROD probe |
| A failed export does not count; an expired one does; an admin-started one does | Probe P7 / P8 / P9 | PROD probe |
| 24 h boundary | Probe P10 (23 h 59 m counts, 24 h 1 s does not) | PROD probe |
| Browser roles cannot read the table or call the function | Probe P12 / P13 (`authenticated`, `anon` → 42501) + checker | PROD probe |
| Two **simultaneous** sessions | **Cannot be shown in one SQL-editor transaction** (same limit as the boost probe P16). Covered by the structure: the per-account advisory lock serialises the count-then-insert, and the unique index rejects a second `running` row at insert even without the lock (caught → `in_progress`). MT-4 / MT-7 pin both lines. Q-8 asks SA to accept this | Jest + reasoning |
| Same scenarios before the PR | Local PGlite run (V-16): the migration with stubbed `auth.users`, `storage.buckets` and the three roles, then the probe body. Recorded in this workplan as Dev evidence, **not** a CI job | Local only |

### 8.4 Existing suites that must stay green

`businessOwnedTables.test.ts` (migration CREATE TABLE with `user_id` → registered), `descriptors.invariant.test.ts` (area, baseline, storage descriptors), `exportClassification.test.ts`, `SchemaReconciler.test.ts`, `scripts/__tests__/testAccountCleanupSql.test.ts` (drift after regeneration, applied pins, editor hygiene), `security-definer-surface.guard.test.ts`, `accountDeletionPolicy.test.ts`, `eventAudience.test.ts`, `filterOptions.test.ts`, `app/admin/users/__tests__`. Commands before hand-over: `npm test -- <the above + new files>`, `npm run test:bos-entitlements` (CLAUDE.md skill rule; it runs most of the above), `npx tsc --noEmit -p .` on the touched files, `npm run lint`.

### 8.5 After apply (PROD)

Checker VERDICT PASS, probe PASS, `npm run schema:reconcile` shows 0 unclassified and 0 missing for the new table (TL runs it read-only).

---

## 9. Scripts for TL (pre-check, checker, probe, rollback)

| File | Kind | Content |
|---|---|---|
| `scripts/precheck-business-os-data-exports.sql` | read-only | §9.1 below |
| `scripts/check-business-os-data-exports.sql` | read-only | One result set, one row per §3.7 item plus the cleanup stamp, `PASS`/`FAIL`, then `VERDICT PASS n/0`. Before apply it reports FAIL rows (table missing), after apply PASS (both states, as DE-0b) |
| `scripts/probe-business-os-data-exports.sql` | writes, **always rolled back** | One `DO $probe$` block (precedent `probe-bos-boost-purchases-migration.sql`): TL pastes their own user id; refuses on a read-only session or an unknown id; runs P1…P14; ends with `RAISE EXCEPTION 'PROBE PASS … this error is expected and rolls everything back'` |
| `scripts/rollback-business-os-data-exports.sql` | writes | Refuses if `storage.objects` holds any object in the bucket ("empty it in the Storage dashboard first"); drops the function, then the table. The bucket row is left (Supabase refuses direct deletes on storage tables); the rollback prints "delete the empty bucket in the Storage dashboard". Run **after** `20261075`'s generated rollback |

Probe steps (backdated rows are inserted directly as the SQL-editor role):

| # | Step | Expect |
|---|---|---|
| P1 | start (owner) | `started`, one `running` row, kind `owner` |
| P2 | start again | `in_progress`, retry = P1 `created_at` + 90 s, still one row |
| P3 | mark P1 ready; start; mark ready | `started` (2nd counted) |
| P4 | start; mark ready; start | 3rd `started`, then `daily_limit`, retry = 3rd newest + 24 h |
| P5 | (fresh state) insert `running` aged 91 s; start | `started`; the old row is now `failed` / `timeout` |
| P6 | insert `running` aged 89 s; start | `in_progress` |
| P7 | three `failed` rows in the last hour; start | `started` (failed never counts) |
| P8 | three `expired` rows in the last hour; start | `daily_limit` |
| P9 | two owner rows + one start with kind `admin`; start (owner) | admin start `started`, then owner `daily_limit` |
| P10 | `ready` rows aged 24 h 1 s (×3) then 23 h 59 m (×3) | first set: `started`; second: `daily_limit` |
| P11 | NULL user / kind `bogus` / owner kind with another requester | each raises 22023 |
| P12 | as `authenticated` (jwt claims of the pasted id): select the table; call the function | 42501 both |
| P13 | as `anon`: same | 42501 both |
| P14 | INFO: two simultaneous sessions cannot be shown here; pinned by the migration test | INFO |

Each scenario starts from a clean slate by deleting the probe's own rows for the pasted id (inside the rolled-back transaction), so earlier steps cannot leak.

### 9.1 Pre-check SQL (TL runs first, read-only, before Dev writes the migration)

**File:** `scripts/precheck-business-os-data-exports.sql`

```sql
SET default_transaction_read_only = on;

-- Q1. Names this slice will create must not exist yet.
SELECT 'table' AS kind, pg_catalog.to_regclass('public.business_os_data_exports')::text AS found
UNION ALL
SELECT 'function', pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)')::text
UNION ALL
SELECT 'bucket', (SELECT b.id FROM storage.buckets AS b WHERE b.id = 'business-data-exports');

-- Q2. Similar tables already on the database (anything named like an export or a job queue).
SELECT t.table_schema, t.table_name
FROM information_schema.tables AS t
WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND (t.table_name ILIKE '%export%' OR t.table_name ILIKE '%_jobs' OR t.table_name ILIKE '%queue%')
ORDER BY 1, 2;

-- Q3. Functions with a similar name.
SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE p.proname ILIKE '%data_export%'
ORDER BY 1, 2;

-- Q4. Every bucket and its limits (the new one must not exceed what the others show is allowed).
SELECT b.id, b.public, b.file_size_limit, b.allowed_mime_types, b.created_at
FROM storage.buckets AS b
ORDER BY b.id;

-- Q5. Any storage policy that already names the new bucket (must be 0 rows).
SELECT pol.policyname, pol.cmd, pol.roles
FROM pg_catalog.pg_policies AS pol
WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
  AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) LIKE '%business-data-exports%';

-- Q6. Objects already stored under that bucket id (must be 0).
SELECT count(*) AS objects_in_new_bucket
FROM storage.objects AS o
WHERE o.bucket_id = 'business-data-exports';

-- Q7. Default privileges a new public table or function receives (explains the explicit REVOKEs).
SELECT d.defaclrole::regrole AS owner_role, d.defaclnamespace::regnamespace AS schema_name,
       d.defaclobjtype AS object_type, d.defaclacl
FROM pg_catalog.pg_default_acl AS d
ORDER BY 1, 2, 3;

-- Q8. May anon or authenticated create objects in schema public? (must be false, false)
SELECT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AS anon_can_create,
       pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_can_create;

-- Q9. Which test-account cleanup function is live (expect the 20261047 stamp, or 20261073 if finance 4b.1 was applied).
SELECT position('789e4758d674b561' IN p.prosrc) > 0 AS is_20261047_stamp,
       md5(p.prosrc) AS body_md5
FROM pg_catalog.pg_proc AS p
WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)');

-- Q10. Scheduled jobs inside the database, if pg_cron is installed (Vercel crons live in vercel.json).
SELECT pg_catalog.to_regclass('cron.job') IS NOT NULL AS pg_cron_installed;
```

Optional, only if Q10 says `true` (a separate run, it errors when pg_cron is absent):

```sql
SET default_transaction_read_only = on;
SELECT j.jobid, j.jobname, j.schedule, j.active FROM cron.job AS j ORDER BY j.jobid;
```

Not SQL: the project's global upload limit (Dashboard → Storage → Settings). **Not needed for Phase 1** (§0.4.1 A); reading it costs a minute and tells us whether Phase 2's 250 MB needs a change.

Expected: Q1 all NULL; Q5 0 rows; Q6 0; Q8 false/false; Q9 `true` (or the 20261073 body after finance 4b.1). Paste the output to Dev/SA; Q9's `body_md5` becomes the applied-history pin input (§3.6).

---

## 10. PROD apply plan

| Step | Who | What | Gate |
|---|---|---|---|
| 0 | TL | Confirm DE-7 merged; ask finance-health whether 4b.1 (`20261072` / `20261073`) is merged or applied, because it regenerates the same cleanup function (R-2) | — |
| 1 | TL | Run the pre-check (§9.1), paste the output | Q1 NULL, Q5/Q6 0, Q8 false, Q9 known |
| 2 | Dev → SA → QA → user | Build per §12, review, QA (Jest + local PGlite evidence) | SA ✅, QA ✅, user approval |
| 3 | RM | Merge the PR; Vercel deploys | — |
| 4 | TL | **Right after the deploy**, apply `20261074_business_os_data_exports.sql` | post-condition passes (else nothing applied) |
| 5 | TL | Apply `20261075_operator_test_account_cleanup_data_exports.sql` (generated) | it refuses until 20261074 is applied |
| 6 | TL | Run the checker | `VERDICT PASS` |
| 7 | TL | Run the probe with their own user id | `PROBE PASS` (rolled back) |
| 8 | TL | `npm run schema:reconcile` (read-only) | 0 unclassified, 0 missing |
| 9 | TL (optional) | Test-account cleanup "check" on a test account in `/admin/users` Danger Zone | G-10 / G-12 OK |

**The window between step 3 and step 5** (minutes): the deployed build names a table that is not live yet, so the purge reconciler blocks Reset / Purge / admin delete (V-11), and the build pins the new cleanup stamp, so the test-account cleanup refuses (V-10). Both refuse, neither deletes anything wrong. Nobody deletes an account or runs a test cleanup in that window. Applying 20261074 *before* the deploy does not avoid it (a live table without a descriptor blocks the same reconciler, and the old cleanup blocks on the unreviewed FK), so the project rule (apply after deploy) stands.

**Rollback** (only if needed): step 1, run `20261075`'s generated rollback (restores the previous cleanup function); step 2, `scripts/rollback-business-os-data-exports.sql`; step 3, RM reverts the PR so the pinned cleanup stamp and the descriptors match the database again. Before DE-8b ships the bucket is empty and the table has no rows, so the rollback loses nothing.

Re-apply after a rollback only works once the `business-data-exports` bucket row has been deleted in the Storage dashboard (the pre-guard refuses while it exists).

---

## 11. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261074_business_os_data_exports.sql` | create | §3 |
| `supabase/migrations/20261075_operator_test_account_cleanup_data_exports.sql` | create (generated) | §3.6 |
| `supabase/SQL Scripts/20261075_operator_test_account_cleanup_data_exports_rollback.sql` | create (generated) | §3.6 |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | modify (generated) | §3.6 |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | modify (generated) | new stamp |
| `scripts/generate-test-account-cleanup-sql.ts` | modify | history comment, `FUNCTION_MIGRATION`, `PREVIOUS_FUNCTION_MIGRATION` |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | `APPLIED` pins for 20261047 (after Q9) |
| `scripts/precheck-business-os-data-exports.sql` | create | §9.1 |
| `scripts/check-business-os-data-exports.sql` | create | §9 |
| `scripts/probe-business-os-data-exports.sql` | create | §9 |
| `scripts/rollback-business-os-data-exports.sql` | create | §9 |
| `scripts/measure-data-export-size.sql` | create | §6.3 |
| `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` | create | §8.1 |
| `lib/business-os/data-export/jobPolicy.ts` | create | §5.3 |
| `lib/business-os/data-export/__tests__/jobPolicy.test.ts` | create | path builder rejects non-uuids; constants |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | create | §5 |
| `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts` | create | §8.2 |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | types + exports |
| `lib/business-os/purge/descriptors.ts` | modify | descriptor, bucket, `EXPORT_ITSELF` |
| `lib/business-os/purge/types.ts` | modify | `PurgeArea` + `'data_exports'` |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | count + entry + note |
| `lib/business-os/businessOwnedTables.ts` | modify | `USER_OWNED_TABLES` entry |
| `app/admin/users/types.ts`, `app/admin/users/deletionCopy.ts` | modify | area view + label (Q-11) |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify | §6.2 |
| `package.json`, `package-lock.json` | modify | `fflate` 0.8.3 exact (§6.4) |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | §0.11 / §0.12 DE-8a status, decisions, SA rulings (standing rule: every stage spliced into the main requirement) |

`console.*` check: none of the touched TS files is expected to hold `console.*`; Dev greps each before editing and flags any per CLAUDE.md § Logging.

---

## 12. Task list

- ✅ T-0 Wait for DE-7 on `origin/main`; rebase `feature/data-export-de8a`; re-check migration numbers (V-1…V-3) and finance 4b.1's cleanup state
- ✅ T-1 TL runs the pre-check (§9.1); record the output here
- ✅ T-2 `jobPolicy.ts` + test
- ✅ T-3 Migration `20261074` (§3), post-condition block
- ✅ T-4 Migration test incl. negative controls (§8.1)
- ✅ T-5 Checker, probe, rollback, measure script (§9, §6.3)
- ✅ T-6 Local PGlite run of migration + probe scenarios; paste the evidence here
- ✅ T-7 Repository + types + index + unit tests (§5, §8.2)
- ✅ T-8 Registrations: descriptor, bucket, `PurgeArea`, admin area label, `USER_OWNED_TABLES`, baseline JSON (§6.1)
- ✅ T-9 Cleanup generator edits + regenerate `20261075` + applied pins (§3.6)
- ✅ T-10 Audit event names + metadata + audience (§6.2)
- ✅ T-11 `fflate` 0.8.3 exact; confirm `git diff package-lock.json` touches only the root dependency list
- ✅ T-12 Run §8.4 suites, `npm run test:bos-entitlements`, `tsc`, `lint`; `git diff --stat` reviewed (no deletion-without-insertion)
- ✅ T-13 Splice DE-8a status into the requirement (§0.11 / §0.12); mark Code Complete; leave everything uncommitted for SA


### 12.1 Implementation record (Dev, 2026-10-17)

**T-0.** `git fetch origin && git merge origin/main` (fast-forward to `fdaf90c1`, DE-7 PR #446 + #449). Migration numbers re-checked the same day over `origin/main`, every remote branch (`git log --remotes` on `supabase/migrations/2026107*`/`8*`), every local worktree (`neuronforge-*`, `.claude/worktrees/*`) and every worktree's workplans and requirements: highest file anywhere is `20261073` (finance 4b.1, only on `origin/feature/bos-finance-health-4b` and its worktree, **not on main**); `20261074` / `20261075` are named nowhere but this workplan. **Kept 20261074 + 20261075.** Finance 4b.1's cleanup has not landed, so per C-7 **DE-8a chains on 20261047** and finance 4b.1 renumbers its regenerated cleanup to ≥ 20261076 if DE-8a merges first.

**Conditions, as built.**

| C | Where |
|---|---|
| C-1 | `business_os_data_exports_expiry_shape` = `CHECK ((ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL OR expires_at = ready_at + interval '72 hours'))`. The other boolean `=` CHECKs were checked: every operand is `IS [NOT] NULL` or a `status` test over a NOT NULL column (pinned in the migration test). MT-NC plants the old form |
| C-2 | `interval '72 hours'` in the CHECK; `EXPORT_JOB_POLICY.RETENTION_HOURS = 72` (named in hours, see deviations); `markReady` adds 72 h from one clock reading. PGlite: in an `Asia/Jerusalem` session across the 2026-10-25 DST change, `+ '3 days'` ≠ `+ 72 h` (false), and the 72-hour row is accepted |
| C-3 | The probe switches with `SET LOCAL ROLE service_role` before P1 and runs every P1–P11 start (17 calls) and every seed / update / delete as service_role; `RESET ROLE` after P11 with a `current_user` check; P12 / P13 switch roles only inside sub-blocks catching 42501 and check `current_user` after each. Pinned by the migration test |
| C-4 | `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, then `GRANT SELECT, INSERT, UPDATE, DELETE ... TO service_role`. Post-condition item 3 and checker C07 assert no TRUNCATE / REFERENCES / TRIGGER |
| C-5 | `VOLATILE` declared explicitly; MT pins no STABLE / IMMUTABLE (MT-NC plants STABLE); post-condition item 5 and checker C11 assert `provolatile = 'v'` |
| C-6 | `DATA_EXPORT_READY` info; `DATA_EXPORT_DOWNLOADED_BY_ADMIN` critical; pinned by the new `lib/audit/__tests__/dataExportSeverity.guard.test.ts`; `eventAudience.test.ts` re-pinned (211 events, 69 shared) |
| C-7 | Generator: `FUNCTION_MIGRATION = '20261075_operator_test_account_cleanup_data_exports'`, `PREVIOUS_FUNCTION_MIGRATION = '20261047_operator_test_account_cleanup_audit_actor'`, history comment. `APPLIED` pins gain 20261047 + its rollback (sha256 of the LF file, identical to `origin/main`) |
| C-8 | `FUNCTION_REQUIRED_TABLES` entry `business_os_data_exports` → `20261074_business_os_data_exports`. The plan reaches the table by dynamic `format('%I')` SQL, so the test's "really uses it" assertion now accepts the generated step A plan row (`'A', 'business_os_data_exports', `) as well as `public.<table>` |
| C-9 | Pre-check Q11, checker C15 and post-condition item 7 (second half): any `storage.objects` policy for `public` / `anon` / `authenticated` whose `qual || with_check` does not mention `bucket_id` |
| C-10 | `startForOwner(sessionUserId)` and `startForAdmin(targetUserId, adminUserId)`; the generic `start` is private |
| C-11 | Requirement §0.12 + Change History row |

**Files (`git diff --numstat` + new files; nothing deleted except the planned regeneration):** see the hand-over report. Two pinned tests outside the plan had to be re-pinned because the cleanup chain moved: `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` (L8 allow-list gains 20261047 + rollback, history like the others) and `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` (SA-8 allow-list gains 20261046, now history). Two count pins moved by one: `exportClassification.test.ts` (156 = 38 / 0 / 118) and `descriptors.invariant.test.ts` (baseline 156). The cleanup test's 20261046 rollback assertion now expects the restored 20261047 shape (the admin named as `user_id`).

**Deviations from the workplan text (none from SA's conditions):**

| # | Deviation | Why |
|---|---|---|
| DV-1 | `EXPORT_JOB_POLICY.RETENTION_HOURS: 72` instead of `RETENTION_DAYS: 3`; plus `BUCKET_MIME_TYPE` | C-2 made the hours the rule; naming it in hours removes the `* 24` the next reader would have to trust |
| DV-2 | `exportObjectPath` lower-cases both uuids | The purge and cleanup list `{user_id}/` with the lowercase auth id; an upper-case caller would otherwise write a folder neither finds |
| DV-3 | Post-condition item 7 also refuses an unrestricted browser-role storage policy (C-9), not only the checker | The bucket would be exposed from the moment it exists; TL measured 0 storage policies on PROD (§9.3), so it cannot block the apply today |
| DV-4 | Checker has 18 rows: §3.7 items split per assertion, plus C-4, C-9 and the cleanup stamp (C18 `a824848e0a538477`). Before both migrations it reports FAIL; after 20261074 alone C18 still fails (by design: apply 20261075) | The VERDICT then also proves the second migration is live |
| DV-5 | The rollback also refuses while the 20261075 cleanup function is live | Turns "run 20261075's generated rollback first" from a documented order into an enforced one |
| DV-6 | `findJobsByIds` refuses more than 1,000 ids (not truncated); `listForUser` limit 1…20 | Bounded inputs, the lineage-repository precedent |
| DV-7 | New `lib/audit/__tests__/dataExportSeverity.guard.test.ts` | C-6 needed a pin; the existing guards follow the same one-file-per-severity pattern |
| DV-8 | No `npm install`: `fflate` added to `package.json` and the lock's root list by hand | The worktree's `node_modules` is a junction to the shared one; `npm install` would rewrite the shared tree. `npm ls fflate` resolves `fflate@0.8.3` direct + 3 deduped; the lock's `node_modules/fflate` entry (version, integrity) is byte-identical |

**T-6 local PGlite evidence** (`@electric-sql/pglite` 0.5.8, PostgreSQL 18.3 WASM, one connection; stubs: `auth.users`, `storage.buckets` / `storage.objects` (RLS on), roles `anon` / `authenticated` / `service_role BYPASSRLS`, Supabase-like default privileges `GRANT ALL ON TABLES / FUNCTIONS / SEQUENCES TO anon, authenticated, service_role`). Local only, not a CI dependency; scratch removed after the run.

| Run | Result |
|---|---|
| Pre-check | 11 result sets; Q1 all NULL; Q8 false / false; Q11 0 rows |
| Checker before apply | `FAIL 2/16` (only C14 / C15 pass: no storage policy exists) |
| Apply 20261074 | OK. Table ACL `postgres=arwdDxtm, service_role=arwd`; function ACL `postgres=X, service_role=X`; `provolatile v`, `prosecdef false`, `proconfig search_path=pg_catalog, public, pg_temp` |
| Checker after 20261074 only | `FAIL 17/1` (C18: 20261075 not applied) |
| Checker after 20261074 + a stub carrying the 20261075 stamp | **`PASS 18/0`** |
| Apply 20261074 a second time | Refused by the pre-guard ("already exists. Nothing was applied") |
| Probe with a pasted user id | **`PROBE PASS P1 to P14. This error is expected and rolls everything back`**; 0 rows left; `current_user` back to `postgres` |
| Probe refusals | Unedited id, unknown id and a read-only session each refused with their message |
| Constraints | `expires_at` without `ready_at` and `ready` without `expires_at` both refused (C-1); 72 h across DST accepted (C-2); owner kind with another requester refused; a second `running` row refused by the unique index; deleting the login cascades the jobs |
| Rollback | Refused with a file in the bucket; refused while the 20261075 stamp is live; then OK (function and table gone, bucket row left); a second run OK (idempotent); checker after rollback `FAIL 3/15` |
| Post-condition, planted faults (fresh database each) | GRANT SELECT to authenticated → item 2; service_role TRUNCATE → item 3; function REVOKE removed → item 5; STABLE → item 5; a table policy → item 1; public bucket → item 6; index predicate `running` only → item 4; a trigger → item 8; an unrestricted storage policy → item 7 (and pre-check Q11 lists it); a policy naming the bucket → item 7; anon may CREATE in public → pre-guard. **Every time nothing was applied** (table NULL, 0 bucket rows) |
| Checker with an unrestricted storage policy added after apply | `FAIL 17/1` (C15) |
| Probe against planted function faults | service_role without UPDATE → `permission denied` (C-3: an owner-run probe would have passed); `failed` counted → `PROBE FAIL P7`; stale rule at 60 s → `PROBE FAIL P6`; window 23 h → `PROBE FAIL P10` |

Scenario evidence, not concurrency evidence (SA Q-8): two simultaneous sessions are not exercised anywhere.

**Tests run (local, Windows):** new migration test 80 / 80; repository test 29 / 29; `jobPolicy.test.ts` 10 / 10; `dataExportSeverity.guard.test.ts` 8 / 8; `scripts/__tests__/testAccountCleanupSql.test.ts` 106 / 106 (drift, applied pins, G-10 review, editor hygiene); `npm run test:bos-entitlements` 283 suites / 8,700 tests green; `npm run test:authz-guard` 2 suites / 203 tests green (SECDEF surface guard incl. the O-1 tripwire over the new `scripts/*.sql`); `lib/business-os/purge`, `lib/business-os/data-export`, `scripts/__tests__`, `app/admin/audit-trail`, `lib/business-os/test-account-cleanup`, `app/api/admin/test-account-cleanup`, `supabase/__tests__` green after the re-pins above. CI time: Jest file scans and a mocked client only, in the existing Tests job; nothing on the `next build` critical path.

---

## 13. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Deploy-to-apply window blocks admin delete, Reset/Purge and test-account cleanup (V-10, V-11) | Certain, minutes / low | Apply 20261074 + 20261075 right after deploy (§10); both refuse rather than mis-delete |
| R-2 | Finance 4b.1 regenerates the same cleanup function (`20261073`); two branches chaining one function | Likely / medium | Whichever lands second rebases onto the other's generator and sets `PREVIOUS_FUNCTION_MIGRATION` to it (generator comment L97-104). TL sequences the two applies |
| R-3 | Migration-number collision (`20261072` already double-reserved by finance-health and model-pricing slice 8) | Real / low for us | We take `20261074`/`75`; RM re-checks at PR time; TL tells the other two streams about their `72` clash |
| R-4 | `20261047` is not yet in the cleanup `APPLIED` pins | Certain / low | Q9 in the pre-check confirms the live stamp before pinning |
| R-5 | True two-session concurrency is not executed anywhere | Low / medium | Unique index makes a second `running` row impossible regardless; lock makes the count exact; both pinned (Q-8) |
| R-6 | Failed exports never count → a failure loop is unlimited (one at a time) | Low / low | Over-ceiling fails at pre-flight (cheap); DE-8b adds the request throttle |
| R-7 | Bucket exists with no writer and no enforcer until DE-8b | Certain / none (empty) | Writer and sweep ship together in DE-8b (Q-6) |
| R-8 | A `running` row orphaned by a killed function shows as "in progress" until the owner's next start | Certain / low | DE-8b's cron marks rows older than 90 s (Q-12); DE-10a displays `running` > 90 s as failed |
| R-9 | Supabase changes default privileges or storage-table protections | Low / medium | Explicit REVOKE + post-condition + checker; rollback leaves the bucket for the dashboard |
| R-10 | DE-7's large `descriptors.ts` diff conflicts with this slice | Certain / low | T-0: start after DE-7 merges (no stacking) |

---

## 14. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| Q-1 | Start function `SECURITY INVOKER` instead of §0.4.1's "SECURITY DEFINER" (D-1)? | **INVOKER** (fails closed if a grant ever widens; precedent SA-Q69, 20261023) |
| Q-2 | `requested_by` without a foreign key (D-6)? Alternatively an FK `ON DELETE SET NULL` (nullable), reviewed as `actor` in the cleanup generator | **No FK** |
| Q-3 | Accept the generated cleanup migration `20261075` in this PR (not in §0.4.1's ~1 d) and the chaining rule with finance 4b.1 (R-2)? | **Yes** |
| Q-4 | Jobs table service-role only (no owner SELECT policy)? | **Yes** |
| Q-5 | Storage helpers (upload, signed URL, remove, list) in DE-8b, DE-8a only the path builder? | **DE-8b** |
| Q-6 | Retention cron stays in DE-8b (bucket ships empty here)? | **DE-8b**, same PR as the writer |
| Q-7 | `owner_downloaded_at` column now, for DE-10a's "the owner has not downloaded" line, instead of reading audit rows? | **Yes** |
| Q-8 | Concurrency evidence = unique index + lock pinned by Jest, in-transaction probe on PROD, local PGlite; no two-session test? | **Accept** |
| Q-9 | Audit severities in §6.2 (READY and DOWNLOADED_BY_ADMIN critical, FAILED warning, rest info)? | **As listed** |
| Q-10 | Limits as literals in SQL + a TS mirror pinned by MT-11, not RPC parameters? | **Literals** |
| Q-11 | New closed `PurgeArea` `'data_exports'` + one admin label line (`'Data exports'`) — fine in a "no UI" slice? | **Yes** |
| Q-12 | Should DE-8b's daily cron also turn stale `running` rows into `failed` / `timeout`? | **Yes** (recorded for DE-8b) |
| Q-13 | Should the start function also check `admin_users` when the kind is `admin` (defence in depth)? `user_id` there can be NULL until first sign-in (V-14), and the route's `requireAdmin` is the gate | **No** |

---

## 15. Business calls (plain terms, with defaults)

| # | Question for the user | Default if not answered |
|---|---|---|
| B-1 | **How long do we keep the record that an export happened?** The file itself is always deleted after 3 days. The record (date, size, who started it, whether the owner downloaded it — never any of the data) is what shows "Last export on …" and lets an admin see the history. | **Keep the record until the account is deleted** |
| B-2 | **Should an admin downloading a customer's data raise a red flag on the Health page and be kept as long as our other legal records (7 years)?** It is rare and it is a copy of everything the customer holds. The customer is not told either way (already decided, BQ-SA-2). | **Yes: flagged and kept long** |
| B-3 | **Operational notice, not a decision:** for a few minutes after this ships, until the database step is applied, deleting an account and the test-account clean-up will refuse to run. They refuse safely; nothing is lost. | Apply right after release; nobody deletes accounts in that window |

Already decided and not reopened: 1 at a time, 3 per day (rolling 24 hours), admin-started exports count against the customer, failed exports do not count, files kept 3 days, a new export replaces the previous one, no email in Phase 1, accounts above the Phase 1 size get "contact support" (§0.2, §0.4.1 A / H).

---

## SA Review Notes

_SA populates this section._

### SA workplan review DE-8a — 2026-10-17

**Reviewed by SA — 2026-10-17**
**Status:** ✅ Approved with conditions. C-1 to C-10 are part of the build. QA checks them. Implementation starts after DE-7 is on `origin/main` (T-0).

Read against requirement §0.2 DX-4, §0.3, §0.4.1 (binding Phase 1 cut), §0.4.1 H and §0.10/§0.11, TL's pre-check §9.2, the generator (`scripts/generate-test-account-cleanup-sql.ts` L93-140) and `lib/audit/events.ts` (critical = Health "Critical audit events" tile + 7-year class, L747, L880).

#### Verified as sound
- **Default-privilege trap (§9.2 Q7) is closed on both objects.** Table: `REVOKE ALL … FROM PUBLIC, anon, authenticated` (§3.4). Function: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then `GRANT EXECUTE … TO service_role` (§3.5), same as precedent 20261023. Post-condition §3.7 items 2 and 5 prove it with `has_table_privilege` / `has_any_column_privilege` / `has_function_privilege` / `proacl`, and the checker repeats them on PROD. No sequence is created (uuid PK), so the sequence default ACL does not apply.
- **Rate limit.** The order is: guard the inputs, take the per-account `pg_advisory_xact_lock`, run the stale reap (`running` only, `< now() - 90 s`), check one-at-a-time, check 3 per rolling 24 h (`running, ready, expired`, never `failed`, admin rows counted), then insert. The partial unique index is the backstop and its violation is caught and returned as `in_progress`. Both retry times are correct: `min(created_at)+90 s`, and the 3rd-newest counted row `+24 h`, which is the moment the count drops to 2 even with more than 3 rows. There is no job id input. Every statement filters `user_id = p_user_id` and MT-10 pins that, with a negative control. Inputs raise 22023, and the owner-kind mismatch is refused in both the function and a CHECK.
- **Tenant isolation.** The function is reachable only with the service role. `p_user_id` comes from the session (owner) or from the path after `requireAdmin` (admin, the SA-3 exception), never from the body or a header. The repository filters `(id, user_id)` everywhere, and the two cross-account sweep reads are documented and scoped by the row's own `user_id`. There is no trigger and no upsert. C-10 closes the remaining gap.
- **Bucket:** private, 50 MB, `application/zip` only. The path is `{user_id}/{job_id}/1.zip` from a builder that only takes uuids. No policy is created and none is dropped (V-6). Signed URLs wait for DE-8b/DE-10a. The insert has no `ON CONFLICT`, so a bucket with other settings is refused, not silently kept.
- **Registrations** (§6.1) are complete and correct: `level: 'purge'`, `snapshot: 'ids'`, export `exclude(EXPORT_ITSELF)`, LEAF; storage descriptor `{user_id}/`; `PurgeArea 'data_exports'` + label; `USER_OWNED_TABLES`; baseline. `accountDeletionPolicy.ts` stays unchanged, which is right.
- **Not in scope, correctly:** `durable-queue-drain` (D-10: no claim, no drain) and `business-os-entitlements` (D-11: no import from that module). `fflate@0.8.3 --save-exact`: rule-7 approval stands from §0.3.2 SQ-A4 / §0.4.1 A, it is already in the lockfile, and T-11's diff check is the gate.
- **Migration numbers** `20261074` / `20261075` are free. The double reservation of `20261072` belongs to the other streams and is a note only for TL.
- **CI time:** only Jest file scans and mocked-client tests, with no DB, run in the existing Tests job. No critical-path time is added (standing rule).

#### Rulings on §14

| Q | Ruling |
|---|---|
| Q-1 | **SECURITY INVOKER, approved. It replaces the "SECURITY DEFINER" wording of §0.4.1 / SQ-E8, and C-11 records that in the requirement.** The only caller is `service_role`, which holds the four table privileges and BYPASSRLS, so DEFINER would add owner rights nobody needs. INVOKER also fails closed if a future grant widens EXECUTE. Precedents: 20261023, SA-Q69. The post-condition asserts `prosecdef = false`. `SET search_path = pg_catalog, public, pg_temp` and schema-qualified names stay. C-3 makes the probe actually exercise the `service_role` path. |
| Q-2 | **No FK on `requested_by`, approved.** `requested_by` is the admin's **auth user id from the session**, never `admin_users.id` (V-14: that row's `user_id` may be NULL). The audit row's `actor_id` is the durable link. |
| Q-3 | **Approved: the generated `20261075` ships in this PR**, generated by `scripts/generate-test-account-cleanup-sql.ts` only, never hand-written or hand-edited (the drift test enforces this). Ordering rule in C-7/C-8. |
| Q-4 | **Service-role only, no owner SELECT policy, approved.** No browser path reads it. RLS on with zero policies is asserted, which is the AC-36 / DE-0b posture. |
| Q-5 | **Storage helpers in DE-8b, approved.** They are tested with their writer. DE-8a ships only `exportObjectPath`. |
| Q-6 | **Retention cron in DE-8b, approved, on one condition:** the bucket stays empty until DE-8b, and DE-8b ships the writer and the sweep in **one** PR (SA-4: one enforcer shipped with the writer). Nothing may upload behind a flag that is off without the sweep. |
| Q-7 | **`owner_downloaded_at` approved.** It is cheaper and more exact than reading audit rows. |
| Q-8 | **Accepted.** The structural argument holds because the function is VOLATILE under READ COMMITTED: after the lock wait, each statement takes a fresh snapshot and sees the first caller's committed row. The unique index then makes a second live row impossible even without the lock. C-5 pins VOLATILE. PGlite is a single connection too, so it is scenario evidence, not concurrency evidence, and is recorded as such. |
| Q-9 | **Changed, see C-6.** `DATA_EXPORT_READY` → **info**, not critical. Critical feeds the Health "Critical audit events" tile and the 7-year class (events.ts L747, L880). Every ordinary owner self-export would raise an operational alarm, which the user has already rejected for password changes and refunds (#157/#160). Keep the GDPR + SOC2 flags. `DATA_EXPORT_DOWNLOADED_BY_ADMIN` stays **critical** (B-2). `FAILED` warning, `REQUESTED` / `DOWNLOADED` / `EXPIRED` info: approved. |
| Q-10 | **Literals in SQL plus a TS mirror pinned by MT-11, approved.** No RPC parameters for limits. |
| Q-11 | **Approved.** One tsc-forced label line is not a UI change. |
| Q-12 | **Yes, recorded for DE-8b.** It uses the same predicate (`status='running' AND created_at < now() - 90 s`) and the same outcome (`failed`/`timeout`), with every update scoped by the row's own `user_id`. |
| Q-13 | **No, approved.** `requireAdmin` in the route is the gate. The DB cannot check reliably while `admin_users.user_id` can be NULL. |

#### Conditions (part of the build; QA verifies)

1. **C-1 (High): the expiry CHECK has a NULL hole.** `(ready_at IS NULL AND expires_at IS NULL) OR expires_at = ready_at + interval …` evaluates to NULL, so it passes, when exactly one of the two is NULL. A row with `expires_at` set and `ready_at` NULL, or the reverse, is accepted. Rewrite as `(ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL OR expires_at = ready_at + <C-2 interval>)`. Add an MT assertion and an MT-NC planted copy of the old form. Check every other CHECK for the same three-valued trap; the boolean `=` forms are safe only because their operands are `IS [NOT] NULL` or NOT NULL columns.
2. **C-2 (Medium): use `interval '72 hours'`, not `'3 days'`.** `timestamptz + '3 days'` depends on the session `TimeZone` across DST, while `markReady` adds a fixed 72 h in JS. The CHECK could then refuse a valid write in a non-UTC session. Use 72 hours in the CHECK, the post-condition and MT-11 (`RETENTION_DAYS * 24`). `'24 hours'` and `'90 seconds'` are already timezone-independent.
3. **C-3 (High): the probe must exercise the real execution path.** As the SQL-editor owner (`postgres`), the probe bypasses grants and RLS, so it would pass even if `service_role` lacked a privilege the INVOKER body needs. Run every P1–P11 start call under `SET LOCAL ROLE service_role` and reset afterwards. P12/P13 must catch 42501 in sub-blocks, and the probe must assert `current_user` is restored after each role switch. Keep the always-rollback ending.
4. **C-4 (Low): least privilege for service_role.** The default ACL also hands `service_role` TRUNCATE / REFERENCES / TRIGGER. Revoke all from `service_role` as well, then grant only SELECT, INSERT, UPDATE, DELETE. The post-condition and checker assert that `service_role` lacks TRUNCATE and TRIGGER.
5. **C-5 (Medium): pin VOLATILE.** MT-6 asserts the function declares no `STABLE` / `IMMUTABLE`, and the post-condition asserts `provolatile = 'v'`. The lock-then-count correctness depends on it (Q-8). Add an MT-NC planted `STABLE` copy.
6. **C-6 (Medium): severities as ruled in Q-9.** `READY` is info. Update `eventAudience` / `filterOptions` expectations to match.
7. **C-7 (High): cleanup chaining with finance 4b.1.** Per the generator rule (L97-104), whichever lands second takes the **next free number above the first one's**. A lower-numbered cleanup function file is never applied after a higher one, and an applied file is never renumbered or edited.
   - **If DE-8a merges first:** `PREVIOUS_FUNCTION_MIGRATION` = `20261047`. Finance 4b.1 must renumber its regenerated cleanup to ≥ `20261076` and chain on `20261075`. That is allowed because `20261073` is unapplied (§9.2 Q9). TL tells that stream.
   - **If 4b.1 merges first:** DE-8a rebases, `PREVIOUS` = `20261073`, and TL applies `20261072` → `20261073` → `20261074` → `20261075` in numeric order.
   - `20261047` is now confirmed live (§9.2 Q9: stamp `789e4758d674b561`, body md5 `091079a3…`). Dev may add its `APPLIED` pin now. The pin is the sha256 of the **file** and its rollback, not the prod md5. Re-run the drift test after any rebase.
8. **C-8 (Medium): always add the `FUNCTION_REQUIRED_TABLES` entry** `{ table: 'business_os_data_exports', migration: '20261074_business_os_data_exports', … }`, whether the plan names the table in static SQL or in dynamic `format('%I')` SQL. With dynamic SQL a missing table would still fail every check/delete at run time with 42P01. The entry makes "74 before 75" enforced by refusal rather than documented. If finance 4b.1 lands first, carry its entries forward.
9. **C-9 (Medium): generic storage policies.** §3.7 item 7 only finds policies that name the bucket. A policy on `storage.objects` for `anon`/`authenticated`/PUBLIC whose `qual`/`with_check` does not reference `bucket_id` at all would expose the new bucket too. Add a pre-check query and a checker FAIL row for such policies.
10. **C-10 (Medium): make the owner mismatch impossible at the type level.** Replace `start({ userId, requestedBy, requestedByKind })` with `startForOwner(sessionUserId)`, which sends the same id as both `p_user_id` and `p_requested_by`, and `startForAdmin(targetUserId, adminUserId)`. An owner route then cannot construct a foreign or mismatched call. The DB CHECK and the input guard stay as defence in depth. DE-8b/DE-10a route tests still assert that a body `userId` is ignored.

#### Requirement and forward notes
- **C-11:** splice into the requirement (§0.11/§0.12, standing rule): Q-1 INVOKER supersedes the "SECURITY DEFINER" text, the Q-9 severities, C-7's chaining outcome, and the two-migration shape.
- **DE-8b forward items (record them, do not build here):**
  - The route's `maxDuration` must stay ≤ 60 s, safely below the 90 s stale rule (§0.4.1 A "killed at 60 s"). Otherwise a live build is reaped and a second one starts.
  - Uploads set `contentType: 'application/zip'` explicitly, or the bucket's MIME restriction refuses them.
  - Q-12 sweep.
  - Writer and sweep ship in one PR.
- **§15.1 TL defaults:** B-1 (keep the record until the account is deleted), B-2 (admin download critical, Health flag + 7-year class) and B-3 (fail-safe deploy-to-apply window, TL applies immediately) are all accepted. B-2 is implemented by the `critical` severity on `DATA_EXPORT_DOWNLOADED_BY_ADMIN` alone.
- **Apply plan §10** and **rollback order** (20261075's generated rollback, then the DE-8a rollback, then the PR revert; bucket emptied first, row left for the dashboard) are approved.

### Approval
[x] Workplan approved with conditions C-1 to C-10 (+ C-11 doc splice): proceed to implementation once DE-7 is on `origin/main`

### SA code review DE-8a — 2026-10-17

**Code Review by SA — 2026-10-17**
**Status:** ✅ Code Approved for QA (no fix required; three Low notes below, none blocking)

Read the full uncommitted diff in `neuronforge-de8a` (fdaf90c1 + changes) against C-1 to C-11, Q-1 to Q-13, §9.2 / §9.3 and §15.1.

#### Verified
- **20261074, table:** C-1 is `(ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL OR expires_at = ready_at + interval '72 hours')`, which closes the NULL hole in both directions. C-2 uses 72 hours. `owner_is_requester` is a CHECK. The other boolean `=` CHECKs only compare `IS [NOT] NULL` results or `status` (NOT NULL), so they are two-valued. The partial unique index is on `(user_id) WHERE status IN ('queued','running')`. RLS is on with no policy. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then only S/I/U/D to service_role (C-4). There is one FK (user_id → auth.users CASCADE), no trigger, and no sequence.
- **20261074, function:** It is `SECURITY INVOKER VOLATILE` with `search_path = pg_catalog, public, pg_temp`, and every name is schema-qualified. EXECUTE is revoked from PUBLIC, anon, authenticated and service_role, then granted to service_role only. It runs in this order: input guard (22023, including owner ≠ requester), per-account `pg_advisory_xact_lock`, 90 s reap (`running` only), one-at-a-time (`queued`/`running`, retry at `min(created_at)+90 s`), rolling 24 h with `OFFSET 2` (`running, ready, expired`; failed is excluded; admin rows are counted because there is no kind filter), then the insert. The insert's `unique_violation` is caught as `in_progress`. Every statement filters `user_id = p_user_id`, and there is no job-id input. The bucket is private, 52 428 800 bytes, `application/zip` only, with no `ON CONFLICT`.
- **Post-condition:** items 1 to 8 cover RLS/no-policy, browser table and column privileges, service_role S/I/U/D present and T/R/T absent, index predicate, INVOKER/VOLATILE/search_path/no PUBLIC ACL/EXECUTE service-only, bucket shape, bucket-named and unrestricted (`bucket_id`-less) browser storage policies (C-9), no trigger, and the single-FK shape. The 11 planted faults in §12.1 each map to one item, and each run left nothing applied (table NULL, 0 bucket rows).
- **20261075 + rollback are generated, not hand-edited.** I backed up the five outputs, re-ran `npx tsx scripts/generate-test-account-cleanup-sql.ts`, and `cmp` reported all five byte-identical (check SQL, delete SQL, migration, rollback, `cleanupFunctionVersion.generated.ts`). `PREVIOUS_FUNCTION_MIGRATION` = 20261047 (C-7: 4b.1's 20261073 is not on main). The `FUNCTION_REQUIRED_TABLES` entry is present (C-8) and the migration refuses without 20261074. The stamp is `a824848e0a538477`. The rollback carries `789e4758d674b561`. The new `APPLIED` pins for 20261047 + rollback match `origin/main`'s bytes (sha256 8294bb81… / 3a808ed1…, files unchanged).
- **Scripts:** All are read-only (`default_transaction_read_only`) except probe and rollback.
  - Pre-check Q1–Q11.
  - Checker: 18 rows + VERDICT.
  - Probe: refuses an unedited, unknown or read-only session. P1–P11 run under `SET LOCAL ROLE service_role`, with `RESET ROLE` and a `current_user` check. P12/P13 run in 42501-catching sub-blocks, and each restores the role. It always ends in the rollback RAISE (C-3).
  - Rollback: refuses while the bucket holds files or the 20261075 stamp is live (DV-5), and leaves the bucket row.
- **Repository:** `startForOwner(sessionUserId)` / `startForAdmin(targetUserId, adminUserId)`, with `start` private (C-10). Every per-account method filters `(id, user_id)` or `user_id`. Writes are built field by field. There is no `.or()`+`.select()`. Errors are reduced to code + message. Inputs are Zod/uuid-bounded (list 1…20, due ≤ 500, ids ≤ 1 000 refused, not truncated, DV-6). The two cross-account sweep reads are commented per tenant-isolation-guard Step 6. Logs use Pino with ids/counts only. `markReady` derives ready/expires from one clock reading, so the CHECK holds exactly. `jobPolicy.ts` is pure, and `exportObjectPath` accepts uuids only (DV-2 lower-casing is correct).
- **Item 1 (audience):** `shared` is right. The rule in `eventAudience.ts` puts GDPR/account events in `shared`, the doubtful default is `shared`, and an agent-platform user with no business profile can export. Severities follow C-6 (READY info, DOWNLOADED_BY_ADMIN critical, FAILED warning), pinned by `dataExportSeverity.guard.test.ts`.
- **DV-8 fflate:** The root `dependencies` gains only `"fflate": "0.8.3"` (one line in the lock, one in package.json). The existing `node_modules/fflate` entry (0.8.3, integrity unchanged) has no `dev` flag, so a production install still gets it. Accepted.
- **Item 2, the six re-pins, are all legitimate, not weakened:**
  - eventAudience 205→211 / shared 63→69: +6 events.
  - exportClassification 155→156 and exclude 117→118, descriptors.invariant baseline 155→156, and `classification-baseline.json`: +1 table.
  - credit-lots L8 allow-list +20261047 pair, and no-deletion-paths SA-8 +20261046: history files that became "older applied". Both are sha-pinned elsewhere.
  - The cleanup test's rollback-shape assertion now expects the 20261047 shape, with a negative for the 20261046 shape.
- **Item 3 ("into"):** fine. The word appears only as the keywords `INSERT INTO` / `RETURNING … INTO`, never inside a string literal, and the editor bug is triggered by the word inside a string. TL applies via MCP anyway.
- **Registrations:** `PurgeArea 'data_exports'` with the label line; descriptor `purge`/LEAF/`ids`/`exclude(EXPORT_ITSELF)`; storage descriptor `{user_id}/` `purge` exclude; `USER_OWNED_TABLES`. The requirement diff is +57/−0 (insert-only §0.12). There is no `console.*` in any touched file. There is no import from `lib/business-os/entitlements/`.
- **Tests (SA re-run, Windows):** 65 suites / 1 719 tests green (new migration + repository + data-export + audit + cleanup + purge + credit-lots + admin/users). `tsc --noEmit` reports nothing in the touched files. CI: Jest only, in the existing Tests job, so no added critical-path time.

#### Code Review Comments
1. `scripts/__tests__/testAccountCleanupSql.test.ts` (C-8 loop) — Priority: Low. The new `||` form accepts a step-A plan row for **every** required table, so `business_os_billing_events` could now pass on a plan row alone, although its reason says "static SQL". Optional: apply the plan-row alternative only to `business_os_data_exports`. This is not blocking, because the refusal guard in the migration is what enforces order.
2. `20261074` start function, `in_progress` branch — Priority: Low, forward note for DE-8b. A `queued` row is never reaped, so if one ever lingers, `retry_at` (`min(created_at)+90 s`) can lie in the past. Phase 1 never writes `queued`. If DE-8b/Phase 2 introduces it, give it a reap rule or a retry floor of `now()`.
3. Probe — Priority: Low, information only. It begins by deleting the pasted user's export rows. That is safe because the block always raises and rolls back, but TL should run it in its own tab before any real export exists, as §10 already orders.

#### Optimisation Suggestions
- None required.

### Code Approved for QA: Yes

---

## QA Testing Report

_QA populates this section._

### QA — DE-8a — 2026-10-17

**Test mode:** full
**Strategy used:** A (Jest unit + source guards); C (QA's own SQL harness, run on PGlite 0.5.8 / PostgreSQL 18.3 WASM **and** on a local embedded PostgreSQL 17.5 server, which gives real two-session concurrency); code and SQL negative controls on a scratch copy
**Focus:** schema, security, api (repository), performance (CI time)
**Skipped:** D manual browser check (no UI in this slice)
**Input source:** prompt keywords (TL trigger)
**Prod:** never contacted. Worktree `git diff --numstat` and `git status --porcelain` are identical before and after QA (this section is the only edit). Scratch at `C:/Users/Barak/AppData/Local/Temp/de8aqa`, outside the worktree. node_modules junctions removed with `rmdir` only; shared `node_modules` intact.

#### Test Coverage

| Item | Tested? | Result | Notes |
|---|---|---|---|
| New migration test | ✅ | Pass | 80 / 80 |
| Repository test | ✅ | Pass | 29 / 29 |
| `jobPolicy.test.ts` | ✅ | Pass | 10 / 10 |
| `dataExportSeverity.guard.test.ts` | ✅ | Pass | 8 / 8 |
| `scripts/__tests__` (incl. cleanup drift 106 / 106), `lib/business-os/purge`, `lib/business-os/data-export`, `app/admin/users`, `lib/audit` | ✅ | Pass | 71 suites / 1,885 tests in one run, 616 s with SA running in parallel. `check-bos-llm-literals` alone took 591 s of that; it is not related to DE-8a |
| `npm run test:bos-entitlements` | ✅ | Pass | 283 suites / 8,700 tests, 169 s |
| `npm run test:authz-guard` | ✅ | Pass | 2 suites / 203 tests, 59 s |
| No `.github` change | ✅ | Pass | `git diff origin/main -- .github` and `git status .github` are both empty |
| Full `npx jest --ci` vs `origin/main` baseline (`fdaf90c1`, git archive + git init) | ✅ | Pass | Baseline: 1,510 suites, 21 failed, 141 failed tests. Worktree: 1,514 suites, 20 failed, 140 failed tests. **0 new failures.** The 20 suites that fail in both fail on the same test names (already failing V6, pilot, orchestration, onboarding and CRM guards). The one baseline-only failure, `tailwind-css-escape.guard`, comes from the git-init copy (0 tracked files). The +4 suites are the 4 new files. Wall time 1,058 s base / 1,151 s worktree (loaded machine) |
| PGlite: checker before / after 74 / after 74 + 75-stamp stub | ✅ | Pass | `FAIL 2/16` → `FAIL 17/1` (C18 only) → **`PASS 18/0`**. Table ACL `postgres=arwdDxtm, service_role=arwd`; function ACL `postgres=X, service_role=X`. A second apply is refused by the pre-guard |
| Probe P1–P14 under service_role | ✅ | Pass | `PROBE PASS P1 to P14…`; 0 rows left; `current_user` back to `postgres`. Unedited id, unknown id and read-only session are each refused |
| Browser roles (C-3, Q-4) | ✅ | Pass | As `authenticated` and as `anon`: SELECT, INSERT, UPDATE, DELETE and TRUNCATE on the table, and EXECUTE of the start function, all return **42501** (12 / 12). service_role TRUNCATE → 42501 (C-4). service_role SELECT, INSERT, UPDATE, DELETE and EXECUTE are allowed |
| Concurrency (real PostgreSQL 17.5, separate backends) | ✅ | Pass | (a) A starts and holds its transaction. B's start **blocks on the advisory lock** (1 ungranted advisory lock in `pg_locks`). After A commits, B returns `in_progress`; 1 running row. (b) A raw-inserts a running row without the lock. B's start **blocks on the unique index**, then the `unique_violation` handler returns `in_progress`; 1 running row. (c) 12 simultaneous sessions: 1 `started`, 11 `in_progress`, 1 row. (d) 12 simultaneous sessions with 2 counted rows: 1 started, 3 rows. Then 12 simultaneous sessions with 3 counted rows: all `daily_limit`. This covers R-5 / Q-8, which said no two-session test exists anywhere |
| Rate limit | ✅ | Pass | 3 counted rows (-3 h, -2 h, -1 h) → `daily_limit`, retry +21 h. 4 counted rows → retry at the 3rd newest + 24 h (+21 h). 3 failed + 2 ready → started (failed rows do not count). 2 owner + 1 admin-started → owner gets `daily_limit` (admin rows count). Admin start at 3 → `daily_limit`. Oldest row at 24 h 1 s → started. Running row at 91 s → reaped as `failed/timeout`, then started. Running row at 89 s → `in_progress`, retry +1 s, not reaped. Another account's rows do not count. Bad kind, or owner with another requester → 22023. Unknown login → 23503 |
| C-1 expiry NULL hole | ✅ | Pass | `expires_at` without `ready_at`, and `ready` without `expires_at`: both return 23514 on `business_os_data_exports_expiry_shape`. 71 h is refused. The old form is shown to evaluate to NULL |
| C-2 72 h across DST | ✅ | Pass | In an `Asia/Jerusalem` session over 2026-10-25, `+3 days ≠ +72 h`. A SQL `+72 hours` row is accepted, and so is a JS `markReady`-style ISO value (`Date + 72·3,600,000 ms`). `+ '3 days'` is refused, which shows C-2 was needed |
| Unique index / cascade | ✅ | Pass | A second running row → 23505. Deleting the login cascades the jobs |
| Rollback | ✅ | Pass | Refused with a file in the bucket (table kept). Refused while the 20261075 stamp is live. OK after both are cleared: table and function gone, bucket row left. A second run is OK. Checker after rollback: `FAIL 3/15`. A re-apply while the bucket row is still there is refused by the pre-guard; this is by design, because §10 has the bucket deleted in the dashboard. After removing the row, the re-apply is OK, the checker shows `PASS 18/0` and the probe passes again |
| Same harness on real PostgreSQL 17.5 | ✅ | Pass | 73 / 73 (the 66 shared checks + 7 concurrency checks) |
| Generated cleanup byte-identical | ✅ | Pass | The render functions of `scripts/generate-test-account-cleanup-sql.ts` were written to scratch (not into the worktree) and compared with `cmp`: the `20261075` migration, its rollback, `test-account-cleanup-check.sql`, `test-account-cleanup-delete.sql` and `cleanupFunctionVersion.generated.ts`. **5 / 5 identical** |
| Code negative controls (scratch copy) | ✅ | Pass (all red) | `startForOwner(sessionUserId, requestedBy = sessionUserId)` → 1 failed. `startForOwner(id, requestedBy?)` → 2 failed. `markExpired` without `user_id` → 2 failed. `findLatestForUser` without `user_id` → 2 failed. `markReady` without `user_id` → 3 failed. `DATA_EXPORT_READY` set to critical → 2 failed. `DATA_EXPORT_DOWNLOADED_BY_ADMIN` set to warning → 2 failed |
| SQL negative controls on the migration test | ✅ | Pass (all red) | Old C-1 form → 3 failed. Reap UPDATE without `user_id = p_user_id` → 3 failed. `'3 days'` → 4 failed. `failed` counted in the daily window → 2 failed |
| `fflate` | ✅ | Pass | Only the `package.json` dependency list and the lock's root list change. The `node_modules/fflate` 0.8.3 entry has no `dev` flag, so a production install keeps it |

#### Issues Found

##### Bugs (must fix before commit)
None.

##### Performance Issues (should fix)
None. The 4 new suites run in the existing Tests job (mocked client and file scans, about 17–25 s each under load). Nothing is added to the `next build` critical path.

##### Edge Cases (nice to fix)
1. **A re-apply after rollback needs the bucket row removed first.** Low. The rollback deliberately leaves the empty bucket, and the 20261074 pre-guard refuses while the bucket exists. The order is right and nothing half-applies. The runbook step "delete it in the Storage dashboard" is what makes a re-apply possible; worth one explicit sentence in §10.
2. **I agree with SA comment 2 (`queued` never reaped).** Not reachable in Phase 1, because nothing writes `queued`. My runs only exercised `running`.
3. **Probe P14 is information only.** This is by design, since one transaction cannot show two sessions. The real-server run above is the concurrency evidence.

#### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan written (Dev) | DE-8a Phase 1 foundation: jobs table + start function (INVOKER proposed, Q-1) + 50 MB private bucket, repository (11 methods), registrations, 6 audit names, `fflate` 0.8.3 exact. Found that the new table/bucket force a regenerated test-account cleanup (`20261075`). Migration numbers `20261074` / `20261075`. 13 SA questions, 3 business calls. Awaiting SA workplan review |
| 2026-10-17 | Code complete (Dev) | Implemented per SA C-1…C-11 and TL §9.2 / §9.3 / §15.1. Numbers kept: 20261074 + generated 20261075 (stamp `a824848e0a538477`, chained on 20261047; finance 4b.1 not on main). Implementation record, deviations DV-1…DV-8 and local PGlite evidence in §12.1. Uncommitted, awaiting SA code review and QA |

### 9.2 Pre-check results — 2026-10-17 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`)
| Q | Result |
|---|---|
| Q1 | `business_os_data_exports` table **NULL**; `business_os_data_export_start` **NULL**; bucket `business-data-exports` **NULL** (none exist) |
| Q2 | no public table matching export / _jobs / queue |
| Q3 | no public function name containing `export` |
| Q4 | buckets: business-purge-snapshots 500 MB private; contact-documents 50 MB private; avatars 4 MB public; website-images 5 MB public |
| Q5 | storage policies naming the new bucket: **0** |
| Q6 | objects under `business-data-exports`: **0** |
| Q7 | default privileges in `public`: tables (r) grant **anon + authenticated arwdDxtm**, functions (f) grant **anon + authenticated EXECUTE**, sequences rwU — for both postgres and supabase_admin owners → the migration's explicit REVOKEs on the table AND the function are mandatory |
| Q8 | anon / authenticated CREATE on schema public: false / false |
| Q9 | live `operator_test_account_cleanup` still carries stamp **`789e4758d674b561`** (20261047); body md5 `091079a3cd8610ecb1552de72d54c6a6` → finance 4b.1 (20261073) NOT applied yet |
| Q10 | **pg_cron not installed** → the daily sweep must be a Vercel cron route (as planned) |

### 15.1 Business calls — TL defaults 2026-10-17 (autonomous run; user may change)
| B | TL default |
|---|---|
| B-1 how long to keep the "an export happened" record (date, size, who, downloaded?) | **until the account is deleted**; the file itself always deleted after 3 days |
| B-2 admin download flagged on the Health page + record kept 7 years | **yes**; the customer is not told (already decided) |
| B-3 short window after release where account delete / test cleanup refuse until the DB step is applied | **accepted** (fails safe); TL applies immediately after deploy |

**Migration-number note for TL:** Dev found `20261072` reserved twice (finance-health 4b.1 and model-pricing slice 8) — TL to alert those streams. DE-8a takes `20261074` + `20261075`; RM re-checks at PR time.

### 9.3 SA C-9 pre-check — 2026-10-17 (TL, read-only, prod)
`pg_policies` on `storage.objects`: **0 policies of any kind** → no policy can expose `business-data-exports`. C-9's checker FAIL row stays as a future guard.
