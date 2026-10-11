# Workplan: SECURITY DEFINER Lockdown, Slice 5 (trigger functions: no client EXECUTE)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) (FR-0.1 to FR-0.14, FR-5, §6 S5, SA conditions C-1 to C-10, C-4 note S2-4)
**Pattern copied:** [SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md) and the slice 4a workplan (PR #288): five-file package, Q11, `COLLATE "C"`, grantor check, S2-3 rollback rule, S3-1/S3-2 caller and policy rules, S3-4 paste-safe pinned acceptance blocks with no timestamp literals
**Evidence:** [secdef_prod_inventory_2026-10-07.tsv](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv) (`kind = trigger` rows), [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md) §4.3 and §6 row 5
**Branch:** `fix/secdef-lockdown-slice-5` (worktree `neuronforge-secdef-s5`). Created off `6e5c4b7e`; TL fast-forwarded it on 2026-10-11 to `origin/main` `492066b9`, which includes PR #288 (slice 4a, `20261050`, merged 2026-10-11 05:58 UTC as `7916cc68`)
**Migration number:** `20261051`. Checked 2026-10-11, twice (at the workplan and after implementation): `origin/main` `492066b9` tops at `20261050`. The only open PR (#290, finance health) touches nothing under `supabase/`. Re-check at PR time (T-10 rule)
**Date:** 2026-10-11
**Status:** ✅ Applied on prod 2026-10-11 and accepted (PR #297). SA and QA approved. User acceptance: pre-check CLEAN, checker 108/0, N1 42501, D1 after apply 5/5 (D1 before skipped by the user). Remaining: one Postgres-log look at about T+24 h.

## Overview

Slice 5 removes client EXECUTE from the last 18 anon-executable SECURITY DEFINER functions in `public`. All of them are **trigger functions**. Each one revokes from `PUBLIC, anon, authenticated` and keeps `service_role`. This slice is hygiene and defence in depth, not a live hole. PostgreSQL never checks EXECUTE when a trigger fires, PostgREST leaves trigger functions out of its schema cache, and PostgreSQL refuses to call a trigger function directly. What it closes is the last entry on the inventory (anon-executable goes from 18 to 0) plus one theoretical path, `CREATE TRIGGER` by a client role (§1.4). The one way this slice could break anything is if that engine rule were wrong. In that case the failure would be loud: signup, public booking pages and every Business OS write that fires these triggers would fail. So acceptance proves the rule once inside the prod database, in a rolled-back block, and QA proves it for all 18 locally. It does not ask the user to run agents, calibrate, or do any other agent-platform testing (user scope decision, 2026-10-11). No function body, trigger, table, policy or application code changes.

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

### 1.1 The 18 functions, verified against the prod TSV

The TSV has 20 `kind = trigger` rows. That means `prorettype = 'trigger'::regtype` (`scripts/inventory-security-definer-functions.sql:8`). Two of them, `business_os_plan_fact_onboarding` and `business_os_plan_fact_profile`, are already closed (`x_anon` f, grantees `postgres service_role`, closed by `20261009`) and are excluded. The other 18 match FR-5 exactly, with no discrepancy. Every one has no arguments (`nargs` 0), so the identity signature is `public.<name>()`. Every one has exactly one TSV row (no overloads) and `triggers` = 1. That column is the count of non-internal `pg_trigger` rows (`inventory-security-definer-functions.sql:38-39`), so each function is attached to exactly one trigger in prod.

| # | Signature | TSV `search_path` | Defined in git | Trigger, table, timing | Family |
|---|---|---|---|---|---|
| 1 | `public.advance_contact_on_completed_booking()` | null | `migrations/20260920_pipeline_transitions.sql:140` | `advance_contact_on_completed_booking_trigger` on `scheduling_bookings`, AFTER UPDATE OF status WHEN completed (`:150-154`) | CRM pipeline |
| 2 | `public.auto_set_agent_org_id()` | null | `migrations/20260615_add_organizations.sql:224` | `trigger_auto_set_agent_org_id` on `agents`, BEFORE INSERT (`:238-241`) | agent platform |
| 3 | `public.create_user_settings()` | null | `migrations/20261003_codify_create_user_settings_trigger.sql:87` | `create_user_settings_trigger` on **`auth.users`**, AFTER INSERT (`:115-118`) | signup |
| 4 | `public.increment_smart_link_click_count()` | null | `migrations/20260824_add_conversion_layer.sql:248` | `increment_click_count_on_insert` on `smart_link_clicks`, AFTER INSERT (`:259-262`) | conversion |
| 5 | `public.link_subscriber_to_contact()` | null | `migrations/20260931_business_subscribers.sql:139` | `trg_link_subscriber_to_contact` on `crm_contacts`, AFTER INSERT (`:161-163`) | CRM |
| 6 | `public.log_document_activity()` | null | `migrations/20260722_create_contact_documents.sql:91` | `log_document_activity_trigger` on `contact_documents`, AFTER INSERT (`:122-125`) | CRM |
| 7 | `public.log_exchange_rate_change()` | null | **no (prod-only)** | not in git. Presumably on `exchange_rates`, writing `exchange_rate_history`. Q11 measures it | currency (admin) |
| 8 | `public.marketing_consent_project()` | null | `migrations/20260930_marketing_consent.sql:204` | `trg_mce_project` on `marketing_consent_events`, AFTER INSERT (`:273-275`) | consent |
| 9 | `public.promote_contact_on_payment()` | null | `migrations/20260920_pipeline_transitions.sql:109` | `promote_contact_on_payment_trigger` on `payment_transactions`, AFTER INSERT OR UPDATE OF status WHEN succeeded (`:126-132`) | CRM pipeline |
| 10 | `public.update_user_storage_used()` | null | `SQL Scripts/20251117_complete_quota_system.sql:176` | `trigger_update_storage_used` on `storage_usage`, AFTER INSERT OR UPDATE OR DELETE (`:194-197`) | agent platform |
| 11 | `public.tg_activity_reply_events()` | public | `migrations/20261006c_close_remaining_event_gaps.sql:169` | `trg_activity_reply_events` on `crm_activities`, AFTER INSERT (`:195-197`) | event rail |
| 12 | `public.tg_booking_events()` | public | `20261006_business_event_triggers.sql:114`, redefined `20261006c:285` | `trg_booking_events` on `scheduling_bookings`, AFTER INSERT OR UPDATE (`20261006c:324-326`) | event rail |
| 13 | `public.tg_contact_events()` | public | `20261006c:128` | `trg_contact_events` on `crm_contacts`, AFTER INSERT OR UPDATE (`:157-159`) | event rail |
| 14 | `public.tg_invoice_events()` | public | `20261006:165`, redefined `20261006c:334` | `trg_invoice_events` on `payment_invoices`, AFTER INSERT OR UPDATE (`20261006c:380-382`) | event rail |
| 15 | `public.tg_page_view_events()` | public | `20261006c:77` | `trg_page_view_events` on `website_page_views`, AFTER INSERT (`:117-119`) | event rail |
| 16 | `public.tg_proposal_events()` | public | `20261006:276`, redefined `20261006c:392` | `trg_proposal_events` on `proposals`, AFTER UPDATE (`20261006c:439-441`) | event rail |
| 17 | `public.tg_service_events()` | public | `20261006c:206` | `trg_service_events` on `scheduling_services`, AFTER INSERT OR UPDATE (`:273-275`) | event rail |
| 18 | `public.tg_transaction_events()` | public | `20261006:217` | `trg_transaction_events` on `payment_transactions`, AFTER INSERT OR UPDATE (`:266-268`) | event rail |

The table and trigger names come from git. Prod is measured by pre-check Q11, which lists every `pg_trigger` dependent with its table (§2.1). Three facts follow from git. First, **three tables carry two of the 18**: `scheduling_bookings` (rows 1 and 12), `crm_contacts` (5 and 13) and `payment_transactions` (9 and 18). Second, **one trigger is outside `public`**: row 3 fires on `auth.users`, inside the GoTrue signup transaction. Third, git defines all 9 functions in the `tg_*` and `log_exchange_rate_change` group except `log_exchange_rate_change` itself. The 8 `tg_*` functions landed in git on 2026-10-07 (`5aae2c9c`), so the inventory §4.5 table that lists them as prod-only is stale. Only row 7 is prod-only today (doc fix noted in §3).

**Nested SECDEF calls (unchanged by this slice).** Rows 11 to 18 call `record_business_event`, rows 1 and 9 call `advance_contact_stage`, and row 2 calls `get_or_create_user_organization`. Slice 3 closed those three to `service_role` only, and its pre-check found every caller SECDEF and owned by `postgres`. A trigger function runs as its owner, so the nested EXECUTE check is against `postgres`. Revoking client EXECUTE on the trigger functions themselves does not change who runs their bodies.

### 1.2 Grant shape and rollback

There is one shape for all 18, shape B from slice 3:

| TSV `execute_grantees` | `x_public` / `x_anon` / `x_auth` / `x_service` | After the migration | Rollback grant |
|---|---|---|---|
| `PUBLIC postgres anon authenticated service_role` | t / t / t / t (`public_acl` t) | `postgres service_role` | `GRANT EXECUTE ... TO PUBLIC, anon, authenticated` |

**service_role (the brief asked for a decision per the requirement).** FR-0.1 says to grant `service_role`, and §6 S5 says "service_role only", so the migration keeps it. It is functionally inert: `service_role` cannot call a trigger function directly either, and firing needs no EXECUTE. Keeping it has three benefits: the four-role check (C6) is the same as in slices 1 to 3, the slice 6 guard's revoke form needs no exception, and a future `CREATE TRIGGER` run as `service_role` would still work. See Q-1.

Owner and grantor are not in the TSV, so the pre-check measures them (Q2 and the Q5 grantors check), as in slices 1 to 4a.

### 1.3 Direct callers (expected none)

On `6e5c4b7e` I ran `git grep` for all 18 names over every tracked file, excluding `docs/`. The search found **no `.rpc(` call, no Edge Function hit and no SQL caller**. `supabase/functions/` holds only `run-scheduled-agents`, and it has no hit. The non-definition hits are:

| Hit | What it is |
|---|---|
| `app/api/public/newsletter/subscribe/route.ts:99`, `app/api/scheduling/bookings/[id]/route.ts:317`, `app/auth/callback/page.tsx:72`, `scripts/backfill-missing-payment-transactions.ts:17` | comments that explain the trigger |
| `lib/business-os/insight/events/__tests__/recordEvent.test.ts:310` | a Jest test that reads the migration text |
| `supabase/__tests__/security-definer-surface.guard.test.ts:645-710` | the slice 6 frozen baseline (17 of the 18; row 7 has no git file) |
| `scripts/check-migrations.sql` | a name list |
| SQL in `supabase/` | only each function's `CREATE`, its `CREATE TRIGGER`, `DROP TRIGGER` and `COMMENT` |

No function body in git names any of the 18. Prod-only SQL objects are measured by the pre-check (Q6 to Q9, Q11).

**Who fires them (context for §1.4, not a caller).** The firing role is whoever writes the table. Today these roles do it:

- `supabase_auth_admin`: GoTrue, on signup (row 3).
- `anon`: public booking pages. The `record_business_event` header says so (`20261006_business_event_triggers.sql:55-57`).
- `authenticated`: agent inserts on the cookie client (row 2, slice 3 F8).
- `service_role`: most Business OS repositories.

`supabase_auth_admin` and `anon` hold **no** EXECUTE after this slice except through what is revoked here. That is why the engine rule in §1.4 is load-bearing and is proven in prod (D1) rather than assumed.

### 1.4 The real risk being closed (precisely)

| Path | Today, before the slice | After | Source |
|---|---|---|---|
| `POST /rest/v1/rpc/<trigger fn>` with the anon key | `404 PGRST202`. PostgREST (since v9.0.1) leaves trigger functions out of its schema cache and OpenAPI output, so the request never reaches the database | the same | PostgREST v9.0.1 changelog ("trigger functions … can't be called directly") |
| `SELECT public.tg_x()` in SQL by a client role, for example through another SQL surface | `ERROR 0A000 trigger functions can only be called as triggers`: PL/pgSQL refuses a call made outside a trigger | `ERROR 42501 permission denied for function`: the ACL check runs first, at executor start | PostgreSQL. QA confirms both errors in PGlite (§5.2) |
| The trigger firing on a client write (anon public booking, authenticated agent insert, `supabase_auth_admin` signup) | fires, and the body runs as the owner (SECDEF) | **fires unchanged**. PostgreSQL checks EXECUTE on a trigger function only at `CREATE TRIGGER`, never when the trigger fires | PostgreSQL `CREATE TRIGGER` docs ("must also have EXECUTE privilege on the trigger function"). In the source (SA S5-6): `commands/trigger.c` `CreateTriggerFiringOn` runs the `ACL_EXECUTE` aclcheck, while `ExecCallTriggerFunc` only does `fmgr_info` and the call, with no aclcheck. That same path serves constraint and deferred triggers. The only fire-time ACL check is in `execExpr.c` `ExecInitFunc`, for functions called inside **expressions**: trigger `WHEN` clauses, defaults, CHECK constraints, policies. None of the 18 can be one of those, and Q11 would show such a use as an extra dependent. Proven in prod by D1 and in PGlite by QA |
| `CREATE TRIGGER ... EXECUTE FUNCTION public.tg_x()` by a client role | possible in principle. Supabase default table grants give `anon` and `authenticated` the `TRIGGER` privilege, and EXECUTE is held through `PUBLIC`. But no client role can run DDL over PostgREST, and no SECDEF function in prod runs dynamic DDL for them (Q6 would show one) | **closed**: `CREATE TRIGGER` now fails `42501` for any role except `postgres` and `service_role` | the same docs |

**Conclusion.** There is no live exposure to close. The value of the slice is:

1. **The inventory reads clean.** Anon-executable SECDEF functions in `public` go from 18 to 0, so a re-run of the inventory, the Supabase security advisor and any future reviewer see no exceptions to explain.
2. **The last theoretical path closes:** a client role attaching an owner-privileged function to a table of its choice.

The requirement's "overall done" criterion counts only **non-trigger** functions, and it already reads 0 after slice 4a. This slice is not needed to meet it. FR-5 and §6 S5 ask for it as hygiene.

### 1.5 Slice 6 guard

The migration defines and alters no function, so it adds **0** (file, function) pairs and no finding. `20261051` is after the freeze date. 17 of the 18 functions stay on the frozen baseline through their original `CREATE` files (`security-definer-surface.guard.test.ts:645-710`), keyed by file, so the baseline neither shrinks nor goes stale. Row 7 is prod-only and was never in it. None of the five new SQL files may contain the phrase `SECURITY DEFINER`, even inside a string (F-2, the O-1 tripwire), so the pre-check reads `prosecdef`. No new file names `business_os_auth_email_has_account`, the one function protected by a callers guard.

### 1.6 Skills consulted

| Skill | Applies? |
|---|---|
| `business-os-schema-check` | Yes. The TSV is the prod evidence, and the pre-check re-measures existence, owner, grantors, return type, callers, policies, views and triggers before apply. The acceptance columns were checked against git: `scheduling_services.user_id`, `price` and its RLS UPDATE policy `auth.uid() = user_id` (`20260722_create_scheduling_tables.sql:7-55`); `business_events.user_id` and `created_at` (`20260801_create_business_events.sql`); `admin_users.is_active` and `user_id` (slice 3 P3); `profiles.id` (`20261003:94`). `tg_service_events` writes `pricing.changed` with `p_occurred_at = now()` on a price change (`20261006c:217-228`), which D1 relies on. `log_exchange_rate_change`'s table is prod-only (Q11) |
| `tenant-isolation-guard` | No new write path, and no function body or caller changes. D1 writes only an active admin account's own rows, then rolls back (S5-1) |
| `business-os-entitlements` | No import from the module. The two already-closed `business_os_plan_fact_*` triggers are excluded |
| `durable-queue-drain` | No drain touched |
| `v6-pipeline`, `new-api-route`, `new-repository`, `new-plugin`, `bos-llm-call-standards` | Not applicable |

No TS source is touched, so there is no `console.*` flag to raise.

### 1.7 Lessons carried over

| Lesson | Where it lands |
|---|---|
| Slice 1 false `DIFFERS` (collation) | `COLLATE "C"` on every `string_agg ... ORDER BY`, pinned by the test |
| W-1 grantor check, W-2 no LIKE, W-5 static rules, READ ME new-tab order | Unchanged |
| S2-1 / S2-4 / C-4 note: Q11 `pg_depend`, with `pg_trigger` dependents judged per trigger slice | Q11 for this slice has an explicit `pg_trigger` rule (§2.1) |
| S2-3: roll back only for a caller identified as ours | Kept (§6), plus one unconditional trigger: a client write failing on one of the 18 |
| S3-1 policy roles / S3-2 INVOKER trigger callers | Q7 uses the slice 2 rule (no function keeps `authenticated`). Q6 keeps the C-4 rule (§2.1) |
| S3-4 paste-safe acceptance blocks, no timestamp literals, pinned | §5.3 drafts. The final text goes in the QA section, pinned by the static test |
| Slice 4a user decision (2026-10-11): agent runs out of scope | No agent run, calibration or storage upload in acceptance. Agent-platform triggers are proven in-database and in PGlite only |

---

## 2. Approach

### 2.1 Pre-check (read-only, single result set)

**File:** `scripts/precheck-secdef-lockdown-slice5.sql`. It is the slice 3 pre-check with these changes:

- `watched` VALUES holds the 18 rows. Each has `expected_grantees` `PUBLIC postgres anon authenticated service_role` (the static test reads it from the TSV) and `keeps_authenticated` **false**. Every signature is `public.<name>()`.
- **No Q0** (no `vector`), **no Q10** (no `pg_catalog` shadowing).
- **Q3 secdef and return type (extended):** `secdef <bool> returns <type> language <lang> config <...>`, and `ok` only when `prosecdef` is true **and** `prorettype = 'trigger'::regtype`. A function that does not return `trigger` is `stop here`, because it would be reachable over `/rpc` and the §1.4 argument would not hold for it. Expected: `returns trigger language plpgsql`, config `none` x10 and `search_path=public` x8.
- **Q4 privileges:** `ok` when `public`, `anon`, `authenticated` and `service_role` are all true (the shape B pre-state).
- **Q6 callers:** the slice 3 `caller_verdict` CASE, unchanged. With `keeps_authenticated` false, the C-4 rule applies: an INVOKER caller is `stop here`, and a SECDEF caller whose owner is not `postgres` is `stop here`. No SQL can call a trigger function directly, so any `prosrc` mention is either text or dynamic DDL (`CREATE TRIGGER ... EXECUTE FUNCTION ...`), and dynamic DDL **does** check EXECUTE for the role running it. So a mention still needs review (Q-4). Expected on prod: 0 callers each.
- **Q7 policies:** the slice 2 rule (`stop here` if roles include `public`, `anon` or `authenticated`). Expected: none.
- **Q8 views:** any row is `stop here`. Expected: none.
- **Q9 cron:** unchanged.
- **Q11 dependents (the C-4 trigger rule, Q-2):** `pg_depend` joined to `pg_trigger` on `objid`. A `pg_trigger` dependent is `ok` and shows the table (`tgrelid::regclass`), the trigger name and `tgenabled`. Any other catalog is `stop here`. A **count row** per function compares the number of `pg_trigger` dependents with **1** (TSV `triggers`), and a different count is `stop here`. That means prod has drifted from the §1.1 analysis, and the trigger map must be re-read before apply. Expected: exactly 1 `pg_trigger` row per function, on the table in §1.1. Row 3's is on `auth.users`, and row 7's table is recorded as measured.
- **Q12 D1 surface (information only, SA S5-2):** one row for every non-internal trigger on `public.scheduling_services` and `public.business_events` (looked up with `to_regclass`, the only two punctuated literals the file adds). Each row shows the function (`schema.name`), whether it is **known**, and whether its body names `http` or `dblink`. Known means it is in `public` and is either one of the 18 or a git-known function on those tables (`tg_service_events`, `update_scheduling_services_updated_at` from `20260722_create_scheduling_tables.sql:188-200`, `service_currency_lock` from `20261008_currency_locks.sql:97-128`). Git defines no trigger on `business_events`. Each row ends `D1 may run` or `D1 SKIP use the logs`. A `Q12 d1 verdict information only` row gives the result: `D1 may run` only when every listed function is known and none names `http` or `dblink`; otherwise, or when no trigger is found, `D1 SKIP use the logs`. Q12 never prints `stop here`, so it gates D1 only, never `PRECHECK STATUS` or the migration. Supabase database webhooks use `supabase_functions.http_request`, which is outside `public` and so reads `UNKNOWN`. That is intended.
- `string_agg ... ORDER BY ... COLLATE "C"` everywhere. The first statement is `SET default_transaction_read_only = on`. There is a READ ME row, and `PRECHECK STATUS` reads `CLEAN` or `STOP n`.

| Item | Expected on prod |
|---|---|
| Q1 exists | `present` x18 |
| Q2 owner | `postgres ok` x18 |
| Q3 secdef and return type | `secdef true returns trigger language plpgsql` x18; config `none` x10, `search_path=public` x8 |
| Q4 privileges | `ok` x18 (all four true) |
| Q5 grantees and grantors | `match` and `owner granted all` x18 |
| Q6 | 0 callers each |
| Q7, Q8 | none |
| Q9 | `cron not installed` or `none visible jobs only` |
| Q11 | count row `1 found 1 triggers ok` x18. 18 dependent rows `catalog pg_trigger deptype n table <§1.1 table> enabled O ok` (row 3 on `auth.users`, row 7 on the table recorded as measured). No other dependent |
| Q12 | 3 rows on `scheduling_services` (`trg_service_events`, `update_scheduling_services_updated_at_trigger`, `trg_service_currency_lock`), all `known no remote call D1 may run`. None on `business_events`. Verdict `D1 may run`. Any prod-only trigger shows here, and if one is unknown the verdict is `D1 SKIP use the logs` |

### 2.2 Migration

**File:** `supabase/migrations/20261051_secdef_lockdown_slice5_trigger_functions.sql`. It uses the slice 2 form, since every function is service_role only:

```sql
BEGIN;

REVOKE EXECUTE ON FUNCTION public.advance_contact_on_completed_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_contact_on_completed_booking() TO service_role;

(one REVOKE plus one GRANT per function, rows 1 to 18 in the §1.1 order)

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[ (the 18 signature literals) ]
  LOOP
    (NULL raises; public, anon and authenticated each raise if still held;
     IF NOT service_role raises 'service_role lost EXECUTE')
  END LOOP;
END
$$;

COMMIT;
```

These decisions are inherited from slices 1 to 4a, where SA approved them: every REVOKE lists all three client grantees; `REVOKE EXECUTE`, not `REVOKE ALL`; fail, never skip (C-2); no `SELECT` and no `INTO` in the DO block (C-7); built-ins are `pg_catalog.`-qualified and every function name is `public.`-qualified; and the file has no `SECURITY`, `search_path`, `CREATE`, `ALTER`, `DROP`, `TRIGGER` keyword (Q-3) or table keyword. Revoking EXECUTE takes no lock on the tables, so it is safe at any hour.

### 2.3 Checker (read-only, VERDICT first)

**File:** `scripts/check-secdef-lockdown-slice5-migration.sql`. It is slice 3's checker with 18 rows, all with `keeps_authenticated` false. It runs six checks per function, using `IS FALSE` / `IS TRUE` so that a NULL counts as FAIL: C1 exists, C2 owner is `postgres`, C3 `public` false, C4 `anon` false, C5 `authenticated` false, C6 `service_role` true.

- **After apply:** `VERDICT PASS 108 pass 0 fail` (18 x 6).
- **Before apply (dry run):** `VERDICT FAIL 54 pass 54 fail` (C1, C2 and C6 pass; C3 to C5 fail, for each function).

### 2.4 Rollback

**File:** `supabase/SQL Scripts/20261051_secdef_lockdown_slice5_trigger_functions_rollback.sql`. It is `BEGIN;`, then 18 x `GRANT EXECUTE ON FUNCTION public.<name>() TO PUBLIC, anon, authenticated;`, then a DO post-condition that all four roles are true and that a NULL raises, then `COMMIT;`. It has no REVOKE. After a rollback the pre-check must read Q4 `ok` and Q5 `match` x18. All 18 roll back at once (slice 3 Q-6).

### 2.5 Static test

**File:** `supabase/migrations/__tests__/secdef-lockdown-slice5.migration.test.ts`. It is the slice 3 test with a `SLICE_5` constant of 18 `{ name, signature, rollbackGrantees }` entries. What changes:

- **TSV cross-check (new derivation):** parse the `kind = trigger` rows, not `kind = fn`. The slice set must equal the trigger rows with `x_anon = t`, which are exactly 18, and must exclude the 2 `business_os_plan_fact_*` rows. Each entry has one row, empty `identity_args` and `nargs` 0, so the signature is `public.<name>()`. `execute_grantees` is shape B, and `rollbackGrantees` is `PUBLIC, anon, authenticated`. The name set equals FR-5.
- **Literals:** the per-file allow-list adds `trigger` (Q3 `'trigger'::regtype`) and `pg_trigger` (Q11 `'pg_trigger'::regclass`) to the pre-check's list. `pg_policy` and `pg_proc` are already on it from slice 3.
- Migration, rollback, checker and pre-check asserts are as in slice 3 and 4a, adjusted for one shape and no kept `authenticated`. The pre-check markers are `Q1` to `Q9`, `Q5 grantors` and `Q11`, plus the `Q11 trigger count` row and `PRECHECK STATUS`, with no `Q0` and no `Q10`. Q3 must carry the `prorettype` check, and Q11 must carry the `pg_trigger` join and the count rule.
- **Acceptance blocks** (S3-4) are pinned statement for statement. Only D1 holds literals: exactly `'request.jwt.claims'` and `'sub'`, the slice 3 P3 precedent. No block has a timestamp literal, and every role block ends in `ROLLBACK`.

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-secdef-lockdown-slice5.sql` | create | Read-only pre-check (FR-0.5, FR-0.10, FR-0.11, Q11 trigger rule) |
| `supabase/migrations/20261051_secdef_lockdown_slice5_trigger_functions.sql` | create | The revoke, with in-transaction post-conditions (FR-0.1, FR-0.9, FR-0.12) |
| `scripts/check-secdef-lockdown-slice5-migration.sql` | create | Read-only checker, VERDICT first (FR-0.4) |
| `supabase/SQL Scripts/20261051_secdef_lockdown_slice5_trigger_functions_rollback.sql` | create | Pre-state restore (FR-0.5) |
| `supabase/migrations/__tests__/secdef-lockdown-slice5.migration.test.ts` | create | Static asserts (FR-0.13, C-8) |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify | §4.3 new S5 row, header, §6 S5 wording (SA Q-7 text), Change History |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify | §6 row 5 number and status. §4.5 correction: the 8 `tg_*` are in git since `5aae2c9c`, so only `log_exchange_rate_change` is prod-only |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE5_WORKPLAN.md` | create | This workplan |

No TS source, no other migration, no CI workflow change. The branch now contains PR #288, so the docs are edited in this diff (SA S5-4).

---

## 4. Task list

- ✅ T-0: Branch confirmed (`fix/secdef-lockdown-slice-5`). Read the requirement, slice 3 workplan and pre-check, slice 4a workplan (PR #288 branch), inventory §4.3, §4.5 and §6, and the TSV
- ✅ T-1: 18 signatures and the single grant shape verified against the TSV (§1.1, §1.2). The 2 closed `business_os_plan_fact_*` rows excluded
- ✅ T-2: Trigger map read from git (§1.1); direct callers searched: none (§1.3); exposure analysed (§1.4)
- ✅ T-3: Migration number checked: `20261051` (header). PR #288 found already merged
- ✅ T-4: Workplan written
- ✅ T-5: SA workplan review: approved with S5-1 to S5-6, and Q-1 to Q-11 ruled. S5-1 is in §5.3 and the D1 block. S5-2 is in §2.1 (Q12) and §5.3. S5-3 is in §5.3 and §6. S5-4 is in the header, §3 and T-11. S5-5 is in §5.2. S5-6 is in §1.4
- ✅ T-6: Static test written against `SLICE_5`: the TSV `kind = trigger` derivation, and the acceptance blocks pinned
- ✅ T-7: Pre-check written: §2.1 Q3 return type, the Q6 C-4 rule, the Q11 `pg_trigger` rule with an exactly-one count, the Q12 D1 surface, and `COLLATE "C"`
- ✅ T-8: Migration and rollback written
- ✅ T-9: Checker written (18 rows, `keeps_authenticated` false)
- ✅ T-10: Slice 5 test, plus regressions and paste greps. Results are in the QA section's Dev pre-QA run. Number re-checked: `20261051` is free
- ✅ T-11: Requirement §4.3 S5 row, header, §6 S5 wording (SA Q-7) and Change History; inventory §6 row 5 and the §4.5 correction
- ⬜ T-12: SA code review, then the user sees the diff (left uncommitted)
- ⬜ T-13: User runs §6 on prod; results recorded under QA Testing Report

---

## 5. Test plan

### 5.1 Static test

As §2.5.

### 5.2 What Jest cannot show (QA, local PGlite, never prod)

This is the main proof of the engine rule for all 18. QA runs the slice 3 harness with the 18 functions as SECDEF, owned by `postgres`, in shape B (through the Supabase default privileges), each attached to a trigger on a minimal table that mirrors §1.1. Where git defines a body, QA uses that body; otherwise a stub that writes one row. `auth.users` gets a stand-in table in an `auth` schema. The checks:

1. Pre-check `CLEAN`, Q11 18 `pg_trigger` rows `ok`. Checker before 54/54 and after 108/0. Migration run twice. Rollback rebuilds the pre-state row for row, and the pre-check after rollback reads `CLEAN`.
2. **Firing after the revoke, by roles that hold no EXECUTE:** for every one of the 18, a write as `anon`, as `authenticated`, and as a non-superuser `auth_admin_like` role. That role is the `supabase_auth_admin` stand-in, which gets EXECUTE only through `PUBLIC`. All writes succeed, and the trigger's effect is visible. Before and after must give identical results. Two cases are required (SA S5-5). **(a)** At least one trigger with a `WHEN` clause, copied from git: row 1 (`WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')`) or row 9 (`WHEN (NEW.status = 'succeeded' AND NEW.amount > 0 AND NEW.contact_id IS NOT NULL)`). It shows that the clause's built-in operators still run for a role without EXECUTE on the trigger function. **(b)** Row 3 on the `auth`-schema stand-in for `auth.users`, fired by `auth_admin_like`, the non-superuser that inserts into it.
3. **Direct call:** before the revoke, `SELECT public.tg_service_events()` as `anon` gives `0A000 trigger functions can only be called as triggers`. After it, `anon` and `authenticated` give `42501`, and `service_role` still gives `0A000`, which proves the ACL check passed and the engine refused the call. This confirms the N1, N2 and P1 expectations in §5.3.
4. **`CREATE TRIGGER` by `authenticated`** on a table it holds `TRIGGER` on: it succeeds before the revoke and fails `42501` after. This is the §1.4 path that closes.
5. **Negative fixtures:** a foreign-grantor `anon` entry (Q5 `OTHER GRANTOR`, and the migration raises); an INVOKER function that names one of the 18 (Q6 stop); a SECDEF caller owned by another role (Q6 stop); a second trigger on one of the 18 (Q11 count stop); a non-trigger dependent, such as a column default calling a function of the same name in a fixture (Q11 stop); and one of the 18 rebuilt to return `void` (Q3 stop).
6. The acceptance blocks, run verbatim against the fixture, including D1 before and after the migration.

### 5.3 Acceptance after apply (SA Q-5, S5-1 to S5-3)

**Why this set.** EXECUTE is not checked when a trigger fires. A Business OS flow after apply therefore proves no more than one in-database firing by a role that holds no EXECUTE, because every flow rests on the same engine rule. That rule does not depend on the function, the table or the role, and the PGlite matrix (real PostgreSQL) shows it for all 18. So the prod proof is **one** rolled-back block, D1, run before and after the migration. Run before, it shows the block works on this account, so that a failure after apply can only mean the rule is wrong. The checker proves the grants, N1 shows the closed path from the SQL editor, and the Postgres logs cover a day of natural traffic: public booking pages, signups, page views, crons and admin currency edits. Let T be the apply time.

**Mandatory (SA Q-5):** pre-check `CLEAN`, checker `VERDICT PASS 108 pass 0 fail`, N1, D1 before and after (gated by Q12, S5-2), and one look at the Postgres logs at about T+24 h.

**Optional (SA Q-5), corroboration only and never a rollback signal on their own, with one exception:**
- N2 and P1 (C5 and C6 already prove these ACLs). If P1 is run and returns `42501`, that is a rollback trigger.
- EVENTS and SIGNUP.
- The inventory re-run. Anon-executable drops from 18 to 0.
- The PostgREST probe. `GET <project>/rest/v1/rpc/tg_service_events?apikey=<anon key>` returns `PGRST202` before and after.
- The BOS flows the user already does: F4 from slice 3, a page view, a smart link click. They are not needed.

**Not part of acceptance (user, 2026-10-11):** agent creation, agent runs, calibration, storage uploads. Rows 2 and 10 are covered by D1 (the same rule), the PGlite matrix and the logs.

The blocks are written verbatim in the QA section (§ Acceptance blocks) and pinned by the static test. Each goes in its own new SQL-editor tab.

**D1 in short (S5-1).** As `authenticated`, it raises the price of each priced service owned by **an active admin account's own rows** by 1, which fires `trg_service_events`. It then counts the events that trigger wrote in this transaction, and rolls everything back. The admin is chosen deterministically: the lowest active admin `user_id` that owns at least one priced service. So before and after use the same account, and an admin without a priced service is never picked. The two literals are `'request.jwt.claims'` and `'sub'`, as in slice 3 P3, and nothing new is added.

- **Pass:** no error, `priced_services` at least 1, and `events_this_transaction` at least `priced_services`. `pricing.changed` carries `p_occurred_at = now()`, the transaction start, so only this transaction's events match. Before and after read the same.
- **Fail, and roll back at once:** `ERROR 42501 permission denied for function` naming one of the 18 after apply, when the block passed before apply.
- **Inconclusive:** `priced_services` 0 (no active admin owns a priced service), `permission denied for table`, an RLS refusal, or `events_this_transaction` 0 before apply too. Record it as inconclusive, never as a pass or a fail. The logs are then the fallback.
- **Skipped (S5-2):** when the pre-check row `Q12 d1 verdict information only` reads `D1 SKIP use the logs`, D1 is not run, and that is recorded. The logs are the proof.
- **No side effect outside the transaction (SA, Q-6):** NOTIFY, Realtime (logical decoding) and pg_net or database-webhook queue rows are all bound to commit, and the block rolls back. Its row locks (`FOR NO KEY UPDATE`) last milliseconds and block only a concurrent edit of the same service. The one residual risk, a prod-only synchronous `http` or `dblink` trigger on these tables, is what Q12 screens for.

**LOGS (mandatory):** Supabase Postgres logs from T to about T+24 h. Count `permission denied for function` lines that name one of the 18. Expected: exactly the deliberate N1 (plus N2 and P1 if run). Attribute any other hit where the log allows. A hit during a client write is the unconditional rollback trigger in §6. An anon direct-call hit is a probe count. Also count `trigger functions can only be called as triggers` lines, as probes, for information only.

---

## 6. Apply order and rollback plan

The user runs every step in the Supabase SQL editor on prod (FR-0.6). Dev never connects to a database. A revoke is metadata-only and takes no table lock, so no quiet hour is needed.

| Step | Where | Expect |
|---|---|---|
| 1. Pre-check | tab A | `PRECHECK STATUS CLEAN`. Paste the output under QA Testing Report: Q11 is the prod trigger map and Q12 the D1 surface. On any `stop here`, stop and bring it to Dev/SA. Note the Q12 verdict |
| 2. D1 before | new tab, only if Q12 reads `D1 may run` | pass, or inconclusive. If inconclusive, proceed: the PGlite proof and the logs stand. Record it |
| 3. Migration | **new** tab B | `Success. No rows returned`. Any error means nothing was applied |
| 4. Checker | new tab C | `VERDICT PASS 108 pass 0 fail` |
| 5. N1 and D1 after (mandatory); N2 and P1 (optional) | one new tab per block | §5.3 |
| 6. Logs | Supabase Postgres, one look at about T+24 h | §5.3 LOGS |
| 7. Merge | GitHub | After SA code review, QA pass and the user's approval (RM). Apply and the checker run before merge (FR-0.6) |

**Rollback triggers.**

- **Unconditional, roll back at once, without waiting for attribution (S5-3):** a client-facing write fails with `permission denied for function <one of the 18>`. That covers a signup, a public booking, a page view, and a contact, invoice, payment or service write. **D1 after apply** failing that way also counts. It would mean the engine rule in §1.4 does not hold on prod, and signup and public pages depend on that rule.
- P1, if run, failing with `42501` (C6 contradicted).
- A Postgres-log entry naming one of the 18 whose role, user agent or source we recognise as our app (S2-3).

**Not triggers:** an anon direct-call hit (a probe, which is what this slice blocks), a `trigger functions can only be called as triggers` line, an inconclusive or skipped D1, or a quiet EVENTS window.

On a real trigger: paste the rollback in a new tab, re-run the pre-check (Q4 `ok`, Q5 `match` x18), and bring the evidence to Dev/SA.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Prod checks EXECUTE when a trigger fires (contrary to §1.4), so signup, public bookings and BOS writes fail | PostgreSQL semantics (checked only at `CREATE TRIGGER`); PGlite firing matrix for all 18 with anon, authenticated and an auth-admin stand-in (§5.2); D1 before and after on prod; unconditional immediate rollback (§6) |
| R-2 | `create_user_settings` fires as `supabase_auth_admin`, which loses its only EXECUTE path (`PUBLIC`) | The same as R-1: no EXECUTE is needed to fire. PGlite proves it with a non-superuser stand-in. Natural signups are covered by the logs and the optional SIGNUP block. A failed signup is a rollback trigger |
| R-3 | A prod-only object calls or depends on one of the 18 (an INVOKER function running dynamic `CREATE TRIGGER`, a view, a policy, a column default) | Q6 to Q9 and Q11 |
| R-4 | Prod's trigger map differs from git: a second trigger, or one on an unexpected table | Q11 lists every `pg_trigger` dependent with its table, and a count other than 1 stops (Q-2) |
| R-5 | One of the 18 does not return `trigger` in prod, so it is reachable over `/rpc` and misclassified | Q3 return-type check stops |
| R-6 | A future migration recreates one of these triggers as a role without EXECUTE | Supabase migrations run as `postgres` (the owner), and `service_role` is kept. Recorded so a later failure is easy to diagnose |
| R-7 | Foreign-grantor entry survives the REVOKE, or the REVOKE is run by a non-owner | Q2, Q5 grantors; post-conditions raise |
| R-8 | Collation false `DIFFERS` | `COLLATE "C"` pinned |
| R-9 | Migration number taken before merge | T-10 re-check |
| R-10 | SQL-editor paste bugs | Static test, exact literal allow-list, no timestamp literals |
| R-11 | D1 touches a price column | Only an active admin account's own rows (S5-1), always rolled back; Q12 screens the table for unknown triggers (S5-2); QA runs it verbatim in PGlite before and after |

---

## 8. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Keep `GRANT EXECUTE ... TO service_role` although it is inert for trigger functions? | Keep (FR-0.1, §6 S5 "service_role only"). It keeps C6, the guard form and future `CREATE TRIGGER` by service_role |
| Q-2 | Q11 rule: a `pg_trigger` dependent is `ok` (table, trigger name, `tgenabled` shown); any other dependent stops; a `pg_trigger` count other than 1 (TSV `triggers`) stops | As proposed. The count check is the C-4 "judged against the slice analysis" in executable form |
| Q-3 | Q3 extended with `prorettype = 'trigger'::regtype` and the language, stop if not a trigger. Also ban the `TRIGGER` keyword in the migration and rollback (static test)? | Yes to both |
| Q-4 | Q6: keep the C-4 rule (INVOKER mention stops; SECDEF caller not owned by `postgres` stops), although no SQL can call a trigger function directly? | Keep. A mention can be dynamic `CREATE TRIGGER`, which checks EXECUTE for the running role |
| Q-5 | Acceptance: mandatory = pre-check, checker, N1, N2, P1, D1 before and after, logs to T+24 h. BOS flows (F4, page view, smart link), EVENTS, SIGNUP, inventory re-run and PostgREST probe are optional. Are the BOS flows needed given EXECUTE is not checked when a trigger fires? | Not needed. They exercise the same engine rule D1 proves in prod and QA proves for all 18. Optional for a user who wants them |
| Q-6 | D1 design: `authenticated` + JWT subject = the active admin, own `scheduling_services` price +1, count `business_events` at `created_at >= now()`, rolled back. Two literals, `'request.jwt.claims'` and `'sub'` (slice 3 P3 precedent). Acceptable, and harmless enough for prod? Alternative: a stage change on the admin's own `crm_contacts` row (`tg_contact_events`), which needs a second stage id | D1 as drafted. Run before and after so that an inconclusive result is seen before apply |
| Q-7 | Requirement §6 S5 says "Each trigger still fires (one sample write per trigger family)". Under the 2026-10-11 scope decision, reword it to "the engine rule is proven once on prod (D1) and for all 18 in the local PGlite matrix; no agent-platform testing"? This is a BA/TL requirement edit | Yes. Record it in the requirement Change History when the docs are edited (T-11) |
| Q-8 | Rollback all 18 at once? | Yes (slice 3 Q-6) |
| Q-9 | Names: `20261051_secdef_lockdown_slice5_trigger_functions.sql`, `secdef-lockdown-slice5` for scripts and test | As proposed, re-checked at PR time |
| Q-10 | `log_exchange_rate_change` is the only prod-only function in the slice. Capture its DDL now (C-10), or with the S7 batch? | With the S7 batch. It is not needed for a revoke, and Q11 records its table |
| Q-11 | Docs: defer the requirement §4.3 and inventory §6 and §4.5 edits until `origin/main` (with #288) is merged into this branch? | Yes, to avoid conflicting with slice 4a's rows. TL/RM does the merge |

---

## SA Review Notes

**Reviewed by SA — 2026-10-11**
**Status:** ✅ Approved with conditions (S5-1 to S5-6)

### Independent verification of the central claim

| Claim | SA finding |
|---|---|
| 18 functions, one shape | ✅ TSV: 20 `kind = trigger` rows; 18 with `x_anon` t, all `PUBLIC postgres anon authenticated service_role`, `nargs` 0, `triggers` 1; the 2 `business_os_plan_fact_*` already closed. The inventory script selects only `prosecdef` rows (`inventory-security-definer-functions.sql:22`), so all 18 are SECURITY DEFINER |
| EXECUTE is checked at `CREATE TRIGGER`, not at fire time | ✅ PostgreSQL docs, `CREATE TRIGGER`: "the user must have the TRIGGER privilege on the table. The user must also have EXECUTE privilege on the trigger function." Source: `commands/trigger.c` `CreateTriggerFiringOn` does the `ACL_EXECUTE` aclcheck; `ExecCallTriggerFunc` only does `fmgr_info` + call, with no aclcheck. The same call path serves constraint and deferred triggers. Event triggers (superuser-only to create, `EventTriggerInvoke`) also do no fire-time check, and none of the 18 can be one (they return `trigger`, not `event_trigger`) |
| The one fire-time ACL path that does exist | Functions called inside **expressions** are checked against the current role at executor init (`execExpr.c` `ExecInitFunc`): trigger `WHEN` clauses, column defaults, CHECK constraints, generated columns, index expressions, policies. None of the 18 can be one of those: calling a trigger function in an expression fails with 0A000 anyway. Any such use would also show as an extra `pg_depend` row, so the Q11 count rule and the non-`pg_trigger` stop catch it. The `WHEN` clauses in §1.1 use only built-in operators, which this slice does not touch |
| Direct call refused | ✅ PL/pgSQL raises `0A000 trigger functions can only be called as triggers`. The ACL check (`ExecInitFunc`) runs first, so after the revoke a client gets 42501 and `service_role` still gets 0A000. N1 and P1 are correct |
| PostgREST | ✅ v9.0.1 removed trigger functions from the schema cache and OpenAPI output, so `/rpc` returns `404 PGRST202`. pg_graphql only exposes functions the role can execute, so the revoke can only shrink that surface |
| Nested calls | ✅ All 18 are SECDEF owned by `postgres` (Q2/Q3 re-measure it). Their bodies run as `postgres`, so nested calls (`record_business_event`, `advance_contact_stage`, `get_or_create_user_organization`) are checked against `postgres` and do not change. `record_business_event` swallows its own errors (`EXCEPTION WHEN OTHERS`), but a 42501 on the trigger function would be raised outside it and abort the write. So D1 failing would be loud, not silent |
| Conclusion | ✅ Revoking client EXECUTE cannot break signup (`create_user_settings` fired by `supabase_auth_admin`), public booking, page views, smart-link clicks, or CRM and payment writes. The slice is hygiene plus closing client `CREATE TRIGGER`, as §1.4 says |

**D1 side effects (Q-6).** A rolled-back transaction emits nothing outside itself. NOTIFY is delivered only at commit. Logical decoding, and so Supabase Realtime Postgres Changes, outputs only committed transactions. pg_net and Supabase database webhooks queue rows in `net.http_request_queue`, which is transactional, so the worker never sees them. `realtime.send` broadcasts are rows that roll back too. Locks: `UPDATE price` takes `FOR NO KEY UPDATE` row locks for milliseconds. This does not conflict with readers or with the `FOR KEY SHARE` locks that booking-insert FK checks take. Only a concurrent edit of the same service waits. The one residual risk is a synchronous, non-transactional side effect, meaning a prod-only trigger on `scheduling_services` or `business_events` that uses the `http` or `dblink` extension. Git has none. S5-2 makes it visible before D1 runs.

### Rulings

| Q | Ruling |
|---|---|
| Q-1 | Keep `service_role` (FR-0.1, C6 form, guard form) |
| Q-2 | Approved as proposed. Also treat a `pg_event_trigger` or any other catalog as `stop here` (already covered by the "any other catalog" rule) |
| Q-3 | Yes to both. Ban the word `trigger` (case-insensitive, word boundary) in the migration and rollback only. None of the 18 names contains it, and those files carry no comments under the paste rules |
| Q-4 | Keep the C-4 rule |
| Q-5 | **Mandatory:** pre-check `CLEAN`; checker `PASS 108/0`; N1; D1 before and after; Postgres logs, one look at about T+24 h. **Optional:** N2 and P1 (the checker's C5 and C6 already prove these ACLs), EVENTS, SIGNUP, the inventory re-run, the PostgREST probe, and BOS flows. BOS flows are **not needed**: they rely on the same engine rule that D1 proves on prod and that the PGlite matrix proves for all 18. If P1 is run and gives 42501, that is still a rollback trigger. No agent-platform testing |
| Q-6 | D1 is approved and harmless (see above), with S5-1 and S5-2 |
| Q-7 | Replace the §6 S5 line with: "**S5:** the 18 trigger functions are service_role only (checker PASS 108/0). Firing without client EXECUTE is proven once on prod by a rolled-back write as `authenticated` that fires one of the 18 (D1, run before and after apply), and for all 18 as `anon`, `authenticated` and a non-superuser auth-admin stand-in in the local PGlite matrix. Postgres logs to T+24 h show no `permission denied for function` naming one of the 18 other than the deliberate refusals. No agent-platform testing (user scope, 2026-10-11)." Record it in the requirement Change History as an SA-ruled wording change |
| Q-8 | Roll back all 18 at once |
| Q-9 | Names approved. Re-check `20261051` at PR time (T-10) |
| Q-10 | Defer to the S7 batch (C-10). `log_exchange_rate_change` has a null `search_path`, so it will be on the S7 list anyway |
| Q-11 | **Unblocked.** The branch is now at `origin/main` `492066b9`, which includes #288, so T-11 proceeds now (S5-4) |

### Conditions

1. **S5-1 (Medium), D1 admin selection.** `LIMIT 1` with no `ORDER BY` can pick a different admin before and after apply, and it can pick an admin with no priced service (inconclusive). Select deterministically, and only an admin who has a priced service: `WHERE admin_users.is_active AND admin_users.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.scheduling_services WHERE scheduling_services.user_id = admin_users.user_id AND scheduling_services.price IS NOT NULL) ORDER BY admin_users.user_id LIMIT 1`. This adds no literal. Change the wording from "the applying admin's own rows" to "an active admin account's own rows". Pin it in the static test, and run it verbatim in PGlite before and after.
2. **S5-2 (Medium), D1 surface listing in the pre-check.** Add an informational row that lists every non-internal trigger on `public.scheduling_services` and `public.business_events`, with its function. Its regclass literals go on the per-file allow-list. The user runs D1 only if every listed function is git-known or one of the 18. An unknown trigger, or any function whose body names `http` or `dblink`, means D1 is not run (record it as skipped) and the logs are the fallback. Do not make this a `STOP`. It gates D1 only, not the migration.
3. **S5-3 (Low), acceptance and rollback lists follow Q-5.** Update §5.3 and §6 step 5: mandatory N1 and D1, with N2 and P1 optional. Keep the unconditional rollback trigger (a client write, or D1 after apply, failing with `permission denied for function <one of the 18>`).
4. **S5-4 (Low), stale branch text.** Header lines 9 and 10 and §3 "Why the docs wait" say the branch predates #288. Update them to `492066b9`, and do T-11 now. That covers the requirement §4.3 S5 row, the header, the §6 S5 wording (Q-7) and Change History, plus the inventory §6 row 5 and the §4.5 correction.
5. **S5-5 (Low), PGlite matrix scope.** §5.2 item 2 must include at least one trigger with a `WHEN` clause (row 1 or row 9, copied from git). This shows that the clause's built-in operators still work for a role without EXECUTE on the trigger function. It must also include the `auth`-schema stand-in fired by the non-superuser role for row 3.
6. **S5-6 (Low), cite sources in §1.4.** Replace "the executor's trigger call does no ACL check" with the source references above (`CreateTriggerFiringOn` aclcheck; `ExecCallTriggerFunc` has none; `ExecInitFunc` checks expressions only). Then a later reviewer does not have to re-derive them.

### Approval
[x] Workplan approved. Proceed to implementation (T-6 to T-11) with S5-1 to S5-6 folded in. No further SA workplan pass is needed. SA verifies the conditions at code review.

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved (with nits, non-blocking)

### Conditions verified in code

| Condition | Finding |
|---|---|
| S5-1 | ✅ D1 selects `ORDER BY admin_users.user_id LIMIT 1` with the `EXISTS` priced-service filter; no new literal; wording "an active admin account's own rows". `set_config` is volatile, so PostgreSQL evaluates it after the sort and only for the one row |
| S5-2 | ✅ Q12 lists non-internal triggers (`NOT tgisinternal`) on the two tables via `to_regclass`, function via `tgfoid` as `schema.name`, `http`/`dblink` via `strpos(lower(prosrc))`; no LIKE; no `stop here` text anywhere in Q12, so it never moves `PRECHECK STATUS` |
| S5-3 | ✅ §5.3 and §6 follow Q-5; unconditional rollback rule kept |
| S5-4 | ✅ Header, §3, requirement §4.3 S5 row and Change History, inventory §6 row 5 and §4.5 correction all present. Requirement §6 S5 line is the Q-7 text verbatim |
| S5-5 | ✅ §5.2 item 2 names the `WHEN`-clause case (row 1 or 9) and the `auth`-schema stand-in fired by a non-superuser |
| S5-6 | ✅ §1.4 cites `CreateTriggerFiringOn`, `ExecCallTriggerFunc`, `ExecInitFunc` |

### PostgreSQL desk-check (rows not yet run anywhere)

- **Q3:** `prorettype = 'trigger'::regtype` resolves (regtype is binary-coercible to oid); a missing function yields NULL and so `stop here` via `IS TRUE`. Correct.
- **Q11:** a trigger records `DEPENDENCY_NORMAL` with `classid = pg_trigger`, `objid = trigger oid`, `refclassid = pg_proc`, `refobjid = function`. The join matches that direction exactly; the LEFT JOIN to `pg_trigger` on `objid` gives `tgrelid::regclass` and `tgenabled` (`"char"` cast to text). Function-side rows (namespace, language, extension) have the function as `objid`, so they cannot appear as false dependents. Count per function = 1 else stop. Correct.
- **Q12:** sort orders 90000/90000+n sit above every per-function row (max 18101); the verdict row sorts first. `'http'` also matches `https` in a comment, which errs toward SKIP (safe).
- **D1:** valid. RLS: `scheduling_services` has SELECT and UPDATE policies `auth.uid() = user_id`, and no migration in git revokes the table grant from `authenticated`. `tg_service_events` emits `pricing.changed` whenever `OLD.price IS DISTINCT FROM NEW.price`, with `p_occurred_at = now()`; `record_business_event` writes `created_at = COALESCE(p_occurred_at, now())` = transaction start, so `created_at >= now()` sees it. `trg_service_currency_lock` is `UPDATE OF currency`, so it does not fire. The count runs after `RESET ROLE`, so `business_events` RLS does not hide rows, and the claim is transaction-local so `auth.uid()` still resolves. D1 can observe the firing.
- **Checker:** before 54/54 (C1, C2, C6 pass x18), after 108/0. **Rollback:** restores `PUBLIC postgres anon authenticated service_role`, which is the TSV set; Q5 compares sorted sets so ACL reordering does not matter.
- Whole-word `trigger` is banned only in the migration and rollback (test lines 274, 292); both files are clean.

### Code Review Comments

1. Workplan D1 block (`events_this_transaction`) — `created_at >= now()` can also count pre-existing future-dated events for that user (for example `tg_activity_reply_events` uses `COALESCE(activity_date, created_at)`) and events committed by other transactions after this one began. This only over-counts, and the failure that matters (42501) aborts the UPDATE, so it cannot produce a false pass. Optional tighten without a new literal: add `AND business_events.entity_id IN (SELECT scheduling_services.id FROM public.scheduling_services WHERE scheduling_services.user_id = auth.uid())`. If changed, re-pin the static test. — Priority: Low
2. The primary D1 signal is "no error"; the event count is corroboration, because `record_business_event` swallows its own errors. The pass rule already treats 0 events before apply as inconclusive. No change. — Priority: Info

### Optimisation Suggestions
- None.

### Verification run by SA
- `secdef-lockdown-slice5.migration.test.ts`: 95/95. `npm run test:authz-guard`: 203/203.

### Code Approved for QA: Yes


---

## QA Testing Report

**QA — 2026-10-11**
**Test mode:** full
**Strategy used:** A (static Jest) plus B/C (a local PGlite harness that runs the real SQL files and the acceptance blocks verbatim). Prod is the user's step (§6), so the prod rows below stay ⬜
**Focus:** security, schema
**Skipped:** prod (never connected). PostgREST and GoTrue are not in PGlite, so the `/rpc` probe and a real signup are left to prod. The body of `log_exchange_rate_change` is a stub, because it exists only in prod
**Input source:** TL brief, plus workplan §5.2

**Fixture.** PGlite 0.5.8 (PostgreSQL 18.3), in the QA scratchpad only. It has the roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `supabase_admin` and `other_owner`, and a **non-superuser** `supabase_auth_admin` stand-in. That stand-in holds EXECUTE on the 18 only through `PUBLIC`, and the harness measured that: 18 before the migration, 0 after. There is an `auth` schema with `auth.users` and the `auth.uid()` claims stub. All 18 functions are SECDEF, owned by `postgres`, in shape B (`PUBLIC postgres anon authenticated service_role`). Supabase default privileges apply. **17 bodies and every trigger are extracted verbatim from git** at run time, including both `WHEN`-clause triggers (rows 1 and 9). The extraction also pulls in the nested `record_business_event`, `advance_contact_stage`, `pipeline_stage_of_type` and `get_or_create_user_organization`, with the first three left at the slice 3 state (service_role only), and `update_scheduling_services_updated_at` and `service_currency_lock` with their triggers. `scheduling_services` has RLS and the 4 policies from git. The fixture includes `business_events`, and `admin_users` with a lower-uuid admin who owns no priced service plus an inactive one, so that S5-1 has a case to skip.

### Results

| # | Check | Result |
|---|---|---|
| 1 | Static test `secdef-lockdown-slice5.migration.test.ts` | ✅ 95/95 |
| 2 | `npm run test:authz-guard` | ✅ 203/203 (2 suites) |
| 3 | Pre-check (first ever run) | ✅ `CLEAN`, 223 rows. Q1 present x18; Q2 `postgres ok` x18; Q3 `secdef true returns trigger language plpgsql`, config `none` x10 and `search_path=public` x8, all `ok`; Q4 `ok` x18; Q5 `match` x18 and `owner granted all` x18; Q6 `0 found 0 flagged` x18; Q7 and Q8 0; Q9 `cron not installed`; Q11 `1 found 1 triggers ok` x18, each dependent `catalog pg_trigger deptype n table <§1.1 table> enabled O ok` (row 3 on `auth.users`); Q12 3 rows on `scheduling_services`, all `known no remote call D1 may run`, none on `business_events`, verdict `D1 may run`. Every value matches the §2.1 expected table |
| 4 | Pre-check on an ICU `und` database | ✅ `CLEAN`, Q5 `match` x18. Mutation: with `COLLATE "C"` removed it reads `STOP 18`, so the collation clause is load-bearing |
| 5 | Checker before / after / after a second migration run | ✅ `VERDICT FAIL 54 pass 54 fail`, then `PASS 108 pass 0 fail`, then `PASS 108/0`. The migration ran twice, and both runs succeeded |
| 6 | **Firing matrix, before and after the revoke.** 18 triggers plus 2 `WHEN`-false controls, each fired as `anon`, `authenticated` and the non-superuser `supabase_auth_admin`, in rolled-back transactions | ✅ All 60 writes succeeded both before and after, with the effect visible every time. The matrix is **identical before and after** (string compare). Effects: contact stage moved to `prospect` (row 1) and to `client` (row 9); org_id set (2); profile and settings rows created on the `auth.users` insert (3); click_count 1 (4); subscriber `promoted` (5); document activity logged (6); history row written (7, stub); consent state and unsubscribe rows written (8); storage_used_mb 1 (10); a `business_events` row of the right type for rows 11 to 18 (15 also writes `page.session_started`; 17 runs on the RLS table). `WHEN`-false controls: a `cancelled` booking or a payment of 0 leaves the stage at `lead`, which shows the clause is still evaluated for roles without EXECUTE |
| 7 | Direct calls, all 18 functions x 3 roles | ✅ Before: `0A000` x54. After: `anon` `42501` x18, `authenticated` `42501` x18, `service_role` `0A000` x18 |
| 8 | `CREATE TRIGGER ... EXECUTE FUNCTION public.tg_service_events()` on a table where the role holds `TRIGGER` | ✅ Before: created by `anon`, `authenticated` and `service_role`. After: `anon` and `authenticated` fail with `42501 permission denied for function public.tg_service_events`, while `service_role` still creates it. This is the §1.4 path, and it is now closed |
| 9 | Acceptance blocks run verbatim (parsed from this section; D1 text sha1 `006772cbd330`) | ✅ N1: `0A000` before, `42501 ... tg_service_events` after. N2: `0A000` before, `42501 ... create_user_settings` after. P1: `0A000` before and after. EVENTS and SIGNUP run and return rows. **D1 before and after:** `priced_services 1, events_this_transaction 1`, so the event is observed. The service price and the `business_events` row count are unchanged afterwards (100.00 and 4, both before and after), so the rollback leaves no rows. The lower-uuid admin with no priced service and the inactive admin are skipped (S5-1). The same result holds on the ICU database |
| 10 | D1 edge cases | ✅ An admin with 2 priced services and 1 free one gives `2 / 2`. No admin with a priced service gives `0 / 0`. No active admin gives `0 / 0`. Both of those read as inconclusive under the D1 rules. Nothing persists in any case |
| 11 | Q12 negatives | ✅ An unknown trigger on `scheduling_services` reads `UNKNOWN no remote call D1 SKIP use the logs`. A known function whose body names `https` reads `known names http or dblink D1 SKIP`. A trigger on `business_events` whose body names `dblink` reads `UNKNOWN names http or dblink D1 SKIP`. In all three the verdict is `D1 SKIP use the logs` and `PRECHECK STATUS` stays **`CLEAN`**: Q12 never prints `stop here` |
| 12 | Q11 negatives | ✅ A second trigger using `tg_service_events` gives `2 found 2 triggers expected exactly 1 trigger stop here` (`STOP 1`). A dropped trigger gives `0 found 0 triggers ... stop here`. A non-trigger dependent (a `BEGIN ATOMIC` SQL function naming `tg_invoice_events`) gives `catalog pg_proc deptype n ... stop here` |
| 13 | Other negatives (§5.2 item 5) | ✅ Q3: a function rebuilt to return `void` gives `returns void ... stop here`. Q5: a foreign-grantor `anon` entry gives `DIFFERS` plus `OTHER GRANTOR stop here`, and the migration raises `Slice 5 anon still executes so nothing was applied public.tg_service_events()`. Q6: an INVOKER function running a dynamic `CREATE TRIGGER` stops, a SECDEF caller owned by `other_owner` stops, and a SECDEF caller owned by `postgres` is `ok` (`CLEAN`). Q2: an owner of `other_owner` stops. Q1: a missing function stops, and the migration fails with `42883`. Q7: a `TO public` policy naming one of the 18 stops |
| 14 | Pre-check followed by the migration in the **same** session | ✅ `25006 cannot execute REVOKE in a read-only transaction`, so the READ ME new-tab order is enforced |
| 15 | Rollback | ✅ Success. All 18 functions read `public anon authenticated service_role = true true true true`. The checker gives `FAIL 54/54` and is **row-for-row identical** to the pre-state. The pre-check reads `CLEAN` with Q4 `ok` x18 and Q5 `match` x18. The same holds on ICU |

### Pre-check SQL (first execution): defects

**None found.** Every row ran without error on PostgreSQL 18 under both the default and the ICU `und` collation. Every stop rule fired on its negative fixture, and nothing fired on the clean fixture. The SA desk-check claims for Q3, Q11 and Q12 hold in execution.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None. The revoke is metadata-only.

#### Edge Cases (nice to know, no change required)
1. **A disabled trigger does not stop the pre-check.** Q11 prints `enabled D ok`. A disabled trigger does not affect the revoke, so this is correct, but the user should glance at the `enabled` column: `O` is expected on all 18 rows.
2. **The migration does not check the return type or the owner.** In PGlite (where `postgres` is a superuser), a `void` rebuild (Q3) and a non-`postgres` owner (Q2) both let the migration apply. The pre-check is the gate for both, as in slices 1 to 4a. On prod, `postgres` is not a superuser, so a REVOKE by a non-owner would not take effect and the post-condition would raise.
3. **SA comment 1 (D1 over-count) is not exercised here.** The fixture has no future-dated or concurrent events. If Dev adopts the optional `entity_id IN (...)` tighten, the D1 text changes (sha1 `006772cbd330` is what QA ran), and QA should re-run D1 in PGlite.
4. **Q12 "known" covers any of the 18 on the two tables**, not only `tg_service_events`. This has no effect today, since git puts no other of the 18 there.

### Gaps (not verifiable locally)
- PGlite's `postgres` is a superuser and prod's is not. That matters only for the Q2 negative (edge case 2).
- The real GoTrue signup and the PostgREST `/rpc` probe: covered by the logs and the optional prod blocks.
- The real body of `log_exchange_rate_change` is unknown, so a stub was used. The engine rule does not depend on the body. Prod Q11 records its table.
- Prod has never been touched. The user's §6 rows below stay ⬜.

### Final Status
- [x] All locally testable acceptance criteria pass. **Ready for commit**, after the user sees the diff. The prod apply (§6) remains the user's step
- [ ] Issues found — Dev must address before commit

### Dev pre-QA run (2026-10-11)

This is a static run only. No database was used, and PGlite is not installed in this worktree, so the §5.2 matrix is QA's.

| Check | Result |
|---|---|
| `secdef-lockdown-slice5.migration.test.ts` | 95/95 |
| Mutation check | Each of these fails exactly 1 test, and the suite is back to 95/95 once restored: the word `trigger` added to a migration message; one `COLLATE "C"` dropped; the Q11 exactly-one rule weakened (no `stop here`); Q12 made to say `stop here`; `ORDER BY` removed from D1 |
| Regressions: slice 1, 2, 3 and 4a tests, `authAccountRepository.callers.guard`, `tailwind-css-escape.guard`, `recordEvent.test.ts` (reads the 20261006 migration text) | 8 suites, 487/487, slice 5 included |
| `npm run test:authz-guard` | 203/203. The slice 6 guard is green, with 0 new pairs and the baseline unchanged |
| `tsc --strict` (es2020, commonjs) on the test file | clean |
| Paste greps on the four SQL files | no `--`, `/*`, "into", LIKE or `SECURITY DEFINER`; ASCII only; LF. No whole-word `trigger` in the migration or the rollback |
| Migration number | `origin/main` `492066b9` tops at `20261050`. The only open PR (#290) touches 0 files under `supabase/`, so `20261051` is free |

**Expected on prod.** Pre-check: §2.1 table. Checker before apply: `VERDICT FAIL 54 pass 54 fail`. After apply: `VERDICT PASS 108 pass 0 fail`.

### Acceptance blocks (written by Dev per SA Q-5 and S5-1 to S5-3, run by the user)

Paste each block in its own **new** SQL-editor tab, after the migration and the checker, except D1, which is also run once **before** the migration. The blocks hold no comment, no "into" and no timestamp literal. Only D1 holds string literals, exactly `'request.jwt.claims'` and `'sub'`. The static test pins every block. Role blocks end in `ROLLBACK`, so nothing persists and the role reverts. A failure with `permission denied to set role` comes from the editor's role, not from the slice: record it, since the checker still proves the grants.

**Rollback rule (S5-3):** if D1 after apply, or any client write, fails with `permission denied for function` naming one of the 18, roll back at once, without waiting for attribution.

Block N1 (mandatory), as `anon`. Pass: `ERROR 42501 permission denied for function tg_service_events`. Run before the migration, the same block gives `0A000 trigger functions can only be called as triggers`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT public.tg_service_events();
ROLLBACK;
```

Block D1 (mandatory, before and after apply). Run D1 only when the pre-check row `Q12 d1 verdict information only` reads `D1 may run`; otherwise record it as skipped, and the logs are the proof (S5-2). D1 raises the price of each priced service in an active admin account's own rows by 1, as `authenticated`. The admin is the lowest active admin `user_id` that owns a priced service (S5-1). It counts the events the trigger wrote in this transaction, then rolls back.
- **Pass:** no error, `priced_services` at least 1, and `events_this_transaction` at least `priced_services`, with the same result before and after.
- **Fail:** `42501 permission denied for function` naming one of the 18 after apply.
- **Inconclusive:** `priced_services` 0, a table or RLS refusal, or 0 events before apply too.

```sql
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', admin_users.user_id)::text, true) AS claims_set FROM public.admin_users WHERE admin_users.is_active AND admin_users.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.scheduling_services WHERE scheduling_services.user_id = admin_users.user_id AND scheduling_services.price IS NOT NULL) ORDER BY admin_users.user_id LIMIT 1;
SET LOCAL ROLE authenticated;
UPDATE public.scheduling_services SET price = scheduling_services.price + 1 WHERE scheduling_services.user_id = auth.uid() AND scheduling_services.price IS NOT NULL;
RESET ROLE;
SELECT (SELECT count(*) FROM public.scheduling_services WHERE scheduling_services.user_id = auth.uid() AND scheduling_services.price IS NOT NULL) AS priced_services, (SELECT count(*) FROM public.business_events WHERE business_events.user_id = auth.uid() AND business_events.created_at >= pg_catalog.now()) AS events_this_transaction;
ROLLBACK;
```

Block N2, as `authenticated`. Optional (SA Q-5). Pass: `ERROR 42501 permission denied for function create_user_settings`.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.create_user_settings();
ROLLBACK;
```

Block P1, as `service_role`. Optional (SA Q-5). Pass: `ERROR 0A000 trigger functions can only be called as triggers`, which means EXECUTE passed and the engine refused the direct call. A `42501` is a rollback trigger (C6 contradicted).

```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.tg_service_events();
ROLLBACK;
```

Block EVENTS, about 24 hours after apply. Optional (SA Q-5), corroboration only. It counts `business_events` by type from natural traffic (`page.viewed`, `booking.*`, `invoice.*`, `payment.completed`, `contact.*`). A quiet window is not a failure.

```sql
SELECT business_events.event_type, count(*) AS events
FROM public.business_events
WHERE business_events.created_at >= pg_catalog.now() - pg_catalog.make_interval(hours => 24)
GROUP BY business_events.event_type
ORDER BY business_events.event_type;
```

Block SIGNUP, only if a real signup happened in the window. Optional (SA Q-5). Every new `auth.users` row should have its `profiles` row (`create_user_settings`). A signup that fails outright is the rollback signal, not this count.

```sql
SELECT count(*) AS new_users, count(profiles.id) AS with_profile
FROM auth.users
LEFT JOIN public.profiles ON profiles.id = users.id
WHERE users.created_at >= pg_catalog.now() - pg_catalog.make_interval(hours => 24);
```

| Check | Result (user) |
|---|---|
| Pre-check status; Q11 trigger map; Q12 verdict | ✅ CLEAN; 18 x 1 enabled trigger; Q12 D1 may run |
| D1 before | ➖ skipped by the user (baseline only) |
| Migration | ✅ applied 2026-10-11 |
| Checker | ✅ VERDICT PASS 108 pass 0 fail |
| N1 | ✅ 42501 permission denied for function tg_service_events |
| D1 after | ✅ priced_services 5, events_this_transaction 5, no error |
| N2, P1 (optional) | ➖ not run (checker proves the grants) |
| Postgres logs, one look at about T+24 h | ⬜ pending (user) |
| EVENTS, SIGNUP, inventory re-run (optional) | ➖ not run |

---

## Commit Info

(RM to populate.)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-11 | Created (Dev) | Slice 5 workplan. 18 trigger functions verified against the TSV (`kind = trigger`, `x_anon` t; 2 already closed `business_os_plan_fact_*` excluded), one grant shape B, rollback `PUBLIC, anon, authenticated`. Trigger map from git (3 tables carry two of the 18; `create_user_settings` fires on `auth.users`; only `log_exchange_rate_change` is prod-only). No direct caller anywhere in the repo. Risk analysis: no live exposure (PostgREST excludes trigger functions; PostgreSQL refuses a direct call; EXECUTE is not checked when a trigger fires); the slice closes the inventory (18 to 0) and the client `CREATE TRIGGER` path. Acceptance proposed as an in-database proof (D1 before and after, rolled back) plus N1, N2, P1, checker and logs; BOS flows optional; no agent-platform testing. Migration `20261051` proposed; PR #288 found already merged, so requirement and inventory edits wait for a main merge. 11 questions for SA |
| 2026-10-11 | SA workplan review | APPROVED WITH CONDITIONS (S5-1 to S5-6). The engine rule was verified independently: EXECUTE is checked only at `CREATE TRIGGER`; fire-time ACL checks apply only to functions in expressions, which Q11 covers; all 18 are SECDEF owned by `postgres`. D1 was confirmed to have no side effects outside the transaction (NOTIFY, Realtime and pg_net are all commit-bound). Mandatory acceptance: pre-check, checker, N1, D1 before and after, logs. N2, P1, BOS flows and agent-platform testing are not mandatory. Q-7 wording given; Q-11 unblocked (branch at `492066b9`) |
| 2026-10-11 | SA conditions folded in; implementation T-5 to T-11 (Dev) | The six conditions:<br>• S5-1: D1 selects the lowest active admin that owns a priced service (`EXISTS`, `ORDER BY admin_users.user_id`, no new literal), with the wording "an active admin account's own rows".<br>• S5-2: a Q12 information-only D1 surface row (triggers on `scheduling_services` and `business_events`, known or unknown, `http`/`dblink`). It gates D1 only and never prints `stop here`.<br>• S5-3: §5.3 and §6 follow Q-5. Mandatory: pre-check, checker, N1, D1 before and after, logs. Optional: N2 and P1. The unconditional rollback rule stays.<br>• S5-4: header and §3 updated; T-11 done, covering the requirement §4.3 S5 row, header, §6 S5 wording per Q-7 and Change History, plus the inventory §6 row 5 and the §4.5 correction.<br>• S5-5: the §5.2 matrix includes a `WHEN`-clause trigger and the `auth`-schema stand-in fired by a non-superuser.<br>• S5-6: §1.4 cites `CreateTriggerFiringOn`, `ExecCallTriggerFunc` and `ExecInitFunc`.<br>Five files are written under `20261051`. The static test passes 95/95 and is mutation-checked; regressions 487/487; `test:authz-guard` 203/203. The number is still free. Left uncommitted for SA code review |
| 2026-10-11 | SA code review | APPROVED WITH NITS. S5-1 to S5-6 verified in code. PostgreSQL desk-check of the new Q3, Q11 and Q12 rows and of D1: `tg_service_events` emits `pricing.changed` on any price change with `created_at` = transaction start, RLS allows the own-row update, so D1 observes the firing. Checker 54/54 before and 108/0 after; rollback restores the TSV set. One Low nit (D1 event count can over-count future-dated or concurrently committed events; optional `entity_id` filter). Slice 5 test 95/95, `test:authz-guard` 203/203 |
| 2026-10-11 | QA (local PGlite) | Full run of §5.2. Pre-check, run for the first time, reads `CLEAN` with every §2.1 value, and the same on ICU `und`; no defect found. Checker 54/54 before, 108/0 after, and the migration is idempotent. The 18 triggers fire unchanged after the revoke as `anon`, `authenticated` and a non-superuser auth-admin stand-in, both `WHEN`-clause triggers included; the matrix is identical before and after. Direct calls: `42501` for client roles, `0A000` for `service_role`. Client `CREATE TRIGGER` now fails with `42501`. N1, N2, P1 and D1 run verbatim; D1 observes the event and leaves no rows. The Q12 and Q11 negatives behave as specified, and the rollback restores the pre-state row for row. Static 95/95, authz-guard 203/203. Ready for commit |
| 2026-10-11 | SA optional D1 tightening not adopted (TL) | The event count is corroboration only; the pass signal is no permission error; adopting it would require a PGlite re-run of D1 |
| 2026-10-11 | Prod apply and acceptance (user, recorded by TL) | pre-check CLEAN at 14:45 UTC (Q3 trigger x18, Q11 exactly one enabled trigger each incl. auth.users and exchange_rates, Q12 D1 may run with the 3 known scheduling_services triggers); migration applied after the pre-check on 2026-10-11; checker VERDICT PASS 108 pass 0 fail; N1 42501 permission denied for function tg_service_events; D1 after apply: priced_services 5, events_this_transaction 5, no error (trigger fires without client EXECUTE); D1 before skipped by the user (baseline only, not needed for the pass rule) |
