# Workplan: Business OS Credit Deduction — Slice D-0 (Rules, and a trustworthy cost)

> **Last Updated**: 2026-09-28

> **SUPERSEDED (2026-09-28):** superseded by [BUSINESS_OS_CREDIT_DEDUCTION_SLICE_1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_1_WORKPLAN.md) (slice 1) and slice 2's future workplan. Kept for its verified facts and SA rulings; do not implement from it.

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §9 slice D-0, FR-4, FR-12, and the **SA Review (2026-09-28) → "D-0 scoping for the Dev workplan"**, which is binding here.
**Branch:** `feature/business-os-credit-deduction` (worktree `neuronforge-llm-deduction`, created before this workplan; Dev did not create it)
**Date:** 2026-09-28
**Status:** Planning (awaiting SA workplan review; nothing is implemented and nothing is committed)

## Overview

D-0 is the first slice of the Business OS deduction layer. It adds **no charging, no ledger, no migration, no UI and no runtime behaviour change**. It lays down two foundations that later slices need.

1. **The rules:** one typed, declared list for every `AiActionType`. Each entry gives its area, its audience, whether it is setup AI, whether it is charged, its diary labels, and whether a template fallback exists. A guard test keeps the list complete.
2. **A trustworthy cost:** under option B, the measured cost *is* the charge, so a silent $0 would give the AI away for free. D-0 proves that every code-default model is priced and adds an optional "unpriced" signal on the in-process call record. It also adds the conservative fallback price function, which is pure and not yet called by anything. D-1 wires it.

