# Requirement: Lock down `pilot_step_routing_history` (anon cross-tenant exposure)

> **Last Updated**: 2026-10-11

**Created by:** BA
**Date:** 2026-10-11
**Status:** Approved (SA, with conditions applied)
**Branch:** `fix/pilot-routing-history-rls` (off `origin/main` @ `7916cc68`)

## Overview

Anyone holding only the public Supabase anon key can read every row of `public.pilot_step_routing_history`. That key ships in the browser bundle, so this means anyone at all. The table is legacy AgentsPilot per-step routing telemetry, and no app code reads or writes it today. This requirement closes the exposure. The table becomes server-only, with an admin-only read path so that the hardened `pilot_cost_savings_summary` view (price review slice 2) keeps working for admins. The views that read this table (`pilot_tier_distribution`, `pilot_step_type_analysis` and `pilot_routing_performance`, confirmed by the 2026-10-11 precheck as the complete set besides the slice-2 view) lose all grants for PUBLIC, anon and authenticated, so they can no longer serve its data to strangers. `pilot_cost_savings_summary` is excluded because slice 2 owns it. Those views are revoke-only here: none is redefined or dropped. It is a single small slice. It is not an epic.

---

## 1. Security Finding

### 1.1 Measured facts (prod, read-only, 2026-10-10/11)

| # | Fact | Source |
|---|---|---|
| F-1 | A signed-out caller using only the anon key sent `HEAD /rest/v1/pilot_step_routing_history?select=*&limit=1` with `Prefer: count=exact` and got **206 with `content-range 0-0/21`**. Service role sees the same 21 rows, so anon sees **every** row and nothing is scoped to a user. No row data was fetched. | Live probe |
| F-2 | Live columns: `id, agent_id, user_id, execution_id, step_index, step_name, step_type, agent_ais, step_complexity, effective_complexity, routing_strategy, selected_tier, selected_model, selected_provider, routing_source, tokens_used, execution_time_ms, success, estimated_cost_usd, complexity_factors (jsonb), created_at`. | PostgREST OpenAPI (service role), 2026-10-11. `docs/PILOT_PER_STEP_ROUTING_IMPLEMENTATION.md` shows an older shape. The live DB is authoritative. |
| F-3 | Policies `Service role can access all routing history` and `System can insert routing history` are both granted to role **`public`** with `true` conditions. The first name claims service-role scope, but its role list is public. **Superseded by the precheck (§1.1.1):** there are **three** policies, not two. | `docs/workplans/business-os-business-data-purge-schema-dump.md` §9.6 (measured 2026-09-15) |
| F-4 | **Catalog-proven by the precheck (§1.1.1), SA ruling S-3:** RLS is on (not forced), and anon holds every table privilege including DELETE, UPDATE and TRUNCATE. Combined with the public `ALL` / `true` policy, anon can update and delete every row. It was **not** tested by writing, and must never be. | FR-1 precheck, 2026-10-11 17:50 UTC |
| F-5 | No code in `lib/`, `app/` or `components/` reads or writes the table. Its writers and readers were removed in commit `a90a7f79` (2025-11-12). Only two references remain. One is the purge descriptor `never(...)` at `lib/business-os/purge/descriptors.ts:469`, whose N17 note covers these exact policies. The other is `operator_test_account_cleanup` (SECURITY DEFINER, migration `20261047`), which deletes rows by `user_id`. | Code search |

### 1.1.1 Measured state (precheck, 2026-10-11 17:50 UTC)

Run by TL on prod via a single read-only SELECT (the body of `scripts/precheck-pilot-step-routing-history-rls.sql` without its SET line), checked at 2026-10-11 17:50:38 UTC, PostgreSQL 17 (`170004`). This satisfies AC-1 and gates apply step 6.2.

| # | Item | Measured |
|---|---|---|
| P-1 | Table | `relkind r`, owner `postgres`. RLS **enabled** (`relrowsecurity = true`), **not forced** (`relforcerowsecurity = false`). |
| P-2 | Table ACL (raw) | `{postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}` |
| P-3 | Table grants per grantee | PUBLIC: none. `postgres`, `anon`, `authenticated`, `service_role`: **all** of DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE. |
| P-4 | Column grants | None (0 rows). |
| P-5 | Policies (3, verbatim) | 1. `Service role can access all routing history`: PERMISSIVE, roles `{public}`, cmd `ALL`, qual `true`, with_check `true` (md5 `b326b5062b2f0e69046810717534cb09` for both). |
| | | 2. `System can insert routing history`: PERMISSIVE, roles `{public}`, cmd `INSERT`, qual none, with_check `true` (md5 `b326b5062b2f0e69046810717534cb09`). |
| | | 3. `Users can read their own routing history`: PERMISSIVE, roles `{public}`, cmd `SELECT`, qual `((auth.uid())::text = user_id)` (md5 `cb36b1a0770728f01fd9e4744dd633c9`), with_check none. Not in the 2026-09-15 dump excerpt. **Dropped with the other two (SA ruling S-1, OQ-3).** |
| P-6 | Foreign keys | **None** (0). `user_id` has **no FK** to `auth.users`, and it is a **`text`** column (the third policy compares it to `auth.uid()::text`). Account deletion leaves these rows orphaned. Only the cleanup function removes them. |
| P-7 | Dependent views (4, all depth 1) | `pilot_cost_savings_summary`, `pilot_routing_performance`, `pilot_step_type_analysis`, `pilot_tier_distribution`. All `relkind v`, owner `postgres`, no reloptions (no `security_invoker`), so all run with definer rights. All grant `arwdDxtm` to anon, authenticated and service_role, and anon and authenticated can SELECT each. Only `pilot_cost_savings_summary` reads `ai_model_pricing` directly. No `routing_source_comparison` view depends on the table. |
| P-8 | `operator_test_account_cleanup` | Exactly one. Owner `postgres`, SECURITY DEFINER (runs as owner). EXECUTE: `postgres` and `service_role` only (anon and authenticated: no). It is the only function whose body names the table. |
| P-9 | `public.is_platform_admin()` | No args. EXECUTE: authenticated **yes**, service_role **yes**, anon **no**. |
| P-10 | Rows | 21 total. 21 have a `user_id`. **0** created after 2025-11-12 (all rows predate the writer removal). |

