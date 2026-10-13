# Workplan: SECURITY DEFINER Lockdown, Slice 1 (drains, lock wrappers, no-arg mutator)

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Requirement:** [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) (FR-0.1 to FR-0.14, FR-1, §6, SA conditions C-1 to C-10)
**Evidence:** [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md), [secdef_prod_inventory_2026-10-07.tsv](/docs/investigations/secdef_prod_inventory_2026-10-07.tsv)
**Branch:** `fix/secdef-lockdown-slice-1` (worktree `neuronforge-secdef-s1`, off `origin/main` `d5f1efb1`)
**Migration number:** `20261044` (`20261041` and `20261042` are on main; `20261043` is claimed by open PR #256, checked 2026-10-07. Re-check at PR time, see T-9)
**Date:** 2026-10-07
**Status:** ✅ Done. PR #261 merged 2026-10-08 (merge `1299381a`); migration `20261044` applied on prod 2026-10-08 08:36 UTC; checker `VERDICT PASS 78 pass 0 fail`; acceptance recorded under [QA Testing Report](#qa-testing-report) (§ Prod apply and acceptance)

## Overview

Slice 1 removes client EXECUTE from the 13 SECURITY DEFINER functions with the worst exposure: the 10 queue `claim_due_*` / `reap_stale_*` functions, the two `public.pg_*` advisory-lock wrappers, and `auto_disable_ineffective_behavior_rules`. After it, only `service_role` (and the owner) can execute them. Every code caller already runs as `service_role` (SA verified against the code). The delivery is the five-file package of the 20261039/20261040 precedent, extended with in-transaction post-conditions: a read-only pre-check, one `BEGIN ... COMMIT` migration, a read-only checker ending in a VERDICT row, a rollback that restores the measured prod pre-state, and a static Jest test. No function body, table, policy or application code changes.

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

Identity types are the TSV `identity_args` with the parameter names removed. Grantees are the TSV `execute_grantees` (explicit ACL entries for EXECUTE). Every row has `x_public`, `x_anon`, `x_auth`, `x_service` all `t`, and `public_acl` `t`.

| # | Signature (prod identity) | TSV `identity_args` | TSV `execute_grantees` | `search_path` |
|---|---|---|---|---|
| 1 | `public.claim_due_daily_briefings(uuid, integer)` | `p_runner uuid, p_batch integer` | `PUBLIC postgres service_role` | `public` |
| 2 | `public.claim_due_insight_actions(uuid, integer)` | same | same | `public` |
| 3 | `public.claim_due_lead_responses(uuid, integer)` | same | same | `public` |
| 4 | `public.claim_due_payment_automation_executions(uuid, integer)` | same | same | `public` |
| 5 | `public.claim_due_payment_reminders(uuid, integer)` | same | same | `public` |
| 6 | `public.reap_stale_daily_briefings(integer, integer)` | `p_lease_seconds integer, p_max_attempts integer` | `PUBLIC postgres service_role` | `public` |
| 7 | `public.reap_stale_insight_actions(integer, integer)` | same | same | `public` |
| 8 | `public.reap_stale_lead_responses(integer, integer)` | same | same | `public` |
| 9 | `public.reap_stale_payment_automation_executions(integer, integer)` | same | same | `public` |
| 10 | `public.reap_stale_payment_reminders(integer, integer)` | same | same | `public` |
| 11 | `public.pg_try_advisory_lock(bigint)` | `lock_id bigint` | `PUBLIC postgres anon authenticated service_role` | none |
| 12 | `public.pg_advisory_unlock(bigint)` | `lock_id bigint` | `PUBLIC postgres anon authenticated service_role` | none |
| 13 | `public.auto_disable_ineffective_behavior_rules(integer, numeric)` | `p_min_applications integer, p_min_effectiveness numeric` | `PUBLIC postgres anon authenticated service_role` | none |

**Result: all 13 FR-1 signatures match the TSV exactly. No discrepancy.** Note that row 13 is `numeric` in prod while the repo source (`20260629_enhance_behavior_rules.sql`) says `decimal`; the migration uses `numeric` (FR-0.2).

Two grantee shapes exist, and they drive the rollback:

| Shape | Functions | How anon gets in today | Restore in rollback |
|---|---|---|---|
| A | rows 1 to 10 (claim/reap) | only through `PUBLIC` (an earlier migration revoked `anon, authenticated` but not `PUBLIC`) | `GRANT ... TO PUBLIC` |
| B | rows 11 to 13 | `PUBLIC` plus explicit `anon` and `authenticated` entries (Supabase default privileges, plus the explicit `TO authenticated` grant in `20260129_add_advisory_lock_functions.sql`) | `GRANT ... TO PUBLIC, anon, authenticated` |

The owner is **not** in the TSV (the inventory script computed `owner_name` but did not export it). `postgres` appears in every ACL, which is consistent with `postgres` ownership but does not prove it, so the pre-check measures it (C-3).

### 1.2 Callers (code side, from SA's review and re-checked)

| Function group | Code caller | Client | Cron route (schedule) |
|---|---|---|---|
| `*_daily_briefings` | `DailyBriefingSendRepository` via `DailyBriefingDispatchService` | `supabaseServer` | `/api/cron/daily-briefing` (`10 * * * *`) |
| `*_insight_actions` | `InsightActionRepository` via `InsightActionDispatchService.drainInsightActions` | `supabaseServer` | `/api/cron/insight-actions` (every 15 min) |
| `*_lead_responses` | `LeadResponseRepository` via `LeadResponseDispatchService` | `supabaseServer` | `/api/cron/lead-response` (every 5 min) |
| `*_payment_automation_executions` | `PaymentAutomationRepository` via `PaymentAutomationEngine` | `supabaseServer` | `/api/cron/payment-retry` (`0 * * * *`) |
| `*_payment_reminders` | `PaymentReminderRepository` via `PaymentReminderService` | `supabaseServer` | `/api/cron/payment-reminders` (`40 * * * *`) |
| `pg_try_advisory_lock`, `pg_advisory_unlock` | `lib/utils/distributedLock.ts:53,77,116` | module-level service-key client | used by `calibrate/resume` and `v2/calibrate/batch` |
| `auto_disable_ineffective_behavior_rules` | none | n/a | n/a |

`scripts/dev-payment-queue.ts` uses the service key. `AdminJobsQueuesRepository` only cites the names in text. No `supabase/functions` caller.

**Important for acceptance:** every one of the 10 repository wrappers **catches** an RPC error, logs it and returns an empty batch. A `permission denied` would therefore not fail the cron run: `bos_cron_runs.outcome` would still read `succeeded` with zero claimed. The logs, not the run record, are the authority (see §5.3).

### 1.3 SQL-side callers of the `pg_*` wrappers

`get_next_run_number` (`supabase/SQL Scripts/20260205_fix_run_number_race_condition.sql`) and the wrappers' own bodies call `pg_try_advisory_lock(...)` / `pg_advisory_unlock(...)` by **bare name**. `pg_catalog` is searched first implicitly, so a bare name resolves to the built-in, not to `public.pg_*`, and the revoke does not affect them. That holds unless a caller pins a `search_path` that names `pg_catalog` **after** `public`, or calls `public.pg_...` explicitly. The pre-check measures both (Q6 and Q10 below).

### 1.4 Skills consulted

| Skill | Applies? |
|---|---|
| `business-os-schema-check` | Yes, for every claim about a function: the TSV is the prod evidence, and the pre-check re-measures it before apply |
| `tenant-isolation-guard` | No new write path. The slice removes a cross-tenant path |
| `durable-queue-drain` | Read only: the claim/reap pattern is unchanged, only who may call it |
| `new-api-route`, `new-repository`, `new-plugin`, `bos-llm-call-standards`, `business-os-entitlements` | Not applicable. No TS source changes, no entitlements import |

No TS file is touched, so there is no `console.*` flag to raise.

---

## 2. Approach

### 2.1 Pre-check (read-only, single result set)

**File:** `scripts/precheck-secdef-lockdown-slice1.sql`

- First statement `SET default_transaction_read_only = on;`. Row 0 is `READ ME` with `this session is now read only so run the migration in a NEW tab` (precedent wording; the static test pins it).
- One `WITH ... SELECT sort_order, item, detail ... ORDER BY report.sort_order, report.item`.
- A `watched` VALUES CTE with `(fn_name, fn_signature, fn_order, expected_grantees)`, for example `('claim_due_daily_briefings', 'public.claim_due_daily_briefings(uuid, integer)', 1, 'PUBLIC postgres service_role')`. `fn_oid` is `pg_catalog.to_regprocedure(fn_signature)`.
- Rows per function, `sort_order = fn_order * 1000 + 10` to `+ 95` (Q1 = 10, Q2 = 20, ... Q5 grantors = 55, Q6 rows = 60/61, Q10 = 95; `PRECHECK STATUS` = 1, `checked at utc` = 99000):

| Item | What it reports | Expected on prod (2026-10-07) |
|---|---|---|
| `Q1 exists <fn>` | `present` or `MISSING stop here` | `present` x13 |
| `Q2 owner <fn>` | owner name, plus `stop here` unless `postgres` (C-3) | `postgres` x13 |
| `Q3 secdef <fn>` | `prosecdef`, and the `proconfig` search_path (informational) | `true`; search_path `public` for 1 to 10, `none` for 11 to 13 |
| `Q4 privileges <fn>` | `public X anon X authenticated X service_role X` from `has_function_privilege` | all `true` x13 |
| `Q5 grantees <fn> expected <TSV string>` | actual grantees from `aclexplode(COALESCE(proacl, acldefault('f', proowner)))` for EXECUTE, then `match` or `DIFFERS stop here rollback must change`. Compared as sorted sets, so ACL order does not matter (FR-0.5) | `match` x13 |
| `Q5 grantors <fn>` (W-1) | the grantor of every EXECUTE entry as `grantee by grantor` pairs, then `owner granted all` or `OTHER GRANTOR stop here`. A REVOKE by `postgres` removes only entries `postgres` granted, so an entry granted by `supabase_admin` would survive the revoke (the post-condition would then abort) and would break the exact-pre-state rollback | `owner granted all` x13 |
| `Q6 caller <schema> <proname> of <fn>` | one row per `pg_proc` (outside `pg_*` schemas and `information_schema`, excluding the function itself) whose `lower(prosrc)` contains the name: `secdef`, owner, `proconfig`, `qualified` (prosrc contains `public.<fn>`). Flagged `stop here` if (a) the caller is SECURITY INVOKER, or (b) it is SECDEF with an owner other than `postgres`. **Exception for 11 and 12:** a bare-name caller is not a caller of the wrapper, so it is flagged only if `qualified` is true or its pinned search_path names `pg_catalog` after `public` | claim/reap: no rows. `pg_*`: `get_next_run_number` (if in prod) and possibly other lock users, all bare-name, not flagged. Row 13: no rows |
| `Q6 callers count <fn>` | count of the above | 0 for 1 to 10 and 13 |
| `Q7 policy <table> <policy> of <fn>` | `pg_policies` rows whose `qual` or `with_check` names it, with `roles`. `stop here` if roles include `public`, `anon` or `authenticated` (service_role-only function) | none |
| `Q8 view <schema> <name> of <fn>` | `pg_views` and `pg_matviews` whose definition names it. Any row is `stop here` | none |
| `Q9 cron <fn>` | `cron not installed` when `to_regclass('cron.job')` is NULL; otherwise `NAMED stop here` or `none`, by searching the text of `query_to_xml('TABLE cron.job', true, false, '')`. The CASE guard means `cron.job` is only read when it exists (`query_to_xml` is not immutable, so it is never pre-folded) | `cron not installed` or `none` (the repo has no pg_cron job) |
| `Q10 bare name resolves <fn>` (11 and 12 only) | schema of `pg_catalog.to_regprocedure('pg_try_advisory_lock(bigint)')` and of the unlock twin | `pg_catalog` |

- **Name matching (W-2):** Q6 to Q9 match with `strpos(lower(<text>), <fn_name>) > 0`, never `LIKE` (a `%` literal is punctuation under C-7, and `_` is a LIKE wildcard).
- **Q9 scope:** its detail says `visible jobs only`, because Supabase RLS on `cron.job` shows only the applying role's jobs (SA optimisation note). The Q-2 bare-name rule also applies to cron command text.
- Row 1, `PRECHECK STATUS`: `CLEAN` when no row's detail contains `stop here`, else `STOP n rows need review`. A final row `checked at utc`.
- Expected on prod: `CLEAN`. Any difference is recorded in this workplan before apply (§6 acceptance, first bullet).

### 2.2 Migration

**File:** `supabase/migrations/20261044_secdef_lockdown_slice1_drains_locks.sql`

```sql
BEGIN;

REVOKE EXECUTE ON FUNCTION public.claim_due_daily_briefings(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_daily_briefings(uuid, integer) TO service_role;

(one REVOKE plus one GRANT per function, 13 pairs, in the §1.1 order)

DO $$
DECLARE
  slice_signature text;
  slice_function regprocedure;
BEGIN
  FOREACH slice_signature IN ARRAY ARRAY[
    'public.claim_due_daily_briefings(uuid, integer)',
    (the 13 signature literals)
  ]
  LOOP
    slice_function := pg_catalog.to_regprocedure(slice_signature);
    IF slice_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 function missing so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('public', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 public still executes so nothing was applied ' || slice_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', slice_function, 'EXECUTE') THEN
      (same, anon)
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', slice_function, 'EXECUTE') THEN
      (same, authenticated)
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', slice_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Slice 1 service_role lost EXECUTE so nothing was applied ' || slice_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
```

Decisions:

- **REVOKE list is always `PUBLIC, anon, authenticated`** (FR-0.1), even for shape A where `anon`/`authenticated` have no explicit entry. For the owner, revoking a privilege that was never granted is a silent no-op, and the uniform form is what the slice 6 guard will look for.
- **The `GRANT ... TO service_role` is functionally redundant** (service_role already holds an explicit entry on all 13, and REVOKE from PUBLIC does not touch it). It is kept because FR-0.1 mandates it and it makes the end state independent of history.
- **`REVOKE EXECUTE`, not `REVOKE ALL`.** EXECUTE is the only function privilege, so they are equivalent; EXECUTE matches FR-0.1 word for word.
- **Fail, never skip (C-2).** A wrong signature already fails at the REVOKE itself (`function does not exist`), which aborts the transaction. The DO block NULL check is the explicit C-2 guard on top.
- **Owner problem is self-detecting.** If the applier were not the owner, REVOKE would only warn; the post-condition would then see `PUBLIC` still true and raise, rolling back everything. The pre-check catches it earlier (C-3).
- **C-7:** no `SELECT` at all in the DO block (assignment and `IF [NOT] has_function_privilege(...)` only). RAISE prose is letters, digits, spaces and the role names; the signature is appended at runtime by concatenation, so no punctuation sits in a prose literal. No `%` placeholders.
- `pg_catalog.`-qualified built-ins inside the DO block (`to_regprocedure`, `has_function_privilege`) so nothing in `public` can shadow them, which is exactly the hazard this slice is about.
- The function names are `public.`-qualified everywhere. That is critical for 11 and 12: an unqualified `pg_try_advisory_lock(bigint)` would resolve to the `pg_catalog` built-in (R-7).

### 2.3 Checker (read-only, VERDICT first)

**File:** `scripts/check-secdef-lockdown-slice1-migration.sql`

- First statement `SET default_transaction_read_only = on;`.
- `slice_function` CTE from a VALUES list `(fn_name, fn_signature, fn_order)` of the 13, with `pg_catalog.to_regprocedure(fn_signature) AS fn_oid` and the owner via a `LEFT JOIN pg_proc`.
- `role_expectation` VALUES: `('public', false, 3)`, `('anon', false, 4)`, `('authenticated', false, 5)`, `('service_role', true, 6)`.
- Checks per function, `sort_order = fn_order * 100 + n`:

| Check | PASS when | Detail |
|---|---|---|
| `C1 exists <fn>` | `fn_oid IS NOT NULL` | `present` or `missing` |
| `C2 owner postgres <fn>` | owner is `postgres` | owner name, or `missing` |
| `C3 public <fn>` | `has_function_privilege('public', fn_oid, 'EXECUTE') IS FALSE` | `held X expected false` |
| `C4 anon <fn>` | same for `anon` `IS FALSE` | |
| `C5 authenticated <fn>` | same for `authenticated` `IS FALSE` | |
| `C6 service_role <fn>` | `has_function_privilege('service_role', ...) IS TRUE` | `held X expected true` |

- A missing function gives NULL from `has_function_privilege`; `IS FALSE` / `IS TRUE` turn that into **FAIL**, never a skip (C-2).
- Output `check_name, result, detail`, VERDICT row first (`sort_order` 0): `PASS` only if every check passes, detail `N pass M fail`. **Expected after apply: `VERDICT PASS 78 pass 0 fail`** (13 functions x 6 checks). Before apply, it reads FAIL with `39 pass 39 fail` (C1, C2 and C6 pass; C3 to C5 fail), which is a useful dry run.

### 2.4 Rollback

**File:** `supabase/SQL Scripts/20261044_secdef_lockdown_slice1_drains_locks_rollback.sql`

- `BEGIN;` then, from the TSV `execute_grantees` minus `postgres` (owner) and `service_role` (never revoked):
  - rows 1 to 10: `GRANT EXECUTE ON FUNCTION public.<sig> TO PUBLIC;`
  - rows 11 to 13: `GRANT EXECUTE ON FUNCTION public.<sig> TO PUBLIC, anon, authenticated;`
- A DO post-condition in the same style: each function exists, and `public`, `anon`, `authenticated` and `service_role` are all true (that is the measured pre-state for all 13).
- `COMMIT;`. No REVOKE. The rollback re-opens the hole on purpose; it exists only to recover a broken drain.
- After a rollback, re-running the pre-check must show Q4 all true and Q5 `match` x13, which proves the exact pre-state is back.

### 2.5 Static test

**File:** `supabase/migrations/__tests__/secdef-lockdown-slice1.migration.test.ts`. Asserts listed in §5.1.

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `scripts/precheck-secdef-lockdown-slice1.sql` | create | Read-only pre-check (FR-0.5, FR-0.10, FR-0.11) |
| `supabase/migrations/20261044_secdef_lockdown_slice1_drains_locks.sql` | create | The revoke, with in-transaction post-conditions (FR-0.1, FR-0.9, FR-0.12) |
| `scripts/check-secdef-lockdown-slice1-migration.sql` | create | Read-only checker, VERDICT first (FR-0.4) |
| `supabase/SQL Scripts/20261044_secdef_lockdown_slice1_drains_locks_rollback.sql` | create | Exact pre-state restore (FR-0.5) |
| `supabase/migrations/__tests__/secdef-lockdown-slice1.migration.test.ts` | create | Static asserts (FR-0.13, C-8) |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify (done) | FR-0.8, FR-1, C-1 now say `20261044`; Change History row. Later: slice 1 PR, merge and apply state (§6 acceptance, last bullet) |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify (done) | §6 number line and slice table row; Change History row |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md` | create | This workplan |

No TS source, no other migration, no CI workflow change. Slice 6 (the guard) is a separate PR right after this one.

---

## 4. Task list

- ✅ T-0: Branch confirmed (`fix/secdef-lockdown-slice-1`), requirement, inventory, TSV and the 20261039/20261040 and 20261041/20261042 packages read
- ✅ T-1: 13 signatures and grantee shapes verified against the TSV (§1.1)
- ✅ T-2: Requirement and inventory renumbered to `20261044` with Change History rows
- ✅ T-3: Workplan written
- ✅ T-4: SA workplan review (approved with conditions W-1 to W-7); conditions folded into §2.1, §5.1, §5.3, §6 and the QA section; FR-0.8 de-duplicated (W-6)
- ✅ T-5: Write the static test first, from §5.1, against the slice constant (it will fail until T-6 to T-8)
- ✅ T-6: Write the pre-check (§2.1)
- ✅ T-7: Write the migration (§2.2) and the rollback (§2.4)
- ✅ T-8: Write the checker (§2.3)
- ✅ T-9: Run `npx jest supabase/migrations/__tests__/secdef-lockdown-slice1.migration.test.ts`, plus `npm run test:authz-guard` and the purge `no-deletion-paths` guard (both scan SQL folders) as regressions. `npx tsc --noEmit` on the test file. Re-check the number: `git fetch origin` then list `origin/main` `supabase/migrations/2026104*` and open PRs touching `supabase/migrations/`; if `20261044` is taken, rename both SQL files, the test constants and the doc mentions **Done 2026-10-07:** new test 66/66; boost_packs 20261039/20261040 tests 71/71; `no-deletion-paths` guard, `business-os-credit-lots` and `testAccountCleanupSql` (the tests that reference 20261041/20261042) 195/195; `test:authz-guard` 119/119; `tsc --strict` on the test file clean; paste greps clean on all four SQL files (only the 4 Q-1 literals in the pre-check). Number: `20261043` is claimed by open PR #256, so slice 1 is `20261044`
- ✅ T-10: Hand to SA for code review, then to the user for the diff (left uncommitted). **Done:** SA approved with nits, user saw the diff, PR #261
- ✅ T-11: User runs §6 steps 1 to 4 on prod; record the pre-check output and VERDICT under QA Testing Report. **Done 2026-10-08**, see § Prod apply and acceptance
- ✅ T-12: QA confirms §5.3 acceptance; requirement updated with PR, merge and apply state. **Done 2026-10-08:** PR #261 merged (`1299381a`); requirement §4.3 slice status and inventory §6 updated. One acceptance source inconclusive (Supabase API-log path search), see § Prod apply and acceptance

---

## 5. Test plan

### 5.1 Static test asserts (C-8, FR-0.13)

The test holds one constant, `SLICE_1`, of the 13 `{ name, signature, rollbackGrantees }` entries.

**TSV cross-check** (makes "derived from the TSV" a test, not a promise):
- It parses `docs/investigations/secdef_prod_inventory_2026-10-07.tsv`, **`kind = fn` rows only** (W-5). For each `SLICE_1` entry: **exactly one** row with that `fn_name` exists (no overloads), its `identity_args` with parameter names stripped equals the signature's type list, and its `execute_grantees` minus `postgres` and `service_role` equals `rollbackGrantees`.

**All five SQL files (pasted by hand):**
- exist; no `--`; no `/*`; no `into` in any case; an even number of single quotes; no single-letter alias.
- "into" is banned as a case-insensitive **substring**, which is stricter than a word ban (W-5).
- Every single-quoted literal is either plain (letters, digits, underscores, spaces) or one of an **exact allow-list, pinned per file** (W-5, Q-1): the 13 `public.` signature literals (all four SQL files); plus, in the pre-check only, the two bare `pg_try_advisory_lock(bigint)` / `pg_advisory_unlock(bigint)` literals for Q10, `cron.job` and `TABLE cron.job`. Nothing else with punctuation passes (C-7).

**Migration:**
- First statement `BEGIN`, last `COMMIT`, exactly one of each. The DO block is cut out before splitting statements on semicolons.
- Exactly 13 REVOKE and 13 GRANT statements. Each REVOKE equals `REVOKE EXECUTE ON FUNCTION <sig> FROM PUBLIC, anon, authenticated` and each GRANT equals `GRANT EXECUTE ON FUNCTION <sig> TO service_role`, in pairs, in `SLICE_1` order.
- The set of `ON FUNCTION` signatures equals the `SLICE_1` set, and every `ON FUNCTION` is followed by `public.`.
- Exactly one DO block. Its array literal set equals the `SLICE_1` set. It contains the `IS NULL` raise, the three `IF pg_catalog.has_function_privilege('<role>'` checks for `public`, `anon`, `authenticated`, and `IF NOT pg_catalog.has_function_privilege('service_role'`. It contains no `SELECT`.
- No `ALTER`, `CREATE`, `DROP`, `SECURITY`, `search_path`, `REVOKE ALL`, `CASCADE` or table keyword. No other object.

**Rollback:**
- `BEGIN` / `COMMIT`; exactly 13 GRANT, each equal to `GRANT EXECUTE ON FUNCTION <sig> TO <rollbackGrantees>`; no REVOKE; one DO post-condition expecting all four roles true.

**Checker and pre-check:**
- First statement `SET default_transaction_read_only = on`; no write keyword (`INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE`), matched **at word boundaries**, so `grantees` and `grantor` in pre-check labels do not trip it (W-5).
- Checker: VERDICT row first and PASS only when every check passes; the four role expectations with the right polarity; `IS FALSE` / `IS TRUE` (NULL fails); owner `postgres`; signature set equals `SLICE_1`.
- Pre-check: the `NEW tab` READ ME text; the markers `Q1` to `Q10`, the `Q5 grantors` row (W-1) and `PRECHECK STATUS`; no `LIKE` anywhere (W-2); `to_regclass('cron.job')` guards the cron read; Q10 rows for both `pg_*` wrappers; expected-grantee strings equal the TSV strings; signature set equals `SLICE_1`.

### 5.2 What Jest cannot show

There is no branch database (FR-0.6), so execution is proven only on prod by the user, through the pre-check, the post-conditions and the checker.

### 5.3 Acceptance after apply (C-6, §6 S1)

Let T be the apply time (UTC). Wait at least **65 minutes**, so every drain has run at least once: lead-response (every 5 min), insight-actions (every 15), payment-retry (`:00`, drains payment automations), daily-briefing (`:10`), payment-reminders (`:40`).

1. **Logs, three sources (W-3).** "No errors" alone proves nothing, because a cron that never ran also shows zero errors. Read each source inside its retention window and record **counts**, not raw lines, in the QA report.
   - (a) **Supabase Logs Explorer, the authority.** In the API / edge logs since T, each of the 10 paths `/rest/v1/rpc/claim_due_*` and `/rest/v1/rpc/reap_stale_*` appears at least once with a 2xx status, and none with 401 or 403 (a service_role `42501` surfaces as a 403). In the Postgres logs since T, zero `permission denied for function`.
   - (b) **Vercel runtime logs (production), corroboration.** Search at T+65 min, not later (retention can be one hour). Zero hits for `permission denied for function`, `42501`, the ten repository messages (verified verbatim against the code): `Failed to claim due briefing sends`, `Failed to reap stale briefing sends`, `Could not claim insight actions`, `Could not reap stale insight actions`, `Could not claim lead responses`, `Could not reap stale lead responses`, `Failed to claim due executions`, `Failed to reap stale executions`, `Failed to claim due reminders`, `Failed to reap stale reminders`; and the lock messages `[DistributedLock] ❌ Error acquiring lock`, `Error during lock retry`, `Error releasing lock`.
   - (c) **Run record, necessary not sufficient.** `bos_cron_runs` (or `/admin/jobs-queues`) shows at least one run after T for each of `lead-response`, `insight-actions`, `payment-retry`, `daily-briefing` and `payment-reminders`. The repositories swallow RPC errors (§1.2), so `succeeded` alone does not prove the claim worked.
2. **Lock wrappers, no lock semantics (C-6, W-4).** Primary: the two SQL-editor snippets in the QA Testing Report section ("Lock check"), each in its own **new** tab, using `SET LOCAL ROLE` inside a transaction so that the role reverts even on error. Positive as `service_role`: no error. Negative as `anon`: `42501`. The checker's C6 already proves the grant, and the edge logs in 1(a) prove the PostgREST path for the drains.
3. **Optional curl.** Only in the user's own shell, reading the key from the user's local env file. The key is never pasted into chat, this workplan, the QA report or any committed file; only the HTTP status and body are recorded. Agents never handle the key.
4. `auto_disable_ineffective_behavior_rules` has no caller; the checker is its acceptance.
5. Optional: run the inventory script again; the anon-executable count drops from 68 to 55, and the non-trigger count from 50 to 37.

---

## 6. Apply order and rollback plan

All steps are run by the user in the Supabase SQL editor on prod (FR-0.6). Dev never connects to a database.

| Step | Where | Expect |
|---|---|---|
| 1. Pre-check | tab A | `PRECHECK STATUS CLEAN`, values as in §2.1. Paste the output under QA Testing Report. Any `stop here` row: stop and bring it to Dev/SA |
| 2. Migration | **new** tab B (tab A is read-only now) | `Success. No rows returned`. Any error means nothing was applied (single transaction) |
| 3. Checker | new tab C | `VERDICT PASS 78 pass 0 fail` |
| 4. Acceptance | Supabase Logs Explorer, Vercel logs, `bos_cron_runs`, lock-check snippets in new tabs | §5.3, read at T+65 min |
| 5. Merge | GitHub | After SA code review, QA pass and the user's approval (RM) |

**Rollback plan (W-7).** Roll back if any of these appears after T: a 401 or 403 on a slice-1 `/rest/v1/rpc/` path in the Supabase API / edge logs; `permission denied for function` in the Supabase Postgres logs or in Vercel; or any of the repository or lock error messages in §5.3 1(b). Then: paste the rollback in a new tab (it restores the TSV shapes and checks them in-transaction), re-run the pre-check (Q4 all true, Q5 `match` x13), then bring the failing caller to Dev. Rollback re-opens anon access, so it is a short bridge, not a resting state.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A caller not found in code (SQL, cron, external) loses access | Pre-check Q6 to Q9 (C-4); logs for one full cycle; rollback ready |
| R-2 | A drain failure is invisible in `bos_cron_runs` because the repositories swallow RPC errors | Acceptance reads the logs for the exact messages (§5.3 step 1) |
| R-3 | Unqualified `pg_*` name hits the `pg_catalog` built-in | `public.` everywhere, asserted by the static test; Q10 shows bare-name resolution |
| R-4 | Non-owner REVOKE only warns | Pre-check Q2; the post-condition raises if PUBLIC still executes, so nothing is half-applied |
| R-5 | The pre-check leaves its tab read-only | READ ME row; apply order says new tab |
| R-6 | The migration number is taken before merge | T-9 re-check at PR time |
| R-7 | SQL-editor paste bugs (`into`, comments, punctuation in literals) | Static test bans them, with an exact literal allow-list |

---

## 8. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | The pre-check needs four non-signature literals with punctuation: `cron.job`, `TABLE cron.job` (for `query_to_xml`), and the two bare `pg_*(bigint)` signatures for Q10. C-7 allows signature literals; are the `cron.job` relation literals acceptable (precedent: `to_regclass('operator_private.secrets')` in `20261042`)? | Allow exactly those, pre-check only, pinned by the static test |
| Q-2 | In Q6, a bare-name SQL caller of `pg_try_advisory_lock` / `pg_advisory_unlock` is treated as **not** a caller of the wrapper (it resolves to `pg_catalog`), unless it says `public.pg_...` or pins `public` before `pg_catalog`. Agree? | Yes, per SA's own S1 finding |
| Q-3 | Lock acceptance (C-6): curl with the service-role key (§5.3 step 3), or, in the SQL editor, `SET ROLE service_role`, call both wrappers, `RESET ROLE`? The second avoids handling the key but proves the grant, not the PostgREST path | curl, since it is the real path; SQL-editor form as a fallback, written in the QA section rather than as a sixth file |
| Q-4 | The rollback carries its own DO post-condition (all four roles true). The precedent rollback has none. Keep it? | Keep; it proves the exact pre-state in the same transaction |
| Q-5 | File names: `20261044_secdef_lockdown_slice1_drains_locks.sql` and the matching `scripts/precheck-secdef-lockdown-slice1.sql` / `scripts/check-secdef-lockdown-slice1-migration.sql`. Later slices would follow `secdef-lockdown-sliceN` | As proposed |

---

## SA Review Notes

**Reviewed by SA — 2026-10-07**
**Status:** ✅ APPROVED WITH CONDITIONS (W-1 to W-7). Dev may start T-5 once the conditions are folded into §2 and §5.

### Verified

1. §1.1: all 13 signatures and grantee strings match the TSV (`kind = fn` rows) exactly, including `numeric` on row 13 and `lock_id bigint` on 11 and 12. The two grantee shapes and their rollback grants are correct. Re-granting by `postgres` after the revoke rebuilds the exact pre-state ACL sets. — SA: resolved
2. §2.2: the REVOKE and GRANT forms match FR-0.1. Every name is `public.`-qualified. The DO block meets C-2 (it raises on NULL), C-7 (no `SELECT`, direct `IF [NOT] pg_catalog.has_function_privilege`), and the "into" ban (FOREACH, `USING MESSAGE`, the signature added at runtime). `pg_catalog.` qualification of the built-ins is correct. A non-owner REVOKE fails closed through the PUBLIC post-condition. — SA: resolved
3. §2.3: 13 x 6 = 78 checks. The pre-apply dry run at 39/39 is right. `IS FALSE` / `IS TRUE` turn a NULL into FAIL (C-2). `has_function_privilege` accepts `'public'`. — SA: resolved
4. §2.1: coverage meets C-3 (Q2 owner, plus the owner of SECDEF callers in Q6) and C-4 (Q6 to Q9: SECURITY INVOKER callers, policies, views, and cron guarded by `to_regclass`). `query_to_xml('TABLE cron.job', ...)` is a plain read, so it is legal in the read-only session. Its text is only parsed when the CASE branch runs. If the role cannot read `cron.job`, the pre-check errors loudly rather than skipping, which is acceptable. Residual risk: Supabase RLS on `cron.job` shows only the applying role's jobs. That is accepted, since the repo has no pg_cron jobs. — SA: resolved
5. §1.2 confirmed in code: all 10 repository wrappers catch the RPC error, log it and return empty or 0. `distributedLock.ts` uses its own service-key client. Lock ids from `keyToLockId` are 32-bit, so `7300000001` cannot collide with them. — SA: resolved
6. The number edits are targeted: `20261041` and `20261042` are both on `origin/main`, and only FR-0.8, FR-1, C-1, the inventory §6 line and table row, and one Change History row in each doc changed. — SA: resolved, with one cleanup (W-6)

### Conditions

1. **W-1 Grantor (pre-check Q5).** Report the grantor of every EXECUTE entry and flag `stop here` when it is not the owner. When `postgres` runs a REVOKE, it removes only the entries `postgres` granted. An `anon` entry granted by `supabase_admin` would survive, and then the post-condition aborts the apply. The rollback's "exact pre-state" claim also assumes the grantor is `postgres`.
2. **W-2 No LIKE patterns.** Q6 to Q9 match names with `strpos(lower(...), fn_name) > 0`, not `LIKE '%...%'`. A `%` literal is punctuation (C-7), and `_` is a LIKE wildcard.
3. **W-3 Acceptance logs (replaces §5.3 step 1).** "Absence of errors" alone does not prove anything: a cron that never ran also shows zero errors. Use two sources, read inside their retention window, and record the counts (not the raw lines) in the QA report.
   - (a) **Supabase Logs Explorer, the authority.** In the API / edge logs since T, each of the 10 paths `/rest/v1/rpc/claim_due_*` and `/rest/v1/rpc/reap_stale_*` appears at least once with a 2xx status, and none with 401 or 403. A service_role `42501` surfaces as a 403. In the Postgres logs since T, there are zero `permission denied for function`.
   - (b) **Vercel runtime logs (production), corroboration.** Zero hits for `permission denied for function`, `42501`, the 10 repository messages listed in §5.3 (verified verbatim against the code), and the lock messages `[DistributedLock] ❌ Error acquiring lock`, `Error during lock retry` and `Error releasing lock`. Vercel retention can be as short as one hour, so search at T+65 min, not later.
   - (c) `bos_cron_runs` shows at least one run after T for each of the 5 crons. This is necessary but not sufficient.
4. **W-4 Lock check (Q-3 ruling).** The primary check is the SQL editor, in its own **new** tab, using `SET LOCAL ROLE` inside a transaction so that the role reverts even on error.
   - Positive: `BEGIN; SET LOCAL ROLE service_role; SELECT public.pg_try_advisory_lock(7300000001); SELECT public.pg_advisory_unlock(7300000001); ROLLBACK;` Expect two booleans.
   - Negative: the same with `anon` and only the unlock call. Expect `42501`.
   - Write both, paste-safe, in the QA section. They are not a sixth file.
   - curl is optional. If used, the user's own shell reads the key from the user's local env file. The key is never pasted into chat, the workplan, the QA report or any committed file, and only the HTTP status and body are recorded. Agents never handle the key. The checker's C6 already proves the grant, and the edge logs in W-3(a) prove the PostgREST path for the drains.
5. **W-5 Static test details.**
   - Parse only `kind = fn` TSV rows, and assert exactly one row per slice name (no overloads).
   - Match write keywords at word boundaries (`\bGRANT\b`), so that `grantees` in the pre-check prose does not trip the ban.
   - Keep the "into" ban as a case-insensitive substring ban, which is stricter.
   - The allow-list (Q-1) is exact and pinned per file.
6. **W-6 Requirement FR-0.8 cleanup.** The edited cell says "takes the next free number at PR time against `origin/main`" twice. Keep one sentence.
7. **W-7 Rollback trigger scope.** §6 should also name the Supabase API 403 on a slice-1 path as a rollback trigger, not only `permission denied` in Vercel.

### Rulings on Dev's open questions

| # | Ruling |
|---|---|
| Q-1 | **Allowed**, as exactly `cron.job`, `TABLE cron.job`, `pg_try_advisory_lock(bigint)` and `pg_advisory_unlock(bigint)`, in the pre-check only, pinned by the static test. These are relation and signature literals, not prose, so they fall under C-7's signature allowance. No other punctuated literal is allowed |
| Q-2 | **Agreed.** A bare-name call resolves to `pg_catalog`, which is implicitly searched first, so it is not a wrapper caller. It is flagged only if it is `public.`-qualified or pins a `search_path` that lists `pg_catalog` after `public`. The same rule applies to `cron.job` command text in Q9 |
| Q-3 | **SQL editor `SET LOCAL ROLE` is primary; curl is optional** (W-4). The key-handling rule is absolute: the user runs it, and the key never passes through chat or files |
| Q-4 | **Keep** the rollback DO post-condition (all four roles true, C-2 NULL raise). Do not add one to the precedent's files retroactively |
| Q-5 | **Accepted.** `secdef-lockdown-slice<N>` for scripts and the test, and `<number>_secdef_lockdown_slice<N>_<scope>.sql` for SQL. Use `slice4a` / `slice4b` for the split slice |

### Adjusted items (marked by SA)

- §5.3 step 1 is replaced by W-3. §5.3 step 3 is replaced by W-4. §2.1 Q5 gains the grantor (W-1).

### Optimisation Suggestions

- The Q9 detail can say "visible jobs only", so that a reader does not over-trust `none`.
- When the slice 2 workplan comes, export `owner_name` (and grantor) in the inventory TSV so that the next slice's static test can cross-check them too.

### Approval

[x] Workplan approved with conditions W-1 to W-7. Proceed to implementation. SA code review checks each condition in the diff.

**Code Review by SA — 2026-10-07**
**Status:** ✅ Code Approved (with nits, none blocking)

### Conditions checked against the diff

| # | Result |
|---|---|
| W-1 | Met. Pre-check `Q5 grantors` (lines 185-202) lists `grantee by grantor` and flags any grantor other than the owner |
| W-2 | Met. Q6 to Q9 use `strpos(lower(...), ...)`; no `LIKE`/`ILIKE` in any file, pinned by the test |
| W-3 | Met. §5.3 step 1 is the three-source log acceptance, messages listed |
| W-4 | Met. The lock-check snippets in the QA section are the form SA ruled ("not a sixth file"); no literal, no comment, no "into". Accepted |
| W-5 | Met. `kind = fn` rows, exactly one per name, word-boundary write ban, "into" substring ban, per-file exact allow-list |
| W-6 | Met. FR-0.8 states the PR-time rule once |
| W-7 | Met. §6 names a Supabase API 401/403 on a slice-1 RPC path as a trigger |
| C-1 | `20261044` re-verified: `origin/main` tops at `20261042`; the only open PR touching `supabase/migrations/2026*` is #256 (`20261043`) |
| C-2 | Met. Migration and rollback raise on a NULL `to_regprocedure`; checker uses `IS TRUE` / `IS FALSE`, so NULL is FAIL |
| C-3, C-4 | Met. Q2 owner, Q6 caller owner/secdef, Q7 policies, Q8 views, Q9 cron behind `to_regclass` |
| C-7, C-8 | Met. Paste greps clean on all four SQL files (no `--`, `/*`, "into", LIKE); literals plain or on the allow-list |

### SQL desk-check (nothing has run yet)

- `has_function_privilege('public', <regprocedure>, 'EXECUTE')`: the unknown literal resolves to `name` (string category preferred over `oid`), `regprocedure` coerces implicitly to `oid`, and `'public'` maps to the PUBLIC pseudo-role. In the checker the VALUES `text` column casts implicitly to `name`. Correct.
- `pg_proc.oid = / IS DISTINCT FROM <regprocedure>` resolve to `oideq` through the binary-coercible cast. Correct.
- `to_regprocedure('public.x(uuid, integer)')` returns NULL for a missing function; all type names are valid, so it never throws.
- `aclexplode(COALESCE(proacl, acldefault('f', proowner)))`: NULL-safe for a missing function (`acldefault` is strict, and the CTE also filters `fn_oid IS NOT NULL`).
- `query_to_xml` is not immutable and `to_regclass` is stable, so the planner folds neither. The CASE short-circuits at runtime, and the `'TABLE cron.job'` text is parsed only when that branch runs.
- VALUES with NULL in the first rows of `bare_signature`: all literals are unknown, so the column resolves to `text`. UNION branches resolve to `integer, text, text`.
- Each file is one result set. `SET default_transaction_read_only = on` is the first statement, as in the 20261039/20261040 precedent.
- The migration cannot partially apply. A bad signature fails at its REVOKE; a non-owner revoke, or a surviving foreign-grantor entry, fails the DO post-condition. Either way the one transaction is lost and `COMMIT` becomes a rollback.
- The rollback recreates exactly the TSV shapes (A: `PUBLIC`; B: `PUBLIC, anon, authenticated`), with `postgres` as grantor. This assumes Q5 grantors reads `owner granted all`.

### Code Review Comments

1. `scripts/precheck-secdef-lockdown-slice1.sql:1` and `scripts/check-secdef-lockdown-slice1-migration.sql:1`: if the editor sends the paste as one implicit transaction, `default_transaction_read_only` protects only later transactions in that session, not the SELECT in the same paste. That is harmless here because both SELECTs are read-only by construction, and the READ ME / new-tab rule covers the real hazard. Informational only; keep the precedent. Priority: Low
2. Workplan §2.1 says `sort_order = fn_order * 100 + q`, and §2.2 sketches `'Slice 1 PUBLIC still executes'`. The code uses `fn_order * 1000 + 10..95` and `'Slice 1 public still executes'`. This is doc drift only; align the text when convenient. Priority: Low
3. `supabase/migrations/__tests__/secdef-lockdown-slice1.migration.test.ts:340-345`: the pre-check's expected-grantee strings are hard-coded from `rollbackGrantees`, not read from the TSV `execute_grantees`. The TSV block covers this indirectly, so it is fine. A direct TSV comparison would be one line stronger. Priority: Low
4. Q10 resolves the bare names under the SQL editor's `search_path`, not each caller's. Q6 `pins_public_first` covers the callers that matter, so Q10 is informational. Priority: Low

### Tests run by SA

- `npx jest supabase/migrations/__tests__/secdef-lockdown-slice1.migration.test.ts`: 66/66
- `npm run test:authz-guard`: 119/119

### Code Approved for QA: Yes

Next: user diff view, then the §6 steps on prod (pre-check CLEAN, Q5 grantors `owner granted all` before applying).

---

## QA Testing Report

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (static Jest) plus C (all five SQL files executed against a throwaway local PGlite database). Production was never touched.
**Focus:** security, schema
**Skipped:** prod apply and the §5.3 log acceptance, both owed by the user after apply
**Input source:** TL prompt

#### Fixture (PGlite 0.5.8 = Postgres 17, files in the QA scratchpad, nothing added to the repo)

Roles `anon`, `authenticated`, `service_role`, `supabase_admin`, `other_owner` and a non-superuser `migrator` (all NOLOGIN). The fixture sets `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role`, as Supabase does.

The 13 functions are SECURITY DEFINER, owned by `postgres`, with the prod signatures. Their bodies are shaped like the repo sources:
- claim/reap return `SETOF` minimal queue tables, run with `SET search_path = public`, and then get `REVOKE ALL ... FROM anon, authenticated`.
- The `pg_*` wrappers call the bare built-in and carry the explicit `authenticated, service_role` grant.

Also included: a bare-name SQL lock caller, `get_next_run_number`.

The resulting ACLs equal the TSV shapes, and pre-check Q5 reads `match` x13. Each "tab" is a fresh session.

#### Results

| # | Step | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | Static test `secdef-lockdown-slice1.migration.test.ts` | green | 66/66 | ✅ Pass |
| 2 | `npm run test:authz-guard` | green | 119/119 | ✅ Pass |
| 3 | Pre-check | `PRECHECK STATUS CLEAN` | CLEAN. Q2 `postgres ok` x13; Q3 secdef true x13; Q4 all true; Q5 `match` and `owner granted all` x13; Q6 `get_next_run_number ... bare name resolves pg_catalog ok`; Q9 `cron not installed`; Q10 `pg_catalog ok` x2 | ✅ Pass |
| 4 | Checker before | 39 pass 39 fail | `VERDICT FAIL 39 pass 39 fail`, and the failures are exactly C3/C4/C5 x13 | ✅ Pass |
| 5 | Migration (new tab) | success | success; every one of the 13 ACLs is now `postgres, service_role` | ✅ Pass |
| 6 | Checker after | `VERDICT PASS 78 pass 0 fail` | `VERDICT PASS 78 pass 0 fail` | ✅ Pass |
| 7 | Migration re-run | (info) | succeeds, so the migration is idempotent | ✅ Info |
| 8 | W-4 positive (`service_role`), Dev's block verbatim | no error | no error; `lock_taken true`, `lock_released true`; `current_user` back to `postgres` after ROLLBACK | ✅ Pass |
| 9 | W-4 negative (`anon`), Dev's block verbatim | 42501 | `42501 permission denied for function pg_advisory_unlock` | ✅ Pass |
| 10 | Extra negatives: `authenticated` calls `pg_try_advisory_lock`; `anon` calls `claim_due_payment_reminders`; `authenticated` calls `auto_disable_*` | 42501 | 42501 on all three | ✅ Pass |
| 11 | Extra positives: `service_role` calls `claim_due_payment_reminders`; `authenticated` calls `get_next_run_number` (bare-name lock caller) | works | both work, because the bare name resolves to `pg_catalog` | ✅ Pass |
| 12 | Rollback (new tab) | success, all four roles back | success; the in-transaction DO passed | ✅ Pass |
| 13 | Checker after rollback | pre-state | 39 pass 39 fail, row-for-row identical to step 4 | ✅ Pass |
| 14 | Pre-check after rollback | Q4 true, Q5 `match` x13 | CLEAN, Q5 `match` x13. The ACL entry order changed (PUBLIC moved from first to third), but the set is equal | ✅ Pass |
| N0 | Pre-check, then migration, as two runs in the **same** session | refused | `25006 cannot execute REVOKE in a read-only transaction`; nothing applied | ✅ Pass |
| N1 | One function missing (`auto_disable_*` dropped) | raise, apply nothing | Pre-check `STOP 6` (Q1 to Q5). Migration `42883 function ... does not exist`; ACLs unchanged; checker 36 pass 42 fail. The rollback also fails cleanly | ✅ Pass |
| N2 | `claim_due_lead_responses` owned by `other_owner`, applied by a **superuser** | pre-check flags it | Pre-check `STOP 2` (Q2 `other_owner stop here`, Q5 DIFFERS). A superuser acts as the owner, so the apply succeeds; the checker then fails only C2 (77 pass 1 fail) | ✅ Pass (flagged) |
| N3 | Same function, applied by a **non-superuser** `migrator` that owns the other 12 (this emulates Supabase `postgres`) | fails safe | `P0001 Slice 1 public still executes so nothing was applied public.claim_due_lead_responses(uuid, integer)`; ACLs unchanged | ✅ Pass |
| N3b | Control: the non-superuser owns all 13 | success | Migration and rollback both succeed. The checker fails only C2 x13, because the owner is named `migrator` (expected) | ✅ Pass |
| N4 | W-1: `anon` EXECUTE on `pg_advisory_unlock` granted by `supabase_admin` | flagged; fails safe | Pre-check `STOP 2` (Q5 `anon by supabase_admin ... OTHER GRANTOR stop here`). Migration `P0001 Slice 1 anon still executes so nothing was applied`; ACLs unchanged | ✅ Pass |
| N5 | Q6 to Q9 detection | flags real callers, ignores bare lock calls | Flagged: an INVOKER `claim_due_*` caller, a `public.`-qualified wrapper caller, a caller pinned to `search_path = public, pg_catalog`, a view over `reap_stale_*`, an `authenticated` policy calling `auto_disable_*`, and a `cron.job` naming `reap_stale_*`. Not flagged: bare-name `get_next_run_number`, and a cron job running bare `pg_try_advisory_lock` | ✅ Pass |

#### Gaps (not emulated)

1. PGlite's session user is always the bootstrap **superuser** `postgres`, and it cannot be renamed or demoted, so the main run applies as a superuser. N3 and N3b emulate Supabase's non-superuser `postgres` with `migrator`, so C2 reads `migrator` there.
2. Not emulated:
   - the PostgREST RPC path (401/403)
   - real `pg_cron` and the Supabase RLS on `cron.job`
   - the real `supabase_admin` default privileges
   - the real function bodies (the signatures, SECDEF and ACL shapes are faithful)

   PGlite is Postgres 17.x.
3. Still owed on prod by the user: the pre-check, the apply, the checker, the W-4 blocks in the SQL editor, and the §5.3 logs at T+65 min.

#### Issues found

- Bugs: none.
- **Prod pre-check 2026-10-08: Q5 false `DIFFERS` from a collation mismatch; sets identical; fixed.** All 13 Q5 grantee rows read `DIFFERS stop here` although actual and expected held the same roles. The actual list's `grantee_name` derives from type `name` (implicit C collation, so `PUBLIC` sorts before `anon`/`postgres`), while the expected list is plain text in the database default collation (en_US-like, `postgres` before `PUBLIC`). PGlite runs in C, so QA could not see it. Fixed by Dev: every `string_agg ... ORDER BY` in the pre-check now ends in `COLLATE "C"` (both Q5 grantee sides and the Q5 grantors display), and the static test asserts it (mutation-checked: removing one `COLLATE "C"` fails the test). Migration, rollback and checker unchanged. The pre-check must be re-run on prod.
- Edge case (informational, same as SA code-review note 1): if the pre-check and the migration are pasted into **one** run, the `SET default_transaction_read_only` does not block the migration, because the SET runs inside that run's own transaction. Confirmed locally. The documented new-tab order is safe (N0).

#### Final status

- [x] Every locally testable criterion passes. **QA verdict: PASS.** Ready for the user's diff review and approval. Prod acceptance (§5.3) follows the apply.

### Lock check (written by Dev per SA W-4, run by the user)

Paste each block in its own **new** SQL-editor tab, after the migration. They contain no string literal, no comment and no "into". The advisory lock is session-level, so the unlock call releases it; `ROLLBACK` reverts the role.

Positive, as `service_role`. Pass: no error. The editor may show only the result of the last statement, so the two booleans may not be visible; either value is fine (C-6).

```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.pg_try_advisory_lock(7300000001) AS lock_taken;
SELECT public.pg_advisory_unlock(7300000001) AS lock_released;
ROLLBACK;
```

Negative, as `anon`. Pass: `ERROR 42501 permission denied for function pg_advisory_unlock`.

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT public.pg_advisory_unlock(7300000001) AS lock_released;
ROLLBACK;
```

If either block fails with `permission denied to set role`, that is the editor role, not the slice: record it and fall back to the optional curl in §5.3.

| Check | Result |
|---|---|
| Lock check positive (service_role) | ✅ prod 2026-10-08: no error, `lock_released true` (local PGlite ✅ no error) |
| Lock check negative (anon, 42501) | ✅ prod 2026-10-08: `42501 permission denied for function pg_advisory_unlock` (local PGlite ✅ 42501) |

### Prod apply and acceptance (user, 2026-10-08)

| # | Step (§6 / §5.3) | Result |
|---|---|---|
| 1 | Pre-check | Owner (Q2), grantor (Q5 grantors) and caller (Q6 to Q10) checks all clean. Q5 grantees first read a **false** `DIFFERS` x13 from a collation mismatch; the sets were identical. Fixed in `bc93c3f1` (`COLLATE "C"` on every `string_agg ... ORDER BY`), see Issues found ✅ |
| 2 | Migration `20261044` | Applied 2026-10-08 **08:36 UTC** (11:36 local), new tab, success ✅ |
| 3 | Checker | `VERDICT PASS 78 pass 0 fail` ✅ |
| 4 | W-4 lock check | service_role: no error, `lock_released true`. anon: `42501 permission denied for function pg_advisory_unlock` ✅ |
| 5 | §5.3 1(c) run record | `bos_cron_runs` since apply: lead-response 25, insight-actions 8, payment-reminders 3, daily-briefing 2, payment-retry 2 runs, all `succeeded` / HTTP 200. Queues were empty (claimed 0), so the runs prove the drains ran, not that a claim returned rows ✅ |
| 6 | §5.3 1(a) Postgres logs | 0 `permission denied for function` since apply ✅ |
| 7 | §5.3 1(a) API / edge logs by path | **Inconclusive.** The filter UI could not search the path field, and Logs Explorer was not reachable. Not a failure signal: steps 3, 4 and 6 cover the privilege outcome; the run-record gap (swallowed RPC errors, §1.2) is covered by step 6 ⚠️ |

**Verdict:** slice 1 accepted. 13 functions closed; prod anon-executable SECURITY DEFINER count is now 55 (non-trigger 37), by arithmetic from the 2026-10-07 inventory (68 and 50), not by a re-run of the inventory script.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-07 | Created (Dev) | Slice 1 workplan: 13 signatures verified against the prod TSV (no discrepancy), two grantee shapes drive the rollback, five-file package with in-transaction post-conditions, pre-check per C-3/C-4, checker expecting 78 pass, acceptance by logs because the drains swallow RPC errors. Migration number moved to `20261043` (`20261042` taken on main); requirement and inventory updated. 5 open questions for SA |
| 2026-10-07 | SA workplan review | APPROVED WITH CONDITIONS W-1 to W-7: grantor in pre-check Q5, `strpos` instead of LIKE, acceptance led by Supabase API and Postgres logs (Vercel logs read at T+65 min), lock check via `SET LOCAL ROLE` in the SQL editor (curl optional, the user's shell only), static-test parsing details, FR-0.8 duplicated sentence, rollback trigger scope. Q-1 to Q-5 ruled |
| 2026-10-07 | SA conditions folded in; number moved again (Dev) | W-1 grantor row in pre-check Q5; W-2 `strpos(lower())` matching, Q9 says visible jobs only; W-3 three-source log acceptance with the verbatim messages; W-4 SET LOCAL ROLE lock check written in the QA section (no sixth file); W-5 static test rules; W-6 requirement FR-0.8 de-duplicated; W-7 rollback triggers include a Supabase API 401/403. Migration number now `20261044`, because `20261043` is claimed by open PR #256 |
| 2026-10-07 | Implementation T-5 to T-9 (Dev) | Five files written under `20261044`; static test parses the TSV `kind = fn` rows; all regression suites green. Left uncommitted for SA code review |
| 2026-10-07 | SA code review | APPROVED WITH NITS: W-1 to W-7 and C-1/C-2/C-3/C-4/C-7/C-8 met; `20261044` re-verified against `origin/main` and open PRs; SQL desk-checked (privilege-function arg resolution, regprocedure/oid, aclexplode, CASE-guarded `query_to_xml`, single transaction); 4 low-priority notes; slice test 66/66, authz guard 119/119 |
| 2026-10-07 | QA (local PGlite execution) | PASS. All five SQL files executed on a throwaway PGlite (Postgres 17) fixture with the prod ACL shapes: pre-check CLEAN, checker 39/39 before and 78/0 after, rollback restores the pre-state, W-4 blocks behave as specified. Negatives (missing function, other owner, non-superuser applier, foreign grantor, callers/views/policies/cron) all fail safe or get flagged. No bugs; prod steps still owed |
| 2026-10-07 | SA code-review nits 2 and 3 (Dev) | §2.1 sort keys and §2.2 RAISE text aligned with the code; the static test now compares the pre-check expected-grantee strings directly against the TSV `execute_grantees`. SQL files unchanged |
| 2026-10-08 | Prod pre-check fix (Dev) | Q5 grantees read DIFFERS x13 on prod though the sets matched: C-collated actual vs default-collated expected ordering. All pre-check `string_agg` orderings now `COLLATE "C"`; static test pins it (67/67). Migration, rollback, checker unchanged |
| 2026-10-08 | Slice 1 done (Dev) | PR #261 merged 2026-10-08 (`1299381a`). User applied `20261044` on prod at 08:36 UTC; checker PASS 78/0; W-4 lock check service_role ok, anon 42501; `bos_cron_runs` all 5 drains ran and succeeded since apply (queues empty); Postgres logs 0 permission-denied; API-log path search inconclusive (UI limits). T-10 to T-12 closed; status Done |
