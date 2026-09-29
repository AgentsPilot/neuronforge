# Workplan: Business OS Credit Deduction — Slice 2 (No $0 cost)

> **Last Updated**: 2026-09-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §3 "Reusing what exists" (gap (e)), §4 "The three records", §12 **Slice 2 — No $0 cost** (scope and guardrails), FR-11, FR-12a, b (mechanism), e, f, g, h, AC-3, AC-29, KI-8, KI-9, and the SA rulings SQ-8, SQ-9, SQ-13, SQ-14, SQ-16 plus the SA follow-up (2026-09-28).
**Supersedes (in part):** [BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md) §2.2–§2.5 (the cost half of D-0). Its verified facts and its SA workplan review (conditions C-1 to C-3, rulings Q-1 to Q-9, should-fix S-1 to S-5) are reused and cited as "D-0 C-1", "D-0 Q-1" and so on. **Where the requirement and the SQ-13 / SQ-14 / SQ-16 rulings differ from D-0, they win** (§2.0 lists every difference).
**Branch:** `feature/business-os-credit-deduction-slice-2` (worktree `neuronforge-llm-deduction`), off `main` at `3941327f` (after slice 1's PR #130 and PR #129 merged). The branch was created before this workplan, not by Dev (S-6).
**Date:** 2026-09-28
**Status:** SA code review ✅ APPROVED (2026-09-28): code approved for QA; SF-1 done by Dev and verified by SA from the diff, no conditions outstanding; nothing is committed

## Overview

Slice 2 makes the cost figure trustworthy **before** slice 3 starts charging on it. Under option B the measured cost *is* the charge, so a silent $0 would give an action away and a rounded-away cost would do the same for small actions.

It does four things, and adds no charging, no table, no migration and no call-site change:

1. **A price signal on every OpenAI call record.** The in-process record of each call (`UsageCallRecord`) gains an optional "priced / unpriced" flag, from a **separate, read-only price lookup** over the same table. No shared pricing function returns anything new, and `token_usage` records exactly what it records today (SQ-13).
2. **The conservative fallback, pure and unwired.** A Business OS function that prices an action for a charge: the measured cost where the call was priced, the highest in-code rate for the same provider and kind where it was not, flagged. An **absent** signal is re-checked against the table, never assumed unpriced (SQ-13 (2)). Slice 3 wires it.
3. **The audit entry stops rounding cost away.** 10 decimal places instead of a micro-dollar, still `schema: 1`, no backfill; the admin audit-trail screen shows the extra precision (SQ-14, the one named UI exception).
4. **Price-coverage tests** for every code-default model, every default image size × quality, and the default embedding model (SA-S2, FR-12e), reusing the Layer 2 tests that already exist.

The failed-call $0 (SA N-3) is **not** changed: the provider reports no usage on an error, so `baseProvider.ts`'s failure path stays as it is (SQ-16, KI-8 accepted).

**Must not change what the agent platform is charged or records.** §5.3 is the proof plan.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Task List](#4-task-list)
5. [Test Plan](#5-test-plan)
6. [Guardrails and Out of Scope](#6-guardrails-and-out-of-scope)
7. [Risks](#7-risks)
8. [Estimate](#8-estimate)
9. [Open Questions for SA](#9-open-questions-for-sa)
10. [Flagged Items (console.* and deprecated code)](#10-flagged-items-console-and-deprecated-code)
11. [SA Workplan Review](#11-sa-workplan-review)
12. [QA Testing Report](#12-qa-testing-report)
13. [Commit Info](#13-commit-info)
14. [Change History](#14-change-history)

---

## 1. Analysis Summary

Every path, line and function below was checked in this worktree at `fc1856bd`, and re-verified at `3941327f` by SA (no cited file changed).

| Concern | As-built | Evidence |
|---|---|---|
| Shared token pricing | `calculateCostSync` looks up the cache, then the in-code `FALLBACK_PRICING`, else **warns and returns 0**. `calculateCost` (async) does the same. `FALLBACK_PRICING` is **not exported**. The lookup itself is 10 lines inside `calculateCostSync` | `lib/ai/pricing.ts:29` (table), `:220-243` (`calculateCost`, warn `:229`), `:250-275` (`calculateCostSync`: lookup `:256-265`, warn `:268`) |
| Input-only models | `isInputOnlyPricedModel(provider, model)` is exported: OpenAI `text-embedding-*` | `lib/ai/pricing.ts:114-116` |
| An existing accessor that is **not** reusable here | `listPricedModels()` is async, loads the DB, and **drops** any in-code entry that the DB overrides, so it cannot answer "highest **in-code** rate" (SQ-9) | `lib/ai/pricing.ts:337-387` |
| The per-call record | `UsageCallRecord`: feature, component, provider, model, sessionId, tokens, `costUsd`, success, errorCode. No price-status field. `notifyUsage` stores a shallow copy (`{ ...call }`) | `lib/ai/usageScope.ts:37-53`, `:121` |
| Who opens a usage scope | Only `runAiAction`. The agent platform never opens one, so a scope record never reaches it | `grep withUsageScope`: `lib/ai/usageScope.ts`, `lib/business-os/llm/aiActionAudit.ts:399` |
| Where the record is built | `BaseAIProvider.callWithTracking`: success `notifyUsage` `:112-122` from `extractMetrics` (type `:83-95`), then `trackAICall` `:125-161`, whose fields are picked one by one (no spread of `metrics`). Failure: `notifyUsage` with `costUsd: 0` `:164-177`, then the failure `trackAICall` `:181-206` | `lib/ai/providers/baseProvider.ts:77-209` |
| OpenAI cost paths | Chat `:206-229` and embeddings `:254-273` call the private `calculateCost` (`:551-572`, which already prices cached input at half rate, KI-9) → `calculateCostSync`. Image `:299-318`: `cost: priceFor(result.quality) * params.n` | `lib/ai/providers/openaiProvider.ts` |
| Image pricing | `resolveImagePrice`: config > 0, then `IMAGE_FALLBACK_PRICING`, then `{ 0, 'unpriced' }` with an `error` log. `imagePriceResolver` returns 0 if it throws. The provider sees only the number, not the source | `lib/services/GeneratedImageService.ts:94`, `:102-118`, `:143-176` |
| Image defaults and fallback prices | `IMAGE_GENERATION_CONFIG_DEFAULTS` (`gpt-image-1`, three sizes, quality `auto`); `IMAGE_FALLBACK_PRICING`, 9 keys, $0.011–$0.25 | `lib/repositories/SystemConfigRepository.ts:46-51`, `:68-78` |
| Layer 2 code defaults, already tested as priced | `BOS_LLM_CALL_POLICY` (every configurable call, `kind: 'token' \| 'image'`). **`modelSettingsPolicy.test.ts` already proves** every token default passes the DEC-7 price guardrail (`> 0` both sides) and every default image size × low/medium/high has a fallback price > 0 | `lib/business-os/llm/modelSettingsPolicy.ts:192-254`, `:281`; `lib/business-os/llm/__tests__/modelSettingsPolicy.test.ts:342-375`; guardrail `lib/business-os/llm/modelSettings.ts:281-327` |
| The one uncovered default | The embedding default behind the four excluded chat calls is a literal default of `helpbot_embedding_model`, written twice, not exported | `lib/services/EmbeddingService.ts:112-115`, `:169-172`; exclusion `modelSettingsPolicy.ts:96-101` |
| Audit-entry rounding | `estimatedCostUsd: Math.round(cost * 1e6) / 1e6` (comment: float noise). Field type `number` | `lib/business-os/llm/aiActionAudit.ts:318-319`, `:235`; `runAiAction` `:387-412` |
| Tests that pin the micro-dollar rounding | `:152` expects `0.003502` for a 0.0035024 sum (**changes**); `:159-171` asserts the value is within 5e-7 **and** `not.toBe(exact)` (**changes**); `:406` expects `0.3` (still passes). SQ-14 cited `:167-168` and `:403`; the lines moved with slice 1's additions, and `:152` is a third pin SQ-14 did not name | `lib/business-os/llm/__tests__/aiActionAudit.test.ts` |
| Other readers of the audit field | `app/api/website/media/generate/__tests__/route.attribution.test.ts:178`, `:199` (`0.063`, one call: unchanged at 10 dp); `app/api/cron/insight-detect/__tests__/route.audit.test.ts:288` (`> 0`: unchanged). Every other `estimatedCostUsd` in the repo is a **different** field on `token_usage` reports | repo-wide grep |
| The admin cost formatter | `asUsd` = `toFixed(6)`, comment "stored rounded to a micro-dollar". Page is `'use client'`, 0 `console.*`, and has a jsdom render harness | `app/admin/audit-trail/page.tsx:137-139`, `:181`; `app/admin/audit-trail/__tests__/presetAndDeepLink.render.test.tsx:1-58` |
| Base-class test harness | `usageScope.test.ts` already drives the **real** `callWithTracking` through a minimal `BaseAIProvider` subclass and observes `trackAICall`, including a "byte-identical payload with and without a scope" test (T-U6) | `lib/ai/__tests__/usageScope.test.ts:33-64`, `:187-259` |
| OpenAI test harness | SDK mocked, `trackAICall` observed; mocks `images.generate` and `chat.completions.create`, not `embeddings.create` | `lib/ai/providers/__tests__/openaiProvider.image.test.ts:9-70` |
| The agent platform's charge | Token-based and in-memory: `run-agent` passes `executionResult.totalTokensUsed` to `CreditService.chargeTokensWithIntensity`; it does not read `token_usage.cost_usd` (SQ-16 (b)). No Jest suite covers `chargeTokensWithIntensity` | `app/api/run-agent/route.ts:372`, `:573`; `lib/services/CreditService.ts:444` |
| What CI enforces | `typecheck:bos-llm` (required on `main`) scopes `lib/business-os/llm/`, `usage/`, `entitlements/` and catalog importers — **not** `lib/ai/**`. `check:bos-llm-literals` scans non-test files that import the catalog. **No CI job runs Jest.** `next.config.js:7` ignores type errors | `scripts/typecheck-bos-llm.ts:102-106`; slice 1 workplan §1 and §10 |

---

## 2. Implementation Approach

### 2.0 What changed since D-0, and why

| D-0 plan | Slice 2 | Reason |
|---|---|---|
| `calculateCostSyncWithStatus` holds today's body and returns `{ costUsd, priced }`; `calculateCostSync` delegates; the private OpenAI `calculateCost` returns the status | A **separate, read-only** `getPriceStatusSync(provider, model)` beside `calculateCostSync`. No function returns a new shape, and OpenAI's private `calculateCost` is **untouched** | SQ-13 (1): "a companion read-only lookup over the same table, not a new return shape" |
| Absent signal + `costUsd === 0` + tokens → conservative, reason `price_status_unknown` (D-0 Q-1 (b)) | Absent signal + `costUsd === 0` → **re-check** with the same lookup; fall back only if genuinely unpriced | SQ-13 (2): refines D-0 item 4, so an area pointed at a non-OpenAI provider is not charged the class maximum |
| The fallback function carries the `error` log | The pure function is **silent**. One log-only hook in `runAiAction` makes the loud `error` live now (Q-1) | FR-12a is a slice 2 AC (AC-3); an unwired function cannot satisfy "fails loudly" before slice 3 |
| New `priceCoverage.test.ts` re-asserting token and image defaults | Token and image defaults stay covered by the **existing** `modelSettingsPolicy.test.ts:342-375`; the new file adds only what is missing | The user's reuse rule |
| New `openaiProvider.priceStatus.test.ts` + base-class proof in a new file | The base-class proof **extends** `usageScope.test.ts`, which already has the harness | Reuse |
| Audit `details` untouched | `estimatedCostUsd` rounded to 10 dp; admin formatter precision-aware | SQ-14 |
| T7 warn→error in `pricing.ts` | Still dropped | D-0 Q-9: the only agent-visible effect, and it gives Business OS nothing the hook does not |

### 2.1 The read-only price lookup (`lib/ai/pricing.ts`)

Two additions, and one verbatim extraction. No existing export changes signature or return.

**File:** `lib/ai/pricing.ts` (proposed)
```typescript
/** Whether a model has a usable price. Read-only; logs nothing. */
export type PriceStatus = 'priced' | 'unpriced';

// Extracted VERBATIM from calculateCostSync (:256-265), so the cost and the
// status can never disagree about which row they read (Q-2).
function lookupPricingSync(provider: string, modelName: string): PricingInfo | undefined { … }

export function getPriceStatusSync(provider: string, modelName: string): PriceStatus {
  const pricing = lookupPricingSync(provider, modelName);
  // D-0 C-1: a row at 0 is not a price. That is exactly the silent $0 FR-12 closes.
  const usable = !!pricing && pricing.input > 0
    && (pricing.output > 0 || isInputOnlyPricedModel(provider, modelName));
  return usable ? 'priced' : 'unpriced';
}

/** A frozen copy of the in-code table, for SQ-9's computed maximum and the coverage test. */
export function inCodeTokenPrices(): Readonly<Record<string, Readonly<Record<string, Readonly<PricingInfo>>>>>;
```

- **`calculateCostSync` returns exactly what it does today.** Its body calls `lookupPricingSync` instead of holding the same 10 lines; the warn, the arithmetic and the return are untouched. The old values are pinned **before** the edit (T1).
- **Total (SA C-2).** `getPriceStatusSync` runs inside `callWithTracking`'s `try` (via `extractMetrics`), so a throw would record a billed call as a $0 failure. It never throws: a non-string or empty provider or model returns `'unpriced'` (typeof-guarded before any lookup). No `try` is added in the provider.
- **Deep-frozen (S-5).** `inCodeTokenPrices()` returns a copy with every provider map and every `PricingInfo` frozen.
- **Silent by design.** `getPriceStatusSync` logs nothing, so the existing missing-price `warn` still fires **once** per call, from `calculateCostSync` (D-0 C-2's "once per call" assertion).
- **Sync only.** Every provider cost path uses `calculateCostSync`; nothing in Business OS uses the async `calculateCost`. No async companion is added.
- **Why an accessor for the in-code table rather than exporting `FALLBACK_PRICING`:** a frozen copy means no caller can mutate what lookups read. The shared module gains a read accessor and **no billing policy** (D-0 Q-8).
- `inCodeTokenPrices` exposes `PricingInfo`, which is module-private today; its shape is exported as a type alias only.

### 2.2 The signal on the call record (`usageScope.ts`, `baseProvider.ts`, `openaiProvider.ts`)

**File:** `lib/ai/usageScope.ts` (proposed, type only; D-0 S-1: declared once)
```typescript
/** How the provider priced this call, where it says so. Absent = the provider does not report it. */
export type UsageCallPricing = { status: PriceStatus; unit: 'token' | 'image' };

export interface UsageCallRecord {
  // … unchanged fields …
  pricing?: UsageCallPricing;
}
```
- `unit` is needed because an unpriced image has zero tokens: a token-rate fallback would charge it $0.
- `PriceStatus` is imported type-only from `pricing.ts` (erased; `usageScope.ts` stays product-agnostic, as its header requires).

**File:** `lib/ai/providers/baseProvider.ts` (proposed)
- `extractMetrics`' return type gains `pricing?: UsageCallPricing`.
- The **success** `notifyUsage` payload gains `...(metrics.pricing ? { pricing: metrics.pricing } : {})`.
- **Nothing else.** `trackAICall` is not given `pricing`, so `token_usage` is byte-identical. The failure branch (`:164-208`) is not touched (SQ-16). The other four providers compile unchanged: the field is optional.

**File:** `lib/ai/providers/openaiProvider.ts` (proposed, all three paths)
- **Chat and embeddings:** each `extractMetrics` adds `pricing: { status: getPriceStatusSync('openai', params.model), unit: 'token' }`. `cost` is still `this.calculateCost(…)`, unchanged. One extra `Map.get` per call.
- **Image:** the arrow gets a block body so `priceFor` is called **once**, as today: `const cost = priceFor(result.quality) * params.n;` then `{ …, cost, pricing: { status: cost > 0 ? 'priced' : 'unpriced', unit: 'image' } }`. The inference is D-0 S-2 (accepted): `resolveImagePrice` returns 0 only when unpriced, the resolver wrapper only on a throw. `GeneratedImageService` and `ImagePriceResolver` are **not** touched. A comment states the assumption, and the coverage test pins it (every `IMAGE_FALLBACK_PRICING` value finite and > 0).
- `anthropicProvider`, `kimiProvider`, `groqProvider`, `mistralProvider`: **not touched**. Their records carry no `pricing`, which is exactly the "absent" case §2.3 re-checks.

### 2.3 The conservative fallback, pure and unwired (`chargeClassification.ts` + `chargePricing.ts`)

Two new Business OS modules (SA Q-1 (b), S-2). They hold the policy (D-0 Q-8); the shared module only reads.

- **`lib/business-os/llm/chargeClassification.ts`** imports only `@/lib/ai/pricing`, `@/lib/logger` and types. It holds the types, `classifyCallForCharge` and `reportUnpricedCalls`. `aiActionAudit.ts` imports it, so `SystemConfigRepository` never enters `aiActionAudit`'s graph (R-5 closed).
- **`lib/business-os/llm/chargePricing.ts`** holds the conservative rates (computed **lazily** on first use, S-2), `priceActionForCharge` and `conservativeRateDerivation`, and imports `IMAGE_FALLBACK_PRICING`. Nothing outside tests imports it in slice 2.

The signatures below were planned as one file; they now split as above.

**File:** `lib/business-os/llm/chargePricing.ts` (proposed)
```typescript
export type CallChargeBasis = 'measured' | 'failed_call' | 'conservative_fallback';
export type FallbackReason = 'unpriced' | 'unpriced_on_recheck' | 'priced_but_zero' | 'zero_cost_with_tokens' | 'malformed';
export type ChargeKind = 'text' | 'embedding' | 'image';   // S-4: one vocabulary on the charge side

export interface ClassifiedCall { basis: CallChargeBasis; reason?: FallbackReason; kind: ChargeKind }
export interface PricedCall extends ClassifiedCall { costUsd: number }
export interface PricedAction { costUsd: number; isFallbackPriced: boolean; fallbackCallCount: number; calls: readonly PricedCall[] }
export interface ConservativeRate {
  kind: ChargeKind; provider: string; scope: 'provider' | 'all_providers';
  inputPer1k?: number; outputPer1k?: number; perImage?: number;
  inputFrom?: string; outputFrom?: string; imageFrom?: string;   // D-0 S-3: source model per side
}

export function classifyCallForCharge(call: UsageCallRecord): ClassifiedCall;       // pure, silent
export function priceActionForCharge(calls: readonly UsageCallRecord[]): PricedAction; // pure, silent; slice 3 wires it
export function conservativeRateDerivation(): readonly ConservativeRate[];          // for SA sign-off and slice 4
export function reportUnpricedCalls(calls: readonly UsageCallRecord[], ctx: UnpricedLogContext): void; // the one live hook (§2.4)
```

**Rules, in order** (each is one test in §5.2):

| # | Record | Basis | Charge | Source |
|---|---|---|---|---|
| 1 | Non-finite or negative cost or token count | `conservative_fallback`, reason `malformed` | Conservative where the unit and tokens make one computable, else 0 (still flagged). Never throws | D-0 S-5 |
| 2 | `success === false` | `failed_call`, not flagged | The recorded 0 | KI-8, SQ-16 |
| 3 | `pricing.status === 'unpriced'` | `conservative_fallback`, reason `unpriced` | Image: the image maximum × 1. Token: embedding or text rate by `isInputOnlyPricedModel`, on the **full** recorded input tokens (the cached-input discount is deliberately ignored) | SQ-9, SQ-13 |
| 4 | `pricing.status === 'priced'`, `costUsd === 0`, tokens > 0 | `conservative_fallback`, reason `priced_but_zero` | Conservative token rate. A backstop: after §2.1's `> 0` rule it cannot happen, so it is tested once | D-0 Q-1 (d) |
| 5 | `pricing.status === 'priced'` otherwise | `measured` | `costUsd` as recorded | — |
| 6 | `pricing` absent, `costUsd > 0` | `measured` | `costUsd` as recorded: a positive cost proves a price was found | D-0 Q-1 (a), Q-4 |
| 7 | `pricing` absent, `costUsd === 0` | **Re-check** `getPriceStatusSync(provider, model)`. `priced` **and tokens 0** → `measured` (0). `priced` **and tokens > 0** → `conservative_fallback`, reason `zero_cost_with_tokens`, conservative token rate, logged by the hook (**C-1**: a priced model cannot cost 0 for non-zero tokens unless it was unpriced at call time, e.g. a cold cache that warmed before the action ended). `unpriced` → `conservative_fallback`, reason `unpriced_on_recheck`, conservative token rate if tokens > 0, else 0 flagged | SQ-13 (2), SA C-1 |

**The conservative rates (SQ-9), computed lazily from the in-code tables, never typed:**
- **Text**, per provider: the per-side maximum `input` and `output` over `inCodeTokenPrices()[provider]`, excluding input-only models (D-0 Q-7). Today, for `openai`: 0.03 / 0.18 per 1k, both from `gpt-5.4-pro`.
- **Embedding**, per provider: the maximum `input` over input-only models. Today, `openai`: 0.00013 per 1k (`text-embedding-3-large`).
- **Image:** the maximum of `IMAGE_FALLBACK_PRICING`. Today $0.25. OpenAI is the only image provider.
- **A provider absent from the table** (today `groq`, `mistral`) uses the cross-provider maximum for that kind, marked `scope: 'all_providers'` (D-0 Q-2).
- The figures above are **what the test must recompute**, never what it compares against; the test derives the expected maxima from `inCodeTokenPrices()` and `IMAGE_FALLBACK_PRICING` (D-0 C-1 spirit: no hand-typed number anywhere).

**Precision (SQ-8):** `priceActionForCharge` sums the raw per-call `costUsd` and the conservative figures, **unrounded**, and never reads the audit's `estimatedCostUsd`. A 2e-7 USD embedding stays non-zero.

**Imports and graph:** `chargeClassification.ts`: `@/lib/ai/pricing`, `@/lib/logger`, `@/lib/ai/usageScope` (type), `./callCatalog` (type). `chargePricing.ts`: `./chargeClassification`, `@/lib/ai/pricing`, `@/lib/ai/usageScope` (type), `@/lib/repositories/SystemConfigRepository` (`IMAGE_FALLBACK_PRICING`), `./callCatalog` (type). `SystemConfigRepository` loads `supabaseServer` at import, so `chargePricing.ts` is **server-only** (D-0 N-6). No model or price literal in either: both import the catalog (type-only), so `check:bos-llm-literals` scans them (confirmed with `--list` at T8).

### 2.4 Failing loudly, now (`reportUnpricedCalls` in `runAiAction`)

AC-3's first half — "an `error` log naming provider, model, area and action" — has to be true in slice 2, and the only place that knows the area, the action type and the group of a call is `runAiAction`. So:

- `runAiAction` gains one call in its **own** `try/catch`, placed **after** `emitAiAuditEntry` (SA Q-1 (a), S-1), so a throw from the hook can never skip the audit entry: `reportUnpricedCalls(outcome.usage.calls, { area, actionType, groupId, accountId })`.
- For each call that `classifyCallForCharge` puts on `conservative_fallback` (rules 1, 3, 4, 7), it logs **one** `logger.error` with `{ event: 'bos_llm_call_unpriced', provider, model, area, actionType, groupId, accountId, callName: call.component, kind, reason }` (`accountId` per S-1: an id, not owner text). This is the **one** countable error event per unpriced call (N-4). The stable `event` makes "how many calls were unpriced?" countable from logs (FR-12c). No prompt, no owner text (Standard 5).
- **It changes nothing else:** no return value, no audit field, no charge, no await. It cannot throw into the action (its own `try/catch`).
- **What stays true of the other records (SQ-13):** `token_usage` and the audit entry still record the $0; the log is what makes the three records disagree **visibly**. The conservative figure exists only in `priceActionForCharge`'s return, which slice 3 writes to the charge row.
- **SA ruled (Q-1): ship now.**

### 2.5 The audit entry keeps small costs (`aiActionAudit.ts`)

- `estimatedCostUsd: Math.round(cost * 1e10) / 1e10`, with the comment updated: 10 decimal places matches SQ-8's `numeric(…,10)`, still kills float noise (`0.30000000000000004`), and keeps a ~2e-7 embedding non-zero (SQ-14 (1)). Safe while `cost * 1e10` stays below `Number.MAX_SAFE_INTEGER`, i.e. below ~$900,000 per action.
- Field name and type unchanged; `schema: 1` unchanged; **no backfill** (SQ-14 (4)). The `schema: 2` bump stays in slice 3.
- The pinned tests change with it (SQ-14 (2)): `:152` → `0.0035024`; `:159-171` rewritten to assert the stored value is within 5e-11 of the exact sum, is **non-zero** for a sub-micro-dollar total, and keeps the float-noise case clean; `:406` unchanged. A new test is AC-29: one ~2e-7 embedding call → a non-zero stored cost.

### 2.6 The admin formatter (the one named UI exception, SQ-14 (3))

**File:** `app/admin/audit-trail/page.tsx` (proposed, `asUsd` only, `:137-139`)
- Show up to 10 decimals, trimming trailing zeros but never below 6: `0.003502` → `$0.003502` (older entries look exactly as today); `0.0035024` → `$0.0035024`; `2e-7` → `$0.0000002`.
- The comment is corrected: entries written before slice 2 are micro-rounded, later ones are at 10 dp.
- Admin-only; no owner surface; nothing else on the page changes. The function stays **inside** the page (a Next page file may not export helpers), so it is tested through a render.

### 2.7 Price coverage (SA-S2, FR-12e), reusing what exists

`modelSettingsPolicy.test.ts:342-375` already proves every token default passes the DEC-7 guardrail (`> 0` on both sides) and every default image size × low/medium/high has a fallback price > 0. That stays the proof for those; it is cited, not copied. A new `lib/business-os/llm/__tests__/priceCoverage.test.ts` adds only what is missing:

1. **The embedding default** (the excluded chat calls' `helpbot_embedding_model` default). Read `EmbeddingService.ts` as text, extract the string-literal default after **each** occurrence of the key, and assert the count equals the number of occurrences (2 today, D-0 S-4), so a refactor to an identifier fails loudly. Each must be `getPriceStatusSync('openai', m) === 'priced'`. `EmbeddingService` is not edited (D-0 Q-5).
2. **The signal agrees with the defaults:** every token default in `BOS_LLM_CALL_POLICY` is `getPriceStatusSync(...) === 'priced'`. This ties the new lookup to DEC-7, so the two cannot drift.
3. **Images through the real resolver:** `resolveImagePrice({}, model, size, quality)` for the default model × every distinct default size × `IMAGE_PRICE_REQUIRED_QUALITIES` gives `source !== 'unpriced'` and `> 0`. Plus: every `IMAGE_FALLBACK_PRICING` value is finite and > 0 (D-0 S-2's assumption).
4. **The conservative rates are real:** each derived rate is > 0 and ≥ the rate of every code default of that kind (so the fallback can never be cheaper than a priced default).
5. A header comment names DEC-7 (`modelSettings.test.ts:230-291`) as the runtime guarantee for DB-selected models, and lists SA-S2's residual holes and which one this file closes.

### 2.8 Root cause / phase

Not V6. The Business OS "phase" that owns a wrong charge is the cost figure. A silent $0 starts in `calculateCostSync`'s return, which the agent platform shares, so the fix mandated by SA-S3 / SQ-13 is to **signal** upward (provider → call record → Business OS), not to change the shared return. The agent platform sees no numeric change.

---

## 3. Files to Create / Modify

| File | Action | Reason | `console.*` |
|---|---|---|---|
| `lib/ai/pricing.ts` | modify | `lookupPricingSync` (verbatim extraction), `getPriceStatusSync`, `inCodeTokenPrices`, `PriceStatus` (§2.1) | 0 |
| `lib/ai/usageScope.ts` | modify | `UsageCallPricing`; optional `pricing` on `UsageCallRecord` (type only) | 0 |
| `lib/ai/providers/baseProvider.ts` | modify | Optional `pricing` in `extractMetrics`; forwarded to the **success** `notifyUsage` only | 0 |
| `lib/ai/providers/openaiProvider.ts` | modify | Sets `pricing` on chat, embeddings, image | 0 |
| `lib/business-os/llm/chargeClassification.ts` | create | Types, classifier, the log hook (§2.3, §2.4; SA Q-1 (b)) | — |
| `lib/business-os/llm/chargePricing.ts` | create | Lazy conservative rates, pure resolver, derivation (§2.3) | — |
| `lib/business-os/llm/aiActionAudit.ts` | modify | 10 dp rounding (§2.5); one `reportUnpricedCalls` call in its own `try` after `emitAiAuditEntry` (§2.4, Q-1, S-1) | 0 |
| `app/admin/audit-trail/page.tsx` | modify | `asUsd` precision (§2.6) | 0 |
| `lib/ai/__tests__/pricing.test.ts` | modify | Pin old returns first; the lookup, status, accessor | 0 |
| `lib/ai/__tests__/usageScope.test.ts` | modify | Base-class pass-through proof (D-0 C-2), reusing the `TestProvider` harness | 0 |
| `lib/ai/providers/__tests__/openaiProvider.priceStatus.test.ts` | create | Chat, embeddings, image signal; explicit `trackAICall` literals. New because the image harness does not mock embeddings and is named for images | — |
| `lib/business-os/llm/__tests__/chargeClassification.test.ts` | create | Every rule in §2.3, the log hook | — |
| `lib/business-os/llm/__tests__/chargePricing.test.ts` | create | Conservative rates, the resolver, the derivation | — |
| `lib/business-os/llm/__tests__/priceCoverage.test.ts` | create | Only the gaps listed in §2.7 | — |
| `lib/business-os/llm/__tests__/aiActionAudit.test.ts` | modify | Rounding pins `:152`, `:159-171`; AC-29; the hook is called and cannot fail the action | 0 |
| `app/admin/audit-trail/__tests__/aiCostPrecision.render.test.tsx` | create | Renders an AI entry at 2e-7, 0.003502 and 0.0035024, using the existing page harness pattern | — |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_2_WORKPLAN.md` | create | This document | — |

**Deliberately not touched:** `calculateCost` (async), `calculateCostSync`'s behaviour, OpenAI's private `calculateCost`, `baseProvider.ts`'s failure branch and every `trackAICall` call, `lib/analytics/**`, `lib/services/GeneratedImageService.ts`, `lib/services/EmbeddingService.ts`, `lib/repositories/SystemConfigRepository.ts`, `anthropicProvider.ts`, `kimiProvider.ts`, `groqProvider.ts`, `mistralProvider.ts`, `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `app/api/run-agent/**`, `lib/business-os/entitlements/**` (including `balance.ts`), every `runAiAction` call site, `AiAuditDetails`' shape, `supabase/migrations/**`, `scripts/**`, `.github/**`, the requirement doc.

---

## 4. Task List

Each task ends with its own suites green, and is marked ✅ when done.

- ✅ **T0: Baseline and fixtures.** Record: `npx jest lib/ai lib/business-os/llm app/admin/audit-trail app/api/website/media/generate app/api/cron/insight-detect lib/analytics` (pass counts), `npm run typecheck:bos-llm` (0 new; baseline sha256), `npm run check:bos-llm-literals`, and the **scoped type program** (SA C-3): a scratch tsconfig **outside the repo** (session scratchpad, never committed) that `extends` the worktree's `tsconfig.json`, with `compilerOptions: { incremental: false, noEmit: true }`, `include: []` and `files` = `next-env.d.ts` + every file created or modified in §3 that exists before the edit. Record the error set as (file, TS code, message). **Capture the explicit `trackAICall` payloads** (success and failure, base class; chat, embedding, image, OpenAI) as literal objects from the unmodified code, for D-0 C-2 (iii).
- ✅ **T1: Pin shared pricing, then extract (§2.1).** First add tests pinning `calculateCostSync` / `calculateCost` for a priced model, an unpriced model (0, one warn), zero tokens, a DB row, and a DB row at 0 — all green on the old code. Then extract `lookupPricingSync` verbatim, add `getPriceStatusSync` (with the D-0 C-1 `> 0` rule) and `inCodeTokenPrices`. Pins still green.
- ✅ **T2: The signal (§2.2).** `UsageCallPricing` + optional field; the success-branch spread in `baseProvider.ts`; the three OpenAI paths. Extend `usageScope.test.ts` (D-0 C-2 (i)–(v)); create `openaiProvider.priceStatus.test.ts`.
- ✅ **T3: Price coverage (§2.7).** Create `priceCoverage.test.ts`.
- ✅ **T4: The pure resolver (§2.3).** Create `chargeClassification.ts` (types, classifier with C-1 applied) and `chargePricing.ts` (lazy rates, resolver, derivation), with their tests. A grep confirms nothing outside tests imports `chargePricing.ts` or `priceActionForCharge`.
- ✅ **T5: Audit precision (§2.5).** The 10 dp change; update the `:152` and `:159-171` pins; add AC-29.
- ✅ **T6: The loud log (§2.4). SA Q-1: ship now.** `reportUnpricedCalls` in `chargeClassification.ts`; one call in its own `try/catch` after `emitAiAuditEntry` in `runAiAction`. Tests: fires once per unpriced call with every named field; silent for priced, failed and absent-but-priced calls; a throwing classifier cannot change the action's result or error.
- ✅ **T7: Admin formatter (§2.6).** `asUsd` and its comment; create `aiCostPrecision.render.test.tsx`.
- ✅ **T8: Gates.** Re-run every T0 command. `typecheck:bos-llm`: 0 new, baseline sha256 unchanged. `typecheck:bos-llm --list` includes both new modules; `check:bos-llm-literals --list` scans them. **Scoped type program (C-3)** re-run with `files` = `next-env.d.ts` + **every** created or modified file (production and test): pass = zero errors in those files **and** the (file, code, message) error set elsewhere identical to T0. S-3: the nine suites mocking `@/lib/ai/pricing` still pass. `NODE_OPTIONS=--max-old-space-size=6144 npx next build` passes (`chargePricing.ts` and `aiActionAudit.ts` are server-only; the admin page must not import either). Record that the new Jest suites are **local-only** (no CI job runs Jest) and QA must run them.
- ✅ **T9: Evidence for SA.** `git diff HEAD --stat` lists only §3's files, with **no deletion-without-insertion** (the file-write truncation hazard). `git diff HEAD` of `baseProvider.ts` shows no line changed in the failure branch or any `trackAICall` call. No `runAiAction(` call site in the diff. No file under `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `app/api/run-agent/`, `lib/analytics/`. `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` snapshot unchanged. Conservative-rate derivation printed from `conservativeRateDerivation()` for SA's sign-off (SQ-9). Record all of it in §11.
- ✅ **T10: Handover.** Status → Code Complete; leave everything **uncommitted** (the user reviews the diff first); notify TL for the SA code review.

---

## 5. Test Plan

### 5.1 Happy paths

| Suite | Asserts |
|---|---|
| `pricing.test.ts` | `getPriceStatusSync`: `priced` for a cached row and for an in-code row; the input-only embedding row is `priced`. `inCodeTokenPrices()` is frozen; mutating an attempt throws or is ignored, and lookups are unaffected |
| `openaiProvider.priceStatus.test.ts` | Priced chat model → record `pricing { priced, token }`, `costUsd` equal to what `calculateCostSync` returns. Same for embeddings. Image priced > 0 → `{ priced, image }`; `priceFor` called **once** |
| `usageScope.test.ts` | A `pricing` field reaches the scope record unchanged |
| `chargePricing.test.ts` | Rules 5 and 6 pass `costUsd` through as `measured`; `priceActionForCharge` sums raw costs; a 2e-7 call stays non-zero; conservative rates equal the maxima **recomputed in the test** from the tables, with source models per side |
| `priceCoverage.test.ts` | §2.7 items 1–4 |
| `aiActionAudit.test.ts` | Three-call action stores `0.0035024`; a lone ~2e-7 embedding stores a non-zero cost (AC-29); `schema: 1`; `0.1 + 0.2` still stores `0.3` |
| `aiCostPrecision.render.test.tsx` | `$0.0000002`, `$0.003502`, `$0.0035024` rendered in the AI Action Details panel |

### 5.2 Failure paths

| Suite | Asserts |
|---|---|
| `pricing.test.ts` | **C-2:** `getPriceStatusSync(undefined as unknown as string, …)`, a non-string model, and empty strings all return `unpriced` without throwing. Unknown model → `unpriced`; a cached row at 0/0 → `unpriced` and `calculateCostSync` still returns 0 (D-0 C-1); a chat row with `output: 0` → `unpriced`; `getPriceStatusSync` logs nothing |
| `openaiProvider.priceStatus.test.ts` | Unpriced chat model → `{ unpriced, token }`, `costUsd` 0, the missing-price warn fires **exactly once** (D-0 C-2). `priceFor → 0` → `{ unpriced, image }`. A thrown call's record has **no** `pricing` |
| `usageScope.test.ts` | `extractMetrics` without `pricing` → `not.toHaveProperty('pricing')` (the shape of the four other providers); failure record has no `pricing` |
| `chargePricing.test.ts` | Rule 1 (malformed: `NaN`, negative) flagged, never throws; rule 2 (failed call) 0, not flagged; rule 3 unpriced text / embedding / image → the class maximum, flagged (image **not** 0); rule 4 backstop; "an Anthropic-style record is not over-charged" (SQ-13 (2)) is proved by rule 6 (absent + `costUsd > 0` → `measured`) and by absent + `costUsd` 0 + **zero tokens** + re-check priced → `measured` 0; **C-1:** absent + `costUsd` 0 + **tokens > 0** + re-check priced → conservative, flagged, reason `zero_cost_with_tokens`; absent + model unpriced on re-check → conservative, reason `unpriced_on_recheck`; absent + no tokens + unpriced → 0 flagged; provider not in the table (`groq`) → `all_providers` rate |
| `chargePricing.test.ts` (T6) | `reportUnpricedCalls` logs one `error` per unpriced call with `event`, provider, model, area, actionType, groupId, callName; none for a priced call; a sentinel prompt string never reaches any logger level (Standard 7) |
| `aiActionAudit.test.ts` (T6) | With the classifier forced to throw, the action's value and thrown error are unchanged and the audit entry is still queued |

### 5.3 Proof that the agent platform is unchanged

| # | What | How |
|---|---|---|
| P-1 | What `token_usage` records | `trackAICall`'s payload `toEqual`s the **explicit literal captured at T0** — base class (with and without `pricing`, success and failure, inside and outside a scope) and OpenAI chat / embedding / image. No `pricing` key, same `cost_usd`, same token counts (D-0 C-2 (iii)). Never compares new code to itself |
| P-2 | What shared pricing returns | T1 pins `calculateCostSync` and `calculateCost` on the old code, then re-runs them unchanged after the extraction |
| P-3 | What an agent run is charged | By construction: `run-agent` charges `executionResult.totalTokensUsed` (`route.ts:372`, `:573`) via `chargeTokensWithIntensity` (`CreditService.ts:444`), which reads tokens, not cost. P-1 proves the token counts are identical. T9's diff shows no file on that path changed |
| P-4 | Agent reconciliation and intensity readers (`TokenReconciliationService`, `updateAgentIntensity`, SQ-16 (b)) | They read `token_usage`, which P-1 proves unchanged; the failure branch is untouched (T9) |
| P-5 | Outside a scope | `callWithTracking`'s return value is identical and `trackAICall` is called exactly once (D-0 C-2 (v)); the only added cost is one `Map.get` per OpenAI call |
| P-6 | Logs | No new agent-visible log: `getPriceStatusSync` is silent, `pricing.ts`'s warn is unchanged (T7 of D-0 stays dropped), and `reportUnpricedCalls` runs only inside `runAiAction` |

**Commands**
```bash
npx jest lib/ai lib/business-os/llm app/admin/audit-trail app/api/website/media/generate app/api/cron/insight-detect lib/analytics
npm run typecheck:bos-llm
npm run check:bos-llm-literals
npx tsc -p <scratchpad>/tsconfig.slice2.json   # scoped program, SA C-3 (the full program runs out of memory)
NODE_OPTIONS=--max-old-space-size=6144 npx next build
```

**Live check:** optional. On `/test-business-os` → LLM Usage, run one chat turn; the tab looks identical (no `token_usage` change). On `/admin/audit-trail`, the new AI entry's Estimated Cost shows more than six decimals where it has them.

---

## 6. Guardrails and Out of Scope

**Guardrails (§12 slice 2, the SA rulings and the user's rules):**

| Must not | Why |
|---|---|
| Change what the agent platform is charged: `CreditService`, `pricingConfig`, `run-agent`, `chargeTokensWithIntensity` | A-11, B-8, slice 2 guardrail |
| Change what `calculateCost`, `calculateCostSync` or `resolveImagePrice` return | SA-S3, SQ-13 (1) |
| Write a Business OS-only figure into `token_usage` | SQ-13 |
| Hand-type a fallback price | SQ-9 |
| Change `baseProvider.ts`'s failure branch | SQ-16, KI-8 |
| Touch `anthropicProvider` / `kimiProvider` | `console.*` debt (§10) |
| Add a charge table, a migration, a call-site change, or touch `balance.ts` | Slices 3 and 9 |
| Wire `priceActionForCharge` into anything | Slice 3 |
| Bump the audit `schema`, add or rename a `details` field, backfill old entries | SQ-14 |
| Any UI other than the admin audit-trail cost formatter | SQ-14 (3), the one named exception |
| Promote `pricing.ts`'s warn to error | D-0 Q-9 |

**Out of scope, and where it goes:**

| Item | Where |
|---|---|
| The charge row, the fallback flag written on it, the action id, `schema: 2` | Slice 3 |
| A fallback-flagged row reported as reconciled-pending; adjustments | Slice 4 (SQ-13 (3)) |
| Recording usage on a failed call | Not done (SQ-16, KI-8) |
| Cached-input pricing for non-OpenAI providers; cache warming or TTL rework (N-5) | Not planned (SQ-12, §16) |
| Running the new Jest suites in CI | The parked "no Jest in CI" finding (Q-8) |

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `baseProvider.callWithTracking` runs on **every** LLM call in the product | One conditional spread into the success `notifyUsage` payload, which is a no-op outside a scope and never throws (`usageScope.ts:99-126`). `trackAICall` untouched. P-1 with explicit literals |
| R-2 | The `lookupPricingSync` extraction could shift a number the agent platform records | Pinned **before** the move (T1); verbatim move; Q-2 offers the zero-touch alternative |
| R-3 | A fallback-priced text call is heavily over-charged (openai max ≈ 18× gpt-4o output) | By design (SQ-9, KI-2). After slice 2 only a defect reaches it, and it is flagged and logged. SA signs off the derived figures (T9) |
| R-4 | `reportUnpricedCalls` adds a runtime step to all 16 actions | Inside the existing `try`, wrapped again, no await, no I/O beyond a log; a test forces it to throw (§5.2). Q-1 lets SA defer it |
| R-5 | ~~`aiActionAudit.ts` pulls `SystemConfigRepository` into its graph~~ | **Closed** by SA Q-1 (b): `aiActionAudit.ts` imports only `chargeClassification.ts` (pricing + types) |
| R-6 | The image signal rests on "a price of 0 means unpriced" | D-0 S-2 accepted; pinned by §2.7 item 3 and a comment at the image `extractMetrics` |
| R-7 | The embedding-default source parse is brittle | Count-matched to occurrences of the key; fails loudly on a refactor (D-0 S-4) |
| R-8 | Changes under `lib/ai/**` and the admin page are **not** in the required type gate, and `next build` ignores type errors | `tsc --noEmit` before/after on those files (T0, T8) |
| R-9 | Agent file-write truncation (project memory) | T9 checks `git diff --stat` for deletion-without-insertion before any diff review |
| R-10 | ~~Slice 2 stacks on slice 1's unmerged PR #130~~ | **Closed** (S-6): #130 merged; slice 2 has its own branch off `main` `3941327f` |

---

## 8. Estimate

| Task | Days |
|---|---|
| T0 baseline + literal fixtures | 0.25 |
| T1 pricing lookup, pinned | 0.5 |
| T2 signal on three paths + base-class proof | 0.75 |
| T3 coverage | 0.25 |
| T4 pure resolver + tests | 0.75 |
| T5 audit precision | 0.25 |
| T6 loud log hook (if Q-1 = yes) | 0.25 |
| T7 admin formatter + render test | 0.25 |
| T8–T10 gates, build, evidence | 0.5 |
| **Total** | **≈ 3.75 days** |

That is within "a few days", so **no split is proposed**. If SA wants a smaller first PR, the natural seam is: **2a** — audit precision, admin formatter, coverage tests (T3, T5, T7; ≈ 1 day; touches nothing shared) and **2b** — the lookup, the signal, the resolver and the hook (T1, T2, T4, T6; ≈ 2.25 days; the only part that touches the shared provider layer).

---

## 9. Open Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Ship the log-only `reportUnpricedCalls` hook in `runAiAction` now (so AC-3's "fails loudly with area and action" is live in slice 2), or leave the loud log to slice 3? And if now: keep it in `chargePricing.ts` (R-5) or a separate module that imports only `pricing.ts`? | Ship now, in `chargePricing.ts`. Without it, an unpriced call today is one `warn` with no area or action. It changes no value, field or await |
| Q-2 | `pricing.ts`: extract the 10-line lookup into a private `lookupPricingSync` shared by `calculateCostSync` and `getPriceStatusSync`, or leave `calculateCostSync` byte-identical and duplicate the lookup? | Extract, pinned first. One definition means the cost and the signal cannot read different rows; SQ-13 asked for a lookup "over the same table" |
| Q-3 | Is a sync-only status lookup enough? `calculateCost` (async, DB-loading) gets no companion | Yes. Every provider path uses the sync function; a companion nobody calls would be dead code |
| Q-4 | Rule 6: an absent signal with `costUsd > 0` is `measured` **without** a re-check (D-0 Q-1 (a)); only `costUsd === 0` is re-checked. Does that satisfy SQ-13 (2)? | Yes. A positive cost proves a price was found at call time; re-checking could only disagree if the table changed since, and would then over-charge |
| Q-5 | Admin formatter: variable precision (at least 6, at most 10 decimals, trailing zeros trimmed), so old micro-rounded entries render exactly as today? | Yes |
| Q-6 | SQ-14 named the pins at `:167-168` and `:403`; at `fc1856bd` they are `:170-171` and `:406`, and a third pin at `:152` (`0.003502` → `0.0035024`) also changes. Confirm these are expected-value changes, not behaviour changes | Yes; listed in §1 and T5 |
| Q-7 | The classifier's `unit` for an absent-signal call is inferred as token (text or embedding by `isInputOnlyPricedModel`); an image can never arrive without a signal because only OpenAI generates images. Acceptable, or should an absent-signal zero-token call be treated as an image? | Token. Treating it as an image would charge $0.25 for a zero-token text call. It is flagged either way |
| Q-8 | The coverage and resolver tests are Jest, which no CI job runs. The enforced parts are `typecheck:bos-llm` and `check:bos-llm-literals` over `chargePricing.ts`. Leave CI as is? | Yes, as in slice 1 (Q-5 there); the gap is the parked "no Jest in CI" finding |
| Q-9 *(for TL / RM, not SA)* | Slice 1 is PR #130 on this same branch. Implement slice 2 after #130 merges (branch re-based on `main`), or as a stacked PR now? | After #130 merges. Slice 2 touches `aiActionAudit.ts` again, so a stacked PR would carry slice 1's diff until then |

---

## 10. Flagged Items (console.* and deprecated code)

Per CLAUDE.md § Logging: **every file this workplan modifies has 0 `console.*` calls** (counted at `fc1856bd`: `pricing.ts`, `usageScope.ts`, `baseProvider.ts`, `openaiProvider.ts`, `aiActionAudit.ts`, `app/admin/audit-trail/page.tsx`, and the four test files to modify). No conversion is owed.

Read or relied on, but deliberately **not** touched:

| File | `console.*` count | Note |
|---|---|---|
| `lib/ai/providers/anthropicProvider.ts` | 7 | Not needed: its records carry no signal and are re-checked (§2.3 rule 7) |
| `lib/ai/providers/kimiProvider.ts` | 2 | Same |
| `lib/services/GeneratedImageService.ts` | 0 | Imported by a test only |
| `lib/services/EmbeddingService.ts` | 0 | Read as text by a test only |
| `lib/repositories/SystemConfigRepository.ts` | 0 | Imported (`IMAGE_FALLBACK_PRICING`) |
| `lib/business-os/llm/modelSettingsPolicy.ts` | 0 | Imported by a test only |

No deprecated system (V1 plugin strategies, direct Supabase outside repositories) is touched or extended.

---

## 11. SA Workplan Review

**Reviewed by SA — 2026-09-28**, against worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-2` @ `3941327f` (main after PR #130 and PR #129).
**Status:** 🔄 **APPROVED WITH CONDITIONS.** Dev may start once C-1 to C-3 are folded into §2.3, §5 and T0/T8. No second workplan review is needed; SA checks the conditions and should-fix items at code review.

### Verdict in one paragraph

The plan follows every SA ruling it cites. No shared pricing function returns anything new (`calculateCost`, `calculateCostSync`, `resolveImagePrice` and OpenAI's private `calculateCost` keep their shapes; the status comes from a separate, silent, read-only lookup over the same table). `token_usage` never gets a Business OS figure (`trackAICall` is not given `pricing`). An absent signal is re-checked, not assumed unpriced. The fallback is computed from the in-code tables and never typed. The audit cost goes to 10 dp, stays `schema: 1`, and nothing is backfilled. The `baseProvider.ts` failure branch is untouched, and the only UI change is the admin audit-trail formatter. D-0's C-1 (a zero row is not a price), C-2 (a base-class proof against literals captured before the edit) and C-3 (say which guard is enforced) are all carried over. The proof that the agent platform is unchanged (P-1 to P-6) holds, with one gap: the new lookup runs inside `callWithTracking`'s `try`, so it has to be total (C-2 below). I found one real hole: rule 7 would charge a free action (C-1). One command in the plan cannot run (C-3). There is no business question.

### Verified at `3941327f` (line references re-checked)

Between `fc1856bd` and `3941327f`, **no file this workplan cites or modifies changed**. The only changes under `lib/ai`, `lib/business-os/llm` and the other cited paths are in `entitlements/**` and three Layer 2 test files plus their snapshots. Every §1 line reference therefore still holds. I spot-checked these:

| Claim | Result |
|---|---|
| `calculateCostSync` lookup / warn / return; `calculateCost` warn; `FALLBACK_PRICING` private and `as const` | ✅ `pricing.ts:250-275` (lookup `:256-265`, warn `:268`), `:220-243` (warn `:229`), `:29`. `as const` makes the table read-only in types only, not at runtime (see S-5) |
| `callWithTracking`: success `notifyUsage` `:112-122`, `trackAICall` fields picked one by one, failure branch `:164-206` | ✅ `baseProvider.ts:77-209`. **`extractMetrics` runs inside the `try` (`:107`)** (see C-2) |
| OpenAI chat `:206-229`, embeddings `:254-273`, image `:299-318`, private `calculateCost` `:551-572` with half-rate cached input | ✅ |
| Other providers' keys | ✅ `anthropic` and `kimi` pass the same provider string to `callWithTracking` and `calculateCostSync`. `groq` and `mistral` are not in the table. So rule 7's re-check reads the same key the cost was computed with |
| Audit rounding `aiActionAudit.ts:319`, field `:235`, `runAiAction` `try` `:401-409` | ✅ |
| Test pins `aiActionAudit.test.ts:152` (`0.003502`), `:159-171` (the `not.toBe(exact)` is at `:170`), `:406` (`0.3`) | ✅ |
| `asUsd` `page.tsx:137-139`, `toFixed(6)` | ✅ |
| `helpbot_embedding_model` literal default written twice | ✅ `EmbeddingService.ts:113`, `:170` |
| `IMAGE_FALLBACK_PRICING` 9 keys, all > 0; `IMAGE_PRICE_REQUIRED_QUALITIES` | ✅ `SystemConfigRepository.ts:68-78`; `modelSettingsPolicy.ts:281` |
| `run-agent` charges tokens | ✅ `route.ts:573` → `CreditService.ts:444` `chargeTokensWithIntensity`; `:372` records `totalTokensUsed` |
| `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` + snapshot exist (T9) | ✅ |
| `console.*` counts (§10) | ✅ 0 in every file to be modified |
| **Type check of the `lib/ai/**` files (R-8)** | ⚠️ **`npx tsc --noEmit` does not run here.** It died with a JS heap out-of-memory error after about 200 s at Node's default ~4 GB. CI sets `NODE_OPTIONS=--max-old-space-size=6144` for the same reason (`bos-llm-typecheck.yml:104`, `build.yml:129`). A **scoped** program took about 11 s: a scratch tsconfig extending the root one, with `files` = the six production files to be modified. **Today, all six files and their whole import closure are type-clean except for 6 pre-existing errors in `lib/analytics/aiAnalytics.ts` (`:357`, `:360`, `:368` TS7006; `:399` TS2538), a file this plan does not touch.** See C-3 |

### Rulings on §9

| # | Ruling |
|---|---|
| **Q-1** | **Ship the hook now.** Without it, AC-3's "error naming provider, model, area and action" is not true in slice 2, and today's only signal is a `warn` that carries no area. The hook has two constraints. **(a) Placement:** give it its **own** `try/catch`, **after** `emitAiAuditEntry`, rather than inside the same `try` before it. As written, a throw from the hook would skip the audit entry (S-1). **(b) Module:** put `classifyCallForCharge` and `reportUnpricedCalls` in a small module, `lib/business-os/llm/chargeClassification.ts`, that imports only `@/lib/ai/pricing` and types. `aiActionAudit.ts` imports that module. `chargePricing.ts` (rates, `priceActionForCharge`, `conservativeRateDerivation`, the `IMAGE_FALLBACK_PRICING` import) imports the classifier, and nothing outside tests imports `chargePricing.ts` in slice 2. This keeps `SystemConfigRepository` out of `aiActionAudit`'s import graph (R-5 closed rather than argued), and it means the 16 actions' hot path never touches the rate derivation (S-2). The event name `bos_llm_call_unpriced` is accepted, and it **supersedes** D-0 Q-2's `bos_charge_fallback_priced` as the one countable error event (see N-4) |
| **Q-2** | **Extract, pinned first.** Pin the old returns and the warn in T1 before the move. The extraction must keep the exact lookup order (cache, then in-code), must leave the warn text and level unchanged, and must return `undefined` in the same cases. One definition is what SQ-13 (1) meant by "over the same table" |
| **Q-3** | **Yes, sync only.** Every provider cost path is sync. An async companion would be dead code |
| **Q-4** | **Yes.** Absent signal with `costUsd > 0` → `measured`, with no re-check. A positive cost proves a price was found at call time. This satisfies SQ-13 (2), whose concern was over-charging a priced non-OpenAI provider. **But see C-1** for the `costUsd === 0` branch |
| **Q-5** | **Yes.** Show at least 6 and at most 10 decimals, with trailing zeros trimmed down to 6, and **never** exponent notation (build it from `toFixed(10)`, not `String(n)`). Old micro-rounded entries must render byte-identical to today |
| **Q-6** | **Confirmed.** At `3941327f` the pins are `:152` (→ `0.0035024`), `:159-171` (rewritten; the `not.toBe(exact)` at `:170` inverts the old intent, so replace it) and `:406` (unchanged). These are expected-value changes that follow SQ-14 (2), not behaviour changes. `:152` is a third pin I did not name in SQ-14; changing it is correct |
| **Q-7** | **Token, yes.** Only OpenAI generates images, and it always sets the signal. Treating a zero-token absent record as an image would invent a $0.25 charge. With C-1 applied, a zero-token record is `measured` 0 when the re-check says priced, and flagged 0 when it says unpriced |
| **Q-8** | **Leave CI as it is.** The enforced guards are `typecheck:bos-llm` and `check:bos-llm-literals` over the new `lib/business-os/llm/` modules. The new Jest suites are local-only; T8 and the QA handover must say so and list them. The gap stays with the parked "no Jest in CI" finding |
| **Q-9** | Moot. #130 is merged and slice 2 has its own branch off `main`. Update the header's Branch line and R-10 (S-6) |

### The one-slice decision (estimate ≈ 3.75 days)

**Accepted as one slice. The 2a/2b split is not required.** 3.75 days is within the user's "a few days". Slice 2 has two acceptance criteria (AC-3, AC-29), and slice 3 needs both before it records a charge. Splitting would add a second SA/QA/RM cycle for about one day of low-risk work (2a), and both halves edit `aiActionAudit.ts`. The risky part (the shared provider layer) is already isolated by the evidence rules in T9 and P-1, so a separate PR buys little review clarity. **Tripwire:** if actual effort passes about 4.5 days, Dev stops and reports to TL instead of pushing on. The §8 seam (2a = T3 without item 2, T5, T7; 2b = the rest) is the fallback, and 2a can then ship alone.

### Findings

#### Conditions of approval (fold into the workplan before T4; SA verifies at code review)

| # | Finding |
|---|---|
| **C-1** | **Rule 7 turns a silent $0 into a free action.** Rule 7 reads: absent signal, `costUsd === 0`, re-check `priced` → `measured` (0). For a record with **tokens > 0**, that outcome is contradictory. A model that is priced (> 0 on both sides, per D-0 C-1) cannot cost exactly 0 for non-zero tokens unless it was **unpriced at call time**. That happens when a cold instance has not loaded a DB-only model's price yet, the cache warms between the call and the end of the action, and the re-check then reads "priced". That is SA-S2's named residual hole ("a model priced only in the DB when a cold instance's pricing load failed"). As planned it would be charged 0, not flagged and not logged. **Fix:** in rule 7, a re-check of `priced` gives `measured` **only when tokens are 0**. With tokens > 0, it gives `conservative_fallback` with a reason such as `zero_cost_with_tokens` (or reuse `priced_but_zero`), using the conservative token rate, and it is logged by the hook. Rewrite the §5.2 row accordingly. "An Anthropic-style record is not over-charged" is then proved by an absent record **with `costUsd > 0`** (rule 6) and by a zero-token, re-check-priced record (measured 0). Add the tokens > 0, re-check-priced case as a new test that must come out flagged. SQ-13 (2) is unaffected: a correctly priced non-OpenAI call always has `costUsd > 0` and never reaches this branch |
| **C-2** | **The lookup must be total, because it runs inside `callWithTracking`'s `try`.** `extractMetrics` is evaluated at `baseProvider.ts:107`, inside the `try`. If it throws, a call the provider already **billed** is recorded in `token_usage` as a **failure at $0**, and the error is re-thrown to the caller. This runs on every OpenAI call in the product, agents included. `getPriceStatusSync` must therefore never throw for any input: an `undefined` or non-string model or provider, or an empty string. Guard with `typeof` checks and return `'unpriced'`; do not rely on `startsWith` only being reached after a hit. Add to `pricing.test.ts`: `getPriceStatusSync(undefined as unknown as string, …)` and a non-string model both return `'unpriced'` without throwing. P-1 then covers the numeric side and C-2 covers the control-flow side, and together they are an adequate proof for a change on the product-wide hot path. Do **not** add a `try` around it in the provider: a total function keeps the provider diff to the planned one field per path |
| **C-3** | **Replace `npx tsc --noEmit` in T0, T8 and §5.3 with a scoped program.** The full program runs out of memory at the default heap (verified above). Use a scratch tsconfig **outside the repo** (for example in the session scratchpad, never committed) with `extends` pointing at the worktree's `tsconfig.json`, `compilerOptions: { incremental: false, noEmit: true }`, `include: []`, and `files` = `next-env.d.ts` plus **every file created or modified** in §3, production and test. Run it before the edit (T0) and after it (T8). **Pass means:** no error in any created or modified file, and the set of errors elsewhere in the closure identical before and after. Compare the set as file + TS code + message, not as a count, so that a fixed error cannot hide a new one. Today that outside set is exactly the 6 in `lib/analytics/aiAnalytics.ts`. Record both outputs in the evidence. `npx next build` (T8) also needs `NODE_OPTIONS=--max-old-space-size=6144` locally, as CI uses |

#### Should-fix

| # | Finding |
|---|---|
| **S-1** | Hook placement per the Q-1 ruling: a separate `try/catch`, placed after `emitAiAuditEntry`. §5.2's test (classifier forced to throw → value, error and queued audit entry unchanged) stays and now proves it. Add `accountId` (already in `ctx`) to the logged fields. It is an id, not owner text |
| **S-2** | Module split per the Q-1 ruling. Compute the conservative rates **lazily** (on first call, not at module load), so a test that partially mocks `SystemConfigRepository` cannot break on import. T4's grep extends to "nothing outside tests imports `chargePricing.ts`". Both new modules are under `lib/business-os/llm/`, so `typecheck:bos-llm` covers them. Confirm with `--list` that both are in scope, and that `check:bos-llm-literals --list` scans the one that imports the catalog |
| **S-3** | **Existing mocks of the modules you are extending.** Nine suites in `lib/business-os/llm/__tests__/` mock `@/lib/ai/pricing` with factories that lack `getPriceStatusSync` and `inCodeTokenPrices`: `callParams.boundary.step2`, `callParams.boundary.step3`, `callParams.snapshot`, `modelOptions`, `modelSettings.off.chat`, `modelSettings.off.nonchat`, `modelSettings`, `modelSettings.wiring.nonchat`, `modelSettingsSeed`. Several of them also mock `SystemConfigRepository`. None of them mocks the OpenAI SDK, so they probably never reach the real OpenAI `extractMetrics`, and `off.nonchat` runs `runAiAction` with no calls. Confirm this at T0/T8 from the suite results rather than assuming it. If any mock needs the new export, that test file joins §3 as a modified file |
| **S-4** | One vocabulary on the charge side. `ClassifiedCall.unit` (`'token' \| 'embedding' \| 'image'`) and `ConservativeRate.kind` (`'text' \| 'embedding' \| 'image'`) name the same three classes differently. Use `'text' \| 'embedding' \| 'image'` for both. `UsageCallPricing.unit` stays `'token' \| 'image'`, the provider-side view, declared once in `usageScope.ts` (D-0 S-1) |
| **S-5** | `inCodeTokenPrices()` returns a **deep-frozen copy**. `FALLBACK_PRICING`'s `as const` is type-only, so freeze each provider map and each `PricingInfo`. The §5.1 test mutates through a cast and asserts that `calculateCostSync` and `getPriceStatusSync` are unaffected |
| **S-6** | Housekeeping. Change the header's Branch line to `feature/business-os-credit-deduction-slice-2` off `main` `3941327f`. Close R-10. Change §1's "checked at `fc1856bd`" to "re-verified at `3941327f` by SA (no cited file changed)". Update T0/T8/§5.3 per C-3 |

#### Notes

- **N-1** Proof that the agent platform is unchanged is **adequate** once C-2 is added. P-1 compares against literals captured before the edit, for the base class (with and without a scope, success and failure) and for all three OpenAI paths. P-2 pins the shared returns. P-3 and P-4 follow by construction, because the charge reads tokens and P-1 proves the tokens identical. P-5 covers return identity and the single `trackAICall` call. C-2 covers the control-flow side.
- **N-2** An accepted residual: a non-OpenAI record with **no** signal and a **partial** row (input > 0, output 0 on a chat model) has `costUsd > 0`, so rule 6 charges it as `measured`, which is understated. DEC-7 refuses such rows for Layer 2-selected models, and slice 4's reconciliation is where to catch the rest. Do not add a re-check to rule 6 (Q-4).
- **N-3** The image conservative rate comes from the **in-code** `IMAGE_FALLBACK_PRICING` maximum ($0.25 today), per SQ-9. An operator-configured per-image price could be higher. That is acceptable, because only a defect reaches the fallback and every such row is flagged.
- **N-4** For slice 3: `bos_llm_call_unpriced` is the **one** `error` event per unpriced call. Slice 3 writes the flag on the charge row and must not add a second `error` line for the same call. If it logs the charge, use `info` and a different event name.
- **N-5** SA signs off the derived conservative figures at code review, from the T9 `conservativeRateDerivation()` output, with the source model per side (D-0 S-3).
- **N-6** Rule order is accepted as written (malformed, then failed, then signal, then absent), with C-1 applied to rule 7. Rule 3 on the full recorded input tokens (ignoring the cached discount) is correct: the conservative path is meant to over-, never under-charge (KI-9).

### Business question

None. Every §9 item is technical, and the one-slice decision stays within the user's "a few days" rule.

### Approval

- [x] Workplan approved **with conditions C-1 to C-3**. Proceed to implementation after folding them in, with the Q-1 hook shipped in its own module and its own `try` (S-1, S-2).
- [ ] S-1 to S-6 addressed in the implementation (SA checks at code review). *(Dev: implemented; see "Dev implementation evidence" below.)*

### Dev implementation evidence (for SA code review, 2026-09-28)

*Written by Dev, not SA. Everything below is uncommitted in the worktree; the user reviews the diff before any commit.*

**Conditions and should-fix items, as implemented**

| Item | Where | Proof |
|---|---|---|
| C-1 | `chargeClassification.ts` rule 7: re-check `priced` gives `measured` only when tokens are 0; tokens > 0 gives `conservative_fallback`, reason `zero_cost_with_tokens`, logged by the hook | `chargeClassification.test.ts` rule 7 ("C-1: re-check priced but tokens > 0 is NOT a measured $0"); `chargePricing.test.ts` ("rule 7 + C-1", charged at the provider's own maximum); `aiActionAudit.test.ts` hook test |
| C-2 | `getPriceStatusSync` typeof-guards both inputs and returns `unpriced` for any non-string or empty value, before any lookup. No `try` added in the provider | `pricing.test.ts` "is total": `undefined`, `null`, `42`, `{}`, `[]`, a `Symbol`, `''`, on each side, never throw |
| C-3 | Scoped program in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`, `include: []`, `files` = `next-env.d.ts` + all 16 created/modified code files | Before (9 files that existed): 6 errors, all `lib/analytics/aiAnalytics.ts` (`:357` x2, `:360` x2, `:368` TS7006; `:399` TS2538). After (16 files): **0 errors in any touched file**; the (file, code, message) set elsewhere is **identical** (diffed) |
| Q-1 / S-1 | `reportUnpricedCalls` in its own `try/catch` **after** `emitAiAuditEntry`; logs `accountId` too | `aiActionAudit.test.ts`: order test (`['audit', 'check']`); a throwing check leaves the value, the thrown error and the queued entry unchanged |
| Q-1 (b) / S-2 | `chargeClassification.ts` imports `@/lib/ai/pricing`, `@/lib/logger` and types only; `aiActionAudit.ts` imports it. `chargePricing.ts` holds the lazily computed rates; **no non-test file imports it** (grep) | `chargePricing.test.ts` loads the module with `SystemConfigRepository` mocked as `{}` without throwing. `typecheck:bos-llm --list` shows both modules (`core`); `check:bos-llm-literals --list` shows both `checked` |
| Q-2 | `lookupPricingSync` extracted verbatim (cache, then in-code); warn text and level unchanged | 5 pins added to `pricing.test.ts` and run green **on the old code first**, then unchanged after the extraction (priced sync/async, zero tokens, unpriced + one warn with the same text/level/fields, DB row wins, DB row at 0) |
| Q-5 | `asUsd`: `toFixed(10)`, trailing zeros trimmed down to 6 decimals, never exponent notation | `aiCostPrecision.render.test.tsx`: `0.003502` → `$0.003502` (as before), `0.0035024`, `2e-7` → `$0.0000002`, `0`, `0.3`, `1.5`, `1e-10` → `$0.0000000001` |
| S-3 | The nine suites mocking `@/lib/ai/pricing` | All pass unchanged; no mock needed the new exports, so none joined §3 (`callParams.boundary.step2` fails **before and after** on the same pre-existing briefing prompt-hash snapshot; see Gates) |
| S-4 | `ChargeKind = 'text' \| 'embedding' \| 'image'` for `ClassifiedCall.kind` and `ConservativeRate.kind`; `UsageCallPricing.unit` stays `'token' \| 'image'` in `usageScope.ts` | Types |
| S-5 | `inCodeTokenPrices()` returns a deep-frozen copy | `pricing.test.ts`: writes through a cast throw `TypeError` at all three levels; `calculateCostSync`, `getPriceStatusSync` and a fresh copy are unaffected |
| S-6 | Branch line, R-10, R-5, §1 re-verified line | This document |

**Agent platform unchanged (§5.3)**

- **P-1:** the `trackAICall` payloads were captured from the **unmodified** code at T0 (a throwaway capture test, deleted after use) and are asserted as literals: base class with and without a signal, success and failure, inside and outside a scope (`usageScope.test.ts` (iii)); OpenAI chat priced / unpriced / failure, embedding, image priced / unpriced (`openaiProvider.priceStatus.test.ts`). No payload carries `pricing`.
- **P-2:** the T1 pins (above).
- **P-5:** `usageScope.test.ts` (v): same return value, exactly one `trackAICall` per call.
- **`baseProvider.ts` diff** is three additions: the type import, the optional `pricing` field on `extractMetrics`' return type, and one conditional spread in the **success** `notifyUsage`. No line in the failure branch or in either `trackAICall` call changed.
- **No production `runAiAction(` call site changed:** all 8 `runAiAction(` lines in the diff are in `aiActionAudit.test.ts`.
- **Untouched:** `CreditService.ts`, `pricingConfig.ts`, `app/api/run-agent/**`, `lib/analytics/**`, `GeneratedImageService.ts`, `EmbeddingService.ts`, `SystemConfigRepository.ts`, the four other providers, `supabase/migrations/**`, `scripts/**`, `.github/**`, the requirement doc. `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` passes with its snapshot unchanged.

**Conservative rates, from `conservativeRateDerivation()` (for SA sign-off, N-5)**

| Kind | Provider | Scope | Rate | Source |
|---|---|---|---|---|
| text | openai | provider | $0.03 in / $0.18 out per 1k | `gpt-5.4-pro` / `gpt-5.4-pro` |
| embedding | openai | provider | $0.00013 in per 1k | `text-embedding-3-large` |
| text | anthropic | provider | $0.015 in / $0.075 out per 1k | `claude-opus-4-1-20250805` / same |
| text | google | provider | $0.00125 in / $0.005 out per 1k | `gemini-1.5-pro` / same |
| text | kimi | provider | $0.00115 in / $0.008 out per 1k | `kimi-k2-turbo-preview` / same |
| text | `*` | all_providers (groq, mistral, any unknown) | $0.03 in / $0.18 out per 1k | `openai:gpt-5.4-pro` / same |
| embedding | `*` | all_providers | $0.00013 in per 1k | `openai:text-embedding-3-large` |
| image | `*` | all_providers | $0.25 per image | `gpt-image-1:1024x1536:high` |

Ties go to the first entry in table order (openai input 0.03 is also `gpt-4`; anthropic 0.015/0.075 is also `claude-opus-4-20250514` and `claude-3-opus-20240229`; the image $0.25 is also `1536x1024:high`). The test recomputes every figure from the tables; none is typed.

**Gates**

| Gate | Before (T0) | After (T8) |
|---|---|---|
| Jest: `lib/ai lib/business-os/llm app/admin/audit-trail app/api/website/media/generate app/api/cron/insight-detect lib/analytics` (+ after: `GeneratedImageService`, `EmbeddingService` suites) | 29 suites, 519 tests: 518 pass, **1 pre-existing failure** | 36 suites, 651 tests: 650 pass, **the same 1 failure** |
| The pre-existing failure | `callParams.boundary.step2` › `briefing/daily_narration` snapshot: the briefing prompt hash differs (received `sha256:cc293d7b… (len 3126)` vs stored `8134ca45… (len 8413)`) | Identical received hash. Not caused by this slice (it fails on the untouched `3941327f`); flagged for TL, not fixed here |
| `npm run typecheck:bos-llm` | 288 files, 28 errors, 0 new | **293 files** (+ the 5 new), 28 errors, **0 new**; baseline sha256 `d81772b0…29f2` unchanged |
| `npm run check:bos-llm-literals` | 46 files, 0 violations | **48 files** (+ both new modules), 0 violations |
| Scoped type program (C-3) | 6 errors, all outside | 0 in touched files; outside set identical |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`, CI placeholder env) | — | **Passes**: "Compiled successfully", exit 0. The error-level lines in the log are the usual `DYNAMIC_SERVER_USAGE` messages from page-data collection, which existing routes catch and log. `chargePricing.ts` is imported by no production module, so it is not bundled; `aiActionAudit.ts` → `chargeClassification.ts` adds only the pricing reader to its graph, and the admin page imports neither |

**The new and extended Jest suites are local-only** (no CI job runs Jest, SA Q-8). QA must run: `lib/ai/__tests__/pricing.test.ts`, `lib/ai/__tests__/usageScope.test.ts`, `lib/ai/providers/__tests__/openaiProvider.priceStatus.test.ts`, `lib/business-os/llm/__tests__/chargeClassification.test.ts`, `lib/business-os/llm/__tests__/chargePricing.test.ts`, `lib/business-os/llm/__tests__/priceCoverage.test.ts`, `lib/business-os/llm/__tests__/aiActionAudit.test.ts`, `app/admin/audit-trail/__tests__/aiCostPrecision.render.test.tsx`.

**Deviations from the plan**

- `priceCoverage.test.ts` item 1 asserts one extracted literal per occurrence of the key (a non-literal occurrence fails as `null`), rather than hard-coding "2"; today it finds 2.
- `classifyCallForCharge` rule 4 also flags a signal-`priced` **image** at cost 0 (an image has no tokens, so "tokens > 0" could never fire for it). Unreachable today (the image signal is `priced` only when cost > 0); a backstop in the same spirit.
- An unreadable signal (a `pricing` value that is not `{ status: priced|unpriced, unit: token|image }`) is classified `malformed` (rule 1), not "absent".
- `chargePricing.ts` carries `import type {} from './callCatalog'` solely so `check:bos-llm-literals` scans it (its scope rule is "imports the catalog"); a comment says why. The alternative, a `LITERAL_SCOPE_INCLUSIONS` entry, would touch `scripts/**`.
- `chargeClassification.ts` imports the `AiActionType` type from `aiActionAudit.ts` (a type-only cycle, erased at compile time).
- The capture of the `trackAICall` literals used a throwaway test file in the worktree, deleted in the same command; nothing of it remains.

### SA code review (2026-09-28)

**Code Review by SA — 2026-09-28**, worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-2` @ `3941327f`, uncommitted diff (9 modified files, +558/−27, plus 2 new modules and 6 new test suites). No deletion-without-insertion in `git diff HEAD --stat`.
**Status:** 🔄 **APPROVED WITH CONDITIONS.** No blocking finding. One should-fix (SF-1) must land **before RM commits**. It changes no runtime behaviour, so **QA may start now** in parallel.

#### Verdict in one paragraph

The diff does what the workplan and the SA rulings say, and nothing else. No shared pricing function returns anything new. `lookupPricingSync` is a verbatim extraction: I compared it line by line with `calculateCostSync` at `3941327f`, and the lookup order, the `undefined` cases, the warn text and the level are unchanged. `trackAICall` never receives `pricing`, and neither `trackAICall` call nor the failure branch of `callWithTracking` has a changed line. The one product-wide addition, `getPriceStatusSync` inside OpenAI's `extractMetrics`, is total: it is typeof-guarded before any lookup, `isInputOnlyPricedModel` is only reached with strings, and `> 0` is false for `NaN`. So it cannot turn a billed call into a recorded $0 failure (C-2). Its cost is one `Map.get` and one small object per OpenAI call. The hook sits in its own `try` after `emitAiAuditEntry` and before the result or error is returned, and it logs ids only. The audit cost is 10 dp, still `schema: 1`, with no backfill. The admin formatter renders micro-rounded entries byte-identically and cannot produce exponent notation. The standards hold: Pino only (0 `console.*` in the diff or the new modules), no `any` added, no DB access added, and the naming follows the conventions.

#### Conditions and rulings verified

| Item | Result | How SA verified it |
|---|---|---|
| **C-1** | ✅ | `chargeClassification.ts:153-157`: absent signal + cost 0 + re-check `priced` gives `measured` **only** when tokens are 0. Tokens > 0 gives `conservative_fallback` / `zero_cost_with_tokens`, which `reportUnpricedCalls` logs because it logs every `conservative_fallback`. Tests exist in the classifier, resolver and audit suites |
| **C-2** | ✅ | `pricing.ts:289-299`: `typeof` and empty-string guards come before `lookupPricingSync`. **No `try` in any provider.** The "is total" test covers `undefined`, `null`, a number, `{}`, `[]`, a `Symbol` and `''` on both sides |
| **C-3** | ✅ | **SA re-ran the scoped program independently** (own scratch tsconfig outside the repo; `files` = `next-env.d.ts` + all 16 touched code files; 6 GB heap). Result: **0 errors in touched files**, and the only errors are the 6 pre-existing ones in `lib/analytics/aiAnalytics.ts`. This matches Dev's T0 set |
| **Q-1 / S-1** | ✅ | Own `try/catch`, **after** `emitAiAuditEntry`, before `if (!outcome.ok) throw`. Logs `accountId`. Order test `['audit','check']`. A throwing hook leaves the value, the thrown error and the queued entry unchanged |
| **Q-1 (b) / S-2** | ✅ | `chargeClassification.ts` imports pricing, logger and types only. `aiActionAudit.ts` imports only that module, so `SystemConfigRepository` stays out of the 16 actions' graph. `chargePricing.ts` rates are lazy (`getRates()`). Grep: **no non-test importer** of `chargePricing` / `priceActionForCharge`. `typecheck:bos-llm --list` shows both modules as `core`, and `check:bos-llm-literals --list` shows both as `checked` (but see SF-1 for how `chargePricing.ts` gets there) |
| **S-3** | ✅ | All nine named suites pass. There is also a **tenth** `@/lib/ai/pricing` mock that S-3 did not list, `scripts/__tests__/bos-llm-settings.test.ts`. It also passes, and it needs no change (N-3) |
| **S-4** | ✅ | `ChargeKind = 'text' \| 'embedding' \| 'image'` is used on both charge-side types. `UsageCallPricing.unit` stays `'token' \| 'image'`, declared once in `usageScope.ts` |
| **S-5** | ✅ | `inCodeTokenPrices()` returns a deep-frozen copy (three levels). A test writes through a cast and shows that lookups are unaffected |
| **S-6** | ✅ | Header, R-5, R-10 |
| No new return shapes | ✅ | `calculateCost`, `calculateCostSync`, `resolveImagePrice` (file not touched) and OpenAI's private `calculateCost` (not touched) all keep their shapes. `GeneratedImageService`, `EmbeddingService`, `SystemConfigRepository`, the other four providers, `CreditService`, `pricingConfig`, `run-agent`, `lib/analytics/**`, `scripts/**` and `supabase/**` are all untouched |
| Image path | ✅ | `priceFor` is still called once. The status is `cost > 0`: a `NaN` cost records exactly what it recorded before and classifies as `malformed` |
| Audit | ✅ | `Math.round(cost * 1e10) / 1e10`. Field name and type are unchanged, `schema: 1`, no backfill. The pins moved as Q-6 ruled, and AC-29 is covered by two tests |
| Admin formatter | ✅ | `toFixed(10)`, then trailing zeros are trimmed down to 6 decimals. I traced the regex by hand: `0.003502` → `$0.003502`, `1.5` → `$1.500000` and `0` → `$0.000000`, all identical to the old `toFixed(6)`. `0.0000000001` is left alone. Exponent notation is impossible below 1e21 |

#### §5.3 agent-platform proof: independently re-verified

Dev's literals were captured from a deleted throwaway test, so SA did not take them on trust. I made a **temporary clean worktree at `3941327f`** in the session scratchpad (since removed, and `git worktree list` is clean). Against the **unmodified** code, I ran:
- `openaiProvider.priceStatus.test.ts` with only the `pricing` assertions stripped. **All 9 pass.** The chat (priced, unpriced, failure), embedding and image (priced, unpriced) `trackAICall` literals are exactly what the old code records.
- The extended `usageScope.test.ts`, unchanged. **15/16 pass.** The only failure is "(i) reaches the scope record unchanged", which is expected: the old code does not forward `pricing`. The base-class literals, (iii), and return identity with a single `trackAICall` per call, (v), all hold on the old code.

So P-1 is proved against the old code, not against itself. P-2 comes from the pins, and P-3 and P-4 follow by construction, because the agent charge reads tokens and P-1 proves the tokens are identical. P-5 and P-6 hold. **Nothing in this diff can change whether an agent-platform call succeeds or fails, what it returns, or what `token_usage` records.** The added latency is one synchronous `Map.get` per OpenAI call and one synchronous loop per Business OS action.

#### Gates re-run by SA

| Gate | Result |
|---|---|
| Jest: `lib/ai lib/business-os/llm app/admin/audit-trail app/api/website/media/generate app/api/cron/insight-detect lib/analytics lib/services scripts/__tests__/bos-llm-settings.test.ts` | 59 suites, 970 tests: **969 pass, 1 fail**. The failure is `callParams.boundary.step2 › briefing/daily_narration` |
| That one failure | **Confirmed unrelated.** It fails identically on the clean `3941327f` worktree (same received hash, `sha256:cc293d7b… (len 3126)`, vs stored `8134ca45… (len 8413)`, 1 of 78 tests). No prompt or briefing file is in this diff. It is a prompt-hash snapshot drift already on `main`, and TL should route it (a `fix/dated-snapshots` worktree exists and may already own it) |
| `npm run typecheck:bos-llm` | 293 files, 28 errors, **0 new**, passed. It also prints "1 baseline entry is fixed" (`app/api/onboarding/build/route.ts` TS18047), a file outside this diff (N-4) |
| `npm run check:bos-llm-literals` | 48 files, 0 violations, passed. `--list` shows both new modules as `checked` |
| Scoped type program (C-3) | 0 errors in touched files; outside set = the 6 in `aiAnalytics.ts` |
| `next build` | **Not re-run by SA.** Dev's evidence is accepted: it passed, `chargePricing.ts` has no production importer, and the admin page imports neither new module. QA may re-run it |

#### Rulings on Dev's six deviations

| # | Deviation | Ruling |
|---|---|---|
| 1 | Rule 4 also flags a signal-`priced` image at cost 0 | **Accepted.** It is the same contradiction for a unit that has no tokens. It is unreachable today, because the image signal is `priced` only when cost > 0. As a backstop, it errs towards over-charging and is flagged |
| 2 | An unreadable `pricing` value is classified `malformed` | **Accepted.** Treating it as "absent" would send it to rule 6, where a positive cost is charged as `measured`. That is quietly trusting a corrupt record. `malformed` is loud and conservative, which is the correct direction |
| 3 | `import type {} from './callCatalog'` in `chargePricing.ts`, so the literal check scans it | **Not accepted as the final form. See SF-1.** It works today, but it is the weakest possible hook into scope. It is an empty import that an IDE's "organize imports" or a future unused-import lint would delete **silently**, and the file would then drop out of the gate without anything failing. The gate already has the prescribed mechanism for exactly this case, a file one hop from the catalog: `LITERAL_SCOPE_INCLUSIONS` in `scripts/lib/bos-llm-scope.ts`. With that, a removed target fails hard (`staleInclusions`), and the list is pinned by equality in the gate's suite, so the scope change stays visible. `chargeClassification.ts`'s own `import type { BosLlmArea }` is a **real** import and stays as it is |
| 4 | Type-only cycle `chargeClassification.ts` ↔ `aiActionAudit.ts` (`AiActionType`) | **Accepted.** `import type` is always erased, so there is no runtime cycle and the jest spy test proves the value import works. If a value import is ever needed in that direction, move `AiActionType` to a types module first |
| 5 | Embedding coverage counts one extracted literal per occurrence, not a hard-coded 2 | **Accepted, and it is better than the plan.** Each occurrence yields a literal or `null`. `not.toContain(null)` catches a refactor to an identifier, and `>= 1` catches a renamed key. It is count-matched by construction |
| 6 | Throwaway capture test, deleted | **Accepted.** The method was sound (capture from old code, assert as literals), and SA re-proved the literals against the clean `3941327f` (above), so nothing rests on an artefact that no longer exists |

#### Findings

**Blocking:** none.

**Should-fix (before RM commits; QA can start):**

| # | File | Finding | Priority |
|---|---|---|---|
| SF-1 ✅ | `lib/business-os/llm/chargePricing.ts:21-24`; `scripts/lib/bos-llm-scope.ts:210-216`; `scripts/__tests__/check-bos-llm-literals.test.ts:386` | Replace the empty `import type {} from './callCatalog'` with a `LITERAL_SCOPE_INCLUSIONS` entry for `lib/business-os/llm/chargePricing.ts`, with a reason in the house style ("charge policy: reaches the catalog through chargeClassification; must never write a model id or a price"). Update the equality pin at `:386` in the same change. **SA authorises this `scripts/**` touch**; it amends §3's "deliberately not touched" list for these two files only. Re-run `check:bos-llm-literals -- --list` and record that `chargePricing.ts` shows `included` and that the count line shows 2 included by name | Medium |

**SF-1 resolved (Dev, 2026-09-28), uncommitted.** The change is one removal, one list entry and its pin:

- `chargePricing.ts`: the empty `import type {} from './callCatalog'` and its 3-line comment are gone. The file no longer names `callCatalog` anywhere.
- `scripts/lib/bos-llm-scope.ts`: a second `LITERAL_SCOPE_INCLUSIONS` entry for `lib/business-os/llm/chargePricing.ts`, with the reason "Business OS credit deduction charge policy: reaches the catalog through chargeClassification, so the direct-import rule misses it, but it prices an action for a charge and must never write a model id or a price."
- `scripts/__tests__/check-bos-llm-literals.test.ts`: the equality pin is now `[ADMIN_ROUTE, CHARGE_PRICING]` (test renamed "names exactly these files, each with a reason"), and the real-entry test also asserts `scopedFiles()` contains `CHARGE_PRICING`.

Evidence:

| Check | Result |
|---|---|
| `npm run check:bos-llm-literals -- --list` | `included lib/business-os/llm/chargePricing.ts`; `checked lib/business-os/llm/chargeClassification.ts`; count line `48 files in scope, 2 exempt, 2 included by name`; exit 0 |
| `npm run check:bos-llm-literals` | `48 files in scope, 2 exempt, 0 violations`; passed. Scope is unchanged at 48: the file entered by name instead of by the empty import |
| `npm run typecheck:bos-llm` | `293 files in scope, 28 errors, 0 new`; passed. The fixed baseline entry in `app/api/onboarding/build/route.ts` is still reported and was **not** updated (N-4) |
| `npx jest scripts/__tests__/check-bos-llm-literals.test.ts lib/business-os/llm/__tests__/chargePricing.test.ts` | 2/2 suites, 85/85 tests pass |
| `console.*` | `chargePricing.ts` 0, `check-bos-llm-literals.test.ts` 0, `scripts/lib/bos-llm-scope.ts` 1 (line 66, `console.error` of a tsconfig diagnostic in the CLI script library). Reported, not converted: script CLI output, outside this slice |

**SF-1 verified (SA, 2026-09-28), from the diff.** ✅ No conditions remain; the SA code-review verdict is now **APPROVED**.

| Check | Result |
|---|---|
| `git diff HEAD --stat -- scripts/` | Exactly two files: `scripts/lib/bos-llm-scope.ts` (+5, one new `LITERAL_SCOPE_INCLUSIONS` entry with a house-style reason) and `scripts/__tests__/check-bos-llm-literals.test.ts` (+6/-4, pin `[ADMIN_ROUTE, CHARGE_PRICING]`, `scopedFiles()` contains `CHARGE_PRICING`, `staleInclusions` still `[]`). Nothing else under `scripts/**` changed, so the SA-authorised touch stayed within its two files |
| `chargePricing.ts` | No `import type {}` and no mention of `callCatalog`; imports are `pricing`, `usageScope` (type), `SystemConfigRepository` and `chargeClassification` only |
| `npm run check:bos-llm-literals -- --list` (SA re-run) | `included lib/business-os/llm/chargePricing.ts`; count line `48 files in scope, 2 exempt, 2 included by name` |
| `npm run check:bos-llm-literals` (SA re-run) | `48 files in scope, 2 exempt, 0 violations`; passed |
| `npx jest scripts/__tests__/check-bos-llm-literals.test.ts` (SA re-run) | 1/1 suite, 67/67 tests pass (consistent with Dev's 85 across two suites) |

The `console.error` at `scripts/lib/bos-llm-scope.ts:66` is pre-existing CLI output in a script library that this change touches only to add a list entry. SA accepts leaving it as reported, not converted, for this slice.

**Notes (no action in slice 2):**

| # | Note |
|---|---|
| N-1 | **For slice 3 and any Layer 2 provider widening:** `groqProvider.ts:157` hardcodes `cost = 0` ("Actually free!"). A Business OS call on Groq with tokens > 0 would therefore land on rule 7 on every call, be logged as `bos_llm_call_unpriced`, and in slice 3 be charged at the `*` text rate (the OpenAI maximum). That is **unreachable today**, because `ALLOWED_PROVIDERS_LAYER2 = ['openai']` (`modelSettingsPolicy.ts:30`). Before any area is allowed onto Groq, either Groq must record a real cost or the allow-list must refuse it. Record this in slice 3's workplan |
| N-2 | The conservative rate comes from the **in-code** table only (SQ-9). A model priced **only in the DB** above the in-code maximum for its provider would be under-charged by the fallback. This mirrors N-3 of the workplan review for images and is accepted for the same reason: only a defect reaches the fallback, and every such row is flagged |
| N-3 | `scripts/__tests__/bos-llm-settings.test.ts` is a tenth `@/lib/ai/pricing` mock without the new exports, and it was not in S-3's list. It passes and never reaches the new code. No change is needed |
| N-4 | `typecheck:bos-llm` reports a fixed baseline entry in `app/api/onboarding/build/route.ts`, which is not in this diff. Do **not** run `--update-baseline` in this PR |
| N-5 | Once this ships, operators will see `bos_llm_call_unpriced` at `error` whenever a Business OS OpenAI call runs on a model without a usable price. That is the intended AC-3 behaviour. QA's live check should confirm that a normal chat turn emits **none** |
| N-6 | `google` has in-code rows but no provider implementation, so its derived rate is inert. This is harmless |

#### Fallback figures: SA sign-off (N-5 of the workplan review)

I recomputed each figure by hand from `FALLBACK_PRICING` (`pricing.ts:41-112`) and `IMAGE_FALLBACK_PRICING` (`SystemConfigRepository.ts:68-78`), and every one matches `conservativeRateDerivation()`:

| Kind | Provider | Rate | Source | Signed off |
|---|---|---|---|---|
| text | openai | $0.03 / $0.18 per 1k | `gpt-5.4-pro` both sides (input tie with `gpt-4`, first in table order) | ✅ |
| embedding | openai | $0.00013 per 1k | `text-embedding-3-large` | ✅ |
| text | anthropic | $0.015 / $0.075 per 1k | `claude-opus-4-1-20250805` (ties with `claude-opus-4-20250514` and `claude-3-opus-20240229`) | ✅ |
| text | google | $0.00125 / $0.005 per 1k | `gemini-1.5-pro` | ✅ (inert, N-6) |
| text | kimi | $0.00115 / $0.008 per 1k | `kimi-k2-turbo-preview` (ties with `-thinking-turbo`) | ✅ |
| text | `*` (groq, mistral, unknown) | $0.03 / $0.18 per 1k | `openai:gpt-5.4-pro` | ✅ (see N-1) |
| embedding | `*` | $0.00013 per 1k | `openai:text-embedding-3-large` | ✅ |
| image | `*` | $0.25 per image | `gpt-image-1:1024x1536:high` (ties with `1536x1024:high`) | ✅ |

Every conservative rate is ≥ every priced code default of its kind (asserted in `priceCoverage.test.ts` item 4). The OpenAI text fallback is about 12× `gpt-4o` input and 18× its output. That over-charge is deliberate (SQ-9, KI-2, R-3): after this slice, only a defect reaches it, and every such call is flagged and logged. A tie resolves to the first entry in table order, which has no effect on the figure.

#### Code Approved for QA: **Yes**

QA may start now. The new and extended suites are **local-only** (no CI job runs Jest) and QA must run them (list above). SF-1 must be done, with the literal-check `--list` evidence recorded, before RM commits. SA re-checks SF-1 from the diff; no full re-review is needed.

---

## 12. QA Testing Report

### QA report (2026-09-28)

**QA — 2026-09-28**, worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction-slice-2` @ `3941327f`, uncommitted diff including SF-1.
**Test mode:** full
**Strategy used:** A + B (Jest unit and integration through the real `BaseAIProvider` / `OpenAIProvider` with the SDK mocked), C (temporary QA test files, deleted after the run, with a before/after comparison against a temporary clean `git worktree` at `3941327f`, also removed), and the CI gates plus `next build`. There is no E2E; the live check is optional per §5.3 and was not run (see Edge cases).
**Focus:** api, schema, performance (shared provider hot path), security (no owner text in logs)
**Skipped:** the live `/test-business-os` and `/admin/audit-trail` check (optional; needs a signed-in session and a real key). Everything it would show is covered by the render test and the F-tests below.
**Input source:** prompt keywords (TL brief) + workplan §5

#### Scope

AC-3 (FR-12a, b, e) and AC-29 (FR-12g) from the requirement's slice 2; workplan §5.1–§5.3; SA C-1, C-2, S-3, SF-1; the ask that the agent platform is unchanged.

#### Commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npx jest` on the 8 new or extended suites (§11 list) + `scripts/__tests__/check-bos-llm-literals.test.ts` | **9/9 suites, 226/226 tests pass** |
| 2 | `npx jest lib/ai lib/business-os/llm app/admin/audit-trail scripts/__tests__/check-bos-llm-literals.test.ts scripts/__tests__/bos-llm-settings.test.ts` | 33 suites, 684 tests: **683 pass, 1 fail** = `callParams.boundary.step2 › briefing/daily_narration` (pre-existing; see #4) |
| 3 | The ten `@/lib/ai/pricing` mocks (the nine S-3 suites + `scripts/__tests__/bos-llm-settings.test.ts`), run on the slice **and** on the clean `3941327f` | Both trees: 10 suites, 271 tests, **270 pass, the same 1 fail**. Every other suite passes on both |
| 4 | `callParams.boundary.step2 -t daily_narration` on both trees | **Identical** failure on both: stored `sha256:8134ca45… (len 8413)`, received `sha256:cc293d7b… (len 3126)`. Confirmed pre-existing on `main`, unrelated to slice 2; excluded |
| 5 | `npx jest app/api/website/media/generate app/api/cron/insight-detect lib/analytics lib/services/__tests__` (other readers of the audit field, the `trackAICall` snapshot, `GeneratedImageService`, `EmbeddingService`) | **27/27 suites, 353/353 tests pass** |
| 6 | `npm run typecheck:bos-llm` | `293 files in scope, 28 errors, 0 new`; **passed** (it still prints the fixed baseline entry `app/api/onboarding/build/route.ts` TS18047, outside this diff, SA N-4; not updated) |
| 7 | `npm run check:bos-llm-literals` / `-- --list` | `48 files in scope, 2 exempt, 0 violations`; **passed**. `--list`: `checked chargeClassification.ts`, `included chargePricing.ts`, `2 included by name` (SF-1 holds) |
| 8 | `npx next build` with `NODE_OPTIONS=--max-old-space-size=6144` and the placeholder env from `.github/workflows/build.yml` | **`✓ Compiled successfully`, exit 0.** 78 `DYNAMIC_SERVER_USAGE` error lines from page-data collection, the usual caught-and-logged ones (including `/admin/audit-trail`'s `requireAdminPage`). `/admin/audit-trail` built as `ƒ` (10.2 kB) |
| 9 | Grep for non-test importers of `chargePricing` / `priceActionForCharge` | None: only a comment in `chargeClassification.ts` and the `LITERAL_SCOPE_INCLUSIONS` entry. 0 `console.*` in both new modules |

#### Failure-path evidence (independent, temporary QA suite, 34/34 pass, deleted)

A temporary `lib/business-os/llm/__tests__/zzqa_slice2_failurePaths.test.ts` drove the **real** `OpenAIProvider` (SDK mocked) through the real `runAiAction`, with only `AuditTrail.log` and the logger faked. It was deleted straight after the run.

| # | Check | Result |
|---|---|---|
| F1 | Unpriced model (`gpt-qa-nonexistent`) end to end | `getPriceStatusSync` → `unpriced`. The scope record carries `{ unpriced, token }`, `costUsd` 0. `priceActionForCharge` → `conservative_fallback` / `unpriced` / `text`, `isFallbackPriced: true`, `fallbackCallCount: 1`, and a cost equal to 1000 input + 500 output tokens at the OpenAI text maximum, **recomputed in the test** from `inCodeTokenPrices()` (not from `chargePricing`). Exactly one `error` with `event: 'bos_llm_call_unpriced'` naming provider, model, area, actionType, groupId and accountId, reason `unpriced`. The prompt text is in no log line |
| F2 | `getPriceStatusSync` with `undefined`, `null`, `0`, `42`, `NaN`, `{}`, `[]`, an object whose `toString` throws, a function, `''`, `true`, on each side and both | **Never throws**; always `unpriced`. Controls: `gpt-4o` and `text-embedding-3-small` are `priced` |
| F3 | C-1: absent signal, tokens > 0, cost 0, on a **priced** model (`openai/gpt-4o`, `anthropic/claude-opus-4-1-20250805`, `openai/text-embedding-3-small`) | `conservative_fallback` / `zero_cost_with_tokens` (kind `text`, `text`, `embedding`); `priceActionForCharge` flags it and prices it > 0; the hook logs it at `error`. A signal-`priced` record at $0 with tokens → `conservative_fallback` (rule 4). Controls: zero tokens + re-check priced → `measured` 0; absent + cost > 0 → `measured` at the recorded cost, not flagged (no over-charge of non-OpenAI providers) |
| F4 | `reportUnpricedCalls` forced to throw | The action's return value and its queued audit entry are **deep-equal** to the same action run with a working hook; `AuditTrail.log` still called once; the "Checking the AI action for unpriced calls failed" error is logged. A thrown action error is re-thrown as the **same** object, and the entry is still queued |
| F5 | AC-29 through the real OpenAI **embedding** path: 10 tokens of `text-embedding-3-small` in `runAiAction` | Stored `estimatedCostUsd` = `Math.round(calculateCostSync(...) * 1e10) / 1e10` = `0.0000002`, **> 0**, `schema: 1`; no `bos_llm_call_unpriced` for a priced embedding |
| F6 | Admin `asUsd`, evaluated from the regex in `page.tsx`'s own source | `0.003502` → `$0.003502`, `1.5` → `$1.500000`, `0` → `$0.000000`, `2e-7` → `$0.0000002`, `1e-10` → `$0.0000000001`, `0.0035024` → `$0.0035024`, `0.3` → `$0.300000`, `123456.789012` → `$123456.789012`. **20,000 random micro-rounded values render byte-identical to the old `toFixed(6)`**, and no 10-dp value renders with an exponent |

#### Agent platform unchanged (independent before/after)

A temporary Jest file was run in a temporary clean worktree at `3941327f` (node_modules junctioned, junction then worktree removed; `git worktree list` is clean) and in the slice worktree, each dumping a JSON of:

- `calculateCostSync` and `calculateCost` for 17 provider/model pairs (OpenAI chat, pro, embeddings, unknown, empty; Anthropic; Kimi; Google; Groq; Mistral; an unknown provider) × 4 token pairs, with no DB rows = 136 values;
- the same two functions with DB rows (an override of `gpt-4o`, a DB-only model, a row at 0/0, a code-only model) = 8 values;
- `resolveImagePrice` for all 9 `IMAGE_FALLBACK_PRICING` keys × {no config, config 0.5, config 0} + one unknown key = 28 results;
- the `trackAICall` payloads **outside a usage scope** (the agent path) from the real `OpenAIProvider`: chat priced, chat unpriced (cached input), embedding, image priced, image unpriced, chat failure, plus each call's return value;
- the number of `warn` logs from pricing.

**Result: the two 16,188-byte JSON files are identical** (`diff` empty). `trackAICall` was called 6 times and **no payload has a `pricing` key**; the warn count is the same (108) and pricing logged no new `error`.

#### Findings

**Bugs:** none.

**Performance:** none. The only hot-path addition is one `getPriceStatusSync` (one `Map.get`) per OpenAI call, which is total (F2).

**Edge cases / notes (no action for slice 2):**
1. **Pre-existing, not this slice:** `callParams.boundary.step2 › briefing/daily_narration` prompt-hash snapshot drift fails identically on `main` `3941327f`. It belongs to TL to route (a `fix/dated-snapshots` worktree exists).
2. **Local-only coverage:** no CI job runs Jest, so the 8 new or extended suites are enforced only by the QA runs here. CI enforces only `typecheck:bos-llm` and `check:bos-llm-literals` over the new modules (SA Q-8).
3. **Live check not run** (optional per §5.3). SA N-5 asks that a normal chat turn emits **no** `bos_llm_call_unpriced`; F5 and the audit suite's "silent for priced calls" show that for the priced defaults, and `priceCoverage.test.ts` proves every code default is `priced`. A post-deploy look at the logs for that event is recommended.
4. `asUsd` renders a value below 5e-11 as `$0.000000` (it is rounded away at 10 dp). This is the intended stored precision and matches the audit write (10 dp).

#### Test coverage against the acceptance criteria

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-3: an unpriced model produces an `error` log naming provider, model, area and action | ✅ | Pass | F1; `aiActionAudit.test.ts` hook tests; event `bos_llm_call_unpriced` |
| AC-3: charged the conservative documented fallback, never $0 | ✅ | Pass (mechanism; wired in slice 3 by design) | F1, F3; `chargePricing.test.ts`; rates recomputed from the tables |
| AC-3: every code default priced; per-image price for every default model/size/quality | ✅ | Pass | `priceCoverage.test.ts` + the existing `modelSettingsPolicy.test.ts:342-375` (in run #2) |
| AC-29: a ~$0.0000002 embedding stores a non-zero cost | ✅ | Pass | F5 through the real OpenAI path; `aiActionAudit.test.ts` |
| AC-29: failed call at $0 → KI-8 known issue with SA sign-off | ✅ | Pass (documented branch) | Failure branch of `baseProvider.ts` unchanged (diff review; failure `trackAICall` payload identical before/after) |
| AC-29: agent platform charge unchanged | ✅ | Pass | Before/after JSON identical; no `pricing` in `trackAICall`; token counts identical, and `run-agent` charges tokens |
| Admin formatter (SQ-14 (3)): old values unchanged, never exponent | ✅ | Pass | F6 + `aiCostPrecision.render.test.tsx` |
| Regression: the nine `@/lib/ai/pricing` mocks + `bos-llm-settings.test.ts` | ✅ | Pass | Run #3, same results on the clean base |

#### Final status

**Verdict: PASS WITH NOTES.** Every slice 2 acceptance criterion passes, with no bug. The notes are the pre-existing `daily_narration` snapshot failure (not this slice), the Jest suites being local-only, and the optional live check not run. QA changed no production or test code; both temporary QA test files and the temporary worktree were removed.

- [x] All acceptance criteria pass — ready for commit (after the user reviews the diff; SF-1 is verified by SA)
- [ ] Issues found — Dev must address before commit

---

## 13. Commit Info

*(RM to populate. Dev does not commit. Changes stay uncommitted until the user has reviewed the diff.)*

---

## 14. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | Slice 2 workplan from the requirement's §12 slice 2 and SQ-8, SQ-9, SQ-13, SQ-14, SQ-16. Reuses D-0's verified facts and SA conditions (C-1 zero price is not `priced`; C-2 base-class proof with explicit `trackAICall` literals; C-3 enforced guard stated). Changes from D-0: a separate read-only status lookup instead of a new return shape; absent signal re-checked; the loud log made live through one hook in `runAiAction` (Q-1); existing Layer 2 coverage tests reused; audit cost at 10 dp with the admin formatter as the one UI exception. ≈ 3.75 days, no split proposed. Nine questions (Q-9 for TL/RM). No `console.*` debt in any file to be modified |
| 2026-09-28 | SA workplan review | Reviewed at `3941327f` (no cited file changed since `fc1856bd`). **APPROVED WITH CONDITIONS**, one slice accepted (≈ 3.75 days, tripwire at ~4.5 days → stop and report to TL; the 2a/2b seam is the fallback). **C-1:** rule 7 must not give `measured` 0 for a record with tokens > 0 that re-checks as priced; that case is flagged conservative (SA-S2's cold-cache hole). **C-2:** `getPriceStatusSync` must be total, because `extractMetrics` runs inside `callWithTracking`'s `try` on every OpenAI call. **C-3:** the full `npx tsc --noEmit` runs out of memory, so use a scoped tsconfig over every touched file and compare error sets (baseline: 0 errors in the touched files; 6 pre-existing in `lib/analytics/aiAnalytics.ts`). Q-1: ship the hook now, in its own `chargeClassification.ts` and its own `try` after `emitAiAuditEntry`. Q-2 to Q-8 accepted (Q-9 moot). Should-fix S-1 to S-6, notes N-1 to N-6. No business question |
| 2026-09-28 | Conditions folded in (Dev) | C-1 (rule 7: re-check priced with tokens > 0 → flagged `zero_cost_with_tokens`), C-2 (total lookup, tests), C-3 (scoped type program replaces `tsc --noEmit`; `next build` with a 6 GB heap) folded into §2.1, §2.3, §2.4, §3, §4, §5. Q-1 module split (`chargeClassification.ts` + `chargePricing.ts`), S-1 placement and `accountId`, S-4 one charge-side vocabulary. S-6: Branch line, R-10 and R-5 closed |
| 2026-09-28 | Implemented (Dev) | T0–T10 done, uncommitted. New `chargeClassification.ts` + `chargePricing.ts`; `getPriceStatusSync` / `inCodeTokenPrices` in `pricing.ts`; signal on OpenAI chat, embeddings and images; hook live in `runAiAction`; audit cost at 10 dp; admin formatter. Evidence, gates and the derived rates recorded in §11 for SA code review |
| 2026-09-28 | SA code review | **APPROVED WITH CONDITIONS; code approved for QA.** C-1, C-2, C-3, Q-1/S-1, S-2 to S-6 verified. SA re-ran the scoped type program, `typecheck:bos-llm` (0 new), `check:bos-llm-literals` (0 violations) and 59 Jest suites (969/970). The one failure, `callParams.boundary.step2 › briefing/daily_narration`, fails identically on a clean `3941327f` and is unrelated. P-1 was re-proved independently: the captured `trackAICall` literals pass against the unmodified code. Deviations 1, 2, 4, 5 and 6 are accepted. Deviation 3 (the empty `import type {}` to enter the literal check) is replaced by **SF-1**: a `LITERAL_SCOPE_INCLUSIONS` entry plus its equality pin, SA-authorised `scripts/**` touch, due before RM commits. Fallback figures signed off (N-5). Notes N-1 (Groq hardcodes cost 0, unreachable while Layer 2 is OpenAI-only, for slice 3) to N-6 |
| 2026-09-28 | SF-1 applied (Dev) | Removed the empty `import type {} from './callCatalog'` from `chargePricing.ts`; added its `LITERAL_SCOPE_INCLUSIONS` entry in `scripts/lib/bos-llm-scope.ts` and updated the equality pin in `check-bos-llm-literals.test.ts`. `--list` shows `chargePricing.ts` as `included` and `2 included by name`; literal check 48 in scope, 0 violations; `typecheck:bos-llm` 0 new; 2 suites, 85/85 tests. Uncommitted; SA re-checks from the diff |
| 2026-09-28 | SF-1 verified (SA) | SA re-checked from the diff: `scripts/**` diff is exactly `bos-llm-scope.ts` and `check-bos-llm-literals.test.ts`; `chargePricing.ts` no longer references `callCatalog`. SA re-ran `check:bos-llm-literals -- --list` (`chargePricing.ts` included, 2 included by name), the check itself (48 in scope, 0 violations) and the gate suite (67/67). Verdict moves from APPROVED WITH CONDITIONS to **APPROVED**; the RM-commit precondition is met, and QA remains the next gate |
| 2026-09-28 | QA report | **PASS WITH NOTES.** 9 new/extended suites 226/226; wider run 683/684 (the one failure, `callParams.boundary.step2 › briefing/daily_narration`, is identical on a clean `3941327f` and excluded); the ten `@/lib/ai/pricing` mocks pass the same on both trees; 27 related suites 353/353; `typecheck:bos-llm` 0 new; `check:bos-llm-literals` 0 violations, `chargePricing.ts` included by name; `next build` exit 0. An independent temporary suite (34/34, deleted) proved the unpriced path, a total `getPriceStatusSync`, C-1, a throwing hook leaving the result and entry unchanged, AC-29 via the real embedding path, and the admin formatter. The before/after dump of `calculateCost`/`calculateCostSync`/`resolveImagePrice`/`trackAICall` against a temporary clean worktree was identical, with no `pricing` in `trackAICall`. No bugs. Notes: the pre-existing snapshot drift, Jest local-only, and the optional live check not run |
