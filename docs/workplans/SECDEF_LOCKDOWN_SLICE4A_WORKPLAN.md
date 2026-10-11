# Workplan: SECURITY DEFINER Lockdown, Slice 4a (signed-in server paths: close PUBLIC and anon, keep authenticated)

> **Last Updated**: 2026-10-10

**Developer:** Dev
**Requirement:** [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) (FR-0.1 to FR-0.14, FR-4a, FR-4b for context, §6 S4a, SA conditions C-1 to C-10, C-4 note S2-4, ruling SQ-1)
**Pattern copied:** [SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md) (five-file package, the kept-`authenticated` branch built for `is_platform_admin`, SA S3-1 to S3-6, paste-safe acceptance blocks pinned by the static test)
**Evidence:** [secdef_prod_inventory_2026-10-07.tsv](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv) (signatures and grantees), [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md) §4.2 (class 2) and §6 row 4a
**Branch:** `fix/secdef-lockdown-slice-4a` (worktree `neuronforge-secdef-s4a`, off `origin/main` `7e5964ec`, the PR #282 merge)
**Migration number:** `20261050` proposed. Checked 2026-10-10: `origin/main` `7e5964ec` tops at `20261049`; `gh pr list` shows no open PR touching `supabase/migrations/`, `supabase/SQL Scripts/` or `supabase/held/`. Re-check at PR time (T-10 rule)
**Date:** 2026-10-10
**Status:** Code Complete. Workplan SA-approved (S4a-1 to S4a-4 folded in); code SA-approved 2026-10-10; QA PASS (local PGlite). Acceptance amended 2026-10-11 (user): F1 to F5 waived, agent runs out of scope. Awaiting PR and prod apply.

## Overview

Slice 4a removes the signed-out path to the six class 2 SECURITY DEFINER functions: the pilot's execution counters and learning writes (`increment_executions_used`, `update_execution_baseline`, `record_execution_anomaly`, `upsert_error_pattern`, `record_auto_fix_result`) and the V6 top-insights reader (`get_top_insights`). It closes `PUBLIC` and `anon` and **keeps `authenticated` and `service_role`**, because signed-in agent runs and calibrations call them on the user's cookie client. This slice cannot fix the caller-supplied tenant id: until slice 4b, a signed-in user can still write rows for another tenant (FR-4a). Slice 4b moves the five id-trusting call sites to `supabaseServer` and then revokes `authenticated` (SA SQ-1). The delivery is the slice 3 package, with all six functions on the kept-`authenticated` branch that slice 3 built for `is_platform_admin`. No function body, table, policy or application code changes.

## Table of Contents

1. [Analysis](#1-analysis)
2. [Approach](#2-approach)
3. [Files](#3-files)
4. [Task list](#4-task-list)
5. [Test plan](#5-test-plan)
6. [Apply order and rollback plan](#6-apply-order-and-rollback-plan)
7. [Risks](#7-risks)
8. [Open questions for SA](#8-open-questions-for-sa)
9. [SA Review Notes](#sa-review-notes)
10. [QA Testing Report](#qa-testing-report)
11. [Commit Info](#commit-info)
12. [Change History](#change-history)

---

## 1. Analysis

### 1.1 The 6 functions, verified against the prod TSV

Identity types are the TSV `identity_args` with the parameter names removed. Every row is `kind = fn`, has exactly one TSV row (no overloads), `triggers` 0 and `search_path` null. **All 6 match FR-4a exactly. No discrepancy.**

| # | Signature (prod identity) | `nargs` / `min_args` | Shape | Defined in git | Writes / reads |
|---|---|---|---|---|---|
| 1 | `public.increment_executions_used(uuid)` | 1 / 1 | B | `SQL Scripts/20251117_complete_quota_system.sql:261` (also `20251117000003_add_execution_quotas.sql:34`) | `UPDATE user_subscriptions SET executions_used + 1 WHERE user_id = p_user_id` |
| 2 | `public.update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean)` | 7 / 7 | B | `migrations/20260629_execution_optimization_tables.sql:143` | upsert of `execution_baselines` by `agent_id` |
| 3 | `public.record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer)` | 12 / 9 | B | same file `:352` | insert into `execution_anomalies` |
| 4 | `public.upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb)` | 8 / 7 | B | `migrations/20260629_error_patterns_table.sql:120` | upsert of `error_patterns` by user, agent, code, plugin, action |
| 5 | `public.record_auto_fix_result(uuid, boolean)` | 2 / 2 | B | same file `:177` | counter `UPDATE error_patterns WHERE id = p_pattern_id` |
| 6 | `public.get_top_insights(integer)` | 1 / 0 | B | `SQL Scripts/20260601_fix_execution_insights_schema.sql:189` | read of `execution_insights WHERE user_id = auth.uid()` |

Type notes (FR-0.2): rows 2 and 3 are `DECIMAL` in git and `numeric` in the identity; row 6's default (`5`) is not part of the identity. None uses `vector`, so there is no Q0. No name shadows a `pg_catalog` built-in, so there is no Q10.

### 1.2 Grant shape and rollback

One shape for all six (slice 2 also had one; slice 3 had three):

| Shape | Functions | TSV `execute_grantees` | How anon gets in today | After the migration | Rollback grant |
|---|---|---|---|---|---|
| B | rows 1 to 6 | `PUBLIC postgres anon authenticated service_role` (`x_public`, `x_anon`, `x_auth`, `x_service` all `t`; `public_acl` `t`) | `PUBLIC` plus the explicit Supabase default-privilege `anon` entry | `postgres authenticated service_role` | `GRANT ... TO PUBLIC, anon` |

**Why the migration revokes `authenticated` and grants it back.** The brief's form is "revoke from `PUBLIC, anon`, keep `authenticated`". `authenticated` already holds an explicit entry here (unlike a function whose only path is `PUBLIC`), so `REVOKE ... FROM PUBLIC, anon` alone would leave it true. But FR-0.1, FR-0.13 and the slice 6 guard all expect every REVOKE in these migrations to list `PUBLIC, anon, authenticated`. So the migration does exactly what slice 3 did for `is_platform_admin` (SA Q-4 there): `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`, then `GRANT EXECUTE ... TO authenticated, service_role`, in one transaction, so no concurrent session can see `authenticated` without EXECUTE. The re-grant comes from `postgres` (the owner), so the rebuilt ACL is `postgres, authenticated, service_role`. A foreign-grantor `authenticated` or `anon` entry would survive the REVOKE; Q5 grantors catches that before apply, and the post-condition raises if `anon` still executes. See Q-1.

**Rollback:** `GRANT EXECUTE ... TO PUBLIC, anon` per function restores the TSV set exactly (`authenticated` is never lost, `service_role` never lost). After a rollback the pre-check must read Q4 `ok` and Q5 `match` x6.

Owner and grantor are not in the TSV, so the pre-check measures them (Q2, Q5 grantors), as in slices 1 to 3.

### 1.3 Caller re-verification on current main (2026-10-10, `7e5964ec`)

Searched the whole repo except `node_modules`, `.next`, `.git`, `docs/` and `.claude/` for each name as a substring (all file types, so `.rpc(<CONSTANT>)` sites would show too), then traced every hit to the client it runs on and the route, cron or job that reaches it. `lib/supabaseServer.ts` is `createClient(URL, SUPABASE_SERVICE_ROLE_KEY)` (`createServerSupabaseClient`, `:9-15`). `createAuthenticatedServerClient` (`lib/supabaseServerAuth.ts:15-20`) is the anon key plus the request's auth cookies, so it acts as `authenticated` only when a session is present. Every route below that uses it calls `supabase.auth.getUser()` and returns `401` before any pilot or repository code runs, so **a signed-out request never reaches an RPC on that client**. No `'use client'` file imports any of the RPC-calling classes (the only hit, `app/admin/system-flow/page.tsx`, names `WorkflowPilot` in prose). `supabase/functions/` has no hit.

**RPC call sites (one per function)**

| # | Function | Call site | Reached from | Client at runtime | On error |
|---|---|---|---|---|---|
| 1 | `increment_executions_used` | `lib/services/ExecutionService.ts:166` (`recordExecution`) | `lib/pilot/StateManager.ts:147` builds `new ExecutionService(this.supabase)`; `:236` calls `recordExecution` after the `workflow_executions` insert in `createExecution` | the pilot's client (table below). Confirmed by SA 2026-10-07 and pinned by `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts:119,127-133` (RC9-8) | `console.error` and throw (`ExecutionService.ts:170-172`), caught by StateManager as "non-critical" (`:237-240`, `console.error`). The run continues; the quota counter silently does not move |
| 2 | `update_execution_baseline` | `lib/services/BaselineService.ts:115` (`updateBaseline`) | `lib/pilot/WorkflowPilot.ts:2532` via `getBaselineService(this.supabase)`, from `updateBaselineAndDetectAnomalies` (`:909`, fire and forget after a completed run) | the pilot's client | `logger.debug` only (`:126`, `:130`): **silent** at production log levels |
| 3 | `record_execution_anomaly` | `lib/services/AnomalyDetector.ts:462` (`recordAnomaly`) | `WorkflowPilot.ts:2544` via `getAnomalyDetector(this.supabase)`, `detectAndRecord` (`:156`) only when an anomaly is detected against a baseline | the pilot's client | **fully silent** (S3-5 class): the `{ error }` is never read, and the `.catch` (`:156-158`) logs at debug only on a throw |
| 4 | `upsert_error_pattern` | `lib/repositories/ErrorPatternRepository.ts:103` (`upsert`) | `ErrorPatternService.captureError` (`lib/services/ErrorPatternService.ts:135`) ← `lib/pilot/StepExecutor.ts:624-625`, fire and forget when a step with a plugin fails | the pilot's client (`StepExecutor` is built only at `WorkflowPilot.ts:102` with the pilot's `supabase`). `ErrorPatternRepository` defaults to `supabaseServer` (`:13`, `:91`) but is always given the service's client (`ErrorPatternService.ts:93`) | `logger.error` "Failed to upsert error pattern" (`:116`) and "Failed to capture error pattern" (`ErrorPatternService.ts:138`) |
| 5 | `record_auto_fix_result` | `ErrorPatternRepository.ts:363` (`recordAutoFixResult`) | `ErrorPatternService.recordAutoFixResult` (`:227`) ← `lib/pilot/ErrorRecovery.ts:368` inside `ErrorRecovery.recordAutoFixResult` (`:361`). **That method has no caller**, nor does `ErrorRecovery.checkAutoFix` (`:325`); repo-wide search returns only their definitions | none live | n/a (dead). Corrects inventory §4.2, which listed the `ErrorRecovery` lines as callers |
| 6 | `get_top_insights` | `lib/repositories/InsightRepository.ts:110` (`getTopInsights`) | `app/api/v6/insights/route.ts:43`, only when the request has **no** `agentId`. Every UI fetch of this route passes `agentId` (`app/v2/agents/[id]/page.tsx:364,3409,3423,3439,3583`; `page-redesign.tsx:146`), so the branch has no UI caller today; a signed-in user reaches it by a direct GET | `createAuthenticatedServerClient` (`route.ts:18`), `401` at `:24-26`. `authenticated`; the body is scoped by `auth.uid()` | `console.error` and returns `[]` (`InsightRepository.ts:115-117`): the user sees an empty list, no error |

Not to be confused: `app/api/cron/insight-detect/route.ts:398` calls a Business OS prioritiser's `getTopInsights`, and `lib/business-os/insight/repository/InsightRepository.ts` is a different repository; neither touches the `get_top_insights` RPC.

**Where the pilot's client comes from (rows 1 to 4)**

| `new WorkflowPilot(...)` site | Client | Gate before the pilot | Role at the RPC |
|---|---|---|---|
| `app/api/run-agent/route.ts:229` | `createAuthenticatedServerClient()` (`:67`) | `getUser()`, `401` (`:70-73`) | `authenticated` |
| `app/api/run-agent-sandbox/route.ts:148` | `createAuthenticatedServerClient()` (`:52`) | `getUser()`, `401` (`:55-58`) | `authenticated` |
| `app/api/calibrate/resume/route.ts:253` | `createAuthenticatedServerClient()` (`:40`) | `getUser()`, `401` (`:43-50`) | `authenticated` |
| `app/api/v2/calibrate/batch/route.ts:1874` | `identity.useServiceRole ? supabaseServer : authSupabase` (`:182`); `useServiceRole` is true only for an admin calibrating another user's agent (`lib/calibration/adminCalibrationIdentity.ts:53-65`) | `getUser()`, `401` (`:93-101`); non-admin cross-user `403` | `authenticated` (own agent), `service_role` (admin cross-user) |
| `lib/pilot/shadow/DryRunValidator.ts:74` | `supabaseServer`; reached from `v2/calibrate/batch/route.ts:1233-1234` | the batch route's gate | `service_role` |
| `app/api/sentinel/webhook/[agentId]/route.ts:358` | module-level service-key `supabaseAdmin` (`:23-25`) | shared secret (PR #88) | `service_role` |
| `app/api/v6/execute-test/route.ts:139` | `createServerSupabaseClient()` (`:119`, service key) | `requireAdmin` (`:88`) | `service_role` |
| `scripts/test-*.ts` (4 files) | service key or a mock | dev only, not deployed | n/a |

`WorkflowPilot` also builds `StateManager`, `StepExecutor` and the services above from the **same** `supabase` it was given (`WorkflowPilot.ts:100-102,139-143,2532,2544`). The module singletons `getBaselineService`, `getAnomalyDetector` and `getErrorPatternService` rebuild their instance whenever the client argument differs (`_lastSupabase !== supabase`), so each call runs on the client passed in that call. `QuotaAllocationService.ts:27` also builds an `ExecutionService`, but only calls `applyExecutionQuotaBasedOnTokens` on `supabaseServer` (from the Stripe webhook), never `recordExecution`, so it is not a caller (SA N-1). `WorkflowOrchestrator` (`lib/orchestration/WorkflowOrchestrator.ts:179`) builds a `StateManager` only to log step rows, not to create executions. `app/api/insights/route.ts` uses `supabaseServer` and only reads baselines and anomalies through table selects, not the RPCs.

**Scheduled and queued runs (no anon path).** `app/api/run-scheduled-agents/route.ts` (service key, `CRON_SECRET`) queues jobs through QStash; `app/api/cron/process-queue/route.ts` runs them through `runAgentKit` on a service-key client, and no file on that path names any of the 6. The Supabase edge function `supabase/functions/run-scheduled-agents/index.ts` POSTs to `AGENT_RUN_API_URL` with a bearer key and no cookie; if that URL is `/api/run-agent`, the route returns `401` before the pilot, so it reaches no RPC (pre-existing, unrelated to this slice). None of the 17 Vercel crons in `vercel.json` reaches these functions. **No cron dependency.** pg_cron is measured by Q9.

**SQL callers in git:** none. The only SQL hits are the six `CREATE` statements, two comments in `20261001_user_subscriptions_write_lockdown.sql:61,114`, `scripts/check-migrations.sql:124-141` (a name list), and `SQL Scripts/verify_phase1_migration.sql:124-128` (an `information_schema.routines` read). Prod-only callers, policies, views and dependents are measured by the pre-check (Q6 to Q9, Q11).

**Result: no BLOCKER.** No signed-out (anon) path calls any of the 6: every app call site is either behind a `401` session check on the cookie client (so the role is `authenticated`, which keeps EXECUTE) or on a service-role client. This agrees with SA's 2026-10-07 finding (`StateManager.ts:138-147` on the cookie client; `get_top_insights` from `app/api/v6/insights` on `createAuthenticatedServerClient`). The one correction is row 5: `record_auto_fix_result` has no live caller.

**What proves the quiet callers (S3-5).** Rows 2 and 3 leave no log line on a `42501`; row 6 logs only a `console.error` in Vercel (no access) and returns `[]`; row 1 logs a `console.error` in Vercel and the run continues. Since this slice keeps `authenticated` and `service_role`, the checker's C5 and C6 prove every kept path; the positive role calls (P1 to P6) prove it from the SQL editor; F1 gives direct table evidence for rows 1 and 2.

**Dead TS references** (record only, as in slices 2 and 3): `ErrorRecovery.recordAutoFixResult` and `ErrorRecovery.checkAutoFix` (no caller). The `getTopInsights` branch of `GET /api/v6/insights` has no UI caller but is a reachable API path; it stays.

### 1.4 What slice 4b inherits from this analysis

- The five 4b call sites are exactly rows 1 to 5 above; row 5 is dead, so 4b moves four live sites (`ExecutionService.ts:166` through `StateManager`, `BaselineService.ts:115`, `AnomalyDetector.ts:462`, `ErrorPatternRepository.ts:103`) and may delete or move the dead row 5 chain.
- Row 1's client is pinned by the `userSubscriptionsWriteLockdown.qa.test.ts` RC9-8 test; 4b must update that test.
- R-4 (which client actually reaches each RPC at runtime) is still owed before 4b; this slice is safe either way because it keeps `authenticated`.
- **Expired-session edge (SA S4a-3, R-11):** the count of `anon` `permission denied for function` hits on `update_execution_baseline`, `record_execution_anomaly` or `upsert_error_pattern` that coincide with a signed-in run is recorded in the QA section as a 4b input. 4b removes the case by moving those calls to `supabaseServer`.
- `console.*` in files 4b will touch: `lib/services/ExecutionService.ts` (6), `lib/repositories/InsightRepository.ts` (21, only if 4b touches it), `lib/pilot/StateManager.ts` and `lib/pilot/WorkflowPilot.ts` (many). Flag them then (CLAUDE.md Logging). This slice touches no TS, so it raises no flag.

### 1.5 Slice 6 guard

The migration defines and alters no function, so it adds **0** (file, function) pairs and no finding; `20261050` is after the freeze date. The six functions stay on the frozen baseline through their original `CREATE` files (`SQL Scripts/20251117000003_add_execution_quotas.sql`, `SQL Scripts/20251117_complete_quota_system.sql`, `SQL Scripts/20260601_fix_execution_insights_schema.sql`, `migrations/20260629_error_patterns_table.sql` x2, `migrations/20260629_execution_optimization_tables.sql` x2; `supabase/__tests__/security-definer-surface.guard.test.ts:643-663`), so the baseline does not shrink. None of the five new SQL files may contain the phrase `SECURITY DEFINER`, even in a string (F-2, the O-1 tripwire); the pre-check reads `prosecdef`. No new file names a function protected by a callers guard (`business_os_auth_email_has_account`).

### 1.6 Skills consulted

| Skill | Applies? |
|---|---|
| `business-os-schema-check` | Yes. The TSV is the prod evidence; the pre-check re-measures existence, owner, grantors, callers, policies and dependents before apply. Acceptance columns checked against git: `workflow_executions.started_at` and `run_mode` (written by `StateManager.ts:192-193`), `execution_baselines.updated_at` (`20260629_execution_optimization_tables.sql:27`), `error_patterns.last_seen` (`20260629_error_patterns_table.sql:16`). `user_subscriptions.executions_used` is defined only in `SQL Scripts/20251117_complete_quota_system.sql:226`, not in `migrations/`; it exists on prod because `increment_executions_used` and `ExecutionService` read it, but SA should confirm (Q-6) |
| `tenant-isolation-guard` | Yes, as context. This slice does not close the caller-supplied `p_user_id` (rows 1 to 4) or `p_pattern_id` (row 5); a signed-in user can still write another tenant's rows until 4b (FR-4a). It removes only the anonymous path |
| `business-os-entitlements` | No import from the module |
| `durable-queue-drain` | No drain touched |
| `v6-pipeline` | No pilot code changed; the pilot's call sites are only traced |
| `new-api-route`, `new-repository`, `new-plugin`, `bos-llm-call-standards` | Not applicable |

### 1.7 Lessons carried over

| Lesson | Where it lands |
|---|---|
| Slice 1 false `DIFFERS` (collation) | `COLLATE "C"` on every `string_agg ... ORDER BY`, pinned by the test |
| W-1 grantor, W-2 no LIKE, W-5 static rules, READ ME new-tab order | Unchanged |
| S2-1 / S2-4 Q11 `pg_depend` | Kept, with the slice 3 kept-`authenticated` rule (S3-1) applied to all six |
| S2-3 rollback only on an identified caller | Kept (§6) |
| S3-1 policy roles must be a subset of `authenticated` and `service_role` | Q7 and Q11 for all six (they all keep `authenticated`) |
| S3-2 caller rule for a kept-`authenticated` function | Q6 for all six: SECDEF caller not owned by `postgres` stops; INVOKER trigger caller always stops; other INVOKER caller stops only if `anon` can execute it |
| S3-4 paste-safe acceptance blocks, no timestamp literals, pinned | §5.3 drafts; final text in the QA section, pinned by the static test |
| S3-5 silent callers | §1.3: rows 2, 3, 6 are quiet; C5, C6 and P1 to P6 prove the kept grant |

---

## 2. Approach

### 2.1 Pre-check (read-only, single result set)

**File:** `scripts/precheck-secdef-lockdown-slice4a.sql`. The slice 3 pre-check with these changes:

- `watched` VALUES has the six rows, each with `expected_grantees` `PUBLIC postgres anon authenticated service_role` (read from the TSV by the static test) and `keeps_authenticated` **true** for all six (Q-2).
- **No Q0** (no `vector`), **no Q10** (no shadowed built-in).
- **Q4 privileges:** `ok` when `public`, `anon`, `authenticated` and `service_role` are all true (shape B pre-state).
- **Q6 callers:** the slice 3 `caller_verdict` CASE unchanged. Because every row keeps `authenticated`, the S3-2 branch applies to all six: SECDEF caller with an owner other than `postgres` stops; INVOKER trigger caller stops; any other INVOKER caller stops only when `anon` can execute it. Each caller row shows `secdef`, `trigger`, `anon executes` and owner. **New, informational only (Q-3):** an INVOKER caller that is `ok` here gets the suffix `4b review` (never `stop here`, and never counted in `PRECHECK STATUS`, SA Q-3), because slice 4b revokes `authenticated` from rows 1 to 5 and such a caller would then fail for signed-in users. Expected on prod: no caller (none in git).
- **Q7 policies:** the S3-1 rule for all six (`ok` only when `roles <@ ARRAY['authenticated', 'service_role']`). Expected: none.
- **Q8 views:** any row is `stop here`. Expected: none.
- **Q9 cron:** unchanged (`cron not installed`, `none visible jobs only`, or `NAMED ... stop here`).
- **Q11 dependents:** the slice 3 rule (a `pg_policy` dependent with `polroles` a subset of `authenticated` and `service_role` is `ok`; any other dependent stops). Expected: 0 rows for all six.
- `string_agg ... ORDER BY ... COLLATE "C"` everywhere; first statement `SET default_transaction_read_only = on`; READ ME row; `PRECHECK STATUS` CLEAN or `STOP n`.

| Item | Expected on prod |
|---|---|
| Q1 exists | `present` x6 |
| Q2 owner | `postgres ok` x6 |
| Q3 secdef | `true` x6; config `none` x6 (TSV `search_path` null) |
| Q4 privileges | `ok` x6 (all four true) |
| Q5 grantees / grantors | `match` and `owner granted all` x6 |
| Q6 | 0 callers each, or prod-only callers recorded and judged |
| Q7 | none |
| Q8 | none |
| Q9 | `cron not installed` or `none visible jobs only` |
| Q11 | 0 dependents each |

### 2.2 Migration

**File:** `supabase/migrations/20261050_secdef_lockdown_slice4a_signed_in.sql`. Slice 3's `is_platform_admin` form, six times, with one looped post-condition block:

```sql
BEGIN;

REVOKE EXECUTE ON FUNCTION public.increment_executions_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_executions_used(uuid) TO authenticated, service_role;

(one REVOKE plus one two-role GRANT per function, rows 1 to 6 in the §1.1 order)

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[ (the 6 signature literals) ]
  LOOP
    (NULL raises; public raises if held; anon raises if held;
     IF NOT authenticated raises 'authenticated lost EXECUTE';
     IF NOT service_role raises 'service_role lost EXECUTE')
  END LOOP;
END
$$;

COMMIT;
```

Decisions inherited (SA-approved in slices 1 to 3): REVOKE always lists all three client grantees; `REVOKE EXECUTE`, not `REVOKE ALL`; fail, never skip (C-2); no `SELECT` and no `INTO` in the DO block (C-7); built-ins `pg_catalog.`-qualified, every name `public.`-qualified; no `SECURITY`, `search_path`, `CREATE`, `ALTER`, `DROP`. The two-role GRANT is slice 3 Q-4's form; in this slice it is the only GRANT form (six of them).

### 2.3 Checker (read-only, VERDICT first)

**File:** `scripts/check-secdef-lockdown-slice4a-migration.sql`. Slice 3's checker with six rows, `keeps_authenticated` true for all. Six checks per function (C1 exists, C2 owner `postgres`, C3 `public` false, C4 `anon` false, C5 `authenticated` true, C6 `service_role` true), `IS FALSE` / `IS TRUE` so a NULL is FAIL.

- **After apply:** `VERDICT PASS 36 pass 0 fail` (6 x 6).
- **Before apply (dry run):** `VERDICT FAIL 24 pass 12 fail`: C1, C2, C5, C6 pass and C3, C4 fail for each function.

### 2.4 Rollback

**File:** `supabase/SQL Scripts/20261050_secdef_lockdown_slice4a_signed_in_rollback.sql`. `BEGIN;` then 6 x `GRANT EXECUTE ON FUNCTION public.<sig> TO PUBLIC, anon;`. DO post-condition: all four roles true for all six; NULL raises. `COMMIT;`. No REVOKE. After a rollback the pre-check reads Q4 `ok` and Q5 `match` x6. All six at once (slice 3 Q-6).

### 2.5 Static test

**File:** `supabase/migrations/__tests__/secdef-lockdown-slice4a.migration.test.ts`. The slice 3 test with a `SLICE_4A` constant of six `{ name, signature, rollbackGrantees, keepsAuthenticated }`:

- **TSV cross-check:** `kind = fn` rows; one row per entry; identity args with names stripped equal the signature's type list; `execute_grantees` is `PUBLIC postgres anon authenticated service_role` for all six; `rollbackGrantees` equals that minus `postgres`, `service_role` and (since kept) `authenticated`, so `PUBLIC, anon`; 6 distinct names; every entry `keepsAuthenticated` true; the name set equals FR-4a.
- **All five SQL files and the QA blocks:** no `--`, `/*`, "into", LIKE/ILIKE, single-letter alias, `SECURITY DEFINER` text; even quotes; literals only on an exact per-file allow-list (the 6 signatures, plus `cron.job` / `TABLE cron.job` in the pre-check); LF.
- **Migration:** one `BEGIN`/`COMMIT`; 6 REVOKE, each exactly `... FROM PUBLIC, anon, authenticated`; 6 GRANT, each exactly `... TO authenticated, service_role`, paired in `SLICE_4A` order; `ON FUNCTION` set equals `SLICE_4A`, all `public.`-qualified; the DO array equals the 6; the loop has the NULL raise, `public` and `anon` held raises, and `IF NOT ... 'authenticated'` and `IF NOT ... 'service_role'` raises, and **no** `authenticated` held-raise; no `SELECT`; no `ALTER`, `CREATE`, `DROP`, `SECURITY`, `search_path`, `REVOKE ALL`, `CASCADE`, table keyword.
- **Rollback:** one `BEGIN`/`COMMIT`; one GRANT per entry to exactly `PUBLIC, anon`; no REVOKE; post-condition expects four true.
- **Checker and pre-check:** read-only first statement; no write keyword; signature set equals `SLICE_4A`; checker VERDICT first, 6 checks per function, C5 expectation `true` for all; pre-check markers `Q1` to `Q9`, `Q5 grantors`, `Q11`, `PRECHECK STATUS`, no `Q0`, no `Q10`; Q6 carries the S3-2 CASE and the `4b review` suffix, which never contains `stop here`; Q7 and Q11 carry the S3-1 subset rule; expected-grantee strings read from the TSV; every `string_agg ... ORDER BY` ends in `COLLATE "C"`.
- **Acceptance blocks** (S3-4): pinned statement for statement; only the blocks named in §5.3; every block literal-free; no timestamp literal (windows are `pg_catalog.now() - pg_catalog.make_interval(mins => N)`); every role block ends in `ROLLBACK`.

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-secdef-lockdown-slice4a.sql` | create | Read-only pre-check (FR-0.5, FR-0.10, FR-0.11, Q11) |
| `supabase/migrations/20261050_secdef_lockdown_slice4a_signed_in.sql` | create | The revoke and re-grant, with in-transaction post-conditions (FR-0.1, FR-0.9, FR-0.12) |
| `scripts/check-secdef-lockdown-slice4a-migration.sql` | create | Read-only checker, VERDICT first (FR-0.4) |
| `supabase/SQL Scripts/20261050_secdef_lockdown_slice4a_signed_in_rollback.sql` | create | Pre-state restore (FR-0.5) |
| `supabase/migrations/__tests__/secdef-lockdown-slice4a.migration.test.ts` | create | Static asserts (FR-0.13, C-8) |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify | §4.3: S3 merged (done), new S4a row (done); later S4a PR, merge, apply, acceptance. At code time: SQ-3 list gains the dead `ErrorRecovery` chain (Q-9) |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify | §6 row 3 merged and row 4a proposed number (done); §4.2 `record_auto_fix_result` caller correction (done). At PR time: row 4a status |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md` | modify | Status: merged (PR #282, `7e5964ec`); log watch pending (done) |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE4A_WORKPLAN.md` | create | This workplan |

No TS source, no other migration, no CI workflow change.

---

## 4. Task list

- ✅ T-0: Branch confirmed (`fix/secdef-lockdown-slice-4a`, off `7e5964ec`); requirement, slice 3 workplan and package, inventory §4.2 and §6, and the TSV read
- ✅ T-1: 6 signatures and the single grant shape verified against the TSV (§1.1, §1.2)
- ✅ T-2: Callers re-verified on `7e5964ec`, client role per site (§1.3). No signed-out caller; no blocker. `record_auto_fix_result` found dead
- ✅ T-3: Migration number checked: `20261050` proposed (header)
- ✅ T-4: Slice 3 recorded as merged (requirement §4.3 and header, inventory §6 row 3, slice 3 workplan status, Change History rows); workplan written; requirement §4.3 S4a row
- ✅ T-5: SA workplan review: approved with S4a-1 to S4a-4, Q-1 to Q-11 ruled. S4a-1 in §5.3, §6 and the QA blocks; S4a-2 in §5.3, §6 and the F1 block; S4a-3 in §1.4, §5.3, §6 and R-11; S4a-4 in the inventory §4.2; N-1 in §1.3; Q-3 rule in §2.1
- ✅ T-6: Static test written against `SLICE_4A` (TSV-driven; acceptance blocks pinned, with the S4a-1 and S4a-2 lead-ins)
- ✅ T-7: Pre-check written (§2.1): the slice 3 pre-check with the six rows (all `keeps_authenticated` true), Q0 removed, and the Q-3 `ok 4b review` tag on Q6
- ✅ T-8: Migration and rollback written (`20261050_secdef_lockdown_slice4a_signed_in`)
- ✅ T-9: Checker written (the slice 3 checker with the six rows, all `keeps_authenticated` true)
- ✅ T-10: Slice 4a test; regressions (slice 1, 2, 3 tests, `npm run test:authz-guard`, `userSubscriptionsWriteLockdown.qa.test.ts`, `tsc --strict` on the test file, paste greps on all four SQL files and the QA blocks). Re-check the number against `origin/main` and open PRs; rename everything together if taken. **Done 2026-10-10:** slice 4a test 85/85, mutation-checked (removing the migration's `NOT` on the authenticated check, dropping one `COLLATE "C"`, making the `4b review` tag say stop here, adding `authenticated` to a rollback GRANT, and flipping one checker row to `false` each fail the test; restored, 85/85). Slice 1, 2, 3 tests, `userSubscriptionsWriteLockdown.qa.test.ts`, `authAccountRepository.callers.guard` and `tailwind-css-escape.guard`: 7 suites, 351/351. `test:authz-guard` 203/203 (slice 6 guard green, 0 new pairs). `tsc --strict` (target es2020) on the test file clean. Paste greps clean on all four SQL files (no `--`, `/*`, "into", LIKE, `SECURITY DEFINER` text; even quotes; ASCII only). Number re-checked: `origin/main` `7e5964ec` tops at `20261049`, 0 open PRs touch `supabase/migrations|SQL Scripts|held`, so `20261050` is free
- ⬜ T-11: SA code review, then the user sees the diff (left uncommitted)
- ⬜ T-12: User runs §6 steps 1 to 6 on prod; results recorded under QA Testing Report
- ⬜ T-13: QA confirms §5.3 acceptance; requirement §4.3 and inventory §6 updated with PR, merge and apply state

---

## 5. Test plan

### 5.1 Static test

As §2.5.

### 5.2 What Jest cannot show

No branch database (FR-0.6). QA repeats the local PGlite run from slice 3 with the six functions in shape B (built through the Supabase default privileges): pre-check `CLEAN`; checker before 24/12 and after 36/0; migration run twice; role matrix (all 6 x `anon` denied `42501`; all 6 x `authenticated` and `service_role` allowed); the rollback rebuilds the pre-state row for row; negative fixtures: a foreign-grantor `anon` entry (Q5 `OTHER GRANTOR`, migration raises), a SECDEF caller owned by another role (Q6 stop), an INVOKER trigger caller (Q6 stop), an INVOKER non-trigger caller that `anon` cannot execute (Q6 `ok` with `4b review`), a policy `TO public` naming one of the six (Q7 and Q11 stop), and a column default calling one of the six (Q11 stop). Plus the acceptance blocks verbatim against the fixture, as SQL validity checks.

### 5.3 Acceptance after apply (SA-approved with S4a-1 and S4a-2)

**Why lighter than slice 3 and heavier than slice 2.** Every kept path stays open by construction (`authenticated` and `service_role` keep EXECUTE), so the only way this slice breaks anything is a signed-out caller, and §1.3 found none. Acceptance therefore proves the grant (checker), the closed path (negative calls), the kept path from the SQL editor (positive calls), and that the real signed-in flows still write, with a Postgres-log window. No cron is involved, so there is no `bos_cron_runs` block. Let T be the apply time.

**Mandatory (amended 2026-10-11, user decision):** checker, N1, N2, P1 to P6, logs. **Waived:** F1, F2, F3, F4 and F5. The user is focused on Business OS and has no capacity to run or calibrate agents; agent creation and execution are out of scope for now. This follows SA S4a-2 (the proof is C5/C6 plus the P blocks plus the Postgres logs; F1 to F4 only corroborate): signed-in and service_role EXECUTE do not change in this slice, and no signed-out path reaches the 6. **Optional:** the inventory re-run. Every SQL block is written verbatim in the QA section (§ Acceptance blocks) and pinned by the static test.

1. **Checker:** `VERDICT PASS 36 pass 0 fail`.
2. **Role calls in the SQL editor**, each block in its own new tab, `BEGIN; SET LOCAL ROLE ...; ...; ROLLBACK;`, NULL arguments, no string literal:
   - N1 `anon` on `increment_executions_used(NULL::uuid)` → `42501`. (Were it still open, the body updates 0 rows, and the block rolls back.)
   - N2 `anon` on `get_top_insights()` → `42501`. (Were it still open, `auth.uid()` is NULL in the editor, so 0 rows.)
   - **P pass rule (SA S4a-1):** a P block **fails only** on `ERROR 42501 permission denied for function <that function>`. Any other outcome proves EXECUTE passed: it is a pass, recorded verbatim, and brought to SA as information, never a rollback. That includes no error, `23503`, or a `42501` whose message is `new row violates row-level security policy` (possible only if the owner did not bypass RLS on prod).
   - P1 `authenticated` on `increment_executions_used(NULL::uuid)`. Expected: no error (void; 0 rows updated, since `user_id = NULL` matches nothing).
   - P2 `authenticated` on `record_auto_fix_result(NULL::uuid, NULL::boolean)`. Expected: no error (0 rows).
   - P3 `authenticated` on `get_top_insights()`. Expected: 0 rows, no error.
   - P4 `authenticated` on `update_execution_baseline` with 7 NULLs, P5 on `record_execution_anomaly` with 12 NULLs, P6 on `upsert_error_pattern` with 8 NULLs. Expected: `ERROR 23502 null value in column ...` (the column name is not pinned). That error is raised inside the body, after the EXECUTE check passed, so it proves `authenticated` kept EXECUTE; nothing persists (the statement fails and the block rolls back).
   - No positive `service_role` call: C6 is the authority, and the sentinel, `execute-test` and admin-calibration paths run as service_role in normal traffic.
3. **Functional proof, within T+60 min**, signed in as a test account that is under its execution quota:
   - F1 snapshot, **corroboration only (SA S4a-2):** run block F1 **before** F2 and F3, and again **after**. Expected: `executions_used_total` rose by at least the number of test runs, `runs_recent` rose, and `baselines_recent` is at least 1 after a completed run. It is supporting evidence, not proof: the sum spans all accounts (another account's signed-in run can raise it too), and the `workflow_executions` insert does not run on the user's client, so `runs_recent` shows only that a run happened. The proof for `increment_executions_used` is C5 plus P1 plus the Postgres logs. F1 alone never triggers or clears a rollback. A fall in `executions_used_total` means a quota reset ran in between; a `42703` on F1 is a schema finding to record, never a rollback.
   - F2 Agent run: run one agent from the dashboard (`POST /api/run-agent`, cookie client). Expect the run to complete.
   - F3 Calibration: run one calibration on an agent the test account owns (`POST /api/v2/calibrate/batch`, cookie client, since it is not an admin cross-user run). Expect it to complete.
   - F4 Top insights: open `/api/v6/insights` (no `agentId`) in a signed-in tab. Expect `200` and `"success": true`. Corroboration only, because the repository returns `[]` on any error (S3-5); the proof for this path is P3 plus the Postgres logs.
   - F5 (optional) Error pattern: a run whose plugin step fails (for example, a step on a disconnected plugin), then block F5: `patterns_recent` at least 1. Optional because provoking a failure is not always practical; C5 and P6 prove the grant.
   - **No trace by design:** `record_execution_anomaly` writes only when an anomaly is detected, and `record_auto_fix_result` has no live caller. C5 plus P2 and P5 prove them.
4. **Logs, counts not lines (S2-3):** Supabase Postgres logs from T to T+24 h: count of `permission denied for function`, and how many name one of the 6; attribute each where the log allows. N1 and N2 add two deliberate hits. Unattributed or anon hits are probe counts, not failures. **Expired-session edge (SA S4a-3):** an `anon` hit naming `update_execution_baseline`, `record_execution_anomaly` or `upsert_error_pattern` that coincides with a signed-in run is the pre-existing R-11 case, not a rollback trigger; record the count for 4b. Vercel logs: no access (slice 3); covered by the Postgres logs.
5. Optional: re-run the inventory; anon-executable drops from 24 to 18, non-trigger from 6 to 0 (only the slice 5 trigger set remains anon-executable).

---

## 6. Apply order and rollback plan

All steps are run by the user in the Supabase SQL editor on prod (FR-0.6). Dev never connects to a database. No cron depends on these functions, so no quiet hour is needed; prefer a time when the user can run F2 and F3 straight after.

| Step | Where | Expect |
|---|---|---|
| 1. Pre-check | tab A | `PRECHECK STATUS CLEAN`. Paste the output under QA Testing Report. Any `stop here`: stop and bring it to Dev/SA |
| 2. Migration | **new** tab B | `Success. No rows returned`. Any error means nothing was applied |
| 3. Checker | new tab C | `VERDICT PASS 36 pass 0 fail` |
| 4. Role calls | one new tab per block | §5.3 step 2 |
| 5. Functional | the app, signed in | §5.3 step 3 |
| 6. Logs | Supabase Postgres to T+24 h | §5.3 step 4 |
| 7. Merge | GitHub | After SA code review, QA pass and the user's approval (RM). Apply and checker run before merge (FR-0.6) |

**Rollback triggers (S2-3): only a caller identified as ours.** Namely: a positive block (P1 to P6) failing with `permission denied for function` naming its own function (S4a-1; any other outcome, `23502` included, is a pass); F2 or F3 failing with a permission error; F1 showing no rise in `executions_used_total` after F2 and F3 completed **together with** a Postgres-log `permission denied for function increment_executions_used` in the window (StateManager swallows the error, so the log is what attributes it); or a Postgres-log entry naming one of the 6 whose role, user agent or source we recognise as our app. F1 alone never triggers or clears a rollback (S4a-2). A bare Postgres-log hit as `anon`, or a hit we cannot attribute, is a probe count, not a trigger. An `anon` hit naming `update_execution_baseline`, `record_execution_anomaly` or `upsert_error_pattern` that coincides with a signed-in run is the R-11 expired-session edge, not a trigger; record the count for 4b (S4a-3). On a real trigger: paste the rollback in a new tab, re-run the pre-check (Q4 `ok`, Q5 `match` x6), and bring the caller to Dev.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A signed-out path reaches one of the 6 that the code search missed (an external client using the anon key, an edge function, a prod-only SQL object) | §1.3 search and trace; pre-check Q6 to Q9 and Q11; Postgres logs; rollback ready. An anon hit from an unknown source is exactly what this slice is meant to block |
| R-2 | A prod-only INVOKER caller reachable by `anon` | Q6 stops on it (S3-2 rule) |
| R-3 | A foreign-grantor `anon` or `authenticated` entry survives the REVOKE | Q5 grantors before apply; the post-condition raises if `anon` still executes |
| R-4 | The class 2 client mapping is traced, not observed at runtime (requirement R-4) | Safe in 4a either way: `authenticated` and `service_role` both keep EXECUTE. Runtime confirmation stays a 4b prerequisite |
| R-5 | Quiet callers (rows 2, 3, 6) would hide a failure | They run as `authenticated` or `service_role`, both kept and proven by C5, C6 and P1 to P6; F1 adds table evidence for rows 1 and 2 |
| R-6 | Cross-tenant writes remain open to signed-in users | Accepted by FR-4a until 4b (SQ-1) |
| R-7 | Non-owner REVOKE | Q2 owner check; post-conditions raise |
| R-8 | Collation false `DIFFERS` | `COLLATE "C"` pinned |
| R-9 | Migration number taken before merge | T-10 re-check |
| R-10 | SQL-editor paste bugs | Static test, exact literal allow-list, no timestamp literals |
| R-11 | Expired session mid-run (SA S4a-3): `supabase-js` sends the anon key as the bearer when the session refresh fails, and these routes' cookie clients have no-op `set`/`remove`. A run that started with a near-expiry token then makes its late RPCs (`update_execution_baseline`, `record_execution_anomaly`, `upsert_error_pattern`) as `anon`. Today those succeed with the caller-supplied id; after 4a they fail `42501` and are swallowed | Rare and harmless to the run (all three are fire and forget). Log rule in §5.3 step 4 and §6: such a hit coinciding with a signed-in run is not a rollback trigger; its count is recorded for 4b, which removes the case (service-role client) |

---

## 8. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Migration form: `REVOKE ... FROM PUBLIC, anon, authenticated` then `GRANT ... TO authenticated, service_role` (FR-0.1, the slice 6 guard and C-8 form; slice 3's `is_platform_admin` precedent), or the brief's `REVOKE ... FROM PUBLIC, anon` plus `GRANT ... TO authenticated, service_role`? | The FR-0.1 form. It keeps every REVOKE identical across slices, the guard and the static test need no exception, and the re-grant runs in the same transaction, so `authenticated` is never observably without EXECUTE |
| Q-2 | Keep the `keeps_authenticated` column in the pre-check and checker even though all six are `true`? | Yes. Same code as slice 3, and 4b flips five rows to `false` |
| Q-3 | Q6: add an informational `4b review` suffix to INVOKER callers that are `ok` in 4a (they would break for signed-in users once 4b revokes `authenticated`)? | Yes. It never contains `stop here`, so it does not change the 4a gate; it gives 4b early warning |
| Q-4 | Negative calls: N1 (`increment_executions_used`, a writer) and N2 (`get_top_insights`, a reader) only, or one per function? | Two. One shape, so C3 and C4 in the checker cover the other four; slice 3 used three for three shapes |
| Q-5 | Positive calls P4 to P6 expect `ERROR 23502` (not-null violation inside the body), which proves EXECUTE passed. Accept "any outcome except `42501`" as the pass, or drop P4 to P6 and rely on checker C5? | Keep them with that pass rule. It is the only editor-side proof that `authenticated` can actually run the three inserters, and nothing persists |
| Q-6 | F1 uses `sum(user_subscriptions.executions_used)` across all accounts (no literal allowed for the test account). `executions_used` is defined only in `SQL Scripts/20251117_complete_quota_system.sql`, not in `migrations/`. Acceptable, given `ExecutionService` reads it on every run? | Yes. A rise is direct evidence; a quota reset in the window is the only confounder, and F1 is repeated if it falls |
| Q-7 | F4 (`/api/v6/insights` with no `agentId`) cannot fail visibly, because the repository returns `[]` on error. Keep it as corroboration, with P3 and the Postgres logs as the proof? | Yes |
| Q-8 | `record_execution_anomaly` (only on a detected anomaly) and `record_auto_fix_result` (no live caller): prove by C5 and P2/P5 only? | Yes, as slice 3 did for its no-trace functions (S3-5) |
| Q-9 | Record `ErrorRecovery.recordAutoFixResult` and `ErrorRecovery.checkAutoFix` (no caller) against SQ-3 as dead references, in this diff at code time (as slice 3 N-1)? | Yes, record only. 4b decides whether to delete the chain or move it to `supabaseServer` |
| Q-10 | Names: `20261050_secdef_lockdown_slice4a_signed_in.sql`, `secdef-lockdown-slice4a` for scripts and test | As proposed, re-checked at PR time |
| Q-11 | Should 4a's acceptance also try to settle R-4 (which role actually reaches each RPC), for example by reading `pg_stat_statements` or log roles after F2? | No. 4a is safe either way; R-4 belongs to 4b, which changes the clients |

---

## SA Review Notes

**Reviewed by SA — 2026-10-10**
**Status:** ✅ Approved with conditions (S4a-1 to S4a-4). Dev may start T-6 once the conditions are folded in; S4a-1 and S4a-2 land in the pinned QA blocks and §6, so they must be in before T-6.

### Independent re-verification (main `7e5964ec`, read-only)

1. **Signatures and grants.** The 6 TSV rows match §1.1 and FR-4a exactly: `kind fn`, one row each, `search_path` null, triggers 0, `execute_grantees` `PUBLIC postgres anon authenticated service_role`. One shape; rollback `TO PUBLIC, anon` is correct.
2. **No signed-out path.** Repo-wide name search (all `.ts/.tsx/.js/.sql/.json`, excluding `node_modules`, `.next`, `docs`, `.claude`) gives only the 6 RPC sites Dev lists, the 7 `CREATE`s, comments, `check-migrations.sql`, `verify_phase1_migration.sql` and the guard baseline. Every `new WorkflowPilot` site was re-checked: `run-agent:67-73`, `run-agent-sandbox:52-58` (also 404 outside development), `calibrate/resume:40-50`, `v2/calibrate/batch:93-101` all call `getUser()` and return 401 before the pilot on `createAuthenticatedServerClient` (anon key plus cookies, so `authenticated` when it runs); batch `:182` is `supabaseServer` only for the admin cross-user branch; sentinel, `v6/execute-test` and `DryRunValidator` are service-key. `StateManager`, `StepExecutor` and the services all take the pilot's client. `QuotaAllocationService.ts:27` also builds an `ExecutionService`, but only calls `applyExecutionQuotaBasedOnTokens` (on `supabaseServer`, from the Stripe webhook), never `recordExecution`; not a caller.
3. **`get_top_insights`.** Only `app/api/v6/insights/route.ts:43`, on the cookie client, 401 at `:24-26` before the repository is built. Every other `getTopInsights` hit is the Business OS prioritiser, not the RPC. Confirmed.
4. **Cron / queue.** `process-queue` and `runAgentKit` use the service-role key and construct none of `WorkflowPilot`, `StateManager`, `StepExecutor` or the three services (the `lib/agentkit` hits for those names are prose and compiler strings, not instantiations). No cron path reaches the 6.
5. **`record_auto_fix_result` is dead.** `ErrorRecovery.checkAutoFix` and `ErrorRecovery.recordAutoFixResult` are instance methods with no caller (`WorkflowPilot` only calls `errorRecovery.executeWithRetry`). Confirmed.
6. **Function bodies (git).** None uses `dblink`, `http`/`pg_net` or `pg_notify`; each is a single UPDATE, INSERT, upsert or SELECT on its own table. Nothing escapes the `BEGIN ... ROLLBACK` of the role blocks. (`pg_notify` and `pg_net` would be transactional anyway; only `dblink` would not, and none is present.) Prod bodies were never captured (C-10 applies only from S7), which is accepted: every P block rolls back regardless.
7. **Expected errors for P4 to P6, from the table DDL.** `update_execution_baseline(NULLs)`: the `SELECT ... WHERE agent_id = NULL` finds nothing, so it INSERTs with `agent_id` NULL, and `execution_baselines.agent_id` is NOT NULL → `23502`. `record_execution_anomaly(NULLs)`: `execution_anomalies.agent_id` NOT NULL → `23502`. `upsert_error_pattern(NULLs)`: the UPDATE matches nothing (`user_id = NULL`), then the INSERT hits `error_patterns.user_id` (or `error_code`/`plugin`) NOT NULL → `23502`. The NOT NULL check runs before FK checks, so not `23503`. P1 and P2 update 0 rows; P3 returns 0 rows (`auth.uid()` NULL in the editor).
8. **Residual edge, not a blocker (see S4a-3).** `supabase-js` sends the anon key as the bearer when `getSession()` returns no session (a refresh failure mid-run). The cookie client in these routes has no-op `set`/`remove`, so a run that started with a near-expiry token and fails its refresh would make its late RPCs (`update_execution_baseline`, `record_execution_anomaly`, `upsert_error_pattern`) as `anon`. Today those succeed with the caller-supplied id; after 4a they fail `42501` and are swallowed. Rare, harmless to the run, and removed by 4b (service-role client). It is the one way our own app could appear as an `anon` hit in the log window.

### Rulings on Q-1 to Q-11

| # | Ruling |
|---|---|
| Q-1 | **FR-0.1 form approved:** `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;` then `GRANT EXECUTE ... TO authenticated, service_role;`, same transaction, as slice 3 Q-4. Guard and static test need no exception. Post-condition keeps the `IF NOT ... authenticated` and `IF NOT ... service_role` raises and must not have an `authenticated` held-raise (as §2.5) |
| Q-2 | Yes, keep `keeps_authenticated` (all true). |
| Q-3 | Yes. `4b review` suffix, informational, never contains `stop here`, never counted in `PRECHECK STATUS`; the static test pins both. |
| Q-4 | Two negatives (N1 writer, N2 reader) suffice; C3 and C4 cover the rest. |
| Q-5 | Keep P4 to P6, with the precise rule in **S4a-1**. A NULL insert cannot persist: every block is `BEGIN ... ROLLBACK`, the statement errors, and the git bodies have no out-of-transaction side effect (item 6). |
| Q-6 | Accept the all-accounts `sum`. `executions_used` is defined only in `SQL Scripts/20251117_complete_quota_system.sql:225`, but `ExecutionService` reads it on every quota check, so it exists on prod; a `42703` on F1 is a schema finding to record, never a rollback. F1 is **corroboration** for row 1 (another account's signed-in run can raise the sum too); the proof for `increment_executions_used` is C5 plus P1 plus the Postgres logs. State that in §5.3 (S4a-2). |
| Q-7 | Yes: F4 is corroboration; P3 plus the logs are the proof. |
| Q-8 | Yes: C5 plus P2/P5 only, as S3-5. |
| Q-9 | Yes, record only, in this diff at code time. |
| Q-10 | Names approved; re-check `20261050` at PR time (T-10). |
| Q-11 | No. R-4 stays a 4b prerequisite; 4a is safe either way. |

### Conditions

1. **S4a-1 Precise pass rule for P1 to P6 (and the §6 trigger).** A P block **fails only** on `ERROR 42501 permission denied for function <that function>`. Expected: P1, P2 no error; P3 0 rows; P4 to P6 `ERROR 23502 null value in column ...` (do not pin the column name). Any other outcome (no error, `23503`, or a `42501` whose message is `new row violates row-level security policy`, which would only appear if the owner did not bypass RLS on prod) also proves EXECUTE passed: it is a pass, recorded verbatim, and brought to SA as information, never a rollback. Write the rule in the QA block lead-ins and change the §6 trigger from "failing with `42501`" to "failing with `permission denied for function`".
2. **S4a-2 F1 is corroboration, not proof.** §5.3 and §6: F1's rise is supporting evidence only (the sum spans all accounts, and the `workflow_executions` insert runs on `supabaseAdmin`, so `runs_recent` proves only that a run happened). The §6 trigger for row 1 already requires a matching Postgres-log entry; keep that, and say that F1 alone never triggers or clears a rollback.
3. **S4a-3 Log attribution for the expired-session edge.** Add item 8 above to §7 (new risk) and to §6: an `anon` `permission denied for function` naming `update_execution_baseline`, `record_execution_anomaly` or `upsert_error_pattern`, coinciding with a signed-in run, is this pre-existing edge, not a rollback trigger. Record the count for 4b (which removes it). Record it in §1.4 as a 4b input.
4. **S4a-4 Inventory §4.2 accuracy (docs, this diff).** The `upsert_error_pattern` row still cites `ErrorRecovery.ts:330,367` as callers. Line 330 is inside `checkAutoFix` and 367 inside `recordAutoFixResult`: both dead, and neither reaches `upsert_error_pattern`. Drop them from that row (leave `StepExecutor.ts:624`).

### Part (A) doc edits (accuracy only)

- Requirement header, §4.3 S3 row (PR #282, `7e5964ec`, applied 18:12 UTC, 108/0, log watch pending) and new S4a row: accurate. `7e5964ec` is the PR #282 merge, committed 2026-10-10. `origin/main` tops at `20261049`.
- Slice 3 workplan status and Change History row: accurate.
- Inventory §6 rows 3 and 4a and the `record_auto_fix_result` §4.2 correction: accurate; one residual in the `upsert_error_pattern` row (S4a-4).

### Proportionality

Acceptance is right-sized: checker 36/0 proves C5/C6 (authenticated and service_role kept) for all 6; P1 to P6 prove it from the editor; F2 (agent run) and F3 (own-agent calibration) prove the real signed-in flows; logs to T+24 h. No cron block is needed. F5 optional is fine.

### Optimisation Suggestions

- N-1: §1.3 could mention `QuotaAllocationService.ts:27` (item 2) so 4b does not re-trace it.
- N-2: paste rules are already met by the drafts (no literals, no timestamp literals, no "into", no `--`); keep the F1 window as `make_interval(mins => 30)`.

### Approval
[x] Workplan approved with conditions S4a-1 to S4a-4. Proceed to T-6 once they are folded in.

**Code Review by SA — 2026-10-10**
**Status:** ✅ Code Approved (with one doc nit, non-blocking)

### Desk check (PostgreSQL)

- Migration: per function `REVOKE ... FROM PUBLIC, anon, authenticated` then `GRANT ... TO authenticated, service_role` in one transaction (Q-1). Net ACL: owner `postgres`, `authenticated`, `service_role`; `PUBLIC` and `anon` gone (anon is not a member of `authenticated`). Post-condition raises on public/anon held and on authenticated/service_role not held; no authenticated held-raise, so the kept grant cannot fail the apply.
- Rollback: `GRANT ... TO PUBLIC, anon` on top of the migration's explicit `authenticated` and `service_role` entries gives grantees `PUBLIC postgres anon authenticated service_role` = the TSV shape. Post-condition requires all four roles.
- Checker: 6 x (C1, C2, public, anon, authenticated, service_role) = 36. Before apply: 24 pass / 12 fail (public, anon). After: 36 / 0. NULL `is_held` fails both branches (C-2).
- Pre-check: `PRECHECK STATUS` counts only `stop here`; the Q6 ` ok 4b review` tag never contains it (Q-3). Every `string_agg` ordered `COLLATE "C"`; expected grantees sorted the same way. Q4/Q5 expectations read from the TSV row.
- Acceptance blocks: arity matches prod `nargs` (1, 7, 12, 8, 2); `get_top_insights()` is valid (TSV `min_args` 0, `p_limit DEFAULT 5`), so N2 hits 42501, not 42883. Role blocks are `BEGIN; SET LOCAL ROLE ...; ...; ROLLBACK`. No literal, timestamp, "into" or `--`. P1/P2 bodies are single UPDATEs returning void (one row, no error); P4 to P6 NOT NULL as recorded in the workplan review.
- F1/F5 columns: `user_subscriptions.executions_used` (SQL Scripts `20251117_complete_quota_system.sql:226`, prod-only, accepted per Q-6), `workflow_executions.started_at` (written by `StateManager.ts:192`), `execution_baselines.updated_at` (`20260629_execution_optimization_tables.sql:40`), `error_patterns.last_seen` (`20260629_error_patterns_table.sql:26`). All real.
- S4a-1 to S4a-4 and Q-1 to Q-11 are reflected in code, tests and docs (S4a-4: inventory §4.2 row now cites only `StepExecutor.ts:624`).
- `20261050` is free on `origin/main` and on every remote branch (re-checked at review time).

### Code Review Comments

1. `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` §6 row 4a and the requirement §4.3 S4a row say "awaiting SA code review". Update to "code SA-approved" when QA runs, or at PR time (T-10). Priority: Low

### Verification run

- `npx jest supabase/migrations/__tests__/secdef-lockdown-slice4a.migration.test.ts`: 85/85.
- `npm run test:authz-guard`: 203/203 (admin authz guard plus SECDEF surface guard, which scans `20261050`).
- Doc integrity: `git diff --stat` 3 files, +16/-10, CRLF preserved, no large deletions; the word diff shows only the intended edits.

### Code Approved for QA: Yes

---

## QA Testing Report

**QA — 2026-10-10**
**Test mode:** full
**Strategy used:** A (Jest: the slice 4a static test and the authz guards) plus C (a local PGlite 0.5.8 / PostgreSQL 18.3 harness in the QA scratchpad, the slice 3 approach). No branch database exists (FR-0.6) and production was never connected to.
**Focus:** schema, security
**Skipped:** F2 to F4 and the Postgres-log watch. They need the live app after apply, so the user runs them (results table below).
**Input source:** caller brief, plus §5.2 of this workplan

**Fixture.** Supabase-like roles (`anon`, `authenticated`, `service_role`, plus `supabase_admin` and `other_owner` for the negatives). Postgres default privileges grant functions and tables to the three client roles. The 6 functions have the prod identity signatures from the TSV and their git bodies, are SECURITY DEFINER and owned by `postgres`, and carry the TSV grant shape (`PUBLIC postgres anon authenticated service_role`, all granted by `postgres`). Tables mirror git: `execution_baselines`, `execution_anomalies` and `error_patterns` keep their NOT NULL columns, FKs and RLS policies. There are minimal `user_subscriptions.executions_used`, `workflow_executions (started_at, run_mode)`, `execution_insights`, `agents`, `agent_executions` and `auth.users` tables. Each "new tab" is a fresh connection.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Static test | ✅ | Pass | 85/85 |
| `npm run test:authz-guard` | ✅ | Pass | 203/203 (2 suites) |
| Pre-check on the prod-shaped fixture | ✅ | Pass | `CLEAN`, 69 rows. Q1 `present` x6; Q2 `postgres ok` x6; Q3 `secdef true config none ok` x6; Q4 all four true `ok` x6; Q5 `match` and `owner granted all` x6; Q6 `0 found 0 flagged` x6; Q7, Q8 and Q11 `0` x6; Q9 `cron not installed` x6 |
| Pre-check under an ICU `und` database | ✅ | Pass | `CLEAN`, Q5 `match` x6. Mutation check: with `COLLATE "C"` removed it reads `STOP 6`, so the collation guard does real work |
| Checker before apply | ✅ | Pass | `VERDICT FAIL 24 pass 12 fail`. The failures are exactly C3 and C4 for each function |
| Migration, first run | ✅ | Pass | Success. Each ACL is now `{postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}` |
| Checker after apply | ✅ | Pass | `VERDICT PASS 36 pass 0 fail` |
| Migration, second run (idempotent) | ✅ | Pass | Success; checker still 36/0 |
| Pre-check then migration in the same session | ✅ | Pass | `25006 cannot execute REVOKE in a read-only transaction`, so the READ ME new-tab rule holds |
| N1 (`anon`, `increment_executions_used`) | ✅ | Pass | Verbatim block. Before apply: `OK`, the hole was open. After apply: `ERROR 42501 permission denied for function increment_executions_used` |
| N2 (`anon`, `get_top_insights()`) | ✅ | Pass | Verbatim block. Before apply: `OK` with `insight_rows 0`. After apply: `ERROR 42501 permission denied for function get_top_insights` |
| P1 (`authenticated`, `increment_executions_used`) | ✅ | Pass | One row, no error |
| P2 (`authenticated`, `record_auto_fix_result`) | ✅ | Pass | One row, no error |
| P3 (`authenticated`, `get_top_insights()`) | ✅ | Pass | `insight_rows 0`, no error |
| P4 (`authenticated`, `update_execution_baseline`) | ✅ | Pass (S4a-1) | `ERROR 23502 null value in column "agent_id" of relation "execution_baselines" violates not-null constraint` |
| P5 (`authenticated`, `record_execution_anomaly`) | ✅ | Pass (S4a-1) | `ERROR 23502 null value in column "agent_id" of relation "execution_anomalies" violates not-null constraint` |
| P6 (`authenticated`, `upsert_error_pattern`) | ✅ | Pass (S4a-1) | `ERROR 23502 null value in column "user_id" of relation "error_patterns" violates not-null constraint` (the UPDATE matches 0 rows, then the INSERT fails) |
| P blocks leave no trace | ✅ | Pass | After P1 to P6: `executions_used` unchanged, and 0 rows in baselines, anomalies and patterns |
| Role matrix (6 x `anon` / `authenticated` / `service_role`, NULL arguments) | ✅ | Pass | `anon` gets `42501` on all 6. `authenticated` and `service_role` pass EXECUTE on all 6: `ok` for 3 and `23502` from inside the body for 3. No `authenticated` 42501 |
| F1 is valid SQL | ✅ | Pass | Verbatim block: `executions_used_total 3, runs_recent 0, baselines_recent 0`. After real-valued `authenticated` calls to `increment_executions_used`, `update_execution_baseline` and `upsert_error_pattern`: `4, 0, 1`, and F5 `patterns_recent 1`. The signed-in write path works end to end after apply. Every column F1 and F5 name is from git |
| Rollback | ✅ | Pass | Success (DO post-condition passed). `public`, `anon`, `authenticated` and `service_role` are all true for all 6. The checker after rollback is row-for-row identical to the pre-state (24/12). Pre-check `CLEAN`, Q4 `ok` x6, Q5 `match` x6, `owner granted all` x6 |
| ICU run: migration, checker and rollback | ✅ | Pass | Checker 24/12 before and 36/0 after; rollback succeeds; pre-check `CLEAN` afterwards |
| NEG: missing function (`record_auto_fix_result` dropped) | ✅ | Pass (fails safe) | Pre-check `STOP 6` (Q1 `MISSING`, Q2, Q3, Q4, Q5 grantees and Q5 grantors). Migration `42883 function public.record_auto_fix_result(uuid, boolean) does not exist`; all ACLs unchanged; checker 20/16 |
| NEG: foreign-grantor `anon` entry (`supabase_admin` grants `anon` on `get_top_insights`) | ✅ | Pass (stops) | Pre-check `STOP 2`: Q5 grantees `DIFFERS` and Q5 grantors `anon by supabase_admin ... OTHER GRANTOR stop here`. Migration `P0001 Slice 4a anon still executes so nothing was applied public.get_top_insights(integer)`; all ACLs unchanged |
| NEG: INVOKER non-trigger caller that `anon` can run (wraps `increment_executions_used`) | ✅ | Pass (Q6 stop) | `STOP 1`: `Q6 caller public qa_inv_anon ... anon executes true ... stop here`. If applied anyway, `anon` calling the wrapper gets `42501 permission denied for function increment_executions_used`. That is the break Q6 guards against |
| NEG: INVOKER non-trigger caller that `anon` cannot run | ✅ | Pass | Pre-check `CLEAN`; the row reads `... anon executes false ... ok 4b review`, and `PRECHECK STATUS` does not count it. A second fixture adds a `get_top_insights` caller (`ok 4b review`) and a postgres-owned SECDEF caller of `record_auto_fix_result` (plain `ok`, no tag): still `CLEAN` |
| NEG: SECDEF caller owned by `other_owner` | ✅ | Pass (Q6 stop) | `STOP 1`, `secdef true owner other_owner ... stop here` |
| NEG: INVOKER trigger caller (`anon` cannot execute it) | ✅ | Pass (Q6 stop) | `STOP 1`, `trigger true anon executes false ... stop here` (S3-2: a trigger always stops) |
| NEG: policy `TO public` naming `get_top_insights` | ✅ | Pass (stops) | `STOP 2`: Q7 `roles {public} stop here` and Q11 `catalog pg_policy ... stop here` |
| NEG: column default calling `increment_executions_used` | ✅ | Pass (stops) | `STOP 1`: Q11 `catalog pg_attrdef ... stop here` |
| F2, F3, F4, F5 on prod, and the Postgres logs to T+24 h | ⚠️ | Not run | User-run after apply (results table below) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
None blocking. For the record:
1. The P4 to P6 `23502` messages above name the git column order (`agent_id`, `agent_id`, `user_id`). On prod the first NOT NULL column hit may differ, which is why the column is not pinned. Any `23502` counts as a pass.
2. NEG-3 also shows the migration does not stop an `anon`-runnable INVOKER caller on its own: that gate is the pre-check. The order in §6 (pre-check `CLEAN` first) is load-bearing, as in slices 1 to 3.

### Gaps (what this run cannot show)
- PGlite is not Supabase. Prod's real owner and RLS-bypass behaviour, prod-only callers, policies, views and dependents, and pg_cron are measured only by the pre-check on prod. Q9 was exercised only in the `cron not installed` branch here.
- The cookie-client role at runtime (R-4), F2 to F4, and the R-11 expired-session count all need the live app and the Postgres logs after apply.
- The `workflow_executions` insert does not run on the user's client, so F1's `runs_recent` stays corroboration only (S4a-2).

### Final Status
- [x] All acceptance criteria that can be tested before apply pass. **Ready for commit.** No bug is open. F2 to F4, the optional F5 and the log watch stay with the user after apply.
- [ ] Issues found — Dev must address before commit

### Acceptance blocks (written by Dev per SA S4a-1 and S4a-2, run by the user)

Paste each block in its own **new** SQL-editor tab, after the migration and the checker. They hold no comment, no "into", no string literal and no timestamp literal. The static test pins every block. Role blocks end in `ROLLBACK`, so nothing persists and the role reverts. If a role block fails with `permission denied to set role`, that is the editor role, not the slice: record it; the checker still proves the grants.

Block N1, as `anon`. Pass: `ERROR 42501 permission denied for function increment_executions_used`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT public.increment_executions_used(NULL::uuid);
ROLLBACK;
```

Block N2, as `anon`. Pass: `ERROR 42501 permission denied for function get_top_insights`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT count(*) AS insight_rows FROM public.get_top_insights();
ROLLBACK;
```

Block P1, as `authenticated`. Expected: one row, no error. Pass unless `ERROR 42501 permission denied for function increment_executions_used` (S4a-1); any other outcome is recorded verbatim.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.increment_executions_used(NULL::uuid);
ROLLBACK;
```

Block P2, as `authenticated`. Expected: one row, no error. Pass unless `ERROR 42501 permission denied for function record_auto_fix_result` (S4a-1); any other outcome is recorded verbatim.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.record_auto_fix_result(NULL::uuid, NULL::boolean);
ROLLBACK;
```

Block P3, as `authenticated`. Expected: `insight_rows` 0, no error. Pass unless `ERROR 42501 permission denied for function get_top_insights` (S4a-1); any other outcome is recorded verbatim.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT count(*) AS insight_rows FROM public.get_top_insights();
ROLLBACK;
```

Block P4, as `authenticated`. Expected: `ERROR 23502 null value in column ...` (column not pinned). Pass unless `ERROR 42501 permission denied for function update_execution_baseline` (S4a-1); any other outcome is recorded verbatim.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.update_execution_baseline(NULL::uuid, NULL::uuid, NULL::numeric, NULL::numeric, NULL::integer, NULL::integer, NULL::boolean);
ROLLBACK;
```

Block P5, as `authenticated`. Expected: `ERROR 23502 null value in column ...` (column not pinned). Pass unless `ERROR 42501 permission denied for function record_execution_anomaly` (S4a-1); any other outcome is recorded verbatim.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.record_execution_anomaly(NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::integer);
ROLLBACK;
```

Block P6, as `authenticated`. Expected: `ERROR 23502 null value in column ...` (column not pinned). Pass unless `ERROR 42501 permission denied for function upsert_error_pattern` (S4a-1); any other outcome is recorded verbatim.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.upsert_error_pattern(NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb);
ROLLBACK;
```

Block F1, run before and after F2 and F3. Corroboration only (S4a-2): F1 alone never triggers or clears a rollback.

```sql
SELECT (SELECT sum(user_subscriptions.executions_used) FROM public.user_subscriptions) AS executions_used_total,
       (SELECT count(*) FROM public.workflow_executions WHERE workflow_executions.started_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 30)) AS runs_recent,
       (SELECT count(*) FROM public.execution_baselines WHERE execution_baselines.updated_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 30)) AS baselines_recent;
```

Block F5 (optional), within 30 minutes of the failing run. Pass: `patterns_recent` at least 1.

```sql
SELECT count(*) AS patterns_recent
FROM public.error_patterns
WHERE error_patterns.last_seen >= pg_catalog.now() - pg_catalog.make_interval(mins => 30);
```

| Check | Result (user) |
|---|---|
| Pre-check status | ⬜ |
| Checker | ⬜ |
| N1, N2 | ⬜ |
| P1 to P6 (outcome verbatim) | ⬜ |
| F1 before and after (corroboration) | ➖ waived 2026-10-11 (agent runs out of scope) |
| F2, F3, F4 | ➖ waived 2026-10-11 (agent runs out of scope) |
| F5 (optional) | ⬜ |
| Logs: Postgres to T+24 h; count of R-11 expired-session anon hits for 4b | ⬜ |

---

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-10 | Created (Dev) | Slice 4a workplan: 6 signatures verified against the prod TSV (no discrepancy), one grant shape (`PUBLIC postgres anon authenticated service_role`), so one rollback form (`TO PUBLIC, anon`). Callers re-verified on `7e5964ec`: every call site is behind a `401` session check on the cookie client or on a service-role client; no signed-out caller, no SQL caller in git, no cron; `record_auto_fix_result` has no live caller. Migration form follows FR-0.1 (revoke all three, re-grant `authenticated, service_role`). Proposed acceptance: checker 36/0, N1 and N2, P1 to P6, F1 to F4, Postgres logs to T+24 h. Migration `20261050` proposed. 11 open questions for SA. Slice 3 recorded as merged in the requirement, inventory and slice 3 workplan |
| 2026-10-10 | SA workplan review | APPROVED WITH CONDITIONS (S4a-1 to S4a-4). Re-verified on `7e5964ec`: no signed-out path to any of the 6; cookie-client routes all 401 before the pilot; `get_top_insights` only from `v6/insights` behind 401; no cron or queue path; `record_auto_fix_result` dead. Q-1 to Q-11 ruled (Q-1 FR-0.1 revoke-then-regrant form). S4a-1: P blocks fail only on `permission denied for function`, P4 to P6 expect `23502`; S4a-2: F1 is corroboration; S4a-3: expired-session anon fallback recorded as a risk and log-attribution rule; S4a-4: inventory §4.2 `upsert_error_pattern` row drops the dead `ErrorRecovery` lines |
| 2026-10-10 | SA conditions folded in; implementation T-6 to T-10 (Dev) | S4a-1: P blocks fail only on `permission denied for function` naming their own function; P4 to P6 expect `23502` with the column not pinned; any other outcome is a pass, recorded verbatim (§5.3, §6, QA block lead-ins). S4a-2: F1 is corroboration only and never triggers or clears a rollback (§5.3, §6, F1 lead-in). S4a-3: new risk R-11 (expired session mid-run, late RPCs as anon, swallowed 42501), log rule in §5.3 step 4 and §6, count recorded for 4b (§1.4, QA results table). S4a-4: inventory §4.2 `upsert_error_pattern` row no longer cites the dead `ErrorRecovery` lines. N-1: `QuotaAllocationService.ts:27` noted in §1.3. Q-3: the `4b review` tag never says stop here and is never counted in `PRECHECK STATUS`. Q-9: SQ-3 list in the requirement gains the dead `ErrorRecovery` chain. Acceptance blocks moved from §5.3 to the QA section. Five files written under `20261050`; static test 85/85 (mutation-checked); regressions 351/351 and authz guard 203/203; number still free. Left uncommitted for SA code review |
| 2026-10-10 | SA code review | CODE APPROVED (one Low doc nit: inventory §6 row 4a and requirement S4a row still say "awaiting SA code review"). Desk-checked the grant arithmetic (checker 24/12 before, 36/0 after; rollback restores the TSV grantee set), the `4b review` tag never counted, `COLLATE "C"`, the acceptance-block arities against prod `nargs`, and the F1/F5 columns. Slice test 85/85, authz guard 203/203; `20261050` still free |
| 2026-10-10 | QA | PASS, ready for commit. Static test 85/85, authz guard 203/203. Local PGlite run on a prod-shaped fixture (git bodies and tables, TSV grant shape). Pre-check `CLEAN`, also under ICU `und`. Checker 24/12 before and 36/0 after; migration idempotent. N1 and N2 `42501`; P1 to P3 no error; P4 to P6 `23502` (exact messages recorded); F1 and F5 valid. Rollback restores all four roles, the checker matches the pre-state row for row, and the pre-check is `CLEAN`. All negatives stop or fail safe (missing function, foreign grantor, `anon`-runnable INVOKER caller, foreign-owned SECDEF caller, INVOKER trigger, policy `TO public`, column default). An INVOKER caller that `anon` cannot run shows `ok 4b review` and is not counted. No bugs |
| 2026-10-11 | Acceptance amended (TL, user decision) | User is focused on Business OS; agent creation and execution are out of scope. F1 to F5 waived. Proof per SA S4a-2: checker 36/0 (C5/C6), N1/N2 refusals, P1 to P6 signed-in calls, Postgres logs to T+24 h |
