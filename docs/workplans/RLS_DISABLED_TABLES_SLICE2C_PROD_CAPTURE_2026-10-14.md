# Slice 2c-0 Production Capture

> **Last Updated**: 2026-10-14

## Overview

These are the read-only captures F1–F8 from [RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md](/docs/workplans/RLS_DISABLED_TABLES_SLICE2C_WORKPLAN.md). TL ran them through the Supabase connector against prod (`jgccgkyhpwirgknnceoh`) on 2026-10-14. The state is post-stopgap (`20261060`) and post-1b (`20261059`).

---

## F1. Key columns

| Table | Column | Type | Nullable | Default |
|---|---|---|---|---|
| agent_configurations | id | text | NO | — |
| agent_configurations | user_id | uuid | NO | — |
| agent_configurations | agent_id | uuid | NO | — |
| agent_executions | id | uuid | NO | gen_random_uuid() |
| agent_executions | user_id | uuid | **YES** | — |
| agent_executions | agent_id | uuid | NO | — |
| agent_logs | id | uuid | NO | gen_random_uuid() |
| agent_logs | user_id | uuid | NO | — |
| agent_logs | agent_id | uuid | NO | — |
| agent_stats | agent_id (PK) | uuid | NO | — |
| agent_stats | user_id | uuid | **YES** | — |
| shared_agents | id | uuid | NO | gen_random_uuid() |
| shared_agents | user_id | uuid | NO | — |
| shared_agents | original_agent_id | uuid | NO | — |
| shared_agents | import_count | int4 | YES | 0 |
| shared_agents | last_imported_at | timestamptz | YES | — |
| shared_agent_imports | id | uuid | NO | gen_random_uuid() |
| shared_agent_imports | shared_agent_id | uuid | NO | — |
| shared_agent_imports | imported_by_user_id | uuid | NO | — |
| shared_agent_imports | created_agent_id | uuid | YES | — |

All agent-id columns are `uuid`, so F5's join is valid.

---

## F2. Constraints

| Table | Constraint | Definition |
|---|---|---|
| agent_configurations | agent_configurations_agent_id_fkey | FK (agent_id) → agents(id) ON DELETE CASCADE |
| agent_configurations | agent_configurations_user_id_fkey | FK (user_id) → auth.users(id) ON DELETE CASCADE |
| agent_configurations | agent_configurations_status_check | status IN (configured, running, completed, failed) |
| agent_executions | agent_executions_agent_id_fkey | FK (agent_id) → agents(id) ON DELETE CASCADE |
| agent_executions | agent_executions_user_id_fkey | FK (user_id) → auth.users(id) ON DELETE CASCADE |
| agent_executions | progress / routing_tier / run_mode checks | value checks |
| agent_logs | agent_logs_agent_id_fkey | FK (agent_id) → agents(id) **NO ACTION** |
| agent_logs | agent_logs_user_id_fkey | FK (user_id) → auth.users(id) **NO ACTION** |
| agent_logs | agent_logs_severity_check | severity IN (low, medium, high) |
| agent_stats | agent_stats_pkey and agent_id_unique | PK and UNIQUE (agent_id) |
| agent_stats | agent_stats_agent_id_fkey | FK (agent_id) → agents(id) ON DELETE CASCADE |
| agent_stats | fk_user | FK (user_id) → auth.users(id) ON DELETE CASCADE |
| shared_agents | fk_shared_agents_original_agent | FK (original_agent_id) → agents(id) ON DELETE CASCADE |
| shared_agents | fk_shared_agents_user | FK (user_id) → auth.users(id) ON DELETE CASCADE |
| shared_agents | check_ai_confidence_range | 0..1 or NULL |
| shared_agent_imports | shared_agent_id_fkey | FK → shared_agents(id) ON DELETE CASCADE |
| shared_agent_imports | imported_by_user_id_fkey | FK → auth.users(id) ON DELETE SET NULL (on a NOT NULL column) |
| shared_agent_imports | created_agent_id_fkey | FK → agents(id) ON DELETE SET NULL |
| shared_agent_imports | (shared_agent_id, imported_by_user_id) | **UNIQUE**, which answers Q-2C-4: one import per user per template |

---

## F3. Caller-rights functions

Every function here has `prosecdef = false`, `proconfig = none` and owner `postgres`. The ACL is EXECUTE for PUBLIC, anon, authenticated and service_role.

