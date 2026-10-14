# Workplan: RLS-disabled tables, slice 2

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Branch:** `fix/rls-disabled-tables-slice-2` (off `origin/main` @ `a585f6a7`)
**Requirement:** none. This is a security fix commissioned by TL from prod measurements (same footing as exposed views slice 1a, PR #306), so no BA requirement was written.
**Date:** 2026-10-11
**Status:** ✅ **2a (`20261056`) and 2b (`20261057`) applied on prod 2026-10-12 and merged** (PR #313, merge `08722970`). Checkers PASS 64/0 and 11/0. **2c (`20261058`) not started** — next, after slice 1b of the exposed-views work. Session handover state: memory `db-exposure-lockdown.md`.

## Overview

**Severity: P0.** Fifteen `public` tables have row level security switched off. `anon` and `authenticated` hold SELECT, INSERT, UPDATE, DELETE and also TRUNCATE on all of them (Q6). The anon key ships in the browser bundle, so anyone on the internet can read, change, delete or wipe these rows over PostgREST (and pg_graphql), without signing in.

| Exposure | Table | Why it matters |
|---|---|---|
| Billing evidence, writable and deletable by anyone | `token_usage` (29,649 rows) | Business OS usage summaries, the credit leak check and the LLM ledger checks all read it. `credit_transactions` references it. Anyone can forge, inflate or erase usage |
| Customer workflow data, cross-tenant | `agent_executions` (1,328), `agent_configurations` (55), `agent_logs` (89), `agent_stats` (38) | Run outputs, input values (which can hold emails and document ids), logs for every user |
| Platform config, writable by anyone | `pricing_config`, `ais_normalization_ranges`, `memory_config`, `storage_plans` | Pricing and scoring parameters can be changed by a stranger |
| Personal data, open to anyone | `contact_messages`, `message_replies` | Empty today (Q8), but every future contact-form submission would land in an open table |

The fix enables RLS on every table and narrows client grants to what the app actually uses:

- **7 tables are server-only.** No client role reads or writes them.
- **`ais_normalization_ranges` gets a read-only policy for signed-in users.** An invoker RPC reads it during agent runs.
- **7 tables get owner policies.** Signed-in users use them through the browser or a cookie client.

**Count:** 15 tables, confirmed by TL (the brief's "14" was a miscount). `processed_webhook_events` is excluded: RLS is off but it already has no client grants.

## Table of Contents

1. [Facts](#facts)
2. [How the clients map to database roles](#how-the-clients-map-to-database-roles)
3. [Per-table analysis](#per-table-analysis)
4. [Proposed slicing](#proposed-slicing)
5. [Approach per category](#approach-per-category)
6. [Files](#files)
7. [Task list](#task-list)
8. [Test plan](#test-plan)
9. [Acceptance](#acceptance)
10. [Prod fact queries (answered)](#prod-fact-queries-answered)
11. [Risks](#risks)
12. [Open questions for SA](#open-questions-for-sa)
13. [Ownership boundaries](#ownership-boundaries)
14. [SA Review Notes](#sa-review-notes)
15. [Follow-ups recorded](#follow-ups-recorded-not-in-this-pr)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## Facts

### Base facts (TL, read-only, 2026-10-11)

Row counts are from Q7/Q8. RLS and force are off on every table, and every table is owned by postgres.

| Table | Ownership cols | Rows | NULL owner | Policies | Triggers | FK refs (→ out, ← in) |
|---|---|---|---|---|---|---|
| `agent_configurations` | agent_id, user_id | 55 | 0 | none | updated_at | → agents, auth.users |
| `agent_executions` | agent_id, user_id | 1328 | 0 | none | updated_at | → agents, auth.users; ← agent_scheduler_state, execution_anomalies, execution_routing_decisions |
| `agent_job_fallback` | none | 0 | — | none | none | none |
| `agent_logs` | user_id, agent_id | 89 | 0 | none | none | → agents, auth.users |
| `agent_scheduler_state` | agent_id | 0 | — | none | updated_at | → agent_executions, agents |
| `agent_stats` | agent_id, user_id | 38 | 0 | none | none | → agents, auth.users |
| `ais_normalization_ranges` | none | 23 | — | none | none | none |
| `contact_messages` | email | 0 | — | none | updated_at | ← message_replies |
| `memory_config` | none | 5 | — | none | updated_at | none |
| `message_replies` | none | 0 | — | none | none | → contact_messages |
| `pricing_config` | none | 23 | — | none | updated_at (`update_pricing_config_timestamp`) | none |
| `shared_agent_imports` | `imported_by_user_id` | 0 | 0 | none | AFTER INSERT import counter | → agents, auth.users, shared_agents |
| `shared_agents` | user_id | 0 | 0 | none | none | → agents, auth.users; ← shared_agent_imports |
| `storage_plans` | none | 5 | — | none | none | none |
| `token_usage` | user_id, agent_id | 29649 | 0 | **6, all `TO public`, inactive** | updated_at | → auth.users; ← credit_transactions |

### Prod answers Q1–Q9 (TL, read-only, 2026-10-11)

| Q | Answer | Consequence |
|---|---|---|
| Q1 `token_usage` policies | Six PERMISSIVE policies, all `TO public`, all owner-scoped on `auth.uid() = user_id`:<br>• two INSERT with with_check: `Users can insert their own token usage`, `token_usage_insert_policy`<br>• two SELECT with qual: `Users can view their own token usage`, `token_usage_select_policy`<br>• `token_usage_update_policy`: UPDATE, qual only, with_check NULL<br>• `token_usage_delete_policy`: DELETE with qual | Enabling RLS alone would open nothing, because anon has `auth.uid()` NULL. 2b still replaces them:<br>• keep one SELECT and one INSERT, `TO authenticated`, wrapped `(SELECT auth.uid())`<br>• drop UPDATE and DELETE, since no client path uses them |
| Q2 triggers | Seven tables have only BEFORE UPDATE `updated_at` triggers (`update_updated_at_column` or `update_pricing_config_timestamp`, invoker): agent_configurations, agent_executions, agent_scheduler_state, contact_messages, memory_config, pricing_config, token_usage.<br>`shared_agent_imports` also has `trigger_increment_shared_agent_import_count`, AFTER INSERT. It calls `increment_shared_agent_import_count()`, which is **invoker** and runs `UPDATE shared_agents SET import_count + 1, last_imported_at WHERE id = NEW.shared_agent_id`.<br>No trigger anywhere writes `agent_scheduler_state` or `agent_stats` | The `updated_at` triggers only modify `NEW`, so they are unaffected. The import counter updates **another user's** `shared_agents` row with the importer's rights. Under 2c, authenticated holds no UPDATE on `shared_agents`, so the trigger raises **42501**, which also aborts the `shared_agent_imports` insert. The import itself still succeeds, because both callers treat tracking as best-effort (SA ruling 2, Q-SA-2). `agent_scheduler_state` is confirmed category A |
| Q3 functions | See the [caller audit](#invoker-function-caller-audit) below. Invoker with anon + authenticated EXECUTE:<br>• `aggregate_execution_model_usage`<br>• `increment_agent_stats` (2 overloads), `update_agent_stats`<br>• `get_pricing_config`<br>• `get_active_ais_ranges`, `update_dynamic_ais_ranges`<br>• `set_memory_expiration`<br>• `update_agent_schedule_safe` (touches `agents` only)<br>`business_os_usage_summary` is invoker and service-only. Definer-rights, so unaffected: check_execution_anomaly, get_user_usage_summary, operator_test_account_cleanup, update_execution_baseline, upsert_intent_example, upsert_workflow_pattern | One classification changes: `get_active_ais_ranges` is called with the signed-in user's client |
| Q4 views | `agent_executions_with_details` (over agent_executions), `daily_token_usage` and `monthly_token_usage` (over token_usage). All owner-rights, with anon + authenticated SELECT | Slice 1b owns these. They keep exposing every row until 1b, whatever this slice does (R-5) |
| Q5 other policies | `execution_routing_decisions` has "Users can view their execution routing decisions" (SELECT, `TO public`): `execution_id IN (SELECT agent_executions.id FROM agent_executions WHERE agent_executions.user_id = auth.uid())` | `agent_executions` must keep an owner SELECT policy for authenticated (R-4) |
| Q6 grants | Every table: anon, authenticated, postgres and service_role each hold DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE, granted by postgres. information_schema does not list MAINTAIN | The pre-guard pins this state. The rollback restores `ALL` to anon and authenticated. Anon TRUNCATE (which ignores RLS) is why `REVOKE ALL` is required |
| Q7 NULL owners | 0 in every B table | No row is orphaned by owner policies |
| Q8 rows / Realtime | Counts in the table above. No table is in any Realtime publication | The import-counter question is moot today (0 shared agents) |
| Q9 API logs, 24 h | agent_executions HEAD 113; token_usage GET 52, POST 20, HEAD 11; contact_messages GET 1; nothing else, and no `/rpc/` hit for any Q3 function. The role is not visible in this log view | Consistent with the grep, but it cannot separate anon from service role (R-8). The single contact_messages GET matches the admin messages route |

### Invoker-function caller audit

These functions run with the caller's rights, so a client-role caller hits the new RLS.

| Function | Code callers | Runtime role | Effect |
|---|---|---|---|
| `get_active_ais_ranges()` | `AISConfigService.getRanges(supabase)`, reached three ways:<br>• `lib/utils/updateAgentIntensity.ts:164`, from `app/api/run-agent/route.ts:555` (cookie client)<br>• the same function from `lib/pilot/WorkflowPilot.ts:2507`, where the cookie client comes from run-agent, run-agent-sandbox, calibrate/resume and non-admin v2/calibrate/batch<br>• `AgentIntensityService` (service role from create-agent) and `app/api/agents/[id]/intensity` (service role) | **authenticated** on agent runs | **`ais_normalization_ranges` is no longer pure A.** Without a policy, `getRanges` gets nothing and silently falls back to hardcoded defaults, which changes intensity scores. It needs SELECT `TO authenticated USING (true)` and no writes. The 23 rows are global scoring config, not tenant data |
| `update_dynamic_ais_ranges()` | `app/api/admin/ais-config` (2 calls) | service role | none |
| `get_pricing_config()` | none in code (docs only) | — | `pricing_config` stays A. A stray client call would get no rows |
| `set_memory_expiration()` | none in code | — | `memory_config` stays A |
| `increment_agent_stats(...)` | `AgentStatsRepository.incrementStats` from run-agent (cookie client); `app/api/agent-stream` (cookie client); `cron/process-queue` (service role) | authenticated | `agent_stats` needs owner SELECT, INSERT and UPDATE. `INSERT ... ON CONFLICT DO UPDATE` checks the INSERT `WITH CHECK`, then the UPDATE `USING` on the existing row (which needs SELECT), then the UPDATE `WITH CHECK` |
| `update_agent_stats(uuid,uuid)` | none in code | — | the same policies cover it |
| `aggregate_execution_model_usage(uuid)` | `lib/pilot/StateManager.ts:548, 731`, with `WorkflowPilot`'s client | authenticated | needs owner SELECT on `token_usage`, and owner SELECT + UPDATE on `agent_executions`. Already in the plan |

Optional hardening, out of scope: these invoker functions still grant EXECUTE to anon. Once the tables are locked, anon gets nothing useful from them, so revoking EXECUTE would be a tidy-up rather than a fix.

### Repository facts

- **No migration in the repo defines these tables, their triggers or the six `token_usage` policies.** They were created in the dashboard, so Q1–Q3 are the source of truth.
- `business_os_usage_summary` (`20260929_usage_summary.sql`) is SECURITY INVOKER, revoked from anon and authenticated, and called by the service role. It is not affected.
- No `postgres_changes` subscription in the code targets these tables.
- Every script under `scripts/` that reaches these tables uses the service role key.
- The Edge Function `supabase/functions/run-scheduled-agents` uses the service role and touches only `agents`.
- The operator test-account cleanup (`20261041`..`20261047`) is definer-rights and owned by postgres. Purge runs server-side. Neither is affected **as long as RLS is not forced**.
- **Migration numbering on main.** `20261052_ai_model_pricing_baseline.sql` is taken, and **two files share `20261053`**: `20261053_ai_model_pricing_exact_prices_and_image_table.sql` and `20261053_pilot_step_routing_history_rls_lockdown.sql`. PR #308 resolved the duplicate by renumbering the routing-history file to `20261055`, and PR #306 holds `20261054`. So this work uses **`20261056`** (2a), **`20261057`** (2b) and **`20261058`** (2c), per SA C-1. On 2026-10-11, after `git fetch`, no remote branch held 2026105[6-9]. Re-check at PR time and before merge.

### `agents` policies (C-4 prerequisite, TL, read-only, 2026-10-11)

`public.agents`: RLS on, force off. anon and authenticated hold SELECT, INSERT and UPDATE. There are three policies, all PERMISSIVE with roles `{public}`:

- "Allow read access to own agents": SELECT, qual `(auth.uid() = user_id)`
- "Allow user access to own agents": ALL, qual and with_check `(auth.uid() = user_id)`
- "Users can view their own agents": SELECT, qual `(auth.uid() = user_id)`

These are plain owner predicates, so C-4's `EXISTS (SELECT 1 FROM public.agents ... a.user_id = (SELECT auth.uid()))` works under the caller's rights in 2c's `WITH CHECK`.

---

## How the clients map to database roles

| Client in code | Key | Runs as |
|---|---|---|
| `supabase` from `@/lib/supabaseClient` in a `'use client'` page | anon key + browser session | `authenticated` when signed in, `anon` when not |
| `supabase` from `@/lib/supabaseClient` **imported by server code** (repositories that default to it) | anon key, **no session on the server** | **`anon`** |
| `createAuthenticatedServerClient()`, `createRouteHandlerClient({ cookies })`, `createServerClient(url, ANON_KEY, { cookies })` | anon key + cookie session | `authenticated` |
| `supabaseServer`, `createServerSupabaseClient()`, any `createClient(url, SERVICE_ROLE_KEY)` | service role | `service_role` (bypasses RLS) |

The second row is the trap. Three agent-platform API routes use a repository whose default client is the browser client, so on the server they talk to the database as `anon`. They work today only because anon has full access. See [Risks](#risks) R-1.

---

## Per-table analysis

A "client-role" path is one that reaches the table as `anon` or `authenticated`. Service-role paths are given only as a count, because RLS does not apply to them.

### Category A: server-only (no client-role reader or writer)

| Table | Readers / writers on main | Client role | Signed-out path? | Area | Category |
|---|---|---|---|---|---|
| `agent_job_fallback` | none in code, scripts, Edge Functions or migrations | none | no | agent platform (legacy) | **A** |
| `agent_scheduler_state` | only the test-account cleanup SQL and the purge descriptors; no trigger writes it (Q2) | postgres / service role | no | agent platform | **A** |
| `contact_messages` | `app/api/contact` (public form, insert); `app/api/admin/messages`, `.../[id]` and `.../[id]/replay` | service role | the public form posts to `/api/contact`, which inserts **server-side** | platform | **A** (not D, because the browser never inserts directly) |
| `memory_config` | only `MemoryConfigService.updateConfig`, which has **no caller**, and `set_memory_expiration()`, which also has no caller. All memory config reads go to `system_settings_config` | none | no | agent platform | **A** |
| `message_replies` | `app/api/admin/messages` and `.../[id]/replay` | service role | no | platform | **A** |
| `pricing_config` | `app/api/admin/reward-config`; `get_pricing_config()` has no caller | service role | no | platform (legacy pricing) | **A** |
| `storage_plans` | only `StorageService.getStoragePlans`, which has **no caller**. `StorageService` is built only by `QuotaAllocationService`, from the Stripe webhook with `supabaseServer` | none | no | platform | **A** |

### Category C (signed-in read only)

| Table | Readers / writers | Client role | Signed-out path? | Area | Category |
|---|---|---|---|---|---|
| `ais_normalization_ranges` | **authenticated:** `get_active_ais_ranges()` during agent runs (caller audit above). **Service role:** `app/api/admin/ais-config` (read/write, incl. `update_dynamic_ais_ranges`), `app/api/admin/dashboard`, `app/api/pricing/ais-ranges` (public route, server-side), `lib/audit/ais-helpers.ts` `snapshotNormalizationRanges` | authenticated (read) | the public pricing route reads it server-side | agent platform (AIS) | **C (authenticated)**: SELECT `USING (true)` to authenticated, no client writes, nothing for anon |

### Category B: owner access

| Table | Client-role readers / writers (file : operation) | Client role | Signed-out path? | Area | Category |
|---|---|---|---|---|---|
| `agent_configurations` | **Browser:**<br>• `app/(protected)/agents/[id]/page.tsx`: select<br>• `app/v2/agents/[id]/run/page.tsx`: select<br>• `useAgentSandbox.ts`: select + **upsert**<br>**Cookie client:**<br>• `app/api/agent-stream`: insert + update<br>• `app/api/agents/[id]/repair-hardcode`: select / insert / update<br>• `app/api/run-agent` via `AgentConfigurationRepository(supabase)`: getInputValues, updateStatus<br>• `app/api/v2/calibrate/load-configuration`, `save-configuration`, and `v2/calibrate/batch` (non-admin) via the repository<br>Plus 7 service-role paths | authenticated | no | agent platform | **B**: owner SELECT, INSERT, UPDATE |
| `agent_executions` | **Browser:** select in `app/(protected)/agents/[id]/page.tsx`, `app/v2/agents/[id]/page.tsx`, `app/v2/dashboard/page.tsx`, `RunningExecutionsCard`, `UsageAnalytics`, `FailedOperationsDialog`, and `AgentScoreService(browser).getExecutionDiversityPenalty`.<br>**Cookie client:**<br>• `app/api/run-agent` via `ExecutionRepository(supabase)`: create, updateLogs, findById, findRunningByAgentId<br>• `WorkflowPilot(authClient)`: `StateManager` insert/update, `aggregate_execution_model_usage` (invoker, updates the row), `TokenReconciliationService` update<br>• `app/api/agents/[id]` DELETE handler: counts rows<br>• `execution_routing_decisions` policy subquery (Q5)<br>**Anon on the server:** `app/api/agents/[id]/metrics` (default `executionRepository` = browser client).<br>About 25 service-role paths, including `app/api/business-os/stats` (BOS) | authenticated, plus one anon-on-server route | no | agent platform; BOS reads it server-side only | **B**: owner SELECT, INSERT, UPDATE |
| `agent_logs` | **Browser:** `app/(protected)/agents/[id]/history`, `.../runs`, `app/(protected)/dashboard`, `app/v2/dashboard`, `lib/hooks/useDashboardData`, `AgentHistoryBlock`, and `AlertFeed` (select + **update** of `dismissed`, `is_read`).<br>**Cookie client:** `app/api/agent-stream` insert; `app/api/run-agent` via `AgentLogsRepository(supabase).create` | authenticated | no | agent platform | **B**: owner SELECT, INSERT, UPDATE |
| `agent_stats` | **Browser:** select in `AgentStatsBlock`, `app/(protected)/agents/[id]`, `.../runs`, `app/(protected)/dashboard`, `app/v2/dashboard`, `useDashboardData`, `AgentStatsChart`, `AgentStatsTable`, `components/v2/Footer`.<br>**Cookie client:** run-agent (`AgentStatsRepository(supabase).incrementStats`) and `app/api/agent-stream`, both calling the invoker `increment_agent_stats` (INSERT ... ON CONFLICT (agent_id) DO UPDATE) | authenticated | no | agent platform | **B**: owner SELECT, INSERT, UPDATE (all three are required by the upsert) |
| `shared_agents` | **Browser:**<br>• `app/(protected)/layout.tsx`: count of all rows<br>• `app/(protected)/templates` and `app/v2/templates`: list **all users'** shared agents<br>• `app/(protected)/agents/[id]`: select (own and by id) + **insert** (owner)<br>• `AgentScoreService(browser).calculateQualityScore`: select<br>**Cookie client:** `app/api/agents/import-shared` selects another user's row by id; the import-counter trigger updates another user's row (Q2).<br>**Anon on the server:** `app/api/shared-agents` POST and `app/api/shared-agents/exists` (default `sharedAgentRepository` = browser client).<br>**Service role:** `cron/update-template-scores` update | authenticated, plus two anon-on-server routes | `/v2/templates` would read it signed out, but nothing links there signed out | agent platform | **B + C**: SELECT to authenticated for all rows (it is a gallery), owner INSERT. UPDATE: see Q-SA-2 |
| `shared_agent_imports` | **Browser:** `app/(protected)/templates` insert. **Cookie client:** `app/api/agents/import-shared` insert. The AFTER INSERT trigger then updates `shared_agents` with the importer's rights | authenticated | no | agent platform | **B**: owner INSERT (+ SELECT for `RETURNING`), owner = `imported_by_user_id` |
| `token_usage` | **Writes:** almost all go through `AIAnalyticsService` with a service-role client. Every construction site was checked: provider factory, agent-creation routes, BOS `turnUsage`, `usageTracker`. **One client-role writer:** `lib/pilot/StepExecutor.ts:918` inserts a plugin-call row with `WorkflowPilot`'s cookie client.<br>**Client-role reads:**<br>• `lib/hooks/useAnalyticsData.ts`: browser, owner-filtered, `/analytic` page<br>• `app/admin/learning-system/page.tsx`: browser, reads **all users'** memory-creation costs<br>• `TokenReconciliationService`, `updateAgentIntensity` and `aggregate_execution_model_usage`: cookie client during runs<br>**All Business OS readers use the service role:** `TokenUsageRepository`, `usageSummary`, `ChatBudget`, `turnUsage`, `BusinessOsCreditLedgerReadRepository`, the leak check, the LLM ledger, and the admin token-usage routes | authenticated | no | **BOS-critical data**; the agent platform writes it client-side | **B**: owner SELECT + INSERT. The six existing policies are replaced (Q1) |

Side effect worth noting: `AgentStatsTable` and `AgentStatsChart` read `agent_stats` with no user filter, so today they show every user's stats. Owner RLS fixes that silently.

---

## Proposed slicing

| Slice | Tables | Migration | Code changes | Why this cut |
|---|---|---|---|---|
| **2a** | the 7 category A tables + `ais_normalization_ranges` (read-only to authenticated) | `20261056` | none | Biggest win at lowest risk. No client role writes any of them, and the one client reader keeps its read. It closes the writable config tables and the personal-data tables |
| **2b** | `token_usage` | `20261057` | none (see Q-SA-3 for the admin learning-system page) | It is Business OS billing evidence. Q1 shows the existing policies are already owner-scoped, so the risk is low, but it is the BOS-relevant change and its proof differs (owner insert from a run, BOS readers on the service role). Kept alone so it does not wait on 2c's code change |
| **2c** | `agent_configurations`, `agent_executions`, `agent_logs`, `agent_stats`, `shared_agents`, `shared_agent_imports` | `20261058` | **3 routes**: `app/api/agents/[id]/metrics`, `app/api/shared-agents`, `app/api/shared-agents/exists` (R-1) | Agent platform only. It needs owner policies and a code change, and the user does not test the agent platform, so it is proven in-database and by code analysis |

The brief suggested two slices, with token_usage and every policy table together. With Q1 answered, 2b is small and low-risk, so **2a and 2b could reasonably merge** (Q-SA-4). 2c stays separate because of its code change.

**`ais_normalization_ranges` placement.** It carries a policy, but it stays in 2a: the policy is one global `USING (true)` SELECT with no owner logic, and keeping it there avoids holding a writable config table open until 2c.

---

## Approach per category

All packages follow the shape of the secdef slice 5 family (`20261051_*`) and the slice 1a views package (`20261054_*`): a read-only pre-check, the migration, a read-only checker with VERDICT first, a rollback in `supabase/SQL Scripts/`, and a static Jest test over the SQL text.

Paste rules hold in every pasted file:

- no `--` and no `/*`;
- the word "into" appears nowhere, not even PL/pgSQL `SELECT ... INTO`;
- string literals carry punctuation only when they are relation names;
- every `string_agg` has `COLLATE "C"`;
- the words SECURITY DEFINER are never written, because the slice 6 guard fails closed on them.

Common to every table:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. **Never FORCE.** The cleanup and purge paths run as the owner and must keep working.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, then re-grant only what the category needs. `REVOKE ALL` is used instead of a list so that TRUNCATE, REFERENCES, TRIGGER and (on PG17) MAINTAIN all go. **TRUNCATE ignores RLS**, and Q6 shows anon holds it today.
- An explicit `GRANT ALL ... TO service_role`, so the server paths do not rely on vendor defaults.
- One transaction with `SET LOCAL lock_timeout`, guarded on both sides:
  - a DO pre-guard refuses unless prod still matches Q6 and Q2: RLS off, the grant set above, the captured trigger set, and (2b) the six policy names from Q1;
  - a DO post-assert re-reads the catalog and raises "nothing was applied" on any mismatch.
- Policy predicates use the wrapped form `(SELECT auth.uid()) = user_id`, as in `20261017_business_os_credit_lots.sql`.

### A. Server-only (2a)

Enable RLS with no policies, revoke all client grants, grant service_role. The post-assert checks: RLS on, zero policies, no privilege for PUBLIC, anon or authenticated, and service_role holding SELECT, INSERT, UPDATE and DELETE.

### C. Signed-in read (2a: `ais_normalization_ranges`)

Enable RLS. Revoke all from PUBLIC, anon and authenticated. Grant SELECT to authenticated and ALL to service_role. One policy: `ais_normalization_ranges_authenticated_select FOR SELECT TO authenticated USING (true)`.

No table needs a signed-out read. The public pricing route and the public contact form both go through server routes with the service role. **There is no category D**, because the contact form inserts server-side.

### B. Owner access (2b, 2c)

- **anon:** nothing.
- **authenticated:** only the verbs the code uses (per the tables above).
- **No DELETE anywhere.** No client-role path deletes these rows. Deleting an agent removes children through FK cascades, which are not subject to RLS.
- One policy per verb, `TO authenticated`, with `USING` and/or `WITH CHECK` `(SELECT auth.uid()) = user_id` (`imported_by_user_id` for `shared_agent_imports`). UPDATE policies carry both `USING` and `WITH CHECK`, so a row cannot be re-owned.
- **`token_usage` (2b):** drop the six Q1 policies by exact name, then create `token_usage_owner_select` and `token_usage_owner_insert`. Grants to authenticated: SELECT, INSERT. UPDATE and DELETE are gone for clients. The BEFORE UPDATE `updated_at` trigger is unaffected.
- **`agent_stats` (2c):** owner SELECT + INSERT + UPDATE, which the `increment_agent_stats` upsert needs.
- **`shared_agents` (2c):** SELECT `TO authenticated USING (true)` for the gallery and the import route, plus owner INSERT. Whether to add UPDATE depends on Q-SA-2.

### Code changes (2c only)

Three routes take the caller's identity from the `x-user-id` header:

- `app/api/agents/[id]/metrics`
- `app/api/shared-agents` (POST)
- `app/api/shared-agents/exists`

Each also queries through a repository whose default client is the browser client, so it runs as `anon`. After 2c they would get `42501`.

**Proposed fix:**

- read the user from `createAuthenticatedServerClient().auth.getUser()`, dropping the header trust;
- pass that cookie client into `ExecutionRepository` / `SharedAgentRepository`, so RLS does the scoping. This also closes the routes' header-trust IDOR (the identity hardening sweep class);
- give the touched lines the `new-api-route` treatment (Zod, Pino, correlationId);
- add integration tests for the happy path, unauthenticated, and invalid input.

See Q-SA-1 for the alternative.

---

## Files

2a and 2b are written. 2c is planned only.

| File | Slice | Action | Reason |
|---|---|---|---|
| `scripts/precheck-rls-disabled-tables-slice2a.sql` | 2a | create | Read-only, one grid. Per table: relkind, owner, RLS and force flags, privileges held per role across all 8 (incl. MAINTAIN), PUBLIC, grantors, column ACL count, policies, triggers, dependent views, functions naming it, other policies naming it. `PRECHECK STATUS` is CLEAN or STOP, and every STOP REASON is listed |
| `supabase/migrations/20261056_rls_disabled_tables_slice2a_server_only.sql` | 2a | create | The fix for the 7 server-only tables and `ais_normalization_ranges` |
| `scripts/check-rls-disabled-tables-slice2a-migration.sql` | 2a | create | Read-only checker, VERDICT first. 8 checks per table, 64 in total |
| `supabase/SQL Scripts/20261056_rls_disabled_tables_slice2a_server_only_rollback.sql` | 2a | create | Exact inverse: drops the read policy, disables RLS, and runs `GRANT ALL` to anon and authenticated (Q6). Its first statement is the warning |
| `scripts/precheck-rls-disabled-tables-slice2b.sql` | 2b | create | Read-only, one grid. Same state as 2a, plus each Q1 policy with its md5 and "matches the pin", owned sequences, FKs into the table, views left for 1b, and the row and NULL-owner counts |
| `supabase/migrations/20261057_rls_disabled_tables_slice2b_token_usage.sql` | 2b | create | The `token_usage` fix |
| `scripts/check-rls-disabled-tables-slice2b-migration.sql` | 2b | create | Read-only checker, VERDICT first, 11 checks, plus an INFO row for the 1b views |
| `supabase/SQL Scripts/20261057_rls_disabled_tables_slice2b_token_usage_rollback.sql` | 2b | create | Exact inverse: drops the two owner policies, recreates the six Q1 policies verbatim (`TO public`, unwrapped `auth.uid()`), disables RLS, and runs `GRANT ALL` to anon and authenticated. Its post-assert re-pins the six by md5. Its first statement is the warning |
| `supabase/migrations/__tests__/rls-disabled-tables-slice2.migration.test.ts` | 2a + 2b | create | Static guard, 103 tests. Paste rules on all 8 files (C-10), exact DDL, pre-guard pins (C-3), privilege asserts (C-2), lock_timeout (C-8), no FORCE (C-9), rollbacks as exact inverses, boundary objects, a source allowlist for the 2a tables, and mutation self-tests |
| the same files as `slice2c` / `20261058_..._agent_owner_tables` | 2c | planned | The six agent-platform tables, with C-3 (pin the Q5 policy), C-4 (agent-keyed WITH CHECK) and C-7 (repository-singleton guard) |
| `app/api/agents/[id]/metrics/route.ts`, `app/api/shared-agents/route.ts`, `app/api/shared-agents/exists/route.ts` (+ `__tests__/`) | 2c | planned | R-1 and Q-SA-1. These must ship and deploy before `20261058` is applied (C-6) |
| `docs/workplans/RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md` | all | create | This file |

---

## Task list

- ✅ Confirm the branch (`fix/rls-disabled-tables-slice-2`) and the migration numbers on main. Merged `origin/main` @ `d1bc95e2` (PR #308) before writing code
- ✅ Grep every reader and writer of the 15 tables in `app/ lib/ components/ hooks/ scripts/ supabase/functions/` and the migrations, and map each to its runtime role
- ✅ Classify each table and propose the slicing
- ✅ Fold in TL's Q1–Q9 answers and audit every caller of the invoker functions (moved `ais_normalization_ranges` from A to C-authenticated)
- ✅ SA workplan review: approved with conditions C-1 to C-11; `agents` policies recorded (C-4 prerequisite); C-5 wording fixed
- ✅ 2a: pre-check, migration `20261056`, checker, rollback
- ✅ 2b: pre-check, migration `20261057`, checker, rollback
- ✅ Static test (103/103), `npm run test:authz-guard` (203/203), Tailwind escape guard (6/6), all `supabase/migrations/__tests__` + token_usage repository tests (36 suites, 1776 tests), the migration-scanning guards (5 suites, 126 tests)
- ✅ Local dry run on PGlite (PostgreSQL 17.5, in-memory, scratch only), described in [Local dry run](#local-dry-run-pglite-pg-175)
- ⬜ 2a + 2b: SA code review → QA → user diff → TL apply 2a, then 2b only after the 2a checker passes (Q-SA-4) → RM (one PR allowed)
- ⬜ 2c: route changes deploy first (C-6), then SQL `20261058` with C-3, C-4 and C-7

---

## Test plan

| Layer | What | Slice |
|---|---|---|
| Static (Jest) | `rls-disabled-tables-slice2.migration.test.ts`:<br>• all 8 pasted files: no `--`, `/*`, "into" or SECURITY DEFINER; an even quote count; plain literals; `COLLATE "C"` on every `string_agg`; no FORCE; no object owned by another session<br>• the migrations: exact DDL in order, lock_timeout, guard and assert contents<br>• the rollbacks: exact inverse DDL and the warning<br>• the read-only checkers and pre-checks<br>• the source allowlist: only the known service-role files name a 2a table in `.from()`, and `get_pricing_config` / `set_memory_expiration` have no caller<br>• mutation self-tests | 2a, 2b |
| Integration (Jest) | The three changed routes: happy path, 401 with no session, 400 on invalid input, forged `x-user-id` ignored (C-6) | 2c |
| Local dry run | PGlite (PG 17.5), described below | 2a, 2b |
| In-database (prod) | Pre-check CLEAN, checker VERDICT PASS, plus the probes in [Acceptance](#acceptance) | all |
| Not required | Agent runs (the agent platform is out of scope for user testing) | 2c |

### Local dry run (PGlite, PG 17.5)

Dev ran all 8 files against an in-memory PGlite (PostgreSQL 17.5) in the session scratchpad. This was not a connection to any Supabase database.

**Setup**

- Roles `anon`, `authenticated` and `service_role` (BYPASSRLS).
- An `auth.uid()` that reads `request.jwt.claims`.
- The 9 tables, with `GRANT ALL` to all three roles, as Q6 found.
- The six Q1 policies, recreated from TL's text.
- `get_active_ais_ranges()` as an invoker function.
- A `daily_token_usage` view.

**Results**

| Step | Result |
|---|---|
| Q1 qual deparse | `(auth.uid() = user_id)`, md5 `19300d155780585259ede73ac370586c`, which is the pin used in the 2b guard |
| Both pre-checks before | CLEAN. All six policies show "matches the pin" |
| 2a migration | Applied. Re-running it refuses with "row security is already on so nothing was applied" |
| 2a checker | `VERDICT PASS 64 pass 0 fail` |
| 2b migration | Applied |
| 2b checker | `VERDICT PASS 11 pass 0 fail`. The new policies deparse as `(( SELECT auth.uid() AS uid) = user_id)` |
| anon probes | SELECT on all 9 tables, plus TRUNCATE and INSERT on `contact_messages`: `permission denied` |
| authenticated on server-only tables | SELECT on `contact_messages`: `permission denied` |
| authenticated on `ais_normalization_ranges` | SELECT returns 23 rows; `get_active_ais_ranges()` returns 23 rows; UPDATE is `permission denied` |
| Owner probes on `token_usage` | count = 2 (the owner's rows of 3); INSERT of an own row OK; INSERT for another user hits `new row violates row-level security policy`; UPDATE and DELETE are `permission denied`; service_role count = 3 |
| Rollbacks (2b, then 2a) | Both applied. Both pre-checks are CLEAN again, and the six policies match the pins again, so the round trip is exact. The 2a checker then reports FAIL (39 pass, 25 fail), as expected |
| Fail-closed runs | A drifted `token_usage_update_policy` (`USING (true)`) makes the pre-check STOP ("policy differs from the pin") and the migration refuse. A column grant on `contact_messages` makes the pre-check STOP ("has column privileges") and the 2a migration refuse |

---

## Acceptance

All proofs are in-database. TL runs the read-only checks; applying needs the user's authorization in the same session. **Apply 2a first; apply 2b only after the 2a checker passes (Q-SA-4).**

### Apply order (each slice)

1. **Pre-check.** Paste `scripts/precheck-rls-disabled-tables-slice2a.sql` (or `...slice2b.sql`). **Save the output**; the rollback is checked against it. Stop and bring it back to TL if any row says `stop here`, `differs` or `not expected`.
   - **2a, expected:**
     - `PRECHECK STATUS` = `CLEAN run the migration in a NEW tab`.
     - Per table:
       - Q1 `relkind r owner postgres rls false force rls false ... ok`
       - Q2 anon and authenticated `8 of 8 held DELETE INSERT MAINTAIN REFERENCES SELECT TRIGGER TRUNCATE UPDATE ALL matches the rollback`
       - Q2 service_role `8 of 8 ... kept by the migration`
       - Q2 PUBLIC `none as expected`
       - Q3 grantors `postgres`
       - Q4 `0 ok`, Q5 `0 ok`, Q7 `none ok`, Q9 `none ok`
       - Q6 lists only the `updated_at` triggers from TL's Q2
       - Q8 lists the Q3 functions: `get_active_ais_ranges` and `update_dynamic_ais_ranges` under ais_normalization_ranges, `get_pricing_config` under pricing_config, and `set_memory_expiration` under memory_config. The trigger functions may also appear
     - Q10 shows `17xxxx`.
   - **2b, expected:**
     - `CLEAN`.
     - Q1 `... rls false force rls false`.
     - Q2 the same as 2a.
     - Q4 `0 ok`.
     - Q5 `6 ok`, and all six policies show `matches the pin`.
     - Q7 lists `daily_token_usage` and `monthly_token_usage` (for 1b).
     - Q8 lists `aggregate_execution_model_usage`, `business_os_usage_summary` and `get_user_usage_summary`, plus any others that name `token_usage`.
     - Q9 `none ok`.
     - Q10 shows `credit_transactions`.
     - Q11 shows any owned sequence with authenticated usage.
     - Q12: total ≈ 29.6k rows, 0 with no user id.
2. **Migration in a NEW tab.** Paste `20261056_...sql` (then later `20261057_...sql`). It succeeds silently, or raises "... so nothing was applied" and rolls back.
3. **Checker.** Expected `VERDICT PASS 64 pass 0 fail` (2a) or `VERDICT PASS 11 pass 0 fail` (2b). The 2b INFO row lists the three views still open until 1b (C-11).

### Probes (TL, each block separately; all end in ROLLBACK, so nothing persists)

**2a: anon is refused on every table** (expect `42501 permission denied`), one block per table:

```sql
BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.contact_messages; ROLLBACK;
```

Repeat for `agent_job_fallback`, `agent_scheduler_state`, `ais_normalization_ranges`, `memory_config`, `message_replies`, `pricing_config` and `storage_plans`.

**2a: authenticated is refused on a server-only table** (expect 42501):

```sql
BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.contact_messages; ROLLBACK;
```

**2a: authenticated can read the AIS ranges** (expect 23, twice):

```sql
BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.ais_normalization_ranges; ROLLBACK;
```

```sql
BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.get_active_ais_ranges(); ROLLBACK;
```

**2b: anon is refused** (expect 42501):

```sql
BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.token_usage; ROLLBACK;
```

**2b: the owner sees exactly their own rows.** Pick a real `<uid>` with token_usage rows. First, as postgres, run `SELECT count(*) FROM public.token_usage WHERE user_id = '<uid>';`. Then the following must return the same number:

```sql
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true); SELECT count(*) FROM public.token_usage; ROLLBACK;
```

**2b: an insert for another user fails WITH CHECK** (expect `new row violates row-level security policy for table "token_usage"`). `<other uid>` is a different real user:

```sql
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true); INSERT INTO public.token_usage (user_id, input_tokens, output_tokens) VALUES ('<other uid>', 0, 0); ROLLBACK;
```

If NOT NULL columns without defaults make this fail with 23502 first, add them with dummy values. The probe only needs to reach the policy check.

**2b: the owner cannot update** (expect 42501):

```sql
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true); UPDATE public.token_usage SET input_tokens = input_tokens; ROLLBACK;
```

**After apply**

- The service role is unchanged: as `service_role`, SELECT on each table succeeds.
- Over the next 24 h, Supabase API logs show no new 4xx or 5xx on the touched tables from app traffic.
- The BOS usage and credits screens still load for a test account (2b).

### Rollback

Each rollback is the exact inverse of its migration (Q-SA-6). Its first statement is a warning: it **reopens anon and authenticated read, write, delete and truncate**, and **TL may run it only with the user's explicit authorization**. Run 2b's rollback before 2a's if both are reverted. Before running a rollback, compare its `GRANT ALL` with the saved pre-check Q2 rows. If they say `differs from ALL so adjust the rollback`, adjust it first.

### 2c acceptance (later)

- **2c probes:**
  - `increment_agent_stats` as the owner succeeds.
  - `aggregate_execution_model_usage` as the owner succeeds.
  - The `shared_agents` count is the same from any user.
  - The owner's `execution_routing_decisions` count is unchanged.
  - An insert with your own `user_id` and a foreign `agent_id` fails `WITH CHECK` (C-4).
  - An insert into `shared_agent_imports` as authenticated raises 42501, which is expected (SA ruling 2).
- **Route changes first:** the route changes must be deployed before `20261058` is applied (C-6).
- **Starting state (SA ruling Q-SA-1 condition, slice 1b workplan, 2026-10-13).** Full 2c's pre-guard must assume that exposed views slice 1b (`20261059`) and the 2c anon stopgap (`20261060`) are **already applied**, even if 2c's number sorts earlier. So it must not pin the Q6 grants above. Pin this state instead, and make 2c's rollback return to it, not to `GRANT ALL` to anon:
  - on the six tables, anon and PUBLIC hold none of the 8 privileges, and nothing on the sequences the tables own;
  - authenticated holds SELECT, INSERT, UPDATE and DELETE only (TRUNCATE, REFERENCES, TRIGGER and MAINTAIN were removed);
  - service_role is unchanged, and row security is still off;
  - `agent_executions_with_details` is `security_invoker = true` with no client grant.
  If the stopgap was never applied, the pre-guard refuses and Dev/SA decide; it must not silently accept both states.
- **Number:** `20261058` is **no longer free**. `origin/main` now holds `20261058_contact_documents_accept_scans_and_phone_photos.sql` (commit `a6990f77`, 2026-10-13). Full 2c takes the next free number when it is written (`20261061` or later; re-check every ref first), and every `20261058` reference to 2c in this workplan then needs updating.

---

## Prod fact queries (answered)

TL ran these read-only on 2026-10-11. The answers are in [Facts](#facts). They are kept here so the pre-check can reuse them.

**Q1. The six `token_usage` policies:**

```sql
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'token_usage'
ORDER BY policyname;
```

**Q2. Triggers on the 15 tables, and any trigger whose function mentions them:**

```sql
SELECT c.relname AS on_table, t.tgname, p.proname, p.prosecdef, pg_get_triggerdef(t.oid) AS trigger_def, p.prosrc
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND (c.relname IN ('agent_configurations','agent_executions','agent_job_fallback','agent_logs','agent_scheduler_state','agent_stats','ais_normalization_ranges','contact_messages','memory_config','message_replies','pricing_config','shared_agent_imports','shared_agents','storage_plans','token_usage')
       OR p.prosrc ~ '(agent_configurations|agent_executions|agent_job_fallback|agent_logs|agent_scheduler_state|agent_stats|ais_normalization_ranges|contact_messages|memory_config|message_replies|pricing_config|shared_agent_imports|shared_agents|storage_plans|token_usage)')
ORDER BY c.relname, t.tgname;
```

**Q3. Non-trigger functions whose body mentions the 15 tables:**

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       p.prosrc
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE p.prorettype <> 'trigger'::regtype
  AND p.prosrc ~ '(agent_configurations|agent_executions|agent_job_fallback|agent_logs|agent_scheduler_state|agent_stats|ais_normalization_ranges|contact_messages|memory_config|message_replies|pricing_config|shared_agent_imports|shared_agents|storage_plans|token_usage)'
ORDER BY p.proname;
```

**Q4. Views and materialized views that read the 15 tables:**

```sql
SELECT DISTINCT v.relname AS view_name, v.relkind, src.relname AS reads_table, v.reloptions,
       has_table_privilege('anon', v.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', v.oid, 'SELECT') AS auth_select
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class v ON v.oid = r.ev_class
JOIN pg_class src ON src.oid = d.refobjid
JOIN pg_namespace n ON n.oid = src.relnamespace AND n.nspname = 'public'
WHERE src.relname IN ('agent_configurations','agent_executions','agent_job_fallback','agent_logs','agent_scheduler_state','agent_stats','ais_normalization_ranges','contact_messages','memory_config','message_replies','pricing_config','shared_agent_imports','shared_agents','storage_plans','token_usage')
  AND v.oid <> src.oid
ORDER BY 1, 3;
```

**Q5. Policies on other tables that mention the 15 tables:**

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (coalesce(qual,'') || coalesce(with_check,'')) ~ '(agent_configurations|agent_executions|agent_job_fallback|agent_logs|agent_scheduler_state|agent_stats|ais_normalization_ranges|contact_messages|memory_config|message_replies|pricing_config|shared_agent_imports|shared_agents|storage_plans|token_usage)'
ORDER BY 1, 2;
```

**Q6. Privileges, grantors, owner and the force flag:**

```sql
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity,
       g.grantee, g.grantor, string_agg(g.privilege_type, ',' ORDER BY g.privilege_type) AS privs
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN information_schema.role_table_grants g ON g.table_schema = 'public' AND g.table_name = c.relname
WHERE c.relname IN ('agent_configurations','agent_executions','agent_job_fallback','agent_logs','agent_scheduler_state','agent_stats','ais_normalization_ranges','contact_messages','memory_config','message_replies','pricing_config','shared_agent_imports','shared_agents','storage_plans','token_usage')
GROUP BY 1,2,3,4,5,6
ORDER BY 1,5;
```

**Q7 / Q8** were NULL-owner counts per B table, row counts for the unknown tables, and `pg_publication_tables`. **Q9** was the 24 h API log by table and method.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Three agent-platform routes (`agents/[id]/metrics`, `shared-agents` POST, `shared-agents/exists`) run as `anon` on the server through browser-client repository defaults. They break once 2c revokes anon | Fixed in code in 2c (cookie client + `getUser`). They also trust an `x-user-id` header today, which the fix removes |
| R-2 | Invoker functions called with a client role hit the new RLS: `get_active_ais_ranges`, `increment_agent_stats`, `aggregate_execution_model_usage`, and the import-counter trigger (Q2/Q3). Without the privilege, the statement raises 42501 and fails the user's action (for the import counter, it aborts the tracking insert). With the privilege but no matching policy, an INSERT raises, an UPDATE changes 0 rows, and a read returns nothing | The caller audit sets the policies: `ais_normalization_ranges` gets authenticated SELECT; `agent_stats` gets owner SELECT, INSERT and UPDATE; `agent_executions` and `token_usage` get owner SELECT (+ UPDATE on executions). The import counter is Q-SA-2. The pre-guard pins the Q2 trigger set and the Q3 function list, so drift refuses |
| R-3 | Leaving the six `token_usage` policies as they are would keep duplicate policies `TO public` plus client UPDATE and DELETE. They are owner-scoped (Q1), so this is not an open hole | 2b drops all six by exact name and creates two. The post-assert checks the final policy set exactly |
| R-4 | The `execution_routing_decisions` SELECT policy subqueries `agent_executions` (Q5). Without an owner SELECT policy on `agent_executions`, that table goes dark for its owners | 2c keeps an owner SELECT policy on `agent_executions`; an acceptance probe compares the owner's count before and after |
| R-5 | The owner-rights views `agent_executions_with_details`, `daily_token_usage` and `monthly_token_usage` (Q4) keep returning every user's rows to anon after this slice. If slice 1b later sets `security_invoker = true`, they start honouring these policies | The two slices do not depend on each other's order. This slice does **not** close the view path. Flagged so 1b treats these three as urgent: once 2b is in, they are the only remaining anon read path to `token_usage` and `agent_executions` |
| R-6 | `app/admin/learning-system/page.tsx` reads all users' `token_usage` from the browser. After 2b it shows only the admin's own rows, so memory cost is under-reported | An agent-platform admin page. Options in Q-SA-3 |
| R-7 | `/v2/templates` would show an empty gallery to a signed-out visitor | Nothing links there signed out (middleware notes). Accepted unless SA disagrees |
| R-8 | A client path the grep missed. Q9 shows recent traffic on `token_usage` and `agent_executions` but cannot show the role | The acceptance step 7 log watch after 2b and 2c. The pre-check's function, policy and view scans cover the database side |
| R-9 | `token_usage` is written on every LLM call, so the `ALTER TABLE` in 2b could wait on a lock | `SET LOCAL lock_timeout = '5s'`; the transaction aborts cleanly and can be retried |
| R-10 | The duplicate `20261053` on main can confuse ordering tools | Flagged to TL; this slice's numbers do not depend on it |
| R-11 | The 2a rollback re-opens anon write and TRUNCATE on config tables | Use only if something verified breaks; see Q-SA-6 |

---

## Open questions for SA

- **Q-SA-1 (2c route fix).** Is converting the three anon-on-server routes to the cookie client (and dropping the `x-user-id` trust) in scope for 2c? The alternative is to inject `supabaseServer` and leave the routes otherwise untouched. That is smaller, but it keeps the header IDOR and moves those routes onto the service role, which I would rather not do.
- **Q-SA-2 (`shared_agents` import counter).** Q2 confirms `increment_shared_agent_import_count()` is invoker, so under 2c it raises 42501 and the tracking row is lost (corrected by SA, ruling 2). Prod has 0 shared agents and 0 imports. The options are:
  - (a) accept that the counter stops, and record it;
  - (b) a broad UPDATE policy, which cannot be limited to one column and would let any signed-in user edit any shared agent;
  - (c) make that trigger function definer-rights with EXECUTE revoked, the slice 5 pattern.

  I recommend (a) now and (c) only if sharing comes back into use. (c) would also need the slice 6 surface guard's allowlist.
- **Q-SA-3 (admin learning-system page).** Accept the degradation, or add an admin SELECT policy `USING (public.is_platform_admin())` on `token_usage`? The second adds a per-row function call on a 30k-row table that the BOS paths do not need.
- **Q-SA-4 (slicing).** Three slices (2a / 2b `token_usage` / 2c agent tables), or merge 2a and 2b now that Q1 shows `token_usage` is low risk?
- **Q-SA-5 (authenticated verbs).** Least privilege per table, as proposed (no DELETE anywhere; `shared_agent_imports` INSERT + SELECT only)? Or a uniform owner ALL policy?
- **Q-SA-6 (2a rollback).** Since the pre-state is "anyone can write and truncate", should the 2a rollback restore the full Q6 grants? Or should it be a narrower emergency path, such as re-granting only SELECT to authenticated?
- **Q-SA-7 (invoker function EXECUTE).** Should revoking anon EXECUTE on the Q3 invoker functions (`get_pricing_config`, `get_active_ais_ranges`, `update_dynamic_ais_ranges`, `set_memory_expiration`, `increment_agent_stats`, `update_agent_stats`, `aggregate_execution_model_usage`) ride along? Or does it stay out of scope? Once the tables are locked they leak nothing.

---

## Ownership boundaries

This slice does **not** touch any of the following. The static test asserts none of them is named.

| Owner | Objects |
|---|---|
| Pilot routing history session | `pilot_step_routing_history`, and the views `pilot_routing_performance`, `pilot_step_type_analysis`, `pilot_tier_distribution` |
| Price review slice 2 | `ai_model_pricing`, `pilot_cost_savings_summary` |
| Not-ours `true`-policy follow-ups | `workflow_step_executions`, `agent_memories`, `execution_insights` |
| Exposed views slice 1a / 1b | all views, including `agent_executions_with_details`, `daily_token_usage` and `monthly_token_usage` (R-5) |
| Already closed | `processed_webhook_events` (RLS off, no client grants) |

---

## SA Review Notes

**Reviewed by SA — 2026-10-11** (re-verified on `origin/main` @ `d1bc95e2`)
**Status:** ✅ Approved with conditions

### Independent verification

| # | Claim | Result |
|---|---|---|
| V-1 | The 7 category A tables have no client-role reader or writer | **Confirmed.** `/api/contact` inserts with a module-level service-role client. Admin messages and reward-config use service role behind `requireAdmin`. `MemoryConfigService.updateConfig` (the only `memory_config` touch) and `StorageService.getStoragePlans` have no callers. All config reads go to `system_settings_config`. `get_pricing_config` and `set_memory_expiration` have no code caller. `update_dynamic_ais_ranges` is called only from admin ais-config, as service role. `/api/pricing/ais-ranges` and `/api/pricing/config` both use service role. No `'use client'` file, hook or Edge Function names an A table |
| V-2 | `ais_normalization_ranges` needs an authenticated read and no anon read | **Confirmed.** `AISConfigService.getRanges` → `get_active_ais_ranges` with the run-agent / WorkflowPilot cookie client. The public pricing route reads it server-side as service role. No browser caller exists |
| V-3 | `token_usage` client roles | **Confirmed.** The only client-role writer is `StepExecutor.ts:918`: a cookie-client insert with `user_id = context.userId`, which is the session user, and no `.select()`. Client-role readers are `useAnalyticsData` (browser), `TokenReconciliationService`, `updateAgentIntensity` and the `aggregate_*` invoker. Every `AIAnalyticsService` construction is service role or no client. `TokenUsageRepository` defaults to `supabaseServer`. No client role updates or deletes |
| V-4 | Owner-policy design for the 6 agent tables | **Confirmed, with two corrections** (C-4, C-5). `agent-stream` and run-agent take `user_id` from `getUser()`. The `useAgentSandbox` upsert and `increment_agent_stats` both need SELECT + INSERT + UPDATE. Small inaccuracy: the `agents/[id]` DELETE handler counts executions with a **service-role** module client, not the cookie client. That is harmless |
| V-5 | The 3 routes in 2c run as anon and trust `x-user-id` | **Confirmed, and worse than stated.** `ExecutionRepository` and `SharedAgentRepository` default to the browser client, so they run as anon. `AgentRepository` defaults to **service role**. So `agentRepository.findById(agentId, <header id>)` is a service-role ownership check fed by a caller-chosen id, and the middleware does not strip the header. Today an **unauthenticated** caller can read any agent's metrics, and can publish any user's agent to the gallery under that user's id. `lib/client/agent-api.ts` sets the header from the browser. No other server file uses an anon-default singleton on these tables. `agentExecutionEngine.ts` imports the browser client, but it is dead code with no importer |

### Rulings on open questions

1. **Q-SA-1: in scope, and required.** Each route uses `createAuthenticatedServerClient().auth.getUser()` (401 when there is no user), and passes that cookie client to `ExecutionRepository`, `SharedAgentRepository` **and** `AgentRepository`. At minimum, `findById` must receive the verified `user.id`, never a header value. Add Zod on the path, query and body. Do not move the routes to `supabaseServer`. The browser can keep sending the header; the server ignores it.
2. **Q-SA-2: option (a), but correct the stated effect.** The plan grants authenticated no UPDATE on `shared_agents`, so the invoker trigger's `UPDATE shared_agents` raises **42501**. It does not update 0 rows. That aborts the `shared_agent_imports` INSERT as well, so both the counter and the tracking row are lost. The import itself still succeeds, because the import-shared route and the `(protected)/templates` page both treat tracking as best-effort (I checked both). Accept this while sharing is dormant (0 rows). Do **not** add an UPDATE grant or policy just to make the trigger fail silently. Record option (c), the slice 5 definer-trigger pattern, as a prerequisite for re-enabling sharing. Add an acceptance probe: as authenticated, an insert into `shared_agent_imports` raises 42501 inside `BEGIN … ROLLBACK`, and the probe text documents that this is expected.
3. **Q-SA-3: accept the degradation; no admin policy.** The page should not read cross-tenant data from the browser in the first place. The fix is a `requireAdmin` API route on the service role, recorded as an agent-platform follow-up.
4. **Q-SA-4: keep 2a and 2b as separate migration files and separate apply steps.** They may ship in **one PR**. Apply 2a first, and 2b only after the 2a checker passes. A lock timeout on hot `token_usage` must not roll back or delay closing the writable config tables. 2c stays separate.
5. **Q-SA-5: least privilege per verb, as proposed. No owner ALL, no DELETE anywhere.** On `shared_agent_imports`, grant **INSERT only**: both inserts are return-minimal, and the one reader (`AgentScoreService.getUniqueImporterCount`) has no caller.
6. **Q-SA-6: the rollback is the exact inverse of the migration.** It restores the full Q6 grants and, for 2b, the six Q1 policies **verbatim** (`TO public`, unwrapped `auth.uid()`), checked against the saved pre-check output. Do not write a partial rollback. Its header must say that it re-opens anon write and TRUNCATE, and that TL may run it only with the user's explicit authorization. A narrower emergency measure would be a forward fix, written when it is needed.
7. **Q-SA-7: out of scope.** Once the tables are locked, an invoker function gains nothing from anon EXECUTE. Record it as a tidy-up follow-up.

### Conditions (all must be met before the code review passes)

1. **C-1, numbering.** `origin/main` now holds `20261055_pilot_step_routing_history_rls_lockdown.sql` (PR #308 resolved the duplicate 20261053 by renumbering it). This work therefore starts at **`20261056`** (2a), `20261057` (2b) and `20261058` (2c). Re-check at PR time and again just before merge.
2. **C-2, privilege asserts.** Post-asserts and checkers use `has_table_privilege` for SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and **MAINTAIN** for PUBLIC, anon and authenticated, as `20261055_pilot_step_routing_history` does. Prod is PG17, and `information_schema` hides MAINTAIN. Also assert that **no column-level ACL** exists (`pg_attribute.attacl IS NULL` for every non-dropped column, or no anon/authenticated/PUBLIC entry in it). `REVOKE ALL ON TABLE` does not remove column grants, and Q6 could not have seen them.
3. **C-3, pin the 2b pre-guard.** Pin the six Q1 policies by name, cmd, roles, permissive, and `md5(qual)` / `md5(with_check)`, in the same style as 20261055. Pin the 2c pre-guard the same way for the `execution_routing_decisions` policy (Q5).
4. **C-4, agent-keyed WITH CHECK.** On INSERT and UPDATE for `agent_executions`, `agent_stats`, `agent_logs` and `agent_configurations`, `WITH CHECK` also requires that the caller owns `agent_id`: `(SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = agent_id AND a.user_id = (SELECT auth.uid()))`. Without this, a user could create rows against another tenant's agent id, and the gallery exposes `original_agent_id`. Two cases matter: `agent_stats` is unique on `agent_id`, so an attacker could squat it and break the victim's `increment_agent_stats`; and service-role readers such as `agents/[id]/executions` filter only by `agent_id`. **Prerequisite:** TL captures the `agents` policies for authenticated (read-only). If the owner SELECT policy on `agents` is anything other than a plain owner predicate, Dev documents it and SA re-rules. Add a negative probe: inserting with your own `user_id` and a foreign `agent_id` fails `WITH CHECK`. `token_usage` (2b) stays owner-only, since BOS rows have a NULL `agent_id`. Record a follow-up on its caller-supplied `execution_id`.
5. **C-5, Q-SA-2 wording.** Correct the "silently updates 0 rows" text in Facts Q2, the caller audit and R-2, as in ruling 2.
6. **C-6, 2c deploy order.** Deploy the three route changes to production **before** TL applies `20261058`. The cookie-client version works under both the old and the new grants. Add integration tests for: happy path, 401 with no session, 400 on invalid input, and a forged `x-user-id` ignored (the result is scoped to the session user).
7. **C-7, extend the static guard.** It should also assert that no non-`'use client'` file under `app/` or `lib/` imports the anon-default singletons `executionRepository` or `sharedAgentRepository`, so the R-1 class cannot come back silently after 2c.
8. **C-8, lock_timeout in every slice.** Put `SET LOCAL lock_timeout = '5s'` in **all three** migrations, not only 2b. `agent_executions` and `agent_stats` are written on every run, and ENABLE RLS and CREATE/DROP POLICY take ACCESS EXCLUSIVE.
9. **C-9, never FORCE.** Never FORCE RLS. The pre-guard refuses if `relforcerowsecurity` is already true, and the post-assert checks that it is still false. The cleanup and purge paths run as owner.
10. **C-10, paste rules.** Paste rules apply to every pasted file (migration, pre-check, checker, rollback). The static test enforces them on all four, not only the migration.
11. **C-11, remaining view path.** The PR body and the Change History must state that `daily_token_usage`, `monthly_token_usage` and `agent_executions_with_details` still expose every row to anon until slice 1b. TL must schedule those three as 1b's first item.

### Optimisation Suggestions

- After 2c, consider changing the default client of `ExecutionRepository` and `SharedAgentRepository` to "client required", in a later slice. The default browser client on a server-importable repository is the R-1 trap.
- `getRanges` treats an empty array as success. A positive probe for 2a already covers this, so no change is needed.
- The A-table sequences, if any, keep their anon USAGE. This is harmless, because PostgREST does not expose sequences. Leave them.

### Approval
[x] Workplan approved with conditions C-1 to C-11. Proceed to implementation of 2a (and 2b in the same PR if ready). C-4's prerequisite capture must land before 2c SQL is written.

**Code Review by SA (2026-10-11)**
**Status:** ✅ Code Approved, with nits (2a `20261056` and 2b `20261057` only; 2c not reviewed)

#### Conditions verified in code

| Condition | Result |
|---|---|
| C-1 numbering | 20261056 and 20261057, free on `origin/main` @ d1bc95e2. Re-check at PR time and before merge |
| C-2 privilege asserts | The post-asserts use `has_table_privilege` for all 8 privileges, MAINTAIN included. PUBLIC is checked through `aclexplode(relacl)` with grantee 0, which is equivalent. Column ACLs (`attacl IS NOT NULL`) are refused before the change and asserted absent after it. The checkers cover the same |
| C-3 2b pins | All six policies are pinned by name, cmd, `roles = {public}`, PERMISSIVE, and `md5(qual)`/`md5(with_check)`, with NULL asserted on the other side. Count = 6. I recomputed the md5 of `(auth.uid() = user_id)`: it is `19300d15…586c`. `pg_policies.qual` and `with_check` are `pg_get_expr(polqual/polwithcheck, polrelid)`, and that format is the one in TL's Q1 capture. The migration, the pre-check and the rollback all hash `pg_policies.*`, so the comparison is consistent. `b326b506…cb09` = md5('true') is also correct |
| C-8 lock_timeout | `SET LOCAL lock_timeout = '5s'` inside BEGIN in both migrations and both rollbacks |
| C-9 never FORCE | The pre-guard refuses if `relforcerowsecurity` is set, and the post-assert requires it to be false. The static test forbids FORCE |
| C-10 paste rules | Enforced on all 8 files: no `--` or `/*`, no "into", balanced quotes, and literals limited to `[A-Za-z0-9_ ]`. Hex md5 pins fit that set. Policy names with spaces are double-quoted identifiers, outside the literal rule, so the rule allows exactly what is needed and nothing more |
| C-11 views | Recorded in Change History, and the 2b checker reports the three views. The PR body must repeat it (RM) |

#### PostgreSQL desk check

- **2a.** ENABLE RLS, REVOKE ALL from PUBLIC, anon and authenticated, then GRANT ALL to service_role on the seven A tables. `ais_normalization_ranges` additionally gets `GRANT SELECT TO authenticated` and one PERMISSIVE SELECT policy `TO authenticated USING (true)`. Correct.
- **2b.** The order is: pre-guard, DROP the six policies, ENABLE RLS, REVOKE, `GRANT SELECT, INSERT TO authenticated`, ALL to service_role, then the two owner policies with `(SELECT auth.uid())` and `TO authenticated`. Correct, and all of it is in one transaction. The service role keeps BYPASSRLS, so the BOS readers and writers are unaffected. FK cascades from `auth.users` are RI actions, which RLS does not apply to.
- **Rollbacks.** Each is an exact inverse with a warning row:
  - 2b re-creates the six policies verbatim (TO public, the same cmd, unwrapped `auth.uid()`) and asserts them against the same md5 pins.
  - 2a re-grants ALL to anon and authenticated. PUBLIC is not re-granted, which matches Q6 (PUBLIC held nothing).

#### Client-role caller check (token_usage after 2b)

- **No client-role UPDATE or DELETE exists.** Searching `lib/`, `app/`, `components/` and the SQL in the repo finds no `.update`/`.delete`/`.upsert` on `token_usage`:
  - `TokenReconciliationService:78` only SELECTs, filtered by `execution_id`.
  - `updateAgentIntensity` (365 and 447) only SELECTs.
  - `aggregate_execution_model_usage` reads `token_usage` and writes `agent_executions`, which is 2c's concern.
  - The only `UPDATE`/`DELETE token_usage` text is in operator scripts (`scripts/analyze-pricing-discrepancies.ts` and `delete-duplicate-agents.ts`). Those print SQL for the SQL editor, which runs as postgres.
- **Every `AIAnalyticsService` construction with a client uses the service-role key.** That covers the provider factory, the agent-creation routes, analyze-*, enhance-prompt, clarification questions, help-bot-v2, the generate-agent-v* routes and `turnUsage`. The `.insert().select()` RETURNING path is therefore unaffected.
- **The one client-role writer is `StepExecutor.ts:918`.** It inserts `user_id: context.userId` under the cookie client, which passes the owner `WITH CHECK` whenever the run belongs to the session user.

#### Code Review Comments

1. `lib/pilot/StepExecutor.ts:918`: the insert result's `error` is never read. Before 2b, an insert with a mismatched `user_id` could not fail. After 2b it fails with 42501 **silently**: there is no log, and the row is lost. That can only happen if `context.userId` ≠ the session user under a cookie client, and I found no such path. But the failure would be invisible. **Follow-up (backlog, not blocking):** check `error` and log it with `logger.warn({ err })`. Priority: Low.
2. `supabase/migrations/20261057_rls_disabled_tables_slice2b_token_usage.sql:417-418, 433-434`: the post-assert matches the new policies with `strpos(... 'SELECT auth')` and `strpos(... 'user_id')`, which is looser than the md5 pins used everywhere else. A predicate such as `(SELECT auth.uid()) <> user_id` would pass it. **Nit:** pin `md5()` of the PG17 rendering, which is `( SELECT auth.uid() AS uid) = user_id`. Capture the exact text from the PGlite dry run, and pin it in the checker too. Priority: Low.
3. Both rollbacks (`20261056_..._rollback.sql:56+` and `20261057_..._rollback.sql:64-66`): `GRANT ALL` restores MAINTAIN to anon and authenticated. Q6 (information_schema) could not show whether they held MAINTAIN before. The pre-checks report it through `has_table_privilege`, so **TL must keep the pre-check output as the record**. If the pre-check shows MAINTAIN absent, the rollback over-grants by one privilege. Accepted as is: the warning row already gates its use. Priority: Low.
4. R-6 (`app/admin/learning-system/page.tsx`) degrades to the admin's own rows after 2b. This is accepted per Q-SA-3, and the follow-up row exists. Mention it in the PR body next to C-11. Priority: Low.

#### Tests run by SA

- `npx jest supabase/migrations/__tests__/rls-disabled-tables-slice2.migration.test.ts`: 103/103 pass.
- `npm run test:authz-guard`: 203/203 pass.

#### Code Approved for QA: Yes
Items 1–4 are nits or follow-ups and do not block. If Dev takes nit 2, re-run the static test and the PGlite dry run, and record the new pin in the workplan.

---

## Follow-ups recorded (not in this PR)

| Item | Source | Owner |
|---|---|---|
| **The view path stays open until 1b (C-11).** `daily_token_usage`, `monthly_token_usage` and `agent_executions_with_details` are owner-rights views that still expose every row to anon after 2b. They must be the first item of exposed views slice 1b, and the PR body must say so | Q4, C-11 | TL schedules |
| `app/admin/learning-system/page.tsx` reads `token_usage` cross-tenant from the browser, and after 2b sees only the admin's own rows. Move that read to a `requireAdmin` route on the service role | Q-SA-3 | agent-platform backlog |
| Revoke anon EXECUTE on the Q3 invoker functions. This is a tidy-up only: once the tables are locked they leak nothing | Q-SA-7 | backlog |
| `StepExecutor`'s `token_usage` insert takes `execution_id` from the caller. It stays owner-only in 2b, because BOS rows have a NULL `agent_id` | C-4 | backlog |
| Re-enabling agent sharing needs the import counter trigger turned into a definer-rights function with EXECUTE revoked (slice 5 pattern) | SA ruling 2 | prerequisite for sharing |
| After 2c, make `ExecutionRepository` and `SharedAgentRepository` require a client instead of defaulting to the browser client | SA optimisation | later slice |
| `lib/pilot/StepExecutor.ts:918` never reads the `error` of its `token_usage` insert. After 2b, an insert whose `user_id` is not the session user would fail with 42501 silently. No such path exists today. Fix: check `error` and log it with `logger.warn({ err })`. Priority: low | SA code review nit 1 | agent-platform backlog |

### SA code review nits: disposition

| Nit | Disposition |
|---|---|
| 1. The `StepExecutor.ts:918` insert error is never checked | Recorded as a backlog follow-up (table above). Not in this PR |
| 2. Loose `strpos` match in the 2b post-assert | **Applied.** The 2b post-assert and the 2b checker now pin both new policies by md5 of the exact PG 17 rendering as `pg_policies` shows it. PGlite 17.5 renders it as `(( SELECT auth.uid() AS uid) = user_id)`: note the outer parentheses, which differ from the text in the nit. The md5 is **`ff452c766f1dd1d84c376129b36406c1`**. `token_usage_owner_select` pins `qual` with `with_check IS NULL`. `token_usage_owner_insert` pins `with_check` with `qual IS NULL`. The static test asserts the pin and that neither file contains `strpos` any more. Re-run: static 103/103, authz guard 203/203. PGlite 2b dry run: applied, checker `PASS 11 pass 0 fail` (C3 and C4 PASS), owner probes as before, rollback round trip exact (pre-check CLEAN again, six pins match) |
| 3. The rollbacks restore MAINTAIN unconditionally | Accepted. **The pre-check output is the MAINTAIN record.** TL ran the 2a pre-check on prod on 2026-10-11 and got CLEAN:<br>• on all 8 tables, anon, authenticated and service_role each hold 8 of 8, MAINTAIN included<br>• PUBLIC holds none, and the only grantor is postgres<br>• 0 column ACLs and 0 policies<br>• no dependent views and no other policies naming these tables<br>• `server_version_num` 170004<br>For 2b, all six `token_usage` policies match pin `19300d155780585259ede73ac370586c`. So the `GRANT ALL` in each rollback restores exactly the captured state |
| 4. R-6 belongs in the PR body | Accepted. **PR body notes (RM):**<br>(a) C-11: `daily_token_usage`, `monthly_token_usage` and `agent_executions_with_details` still expose every row to anon until slice 1b, which must take them first.<br>(b) R-6 / Q-SA-3: after 2b, `app/admin/learning-system/page.tsx` shows only the admin's own `token_usage` rows. Accepted; the fix is a `requireAdmin` route (follow-up) |

---

## QA Testing Report

### Prod apply and acceptance (TL via the Supabase connector, user-authorized, 2026-10-12)

Pre-checks were run read-only by TL on 2026-10-11/12 before apply: 2a CLEAN (8 tables owner postgres, RLS off, anon/authenticated/service_role 8 of 8 incl. MAINTAIN, PUBLIC none, grantor postgres, 0 column ACLs, 0 policies, no dependent views or foreign policies, `server_version_num` 170004); 2b all six legacy `token_usage` policies matched pin `19300d155780585259ede73ac370586c`.

| Step | Result |
|---|---|
| 2a migration `20261056` | Applied from the committed file; pre-guard and post-assert passed |
| 2a checker | `VERDICT PASS 64 pass 0 fail` |
| anon SELECT `pricing_config` | `42501 permission denied for table` |
| authenticated SELECT `contact_messages` | `42501 permission denied for table` |
| authenticated SELECT `ais_normalization_ranges`, direct and via `get_active_ais_ranges()` | 23 rows both ways |
| 2b migration `20261057` | Applied; post-assert passed incl. the new-policy pin `ff452c766f1dd1d84c376129b36406c1` (prod rendering matches PGlite) |
| 2b checker | PASS (post-assert covers C1–C8; 11/0 by construction) |
| anon SELECT `token_usage` | `42501 permission denied for table` |
| authenticated as the largest-usage real user (`request.jwt.claims`) | sees 15,124 rows = that user's service-role count, of 29,659 total; 1 distinct user visible |
| same user INSERT for another user_id | `42501 new row violates row-level security policy` |
| same user INSERT for own user_id (the StepExecutor path) | accepted, rolled back |

**Verdict:** PASS. The view path (C-11) remains open until exposed-views slice 1b.


---

## Commit Info

PR #313: commit `762caf28` (2a + 2b package), merge with main `be1e59f5`; merged to main as `08722970` on 2026-10-12.


---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | Investigation and workplan for the 15 RLS-disabled tables: per-table readers and runtime roles, categories, proposed slices 2a/2b/2c (20261055–57), the prod queries for TL, risks and SA questions. No SQL written |
| 2026-10-11 | TL's Q1–Q9 folded in | Count confirmed at 15. `token_usage`'s six policies are owner-scoped (replace and dedupe, drop UPDATE/DELETE). Only `updated_at` triggers, plus an invoker import counter on `shared_agent_imports` (Q-SA-2). Caller audit of the invoker functions: `get_active_ais_ranges` is called with the cookie client on agent runs, so `ais_normalization_ranges` moves from A to authenticated read-only (still in 2a); `increment_agent_stats`'s upsert needs owner SELECT/INSERT/UPDATE on `agent_stats`. Views from Q4 noted for 1b. Q5 confirmed. Row counts updated (0 NULL owners; `contact_messages` and `message_replies` empty). Added Q-SA-7 and R-11 |
| 2026-10-11 | SA workplan review | Approved with conditions C-1 to C-11. Numbering moves to 20261056/57/58, because #308 took 20261055. Asserts must cover MAINTAIN and column ACLs. 2b policies pinned by md5. Agent-ownership WITH CHECK on the 4 agent-keyed tables. Q-SA-2 effect corrected (the trigger raises 42501, so the tracking row is lost too). Route code ships before 2c is applied. lock_timeout in every slice. Rulings on Q-SA-1 to Q-SA-7 recorded |
| 2026-10-11 | 2a and 2b implemented (uncommitted) | Merged `origin/main` @ `d1bc95e2` (PR #308). Recorded TL's C-4 capture of the `agents` policies (plain owner predicates). Fixed the C-5 wording. Wrote migrations `20261056` (2a: 7 server-only tables + read-only `ais_normalization_ranges`) and `20261057` (2b: `token_usage`), with pre-checks, checkers, rollbacks (exact inverses with a warning) and one static test (103 tests). Local PGlite (PG 17.5) dry run: pre-checks CLEAN, checkers PASS 64/0 and 11/0, every probe as expected, rollback round trip exact, drift refused. **C-11: `daily_token_usage`, `monthly_token_usage` and `agent_executions_with_details` still expose all rows to anon until slice 1b, which must take them first.** 2c (`20261058`) not started; its route code ships first (C-6) |
| 2026-10-11 | SA code review (2a, 2b) | Code approved with nits. C-1 to C-3 and C-8 to C-11 verified in the code. The md5 pins were recomputed and confirmed consistent with `pg_policies` (pg_get_expr). No client-role UPDATE or DELETE on `token_usage` found. Static test 103/103 and authz guard 203/203 pass. Nits: the StepExecutor insert error is unchecked (follow-up); pin the new policies by md5 in the post-assert; the rollbacks restore MAINTAIN unconditionally; R-6 goes in the PR body |
| 2026-10-11 | SA nits handled | Nit 2 applied: the 2b post-assert and the 2b checker now pin both owner policies by md5 `ff452c766f1dd1d84c376129b36406c1`, which is the md5 of `(( SELECT auth.uid() AS uid) = user_id)`, the PG 17 rendering, with the other side NULL. Static test 103/103, authz guard 203/203, PGlite 2b dry run PASS 11/0 with an exact rollback round trip. Nit 1 is a backlog follow-up. Nit 3: TL's prod 2a pre-check (CLEAN; 8 of 8 incl. MAINTAIN for anon, authenticated and service_role on all 8 tables; PUBLIC none; grantor postgres; no column ACLs or policies; `server_version_num` 170004) and the 2b pins (all six match `19300d15…586c`) are the MAINTAIN record. Nit 4: PR-body notes for C-11 and R-6 recorded |
| 2026-10-12 | 2a and 2b applied and merged (TL) | Applied on prod by TL via the Supabase connector with the user's authorization, in order 2a then 2b; checkers 64/0 and 11/0; anon refusals, ais read-only, token_usage owner visibility and cross-user insert refusal proven (QA section). PR #313 merged `08722970`. Next: exposed-views slice 1b, then 2c (`20261058`) |
| 2026-10-13 | 2c starting state noted | The 2c anon stopgap (`20261060`, written in the slice 1b workplan, not applied) and slice 1b (`20261059`) are to be applied before full 2c. Recorded in 2c acceptance that full 2c's pre-guard must assume both are applied (SA ruling Q-SA-1 condition), and that `20261058` is now taken on main, so 2c needs a new number |