W-5 stop rule (workplan): not triggered. All four views are plain postgres-owned views without `security_invoker`, and the only function naming the table is the cleanup function, which anon and authenticated cannot call.

### 1.2 Exposure assessment

**In business terms:** a stranger with no account can list part of the activity of every customer who used the legacy agent pilot. That includes which customers exist, which agents they ran, what the workflow steps were called, which AI models ran them, and what each step cost. Step names can contain the customer's own business wording. The same stranger can also change or delete every one of these rows. The amount of data is small and historic. The kind of leak is serious anyway, because it crosses customers and needs no login. The same data also reaches strangers in summarised form through the views built on this table (RF-2 to RF-4), and one of them shows agent identifiers. Locking only the table would leave that path open, so this slice closes both.

**Technical:**

| Aspect | Assessment |
|---|---|
| Who | Any anon key holder. The key is public in the JS bundle. |
| What | Cross-tenant read of `user_id` (a `text` column holding user ids, so user enumeration), `agent_id`, `execution_id`, `step_name` / `step_type`, model, provider, tier, token counts, estimated cost and `complexity_factors`. |
| Indirect path | The three dependent views (RF-2 to RF-4) are postgres-owned definer views granted to anon (P-7, measured). They serve aggregates from this table to anon, and `pilot_tier_distribution` exposes `agent_id`. Locking the base table alone does **not** close this path. The revoke-only fold-in (FR-10) does. |
| Size | 21 rows, all with a `user_id`, none created after 2025-11-12 (P-10). No new writes are expected, because the writers were removed (F-5). |
| Write risk | **Catalog-proven (SA ruling S-3):** anon holds UPDATE, DELETE, TRUNCATE and INSERT on the table (P-3), and the `ALL` / `true` policy applies to `public` (P-5), so anon can update and delete every row through PostgREST today. Not tested by writing. TRUNCATE is not exposed by PostgREST, but the grant exists. |
| Severity | **P1** (unauthenticated cross-tenant read and write; unchanged by S-3). Actual impact is low because the volume is small and historic. |

### 1.3 Related findings

| ID | Object | Observation | Handling |
|---|---|---|---|
| RF-1 | `public.pilot_cost_savings_summary` (view) | Owner `postgres`, no `security_invoker`, `arwdDxtm` granted to anon and authenticated. Reads this table plus `ai_model_pricing`. 0 rows today. | **Already handled** by price review slice 2 (`docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_WORKPLAN.md` §4.6, migration `20261052`, user-approved 2026-10-11). This slice must **not** touch or reference the view (C-6). See the dependency in §5. |
| RF-2 | `pilot_routing_performance` (view) | Answers anon: 1 aggregate row. Depends on this table (P-7). | **In scope, revoke-only (FR-10).** Redefining or dropping it is a follow-up (§7). |
| RF-3 | `pilot_step_type_analysis` (view) | Answers anon: 1 aggregate row. Depends on this table (P-7). | Same as RF-2. |
| RF-4 | `pilot_tier_distribution` (view) | Answers anon: 1 row, and the row **exposes `agent_id`**. Depends on this table (P-7). | Same as RF-2. |
| RF-5 | `workflow_step_executions` | Has an `Enable insert for anon role` policy (schema dump §9.6). | Out of scope. Follow-up slice (P1). Anon can write to this table. |
| RF-6 | `agent_memories` | Has a public/true "Service role can ..." policy (schema dump §9.6). | Out of scope. Follow-up slice (P1), with RF-5. |
| RF-7 | `execution_insights` | Has a public/true "Service role can ..." policy (schema dump §9.6). Also covered by the N17 purge note. | Out of scope. Follow-up slice (P1), with RF-5. |
| RF-8 | `pilot_step_routing_history.user_id` | No FK to `auth.users` (P-6, SA ruling S-2). Pre-existing: account deletion by any path other than `operator_test_account_cleanup` leaves this table's rows orphaned. | Out of scope. Follow-up (§7). |
| — | `model_routing_config` | Correctly returns 0 rows to anon. | No action. |

---

