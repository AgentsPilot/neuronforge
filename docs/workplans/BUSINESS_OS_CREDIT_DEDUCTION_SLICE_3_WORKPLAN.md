# Workplan: Business OS Credit Deduction — Slice 3 (Record every charge, silently)

> **Last Updated**: 2026-09-29

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §3 "Reusing what exists", §4 "The three records", §5 "How the balance works", §12 **Slice 3 — Record every charge, silently** (scope, guardrails, FRs / ACs), FR-1 to FR-16, FR-18, FR-34, FR-35, FR-38, the NFRs, and the SA rulings SQ-1, SQ-2, SQ-3, SQ-5, SQ-7, SQ-8, SQ-11, SQ-15, SA-B1, SA-S1, SA-S8 plus the SA follow-up (2026-09-28).
**Builds on:** [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_2_WORKPLAN.md). Slice 2 shipped the pure, unwired `priceActionForCharge` (`chargePricing.ts`) and `classifyCallForCharge` / `reportUnpricedCalls` (`chargeClassification.ts`); slice 3 wires them. Its verified facts, its SA conditions (C-1 to C-3) and its code-review notes (N-1 to N-6) are reused and cited as "S2 C-3", "S2 N-4" and so on.
**Branch:** `feature/business-os-credit-deduction-slice-3` (worktree `neuronforge-llm-deduction`), off `origin/main` at `7faca4f7` (after slice 1's PR #130 and slice 2's PR #132). The branch was created before this workplan, not by Dev.
**Date:** 2026-09-28
**Status:** 3a QA Passed (PR #137). **Code Complete (3b-i)** — on `feature/business-os-credit-deduction-slice-3b-i` (stacked on 3a), uncommitted, awaiting SA code review; the migration is **not applied** (the user applies it to PROD by hand, §6.4.1). 3b-ii not started. **2026-09-29: 3b-i updated for the user's decision that the ledger is not AI-specific** (§3.1, §5.2.1.2): objects renamed to `business_os_credit_*` and a `service` column added; still uncommitted and not applied.

## Overview

Slice 3 is the moment Business OS starts **counting** in credits. After it ships, every completed Business OS AI action writes one confirmed, thin charge row, and each account has a running total for its billing period. Nothing is refused, nothing the owner sees changes, and `balance.ts` still answers "yes" to everything.

**The plan is split in two, because the honest estimate is ≈ 6.5 days** (§8), above the user's "a few days":

| Part | What it delivers | DB? | Estimate |
|---|---|---|---|
| **3a — Action id, credit value v0, pure resolver** | Every `runAiAction` invocation mints its own **action id**, and the audit entry carries it (`schema: 2`). The **provisional credit value, version 0** (≈ $0.001) lives in the entitlements config, versioned and append-only. **One pure resolver** turns an action's calls into `{ cost, credits, version, fallback flag }` using slice 2's pricing, and a pure builder produces the exact charge record 3b will write. | **No** | ≈ 2 days |
| **3b — The tables, the RPC, the repository and the wiring** | A migration with the thin **charge table** and the **per-period totals table**, one RPC that writes both in one transaction, a repository, the purge / deletion registration, and a direct, awaited, time-boxed, never-throwing write at the end of `runAiAction`. Charging starts at the stated moment (§6.4). | **Yes** (applied to PROD by hand) | ≈ 4.5 days |

**The ledger is not AI-specific (user decision 2026-09-29).** Eventually every chargeable action — AI or not, for example a notification email to a client — has a measured cost converted to credits, all from **one credit pool** per account, following the same procedure as AI with few exceptions. Nothing non-AI is built now; the ledger only must not block it. So the objects are named `business_os_credit_*`, each charge row names its `service` (slice 3 records only `'ai'`), and the totals stay one row per account and period.

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

> **Renamed 2026-09-29 (user decision: the ledger is not AI-specific).** SA approved `business_os_ai_charges`, `business_os_ai_charge_totals`, `business_os_record_ai_charge`, `business_os_ai_period_start` and `BusinessOsAiChargeRepository` (Q-12). The migration was applied nowhere, so they were renamed freely to the names below. The recorder keeps its AI name: it is the AI service's recorder, and a later service adds its own.

| Object | Proposed name | Why |
|---|---|---|
| Charge table | `business_os_credit_charges` | The one credit ledger for every chargeable service, not only AI (user decision 2026-09-29). Business OS-namespaced (SA-S8), matches `business_os_account_plans` / `business_os_entitlement_*`; the requirement's working name `business_ai_charges` lacks the `_os_` namespace every entitlements table carries |
| Totals table | `business_os_credit_totals` | One row per `(user_id, period_start)` (SQ-1): **one credit pool** across every service, never split by service |
| Write RPC | `business_os_record_credit_charge(...)` | Verb-first, matches `business_os_record_shadow_events` |
| Period function | `business_os_credit_period_start(anchor, at)` | The one definition of an anniversary period (T-6) |
| Repository | `lib/repositories/BusinessOsCreditChargeRepository.ts` | `new-repository` skill |
| Recorder | `lib/business-os/llm/aiChargeRecorder.ts` | The budgeted, never-throwing write |

### 3.2 The charge row (FR-13, SQ-15) and the adjustment shape decided now

**One table, with a row kind.** A charge row is the thin row; an adjustment (slice 4) is a second kind in the **same** table, so the diary and the totals rebuild read one table (SA-S5, SQ-15) and slice 4 adds rows, not a migration.

| Column | Charge row | Adjustment row (slice 4, shape only) |
|---|---|---|
| `id uuid PK default gen_random_uuid()` | its own id | its own id |
| `kind text` | `'charge'` | `'adjustment'` |
| `action_id uuid UNIQUE` | **required**, from `runAiAction` — the idempotency key (SA-B1, SQ-2) | **NULL** — never reuses an action id (SQ-15) |
| `adjusts_action_id uuid → business_os_credit_charges(action_id)` | NULL | **required** |
| `user_id uuid → auth.users(id)` | the account (server-derived) | the adjusted row's account |
| `created_at timestamptz default now()` | write time | write time |
| `period_start timestamptz NOT NULL` | written at charge time (SQ-15 (1)) | slice 4 decides (the original's, or the period it is made in) |
| `group_id uuid` | **required** for every charge of every service, indexed, **not** unique (SQ-15 (2)). User decision 2026-09-29: every chargeable action belongs to a group, even a group of one (a bulk send is one group with one action id per email) | NULL allowed |
| `credits numeric(18,6)` | ≥ 0 | signed |
| `cost_usd numeric(16,10)` | ≥ 0 | signed |
| `credit_value_version integer ≥ 0` | from 3a | the version the correction is priced at |
| `is_fallback_priced boolean` | slice 2's flag. **AI-specific**: every other service records `false` (a `COMMENT ON COLUMN` says so) | false |
| `service text` | **required**, format-checked like `action_type` (lowercase letters, digits, underscore, 1–64, starting with a letter) — an identifier, **not** an enumerated list, so a new chargeable service needs no migration. Slice 3 records only `'ai'` (the 3b-ii recorder passes it). Owners may SELECT it | **NULL** — inherits the service of the charge it adjusts |
| `action_type text` | **required**, format-checked `^[a-z][a-z0-9_]{0,63}$` (not an enumerated CHECK, so a new `AiActionType` needs no migration) | NULL |
| `triggered_by text` | **required**, `owner` / `scheduled` / `external` (SQ-15 (3)); named `triggered_by` because `trigger` is an SQL keyword | NULL |
| `outcome text` | **required**, `succeeded` / `failed` | NULL |
| `reason_code text` | NULL | **required**, format-checked |

Two `CHECK` constraints make each kind's shape impossible to violate (charge: `action_id`, `group_id`, `service`, `action_type`, `triggered_by`, `outcome` present, `adjusts_action_id` and `reason_code` absent, credits and cost ≥ 0; adjustment: `action_id` and `service` absent, `adjusts_action_id` and `reason_code` present). **No** tokens, models, call names, areas or error codes (FR-13, AC-11).

**Rows are never updated in place, by privilege, not by care:** `service_role` gets `SELECT, INSERT` on the charge table and nothing else (§6.1). `user_id` becomes NULL only through the foreign key's `ON DELETE SET NULL`, which runs as the table owner (the `minimise` verdict, Q-8).

### 3.3 The totals row (SQ-1, FR-18, SQ-5)

`business_os_credit_totals`, PK `(user_id, period_start)`, FK `user_id → auth.users(id) ON DELETE CASCADE`: `credits_total`, `credits_owner`, `credits_scheduled`, `credits_external`, `credits_adjustment` (0 until slice 4), `cost_usd_total`, `charge_count`, `fallback_priced_count`, `updated_at`. **One credit pool:** there is no per-service column or key; a charge of any service moves the same row (user decision 2026-09-29). The per-trigger split is there now so slice 6's "you vs automatic" (FR-25) and slice 12's `external` count need no migration. It is **derived data**: it can always be rebuilt as `SUM(...) GROUP BY user_id, period_start` over the charge rows, using each row's stored `period_start` (NFR Correctness). §6.3 includes the rebuild query as a verify step.

### 3.4 The period (T-6), resolved inside the RPC

The requirement says the period runs from the account's own anchor (T-6), written at charge time. **Proposal (Q-1): compute it in SQL, inside the write RPC, in the same transaction.**

- `business_os_credit_period_start(p_anchor, p_at)`: the latest `anchor + n months ≤ at`, **computed in UTC** (`AT TIME ZONE 'UTC'`, so the session time zone cannot move it), with `n` counted from the anchor rather than chained month to month, so a 31st anchor gives Jan 31 → Feb 28 → Mar 31 (Postgres month arithmetic clamps, as Stripe's billing cycle does). `n` may be negative, so a future anchor still yields a period.
- **Why SQL, not TypeScript:** one round trip instead of two; the anchor and the charge are read and written atomically, so an admin changing the anchor mid-write cannot split a charge; there is no second failure mode ("anchor unreadable → no charge"); and slice 9 reads the current period through the same function. The cost is that Jest cannot execute it — so the checker (§6.3) asserts fixed cases **on production, read-only** (the function is side-effect free), and the migration test pins the UTC wording.
- **Missing plan row (Q-3):** fall back to the calendar month in UTC (`date_trunc('month', now() AT TIME ZONE 'UTC')`), and return `anchor_source = 'calendar_month'` so the recorder logs `warn` `{ event: 'bos_ai_charge_no_plan_row', accountId, actionId }`. The charge is still written; nothing is lost.
- The charge time is the **write** time (`now()` in the database), i.e. the end of the action. An action that straddles a period boundary is charged to the period it finished in.

### 3.5 The write RPC (SQ-1, SQ-2, SA-S8)

`business_os_record_credit_charge(p_action_id uuid, p_user_id uuid, p_group_id uuid, p_service text, p_action_type text, p_triggered_by text, p_outcome text, p_credits numeric, p_cost_usd numeric, p_credit_value_version integer, p_is_fallback_priced boolean) RETURNS TABLE (out_recorded boolean, out_period_start timestamptz, out_anchor_source text)` (OUT names per C-2; the sketch originally used the bare names, which clash with the columns) — `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`:

1. Refuse NULL `p_action_id` / `p_user_id` / `p_group_id` / `p_service` (`RAISE`, `22004`); read `period_anchor` for `p_user_id`; compute `v_period` (§3.4).
2. `INSERT INTO public.business_os_credit_charges (kind, action_id, user_id, period_start, group_id, …) VALUES ('charge', …) ON CONFLICT (action_id) DO NOTHING` — `kind` is **hard-coded** `'charge'`: slice 3's RPC cannot write an adjustment.
3. **Only if a row was inserted**, upsert the totals row: `ON CONFLICT (user_id, period_start) DO UPDATE SET credits_total = t.credits_total + EXCLUDED.credits_total, …` (row-locked, so two concurrent actions of one account never lose an update).
4. Return `recorded = FOUND`, the period and the anchor source.

Idempotent on the action id (SQ-2): a repeat write of the same invocation inserts nothing and moves no total. Two concurrent writes of the same id serialise on the unique index; the second returns `recorded = false`. **No trigger** is created on either table (tenant-isolation-guard Step 4: nothing fires an unscoped write).

### 3.6 The repository

`BusinessOsCreditChargeRepository` (per `new-repository`, adapted to an insert-only ledger — no `update`, no soft delete): one method, `recordCharge(record, { signal })` — the record is 3a's `AiChargeRecord` **plus `service`** (the 3b-ii recorder passes `{ ...record, service: 'ai' }`; `chargeResolver` stays AI-only) — → `RepositoryResult<{ recorded: boolean; periodStart: string; anchorSource: 'plan' | 'calendar_month' }>`. It builds the RPC arguments **field by field** from the typed record (tenant-isolation-guard Step 3 — never a spread), passes the abort signal, and returns `{ data, error }`, never throwing. Header documents the intentional service-role use (the table has no client write privilege at all). No read methods in slice 3: nothing reads the ledger until slice 4 / 6 / 9, and each adds its own `.eq('user_id', …)`-scoped read then. Exported from `lib/repositories/index.ts`.

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
| `supabase/migrations/20261015_business_os_credit_charges.sql` | create | Tables, function, RPC, grants, RLS (§6.1). `20261015`: `20261014` was free at `7c21d009` (SF-2) but was taken on `main` by `20261014_business_os_invite_signup.sql` (PR #139) before this slice was committed, so the file moved to `20261015` at commit time (RM guard, 2026-09-29) | — |
| `supabase/SQL Scripts/20261015_business_os_credit_charges_rollback.sql` | create | §6.2 | — |
| `scripts/check-bos-credit-charges-migration.sql` | create | Read-only verifier (§6.3) | — |
| `scripts/probe-bos-credit-charges-migration.sql` | create (**added at 3b-i**, C-1) | The mandatory write probe: one `DO` block that always raises (§6.3) | — |
| `supabase/migrations/__tests__/business-os-credit-charges.migration.test.ts` | create | SQL-text guard over all four SQL files, invites-migration pattern | — |
| `lib/repositories/BusinessOsCreditChargeRepository.ts` | create | §3.6 | — |
| `lib/repositories/__tests__/BusinessOsCreditChargeRepository.test.ts` | create | Exact RPC arguments (eleven, incl. `p_service`), error path, abort signal passed; the `AiChargeRecord` + `service` hand-off type; a non-AI service passed through; a "no production caller" source guard | — |
| `lib/business-os/account/__tests__/accountDeletionPolicy.test.ts` | modify (**added at 3b-i**) | Pins the Q-8 verdicts | 0 |
| `lib/repositories/index.ts` | modify | Export class, singleton, types | 0 |
| `lib/business-os/llm/aiChargeRecorder.ts` | create | §3.7 | — |
| `lib/business-os/llm/__tests__/aiChargeRecorder.test.ts` | create | Outcomes, logs, budget, abort | — |
| `lib/business-os/llm/aiActionAudit.ts` | modify | One awaited `recordAiChargeSafely` call (§3.7) | 0 |
| `lib/business-os/llm/__tests__/aiActionAudit.test.ts` | modify | NI-1 to NI-4, ordering, AC-8 (two turns, one header → two records) | 0 |
| `lib/business-os/purge/descriptors.ts` | modify | Two `never(…)` descriptors beside the entitlements tables (§6.5) | 0 |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | Two `never` entries | — |
| `lib/business-os/businessOwnedTables.ts` | modify | Two `USER_OWNED_TABLES` entries with reasons | 0 |
| `lib/business-os/account/accountDeletionPolicy.ts` | modify | `business_os_credit_charges: minimise`; totals default `delete` (Q-8) | 0 |
| Call-site suites from the T3b.0 census | modify, **only if** they break | `jest.mock` of the recorder where a suite asserts "no error log" or a stubbed `supabaseServer` lacks `.rpc` (Q-7) | counted at T3b.0 |
| `scripts/lib/bos-llm-scope.ts` + its test | modify (**if SA authorises**, Q-6) | Inclusion for `aiChargeRecorder.ts` if it does not import the catalog | 1 (pre-existing) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | A short "Metering: the credit ledger" section: the two tables, not AI-specific (one pool, `service`), the credit value v0, the charging start, "nothing reads it yet" | 0 |

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

- ✅ **T3b-i.0: Baselines.** T3a.0's baselines re-taken for the 3b-i files in §4.2 (§5.2.1.1).
- ✅ **T3b.1: Migration, rollback, checker, SQL guard (§6).** `20261014` re-checked free on `origin/main` (latest `20261013`, SF-2). Migration, rollback, checker **and the write probe** written, with the migration test; C-2, C-3, C-4, SF-1 and Q-1 (a)–(d), Q-8, Q-9 met (§5.2.1.1). No DB touched by Dev.
- ✅ **T3b.2: Repository (§3.6)** with its unit test. **No production caller** (a source guard in the test enforces it, barrel included). Types in the repository file, as the shadow repository does (N-5), and re-exported from the barrel.
- ✅ **T3b.5: Data lifecycle (§6.5).** Two `never` descriptors, baseline 129 → 131, two `USER_OWNED_TABLES` entries, `business_os_credit_charges: minimise` (totals default `delete`), pinned by a new deletion-policy test. `businessOwnedTables.test.ts` finds both tables in the migration and fails without the registration (negative control run).
- ✅ **T3b.6: Tenant-isolation checks (§7.3)** — DB and repository half (§5.2.1.1).
- ✅ **T3b-i.8: Docs.** Entitlements doc: a "Metering: the credit ledger" section (renamed from "the AI credit ledger" 2026-09-29) and the Q-4 note in § The mode flag (SF-6, brought forward from 3b-ii at TL's request); §6.3 rewritten for the checker as built and the mandatory probe; §6.4 steps 2–4 and the exact PROD steps in §6.4.1.
- ✅ **T3b-i.9: Gates and evidence** (§5.2.1.1).
- ✅ **T3b-i.10: Handover.** Status → Code Complete (3b-i); uncommitted; TL notified through the hand-back. The migration is **not** applied: the user runs §6.4.1 and pastes the probe output into §15.
- ✅ **T3b-i.11: Not AI-specific (user decision 2026-09-29).** Renames to `business_os_credit_*` across all four SQL files, the repository, its test, the barrel, the lifecycle registries, the entitlements doc and this workplan; a `service` column (charge NOT NULL, adjustment NULL, format CHECK, owner-readable), `p_service` on the RPC and `service` on the repository input; guard tests updated; re-run on PGlite in §6.4.1 order (§5.2.1.2).

#### 5.2.1.1 Dev evidence — 3b-i (2026-09-29)

Worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-3b-i` (stacked on 3a's `feature/business-os-credit-deduction-slice-3`, PR #137, which includes a merge of `origin/main`) at `ef3da3bf`, nothing committed, **no database touched** (no local Postgres either: the brief said "any database"). `period_anchor` is taken as live from SA's measurement of 2026-09-28 (§13); `npm run schema:check` was not re-run (no `.env.local` in this worktree).

**What 3b-i adds at runtime: nothing.** The repository is exported from the barrel and imported by nothing else (source guard); the migration is a file.

| Gate | Baseline (T3b-i.0) | After (T3b-i.9) |
|---|---|---|
| `npx jest supabase/migrations/__tests__ lib/business-os/purge lib/business-os/__tests__/businessOwnedTables.test.ts lib/business-os/account lib/repositories/__tests__ scripts/__tests__/entitlementSqlScripts.guard.test.ts lib/business-os/llm lib/business-os/entitlements scripts/__tests__/check-bos-llm-literals.test.ts` | 107 suites, 2,282 tests, all green | **109 suites, 2,377 tests, all green** (+73 migration guard, +21 repository, +1 deletion policy) |
| `business-os-credit-charges.migration.test.ts` (new) | — | 73 tests. **Mutation check** (file restored byte-identical, sha256 `41247de1…c7ba`): renaming the OUT column back to `period_start` (C-2), adding a table-level `GRANT SELECT … TO authenticated` (C-4), dropping the return-direction `AT TIME ZONE 'UTC'` (Q-1 (d)) and weakening the C-3 CHECK each turn the suite red |
| `BusinessOsCreditChargeRepository.test.ts` (new) | — | 21 tests |
| `businessOwnedTables.test.ts` negative control | — | With `businessOwnedTables.ts` at `HEAD`: red, naming exactly `business_os_credit_totals` and `business_os_credit_charges`; restored |
| `npm run typecheck:bos-llm` | 298 files, 28 errors, 0 new | 299 files (the repository test enters as `caller`: it imports `type AiChargeRecord`), 28 errors, **0 new**; the same one "fixed" baseline entry as 3a (`app/api/onboarding/build/route.ts`), `--update-baseline` not run |
| `npm run check:bos-llm-literals` | 49 files, 2 exempt, 0 violations | **Unchanged**: 49, 2, 0 (no new file imports the catalog) |
| Scoped type program (S2 C-3: scratch tsconfig outside the repo, `extends` the worktree's, `incremental: false`, `include: []`, `files` = `next-env.d.ts` + the 8 touched `.ts` files) | Same program with the 6 tracked files at `HEAD` (`git stash` of those paths only, restored, `git diff --stat` identical before and after) plus `chargeResolver.ts` in place of the repository test's type import | **0 errors in the touched files.** 9 errors outside, and the (file, code, message) set is **identical** to the baseline: 6 in `lib/analytics/aiAnalytics.ts` (as in 3a), 2 in `lib/pilot/insight/MemoryManager.ts`, 1 in `lib/repositories/CalibrationSessionRepository.ts` |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`, the CI placeholder env from `.github/workflows/build.yml`) | — | **Exit 0**: "Compiled successfully", 307/307 pages; 78 `DYNAMIC_SERVER_USAGE` lines, the usual static-generation probes |
| No production caller | — | Source guard in the repository test: `BusinessOsCreditChargeRepository`, `businessOsCreditChargeRepository` and `business_os_record_credit_charge` appear in no `.ts/.tsx/.js/.jsx` under `app lib components hooks scripts pages middleware.ts` except the repository, the barrel and the test |
| Pilot-Credit / token tables | — | `grep` over the 7 new files: `token_usage`, `user_subscriptions`, `credit_transactions`, `billing_events` appear only in the migration test, as its **forbidden** list |
| `console.*` | — | 0 in every touched or new `.ts` file (`index.ts`, `descriptors.ts`, `businessOwnedTables.ts`, `accountDeletionPolicy.ts` and its test were 0 before) |

**How the conditions are met**

| Condition | Where |
|---|---|
| **C-1** probe mandatory, real roles | `scripts/probe-bos-credit-charges-migration.sql`, P00–P22 (§6.3); `SET LOCAL ROLE service_role` before any write, then `authenticated`; (a) P01, P02, P05; (b) P09–P13; (c) P14–P19 (+ P20 INSERT, P21–P22 RLS both ways); (d) the block always raises, then checker C7. §6.4 step 4 and §6.4.1 say "mandatory" |
| **C-2** OUT-name clash | OUT columns are `out_recorded`, `out_period_start`, `out_anchor_source`; parameters `p_*`, variables `v_*`; no `#variable_conflict`. The test pins that no OUT name, parameter or variable equals a column of either table |
| **C-3** totals semantics | `COMMENT ON COLUMN` on every summed column states what it sums and whether adjustments are in (charge rows by trigger; adjustments in `credits_adjustment`; `credits_total` and `cost_usd_total` over all rows; `charge_count` charge rows only); `CHECK (credits_total = credits_owner + credits_scheduled + credits_external + credits_adjustment)`; C7 rebuilds every summed column |
| **C-4** checker C2 | Two C2 rows: no table-level entry for PUBLIC / `anon` / `authenticated`, and per-column `has_column_privilege` exactly 24 of 28 readable (**25 of 29** since the `service` column, §5.2.1.2), the four hidden columns false; the test pins the column lists (derived from the `CREATE TABLE`s) and forbids `GRANT SELECT ON TABLE … TO authenticated` |
| **SF-1** | Neither kind CHECK (nor any CHECK) names `user_id` — test and checker C4; `UNIQUE (action_id)` is a plain constraint, and the self-FK targets it |
| **SF-2** | `20261014` (latest on `origin/main`: `20261013`) |
| **Q-1 (a)–(d)** | `timestamp` variables, `AT TIME ZONE 'UTC'` both ways; `v_anchor_utc + make_interval(months => v_months)`, never chained; C6 has leap-year, exactly-at-anchor and a moved session time zone with a case that discriminates; the test pins both directions |
| **Q-3** | No plan row → `date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, `out_anchor_source = 'calendar_month'` |
| **Q-8** | `user_id` nullable with `ON DELETE SET NULL` (charges), `ON DELETE CASCADE` (totals); RPC refuses a NULL `p_user_id`; C7 filters `user_id IS NOT NULL` |
| **Q-9** | Column-level `GRANT SELECT (…)` only; the first in `supabase/migrations/`, authorised by SA |
| **SA-S8** | `REVOKE ALL` from PUBLIC, `anon`, `authenticated`, `service_role` on all four objects (never enumerated), positive grants after; both functions `SECURITY INVOKER`, `SET search_path = ''`, every name schema-qualified (test); EXECUTE for `service_role` only; no trigger |

**T3b.6 — tenant isolation (DB and repository half).** The guard applies (service role) but no caller-supplied id selects or mutates a row. The repository builds the ten (**eleven** since `p_service`, §5.2.1.2) RPC arguments field by field (test: an input carrying `user_id`, `p_user_id`, `kind`, `id` reaches the RPC with none of them); the RPC takes typed scalars, no `jsonb`; `kind` is hard-coded `'charge'`; the totals conflict target is `(user_id, period_start)` keyed on the server-derived account; no trigger on either table (test + checker C4). The owner half is RLS plus the column grant, proven live by P14–P22.

**Deviations (for SA)**
- **D-7** The write probe is **one `DO` block that always raises**, not a `BEGIN; … ROLLBACK;` script. The editor shows only the last statement's result, so a `SELECT` before a `ROLLBACK` would never be seen; and a raise inside the block cannot be separated from its writes by a paste that loses its framing. This is the `20261010` / `20261011` dry-run precedent, applied and verified on PROD. The role switches are `SET LOCAL ROLE`, as C-1 asks.
- **D-8** All four SQL files follow the invites-migration paste rules (no comments, string literals of letters, digits, underscores and spaces only, no single-letter alias), pinned by the test. Consequences: C6's second zone is `NZ` rather than `Asia/Jerusalem` (the `/`); the totals semantics are `COMMENT ON COLUMN` text rather than SQL comments; the `action_type` / `reason_code` format checks use `translate()` and `position()` rather than a regex literal; timestamps in C6 are `make_timestamptz(…, 'UTC')`.
- **D-9** CHECKs beyond §3.2: `amounts_are_numbers` (`numeric` accepts `NaN`, and `NaN >= 0` is true in Postgres), `version_not_negative`, a `reason_code` format check, and on totals non-negative trigger buckets and `fallback_priced_count ≤ charge_count`. The adjustment shape also requires `is_fallback_priced IS FALSE` (§3.2's table). 12 CHECKs in all (**13** since the `service` format check, §5.2.1.2); the checker lists them by name.
- **D-10** The RPC rounds `p_credits` to 6 dp and `p_cost_usd` to 10 dp **once**, and writes the same rounded values to both tables, so the totals always equal the rebuild exactly.
- **D-11** The repository logs a failed write at `warn`, not `error`: 3b-ii's recorder owns the one `error` event (`bos_ai_charge_write_failed`, FR-16), and two `error`s per failure would double-count. The RPC's row is mapped strictly: a missing row, a non-boolean `out_recorded`, a missing period or an unknown anchor source is returned as an error, never a guessed result.
- **D-12** No read method, as §3.6 and N-5 planned. The brief's "read methods scoped by user_id" is met vacuously: there is no read to scope until slices 4, 6 and 9.
- **D-13** The repository test carries a "no production caller" source guard. **3b-ii must add `aiChargeRecorder.ts` (and its test, if it names the repository) to that guard's `ALLOWED` list.**
- **D-14** The checker has a C8 clock row and a C7 INFO row (counts and `min(created_at)`); §6.4.1 step 4 records the apply time with `SELECT now() AT TIME ZONE 'UTC'` (SF-5).

**Flags (not fixed here)**
- **F-1** `service_role` holds INSERT and UPDATE on the totals table: a `SECURITY INVOKER` RPC can only write what its caller may write, so "totals written only via the RPC" is held by the repository surface (the only writer), not by privilege. As §6.1 planned; the alternative is `SECURITY DEFINER`, which SA-S8 forbids.
- **F-2** No deletion executor runs `accountDeletionPolicy` in production. When one is built, it must **not** try to minimise `business_os_credit_charges` with an UPDATE (service_role has none): deleting the auth user detaches the rows through the FK. The policy's reason now says so.
- **F-3** Nothing has executed the PL/pgSQL. The probe (step 7) is its first execution, as SA's C-1 anticipated. If SA wants it earlier, SA can run the migration and the probe (with a fabricated `auth.users` row) on a throwaway Postgres, as in the admin reorganisation slice 5 review.
- **F-4** CLAUDE.md's Key Documentation row still says `BOS_ENTITLEMENTS_MODE` is unset in production (stale; already flagged to TL in §12).

#### 5.2.1.2 Dev evidence — 3b-i made service-generic (2026-09-29)

**User decision (2026-09-29):** the ledger must not be AI-specific. Every chargeable action, AI or not, will have a measured cost converted to credits from **one** credit pool; non-AI charges follow the same procedure with few exceptions. Nothing non-AI is built; the ledger just must not block it. The migration was applied nowhere, so this is a rename plus one column, not a second migration. Worktree and branch as §5.2.1.1; nothing committed; **no real database touched**. The numbers here supersede §5.2.1.1's for the files they name.

**Old → new names.** `business_os_ai_charges` → `business_os_credit_charges`; `business_os_ai_charge_totals` → `business_os_credit_totals`; `business_os_record_ai_charge` → `business_os_record_credit_charge`; `business_os_ai_period_start` → `business_os_credit_period_start`; every constraint, index and policy name follows its table; `20261014_business_os_ai_charges.sql` (+ `_rollback`) → `20261015_business_os_credit_charges.sql`; `scripts/check-bos-ai-charges-migration.sql` / `probe-…` → `check-bos-credit-charges-migration.sql` / `probe-…`; `business-os-ai-charges.migration.test.ts` → `business-os-credit-charges.migration.test.ts`; `BusinessOsAiChargeRepository` (+ singleton, types, `BOS_RECORD_AI_CHARGE_RPC`) → `BusinessOsCreditChargeRepository` (…, `BOS_RECORD_CREDIT_CHARGE_RPC`). Unchanged on purpose: 3a's `AiChargeRecord` / `buildAiChargeRecord` and the 3b-ii recorder's `aiChargeRecorder.ts` and `bos_ai_charge_*` events (the AI service's own code).

**What changed in the schema.**
- `service text` on the charge row, between `is_fallback_priced` and `action_type`: required on `kind = 'charge'`, NULL on `kind = 'adjustment'` (both in the existing shape CHECKs); new `business_os_credit_charges_service_format` CHECK, character for character the `action_type` rule (the test pins that), naming no service. Owners may SELECT it (added to the column grant).
- The RPC takes `p_service text` after `p_group_id` (11 parameters) and refuses a NULL one with `22004`; it stores it and adds it to no total.
- Totals unchanged: one row per `(user_id, period_start)`, one pool.
- `COMMENT ON COLUMN`: `service` (identifier, not a closed list; adjustments inherit), `group_id` (every service; even a group of one), `is_fallback_priced` ("AI specific … recorded false by every other service"); both table comments no longer say AI.
- Checker: 29 columns / 25 owner-readable, 13 CHECKs. Probe: every AI call passes `'ai'`; P03 checks `service = 'ai'`; new **P08A** (a `notification_email` charge lands in the same single totals row), **P08B** (`'Notification Email'` refused by the CHECK, nothing written), **P08C** (NULL service refused, `22004`). D-8 paste rules, C-1 to C-4, SF-1, B-1, S-1, S-2 and QA-N1 to N5 all kept (guard tests unchanged and green).

**Throwaway PGlite run, §6.4.1 order** (PGlite 0.5.8 = PostgreSQL 18.3, in memory, harness in the Dev scratchpad outside the repo, same Supabase role / `auth` / plan-table stubs as SA's; session `TimeZone = Asia/Jerusalem`): **28 pass, 0 fail.**

| Step | Result |
|---|---|
| Pre-check (§6.4.1 step 2, new signature) | all four `NULL` |
| Migration | applies; all four objects exist |
| Checker | `VERDICT PASS 19 pass 0 fail`; C2 `25 of 29 columns readable and mismatches none`; C4 `13 of 13` |
| Probe, placeholder left in | `PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE …` |
| Probe, id **with** a plan anchor | `PROBE PASS`; P01–P22 and P08A–P08C all PASS (25/25); P03 `stored with service ai`; P04 `period from plan starts 2026-08-31 10:00:00 utc`; nothing left behind |
| Probe, id **without** a plan row | `PROBE PASS`; 25/25; P04 `period from calendar_month starts 2026-09-01 00:00:00 utc`; nothing left behind |
| Checker again | `VERDICT PASS`; C7 `0 charge rows and 0 totals rows and 0 detached rows and first row at none` |
| Direct, as `service_role` | an `ai` charge and a `notification_email` charge both `out_recorded = true`, **one** totals row, `charge_count 2`, `credits_total 1.750000`; malformed services (`Notification Email`, `1email`, `notification-email`, empty, 65 chars) each `23514 … service_format`; NULL service `22004`; nothing written by any refusal; an adjustment carrying a service refused by `adjustment_shape`; the owner (as `authenticated`) reads `service` on both rows; checker `VERDICT PASS` with the two rows (C7 rebuild) |
| Rollback with a row | `P0001 ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped`; all objects and rows remain |
| Rollback, emptied | drops all four objects |
| Re-apply | migration applies again; checker `VERDICT PASS 19 pass 0 fail` |

| Gate | Result |
|---|---|
| `npx jest` migration guard + repository + `lib/business-os/purge` + `lib/business-os/account` + `businessOwnedTables.test.ts` (SA's set) | **7 suites, 194 tests, all green** (was 184): migration guard **90** (was 81: + service column/CHECK, one pool, comments, `p_service` stored, probe `'ai'` calls, P08A–C, owner grant), repository **22** (was 21: + non-AI service passed through) |
| The above + `lib/business-os/llm lib/business-os/entitlements scripts/__tests__/entitlementSqlScripts.guard.test.ts` | **58 suites, 1,591 tests, all green** |
| `npm run typecheck:bos-llm` | 299 files, 28 errors, **0 new**, passed (the same one "fixed" baseline entry) |
| `npm run check:bos-llm-literals` | 49 files, 2 exempt, **0 violations** |
| Scoped type program (S2 C-3, the 8 touched `.ts` files, renamed) | **0 errors in the touched files**; the same 9 outside (6 `aiAnalytics.ts`, 2 `MemoryManager.ts`, 1 `CalibrationSessionRepository.ts`) |
| `next build` (6 GB heap, CI placeholder env) | **Exit 0**: "Compiled successfully", 307/307 pages, 78 `DYNAMIC_SERVER_USAGE` lines (as before) |
| Leftover old names | `grep` over the worktree (excluding `node_modules`, `.next`, `.git`) for `business_os_ai_charge`, `BusinessOsAiCharge`, `record_ai_charge`, `ai_period_start`: only this workplan's historical text (§11 Q-12 as asked, §13 and §14 review text, §16 older rows, and the old → new maps) and the requirement doc (being edited by BA in parallel; not touched here) |

**For 3b-ii.** The recorder passes `{ ...record, service: 'ai' }`; `aiChargeRecorder.ts` joins the repository test's `ALLOWED` list (D-13); `bos_ai_charge_write_failed` may add `service` to its fields (the repository's `warn` already carries it).

#### 5.2.2 Slice 3b-ii — Start charging (≈ 2 days; starts after 3b-i is applied, checked and write-probed on PROD)

- ⬜ **T3b.0 (b)/(c): Census and baselines.** Every suite that runs the real `runAiAction` with valid identities (mocks `AuditTrailService`, does not mock `aiActionAudit`), with its pass count before the change, and the suites among them that use `jest.useFakeTimers()` (SF-3). Per wrapped route: `maxDuration`, maximum action count per invocation, headroom at today's count and at 10× (SF-4). T3a.0's baselines re-taken for the 3b-ii files.
- ⬜ **T3b.3: Recorder (§3.7)** with its tests (every outcome row, every log level and field, budget, abort, never rejects). It writes through `BusinessOsCreditChargeRepository` with `{ ...record, service: 'ai' }` — slice 3 records only the AI service — and is added to the repository test's `ALLOWED` list (D-13). The budget helper is written locally (Q-11). `LITERAL_SCOPE_INCLUSIONS` entry for `aiChargeRecorder.ts` if it does not import the catalog (Q-6).
- ⬜ **T3b.4: Wiring** in `runAiAction`; NI-1 to NI-4; ordering (`audit` → `unpriced check` → `charge`); AC-8 and AC-12.
- ⬜ **T3b.7: Blast radius.** Per-suite `jest.mock` of the recorder in every census suite that **reaches the write** (Q-7, SF-3), listed in §4.2. Evidence: the census run once with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9` shows zero `bos_ai_charge_write_failed`. NI-5 = identical pass sets.
- ⬜ **T3b.8: Docs.** The entitlements doc's "Metering" section and § The mode flag (SF-6: metering is not mode-gated); the `bos-llm-call-standards` skill Standard 6 (SF-7); the stale CLAUDE.md mode row flagged to TL.
- ⬜ **T3b.9: Gates and evidence.** As T3a.5, plus `next build`, and the grep that no new file names `token_usage`, `user_subscriptions`, `credit_transactions` or `billing_events`.
- ⬜ **T3b.10: Handover.** Status → Code Complete (3b-ii); uncommitted; notify TL. RM records **both** timestamps (SF-5): the 3b-i migration apply time and the 3b-ii production go-live (the charging start).

---

## 6. Migration Plan, Rollback and Apply / Verify Runbook (3b)

### 6.1 The migration SQL plan

**File:** `supabase/migrations/20261015_business_os_credit_charges.sql` (proposed outline; the SQL is written at T3b.1)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Tables (§3.2, §3.3). FK to auth.users, NOT business_profiles: a business
--    Reset must never cascade a bill away (same reasoning as 20261005).
CREATE TABLE public.business_os_credit_charges (…);        -- kind CHECKs, service format CHECK, UNIQUE (action_id)
CREATE INDEX business_os_credit_charges_user_period_idx
  ON public.business_os_credit_charges (user_id, period_start, created_at DESC);
CREATE INDEX business_os_credit_charges_group_idx
  ON public.business_os_credit_charges (group_id);
CREATE TABLE public.business_os_credit_totals (…);         -- PK (user_id, period_start): one pool, no service

-- 2. RLS: owner SELECT only (SA-S8). No INSERT/UPDATE/DELETE policy exists.
ALTER TABLE … ENABLE ROW LEVEL SECURITY;                    -- both tables
CREATE POLICY business_os_credit_charges_owner_select ON public.business_os_credit_charges
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY business_os_credit_totals_owner_select ON public.business_os_credit_totals
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- 3. Privileges: REVOKE ALL (never an enumerated list — the MAINTAIN defect),
--    then state the positive side.
REVOKE ALL ON TABLE <both> FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE <both> TO authenticated;              -- behind the owner policy (Q-9: column list?)
GRANT SELECT, INSERT ON TABLE public.business_os_credit_charges TO service_role;          -- no UPDATE, no DELETE: rows are never changed
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_credit_totals TO service_role;

-- 4. Functions: SECURITY INVOKER, search_path = '', callable by service_role only.
CREATE FUNCTION public.business_os_credit_period_start(p_anchor timestamptz, p_at timestamptz)
  RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = '' AS $$ … UTC … $$;
CREATE FUNCTION public.business_os_record_credit_charge(…)
  RETURNS TABLE (out_recorded boolean, out_period_start timestamptz, out_anchor_source text)   -- C-2
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ … $$;
REVOKE ALL ON FUNCTION <both> FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION <both> TO service_role;

COMMIT;
```

- **No `SECURITY DEFINER` anywhere** (SA-S8; the queued P1 on anon-callable definer functions). The RPC runs with the caller's rights, and only `service_role` may call it.
- **No backfill, no data.** The tables are created empty. That is FR-34 / FR-35 by construction: no historical `token_usage` row is converted, and no Pilot-Credit table is read (AC-26).
- The migration test pins: `REVOKE ALL` (not a list) on both tables and both functions; no `SECURITY DEFINER`; `SET search_path = ''` on both functions; `kind` hard-coded `'charge'` in the RPC; `ON CONFLICT (action_id) DO NOTHING`; `AT TIME ZONE 'UTC'` in the period function; the FK targets `auth.users`; no `token_usage` / Pilot-Credit table name; no `TRIGGER`; and that the checker names every constraint and function the migration creates (the invites-test "checker has drifted" pattern).

### 6.2 Rollback

**File:** `supabase/SQL Scripts/20261015_business_os_credit_charges_rollback.sql`

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.business_os_credit_charges IN ACCESS EXCLUSIVE MODE;
DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_credit_charges AS charge_row) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped';
  END IF;
END
$refuse$;
DROP FUNCTION public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean);
DROP FUNCTION public.business_os_credit_period_start(timestamptz, timestamptz);
DROP TABLE public.business_os_credit_totals;
DROP TABLE public.business_os_credit_charges;
COMMIT;
```

**It refuses while the ledger holds a charge (S-2).** The script first locks the charge table, so no charge can land between the check and the drop, and then raises `ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped` if the table has any row. The error aborts the whole transaction: nothing is dropped and the bill is untouched. So the paste is only ever destructive to an **empty** ledger, and it can never silently drop a bill once charging has started.

**Order and cost:**
1. **Preferred rollback is code-only:** revert the 3b wiring and redeploy. The tables stay; nothing writes; nothing reads. No data is lost.
2. The DB rollback is for a **wrong migration, before charging starts** (the ledger is empty). If it answers `ROLLBACK REFUSED`, charging has started: stop, do not try to get around it, and send the message to Dev. Removing a ledger that holds charges is a separate, deliberate decision (export both tables first, then SA rules on how to empty them); this script will never do it.
3. Never run the DB rollback while the 3b code is deployed: every AI action would then log `bos_ai_charge_write_failed` (the actions themselves still succeed — NI-1).

### 6.3 The read-only checker and the mandatory write probe

**File:** `scripts/check-bos-credit-charges-migration.sql` — `SET default_transaction_read_only = on;` plus **one** `SELECT` (the SQL editor shows only the last result), one PASS / FAIL / INFO row per check, row 0 the verdict. Written to the invites-checker conventions: no `--` or `/*` comments, string literals of letters, digits, underscores and spaces only, no single-letter alias. The migration test pins all of that, and that the checker has not drifted from the migration.

| Row | Check | Pass when |
|---|---|---|
| C1 | tables, RLS | Both tables exist; RLS on both |
| C2 | table ACLs (`aclexplode`) | PUBLIC, `anon`, `authenticated` hold **no table-level** privilege on either table (C-4); `service_role` holds exactly SELECT, INSERT on charges and SELECT, INSERT, UPDATE on totals — no DELETE, TRUNCATE, MAINTAIN, REFERENCES or TRIGGER |
| C2 | column grants (C-4) | `has_column_privilege('authenticated', …, 'SELECT')` is true for exactly the 25 granted columns of the 29 (`service` included) and false for `cost_usd`, `is_fallback_priced`, `cost_usd_total`, `fallback_priced_count`; `authenticated` can write no column; `anon` holds nothing on any column |
| C3 | policies | Exactly one per table, permissive, `FOR SELECT`, `TO authenticated`, a `USING` naming `auth.uid()` and `user_id`, no `WITH CHECK` |
| C4 | constraints | `UNIQUE (action_id)`; all 13 CHECKs by name (the kind domain, both kind shapes, the trigger and outcome lists, the three format checks — `service`, `action_type`, `reason_code` — NaN, version ≥ 0, and on totals the C-3 sum, non-negative trigger buckets and consistent counts); **no CHECK names `user_id`** (SF-1, Q-8); exactly three FKs — charges `user_id → auth.users` `SET NULL`, totals `user_id → auth.users` `CASCADE`, and the self-FK `adjusts_action_id → action_id`; both indexes by name; no trigger |
| C5 | functions | Both `prosecdef = false`, `proconfig = {search_path=""}`, an explicit ACL, EXECUTE for `service_role`, **not** for `anon`, `authenticated` or PUBLIC |
| C6 | period cases (read-only; the function has no side effects) | Nine fixed cases, in the session time zone **and again with the session `TimeZone` moved to `NZ`** (UTC+13 in January; `Asia/Jerusalem` cannot be written under the literal rule, and NZ moves the day further): Jan 31 10:00Z anchor → Feb 28 10:00Z at Feb 28 11:00Z, → Jan 31 at Feb 28 09:00Z, → Mar 31 at Apr 1 (counted from the anchor, not chained); **exactly at the anchor**; **leap year** (Jan 31 2028 → Feb 29 2028 10:00Z at Feb 29 12:00Z); a future anchor → an earlier period; a 15th anchor mid-month; a 31st anchor in a 30-day month; and a **zone-sensitive case** (Jan 30 12:00Z anchor at Feb 28 00:00Z → Jan 30) that a naive `timestamptz + interval` gets wrong in NZ, so C6's second row can actually fail |
| C7 | rebuild | The rebuild (`SUM` of every summed column, `GROUP BY user_id, period_start`, **`WHERE user_id IS NOT NULL`**, Q-8) equals the totals table exactly, compared both ways (FULL OUTER JOIN). An INFO row prints the charge-row, totals-row and detached-row counts and `min(created_at)`; "empty" means `0 charge rows and 0 totals rows` |
| C8 | clock | INFO: the UTC time the checker ran |

**The write probe is mandatory (C-1).** **File:** `scripts/probe-bos-credit-charges-migration.sql`. It is the **only** execution of `business_os_record_credit_charge` before production traffic reaches it (no branch DB; Jest cannot run PL/pgSQL). It is **one `DO` block that always ends by raising**, following the applied-and-verified `20261010` / `20261011` dry-run precedent: the editor shows only the last result, so the report *is* the error text, and because the block always raises, nothing it wrote can survive even if a paste loses its framing. That is stronger than a `BEGIN; … ROLLBACK;` around it (D-7 in §5.2.1.1). It runs on the user's own account, through a placeholder that fails loudly if left in; it never creates an auth user.

| Id | As | Proves |
|---|---|---|
| P00 | `postgres` | INFO: row counts before, and the account's plan anchor (in UTC, ` utc` suffix, QA-N5). Before it, three guards raise `PROBE SKIPPED` and run nothing: the placeholder left in, a value that is not a valid user id (QA-N4), and a read-only session (QA-N3) |
| P01–P02 | `service_role` | The same action id twice → `recorded` true, then false, same period; the totals moved by exactly one charge (C-1 (a)). A raise here (for example a 42702 from C-2) stops the probe with `PROBE FAIL  P01` and the error text |
| P03 | `service_role` | One thin row stored, `service = 'ai'`, credits at 6 dp and cost at 10 dp, `kind = 'charge'`, no adjustment fields |
| P04 | `service_role` | The period came from the plan anchor (or the UTC calendar month with no plan row) and equals `business_os_credit_period_start(anchor, now())` |
| P05 | `service_role` | A second id in the same period → the totals sum both and split them by trigger (owner vs scheduled), fallback count +1 (C-1 (a)) |
| P06 | `service_role` | The account's totals equal the rebuild from its ledger rows |
| P07–P08 | `service_role` | A NULL action id is refused (`22004`); an unknown trigger is refused by the CHECK and moves no total |
| P08A–P08C | `service_role` | Not AI-specific (2026-09-29): a `notification_email` charge is recorded into the **same** single totals row (one pool); a malformed service (`Notification Email`) is refused by the CHECK and writes nothing; a NULL service is refused (`22004`) |
| P09–P13 | `service_role` | UPDATE, DELETE and TRUNCATE of the charges, and DELETE and TRUNCATE of the totals, each fail 42501 (C-1 (b)) |
| P14–P20 | `authenticated` | EXECUTE on both functions fails 42501; SELECT of each hidden column fails 42501; INSERT fails 42501 (C-1 (c)) |
| P21–P22 | `authenticated` | With the JWT claims set to the owner, RLS returns their two charge rows and their totals row; set to another account, none |

Expected output: an error whose text starts `PROBE PASS  this error is expected and rolls everything back`, followed by one line per id (P00, P01–P08, P08A–P08C, P09–P22). Then **(C-1 (d))** the checker again: C7 still `0 charge rows and 0 totals rows`.

### 6.4 Apply / verify runbook, and the charging start

The runbook follows SA's split (§13): steps 1–4 belong to **3b-i** (the ledger applied and inert), steps 5–8 to **3b-ii** (charging starts). 3b-ii's merge does not happen until step 4's output is recorded.

| Step | Part | Who | What | Expect |
|---|---|---|---|---|
| 0 | 3a | TL / RM | 3a merged and deployed | A new AI entry in `audit_trail` has `details.schema = 2` and a `details.actionId` |
| 1 | 3b-i | User (credentials) | `npm run schema:check` on `main` | `business_os_account_plans` selects cleanly, incl. `period_anchor`; ref recorded (SA already confirmed it live read-only on 2026-09-28) |
| 2 | 3b-i | User | Paste `supabase/migrations/20261015_business_os_credit_charges.sql` into the Supabase SQL editor on **PROD**; record the **apply time** (UTC) in §15 (SF-5) | `Success. No rows returned` |
| 3 | 3b-i | User | Run `scripts/check-bos-credit-charges-migration.sql` | Row 0 `VERDICT PASS`; C7 `0 charge rows and 0 totals rows` |
| 4 | 3b-i | User (**mandatory**, C-1) | Run `scripts/probe-bos-credit-charges-migration.sql` with your own user id pasted in, then the checker again; both outputs pasted into §15 | `PROBE PASS …` with P01–P22 and P08A–P08C each PASS; then the checker still `VERDICT PASS` and C7 still empty. 3b-i merges with nothing calling the repository |
| 5 | 3b-ii | RM | Merge 3b-ii; Vercel deploys | — |
| 6 | 3b-ii | RM | **Record the charging start** = the UTC time the 3b-ii production deployment went live, in §15 and in the entitlements doc. Rows between the step-2 apply time and this moment are developer or preview traffic on developers' own accounts (SF-5) | FR-34: "a stated moment" |
| 7 | 3b-ii | User, +1 h | Run one chat turn and one image in `/test-business-os`; then `SELECT … FROM business_os_credit_charges WHERE user_id = <own id> ORDER BY created_at DESC LIMIT 5` and the matching `audit_trail` rows | One charge per action; `action_id` = the audit entry's `details.actionId`; `triggered_by = 'owner'`; credits ≈ cost × 1000; the totals row moved; no `bos_ai_charge_write_failed` in the logs |
| 8 | 3b-ii | User, next morning | Compare, for the night: count of AI audit entries vs count of charge rows (per account); C7's rebuild query | Equal or explained (a lost audit entry, KI-10); rebuild = totals; the insight run rows carry `triggered_by = 'scheduled'` |

#### 6.4.1 3b-i on PROD: the exact steps (by the user, Supabase SQL editor)

Nothing here needs a terminal except step 1. Paste each file **whole**, as its own run. Nothing is applied by Dev.

1. **Schema reference (optional; SA already measured it live on 2026-09-28).** In the main checkout, on `main`: `npm run schema:check`. Expect `business_os_account_plans` to select cleanly, `period_anchor` included.
2. **Pre-check: the names are free.** Run:
   ```sql
   SELECT to_regclass('public.business_os_credit_charges') AS charges,
          to_regclass('public.business_os_credit_totals') AS totals,
          to_regprocedure('public.business_os_record_credit_charge(uuid,uuid,uuid,text,text,text,text,numeric,numeric,integer,boolean)') AS record_fn,
          to_regprocedure('public.business_os_credit_period_start(timestamptz,timestamptz)') AS period_fn;
   ```
   Expect all four `NULL`. Anything else: stop, it is already (partly) applied.
3. **Apply.** Open `supabase/migrations/20261015_business_os_credit_charges.sql`, copy all of it, paste, Run. Expect `Success. No rows returned`. It is one transaction: on any error nothing is kept, and a second paste fails at the first `CREATE TABLE` with `relation "business_os_credit_charges" already exists` and changes nothing: if you see exactly that, it was already applied, do not escalate (QA-N6).
4. **Record the apply time (SF-5).** Immediately run `SELECT now() AT TIME ZONE 'UTC' AS applied_at_utc;` and paste the value into §15. From this moment until 3b-ii's production go-live, any ledger row is developer or preview traffic (a local `npm run dev` or a Vercel preview of the 3b-ii branch uses this database).
5. **Checker.** Paste `scripts/check-bos-credit-charges-migration.sql`, Run. Expect row 0 `VERDICT PASS` and every row PASS or INFO; the C7 INFO row reads `0 charge rows and 0 totals rows and 0 detached rows and first row at none`. Once rows exist, that time is printed in UTC with a ` utc` suffix, so it compares directly with the step-4 apply time (S-1). Any FAIL: stop and send the grid to Dev. If the migration itself is wrong, the rollback is `supabase/SQL Scripts/20261015_business_os_credit_charges_rollback.sql`. It works only while the ledger is empty, as it is now, since nothing writes yet. If it ever answers `ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped`, nothing was changed: stop and send the message to Dev (§6.2). The rollback contains `DROP`, so the editor will likely warn that the query is destructive. Confirm that warning **only when Dev has told you to run the rollback**; otherwise cancel (QA-N2).
6. **Your user id.** Run `SELECT id FROM auth.users WHERE email = '<your login email>';`, replacing `<your login email>` with your email, angle brackets included, keeping the quotes (so `'name@example.com'`; left-in brackets return zero rows), and copy the id (QA-N7).
7. **Write probe (mandatory, C-1).** Open a **new SQL editor tab** for it (the checker leaves its own tab read-only). Open `scripts/probe-bos-credit-charges-migration.sql`, replace `PASTE_YOUR_OWN_USER_ID_HERE` (third line) with your id, keeping the quotes and with no spaces inside them, paste the whole file, Run. The editor may warn that the query contains destructive operations (`TRUNCATE`, `DELETE`): that is expected here, **confirm it**. Those statements are there to prove the database refuses them, and the whole block always rolls back, so nothing it does is kept (QA-N2). **It always ends in an error on purpose.** Expect the error text to start `PROBE PASS  this error is expected and rolls everything back`, with lines P00 to P22 plus P08A, P08B and P08C after P08 (P00 INFO, the rest PASS). Three `PROBE SKIPPED` answers mean nothing ran and you can simply fix and re-run:
   - `PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE …`: the placeholder is still there; paste your id over it (QA-N4).
   - `PROBE SKIPPED  the pasted value is not a valid user id …`: the id was pasted wrongly (spaces, missing quotes, part of it cut off); paste only the id from step 6, between the quotes, with no spaces (QA-N4).
   - `PROBE SKIPPED  this session is read only …`: the probe ran in the checker's tab. Open a new SQL editor tab and run it there, or run `RESET default_transaction_read_only;` on its own first and then the probe again (QA-N3).

   `PROBE FAIL …`, any other `PROBE SKIPPED …` (for example `that user id is not an account on this database`) or any other error: stop and send the full text to Dev; 3b-ii does not start.
8. **Nothing kept (C-1 (d)).** Run the checker again. Expect the same `VERDICT PASS`, and C7 still `0 charge rows and 0 totals rows`.
9. **Paste into §15:** the apply time (step 4), the checker grid (step 5), the probe's full error text (step 7) and the second C7 row (step 8). 3b-i then merges with nothing calling the repository, and 3b-ii may start.

**Charging start (FR-34, FR-35):** charging starts at the 3b-ii production go-live, recorded by RM in **§6.4 step 6** (not a step of this list). Before it, nothing is counted and no history is converted; `min(created_at)` of the charge table is the measurable proof. Pilot-Credit balances are untouched (A-11). Because environments share the production database (SF-5), the AC-26 check is "no row before the apply time recorded in step 4 above, and every row before the 3b-ii go-live (§6.4 step 6) is identified" (developer or preview traffic) (QA-N1).

### 6.5 Data lifecycle registration (SA-S8)

| Registry | `business_os_credit_charges` | `business_os_credit_totals` |
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
| `BusinessOsCreditChargeRepository.test.ts` | `rpc('business_os_record_credit_charge', { exact 11 args, incl. p_service })`; `abortSignal` applied; `{ recorded, periodStart, anchorSource }` mapped |
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
npx jest lib/business-os/llm lib/business-os/entitlements lib/repositories/__tests__/BusinessOsCreditChargeRepository.test.ts \
  lib/business-os/purge lib/business-os/__tests__/businessOwnedTables.test.ts lib/business-os/account \
  supabase/migrations/__tests__/business-os-credit-charges.migration.test.ts app/admin/audit-trail \
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
| Q-12 | Table names `business_os_ai_charges` / `business_os_ai_charge_totals` (SA names them, §3.1)? And one table with a `kind` column for adjustments rather than a sibling table (§3.2)? | Yes and yes | *(Renamed 2026-09-29 to `business_os_credit_charges` / `business_os_credit_totals`, §3.1.)*

---

## 12. Flagged Items (console.*, stale docs, carried notes)

**`console.*`** (CLAUDE.md § Logging): every production and test file this plan modifies has **0** `console.*` calls, measured at `7faca4f7`, except `scripts/lib/bos-llm-scope.ts` — **1** call (`:66`, a `console.error` of a tsconfig diagnostic in a CLI script library), which is modified **only** if SA authorises Q-6. It is pre-existing CLI output that SA accepted leaving as is in slice 2; Dev proposes the same here, and the user may ask for its conversion. The call-site suites that the T3b.0 census may add are counted then.

**Stale doc (not fixed here):** CLAUDE.md's Key Documentation row for `BUSINESS_OS_ENTITLEMENTS.md` says "`BOS_ENTITLEMENTS_MODE` is unset in production", while `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9` says production runs `shadow` (confirmed 2026-09-27). Flagged for TL; it matters for Q-4.

**Carried from slice 2's SA code review (N-1):** `lib/ai/providers/groqProvider.ts:157` hardcodes `cost = 0`. Under slice 3 a Business OS call on Groq would be charged the `*` text rate (the OpenAI maximum, $0.03 / $0.18 per 1k). Unreachable while `ALLOWED_PROVIDERS_LAYER2 = ['openai']`; **Business OS is OpenAI-only today.** Before any Layer 2 area is allowed onto Groq, Groq must record a real cost or the allow-list must refuse it (R-9).

**Deprecated systems:** none touched or extended.

---

## 13. SA Workplan Review

> **Names changed after this review (2026-09-29, user decision: the ledger is not AI-specific).** The review text below is kept as written. Read: `business_os_ai_charges` → `business_os_credit_charges`, `business_os_ai_charge_totals` → `business_os_credit_totals`, `business_os_record_ai_charge` → `business_os_record_credit_charge`, `business_os_ai_period_start` → `business_os_credit_period_start`, `BusinessOsAiChargeRepository` → `BusinessOsCreditChargeRepository`, `BOS_RECORD_AI_CHARGE_RPC` → `BOS_RECORD_CREDIT_CHARGE_RPC`, and the files `20261014_business_os_ai_charges*.sql`, `check-`/`probe-bos-ai-charges-migration.sql`, `business-os-ai-charges.migration.test.ts` → their `credit` names. A `service` column was added (29 columns, 25 owner-readable, 13 CHECKs, 11 RPC parameters; probe P08A–P08C). See §5.2.1.2.

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

### SA code review — 3b-i (2026-09-29)

**Status:** 🔄 Fix Required. **One Blocking finding (B-1)**: a one-token defect in the write probe that stops it compiling. The migration, the checker, the rollback, the repository and the lifecycle registrations are approved as written.

**Verdict in one paragraph.** For the first time, the SQL was **executed** (F-3), on a disposable PostgreSQL 18.3 (PGlite 0.5.8, in memory, installed in a scratch folder outside the repo, with stubs for `auth.users`, `auth.uid()`, the three Supabase roles with Supabase-like default privileges, and `business_os_account_plans(user_id PK, period_anchor timestamptz)`). The migration applies. The checker returns `VERDICT PASS 19 pass 0 fail`. The RPC has no 42702, is idempotent, rounds once, and keeps the totals equal to the rebuild. The period function is correct in every edge case tried, under three session time zones. Every CHECK and privilege boundary behaves as designed. The rollback removes all four objects, and the migration re-applies cleanly afterwards. **The probe does not compile**: line 126 puts `CASE WHEN … THEN` directly inside a PL/pgSQL `IF … THEN`. With that single expression parenthesised (in a scratch copy only), the probe returns `PROBE PASS` with P01–P22 all PASS, both for an account that has a plan anchor and for one that has none. It leaves nothing behind, and the checker stays green. Nothing touched PROD or the repo; the instance was discarded.

#### SQL execution evidence (throwaway PGlite; no PROD, no repo change)

| Run | Result |
|---|---|
| Checker before the migration | Errors `42883` (the period function does not exist yet). Expected, and not a step in the runbook (N-8) |
| Migration `20261014` | Applies in one transaction |
| Migration pasted a second time | `42P07 relation "business_os_ai_charges" already exists`; nothing changed (as §6.4.1 step 3 says) |
| Checker, empty ledger | `VERDICT PASS 19 pass 0 fail`: C2 `24 of 28 columns readable`, hidden 0, `authenticated` writes 0, `anon` 0; C4 12 of 12 CHECKs, 3 FKs, 2 indexes, 0 triggers; C5 2 invoker, 2 pinned, client EXECUTE none; C6 `9 of 9` in the session zone and `9 of 9 in NZ`; C7 `0 charge rows and 0 totals rows and 0 detached rows and first row at none` |
| Probe **as committed** (placeholder; U1; U2; unknown id) | **All four: `42601 syntax error at end of input`**, before any statement runs. Minimal repro: `IF a = CASE WHEN b IS NOT NULL THEN 'p' ELSE 'q' END THEN` → 42601. Parenthesised → compiles (B-1) |
| Probe with only B-1 patched: placeholder left in | `PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE …` |
| Same, account **with** a plan anchor (45 days ago) | `PROBE PASS`; P01–P22 all PASS; P04 `period from plan starts 2026-09-15 03:39:34.534 utc` |
| Same, account **without** a plan row | `PROBE PASS`; P01–P22 all PASS; P04 `period from calendar_month starts 2026-09-01 00:00:00 utc` |
| Same, id not in `auth.users` | `PROBE SKIPPED  that user id is not an account on this database` |
| After the probes | 0 charge rows, 0 totals rows, `current_user = postgres`, JWT claims empty. The checker still gives `VERDICT PASS`, and C7 is still empty (C-1 (d)) |
| Committed RPC calls as `service_role` | Same action id twice → `true` then `false`, with one row and one totals increment. `1.0000004` was stored as `1.000000` in both tables. Replaying the same id under another account → `false`, nothing written (N-4). A zero-credit external fallback charge → `charge_count 1`, `fallback_priced_count 1` |
| Bad inputs through the RPC | NaN → `23514 amounts_are_numbers`; Infinity and `1e13` → `22003 numeric field overflow` at the rounding assignment; −1 → `23514 charge_shape`; `Chat-Turn` → `23514 action_type_format`; unknown outcome → `23514 outcome_known`; NULL credits or NULL fallback flag → `23502`. Totals unchanged after all of them |
| `authenticated` | `select *` → `42501` (the column grant works as C-4 intends). Granted columns under its own claims → only its own charge and totals rows. `anon` → `42501` |
| `service_role` writing the tables directly, bypassing the RPC (F-1) | Both a direct totals UPDATE and a direct charge INSERT are **accepted**. The checker then gives **`VERDICT FAIL`, C7 `1 mismatched account periods`**, so the drift is caught (N-1) |
| Adjustment row (inserted as `postgres`) | Accepted with a valid `adjusts_action_id`; an unknown `adjusts_action_id` → `23503` on the self-FK |
| Deleting a user from `auth.users` | Charges `user_id` → NULL (1 detached row); totals row cascaded away; checker `VERDICT PASS` with `1 detached rows` (Q-8 as designed) |
| Period edge cases, session zone `America/Los_Angeles` (UTC wall clock) | Jan 31 23:30 anchor at Mar 1 00:00 → **Feb 28 23:30**; Feb 29 2024 anchor at Feb 28 2025 11:00 → **Feb 28 2025 10:00**; same anchor at Mar 29 2025 09:00 (before the anchor hour) → **Feb 28 2025 10:00**; one microsecond before the anchor → **the previous month**; NULL anchor → NULL. C6 covers exactly-at-anchor and leap Feb 29 2028, and passes in the session zone and in NZ |
| Rollback script | Drops all four objects (0 tables, 0 functions left); the checker then errors `42883`, as expected; the migration **re-applies** cleanly afterwards |

**Line-by-line points confirmed alongside the run.** C-2: no parameter, variable or OUT name equals a column. The conflict targets `(action_id)` and `(user_id, period_start)` are unambiguous; the successful execution proves it. `SET search_path = ''` is set, and every relation and function is schema-qualified (`public.`, `auth.` only through the FK). EXECUTE is revoked from PUBLIC, `anon` and `authenticated` on both functions; the explicit `authenticated` and `anon` revokes are needed because of Supabase's default function privileges, and the harness reproduced those. The C-3 CHECK holds under every write. **Concurrency** (N-6) is reasoned, not run, because PGlite has one connection. A second `INSERT … ON CONFLICT (action_id) DO NOTHING` for an id that is still in flight waits for the first transaction. If the first commits, the second does nothing: `RETURNING … INTO` assigns NULL and the totals are not touched (the sequential form of this was executed). If the first aborts, the second inserts. The totals upsert takes a row lock and adds, so no update is lost. There is one RPC per PostgREST transaction, so no lock-ordering deadlock can arise.

#### Findings

**Blocking**

1. **B-1 `scripts/probe-bos-ai-charges-migration.sql:126`: the probe cannot compile.** `IF v_first_result.out_anchor_source = CASE WHEN v_anchor IS NOT NULL THEN 'plan' ELSE 'calendar_month' END AND …` fails. PL/pgSQL ends an `IF` condition at the first `THEN` that is not inside parentheses, so the condition becomes `… = CASE WHEN v_anchor IS NOT NULL` and the whole `DO` block is rejected with `42601 syntax error at end of input`, whatever id is pasted. On PROD it fails safe (nothing executes, and step 7 says to stop), but C-1 could never be met, so 3b-ii could never start. **Fix:** wrap the `CASE … END` in parentheses, or compute the expected source into a `v_expected_source` variable first. **Guard:** add a test to `business-os-ai-charges.migration.test.ts` that flags any `CASE` between an `IF`/`ELSIF` and its `THEN` unless parenthesised, applied to the probe and both function bodies. The 73 text tests could not catch this, because they do not parse PL/pgSQL. Priority: High, effort minutes.
   - ✅ **Fixed by Dev (2026-09-29):** parenthesised, `= (CASE WHEN v_anchor IS NOT NULL THEN 'plan' ELSE 'calendar_month' END)`. Every other `IF` / `ELSIF` in the probe, the checker, the rollback and both migration function bodies was scanned: this was the only one. Guard `bareCaseInIfConditions` added to the migration test and applied to all four files and to both function bodies; it went **red on the old line** (reported exactly `IF v_first_result.out_anchor_source = CASE WHEN …`) and green after the fix. A negative control pins that it flags the defect in `IF` and `ELSIF`, and accepts the parenthesised form, a `CASE` in an assignment after `THEN`, and DDL `IF EXISTS`. The fixed probe was executed (see "Dev fixes — evidence" below).

**Should-fix**

2. **S-1 `scripts/check-bos-ai-charges-migration.sql:331` (C7 INFO): `first row at` prints in NZ time.** `min(created_at)::text` is rendered after the checker's `zone_switch` has set the statement's `TimeZone` to `NZ`; the run printed `2026-09-29 16:38:25.61+13`. This row is the SF-5 / AC-26 evidence ("no row before the step-4 apply time"), and the step-4 apply time is recorded in UTC. A non-DBA comparing the two can be 13 hours off. **Fix:** `(ledger_counts.first_created_at AT TIME ZONE 'UTC')::text || ' utc'`. Pin it in the checker test. Priority: Medium.
   - ✅ **Fixed by Dev (2026-09-29):** exactly as proposed; `'none'` is kept for an empty ledger. Pinned by a new checker test, which also forbids a bare `first_created_at::text`. Executed with the session in `America/New_York`: the row printed `first row at 2026-09-29 03:52:43.071 utc`, equal to `min(created_at) AT TIME ZONE 'UTC'`.
3. **S-2 `supabase/SQL Scripts/20261014_business_os_ai_charges_rollback.sql`: nothing stops it dropping a live bill.** §6.4.1 step 5 calls it "safe now: the tables are empty". After 3b-ii starts, the same paste silently drops every charge. **Fix:** open the rollback's transaction with a `DO` block that raises (for example `ROLLBACK REFUSED  the ledger holds charge rows`) when `public.business_os_ai_charges` has any row, and say so in §6.2 and §6.4.1. It fits the paste rules: literals of letters and spaces, no comments. Priority: Medium.
   - ✅ **Fixed by Dev (2026-09-29):** the rollback now opens with `SET LOCAL lock_timeout = '5s'`, then `LOCK TABLE public.business_os_ai_charges IN ACCESS EXCLUSIVE MODE` (so no charge can land between the check and the drop), then a `DO $refuse$` block that raises `ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped` if any row exists, then the four unchanged DROPs. The paste rules hold (no comments, literals `5s` and letters and spaces, alias `charge_row`). §6.2 and §6.4.1 step 5 are reworded: the DB rollback is for an empty ledger only, and a refusal means stop and send it to Dev. The rollback test now pins the exact text and that the lock and the refusal come before any DROP. Executed: refused with a row present (`P0001`, all four objects and the row still there), and dropped all four on an empty ledger, after which the migration re-applied.

**Notes**

4. **N-1 (F-1 ruling): `SECURITY INVOKER`, with `service_role` holding INSERT on charges and INSERT/UPDATE on totals, is accepted. Keep it.** This is the repo's convention for server-only RPCs: the `20261005` shadow counter and the `20261010` archive run both use `SECURITY INVOKER` with REVOKE and a `service_role`-only grant. It avoids adding to the queued DEFINER backlog. A `SECURITY DEFINER` switch would guard only against a second code path that already holds the service key. The drift it would prevent is **detected**: in the run above, a direct write turned C7 red. **Revisit** when a gate *reads* the totals to refuse work (enforcement, slice 4 onwards), or when a second writer is proposed. At that point SA will rule on DEFINER plus dropping `service_role`'s direct INSERT/UPDATE grants.
5. **N-2 (F-2): accepted.** The deletion policy's reason text now states the FK route. Any future executor must not UPDATE this table.
6. **N-3 (F-3): closed by this review's execution**, for the migration, checker, rollback and the B-1-patched probe. The PROD probe (§6.4.1 step 7) **stays mandatory**, because only it sees the real Supabase roles, the real `auth.uid()`, and PROD's default privileges and grants on `business_os_account_plans`. `SET LOCAL ROLE service_role` inside a `DO` block has already worked on PROD (`20261010` / `20261011`).
7. **N-4 (for 3b-ii):** replaying an action id under **another** account returns `recorded = false` and writes nothing. Action ids are minted in-process (3a), so this is harmless, but the recorder should log `recorded = false` at `info` with the `actionId`, so that a duplicate stays visible rather than silent.
8. **N-5 (for 3b-ii):** the abort signal cancels the HTTP request, not the database transaction, so an aborted or timed-out write **may still have committed**. The recorder must treat it as *unknown*, not *not charged*. A retry with the same action id is safe, since idempotency was executed above.
9. **N-6:** the concurrency reasoning is above. Nothing to change.
10. **N-7:** C6's two passes rely on MATERIALIZED CTE evaluation order to run the default-zone pass before the zone switch. If the order flipped, both passes would run in NZ. The check would then lose its power to discriminate, but it could never fail falsely. Acceptable.
11. **N-8:** run before the migration, the checker errors with `42883` rather than returning a FAIL grid. The runbook never runs it then. Acceptable.

#### Rulings on the deviations

| Id | Ruling |
|---|---|
| D-7 | **Accepted.** An always-raising `DO` block has proven PROD precedent, and B-1 shows its one cost: a compile error surfaces as a bare `42601`. The runbook's "any other error: stop" covers that |
| D-8 | **Accepted.** `NZ` is a stronger zone than `Asia/Jerusalem` for C6 |
| D-9 | **Accepted.** The NaN CHECK is necessary (NaN was executed and refused); Infinity is already refused by the typmod |
| D-10 | **Accepted.** Executed: rounding happens once and the same value goes to both tables, so C7 is exact |
| D-11 | **Accepted.** `warn` in the repository, the one `error` in the recorder (FR-16). The strict row mapping is right |
| D-12 | **Accepted.** No read method until a slice has a reader; each such read gets `.eq('user_id', userId)` |
| D-13 | **Accepted.** 3b-ii adds `aiChargeRecorder.ts` (and its test) to `ALLOWED` |
| D-14 | **Accepted, subject to S-1** (the INFO time must be printed in UTC) |

#### Checklists walked

- **`new-repository`:** the file location, the optional client, `{ data, error }` with nothing ever thrown (including a synchronous throw from `rpc()`, which is tested), the Pino `service` logger, the singleton, and the barrel exports are all met. Types sit in the repository file, not `types.ts`, as approved under N-5. There is no `.eq('user_id')` because there is no query: the only call is an RPC scoped by `p_user_id`, and the header documents that. Server-only; no `'use client'` importer (the source guard).
- **`tenant-isolation-guard`:** a service-role path with no caller-supplied id. The arguments are built field by field (tested); `kind` is hard-coded; there is no `jsonb`; the totals key is the server-derived account; there are no triggers. The owner half (RLS plus the column grant) was executed above.
- **`business-os-schema-check`:** `business_os_account_plans.period_anchor timestamptz NOT NULL` matches `20261005` and SA's live measurement of 2026-09-28. `service_role` holds SELECT on it (`20261009`), which the `INVOKER` RPC needs.
- **`durable-queue-drain`:** not applicable. There is no cron, no queue and no claim, and the RPC writes synchronously.
- **Lifecycle:** two `never` descriptors, baseline 131, two `USER_OWNED_TABLES` entries, charges `minimise` / totals default `delete`, pinned by a test. Correct.
- **`console.*`:** 0 in every touched file.

#### Gates re-run by SA

| Gate | Result |
|---|---|
| `npx jest supabase/migrations/__tests__/business-os-ai-charges.migration.test.ts lib/repositories/__tests__/BusinessOsAiChargeRepository.test.ts lib/business-os/purge lib/business-os/account lib/business-os/__tests__/businessOwnedTables.test.ts` | **7 suites, 176 tests, all green** |
| `npm run typecheck:bos-llm` | 299 files, 28 errors, **0 new**, passed (the same one "fixed" baseline entry as 3a) |
| Worktree after the review | Unchanged: the same 8 modified and 7 untracked paths; only this section was added to the workplan |

#### Optimisation suggestions (3b-i, non-blocking)

- F-3 will come back in every migration cycle. An in-process PostgreSQL (PGlite, a single devDependency with no Docker) could run each migration, checker and probe in Jest against the stubs used here. That would be a **new pattern** (CLAUDE.md rule 7), so it should be proposed as its own small item for SA, not added to this slice.

#### Dev fixes — evidence (2026-09-29)

All three conditions to go to QA are met by Dev: ✅ (1) B-1 fixed with its guard test, ✅ (2) the fixed probe executed on a throwaway Postgres, ✅ (3) S-1 and S-2 fixed in the same pass. Nothing touched PROD or any real database; nothing committed.

| Item | Evidence |
|---|---|
| ✅ B-1 guard red → green | Before the fix: `probe never puts a bare CASE inside an IF or ELSIF condition` **failed**, reporting the one line `IF v_first_result.out_anchor_source = CASE WHEN v_anchor IS NOT NULL THEN 'plan' ELSE 'calendar_month' END`; migration, rollback, checker and both function bodies clean. After: green |
| ✅ Throwaway Postgres run | PGlite 0.5.8 (PostgreSQL 18.3, in memory), harness in the Dev session's scratchpad outside the repo, same stubs as SA's (three Supabase roles with Supabase-like default privileges, `auth.users`, `auth.uid()` from `request.jwt.claims`, `business_os_account_plans(user_id PK, period_anchor)`). Reads the worktree files read-only. **20 pass, 0 fail** |
| ✅ B-1 reproduced and fixed | The old line (restored in memory only) → `42601 syntax error at end of input`. Fixed probe with the placeholder left in → `PROBE SKIPPED`. With a plan anchor → `PROBE PASS`, P01–P22 all PASS, P04 `period from plan starts 2026-08-31 10:00:00 utc`. With no plan row → `PROBE PASS`, P01–P22 all PASS, P04 `period from calendar_month starts 2026-09-01 00:00:00 utc`. Both left 0 rows in either table; checker `VERDICT PASS 19 pass 0 fail` after them |
| ✅ S-1 | Empty ledger: `first row at none`. One committed row, session `America/New_York`: `1 charge rows and 1 totals rows and 0 detached rows and first row at 2026-09-29 03:52:43.071 utc`, equal to `min(created_at) AT TIME ZONE 'UTC'`; verdict still PASS |
| ✅ S-2 | With that row present: rollback → `P0001 ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped`; all four objects and the row remain. Emptied: rollback drops all four objects; the migration re-applies; checker `VERDICT PASS 19 pass 0 fail` |
| Jest | `business-os-ai-charges.migration.test.ts` **81 tests** (73 + 4 per-file B-1 guards + B-1 negative control + B-1 on both function bodies + S-1 pin + S-2 pin). SA's gate set (7 suites): **184 tests, all green** |
| `npm run typecheck:bos-llm` | 299 files, 28 errors, **0 new**, passed (the same one "fixed" baseline entry) |

### Code Approved for QA: **No, pending B-1 (conditional).**

**Conditions to go to QA:** (1) B-1 fixed, with its guard test. (2) The fixed probe **executed** once on a throwaway Postgres, for example the scratch-folder PGlite method above, outside the repo, and returning `PROBE PASS` with P01–P22 for both account shapes; SA can re-run the harness on request (≈ 1 minute). (3) S-1 and S-2 fixed in the same pass (preferred) or recorded as accepted by TL. Once (1) and (2) are met, no further SA review round is needed. QA's scope: the new suites, the lifecycle suites, the negative control, and a read of §6.4.1 as a non-DBA would follow it. The PROD steps (§6.4.1) run **after** QA, by the user, and 3b-ii does not start until the step 7 output is recorded in §15.

### SA re-check — neutral ledger (2026-09-29)

**Status:** ✅ Code Approved (re-check), **with one condition before the PROD apply (S-3, text only)**. No further SA round is needed once S-3 is done.

**Verdict in one paragraph.** The user's decisions BD-12 to BD-15 were applied as a rename plus one column, and nothing else moved. SA took Dev's pre-rename migration (`mig.bak` in the session scratchpad), put it through Dev's own rename script (`ren.sed`), and diffed it against the current `20261015_business_os_credit_charges.sql`. The **only** differences are the `service` column, the `service` term in both shape CHECKs, the new `service_format` CHECK, three `COMMENT`s plus two reworded table comments, `service` in the owner column grant, `p_service` in the RPC (its NULL refusal, the insert list, and the 11-argument signature in five REVOKE/GRANT lines). Every structural line of the approved version is byte-identical after the rename. The probe, checker and rollback still carry the B-1, S-1, S-2 and QA-N1 to N5 fixes, and the D-8 paste rules hold (the guard suite checks every literal and is green). The one-pool totals are unchanged. The one real inconsistency is text: the migration, the repository and the entitlements doc say `is_fallback_priced` is "AI specific, recorded false by every other service", but the requirement says a later service writes `false` **unless it defines its own documented fallback** (S-3). SQ-18 is ruled below.

#### What SA executed (throwaway PGlite 0.5.8 = PostgreSQL 18.3, in memory, outside the repo; no real database)

| Run | Result |
|---|---|
| Dev's harness (`credit-charges-harness.mjs`), re-run by SA | **28 pass, 0 fail**: pre-check NULLs → migration → checker `VERDICT PASS 19 pass 0 fail` (C2 `25 of 29`, C4 `13 of 13`) → probe SKIPPED with the placeholder → `PROBE PASS` P01–P22 + P08A–C for an account with a plan anchor and for one without → checker still PASS → rollback refuses with a row → rollback drops all four objects on an empty ledger → re-apply PASS |
| SA's own run (`sa-extra.mjs`) — RPC called with **named** arguments in a scrambled order, as PostgREST calls it | Recorded; the right values in the right columns |
| `service` format edges | `a` (1 character) and 64 characters are accepted. 65 characters, `_ai`, `ai ` (trailing space), `AI`, `aï` (non-ASCII), `a-b` and the empty string are each refused `23514 … service_format` |
| `is_fallback_priced = true` on an `sms` charge | **Accepted** and counted in `fallback_priced_count`. Not enforced, as Dev declared; ruled acceptable below |
| Slice 4 shape: an adjustment with no `service`, pointing at an `sms` charge | Accepted. The same adjustment carrying `service = 'sms'` → `23514 adjustment_shape`. `COALESCE(row.service, target.service)` over the self-FK join yields `sms` for it. A plain `WHERE service = 'ai'` skips every adjustment row (see N-10) |
| Totals | One row for the account across `ai`, `sms` and the test services: one pool |

#### Findings

**Should-fix (a condition before the §6.4.1 PROD apply; it does not block QA)**

1. **S-3: the `is_fallback_priced` text contradicts the requirement.** The text sits in three places: `supabase/migrations/20261015_business_os_credit_charges.sql:86` (`COMMENT ON COLUMN … 'AI specific … Recorded false by every other service …'`), `lib/repositories/BusinessOsCreditChargeRepository.ts` (the header and the `isFallbackPriced` doc: "AI-specific … Other services pass `false`"), and the entitlements doc's Metering table ("AI-specific; `false` for every other service"). The requirement's "Adding a future chargeable service" paragraph ("What differs from AI") says a per-message service writes `false` **unless it defines its own documented fallback**. That is the right meaning for a neutral ledger: an SMS provider price that is missing for one country is the same event as a model missing from the pricing table. **Fix:** make the text neutral. For the column: "True when the cost was priced from a fallback rate rather than the measured one. AI sets it when a model is missing from the pricing table; another service sets it only if it defines its own documented fallback, otherwise false. False on adjustment rows. Hidden from owners." Keep D-8's literal rules (no punctuation beyond what the guard allows). Update the repository comments, the doc line, and the test at `business-os-credit-charges.migration.test.ts:331-344` (its title and the `false by every other service` regex). Do it **now**, while the migration is unapplied: once it is applied, the comment can only change through a new migration. Priority: Medium, effort minutes. No schema, grant or behaviour change, so QA's run is unaffected apart from that one test.

**Notes**

2. **N-9 (`is_fallback_priced` left unenforced for non-AI): accepted, and keep it that way.** A CHECK that enforced it would have to name `'ai'`. That would put a closed list back into the schema, which BD-13 and SQ-18 rule out, and it would forbid the documented per-service fallback that the requirement allows (S-3). The flag is hidden from owners, so a wrong value from a future service can distort only the operator report's fallback count (FR-12c / FR-33), never a balance.
3. **N-10 (for slice 4, and a BA wording fix): adjustments inherit `service`. That is coherent, but every per-service read must resolve it.** Inheritance is deterministic: the self-FK targets `UNIQUE (action_id)`, so each adjustment points at exactly one charge, and storing a copy of `service` would only invite drift, since no CHECK can compare two rows. The consequence was executed above: `WHERE service = 'ai'` silently drops the adjustment rows. So slice 4's leak check, the report "grouped by `service`", and slice 7's diary heading must use the **effective service**, `COALESCE(row.service, adjusted.service)`, through the self-FK (one view or one repository read, not ad-hoc joins). **BA:** FR-33's 2026-09-29 note and slice 4's scope ("compares … with the `service = 'ai'` rows only") should say "the rows whose effective service is `ai`: the `ai` charges and the adjustments that point at them". Priority: Low; before slice 4's workplan.
4. **N-11 (future services): `action_type` is scoped by `service`.** Both use the same format, and nothing stops two services from choosing the same action type (`reminder`). Any lookup of an action type's area, audience or diary label (FR-4, rule 5 of "Adding a future chargeable service") must key on **`(service, action_type)`**. Alternatively, rule 5 must require action types that are unique across services. **BA:** add one line to rule 3 or rule 5. Priority: Low; no schema change is needed either way.
5. **N-12: `p_service` refusing NULL with `22004` (Dev's addition) is accepted.** It matches the other required ids. The shape CHECK would otherwise refuse the NULL too, but with a less readable `23514`. `p_service` and `p_action_type` are adjacent `text` parameters with the same format, so a **positional** swap would pass both CHECKs. The repository calls by name (built field by field, and executed above with scrambled named arguments); the probe's positional calls are pinned. For 3b-ii: the recorder goes only through the repository, never a positional SQL call.
6. **N-13: no AI term is left in a neutral object name.** No `business_os_ai_*` ledger name survives in any SQL file, the repository, the registrations or the docs (apart from historical and mapping text). The remaining "AI" words are correct in context: the example `such as ai` in the `service` comment, the probe's P03 text `service ai`, the repository's statement that slice 3 writes `'ai'`, and `AiChargeRecord` / `aiChargeRecorder.ts` / `bos_ai_charge_*`, which belong to the AI service's own code. The only exception is the fallback text (S-3). The table comment's "No tokens or models or call names" is a list of what the ledger must not hold, not an AI claim. Acceptable.
7. **N-14: repository and registrations are correct.** `service: string` is passed field by field and logged at `warn`, and the barrel exports and the source guard were renamed. The purge descriptors (`never` ×2, baseline 131), `USER_OWNED_TABLES` (×2) and the deletion policy (`minimise`, with the FK route and no-UPDATE wording) are reworded service-neutrally, and their suites are green. The runbook §6.4.1 is correct with the new names: the step 2 pre-check uses the 11-argument signature, the rollback path and signature match, and step 7 lists P08A–C. §6.1's outline still shows quoted policy names ("Owners read their own credit charges"), while the file uses `business_os_credit_charges_owner_select`. It is an outline, marked as one, and the checker tests the policies by shape; this is cosmetic.

#### SQ-18 ruling — the format of `service` (ruled 2026-09-29)

**Ruled: Dev's shape stands, exactly as built.**
- **Required on every charge row** (in `business_os_credit_charges_charge_shape`) and **NULL on every adjustment row** (in `…_adjustment_shape`; it is inherited, N-10). The column is nullable only because adjustments share the table.
- **Format:** lowercase ASCII letters, digits and underscores, starting with a letter, **1 to 64 characters**. That is character for character the `action_type` / `reason_code` rule, written with `position` / `translate` (D-8 paste rules), and executed above at both edges. SA prefers **64 to the BA's suggested 40**: one rule for every identifier column in the ledger costs nothing and removes a second rule to remember.
- **Not an enum, not a lookup table, not a registry table.** A new service needs no migration (BD-13, AC-34). The database validates the **format only**; which services exist is a code fact, declared with each service's wrapper (rule 2).
- **The RPC checks NULL only** (`22004`), and the table CHECK is the **single** source of the format. Do not duplicate the format in PL/pgSQL.
- **Naming convention for future services:** a stable, singular, snake_case product noun (`ai`, `notification_email`, `sms`). Rows are never updated, so **a service id is permanent once one row carries it**: renaming it later is a ledger migration, and an id is never reused for a different meaning.
- **Condition C-6 for 3b-ii:** the recorder writes `service` from **one exported constant** (for example `AI_CHARGE_SERVICE = 'ai'`), never from a request, a parameter or the record builder's input. A test pins that the value is `'ai'` and that the recorder passes that constant. The repository type stays `string`; a TypeScript union is optional and non-blocking.

**SQ-17 (allowance id `ai.actions` vs a general credit allowance): noted, not ruled, for the start of slice 5**, as the requirement records. The inputs SA will weigh then: the admin override rows that reference `ai.actions` in the database, every cohort and admin-screen reader of the id, and the entitlements registration guard. The BA's conditional resolution (rename only with a same-change migration of the overrides and a no-leftover check; otherwise neutralise the unit and labels and record the debt) is a reasonable starting point. SA-S11 stands until then.

#### Gates re-run by SA

| Gate | Result |
|---|---|
| `npx jest supabase/migrations/__tests__/business-os-credit-charges.migration.test.ts lib/repositories/__tests__/BusinessOsCreditChargeRepository.test.ts lib/business-os/purge lib/business-os/account` | **6 suites, 188 tests, all green**; with `lib/business-os/__tests__/businessOwnedTables.test.ts` (6) added, **7 suites / 194**, which matches Dev |
| `npm run typecheck:bos-llm` | 299 files, 28 errors, **0 new**, passed (the same one "fixed" baseline entry, `app/api/onboarding/build/route.ts`) |
| PGlite | Dev's harness 28/28, plus SA's extra run above |
| Worktree | Nothing changed by SA except this subsection and one §16 row; the harness scripts sit in the session scratchpad |

### Code Approved for QA (neutral ledger re-check): **Yes.** Condition before the PROD apply: **S-3** (text only; the migration test's one regex updated with it). Condition for 3b-ii: **C-6**. Notes N-10 and N-11 go to BA before slice 4's workplan.

---

## 14. QA Testing Report

> **Names changed after these reports (2026-09-29, user decision: the ledger is not AI-specific).** The report text below is kept as written. Read: `business_os_ai_charges` → `business_os_credit_charges`, `business_os_ai_charge_totals` → `business_os_credit_totals`, `business_os_record_ai_charge` → `business_os_record_credit_charge`, `business_os_ai_period_start` → `business_os_credit_period_start`, `BusinessOsAiChargeRepository` → `BusinessOsCreditChargeRepository`, `BOS_RECORD_AI_CHARGE_RPC` → `BOS_RECORD_CREDIT_CHARGE_RPC`, and the files `20261014_business_os_ai_charges*.sql`, `check-`/`probe-bos-ai-charges-migration.sql`, `business-os-ai-charges.migration.test.ts` → their `credit` names. A `service` column was added (29 columns, 25 owner-readable, 13 CHECKs, 11 RPC parameters; probe P08A–P08C). See §5.2.1.2.

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

### QA report — 3b-i (2026-09-29)

**Test mode:** full · **Strategy used:** A (Jest: SQL text guards, repository, lifecycle registries) + C (my own script running the real SQL files on a throwaway in-memory PostgreSQL, following §6.4.1 in order) + a non-DBA read of §6.4.1 · **Focus:** schema, security, api (repository) · **Skipped:** D (there is no UI in 3b-i) · **Input source:** TL's QA brief.

**Scope.** The 3b-i working tree on `feature/business-os-credit-deduction-slice-3b-i` at `ef3da3bf` (8 modified and 7 untracked paths, all uncommitted): migration `20261014`, rollback, checker, write probe, `BusinessOsAiChargeRepository` and the barrel, and the purge, ownership and deletion registrations. Everything runs after Dev's B-1, S-1 and S-2 fixes. **No real database was touched.** The only database was a PGlite instance in memory, driven from the session scratchpad outside the repo and thrown away at the end. No code or SQL file was changed; the hashes below show it.

#### Commands and numbers

| Gate | Result |
|---|---|
| `npx jest supabase/migrations/__tests__/business-os-ai-charges.migration.test.ts lib/repositories/__tests__/BusinessOsAiChargeRepository.test.ts lib/business-os/purge lib/business-os/account lib/business-os/__tests__/businessOwnedTables.test.ts lib/business-os/llm lib/business-os/entitlements` | **57 suites, 1,511 tests, all green** (16.8 s) |
| SA's gate set alone (the first five paths) | **7 suites, 184 tests, all green**, which matches Dev's 184. Migration guard **81**, repository **21** |
| `npm run typecheck:bos-llm` | 299 files, 28 errors, **0 new**, passed. It shows the same one "fixed" baseline entry as Dev and SA (`app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | 49 files, 2 exempt, **0 violations**, passed |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144` and the placeholder env from `.github/workflows/build.yml`) | **Exit 0**, "Compiled successfully", **307/307** pages, 78 `DYNAMIC_SERVER_USAGE` lines (the same as Dev's). The log never mentions the new module |

#### SQL execution: my own run, in the order of §6.4.1

**Engine:** PGlite 0.5.8, which is PostgreSQL 18.3 in memory. It ran from an existing scratch install outside the repo. **Stubs**, the same shape as SA's and Dev's: the `anon`, `authenticated` and `service_role` roles (`service_role` has `BYPASSRLS`); Supabase-like default privileges (ALL on new tables and functions to all three roles); `auth.users`; `auth.uid()` read from `request.jwt.claims`; and `business_os_account_plans(user_id PK, period_anchor)` with `service_role` SELECT. The four repo files were read, not copied, and each was run **whole, in one go**, as the SQL editor sends it. **71 checks, 71 pass, 0 fail.**

| # | Step (§6.4.1) | Exact output |
|---|---|---|
| 2 | Pre-check (the query as written) | `charges null, totals null, record_fn null, period_fn null` |
| 3 | Migration | No error. The pre-check then returns all four names |
| 4 | Apply time | `SELECT now() AT TIME ZONE 'UTC'` returns one value |
| 5 | Checker | `VERDICT PASS 19 pass 0 fail`. All 21 check rows are PASS or INFO. C2 `24 of 28 columns readable and mismatches none`, `0 hidden columns readable`, `0 writable by authenticated and 0 reachable by anon`. C4 `12 of 12`, `0 checks name user_id`, 3 FKs, `2 of 2` indexes, `0 triggers`. C5 `2 invoker 2 pinned`, `client entries none`. C6 `9 of 9` and `9 of 9 in NZ`. C7 INFO reads **exactly** the runbook text: `0 charge rows and 0 totals rows and 0 detached rows and first row at none` |
| 6 | User id lookup by email | Returns the stub id |
| 7a | Probe, placeholder left in | `P0001 PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE with your own user id and run it again` |
| 7b | Probe, real id **with** a plan anchor (45 days ago) | `PROBE PASS  this error is expected and rolls everything back`, then P00 INFO and **P01–P22 all PASS** (22/22). P04: `period from plan starts 2026-09-15 04:03:37.415 utc`. Afterwards 0 charge rows and 0 totals rows |
| 7c | Probe, real id **without** a plan row | `PROBE PASS`; P01–P22 all PASS (22/22). P04: `period from calendar_month starts 2026-09-01 00:00:00 utc`. Afterwards 0 and 0 |
| 7d | Probe, an id that is not in `auth.users` | `PROBE SKIPPED  that user id is not an account on this database` |
| 8 | Checker again | `VERDICT PASS 19 pass 0 fail`; C7 still `0 charge rows and 0 totals rows …`. The session is back to `current_user = postgres` with empty JWT claims |
| — | Rollback on the empty ledger | No error. The step-2 pre-check then returns all four NULL again |
| — | Re-apply, then the checker | No error; `VERDICT PASS 19 pass 0 fail` |

**Failure paths**

| Case | Exact result |
|---|---|
| Migration pasted a second time | `42P07 relation "business_os_ai_charges" already exists`. The table ACLs are byte-identical before and after, and the checker still passes |
| Rollback with 2 charge rows present | `P0001 ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped`. All four objects remain, and 2 charges and 2 totals rows are intact |
| RPC as `service_role`, 22 bad inputs | NaN credits and NaN cost: `23514 …amounts_are_numbers`. Infinity: `22003 numeric field overflow`. Negative credits, negative cost, and `-0.0000006` (which rounds to `-0.000001`): `23514 …charge_shape`. Negative version: `23514 …version_not_negative`. `robot` trigger: `…triggered_by_known`. `maybe` outcome: `…outcome_known`. `Chat-Turn` and an empty action type: `…action_type_format`. NULL action, user or group id: `22004 business_os_record_ai_charge needs an action id a user id and a group id`. NULL action type, trigger or outcome: `…charge_shape`. NULL credits, cost, version or fallback flag: `23502 not-null`. A user id missing from `auth.users`: `23503 …user_id_fkey`. **The totals snapshot is byte-identical and the charge count unchanged after all 22.** The checker still passes, and C7 prints `first row at … utc` |
| Owner (`authenticated`, own claims) `select *` | `42501 permission denied` on both tables |
| Owner, column-list select, with 2 accounts holding charges | Charges: 1 row, their own. Totals: 1 row, their own. An account with no charges sees 0. Empty `sub`: 0 rows |
| Owner UPDATE of own totals, DELETE of own charges | Both `42501` |
| `anon`: SELECT on both tables, EXECUTE on both functions | All four `42501` |
| `authenticated`: EXECUTE on the record and period functions | Both `42501 permission denied for function …` |
| `service_role` direct UPDATE, DELETE and TRUNCATE on charges, and DELETE and TRUNCATE on totals | All five `42501`; the ledger is unchanged |
| **Session hygiene** (QA-added): the checker's `SET default_transaction_read_only = on` is left on the session, then the probe runs on the same session | `PROBE FAIL  P01 the record function raised 25006 cannot execute INSERT in a read-only transaction`. This fails safe, but see QA-N3 |
| **Paste mistakes** (QA-added): the id pasted with surrounding spaces, or pasted without its quotes | Both return `PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE …` (see QA-N4) |

The scratch instance and my script were deleted afterwards. Nothing was written into the repo.

#### Repository (item 3)

- **Never throws; returns `{ data, error }`.** Reading the code confirms it: a synchronous `rpc()` throw, a rejected promise and a PostgREST error all land in the one `catch` and come back as `{ data: null, error }`. There is a unit test for each case. The failure is logged at `warn` with ids only, as D-11 intends.
- **Strict row mapping.** Anything other than one object with a boolean `out_recorded`, a string `out_period_start` and an `out_anchor_source` of `plan` or `calendar_month` becomes an error, never a guess. An array of one and a bare object are both accepted. The SQL run confirms the real OUT names match: the probe reads `out_recorded`, `out_period_start` and `out_anchor_source`.
- **Arguments are built field by field.** The ten `p_*` arguments are built one at a time, with no spread (a test covers an input that carries extra properties). `kind` is hard-coded in SQL.
- **Abort signal.** `abortSignal(signal)` is chained only when a signal is given; both cases are tested.
- **No production caller.** I grepped `app lib components hooks scripts pages middleware.ts types config` (`.ts/.tsx/.js/.jsx/.mjs/.cjs`) for `BusinessOsAiChargeRepository`, `businessOsAiChargeRepository`, `business_os_record_ai_charge`, `BOS_RECORD_AI_CHARGE_RPC` and `business_os_ai_charge`. The hits are the repository, the barrel and its test, plus three registry files that name the tables only as **string keys** (`descriptors.ts`, `businessOwnedTables.ts`, `accountDeletionPolicy.ts`) and the deletion-policy test. Nothing calls the repository. The build log never mentions it.
- `console.*`: 0 in the repository and in the three touched registry files.

#### Lifecycle registrations (item 4)

| Registry | Found |
|---|---|
| `purge/descriptors.ts` | `never('business_os_ai_charges', U, …)` and `never('business_os_ai_charge_totals', U, …)`, both in `EXCLUDED` |
| `classification-baseline.json` | `count` 129 → **131**, and `levels` has 131 keys (checked by loading the file), both `never` |
| `businessOwnedTables.ts` | Both tables are in `USER_OWNED_TABLES`, **not** `BUSINESS_OWNED_TABLES` (§6.5). The suite that ties the migration to the registry is green |
| `accountDeletionPolicy.ts` | `business_os_ai_charges`: `minimise`, with a reason that names `ON DELETE SET NULL` and "no UPDATE". The totals table has no exception, so it takes the default `delete`. The new test pins all of this and passes |

Dev's negative control for `businessOwnedTables.test.ts` (red without the registration) was not repeated, because it would mean editing a production file. The suite being green, and its reading of the migration, were checked.

#### Runbook usability: §6.4.1 read as a non-DBA would (item 5)

On the whole the runbook is usable. Every step says what to paste and what to expect. The expected texts I could run (step 2 all NULL, the step 5 C7 INFO line, `PROBE PASS  this error is expected…`, `PROBE SKIPPED`, `ROLLBACK REFUSED…`, and the step 3 "second paste fails and changes nothing") match the real output **character for character**. The stop rules are explicit at steps 2, 5 and 7. What could still confuse a first-time reader:

1. **QA-N1: step numbers collide between §6.4 and §6.4.1** (Low; wording). The closing "Charging start" paragraph of §6.4.1 says "charging starts at the **step-6** moment" and "no row before the **step-2** apply time". Those are §6.4's table numbers. Inside §6.4.1, step 6 is "Your user id", step 2 is the pre-check, and the apply time is recorded at step **4**. §6.4.1 step 5 itself says "the step-4 apply time", which is correct locally. A reader following §6.4.1 will look at the wrong step. **Suggested fix:** in that paragraph write "§6.4 step 6 (the 3b-ii go-live)" and "the apply time recorded in step 4 above".
2. **QA-N2: Supabase's destructive-query warning is not mentioned** (Low; expectation). The probe contains `TRUNCATE` and `DELETE` statements (P10–P13, which are *expected* to be refused), and the rollback contains `DROP`. The Supabase SQL editor usually shows a "destructive operation" confirmation before running such a query. A non-DBA seeing that on the probe, a step described as safe, may abort or worry. **Suggested fix:** one sentence at step 7 (and at the rollback mention in step 5): "The editor may warn that the query contains destructive operations. That is expected here: confirm. The block raises at the end, so nothing it does is kept." *Not verified against the live editor; the harness cannot show UI dialogs.*
3. **QA-N3: the checker's read-only setting could carry over to the probe** (Low; fails safe). The checker begins with a session-level `SET default_transaction_read_only = on`. On a reused connection, that makes the step 7 probe fail with `PROBE FAIL  P01 the record function raised 25006 cannot execute INSERT in a read-only transaction` (reproduced above on one session). Whether the Supabase SQL editor reuses a session between runs is **not verified**. The same `SET` sits in the four earlier checkers under `scripts/`. It is safe: nothing is written, and step 7's rule sends the text to Dev. But it would stall C-1 for a non-DBA. **Suggested fix (either):** in step 7 add "If the text says `25006 … read-only transaction`, run `SET default_transaction_read_only = off;` and run the probe again". Or, in a later cycle, have the checkers use a transaction-scoped form (`BEGIN READ ONLY; … COMMIT;` or `SET LOCAL`). That would be a checker-convention change for SA.
4. **QA-N4: a malformed id gets a misleading message** (Low). An id pasted with surrounding spaces, or without the quotes, answers "replace PASTE_YOUR_OWN_USER_ID_HERE…" even though the user *did* replace it. The effect is safe (SKIPPED). **Suggested wording** for the SKIPPED text or step 7: "…paste only the id, between the quotes, with no spaces".
5. **QA-N5: P00 prints the plan anchor in the session time zone** (Low; cosmetic). The run printed `plan anchor 2026-08-15 06:03:37.415+02`, while P04 and C7 print UTC with a ` utc` suffix (S-1). It is INFO only, and no comparison depends on it. It is the same class as S-1: `(v_anchor AT TIME ZONE 'UTC')::text || ' utc'` would make it consistent.
6. **Minor wording.** "Paste into §15" assumes the reader knows §15 is this workplan's "Commit Info" section; naming it once would help. Step 5 also mixes the rollback instructions into the checker step. That is clear once read, but the step is long. Neither blocks anything.

#### Test Coverage

| Acceptance criterion (3b-i: §5.2.1, SA conditions) | Tested? | Result | Notes |
|---|---|---|---|
| The migration applies in one transaction; the names are free first | ✅ | Pass | Steps 2–3 executed |
| Checker `VERDICT PASS`, C7 empty (§6.3) | ✅ | Pass | 19/0; the exact C7 text |
| C-1: the probe is mandatory and passes P01–P22 for both account shapes, and keeps nothing | ✅ | Pass | Both shapes 22/22; 0 rows after; checker still passes (C-1 (d)) |
| C-2: no OUT-name clash (42702) | ✅ | Pass | Executed with no 42702; the repository maps `out_*` |
| C-3: totals invariant and rebuild | ✅ | Pass | P02, P05, P06; C7 after real rows and after 22 refusals |
| C-4: column grants; cost and fallback columns hidden | ✅ | Pass | Owner `select *` gets 42501; column list returns own rows only; P16–P19 |
| SA-S8: owner SELECT only, service_role EXECUTE only, no client write | ✅ | Pass | The anon, authenticated and owner write paths all get 42501 |
| No direct UPDATE, DELETE or TRUNCATE of the ledger, even by service_role | ✅ | Pass | 5/5 get 42501 |
| Bad input refused with no total moved | ✅ | Pass | 22 cases |
| S-1: C7 time printed in UTC | ✅ | Pass | `first row at … utc` |
| S-2: rollback refuses a live bill; drops an empty ledger; re-apply works | ✅ | Pass | Executed both ways |
| B-1: the probe compiles | ✅ | Pass | Every probe run compiled and executed |
| Repository: never throws, `{data, error}`, strict mapping, signal, no caller | ✅ | Pass | 21 tests plus code read plus grep |
| Lifecycle: `never` ×2 (131), USER_OWNED ×2, charges `minimise` / totals `delete` | ✅ | Pass | Registry suites green |
| Nothing new at runtime (unwired) | ✅ | Pass | grep plus build log |
| §6.4.1 usable by a non-DBA | ✅ | Partial | Usable; notes QA-N1 to QA-N5 |
| Concurrency (N-6) | ⚠️ | Not run | PGlite has one connection; SA's reasoning stands |
| Real Supabase roles, grants and editor behaviour | ⚠️ | Not run | By design this is the PROD probe (§6.4.1 step 7), after QA |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. The RPC is one insert plus one upsert on a primary key; no index is missing for the write path.

**Edge cases (nice to fix; none blocks):** QA-N1 to QA-N5 above. N1–N4 are wording in §6.4.1 or in a message and can be folded in before the user runs the PROD steps. N3 concerns every checker in `scripts/`, so a code-side change there is SA's call. N5 is cosmetic.

#### No code or SQL file changed during QA

sha256 of all 14 changed paths other than this workplan was taken before the run and again after it: **identical**. Examples: migration `41247de1…c7ba`, probe `bc747a1a…bea4`, checker `5a9f134a…d546ae052`, rollback `d084681a…10cea`, repository `e016b9eb…1c1e4`. `git status --short` shows the same 8 modified and 7 untracked paths as at the start. Only this workplan grew.

#### Final Status
- [x] All 3b-i acceptance criteria pass: ready for the user's diff review. The PROD steps (§6.4.1) then run by the user, and 3b-ii waits for the step 7 output in §15
- [ ] Issues found: Dev must address before commit

**Verdict: PASS WITH NOTES.** There are no bugs. The five notes are runbook wording and one cosmetic INFO format, and none of them blocks the user's diff review. QA-N1 to QA-N4 are best folded into §6.4.1 before the user runs it on PROD.

### QA re-test — neutral ledger (2026-09-29)

**QA — 2026-09-29** · **Test mode:** focused re-test (full on the changed surface) · **Strategy used:** A (Jest guards, repository, lifecycle registries) + C (my own script running the real SQL files on a throwaway in-memory PGlite, §6.4.1 in order, then failure paths) + a non-DBA read of §6.4.1 · **Focus:** schema, security, api (repository) · **Skipped:** D (no UI in 3b-i) · **Input source:** TL's QA brief. Worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-3b-i` @ `ef3da3bf` + the uncommitted changes. **No real database touched.** Run against the files as they stand **before** SA's S-3 text fix (§13 re-check); S-3 is comment text only.

#### Commands and numbers

| Gate | Result |
|---|---|
| `npx jest` migration guard + repository + `lib/business-os/purge` + `lib/business-os/account` + `lib/business-os/llm` + `lib/business-os/entitlements` + `businessOwnedTables.test.ts` + `entitlementSqlScripts.guard.test.ts` | **58 suites, 1,591 tests, all green** (migration guard + repository alone: 112 = 90 + 22) |
| `npm run typecheck:bos-llm` | 299 files, 28 errors, **0 new**, passed (same one "fixed" baseline entry) |
| `npm run check:bos-llm-literals` | 49 files, 2 exempt, **0 violations** |
| `next build` (6 GB heap, the CI placeholder env from `build.yml`) | **Exit 0**, "Compiled successfully", 307/307 pages, 78 `DYNAMIC_SERVER_USAGE` lines (as before) |

#### SQL execution: my own run (PGlite 0.5.8 = PostgreSQL 18.3, in memory, outside the repo; session `TimeZone = Asia/Jerusalem`)

Supabase stubs: roles `anon` / `authenticated` / `service_role` (BYPASSRLS), `auth.users`, `auth.uid()` from `request.jwt.claims`, `business_os_account_plans`, and permissive default privileges (so a missing REVOKE would show). The pre-check, the step 4 and step 6 queries and the `RESET` line were **extracted from this workplan's §6.4.1 text** by the script, not retyped. **97 of 97 checks pass.**

| # | Step / path | Exact output |
|---|---|---|
| R2 | Pre-check as written (11-arg signature) | `{"charges":null,"totals":null,"record_fn":null,"period_fn":null}`; after apply all four resolve, `record_fn` = `business_os_record_credit_charge(uuid,uuid,uuid,text,text,text,text,numeric,numeric,integer,boolean)` |
| R3–R4 | Migration; apply-time query | No error; `applied_at_utc` returned |
| R5 | Checker | `VERDICT PASS 19 pass 0 fail`, every row PASS or INFO; C2 `25 of 29 columns readable and mismatches none`; C4 `13 of 13`; C6 `9 of 9` and `9 of 9 in NZ`; C7 INFO exactly `0 charge rows and 0 totals rows and 0 detached rows and first row at none` |
| R6 | `SELECT id FROM auth.users WHERE email = …` | the owner's id |
| R7 | Probe in the checker's tab | `PROBE SKIPPED  this session is read only …`; the runbook's `RESET default_transaction_read_only;` runs on its own |
| R7 | Placeholder left in (line 3 holds `'PASTE_YOUR_OWN_USER_ID_HERE'`) / id with a leading space / unknown account | `PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE …` / `PROBE SKIPPED  the pasted value is not a valid user id …` / `PROBE SKIPPED  that user id is not an account on this database` |
| R7 | Probe, account **with** a plan anchor | `PROBE PASS  this error is expected and rolls everything back`; P00 INFO `plan anchor 2025-01-31 10:00:00 utc`; 25 PASS, 0 FAIL, order `…P07,P08,P08A,P08B,P08C,P09…` as step 7 says; P03 `stored with service ai`; P04 `period from plan starts 2026-08-31 10:00:00 utc`; nothing kept |
| R7 | Probe, account **without** a plan row | `PROBE PASS`; 25 PASS; P04 `period from calendar_month starts 2026-09-01 00:00:00 utc`; nothing kept |
| R8 | Checker again | `VERDICT PASS`; C7 still `0 charge rows and 0 totals rows …` |
| F1 | Migration pasted a second time | `42P07 relation "business_os_credit_charges" already exists`; constraint / function / policy / index counts identical before and after (39 / 2 / 2 / 5) |
| F2 | As `service_role`: an `ai` charge (owner, 1.25) + a `notification_email` charge (scheduled, 0.5) + a 64-character service (boundary) | All `out_recorded = true`, same period; repeat of the `notification_email` id → `false`; **one** totals row: `charge_count 3`, `credits_total 1.750000`, `credits_owner 1.250000`, `credits_scheduled 0.500000`; each row stores its own `service` |
| F3 | **28 bad RPC inputs** | NULL action / user / group / **service** → `22004`; service `Notification Email`, `1email`, `notification-email`, empty, 65 chars, `_ai`, `aïb` → `23514 … service_format`; action_type `ChatTurn` → `action_type_format`; NULL action_type / triggered_by / outcome, negative credits / cost → `charge_shape`; unknown trigger / outcome → `…_known`; NaN credits / cost → `amounts_are_numbers`; negative version → `version_not_negative`; NULL credits / cost / version / `is_fallback_priced` → `23502`; unknown user → `23503`; credits `1e13` → `22003`. Ledger **and** totals byte-identical (JSON snapshot) after all 28 |
| F4 | Direct INSERTs as the table owner | Adjustment carrying `service = 'ai'` → `23514 adjustment_shape`; the same adjustment without a service is accepted (control, then removed); a charge row without a service → `23514 charge_shape` |
| F5 | **23 permission refusals, all `42501`** | `anon`: SELECT charges (incl. `service`) and totals, EXECUTE both functions. `authenticated` (owner JWT): EXECUTE both functions, INSERT / UPDATE / DELETE charges, UPDATE totals, `SELECT *` on both tables, `cost_usd`, `is_fallback_priced`, `cost_usd_total`, `fallback_priced_count`. `service_role`: UPDATE charges (`credits`, `service`), DELETE / TRUNCATE both tables. Ledger unchanged |
| F6 | Owner reads | The owner reads `service`, `action_type`, `credits`, `credit_value_version`, `triggered_by`, `group_id` on their 3 rows, and their one totals row (`credits_total`, `charge_count`); another account sees 0 charge and 0 totals rows; `authenticated` with no `sub` sees 0; `service_role` SELECT works |
| F7 | Checker with rows of three services | `VERDICT PASS 19 pass 0 fail`; C7 `3 charge rows and 1 totals rows and 0 detached rows and first row at … utc` (rebuild = totals) |
| F8 | Rollback with rows | `P0001 ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped`; all four objects and every row byte-identical |
| F9 | Rollback on an emptied ledger; re-apply | Drops all four (pre-check all NULL again); migration re-applies; checker `VERDICT PASS` |

Harness note (not a product finding): my first `auth.uid()` stub cast an empty claims string straight to `jsonb` and raised `22P02`; Supabase's own `auth.uid()` wraps it in `nullif(…, '')`. Aligned the stub; the case then returned 0 rows.

#### Old names (item 3)

`grep -rnI` over the worktree (excluding `node_modules`, `.next`, `.git`) for `business_os_ai_charge`, `BusinessOsAiCharge`, `record_ai_charge`, `ai_period_start`, `bos-ai-charges`, `business-os-ai-charges`: **78 hits in 2 files, none in code, SQL, tests or scripts, no old-named file.**
- `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`: 4 hits, all on line 250, the 2026-09-29 Change History row's old → new map.
- This workplan: 74 occurrences (before this subsection, which adds 6 by naming the search terms), all historical or map text: §3.1 rename note (5), §5.2.1.2 old → new map and leftover-names row (12), §11 Q-12 with its "Renamed" note (2), §13 (29: the old → new banner, the 2026-09-28 review, the 3b-i code review and Dev fixes), §14 (19: the first 3b-i QA report), §16 older rows and old → new maps (7). None in §2, §4, §6 to §10.
- `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md`: **0** hits now.

#### Runbook §6.4.1 read as a non-DBA (item 4)

Usable as written with the new names. Every file path exists; the pre-check uses the 11-argument signature and runs as pasted (extracted and executed above); the §6.2 SQL block equals the rollback file line for line (blank lines aside); step 7's "third line", the three SKIPPED answers and the P08A–C placement all match what the probe prints; step 5's C7 text is exact. Three notes, none blocking:
1. **QA-N6** (Low, wording): step 3 says a second paste "fails at the first `CREATE TABLE` and changes nothing" but not what the user will see. Suggest adding the literal text `relation "business_os_credit_charges" already exists` so a double paste is recognised rather than escalated.
2. **QA-N7** (Low, wording): step 6's `'<your login email>'`: say "replace `<your login email>`, angle brackets included, keeping the quotes"; a non-DBA may leave the brackets and get zero rows.
3. **QA-N8** (cosmetic): `BUSINESS_OS_ENTITLEMENTS.md` Change History has the 2026-09-29 row above a 2026-09-28 row (lines 250–251), out of date order.

#### Test Coverage

| Acceptance criterion (neutral-ledger change) | Tested? | Result | Notes |
|---|---|---|---|
| Objects renamed to `business_os_credit_*`, no old name in code / SQL | ✅ | Pass | Grep: docs history and maps only |
| `service` required on charges, NULL on adjustments, format CHECK (no enum) | ✅ | Pass | F3, F4; 1 and 64 chars accepted, 65 refused |
| RPC `p_service`, NULL refused `22004` | ✅ | Pass | F3; repository sends the same 11 named `p_*` args as the SQL signature |
| One credit pool: `ai` + `notification_email` in one totals row | ✅ | Pass | F2; probe P08A |
| Owner reads `service`, never the cost columns | ✅ | Pass | F5, F6; checker C2 `25 of 29` |
| Permissions: anon / authenticated / service_role | ✅ | Pass | F5 (23 × `42501`) |
| Bad inputs leave totals unchanged | ✅ | Pass | F3 (28 cases, byte-identical) |
| Idempotent on action id | ✅ | Pass | F2 repeat, P01–P02 |
| Second migration paste harmless | ✅ | Pass | F1 |
| Rollback refuses with rows; drops when empty; re-apply | ✅ | Pass | F8, F9 |
| Runbook §6.4.1 in order, pre-check as written | ✅ | Pass | R2–R8; notes QA-N6 to N8 |
| Lifecycle registrations / repository | ✅ | Pass | Jest purge, account, `businessOwnedTables`, repository 22 |
| Real Supabase roles, grants, editor | ⚠️ | Not run | By design: the PROD probe, §6.4.1 step 7, after QA |

#### Issues Found

**Bugs:** none. **Performance:** none. **Edge cases:** QA-N6 to QA-N8 (wording / cosmetic). **Pending from SA (not QA's):** S-3 changes the `is_fallback_priced` comment in the migration, the repository comments, the doc and one test regex. It changes no schema, grant or behaviour, so these results stand; after it, re-run the migration guard test and confirm the migration still applies (one harness run, about a minute).

#### No code or SQL file changed during QA

sha256 of all 13 changed or new non-doc paths, taken before the run and again after it: **identical**. Examples: migration `61d0ac96…1127765`, probe `c36ebf42…ab92`, checker `9afe2196…0af0a2`, rollback `d69d8cb9…f130af0a2`, repository `02239b9d…fe6`. `git status --short` unchanged. Only this subsection and one §16 row were written; the harness lives in the session scratchpad.

#### Final Status
- [x] All acceptance criteria of the neutral-ledger change pass: ready for the user's diff review once SA's S-3 text fix is in. The PROD steps (§6.4.1) then run by the user
- [ ] Issues found: Dev must address before commit

**Verdict: PASS WITH NOTES.** No bugs. QA-N6 and QA-N7 are one-line runbook wording, best folded in with S-3 before the PROD apply.

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
| 2026-09-29 | 3b-i implemented (Dev) | Migration `20261014_business_os_ai_charges.sql` (charge table with a `kind`, totals table with the C-3 CHECK and column semantics, owner-only column-level SELECT, `SECURITY INVOKER` period function and write RPC with `out_*` OUT columns), rollback, read-only checker C1–C8, the **mandatory** write probe P00–P22 (one `DO` block that always raises), a 73-test SQL guard, `BusinessOsAiChargeRepository` (one RPC method, no caller, a source guard) with 21 tests, purge / ownership / deletion registration (charges `minimise`, totals `delete`), the entitlements doc metering section and the Q-4 mode note. §6.3 rewritten, §6.4.1 exact PROD steps. Gates and deviations D-7 to D-14, flags F-1 to F-4 in §5.2.1.1. Uncommitted; nothing applied to any database |
| 2026-09-29 | SA code review — 3b-i | **Fix Required: one Blocking, conditional QA.** The SQL was executed for the first time, on a throwaway PGlite (PostgreSQL 18.3, in memory, outside the repo, with Supabase role, auth and plan-table stubs). The migration applies. The checker gives `VERDICT PASS 19/0`. The RPC is idempotent with no 42702, rounds once, and keeps the totals equal to the rebuild. The period function is correct at month end, in a leap year, exactly at the anchor and in three time zones. Every CHECK and grant boundary holds. The rollback is clean and the migration re-applies. **B-1:** the probe does not compile (`42601`, `CASE WHEN … THEN` inside an `IF … THEN` at line 126). Parenthesised in a scratch copy, it passes P01–P22 for an account with a plan anchor and for one without, and leaves nothing behind. Should-fix: S-1 (the C7 `first row at` time prints in NZ, not UTC) and S-2 (the rollback should refuse when the ledger holds rows). F-1 ruled: `SECURITY INVOKER` stays (drift is caught by C7; revisit at enforcement). F-2 and F-3 accepted or closed; D-7 to D-14 accepted. Gates: 7 suites and 176 tests green; `typecheck:bos-llm` 0 new. QA may start once B-1 is fixed with a guard test and the fixed probe has executed once on a throwaway Postgres |
| 2026-09-29 | SA fixes — 3b-i (Dev) | **B-1:** the probe's `CASE` in the P04 `IF` condition is parenthesised; the only such case across the probe, checker, rollback and both function bodies. New guard `bareCaseInIfConditions` in the migration test, red on the old line and then green, with a negative control. **S-1:** the checker's C7 `first row at` is printed `AT TIME ZONE 'UTC'` with a ` utc` suffix, pinned by a test. **S-2:** the rollback locks the charge table and refuses (`ROLLBACK REFUSED  the ledger holds charge rows so nothing was dropped`) when it holds any row, pinned by a test; §6.2 and §6.4.1 step 5 are reworded. All three were executed on a throwaway in-memory PGlite: 20 of 20 harness checks pass, and the probe gives `PROBE PASS` with P01–P22 for both account shapes. Migration test at 81 tests; the SA gate set is 7 suites and 184 tests, all green; `typecheck:bos-llm` 0 new. SA's conditions to go to QA (1)–(3) are met. Uncommitted; no real database touched |
| 2026-09-29 | QA report — 3b-i | **PASS WITH NOTES.** Jest: 57 suites, 1,511 tests green (SA set 7/184; migration guard 81, repository 21). `typecheck:bos-llm` 0 new; literals 0 violations; `next build` exit 0 (307 pages). My own run of the real SQL files on a throwaway in-memory PGlite (PostgreSQL 18.3), in §6.4.1 order: 71 of 71 checks pass. Pre-check all NULL → migration → checker `VERDICT PASS 19 pass 0 fail` with the exact C7 text → probe SKIPPED with the placeholder, `PROBE PASS` P01–P22 for an account with a plan anchor and one without, nothing kept → checker still passes → rollback drops all four → re-apply passes. Failure paths: a second paste fails 42P07 and changes nothing; the rollback refuses with rows present; 22 bad RPC inputs are refused with the totals byte-identical; owner `select *` gets 42501 and a column list returns own rows only; anon, authenticated EXECUTE and service_role UPDATE, DELETE and TRUNCATE all get 42501. Repository and lifecycle registrations verified; no caller. No bugs. Notes QA-N1 to QA-N5: §6.4 vs §6.4.1 step-number collision; the Supabase destructive-query warning is not mentioned; the checker's session read-only setting could make the probe report 25006 (fails safe); a misleading SKIPPED text for a malformed id; P00 prints the anchor in the session zone, not UTC. No code or SQL file changed by QA (hashes) |
| 2026-09-29 | QA notes fixed — 3b-i (Dev) | **QA-N1:** §6.4.1's "Charging start" paragraph now names the apply time "recorded in step 4 above" and the go-live as "§6.4 step 6", not §6.4's bare step numbers. **QA-N2:** step 7 says the editor may warn about destructive operations (`TRUNCATE`, `DELETE`) and to confirm, because the block always rolls back; step 5's rollback mention says to confirm the `DROP` warning only when Dev has said to run it. **QA-N3:** a transaction-local override inside the `DO` block is not possible (executed: `SET LOCAL transaction_read_only = off` gives `25001 transaction read-write mode must be set before any query`; `SET LOCAL default_transaction_read_only = off` leaves the running transaction read-only, `25006`). So the probe now checks `current_setting('transaction_read_only')` before any role switch or write and raises `PROBE SKIPPED  this session is read only  open a new SQL editor tab or run RESET default_transaction_read_only on its own and run the probe again`; step 7 says to run the probe in a new tab and what to do on that message. The checkers are unchanged (a checker-convention change stays SA's call). **QA-N4:** the placeholder is detected first by `position('YOUR_OWN_USER_ID' IN v_owner_text)` (so a find-and-replace-all of the placeholder still works); a failed uuid cast now says `PROBE SKIPPED  the pasted value is not a valid user id  paste only the id between the quotes with no spaces and run it again`; step 7 lists the three SKIPPED answers and their fix. **QA-N5:** P00 prints the anchor `AT TIME ZONE 'UTC'` with a ` utc` suffix; §6.3 P00 row updated. D-8 paste rules kept (the guard suite checks every literal). Three new guard tests (N3, N4, N5): migration guard **84** tests, all green. Throwaway in-memory PGlite (PostgreSQL 18.3), Asia/Jerusalem session zone: **22 of 22** checks pass: checker then probe on the same session gives the read-only SKIPPED and writes nothing, `RESET` clears it; placeholder gives the replace message; spaces, not a uuid, truncated, empty and unquoted ids give the not-a-valid-user-id message; an unknown account still gives its own message; a replace-all run passes; `PROBE PASS` P01–P22 for an account with a plan anchor and one without, nothing kept; P00 `plan anchor 2025-01-31 10:00:00 utc`; checker still `VERDICT PASS`. `typecheck:bos-llm` 0 new. Uncommitted; no real database touched |
| 2026-09-29 | 3b-i made service-generic (Dev) | **User decision: the ledger is not AI-specific** — one credit pool for every chargeable action, AI or not. Renamed `business_os_ai_charges` → `business_os_credit_charges`, `business_os_ai_charge_totals` → `business_os_credit_totals`, `business_os_record_ai_charge` → `business_os_record_credit_charge`, `business_os_ai_period_start` → `business_os_credit_period_start`, the four SQL files, the migration test and `BusinessOsAiChargeRepository` → `BusinessOsCreditChargeRepository` (+ barrel, lifecycle registries, entitlements doc). Added `service` (charge NOT NULL, adjustment NULL, format CHECK not an enum, owner-readable), `p_service` on the RPC, `service` on the repository input; `is_fallback_priced` commented as AI-specific; `group_id` stays required for every charge. Totals unchanged (one row per account and period). Probe P08A–P08C. PGlite in §6.4.1 order 28/28; SA's Jest set 7/194 (guard 90, repository 22); 58 suites / 1,591 tests; typecheck 0 new; literals 0; `next build` exit 0 (307 pages). §13 and §14 keep their text with an old → new note (§5.2.1.2) |
| 2026-09-29 | SA re-check — neutral ledger | **Code Approved (re-check); S-3 must be fixed before the PROD apply.** SA diffed the pre-rename migration, after the same rename, against the current one: the only change is `service` (the column, both shape CHECKs, the format CHECK, comments, the owner grant, and `p_service` with its 11-argument signature). C-1 to C-4, SF-1, B-1, S-1, S-2, QA-N1 to N5 and D-8 are intact. SA re-ran Dev's PGlite harness (28/28) and an own run: named-argument RPC calls; the service format at 1 and 64 characters accepted and 65 refused, along with `_ai`, `AI`, a trailing space, non-ASCII, a hyphen and the empty string; an adjustment inherits its service through the self-FK; one totals row across services. **S-3:** the `is_fallback_priced` text ("AI specific, false for every other service") in the migration comment, the repository and the entitlements doc contradicts the requirement, which lets a service define its own documented fallback. Make it neutral before the apply, and update the test regex with it. Notes: N-9 (leaving the flag unenforced for non-AI is accepted: enforcing it would name `'ai'`), N-10 (slice 4 must read the effective service `COALESCE(row, adjusted)`, and BA should reword FR-33 and slice 4), N-11 (an action type is scoped by its service; BA should add a line to the future-service rules), N-12 (the `22004` for `p_service` accepted), N-13 (no AI term in a neutral name), N-14 (registrations and §6.4.1 correct). **SQ-18 ruled:** Dev's shape as built (charge-required, adjustment-NULL, `^[a-z][a-z0-9_]{0,63}$`, 1–64; no enum, lookup or registry; the RPC checks NULL only; ids are permanent). New condition **C-6** for 3b-ii: `'ai'` comes from one exported constant. SQ-17 noted for slice 5. Jest 7/194 green; `typecheck:bos-llm` 0 new |
| 2026-09-29 | QA re-test — neutral ledger | **PASS WITH NOTES, no bugs.** Jest 58 suites / 1,591 tests green (guard 90 + repository 22); `typecheck:bos-llm` 0 new; literals 0 violations; `next build` exit 0 (307 pages). My own in-memory PGlite (PostgreSQL 18.3) run, §6.4.1 in order with the pre-check, step 4 / step 6 queries and `RESET` line extracted from this workplan: **97 of 97**. Pre-check (11-arg) all NULL → apply → checker `VERDICT PASS 19 pass 0 fail` (C2 `25 of 29`) → read-only / placeholder / bad-id / unknown-account SKIPPED texts → `PROBE PASS` with P08A–C after P08 for both account shapes, nothing kept → checker still empty. Failure paths: second paste `42P07`, nothing changed; 28 bad RPC inputs refused (NULL service `22004`, 7 malformed services `service_format`) with ledger and totals byte-identical; adjustment carrying a service → `adjustment_shape`; 23 `42501` refusals across anon / authenticated / service_role; the owner reads `service` but no cost column; `ai` + `notification_email` land in one totals row; rollback refuses with rows (`P0001`), drops when empty, re-applies. Old-name grep: 78 hits, only the entitlements doc's Change History map and this workplan's historical / map text; 0 in code, SQL, tests, the requirement. Notes QA-N6 (step 3: show the 42P07 text), QA-N7 (step 6: replace the angle brackets too), QA-N8 (entitlements Change History order). Results predate SA's S-3 comment fix; re-run the guard test after it. Hashes of the 13 non-doc paths identical before and after; no code or SQL changed |
| 2026-09-29 | S-3, N-14, QA-N6 to N8 fixed — 3b-i (Dev) | **S-3:** the `is_fallback_priced` text is service-neutral in the migration's column comment ("True when the cost was priced from a fallback rate rather than the measured one  AI sets it when a model is missing from the price table  another service sets it only if it defines its own documented fallback and otherwise records false  False on adjustment rows  Hidden from owners"; D-8 literal rules kept), the repository header and `isFallbackPriced` doc, and the entitlements doc's Metering table; the migration test's title and regexes now pin the neutral text and refuse `AI specific` / `every other service`. No schema, grant or behaviour change. **N-14:** §6.1's outline uses `business_os_credit_charges_owner_select` / `business_os_credit_totals_owner_select` and `(SELECT auth.uid()) = user_id`, as the file does. **QA-N6:** §6.4.1 step 3 names the second-paste error, `relation "business_os_credit_charges" already exists` (executed: `42P07`, table intact). **QA-N7:** step 6 says to replace `<your login email>` angle brackets included, keeping the quotes. **QA-N8:** the entitlements doc's 2026-09-28 "Importing the module" row now precedes the 2026-09-29 Metering row (only that pair moved; older rows in that table are also out of date order, pre-existing, left as they are to avoid conflicts with other branches). Migration guard + repository tests **112/112** green; `typecheck:bos-llm` 0 new; throwaway in-memory PGlite harness **28/28** (pre-check, apply, checker `VERDICT PASS`, probe with a valid id `PROBE PASS` P01–P22 and P08A–C, nothing kept, rollback refuse/drop, re-apply), and the stored column comment read back matches. Uncommitted; no real database touched |
| 2026-09-29 | Migration date moved to 20261015 (TL) | RM's pre-commit guard found `20261014_business_os_invite_signup.sql` on `origin/main` (PR #139). Migration and rollback renamed to `20261015_business_os_credit_charges*`; references updated in the repository header, the migration test, the requirement, the entitlements doc and this workplan's live text (historical review text keeps the date it was written with). No SQL content changed |
