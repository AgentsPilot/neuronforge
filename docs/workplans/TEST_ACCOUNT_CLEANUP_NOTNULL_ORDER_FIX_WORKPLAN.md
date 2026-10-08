# Workplan: Test-account cleanup and purge, NOT NULL + SET NULL delete order

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Branch:** `fix/cleanup-notnull-setnull-order`
**Requirement:** [TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md) (live bug, no new requirement)
**Status:** Code Complete

## Overview

On prod the pasted delete rolled back with `23502 null value in column "contact_id" of relation "scheduling_bookings"`. `scheduling_bookings.contact_id` is NOT NULL with ON DELETE SET NULL to `crm_contacts`, and the plan deleted `crm_contacts` before `scheduling_bookings`. Both the purge delete-graph check and the cleanup guards treated every SET NULL edge as harmless, so nothing caught it.

## Analysis Summary

Measured read-only on prod 2026-10-08 (`purge_schema_introspect()` + PostgREST OpenAPI for FK columns): 73 SET NULL / SET DEFAULT FKs in `public`, 0 SET DEFAULT. Two land on a NOT NULL column:

| Edge | Both ends in the plan | Handling |
|------|------|------|
| `scheduling_bookings.contact_id -> crm_contacts` | Yes | Reordered (N1), guarded |
| `shared_agent_imports.imported_by_user_id -> auth.users` | No (parent is the login, child is never deleted) | Already refused by G-10 (actor FK, any row naming the target blocks) |

## Implementation Approach

| Part | Change |
|------|--------|
| `deleteGraph.ts` | A SET NULL / SET DEFAULT edge whose child is ordered after its parent is a blocking-order violation unless its column is shown NULLABLE. The payload has no FK columns, so the column comes from the default name `<child>_<column>_fkey` and `columns[].is_nullable` (already returned by 20260915a). Unresolvable name, absent column or nullability blocks (fail closed). No migration. |
| `BusinessPurgeRepository.ts` | Zod keeps `is_nullable` (optional). |
| `descriptors.ts` | `scheduling_bookings` to `ROOT - 2` (after B2, before `crm_contacts` and before its CASCADE parent `scheduling_services`). New `NOT_NULL_OVERWRITE_EDGES` (N1). |
| Generator | G-19 reads the class from `pg_catalog` (`confdeltype IN ('n','d')`, `attnotnull`, no default for SET DEFAULT, any key column) and refuses a plan where the child's ord is after the parent's. Migration `20261045_operator_test_account_cleanup_notnull_order` (20261044 is the SECURITY DEFINER lockdown), rollback restores 20261043; 20261043 pinned as applied. |

## Task List

- ✅ Measure prod read-only
- ✅ Generic guard in `deleteGraph.ts` and G-19 in the generator
- ✅ Reorder descriptors; invariant tests for N1 (all 16 runs + negative case)
- ✅ Regenerate check, delete, migration 20261045, rollback, version stamp
- ✅ PGlite replica: before reproduces 23502; after CLEAN; other account untouched; planted reversed order blocked by G-19; rollback restores 20261043 exactly
- ✅ Suites, authz guard, typecheck, eslint

## SA Review Notes

For SA to rule on:
1. The TS-side column comes from the constraint-name convention, failing closed. The precise fix is to extend `purge_schema_introspect()` with FK key columns (a migration, not done).
2. G-19 counts every key column, the conservative reading of a column-list SET NULL (none on prod).

**Code Review by SA, 2026-10-08**
**Status:** ✅ Code Approved (with one condition on purge activation, below)

SA re-ran the affected suites (19 suites, 559 tests, green). Running the generator again wrote byte-identical files with the same stamp `e0c53390c6555ecf`, so there is no drift.

### Rulings