## 2. User Stories

- As a **platform customer**, I want my agent and usage history to be unreadable by strangers, both directly and through summary views, so that my business activity and identifiers are not exposed.
- As a **platform admin**, I want to keep seeing the pilot cost-savings view, so that I don't lose the historic reporting that price review slice 2 kept.
- As an **operator**, I want the test-account cleanup to keep removing this table's rows, so that account cleanup stays complete.

---

## 3. Functional Requirements

1. **FR-1 Read-only precheck.** Dev writes a read-only SQL probe for the user to run on prod. It covers everything listed in SA condition C-4: table owner, `relrowsecurity` / `relforcerowsecurity`, every policy verbatim, table and column ACLs per grantee, FKs with delete actions, the dependent views (FR-10) with owner, `reloptions` and ACL, the cleanup function's owner, and row counts. The result is recorded in this requirement before the migration is applied. **Recorded in §1.1.1 (2026-10-11).**
2. **FR-2 Enable RLS** on `public.pilot_step_routing_history`. This is idempotent (RLS is already on, P-1). Never `FORCE ROW LEVEL SECURITY` (C-1).
3. **FR-3 Drop all three captured policies** (`Service role can access all routing history`, `System can insert routing history` and `Users can read their own routing history`) by exact name, behind a guard that refuses unless the policy set is exactly these three, with the roles, cmd, qual and with_check captured in P-5 (C-2 as amended by SA ruling S-1). After apply the table has exactly one policy: the FR-4 admin SELECT policy.
4. **FR-4 Revoke all** privileges on the table from PUBLIC, anon, authenticated and service_role, then re-grant the minimum:
   - `authenticated`: `SELECT` only, behind an admin-only policy `pilot_step_routing_history_admin_select`, `FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))`. Never use `profiles.role`. No column grants.
   - `service_role`: `SELECT` only (OQ-1 ruling R-2).
   - `anon` and PUBLIC: nothing.
   - The owner (`postgres`) is never revoked from (C-1).
5. **FR-5 Cleanup function still works.** `operator_test_account_cleanup` (SECURITY DEFINER, owned by postgres, P-8) must still be able to delete this table's rows by `user_id`. It relies on the owner's privileges, not on any role grant (SA V-1).
6. **FR-6 Post-apply check script** (read-only). It asserts the target state in PASS/FAIL rows per C-5, including the FR-10 views. It reports the slice-2 view's `security_invoker` state as INFO only.
7. **FR-7 Rollback script, scoped down (C-7).** It does exactly three things: it drops the admin policy, re-grants to `service_role` the privileges the precheck recorded (P-3: DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE), and leaves RLS on. It **never** recreates any of the three dropped policies (including the owner-read one), **never** creates a `true` policy, **never** grants anything to anon, and **never** grants anything to authenticated. On the FR-10 views it only gives `service_role` back what it had (P-7: `arwdDxtm`). Rollback must never reopen the exposure.
8. **FR-8 Jest source guard.** A new test file in the existing `supabase/migrations/__tests__/` covers the migration, rollback, precheck and checker per C-8. It checks paste safety, the exact statement list (no anon grant, no `public` / `true` policy, no FORCE, admin policy uses `is_platform_admin()`, service_role gets `SELECT` only, no `pilot_cost_savings_summary` token), the rollback pins, and mutation self-tests. It reuses the existing suite and adds no CI time.
9. **FR-9 Purge descriptor note.** Update the N17 note at `lib/business-os/purge/descriptors.ts:469` to say the public/true policies were removed by `20261055` and that `execution_insights` still carries its N17 policy. `never(...)` and the class stay unchanged. This is a comment-only change.
10. **FR-10 Dependent views: revoke-only fold-in (C-3).** For every view that depends on `pilot_step_routing_history` (pg_depend via pg_rewrite, recursively), **except `pilot_cost_savings_summary`**:
    - revoke ALL from PUBLIC, anon and authenticated;
    - grant `SELECT` to `service_role`, so it keeps that access;
    - do nothing else. No view is redefined or dropped.
    
    The migration guard refuses ("nothing was applied") if the dependent-view **name** set differs from the set recorded below. It matches names, never OIDs, so slice 2's drop and recreate of its own view cannot trip it.

    **Dependent-view set (recorded from the FR-1 precheck, 2026-10-11 17:50 UTC, P-7):**

    | View | Owner | `security_invoker` | ACL before | In fold-in |
    |---|---|---|---|---|
    | `pilot_routing_performance` | postgres | not set (definer rights) | `{postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}` | Yes |
    | `pilot_step_type_analysis` | postgres | not set (definer rights) | same as above | Yes |
    | `pilot_tier_distribution` | postgres | not set (definer rights) | same as above | Yes |
    | `pilot_cost_savings_summary` | postgres | not set today; slice 2 sets it | same as above | **No** (slice 2, C-6) |

    The guard's expected name set is therefore exactly the three fold-in views, plus `pilot_cost_savings_summary` as the excluded fourth. `routing_source_comparison` does not depend on the table and is not part of the set.

### Approach (SA ruling R-1: Option A approved)

