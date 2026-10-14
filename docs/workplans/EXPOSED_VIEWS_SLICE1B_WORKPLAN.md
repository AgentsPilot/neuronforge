# Workplan: Exposed views slice 1b (the remaining 13 owner-rights views)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Branch:** none yet. The work sits uncommitted in the agent worktree (`worktree-agent-aeed26cea46ccc750`, off `origin/main` @ `8014ee73`). RM must create `fix/exposed-views-slice-1b` before commit (see Q-SA-7).
**Requirement:** none. This is a security fix commissioned by TL from prod measurements, the same footing as slice 1a (PR #306) and RLS slice 2 (PR #313), so no BA requirement was written.
**Date:** 2026-10-13
**Status:** 1b (`20261059`) APPLIED to production 2026-10-13, checker PASS 104/0 (uncommitted). 2c anon stopgap (`20261060`) APPLIED to production (pre-check CLEAN 2026-10-13, checker PASS 60/0 on 2026-10-14; SC-1 to SC-4 done). Both uncommitted; QA probes, commit/PR and 24 h log watch still owed

## Overview

**Severity: P0.** Supabase's security advisor emailed the user on 2026-10-13. TL re-checked live the same day and found `security_definer_view` (ERROR) on 13 views in `public`. Each one runs with its owner's rights (owner `postgres`, `security_invoker` unset), and anon and authenticated hold SELECT, UPDATE and DELETE on each. The anon key ships in the browser bundle, so anyone can read every row these views return.

Three of them reopen what slice 2b closed. `monthly_token_usage` and `daily_token_usage` read `token_usage`, and `agent_executions_with_details` reads `agent_executions`. Because the views run as `postgres`, RLS on the base table does not apply. That is the C-11 item in the slice 2 workplan, which made these three 1b's first item.

This slice also answers a second question: whether a quick anon-only REVOKE on the six RLS-disabled tables of slice 2c could ship before the full owner-policy work. See [Slice 2c: anon-only stopgap assessment](#slice-2c-anon-only-stopgap-assessment).

## Table of Contents

1. [Migration number](#migration-number)
2. [Per-view analysis and decision](#per-view-analysis-and-decision)
3. [Why both controls](#why-both-controls)
4. [What could break, and why it does not](#what-could-break-and-why-it-does-not)
5. [Approach](#approach)
6. [Files](#files)
7. [Task list](#task-list)
8. [Apply order and acceptance](#apply-order-and-acceptance)
9. [Rollback](#rollback)
10. [Risks](#risks)
11. [Slice 2c: anon-only stopgap assessment](#slice-2c-anon-only-stopgap-assessment)
12. [Open questions for SA](#open-questions-for-sa)
13. [Ownership boundaries](#ownership-boundaries)
14. [Follow-ups](#follow-ups)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## Migration number

**This slice uses `20261059`.**

| Number | Holder |
|---|---|
| `20261054` | slice 1a (applied, PR #306) |
| `20261055` | pilot routing history RLS (applied, PR #308) |
| `20261056`, `20261057` | RLS slice 2a and 2b (applied, PR #313) |
| `20261058` | **earmarked for RLS slice 2c** (`RLS_DISABLED_TABLES_SLICE2_WORKPLAN.md`, SA condition C-1, the Files table, the task list and C-6). Not written yet |
| `20261059` | **this slice** |

Checked on 2026-10-13 after `git fetch`: `git log --remotes -- supabase/migrations/2026*` lists nothing above `20261057` on any remote branch. The only text that names `20261058` is the slice 2 workplan, which reserves it for 2c. The unmerged `origin/docs/exposure-lockdown-status` (8d187b58) changes only that workplan's status lines and claims no new number.

Ordering: 1b (`20261059`) will probably be applied before 2c (`20261058`). Every migration here is pasted by hand, and the two touch disjoint objects (13 views here, 6 tables there), so the order does not matter to the database. Q-SA-1 asks SA whether to accept that or swap the numbers.

---

## Per-view analysis and decision

**Readers.** `git grep -w` across `app/ lib/ components/ hooks/ scripts/ supabase/` (including `supabase/functions/`) for every view name, plus a search for dynamic `.from(variable)` calls and raw `/rest/v1/` or GraphQL calls. Only **two** code readers exist across all 13 views.

| # | View | Base relation (repo source, or inferred) | Code readers | Client role | Decision |
|---|---|---|---|---|---|
| 1 | `monthly_token_usage` | `token_usage` (dashboard-created, not in migrations; 326 rows per the finance live-schema note) | **none**. `lib/business-os/finance/__tests__/finance.source.guard.test.ts` forbids it in finance code today. The finance requirement (SA-Q4) names it as a possible *future* service-role read | n/a | invoker + revoke |
| 2 | `daily_token_usage` | `token_usage` (dashboard-created; 1,378 rows) | **none** | n/a | invoker + revoke |
| 3 | `agent_executions_with_details` | `agent_executions`, which still has RLS off (2c), plus probably `agents` (dashboard-created) | **none**. `scripts/bizql-coverage.ts` only classifies the name by regex, as service role | n/a | invoker + revoke |
| 4 | `agent_memory_stats` | memory tables (dashboard-created; docs only) | **none** from client code. `scripts/delete-duplicate-agents.ts` prints SQL for the editor (runs as postgres), and its `fallbackDeletion()` also calls `.from('agent_memory_stats').delete()` over the API with the service-role key. That call is unaffected: service_role's privileges on the view do not change, and an aggregate view cannot be deleted from anyway, so the script already logs the failure and carries on (SA S-2) | service role (fallback only) | invoker + revoke |
| 5 | `calculator_config` | `ais_system_config` (`supabase/SQL Scripts/20251117_complete_quota_system.sql`) | **`app/api/pricing/config/route.ts` GET**, which serves `components/billing/PilotCreditCalculator.tsx`, `components/marketing/DevelopmentVsAgentsPilotCalculator.tsx` and `app/admin/agentspilot-billing/page.tsx` | **service role** (`createClient(url, SUPABASE_SERVICE_ROLE_KEY)`) | invoker + revoke. service_role keeps SELECT, and the migration proves it can still read through the invoker view |
| 6 | `agent_intensity_distribution` | `agent_intensity_metrics` (dashboard-created; docs only) | **none** | n/a | invoker + revoke |
| 7 | `top_complex_agents` | `agent_intensity_metrics`, probably with `agents` | **none** | n/a | invoker + revoke |
| 8 | `token_prediction_accuracy` | `workflow_step_executions` (`docs/PLATFORM_OPTIMIZATION_MASTER_PLAN.md`) | **none** | n/a | invoker + revoke |
| 9 | `calibration_success_metrics` | `calibration_history` (`20260428_calibration_history_table.sql`) | `CalibrationHistoryRepository.getSuccessMetrics`, which has **no caller**. The two repository users in `v2/calibrate/batch` never call it | would be the caller's client | invoker + revoke |
| 10 | `production_workflow_health` | calibration tables (dashboard-created; docs only) | **none** | n/a | invoker + revoke |
| 11 | `v6_quality_trends` | calibration tables (dashboard-created; docs only) | **none** | n/a | invoker + revoke |
| 12 | `error_pattern_summary` | `error_patterns` (`20260629_error_patterns_table.sql`) | **none** | n/a | invoker + revoke |
| 13 | `website_analytics_summary` | `website_page_views`, which has RLS on with an owner SELECT policy (`20260731_add_website_page_views.sql`, which also granted authenticated SELECT on the view on purpose) | **none**. `WebsiteAnalyticsRepository.ts:542` documents that the view is *not* used, because it is not a drop-in | n/a | invoker + revoke |

Base relations marked "inferred" are confirmed by pre-check Q10, which lists every relation each view reads and whether service_role can read it.

---

## Why both controls

**Revoke (the fix).** No code reads any of the 13 views as anon or authenticated, so least privilege means no client privilege. Only the revoke closes the leak today:

- `agent_executions_with_details` reads `agent_executions`, which has **RLS off** until 2c. With invoker alone, anon would still read every row, because anon holds ALL on `agent_executions` today.
- Seven views aggregate platform-wide data (rows 6–12). With invoker alone, a signed-in user would still see the aggregate wherever the base table has no owner RLS.
- `REVOKE ALL` (not a list) also removes UPDATE, DELETE and, on PG17, MAINTAIN. Q13 of the pre-check reports whether any view was auto-updatable, which would have let anon write base rows through it as `postgres`. That goes in the incident record.

**`security_invoker = true` (defence in depth).** It costs nothing at runtime: service_role bypasses RLS and holds SELECT on the base tables, and the pre-guard plus the in-migration probe prove it. It covers the regressions the revoke does not:

- **A future re-grant.** `20260731` granted authenticated SELECT on `website_analytics_summary` deliberately. If someone does that again, an invoker view honours the base table's RLS instead of reading as `postgres`.
- **The advisor's own criterion.** The lint is about views without `security_invoker`. TL's 2026-10-13 list leaves out the 1a views and the four pilot views, which were only revoked, so revoke alone looks enough to clear the lint. Invoker clears it whatever the lint does with grants.

The two controls fail in different ways, which is why both are worth having:

- `CREATE OR REPLACE VIEW` keeps grants, but PostgreSQL replaces the view's options with whatever the new statement lists. A replace without `WITH (security_invoker = true)` silently drops it, and the revoke still holds.
- `DROP VIEW` + `CREATE VIEW` (the pattern in `supabase/SQL Scripts/20251117_*`) re-applies Supabase's default privileges, giving anon ALL again. Invoker then still limits the damage to what base RLS allows, as long as the new statement sets it.

Follow-up F-2 proposes a static guard over these.

---

## What could break, and why it does not

| Path | Role | Effect |
|---|---|---|
| `/api/pricing/config` → `calculator_config` (pricing calculator, marketing calculator, admin billing page) | service_role | **Unchanged.** service_role keeps SELECT on the view. Under invoker it needs SELECT on `ais_system_config`. The pre-guard refuses unless it has that (and schema USAGE, and EXECUTE on any function the view calls). The final DO block then runs `SELECT 1 FROM <view> LIMIT 1` for all 13 views **as service_role**, inside the migration's transaction. If any read fails, nothing is applied |
| Admin pages | — | No admin page or admin route reads any of the 13 views, with any client |
| `'use client'` pages and hooks | anon / authenticated | None names any of the 13 views |
| Business OS (chat planner, catalog, finance) | service role | No reader. `catalog.generated.ts` does not list these views. `generate-business-catalog.ts` and `bizql-coverage.ts` introspect with the service_role key, so the catalog does not drift |
| Scripts | service role / postgres | No script reads the views over the API. `delete-duplicate-agents.ts` prints SQL for the editor, which runs as postgres. Its `fallbackDeletion()` also sends `.from('agent_memory_stats').delete()` with the service-role key. That is unchanged: service_role keeps its privileges on the view, and the delete already fails because an aggregate view is not deletable, which the script logs before carrying on (SA S-2) |
| Supabase dashboard / SQL editor | postgres | postgres owns the base tables and RLS is never forced, so invoker does not narrow what it sees |
| Edge Function `run-scheduled-agents` | service role | touches only `agents` |
| pg_graphql | anon / authenticated | uses the same grants, so the revoke closes the GraphQL path too |
| Realtime | — | cannot publish views |

**Logging flag (CLAUDE.md).** `app/api/pricing/config/route.ts` has **22** `console.*` calls. This slice does not modify that file, so it is flagged here and not converted (follow-up F-4).

---

## Approach

The pattern is slice 1a's revoke, plus the pre-guard and lock timeout from slice 2a/2b (SA C-8). One transaction:

1. `SET LOCAL lock_timeout = '5s'`. `ALTER VIEW ... SET` takes an ACCESS EXCLUSIVE lock on the view. If a long read holds the view, the transaction aborts cleanly and can be re-run.
2. **Pre-guard DO block.** For each view, it refuses (raises "... so nothing was applied") unless all of these hold:
   - the view exists and is a plain view (`relkind = 'v'`)
   - its owner is `postgres`
   - `security_invoker` is **not set** (this pins the state the rollback restores)
   - it has no column-level ACL (`REVOKE ALL ON` a relation does not remove column grants, which was the C-2 lesson)
   - service_role can SELECT every base relation (and has USAGE on its schema) and can EXECUTE every non-builtin function the view's rewrite rule depends on
3. **Per view:** `ALTER VIEW ... SET (security_invoker = true)`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT SELECT ... TO service_role`.
4. **Post-assert DO block.** For each view it checks:
   - owner unchanged
   - `security_invoker = 'true'`
   - PUBLIC, anon and authenticated hold none of the 8 privileges, MAINTAIN included (prod is 170004)
   - no column ACL
   - service_role holds SELECT
5. **Probe DO block.** `SET LOCAL ROLE service_role`, read one row from each view, then `RESET ROLE`. This turns "service_role can still read" from a static privilege check into an executed fact. It is a new step compared with 1a/2a (Q-SA-3).

**Out of scope:**

- dropping any view (F-1)
- the 1a views, the pilot views and every table, including the six 2c tables
- revoking anon EXECUTE on invoker functions (backlog from slice 2, Q-SA-7 there)

Paste rules hold in every pasted file, and the static test enforces them:

- no `--` and no `/*`
- no "into", anywhere
- literals are plain except the 13 `public.<view>` names
- `COLLATE "C"` on every `string_agg`
- no single-letter aliases and no LIKE
- the words SECURITY DEFINER never appear

---

## Files

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261059_exposed_views_slice1b.sql` | create | The fix |
| `supabase/SQL Scripts/20261059_exposed_views_slice1b_rollback.sql` | create | Exact inverse: `RESET (security_invoker)` and `GRANT ALL` to anon and authenticated. Its first statement is a warning row |
| `scripts/precheck-exposed-views-slice1b.sql` | create | Read-only. Q0–Q13, with `PRECHECK STATUS` first |
| `scripts/check-exposed-views-slice1b-migration.sql` | create | Read-only post-apply checker. VERDICT first, 8 checks × 13 views = 104 |
| `supabase/migrations/__tests__/exposed-views-slice1b.migration.test.ts` | create | Static guard over the SQL text, the paste rules and the ownership boundaries |
| `docs/workplans/EXPOSED_VIEWS_SLICE1B_WORKPLAN.md` | create | This file |

No application code changes.

---

## Task list

- ✅ Confirm the migration number: `20261058` is reserved for 2c and nothing above `20261057` exists on any remote, so this slice is `20261059`
- ✅ Read 1a (`20261054`), 2a/2b (`20261056`, `20261057`) and the status commit `8d187b58` (read with `git show`)
- ✅ Grep every reader of the 13 views and map each to its client role
- ✅ Decide per view, and record why both controls
- ✅ Pre-check, migration, checker, rollback
- ✅ Static test: 59/59 once this workplan exists. The migration-scanning and authz guards also pass (`supabase/__tests__`, `supabase/migrations/__tests__`, `admin-authz-surface`, `businessOwnedTables`, `ownerVisibility`, `buildQueueItemsView`: 41 suites, 2133 tests, the only failure being this test's workplan check before this file was written)
- ✅ Slice 2c anon-only stopgap assessment (no code)
- ⬜ SA review → QA → user diff → TL pre-check (read-only) → user authorizes apply → TL applies → checker + probes → RM (branch, commit, PR)

---

## Apply order and acceptance

TL runs the read-only steps. **Applying needs the user's explicit authorization in the same session.** Supabase project `jgccgkyhpwirgknnceoh` is production.

1. **Pre-check.** Paste `scripts/precheck-exposed-views-slice1b.sql`. **Save the output**, because the rollback is checked against it.
   - `PRECHECK STATUS` = `CLEAN run the migration in a NEW tab`.
   - Q0: `170004 ok`, and `can switch to service_role` = `yes ok`.
   - Per view:
     - Q1 `present plain view`
     - Q2 `postgres ok`
     - Q3 `unset ok matches the rollback`
     - Q4: anon and authenticated `8 of 8 held ... ALL matches the rollback`, public `0 of 8 ... none as expected`, service_role `... kept by the migration`
     - Q5 grantor `postgres` only
     - Q6 and Q9 `0 outside the slice ok`
     - Q7 and Q8 `0 ok`
     - Q10: every base relation `service_role reads ok`
     - Q11: every called function `service_role runs ok` (built-ins are not listed)
     - Q12 `0 ok`
     - Q13 is information only. **Copy any `yes` row to TL**: it means anon could also write base rows through that view
   - Any `stop here` row: **stop**, and bring the output back to Dev/SA. Q7 hits are the likeliest: a function whose body names a view. A definer function is unaffected, but an invoker function called by a client role would lose the view.
2. **Migration in a NEW tab.** Paste `20261059_exposed_views_slice1b.sql`. It succeeds silently. **Any error in that tab means the whole transaction rolled back and nothing was applied** (SA S-3). The guard and post-assert raise "Views slice 1b ... so nothing was applied", but a failing service_role probe raises PostgreSQL's own error instead (for example `42501 permission denied for table ...`). Either way, bring the output to Dev/SA. A lock timeout is a clean abort, so re-run it.
3. **Checker.** Paste `scripts/check-exposed-views-slice1b-migration.sql`. Expected: `VERDICT PASS 104 pass 0 fail`.
4. **Negative probes.** Paste each block separately. Each must fail with `42501 permission denied for view ...`. Start with the three token and execution views:

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.monthly_token_usage; ROLLBACK;
   ```

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.daily_token_usage; ROLLBACK;
   ```

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.agent_executions_with_details; ROLLBACK;
   ```

   ```sql
   BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.agent_executions_with_details; ROLLBACK;
   ```

   Optionally, repeat the anon block for the other ten views. The checker already proves no privilege is held.
5. **Positive probes.**
   - As `service_role`, `SELECT * FROM public.calculator_config;` returns one row.
   - In the browser, the pricing calculator (the page that renders `PilotCreditCalculator`) loads its numbers, and `GET /api/pricing/config` returns 200 with `success: true`.
6. **After apply.** Over the next 24 h, Supabase API logs show no new 4xx or 5xx on `/rest/v1/calculator_config`. Re-run the security advisor: the 13 `security_definer_view` errors should be gone.
7. **Merge** through the PR (RM), after SA, QA and user approval.

---

## Rollback

Paste `supabase/SQL Scripts/20261059_exposed_views_slice1b_rollback.sql`. It is the exact inverse of the migration:

- `ALTER VIEW ... RESET (security_invoker)` on each view, back to unset, as Q3 recorded
- `GRANT ALL ... TO anon, authenticated`, the Supabase default and the Q4 state
- service_role SELECT is left in place, as it was before
- its DO block confirms the option is unset and that anon, authenticated and service_role can SELECT again

**The rollback reopens every row of `token_usage` and `agent_executions` to anon through these views.** Its first statement says so. TL may run it only with the user's explicit authorization, and only if something verified breaks. If the saved Q4 rows said `differs from ALL so adjust the rollback`, adjust its GRANT first.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Under invoker, service_role lacks access to a base relation or function, so `/api/pricing/config` breaks | Pre-guard (static) plus the in-transaction service_role read probe. If either fails, nothing is applied. Q10/Q11 show it in advance |
| R-2 | postgres is not a member of service_role, so `SET LOCAL ROLE service_role` fails | Pre-check Q0 checks membership. If it fails, the whole migration rolls back cleanly. SA can then rule to drop the probe block (Q-SA-3) |
| R-3 | A reader the grep missed (a client-side `.from()` built from a string, or an external consumer of the anon key) | The dynamic `.from(variable)` search found none. Step 6's log watch covers the rest. Because of the leak, anything that reads these views as anon is something to stop |
| R-4 | A database function reads a view under a client role | Pre-check Q7 lists every function whose body names a view, and stops |
| R-5 | ACCESS EXCLUSIVE on a view blocks its readers briefly | `lock_timeout = '5s'`. All the views are small aggregates with one service-role reader |
| R-6 | A future `CREATE OR REPLACE VIEW` silently drops `security_invoker` | The revoke still holds. F-2 proposes a guard |
| R-7 | `agent_executions_with_details` under invoker gives authenticated every row once some future grant returns, until 2c enables RLS on `agent_executions` | No client grant remains after this slice, and 2c closes the base table |
| R-8 | service_role keeps whatever it already held on the 13 views (likely ALL). The migration only makes sure it holds SELECT | Not a regression, and the same as 1a. Tightening service_role is out of scope (SA S-4) |
| R-9 | On a database built from migrations alone (a local `db reset`), most of the 13 views do not exist, because they were created in the dashboard, so the pre-guard raises "view missing" | Expected, and not a defect: no branch database exists, and 1a behaves the same way. The migration is meant for prod, pasted by hand (SA S-5) |

---

## Slice 2c: anon-only stopgap assessment

**Question:** could an immediate `REVOKE ALL ... FROM anon` (anon only) on the six RLS-disabled tables (`agent_configurations`, `agent_executions`, `agent_logs`, `agent_stats`, `shared_agents`, `shared_agent_imports`) ship ahead of the full 2c owner-policy work?

### Every code path that reaches these tables as anon

Method: every file importing `@/lib/supabaseClient` (97 files), intersected with every file naming one of the six tables or their invoker functions (`increment_agent_stats`, `aggregate_execution_model_usage`). Each hit was then split into `'use client'` code (browser) and server code. All server code that builds a client from `NEXT_PUBLIC_SUPABASE_ANON_KEY` was also checked. This repeats and re-confirms the slice 2 caller map and SA's V-5 finding on today's main (`8014ee73`).

| # | Path | How it reaches the table as anon | After an anon-only revoke |
|---|---|---|---|
| 1 | `app/api/agents/[id]/metrics` GET | `executionRepository` singleton, whose default client is the browser client and which has no session on the server: `agent_executions` SELECT | **Breaks**: the route returns 500. Its only caller is the Share action on `/v2/agents/[id]` (`page.tsx:1879`), which falls back to `base_executions: 0` and carries on |
| 2 | `app/api/shared-agents/exists` GET | `sharedAgentRepository` singleton (same default): `shared_agents` SELECT | **Breaks**: `success: false`. The Share action (`page.tsx:1865`) treats that as "not shared yet" and carries on |
| 3 | `app/api/shared-agents` POST | the same singleton: `shared_agents` SELECT, then INSERT | **Breaks**: 42501. The Share action shows "Failed to share agent" and stops. **Visible effect: sharing an agent to the template gallery stops working** |
| 4 | `/v2/templates` **signed out** (`(protected)/templates` requires sign-in) | browser client without a session: `shared_agents` SELECT | Empty gallery or an error. Nothing links there signed out (slice 2 R-7), and `shared_agents` has 0 rows |
| 5 | Every other browser page or component (dashboard, agent pages, `AlertFeed`, `AgentStatsTable`, `useAgentSandbox`, and so on) | browser client **signed in**, so it runs as `authenticated` | **Unaffected**: authenticated keeps its grants |
| 6 | Cookie-client routes (`run-agent`, `agent-stream`, `user/data-export`, `repair-hardcode`, `v2/calibrate/*`, `WorkflowPilot`) | `authenticated` | Unaffected |
| 7 | Service-role paths (about 25, including BOS `stats`, crons, scripts and the Edge Function) | `service_role` | Unaffected |
| 8 | Dead code: `lib/execution/agentExecutionEngine.ts` and `lib/hooks/useDashboardData.ts` | browser client; no importer of either | n/a |

The database side is unaffected:

- The invoker functions are only ever called by `authenticated` (cookie client) or `service_role` (`cron/process-queue`).
- The `shared_agent_imports` import-counter trigger runs as the inserting role, which is authenticated.
- No Realtime subscription targets these tables.
- An anon RPC call to `increment_agent_stats` or `aggregate_execution_model_usage` would now fail, which is the point.

### What the stopgap would and would not do

- **Closes:** anyone on the internet holding the anon key can no longer read, change, delete or **truncate** the 1,328 run records, 55 agent configurations (input values can hold emails and document ids), the agent logs and the stats. pg_graphql is closed too.
- **Closes as a side effect:** SA's V-5 IDOR in the three routes. Today an unauthenticated caller can read any agent's run metrics and publish any user's agent to the gallery under that user's id. Once anon is revoked, their database calls fail.
- **Does not close:** any **signed-in** user can still read, change, delete and truncate every other user's rows in these six tables. RLS stays off and authenticated keeps ALL. That cross-tenant hole is what full 2c fixes.
- **Does not close:** `agent_executions_with_details`. This slice (1b) closes it.

### Recommendation: **yes**

Ship it as soon as SA approves, in the same apply window as 1b, with one disclosed trade-off for the user in business terms: **sharing an agent to the template gallery stops working until slice 2c's code ships. Nobody has shared an agent yet (0 shared agents, 0 imports).**

If the user does not accept that, the alternative is to ship 2c's three-route fix first (SA ruling Q-SA-1 and C-6 in the slice 2 workplan: cookie client plus `getUser()`, drop the `x-user-id` trust). The anon revoke then breaks nothing. That code is needed for 2c anyway, so it is not wasted work, only slower.

### Shape, if approved (not written)

- Next free number at the time; `20261060` today. `20261058` stays reserved for full 2c.
- One transaction with `SET LOCAL lock_timeout = '5s'` (`agent_executions` and `agent_stats` are written on every run).
- **Pre-guard:**
  - RLS off and not forced on all six
  - anon holds all 8 privileges
  - PUBLIC holds none
  - no column ACLs
- `REVOKE ALL ON TABLE ... FROM anon` on the six tables. **RLS is not enabled, and authenticated and service_role are not touched**, so full 2c's pre-guard needs a matching update (it pins the Q6 grants today).
- **Post-assert:** anon holds none of the 8 privileges, authenticated and service_role are unchanged, and there are no column ACLs.
- Read-only checker; rollback `GRANT ALL ... TO anon`; probes `SET LOCAL ROLE anon` → 42501 on each table, plus an authenticated owner read that still works.
- Option B for SA (Q-SA-6): also revoke `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN` from **authenticated**. Slice 2's caller map found no client path that uses any of them, and TRUNCATE ignores RLS, so 2c removes it anyway.

### Stopgap as written (`20261060`, applied 2026-10-13)

The user approved the stopgap on 2026-10-13 and accepted the trade-off: **"Share agent to template gallery" stops working until full 2c ships.** SA ruled that approving the shape is not approving the code (Q-SA-5), so this needs its own SA code review before TL runs anything.

**Number.** `20261060` was free on every local branch, remote branch and worktree on 2026-10-13. Note that `20261058` is **no longer free**: `origin/main` now holds `20261058_contact_documents_accept_scans_and_phone_photos.sql` (commit `a6990f77`). Full 2c takes `20261061` or later (SA ruling, 2026-10-13), chosen at write time after re-checking `origin/main`, every branch and every worktree.

| File | What it does |
|---|---|
| `supabase/migrations/20261060_rls_disabled_agent_tables_anon_stopgap.sql` | One transaction, `lock_timeout = '5s'`. **Pre-guard** refuses unless each of the six tables exists as a plain table in `public`, is owned by `postgres`, has row security off and not forced, has no column ACL, and authenticated still holds SELECT, INSERT, UPDATE and DELETE. **Body:** per table, `REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon`, and `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ... FROM authenticated` (SA ruling Q-SA-6). A DO block then revokes ALL from PUBLIC and anon on every sequence the six tables own (serial or identity), found through `pg_depend`. **Post-assert:** owner unchanged, row security still off, PUBLIC and anon hold none of the 8 privileges and no column privilege, authenticated and service_role still hold the four, authenticated holds none of the four removed, no column ACL, and PUBLIC and anon hold nothing on any owned sequence. service_role and row security are never touched |
| `supabase/SQL Scripts/20261060_rls_disabled_agent_tables_anon_stopgap_rollback.sql` | Exact inverse: `GRANT ALL` to anon, the four extras back to authenticated, `GRANT ALL` on the owned sequences to anon. Its first statement is the warning, and its DO block confirms anon and authenticated hold all 8 again |
| `scripts/precheck-rls-disabled-agent-tables-anon-stopgap.sql` | Read-only, `PRECHECK STATUS` first. Q0 version; per table Q1 exists, Q2 owner, Q3 row security, Q4 privileges per role, Q5 grantors, Q6 column ACLs, Q7 owned sequences and anon's grants on them, **Q8 every function whose body names the table, with STOP on TRUNCATE or LOCK in a caller-rights body** (SA ruling Q-SA-6), Q9 triggers, Q10 policies that name the table |
| `scripts/check-rls-disabled-agent-tables-anon-stopgap-migration.sql` | Read-only, VERDICT first. 10 checks × 6 tables = 60 |
| `supabase/migrations/__tests__/rls-disabled-agent-tables-anon-stopgap.migration.test.ts` | Static guard over the four SQL files and the two workplans |

**Differences from the shape above.** PUBLIC is revoked too (it holds nothing today, so this is a no-op that keeps it that way). Owned sequences are covered: `REVOKE ALL`, not only USAGE and SELECT, because sequence UPDATE lets the caller run `setval` and break inserts for everyone. "anon holds all 8" is not a guard condition; the pre-check reports it as "adjust the rollback" instead, as in 1b. The pre-guard also requires authenticated to hold the four it keeps, so the post-assert compares like with like.

**Rollback fidelity** (SC-3). If the saved Q4 or Q7 rows say "differs from ALL so adjust the rollback", adjust **both** the rollback's GRANTs **and** its final DO block, which asserts that anon and authenticated hold all 8. The same applies to a PUBLIC row that is not "none": the rollback does not re-grant PUBLIC.

**Apply order** (TL; applying needs the user's explicit authorization in the session; same window as 1b, after it):

1. Pre-check. Expect `CLEAN run the migration in a NEW tab`. Q4: anon and authenticated `8 of 8 ... ALL matches the rollback`, public `none as expected`, service_role `untouched by the migration`. **Copy every Q8, Q9 and Q10 row to Dev/SA, and wait for SA to clear them before the migration tab** (SC-1). Anon loses SELECT, so any caller-rights function or RLS policy that names one of the six tables raises 42501 when anon reaches it, not only TRUNCATE/LOCK bodies, and dashboard-created policies and triggers are not in the repo. Stop on any `stop here`. Save the output.

   **Q8 triage rule** (SC-2):
   1. **LOCK** hits are informational: authenticated keeps UPDATE and DELETE, which satisfy every LOCK mode on PG 17, and anon has no legitimate reach.
   2. **TRUNCATE** in a caller-rights body is a real stop only if authenticated can EXECUTE it, or it is a trigger function on a table authenticated writes.
   3. A caller-rights function **without** TRUNCATE/LOCK is a stop only if anon can EXECUTE it and a signed-out page calls it, or it is a trigger on a table anon writes.

   Any doubt goes to SA.
2. Migration in a NEW tab. Any error means nothing was applied.
3. Checker: `VERDICT PASS 60 pass 0 fail`.
4. Negative probes, each block separately, each must fail with `42501`:

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.agent_executions; ROLLBACK;
   ```

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.agent_configurations; ROLLBACK;
   ```

   ```sql
   BEGIN; SET LOCAL ROLE authenticated; TRUNCATE public.agent_logs; ROLLBACK;
   ```

5. Positive probe: a signed-in agent page (dashboard, agent detail) still shows its runs and stats. The Share action on `/v2/agents/[id]` now shows "Failed to share agent", which is the accepted trade-off.

**Local dry run** (PGlite, PostgreSQL 18, in memory, scratchpad only, no Supabase connection), with the six tables (one `bigserial`, one identity), `GRANT ALL` to the three roles, invoker `increment_agent_stats`, the invoker import-counter trigger, a policy that subqueries `agent_executions`, an owner-rights TRUNCATE function and a `SKIP LOCKED` reader:

| Step | Result |
|---|---|
| Pre-check | CLEAN. Q7 lists both owned sequences, Q8 lists the four functions (owner-rights TRUNCATE `ok`, `SKIP LOCKED` not flagged), Q9 the trigger, Q10 the policy |
| Migration, then re-run | Both apply (the stopgap is idempotent) |
| Checker | `VERDICT PASS 60 pass 0 fail` |
| anon | SELECT on all six, `nextval` on a sequence, and `increment_agent_stats`: all `permission denied` |
| authenticated | SELECT, INSERT (serial and identity), UPDATE, DELETE, `increment_agent_stats`, the import with its trigger, the policy subquery, `LOCK ... IN SHARE MODE`: all OK. TRUNCATE: `permission denied` |
| service_role | SELECT and TRUNCATE OK |
| Rollback | Applies. The pre-check output is identical to the one before the migration (exact round trip) |
| Fail-closed | A caller-rights function with TRUNCATE and one with LOCK: pre-check STOP 2. A column grant to anon, row security on, or authenticated missing DELETE: the migration refuses with "so nothing was applied" |

---

## Open questions for SA

- **Q-SA-1 (numbering).** Keep 1b at `20261059` and 2c at `20261058`, even though 1b will be applied first? Or swap them, giving 1b `20261058` and 2c `20261059`, and update the slice 2 workplan? Dev recommends keeping the numbers. They are hand-applied and the objects are disjoint.
- **Q-SA-2 (invoker on all 13).** Set `security_invoker = true` on every view, or revoke only (the 1a precedent)? Dev recommends both, for the reasons in [Why both controls](#why-both-controls).
- **Q-SA-3 (in-migration service_role probe).** The final DO block runs `SET LOCAL ROLE service_role` and reads one row from each view, then `RESET ROLE`. That is a new pattern compared with 1a/2a (CLAUDE.md rule 7). Accept it, or move the probe to the post-apply steps only?
- **Q-SA-4 (pre-guard strictness).** The pre-guard refuses if service_role lacks *table-level* SELECT on a base relation, even if it holds the needed column grants. This fails closed, and Q10 shows the case. Acceptable?
- **Q-SA-5 (2c stopgap).** Approve the anon-only stopgap as a separate small migration in the 1b apply window? Should it ship with the visible "Share to gallery" break, or wait for the three-route fix?
- **Q-SA-6 (stopgap option B).** Also revoke TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from authenticated in the stopgap?
- **Q-SA-7 (branch).** This work is in the agent worktree branch, not a `fix/` branch. RM must create `fix/exposed-views-slice-1b` from the current main before committing.

---

## Ownership boundaries

This slice does **not** touch the following. The static test asserts that none of them is named in the four SQL files.

| Owner | Objects |
|---|---|
| Slice 1a (applied) | `active_plugin_connections`, `user_settings_complete` |
| Pilot routing history (applied, `20261055`) | `pilot_step_routing_history`, `pilot_routing_performance`, `pilot_step_type_analysis`, `pilot_tier_distribution` |
| Price review slice 2 | `pilot_cost_savings_summary` (already invoker, `20261053`) |
| RLS slice 2c | `agent_configurations`, `agent_executions`, `agent_logs`, `agent_stats`, `shared_agents`, `shared_agent_imports`. This slice changes only a *view* over `agent_executions` |
| Not-ours `true`-policy tables | `workflow_step_executions` (read by `token_prediction_accuracy`; the table is not changed) |

---

## Follow-ups

| # | Item | Owner |
|---|---|---|
| F-1 | Drop the views nothing reads: 11 of the 13 have no reader at all, and `calibration_success_metrics` has only an uncalled method. Dropping needs a decision, and the purge requirement's §8.13 view list would need updating | SA / user |
| F-2 | A static guard that every `CREATE [OR REPLACE] VIEW` in `supabase/migrations` sets `security_invoker = true`, and that no migration grants a view to anon | backlog |
| F-3 | Business decision (as in 1a): `token_usage` and `agent_executions` rows were readable by anyone through these views for an unknown period. Record it in the incident note | user |
| F-4 | `app/api/pricing/config/route.ts` uses `console.*` 22 times and builds its own service-role client instead of going through a repository. Convert it when the file is next touched | backlog |
| F-5 | 2c stopgap: approved by the user 2026-10-13 and written as `20261060` (see [Stopgap as written](#stopgap-as-written-20261060-applied-2026-10-13)). SA code review done 2026-10-13: APPROVED WITH CHANGES (SC-1 to SC-4, doc only). Then apply | TL |

---

## SA Review Notes

**Reviewed by SA, 2026-10-13** (workplan and code in one pass: migration, rollback, pre-check, checker, static test)
**Status:** APPROVED WITH CHANGES. Fix S-1 before TL runs the pre-check on production. S-2 to S-5 are text corrections that can land in the same edit. No change to the migration SQL is required.

### What SA verified independently

- **Readers of the 13 views.** `git grep -w` on every name across `app lib components hooks scripts supabase` (including `supabase/functions/run-scheduled-agents`, which touches only `agents`), plus partial-name and `/rest/v1/` and GraphQL searches. Every dynamic `.from(variable)` was traced. All of them resolve to registries, buckets or constants that never contain one of the 13 names, because a name would have to appear as a literal somewhere and none does. **Confirmed:** the only live reader is `app/api/pricing/config/route.ts`, which uses the service role (`.from('calculator_config').single()`). `CalibrationHistoryRepository.getSuccessMetrics` has no caller (only a doc mentions it). **One correction**, see S-2: `scripts/delete-duplicate-agents.ts` also calls `.from('agent_memory_stats').delete()` over the API with the service-role key in `fallbackDeletion()`. It is unaffected.
- **Precedent fit.** 1a (`20261054`) revoked only and explicitly deferred `security_invoker` to 1b (1a workplan, line 43). The 2a/2b pre-guard, lock timeout and post-assert shape is reused faithfully. The REVOKE removes only grants whose grantor is postgres. The post-assert uses `has_table_privilege`, which sees grants from any grantor, so a grant from another grantor fails closed. Q5 surfaces it in advance.
- **Static test.** 59/59 pass locally (`npx jest supabase/migrations/__tests__/exposed-views-slice1b.migration.test.ts`).
- **2c caller map.** Re-checked: `ExecutionRepository` and `SharedAgentRepository` default to the browser client (`@/lib/supabaseClient`), and only the three listed routes use those singletons. `AgentRepository` defaults to `supabaseServer`, so the agent lookup in the POST succeeds and the failure lands on `shared_agents`, as Dev says. `components/v2/Footer.tsx` reads `agent_stats` only when `user` is set, so it runs as authenticated. No other server path reaches the six tables as anon.

### Rulings on Dev's open questions

| Q | Ruling |
|---|---|
| Q-SA-1 numbering | **Keep 1b = `20261059`; `20261058` stays reserved for full 2c.** There is no ordered migration ledger (`check-migrations-applied.ts` works from evidence), every file is hand-applied, and the objects are disjoint. Condition: the 2c workplan must state that its pre-guard assumes 1b (and the stopgap, if shipped) are already applied, even though its number sorts earlier |
| Q-SA-2 invoker + revoke | **Both.** The revoke is the fix. Invoker is defence in depth against a re-grant and clears the advisor lint whatever it does with grants. It costs nothing for service_role (BYPASSRLS), and the guard and probe prove that. This is what 1a deferred to 1b |
| Q-SA-3 in-migration probe | **Accepted as a new pattern** (CLAUDE.md rule 7), scoped to hand-applied grant and invoker migrations. Why: an invoker view checks base-table SELECT and function EXECUTE at executor start, so a `LIMIT 1` read proves the permission even when the view returns no rows, and the failure aborts the whole transaction. Conditions: (a) S-1 fixes the Q0 membership check; (b) the probe stays read-only (SELECT only) and ends with `RESET ROLE`. The static test already pins both; (c) never extend it to writes or to a role other than service_role without SA review |
| Q-SA-4 column-only grants | **Fail closed is correct.** A column-grant-only base relation is an anomaly worth a stop and a look, not a case to support silently |
| Q-SA-5 2c anon stopgap | **Approved in principle. Recommend shipping it in the 1b apply window, with the trade-off disclosed.** Today anyone with the public anon key can read, change, delete and truncate 1,328 run records and the agent configurations, and can publish any user's agent through the V-5 IDOR. Losing "Share to gallery", a feature nobody has used (0 shared agents, 0 imports), is the smaller harm. TL puts this to the user in business terms: *"Sharing an agent to the template gallery will stop working until the full fix ships; nobody has used it yet."* If the user declines, the fallback is Dev's: the 2c three-route fix first, then the revoke. **The stopgap SQL is not written yet, so it needs its own SA code review before apply.** Approving the shape is not approving the code |
| Q-SA-6 option B | **Approved: include it.** Revoke TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from authenticated on the six tables. TRUNCATE ignores RLS, so today any signed-in user can wipe every user's run history. No client path uses any of the four. Condition: the stopgap pre-check lists every function whose body names one of the six tables (as Q7 does here), and stops if any invoker function body contains TRUNCATE or LOCK |
| Q-SA-7 branch | Agreed. RM creates `fix/exposed-views-slice-1b` from current main |

### Comments

| # | File / section | Item | Priority | Status |
|---|---|---|---|---|
| S-1 | `scripts/precheck-exposed-views-slice1b.sql`, Q0 "can switch to service_role" | `pg_has_role('service_role', 'MEMBER')` does not prove that `SET ROLE` works. On PG16+ (prod is 17), SET ROLE needs the membership's **SET** option, and MEMBER is true without it. Use `pg_has_role('service_role', 'SET')`. If this is not fixed, the failure mode is still safe, because the probe raises and the whole migration rolls back. But the pre-check would claim "yes ok" when the apply is going to fail | Medium, fix before the pre-check | **resolved** (TL, 2026-10-13): Q0 now uses `pg_has_role('service_role', 'SET')` (`scripts/precheck-exposed-views-slice1b.sql:208`, re-verified by SA), and TL confirmed on prod that `set_opt` is true for postgres's membership in service_role |
| S-2 | Workplan, per-view table row 4 and "What could break", Scripts row | `delete-duplicate-agents.ts` is not print-only. `fallbackDeletion()` runs `.from('agent_memory_stats').delete()` with the service-role key. It is unaffected: service_role's privileges on the view are not changed, and an aggregate view is not deletable anyway, so the script already logs and continues. Correct the text | Low | done (Dev, 2026-10-13): per-view row 4 and the Scripts row corrected |
| S-3 | Workplan, Apply order step 2 | If the probe fails, the error is PostgreSQL's own (for example `42501 permission denied for table ...`), not the "Views slice 1b ... so nothing was applied" text. State that **any** error in the migration tab means the transaction rolled back and nothing was applied, and that the output goes to Dev/SA | Low | done (Dev, 2026-10-13): Apply order step 2 reworded |
| S-4 | Workplan, Risks | Add: service_role keeps whatever it already held on the views (likely ALL), and the migration only ensures SELECT. That is not a regression and it matches 1a. Tightening service_role is out of scope | Low | done (Dev, 2026-10-13): Risks R-8 |
| S-5 | Workplan, Risks or Follow-ups | Add: on a database built from migrations alone (local `db reset`), most of these views do not exist (they were created in the dashboard), so the pre-guard raises. Same as 1a. This is expected and is not a defect, because no branch database exists | Low | done (Dev, 2026-10-13): Risks R-9 |

### Optimisation suggestions (non-blocking)

- F-1 (drop the 11 unread views) is the cleaner end state. When it is scheduled, also delete `CalibrationHistoryRepository.getSuccessMetrics`, which would now fail with 42501 for any caller that is not the service role.
- F-4: besides the 22 `console.*` calls, `/api/pricing/config` returns `error.message` to the client without the `NODE_ENV === 'development'` guard (CLAUDE.md, Security Rules). Fold that into the same follow-up.
- The 2b checker's info row 901 ("views still open to anon until slice 1b") will read `anon select false` after this apply. That is correct, and it needs no edit.

### Approval

- [x] Workplan and code approved, on the conditions above: S-1 fixed before TL runs the pre-check; S-2 to S-5 are doc edits in the same pass. No re-review is needed for S-1 to S-5 unless the migration SQL changes.
- [x] Code Approved for QA: **Yes** (after S-1).
- Applying to production (`jgccgkyhpwirgknnceoh`) still needs the user's explicit authorization in the session, per [Apply order and acceptance](#apply-order-and-acceptance).

### 1b production apply record (2026-10-13)

| Step | Result |
|---|---|
| S-1 | Resolved before the pre-check (see S-1 row): Q0 uses `pg_has_role('service_role','SET')`; `set_opt` confirmed true on prod by TL |
| Migration `20261059` | Pasted by the user in the Supabase SQL editor on 2026-10-13. Result: "Success. No rows returned" |
| Checker | TL ran `scripts/check-exposed-views-slice1b-migration.sql`: `VERDICT PASS 104 pass 0 fail` |
| Security advisor | `security_definer_view` count dropped from 13 to 0 |
| Still owed | Commit + PR (RM, branch `fix/exposed-views-slice-1b`), QA record of the negative/positive probes (Apply order steps 4 and 5) and the 24 h log watch (step 6) |

### Stopgap production apply record (`20261060`, 2026-10-13 to 2026-10-14)

| Step | Result |
|---|---|
| SC-1, SC-2 | In the workplan before the pre-check (see [Stopgap as written](#stopgap-as-written-20261060-applied-2026-10-13), Apply order step 1) |
| Pre-check | TL ran `scripts/precheck-rls-disabled-agent-tables-anon-stopgap.sql` read-only on 2026-10-13: `CLEAN`, 0 owned sequences |
| Q8 (functions) | Only `operator_test_account_cleanup` has TRUNCATE/LOCK, and it runs as owner. The caller-rights helpers (`increment_agent_stats` x2, `update_agent_stats`, `aggregate_execution_model_usage`, `update_agent_schedule_safe`, `increment_shared_agent_import_count`) have no TRUNCATE/LOCK and are called only by signed-in or service-role clients. Cleared under the SC-2 rule |
| Q9 (triggers) | The `update_*_updated_at` triggers and `trigger_increment_shared_agent_import_count` run as caller; signed-in users keep UPDATE. Cleared |
| Q10 (policies) | One policy: "Users can view their execution routing decisions" on `execution_routing_decisions` (roles public, SELECT), which subqueries `agent_executions`. After the stopgap an anon read of that table errors instead of returning empty; no public page reads it. Cleared per the SC-2 rule |
| Migration `20261060` | Pasted by the user in the Supabase SQL editor; it succeeded |
| Checker | TL ran `scripts/check-rls-disabled-agent-tables-anon-stopgap-migration.sql` on 2026-10-14: `VERDICT PASS 60 pass 0 fail` |
| Accepted cost | "Share agent to template gallery" is broken until full 2c ships |
| Still owed | QA record of the negative/positive probes (Apply order steps 4 and 5), commit + PR (RM), and a 24 h log watch |

---

**Code Review by SA, 2026-10-13: slice 2c anon stopgap (`20261060`)**
**Status:** APPROVED WITH CHANGES. The SQL of the migration, rollback, checker and pre-check is approved as written; no SQL change is required. SC-1 and SC-2 are workplan (apply-step) edits that must land **before TL runs the stopgap pre-check**. SC-3 and SC-4 are low-priority text. No re-review is needed for SC-1 to SC-4 unless a SQL file changes.

#### What SA verified independently

- **Migration.** One transaction, 5 s lock timeout. Pre-guard fails, never skips, on a missing table, a non-postgres owner, RLS on or forced, any column ACL, or authenticated missing one of the four it keeps. The body only revokes: PUBLIC and anon lose ALL, authenticated loses exactly TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, and service_role and RLS are never touched. The post-assert uses `has_table_privilege` / `has_any_column_privilege` / `has_sequence_privilege`, which see grants from **any** grantor, so a grant from a grantor other than postgres (which postgres's REVOKE would silently skip) aborts the whole transaction. Fail closed. `MAINTAIN` needs PG 17; prod is `170004`, and on an older server the REVOKE is a syntax error that aborts everything, which Q0 surfaces first.
- **Owned sequences.** The `pg_depend` walk (`deptype` `a` serial and `i` identity, `relkind = 'S'`) is correct and cannot pick up indexes or toast. `oid::regclass::text` quotes the name safely for `EXECUTE`. authenticated's sequence grants are untouched, so signed-in inserts keep `nextval`.
- **Rollback.** Exact inverse of the Q4/Q5/Q7 state TL measured for 2a (anon and authenticated 8 of 8, PUBLIC none, grantor postgres). Warning first. No `into` word in any of the four files (SQL-editor hazard).
- **Checker.** 10 checks x 6 tables = 60; VERDICT first; read-only. C3 is meant to FAIL once full 2c enables RLS, and says so.
- **Static test.** `npx jest` on both slice tests: 121/121 pass (stopgap + 1b).
- **Anon callers (the key risk).** Re-derived on this worktree: every file naming one of the six tables or their RPCs, intersected with every browser-client / anon-key import. Server-side anon-without-session paths are exactly the three routes in the caller map (`/api/agents/[id]/metrics`, `/api/shared-agents` POST, `/api/shared-agents/exists`), via the `executionRepository` and `sharedAgentRepository` singletons that default to `@/lib/supabaseClient`. No other code imports those singletons (`/api/agents/[id]/executions` and `user/data-export` construct `ExecutionRepository(supabaseServer)`; `run-agent` and `calibrationRcaService` pass a cookie client). The other browser-client repositories (`AgentMetricsRepository`, `ConfigRepository`, `MemoryRepository`) touch none of the six tables. The two server files that build a client from the anon key (`agent-stream`, `user/data-export`) both use the cookie session and `getUser()` before touching the tables, so they run as authenticated. `increment_agent_stats` is called only from `agent-stream` (cookie) and `cron/process-queue` (service role); `aggregate_execution_model_usage` only from `StateManager` with a passed-in client. Result: the only breakage is the accepted "Share to gallery" one; metrics and exists degrade gracefully as Dev described.
- **Authenticated keeps what the app needs.** Every client path uses SELECT / INSERT / UPDATE / DELETE (upsert is INSERT + UPDATE). No client path uses TRUNCATE, REFERENCES, TRIGGER or MAINTAIN. FK checks and `ON DELETE CASCADE` actions run as the table owner, so losing REFERENCES does not affect inserts or cascades. `LOCK TABLE` in any mode is satisfied by UPDATE or DELETE on PG 17, so a caller-rights LOCK keeps working for authenticated (the PGlite run confirmed `SHARE MODE`). The `shared_agent_imports` counter trigger runs as authenticated, which keeps UPDATE on `shared_agents`.
- **DB-side anon paths.** The only repo-visible one is the policy in `20260629_execution_model_tracking.sql:76`, which subqueries `agent_executions` inside a policy on another table. After the stopgap, an anon query on that table raises 42501 instead of returning 0 rows. No legitimate anon reader of that table exists, so this is not a break, but it is exactly the class Q10 must surface on prod, because dashboard-created policies are not in the repo (SC-1).

#### Rulings on Dev's deviations from the brief

| # | Deviation | Ruling |
|---|---|---|
| (a) | `REVOKE ALL` (USAGE, SELECT **and** UPDATE) on owned sequences from PUBLIC and anon | **Approved.** UPDATE on a sequence allows `setval`, which can push a sequence onto existing ids and break every insert for every user. anon has no legitimate sequence use once it has no INSERT. The rollback grants ALL back, which matches Q7's "3 of 3" starting state |
| (b) | "anon holds all 8" is reported by the pre-check, not enforced by the pre-guard | **Approved.** The pre-guard's job is to make the forward change safe, and revoking from anon is safe whatever anon held. Anon's starting set only affects rollback fidelity, which the saved pre-check output covers. Condition: SC-3 |

#### Rulings on the open questions

| Q | Ruling |
|---|---|
| 1. Full 2c number | **Confirmed: full 2c takes `20261061` or later**, chosen at write time after re-checking `origin/main`, every branch and every worktree. `20261058` is permanently taken by `contact_documents` (`a6990f77`); every 2c reference to `20261058` in the slice 2 workplan must be updated when 2c is written. Also: `20261059` and `20261060` are still free on `origin/main` (`f302680f`, 2026-10-13); RM re-verifies both at commit time |
| 2. Q8 over-inclusive (substring match, LOCK) | **Acceptable.** Over-inclusion only produces extra STOP rows, which fail closed. Known false positives: `clock_timestamp`, `BLOCK`, `pg_advisory_lock`, and a table name that is a prefix of another name. Triage rule in SC-2. Narrowing it (for example a word-boundary regex on `LOCK TABLE`) is optional, not required |

#### Code Review Comments

| # | File / section | Item | Priority | Status |
|---|---|---|---|---|
| SC-1 | Workplan, "Stopgap as written", Apply order step 1 | Change "Copy every Q8 row" to **"Copy every Q8, Q9 and Q10 row to Dev/SA, and wait for SA to clear them before the migration tab."** Why: anon loses SELECT, so any caller-rights function or any RLS policy that names one of the six tables now raises 42501 when anon reaches it, not only TRUNCATE/LOCK bodies. Dashboard-created policies and triggers are not in the repo, so prod output is the only evidence. Optional script improvement: add `pg_policies.roles` and `cmd` to the Q10 detail so SA can see at a glance whether anon or PUBLIC is in scope | Medium, before the pre-check | ✅ Done 2026-10-14 (Apply order step 1) |
| SC-2 | Workplan, same section, after step 1 | Add the Q8 triage rule: (1) **LOCK** hits are informational: authenticated keeps UPDATE and DELETE, which satisfy every LOCK mode on PG 17, and anon has no legitimate reach; (2) **TRUNCATE** in a caller-rights body is a real stop only if authenticated can EXECUTE it, or it is a trigger function on a table authenticated writes; (3) a caller-rights function **without** TRUNCATE/LOCK is a stop only if anon can EXECUTE it and a signed-out page calls it, or it is a trigger on a table anon writes. Any doubt goes to SA | Medium, before the pre-check | ✅ Done 2026-10-14 (Apply order step 1, Q8 triage rule) |
| SC-3 | Workplan, "Stopgap as written" (rollback) | State: if the saved Q4 or Q7 rows say "differs from ALL so adjust the rollback", adjust **both** the rollback's GRANTs **and** its final DO block, which asserts that anon and authenticated hold all 8. The same applies to a PUBLIC row that is not "none" (the rollback does not re-grant PUBLIC) | Low | ✅ Done 2026-10-14 ("Rollback fidelity" paragraph) |
| SC-4 | Workplan, "Stopgap as written", Number paragraph | Replace "Full 2c needs a new number at write time (open question for SA/TL)" with the ruling: full 2c takes `20261061` or later | Low | ✅ Done 2026-10-14 (Number paragraph) |

#### Optimisation Suggestions (non-blocking)

- Q7 could show the sequence grantor (as Q5 does for tables). A non-postgres grantor already fails closed in the post-assert, so this only saves a round trip.
- A Q11 listing column defaults in **other** tables that call `nextval` on one of these owned sequences would close the last theoretical anon path (a shared sequence). Not expected to exist.
- Once the three routes move to the cookie client in full 2c, `ExecutionRepository` and `SharedAgentRepository` should drop the browser-client default for server use (the root cause of the anon-without-session class). Track under full 2c.

#### Code Approved for QA: **Yes**, after SC-1 and SC-2 are in the workplan

- Applying to production still needs the user's explicit authorization in the session. Apply after 1b, which is now done.

## QA Testing Report

**QA — 2026-10-14**
**Test mode:** full (security focus), post-apply verification
**Strategy used:** C (live REST probes with the public anon key against production, read-only plus one refused write) + A (static migration tests and guards) + code read for the positive path. No SQL was run and nothing was written to production.
**Focus:** security
**Skipped:** dev-server check of `/api/pricing/config` (not needed: the code read below settles which key it uses). "Share agent to template gallery" was **not tested**: it is the known, accepted loss of the 2c stopgap until full 2c.
**Input source:** prompt keywords

### Live probes (anon key, project `jgccgkyhpwirgknnceoh`)

The key's JWT `role` claim was confirmed as `anon`. The service-role key was not used. Every request was `GET /rest/v1/<name>?select=*&limit=1` unless stated.

| Object | Kind | HTTP | Error code | Rows | Result |
|---|---|---|---|---|---|
| `monthly_token_usage` | view (20261059) | 401 | 42501 permission denied for view | 0 | ✅ Pass |
| `daily_token_usage` | view | 401 | 42501 | 0 | ✅ Pass |
| `agent_executions_with_details` | view | 401 | 42501 | 0 | ✅ Pass |
| `agent_memory_stats` | view | 401 | 42501 | 0 | ✅ Pass |
| `calculator_config` | view | 401 | 42501 | 0 | ✅ Pass |
| `agent_intensity_distribution` | view | 401 | 42501 | 0 | ✅ Pass |
| `top_complex_agents` | view | 401 | 42501 | 0 | ✅ Pass |
| `token_prediction_accuracy` | view | 401 | 42501 | 0 | ✅ Pass |
| `calibration_success_metrics` | view | 401 | 42501 | 0 | ✅ Pass |
| `production_workflow_health` | view | 401 | 42501 | 0 | ✅ Pass |
| `v6_quality_trends` | view | 401 | 42501 | 0 | ✅ Pass |
| `error_pattern_summary` | view | 401 | 42501 | 0 | ✅ Pass |
| `website_analytics_summary` | view | 401 | 42501 | 0 | ✅ Pass |
| `agent_configurations` | table (20261060) | 401 | 42501 permission denied for table | 0 | ✅ Pass |
| `agent_executions` | table | 401 | 42501 | 0 | ✅ Pass |
| `agent_logs` | table | 401 | 42501 | 0 | ✅ Pass |
| `agent_stats` | table | 401 | 42501 | 0 | ✅ Pass |
| `shared_agents` | table | 401 | 42501 | 0 | ✅ Pass |
| `shared_agent_imports` | table | 401 | 42501 | 0 | ✅ Pass |
| `agent_logs` DELETE `?id=eq.00000000-0000-0000-0000-000000000000` | write probe (never-matching filter) | 401 | 42501 permission denied for table | n/a | ✅ Refused |
| `website_archetypes` (control) | table, RLS on, policy `website_archetypes_read` `TO authenticated, anon USING (is_active = true)` | 200 | none | 1 | ✅ Control works |

**Why this control:** `website_archetypes` is deliberately anon-readable (the website wizard's choices, same for every business, `20260922_website_archetypes.sql`) and is untouched by either migration. A 200 with a row proves the key, URL and PostgREST path are healthy, so the 401s above come from the revokes and not from a broken probe.

### Positive path (code read)

`app/api/pricing/config/route.ts` builds its own client with `process.env.SUPABASE_SERVICE_ROLE_KEY` and reads `.from('calculator_config').select('*').single()`. The migration keeps service_role SELECT and its in-transaction service_role probe passed, so this route is unaffected by the revoke. The TL checker (104/104) and the advisor (13 → 0) are recorded in Change History; QA did not repeat the SQL.

### Static and guard suites

`npx jest supabase/migrations/__tests__ supabase/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts scripts/__tests__/inventory-security-definer-functions.test.ts`

- **Test Suites: 40 passed, 40 total. Tests: 2130 passed, 2130 total.**
- Includes `exposed-views-slice1b.migration.test.ts`, `rls-disabled-agent-tables-anon-stopgap.migration.test.ts`, `exposed-views-slice1a.migration.test.ts`, every file in `supabase/migrations/__tests__`, `supabase/__tests__/security-definer-surface.guard.test.ts`, the admin authz surface guard and the security-definer inventory test.

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Anon cannot read any of the 13 views | ✅ | Pass | 13 × 401 / 42501 over REST |
| Anon cannot read the 6 RLS-disabled agent tables | ✅ | Pass | 6 × 401 / 42501 |
| Anon cannot write to them | ✅ | Pass | DELETE on `agent_logs` refused, 42501 |
| Intended anon access still works | ✅ | Pass | `website_archetypes` 200 |
| `calculator_config` still served by `/api/pricing/config` | ✅ (code read) | Pass | Service-role client |
| Static migration tests and guards green | ✅ | Pass | 40 suites, 2130 tests |
| Authenticated loses TRUNCATE/REFERENCES/TRIGGER/MAINTAIN | ⚠️ | Not re-probed | Needs a user session; covered by the TL checker (60/60) and the static test |
| "Share agent to template gallery" | ❌ | Not tested | Known, accepted loss until full 2c |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **`/api/pricing/config` is non-compliant (pre-existing, not part of this slice)** — it creates a Supabase client directly instead of going through `lib/repositories/` (CLAUDE.md rule 1) and has 22 `console.*` calls (rule 3). Not touched by this change; flag for a later cleanup. File: `app/api/pricing/config/route.ts`. Severity: Low.

### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

**Verdict: PASS.**

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created | Slice 1b for the 13 owner-rights views TL measured on 2026-10-13. Migration `20261059` (`20261058` stays reserved for 2c): invoker on, revoke all client privileges, keep service_role SELECT. Pre-guard on service_role base access, plus a service_role read probe in the transaction. Pre-check Q0–Q13, checker 104 checks, exact-inverse rollback, static test. Only two code readers exist: `calculator_config` (service role) and an uncalled repository method. Added the slice 2c anon-only stopgap assessment: recommend yes, with "Share to gallery" breaking until the 2c route fix. Nothing applied, nothing committed |
| 2026-10-13 | SA review | APPROVED WITH CHANGES. Reader claim independently confirmed, with one correction (`delete-duplicate-agents.ts` fallback, unaffected). Rulings: keep `20261059`; invoker + revoke; in-migration service_role probe accepted as a scoped new pattern; fail closed on column-only grants; 2c anon stopgap approved in principle, with option B included and its own SQL review owed. S-1 (Q0 must use `pg_has_role(..., 'SET')`) to fix before the pre-check; S-2 to S-5 are doc fixes |
| 2026-10-13 | S-2 to S-5 applied; 2c stopgap written | S-2 (`delete-duplicate-agents.ts` fallback), S-3 (any error in the migration tab means nothing was applied), S-4 (R-8) and S-5 (R-9) folded in. The user approved the 2c anon stopgap with the "Share to gallery" trade-off. Wrote `20261060` (anon and PUBLIC lose everything on the six tables and their owned sequences; authenticated loses TRUNCATE, REFERENCES, TRIGGER and MAINTAIN), rollback, pre-check (Q8 STOP on TRUNCATE or LOCK in a caller-rights function), checker (60 checks) and static test. PGlite dry run passed. Found that `20261058` is now taken on main by the contact documents migration. Nothing applied, nothing committed |
| 2026-10-13 | 1b applied to prod; S-1 resolved | S-1 resolved by TL (Q0 uses `pg_has_role('service_role','SET')`, `set_opt` true on prod). The user pasted `20261059` in the SQL editor: "Success. No rows returned". TL checker `VERDICT PASS 104 pass 0 fail`. Advisor `security_definer_view` 13 → 0. Not committed yet |
| 2026-10-13 | SA code review, 2c anon stopgap | APPROVED WITH CHANGES. SQL approved as written. Deviations (a) REVOKE ALL on owned sequences and (b) "anon holds all 8" report-only: both approved. Full 2c takes `20261061` or later. Q8 over-inclusion acceptable with a triage rule. SC-1 (copy Q8, Q9 and Q10 rows to SA before the migration) and SC-2 (Q8 triage rule) before the pre-check; SC-3, SC-4 low. Static tests 121/121 |
| 2026-10-14 | SC-1 to SC-4 applied; 2c stopgap applied to prod | SC-1 (copy Q8, Q9 and Q10 rows to SA) and SC-2 (Q8 triage rule) folded into Apply order step 1, SC-3 (rollback fidelity) and SC-4 (full 2c takes `20261061` or later) into "Stopgap as written". TL pre-check (read-only, 2026-10-13): CLEAN, 0 owned sequences; Q8, Q9 and Q10 cleared (one policy on `execution_routing_decisions`, anon read now errors, no public reader). The user pasted `20261060` in the SQL editor: success. TL checker `VERDICT PASS 60 pass 0 fail`. Accepted cost: "Share agent to template gallery" broken until full 2c. Still owed: QA probes, commit/PR, 24 h log watch. Not committed |
| 2026-10-14 | QA PASS | Live anon-key REST probes: 13 views and 6 tables all 401 / 42501 with no rows; DELETE on `agent_logs` refused (42501); control `website_archetypes` 200. Jest 40 suites, 2130 tests green. `/api/pricing/config` confirmed service-role. No bugs; one pre-existing Low edge case on that route. Gallery share not tested (accepted loss). Not committed |
