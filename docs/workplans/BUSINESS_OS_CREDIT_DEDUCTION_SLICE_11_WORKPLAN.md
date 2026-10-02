# Workplan: Business OS credit deduction — slice 11, credit lots (11a in full; 11b–11d outlined)

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §12 "Slice 11 — Admin grant / reduce credits and per-account view", "Slice 11 scoping (BA, 2026-10-02)" including "Folded in after the SA review", §13 "Slice 11 decisions for the user (2026-10-02)" (all accepted by the user 2026-10-02; **S11-D-4 = A**, so no owner-note column; **S11-BQ-1 = Yes**), §14 S11-SQ-1 to S11-SQ-16 with their SA rulings, and **"SA review — slice 11 scoping (2026-10-02)"** (binding; cited below as "SA-11")
**Previous slice workplan used as the runbook model:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md) §6 (§6.4.1 in particular)
**Worktree:** `neuronforge-llm-layer2-step4`
**Branch:** `feature/business-os-credit-deduction-slice-11` (off `origin/main` `023dde98`; confirmed with `git branch --show-current` on 2026-10-02). 11b, 11c and 11d get their own branches from RM.
**Date:** 2026-10-02
**Status:** 11a committed, PR #173 open (2026-10-02) — SA workplan review APPROVED WITH CONDITIONS (W11a-1 to W11a-10 applied); SA code review approved; QA pass. NOT applied to PROD — the user applies 20261017 via §6.6 and pastes the checker / probe output into §17 before 11b merges (PGlite local run only, §7.4).

## Overview