The precedent is the payment tables lockdown (server-write-only, PR #83) and the R-2 storage pattern in `supabase/migrations/20261017_business_os_credit_lots.sql`.

| Option | Description | Trade-off | Outcome |
|---|---|---|---|
| **A** | Server-only plus an admin SELECT path (FR-2 to FR-4), plus revoke-only on dependent views (FR-10) | Closes the exposure directly and through the views. Keeps the slice-2 view working for admins and keeps the cleanup function working. Smallest change that uses a proven pattern. | **Approved (SA R-1)** |
| B | `user_id`-scoped SELECT for row owners | No consumer reads this table, so owner access has no value. It also leaves the table more open than it needs to be. The existing owner-read policy found by the precheck is dropped for the same reason (S-1). | Rejected |
| C | Drop the table | Deleting historic data is a product decision. The slice-2 view depends on the table, and so does the cleanup function. | Rejected for now. Could be revisited later. |

---

## 4. Non-Functional Requirements

- **Security:** after the fix, anon has no access of any kind to the table or to its dependent views (other than `pilot_cost_savings_summary`, which slice 2 closes). Admin authz uses only `public.is_platform_admin()` / `admin_users`.
- **Operations:** the user applies the migration by hand on prod. Precheck, apply, post-check and rollback are separate scripts. No prod write tests are run to "prove" anon write access or cleanup behaviour.
- **CI:** no added CI time. The guard lives in the existing migrations test suite.
- **Migration number:** `20261055` (SA V-7: free in every worktree). RM re-confirms at commit.

---

## 5. Dependency: price review slice 2 view

Slice 2 recreates `pilot_cost_savings_summary` with `security_invoker = true`, so the view runs with the caller's own permissions on this table. Admins will keep seeing view rows **only if** this table keeps an admin SELECT path for `authenticated` (FR-4). Service role also needs table-level `SELECT` (R-2). If this slice removed all `authenticated` access, admins would silently see an empty view. This slice does not reference the slice-2 view at all (C-6).

The two migrations are order-independent, and **there is no gap in either order** (SA R-5):
- If this slice lands first, the old view is still postgres-owned and runs with definer rights. Postgres owns the table and RLS is not FORCEd, so the view keeps working for admins, and also for anon until slice 2 lands (RF-1 residual, 0 rows today). Slice 2 then switches the view to invoker rights, and our admin policy serves admins.
- If slice 2 lands first, the base table still has its public/true policies and default grants, so admins keep reading through the invoker view. When this slice lands, our admin policy takes over with no interruption.

In both orders the admin end state also needs admin read on `ai_model_pricing`, which already exists.

---

## 6. Acceptance Criteria

- [x] **AC-1** FR-1 precheck results (owner, RLS flags, policies, table and column grants, FKs, dependent views, cleanup function owner, row counts) are recorded in this requirement before apply, including the FR-10 view set. **Recorded in §1.1.1 and FR-10 (2026-10-11 17:50 UTC).**
- [ ] **AC-2** Anon `HEAD ... Prefer: count=exact` returns `0` rows or a permission error (401/403/42501). It no longer returns `/21`.
- [ ] **AC-3** Authenticated **non-admin** sees 0 rows (including rows with their own `user_id`, since the owner-read policy is dropped per S-1).
- [ ] **AC-4** Authenticated **admin** (`is_platform_admin()` true) sees all rows (21 at time of writing).
- [ ] **AC-5** Service role sees all rows (21).
- [ ] **AC-6** The post-apply check confirms: no anon grant, no `public` / `true` policy, exactly one policy (the admin SELECT policy) and none of the three captured policies, RLS enabled and not forced, authenticated and service_role hold `SELECT` only, and no column grants.
- [ ] **AC-7** Cleanup still works, proven without prod writes (C-9): the post-apply checker shows the table owner is unchanged (`postgres`) and still holds DELETE, and `scripts/test-account-cleanup-check.sql` still reports the table present with its key column OK.
- [ ] **AC-8** After slice 2 lands, `pilot_cost_savings_summary` still returns rows to admins and none to non-admins, and anon gets nothing from it (0 rows or a permission error).
- [ ] **AC-9** The Jest guard (FR-8) passes, and its mutation self-tests show it fails if an anon grant or a `true` policy is reintroduced.
- [ ] **AC-10** The rollback script creates no `true` policy, recreates none of the three dropped policies, grants nothing to anon, and grants nothing to authenticated. It only drops the admin policy, re-grants `service_role` its recorded privileges, and leaves RLS on.
- [ ] **AC-11** Every FR-10 dependent view has no privilege for PUBLIC, anon or authenticated, and `service_role` holds `SELECT` (catalog check). An anon read of each returns a permission error. No view was redefined or dropped.

---

## 7. Out of Scope / Future Roadmap

- `pilot_cost_savings_summary`, which is owned by price review slice 2.
- **Follow-up slice (confirmed, P1):**
  - RF-5: the `workflow_step_executions` anon INSERT policy.
  - RF-6 / RF-7: the public/true "Service role can ..." policies on `agent_memories` and `execution_insights`.
  - Redefining or dropping the RF-2 to RF-4 views once their definitions are captured. The FR-10 revoke covers the exposure until then.
  - Reconciling `docs/PILOT_PER_STEP_ROUTING_IMPLEMENTATION.md` with the live schema (docs).
- **Follow-up (SA ruling S-2, pre-existing):** RF-8. `user_id` is `text` with no FK, so account deletion by any path other than `operator_test_account_cleanup` leaves this table's rows orphaned. Belongs with the account-deletion backlog.
- Dropping or archiving the table (Option C).

---

## 8. Open Questions

- [x] **OQ-1:** Which privileges does `service_role` need? (raised by: BA | status: **resolved by SA R-2**)
  Resolution: `SELECT` only. DELETE is not needed: the cleanup runs as postgres, and no app code deletes. (The original resolution also cited FK actions; the precheck shows there is no FK on this table (P-6, S-2), so that reason does not apply and the ruling stands on the other two.) SELECT is kept because a `service_role` read of the `security_invoker` slice-2 view needs SELECT on the base table.
- [x] **OQ-2:** Should RF-4 (`pilot_tier_distribution`, which exposes `agent_id`) be folded into this slice? (raised by: BA | status: **resolved by SA R-3 / C-3**)
  Resolution: partly. All dependent views except `pilot_cost_savings_summary` are folded in **revoke-only** (FR-10). Redefinition or drop, RF-5, and the `agent_memories` / `execution_insights` policies stay in the follow-up slice.
- [x] **OQ-3:** What happens to the third policy, `Users can read their own routing history` (PERMISSIVE, `{public}`, SELECT, `((auth.uid())::text = user_id)`, P-5)? (raised by: TL from the precheck | status: **resolved by SA ruling S-1**)
  Resolution: it is dropped by exact name together with the other two. The guard expects exactly the three captured policies; the target state is one admin SELECT policy; the rollback does not recreate it. Keeping it would have let signed-in users read their own rows, contradicting AC-3 and the rejected Option B. Ruling recorded in `docs/workplans/PILOT_STEP_ROUTING_HISTORY_RLS_WORKPLAN.md` ("SA rulings on the Step 1 capture").

---

## 9. Notes on Integration Points

| Object | Impact |
|---|---|
| `public.pilot_step_routing_history` | RLS, policies and grants change (this slice). `user_id` is `text` with no FK (P-6). |
| Dependent views (FR-10: `pilot_tier_distribution`, `pilot_step_type_analysis`, `pilot_routing_performance`; the complete set per P-7) | Grants only: PUBLIC/anon/authenticated revoked, service_role keeps SELECT. Definitions unchanged. No app code reads them. |
| `public.pilot_cost_savings_summary` | No change here and not referenced (C-6). Depends on the admin SELECT path (§5). |
| `operator_test_account_cleanup` (migration `20261047`) | Must keep deleting this table's rows (FR-5). Relies on the postgres owner (P-8). It is the only path that removes these rows. |
| `lib/business-os/purge/descriptors.ts:469` | `never(...)` stays. N17 note refreshed (FR-9). |
| `public.is_platform_admin()` | Used by the new admin policy. Executable by authenticated and service_role, not anon (P-9). |
| `scripts/test-account-cleanup-check.sql` | Used for AC-7 verification. No change expected. |

---

## SA Review

**Reviewed by SA — 2026-10-11**
**Status:** APPROVED WITH CONDITIONS (Option A). Dev may write the workplan. The conditions below are binding on it.

### What SA verified in the repo

| # | Check | Result |
|---|---|---|
| V-1 | `operator_test_account_cleanup` ownership | `20261047` line 2040: `ALTER FUNCTION ... OWNER TO postgres`, `SECURITY DEFINER`, EXECUTE to `service_role` only. It deletes `pilot_step_routing_history` by `user_id` (plan row 124, step B) as **postgres**, so it does not depend on any `service_role`, `anon` or `authenticated` grant. It keeps working as long as the table is owned by postgres (or postgres keeps its own privileges) and RLS is not FORCEd. |
| V-2 | FK on `user_id` | `20261047` lists `public.pilot_step_routing_history.user_id` in its reviewed `auth.users` FK set (`tenancy`), so the FK exists. Its ON DELETE action is not in the repo; the precheck captures it. Either way, grants do not matter: RI cascade / NO ACTION checks run internally and ignore table grants and RLS. |
| V-3 | App-side deleters | None. No `lib/`, `app/`, `components/` reference outside `lib/business-os/purge/descriptors.ts` (a `never` descriptor, so purge never touches it). The only `auth.admin.deleteUser` paths are pinned by `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`; they rely on V-1/V-2, not on a `service_role` DELETE on this table. |
| V-4 | Admin predicate | `public.is_platform_admin()` keeps EXECUTE for `authenticated` and `service_role` after secdef slice 3 (`20261049` lines 54-55). Safe to use in the policy. |
| V-5 | Slice 2 (`neuronforge-model-pricing-s2`, `20261052`) | Its guard checks only: the view exists and is a plain view, nothing else depends on the view, the view's eight columns, and the two `ai_model_pricing` cost column types. Its checker V-5 is catalog-only on the view (relkind, columns, owner, `security_invoker`, view grants). **Nothing in slice 2 inspects the base table's grants, RLS or policies.** This slice cannot make slice 2's guard refuse, and slice 2 cannot make ours refuse, provided C-6 holds. |
| V-6 | Purge baseline | `lib/business-os/purge/__tests__/classification-baseline.json` maps the table to `"never"` only. The FR-9 note change does not touch it, and no purge test pins the note text. `descriptors.ts` has 0 `console.*` calls and no import from `lib/business-os/entitlements/` (line 480 is a comment), so neither the logging rule nor the entitlements skill is triggered. |
| V-7 | Migration numbers | `origin/main` has `20261050_secdef_lockdown_slice4a_signed_in.sql`. Slice 2 holds `20261051` and `20261052`. **`20261055` is free in every worktree.** Note for RM (not this slice's problem): `neuronforge-refund-trigger` also has a `20261050_*` file, which collides with main's `20261050`. §4's "origin/main ends at 20261049" is now stale. |

> **Correction, 2026-10-11 (SA ruling S-2, from the precheck P-6). SA text above left as written.** V-2 is not borne out on prod. There is **no FK** on this table, and `user_id` is `text`, not a UUID FK to `auth.users`. The `20261047` entry is a reviewed tenancy column, not a live constraint. V-2's conclusion that grants do not matter for deletion still holds, for a simpler reason: nothing cascades into this table, and the only deleter is the postgres-owned cleanup function (V-1, P-8). V-3's reliance on "V-1/V-2" rests on V-1 alone. In R-2 below, the reason "FK actions ignore grants (V-2)" is moot; R-2 stands on its other reasons. Pre-existing consequence (follow-up RF-8): account deletion by any other path leaves this table's rows orphaned.

### Rulings

**R-1 Option A: approved.** B gives owner reads nobody uses; C is a product decision and breaks the slice-2 view and the cleanup plan. A follows the R-2 pattern in `20261017_business_os_credit_lots.sql` (ENABLE RLS, per-role `REVOKE ALL`, minimal re-grant, `(SELECT ...)`-wrapped policy predicate) and the server-write-only intent of `20261004_payment_tables_write_lockdown.sql`.

**R-2 OQ-1: `service_role` gets `SELECT` only.** Not DELETE, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN.
- DELETE is not needed: the cleanup runs as postgres (V-1), FK actions ignore grants (V-2), and no app code deletes (V-3).
- SELECT is kept because it is needed. Slice 2 grants SELECT on the view to `service_role`, and its workplan §4.6 promises "service_role sees what it saw before". Once the view is `security_invoker`, a `service_role` read of the view needs SELECT on this base table, or it fails with 42501. BYPASSRLS skips the policies, but it does not skip table grants.
- `authenticated`: table-level `SELECT` plus one policy, `FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))`. No column grants. `anon` and PUBLIC: nothing.

**R-3 OQ-2: RF-5 (`workflow_step_executions`) stays out. The dependent views are partly folded in (C-3).** BA's reading of RF-2 to RF-4 misses one thing. Per `docs/PILOT_PER_STEP_ROUTING_IMPLEMENTATION.md`, `pilot_tier_distribution`, `pilot_step_type_analysis` (and probably `pilot_routing_performance` / `routing_source_comparison`) read **this table**. If they are postgres-owned definer views granted to anon, as RF-1 was, locking the base table does **not** close the anon path. They keep serving aggregates from it, and `pilot_tier_distribution` keeps leaking `agent_id`. The overview's promise ("anyone at all" can no longer read it) would be false. Redefining those views needs captured definitions and stays a follow-up. A **revoke-only** change does not: no app code reads any of them (repo search, 2026-10-11).

**R-4 FR-9: keep.** It is a one-line comment, and the current note will be false after apply. Make it say the public/true policies were removed by `20261055`, that `execution_insights` still carries its N17 policy, and keep `never(...)` and the class unchanged.

**R-5 §5 ordering: confirmed, with one wording fix.** Ours first: the old view is owned by postgres, has no `security_invoker`, and runs as the owner. If postgres owns the table and RLS is not FORCEd, the view keeps working for everyone. That includes anon until slice 2 lands (RF-1 residual, 0 rows today). Slice 2 first: the base table still has the public/true policies and default grants, so admins read through the invoker view, and our admin policy then takes over. **There is no gap in either order.** Rewrite §5 bullet 2, which reads as if a gap exists. The end state for admins in both orders also needs `ai_model_pricing` admin read, which already exists.

### Conditions (binding on the workplan)

1. **C-1 Owner and FORCE.** The migration guard refuses unless the table owner is `postgres`. Never REVOKE from `postgres` or the owner. Do not `FORCE ROW LEVEL SECURITY`; the checker asserts `relforcerowsecurity = false`. This protects V-1 and the definer view in the window before slice 2.
2. **C-2 The guard matches the captured state, not whatever is there.** One `BEGIN; SET LOCAL lock_timeout = '5s'; ... COMMIT;`. A `DO` guard refuses with "nothing was applied" unless the policy set on the table is exactly the two expected names, with roles `{public}` and the captured cmd/qual/with_check from the precheck. Then plain `DROP POLICY` by exact name, with no `IF EXISTS` and no `CASCADE`. Then `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (idempotent), `REVOKE ALL ON TABLE ... FROM PUBLIC / anon / authenticated / service_role` as one-role statements like 20261017, `GRANT SELECT` to authenticated and to service_role, and `CREATE POLICY pilot_step_routing_history_admin_select`.
3. **C-3 Dependent views: revoke-only fold-in.** The precheck lists every view that depends on this table (pg_depend via pg_rewrite, recursively), with owner, `reloptions` (`security_invoker`) and ACL. For each one **except `pilot_cost_savings_summary`** (slice 2 owns it, RF-1), the migration revokes ALL from PUBLIC, anon and authenticated, grants SELECT to service_role, and nothing else: no redefinition and no drop. The guard refuses if the dependent-view name set differs from the set recorded in this requirement. Match names, never OIDs, so slice 2's drop and recreate cannot trip it. If the user would rather not widen the slice, the only acceptable alternative is to reword §Overview, §1.2 and §6 to state the residual exposure through these views and open the follow-up as P1 at once. SA prefers the fold-in.
4. **C-4 Precheck (FR-1) contents.** Read-only (`SET default_transaction_read_only = on`, as in `precheck-purchase-path-tables-grants.sql`, with the "run the migration in a NEW tab" READ ME row). It captures: table owner; `relrowsecurity` / `relforcerowsecurity`; every `pg_policies` row verbatim (`policyname`, `permissive`, `roles`, `cmd`, `qual`, `with_check`); table ACL per grantee via `aclexplode(COALESCE(relacl, acldefault('r', relowner)))`, including PUBLIC, all roles and MAINTAIN; column ACLs (`pg_attribute.attacl`) for all roles; every FK on the table, with target and `confdeltype` spelled out; the dependent views per C-3 with owner, reloptions and ACL; whether `operator_test_account_cleanup` is owned by postgres; and row counts: total, `user_id IS NOT NULL`, and `created_at > '2025-11-12'`. Record all of it in this file before apply (AC-1).
5. **C-5 Post-apply checker (FR-6).** Catalog assertions as PASS/FAIL rows, as in the existing `check-*-migration.sql` scripts. RLS on and not forced. Exactly one policy, the admin SELECT policy with `TO authenticated` and a qual that calls `is_platform_admin`. `has_table_privilege` false for anon on every privilege. authenticated has SELECT only. service_role has SELECT only. Zero column grants. The owner is unchanged and holds DELETE. Every C-3 view has no anon or authenticated privilege. It also reports the slice-2 view's `security_invoker` state as INFO, not PASS/FAIL, so the checker is correct in either order. Anon and non-admin behaviour (AC-2, AC-3) is proven by the read-only HEAD probe and by catalog checks. **Never by a write.**
6. **C-6 No coupling with slice 2.** This migration must not reference `pilot_cost_savings_summary` at all: no guard on it, no grant, no create. Slice 2 must not need changing. If slice 2's guard (V-5) ever changes to inspect base-table state, re-review.
7. **C-7 Rollback (FR-7) is scoped down.** "Restore the previous policy and grant shape" cannot be done safely. The old policies were `TO public USING (true)`, and recreating them hands the table back to every role that still has a grant. The rollback therefore does exactly three things: it drops the admin policy, re-grants to `service_role` the privileges the precheck recorded, and leaves RLS on. It never creates a `true` policy, never grants to anon, and never grants anything to authenticated. It does not touch the C-3 views beyond giving service_role back what it had. Amend FR-7 and AC-10 to say so.
8. **C-8 Jest guard (FR-8)** is a new file in `supabase/migrations/__tests__/`, modelled on `purchase-path-tables-client-grants.migration.test.ts`, covering the migration, rollback, precheck and checker:
   - **Paste safety.** No `--` or `/*`. Literals use letters, digits, underscore and space only. The word "into" appears nowhere. There is exactly one BEGIN/COMMIT, with `SET LOCAL lock_timeout`.
   - **The exact statement list.** No `TO anon` and no `TO PUBLIC` anywhere. No `USING (true)` and no `WITH CHECK (true)`. No `FORCE`. No revoke from postgres. The admin policy text uses `(SELECT public.is_platform_admin())` and never `profiles`. The migration has no `pilot_cost_savings_summary` token. The service_role grant is `SELECT` only.
   - **Rollback pins per C-7.**
   - **Mutation self-tests.** Inject an anon grant and inject a `true` policy, and show the test fails on each (AC-9).
   
   It adds no CI job. The existing Jest shards pick it up.
9. **C-9 AC-7 cleanup verification.** A test account will probably have 0 rows in this table, which would make "still deletes rows" vacuous. Accept instead: the C-5 owner/DELETE assertion, plus `scripts/test-account-cleanup-check.sql` still reporting the table present with its key column OK. No prod writes to "prove" anything.
10. **C-10 Text fixes.**
    - Correct §4 Migration number to `20261055`.
    - Fix §5 bullet 2 per R-5.
    - Add to §1.3 / §7 the other public/true "Service role can ..." policies found by the same schema dump (§9.6): `agent_memories` and `execution_insights`. They belong in the follow-up with RF-5.
    - AC-8 also asserts that anon gets nothing from `pilot_cost_savings_summary` after slice 2.

> **Amendment, 2026-10-11 (SA ruling S-1, from the precheck P-5). SA text above left as written.** Where C-2 says "exactly the two expected names", read **exactly the three captured policies**: `Service role can access all routing history`, `System can insert routing history` and `Users can read their own routing history`, each with roles `{public}` and the cmd / qual / with_check captured in P-5. All three are dropped by exact name. The target state is one policy, the admin SELECT policy (C-5 unchanged). The C-7 rollback recreates none of the three. Full rulings S-1 to S-3: `docs/workplans/PILOT_STEP_ROUTING_HISTORY_RLS_WORKPLAN.md`, "SA rulings on the Step 1 capture".

### Follow-up (confirmed, separate slice, P1)
RF-5 `workflow_step_executions` anon INSERT policy. The `agent_memories` and `execution_insights` public/true policies. Redefinition or drop of the RF-2 to RF-4 views once their definitions are captured (the C-3 revoke covers the exposure in the meantime). The docs reconciliation of `PILOT_PER_STEP_ROUTING_IMPLEMENTATION.md`.

### Approval
[x] Requirement approved with conditions C-1 to C-10. Proceed to the Dev workplan.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | BA finding and requirement from the 2026-10-10/11 read-only prod measurements. Option A recommended. Awaiting SA review. |
| 2026-10-11 | SA review | APPROVED WITH CONDITIONS (C-1 to C-10). Option A. OQ-1: service_role SELECT only. OQ-2: RF-5 stays out; dependent views get a revoke-only fold-in (C-3). FR-9 kept. Migration `20261055`. Ordering with price review slice 2 confirmed independent. |
| 2026-10-11 | SA conditions applied (BA) | Status set to Approved (SA, with conditions applied). Added FR-10, the revoke-only fold-in on dependent views (all except `pilot_cost_savings_summary`), with the view-set table filled from the precheck. Updated Overview, §1.2, §1.3, §9 and AC-11 to match. FR-4 sets service_role to SELECT only (R-2). FR-7 and AC-10 rescope rollback per C-7. AC-7 replaced per C-9. AC-8 now covers anon on the slice-2 view. §4 migration number is `20261055`. §5 is rewritten as order-independent with no gap (R-5). Added RF-6/RF-7 (`agent_memories`, `execution_insights`) to §1.3 and the §7 follow-up. OQ-1 and OQ-2 resolved. ACs numbered. The SA Review section is unchanged. |
| 2026-10-11 | Precheck recorded (BA) | Step 1 precheck run on prod 2026-10-11 17:50:38 UTC (read-only). Added §1.1.1 Measured state (P-1 to P-10). F-3/F-4 updated: RLS on and not forced; anon, authenticated and service_role hold full privileges; anon UPDATE/DELETE of every row is now catalog-proven (not tested by writing). §1.2 updated. Third policy `Users can read their own routing history` found; recorded as OQ-3, pending SA ruling (FR-3 notes it). No FK on `user_id`, which is `text`: OQ-1 resolution text corrected, BA correction note added under SA V-2 (SA text unchanged), RF-8 added. FR-10 view table filled with the three fold-in views; `pilot_cost_savings_summary` excluded (slice 2); `routing_source_comparison` is not a dependent. FR-7 lists the recorded service_role privileges. AC-1 ticked; apply waits on OQ-3. |
| 2026-10-11 | SA rulings S-1 to S-3 applied (BA) | From the workplan's "SA rulings on the Step 1 capture". **S-1:** all three captured policies are dropped, including `Users can read their own routing history`; FR-3 now says "exactly the three captured policies", target state is one admin policy; AC-3, AC-6, AC-10 and FR-7 updated; OQ-3 resolved; dated amendment note appended after the C-2 conditions (SA text unchanged). **S-2:** no FK, `user_id` is `text`; the V-2 note is now a dated correction covering V-2, V-3 and R-2's FK reasoning (SA text unchanged); FK wording removed elsewhere; follow-up RF-8 added to §1.3 and §7 (account deletion by any path other than the cleanup function orphans rows, pre-existing). **S-3:** F-4 and the §1.2 Write risk row read catalog-proven; severity stays P1. Apply no longer waits on an open question. |
| 2026-10-11 | Renumbered to 20261055; applied to prod | Merging main brought in PR #304 (price review slice 2), which holds 20261052 and 20261053, and an open branch `fix/exposed-views-slice-1a` claims 20261054, so this migration and its rollback were renamed to 20261055 (all references updated; the content is unchanged). The renamed files were committed to PR #305. The migration was applied to prod by TL on 2026-10-11 with the user's approval, through the Supabase MCP: it committed cleanly, so both guards passed. Catalog after apply: RLS on, one policy (pilot_step_routing_history_admin_select, authenticated, SELECT, is_platform_admin), table ACL postgres=arwdDxtm, authenticated=r, service_role=r. The three views keep only postgres and service_role. The 21 rows are intact. Anon HEAD probes return 401 with no content-range on the table, the three views and pilot_cost_savings_summary (before the fix: 206, 0-0/21). AC-2, AC-3, AC-5, AC-6 and AC-11 are met; AC-8 also holds because slice 2 is already applied. |
