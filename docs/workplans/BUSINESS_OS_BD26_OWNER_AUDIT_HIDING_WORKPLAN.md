# Workplan: Credit deduction BD-26 — hide admin audit entries from owners

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) §13 BD-26 (user, 2026-10-03), KI-25, SQ-46
**Design:** SA, 2026-10-04 (copied into §2 to §5 below; the scratchpad original is not kept)
**Branch:** `fix/bos-owner-audit-hides-admin-entries` (from `origin/main` @ `89dbc568`)
**Date:** 2026-10-04
**Status:** Code Complete (2026-10-04; uncommitted; awaiting SA code review + QA; 20261018 not applied)

## Overview

BD-26: admin credit-lot and plan-operation audit entries stay written with `userId` = the account, but the account owner must not be able to read them. Today they are readable through three paths: the RLS owner policy (direct PostgREST read), `GET /api/audit/query` (`listOwnerEntries`) and `/monitoring` (which calls that API). This slice hides four entity types from owners using one code registry, a matching policy migration (**20261018**), and guards that keep the two equal. Nothing about how entries are written changes. It must land before 11c / 11d merge and before any real grant on a customer account.

## Table of Contents

1. [Facts established (as-built)](#1-facts-established-as-built)
2. [The predicate and the registry](#2-the-predicate-and-the-registry)
3. [Migration 20261018, checker, probe, rollback](#3-migration-20261018-checker-probe-rollback)
4. [Owner-read surfaces and code changes](#4-owner-read-surfaces-and-code-changes)
5. [Tests and CI](#5-tests-and-ci)
6. [Runbook (user applies to PROD by hand)](#6-runbook-user-applies-to-prod-by-hand)
7. [Files to create / modify](#7-files-to-create--modify)
8. [Task list](#8-task-list)
9. [Guardrails](#9-guardrails)
10. [Follow-ups (not in this slice)](#10-follow-ups-not-in-this-slice)
11. [Open points for SA](#11-open-points-for-sa)
12. [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Facts established (as-built)

From SA's design (read from `origin/main` @ `89dbc568` plus read-only live SELECTs, 2026-10-04).

| # | Fact | Source |
|---|---|---|
| F-1 | Live owner policy `"Users can view their own audit logs"`, SELECT, PUBLIC, `USING (auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action')`. The only other policy is `service_role_bypass_rls`. Admin screens read through the service role | `supabase/migrations/20260930_audit_trail_owner_policy_hides_ai_actions.sql` |
| F-2 | `listOwnerEntries` reads with the service role. It excludes `ai_action` with `.neq` plus a `BUSINESS_AI_ACTION_%` action guard, and short-circuits an AI filter with `isAiAuditFilter` | `lib/repositories/AuditTrailRepository.ts:134-180`, `lib/audit/requestSchemas.ts:27` |
| F-3 | `/monitoring` calls `GET /api/audit/query?limit=1000` and builds its CSV from that, so fixing the repository fixes the page | `app/(protected)/monitoring/page.tsx:53` |
| F-4 | The data export exports **zero** audit rows today: it filters on `timestamp`, a column that does not exist (42703, error ignored). Not leaking now, but it would leak the moment the column is fixed. The route uses a direct service-role client and has **5 `console.*` calls** | `app/api/user/data-export/route.ts:157-166` |
| F-5 | `AuditTrailService.query()` and `exportUserData()` read every row; no production caller | `lib/services/AuditTrailService.ts:323, 420` |
| F-6 | `archived_records`: RLS on, no policy, REVOKE ALL. Archived hidden rows stay hidden | `20261010_admin_archiving_runs.sql:362-371` |
| F-7 | Writers: plan ops and credit ops go through `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts:268-290` with `userId: accountId`, `actorId: admin`, entity `business_os_account_plan` or `business_os_credit_lot` | as cited |
| F-8 | Slice 8b's `BOS_CREDIT_LOW_LINE_CROSSED` will use the new entity `business_os_credit_period` (SQ-46); not yet registered on main | requirement SQ-46 |
| F-9 | Live: exactly one row of a hidden admin type (`f29556b8-…`, `BOS_CREDIT_LOT_GRANTED`, Eyal_Fitness, reason "Testing giving credit to Eyal business"); 0 `business_os_account_plan` rows; 416 `ai_action`; 59,248 total | live SELECT 2026-10-04 |
| F-10 | **`audit_trail.user_id` has no foreign key on PROD, and there is no hash / tamper trigger**: the only trigger is `trigger_sync_audit_user_email` (BEFORE INSERT, fills `user_email`). The repo's `create_audit_trail.sql` FK is intent only, not live. The severity CHECK (`info`/`warning`/`critical`) is live | SA live schema facts L-2, L-3, L-4 (2026-10-04) |

---

## 2. The predicate and the registry

**Hide by `entity_type`** (TL decision, 2026-10-04, following SA). Hidden set: `ai_action`, `business_os_account_plan`, `business_os_credit_lot`, `business_os_credit_period`. Rejected by SA: action-prefix matching (fragile; `BOS_CREDIT_` will carry owner events; `_` is a `LIKE` wildcard), a new `owner_visible` column (ALTER + backfill on a 59k-row table), reusing `eventAudience.ts` (product audience, not read permission).

**New file `lib/audit/ownerVisibility.ts`:**

```typescript
export const AUDIT_ENTITY_OWNER_VISIBILITY = {
  user: 'owner', /* … every AUDIT_ENTITY_TYPES value … */
  ai_action: 'operator',
  business_os_account_plan: 'operator',
  business_os_credit_lot: 'operator',
  business_os_credit_period: 'operator',
} as const satisfies Record<EntityType, 'owner' | 'operator'>;

/** Derived: the 'operator' keys, sorted. Mirrored by the latest owner-policy migration. */
export const OWNER_HIDDEN_ENTITY_TYPES: readonly EntityType[];

/** entityType in OWNER_HIDDEN_ENTITY_TYPES, or action starts with AI_ACTION_EVENT_PREFIX. */
export function isOwnerHiddenFilter(f: { action?: string; entityType?: string }): boolean;
```

- **Every entity type must be classified.** A Jest test enumerates `AUDIT_ENTITY_TYPES` and fails on any unclassified or stale key (ts-jest does not type-check here, and `lib/audit` is outside `typecheck:bos-llm`, so `satisfies` alone is not enforced).
- **The policy cannot drift.** A Jest test finds the latest migration (by filename) containing `ALTER POLICY "Users can view their own audit logs"` and asserts its quoted type list equals `OWNER_HIDDEN_ENTITY_TYPES`.
- Forced classification instead of an allow-list: the live table holds legacy entity types outside the TS union, and an allow-list would silently remove them from `/monitoring`.
- `lib/audit/types.ts` gains `'business_os_credit_period'` (comment: written by slice 8b, hidden from owners, BD-26). Slice 8b's B-3 then drops its "register the entity type" sub-step; whichever PR lands second rebases. KI-25 closes when this ships.
- `isAiAuditFilter` stays as is (other code uses it).

---

## 3. Migration 20261018, checker, probe, rollback

**Paste-file rules (as 11a):** all four files carry **no `--` and no `/*` comments**; every string literal holds only `[A-Za-z0-9_ ]` (dots, colons, braces, quotes built with `chr()`); no single-letter aliases; no bare CASE in an IF condition. The header prose SA described (WHY, what it does not touch, the NULL arm, pre/post-check, STOP rule, rollback pointer) therefore lives in this workplan §6 and in the new migration test's header, not in the SQL. The 20261018 migration file is in `supabase/migrations/` and the rollback in `supabase/SQL Scripts/`, so both are walked by the 11a "no other file names the charge objects" test; neither names them (`business_os_credit_period` is not a substring hit for `business_os_credit_period_start`).

### 3.1 `supabase/migrations/20261018_audit_trail_owner_policy_hides_admin_entries.sql`

`ALTER POLICY`, not DROP/CREATE: it keeps name, command and role byte for byte, and fails loudly if the policy was renamed or dropped instead of creating a second permissive policy.

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER POLICY "Users can view their own audit logs" ON public.audit_trail
  USING (
    auth.uid() = user_id
    AND (entity_type IS NULL
         OR entity_type NOT IN ('ai_action', 'business_os_account_plan',
                                'business_os_credit_lot', 'business_os_credit_period'))
  );

COMMIT;
```

- The `IS NULL OR` arm keeps 20260930's null safety (`NOT IN` yields NULL on a NULL type).
- Postgres stores it as `... (entity_type <> ALL (ARRAY[...]))`; post-checks compare by behaviour (checker + probe), not by string.
- `55P03` lock timeout: nothing changed, re-run.

### 3.2 Checker `scripts/check-audit-owner-policy-migration.sql`

Read-only, one result set `check | status | detail`, plus an overall row (11a idiom).

| Row | Asserts |
|---|---|
| C01 | RLS enabled on `public.audit_trail` |
| C02 | Owner policy exists: `polcmd = 'r'`, `polroles = '{0}'` (PUBLIC), `polwithcheck IS NULL`, permissive |
| C03 | Its USING contains `auth.uid() = user_id` and each of the 4 type literals (one detail per missing literal) |
| C04 | `service_role_bypass_rls` unchanged: `polcmd = '*'`, roles = {service_role} |
| C05 | Exactly 2 policies on `audit_trail`; a third is FAIL with its name |
| C06 | INFO: row count per hidden type (expect `business_os_credit_lot` ≥ 1, `ai_action` ≈ 416) |

Before applying, C03 reads FAIL (baseline proves the checker discriminates).

### 3.3 Probe `scripts/probe-audit-owner-policy-migration.sql` (always rolls back)

Follows `scripts/probe-bos-credit-lots-migration.sql`: one `DO $probe$` block, `PASTE_YOUR_OWN_USER_ID_HERE`, read-only-session and account-exists guards, a report string, final `RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END || ...` that rolls everything back.

1. Insert 6 rows tagged with a `details` nonce: types `settings`, `ai_action`, `business_os_account_plan`, `business_os_credit_lot`, `business_os_credit_period` for `v_owner`, plus one `settings` row for a random stranger id. **Before writing the inserts, the NOT NULL columns, the `severity` / `entity_type` CHECKs, the `user_id` FK and any insert trigger (tamper `hash`) are confirmed against the live schema with the `business-os-schema-check` skill** (the repo's `create_audit_trail.sql` is intent only: `action`, `entity_type` NOT NULL; `severity` CHECK `info|warning|critical`; `user_id` FK to `auth.users` — so the stranger row needs a real second account or `user_id` handling decided at implementation). Insert failure → `PROBE SKIPPED` with SQLSTATE.
2. `SET LOCAL ROLE authenticated`; claims via `set_config('request' || chr(46) || 'jwt' || chr(46) || 'claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true)`:
   - P01 ordinary own row visible (1) · P02 `business_os_credit_lot` invisible (0) · P03 `business_os_account_plan` invisible · P04 `business_os_credit_period` invisible · P05 `ai_action` still invisible · P06 stranger's row invisible
3. Claims = stranger: P07 sees only their own ordinary row.
4. `RESET ROLE; SET LOCAL ROLE service_role`: P08 all 6 nonce rows visible (the admin path).
5. P09: live row `f29556b8-…` read as its owner. INFO when it is invisible (or skipped, if that row or account is gone); FAIL when it is visible (§8.1 deviation 2).
6. Final RAISE rolls back the inserts.

### 3.4 Rollback `supabase/SQL Scripts/20261018_audit_trail_owner_policy_hides_admin_entries_rollback.sql`

Restores the **20260930** expression (so `ai_action` stays hidden). Policies hold no rows, so no "refuse when rows exist" guard. SA reviewed: ✅ idempotent, atomic, fails loudly if the policy is missing.

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER POLICY "Users can view their own audit logs" ON public.audit_trail
  USING (auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action');

COMMIT;
```

Rollback re-exposes admin entries to an owner's **direct** PostgREST read only; the product path stays hidden until the code is reverted too (stated in §6, since the file carries no comments).

---

## 4. Owner-read surfaces and code changes

| # | Surface | Change |
|---|---|---|
| S1 | RLS owner policy | 20261018 (§3) |
| S2 | `GET /api/audit/query` → `listOwnerEntries` | Replace `.neq('entity_type', AI_ACTION_ENTITY_TYPE)` with ``.not('entity_type', 'in', `(${OWNER_HIDDEN_ENTITY_TYPES.join(',')})`)``; keep the AI action-prefix guard; swap the `isAiAuditFilter` short-circuit for `isOwnerHiddenFilter`; update the header / JSDoc |
| S3 | `/monitoring` and its CSV | **No file change**; fixed by S2; QA verifies |
| S4 | `GET /api/user/data-export` | Add the same entity-type exclusion and AI-prefix guard to its audit query. **User decision (BD-26 export decision, 2026-10-04): the owner's data export leaves out internal admin audit entries** — hidden-type rows are dropped, via the single `OWNER_HIDDEN_ENTITY_TYPES` constant (no extra switch). Do **not** fix `timestamp` → `created_at` (FU-1). Convert the file's 5 `console.*` calls to Pino (`createLogger`, `logger.child({ correlationId })`, `{ err }`) per CLAUDE.md rule 3 and § Logging — flagged here; proceeding unless the user objects. No other behaviour change |
| S5 | `AuditTrailService.query()` / `exportUserData()` | Doc comment only under each CALLER CONTRACT: "an owner-facing caller must exclude `OWNER_HIDDEN_ENTITY_TYPES` (BD-26)" |
| S6 | `archived_records` | None |
| Admin | `/api/admin/audit-trail`, `/api/admin/users/[id]/audit-logs`, login-stats, accounts summary, health summary, `/admin/audit-trail` | **Untouched** |

**New guard `lib/audit/__tests__/ownerAuditReads.guard.test.ts`:** scans `app/`, `components/`, `hooks/`, `lib/` for `from('audit_trail')` / `from("audit_trail")`. Every hit must be on an allow-list: `app/api/admin/**`, `AuditTrailRepository`, `AuditTrailService`, `ArchiveRepository`, the purge executor. The data-export route is allowed only if it references `OWNER_HIDDEN_ENTITY_TYPES`. Includes a negative control (a planted hit outside the list fails).

---

## 5. Tests and CI

### 5.1 Tests

| Test | Proves |
|---|---|
| `lib/audit/__tests__/ownerVisibility.test.ts` (new) | Every `AUDIT_ENTITY_TYPES` value classified, no stale keys; hidden set is exactly the 4; latest owner-policy migration's list equals the registry; `isOwnerHiddenFilter` cases |
| `supabase/migrations/__tests__/audit-owner-policy-hides-admin-entries.migration.test.ts` (new) | Paste rules on all 4 files (no comments, literal-character rule, no single-letter alias); one transaction with `lock_timeout`; exactly one ALTER POLICY by name; no DROP / CREATE / TO / FOR / WITH CHECK / RENAME / DML / GRANT; NULL arm present; `service_role_bypass_rls` not named; rollback restores the exact 20260930 USING text; probe is one DO block ending in the PASS/FAIL RAISE with no COMMIT |
| `lib/repositories/__tests__/AuditTrailRepository.test.ts` (update) | `not in` carries the 4 types; AI prefix guard kept; each hidden `entityType` filter returns an empty page with no query |
| `app/api/audit/__tests__/auditRoutes.test.ts` (update) | `?entityType=business_os_credit_lot` → 200, empty page |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` (new) | §4 guard |
| Unchanged and green | `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` (T11b.1 byte-for-byte), `creditAdminOps.test.ts`, `lib/audit/__tests__/ownerPolicyMigration.test.ts` (20260930 historical pin) |

### 5.2 CI (folds in 11b audit F2)

Append to the existing `test:bos-entitlements` Jest invocation (one process, no new job, no new `npm ci`, no rename of the required check):

```text
app/api/admin/business-os/entitlements/__tests__  lib/business-os/credits/__tests__
lib/audit/__tests__  app/api/audit/__tests__  app/admin/users/__tests__
```

`lib/repositories/__tests__` and `supabase/migrations/__tests__` are already in the script. Update only the header comment of `.github/workflows/bos-entitlements.yml`. 11c adds its own paths in its own PR (checklist item for the 11c workplan).

### 5.3 Precondition run and the `creditPeriod.test.ts` finding

Run on this branch (= `origin/main` @ `89dbc568`), Windows working copy, 2026-10-04: **42 of 43 added suites green; 2 tests fail, both in `lib/business-os/credits/__tests__/creditPeriod.test.ts`** ("source guard: period keys never pass through Date"): the `creditPeriod.ts` case and the "exclusion really removed the display maths" case.

**Cause: line endings, not code.** `withoutDisplayMaths` cuts each allowed function with `/export function X[\s\S]*?\n}\n/`. The repo stores the file as LF (`git ls-files --eol` → `i/lf w/crlf`; all 48 files in `lib/business-os/credits/` are `i/lf`), but this machine has `core.autocrlf=true`, so the working copy has `\r\n}\r\n` and the regex never matches; the display maths stay in, and its legitimate `new Date(...)` trips the guard. Verified by running the test's exact regexes over `git show origin/main:lib/business-os/credits/creditPeriod.ts` (LF): no violation, `nextPeriodStartUtc` removed, `resolveCreditPeriod` kept. Over the CRLF working copy: violation, not removed.

**On CI:** the job runs on `ubuntu-latest` with a plain `actions/checkout`; `.gitattributes` sets no `eol` for `.ts`, so files check out LF and **both tests pass on CI**. CI would not turn red.

**Proposed minimal fix (for SA):** one line in the test's `codeOf` helper, `.replace(/\r\n/g, '\n')` before the comment stripping — the same normalisation the 11a migration test's `read()` already does. Test-only; makes the suite green on Windows checkouts too, so SA §5 "no red suite on the path list" holds everywhere. No exclusion needed.

### 5.4 Time budget (≤ 45 s added Jest time)

| Run (local, Windows, `next dev` possibly running) | Jest `Time:` |
|---|---|
| Current `test:bos-entitlements` paths (107 suites) | 47.7 s |
| Current + added paths (150 suites) | 133.9 s (+86 s local) |
| Added paths alone (43 suites) | 40.5 s |
| of which `app/admin/users/__tests__` alone (6 suites, jsdom) | 31.2 s |

CI's current Jest step is 17–19 s against 47.7 s locally (≈ 2.6× faster), so the estimated CI increase is **≈ 33 s**, inside the 45 s budget but not by much. The real number is read from the PR run's Jest step and recorded in §QA; if the step grows by more than 45 s, apply the fallback: move `app/admin/users/__tests__` (about a third of the added time) to the `test:authz-guard` job. No new job either way.

---

## 6. Runbook (user applies to PROD by hand)

The SQL files carry no comments (paste rules), so this table is the only place the explanation lives.

**The checker is the pre-check (W26-8 b).** The separate pre-check query that used to sit here was dropped: it broke the paste rule (`'public.audit_trail'::regclass`). The checker's C02 row prints the owner policy's live command, roles (`PUBLIC` for `{0}`), permissive flag, WITH CHECK state and USING text, and C04 / C05 print the other policy and any extra one, so it shows everything the query did. The checker sets the session read-only; run the migration and the probe in a **new** SQL editor tab.

| Step | Action | Expect | Stop if |
|---|---|---|---|
| 0 | Code PR merged and deployed. Apply the migration right after the deploy; both before 11c / 11d merge | — | — |
| 1 | Run the checker (pre-check) | VERDICT FAIL with **only C03 FAIL** (detail: the three admin types and the null arm missing, "still the old IS DISTINCT FROM form"); C02 shows `command r  roles PUBLIC` and the 20260930 USING; C04 `command *  roles service_role`; C05 2 policies | C01 / C02 / C04 / C05 FAIL, any other USING, a named role, or a third policy → send the output to Dev |
| 2 | — (merged into step 1) | — | — |
| 3 | Run the migration (new SQL editor tab) | `COMMIT` | `55P03` lock timeout → wait and re-run (nothing changed). `42704` (policy does not exist) → nothing changed; send the output to Dev |
| 4 | Run the checker again | VERDICT PASS (5 pass 0 fail); C06 INFO shows `ai_action` ≈ 416, `business_os_account_plan` 0, `business_os_credit_lot` 1, `business_os_credit_period` 0, `BOS_CREDIT_LOW_LINE_CROSSED` 0 (8b may have added rows by then) | Any FAIL → run the rollback, send output |
| 5 | Run the probe with your own user id (new tab) | `PROBE PASS  this error is expected and rolls everything back`, then P00 INFO (6 rows inserted), **P01–P08 PASS**, **P09 INFO** "the live credit lot row is invisible to its own account" (or "skipped" if that row or account is gone) | `PROBE FAIL` (any P line FAIL, P09 included: the live row visible to its owner is a FAIL) → run the rollback. Exception: a `PROBE FAIL` whose read failed with `42501` means a grant changed (`authenticated` lost SELECT on `audit_trail`), not the policy; send the output to Dev and do not rely on the rollback to fix it. `PROBE SKIPPED` → read the reason; `the probe rows could not be inserted <SQLSTATE>` means a constraint changed since 2026-10-04, send it to Dev (nothing was written) |
| 6 | App check: signed in as an owner with a grant (or after a test grant to your own account), open `/monitoring` and call `GET /api/audit/query?entityType=business_os_credit_lot` | No `BOS_CREDIT_LOT_*` row; empty page | A row shows → code not deployed |
| 7 | Record the applied state in the requirement (BD-26 row, KI-25 closed) | — | — |

**Rollback:** run the rollback file. It restores the 20260930 policy (`ai_action` still hidden). It re-exposes admin entries to the owner's direct PostgREST read only; `/monitoring` and the API stay hidden until the code is also reverted.

**Interim:** no further real grants or plan operations on customer accounts until both the code and the migration are live (SA §7). The one existing row (`f29556b8-…`) is kept as written.

---

## 7. Files to create / modify

| File | Action |
|---|---|
| `lib/audit/ownerVisibility.ts` | create |
| `lib/audit/types.ts` | + `'business_os_credit_period'` |
| `lib/audit/events.ts` | comments only (`BOS_ENTITLEMENT_*` / `BOS_CREDIT_LOT_*`: hidden from owners, BD-26) |
| `lib/repositories/AuditTrailRepository.ts` | modify `listOwnerEntries` |
| `app/api/user/data-export/route.ts` | exclusion + Pino conversion |
| `lib/services/AuditTrailService.ts` | doc comments only |
| `supabase/migrations/20261018_audit_trail_owner_policy_hides_admin_entries.sql` | create |
| `supabase/SQL Scripts/20261018_audit_trail_owner_policy_hides_admin_entries_rollback.sql` | create |
| `scripts/check-audit-owner-policy-migration.sql`, `scripts/probe-audit-owner-policy-migration.sql` | create |
| Tests in §5.1 | create / update |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` | one-line CRLF normalisation (if SA approves, §5.3) |
| `package.json` | `test:bos-entitlements` paths |
| `.github/workflows/bos-entitlements.yml` | header comment only |
| `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` | BD-26 status, KI-25 → closed on ship, §19 row |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | one line on the owner-visibility rule |

---

## 8. Task list

- [x] 1. Registry `ownerVisibility.ts` + `types.ts` entry + `events.ts` comments; `ownerVisibility.test.ts` ✅
- [x] 2. `listOwnerEntries` change; repository + route tests ✅
- [x] 3. Live schema check done by SA (L-1..L-7, §SA review); migration, rollback, checker, probe; migration test; local PGlite run (§8.1) ✅
- [x] 4. Data export: exclusion + Pino conversion; `ownerAuditReads.guard.test.ts`; data-export route test ✅
- [x] 5. `AuditTrailService` doc comments ✅
- [x] 6. `creditPeriod.test.ts` CRLF line; `package.json` paths; workflow header comment ✅
- [x] 7. Full `test:bos-entitlements` locally green; times recorded (§8.1); eslint on touched files ✅
- [x] 8. Docs: requirement BD-26 row status + one §19 row; entitlements doc paragraph + Change History row ✅ (KI-25 closes on ship, not now)
- [x] 9. Left uncommitted for SA code review + QA, then the user's diff ✅

### 8.1 Implementation results (Dev, 2026-10-04)

**SA conditions.** W26-1 ✅ (`business_os_credit_period` in the registry, the 20261018 NOT IN list and the probe). W26-2 ✅ (probe period row = `BOS_CREDIT_LOW_LINE_CROSSED` / `business_os_credit_period`, lot row `BOS_CREDIT_LOT_GRANTED`, plan row `BOS_ENTITLEMENT_TIER_ASSIGNED`; the two repository cases use string literals). W26-3 ✅ (no 8b event constant added; set comparisons; `OWNER_HIDDEN_ENTITY_TYPES` de-duplicates through a Set). W26-4 ✅ (parses only the `NOT IN (…)` literals of the latest owner-policy migration; string-level negative control). W26-5 ✅ (all 4 types + AI prefix short-circuit, no query; route 200 empty page for `business_os_credit_lot` and `business_os_credit_period` through the real repository). W26-6 ✅ (any string literal, comments stripped; allow-list as ruled; export needs both exclusions inside `.not(...)` calls; negative controls). W26-7 ✅ (Pino, `x-correlation-id` or `crypto.randomUUID()`, `{ err }`, `userId` field, counts only, no emoji; `auditLog(...)` call byte-identical; `select('*')` first; `timestamp` and the service-role client unchanged). W26-8 ✅ (pg_class / pg_namespace join, `ARRAY[0]::oid[]`, service_role oid sub-select, chr-built owner-scope needle incl. `chr(61)` for `=`; C02 prints USING and roles; C03 rejects `IS DISTINCT FROM`; §6 step 1 is the checker). W26-9 ✅ (migration test header). W26-10 ✅ (inserts before any role switch; `RESET ROLE` before `service_role`; any read error is `PROBE FAIL` + SQLSTATE; P09 as `39c134b8-…`; nonce-only counts; P08 = 6). W26-11 local figure below; PR-run figure owed (QA). W26-12 ✅ (one line + one comment line). W26-13 TL's. W26-14 ✅ (§6 steps 4 / 5, F-10).

**Deviations.** (1) Added `app/api/user/data-export/__tests__/route.test.ts` (new, 7 tests) and its folder to the `test:bos-entitlements` path list, beyond §5.2's list, so the export's exclusion is pinned by behaviour in the required job as well as by the source guard. (2) P09 reports FAIL (not INFO) if the live credit-lot row is visible to its owner; INFO when invisible or skipped. (3) The probe's report prints P09 after P08 (P09 needs the `authenticated` role again after the service_role read). (4) `app/api/audit/query/route.ts` header comment updated (one line, no code change). (5) The checker carries an extra C07 INFO row (checked at, UTC), as 11a's checker does.

**Local PGlite run** (PGlite 0.5.8 / PostgreSQL 18.3, in memory, harness in the session scratchpad; 33 of 33 checks PASS). Stubbed: roles `anon` / `authenticated` / `service_role` (BYPASSRLS); schema `auth`, `auth.users (id, email)`, `auth.uid()` reading `request.jwt.claims ->> 'sub'`; `public.audit_trail` per L-1..L-6 (no FK, severity CHECK, `trigger_sync_audit_user_email` as a lookup stub), the owner policy created then narrowed by the real 20260930 file, `service_role_bypass_rls`, grants; the live owner `39c134b8-…` and row `f29556b8-…` seeded. Results: baseline checker FAIL with only C03; probe on the 20260930 policy = PROBE FAIL (P02/P03/P04/P09 FAIL, P05 PASS: the negative control); migration applies; checker VERDICT PASS; probe guards (placeholder, invalid id, unknown account, read-only session) all SKIPPED; probe PASS (P01–P08 PASS, P09 INFO invisible), rows rolled back, role restored; rollback restores the exact 20260930 stored USING, checker back to C03 FAIL "old form", probe FAIL again with `ai_action` still hidden; rollback and migration each idempotent; re-apply PASS; checker negative controls (third policy → C05, widened service policy → C04, a type missing → C03 naming it and probe P04 FAIL, named role → C02, RLS off → C01); an FK on `user_id` → PROBE SKIPPED 23503; migration and rollback on a missing policy fail with 42704 and change nothing; without the live row P09 is "skipped"; `lock_timeout` not left on the session.

**Tests.** `npm run test:bos-entitlements` with the new paths: **154 suites, 3,573 tests, all green** (incl. both `creditPeriod.test.ts` cases that failed on the Windows CRLF checkout). New / changed: `ownerVisibility.test.ts` 22, `ownerAuditReads.guard.test.ts` 10, migration test 40, `AuditTrailRepository.test.ts` 14, `auditRoutes.test.ts` 81, data-export route test 7. `npm run test:authz-guard` 119 green. `npm run typecheck:bos-llm` passed (395 files, 28 errors, 0 new; it reports one baseline entry fixed in `app/api/onboarding/build/route.ts`, not touched here). Scoped `tsc` (6 GB heap) over the 14 touched TS files: 0 errors. ESLint on the touched files: 0 errors, 9 pre-existing warnings (none on changed lines). Tailwind escape guard green; scan of every changed / new file: 0 Windows paths, 0 undecodable escapes (the only backslash-hex pairs are regex word-boundary escapes in the supabase migration test, the 11a test's idiom; all decode below U+0FFF).

**Jest time (local, Windows; `next dev -p 3000` was running in this folder, idle, and was left alone):** current paths 108 suites **52.7 s** → with the added paths 154 suites **92.3 s** (+39.6 s local), and 64.4 s on a second run after the docs edits (local noise is large); added paths alone (46 suites) 50.0 s. Against CI's ≈ 2.6× faster Jest step, that estimates ≈ +5 to +15 s on CI. The gate is the PR run (ruling 4): Jest step ≤ +45 s and the job ≥ 30 s before Build; else move `app/admin/users/__tests__` to `test:authz-guard`.

**Review fixes + main merged (Dev, 2026-10-04).** Branch fast-forwarded to `origin/main` `8c8b5d08` (PRs #195–#198) with the work still uncommitted (stash, `--ff-only`, pop). One conflict, `lib/audit/types.ts`: both entries kept (`bos_queue` from main, then `business_os_credit_period`). Main added exactly one entity type. **CR26-1** ✅ `bos_queue: 'owner'` (the drain route writes it with the admin's own id, like `archive_run`); the hidden list and the 20261018 SQL are unchanged. **QA26-1** ✅ the export test's emoji check now compares numeric code points, with a `String.fromCodePoint` negative control and no escape sequences. The migration test's word-boundary regexes that ran straight into a hex letter now use `(?:…)` groups, so a scan of every changed file finds 0 backslash+hex sequences. **CR26-3** ✅ test header and §3.3 item 5: P09 is INFO when the row is invisible or skipped, FAIL when it is visible. **CR26-5** ✅ §6 step 5: a 42501 read failure means a grant changed, so send the output to Dev and do not rely on the rollback. Suggestion taken: P04 FAIL also prints `v_own_low_line`. Re-run: targeted audit / BD-26 / drain suites 21 / 410 green; `test:bos-entitlements` **157 suites, 3,679 tests green** (43.6 s locally); `test:authz-guard` 119 green; `typecheck:bos-llm` 402 files, 28 errors, 0 new; tailwind escape guard 6 green.

**Estimate:** ≈ 1.5–2 days (registry + repository + export 0.5 d; SQL files 0.5 d; tests + CI 0.4 d; docs + Pino 0.2–0.4 d).

---

## 9. Guardrails

1. **No change to how entries are written.** No edit to `AuditTrailService.log/flush`, `adminOps.ts`, `creditAdminOps.ts`, the entitlements route or any writer. `routes.test.ts` T11b.1 stays byte-for-byte and unedited.
2. No change to admin views or admin read routes.
3. No UPDATE or DELETE of any audit row; `f29556b8-…` stays as written.
4. The policy keeps its name, command and role; `service_role_bypass_rls` untouched. **Never edit the applied 20260930 file**; its test stays as the historical pin.
5. Number 20261018 is used once, for this file.
6. No `timestamp` column fix in the export (FU-1).

---

## 10. Follow-ups (not in this slice)

| # | Finding | Owner |
|---|---|---|
| FU-1 | The self-service data export has never included audit history (`timestamp` does not exist, error swallowed). Article 15 / 20 completeness gap; fix is small but changes what the export contains; also moves the read into a repository | BA → small fix slice |
| FU-2 | `PLUGIN_ACT_AS` (entity `connection`, `userId` = owner) would show the owner the admin's email; 0 live rows. Needs an event-level rule | BA, later |
| FU-3 | Purge "delete my activity history" would delete admin credit/plan and `ai_action` rows with the owner's history; purge Reset is inert (parked) | Purge session |

---

## 11. Open points for SA

1. **Header comments vs paste rules.** SA's design put WHY / pre-check / STOP text in the migration header; the 11a paste rules forbid any `--` comment. Proposed: no comments in the four SQL files, explanation in §6 and in the migration test's header. Confirm.
2. **`creditPeriod.test.ts`:** approve the one-line CRLF normalisation (§5.3), or prefer leaving it (CI passes on LF) and listing it as a known local-only failure.
3. **Probe stranger row:** `user_id` has an FK to `auth.users` (per repo intent). Options: insert the stranger row with `user_id` NULL (still invisible to both claims), or pick a second real account. Proposed: NULL-user row for P06 plus P07 using a random `sub` that must see 0 of the owner's rows. Confirm after the live schema check.
4. **Time budget:** estimated +33 s on CI from local ratios. Accept measuring on the PR run with the authz-guard fallback, or move `app/admin/users/__tests__` up front?
5. **Data-export guard shape:** the allow-list condition is "references `OWNER_HIDDEN_ENTITY_TYPES`". Should the guard also require the route to keep the AI-prefix exclusion?

---

## SA Review Notes

## SA Workplan Review (2026-10-04)

**Reviewed by SA — 2026-10-04** (against SA's own BD-26 design, branch `fix/bos-owner-audit-hides-admin-entries` @ `origin/main` `89dbc568`; live facts from PROD, read-only)
**Status:** ✅ Approved with conditions (W26-1 to W26-14). No business question.

The workplan follows the design faithfully: entity-type predicate, one registry with forced classification, ALTER POLICY (not DROP/CREATE), rollback to the exact 20260930 expression, the owner-read guard, and the export decision. Two design assumptions turned out wrong on the live database and are corrected below: **`audit_trail.user_id` has no foreign key on PROD**, and **there is no hash/tamper trigger**. The only trigger fills `user_email`.

### Live schema facts (PROD, 2026-10-04 07:52 UTC, read-only)

Measured with the service-role key through PostgREST: the OpenAPI document, plain SELECT counts, and the read-only `purge_schema_introspect()` RPC (SECURITY DEFINER, no DML or DDL, service_role only, migration `20260915a`). Plus two `GET /auth/v1/admin/users/{id}` lookups. Nothing was written.

| # | Fact | Consequence for the probe and migration |
|---|---|---|
| L-1 | NOT NULL: `id` (default `gen_random_uuid()`), `action`, `entity_type`, `created_at` (default `now()`). Every other column is nullable, `user_id` included | The probe inserts only `user_id`, `action`, `entity_type`, `details`. Leave `severity` out so the default `'info'` applies |
| L-2 | **No foreign key on `audit_trail` at all** (introspect `foreign_keys` holds none from or to `audit_trail`). The OpenAPI comment on `user_id` reads "Renamed from user_id to avoid PostgREST validation against auth.users". Corroborated: 4,675 rows have `user_id` set and `user_email` null, and e.g. `9a9a5df7-…` (rows from 2026-09-16) returns 404 from the auth admin API. Under the repo's `ON DELETE SET NULL` intent, those rows would have been nulled | `create_audit_trail.sql`'s FK is **not live**. A stranger row with `user_id = gen_random_uuid()` inserts fine. See ruling 3 |
| L-3 | Triggers: exactly one, `trigger_sync_audit_user_email BEFORE INSERT … EXECUTE FUNCTION sync_audit_user_email()`. **No `hash` / tamper trigger** (`hash` is a nullable text column nobody fills) | The insert fills `user_email` for `v_owner`, which the final RAISE rolls back. For an unknown id it evidently leaves `user_email` null without raising (L-2 rows). The function body is not readable through the RPC, so keep the `PROBE SKIPPED` + SQLSTATE fallback |
| L-4 | `severity` CHECK is live: values seen are only `info` 54,573 / `warning` 2,869 / `critical` 1,806, with 0 `error` and 0 NULL. This matches the known legacy writes rejected for `severity='error'` | Never write `'error'` in the probe. Omit `severity` |
| L-5 | `entity_type` has no enumerated CHECK in practice. Many types sit outside the TS union, and `business_os_credit_lot` was first written by 11b with no constraint migration. CHECK definitions are not readable through the RPC | Inserting `business_os_credit_period` / `business_os_account_plan` (0 live rows each) is expected to work. The SKIPPED fallback covers the residual risk |
| L-6 | Policies, verbatim: `"Users can view their own audit logs"` SELECT, roles `{public}`, USING `((auth.uid() = user_id) AND (entity_type IS DISTINCT FROM 'ai_action'::text))`, WITH CHECK null. `service_role_bypass_rls` ALL, `{service_role}`, USING `true`, CHECK `true`. Exactly 2 | Matches F-1 and the runbook step-1 expectation. The rollback text in §3.4 equals the 20260930 file's USING byte for byte (checked) |
| L-7 | Counts: `ai_action` 416, `business_os_credit_lot` 1 (`f29556b8-bf4c-4a55-ab24-7165acdf4866`, owner `39c134b8-fab3-49eb-b05f-c174ce4a8229`, severity `warning`), `business_os_account_plan` 0, `business_os_credit_period` 0, action `BOS_CREDIT_LOW_LINE_CROSSED` 0. Owner account `39c134b8-…` exists (auth 200) | C06 expectations hold. P09 can run as designed |

### Open-point rulings (§11)

1. **Paste rules vs header comments: confirmed.** The four SQL files carry no comments. The explanation lives in §6 and in the migration test's header (11a precedent). The test header must name the four files, say what each is for, and point to this workplan §6 (W26-9).
2. **`creditPeriod.test.ts` CRLF line: accepted.** This is a one-line, test-only normalisation in `codeOf` (`.replace(/\r\n/g, '\n')`), the same idiom as the 11a migration test's `read()`. The cause is the Windows `core.autocrlf` working copy, and CI on LF would stay green. It is worth taking because the folder now joins a required job's path list, and a suite that is red on every Windows checkout erodes trust in the gate. Conditions: change no assertion or regex, and add a one-line comment saying why (W26-12).
3. **Probe stranger row: use a real random id; the NULL-user row is dropped.** PROD has no FK on `user_id` (L-2), so insert the stranger row with `user_id = gen_random_uuid()` and an ordinary type. P06: the owner sees 0 of the stranger's rows. P07: claims = that stranger id; the stranger sees exactly 1 nonce row (its own) and 0 of the owner's. Do not use a second real account: it would make the probe depend on a person. Do not use NULL: under the policy it is invisible to everyone, so it proves nothing about cross-tenant reads. Keep the insert-failure path → `PROBE SKIPPED` + SQLSTATE, so a future FK cannot turn into a false FAIL.
4. **CI time: measure on the PR run, with the fallback agreed now.** +33 s on CI puts the entitlements job at about 2 m 46 s against Build's ~3 m 38 s, which stays inside the critical path, so the user's rule holds. The local numbers were taken with `next dev` possibly running: 133.9 s combined is more than 47.7 s + 40.5 s, which points to contention. Re-measure once with nothing else running and record it (W26-11). Gate on the PR run: the Jest step grows by ≤ 45 s **and** the entitlements job finishes ≥ 30 s before Build on the same run. If either fails, move `app/admin/users/__tests__` to `test:authz-guard` in the same PR, re-run, and record both jobs against Build. No new job either way.
5. **Export guard: yes, require both exclusions.** The data-export route stays on the allow-list only if its audit query references **both** `OWNER_HIDDEN_ENTITY_TYPES` and `AI_ACTION_EVENT_PREFIX` (W26-6). The two guards are not redundant: the prefix guard is the defence for an AI event written under another entity type.

### Other checks

| Area | Verdict |
|---|---|
| Migration: `ALTER POLICY` + `SET LOCAL lock_timeout = '5s'` inside `BEGIN/COMMIT` | ✅ Correct. ALTER POLICY takes an ACCESS EXCLUSIVE lock on `audit_trail`. `SET LOCAL` scopes the timeout to this transaction. `55P03` leaves everything unchanged. The NULL arm is right (`NOT IN` on NULL yields NULL) |
| Rollback | ✅ Restores exactly `auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action'` (matches 20260930 and L-6). Idempotent, fails loudly if the policy is missing |
| Registry + the two guards (classification test, policy-equality test) | ✅ With W26-3 (set comparison, 8b ordering) and W26-4 (parse only the NOT IN list) |
| `listOwnerEntries` | ✅ `.not('entity_type','in','(…)')` with the 4 types, the AI prefix guard kept, and `isOwnerHiddenFilter` returning an empty page with no query. An `action=` filter for a hidden event still issues the query, and the NOT IN empties it. W26-5 tests both |
| Data export + Pino | ✅ The exclusion plus a conversion of the 5 `console.*` calls (lines 47, 180, 202, 204, 218). Conditions in W26-7 |
| Guardrails | ✅ The write path stays byte-identical (incl. the export's own `auditLog` call). Admin views are untouched. The 20260930 file and its pin test are never edited. 20261018 is used once. No `timestamp` fix |
| Paste-file rules | ⚠️ The §6 pre-check and the checker as sketched contain dotted / braced literals (`'public.audit_trail'::regclass`, `'{0}'`, `auth.uid() = user_id`). See W26-8 |
| Phase / patterns | No new pattern. It reuses the 20260930 policy idiom, the 11a probe and checker idiom, and the existing Jest-guard style |

### Conditions (W26-n)

- **W26-1 (TL, 8b).** `'business_os_credit_period'` is in `OWNER_HIDDEN_ENTITY_TYPES`, the registry, the 20261018 NOT IN list and the probe from day one, already as planned. It is non-negotiable even if 8b merges first.
- **W26-2 (TL, 8b; probe + repo tests).** The probe's period row is inserted with action `BOS_CREDIT_LOW_LINE_CROSSED` and entity `business_os_credit_period` (P04 = 0 for the owner). The other hidden rows use realistic actions too: `BOS_CREDIT_LOT_GRANTED` for the credit-lot row and a `BOS_ENTITLEMENT_*` event for the plan row. `AuditTrailRepository.test.ts` adds two cases. (a) `{ entityType: 'business_os_credit_period' }` returns an empty page with no query. (b) `{ action: 'BOS_CREDIT_LOW_LINE_CROSSED' }` issues the query, and the `not in` list it carries contains `business_os_credit_period`. Use **string literals** in both, never an import from `events.ts`, so they pass whether or not 8b has landed.
- **W26-3 (TL, 8b ordering: no red main whichever lands first).** (a) BD-26 does **not** add the `BOS_CREDIT_LOW_LINE_CROSSED` event constant. That is 8b's. (b) BD-26 adds `'business_os_credit_period'` to `AUDIT_ENTITY_TYPES`. If 8b lands first with the same entry, BD-26's rebase keeps one entry, merges the comments, and classifies it. If BD-26 lands first, 8b drops its "register the entity type" sub-step (an item for the 8b workplan / code review). (c) `ownerVisibility.test.ts` compares **sets** (`new Set(AUDIT_ENTITY_TYPES)` vs the registry keys), so a textually merged duplicate cannot turn main red. The hidden-set assertion is set equality with the 4 types. (d) The test must also pass on today's main shape, with neither 8b nor its event present.
- **W26-4 (policy-equality test).** Parse only the literals inside the `NOT IN ( … )` of the latest migration (by filename) containing `ALTER POLICY "Users can view their own audit logs"`. Not every quoted string: the policy name and other literals must not count. Compare as sorted sets with `OWNER_HIDDEN_ENTITY_TYPES`. Include one case proving the test would fail if a type were missing from the SQL (a string-level negative control).
- **W26-5 (repo + route tests).** Cover all 4 hidden entity types plus the AI action prefix via `isOwnerHiddenFilter` (empty page, no query). The route test asserts 200 with an empty page for `?entityType=business_os_credit_lot` **and** `?entityType=business_os_credit_period`.
- **W26-6 (owner-read guard).** (a) Match any `'audit_trail'` / `"audit_trail"` / `` `audit_trail` `` **string literal in code** (comments stripped), not only `from('audit_trail')`. `ArchiveRepository` reaches the table through `const AUDIT_TRAIL = 'audit_trail'`, and a future owner reader could do the same. (b) The allow-list covers today's literal sites: `app/api/admin/**`, `AuditTrailRepository`, `AuditTrailService`, `ArchiveRepository`, `lib/archiving/config.ts`, `lib/business-os/purge/descriptors.ts` (plus the purge executor if it names the table), and `hooks/useLatestArchiveCutoff.ts` (a source key, not a read). (c) The data-export route passes only if it references both `OWNER_HIDDEN_ENTITY_TYPES` and `AI_ACTION_EVENT_PREFIX` (ruling 5). (d) Include the negative control.
- **W26-7 (data export).** Use `createLogger({ module })`, `logger.child({ correlationId })` (from the `x-correlation-id` header, falling back to `crypto.randomUUID()`, per the `new-api-route` skill), errors as `{ err }`, and context first. Log `userId` as a field. Do not log the summary object's contents beyond counts, and drop the emoji. The `auditLog(...)` call stays byte-identical except for the surrounding logger lines. No other behaviour change: the `timestamp` bug stays (FU-1), and the service-role client stays (FU-1 moves it into a repository). Make sure `select('*')` still sits before the new `.not(...)` filters.
- **W26-8 (paste rules: checker + runbook).** (a) The checker builds every dotted, braced or parenthesised match string with `chr()` or avoids it. Find the relation by joining `pg_class` and `pg_namespace` on `relname = 'audit_trail'` and `nspname = 'public'`, not with `'public.audit_trail'::regclass`. Compare roles as `polroles = ARRAY[0]::oid[]` and against `(SELECT oid FROM pg_roles WHERE rolname = 'service_role')`, not with `'{0}'`. Match `auth.uid() = user_id` with chr-built text or `position(...)`. (b) The C02 detail prints the live USING text and the roles, so **runbook step 1 becomes "run the checker"**: drop the separate §6 pre-check query, which breaks the paste rule with `'public.audit_trail'::regclass`, or rewrite it under the same rules. (c) C03 also asserts the USING no longer contains `IS DISTINCT FROM`, so a half-applied state cannot pass.
- **W26-9 (migration test header).** It carries the prose the SQL files cannot: WHY (BD-26, KI-25), what is not touched (`service_role_bypass_rls`, writers, admin reads), the NULL arm, that the pre/post-check are the checker, the STOP rule, and a pointer to the rollback and to this workplan §6. It also pins the rollback text to the 20260930 USING, as planned.
- **W26-10 (probe mechanics).** All inserts run as the SQL-editor role **before** any `SET LOCAL ROLE`. Owner and stranger checks run under `SET LOCAL ROLE authenticated`, switching claims with `set_config(…, true)`. P08 does `RESET ROLE` and then `SET LOCAL ROLE service_role` (`authenticated` cannot switch to `service_role` directly). A `42501` on any SELECT is reported as `PROBE FAIL` with SQLSTATE, not swallowed. P09 runs as `39c134b8-fab3-49eb-b05f-c174ce4a8229` (exists on PROD). Count rows by the `details` nonce only. P08 expects exactly 6.
- **W26-11 (time).** Re-measure locally with no dev server running, then gate on the PR run as in ruling 4. Record both figures in §QA.
- **W26-12 (CRLF line).** One line, plus a one-line comment explaining the Windows working copy. No assertion change.
- **W26-13 (8b interim exposure, for TL).** 8b will not wait. If 8b is deployed and writes `BOS_CREDIT_LOW_LINE_CROSSED` rows before BD-26's code **and** migration are live, owners can read those rows on `/monitoring` and through direct PostgREST. TL confirms with the 8b session that those rows carry no admin identity or admin note in `details` (a system-written low-line event should not). If they don't, the interim exposure is benign, and no business question arises. If they do, 8b's deploy waits for BD-26.
- **W26-14 (docs).** §6's step 4 C06 line and step 5's P-list follow the final probe (P01–P08 PASS, P09 INFO). §1 F-1/F-9 get a line citing L-2/L-3 (no FK, no hash trigger), so later readers do not re-derive the FK assumption from `create_audit_trail.sql`.

### Approval

[x] Workplan approved — proceed to implementation, subject to W26-1 to W26-14. W26-3 and W26-13 also need a matching line in the 8b workplan / review (TL to relay). The code review will check every W26 item.

## SA Code Review (2026-10-04)

**Code Review by SA — 2026-10-04** (uncommitted working tree on `fix/bos-owner-audit-hides-admin-entries`, base `89dbc568`; read-only, nothing applied)
**Status:** ✅ Code Approved for QA, with two conditions before the PR (CR26-1, CR26-2). No business question.

### What was checked

| Area | Verdict |
|---|---|
| Migration 20261018 on PROD (Postgres 17.4) | ✅ `ALTER POLICY ... USING` only, so name, command (SELECT), role (PUBLIC) and the absent WITH CHECK are kept. `SET LOCAL lock_timeout = '5s'` inside `BEGIN/COMMIT` is valid and scoped to the transaction. The NOT IN list is exactly the registry's 4 types, and the NULL arm is there. Postgres will store it as `entity_type <> ALL (ARRAY['ai_action'::text, ...])`, and the checker's quoted needles still match that form |
| Rollback | ✅ The USING text equals the applied 20260930 expression byte for byte (`auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action'`). The migration test pins this. Adding `lock_timeout` changes nothing that matters |
| 20260930 file and its pin test | ✅ Untouched (`git diff` is empty) |
| Checker | ✅ Read-only. Finds the table through `pg_class` / `pg_namespace`, compares roles as oid arrays, builds the owner-scope needle with `chr()`. C03 rejects the old `IS DISTINCT FROM` form, so the pre-check reads C03 FAIL as the runbook says. C02 prints the USING text and the roles. Paste rules hold. C07 INFO (deviation 5): accepted |
| Probe | ✅ Sound. All 6 inserts run before any role switch. They need only `user_id`, `action`, `entity_type` and `details`, consistent with L-1. P01–P05 prove the owner reads their ordinary row and none of the 4 hidden types. P06 (`v_own_total = 1`) also proves the owner sees no stranger row. P07 proves the stranger sees exactly their own row and none of the owner's. P08 runs `RESET ROLE` and then `service_role`, and must see all 6. A failed read raises `PROBE FAIL` with its SQLSTATE, and a failed insert raises `PROBE SKIPPED`. The final RAISE rolls everything back, role included. The uuids are written without hyphens, so no `chr(45)` is needed. P09 runs as `39c134b8-…` against `f29556b8-…`: FAIL if the row is visible (deviation 2, accepted, it is stricter) and printed after P08 (deviation 3, accepted). On the 20260930 policy, the PGlite run shows P02/P03/P04/P09 FAIL, so the probe discriminates |
| `listOwnerEntries` | ✅ `.not('entity_type','in','(…4…)')` (PostgREST `not.in`), AI prefix guard kept, `isOwnerHiddenFilter` returns an empty page without querying. An `action=` filter for a hidden event still queries, and the NOT IN empties it. Route test: through the real repository, with a client that throws if `from` is called. Both W26-5 types covered |
| Owner-read guard | ✅ It matches the exact string literal outside comments, with all three quote styles and template expressions covered. The allow-list matches the W26-6 ruling, and the export needs both `.not(...)` exclusions, checked against code with comments stripped. Stale-entry and blindness checks are included, plus negative controls. `app/admin/**` mentions are prose and comments, not literals, so they are correctly not hits |
| Data export | ✅ Exclusion after `select('*')`, both guards from the shared constants (user decision: drop). Pino: `createLogger({ module })`, `child({ correlationId })` from the header with a `crypto.randomUUID()` fallback, `{ err }`, `userId` as a field, counts only, no emoji, 0 `console.*` left. `auditLog(...)` call byte-identical. The `timestamp` bug and the service-role client are left alone (FU-1). The new route test (deviation 1) is accepted |
| Write path | ✅ No diff in `lib/business-os/entitlements/**` (adminOps), `lib/business-os/credits/creditAdminOps.ts`, `app/api/admin/**` or `app/admin/**`. `AuditTrailService.ts` changes doc comments only. `events.ts` changes comments only |
| Registry and 8b ordering (W26-3) | ✅ `satisfies Record<EntityType, …>`, Set de-duplication, set comparisons, and no 8b event constant. Repository tests use string literals |
| `package.json` CI paths | ✅ Every added path exists in git with exact case (Linux-safe): 1 / 25 / 10 / 1 / 6 tracked files, plus the new export test folder. No path pattern accidentally matches an admin folder. The workflow has no `paths:` filter, so nothing else needs to change |
| `creditPeriod.test.ts` CRLF line | ✅ One normalisation line plus one comment line, no assertion change. The file is `i/lf`, so CI (LF) behaves as before |
| Query-route header comment, entitlements doc paragraph (deviations 4 and 7) | ✅ Accepted |
| Escapes and paths | ✅ No backslash-hex or backslash-u sequences in the new files. No Windows paths |

### Code Review Comments

1. **CR26-1 — `lib/audit/types.ts` / `lib/audit/ownerVisibility.ts`: rebase onto `origin/main` before the PR and classify `bos_queue`. Priority: Medium (condition).** Since this branch's base, `origin/main` gained entity type `'bos_queue'` (PR #196, admin Drain now), inserted at the same spot as `'business_os_credit_period'`. That causes a textual conflict. Once it is resolved, the forced-classification test (and `satisfies`) fail until the type is classified. Classify it as `'owner'`, with a comment: the drain route writes `userId: adminId` (the admin's own id, like `archive_run`), so no owner ever sees it and the 20261018 NOT IN list does **not** change. Re-run `test:bos-entitlements` after the rebase.
2. **CR26-2 — CI runs Node 18 (`NODE_VERSION: '18'` in `bos-entitlements.yml`, while `.nvmrc` is 22). Priority: Medium (verify on the PR run).** This change adds route suites that never ran in CI before (`app/api/audit/__tests__`, `app/api/user/data-export/__tests__`, `app/api/admin/business-os/entitlements/__tests__`). The routes behind them call the **global** `crypto.randomUUID()` when no `x-correlation-id` header is sent, and the local green run was on Node 22. Whether global `crypto` exists in Node 18 without a flag is not certain. If the PR run shows `crypto is not defined`, fix it in this PR: bump the job's Node version to `.nvmrc` (preferred, one line), or import `randomUUID` from `crypto` in the export route. Do not drop the suites. QA records the PR run's Jest step result next to the W26-11 time figure.
3. **CR26-3 — migration test header and §3.3 item 5 still say "P09 is INFO". Priority: Low.** After deviation 2, P09 is INFO when the row is invisible or skipped and FAIL when it is visible. §6 step 5 already says this. Align the test header sentence and §3.3 item 5.
4. **CR26-4 — checker C03 checks that the strings are there, not how they are used. Priority: Low (accepted).** A policy that names the 4 types under `IN` instead of `NOT IN`, or that also hides an ordinary type other than `settings`, would still pass C03. The probe's behaviour checks (P01–P07) are the real proof, and the runbook requires both. No change needed. Recorded so nobody treats C03 alone as sufficient.
5. **CR26-5 — §6 step 5 STOP rule. Priority: Low.** A `PROBE FAIL ... raised 42501` means the `authenticated` role lost its SELECT grant on `audit_trail`, not that the policy is wrong. Running the rollback is harmless but fixes nothing. Add one clause: "42501 in a read: send the output to Dev (a grant changed)".
6. **CR26-6 — owner-read guard allow-lists the whole of `AuditTrailRepository.ts`. Priority: Low (accepted).** If a new method in that file reads every row for an owner, the guard will not catch it. `adminReadMethods.guard.test.ts` pins the admin methods to `app/api/admin/**`, and review covers the rest. The allow-list reason already says this. No change.

### Optimisation Suggestions

- In the P04 FAIL message, also print `v_own_low_line`, so a failure shows which of the two counts tripped.

### W26 conditions

W26-1 to W26-12 and W26-14: met (W26-11's PR-run figure is owed by QA). W26-13 stays with TL (8b interim exposure).

### Code Approved for QA: Yes

Conditions before the PR is opened: CR26-1 (rebase and `bos_queue: 'owner'`), and CR26-2 verified green on the PR run. CR26-3 and CR26-5 are doc-only and can be done in the same pass. The user's diff review follows QA, as usual.

## QA Testing Report

## QA Report (2026-10-04)

**Test mode:** full
**Strategy used:** A (Jest, existing + new suites), B (route black box over the real repository with a mocked Supabase client that applies the filters to rows), C (independent in-memory PGlite run of the real SQL files). No database was touched.
**Focus:** security, api, schema
**Skipped:** D (manual browser check): no UI change; runbook step 6 covers the app check after deploy. The PR-run Jest time (W26-11) and the Node 18 run (CR26-2) can only be read from the PR run.
**Input source:** TL prompt
**Verdict: PASS WITH NOTES.** No High or Medium bug in the change. One Low bug (QA26-1). The SA's CR26-1 (rebase) must still be done before the PR.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Owner never reads the 4 hidden types (RLS) | ✅ | Pass | PGlite: owner sees own `agent`, `settings`, a NULL-type row and an unregistered legacy type (4 rows), none of `ai_action` / `business_os_account_plan` / `business_os_credit_lot` (BOS_CREDIT_LOT_GRANTED) / `business_os_credit_period` (BOS_CREDIT_LOW_LINE_CROSSED). Before the migration the owner did see the lot row (the hole is real) |
| NULL `entity_type` row stays visible | ✅ | Pass | QA's stub made the column nullable for this case only (live is NOT NULL) |
| Stranger / anon / no-sub see nothing of the owner's | ✅ | Pass | Stranger sees only its own row; anon 0 rows (with a SELECT grant given to anon, so the policy is what blocks it); `authenticated` without `sub` 0 rows |
| service_role sees everything | ✅ | Pass | 9 of 9 rows |
| Migration twice is safe; rollback restores ai_action-only hiding | ✅ | Pass | Second apply: same visibility, checker PASS. Rollback: `ai_action` still hidden, the 3 admin types and the NULL row visible again, checker FAIL. `lock_timeout` not left on the session |
| Checker FAIL before / PASS after | ✅ | Pass | Both in QA's run. Dev's harness `bd26-harness.mjs` re-run as well: 33 of 33 PASS |
| `listOwnerEntries` / `GET /api/audit/query` exclude hidden types in the query | ✅ | Pass | One `not entity_type in (ai_action,business_os_account_plan,business_os_credit_lot,business_os_credit_period)` plus `not action like BUSINESS_AI_ACTION_%`; no `neq` left; result = own `agent`, `settings`, legacy rows only |
| Filtering by a hidden entity type → 200 empty page, no query | ✅ | Pass | All 4 types; the client's `from` is never called |
| `action=BOS_CREDIT_LOW_LINE_CROSSED` → query carries the NOT IN | ✅ | Pass | Returns nothing. `BOS_CREDIT_LOT_GRANTED` likewise |
| AI prefix guard kept | ✅ | Pass | `action=BUSINESS_AI_ACTION_STARTED` short-circuits; an AI event written under `agent` is still dropped by the `like` guard |
| Normal filters unchanged | ✅ | Pass | `entityType=agent`, `severity=warning`, `page=2&limit=2` (range 2–3), 401 without session |
| Data export drops hidden rows, keeps the rest | ✅ | Pass | Exported `audit_logs` = `agent`, `legacy`, `settings`; both exclusions after `select('*')`; 401 unchanged |
| Data export logs via Pino with correlationId; no `console.*` | ✅ | Pass | `grep console.` = 0; child logger bound to the incoming `x-correlation-id` |
| Known broken `timestamp` filter left as-is (FU-1) | ✅ | Pass (noted) | Still `.gte('timestamp', …)` and `.order('timestamp')`; the column does not exist, so the export holds no audit rows today. Not in scope |
| `creditPeriod.test.ts` two source-guard tests | ✅ | Pass | The HEAD version run on this CRLF working copy: 2 failed / 31 passed. With the fix: 33 / 33 |
| Write path, 20260930 migration, admin views untouched | ✅ | Pass | Against the branch base (`89dbc568`): no diff in `lib/business-os/entitlements/adminOps.ts`, `lib/business-os/credits/creditAdminOps.ts`, `app/api/admin/**`, `app/admin/**` or the 20260930 file (no `lib/audit/auditLog*` file exists; the writer `AuditTrailService.ts` has comment-only changes). A literal diff against `origin/main` shows 2,300+ deleted admin lines, but that is only because `origin/main` is 16 commits ahead (#196, #197 and others); it is not a change on this branch |
| No unexpected deletions | ✅ | Pass | `git diff --numstat HEAD`: largest deletion is 9 lines (the repository's rewritten comment and query). Untracked files all have content (8–450 lines) |

### Commands re-run (QA, local Windows; `next dev` may be running)

| Command | Result |
|---|---|
| New suites + `AuditTrailRepository.test.ts` + `app/api/audit/__tests__` + `creditPeriod.test.ts` | 7 suites, 207 tests, all pass |
| `npm run test:bos-entitlements` (new paths) | 154 suites, 3,573 tests, all pass. Jest `Time:` 76.2 s (wall 83 s) |
| Same command with the old path list (baseline, same session) | 108 suites, 2,558 tests. Jest `Time:` 72.4 s (wall 84 s). Locally the added Jest time is within noise (+3.8 s here; Dev measured +86 s earlier under load). The CI figure (W26-11) is still to be read from the PR run |
| `npm run test:authz-guard` | 1 suite, 119 tests, pass |
| `npm run typecheck:bos-llm` | passed: 395 files, 28 errors, 0 new (one baseline entry now fixed, unrelated) |
| QA PGlite harness (scratchpad `qa26-pglite.mjs`) | 21 / 21 PASS |
| Dev PGlite harness (`bd26-harness.mjs`) | 33 / 33 PASS |
| QA black-box Jest (scratchpad `qa26.blackbox.test.ts`) | 14 / 14 PASS |

### Issues Found

#### Bugs (must fix before commit)

1. **QA26-1: backslash-u escapes in a new repo file.** File: `app/api/user/data-export/__tests__/route.test.ts` line 168. Severity: Low.
   - The emoji check regex is written with backslash-u code point escapes (`1F300`–`1FAFF`, `2600`–`27BF`). The repo rule is no backslash-hex sequences in repo files, and the SA code review says "no backslash-hex or backslash-u sequences in the new files", which is not accurate.
   - Expected: no backslash-hex sequences. For example, build the range with `String.fromCodePoint` and `new RegExp`, or check that no code point is above 0x2600 with a loop.
   - Actual: one line has them. The test passes; only the rule is broken.

#### Performance Issues (should fix)

None.

#### Edge Cases / notes (nice to fix or for the record)

1. **Rebase is required before the PR (confirms SA CR26-1).** `origin/main` changed `lib/audit/types.ts` (adds `'bos_queue'` at the same place as `'business_os_credit_period'`, so the merge will conflict) and `lib/audit/events.ts` (adds `BOS_QUEUE_DRAIN_STARTED`). The first `ownerVisibility.test.ts` case compares the classified keys with `AUDIT_ENTITY_TYPES` at run time, so an unclassified `bos_queue` turns the suite red (ts-jest here does not type-check, so `satisfies` alone would not catch it under Jest). The drain route on main writes `userId: adminId`, so `'owner'` is correct and the SQL list does not change. Re-run `test:bos-entitlements` after the rebase.
2. **Node 18 on CI (SA CR26-2): not verifiable locally.** The routes call the global `crypto.randomUUID()`. Record the result from the PR run.
3. **Migration file name sorts before a migration already on main.** `20261018_…` is earlier than main's `20261026_business_os_credit_charges_activity_indexes.sql`. This is harmless for the manual PROD apply in §6. A tool that applies migrations in file-name order and refuses out-of-order files would complain, so note it if the CLI is ever used.
4. **The query-side `NOT IN` drops NULL `entity_type` rows (repository and export); the RLS policy keeps them.** This is not new: the old `.neq('entity_type', 'ai_action')` did the same. It has no effect today because the live column is NOT NULL. It is recorded so the two layers are not assumed to be the same for NULLs.
5. **FU-1 stays open.** The export's `timestamp` filter and order use a column that does not exist, so the export carries no audit rows. When FU-1 fixes it, the BD-26 exclusions are already there and the source guard keeps them.

### Final Status

- [x] All acceptance criteria pass. Ready for the user's diff review once QA26-1 is fixed (Low, test-only) and SA CR26-1 (rebase, `bos_queue: 'owner'`) is done. CR26-2 and the W26-11 time are read from the PR run.
- [ ] Issues found. Dev must address before commit.

## Commit Info

_RM populates._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Workplan created (Dev) | Short workplan from SA's BD-26 design and the TL decisions of 2026-10-04; user decision recorded: the data export leaves out hidden admin audit entries; `creditPeriod.test.ts` failure traced to CRLF working copy (passes on CI) |
| 2026-10-04 | SA workplan review: approved with conditions W26-1..W26-14 | Live PROD schema read-only: no FK on `audit_trail.user_id`, no hash trigger (only `trigger_sync_audit_user_email`), NOT NULL = id/action/entity_type/created_at, severity CHECK live, policies as expected; rulings on §11 (1) comments in test header + §6, (2) CRLF line accepted, (3) random-uuid stranger row, (4) measure on PR run with authz-guard fallback, (5) export guard requires both exclusions; TL's 8b conditions folded in (W26-1..3, W26-13) |
| 2026-10-04 | Code complete (Dev) | All tasks done, uncommitted; every W26 condition applied except W26-13 (TL). §1 F-10 added (no FK, no hash trigger). §6 runbook: the checker is now the pre-check (old query dropped, paste rule), steps 4 / 5 follow the final checker and probe. §8.1 records results: local PGlite 33 / 33, `test:bos-entitlements` 154 suites green, Jest 52.7 s → 92.3 s locally with `next dev` running, deviations (export route test added to the CI paths, P09 FAIL on a visible row, checker C07 INFO). 20261018 not applied |
| 2026-10-04 | SA code review: approved for QA with conditions (CR26-1..CR26-6) | Migration / rollback / checker / probe sound for PROD; write path, admin views and the 20260930 file untouched; all 7 deviations accepted. Before the PR: CR26-1 rebase onto `origin/main` and classify the new `bos_queue` entity type as `owner` (no SQL change); CR26-2 confirm the newly added route suites pass on CI's Node 18 (global `crypto.randomUUID`). Low: P09 wording in the test header / §3.3, a 42501 clause in the §6 STOP rule |
| 2026-10-04 | QA report: PASS WITH NOTES | All suites re-run green (`test:bos-entitlements` 154 suites / 3,573 tests, Jest 76.2 s locally against 72.4 s on the old paths; authz guard; `typecheck:bos-llm` 0 new). Independent PGlite run 21 / 21 and Dev harness 33 / 33. Route black box 14 / 14. `creditPeriod` fix confirmed (2 fail before, pass after). Write path, 20260930 file and admin views untouched. Bug QA26-1 (Low): backslash-u escapes in the export route test. CR26-1 rebase confirmed necessary; notes on migration file order, NULL handling and FU-1 |
| 2026-10-04 | Review fixes + main merged (Dev) | Fast-forwarded to `origin/main` `8c8b5d08` with the work still uncommitted; `types.ts` conflict resolved by keeping both entries. CR26-1 `bos_queue` set to `owner` (no SQL change), QA26-1 emoji check without escapes, CR26-3 P09 wording, CR26-5 42501 STOP clause, P04 FAIL prints the low-line count. `test:bos-entitlements` 157 / 3,679 green, authz guard 119, `typecheck:bos-llm` 0 new. Still uncommitted |
