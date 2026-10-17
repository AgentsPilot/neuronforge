# Workplan: Business OS Finance & Business Health — Slice 8.1 (history snapshots migration)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md). This workplan covers slice **8.1 only**:
- §11M.6 (the migration), the 8.1 parts of §11M.9 (checks 31 and 32, the local self-test), the 8.1 rows of §11M.10;
- AC-273 to AC-277, plus AC-293 for 8.1;
- L-155 (the user's hand apply);
- the SA Requirement Review — Slice 8 (SA-RR-8), with E-85 to E-88 applied. 8.1 is touched by E-86 (dimension CHECK, shape constant, self-test cases) and E-88 (the returning insert in the self-test).
**Branch:** `feature/bos-finance-health-8` (worktree `neuronforge-finance-m8`, cut from the DF-6 tip `f6182697`; #450 merging to main). Confirmed with `git branch --show-current`.
**Status:** Code Complete (SA-WR-8.1 approved with conditions 8.1-R1 to 8.1-R4; awaiting SA code review; then the user applies 20261078 by hand, L-155)

**Decisions in force:**
- BD-33: the fast track does **not** cover a production migration. 8.1 stops for the user (L-155), its PR is **off auto-merge**, and RM merges it by hand after "applied".
- BQ-17 (daily), BQ-18 (keep forever), BQ-19 (no backfill): defaults, not blocking.
- SA rulings SA-Q100 (long table), SA-Q101 (shape-only CHECKs), SA-Q102 (PostgREST insert, no function), SA-Q104 (keep the `day_ended` CHECK, expression ruled), SA-Q107 (8.1 migration-gated, merged by hand).

## Overview

8.1 adds one append-only, server-only table, `public.business_os_finance_snapshots`. Each row is one platform figure (a count of accounts or an amount of credits) for one UTC day. The slice also adds the scripts that let the user apply it safely: a pre-check, a post-apply checker, a refusing rollback, and a local-only self-test on PGlite 0.5.8. Finally it adds the data classification entry and the migration source test.

**There is no writer, read, route, cron or UI in 8.1** (those are 8.2 and 8.3). No existing table, function or migration is changed, and the test-account cleanup function needs no new version (§8.1).

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Files to Create / Modify](#files-to-create--modify)
- [1. The migration DDL](#1-the-migration-ddl)
- [2. The rollback](#2-the-rollback)
- [3. Check 31: pre-check](#3-check-31-pre-check)
- [4. Check 32: post-apply checker](#4-check-32-post-apply-checker)
- [5. The local self-test](#5-the-local-self-test)
- [6. The PGlite run and the mutations](#6-the-pglite-run-and-the-mutations)
- [7. Guard and test edits, line by line](#7-guard-and-test-edits-line-by-line)
- [8. The test-account cleanup function: no new version](#8-the-test-account-cleanup-function-no-new-version)
- [9. User apply runbook](#9-user-apply-runbook)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

I read these myself on 2026-10-17: the code in this worktree, and the #447 branch (`origin/feature/bos-finance-health-4b`, still OPEN) for the house style.

| # | Fact | Where | Consequence |
|---|---|---|---|
| VL-1 | The highest migration on `origin/main` is `20261071`. `20261072` and `20261073` exist only on #447, which is open | `supabase/migrations/`, `git ls-tree origin/feature/bos-finance-health-4b`, `gh pr view 447` | `20261078` is free. RM re-checks the number when the PR opens |
| VL-2 | **House style of `20261072`:**<ul><li>no header comment;</li><li>`BEGIN;` then `SET LOCAL lock_timeout = '5s';`;</li><li>`CREATE TABLE` with the pkey `CONSTRAINT … PRIMARY KEY (id)` inline;</li><li>one `ALTER TABLE … ADD CONSTRAINT … CHECK` per rule;</li><li>`CREATE UNIQUE INDEX`;</li><li>`COMMENT ON TABLE` written with double spaces in place of punctuation;</li><li>`ENABLE ROW LEVEL SECURITY`;</li><li>four separate `REVOKE ALL … FROM` statements;</li><li>`GRANT SELECT`, then a column-list `GRANT INSERT (…)`;</li><li>`NOTIFY pgrst, 'reload schema';` then `COMMIT;`</li></ul> | `git show …4b:supabase/migrations/20261072_business_os_boost_reversal_events.sql` | Copied, except for the lock and refusal blocks, which exist there to protect an existing table. **The `NOTIFY` line is not in the §11M.6 order** (SA-W-8.1-1) |
| VL-3 | The `20261072` rollback has: lock, then a `DO $refuse$` block that raises `ROLLBACK REFUSED … nothing was changed` if any row exists, then `DROP TABLE`, `NOTIFY`, `COMMIT` | `supabase/SQL Scripts/20261072_…_rollback.sql` (#447) | The same shape, without the function restore |
| VL-4 | **House pre-check / checker:**<ul><li>a `with t as (select to_regclass(…) as tbl)` CTE;</li><li>one `select '<item>' as item, <bool> as ok from t` per row, joined by `union all`;</li><li>`coalesce(…, false)` so a missing table gives `false`, never NULL;</li><li>a comment header of three or four lines</li></ul>The 4b pre-check adds a third column, `found` | `scripts/precheck-bos-boost-reversal-events.sql`, `scripts/check-bos-boost-reversal-events-migration.sql` (#447) | Checks 31 and 32 are taken as §11M.9 writes them (two columns). No `found` column is needed: nothing is counted |
| VL-5 | **House self-test:**<ul><li>one `DO $selftest$` block, with three local-only guards first (`bos.selftest_local` must be `on`, `auth.refresh_tokens` must be absent, the transaction must not be read only) and a "migration applied" guard;</li><li>`SET LOCAL ROLE service_role` and `anon` / `authenticated` (with JWT claims);</li><li>each case raises `SELFTEST FAIL <case> …`;</li><li>sub-blocks catch `insufficient_privilege`, `unique_violation` and `check_violation`;</li><li>it ends with `RAISE NOTICE 'SELFTEST PASS n cases …'` and `set_config('bos.selftest_report', …)`</li></ul> | `scripts/test-bos-boost-reversal-events.sql` (#447) | Copied. Cases S-01 to S-22 (§5) |
| VL-6 | **The PGlite harness already exists** in this session's scratchpad: `pglite/h4b1.mjs` with `@electric-sql/pglite` **0.5.8** installed there. It sets up the roles `anon`, `authenticated` and `service_role` (NOLOGIN, `service_role` BYPASSRLS), the Supabase-style `ALTER DEFAULT PRIVILEGES … GRANT ALL … TO anon, authenticated, service_role`, and the `auth` stubs. There is no `auth.refresh_tokens` | `…\scratchpad\pglite\h4b1.mjs` | Copied as `pglite/h81.mjs`. Never added to `package.json` |
| VL-7 | **Descriptor precedent:** `never('bos_cron_runs', G, exclude(EXPORT_REASON.PLATFORM), '<notes>')` at `descriptors.ts:1475`; `G = { kind: 'global' }` at `:1365`; `EXPORT_REASON.PLATFORM` at `:69` | `lib/business-os/purge/descriptors.ts` | One new `never` entry, next to `bos_cron_runs` |
| VL-8 | **The count pins that a new descriptor trips:**<ul><li>`classification-baseline.json` `"count": 155` (`:3`), its `levels` map, and a dated `reviewNotes` entry;</li><li>`descriptors.invariant.test.ts:870` `expect(baseline.count).toBe(155)`, plus `:745-751` "every descriptor is in the baseline";</li><li>`exportClassification.test.ts:296` and `:1329` `toHaveLength(155)`, and `:1330` `kinds` `{ include: 38, planned: 0, exclude: 117 }`, with the test title "155 = 38 include + 0 planned + 117 exclude" at `:1321`</li></ul> | the three files | Each is updated by one (155 → 156, 117 → 118), with a dated comment, as 4b.1 did (its §8.2, §8.3, §8.5). **None of these is in §11M.10** (SA-W-8.1-3) |
| VL-9 | **#447 also moves these counts to 156** (`business_os_boost_reversal_events`, `exportClassification.test.ts:296` `156` on its branch) | `git show …4b:…exportClassification.test.ts` | Whichever PR lands second takes 157 / 119 when it rebases (Risk R-2) |
| VL-10 | `businessOwnedTables.test.ts` asks only that a table **with a `user_id` column** be classified. It finds them with a crude scan: a CREATE TABLE body, up to the `);`, that mentions `user_id` | `lib/business-os/__tests__/businessOwnedTables.test.ts:40-60` | The new table has no `user_id`, so this test asks nothing of it. The `CREATE TABLE` statement must not even contain the word. CF-8 says this test is what checks the new table; it is in fact the baseline and the invariant test (VL-8) |
| VL-11 | `npm run test:bos-entitlements` runs `supabase/migrations/__tests__`, `descriptors.invariant.test.ts` and `businessOwnedTables.test.ts`, among others | `package.json:23` | The new migration test and the baseline edit run in that gate. No entitlements import is added, so the importer registry is not touched |
| VL-12 | **Cleanup generator inputs:** `buildCleanupPlan()` takes:<ul><li>`descriptorsForRun('purge', …)` (deletable descriptors only, so a global `never` is excluded);</li><li>the hand list `FULL_REMOVAL_EXTRAS`;</li><li>`FINAL_STEPS`</li></ul>`tenancyForeignKeys()` comes from that plan. The reviewed inbound-link list names FKs into removed tables (20261073 added `business_os_boost_reversal_events_purchase_id_fkey` for that reason). The drift test regenerates every SQL file and fails on any difference | `scripts/generate-test-account-cleanup-sql.ts:150-260, :565-600`; `scripts/__tests__/testAccountCleanupSql.test.ts:147-235` | §8: no new cleanup version |
| VL-13 | The migration source-test precedent for a platform table is `bos-cron-runs.migration.test.ts`: it LF-normalises, strips comments, slices `createTable(name)`, pins the grants, and pins the rollback | `supabase/migrations/__tests__/bos-cron-runs.migration.test.ts` | Same helpers |
| VL-14 | **There is no builder in 8.1.** E-86 and AC-276 want "the dimension CHECK pinned equal to the builder's exported shape constant", but the builder (`financeSnapshot.ts`) is 8.2 | §11M.6, §11M.7 HS-FR-4 | SA-W-8.1-2: 8.1 creates only the shape constants, in a tiny pure module that 8.2's builder will import |
| VL-15 | Pins at Step 0 (LF-normalised SHA-256), all equal to the DF-6 handover: AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`, Pin A `30f5fc24…2e01`, Pin B `24ff0da7…df9f`, Pin C `98ea0507…1e4b`, helper `02813360…5bd8`, Pin D `1f7cf07a…f144` | DF-6 handover | Re-hashed at Step 0 and at handover. 8.1 touches no finance page or route file |

---

## Scope

| In | Out |
|---|---|
| Migration `20261078_business_os_finance_snapshots.sql`<br>Rollback, check 31, check 32<br>The local self-test and its PGlite run<br>The shape constants module<br>The purge / export descriptor and the three count pins<br>The migration source test<br>The user apply runbook | The writer, builder, wiring, cron, `vercel.json` and registry (8.2)<br>Checks 33 and 34 (8.2)<br>Reads, route and UI (8.3)<br>Any existing table, function or migration<br>The cleanup function (§8)<br>`USER_OWNED_TABLES` (HS-W-8)<br>Pruning (BQ-18) |

---

## Questions for SA before code

| # | Question | Dev suggestion |
|---|---|---|
| **SA-W-8.1-1** (VL-2) | §11M.6's statement order ends `GRANT INSERT … → COMMIT` and omits the `NOTIFY pgrst, 'reload schema';` that `20261072` and its rollback both carry | **Add it**, before `COMMIT` in both the migration and the rollback. Otherwise PostgREST may not see the table until its next schema reload, and 8.2's first `upsert` could fail with "relation not found in schema cache". The migration test pins it |
| **SA-W-8.1-2** (VL-14) | The CHECK must equal "the builder's exported shape constant", but the builder is 8.2 | 8.1 adds `lib/business-os/finance/financeSnapshotShape.ts`. It is pure, with no import, and exports exactly `SNAPSHOT_METRIC_SHAPE = /^[a-z][a-z0-9_]{0,47}$/` and `SNAPSHOT_DIMENSION_SHAPE = /^([a-z][a-z0-9_]{0,47}\|tier:[a-z0-9_-]{1,40})$/`. The migration test pins each CHECK's pattern text equal to `.source`. A second test pins the tier branch equal to the tier part of `FINANCE_GROUP_SHAPE` (`tier:[a-z0-9_-]{1,40}`), so a tier key the page accepts is never refused here. 8.2's builder imports both constants; no second copy is allowed. The alternative is to defer the pin to 8.2, which leaves the CHECK unpinned between the apply and 8.2 |
| **SA-W-8.1-3** (VL-8, VL-9) | The count pins a new descriptor trips are not listed in §11M.10 | Update them as 4b.1 did, one line each, with a dated comment: baseline `count` 156, `levels` entry `"never"`, `reviewNotes` `"2026-10-17 8.1: …"`; invariant `toBe(156)`; export `toHaveLength(156)` ×2, `exclude: 118`, and the title. These are ordinary count pins, not frozen pins. If #447 merges first, rebase and use 157 / 119 |
| **SA-W-8.1-4** | Check 32's row "dimension check admits tier keys" only tests `like '%tier:%'`. A CHECK that kept `tier:` but lost the hyphen (`tier:[a-z0-9_]{1,40}`) would still pass the checker | Strengthen the row to `like '%tier:[a-z0-9_-]{1,40}%'` (as `pg_get_constraintdef` prints it, confirmed on PGlite) and add a row "dimension check refuses a bare uuid shape", tested by the self-test (S-09). Check text is BA's: SA to rule. If not accepted, the self-test's S-08 is the only catch, recorded as a known gap |
| **SA-W-8.1-5** | Check 31's row "cron run record installed" asks for `bos_cron_runs`, which 8.1 does not need (8.2's job does) | Keep it: it is true on production today, and failing early is cheaper. In PGlite I apply `20261011` (or stub the table) before running check 31 |

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `supabase/migrations/20261078_business_os_finance_snapshots.sql` | The table (§1) |
| `supabase/SQL Scripts/20261078_business_os_finance_snapshots_rollback.sql` | Refusing rollback (§2) |
| `scripts/precheck-bos-finance-snapshots.sql` | Check 31 (§3) |
| `scripts/check-bos-finance-snapshots-migration.sql` | Check 32 (§4) |
| `scripts/test-bos-finance-snapshots.sql` | Local-only self-test, S-01 to S-22 (§5) |
| `lib/business-os/finance/financeSnapshotShape.ts` | The two shape constants (SA-W-8.1-2) |
| `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts` | Source test (§7.5) |

### Modify

| File | Anchor | Change |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | after `:1476` (the `bos_cron_runs` entry) | One `never(…)` entry (§7.1) |
| `lib/business-os/purge/__tests__/classification-baseline.json` | `:3`, `levels`, `reviewNotes` | count 156, level, dated note (§7.2) |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | `:861-870` | comment line and `toBe(156)` (§7.3) |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | `:296`, `:1319-1330` | 156, `exclude: 118`, the title and its comment (§7.4) |

**Not touched** (checked with `git diff --exit-code` at handover):
- every existing migration and `supabase/SQL Scripts/` file;
- `scripts/generate-test-account-cleanup-sql.ts` and its five generated files;
- `lib/business-os/businessOwnedTables.ts`;
- every `app/` and `lib/business-os/finance/` file except the new shape module;
- the seven pin files;
- `package.json` and the lockfile.

---

## 1. The migration DDL

**File:** `supabase/migrations/20261078_business_os_finance_snapshots.sql` (exact text; ASCII; no comment line; no apostrophe inside a string; the editor word never appears)

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_finance_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  as_of_date date NOT NULL,
  metric text NOT NULL,
  dimension text NOT NULL,
  unit text NOT NULL,
  value numeric(18,6) NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_finance_snapshots_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_metric_shape CHECK (metric ~ '^[a-z][a-z0-9_]{0,47}$');

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_dimension_shape CHECK (dimension ~ '^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$');

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_unit_known CHECK (unit IN ('accounts', 'credits'));

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_value_not_negative CHECK (value >= 0);

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_accounts_whole CHECK (unit <> 'accounts' OR value = trunc(value));

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_day_ended CHECK (taken_at >= ((as_of_date + 1)::timestamp AT TIME ZONE 'UTC'));

CREATE UNIQUE INDEX business_os_finance_snapshots_day_metric_key ON public.business_os_finance_snapshots (as_of_date, metric, dimension);

COMMENT ON TABLE public.business_os_finance_snapshots IS 'One row per platform figure per UTC day  as_of_date is the day whose end the state describes  Counts of accounts and amounts of credits only  No money and no account  Append only  Written only by the nightly finance snapshot job  Server only with no client grant  Never purged';

ALTER TABLE public.business_os_finance_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM anon;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM authenticated;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM service_role;

GRANT SELECT ON TABLE public.business_os_finance_snapshots TO service_role;

GRANT INSERT (as_of_date, metric, dimension, unit, value) ON TABLE public.business_os_finance_snapshots TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

Notes:
- **No `CREATE POLICY`, trigger, function, sequence or other index.** The unique index is the `ON CONFLICT` target and serves the date-range read.
- The `REVOKE … FROM service_role` comes before the grants, so Supabase's default `GRANT ALL` to `service_role` does not survive. That is the only way the "cannot update or delete" rows can hold.
- The `day_ended` expression is SA-Q104's. `date + integer` gives a date; the cast and `AT TIME ZONE` with a literal zone are deterministic. PGlite proves both the refusal (S-11) and the acceptance (S-01).
- The `CREATE TABLE` statement has no `user_id` token (VL-10), and the comment says "no account" rather than naming the column.
- Line endings follow the working tree (CRLF on this checkout, like `20261072`). Every text test LF-normalises.

## 2. The rollback

**File:** `supabase/SQL Scripts/20261078_business_os_finance_snapshots_rollback.sql`

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_finance_snapshots IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_finance_snapshots) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the finance snapshots table holds history that cannot be rebuilt  fix forward with a new migration  nothing was changed';
  END IF;
END
$refuse$;

DROP TABLE public.business_os_finance_snapshots;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- It refuses while any row exists. That is AC-275 and §11M.6: the history cannot be rebuilt (CF-1, CF-2), so a defect is fixed forward.
- On an absent table the `LOCK` fails with `42P01` and nothing changes. The runbook only uses the rollback straight after a failed check 32.

## 3. Check 31: pre-check

**File:** `scripts/precheck-bos-finance-snapshots.sql`, copied from §11M.9 byte for byte (comment header included).

| # | Row (`item`) | Expected on production before the apply | Expected after the apply |
|---|---|---|---|
| 1 | snapshots table absent | `true` | `false` |
| 2 | snapshot key index name free | `true` | `false` |
| 3 | no constraint already uses the snapshot table name | `true` | `false` |
| 4 | service_role exists and bypasses row level security | `true` | `true` |
| 5 | gen_random_uuid is available | `true` | `true` |
| 6 | cron run record installed | `true` | `true` |

**Expected: 6 rows, all `ok = true`.** Before the apply, any false row means stop.

## 4. Check 32: post-apply checker

**File:** `scripts/check-bos-finance-snapshots-migration.sql`, copied from §11M.9, plus SA-W-8.1-4 if it is accepted.

| # | Row (`item`) | What makes it false |
|---|---|---|
| 1 | table exists | not applied |
| 2 | row level security on | RLS missing |
| 3 | no policy on the table | any `CREATE POLICY` |
| 4 | anon has no privilege on the table or any column | any anon grant |
| 5 | authenticated has no privilege on the table or any column | any authenticated grant |
| 6 | service_role can select | SELECT missing |
| 7 | service_role can insert exactly five columns | column list not exactly five |
| 8 | service_role cannot set id or taken_at | either column insertable |
| 9 | service_role cannot update | table or column UPDATE |
| 10 | service_role cannot delete or truncate | DELETE or TRUNCATE kept (for example the revoke from `service_role` missing) |
| 11 | seven columns and no user_id column | column drift |
| 12 | unique key on day, metric and dimension, not partial | index missing, renamed or partial |
| 13 | the six checks are present | any CHECK missing or renamed |
| 14 | dimension check admits tier keys (E-86) | the tier branch missing (with SA-W-8.1-4: or the hyphen dropped) |
| 15 | no trigger on the table | any trigger |
| 16 | table comment present | no comment |
| 17 | *(only if SA-W-8.1-4 is accepted)* dimension check refuses a bare uuid shape | the dimension pattern widened |

**Expected: 16 rows (17 with SA-W-8.1-4), all `ok = true`.** Before the apply, row 1 is false and every `coalesce(…, false)` row is false. Rows 4, 5, 9 and 10 use `not coalesce(…, true)`, so they read `false` before the apply too.

## 5. The local self-test

**File:** `scripts/test-bos-finance-snapshots.sql`. One `DO $selftest$` block in the VL-5 shape. Guards come first:
1. `bos.selftest_local` must be `on`;
2. `auth.refresh_tokens` must be absent;
3. the transaction must not be read only;
4. the table must exist ("apply migration 20261078 first").

The cases run as `postgres` unless a role is named. `D` is a fixed past date (`current_date - 3`), so `taken_at = now()` is after the day's end.

| Case | AC | Steps | Expectation |
|---|---|---|---|
| S-01 | 276 | As `service_role`: insert `(D, 'accounts_total', 'all', 'accounts', 12)` and `(D, 'credit_used', 'all', 'credits', 1234.567891)` | Both stored. `taken_at` = the transaction's `now()`; `id` is not null |
| S-02 | 276 | As `service_role`: the same key again, with value 99, `ON CONFLICT (as_of_date, metric, dimension) DO NOTHING` | 0 rows added; the stored value is still 12 (idempotent, first row stands) |
| S-03 | 276 / E-88 | As `service_role` with no UPDATE grant: one new row and one existing key, `ON CONFLICT … DO NOTHING RETURNING id` (what `upsert(…, { ignoreDuplicates: true }).select('id')` sends) | Exactly 1 id returned, the new row's |
| S-04 | 276 | Without `ON CONFLICT`, a duplicate key | `23505` (`unique_violation`) |
| S-05 | 276 | value −1 | `23514` (`check_violation`) |
| S-06 | 276 | `accounts` with value 1.5; `credits` with value 1.5 | the first refused (`23514`), the second stored |
| S-07 | 276 | unit `'usd'`; unit `'Accounts'` | each `23514` |
| S-08 | 276 / E-86 | dimension `'tier:pro-plus'`, `'tier:a_b-c'`, `'founding_partner'`, `'all'` | all stored |
| S-09 | 276 / E-86 | dimension `'1a2b3c4d-1111-4111-8111-abcdefabcdef'` (a bare uuid), `'has space'`, `'a@b'`, `'Upper'`, `'tier:'`, `'tier:x y'`, and a 49-character key | each `23514` |
| S-10 | 276 | metric `'has space'`, `'a@b'`, `'9lead'`, `'tier:pro'` (no colon allowed in a metric) | each `23514` |
| S-11 | 276 | As `service_role`: `as_of_date = current_date` (the day has not ended, so the default `taken_at` falls before its end) | `23514` (the `day_ended` check) |
| S-12 | 276 | As `postgres`: `as_of_date = D` with an explicit `taken_at = (D + 1)::timestamp AT TIME ZONE 'UTC' - interval '1 millisecond'`, then exactly at that midnight | the first is `23514`; the second is stored (the boundary is inclusive) |
| S-13 | 276 | As `service_role`: an insert naming `id`; an insert naming `taken_at` | each `42501` |
| S-14 | 276 | As `service_role`: `UPDATE … SET value = 0`; `DELETE`; `TRUNCATE` | each `42501` |
| S-15 | 273 | As `authenticated` (JWT claims set) and as `anon`: `SELECT count(*)`; an `INSERT` | each `42501` |
| S-16 | 273 | Catalog: RLS on, 0 policies, 0 non-internal triggers, unique non-partial key, 7 columns, no `user_id` | all true |
| S-17 | 273 | `has_column_privilege('service_role', …, 'INSERT')` is true for exactly the five columns | true |
| S-18 | 273 | A NULL in each NOT NULL column (`as_of_date`, `metric`, `dimension`, `unit`, `value`) | each `23502` |
| S-19 | 274 | `numeric(18,6)`: a credits value of 123456789012.123456 is stored; 1e12 × 1e6 overflow (`1234567890123.0`) is refused | stored; `22003` |
| S-20 | — | Check 32's logic run inside the script against the live catalog (the rows of §4 as one query) | every row true |
| S-21 | 275 | (the rollback is proven outside the block, §6 steps 7 and 8; the script records "S-21 see runner") | — |
| S-22 | — | End: count the rows written | `SELFTEST PASS 22 cases … rows written n`, in `bos.selftest_report` |

Everything runs inside the runner's `BEGIN … ROLLBACK`, so nothing persists. There is no `INSERT INTO` outside the cases, and the editor word never appears in prose.

## 6. The PGlite run and the mutations

Harness `…\scratchpad\pglite\h81.mjs`, copied from `h4b1.mjs` (VL-6), PGlite **0.5.8**. It reads the working-tree files, and nothing is added to the repo.

1. `setup`: the roles, the default privileges and the `auth` stubs (as `h4b1.mjs`). Apply `20261011_bos_cron_runs.sql`, for check 31 row 6.
2. **Check 31 before:** 6 rows, all `true`.
3. **Check 32 before:** row 1 false; the record shows every row is false or `not coalesce(true)` (no row errors).
4. **Apply `20261078`:** success.
5. **Check 31 after:** rows 1 to 3 false, rows 4 to 6 true (a second paste of the pre-check now says stop).
6. **Check 32 after:** 16 (or 17) rows, all `true`. Second apply: `42P07 relation … already exists`, and nothing changes.
7. **Self-test:** `BEGIN; SET LOCAL bos.selftest_local = 'on';` + the script + `ROLLBACK;` gives `SELFTEST PASS 22 cases`. Afterwards the table holds 0 rows.
8. **Rollback with a row** (AC-275): insert one valid row as `postgres` and run the rollback. Expect `ROLLBACK REFUSED …`; the table and the row are still there.
9. **Rollback empty:** delete the row and run the rollback; the table is dropped. Check 31 is all true again. Re-apply; check 32 is all true.
10. **Refusal on a real database:** create a stub `auth.refresh_tokens` table and run the script: `SELFTEST REFUSED  this is a real Supabase database`. Without `SET LOCAL bos.selftest_local`: `SELFTEST REFUSED  local only`.
11. **Mutations.** Each runs on a fresh database with a copy of the migration edited in the scratchpad, never in the repo, and records which check 32 row turns false and which self-test case fails:

| # | Mutation of the migration copy | Check 32 must show | Self-test must fail at |
|---|---|---|---|
| M-1 | Drop the `CREATE UNIQUE INDEX` | row 12 false | S-02 / S-04 |
| M-2 | Make the index partial (`WHERE unit = 'accounts'`) | row 12 false | S-02 (on the credits key) |
| M-3 | `GRANT INSERT (…, taken_at)` | rows 7 and 8 false | S-13 |
| M-4 | Add `GRANT UPDATE` to `service_role` | row 9 false | S-14 |
| M-5 | Leave out `REVOKE ALL … FROM service_role` (so the default `GRANT ALL` survives) | rows 7, 8, 9 and 10 false | S-13 / S-14 |
| M-6 | Leave out `REVOKE … FROM anon` | row 4 false | S-15 |
| M-7 | Add `CREATE POLICY p ON … FOR SELECT TO authenticated USING (true)` plus a SELECT grant | rows 3 and 5 false | S-15 |
| M-8 | Leave out `ENABLE ROW LEVEL SECURITY` | row 2 false | S-16 |
| M-9 | Revert the dimension CHECK to `^[a-z][a-z0-9_:]{0,47}$` (before E-86) | row 14 false | S-08 |
| M-10 | Drop the hyphen from the tier class (`tier:[a-z0-9_]{1,40}`) | row 14 false (8.1-R3) | S-08 |
| M-11 | Widen the dimension to `^[a-z0-9_:-]{1,60}$` (a uuid passes) | row 14 false (8.1-R3) | S-09 |
| M-12 | Drop the `day_ended` CHECK | row 13 false | S-11 / S-12 |
| M-13 | Drop `accounts_whole` | row 13 false | S-06 |
| M-14 | Add a `user_id uuid` column | row 11 false | S-16 |
| M-15 | Add a `BEFORE INSERT` trigger | row 15 false | S-16 |
| M-16 | Leave out the `COMMENT` | row 16 false | — |
| M-17 | Rollback without its `DO $refuse$` block | — | step 8 (the table is dropped with a row) |

**Not provable in PGlite:**
- Supabase's real default privileges (the harness imitates them);
- the SQL editor's paste parsing;
- PostgREST's schema cache and its `upsert` translation, which 8.2 proves on production after the apply.

Check 32 and the migration test own the rest.

## 7. Guard and test edits, line by line

### 7.1 Descriptor — `lib/business-os/purge/descriptors.ts`

After the `bos_cron_runs` entry (`:1475-1476`):

```ts
  // Finance slice 8.1 (§11M.6, HS-W-8): the nightly platform history of states that cannot be rebuilt.
  never('business_os_finance_snapshots', G, exclude(EXPORT_REASON.PLATFORM),
    'One row per platform figure per UTC day: counts of accounts and amounts of credits, written by the nightly finance snapshot job. No user_id, no account, no money: platform aggregates, not tenant data. Append only; never purged and never archived (the history cannot be rebuilt).'),
```

It is a global `never`. Because no purge run returns it, no reset, purge or cleanup step deletes it, and the export excludes it as platform data.

### 7.2 Classification baseline — `lib/business-os/purge/__tests__/classification-baseline.json`

- `:3` `"count": 155` → `156`.
- In `levels`, alphabetically after `"business_os_entitlement_shadow_events": "never",` (`:54`): `"business_os_finance_snapshots": "never",`.
- In `reviewNotes`, alphabetically: `"business_os_finance_snapshots": "2026-10-17 8.1: new table (migration 20261078). No user_id, no FK in or out, no trigger. Platform aggregates (plan mix, credit positions); never, excluded from export as platform data."`

### 7.3 Invariant count — `lib/business-os/purge/__tests__/descriptors.invariant.test.ts`

- After the DE-2 comment (`:868-869`): `// +1 finance slice 8.1 (2026-10-17): business_os_finance_snapshots (never, global).`
- `:870` `toBe(155)` → `toBe(156)`.

### 7.4 Export classification — `lib/business-os/data-export/__tests__/exportClassification.test.ts`

- `:296` `toHaveLength(155)` → `156`. The test title at `:295` says "every one of the 155": changed to 156.
- `:1319-1321`: add the comment `// Finance 8.1: 156 = 38 include + 0 planned + 118 exclude (business_os_finance_snapshots, PLATFORM).`, and change the title to `'the classification totals: 156 = 38 include + 0 planned + 118 exclude'`.
- `:1329` `toHaveLength(155)` → `156`; `:1330` `exclude: 117` → `118`.

No section or billing list changes. The table is excluded, not included, and it is not billing.

### 7.5 New migration test — `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts`

Built on the `bos-cron-runs.migration.test.ts` helpers (LF-normalise, strip comments, `createTable`). It pins:

1. **Statement order:** `BEGIN;` first, then `SET LOCAL lock_timeout = '5s'`, then `CREATE TABLE`, then the six `ADD CONSTRAINT`, then the unique index, then the `COMMENT`, then RLS, then the four `REVOKE ALL` (one each for `PUBLIC`, `anon`, `authenticated`, `service_role`), then `GRANT SELECT`, then the five-column `GRANT INSERT`, then `NOTIFY pgrst`, and `COMMIT;` last.
2. **Columns:** the seven columns with their types, NOT NULLs and defaults; the inline pkey; no `user_id` token in the `CREATE TABLE` statement.
3. **Checks:** the six names and their exact expressions. The dimension and metric pattern text equals `SNAPSHOT_DIMENSION_SHAPE.source` / `SNAPSHOT_METRIC_SHAPE.source` (E-86, SA-W-8.1-2), and the tier branch equals the tier part of `FINANCE_GROUP_SHAPE`.
4. **Index:** one `CREATE UNIQUE INDEX business_os_finance_snapshots_day_metric_key ON … (as_of_date, metric, dimension)` with no `WHERE`, and no other `CREATE INDEX`.
5. **Nothing else:** no `CREATE POLICY`, `CREATE TRIGGER`, `CREATE FUNCTION`, `CREATE SEQUENCE` or `SECURITY DEFINER` text; no `GRANT UPDATE`, `DELETE`, `TRUNCATE` or `ALL`; no grant to `anon` or `authenticated`; the INSERT column list has no `id` and no `taken_at`.
6. **Paste safety** (AC-274), over the migration, the rollback, checks 31 and 32 and the self-test:
   - ASCII only;
   - no `\binto\b` in prose (the self-test keeps only the `INSERT INTO` keyword, counted);
   - no apostrophe inside a string literal or a comment;
   - one result set in each check;
   - no line comment in the migration or the rollback.
7. **Rollback:** the `$refuse$` block precedes `DROP TABLE public.business_os_finance_snapshots`, and the lock comes before both; `NOTIFY` and `COMMIT` are last; nothing else is dropped.
8. **Checks:** check 31 has its 6 items and check 32 its 16 (or 17) items, by name; check 32 names the six CHECK names and the index name exactly as the migration does.
9. **Self-test:** its four guards come before the first `SET LOCAL ROLE`, and it holds case ids S-01 to S-22.
10. **Planted negative controls:** a copy with `GRANT UPDATE` added, a copy with the uuid-admitting dimension pattern, and a copy with a `user_id` column each fail the matching pin.

### 7.6 Run unchanged (results pasted)

- `businessOwnedTables.test.ts`: passes; the table has no `user_id` (VL-10).
- `no-deletion-paths.guard.test.ts`: no delete path added.
- `scripts/__tests__/testAccountCleanupSql.test.ts`: the drift test passes with **no regeneration** (§8).
- `bos-cron-runs.migration.test.ts` and every other migration test.
- `npm run test:bos-entitlements`, `npm run test:authz-guard`, the finance suites, the vocabulary guard, `lint:hooks`, eslint, the scoped `tsc` with canary, and the seven pins.

---

## 8. The test-account cleanup function: no new version

**Conclusion: `operator_test_account_cleanup` needs no new version for this table, and 8.1 adds no `20261075` cleanup migration.**

| Why `20261073` was needed (#447) | Why it does not apply here |
|---|---|
| `business_os_boost_reversal_events` has an FK, `purchase_id`, into `business_os_boost_purchases`, a table the cleanup **deletes** (step B). The function's guard G-18 reviews every inbound link to a removed table; an unreviewed link makes it refuse. So the generator had to list the edge (`INBOUND_FOREIGN_KEYS`, owner `null`) and be regenerated as `20261073` | `business_os_finance_snapshots` has **no FK at all**, in or out, and **no `user_id`**. No removed table has a new inbound link, so G-18's review list is unchanged |
| The plan's tables come from `descriptorsForRun('purge', …)`, `FULL_REMOVAL_EXTRAS` and `FINAL_STEPS` (VL-12) | The new descriptor is a **global `never`**. `descriptorsForRun` never returns it, and it is in neither hand list, so the generated plan is byte-identical |
| The survivor scan reads links to the login from the catalog | No column of the new table links to `auth.users` or any account |
| HS-W-8 | The rows are platform aggregates, counts of the past. Removing a test account must not change them, and nothing in them names the account |

**Proof in the PR:** run `scripts/__tests__/testAccountCleanupSql.test.ts` with no edit and no regeneration. Its drift test regenerates every SQL file from the descriptors, so a plan that changed would fail it. Also, `git diff --exit-code` shows the generator, the five generated files and `cleanupFunctionVersion.generated.ts` untouched.

A later slice that adds an FK from this table to an account or to a removed table would need a new cleanup version; HS-W-8 forbids that.

---

## 9. User apply runbook

This runs only after the SA code review is approved and QA has passed with the PGlite results recorded. Use the Supabase SQL editor on production, with each step in a **new editor tab**. The PR is **not** on auto-merge.

| Step | Action | Expect | If not |
|---|---|---|---|
| 1 | Paste `scripts/precheck-bos-finance-snapshots.sql` (check 31) and run it | **6 rows, all `ok = true`** | Stop and send the rows to the session. Apply nothing |
| 2 | Paste the **whole** of `supabase/migrations/20261078_business_os_finance_snapshots.sql` and run it once | "Success. No rows returned" | `55P03` lock timeout: nothing was applied; run it once more, and if it fails again, stop. `42P07` already exists: it was applied before, so go to step 3. Any other error: stop; the transaction applied nothing |
| 3 | Paste `scripts/check-bos-finance-snapshots-migration.sql` (check 32) and run it | **16 rows (17 with SA-W-8.1-4), all `ok = true`** | Go to the rollback rule below |
| 4 | Tell the session "applied", with the UTC time and the check 32 result | RM merges 8.1 by hand. 8.2 starts after that | — |

**Rollback rule.** Use it only when check 32 shows a false row, or the session asks for it:
1. Run `select count(*) from public.business_os_finance_snapshots;`.
2. **If it is not 0, stop: there is no rollback.** The history cannot be rebuilt, so the fix goes forward with a new migration, and the rollback script would refuse anyway.
3. If it is 0, run `supabase/SQL Scripts/20261078_business_os_finance_snapshots_rollback.sql`, then check 31 (6 rows, all true again), then tell the session. RM closes or reverts the PR.
4. After 8.2 is live, the rollback is used only together with a revert of 8.2's code, or the job fails every night (§11M.6).

Until 8.2 deploys, the table stays empty. Nothing reads or writes it, and the app is unchanged.

---

## AC mapping

| AC | Proven by |
|---|---|
| AC-273 | Migration test §7.5 items 1 to 5; check 32 (16 rows) on PGlite and production; self-test S-15 to S-17 |
| AC-274 | Migration test §7.5 item 6, over all five SQL files |
| AC-275 | PGlite steps 8 and 9; migration test item 7; mutation M-17 |
| AC-276 | Self-test S-01 to S-19 (S-08 / S-09 for E-86, S-03 for E-88); migration test item 3, the CHECK equal to the shape constants |
| AC-277 | §7.1 to §7.4 edits; `descriptors.invariant`, `exportClassification`, `businessOwnedTables` and `no-deletion-paths` green |
| AC-293 (8.1) | Seven pins byte-identical; vocabulary guard unedited; no new CI job (the new files are Jest files in existing jobs) |
| L-155 | §9, done by the user, recorded in the QA Report |

## Verification plan

Each command runs alone, with its own exit code. Never `git stash`, `git worktree remove` or `npm install` in the worktree.

| # | Command | Evidence |
|---|---|---|
| V-1 | `npx jest supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts --ci` | pass |
| V-2 | `npx jest lib/business-os/purge lib/business-os/data-export lib/business-os/__tests__/businessOwnedTables.test.ts scripts/__tests__/testAccountCleanupSql.test.ts --ci` | pass, cleanup drift green with no regeneration |
| V-3 | `npm run test:bos-entitlements` | exit 0 |
| V-4 | `npm run test:authz-guard` | exit 0 |
| V-5 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance --ci` | pass (only the new shape module is added) |
| V-6 | `npx jest app/admin/__tests__/aiCostVocabulary.source.guard.test.ts --ci` | pass, file unedited |
| V-7 | `npm run lint:hooks`; `npx eslint` on the touched `.ts` files | clean |
| V-8 | Scoped `tsc` with a canary in `financeSnapshotShape.ts`: config outside the worktree, the canary file restored byte-identical (`sha256sum -c`) | 1 error with the canary, 0 without |
| V-9 | The PGlite run, §6 steps 1 to 11 | the table of results in Implementation Notes |
| V-10 | The seven pin hashes | equal to VL-15 |
| V-11 | `git diff --stat` / `--numstat` read first; `git diff --exit-code` on the "Not touched" list | no deletion-only file; the generator untouched |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | A defect is found after the first night, when rollback is no longer possible | Low | The PGlite run and the mutations; the fix goes forward (by design) |
| R-2 | #447 lands first, so the descriptor counts and the migration number collide | Medium | Rebase: 157 / 119; RM re-checks `20261078` (#447 uses 72 and 73) |
| R-3 | PostgREST does not see the new table in 8.2 | Low | `NOTIFY pgrst` (SA-W-8.1-1); 8.2's first run is checked on Jobs & queues |
| R-4 | The `day_ended` CHECK refuses a legitimate late write | Very low | Only a write for a day that has not ended is refused; 8.2 always writes D − 1 at 00:07 or later |
| R-5 | A tier id with a character outside `[a-z0-9_-]` | Low | 8.2's builder skips the `plan` family only (E-86); the shape is pinned to `FINANCE_GROUP_SHAPE` |
| R-6 | Supabase default privileges differ from the harness | Low | Check 32 rows 4 to 10 on production are the real proof |
| R-7 | Pasting into the SQL editor breaks on a word or a quote | Low | AC-274 pins; the comment text has no apostrophe and no editor word |

## Estimate

**About 1 day** (§11M.13):
- DDL, rollback and checks: 0.25 d;
- self-test, PGlite run and mutations: 0.4 d;
- descriptor, count pins, shape module and migration test: 0.25 d;
- verification and handover: 0.1 d.

## Task List

- [x] ✅ Step 0: branch confirmed; house style read on #447 (VL-2 to VL-6); count pins located (VL-8); cleanup generator read (VL-12)
- [x] ✅ Step 1: SA workplan review SA-WR-8.1 approved with conditions; rulings SA-W-8.1-1 to -5 and 8.1-R1 to 8.1-R4 applied
- [x] ✅ Step 2 (8.1-R1): `git fetch origin main` and `git merge origin/main`: a fast-forward to `e5bc1e1f` (#451 DE-8a), with no conflict and no new commit. The seven pins were hashed, all equal. Baseline: purge, data-export, test-account-cleanup, scripts, migrations and `lib/business-os/finance` gave 88 suites, 5045 passed
- [x] ✅ Step 3: `financeSnapshotShape.ts`
- [x] ✅ Step 4: migration `20261078` and its rollback
- [x] ✅ Step 5: checks 31 and 32, copied byte for byte from §11M.9 (E-91, E-93): 6 rows and 16 rows
- [x] ✅ Step 6: the self-test script (UTC dates, 8.1-R2)
- [x] ✅ Step 7: the migration source test (27 tests) with planted controls, plus the finance purity guard for the shape module
- [x] ✅ Step 8: descriptor, baseline (157, level, note naming `20261078`, 8.1-R4), invariant (157), export (157, exclude 119), recounted from merged main
- [x] ✅ Step 9: PGlite run, steps 1 to 11, with mutations M-1 to M-17: HARNESS PASS
- [x] ✅ Step 10: verification, pins, Implementation Notes; status → Code Complete
- [ ] Step 11 (user): the §9 runbook, after SA and QA; RM merges by hand (off auto-merge)

## Implementation Notes

**Built 2026-10-17 in `neuronforge-finance-m8`, branch `feature/bos-finance-health-8`, uncommitted.** The branch is at `e5bc1e1f` after the 8.1-R1 merge, which was a fast-forward. Dev edited the requirement MD only for the §0.1 workplan link, before the build.

### Files

| File | State |
|---|---|
| `supabase/migrations/20261078_business_os_finance_snapshots.sql` | New. The exact §1 DDL with the number 20261078 (E-91), `NOTIFY pgrst` before `COMMIT` (E-89) |
| `supabase/SQL Scripts/20261078_business_os_finance_snapshots_rollback.sql` | New. Lock, `$refuse$`, `DROP`, `NOTIFY`, `COMMIT` |
| `scripts/precheck-bos-finance-snapshots.sql` | New. Check 31, extracted byte for byte from §11M.9 by script |
| `scripts/check-bos-finance-snapshots-migration.sql` | New. Check 32, extracted the same way, 16 rows (E-93) |
| `scripts/test-bos-finance-snapshots.sql` | New. Local only, S-01 to S-19 in the script; S-20 and S-21 are run by the runner (D-1) |
| `lib/business-os/finance/financeSnapshotShape.ts` | New. `SNAPSHOT_METRIC_SHAPE`, `SNAPSHOT_DIMENSION_SHAPE`; it imports nothing |
| `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts` | New. 27 tests |
| `lib/business-os/purge/descriptors.ts` | +1 global `never` entry after `bos_cron_runs` |
| `lib/business-os/purge/__tests__/classification-baseline.json` | count 156 → 157; level `never`; dated note naming `20261078` |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | comment, `toBe(157)` |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | 156 → 157 ×2, exclude 118 → 119, two titles, two comments |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | A new 8.1 `describe`: the shape module is scanned, imports nothing, reads no clock, has no tier literal and exports exactly two names, with a planted control |

**Untouched** (`git diff --quiet` exit 0): the cleanup generator and its generated SQL, `lib/business-os/test-account-cleanup`, `businessOwnedTables.ts`, `20261075`, `package.json` and the lockfile, every existing migration, and the seven pins.

### Deviations

| # | Deviation | Reason |
|---|---|---|
| D-1 | S-20 (check 32 inside the self-test transaction) and S-21 (the rollback) are run by the PGlite runner, not inside the `DO` block. The script's report counts 19 cases | Embedding check 32 in the script would be a second copy that could drift. The runner runs the real file in the same open transaction, before its `ROLLBACK`. The rollback must run outside a `DO` block anyway |
| D-2 | Check 32 **before** the apply has 14 false rows, not 16. "no policy on the table" and "no trigger on the table" are `not exists` over a NULL table, so they are vacuously true | The check text is SA's (E-93) and correct after the apply. Row 1, "table exists", is the one that matters before it. The workplan's §6 step 3 said "every row is false", which was wrong; the harness asserts exactly these two true rows |
| D-3 | M-1, M-2, M-9 and M-10 make the self-test fail with Postgres's own error, not a `SELFTEST FAIL` line. M-1 and M-2: "no unique or exclusion constraint matching the ON CONFLICT specification", at S-02. M-9 and M-10: a check violation on S-08's `tier:pro-plus` | Each still fails the run, so it is caught. Wrapping each in a handler would hide which constraint broke |

### PGlite run (PGlite 0.5.8, the scratchpad harness `pglite/h81.mjs`, which reads the working-tree files)

| Step | Result |
|---|---|
| Check 31 before | 6 rows, all ok ✅ (`bos_cron_runs` stubbed for row 6, SA-W-8.1-5) |
| Check 32 before | 16 rows, 14 false; only "no policy" and "no trigger" are true (D-2) ✅ |
| Apply `20261078` | ok ✅ |
| Check 31 after | rows 1 to 3 false (a second run of the pre-check says stop) ✅ |
| Check 32 after | **16 rows, all ok** ✅ |
| `pg_get_constraintdef` | `CHECK ((dimension ~ '^([a-z][a-z0-9_]{0,47}\|tier:[a-z0-9_-]{1,40})$'::text))`: the E-86 literal as written, so E-93's `position` row works ✅ |
| Second apply | `42P07 relation "business_os_finance_snapshots" already exists`, nothing changed ✅ |
| Self-test, in `BEGIN; SET LOCAL bos.selftest_local = 'on'; … ROLLBACK;` | ✅ **`SELFTEST PASS 19 cases S-01 … S-19  rows written 10`** |
| S-20 | check 32 inside the self-test transaction: 16 rows, all ok ✅ |
| After `ROLLBACK` | 0 rows kept ✅ |
| S-21 rollback with a row | `ROLLBACK REFUSED  the finance snapshots table holds history that cannot be rebuilt  fix forward with a new migration  nothing was changed`; the table and the row are still there ✅ |
| Rollback, empty table | dropped; check 31 6/6 ok again; re-apply gives check 32 16/16 ok ✅ |
| Guards | without the setting: `SELFTEST REFUSED  local only …`; with `auth.refresh_tokens`: `SELFTEST REFUSED  this is a real Supabase database …`; before the apply: `SELFTEST REFUSED  apply migration 20261078 first` ✅ |

**Mutations** (each on a fresh database, with the migration edited in memory and never in the repo):

| # | Mutation | Check 32 false rows (as expected) | Self-test |
|---|---|---|---|
| M-1 | no unique index | unique key | fails at S-02 (D-3) |
| M-2 | partial index | unique key | fails at S-02 (D-3) |
| M-3 | `taken_at` insertable | five columns; id or taken_at | `FAIL S-13` |
| M-4 | UPDATE granted | cannot update | `FAIL S-14` |
| M-5 | no revoke from `service_role` | five columns; id or taken_at; update; delete or truncate | `FAIL S-13` |
| M-6 | no revoke from anon | anon | `FAIL S-15` |
| M-7 | a policy and an authenticated grant | no policy; authenticated | `FAIL S-15` |
| M-8 | no RLS | RLS on | `FAIL S-16` |
| M-9 | the pre-E-86 dimension pattern | E-86 pattern | fails at S-08 (D-3) |
| M-10 | the hyphen lost in the tier class | E-86 pattern (8.1-R3) | fails at S-08 (D-3) |
| M-11 | a widened dimension (a uuid passes) | E-86 pattern (8.1-R3) | `FAIL S-09` |
| M-12 | no `day_ended` | six checks | `FAIL S-11` |
| M-13 | no `accounts_whole` | six checks | `FAIL S-06` |
| M-14 | a `user_id` column | seven columns | `FAIL S-16` |
| M-15 | a trigger | no trigger | `FAIL S-16` |
| M-16 | no comment | table comment | passes (no case owns it; check 32 does) |
| M-17 | rollback without `$refuse$` | — | the table is dropped with a row; the real rollback refuses (S-21) |

The harness exit is 0: **HARNESS PASS**.

### Verification (each command run alone)

| # | Command | Exit | Result |
|---|---|---|---|
| V-1 | `npx jest supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts --ci` | 0 | **27 passed** |
| V-2a | `npx jest lib/business-os/purge --ci` | 0 | 16 suites, **364 passed** |
| V-2b | `npx jest lib/business-os/data-export --ci` | 0 | 3 suites, **246 passed** |
| V-2c | `npx jest lib/business-os/test-account-cleanup app/api/admin/test-account-cleanup --ci` | 0 | 2 suites, **27 passed** |
| V-2d | `npx jest scripts/__tests__ --ci` | 0 | 8 suites, **364 passed**: the cleanup drift test is green with **no regeneration** (§8) |
| V-2e | `npx jest supabase/migrations/__tests__ --ci` | 0 | 45 suites, **2429 passed** |
| V-5 | `npx jest lib/business-os/finance app/admin/finance app/api/admin/business-os/finance --ci` | 0 | 36 suites, **2441 passed** |
| V-3 | `npm run test:bos-entitlements` | 0 | 284 suites, **8728 passed** |
| V-7 | `npm run lint:hooks`; `npx eslint` on the six touched `.ts` files | 0 / 0 | clean |
| V-8 | Scoped `tsc` (scratch `tsconfig.81.json` outside the worktree, 7 files, `types/**/*.d.ts` and `next-env.d.ts`), with a canary in `financeSnapshotShape.ts` | 2 / 2 | Canary run: the canary `financeSnapshotShape.ts(24,7) TS2322` plus one **pre-existing** error, `exportClassification.test.ts(1964,42) TS2353` (from `adf9e37f`, DE-7, on a line 8.1 does not touch). File restored from a copy: `sha256sum -c` OK, `grep -c __canary` = 0. Clean run: only the pre-existing TS2353 |
| V-10 | Seven pins | — | all equal: `3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144` |
| V-11 | `git diff --numstat` | — | 5 modified code and test files, 3 + / 1 − at most each except the export test (7 / 5); no deletion-only file; 8 new files |

### Owed

- SA code review, then QA.
- Then the user runs the §9 runbook on production: check 31 (6 rows), apply `20261078`, check 32 (16 rows), and tells the session "applied". RM merges by hand.
- If #447 merges first, the count pins become 158 / 120 on the next merge of main (E-92).

---

## SA Workplan Review

**Reviewed by SA, 2026-10-17.** Read against `origin/main` `e5bc1e1f` (#451 DE-8a merged) and #447.
**Status: APPROVED WITH CONDITIONS (SA-WR-8.1).** Code may start after 8.1-R1 (merge main). The requirement edits E-89 to E-93 are already applied by SA in §11M.

### Migration number and main's state

| Item | Ruling |
|---|---|
| Number | **`20261078_business_os_finance_snapshots.sql`** (E-91). Main holds `20261074_business_os_data_exports` and `20261075_operator_test_account_cleanup_data_exports`. #447 takes `20261076` / `20261077`. No open PR or remote branch carries `20261076` or above (SA scanned every remote branch). Rename every `20261074` in this workplan (migration, rollback, guard message "apply migration 2026107x first", runbook, check comments). RM re-checks when 8.1 opens |
| Cleanup function | **No new version**, confirmed on main. `descriptorsForRun` returns `false` for `level === 'never'` (`descriptors.ts:1556` on main), so a global `never` never enters `buildCleanupPlan`. The table has no FK in or out and no `user_id`, so no inbound-link review entry is needed. The drift test must pass with no regeneration against main's generator (`20261075`) and, after #447, against `20261077` |
| Count pins | Main is **already 156 / exclude 118** (DE-8a). VL-8's "155 → 156" is stale. **The +1 numbers are recomputed at code time from merged `origin/main`**, never copied, and whichever of #447 and 8.1 lands second re-counts on its merge of main (E-92) |

### Rulings on Dev's questions

| # | Ruling |
|---|---|
| SA-W-8.1-1 | **Accepted.** `NOTIFY pgrst, 'reload schema';` goes before `COMMIT` in both the migration and the rollback. §11M.6 is amended (E-89). It is delivered at commit, so it is safe inside the transaction |
| SA-W-8.1-2 | **Accepted.** `lib/business-os/finance/financeSnapshotShape.ts` exports the two constants and imports nothing. The migration test pins both CHECK patterns to `.source`, and the tier branch to the tier part of `FINANCE_GROUP_SHAPE`. 8.2's builder imports them, with no second copy (E-90). The finance source guard's purity rules must scan it |
| SA-W-8.1-3 | **Accepted, with the main-recount rule above** (E-92, new §11M.10 rows for the count pins and the cleanup function) |
| SA-W-8.1-4 | **Accepted in a stronger form.** Check 32's tier row becomes **"dimension check is exactly the E-86 pattern"**: `position('<the full E-86 pattern>' in pg_get_constraintdef(oid)) > 0` (E-93, applied in §11M.9). PostgreSQL prints the literal as written, so this catches both a lost hyphen (M-10) and a widened pattern (M-11). **Row 17 is dropped**, because a read-only checker cannot test the uuid refusal against the live CHECK. S-09 owns that case. Check 32 is **16 rows**; the migration test pins 16 item names |
| SA-W-8.1-5 | **Keep** the `bos_cron_runs` row |

### Conditions

- **8.1-R1:** before Step 2, run `git merge origin/main` into `feature/bos-finance-health-8` (it is behind: DE-8a). Then hash the pins and take the baseline counts. Never `git stash`.
- **8.1-R2:** the self-test uses **UTC dates**: `D = (now() at time zone 'UTC')::date - 3`, and S-11 uses `(now() at time zone 'UTC')::date`. `current_date` follows the session TimeZone. A session behind UTC would make S-11's "today" a day that has already ended, so S-11 would pass for the wrong reason.
- **8.1-R3:** the M-10 and M-11 rows of the mutation table expect **row 14 false** (no "known gap").
- **8.1-R4:** the `reviewNotes` text names `20261078`.

### Checked and fine

- **DDL:** order, names, the inline pkey, CHECK expressions (SA-Q104), the five-column INSERT grant, and the revoke from `service_role` before the grants.
- **Scripts:** the rollback (`LOCK`, `$refuse$`, `DROP`, `NOTIFY`, `COMMIT`).
- **Self-test:** S-01 to S-22, with the `numeric(18,6)` bounds correct (12 integer digits).
- **Mutations:** M-1 to M-17.
- **Runbook:** applied off auto-merge, merged by hand.
- **Guards:** businessOwnedTables needs nothing for a table with no `user_id`; the seven pins are untouched (no finance page or route file is edited); no new CI job.
- **Estimate:** about 1 day, accepted.

## SA Code Review

**Code Review by SA, 2026-10-17.** Reviewed: the uncommitted tree on `feature/bos-finance-health-8` at `e5bc1e1f`, which contains `origin/main`.
**Status: Code Approved (SA-CR-8.1).** It carries one merge rule (MR-1), below.

### Checked

| Item | Result |
|---|---|
| `20261078` DDL | ✅ As written in §1:<br>• seven columns and the inline pkey;<br>• the six named CHECKs, including the full E-86 dimension pattern and `day_ended` `taken_at >= ((as_of_date + 1)::timestamp AT TIME ZONE 'UTC')`;<br>• the non-partial unique `(as_of_date, metric, dimension)`;<br>• the comment, RLS on, no policy;<br>• `REVOKE ALL` from the four roles, `GRANT SELECT` and the five-column `GRANT INSERT` to `service_role` only;<br>• `NOTIFY pgrst` before `COMMIT` (E-89);<br>• no trigger and no function |
| Rollback | ✅ The lock, then `$refuse$` while any row exists, `DROP`, `NOTIFY`, `COMMIT`. Proven to refuse with a row and to drop an empty table |
| Checks 31 and 32 | ✅ 6 and 16 `select` items. Check 32 holds the E-93 exact-pattern row. PGlite shows `pg_get_constraintdef` prints the literal as written |
| Self-test and mutations | ✅ S-01 to S-19 pass in the script and S-20 / S-21 through the runner. M-1 to M-17 are all caught, M-16 by check 32 alone |
| Shape module (E-90) | ✅ Imports nothing and has exactly two exports. The migration test pins both CHECKs to `.source` and the tier branch to `FINANCE_GROUP_SHAPE`'s, with a planted control. The finance guard scans the module |
| Descriptor and counts | ✅ A global `never`, `exclude(PLATFORM)`, beside `bos_cron_runs`. Counts are 157 / 38 + 0 + 119, with dated notes naming `20261078` |
| Cleanup function | ✅ Untouched (`git diff --quiet` on the generator, the two generated scripts, `lib/business-os/test-account-cleanup` and `20261075`). The drift test passes with no regeneration |
| Paste-safety | ✅ The migration, rollback and checks 31 / 32 are ASCII, with no "into" and no apostrophe in a comment. The local self-test's 25 hits are all `INSERT INTO` keywords |
| Seven pins (SA recomputed) | ✅ `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a` |
| SA re-run | ✅ The migration test, purge, data-export, the finance source guard and the cleanup suite: **22 suites, 1715 passed** |

### Deviation rulings

| # | Ruling |
|---|---|
| D-1 | **Approved.** The runner runs the real check 32 file inside the open self-test transaction, so there is no drifting copy. The rollback has to run outside a `DO` block anyway |
| D-2 | **Approved.** Before the apply, "no policy" and "no trigger" are vacuously true over a NULL table. Check 32 is only run after the apply, and row 1 ("table exists") decides before it. The §6 step 3 wording is corrected by D-2 itself |
| D-3 | **Approved.** A native Postgres error still fails the run, and naming the broken constraint is more useful than a wrapper |

### Scoped `tsc`: the one remaining error is a main defect

SA type-checked **`origin/main`'s own** `exportClassification.test.ts` (copied to the scratchpad with its fixture). It reports `(1962,42) TS2353: 'scope' does not exist in type '{ table: string; export?: unknown; }'`. That is the same error as Dev's line 1964, two lines lower here only because of 8.1's two added comment lines. It comes from DE-7 (`adf9e37f`, on main). It is **outside 8.1's scope and not fixed here**; the DE stream owns it. 8.1's own files type-check clean.

### Merge rule

- **MR-1:** #447 (4b.1) is also at **157 / 119**. **Whichever of #447 and 8.1 merges second recounts to 158 / 120** on its merge of main: the baseline `count`, the invariant `toBe`, both export `toHaveLength` calls, `exclude`, the two titles and the dated comments. RM checks this before merging the second PR by hand.

### Code Approved for QA: Yes

## QA Report

**QA — 2026-10-17**
**Test mode:** full
**Strategy used:**
- **B + C:** Jest source, guard and classification suites, run one at a time.
- **Local PGlite 0.5.8 (PostgreSQL 18.3)** in the QA scratchpad, never production:
  - Dev's `h81.mjs` re-run by QA;
  - QA's own `qa81.mjs`, which reuses h81's setup verbatim and adds 17 mutations Dev did not run (live drift after the apply, and new text mutations) plus direct duplicate-key probes.
- A scoped tsc with a canary, and an editor-safety scan.

**Focus:** schema, security
**Skipped:** production checks 31 and 32 and the apply (user, L-155 below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.** One Low note (QA-81-N1).

### PGlite: Dev's harness re-run (`h81.mjs`), real output

| Step | Result |
|---|---|
| Check 31 before | 6 rows, all ok |
| Check 32 before | 16 rows, 14 false (D-2: "no policy" and "no trigger" are vacuously true) |
| Apply `20261078` | ok |
| Check 31 after | 3 false (table absent, index name free, constraint names free): a second pre-check says stop |
| Check 32 after | **16 rows, all ok** |
| Second apply | `42P07 … already exists`, nothing changed |
| Self-test | `SELFTEST PASS 19 cases S-01 … S-19  rows written 10`. S-20 (check 32 inside the test transaction) gives 16/16 ok. 0 rows kept after `ROLLBACK` |
| Rollback with a row | `ROLLBACK REFUSED  the finance snapshots table holds history that cannot be rebuilt  fix forward with a new migration  nothing was changed`; the table and the row are kept |
| Rollback, empty | dropped; check 31 6/6 ok; re-apply gives check 32 16/16 ok |
| Guards | refuses without the local setting, refuses with `auth.refresh_tokens` present, and refuses before the apply |
| Mutations M-1 … M-17 | all caught as Dev recorded. M-16 (no comment) is caught by check 32 only |
| Exit | **HARNESS PASS** |

### PGlite: QA's own mutations (`qa81.mjs`)

**Live drift after a correct apply**, which is what a hand change on production would do. All caught by check 32, which the user runs on production:

| Mutation | Check 32 row false | Self-test |
|---|---|---|
| `DISABLE ROW LEVEL SECURITY` | row level security on | FAIL S-16 |
| `CREATE POLICY` for authenticated, no grant | no policy on the table | FAIL S-16 |
| `CREATE POLICY` for anon `FOR ALL`, no grant | no policy on the table | FAIL S-16 |
| `GRANT SELECT` to anon | anon has no privilege | FAIL S-15 |
| Column-level `GRANT SELECT (value)` to anon | anon has no privilege | FAIL S-15 |
| `GRANT INSERT` to authenticated | authenticated has no privilege | (passes; check 32 owns it) |
| `GRANT DELETE` to service_role | cannot delete or truncate | FAIL S-14 |
| Column `GRANT UPDATE (value)` to service_role | cannot update | FAIL S-14 |
| Dimension CHECK re-added **without the hyphen** | dimension check is exactly the E-86 pattern | fails at S-08 |
| Unique index re-created partial | unique key … not partial | fails at S-02 |
| `COMMENT … IS NULL` | table comment present | (passes) |

**Text mutations of the migration:**

| Mutation | Caught by |
|---|---|
| Hyphen lost in the tier class | check 32 E-86 row + S-08 |
| `unit IN (…, 'usd')` | S-07 (check 32 sees only the CHECK names) |
| `value >= -1000` | S-05 |
| `day_ended` off by a day | S-11 |
| `GRANT INSERT (id, …)` | check 32 (five columns; id or taken_at) + S-13 |
| **Metric CHECK admitting upper case** | **neither check 32 nor the self-test**. It is caught only by the migration source test, which pins the metric pattern equal to `SNAPSHOT_METRIC_SHAPE.source` (`business-os-finance-snapshots.migration.test.ts:103`, `:113`). See QA-81-N1 |

**Duplicate key, direct:**
- A second insert of the same day, metric and dimension as service_role gives `23505`.
- The same key with a different unit and explicit id, as owner, gives `23505`.
- `ON CONFLICT (as_of_date, metric, dimension) DO NOTHING` keeps one row with the first value (5.000000).

### Suite runs (each alone, worktree `neuronforge-finance-m8`, branch `feature/bos-finance-health-8` at `e5bc1e1f`, uncommitted)

| Suite | Result |
|---|---|
| New `business-os-finance-snapshots.migration.test.ts` | 1/1, 27/27 |
| `lib/business-os/purge` | 16/16, 364/364 |
| `lib/business-os/data-export` | 3/3, 246/246 |
| Test-account cleanup (`lib/business-os/test-account-cleanup`, `app/api/admin/test-account-cleanup`) | 2/2, 27/27 |
| `businessOwnedTables.test.ts` | 1/1, 14/14 |
| `scripts/__tests__` (incl. the cleanup drift test, **no regeneration**) | 8/8, 364/364 |
| `supabase/migrations/__tests__` | 45/45, 2429/2429 |
| `app/admin/finance` | 19/19, 649/649 |
| `lib/business-os/finance` (incl. the 8.1 shape-module guard) | 16/16, 1686/1686 |
| `app/api/admin/business-os/finance` (AC-145 baseline) | 1/1, 106/106 |
| Vocabulary guard | 1/1, 182/182; unedited |
| `npm run test:bos-entitlements` | 284/284, 8728/8728 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅.

**Untouched set:** `git diff --quiet HEAD` is clean on:
- all of `app/` and `lib/admin`;
- the cleanup generator, its two generated scripts and `lib/business-os/test-account-cleanup`;
- `businessOwnedTables.ts`, `package.json` and the lockfile.

No existing `supabase/` file is modified.

**Scoped tsc:**
- Config in the scratchpad covering the 7 changed or new TS files.
- With the canary in `financeSnapshotShape.ts`: exit 2, the canary `(24,7) TS2322` plus one other error.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives exit 2 with **only** `exportClassification.test.ts(1964,42) TS2353`.

**That error is pre-existing on origin/main.** `HEAD` = local `origin/main` = `e5bc1e1f`, and the same line is `:1962` there. It was introduced by DE-7 `adf9e37f`, and 8.1's three hunks in that file (`:296`, `:1325`, `:1333`) do not touch it. This agrees with SA-CR-8.1.

**Migration number:** `20261078` is free. origin/main ends at `20261075`, #447 now carries `20261076` and `20261077`, and no remote branch has `20261078`.

### Editor safety (checks 31 and 32, migration, rollback)

Every pasted file was tokenised:

| File | Non-ASCII | "into" | Apostrophes in comments | Statements |
|---|---|---|---|---|
| Check 31 | 0 | 0 | 0 | one `;`, no `SET`: one result set |
| Check 32 | 0 | 0 | 0 | one `;`, no `SET`: one result set |
| Migration `20261078` | 0 | **0** | 0 | — |
| Rollback | 0 | 0 | 0 | — |

The self-test is local only and never pasted. Its 25 "into" are all `INSERT INTO` keywords, none in a string or comment.

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-273 | PASS (local), production owed | migration test 27/27; PGlite check 32 16/16; QA's drift matrix; S-15 to S-17. Check 32 on production is L-155 step 3 |
| AC-274 | PASS | source test item 6; QA tokeniser (above) |
| AC-275 | PASS | PGlite refusal with a row, drop when empty; M-17 |
| AC-276 | PASS | self-test 19 cases plus S-20 and S-21 by the runner. E-86: `tier:pro-plus` accepted and a uuid refused. E-88: the returning insert. QA's duplicate-key probes |
| AC-277 | PASS | descriptor present; purge (baseline 157), invariant, export (157 / exclude 119), no-deletion and ownership green; cleanup drift green with no regeneration |
| AC-293 (8.1) | PASS | 7 pins equal; AC-145 green; vocabulary guard unedited; no new CI job (Jest files in existing jobs) |
| L-155 | NOT-TESTED (user) | runbook below |

### Issues Found
- **Bugs:** none.
- **Performance:** none.
- **Edge cases (nice to fix):**
  1. **QA-81-N1 (Low).** The metric pattern is not checked on the live database.
     - Check 32 verifies the **dimension** pattern exactly (E-86 row) but only the **name** of the metric CHECK. S-10 has no upper-case case either.
     - So a hand-widened metric CHECK on production (for example one admitting `A-Z`) would pass both. The migration text is safe: the source test pins it to `SNAPSHOT_METRIC_SHAPE.source` (`:103`, `:113`).
     - Optional fix: a check 32 row "metric check is exactly the shape pattern" (`position(...) in pg_get_constraintdef`), mirroring the E-86 row, plus an `'Upper'` metric in S-10. This needs BA and SA to own the check text.
  2. **Low, recorded (MR-1):** whichever of #447 and 8.1 merges second must re-count the classification pins to 158 / 120. Neither PR has merged yet.

### User apply runbook (L-155; production, Supabase SQL editor, each step in a NEW tab; SA code review approved, SA-CR-8.1; the PR stays OFF auto-merge)

1. **Pre-check (check 31).**
   - Paste `scripts/precheck-bos-finance-snapshots.sql` and run it.
   - Expect **6 rows, every `ok = true`**.
   - If any row is false, stop, send the rows to the session, and apply nothing.
2. **Apply `20261078`.**
   - Paste the **whole** of `supabase/migrations/20261078_business_os_finance_snapshots.sql` and run it once.
   - Expect "Success. No rows returned".
   - `55P03` (lock timeout): nothing was applied; run it once more, and if it fails again, stop.
   - `42P07` (already exists): it was applied before; go to step 3.
   - Any other error: stop. Nothing was applied.
3. **Post-check (check 32).**
   - Paste `scripts/check-bos-finance-snapshots-migration.sql` and run it.
   - Expect **16 rows, every `ok = true`**.
   - If any row is false, follow the rollback rule. Do not improvise.
4. **Tell the session "applied"**, with the UTC time and the check 32 result. RM then merges 8.1 by hand, after the MR-1 recount if #447 merged first. The table stays empty until 8.2 deploys.

**Rollback rule** (only when check 32 shows a false row, or the session asks):
1. Run `select count(*) from public.business_os_finance_snapshots;`.
2. **If it is not 0, stop. There is no rollback; the fix goes forward** (the history cannot be rebuilt, and the script would refuse anyway).
3. If it is 0, paste `supabase/SQL Scripts/20261078_business_os_finance_snapshots_rollback.sql`, then check 31 again (6/6 true), then tell the session. RM closes or reverts the PR.
4. After 8.2 is live, a rollback goes only together with a revert of 8.2's code.

### Final Status
- [x] All code-level 8.1 acceptance criteria pass (AC-273 to AC-277, AC-293). The production half of AC-273 and L-155 are the user's apply above. No bugs. **Ready for RM to open the PR, off auto-merge.**
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Dev: workplan written | From §11M (8.1 parts) and SA-RR-8 with E-85 to E-88. House style read on #447 (`20261072`, its rollback, checks 23 and 24, its self-test). VL-1 to VL-15. Five questions for SA: SA-W-8.1-1 (`NOTIFY pgrst` missing from §11M.6), -2 (no builder in 8.1 for the E-86 pin), -3 (count pins not listed in §11M.10), -4 (check 32 tier row too weak), -5. No new cleanup version (§8). No code changed |
| 2026-10-17 | Dev: 8.1 implemented (uncommitted) | Merged `origin/main` `e5bc1e1f` (fast-forward, no conflict); migration renumbered `20261078` (E-91); migration, rollback, checks 31 and 32, self-test, shape module, descriptor and count pins (157 / 119); PGlite run and mutations M-1 to M-17 HARNESS PASS; Implementation Notes, deviations D-1 to D-3 |
| 2026-10-17 | SA workplan review | APPROVED WITH CONDITIONS (SA-WR-8.1): migration 20261078; W-8.1-1..5 ruled; 8.1-R1 (merge origin/main first) to 8.1-R4; requirement E-89 to E-93 applied by SA. No code changed |
| 2026-10-17 | SA code review | Code Approved (SA-CR-8.1). D-1 to D-3 approved; TS2353 confirmed on origin/main (DE stream); MR-1 recount 158 / 120 for the second of #447 and 8.1 |
