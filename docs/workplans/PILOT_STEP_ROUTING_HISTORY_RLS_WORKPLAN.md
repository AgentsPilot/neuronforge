# Workplan: Lock down `pilot_step_routing_history` (anon cross-tenant exposure)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [PILOT_STEP_ROUTING_HISTORY_ANON_EXPOSURE_REQUIREMENT.md](/docs/requirements/PILOT_STEP_ROUTING_HISTORY_ANON_EXPOSURE_REQUIREMENT.md). The SA conditions C-1 to C-10 in its `## SA Review` section are binding.
**Branch:** `fix/pilot-routing-history-rls` (off `origin/main` @ `7916cc68`)
**Date:** 2026-10-11
**Status:** Code Complete (uncommitted). T-1 to T-7 are done, with SA conditions C-1 to C-10, W-1 to W-6 and S-1 to S-5 applied. Next is T-8, the SA code review.

## Overview

This workplan covers one table. Anyone with the public anon key can read all 21 rows of `public.pilot_step_routing_history`. The fix makes the table server-only, keeps one admin read path, and adds a revoke-only change to the views that read the table (SA C-3). The fix follows the shape of `20261017_business_os_credit_lots.sql` (R-2): enable RLS, revoke all per role, re-grant the minimum, and use a `(SELECT ...)`-wrapped policy predicate. It is guarded like the secdef slices: a `DO` pre-guard and a `DO` post-assert in one transaction, so any mismatch leaves "nothing was applied".

