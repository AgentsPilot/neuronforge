# Requirement: SECURITY DEFINER Functions Lockdown

> **Last Updated**: 2026-10-07

**Created by:** BA
**Date:** 2026-10-07
**Status:** ✅ Approved by the user 2026-10-07 (SA approved with conditions C-1 to C-10 the same day). Next: slice 1 workplan
**Type:** Infra / security hardening (CLAUDE.md Security Rules). Not a feature. No user-visible change.
**Origin:** P1 queued in [PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md](/docs/workplans/PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md) §10
**Evidence:** [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md) and [secdef_prod_inventory_2026-10-07.tsv](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv). The TSV is the source of truth for signatures and grantees

## Overview

Production has 75 `SECURITY DEFINER` functions in `public`. They run with the owner's rights, so they bypass RLS and the repository `user_id` filter. Signed-out visitors can execute 68 of them, and 50 of those are not triggers, so anyone holding the public anon key can call them at `POST /rest/v1/rpc/<name>`. This requirement closes that path one small slice at a time. Each slice revokes EXECUTE from the client roles, keeps `service_role` (and `authenticated` only where a signed-in server path needs it), and leaves the function bodies alone. It also adds a CI guard so that the set cannot grow back.

## Table of Contents

1. [Problem](#1-problem)
2. [Goal and non-goals](#2-goal-and-non-goals)
3. [User stories](#3-user-stories)
4. [Functional requirements](#4-functional-requirements)
5. [Non-functional requirements](#5-non-functional-requirements)
6. [Acceptance criteria](#6-acceptance-criteria)
7. [Risks](#7-risks)
8. [Business questions](#8-business-questions)
9. [Questions for SA](#9-questions-for-sa)
10. [Out of scope / future](#10-out-of-scope--future)
11. [Integration points](#11-integration-points)
12. [SA Review](#sa-review)
13. [Change History](#change-history)

---

## 1. Problem

| Prod fact (2026-10-07) | Value |
|---|---|
| SECURITY DEFINER functions in `public` | 75 |
| Executable by `anon` (signed-out visitors) | 68 |
| Of those, not triggers, so reachable over `/rpc` | 50 |
| Already closed (service_role only) | 7 |
| Missing a pinned `search_path` | 47 |
| Exist only in prod, with no definition in git | 20 |

**Why earlier revokes did not work.** Two grants have to be closed:

1. PostgreSQL grants EXECUTE on every new function to `PUBLIC`. The 10 queue functions and the verified-questions pair revoked only `anon, authenticated`, so anon still gets in through `PUBLIC`.
2. Supabase default privileges grant EXECUTE to `anon` and `authenticated` explicitly on every new function in `public`, for **both** owners (`postgres` and `supabase_admin`). So revoking `FROM PUBLIC` alone is not enough either. `is_platform_admin` is exactly that case.

The only revoke that works for all three grantee shapes found in prod is `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.

**Impact of the worst ones (all confirmed open in prod):**

| Exposure | Functions | What a signed-out visitor can do |
|---|---|---|
| Queue claim/reap | 5 `claim_due_*`, 5 `reap_stale_*` | Claim, and so **read**, every tenant's queued payment reminders, payment automations, daily briefings, lead responses and insight actions. Stall the drains, or reap live leases with a zero lease |
| Cross-tenant reads by a caller-supplied user id | `get_user_credit_balance`, `get_user_subscription_info`, `get_user_usage_summary`, `has_sufficient_credits`, `match_verified_questions`, `search_business_chat_plans_semantic`, others | Read another business's credit balance, plan, usage, or cached chat plans |
| Cross-tenant writes by a caller-supplied user id | `record_business_event`, `advance_contact_stage`, `increment_executions_used`, `dismiss_setup_step`, others | Forge business events that feed Insights, move any contact's CRM stage, bump another account's quota counter |
| Platform-wide poisoning | `upsert_intent_example`, `upsert_workflow_pattern`, `record_global_failure` | Poison the V6 learning tables that shape agent generation for every user |
| Callable with no arguments | `auto_disable_ineffective_behavior_rules` | Disable behavior rules platform-wide |
| Lock tampering | `pg_try_advisory_lock`, `pg_advisory_unlock` | Hold or release the calibration locks |

---

## 2. Goal and non-goals

**Goal:** no non-trigger SECURITY DEFINER function in `public` is executable by `anon`, except an explicit, justified allow-list (expected to be empty). A guard on `main` stops the set from growing back.

**Non-goals:**

- No business-logic change. Function bodies stay as they are. Slice 4b changes only the client used at 5 call sites (SA ruling SQ-1), not any function body.
- No dropped functions. This work is revoke only. Dropping dead functions is a separate later decision, made after a log window (§10, SQ-3).
- Capturing the DDL of the 20 prod-only functions in git is optional for slices 2 to 5, but **required before slice 7** for the prod-only functions on its list (C-10).
- No change to tables, RLS policies, default privileges (SQ-2) or application behavior visible to users.

---

## 3. User stories

- As a **business owner**, I want my queued reminders, credit balance, CRM stages and business events to be unreadable and unwritable by strangers, so that my data and my Insights stay mine.
- As the **platform operator**, I want every privileged database function to be callable only by the server, so that the anon key in the browser grants no hidden back door.
- As a **developer**, I want CI to reject a new SECURITY DEFINER function that does not close its grants, so that this cleanup does not need repeating.

---

## 4. Functional requirements

### 4.1 Rules for every slice

| # | Rule |
|---|---|
| FR-0.1 | For every function in the slice: `REVOKE EXECUTE ON FUNCTION public.<name>(<prod identity args>) FROM PUBLIC, anon, authenticated`, then `GRANT EXECUTE ... TO service_role`. Slices 3 (`is_platform_admin` only) and 4a also `GRANT EXECUTE ... TO authenticated`. Slice 4b later revokes `authenticated` from 5 of the 4a functions |
| FR-0.2 | Signatures are the **prod identity signatures** from the TSV, for example `numeric` not `decimal`, `character varying` not `varchar`, `vector` with no length. Every name is **schema-qualified** with `public.`, which matters most for `pg_try_advisory_lock` and `pg_advisory_unlock` because they shadow `pg_catalog` built-ins |
| FR-0.3 | Delivery package, following the 20261039/20261040 pattern: a read-only pre-check script, one `BEGIN ... COMMIT` migration with in-transaction post-conditions (an extension of that precedent, which has none), a read-only checker that ends in a **VERDICT** row, a rollback script in `supabase/SQL Scripts/`, and a static test in `supabase/migrations/__tests__/` |
| FR-0.4 | Post-conditions and the checker assert **`has_function_privilege` outcomes**, never ACL text: `public`, `anon` and `authenticated` false (authenticated true where kept) and `service_role` true. Each function is guarded with `to_regprocedure(...) IS NOT NULL` |
| FR-0.5 | The pre-check confirms each function's current grantee shape. The rollback restores exactly that shape |
| FR-0.6 | **The user applies each migration by hand** in the Supabase SQL editor and runs the checker **before the PR merges** |
| FR-0.7 | Paste-safe SQL in every file the user pastes: no `--` comments, no `/*` comments, no punctuation inside prose string literals, and never the word "into" (see the memory note on the SQL-editor bug). FR-0.12 clarifies this |
| FR-0.8 | **Slice 1 is `20261042`** (`20261041` is taken on main by `operator_test_account_cleanup`). Every later slice takes the next free number **at PR time** against `origin/main`. Each slice is a few days of work at most and reuses the existing pattern (no new tooling except the slice 6 guard) |
| FR-0.9 | **Fail, never skip (C-2).** When `to_regprocedure(...)` is NULL, the migration does `RAISE EXCEPTION` and the checker shows FAIL. A skip would let a wrong signature pass without checking anything |
| FR-0.10 | **Owner check (C-3).** The pre-check records `proowner` for every function in the slice, and for the SECDEF callers found under FR-0.11. It fails unless the owner is the applying role (`postgres`), because a REVOKE by a non-owner only warns and changes nothing |
| FR-0.11 | **Caller pre-check in every slice (C-4).** For each function, list every `pg_proc` whose `prosrc` names it (with `prosecdef` and owner), every `pg_policies` row naming it (with roles), every view whose definition names it, and the `cron.job` commands when `to_regclass('cron.job')` exists. A function leaves the slice until resolved if it has any SECURITY INVOKER caller, any view, or any policy whose roles include `public`/`anon` (or `authenticated`, for a service_role-only function) |
| FR-0.12 | **Paste-safety, clarified (C-7).** DO blocks never use `SELECT ... INTO`. They use a direct boolean, `IF NOT has_function_privilege(...)`. Signature literals (dots, parentheses, commas) are allowed. The punctuation ban applies to prose in `RAISE` messages and anywhere the word "into" could appear |
| FR-0.13 | **Static test asserts (C-8):** every `ON FUNCTION` is `public.`-qualified. Every REVOKE lists `PUBLIC`, `anon` and `authenticated`. The signature set equals the slice list in §4.2. There is no `--`, no `/*` and no "into" |
| FR-0.14 | **`is_platform_admin` policies (C-9).** The slice 3 pre-check must show that every prod policy using it is `TO authenticated` only. A policy on `public`/`anon` would make anon reads of that table fail with `42501` after the revoke |

### 4.2 Slices

**Delivery order (SQ-6):** S1, S6, S2, S3, S4a, S5, S4b, S7. S2 to S5 may be reordered, but S4a always comes before S4b.

**FR-1 — Slice 1 (`20261042`): drains and no-arg mutators, service_role only (13).** Highest exposure. Every caller is already service_role (Vercel crons, the service-key lock client). SA confirmed this against the code.
`claim_due_daily_briefings(uuid, integer)`, `claim_due_insight_actions(uuid, integer)`, `claim_due_lead_responses(uuid, integer)`, `claim_due_payment_automation_executions(uuid, integer)`, `claim_due_payment_reminders(uuid, integer)`, `reap_stale_daily_briefings(integer, integer)`, `reap_stale_insight_actions(integer, integer)`, `reap_stale_lead_responses(integer, integer)`, `reap_stale_payment_automation_executions(integer, integer)`, `reap_stale_payment_reminders(integer, integer)`, `pg_try_advisory_lock(bigint)`, `pg_advisory_unlock(bigint)`, `auto_disable_ineffective_behavior_rules(integer, numeric)`.

**FR-6 — Slice 6: CI ratchet guard. Lands immediately after slice 1, before slice 2 (C-5).** A second Jest file that runs inside the existing **required** `Admin authz surface guard` job. That job has no `paths:` filter and runs in parallel with Build, so no CI time is added. Do not rely on the Jest gate alone, because it is not required. The guard scans `supabase/migrations/`, `supabase/SQL Scripts/` and `supabase/held/`. Every `SECURITY DEFINER` function created or altered in a new file needs, in the same file, a `REVOKE ... ON FUNCTION public.<name>` that lists `PUBLIC`, `anon` and `authenticated`, plus `SET search_path`. Functions are matched by name, since there are no overloads. Existing non-compliant files go on a **frozen baseline** that can only shrink. Exceptions go on a typed allow-list constant in the test, with fields `{file, function, reason, SA approval date}`. It is expected to stay empty (SQ-5). This slice does **not** change default privileges (SQ-2).

**FR-2 — Slice 2: dead and prod-only cross-tenant functions, service_role only (13).** No live caller (SA confirmed), so nothing can break, and these are the most valuable tenant leaks.
`get_user_credit_balance(uuid)`, `get_user_subscription_info(uuid)`, `get_user_usage_summary(uuid, integer)`, `get_user_workflow_stats(uuid)`, `has_sufficient_credits(uuid, integer)`, `is_reward_eligible(uuid, character varying)`, `get_last_perfect_calibration(uuid, uuid)`, `get_unviewed_insights_count(uuid)`, `match_behavior_rules(uuid, uuid, text, text, text, text)`, `record_behavior_rule_result(uuid, boolean)`, `check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean)`, `dismiss_setup_step(uuid, text)`, `upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text)`.

**FR-3 — Slice 3: remaining server-only and internal functions, service_role only (17), plus `is_platform_admin`.** Every caller is service_role or the owner (a trigger or internal SQL).
`search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer)`, `record_business_chat_plan_outcome(uuid, boolean)`, `match_verified_questions(vector, uuid, text, double precision, integer)`, `increment_verified_question_uses(uuid[])`, `get_or_create_user_organization(uuid)`, `check_subdomain_available(text)`, `generate_subdomain(text)`, `upsert_intent_example(text, jsonb, text[], integer, integer, text)`, `find_similar_intent_examples(text[], text, text, integer)`, `record_intent_example_usage(uuid, boolean)`, `upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric)`, `get_similar_patterns(text[], integer)`, `record_global_failure(text, text, text, text, boolean)`, `get_active_failures(text, text)`, `advance_contact_stage(uuid, uuid, text, text[])`, `increment_calibration_count(uuid)`, `record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone)`.
Also `is_platform_admin()`: close `PUBLIC` and `anon`, **keep `authenticated`** (its RLS policies are all `TO authenticated`, which FR-0.14 checks in prod).
The FR-0.11 caller pre-check must confirm that only the SECDEF `tg_*_events` triggers call `record_business_event`, and that their owner keeps EXECUTE (R-3).

**FR-4a — Slice 4a: signed-in server paths, close PUBLIC and anon, keep authenticated (6).**
`increment_executions_used(uuid)`, `update_execution_baseline(uuid, uuid, numeric, numeric, integer, integer, boolean)`, `record_execution_anomaly(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer)`, `upsert_error_pattern(uuid, uuid, text, text, text, text, text, jsonb)`, `record_auto_fix_result(uuid, boolean)`, `get_top_insights(integer)`.
This removes the anonymous path. Until 4b, a signed-in user can still write rows for another tenant.

**FR-4b — Slice 4b: close the caller-supplied tenant id (5).** Applies to `increment_executions_used`, `update_execution_baseline`, `record_execution_anomaly`, `upsert_error_pattern` and `record_auto_fix_result`. **SA ruling (SQ-1):** the 5 RPC call sites move to `supabaseServer`. Only those call sites are injected with it. The user id comes from the authenticated session, never from the request body (`tenant-isolation-guard` skill). Then `authenticated` is revoked, so the 5 become service_role only. No function body changes. `get_top_insights` keeps `authenticated`, because it is scoped by `auth.uid()`. `increment_executions_used` is the open S-6 P1. If 4b touches `ExecutionService.ts`, flag its `console.*` calls (CLAUDE.md Logging). Before 4b, confirm at runtime which client reaches each RPC (R-4).

**FR-5 — Slice 5: trigger functions, no client EXECUTE (18).** Hygiene. EXECUTE is not checked when a trigger fires, and none of these is reachable over `/rpc` in a useful way.
`advance_contact_on_completed_booking()`, `auto_set_agent_org_id()`, `create_user_settings()`, `increment_smart_link_click_count()`, `link_subscriber_to_contact()`, `log_document_activity()`, `log_exchange_rate_change()`, `marketing_consent_project()`, `promote_contact_on_payment()`, `update_user_storage_used()`, `tg_activity_reply_events()`, `tg_booking_events()`, `tg_contact_events()`, `tg_invoice_events()`, `tg_page_view_events()`, `tg_proposal_events()`, `tg_service_events()`, `tg_transaction_events()`.

**FR-7 — Slice 7 (last, separate): pin `search_path` on the 47 functions listed in the inventory §6.** `ALTER FUNCTION ... SET search_path = public, pg_temp`. Each body is read first, because a wrong path breaks the function at runtime. **Prerequisite (C-10):** the DDL of every prod-only function on the 47 list is captured (`pg_get_functiondef`) under `supabase/SQL Scripts/` before this slice starts. It is not combined with the revoke slices, because it changes name resolution rather than privileges.

**Coverage:** 13 + 13 + 18 + 6 + 18 = 68, which equals the anon-executable count in prod. Slice 4b changes no grant count, and slice 7 overlaps the earlier slices.

---

## 5. Non-functional requirements

- **Security:** after each slice, every function in it measures as specified by `has_function_privilege`. `service_role` never loses EXECUTE.
- **Reversibility:** every slice has a tested rollback that restores the measured pre-state.
- **No downtime:** revokes are metadata-only and take effect at once. No drain, cron or signed-in flow may fail.
- **Observability:** after each apply, the relevant cron runs and server paths are checked for `permission denied for function` errors in logs (one cron cycle at least).
- **CI cost:** the slice 6 guard runs inside an existing required parallel job, off Build's critical path, so it adds no time.

---

## 6. Acceptance criteria

**Every slice:**
- [ ] Pre-check run on prod by the user. Its shapes match the inventory, or the differences are recorded in the slice workplan. The owner check (FR-0.10) and caller check (FR-0.11) are clean
- [ ] Migration applied by hand. Its in-transaction post-conditions passed
- [ ] Checker VERDICT row is PASS. For each function: `public`/`anon`/`authenticated` false (authenticated true where kept), `service_role` true. A missing function shows FAIL, never a skip
- [ ] Static test passes in CI, with the FR-0.13 asserts. Rollback script present and reviewed
- [ ] No `permission denied for function` in logs for one full cron cycle after apply
- [ ] Main requirement (this doc) updated with the slice's PR, merge and apply state

**Per slice:**
- [ ] **S1:** all 5 drains complete a normal run after apply. The service_role RPCs `pg_try_advisory_lock` and `pg_advisory_unlock` return a boolean with no `42501`. Lock semantics are **not** tested (C-6)
- [ ] **S6:** guard merged right after S1, inside the required `Admin authz surface guard` job. A throwaway PR with an unrevoked SECURITY DEFINER function has its merge **blocked**, not merely shown red
- [ ] **S2:** the 13 functions are service_role only. No app path changes (none calls them)
- [ ] **S3:** the 17 are service_role only. `is_platform_admin` is false for anon and true for authenticated. Admin-only RLS reads on `ai_model_pricing` and `system_settings_config` still work for a signed-in admin. Business events still record from a booking, invoice and contact change
- [ ] **S4a:** the 6 are false for anon and true for authenticated. A signed-in agent run still increments execution usage and writes baselines
- [ ] **S4b:** `authenticated` gets `42501` on the 5 functions, the user's own runs still record through the service-role client, and the user id comes from the session. `get_top_insights` still works for a signed-in user
- [ ] **S5:** the 18 trigger functions are service_role only. Each trigger still fires (one sample write per trigger family)
- [ ] **S7:** prod-only DDL captured first (C-10). All 47 pinned. Each function exercised once after apply with no error

**Overall done:**
- [ ] A prod re-run of `scripts/inventory-security-definer-functions.sql` shows **0** anon-executable non-trigger SECURITY DEFINER functions in `public`, apart from a `VALUES` allow-list in the checker with fields `{file, function, reason, SA approval date}`. It is expected empty, and any entry needs an SA sign-off recorded here (SQ-5)
- [ ] The slice 6 guard is a required check on `main`

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Breaking a legitimate caller | Dev's code-side caller map per function, which SA verified for S1 to S4a. Server drains already run as service_role. Signed-in callers keep `authenticated` in 4a. Logs are watched for one cron cycle. Rollback is ready |
| R-2 | Prod-only functions (20) have no definition in git, so a wrong signature fails silently | Signatures come from the TSV (SA verified all 68 by script). `to_regprocedure` NULL raises an exception (FR-0.9) |
| R-3 | `record_business_event` may have a caller other than the `tg_*` triggers (SQL, an Edge Function, an external service using a client key) | FR-0.11 caller pre-check before slice 3, plus a code search. If a client-key caller is found, move it to slice 4a |
| R-4 | The class 2 role mapping (which client the pilot passes) is inferred from tracing, not observed | 4a is safe either way because it keeps `authenticated`. Confirm at runtime before 4b |
| R-5 | `operator_test_account_cleanup` is already closed, but the Danger Zone requirement may add a server caller | It stays service_role only. A new caller must use the service-role client |
| R-6 | `log_crm_contact_created` is not SECURITY DEFINER in prod. It may never have been applied, so the "contact created" timeline entry may not be written. (`promote_contact_on_confirmed_booking` is **not** a gap: `20260920_pipeline_transitions.sql:162-163` drops it on purpose, replaced by `advance_contact_on_completed_booking`, which is in prod.) | Out of scope for this hardening. Raised as BQ-1 |
| R-7 | Unqualified `pg_try_advisory_lock` resolves to the `pg_catalog` built-in | FR-0.2 requires `public.` qualification. The static test asserts it (FR-0.13) |
| R-8 | A new function is created before the guard lands | The guard ships right after slice 1. Until then, every new migration is reviewed by SA for this |
| R-9 | A REVOKE by a non-owner only warns and leaves the grant in place | FR-0.10 owner check in the pre-check |

---

## 8. Business questions

Only one, and it does not block any slice.

- [x] **BQ-1 — Possible missing "contact created" timeline entry (raised by: BA | status: answered 2026-10-07).** Narrowed by TL: the booking promotion is **not** broken — `promote_contact_on_confirmed_booking` was dropped on purpose by `20260920_pipeline_transitions.sql` and replaced by `advance_contact_on_completed_booking`, which is in prod. Only `log_crm_contact_created` (logs "contact created" on the contact timeline) is unconfirmed. **User decision:** report it to Offir as a possible business bug, outside this hardening; this lockdown stays infra-only.

---

## 9. Questions for SA

All six were answered by SA on 2026-10-07. The full rulings are in [SA Review](#sa-review).

| # | Question | BA's suggested answer | SA ruling |
|---|---|---|---|
| SQ-1 | Slice 4b shape: service-role client in the pilot, or `auth.uid()` derived or asserted in the functions | SA decides. Prefer the option that leaves no client-callable tenant-id parameter | ✅ Service-role client at the 5 call sites, user id from the session, then revoke `authenticated` (FR-4b) |
| SQ-2 | Change the default privileges in `public` so new functions stop granting `anon`/`authenticated`, and if so for both `postgres` and `supabase_admin`? In slice 6 or a separate slice? | Yes, as its own small step after the guard. The guard alone is enough if the change is risky for tables or sequences | ✅ No change. Accepted residual (§10) |
| SQ-3 | Revoke now and drop later, or drop the dead class 5 functions now? | Revoke now (this requirement). Decide on dropping after a log check, as a separate item | ✅ Revoke now, decide on dropping after a log window |
| SQ-4 | Capture the DDL of the 20 prod-only functions (`pg_get_functiondef`) under `supabase/SQL Scripts/` | Optional, separate item. It can run alongside slice 2 without blocking it | ✅ Optional for S2 to S5, required before S7 (C-10) |
| SQ-5 | Allow-list format for the overall-done criterion and the guard baseline | A single reviewed list in the guard's config, with each entry justified | ✅ A typed constant in the guard and a `VALUES` list in the checker. Both are expected empty |
| SQ-6 | Slice order: is S6 right after S1 acceptable, with S2 to S5 following in any order? | Yes. S4b and S7 come last | ✅ S1, S6, S2, S3, S4a, S5, S4b, S7 |

---

## 10. Out of scope / future

- Dropping dead functions (class 5 and the prod-only readers), decided after a log window (SQ-3)
- Cleaning up the dead `exec_sql` / `get_table_constraints` call sites in `scripts/` (those functions do not exist in prod)
- Fixing the "contact created" activity trigger if it is missing (BQ-1, reported to Offir)
- SECURITY DEFINER functions in `pgbouncer` and `vault` (none anon-executable)
- Table-level RLS and grants (covered by earlier lockdowns)
- **Accepted residual (SQ-2):** default privileges are not changed, so every new function in `public` will still start out executable by anon. The control is the slice 6 guard plus a revoke in every migration
- **Later item (C-6):** session advisory locks over pooled PostgREST connections may not be released on the same backend that took them. This is a pre-existing issue with the calibration locks, not part of this work

---

## 11. Integration points

- **DB:** `public` functions listed in §4. No table, policy or column change.
- **Server callers (unchanged, already service_role):** payment reminder, payment automation, daily briefing, lead response and insight action drains; `lib/utils/distributedLock.ts`; BizQL `PlanCache` and `VerifiedQuestions`; `OrganizationRepository`; `WebsitePageRepository`; the V6 learning repositories (`IntentExampleRepository`, `PatternExtractor`, `GlobalFailureMonitor`); `ShadowAgent`.
- **Signed-in callers (slices 4a and 4b):** `ExecutionService` / `StateManager`, `BaselineService`, `AnomalyDetector`, `ErrorPatternRepository` (through `WorkflowPilot`), and `InsightRepository.getTopInsights` from `app/api/v6/insights`. In 4b, the 5 call sites move to `supabaseServer`. `getTopInsights` does not change.
- **RLS:** policies on `ai_model_pricing` and `system_settings_config` that call `is_platform_admin()`.
- **CI:** a new Jest file inside the required `Admin authz surface guard` job (slice 6). Existing migration static tests.

---

## SA Review

**Reviewed by SA — 2026-10-07**
**Status:** APPROVED WITH CONDITIONS (C-1 to C-10). Slice 1 may go to workplan once C-1 to C-4, C-6 and C-7 are reflected in it.

### Verified against the code

| Claim | Result |
|---|---|
| S1: every claim/reap caller is service_role | **Confirmed.** The 10 RPCs are called only by 5 repositories whose constructor default is `supabaseServer`, and only service-role instances exist (`DailyBriefingSendRepository.ts:147`, `InsightActionRepository.ts:285`, `LeadResponseRepository.ts:305`, `PaymentAutomationRepository.ts:418`, `PaymentReminderService.ts:1894` passes `supabaseServer`). Reached only from the dispatch services, `PaymentAutomationEngine` and `PaymentReminderService`. No user-auth client path, no `supabase/functions` caller. `scripts/dev-payment-queue.ts` uses the service key |
| S1: lock wrappers | **Confirmed.** Only `lib/utils/distributedLock.ts:53,77,116`, on a module-level service-key client, used by `calibrate/resume` and `v2/calibrate/batch`. PostgREST `/rpc` resolves in the exposed schema, so it hits `public.pg_*`. SQL that calls the bare name (`get_next_run_number` in `SQL Scripts/20260205`, and the wrappers' own bodies) resolves to the `pg_catalog` built-in, because `pg_catalog` is searched first implicitly. The revoke does not touch those callers |
| S1: `auto_disable_ineffective_behavior_rules` | **No caller** anywhere |
| S1 contents | **Unchanged (13).** Only the migration number changes (C-1) |
| S2: no live caller | **Confirmed.** The only references are `workflowService.ts:828` (imported only by `components/orchestration-NOT-USED/`), `InsightRepository.getUnviewedCount` (no caller) and `PluginPerformanceService.recordExecution` (no caller; `WorkflowOptimizer` uses `getMetrics` only). The other 10 have zero references |
| S3: callers are service_role or owner | **Confirmed** for every TS caller: `PlanCache`, `VerifiedQuestions`, `OrganizationRepository` (all `OrganizationService` / `AutomationAdvisor` instances default to `supabaseServer`), every `WebsitePageRepository` instantiation and its singleton, the V6 learning singletons (seeded only with `supabaseServer`), and `ShadowAgent` (WorkflowPilot's service-key client). `advance_contact_stage` is called only by the two SECDEF triggers in `20260920` |
| S3: `record_business_event` | **Reasoning confirmed.** EXECUTE on a trigger function is not checked when it fires. Inside the SECDEF `tg_*` functions `current_user` is their owner, so the nested call checks the owner's EXECUTE, which the revoke leaves alone. This holds only if the `tg_*` owner keeps EXECUTE and no INVOKER function, policy, view or client-key caller reaches it (C-3, C-4) |
| S3: `is_platform_admin` | Repo policies (3) are all `TO authenticated`, so revoking anon is safe **for those**. Prod-only policies are unknown (C-9) |
| S4a: `get_top_insights` | Class 2 is right. Scoped by `auth.uid()`, called from `app/api/v6/insights` on `createAuthenticatedServerClient`. `increment_executions_used` on the cookie client is confirmed by `StateManager.ts:138-147` |
| Signatures | All 68 signatures in §4.2 match the TSV identity args exactly (scripted compare) |
| Next number | **Wrong.** `20261041_operator_test_account_cleanup.sql` merged to main on 2026-10-07 (C-1). It already revokes from `PUBLIC, anon, authenticated` and pins `search_path`, so it complies with the future guard |

### Conditions

1. **C-1 Migration number.** `20261041` is taken. Slice 1 is **`20261042`**. Each slice takes its number at PR time against `origin/main`.
2. **C-2 Fail, never skip.** The `to_regprocedure(...) IS NOT NULL` guard must `RAISE EXCEPTION` when NULL, in the migration, and show FAIL in the checker. A skip would let a wrong signature pass vacuously.
3. **C-3 Owner.** The pre-check records `proowner` for every function in the slice and fails unless it is the applying role (`postgres`). A REVOKE by a non-owner is only a WARNING and changes nothing. The same check covers the SECDEF callers found under C-4.
4. **C-4 Caller pre-check in every slice, not only R-3.** For each function: every `pg_proc` whose `prosrc` names it (with `prosecdef` and owner), every `pg_policies` row that names it (with roles), every view whose definition names it, and `cron.job` commands when `to_regclass('cron.job')` exists. Any SECURITY INVOKER caller, any view, or any policy whose roles include `public`/`anon` (or `authenticated`, for a service_role-only function) moves the function out of the slice until resolved.
5. **C-5 Guard placement and rule (slice 6).** Add it as a second Jest file run inside the existing **required** `Admin authz surface guard` job. That job already scans `supabase/migrations` and `supabase/SQL Scripts`, has no `paths:` filter and runs in parallel with Build. Do not rely on the Jest gate alone, because it is not required. The guard scans `supabase/migrations/`, `supabase/SQL Scripts/` and `supabase/held/`. Every `SECURITY DEFINER` function created or altered in a new file needs, in the same file, a `REVOKE ... ON FUNCTION public.<name>` that lists `PUBLIC`, `anon` and `authenticated`, plus `SET search_path`. Match by name, since there are no overloads. The baseline is a frozen list of existing non-compliant files that can only shrink. S6 acceptance is a throwaway PR whose merge is **blocked**, not merely red.
6. **C-6 S1 lock acceptance.** Verify that the service_role RPC returns a boolean with no `42501`. Do not verify lock semantics: session advisory locks over pooled PostgREST connections may not release on the same backend, which is a pre-existing issue and out of scope (log it as a later item).
7. **C-7 Paste-safety, clarified.** No `SELECT ... INTO` in DO blocks; use direct boolean `IF NOT has_function_privilege(...)`. Function-signature literals (dots, parentheses, commas) are allowed. The punctuation ban applies to prose in `RAISE` messages and anywhere the word "into" could appear.
8. **C-8 Static test asserts.** Every `ON FUNCTION` is `public.`-qualified. Every REVOKE lists all three client grantees. The signature set equals the slice list in §4.2. There are no `--`, `/*` or "into". Note that the 20261039/40 precedent has no in-transaction post-conditions, so these migrations extend it.
9. **C-9 `is_platform_admin`.** The S3 pre-check (C-4) must show every prod policy using it as `TO authenticated` only. A policy on `public`/`anon` would make anon reads of that table fail with `42501` after the revoke.
10. **C-10 DDL capture.** Optional for S2 to S5, but a **prerequisite of S7** for the prod-only functions in the 47 list, whose bodies must be read before they are pinned.

### Rulings on §9

| # | Ruling |
|---|---|
| SQ-1 | **Service-role client for the 5 RPC call sites, then revoke `authenticated`**, so they become class 1. Inject `supabaseServer` at those call sites only. The user id must come from the authenticated session, never the request body (`tenant-isolation-guard`). Reject the `auth.uid()` rewrite: the pilot also runs on service-role paths (sentinel, `v6/execute-test`, `DryRunValidator`) where `auth.uid()` is NULL, so the bodies would need a role branch and edits to prod-only DDL. This matches the `user_subscriptions` server-write-only direction. `get_top_insights` keeps `authenticated`, because it is `auth.uid()`-scoped. 4b's test becomes: authenticated gets `42501` on the 5, and the user's own runs still record. Flag `console.*` in `ExecutionService.ts` when 4b touches it |
| SQ-2 | **No default-privilege change.** (a) `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` needs membership in `supabase_admin`, which `postgres` in the SQL editor does not have. Only platform objects are created as `supabase_admin` anyway. (b) The `PUBLIC` EXECUTE grant comes from the global built-in default, and an `IN SCHEMA public` entry cannot revoke a global grant. A schema-scoped change would therefore remove only the explicit anon/authenticated entries, and anon would still get in through PUBLIC: no effect. (c) The global form for `postgres` would strip PUBLIC EXECUTE from every future `postgres`-created function in every schema, extension functions included, which is a breakage risk. The guard plus per-migration revokes is the control. Record this as an accepted residual in §10 |
| SQ-3 | Revoke now. Decide on dropping after a log window, as a separate item |
| SQ-4 | See C-10 |
| SQ-5 | Guard: a typed constant in the guard test, with each entry giving `{file, function, reason, SA approval date}`. Overall done: a `VALUES` allow-list in the inventory checker with the same fields. Both are expected empty, and any entry needs an SA sign-off recorded here |
| SQ-6 | **S1, then S6, then S2, S3, S4a, S5, then S4b, then S7.** S2 to S5 may reorder, but S4a comes before S4b. S6 complies with no-added-CI-time: it is static, runs in an existing required parallel job, and is not on Build's critical path |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-07 | Created (Draft) | Requirement drafted from Dev's inventory and the user's prod run of 2026-10-07. 7 slices plus 4b, with exact prod signatures, the delivery package and paste-safe rules, per-slice acceptance, 8 risks, 1 business question and 6 SA questions. Awaiting SA review |
| 2026-10-07 | SA review | APPROVED WITH CONDITIONS (C-1 to C-10). Slice 1 contents confirmed, but the migration number is now 20261042 because 20261041 is taken on main. Rulings: 4b moves to the service-role client and then revokes authenticated; no default-privilege change; revoke now, drop later; guard runs in the required admin authz guard job; order S1, S6, S2, S3, S4a, S5, S4b, S7 |
| 2026-10-07 | SA rulings folded into body (BA) | Status changed to SA-approved, awaiting user approval of the slice plan. ToC now lists SA Review. FR-0.8 and FR-1 renumbered (slice 1 = 20261042, later slices numbered at PR time). New delivery rules FR-0.9 to FR-0.14 (C-2, C-3, C-4, C-7, C-8, C-9). Slice order added to §4.2. FR-6 rewritten per C-5. FR-4b set to the SQ-1 ruling. FR-7 now requires DDL capture first (C-10). S1 lock acceptance per C-6. New risk R-9 (owner). §9 gains an SA-ruling column. §10 gains the accepted default-privilege residual and the pooled advisory-lock item |
| 2026-10-07 | User approval; BQ-1 narrowed (TL) | User approved the requirement and slice plan ("yes, approve the plan and commit the docs"). BQ-1 narrowed: `promote_contact_on_confirmed_booking` was dropped on purpose by `20260920_pipeline_transitions.sql` (replaced by `advance_contact_on_completed_booking`, in prod), so only `log_crm_contact_created` is unconfirmed; reported to Offir per the user. R-6 and §10 updated |
