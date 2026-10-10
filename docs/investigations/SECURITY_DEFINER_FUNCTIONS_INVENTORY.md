# SECURITY DEFINER Functions Inventory

> **Last Updated**: 2026-10-08

## Overview

This is a read-only inventory of every `SECURITY DEFINER` function the repo defines. It is step one of the P1 queued in [PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md](/docs/workplans/PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md) §10. On 2026-09-21, production had 60 such functions in `public`. 59 of them could be executed by `anon`, and 50 of those are not triggers, so anyone holding the public anon key can call them at `POST /rest/v1/rpc/<name>`. For each function, this doc records where it is defined, whether the repo ever closed its `PUBLIC` grant, every call site, and the database role each call site runs as. That gives each function a fix class.

Nothing in this doc changes the database. The production side comes from [`scripts/inventory-security-definer-functions.sql`](/scripts/inventory-security-definer-functions.sql). The user ran it on production on 2026-10-07, and its output is in [`secdef_prod_inventory_2026-10-07.tsv`](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv). [§7](#7-production-inventory-2026-10-07) reconciles it against the repo.

**Production on 2026-10-07:**

- **75** SECURITY DEFINER functions in `public`.
- **68** can be executed by `anon`.
- **50** of those are not triggers, so they are reachable over PostgREST.
- **20 functions exist only in production**, with no definition anywhere in the repo.
- **4 repo functions are not SECURITY DEFINER in production.**

**Since then:** slice 1 (`20261044`, applied 2026-10-08) closed 13 functions, so **55** remain anon-executable (37 non-trigger). Arithmetic from the counts above, not a re-run of the inventory script. Per-slice state lives in the requirement [§4.3](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md#43-slice-status).

## Table of Contents

1. [Method](#1-method)
2. [Why the existing revokes did not work](#2-why-the-existing-revokes-did-not-work)
3. [Classes](#3-classes)
4. [Per-function map](#4-per-function-map)
5. [Top risks](#5-top-risks)
6. [Proposed slices](#6-proposed-slices)
7. [Production inventory (2026-10-07)](#7-production-inventory-2026-10-07)
8. [Open questions](#8-open-questions)
9. [Change History](#change-history)

---

## 1. Method

| Step | How |
|---|---|
| Definitions | Every `CREATE [OR REPLACE] FUNCTION` in `supabase/migrations/`, `supabase/SQL Scripts/`, `supabase/held/` and `scripts/*.sql` was parsed. Comments were stripped first, and `SECURITY DEFINER` / `SET search_path` were read from the function's header and trailer. Definitions were sorted by the date in the file name, so `2026-08-14_…` sorts as `20260814`. **The latest definition wins.** The comparison is by name. The repo has no overloads among these functions |
| Grants | Every `GRANT` / `REVOKE … ON FUNCTION` in the same files |
| TS callers | `.rpc('<name>'` and constant-named `.rpc(CONST` in `app/ lib/ components/ hooks/ scripts/`, excluding tests. Each call was traced back through its constructor or getter to the client that was injected |
| SQL callers | `PERFORM` / assignment calls inside other functions, `CREATE TRIGGER … EXECUTE FUNCTION`, RLS policy expressions. **No `cron.schedule` / pg_cron job exists in the repo**. Every drain is a Vercel cron route running as `service_role` |
| Browser callers | **None.** No `'use client'` file calls `.rpc(`. The only browser-client caller is `lib/services/workflowService.ts`, which calls `get_user_workflow_stats`. It is imported only from `components/orchestration-NOT-USED/` |

Role at a call site:

| Client | Role in PostgREST |
|---|---|
| `supabaseServer`, `createServerSupabaseClient()`, any `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` | `service_role` |
| `createAuthenticatedServerClient()` (`supabaseServerAuth`) | `authenticated` |
| `supabaseClient` (browser) | `authenticated` / `anon` |
| Trigger, or a call from inside another SECURITY DEFINER function | function owner (the caller's EXECUTE grant is irrelevant) |

**Source key:** **M** = `supabase/migrations`. **S** = `supabase/SQL Scripts`: not a tracked migration, but in the prod list, so it looks applied. **H** = `supabase/held`: not applied.

---

## 2. Why the existing revokes did not work

Two grants have to be closed, and most of the repo closes only one of them.

1. **`PUBLIC`.** PostgreSQL grants EXECUTE on every new function to `PUBLIC`. `REVOKE … FROM anon, authenticated` does not touch it, and that is the pattern of the ten claim/reap functions and of `20260922_verified_questions.sql`.
2. **Explicit grants to `anon` / `authenticated`.** Supabase projects normally carry `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT … ON FUNCTIONS TO anon, authenticated, service_role`. That gives each new function an explicit `anon` entry, so `REVOKE … FROM PUBLIC` on its own does not close anon either. `is_platform_admin` (`20260920a`) has exactly this pattern. It revokes from PUBLIC and grants to authenticated and service_role, but it never revokes from anon. Summary row 12 of the SQL inventory confirms the default ACL.

The load-bearing clause is `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;`, followed by `GRANT EXECUTE … TO service_role` (and to `authenticated` where that is needed). This was reproduced locally against PGlite with Supabase-shaped default privileges: a function revoked only `FROM anon, authenticated` still measured `x_anon = true` through PUBLIC.

**Production confirms both causes (2026-10-07).** The default privileges on new functions in `public` grant EXECUTE to `postgres, anon, authenticated, service_role`, and they do so for **both** owners, `postgres` and `supabase_admin`. The EXECUTE grantees fall into four shapes:

| Grantees in prod | Count | Functions | Anon reaches it through |
|---|---|---|---|
| `PUBLIC postgres anon authenticated service_role` | 54 | every other open function | PUBLIC **and** explicit entries |
| `PUBLIC postgres service_role` | 13 | `claim_due_*` ×5, `reap_stale_*` ×5, `increment_verified_question_uses`, `match_verified_questions`, `record_business_event` | **PUBLIC only**. The explicit anon/authenticated entries were revoked, but PUBLIC survives |
| `postgres anon authenticated service_role` | 1 | `is_platform_admin` | **explicit anon only**. PUBLIC was revoked, but the explicit anon entry survives |
| `postgres service_role` | 7 | closed (see §7.3) | — |

**So every fix migration uses `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` for every function**, whichever shape it has. Revoking an entry that is not there is a harmless no-op. The checker and the in-migration post-conditions must assert **`has_function_privilege` outcomes**, meaning `public`, `anon` and `authenticated` are false and `service_role` is true. They must not assert ACL text, because the shapes differ between functions.

---

## 3. Classes

| Class | Meaning | Fix |
|---|---|---|
| **1** | Only `service_role` (or the owner, via trigger or internal SQL) calls it | `REVOKE ALL … FROM PUBLIC, anon, authenticated`. Keep or grant `service_role` |
| **2** | A user-cookie (`authenticated`) server client calls it | Revoke from `PUBLIC, anon`. Keep `authenticated`. **Flag** when it trusts a caller-supplied user id instead of `auth.uid()` |
| **3** | Needs `anon` | None found |
| **4** | Trigger function | EXECUTE is checked only at `CREATE TRIGGER`, not when the trigger fires. Low priority. Revoke for hygiene |
| **5** | No caller found (dead?) | Revoke from all client roles. Dropping it is a separate decision |

**Counts (production, 75 functions: the 55 shared with the repo plus the 20 that exist only in prod):**

| Class | In prod | Already closed in prod | Still open (anon-executable) |
|---|---|---|---|
| 1 service_role / internal only | 34 | 5 (`purge_schema_introspect`, `update_overdue_installments`, `claim_auth_handoff_code`, `business_os_auth_email_has_account`, `operator_test_account_cleanup`) | 29 |
| 2 needs authenticated | 7 | 0 | 7 |
| 3 needs anon | 0 | — | 0 |
| 4 trigger | 20 | 2 (`business_os_plan_fact_onboarding`, `business_os_plan_fact_profile`) | 18 |
| 5 no caller found | 14 | 0 | 14 |
| **Total** | **75** | **7** | **68** (matches prod: 50 non-trigger + 18 trigger) |

**Counts (repo-side map, 59 functions: 58 applied plus 1 held; this was the first pass, before production was measured):**

| Class | Count | Of which already closed in repo |
|---|---|---|
| 1 service_role / internal only | 32 | 5 (`purge_schema_introspect`, `update_overdue_installments`, `claim_auth_handoff_code`, `business_os_auth_email_has_account`, `purge_business_data` (held)) |
| 2 needs authenticated | 7 | 0 (`is_platform_admin` is closed to PUBLIC but probably not to anon) |
| 3 needs anon | 0 | — |
| 4 trigger | 13 | 2 (`business_os_plan_fact_*`) |
| 5 no caller found | 7 | 0 |
| **Total** | **59** | |

`update_overdue_installments` is counted in class 1. It has no TS caller, and 20261004 already closed it. The 20 functions that exist only in production are classified in [§4.5](#45-production-only-functions-no-repo-definition).

---

## 4. Per-function map

Abbreviations: **SR** = service_role. **AU** = authenticated. **own** = owner (trigger / internal). **Revoke?** = whether the repo's latest grants close PUBLIC *and* anon. "anon,auth only" means PUBLIC survives.

### 4.1 Class 1: service_role or internal only

| Function (args) | Src / latest def | Revoke? | Call sites → role | Notes |
|---|---|---|---|---|
| `claim_due_payment_reminders(p_runner uuid, p_batch int)` | M `2026-08-14_payment_reminders_claim` | anon,auth only | `PaymentReminderRepository.ts:222` (default `supabaseServer`; `PaymentReminderService(supabaseServer)`) → SR | **No secret.** Returns `SETOF payment_reminders`, so anon can read and claim every tenant's queue |
| `reap_stale_payment_reminders(p_lease_seconds int, p_max_attempts int)` | M same | anon,auth only | `PaymentReminderRepository.ts:247` → SR | **No secret.** `p_lease_seconds = 0` reaps live leases |
| `claim_due_payment_automation_executions(uuid, int)` | M `2026-08-14_payment_automation_executions_claim` | anon,auth only | `PaymentAutomationRepository.ts:335` → SR | as above |
| `reap_stale_payment_automation_executions(int, int)` | M same | anon,auth only | `PaymentAutomationRepository.ts:360` → SR | as above |
| `claim_due_daily_briefings(uuid, int)` | M `20260911_daily_briefing` | anon,auth only | `DailyBriefingSendRepository.ts:72` → SR | as above |
| `reap_stale_daily_briefings(int, int)` | M same | anon,auth only | `DailyBriefingSendRepository.ts:95` → SR | as above |
| `claim_due_lead_responses(uuid, int)` | M `20260914_lead_responses` | anon,auth only | `LeadResponseRepository.ts:131` → SR | as above |
| `reap_stale_lead_responses(int, int)` | M same | anon,auth only | `LeadResponseRepository.ts:145` → SR | as above |
| `claim_due_insight_actions(uuid, int)` | M `20260917_insight_actions` | anon,auth only | `InsightActionRepository.ts:120` → SR | as above |
| `reap_stale_insight_actions(int, int)` | M same | anon,auth only | `InsightActionRepository.ts:139` → SR | as above |
| `pg_try_advisory_lock(lock_id bigint)` | S `20260129_add_advisory_lock_functions` | none | `lib/utils/distributedLock.ts:53,77` (own service-key client) → SR, from the calibrate routes | **No secret.** Lock ids are a string hash in code. anon can hold any lock |
| `pg_advisory_unlock(lock_id bigint)` | S same | none | `distributedLock.ts:116` → SR | anon can release |
| `search_business_chat_plans_semantic(query_embedding, p_catalog_version, p_language, p_user_id, …)` | M `20260826_business_chat_plan_cache` | none | `bizql/cache/PlanCache.ts:239` → SR | **Caller-supplied `p_user_id`**: a cross-tenant read of cached plans |
| `record_business_chat_plan_outcome(p_id uuid, p_success bool)` | M same | none | `PlanCache.ts:443` → SR | counter write by row id |
| `match_verified_questions(query_embedding, p_user_id, p_language, …)` | M `20260922_verified_questions` | anon,auth only | `bizql/planner/VerifiedQuestions.ts:152` → SR | **Caller-supplied `p_user_id`**: cross-tenant read |
| `increment_verified_question_uses(p_ids uuid[])` | M same | anon,auth only | `VerifiedQuestions.ts:166` → SR | counter write by id |
| `get_or_create_user_organization(p_user_id uuid)` | M `20260615_add_organizations` | none | `OrganizationRepository.ts:209` (default `supabaseServer`; all `OrganizationService` instances use the default) → SR. Also called by the trigger `auto_set_agent_org_id` → own | **Caller-supplied id, write**: creates an org for any user |
| `check_subdomain_available(subdomain_to_check text)` | M `20260726_enhance_website_tables` | none | `WebsitePageRepository.ts:438` (every instance gets `supabaseServer`) → SR | enumeration only. Low |
| `generate_subdomain(business_name text)` | M same | none | `WebsitePageRepository.ts:451` → SR | low |
| `upsert_intent_example(…)` | M `20260629_intent_examples_table` | none | `IntentExampleRepository.ts:75` via `getIntentExampleRepository(supabaseServer)` (`app/api/agents/[id]`, `app/api/v6/generate-ir-intent-contract`) → SR | **Platform-wide write**: poisons V6 few-shot examples for every user |
| `find_similar_intent_examples(p_plugins, …)` | M same | none | `IntentExampleRepository.ts:110` → SR | reads stored user inputs across tenants |
| `record_intent_example_usage(p_example_id, p_success)` | M same | none | `IntentExampleRepository.ts:137` → SR | counter write |
| `upsert_workflow_pattern(…)` | M `20260629_platform_learning_tables` | none | `PatternExtractor.ts:92` via `getPatternExtractor(supabaseServer)` → SR | platform-wide write |
| `get_similar_patterns(p_plugins, p_limit)` | M same | none | `PatternExtractor.ts:131` → SR | platform data read |
| `record_global_failure(…)` | M same | none | `GlobalFailureMonitor.ts:71` via `getGlobalFailureMonitor(supabaseServer)` → SR | platform-wide write |
| `get_active_failures(p_plugin, p_action)` | M same | none | `GlobalFailureMonitor.ts:101` → SR | platform data read |
| `advance_contact_stage(p_user_id, p_contact_id, p_target_type, p_only_from)` | M `20260920_pipeline_transitions` | none | no TS caller. Called only by the SECDEF triggers `promote_contact_on_payment` / `advance_contact_on_completed_booking` → own | **Caller-supplied ids, cross-tenant CRM write.** No client role needs it |
| `update_overdue_installments()` | M `20260723_enhance_payments` | **yes** (20261004) | no TS caller | **zero args**. Closed in prod per §5.3 of the lockdown workplan |
| `purge_schema_introspect()` | M `20260915a` | **yes** | `BusinessPurgeRepository.ts:289`, `scripts/purge-schema-reconcile.ts` → SR | zero args. Closed |
| `claim_auth_handoff_code(p_code text)` | M `20261005_auth_handoff_codes` | **yes** (PUBLIC, anon, authenticated) | `app/api/auth/handoff/redeem/route.ts:52` → SR | closed |
| `business_os_auth_email_has_account(p_email text)` | M `20261013` | **yes** | `AuthAccountRepository.ts:100` (default `supabaseServer`) → SR | closed |
| `purge_business_data(p_user_id, p_level, p_options, p_tables)` | **H** `20260916b` | **yes** (in the held file) | `BusinessPurgeRepository.ts:507,543` → SR | not applied |

### 4.2 Class 2: needs authenticated

| Function (args) | Src / latest def | Revoke? | Call sites → role | Tenant id |
|---|---|---|---|---|
| `is_platform_admin()` | M `20260920a` | PUBLIC only. **Prod: explicit anon entry, no PUBLIC entry** | RLS policies on `ai_model_pricing` / `system_settings_config`, all `TO authenticated` → AU | `auth.uid()`, safe. Revoking anon is safe because no policy applies it to anon |
| `get_top_insights(p_limit int)` | S `20260601_fix_execution_insights_schema` | none | `InsightRepository.getTopInsights` ← `app/api/v6/insights/route.ts` (`createAuthenticatedServerClient`) → AU | `auth.uid()`, safe |
| `increment_executions_used(p_user_id uuid)` | S `20251117_complete_quota_system` | none | `ExecutionService.ts:166` ← `StateManager.ts:147/236` with the pilot's client: **AU** from `run-agent`, `run-agent-sandbox`, `calibrate/resume`, `v2/calibrate/batch` (non-admin); **SR** from sentinel, `v6/execute-test`, `DryRunValidator` | **Trusts `p_user_id`.** Cross-tenant write to a money-adjacent counter (open S-6 P1) |
| `update_execution_baseline(p_agent_id, p_user_id, …)` | M `20260629_execution_optimization_tables` | none | `BaselineService.ts:115` ← `WorkflowPilot.ts:2532` (pilot client: AU or SR as above). Also `app/api/insights` → SR | **Trusts `p_user_id`** |
| `record_execution_anomaly(p_agent_id, p_execution_id, p_user_id, …)` | M same | none | `AnomalyDetector.ts:462` ← `WorkflowPilot.ts:2544` → AU/SR | **Trusts `p_user_id`** |
| `upsert_error_pattern(p_user_id, p_agent_id, …)` | M `20260629_error_patterns_table` | none | `ErrorPatternRepository.ts:103` ← `ErrorPatternService` ← `StepExecutor.ts:624`, `ErrorRecovery.ts:330,367` (pilot client) → AU/SR | **Trusts `p_user_id`** |
| `record_auto_fix_result(p_pattern_id, p_success)` | M same | none | `ErrorPatternRepository.ts:363` → AU/SR | any pattern id. Counter write |

The class 2 rows are inferred from tracing the pilot's client. Before slice 4, confirm them by checking that each pilot method actually reaches the RPC on the user-cookie path.

### 4.3 Class 4: trigger functions (owner context)

| Function | Src / latest def | Revoke? | Trigger |
|---|---|---|---|
| `advance_contact_on_completed_booking()` | M `20260920_pipeline_transitions` | none | `advance_contact_on_completed_booking_trigger` |
| `promote_contact_on_payment()` | M same | none | `promote_contact_on_payment_trigger` |
| `promote_contact_on_confirmed_booking()` | M `20260918` | none | `promote_contact_on_confirmed_booking_trigger`. **Not SECURITY DEFINER in prod** (§7.2) |
| `auto_set_agent_org_id()` | M `20260615_add_organizations` | none | `trigger_auto_set_agent_org_id` |
| `business_os_plan_fact_onboarding()` | M `20261005` (+ `20261009` fix) | **yes** | entitlements plan-fact |
| `business_os_plan_fact_profile()` | M same | **yes** | entitlements plan-fact |
| `create_user_settings()` | M `20261003` | none | `create_user_settings_trigger` |
| `increment_smart_link_click_count()` | M `20260824_add_conversion_layer` | none | smart-link click trigger |
| `link_subscriber_to_contact()` | M `20260931_business_subscribers` | none | `trg_link_subscriber_to_contact` |
| `log_crm_contact_created()` | M `20260722_crm_contact_creation_activity` | none | `log_crm_contact_created_trigger`. **Not SECURITY DEFINER in prod** (§7.2) |
| `log_document_activity()` | M `20260722_create_contact_documents` | none | `log_document_activity_trigger` |
| `marketing_consent_project()` | M `20260930_marketing_consent` | none | marketing-consent projection |
| `update_user_storage_used()` | S `20251117_complete_quota_system` | none | storage trigger |

### 4.4 Class 5: no caller found

| Function (args) | Src / latest def | Revoke? | Notes |
|---|---|---|---|
| `auto_disable_ineffective_behavior_rules(p_min_applications int DEFAULT 10, p_min_effectiveness decimal DEFAULT 0.3)` | M `20260629_enhance_behavior_rules` | none | **Callable with no args** (all defaulted). anon can disable rules platform-wide, and passing `p_min_effectiveness = 1` disables nearly all of them |
| `match_behavior_rules(p_user_id, p_agent_id, …)` | M same | none | **Caller-supplied `p_user_id`**: cross-tenant read |
| `record_behavior_rule_result(p_rule_id, p_success)` | M same | none | counter write by id |
| `check_execution_anomaly(p_agent_id, p_execution_id, p_user_id, …)` | M `20260629_execution_optimization_tables` | none | **Caller-supplied `p_user_id`**: cross-tenant read of baselines |
| `dismiss_setup_step(p_user_id, p_step_id)` | M `20260802_add_dismissed_setup_steps…` | none | **Caller-supplied `p_user_id`, write** to `business_profiles` |
| `upsert_plugin_performance(p_agent_id, p_user_id, …)` | M `20260629_plugin_performance_table` | none | `PluginPerformanceService.recordExecution` has no caller. **Caller-supplied `p_user_id`, write** |
| `insert_audit_log(p_action, p_entity_type, …, p_user_id, …)` | S `20251030_create_audit_log_function` | none | only `scripts/test-audit-function.ts` (SR). **Not SECURITY DEFINER in prod** (absent from the 2026-10-07 inventory), so it is out of scope |

### 4.5 Production-only functions (no repo definition)

These 20 were created outside any tracked migration, by the dashboard or by an untracked script. Their call sites were searched in the same way as in §1.

| Function (prod args) | Call sites → role | Class | Prod grantees | Notes |
|---|---|---|---|---|
| `get_user_credit_balance(p_user_id uuid)` | none | 5 | open, full | **Caller-supplied id**: cross-tenant read of the credit balance |
| `get_user_subscription_info(p_user_id uuid)` | none | 5 | open, full | **Caller-supplied id**: cross-tenant read of the plan |
| `get_user_usage_summary(target_user_id uuid, days_back int)` | none | 5 | open, full | **Caller-supplied id**: cross-tenant read of usage |
| `get_user_workflow_stats(target_user_id uuid)` | `lib/services/workflowService.ts:828` (browser `supabaseClient`), imported only by `components/orchestration-NOT-USED/` → effectively none | 5 | open, full | **Caller-supplied id**: cross-tenant read |
| `has_sufficient_credits(p_user_id uuid, p_required_credits int)` | none | 5 | open, full | **Caller-supplied id**: a balance oracle |
| `is_reward_eligible(p_user_id uuid, p_reward_key varchar)` | none | 5 | open, full | **Caller-supplied id** |
| `get_last_perfect_calibration(p_agent_id uuid, p_user_id uuid)` | none | 5 | open, full | **Caller-supplied ids**: cross-tenant read of calibration results |
| `get_unviewed_insights_count(p_agent_id uuid)` | `InsightRepository.getUnviewedCount` (`lib/repositories/InsightRepository.ts:208`), which has no caller | 5 | open, full | any agent id. Low |
| `increment_calibration_count(p_agent_id uuid)` | `lib/pilot/shadow/ShadowAgent.ts:306` ← `new ShadowAgent(supabaseAdmin, …)` in `WorkflowPilot.ts:577,2954` (service-role key) → SR | 1 | open, full | counter write on any agent |
| `record_business_event(p_user_id, p_event_type, …, p_occurred_at)` (10 args) | no TS caller. Presumably called by the `tg_*_events` triggers → own | 1 (**uncertain**) | PUBLIC only | **Caller-supplied `p_user_id`, write**: anon can forge business events, which feed the Insights detectors for any tenant |
| `operator_test_account_cleanup(p_mode, p_email, p_tag, p_confirm, p_actor, p_secret)` | SQL editor / OX-1 runbook (PR #244). The Danger Zone requirement may add a server caller | 1 | **closed** | already service_role only |
| `log_exchange_rate_change()` | trigger | 4 | open, full | — |
| `tg_activity_reply_events()`, `tg_booking_events()`, `tg_contact_events()`, `tg_invoice_events()`, `tg_page_view_events()`, `tg_proposal_events()`, `tg_service_events()`, `tg_transaction_events()` | triggers (8) | 4 | open, full | all pin `search_path = public` |

"open, full" means the grantees are `PUBLIC postgres anon authenticated service_role`.

---

## 5. Top risks

Worst first. Each one was **confirmed open in production on 2026-10-07**.

1. **Queue claim/reap (10 functions).** Production grantees are `PUBLIC postgres service_role`, so anon executes them **through PUBLIC alone**. No argument is a secret: a random uuid and two ints are enough. anon can claim, and thereby *read*, every tenant's queued payment reminders, payment automations, briefings, lead responses and insight actions, because the functions return the whole row. anon can also stall the drains, or reap live leases with `p_lease_seconds = 0`.
2. **Caller-supplied-id reads, the money and plan facts:** `get_user_credit_balance`, `get_user_subscription_info`, `get_user_usage_summary`, `get_user_workflow_stats`, `has_sufficient_credits`, `is_reward_eligible` and `get_last_perfect_calibration`. All seven take the tenant id as an argument, and **none has a live caller**, so closing them breaks nothing.
3. **Caller-supplied-id writes:**
   - `increment_executions_used` (quota/money)
   - `record_business_event`: forged events reach the Insights detectors
   - `advance_contact_stage`: changes the CRM stage of any contact
   - `dismiss_setup_step`
   - `get_or_create_user_organization`
   - `upsert_error_pattern`
   - `update_execution_baseline`
   - `record_execution_anomaly`
   - `upsert_plugin_performance`
4. **Callable with no args (3 in prod):**
   - `auto_disable_ineffective_behavior_rules` (both args defaulted) mutates rules platform-wide.
   - `get_top_insights` (`p_limit` defaulted) is scoped by `auth.uid()`, so anon gets nothing. Low.
   - `is_platform_admin`, which takes zero args, reaches anon through an explicit grant and returns false for anon. Info only.
5. **`pg_try_advisory_lock` / `pg_advisory_unlock`** are open to anon, who can hold or release the calibration locks. The lock id is a string hash that can be read from the public repo.
6. **Other caller-supplied-id reads:** `search_business_chat_plans_semantic`, `match_verified_questions` (PUBLIC only), `match_behavior_rules`, `check_execution_anomaly`.
7. **Platform-wide poisoning:** `upsert_intent_example`, `upsert_workflow_pattern`, `record_global_failure` feed V6 generation for every user. `find_similar_intent_examples` also returns other users' normalised prompts.
8. **Missing pinned `search_path`: 47 functions** (§6, slice 7).

`exec_sql` / `get_table_constraints` **do not exist in prod**. The 14 `exec_sql` and 2 `get_table_constraints` call sites in `scripts/` are dead code. Clean them up separately, outside this P1.

---

## 6. Proposed slices

Every slice reuses the 20261039/20261040 pattern:

- a read-only `scripts/precheck-*.sql`
- one `BEGIN … COMMIT` migration with in-transaction post-conditions
- a read-only `scripts/check-*.sql`
- a rollback in `supabase/SQL Scripts/`
- a static test in `supabase/migrations/__tests__/`

Inside every migration, for every function:

1. `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated`. This holds for all three prod grantee shapes (§2).
2. `GRANT EXECUTE … TO service_role`, which is idempotent.
3. For class 2 only, `GRANT EXECUTE … TO authenticated`.

The post-condition `DO` block asserts **`has_function_privilege` outcomes**, never ACL text: `public` false, `anon` false, `authenticated` false (true for class 2), `service_role` true. It also guards each function with `to_regprocedure(...) IS NOT NULL`.

The migration must name the **prod identity signatures** taken from the TSV. Examples are `numeric` rather than `decimal`, and `vector` for the `vector(1536)` arguments. The prod-only functions exist only by those signatures. Each rollback re-grants the exact pre-state shape recorded in §2 per function, which the pre-check confirms.

**Migration numbers: slice 1 is `20261044`.** `20261041` and `20261042` were taken on main on 2026-10-07 by the two `operator_test_account_cleanup` migrations, and `20261043` is claimed by open PR #256 (SA C-1, then re-checked by Dev). Each later slice takes the next free number at PR time against `origin/main`. The binding plan, with SA's conditions and rulings, is [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md).

| # | Migration | Scope | Functions | Count | Code change | Why this order |
|---|---|---|---|---|---|---|
| 0 | — | Inventory (this) | — | — | none | done |
| 1 | `20261044` | Drain machinery and no-arg mutators → SR only | `claim_due_daily_briefings`, `claim_due_insight_actions`, `claim_due_lead_responses`, `claim_due_payment_automation_executions`, `claim_due_payment_reminders`, `reap_stale_daily_briefings`, `reap_stale_insight_actions`, `reap_stale_lead_responses`, `reap_stale_payment_automation_executions`, `reap_stale_payment_reminders`, `pg_try_advisory_lock`, `pg_advisory_unlock`, `auto_disable_ineffective_behavior_rules` | 13 | none | Worst exposure. Every caller is already SR (crons and the service-key lock client). **✅ Done 2026-10-08** (PR #261, applied on prod, checker PASS 78/0) |
| 2 | `20261048` | Dead and prod-only cross-tenant readers/writers → SR only | `get_user_credit_balance`, `get_user_subscription_info`, `get_user_usage_summary`, `get_user_workflow_stats`, `has_sufficient_credits`, `is_reward_eligible`, `get_last_perfect_calibration`, `get_unviewed_insights_count`, `match_behavior_rules`, `record_behavior_rule_result`, `check_execution_anomaly`, `dismiss_setup_step`, `upsert_plugin_performance` | 13 | none | No live caller, so zero breakage risk, and they are the highest-value tenant leaks. Dropping them is a later, separate decision **✅ Done 2026-10-09** (PR #277 merged 2026-10-09, `4724b727`; applied on prod 15:48 UTC, checker PASS 78/0) |
| 3 | `20261049` | Remaining SR / internal callables → SR only, plus close anon on `is_platform_admin` | `search_business_chat_plans_semantic`, `record_business_chat_plan_outcome`, `match_verified_questions`, `increment_verified_question_uses`, `get_or_create_user_organization`, `check_subdomain_available`, `generate_subdomain`, `upsert_intent_example`, `find_similar_intent_examples`, `record_intent_example_usage`, `upsert_workflow_pattern`, `get_similar_patterns`, `record_global_failure`, `get_active_failures`, `advance_contact_stage`, `increment_calibration_count`, `record_business_event`; plus `is_platform_admin` (revoke PUBLIC and anon, keep authenticated) | 17 + 1 | none | Every caller is SR or the owner (trigger / internal SQL). `is_platform_admin`'s policies are all `TO authenticated`. Pre-check `record_business_event`'s callers first (§8). **🟡 Code complete, SA code-approved and QA PASS 2026-10-10** ([SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md); PR number added at PR time) |
| 4a | next | Class 2: close PUBLIC and anon, keep authenticated | `increment_executions_used`, `update_execution_baseline`, `record_execution_anomaly`, `upsert_error_pattern`, `record_auto_fix_result`, `get_top_insights` | 6 | none | Removes the anonymous path now. Signed-in users can still forge rows for another tenant until 4b |
| 4b | maybe one | Class 2 tenant fix | the 5 id-trusting ones from 4a | 5 | **yes** | Either move the pilot's RPC calls onto the SR client server-side, then revoke `authenticated`, or have the functions derive or assert `auth.uid()`. SA decides. `increment_executions_used` is the S-6 P1 |
| 5 | next | Trigger functions → no client EXECUTE | `advance_contact_on_completed_booking`, `auto_set_agent_org_id`, `create_user_settings`, `increment_smart_link_click_count`, `link_subscriber_to_contact`, `log_document_activity`, `log_exchange_rate_change`, `marketing_consent_project`, `promote_contact_on_payment`, `update_user_storage_used`, `tg_activity_reply_events`, `tg_booking_events`, `tg_contact_events`, `tg_invoice_events`, `tg_page_view_events`, `tg_proposal_events`, `tg_service_events`, `tg_transaction_events` | 18 | none | Hygiene only. EXECUTE is not checked when a trigger fires, and none of them is reachable over `/rpc` |
| 6 | — | CI guard | migrations | — | test only | A static ratchet: any new `SECURITY DEFINER` in a migration must carry `REVOKE … FROM PUBLIC, anon, authenticated` and `SET search_path` in the same file. **Land it right after slice 1** so the set cannot grow while 2–5 are in flight. Optional `ALTER DEFAULT PRIVILEGES` change: SA decides, and it must cover **both** `postgres` and `supabase_admin`. **✅ Done 2026-10-09** (PR #271 merged 2026-10-08, `f885570d`; merge block proven by throwaway PR #274) |
| 7 | next | Pin `search_path` | the 47 with no pinned path (list below) | 47 | none | **Its own slice, last, and not folded in.** Revokes are pure privilege changes that are trivially reversible and checked by `has_function_privilege`. `ALTER FUNCTION … SET search_path` changes how every unqualified name in the body resolves, so each body needs reading, and a wrong value (`''`) breaks the function at runtime. Mixing the two widens each slice's blast radius. After slices 1–5, no client role can execute these functions, so search-path hijacking (which needs a caller-controlled path or a writable schema earlier in it) drops to low. Use `public, pg_temp` to match what the bodies already assume |

**Counts per slice:** 13 + 13 + 18 + 6 + 18 = **68**, which equals the 68 anon-executable functions in prod. Slice 4b changes code but no new functions, and slice 7 covers 47 functions that are already counted in earlier slices or among the 7 already closed.

Slice 7's 47 functions:
- advance_contact_on_completed_booking, advance_contact_stage, auto_disable_ineffective_behavior_rules, auto_set_agent_org_id
- check_execution_anomaly, check_subdomain_available, create_user_settings, dismiss_setup_step
- find_similar_intent_examples, generate_subdomain, get_active_failures, get_last_perfect_calibration
- get_or_create_user_organization, get_similar_patterns, get_top_insights, get_unviewed_insights_count
- get_user_credit_balance, get_user_subscription_info, get_user_usage_summary, get_user_workflow_stats
- has_sufficient_credits, increment_calibration_count, increment_executions_used, increment_smart_link_click_count
- is_reward_eligible, link_subscriber_to_contact, log_document_activity, log_exchange_rate_change
- marketing_consent_project, match_behavior_rules, pg_advisory_unlock, pg_try_advisory_lock
- promote_contact_on_payment, record_auto_fix_result, record_behavior_rule_result, record_business_chat_plan_outcome
- record_execution_anomaly, record_global_failure, record_intent_example_usage, search_business_chat_plans_semantic
- update_execution_baseline, update_overdue_installments, update_user_storage_used, upsert_error_pattern
- upsert_intent_example, upsert_plugin_performance, upsert_workflow_pattern

The other 28 are already pinned: 22 to `public`, 3 to `pg_catalog, public[, pg_temp]`, and 3 to `''`. That is acceptable and not in scope.

---

## 7. Production inventory (2026-10-07)

Source: [`secdef_prod_inventory_2026-10-07.tsv`](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv). The user ran it read-only in the Supabase SQL editor.

### 7.1 Summary facts

| Measure | Prod 2026-10-07 | Baseline 2026-09-21 |
|---|---|---|
| SECURITY DEFINER functions in `public` | **75** | 60 |
| anon-executable | **68** | 59 |
| anon-executable, non-trigger (reachable over `/rest/v1/rpc/`) | **50** | 50 |
| anon non-trigger, zero args | **1** (`is_platform_admin`) | — |
| anon non-trigger, callable with no args (all args defaulted) | **3** (+ `auto_disable_ineffective_behavior_rules`, `get_top_insights`) | — |
| authenticated-executable, non-trigger | **50** | — |
| PUBLIC holds an explicit EXECUTE entry | **67** | — |
| service_role cannot execute | **0** | — |
| missing pinned `search_path` | **47** | — |
| Default privileges on new functions in `public` | `postgres` **and** `supabase_admin`: `{postgres, anon, authenticated, service_role} = X`. This confirms the second cause in §2 | — |
| `exec_sql` / `get_table_constraints` in `public` | **absent** | — |
| SECURITY DEFINER in other non-system schemas | `pgbouncer` 1, `vault` 2. **None anon-executable** | — |
| `authenticator` role pgrst settings | none set on the role. The exposed schemas are configured at the platform level | — |

### 7.2 Reconciliation: repo (59) vs prod (75)

The two sets share 55 functions. Prod has 20 functions with no repo definition, and the repo has 4 functions that do not appear as SECURITY DEFINER in prod. 55 + 20 = 75, and 55 + 4 = 59.

**In prod, not defined in any repo SQL (20)**. They are classified in §4.5.
- `get_last_perfect_calibration`, `get_unviewed_insights_count`, `get_user_credit_balance`, `get_user_subscription_info`
- `get_user_usage_summary`, `get_user_workflow_stats`, `has_sufficient_credits`, `increment_calibration_count`
- `is_reward_eligible`, `log_exchange_rate_change`, `operator_test_account_cleanup`, `record_business_event`
- `tg_activity_reply_events`, `tg_booking_events`, `tg_contact_events`, `tg_invoice_events`
- `tg_page_view_events`, `tg_proposal_events`, `tg_service_events`, `tg_transaction_events`

**In the repo, not SECURITY DEFINER in prod (4):**

| Function | Repo source | Likely reason |
|---|---|---|
| `purge_business_data` | H `20260916b` | held, not applied. Expected |
| `insert_audit_log` | S `20251030_create_audit_log_function` | never applied, or replaced. Only a test script calls it |
| `log_crm_contact_created` | M `20260722_crm_contact_creation_activity` | either not applied, or applied as SECURITY INVOKER. **Check** (§8) |
| `promote_contact_on_confirmed_booking` | M `20260918_promote_client_on_confirmed_booking` | **Expected — not a gap.** `20260920_pipeline_transitions.sql:162-163` drops it on purpose; replaced by `advance_contact_on_completed_booking` (in prod) |

### 7.3 Already closed in prod (7)

Grantees are `postgres service_role`, and anon, authenticated and PUBLIC all measure false:

- `business_os_auth_email_has_account`
- `business_os_plan_fact_onboarding`, `business_os_plan_fact_profile` (triggers)
- `claim_auth_handoff_code`
- `operator_test_account_cleanup`
- `purge_schema_introspect`
- `update_overdue_installments`

---

## 8. Open questions

1. **`record_business_event` callers.** The class 1 assumption is that only the `tg_*_events` triggers call it. Before slice 3, a read-only `pg_proc.prosrc` search should confirm that nothing else calls it, and that no Edge Function or external service calls it with a client key.
2. **`log_crm_contact_created`** is missing from the prod SECURITY DEFINER list. Was it never applied, or applied as INVOKER? This matters for the CRM timeline, not for this P1; reported to Offir 2026-10-07 (requirement BQ-1). (`promote_contact_on_confirmed_booking` is answered: dropped on purpose by `20260920_pipeline_transitions.sql`.)
3. **Prod-only definitions are not in git.** Should slice 2 also capture their DDL (via `pg_get_functiondef`) under `supabase/SQL Scripts/`, so the repo becomes the source of truth again?
4. **Slice 4b fix shape:** use the SR client in the pilot, or `auth.uid()` in the functions? SA decides.
5. **Class 5:** revoke now and drop later after a log check (recommended), or drop now?
6. **`ALTER DEFAULT PRIVILEGES`** for both `postgres` and `supabase_admin`: in scope for slice 6, or not?
7. The class 2 rows rest on tracing which client the pilot receives, not on runtime checks. Confirm them before slice 4b. Slice 4a is safe either way, because it keeps `authenticated`.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-07 | Created | Code-side map of 59 SECURITY DEFINER functions (58 applied, 1 held), classification, top risks and slicing proposal. Production SQL inventory script and static test added. No database change |
| 2026-10-07 | Production inventory merged | The user's prod run (75 functions, 68 anon-executable, 50 non-trigger) was reconciled against the repo: 20 functions exist only in prod (§4.5) and 4 repo functions are not SECURITY DEFINER in prod (§7.2). §2 records the three prod grantee shapes and the fact that default privileges cover both owners. Prod-based class counts. Final slices 1–7 with per-slice function lists (13 / 13 / 18 / 6 / 18 = 68) and a separate search_path slice (47). `exec_sql` is absent from prod, so its `scripts/` callers are dead. No database change |
| 2026-10-07 | Migration number corrected (BA) | §6: slice 1 is now `20261042`, because `20261041` was taken on main by `operator_test_account_cleanup` (SA C-1). Later slices take their number at PR time. Points to the lockdown requirement as the binding plan. No other content changed |
| 2026-10-07 | `promote_contact_on_confirmed_booking` reclassified (TL) | §7.2 and §8: dropped on purpose by `20260920_pipeline_transitions.sql`, not a gap. Only `log_crm_contact_created` remains unconfirmed (reported to Offir) |
| 2026-10-07 | Slice 1 migration number (Dev) | §6: slice 1 is now `20261043`, because `20261042` was taken on main by `operator_test_account_cleanup_billing_events`. Rule unchanged: next free number at PR time. No other content changed |
| 2026-10-07 | Slice 1 number again (Dev) | §6: slice 1 is now `20261044`, because `20261043` is claimed by open PR #256. No other content changed |
| 2026-10-08 | Slice 1 done (Dev) | §6 row 1 marked done (PR #261 merged 2026-10-08, `20261044` applied on prod, checker PASS). Overview notes 13 closed, 55 anon-executable remain (37 non-trigger), by arithmetic. No other content changed |
| 2026-10-09 | Slice 6 done (TL, SA N-1) | §6 row 6 marked done: PR #271 merged 2026-10-08 (`f885570d`); merge block proven 2026-10-09 by throwaway PR #274 (both required checks failed, BLOCKED, `enforce_admins` true; closed unmerged) |
| 2026-10-09 | Slice 2 applied (TL) | §6 row 2: `20261048` applied on prod 2026-10-09 15:48 UTC (PR #277): pre-check CLEAN at 15:47 UTC (Q5 match and owner granted all x13, Q11 0 dependents; one Q6 caller, has_sufficient_credits calling get_user_credit_balance, both SECDEF owned by postgres, ok); migration applied 15:48 UTC; checker VERDICT PASS 78 pass 0 fail; negative calls 42501 for get_user_credit_balance (anon) and get_user_subscription_info (authenticated); signed-in smoke: no impact. Anon-executable now 42 (55 - 13) |
| 2026-10-09 | Slice 2 merge commit (Dev, SA nit) | §6 row 2: merge commit `4724b727` added. No other content changed |
| 2026-10-10 | Slice 3 code complete (Dev, SA N-1) | §6 row 3: migration `20261049`; code complete, SA code-approved, QA PASS. PR number at PR time |