This workplan follows the `bos-llm-call-standards` skill (Standards 4, 5, 6, 7, 8). D-0 adds and changes no LLM call, so Standards 1–3 are only checked for regressions.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Task List](#4-task-list)
5. [Test Plan](#5-test-plan)
6. [Out of Scope](#6-out-of-scope)
7. [Risks](#7-risks)
8. [Open Questions for SA](#8-open-questions-for-sa)
9. [Flagged Items (console.* and deprecated code)](#9-flagged-items-console-and-deprecated-code)
10. [SA Workplan Review](#10-sa-workplan-review)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)
13. [Change History](#13-change-history)

---

## 1. Analysis Summary

I checked every path, type and function below in this worktree at `7120adee`.

| Concern | As-built | Evidence |
|---|---|---|
| The action type union | `AiActionType`: 16 string literals, 2 of them dormant (`website_section_field_rewrite`, `website_block_enrichment`). Type-only, so there is no runtime list | `lib/business-os/llm/aiActionAudit.ts:38-54` |
| Stale header | "NOT WIRED YET … nothing calls `runAiAction` in production". It is wired at 16 call sites: 14 live and 2 for the dormant types (see the next row) | `aiActionAudit.ts:12-14` |
| Where each type is run (area, trigger) | chat-v4 `chat` / user; insight-detect cron `insights` / scheduled; BriefingStore `briefing` / caller's trigger; intake form + infer-question `intake` / user; onboarding build `website` / user; onboarding chat `onboarding` / user; website regenerate, testimonial, full site, landing page `website` / user; media generate `images` / user; MutateExecutor `website` / user; LeadAlertService `leads` / **external**; WebsiteBlockEnrichmentService and WebsiteSectionService `website` / user (dormant) | `app/api/business-os/chat-v4/route.ts:397`, `app/api/cron/insight-detect/route.ts:373`, `lib/business-os/briefing/BriefingStore.ts:71`, `app/api/intake/form/generate/route.ts:55`, `app/api/intake/form/infer-question/route.ts:76`, `app/api/onboarding/build/route.ts:1000`, `app/api/onboarding/chat/route.ts:223`, `app/api/website/blocks/[blockId]/regenerate/route.ts:78`, `app/api/website/enhance-testimonial/route.ts:41`, `app/api/website/generate-from-profile/route.ts:85`, `app/api/website/landing-pages/generate/route.ts:116`, `app/api/website/media/generate/route.ts:55`, `lib/business-os/bizql/mutate/MutateExecutor.ts:832`, `lib/services/LeadAlertService.ts:345`, `lib/services/WebsiteBlockEnrichmentService.ts:273`, `lib/services/WebsiteSectionService.ts:530` |
| Lead reply has no template fallback | When the model returns nothing, `markFailed('generation_failed')` and **no reply is queued** | `LeadAlertService.ts:355-366` |
| The per-call record | `UsageCallRecord`: feature, component, provider, model, sessionId, tokens, `costUsd`, success, errorCode. There is no price-status field | `lib/ai/usageScope.ts:40-56` |
| Where the record is produced | `BaseAIProvider.callWithTracking` calls `notifyUsage` once per call: success at `:112-123` with `metrics.cost`, failure at `:166-177` with `costUsd: 0`. `extractMetrics` returns `{ inputTokens, outputTokens, cost, responseSize?, cachedInputTokens? }` | `lib/ai/providers/baseProvider.ts:76-178` |
| OpenAI cost paths | chat `:206-228` and embeddings `:254-272` use the private `calculateCost` (`:551-572`) → `calculateCostSync`. The image path `:299-316` uses `priceFor(result.quality)` | `lib/ai/providers/openaiProvider.ts` |
| Shared pricing | `calculateCostSync` reads the cache, then `FALLBACK_PRICING`, else **warns and returns 0** (`:267-270`). `calculateCost` async does the same (`:228-231`). `FALLBACK_PRICING` is **not exported**. `isInputOnlyPricedModel` is exported (`:111-113`) | `lib/ai/pricing.ts` |
| Image pricing | `resolveImagePrice` gives config > 0, then `IMAGE_FALLBACK_PRICING`, then `{ 0, 'unpriced' }` with an error log. The `imagePriceResolver` wrapper returns 0 if it throws. `ImagePriceSource = 'config' \| 'fallback' \| 'unpriced'` | `lib/services/GeneratedImageService.ts:94-118`, `:143-176` |
| Image defaults | `IMAGE_GENERATION_CONFIG_DEFAULTS` (model `gpt-image-1`, sizes `1536x1024` / `1024x1536` / `1024x1024`, quality `auto`). `IMAGE_FALLBACK_PRICING` has 9 keys, $0.011–$0.25 | `lib/repositories/SystemConfigRepository.ts:46-79` |
| Layer 2 code defaults | `BOS_LLM_CALL_POLICY` (every configurable call, with `kind: 'token' \| 'image'`) and `IMAGE_PRICE_REQUIRED_QUALITIES` | `lib/business-os/llm/modelSettingsPolicy.ts:193-251`, `:280` |
| DEC-7 runtime gate (DB-selected models) | `checkTokenModel` refuses `unpriced_model` / `zero_price`, and `checkImageModel` refuses `image_price_missing`. Tested at `modelSettings.test.ts:231-281` | `lib/business-os/llm/modelSettings.ts:281-327` |
| Embedding default | Written as a literal default of the `helpbot_embedding_model` key, twice. Not exported | `lib/services/EmbeddingService.ts:111-115`, `:168-172` |
| Diary-label pattern | Catalog entries carry `labels: { en, he, es }`. The type is `Labels`, in a types-only file with no imports | `lib/business-os/entitlements/config/catalog.ts:294`, `lib/business-os/entitlements/types.ts:80-85` |
| Gate scope | `typecheck:bos-llm` scopes every file under `lib/business-os/llm/` (`SCOPED_DIRS`), so any new file there is gated automatically | `scripts/typecheck-bos-llm.ts:102-106`; `package.json:27-28` |
| Other providers | Anthropic, Groq, Kimi and Mistral each extend `BaseAIProvider` directly, not `OpenAIProvider`. An optional metrics field leaves them untouched | `lib/ai/providers/*.ts` |

---

## 2. Implementation Approach

### 2.1 The declared action list (FR-4, SA D-0 item 1)

- **Where:** a new module, `lib/business-os/llm/aiActionDeclarations.ts`, next to `aiActionAudit.ts`.
- **Dependency-free:** it has **type-only** imports (`AiActionType` from `./aiActionAudit`, `BosLlmArea` from `./callCatalog`, `Labels` from `@/lib/business-os/entitlements/types`). All three are erased at compile time. So D-2's diary UI can import it without pulling in the server-only audit module. That is the PR #53 hazard named in Standard 6. A guard test enforces it.
- **Shape:**

  **File:** `lib/business-os/llm/aiActionDeclarations.ts` (proposed)
  ```typescript
  export type AiActionAudience = 'owner' | 'client';
  export type AiTemplateFallbackStatus = 'exists' | 'missing' | 'n/a';

  export interface AiActionDeclaration {
    area: BosLlmArea;               // the area runAiAction is called with today
    audience: AiActionAudience;
    isSetup: boolean;               // FR-23 pre-warning class (BD-3)
    isCharged: boolean;             // option B: every declared type is charged
    diaryLabels: Labels;            // en / he / es — the catalog's label pattern
    templateFallback: AiTemplateFallbackStatus; // 'n/a' for owner-facing
    isDormant?: true;               // KI-4: declared and labelled, no production trigger
  }

  export const AI_ACTION_DECLARATIONS = { /* 16 entries */ } as const satisfies Record<AiActionType, AiActionDeclaration>;
  ```
- **The key is the action type itself.** It is already a stable identifier, and it is the key the audit entry and the D-1 ledger will carry. I am not adding a second `diaryLabelKey` string: it would be a hand-typed duplicate that could drift. Labels are inline, following the catalog's pattern. They do **not** go into `LanguageContext.tsx` (see §9). SA Q-6 asks whether a separate key is wanted.
- **Audience is not added to the entitlements catalog, and `ai.actions` is not renamed** (SA "avoid" list). `atLimit: 'by_call_site_audience'` will resolve through this list in D-3.

**The proposed values** (labels are drafts; BA/user may reword them before D-2 surfaces them):

| `AiActionType` | Area | Audience | Setup | Charged | Fallback | en / he / es label (draft) |
|---|---|---|---|---|---|---|
| `chat_turn` | chat | owner | no | yes | n/a | Chat assistant reply / תשובה מעוזר הצ׳אט / Respuesta del asistente de chat |
| `chat_website_operation` | website | owner | no | yes | n/a | Website change via chat / שינוי באתר דרך הצ׳אט / Cambio en el sitio por chat |
| `insight_run` | insights | owner | no | yes | n/a | Business insights check / בדיקת תובנות עסקיות / Revisión de información del negocio |
| `briefing_narration` | briefing | owner | no | yes | n/a | Daily briefing / תדריך יומי / Resumen diario |
| `website_full_site` | website | owner | **yes** | yes | n/a | Website generation / יצירת אתר / Generación del sitio web |
| `website_landing_page` | website | owner | no | yes | n/a | Landing page generation / יצירת דף נחיתה / Generación de página de destino |
| `website_field_regenerate` | website | owner | no | yes | n/a | Website text rewrite / שכתוב טקסט באתר / Reescritura de texto del sitio |
| `website_testimonial_enhance` | website | owner | no | yes | n/a | Testimonial polish / שיפור המלצה / Mejora de testimonio |
| `website_section_field_rewrite` *(dormant)* | website | owner | no | yes | n/a | Website section rewrite / שכתוב מקטע באתר / Reescritura de sección del sitio |
| `website_block_enrichment` *(dormant)* | website | owner | no | yes | n/a | Website content enrichment / העשרת תוכן האתר / Enriquecimiento del contenido del sitio |
| `intake_form_generation` | intake | owner | **yes** | yes | n/a | Intake form generation / יצירת טופס קליטה / Generación de formulario de admisión |
| `intake_question_inference` | intake | owner | no | yes | n/a | Intake question suggestion / הצעת שאלה לטופס קליטה / Sugerencia de pregunta de admisión |
| `onboarding_build` | website | owner | **yes** | yes | n/a | Business setup build / בניית העסק בהקמה / Configuración inicial del negocio |
| `lead_reply_recommendation` | leads | **client** | no | yes | **missing** | Automatic lead reply / מענה אוטומטי לפנייה / Respuesta automática a prospecto |
| `onboarding_turn` | onboarding | owner | **yes** | yes | n/a | Setup conversation / שיחת הקמה / Conversación de configuración |
| `image_generation` | images | owner | no | yes | n/a | AI image / תמונת AI / Imagen con IA |

- **Audience:** this follows SA's SQ-12 ruling. `lead_reply_recommendation` is the only client-facing type.
- **Setup:** this follows §5's "Setup (onboarding, first website / intake generation, regenerations)" read **per type**. Whether a particular invocation is the owner's *first* one is a per-instance fact, and D-3 decides it (SA Q-3).
- **Lead reply fallback (SA D-0 item 2):** recorded as `missing`, with a code comment citing `LeadAlertService.ts:355-366` (no reply is queued when the model returns nothing) and OI-1. **It is not built here.** That is D-3.

### 2.2 Price coverage (FR-12e restated by SA-S2, SA D-0 item 3)

A new test, `lib/business-os/llm/__tests__/priceCoverage.test.ts`, asserts against the **in-code** tables only (no DB, deterministic):

- **Token defaults:** for every call in `BOS_LLM_CALL_POLICY` whose `kind === 'token'`, the default `provider:model` has an in-code price with `input > 0` **and** `output > 0`. That is the same "both sides" rule DEC-7 applies (`modelSettings.ts:304-305`).
- **Image defaults:** for `IMAGE_GENERATION_CONFIG_DEFAULTS.model` × every distinct value of `IMAGE_GENERATION_CONFIG_DEFAULTS.sizes` × `IMAGE_PRICE_REQUIRED_QUALITIES`, `resolveImagePrice({}, model, size, quality)` returns `source !== 'unpriced'` and `usdPerImage > 0`. The test also asserts that the default image policy's model equals `IMAGE_GENERATION_CONFIG_DEFAULTS.model`, so the two cannot diverge.
- **The embedding default:** the excluded chat calls use `EmbeddingService`'s default for `helpbot_embedding_model`, which is a literal there and is not exported. The test reads `lib/services/EmbeddingService.ts` as text and extracts every default passed for that key. It asserts there is at least one, and that each has an in-code price with `input > 0` (input-only, per `isInputOnlyPricedModel`). I chose not to export a constant, because that would touch `EmbeddingService` for a test's sake (SA Q-5).
- **DEC-7 is referenced, not duplicated.** A header comment names `modelSettings.test.ts:231-281` as the runtime guarantee for DB-selected models. It lists SA-S2's residual holes (an excluded call's model, a DB-only price on a cold instance, a call site outside Layer 2) and says which one this test closes.
- **Needs** one additive, read-only accessor in `pricing.ts` (§2.4).

### 2.3 The unpriced signal (SA-S3, SA D-0 item 4)

- **`UsageCallRecord` gains one optional, product-agnostic field** (`lib/ai/usageScope.ts`):
  ```typescript
  /** How the provider priced this call, where it says so. Absent = the provider does not report it. */
  pricing?: { status: 'priced' | 'unpriced'; unit: 'token' | 'image' };
  ```
  - `unit` is needed because an unpriced image has zero tokens. A token-rate fallback would charge it $0, which is exactly the hole FR-12 closes.
- **`BaseAIProvider.callWithTracking` forwards it and does nothing else.** `extractMetrics` may return an optional `pricing`. The **success** `notifyUsage` payload includes it only when present (a conditional spread). It is **not** passed to `trackAICall`, so `token_usage` records exactly what it records today. The failure path is unchanged. This is the one unavoidable edit outside `openaiProvider`: without it the signal cannot reach the scope. See Risk R-1.
- **`OpenAIProvider` sets it on all three paths:**
  - **chat and embeddings:** the private `calculateCost` returns `{ costUsd, priced }` from the new `calculateCostSyncWithStatus` (§2.4). `extractMetrics` sets `cost: costUsd` (the same number as today) and `pricing: { status: priced ? 'priced' : 'unpriced', unit: 'token' }`.
  - **image:** `resolveImagePrice` returns 0 only when unpriced, and the resolver wrapper returns 0 only on a throw. So `pricing: { status: cost > 0 ? 'priced' : 'unpriced', unit: 'image' }`. **`GeneratedImageService` and the `ImagePriceResolver` type are not touched.**
- `anthropicProvider`, `kimiProvider`, `groqProvider` and `mistralProvider` are **not touched**. The field is optional, so they compile unchanged, and their records carry no `pricing`.
- The audit entry is unaffected. `buildAiAuditEntry` builds `details` field by field, and `pricing` is not one of them. The `schema: 1` details stay byte-identical (the existing `aiActionAudit.test.ts` pins them).

### 2.4 Additive changes in `lib/ai/pricing.ts`

Nothing any existing function returns changes (SA "avoid" list):

| Change | Why | Return values |
|---|---|---|
| New `calculateCostSyncWithStatus(provider, model, in, out): { costUsd: number; priced: boolean }`, holding today's `calculateCostSync` body. `calculateCostSync` becomes `return calculateCostSyncWithStatus(...).costUsd` | One lookup and one missing-price log per call, and no second lookup that could drift from the first | `calculateCostSync` unchanged, pinned by a new test for priced, unpriced and cached cases |
| New `inCodeTokenPrices(): Readonly<Record<string, Readonly<Record<string, { input: number; output: number }>>>>`, a frozen copy of `FALLBACK_PRICING` | The coverage test (§2.2) and the conservative rate (§2.5) must be **computed from the table, never hand-typed** (SQ-9) | new function only |
| *(Optional, SA D-0 item 6)* The two `logger.warn(..., 'No pricing found; recording $0 for this call')` become `logger.error`. That is `calculateCost` `:229` and the sync body `:268` | FR-12a: an unpriced model fails loudly. **Level only**: message, fields and return unchanged. `pricing.ts` has 0 `console.*` | unchanged |

`calculateCost` (async) is not otherwise touched. `calculateCostSync`'s agent-platform callers see identical numbers.

### 2.5 The conservative fallback price (SQ-9, SA D-0 item 5)

- **Where:** a new module, `lib/business-os/llm/chargePricing.ts`. It is pure (no I/O) and **nothing calls it** until D-1. Logger: `createLogger({ module: 'BosChargePricing' })`.
- **The conservative rates are computed once, lazily, from the in-code tables:**
  - **text:** per provider, the maximum `input` and the maximum `output` per 1k tokens over `inCodeTokenPrices()[provider]`, excluding input-only models (`isInputOnlyPricedModel`). For `openai` today that is input 0.03 and output 0.18 per 1k. Both maxima come from `gpt-5.4-pro`, so the pair equals one real model's rate.
  - **embedding:** per provider, the maximum `input` over input-only models. For `openai` that is 0.00013 per 1k (`text-embedding-3-large`).
  - **image:** the maximum value in `IMAGE_FALLBACK_PRICING`, which is $0.25 today. OpenAI is the only image provider (`callCatalog.ts:82`).
  - **A provider missing from the in-code table** uses the maximum across all providers for that kind (SA Q-2).
  - Each derivation is exported as a small descriptor: kind, provider, rate, and the model the rate came from. It feeds the SA sign-off and a future FR-33 report.
- **API:**

  **File:** `lib/business-os/llm/chargePricing.ts` (proposed)
  ```typescript
  export interface ChargeContext { area: BosLlmArea; actionType: AiActionType; groupId: string }
  export type CallChargeBasis = 'measured' | 'failed_call' | 'conservative_fallback';
  export interface PricedCall { costUsd: number; basis: CallChargeBasis; fallbackReason?: 'unpriced' | 'price_status_unknown' }
  export interface PricedAction { costUsd: number; isFallbackPriced: boolean; fallbackCallCount: number }

  export function priceCallForCharge(call: UsageCallRecord, ctx: ChargeContext): PricedCall;
  export function priceActionForCharge(calls: readonly UsageCallRecord[], ctx: ChargeContext): PricedAction;
  export function conservativeRateDerivation(): readonly ConservativeRate[];
  ```
- **Rules, in order:**
  1. `success === false` → `costUsd` as recorded (0), basis `failed_call`, **not** flagged. N-3: a failed call is charged what we measured.
  2. `pricing.status === 'priced'` → `costUsd` as recorded, basis `measured`.
  3. `pricing.status === 'unpriced'` → the conservative rate for `pricing.unit`. Tokens use embedding or text by `isInputOnlyPricedModel`, charged on the **full** recorded input tokens. Images use the image max × 1. Basis `conservative_fallback`, reason `unpriced`.
  4. `pricing` absent (a provider that does not report it) and `costUsd > 0` → `measured`. A price was found.
  5. `pricing` absent, `costUsd === 0`, success → the proposal is: if tokens > 0, charge the conservative text/embedding rate with reason `price_status_unknown`. If tokens are 0, charge 0 but still flag it and log at error. **SA to rule (Q-1).**
- **Precision (SQ-8):** summed from the raw per-call `costUsd`, **never rounded**, and **never** taken from the audit's micro-dollar-rounded `estimatedCostUsd`. A test pins that a 1e-7 USD embedding stays non-zero.
- **The loud log (FR-12a/c):** one `logger.error` per fallback-priced call, with `{ event: 'bos_charge_fallback_priced', provider, model, area, actionType, groupId, callName: call.component, unit, reason, conservativeCostUsd }`.
  - The stable `event` field makes "how many charges were guessed?" countable from logs.
  - Only ids and model names are logged. Never a prompt or any owner text (Standard 5).
- **Model and price literals:** the module contains **no** model or price literals (Standard 8 and CLAUDE.md rule 5). Every figure is derived, and `check:bos-llm-literals` scans it because it imports the catalog.

### 2.6 The stale header (SA-S12, SA D-0 item 7)

Replace `aiActionAudit.ts:12-14` ("NOT WIRED YET…") with an accurate note. `runAiAction` is wired at 16 call sites (14 live, plus the two dormant types, whose call sites have no production trigger). Point to `aiActionDeclarations.ts` as the per-type list. **Comment only.** No code line in the file changes.

### 2.7 Why these phases and files (root cause)

Not V6. The Business OS "phase" that owns a wrong charge is the cost figure. A silent $0 starts in `calculateCostSync`'s return, and the fix mandated by SA-S3 is to **signal** it upward rather than change the shared return. That makes the signal's source `openaiProvider`, its carrier the usage scope, and its consumer a Business OS function. The agent platform sees no numeric change.

---

## 3. Files to Create / Modify

| File | Action | Reason | `console.*` |
|---|---|---|---|
| `lib/business-os/llm/aiActionDeclarations.ts` | create | Declared per-type list (§2.1) | — |
| `lib/business-os/llm/__tests__/aiActionDeclarations.test.ts` | create | Guard test (§5) | — |
| `lib/business-os/llm/chargePricing.ts` | create | Conservative fallback, pure, unwired (§2.5) | — |
| `lib/business-os/llm/__tests__/chargePricing.test.ts` | create | Unit tests (§5) | — |
| `lib/business-os/llm/__tests__/priceCoverage.test.ts` | create | Code-default price coverage (§2.2) | — |
| `lib/ai/providers/__tests__/openaiProvider.priceStatus.test.ts` | create | Signal set on chat / embedding / image; ledger payload unchanged | — |
| `lib/ai/usageScope.ts` | modify | Optional `pricing` on `UsageCallRecord` (type only) | 0 |
| `lib/ai/providers/baseProvider.ts` | modify | Optional `pricing` in `extractMetrics`; forwarded to the success `notifyUsage` only | 0 |
| `lib/ai/providers/openaiProvider.ts` | modify | Sets `pricing` on 3 paths; private `calculateCost` returns status | 0 |
| `lib/ai/pricing.ts` | modify | `calculateCostSyncWithStatus`, `inCodeTokenPrices`; optionally warn→error | 0 |
| `lib/ai/__tests__/pricing.test.ts` | modify | Pin `calculateCostSync` unchanged; test the two new functions (+ the log level, if item 6 is taken) | — |
| `lib/ai/__tests__/usageScope.test.ts` | modify | A record's `pricing` survives the scope; absent stays absent | — |
| `lib/business-os/llm/aiActionAudit.ts` | modify | Header comment only (§2.6) | 0 |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md` | create | This document | — |

**Deliberately not touched:** every `runAiAction` call site, `runAiAction` itself, `AiAuditDetails`, `lib/business-os/entitlements/**` (including `balance.ts`, `EntitlementService.ts`, `enforcementPoints.ts`, `config/catalog.ts`), `lib/services/CreditService.ts`, `lib/utils/pricingConfig.ts`, `lib/services/GeneratedImageService.ts`, `lib/services/EmbeddingService.ts`, `lib/services/LeadAlertService.ts`, `lib/business-os/LanguageContext.tsx`, `anthropicProvider.ts`, `kimiProvider.ts`, `groqProvider.ts`, `mistralProvider.ts`, `scripts/**`, `supabase/migrations/**`.

---

## 4. Task List

Each task is marked ✅ when done. Each ends with its own suite green.

- ⬜ **T0: Baseline.** Record the before state: `npm run typecheck:bos-llm` (0 new, baseline file hash), `npm run check:bos-llm-literals`, and `npx jest lib/business-os/llm lib/ai app/api/business-os/usage lib/services/__tests__`. Record pass counts here.
- ⬜ **T1: Stale header (§2.6).** A comment-only edit in `aiActionAudit.ts`.
- ⬜ **T2: The declared list (§2.1).** Create `aiActionDeclarations.ts` with the 16 entries and the `satisfies Record<AiActionType, AiActionDeclaration>` check, and write the guard test.
- ⬜ **T3: Pricing additions (§2.4).** Add `calculateCostSyncWithStatus` (and make `calculateCostSync` delegate to it) and `inCodeTokenPrices`. Extend `pricing.test.ts`, pinning the old return values first, before the refactor.
- ⬜ **T4: Price coverage (§2.2).** Create `priceCoverage.test.ts`.
- ⬜ **T5: The unpriced signal (§2.3).** Add the optional field to `usageScope.ts`, the forward-only edit to `baseProvider.ts`, and the three paths in `openaiProvider.ts`. Create `openaiProvider.priceStatus.test.ts` and extend `usageScope.test.ts`.
- ⬜ **T6: The conservative price (§2.5).** Create `chargePricing.ts` and `chargePricing.test.ts`. Confirm with a grep that nothing imports `chargePricing` outside its test.
- ⬜ **T7 (optional, SA item 6): Log level.** `pricing.ts` warn→error, level only. The test asserts `error` is called with the same message and fields.
- ⬜ **T8: Gates.** Re-run T0's commands. `typecheck:bos-llm` must show 0 new errors with `scripts/typecheck-bos-llm.baseline.json` unchanged, and `check:bos-llm-literals` must be green. `npx tsc --noEmit` must show no new errors in the touched files. `npx next build` must pass (Standard 6: nothing server-only is reachable from a client module).
- ⬜ **T9: No-behaviour-change evidence for SA.** `git diff --stat` must list only §3's files. Check `git diff --stat` for deletion-without-insertion. A grep must show no `runAiAction(` call site in the diff. The usage-route snapshot and the audit-entry tests must be unchanged. Record all of it in the SA section.
- ⬜ **T10: Handover.** Set the status to Code Complete, leave everything **uncommitted**, and notify TL for the SA code review.

---

## 5. Test Plan

| Suite | Asserts |
|---|---|
| `aiActionDeclarations.test.ts` | (a) **Complete, both ways:** it reads `aiActionAudit.ts` as text, extracts the `AiActionType` union members, and asserts the declared keys are **exactly** that set. Adding a type without an entry fails, and so does a stale entry. `next build` ignores type errors and ts-jest only type-checks the files it compiles, so this runtime check is the guard. (b) Every entry has an area in `BOS_LLM_AREAS`, an audience in `owner \| client`, boolean `isSetup` and `isCharged`, non-empty `en`/`he`/`es` labels, and a fallback status in the enum. (c) `templateFallback === 'n/a'` if and only if `audience === 'owner'`. (d) `lead_reply_recommendation` is `client` + `missing`. (e) The two dormant types are present and marked. (f) Option B: every type has `isCharged === true`. (g) The module has only `import type` statements (a source check), so it is client-safe. |
| `priceCoverage.test.ts` | §2.2: token defaults priced on both sides, image default × sizes × low/medium/high > 0 through `resolveImagePrice`, the embedding default(s) priced on input, the image policy model equal to `IMAGE_GENERATION_CONFIG_DEFAULTS.model`. A self-check proves each assertion can fail: an unknown model is reported as missing. |
| `pricing.test.ts` (extended) | `calculateCostSync` returns the same numbers as before for a priced model, an unpriced model (0), and zero tokens. `calculateCostSyncWithStatus` returns `priced` true/false correctly and logs the missing-price line **once**. `inCodeTokenPrices()` is frozen and a mutation attempt does not affect lookups. (T7) The missing-price line is at `error`. |
| `openaiProvider.priceStatus.test.ts` | Using the `openaiProvider.image.test.ts` harness (the SDK mocked, `trackAICall` observed, a usage scope opened). chat with a priced model gives `pricing {priced, token}` and an unpriced model gives `{unpriced, token}` with `costUsd 0`, unchanged. Embeddings behave the same way. An image priced > 0 gives `{priced, image}`, and `priceFor → 0` gives `{unpriced, image}`. A thrown call's record has **no** `pricing`. **The `trackAICall` payload has exactly the same keys and values as before** (no `pricing` key), which is the `token_usage` invariance proof. |
| `usageScope.test.ts` (extended) | `pricing` is copied into the scope's calls when present and absent when not. |
| `chargePricing.test.ts` | A priced call passes through unchanged. A failed call is 0 and not flagged. An unpriced text call is charged at the computed text maximum and flagged. An unpriced embedding is charged at the embedding maximum. An unpriced image is charged at the image maximum, not 0. An absent-status call follows Q-1's ruling. The conservative rates **equal the maxima recomputed in the test from `inCodeTokenPrices()` / `IMAGE_FALLBACK_PRICING`** and are not compared to typed numbers. `priceActionForCharge` sums raw costs, and a 1e-7 USD call stays non-zero. The `error` log carries `event`, provider, model, area, actionType, groupId and callName, and a sentinel prompt string never reaches any logger level (the Standard 7 pattern). The function never throws on a malformed record (it logs and returns 0 flagged). |
| Unchanged, re-run | `aiActionAudit.test.ts` (details unchanged), `callParams.*`, `modelSettings*.test.ts` (DEC-7), `GeneratedImageService.attribution.test.ts`, `EmbeddingService.attribution.test.ts`, `openaiProvider.image.test.ts`, `app/api/business-os/usage/__tests__/route.test.ts` (snapshot unchanged). |

**Commands**
```bash
npx jest lib/business-os/llm lib/ai lib/services/__tests__ app/api/business-os/usage
npm run typecheck:bos-llm
npm run check:bos-llm-literals
npx next build
```

**Live check:** none is needed. D-0 changes no runtime output: no ledger row, no audit field, no UI. The LLM Usage tab on `/test-business-os` should look identical, and QA may spot-check that.

---

## 6. Out of Scope

| Item | Where |
|---|---|
| Ledger table, RPC, repository, the `action_id` key (**SA-B1**) | D-1 |
| Wiring `chargePricing` into `runAiAction`, and the audit `schema: 2` bump | D-1 |
| Fail-closed vs fail-open on an unreadable balance (**SA-B2**, BQ-1) | D-3 |
| The pre-check in `runAiAction`, restructuring chat-v4's late `setAccount`, `ENFORCEMENT_POINTS` (**SA-B3**) | D-3 |
| Building the lead-reply template fallback (OI-1), the stranger-spend cap (SA-S7) | D-3 |
| The credit value, allowances, and the `ai.actions` unit | D-1b |
| Card and diary UI, placing labels in `LanguageContext` | D-2 |
| Changing `calculateCost` / `calculateCostSync` / `resolveImagePrice` return values, or what `token_usage` records | Forbidden (SA-S3) |
| Pricing rework: cache warming, refresh, cached-input rates (N-4, N-5) | Not planned (SQ-12) |
| `CreditService`, `pricingConfig`, Pilot Credits | Forbidden (A-11) |
| The `console.*` conversion of `anthropicProvider.ts`, `kimiProvider.ts`, `LanguageContext.tsx` | Not touched; see §9 |

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `baseProvider.callWithTracking` is on **every** LLM call in the product, agent platform included | The edit is a conditional spread into the success `notifyUsage` payload only. `notifyUsage` is a no-op outside a scope and never throws. `trackAICall` is untouched, and the test proves its payload is identical |
| R-2 | The `calculateCostSync` delegate refactor could change a number the agent platform charges on | Old values are pinned **before** the refactor (T3). The body is moved verbatim, and the delegate is one line |
| R-3 | warn→error (T7) raises error-level volume on the agent side too (any unpriced Anthropic or Kimi model) | Level only, and SA already accepted it (SA-S3). Optional: SA can drop T7 if error-alerting noise is a concern |
| R-4 | The conservative text rate (openai max, `gpt-5.4-pro`: $0.03 / $0.18 per 1k) is ~12–18× gpt-4o. A fallback-priced chat turn would be heavily over-charged | By design (SQ-9, KI-2). After D-0 only a defect reaches it, and the row is flagged and reconciled. SA signs off the derivation at code review |
| R-5 | The guard test parses `aiActionAudit.ts` source text, which is fragile if the union is reformatted | The parse anchors on the `export type AiActionType =` block and asserts it found ≥ 16 members, so a broken parse fails loudly rather than passing empty. SA Q-4 offers the alternative of a runtime `const` array |
| R-6 | An existing test elsewhere asserts an OpenAI usage-scope record with `toEqual`, so it would fail on the new field | Grep before T5. If one exists, it is updated to include `pricing` (an expected-value change, not a behaviour change) and listed for SA |
| R-7 | Diary label wording is a product decision | Drafts only. Nothing renders them until D-2, and BA/user review the wording then |
| R-8 | Agent file-write truncation (project memory) | T9 checks `git diff --stat` for deletion-without-insertion before any diff review |

---

## 8. Open Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | SA wrote "absent means unknown and is treated conservatively." Does that apply to a **successful** call with no `pricing` and `costUsd > 0`? That covers every non-OpenAI provider, and none of them serves a Business OS call today | `costUsd > 0` → measured, not flagged. `costUsd === 0` with tokens → conservative, reason `price_status_unknown`. `costUsd === 0` without tokens → 0, flagged, error log (the kind cannot be determined) |
| Q-2 | A provider absent from the in-code table: use the cross-provider maximum for that kind? | Yes, logged with the derivation |
| Q-3 | Setup flag per type: `onboarding_turn`, `onboarding_build`, `website_full_site`, `intake_form_generation`. Is "first generation vs regeneration" a per-instance D-3 concern? | Yes. The flag marks the *class*. §5's "regenerations" are also setup, so a `website_full_site` regeneration is setup-flagged too |
| Q-4 | Guard test via source parsing, or turn `AiActionType` into `(typeof AI_ACTION_TYPES)[number]` with a runtime `const` array in `aiActionAudit.ts`? The union stays identical, but the edit is to the audit file | Source parsing. It leaves `aiActionAudit.ts` code untouched in D-0 |
| Q-5 | The embedding default is a literal inside `EmbeddingService`. Is a source-reading test acceptable, or export a named default? | Source-reading test. No `EmbeddingService` edit |
| Q-6 | Diary label key: the action type itself, with labels inline (the catalog pattern), or a separate i18n key string? | The action type itself. No `LanguageContext` edit |
| Q-7 | Conservative "highest rate" means the per-side maximum (input max, output max). Today both come from one model. Agreed? | Yes. It is never lower than any single model in the class |
| Q-8 | SQ-9 says the conservative rate "lives in the pricing module." D-0 item 5 says "a pure Business OS function." Which? | The Business OS module `chargePricing.ts` computes it from `inCodeTokenPrices()`. The shared module gains only a read accessor and no billing policy |
| Q-9 | Take optional T7 (warn→error in `pricing.ts`)? | Yes. Level only |

---

## 9. Flagged Items (console.* and deprecated code)

Per CLAUDE.md § Logging: **every file this workplan modifies has 0 `console.*` calls** (`pricing.ts`, `usageScope.ts`, `baseProvider.ts`, `openaiProvider.ts`, `aiActionAudit.ts`, counted at `7120adee`). So no conversion is owed for D-0.

These files were read or considered but are **deliberately not touched**. They are listed for the user's awareness, not converted:

| File | `console.*` count | Why it is not touched |
|---|---|---|
| `lib/business-os/LanguageContext.tsx` | 9 | The requirement names it as the diary-label home. D-0 keeps labels inline in the declared list instead, which avoids editing it. **If D-2 edits it, the conversion is raised with the user then** |
| `lib/ai/providers/anthropicProvider.ts` | 7 | SA: D-0 must not need it |
| `lib/ai/providers/kimiProvider.ts` | 2 | SA: D-0 must not need it |
| `scripts/typecheck-bos-llm.ts` | 10 | A CLI script (console output is its interface), outside `lib/`/`app/`/`components/`. Not edited: the new files are gated through `SCOPED_DIRS` automatically |

No deprecated system (V1 plugin strategies, direct Supabase outside repositories) is touched or extended.

---

## 10. SA Workplan Review

**Reviewed by SA — 2026-09-28**, against worktree `feature/business-os-credit-deduction` @ `7120adee`.
**Status:** 🔄 **APPROVED WITH CONDITIONS.** Dev may start implementing once conditions C-1 to C-3 are folded into §2, §5 and the task list. No re-review of the workplan is needed. SA checks the conditions at code review.

### Verdict in one paragraph

The plan matches the D-0 scoping in the requirement's SA Review. It is pure code plus tests, with no migration, no UI, and no call-site, `runAiAction`, audit-schema, `balance.ts` or `EntitlementService` change. `calculateCost`, `calculateCostSync` and `resolveImagePrice` return the same values as before, and `token_usage` records the same thing. No price is hand-typed. It applies SA-S2, SA-S3 and SA-S12. The one edit that runs on every LLM call in the product is `baseProvider.callWithTracking`. That edit is correctly scoped: one conditional spread into the `notifyUsage` payload, which is already inside a never-throw `try` in `usageScope.ts:99-126`. It never reaches `trackAICall`, and the other four providers compile unchanged because the new metrics field is optional. The proof test as written only exercises OpenAI, so C-2 widens it to the base class. There is also one real gap in the signal (C-1): a price row that exists but is zero would be reported as `priced`, and that is exactly the silent $0 D-0 exists to close. There is no business question.

### Verified as-built (spot checks)

| Workplan claim | Result |
|---|---|
| §1 `AiActionType` has 16 members, 2 dormant; the header is stale | ✅ `aiActionAudit.ts:38-54`, `:12-14`. There are 16 `runAiAction(` call sites, and every area/actionType pair matches the §2.1 table |
| §1 `callWithTracking`: one `notifyUsage` per call, and `trackAICall` fields are picked one by one (no spread of `metrics`) | ✅ `baseProvider.ts:104-178`. The only callers are the five providers' own methods, all through `callWithTracking` |
| §1 OpenAI cost paths | ✅ chat `:206-228`, embeddings `:254-272`, image `:299-316`, private `calculateCost` `:551-572`. **Note:** it already prices provider-cached input at half the rate. See N-2 |
| §1 `calculateCostSync` / `calculateCost` log at `warn` and return 0; `FALLBACK_PRICING` is not exported | ✅ `pricing.ts:229`, `:267-270`, `:29`. `groq` and `mistral` are **absent** from the table and `google` is present (relevant to Q-2) |
| §1 image pricing | ✅ `GeneratedImageService.ts:102-118`, `:143-176`. `resolveImagePrice` accepts **any** number from the fallback map, zero included (`:113`). See S-2 |
| §1 embedding default | ✅ The literal `'text-embedding-3-small'` appears twice (`EmbeddingService.ts:111-115`, `:168-172`). The file has 0 `console.*` |
| §1 Layer 2 defaults and DEC-7 | ✅ `modelSettingsPolicy.ts:193-251`, `:280`. `checkTokenModel` `:304-305`, `checkImageModel` `:314-327`, and the tests at `modelSettings.test.ts:229-281` |
| §1 `Labels` is in a file with no imports | ✅ `entitlements/types.ts:80-85`. `grep ^import` finds nothing |
| §1 gate scope | ✅ `SCOPED_DIRS` includes `lib/business-os/llm/`. The literal gate counts **type-only** imports (`scripts/lib/bos-llm-scope.ts:107`), so both new modules are in its scope, and test files are excluded |
| §9 `console.*` counts | ✅ 0 in all five files it modifies. 9 / 7 / 2 in `LanguageContext.tsx`, `anthropicProvider.ts` and `kimiProvider.ts`, none of which are touched |
| R-6 strict-equality tests on scope records | ✅ None found. The existing tests use `toMatchObject` or pick fields. `buildAiAuditEntry` reads `UsageCallRecord` field by field (`aiActionAudit.ts:154-201`), so `pricing` cannot leak into `details` |
| **Not claimed, but load-bearing:** Jest in CI | ⚠️ **No workflow runs Jest** (`admin-authz-guard.yml:28`, `react-hooks-guard.yml:18`). `bos-llm-typecheck.yml` (typecheck + literal gate) runs on every PR. See C-3 |

### Rulings on §8

| # | Ruling |
|---|---|
| **Q-1** | **Accepted, with one defensive rule added.** (a) `pricing` absent and `costUsd > 0` → `measured`, not flagged: a positive cost proves a price was found. (b) Absent, `costUsd === 0`, tokens > 0 → `conservative_fallback`, reason `price_status_unknown`, rate chosen by `isInputOnlyPricedModel`. (c) Absent, `costUsd === 0`, no tokens → `costUsd: 0`, **flagged** (`isFallbackPriced`), reason `price_status_unknown`, with an `error` log. It stays visible to the D-1 report and the reconciliation, and it is not invented as a charge. (d) **Added:** `status === 'priced'` with `costUsd === 0` and tokens > 0 is treated as `unpriced`. After C-1 this cannot happen, so the rule is a backstop and is tested once. "Absent means unknown and is treated conservatively" is satisfied: case (a) is not unknown |
| **Q-2** | **Yes.** Use the cross-provider maximum for the kind. The descriptor marks it (for example `scope: 'all_providers'`), and each use logs it inside the `bos_charge_fallback_priced` line. Today that applies to `groq` and `mistral`, which are not in the table. The embedding and image maxima are effectively OpenAI's, because only OpenAI has input-only models and image prices |
| **Q-3** | **Yes.** `isSetup` marks the **class**. Whether a given invocation is the first one or a regeneration is decided per instance in D-3, using the SA-S4 estimate. `website_full_site` stays setup-flagged whether it is a first run or a regeneration. `website_field_regenerate` (a field-level rewrite) is not setup. The flag has no effect before D-3, so BA can reword it in the D-3 revision if needed |
| **Q-4** | **Source parsing is acceptable as a *secondary* guard. `aiActionAudit.ts` code stays untouched in D-0.** The **primary** guard is the compile-time `as const satisfies Record<AiActionType, AiActionDeclaration>`, checked by `typecheck:bos-llm` in CI. `satisfies` on an object literal rejects a missing key **and** an excess key, so it is complete in both directions. The Jest test only runs locally (C-3). **For D-1** (which edits `aiActionAudit.ts` anyway for `schema: 2`), SA recommends inverting the source of truth: `export type AiActionType = keyof typeof AI_ACTION_DECLARATIONS`, re-exported from `aiActionAudit.ts` so the 16 import sites do not change. Completeness then holds by construction. Not in D-0 |
| **Q-5** | **The source-reading test is acceptable, with S-4.** Do not edit `EmbeddingService` in D-0 |
| **Q-6** | **The action type is the key, and labels are inline** (`Labels`, the catalog pattern). No separate i18n key and no `LanguageContext` edit. This fulfils D-0 item 1's "diary-label key" |
| **Q-7** | **Yes. Use the per-side maximum**, which is never lower than any model in the class. With S-3 |
| **Q-8** | **The Business OS module `chargePricing.ts` owns the policy.** `pricing.ts` only gains the read accessor. This **supersedes** the SQ-9 wording "lives in the pricing module". The shared module stays product-agnostic, which is the point of SA-S3 |
| **Q-9** | **Drop T7 in D-0.** The warn→error change is the only D-0 edit with an agent-platform-visible effect: every unpriced Anthropic or Kimi call would start logging at error level. It gives Business OS nothing, because FR-12a's loud failure for a charge is `chargePricing`'s own `error` line. That line carries area, action type and grouping id, which `pricing.ts` cannot know. Remove T7, R-3 and the optional row in §2.4. Raise it again only if an operator asks for it |

### Findings

#### Conditions of approval (fold into the workplan before T3/T5; SA verifies at code review)

| # | Finding |
|---|---|
| **C-1** | **A zero price must not count as `priced`.** As §2.4 is written, `priced` means "a row was found". An `ai_model_pricing` row at 0 (or `input > 0, output 0` on a chat model) would make `calculateCostSyncWithStatus` return `priced: true` with `$0`, and the call would be charged as `measured` at zero. That is the silent $0 FR-12 closes. These rows are not hypothetical: the admin screen's zero-price alert exists for them (`pricing.ts:104-113`). DEC-7 refuses them only for Layer-2-selected models, and the excluded `helpbot_embedding_model` path is exactly SA-S2's residual hole. **Fix:** `priced = found && input > 0 && (output > 0 \|\| isInputOnlyPricedModel(provider, model))`. `costUsd` stays the same number `calculateCostSync` returns today. Add a test for a cached zero row → `priced: false`, cost unchanged |
| **C-2** | **Prove R-1 at the base class, not only through OpenAI.** Add a test with a minimal `BaseAIProvider` subclass (for example `lib/ai/providers/__tests__/baseProvider.pricingPassThrough.test.ts`). It must show: (i) `extractMetrics` without `pricing` → the scope record has **no** `pricing` key (`not.toHaveProperty('pricing')`). This is the shape of all four other providers. (ii) With `pricing`, the field is forwarded unchanged. (iii) In both cases the `trackAICall` payload `toEqual`s an **explicit literal** expected object, with no `pricing` key. Do not compare the new code with itself. Capture the expected shapes in T0, before any edit. (iv) The failure path's record has no `pricing`. (v) Outside a scope, the return value is identical and `trackAICall` is called exactly once. Also, in `openaiProvider.priceStatus.test.ts`, assert that the missing-price log fires **once per call**, so that `extractMetrics` never prices twice. With C-2 in place, the proof is adequate for a change on every call in the product |
| **C-3** | **Say which guard is enforced.** §5(a) says the Jest runtime check "is the guard". No CI workflow runs Jest, so the enforced guard is the `satisfies` clause under `typecheck:bos-llm`. Correct §5(a). In T8, record a **negative proof**: temporarily delete one entry, then add one stray key. Each must make `typecheck:bos-llm` report a new error in `aiActionDeclarations.ts`. Then revert, and the final diff contains neither change. State in T8/T10 that the new Jest suites are local-only and QA must run them |

#### Should-fix

| # | Finding |
|---|---|
| **S-1** | Declare the new shape **once**: `export type UsageCallPricing = { status: 'priced' \| 'unpriced'; unit: 'token' \| 'image' }` in `usageScope.ts`. Reference it from `UsageCallRecord` and from `callWithTracking`'s `extractMetrics` return type (`baseProvider.ts` already imports from `usageScope`). Do not repeat the inline object type |
| **S-2** | The image-status inference (`cost > 0` → priced) is **accepted** instead of threading `ImagePriceSource`. It keeps `GeneratedImageService` untouched, and any zero reads as `unpriced`, which is conservative. But it rests on every `IMAGE_FALLBACK_PRICING` value being > 0, and `resolveImagePrice` would label a 0 fallback `'fallback'`. Pin that assumption in `priceCoverage.test.ts` (every value finite and > 0) and state it in a comment on the image `extractMetrics` |
| **S-3** | The conservative-rate descriptor records the **source model per side** (`inputFrom`, `outputFrom`). Today both are `gpt-5.4-pro`, but a future table can split them, and SA signs off the derivation from the descriptor |
| **S-4** | The embedding-default extraction anchors on `'helpbot_embedding_model'`. It must find **as many string-literal defaults as there are occurrences of the key** (2 today). If a refactor turns the default into an identifier, the test fails loudly rather than checking a subset |
| **S-5** | `chargePricing` on a malformed record (a non-finite or negative `costUsd` or token count) must not return a silent 0. Flag it (`conservative_fallback`, reason `malformed`) and log it at `error`. Charge the conservative rate where the tokens or unit make one computable, and charge 0 (still flagged) only when nothing is computable. Never throw |

#### Notes

- **N-1** My SQ-9 wording ("lives in the pricing module") is superseded by the Q-8 ruling. BA may align the requirement text in the next revision.
- **N-2** Requirement Note **N-4 is stale**. `openaiProvider.calculateCost` already costs provider-cached input at half the rate (`openaiProvider.ts:551-572`), so measured charges are not over-stated for caching. BA should correct N-4 and its KI in the next revision. D-0 is unaffected. The conservative path deliberately ignores the discount.
- **N-3** A chat response with no `usage` object records 0 tokens and $0, and after D-0 it is marked `priced`, so it would be charged as `measured` 0. This behaviour predates D-0 and is rare. The SA-S9 ledger-vs-`token_usage` reconciliation in D-1 is where to catch it, not D-0.
- **N-4** The declared `area` duplicates the area each call site passes. When D-1 or D-3 makes `runAiAction` read the list, add an assertion that `spec.area` matches the declared area.
- **N-5** `notifyUsage` stores `{ ...call }`, a shallow copy, so the `pricing` object is shared by reference with the provider's metrics. That is harmless, because the provider builds a fresh object per call and nothing mutates it. Freezing it is optional.
- **N-6** `chargePricing` imports `IMAGE_FALLBACK_PRICING` from `SystemConfigRepository`, which loads `supabaseServer` at import time, the same as `modelSettingsPolicy.ts` does today. Its behaviour is pure but its import graph is not. It is server-only: a client module must never import it. Its tests follow the existing mocks.
- **N-7** R-4 is accepted: the conservative text rate is about 18× gpt-4o's output rate. After D-0, only a defect reaches it, and every such row is flagged. SA signs off the derived figures at code review.
- **N-8** The label drafts (R-7) are fine for D-0, because nothing renders them before D-2.

### Business question

None. Every §8 item is technical.

### Approval

- [x] Workplan approved **with conditions C-1 to C-3**. Proceed to implementation after folding them in, with T7 removed (Q-9).
- [ ] S-1 to S-5 addressed in the implementation (SA checks at code review).

---

## 11. QA Testing Report

*(QA to populate.)*

---

## 12. Commit Info

*(RM to populate. Dev does not commit. Changes stay uncommitted until the user has reviewed the diff.)*

---

## 13. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | D-0 workplan written from the requirement's SA Review "D-0 scoping". Seven SA items mapped to tasks T1–T7; nine questions for SA; no `console.*` debt in any file to be modified |
| 2026-09-28 | SA workplan review: APPROVED WITH CONDITIONS | Scope matches the D-0 guidance. The `baseProvider` pass-through is safely scoped. Conditions: C-1 (a zero price is not `priced`), C-2 (a base-class pass-through proof with explicit `trackAICall` literals), C-3 (the enforced completeness guard is `satisfies` under `typecheck:bos-llm`, because CI runs no Jest; plus a negative proof in T8). All nine §8 questions ruled; T7 (warn→error) dropped. Should-fix S-1 to S-5, notes N-1 to N-8. No business question |
| 2026-09-28 | Superseded | The requirement was reorganised into twelve numbered slices. D-0 splits into slice 1 (the declared action facts, now co-located on `AiActionType` in `aiActionAudit.ts` rather than a separate module, per the user's reuse decision) and slice 2 (the cost work). Replaced by `BUSINESS_OS_CREDIT_DEDUCTION_SLICE_1_WORKPLAN.md` and slice 2's future workplan; nothing here was implemented |
