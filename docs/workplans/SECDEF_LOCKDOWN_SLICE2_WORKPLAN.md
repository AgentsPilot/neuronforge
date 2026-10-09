# Workplan: SECURITY DEFINER Lockdown, Slice 2 (dead and prod-only cross-tenant functions)

> **Last Updated**: 2026-10-09

**Developer:** Dev
**Requirement:** [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) (FR-0.1 to FR-0.14, FR-2, §6, SA conditions C-1 to C-10)
**Pattern copied:** [SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md), including its SA conditions W-1 to W-7 and the prod lessons (§1.6)
**Evidence:** [secdef_prod_inventory_2026-10-07.tsv](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv) (signatures and grantees), [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md)
**Branch:** `fix/secdef-lockdown-slice-2` (worktree `neuronforge-secdef-s2`, off `origin/main` `88b1938f`)
**Migration number:** `20261048`. Re-checked 2026-10-09 at code complete: `origin/main` (`c0ae58bd`) tops at `20261047` (PR #273 merged 2026-10-09, `de3ed839`), and no open PR touches `supabase/migrations/`, `supabase/SQL Scripts/` or `supabase/held/`. Re-check again at PR time (T-10 rule)
**Date:** 2026-10-09
**Status:** ✅ Applied on prod 2026-10-09 15:48 UTC and accepted (PR #277). SA code review approved with nits (N-1 applied); QA PASS; user acceptance: checker 78/0, both negative calls 42501, smoke OK. Remaining: Postgres-log check to T+24h and Vercel at T+60 min (rollback only on a caller identified as ours).

## Overview

Slice 2 removes client EXECUTE from 13 SECURITY DEFINER functions that take a tenant id from the caller and that nothing in the app calls. Eight of them exist only in prod, with no definition in git. After the slice, only `service_role` (and the owner) can execute them. The delivery is the slice 1 five-file package unchanged in shape: a read-only pre-check, one `BEGIN ... COMMIT` migration with in-transaction post-conditions, a read-only checker ending in a VERDICT row, a rollback that restores the measured pre-state, and a static Jest test. No function body, table, policy or application code changes. Because no cron or app path calls these functions, acceptance is lighter than slice 1's cron watch (§5.3).

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

### 1.1 The 13 functions, verified against the prod TSV

Identity types are the TSV `identity_args` with the parameter names removed. Every row is `kind = fn`, has exactly one TSV row (no overloads), `x_public`/`x_anon`/`x_auth`/`x_service` all `t`, `public_acl` `t`, `search_path` `null` (not pinned), and `triggers` 0.

| # | Signature (prod identity) | TSV `identity_args` | `nargs` / `min_args` | Defined in git |
|---|---|---|---|---|
| 1 | `public.get_user_credit_balance(uuid)` | `p_user_id uuid` | 1 / 1 | no (prod-only) |
| 2 | `public.get_user_subscription_info(uuid)` | `p_user_id uuid` | 1 / 1 | no (prod-only) |
| 3 | `public.get_user_usage_summary(uuid, integer)` | `target_user_id uuid, days_back integer` | 2 / 1 | no (prod-only) |
| 4 | `public.get_user_workflow_stats(uuid)` | `target_user_id uuid` | 1 / 1 | no (prod-only) |
| 5 | `public.has_sufficient_credits(uuid, integer)` | `p_user_id uuid, p_required_credits integer` | 2 / 2 | no (prod-only) |
| 6 | `public.is_reward_eligible(uuid, character varying)` | `p_user_id uuid, p_reward_key character varying` | 2 / 2 | no (prod-only) |
| 7 | `public.get_last_perfect_calibration(uuid, uuid)` | `p_agent_id uuid, p_user_id uuid` | 2 / 2 | no (prod-only) |
| 8 | `public.get_unviewed_insights_count(uuid)` | `p_agent_id uuid` | 1 / 1 | no (prod-only) |
| 9 | `public.match_behavior_rules(uuid, uuid, text, text, text, text)` | `p_user_id uuid, p_agent_id uuid, p_plugin text, p_action text, p_error_code text, p_data_field text` | 6 / 5 | `20260629_enhance_behavior_rules.sql:88` |
| 10 | `public.record_behavior_rule_result(uuid, boolean)` | `p_rule_id uuid, p_success boolean` | 2 / 2 | `20260629_enhance_behavior_rules.sql:60` |
| 11 | `public.check_execution_anomaly(uuid, uuid, uuid, numeric, numeric, integer, integer, boolean)` | `p_agent_id uuid, p_execution_id uuid, p_user_id uuid, p_duration_ms numeric, p_token_usage numeric, p_step_count integer, p_retry_count integer, p_success boolean` | 8 / 8 | `20260629_execution_optimization_tables.sql:238` |
| 12 | `public.dismiss_setup_step(uuid, text)` | `p_user_id uuid, p_step_id text` | 2 / 2 | `20260802_add_dismissed_setup_steps_to_business_profiles.sql:13` |
| 13 | `public.upsert_plugin_performance(uuid, uuid, text, text, boolean, numeric, numeric, text)` | `p_agent_id uuid, p_user_id uuid, p_plugin text, p_action text, p_success boolean, p_duration_ms numeric, p_tokens numeric, p_error_code text` | 8 / 6 | `20260629_plugin_performance_table.sql:60` |

**Result: all 13 FR-2 signatures match the TSV exactly. No discrepancy.** Rows 11 and 13 are `DECIMAL` in the repo source and `numeric` in prod; the migration uses `numeric` (FR-0.2). Row 6 is `character varying`, not `varchar`. Defaults (rows 3, 9, 13) are not part of the identity signature and do not matter to the REVOKE.

### 1.2 Grant shape and rollback

**One shape for all 13** (slice 1 had two). TSV `execute_grantees` is `PUBLIC postgres anon authenticated service_role` on every row: the built-in PUBLIC grant plus Supabase's default-privilege `anon`/`authenticated` entries. None of the 5 repo files has a `GRANT` or `REVOKE` for its function, which agrees.

| Shape | Functions | How anon gets in today | Rollback grant |
|---|---|---|---|
| B (slice 1 naming) | all 13 | `PUBLIC` plus explicit `anon` and `authenticated` | `GRANT EXECUTE ON FUNCTION public.<sig> TO PUBLIC, anon, authenticated` |

Owner and grantor are not in the TSV (SA's slice 1 optimisation note asked to export them; the inventory has not been re-run since 2026-10-07). The pre-check measures both (Q2, Q5 grantors), as in slice 1.

### 1.3 Caller re-verification on current main (2026-10-09, `88b1938f`)

Searched the whole repo except `node_modules`, `.next`, `.git` for each name as a substring (all file types), then traced every hit. Also checked every `.rpc(<constant>)` call (13 in `lib/repositories/`): none resolves to a slice 2 name. `supabase/functions/` (only `run-scheduled-agents`) has no hit.

| # | Function | Hits outside docs | Live caller? | Client it would use |
|---|---|---|---|---|
| 1 | `get_user_credit_balance` | none | no | n/a |
| 2 | `get_user_subscription_info` | none | no | n/a |
| 3 | `get_user_usage_summary` | none | no | n/a |
| 4 | `get_user_workflow_stats` | `lib/services/workflowService.ts:828`, inside `static getUserStats()` | **no**: `getUserStats` has zero callers anywhere. Note: the module **is** reachable from a live page, `app/(protected)/orchestration/new/page.tsx` imports `components/orchestration-NOT-USED/WorkflowOrchestrationBuilder`, which imports `WorkflowService`, but no code calls `getUserStats` | browser `supabase` from `lib/supabaseClient` (anon key, signed-in user = `authenticated`). If it were ever called it would get `42501`, which its `catch` turns into all-zero stats (no crash) |
| 5 | `has_sufficient_credits` | none | no | n/a |
| 6 | `is_reward_eligible` | none | no | n/a |
| 7 | `get_last_perfect_calibration` | none | no | n/a |
| 8 | `get_unviewed_insights_count` | `lib/repositories/InsightRepository.ts:208` (`getUnviewedCount`) | **no**: `getUnviewedCount` has zero callers | injected client (the repo's other live method `getTopInsights` runs on the cookie client) |
| 9 | `match_behavior_rules` | own `CREATE` in `20260629_enhance_behavior_rules.sql`; `scripts/check-migrations.sql:115` (existence list); slice 6 guard baseline | no | n/a |
| 10 | `record_behavior_rule_result` | same pattern (`:60`, `check-migrations.sql:114`, guard baseline) | no | n/a |
| 11 | `check_execution_anomaly` | own `CREATE`; `check-migrations.sql:140`; guard baseline | no. `AnomalyDetector` calls `record_execution_anomaly` (slice 4a), not this one | n/a |
| 12 | `dismiss_setup_step` | own `CREATE`; `check-migrations.sql:530`; guard baseline | no. The live dismiss path `POST /api/business-os/setup-status/dismiss-step` updates `business_profiles.dismissed_setup_steps` directly, not through the RPC | n/a |
| 13 | `upsert_plugin_performance` | `lib/services/PluginPerformanceService.ts:72` (`recordExecution`) | **no**: `recordExecution` of this service has zero callers; `WorkflowOptimizer.ts:294` uses `getMetrics` only (the other `recordExecution` hits are `ExecutionService`, a different method) | injected client |

**Result: no live caller, as SA found on 2026-10-07. Code moved since then, but no new reference appeared.** No SQL caller in the repo: each repo-defined function's file names it only in its own `CREATE`. `scripts/check-migrations.sql` only lists names it checks for existence and does not execute them. The 8 prod-only functions may call each other inside prod (for example `has_sufficient_credits` reading `get_user_credit_balance`); the pre-check's Q6 measures that (§2.1). A SECDEF caller owned by `postgres` is unaffected, because the nested call checks the owner's EXECUTE.

The three dead TS references stay untouched (non-goal: no application change). They feed the later drop decision (SQ-3), see Q-3.

### 1.4 Slice 6 guard

The migration defines and alters no function, so it adds **0** (file, function) pairs and no finding: the guard stays green, and `20261048` is after the freeze date, so it can never be baselined. The 5 repo-defined functions are on the frozen baseline through their original `CREATE` files (guard lines 657 to 677). The baseline does **not** shrink, because the rule is same-file (slice 6 workplan line 84), and those files stay non-compliant. Progress is measured on prod by the checker. Ran on this branch 2026-10-09: guard plus slice 1 static test 151/151. SA suggested also asserting the guard's `analyseSql` result for the new migration in the slice 2 test. It is exported, but it lives in a `.test.ts` file: importing it would register and re-run every guard suite inside the slice 2 test, so it is not imported (SA: "otherwise skip it"). The guard already scans this file on every run, and the slice 2 test bans the `SECURITY DEFINER` text outright in all four files.

The guard's O-1 tripwire scans every `.sql` outside the three directories, which includes the new `scripts/` pre-check and checker. They must not contain the phrase `SECURITY DEFINER` anywhere, including inside a string (F-2). The pre-check reads `prosecdef`, as slice 1 does.

### 1.5 Skills consulted

| Skill | Applies? |
|---|---|
| `business-os-schema-check` | Yes: the TSV is the prod evidence, and the pre-check re-measures existence, owner, grantors and callers before apply |
| `tenant-isolation-guard` | No new write path. The slice removes a cross-tenant path |
| `business-os-entitlements` | No import from the module. `get_user_credit_balance` and `has_sufficient_credits` are not wired to entitlements |
| `new-api-route`, `new-repository`, `new-plugin`, `bos-llm-call-standards`, `durable-queue-drain` | Not applicable |

No TS source is touched, so there is no `console.*` flag to raise. (`workflowService.ts` has `console.error`, but it is not modified.)

### 1.6 Slice 1 lessons carried over

| Lesson | Where it lands |
|---|---|
| Prod false `DIFFERS`: a `name`-typed side sorts in C order, a `text` side in the database collation | Every `string_agg ... ORDER BY` in the pre-check ends in `COLLATE "C"`; the static test pins it |
| W-1 grantor | Pre-check `Q5 grantors`: `owner granted all` or `OTHER GRANTOR stop here` |
| W-2 no LIKE | Q6 to Q9 match with `strpos(lower(...), fn_name) > 0`; the test bans `LIKE`/`ILIKE` |
| W-5 static test rules | `kind = fn` TSV rows, exactly one per name, word-boundary write ban, "into" substring ban, exact per-file literal allow-list |
| Acceptance by logs, record counts not lines | §5.3, adapted: no cron to watch |
| Pre-check makes its tab read-only | READ ME row, new-tab apply order |

---

## 2. Approach

### 2.1 Pre-check (read-only, single result set)

**File:** `scripts/precheck-secdef-lockdown-slice2.sql`. A copy of the slice 1 pre-check with the lock-wrapper parts removed.

- First statement `SET default_transaction_read_only = on;`. Row 0 `READ ME`: `this session is now read only so run the migration in a NEW tab`.
- `watched` VALUES `(fn_name, fn_signature, fn_order, expected_grantees)`, 13 rows, every `expected_grantees` = `PUBLIC postgres anon authenticated service_role`. No `is_lock_wrapper` / `bare_signature` columns.
- Rows per function, `sort_order = fn_order * 1000 + 10` to `+ 95`; `PRECHECK STATUS` = 1; `checked at utc` = 99000.

| Item | Reports | Expected on prod |
|---|---|---|
| `Q1 exists <fn>` | `present` or `MISSING stop here`. For the 8 prod-only functions this is the only proof they still exist | `present` x13 |
| `Q2 owner <fn>` | owner, `stop here` unless `postgres` (C-3) | `postgres` x13 |
| `Q3 secdef <fn>` | `prosecdef`, `proconfig` search_path (informational) | `true`, search_path `none` x13 |
| `Q4 privileges <fn>` | `has_function_privilege` for the four roles | all `true` x13 |
| `Q5 grantees <fn> expected <TSV string>` | sorted sets compared with `COLLATE "C"` on both sides; `match` or `DIFFERS stop here rollback must change` | `match` x13 |
| `Q5 grantors <fn>` (W-1) | `grantee by grantor` pairs; `owner granted all` or `OTHER GRANTOR stop here` | `owner granted all` x13 |
| `Q6 caller <schema> <proname> of <fn>` | every `pg_proc` (outside `pg_*` schemas and `information_schema`, excluding itself) whose `lower(prosrc)` contains the name, with secdef, owner, config. `stop here` if SECURITY INVOKER, or SECDEF with an owner other than `postgres`. **No bare-name exception** (that was only for the `pg_*` wrappers) | none expected from the repo; prod-only bodies may call each other (all SECDEF `postgres`, not flagged) |
| `Q6 callers count <fn>` | count | recorded, not predicted |
| `Q7 policy <table> <policy> of <fn>` | `pg_policies` naming it; `stop here` if roles include `public`, `anon` or `authenticated` | none |
| `Q8 view <schema> <name> of <fn>` | `pg_views`/`pg_matviews` naming it; any row is `stop here` | none |
| `Q9 cron <fn>` | behind `to_regclass('cron.job')`: `cron not installed`, `none`, or `NAMED stop here`; detail says `visible jobs only` | `cron not installed` or `none` |
| `Q11 dependents count <fn>` | count of the rows below | 0 x13 |
| `Q11 dependent <description> of <fn>` (**new, Q-2, SA S2-1**) | every `pg_catalog.pg_depend` row with `refclassid = 'pg_proc'::regclass` and `refobjid` = the function's oid. Detail: `pg_describe_object(classid, objid, objsubid)` in the item, then `catalog <classid::regclass>` and `deptype <deptype>`. Catches what Q6 to Q8 cannot: column defaults (`pg_attrdef`), CHECK constraints (`pg_constraint`), index expressions (`pg_class`), rules and views (`pg_rewrite`), policy expressions and `BEGIN ATOMIC` SQL bodies. Those run as the calling or inserting role, so an anon or signed-in insert would start failing with `42501`. It does not replace Q6: plpgsql and string-bodied functions record no dependency. **In slice 2 any row is `stop here`** (TSV triggers = 0, so no dependent is expected) | none |

- Sort keys: Q11 count is `fn_order * 1000 + 100`, Q11 rows `+ 101`.
- Q10 (bare-name resolution) is dropped: no slice 2 name shadows a `pg_catalog` built-in. The number is skipped, not reused, so markers stay comparable across slices.
- Row 1 `PRECHECK STATUS`: `CLEAN`, or `STOP n rows need review`.

### 2.2 Migration

**File:** `supabase/migrations/20261048_secdef_lockdown_slice2_dead_cross_tenant.sql`. Same form as slice 1:

```sql
BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_user_credit_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_credit_balance(uuid) TO service_role;

(one REVOKE plus one GRANT per function, 13 pairs, in the §1.1 order)

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    (the 13 signature literals)
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 public still executes so nothing was applied ' || slice_signature;
    END IF;
    (same for anon and authenticated)
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 2 service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
```

Decisions, all inherited from slice 1 and SA-approved there: REVOKE always lists `PUBLIC, anon, authenticated` (FR-0.1, and the form the guard looks for); the `GRANT ... TO service_role` is kept although redundant (FR-0.1, history-independent end state); `REVOKE EXECUTE`, not `REVOKE ALL`; fail, never skip (C-2); a non-owner REVOKE or a foreign-grantor entry fails the post-condition and rolls everything back; no `SELECT` in the DO block (C-7); built-ins `pg_catalog.`-qualified; every name `public.`-qualified. The migration contains no `SECURITY`, `search_path`, `CREATE`, `ALTER` or `DROP`.

### 2.3 Checker (read-only, VERDICT first)

**File:** `scripts/check-secdef-lockdown-slice2-migration.sql`. Identical to slice 1's except the VALUES list. Six checks per function: `C1 exists`, `C2 owner postgres`, `C3 public` false, `C4 anon` false, `C5 authenticated` false, `C6 service_role` true; `IS FALSE` / `IS TRUE` so a NULL is FAIL (C-2). **Expected after apply: `VERDICT PASS 78 pass 0 fail`.** Before apply: `VERDICT FAIL 39 pass 39 fail` (C1, C2, C6 pass; C3 to C5 fail), a useful dry run.

### 2.4 Rollback

**File:** `supabase/SQL Scripts/20261048_secdef_lockdown_slice2_dead_cross_tenant_rollback.sql`. `BEGIN;` then 13 x `GRANT EXECUTE ON FUNCTION public.<sig> TO PUBLIC, anon, authenticated;`, a DO post-condition (exists, all four roles true, NULL raises), `COMMIT;`. No REVOKE. It re-opens the hole on purpose, as a short bridge only. After a rollback the pre-check must show Q4 all true and Q5 `match` x13.

### 2.5 Static test

**File:** `supabase/migrations/__tests__/secdef-lockdown-slice2.migration.test.ts`. A copy of the slice 1 test with a `SLICE_2` constant; asserts in §5.1.

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-secdef-lockdown-slice2.sql` | create | Read-only pre-check (FR-0.5, FR-0.10, FR-0.11, Q11 if SA agrees) |
| `supabase/migrations/20261048_secdef_lockdown_slice2_dead_cross_tenant.sql` | create | The revoke, with in-transaction post-conditions (FR-0.1, FR-0.9, FR-0.12) |
| `scripts/check-secdef-lockdown-slice2-migration.sql` | create | Read-only checker, VERDICT first (FR-0.4) |
| `supabase/SQL Scripts/20261048_secdef_lockdown_slice2_dead_cross_tenant_rollback.sql` | create | Exact pre-state restore (FR-0.5) |
| `supabase/migrations/__tests__/secdef-lockdown-slice2.migration.test.ts` | create | Static asserts (FR-0.13, C-8) |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify | §4.3: S6 row (merged, PR #271) and a new S2 row; Change History. Later: S2 PR, merge, apply, acceptance |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify (at PR time) | §6 slice table row 2: number and status, as slice 1 did |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE2_WORKPLAN.md` | create | This workplan |

No TS source, no other migration, no CI workflow change.

---

## 4. Task list

- ✅ T-0: Branch confirmed (`fix/secdef-lockdown-slice-2`); requirement, slice 1 workplan and its five files, slice 6 guard and TSV read
- ✅ T-1: 13 signatures and grant shapes verified against the TSV (§1.1, §1.2)
- ✅ T-2: Callers re-verified on current main (§1.3); guard run on this branch, green (§1.4)
- ✅ T-3: Migration number checked: `20261048` proposed (§ header)
- ✅ T-4: Workplan written; requirement §4.3 S6 row and a new S2 row recorded
- ✅ T-5: SA workplan review: approved with S2-1 to S2-4, Q-1 to Q-7 as proposed. S2-1 (§2.1 Q11), S2-2 (§5.3 step 2, §6 step 4, QA section blocks) and S2-3 (§5.3 3(a), §6 triggers) folded in; S2-4 in the requirement (FR-0.11, C-4 note, SQ-3 dead references, Change History)
- ✅ T-6: Static test written against `SLICE_2`
- ✅ T-7: Pre-check written (§2.1, Q11, `COLLATE "C"` on every `string_agg`)
- ✅ T-8: Migration and rollback written
- ✅ T-9: Checker written (slice 1 checker with the slice 2 VALUES)
- ✅ T-10: Run the slice 2 test; regressions: slice 1 test, `npm run test:authz-guard` (includes the slice 6 guard), the purge `no-deletion-paths` guard, `npx tsc --noEmit` on the test file, paste greps on all four SQL files. **Re-check the number:** `git fetch origin`, list `origin/main` `supabase/migrations/2026104*` and `supabase/SQL Scripts/2026104*`, and every open PR touching `supabase/migrations/`, `supabase/SQL Scripts/` or `supabase/held/` (`gh pr list` with files). If `20261048` is taken, rename both SQL files, the test constants and every doc mention **Done 2026-10-09:** slice 2 test 74/74 (mutation-checked: dropping one `COLLATE "C"` or the Q11 `stop here` fails it); slice 1 test, `no-deletion-paths`, Tailwind escape and `authAccountRepository` callers guards 169/169 together; `test:authz-guard` 203/203 (slice 6 guard green, 0 new pairs); `tsc --strict` on the test file clean; paste greps clean on all four SQL files (no `--`, `/*`, "into", LIKE, `SECURITY`/`DEFINER`, `business_os_auth_email_has_account`). Full `npm run test:gate` (10 min 47 s, Windows): 1072/1074 suites; the 2 failures are Windows-only and untouched by this slice (`bookingsSearchAndPaging.guard` expects LF source, `oneAddressPolicy.guard` compares backslash paths). Number re-checked: `20261048` free
- ⬜ T-11: SA code review, then the user sees the diff (left uncommitted)
- ⬜ T-12: User runs §6 steps 1 to 4 on prod; results recorded under QA Testing Report
- ⬜ T-13: QA confirms §5.3 acceptance; requirement §4.3 and inventory §6 updated with PR, merge and apply state

---

## 5. Test plan

### 5.1 Static test asserts (C-8, FR-0.13, slice 1 W-5)

One constant, `SLICE_2`, of 13 `{ name, signature, rollbackGrantees }`, every `rollbackGrantees` = `PUBLIC anon authenticated`.

**TSV cross-check:** parse `kind = fn` rows; for each entry exactly one row; `identity_args` with names stripped equals the signature's type list (handles `character varying`); `execute_grantees` minus `postgres` and `service_role` equals `rollbackGrantees`; 13 distinct names.

**All four SQL files (pasted by hand):** exist; no `--`; no `/*`; no `into` as a case-insensitive substring; even number of single quotes; no single-letter alias; no `LIKE`/`ILIKE`; no `SECURITY DEFINER` text (keeps the slice 6 O-1 tripwire and F-2 quiet). Every single-quoted literal is plain (letters, digits, underscores, spaces) or on an exact per-file allow-list: the 13 `public.` signature literals (all four files), plus `cron.job` and `TABLE cron.job` in the pre-check only.

**Migration:** one `BEGIN`, one `COMMIT`; exactly 13 REVOKE and 13 GRANT, each exactly `REVOKE EXECUTE ON FUNCTION <sig> FROM PUBLIC, anon, authenticated` / `GRANT EXECUTE ON FUNCTION <sig> TO service_role`, paired, in `SLICE_2` order; the `ON FUNCTION` set equals `SLICE_2` and every one is `public.`-qualified; one DO block whose array set equals `SLICE_2`, with the `IS NULL` raise, the three `IF pg_catalog.has_function_privilege('<role>'` checks and `IF NOT pg_catalog.has_function_privilege('service_role'`, and no `SELECT`; no `ALTER`, `CREATE`, `DROP`, `SECURITY`, `search_path`, `REVOKE ALL`, `CASCADE` or table keyword.

**Rollback:** one `BEGIN`/`COMMIT`; 13 GRANT `TO PUBLIC, anon, authenticated`, in order; no REVOKE; one DO post-condition expecting all four roles true and raising on NULL.

**Checker and pre-check:** first statement `SET default_transaction_read_only = on`; no write keyword at word boundaries; signature set equals `SLICE_2`. Checker: VERDICT first, PASS only when all pass, role polarity, `IS FALSE`/`IS TRUE`, owner `postgres`, 6 checks per function. Pre-check: the `NEW tab` READ ME; markers `Q1` to `Q9`, `Q5 grantors`, `Q11` (if approved) and `PRECHECK STATUS`; no `Q10`; `to_regclass('cron.job')` guards the cron read; expected-grantee strings read directly from the TSV; every `string_agg ... ORDER BY` ends in `COLLATE "C"` (mutation-checked as in slice 1).

### 5.2 What Jest cannot show

No branch database (FR-0.6). Execution is proven on prod by the user, through the pre-check, the post-conditions and the checker. QA may repeat slice 1's local PGlite run with the slice 2 shapes (one shape, no lock wrappers), plus a Q11 negative: a column default that calls one of the 13.

### 5.3 Acceptance after apply (proposed, lighter than slice 1, Q-1)

**Why lighter.** Slice 1's acceptance watched five crons because those functions had live service_role callers whose errors were swallowed. Slice 2 has no caller in the code (§1.3), no cron, and no SQL caller that the pre-check has not already cleared. The only residual risk is a caller outside the repo (an Edge Function or external job deployed but not in git, or a prod-only SQL object), and that would show up as an error, not as a quiet empty result. So acceptance proves the privilege outcome directly and then looks for that error over a window long enough for user-driven and daily traffic.

Let T be the apply time (UTC).

1. **Checker (the authority for the grant).** `VERDICT PASS 78 pass 0 fail`.
2. **Negative call as a client role** (SQL editor, new tab, `SET LOCAL ROLE` inside a transaction, as in slice 1's W-4). One reader per role, argument `NULL::uuid` so the block has no string literal. Privilege is checked before the body runs, so no body executes.
   ```sql
   BEGIN;
   SET LOCAL ROLE anon;
   SELECT public.get_user_credit_balance(NULL::uuid);
   ROLLBACK;
   ```
   Pass: `42501 permission denied for function get_user_credit_balance`. Then `authenticated` on `public.get_user_subscription_info(NULL::uuid)`. **SA S2-2:** each block in its own **new** tab; both are written verbatim, paste-safe, in the QA Testing Report section (§ Negative call check), and the static test pins them; the QA report records the SQLSTATE and the function name from each. **No positive call as service_role** (Q-4): 8 bodies are prod-only and unread, the checker's C6 already proves the grant, and nothing in the app needs the call to work.
3. **Logs, counts not lines.**
   - (a) Supabase Postgres logs from T to T+24 h: count of `permission denied for function`, and of those, how many name one of the 13. Read before the plan's retention ends. **SA S2-3:** after the revoke, a stranger probing `/rest/v1/rpc/<fn>` with the anon key writes the same line as a lost caller of ours, so a bare hit is **not** a failure. Each hit naming one of the 13 is attributed where the log allows (role, user agent, source): an unattributed or anon hit is recorded as a **probe count** and the hole stays closed; only a hit attributed to us (service_role, our server, our Edge Function) is a rollback trigger (§6).
   - (b) Vercel runtime logs (production) at T+60 min: `permission denied for function` and `42501`. Expected 0.
   - (c) Supabase API / edge logs, if the UI allows a path search: any `/rest/v1/rpc/<one of the 13>` after T. A 401/403 there is either an unknown caller (rollback trigger, §6) or a stranger probing (no action). Slice 1 found this search inconclusive, so it is best-effort.
4. **Smoke, signed in, about 5 minutes, any time after T.** Paths a user could plausibly connect to these functions by name. None of them calls the 13 (§1.3), so this checks the claim, not the RPCs:
   - Business OS dashboard loads with the credits balance shown (credit balance, sufficient credits)
   - Settings billing / plan page shows the plan and usage (subscription info, usage summary)
   - Business OS setup checklist: dismiss one step, it stays dismissed after reload (`dismiss_setup_step` name)
   - One agent's detail page with its insights and calibration sections (unviewed insights count, last perfect calibration)
5. Optional: re-run the inventory script; anon-executable drops from 55 to 42 and non-trigger from 37 to 24.

Acceptance is complete at T+24 h with 1 to 4 green.

---

## 6. Apply order and rollback plan

All steps are run by the user in the Supabase SQL editor on prod (FR-0.6). Dev never connects to a database.

| Step | Where | Expect |
|---|---|---|
| 1. Pre-check | tab A | `PRECHECK STATUS CLEAN`. Paste the output under QA Testing Report. Any `stop here` row: stop and bring it to Dev/SA |
| 2. Migration | **new** tab B | `Success. No rows returned`. Any error means nothing was applied |
| 3. Checker | new tab C | `VERDICT PASS 78 pass 0 fail` |
| 4. Negative calls | new tab D (anon), new tab E (authenticated) | `42501` naming the function, for each (§5.3 step 2; blocks in § Negative call check) |
| 5. Smoke | the app, signed in | §5.3 step 4 |
| 6. Logs | Vercel at T+60 min; Supabase Postgres logs at T+24 h | §5.3 step 3 |
| 7. Merge | GitHub | After SA code review, QA pass and the user's approval (RM). As in slice 1, apply and checker run before merge (FR-0.6) |

**Rollback triggers (SA S2-3): only a caller identified as ours.** Namely: a Vercel `42501` or `permission denied for function` naming one of the 13 (Vercel logs are our server only); a smoke step failing with a permission error; or a Supabase Postgres, API or edge log entry naming one of the 13 whose role, user agent or source we recognise (service_role, our server, our Edge Function). A bare Postgres-log hit, or an anon hit we cannot attribute, is **not** a trigger: a stranger probing the closed function produces exactly that line. It is recorded as a probe count and the hole is not re-opened. On a real trigger: paste the rollback in a new tab, re-run the pre-check (Q4 true, Q5 `match` x13), and bring the caller to Dev. The rollback is all-or-nothing for the 13 (see Q-5).

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A caller outside the repo (a deployed Edge Function not in git, an external service, a prod-only SQL object) loses access | Pre-check Q6 to Q9 and Q11; 24 h Postgres log window; rollback ready |
| R-2 | A prod-only function was dropped or changed since 2026-10-07 | Q1 and the migration's NULL raise: a missing function aborts the whole apply (C-2). Recorded and brought to SA, never skipped |
| R-3 | A column default, check constraint or index expression calls one of the 13, so client inserts would fail after the revoke | New Q11 (`pg_depend`) |
| R-4 | Non-owner REVOKE or foreign grantor | Q2 and Q5 grantors; post-condition raises |
| R-5 | Collation makes equal grantee sets read `DIFFERS` | `COLLATE "C"` on every `string_agg ... ORDER BY`, pinned by the test |
| R-6 | A dead TS reference is revived later and gets `42501` | Recorded in §1.3; the drop decision (SQ-3) removes them with the functions |
| R-7 | The migration number is taken before merge | T-10 re-check |
| R-8 | SQL-editor paste bugs | Static test bans them, exact literal allow-list |

---

## 8. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Acceptance: replace slice 1's cron watch with checker + negative `SET LOCAL ROLE` calls + logs (Postgres to T+24 h, Vercel at T+60 min, API path search best-effort) + a 4-path signed-in smoke (§5.3)? | Yes. Nothing calls these functions, so there is nothing to watch run; the grant is proven by the checker, and the only residual risk (an out-of-repo caller) surfaces as an error in the logs |
| Q-2 | Add pre-check **Q11** (`pg_depend` dependents: column defaults, check constraints, index expressions, rules)? C-4 does not list these, and they run as the inserting role | Yes, in slice 2 and every later slice. One extra CTE, no new literal beyond `pg_proc` (plain) |
| Q-3 | The three dead TS references (`workflowService.getUserStats`, `InsightRepository.getUnviewedCount`, `PluginPerformanceService.recordExecution`): leave them, or delete them in this slice? | Leave them. No application change in a revoke slice (non-goal); they go with the drop decision (SQ-3) |
| Q-4 | Skip the positive service_role call for slice 2? | Yes. 8 bodies are unread prod-only DDL; the checker's C6 proves the grant; no app path needs it |
| Q-5 | Rollback is all 13 at once. Offer a per-function rollback? | No. One file, one post-condition, as slice 1. An unknown caller of one function is unlikely, and a full re-open for a few hours is the accepted bridge |
| Q-6 | DDL capture of the 8 prod-only functions (C-10). They are all on slice 7's 47 list (`search_path` null), so the capture is owed before S7 anyway. In this slice, or separately? | Separately, as its own read-only script before S7; it is not needed for a revoke |
| Q-7 | Migration number `20261048` and name `20261048_secdef_lockdown_slice2_dead_cross_tenant.sql` (`secdef-lockdown-slice2` for scripts and the test, per slice 1 Q-5) | As proposed, re-checked at PR time |

---

## SA Review Notes

**Reviewed by SA — 2026-10-09**
**Status:** ✅ APPROVED WITH CONDITIONS (S2-1 to S2-4). Dev may start T-6 once S2-1 to S2-3 are folded into §2.1, §5 and §6, and S2-4 into the requirement.

### Comments (what SA re-verified)
1. §1.1/§1.2: all 13 TSV rows read directly. Each name has exactly one row, `kind = fn`, `search_path` null, triggers 0, and `execute_grantees` = `PUBLIC postgres anon authenticated service_role`. Identity types, `nargs`/`min_args` and `character varying` all match. One shape, so every rollback grant is `PUBLIC, anon, authenticated`. — SA: resolved
2. §1.3: re-grepped all file types except `docs/`, `node_modules`, `.next` and `.git` on `88b1938f`. Hits are only the ones listed. `getUserStats`, `getUnviewedCount` and `PluginPerformanceService.recordExecution` have 0 callers. `WorkflowOptimizer` uses `getMetrics` only. The Dev correction holds: `app/(protected)/orchestration/new/page.tsx` imports `orchestration-NOT-USED/WorkflowOrchestrationBuilder`, so `workflowService.ts` is in a live bundle, but the RPC sits only in the uncalled `getUserStats`. Every `.rpc(<constant>)` resolves to a file with no slice 2 name. `dismiss-step/route.ts` has no `.rpc`: it does select then `.update({ dismissed_setup_steps })` on `business_profiles`. — SA: resolved
3. §1.4: the guard's O-1 tripwire covers `scripts/*.sql`. The two new read-only scripts would be exempt for in-string mentions anyway, and the static test's `SECURITY DEFINER` text ban is stricter. Same-file rule: the migration adds 0 pairs, and the baseline does not shrink. — SA: resolved
4. Requirement §4.3 edits: `f885570d` is the #271 merge and an ancestor of `88b1938f`. The S6 row (10 s step inside the required authz job, block proof pending) and the new S2 row are accurate. The edits are targeted (+6/−4). — SA: resolved
5. Migration number: `origin/main` tops at `20261046`. Open PR #273 adds `20261047_operator_test_account_cleanup_audit_actor` (migration and rollback), and it is the only open PR touching `supabase/migrations|SQL Scripts|held`. So `20261048` is correct today. T-10 re-check stands. — SA: resolved
6. §2.3 counts: 13 × 6 = 78. The pre-apply dry run `39 pass 39 fail` is right. — SA: resolved

### Rulings on Q-1 to Q-7
- **Q-1 Lighter acceptance: approved.** That is the checker, then negative `SET LOCAL ROLE` calls with `NULL::uuid` (privilege is checked before the body runs), then Postgres logs T..T+24 h and Vercel at T+60 min, then the ~5-min signed-in smoke. The API path search stays best-effort. Two adjustments are in S2-2 and S2-3.
- **Q-2 Q11 `pg_depend` dependents: approved, for this slice and every later one.** It is the only catalog check that sees column defaults (`pg_attrdef`), CHECK constraints (`pg_constraint`), index expressions (`pg_class`), rules and views (`pg_rewrite`, which also backs up Q8 text matching), policy expressions, and `BEGIN ATOMIC` SQL bodies. These are evaluated as the calling or inserting role. It does **not** replace Q6, because plpgsql and string-bodied functions record no dependency. Details in S2-1 and S2-4.
- **Q-3 Leave the three dead TS refs: approved.** A revoke slice makes no application change. The failure mode is benign: `getUserStats` catches and returns zeros, and the other two are unreachable. They must be tracked so they are not lost (S2-4).
- **Q-4 Skip the positive service_role call: approved.** C6 proves the grant. Running unread prod-only bodies as service_role (which bypasses RLS) for no consumer is more risk than evidence.
- **Q-5 All-at-once rollback: approved.** One file, one post-condition. A per-function variant adds paste surface for a near-zero-probability case. The bridge is still short, and S2-3 makes sure it is never opened for a stranger.
- **Q-6 DDL capture of the 8 prod-only bodies: deferred, approved.** It is not needed for a revoke. It stays owed before S7 (C-10, SQ-4) as its own read-only script. S7 cannot start without it.
- **Q-7 `20261048` and naming: approved.** That is `20261048_secdef_lockdown_slice2_dead_cross_tenant.sql`, the matching `_rollback.sql` under `supabase/SQL Scripts/`, and `secdef-lockdown-slice2` for the scripts and the test. Re-check at T-10. If the number is taken, rename all of them together.

### Conditions
1. **S2-1 Q11 shape (pre-check and static test).** Select from `pg_catalog.pg_depend` with `refclassid = 'pg_proc'::regclass` and `refobjid` = each function's oid. Report `pg_describe_object(classid, objid, objsubid)`, the dependent's catalog (`classid::regclass`) and `deptype`. In slice 2, any row is `stop here`, because TSV triggers = 0 and no dependent is expected. The static test pins the `Q11` marker, `pg_depend`, `refclassid` and `pg_describe_object`, and the `pg_proc` literal stays plain. If QA repeats the PGlite run, the Q11 negative (a column default that calls one of the 13 must produce `stop here`) is required, not optional.
2. **S2-2 Negative calls, made explicit (§5.3 step 2, §6 step 4).** Run two blocks: `anon` on `get_user_credit_balance(NULL::uuid)` and `authenticated` on `get_user_subscription_info(NULL::uuid)`. Each runs in its own **new** tab, as `BEGIN; SET LOCAL ROLE ...; SELECT ...; ROLLBACK;`. Record the SQLSTATE `42501` and the function name from each in the QA report. Put both blocks verbatim in the QA Testing Report section, as slice 1 did for its lock check, so the static paste rules apply to them too: no "into", no punctuation literals.
3. **S2-3 Rollback trigger needs attribution (§6).** After the revoke, a stranger probing `/rest/v1/rpc/<fn>` with the anon key produces the same `permission denied for function` line in the Postgres logs as a lost caller of ours. A bare Postgres-log hit is therefore **not** a rollback trigger on its own. Roll back only when the caller is identified as ours: a Vercel `42501`, a failed smoke step, or a log or API entry whose role, user agent or source we recognise (service_role, our server, our Edge Function). An unattributed anon hit is recorded as a probe count, and the hole is not re-opened. Reword the §6 trigger list and §5.3 3(a) to match.
4. **S2-4 Requirement updates (targeted).** (a) Amend FR-0.11 and add a C-4 note so Q11 `pg_depend` becomes part of the caller pre-check for S3, S4a, S5 and S4b. For any later slice that contains a trigger function, `pg_trigger` dependents are expected and are judged against that slice's analysis rather than auto-stopped. Every other catalog stays `stop here`. (b) Record the three dead TS references (`workflowService.getUserStats`, `InsightRepository.getUnviewedCount`, `PluginPerformanceService.recordExecution`) against SQ-3, so the later drop decision removes them with the functions. (c) Add one Change History row.

### Optimisation Suggestions
- In the slice 2 static test, also assert that the slice 6 guard's analyser reports `{ pairs: [], findings: [] }` for the new migration, mirroring the guard's own "real files" check for `20261044` (import the guard's exported analyser if it is exported, otherwise skip it). Do not edit the guard file in this slice.
- When the inventory is next re-run (step 5, optional), add `owner` and `grantor` columns, so later slices can cross-check Q2 and Q5 against the TSV.

### Approval
[x] Workplan approved — proceed to implementation once S2-1 to S2-3 are folded into the workplan and S2-4 into the requirement

**Code Review by SA — 2026-10-09**
**Status:** ✅ Code Approved, with nits (N-1 must land in this PR; N-2 to N-4 optional)

### Code Review Comments
1. Conditions verified in code. **S2-1:** `scripts/precheck-secdef-lockdown-slice2.sql:100-111,255-267` reads `pg_catalog.pg_depend` on `refclassid = 'pg_proc'::regclass` (plain literal inside the quotes) and `refobjid = fn_oid`, and reports `pg_describe_object(classid, objid, objsubid)` (COALESCEd), `classid::regclass::text` and `deptype::text`. Each row ends `stop here` and feeds PRECHECK STATUS. The test pins all of these (test:354-362). **S2-2:** the two blocks are verbatim in the QA section, and the test pins the statements and the paste rules (test:395-423). **S2-3:** §5.3 3(a) and §6 are reworded so that only a caller attributed to us triggers a rollback; probes are counted. **S2-4:** FR-0.11, the C-4 note, the SQ-3 dead references and the Change History row are all in the requirement. — SA: resolved
2. PostgreSQL desk check. `to_regprocedure` literals use the TSV identity types (`character varying`, `numeric`), and the test derives them from the TSV (test:123-138). `has_function_privilege('public', …)` is the documented PUBLIC pseudo-role form. The DO blocks use direct booleans, with no `SELECT` and no `INTO` (test:248,279). All 4 `string_agg … ORDER BY` in the pre-check carry `COLLATE "C"` (lines 165, 170, 173, 185), and the test pins every one. `regprocedure = oid` comparisons resolve through the binary-coercible cast. The checker's `count(*) || ' pass '` resolves through `anynonarray || text`. The rollback leaves the pre-existing `service_role` grant alone, which is correct because the TSV pre-state already includes it. Q11 cannot false-positive on the function's own rows: its type and extension dependencies are recorded with the function on the `objid` side. — SA: resolved
3. Grep-only checks pass: no comments, no "into", no LIKE, no single-letter alias, no `SECURITY DEFINER` text, an even number of quotes, and the punctuated allow-list holds only signatures plus `cron.job` / `TABLE cron.job`. The negative-call blocks have no literal at all. — SA: resolved
4. Doc edits are accurate. SA confirmed PR #274 with `gh`: CLOSED, `mergedAt` null, its only file is `supabase/held/29991231_throwaway_secdef_probe.sql`, `Admin authz surface guard` FAILURE, `Gate tests (jest)` FAILURE (shard 2), and the remote branch is gone. Branch protection on `main` reads `enforce_admins` true and `strict` true, and both checks are in the 6 required contexts. `mergeStateStatus` BLOCKED can no longer be re-read on a closed PR, so it is taken from TL's run. The requirement diff is targeted, and so is the slice 6 workplan diff. — SA: resolved
5. Windows-only gate failures: confirmed pre-existing and unrelated. `bookingsSearchAndPaging.guard` fails because `core.autocrlf=true` checks the file out with CRLF, and the guard matches a multi-line LF substring. `oneAddressPolicy.guard` fails on `\` path separators. The slice touches neither file and neither is quarantined, so both run in CI. The `Tests` workflow is green on `main` at `88b1938f` (this branch's base), `de3ed839` and `c0ae58bd`. — SA: resolved
6. Runs (SA, 2026-10-09): slice 2 test 74/74; `npm run test:authz-guard` 203/203, so the slice 6 guard is green with `20261048` present. — SA: resolved

### Nits
- **N-1 (include in this PR): inventory §6 row 6.** Slice 6 T-10 and §6 step 4 both name it as owed, and the user rule puts every slice stage into the docs of record. Row 1 already carries its ✅ Done. In `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` §6, add **"✅ Done 2026-10-09** (PR #271 merged 2026-10-08, `f885570d`; merge block proven by throwaway PR #274)" to row 6. Add one inventory Change History row. Then drop "(inventory §6 row 6 still to update)" from the slice 6 workplan T-10 and its last Change History row. Make no other inventory edit now. Set row 2's migration cell to `20261048` only at PR time, after the T-10 number re-check.
- N-2: Requirement Change History, first 2026-10-09 row: "block proof pending (TL)" was true when written. The next row supersedes it, so leave it.
- N-3: Test header (lines 18-22) explains why the guard analyser is not imported. That is acceptable: the SA suggestion was conditional, and `test:authz-guard` covers the same ground.
- N-4: Negative-call blocks: the Supabase editor may warn "there is already a transaction in progress" on `BEGIN`. The warning is harmless. Record only the `42501` line.

### Code Approved for QA: Yes (after N-1, a doc-only edit with no SA re-review needed)

---

## QA Testing Report

**QA — 2026-10-09**
**Test mode:** full
**Strategy used:** A (static Jest) plus C (all four SQL files and both negative-call blocks executed against a throwaway local PGlite database, as in slice 1). Production was never touched.
**Focus:** security, schema
**Skipped:** prod apply and the §5.3 acceptance (owed by the user after apply)
**Input source:** TL prompt

#### Fixture (PGlite 0.5.8 = Postgres 18.3, files in the QA scratchpad, nothing added to the repo)

Roles `anon`, `authenticated`, `service_role`, `supabase_admin`, `other_owner` and a non-superuser `migrator` (all NOLOGIN). `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role`, as Supabase does. The 13 functions use the prod signatures, including `character varying` and `numeric`, and the source defaults (rows 3, 9 and 13). They are plpgsql, SECURITY DEFINER and owned by `postgres`, with stub bodies. The resulting ACL on all 13 is `{=X, postgres=X, anon=X, authenticated=X, service_role=X}` granted by `postgres`, which is the TSV shape. Each "tab" is a fresh session on the same data directory. The negative-call blocks were read verbatim from this section by the harness, not retyped.

**Collation.** The main run uses a C-collation database. The `COLL` run repeats the flow in a second database created with `LOCALE_PROVIDER icu ICU_LOCALE 'und'`, where the default sort is `anon postgres PUBLIC`. That is the prod-like case that produced slice 1's false `DIFFERS`.

#### Results

| # | Step | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | Static test `secdef-lockdown-slice2.migration.test.ts` | green | 74/74 (re-run green after this report was written) | ✅ Pass |
| 2 | `npm run test:authz-guard` | green | 203/203 | ✅ Pass |
| 3 | Pre-check | `CLEAN`, Q5 `match` x13 | `CLEAN`. Q2 `postgres ok` x13. Q3 `secdef true config none` x13. Q4 all true x13. Q5 `match` and `owner granted all` x13. Q6 `0 found` x13. Q9 `cron not installed`. Q11 count `0` x13 | ✅ Pass |
| 4 | Checker before | `VERDICT FAIL 39 pass 39 fail` | `VERDICT FAIL 39 pass 39 fail`. The failures are exactly C3, C4 and C5 x13 | ✅ Pass |
| 5 | Migration (new tab) | success | Success. All 13 ACLs now read `{postgres=X/postgres, service_role=X/postgres}` | ✅ Pass |
| 6 | Checker after | `VERDICT PASS 78 pass 0 fail` | `VERDICT PASS 78 pass 0 fail` | ✅ Pass |
| 7 | Migration run a second time | idempotent | Success; checker still 78/0 | ✅ Pass |
| 8 | Negative block 1 (`anon`), verbatim, new tab | 42501 naming the function | `42501 permission denied for function get_user_credit_balance`. `current_user` is back to `postgres` after `ROLLBACK` | ✅ Pass |
| 9 | Negative block 2 (`authenticated`), verbatim, new tab | 42501 naming the function | `42501 permission denied for function get_user_subscription_info`. `current_user` is back to `postgres` | ✅ Pass |
| 10 | Extra (local only): `anon` and `authenticated` call each of the 13 with NULL args; `service_role` calls `get_user_credit_balance` | all 26 denied; service_role works | 26/26 denied with `42501`, each naming its function; service_role call has no error | ✅ Pass |
| 11 | Rollback, then its DO post-condition (new tab) | success | Success, DO passed. The ACL entry order changed (PUBLIC moved from first to third), but the set is equal | ✅ Pass |
| 12 | Checker after rollback | equals pre-state | 39 pass 39 fail, row-for-row identical to step 4 | ✅ Pass |
| 13 | Pre-check after rollback | `CLEAN`, Q5 `match` x13 | `CLEAN`, Q5 `match` x13 | ✅ Pass |
| COLL | Pre-check on the ICU `und` database (default sort `anon postgres PUBLIC`) | `CLEAN`, Q5 `match` x13 | `CLEAN`, Q5 `match` x13. Checker before 39/39, migration success, checker after 78/0, rollback success, pre-check after `CLEAN` | ✅ Pass |
| COLL-M | Mutation control: same ICU database, every `COLLATE "C"` removed from the pre-check | reproduces slice 1's prod bug | `STOP 13`, Q5 `DIFFERS` x13 (actual `PUBLIC anon authenticated postgres service_role` against the ICU-sorted expected list). This shows the `COLLATE "C"` fix is what makes COLL pass, so it is a real test | ✅ Pass |
| N0 | Pre-check, then migration, in the **same** session | refused | `25006 cannot execute REVOKE in a read-only transaction`; nothing applied (checker 39/39) | ✅ Pass |
| N1 | One function missing (`is_reward_eligible` dropped) | raises and applies nothing | Pre-check `STOP 6` (Q1 to Q5 grantors). Migration fails with `42883 function public.is_reward_eligible(uuid, character varying) does not exist`; ACLs unchanged; checker 36 pass 42 fail. With that function's REVOKE and GRANT lines removed, so that only the DO block sees the gap: `P0001 Slice 2 lockdown function missing so nothing was applied public.is_reward_eligible(uuid, character varying)`; ACLs unchanged. The rollback also fails cleanly with 42883 | ✅ Pass |
| N2 | Foreign grantor: `anon` EXECUTE on `dismiss_setup_step` granted by `supabase_admin` | pre-check flags; migration fails safe | Pre-check `STOP 2`: Q5 `DIFFERS` (two `anon` entries plus `supabase_admin`) and Q5 grantors `anon by supabase_admin ... OTHER GRANTOR stop here`. Migration fails with `P0001 Slice 2 anon still executes so nothing was applied public.dismiss_setup_step(uuid, text)`; ACLs unchanged | ✅ Pass |
| N3b | Non-superuser `migrator` owns all 13 and applies (emulates Supabase's non-superuser `postgres`) | success | Migration and rollback both succeed. The checker fails only C2 x13, because the owner is named `migrator` (expected) | ✅ Pass |
| N3 | Same setup, but `get_user_workflow_stats` is owned by `other_owner` | flagged; fails safe | Pre-check Q2 `other_owner stop here` and Q5 `DIFFERS` for it. Migration fails with `P0001 Slice 2 public still executes so nothing was applied public.get_user_workflow_stats(uuid)`; ACLs unchanged | ✅ Pass |
| N4a | **Q11 (SA S2-1, required):** a column `DEFAULT public.has_sufficient_credits(NULL::uuid, 0)` | Q11 stop row | `STOP 1`: `Q11 dependent default value for column ok of table qa_default_t of has_sufficient_credits` / `catalog pg_attrdef deptype n stop here`. Q6, Q7 and Q8 all read 0 for it, so only Q11 sees it. Risk confirmed: after the migration, an `authenticated` INSERT on that table fails with `42501 permission denied for function has_sufficient_credits` | ✅ Pass |
| N4b | Q11 other catalogs: CHECK constraint, view, `BEGIN ATOMIC` SQL function | Q11 stop rows | Stop rows from `pg_constraint` (`constraint qa_ck`), `pg_rewrite` (`rule _RETURN on view qa_view`, with Q8 also flagging the view) and `pg_proc` (`function qa_atomic(uuid)`). The `BEGIN ATOMIC` caller has an empty `prosrc`, so Q6 misses it and only Q11 catches it, which is the case SA described | ✅ Pass |
| N5 | Q6: a SQL-language SECURITY INVOKER function (string body) calls `get_user_subscription_info` | Q6 stop row | `Q6 caller public qa_invoker_sql of get_user_subscription_info` / `secdef false owner postgres ... stop here`. Control: a SECURITY DEFINER caller owned by `postgres` reads `ok` and is not flagged | ✅ Pass |

#### Gaps (not emulated)

1. PGlite's session user is always the bootstrap **superuser** `postgres`, so the main run applies as a superuser. N3 and N3b cover the non-superuser case with `migrator`.
2. The ICU `und` database stands in for prod's en_US-like collation. The real prod default collation was not tested; the property that matters (PUBLIC sorts after `postgres` on the text side) is reproduced.
3. Not emulated:
   - the PostgREST `/rest/v1/rpc` path
   - real `pg_cron` (Q9 only ran the `cron not installed` branch)
   - the 8 prod-only function bodies, and whether they call each other (Q6 on prod will show that)
   - the Supabase SQL-editor role (`SET LOCAL ROLE` permission)
4. Still owed on prod by the user: §6 steps 1 to 6 (pre-check, apply, checker, the two negative blocks below, smoke, logs).

#### Issues found

- Bugs: none.
- Performance: none.
- Edge case (informational, as in slice 1): if the pre-check and the migration are pasted into **one** run, the read-only SET does not protect the migration. The documented new-tab order is safe (N0).

#### Final status

- [x] Every locally testable criterion passes. **QA verdict: PASS. Ready for commit** after the user's diff review and approval. Prod acceptance (§5.3) follows the apply.

### Prod apply and acceptance (user, 2026-10-09)

Pre-check CLEAN at 15:47 UTC (Q5 match and owner granted all x13, Q11 0 dependents; one Q6 caller, has_sufficient_credits calling get_user_credit_balance, both SECDEF owned by postgres, ok); migration applied 15:48 UTC; checker VERDICT PASS 78 pass 0 fail; negative calls 42501 for get_user_credit_balance (anon) and get_user_subscription_info (authenticated); signed-in smoke: no impact. T = 15:48 UTC. Post-merge: Postgres logs T to T+24h and Vercel at T+60 min for permission denied for function; rollback only on a caller identified as ours (S2-3).

### Negative call check (written by Dev per SA S2-2, run by the user)

Paste each block in its own **new** SQL-editor tab, after the migration and the checker. They contain no string literal, no comment and no "into", and the static test pins them. The privilege check happens before the function body runs, so no body executes; `ROLLBACK` reverts the role.

Block 1, as `anon`. Pass: `ERROR 42501 permission denied for function get_user_credit_balance`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT public.get_user_credit_balance(NULL::uuid);
ROLLBACK;
```

Block 2, as `authenticated`. Pass: `ERROR 42501 permission denied for function get_user_subscription_info`.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.get_user_subscription_info(NULL::uuid);
ROLLBACK;
```

If either block fails with `permission denied to set role`, that is the editor role, not the slice: record it; the checker's C3 to C5 still prove the outcome.

| Check | SQLSTATE | Function named | Result |
|---|---|---|---|
| Block 1 (anon) | local PGlite `42501` | local `get_user_credit_balance` | ✅ prod 2026-10-09: 42501 (local PGlite ✅) |
| Block 2 (authenticated) | local PGlite `42501` | local `get_user_subscription_info` | ✅ prod 2026-10-09: 42501 (local PGlite ✅) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-09 | Created (Dev) | Slice 2 workplan: 13 signatures verified against the prod TSV (no discrepancy), one grant shape (`PUBLIC postgres anon authenticated service_role`), so every rollback grant is `PUBLIC, anon, authenticated`. Callers re-verified on main `88b1938f`: no live caller; three dead TS references traced. Slice 6 guard stays green (0 new pairs). Migration `20261048` proposed (`20261047` claimed by PR #273). Lighter acceptance proposed, new pre-check Q11 (`pg_depend`). 7 open questions for SA |
| 2026-10-09 | SA workplan review | APPROVED WITH CONDITIONS S2-1 to S2-4. SA re-verified the 13 TSV rows, re-verified callers on `88b1938f` (none live; dismiss-step route uses a direct update, not the RPC), the §4.3 edits and `20261048`. Q-1 to Q-7 approved as proposed. Conditions: Q11 shape, and Q11 made mandatory in the PGlite negative; explicit negative-call blocks for both roles; rollback only on an attributed caller, never on an anon probe; requirement FR-0.11/C-4 amendment plus SQ-3 dead-ref record |
| 2026-10-09 | SA conditions folded in; implementation T-5 to T-10 (Dev) | S2-1 Q11 `pg_depend` dependents (catalog, deptype, describe; any row stops); S2-2 the two negative-call blocks verbatim in the QA section, pinned by the static test; S2-3 rollback only on a caller identified as ours, unattributed hits counted as probes (§5.3 3(a), §6); S2-4 in the requirement. Five files written under `20261048`; all suites green except two Windows-only gate failures unrelated to the slice. `20261047` merged on main (#273), `20261048` still free. Guard analyser not imported (it lives in a `.test.ts`). Left uncommitted for SA code review |
| 2026-10-09 | SA code review | APPROVED WITH NITS. S2-1 to S2-4 verified in code. SQL desk-checked: Q11 `pg_depend` shape, `COLLATE "C"` on all 4 `string_agg`, DO blocks with direct booleans, TSV-derived `to_regprocedure` literals. PR #274 block proof re-read with `gh`. The two Windows gate failures are pre-existing (CRLF via autocrlf, backslash paths), and `Tests` is green on main `88b1938f`/`c0ae58bd`. Slice test 74/74, `test:authz-guard` 203/203. N-1: update inventory §6 row 6 (slice 6 done) in this PR |
| 2026-10-09 | QA (local PGlite) | PASS. Static test 74/74, authz guard 203/203. Pre-check CLEAN with Q5 `match` x13, also on an ICU `und` database (the mutation without `COLLATE "C"` reproduces `DIFFERS` x13). Checker 39/39, then 78/0; idempotent; both negative blocks give `42501` naming the function; rollback restores the pre-state row for row. Negatives fail safe: a missing function, a foreign grantor, a foreign owner. Q11 flags a column default (required by S2-1), a CHECK constraint, a view and a `BEGIN ATOMIC` caller; Q6 flags an INVOKER SQL caller. Prod steps still owed |
| 2026-10-09 | Prod apply and acceptance (user, recorded by TL) | pre-check CLEAN at 15:47 UTC (Q5 match and owner granted all x13, Q11 0 dependents; one Q6 caller, has_sufficient_credits calling get_user_credit_balance, both SECDEF owned by postgres, ok); migration applied 15:48 UTC; checker VERDICT PASS 78 pass 0 fail; negative calls 42501 for get_user_credit_balance (anon) and get_user_subscription_info (authenticated); signed-in smoke: no impact. Status set to applied and accepted |