| # | Question | Ruling |
|---|----------|--------|
| (a) | FK column read from the `<child>_<column>_fkey` name | **Accepted as a fail-closed stopgap. No migration in this fix.** The test-account cleanup does not depend on it: G-19 reads `conkey` from `pg_catalog`, so it is exact. Only the purge delete-graph check uses the name, and the purge RPCs are inactive. When the name cannot be read, the result is a refusal, never a 23502. The only false pass would need a constraint named for a different nullable column of the same table. No such case is known, and it is pathological. **Condition (before the purge is activated):** a migration `purge_schema_introspect_fk_columns` (next free date) does `CREATE OR REPLACE` of `purge_schema_introspect()` and adds `columns text[]` to every `foreign_keys` element. The array is built from `pg_attribute.attname`, ordered by position in `pg_constraint.conkey` (`unnest(conkey) WITH ORDINALITY`). Every existing key stays and grants are unchanged. Zod adds `columns: z.array(z.string()).optional()`. `isNullableOverwrite` uses the real columns when present (all of them must be `YES`) and falls back to the name otherwise. Track this alongside the existing purge activation prerequisites. |
| (b) | G-19 checks every key column | **Accepted.** For a full-row SET NULL this is exact. For a PG15 column-list SET NULL (`confdelsetcols`) it can only over-block, and prod has none. A later refinement can read `confdelsetcols` when it is non-empty. That is not needed now. |
| (c) | `scheduling_bookings` moved earlier | **Confirmed safe.** Purge: ROOT - 2 (498) is still after `payment_plan_subscriptions` (B2, 100) and before `crm_contacts` and `scheduling_services` (both ROOT, 500). Cascade counts get more accurate: bookings now go before their CASCADE parent `scheduling_services`. B1, B3, B6 and B7 are untouched. Measurements are LEAF, before insights (ROOT). `crm_activities` is still LAST. `business_profiles` is still alone at TENANCY_ROOT. The invariant test covers all 16 runs. Cleanup: bookings moved from ord 66 to 54, and every other A-band row shifts by one. Side effect checked: deleting bookings first now runs SET NULL on `payment_transactions`, `payment_invoices`, `proposals` and `payment_plan_installments` `.booking_id` before those rows are deleted. All of those columns are nullable. Their UPDATE triggers (`tg_invoice_events`, `tg_transaction_events`, `log_payment_activity`, `propagate_refund_*`, `move_plan_stage_with_invoice`, `promote_contact_on_payment`) fire only on `status` or refund columns, or are BEFORE `updated_at` triggers. A `booking_id` overwrite therefore creates no `business_events` or `crm_activities` residue. `crm_contacts` has no DELETE trigger (T1 dropped). Nothing else depended on the old order. |
| (d) | Test edits that look unrelated | **In scope, nothing weakened.** The L8 allowlist addition is only for the two new 20261045 files, the same as 20261042 and 20261043 before them. The no-deletion-paths 20261042 entry is needed because `PREVIOUS_MIGRATION_FILE` moved to 20261043. Without it, 20261042 (applied, sha-pinned) would drop out of the allowlist. The new 20261043 applied pins match the on-disk bytes (SA checked with sha256sum). |

### Code Review Comments
1. Tenant isolation: G-19 and the delete-graph change read the schema only, with no row reads, and the target scoping and G-1 to G-18 are unchanged. Grants on the function are identical to 20261043 (service_role only). The word "into" appears in no string literal. It appears only as the SQL keyword `INSERT INTO`. No Pino or `console.*` issues in the touched TS. Priority: n/a
2. `deleteGraph.ts` checkDeleteGraph: a NOT NULL SET NULL child that is *outside* the run is not flagged, the same as the existing NO ACTION handling. That is a row-level failure, and the cleanup handles it with G-10 and G-18. The purge has no equivalent. Fine for now, but list it with the activation follow-up. Priority: Low
3. Runbook §6.1.1 row: it names 20261043 as the prerequisite, but the order guard in 20261045 checks only 20261041 and 20261027. 20261043 follows the same pattern, and `CREATE OR REPLACE` makes this harmless. Optionally reword the row to "previous version" so it does not read as an enforced check. Priority: Low

