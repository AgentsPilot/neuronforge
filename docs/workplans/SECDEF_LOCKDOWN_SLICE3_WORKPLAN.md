# Workplan: SECURITY DEFINER Lockdown, Slice 3 (server-only and internal functions, plus is_platform_admin)

> **Last Updated**: 2026-10-10

**Developer:** Dev
**Requirement:** [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) (FR-0.1 to FR-0.14, FR-3, §6, SA conditions C-1 to C-10, C-4 note S2-4)
**Pattern copied:** [SECDEF_LOCKDOWN_SLICE2_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE2_WORKPLAN.md) (five-file package, SA S2-1 to S2-4, Q11) and the acceptance of [SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md) (logs plus `bos_cron_runs`), because slice 3 functions **have live callers**
**Evidence:** [secdef_prod_inventory_2026-10-07.tsv](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv) (signatures and grantees), [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md) §6 row 3
**Branch:** `fix/secdef-lockdown-slice-3` (worktree `neuronforge-secdef-s3`, off `origin/main` `4724b727`, the PR #277 merge)
**Migration number:** `20261049` proposed. Checked 2026-10-09: `origin/main` (`90c33582`, PR #278 merged, which added `20261032`) tops at `20261048`; `gh pr list` shows no open PR touching `supabase/migrations/`, `supabase/SQL Scripts/` or `supabase/held/`. Re-check at PR time (T-10 rule)
**Date:** 2026-10-09
**Status:** Code Complete. Workplan SA-approved 2026-10-09 (S3-1 to S3-6 folded in); code SA-approved with nits 2026-10-10 (N-1 to N-3 applied, docs only); QA PASS. Uncommitted; next: the user sees the diff, then prod apply per §6.

## Overview

Slice 3 removes client EXECUTE from 17 SECURITY DEFINER functions whose every caller is the server (`service_role`) or the function owner (a trigger or another SECURITY DEFINER function), and closes `PUBLIC` and `anon` on `is_platform_admin()` while keeping `authenticated`, because its RLS policies run as the signed-in user. Unlike slice 2, these functions are on live paths: the Business OS chat (plan cache, verified questions), organisation creation, website subdomains, V6 agent generation, calibration, and, through triggers, every booking, invoice, contact and payment write. The delivery is the slice 2 package with three changes: per-function grant shapes (three in prod, so three rollback forms), a kept-`authenticated` branch for `is_platform_admin` in every file, and slice 1 style functional acceptance. No function body, table, policy or application code changes.

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
11. [Change History](#change-history)

---

## 1. Analysis

### 1.1 The 18 functions, verified against the prod TSV

Identity types are the TSV `identity_args` with the parameter names removed. Every row is `kind = fn`, has exactly one TSV row (no overloads) and `triggers` 0. **All 18 match FR-3 exactly. No discrepancy.**

| # | Signature (prod identity) | `nargs` / `min_args` | TSV `search_path` | Shape | Defined in git |
|---|---|---|---|---|---|
| 1 | `public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer)` | 6 / 4 | null | B | `20260826_business_chat_plan_cache.sql:87` |
| 2 | `public.record_business_chat_plan_outcome(uuid, boolean)` | 2 / 2 | null | B | `20260826_business_chat_plan_cache.sql:127` |
| 3 | `public.match_verified_questions(vector, uuid, text, double precision, integer)` | 5 / 3 | public | **C** | `20260922_verified_questions.sql:89` (revoke `:125`) |
| 4 | `public.increment_verified_question_uses(uuid[])` | 1 / 1 | public | **C** | `20260922_verified_questions.sql:135` (revoke `:146`) |
| 5 | `public.get_or_create_user_organization(uuid)` | 1 / 1 | null | B | `20260615_add_organizations.sql:182` |
| 6 | `public.check_subdomain_available(text)` | 1 / 1 | null | B | `20260726_enhance_website_tables.sql:89` |
| 7 | `public.generate_subdomain(text)` | 1 / 1 | null | B | `20260726_enhance_website_tables.sql:99` |
| 8 | `public.upsert_intent_example(text, jsonb, text[], integer, integer, text)` | 6 / 3 | null | B | `20260629_intent_examples_table.sql:72` |
| 9 | `public.find_similar_intent_examples(text[], text, text, integer)` | 4 / 1 | null | B | `20260629_intent_examples_table.sql:145` |
| 10 | `public.record_intent_example_usage(uuid, boolean)` | 2 / 2 | null | B | `20260629_intent_examples_table.sql:192` |
| 11 | `public.upsert_workflow_pattern(text[], text, integer, text, boolean, numeric, numeric)` | 7 / 7 | null | B | `20260629_platform_learning_tables.sql:110` |
| 12 | `public.get_similar_patterns(text[], integer)` | 2 / 1 | null | B | `20260629_platform_learning_tables.sql:261` |
| 13 | `public.record_global_failure(text, text, text, text, boolean)` | 5 / 3 | null | B | `20260629_platform_learning_tables.sql:173` |
| 14 | `public.get_active_failures(text, text)` | 2 / 1 | null | B | `20260629_platform_learning_tables.sql:308` |
| 15 | `public.advance_contact_stage(uuid, uuid, text, text[])` | 4 / 4 | null | B | `20260920_pipeline_transitions.sql:60` |
| 16 | `public.increment_calibration_count(uuid)` | 1 / 1 | null | B | **no (prod-only)** |
| 17 | `public.record_business_event(uuid, text, text, text, uuid, uuid, numeric, jsonb, text, timestamp with time zone)` | 10 / 10 | public | **C** | `20261006_business_event_triggers.sql:61` (revoke `:109`) |
| 18 | `public.is_platform_admin()` | 0 / 0 | `pg_catalog, public` | **D** | `20260920a_lock_system_settings_and_pricing_rls.sql:133` (revoke `:159`, grant `:160`) |

Type notes (FR-0.2): rows 1 and 3 are `vector(1536)` in git and `vector` in the identity (typmod is not part of it). Row 11 is `DECIMAL` in git and `numeric` in prod. Row 17 is `timestamptz` in git and `timestamp with time zone` in the identity. Defaults (rows 1, 3, 8, 9, 12, 13, 14) are not part of the identity. **`vector` resolution:** the literal `vector` resolves only if the pgvector type is visible on the applying session's `search_path`. The TSV printed it unqualified, which `format_type` does only when it is visible, and the inventory ran in the same SQL editor, so it should resolve. If it did not, `to_regprocedure` returns NULL and the migration raises (C-2), so it fails safe, never silently. The pre-check adds a row for it (§2.1, Q0).

### 1.2 Grant shapes and rollback

Three shapes, so the rollback is per function (slice 1 had two shapes, slice 2 one):

| Shape | Functions | TSV `execute_grantees` | How anon gets in today | After the migration | Rollback grant |
|---|---|---|---|---|---|
| B | rows 1, 2, 5 to 16 (14) | `PUBLIC postgres anon authenticated service_role` | `PUBLIC` plus Supabase default-privilege `anon`/`authenticated` | `postgres service_role` | `GRANT ... TO PUBLIC, anon, authenticated` |
| C | rows 3, 4, 17 (3) | `PUBLIC postgres service_role` | only through `PUBLIC` (their migrations revoked `anon, authenticated` but not `PUBLIC`, the §1 Problem case 1) | `postgres service_role` | `GRANT ... TO PUBLIC` |
| D | row 18 (1) | `postgres anon authenticated service_role` (`x_public` f, `public_acl` f) | explicit `anon` from Supabase default privileges (its migration revoked `PUBLIC` and granted `authenticated, service_role`, case 2) | `postgres authenticated service_role` | `GRANT ... TO anon` (`authenticated` is never lost, `PUBLIC` never held) |

Every REVOKE still lists `PUBLIC, anon, authenticated` (FR-0.1, the form the slice 6 guard and the static test look for). For shape C and D a revoke from a role that holds nothing is a silent no-op for the owner. For row 18 the migration then grants `authenticated` back in the same transaction, so no concurrent session can see a gap.

Owner and grantor are not in the TSV, so the pre-check measures them (Q2, Q5 grantors) as in slices 1 and 2.

### 1.3 Caller re-verification on current main (2026-10-09, `4724b727`)

Searched the whole repo except `node_modules`, `.next`, `.git`, `docs/` and `.claude/` for each name as a substring (all file types; this also catches `.rpc(<CONSTANT>)` sites, since the constant's value contains the name), then traced every hit to the client it runs on and the route, cron or job that reaches it. `supabase/functions/` holds only `run-scheduled-agents` and has no hit. The only raw `/rest/v1/rpc/` call (`scripts/apply-memory-fixes-direct.ts:59`) is a one-off dev script that creates other functions. `lib/supabaseServer.ts` is `createClient(URL, SUPABASE_SERVICE_ROLE_KEY)`, so "service_role" below means that client or an equivalent service-key client.

**TypeScript call sites**

| # | Function | Call site | Client (role) | Reached from | Live? | On error |
|---|---|---|---|---|---|---|
| 1 | `search_business_chat_plans_semantic` | `lib/business-os/bizql/cache/PlanCache.ts:239-240` | `supabaseServer` imported at `:25` (service_role) ✅ | Business OS chat planner, L2 plan-cache lookup | yes | `logger.warn` "Semantic plan search unavailable; treating as a miss" (`:251`) |
| 2 | `record_business_chat_plan_outcome` | `PlanCache.ts:443` | `supabaseServer` (service_role) ✅ | chat, after a served cached plan | yes | **fully silent** (SA S3-5): supabase-js returns `{ error }` without throwing, and the result is not read, so the `logger.debug` in the `catch` (`:448`) never runs on a `42501` |
| 3 | `match_verified_questions` | `lib/business-os/bizql/planner/VerifiedQuestions.ts:152` | `supabaseServer` imported at `:39` (service_role) ✅ | chat planner few-shot examples | yes | `logger.warn` "Verified question lookup failed; planning without examples" (`:175`) |
| 4 | `increment_verified_question_uses` | `VerifiedQuestions.ts:165-166` | `supabaseServer` (service_role) ✅ | same, fire and forget | yes | **fully silent** (`.then(undefined, () => {})`, and the resolved `{ error }` is never read) |
| 5 | `get_or_create_user_organization` | `lib/repositories/OrganizationRepository.ts:209` | injected, default `supabaseServer` (`:11`, `:62`) ✅. Every instance: the module singleton `organizationRepository` (`:415`); `new OrganizationService()` with no argument (default `supabaseServer`, `OrganizationService.ts:13,68-69`) in 14 `app/api/v2/*` route sites; `new AutomationAdvisor()` with no argument (default `supabaseServer`, `AutomationAdvisor.ts:19,188-189`); `getAutomationAdvisor()` has no caller | `PUT app/api/business-os/business-profile/route.ts:414` (business profile save); `app/api/v2/organizations/current/route.ts:42` and `app/api/v2/groups/route.ts:49,127` via `ensureUserOrganization` | yes | `logger.error` "Failed to get or create organization" (`:216`) |
| 6 | `check_subdomain_available` | `lib/repositories/WebsitePageRepository.ts:437-438` (also `setSubdomain` `:603`) | injected. All 33 instantiations pass `supabaseServer`, including `WebsiteActionHandler` (only `new` is `app/api/business-os/actions/website/route.ts:85` with `supabaseServer`) and the `getWebsitePageRepository(supabaseServer)` singleton (4 callers) ✅ | `GET app/api/website/subdomain/check/route.ts:62` (website builder subdomain field) | yes | `logger.error` "Failed to check subdomain availability" (`:443`) |
| 7 | `generate_subdomain` | `WebsitePageRepository.ts:450-451` (`generateSubdomain`) | same instances ✅ | **no caller**: `WebsiteGenerationService.ts:348` calls its own private `generateSubdomain` (`:1560`), not the RPC | no (TS) | n/a |
| 8 | `upsert_intent_example` | `lib/repositories/IntentExampleRepository.ts:75` | injected; only `getIntentExampleRepository(supabaseServer)` exists (2 sites) ✅ | `PUT app/api/agents/[id]/route.ts:356,380` when an agent is first marked production-ready (`supabaseServer` dynamically imported at `:348`) | yes | `logger.error` "Failed to upsert intent example" (`:85`) |
| 9 | `find_similar_intent_examples` | `IntentExampleRepository.ts:110` | same ✅ | `app/api/v6/generate-ir-intent-contract/route.ts:187,191` (`supabaseServer` imported at `:48`) | yes | `logger.error` "Failed to find similar examples" (`:118`) |
| 10 | `record_intent_example_usage` | `IntentExampleRepository.ts:137` (`recordUsage`) | same ✅ | **no caller** of `recordUsage` | no (TS) | n/a |
| 11 | `upsert_workflow_pattern` | `lib/services/PatternExtractor.ts:92` (`extractAndStore`) | injected; only `getPatternExtractor(supabaseServer)` (`v6/generate-ir-intent-contract/route.ts:147`) ✅ | **no caller** of `extractAndStore` | no (TS) | n/a |
| 12 | `get_similar_patterns` | `PatternExtractor.ts:131` | same ✅ | `v6/generate-ir-intent-contract/route.ts:154` | yes | **silent** on an RPC error object (`if (error \|\| !data) return []`, `:136-138`); logs only on a throw |
| 13 | `record_global_failure` | `lib/services/GlobalFailureMonitor.ts:71` (`recordFailure`) | injected; only `getGlobalFailureMonitor(supabaseServer)` (`route.ts:148`) ✅ | **no caller** of `recordFailure` (the only `.recordFailure(` hit is an unrelated Stripe repository) | no (TS) | n/a |
| 14 | `get_active_failures` | `GlobalFailureMonitor.ts:101` | same ✅ | `route.ts:155` via `checkForAlerts` (`:127`); `getBestFix` (`:264`) has no caller | yes | **silent** on an RPC error object (`:106-108`) |
| 15 | `advance_contact_stage` | none in TS | n/a | SQL only (below) | yes (SQL) | n/a |
| 16 | `increment_calibration_count` | `lib/pilot/shadow/ShadowAgent.ts:306` | `this.supabase`; both `new ShadowAgent` sites pass `supabaseAdmin` (`WorkflowPilot.ts:577,2954`), a module-level `createClient(URL, SUPABASE_SERVICE_ROLE_KEY)` (`WorkflowPilot.ts:65-67`) ✅ | calibration and shadow-active runs (`ShadowAgent.ts:101`) | yes | **silent**: on error it falls back to a read-then-write of `agents.calibration_run_count` on the same client (`:310-`) |
| 17 | `record_business_event` | none in TS (`scripts/backfill-business-events.ts:593` inserts into `business_events` directly, not through the RPC) | n/a | SQL only (below) | yes (SQL) | n/a |
| 18 | `is_platform_admin` | none in TS | n/a | RLS policies only (§1.4) | yes (RLS) | n/a |

**SQL callers in git** (each must be SECURITY DEFINER and owned by `postgres` on prod, which the pre-check Q6 measures; inside a SECDEF function the nested call checks the **owner's** EXECUTE, which the revoke leaves alone):

| Function | Called by | Kind | SECDEF in git | Fires on |
|---|---|---|---|---|
| `advance_contact_stage` | `promote_contact_on_payment()` (`20260920_pipeline_transitions.sql:112`), `advance_contact_on_completed_booking()` (`:143`) | trigger functions (slice 5 list) | yes (`:122`, `:146`) | payment and completed-booking writes |
| `record_business_event` | `tg_booking_events`, `tg_invoice_events`, `tg_transaction_events`, `tg_proposal_events` (`20261006_business_event_triggers.sql`), redefined plus `tg_page_view_events`, `tg_contact_events`, `tg_activity_reply_events`, `tg_service_events` (`20261006c_close_remaining_event_gaps.sql`) | 8 trigger functions (slice 5 list) | yes, all with `SET search_path = public` | writes to `scheduling_bookings`, invoices, transactions, proposals, page views, `crm_contacts`, activity replies, services |
| `get_or_create_user_organization` | `auto_set_agent_org_id()` (`20260615_add_organizations.sql:231`); one-off DO blocks (`20260615:260`, `SQL Scripts/20260616_setup_org_data.sql:20`) that ran once as `postgres` | trigger function (slice 5 list), BEFORE INSERT on `agents` | yes | every agent insert, including signed-in users on the cookie client |
| `check_subdomain_available` | `generate_subdomain()` (`20260726_enhance_website_tables.sql:115`) | function in this slice | yes | only when `generate_subdomain` runs (no live caller) |

EXECUTE on a trigger function is not checked when it fires, so a signed-in or anonymous write that fires these triggers keeps working as long as the trigger function's owner keeps EXECUTE on the callee. The owner is never revoked. **A failure here would be loud, not silent:** the nested call is outside `record_business_event`'s own `EXCEPTION WHEN OTHERS` block, so a denied call would abort the booking, invoice, contact or payment write.

**Result: no BLOCKER.** Every TypeScript call site runs on a service-role client; every SQL caller in git is SECURITY DEFINER. This agrees with SA's 2026-10-07 finding; code has moved since, but no new caller appeared, and no site uses `supabaseServerAuth`, `createAuthenticatedServerClient` or the browser `supabaseClient`. Prod-only callers (SQL objects not in git) are measured by the pre-check (Q6 to Q9, Q11).

**What proves the silent callers (SA S3-5).** Rows 2, 4, 12, 14 and 16 leave no log line on a `42501`, and 12, 14 and 16 leave no table trace either. Their proof is the checker's C6 (`service_role` keeps EXECUTE) **plus** the traced service-role clients in this table. Logs cannot prove them. Rows 2 and 4 get indirect evidence from the F1 before/after snapshot (§5.3).

Dead TS references found (no caller, no action in this slice, recorded for the later drop decision as in slice 2): `WebsitePageRepository.generateSubdomain`, `IntentExampleRepository.recordUsage`, `PatternExtractor.extractAndStore`, `GlobalFailureMonitor.recordFailure` and `getBestFix`. They are service-role, so the revoke does not affect them either way.

### 1.4 `is_platform_admin` (C-9, FR-0.14)

Uses in git (every one in `20260920a_lock_system_settings_and_pricing_rls.sql`):

| Object | Command | Roles | Can anon evaluate it? |
|---|---|---|---|
| policy `ai_model_pricing_admin_select` on `ai_model_pricing` (`:174-177`) | SELECT | `authenticated` | no |
| policy `ai_model_pricing_admin_write` on `ai_model_pricing` (`:182-186`) | ALL | `authenticated` | no |
| policy `system_settings_config_admin_write` on `system_settings_config` (`:224-228`) | ALL | `authenticated` | no |

No function, view, trigger or TS file in git calls it (the authz guard test only quotes its name). PostgreSQL attaches to a query only the policies whose roles match the current role, so a policy `TO authenticated` is never evaluated for `anon`, and anon never needs EXECUTE.

**Live path that exercises it:** `lib/design-system-v2/theme-provider.tsx:63` and `lib/hooks/useUIVersion.ts:18,50,73` read `system_settings_config` from the browser with `supabaseClient`. Signed out that is `anon`: only the open SELECT policies apply, `is_platform_admin` is not evaluated. Signed in that is `authenticated`: the `FOR ALL` admin-write policy also applies to SELECT (OR-ed with the open SELECT policy), so `is_platform_admin()` runs on **every signed-in page load**. That is why `authenticated` must keep EXECUTE, and it gives the acceptance a free signed-in and signed-out smoke (§5.3).

**Prod-only policies are unknown** (C-9). The pre-check lists every prod policy naming it (Q7) and every `pg_depend` dependent (Q11), with roles, and stops on any policy with a role other than `authenticated` or `service_role` (SA S3-1).

### 1.5 Slice 6 guard

The migration defines and alters no function, so it adds **0** (file, function) pairs and no finding; `20261049` is after the freeze date. The repo-defined functions stay on the frozen baseline through their original `CREATE` files (same-file rule); the baseline does not shrink, and progress is measured on prod by the checker. The two new `scripts/*.sql` files fall under the O-1 tripwire, so none of the four SQL files may contain the phrase `SECURITY DEFINER`, even inside a string (F-2); the pre-check reads `prosecdef`.

### 1.6 Skills consulted

| Skill | Applies? |
|---|---|
| `business-os-schema-check` | Yes: TSV is the prod evidence; the pre-check re-measures existence, owner, grantors, callers, policies and dependents before apply. Table and column names in §5.3 checked against git migrations (`business_events.created_at`, `business_chat_plan_cache.last_seen`/`hit_count`, `crm_contacts.updated_at`, `organizations.created_at`, `business_chat_verified_questions.uses`, `agents.org_id`). `agents.calibration_run_count` is **not** in any git migration (prod-only column, SA S3-6), so F7 stays optional and informational |
| `tenant-isolation-guard` | No new write path. The slice removes the anon/authenticated path to caller-supplied-tenant-id functions (`record_business_event`, `advance_contact_stage`, `get_or_create_user_organization`, `match_verified_questions`, `search_business_chat_plans_semantic`) |
| `business-os-entitlements` | No import from the module |
| `durable-queue-drain` | No drain touched; crons are watched only because their writes fire the event triggers |
| `new-api-route`, `new-repository`, `new-plugin`, `bos-llm-call-standards` | Not applicable |

No TS source is touched, so there is no `console.*` flag to raise. (`app/api/agents/[id]/route.ts` and `lib/pilot/WorkflowPilot.ts` use `console.*`, but neither is modified.)

### 1.7 Lessons carried over

| Lesson | Where it lands |
|---|---|
| Slice 1 false `DIFFERS` (collation) | `COLLATE "C"` on every `string_agg ... ORDER BY`, pinned by the test |
| W-1 grantor, W-2 no LIKE, W-5 static rules, READ ME new-tab order | Unchanged from slice 2 |
| Slice 1: callers swallow RPC errors, so run records alone prove nothing | Rows 2, 4, 12, 14, 16 are silent on error (§1.3); acceptance reads logs and table counts, and C6 is the authority for the service_role grant |
| S2-1 Q11 `pg_depend` | Kept, with a per-function rule for `is_platform_admin` (§2.1, Q-2) |
| S2-3 rollback only on an attributed caller | Kept, extended with the functional checks (§6) |

---

## 2. Approach

### 2.1 Pre-check (read-only, single result set)

**File:** `scripts/precheck-secdef-lockdown-slice3.sql`. The slice 2 pre-check with these changes:

- `watched` VALUES gains two columns: `(fn_name, fn_signature, fn_order, expected_grantees, keeps_authenticated)`. `expected_grantees` is the TSV string per shape (B, C or D); `keeps_authenticated` is `true` only for `is_platform_admin`.
- **Q0 type vector (new, Q-3):** one row, `pg_catalog.to_regtype('vector')` and its schema; `stop here` if NULL. Explains a Q1 `MISSING` on rows 1 and 3 before anyone hunts for a dropped function.
- **Q4 privileges:** `ok` now compares against the shape's pre-state rather than "all four true": shapes B and C expect `public true anon true authenticated true service_role true`; shape D expects `public false anon true authenticated true service_role true`.
- **Q6 callers:** as slice 2 (`stop here` if SECURITY INVOKER, or SECDEF with an owner other than `postgres`), except for `is_platform_admin` (SA S3-2): a SECDEF caller with an owner other than `postgres` is `stop here`; an INVOKER caller whose `prorettype` is `trigger` is `stop here` unconditionally (EXECUTE on a trigger function is not checked when it fires, so the trigger's own grants say nothing about who fires it); any other INVOKER caller is `stop here` only if `anon` can execute it (`has_function_privilege('anon', caller, 'EXECUTE')`), because a caller run by `authenticated` keeps working. Each caller row shows `trigger` and `anon executes`. Expected on prod: the 8 `tg_*` functions for `record_business_event`, the 2 pipeline triggers for `advance_contact_stage`, `auto_set_agent_org_id` for `get_or_create_user_organization`, `generate_subdomain` for `check_subdomain_available`, all SECDEF `postgres` and `ok`. Prod-only callers are recorded, not predicted. **The count of `record_business_event` callers is R-3's evidence** and is pasted into the QA report.
- **Q7 policies:** for the 17, `stop here` if roles include `public`, `anon` or `authenticated` (as slice 2). For `is_platform_admin`, every policy is listed with its command and roles (C-9), and is `ok` only when **every** role in `pg_policies.roles` is `authenticated` or `service_role` (`roles <@ ARRAY['authenticated', 'service_role']`, SA S3-1); `public`, `anon` or any other role is `stop here`. Expected: the 3 git policies, `ok`, plus any prod-only ones.
- **Q8 views:** any row is `stop here` (unchanged).
- **Q9 cron:** unchanged.
- **Q11 dependents:** for the 17, any `pg_depend` row is `stop here` (slice 3 contains no trigger function, so the S2-4 `pg_trigger` exception does not arise). For `is_platform_admin`, the 3 policies above will also appear here, since a policy expression records a dependency (`pg_policy`, deptype `n`). Rule (SA S3-1): a `pg_policy` dependent is joined to `pg_policy.polroles` and is `ok` only when `polroles <@ ARRAY[authenticated oid, service_role oid]` (via `to_regrole`); `0` (`PUBLIC`), `anon` or any other role is `stop here`, and any other catalog is `stop here`. The row shows the roles (`polroles::regrole[]`, where `PUBLIC` prints as `-`). This makes Q11 an independent second reading of C-9 that does not depend on Q7's text match.
- `string_agg ... ORDER BY ... COLLATE "C"` everywhere; first statement `SET default_transaction_read_only = on`; READ ME row; `PRECHECK STATUS` CLEAN or `STOP n`. No Q10 (no slice 3 name shadows a `pg_catalog` built-in).

| Item | Expected on prod |
|---|---|
| Q0 type vector | resolves, schema recorded |
| Q1 exists | `present` x18 |
| Q2 owner | `postgres ok` x18 |
| Q3 secdef | `true` x18; config per TSV (null x14, `search_path=public` x3, `search_path=pg_catalog, public` x1) |
| Q4 privileges | `ok` x18 against the shape |
| Q5 grantees / grantors | `match` and `owner granted all` x18 |
| Q6 | callers listed above, all `ok` |
| Q7 | 3 or more `is_platform_admin` policies, all `ok`; none for the 17 |
| Q8 | none |
| Q9 | `cron not installed` or `none` |
| Q11 | 5 or more `pg_policy` rows for `is_platform_admin`, all `ok` (QA: a `FOR ALL` policy with USING and WITH CHECK records two dependencies, so the 3 git policies give 1 + 2 + 2 = 5); 0 for the 17 |

### 2.2 Migration

**File:** `supabase/migrations/20261049_secdef_lockdown_slice3_server_internal.sql`. Same form as slice 2:

```sql
BEGIN;

REVOKE EXECUTE ON FUNCTION public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_business_chat_plans_semantic(vector, text, text, uuid, double precision, integer) TO service_role;

(one REVOKE plus one GRANT per function, rows 1 to 17 in the §1.1 order)

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[ (the 17 service_role-only signature literals) ]
  LOOP
    (slice 2 checks: NULL raises; public, anon, authenticated each raise if still held; service_role raises if lost)
  END LOOP;

  slice_function := pg_catalog.to_regprocedure('public.is_platform_admin()');
  (NULL raises; public raises if held; anon raises if held;
   IF NOT pg_catalog.has_function_privilege('authenticated', ...) raises 'authenticated lost EXECUTE';
   service_role raises if lost)
END
$$;

COMMIT;
```

Decisions inherited from slices 1 and 2 (SA-approved there): REVOKE always lists all three client grantees; the service_role GRANT is kept although redundant; `REVOKE EXECUTE`, not `REVOKE ALL`; fail, never skip; no `SELECT` and no `INTO` in the DO block (C-7); built-ins `pg_catalog.`-qualified, every name `public.`-qualified; no `SECURITY`, `search_path`, `CREATE`, `ALTER`, `DROP`. New: one GRANT naming two roles (`TO authenticated, service_role`) for row 18 (Q-4), and a second, unlooped post-condition block for it.

### 2.3 Checker (read-only, VERDICT first)

**File:** `scripts/check-secdef-lockdown-slice3-migration.sql`. Slice 2's checker with `keeps_authenticated` in `watched`; `C5 authenticated` expects `keeps_authenticated` instead of a constant `false`. Six checks per function, `IS FALSE` / `IS TRUE` so a NULL is FAIL.

- **After apply:** `VERDICT PASS 108 pass 0 fail` (18 x 6).
- **Before apply (dry run):** `VERDICT FAIL 56 pass 52 fail`. The 17: C1, C2, C6 pass, C3 to C5 fail (51/51). `is_platform_admin`: C1, C2, C3 (public already false), C5 (authenticated true, expected true) and C6 pass, C4 anon fails (5/1).

### 2.4 Rollback

**File:** `supabase/SQL Scripts/20261049_secdef_lockdown_slice3_server_internal_rollback.sql`. `BEGIN;` then per shape: 14 x `GRANT ... TO PUBLIC, anon, authenticated` (B), 3 x `GRANT ... TO PUBLIC` (C), 1 x `GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon` (D). DO post-condition: for the 17, all four roles true (shape C gets anon and authenticated through PUBLIC); for `is_platform_admin`, public **false**, anon, authenticated and service_role true; NULL raises. `COMMIT;`. No REVOKE. After a rollback the pre-check must read Q4 `ok` and Q5 `match` x18, which proves the exact pre-state ACL sets were rebuilt. All-or-nothing for the 18 (Q-6).

### 2.5 Static test

**File:** `supabase/migrations/__tests__/secdef-lockdown-slice3.migration.test.ts`. The slice 2 test with a `SLICE_3` constant of 18 `{ name, signature, shape, rollbackGrantees, keepsAuthenticated }`; asserts in §5.1.

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-secdef-lockdown-slice3.sql` | create | Read-only pre-check (FR-0.5, FR-0.10, FR-0.11, FR-0.14, Q11) |
| `supabase/migrations/20261049_secdef_lockdown_slice3_server_internal.sql` | create | The revoke, with in-transaction post-conditions (FR-0.1, FR-0.9, FR-0.12) |
| `scripts/check-secdef-lockdown-slice3-migration.sql` | create | Read-only checker, VERDICT first (FR-0.4) |
| `supabase/SQL Scripts/20261049_secdef_lockdown_slice3_server_internal_rollback.sql` | create | Per-shape pre-state restore (FR-0.5) |
| `supabase/migrations/__tests__/secdef-lockdown-slice3.migration.test.ts` | create | Static asserts (FR-0.13, C-8) |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify | §4.3: S2 merged, new S3 row; Change History. Later: S3 PR, merge, apply, acceptance |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify | §6 row 2: slice 2 merge commit (SA nit, done). At PR time: row 3 number and status |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE2_WORKPLAN.md` | modify | Status: merged (PR #277, `4724b727`); log checks pending |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md` | create | This workplan |

No TS source, no other migration, no CI workflow change.

---

## 4. Task list

- ✅ T-0: Branch confirmed (`fix/secdef-lockdown-slice-3`); requirement, slice 1 and 2 workplans, slice 2's five files and TSV read
- ✅ T-1: 18 signatures and three grant shapes verified against the TSV (§1.1, §1.2)
- ✅ T-2: Callers re-verified on `4724b727`, client role per site (§1.3); `is_platform_admin` uses listed (§1.4). No blocker
- ✅ T-3: Migration number checked: `20261049` proposed (header)
- ✅ T-4: Workplan written; requirement §4.3 S2 row (merged) and new S3 row; slice 2 workplan status
- ✅ T-5: SA workplan review: approved with S3-1 to S3-6, Q-1 to Q-10 ruled. S3-1 and S3-2 folded into §2.1; S3-3 to S3-5 into §1.3, §5.3, §6 and the QA section's acceptance blocks; S3-6 into §1.6. SA's part (A) nits applied (requirement §4.3 S2 workplan cell, inventory §6 row 2 merge commit)
- ✅ T-6: Static test written against `SLICE_3` (TSV-driven; acceptance blocks pinned)
- ✅ T-7: Pre-check written (§2.1: Q0, per-shape Q4, S3-1 and S3-2 rules for `is_platform_admin` in Q6, Q7, Q11; `COLLATE "C"`)
- ✅ T-8: Migration and rollback written (per-shape rollback grantees)
- ✅ T-9: Checker written (C5 expectation from `keeps_authenticated`)
- ✅ T-10: Slice 3 test; regressions (slice 1 and 2 tests, `npm run test:authz-guard`, `no-deletion-paths`, `tsc --strict` on the test file, paste greps on all four SQL files and the QA blocks). Re-check the number against `origin/main` and open PRs; rename everything together if taken. **Done 2026-10-09:** slice 3 test 100/100 (mutation-checked: dropping one `COLLATE "C"` and loosening the S3-1 Q7 rule fail 2 tests; restored, 100/100); slice 1 and 2 tests, `authAccountRepository.callers.guard` and `tailwind-css-escape.guard` 155/155; `test:authz-guard` 203/203 (slice 6 guard green, 0 new pairs); `tsc --strict` on the test file clean; paste greps clean on all four SQL files (no `--`, `/*`, "into", LIKE, `SECURITY DEFINER` text, odd quotes; LF) and on the 12 acceptance blocks (only P3 holds literals, exactly the two allowed). None of the 18 names is guarded by a callers guard (`authAccountRepository.callers.guard` guards only `business_os_auth_email_has_account`, absent from every new file). Number re-checked: `origin/main` `90c33582` tops at `20261048`, no open PR touches `supabase/migrations|SQL Scripts|held`, so `20261049` is free
- ⬜ T-11: SA code review, then the user sees the diff (left uncommitted)
- ⬜ T-12: User runs §6 steps 1 to 6 on prod; results recorded under QA Testing Report
- ⬜ T-13: QA confirms §5.3 acceptance; requirement §4.3 and inventory §6 updated with PR, merge and apply state

---

## 5. Test plan

### 5.1 Static test asserts (C-8, FR-0.13, slice 1 W-5, slice 2)

**`SLICE_3` TSV cross-check:** parse `kind = fn` rows; exactly one row per entry; `identity_args` with names stripped equals the signature's type list (handles `double precision`, `timestamp with time zone`, `uuid[]`, `text[]`, the empty list); `shape` agrees with `execute_grantees`; `rollbackGrantees` equals TSV `execute_grantees` minus `postgres` and `service_role`, minus `authenticated` when `keepsAuthenticated`; 18 distinct names; exactly one entry with `keepsAuthenticated`, and it is `is_platform_admin`.

**All four SQL files and the QA blocks:** as slice 2 (no `--`, `/*`, "into", LIKE/ILIKE, single-letter alias, `SECURITY DEFINER` text; even quotes; literals plain or on an exact per-file allow-list of the 18 signatures, plus `cron.job` / `TABLE cron.job` in the pre-check, plus `vector` (plain) for Q0). **Acceptance blocks** (QA section, S3-4): pinned statement for statement; every block literal-free except P3, which holds exactly `'request.jwt.claims'` and `'sub'`; no timestamp literal anywhere (the time window is `pg_catalog.now() - pg_catalog.make_interval(mins => N)`).

**Migration:** one `BEGIN`/`COMMIT`; 18 REVOKE, each exactly `... FROM PUBLIC, anon, authenticated`; 17 GRANT `TO service_role` and one `GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role`, paired in `SLICE_3` order; the `ON FUNCTION` set equals `SLICE_3`, every one `public.`-qualified; the DO array equals the 17 (no `is_platform_admin`); the `is_platform_admin` block has the NULL raise, `public` and `anon` held raises, `IF NOT ... 'authenticated'` and `IF NOT ... 'service_role'` raises, and no `'authenticated'` held-raise for it; no `SELECT`; no `ALTER`, `CREATE`, `DROP`, `SECURITY`, `search_path`, `REVOKE ALL`, `CASCADE`, table keyword.

**Rollback:** one `BEGIN`/`COMMIT`; one GRANT per entry whose grantee list equals `rollbackGrantees`; no REVOKE; post-condition expects four true for the 17 and `public` false plus the other three true for `is_platform_admin`.

**Checker and pre-check:** read-only first statement; no write keyword; signature set equals `SLICE_3`; checker VERDICT first, 6 checks per function, C5 expectation taken from `keeps_authenticated` (and `true` only for `is_platform_admin`); pre-check markers `Q0` to `Q9`, `Q5 grantors`, `Q11`, `PRECHECK STATUS`, no `Q10`; Q11 joins `pg_policy` / `polroles` for the `is_platform_admin` rule; Q7 role arrays differ per `keeps_authenticated`; expected-grantee strings read from the TSV; every `string_agg ... ORDER BY` ends in `COLLATE "C"`.

### 5.2 What Jest cannot show

No branch database (FR-0.6). QA repeats the local PGlite run with the slice 3 shapes (B, C, D), including: the shape D pre-state (`REVOKE ... FROM PUBLIC` plus default-privilege `anon`/`authenticated`); a `TO authenticated` policy calling `is_platform_admin` (Q7 and Q11 `ok`, and after the migration an `authenticated` SELECT works and an `anon` SELECT on the same table returns rows from an open SELECT policy without `42501`); the negative of that (a policy with no `TO` clause, roles `{public}`, must give Q7 and Q11 `stop here`; after the migration an `anon` SELECT fails `42501` only when no always-true read policy sits beside it, since PostgreSQL can then skip evaluating the function, but the pre-check stops either way); a SECDEF trigger owned by `postgres` that calls `record_business_event`, fired by an `authenticated` INSERT after the migration (must succeed); and the same with the trigger function SECURITY INVOKER (Q6 `stop here`, and the INSERT fails `42501`).

### 5.3 Acceptance after apply (SA-approved with S3-3 to S3-5)

**Why heavier than slice 2.** These functions have live callers, five of them swallow errors silently (§1.3 rows 2, 4, 12, 14, 16), and two sit inside triggers on booking, invoice, contact and payment writes. So acceptance proves the grant (checker), the closed paths (negative calls), the kept paths (positive `authenticated` call and policy reads), and that the real flows still write, with logs over a window. Let T be the apply time (UTC). Apply at a quiet hour.

**Mandatory (S3-3):** checker, N1 to N3, P1, P2a, P2b, P3, F1, F2, F3, F4, F5, F8, step 4 and step 5. **Optional:** F6, F7, the inventory re-run. Every SQL block below is written verbatim in the QA section (§ Acceptance blocks) and pinned by the static test. No block holds a timestamp literal: windows are `pg_catalog.now() - pg_catalog.make_interval(mins => N)`, so each block is run inside its window (S3-4).

1. **Checker:** `VERDICT PASS 108 pass 0 fail`.
2. **Role calls in the SQL editor**, each block in its own new tab, `BEGIN; SET LOCAL ROLE ...; ...; ROLLBACK;`, NULL arguments, no string literal except P3:
   - N1 `anon` on `record_business_event` with 10 NULL arguments → `42501`. Shape C, so this proves the `PUBLIC` path is closed. (Were it still open, the body returns at its NULL guard, and the block rolls back anyway.)
   - N2 `authenticated` on `public.get_similar_patterns(NULL::text[])` → `42501`. Shape B, read-only body. (`vector` arguments are avoided on purpose.)
   - N3 `anon` on `public.is_platform_admin()` → `42501`.
   - P1 `authenticated` on `public.is_platform_admin()` → `false`, no error (no JWT in the editor). Positive proof that `authenticated` kept EXECUTE.
   - P2a as `anon`: row counts of `system_settings_config` and `ai_model_pricing` → no `permission denied for function` (anon is not subject to the admin policies, C-9 in practice). A `permission denied for table` would be a table grant, not this slice; record it.
   - P2b as `authenticated`: `ai_model_pricing` row count → `0`, no error (policy evaluated, function executed, not an admin).
   - P3 (mandatory, Q-5) admin read: as `postgres`, set `request.jwt.claims` to `{"sub": <an active admin's user_id>}` for the transaction, then `SET LOCAL ROLE authenticated` and read `is_platform_admin()` and the `ai_model_pricing` row count → pass when `is_admin` is true **and** `pricing_rows` > 0 (P2b showed 0 for a non-admin). **If `is_admin` reads false, record P3 as inconclusive, never a pass, a fail or a rollback** (S3-4, SA N-2): either no active `admin_users` row has a bound `user_id`, or the prod `auth.uid()` predates `request.jwt.claims` and reads only `request.jwt.claim.sub`. The block holds exactly two literals, `'request.jwt.claims'` and `'sub'`.
   - No positive service_role call on the 17 (Q-1): C6 proves the grant, and the flows in step 3 run them for real.
3. **Functional proof, within T+60 min** (test account where it writes data):
   - F1 Business OS chat. Run block F1 (`plan_hits` = sum of `business_chat_plan_cache.hit_count`, `vq_uses` = sum of `business_chat_verified_questions.uses`) **before**, then ask two questions and repeat one, then run F1 again **after**. A rise is direct evidence for `record_business_chat_plan_outcome` / `increment_verified_question_uses`; no rise is not a failure (no cached plan or verified example may have been served). Vercel: count "Semantic plan search unavailable" and "Verified question lookup failed" after T and **compare with the 24 h before T**, since both also fire for non-permission causes (S3-5).
   - F2 Business profile: save the profile in Business OS settings **with an organisation-section field changed (for example the business name)**; otherwise `getOrCreateForUser` is not reached (`business-profile/route.ts:412`). Expect success; Vercel "Failed to get or create organization" 0 after T (compare the prior 24 h).
   - F3 Website builder: check a subdomain in the subdomain field (`GET /api/website/subdomain/check`). Expect an available/taken answer; Vercel "Failed to check subdomain availability" 0 after T (compare the prior 24 h).
   - F4 **One test contact end to end** (S3-3), the R-3 check: (a) create a contact in a lead stage; (b) create a booking for it; (c) mark that booking completed (`advance_contact_on_completed_booking` → `advance_contact_stage`); (d) create an invoice for that contact with amount greater than 0 and use **Mark paid** (`/api/payments/invoices/[id]/mark-paid` inserts a `payment_transactions` row → `tg_transaction_events` and `promote_contact_on_payment` → `advance_contact_stage`, plus `tg_invoice_events`). **The proof is that every write returns success**; any failure is an immediate rollback (§6). Corroboration: block F4-events (last 30 min) shows `contact.created`, `booking.created`, `invoice.created`, `invoice.paid` and `payment.completed`; `contact.stage_changed` appears only if the account has a `prospect`/`client`-type stage configured, so its absence is not a failure. `business_events.created_at` is the trigger's `p_occurred_at` (`NEW.created_at`, `paid_at`, `stage_entered_at`), which is fine for rows created in the window. Block F4-contacts (last 30 min) is non-zero.
   - F5 Signed-out and signed-in page loads: on the landing page (anon) and the dashboard (authenticated), check the **DevTools Network** status of the `rest/v1/system_settings_config` request: `200` both times. Both readers swallow errors (`theme-provider.tsx:67`; `getUIVersion` returns `'v1'`), so a quiet console proves nothing (S3-3).
   - F8 Agent insert (S3-3): `auto_set_agent_org_id` calls `get_or_create_user_organization` on every agent insert. Create one agent (or rely on natural traffic), then run block F8 (last 90 min): `new_agents` at least 1 and `without_org` 0. **The rollback signal is a failed agent insert** (a denied nested call aborts the insert in the BEFORE INSERT trigger); `without_org` above 0 cannot come from this slice and is investigate-only (SA N-3).
   - F6 (optional) V6: generate one agent to the IR step on `/v2/agents/new` (`find_similar_intent_examples`, `get_similar_patterns`, `get_active_failures`). Vercel "Failed to find similar examples" 0 after T. The other two leave no trace; C6 only.
   - F7 (optional, informational) calibration: one calibration run; `agents.calibration_run_count` (a prod-only column) rises. `ShadowAgent` falls back silently, so the count cannot prove the RPC; C6 only.
   - **No trace by design:** `get_similar_patterns`, `get_active_failures` and `increment_calibration_count` are proven by C6 plus the traced service-role clients (§1.3), nothing else (S3-5).
4. **Run records, necessary not sufficient:** block CRON (last 90 min) shows at least one `succeeded` run for `payment-reminders`, `payment-retry`, `lead-response`, `insight-actions` and `daily-briefing` (their writes fire the event and pipeline triggers).
5. **Logs, counts not lines (S2-3):** (a) Supabase Postgres logs T to T+24 h: count of `permission denied for function`, and of those how many name one of the 18; attribute each where the log allows; unattributed or anon hits are probe counts, not failures. (b) Vercel production logs at T+15 min and T+60 min: `permission denied for function` and `42501`, expected 0. (c) Supabase API / edge path search for `/rest/v1/rpc/<one of the 18>`, best-effort.
6. Optional: re-run the inventory; anon-executable drops from 42 to 24, non-trigger from 24 to 6 (the slice 4a set).

Acceptance is complete at T+24 h with every mandatory item green (P3 may be recorded inconclusive per S3-4).

---

## 6. Apply order and rollback plan

All steps are run by the user in the Supabase SQL editor on prod (FR-0.6). Dev never connects to a database.

| Step | Where | Expect |
|---|---|---|
| 1. Pre-check | tab A | `PRECHECK STATUS CLEAN`. Paste the output under QA Testing Report (it is the C-9 and R-3 evidence). Any `stop here`: stop and bring it to Dev/SA |
| 2. Migration | **new** tab B | `Success. No rows returned`. Any error means nothing was applied |
| 3. Checker | new tab C | `VERDICT PASS 108 pass 0 fail` |
| 4. Role calls | one new tab per block | §5.3 step 2 |
| 5. Functional | the app, signed in and signed out | §5.3 steps 3 and 4 |
| 6. Logs | Vercel at T+15 and T+60 min; Supabase Postgres at T+24 h | §5.3 step 5 |
| 7. Merge | GitHub | After SA code review, QA pass and the user's approval (RM). Apply and checker run before merge (FR-0.6) |

**Rollback triggers (S2-3, extended): only a caller identified as ours.** Namely: a Vercel `42501` or `permission denied for function` naming one of the 18; a §5.3 step 2 positive (P1, P2a, P2b, P3) failing with `permission denied for function`; a step 3 write failing with a permission error (a booking, invoice, contact or payment write, an agent insert, a profile save, a subdomain check); an agent insert failing with a permission error (F8; the `auto_set_agent_org_id` BEFORE INSERT trigger aborts the insert, so this slice cannot leave `org_id` NULL, and F8 `without_org` above 0 is investigate-only, not a trigger, SA N-3); a non-200 `system_settings_config` request in F5; or a Supabase log or API entry naming one of the 18 whose role, user agent or source we recognise. A bare Postgres-log hit, or an anon hit we cannot attribute, is a probe count, not a trigger. On a real trigger: paste the rollback in a new tab, re-run the pre-check (Q4 `ok`, Q5 `match` x18), and bring the caller to Dev. Because the trigger-path functions guard payment writes, a failing F4 write is rolled back at once, without waiting for attribution.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A prod-only SQL caller (INVOKER function, view, policy, column default) of one of the 18 | Pre-check Q6 to Q9 and Q11; any `stop here` holds the apply |
| R-2 | A `tg_*` or pipeline trigger function is not owned by `postgres` on prod, so its nested call would be checked against an owner who loses nothing but may hold nothing explicitly | Q6 flags a SECDEF caller with another owner as `stop here` |
| R-3 | `record_business_event` has a caller other than the `tg_*` triggers | Code search (none, §1.3) plus pre-check Q6 to Q9, Q11; F4 functional check |
| R-4 | A prod-only policy on `public`/`anon` uses `is_platform_admin`, so anon reads of that table would fail `42501` (C-9) | Q7 and Q11 both list and judge every such policy; P2 and F5 after apply |
| R-5 | `vector` not resolvable in the applying session | Q0; the migration raises rather than skipping (C-2) |
| R-6 | Silent callers (rows 2, 4, 12, 14, 16) would hide a failure | Every one runs on service_role, which C6 proves; F1 and F7 give indirect evidence |
| R-7 | Payment and booking writes run through the trigger path | Owner keeps EXECUTE; a failure would be loud; apply at a quiet hour; immediate rollback on an F4 failure |
| R-8 | Non-owner REVOKE or foreign grantor | Q2, Q5 grantors, post-conditions raise |
| R-9 | Collation false `DIFFERS` | `COLLATE "C"` pinned |
| R-10 | Migration number taken before merge | T-10 re-check |
| R-11 | SQL-editor paste bugs | Static test, exact literal allow-list |

---

## 8. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Acceptance (§5.3): checker, 3 negative and 2 or 3 positive role calls, 5 functional flows (2 optional), `bos_cron_runs` for the 5 crons, logs to T+24 h with Vercel at T+15 and T+60 min. Add one positive service_role call (`check_subdomain_available(NULL::text)`, read-only)? | Yes to the set; no to the service_role call (C6 proves the grant and F2 to F4 run the real paths) |
| Q-2 | Q11 for `is_platform_admin`: its policies are `pg_policy` dependents, so the slice 2 rule (any row stops) would always stop. Judge a `pg_policy` dependent by `polroles` (`ok` unless it contains `PUBLIC` or `anon`), every other catalog `stop here`? | Yes. It also gives C-9 a second reading independent of Q7's text match |
| Q-3 | Add Q0 (`to_regtype('vector')` and schema) to the pre-check? Or qualify the type in the signature literals? | Add Q0 and keep the TSV's unqualified `vector` (FR-0.2). Qualifying would diverge from the TSV and the static test's derivation |
| Q-4 | Row 18: one `GRANT ... TO authenticated, service_role` (as its original migration did), or two GRANT statements? | One statement; the static test pins it as the only two-role GRANT |
| Q-5 | P3 admin read in the SQL editor needs the literal `request.jwt.claims` (dots). Allow it in the QA block's literal allow-list, or rely on P1, P2 and F5, which show `authenticated` executes the function but do not show an admin seeing rows? | Allow it, on the QA block only. It is the only way to prove the §6 "signed-in admin still reads" line, since no app path reads these tables on a user session |
| Q-6 | Rollback all 18 at once (slice 1 and 2 form), or per function? | All at once, as before. A per-function file multiplies paste surface; the bridge is short and only an attributed caller opens it |
| Q-7 | Q6 for `is_platform_admin`: an INVOKER caller is `stop here` only when `anon` can execute that caller. Acceptable, or treat every INVOKER caller as stop, as for the 17? | The narrower rule: an INVOKER caller reachable only by signed-in users keeps working, because `authenticated` keeps EXECUTE |
| Q-8 | Dead TS references (`WebsitePageRepository.generateSubdomain`, `IntentExampleRepository.recordUsage`, `PatternExtractor.extractAndStore`, `GlobalFailureMonitor.recordFailure` and `getBestFix`): record them against SQ-3 as in slice 2? | Yes, record only. They are service_role, so the revoke does not break them; nothing to delete in a revoke slice |
| Q-9 | Migration name `20261049_secdef_lockdown_slice3_server_internal.sql`, `secdef-lockdown-slice3` for scripts and test | As proposed, re-checked at PR time |
| Q-10 | `increment_calibration_count` is the only prod-only function in the slice. Capture its DDL now (C-10), or with the S7 batch? | With the S7 batch; it is not needed for a revoke |

---

## SA Review Notes

**Reviewed by SA — 2026-10-09**
**Status:** ✅ Approved with conditions (S3-1 to S3-6). Fold them in before T-6; no re-review of the workplan needed, they are checked at code review.

### Independent re-verification (main `4724b727`)

- **TS callers:** all 14 live/dead `.rpc()` sites re-traced to the instantiated client. `PlanCache` and `VerifiedQuestions` import `supabaseServer` directly; `OrganizationRepository` default + every `new OrganizationService()` / `new AutomationAdvisor()` (no argument) and the module singleton; all 33 `WebsitePageRepository` / `WebsiteActionHandler` instantiations pass `supabaseServer`; `getIntentExampleRepository` / `getPatternExtractor` / `getGlobalFailureMonitor` singletons are only ever first-created with `supabaseServer`; `ShadowAgent` gets `WorkflowPilot`'s module-level service-key client. No browser `supabaseClient`, no cookie client, and no `supabaseServer.auth.signIn*/setSession` anywhere that could put a user JWT on a shared service-role singleton. Agrees with §1.3.
- **SQL callers:** the 8 `tg_*_events`, `promote_contact_on_payment`, `advance_contact_on_completed_booking` and `auto_set_agent_org_id` are all rows of the prod TSV (`kind = trigger`), i.e. SECURITY DEFINER in prod; none is INVOKER. Owner is not in the TSV, so Q6's owner = `postgres` check is the load-bearing evidence. Confirmed the "loud, not silent" claim: the EXECUTE check happens at the caller's `PERFORM`, outside `record_business_event`'s own `EXCEPTION WHEN OTHERS`, so a denial aborts the business write.
- **`is_platform_admin`:** only the 3 `TO authenticated` policies in git; browser reads (`theme-provider.tsx`, `useUIVersion.ts`) are on `system_settings_config` and evaluate it only when signed in. Prod-only policies remain the unknown (C-9), covered by Q7 + Q11.
- **Counts:** dry-run 56/52 and post 108/0 correct; inventory step 6 (42→24, non-trigger 24→6) correct.
- **Schema claims:** `business_events.created_at` / `event_type`, `business_chat_plan_cache.last_seen` / `hit_count`, `crm_contacts.updated_at`, `business_chat_verified_questions.uses` exist in migrations. **`agents.calibration_run_count` is not in any git migration** (prod-only column) — §1.6 claims otherwise (S3-6).

### Conditions

1. **S3-1 (High) — one role rule for `is_platform_admin` policies, in both Q7 and Q11.** A policy (by `pg_policies.roles` in Q7, by `pg_policy.polroles` in Q11) is `ok` only when **every** role in it is `authenticated` or `service_role`; anything else — `0`/`public`, `anon`, or any other role (a custom role `anon` may inherit) — is `stop here`. This is FR-0.14 ("`TO authenticated` only") with `service_role` tolerated because it bypasses RLS. Replaces the "contains neither 0 nor anon" form. Any non-`pg_policy` dependent of `is_platform_admin` stays `stop here`.
2. **S3-2 (High) — Q6 for `is_platform_admin` (Q-7):** narrower rule accepted, plus: an INVOKER caller whose `prorettype` is `trigger` is `stop here` unconditionally (EXECUTE on a trigger function is not checked when it fires, so `has_function_privilege('anon', trigger_fn)` says nothing about whether an anon write fires it). SECDEF caller with a non-`postgres` owner stays `stop here`.
3. **S3-3 (High) — acceptance: mandatory set and concrete trigger path.** Mandatory: checker, N1–N3, P1, P2, **P3**, F1, F2, F3, **F4 as below**, F5, **F8 (new)**, step 4, step 5. Optional: F6, F7, the inventory re-run.
   - **F4, one test contact end to end:** (a) create a contact in a lead stage; (b) create a booking for it; (c) mark that booking completed (`advance_contact_on_completed_booking` → `advance_contact_stage`); (d) create an invoice for that contact with amount > 0 and use **Mark paid** (`/api/payments/invoices/[id]/mark-paid` inserts a `payment_transactions` row → `tg_transaction_events` + `promote_contact_on_payment` → `advance_contact_stage`, plus `tg_invoice_events`). **The proof is that every write returns success**; a failure of any is an immediate rollback (as §6). Event rows are corroboration: `contact.created`, `booking.created`, `invoice.created`, `invoice.paid` and the transaction event are expected; `contact.stage_changed` appears only if the account has a `prospect`/`client`-type stage configured, so its absence is not a failure. Note `business_events.created_at` is the trigger's `p_occurred_at` (`NEW.created_at`, `paid_at`, `stage_entered_at`), not insert time — fine for rows created in the window.
   - **F8 (new) agent insert:** `auto_set_agent_org_id` calls `get_or_create_user_organization` on every agent insert. Create one agent, or, if natural traffic suffices, `SELECT count(*) AS new_agents, count(*) FILTER (WHERE org_id IS NULL) AS without_org FROM public.agents WHERE created_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 90)` → `new_agents` ≥ 1, `without_org` 0.
   - **F2:** the save must include an organisation-section field (e.g. business name); otherwise `getOrCreateForUser` is not reached (`business-profile/route.ts:412`).
   - **F5:** check the **DevTools Network** status of the `rest/v1/system_settings_config` request (200), signed out and signed in. Both readers swallow the error (`theme-provider.tsx:67`, `getUIVersion` returns `'v1'`), so "no 42501 in the console" proves nothing.
4. **S3-4 (Medium) — paste-safe acceptance SQL.** No timestamp literal for T anywhere: use `pg_catalog.now() - pg_catalog.make_interval(mins => N)` run inside the window. All acceptance blocks verbatim in the QA section and pinned by the static test (S2-2). Q-5 approved: the P3 block alone may hold exactly two literals, `'request.jwt.claims'` and `'sub'`; every other block stays literal-free. If P3 reads 0 because no active `admin_users` row has a bound `user_id`, record it as inconclusive, not a pass.
5. **S3-5 (Medium) — silent callers: say what proves them.** Correct §1.3 "On error": rows 2 and 4 are **fully silent** (supabase-js returns `{ error }` and does not throw, so row 2's `logger.debug` never runs on a `42501`). Proof for rows 2, 4, 12, 14, 16 is C6 (service_role keeps EXECUTE) **plus** the traced service-role clients above; logs cannot prove them. Replace the F1 `last_seen >= T AND hit_count > 0` query (not specific: `PlanCache`'s own store writes `last_seen`) with a before/after snapshot around F1: `SELECT (SELECT sum(hit_count) FROM public.business_chat_plan_cache) AS plan_hits, (SELECT sum(uses) FROM public.business_chat_verified_questions) AS vq_uses` — a rise is direct evidence for `record_business_chat_plan_outcome` / `increment_verified_question_uses`; no rise is not a failure. `get_similar_patterns`, `get_active_failures` and `increment_calibration_count` leave no trace: C6 only. For the F1–F3 warn strings, compare against the 24 h before T, since "Semantic plan search unavailable" also fires for non-permission causes.
6. **S3-6 (Low) — §1.6 accuracy.** Remove `agents.calibration_run_count` from the "checked against git migrations" list (prod-only; F7 stays optional and informational).

### Rulings on Q-1 to Q-10

| # | Ruling |
|---|---|
| Q-1 | As proposed: no positive service_role call; C6 is the authority. Acceptance set per S3-3 |
| Q-2 | Approved, with the S3-1 role rule |
| Q-3 | Approved: add Q0, keep the TSV's unqualified `vector`. The migration fails safe either way (parse error or C-2 raise) |
| Q-4 | One `GRANT ... TO authenticated, service_role`, pinned as the only two-role GRANT |
| Q-5 | Approved and **mandatory** (requirement §6 S3 acceptance: "admin-only RLS reads ... still work for a signed-in admin"); literal rule per S3-4 |
| Q-6 | All 18 at once |
| Q-7 | Approved, with the S3-2 trigger addition |
| Q-8 | Record only; add the five dead references to the SQ-3 list at PR time |
| Q-9 | As proposed; T-10 re-check |
| Q-10 | With the S7 batch (C-10: optional for S2 to S5) |

### Part (A) doc edits — accuracy

Accurate: `4724b727` is the PR #277 merge (2026-10-09 20:02 UTC, after the 15:48 UTC apply, consistent with FR-0.6); 55 − 13 = 42, non-trigger 37 − 13 = 24. Nits (non-blocking): the requirement §4.3 S2 "Workplan" cell still ends "five files written, static test green, uncommitted" — stale; inventory §6 row 2 has no merge commit — add at the slice 3 PR.

### Approval
[x] Workplan approved — proceed to implementation once S3-1 to S3-6 are folded in

**Code Review by SA — 2026-10-10**
**Status:** ✅ Code Approved with nits (N-1 to N-4). Fix N-1 to N-3 before the user sees the diff; no re-review needed.

### Conditions verified in code
- **S3-1:** Q7 uses `NOT (roles <@ ARRAY['authenticated','service_role']::name[])` for `is_platform_admin` and keeps the slice 2 rule for the 17. Q11 uses `polroles <@ ARRAY[to_regrole('authenticated')::oid, to_regrole('service_role')::oid]`. `{0}` (PUBLIC) is not a subset, so it stops. A non-`pg_policy` dependent falls to `ELSE true`. `refclassid = 'pg_proc'::regclass` with `refobjid = fn_oid` is the correct direction: a policy qual records a `pg_policy` → `pg_proc` row with deptype `n`. ✅
- **S3-2:** the `caller_verdict` CASE order is right. A SECDEF caller stops when its owner is not `postgres`. An INVOKER caller of the 17 stops. An INVOKER trigger of `is_platform_admin` stops. Any other caller stops when `anon` has EXECUTE on it. `prorettype = 'trigger'::regtype` is a valid oid/regtype comparison. ✅
- **S3-3 / S3-4:** all 12 blocks are written out in full and pinned. Only P3 holds literals (`'request.jwt.claims'`, `'sub'`). Windows use `pg_catalog.make_interval(mins => N)`, which is a valid named argument. ✅
- **S3-5:** §1.3 marks rows 2 and 4 as fully silent, and F1 is a before/after snapshot. **S3-6:** §1.6 is corrected. ✅

### PostgreSQL desk-check
- **`is_platform_admin`:** the pre-state ACL has no PUBLIC entry (TSV `postgres anon authenticated service_role`). `REVOKE ... FROM PUBLIC, anon, authenticated` (PUBLIC is a silent no-op for the owner) then `GRANT ... TO authenticated, service_role` run in one transaction. Result: `authenticated` true, `anon` false, `public` false. The post-conditions match: `public`/`anon` raise if still held, and `IF NOT` raises if `authenticated`/`service_role` were lost. `postgres` (the owner) re-grants, so the ACL rebuilds as `postgres, authenticated, service_role`. Rollback `TO anon` restores the TSV set exactly, and the Q5 sorted compare reads `match`. A foreign-grantor `authenticated`/`anon` entry would survive the REVOKE; the post-condition and Q5 grantors both catch that. ✅
- **Rollback per shape vs TSV:** B → `PUBLIC, anon, authenticated` (14), C → `PUBLIC` (3: rows 3, 4, 17), D → `anon` (1). Each shape restores its TSV grantee set, and the test derives `rollbackGrantees` from the TSV. For shape C the post-condition correctly expects `anon`/`authenticated` true through PUBLIC. ✅
- **Checker:** dry-run 56/52 and post-apply 108/0 re-derived. `expected_held OR (role = authenticated AND keeps_authenticated)` is correct, and a NULL counts as FAIL. ✅
- **Q0:** `to_regtype('vector')` uses the session search_path, the same as the migration tab. It fails safe either way. ✅
- **Negative blocks:** the planner cannot const-fold N1 or N2 past the ACL check. `record_business_event` is not STRICT, `get_similar_patterns` returns a set, and `is_platform_admin` is SECDEF so it is never inlined. ✅
- **P3:** `set_config(..., true)` runs before `SET LOCAL ROLE`, so it is transaction-scoped and runs as `postgres` (the table owner, which can read `admin_users`). Current Supabase `auth.uid()` is `coalesce(request.jwt.claim.sub, request.jwt.claims->>'sub')`, so it reads the value. `is_platform_admin` is SECDEF, so it reads `admin_users` whatever the role. The admin is picked with `is_active AND user_id IS NOT NULL LIMIT 1`, with no literal. ✅ (see N-2)
- **Schema:** all of these exist: `business_events.created_at`/`event_type`, `business_chat_plan_cache.hit_count`, `business_chat_verified_questions.uses`, `crm_contacts.updated_at`, `agents.org_id` (`20260615:145`), `agents.created_at` (repository select), `admin_users.is_active`/`user_id`, `bos_cron_runs.job`/`outcome`/`started_at`. The event names `contact.created`, `booking.created`, `invoice.created`, `invoice.paid` and `payment.completed` match the triggers. All 5 crons run hourly or more often (`vercel.json`), so a 90 min window always holds a run. ✅
- **Paste rules and guards:** no `--`, `/*`, "into", LIKE or `SECURITY DEFINER` anywhere, and the DO blocks have no `SELECT`. No file names a function protected by a callers guard (`business_os_auth_email_has_account` does not appear). SA re-ran both: slice test **100/100**, `npm run test:authz-guard` **203/203**. ✅

### Code Review Comments
1. **N-1** `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md:290` and `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md:281`: do the two items deferred to PR time **now, in this diff**. This replaces the Q-8 "at PR time" ruling. (a) Add the five dead TS references (`WebsitePageRepository.generateSubdomain`, `IntentExampleRepository.recordUsage`, `PatternExtractor.extractAndStore`, `GlobalFailureMonitor.recordFailure` and `getBestFix`) to the SQ-3 ruling. (b) Inventory §6 row 3: change `next` to `20261049` and set the status to "code complete, SA code-approved" (RM adds the PR number at PR time). Add a Change History row to each doc. Priority: Medium
2. **N-2** workplan § Acceptance blocks, P3 lead-in (line ~503): (a) "`pricing_rows` equal to the table's real row count" gives no value to compare against. Make the pass `is_admin` true and `pricing_rows` > 0 (P2b showed 0 for a non-admin). (b) Widen the inconclusive explanation: false can also mean the prod `auth.uid()` predates `request.jwt.claims` and reads only `request.jwt.claim.sub`. Either way, record it as inconclusive, never as a fail or a rollback. Priority: Low
3. **N-3** workplan §6 rollback triggers (line 352) and §5.3 F8: this slice cannot cause "F8 `without_org` above 0". A denied `get_or_create_user_organization` aborts the agent insert (BEFORE INSERT trigger); it cannot leave `org_id` NULL. Make the rollback signal "an agent insert fails with a permission error", and treat `without_org` > 0 as investigate-only. Priority: Low
4. **N-4** precheck Q7 for the 17 (`scripts/precheck-secdef-lockdown-slice3.sql:95`) keeps slice 2's `&& ARRAY['public','anon','authenticated']`, so a policy on a custom role would read `ok`. Git has no such role, so this is acceptable as inherited. No change required. Priority: Low (informational)

### Optimisation Suggestions
- None.

### Code Approved for QA: Yes, once N-1 to N-3 are applied. The static test pins the P3 statements only, so the N-2 and N-3 wording edits do not touch it.

---

## QA Testing Report

**QA — 2026-10-10**
**Test mode:** full (pre-apply; prod acceptance is the user's, in the table at the end of this section)
**Strategy used:** A (Jest static test and authz guard) + C (local PGlite harness, PostgreSQL 18.3 / PGlite 0.5.8, never prod). There is no branch database (FR-0.6), so the five files were run against a Supabase-like fixture. The SQL files tested are the ones SA code-reviewed (unchanged since 2026-10-09 23:53)
**Focus:** security, schema
**Skipped:** every prod-only check (F1 to F5 flows, F8 and CRON on real data, logs). The F blocks were run as SQL validity checks only
**Input source:** prompt keywords (caller's brief) + §5.2

**Fixture:**
- **Roles:** `anon`, `authenticated`, `service_role` (BYPASSRLS), `supabase_admin`, `other_owner`, `migrator`, with Supabase default privileges (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS/TABLES TO anon, authenticated, service_role`).
- **`vector` is a stub:** `CREATE DOMAIN extensions.vector AS real[]` in an `extensions` schema on the session `search_path` (`"$user", public, extensions`). pgvector is not available in PGlite. PGlite also ignores `ALTER DATABASE ... SET search_path`, so each session sets the path itself.
- **The 18 functions:** prod identity signatures, SECDEF, owner `postgres`, and the TSV configs (null x14, `search_path=public` x3, `pg_catalog, public` x1).
- **Grant shapes, built the way prod got them:**
  - B through the default privileges.
  - C as `REVOKE ALL ... FROM anon, authenticated`.
  - D as `REVOKE ALL ... FROM PUBLIC` plus `GRANT ... TO authenticated, service_role`, with `anon` added by the default privileges.
- **`auth.uid()` / `auth.jwt()` stubs** reading `request.jwt.claims`, and `is_platform_admin` with the git body.
- **Policies:** the 3 git policies `TO authenticated`, plus an open `USING (true)` SELECT policy on `system_settings_config`.
- **SECDEF trigger callers:**
  - `tg_booking_events` and `tg_transaction_events` call `record_business_event`.
  - `promote_contact_on_payment` and `advance_contact_on_completed_booking` call `advance_contact_stage`.
  - `auto_set_agent_org_id` calls `get_or_create_user_organization`.
- **Other:** `generate_subdomain` calls `check_subdomain_available`; minimal tables for every acceptance block.

### Test Coverage
| Check | Tested? | Result | Notes |
|---|---|---|---|
| Static test (slice 3), with slice 1 and 2 as regressions | ✅ | Pass | 3 suites, 241/241. Re-run after this report was written: still green |
| `npm run test:authz-guard` | ✅ | Pass | 203/203 (slice 6 guard green) |
| Pre-check on the prod-shaped fixture | ✅ | Pass | `CLEAN`, with: Q0 `resolves in schema extensions ok`; Q4 `ok` x18 (`is_platform_admin` reads `public false anon true authenticated true service_role true ok`); Q5 `match` and `owner granted all` x18; Q6 callers all SECDEF, owner `postgres`, `ok` (`record_business_event` 2, `advance_contact_stage` 2, `get_or_create_user_organization` 1, `check_subdomain_available` 1); Q7 3 policies `{authenticated}` `ok`; Q11 5 `pg_policy` rows `ok` (see edge case 2) |
| Pre-check on an ICU `und` collation database | ✅ | Pass | `CLEAN`, Q5 `match` x18. Mutation check: with `COLLATE "C"` removed it reads `STOP 17`, so the pin matters |
| Checker before | ✅ | Pass | `VERDICT FAIL 56 pass 52 fail`. The only `is_platform_admin` fail is `C4 anon`, as §2.3 predicts |
| Migration | ✅ | Pass | Succeeds. ACLs become `postgres, service_role` on the 17 and `postgres, service_role, authenticated` on `is_platform_admin` |
| Checker after | ✅ | Pass | `VERDICT PASS 108 pass 0 fail`, also on the ICU database |
| Migration run twice | ✅ | Pass | The second run succeeds; checker still 108/0 |
| N1, N2, N3 (blocks run verbatim) | ✅ | Pass | Before the migration all three return a row, so the holes are real. After it, each fails `42501 permission denied for function`, naming `record_business_event`, `get_similar_patterns` and `is_platform_admin` |
| Role matrix: all 18 functions called with NULL arguments | ✅ | Pass | All 35 `anon` and `authenticated` calls that should fail give `42501`. All 19 that should work do: `service_role` on all 18, `authenticated` on `is_platform_admin` |
| P1 | ✅ | Pass | `is_admin false`, no error |
| P2a, P2b | ✅ | Pass | `anon`: `settings_rows 2, pricing_rows 0`. `authenticated`: `pricing_rows 0`. No function error |
| P3 | ✅ | Pass | With no admin row: `is_admin false, pricing_rows 0`, the inconclusive case. With an active admin row seeded: `is_admin true, pricing_rows 3`, the real count (also meets the N-2 wording, `> 0`) |
| F1, F4-events, F4-contacts, F8, CRON | ✅ | Pass (SQL validity only) | All run without error against the fixture columns, which SA checked against git. Real values are prod-only |
| Trigger path as `authenticated`, after the migration | ✅ | Pass | Booking insert, booking update to completed, succeeded payment insert and agent insert all succeed. Events +2, contact stage moves from `lead` to `client`, and the agent gets an org (`without_org 0`). Results are identical before the migration and on the ICU database |
| Rollback | ✅ | Pass | The DO post-condition passes. The checker after rollback is **row-for-row identical** to the run before the migration (56/52). The pre-check after rollback reads `CLEAN`, with Q4 `ok` and Q5 `match` x18 |
| Pre-check then migration in the same tab | ✅ | Pass (fails safe) | Fails `25006 cannot execute REVOKE in a read-only transaction`; nothing is applied |
| NEG: an `is_platform_admin` policy with no `TO` clause (roles `{public}`) | ✅ | Pass | Pre-check `STOP 2`: Q7 `roles {public} stop here` and Q11 `roles {-} stop here`. A policy `TO anon, authenticated` also gives `STOP 2` (the S3-1 subset rule) |
| NEG: an INVOKER trigger calling `record_business_event` | ✅ | Pass | Pre-check `STOP 1` (Q6 `secdef false ... trigger true ... stop here`). This is the risk S3-2 guards, shown to be real: the `authenticated` INSERT works before the migration and fails after it with `42501 permission denied for function record_business_event` |
| NEG: S3-2 caller rules for `is_platform_admin` | ✅ | Pass | INVOKER trigger: stop. INVOKER function `anon` can execute: stop. INVOKER function `anon` cannot execute: `ok`. SECDEF function owned by `other_owner`: stop |
| NEG: a SECDEF caller not owned by `postgres` (`tg_booking_events` owned by `other_owner`) | ✅ | Pass | Pre-check `STOP 1` (Q6). If the migration is applied anyway, the `authenticated` booking INSERT fails `42501`, which shows R-2 is real |
| NEG: `vector` not resolvable (off `search_path`, or renamed away) | ✅ | Pass | Pre-check: Q0 `unresolved ... stop here`, plus Q1 to Q5 `MISSING` for rows 1 and 3. Migration fails `42704 type "vector" does not exist`; ACLs unchanged |
| NEG: foreign grantor (`supabase_admin` grants `anon` EXECUTE on `record_business_chat_plan_outcome`) | ✅ | Pass | Pre-check `STOP 2`: Q5 grantees `DIFFERS` and Q5 grantors `OTHER GRANTOR`. Migration raises `P0001 Slice 3 anon still executes so nothing was applied ...`; ACLs unchanged |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix, doc only)
1. **§5.2 is only partly right about the `{public}` policy case.** It says that after the migration an `anon` SELECT under that policy fails `42501`. In the fixture, the table also had an open `USING (true)` SELECT policy, and anon still read 2 rows with no error: the planner simplifies `true OR is_platform_admin()` to `true`, so the function is never called. When the `{public}` policy was the table's only SELECT policy, anon failed `42501`. The pre-check stops on both, so the gate is unaffected. Low.
2. **Q11 lists each `FOR ALL` policy twice**, once for its `USING` and once for its `WITH CHECK`. The 3 git policies therefore give **5** Q11 rows, not 3: `ai_model_pricing_admin_write` x2, `system_settings_config_admin_write` x2, `ai_model_pricing_admin_select` x1. That still fits "3 or more" in §2.1, but tell the user to expect 5 so the count does not look wrong. Low.

### Gaps (not verifiable locally)
- Everything that needs prod data or traffic: F1 to F5, F8 and CRON with real values; Vercel and Postgres logs; any prod-only callers or policies in Q6, Q7 and Q11.
- The real pgvector type. Q0 measures how it resolves on prod.
- The harness ran as a superuser. A REVOKE by the non-superuser owner `postgres`, as on Supabase, was proven in slice 2 (N3b) and not repeated here.
- N-3's claim, that a denied `get_or_create_user_organization` aborts the agent insert rather than leaving `org_id` NULL, was not exercised directly. NEG-C shows the same abort behaviour for a denied nested trigger call.
- PGlite runs PostgreSQL 18.3, and prod may run another version. Nothing tested depends on version-specific catalog behaviour.

### Test Outputs / Logs
```text
1 precheck: CLEAN | Q4 ok 18, Q5 match 18, owner granted all 18 | stops: []
2 checker before: VERDICT FAIL 56 pass 52 fail
4 migration: success | 5 checker after: VERDICT PASS 108 pass 0 fail
6 migration again: success | checker: VERDICT PASS 108 pass 0 fail
post N1: ERR 42501 permission denied for function record_business_event
post N2: ERR 42501 permission denied for function get_similar_patterns
post N3: ERR 42501 permission denied for function is_platform_admin
post P1: [{"is_admin":false}] | P2a: [{"settings_rows":2,"pricing_rows":0}] | P2b: [{"pricing_rows":0}]
post P3 (admin seeded): [{"is_admin":true,"pricing_rows":3}]
8 role matrix: denied 42501 35 (expect 35) allowed 19 (expect 19)
9 trigger path AFTER migration (authenticated): booking insert ok; booking completed ok; payment insert ok; agent insert ok | events +2 | stage client | without_org 0
10 rollback: success | 11 checker after rollback: 56/52, row-for-row identical to pre-state: true
12 precheck after rollback: CLEAN Q4 ok 18 Q5 match 18
NEG-B authenticated INSERT after migration (INVOKER trigger): 42501 permission denied for function record_business_event
NEG-D migration: 42704 type "vector" does not exist (ACLs unchanged)
NEG-E migration: P0001 Slice 3 anon still executes so nothing was applied public.record_business_chat_plan_outcome(uuid, boolean)
COLL (ICU und): precheck CLEAN; mutation without COLLATE C: STOP 17; checker 56/52 -> 108/0; rollback ok; precheck CLEAN
```

### Final Status
- [x] Every criterion that can be tested locally passes. **Ready for commit** once N-1 to N-3 are applied and the user has seen the diff. The user still owes prod acceptance after apply (§5.3, table below)
- [ ] Issues found — Dev must address before commit

### Acceptance blocks (written by Dev per SA S3-3 and S3-4, run by the user)

Paste each block in its own **new** SQL-editor tab, after the migration and the checker. They hold no comment, no "into" and no timestamp literal; only P3 holds string literals (exactly `'request.jwt.claims'` and `'sub'`). The static test pins every block. Role blocks end in `ROLLBACK`, so nothing persists and the role reverts. If a role block fails with `permission denied to set role`, that is the editor role, not the slice: record it; the checker still proves the grants.

Block N1, as `anon`, shape C. Pass: `ERROR 42501 permission denied for function record_business_event`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT public.record_business_event(NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid, NULL::numeric, NULL::jsonb, NULL::text, NULL::timestamptz);
ROLLBACK;
```

Block N2, as `authenticated`, shape B. Pass: `ERROR 42501 permission denied for function get_similar_patterns`.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.get_similar_patterns(NULL::text[]);
ROLLBACK;
```

Block N3, as `anon`. Pass: `ERROR 42501 permission denied for function is_platform_admin`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT public.is_platform_admin();
ROLLBACK;
```

Block P1, as `authenticated`. Pass: one row, `is_admin` false, no error.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.is_platform_admin() AS is_admin;
ROLLBACK;
```

Block P2a, as `anon`. Pass: two counts, no `permission denied for function`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT (SELECT count(*) FROM public.system_settings_config) AS settings_rows, (SELECT count(*) FROM public.ai_model_pricing) AS pricing_rows;
ROLLBACK;
```

Block P2b, as `authenticated`. Pass: `pricing_rows` 0, no error.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT count(*) AS pricing_rows FROM public.ai_model_pricing;
ROLLBACK;
```

Block P3, a signed-in admin. Pass: `is_admin` true and `pricing_rows` > 0. If `is_admin` is false, record **inconclusive**, never pass, fail or rollback (S3-4, SA N-2): either no active `admin_users` row has a bound `user_id`, or the prod `auth.uid()` reads only `request.jwt.claim.sub`.

```sql
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', admin_users.user_id)::text, true) AS claims_set FROM public.admin_users WHERE admin_users.is_active AND admin_users.user_id IS NOT NULL LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT public.is_platform_admin() AS is_admin, (SELECT count(*) FROM public.ai_model_pricing) AS pricing_rows;
ROLLBACK;
```

Block F1, run once **before** and once **after** the chat questions. A rise in either column is direct evidence; no rise is not a failure.

```sql
SELECT (SELECT sum(business_chat_plan_cache.hit_count) FROM public.business_chat_plan_cache) AS plan_hits, (SELECT sum(business_chat_verified_questions.uses) FROM public.business_chat_verified_questions) AS vq_uses;
```

Block F4-events, within 30 minutes of the F4 flow. Expect `contact.created`, `booking.created`, `invoice.created`, `invoice.paid`, `payment.completed` (and `contact.stage_changed` only where a matching stage type is configured).

```sql
SELECT business_events.event_type, count(*) AS events
FROM public.business_events
WHERE business_events.created_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 30)
GROUP BY business_events.event_type
ORDER BY business_events.event_type;
```

Block F4-contacts, within 30 minutes of the F4 flow. Pass: non-zero.

```sql
SELECT count(*) AS contacts_updated
FROM public.crm_contacts
WHERE crm_contacts.updated_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 30);
```

Block F8, within 90 minutes of apply. Pass: `new_agents` at least 1 and `without_org` 0. A failed agent insert is the rollback signal; `without_org` above 0 is investigate-only (SA N-3).

```sql
SELECT count(*) AS new_agents, count(*) FILTER (WHERE agents.org_id IS NULL) AS without_org
FROM public.agents
WHERE agents.created_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 90);
```

Block CRON, about 90 minutes after apply. Pass: at least one `succeeded` run for each of `payment-reminders`, `payment-retry`, `lead-response`, `insight-actions` and `daily-briefing`.

```sql
SELECT bos_cron_runs.job, bos_cron_runs.outcome, count(*) AS runs
FROM public.bos_cron_runs
WHERE bos_cron_runs.started_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 90)
GROUP BY bos_cron_runs.job, bos_cron_runs.outcome
ORDER BY bos_cron_runs.job, bos_cron_runs.outcome;
```

| Check | Result (user) |
|---|---|
| Pre-check status, Q6 caller count for `record_business_event`, Q7 and Q11 rows for `is_platform_admin` | ⬜ |
| Checker | ⬜ |
| N1, N2, N3 | ⬜ |
| P1, P2a, P2b | ⬜ |
| P3 | ⬜ |
| F1 before and after, warn counts vs prior 24 h | ⬜ |
| F2, F3 | ⬜ |
| F4 writes, F4-events, F4-contacts | ⬜ |
| F5 Network status signed out and signed in | ⬜ |
| F8 | ⬜ |
| CRON | ⬜ |
| Logs: Vercel T+15 and T+60 min; Postgres to T+24 h | ⬜ |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-09 | Created (Dev) | Slice 3 workplan: 18 signatures verified against the prod TSV (no discrepancy), three grant shapes (B x14, C x3 via PUBLIC only, D x1 `is_platform_admin` with no PUBLIC), so per-shape rollback grants. Callers re-verified on `4724b727`: every TS call site is on a service-role client, every SQL caller in git is a SECDEF trigger or function; no blocker. `is_platform_admin`: 3 git policies, all `TO authenticated`; signed-in browser reads of `system_settings_config` evaluate it, anon reads do not. Pre-check gains Q0 (vector) and per-function rules for Q4, Q6, Q7, Q11. Slice 1 style acceptance with functional flows. Migration `20261049` proposed. 10 open questions for SA |
| 2026-10-09 | SA workplan review | APPROVED WITH CONDITIONS (S3-1 to S3-6). Callers re-verified independently on `4724b727` (all TS sites service-role by traced instantiation; all 11 SQL trigger callers SECDEF per TSV). S3-1 policy role rule (authenticated/service_role only) in Q7 and Q11; S3-2 INVOKER trigger callers of `is_platform_admin` always stop; S3-3 mandatory acceptance incl. concrete F4 (contact, booking completed, invoice Mark paid), new F8 agent insert, F5 via Network tab; S3-4 no timestamp literals, P3 mandatory with two allowed literals; S3-5 silent callers proven by C6, before/after `hit_count`/`uses` snapshot; S3-6 `agents.calibration_run_count` is prod-only. Q-1 to Q-10 ruled |
| 2026-10-09 | SA conditions folded in; implementation T-5 to T-10 (Dev) | S3-1 (§2.1 Q7 and Q11: `is_platform_admin` policy roles must be a subset of authenticated and service_role), S3-2 (§2.1 Q6: INVOKER trigger caller always stops), S3-3 (§5.3 mandatory set, end-to-end F4, new F8, F2 organisation field, F5 Network status), S3-4 (acceptance blocks verbatim in the QA section, no timestamp literals, P3 mandatory with two literals, inconclusive rule), S3-5 (§1.3 rows 2 and 4 fully silent, C6 as their proof, F1 before/after snapshot, warn counts against the prior 24 h), S3-6 (§1.6). Five files written under `20261049`; static test 100/100; regressions green; number still free. SA part (A) nits applied in the requirement and inventory. Left uncommitted for SA code review |
| 2026-10-10 | SA code review | APPROVED WITH NITS. S3-1 to S3-6 verified in code. Desk-check: the `is_platform_admin` REVOKE then GRANT leaves authenticated true and anon and public false; the per-shape rollback rebuilds the TSV sets (B x14, C x3, D x1); the Q11 `polroles` subset rule stops PUBLIC `{0}`; the Q6 CASE order is correct; the negative blocks cannot be const-folded; the current `auth.uid()` reads P3's `set_config`; every acceptance table and column exists. Slice test 100/100, `test:authz-guard` 203/203. N-1: add the SQ-3 dead references and inventory §6 row 3 now, in this diff. N-2: P3 pass criterion and inconclusive wording. N-3: F8 `without_org` is not a rollback trigger. N-4: informational |
| 2026-10-10 | SA code-review nits and QA notes applied (Dev, docs only) | N-1 in the requirement (SQ-3 now lists the five uncalled TS references) and the inventory (§6 row 3: `20261049`, code complete, SA code-approved, QA PASS). N-2: P3 passes on `is_admin` true and `pricing_rows` > 0; false is inconclusive (no bound admin `user_id`, or a prod `auth.uid()` that reads only `request.jwt.claim.sub`). N-3: the F8 rollback signal is a failed agent insert; `without_org` above 0 is investigate-only (§5.3 F8, §6, F8 block lead-in). QA notes: §5.2 anon `42501` under a public policy only without an always-true read policy beside it; §2.1 expected Q11 rows for `is_platform_admin` now 5 (FOR ALL policies record USING and WITH CHECK). No SQL file and no pinned block changed |