| Function | md5(prosrc) |
|---|---|
| aggregate_execution_model_usage(p_execution_id uuid) | 4bbbb87228c9293a31f0a8a363b1bd19 |
| increment_agent_stats(agent_id_input uuid, user_id_input uuid) | 634f1f906406fa90bfb7029ae7cec801 |
| increment_agent_stats(agent_id_input uuid, user_id_input uuid, success boolean) | f5373182c1c3cdff8b629c80d78967e9 |
| increment_shared_agent_import_count() | 5cbf1c07ab4b7de5d89d2709132c5d03 |
| update_agent_schedule_safe(agent_uuid uuid, new_cron text, new_timezone text) | cdb6a0606635fc76d0e7a61497278000 |
| update_agent_stats(p_agent_id uuid, p_user_id uuid) | 3ae36179c87bc4942177c1ab77105bba |

The function bodies were not captured here. Dev should capture `prosrc` for the import-count trigger function when writing the rollback (Q-2C-6).

---

## F4. Triggers

| Table | Trigger | Function | Owner-rights |
|---|---|---|---|
| agent_configurations | update_agent_configurations_updated_at (BEFORE UPDATE) | update_updated_at_column | false |
| agent_executions | update_agent_executions_updated_at (BEFORE UPDATE) | update_updated_at_column | false |
| shared_agent_imports | trigger_increment_shared_agent_import_count (AFTER INSERT) | increment_shared_agent_import_count | false |

All three are enabled (`O`).

---

## F5. C-4 data check: ⚠️ NON-ZERO, SA ruling required

| Table | Rows | NULL agent | Agent missing | Agent owner differs |
|---|---|---|---|---|
| agent_configurations | 55 | 0 | 0 | **3** |
| agent_executions | 1328 | 0 | 0 | **11** |
| agent_logs | 89 | 0 | 0 | 0 |
| agent_stats | 38 | 0 | 0 | **1** |
| shared_agents | 0 | 0 | 0 | 0 |
| shared_agent_imports | 0 | 0 | 0 | 0 |

Follow-up breakdown, TL, read-only:

| Table | Row user_id NULL? | Agent owner NULL? | Rows | Distinct agents | Date range |
|---|---|---|---|---|---|
| agent_configurations | no | no | 3 | 3 | 2026-05-05 to 2026-06-02 |
| agent_executions | no | no | 11 | 2 | 2026-05-17 to 2026-06-02 |
| agent_stats | no | no | 1 | 1 | 2026-06-02 (agent created_at) |

- **All 15 rows are real owner mismatches.** The row has one non-null user and its agent has a different non-null owner.
- **They are all old.** Nothing is newer than 2026-06-02.
- **Likely cause:** agents whose owner changed (reassigned or re-owned test accounts), not live cross-tenant writes. This is unconfirmed.
- **Consequence:** under the owner policy, each row's `user_id` owner can no longer pass the C-4 WITH CHECK on UPDATE. The agent's current owner cannot see the row.
- **Ruling needed from SA** (Q-2C-3, extended): re-own the rows to the agent owner, delete them, or leave them in place as an accepted, documented exception.

---

## F6. Policies to pin

| Table | Policy | Cmd | Roles | qual md5 | check md5 | qual / check |
|---|---|---|---|---|---|---|
| agents | Allow read access to own agents | SELECT | public | 19300d155780585259ede73ac370586c | — | `auth.uid() = user_id` |
| agents | Allow user access to own agents | ALL | public | 19300d155780585259ede73ac370586c | 19300d155780585259ede73ac370586c | `auth.uid() = user_id` / same |
| agents | Users can view their own agents | SELECT | public | 19300d155780585259ede73ac370586c | — | `auth.uid() = user_id` |
| execution_routing_decisions | Service role can manage routing decisions | ALL | public | ea849457c1a771a3ea5e4fe3c0210590 | — | `auth.role() = 'service_role'` |
| execution_routing_decisions | Users can view their execution routing decisions | SELECT | public | 97a65517eb8b8a5ca555fdd3dd99efcc | — | `execution_id IN (SELECT agent_executions.id FROM agent_executions WHERE agent_executions.user_id = auth.uid())` |

---

## F7. Indexes (policy cost)

| Table | user_id index | agent_id index |
|---|---|---|
| agent_configurations | ✅ idx_agent_configurations_user_id | ✅ idx_agent_configurations_agent_id |
| agent_executions | ✅ idx_agent_executions_user_id | ✅ idx_agent_executions_agent_id (plus composites) |
| agent_logs | ⬜ **none** | ⬜ **none** (only pkey and created_at) |
| agent_stats | ⬜ **none** | ✅ PK (agent_id) |
| shared_agents | ✅ idx_shared_agents_user_id, idx_shared_agents_user_original | ✅ idx_shared_agents_original_agent_id |
| shared_agent_imports | ✅ idx_shared_agent_imports_user | n/a (shared_agent_id indexed) |