### Optimisation Suggestions
- `descriptors.ts` header: the sentence "Restricted to blocking edges the graph IS acyclic, and" now ends on its own short line. This is cosmetic only.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-08**
**Test mode:** full
**Strategy used:** A + B (Jest suites, plus a temporary Jest test that fed the real prod introspect payload through `BusinessPurgeRepository` and `runDeleteGraphCheck`), and C (a local PGlite replica of the prod schema shape, built from `purge_schema_introspect()` read-only on 2026-10-08). Nothing connected to prod.
**Focus:** schema, security, api (cleanup function), purge preview
**Skipped:** e2e. There is no UI behaviour change, only two label strings.
**Input source:** prompt keywords

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Cleanup suite (drift + applied pins incl. 20261043) | ✅ | Pass | `testAccountCleanupSql.test.ts` green. In-memory regeneration of check, delete, 20261045, rollback and version stamp is byte-identical to the working tree (LF) |
| Purge / descriptors / invariant / deleteGraph / businessOwnedTables / all migration tests / cleanup routes + repository / panel render | ✅ | Pass | 51 suites, 1596/1597 tests. The one failure is Bug 1 |
| `npm run test:authz-guard` | ✅ | Pass | 119/119 |
| `npm run typecheck:bos-llm` | ✅ | Pass | 28 errors, 0 new. One baseline entry is now fixed, which is unrelated |
| Full `npm test` | ✅ | Partial | 15 suites fail. 11 are quarantined. Of the 4 that are not quarantined: **`lib/server/__tests__/testCleanupSecret.test.ts` is caused by this diff (Bug 1)**. `bookingsSearchAndPaging.guard` and `oneAddressPolicy.guard` fail on Windows only (CRLF and backslash paths). `jobsQueues.items.render` is a flake under load and passes when run alone |
| eslint on changed files | ✅ | Pass | 0 errors. 2 warnings, both already on HEAD |
| Replica: 20261043 reproduces 23502 and rolls back fully | ✅ | Pass | Pasted HEAD files and the 20261043 function both fail with `23502 null value in column "contact_id" of relation "scheduling_bookings"`. Every table is byte-identical afterwards. The HEAD check said OK, so it could not see the problem |
| Replica: 20261045 check OK, delete CLEAN, every target row gone, second account byte-identical | ✅ | Pass | Seed: 2 contacts, 3 bookings on a service, invoices (paid and cancelled), 2 reminders, a refunded transaction and its refund, storage_usage, a website page with 2 blocks, insights, hypotheses and measurements, token_usage, audit rows. The prod business-event INSERT/UPDATE triggers were installed. Pasted and function delete both returned **CLEAN, 160 rows / 132 tables**, and the per-table lines add up to the TOTAL. Bookings 3, contacts 2, invoices 2, reminders 2, services 1. No row of the target remains. All other rows, including the second account's 2 contacts and 3 bookings, are byte-identical. There is 1 success audit row (actor admin, `admin_page`) |
| Version stamp | ✅ | Pass | Function returns `e0c53390c6555ecf`. This equals the TS file and an independent sha256 of the function SQL. Grants unchanged (service_role only), SECURITY DEFINER, owner postgres, search_path kept. A wrong secret returns 42501 |
| Order guard refuses 20261045 before 20261043 | ✅ | **Not as stated** | It refuses without 20261041 and without the billing_events table. It **applies over 20261042 with 20261043 never applied**. This matches SA comment 3 (Edge Case 1) |
| Planted reversed order: G-19 blocks with zero rows changed | ✅ | Pass | Tested in the pasted files and as an applied function. The check is BLOCKED by G-19 alone (`scheduling_bookings.contact_id to crm_contacts`). The delete refuses (P0001) before anything is removed, and every table is byte-identical. A NOT NULL SET NULL edge that is on no list (planted `scheduling_services.qa_contact -> crm_contacts`, child after parent) is caught from pg_catalog. SET DEFAULT with no default blocks. SET DEFAULT with a default is silent. A NULLABLE column is silent |
| Every previously blocked path still blocks | ✅ | Pass | G-1, G-2 (non-test email, empty tag, blank tag), G-3 (wrong or empty confirmation; the check is OK by design), G-4, G-5 (×2), G-6, G-7, G-8, G-9 (×2), G-10, G-12, G-13, G-14, G-15, G-16, G-17, G-18 (×2, including another account's booking on a target contact). Each returns P0001 with zero rows changed |
| Rollback restores 20261043 exactly; re-apply works | ✅ | Pass | `pg_get_functiondef`, ACL, proconfig and owner are identical. The function returns `6793b7e11d0ea391`, the 23502 is back, and the secret row is kept. Re-applying is identical to the first apply, and a delete afterwards is CLEAN |
| Purge preview (deleteGraph) | ✅ | Pass | On the **real prod payload**, none of the 16 runs has a blocking-order violation, so the fail-closed name rule raises no false alarm. The 8 `agents:true` runs are refused for unlisted cascade children of `agents`, which is unrelated to this change. With the old order, N1 alone blocks in all 16 runs. These block (fail closed): nullability stripped, the column missing, a non-default constraint name, `columns` undefined. A non-string `is_nullable` is rejected by Zod and returns `unreadable` |

### Issues Found

#### Bugs (must fix before commit)
1. **R-7 single-reader guard is red** — File: `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` (line 123) — Severity: Medium. It is not quarantined, so the Jest gate fails.
   - Steps to reproduce: `npx jest lib/server/__tests__/testCleanupSecret.test.ts`
   - Expected: `operator_test_account_cleanup` appears under app/ lib/ components/ hooks/ only in `lib/repositories/TestAccountCleanupRepository.ts`.
   - Actual: the new allow-list entry's literal `'supabase/migrations/20261042_operator_test_account_cleanup_billing_events.sql'` also contains it. HEAD has 0 occurrences in this file. Fix: build the path the way the neighbouring entries do (a generator constant or a joined name).

#### Performance Issues (should fix)
None found. The replica's function delete took 355 ms of server time.

#### Edge Cases (nice to fix)
1. **The 20261045 order guard does not require 20261043.** It applies over a database still on 20261042, while the rollback always installs 20261043. This is the same as SA comment 3. Prod already has 20261043, so it does not bite today.
2. Fail-closed by constraint name (SA ruling (a), confirmed). If `is_nullable` is ever absent from the payload, the purge preview refuses every run on 7 nullable SET NULL edges whose child is ordered after its parent (`kernel_executions`, `payment_invoices` ×2, `payment_transactions` ×3, `proposals`). Safe, but the message is noisy. The introspect FK-columns migration (the SA condition) removes this.

### Test Outputs / Logs
```text
replica: 2 NOT NULL SET NULL/DEFAULT FK columns imposed: scheduling_bookings.contact_id->crm_contacts, shared_agent_imports.imported_by_user_id->users
PASS  HEAD delete fails 23502: null value in column "contact_id" of relation "scheduling_bookings" violates not-null constraint
PASS  rolled back fully: every table byte-identical ()
PASS  TOTAL CLEAN, 160 rows / 132 tables
PASS  second account (and all other rows) byte-identical: no table differs
PASS  check BLOCKED only by G-19: G-19 scheduling_bookings.contact_id to crm_contacts
INFO  20261041+20261042 applied, 20261043 NOT applied: 20261045 APPLIES (no 20261043 prerequisite); returns e0c53390c6555ecf
PASS  rollback restores the 20261043 function exactly (functiondef, ACL, proconfig, SECURITY DEFINER, owner)
PASS  function delete CLEAN, 160 rows / 132 tables, server_ms 355
FAILURES: 0   (116 PASS)
regen: IDENTICAL check.sql, delete.sql, 20261045, 20261045_rollback, cleanupFunctionVersion.generated.ts
jest (targeted): Tests: 1 failed, 1596 passed  -> lib/server/__tests__/testCleanupSecret.test.ts R-7
```
The harness is a scratch file outside the repo (`scratchpad/pgl/qa45.mjs`). The temporary prod-payload Jest test was deleted after the run. `git status` is unchanged apart from this report.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit (Bug 1: R-7 guard red. The fix itself is verified working on the replica.)

## Commit Info

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-08 | Created | Live 23502 fix, code complete, uncommitted |
| 2026-10-08 | SA code review | Approved for QA; (a) name inference accepted as a stopgap, with an introspect FK-columns migration as a purge activation condition; (b)–(d) accepted |
| 2026-10-08 | QA | Fix verified on the PGlite replica (116 checks pass). One bug: the R-7 single-reader guard is red, caused by the new allow-list literal. Edge cases: the order guard does not require 20261043, and the name rule is noisy when fail-closed |