Slice 11 lets an admin give an account extra credits and take them back, shows an admin any account's credit position, and later shows the owner a separate "Extra credits" figure. SA split it into four PRs. **This workplan details 11a only**: the database foundation that every later part, and the credits boost, build on. 11a creates two append-only tables (`business_os_credit_lots` for every credit added, `business_os_credit_lot_draws` for every credit taken back), the two `SECURITY INVOKER` functions that are their only write path, a repository, one pure function that defines "extra credits at a moment", the lifecycle registry entries, a docs paragraph, and a PROD runbook in the slice 3 §6.4.1 style (checker, always-rollback probe, rollback that refuses when rows exist). Nothing is wired to a route or a screen, nothing an owner sees changes, and the charge path stays byte-identical. 11b, 11c and 11d are outlined at the end and will be detailed in later revisions of this file.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope, out of scope and guardrails (11a)](#2-scope-out-of-scope-and-guardrails-11a)
3. [Implementation Approach (11a)](#3-implementation-approach-11a)
4. [Files to Create / Modify (11a)](#4-files-to-create--modify-11a)
5. [Task List (11a)](#5-task-list-11a)
6. [Migration, checker, probe, rollback and the PROD runbook](#6-migration-checker-probe-rollback-and-the-prod-runbook)
7. [Test Plan and commands (11a)](#7-test-plan-and-commands-11a)
8. [Estimate](#8-estimate)
9. [Risks](#9-risks)
10. [Open points for SA](#10-open-points-for-sa)
11. [Flagged items](#11-flagged-items)
12. [Outline: 11b — admin give / take back (API)](#12-outline-11b--admin-give--take-back-api)
13. [Outline: 11c — admin per-account credit view](#13-outline-11c--admin-per-account-credit-view)
14. [Outline: 11d — owner sees extra credits](#14-outline-11d--owner-sees-extra-credits)
15. [SA Review Notes](#15-sa-review-notes)
16. [QA Testing Report](#16-qa-testing-report)
17. [PROD apply record (the user pastes here)](#17-prod-apply-record-the-user-pastes-here)
18. [Commit Info](#18-commit-info)
19. [Change History](#change-history)

---

## 1. Analysis Summary

**What 11a touches.**

| Area | Today (as-built on this branch) | 11a |
|---|---|---|
| Database | Credit ledger `business_os_credit_charges` / `business_os_credit_totals`, written only by `business_os_record_credit_charge` (`20261015`, applied to PROD 2026-09-29). No lots table anywhere. Migration numbers 20261017–19 are free (SA-11 F11-17) | New migration **`20261017_business_os_credit_lots.sql`**: two tables, two functions, grants, RLS. The charge tables and functions are not named in it |
| Repositories | Four credit repositories (`BusinessOsCreditChargeRepository`, `…LedgerReadRepository`, `…OwnerReadRepository`, `…PeriodRepository`) | New `BusinessOsCreditLotRepository` (service role, documented), exported from the barrel |
| Pure credit code | `creditBalance.ts` (`granted` is hard-coded 0 in `ownerCreditUsage.ts:250`), `creditDisplay.ts` | New `creditLots.ts`, the one definition of "extra credits at `at`" (S11-SQ-4). Not called by anything yet |
| Lifecycle registries | `businessOwnedTables.ts` (`USER_OWNED_TABLES`), `purge/descriptors.ts`, `classification-baseline.json`, `accountDeletionPolicy.ts` — charges registered at `:163-169`, `:396-399`, `:119-126` | Two entries each (S11-SQ-12) |
| Docs | `BUSINESS_OS_ENTITLEMENTS.md` § "Metering: the credit ledger" | A "Credits added: lots" paragraph and a Change History row |
| Routes, UI, entitlements module | — | **Untouched.** No import from `lib/business-os/entitlements/**` anywhere in the diff |

**Skills read and how they apply.**

| Skill | Applies to 11a because | What it requires here |
|---|---|---|
| `new-repository` | New repository | Client injection with `supabaseServer` default and the reason documented; `RepositoryResult`; Pino `createLogger({ service })`; `.eq('user_id', accountId)` on every read; never throws |
| `tenant-isolation-guard` | Service-role writes acting on a caller-supplied lot id | Args built field by field (never a spread); `p_user_id` from the server context only; the reversal function re-checks `lot.user_id = p_user_id` under its lock and answers `lot_not_found` for a foreign lot exactly as for a missing one; a reused idempotency key never returns another account's lot |
| `business-os-entitlements` | Rule: credit files import nothing from the module | 11a adds **no** importer, no capability or tier literal, no catalog change. A source guard test pins that `creditLots.ts` and the repository import nothing from the module. `npm run test:bos-entitlements` is still run, because it covers `lib/repositories/__tests__`, `supabase/migrations/__tests__` and both registry guards |
| `business-os-schema-check` | Claims about tables and columns | 11a creates the tables, so the only live claims are "the four names are free on PROD" and "the charge functions on PROD are the bodies in `20261015`". Both are checked by the user in the runbook pre-check (§6.6 step 2), not asserted by Dev |
| `durable-queue-drain`, `bos-llm-call-standards` | Not engaged (no cron, no queue, no AI call) | — |

**Root-cause phase (V6 rule):** not applicable; 11a touches no V6 pipeline or plugin code.

**Why no `--` comments in any SQL file.** `scripts/__tests__/entitlementSqlScripts.guard.test.ts` records that two entitlement paste scripts failed in the Supabase SQL editor at tokens inside `--` comments; the mechanism was never established, and the theory once offered for it was disproven on 2026-09-24. What worked was giving the editor's parser nothing to misparse: paste files with **no comments at all**, short standalone statements, no single-letter aliases, and string literals made only of letters, digits, underscores and spaces. The slice 3 migration, checker, probe and rollback follow the same rules, and `business-os-credit-charges.migration.test.ts` enforces them. 11a's four files follow them too, and its migration test enforces the same set (SA-11 F11-16, S11-C-3). Every word of explanation therefore lives in this workplan and in `COMMENT ON` text (letters and spaces only).

---

## 2. Scope, out of scope and guardrails (11a)

**In scope (SA-11 "The split", 11a row):**
- Migration `20261017`: `business_os_credit_lots`, `business_os_credit_lot_draws`, `business_os_record_credit_lot(...)`, `business_os_reverse_credit_lot(...)`, RLS, grants — exactly as SA-11 "The tables" specifies.
- `scripts/check-bos-credit-lots-migration.sql` (rows L1–L10), `scripts/probe-bos-credit-lots-migration.sql` (P00–P18), `supabase/SQL Scripts/20261017_business_os_credit_lots_rollback.sql`.
- A local throwaway PGlite run of all four files in runbook order, recorded in §7.4.
- `lib/repositories/BusinessOsCreditLotRepository.ts` (`recordLot`, `reverseLot`, `listLotsWithDraws`, `findLotForAccount`) and its barrel export.
- `lib/business-os/credits/creditLots.ts` (S11-SQ-4).
- Registry entries for both tables; the entitlements doc paragraph.
- Tests in existing Jest locations (migration static tests incl. the L8 md5 pin, repository unit tests, core unit tests, registry guards).

**Out of scope (11a):** any route, admin op, Zod schema, audit key, UI or owner payload change (11b–11d); the typo ceiling constant (11b, S11-SQ-13); consumption draws, `'consumption'` in the `kind` CHECK, or any backfill (slice 9 / 10, S11-SQ-2 / -3, migration 20261019 held); `balance.ts` (slice 9); any boost purchase or cap table (boost slice 2); an owner-note column (S11-D-4 = A; 20261018 stays held, unused).

**Guardrails (each one is tested or checked):**

| # | Guardrail | Proven by |
|---|---|---|
| G1 | **Charge path byte-identical.** `20261015_business_os_credit_charges.sql`, its checker, probe and rollback, `BusinessOsCreditChargeRepository.ts` and `business-os-credit-charges.migration.test.ts` are not edited; the new migration names none of `business_os_credit_charges`, `business_os_credit_totals`, `business_os_record_credit_charge`, `business_os_credit_period_start` | Migration test (no such names in 20261017); `git diff --stat` shows those files untouched; checker L8 (md5 of both function bodies, column lists) and the **existing** 20261015 checker's C7 on PROD |
| G2 | **No draw of kind consumption.** The `kind` CHECK admits `'reversal'` only; the only draw writer is the reversal function | Migration test; checker L4; probe P08–P12 only ever write `reversal` |
| G3 | **Nothing wired.** No file under `app/`, `components/`, `hooks/` and no existing `lib/` file other than the barrel and the three registries is modified; nothing calls the new repository or `creditLots.ts` except their tests | `git diff --stat`; a source test that no file outside `lib/repositories/` and the tests imports `BusinessOsCreditLotRepository` / `creditLots` (pinned "no callers yet", like slice 3's sole-caller guard) |
| G4 | **No owner-visible change.** Owners gain SELECT on two empty tables through column grants; no screen or payload reads them | No owner code touched; checker L9 shows 0 lots, 0 draws after the probe |
| G5 | **Append-only by privilege.** No UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on either table for PUBLIC, anon, authenticated or service_role; no triggers | Migration test, checker L3 / L4, probe P14 |
| G6 | **No entitlements import** from any new file | Source guard test; `npm run test:bos-entitlements` |
| G7 | **No agent applies anything to any database.** The user runs the runbook on PROD by hand; PGlite is local, in memory, in the Dev scratchpad | This workplan; S11-C-5 |
| G8 | **No new CI job or step**; all tests live in suites that already run (`npm test`, `test:bos-entitlements`) | No workflow file in the diff |
| G9 | **Nothing committed** before the user has seen the diff | Dev leaves changes uncommitted; RM commits after approval |

---

## 3. Implementation Approach (11a)

Everything in §3.1–§3.3 is SA-11 "The tables" restated as the SQL I will write. Where I add detail SA did not state, it is marked **(Dev detail)**; where I would change something, it is in §10 instead and the spec is followed until SA rules.

### 3.1 The tables

**`public.business_os_credit_lots`** — columns, types and rules exactly as SA-11's table: `id` (PK, `gen_random_uuid()`), `user_id` (nullable, FK `auth.users(id) ON DELETE SET NULL`), `source`, `credits_granted numeric(18,6)`, `credits_base numeric(18,6)`, `credits_bonus numeric(18,6)`, `credit_value_version integer`, `expires_at timestamptz NULL`, `idempotency_key text`, `source_ref uuid NULL` (no FK), `actor_kind text`, `actor_admin_id uuid NULL` (no FK), `reason text NULL`, `created_at timestamptz DEFAULT now()`. Column order as listed (the migration test pins it, as slice 3 does).

Named constraints, one `ALTER TABLE … ADD CONSTRAINT` statement each (the slice 3 form, so a second paste fails cleanly at the first `CREATE TABLE`):

| Constraint | Rule |
|---|---|
| `business_os_credit_lots_pkey` | `PRIMARY KEY (id)` |
| `business_os_credit_lots_idempotency_key_key` | `UNIQUE (idempotency_key)` (plain constraint, the `ON CONFLICT` target) |
| `business_os_credit_lots_user_id_fkey` | `FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL` |
| `business_os_credit_lots_source_known` | `source IN ('admin_grant', 'boost_purchase')` |
| `business_os_credit_lots_actor_kind_known` | `actor_kind IN ('admin', 'stripe_webhook')` |
| `business_os_credit_lots_amounts_are_numbers` | `credits_granted <> 'NaN' AND credits_base <> 'NaN' AND credits_bonus <> 'NaN'` (NaN ≥ 0 is TRUE in Postgres, so the range CHECKs alone would let it through — slice 3's lesson) |
| `business_os_credit_lots_granted_positive` | `credits_granted > 0` |
| `business_os_credit_lots_parts_not_negative` | `credits_base >= 0 AND credits_bonus >= 0` |
| `business_os_credit_lots_parts_add_up` | `credits_base + credits_bonus = credits_granted` |
| `business_os_credit_lots_version_not_negative` | `credit_value_version >= 0` |
| `business_os_credit_lots_expiry_after_creation` | `expires_at IS NULL OR expires_at > created_at` |
| `business_os_credit_lots_idempotency_key_length` | `char_length(idempotency_key) BETWEEN 1 AND 200` |
| `business_os_credit_lots_reason_length` | `reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500` |
| `business_os_credit_lots_admin_grant_shape` | `source <> 'admin_grant' OR (actor_kind = 'admin' AND actor_admin_id IS NOT NULL AND reason IS NOT NULL AND source_ref IS NULL AND credits_bonus = 0 AND left(idempotency_key, 12) = 'admin_grant' \|\| chr(58))` |
| `business_os_credit_lots_boost_purchase_shape` | `source <> 'boost_purchase' OR (actor_kind = 'stripe_webhook' AND actor_admin_id IS NULL AND reason IS NULL AND source_ref IS NOT NULL AND left(idempotency_key, 6) = 'boost' \|\| chr(58))`; `expires_at` deliberately unconstrained for boost |

**(Dev detail) `chr(58)` for the colon.** SA's text writes `'admin_grant:'`, `'boost:'`, `'admin_reversal:'` and `'business_os_credit_lots:'`. A colon inside a string literal breaks the paste-file rule "literals hold only letters, digits, underscores and spaces" that the slice 3 test enforces and that 11a's test will enforce. The slice 3 probe already solves the same problem with `chr(46)` for a dot. So every one of these is written `'admin_grant' || chr(58)` etc. The **stored keys and the lock key are character-for-character what SA specified**; only the spelling in SQL differs. Confirmation asked in §10 (OP-1).

**(Dev detail) No CHECK names `user_id`** (slice 3 SF-1 / Q-8): `ON DELETE SET NULL` must never be able to violate a CHECK. Pinned by a test.

Indexes: `business_os_credit_lots_user_created_idx ON (user_id, created_at)`; the unique key's index comes from the constraint.

**`public.business_os_credit_lot_draws`** — `id` (PK), `lot_id uuid NOT NULL` (FK `business_os_credit_lots(id)`, no `ON DELETE` action: lots are never deleted), `user_id` (nullable, FK `auth.users(id) ON DELETE SET NULL`), `kind text NOT NULL`, `credits numeric(18,6) NOT NULL`, `reason text NULL`, `actor_admin_id uuid NULL` (no FK), `idempotency_key text NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`.

| Constraint | Rule |
|---|---|
| `business_os_credit_lot_draws_pkey` | `PRIMARY KEY (id)` |
| `business_os_credit_lot_draws_idempotency_key_key` | `UNIQUE (idempotency_key)` |
| `business_os_credit_lot_draws_lot_id_fkey` | `FOREIGN KEY (lot_id) REFERENCES public.business_os_credit_lots (id)` |
| `business_os_credit_lot_draws_user_id_fkey` | `FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL` |
| `business_os_credit_lot_draws_kind_known` | `kind IN ('reversal')` |
| `business_os_credit_lot_draws_credits_is_number` | `credits <> 'NaN'` |
| `business_os_credit_lot_draws_credits_positive` | `credits > 0` |
| `business_os_credit_lot_draws_idempotency_key_length` | `char_length(idempotency_key) BETWEEN 1 AND 200` |
| `business_os_credit_lot_draws_reason_length` | `reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500` |
| `business_os_credit_lot_draws_reversal_shape` | `kind <> 'reversal' OR (reason IS NOT NULL AND actor_admin_id IS NOT NULL AND left(idempotency_key, 15) = 'admin_reversal' \|\| chr(58))` |

Indexes: `business_os_credit_lot_draws_lot_idx ON (lot_id)`, `business_os_credit_lot_draws_user_created_idx ON (user_id, created_at)`. "Draw `user_id` equals its lot's" is function-enforced and checker-verified (L7 b), not a constraint (SA-11).

`COMMENT ON TABLE` / `COMMENT ON COLUMN` text (letters and spaces only) states: append-only, written only through the two functions, remaining is always rebuilt from rows, lots never touch the charge ledger, `kind` will gain `consumption` in slice 9, the per-account lock key (in words: "the advisory lock key is hashtextextended of business_os_credit_lots, a colon and the user id, seed 0").

### 3.2 The functions

Both: `LANGUAGE plpgsql`, `VOLATILE`, `SECURITY INVOKER`, `SET search_path = ''`, every name schema-qualified, OUT columns named `out_*` and no parameter or variable sharing a name with any column of either table (slice 3 C-2: avoids 42702 on the first call), no bare `CASE` inside an `IF` condition (slice 3 B-1).

**`public.business_os_record_credit_lot(p_user_id uuid, p_source text, p_credits_base numeric, p_credits_bonus numeric, p_credit_value_version integer, p_expires_at timestamptz, p_idempotency_key text, p_source_ref uuid, p_actor_kind text, p_actor_admin_id uuid, p_reason text) RETURNS TABLE (out_recorded boolean, out_lot_id uuid)`**

1. `p_user_id` or `p_idempotency_key` NULL → `RAISE … ERRCODE = '22004'`.
2. `v_base := round(p_credits_base, 6)`, `v_bonus := round(p_credits_bonus, 6)`, `v_granted := v_base + v_bonus`.
3. `INSERT INTO public.business_os_credit_lots (...) VALUES (...) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_lot_id`.
4. Inserted → return `(true, v_lot_id)`.
5. Not inserted → read the existing row by key; if `user_id = p_user_id AND source = p_source AND credits_granted = v_granted` → return `(false, existing id)`; otherwise `RAISE … ERRCODE = '23505', MESSAGE = 'idempotency key reused for a different lot'`.
6. CHECK violations surface as `23514`; NULL amounts or source fail their NOT NULL column (`23502`). 11b's pre-checks make both unreachable from the admin path (M-3).

`reason` is stored as given (11b's Zod trims it); the CHECK measures the trimmed length.

**`public.business_os_reverse_credit_lot(p_user_id uuid, p_lot_id uuid, p_credits numeric, p_idempotency_key text, p_actor_admin_id uuid, p_reason text) RETURNS TABLE (out_status text, out_draw_id uuid, out_credits numeric, out_remaining_before numeric, out_remaining_after numeric)`** — steps exactly as SA-11:

1. `p_user_id`, `p_lot_id` or `p_idempotency_key` NULL → `22004` **(Dev detail: `p_lot_id` added to the NULL refusal; a NULL lot id would otherwise fall to `lot_not_found`, which is also safe — see OP-4)**.
2. `PERFORM pg_advisory_xact_lock(hashtextextended('business_os_credit_lots' || chr(58) || p_user_id::text, 0))` — the per-account key slice 9 / 10 must reuse (S11-CR-4).
3. A draw with `p_idempotency_key` exists → if it is on `p_lot_id` and its `user_id = p_user_id`, return `already_recorded` with `out_draw_id` and `out_credits` of that draw; else raise `23505` as above. **(Dev detail: on `already_recorded`, `out_remaining_before = out_remaining_after =` the lot's remaining now, because this call changed nothing; see OP-3.)**
4. Lot not found, or `user_id IS DISTINCT FROM p_user_id` → `lot_not_found` (identical answer, no figures).
5. `expires_at IS NOT NULL AND expires_at <= now()` → `lot_expired`.
6. `v_remaining := credits_granted − coalesce(Σ draws.credits, 0)`; `<= 0` → `nothing_left`.
7. `p_credits` NULL → take `v_remaining`; else `v_credits := round(p_credits, 6)`; `v_credits <= 0` → raise `22023` **(Dev detail: SA says "raise" without a code; `22023 invalid_parameter_value` chosen — OP-5)**; `v_credits > v_remaining` → `exceeds_remaining`.
8. Insert the `reversal` row (`lot_id`, `user_id = p_user_id`, `kind = 'reversal'`, credits, reason, actor, key) and return `recorded`, draw id, credits, `v_remaining`, `v_remaining − v_credits`.

Every non-`recorded` status writes nothing. The lot row is read, never locked (F11-7: no UPDATE privilege means no `FOR UPDATE`); the advisory lock serialises every writer of the account's draws, and under READ COMMITTED each statement after the lock sees the draws committed before it (risk R-5).

**EXECUTE:** `REVOKE ALL ON FUNCTION … FROM PUBLIC`, `anon`, `authenticated`, `service_role` (four statements per function), then `GRANT EXECUTE … TO service_role`.

### 3.3 RLS and grants

Per table: `ENABLE ROW LEVEL SECURITY`; one policy `…_owner_select FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)`; `REVOKE ALL … FROM` each of PUBLIC, anon, authenticated, service_role (never an enumerated privilege list — the MAINTAIN defect); then:
- `GRANT SELECT (id, user_id, source, credits_granted, credits_base, credits_bonus, expires_at, created_at) ON TABLE public.business_os_credit_lots TO authenticated;`
- `GRANT SELECT (id, lot_id, user_id, kind, credits, created_at) ON TABLE public.business_os_credit_lot_draws TO authenticated;`
- `GRANT SELECT, INSERT ON TABLE <each> TO service_role;`

Nothing else. No table-level SELECT for `authenticated` (it would override the column list). Hidden from owners: `reason`, `actor_kind`, `actor_admin_id`, `idempotency_key`, `source_ref`, `credit_value_version`; a column added later is hidden by default. 11d's owner-repository subset test will parse these two GRANT lines from the migration (S11-SQ-10), so they are written on one line each.

### 3.4 The repository — `lib/repositories/BusinessOsCreditLotRepository.ts`

Header in the slice 3 style: what the tables are, append-only, write-only through two RPCs, **service role by design** (no client role can write; owners get their own read in 11d through the owner read repository; the account id always comes from the server-side caller, never request input), and "no caller yet: 11b is the first".

| Member | Behaviour |
|---|---|
| `BOS_RECORD_CREDIT_LOT_RPC`, `BOS_REVERSE_CREDIT_LOT_RPC` | Exported RPC names, so tests and checker speak about one thing |
| `recordLot(input)` | Input `{ accountId, source, creditsBase, creditsBonus, creditValueVersion, expiresAt: string \| null, idempotencyKey, sourceRef: string \| null, actorKind, actorAdminId: string \| null, reason: string \| null }`. Args built **field by field** into `p_*` (tenant-isolation-guard Step 3). Result `RepositoryResult<{ outcome: 'recorded' \| 'replayed'; lotId: string } \| { outcome: 'idempotency_key_conflict' }>`: the function's `23505` with the conflict message becomes the conflict outcome so 11b never parses Postgres codes; any other error is `error` |
| `reverseLot(input)` | Input `{ accountId, lotId, credits: number \| 'rest', idempotencyKey, actorAdminId, reason }` (`'rest'` → `p_credits = null`). Result data `{ status, drawId, credits, remainingBefore, remainingAfter }` with `status` validated against the six known values (`recorded`, `already_recorded`, `lot_not_found`, `lot_expired`, `nothing_left`, `exceeds_remaining`) plus `idempotency_key_conflict` from `23505`; an unknown status or unparsable figure is an `error`, never a guess |
| `listLotsWithDraws(accountId)` | Two reads, each `.eq('user_id', accountId)`: lots (explicit admin column list, `order created_at`), then draws (explicit list) filtered also by `.in('lot_id', ids)`; returns lots with their draws attached. Never `select('*')` |
| `findLotForAccount(lotId, accountId)` | `.eq('id', lotId).eq('user_id', accountId).maybeSingle()`; `data: null` when missing or foreign (F11-4 pattern) |

**Numeric parsing (the "never 0" rule):** PostgREST may return `numeric` as a JSON number or a string. A private `toCredits(value)` accepts a finite number or a string that parses to a finite number; anything else makes the whole call return `error` (`unreadable_figure`), never a 0 that would read as "nothing left". Timestamps validated the way `BusinessOsCreditOwnerReadRepository` does (`Date.parse`).

**Never throws:** every method catches (including a rejected `rpc()` promise) and returns `{ data: null, error }`; logs at `warn` with ids only (no reason text, which is admin prose).

### 3.5 The pure core — `lib/business-os/credits/creditLots.ts` (S11-SQ-4)

No imports outside the file except types; **nothing from the entitlements module, no repository import**.

```typescript
export interface CreditLotDrawForBalance { kind: 'reversal'; credits: number; createdAt: string }
export interface CreditLotForBalance {
  id: string; creditsGranted: number; expiresAt: string | null; createdAt: string;
  draws: readonly CreditLotDrawForBalance[];
}
export interface CreditLotPosition { id: string; remaining: number; expired: boolean }
export interface ExtraCreditsAt { extraCredits: number; lots: CreditLotPosition[]; hasInconsistentLot: boolean }

export function isCreditLotExpired(lot: Pick<CreditLotForBalance, 'expiresAt'>, at: Date): boolean; // expires_at <= at
export function creditLotRemaining(lot: CreditLotForBalance, at: Date): number | null;
export function extraCreditsAt(lots: readonly CreditLotForBalance[], at: Date): ExtraCreditsAt | null;
```

- Per lot: `remaining = creditsGranted − Σ reversals − Σ consumption draws` (consumption is 0 until slice 9; the type admits only `'reversal'` today, so slice 9 widens it deliberately).
- `expired = expiresAt !== null && expiresAt <= at` — the **same `<=`** as the reversal function's step 5; a test pins the comparison in both files.
- Extra credits at `at` = Σ `max(0, remaining)` over lots **not expired at `at`**, including lots created during the current period, counted from their `createdAt`.
- **(Dev detail)** A lot with `createdAt > at`, and a draw with `createdAt > at`, is ignored, so the function gives the right answer for any `at`, not only "now"; for `at = now` this is exactly SA's definition (OP-2).
- Arithmetic in integer micro-credits (`Math.round(x * 1e6)`), converted back at the end, so fractional amounts do not drift (the `creditReport.ts:137` approach).
- Any non-finite figure or unparsable date → `null` for the whole answer (the `computeCreditBalance` "no answer rather than a wrong one" rule, F11-8). A negative remaining (impossible if the function is the only writer; checker L7 a) is clamped to 0 and sets `hasInconsistentLot`, so 11c can show it rather than hide it.

### 3.6 Registries (S11-SQ-12)

| Registry | `business_os_credit_lots` | `business_os_credit_lot_draws` |
|---|---|---|
| `businessOwnedTables.ts` `USER_OWNED_TABLES` | "Credits added to the account (admin grants, later boost purchases). Keyed to auth.users, not business_profiles, so a business Reset cannot erase them" | "Credits taken back from a lot; follows the account for the same reason" |
| `purge/descriptors.ts` | `never(…, U, …)` — financial record, never purged or archived | `never(…, U, …)` |
| `purge/__tests__/classification-baseline.json` | `"never"` (added deliberately; `count` 132 → 134) | `"never"` |
| `account/accountDeletionPolicy.ts` | `minimise`: user id `ON DELETE SET NULL`, no UPDATE grant needed (the charges wording) | `minimise`, same |

Not added to `BUSINESS_OWNED_TABLES` (it would cascade from `business_profiles`).

### 3.7 Docs

`docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § Metering: a "Credits added: lots" paragraph and a table row per object (two tables, two functions), stating: append-only, the two write functions, owner column grants, the per-account lock key and that slice 9 / 10 must reuse it, the binding consumption order (plan first, then lots soonest-expiring, then no-expiry oldest first), "nothing reads or writes them before 11b; not enforced (shadow)", and the lifecycle verdicts; Last Updated and Change History. `BUSINESS_OS_CREDIT_PRICING.md` is **not** changed: lots carry the credit value version but change no price, allowance or value. The requirement's slice 11 delivery-status table is updated at hand-over (T11a.13), not in this task.

---

## 4. Files to Create / Modify (11a)

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261017_business_os_credit_lots.sql` | create | Both tables, both functions, RLS, grants (§3.1–§3.3) |
| `scripts/check-bos-credit-lots-migration.sql` | create | Read-only checker, rows L1–L10 (§6.3) |
| `scripts/probe-bos-credit-lots-migration.sql` | create | Always-rollback write probe P00–P18 (§6.4) |
| `supabase/SQL Scripts/20261017_business_os_credit_lots_rollback.sql` | create | Refusing rollback (§6.5) |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | create | Static tests of all four SQL files, incl. the L8 md5 pin |
| `lib/repositories/BusinessOsCreditLotRepository.ts` | create | §3.4 |
| `lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts` | create | One test group per method, plus source guards |
| `lib/repositories/index.ts` | modify | Barrel export of the class, singleton and types |
| `lib/business-os/credits/creditLots.ts` | create | §3.5 |
| `lib/business-os/credits/__tests__/creditLots.test.ts` | create | Core cases + the `<=` cross-file pin + the no-entitlements-import guard |
| `lib/business-os/businessOwnedTables.ts` | modify | Two `USER_OWNED_TABLES` entries |
| `lib/business-os/purge/descriptors.ts` | modify | Two `never` descriptors |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | Two entries, count 134 |
| `lib/business-os/account/accountDeletionPolicy.ts` | modify | Two `minimise` entries |
| `lib/business-os/account/__tests__/accountDeletionPolicy.test.ts` | modify | Assert both verdicts and the `ON DELETE SET NULL` reason |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | § Metering paragraph + Change History |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md` | modify | Ticks, evidence, PGlite record |

**Not touched (G1):** `supabase/migrations/20261015_business_os_credit_charges.sql`, `scripts/check-bos-credit-charges-migration.sql`, `scripts/probe-bos-credit-charges-migration.sql`, `supabase/SQL Scripts/20261015_business_os_credit_charges_rollback.sql`, `supabase/migrations/__tests__/business-os-credit-charges.migration.test.ts`, every `lib/business-os/entitlements/**` file, every route and component.

---

## 5. Task List (11a)

- [x] ✅ **T11a.0 Pre-flight.** `git branch --show-current` = `feature/business-os-credit-deduction-slice-11`; `git status` recorded; confirm no `20261017*` file exists.
- [x] ✅ **T11a.1 Migration.** Write `20261017_business_os_credit_lots.sql`: `BEGIN; SET LOCAL lock_timeout = '5s';`, tables, constraints, indexes, comments, RLS, policies, revokes, grants, both functions, function revokes and grants, `COMMIT;`. No `--`, no `/*`, literal charset rule, `chr(58)` for colons.
- [x] ✅ **T11a.2 Migration tests, part 1** (`business-os-credit-lots.migration.test.ts`): paste safety (copy the slice 3 helpers `literalsOf`, `bareCaseInIfConditions`, `functionText` into the new test file rather than importing across test files); structure, columns, constraints, grants, functions (§7.1).
- [x] ✅ **T11a.3 Checker** `check-bos-credit-lots-migration.sql`, L1–L10, row 0 the verdict, `SET default_transaction_read_only = on;` then one `SELECT`.
- [x] ✅ **T11a.4 L8 pin.** In the test: extract the bodies of `business_os_record_credit_charge` (`$record$`) and `business_os_credit_period_start` (`$period$`) from `20261015`, strip `\r`, compute `md5` with Node `crypto`, and assert the checker contains exactly those two constants inside `md5(replace(prosrc, chr(13), ''))` comparisons; also derive the charges and totals column lists from `20261015` and assert the checker's L8 lists equal them.
- [x] ✅ **T11a.5 Probe** `probe-bos-credit-lots-migration.sql`, P00–P18 (§6.4), one `DO $probe$` block that always raises.
- [x] ✅ **T11a.6 Rollback** script (§6.5).
- [x] ✅ **T11a.7 Migration tests, part 2:** checker drift (every constraint, index, FK, policy and function name of the migration appears in the checker), probe structure, rollback structure.
- [x] ✅ **T11a.8 PGlite run** in the Dev scratchpad (§7.4), all four files in runbook order plus the extra direct cases; record results in §7.4.
- [x] ✅ **T11a.9 Core** `creditLots.ts` + tests.
- [x] ✅ **T11a.10 Repository** + tests + barrel export.
- [x] ✅ **T11a.11 Registries** (four files) + `accountDeletionPolicy.test.ts`.
- [x] ✅ **T11a.12 Docs** (entitlements § Metering).
- [x] ✅ **T11a.13 Gates and hand-over.** Run §7.5's commands; `git diff --stat` reviewed (no deletion-without-insertion; G1 files absent); record evidence; status → Code Complete (11a); the slice 11 delivery-status row in the requirement updated (agreed with TL, since this task does not edit the requirement); uncommitted; hand back to TL for SA code review.

---

## 6. Migration, checker, probe, rollback and the PROD runbook

### 6.1 Migration outline

**File:** `supabase/migrations/20261017_business_os_credit_lots.sql` (outline; the explanatory notes here will **not** be in the file)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.business_os_credit_lots ( ... CONSTRAINT business_os_credit_lots_pkey PRIMARY KEY (id) );
ALTER TABLE public.business_os_credit_lots ADD CONSTRAINT ... ;
CREATE INDEX business_os_credit_lots_user_created_idx ON public.business_os_credit_lots (user_id, created_at);
CREATE TABLE public.business_os_credit_lot_draws ( ... );
ALTER TABLE public.business_os_credit_lot_draws ADD CONSTRAINT ... ;
CREATE INDEX business_os_credit_lot_draws_lot_idx ON public.business_os_credit_lot_draws (lot_id);
CREATE INDEX business_os_credit_lot_draws_user_created_idx ON public.business_os_credit_lot_draws (user_id, created_at);
COMMENT ON TABLE ... ;
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_os_credit_lots_owner_select ON public.business_os_credit_lots FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY business_os_credit_lot_draws_owner_select ON public.business_os_credit_lot_draws FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON TABLE public.business_os_credit_lots FROM PUBLIC;
REVOKE ALL ON TABLE public.business_os_credit_lots FROM anon;
REVOKE ALL ON TABLE public.business_os_credit_lots FROM authenticated;
REVOKE ALL ON TABLE public.business_os_credit_lots FROM service_role;
GRANT SELECT (id, user_id, source, credits_granted, credits_base, credits_bonus, expires_at, created_at) ON TABLE public.business_os_credit_lots TO authenticated;
GRANT SELECT, INSERT ON TABLE public.business_os_credit_lots TO service_role;
CREATE FUNCTION public.business_os_record_credit_lot(...) RETURNS TABLE (out_recorded boolean, out_lot_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $record_lot$ ... $record_lot$;
CREATE FUNCTION public.business_os_reverse_credit_lot(...) RETURNS TABLE (out_status text, ...)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $reverse_lot$ ... $reverse_lot$;
REVOKE ALL ON FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_os_record_credit_lot(...) TO service_role;
COMMIT;
```

(The draws table repeats the revoke and grant block; each function gets four revokes and one grant.) Plain `CREATE`, not `IF NOT EXISTS`: a second paste fails at the first `CREATE TABLE` with `relation "business_os_credit_lots" already exists` and changes nothing. No data, no backfill. Applying 20261017 before the deferred 20261016 (slice 4c) is fine: they are independent (S11-SQ-8).

### 6.2 What the migration test pins (summary; full list in §7.1)

No `SECURITY DEFINER`, no `TRIGGER`, `REVOKE ALL` (never an enumerated list) for each of the four roles on all four objects, exactly the six GRANTs above each after every REVOKE of its object, no table-level SELECT for `authenticated`, the owner column lists exact, the shape CHECKs exact, no CHECK naming `user_id`, no FK on `actor_admin_id` or `source_ref`, `ON CONFLICT (idempotency_key) DO NOTHING`, the advisory lock call and key spelled exactly, the `<=` expiry comparison, `kind` only `'reversal'`, and none of the four charge-path names anywhere in the file.

### 6.3 The read-only checker — `scripts/check-bos-credit-lots-migration.sql`

`SET default_transaction_read_only = on;` then one `SELECT` (the editor shows only the last result): one PASS / FAIL / INFO row per check, row 0 `VERDICT PASS n pass 0 fail` or `VERDICT FAIL …`. Paste rules as above. Privileges read with `aclexplode` (so MAINTAIN, TRUNCATE, REFERENCES and TRIGGER are all seen) and `has_column_privilege` per column.

| Row | Check | Pass when |
|---|---|---|
| L1 | Tables, RLS, policies | Both tables exist, RLS on; exactly one policy each, permissive, `FOR SELECT`, `TO authenticated`, `USING` naming `auth.uid()` and `user_id`, no `WITH CHECK` |
| L2 | Owner grants | `authenticated` holds SELECT on **exactly** the listed columns (compared both ways) and no table-level privilege; it can write no column; PUBLIC and anon hold nothing at table or column level |
| L3 | service_role and writes | `service_role` holds exactly `SELECT, INSERT` on both; no role other than the owner holds UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on either |
| L4 | Constraints | Every named CHECK (12 on lots, 6 on draws — the counts the test derives from the migration), both UNIQUE keys, exactly three FKs (`lots.user_id → auth.users SET NULL`, `draws.user_id → auth.users SET NULL`, `draws.lot_id → lots`), no FK on `actor_admin_id` or `source_ref`, the three indexes by name, no trigger on either table |
| L5 | Functions | Both exist with the exact signatures (`to_regprocedure`), `prosecdef = false`, `proconfig = {search_path=""}` |
| L6 | EXECUTE | Both: explicit ACL; EXECUTE for `service_role`; none for PUBLIC, anon, authenticated |
| L7 | Rebuild parity | (a) no lot with `credits_granted − Σ draws < 0`; (b) every draw's `user_id` equals its lot's (or both NULL); (c) no draw older than its lot; (d) per account, Σ per-lot remaining (GROUP BY lot, then account) equals Σ granted − Σ draws (GROUP BY account), compared both ways with a FULL OUTER JOIN; (e) every key's prefix matches its source / kind |
| L8 | Charge path untouched | `md5(replace(prosrc, chr(13), ''))` of `business_os_record_credit_charge` and `business_os_credit_period_start` equal the constants the Jest test computes from `20261015`; the column lists of charges and totals (from `information_schema.columns`, ordered) equal the lists in `20261015` |
| L9 | INFO | Lots by source, draws by kind, accounts with lots, unexpired remaining total, first `created_at` printed in UTC with a ` utc` suffix (`none` when empty) |
| L10 | INFO | Checked at, UTC |

### 6.4 The mandatory write probe — `scripts/probe-bos-credit-lots-migration.sql`

One `DO $probe$` block that **always ends in `RAISE EXCEPTION`**, so nothing it writes survives (the slice 3 C-1 precedent, stronger than `BEGIN … ROLLBACK`). It runs on the user's own account through `v_owner_text := 'PASTE_YOUR_OWN_USER_ID_HERE'`. Before anything else, three guards raise `PROBE SKIPPED` and run nothing: placeholder left in; not a valid uuid; read-only session. A fourth: the id is not a row of `auth.users` (`PROBE SKIPPED  that user id is not an account on this database`). `SET LOCAL ROLE service_role` before every write; `SET LOCAL ROLE authenticated` with `request.jwt.claims` set through `set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'), json_build_object('sub', …, 'role', 'authenticated')::text, true)` for the RLS steps (slice 3's exact form). Each refusal is caught in its own sub-block and compared with the expected SQLSTATE. Keys are minted per run from `gen_random_uuid()`, prefixed with `'admin_grant' || chr(58)` etc.

| Id | As | Proves |
|---|---|---|
| P00 | postgres | INFO: lots, draws, charges and totals row counts before |
| P01 | service_role | An admin grant (100.5 credits, expiry `now() + 30 days`) → `out_recorded = true`, a lot id; stored row has `credits_granted = 100.500000`, `credits_bonus = 0`, `actor_kind = 'admin'` |
| P02 | service_role | Same key, same account and amount → `out_recorded = false`, same id, lots count unchanged |
| P03 | service_role | Same key, different amount → `23505`, nothing written |
| P04 | service_role | Unknown source → `23514`, nothing written |
| P05 | service_role | Admin grant with no reason / with a `source_ref` / with a bonus / with a wrong key prefix → each `23514` |
| P06 | service_role | Credits 0, negative, `'NaN'` → each `23514` |
| P07 | service_role | A boost-shaped lot (`stripe_webhook`, `source_ref`, bonus > 0, `boost:` key) accepted; the same with `actor_kind = 'admin'` → `23514` |
| P08 | service_role | Partial reversal of P01's lot (40) → `recorded`, before 100.5, after 60.5; the lot row unchanged |
| P09 | service_role | Same reversal key → `already_recorded`, same draw id, draws count unchanged |
| P10 | service_role | Reverse 61 → `exceeds_remaining`, nothing written |
| P11 | service_role | Reverse "the rest" (NULL) → `recorded`, credits 60.5, after 0 |
| P12 | service_role | Again → `nothing_left`, nothing written |
| P13 | service_role | P01's lot under a stranger's id → `lot_not_found`, nothing written |
| P14 | service_role | UPDATE, DELETE, TRUNCATE on each table → each `42501` |
| P15 | authenticated (owner claims) | Direct INSERT into each table → `42501`; EXECUTE of each function → `42501`; own lots and draws readable through the granted columns; SELECT of `reason` and of `idempotency_key` → `42501` |
| P16 | authenticated (stranger claims) | Sees none of the probe's lots or draws |
| P17 | postgres | Charges and totals row counts equal P00's (checked after every write step and reported once) |
| P18 | — | INFO: `lot_expired` cannot be produced in one transaction (`now()` is fixed and the CHECK forbids a past expiry); it is covered by the migration tests and the PGlite run |

Expected: an error starting `PROBE PASS  this error is expected and rolls everything back`, then one line per id P00 to P18 (P00, P18 INFO; the rest PASS). Any FAIL line makes it `PROBE FAIL …`.

### 6.5 Rollback — `supabase/SQL Scripts/20261017_business_os_credit_lots_rollback.sql`

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.business_os_credit_lots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.business_os_credit_lot_draws IN ACCESS EXCLUSIVE MODE;
DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_credit_lots AS lot_row) OR EXISTS (SELECT 1 FROM public.business_os_credit_lot_draws AS draw_row) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the credit lots tables hold rows so nothing was dropped';
  END IF;
END
$refuse$;
DROP FUNCTION public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text);
DROP FUNCTION public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text);
DROP TABLE public.business_os_credit_lot_draws;
DROP TABLE public.business_os_credit_lots;
COMMIT;
```

It locks both tables first, so no row can land between the check and the drop; on `ROLLBACK REFUSED` the transaction aborts and nothing changes. **Preferred rollback is code-only** (revert 11a; nothing calls the tables, so the empty tables can simply stay). The DB rollback is for a wrong migration while the tables are empty. It must never run once 11b is deployed. Removing tables that hold credits is a separate decision (export first, SA rules); this script never does it.

### 6.6 11a on PROD: the exact steps (by the user, Supabase SQL editor)

Nothing here needs a terminal. Paste each file **whole**, as its own run. Nothing is applied by Dev or any agent. 11b does not merge until steps 4–8 are pasted into §17 (S11-C-5).

1. **(Optional) Where you are.** Make sure the SQL editor is on the **production** project.
2. **Pre-check: the names are free and the charge path is as the repository says.** Run:
   ```sql
   SELECT to_regclass('public.business_os_credit_lots') AS lots,
          to_regclass('public.business_os_credit_lot_draws') AS draws,
          to_regprocedure('public.business_os_record_credit_lot(uuid,text,numeric,numeric,integer,timestamptz,text,uuid,text,uuid,text)') AS record_fn,
          to_regprocedure('public.business_os_reverse_credit_lot(uuid,uuid,numeric,text,uuid,text)') AS reverse_fn;
   ```
   Expect all four `NULL`. Anything else: stop, it is already (partly) applied; send the row to Dev. **Then** run the second pre-check that this workplan adds (OP-6):
   ```sql
   SELECT proname, md5(replace(prosrc, chr(13), '')) AS body_md5
   FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
   WHERE pg_namespace.nspname = 'public'
     AND proname IN ('business_os_record_credit_charge', 'business_os_credit_period_start')
   ORDER BY proname;
   ```
   Then run `SELECT current_setting('server_version') AS server_version;` and paste the value into §17 beside the PGlite version in §7.4 (W11a-9).

   Expect the md5 query to return two rows whose `body_md5` values equal the two constants printed in §6.7 (filled in by Dev at T11a.4). If either differs, **stop before applying**: the charge functions on PROD are not the ones in the repository, which needs investigating on its own, and L8 would fail for a reason 11a did not cause.
3. **Apply.** Open `supabase/migrations/20261017_business_os_credit_lots.sql`, copy all of it, paste, Run. Expect `Success. No rows returned`. It is one transaction: on any error nothing is kept. A second paste fails at the first `CREATE TABLE` with `relation "business_os_credit_lots" already exists` and changes nothing: if you see exactly that, it was already applied — do not escalate.
4. **Record the apply time.** Immediately run `SELECT now() AT TIME ZONE 'UTC' AS applied_at_utc;` and paste the value into §17.
5. **New checker.** Paste `scripts/check-bos-credit-lots-migration.sql`, Run. Expect row 0 `VERDICT PASS` and every row PASS or INFO; L9 reads `0 lots and 0 draws and 0 accounts and 0 unexpired credits and first lot at none`. Any FAIL: stop and send the grid to Dev. If the migration itself is wrong, the rollback is `supabase/SQL Scripts/20261017_business_os_credit_lots_rollback.sql`; it works only while both tables are empty, as they are now. It contains `DROP`, so the editor will likely warn that the query is destructive: confirm that warning **only when Dev has told you to run the rollback**; otherwise cancel. If it ever answers `ROLLBACK REFUSED  the credit lots tables hold rows so nothing was dropped`, nothing was changed: stop and send the message to Dev.
6. **Existing ledger checker (the charge path untouched).** Paste `scripts/check-bos-credit-charges-migration.sql`, Run. Expect row 0 `VERDICT PASS` and the C7 rebuild row PASS, exactly as before 11a (the C7 INFO counts are whatever the live ledger holds; they are not expected to be zero any more). Any FAIL, or C7 not PASS: stop and send the grid to Dev (CR11a-3).
7. **Your user id.** Run `SELECT id FROM auth.users WHERE email = '<your login email>';`, replacing `<your login email>` with your email, angle brackets included, keeping the quotes (so `'name@example.com'`), and copy the id.
8. **Write probe (mandatory).** Open a **new SQL editor tab** (the checkers leave their tab read-only). Open `scripts/probe-bos-credit-lots-migration.sql`, replace `PASTE_YOUR_OWN_USER_ID_HERE` (third line) with your id, keeping the quotes and with no spaces inside them, paste the whole file, Run. The editor may warn about destructive operations (`UPDATE`, `DELETE`, `TRUNCATE`): that is expected here, **confirm it** — those statements are there to prove the database refuses them, and the whole block always rolls back. **It always ends in an error on purpose.** Expect the text to start `PROBE PASS  this error is expected and rolls everything back`, with lines P00 to P18 (P00 and P18 INFO, the rest PASS). Three `PROBE SKIPPED` answers mean nothing ran; fix and re-run:
   - `PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE …`: paste your id over the placeholder.
   - `PROBE SKIPPED  the pasted value is not a valid user id …`: paste only the id from step 7, between the quotes, no spaces.
   - `PROBE SKIPPED  this session is read only …`: you are in a checker's tab. Open a new tab, or run `RESET default_transaction_read_only;` on its own first, then the probe again.

   `PROBE FAIL …`, any other `PROBE SKIPPED …` (for example `that user id is not an account on this database`) or any other error: stop and send the full text to Dev; 11b does not merge.
9. **Nothing kept.** Run **both** checkers again (step 5's, then step 6's). Expect the same `VERDICT PASS` on each; the new checker's L9 still `0 lots and 0 draws`.
10. **Paste into §17:** the step 2 rows (both), the apply time (step 4), the new checker grid (step 5), the existing checker's verdict and C7 rows (step 6), the probe's full error text (step 8), and both checkers' verdict rows plus L9 from step 9.

### 6.7 L8 constants

| Function | `md5` of the body in `20261015` (`\r` stripped) |
|---|---|
| `business_os_record_credit_charge` | `a7aa425de95fe06da72d31257f7818a2` |
| `business_os_credit_period_start` | `b00af2d2c4738e51e08e2ec92195077e` |

Computed by Dev at T11a.4 (2026-10-02) from the LF-normalised bodies in `20261015`, and pinned by `business-os-credit-lots.migration.test.ts` (which recomputes both and fails if this table or the checker drifts). Both values were also reproduced by `md5(replace(prosrc, chr(13), ''))` on PGlite after applying the CRLF working-tree copy of `20261015` (§7.4).

---

## 7. Test Plan and commands (11a)

All tests are static or unit tests in existing Jest locations; no database is contacted. They run in `npm test` and, for the migration, repository and registry tests, in `npm run test:bos-entitlements` — no new CI job or workflow step.

### 7.1 `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts`

- **Paste safety (all four files):** exist; no `--`, no `/*`; literals only `[A-Za-z0-9_ ]`; no single-letter alias; no bare `CASE` in an `IF` condition; probe and checker split into standalone statements.
- **Structure:** exactly one `BEGIN;` / `COMMIT;` with the lock timeout; exactly 2 `CREATE TABLE`, 2 `CREATE FUNCTION`; no `SECURITY DEFINER`, no `TRIGGER`, no `IF NOT EXISTS`; none of the four charge-path names; no `token_usage` / Pilot-Credit table name.
- **Columns:** both tables' columns in order, with types and nullability; `numeric(18,6)` on every credit column.
- **Constraints:** each named CHECK's exact text (shape CHECKs included, with `chr(58)`); `kind` admits only `'reversal'`; `source` both values; no CHECK names `user_id`; FKs (targets and `ON DELETE SET NULL`); no FK on `actor_admin_id` / `source_ref`; indexes.
- **Privileges:** RLS on both; one owner SELECT policy each, `(SELECT auth.uid()) = user_id`; `REVOKE ALL` × 4 roles × 4 objects; exactly six table GRANTs + two EXECUTE grants, each after every REVOKE of its object; no table-level SELECT for `authenticated`; owner column lists exactly SA's; no UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER anywhere.
- **Record function:** signature; `SECURITY INVOKER`, `VOLATILE`, `SET search_path = ''`; OUT columns `out_*` and no parameter / variable equal to any column; refuses NULL user or key with `22004`; `round(…, 6)`; `ON CONFLICT (idempotency_key) DO NOTHING`; the conflict branch compares `user_id`, `source`, `credits_granted` and raises `23505`; every table name schema-qualified.
- **Reverse function:** signature and attributes; the advisory lock line exactly (`pg_advisory_xact_lock(hashtextextended('business_os_credit_lots' || chr(58) || p_user_id::text, 0))`) and before any read; the step order (key, lot, expiry, remaining, amount, insert) by position in the body; the six status literals and nothing else; `expires_at <= now()`; the foreign-lot branch returns the same `lot_not_found` as the missing-lot branch; `p_credits` NULL means the rest; inserts only `kind = 'reversal'`; never names `business_os_credit_lots` in an UPDATE/DELETE.
- **Checker:** read-only and one SELECT; rows L1–L10 and a verdict; names every constraint, index, FK, policy and function of the migration (drift guard); the CHECK list equals the migration's; owner column lists equal the migration's GRANT lines; **L8 constants equal the md5 of the `20261015` bodies** and its column lists equal `20261015`'s.
- **Probe:** one `DO` block ending in `RAISE EXCEPTION … PROBE …`; the placeholder and the three guards in order before any role switch or write; `SET LOCAL ROLE service_role` before the first write; ids P00–P18 present; P14's UPDATE / DELETE / TRUNCATE present for both tables; P15 / P16 use the `set_config(concat_ws(chr(46) …` form.
- **Rollback:** outside `supabase/migrations/`; locks both tables, then the refusal, before any `DROP`; drops exactly two functions (exact signatures) then draws then lots.

### 7.2 Unit tests

| File | Cases |
|---|---|
| `lib/business-os/credits/__tests__/creditLots.test.ts` | Empty list → 0; one lot, no draws; fractional amounts (`0.1 + 0.2`-style) exact to 6 dp; partial and full reversal (fully reversed lot counts 0 and is listed); lot created mid-period counts from its `createdAt`; lot created after `at` ignored; draw after `at` ignored; expiry exactly at `at` → expired (and 1 ms later → not counted, 1 ms before → counted); no-expiry lot; negative remaining clamped + `hasInconsistentLot`; non-finite figure / bad date → `null`. **Cross-file pin:** the migration's reverse function uses `expires_at <= now()` and `creditLots.ts` uses `<=`. **Source guard:** `creditLots.ts` and `BusinessOsCreditLotRepository.ts` import nothing from `lib/business-os/entitlements`, and nothing outside tests imports either new file yet (G3) |
| `lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts` | `recordLot`: args field by field (an extra injected property, e.g. `user_id`, never reaches the RPC); `recorded` / `replayed`; `23505` with the conflict message → `idempotency_key_conflict`; other error → `error`; rejected promise → `error`, no throw. `reverseLot`: `'rest'` → `p_credits: null`; each of the six statuses mapped; unknown status → `error`; numeric strings parsed; unparsable figure → `error`, never 0. `listLotsWithDraws`: `.eq('user_id', accountId)` on both reads; explicit column lists (no `*`); draws attached to the right lots; empty account → `[]` without a second read. `findLotForAccount`: `.eq('id')` and `.eq('user_id')`; not found → `data: null`. **Source guard:** no `.insert(`, `.update(`, `.delete(`, `.upsert(` in the file; default client is `supabaseServer`; RPC names equal the migration's function names |
| `lib/business-os/account/__tests__/accountDeletionPolicy.test.ts` | Both tables `minimise`, reason mentions `ON DELETE SET NULL` |
| Existing guards, unedited | `businessOwnedTables.test.ts` (every `CREATE TABLE` classified), `descriptors.invariant.test.ts` (baseline, levels), `business-os-credit-charges.migration.test.ts` (still green, untouched) |

### 7.3 Tenant isolation (tenant-isolation-guard Step 7)

At 11a the boundary is in SQL and the repository: P13 (stranger id → `lot_not_found`, nothing written), P16 (stranger sees nothing), P03 / P09 key-reuse rules, the repository's field-by-field args test. The route-level tests (lot of another account → 404 and the reversal function never called; injected `accountId` / `userId` in the body → 400) belong to 11b.

### 7.4 Throwaway PGlite run (local only; result recorded here at T11a.8)

PGlite is **not** a repo dependency, and this task may not run `npm install`. A PGlite 0.5.8 install (PostgreSQL 18.3, the version slice 3b-i used) already exists in an earlier session's scratchpad; the harness will import it by absolute path from this session's scratchpad. If it is no longer there, Dev stops and asks TL whether installing it **inside the scratchpad** is allowed — Dev does not install anything without that.

Harness (scratchpad, outside the repo): stub roles `anon`, `authenticated`, `service_role`, `postgres`-owned schema `auth` with `users` and `auth.uid()` reading `request.jwt.claims`, the `20261015` migration applied first (so L8 and the existing checker run), session `TimeZone = Asia/Jerusalem`. Order and expected results:

| Step | Expect |
|---|---|
| Pre-check (both queries) | four `NULL`; the two md5 values equal §6.7 |
| Migration | applies; second paste fails with `already exists`, nothing changed |
| New checker | `VERDICT PASS`, L9 empty |
| Existing checker | `VERDICT PASS`, C7 PASS |
| Probe, placeholder left in / bad id / read-only session / unknown user | the four `PROBE SKIPPED` texts |
| Probe with a seeded user | `PROBE PASS`, P00–P18 |
| Both checkers again | unchanged, L9 empty |
| Direct extras (as `postgres`, then `service_role`) | a lot inserted directly with backdated `created_at` and past `expires_at` → reverse answers `lot_expired`, nothing written; **sequential case (W11a-2):** a second reversal in a new transaction sees the first one's draw and answers from the reduced remaining; NaN / zero / negative credits → `22023` (W11a-3); a draw whose `user_id` differs from its lot's (inserted directly as `postgres`) → L7 (b) FAIL (negative control), then removed; checker `VERDICT PASS` with real lots and draws (L7 parity with data). PGlite runs a single backend, so concurrent serialisation on the advisory lock is **not** tested |
| Rollback with a row | `ROLLBACK REFUSED …`, everything remains |
| Rollback, emptied | drops all four objects |
| Re-apply | applies again; checker `VERDICT PASS` |

### 7.5 Commands Dev will run before hand-over

```bash
npx jest supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts supabase/migrations/__tests__/business-os-credit-charges.migration.test.ts lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts lib/business-os/credits lib/business-os/purge lib/business-os/account lib/business-os/__tests__/businessOwnedTables.test.ts scripts/__tests__/entitlementSqlScripts.guard.test.ts
npm run test:bos-entitlements
npm run typecheck:bos-llm
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p <scratchpad>/tsconfig.slice11a.json
npx eslint lib/repositories/BusinessOsCreditLotRepository.ts lib/business-os/credits/creditLots.ts lib/repositories/index.ts lib/business-os/businessOwnedTables.ts lib/business-os/purge/descriptors.ts lib/business-os/account/accountDeletionPolicy.ts
git diff --stat
```

The scoped type program (`tsconfig.slice11a.json` in the scratchpad, extending the repo's `tsconfig.json` with `files` = the new and modified `.ts` files) reports errors in the touched files only; pre-existing errors outside them are listed, not fixed. ts-jest does not type-check in this repo, so this run is the type gate. **`next build` is not run for 11a**: no route, page or client file changes, and the earlier build runs needed a scratch export that put the shared `node_modules` junction at risk. If SA wants it, it runs only in a way that never removes the junction.

### 7.6 Results (Dev, 2026-10-02)

**PGlite run (T11a.8, W11a-9).** Local only, in memory. The harness `lots-run.mjs` lives in this session's scratchpad, not in the repo, and imports PGlite read-only from the earlier session's scratchpad install; nothing was installed. **PGlite 0.5.8; `SELECT version()` = PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten; `server_version` 18.3.** Session `TimeZone = Asia/Jerusalem`. Stubs: roles `anon`, `authenticated`, `service_role` (BYPASSRLS), Supabase-style default privileges (ALL to the three roles), `auth.users`, `auth.uid()` reading `request.jwt.claims`, `business_os_account_plans`. `20261015` was applied first, from the CRLF working-tree copy. Result: **78 checks OK, 0 failed.**

| Step | Outcome |
|---|---|
| Pre-check (names; md5) | Four `NULL`s; both md5 values equal §6.7 (computed on PGlite with `replace(prosrc, chr(13), '')` over the CRLF copy) |
| Migration | Applies; a second paste fails with `relation "business_os_credit_lots" already exists` and the object count is unchanged |
| New checker | `VERDICT PASS` (23 pass, 0 fail); L9 reads `0 lots and 0 draws and 0 accounts and 0 unexpired credits and first lot at none` |
| Existing checker (20261015) | `VERDICT PASS` (19 pass); C7 PASS |
| Probe guards | Placeholder, bad id, read-only session and unknown user each give their `PROBE SKIPPED` text |
| Probe, seeded user | `PROBE PASS  this error is expected and rolls everything back`; P00 INFO, P01–P17 PASS, P18 INFO |
| Both checkers again | `VERDICT PASS`; L9 still `0 lots and 0 draws` |
| Direct extras | Backdated lot with a past expiry → `lot_expired`, nothing written. Sequential case: lot of 100 → reverse 30 (tx 1) → reverse 80 in tx 2 gives `exceeds_remaining` (it sees tx 1's draw) → reverse 70 `recorded`, 70 → 0. Replay of tx 1's key → `already_recorded`, both figures = remaining now (0, OP-3). NaN, 0, negative and rounds-to-zero credits → `22023` (W11a-3). NULL lot id or user → `22004` (OP-4). NULL source → `23502`. Past expiry, a 2-character trimmed reason, a reversal without a reason and a wrong draw key prefix → `23514`. The same lot key on another account, and a reversal key already used on another account → `23505` with the function's message. A real lot of another real account and a missing lot → the same `lot_not_found` with null figures. 6 dp rounding (5.1234567 → 5.123457) |
| Checker with real lots and draws | `VERDICT PASS` (L7 a–e PASS with 4 lots, 3 draws, 2 accounts) |
| Negative controls | Foreign draw → L7 (b) FAIL; overdrawn lot → L7 (a) FAIL; changed period function body → L8 FAIL; added charges column → L8 columns FAIL; owner granted `reason` → L2 FAIL; service_role granted UPDATE → L3 FAIL; authenticated granted EXECUTE → L6 FAIL; a trigger → L4 FAIL; SECURITY DEFINER → L5 FAIL; `kind` admitting `consumption` → L4 FAIL. The checker is back to PASS afterwards |
| Rollback with rows | `ROLLBACK REFUSED  the credit lots tables hold rows so nothing was dropped`; nothing changed |
| Rollback, emptied | Drops all four objects; the existing checker still passes |
| Re-apply | Applies; checker `VERDICT PASS` |

**Not covered by PGlite (W11a-2).** Concurrent serialisation on the advisory lock (PGlite has a single backend), and the native-`23505` race of W11a-4 (it needs two sessions). The repository test covers W11a-4's mapping. **PG 18-only reliance:** none required. The checker names `MAINTAIN` (PG 17+) in L3's privilege list; on an older server that value never appears, which is harmless. `array_to_string(proargtypes::regtype[], ' ')` and `aclexplode` over column ACLs work on every supported version.

**Jest (all green unless noted).**

| Suite | Result |
|---|---|
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` (new) | 92 passed |
| `lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts` (new) | 54 passed |
| `lib/business-os/credits/__tests__/creditLots.test.ts` (new) | 34 passed |
| `lib/business-os/account/__tests__/accountDeletionPolicy.test.ts` (modified) | 12 passed |
| §7.5 scoped set (25 suites, incl. `business-os-credit-charges.migration.test.ts`, purge, account, `businessOwnedTables.test.ts`, `entitlementSqlScripts.guard.test.ts`) | 660 passed, **2 failed, both pre-existing**, in `lib/business-os/credits/__tests__/creditPeriod.test.ts` (a source guard over `creditPeriod.ts`; 11a touches neither file; it fails on the CRLF working copy) |
| `npm run test:bos-entitlements` | 104 suites, 2,322 tests passed |

**Types and lint.** Scoped `tsc` (6 GB heap, `tsconfig.slice11a.json` in the scratchpad, over the 10 new or modified `.ts` files): **touched files clean**. 3 pre-existing errors sit in files the barrel pulls in (`lib/pilot/insight/MemoryManager.ts` ×2, `lib/repositories/CalibrationSessionRepository.ts` ×1); they are listed, not fixed. `npm run typecheck:bos-llm`: passed (364 files, 0 new errors). `eslint` on the 10 touched TS files: clean. `next build` was not run (W11a-10).

**How each SA condition was applied.**

| Condition | Where |
|---|---|
| W11a-1 | Every `chr(58)` next to a comparison is in brackets (`= ('admin_grant' \|\| chr(58))`), in the CHECKs and in checker L7 (e). A migration test fails on the unbracketed form and has a negative control. Probe P01, P07 and P08 read the stored key back and check its prefix. The repository header and the entitlements doc write the keys in SA's canonical form |
| W11a-2 | The two-session row is gone from §7.4 and the R-5 clause is replaced. A sequential PGlite case is added, plus a static test that the lock comes before the first read |
| W11a-3 | `IF v_credits = 'NaN'` raises `22023` before the `<= 0` check; a static order test and a PGlite case |
| W11a-4 | The repository maps any `23505` from either RPC to `idempotency_key_conflict`, by SQLSTATE. Tested with the function's message and with a native unique-violation message, for both RPCs |
| W11a-5 | The migration test recomputes both md5 values from `20261015` and asserts the checker and §6.7 hold them. It fails if any other `.sql` under `supabase/migrations/` or `supabase/SQL Scripts/` names a charge object |
| W11a-6 | All COMMENT text uses only letters, digits, underscores and spaces (enforced by the literal-charset test on every literal) |
| W11a-7 | The G3 guard in `creditLots.test.ts` allows the barrel as the one re-export. It searches the exported symbol names and both RPC names across `app`, `lib`, `components`, `hooks`, `scripts` and `pages` |
| W11a-8 | Exactly one array row is required. A non-boolean `out_recorded`, a non-uuid id, an unknown status, or an unparsable figure on `recorded` / `already_recorded` is an `error`. The other statuses return null figures. Warn logs carry ids and SQLSTATE only |
| W11a-9 | PGlite versions recorded above. Runbook step 2 gains `SELECT current_setting('server_version')`, and §17 gains a row for it |
| W11a-10 | The requirement's slice 11 delivery-status row "11a" is updated (that row only). Scoped `tsc` is the type gate; no `next build` |

**Deviations from the workplan text (for SA code review).**

1. **L5 compares argument types with `array_to_string(proargtypes::regtype[], ' ')`, not `to_regprocedure`.** A `to_regprocedure` literal needs dots, brackets and commas, which the paste-file charset forbids. Also, `proargtypes` is a 0-based `oidvector`, so comparing it with `=` to a 1-based array is always false (found on PGlite). The text comparison also checks `proargnames` (parameters and OUT columns) and stays inside the charset.
2. **L9 is two INFO rows.** Row 90 has exactly the wording the runbook quotes; row 91 shows lots by source and draws by kind.
3. **Checker additions.** L2 and L3 also read column-level ACLs (`attacl`). L4 has a "kind admits reversal only" row and checks both primary keys. L5 also checks `provolatile = 'v'`.
4. **P17 is measured as `service_role`** (which holds SELECT on charges and totals), after P07 and after P14 (the end of the two write phases), instead of switching back to `postgres`. P15 also checks that the draws' `idempotency_key` is hidden.
5. **Repository additions.** `findLotForAccount` returns the lot **without** draws (type `BusinessOsCreditLot`), so an empty `draws` array cannot be misread as "nothing taken back". Reads use an explicit row ceiling (1,000; reaching it is an error, never a partial list) and chunk lot ids (200 per `.in()`). `recordLot` and `reverseLot` refuse non-UUID ids and **non-finite amounts before calling the RPC**: `JSON.stringify(NaN)` is `null`, and the reversal function reads a NULL amount as "take the rest".
6. **`isCreditLotExpired` treats an unreadable expiry as expired** (fail closed: a bad date can never add credits). `extraCreditsAt` answers `null` for it anyway.

---

## 8. Estimate

| Part | Days |
|---|---|
| Migration (tables, constraints, both functions, grants) | 0.5 |
| Migration static tests incl. L8 pin | 0.4 |
| Checker L1–L10 | 0.4 |
| Probe P00–P18 | 0.45 |
| Rollback + PGlite harness and run | 0.3 |
| Repository + tests | 0.3 |
| `creditLots.ts` + tests | 0.15 |
| Registries, docs, runbook text, gates, evidence | 0.25 |
| **Total** | **≈ 2.75 d** |

SA sized 11a at ≈ 2.5 d. The extra ≈ 0.25 d is the L8 md5 pin plus the second pre-check (OP-6) and the PGlite negative controls. If SA drops OP-6 and the negative controls, it is ≈ 2.5 d.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **L8 md5 mismatch for a non-11a reason.** The repo file is checked out with CRLF on this machine (`core.autocrlf = true`); what the user pasted on 2026-09-29 may have stored `\r` in `prosrc` or not | The checker hashes `replace(prosrc, chr(13), '')` and the test hashes the LF-normalised body, so line endings cannot cause a mismatch; the step 2 pre-check catches any real drift **before** applying (OP-6) |
| R-2 | Literal-charset rule versus SA's colon-bearing literals | `chr(58)` spelling (precedent `chr(46)` in the slice 3 probe); stored values unchanged (OP-1) |
| R-3 | PGlite unavailable without an install | Reuse the existing scratchpad install by path; otherwise ask TL before any install (§7.4) |
| R-4 | PostgREST schema cache not seeing the new functions | Not an 11a issue (nothing calls them); Supabase reloads on DDL. 11b's first integration run will show `PGRST202` if not, and the fix is the user running `NOTIFY pgrst, 'reload schema';` — noted for 11b |
| R-5 | The advisory-lock serialisation assumes READ COMMITTED (each statement after the lock sees draws committed before it). Under REPEATABLE READ a waiting transaction would keep its old snapshot | PostgREST runs RPCs in READ COMMITTED; the doc paragraph states the assumption for slice 9's writer. **Not tested for concurrency** (W11a-2: PGlite has one backend): correctness rests on the argument (transaction-scoped advisory lock plus READ COMMITTED statement snapshots), backed by the static test that the lock comes before the first read and by a sequential PGlite case |
| R-6 | Overlap with slice 7 (parallel session) on `lib/repositories/index.ts` or the registries | Additive lines only; whichever merges second rebases (S11-C-11) |
| R-7 | A subagent file write truncating a large file (known hazard) | `git diff --stat` before reading any diff; deletion without insertion is a stop |
| R-8 | `classification-baseline.json` edit misread as "regenerating the baseline" | Two added lines and the count only; no existing level changes; stated in the diff description |

---

## 10. Open points for SA

The spec is followed as written until SA rules on each of these.

| # | Point | Dev proposal |
|---|---|---|
| **OP-1** | SA-11 writes `'admin_grant:'`, `'boost:'`, `'admin_reversal:'` and `'business_os_credit_lots:' ∥ p_user_id` as literals. A colon breaks the paste-file literal rule the slice 3 test enforces and 11a's will | Spell each as `'…' \|\| chr(58)`; stored keys and lock key identical. Confirm |
| **OP-2** | S11-SQ-4 defines remaining as granted − Σ reversals, without saying whether lots or draws created **after** `at` count | Ignore both when `createdAt > at`, so `extraCreditsAt` is right for any `at`; identical to SA's definition at `at = now` |
| **OP-3** | Reverse step 2 returns `already_recorded` "with its figures"; `remaining_before` / `after` of the original call cannot be rebuilt reliably once later draws exist | Return the original draw's id and credits, and the lot's remaining **now** as both before and after (this call changed nothing). 11b writes no audit on a replay, so no audit figure depends on it |
| **OP-4** | NULL `p_lot_id` is not in SA's NULL list | Refuse with `22004` like the user and key (fail loudly on a programming error rather than answer `lot_not_found`) |
| **OP-5** | Step 6 "`p_credits` ≤ 0 → raise" has no code | `22023` (invalid_parameter_value); 11b's Zod makes it unreachable |
| **OP-6** | Not in SA's runbook: a second pre-check that prints `md5(replace(prosrc, chr(13), ''))` of the two charge functions before applying | Add it (step 2). If PROD's bodies already differ from `20261015`, the user stops before 11a is applied, instead of meeting an L8 FAIL after it that 11a did not cause |
| **OP-7** | L8 hashes `replace(prosrc, chr(13), '')` rather than `prosrc` | Adopt (R-1); still a byte-level pin of everything except carriage returns |
| **OP-8** | P18 is INFO in the probe. The probe could produce `lot_expired` for real by inserting, as the table owner, a lot with backdated `created_at` and a past `expires_at` (both satisfy the CHECK) | Keep P18 INFO as SA ruled (every probe write stays `service_role`); cover `lot_expired` in the PGlite run (§7.4). Offered in case SA prefers it on PROD too |
| **OP-9** | `credit_value_version` is an input the 11b executor must supply; the current version lives in `lib/business-os/entitlements/config/creditValue.ts`, and `creditAdminOps.ts` may import nothing from the module | Not an 11a change. For 11b: `adminOps.ts` (inside the module) passes the current version in the credit op's context. Raised now so the 11b outline is not a surprise |
| **OP-10** | The registry entries also go into `classification-baseline.json` (count 132 → 134). SA-11 lists the three registries only | Add them, as slice 3 did for the charge tables |

---

## 11. Flagged items

- **`console.*` in touched files:** none. Counted 0 in `lib/repositories/index.ts`, `lib/business-os/businessOwnedTables.ts`, `lib/business-os/purge/descriptors.ts`, `lib/business-os/account/accountDeletionPolicy.ts`; new files use Pino only.
- **Deprecated patterns:** none touched.
- **Requirement edits:** none in this task. The slice 11 delivery-status row is to be updated at hand-over (T11a.13), coordinated with TL / BA.
- **Uncommitted work already on this branch:** `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` is modified (BA / SA slice 11 text). Not Dev's change; left as is.

---

## 12. Outline: 11b — admin give / take back (API)

*(Detailed in a later revision. ≈ 2.25 d including S11-BQ-1 = Yes.)* Gate: 11a merged **and applied to PROD with §17 filled in**. New `lib/business-os/credits/creditAdminOps.ts` (schemas, pre-checks, executor; imports nothing from the entitlements module) defines `grant_credits` (whole credits, `.int().positive().max(100_000)` from one exported constant, `reason`, `expiresAt` required as ISO or `null` per S11-D-2 C, `requestId` uuid) and `reduce_credit_lot` (`lotId`, `amount` integer or `'rest'`, `reason`, `requestId`); both composed into `adminOpSchema` and dispatched from `executeAdminOp`. Guard order (S11-C-6): Zod → own account 403 `own_account` **for all nine ops** (S11-BQ-1 = Yes) → platform account 409 → tenant 404 → plan row 409 → payment hold 409 `awaiting_payment` (fail closed) → expiry in the past 400 → write; reductions: lot within the account 404 → `boost_purchase` lot 409 `paid_credits_locked` (D-7 until answered) → function status mapped. `AdminOpOutcome` gains 403, an `audit` override, `replayed: true` (no audit row), `invalidatesEntitlements: false`. Audit keys `BOS_CREDIT_LOT_GRANTED` / `BOS_CREDIT_LOT_REDUCED`, severity `warning`. Credit value version passed in by `adminOps.ts` (OP-9). Route test pins one existing op's audit call byte-for-byte. `npm run test:bos-entitlements` green.

## 13. Outline: 11c — admin per-account credit view

*(Detailed later. ≈ 2 d.)* `GET /api/admin/business-os/credits/accounts/[accountId]` (`requireAdmin` first, uuid path, 409 `platform_account`, 404 tenant, `force-dynamic`, correlationId); `readCreditPosition(accountId, deps, log)` extracted from `readOwnerCreditUsage` (its tests green unedited); `adminCreditPositionDeps.ts` builds the owner read repository on the service-role client, documented; allowance and deciding layer from a helper inside the entitlements module; the route registered in `KNOWN_NON_GATE_IMPORTERS`; lots through `listLotsWithDraws` and extra credits through `extraCreditsAt`. Figures: plan left, extra credits, "over the plan this period" when above 0 — **no combined remaining** (S11-CR-3). Credits block with Give / Take back forms in `BusinessOsPanel.tsx` (S11-D-8 B; request id minted per form opening; confirm names the business; refusal copy map with a completeness test). Admin register row, census and authz guard caps +1 in the same PR.

## 14. Outline: 11d — owner sees extra credits

*(Detailed later. ≈ 1 d; may run in parallel with 11c once 11a is merged and applied.)* `extraCredits` replaces `granted` in the owner payload (exact, 6 dp), `remaining` stays plan-only (`computeCreditBalance` with `granted: 0`); owner reads through new methods on `BusinessOsCreditOwnerReadRepository` (owner RLS client, granted columns only, subset-tested against the 20261017 GRANT lines); the second figure "Extra credits" with its one line in en / he / es (he / es marked for native review); the payload allow-list pin and forbidden-word walk updated deliberately. Coordinate with slice 7 on `ownerCreditUsage.ts` / `LanguageContext.tsx` (whoever merges second rebases).

---

## 15. SA Review Notes

*(SA populates.)*

## SA Workplan Review (2026-10-02)

**Reviewed by SA, 2026-10-02.** Checked against SA-11 ("SA review — slice 11 scoping": "The tables", "The runbook", the checker and probe tables, "The split", S11-C-1 to S11-C-11), the S11-SQ rulings in §14, the "Folded in after the SA review" block, the accepted user decisions (S11-D-4 = A, so no owner-note column; S11-BQ-1 = Yes), the slice 3 migration `20261015`, its checker, probe and migration test (the literal-charset rule at `business-os-credit-charges.migration.test.ts:155-158`, the `chr(46)` precedent in the probe), `entitlementSqlScripts.guard.test.ts` (a fixed `PASTE_SCRIPTS` list, length-pinned at 5, which slice 3's files are not in either), `classification-baseline.json` (`count` 132, charges at `:38-39`), and the `tenant-isolation-guard`, `new-repository` and `business-os-entitlements` skills. Also confirmed: no other migration or SQL script on this branch names the charge objects, and a PGlite install exists at `C:\Users\Barak\AppData\Local\Temp\claude\c--Users-Barak-My-Projects-AgentsPilot-neuronforge\9e5eba32-0b51-4b5b-91d4-6fb55523e32a\scratchpad\node_modules\@electric-sql\pglite`. Review only: no code, no live query.

**Status: ✅ APPROVED WITH CONDITIONS.** The workplan follows the spec. The tables, columns and column order are right; all 12 + 6 named CHECKs are there (the shape CHECKs exactly, with `credits_bonus = 0` and the key prefixes); so are the three FKs with no FK on `actor_admin_id` or `source_ref`, the indexes, RLS with one owner SELECT policy per table, `REVOKE ALL` from the four roles followed by the column-level owner grants and `SELECT, INSERT` for service_role, both function signatures and attributes, the six statuses, the advisory-lock key, the idempotency-conflict rule, the rollback that locks and then refuses when rows exist, checker L1–L10 (with L7 (a)–(e) and the L8 md5 pin computed by Jest), probe P00–P18 that always rolls back, the PGlite run, and no `--` / `/*` in any file. The additions ("Dev detail") are real improvements, not drift. Apply W11a-1 to W11a-10 during implementation; SA checks them at code review. You do not need to resubmit the workplan.

### OP rulings

| # | Ruling | Reason |
|---|---|---|
| OP-1 | **Accepted** (`'…' \|\| chr(58)`), with W11a-1 | The charset rule is enforced on every file of slice 3 and must be enforced on 11a's. `chr(46)` is the precedent. `\|\|` binds tighter than `=`, so the CHECK means the right thing. The stored keys and the lock key are character-for-character SA's text, and SA's text stays the canonical spelling in the docs |
| OP-2 | **Accepted** | It equals S11-SQ-4 at `at = now` and makes the function right for any `at`, which 11c, 11d and slice 9 will need. The checker's L7 is a "now" check and stays consistent with it |
| OP-3 | **Accepted** | A replay changed nothing, so "remaining now" for both figures is the honest answer. NULL figures would break the repository's "unparsable figure, so error" rule. 11b writes no audit on a replay (S11-CR-2), so nothing authoritative depends on these values |
| OP-4 | **Accepted** | Failing loudly on a programming error is better than a quiet `lot_not_found`. NULL has to be refused before the lock, as Dev's step 1 does |
| OP-5 | **Accepted** (`22023`), widened by W11a-3 to cover `'NaN'` | It is the standard code for an invalid argument. The repository maps it to `error` (never a status) |
| OP-6 | **Accepted** | Cheap, and it turns a confusing L8 FAIL after the apply into a clean stop before it. If PROD's bodies differ, nothing is applied; Dev and SA investigate. Re-pinning L8 to PROD's bodies is an SA decision, never a quiet edit |
| OP-7 | **Accepted** | This exact pin is still a byte-level check of everything except carriage returns, and it makes R-1 impossible by construction |
| OP-8 | **Keep P18 as INFO** (as Dev proposes) | Every probe write stays service_role through the functions. Writing as table owner on PROD would be a new kind of PROD write for a case that PGlite and the static tests already cover |
| OP-9 | **Noted for 11b; no 11a change** | `adminOps.ts` is inside the module and passes the current version through the op context. `creditAdminOps.ts` stays import-free of the module (S11-SQ-5 / -15). The 11a repository takes `creditValueVersion` as plain input, which is right |
| OP-10 | **Accepted** | `descriptors.invariant.test.ts` requires it. This is the slice 3 precedent: two added keys, count 132 → 134, no existing level changed (R-8) |

### Conditions

- **W11a-1 (OP-1).** Wrap every `chr(58)` concatenation in brackets where it sits next to a comparison: `left(idempotency_key, 12) = ('admin_grant' || chr(58))`. The probe's P01, P07 and P08 must read back the stored `idempotency_key` and check its prefix, so the stored value is proven, not only the CHECK. The entitlements doc paragraph and the repository header write the keys in SA's canonical form (`admin_grant:<requestId>`, `boost:…`, `admin_reversal:…`, lock key `business_os_credit_lots:<user_id>`).
- **W11a-2 (PGlite has one connection).** PGlite runs a single backend. It **cannot** show two sessions serialising on the advisory lock. Remove the "two reversals in two sessions serialise" row from §7.4 and the "the PGlite two-session case proves the behaviour" clause from R-5. Replace them with: (i) a sequential case, where a second reversal in a new transaction sees the first one's draw and answers from the reduced remaining; and (ii) the static test that the lock call comes before the first read in the body (already in §7.1). Concurrency correctness rests on the argument (transaction-scoped advisory lock plus READ COMMITTED statement snapshots), which the doc paragraph states for slice 9's writer. Do not claim it was tested.
- **W11a-3 (reverse: NaN).** `round('NaN'::numeric, 6)` is NaN. NaN is not `<= 0`, and Postgres sorts it above every number, so today a NaN `p_credits` would fall to `exceeds_remaining`. Refuse `v_credits = 'NaN'` with `22023` before the `<= 0` check. Add a static test, and a PGlite direct case.
- **W11a-4 (native `23505` on the draw insert).** Two accounts using the same reversal key take **different** advisory locks. Both pass step 3, and the second INSERT fails with Postgres's own unique-violation `23505`, not the function's message. The repository therefore maps **any** `23505` from either RPC to `idempotency_key_conflict`, matched by SQLSTATE and not by message text. The only unique keys are the uuid PK and `idempotency_key`. Test both the function's message and a native unique-violation message. (The key carries a UUID request id, so this is near-impossible in practice; the mapping just keeps it from ever becoming a raw database error, M-3.)
- **W11a-5 (L8 stays honest over time).** The Jest test that computes the L8 constants from `20261015` must also assert that **no other file** in `supabase/migrations/` or `supabase/SQL Scripts/` (apart from `20261015` and its rollback) names `business_os_record_credit_charge`, `business_os_credit_period_start`, `business_os_credit_charges` or `business_os_credit_totals`. When a later migration changes the charge path (for example deferred slice 4c, 20261016), that test fails, and L8 is re-pinned on purpose in the same PR. Write the §6.7 constants into the workplan at T11a.4.
- **W11a-6 (COMMENT text charset).** `COMMENT ON` strings are literals too, so the `[A-Za-z0-9_ ]` rule applies. §3.1's example ("…business_os_credit_lots, a colon and the user id, seed 0") has commas. Write it without commas, colons or full stops (for example "the advisory lock key is hashtextextended of business_os_credit_lots then a colon then the user id with seed 0").
- **W11a-7 (G3 guard and the barrel).** In the "no callers yet" source guard, the barrel `lib/repositories/index.ts` counts as the one permitted re-export, not a caller. The guard then fails on any other non-test importer of `BusinessOsCreditLotRepository`, its singleton or `creditLots`, wherever it is, including through the barrel (search for the exported symbol names, not only the file path).
- **W11a-8 (repository result shape).** The RPCs return `TABLE` results, so PostgREST returns an array. Exactly one row is required: zero or more than one row is `error`. A non-boolean `out_recorded`, a non-uuid `out_lot_id` / `out_draw_id`, or an unknown `out_status` is `error`. On `recorded` and `already_recorded`, all three figures must parse (`toCredits`). On the other statuses they are NULL and are returned as `null`, never 0. Log at `warn` with ids and SQLSTATE only.
- **W11a-9 (PGlite, local only).** **Acceptable as a local verification aid, not CI and not a repo dependency.** Import it read-only by absolute path from the install above. Record the PGlite version and `SELECT version()` in §7.4, and note anything PG 18-only that the checker relies on (for example, `MAINTAIN` exists only from PG 17; comparing against it on an older server is harmless). Also add `SELECT current_setting('server_version') AS server_version;` to runbook step 2 so §17 records the PROD version beside the PGlite one. **If the install is gone:** Dev asks TL. TL may authorise installing `@electric-sql/pglite@0.5.8` into **this session's scratchpad only** (`npm install --prefix <scratchpad>`), never in any worktree and never touching the shared `node_modules` junction. If that is not authorised, 11a goes to code review with the PGlite gap stated in §7.4, and SA rules whether the PROD probe plus the static tests are enough. No shared or remote database is ever used instead.
- **W11a-10 (hand-over).** At T11a.13, update the requirement's slice 11 delivery-status row (the user's "always update the main requirement" rule), with TL coordinating so it does not collide with the BA's uncommitted text. `next build` is **not** required for 11a (no route, page or client file); the scoped `tsc` program is the type gate, and its output (touched files clean) is pasted into the evidence.

### Test plan and estimate

- **Test plan: accepted.** Every test lives in a suite that already runs: `npm test`, plus `test:bos-entitlements`, which covers `supabase/migrations/__tests__`, `lib/repositories/__tests__` and both registry guards. There is no workflow change and no new job, so CI time does not grow. The new migration test copies the slice 3 helpers rather than importing them across test files, which is right. 11a's files do **not** need adding to `entitlementSqlScripts.guard.test.ts`'s `PASTE_SCRIPTS` list. That list belongs to the entitlements runbook and is length-pinned; 11a enforces the same rules in its own test, as slice 3 does. Tenant-isolation coverage at the SQL and repository level (§7.3) is right for 11a; the route-level tests belong to 11b.
- **Estimate: ≈ 2.75 d accepted.** The extra ≈ 0.25 d over SA's 2.5 d pays for OP-6, the L8 pin and the negative controls, which SA keeps. W11a-2 removes a test that could not have run, and W11a-3 to -8 are small. Net: still ≈ 2.75 d.
- **No missing tasks** beyond the conditions above. The runbook carries the §6.4.1 elements: pre-check first, the existing checker's C7, the three `PROBE SKIPPED` answers, the destructive-statement warning both ways, and §17 for pasting results.

### Note for the 11b revision (not an 11a condition)

- §12 still reads "`boost_purchase` lot 409 `paid_credits_locked` (D-7 until answered)". The user has since answered **S11-D-7 = A** (requirement §19, 2026-10-02). Under SA-11's constraint for D-7 A, a reduction on a `boost_purchase` lot requires `confirmPaidCredits: true`; without it the answer is 409 `paid_credits_locked`. The 11c form then shows the stronger confirmation. Update this when 11b is detailed.

### Business decisions for the user

None. Every point here is technical.

### Approval

- [x] Workplan approved, with W11a-1 to W11a-10 to be applied during implementation; proceed to implementation (11a only). 11b, 11c and 11d need their own detailed revision and SA review before they are built.

## SA Code Review — 11a (2026-10-02)

**Code Review by SA, 2026-10-02.**
**Status: ✅ APPROVED WITH CONDITIONS.** Fix CR11a-1, then hand to RM. No re-review cycle is needed: SA checks the one-file diff, and QA re-runs only the repository suite.

**What was checked.** The uncommitted diff on `feature/business-os-credit-deduction-slice-11`, all 18 files, read line by line against SA-11 "The tables" / "The runbook", W11a-1 to W11a-10, OP-1 to OP-10, and the `tenant-isolation-guard`, `new-repository` and `business-os-entitlements` skills. Targeted checks run by SA:
- The six new and registry suites: 240 / 240 pass.
- G1: the 20261015 migration, its checker, probe, rollback and migration test, and `BusinessOsCreditChargeRepository.ts`, compared with `git diff` against `origin/main`. All identical.
- L8: both md5 values recomputed independently with Node from the LF-normalised `$record$` / `$period$` bodies. `a7aa425de95fe06da72d31257f7818a2` and `b00af2d2c4738e51e08e2ec92195077e` are correct. The checker's L8 column lists equal the `20261015` `CREATE TABLE` columns, in order.
- No other migration or SQL script names a charge object.
- No non-test importer of the new symbols exists outside the barrel.

Review only: no live database, no commit.

### Security and correctness (verified, no finding)

| Area | Verdict |
|---|---|
| Grants / RLS | ✅ Both tables have RLS on, and one owner SELECT policy each, `(SELECT auth.uid()) = user_id`. `REVOKE ALL` is applied for all four roles on all four objects, and nothing is ever revoked from an enumerated list. Owner column grants exactly match SA-11, each on its own line. There is no table-level SELECT for `authenticated`. `service_role` holds `SELECT, INSERT` only. No role holds UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER, and there are no triggers. `ON CONFLICT DO NOTHING` plus `RETURNING id` needs only INSERT, and SELECT on `id`, which service_role holds |
| Functions | ✅ `SECURITY INVOKER`, `VOLATILE` (so every statement takes a fresh READ COMMITTED snapshot, which the lock argument relies on), `SET search_path = ''`. Every relation is schema-qualified, and the built-ins resolve through the implicit `pg_catalog`. EXECUTE is granted to `service_role` only, after four revokes each |
| Advisory lock | ✅ `pg_advisory_xact_lock(hashtextextended('business_os_credit_lots' \|\| chr(58) \|\| p_user_id::text, 0))`, character for character the S11-CR-4 key. It comes after the NULL refusal (which reads no table) and before the first read. The steps run in SA order: key, lot, expiry, remaining, amount, insert |
| Tenant isolation | ✅ A foreign lot and a missing lot get the same `lot_not_found`, with no figures. A detached lot (`user_id` NULL) is `lot_not_found` too, via `IS DISTINCT FROM`. A reused key never returns another account's lot or draw: record raises `23505` after the replay comparison, and reverse raises `23505` unless both the draw's lot and its user match. The draw `user_id` is always `p_user_id`, never read from the lot. The repository builds its args field by field, and every read has `.eq('user_id', accountId)` |
| Idempotency | ✅ Same-key concurrent inserts work: `ON CONFLICT DO NOTHING` waits for the other transaction, and the next statement sees its row. The native `23505` on draws (two accounts, different locks) maps to `idempotency_key_conflict` by SQLSTATE (W11a-4) |
| NaN / amount guards | ✅ NaN is refused in the lots CHECK. CHECKs run before the conflict arbiter, so P06 holds. Reverse refuses `NaN` before `<= 0` with `22023` (W11a-3). The repository refuses non-finite amounts before the RPC, which closes the `JSON.stringify(NaN) = null` means "the rest" trap |
| Balance core vs SQL | ✅ Expiry is `<=` on both sides (pinned by a test). Arithmetic is in integer micro-credits. An unreadable figure or date makes the whole answer `null`, never 0. A negative remaining is clamped to 0 and flagged. Lots and draws after `at` are ignored (OP-2) |
| Repository parsing | ✅ Exactly one row is required. `out_recorded` must be a boolean, and ids must be UUIDs. Figures may be a number or a decimal string, and anything else is an error. Non-`recorded` statuses return `null` figures. The 1,000-row ceiling counts as an error, never a partial list. Lot ids go 200 per `.in()` |
| Paste files | ✅ No `--` or `/*` anywhere. Literals use only `[A-Za-z0-9_ ]`, COMMENT text included (W11a-6). Every colon is written as a bracketed `chr(58)` (W11a-1). The probe always raises, its four guards come before any role switch, and its placeholder is on line 3 as the runbook says. The rollback locks both tables, refuses when rows exist, and only then drops |
| Standards | ✅ Rule 1: DB access only in `lib/repositories/`. Rule 3: Pino `createLogger({ service })`, no `console.*`. Rule 4: `.eq('user_id')` on every read, and service role documented in the header. Rule 6: no `any`. `new-repository`: client injection with a `supabaseServer` default, `RepositoryResult`, never throws, explicit column lists. Entitlements: none of the new files imports from `lib/business-os/entitlements/`, so there is no registration to do |
| Barrel `tsc` errors | ✅ **Confirmed pre-existing.** `lib/pilot/insight/MemoryManager.ts` and `lib/repositories/CalibrationSessionRepository.ts` are untouched against `origin/main`. `CalibrationSessionRepository` was already exported by the barrel on main. The new repository imports only Supabase types, `supabaseServer`, the logger and `./types`. The 2 `creditPeriod.test.ts` failures are also outside 11a (neither file is touched) |

### §7.6 deviations

| # | Deviation | Ruling |
|---|---|---|
| 1 | L5 compares `array_to_string(proargtypes::regtype[], ' ')` and `proargnames`, not `to_regprocedure` | **Accepted.** It stays inside the charset, avoids the 0-based `oidvector` trap, and is stricter: it checks parameter and OUT names too. PGlite negative control (SECURITY DEFINER → L5 FAIL) is recorded |
| 2 | L9 split into two INFO rows | **Accepted.** Row 90 keeps the exact wording the runbook quotes |
| 3 | Extra checker rows (column ACLs in L2 / L3, the kind-reversal-only and primary-key rows, `provolatile`) | **Accepted.** These are stricter, and each has a negative control |
| 4 | P17 measured as `service_role` after P07 and P14; P15 also hides the draw key | **Accepted.** `service_role` holds SELECT on both ledger tables (`20261015:134,136`) and bypasses RLS, so its counts equal postgres's. No DELETE exists anywhere, so a write between the checkpoints cannot be hidden, and the end-of-writes count covers P08–P13 |
| 5 | `findLotForAccount` returns no draws; 1,000-row ceiling and 200-id chunks; UUID and finite-amount refusal before the RPC | **Accepted.** All four fail closed. The NaN-to-null guard closes a real trap |
| 6 | `isCreditLotExpired` treats an unreadable expiry as expired | **Accepted.** It fails closed, and `extraCreditsAt` answers `null` for it anyway |

### Code Review Comments

1. **CR11a-1** `lib/repositories/BusinessOsCreditLotRepository.ts`, `fail()`. The full error object is logged as `err: error`. For a CHECK or NOT NULL violation (`23514` / `23502`), PostgREST's `details` field is Postgres's `Failing row contains (…)`, which carries the **reason text** and the idempotency key. The logger's `err` serializer keeps enumerable properties, and nothing in the redact list covers them. That contradicts W11a-8 ("ids and SQLSTATE only") and the method's own comment ("never the reason, which is admin prose"). **Fix:** log `method`, `sqlstate`, the error's `message` and the ids, never `details` or the raw object. Add a test that a `details` string on a mocked error never reaches the logger. 11b's pre-checks make these codes rare, but the repository should not rely on its caller to stay safe. Priority: **Medium, should-fix (approval condition)**
2. **CR11a-2** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, "Credits added: lots". The paragraph says "not yet applied on PROD", which goes stale the moment §17 is filled. Add a line to §6.6 step 10 (or the RM hand-off): after §17 is pasted, update that status phrase in the same follow-up PR that records the apply. Priority: **Low, nit**
3. **CR11a-3** §6.6 step 6. Unlike step 5, it has no explicit "Any FAIL, or C7 not PASS: stop and send the grid to Dev; 11b does not merge". Add that sentence. Priority: **Low, nit**
4. **CR11a-4** (for 11b, no 11a change) Both replays follow the spec. Record matches only on account, source and amount, so a replay with a different expiry or reason returns the original lot. Reverse matches on lot and account only, so a replay with a different amount returns the original draw and its `credits`. 11b must report the **returned** `credits` and lot, never the requested figures, and it must mint `requestId` per form opening, as the outline already says. Write this into the 11b revision. Priority: **Low, note**
5. **CR11a-5** `toCredits` / `creditLots.ts` micro arithmetic. A JS double holds micro-credit precision only up to about 9 × 10⁹ credits (2^53 micro-credits), while `numeric(18,6)` allows 10¹². That is unreachable behind 11b's 100,000 ceiling and today's volumes. A one-line comment stating the bound is enough. Priority: **Low, nit**

### Optimisation Suggestions

- None that block. Later, the `fail()` sanitiser from CR11a-1 could be shared with `BusinessOsCreditChargeRepository`, which logs `err: error` the same way. Out of scope for 11a: G1 keeps that file byte-identical.

### Runbook §6.6 completeness

Complete for the user's PROD apply, apart from the CR11a-2 and CR11a-3 nits. The runbook has the four-NULL pre-check, the md5 pre-check against §6.7 (now filled in), the server version for §17, the single-transaction apply with a clean "already exists" second paste, the apply time, the new checker with the exact L9 empty wording, the existing checker's C7, the email-to-id lookup, and the probe in a new tab. The probe step covers the placeholder on line 3, the destructive-warning instruction both ways, and all three `PROBE SKIPPED` remedies plus the escalation rule. Then both checkers run again, and step 10 lists what to paste into §17. The rollback is correctly limited to empty tables and to "only when Dev tells you".

### Code Approved for QA: Yes

QA may proceed in parallel. RM may commit once CR11a-1 is fixed (SA confirms from the diff) and the user has seen the diff. CR11a-2, -3 and -5 are optional for this PR. CR11a-4 goes into the 11b revision.

**CR11a-1 confirmed fixed (2026-10-02)** — cleared for commit.

## 16. QA Testing Report

See "QA Report — 11a (2026-10-02)" below.

## QA Report — 11a (2026-10-02)

**QA, 2026-10-02.**
**Verdict: PASS WITH NOTES.** No bug found in 11a. SA's open condition CR11a-1 (the repository logs the raw error object) is still unfixed in the working copy. It is SA's finding, recorded here as QA11a-1 so it is not lost. Once Dev fixes it, QA re-runs the repository suite.
**Test mode:** full · **Strategy:** A (Jest: unit, static and source guards) + C (an independent PGlite script, local and in memory) · **Focus:** schema, security, api (repository) · **Skipped:** e2e (no UI or route in 11a); the live database (not allowed; PROD apply is §17) · **Input source:** TL prompt.

No database was read or written. Nothing was stashed, committed or installed. Scratch files are in the session scratchpad only: `qa11a.mjs`, `qa11a-delete.mjs`, `qa11a-parity.test.ts`.

### Test Coverage

| Check | Tested? | Result | Notes |
|---|---|---|---|
| The three new suites (`creditLots`, `BusinessOsCreditLotRepository`, `business-os-credit-lots.migration`) | ✅ | Pass | 180 / 180, the same as Dev's 92 + 54 + 34 |
| Registry and guard suites (accountDeletionPolicy, purge ×3, businessOwnedTables) plus the three above | ✅ | Pass | 8 suites, 264 / 264 |
| `npm run test:bos-entitlements` | ✅ | Pass | 104 suites, 2,322 / 2,322. Nothing in 11a imports from `entitlements/`; QA ran it anyway |
| `creditPeriod.test.ts`: 2 failures are pre-existing | ✅ | Confirmed | Neither `creditPeriod.ts` nor its test differs from HEAD. The same 2 tests (the "period keys never pass through Date" source guard, ×2) fail in the main checkout at `03b62c3c`: 2 failed, 21 passed in both |
| 3 `tsc` errors are pre-existing | ✅ | Confirmed | Re-ran Dev's scoped `tsc`: touched files are clean. The 3 errors (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts` ×1) are in files that do not differ from HEAD. The barrel pulls them in, and the barrel already exported `CalibrationSessionRepository` before 11a |
| Dev's PGlite harness `lots-run.mjs`, re-run | ✅ | Pass | ALL OK |
| QA's own PGlite edge cases (`qa11a.mjs`) | ✅ | Pass | 64 OK, 0 BAD. Cases listed below |
| Account deletion detaches lots and draws (`qa11a-delete.mjs`) | ✅ | Pass | A role with only DELETE on `auth.users` (standing in for `supabase_auth_admin`) deletes the user, and the lot and draw become `user_id NULL`: referential actions run as the table owner, as the deletion-policy text says. A reversal on the detached lot then answers `lot_not_found` |
| Core vs checker: same extra-credits figure | ✅ | Pass | On QA's mixed data (a fully reversed lot, an expired lot, a fractional lot with a fractional reversal, a lot expiring in the future, and a second account), `extraCreditsAt(now)` summed over accounts is **57.345677**, and checker L9's unexpired credits is **57.345677**. Per account: A 17.845677, B 39.5, both matching a hand count. Both use `expires_at <= now` and clamp negatives to 0 |
| Repository row → core input | ✅ (by reading) | Pass | `BusinessOsCreditLotRow` matches `CreditLotForBalance` structurally (`creditsGranted`, `expiresAt`, `createdAt`, `draws[].kind/credits/createdAt`). No test pins this (see Edge Cases) |
| `git diff --stat`: no unexpected deletions | ✅ | Pass | 8 modified files, 462+ / 6−. The 6 deletions are the baseline `count` 132→134 (1) and 5 requirement rows that were rewritten in place with annotations (FR-30 and the slice 9 Scope row are still present). The 10 new files are untracked |
| Charge-ledger files untouched | ✅ | Pass | `20261015` migration, its checker and probe, `SQL Scripts/`, `BusinessOsCreditChargeRepository.ts`, `BusinessOsCreditLedgerReadRepository.ts`, `BusinessOsCreditOwnerReadRepository.ts` and `BusinessOsCreditPeriodRepository.ts` show no change. Checker L8 also passes in both PGlite runs |
| No `console.*` in touched files | ✅ | Pass | None in the 6 touched TS source files |

**QA PGlite edge cases (`qa11a.mjs`, PGlite 0.5.8 / PG 18.3, roles emulated the way the probe does: `SET LOCAL ROLE` plus `request.jwt.claims`):**
- Happy path: grant 100 → reverse 30 (100→70) → reverse 70.000001 gives `exceeds_remaining` with nothing written → `'rest'` takes 70 (70→0) → `nothing_left` (for both rest and an explicit amount).
- Replay: the same grant key gives `out_recorded=false` with the same lot id and no new row. The same reversal key gives `already_recorded`, the original credits (30), both figures = remaining now (0), and no new row.
- Conflict: the same grant key with a different amount → `23505`. With a different account → `23505`. With a different source → refused (`23514`). Nothing written.
- Tenant: reversing another account's lot → `lot_not_found` with null figures. A missing lot gets the same answer. Another account reusing a reversal key → `23505` (on the foreign lot and on its own lot).
- Expired lot (backdated, inserted as postgres) → `lot_expired`, nothing written. Recording a lot with a past expiry → `23514`.
- Amounts: a reversal of NaN, 0, a negative number or 0.0000004 → `22023`. A grant of NaN, or one that rounds to 0 → `23514`. An admin grant with no reason, a wrong key prefix or a bonus → `23514`. A reversal with a wrong key prefix → `23514`.
- service_role: UPDATE and DELETE on both tables, and TRUNCATE on draws → `42501`.
- Owner A (authenticated) sees only its own lots and draws through the granted columns. Owner B cannot see A's lot. Reading `reason`, `idempotency_key`, `actor_admin_id`, `source_ref`, `credit_value_version`, `actor_kind` or `*` on lots, or `reason`, `idempotency_key`, `actor_admin_id` or `*` on draws → `42501`. INSERT, UPDATE or DELETE on either table, and EXECUTE on either function → `42501`.
- anon: SELECT on both tables and EXECUTE on both functions → `42501`.
- Checker VERDICT PASS on QA's data. The rollback refuses with rows and leaves the tables intact.

### Issues Found

#### Bugs (must fix before commit)
1. **QA11a-1 (= SA CR11a-1, still open)**: `lib/repositories/BusinessOsCreditLotRepository.ts:295`, `fail()` logs `{ err: error, ... }`. For a `23514` / `23502`, PostgREST's `details` (`Failing row contains (…)`) carries the admin reason and the idempotency key into the logs. That contradicts W11a-8. Severity: **Medium**. QA confirmed by reading the code that it is unfixed; it is SA's approval condition. Re-test after the fix: the repository suite, plus SA's requested "details never reaches the logger" test.

#### Performance Issues (should fix)
- None.

#### Edge Cases (nice to fix / notes)
1. **QA11a-2**: The two functions replay differently. A grant replay with a different amount is a conflict (`23505`). A reversal replay with a different amount returns `already_recorded` with the **original** credits (QA saw 30 back when it asked for 5). A grant replay with a different expiry or reason silently returns the original lot. Both follow the spec (step 3, OP-3). This is SA's CR11a-4: 11b must show the **returned** figures. Severity: Low (11b note).
2. **QA11a-3**: No type-level test pins that `BusinessOsCreditLotRow` is assignable to `CreditLotForBalance`, though the repository header promises it ("Structurally usable by `creditLots.ts`"). It holds today. A one-line assignment in a test would keep 11c / 11d from drifting. Severity: Low.
3. **QA11a-4**: The parity checked here is the **total at now** (L9 against the core). L7 (d) checks per-account granted minus drawn without expiry, so no checker row gives a per-account unexpired figure. That is fine for 11a; for 11c, compare against the core per account. Severity: Info.
4. Not testable here, as already stated in §7.4: concurrent serialisation on the advisory lock, and the native-`23505` race (PGlite has a single backend).

### Test Outputs / Logs

```text
new suites:        Tests: 180 passed, 180 total
new + registries:  Test Suites: 8 passed, 8 total · Tests: 264 passed, 264 total
test:bos-entitlements: Test Suites: 104 passed, 104 total · Tests: 2322 passed, 2322 total
creditPeriod.test.ts (worktree):     Tests: 2 failed, 21 passed, 23 total
creditPeriod.test.ts (main 03b62c3c): Tests: 2 failed, 21 passed, 23 total   (same 2 source-guard tests)
scoped tsc: only MemoryManager.ts(60,48), MemoryManager.ts(126,40), CalibrationSessionRepository.ts(315,7)
lots-run.mjs (Dev): ALL OK
qa11a.mjs (QA):     QA PGlite: 64 OK, 0 BAD
  L9: 5 lots and 4 draws and 2 accounts and 57.345677 unexpired credits ...
parity: {"per":{"aaaa…":17.845677,"bbbb…":39.5},"coreTotal":57.345677,"sqlTotal":57.345677}  Tests: 1 passed
qa11a-delete.mjs: auth admin delete succeeded; lots_detached 1, draws_detached 1; reversal → lot_not_found
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must fix QA11a-1 (= CR11a-1, Medium) before commit. Then QA re-runs the repository suite only. Everything else passes.

## 17. PROD apply record (the user pastes here)

**Applied to PROD by the user on 2026-10-02. Every check PASS.** Recorded by TL from the outputs the user pasted (production project, Supabase SQL editor).

| Step (§6.6) | Output |
|---|---|
| 2 — pre-check (names) | Not pasted. Superseded: the apply succeeded on the first paste, and a second paste answered `relation "business_os_credit_lots" already exists` (42P07) with nothing changed, exactly as step 3 predicts |
| 2 — pre-check (charge function md5) | Not run before the apply. Covered after the apply by L8 (`record charge 1 of 1 and period start 1 of 1 match`) and by the charge checker's C7 PASS — the charge functions on PROD are the bodies in 20261015 |
| 2 — server version | **PostgreSQL 17.4** (local verification ran on PGlite 0.5.8 / PG 18.3, §7.4; nothing in 20261017 depends on 18 — it applied and every check passed on 17.4) |
| 4 — apply time (UTC) | **2026-10-02 19:56:27.565561** |
| 5 — new checker grid | 20:02:16 UTC: **VERDICT PASS, 23 pass 0 fail.** L1–L8 all PASS (L2: 14 of 23 columns readable by owners, mismatches none; L3: service_role SELECT, INSERT only on both tables; L4: 12 + 6 checks, kind admits reversal only, 3 foreign keys, 3 indexes, 0 triggers; L5/L6 exact signatures, invoker, volatile, pinned search path, service_role-only EXECUTE; L7 parity rows 0 mismatches; L8 charge bodies and columns match 20261015). L9: `0 lots and 0 draws and 0 accounts and 0 unexpired credits and first lot at none`; `admin_grant 0 and boost_purchase 0 and reversal 0` |
| 6 — existing checker verdict and C7 | 19:57:31 and 19:58:22 UTC: **VERDICT PASS, 19 pass 0 fail; C7 totals equal the rebuild — PASS, 0 mismatched account periods.** C7 ledger size: 82 charge rows, 6 totals rows, 0 detached, first row 2026-09-29 16:50:53 UTC |
| 8 — probe full text | `P0001: PROBE PASS  this error is expected and rolls everything back` — P00 INFO (0 lots, 0 draws, 82 charge rows, 6 totals rows); **P01–P17 PASS**; P18 INFO (lot expired not producible in one transaction; covered by migration tests and the local run). Run with the user's own id |
| 9 — both checkers again (verdicts, L9) | New checker 20:04:50 UTC: **VERDICT PASS 23/0**, L9 `0 lots and 0 draws …`, `admin_grant 0 and boost_purchase 0 and reversal 0` — the probe kept nothing. Charge checker 20:06:50 UTC: **VERDICT PASS 19/0, C7 PASS**, 82 / 6 rows unchanged |

**Gate S11-C-5 met:** 11b may merge (after its own review cycle). Boost slice 2's "20261017 applied to PROD" precondition is met.

## 18. Commit Info

*(RM populates. Nothing is committed before the user has seen the diff.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-02 | Workplan created (Dev) | 11a planned in full against SA-11 "The tables", "The runbook", checker L1–L10, probe P00–P18 and S11-C-1 to S11-C-11; 11b–11d outlined. Ten open points for SA (OP-1 to OP-10). No code; nothing applied |
| 2026-10-02 | SA workplan review (11a): APPROVED WITH CONDITIONS | Section "SA Workplan Review (2026-10-02)" added. OP-1 to OP-7 and OP-10 accepted; OP-8 kept as INFO; OP-9 noted for 11b. Conditions W11a-1 to W11a-10: chr(58) in brackets and stored keys read back; PGlite cannot test concurrency, so that claim is removed; NaN refused in the reverse function; any `23505` maps to a conflict; an L8 drift guard on other migrations; COMMENT text charset; the G3 guard allows the barrel; the RPC result shape; PGlite local-only with a fallback; the hand-over step. Estimate ≈ 2.75 d accepted. No business decisions |
| 2026-10-02 | 11a implemented (Dev): Code Complete | Migration `20261017`, checker L1–L10, probe P00–P18, refusing rollback, repository, `creditLots.ts`, registries, entitlements doc; W11a-1 to W11a-10 applied; §6.7 md5 constants filled; PGlite 0.5.8 / PG 18.3 run 78/78 OK (§7.6); Jest new suites 92 + 54 + 34, `test:bos-entitlements` 2,322 passed; scoped `tsc` touched files clean. Six deviations listed in §7.6 for SA. Uncommitted; nothing applied to any database |
| 2026-10-02 | SA code review (11a): APPROVED WITH CONDITIONS | Section "SA Code Review — 11a (2026-10-02)" added. All six §7.6 deviations accepted. G1 and the L8 md5 constants independently verified. The barrel `tsc` errors are confirmed pre-existing. Condition CR11a-1: the repository must not log PostgREST `details` (it can carry the reason). Nits CR11a-2, -3, -5; CR11a-4 is a note for 11b. Code approved for QA |
| 2026-10-02 | QA (11a): PASS WITH NOTES | Section "QA Report — 11a (2026-10-02)" added. Jest new 180/180, with registries 264/264, `test:bos-entitlements` 2,322/2,322. The creditPeriod and `tsc` failures are confirmed pre-existing (they also fail on main). Dev's PGlite run re-passed; QA's own PGlite edge cases 64/64. Core and checker L9 agree (57.345677). Charge files untouched, no `console.*`. QA11a-1 = CR11a-1, still open (Medium); edge notes QA11a-2 to -4 |
| 2026-10-02 | CR11a-1 fixed; CR11a-3 applied | `fail()` in `BusinessOsCreditLotRepository.ts` now logs method, SQLSTATE, message and ids only, and returns an error rebuilt from the message (no `details`/`hint`); new test asserts the failing-row details never reach the logger or the returned error (repository suite 55/55). Runbook §6.6 step 6 gains the explicit stop. CR11a-2, CR11a-5 and QA11a-3 deferred to 11b/11c (nits); QA11a-2 / CR11a-4 carried into the 11b outline |
| 2026-10-02 | 20261017 applied to PROD (user) and recorded | §17 filled: applied 19:56:27 UTC on PostgreSQL 17.4; new checker VERDICT PASS 23/0 before and after the probe (L9 0 lots / 0 draws); charge checker VERDICT PASS 19/0 with C7 PASS before and after (82 / 6 rows); probe PROBE PASS P01–P17. Step 2 pre-checks not run before the apply; covered by L8 and C7 after it. S11-C-5 met |