`agent_logs` has 89 rows and `agent_stats` has 38, so the missing indexes cost almost nothing today. SA decides whether the migration adds them.

---

## F8. Other objects naming the six tables

| Kind | Name | Detail |
|---|---|---|
| function | aggregate_execution_model_usage | caller rights |
| function | increment_agent_stats (×2) | caller rights |
| function | increment_shared_agent_import_count | caller rights |
| function | update_agent_schedule_safe | caller rights |
| function | update_agent_stats | caller rights |
| function | operator_test_account_cleanup | **owner rights**, unaffected by RLS |
| policy | execution_routing_decisions "Users can view their execution routing decisions" | SELECT |
| view | agent_executions_with_details | security_invoker=true (from 1b), revoked from clients |

No drift since 2026-10-11: no unexpected function, view or policy references the six tables.

---

## S-3. Function bodies (TL, read-only, 2026-10-14)

| Function | md5(prosrc) | What it does |
|---|---|---|
| increment_agent_stats(agent_id_input, user_id_input) | 634f1f906406fa90bfb7029ae7cec801 | `insert into public.agent_stats (agent_id, user_id, run_count, last_run_at) values (…, 1, now()) on conflict (agent_id) do update set run_count = agent_stats.run_count + 1, last_run_at = now()` |
| increment_agent_stats(agent_id_input, user_id_input, success) | f5373182c1c3cdff8b629c80d78967e9 | Same upsert, and also increments `success_count` |
| increment_shared_agent_import_count() | 5cbf1c07ab4b7de5d89d2709132c5d03 | `UPDATE shared_agents SET import_count = import_count + 1, last_imported_at = NOW() WHERE id = NEW.shared_agent_id; RETURN NEW;` (unqualified table name, so `search_path` matters for T-1) |
| update_agent_schedule_safe(agent_uuid, new_cron, new_timezone) | cdb6a0606635fc76d0e7a61497278000 | Updates `agents` (schedule fields), then **`UPDATE agent_executions SET status = 'cancelled', error_message = 'Schedule updated' WHERE agent_id = agent_uuid AND status IN ('queued','pending')`**. Its `EXCEPTION WHEN OTHERS` returns `{success:false}`, so it never raises |

What this means for the census:
- `update_agent_schedule_safe` **does** write to `agent_executions`. That confirms SA's S-3 finding and corrects the workplan's "touches agents only".
- Under owner RLS, a caller can only cancel queued or pending runs whose `user_id` is their own. For the agent's owner, that is the intended effect.
- If a queued run belongs to a different user, it is now skipped silently, because RLS filters it out of the UPDATE and raises no error.
- The body contains `--` comments. A verbatim recreate would break the paste rule. 2c-2 does not recreate this function, so this does not apply.

---

## D-0a. The 15 mismatch rows (TL, read-only, 2026-10-14)

| Table | Rows | Agents | Row users | Agent owners | Statuses | Row user is admin | Owner is admin | Both users exist | md5 of sorted id set |
|---|---|---|---|---|---|---|---|---|---|
| agent_configurations | 3 | 3 | 2 | 2 | configured | yes | yes | yes | b31a2dae58f839b033bbc32195c7ccb8 |
| agent_executions | 11 | 2 | 2 | 2 | completed, failed | yes | yes | yes | 23439f4752cdf8364e0eeb43a04fc2ba |
| agent_stats | 1 | 1 | 1 | 1 | — | yes | yes | yes | 2a4cf06b64f83d1f077506323dad7d7d |

- Every user on both sides of every mismatch is in `admin_users`, and every one still exists.
- No execution is queued or pending, so none can be resumed.
- This fits SA's likely cause: admin calibration ran under the admin's identity before 2026-07-03 (`ab68f84a`).
- No customer account is involved.
- The id-set md5 is `md5(string_agg(id::text, ',' ORDER BY id::text))`. For agent_stats the key is `agent_id`.

`agent_stats` columns: `agent_id` uuid (PK), `run_count` int4, `success_count` int4, `last_run_at` timestamp, `user_id` uuid. These are counters only, which confirms SA's BQ-4 statement.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | TL ran F1–F8 read-only on prod. F5 is non-zero (15 rows), so the stop rule applies and an SA ruling is required |
| 2026-10-14 | S-3 and D-0a added | Function bodies captured (`update_agent_schedule_safe` writes `agent_executions`). The 15 mismatch rows are all admin-on-admin with no queued runs; id-set md5 pins recorded |
