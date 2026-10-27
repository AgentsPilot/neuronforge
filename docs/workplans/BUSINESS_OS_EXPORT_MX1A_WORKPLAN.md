# Workplan: Business OS Export — MX-1a (E4) Export tables, daily limit, cleanup regeneration

> **Last Updated**: 2026-10-27

**Developer:** Dev (EXPORT session)
**Step:** E4 (user's numbering) = doc slice MX-1a
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §4.4 (BQ-29 answered 2026-10-26), §6.2 MX-1a, §7 MX-1a, §10 XC-7, XC-8, XC-9, XC-11, XC-20, XC-21, §11 (S-1, S-2, S-3, B.3, B.6, B.7), `## SA Split Review — 2026-10-25` (SR-2, SR-3, SR-4, SR-5, SR-7, SR-10, SR-11)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §2, §3 (CC-1, CC-4, CC-6, SR-5), §4.4, §7, §8 (SA-P1, SA-P4, SA-P6)
**Precedents read:** DL-1a (D1) workplan `neuronforge-dl1a/docs/workplans/BUSINESS_OS_DELETION_DL1A_WORKPLAN.md` (W-1…W-13, CR-1…CR-4, F-A, QA replica); DE-8a (`20261074` + `20261075`, `jobPolicy.ts`, `business-os-data-exports.migration.test.ts`)
**Coordination:** `C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md` — EXPORT holds the cleanup-regen lock (E4, since 2026-10-26); **20261095** (tables + start / claim / reap functions) and **20261096** (regenerated cleanup, `PREVIOUS_FUNCTION_MIGRATION = 20261094_operator_test_account_cleanup_account_closures`) reserved for branch `feature/bos-export-mx1a-tables`
**Branch:** `feature/bos-export-mx1a-tables` (RM-created from `origin/main` `a105fa4a`, which holds E1 / PR #515 and D1 / PR #508). Confirmed by Dev with `git branch --show-current` on 2026-10-26 before writing this file
**Worktree:** `neuronforge-mx1a`
**Date:** 2026-10-26
**Status:** Code Complete (2026-10-27), uncommitted, awaiting SA code review and QA (replica). Also uncommitted on the branch: the user's BQ-29 edit in the requirement (left as is)

---

## Overview

MX-1a builds the storage for the new per-module export, and nothing a user can see. It adds two server-write-only tables: one row per export click (`business_os_export_requests`), and one row per module of that click (`business_os_export_module_jobs`, the queue the MX-3 worker drains). It also adds a database start function that enforces the owner's limit the user set on 2026-10-26 (2 requests per rolling 24 h, one not finished at a time, a fully failed or interrupted request not counted, admin sends not counted) and the admin's own limit (2 per owner per 24 h). Two queue functions follow the claim pattern: claim and reap, lease 420 s. The slice also adds the TS mirror of every SQL number with a test that fails CI when they differ, two repositories, two purge descriptors (`export: exclude`), and the regenerated test-account cleanup function, so that a test-account cleanup or a stage-E anonymise also removes these rows. Two migrations, one manual prod gate, applied and merged back to back. The export switch does not exist yet, so the tables stay empty until MX-4.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Decisions and their reasons](#2-decisions-and-their-reasons)
3. [Schema: migration 20261095](#3-schema-migration-20261095)
4. [Code: policy constants, repositories, descriptors](#4-code-policy-constants-repositories-descriptors)
5. [Cleanup regeneration: migration 20261096](#5-cleanup-regeneration-migration-20261096)
6. [Tests and guards](#6-tests-and-guards)
7. [Read-only schema check (before code is final)](#7-read-only-schema-check-before-code-is-final)
8. [Prod apply: the user's database paste procedure](#8-prod-apply-the-users-database-paste-procedure)
9. [Rollback](#9-rollback)
10. [Files to create / modify](#10-files-to-create--modify)
11. [Task list](#11-task-list)
12. [Acceptance criteria](#12-acceptance-criteria)
13. [Coordination](#13-coordination)
14. [Risks](#14-risks)
15. [Open items for SA](#15-open-items-for-sa)
16. [Business questions for the user](#16-business-questions-for-the-user)
17. [SA Review Notes](#sa-review-notes)
18. [QA Testing Report](#qa-testing-report)
19. [Commit Info](#commit-info)
20. [Change History](#change-history)

---

## 1. Analysis summary

Read on the branch at `a105fa4a`.

| Area | Today | MX-1a |
|---|---|---|
| Old export job table | `business_os_data_exports` (20261074): ZIP-shaped (ready / expired / downloaded), `level: 'purge'`, in `FUNCTION_REQUIRED_TABLES` (SA C-8), start function `business_os_data_export_start` with the limits as SQL literals, mirrored by `jobPolicy.ts` and pinned by `business-os-data-exports.migration.test.ts` | **Not touched** (XC-7). Read-only after MX-4, dropped in MX-7 |
| Cleanup generator | `FUNCTION_MIGRATION = 20261094_operator_test_account_cleanup_account_closures`, `PREVIOUS = 20261092_…meeting_links`, stamp `792d801e13101316` (live since 2026-10-26) | Bump to 20261096, `PREVIOUS = 20261094` (SR-5 b), two step-B entries, one inbound-FK review entry |
| Descriptor count | 162 = 38 include + 0 planned + 124 exclude (`exportClassification.test.ts` l.302–304 and l.1361–1370, `classification-baseline.json` `count`, `descriptors.invariant.test.ts` l.882) | **164 = 38 + 0 + 126** (counted from 162, SA CR-3: never write 162 again) |
| Drift test pins | `APPLIED` ends with the 20261092 pair; `APPLIED_TARGET` = the 20261094 pair (`eb04be06…a169ea33`, `9e79c08b…ef119dd`); the 20261094 describe block reads the moving `migrationSql` / `CLEANUP_FUNCTION_VERSION` | 94 pair moves to `APPLIED`; the 94 block is re-pinned to literals (DL-1a W-8 shape); new 96 block; new `APPLIED_TARGET` last |
| `no-deletion-paths.guard.test.ts` | `MIGRATION_FILE` (94), `PREVIOUS_MIGRATION_FILE` (92), 20261081 literal in both lists, the 20261093 session-cut entry in `SQL_AUTH_WRITE_ALLOW_LIST` with per-entry `shapes` | 20261092 becomes a **literal** entry in both lists, with its shapes; `PREVIOUS_MIGRATION_FILE` becomes 94; the l.562–567 test is updated. **Rules are DELETE's and are not changed** (SR-3) |
| `findDeletionFacts` (frozen, XC-12, SR-2) | Reads `business_os_data_exports` only | **Not touched.** Signature and meaning unchanged. The new tables hold no rows before MX-4 switch-on, so there is no gap. The meaning changes at MX-4, announced in the coordination file before that PR (S-3) |
| Entitlements | — | No import from `lib/business-os/entitlements/` (XC-19). Re-confirmed by grep before hand-over |
| Shared hotspots | — | Only `descriptors.ts` and `businessOwnedTables.ts` (S-2, add only, EXPORT anchor) plus the S-1 lock files. No translations, flags, audit events, `vercel.json`, `rateLimit.ts`, `types.ts` or `index.ts` |

**Phase (CLAUDE.md rule 8):** not V6 or pilot work. No plugin code.

**Deprecated systems met:** `lib/business-os/account/accountDeletionPolicy.ts` (`@deprecated`) reads `USER_OWNED_TABLES`; the two new tables appear in it as "delete" tables, which is correct. Flagged only, not extended (DL-1a precedent).

**`console.*`:** none expected. Before the first edit of each existing file, `grep -n "console\." <file>`; any hit is flagged to TL (CLAUDE.md § Logging).

**Skills followed:** `durable-queue-drain` (claim columns, claim RPC with `FOR UPDATE SKIP LOCKED`, reaper, dead-letter, idempotency markers, `⟨unscoped-by-design⟩` repo methods, double-claim test), `new-repository` (client injection, `RepositoryResult`, never throws, Pino, `user_id` on every per-account method, data-export classification in the same PR; the types / barrel items are waived by S-16 as DL-1a's O-6 ruled), `tenant-isolation-guard` (service-role paths; ids from the session, a claimed row or an admin path; explicit payloads), `business-os-schema-check` (no column claim without the §7 live read). `supabase-postgres-best-practices` is **not installed** in this environment (not under `.claude/skills/` or `~/.claude/skills/`); its general rules are applied by hand: a partial index on each queue predicate, an index for each foreign key's lookup, `SECURITY INVOKER` where the grants suffice, `search_path` pinned, `lock_timeout`, a one-transaction migration.

---

## 2. Decisions and their reasons

| # | Decision | Why | Needs |
|---|---|---|---|
| D-1 | **Two migrations: 20261095 = both tables + start, claim and reap functions; 20261096 = regenerated cleanup function.** The lower number is applied first | The generator owns the whole function file (DE-8a 74 → 75, DE-10b.1 80 → 81, DL-1a 93 → 94). Already reserved in the coordination file (SA-P1) | SA confirms (MX1A-1) |
| D-2 | **Both tables are user-scoped `never` descriptors, removed by step B of the cleanup in both modes** (not in `KEEP_SET`) | Requirement §4.4: the history is "kept until the account is deleted and removed with it at stage E". A business Reset or Purge must not wipe the history, the rolling limit counter (otherwise "purge, then export again" bypasses BQ-29), or the admin-origin facts MX-4 reads for the receipt (XC-12). DL-1a O-2 is the precedent. This differs from the old table (`purge`) on purpose | SA (MX1A-2) |
| D-3 | **`FUNCTION_REQUIRED_TABLES` is not extended** | Step B names tables only as `VALUES` literals and skips an absent one (`to_regclass … CONTINUE`), the shape SA O-3 ruled for DL-1a. §8 enforces the apply order (the 95 checker before 96). Note: SA C-8 ruled the opposite for `business_os_data_exports` ("required whether static or dynamic"); O-3 is the newer ruling | SA (MX1A-3) |
| D-4 | **`module_jobs.user_id` is stored (denormalised) with its own FK to `auth.users`, and `request_id` is a single-column FK to the request (ON DELETE CASCADE).** Only the start function inserts jobs, taking both values from one argument. The cleanup reviews the request link in `INBOUND_FOREIGN_KEYS` with owner column `user_id`, so its G-18 refuses any job row of another account that points at the target's request | The worker scopes every effect to the claimed row's `user_id` (tenant-isolation-guard step 6) without a join. A composite FK `(request_id, user_id)` would prove same-owner in the schema, but the cleanup's G-18 counts only single-column links (`key_width = 1`), so it would see the link and count nothing. Single-column + G-18 + start-function-only inserts is the reviewed shape | SA (MX1A-4) |
| D-5 | **No FK on `admin_actor_id`** | The 20261074 `requested_by` precedent (SA Q-2): an admin's own deletion must not null or cascade an owner's history, and a FK to `auth.users` would need a new `ACTOR_FOREIGN_KEYS` review entry for G-10 | — |
| D-6 | **The start function holds every limit as a SQL literal** (`2`, `interval '24 hours'`, `OFFSET 1`) and serialises per account with `pg_advisory_xact_lock` (20261074 shape). Owner and admin are counted separately: owner rules count owner-origin requests only, admin rules count admin-origin requests for that owner only | BQ-29 (user, 2026-10-26) and XC-20. "Do not count against the owner" is read as independent counters; see MX1A-7 for the in-flight cross-check |
| D-7 | **"Terminal", "counted" and "in flight" are derived from the module jobs, not stored on the request.** A request is in flight while any of its jobs is `waiting` or `working`. A request counts unless **every** job is `failed` or `interrupted` | One source of truth; nothing for MX-3 to keep in step. A request later fully failed stops counting, as BQ-29 says |
| D-8 | **Lease 420 s is a SQL literal in the claim and reap predicates; no `p_lease_seconds` argument** (DL-1a W-2) | XC-8 rules lease 420 s for a `maxDuration = 300` worker. A literal means no caller can pass a lease shorter than `maxDuration`. The mirror test asserts `LEASE_SECONDS >= WORKER_MAX_DURATION_SECONDS + 60` | — |
| D-9 | **A separate reap RPC** (unlike DL-1a's lease-in-predicate variant) | A stale `working` job is not simply re-claimable: XC-9 makes its fate depend on its parts. With no part it goes back to `waiting` (or dead-letters at 3 attempts); with any part `sending` / `accepted` it ends `interrupted`; with every part accepted it is `sent`. That judgement needs the reaper the skill describes (Step 3), run first by the worker | SA (MX1A-6) |
| D-10 | **"Retried only while no part has reached `sending`" is also a row CHECK:** `status = 'waiting'` requires `parts = '[]'` and `parts_total IS NULL` | Even a code bug in MX-3 cannot reset a job that has already put a part on the wire. The DB is the authority (XC-9) | — |
| D-11 | **The schema already carries the failure-notice state** (`notice_state` none / due / sent / given_up, `notice_attempts`, `notice_sent_at`, `notice_resend_id`), and the claim also takes `notice_state = 'due'` rows | Every failed, interrupted or too-large module must send exactly one notice email (requirement §3.6). If the worker died between "mark failed" and "send the notice", the notice would be lost. A durable "due" marker makes the notice its own claimable effect. Adding it now saves MX-3 a second manual migration gate | SA (MX1A-5) |
| D-12 | **Codes and module ids are shape-checked only** (`^[a-z][a-z0-9_]{1,39}$`), never value-listed in SQL | SA-P6 default: a module rename or a new failure code must not need a migration. The repository validates module ids against `EXPORT_MODULE_IDS` (MX-0), and the MX-1b route against the enabled set. Duplicates in one request are refused by `UNIQUE (request_id, module)` |
| D-13 | **Repository surface for this slice:** the start calls, the user-scoped reads, claim and reap. The worker's per-part writes (set `parts_total`, mark a part `sending` / `accepted`, finish, mark notice sent) come in MX-3 with their first caller | Plan §4.6 assigns the worker's complete methods to MX-3. The schema and its CHECKs are tested now on the QA replica, so MX-3 adds only compare-and-set methods | SA (MX1A-13) |
| D-14 | **No trigger on either table.** The repository sets `updated_at` | Zero triggers means zero new G-17 review entries (DL-1a D-4) | — |
| D-15 | **Prod behaviour is proved on a local real-Postgres replica by QA, not by a prod probe** | DL-1a precedent (embedded Postgres 17 + 15). DE-8a's prod probe wrote rows inside a rolled-back transaction, on the only database. The replica gives two connections for `SKIP LOCKED` | SA (MX1A-14) |

---

## 3. Schema: migration 20261095

**File:** `supabase/migrations/20261095_business_os_export_requests.sql` (hand-written, `BEGIN; SET LOCAL lock_timeout = '5s'; … COMMIT;`, one transaction, pre-guards and post-conditions in `DO` blocks: 20261074 / 20261093 shape)

**Paste safety:** no `into` in any comment or single-quoted literal; no `SELECT … INTO`, no `RETURNING … INTO`. Variables are assigned with `:=` only, and new ids are generated with `gen_random_uuid()` before the insert. The only occurrences of the word are `INSERT INTO` statement keywords inside the dollar-quoted start function body (applied on prod before in 20261074 and 20261081). The migration test enforces exactly that.

### 3.1 `public.business_os_export_requests`

| Column | Type | Null / default | Meaning (source) |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | One row per Export click (XC-7) |
| `user_id` | uuid | NOT NULL, FK `auth.users(id) ON DELETE CASCADE` | The account whose data is exported and whose login email receives it |
| `origin` | text | NOT NULL, CHECK in (`owner`, `admin`) | XC-7, XC-20 |
| `admin_actor_id` | uuid | NULL, **no FK** (D-5) | The admin who sent it; NULL for an owner request |
| `modules` | text[] | NOT NULL | The module ids ticked, in drawer order (MX-0 ids) |
| `requested_at` | timestamptz | NOT NULL, `now()` | The limit's clock and the history's "requested at" |
| `requested_email_sent_at` | timestamptz | NULL | When the "Export requested" email was accepted (MX-1b; MX1A-11) |
| `created_at`, `updated_at` | timestamptz | NOT NULL, `now()` | — |

**Named CHECKs:**
- `business_os_export_requests_origin_check`: `origin IN ('owner', 'admin')`.
- `business_os_export_requests_admin_shape`: `(origin = 'admin') = (admin_actor_id IS NOT NULL)`.
- `business_os_export_requests_modules_shape`: `cardinality(modules) BETWEEN 1 AND 32 AND array_position(modules, NULL) IS NULL AND array_to_string(modules, ',') ~ '^[a-z][a-z0-9_]{1,39}(,[a-z][a-z0-9_]{1,39})*$' AND cardinality(string_to_array(array_to_string(modules, ','), ',')) = cardinality(modules)` (DL-1a CR comment 2 form: no empty element, no comma inside one). 32 is a sanity ceiling, not the module count (MX-0 has 13).

**Index:** `business_os_export_requests_user_requested` on `(user_id, requested_at DESC)` (history, the limit counts, the FK lookup).

### 3.2 `public.business_os_export_module_jobs`

| Column | Type | Null / default | Meaning (source) |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | One job per module per request (XC-7). Part of the Resend idempotency key `export:{id}:{n}` (XC-9) |
| `request_id` | uuid | NOT NULL, FK `business_os_export_requests(id) ON DELETE CASCADE` | D-4 |
| `user_id` | uuid | NOT NULL, FK `auth.users(id) ON DELETE CASCADE` | Denormalised tenancy key (D-4) |
| `module` | text | NOT NULL, shape CHECK | MX-0 module id |
| `status` | text | NOT NULL, default `waiting`, CHECK in (`waiting`, `working`, `sent`, `failed`, `interrupted`) | The history words of requirement §3.7 |
| `parts_total` | integer | NULL, CHECK ≥ 1 | Fixed before the first send (XC-9). No upper bound in SQL: the 10-email maximum (BQ-28) is an MX-3 constant |
| `parts` | jsonb | NOT NULL, `'[]'` | Per-part array of `{ "n": int, "state": "sending" \| "accepted", "resend_id": text \| null, "at": timestamptz text }` (XC-9). Zod-validated in the repository |
| `row_count` | integer | NULL, CHECK ≥ 0 | Rows in the module's CSV |
| `failure_code` | text | NULL, shape CHECK | e.g. `error`, `too_large`, `over_ceiling`, `attempts_exhausted`, `interrupted` (codes listed in TS, D-12) |
| `notice_state` | text | NOT NULL, default `none`, CHECK in (`none`, `due`, `sent`, `given_up`) | D-11 |
| `notice_attempts` | integer | NOT NULL, `0`, CHECK ≥ 0 | Bumped when a notice is claimed |
| `notice_sent_at` | timestamptz | NULL | — |
| `notice_resend_id` | text | NULL, length ≤ 128 | Resend message id of the notice |
| `claimed_by`, `claimed_at` | uuid, timestamptz | NULL | Claim (skill Step 1) |
| `attempts` | integer | NOT NULL, `0`, CHECK ≥ 0 | Bumped per build claim; dead-letter at 3 |
| `next_attempt_at` | timestamptz | NULL | Backoff gate after a reaped retry |
| `last_error_code` | text | NULL, shape CHECK | A code, never a message |
| `started_at` | timestamptz | NULL | First claim |
| `sent_at` | timestamptz | NULL | Last part accepted (history "sent at") |
| `finished_at` | timestamptz | NULL | Reached `sent`, `failed` or `interrupted` |
| `created_at`, `updated_at` | timestamptz | NOT NULL, `now()` | — |

**Named CHECKs** (one constraint per rule, so a failed write names it):

| Constraint | Rule |
|---|---|
| `…_status_check` | `status IN ('waiting', 'working', 'sent', 'failed', 'interrupted')` |
| `…_codes_shape` | `module`, `failure_code`, `last_error_code` match `^[a-z][a-z0-9_]{1,39}$` (or are NULL where nullable) |
| `…_counts_check` | `attempts >= 0 AND notice_attempts >= 0 AND (row_count IS NULL OR row_count >= 0) AND (parts_total IS NULL OR parts_total >= 1)` and `notice_resend_id` length ≤ 128 |
| `…_claim_pair` | `(claimed_by IS NULL) = (claimed_at IS NULL)` |
| `…_claim_shape` | `(status <> 'working' OR claimed_by IS NOT NULL) AND (status NOT IN ('waiting', 'sent') OR claimed_by IS NULL)` |
| `…_waiting_has_no_parts` | `status <> 'waiting' OR (parts = '[]'::jsonb AND parts_total IS NULL)` (D-10) |
| `…_notice_state_check` | `notice_state IN ('none', 'due', 'sent', 'given_up')` (the value list of the column row above, named on its own; folded with M-1 to M-5, so the jobs table has 12 named CHECKs) |
| `…_parts_shape` | **Positive form (SA M-1).** `CASE WHEN jsonb_typeof(parts) = 'array' THEN (CASE WHEN parts_total IS NULL THEN jsonb_array_length(parts) = 0 ELSE jsonb_array_length(parts) <= parts_total END) AND jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.type() == "object" && @.n.type() == "number" && @.state.type() == "string" && (@.state == "sending" \|\| @.state == "accepted"))')) = jsonb_array_length(parts) ELSE false END`. It proves every element valid instead of looking for an invalid one: a numeric, null, boolean, object or missing `state`, and a nested-array element (strict mode, no unwrap), all fall out of the filter, so the count differs and the CHECK refuses. The outer `CASE` guards `jsonb_array_length` because AND does not short-circuit in a CHECK. The `@.n.type() == "number"` term is the SA optimisation suggestion. 20261011 is the jsonpath-in-CHECK precedent |
| `…_sent_shape` | `(status = 'sent') = (sent_at IS NOT NULL)`, and `sent` needs (M-1 form, CASE-guarded) `parts_total IS NOT NULL`, `jsonb_array_length(parts) = parts_total` and the count of `strict $[*] ? (@.state == "accepted")` = `parts_total` |
| `…_failure_shape` | `(status IN ('failed', 'interrupted')) = (failure_code IS NOT NULL)`; `status = 'interrupted'` needs `failure_code = 'interrupted'` and (CASE-guarded) `jsonb_array_length(parts) > 0` |
| `…_notice_shape` | `(status IN ('failed', 'interrupted')) = (notice_state <> 'none')`; `(notice_state = 'sent') = (notice_sent_at IS NOT NULL)` |
| `…_finished_shape` | `(status IN ('sent', 'failed', 'interrupted')) = (finished_at IS NOT NULL)` |

**Named foreign keys (SA M-3).** Each FK is a named table constraint, and the post-conditions check each name: `business_os_export_requests_user_id_fkey` (`user_id → auth.users` CASCADE), `business_os_export_module_jobs_request_id_fkey` (`request_id → business_os_export_requests` CASCADE) and `business_os_export_module_jobs_user_id_fkey` (`user_id → auth.users` CASCADE). T-7 asserts that the `INBOUND_FOREIGN_KEYS` entry names exactly the constraint in the 95 file, so a rename cannot leave G-18 blocking on an unreviewed link.

**Unique:** `business_os_export_module_jobs_one_per_module` on `(request_id, module)` (also serves `request_id` lookups and the FK).

**Indexes:**
- `…_user_created` on `(user_id, created_at DESC)` (history; FK lookup).
- `…_waiting` on `(next_attempt_at NULLS FIRST, created_at)` WHERE `status = 'waiting'` (claim, build branch).
- `…_notice_due` on `(created_at)` WHERE `notice_state = 'due'` (claim, notice branch).
- `…_working` on `(claimed_at)` WHERE `status = 'working'` (reaper).

**Access (both tables):** `ENABLE ROW LEVEL SECURITY`, no policy. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` (20261074 shape: server-write-only; access only through repositories).

### 3.3 Start function

`public.business_os_export_request_start(p_user_id uuid, p_origin text, p_admin_actor_id uuid, p_modules text[]) RETURNS TABLE (result_outcome text, result_request_id uuid, result_retry_at timestamptz)`. `LANGUAGE plpgsql`, `VOLATILE`, `SECURITY INVOKER`, `SET search_path = pg_catalog, public, pg_temp`. EXECUTE: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`; `GRANT EXECUTE … TO service_role`.

1. **Arguments.** Refuse with `22023` when `p_user_id`, `p_origin` or `p_modules` is NULL; `p_origin` not in (`owner`, `admin`); `(p_origin = 'admin') <> (p_admin_actor_id IS NOT NULL)`; `cardinality(p_modules)` outside 1..32, a NULL element, an element not matching the shape, or a duplicate (`cardinality(ARRAY(SELECT DISTINCT unnest(p_modules))) <> cardinality(p_modules)`).
2. **Serialise.** `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('business_os_export_request:' || p_user_id::text, 0));` (one key per account, both origins: two clicks cannot both pass the count).
3. **In flight** (one request not yet terminal, per origin): if a request of this account and this origin has any job in `waiting` or `working` → return `('in_progress', NULL, NULL)`. No retry time: the history shows what is running.
4. **Daily limit** (per origin): **one SQL site per limit (SA M-5)**: `v_limit := CASE WHEN p_origin = 'owner' THEN 2 ELSE 2 END;` The first `2` is pinned by T-1 to `OWNER_DAILY_LIMIT`, the second to `ADMIN_DAILY_LIMIT_PER_OWNER`, and a negative control proves that changing one constant fails only its own pin. Then one query finds the limit-th newest counted request of this account and origin: `requested_at > now() - interval '24 hours'`, at least one job **not** in (`failed`, `interrupted`), `ORDER BY requested_at DESC OFFSET (v_limit - 1) LIMIT 1` (20261074's `OFFSET 2` for 3; the offset is derived from the one literal, so it cannot drift from it). If it exists → `('daily_limit', NULL, <its requested_at> + interval '24 hours')`. An owner and an admin each have their own counter (D-6); the admin counter is per owner by construction (`user_id = p_user_id`).
5. **Insert.** `v_request_id := gen_random_uuid();` insert the request with that id, then `INSERT INTO public.business_os_export_module_jobs (request_id, user_id, module) SELECT v_request_id, p_user_id, m.module FROM unnest(p_modules) AS m(module);` (status defaults to `waiting`).
6. Return `('started', v_request_id, NULL)`.

Scenario check (requirement X-7): 5 modules on the 11th 10:00 and 3 more on the 12th 09:00 are two counted requests; a third on the 12th 09:30 returns `daily_limit` with retry at the 12th 10:00. X-3: a request with one failed module out of 13 still counts. A request whose 13 modules all failed does not.

### 3.4 Claim RPC

`public.business_os_export_module_jobs_claim_due(p_runner uuid, p_batch integer) RETURNS SETOF public.business_os_export_module_jobs`. `LANGUAGE sql`, `VOLATILE`, `SECURITY INVOKER`, `SET search_path = pg_catalog, public, pg_temp`. EXECUTE `service_role` only. Cited in the header as SA-ruled deviation from the skill's `SECURITY DEFINER` (DL-1a O-4: `service_role` holds the grants, so DEFINER adds no power).

```sql
WITH due AS (
  SELECT j.id FROM public.business_os_export_module_jobs AS j
  WHERE p_runner IS NOT NULL
    AND (
      (j.status = 'waiting' AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now()))
      OR (j.notice_state = 'due' AND j.notice_attempts < 5
          AND (j.claimed_at IS NULL OR j.claimed_at < now() - interval '420 seconds'))
    )
  ORDER BY j.created_at
  LIMIT LEAST(GREATEST(coalesce(p_batch, 1), 1), 10)
  FOR UPDATE SKIP LOCKED
)
UPDATE public.business_os_export_module_jobs AS j
SET status          = CASE WHEN j.status = 'waiting' THEN 'working' ELSE j.status END,
    attempts        = CASE WHEN j.status = 'waiting' THEN j.attempts + 1 ELSE j.attempts END,
    notice_attempts = CASE WHEN j.notice_state = 'due' THEN j.notice_attempts + 1 ELSE j.notice_attempts END,
    started_at      = CASE WHEN j.status = 'waiting' THEN coalesce(j.started_at, now()) ELSE j.started_at END,
    claimed_by = p_runner, claimed_at = now(), updated_at = now()
FROM due WHERE j.id = due.id
RETURNING j.*;
```

A `waiting` row never holds a claim (CHECK `…_claim_shape`), so the build branch needs no lease test; the notice branch does. **SA M-2:** the notice branch is bounded on its own by `j.notice_attempts < 5` (pinned by T-1 to `NOTICE_MAX_ATTEMPTS`), so a notice can never be claimed a sixth time even if a run skips or fails the reap; the reaper's `>= 5` "given up" verdict stays. Batch clamp 1..10: one job at the 100,000-row ceiling already fills most of the 270 s budget, so MX-3 is expected to claim one at a time.

### 3.5 Reap RPC

`public.business_os_export_module_jobs_reap() RETURNS SETOF public.business_os_export_module_jobs`. Same header, grants and citation. One `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 100)` with a verdict per stale row, all literals:

| Row (lease `interval '420 seconds'` passed) | Verdict | Sets |
|---|---|---|
| `working`, `parts_total` set, every part `accepted`, count = `parts_total` | **sent** (the worker died after the last accept) | `status 'sent'`, `sent_at now()`, `finished_at now()`, claim cleared |
| `working`, at least one part (any state) | **interrupted** (XC-9: never re-send; BQ-43 email) | `status 'interrupted'`, `failure_code 'interrupted'`, `notice_state 'due'`, `finished_at now()`, claim cleared |
| `working`, no part, `attempts >= 3` | **failed** (dead-letter) | `status 'failed'`, `failure_code 'attempts_exhausted'`, `notice_state 'due'`, `finished_at now()`, claim cleared |
| `working`, no part, `attempts < 3` | **retry** | `status 'waiting'`, `parts_total NULL`, `next_attempt_at now() + interval '60 seconds' * attempts`, `last_error_code 'lease_expired'`, claim cleared |
| `notice_state 'due'`, `notice_attempts >= 5`, claim NULL or stale | **notice given up** | `notice_state 'given_up'`, claim cleared |

**SA M-6:** the verdict is one `CASE` in exactly this order: sent → interrupted → failed (3 attempts) → retry, then notice given up. So every part accepted but fewer than `parts_total` is **interrupted**, and `parts_total` set with no part is **retry** with `parts_total` cleared. **SA M-1:** "every part accepted" is the positive count `jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.state == "accepted")')) = parts_total`, never a search for a non-accepted element.

It returns the changed rows, so the MX-3 worker logs them (ids and codes only). The worker runs it first in every run (skill Step 5).

### 3.6 In-migration guards (20261074 / 20261093 pattern)

- **Pre:** `anon` / `authenticated` may not CREATE in `public`; neither table nor any of the three functions exists; `public.business_os_account_closures` exists (20261093 applied, so `PREVIOUS = 20261094` is the live base); `gen_random_uuid()` resolves.
- **Post** (any failure raises and the file rolls back): for each table RLS on, zero policies, no privilege for `public` / `anon` / `authenticated` (table and column), `service_role` holds exactly SELECT, INSERT, UPDATE, DELETE and not TRUNCATE / REFERENCES / TRIGGER; no trigger; the jobs table has exactly two FKs (`user_id → auth.users` CASCADE, `request_id → requests` CASCADE), the requests table exactly one, **each found by its M-3 name**; no FK into either table except `jobs.request_id` (SA optimisation wording); the unique `(request_id, module)` index exists; the three partial indexes exist with their predicates (the `indexdef LIKE` text checked on PG 15 and 17 by QA, DL-1a lesson); each function is `NOT prosecdef`, `provolatile = 'v'`, `proconfig` holds the pinned `search_path`, no `EXECUTE` for PUBLIC (grantee 0), `anon` or `authenticated`, and `service_role` holds EXECUTE; all named CHECKs exist (count pinned).

`NOTIFY pgrst, 'reload schema';` before `COMMIT`.

---

## 4. Code: policy constants, repositories, descriptors

### 4.1 Mirror constants (pure)

**File:** `lib/business-os/data-export/moduleExportPolicy.ts` (no imports; `jobPolicy.ts` precedent, which stays untouched for the ZIP)

```typescript
export const MODULE_EXPORT_POLICY = {
  OWNER_DAILY_LIMIT: 2,             // BQ-29 (user, 2026-10-26)
  ADMIN_DAILY_LIMIT_PER_OWNER: 2,   // XC-20
  DAILY_WINDOW_HOURS: 24,           // hours, not days (DST, jobPolicy SA C-2)
  MAX_MODULES_PER_REQUEST: 32,      // sanity ceiling in the CHECK and the start function
  LEASE_SECONDS: 420,               // XC-8
  WORKER_MAX_DURATION_SECONDS: 300, // XC-8; MX-3's route pins its maxDuration to this
  WORKER_BUDGET_SECONDS: 270,       // XC-8
  BUILD_MAX_ATTEMPTS: 3,
  NOTICE_MAX_ATTEMPTS: 5,
  RETRY_BACKOFF_SECONDS: 60,        // times attempts
  CLAIM_BATCH_MAX: 10,
  REAP_BATCH_MAX: 100,
} as const;
export const EXPORT_REQUEST_ORIGINS = ['owner', 'admin'] as const;
export const MODULE_JOB_STATUSES = ['waiting', 'working', 'sent', 'failed', 'interrupted'] as const;
export const MODULE_JOB_IN_FLIGHT = ['waiting', 'working'] as const;
export const MODULE_JOB_NOT_COUNTED = ['failed', 'interrupted'] as const;
export const NOTICE_STATES = ['none', 'due', 'sent', 'given_up'] as const;
export const PART_STATES = ['sending', 'accepted'] as const;
export const START_OUTCOMES = ['started', 'in_progress', 'daily_limit'] as const;
export const CODE_SHAPE = /^[a-z][a-z0-9_]{1,39}$/;
```

### 4.2 `BusinessOsExportRequestRepository`

**File:** `lib/repositories/BusinessOsExportRequestRepository.ts` (new-repository skill; service-role client documented — server-write-only table, RLS has no policy; constructor takes an optional `SupabaseClient`; never throws; `{ data, error }`; Pino `service: 'BusinessOsExportRequestRepository'`, ids and codes only; types in the file, not the barrel, S-16; no exported singleton, DL-1a CR comment 4)

| Method | Scope | Notes | Caller |
|---|---|---|---|
| `startForOwner(sessionUserId, modules)` | the session user | Zod: uuid, and `z.array(ExportModuleIdSchema)` from MX-0 (defence in depth; "enabled" is the route's check). RPC with `p_origin 'owner'`, `p_admin_actor_id NULL`. Result Zod-parsed to `{ outcome: 'started', requestId } \| { outcome: 'in_progress' } \| { outcome: 'daily_limit', retryAt }` | MX-1b |
| `startForAdmin(ownerUserId, adminUserId, modules)` | owner id from the admin route path | Same; `p_origin 'admin'`. No caller until MX-5 | MX-5 |
| `findByIdForUser(requestId, userId)` | `.eq('id').eq('user_id')` | `.maybeSingle()` | MX-1b email, MX-4 |

**Start result handling (SA M-7):** zero rows or more than one → error `unexpected_result`; Postgres `22023` → `invalid_arguments`; `23503` (no such login) → `unknown_account`. None is retried by the repository. T-3 covers each case.

### 4.3 `BusinessOsExportModuleJobRepository`

**File:** `lib/repositories/BusinessOsExportModuleJobRepository.ts` (same rules)

| Method | Scope | Notes | Caller |
|---|---|---|---|
| `listHistoryForUser(userId, { limit })` | `.eq('user_id', userId)`, newest first, limit clamped 1..100 | Embeds `business_os_export_requests` (`requested_at`, `origin`) through the request FK. Returns a DTO: module, status, requestedAt, sentAt, emailCount (accepted parts), origin. **Never** returns `resend_id`, claim fields or error codes to a route | MX-1b drawer, MX-4 |
| `claimDue(runnerId, batch)` ⟨unscoped-by-design⟩ | cross-user by design | RPC §3.4; every row Zod-parsed (incl. each `parts` element); a row that fails the parse is logged by id and dropped, never processed. Doc-comment cites the `PluginConnectionRepository` precedent and the rule that every later effect is scoped to the row's `user_id` (tenant-isolation-guard step 6) | MX-3 |
| `reapStale()` ⟨unscoped-by-design⟩ | cross-user by design | RPC §3.5; returns `{ id, status, failureCode }[]` | MX-3 |

The MX-3 worker's writes (`setPartsTotal`, `markPartSending`, `markPartAccepted`, `markSent`, `markFailed`, `markNoticeSent`) are compare-and-set on `id` + `claimed_by` + expected `status`, and use `{ count: 'exact' }` instead of `.select()` after an update (PostgREST update + select hazard). They are listed here so SA sees the whole contract; they are built in MX-3 (D-13).

### 4.4 Descriptors, cleanup entries, ownership (S-2, EXPORT anchor, add only)

- `lib/business-os/purge/descriptors.ts`, in the `never(...)` list as **one contiguous block directly after `business_os_finance_snapshots` and before `business_os_deletion_receipts`** (not adjacent to DELETE's `business_os_account_closures` line), with a `// Module export MX-1a (XC-7, migration 20261095)` comment:
  - `never('business_os_export_module_jobs', U, exclude('the export history itself: module, dates, counts and a send state', 'never content, file names or email addresses'), '<notes: why never (D-2); user_id and request_id CASCADE; no trigger; removed by step B in both modes>')`
  - `never('business_os_export_requests', U, exclude('the export history itself: which modules were asked for, when, and by whom', 'never content'), '<notes>')`
  - `EXPORT_REASON.EXPORT_ITSELF` ("a short-lived copy of this account's data") does not describe a history row, so each gets its own honest reason (DL-1a SA optimisation precedent).
- `lib/business-os/businessOwnedTables.ts` `USER_OWNED_TABLES`: two reason lines directly after the `business_os_data_exports` entry (EXPORT's DE-8a anchor): "An export request and its module jobs belong to the person; a business Reset or Purge must not erase the history or reset the daily limit; the account deletion removes them."

---

## 5. Cleanup regeneration: migration 20261096

Under the S-1 lock (SR-3 file list). Generator edits in `scripts/generate-test-account-cleanup-sql.ts`:

| Constant | From | To |
|---|---|---|
| `FUNCTION_MIGRATION` | `20261094_operator_test_account_cleanup_account_closures` | `20261096_operator_test_account_cleanup_export_requests` |
| `PREVIOUS_FUNCTION_MIGRATION` | `20261092_operator_test_account_cleanup_meeting_links` | `20261094_operator_test_account_cleanup_account_closures` |
| `FUNCTION_MIGRATION_PURPOSE` | 94 lines | "Adds business_os_export_module_jobs and business_os_export_requests to step B, removed in the hard delete and in the anonymise" · "Reviews the link from the module jobs to their request for G-18" · "Nothing else in the plan changes. Same 8 argument signature as 20261094" |
| `ROLLBACK_CONSEQUENCE` | 94 lines | "The restored 20261094 function does not remove export history rows" · "While the tables of 20261095 exist, G-10 of the restored function refuses every check and delete on their links to the login" · "A full restore is this file, then the 20261095 rollback, then the PR revert" (paste-safe: no semicolon, apostrophe or the word into) |
| Doc comment | — | One `20261096:` paragraph (chains on 20261094, stamp `792d801e13101316`, live since 2026-10-26; not in `FUNCTION_REQUIRED_TABLES`, D-3) |
| `FULL_REMOVAL_EXTRAS` | — | A `// Module export (MX-1a)` group after the account-settings group: `business_os_export_module_jobs` first (child), then `business_os_export_requests` |
| `INBOUND_FOREIGN_KEYS` | — | `['business_os_export_module_jobs', 'business_os_export_module_jobs_request_id_fkey', 'user_id']` in its sorted place |
| `FUNCTION_REQUIRED_TABLES`, `KEEP_SET`, `STEP_B_BLOCKING_EDGES`, `ACTOR_FOREIGN_KEYS`, `EXTRA_REVIEWED_TRIGGERS` | unchanged | D-3, D-2, CASCADE (not a NO ACTION edge), D-5, D-14 |

The two `user_id` links become tenancy keys automatically (`tenancyForeignKeys()` reads the plan), which is what clears G-10 once 96 is live.

Then `npx tsx scripts/generate-test-account-cleanup-sql.ts` rewrites `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql`, the 20261096 migration, `supabase/SQL Scripts/20261096_operator_test_account_cleanup_export_requests_rollback.sql` and `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` (new stamp). **20261094 and its rollback are never touched** (sha-pinned). Before the run: `git diff --stat` clean of generated files. After: `git diff --numstat` shows additions in each generated file and no deletion-only file (agent file-write truncation hazard).

Paste-safe, read-only scripts (one statement each, `ORDER BY checks.ord;`, 20261094 shape):
- `scripts/precheck-export-requests.sql`: one pre-check for both files (§8 step 3).
- `scripts/check-export-requests-migration.sql`: checker after 20261095 (with one information row: "until 20261096 is live, every check refuses with G-10 on these tables; expected").
- `scripts/check-test-account-cleanup-export-requests-migration.sql`: checker after 20261096, with the md5 row of the committed function body as an **operator gate** (DL-1a CR-2).

`docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md`: one version-history row for 20261096.

---

## 6. Tests and guards

All pure Jest in the existing job (no added CI time).

| # | Test | File | Asserts (each with a negative control on a planted copy) |
|---|---|---|---|
| T-1 | Migration 20261095 static detectors | `supabase/migrations/__tests__/business-os-export-requests.migration.test.ts` (new) | RLS on and no `CREATE POLICY` for both tables; the exact REVOKE / GRANT lines; no grant to a browser role; every named CHECK present; status CHECK = `MODULE_JOB_STATUSES`; origin CHECK = `EXPORT_REQUEST_ORIGINS`; notice CHECK = `NOTICE_STATES`; part states = `PART_STATES`; **literal ↔ constant pins**: `2` (owner and admin branch) = `OWNER_DAILY_LIMIT` / `ADMIN_DAILY_LIMIT_PER_OWNER`, `OFFSET 1` = limit − 1, `interval '24 hours'` = `DAILY_WINDOW_HOURS`, `interval '420 seconds'` (claim and reap) = `LEASE_SECONDS`, `attempts >= 3` = `BUILD_MAX_ATTEMPTS`, `notice_attempts >= 5` = `NOTICE_MAX_ATTEMPTS`, `interval '60 seconds'` = `RETRY_BACKOFF_SECONDS`, clamp `10` / `100` = batch maxima, `32` = `MAX_MODULES_PER_REQUEST`; the in-flight and not-counted status lists equal `MODULE_JOB_IN_FLIGHT` / `MODULE_JOB_NOT_COUNTED`; function headers (plpgsql / sql, VOLATILE, INVOKER, pinned search_path) and EXECUTE service_role only; the advisory lock; `into` only as `INSERT INTO` inside the function body; no `SELECT … INTO` / `RETURNING … INTO`; no `into`, `;` or `'` in comments of pasted files; rollback refusals (§9) present. **SA M-5:** one SQL site per mirror constant: the owner `2` and the admin `2` are separate sites, each pinned to its own constant, and a negative control (a planted copy of the SQL with one site changed) fails only that constant's pin; `420 seconds` is pinned at the claim site and the reap sites separately, each with its own control; `notice_attempts < 5` (claim, M-2) and `notice_attempts >= 5` (reap) are both pinned to `NOTICE_MAX_ATTEMPTS`. **SA M-1:** the positive-form jsonpath CHECKs are pinned, and a JS model of the CHECK (strict mode, unknown dropped) refuses a numeric, null, boolean, object and missing `state` and a nested-array element. **SA M-8:** the paste-safety scan (no `into` in any single-quoted literal or comment, no `;` or `'` in a comment) covers the 95 migration, its rollback and all three §5 scripts, CRLF normalised before the scan |
| T-2 | Policy constants | `lib/business-os/data-export/__tests__/moduleExportPolicy.test.ts` (new) | `LEASE_SECONDS >= WORKER_MAX_DURATION_SECONDS + 60`; `WORKER_BUDGET_SECONDS < WORKER_MAX_DURATION_SECONDS`; in-flight ∪ terminal = all statuses, disjoint; the file is pure (no imports; CRLF-normalised source scan) |
| T-3 | `BusinessOsExportRequestRepository` | `lib/repositories/__tests__/BusinessOsExportRequestRepository.test.ts` (new) | Each method: happy path + error path; invalid uuid or unknown module id → error with no RPC call; owner start sends `p_origin 'owner'` and the session id, never a body id; admin start sends the path owner id and the admin id; each outcome parsed; an unexpected outcome → error; `user_id` filter on `findByIdForUser`; no email or module content in log calls |
| T-4 | `BusinessOsExportModuleJobRepository` | `lib/repositories/__tests__/BusinessOsExportModuleJobRepository.test.ts` (new) | History scoped by `user_id`, newest first, limit clamped, DTO never carries `resend_id` / claim fields; claim result Zod-parsed (a bad `parts` element is dropped and logged by id); a double claim modelled as disjoint batches (skill Step 10); reap result mapped; RPC errors → `{ error }`, never a throw |
| T-5 | Callers guard | `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` (new; `accountClosureRepositories.callers.guard.test.ts` shape) | `.from('business_os_export_requests')`, `.from('business_os_export_module_jobs')` and the three function names appear only in the two repository files, their tests, this guard, the 95 / 96 migrations and rollbacks and the §5 scripts. Scans `app`, `lib`, `components`, `hooks`, `scripts`, `supabase` in `.ts`, `.tsx`, `.js`, `.mjs`, `.sql`; negative fixture |
| T-6 | Descriptors and counts | `exportClassification.test.ts` (counts only), `classification-baseline.json` (`count` + two `never` levels), `descriptors.invariant.test.ts` (`baseline.count`), `businessOwnedTables.test.ts` | **164 = 38 include + 0 planned + 126 exclude** (comments say "MX-1a on top: 164 with the two export history tables"); no other edit |
| T-7 | Drift test regeneration | `scripts/__tests__/testAccountCleanupSql.test.ts` | The 94 pair moves from `APPLIED_TARGET` to `APPLIED` with its hashes (`eb04be0682923bfe…a169ea33`, `9e79c08b2c55e7ed…ef119dd`). l.514 expectation → 20261094. The **20261094 block is re-pinned to literals**: stamp `792d801e13101316` as `STAMP_94`, the literal 94 migration and rollback paths, its pre-check / checker by literal path, md5 sliced from the literal 94 file; `expect(MIGRATION_94).toBe(migrationSql)` becomes a literal-file check (DL-1a W-8). New 20261096 block: target and chains on 94 (stamp in the previous file and in the rollback, rollback restores the 94 body exactly); new stamp ≠ `792d…`; both tables in step B of both modes, jobs before requests, not in `KEEP_SET`; tenancy rows for both `user_id` links; the inbound review row; `never` descriptors not reached by Reset or Purge; not in `FUNCTION_REQUIRED_TABLES`; pre-check and checker contents, md5 row, read-only and paste-safe. **SA M-3:** the `INBOUND_FOREIGN_KEYS` entry for the jobs → request link names exactly the constraint the 95 file creates. New `APPLIED_TARGET` pins written **last**, once the bytes are final |
| T-8 | `no-deletion-paths` allow-list history (SR-3) | `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | 20261092 becomes its own entry in `SQL_LOGIN_DELETE_ALLOW_LIST` and in `SQL_AUTH_WRITE_ALLOW_LIST` (with its exact `shapes`, asserted both ways, W-7), because it stops being `PREVIOUS_MIGRATION_FILE`. **SA M-4 (R-7):** the entry is built from the generator constant, `` `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261092')}_meeting_links.sql` ``, like the 77 / 75 / 47 entries, never a string literal, because its file name spells the cleanup function. "Literal" here means "named on its own, no longer through `PREVIOUS_MIGRATION_FILE`". The l.562–567 test now says "20261081 literal and 20261092 named on its own, 20261094 previous"; the 20261093 session-cut entry and every rule unchanged; "older applied versions hold none" still passes |
| T-9 | Credit-lots L8 allow-list | `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | Add the 20261094 pair by name (it stops being `CLEANUP_MIGRATION_FILE`), add only |
| T-10 | Duplicate-prefix guard (SR-7, exists) | `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts` | Unchanged; must pass with 95 and 96 |
| T-11 | Runs before hand-over | — | `npm test -- scripts/__tests__/testAccountCleanupSql.test.ts lib/business-os/purge lib/business-os/data-export lib/business-os/__tests__ lib/repositories/__tests__ supabase/migrations/__tests__`, then `npm test`; `npm run lint`; `npx tsc --noEmit` with `NODE_OPTIONS=--max-old-space-size=8192`, filtered to touched files, exit code checked (no OOM trace). Entitlements: `grep -rn "business-os/entitlements" <touched files>` must be empty, so `test:bos-entitlements` is not required (run once anyway if SA asks) |

**What QA exercises on a local real-Postgres replica** (DL-1a QA shape; embedded Postgres 17 and a 15 formatting check; roles `anon`, `authenticated`, `service_role` BYPASSRLS; owner `postgres`; repo migrations applied in prod order through 92 → 93 → 94, then 95 → 96):

1. 95 pre-guards each refuse and create nothing; clean apply passes every post-condition on PG 15 and 17; a set of broken copies (RLS off, a policy, a browser grant, a trigger, a missing index, DEFINER, a widened grant) each raise their own post-condition.
2. Every named CHECK refuses its violation (incl. a `waiting` row with a part, an `interrupted` row with no part, a `sent` row with a `sending` part, a non-object part, a bad state, an empty module element, a comma inside one, 33 modules, a free-text code); `UNIQUE (request_id, module)` refuses a duplicate module.
3. **Start function, owner:** 1st and 2nd start; 3rd within 24 h → `daily_limit` with the right retry time; a 2nd while one job is `waiting` or `working` → `in_progress`; a fully failed request and a fully interrupted request do not count; a request with one failed and one sent job counts; a request 24 h + 1 s old does not count; admin requests do not change any owner outcome. **Admin:** the same against admin-origin rows for one owner; another owner's rows never count. **Arguments:** each invalid shape → 22023, nothing written. **Concurrency:** two connections starting at once for one account → one `started`, one `in_progress` (advisory lock). `anon` / `authenticated` EXECUTE → denied.
4. **Claim:** takes `waiting` past `next_attempt_at` and `due` notices whose claim is NULL or older than 420 s; skips the rest; sets `working`, bumps the right counter; batch NULL / 0 / 1000 clamped to 1 / 1 / 10; NULL runner → 0 rows; two connections → disjoint batches with no wait (`SKIP LOCKED`).
5. **Reap:** each verdict row of §3.5, plus a fresh `working` row (419 s) untouched; after an `interrupted` verdict the next claim picks its notice.
6. Pre-check all `ok` before 95; 95 checker ok + G-10 info row FAIL before 96, all ok after; 96 checker ok incl. the md5 row on the committed bytes.
7. **F-A proof:** with 95 + 94 live, a test-account check refuses on G-10 for both links; with 96 live, the check passes, and both the hard delete and the anonymise remove the account's requests and jobs (step B counts reported). A job row of **another** account pointing at the target's request is refused by G-18.
8. **Rollback order:** the 95 rollback refuses while 96 is live and while any row exists; the 96 rollback restores 94 (stamp `792d…`, md5 = the 94 body); then the 95 rollback drops the five objects; the 94 check works again; re-apply 95 → 96 works.

---

## 7. Read-only schema check (before code is final)

Each query is one read-only `SELECT`, run by TL (or the user) on prod and pasted into this workplan before Task 4. No query contains the word "into".

```sql
-- Q-1 nothing named like this exists yet
SELECT pg_catalog.to_regclass('public.business_os_export_requests') AS requests_table,
       pg_catalog.to_regclass('public.business_os_export_module_jobs') AS jobs_table,
       pg_catalog.to_regprocedure('public.business_os_export_request_start(uuid, text, uuid, text[])') AS start_fn,
       pg_catalog.to_regprocedure('public.business_os_export_module_jobs_claim_due(uuid, integer)') AS claim_fn,
       pg_catalog.to_regprocedure('public.business_os_export_module_jobs_reap()') AS reap_fn;
```

```sql
-- Q-2 the live cleanup function is 20261094 (SR-5 b, the chain base)
SELECT position('792d801e13101316' in p.prosrc) > 0 AS is_20261094
FROM pg_catalog.pg_proc AS p
WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)');
```

```sql
-- Q-3 20261093 is applied (the table the 94 plan names)
SELECT pg_catalog.to_regclass('public.business_os_account_closures') IS NOT NULL AS closures_present;
```

```sql
-- Q-4 browser roles may not create objects in public (the migration refuses otherwise)
SELECT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AS anon_create,
       pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') AS auth_create;
```

```sql
-- Q-5 server version and the functions the CHECKs and inserts rely on
SELECT pg_catalog.current_setting('server_version') AS server_version,
       pg_catalog.to_regprocedure('gen_random_uuid()') IS NOT NULL AS has_gen_random_uuid,
       (SELECT p.provolatile FROM pg_catalog.pg_proc AS p WHERE p.proname = 'jsonb_path_exists' AND p.pronargs = 4) AS jsonb_path_exists_volatility;
```

```sql
-- Q-6 no migration history row at or above 20261095 (harmless error if the table is absent)
SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20261095' ORDER BY version;
```

Expected: Q-1 all NULL; Q-2 `true`; Q-3 `true`; Q-4 `false` / `false`; Q-5 version ≥ 15, `true`, `i`; Q-6 no rows. Any other answer: stop and tell SA before Task 3 (M-11).

### 7.1 Results (prod `jgccgkyhpwirgknnceoh`, run by TL on 2026-10-27, pasted before Task 3 per M-11)

| Query | Result | Matches expected |
|---|---|---|
| Q-1 | `requests_table` NULL, `jobs_table` NULL, `start_fn` NULL, `claim_fn` NULL, `reap_fn` NULL | ✅ |
| Q-2 | `is_20261094` = true | ✅ |
| Q-3 | `closures_present` = true | ✅ |
| Q-4 | `anon_create` = false, `auth_create` = false | ✅ |
| Q-5 | `server_version` 17.4, `has_gen_random_uuid` = true, `jsonb_path_exists_volatility` = `i` | ✅ |
| Q-6 | no rows at or above 20261095 | ✅ |

All six match. No §3 adjustment is needed from them.

---

## 8. Prod apply: the user's database paste procedure

A manual prod gate. **The user pastes the SQL** in the Supabase SQL editor (or TL does, with the user's OK in the session). **One pause window (SA M-9): admin deletes and test-account cleanup pause from step 5 (the 20261095 apply) until step 11 passes** (F-A: the live 94 function's G-10 does not know the two new links to the login), so steps 4 to 11 run in one sitting. Never paste a file from a working copy other than the rebased PR head CI ran green (W-12).

| # | Step | Who | Stop if |
|---|---|---|---|
| 1 | Gates: SA code review ✅, QA ✅ (replica, §6), user has seen the diff and approved (standing rule) | TL | any missing |
| 2 | **SR-5 pre-apply check.** (a) Branch rebased on current `origin/main` by RM, CI green. (b) `git show origin/main:scripts/generate-test-account-cleanup-sql.ts` shows `FUNCTION_MIGRATION = '20261094_operator_test_account_cleanup_account_closures'`, equal to this PR's `PREVIOUS_FUNCTION_MIGRATION`. (c) `origin/main` and the coordination file hold no other 20261095 / 20261096 file. (d) The coordination lock is still EXPORT's (E4). (e) If `origin/main` moved since the rebase, repeat (a)–(d) | TL | any mismatch: re-regenerate on the new main (new numbers if 95/96 are taken) |
| 3 | Send `[E→D] E4 pause window starting` to DELETE: no admin delete and no test-account cleanup until step 11 | TL | — |
| 4 | Run `scripts/precheck-export-requests.sql` | user | any row not `ok` (tables and functions absent; live stamp `792d801e13101316`; new stamp absent; closures table present; Q-4; `gen_random_uuid`) |
| 5 | Apply `supabase/migrations/20261095_business_os_export_requests.sql` | user | an exception (one transaction: nothing applied) |
| 6 | Run `scripts/check-export-requests-migration.sql` | user | any FAIL except the G-10 information row (expected FAIL until 96 is live) |
| 7 | Apply `supabase/migrations/20261096_operator_test_account_cleanup_export_requests.sql` | user | an exception: fix forward in the same sitting, or run the 95 rollback at once (§9) |
| 8 | Run `scripts/check-test-account-cleanup-export-requests-migration.sql` | user | any FAIL, **including the md5 row**. A md5 FAIL is resolved before the merge by comparing the pasted bytes (line endings) with the PR head, never ignored (CR-2) |
| 9 | Re-run the 95 checker | user | the G-10 information row is not `ok` now |
| 10 | **Enqueue the PR at once** (manual merge: migration-gated, not auto-merge) | user / RM | CI red and no landing this session: §9 rollback |
| 11 | After the Vercel deploy: `/admin/users` → Danger Zone **check** on a `+test` account answers with no `function_out_of_date` and no G-10 blocker on either export table | TL / QA | `function_out_of_date` persists past the deploy |
| 12 | Coordination log + messages: `[E→D] E4 migrations applied`, `[E→D] E4 merged`, `[E→D] E4 lock released — next regeneration chains on 20261096; MX-7 is last in the order`; release the lock row | TL | — |

---

## 9. Rollback

| Undo | How | Effect |
|---|---|---|
| 20261096 | `supabase/SQL Scripts/20261096_operator_test_account_cleanup_export_requests_rollback.sql` (generated; restores the 20261094 function byte for byte, stamp `792d801e13101316`) **and** revert the PR | The check and E answer `function_out_of_date` until code and DB agree (fails closed). **A 96-only rollback still blocks every check and delete on G-10** while the 95 tables exist (F-A), so a full restore is 96 rollback → 95 rollback → PR revert |
| 20261095 | `supabase/SQL Scripts/20261095_business_os_export_requests_rollback.sql` (hand-written): refuses if either table is missing, if the live cleanup body still names either table (96 live), or if either table holds a row; then `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` (both), drops the reap, claim and start functions, the jobs table, then the requests table | Safe while MX-1b is unshipped (nothing writes the tables). After MX-4 switch-on it refuses, by design |

---

## 10. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261095_business_os_export_requests.sql` | create | §3 |
| `supabase/SQL Scripts/20261095_business_os_export_requests_rollback.sql` | create | §9 |
| `supabase/migrations/20261096_operator_test_account_cleanup_export_requests.sql` | create (generated) | §5 — **S-1** |
| `supabase/SQL Scripts/20261096_operator_test_account_cleanup_export_requests_rollback.sql` | create (generated) | §5, §9 — **S-1** |
| `scripts/generate-test-account-cleanup-sql.ts` | modify | §5 constants, step B, inbound review — **S-1** |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | modify (generated) | the pasted `CHECK_FILE` / `DELETE_FILE` follow the plan — **S-1** |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | modify (generated) | new `CLEANUP_FUNCTION_VERSION` — **S-1** |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | T-7: `APPLIED` / `APPLIED_TARGET` pins, the "chains on" test, 94 block to literals, new 96 block — **S-1** |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify (older-version allow-list entries only) | T-8 — **S-1** (rules stay DELETE's) |
| `FUNCTION_REQUIRED_TABLES` (in the generator) | **unchanged** | D-3 — **S-1** item, recorded as checked |
| `scripts/precheck-export-requests.sql`, `scripts/check-export-requests-migration.sql`, `scripts/check-test-account-cleanup-export-requests-migration.sql` | create | §5, §8 |
| `lib/business-os/data-export/moduleExportPolicy.ts` | create | §4.1 |
| `lib/repositories/BusinessOsExportRequestRepository.ts`, `lib/repositories/BusinessOsExportModuleJobRepository.ts` | create | §4.2, §4.3 |
| `lib/business-os/purge/descriptors.ts` | modify (two rows, EXPORT anchor) | §4.4 — S-2 |
| `lib/business-os/businessOwnedTables.ts` | modify (two reasons, EXPORT anchor) | §4.4 — S-2 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify (counts only: 164 = 38 + 0 + 126) | T-6 (SA CR-3) |
| `lib/business-os/purge/__tests__/classification-baseline.json`, `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify (add only: two `never` levels, count 164) | T-6 |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | modify (add only) | T-9 |
| `supabase/migrations/__tests__/business-os-export-requests.migration.test.ts` | create | T-1 |
| `lib/business-os/data-export/__tests__/moduleExportPolicy.test.ts` | create | T-2 |
| `lib/repositories/__tests__/BusinessOsExportRequestRepository.test.ts`, `BusinessOsExportModuleJobRepository.test.ts`, `exportRequestRepositories.callers.guard.test.ts` | create | T-3 to T-5 |
| `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` | modify (one row) | version history: 20261096 |
| `docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md` | create / modify | this file |

**Not touched:** `lib/repositories/BusinessOsDataExportJobRepository.ts` (incl. `findDeletionFacts`, frozen), `jobPolicy.ts`, 20261074 / 20261075 / 20261093 / 20261094 and their rollbacks, `lib/repositories/types.ts` / `index.ts`, translations, `featureFlags.ts`, `docs/FEATURE_FLAGS.md`, `lib/audit/*`, `vercel.json`, `rateLimit.ts`, any route or component, every file in plan §7. The requirement's §6 status line is spliced by BA / a general-purpose agent after each stage, not by Dev in this PR.

---

## 11. Task list

- [x] 1. ✅ TL ran §7 Q-1 to Q-6 on prod (2026-10-27); results pasted in §7.1 before Task 3 (M-11). All match; no §3 adjustment.
- [x] 2. ✅ `moduleExportPolicy.ts` + T-2.
- [x] 3. ✅ Migration 20261095 + its rollback + T-1 (M-1 to M-5 folded into §3 / §6 first).
- [x] 4. ✅ `BusinessOsExportRequestRepository` + T-3 (M-7).
- [x] 5. ✅ `BusinessOsExportModuleJobRepository` + T-4.
- [x] 6. ✅ Callers guard T-5.
- [x] 7. ✅ Two descriptor rows + two `USER_OWNED_TABLES` reasons; counts 162 → 164 in the three count files (+ two baseline review notes); T-6 green.
- [x] 8. ✅ Generator constants, step-B group, inbound review entry; generated files clean before the run; generator run; `git diff --numstat` showed additions in every generated file, 20261094 and its rollback untouched. New stamp `b1203c526bc9ec91`.
- [x] 9. ✅ Drift test T-7 (94 pair moved to `APPLIED`, 94 block re-pinned to literals with `STAMP_94`, new 96 block, `APPLIED_TARGET` pins written last: `8947050f…642b516d` / `f05d8e27…d297fa70`).
- [x] 10. ✅ `no-deletion-paths` T-8 (M-4 form) and credit-lots T-9.
- [x] 11. ✅ Pre-check and two checker scripts, with their paste-safety assertions in T-1 and T-7 (M-8). 96 checker md5 gate `ef5388c5428da4c1266c68f451e221f9`.
- [x] 12. ✅ Runbook row; T-11 runs (see §11.2); `console.*` and entitlements greps on every touched file: none in code.
- [ ] 13. Hand to SA (code review) and QA (replica); changes left **uncommitted** for the user's diff review.

### 11.1 Deviations during implementation

| # | Deviation | Reason |
|---|---|---|
| D-16 | `business_os_export_module_jobs_notice_state_check` named on its own, so the jobs table has **12** named CHECKs (15 in all), not 11 | §3.2's column table gives `notice_state` a value list but the named-CHECK table had no row for it. Named so a failed write names it, and counted in post-condition 7 and checker row 8 |
| D-17 | The limit is `v_limit := CASE WHEN p_origin = 'owner' THEN 2 ELSE 2 END;` with `OFFSET (v_limit - 1) LIMIT 1`, not two `OFFSET 1` literals | M-5: one SQL site per mirror constant. The two `2`s are the two sites; the offset is derived, so it cannot drift from them. One counted-request query serves both origins. Folded into §3.3 |
| D-18 | The start function checks `array_ndims(p_modules) IS DISTINCT FROM 1` (with the NULL checks) in a first `IF`, before the other argument checks | `array_position` raises 0A000 on a multi-dimensional array, and SQL does not promise OR short-circuits. The first `IF` makes every bad shape a 22023 |
| D-19 | The `…_parts_shape` jsonpath also requires `@.n.type() == "number"` | The SA optimisation suggestion (non-blocking), taken: one more term in the same positive filter |
| D-20 | The history DTO also carries `requestId` | The drawer groups module lines per click (requirement §3.7); an id, never a Resend id, claim field or error code |
| D-21 | `reapStale` returns `{ id, userId, status, failureCode, noticeState }` (§4.3 said `{ id, status, failureCode }`) | MX-3 scopes each follow-up effect (the notice email) to the row's `user_id` (tenant-isolation-guard step 6) |
| D-22 | `moduleExportPolicy.ts` also exports `MODULE_JOB_TERMINAL` and the value-list types | T-2 proves in-flight and terminal partition the statuses; the repositories type their DTOs from the lists |
| D-23 | Pre-check row 9: `jsonb_path_query_array` and `jsonb_path_exists` exist and are immutable | M-1 moved the CHECKs to `jsonb_path_query_array`, which Q-5 did not read |
| D-24 | The runbook got the version row, one Change History row and one add-only rollback paragraph after the 20261094 one | The doc's own living-doc rules; nothing existing was edited (M-10 add-only) |

### 11.2 Test results (T-11)

| Run | Result |
|---|---|
| `lib/business-os/purge`, `lib/business-os/data-export`, `lib/business-os/__tests__`, `supabase/migrations/__tests__`, `scripts/__tests__/testAccountCleanupSql.test.ts`, callers guard | 129 of 130 suites, 4565 of 4567 tests. The one failure is `lib/business-os/__tests__/bookingNextStep.test.ts` (2 tests, Hebrew translation labels): a source scan of `translations/*.ts`, files this slice does not touch. It is the known local CRLF flake pattern, not caused by MX-1a |
| `lib/repositories/__tests__`, `lib/business-os/test-account-cleanup` | 124 of 124 suites, 2967 of 2967 tests |
| New suites alone | T-1 75, T-2 9, T-3 + T-4 46, T-7 drift 217 (all pass); T-5 passes inside the guard run |
| `app/__tests__/tailwind-css-escape.guard.test.ts` | 6 of 6 |
| `npx eslint` on the 13 touched TS files | clean |
| `npx tsc --noEmit` (8 GB heap) | completed with no OOM crash, and with the repo's 1852 existing errors. Filtered to touched files: only `exportClassification.test.ts(2029)` TS2353, on a line this slice did not edit (it predates MX-1a). None in any new file |
| Entitlements / `console.*` greps | none in any touched code file |
| Full `npm test` | not run (left to QA / CI) |

**Estimate:** 🟡 2.5 d (XC-17). Largest parts: the migration and its detectors (~0.9 d), regeneration and re-pinning (~0.75 d), repositories and guards (~0.6 d).

---

## 12. Acceptance criteria

From requirement §7 MX-1a, plus the slice's own:

- [ ] The new tables are server-write-only: RLS on, no anon or authenticated policy or privilege, access only through the two repositories (T-1, T-5, QA 1).
- [ ] The start function refuses a third owner request inside 24 h and a second while one is not terminal; fully failed or interrupted requests do not count; admin-started requests do not count to the owner (QA 3).
- [ ] The admin's own limit: a third admin send for the same owner inside 24 h is refused, and owner requests do not count against it (QA 3).
- [ ] The mirror-constants test fails when a SQL literal and its constant differ (T-1 controls).
- [ ] Claim never hands one job to two runners; reap applies the XC-9 rule (no part → retry, any part → interrupted, all accepted → sent) (T-4, QA 4–5).
- [ ] A `waiting` job can never carry a part (CHECK, QA 2).
- [ ] The regenerated cleanup function passes the drift test; a test-account cleanup and an anonymise remove both tables' rows; another account's job pointing at the target's request blocks (T-7, QA 7).
- [ ] Applied to prod and merged back to back; checker run, md5 row `ok`; lock released (§8).
- [ ] Descriptor count 164; `findDeletionFacts` untouched; no entitlements import; no added CI time.

---

## 13. Coordination

Plan §3 checklist; for E4 specifically:

| Item | E4 |
|---|---|
| Cleanup-regen lock | **Held by EXPORT since 2026-10-26** (coordination file). Released only after merge + apply + checker (§8 step 12) |
| Migration numbers | 20261095 + 20261096, reserved with slice and branch (CC-4). Re-checked against `origin/main` at PR open (C-8) |
| Chain base | `PREVIOUS_FUNCTION_MIGRATION = 20261094_operator_test_account_cleanup_account_closures`, live stamp `792d801e13101316` (D1 applied 2026-10-26) |
| Descriptor counts | From 162 to 164 (SA CR-3) |
| Shared files edited | `descriptors.ts`, `businessOwnedTables.ts` (S-2, EXPORT anchor, add only); the S-1 lock files listed in §10 |
| Out-of-list edits (SA M-10) | Two add-only edits outside S-1 / S-2, D1 precedent N-5: the version-history row in `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md`, and the 20261094 pair in the credit-lots L8 list (`business-os-credit-lots.migration.test.ts`). TL names both in the `[E→D] E4 workplan approved` coordination log line, so DELETE knows E4 touches them |
| Frozen interfaces | `findDeletionFacts` / `DataExportDeletionFacts` and `DownloadMyDataButton`: **not touched**. `findDeletionFacts` changes meaning only at MX-4 (announced there, S-3) |
| Files not to edit | Plan §7 (incl. the DELETE rules of `no-deletion-paths.guard.test.ts`, `receiptInput.ts`, `lib/business-os/test-account-cleanup/**` other than the generated version file) |
| Messages to `Admin user/business deletion button` (first line format) | `[E→D] E4 workplan approved` · `[E→D] E4 PR opened (HOLD: migrations 95/96)` · `[E→D] E4 pause window starting` (§8 step 3: no admin delete or test-account cleanup until the 96 build is live) · `[E→D] E4 migrations applied` · `[E→D] E4 merged` · `[E→D] E4 lock released — next regeneration chains on 20261096` · `[E→D] E4 blocker found` if any. Each is also a log line in the coordination file. Sent by the parent EXPORT session (TL), not by Dev |
| Parallel EXPORT work | E2 (MX-2a, `neuronforge-mx2a`) touches `csv.ts` and new `joinedCsv*.ts` only: no overlap |

---

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | Applying 95 pauses admin deletes and test-account cleanup until the 96 build is live (F-A) | Steps 4–11 in one sitting; DELETE warned in step 3; full restore order 96 → 95 → revert |
| K-2 | 96 applied from a stale branch (another regeneration landed first) | Lock held; SR-5 (b) in step 2; the generator lines conflict textually, so CI blocks a wrong merge |
| K-3 | The pasted bytes differ from the PR head (line endings) | md5 row is an operator gate (step 8) |
| K-4 | A job of one account linked to another account's request | Only the start function inserts jobs, from one argument; G-18 refuses it at cleanup; QA 7 proves it (D-4) |
| K-5 | The worker cron is down, so an owner's in-flight request blocks new ones indefinitely | The reaper ends every job (retry cap 3, then `failed`); the switch stays off until MX-3 + MX-4 ship the worker; MX-4 QA checks a stuck job ends |
| K-6 | A later product change to the limits (or BQ-30 answered differently) | One `CREATE OR REPLACE` migration of the start function plus the constant; the mirror test forces both to move together |
| K-7 | `jsonb_path_exists` CHECK behaves differently across PG versions | QA runs PG 15 and 17; Q-5 reads the prod version; 20261011 already uses it in a CHECK on prod |
| K-8 | A generator write truncates a file | `git diff --numstat` after each generated write; drift test |
| K-9 | Another stream takes 95/96 without reading the coordination file | SR-7 duplicate-prefix guard fails CI; re-check at PR open |

---

## 15. Open items for SA

| # | Item | Dev default |
|---|---|---|
| MX1A-1 | Numbers: 20261095 = tables + three functions, 20261096 = regeneration (SA-P1) | Yes (D-1) |
| MX1A-2 | Descriptor `never` + step B in both modes, rather than `purge` like the old table. Consequence: a business Reset or Purge keeps the history and the limit counter | `never` (D-2) |
| MX1A-3 | `FUNCTION_REQUIRED_TABLES` not extended (O-3), though C-8 required it for `business_os_data_exports` | Not extended (D-3); add both if SA prefers C-8 |
| MX1A-4 | `module_jobs.user_id` denormalised + single-column `request_id` FK + G-18 inbound review, rather than a composite FK that G-18 would not count | As D-4 |
| MX1A-5 | Failure-notice columns (`notice_state`, `notice_attempts`, `notice_sent_at`, `notice_resend_id`) built now, and the claim also taking `due` notices | Yes (D-11), so MX-3 needs no migration |
| MX1A-6 | Separate reap RPC with the four verdicts and the literals (lease 420 s, build attempts 3, notice attempts 5, backoff 60 s × attempts, batch 100) | Yes (D-9) |
| MX1A-7 | Owner and admin counted independently, each with its own "one in flight". Should an admin send be refused while the owner's own request is in flight (and the reverse)? | Independent (D-6). Asked in business terms in §16 |
| MX1A-8 | Lease as a literal in both predicates, no lease argument; claim batch clamped 1..10 | Yes (D-8, DL-1a W-2) |
| MX1A-9 | `parts` element shape enforced in SQL with `jsonb_path_exists` CHECKs, as well as Zod | Yes (20261011 precedent) |
| MX1A-10 | Module ids shape-checked only (SA-P6); duplicates refused by `UNIQUE (request_id, module)` and the start function | Yes (D-12) |
| MX1A-11 | `requested_email_sent_at` on the request, for MX-1b's "Export requested" email | Add now (saves a migration) |
| MX1A-12 | The owner's language and timezone are not stored on the request; MX-1b / MX-3 read them at send time, like the login email | Not stored |
| MX1A-13 | The worker's per-part write methods built in MX-3, not here | MX-3 (D-13) |
| MX1A-14 | No prod probe; QA proves behaviour on a local real-Postgres replica | Replica (D-15) |
| MX1A-15 | The `supabase-postgres-best-practices` skill is not installed here; general rules applied by hand (§1) | Proceed; SA flags anything it would have caught |
| MX1A-16 | `findDeletionFacts` is not touched in MX-1a; the new tables stay empty until MX-4 switch-on, so the receipt facts have no gap | Confirm |

---

## 16. Business questions for the user

| # | Question (plain language) | Suggested answer | Needed before |
|---|---|---|---|
| **BQ-30** (open, in the requirement) | When an admin sends an owner their export: is it the same module export to the owner's own login email, at most 2 a day per owner, and the admin never sees the data? | Yes, as suggested. **MX-1a's tables do not depend on the answer**: they already hold "who started it" (owner or admin) either way. Only the admin limit (2 a day) is written into the database start function. A different answer later costs one more database paste in MX-5 | Ideally **before the MX-1a database paste** (to avoid that extra paste); formally before MX-5 |
| BQ-30a (new, rides with BQ-30) | If an admin is sending an owner's export, may the owner start their own export at the same time, and the other way round? | Yes, they are independent: neither blocks or uses up the other's daily allowance | Same as BQ-30 |

No other business answer is needed for MX-1a. BQ-29 is answered (2026-10-26) and is what §3.3 builds. BQ-28 (max 10 emails), BQ-42 (7 MB) and BQ-43 (interrupted email) are MX-3's and are not written into this schema.

---

## SA Review Notes

**Reviewed by SA — 2026-10-26** (worktree `neuronforge-mx1a`, branch `feature/bos-export-mx1a-tables` on `a105fa4a`, nothing built yet; requirement with the uncommitted BQ-29 edit; plan; coordination file read only; D1 workplan + code on main as precedent)
**Status:** ⚠️ Approved with conditions M-1 to M-11. M-1 to M-4 change the bytes of 20261095 or the guard tests, so they are folded into §3 / §6 **before Task 3**. None needs a business answer.

### What was checked

- **Generator** (`scripts/generate-test-account-cleanup-sql.ts`): `FUNCTION_MIGRATION` = 94, `PREVIOUS` = 92 today; step A = `descriptorsForRun('purge', …)`, which drops every `never` descriptor, so a `never` table is only removed if it is in `FULL_REMOVAL_EXTRAS` (step B); the anonymise plan is the hard plan minus `KEEP_SET`; `tenancyForeignKeys()` reads the plan (both `user_id` links become tenancy keys automatically); G-10 and G-18 block any link with `key_width <> 1` (l.1330, l.1391), so a composite FK would block every check for ever; the step-B loop skips an absent table (`to_regclass … CONTINUE`, l.1648 / l.1841); `FUNCTION_REQUIRED_TABLES` only pre-guards the static names.
- **Descriptors:** `never()` helper, the `never` block, DELETE's closures row (l.1530) and the chosen anchor between `business_os_finance_snapshots` and `business_os_deletion_receipts` (both EXPORT-side or platform rows, not adjacent to DELETE's line). `businessOwnedTables.ts` anchor after `business_os_data_exports` (l.240). Counts today: 162 = 38 + 0 + 124 in `exportClassification.test.ts` l.302–304 / l.1361–1370, baseline `count`, invariant l.882. 164 = 38 + 0 + 126 is right.
- **20261074** start function (INVOKER, service_role-only EXECUTE, advisory lock, `OFFSET 2 LIMIT 1` for a limit of 3). **D1** files on main (93/94, checkers, guards, the SA W-/CR- rulings). `no-deletion-paths.guard.test.ts` l.104–250 and l.545–575 (R-7 naming rule, per-entry `shapes`). The credit-lots L8 list (l.806–830). 20261011 (the `jsonb_path_exists`-in-CHECK precedent). MX-0 ids (all 13 match `^[a-z][a-z0-9_]{1,39}$`). `accountDeletionPolicy.ts` has no non-test importer (dead, flagged only, correct).
- Skills: `durable-queue-drain`, `tenant-isolation-guard`, `new-repository`, `business-os-schema-check` (the §7 queries read only `pg_catalog` / `to_regclass`; nothing on an existing table is claimed beyond `auth.users` and `business_os_account_closures`). No entitlements import planned.

### Rulings on the open items

| # | Ruling |
|---|---|
| MX1A-1 | ✅ 95 = tables + three functions, 96 = regeneration, applied in that order in one sitting (74→75, 80→81, 93→94). Matches the coordination reservations. |
| MX1A-2 | ✅ **`never` + step B in both modes** (D1 O-2 shape). What it means: **a business Reset or Purge keeps the export history and the daily counter** (so "purge, then export again" cannot bypass BQ-29, and the MX-4 receipt facts survive). **An account deletion does not keep it:** stage E (the anonymise) removes both tables in step B because they are not in `KEEP_SET`; the hard test-account delete removes them in step B; and any delete of the login cascades through both `user_id` FKs. During stages A–D the history stays, which is what MX-5 (send to a locked account) and the MX-4 receipt read before E need. This matches requirement §4.4 ("kept until the account is deleted and removed with it at stage E") and DELETE's XC-1 treatment of its own closure row, so there is no conflict with §11. The only thing that outlives an account is `admin_actor_id` on **another** owner's rows when the **admin's** own account is deleted: a bare uuid with no FK, the 20261074 `requested_by` precedent. Accepted. |
| MX1A-3 | ✅ Not extended. O-3 (DL-1a, newer) governs: the plan names both tables only as `VALUES` literals and the loop skips an absent table, so no 42P01 is possible. C-8 was about a table the 75 plan treated as required; it stays for `business_os_data_exports` until MX-7. T-7 asserts both tables are absent from `FUNCTION_REQUIRED_TABLES` **and** that the 96 body names them only inside the plan / review `VALUES` lists. |
| MX1A-4 | ✅ D-4 as written. A composite FK would be refused by G-10 / G-18 (`key_width <> 1`) on every check. Same-owner is held by: only the start function inserts jobs (no insert method on either repository; T-5 guard), both ids from one argument, and G-18 refusing a foreign job row at cleanup (QA 7). Subject to **M-3** (constraint name). |
| MX1A-5 | ✅ Build the notice columns now; it saves MX-3 a second manual gate and makes the notice a durable effect. Subject to **M-2**. MX-3 must also give the notice send a Resend idempotency key (`export-notice:{job_id}`), because a re-claimed notice after a crash is otherwise a possible second email. Recorded here for the MX-3 workplan; nothing to build now. |
| MX1A-6 | ✅ Separate reap RPC. XC-9 makes a stale job's fate depend on its parts, which the lease-in-predicate variant cannot express. The notice branch keeps lease-in-predicate. Cite both models in the migration header and the repository doc-comment as a ruled deviation from the skill's DEFINER / `p_lease_seconds` shape (DL-1a O-4 precedent). Subject to **M-6**. |
| MX1A-7 | ✅ technically: independent counters, each origin with its own "one in flight", serialised by one advisory key per account. Safe either way. The business side is BQ-30a (below). |
| MX1A-8 | ✅ Lease literal `420 seconds` in the claim (notice branch) and the reap, no argument (W-2). Batch clamp 1..10 / reap 100. |
| MX1A-9 | ✅ in SQL as well as Zod, **in the M-1 form**. As drafted, `!(@.state == "sending" \|\| @.state == "accepted")` lets a non-string state through: in jsonpath a comparison of a number (or object) with a string is *unknown*, `!unknown` is unknown, the filter drops the element, and `jsonb_path_exists` returns false, so the CHECK passes. In lax mode a nested array element is also unwrapped. |
| MX1A-10 | ✅ Shape only (SA-P6). Add to T-2: every `EXPORT_MODULE_IDS` value matches `CODE_SHAPE` (so the CHECK can never refuse a real module). For the claim parse, validate `module` by shape, not by the enum, so a module renamed later reaches the worker (which fails it with a code) rather than being dropped on every claim. |
| MX1A-11 | ✅ Add `requested_email_sent_at` now. |
| MX1A-12 | ✅ Not stored. The login email, language and timezone are read at send time (§4.3). |
| MX1A-13 | ✅ Worker writes in MX-3, compare-and-set on `id` + `claimed_by` + expected `status`, `{ count: 'exact' }` (PostgREST update + select hazard). Note for MX-3: `…_claim_shape` forces `sent` to clear the claim, and `…_notice_shape` forces `failed` / `interrupted` to set `notice_state = 'due'` in the same update. |
| MX1A-14 | ✅ Replica (embedded PG 15 + 17), no prod probe. Prod and preview share one database; DE-8a's rolled-back probe is not repeated. |
| MX1A-15 | ✅ Proceed. What that skill would flag is covered: every FK has a leading-column index (`(request_id, module)`, `(user_id, created_at)`, `(user_id, requested_at)`), partial indexes on each queue predicate, `search_path` pinned, RLS on. Expect the Supabase advisor's INFO lint "RLS enabled, no policy" on both tables: intended (server-write-only), as for 20261074 / 20261093. |
| MX1A-16 | ✅ Confirmed. `findDeletionFacts` is not touched; no row can exist before MX-1b's route, which ships behind `isModuleExportEnabled()` off. **Note for MX-1b:** preview and prod share one database, so the switch must not be turned on in preview before MX-4 re-sources the facts, or the receipt would miss those rows. |

### Start function, limits and paste procedure (checked as asked)

- **INVOKER yet service_role-only:** ✅. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then `GRANT EXECUTE … TO service_role` also undoes Supabase's default function grants; post-conditions check grantee 0 / anon / authenticated. Even if EXECUTE leaked, INVOKER would leave a browser role without table privileges.
- **Caller-supplied ids (tenant-isolation-guard):** `p_user_id` is the session user (`startForOwner`) or the admin route's path id (`startForAdmin`, MX-5), and `p_admin_actor_id` the `requireAdmin` id; never a body field. The SQL cannot prove those, so T-3 must show the repository passes exactly its arguments, and MX-1b / MX-5 tests prove the route sources. ✅
- **Advisory lock:** one key per account for both origins, taken before any read; under READ COMMITTED each later statement sees the other transaction's committed insert. ✅ (20261074 shape; a distinct prefix from the ZIP key, which is fine.)
- **Rolling 24 h and `OFFSET 1`:** ✅. With in-flight returned first, every counted request at the limit check is terminal, so the count cannot pass 2. `retry_at` = (limit-th newest counted request) + 24 h, which is right in general (also if a later limit change leaves 3 counted). `requested_at > now() - 24 h` and `retry_at = requested_at + 24 h` agree at the boundary. X-7 gives 12th 10:00. ✅
- **Not counted:** a request with every job `failed` / `interrupted`. In-flight jobs count, which is correct. A request with zero jobs would count as neither (it cannot exist: the jobs are inserted in the same transaction). ✅
- **Admin counter separate:** per owner by `user_id = p_user_id AND origin = 'admin'`, across all admins. ✅ Subject to **M-5**.
- **Paste procedure:** order precheck → 95 → 95 checker (G-10 information row FAIL is expected, and must flip to `ok` in step 9) → 96 → 96 checker with the md5 row as a gate (CR-2) → enqueue → post-deploy check → release. ✅. The rollback order 96 → 95 → revert is right, and the 95 rollback refuses while the live body names either table. ✅. "into": `INSERT INTO` keywords inside the dollar-quoted body only (applied before in 74 / 81 / 94); no `SELECT … INTO` / `RETURNING … INTO`. ✅ Subject to **M-8**, **M-9**.
- **Boundary (SR-10, S-1, S-2):** every edited file is EXPORT's own, an S-1 lock file, or an S-2 add-only file at an EXPORT anchor. Two edits fall outside those lists, both add-only with the D1 precedent: the runbook version row and the credit-lots L8 list (**M-10**). No DELETE file, rule, or plan §7 file is edited. Counts become **164**, not 162. ✅

### Conditions

| # | Condition | Priority | Where |
|---|---|---|---|
| **M-1** | **Part-shape CHECKs in positive form.** Prove every element is valid rather than look for an invalid one, e.g. `jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.type() == "object" && @.state.type() == "string" && (@.state == "sending" \|\| @.state == "accepted"))')) = jsonb_array_length(parts)` (or a separate `NOT jsonb_path_exists(parts, 'strict $[*] ? (!(@.state.type() == "string"))')` beside the current one). Use the same form for `…_sent_shape` ("every element accepted" = count of accepted elements = `parts_total`) and for the reaper's "every part accepted" verdict. Guard `jsonb_array_length` behind `jsonb_typeof(parts) = 'array'` with a `CASE`, because AND does not short-circuit in a CHECK. QA 2 adds negatives: a numeric, null, boolean, object and missing `state`, and a nested-array element. Q-5 stays (immutability) | Medium | §3.2, §3.5, T-1, QA 2 |
| **M-2** | **Notice claim bounded on its own.** Add `AND j.notice_attempts < 5` to the notice branch of the claim (a literal pinned to `NOTICE_MAX_ATTEMPTS`), so that a notice cannot be claimed a sixth time if a run skips or fails the reap. The reaper's `>= 5` "given up" verdict stays. QA 4: a `due` row at 5 attempts is never claimed | Medium | §3.4, T-1, QA 4 |
| **M-3** | **Name the FK constraints in 20261095** (`CONSTRAINT business_os_export_module_jobs_request_id_fkey FOREIGN KEY …`, and the two `user_id` ones by name), and check the names in the post-conditions. T-7 asserts that the `INBOUND_FOREIGN_KEYS` entry equals the name in the 95 file, so a rename cannot leave G-18 blocking on an unreviewed link | Medium | §3.2, §3.6, T-7 |
| **M-4** | **T-8 and R-7:** the 20261092 entry in both allow-lists (and the l.562–567 assertion) is built from the generator constant, `INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261092')` + `_meeting_links.sql`, like the 77 / 75 / 47 entries. It is not a string literal: its file name spells the cleanup function, and this guard file must not name it (R-7; 20261081 is literal only because its name does not). "Literal" in T-8 means "named on its own, no longer through `PREVIOUS_MIGRATION_FILE`" | Medium | T-8 |
| **M-5** | **One SQL site per mirror constant.** Write the owner and admin limits as two separate literal sites (for example two branches, each with its own `2` and `OFFSET 1`), so that T-1 pins `OWNER_DAILY_LIMIT` and `ADMIN_DAILY_LIMIT_PER_OWNER` to different sites. A negative control proves that changing one constant fails only its own pin. The same applies to `420 seconds` (claim and reap: two sites, both pinned) | Low | §3.3, T-1 |
| **M-6** | **Reaper precedence in one `CASE`, in this order:** sent → interrupted → failed (3 attempts) → retry. QA 5 adds: every part accepted but fewer than `parts_total` → interrupted; `parts_total` set with no part → retry with `parts_total` cleared | Low | §3.5, QA 5 |
| **M-7** | **Start result handling in the repository:** zero rows or more than one → error; `22023` → an invalid-arguments code; `23503` (no such login) → its own code. None is retried. T-3 covers each case | Low | §4.2, T-3 |
| **M-8** | **Paste-safety scan scope:** T-1 / T-7 apply the "no `into` in any literal or comment, no `;` or `'` in comments" check to the 95 migration **and its rollback** and to all three scripts, with CRLF normalised before the scan (Jest flake pattern #394) | Low | T-1, T-7 |
| **M-9** | **One pause window, worded once:** the pause runs from step 5 until step 11 passes, and steps 4 to 11 run in one sitting. The §8 intro now says "4 to 10", while step 3 and K-1 say step 11. In §9, keep "fix forward or run the 95 rollback at once" for a step-7 failure | Low | §8 |
| **M-10** | **Out-of-list edits recorded:** the runbook version row and the credit-lots L8 entry (add only, D1 precedent N-5) are named in the `[E→D] E4 workplan approved` coordination log line, so DELETE knows E4 touches them | Low | §13 |
| **M-11** | **Schema facts before the SQL:** Task 1's Q-1 to Q-6 results are pasted here **before Task 3** (the migration), not only before Task 4. Q-6 may error if the history table is absent; that counts as "no rows" | Low | §7, §11 |

### Optimisation suggestions (not blocking)

- The 95 post-condition "no other table has a FK into either" should read "no FK into either table except `jobs.request_id`", so its text matches what it checks.
- `…_parts_shape` may also check that `n` is a number (`@.n.type() == "number"`). Zod already checks `n` in the claim parse; uniqueness of `n` stays with MX-3.
- When MX-3 lands, add the two-model note (a reaper for builds, lease-in-predicate for notices) to `durable-queue-drain`, together with the DL-1a variant SA already suggested.
- The plan §4.4 still names the branch `feature/bos-export-mx1a-schema`. The real branch is `-tables` (coordination file). Fix it in the plan's next docs touch.

### Business questions (plain terms)

- **BQ-30 / BQ-30a block neither this workplan nor the database paste.** The tables record who started an export either way. Only two rules go into the database now: an admin may send at most 2 a day per owner, and owner and admin exports do not block each other. If the user later answers differently, the fix is one small database change to the start function in MX-5, with no cleanup regeneration and no pause of admin deletes. Asking before the paste saves that one extra step, so it is worth asking now, but the paste does not wait for it.
- **New, for BA to number (needed before MX-3, does not block MX-1a):** a request where every module failed does not count towards the 2 a day (BQ-29). That includes "too large to email". So an owner whose module is too large could ask again every few minutes and get a "too large" email each time. Should a "too large" failure count towards the daily limit? Suggested answer: yes for "too large" only, because retrying cannot help; other failures stay uncounted. A "yes" changes only the start function's "not counted" rule: the same one-step database change as above.

### Approval

[x] Workplan approved with conditions M-1 to M-11. Fold M-1 to M-5 and M-11 into §3, §6 and §7 before Task 3. M-6 to M-10 may be folded into §3 to §8 at any point before hand-over to SA code review. No business answer is needed to start.

## SA Code Review — 2026-10-27

**Code Review by SA — 2026-10-27** (worktree `neuronforge-mx1a`, branch `feature/bos-export-mx1a-tables`, merge base `a105fa4a`, everything uncommitted; coordination file read only)
**Status:** ✅ Code Approved for QA. No code fix is required. Two gate conditions (G-1, G-2) apply before the prod paste; they are checks, not edits.

### What was checked

- **20261095** in full (491 lines), its rollback, the pre-check and both checkers, the generator diff, the generated 96 against the committed 94 (`diff`: only the header, the two step-B rows in each plan copy, the two tenancy rows, the one inbound-review row and the stamp change; 94 and its rollback are untouched), both repositories, `moduleExportPolicy.ts`, the descriptor / ownership / baseline / count edits, the guard and drift-test diffs, the runbook and credit-lots edits, the user's BQ-29 edit in the requirement (kept, 2 + / 1 −).
- **SR-5 drift at review time:** `origin/main` is 46 commits past the base (`033e034c`), but none of them touches the generator, `lib/business-os/purge/**`, `businessOwnedTables.ts`, the cleanup drift test or any migration ≥ 20261095. `origin/main`'s `FUNCTION_MIGRATION` is still `20261094_…account_closures` = this branch's `PREVIOUS`. The coordination file still shows the cleanup-regen lock and 95 / 96 held by E4. The RM rebase must repeat the check (§8 step 2).
- **Tests run by SA:** `supabase/migrations/__tests__`, `scripts/__tests__/testAccountCleanupSql.test.ts`, `lib/repositories/__tests__/BusinessOsExport*`, the callers guard, `lib/business-os/purge`, `lib/business-os/data-export`, `lib/business-os/test-account-cleanup`: **91 of 91 suites, 3932 of 3932 tests green.** `lib/business-os/__tests__/bookingNextStep.test.ts` on the **main checkout** (`1baf1f9b`, none of this slice): the same 2 failures ("has a label in every language", "and a handler in the card that runs it"), 54 pass. So it predates this slice and is not caused by it.

### Conditions M-1 to M-11

| # | Met | Where |
|---|---|---|
| M-1 | ✅ Positive-form jsonpath, `strict`, CASE-guarded, with the `@.n.type()` term (D-19), in `…_parts_shape`, `…_sent_shape` and the reaper's "sent" verdict | 20261095 l.127–137, l.292–295; T-1 l.207–282 |
| M-2 | ✅ `job.notice_attempts < 5` in the claim's notice branch, pinned separately from the reaper's `>= 5` | l.258; pins `NOTICE_MAX_ATTEMPTS@claim` / `@reap` |
| M-3 | ✅ All three FKs named, post-condition 5 checks each name, the column, the target, CASCADE and single-column; T-7 pins the `INBOUND_FOREIGN_KEYS` entry to the 95 name; 96 checker rows 8 and 10 | l.61–62, l.102–105, l.400–415 |
| M-4 | ✅ The 20261092 entries in both allow-lists are built from `INITIAL_FUNCTION_MIGRATION`, with `ALL_AUTH_WRITE_SHAPES`; the l.578–591 test asserts both ways; the DELETE rules are unchanged | `no-deletion-paths.guard.test.ts` |
| M-5 | ✅ See D-17 below | l.214; T-1 l.81–107, l.416–455 |
| M-6 | ✅ One `CASE` in the order sent → interrupted → failed → retry → given up; T-1 asserts the order and a single `CASE` | l.291–300 |
| M-7 | ✅ Zero / several rows or a wrong shape → `unexpected_result`; `22023` → `invalid_arguments`; `23503` → `unknown_account`; none retried | `BusinessOsExportRequestRepository.ts` l.170–211; T-3 l.131–155 |
| M-8 | ✅ The scan covers the 95 migration, its rollback and the three scripts, with CRLF normalised; a negative control plants an `into` and an apostrophe. A manual grep by SA agrees: `into` appears only as the two `INSERT INTO` inside `$start$`, and no comment holds `;` or `'` | T-1 l.564–611 |
| M-9 | ✅ §8 intro: pause from step 5 until step 11 passes, steps 4 to 11 in one sitting | §8 |
| M-10 | ✅ Named in the coordination log line of 2026-10-27 (credit-lots L8 + runbook row) | coordination file |
| M-11 | ✅ §7.1 holds the results, pasted before Task 3 | §7.1 |

### Deviations D-16 to D-24

| # | Ruling |
|---|---|
| D-16 | ✅ `…_notice_state_check` named on its own; 12 named CHECKs on jobs, 15 in all, and post-condition 7 / checker row 8 count 12. Better than folding it into another constraint. |
| D-17 | ✅ **Meets M-5.** M-5 asked that each mirror constant own one SQL literal, so a change to one fails only its pin. `CASE WHEN p_origin = 'owner' THEN 2 ELSE 2 END` holds two separate literal sites. T-1 reads them as two capture groups pinned to two constants. The negative controls work in both directions: a SQL change of either `2` fails only its own pin (l.421–427), and a +1 on either constant fails only that constant's pins (l.441–449). `OFFSET (v_limit - 1)` is derived, so it is not a third site and cannot drift. It is also better than two `OFFSET 1` branches: one counted-request query serves both origins, so the window and the not-counted rule cannot drift between the branches. The 95 checker row 11 pins the same text on the live body. |
| D-18 | ✅ `array_ndims(p_modules) IS DISTINCT FROM 1` in the first `IF` also catches the empty array (`array_ndims('{}')` is NULL), so `cardinality < 1` in the second `IF` is redundant but harmless. |
| D-19 | ✅ The SA suggestion, taken. |
| D-20 | ✅ `requestId` is an id the owner already owns; no Resend id, claim field or code leaves the repository. |
| D-21 | ✅ `userId` in the reap result is what tenant-isolation-guard step 6 needs for the MX-3 notice. The log line carries only ids, statuses and codes. |
| D-22 | ✅ `MODULE_JOB_TERMINAL` plus the type exports; T-2 proves the partition, and `EXPORT_MODULE_IDS` ⊂ `CODE_SHAPE` (the MX1A-10 test asked for). |
| D-23 | ✅ The pre-check row 9 covers `jsonb_path_query_array`, which the CHECKs now use. |
| D-24 | ✅ Add-only: one version row, one rollback paragraph, one Change History row. Nothing existing was edited. |

### Focus points

- **RLS and grants:** both tables `ENABLE ROW LEVEL SECURITY`, no policy, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` (l.164–174). Post-conditions 1–3 check table **and** column privileges for `public` / `anon` / `authenticated`, and that `service_role` lacks TRUNCATE / REFERENCES / TRIGGER (20261074 / 20261093 shape). ✅
- **Function headers:** all three are `SECURITY INVOKER`, `VOLATILE`, `SET search_path = pg_catalog, public, pg_temp`, EXECUTE revoked from PUBLIC / anon / authenticated / service_role and granted to service_role. Post-condition 8 checks `NOT prosecdef`, `provolatile`, `proconfig`, no grantee 0, and anon / authenticated / service_role EXECUTE. The INVOKER choice is a ruled deviation, and both headers cite it. ✅
- **Advisory lock:** `pg_advisory_xact_lock(hashtextextended('business_os_export_request:' || p_user_id, 0))` is taken after the argument checks and before the first read (l.200–201). One key per account covers both origins. In plpgsql under READ COMMITTED, each later statement takes a new snapshot, so the second caller sees the first caller's committed insert. ✅
- **Claim:** `FOR UPDATE SKIP LOCKED` inside the `due` CTE; lease literal `420 seconds` on the notice branch. The build branch needs no lease test, because `…_claim_shape` forbids a claim on `waiting`. Batch clamped 1..10, NULL runner → 0 rows; the counters move per branch. ✅
- **Reap CASE order:** checked against every CHECK. **sent** clears the claim (claim_shape), sets `sent_at` and `finished_at`. **interrupted** is only reachable with `parts > 0` (failure_shape). **failed** and **interrupted** set `notice_state 'due'` (notice_shape). **retry** is only reachable with zero parts and clears `parts_total`, so `…_waiting_has_no_parts` holds. The notice branch is disjoint from `working`, because notice_shape forces `none` on a non-terminal row. ✅
- **Tenant isolation (tenant-isolation-guard):** `startForOwner` takes the session id only; `startForAdmin` takes the path id and the admin id (MX-5). Neither takes a body id; the callers prove the source in their own tests. `findByIdForUser` filters `.eq('id').eq('user_id')`; `listHistoryForUser` filters `.eq('user_id')`. `claimDue` / `reapStale` are marked ⟨unscoped-by-design⟩ and return `user_id` for step 6. Neither repository has an insert (the T-5 guard asserts it), so D-4 holds. ✅
- **PostgREST update + `.or()` + `.select()` (42703):** there is no update in this slice; the hazard is recorded in the header for MX-3. ✅
- **Pino, not console:** no `console.*` in any new or touched code file; errors are passed as `{ err }` through `toError`, which keeps only code and message. ✅
- **Paste safety:** see M-8. The 96 files are generated, and the T-7 paste tests cover them. ✅
- **Tailwind-scanned dirs:** no backslash-hex escape in any new `lib/` file. `supabase/`, `scripts/` and `docs/` are `@source not` in `app/globals.css`. ✅
- **SR-10 boundary:** EXPORT-owned new files; the S-1 lock files (generator, generated check / delete / 96 / rollback / version, drift test, the older-version allow-list entries only); S-2 add-only at the EXPORT anchors (`descriptors.ts` after `business_os_finance_snapshots`, `businessOwnedTables.ts` after `business_os_data_exports`); plus the M-10 runbook and credit-lots edits. Not touched: DELETE rules, `receiptInput.ts`, `findDeletionFacts`, `jobPolicy.ts`, 74 / 75 / 93 / 94, `types.ts` / `index.ts`, translations, flags, `vercel.json`. No entitlements import. ✅
- **Count:** 164 = 38 + 0 + 126 in `exportClassification.test.ts` (both sites), baseline `count` + two `never` levels + two review notes, invariant `baseline.count`. ✅
- **Generated 96:** the stamp `b1203c526bc9ec91` agrees in `cleanupFunctionVersion.generated.ts`, the pre-check rows 4 and 5 and the 96 checker rows 5, 6 and 11 (md5 `ef5388c5…`); `APPLIED_TARGET` was written last; the drift test is green. The step-B order puts jobs before requests in all six plan copies. ✅

### Gate conditions (no code change; before §8 step 4)

| # | Condition | Priority |
|---|---|---|
| **G-1** | **Index-predicate text (Dev's flag).** Post-condition 6 (l.428–435) and checker row 7 expect `WHERE (status = 'waiting'::text)` (and the `notice_state` / `working` forms) from `pg_indexes.indexdef`. SA's reading: this is the canonical `pg_get_indexdef` output for a single-equality partial predicate, the same deparser that produced the `WHERE (status = ANY (ARRAY[…]))` form 20261093 matched on prod. It has not been run on a real database. A wrong guess **fails closed** (the post-condition raises and the one transaction applies nothing), so it costs a failed paste, not bad state. QA 1 must show a clean 95 apply on **PG 17** (prod is 17.4) with post-condition 6 passing and checker row 7 `ok`. If it does not, Dev corrects the LIKE text in both files before any paste. | Medium (gate) |
| **G-2** | **SR-5 at the rebase.** RM re-runs §8 step 2 (a)–(e) on the rebased head. If any of the 46 newer main commits, or later ones, moved the generator, a hotspot file or a migration number, re-generate and re-pin before the paste. Today none has. | Medium (gate) |

### Code Review Comments (non-blocking)

1. `lib/repositories/BusinessOsExportModuleJobRepository.ts:208` — `listHistoryForUser` limits **job rows**, so the 100th row can cut a request's module lines in half. All jobs of one request share one `created_at` (one transaction), so the order among them is arbitrary. For MX-1b: add a tie-break (`.order('module')`), and either limit by request or document that the oldest group may be partial. — Low
2. `lib/repositories/BusinessOsExportModuleJobRepository.ts:210` — the history parses all rows at once (`z.array(...).parse`), so one malformed part fails the owner's whole history. The claim, by contrast, drops one row. The SQL CHECK proves only `n` and `state`, while `modulePartSchema` also requires `resend_id` and `at`. **For the MX-3 workplan:** every part write carries all four keys, or the history schema reads only `state`. — Low
3. **For MX-3 (recorded, nothing to build now):** when the worker marks its own job `failed` / `interrupted` without clearing the claim, the notice waits out the 420 s lease before another run can claim it. Either clear the claim in that same compare-and-set or send the notice in the same run. — Low
4. `supabase/migrations/20261095_business_os_export_requests.sql:193` — `cardinality(p_modules) < 1` is unreachable after the D-18 first `IF`. Harmless. Leave it, because the file's bytes are pinned. — Low

### Optimisation Suggestions

- Checker row 13 (`both tables hold no row yet`) reads the tables directly, so on a database without 95 the whole query errors instead of answering FAIL rows. That is acceptable, because the checker runs only after 95. A `to_regclass` guard would make it fail soft if it is ever reused.

### Code Approved for QA: **Yes** (G-1 is proved by QA 1 before the paste; G-2 is checked by RM at the rebase)

## QA Testing Report

*(QA populates)*

## Commit Info

*(RM populates)*

## QA Report — 2026-10-27

**QA — 2026-10-27** (worktree `neuronforge-mx1a`, branch `feature/bos-export-mx1a-tables` on `a105fa4a`, uncommitted; nothing committed or stashed by QA)
**Test mode:** full (§6 "What QA exercises" items 1–8, plus the TL brief priorities 1–7)
**Strategy used:** B + C. A **local replica** on real PostgreSQL servers (embedded-postgres **17.10** and **15.18**), not PGlite, so `FOR UPDATE SKIP LOCKED` and the advisory lock were tested with several connections. The DL-1a harness was reused: the public schema is rebuilt from the prod introspect shape, the auth stub matches DL-1a Q-2/Q-3, roles are `anon`, `authenticated` and `service_role` (BYPASSRLS), the owner is `postgres`, with Supabase's default privileges (ALL on new tables and functions to the three roles). The real repo migrations were applied in prod order 41 → 77 → 80 → 81 → 92 → 93 → **94** (live stamp `792d801e13101316`, body md5 `8c4fc3c2…f548`), then 95 and 96. **The whole harness ran on both versions.** Jest (A) ran in the worktree.
**Focus:** schema, security, api (repositories)
**Skipped:** any Supabase connection. No DDL or write was run against prod `jgccgkyhpwirgknnceoh` or any other project. §8 step 11 (post-deploy Danger Zone check) is for TL after the apply.
**Input source:** prompt keywords (TL brief) + workplan §6 QA list + SA Code Review gate G-1
**Harness (scratchpad, not in git):** `…\scratchpad\qa-mx1a\epg\qa95.mjs` (+ `lib.mjs`, `seed.mjs`, `auth_ddl.part`; the same files in `epg15\` for PG 15), `extra.mjs`. Outputs: `out17.txt`, `out15.txt`, `jest-named.txt`.
**Bytes tested** (sha256 prefix, LF, all seven files have 0 CR): 95 `1011573025a35c27`, 95 rollback `4a01573e0b5b5eb2`, 96 `8947050f96fc645e` (= `APPLIED_TARGET`), 96 rollback `f05d8e27c158e563` (= `APPLIED_TARGET`), pre-check `2307894e2ea36432`, 95 checker `0b259ccaa5e08071`, 96 checker `b38648359d85eafd`. W-12: the pasted bytes must be these, or the rebased PR-head bytes after a re-run of this harness.

### Results

| Run | Result |
|---|---|
| PG 17.10, full harness | **251 / 251 PASS** |
| PG 15.18, full harness | **250 / 251.** The one FAIL is the harness's own ACL string: PG 15 has no MAINTAIN privilege, so the owner's ACL prints `postgres=arwdDxt` and not `arwdDxtm`. The `service_role=arwd` and `service_role=X` entries are the same on both versions. **Not a defect** |

### Test Coverage

| § 6 item / brief | Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|---|
| Set-up | Replica on 94, pre-check before 95 | ✅ | Pass | 94 check on a `+test` account: OK, version `792d…`. Pre-check: 9/9 `ok`, also inside a `READ ONLY` transaction |
| 1 | 95 pre-guards refuse and create nothing | ✅ | Pass | 9 cases: anon, authenticated or PUBLIC CREATE on public; either table exists; any of the three functions exists; `business_os_account_closures` missing. Each refused with its own message and left `00000` objects. **Not exercisable:** the `gen_random_uuid()` guard (it is a PG 13+ core function and cannot be removed) |
| 1 | Post-conditions, mutation test | ✅ | Pass | **28 broken copies**, each raised its own post-condition (1–8) and rolled back to `00000`: RLS off (each table), a policy, anon SELECT, authenticated column UPDATE, PUBLIC SELECT, table REVOKE removed (default privileges leak), service_role TRUNCATE, service_role without DELETE, a trigger, request FK RESTRICT, both FK renames (M-3), an inbound FK from another table, a third FK, unique index missing, waiting predicate widened, notice index missing, working predicate removed, per-user index missing, a requests CHECK renamed, `notice_state_check` dropped (D-16), claim DEFINER, start STABLE, reap search_path, reap REVOKE removed, start granted to authenticated, claim GRANT missing. A second apply refuses |
| 1 / brief 1 / **SA G-1** | **Index predicate text (post-condition 6, checker row 7)** | ✅ | **Pass, G-1 met** | `pg_get_indexdef` / `pg_indexes.indexdef` prints the same on **PG 17.10 and 15.18**: `… USING btree (next_attempt_at NULLS FIRST, created_at) WHERE (status = 'waiting'::text)`, `… (created_at) WHERE (notice_state = 'due'::text)`, `… (claimed_at) WHERE (status = 'working'::text)`. `pg_get_expr(pg_index.indpred)` prints `(status = 'waiting'::text)` and the others the same way. The `LIKE '%WHERE (status = ''waiting''::text)'` patterns match exactly: post-condition 6 passes on a clean apply, and checker row 7 is `ok`. Unique index: `… USING btree (request_id, module)`. No change to the LIKE text is needed |
| 1 | Grants and shape after a clean apply | ✅ | Pass | Both table ACLs `{postgres=arwdDxtm/postgres,service_role=arwd/postgres}`. All three function ACLs `{postgres=X/postgres,service_role=X/postgres}`, INVOKER, VOLATILE, `search_path=pg_catalog, public, pg_temp`. Exactly 15 CHECKs (3 + 12). anon and authenticated: SELECT, INSERT and EXECUTE of start, claim and reap each → 42501. service_role INSERT works (RLS on, no policy, BYPASSRLS) |
| 2 / brief 4 | Every named CHECK refuses its violation (M-1) | ✅ | Pass | **~85 cases**, each matched to its **named constraint**. Requests: origin, admin shape both ways, `{}`, 33 modules (32 accepted), NULL element, only NULL, `''`, `['crm','']`, `'crm,payments'`, `'crm,'`, uppercase, 1 char, 41 chars (40 accepted), free text, leading digit, unknown user (23503). Jobs: duplicate module (23505 `…_one_per_module`), status, notice_state, module, failure_code and last_error_code free text, every count, resend id 129 (128 accepted), claim pair, claim shape (working with no claim, waiting or sent with a claim), **waiting with a part, and waiting with `parts_total` (D-10)**. **Parts (M-1):** numeric, null, boolean, object, array and missing `state`; a bad state word; **a nested-array element**; a number and a string as an element; `n` as a string, missing or null; one good element and one bad; `parts` as an object, a string or JSON null; 3 parts of 2; a part with `parts_total` NULL. All refused by `…_parts_shape`. Sent with a `sending` part, fewer parts than the total, no `sent_at`, no `parts_total`; `sent_at` on a working row. Failure, notice and finished shapes, both ways. FK 23503 on both job links. Valid working, sent, failed, interrupted and notice-sent rows are accepted |
| 3 / brief 2 | Start function, owner | ✅ | Pass | 1st → `started` (request + 3 `waiting` jobs with the owner's `user_id`, origin owner, no actor). 2nd while jobs `waiting` → `in_progress`. 2nd while one job is `working` and the rest are sent → `in_progress`. 2nd after the 1st finished → `started`. 3rd → `daily_limit`, retry = the older counted request + 24 h, exact to the ms. Fully failed → not counted. Fully interrupted → not counted. **One sent + one failed job → counted (X-3).** 24 h + 1 s old → not counted. 23:59:59 old → counted, retry ≈ 1 s ahead. **X-7:** 5 modules at T−23 h 30, 3 at T−30 min, a third at T → `daily_limit`, retry in 30.0 min |
| 3 / brief 2 | Start function, admin | ✅ | Pass | 2 per owner across different admins, then `daily_limit`. Another owner's admin rows never count. While the owner is at the limit, an admin send → `started`, and the owner stays `daily_limit` (not `in_progress`) while the admin job waits. Admin 2nd while its own job waits → `in_progress`. With the admin counter full, the owner starts 2 of their own; the admin stays `daily_limit`. One admin send fully failed → the admin may send again |
| 3 / brief 2 | Bad arguments and unknown user | ✅ | Pass | **15 bad shapes → 22023**, nothing written (14 / 23 rows before and after): NULL user, origin or modules; origin `system`; owner with an actor; admin without an actor; `{}`; 33 modules; a NULL, empty, comma, uppercase, duplicate or 41-character element; **a 2-D array (D-18)**. Unknown user → **23503** `business_os_export_requests_user_id_fkey`, nothing written |
| 3 / brief 2 | Concurrency (advisory lock) | ✅ | Pass | Connection A started and held its transaction. Connection B blocked on the advisory lock (1 ungranted advisory lock seen in `pg_locks`) for ~1.5 s, then returned `in_progress` after A committed. **6 parallel starts** on one fresh account: exactly 1 `started` and 5 `in_progress` |
| 4 / brief 3 | Claim | ✅ | Pass | Claimed exactly: waiting with NULL `next_attempt_at`, waiting with it past, a due notice with no claim, a due notice claimed 421 s ago, a due notice at 4 attempts. In `created_at` order. **Skipped and byte-unchanged:** waiting in the future, a notice claimed 60 s and **419 s** ago, **a notice at 5 attempts with no claim and with a stale claim (M-2)**, sent, working, notice sent, given up. Waiting → working, attempts +1, `started_at` set. A notice keeps its status and bumps only `notice_attempts`. The whole row is returned (23/23 columns). A second claim → 0. NULL runner → 0. **A notice at 5 attempts with an hour-old claim is never claimed a 6th time.** Batch NULL/0/−5/1/3/1000 → 1/1/1/1/3/10 |
| 4 / brief 3 | SKIP LOCKED | ✅ | Pass | A holds 10 uncommitted. B claims 10 in **17 ms**, with 0 overlap and no wait. Each runner owns 10 after both commit. 4 parallel workers, batch 3, over 40 rows: 40 claims, 40 distinct |
| 5 / brief 3 | Reap (CASE order and the M-6 cases) | ✅ | Pass | Stale 421 s. Every part accepted and count = `parts_total` → **sent** (`sent_at`, `finished_at`, claim cleared, no notice). A `sending` part → **interrupted**, `failure_code interrupted`, notice due. **Every part accepted but 2 of 3 → interrupted (M-6).** **Attempts 3 with a part → interrupted, not failed (order).** No part, attempts 3 → **failed** `attempts_exhausted`, notice due. Attempts 4 with `parts_total` 2 → failed. No part, attempts 1 → **waiting**, `lease_expired`, next attempt +60 s. **`parts_total` set with no part, attempts 2 → waiting, `parts_total` cleared, +120 s (M-6).** Due notice at 5 attempts, with no claim or a stale claim → `given_up`, claim cleared. **Untouched:** working claimed 419 s ago, a given-up candidate with a fresh claim, a due notice at 4 attempts, a waiting row. A second reap → 0. **The next claim then picks the new notices** (interrupted and failed) |
| 6 | Pre-check and both checkers | ✅ | Pass | Pre-check: 9/9 `ok` before 95; rows 1 and 2 FAIL after 95; rows 1, 2, 4 and 5 FAIL after 96; 9/9 `ok` again after the full restore. **95 checker:** rows 1–13 `ok`, row 14 FAIL (info) before 96; **1–14 `ok` after 96**. **96 checker:** 11/11 `ok`, **row 11 md5 `ef5388c5428da4c1266c68f451e221f9` `ok`** on the committed LF bytes. All three run inside a `READ ONLY` transaction |
| 7 | F-A proof and G-18 | ✅ | Pass | **95 + 94 live:** `check` BLOCKED on `G-10 public.business_os_export_module_jobs.user_id` and `G-10 public.business_os_export_requests.user_id`, also with **no** export rows. `delete` refuses and the login stays. `anonymise_check` refuses on the same links. **96 live:** check OK, and the plan lists `B business_os_export_module_jobs found 3` and `B business_os_export_requests found 2`. **G-18:** a job row of **another** account pointing at the target's request → `G-18 public.business_os_export_module_jobs.request_id to business_os_export_requests` BLOCKED, with no G-10. `delete` is refused and the foreign row and the login survive. **Hard delete** of the `+test` account (2 requests, owner + admin, 3 jobs): login gone, 0 rows left, step-B report `rows_removed` 3 and 2. **Anonymise** of a real account: tombstone `deleted-…@deleted.invalid`, 0 rows left, report counts 3 and 2 |
| 8 / brief 5 | Rollback order | ✅ | Pass | The 95 rollback with 96 live refuses ("still names an export table"), with or without a row, and drops nothing. **The 96 rollback restores 94:** stamp `792d…`, body md5 `8c4fc3c2a7ef552a5785383230f1f548` = the 94 body applied at set-up, one overload, DEFINER, owner postgres, ACL service_role only. G-10 then refuses again; 95 checker rows 13 and 14 FAIL. The 95 rollback with rows refuses ("hold 2 row(s)"). Empty, **it drops both tables and all three functions (`00000`)**. The 94 check is OK again. A second 95 rollback refuses cleanly. **Re-applying 95 → 96 works** (md5 equal, 96 checker 11/11) |
| brief 6 | Paste safety (`into`) | ✅ | Pass | All seven pasted files scanned case-insensitively. Pre-check, both checkers and the 95 rollback contain no `into`. In the 95 migration the only two are the `INSERT INTO` statement keywords inside the dollar-quoted start body (l.232, l.235). The 96 migration and its rollback each have 3, all `INSERT INTO` keywords inside the function body, the same lines 20261094 had when it was applied on prod. No `into` in any comment or single-quoted literal. All seven files are LF (0 CR) |
| brief 7 | Jest | ✅ | Pass (MX-1a) | See the table below. Happy path and failure paths are both covered by committed tests. T-3: start for owner and admin (each outcome), 22023 → `invalid_arguments`, 23503 → `unknown_account`, zero or two rows → `unexpected_result`, a throwing client, input refused before any call. T-4: history, claim and reap happy paths; an RPC error → `{ error }`; a bad `parts` row dropped; a modelled double claim |

**Jest runs (worktree, Windows, Node 22):**

| Run | Result |
|---|---|
| The 7 MX-1a suites (T-1, T-2, T-3, T-4, T-5, T-7 drift, T-8 `no-deletion-paths`) | **7/7 suites, 409/409 tests** |
| §6 T-11 set (`testAccountCleanupSql`, `lib/business-os/purge`, `data-export`, `lib/business-os/__tests__`, `lib/repositories/__tests__`, `supabase/migrations/__tests__`, `lib/business-os/test-account-cleanup`) | 252/253 suites, 7508/7510 tests. The only failure is `lib/business-os/__tests__/bookingNextStep.test.ts` (2 tests). It **fails the same way in the main checkout at `1baf1f9b`** (2 failed, 54 passed), so it is pre-existing and local, not caused by MX-1a |
| `test:bos-entitlements` | Not required: no touched code file imports `lib/business-os/entitlements/` (grep: only the requirement doc mentions it) |
| Full `npm test` | Not run (CI on the rebased head is the authority, SR-5) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. Claim and reap are each one CTE plus UPDATE. SKIP LOCKED gave a 17 ms second claim with no lock wait.

#### Edge Cases (nice to fix)
1. **The SQL part CHECK is looser than the repository's Zod part schema.** This is SA comment 2, now proved on the replica. `…_parts_shape` (`supabase/migrations/20261095_business_os_export_requests.sql` l.127–131) accepts, even on a `sent` row, `n` of 0, −1 or 1.5, a part with no `resend_id` or `at`, a duplicate `n` and an extra key (local probe `extra.mjs`). `modulePartSchema` (`lib/repositories/BusinessOsExportModuleJobRepository.ts` l.76–81) requires `n` to be an int ≥ 1 and requires `resend_id` and `at`. `listHistoryForUser` parses the whole page with `z.array(historyRowSchema).parse` (l.210), so **one such row would make the account's whole history read return an error**, while `claimDue` only drops that row. Nothing writes parts before MX-3. **For the MX-3 workplan:** always write all four keys with an int `n`, or make the history parse per row. — Severity: Low
2. **A 2-D `modules` array in a direct insert raises 0A000** ("searching for elements in multidimensional arrays is not supported", from `array_position` in `…_modules_shape`, l.69), not 23514. The start function refuses it first with 22023 (D-18), and nothing else inserts requests, so this is reachable only by hand-written SQL. — Severity: Info
3. **A non-1-based array (`'[0:0]={crm}'`) is accepted** by the start function and by the CHECK, and is stored with lower bound 0. PostgREST always sends a 1-based array, so the repository cannot produce it. — Severity: Info
4. **The 95 checker errors (42P01) if it is run before 95**, because row 13 reads `public.business_os_export_requests` in `FROM`. §8 runs it only after step 5, so this is harmless (SA's optimisation note; the same shape as DL-1a edge case 1). — Severity: Info
5. **`.gitattributes` pins LF only for the generated cleanup files.** The 95 migration, its rollback and the three new scripts are LF today, but a fresh Windows checkout with `core.autocrlf=true` would write CRLF. That is harmless: none of them has a md5 gate. — Severity: Info

### Not verified (and why)
- **Behaviour on Supabase's managed `postgres` role (not a superuser) and in the SQL editor itself.** This is covered only by the read-only §7 Q-1 to Q-6 results, the in-file guards and the pre-check.
- **The `gen_random_uuid()` pre-guard** cannot be triggered on PG 13+.
- **§8 step 11** (post-deploy Danger Zone check), **SA G-2** (SR-5 at the rebase) and **CI on the rebased head** (TL / RM).

### Final Status
- [x] All acceptance criteria that can be tested before the apply pass on the replica (PG 17 and 15), and SA gate G-1 is met. Ready for commit, subject to the user's diff review, G-2 at the rebase and the §8 gates (md5 row 11 is an operator gate; the apply and merge are back to back)
- [ ] Issues found — Dev must address before commit (none; edge case 1 is a note for MX-3)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-26 | Workplan created (Dev, EXPORT session) | E4 / MX-1a: migration 20261095 (two server-write-only tables, start function with BQ-29 + XC-20 limits as SQL literals, claim and reap RPCs, lease 420 s), mirror constants + migration test, two repositories + callers guard, two `never` descriptors (count 162 → 164), regenerated cleanup 20261096 chaining on 20261094, paste procedure with SR-5 pre-apply check and the F-A pause window. Open items MX1A-1…MX1A-16; business questions BQ-30 / BQ-30a (non-blocking for the workplan) |
| 2026-10-26 | SA workplan review (SA) | ⚠️ Approved with conditions M-1…M-11. All 16 open items ruled (✅, `never` + step B both modes confirmed: Reset / Purge keep the history and the counter, account deletion removes it). Key fixes before Task 3: positive-form jsonpath part CHECKs (M-1), notice claim bounded by attempts (M-2), named FK constraints pinned to the G-18 entry (M-3), the 20261092 allow-list entry built from the generator constant per R-7 (M-4), one SQL site per mirror constant (M-5). BQ-30 / BQ-30a block neither the workplan nor the paste. A new "does a too-large failure count" question goes to BA, before MX-3 |
| 2026-10-27 | Implemented (Dev) | TL's §7 results pasted (§7.1), M-1 to M-11 folded. Built 20261095 + rollback, 20261096 regenerated (stamp `b1203c526bc9ec91`, chains on 20261094), `moduleExportPolicy.ts`, two repositories, two `never` descriptors (164 = 38 + 0 + 126), three read-only scripts, T-1 to T-9. Deviations D-16 to D-24 (§11.1), test results §11.2. Uncommitted, for SA code review, QA replica and the user's diff |
| 2026-10-27 | SA code review (SA) | ✅ Code approved for QA. M-1…M-11 met; D-16…D-24 accepted (D-17 satisfies M-5). 91/91 suites green; the bookingNextStep failures reproduce on main. Gates: G-1 index-predicate text proved on PG 17 by QA 1, G-2 SR-5 re-check at the rebase. Four low, non-blocking comments (history limit / parse for MX-1b and MX-3) |
