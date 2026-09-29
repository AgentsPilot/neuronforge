# Workplan: Business OS Credit Deduction — Slice 3 (Record every charge, silently)

> **Last Updated**: 2026-09-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §3 "Reusing what exists", §4 "The three records", §5 "How the balance works", §12 **Slice 3 — Record every charge, silently** (scope, guardrails, FRs / ACs), FR-1 to FR-16, FR-18, FR-34, FR-35, FR-38, the NFRs, and the SA rulings SQ-1, SQ-2, SQ-3, SQ-5, SQ-7, SQ-8, SQ-11, SQ-15, SA-B1, SA-S1, SA-S8 plus the SA follow-up (2026-09-28).
**Builds on:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_2_WORKPLAN.md). Slice 2 shipped the pure, unwired `priceActionForCharge` (`chargePricing.ts`) and `classifyCallForCharge` / `reportUnpricedCalls` (`chargeClassification.ts`); slice 3 wires them. Its verified facts, its SA conditions (C-1 to C-3) and its code-review notes (N-1 to N-6) are reused and cited as "S2 C-3", "S2 N-4" and so on.
**Branch:** `feature/business-os-credit-deduction-slice-3` (worktree `neuronforge-llm-deduction`), off `origin/main` at `7faca4f7` (after slice 1's PR #130 and slice 2's PR #132). The branch was created before this workplan, not by Dev.
**Date:** 2026-09-28
**Status:** Code Complete (3a) — uncommitted, awaiting SA code review. 3b-i and 3b-ii not started.

## Overview

Slice 3 is the moment Business OS starts **counting** in credits. After it ships, every completed Business OS AI action writes one confirmed, thin charge row, and each account has a running total for its billing period. Nothing is refused, nothing the owner sees changes, and `balance.ts` still answers "yes" to everything.

**The plan is split in two, because the honest estimate is ≈ 6.5 days** (§8), above the user's "a few days":

| Part | What it delivers | DB? | Estimate |
|---|---|---|---|
| **3a — Action id, credit value v0, pure resolver** | Every `runAiAction` invocation mints its own **action id**, and the audit entry carries it (`schema: 2`). The **provisional credit value, version 0** (≈ $0.001) lives in the entitlements config, versioned and append-only. **One pure resolver** turns an action's calls into `{ cost, credits, version, fallback flag }` using slice 2's pricing, and a pure builder produces the exact charge record 3b will write. | **No** | ≈ 2 days |
| **3b — The tables, the RPC, the repository and the wiring** | A migration with the thin **charge table** and the **per-period totals table**, one RPC that writes both in one transaction, a repository, the purge / deletion registration, and a direct, awaited, time-boxed, never-throwing write at the end of `runAiAction`. Charging starts at the stated moment (§6.4). | **Yes** (applied to PROD by hand) | ≈ 4.5 days |

3a is **self-contained**: it ships alone, changes one audit field and adds nothing that runs in production beyond minting a UUID. 3b depends on 3a.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach — 3a](#2-implementation-approach--3a)
3. [Implementation Approach — 3b](#3-implementation-approach--3b)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Migration Plan, Rollback and Apply / Verify Runbook (3b)](#6-migration-plan-rollback-and-apply--verify-runbook-3b)
7. [Test Plan](#7-test-plan)
8. [Estimate and the Split Decision](#8-estimate-and-the-split-decision)
9. [Guardrails and Out of Scope](#9-guardrails-and-out-of-scope)
10. [Risks](#10-risks)
11. [Open Questions for SA](#11-open-questions-for-sa)
12. [Flagged Items (console.*, stale docs, carried notes)](#12-flagged-items-console-stale-docs-carried-notes)
13. [SA Workplan Review](#13-sa-workplan-review)
14. [QA Testing Report](#14-qa-testing-report)
15. [Commit Info](#15-commit-info)
16. [Change History](#16-change-history)

---

## 1. Analysis Summary

Every path, line and function below was checked in this worktree at `7faca4f7`.

| Concern | As-built | Evidence |
|---|---|---|
| The action wrapper | `runAiAction` opens a usage scope for `spec.groupId`, runs `fn`, queues the audit entry in its own `try`, runs slice 2's `reportUnpricedCalls` in a second `try`, then returns the value or rethrows the error unchanged. No action id exists today | `lib/business-os/llm/aiActionAudit.ts:395-439` |
| The audit entry | `buildAiAuditEntry` builds a closed `details` set with `schema: 1`; `entityId` is the grouping id; the outcome is `summary.failure ?? lastAttemptFailure(calls)` | `aiActionAudit.ts:226-244` (type), `:302-346` (builder), `:292-299` (`lastAttemptFailure`) |
| Identity checks | `validateIdentities`: the group and the account must be UUIDs, the account never the platform account; returns the actor or `null` | `aiActionAudit.ts:379-385` |
| Where the outcome is decided | `emitAiAuditEntry` turns the signalled code or the thrown error into `failure`; the builder falls back to the last-attempt rule | `aiActionAudit.ts:441-463` (`:458`) |
| Tests that pin the audit shape | The closed key list (`:269-278`), "a failed entry adds only errorCode" = 16 keys (`:285`), `schema` = 1 (`:488`) | `lib/business-os/llm/__tests__/aiActionAudit.test.ts` |
| The admin screen | Renders an explicit allow-list (`AiActionDetailsView`); a guard test forbids dumping `details` wholesale, so a new `actionId` key reaches no screen without a review | `app/admin/audit-trail/page.tsx:101-126`; `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts:79-86` |
| The usage scope | Only the **innermost** scope is told about a call, so a nested `runAiAction` (for example `MutateExecutor`) collects its own calls and the parent does not see them: no double charge | `lib/ai/usageScope.ts:16-17`, `:114-141`; `lib/business-os/bizql/mutate/MutateExecutor.ts:831` |
| Slice 2's pricing, unwired | `priceActionForCharge(calls)` → `{ costUsd (unrounded), isFallbackPriced, fallbackCallCount, calls }`; nothing outside tests imports it; rates are lazy; the module is server-only (`SystemConfigRepository` → `supabaseServer`) | `lib/business-os/llm/chargePricing.ts:196-213`, `:15-19`, `:157-160` |
| The one loud event | `bos_llm_call_unpriced` is the one `error` event per unpriced call (S2 N-4): slice 3 must not add a second `error` for the same call | `lib/business-os/llm/chargeClassification.ts`; slice 2 workplan §11 N-4 |
| Production call sites | 16 `runAiAction(` call sites (chat-v4, insight cron, intake ×2, onboarding build and chat, website ×5, media, `MutateExecutor`, `BriefingStore`, `LeadAlertService`, two dormant services) | `grep "runAiAction("` outside tests |
| The credit value | **Does not exist anywhere.** The entitlements config has `TIER_MATRIX.version: 1` and the `ai.actions` metered capability (unit `ai_action`); no credit value, no conversion | `lib/business-os/entitlements/config/tierMatrix.ts:200-204`; `config/catalog.ts:299-310` |
| The balance seam | `ALWAYS_SUFFICIENT` — stays untouched in slice 3 | `lib/business-os/entitlements/balance.ts:45-49` |
| The period anchor (T-6) | `business_os_account_plans.period_anchor timestamptz NOT NULL DEFAULT now()` in the migration; typed in the repository and selected in `PLAN_COLUMNS`; **written** by `adminOps` on `set_cohort` and `assign_tier` (reset to "now"). **No period computation exists anywhere in code.** `EntitlementAccount` does not carry the anchor | `supabase/migrations/20261005_business_os_entitlements.sql:117-119`; `lib/repositories/BusinessOsAccountPlanRepository.ts:54`, `:204`; `lib/business-os/entitlements/adminOps.ts:338`, `:394`; `lib/business-os/entitlements/account.ts:35-54` |
| A plan row can be missing | A tenant can exist without a plan row; a diagnostic RPC exists for exactly that | `supabase/migrations/20261010_business_os_tenants_missing_plan_row.sql` |
| **Live schema** | ⚠️ **UNVERIFIED.** `npm run schema:check` needs `.env.local`, which this worktree does not have, and the main checkout is out of bounds for this task. Per `business-os-schema-check` Rule 1, `period_anchor` is **not** claimed live on the strength of the migration file. SA's own note says the same ("Unverified against live", requirement SA Review). T3b.0 runs the check before any SQL is written | `scripts/schema-check.ts`; `.claude/skills/business-os-schema-check/SKILL.md` Rule 1 |
| Production mode | The entitlements doc says production runs `BOS_ENTITLEMENTS_MODE=shadow` (confirmed 2026-09-27); CLAUDE.md's Key Documentation row still says "unset in production". An unset mode resolves to `off` | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9`; `lib/business-os/entitlements/mode.ts` (parser: `''` → `off`) |
| Lockdown precedent (SA-S8) | `REVOKE ALL … FROM PUBLIC, anon, authenticated` (never an enumerated REVOKE: the MAINTAIN defect), the positive `GRANT` stated, `REVOKE DELETE, TRUNCATE FROM service_role`, RPCs `SECURITY INVOKER`, `SET search_path = ''`, `REVOKE ALL ON FUNCTION … FROM public, anon, authenticated` + `GRANT EXECUTE TO service_role` | `supabase/migrations/20261005_business_os_entitlements.sql:220-270`, `:275-330`; `20261009_business_os_entitlements_privilege_fix.sql` |
| Migration file conventions | Migration in `supabase/migrations/`, rollback in `supabase/SQL Scripts/<date>_<name>_rollback.sql`, read-only checker in `scripts/check-bos-<name>-migration.sql`, SQL-text Jest guard in `supabase/migrations/__tests__/<name>.migration.test.ts`. Latest migration is `20261012` | `20261012_business_os_invites.sql`; `supabase/SQL Scripts/20261012_business_os_invites_rollback.sql`; `scripts/check-bos-invites-migration.sql`; `supabase/migrations/__tests__/business-os-invites.migration.test.ts` |
| Data lifecycle registration | Purge: `never(…)` descriptors, entitlements at `§8.13` (`descriptors.ts:378-390`), plus `classification-baseline.json`. Ownership: `USER_OWNED_TABLES` with a reason (`businessOwnedTables.ts:120-205`), guarded by a test that parses every migration for `user_id` tables. Deletion: `ACCOUNT_POLICY_EXCEPTIONS` — `credit_transactions`, `billing_events`, `user_subscriptions` and `token_usage` are `minimise` (`accountDeletionPolicy.ts:73-115`). No production executor runs the deletion policy today (it is policy + tests + scripts) | `lib/business-os/purge/descriptors.ts`; `lib/business-os/purge/__tests__/classification-baseline.json`; `lib/business-os/businessOwnedTables.ts`; `lib/business-os/__tests__/businessOwnedTables.test.ts:40-60`; `lib/business-os/account/accountDeletionPolicy.ts` |
| Time-budget precedent | `withReadBudget`: `Promise.race` against a timer that is `unref()`ed and cleared in `finally` | `lib/business-os/llm/modelSettings.ts:819-834` |
| Cancelling a PostgREST call | `supabase-js ^2.50.4`; `query.abortSignal(signal)` is used in a repository today | `package.json:64`; `lib/repositories/AuditTrailRepository.ts:239` |
| Repository + RPC precedent | Service-role repositories calling one RPC, documented RLS bypass, `{ data, error }` never thrown | `lib/repositories/BusinessOsEntitlementShadowRepository.ts:113`; `BusinessOsAccountPlanRepository.ts:1-30`, `:716` |
| Test environment | `tests/plugins/jest-setup.ts` stubs `NEXT_PUBLIC_SUPABASE_URL` etc., so importing `supabaseServer` does not throw — but an **unmocked** call would make a real HTTP request to `https://test.supabase.co`. About **33** suites mock `AuditTrailService` without mocking `aiActionAudit`, so they run the real `runAiAction` (T3b.0 turns this into an exact list) | `tests/plugins/jest-setup.ts:12-14`; grep census |
| What CI enforces | `typecheck:bos-llm` scopes `lib/business-os/llm/`, `usage/`, `entitlements/` and catalog importers — **not** `lib/repositories/**`. `check:bos-llm-literals` scans catalog importers plus `LITERAL_SCOPE_INCLUSIONS`. No CI job runs Jest. `next build` ignores type errors | `scripts/typecheck-bos-llm.ts:102-106`; `scripts/lib/bos-llm-scope.ts`; slice 2 workplan §11 Q-8 |
| Slice 2 SA note N-1 | `groqProvider.ts:157` hardcodes `const cost = 0; // Actually free!`. A Business OS call on Groq with tokens > 0 would land on rule 7 on every call and, **from slice 3 on, be charged at the `*` text rate** (the OpenAI maximum). Unreachable today: `ALLOWED_PROVIDERS_LAYER2 = ['openai']` | `lib/ai/providers/groqProvider.ts:157`; `lib/business-os/llm/modelSettingsPolicy.ts:30`; recorded in §10 R-9 and §12 |

---

## 2. Implementation Approach — 3a

3a is pure code and tests. No migration, no DB access, no UI, no call-site change.

### 2.1 The action id (SA-B1)

**File:** `lib/business-os/llm/aiActionAudit.ts` (proposed)

- `runAiAction` mints `const actionId = randomUUID()` (from `node:crypto`; the module is already Node-only through `node:async_hooks`) **once per invocation**, before the scope opens. A nested `runAiAction` mints its own. A retry by the caller is a new invocation, so a new id (FR-9).
- `AiActionSummary` gains `actionId: string`. `AiAuditDetails` becomes `schema: 2` and gains `actionId: string`. `buildAiAuditEntry` writes both. **`entityId` stays the grouping id** (existing admin filters and deep links key on it); the audit ↔ charge join is `details.actionId` (SA-B1: "a grouping id can now map to several audit entries").
- The action id is **not** exposed on `AiActionHandle`: no call site needs it, so no call site changes.
- **The outcome is computed once.** A small exported pure helper, `resolveActionFailure(calls, signalled, thrown)`, holds today's rule exactly (signalled code, else the thrown error's code, else the last-attempt rule). `emitAiAuditEntry` uses it, and 3b's charge record uses the same result, so the audit entry and the charge can never disagree on succeeded / failed. `buildAiAuditEntry` keeps its `summary.failure ?? lastAttemptFailure(calls)` so its behaviour for direct callers is unchanged.
- **Old entries stay `schema: 1`** and are not backfilled. No reader parses `schema` (grep: only tests and the builder mention it).
- Tests that change with it: the closed key list (`aiActionAudit.test.ts:269-278`) gains `actionId`; "a failed entry adds only errorCode" goes from 16 to 17 keys (`:285`); `schema` → 2 (`:488`). `app/admin/audit-trail/__tests__/aiCostPrecision.render.test.tsx:47` keeps `schema: 1` on purpose — it renders a stored old row.

### 2.2 The credit value, version 0 (SQ-7, FR-3, SA-S6)

**File:** `lib/business-os/entitlements/config/creditValue.ts` (proposed, new)

```typescript
export interface CreditValueVersion {
  /** Recorded on every charge row (FR-3). Strictly increasing from 0. */
  version: number;
  /** USD of real provider cost per credit (BD-1). */
  usdPerCredit: number;
  status: 'provisional' | 'derived';
  /** The matrix version the value is paired with (SQ-7: versioned with the matrix). */
  matrixVersion: number;
  decidedOn: string;       // ISO date
  derivation: string;      // why this number, in words
}

/** Append-only. Changing an existing entry rewrites history (FR-3); a test refuses it. */
export const CREDIT_VALUE_HISTORY = [
  {
    version: 0,
    usdPerCredit: 0.001,
    status: 'provisional',
    matrixVersion: 1,
    decidedOn: '2026-09-28',
    derivation: 'Working figure from requirement §2 (BD-1). Provisional: slice 5 derives the real value from slice 4 measurement together with the plan allowances (FR-37, BD-8).',
  },
] as const satisfies readonly CreditValueVersion[];

export function currentCreditValue(): CreditValueVersion; // the last entry
```

- **Why a separate history rather than a field on `TIER_MATRIX`:** `TIER_MATRIX` is Zod-validated at load (`source.ts` / `schema.ts`), and `mode.ts` must not import those (RC-7). A side-effect-free data file keeps the credit value readable on the hot path without pulling config validation into `runAiAction`. `matrixVersion` pairs the two, as SQ-7 asks. (Q-2 asks SA to confirm.)
- **Append-only guard (FR-3, AC-2):** a committed snapshot `lib/business-os/entitlements/config/creditValue.history.json` holds every released entry; a test fails if any existing entry differs from the snapshot, if versions are not `0, 1, 2 …`, or if `usdPerCredit` is not finite and > 0. Slice 5 appends version 1 and extends the snapshot in the same PR — it cannot edit version 0.
- **"Logs the active version at start-up" (SA-S6):** serverless has no start-up hook, so the resolver logs `info` `{ event: 'bos_credit_value_active', version, usdPerCredit, status }` **once per process, on first use**. In 3a nothing in production calls the resolver, so the first log appears when 3b ships.
- The file sits under `lib/business-os/entitlements/`, so `typecheck:bos-llm` covers it. It does not import the catalog, so the literal check does not scan it; it holds no model or temperature literal anyway.
- `ai.actions` (id, unit, labels) is **not** touched: the unit change is slice 5 (FR-37, SA-S11).

### 2.3 The one resolver (FR-2, FR-6, SQ-8)

**File:** `lib/business-os/llm/chargeResolver.ts` (proposed, new; server-only because it imports `chargePricing.ts`)

```typescript
export interface ActionCharge {
  /** USD, the unrounded priced sum, rounded to 10 dp for storage (SQ-8). */
  costUsd: number;
  /** costUsd ÷ usdPerCredit, rounded to 6 dp (SQ-8). Never rounded further here. */
  credits: number;
  creditValueVersion: number;
  isFallbackPriced: boolean;
  fallbackCallCount: number;
}

export type ChargeTrigger = 'owner' | 'scheduled' | 'external';

/** The ONLY cost → credits conversion (FR-2). Pure apart from the one-per-process info log. */
export function resolveActionCharge(calls: readonly UsageCallRecord[]): ActionCharge;

/** 'user' → 'owner'; 'scheduled' and 'external' unchanged (FR-10, SQ-15 (3)). */
export function toChargeTrigger(trigger: AiTrigger): ChargeTrigger;

/** Exactly the thin row 3b writes (FR-13), or null when nothing is charged. */
export interface AiChargeRecord {
  actionId: string; accountId: string; groupId: string;
  actionType: AiActionType; trigger: ChargeTrigger; outcome: 'succeeded' | 'failed';
  credits: number; costUsd: number; creditValueVersion: number; isFallbackPriced: boolean;
}
export function buildAiChargeRecord(input: {
  spec: AiActionSpec; actionId: string; accountId: string | undefined;
  calls: readonly UsageCallRecord[]; failure: { code: string } | undefined;
}): { record: AiChargeRecord } | { skipped: 'no_calls' | 'not_charged' | 'invalid_identity' | 'unpriceable' };
```

**Rules** (each is a test in §7.1):

| # | Input | Result | Source |
|---|---|---|---|
| 1 | No calls | `skipped: 'no_calls'` — no row, the balance does not move (an image served from the reuse cache) | FR-7, AC-6; mirrors the audit's "no LLM call, no entry" |
| 2 | `AI_ACTION_DECLARATIONS[type].isCharged === false` | `skipped: 'not_charged'` (none today; all 16 are `true`) | FR-4 |
| 3 | `validateIdentities` fails (non-UUID group or account, or the platform account) | `skipped: 'invalid_identity'` | Standard 2, RC-3 |
| 4 | `priceActionForCharge` cost not finite or < 0 (a defect) | `skipped: 'unpriceable'` | Defensive; slice 2 guarantees finite ≥ 0 |
| 5 | Otherwise | `costUsd = round10(priced.costUsd)`, `credits = round6(priced.costUsd / usdPerCredit)` (from the **unrounded** cost), `isFallbackPriced` from slice 2, outcome from `failure` | FR-2, FR-6, FR-8, FR-12b, SQ-8 |

- **Built only from the in-memory call list** (FR-11, AC-30): the resolver never reads `token_usage` or the audit's rounded `estimatedCostUsd`. A source guard test asserts the new modules contain no `token_usage`, `user_subscriptions`, `credit_transactions` or `billing_events` string (AC-11, AC-30).
- **Precision:** a lone ~2e-7 USD embedding → `0.0002` credits at v0 (non-zero, not 1) — AC-5 (storage half). A plan-cache hit is charged its lookup embedding (SA-S1, AC-6). A failed action is charged the calls it made (FR-8, AC-7). Five calls → one record for all five (FR-5, AC-10).
- **No second `error` for an unpriced call** (S2 N-4): the resolver is silent; `bos_llm_call_unpriced` stays the one event.
- Literal scope: `chargeResolver.ts` does not import the catalog, so it is added to `LITERAL_SCOPE_INCLUSIONS` exactly as slice 2's SF-1 did for `chargePricing.ts` (Q-6 asks SA to authorise the `scripts/**` touch again).

### 2.4 What 3a changes at runtime

Only this: each `runAiAction` mints one UUID, and each AI audit entry carries it with `schema: 2`. The resolver and the builder are imported by tests only (grep-verified at T3a.5), exactly as `chargePricing.ts` was in slice 2.

---

## 3. Implementation Approach — 3b

### 3.1 Names (SA names the tables; Dev proposes)

| Object | Proposed name | Why |
|---|---|---|
| Charge table | `business_os_ai_charges` | Business OS-namespaced (SA-S8), matches `business_os_account_plans` / `business_os_entitlement_*`; the requirement's working name `business_ai_charges` lacks the `_os_` namespace every entitlements table carries |
| Totals table | `business_os_ai_charge_totals` | One row per `(user_id, period_start)` (SQ-1) |
| Write RPC | `business_os_record_ai_charge(...)` | Verb-first, matches `business_os_record_shadow_events` |
| Period function | `business_os_ai_period_start(anchor, at)` | The one definition of an anniversary period (T-6) |
| Repository | `lib/repositories/BusinessOsAiChargeRepository.ts` | `new-repository` skill |
| Recorder | `lib/business-os/llm/aiChargeRecorder.ts` | The budgeted, never-throwing write |

### 3.2 The charge row (FR-13, SQ-15) and the adjustment shape decided now

**One table, with a row kind.** A charge row is the thin row; an adjustment (slice 4) is a second kind in the **same** table, so the diary and the totals rebuild read one table (SA-S5, SQ-15) and slice 4 adds rows, not a migration.

| Column | Charge row | Adjustment row (slice 4, shape only) |
|---|---|---|
| `id uuid PK default gen_random_uuid()` | its own id | its own id |
| `kind text` | `'charge'` | `'adjustment'` |
| `action_id uuid UNIQUE` | **required**, from `runAiAction` — the idempotency key (SA-B1, SQ-2) | **NULL** — never reuses an action id (SQ-15) |
| `adjusts_action_id uuid → business_os_ai_charges(action_id)` | NULL | **required** |
| `user_id uuid → auth.users(id)` | the account (server-derived) | the adjusted row's account |
| `created_at timestamptz default now()` | write time | write time |
| `period_start timestamptz NOT NULL` | written at charge time (SQ-15 (1)) | slice 4 decides (the original's, or the period it is made in) |
| `group_id uuid` | **required**, indexed, **not** unique (SQ-15 (2)) | NULL allowed |
| `credits numeric(18,6)` | ≥ 0 | signed |
| `cost_usd numeric(16,10)` | ≥ 0 | signed |
| `credit_value_version integer ≥ 0` | from 3a | the version the correction is priced at |
| `is_fallback_priced boolean` | slice 2's flag | false |
| `action_type text` | **required**, format-checked `^[a-z][a-z0-9_]{0,63}$` (not an enumerated CHECK, so a new `AiActionType` needs no migration) | NULL |
| `triggered_by text` | **required**, `owner` / `scheduled` / `external` (SQ-15 (3)); named `triggered_by` because `trigger` is an SQL keyword | NULL |
| `outcome text` | **required**, `succeeded` / `failed` | NULL |
| `reason_code text` | NULL | **required**, format-checked |

Two `CHECK` constraints make each kind's shape impossible to violate (charge: `action_id`, `group_id`, `action_type`, `triggered_by`, `outcome` present, `adjusts_action_id` and `reason_code` absent, credits and cost ≥ 0; adjustment: `action_id` absent, `adjusts_action_id` and `reason_code` present). **No** tokens, models, call names, areas or error codes (FR-13, AC-11).

**Rows are never updated in place, by privilege, not by care:** `service_role` gets `SELECT, INSERT` on the charge table and nothing else (§6.1). `user_id` becomes NULL only through the foreign key's `ON DELETE SET NULL`, which runs as the table owner (the `minimise` verdict, Q-8).

### 3.3 The totals row (SQ-1, FR-18, SQ-5)

`business_os_ai_charge_totals`, PK `(user_id, period_start)`, FK `user_id → auth.users(id) ON DELETE CASCADE`: `credits_total`, `credits_owner`, `credits_scheduled`, `credits_external`, `credits_adjustment` (0 until slice 4), `cost_usd_total`, `charge_count`, `fallback_priced_count`, `updated_at`. The per-trigger split is there now so slice 6's "you vs automatic" (FR-25) and slice 12's `external` count need no migration. It is **derived data**: it can always be rebuilt as `SUM(...) GROUP BY user_id, period_start` over the charge rows, using each row's stored `period_start` (NFR Correctness). §6.3 includes the rebuild query as a verify step.

### 3.4 The period (T-6), resolved inside the RPC

The requirement says the period runs from the account's own anchor (T-6), written at charge time. **Proposal (Q-1): compute it in SQL, inside the write RPC, in the same transaction.**

- `business_os_ai_period_start(p_anchor, p_at)`: the latest `anchor + n months ≤ at`, **computed in UTC** (`AT TIME ZONE 'UTC'`, so the session time zone cannot move it), with `n` counted from the anchor rather than chained month to month, so a 31st anchor gives Jan 31 → Feb 28 → Mar 31 (Postgres month arithmetic clamps, as Stripe's billing cycle does). `n` may be negative, so a future anchor still yields a period.
- **Why SQL, not TypeScript:** one round trip instead of two; the anchor and the charge are read and written atomically, so an admin changing the anchor mid-write cannot split a charge; there is no second failure mode ("anchor unreadable → no charge"); and slice 9 reads the current period through the same function. The cost is that Jest cannot execute it — so the checker (§6.3) asserts fixed cases **on production, read-only** (the function is side-effect free), and the migration test pins the UTC wording.
- **Missing plan row (Q-3):** fall back to the calendar month in UTC (`date_trunc('month', now() AT TIME ZONE 'UTC')`), and return `anchor_source = 'calendar_month'` so the recorder logs `warn` `{ event: 'bos_ai_charge_no_plan_row', accountId, actionId }`. The charge is still written; nothing is lost.
- The charge time is the **write** time (`now()` in the database), i.e. the end of the action. An action that straddles a period boundary is charged to the period it finished in.

### 3.5 The write RPC (SQ-1, SQ-2, SA-S8)

`business_os_record_ai_charge(p_action_id uuid, p_user_id uuid, p_group_id uuid, p_action_type text, p_triggered_by text, p_outcome text, p_credits numeric, p_cost_usd numeric, p_credit_value_version integer, p_is_fallback_priced boolean) RETURNS TABLE (recorded boolean, period_start timestamptz, anchor_source text)` — `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`:

1. Refuse NULL `p_action_id` / `p_user_id` / `p_group_id` (`RAISE`); read `period_anchor` for `p_user_id`; compute `v_period` (§3.4).
2. `INSERT INTO public.business_os_ai_charges (kind, action_id, user_id, period_start, group_id, …) VALUES ('charge', …) ON CONFLICT (action_id) DO NOTHING` — `kind` is **hard-coded** `'charge'`: slice 3's RPC cannot write an adjustment.
3. **Only if a row was inserted**, upsert the totals row: `ON CONFLICT (user_id, period_start) DO UPDATE SET credits_total = t.credits_total + EXCLUDED.credits_total, …` (row-locked, so two concurrent actions of one account never lose an update).
4. Return `recorded = FOUND`, the period and the anchor source.

Idempotent on the action id (SQ-2): a repeat write of the same invocation inserts nothing and moves no total. Two concurrent writes of the same id serialise on the unique index; the second returns `recorded = false`. **No trigger** is created on either table (tenant-isolation-guard Step 4: nothing fires an unscoped write).

### 3.6 The repository

`BusinessOsAiChargeRepository` (per `new-repository`, adapted to an insert-only ledger — no `update`, no soft delete): one method, `recordCharge(record, { signal })` → `RepositoryResult<{ recorded: boolean; periodStart: string; anchorSource: 'plan' | 'calendar_month' }>`. It builds the RPC arguments **field by field** from the typed record (tenant-isolation-guard Step 3 — never a spread), passes the abort signal, and returns `{ data, error }`, never throwing. Header documents the intentional service-role use (the table has no client write privilege at all). No read methods in slice 3: nothing reads the ledger until slice 4 / 6 / 9, and each adds its own `.eq('user_id', …)`-scoped read then. Exported from `lib/repositories/index.ts`.

### 3.7 The recorder and the wiring (SQ-3, SQ-11 condition 1, WC-21)

**File:** `lib/business-os/llm/aiChargeRecorder.ts` (proposed)

```typescript
/** SQ-3: "a short time budget, ≤ 2 s". 1.5 s leaves margin under SA's ceiling. */
export const BOS_AI_CHARGE_WRITE_BUDGET_MS = 1_500;

/** Write one action's charge. Resolves within the budget. NEVER throws, never rejects. */
export async function recordAiCharge(input: ChargeInput): Promise<void>;
```

- Calls `buildAiChargeRecord` (3a). A `skipped` result logs at `debug` (`no_calls`, `not_charged`) or `error` `{ event: 'bos_ai_charge_not_written', reason: 'invalid_identity' | 'unpriceable', ids }` (FR-16: an uncharged action is discoverable).
- Writes through the repository inside the `withReadBudget` shape (`Promise.race` + `unref()`ed timer cleared in `finally`), **plus** an `AbortController` so a timed-out request is cancelled client-side.
- Outcomes and logs (never owner text; ids only — Standard 5):

| Outcome | Level | Event and fields |
|---|---|---|
| Recorded | `debug` | `bos_ai_charge_recorded` (per-action `info` would be noise at production volume) |
| Recorded, fallback-priced | `info` | `bos_ai_charge_fallback_priced` `{ actionId, groupId, accountId, actionType, fallbackCallCount }` — one per **charge**, distinct from the per-**call** `bos_llm_call_unpriced` error (S2 N-4) |
| Duplicate (`recorded: false`) | `warn` | `bos_ai_charge_duplicate` — should never happen in-process |
| No plan row | `warn` | `bos_ai_charge_no_plan_row` |
| Repository error, timeout or any throw | `error` | `bos_ai_charge_write_failed` `{ accountId, area, actionType, groupId, actionId, reason: 'db_error' \| 'timeout' \| 'exception', errCode }` — FR-16's exact field list. On `timeout` the write's fate is **unknown** (the server may still commit); the row is idempotent and slice 4's leak check reconciles either way |

**Wiring in `runAiAction`** (the only production change in 3b outside the new files):

```typescript
const outcome = await withUsageScope(spec.groupId, () => fn(handle));
const failure = resolveActionFailure(outcome.usage.calls, signalled, thrown);   // 3a
try { emitAiAuditEntry(...) } catch { … }            // unchanged: queued, never awaited
try { reportUnpricedCalls(...) } catch { … }         // unchanged (slice 2)
await recordAiChargeSafely({ spec, actionId, accountId, calls, failure });   // NEW
if (!outcome.ok) throw outcome.error;
return outcome.value;
```

- **After** the audit entry is queued, so the audit never waits on the charge (FR-15: with the audit queue failing, the charge is still written; with the charge failing, the audit is still queued — AC-12).
- **Before** the rethrow, so a failed action is charged what it spent (FR-8).
- `recordAiChargeSafely` wraps `recordAiCharge` in its own `try/catch` **and** `.catch`, so even a defect in the recorder's own synchronous code cannot reach the action (defence in depth; `recordAiCharge` already never throws).
- **Zero-call actions return without awaiting anything** (rule 1 is evaluated synchronously before any I/O), so an action that made no AI call gains no latency.
- **Mode (Q-4):** proposed **charge in every mode**, including `off`. Recording refuses nothing, and gating on the mode would silently stop charging on any environment where the variable is unset — CLAUDE.md still says production is unset, while the entitlements doc says `shadow` (§1). FR-38 is met either way in production (`shadow`).
- **Import graph (Q-5):** 3b puts the repository (→ `supabaseServer`) and `chargePricing` (→ `SystemConfigRepository`) into `aiActionAudit.ts`'s graph, which slice 2's Q-1 (b) deliberately kept out. That is unavoidable for a direct write. Proposed: import statically (rates stay lazy; the env stubs keep imports safe in Jest), rather than a dynamic `import()` on the hot path. `aiActionAudit.ts` is already server-only, and `next build` (T3b.9) proves no client bundle reaches it.

### 3.8 The non-interference proof (SQ-11 condition 1)

"Unable to throw into, delay beyond its budget, or change the result of any action" is proven in `runAiAction` itself, which all 16 sites share, and then re-checked at the sites:

| # | Property | Test (fake timers, mocked repository) |
|---|---|---|
| NI-1 | Cannot throw into an action | Repository throws synchronously; rejects; resolver throws; builder throws → the action's value is the **same reference**, a thrown error is the **same object**, the audit entry is still queued once |
| NI-2 | Cannot delay beyond the budget | Repository never resolves → `runAiAction` settles at `BOS_AI_CHARGE_WRITE_BUDGET_MS` (+ one tick) with the action's value; the abort signal fired; one `bos_ai_charge_write_failed` with `reason: 'timeout'`; no timer left pending (Jest open-handle check) |
| NI-3 | Cannot change the result | The same action with the recorder mocked to succeed, to fail, and to hang produces deep-equal return values and deep-equal audit entries (apart from nothing: the action id is minted before, not by, the recorder) |
| NI-4 | Adds no await when there is nothing to charge | Zero calls → the repository is never called and no timer is created |
| NI-5 | Holds at every site | T3b.7 runs the call-site suites (the census from T3b.0) before and after with identical pass sets |

---

## 4. Files to Create / Modify

`console.*` counts measured at `7faca4f7` (§12).

### 4.1 Slice 3a

| File | Action | Reason | `console.*` |
|---|---|---|---|
| `lib/business-os/llm/aiActionAudit.ts` | modify | Mint `actionId`; `schema: 2` + `actionId` in details; `actionId` on the summary; `resolveActionFailure` (§2.1) | 0 |
| `lib/business-os/entitlements/config/creditValue.ts` | create | Credit value history, v0 provisional (§2.2) | — |
| `lib/business-os/entitlements/config/creditValue.history.json` | create | The append-only snapshot (§2.2) | — |
| `lib/business-os/llm/chargeResolver.ts` | create | `resolveActionCharge`, `toChargeTrigger`, `buildAiChargeRecord` (§2.3) | — |
| `lib/business-os/llm/__tests__/aiActionAudit.test.ts` | modify | Key list, 17 keys, `schema: 2`, one id per invocation (§2.1) | 0 |
| `lib/business-os/entitlements/__tests__/creditValue.test.ts` | create | Snapshot, versions, value > 0, one-per-process log | — |
| `lib/business-os/llm/__tests__/chargeResolver.test.ts` | create | Every rule in §2.3; source guard (no `token_usage` / Pilot-Credit table names) | — |
| `scripts/lib/bos-llm-scope.ts` | modify (**if SA authorises**, Q-6) | `LITERAL_SCOPE_INCLUSIONS` entry for `chargeResolver.ts` | **1** (pre-existing, `:66`) |
| `scripts/__tests__/check-bos-llm-literals.test.ts` | modify (with the above) | Equality pin | 0 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify (**added at implementation**, see §5.1.1 D-3) | `KNOWN_NON_GATE_IMPORTERS` entry for `chargeResolver.ts`: the backward guard requires every file outside the module that imports from `business-os/entitlements/` to be a registered gate or a named non-gate with its exact symbols | 0 |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md` | create | This document | — |

### 4.2 Slice 3b

| File | Action | Reason | `console.*` |
|---|---|---|---|
| `supabase/migrations/20261014_business_os_ai_charges.sql` | create | Tables, function, RPC, grants, RLS (§6.1). `20261014` is the first free date after `main`'s `20261013_business_os_invite_existing_account.sql` (SF-2; checked at `origin/main` `7c21d009`). Re-checked against `main` at T3b.1 | — |
| `supabase/SQL Scripts/20261014_business_os_ai_charges_rollback.sql` | create | §6.2 | — |
| `scripts/check-bos-ai-charges-migration.sql` | create | Read-only verifier (§6.3) | — |
| `supabase/migrations/__tests__/business-os-ai-charges.migration.test.ts` | create | SQL-text guard, invites-migration pattern | — |
| `lib/repositories/BusinessOsAiChargeRepository.ts` | create | §3.6 | — |
| `lib/repositories/__tests__/BusinessOsAiChargeRepository.test.ts` | create | Exact RPC arguments, error path, abort signal passed | — |
| `lib/repositories/index.ts` | modify | Export class, singleton, types | 0 |
| `lib/business-os/llm/aiChargeRecorder.ts` | create | §3.7 | — |
| `lib/business-os/llm/__tests__/aiChargeRecorder.test.ts` | create | Outcomes, logs, budget, abort | — |
| `lib/business-os/llm/aiActionAudit.ts` | modify | One awaited `recordAiChargeSafely` call (§3.7) | 0 |
| `lib/business-os/llm/__tests__/aiActionAudit.test.ts` | modify | NI-1 to NI-4, ordering, AC-8 (two turns, one header → two records) | 0 |
| `lib/business-os/purge/descriptors.ts` | modify | Two `never(…)` descriptors beside the entitlements tables (§6.5) | 0 |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | Two `never` entries | — |
| `lib/business-os/businessOwnedTables.ts` | modify | Two `USER_OWNED_TABLES` entries with reasons | 0 |
| `lib/business-os/account/accountDeletionPolicy.ts` | modify | `business_os_ai_charges: minimise`; totals default `delete` (Q-8) | 0 |
| Call-site suites from the T3b.0 census | modify, **only if** they break | `jest.mock` of the recorder where a suite asserts "no error log" or a stubbed `supabaseServer` lacks `.rpc` (Q-7) | counted at T3b.0 |
| `scripts/lib/bos-llm-scope.ts` + its test | modify (**if SA authorises**, Q-6) | Inclusion for `aiChargeRecorder.ts` if it does not import the catalog | 1 (pre-existing) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | A short "Metering (slice 3)" section: the two tables, the credit value v0, the charging start, "nothing reads it yet" | 0 |

**Deliberately not touched (either part):** `lib/business-os/entitlements/balance.ts`, `EntitlementService.ts`, `enforcementPoints.ts`, `config/catalog.ts` (`ai.actions`), `config/tierMatrix.ts`, `config/cohorts.ts`; every `runAiAction` call site; `lib/ai/**` (pricing, providers, `usageScope.ts`); `chargePricing.ts` and `chargeClassification.ts` (consumed, not changed); `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `app/api/run-agent/**`; `user_subscriptions`, `credit_transactions`, `billing_events`, `token_usage`; `app/admin/**` and every owner surface; the requirement doc.

---

## 5. Task List

Each task ends with its own suites green. ⬜ = to do; marked ✅ when done.

### 5.1 Slice 3a

- ✅ **T3a.0: Baseline.** Record `npx jest lib/business-os/llm lib/business-os/entitlements app/admin/audit-trail scripts/__tests__/check-bos-llm-literals.test.ts` (pass counts; the known `callParams.boundary.step2 › briefing/daily_narration` snapshot failure noted as pre-existing if still present), `npm run typecheck:bos-llm` (0 new; baseline sha256), `npm run check:bos-llm-literals`, and the scoped type program (S2 C-3: scratch tsconfig **outside the repo**, `extends` the worktree's, `incremental: false`, `include: []`, `files` = `next-env.d.ts` + every file in §4.1 that exists).
- ✅ **T3a.1: The action id (§2.1).** Mint, carry, `schema: 2`, `resolveActionFailure`; update the three pins; add "two invocations with the same group → two entries, two different action ids" and "a nested action mints its own id".
- ✅ **T3a.2: Credit value v0 (§2.2).** `creditValue.ts`, the JSON snapshot, `creditValue.test.ts`.
- ✅ **T3a.3: The resolver and the record builder (§2.3).** `chargeResolver.ts` + tests for rules 1–5, AC-5 (storage), AC-6, AC-7, AC-10, trigger mapping, the source guard, the one-per-process log.
- ✅ **T3a.4: Literal scope (Q-6).** Only if SA authorises: the inclusion entry and its pin.
- ✅ **T3a.5: Gates and evidence.** Re-run T3a.0; `typecheck:bos-llm` 0 new with the baseline unchanged, `--list` shows the new files; scoped program: 0 errors in touched files and the outside error set identical (file + code + message); `NODE_OPTIONS=--max-old-space-size=6144 npx next build` passes; grep shows no non-test importer of `chargeResolver` / `chargePricing`; `git diff HEAD --stat` has no deletion-without-insertion (the truncation hazard); no `runAiAction(` call site in the diff.
- ✅ **T3a.6: Handover.** Status → Code Complete (3a); everything left **uncommitted** for the user's diff review; notify TL for SA code review.

#### 5.1.1 Dev evidence — 3a (2026-09-28)

Worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-3` @ `7faca4f7`, nothing committed.

**What changed at runtime:** each `runAiAction` invocation mints one `randomUUID()` (from `node:crypto`) before the scope opens; the AI audit entry carries it as `details.actionId` with `details.schema: 2`. `entityId` is still the grouping id. The outcome is now computed by the exported `resolveActionFailure(calls, signalled, thrown)` (signalled code → thrown error's code → last-attempt rule), which `emitAiAuditEntry` uses; `buildAiAuditEntry` keeps `summary.failure ?? lastAttemptFailure(calls)`, so its behaviour for direct callers is unchanged. No call site changed (the only `runAiAction(` lines in the diff are in `aiActionAudit.test.ts`). The action id is not on `AiActionHandle`.

**Unwired:** `grep` of `lib/`, `app/`, `components/`, `scripts/` for an import of `chargeResolver`, `chargePricing` or `config/creditValue` outside `__tests__`: the only importer of `chargePricing` and `creditValue` is `chargeResolver.ts`, and **nothing imports `chargeResolver.ts`** outside its test (`scripts/lib/bos-llm-scope.ts` names it as a string only).

| Gate | Baseline (T3a.0) | After (T3a.5) |
|---|---|---|
| `npx jest lib/business-os/llm lib/business-os/entitlements app/admin/audit-trail scripts/__tests__/check-bos-llm-literals.test.ts` | 53 suites (51 pass, 2 fail); 1,360 tests (1,358 pass, 2 fail) | 55 suites (53 pass, 2 fail); 1,421 tests (1,419 pass, 2 fail). The **same two** failures, both pre-existing and both already fixed on `origin/main` (below) |
| `aiActionAudit.test.ts` | 40 tests | 48 tests (8 new: action id ×4, `resolveActionFailure` ×4); the three pins moved (key list + `actionId`, 16 → 17 keys, `schema` 1 → 2 ×2) |
| `creditValue.test.ts` (new) | — | 10 tests |
| `chargeResolver.test.ts` (new) | — | 41 tests |
| Related suites asserting the audit shape or running the real `runAiAction` (`BriefingStore.audit.attribution`, `lead-reply-attribution`, chat-v4 `route.audit`, insight-detect `route.audit`, onboarding build `route.audit`, onboarding chat `route.attribution`, media `route.attribution`, website `aiAudit.routes`, `lib/business-os/usage`, `lib/audit`, `app/admin`, `lib/admin/health`, health-summary, admin audit-trail route, `app/api/audit`, `AuditTrailRepository`, `adminReadMethods.guard`, `components/test-business-os/llm-usage`, `lib/business-os/bizql/mutate`) | — | 66 suites, 1,358 tests: 1,356 pass. 3 suites red, **none from 3a**: chat-v4 `route.audit.test.ts` crashes the worker with an unhandled `profile read failed` error and `tokenUsageRepository.contract.test.ts` fails — **both red identically with the 3a changes stashed**; `app/admin/business-os-invites/__tests__/page.render.test.tsx` failed once under parallel load and passes alone (10/10), and it does not reach `aiActionAudit` |
| `npm run typecheck:bos-llm` | 293 files, 28 errors, 0 new; baseline sha256 `d81772b0…29f2` | 297 files, 28 errors, **0 new**; baseline sha256 **unchanged**. `--list` shows `chargeResolver.ts`, `creditValue.ts` and both new tests as `core` |
| `npm run check:bos-llm-literals` | 48 files, 2 exempt, 0 violations | 49 files, 2 exempt, **0 violations**; `--list` shows `included lib/business-os/llm/chargeResolver.ts` (3 included by name) |
| Scoped type program (S2 C-3; scratch tsconfig outside the repo, `files` = `next-env.d.ts` + every touched file that exists) | 9 errors, all outside 3a's code | 9 errors; (file, code, message) set **identical** to baseline. 0 errors in the four new files and in `aiActionAudit.ts` / its test. The 3 in `check-bos-llm-literals.test.ts` are pre-existing (TS2769 at the fixture lines, shifted by +2) and 6 in `lib/analytics/aiAnalytics.ts` |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`, CI placeholder env from `.github/workflows/build.yml`) | — | **Passes** (exit 0): "Compiled successfully", 307 pages generated. The `DYNAMIC_SERVER_USAGE` error lines are the usual static-generation probes of cookie-reading routes, unrelated to 3a |
| `git diff --stat` (tracked) | — | 5 files, 145 insertions, 12 deletions; no deletion-without-insertion. 6 new files untracked |

**Pre-existing failures (not 3a):**
- `callParams.boundary.step2 › briefing/daily_narration` (prompt-hash snapshot): red at `7faca4f7`; **fixed on `main`** by PR #134 (`7c21d009`, `fix/briefing-narration-prompt-snapshot`).
- `enforcementPoints.test.ts › finds every file that reaches the entitlements module`: red at `7faca4f7` because slice 1's `aiActionAudit.ts` imports `type { Labels }`; **fixed on `main`** (a `KNOWN_NON_GATE_IMPORTERS` entry for `aiActionAudit.ts`). This branch does not re-add that entry, to avoid a duplicate on merge; the branch goes green on that test once it takes `main`.

**Deviations from the plan (for SA):**
- **D-1** `buildAiChargeRecord` returns `{ record, fallbackCallCount }` rather than `{ record }`. `fallbackCallCount` is **not** a row field; 3b-ii's `bos_ai_charge_fallback_priced` info log (§3.7) needs it, and recomputing it would price the action twice.
- **D-2** The once-per-process `bos_credit_value_active` info log lives in `chargeResolver.ts` (as §2.2 / §2.3 say) and is tested in `chargeResolver.test.ts`, not in `creditValue.test.ts` as §7.1 listed. `creditValue.ts` stays data only (no run-time import), which `creditValue.test.ts` asserts.
- **D-3** `enforcementPoints.test.ts` gains a `KNOWN_NON_GATE_IMPORTERS` entry for `chargeResolver.ts` (symbols `currentCreditValue`, `type CreditValueVersion`), placed at the end of the list so it merges cleanly beside `main`'s `aiActionAudit.ts` entry. Not in the original §4.1; added there.
- **D-4** Rule 3 reuses `validateIdentities` (one definition of the identity rule). For a scheduled or external action it resolves the platform actor, which can emit that module's existing once-per-process "SYSTEM_ADMIN_USER_ID is not a UUID" warning. No new log.
- **D-5** Rule 4 also refuses a non-finite `credits`, and checks the **unrounded** cost, so a tiny negative cost that would round to `-0` is still `unpriceable`.
- **D-6** The builder does not validate `actionId` as a UUID: it is minted by `randomUUID()` in `runAiAction`, and the 3b-i RPC refuses a NULL; a malformed one would fail the write as `db_error`.
- **Note for 3b-ii (import cycle):** `chargeResolver.ts` imports values (`AI_ACTION_DECLARATIONS`, `validateIdentities`) from `aiActionAudit.ts`. When 3b-ii makes `aiActionAudit.ts` import the recorder (→ `chargeResolver.ts`), the two modules form a cycle. It is safe as written (every cross-module value is used at call time, never at module evaluation), but 3b-ii should confirm it under `next build` and in Jest, or move the identity check and declarations lookup behind a small dependency-free module.

### 5.2 Slice 3b — split by SA into 3b-i and 3b-ii (§13 "The split: ruling")

SA ruled the split **now**, not as a tripwire. 3b-i ships the ledger applied to PROD and inert (nothing calls the repository, as `chargePricing.ts` shipped in slice 2). 3b-ii starts charging, and starts only after 3b-i is applied and verified on PROD **and the mandatory write probe's output is recorded** (C-1). Each part is its own cycle: its own gates, its own SA code review, its own QA, its own uncommitted handover.

- ✅ **T3b.0 (a): Live `period_anchor`.** Done by SA on 2026-09-28 (§13 "Live-schema results"): live, `timestamptz`, NOT NULL, default `now()`; every proposed table and RPC name is free. R-5 is closed.

#### 5.2.1 Slice 3b-i — The ledger, applied and inert (≈ 2–2.5 days)

- ⬜ **T3b-i.0: Baselines.** T3a.0's baselines re-taken for the 3b-i files in §4.2.
- ⬜ **T3b.1: Migration, rollback, checker, SQL guard (§6).** Confirm the next free migration date on `main` (≥ `20261014`, SF-2). Write the three SQL files and the migration test, meeting C-2 (no OUT-name / column clash), C-3 (the totals CHECK), C-4 (column-level owner SELECT, checker C2), SF-1 (kind CHECKs without `user_id`, the self-FK) and the Q-1 (a)–(d), Q-8 and Q-9 conditions. No DB is touched by Dev.
- ⬜ **T3b.2: Repository (§3.6)** with its unit test (exact argument object, `error` → `{ data: null, error }`, signal passed, no throw). **No production caller** in 3b-i. Types placement per N-5.
- ⬜ **T3b.5: Data lifecycle (§6.5).** Descriptors, baseline JSON, `USER_OWNED_TABLES`, deletion policy; their existing guard tests pass (`businessOwnedTables.test.ts` parses the new migration and must find both tables classified).
- ⬜ **T3b.6: Tenant-isolation checks (§7.3)** — the checks that apply to the DB and the repository.
- ⬜ **T3b-i.8: Docs.** The entitlements doc's schema paragraph (the two tables, "nothing writes yet"); §6.3 and §6.4 finalised with the real migration date, and the write probe marked **mandatory** (C-1).
- ⬜ **T3b-i.9: Gates and evidence.** As T3a.5, plus the migration test, the repository in the scoped type program (it is outside `typecheck:bos-llm`), `next build`, a grep that no non-test file imports the repository, and a grep that no new file names `token_usage`, `user_subscriptions`, `credit_transactions` or `billing_events`.
- ⬜ **T3b-i.10: Handover.** Status → Code Complete (3b-i); uncommitted; notify TL. The migration is **not** applied by Dev: the user applies it by hand per §6.4 steps 1–4, runs the checker and the **mandatory** write probe, and pastes the probe output into §14 or §15.

#### 5.2.2 Slice 3b-ii — Start charging (≈ 2 days; starts after 3b-i is applied, checked and write-probed on PROD)

- ⬜ **T3b.0 (b)/(c): Census and baselines.** Every suite that runs the real `runAiAction` with valid identities (mocks `AuditTrailService`, does not mock `aiActionAudit`), with its pass count before the change, and the suites among them that use `jest.useFakeTimers()` (SF-3). Per wrapped route: `maxDuration`, maximum action count per invocation, headroom at today's count and at 10× (SF-4). T3a.0's baselines re-taken for the 3b-ii files.
- ⬜ **T3b.3: Recorder (§3.7)** with its tests (every outcome row, every log level and field, budget, abort, never rejects). The budget helper is written locally (Q-11). `LITERAL_SCOPE_INCLUSIONS` entry for `aiChargeRecorder.ts` if it does not import the catalog (Q-6).
- ⬜ **T3b.4: Wiring** in `runAiAction`; NI-1 to NI-4; ordering (`audit` → `unpriced check` → `charge`); AC-8 and AC-12.
- ⬜ **T3b.7: Blast radius.** Per-suite `jest.mock` of the recorder in every census suite that **reaches the write** (Q-7, SF-3), listed in §4.2. Evidence: the census run once with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` shows zero `bos_ai_charge_write_failed`. NI-5 = identical pass sets.
- ⬜ **T3b.8: Docs.** The entitlements doc's "Metering" section and § The mode flag (SF-6: metering is not mode-gated); the `bos-llm-call-standards` skill Standard 6 (SF-7); the stale CLAUDE.md mode row flagged to TL.
- ⬜ **T3b.9: Gates and evidence.** As T3a.5, plus `next build`, and the grep that no new file names `token_usage`, `user_subscriptions`, `credit_transactions` or `billing_events`.
- ⬜ **T3b.10: Handover.** Status → Code Complete (3b-ii); uncommitted; notify TL. RM records **both** timestamps (SF-5): the 3b-i migration apply time and the 3b-ii production go-live (the charging start).

---

## 6. Migration Plan, Rollback and Apply / Verify Runbook (3b)

### 6.1 The migration SQL plan

**File:** `supabase/migrations/20261014_business_os_ai_charges.sql` (proposed outline; the SQL is written at T3b.1)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Tables (§3.2, §3.3). FK to auth.users, NOT business_profiles: a business
--    Reset must never cascade a bill away (same reasoning as 20261005).
CREATE TABLE public.business_os_ai_charges (…);            -- kind CHECKs, UNIQUE (action_id)
CREATE INDEX business_os_ai_charges_user_period_idx
  ON public.business_os_ai_charges (user_id, period_start, created_at DESC);
CREATE INDEX business_os_ai_charges_group_idx
  ON public.business_os_ai_charges (group_id);
CREATE TABLE public.business_os_ai_charge_totals (…);      -- PK (user_id, period_start)

-- 2. RLS: owner SELECT only (SA-S8). No INSERT/UPDATE/DELETE policy exists.
ALTER TABLE … ENABLE ROW LEVEL SECURITY;                    -- both tables
CREATE POLICY "Owners read their own AI charges" ON public.business_os_ai_charges
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners read their own AI charge totals" ON public.business_os_ai_charge_totals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3. Privileges: REVOKE ALL (never an enumerated list — the MAINTAIN defect),
--    then state the positive side.
REVOKE ALL ON TABLE <both> FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE <both> TO authenticated;              -- behind the owner policy (Q-9: column list?)
GRANT SELECT, INSERT ON TABLE public.business_os_ai_charges TO service_role;          -- no UPDATE, no DELETE: rows are never changed
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_ai_charge_totals TO service_role;

-- 4. Functions: SECURITY INVOKER, search_path = '', callable by service_role only.
CREATE FUNCTION public.business_os_ai_period_start(p_anchor timestamptz, p_at timestamptz)
  RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = '' AS $$ … UTC … $$;
CREATE FUNCTION public.business_os_record_ai_charge(…)
  RETURNS TABLE (recorded boolean, period_start timestamptz, anchor_source text)
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ … $$;
REVOKE ALL ON FUNCTION <both> FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION <both> TO service_role;

COMMIT;
```

- **No `SECURITY DEFINER` anywhere** (SA-S8; the queued P1 on anon-callable definer functions). The RPC runs with the caller's rights, and only `service_role` may call it.
- **No backfill, no data.** The tables are created empty. That is FR-34 / FR-35 by construction: no historical `token_usage` row is converted, and no Pilot-Credit table is read (AC-26).
- The migration test pins: `REVOKE ALL` (not a list) on both tables and both functions; no `SECURITY DEFINER`; `SET search_path = ''` on both functions; `kind` hard-coded `'charge'` in the RPC; `ON CONFLICT (action_id) DO NOTHING`; `AT TIME ZONE 'UTC'` in the period function; the FK targets `auth.users`; no `token_usage` / Pilot-Credit table name; no `TRIGGER`; and that the checker names every constraint and function the migration creates (the invites-test "checker has drifted" pattern).

### 6.2 Rollback

**File:** `supabase/SQL Scripts/20261014_business_os_ai_charges_rollback.sql`

```sql
BEGIN;
DROP FUNCTION public.business_os_record_ai_charge(uuid, uuid, uuid, text, text, text, numeric, numeric, integer, boolean);
DROP FUNCTION public.business_os_ai_period_start(timestamptz, timestamptz);
DROP TABLE public.business_os_ai_charge_totals;
DROP TABLE public.business_os_ai_charges;
COMMIT;
```

**Order and cost:**
1. **Preferred rollback is code-only:** revert the 3b wiring and redeploy. The tables stay; nothing writes; nothing reads. No data is lost.
2. The DB rollback is for a **wrong migration**, ideally before charging starts. It **discards every recorded charge**; if charging has started, export both tables first (`COPY … TO STDOUT` from the SQL editor or a CSV download).
3. Never run the DB rollback while the 3b code is deployed: every AI action would then log `bos_ai_charge_write_failed` (the actions themselves still succeed — NI-1).

### 6.3 The read-only checker

**File:** `scripts/check-bos-ai-charges-migration.sql` (`SET default_transaction_read_only = on;`, one PASS / FAIL row per check, the `check-bos-entitlements-migration.sql` style)

| Check | Pass when |
|---|---|
| C1 | Both tables exist, RLS on |
| C2 | ACLs: no `anon` / PUBLIC entry; `authenticated` = `r` only; `service_role` = `ar` (charges) and `arw` (totals) — no `d`, `D` or `m` |
| C3 | Exactly one policy per table, `FOR SELECT`, `TO authenticated`, `auth.uid() = user_id` |
| C4 | `UNIQUE (action_id)`, both kind `CHECK`s, the FK targets (`auth.users`, `ON DELETE SET NULL` / `CASCADE`), the two indexes |
| C5 | Both functions `prosecdef = false`, `proconfig` has `search_path=`, `has_function_privilege('anon' \| 'authenticated', …, 'EXECUTE') = false` |
| C6 | Period cases, read-only: anchor Jan 31 10:00Z → Feb 28 10:00Z at Feb 28 11:00Z; Mar 31 at Apr 1; at exactly the anchor; a future anchor → the previous month; a 15th anchor mid-month; the same answer under `SET LOCAL TimeZone = 'Asia/Jerusalem'` |
| C7 | Before charging: both tables empty. After: the totals rebuild query (`SUM … GROUP BY user_id, period_start` over charge rows) equals the totals table exactly |

**Optional write probe** (by the user, on their own account, inside `BEGIN; … ROLLBACK;`): call the RPC twice with one action id → `recorded` = true, then false; the totals row carries one charge; two different action ids in one period → the totals sum both. `ROLLBACK` leaves nothing behind.

### 6.4 Apply / verify runbook, and the charging start

The runbook follows SA's split (§13): steps 1–4 belong to **3b-i** (the ledger applied and inert), steps 5–8 to **3b-ii** (charging starts). 3b-ii's merge does not happen until step 4's output is recorded.

| Step | Part | Who | What | Expect |
|---|---|---|---|---|
| 0 | 3a | TL / RM | 3a merged and deployed | A new AI entry in `audit_trail` has `details.schema = 2` and a `details.actionId` |
| 1 | 3b-i | User (credentials) | `npm run schema:check` on `main` | `business_os_account_plans` selects cleanly, incl. `period_anchor`; ref recorded (SA already confirmed it live read-only on 2026-09-28) |
| 2 | 3b-i | User | Paste the migration into the Supabase SQL editor on **PROD**. RM records the **apply time** (UTC) in §15 (SF-5) | `COMMIT` |
| 3 | 3b-i | User | Run `scripts/check-bos-ai-charges-migration.sql` | Every row PASS; C7 "empty" |
| 4 | 3b-i | User (**mandatory**, C-1) | The rollback-wrapped write probe (§6.3), under `SET LOCAL ROLE service_role` and then `authenticated`; output pasted into §14 or §15 | As stated in C-1; after `ROLLBACK`, C7 still "empty". 3b-i merges with nothing calling the repository |
| 5 | 3b-ii | RM | Merge 3b-ii; Vercel deploys | — |
| 6 | 3b-ii | RM | **Record the charging start** = the UTC time the 3b-ii production deployment went live, in §15 and in the entitlements doc. Rows between the step-2 apply time and this moment are developer or preview traffic on developers' own accounts (SF-5) | FR-34: "a stated moment" |
| 7 | 3b-ii | User, +1 h | Run one chat turn and one image in `/test-business-os`; then `SELECT … FROM business_os_ai_charges WHERE user_id = <own id> ORDER BY created_at DESC LIMIT 5` and the matching `audit_trail` rows | One charge per action; `action_id` = the audit entry's `details.actionId`; `triggered_by = 'owner'`; credits ≈ cost × 1000; the totals row moved; no `bos_ai_charge_write_failed` in the logs |
| 8 | 3b-ii | User, next morning | Compare, for the night: count of AI audit entries vs count of charge rows (per account); C7's rebuild query | Equal or explained (a lost audit entry, KI-10); rebuild = totals; the insight run rows carry `triggered_by = 'scheduled'` |

**Charging start (FR-34, FR-35):** charging starts at the step-6 moment. Before it, nothing is counted and no history is converted; `min(created_at)` of the charge table is the measurable proof. Pilot-Credit balances are untouched (A-11). Because environments share the production database (SF-5), the AC-26 check is "no row before the step-2 apply time, and every row before the step-6 go-live is identified" (developer or preview traffic).

### 6.5 Data lifecycle registration (SA-S8)

| Registry | `business_os_ai_charges` | `business_os_ai_charge_totals` |
|---|---|---|
| `purge/descriptors.ts` | `never` — "The bill. Never purged, never archived: a Reset that removed it would erase what the account was charged" | `never` — "Derived from the bill; rebuilt from it, never purged" |
| `classification-baseline.json` | `never` | `never` |
| `USER_OWNED_TABLES` | "The commercial record of what the account was charged; keyed to `auth.users`, not `business_profiles`, so a business Reset cannot erase it" | "A running total of the row above, per billing period" |
| `accountDeletionPolicy.ts` | `minimise` (financial record, as `credit_transactions`), via `ON DELETE SET NULL` (Q-8) | default `delete`, via `ON DELETE CASCADE` — derived data with no value once detached (Q-8) |

Not added to `BUSINESS_OWNED_TABLES` (it would cascade from `business_profiles`). Not archived by the Admin Archiving module (it archives `audit_trail` only).

---

## 7. Test Plan

### 7.1 Happy paths

| Suite | Asserts |
|---|---|
| `aiActionAudit.test.ts` (3a) | `details.schema = 2`; `details.actionId` is a UUID; two invocations → two ids; a nested action → a different id; closed key list incl. `actionId` |
| `creditValue.test.ts` | History equals the snapshot; versions `0..n`; `usdPerCredit` finite > 0; `currentCreditValue()` is the last; the active-version log fires once per process |
| `chargeResolver.test.ts` | 2e-7 USD embedding → `0.0002` credits, non-zero (AC-5); plan-cache hit → its embedding only (AC-6); five calls → one record, their sum (AC-10); a failed action → the two paid calls, `outcome: 'failed'` (AC-7); a fallback-flagged call → `isFallbackPriced: true` and the conservative figure (FR-12b); `user` → `owner`, `scheduled`, `external` (FR-10); the outcome equals the audit entry's for the same inputs |
| `BusinessOsAiChargeRepository.test.ts` | `rpc('business_os_record_ai_charge', { exact 10 args })`; `abortSignal` applied; `{ recorded, periodStart, anchorSource }` mapped |
| `aiChargeRecorder.test.ts` | Recorded → `debug`; fallback → one `info`; duplicate → `warn`; no plan row → `warn` |
| `aiActionAudit.test.ts` (3b) | One repository call per action with `action_id` = the audit entry's `details.actionId` (AC-28's join); the order audit → check → charge; a scheduled insight action → `triggered_by: 'scheduled'` (AC-9 second half) |
| Checker C6 / C7 (on PROD, read-only) | Period arithmetic; totals rebuild |

### 7.2 Failure paths

| Suite | Asserts |
|---|---|
| `aiChargeRecorder.test.ts` | Repository `error` → one `bos_ai_charge_write_failed` with account, area, action type, group and action id, `reason: 'db_error'` (FR-16, AC-12); hang → `timeout` at the budget, signal aborted; synchronous throw → `exception`; the promise **never rejects** in any case |
| `aiActionAudit.test.ts` | NI-1 to NI-4 (§3.8); with `AuditTrail.log` rejecting, the charge is still written (AC-12 first half); zero calls → no write; platform account / non-UUID group → `bos_ai_charge_not_written`, no repository call |
| `chargeResolver.test.ts` | Non-finite cost → `unpriceable`, never a NaN record; `isCharged: false` (injected declaration) → `not_charged` |
| `creditValue.test.ts` | Editing version 0 in a copy fails the snapshot comparison |
| Migration test | Any `SECURITY DEFINER`, an enumerated REVOKE, a missing `search_path`, a `TRIGGER`, or `kind` taken from a parameter fails |

### 7.3 Tenant isolation (tenant-isolation-guard)

| Check | Result |
|---|---|
| Step 1 — does the guard apply? | Service role: **yes** (the repository uses `supabaseServer`). Caller-supplied id acting on a row: **no** — `action_id` is minted in-process, and `user_id` comes only from `runAiAction`'s server-derived account (session, cron-iterated business, or DB-resolved owner — bos-llm Standard 2). The only possibly client-influenced value is `group_id` (chat-v4 takes a UUID header, SA-B1), which is **stored, never used as a key or an ownership target** |
| Step 2 — ownership pre-check | Not needed: no caller-supplied target row. The RPC writes only rows keyed by the server-derived account |
| Step 3 — explicit allow-list | The repository builds the 10 RPC arguments field by field (test: the argument object has **exactly** those keys, even when the record object carries extra properties); the RPC takes typed scalars, no `jsonb` spread; `kind` is hard-coded |
| Step 4 — the scope-defeating three | No trigger on either table; the totals upsert's conflict target is `(user_id, period_start)` with `user_id` server-derived; no caller payload reaches the insert |
| Client roles | Checker C2 / C5: `anon` and `authenticated` hold no write privilege and cannot `EXECUTE` either function; `authenticated` reads only its own rows (C3) |
| Tests | (1) exact RPC arguments; (2) platform account → no write; (3) the same client header on two chat turns → two rows with two action ids, neither suppressing the other (AC-8); (4) the recorder never reads the account from anything but its input (source guard: no `request`, `headers` or `body` in the new modules) |

### 7.4 Concurrency and idempotency

| Property | Where proven |
|---|---|
| Same invocation written twice → one row, totals once (FR-9, SQ-2) | DB: `UNIQUE (action_id)` + `ON CONFLICT DO NOTHING` + totals only on insert — migration test (text) and the optional write probe (§6.3) |
| Two concurrent actions of one account → both counted, no lost update | DB: the totals upsert is a single row-locked `ON CONFLICT DO UPDATE … = t.x + EXCLUDED.x`; unit: two concurrent `runAiAction` → two calls with distinct ids |
| Two onboarding turns in one conversation (same group) → two rows (AC-8) | Unit: distinct action ids; the group is not unique |
| A retry that made new calls is charged (FR-9) | Unit: a second invocation is a new id |
| Burst overspend | Not applicable in slice 3 (nothing is refused); slice 9 measures it (AC-28) |

**Commands**
```bash
npx jest lib/business-os/llm lib/business-os/entitlements lib/repositories/__tests__/BusinessOsAiChargeRepository.test.ts \
  lib/business-os/purge lib/business-os/__tests__/businessOwnedTables.test.ts lib/business-os/account \
  supabase/migrations/__tests__/business-os-ai-charges.migration.test.ts app/admin/audit-trail \
  scripts/__tests__/check-bos-llm-literals.test.ts   # + the T3b.0 census suites
npm run typecheck:bos-llm
npm run check:bos-llm-literals
npx tsc -p <scratchpad>/tsconfig.slice3.json          # scoped program (S2 C-3)
NODE_OPTIONS=--max-old-space-size=6144 npx next build
```

All new suites are **local-only** (no CI job runs Jest); QA must run them.

---

## 8. Estimate and the Split Decision

| Task | Days |
|---|---|
| T3a.0 baseline | 0.25 |
| T3a.1 action id, `schema: 2`, pins | 0.5 |
| T3a.2 credit value v0 + snapshot guard | 0.5 |
| T3a.3 resolver + record builder + tests | 0.5 |
| T3a.4–T3a.6 literal scope, gates, evidence | 0.25 |
| **3a total** | **≈ 2 days** |
| T3b-i.0 baselines | 0.25 |
| T3b.1 migration, rollback, checker, SQL guard (with C-1 to C-4, SF-1, SF-2) | 1.25 |
| T3b.2 repository + tests | 0.5 |
| T3b.5–T3b.6 lifecycle registration, isolation checks | 0.25 |
| T3b-i.8–T3b-i.10 schema doc paragraph, gates, build, evidence | 0.25 |
| **3b-i total** | **≈ 2–2.5 days** |
| T3b.0 (b)/(c) census, fake-timer list, per-route headroom (SF-3, SF-4) | 0.25 |
| T3b.3–T3b.4 recorder, wiring, NI proofs | 1.0 |
| T3b.7 blast radius across the census suites (Q-7 evidence run) | 0.5 |
| T3b.8–T3b.10 docs (SF-6, SF-7), gates, build, evidence | 0.25 |
| **3b-ii total** | **≈ 2 days** |
| **Slice 3 total** | **≈ 6–6.5 days** |

**Decision (SA ruling, §13): three parts — 3a, then 3b-i, then 3b-ii.** 6.5 days is over "a few days", and SA's follow-up named this seam. 3a carries no migration and almost no runtime change, so it is a cheap review that de-risks the audit `schema: 2` bump on its own. SA split 3b **now**, not on a tripwire: **3b-i** (migration, checker, repository, lifecycle registration — applied to PROD and write-probed, nothing calls the repository) is a DB-security review; **3b-ii** (recorder + wiring — charging starts) is a non-interference review. The hand-applied PROD migration is verified and left alone before any code writes to it, which removes R-6 (code deployed before the migration) by construction.

**Tripwire:** if either 3b part passes ≈ 3 days, Dev stops and reports to TL.

---

## 9. Guardrails and Out of Scope

| Must not | Why |
|---|---|
| Refuse anything, or add a pre-check | Slice 9; FR-38 |
| Change `balance.ts` (stays `ALWAYS_SUFFICIENT`), `EntitlementService`, `ENFORCEMENT_POINTS` | Slice 9 |
| Add any owner surface, or change the usage card / route | Slices 6, 7 |
| Read `token_usage` to build a charge | FR-11, AC-30 |
| Put tokens, models, call names, areas or error codes on the charge row | FR-13, AC-11 |
| Update a row in place | FR-13; enforced by privileges (§6.1) |
| Create a grants table, or **write** an adjustment row | Slices 11 and 4 (the shape only is decided here) |
| Read or write `user_subscriptions`, `credit_transactions`, `billing_events` | A-11, FR-14 |
| Change any `runAiAction` call site | Minting the action id needs none |
| Add a second `error` log for an unpriced call | S2 N-4 |
| Use a queue, outbox or §8.1 drain | SQ-3 (confirmed against `durable-queue-drain`: nothing drains a table here) |
| Use `SECURITY DEFINER` | SA-S8 |
| Change `ai.actions` (id, unit, labels), the tier matrix or cohorts | Slice 5 |
| Touch `lib/ai/**`, `anthropicProvider` / `kimiProvider` (`console.*` debt) | Not needed |
| Apply the migration (Dev) | The user applies it to PROD by hand |

**Out of scope, and where it goes:** the operator report, the leak check, adjustments written (slice 4); the real credit value and allowances (slice 5); the card and diary (6, 7); warnings (8); the balance check and "last seen at zero" (9, OI-5); a backfill of missed charges (after slice 4 measures the loss rate); the trial's one-off total (5, 9 — slice 3 records per period only).

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A DB round trip is added to **every** Business OS AI action | Awaited only after the action's own work, one RPC (tens of ms typical), bounded at 1.5 s; zero-call actions add nothing (NI-4) |
| R-2 | A Supabase slowdown makes every action wait the full budget | Bounded, logged, and the action is unchanged. A per-instance circuit breaker would save latency but is a new pattern (Q-10) |
| R-3 | A route near its `maxDuration` gets pushed over by the worst case | +1.5 s worst case; T3b.0 lists each wrapped route's `maxDuration` (e.g. insight cron 300 s) and flags any within 2 s of it |
| R-4 | ~33 suites run the real `runAiAction`; an unmocked write makes a real HTTP call to the stub URL and logs an `error` | Census at T3b.0, re-run at T3b.7; the fix shape is Q-7 |
| R-5 | `period_anchor` is assumed live from the migration file | T3b.0 runs `schema:check` first; if unverified, stop for SA |
| R-6 | The 3b code deploys before the migration is applied | Every action logs `bos_ai_charge_write_failed` (PGRST202) and still succeeds. The runbook orders apply → verify → deploy |
| R-7 | An admin `assign_tier` / `set_cohort` resets `period_anchor` to "now" (`adminOps.ts:338`, `:394`), splitting a period | Each row stores its own `period_start`, so history stays correct; the current-period read is slice 9's concern — recorded for it |
| R-8 | An owner could read `cost_usd` (dollars) of their own rows through PostgREST under the owner-SELECT policy | FR-28 governs surfaces, but this is a direct-API view of our cost. Q-9 proposes a column-level grant that omits `cost_usd` |
| R-9 | **S2 N-1:** `groqProvider.ts:157` records `cost = 0`; any Business OS area moved onto Groq would be charged the `*` text maximum on every call from slice 3 on | Unreachable while `ALLOWED_PROVIDERS_LAYER2 = ['openai']` (`modelSettingsPolicy.ts:30`). Before any area is allowed onto Groq, Groq must record a real cost or the allow-list must refuse it. Recorded in §12 for the Layer 2 owner |
| R-10 | Agent file-write truncation (project memory) | `git diff HEAD --stat` checked for deletion-without-insertion before any diff review (T3a.5, T3b.9) |
| R-11 | The migration date collides with another in-flight branch | Re-checked against `main` at T3b.1 |

---

## 11. Open Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Compute `period_start` in SQL inside the RPC (one round trip, atomic with the anchor, single definition shared with slice 9), or in TypeScript from a separate anchor read (Jest-testable, but two round trips and a second failure mode)? | SQL, UTC, anchor + n months from the anchor; fixed cases asserted on PROD by the read-only checker (§3.4, §6.3 C6) |
| Q-2 | Credit value as its own append-only history in `config/creditValue.ts` (paired to `matrixVersion`), rather than a field on `TIER_MATRIX`? | Yes — keeps Zod config validation off the hot path (RC-7) and gives FR-3 its own snapshot guard |
| Q-3 | No plan row: write the charge in the UTC calendar month and log `warn`, or refuse to write (and rely on slice 4)? | Write it (a lost charge is worse than a slightly misplaced one); `anchor_source` makes it countable |
| Q-4 | Charge in every entitlements mode (including `off`), or only in `shadow` / `enforce`? | Every mode: recording refuses nothing, and a mode gate would silently disable charging wherever the variable is unset (CLAUDE.md and the entitlements doc disagree on production today) |
| Q-5 | Accept the repository and `chargePricing` (→ `SystemConfigRepository`) into `aiActionAudit.ts`'s static graph, reversing slice 2's Q-1 (b) boundary for this purpose? | Yes, statically; a dynamic `import()` on the hot path buys nothing once a write is required |
| Q-6 | Authorise `LITERAL_SCOPE_INCLUSIONS` entries for `chargeResolver.ts` (3a) and `aiChargeRecorder.ts` (3b, if it does not import the catalog), as in slice 2's SF-1? | Yes |
| Q-7 | Test blast radius: per-suite `jest.mock('@/lib/business-os/llm/aiChargeRecorder')` only where a suite breaks, or one global no-op mock in the Jest setup with `jest.unmock` in the recorder's own suites? | Per-suite, minimal; a global mock is a new pattern and would hide the recorder from call-site suites |
| Q-8 | Deletion verdicts: charges `minimise` (nullable `user_id`, `ON DELETE SET NULL`, like `credit_transactions`), totals `delete` (`ON DELETE CASCADE`)? | Yes |
| Q-9 | Owner SELECT (SA-S8): grant `authenticated` a **column list** that omits `cost_usd` (and `is_fallback_priced`), so no owner can read our dollar cost through the API? | Yes; nothing reads with an owner session before slice 6/7, and it keeps FR-28's spirit at the data layer |
| Q-10 | A per-instance circuit breaker (skip the write for N seconds after M consecutive failures) to cap outage latency? | Not in slice 3: it trades lost charges for latency, and slice 4 should measure first |
| Q-11 | Budget 1,500 ms (SA ceiling ≤ 2 s)? No retry inside the budget? | Yes and yes; the write is idempotent, so a retry could be added later without a schema change |
| Q-12 | Table names `business_os_ai_charges` / `business_os_ai_charge_totals` (SA names them, §3.1)? And one table with a `kind` column for adjustments rather than a sibling table (§3.2)? | Yes and yes |

---

## 12. Flagged Items (console.*, stale docs, carried notes)

**`console.*`** (CLAUDE.md § Logging): every production and test file this plan modifies has **0** `console.*` calls, measured at `7faca4f7`, except `scripts/lib/bos-llm-scope.ts` — **1** call (`:66`, a `console.error` of a tsconfig diagnostic in a CLI script library), which is modified **only** if SA authorises Q-6. It is pre-existing CLI output that SA accepted leaving as is in slice 2; Dev proposes the same here, and the user may ask for its conversion. The call-site suites that the T3b.0 census may add are counted then.

**Stale doc (not fixed here):** CLAUDE.md's Key Documentation row for `BUSINESS_OS_ENTITLEMENTS.md` says "`BOS_ENTITLEMENTS_MODE` is unset in production", while `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9` says production runs `shadow` (confirmed 2026-09-27). Flagged for TL; it matters for Q-4.

**Carried from slice 2's SA code review (N-1):** `lib/ai/providers/groqProvider.ts:157` hardcodes `cost = 0`. Under slice 3 a Business OS call on Groq would be charged the `*` text rate (the OpenAI maximum, $0.03 / $0.18 per 1k). Unreachable while `ALLOWED_PROVIDERS_LAYER2 = ['openai']`; **Business OS is OpenAI-only today.** Before any Layer 2 area is allowed onto Groq, Groq must record a real cost or the allow-list must refuse it (R-9).

**Deprecated systems:** none touched or extended.

---

## 13. SA Workplan Review

**Reviewed by SA — 2026-09-28**, against worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-3` @ `7faca4f7` (this workplan uncommitted). `origin/main` has since moved to `aa9d75e9` (PR #133); see SF-2.
**Status:** ✅ **Approved with conditions.** **3a may start now.** **3b is split now into 3b-i and 3b-ii** (ruling below). The conditions are implementation conditions: they are verified at each part's SA code review, and the workplan needs no second review, apart from Dev folding the split into §5 / §8 / §6.4 (a text edit) before 3b-i starts.

Skills applied: `tenant-isolation-guard`, `business-os-schema-check`, `bos-llm-call-standards`, `new-repository`.

### Verdict in one paragraph

The design is right, and it is the design the requirement and my rulings asked for. The action id is minted where the action is, the charge is built from the same in-memory call list as the audit entry, the write is direct, awaited, time-boxed and never throws, the row is thin, the adjustment shape is decided without being written, and the tables are locked down the way the entitlements and payment tables are (REVOKE ALL, positive GRANT, INVOKER RPC, pinned `search_path`, no trigger). The non-interference proof (NI-1 to NI-5) is built at the one place all 16 sites share. What needs tightening is mostly SQL that no test in this repo can run: there is no branch database and Jest cannot execute PL/pgSQL, so the only execution of the RPC before production traffic reaches it is the write probe. That probe therefore becomes mandatory and runs under the real role (C-1). There is one latent PL/pgSQL defect in the sketched RPC (C-2). The proposed migration date is already taken on `main` (SF-2).

### Live-schema results (measured by SA, 2026-09-28)

Measured **directly against the live database** through PostgREST with the service-role key from the main checkout's `.env.local` (host `jgccgk….supabase.co`). The probe was read-only: zero-row selects (`.limit(0)`), head counts, and a GET of the PostgREST OpenAPI description. Nothing was written and no DDL was issued. Because the probe queries the database rather than replaying code, no code ref applies (`business-os-schema-check` Rule 2).

| Fact | Live result |
|---|---|
| `business_os_account_plans.period_anchor` | ✅ **Live.** `select('user_id, period_anchor').limit(0)` → OK. OpenAPI: `timestamp with time zone`, in `required` (NOT NULL), default `now()`. It is on `business_os_account_plans`, whose PK is `user_id`. Live columns: `user_id, tier, plan_version, tier_expires_at, cohort, cohort_expires_at, onboarding_started_at, profile_created_at, trial_started_at, trial_ends_at, grace_ends_at, period_anchor, origin, updated_by_admin_id, created_at, updated_at` (matches `20261005`). **R-5 is closed; T3b.0 (a) is done.** |
| `business_os_ai_charges` | ✅ **Free:** `42P01 relation "public.business_os_ai_charges" does not exist` |
| `business_os_ai_charge_totals` | ✅ **Free:** `42P01` |
| `business_ai_charges` (the requirement's working name) | Free (`42P01`). Not used |
| RPC names `business_os_record_ai_charge`, `business_os_ai_period_start` | ✅ **Free.** No OpenAPI path matches `charge` or `ai_period` |
| Existing charge-like objects | Only `credit_transactions` and the Pilot-Credit RPCs (`get_user_pilot_credits`, `has_sufficient_credits`, …), which stay untouched (A-11) |
| Plan-row coverage (Q-3) | 8 `business_os_account_plans` rows, 6 `business_profiles` rows. A missing plan row is possible but rare |
| `business_os_tenants_missing_plan_row` (§1 row "A plan row can be missing") | ⚠️ **Not callable live:** `PGRST202 Could not find the function … in the schema cache`. `20261010_business_os_tenants_missing_plan_row.sql` is in the repo but is either not applied or not in PostgREST's cache. This does not block slice 3, because the RPC does not depend on it. §6.4 must not name it as a verify step (N-2) |

**`BOS_ENTITLEMENTS_MODE`: which document is right, and whether it matters for Q-4.** In the code, an **unset** variable resolves to `off`: `parseModeSetting()` in `lib/business-os/entitlements/mode.ts` maps `''` to `off`, and an unrecognised value to `off` as well. `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9` and its Change History row of 2026-09-27 record that production is **set** to `shadow` on purpose. The Health tile confirms this: it would show amber for a refused `enforce`. `BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md:11` agrees. **CLAUDE.md's Key Documentation row ("unset in production") is stale**, and is flagged to TL, since CLAUDE.md is not SA's to edit. SA cannot read the Vercel environment itself. **For Q-4 it does not matter.** Recording is ruled mode-independent (below), so charging behaves the same whether production is `shadow` or unset. It would have mattered only for the mode-gated option, which is rejected.

### The split: ruling

**3a is accepted as proposed (≈ 2 days). 3b is split now, not held as a tripwire:**

| Part | Contents | Ships | ≈ Days |
|---|---|---|---|
| **3a** | As §2 (action id, `schema: 2`, credit value v0, pure resolver and record builder) | Alone | 2 |
| **3b-i — The ledger, applied and inert** | T3b.1 (migration, rollback, checker, SQL guard), T3b.2 (repository + tests; **no production caller**), T3b.5 (lifecycle registration), T3b.6 (the isolation checks that apply to the DB and the repository), the entitlements-doc schema paragraph. The user applies the migration to PROD and runs the checker **and the mandatory write probe (C-1)** | Merged with nothing calling the repository, as `chargePricing.ts` was in slice 2 | 2–2.5 |
| **3b-ii — Start charging** | T3b.0 (b) census, T3b.3 recorder, T3b.4 wiring and NI-1 to NI-4, T3b.7 blast radius (NI-5), T3b.8 docs (incl. SF-7), T3b.9 gates, **the charging start** | After 3b-i is applied and verified on PROD | 2 |

**Why now rather than on a tripwire.** (1) The user's standing rule is slices of a few days each, and 4.5 days is at or past that line before any overrun. (2) The seam Dev named as the fallback is the right rollout anyway. The hand-applied PROD migration is verified, write-probed and left alone for days **before** any code writes to it, which removes R-6 (code deployed before the migration) by construction. (3) Each review then covers one thing. 3b-i is a DB-security review (grants, RLS, RPC, checker). 3b-ii is a non-interference review. Mixing the two made 3b the riskiest review in this layer. The extra cycle costs little, because 3b-i's diff is mostly SQL.

### Rulings on Dev's questions

| # | Ruling |
|---|---|
| **Q-1** | ✅ **SQL, inside the RPC, as proposed.** One definition shared with slice 9, atomic with the anchor, and one failure mode. Conditions: **(a)** do the month arithmetic on the **UTC wall-clock `timestamp`** (`p_anchor AT TIME ZONE 'UTC'`), then convert back with `AT TIME ZONE 'UTC'`. `timestamptz + interval 'n months'` depends on the session `TimeZone`, and that dependence is exactly what C6's `Asia/Jerusalem` case must prove absent. **(b)** `n` counted from the anchor, never chained (the Jan 31 → Feb 28 → Mar 31 case). **(c)** C6 as listed, plus a leap-year case (anchor Jan 31, at Feb 29 2028 → Feb 29 2028) and an anchor exactly equal to `p_at`. **(d)** The migration test pins `AT TIME ZONE 'UTC'` on **both** directions of the conversion |
| **Q-2** | ✅ **Own append-only history in `config/creditValue.ts`,** paired by `matrixVersion`, as proposed. Keeping Zod validation off the hot path (RC-7) is the right reason. The snapshot guard catches **accidental** edits only: a PR can edit both files together. The **PR and its SA review are the audit record** for a value change (SQ-7, SA-S6). Say so in the file header, so no one reads the guard as tamper-proof |
| **Q-3** | ✅ **Write it, in the UTC calendar month, with `warn` `bos_ai_charge_no_plan_row` and `anchor_source = 'calendar_month'`.** A lost charge is worse than a misplaced one, and the row stays countable and rebuildable. Live data shows this will be rare (above). Record for slice 9: once a plan row appears, the account's next charge opens an anchor-based period, and the earlier calendar-month totals row is not part of it |
| **Q-4** | ✅ **Record in every mode, including `off`.** A charge is a **measurement**, like `token_usage` and the audit entry, and neither of those is gated on the mode. The mode governs entitlement **decisions** (resolve, record shadow events, refuse). FR-38's "in `shadow` it charges … and refuses nothing" holds in all three modes. Condition (SF-6): the entitlements doc's "The mode flag" section states that metering is not mode-gated, and why, so no one reads `off`'s "nothing is recorded" as covering the ledger |
| **Q-5** | ✅ **Static imports.** `aiActionAudit.ts` is already server-only, and already reaches `@supabase/supabase-js` through `AuditTrailService`. A dynamic `import()` on the hot path buys nothing once a write is required. The slice 2 Q-1 (b) boundary was about keeping an **unwired** module out of the graph, and slice 3 wires it. `next build` must pass (T3a.5, T3b.9) |
| **Q-6** | ✅ **Authorised:** `LITERAL_SCOPE_INCLUSIONS` entries for `chargeResolver.ts` (3a) and `aiChargeRecorder.ts` (3b-ii, if it does not import the catalog), each with its equality pin, as SF-1 in slice 2. The one `console.error` at `scripts/lib/bos-llm-scope.ts:66` is CLI output in `scripts/`, outside CLAUDE.md's `lib/` / `app/` / `components/` scope for the logging rule. It stays, as in slice 2 |
| **Q-7** | ✅ **Per-suite `jest.mock` of the recorder module, not a global mock. But the criterion is "the suite reaches the write", not "the suite breaks".** A suite that stays green while its real `runAiAction` fires an unmocked RPC is still making an outbound request: to `https://test.supabase.co`, or, because `tests/plugins/jest-setup.ts` uses `process.env.X \|\| stub`, **to the real database** if a developer's shell exports the real URL and key. Every census suite whose action makes ≥ 1 call with valid identities gets the mock. T3b.7 **evidence**: run the census once with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` (fast connection refused) and show that **no** suite emits `bos_ai_charge_write_failed`, or reaches the repository by any other detection Dev prefers. The acceptance is "zero unmocked charge writes across the census", with the list in §4.2 |
| **Q-8** | ✅ **Charges `minimise` (`user_id` nullable, `ON DELETE SET NULL`); totals default `delete` (`ON DELETE CASCADE`).** Conditions: `user_id` appears in **neither** kind CHECK (otherwise `SET NULL` violates the CHECK and deleting the auth user fails); the RPC still refuses a NULL `p_user_id`; and C7's rebuild query filters `user_id IS NOT NULL`, since detached rows have no totals row |
| **Q-9** | ✅ **Ruled technically: column-level SELECT for `authenticated`, so no owner can read our cost through the API. No user question is needed.** FR-28 already decides the business side ("no owner-facing surface shows tokens or dollars"), and PostgREST with an owner JWT is an owner-reachable surface. Grant `authenticated` SELECT on an explicit column list: on the charges table, every column **except `cost_usd` and `is_fallback_priced`**; on the totals table, every column **except `cost_usd_total` and `fallback_priced_count`**. **No table-level SELECT for `authenticated`**: a table-level grant would override the column list. Owner-SELECT RLS stays as SA-S8 required. This is the first column-level grant in `supabase/migrations/`, and SA authorises it here (CLAUDE.md rule 7). Two consequences, both acceptable: an owner-session `select=*` returns 42501, because owners must name columns, and nothing reads with an owner session before slices 6 and 7, which read through the server-side repository anyway. A column added later is hidden from owners by default, which is the safe direction. Checker C2 changes accordingly (C-4) |
| **Q-10** | ✅ **No circuit breaker in slice 3.** It trades lost charges for latency before slice 4 has measured either. Condition (SF-4): R-3 states the **cumulative** worst case for loops, not "+1.5 s" |
| **Q-11** | ✅ **1,500 ms, no retry inside the budget.** `AbortController` + `.abortSignal()` on the RPC builder is correct. Write the budget helper **locally in the recorder**: do not export or refactor `withReadBudget` out of `modelSettings.ts`, which is out of scope. Two small copies of a 15-line shape are acceptable. If a third appears, extract one with SA review |
| **Q-12** | ✅ **`business_os_ai_charges`, `business_os_ai_charge_totals`, `business_os_record_ai_charge`, `business_os_ai_period_start`: named, and all live-verified free.** ✅ **One table with a `kind` column** for adjustments, not a sibling table. The diary, the totals rebuild and the leak check read one table (SA-S5, SQ-15). Slice 4 must derive an adjustment's `user_id` **server-side from the adjusted row**, never from a caller (recorded for slice 4's tenant-isolation review) |

### Findings

#### Conditions (must be met in the named part; verified at its code review)

| # | Part | Condition |
|---|---|---|
| **C-1** | 3b-i | **The write probe is mandatory, not optional, and runs under the real roles.** No branch DB exists and Jest cannot execute PL/pgSQL, so the probe is the **only** execution of `business_os_record_ai_charge` before production traffic hits it. Inside one `BEGIN; … ROLLBACK;` on PROD, on the user's own account: **(a)** `SET LOCAL ROLE service_role;` first, because the SQL editor's `postgres` role would pass even with a missing GRANT. Then call twice with one action id → `recorded` true, then false. The totals row carries one charge. Two ids in one period → the totals sum both. **(b)** Still as `service_role`, `UPDATE`, `DELETE` and `TRUNCATE` of the charges table each fail 42501. **(c)** As `authenticated`: `EXECUTE` on both functions fails 42501, and `SELECT cost_usd` fails 42501. **(d)** `ROLLBACK`, then C7 still reports both tables empty. §6.3 and §6.4 step 4 are rewritten to say "mandatory", and 3b-ii does not start until the probe's output is pasted into §14 or §15 |
| **C-2** | 3b-i | **Avoid the PL/pgSQL OUT-parameter / column name clash.** A `RETURNS TABLE (recorded boolean, period_start timestamptz, anchor_source text)` makes `period_start` a PL/pgSQL variable, so the totals upsert's `ON CONFLICT (user_id, period_start)` and the insert's column list raise `42702 column reference "period_start" is ambiguous` **on the first call**. Every action would then log `bos_ai_charge_write_failed` and nothing would be charged. Name the OUT columns distinctly (`out_recorded`, `out_period_start`, `out_anchor_source`, mapped in the repository), or declare `#variable_conflict use_column`. The migration test pins the chosen form. C-1 is what would catch it if this were missed |
| **C-3** | 3b-i | **State the totals semantics now, and make them a constraint.** `credits_total` = the sum of `credits` over **all** rows of the account and period (charges + adjustments). `credits_owner`, `credits_scheduled` and `credits_external` = charge rows by `triggered_by`. `credits_adjustment` = adjustment rows. Add `CHECK (credits_total = credits_owner + credits_scheduled + credits_external + credits_adjustment)` on the totals table, so a drifted upsert fails loudly instead of feeding slice 9 a wrong balance. C7's rebuild query computes every column, not only the total |
| **C-4** | 3b-i | **Checker C2 follows Q-9:** `authenticated` has **no** table-level `r` on either table, and `has_column_privilege('authenticated', …, 'SELECT')` is true for exactly the granted columns and false for `cost_usd`, `is_fallback_priced`, `cost_usd_total` and `fallback_priced_count`. The migration test pins the column lists and forbids `GRANT SELECT ON TABLE … TO authenticated` |

#### Should-fix

| # | Part | Finding |
|---|---|---|
| **SF-1** | 3b-i | **`kind` CHECKs and FK behaviour:** the charge-kind CHECK must not name `user_id` (Q-8), and the self-FK `adjusts_action_id → business_os_ai_charges(action_id)` needs `action_id` to be UNIQUE (not a partial index), which it is. C4 in the checker names both CHECKs, the self-FK and the `kind IN ('charge','adjustment')` domain check |
| **SF-2** | 3b-i | **The migration date `20261013` is taken on `main`:** `origin/main` (`aa9d75e9`) already has `supabase/migrations/20261013_business_os_invite_existing_account.sql`. Use the next free date at T3b.1 (≥ `20261014`), and rename the rollback, checker, test and §6 references with it. R-11 anticipated this; it is now a fact |
| **SF-3** | 3b-ii | **Q-7's criterion is "reaches the write", with evidence** (see Q-7). Also list any census suite that uses `jest.useFakeTimers()` (4 of the 33 AuditTrail-mocking suites do). An unmocked write under fake timers relies on real I/O to settle, and the budget timer never fires |
| **SF-4** | 3b-ii | **R-3 understates the worst case for loops.** `insight-detect` (`maxDuration = 300`) runs one `runAiAction` per business **sequentially** (`route.ts:295`, `:372`). During a Supabase slowdown, the worst case is **businesses × 1.5 s**, not 1.5 s. The same holds for any site that nests actions in a loop. T3b.0 records, per wrapped route, its `maxDuration`, its maximum action count per invocation, and the headroom at today's count. It flags any route whose headroom at 10× today's count is under the cumulative budget. That flag is Q-10's trigger for revisiting the circuit breaker, not a slice 3 build |
| **SF-5** | 3b-i / 3b-ii | **Charging start and the shared database.** The migration's `min(created_at)` proof only holds if nothing writes before the stated start. Until environments are separated, a local `npm run dev` or a Vercel preview of the 3b-ii branch uses the production database, and after 3b-i is applied it would write real rows for whoever uses it. §6.4 records **two** timestamps: the migration apply time (3b-i) and the production go-live of 3b-ii (the stated charging start, FR-34). It states that rows between the two are developer or preview traffic on the developers' own accounts. The AC-26 check becomes "no row before the apply time, and every row before the go-live is identified" |
| **SF-6** | 3b-ii | **Document the mode ruling (Q-4)** in `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` § The mode flag: metering records in every mode, because it measures and does not decide. Do **not** edit `mode.ts`. Flag the stale CLAUDE.md row to TL (not Dev's or SA's to edit) |
| **SF-7** | 3b-ii | **Update the `bos-llm-call-standards` skill, Standard 6.** It currently says the only write in `runAiAction` is the never-awaited audit entry, and "no ledger read-back". After 3b-ii there is a second output: the charge, **awaited, budgeted at `BOS_AI_CHARGE_WRITE_BUDGET_MS`, never throws**, built from the same call list. It is the only sanctioned awaited write in `runAiAction`. The skill is the source of truth reviewers use, so it must not describe a function that no longer exists. One short paragraph plus a checklist line |
| **SF-8** | 3a | **Coordinate `schema: 2` with the in-flight admin AI activity work.** The main checkout is on `docs/ai-activity-b0-workplan` (slice B0 workplan for the admin AI activity view). SA found no production reader of `details.schema` or of a closed `details` key set. Before 3a merges, TL confirms the B0 workplan does not assume `schema: 1` or "one audit entry per grouping id", which was already untrue for onboarding and becomes explicit with SA-B1 |

#### Notes

- **N-1** Tenant isolation (`tenant-isolation-guard`): the guard applies (service role), but **no caller-supplied id selects or mutates a row**. `action_id` is minted in-process. `user_id` comes only from `runAiAction`'s server-derived account: the session through `setAccount` in chat-v4, the iterated business in the crons, the DB-resolved site owner for the external lead reply (bos-llm Standard 2). `group_id` can be client-influenced (the chat-v4 header, SA-B1), but it is **stored only**: it is never a conflict target, key or ownership subject. No trigger, no `jsonb` spread, `kind` hard-coded, and the totals conflict target keyed on the server-derived `user_id`. §7.3 is correct. An FK violation (a UUID-valid account that is not an auth user) surfaces as `db_error`, which is the desired behaviour.
- **N-2** §1's "A plan row can be missing — a diagnostic RPC exists": the RPC is **not callable live** (PGRST202). Do not cite it in the runbook. Whether `20261010` should be applied belongs to the entitlements owner, not to this slice.
- **N-3** An action with invalid identities now logs two `error`s: the existing "AI audit entry not written" and the new `bos_ai_charge_not_written`. Accepted. They are two records failing for one defect, and FR-16 wants the uncharged action countable by its own event name.
- **N-4** `priceActionForCharge` is synchronous over in-code tables, so pricing adds no I/O inside the budget. Its lazy `buildRates()` can throw on an empty table. That is a defect, not a record, and NI-1's "resolver throws" case covers it.
- **N-5** `new-repository` checklist: the RPC-only, insert-only shape is a documented variation (no `.eq('user_id')` read, because there is no read; the RPC scopes by `p_user_id`). Put the record and result types in `lib/repositories/types.ts`, or state in the header why they sit in the repository file (the shadow-repository precedent), and export both from `index.ts`.
- **N-6** Groq `cost = 0` (S2 N-1, R-9) is correctly carried. Business OS is OpenAI-only today (`ALLOWED_PROVIDERS_LAYER2`).

### Optimisation suggestions (non-blocking)

- Owner policies: `USING ((select auth.uid()) = user_id)` rather than `auth.uid() = user_id`, so Postgres evaluates it once per statement, not per row (Supabase's RLS advisor rule). The checker's C3 matches either form.
- The period function could be `IMMUTABLE` once it is pure `timestamp` arithmetic. `STABLE` is also correct, and nothing depends on the difference.
- `bos_ai_charge_recorded` at `debug`: agreed. Slice 4's report, not the logs, is the place to count successes.

### Approval

- [x] Workplan approved **with conditions** — **3a proceeds to implementation now.**
- [x] Split ruled: **3a / 3b-i / 3b-ii**. Dev folds the split into §5, §8 and §6.4 (text only) before 3b-i starts.
- [ ] 3b-i: C-1 to C-4, SF-1, SF-2, SF-5 met; migration applied, checker all PASS, **write probe output recorded** → 3b-ii may start.
- [ ] 3b-ii: SF-3, SF-4, SF-5, SF-6, SF-7 met; NI-1 to NI-5 proven; charging start recorded.
- **No business question for the user.** Q-9 is ruled technically under FR-28. Every other question is technical.

---

### SA code review — 3a (2026-09-28)

**Code Review by SA — 2026-09-28**, against worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-3` @ `7faca4f7` + the uncommitted 3a diff (5 tracked files, +145 / −12, no deletion-without-insertion; 6 new files).
**Status:** ✅ **Code Approved** — no blocking findings. One condition is carried to 3b-ii (C-5, the import cycle).

Skills applied: `bos-llm-call-standards`, `tenant-isolation-guard` (the resolver takes no caller-supplied id). `new-api-route` / `new-repository` do not apply (3a adds neither).

#### What was verified

| Check | Result |
|---|---|
| Action id minted once per invocation | ✅ `const actionId = randomUUID()` is the first statement of `runAiAction`, before the scope opens. It is passed to `emitAiAuditEntry` as an argument and is not on `AiActionHandle` (the handle's keys stay `markFailed`, `setAccount`, pinned by a test). A nested action and a second invocation of one group each get their own id (tested) |
| `schema: 2` + `details.actionId`; `entityId` unchanged | ✅ `AiAuditDetails` is `schema: 2` with `actionId: string`; `entityId: spec.groupId` is untouched; the closed key list moved 16 → 17 and gained exactly `actionId`. No production reader of `details.schema` exists (grep of `app/`, `lib/`, `components/`). SF-8 closed by TL: the admin AI activity B0 workplan joins on `entity_id = token_usage.session_id` and names no schema version |
| `resolveActionFailure` changes no outcome | ✅ Old: `signalled → thrown → undefined`, then `buildAiAuditEntry` applied `summary.failure ?? lastAttemptFailure(calls)`. New: `signalled → thrown → lastAttemptFailure(calls)`, then the same `??` (now a no-op on this path, because it would recompute the same value). The same function is applied one frame earlier, so the result is identical for every input. `buildAiAuditEntry` behaves the same for direct callers |
| No call-site change | ✅ The only `runAiAction(` lines in the diff are in `aiActionAudit.test.ts` |
| Credit value v0 (Q-2) | ✅ `config/creditValue.ts` has **no imports at all** (data only; a test forbids value imports). `as const satisfies readonly CreditValueVersion[]`. The header says append-only, that the snapshot guard catches an **accidental** edit only and is not tamper-proof, and that the PR and its SA review are the audit record, which is the Q-2 wording. `creditValue.history.json` equals the array. The guard tests: equality, no edited released entry (with a negative control), versions `0…n` without gaps, finite and > 0, `matrixVersion` monotone and ≤ `TIER_MATRIX.version`, and a date and derivation on every entry |
| `chargeResolver.ts` pure, slice 2 pricing only | ✅ The only price source is `priceActionForCharge(calls)`. The only side effects are the once-per-process `bos_credit_value_active` info (SA-S6) and `validateIdentities`' existing platform-id warning (D-4). No I/O, and no log for an unpriced call (S2 N-4: `bos_llm_call_unpriced` stays the one event) |
| Rounding | ✅ `costUsd = round(raw, 1e10)`; `credits = round(raw / usdPerCredit, 1e6)`, from the **unrounded** cost. Tested: `0.1 + 0.2` → `0.3` USD / `300` credits, and the ~2e-7 embedding → `0.0002` credits |
| No `token_usage` / Pilot-Credit reads | ✅ No import from `lib/repositories/**` or `lib/ai/**` beyond the `UsageCallRecord` type. A source guard asserts that neither new module names `token_usage`, `user_subscriptions`, `credit_transactions` or `billing_events`, and that the resolver never touches `estimatedCostUsd` |
| Not imported by any production file | ✅ `grep` of `lib/`, `app/`, `components/`, `scripts/`: `chargeResolver.ts` is imported only by its test (`bos-llm-scope.ts` names it as a string). `creditValue.ts` and `chargePricing.ts` are imported only by `chargeResolver.ts` |
| Literal scope (Q-6) | ✅ One `LITERAL_SCOPE_INCLUSIONS` entry with a reason. The equality pin is extended to three files, and the "the walk really finds it" assertion is added. `--list` shows it as `included`. The one `console.error` at `scripts/lib/bos-llm-scope.ts:66` stays, per Q-6 |
| `KNOWN_NON_GATE_IMPORTERS` (D-3) | ✅ Correct: `chargeResolver.ts` reads the credit value and resolves no plan. **It merges cleanly with `main`:** `main`'s `aiActionAudit.ts` entry is inserted after the `readPlanBadge` entry, and this branch's is appended at the end of the list, so they are different hunks. Proven with `git merge-tree` of the working tree against `origin/main` `7c21d009`: no conflict |
| `console.*` in touched `lib/` files | ✅ 0 in `aiActionAudit.ts`, `chargeResolver.ts` and `creditValue.ts` |

#### Gates re-run by SA

| Gate | Result |
|---|---|
| `npx jest lib/business-os/llm lib/business-os/entitlements` (branch) | 50 suites, 1,325 tests: **2 failures, both pre-existing**. One is `callParams.boundary.step2 › briefing/daily_narration`. The other is `enforcementPoints › finds every file…`, whose only unaccounted file is `aiActionAudit.ts` (slice 1's `Labels` import), **not** `chargeResolver.ts` |
| The same, plus `scripts/__tests__/check-bos-llm-literals.test.ts`, on the **merge of this working tree with `origin/main` `7c21d009`** (a temporary detached worktree, removed afterwards) | **51 suites, 1,394 tests, all green.** `main` fixes both pre-existing failures (PR #134 and `0620c0f5`), and the two `KNOWN_NON_GATE_IMPORTERS` entries coexist |
| chat-v4 `route.audit.test.ts` and `tokenUsageRepository.contract.test.ts` on **`origin/main` `7c21d009`** (no 3a code) | Both **red on `main` in the same way**: the chat-v4 suite fails to run (unhandled `profile read failed for OWNER-TEXT-MARKER-c1 cancel`), and the contract suite fails its arity pin. Unrelated to 3a, as Dev reported. They match the parked "tokenUsage contract pin red on main" finding |
| `npm run typecheck:bos-llm` | 297 files, 28 errors, **0 new**, passed. It also reports one baseline entry as now fixed (`app/api/onboarding/build/route.ts` TS18047), in a file 3a does not touch. Do **not** run `--update-baseline` in this slice |
| `npm run check:bos-llm-literals` | 49 files, 2 exempt, **0 violations**, passed |

#### Rulings on the deviations

| # | Ruling |
|---|---|
| **D-1** | ✅ Accepted. `fallbackCallCount` sits beside the record, not on it, so the row stays thin (FR-13) and pricing runs once |
| **D-2** | ✅ Accepted. The log belongs with the only reader of the value. `creditValue.ts` staying import-free is the stronger property |
| **D-3** | ✅ Accepted. It merges cleanly (above) |
| **D-4** | ✅ Accepted. One definition of the identity rule is worth reusing an existing once-per-process warning. No new log |
| **D-5** | ✅ Accepted, and better than the plan: checking the unrounded cost catches a `-1e-12` that rounding would have hidden as `-0` |
| **D-6** | ✅ Accepted. The id is minted in-process by `randomUUID()`, so nothing caller-supplied reaches it. The 3b-i RPC refuses NULL, and a UUID column rejects a malformed value |

#### Findings

**Blocking:** none.

**Should-fix:** none for 3a.

**Condition carried to 3b-ii**

| # | Part | Condition |
|---|---|---|
| **C-5** | 3b-ii | **No value-level import cycle between `aiActionAudit.ts` and the charge modules.** Today `chargeResolver.ts` imports two **values** (`AI_ACTION_DECLARATIONS`, `validateIdentities`) from `aiActionAudit.ts`. When 3b-ii makes `aiActionAudit.ts` import the recorder (→ `chargeResolver.ts`), that becomes a runtime cycle. It is safe as written, because every cross-module value is read at call time. But it is fragile. A future module-level read (a derived constant, or a `Map` built from the declarations) would become a TDZ / `undefined` failure that shows up under only one import order, and the per-suite `jest.mock` of the recorder (Q-7) changes that order from suite to suite. **Not required in 3a:** nothing imports the resolver yet, so there is no cycle, and moving code with no consumer is churn. In 3b-ii, break the cycle in one of two ways (Dev's choice). **(a, preferred, smallest):** `buildAiChargeRecord` takes the already-validated identities and the declaration's `isCharged` from its caller (`runAiAction` has both), so `chargeResolver.ts` imports only **types** from `aiActionAudit.ts`. **(b):** move `validateIdentities` and its UUID / platform-account helpers to a small dependency-free module that both import. Either way, add a source guard that `chargeResolver.ts` (and `aiChargeRecorder.ts`) has no non-`type` import from `aiActionAudit`. Showing that it works under `next build` does not by itself meet this condition |

**Notes**

- **N-7** 3b-ii must pass the **same** `failure` value (the one `resolveActionFailure` returned) to both `buildAiAuditEntry` and `buildAiChargeRecord`. The charge builder has no `?? lastAttemptFailure` fallback of its own, so a caller that passed it `undefined` would record `succeeded` where the audit entry says `failed`. The agreement suite in `chargeResolver.test.ts` proves this for the helper. 3b-ii's wiring test should prove it through `runAiAction`.
- **N-8** The comment on `roundTo` says "half away from zero", but `Math.round` rounds half **up** (towards +∞). The two agree for every value that can reach it, because rule 4 refuses negatives first, so this is wording only. Fix it when the file is next touched.
- **N-9** `buildAiAuditEntry` keeps `summary.failure ?? lastAttemptFailure(calls)`. On the `runAiAction` path it now recomputes a value that is already decided. This is harmless and deliberately kept for direct callers; no change is asked.

### Optimisation suggestions (3a, non-blocking)

- None beyond N-8.

### Code Approved for QA: **Yes.**

QA's scope for 3a: the new suites (`chargeResolver.test.ts`, `creditValue.test.ts`, and the eight new `aiActionAudit.test.ts` cases), the related audit-shape suites Dev listed in §5.1.1, and the two pre-existing failures turning green once the branch takes `main`. After deploy (§6.4 step 0): a new AI entry in `audit_trail` carries `details.schema = 2` and a `details.actionId` distinct from `entity_id`. Commit only after the user has reviewed the diff.

---

## 14. QA Testing Report

### QA report — 3a (2026-09-28)

**QA — 2026-09-28**
**Test mode:** full (3a scope only; 3b-i / 3b-ii are not built)
**Strategy used:** A (Jest unit: new suites, the resolver on representative inputs, the credit value guard) + B-style regression (the suites that run the real `runAiAction` or assert the audit shape) + C (a temporary differential test running the real `runAiAction` against a byte copy of the pre-3a module, deleted afterwards). No DB access: 3a has none.
**Focus:** pipeline (Business OS LLM), schema (audit `details`), security (identity refusal), performance n/a
**Skipped:** D (no UI in 3a); E (not needed; everything was runnable)
**Input source:** TL prompt (test list 1–7) + §7 test plan + SA "Code Approved for QA" scope

Worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-3` @ `7faca4f7` + the uncommitted 3a diff (5 tracked files +145 / −12, 6 new files). No code file was changed by QA: sha256 of all 10 code/test files taken before and after the run are **identical**.

#### Commands and numbers

| # | Check | Result |
|---|---|---|
| 1a | `npx jest lib/business-os/llm lib/business-os/entitlements app/admin/audit-trail scripts/__tests__/check-bos-llm-literals.test.ts` (branch) | 55 suites (53 pass, 2 fail); **1,421 tests (1,419 pass, 2 fail)**. The 2 failures are the known pre-existing ones: `callParams.boundary.step2 › briefing/daily_narration` and `enforcementPoints › finds every file…`. QA confirmed the latter's only unaccounted file is `lib/business-os/llm/aiActionAudit.ts` (slice 1's `Labels` import), **not** `chargeResolver.ts` |
| 1b | `npm run typecheck:bos-llm` | 297 files, 28 errors, **0 new**, passed (it also reports one fixed baseline entry, `app/api/onboarding/build/route.ts` TS18047, a file 3a does not touch; `--update-baseline` not run) |
| 1c | `npm run check:bos-llm-literals -- --list` | `included lib/business-os/llm/chargeResolver.ts` present; 49 files in scope, 2 exempt, 3 included by name |
| 1d | `next build` (`NODE_OPTIONS=--max-old-space-size=6144` + the CI placeholder env from `.github/workflows/build.yml`) | **Exit 0**: "Compiled successfully", 307/307 static pages. 78 `DYNAMIC_SERVER_USAGE` lines, the usual static-generation probes of cookie-reading routes, unrelated to 3a |
| 2 | Merged with main: temporary detached worktree at **`origin/main` `571f48cc`** (main has moved past `7c21d009`: PRs #135 and #136), `git apply --3way` of the tracked diff + the 6 new files copied, node_modules junctioned | **Patch applied cleanly to all 5 files, 0 conflict markers.** Same Jest set: **55/55 suites, 1,423/1,423 tests green**. Both pre-existing failures pass there, and the two `KNOWN_NON_GATE_IMPORTERS` entries coexist. Worktree removed (junction deleted first; the shared node_modules is intact) |
| 3 | Temporary behaviour test (real `runAiAction`, real `BaseAIProvider.callWithTracking`, mocked `AuditTrail.log`/logger/price loader) | **35/35 pass**; file deleted afterwards (details below) |
| 4 | Resolver on representative inputs (same temporary file) | All pass (details below) |
| 5 | Credit value guard (mutation test) | Guard fires on all three edits; both files restored **byte-identical** (sha256 `589ff4f2…48ec` json, `9e6b54c9…8e625` ts, equal to pre-run); suite back to 10/10 |
| 6 | Unused in production | grep of `lib app components scripts pages hooks types middleware.ts` (non-test): the only importers of `config/creditValue` and `chargePricing` are `chargeResolver.ts`; **nothing imports `chargeResolver.ts`**. `scripts/lib/bos-llm-scope.ts` names it as a string only. Extra evidence: the `next build` output (`.next/server`, `.next/static`) contains no `bos_credit_value_active` / `BosChargeResolver` string, while `aiActionAudit`'s own log text is present (positive control) |
| 7 | Regression: Dev's 66-suite set (BriefingStore audit attribution, lead-reply attribution, chat-v4 / insight-detect / onboarding build `route.audit`, onboarding chat + media `route.attribution`, website `aiAudit.routes`, `lib/business-os/usage`, `lib/audit`, `app/admin`, `lib/admin/health`, health-summary, admin audit-trail route, `app/api/audit`, `AuditTrailRepository`, `adminReadMethods.guard`, `components/test-business-os/llm-usage`, `lib/business-os/bizql/mutate`) | 66 suites: **64 pass, 2 fail**; 1,358 tests: 1,357 pass, 1 fail. The two red suites are chat-v4 `route.audit.test.ts` (suite fails to run: unhandled `profile read failed for OWNER-TEXT-MARKER-c1 cancel`) and `tokenUsageRepository.contract.test.ts` (arity pin: extra `summariseFeatureAllAccountsInWindow`). **On pristine `origin/main` `571f48cc` without 3a, both fail with byte-identical output** (diff of the normalised failure lines: IDENTICAL). Pre-existing, not 3a. `business-os-invites` page flake did not recur |

#### Evidence — behaviour (item 3, real `runAiAction`)

| Assertion | Result |
|---|---|
| 50 sequential invocations with one group → 50 distinct ids, each a v4 UUID, `details.schema === 2`, `entityId === groupId`, `actionId !== groupId` | ✅ |
| 4 concurrent invocations + a nested action → all ids distinct | ✅ |
| Handle keys are exactly `['markFailed', 'setAccount']`; no own property name contains "id" | ✅ |
| **Differential vs the pre-3a module (byte copy of `HEAD:aiActionAudit.ts`)**, 15 scenarios, comparing the returned value (identity), the thrown error (identity for caller errors; class + message for provider errors made fresh per run), and the whole audit entry with only `schema`/`actionId` removed: success (string), success (object by identity), signalled failure, thrown with code, thrown without code (`TypeError`), failed last attempt, repaired failure, signalled beats failed last attempt, thrown beats failed last attempt, failed call rethrown by the action, no calls, no calls + throw, account set late through the handle, platform account (no entry), scheduled insight action | ✅ **15/15 identical** |
| Sanity control: the old module writes `schema: 1` without `actionId`; the new one writes `schema: 2` with exactly one more key; the old module's failed-last-attempt entry is `BUSINESS_AI_ACTION_FAILED` / `rate_limit_exceeded` (so the differential compared real entries, not two `undefined`s) | ✅ |
| A thrown caller error is rethrown by identity (`rejects.toBe`) | ✅ |

#### Evidence — resolver (item 4)

| Input | Result |
|---|---|
| Credit value | one history entry; `currentCreditValue()` = version 0, `usdPerCredit` 0.001, `provisional`, `matrixVersion` 1 ✅ |
| gpt-4o chat action, 1,000 in / 500 out, cost from the real `calculateCostSync` (0.0075 USD) | exact record `{ actionId, accountId: OWNER, groupId, actionType: 'chat_turn', trigger: 'owner', outcome: 'succeeded', credits: 7.5, costUsd: 0.0075, creditValueVersion: 0, isFallbackPriced: false }` + `fallbackCallCount: 0`; no extra keys ✅ |
| ~2e-7 USD embedding | `costUsd` 2e-7, **credits 0.0002**, not fallback ✅ |
| Unpriced model (`status: 'unpriced'`) beside a priced call | `isFallbackPriced: true`, `fallbackCallCount: 1`, cost above the priced share; **no `error` log and no `bos_llm_call_unpriced` from the resolver** ✅ |
| Real `runAiAction` with an unpriced call, then the builder on the same call | `bos_llm_call_unpriced` logged **exactly once**; building the charge adds none ✅ |
| No calls | `{ skipped: 'no_calls' }` ✅ |
| Non-UUID group, non-UUID account, undefined account, all-zero account, platform account | each `{ skipped: 'invalid_identity' }` ✅ |
| Failed action (a paid call + a failed call, `failure` set) | `outcome: 'failed'`, charged 0.0075 USD / 7.5 credits (what it spent) ✅ |
| Scheduled insight action | `trigger: 'scheduled'`, account kept ✅ |
| Rounding: raw cost 4.99999e-10 | `costUsd` **5e-10** (10 dp) but `credits` **0**: from the unrounded cost (the rounded cost would have given 1e-6), which proves credits are not derived from the rounded cost ✅ |
| Rounding: 0.12345678901234 | `costUsd` 0.123456789 (10 dp), `credits` 123.456789 (6 dp) ✅; 0.1 + 0.2 → 0.3 USD / 300 credits ✅ |
| `bos_credit_value_active` across 5 resolutions | one `info`, `{ version: 0, usdPerCredit: 0.001, status: 'provisional' }` ✅ |

#### Evidence — credit value guard (item 5)

| Mutation | `creditValue.test.ts` |
|---|---|
| A: `creditValue.history.json` `usdPerCredit` 0.001 → 0.002 | 3 failed (snapshot equality, "no released entry edited", negative control) |
| B: `creditValue.ts` v0 `usdPerCredit` 0.001 → 0.002 | 3 failed (snapshot equality, "no released entry edited", "version 0 is ~$0.001") |
| C: `creditValue.ts` v0 `derivation` wording only | 2 failed (snapshot equality, "no released entry edited") |
| Restored | hashes equal to pre-run; 10/10 pass |

#### Test Coverage

| Acceptance criterion (3a share) | Tested? | Result | Notes |
|---|---|---|---|
| SA-B1: one action id per invocation, on the audit entry (`schema: 2`), `entityId` unchanged, not on the handle | ✅ | Pass | 50 sequential + concurrent + nested; handle keys |
| No behaviour change to actions or audit outcome (SQ-11 spirit for 3a) | ✅ | Pass | 15-scenario differential against the pre-3a module |
| FR-2: one cost → credits conversion | ✅ | Pass | Only `chargeResolver.ts` converts; unwired |
| FR-3 / AC-2: provisional value v0, versioned, append-only | ✅ | Pass | v0 at $0.001; mutation test A–C |
| FR-6 / SQ-8 / AC-5 (storage): fractional, 10 dp / 6 dp from unrounded | ✅ | Pass | 2e-7 → 0.0002; 4.99999e-10 discriminating case |
| FR-7 / AC-6: no calls → nothing charged | ✅ | Pass | `no_calls` |
| FR-8 / AC-7: failed action charged what it spent | ✅ | Pass | |
| FR-5 / AC-10: several calls → one record | ✅ | Pass | Dev's suite (five calls) + QA's two-call cases |
| FR-10: trigger mapping | ✅ | Pass | `user` → `owner`, `scheduled` |
| FR-11 / AC-11 / AC-30: never from `token_usage` / Pilot-Credit tables | ✅ | Pass | Dev's source guard green; resolver imports only the `UsageCallRecord` type from `lib/ai` |
| FR-12b: fallback flag | ✅ | Pass | unpriced → flagged, counted, no second error log |
| Standard 2 / RC-3: invalid or platform identity refused | ✅ | Pass | 5 identity cases |
| Unused in production in 3a | ✅ | Pass | grep + absent from the build output |
| FR-13 (thin row), FR-9, AC-8, AC-12, AC-26, FR-14–FR-18 (write, totals, idempotency, non-interference) | ⚠️ | n/a | 3b-i / 3b-ii; the record shape (10 fields) is verified here |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. The only runtime addition is one `randomUUID()` per action.

**Edge cases / notes:**
1. **The branch must take `main` before merge.** At its base `7faca4f7` it carries the two pre-existing reds (`daily_narration` snapshot, `enforcementPoints` for `aiActionAudit.ts`). Both are green once it takes `main` (proven on `571f48cc`). This branch intentionally does not re-add main's `aiActionAudit.ts` entry.
2. **Two suites are red on `main` without 3a** (chat-v4 `route.audit.test.ts`, `tokenUsageRepository.contract.test.ts`). They are byte-identical with and without 3a, which matches the parked "tokenUsage contract pin red on main" finding. Not 3a's to fix.
3. SA N-8 (`roundTo` comment says "half away from zero"; `Math.round` rounds half up) is still open. It is wording only, since negatives are refused first.
4. QA did not exercise the legitimate append path (adding version 1 to both files). Slice 5 will do that, and Dev's suite asserts the version sequence has no gaps.

#### Final Status
- [x] All 3a acceptance criteria pass: ready for the user's diff review, then commit (after taking `main`)
- [ ] Issues found: Dev must address before commit

**Verdict: PASS WITH NOTES** (no bugs; the notes are pre-existing reds that `main` already fixes or that are red on `main` itself, plus SA's N-8 wording).

---

## 15. Commit Info

*(RM to populate. Dev does not commit; changes stay uncommitted until the user has reviewed the diff. RM also records here the **charging start** — the UTC time the 3b production deployment went live — per §6.4 step 6.)*

---

## 16. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | Slice 3 workplan from the requirement's §12 slice 3 and SQ-1, SQ-2, SQ-3, SQ-5, SQ-7, SQ-8, SQ-11, SQ-15, SA-B1, SA-S1, SA-S8. Split into **3a** (action id + `schema: 2`, credit value v0 as an append-only history, the one pure resolver and record builder; no DB; ≈ 2 days) and **3b** (charge + totals tables with the adjustment kind decided now, a `SECURITY INVOKER` RPC that computes the anniversary period in UTC and writes both in one transaction, repository, a 1.5 s budgeted never-throwing awaited write in `runAiAction`, purge / ownership / deletion registration; ≈ 4.5 days), total ≈ 6.5 days. Migration SQL plan, rollback, read-only checker and PROD apply runbook with the charging start included. `period_anchor` **unverified** against live (no `.env.local` in this worktree). Twelve questions for SA. Slice 2 SA note N-1 (Groq cost 0) recorded. No `console.*` debt in any file to be modified except the pre-existing one in `scripts/lib/bos-llm-scope.ts` |
| 2026-09-28 | SA workplan review | **Approved with conditions; 3a may start now.** 3b split now into **3b-i** (migration, checker, repository, lifecycle registration, applied to PROD with nothing writing) and **3b-ii** (recorder, wiring, NI proofs, charging start). Q-1 to Q-12 ruled. Q-9 was ruled technically as a column-level owner SELECT that omits cost and fallback columns, so there is no business question. Conditions C-1 to C-4: the write probe is mandatory and runs under `service_role` / `authenticated`; the PL/pgSQL OUT-name clash on `period_start`; the totals invariant as a CHECK; checker C2 for column grants. Should-fix SF-1 to SF-8, including the migration date `20261013` already taken on `main`, the cumulative budget in the insight cron loop, and a skill Standard 6 update. Live schema measured read-only: `period_anchor` is live (timestamptz, NOT NULL, default now()); every proposed table and RPC name is free; the `business_os_tenants_missing_plan_row` RPC is not callable live. `BOS_ENTITLEMENTS_MODE`: the code treats unset as `off`, production is `shadow` per the entitlements doc, and CLAUDE.md is stale; this does not matter for Q-4, because recording is mode-independent |
| 2026-09-28 | SA split folded in; migration date | §5.2 rewritten as 3b-i (§5.2.1) and 3b-ii (§5.2.2) per SA's ruling, with C-1 to C-4 and SF-1 to SF-7 placed on their tasks; T3b.0 (a) marked done by SA. §8 estimate re-cut per part (3b-i ≈ 2–2.5 d, 3b-ii ≈ 2 d) and the tripwire moved to "either part > 3 days". §6.4 runbook gains a Part column (steps 1–4 = 3b-i, with the write probe **mandatory**; 5–8 = 3b-ii) and SF-5's two timestamps. Migration, rollback and §4.2 references moved from `20261013` (taken on `main`) to **`20261014`** (SF-2) |
| 2026-09-28 | 3a implemented (Dev) | `runAiAction` mints one action id per invocation; the audit entry carries `details.actionId` with `schema: 2`; `entityId` unchanged; `resolveActionFailure` exported; no call-site change. Credit value v0 (provisional, $0.001 per credit, paired to matrix v1) as an append-only history in `config/creditValue.ts` with the committed snapshot `creditValue.history.json` and its guard. The pure, unwired `chargeResolver.ts` (`resolveActionCharge`, `toChargeTrigger`, `buildAiChargeRecord`) on slice 2's pricing. `LITERAL_SCOPE_INCLUSIONS` entry for `chargeResolver.ts` with its pin; a `KNOWN_NON_GATE_IMPORTERS` entry in `enforcementPoints.test.ts`. Gates and deviations D-1 to D-6 in §5.1.1. Uncommitted |
| 2026-09-28 | SA code review — 3a | **Code Approved; approved for QA.** No blocking or should-fix findings. Verified: one action id per invocation, not on the handle; `schema: 2` + `details.actionId`, with `entityId` still the grouping id; the `resolveActionFailure` refactor changes no outcome; no call-site change; credit value v0 data-only with the Q-2 header; `chargeResolver.ts` pure on slice 2 pricing, with correct rounding, and unwired. D-1 to D-6 accepted. D-3 merges cleanly with `main` (proven with `git merge-tree`); on the merge with `origin/main` `7c21d009` the llm, entitlements and literal-gate suites are 51/51 green. chat-v4 `route.audit` and the tokenUsage contract pin are red on `main` without 3a. New condition **C-5** for 3b-ii: break the `aiActionAudit` ↔ `chargeResolver` value-import cycle (preferred: pass the validated identities and `isCharged` in, and keep type-only imports), with a source guard. Notes N-7 to N-9 |
| 2026-09-28 | QA report — 3a | **PASS WITH NOTES.** Branch Jest set 1,419/1,421 (the 2 known pre-existing reds); merged onto `origin/main` `571f48cc`: clean apply, 55/55 suites, 1,423/1,423 green. `typecheck:bos-llm` 0 new; literal list shows `chargeResolver.ts` included; `next build` exit 0 (307 pages). A temporary differential test ran the real `runAiAction` against the pre-3a module: 15/15 scenarios gave identical results, errors and audit entries; ids are distinct v4 UUIDs (sequential, concurrent, nested) and not on the handle. Resolver checked on representative inputs (gpt-4o 7.5 credits, embedding 0.0002, fallback flagged with no second error log, invalid identities refused, failed action charged, rounding from the unrounded cost). The credit value guard caught three mutations, and the files were restored byte-identical. Unwired, shown by grep and by the build output. Regression 66 suites: the 2 reds (chat-v4 `route.audit`, tokenUsage contract) are identical on `main` without 3a. No bugs. No code file changed by QA (hashes) |