No code is written until the user returns the Step 1 precheck. The migration pins the exact policy definitions and the names of the dependent views from that capture.

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Files to Create / Modify](#files-to-create--modify)
4. [Step 1: Precheck (user-run, read-only)](#step-1-precheck-user-run-read-only)
5. [Step 2: Migration 20261055](#step-2-migration-20261055)
6. [Rollback (C-7)](#rollback-c-7)
7. [Post-apply checker and anon probe (C-5)](#post-apply-checker-and-anon-probe-c-5)
8. [Jest guard (C-8)](#jest-guard-c-8)
9. [FR-9 purge descriptor note](#fr-9-purge-descriptor-note)
10. [Order independence with price review slice 2 (20261052)](#order-independence-with-price-review-slice-2-20261052)
11. [Production apply order](#production-apply-order)
12. [Test plan](#test-plan)
13. [Risks](#risks)
14. [Open design points for SA](#open-design-points-for-sa)
15. [Task List](#task-list)
16. [SA Review Notes](#sa-review-notes)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## Analysis Summary

| Object | What this slice does | Condition |
|---|---|---|
| `public.pilot_step_routing_history` | Enable RLS (no FORCE). Drop the three captured `public` policies by exact name (S-1). Revoke ALL from PUBLIC, anon, authenticated and service_role. Grant SELECT to authenticated and to service_role. Create `pilot_step_routing_history_admin_select`. | C-1, C-2, R-2 |
| Views that depend on the table, found recursively, except the slice-2 view | Revoke ALL from PUBLIC, anon and authenticated. Grant SELECT to service_role. No redefinition and no drop. | C-3 |
| `pilot_cost_savings_summary` | **Not touched. Not named in the migration or the rollback.** | C-6 |
| `operator_test_account_cleanup` (20261047) | No change. It runs as postgres, so it keeps working as long as postgres owns the table and RLS is not forced. | C-1, V-1, C-9 |
| `lib/business-os/purge/descriptors.ts:469` | Comment-only refresh of the N17 note. | FR-9, R-4 |

**DB tables touched:** this one table, plus whichever views the precheck finds (expected: some of `pilot_tier_distribution`, `pilot_step_type_analysis`, `pilot_routing_performance`, `routing_source_comparison`).
**App code touched:** none. No `lib/`, `app/` or `components/` code reads or writes the table or its views (F-5, V-3, R-3).
**Providers / API routes:** none.
**Skills consulted:** `tenant-isolation-guard` (this is a cross-tenant fix), `business-os-schema-check` (live state is captured by the Step 1 probe, not assumed). `business-os-entitlements` does not apply: SA V-6 found no import from that module in `descriptors.ts`. Logging does not apply: `descriptors.ts` has 0 `console.*` calls.

**Deprecated-pattern flag:** none introduced. The table itself is legacy telemetry (writers removed in `a90a7f79`). Dropping it is Option C and out of scope.

---

## Implementation Approach

1. **Capture first, pin second.** The Step 1 precheck is one read-only result grid. Its output gives the policy definitions and the dependent-view name set. The migration guard then requires that exact state (C-2, C-3). If prod has drifted, the guard refuses before anything changes.
2. **One transaction, guarded on both sides.** The shape is `BEGIN; SET LOCAL lock_timeout = '5s';`, then a `DO` pre-guard, then the plain statements, then a `DO` post-assert, then `COMMIT;`. The post-assert follows the 20261050 precedent: it re-reads the catalog and raises "... so nothing was applied", which rolls back the whole transaction if the result is not the target state.
3. **Placeholders fail closed.** Until Step 1 returns, every captured value is written as the token `PENDING_STEP_1`, which cannot match a real catalog value. A guard holding a placeholder therefore always refuses on prod. The Jest guard also fails while any `PENDING_STEP_1` remains, so a placeholder file cannot be merged.
4. **Paste safety, as in the 20261038 and 20261050 files.**
   - No `--` and no `/*` in any pasted file.
   - String literals contain only letters, digits, underscore and space (W-1). There are no dotted literals: no `to_regclass('public.x')` and no `'public.x'::regclass`. Tables are resolved by joining `pg_class` to `pg_namespace` on `nspname = 'public'` and `relname = '...'`. Every file has an even count of single quotes.
   - "into" appears nowhere, **as a substring in any case** (W-1, `/into/i` as in the 4a test). This includes PL/pgSQL `SELECT ... INTO`, so the guards use `:=` assignments and `IF EXISTS (...)` / `IF (SELECT count(*) ...) <> n`.
   - No single-letter aliases.
   - Values that would need other characters are built with functions instead: the date is `make_date(2025, 11, 12)`, not a string; roles are compared as `ARRAY['public']::name[]`, never as the `'{public}'` literal.
   - If a captured `qual` or `with_check` is not one plain word (for example, if it contains parentheses), the guard compares `md5(qual)` with a hex literal.
5. **The words SECURITY DEFINER never appear** in the migration, the rollback or the scripts. The slice 6 guard (`supabase/__tests__/security-definer-surface.guard.test.ts`) fails closed (F-2) on those words inside a dollar-quoted DO body. Where the definer flag is needed, the checker reads `pg_proc.prosecdef`.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-pilot-step-routing-history-rls.sql` | create | FR-1 / C-4. Read-only, one grid. |
| `supabase/migrations/20261055_pilot_step_routing_history_rls_lockdown.sql` | create | FR-2 to FR-4, C-1 to C-3, C-6 |
| `supabase/SQL Scripts/20261055_pilot_step_routing_history_rls_lockdown_rollback.sql` | create | FR-7 as scoped down by C-7 |
| `scripts/check-pilot-step-routing-history-rls-migration.sql` | create | FR-6 / C-5. Read-only, one grid, VERDICT row first. |
| `supabase/migrations/__tests__/pilot-step-routing-history-rls.migration.test.ts` | create | FR-8 / C-8 |
| `lib/business-os/purge/descriptors.ts` | modify (line 469, string only) | FR-9 / R-4 |
| `docs/workplans/PILOT_STEP_ROUTING_HISTORY_RLS_WORKPLAN.md` | create | This file |

The requirement file is **not** edited by Dev in this pass. A BA is amending its body now (C-7 and C-10 text fixes). The Step 1 results still have to be recorded in it (AC-1), and TL routes that to BA once the amendment lands. A copy is kept in this workplan's Appendix A.

No `package.json` change and no workflow change.

---

## Step 1: Precheck (user-run, read-only)

**File:** `scripts/precheck-pilot-step-routing-history-rls.sql`

The precheck is **one statement producing one grid** (`sort_order, item, detail`), modelled on `precheck-purchase-path-tables-grants.sql`. The first statement is `SET default_transaction_read_only = on;`. Row 0 is the READ ME row: `this session is now read only so run the migration in a NEW tab`. The CTE is `WITH RECURSIVE` because of the view walk. Every row below comes from `pg_catalog`, except the Q9 row counts.

| Row group | Captures | Condition |
|---|---|---|
| Q1 table | exists, `relkind`, owner (`pg_get_userbyid(relowner)`), `relrowsecurity`, `relforcerowsecurity` | C-1, C-4 |
| Q2 table ACL raw | `COALESCE(relacl, acldefault('r', relowner))::text` verbatim, so the rollback can restore service_role exactly | C-4, C-7 |
| Q3 table grants per grantee | one row per grantee from `aclexplode(...)`: PUBLIC, postgres, anon, authenticated, service_role, and any other role found. Privileges are space-joined, including MAINTAIN, and `is_grantable` is flagged. | C-4 |
| Q4 column grants | one row per (column, grantee, privilege) from `pg_attribute.attacl` for **all** roles, or `none` | C-4 |
| Q5 policies | one row per `pg_policies` row, verbatim: `policyname`, `permissive`, `roles::text`, `cmd`, `qual`, `with_check`, plus `md5(qual)` and `md5(with_check)` for pinning. A policy count row comes first. | C-2, C-4 |
| Q6 foreign keys | one row per FK where `conrelid` is the table: constraint name, column, target table and column, and `confdeltype` spelled out (`no action`, `restrict`, `cascade`, `set null`, `set default`). The capture returned **0**, so this table has no foreign key (S-2 corrects V-2). | C-4 |
| Q7 dependent views | a recursive walk `pg_depend` to `pg_rewrite` to `ev_class`, relkind `v` and `m`, depth reported. Per view: name, depth, relkind, owner, `reloptions`, raw ACL, `relispopulated` for materialized views (SA suggestion), and **whether the view's own rewrite rule has a direct `pg_depend` row on `ai_model_pricing`** (W-3). The view rows are followed by a summary row counting such views among the depth-1 dependents. | C-3, C-4, D-1, W-3, W-5 |
| Q8 functions | `operator_test_account_cleanup`: owner, `prosecdef`, `proacl`. `is_platform_admin()`: exists, EXECUTE for authenticated and for service_role. Also, as INFO beyond C-4: every function whose `prosrc` names the table, with owner, `prosecdef`, and whether anon or authenticated can execute it. This catches a second anon path through an RPC. | C-1, V-1, V-4 |
| Q9 rows | total; `user_id IS NOT NULL`; `created_at > make_date(2025, 11, 12)` | C-4 |
| Q10 environment | `server_version_num` (MAINTAIN exists only on PG17); `checked at utc` | |

### What the user runs in Step 1

1. Open a **new** Supabase SQL editor tab on **prod**.
2. Paste the whole of `scripts/precheck-pilot-step-routing-history-rls.sql` and run it. It is read-only, sets the session read-only on its first line, and writes nothing.
3. Copy the **whole single result grid** (all rows, `sort_order / item / detail`) and paste it back to the session as text or CSV.
4. Close that tab. Because the session is read-only, the migration must later run in a **new** tab.

The script is written in Task T-1 and handed to the user before T-2. The grid fills Appendix A. The pinned values (Q5 names, cmd, qual and with_check or their md5, Q7 view names, Q3 service_role privileges) then replace every `PENDING_STEP_1`.

---

## Step 2: Migration 20261055

**File:** `supabase/migrations/20261055_pilot_step_routing_history_rls_lockdown.sql` (`20261055` is free in every worktree, per SA V-7)

Exact statement list, in order. `<V>` is each captured C-3 view, one block per view, in Q7 order.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ ... pre-guard ... $$;
DROP POLICY "Service role can access all routing history" ON public.pilot_step_routing_history;
DROP POLICY "System can insert routing history" ON public.pilot_step_routing_history;
DROP POLICY "Users can read their own routing history" ON public.pilot_step_routing_history;
ALTER TABLE public.pilot_step_routing_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pilot_step_routing_history FROM PUBLIC;
REVOKE ALL ON TABLE public.pilot_step_routing_history FROM anon;
REVOKE ALL ON TABLE public.pilot_step_routing_history FROM authenticated;
REVOKE ALL ON TABLE public.pilot_step_routing_history FROM service_role;
GRANT SELECT ON TABLE public.pilot_step_routing_history TO authenticated;
GRANT SELECT ON TABLE public.pilot_step_routing_history TO service_role;
CREATE POLICY pilot_step_routing_history_admin_select ON public.pilot_step_routing_history AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON TABLE public.<V> FROM PUBLIC;
REVOKE ALL ON TABLE public.<V> FROM anon;
REVOKE ALL ON TABLE public.<V> FROM authenticated;
GRANT SELECT ON TABLE public.<V> TO service_role;
DO $$ ... post-assert ... $$;
COMMIT;
```

(This sketch is for planning only. The real file has no comments, per paste safety.)

**Pre-guard.** Each check raises `... so nothing was applied`.
- The table exists as relkind `r`, and its owner is `postgres` (C-1).
- `relforcerowsecurity` is false (C-1).
- The policy set is **exactly** the three captured rows (C-2 as amended by S-1). The count is 3, and each name matches with `permissive = 'PERMISSIVE'`, `roles = ARRAY['public']::name[]`, and the captured `cmd`, `qual` and `with_check` (or their md5) (C-2).
- The recursive dependent-view name set, minus the one view excluded per D-1, equals the captured array exactly. Names are compared as sorted text arrays, never OIDs (C-3).
- **The D-1 exclusion predicate (W-3).** There is exactly one dependent view whose **own** `pg_rewrite` rule has a direct `pg_depend` row on `ai_model_pricing`, found by `pg_class` join `pg_namespace`, never through the walk. That view is at depth 1, and its name is not in the captured C-3 array. Any other count refuses. The same predicate text is used in the post-assert and in checker C14.
- `public.is_platform_admin()` exists, and authenticated can execute it (V-4). Without it, the policy would deny every admin.

**Post-assert.** Each check raises `... so nothing was applied`.
- RLS is on and not forced.
- The policy set is exactly `pilot_step_routing_history_admin_select`, with cmd `SELECT`, roles `authenticated`, and a qual containing `is_platform_admin`.
- `has_table_privilege` for anon is false on all 8 privileges.
- authenticated and service_role each hold SELECT only (the other 7 are false).
- The ACL has no PUBLIC entry, and there are no column ACLs.
- postgres still holds DELETE.
- Each C-3 view: anon and authenticated hold none of the 8 privileges, and service_role holds SELECT. This is not "SELECT only" (W-2): service_role is never revoked on a view, only granted SELECT idempotently.
- The D-1 predicate (W-3) still selects exactly one view.

**Never in this file:**
- `TO anon` or `TO PUBLIC`; `USING (true)` or `WITH CHECK (true)`; `FORCE`; any revoke from `postgres`.
- `IF EXISTS` or `CASCADE` on the drops; `profiles`.
- The words SECURITY DEFINER; the token `pilot_cost_savings_summary`.

---

## Rollback (C-7)

**File:** `supabase/SQL Scripts/20261055_pilot_step_routing_history_rls_lockdown_rollback.sql`

It does exactly what C-7 requires. Under W-2 that is two statements, because service_role is never revoked on the views and so nothing on them needs restoring.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ guard (W-6): the admin policy exists, the owner is postgres, and no other policy exists on the table, else nothing was restored $$;
DROP POLICY pilot_step_routing_history_admin_select ON public.pilot_step_routing_history;
GRANT <Q3 service_role privileges> ON TABLE public.pilot_step_routing_history TO service_role;
DO $$ post-assert (W-6): no policy left, so authenticated has no row path; RLS still on; anon holds nothing $$;
COMMIT;
```

- The rollback contains **no view statements at all** (W-2), and names no view.
- It never creates a policy, never grants to anon, authenticated or PUBLIC, and never disables RLS.
- It does not name `pilot_cost_savings_summary`.
- **Effect after rollback:** anon and non-admins get nothing, because RLS is on and no policy exists. The table-level SELECT left on authenticated grants no rows. service_role reads everything, because BYPASSRLS skips the policies. Admins lose the table, and they lose the invoker view once slice 2 is in. That is accepted: rollback must never reopen the exposure.

---

## Post-apply checker and anon probe (C-5)

**File:** `scripts/check-pilot-step-routing-history-rls-migration.sql`

The checker is read-only, one grid, `check_name / result / detail`, modelled on `check-purchase-path-tables-grants-migration.sql`. The VERDICT row comes first. Results are `PASS`, `FAIL` or `INFO`. The VERDICT is FAIL if any row is FAIL, and INFO rows never count.

| Check | Assertion |
|---|---|
| C1 | The table exists, relkind `r` |
| C2 / C3 | RLS on / `relforcerowsecurity = false` |
| C4 | Owner is `postgres` (unchanged) |
| C5 | Policy count is 1 |
| C6 | The one policy is `pilot_step_routing_history_admin_select`, PERMISSIVE, cmd SELECT, roles `authenticated` (via `= ARRAY['authenticated']::name[]`), qual contains `is_platform_admin`, `with_check` is null |
| C7 | anon: `has_table_privilege` false on each of SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN (8 rows) |
| C8 | authenticated: SELECT true, the other 7 false |
| C9 | service_role: SELECT true, the other 7 false |
| C10 | No PUBLIC entry in the table ACL |
| C11 | Zero column grants on the table, for any role |
| C12 | postgres holds DELETE (V-1 / C-9) |
| C13 | Per captured C-3 view: anon and authenticated hold none of the 8 privileges, and service_role holds SELECT. This is not "SELECT only" (W-2). |
| C14 | The dependent-view name set, minus the D-1 exclusion, equals the captured set. The exclusion uses the W-3 predicate, the same text as the migration: exactly one depth-1 dependent view whose own rewrite rule depends directly on `ai_model_pricing`. |
| C15 | `operator_test_account_cleanup` is owned by postgres, and `prosecdef` is true |
| C16 | PASS/FAIL (W-3): the view excluded by the W-3 predicate is `pilot_cost_savings_summary`. The checker may name it. |
| INFO | The slice-2 view: exists or not, `security_invoker` from `reloptions`, and whether anon or authenticated holds SELECT. The checker is correct in either apply order, so this row is INFO and never PASS/FAIL. |

The checker may name `pilot_cost_savings_summary`, because C-6 restricts the migration only. The Jest guard forbids the name only in the migration and the rollback.

### Anon HEAD probe (read-only, AC-2)

This needs only the public anon key and the project URL. It sends HEAD only, so no row data is fetched and nothing is written. It can be run by the user or by an agent.

```bash
curl -sI "$SUPABASE_URL/rest/v1/pilot_step_routing_history?select=*&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Prefer: count=exact"
```

- **Before:** `206` with `content-range: 0-0/21`.
- **Expected after (W-4):** `401` or `403` with a permission error, and **no `content-range` total at all**. PostgREST versions differ on how they map 42501 for anon. A `200` or `206`, even with `*/0`, is a **FAIL** for the table, because it means a grant is still there.
- Run the same probe for each C-3 view. Same expectation.
- After slice 2 lands, run it for `pilot_cost_savings_summary` too. Same expectation (AC-8).

AC-3 (non-admin sees 0 rows) is proven by C6 plus C8 in the catalog: SELECT is granted, the only policy is admin-gated, and RLS is on. It is **never** proven by a write. A read-only role simulation (D-2) was declined by SA and is not written.

---

## Jest guard (C-8)

**File:** `supabase/migrations/__tests__/pilot-step-routing-history-rls.migration.test.ts`

The guard is modelled on `purchase-path-tables-client-grants.migration.test.ts`. It uses pure `fs` reads, no DB and no network, and runs in milliseconds. It covers the migration, rollback, precheck and checker.

**Pickup:** `jest.config.js` `testMatch` includes `**/__tests__/**/*.ts?(x)`, and `supabase/migrations/__tests__/` is already collected by `npm test`. The `Gate tests (jest)` shards in `.github/workflows/tests.yml` run it with no change. On a PR from this branch, `jest-gate-scope.sh` runs the gate, because the `scripts/*.sql` and `lib/` changes are not skippable. It is one more file in the existing shards: no new job, no `package.json` change, no added critical-path time.

| Block | Pins |
|---|---|
| Paste safety (all 4 files) | Each file exists. No `--`, no `/*`. Literals match `^[A-Za-z0-9_ ]*$`, so no dotted literal survives (W-1). Even count of single quotes (W-1). No `into` as a **substring**, `/into/i` (W-1, as in the 4a test). No `SECURITY DEFINER`. No single-letter alias. No `PENDING_STEP_1` left. |
| Read-only scripts | The first statement of the precheck and of the checker is `SET default_transaction_read_only = on`. The precheck contains `run the migration in a NEW tab`. Neither script has a write keyword outside a literal. |
| Migration statement list | The statement list is tokenised with a small dollar-quote-aware splitter, because the DO bodies hold semicolons. Exactly one `BEGIN` and one `COMMIT` at top level. `SET LOCAL lock_timeout` is second. Exactly two top-level DO blocks: the first before any DDL, the last before COMMIT. The ordered DDL list equals the expected array, built from the captured view names. |
| Migration forbids | `\bTO\s+anon\b`, `\bTO\s+PUBLIC\b`, `USING\s*\(\s*true\s*\)`, `WITH CHECK\s*\(\s*true\s*\)`, `\bFORCE\b`, `FROM\s+postgres`, `IF EXISTS` / `CASCADE` on DROP POLICY, `profiles`, `SECURITY DEFINER`, the token `pilot_cost_savings_summary`. The service_role GRANT on the table is exactly `GRANT SELECT ... TO service_role`. The admin policy text contains `(SELECT public.is_platform_admin())`. Each REVOKE / GRANT names exactly one object and one role (20261017 style). No `REVOKE ... FROM service_role` on any view (W-2). |
| Guard content | The pre-guard checks the owner, FORCE, `ARRAY['public']::name[]`, both policy names, and the captured view array. The post-assert checks anon, authenticated, service_role and postgres DELETE. Both pin the W-3 predicate text: a direct `pg_depend` from the view's own `pg_rewrite` rule to `ai_model_pricing`, resolved by `pg_class` join `pg_namespace`, depth 1, exactly one. Every RAISE message ends with `nothing was applied`. |
| Rollback pins (C-7, W-2, W-6) | Exactly one DROP POLICY, for the admin policy. Exactly one GRANT, to `service_role` on the table, matching the captured Q3 set. No view name at all. The pre-guard refuses on any policy other than the admin one. The post-assert checks that no policy remains and that RLS is on. No `CREATE POLICY`, no `TO anon`, no `TO authenticated`, no `TO PUBLIC`, no `DISABLE ROW LEVEL SECURITY`, no `true` policy, no `pilot_cost_savings_summary`. |
| Checker | The VERDICT row is first, and FAIL fires on any `result = 'FAIL'` (INFO excluded). All 8 privileges appear, including MAINTAIN, for anon, authenticated and service_role. C12 (postgres DELETE) and C3 (force off) are present. The slice-2 view row is INFO only. C13 asserts service_role SELECT on the views, not "SELECT only" (W-2). C14 uses the same W-3 predicate text as the migration. C16 pins the excluded view name. |
| Mutation self-tests (AC-9) | The assertions are written as pure functions (`migrationViolations(sql): string[]`, `rollbackViolations(sql): string[]`). Tests prove that the real files give `[]`. They also inject (a) `GRANT SELECT ON TABLE public.pilot_step_routing_history TO anon;`, (b) `CREATE POLICY x ON public.pilot_step_routing_history FOR SELECT USING (true);`, (c) a service_role `GRANT SELECT, DELETE`, and (d) a rollback `GRANT SELECT ... TO authenticated`, and each must give a non-empty result. |

### How QA runs it (this worktree has no `node_modules`; never `npm install` here)

- **Primary:** CI runs it on the PR in the `Gate tests (jest)` shards. That is authoritative.
- **Local option A (try first, nothing created).** From this worktree, run the main checkout's Jest binary:

  ```bash
  node "C:/Users/Barak/My Projects/AgentsPilot/neuronforge/node_modules/jest/bin/jest.js" --rootDir . supabase/migrations/__tests__/pilot-step-routing-history-rls.migration.test.ts lib/business-os/purge
  ```

  Run it with `NODE_PATH` set to the main checkout's `node_modules`, so `ts-jest` and the setup file resolve. If the preset fails to resolve, use B.
- **Local option B (scratch export).** Copy into the session scratchpad: `jest.config.js`, `tsconfig.json`, `tests/plugins/jest-setup.ts`, `__mocks__/`, the four SQL files, the test file, and `lib/business-os/purge/` (keeping the repo-relative paths). Add a `node_modules` junction to the main checkout's (`cmd /c mklink /J`) and run Jest there. **Remove the junction with `cmd /c rmdir` before deleting the scratch dir.** Never use `git worktree remove --force` while a junction exists, because it wipes the shared `node_modules` (memory: shared-node-modules junction hazard).
- Never `git stash`.

---

## FR-9 purge descriptor note

**File:** `lib/business-os/purge/descriptors.ts` (line 469). Only the third-argument string changes. `never(...)`, the table name and `U` stay as they are.

Proposed text:

`'Agent platform. The public WITH CHECK (true) policies were removed by migration 20261055 (server-only plus an admin SELECT policy). execution_insights still carries its N17 policy, tracked separately.'`

`classification-baseline.json` maps only to `"never"`, and no test pins the note text (SA V-6). Line 473 (`execution_insights`) is left unchanged.

---

## Order independence with price review slice 2 (20261052)

| Order | What happens | Gap? |
|---|---|---|
| **Ours first** | The old `pilot_cost_savings_summary` is a postgres-owned definer view. Because postgres owns the table, RLS is not forced, and no REVOKE touches postgres (C-1), the view keeps working for every caller that can reach it. Anon can reach it until slice 2 lands: this is the RF-1 residual, 0 rows today. Our guard excludes that view from the C-3 name set without naming it (D-1), so slice 2's later drop and recreate cannot affect a re-run of our checker. | None |
| **Slice 2 first** | The invoker view reads the base table as the caller. The table still has the `public` / `true` policies and default grants, so admins see rows. Our migration then swaps in the admin policy and admins keep seeing rows. service_role keeps SELECT (R-2), so its invoker read works. | None |
| **Either guard vs the other** | Slice 2's guard inspects only the view and `ai_model_pricing` (SA V-5). Our guard inspects only this table, its policies, and the names of the other dependent views. Neither can make the other refuse. | None, while C-6 holds |

The checker's INFO row reports the slice-2 view state, so the checker reads correctly in either order. If slice 2's guard ever starts inspecting base-table state, SA re-reviews (C-6).

---

## Production apply order

1. **User:** run the Step 1 precheck on prod (read-only) and paste the grid back.
2. **Dev:** fill Appendix A. Replace every `PENDING_STEP_1` in the migration, rollback, checker and Jest guard. Make the Jest guard green.
3. **TL to BA:** record the Step 1 results in the requirement (AC-1), after BA's current amendment lands.
4. **SA** reviews the code. **QA** tests. **The user sees the diff.** Nothing is committed before that.
5. **RM** commits and opens the PR. CI goes green, including `Gate tests (jest)`. RM confirms `20261055` is still free.
6. **User (prod, Supabase SQL editor):**
   1. Re-run the precheck if more than a day has passed or anything touched the table. The guard refuses on drift either way.
   2. **Gate (D-3, SA):** do not start until the requirement records the Step 1 grid (AC-1 says "before apply"). Then run the migration in a **new** tab.
   3. Run the checker in a new tab and expect `VERDICT PASS`.
   4. Run the anon HEAD probes and expect `401` or `403` with no `content-range` total (W-4).
   5. Run `scripts/test-account-cleanup-check.sql` and confirm the table is reported present with `user_id` OK (C-9).
7. **Record** the apply and acceptance results in a docs follow-up, like `5dcaf559` for slice 4a.
8. **After slice 2 is applied** (whenever that is): re-run our checker and expect the INFO row to show `security_invoker` true **and** C14 / C16 still PASS, which proves D-1 survived the recreate on prod. Then run the anon probe on `pilot_cost_savings_summary` (AC-8).

**Rollback, only if needed:** paste the rollback in a new tab, then re-run the checker. It is expected to FAIL on C5/C6 (no policy) and possibly C9 (service_role has its old set). The anon rows (C7) and the view rows (C13) must still PASS.

---

## Test plan

| # | What | How | Owner |
|---|---|---|---|
| T-a | Jest guard green on the real files | Option A/B above, then CI | Dev, QA |
| T-b | Mutation self-tests fail on an injected anon grant, `true` policy, wider service_role grant, and rollback authenticated grant | Inside the guard (AC-9) | Dev |
| T-c | The purge suite still passes (comment-only change) | `lib/business-os/purge/__tests__` via the same runner | QA |
| T-d | The slice 6 SECURITY DEFINER surface guard still passes (no DEFINER words in the DO bodies) | `supabase/__tests__/security-definer-surface.guard.test.ts` | QA |
| T-e | Paste dry-read | QA reads each SQL file as pasted text: no comments, no "into", literal charset | QA |
| T-f | Post-apply catalog | Checker VERDICT PASS (AC-6, AC-3 via C6+C8, AC-5 via C9, AC-7 via C12/C15) | User, then QA records |
| T-g | Anon read closed | HEAD probe: 401 or 403, no `content-range` total (AC-2, W-4), on the table plus the C-3 views | User or agent |
| T-h | Admin sees rows | The user, signed in as an admin, opens any surface that reads the table via the authenticated client. None exists today, so the proof is catalog C6 + C8 + `is_platform_admin` EXECUTE (V-4). After slice 2: the admin pilot cost-savings view shows rows. | User |
| T-i | Cleanup still complete | `scripts/test-account-cleanup-check.sql` (C-9). No prod writes. | User |

**Failure path covered:** the guard refusal. Any placeholder or drift raises "nothing was applied". This is pinned by Jest, and on prod the transaction aborts as a whole.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | Policy defs on prod differ from the 2026-09-15 schema dump (F-3) | Step 1 captures them verbatim, and the guard pins the capture (C-2) |
| RK-2 | The dependent-view walk finds a view that a hidden consumer reads with the anon or authenticated key | Repo search shows no app reader (R-3). Q8 lists the functions. If the Q7 set holds a surprise, Dev stops and goes back to SA before writing T-2. |
| RK-3 | One of the C-3 views also reads `ai_model_pricing`, which breaks the D-1 exclusion rule | Q7 reports `reads ai_model_pricing` per view. If more than one view has it, D-1 is re-ruled before T-2. |
| RK-4 | A SECURITY DEFINER RPC callable by anon reads the table: a second anon path not closed by grants | Q8 INFO row. If found, raise a follow-up P1 (or SA folds it in). It is not silently ignored. |
| RK-5 | `relowner` is not `postgres` (for example `supabase_admin`) | The guard refuses (C-1). Back to SA. |
| RK-6 | The words SECURITY DEFINER inside a DO body trip the slice 6 guard (F-2) | Use `prosecdef`. T-d. |
| RK-7 | The SQL editor misreads "into", or rejects comments or literal characters | The paste-safety Jest block and T-e |
| RK-8 | Local Jest cannot run in this worktree (no `node_modules`) | Options A/B. CI is authoritative. No `npm install`. |
| RK-9 | Concurrent DDL lock on the table during apply | `lock_timeout = '5s'`. On timeout, nothing is applied. Retry. |
| RK-10 | A migration-number collision at merge | RM confirms `20261055` at commit (V-7) |
| RK-11 | PG version lacks MAINTAIN | Q10 reports `server_version_num`. Precedent checkers already assert MAINTAIN on this prod. |

---

## Open design points for SA

*SA ruled on all three on 2026-10-11 (see SA Review Notes):*
- *D-1 is approved, with the W-3 predicate.*
- *D-2 is declined and will not be written.*
- *D-3 is approved, with the apply gate in step 6.2.*

The text below is kept as proposed.

- **D-1: Excluding the slice-2 view without naming it (C-3 versus C-6).** The recursive walk returns `pilot_cost_savings_summary` both before and after slice 2. C-6 forbids naming it in the migration. Proposed rule for the guard and the C-3 loop: exclude every dependent view that **also depends on `public.ai_model_pricing`**, and assert that exactly one such view exists. RF-1 says that view reads `ai_model_pricing`, and slice 2 keeps that. The captured C-3 set is then pinned by name equality as usual. Q7 confirms on prod that no other dependent view reads `ai_model_pricing` (RK-3). Alternative: SA relaxes C-6 to allow the name in a single exclusion literal. Dev prefers the first option, because it keeps C-6 literal.
- **D-2 (optional): Read-only role simulation for AC-3.** In the read-only checker session, `SET LOCAL ROLE authenticated` plus `set_config('request.jwt.claims', ...)` for a non-admin uid, then `count(*)`. It writes nothing, but it is more than catalog-only. The default is **not** to include it, so C-5 is met with catalog plus the HEAD probe. SA may opt in.
- **D-3: Recording AC-1.** The requirement is being amended by BA right now, so Dev does not edit it. The plan is that TL routes the Step 1 results to BA, and Appendix A holds the copy. SA to confirm this satisfies AC-1.

---

## Task List

- ✅ **T-0** SA reviewed this workplan: approved with W-1 to W-6 (2026-10-11).
- ✅ **T-1** Wrote `scripts/precheck-pilot-step-routing-history-rls.sql` (one grid, Q1 to Q10, W-1 paste-safe, self-checked). Handed to the user. **Blocking:** the user runs it on prod and pastes the grid back.
- ✅ **T-1b** Filled Appendix A from the grid. W-5 was not triggered. The third policy went to SA, who ruled S-1. **The W-5 stop rule is binding.** Go back to SA before T-2 if any of these is true:
  - the owner is not postgres;
  - the policies are not the captured public ones (three, per S-1);
  - Q7 shows a view that is not relkind `v` or `m`, a view not owned by postgres, or a view that is already `security_invoker`;
  - Q7 does not show exactly one depth-1 view with a direct `ai_model_pricing` dependency (RK-3);
  - Q8 shows an anon- or authenticated-callable definer function that names the table.
- ✅ **T-2** Wrote migration `20261055`: the pre-guard (3 policies pinned by md5, S-1), 3 exact-name drops, the statement list, and the post-assert.
- ✅ **T-3** Wrote the rollback: the W-6 guard, the drop of the admin policy, a service_role `arwdDxtm` re-grant on the table (S-4), and no view statements (W-2).
- ✅ **T-4** Wrote the checker: C1 to C16 plus INFO rows. The HEAD probe is documented in [Post-apply checker and anon probe](#post-apply-checker-and-anon-probe-c-5).
- ✅ **T-5** Wrote the Jest guard: `supabase/migrations/__tests__/pilot-step-routing-history-rls.migration.test.ts`, 62 tests, including 7 mutation self-tests.
- ✅ **T-6** Edited the FR-9 comment at `descriptors.ts:469`. The note string changed and nothing else did.
- ✅ **T-7** Ran Jest locally with option A (the main checkout's Jest, plus `NODE_PATH`, no junction). The new guard passed 62/62. `supabase/migrations/__tests__`, `supabase/__tests__` and `lib/business-os/purge` passed: 47 suites, 1827 tests. All four pasted SQL files pass the W-1 self-check script. `git diff --stat` was checked.
- ⬜ **T-8** Hand to TL for SA code review, then QA, then the user diff. Leave everything uncommitted.
- ⬜ **T-9** (RM, after approval) Commit and open the PR.
- ⬜ **T-10** (User) Prod apply per [Production apply order](#production-apply-order), then record the results.

---

## Appendix A: Step 1 capture

This was captured on prod by TL via the Supabase MCP, read-only, at 2026-10-11 17:50:38 UTC, on PG 170004. The full grid is in the TL scratchpad file `precheck-grid-2026-10-11.md`. SA rulings S-1 to S-5 apply to it.

| Item | Captured value |
|---|---|
| Owner / RLS / FORCE | relkind `r`, owner `postgres`, RLS **true**, force **false** |
| Table ACL (raw) | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| Table privileges per grantee | PUBLIC: none. postgres, anon, authenticated and service_role: all 8 (DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE). None are grantable. |
| service_role table privileges (for rollback, S-4) | all 8 (`arwdDxtm`) |
| Policies | **3** (S-1), all PERMISSIVE with roles `{public}`:<br>1. `Service role can access all routing history`: cmd ALL, qual `true`, check `true`, md5 of both `b326b5062b2f0e69046810717534cb09`.<br>2. `System can insert routing history`: cmd INSERT, qual null, check `true` (md5 `b326b5062b2f0e69046810717534cb09`).<br>3. `Users can read their own routing history`: cmd SELECT, qual `((auth.uid())::text = user_id)` (md5 `cb36b1a0770728f01fd9e4744dd633c9`), check null. |
| Column grants | 0 |
| Foreign keys | **0** (S-2). `user_id` is text. Nothing references this table, and it references nothing. |
| Dependent views | 4, all depth 1, relkind `v`, owner postgres, no options, ACL as the table (anon and authenticated hold `arwdDxtm`):<br>`pilot_cost_savings_summary` (reads `ai_model_pricing` directly: **true**, so it is the D-1 exclusion);<br>`pilot_routing_performance`, `pilot_step_type_analysis`, `pilot_tier_distribution` (false). These three are the C-3 set. |
| Pricing-view count (W-3) | 1. `ai_model_pricing` was found. |
| `operator_test_account_cleanup` | 1 function, owner postgres, runs as owner true, EXECUTE for postgres and service_role only |
| `is_platform_admin()` | 1. EXECUTE: authenticated true, service_role true, anon false. |
| Functions naming the table | 1. It is `operator_test_account_cleanup`, and neither anon nor authenticated can execute it. |
| Rows | total 21; with a user id 21; created after 2025-11-12: 0 |
| W-5 stop rule | **Not triggered** (TL and SA). The only deviation was the third policy, which SA ruled on in S-1. |

---

## SA Review Notes

**Reviewed by SA — 2026-10-11**
**Status:** ✅ Approved with conditions (W-1 to W-6). T-1 (the precheck) may start now. T-2 onwards waits for the Step 1 grid, as planned.

### Conformance to the requirement's conditions
| Cond. | Verdict |
|---|---|
| C-1 owner / FORCE | Met. Pre-guard (owner postgres, no FORCE), post-assert, checker C2–C4 / C12, and the Jest `FORCE` / `FROM postgres` bans. |
| C-2 guarded single transaction | Met. Exact-name DROP POLICY without `IF EXISTS` or `CASCADE`, roles compared as `name[]`, and qual/with_check pinned verbatim or by md5. One-object, one-role REVOKE/GRANT statements. |
| C-3 dependent views | Met, with W-2 (service_role on the views). |
| C-4 precheck | Met, and goes beyond it with Q8 (functions that name the table) and Q10 (PG version). Good. |
| C-5 checker | Met. VERDICT row first, INFO excluded from the verdict, slice-2 view reported as INFO. |
| C-6 no slice-2 coupling | Met by the D-1 rule (below). |
| C-7 rollback | Met, with W-2. |
| C-8 Jest guard | Met, with W-1. The pure `violations()` functions with injected mutations are the right shape for AC-9. |
| C-9 cleanup proof | Met (C12, C15, T-i). |
| C-10 text | BA's job in the requirement. Nothing for Dev. |

### Rulings on the open design points
1. **D-1: approved. Exclude by "also reads `ai_model_pricing`"; do not relax C-6.** It is correct in both orders.
   - Before slice 2, the old definer view's rewrite rule has a normal dependency on both `pilot_step_routing_history` and `ai_model_pricing`. The subquery reference counts.
   - After slice 2, the view is recreated: new OID, same name, and the same two dependencies (the recreate text is unchanged apart from the schema qualification).
   - The rule never touches an OID or a name, so the slice-2 drop and recreate cannot move it. Slice 2 holds an exclusive lock for its whole transaction, so the two can never interleave.

   Make the predicate precise (part of W-3): exactly one dependent view whose **own** `pg_rewrite` rule has a `pg_depend` row on `public.ai_model_pricing`. Direct dependency only, not inherited through the walk. The view must be at depth 1, and its name must not appear in the captured C-3 array. Any other count refuses. The checker, which may name it, adds a PASS/FAIL row that the excluded view is `pilot_cost_savings_summary`. That catches a wrong exclusion with no coupling in the migration. RK-3 handles the case where Q7 shows two such views.
2. **D-2: declined. Keep it off and do not write it.**
   - The checker session is read-only. `SET LOCAL ROLE` needs a transaction, and the `request.jwt.claims` JSON literal breaks the literal charset rule.
   - `is_platform_admin()` reads `admin_users` through `auth.uid()`, so the simulation proves the policy wiring and nothing the catalog rows C6, C8 and V-4 do not already prove.
   - AC-3 is met by catalog plus HEAD probe.
3. **D-3: approved.** Appendix A holds the copy, and TL routes it to BA. Add one gate to the production apply order: step 6.2 (run the migration) does not start until the requirement records the grid (AC-1 says "before apply").

### End-of-transaction self-verify, `make_date` and SECURITY DEFINER
- **Post-assert DO before COMMIT.** This is sound, and it follows the 20261050 precedent. `has_table_privilege` and `pg_policies` see the transaction's own uncommitted catalog changes. A RAISE aborts the transaction, so the editor's trailing `COMMIT` turns into a rollback.
  - `has_table_privilege(..., 'MAINTAIN')` errors below PG17. Q10 guards this, and the precedent checkers already assert MAINTAIN on this prod.
- **`make_date(2025, 11, 12)`.** Fine, and it keeps the literal charset. It is a `date` compared with `created_at` (timestamptz): an implicit cast at session-timezone midnight. That is only used for an INFO row count, so it is acceptable.
- **SECURITY DEFINER.** The constraint is right. `security-definer-surface.guard.test.ts` raises F-2 for those words inside any dollar body or single-quoted string. Its scan covers tracked and untracked `*.sql`, but excludes `scripts/` (header line 66). So the migration and the rollback are the files at risk. Keep the ban in all four files anyway, and use `pg_proc.prosecdef` (Q8, C15). T-d stays.

### Conditions
1. **W-1 Paste-safety pins must match the precedent, not loosen it.**
   - Ban `into` as a **substring** in any case: `/into/i`, as in `secdef-lockdown-slice4a.migration.test.ts:182`. Do not use `\binto\b`.
   - Add the even-single-quote-count check.
   - Literals stay `^[A-Za-z0-9_ ]*$`. **Watch out for dotted literals**: `to_regclass('public.x')` or `'public.ai_model_pricing'::regclass` would break this.
     - Preferred: resolve OIDs by joining `pg_class` to `pg_namespace` on `nspname = 'public'` and `relname = '...'`.
     - Otherwise: a pinned per-file `PUNCTUATED_ALLOWED` list, as in 4a.
2. **W-2 service_role on the C-3 views.** The plan grants SELECT but never revokes, and yet the rollback "restores" a wider set. Pick the simple, consistent shape:
   - Do not revoke anything from service_role on the views.
   - Keep the idempotent `GRANT SELECT ... TO service_role` per view.
   - The rollback contains **no** view statements at all.
   - The post-assert and checker C13 assert that service_role holds SELECT. They do not assert "SELECT only".
   - Jest pins: no `REVOKE ... FROM service_role` on any view, and no view name in the rollback.
3. **W-3 D-1 predicate as specified above.** It applies identically in the pre-guard, the post-assert and checker C14, plus the checker's new excluded-view-name row. Jest pins the predicate text in the migration. The checker must agree with the migration on which view is excluded.
4. **W-4 HEAD probe expectation.** Accept `401` or `403` with a permission error, and assert that there is **no** `content-range` total. PostgREST versions differ on the anon 42501 mapping. A `200`/`206` with `*/0` is a FAIL for the table: it means a grant is still there.
5. **W-5 RK-2 / RK-4 stop rule is binding.** At T-1b, stop if Q7 shows:
   - a view that is not relkind `v`/`m`,
   - a view owned by anyone other than postgres,
   - a view that is already `security_invoker`, or
   - Q8 shows an anon- or authenticated-callable definer function that reads the table.

   Any of these sends the work back to SA before T-2. Do not quietly widen scope.
6. **W-6 Rollback guard.** Besides "admin policy exists, owner postgres", the rollback pre-guard also refuses if any policy other than `pilot_step_routing_history_admin_select` exists. That way it never runs over a state it was not written for. Its post-assert also checks that authenticated has no row path (no policy) and that RLS is still on.

### Optimisation suggestions (non-blocking)
- Q7: also report `relispopulated` for any materialized view. A REVOKE on an unpopulated matview is fine, but it is worth knowing.
- Production apply step 8: say "re-run our checker and expect the INFO row to show `security_invoker` true **and** the C14 excluded-view row still PASS". That proves D-1 survived the recreate on prod.

### Approval
[x] Workplan approved with conditions W-1 to W-6. Proceed to T-1. T-2 onward follows the Step 1 capture and the W-5 stop rule.

### SA rulings on the Step 1 capture (2026-10-11, prod, PG 170004)

The grid is the TL capture of 2026-10-11 17:50 UTC. W-5 is not triggered: all 4 dependent views are relkind `v` and owned by postgres with no options, and the only function that names the table is the cleanup function, which only service_role can execute. D-1 holds as designed. Exactly one depth-1 view reads `ai_model_pricing` directly (`pilot_cost_savings_summary`), so the captured C-3 set is `pilot_routing_performance`, `pilot_step_type_analysis` and `pilot_tier_distribution`.

1. **S-1: three policies. Drop all three.** The third is `Users can read their own routing history`: PERMISSIVE, `{public}`, SELECT, qual `((auth.uid())::text = user_id)`, md5 `cb36b1a0770728f01fd9e4744dd633c9`. It is dropped as well.
   - Keeping it is Option B, which the requirement rejected. Nothing reads the table, and the target state in C-5 is exactly one policy.
   - It is also the unwrapped per-row `auth.uid()` form, and it is granted to `public` rather than `authenticated`.
   - This is a policy-set deviation from C-2, so C-2 is amended to "exactly the three captured policies". The pre-guard pins all three:
     - The count is 3.
     - Each policy has its name, `PERMISSIVE`, `ARRAY['public']::name[]` and its cmd (`ALL`, `INSERT`, `SELECT`).
     - Each is pinned by md5 of qual and with_check. `b326b5062b2f0e69046810717534cb09` is `true`. The IS NULL cases are explicit (INSERT qual null, SELECT with_check null).
   - There are three plain `DROP POLICY` statements by exact name, with no `IF EXISTS` and no `CASCADE`.
   - The rollback still recreates none of them (C-7).
   - The Jest statement list and the guard-content pins now carry three names.
   - The FR-9 note text stays as drafted, since it says the public policies were removed. Make it plural-neutral if needed.
2. **S-2: no FK, and `user_id` is text.** This corrects SA V-2 and R-2 in the requirement. They inferred an FK from the 20261047 reviewed list, and that was wrong. Q6 = 0.
   - The R-2 ruling (service_role SELECT only) still stands. The grounds are now just V-1 and V-3: the cleanup function deletes as owner postgres, and no app code deletes.
   - There are **no FK cascades to consider**. The C-4 FK capture is complete (0).
   - C-9 / AC-7 are unchanged in substance. The cleanup function is the **only** remover of these rows. The proof stays checker C12 (postgres holds DELETE) plus C15, plus `scripts/test-account-cleanup-check.sql`, which reports the table present with `user_id` OK. Drop any wording in the workplan, checker or requirement that says "cascade" or "FK" for this table.
   - Out of scope, for the follow-up list: an account delete through any path other than the cleanup function leaves orphaned rows here, because there is no FK and the column is text. This is pre-existing, and it becomes server-only after this slice.
3. **S-3: anon write is catalog-proven.**
   - anon holds `arwdDxtm` (DELETE, UPDATE, TRUNCATE included), and the `ALL` / `true` policy applies to `public`. So anon can update and delete every row through PostgREST today. Nobody wrote to prove it, and nobody needs to. TRUNCATE is not exposed by PostgREST, but the grant is revoked anyway.
   - BA updates F-4 and the §1.2 "Write risk" row from "unproven" to "catalog-proven" (via TL). Severity stays P1. The fix already covers it: every anon privilege is revoked, and the post-assert and checker C7 check all 8.
4. **S-4: rollback capture.** The service_role privileges to restore on the table are the full `arwdDxtm` (Q3). Per W-2, the rollback has no view statements.
5. **S-5: Appendix A and AC-1.** Dev fills Appendix A from the grid. TL routes the grid and S-1 to S-3 to BA for AC-1. The W-3 / D-3 gate stands: the migration is not applied before the requirement records them.

T-2 may proceed on these rulings.

---

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved, with one pre-apply action (P-1). There is no must-fix in the files.

SA ran the new guard and `supabase/__tests__/security-definer-surface.guard.test.ts` locally (main checkout's Jest, `--rootDir .`): **2 suites, 146 tests, all pass.** A grep of all four pasted files found 0 `into`, 0 `--`, 0 `/*` and 0 `SECURITY DEFINER`. The diff touches 1 line in `descriptors.ts`, and nothing else is modified.

### SQL correctness (PG 17, migration and rollback DO blocks)
| Point | Verdict |
|---|---|
| `pg_policies.roles = ARRAY['public']::name[]` | Correct. `roles` is `name[]`, and PUBLIC renders as `public`. The same holds for `ARRAY['authenticated']::name[]` in the post-assert. |
| md5 and NULL handling | Correct and fail-closed. `md5(NULL)` is NULL, so a NULL where a value is pinned makes the `EXISTS` false and raises. The NULL sides are pinned explicitly (INSERT `qual IS NULL`, SELECT `with_check IS NULL`). `b326b506...` is `md5('true')`. |
| `x := (WITH RECURSIVE ... SELECT count(*) ...)` and `ARRAY(WITH RECURSIVE ... ORDER BY ... COLLATE "C")` | Valid grammar. The identical text parsed and ran on prod inside the checker (C14 and C16 PASS pre-apply). The view's own `_RETURN` rule self-dependency is excluded by `ev_class <> view_oid`, and `depth < 10` bounds the walk. |
| `has_table_privilege(..., 'MAINTAIN')` | Valid on PG 17 (prod is 170004), for both tables and views. It is also proven by the checker's C7 on prod. |
| `has_table_privilege(...) <> (check_privilege = 'SELECT')` | Correct boolean comparison. SELECT-only is enforced for authenticated and service_role on the table, and not on the views (W-2). |
| Column ACLs after `REVOKE ALL ON TABLE` | Correct. A relation-level REVOKE leaves `attacl` NULL when the result is empty, and Q4 was 0 rows. |
| `pg_get_userbyid(...) IS DISTINCT FROM 'postgres'` | Correct (the `name` vs `unknown` comparison resolves). |
| `RAISE EXCEPTION USING MESSAGE = '...' \|\| var` | Valid. |
| Statement order | The pre-guard runs first, then the 3 exact DROPs, then ENABLE RLS (already on, a no-op), then the 4 one-role REVOKEs, then the 2 GRANTs, then CREATE POLICY, then the view revokes, then the post-assert, then COMMIT. It is one transaction, so the gap between dropping and creating policies is never visible. `lock_timeout` 5s. |
| Admin policy | `AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))`. It is wrapped for initplan, uses no `profiles`, and has no WITH CHECK. The stored qual renders as `( SELECT is_platform_admin() AS is_platform_admin)`, so the post-assert `strpos` holds. |
| C-6 | The migration and rollback never name `pilot_cost_savings_summary`. A mutation test proves the finder catches it. |

**Why an unproven DO body is acceptable.** PL/pgSQL plans each statement only when it first runs, so a body is not fully syntax-checked until it executes. Any parse or runtime error in either DO block, though, aborts the transaction, and the trailing COMMIT turns into a rollback. **The worst case is "nothing was applied" and a retry, never a partial state.** The same holds for the rollback.

### Rollback cannot reopen anything
It does exactly three things:
- It refuses unless the admin policy is the only policy and the owner is postgres (W-6).
- It drops the admin policy.
- It runs one GRANT of all 8 privileges to service_role. That matches the captured `arwdDxtm`, and `MAINTAIN` is the 8th (S-4).

It creates no policy, grants nothing to anon, authenticated or PUBLIC, has no view statement, and leaves RLS on. Its post-assert checks: 0 policies, RLS on, anon holds none of the 8, PUBLIC has no ACL entry, and service_role holds all 8. authenticated keeps table SELECT, but with RLS on and no policy it gets 0 rows. That is the intended scoped-down C-7 state.

### Deviations accepted
- Views compared as `'public <name>'` (space, not dot). This is required by W-1 and is consistent across the migration and the checker.
- Trimming the trailing space in the message test. The dynamic messages append ` || var` after "...nothing was applied ", so a trim before the ends-with check is the correct test.

### Code Review Comments
1. **P-1 (pre-apply action, not a code change) — Priority: Medium.** Prove the pre-guard on prod read-only before the real apply. Paste only the migration's first DO block, wrapped as `BEGIN; SET TRANSACTION READ ONLY; DO $$ ... $$; ROLLBACK;`, in a new tab. Expect success with no exception. On the success path every pre-guard statement executes, so this is a full parse and behaviour proof of the half that matters most. It is safe: DO with only SELECTs runs in a read-only transaction. The post-assert cannot be proven before apply, because it raises at its first check. That is acceptable for the fail-closed reason above.
2. `migration:249` — Low. The post-assert does not re-check the owner. The migration has no `ALTER ... OWNER`, so this is not needed. No action.
3. `rollback:31-38` — Low. The rollback guard matches the admin policy by name only. The count = 1 check plus the name is enough for a rollback. No action.

### Optimisation Suggestions
- None blocking. `descriptors.ts:469` reads correctly. The `classification-baseline.json` value (`never`) is unchanged, and the file still has 0 `console.*` calls and no entitlements import.

### Code Approved for QA: Yes
After QA and the user's diff review, the apply order is: P-1 (pre-guard dry run, read-only), then the migration in a new tab, then the checker (expect `VERDICT PASS`), then the anon HEAD probes (W-4), then `test-account-cleanup-check.sql`. AC-1 is recorded in the requirement and OQ-3 is ruled by S-1, so the apply gate is met.

## QA Testing Report

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A (Jest source guard plus neighbouring suites), C (a mutation harness run on scratch copies), and a desk-check of the SQL against the captured prod state. B and D do not apply: there is no branch DB, QA has no DB access, and there is no UI. The prod evidence used is read-only and was captured by TL.
**Focus:** security, schema
**Skipped:** the live DB apply and the post-apply probes. Those are user-run on prod and are listed below as owed.
**Input source:** TL prompt plus this workplan's Test plan (T-a to T-i)

### Evidence used
| Source | What it shows |
|---|---|
| TL precheck grid, prod, 2026-10-11 17:50:38 UTC, PG 170004 (scratchpad `precheck-grid-2026-10-11.md`) | The Appendix A values |
| TL pre-apply checker run, 2026-10-11 18:08:10 UTC (scratchpad `checker-preapply-2026-10-11.md`) | `VERDICT FAIL`, 16 pass, 27 fail, 2 info. The checker parses on PG 17. The 27 FAILs are exactly the pre-apply state: C5, C6, C7 x8, C8 x7, C9 x7 and C13 client x3. QA recounted 43 PASS/FAIL rows plus 2 INFO, which matches. C12, C14 x2, C15 and C16 already PASS. |
| TL P-1 dry run, prod (scratchpad `p1-dryrun-2026-10-11.md`) | The migration's first DO block (the pre-guard) ran inside `BEGIN TRANSACTION READ ONLY ... ROLLBACK` with no exception. Every pre-guard check passed on the success path on PG 17. |

### 1. Jest runs
Each run used the main checkout's Jest (`node <main>/node_modules/jest/bin/jest.js --rootDir .`) with `NODE_PATH` set to the main checkout's `node_modules`. No junction was used and nothing was installed. Exit codes are Jest's own, not piped.

| Run | Exit | Result |
|---|---|---|
| `supabase/migrations/__tests__/pilot-step-routing-history-rls.migration.test.ts` | 0 | 1 suite, **62/62** pass, including 7 built-in mutation self-tests |
| `supabase/migrations/__tests__` + `supabase/__tests__` + `lib/business-os/purge` | 0 | **47 suites, 1827/1827** pass. This includes `security-definer-surface.guard.test.ts` (T-d) and the purge suites (`descriptors.invariant`, classification baseline) for T-c. |

### 2. Mutation testing (QA's own harness, scratch copies only)
The harness copied the guard, the four SQL files and the Jest support files into the session scratchpad, applied one mutation per copy, and ran the guard there. The real files were never edited.

| # | Mutation | Exit | Caught by |
|---|---|---|---|
| — | Baseline (no mutation) | 0 | 62/62 pass, which proves the harness itself is sound |
| M1 | `GRANT SELECT ... TO anon;` added to the migration | 1 | 7 tests (statement list, violations, post-assert shape) |
| M1b | Same grant, but `TO "anon"` (quoted, which slips past the regex) | 1 | 8 tests (statement list and one-role checks) |
| M1c | `EXECUTE 'GRANT ... TO anon'` hidden inside the post-assert DO | 1 | `has no violation` (the `TO anon` regex scans DO bodies) |
| M2 | `CREATE POLICY ... USING (true)` added | 1 | 7 tests |
| M2b | Admin policy rewritten as `TO public USING ( true )` | 1 | 2 tests |
| M3 / M3b / M3c | One REVOKE removed: table anon, view authenticated, table PUBLIC | 1 each | `holds exactly the expected DDL, in order` |
| M4 / M4b | `into` in a migration literal; `INTO` in a checker literal | 1 each | The `into` substring ban (plus the "nothing was applied" message test for M4) |
| M5 / M5b / M5c | `--` comment in the migration and in the precheck; `/* */` in the rollback | 1 each | The comment ban (plus statement-shape tests) |
| M6 | `REVOKE ... public.pilot_cost_savings_summary FROM anon` in the migration | 1 | 7 tests |
| M6b | `pilot_cost_savings_summary` only inside a pre-guard literal | 1 | `has no violation` (C-6 token ban) |
| X1 | `FORCE ROW LEVEL SECURITY` added | 1 | 7 tests |
| X2 / X3 | Rollback grants SELECT to PUBLIC / to anon | 1 each | 3 tests each |
| X4 | Rollback recreates `Users can read their own routing history` | 1 | 3 tests |
| X5 | Rollback `DISABLE ROW LEVEL SECURITY` | 1 | 3 tests |
| X6 | Wrong md5 pin on the owner-read policy | 1 | The S-1 pin test |
| X7 | Post-assert DO removed | 1 | 6 tests |
| X8 | Checker VERDICT no longer fires on FAIL | 1 | The VERDICT test |
| X9 | Precheck loses its read-only `SET` line | 1 | The read-only test |
| X10 | Table `GRANT ALL ... TO service_role` | 1 | 4 tests |

All 25 mutations make the guard fail, so it has no blind spot among the cases tried.

### 3. Desk check (PG 17 syntax and logic)
| Point | Result |
|---|---|
| Statement order | Pass. `BEGIN` → `SET LOCAL lock_timeout '5s'` → pre-guard DO → 3 exact-name `DROP POLICY` (no `IF EXISTS`, no `CASCADE`) → `ENABLE RLS` (no FORCE) → 4 one-role REVOKEs (PUBLIC, anon, authenticated, service_role; never postgres) → `GRANT SELECT` to authenticated and to service_role → `CREATE POLICY ... FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))` → 3 views × (3 REVOKEs + `GRANT SELECT` to service_role) → post-assert DO → `COMMIT`. This matches the workplan sketch and the Jest `EXPECTED_MIGRATION_DDL`. |
| Pre-guard pins vs the captured grid | Pass, exact. Owner `postgres`, force false, policy count 3. For all three policies: name, PERMISSIVE and `ARRAY['public']::name[]` are pinned. Cmds are ALL / INSERT / SELECT. QA recomputed both md5 values: `md5('true') = b326b5062b2f0e69046810717534cb09` and `md5('((auth.uid())::text = user_id)') = cb36b1a0770728f01fd9e4744dd633c9`. Both match grid rows 501 to 503. The NULLs are pinned explicitly (INSERT qual, SELECT with_check). The view set `public pilot_routing_performance / pilot_step_type_analysis / pilot_tier_distribution` (C collation order) matches grid rows 702 to 704. Exactly one depth-1 view reads pricing, which matches row 790. `is_platform_admin()` is checked with `pronargs = 0` and authenticated EXECUTE, which matches row 821. The P-1 dry run proves all of this on prod. |
| Post-assert vs the checker | Pass. Same assertions: RLS on and not forced (C2/C3); 1 policy (C5); the admin policy's shape (C6, same predicate text); all 8 privileges for anon (none) and for authenticated and service_role (SELECT only) (C7 to C9); no PUBLIC ACL entry (C10); no `attacl` (C11); postgres DELETE (C12); per view, no anon or authenticated privilege and service_role SELECT (C13); the W-3 count and name set (C14). The W-3 predicate text is identical across the guard, the post-assert and the checker (pinned by Jest). C4 (owner), C15 (cleanup function) and C16 (excluded view name) are checker-only, which is acceptable per SA comment 2. |
| Rollback safety (C-7, AC-10) | Pass. The guard refuses unless the admin policy is the only policy and the owner is postgres. It has exactly 2 DDL statements: `DROP POLICY pilot_step_routing_history_admin_select` and one `GRANT` of the 8 captured privileges (grid row 351, `arwdDxtm`) to service_role. It has no CREATE POLICY, no `true`, no grant to anon, authenticated or PUBLIC, no view name, no REVOKE and no DISABLE RLS. The post-assert checks 0 policies, RLS on, anon holds none of the 8, no PUBLIC entry, and service_role holds all 8. After a rollback, authenticated keeps table SELECT but gets 0 rows (RLS on, no policy). That is the intended state. |
| Paste safety | Pass. Covered by the Jest pins and by M4/M5: no `--` or `/*`, no `into` in any case, literal charset `[A-Za-z0-9_ ]`, even quote count, no SECURITY DEFINER words, and no single-letter aliases. |
| FR-9 (`descriptors.ts`) | Pass. `git diff` shows exactly one line, the note string. `never(...)`, the table and `U` are unchanged. The purge suites are green. |

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-1 Precheck recorded before apply | ✅ | Pass | Requirement §1.1.1 and FR-10 table, checked against the TL grid |
| AC-2 Anon HEAD returns no `/21` | ⚠️ | Pending (user, post-apply) | Static: the post-assert and checker C7 require anon to hold none of the 8 privileges. **Owed:** HEAD probe, expect 401/403 with no `content-range` total (W-4) |
| AC-3 Non-admin sees 0 rows | ⚠️ | Pending (user, post-apply) | Proven by catalog only (C5 + C6 + C8; the only policy is admin-gated). **Owed:** checker `VERDICT PASS` |
| AC-4 Admin sees all rows | ⚠️ | Pending (user, post-apply) | No surface reads the table today, so the proof is catalog C6 + C8 + P-9 (`is_platform_admin` executable by authenticated). The functional check comes with AC-8 after slice 2. |
| AC-5 Service role sees all rows | ⚠️ | Pending (user, post-apply) | C9 (SELECT kept) plus BYPASSRLS. **Owed:** checker. Optionally, the service-key HEAD probe should still return `/21`. |
| AC-6 Post-apply checker assertions | ⚠️ | Pending (user, post-apply) | The checker is desk-checked and proven to parse and evaluate on prod (pre-apply run, expected FAILs only). **Owed:** `VERDICT PASS` after apply |
| AC-7 Cleanup still works (C-9) | ⚠️ | Partial | C12 and C15 already PASS on prod pre-apply. Nothing in the migration touches the owner or postgres. **Owed:** re-run the checker plus `scripts/test-account-cleanup-check.sql` after apply |
| AC-8 Slice-2 view after slice 2 | ⬜ | Pending (after slice 2) | Workplan apply-order step 8 |
| AC-9 Jest guard plus mutation self-tests | ✅ | Pass | 62/62. The built-in and QA mutations all fail as required |
| AC-10 Rollback cannot reopen | ✅ | Pass (static) | Desk check plus Jest pins plus QA mutations X2 to X5 |
| AC-11 Dependent views closed | ⚠️ | Pending (user, post-apply) | Static: the migration statement list plus post-assert / C13. The pre-apply C13 service_role row already PASSes. **Owed:** checker C13 plus anon HEAD probes on the 3 views |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The guard runs in about 4.5 s locally (one more file in the existing shards). No CI time is added.

#### Edge Cases (nice to fix)
1. **Checker C15 errors on more than one overload instead of reporting FAIL.** `(SELECT cleanup_function.owner_name = 'postgres' AND cleanup_function.runs_as_owner FROM cleanup_function)` is a scalar subquery. If a second `operator_test_account_cleanup` overload ever exists, the whole checker raises "more than one row returned" instead of printing a FAIL row. Today there is exactly one (P-8). File: `scripts/check-pilot-step-routing-history-rls-migration.sql:258`. Severity: Low.
2. **The `migrationViolations()` finder does not report a missing statement.** Removing a REVOKE (M3) is caught only by the ordered `toEqual` test, not by the pure finder. The suite still fails, so this is not a gap. It only matters if someone later deletes the ordered test. File: the Jest guard, line 117. Severity: Low, informational.

### Test Outputs / Logs
```text
pilot-step-routing-history-rls.migration.test.ts   EXIT=0  Tests: 62 passed, 62 total
migrations/__tests__ + supabase/__tests__ + purge   EXIT=0  Test Suites: 47 passed, 47 total  Tests: 1827 passed, 1827 total
mutation harness: baseline exit=0 (62/62); all 25 mutations exit=1
```

### Final Status
- [x] All statically testable acceptance criteria pass (AC-1, AC-9, AC-10) and there are no open bugs. **Ready for the user's diff review and commit.**
- [ ] Post-apply verification is owed by the user on prod, in the order in [Production apply order](#production-apply-order): checker `VERDICT PASS` (AC-3, AC-5, AC-6, AC-7, AC-11), anon HEAD probes on the table and the 3 views (AC-2, AC-11), `test-account-cleanup-check.sql` (AC-7), and AC-8 after slice 2.

## Commit Info

*RM to populate.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | Dev workplan against SA conditions C-1 to C-10. Planning only. No code until the Step 1 precheck returns. Open design points D-1 to D-3 for SA. |
| 2026-10-11 | SA conditions applied, T-1 done | W-1: paste-safety pins (substring `into`, even quote count, no dotted literals, lookups via `pg_class` join `pg_namespace`). W-2: no service_role revoke on views, rollback has no view statements, C13 asserts SELECT not "SELECT only". W-3: precise D-1 predicate in guard, post-assert and C14, plus new checker C16. W-4: HEAD probe accepts 401/403 with no `content-range` total. W-5: binding T-1b stop rule. W-6: rollback guard refuses on extra policies and post-asserts no policy and RLS on. D-2 declined; D-3 apply gate added at step 6.2; `relispopulated` added to Q7; step 8 wording. Precheck script written. |
| 2026-10-11 | SA workplan review | Approved with conditions W-1 to W-6. D-1: exclusion by direct `ai_model_pricing` dependency approved; correct in both orders. D-2 declined. D-3 approved, with an AC-1 gate before the migration apply. |
| 2026-10-11 | SA rulings on the Step 1 capture | S-1: drop all three policies, including `Users can read their own routing history`; the guard pins all three by md5 (C-2 amended). S-2: no FK and `user_id` is text; SA V-2 corrected, the cleanup function is the only remover, R-2 stands. S-3: anon write is catalog-proven, so BA updates F-4. S-4: the rollback restores service_role `arwdDxtm`. T-2 may proceed. |
| 2026-10-11 | SA code review | Code approved for QA. No must-fix. SQL checked for PG 17 (`name[]` roles, md5 NULL handling, recursive CTE, MAINTAIN, statement order, admin policy). The rollback cannot reopen anything. SA ran 2 suites, 146 tests, all pass. Pre-apply action P-1: a read-only dry run of the pre-guard on prod. |
| 2026-10-11 | T-1b to T-7 done | Appendix A filled from the TL grid. Wrote migration 20261055, the rollback, the checker, and the Jest guard (62 tests, 7 mutation self-tests). FR-9 note edited. Local Jest via the main checkout's binary: 47 suites and 1827 tests green. The W-1 self-check passes on all four pasted SQL files. Nothing committed. |
| 2026-10-11 | QA report | PASS, no bugs. Guard 62/62 (exit 0). Neighbouring suites 47/1827 (exit 0). All 25 QA mutations fail the guard, as they must. Desk-checked the pre-guard pins against the grid (md5 values recomputed), the post-assert against the checker, and the rollback safety. P-1 dry run and pre-apply checker evidence recorded. AC-1, AC-9 and AC-10 pass. AC-2 to AC-7 and AC-11 await the user's post-apply checks; AC-8 waits for slice 2. 2 low edge cases noted. |
| 2026-10-11 | Renumbered to 20261055; applied to prod | Merging main brought in PR #304 (price review slice 2), which holds 20261052 and 20261053, and an open branch `fix/exposed-views-slice-1a` claims 20261054, so this migration and its rollback were renamed to 20261055 (all references updated; the content is unchanged). The renamed files were committed to PR #305. The migration was applied to prod by TL on 2026-10-11 with the user's approval, through the Supabase MCP: it committed cleanly, so both guards passed. Catalog after apply: RLS on, one policy (pilot_step_routing_history_admin_select, authenticated, SELECT, is_platform_admin), table ACL postgres=arwdDxtm, authenticated=r, service_role=r. The three views keep only postgres and service_role. The 21 rows are intact. Anon HEAD probes return 401 with no content-range on the table, the three views and pilot_cost_savings_summary (before the fix: 206, 0-0/21). AC-2, AC-3, AC-5, AC-6 and AC-11 are met; AC-8 also holds because slice 2 is already applied. |
