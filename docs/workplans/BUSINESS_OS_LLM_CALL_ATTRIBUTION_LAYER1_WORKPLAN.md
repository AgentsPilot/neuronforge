# Workplan: Business OS LLM Call Attribution — Layer 1

> **Last Updated**: 2026-09-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) (26 FRs / 24 ACs, SA approved 2026-09-17)
**Evidence:** [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md)
**Branch:** `feature/business-os-llm-attribution-layer1` (worktree `neuronforge-llm-attribution`, off `origin/main` @ `6351ebb1`)
**Date:** 2026-09-17
**Status:** SA approved — changes applied, ready to implement. (SA workplan review 2026-09-17: Approved with changes; WC-1 to WC-10 applied by Dev 2026-09-17, see §13.4. No second SA pass needed; SA verifies the WCs at code review.) **No code written yet.**

## Overview

Layer 1 makes every in-scope Business OS LLM call write its `token_usage` row with the real account, `feature = business-os-<area>`, `component = <catalog call name>` and a UUID `session_id` grouping id. It adds two new modules (`lib/business-os/llm/callCatalog.ts`, `lib/business-os/usage/usageCategories.ts`), an optional context argument on `getProviderFactory().complete()`, a `callName` on `EmbeddingService.generateEmbedding`, threads account and grouping id through the in-scope call sites (§4), and moves the usage-card category mapping into an exported pure function. It changes nothing else: no migration, model, prompt or response handling changes. It also converts `lib/ai/providerFactory.ts` and `lib/services/EmbeddingService.ts` to Pino (user approved 2026-09-17).

This workplan traces each FR and AC to tasks and tests. It verifies every line reference against the worktree (§2), and records the SA rulings and user decisions that settle the design questions (§10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Code-Reality Verification (line references)](#2-code-reality-verification-line-references)
3. [Design](#3-design)
4. [Per-Call Task List](#4-per-call-task-list)
5. [Files to Create / Modify](#5-files-to-create--modify)
6. [Test Plan](#6-test-plan)
7. [Pino Conversion](#7-pino-conversion)
8. [Traceability Matrix](#8-traceability-matrix)
9. [Risks and Rollout](#9-risks-and-rollout)
10. [Questions and Decisions for SA](#10-questions-and-decisions-for-sa)
11. [Implementation Sequence](#11-implementation-sequence)
12. [Task Checklist](#12-task-checklist)
13. [SA Review Notes](#13-sa-review-notes)
14. [QA Testing Report](#14-qa-testing-report)
15. [Commit Info](#15-commit-info)
16. [Change History](#change-history)

---

## 1. Analysis Summary

| Layer | What is touched | Nature of change |
|---|---|---|
| New | `lib/business-os/llm/callCatalog.ts` | Areas, call names, attribution types, `buildBosCallContext`, `toEmbeddingAttribution`, `bosBriefingGroupId` |
| New | `lib/business-os/usage/usageCategories.ts` | Category mapping extracted from the usage route (FR-21) |
| Shared helpers | `lib/ai/providerFactory.ts`, `lib/services/EmbeddingService.ts` | Optional context / `callName`, backward compatible; Pino conversion |
| Chat (rows 1, 2, 3a, 3b, 4, 4b) | `Planner.ts`, `AnalysisService.ts`, `PlanCache.ts`, `VerifiedQuestions.ts`, `chat-v4/route.ts` (`:1329` only) | Context via builder; `turnId` added to `PlanCache.store`; `embed()` takes the call name; analysis uses `turnId` |
| Insights (rows 7–9) | `lib/business-os/insight/repository/InsightRepository.ts` | Real account; `runId` required and threaded to the 3 generators |
| Briefing (row 10) | `BriefingNarrator.ts` | `userId` required; UUID v5 group id |
| Leads (row 12) | `LeadReplyRecommender.ts`, `lib/services/LeadAlertService.ts` | Group id param minted per enquiry; response handling untouched |
| Intake (rows 13, 14) | `IntakeGenerationService.ts`, 2 intake routes | Required group id; context into `complete()` |
| Website (rows 15, 16, 17a–f) | `WebsiteGenerationService.ts`, `WebsiteAIContentService.ts`, `WebsiteBlockEnrichmentService.ts`, `WebsiteSectionService.ts` (compile-only), `MutateExecutor.ts`, 4 website routes, onboarding build route | Required attribution params; group id minted at entry points |
| Usage card | `app/api/business-os/usage/route.ts` | Imports the extracted mapping; new + legacy values |
| DB | `token_usage` | Writes only. **No schema change, no migration, no backfill** |

**Not touched:** `lib/analytics/aiAnalytics.ts`, `lib/ai/providers/baseProvider.ts` (read only), `turnUsage.ts`, `ChatBudget.ts`, `usageReport.ts`, `UsageCard.tsx`, and all excluded calls: `AIDataLayerService.ts`, `IntentParser.ts`, `story/route.ts`, `WebsiteAnalyzer.ts`, `OnboardingConversationManager.ts`, `ServiceGeneratorService.ts` (broken; excluded per user decision 2026-09-17) and `GeneratedImageService.ts` (website image generation; moved to Layer 1.5 per user decision 2026-09-17). Also untouched: `lib/repositories/InsightRepository.ts`, the agents-side "insights" system. Per the `business-os-insights` skill (Rule 1), it is a different class from `lib/business-os/insight/repository/InsightRepository.ts`. `lib/pilot/insight/BusinessInsightGenerator.ts:765` uses that other class and is unaffected.

**V6 protocol:** not applicable. No V6, pilot or plugin-system code is touched.

---

## 2. Code-Reality Verification (line references)

Every reference in the requirement was checked against the worktree on 2026-09-17. Most still match. These don't:

| Requirement reference | Actual (worktree) | Impact |
|---|---|---|
| Planner call `Planner.ts:443` | `provider.chatCompletion(` is at **`:444`** (`:443` is `getProvider`); context `:481-491`, repair marking `:490` | None |
| Usage mapping `usage/route.ts:49-69` | `CATEGORIES` is at **`:65-89`**, `FEATURE_TO_CATEGORY` `:91-96`, used at `:355`. The route now sums via RPC `business_os_usage_summary` (`:150`) with a row fallback (`:206`) | None. Mapping is still in Node, so extraction works as specified |
| Onboarding build `route.ts:739`, `:777` | Intake call **`:840`**, website call **`:881`** | None |
| Regenerate route `user.id` `:40` | `getUser()` at **`:38`** | None |
| `pages/[id]/enrich/route.ts:80`, `WebsitePublishService.ts:367` (`useAI=false`) | **`:79`**, **`:366`** | None. KI-3 still holds |
| `providerFactory.ts` "8 `console.*` calls" | `grep` counts 8, but **2 are URL strings** (`console.anthropic.com` `:129`, `console.groq.com` `:182`). **6 real calls** | Pino task sized at 6 (§7) |
| FR-16 "`runId` required on the three repository methods" | `runId` reaches the generators through **five** public signatures: `create` (via `CreateInsightParams.runId` `:378`), `createBatch` `:773`, `saveCorrelationResults` `:2289`, `createCorrelatedInsight` `:1508`, `createOrUpdateHealthSummary` `:1851`. Wrappers forward it as optional today | All five become required (otherwise the wrappers still accept `undefined`). Callers unchanged: cron `:232/:245/:262`, `scripts/verify-insights.ts:98/:114` already pass a `string`. **SA ruling (d): approved, all five required** |

**Code-reality findings not covered by the requirement:**

| # | Finding | Evidence | Proposal |
|---|---|---|---|
| F-1 | **Chat analysis groups by `correlationId`, not `turnId`.** If a caller sends a non-UUID `x-correlation-id`, the analysis row gets `session_id = NULL` and drops out of the turn. The planner and embeddings still use `turnId` | `app/api/business-os/chat-v4/route.ts:1329` (`turnId: correlationId`) vs `:335-336`, `:785`, `:1598` | Change `:1329` to `turnId` (one token). Behaviour is identical whenever the header is absent or a UUID. **SA ruling (b): approved in scope, no gate.** Task T14 |
| F-2 | **Uncatalogued, broken Business OS call: scheduling service generation.** Calls `ProviderFactory.getProvider(OPENAI).complete(...)`, which doesn't exist on `BaseAIProvider`. It always throws and falls back to vertical defaults, so no LLM call and no ledger row are made | `lib/services/ServiceGeneratorService.ts:275`, `:304`; caller `app/api/scheduling/services/generate/route.ts:113` | **Excluded** (SA ruling (a); user decision 2026-09-17). Not modified |
| F-3 | **Uncatalogued, untracked Business OS AI spend: website image generation.** Direct OpenAI SDK `images.generate` (`gpt-image-1`) bypasses the provider layer. It never reaches `token_usage` | `lib/services/GeneratedImageService.ts:186-187`; caller `app/api/website/media/generate/route.ts` | **Layer 1.5** (user decision 2026-09-17, following SA's recommendation in ruling (a)). Excluded from Layer 1 and untouched |
| F-4 | `WebsiteSectionService.regenerateSectionField` casts its request with `as Parameters<typeof service.regenerateField>[0]` | `lib/services/WebsiteSectionService.ts:519-529` | The cast would hide a missing field inside the request object. So the attribution goes in a **separate positional parameter**, which the compiler enforces even through the cast (§3.4) |
| F-5 | Next.js App Router `route.ts` files may only export HTTP handlers and route config. Exporting a mapping function from `usage/route.ts` fails Next's route-export type check | Next 14 route typing | The pure function lives in `lib/business-os/usage/usageCategories.ts`; the route imports it (§3.5) |
| F-6 | `uuid` is `^13.0.0` (`package.json:97`), which is ESM-only. Jest runs through ts-jest in CommonJS with no `transformIgnorePatterns` for `uuid`, so a unit test importing it will likely fail to load | `jest.config.js`, `package.json:97` | Implement UUID v5 with Node's built-in crypto (SHA-1, RFC 9562 §5.5). Tested against the published vector (`NAMESPACE_DNS` + `python.org` → `886313e1-3b8a-5372-9b90-0c9aee199e5d`, verified locally). **SA ruling (c): approved**; supersedes RC-11's "use the existing `uuid` dependency" hint |
| F-7 | AC-14 says "category credits sum to the total". The route rounds **per category** (`toCredits(v.tokens)`, `:367`) and the total separately (`:409`), so rounded credits can differ from the total by up to ±(number of categories − 1) | `usage/route.ts:350`, `:367`, `:409` | Pre-existing, and FR-23 doesn't allow changing it. **SA ruling (e):** test asserts exact **token and call** sums per category against the totals, and nothing about credit sums |
| F-8 | Pre-existing repository-pattern violations in files we touch (direct `supabaseServer.from(...)`) | See the complete list (Dev + SA additions) in §9.3 | **SA item 4: not fixed in Layer 1; follow-up for the Business OS repo-conformance sweep** (§9.3). Layer 1 adds no new direct Supabase call; T43 enforces it (WC-8). `regenerate/route.ts` also carries OI-2 |

---

## 3. Design

### 3.1 `lib/business-os/llm/callCatalog.ts`

**File:** `lib/business-os/llm/callCatalog.ts` (final path, confirming FR-26's proposal)

```typescript
// Node's built-in crypto (SA ruling (c)); 'crypto' specifier for consistency with lib/business-os/**.
// Never import `uuid` here: uuid@13 is ESM-only and doesn't load under ts-jest (WC-6).
import { createHash, randomUUID } from 'crypto';
import type { CallContext } from '@/lib/ai/providers/baseProvider';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BosLlmCallCatalog' });

export const BOS_LLM_AREAS = ['chat', 'insights', 'briefing', 'website', 'intake', 'leads'] as const;
export type BosLlmArea = (typeof BOS_LLM_AREAS)[number];

/** Stable identifiers: Layer 2 config keys. Never rename without a migration plan (FR-6). */
export const BOS_LLM_CALLS = {
  chat: ['planner', 'analysis', 'plan_cache_lookup_embedding', 'plan_cache_store_embedding',
         'verified_question_embedding',        // VerifiedQuestions.similar() — match (lookup)
         'verified_question_store_embedding'], // VerifiedQuestions.remember() — store (WC-4)
  insights: ['insight_content', 'correlated_insight', 'health_summary'],
  briefing: ['daily_narration'],
  website: ['full_site', 'landing_page', 'field_regenerate', 'testimonial_enhance',
            'hero_content', 'about_content', 'faq_content', 'features_content'],
  intake: ['form_generation', 'question_inference'],
  leads: ['reply_recommendation'],
} as const satisfies Record<BosLlmArea, readonly string[]>;

export type BosLlmCallName<A extends BosLlmArea> = (typeof BOS_LLM_CALLS)[A][number];

/** Chat keeps today's optional turn id (FR-9); every other area must supply a group id. */
type GroupIdFor<A extends BosLlmArea> = A extends 'chat' ? string | undefined : string;

/** Distributive over areas, so `callName` is narrowed to its own area (AC-22). */
export type BosLlmAttribution = {
  [A in BosLlmArea]: {
    userId: string;             // required by type: FR-3 compile-time guard
    area: A;
    callName: BosLlmCallName<A>;
    groupId: GroupIdFor<A>;     // required key; SA ruling (h)
    correlationId?: string;     // for the FR-3 log only; never written to the ledger
  };
}[BosLlmArea];

/** What a service needs from its caller: account + group. The service supplies area/callName itself. */
export interface BosLlmOwner { userId: string; groupId: string }

/** Fields a caller may add (repair marking, embedding category...). Cannot override the four attribution keys. */
export type BosCallContextExtras = Omit<Partial<CallContext>, 'userId' | 'feature' | 'component' | 'sessionId'>;

export function buildBosCallContext(attribution: BosLlmAttribution, extras: BosCallContextExtras = {}): CallContext;
//  -> { ...extras, userId, feature: `business-os-${area}`, component: callName, sessionId: groupId }
//  FR-3: if !isUuid(userId) -> logger.error({ area, callName, correlationId, groupId }, 'Business OS LLM call has no valid account; usage will land on the system user')
//        (the value is still passed through unchanged; aiAnalytics' existing fallback records it: spend never dropped)
//  If groupId is present but not a UUID -> logger.warn (tracker would null it)

/** Adapter for EmbeddingService's attribution shape. Takes the builder's output, so validation happens once. */
export function toEmbeddingAttribution(context: CallContext): { userId: string; feature: string; turnId?: string; callName: string };

/** FR-17: deterministic UUID v5 of (account, business-local briefing date). */
// NEVER CHANGE the namespace or the name format `${userId}:${briefingDate}`:
// both are part of the persisted session_id and changing either splits a day's briefing group.
export const BOS_BRIEFING_GROUP_NAMESPACE = '7614864a-f10e-4140-9c6e-9f3f50dc99b0'; // frozen
export function bosBriefingGroupId(userId: string, briefingDate: string): string; // v5(namespace, `${userId}:${briefingDate}`)

/** Fresh group id for an owner request (FR-8). The caller (mint point) logs it (WC-10). */
export function newBosGroupId(): string; // randomUUID()
```

Design notes:

- **Type narrowing (AC-22).** `{ area: 'chat', callName: 'full_site' }` fails to compile. The test uses `// @ts-expect-error`. **Jest does not check this** (WC-1): `tsconfig.json` sets `isolatedModules: true`, so ts-jest runs transpile-only and an unused `@ts-expect-error` does not fail `npx jest`. The type-level half of AC-22 and AC-3, and FR-12's "required attribution", are enforced only by the `tsc --noEmit` gate (T42), which covers the new test files and fails on TS2578 (unused `@ts-expect-error`). `tsconfig.json` `include` has `**/*.ts`, so `tsc -p .` already compiles test files. Runtime assertions stay in Jest.
- **UUID v5 conditions (SA ruling (c)).** `bosBriefingGroupId` is tested against the RFC 9562 vector, and asserts version nibble `5` and variant bits `10xx`. The namespace constant and name format are frozen with a "never change" comment (above).
- **Extras can't clobber attribution.** The spread order is `{ ...extras, userId, feature, component, sessionId }`, and the type `Omit`s those keys. This preserves `activity_type: 'repair'|'plan'` (row 1), `activity_type: 'narration'` (row 10), and the embedding `category`/`activity_*` that `EmbeddingService` sets.
- **No `server-only` import.** `scripts/verify-insights.ts` imports `InsightRepository` under plain Node, where `server-only` throws. The `crypto` import already prevents client bundling.
- **FR-3 system-account check (SA optimisation, adopted).** The builder also emits the FR-3 `logger.error` when `userId` equals `process.env.SYSTEM_ADMIN_USER_ID` or the all-zero UUID: both are valid UUIDs the tracker accepts silently but FR-1 forbids. The builder stays synchronous and side-effect-free apart from the log.
- **No free-typed strings at call sites (AC-24).** Every call site passes typed literals (`area: 'insights', callName: 'insight_content'`) that the compiler checks against the catalog. The strings `business-os-*` appear only inside the builder.
- **Layer boundary.** The module is under `lib/business-os/`. `lib/ai/` doesn't import it (FR-26).

### 3.2 `getProviderFactory().complete()`: optional context (FR-11, FR-12)

**File:** `lib/ai/providerFactory.ts`

```typescript
export interface SimpleProvider {
  complete(
    params: { model: string; messages: ...; response_format?: ...; temperature?: number; max_tokens?: number },
    /** Usage attribution. When omitted, the call is recorded on the platform account (system/onboarding/simple-complete). */
    context?: CallContext
  ): Promise<{ content: string }>;
  getProvider(name: ProviderName): BaseAIProvider;
}

// in getProviderFactory():
async complete(params, context?) {
  ...
  // Every call is tracked by the provider. Without a context it lands on the platform account.
  const result = await provider.chatCompletion(chatParams, context ?? {
    userId: 'system',
    feature: 'onboarding',
    component: 'simple-complete'
  });
```

**Backward compatibility:** the parameter is trailing and optional, and the default object literal is byte-identical. `OnboardingConversationManager.ts:950/:995/:1097/:1397` and `WebsiteAnalyzer.ts:123` call `complete({...})` with one argument and compile and behave unchanged (AC-7). The misleading comment at `:323` is corrected. `CallContext` is imported as a type from `./providers/baseProvider`, which is already imported.

### 3.3 `EmbeddingService.generateEmbedding`: `callName` (FR-13)

**File:** `lib/services/EmbeddingService.ts`

```typescript
async generateEmbedding(
  text: string,
  attribution?: { userId?: string; feature?: string; turnId?: string; callName?: string }
)
// context.component = attribution?.callName ?? 'EmbeddingService'   // only change inside the context literal
```

**Backward compatibility:** help bot callers (`app/api/help-bot-v2/route.ts:316`, `:622`; internal `:219`, `:258`) pass no attribution, so they get `systemUserId()` / `helpbot` / `EmbeddingService` as today. `generateBatchEmbeddings` (`:150-200`) is not edited (AC-13). Business OS callers pass `toEmbeddingAttribution(buildBosCallContext({...}))`.

### 3.4 Business OS service signatures (FR-12, FR-19)

The attribution parameter is **required** at the Business OS service boundary, so a caller can't forget it. **SA ruling (g): attribution is a separate required positional argument** (enforced by argument count, even through the `as Parameters<…>[0]` cast at `WebsiteSectionService.ts:519-529`). Accepted exceptions: `groupId` inside the non-cast options objects of `generateWebsite`/`generateIntakeForm` (their `= {}` defaults removed), and the optional trailing `groupId` on `enrichBlock`/`enrichBlocks` (OQ-5, WC-5). Enforcement relies on the `tsc` gate (T42, WC-1).

| Method | Before | After |
|---|---|---|
| `WebsiteGenerationService.generateWebsite` (`:167`) | `(userId, options = {})` | `(userId, options: { groupId: string; pageId?; templateId?; focus? })`, default removed |
| `WebsiteGenerationService.callLLM` (private, `:526`) | `(profile, services, hasRealTestimonials, focus?)` | `(owner: BosLlmOwner, profile, services, hasRealTestimonials, focus?)` |
| `WebsiteAIContentService.generateBlockContent` (`:228`) | `(request)` | `(request, owner: BosLlmOwner)` |
| `WebsiteAIContentService.regenerateField` (`:278`) | `(request)` | `(request, owner: BosLlmOwner)`, separate arg (F-4) |
| `WebsiteAIContentService.enhanceTestimonial` (`:317`) | `(text, language)` | `(text, language, owner: BosLlmOwner)` |
| Private generators hero/about/FAQ/features (`:352/:396/:525/:582`) | `(profile, [services], language)` | `+ owner: BosLlmOwner` |
| `WebsiteBlockEnrichmentService.enrichBlock` / `enrichBlocks` (`:154`, `:227`) | `(..., isSingleServicePage = false)` | `+ groupId?: string` trailing. **`enrichBlock` mints its own `newBosGroupId()` when `groupId` is absent** (it is called directly by `pages/[id]/enrich/route.ts:75`) (WC-5). `enrichBlocks` mints one id if absent and passes it to every `enrichBlock`. Both mint points log `groupId` (WC-10). The 4 `*WithAI` methods take `owner`. Callers (`useAI=false`) are unchanged |
| `IntakeGenerationService.generateIntakeForm` (`:125`) | `(userId, opts = {})` | `(userId, opts: { groupId: string; regenerate?: boolean })`, default removed |
| `IntakeGenerationService.callLLM` (private, `:236`) | `(profile, services)` | `(owner: BosLlmOwner, profile, services)` |
| `infer` in `infer-question/route.ts` (`:105`) | `(text, language)` | `(text, language, owner: BosLlmOwner)` |
| `recommendLeadReply` (`:74`) | `(candidates, input, userId)` | `(candidates, input, userId, groupId: string)`. The diff is limited to the signature and the context literal (AC-15) |
| `narrateBriefing` (`:81`) | `(facts, language = 'en', userId?, businessType = {})` | `(facts, language = 'en', userId: string, businessType = {})` |
| `PlanCache.store` (`:282`) | `args: {…, userId, plan, model?}` | `+ turnId?: string` (same optionality as `lookup`, `:167`) |
| `embed` in `VerifiedQuestions.ts` (module-private, `:74`) | `(text, userId, turnId?)` | `(text, userId, turnId: string \| undefined, callName: 'verified_question_embedding' \| 'verified_question_store_embedding')`. `similar()` (`:136`) passes the lookup name, `remember()` (`:197`) the store name (WC-4) |
| `InsightRepository` public methods | `runId?: string` ×5 | `runId: string` ×5 (§2) |
| `InsightRepository` private generators (`:606`, `:1657`, `:2028`) | no run id | `+ runId: string` |

### 3.5 Usage category mapping (FR-21)

**File:** `lib/business-os/usage/usageCategories.ts` (new; F-5)

```typescript
export const USAGE_CATEGORIES: ReadonlyArray<{ key: string; features: readonly string[] }> = [
  { key: 'chat',     features: ['business-os-chat', 'chat-v3'] },                        // unchanged
  { key: 'automations_built', features: [/* unchanged 8 values */] },
  { key: 'automations_run',   features: [/* unchanged 5 values */] },
  { key: 'website',  features: ['business-os-website', 'landing-page-generation'] },
  { key: 'insights', features: ['business-os-insights', 'health-summary-generation', 'insight-generation', 'correlated-insight-generation'] },
  { key: 'briefing', features: ['business-os-briefing', 'business-os'] },
  { key: 'intake',   features: ['business-os-intake'] },
  { key: 'leads',    features: ['business-os-leads', 'lead-reply'] },
  { key: 'documents', features: ['document-extraction'] },                              // unchanged
  { key: 'help',     features: ['help_bot_v2', 'input_help_bot', 'helpbot', 'onboarding'] }, // unchanged
];
export function usageCategoryForFeature(feature: string): string;   // ?? 'other'
export function summariseUsageByCategory(
  byFeature: ReadonlyMap<string, { tokens: number; calls: number }>
): Map<string, { tokens: number; calls: number }>;
```

`usage/route.ts` replaces `:65-96` and the loop at `:354-361` with these imports. The response shape and the rounding stay unchanged.

### 3.6 Grouping id at entry points

**SA ruling (h), approved.** Chat's grouping id is optional (`groupId: string | undefined`, a required key) and keeps the existing `turnId` rule (`chat-v4/route.ts:335`). Non-chat entry points **always** mint a fresh id with `newBosGroupId()` and **never read `x-correlation-id`**. FR-8 *permits* reusing a UUID header but doesn't require it. Not reading it keeps every attribution field off request input (AC-24 stays a pure diff check) and stops a client from pinning one header UUID across many requests to merge unrelated actions.

**Mint-point logging (WC-10, condition of ruling (h)).** Every place that mints a group id logs it at `info` or `debug`, with `correlationId` where one exists, so the two stay linkable:

| Mint point | Task | Log fields |
|---|---|---|
| `LeadAlertService.queueLeadReply` | T24 | `{ userId, contactId, groupId }` |
| `intake/form/generate/route.ts` | T27 | `{ correlationId, userId, groupId }` |
| `intake/form/infer-question/route.ts` | T28 | `{ correlationId, userId, groupId }` |
| `generate-from-profile/route.ts` | T31 | `{ correlationId, userId, groupId }` |
| `MutateExecutor.ts:808` | T32 | `{ userId, groupId }` (+ executor correlation id if present in `ctx`) |
| `landing-pages/generate/route.ts` | T33 | `{ correlationId, userId, groupId }` |
| `blocks/[blockId]/regenerate/route.ts`, `enhance-testimonial/route.ts` | T35 | `{ correlationId, userId, groupId }` |
| `WebsiteBlockEnrichmentService.enrichBlock` / `enrichBlocks` (when absent) | T36 | `{ userId, blockType / blockCount, groupId }` |
| `WebsiteSectionService.ts:519` | T37 | `{ userId, groupId }` |
| `onboarding/build/route.ts` (one shared id) | T38a | `{ correlationId, userId, groupId }` |

The briefing id (`bosBriefingGroupId`) is derived, not minted; `BriefingNarrator` includes `groupId` in its existing narration log (T21). Insight `runId` is already logged by the cron.

---

## 4. Per-Call Task List

All account and grouping sources are server-side: `getUser()`, DB-iterated ids, or server-resolved owner ids. **No attribution field is read from a body, query string or header.**

| Row | Task | Call site (verified) | Current CallContext | Target `feature` / `component` / `session_id` | Account source | Group id source |
|---|---|---|---|---|---|---|
| 1 | T9 | `lib/business-os/bizql/planner/Planner.ts:444` (ctx `:481-491`) | `{ userId: request.userId, feature: 'business-os-chat', component: 'BizQLPlanner', sessionId: request.turnId, activity_type: repair ? 'repair' : 'plan' }` | `business-os-chat` / `planner` / `request.turnId`; `activity_type` kept via extras | `request.userId` ← `chat-v4/route.ts:779` `user.id` (`getUser`, `:352`) | `turnId`, `chat-v4/route.ts:335` → `:785` |
| 2 | T10 | `lib/business-os/bizql/analyse/AnalysisService.ts:124` (ctx `:137-143`) | `{ userId, feature: 'business-os-chat', component: 'BizQLAnalysis', sessionId: request.turnId }` | `business-os-chat` / `analysis` / `request.turnId` | `chat-v4/route.ts:1326` `user.id` | `turnId` at `chat-v4/route.ts:1329` (today passes `correlationId`; T14 changes it to `turnId`, SA ruling (b)) |
| 3a | T11 | `lib/business-os/bizql/cache/PlanCache.ts:226` (`lookup` `:161-167`) | EmbeddingService ctx `{ userId, feature: 'business-os-chat', component: 'EmbeddingService', category: 'embedding_generation', activity_type: 'embedding', activity_name: 'generate_embedding', sessionId: turnId }` | `business-os-chat` / `plan_cache_lookup_embedding` / `turnId`; category/activity unchanged | `lookup(userId)` ← Planner `request.userId` | `lookup(turnId)` ← Planner `request.turnId` |
| 3b | T12 | `PlanCache.ts:333` (`store` args `:282-289`; caller `Planner.ts:640-649`) | none → `{ userId: SYSTEM_ADMIN_USER_ID/all-zero, feature: 'helpbot', component: 'EmbeddingService', sessionId: undefined, … }` | `business-os-chat` / `plan_cache_store_embedding` / `request.turnId` | `args.userId` ← `request.userId` (`Planner.ts:645`) | **new** `args.turnId` ← `request.turnId` |
| 4 | T13 | `lib/business-os/bizql/planner/VerifiedQuestions.ts:81` (`embed` `:74`) via `similar()` `:136` (lookup, from `Planner.ts:349`) | same shape as 3a | `business-os-chat` / `verified_question_embedding` / `turnId` | `args.userId` ← Planner `request.userId` | `args.turnId` ← Planner `request.turnId` |
| 4b | T13 | `VerifiedQuestions.ts:81` (`embed` `:74`) via `remember()` `:197` (store, from `chat-v4/route.ts:1592`) | same shape as 3a | `business-os-chat` / `verified_question_store_embedding` / `turnId` (WC-4) | `args.userId` ← `chat-v4` `user.id` | `args.turnId` ← `chat-v4/route.ts:1598` |
| 7 | T17, T18 | `lib/business-os/insight/repository/InsightRepository.ts:717` (ctx `:724-728`; generator `:606`) | `{ userId: 'system', feature: 'insight-generation', component: 'InsightRepository' }` | `business-os-insights` / `insight_content` / `runId` | generator's `userId` (`:608`) ← `create` params ← `createBatch` ← cron loop `insight-detect/route.ts:205` (DB-read user ids) | `runId` `insight-detect/route.ts:142` → `createBatch` `:232` → `create` `:779-784` → generator call `:449` (+`runId`) |
| 8 | T17, T18 | `InsightRepository.ts:1728` (ctx `:1735-1739`; generator `:1657`) | `{ userId: 'system', feature: 'correlated-insight-generation', component: 'InsightRepository' }` | `business-os-insights` / `correlated_insight` / `runId` | generator `userId` (`:1659`) | cron `:245` → `saveCorrelationResults` `:2285` → `createCorrelatedInsight` `:2301`/`:1504` → generator call `:1577` |
| 9 | T17, T18 | `InsightRepository.ts:2113` (ctx `:2120-2124`; generator `:2028`) | `{ userId, feature: 'health-summary-generation', component: 'InsightRepository' }` | `business-os-insights` / `health_summary` / `runId` | generator `userId` | cron `:262` or `saveCorrelationResults` `:2329` → `createOrUpdateHealthSummary` `:1847` → generator call `:1891` |
| 10 | T21 | `lib/business-os/briefing/BriefingNarrator.ts:106` (ctx `:115-120`; signature `:81-86`) | `{ userId: userId ?? 'unknown', feature: 'business-os', component: 'daily-briefing', activity_type: 'narration' }` | `business-os-briefing` / `daily_narration` / `bosBriefingGroupId(userId, facts.day.date)`; `activity_type: 'narration'` kept | `BriefingStore.ts:51` ← `getBriefing(userId)` ← `my-day/route.ts:119` `user.id` or `DailyBriefingDispatchService.ts:222` (job's `userId`) | UUID v5 in the narrator |
| 12 | T23, T24 | `lib/business-os/leads/LeadReplyRecommender.ts:98` (ctx `:109`) | `{ userId, feature: 'lead-reply', component: 'LeadReplyRecommender' }` | `business-os-leads` / `reply_recommendation` / `groupId` | `input.ownerId` (`LeadAlertService.ts:342`), resolved server-side by the form routes | `newBosGroupId()` in `queueLeadReply` just before `lib/services/LeadAlertService.ts:334` |
| 13 | T26, T27, T38a | `lib/services/IntakeGenerationService.ts:249` (`callLLM` `:236`, called `:149`) | `complete()` default `{ 'system', 'onboarding', 'simple-complete' }` | `business-os-intake` / `form_generation` / `opts.groupId` | `userId` ← `intake/form/generate/route.ts:47` `user.id` (`:37`); `onboarding/build/route.ts:840` `user.id` (`:187`) | `newBosGroupId()` in the intake route; the build route mints one shared id and passes it to `:840` (T38a, Step 9) |
| 14 | T28 | `app/api/intake/form/infer-question/route.ts:123` (`infer` `:105`, called `:65`) | `complete()` default | `business-os-intake` / `question_inference` / group id | `user.id` (`:51`) | `newBosGroupId()` in `POST` |
| 15 | T30–T32, T38b | `lib/services/WebsiteGenerationService.ts:546` (`callLLM` `:526`, called `:240`) | `complete()` default | `business-os-website` / `full_site` / `options.groupId` | `generate-from-profile/route.ts` `user.id` (`:45`; body `userId` is only compared, `:67`); `onboarding/build/route.ts:881` `user.id`; `MutateExecutor.ts:808` `ctx.userId` | `newBosGroupId()` at each entry point; build route reuses the id minted in T38a for `:881` (T38b, Step 10) |
| 16 | T33 | `app/api/website/landing-pages/generate/route.ts:102` (ctx `:118-122`) | `{ userId: user.id, feature: 'landing-page-generation', component: 'LandingPageGenerateAPI' }` | `business-os-website` / `landing_page` / group id | `user.id` (`:71`) | `newBosGroupId()` in `POST` |
| 17a | T34, T35, T37 | `lib/services/WebsiteAIContentService.ts:301` (`regenerateField` `:278`) | `complete()` default | `business-os-website` / `field_regenerate` / `owner.groupId` | `blocks/[blockId]/regenerate/route.ts:68` `user.id` (`:38`); `WebsiteSectionService.ts:519` `userId` param (`MutateExecutor.ts:936` `ctx.userId`; compile-only, KI-1) | route `newBosGroupId()`; `WebsiteSectionService` mints at `:519` |
| 17b | T34, T35 | `WebsiteAIContentService.ts:337` (`enhanceTestimonial` `:317`) | `complete()` default | `business-os-website` / `testimonial_enhance` / `owner.groupId` | `enhance-testimonial/route.ts:35` `user.id` (`:24`) | `newBosGroupId()` in `POST` |
| 17c | T34, T36 | `WebsiteAIContentService.ts:371` (`generateHeroContent` `:352`) | `complete()` default | `business-os-website` / `hero_content` / `owner.groupId` | `WebsiteBlockEnrichmentService` `userId` (`enrichHeroBlockWithAI` `:607`, call `:624`) | `enrichBlocks` group id (no production trigger, KI-3) |
| 17d | T34, T36 | `WebsiteAIContentService.ts:414` (`generateAboutContent` `:396`) | same | `… / about_content / …` | `enrichAboutBlockWithAI` `:401`, call `:418` | same |
| 17e | T34, T36 | `WebsiteAIContentService.ts:546` (`generateFAQContent` `:525`) | same | `… / faq_content / …` | `enrichFAQBlockWithAI` `:998`, call `:1018` | same |
| 17f | T34, T36 | `WebsiteAIContentService.ts:602` (`generateFeaturesContent` `:582`) | same | `… / features_content / …` | `enrichFeaturesBlockWithAI` `:1058`, call `:1078` | same |

---

## 5. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/llm/callCatalog.ts` | create | FR-26 catalog + builder + briefing group id |
| `lib/business-os/llm/__tests__/callCatalog.test.ts` | create | AC-10(d), AC-12, AC-22, AC-23 |
| `lib/business-os/usage/usageCategories.ts` | create | FR-21 (F-5) |
| `lib/business-os/usage/__tests__/usageCategories.test.ts` | create | AC-14 |
| `lib/ai/providerFactory.ts` | modify | FR-11; Pino conversion of 6 `console.*` calls (user approved 2026-09-17; T4) |
| `lib/ai/__tests__/providerFactory.complete.test.ts` | create | AC-6, AC-7 |
| `lib/services/EmbeddingService.ts` | modify | FR-13; Pino conversion of 16 `console.*` calls (user approved 2026-09-17; T7) |
| `lib/services/__tests__/EmbeddingService.attribution.test.ts` | create | AC-13 |
| `lib/business-os/bizql/planner/Planner.ts` | modify | Rows 1, 3b (turnId into store) |
| `lib/business-os/bizql/analyse/AnalysisService.ts` | modify | Row 2 |
| `lib/business-os/bizql/cache/PlanCache.ts` | modify | Rows 3a, 3b |
| `lib/business-os/bizql/planner/VerifiedQuestions.ts` | modify | Rows 4, 4b (`embed()` takes the call name) |
| `app/api/business-os/chat-v4/route.ts` | modify | F-1, `:1329` only (`turnId: correlationId` → `turnId`; SA ruling (b)) |
| `lib/business-os/bizql/__tests__/llm-attribution.test.ts` | create | AC-2, AC-8, AC-9, AC-10(a), AC-11 |
| `lib/business-os/insight/repository/InsightRepository.ts` | modify | Rows 7–9, required `runId` |
| `lib/business-os/insight/__tests__/insight-llm-attribution.test.ts` | create | AC-1, AC-8, AC-10(b) |
| `lib/business-os/briefing/BriefingNarrator.ts` | modify | Row 10 |
| `lib/business-os/briefing/__tests__/BriefingNarrator.attribution.test.ts` | create | AC-3, AC-8 |
| `lib/business-os/leads/LeadReplyRecommender.ts` | modify | Row 12 (signature + context only) |
| `lib/services/LeadAlertService.ts` | modify | Mint per-enquiry group id |
| `lib/business-os/leads/__tests__/lead-reply-attribution.test.ts` | create | AC-8, AC-10(c) |
| `lib/services/IntakeGenerationService.ts` | modify | Row 13 |
| `app/api/intake/form/generate/route.ts` | modify | Mint group id |
| `app/api/intake/form/infer-question/route.ts` | modify | Row 14 |
| `lib/services/__tests__/intake-llm-attribution.test.ts` | create | AC-4, AC-8, AC-10(a) |
| `lib/services/WebsiteGenerationService.ts` | modify | Row 15 |
| `lib/services/WebsiteAIContentService.ts` | modify | Rows 17a–f |
| `lib/services/WebsiteBlockEnrichmentService.ts` | modify | Thread owner to 17c–f |
| `lib/services/WebsiteSectionService.ts` | modify (compile-only) | FR-19 / KI-1: second arg only |
| `lib/business-os/bizql/mutate/MutateExecutor.ts` | modify | Mint group id at `:808` |
| `app/api/website/generate-from-profile/route.ts` | modify | Mint group id; pass `user.id` |
| `app/api/website/landing-pages/generate/route.ts` | modify | Row 16 |
| `app/api/website/blocks/[blockId]/regenerate/route.ts` | modify | Mint group id; OI-2 untouched |
| `app/api/website/enhance-testimonial/route.ts` | modify | Mint group id |
| `app/api/onboarding/build/route.ts` | modify | One shared group id: passed to `:840` in Step 9 (T38a), reused for `:881` in Step 10 (T38b) (WC-2) |
| `lib/services/__tests__/website-llm-attribution.test.ts` | create | AC-5, AC-8, AC-10(a); `jest.mock('uuid')` for the `WebsiteGenerationService.ts:32` import (WC-6) |
| `app/api/business-os/usage/route.ts` | modify | Import extracted mapping |
| `docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md` | modify | One line: insight LLM calls attributed to the business, `session_id = runId` (per `business-os-insights` skill close-out) |

**Explicitly unchanged (AC-21, AC-24):** `lib/analytics/aiAnalytics.ts`, `lib/ai/providers/baseProvider.ts`, `lib/business-os/ai-data-layer/AIDataLayerService.ts`, `lib/business-os/IntentParser.ts`, `app/api/business-os/story/route.ts`, `lib/services/WebsiteAnalyzer.ts`, `lib/services/OnboardingConversationManager.ts`, `lib/services/ServiceGeneratorService.ts` (F-2, excluded: broken), `lib/services/GeneratedImageService.ts` (F-3, Layer 1.5), `turnUsage.ts`, `ChatBudget.ts`, `usageReport.ts`, `UsageCard.tsx`, `scripts/verify-insights.ts`, `app/api/cron/insight-detect/route.ts` (already passes a `string` `runId`). No `supabase/migrations/**` file.

---

## 6. Test Plan

All automated tests use Jest with the provider **mocked**: `jest.spyOn(ProviderFactory, 'getProvider')` returning `{ chatCompletion: jest.fn(), createEmbedding: jest.fn() }`, or `jest.mock('@/lib/ai/providerFactory')` for `getProviderFactory().complete`. Logger is mocked as in `BriefingNarrator.test.ts`. No real network or DB. Private methods are reached with bracket access (`repo['generateLocalizedContent']`), not `any`. Any test whose import graph reaches `uuid` (ESM-only `uuid@13`) mocks it, as `lib/pilot/__tests__/transformFlatten.parentCarry.test.ts:11-19` does (WC-6).

**Jest is transpile-only here (WC-1).** `tsconfig.json` sets `isolatedModules: true`, so ts-jest skips type checking. Every `// @ts-expect-error` assertion (AC-3, AC-22) and every "required argument" guarantee (FR-12) is verified by the `tsc --noEmit` gate in T42, not by Jest. The table marks these "(type: T42)".

### 6.1 Automated tests per AC

| AC | Test file | Cases |
|---|---|---|
| AC-1 | `insight-llm-attribution.test.ts` | Row 7 and row 8 generators called with `userId = U1`, the provider ctx `userId === U1`, never `'system'`. Wiring: spy `create`/`createCorrelatedInsight`/`createOrUpdateHealthSummary`; `createBatch(U1, [..], R1)` and `saveCorrelationResults(U1, .., R1)` forward `R1` |
| AC-2 | `llm-attribution.test.ts` | `PlanCache.store({... userId: U1, turnId: T1})` with semantic path reachable: `createEmbedding` ctx `userId U1`, `sessionId T1`, `feature 'business-os-chat'`, `feature !== 'helpbot'`, `component 'plan_cache_store_embedding'`. `Planner` store call receives `turnId` (spy on `PlanCache.prototype.store`) |
| AC-3 | `BriefingNarrator.attribution.test.ts` (runtime: Jest; type: T42 `tsc`) | `// @ts-expect-error` on `narrateBriefing(facts, 'en')` without `userId` (checked by `tsc` only, TS2578 if unused); non-quiet facts: ctx `userId === U1`, never `'unknown'`/system (Jest); T43 review greps for `'unknown'` in the briefing dir |
| AC-4 | `intake-llm-attribution.test.ts` | `generateIntakeForm(U1, { groupId: G1 })` (repos mocked): `complete` 2nd arg `userId U1`; infer-question `POST` (`getUser` mocked → U1): `complete` ctx `userId U1` |
| AC-5 | `website-llm-attribution.test.ts` (`jest.mock('uuid')`, WC-6) | `callLLM` (full_site), `regenerateField`, `enhanceTestimonial`, `generateBlockContent` for `hero`/`about`/`faq`/`features`: each `complete` ctx `userId === U1` |
| AC-6 | `providerFactory.complete.test.ts` | With ctx C: `chatCompletion` called with `(params, C)` (same reference/deep-equal). Without: `{ userId: 'system', feature: 'onboarding', component: 'simple-complete' }` exactly (`toStrictEqual`) |
| AC-7 | `providerFactory.complete.test.ts` | One-arg `complete({...})` (the onboarding/WebsiteAnalyzer form) resolves `{ content }` from `choices[0].message.content`. `tsc` on `OnboardingConversationManager.ts`/`WebsiteAnalyzer.ts` has no new errors (T42) |
| AC-8 | each area test file | One assertion per row (1, 2, 3a, 3b, 4, 4b, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17a–f): `feature === 'business-os-<area>'`, `component === <call name>`. Row 4 (`similar()`) asserts `verified_question_embedding`; row 4b (`remember()`) asserts `verified_question_store_embedding` (WC-4). Cache-hit row excluded |
| AC-9 | `llm-attribution.test.ts` | Rows 1, 2, 3a, 3b, 4, 4b `feature 'business-os-chat'`; rows 1, 2, 3a, 4, 4b `sessionId === turnId` passed in. Row 2: `AnalysisService` maps `request.turnId` → `sessionId` (T14 / WC-7) |
| AC-10(a) | chat: `llm-attribution.test.ts`; website: `website-llm-attribution.test.ts`; intake: `intake-llm-attribution.test.ts` | Chat: planner repair (2 provider calls in one `plan()`) share `sessionId`; a second `plan()` with another turn differs. Website: `enrichBlocks(U1, [hero, about], lang, true)` → both `complete` ctx share one `sessionId`; a second `enrichBlocks` call differs; **`enrichBlock` called alone without `groupId` → `complete` ctx `sessionId` is a UUID (self-minted, WC-5)**. Intake: two `POST`s to the generate route → different `groupId` into the mocked service. Intake has one LLM call per action, so "two calls share" is shown by the build route sharing one id (code review; build route too large to unit test; Q-8) |
| AC-10(b) | `insight-llm-attribution.test.ts` | Generators for U1 and U2 with `R1` → equal `sessionId`, different `userId`; U1 with `R2` → different `sessionId` |
| AC-10(c) | `lead-reply-attribution.test.ts` | `notifyOwnerOfLead` twice for the same `contactId`, kind `enquiry` (repos, email and recommender mocked) → `recommendLeadReply` receives two different UUIDs |
| AC-10(d) | `callCatalog.test.ts` + each area file | `newBosGroupId()`/`bosBriefingGroupId()` match the UUID regex; every asserted non-chat `sessionId` matches the UUID regex |
| AC-11 | `llm-attribution.test.ts` + existing | Repair attempt ctx `activity_type 'repair'`, first attempt `'plan'`, both `component 'planner'`. `turnUsage.ts` unchanged; existing `usage-report.test.ts` passes unchanged |
| AC-12 | `callCatalog.test.ts`, `providerFactory.complete.test.ts` | `buildBosCallContext({ userId: 'system', ... })` → `logger.error` once with `{ area, callName, correlationId }` (or `groupId` when no correlation id), context still returned with the value unchanged. Same for the all-zero UUID and `SYSTEM_ADMIN_USER_ID` (SA optimisation). Through `complete(params, ctx)`: resolves, `chatCompletion` called exactly once |
| AC-13 | `EmbeddingService.attribution.test.ts` | `generateEmbedding(text)` ctx `{ userId: systemUserId(), feature: 'helpbot', component: 'EmbeddingService', category: 'embedding_generation', activity_type: 'embedding', activity_name: 'generate_embedding', sessionId: undefined }` (`toStrictEqual`); `generateBatchEmbeddings` ctx unchanged; with `callName` → `component` = call name |
| AC-14 | `usageCategories.test.ts` | Table-driven: every new and legacy value in FR-21 → its category; `onboarding → help`; none → `other`; unknown → `other`; `summariseUsageByCategory` tokens and calls per category sum **exactly** to the input totals. No assertion on credit sums; rounding stays in the route, unchanged (SA ruling (e)) |
| AC-16 | existing suites | `BriefingNarrator.test.ts`, `hashFacts.test.ts`, `isQuietDay.test.ts`, `leadReplyCandidates.test.ts`, `analysis-payload.test.ts`, `plan-cache-safety.test.ts`, `calendar-dates.test.ts`, `app/api/website/forms/intake/__tests__/route.test.ts`, `lib/server/website-plugin-executor.test.ts` pass unchanged |
| AC-17 | existing suites | `lib/business-os/bizql/__tests__/chat-budget.test.ts`, `usage-report.test.ts` pass **without edits** |
| AC-22 | `callCatalog.test.ts` (runtime: Jest; type: T42 `tsc`) | Jest: builder maps area → `feature`, call → `component`, group → `sessionId`; extras `activity_type: 'repair'` preserved; runtime spread order means extras can't override `userId`/`feature`/`component`/`sessionId`. `tsc` only: `@ts-expect-error` on extras overriding those keys, and on `{ area: 'chat', callName: 'full_site' }` |
| AC-23 | `callCatalog.test.ts` | Same (U, date) → same UUID; different date → different; different U → different; RFC 9562 vector test for the v5 implementation (`NAMESPACE_DNS` + `python.org` → `886313e1-3b8a-5372-9b90-0c9aee199e5d`); version nibble is `5` and variant bits are `10xx` (SA ruling (c)) |

### 6.2 Regression runs (T16, T42)

```bash
npx jest lib/business-os/bizql/__tests__/chat-budget.test.ts lib/business-os/bizql/__tests__/usage-report.test.ts
npx jest lib/business-os lib/services lib/ai app/api/website
npx tsc --noEmit -p . 2>&1 | grep -E "<touched files>|<new test files>"   # compared to T0 baseline: no new errors
```

**`tsc` gate (WC-1).** `next.config.js` ignores TS errors and Jest is transpile-only (`isolatedModules`), so `tsc --noEmit` is the **only** check for "required attribution" (FR-12), the type half of AC-3 and AC-22, and the required `runId` (FR-16). The gate:

- runs `tsc --noEmit -p .` (whose `include` covers `**/*.ts`, so test files compile);
- filters on **every touched source file and every new test file**, explicitly including `lib/business-os/llm/__tests__/callCatalog.test.ts` and `lib/business-os/briefing/__tests__/BriefingNarrator.attribution.test.ts`, plus the other five new test files in §5;
- **fails on any error not in the T0 baseline**, including **TS2578** ("Unused '@ts-expect-error' directive"), which is how an expected type error that stopped firing is detected.

Per-step `tsc` checks use the same filter for the files of that step (e.g. Step 9 checks `app/api/onboarding/build/route.ts`, WC-2).

### 6.3 Code review checks (diff inspection; T43)

| AC | Check |
|---|---|
| AC-15 | `git diff main -- lib/business-os/leads/LeadReplyRecommender.ts` shows only the signature (`groupId`), the import, and the context literal at `:109`. `:112` onward is untouched |
| AC-21 | `git diff --stat main` lists none of the excluded files (§5) and no `supabase/migrations/**` |
| AC-24 | `grep -rn "feature: '" <touched BOS files>` finds no Business OS literal outside `callCatalog.ts` (the default in `providerFactory.ts` excepted). No `request.json()`/`searchParams`/`headers` value flows into `userId`/`groupId`. `git diff main -- lib/analytics/aiAnalytics.ts` is empty. `WebsiteSectionService.ts:519-529` request object is unchanged (only a second argument added). This workplan flags `providerFactory.ts` + `EmbeddingService.ts` (§7) |
| AC-24 / T14 | `git diff main -- app/api/business-os/chat-v4/route.ts` shows a single-token change at `:1329` (`turnId: correlationId` → `turnId`) and nothing else (WC-7) |
| Repository rule (WC-8) | `git diff main -- lib app \| grep -E "^\+" \| grep -E "supabaseServer(Auth)?\.(from\|rpc\|storage)\|\.from\(\|\.rpc\(\|\.storage"` finds **no new** direct Supabase `from(` / `.rpc(` / `.storage` call. Moved or re-indented pre-existing lines are checked against their `-` counterpart. Pre-existing calls are a follow-up (§9.3), not fixed here |
| Mint-point logging (WC-10) | Every `newBosGroupId()` call site in the diff has a `logger.info`/`logger.debug` carrying `groupId` (and `correlationId` where one exists) in the same scope (§3.6 table) |
| No `uuid` in catalog (WC-6) | `grep -n "uuid" lib/business-os/llm/callCatalog.ts` finds no import of the `uuid` package |

### 6.4 QA manual run (AC-18 to AC-21)

**Environment:** non-production (the insight cron processes **every** active business, `insight-detect/route.ts:167-203`). Use a test business `TEST_USER_ID` with CRM contacts, bookings/invoices, a published website with a bookable service, and `SYSTEM_ADMIN_USER_ID` known. Record `WINDOW_START` before step 1.

| Step | Action | Expected ledger rows (`feature` / `component`) |
|---|---|---|
| 1 | Chat: ask a new read question (cache miss), then the same question again (cache hit). Where the UI offers it, confirm/save the answer as a verified question | `business-os-chat` / `planner` (+ `analysis` if the plan has an analyse step, + `plan_cache_lookup_embedding` / `verified_question_embedding` when semantic is on, + `verified_question_store_embedding` when a verified question is remembered); hit: `BizQLPlanCache` row unchanged. `plan_cache_store_embedding` may be absent (KI-2; not a failure) |
| 2 | Insights: `curl -H "Authorization: Bearer $CRON_SECRET" <env>/api/cron/insight-detect` | `business-os-insights` / `insight_content`, `correlated_insight` (if a pattern matched), `health_summary`; all rows share one `session_id` = the run id in the cron log |
| 3 | Briefing: open the Business OS dashboard (`/api/business-os/my-day`) on a non-quiet day. If the day was already narrated with unchanged facts, change a fact (e.g. add a booking) first | `business-os-briefing` / `daily_narration`, `session_id` = v5(TEST_USER_ID, date); a re-narration the same day has the same `session_id` |
| 4 | Website: run full generation (setup wizard → `/api/website/generate-from-profile`); generate a landing page via the landing-page builder (`/api/website/landing-pages/generate`) | `business-os-website` / `full_site`; `business-os-website` / `landing_page`; different `session_id`s |
| 5 | Website builder: regenerate one block field (`/api/website/blocks/[id]/regenerate`, **builder route only**, not chat, KI-1); enhance a testimonial | `field_regenerate`; `testimonial_enhance` |
| 6 | Intake: generate a form (`/api/intake/form/generate`), then add a question from a note (`/api/intake/form/infer-question`) | `business-os-intake` / `form_generation`; `question_inference` |
| 7 | Leads: submit the public website contact form as a new enquiry (twice, same email) | `business-os-leads` / `reply_recommendation`; two different `session_id`s |
| 8 | Run the AC-18 / AC-19 queries below | See below |
| 9 | Load the usage card for TEST_USER_ID (AC-20) | Card loads; `GET /api/business-os/usage` `breakdown` contains `website`, `intake`, `insights`, `briefing`, `leads` keys; `credits` includes them |
| 10 | AC-21: `git diff --stat main...feature/business-os-llm-attribution-layer1` | No excluded file, no migration |

Rows 17c–f and the chat "rewrite a section field" path are **not** exercised (KI-3, KI-1).

**AC-18 query** (every row is on the test business, correct naming, UUID `session_id`):

```sql
select created_at, user_id, feature, component, session_id, activity_type,
       input_tokens, output_tokens
from token_usage
where created_at >= :window_start
  and user_id = :test_user_id
  and feature like 'business-os-%'
order by created_at;

-- grouping: calls per action share a session_id
select feature, session_id, array_agg(distinct component) as calls, count(*) as rows
from token_usage
where created_at >= :window_start and user_id = :test_user_id and feature like 'business-os-%'
group by feature, session_id
order by min(created_at);
```

Pass (WC-9):

- every expected component from the steps above is present with `user_id = :test_user_id`;
- no in-scope row has `session_id is null` (a chat cache-hit row carries the turn id too);
- every `feature`/`component` pair is in the catalog, **with two exceptions that are ignored, not failures**:
  - `business-os-chat` / `BizQLPlanCache`: the chat cache-hit row, which is deliberately not a catalog call (RC-14);
  - rows written by `IntentParser` (`IntentParser.ts:122-126`, an excluded call) if `/api/business-os/chat` (v1) was used in the window.

Any other `feature like 'business-os-%'` row whose `component` is not a catalog call name fails AC-18.

**AC-19 query** (expect **zero rows**):

```sql
select feature, component, count(*)
from token_usage
where created_at >= :window_start
  and user_id in (:system_admin_user_id, '00000000-0000-0000-0000-000000000000')
  and feature in ('business-os-chat','business-os-insights','business-os-briefing',
                  'business-os-website','business-os-intake','business-os-leads',
                  'insight-generation','correlated-insight-generation','health-summary-generation',
                  'landing-page-generation','lead-reply','business-os')
group by feature, component;
```

`onboarding` is deliberately not in the list. Because step 2 runs for every business in the environment, this query also shows that no other business's insight rows landed on the system user.

---

## 7. Pino Conversion

Flagged per CLAUDE.md § Logging (touched non-compliant files). **User approved 2026-09-17: convert both whole files in this cycle.** SA approved the plan (§13.3 item 7). Explicit tasks: **T4** (`providerFactory.ts`, 6 calls) and **T7** (`EmbeddingService.ts`, 16 calls).

| File | Real `console.*` calls | Lines | Conversion |
|---|---|---|---|
| `lib/ai/providerFactory.ts` | **6** (grep shows 8; `:129`, `:182` are URL strings in error messages, not calls) | `:57`, `:106`, `:133`, `:160`, `:186`, `:200` | `const logger = createLogger({ module: 'ProviderFactory' })`; initialisation messages → `logger.debug({ provider }, '…')`, clear → `logger.debug`. Emoji prefixes dropped. The two error-message strings stay as they are |
| `lib/services/EmbeddingService.ts` | **16** | `:141`, `:197`, `:231`, `:233`, `:270`, `:272`, `:294`, `:298`, `:312`, `:316`, `:323`, `:344`, `:348`, `:362`, `:366`, `:373` | `createLogger({ service: 'EmbeddingService' })`; `console.error(msg, error)` → `logger.error({ err: error, cacheId/articleId }, msg)`; progress `console.log` → `logger.info({ count, tokens, costUsd }, msg)` |

All other touched files already use `createLogger` and have **0** `console.*` calls (verified: Planner, AnalysisService, PlanCache, VerifiedQuestions, chat-v4 route, InsightRepository, insight-detect route, BriefingNarrator, BriefingStore, LeadReplyRecommender, LeadAlertService, IntakeGenerationService, both intake routes, WebsiteGenerationService, WebsiteAIContentService, WebsiteBlockEnrichmentService, WebsiteSectionService, MutateExecutor, the four website routes, onboarding build route, usage route). `lib/analytics/aiAnalytics.ts` (16) is **not touched**.

**Risk:** `providerFactory.ts` is imported widely. Importing `@/lib/logger` there is safe: no `'use client'` module imports `providerFactory` or `EmbeddingService` (verified by grep), and `lib/logger` doesn't import either (no cycle).

---

## 8. Traceability Matrix

### 8.1 FR → tasks → tests

| FR | Tasks | Tests |
|---|---|---|
| FR-1 Real account | T9–T13, T17–T18, T21, T23, T26, T28, T30, T33–T35 | AC-1–AC-5, AC-9, AC-19 |
| FR-2 Background work | T17–T18 (cron), T21 (dispatch), T23–T24 (lead) | AC-1, AC-3, AC-10(b)(c), QA steps 2, 3, 7 |
| FR-3 Invalid account logs | T1 (builder) | AC-12 |
| FR-4 Area | T1 + all call-site tasks | AC-8 |
| FR-5 Chat keeps feature | T1, T9–T13 | AC-9, AC-17 |
| FR-6 Call name | T1 | AC-8, AC-22 |
| FR-7 Ledger mapping | T1 | AC-8, AC-22, AC-18 |
| FR-8 UUID grouping | T1, T24, T27, T28, T31–T33, T35–T37, T38a, T38b | AC-10(d), AC-18; mint-point logs (WC-10) via T43 |
| FR-9 Chat grouping unchanged | T9–T14 | AC-9, AC-17 |
| FR-10 Grouping sources | T17, T21, T24, T27, T28, T31–T33, T35–T37, T38a, T38b | AC-10 |
| FR-11 `complete()` context | T3 | AC-6 |
| FR-12 Other callers unchanged, BOS required | T3, T26, T30, T34, T36 | AC-7, `tsc` gate (T42, WC-1) |
| FR-13 Embedding call name | T6, T11–T13 | AC-2, AC-13 |
| FR-14 Plan cache store | T12 | AC-2 |
| FR-15 Repairs and cache hits | T9 (extras) | AC-11 |
| FR-16 Insights | T17–T18 | AC-1, AC-10(b), `tsc` gate (T42) |
| FR-17 Briefing | T1 (`bosBriefingGroupId`), T21 | AC-3, AC-23 |
| FR-18 Intake | T26–T28, T38a | AC-4, AC-10(a) |
| FR-19 Website | T30–T37, T38b | AC-5, AC-10(a), AC-24 (KI-1 shape) |
| FR-20 Leads | T23–T24 | AC-10(c), AC-15 |
| FR-21 Category mapping | T40 (Step 2, before any rename; WC-3) | AC-14, AC-20 |
| FR-22 Consumption may rise | None (accepted; rollout note §9) | AC-20 |
| FR-23 No behaviour change | All call-site tasks change only the context arg | AC-16, AC-17, AC-15 |
| FR-24 Excluded untouched | T43 (incl. `ServiceGeneratorService.ts`, `GeneratedImageService.ts`) | AC-21, AC-24 |
| FR-25 No backfill | No migration task | AC-21 |
| FR-26 Catalog module | T1–T2 | AC-22, AC-24 |

### 8.2 AC → tasks → tests

| AC | Tasks | Verified by |
|---|---|---|
| AC-1 | T17, T18 | T19 `insight-llm-attribution.test.ts` |
| AC-2 | T6, T12 | T15 `llm-attribution.test.ts` |
| AC-3 | T21 | T22 `BriefingNarrator.attribution.test.ts` (runtime) + **T42 `tsc`** (type part, WC-1) |
| AC-4 | T26–T28, T38a | T29 `intake-llm-attribution.test.ts` |
| AC-5 | T30, T34, T36, T38b | T39 `website-llm-attribution.test.ts` |
| AC-6 | T3 | T5 `providerFactory.complete.test.ts` |
| AC-7 | T3 | T5 + T42 `tsc` |
| AC-8 | All call-site tasks | T15, T19, T22, T25, T29, T39 |
| AC-9 | T9–T14 | T15, T43 (T14 diff) |
| AC-10 | T1, T12, T17, T24, T27, T31–T37, T38a, T38b | T2, T15, T19, T25, T29, T39 |
| AC-11 | T9 | T15, T16 |
| AC-12 | T1, T3 | T2, T5 |
| AC-13 | T6 | T8 `EmbeddingService.attribution.test.ts` |
| AC-14 | T40 | T41 `usageCategories.test.ts` |
| AC-15 | T23 | T43 diff review |
| AC-16 | All | T42 |
| AC-17 | None (untouched files) | T16, T42 |
| AC-18 | All | QA §6.4 steps 1–8 |
| AC-19 | All | QA §6.4 AC-19 query |
| AC-20 | T40 | QA §6.4 step 9 |
| AC-21 | T43 | T43 + QA step 10 |
| AC-22 | T1 | T2 (runtime) + **T42 `tsc`** (type part, WC-1) |
| AC-23 | T1 | T2 |
| AC-24 | T1, T37, T43, §7 | T43 |
| Repository rule (no new direct Supabase call) | All | T43 (WC-8) |

---

## 9. Risks and Rollout

### 9.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | A required-param change misses a caller and TS errors are ignored by `next.config.js` (and Jest doesn't type-check), so a runtime `undefined` group id ships | 🟡 / medium | T0 baseline + T42 `tsc` diff on touched files **and new test files** (WC-1); per-step `tsc` checks (e.g. build route in Step 9, WC-2); callers enumerated in §3.4 by grep; `enrichBlock` self-mints (WC-5); `groupId` non-UUID triggers `logger.warn` |
| R-2 | `providerFactory.ts` Pino conversion alters startup behaviour | 🟢 / low | Log-only change; `ProviderFactory` logic untouched; AC-6/AC-7 tests |
| R-3 | UUID v5 via Node's built-in crypto diverges from the standard | 🟢 / low | RFC 9562 vector test + version nibble / variant bit assertions (F-6, ruling (c)) |
| R-4 | Insight cron timeout grows | 🟢 / none | No new LLM calls or DB round trips (NFR Performance). Only context args change |
| R-5 | Plan-cache store embeddings now count toward the chat daily token ceiling (tens of tokens per plan) | 🟢 / accepted | FR-23 carve-out (a) |
| R-6 | Jest setup: `providerFactory` imports `@supabase/supabase-js` `createClient`; env stubs come from `tests/plugins/jest-setup.ts`. `WebsiteGenerationService.ts:32` imports ESM-only `uuid@13`, which ts-jest doesn't transform | 🟢 / low | Spy on `ProviderFactory.getProvider` rather than constructing real providers. T39 `jest.mock('uuid')` (WC-6); `callCatalog.ts` never imports `uuid` (checked in T43) |
| R-10 | Onboarding silently stops creating intake forms if `generateIntakeForm`'s `opts = {}` default is removed before the build route passes `opts` (the build route swallows intake errors) | 🔴 / high if mis-sequenced | T38a lands in the same step as T26 (Step 9), with a `tsc` check on `onboarding/build/route.ts` (WC-2) |
| R-11 | New `feature` values fall into `other` on the usage card between a rename and the mapping change | 🟡 / medium if mis-sequenced | Usage mapping (T40, T41) runs as Step 2, before any call site is renamed (WC-3) |
| R-7 | Lead-alert test (AC-10(c)) needs many mocks (`notifyOwnerOfLead` → private `queueLeadReply`) | 🟡 / test effort | Mock repos, email and recommender modules at the module boundary; no production refactor |
| R-8 | QA's insight cron run spends LLM tokens for every business in the environment | 🟡 / cost | Run in a non-production environment only (§6.4) |
| R-9 | Worktree has no `node_modules` | 🟢 | T0 `npm ci` before implementation |

### 9.2 Rollout note

- **No migration, no schema change, no backfill** (FR-7, FR-25). Deploy is code-only and revertible by reverting the merge.
- **Usage-card totals rise** for businesses with website, intake, insight, briefing or lead activity, because previously system-attributed spend now counts for them. "Credits remaining" may drop, including from nightly insight runs and daily briefings with no owner action. Display only. **Accepted** (FR-22, 2026-09-16); the background-work treatment is OI-1.
- Historical periods show legacy and new `feature` values as separate buckets in the admin drill-down (OQ-2, accepted). The owner card merges them (FR-21).
- System-user rows for these features from before release stay as they are (FR-25). AC-19 must be read for the post-release window only.

### 9.3 Follow-ups (not tasks in this cycle)

| # | Follow-up | Owner / home | Source |
|---|---|---|---|
| FU-1 | **Direct Supabase calls in touched files** (pre-existing, non-ledger tables, unrelated to attribution). Not fixed in Layer 1; goes to the existing **Business OS repo-conformance sweep**. Layer 1 adds none (T43, WC-8). Complete list: <br>• `app/api/website/landing-pages/generate/route.ts:80` <br>• `app/api/website/blocks/[blockId]/regenerate/route.ts:62` (security aspect tracked separately as OI-2, `:55-62`) <br>• `lib/services/WebsiteSectionService.ts:512` <br>• `app/api/business-os/usage/route.ts:218`, `:255`, `:286` <br>• `lib/services/EmbeddingService.ts:208`, `:222`, `:244`, `:261`, `:283`, `:306`, `:334`, `:356` <br>• **SA additions:** `lib/business-os/bizql/cache/PlanCache.ts:178` (+ RPC); `lib/business-os/bizql/planner/VerifiedQuestions.ts:106`, `:140`, `:153`, `:201`; `lib/services/LeadAlertService.ts:110-127`; `lib/services/WebsiteBlockEnrichmentService.ts:458`, `:1211`, `:1241-1242` <br>• `lib/business-os/bizql/telemetry/ChatBudget.ts:158` (not touched) | Repo-conformance sweep | SA item 4 |
| FU-2 | **Website image generation spend** (`lib/services/GeneratedImageService.ts:186-187`, direct OpenAI SDK). Needs an image method on the provider layer, image pricing, a credits-per-picture rule, and catalog attribution | **Layer 1.5** | User decision 2026-09-17; SA ruling (a) |
| FU-3 | **`ServiceGeneratorService`** (`lib/services/ServiceGeneratorService.ts:275`, `:304`) calls a non-existent `complete` on `BaseAIProvider`; always falls back, no LLM call. Excluded from attribution; the breakage itself is a separate bug | Excluded (separate fix if wanted) | User decision 2026-09-17; SA ruling (a) |

---

## 10. Questions and Decisions for SA

All questions are resolved. The "Resolution" column records the SA ruling (§13.2) or user decision that settles each one.

| # | Question | Dev recommendation | Resolution |
|---|---|---|---|
| Q-1 | **Uncatalogued Business OS AI calls (F-2, F-3):** `ServiceGeneratorService.ts:304` (broken, no LLM call) and `GeneratedImageService.ts:186` (direct SDK image generation, untracked). Neither is in the requirement's in-scope or excluded tables | Leave both untouched in Layer 1. BA adds them to Excluded calls | **SA ruling (a)** + **user decisions 2026-09-17**: `ServiceGeneratorService` **excluded** (broken). Website image generation (`GeneratedImageService.ts`) → **Layer 1.5**; excluded from Layer 1 and untouched. Both on the T43 "untouched" list; follow-ups FU-2, FU-3 (§9.3) |
| Q-2 | **UUID v5 implementation (F-6):** RC-11 says "use the existing `uuid` dependency", but `uuid@13` is ESM-only and likely won't load under the current Jest config | Implement v5 with Node crypto (15 lines, RFC-vector tested) | **SA ruling (c): approved.** UUID v5 via Node's built-in crypto (`'crypto'` specifier preferred for consistency with `lib/business-os/**`; `node:crypto` acceptable), no `uuid` package. Tested against the RFC 9562 vector, plus version nibble `5` and variant `10xx`; namespace and name format frozen |
| Q-3 | **Chat analysis `turnId: correlationId` (F-1)** at `chat-v4/route.ts:1329` | Fix to `turnId` (T14) | **SA ruling (b): approved in scope, gate removed** (WC-7). BA records it in FR-9, row 2, AC-9 (RQ-3) |
| Q-4 | **AC-14 "credits sum to the total" (F-7)** | Assert exact token and call sums | **SA ruling (e): approved.** AC-14 checks exact **token and call** sums per category against the totals; nothing about credit sums; route rounding unchanged |
| Q-5 | **FR-16 "three methods":** `runId` must be required on five public signatures (§2) | Make all five required | **SA ruling (d): approved.** `runId` required on all 5 insight methods (`CreateInsightParams`/`create`, `createBatch`, `saveCorrelationResults`, `createCorrelatedInsight`, `createOrUpdateHealthSummary`). No caller change |
| Q-6 | **Chat `groupId` type** | `string \| undefined` for chat only | **SA ruling (h): approved.** Chat grouping id is optional (required key typed `string \| undefined`); every other area requires `string` |
| Q-7 | **`x-correlation-id` reuse (FR-8 "may")** | Don't reuse at non-chat entry points | **SA ruling (h): approved.** Non-chat entry points always generate a fresh id and never read the header. **Condition:** every mint point logs `groupId` (WC-10, §3.6) |
| Q-8 | **Onboarding build shared id + AC-10(a) for intake** | Build route mints one shared id | Accepted (SA §13.3 item 2), **split per WC-2**: T38a (intake, Step 9), T38b (website, Step 10) |
| Q-9 | **Pino conversion** of `providerFactory.ts` (6) and `EmbeddingService.ts` (16) | Convert both in this cycle (T4, T7) | **User approved 2026-09-17**; SA approved (§13.3 item 7). Explicit tasks T4, T7 |
| — | *(SA-raised)* Where the usage category mapping lives | `lib/business-os/usage/usageCategories.ts` (F-5) | **SA ruling (f): approved.** Route modules may only export handlers/config |
| — | *(SA-raised)* Attribution shape at service boundaries | Separate positional argument | **SA ruling (g): approved.** Attribution is a separate required argument (§3.4), with the listed options-object and `enrichBlock` exceptions |
| — | *(SA item 4)* Direct Supabase calls in touched files | Flag only | **Not fixed this cycle.** Follow-up for the Business OS repo-conformance sweep (FU-1, §9.3, including SA's added files). Layer 1 adds none (T43, WC-8) |

### 10.1 User decisions (2026-09-17)

| Decision | Effect on this workplan |
|---|---|
| **Website image generation** (`lib/services/GeneratedImageService.ts`) → **Layer 1.5** | Excluded from Layer 1 and untouched. Listed in §5 "Explicitly unchanged" and checked by T43. FU-2 |
| **`ServiceGeneratorService`** is **excluded** (broken) | Untouched. Listed in §5 "Explicitly unchanged" and checked by T43. FU-3 |
| **Pino conversion approved** for `lib/ai/providerFactory.ts` (6 `console.*` calls) and `lib/services/EmbeddingService.ts` (16) | Explicit tasks **T4** and **T7** (§7, §12) |

---

## 11. Implementation Sequence

Each step compiles, passes its own tests, and leaves the product behaving as before for everything not yet converted. **Order changed per SA (WC-3):** the usage category mapping is now Step 2, directly after the catalog, so legacy and new `feature` values are both mapped before any call site is renamed. Intake and website are renumbered to Steps 9 and 10; SA's "Step 8" (intake) and "Step 9" (website) in §13 refer to the old numbering.

| Step | Tasks | Independently testable outcome |
|---|---|---|
| 0 | T0 | `npm ci`; baseline Jest (chat-budget, usage-report) and `tsc` error list recorded |
| 1 | T1, T2 | Catalog module + runtime tests green; `tsc` on the catalog and its test shows no new error (incl. TS2578); nothing imports it yet |
| 2 | T40, T41 | Usage mapping extracted with legacy + new values; AC-14 green; usage route response unchanged (WC-3) |
| 3 | T3, T4, T5 | `complete(params, context?)` + Pino (user approved); AC-6/AC-7 green; all existing callers unchanged |
| 4 | T6, T7, T8 | Embedding `callName` + Pino (user approved); AC-13 green |
| 5 | T9–T16 | Chat rows 1, 2, 3a, 3b, 4, 4b attributed; analysis uses `turnId` (T14); AC-2/8/9/10a/11; chat-budget + usage-report unchanged |
| 6 | T17–T20 | Insights rows 7–9 with required `runId` ×5; AC-1/10b |
| 7 | T21, T22 | Briefing row 10; AC-3 (runtime)/23 |
| 8 | T23–T25 | Leads row 12; AC-10c; AC-15 diff self-check |
| 9 | T26–T29, T38a | Intake rows 13–14; onboarding build route passes a shared group id to `generateIntakeForm` in the **same step** that removes its `opts = {}` default; `tsc` shows no new error in `app/api/onboarding/build/route.ts`; AC-4 (WC-2) |
| 10 | T30–T37, T38b, T39 | Website rows 15–17f; build route reuses the Step 9 id for `generateWebsite`; `enrichBlock` self-mints; AC-5 |
| 11 | T42–T45 | Full regression; `tsc` gate over touched files + new test files (WC-1); diff review (AC-15/21/24, no new direct Supabase calls, mint-point logs); insights doc line; workplan status → Code Complete |

**Final count:** 12 steps (0–11), 47 tasks.

---

## 12. Task Checklist

**Step 0: Setup**
- [ ] T0: `npm ci` in worktree; run `chat-budget.test.ts` + `usage-report.test.ts`; record `tsc --noEmit -p .` baseline errors for touched files

**Step 1: Catalog**
- [ ] T1: Create `lib/business-os/llm/callCatalog.ts` (§3.1): catalog incl. `verified_question_store_embedding` (WC-4); UUID v5 via Node `crypto`, no `uuid` import (ruling (c), WC-6); frozen namespace + name format with "never change" comment; FR-3 log also for `SYSTEM_ADMIN_USER_ID` / all-zero UUID
- [ ] T2: `lib/business-os/llm/__tests__/callCatalog.test.ts`: runtime AC-10d, AC-12, AC-22, AC-23 (RFC 9562 vector, version nibble `5`, variant `10xx`); `@ts-expect-error` cases for AC-22 (verified by `tsc`, not Jest; WC-1). Run the `tsc` filter on both files

**Step 2: Usage mapping (moved up, WC-3)**
- [ ] T40: Create `lib/business-os/usage/usageCategories.ts` (ruling (f)); `usage/route.ts` imports it (replaces `:65-96`, `:354-361`)
- [ ] T41: `lib/business-os/usage/__tests__/usageCategories.test.ts` (AC-14: exact token + call sums, no credit-sum assertion; ruling (e))

**Step 3: `complete()` helper**
- [ ] T3: Optional `context?: CallContext` on `SimpleProvider.complete` + impl; fix `:323` comment
- [ ] T4: Pino-convert `lib/ai/providerFactory.ts`: 6 `console.*` calls → `createLogger({ module: 'ProviderFactory' })` (user approved 2026-09-17)
- [ ] T5: `lib/ai/__tests__/providerFactory.complete.test.ts` (AC-6, AC-7, AC-12)

**Step 4: Embedding service**
- [ ] T6: `callName` on `generateEmbedding` attribution → `component`
- [ ] T7: Pino-convert `lib/services/EmbeddingService.ts`: 16 `console.*` calls → `createLogger({ service: 'EmbeddingService' })`, errors as `{ err }` (user approved 2026-09-17)
- [ ] T8: `lib/services/__tests__/EmbeddingService.attribution.test.ts` (AC-13)

**Step 5: Chat**
- [ ] T9: Row 1 `Planner.ts:481-491` via builder, `activity_type` extras
- [ ] T10: Row 2 `AnalysisService.ts:137-143` via builder
- [ ] T11: Row 3a `PlanCache.ts:226-230` via `toEmbeddingAttribution`
- [ ] T12: Row 3b: `turnId?` on `PlanCache.store` args; attribution at `:333`; `Planner.ts:641-648` passes `turnId: request.turnId`
- [ ] T13: Rows 4 + 4b: `embed()` in `VerifiedQuestions.ts:74` takes the call name; `similar()` (`:136`) passes `verified_question_embedding`, `remember()` (`:197`) passes `verified_question_store_embedding`; context at `:81-85` via `toEmbeddingAttribution` (WC-4)
- [ ] T14: `chat-v4/route.ts:1329` `turnId: correlationId` → `turnId` (approved in scope, ruling (b); verified by T43 single-token diff and T15; WC-7)
- [ ] T15: `lib/business-os/bizql/__tests__/llm-attribution.test.ts` (AC-2; AC-8 incl. rows 4 and 4b by name; AC-9 incl. 4b and `AnalysisService` `request.turnId` → `sessionId`; AC-10a; AC-11)
- [ ] T16: Run `chat-budget.test.ts`, `usage-report.test.ts`, `plan-cache-safety.test.ts`, `calendar-dates.test.ts` unchanged (AC-11, AC-17)

**Step 6: Insights**
- [ ] T17: `runId: string` (required, ruling (d)) on `CreateInsightParams`, `createBatch`, `saveCorrelationResults`, `createCorrelatedInsight`, `createOrUpdateHealthSummary`; pass `runId` to generators at `:449`, `:1577`, `:1891`
- [ ] T18: Rows 7/8/9 contexts (`:724-728`, `:1735-1739`, `:2120-2124`) via builder
- [ ] T19: `lib/business-os/insight/__tests__/insight-llm-attribution.test.ts` (AC-1, AC-8, AC-10b)
- [ ] T20: Confirm cron route + `scripts/verify-insights.ts` compile unchanged (`tsc` filter)

**Step 7: Briefing**
- [ ] T21: `narrateBriefing` `userId: string`; context via builder + `bosBriefingGroupId(userId, facts.day.date)`; keep `activity_type: 'narration'`; include `groupId` in the existing narration log
- [ ] T22: `lib/business-os/briefing/__tests__/BriefingNarrator.attribution.test.ts` (AC-3 runtime, AC-8; `@ts-expect-error` part verified by `tsc`, WC-1)

**Step 8: Leads**
- [ ] T23: `recommendLeadReply(..., userId, groupId)`; context `:109` via builder; nothing else in the function changes
- [ ] T24: `LeadAlertService.queueLeadReply` mints `newBosGroupId()` before `:334`, **logs `groupId`** (WC-10) and passes it
- [ ] T25: `lib/business-os/leads/__tests__/lead-reply-attribution.test.ts` (AC-8, AC-10c)

**Step 9: Intake (+ intake half of the build route, WC-2)**
- [ ] T26: `generateIntakeForm(userId, { groupId, regenerate? })` (default removed); `callLLM(owner, …)` passes context to `complete()`
- [ ] T27: `intake/form/generate/route.ts:47` mints group id and **logs `{ correlationId, groupId }`** (WC-10)
- [ ] T28: `infer-question/route.ts` mints group id and **logs `{ correlationId, groupId }`** (WC-10); `infer(text, language, owner)`; context at `:123`
- [ ] T38a: `onboarding/build/route.ts`: mint one `newBosGroupId()` (logged with `correlationId`, WC-10) before the intake call and pass it to `generateIntakeForm(user.id, { groupId })` at `:840`. Check: `tsc` shows no new error in `app/api/onboarding/build/route.ts` (WC-2)
- [ ] T29: `lib/services/__tests__/intake-llm-attribution.test.ts` (AC-4, AC-8, AC-10a)

**Step 10: Website**
- [ ] T30: `generateWebsite(userId, { groupId, … })`; `callLLM(owner, …)` context at `:546`
- [ ] T31: `generate-from-profile/route.ts:78` mints group id, **logs it** (WC-10), passes `user.id`
- [ ] T32: `MutateExecutor.ts:808` mints group id and **logs it** (WC-10)
- [ ] T33: Row 16 `landing-pages/generate/route.ts:118-122` via builder with minted group id, **logged** (WC-10)
- [ ] T34: `WebsiteAIContentService`: `owner` on `generateBlockContent`, `regenerateField`, `enhanceTestimonial` and the 4 private generators; contexts at `:301/:337/:371/:414/:546/:602`
- [ ] T35: `blocks/[blockId]/regenerate/route.ts:68` and `enhance-testimonial/route.ts:35` mint group id, **log it** (WC-10), pass `user.id` (OI-2 not touched)
- [ ] T36: `WebsiteBlockEnrichmentService`: trailing `groupId?` on `enrichBlock`/`enrichBlocks`; **`enrichBlock` mints its own `newBosGroupId()` when absent** (direct caller `pages/[id]/enrich/route.ts:75`); `enrichBlocks` mints once and passes the id to every `enrichBlock`; both mint points log `groupId` (WC-5, WC-10); `owner` into the 4 `*WithAI` methods (`:418/:624/:1018/:1078`)
- [ ] T37: `WebsiteSectionService.ts:519`: add second arg `{ userId, groupId: newBosGroupId() }` only, **logging `groupId`** (WC-10); request shape unchanged (KI-1)
- [ ] T38b: `onboarding/build/route.ts`: pass the id minted in T38a to `generateWebsite(user.id, { groupId, … })` at `:881` (WC-2)
- [ ] T39: `lib/services/__tests__/website-llm-attribution.test.ts` (AC-5, AC-8, AC-10a incl. two blocks in one `enrichBlocks` call sharing one id and a lone `enrichBlock` self-minting; `jest.mock('uuid')`; WC-5, WC-6)

**Step 11: Close-out**
- [ ] T42: Full Jest run for touched areas + existing suites (AC-16, AC-17). **`tsc --noEmit -p .` gate** (WC-1): filter on every touched file **and every new test file** (explicitly `callCatalog.test.ts` and `BriefingNarrator.attribution.test.ts`); fail on any error not in the T0 baseline, including **TS2578** (unused `@ts-expect-error`). Verifies the type parts of AC-3 and AC-22 and the FR-12/FR-16 required arguments
- [ ] T43: Diff review (§6.3): AC-15; AC-21 (incl. `ServiceGeneratorService.ts`, `GeneratedImageService.ts` untouched); AC-24; T14 single-token diff (WC-7); **no new direct Supabase `from(` / `.rpc(` / `.storage` call** (WC-8); every mint point logs `groupId` (WC-10); no `uuid` import in `callCatalog.ts` (WC-6)
- [ ] T44: One-line attribution note in `docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md`
- [ ] T45: Update this workplan: task marks, Status → Code Complete, notify TL for SA code review

**Total: 47 tasks (T0–T37, T38a, T38b, T39–T45) in 12 steps (0–11). None SA-gated.**

---

## 13. SA Review Notes

**Reviewed by SA — 2026-09-17**
**Status:** 🔄 Approved with changes

**Verdict: APPROVED WITH CHANGES.** The design is sound, proportionate and fits the codebase:
- the catalog and builder shape;
- the backward-compatible `complete()` and `generateEmbedding` changes;
- server-side-only account sources;
- the Pino plan;
- the traceability.

Dev applies WC-1 to WC-10 below to this workplan, then starts implementation. **No second SA workplan pass is needed.** SA verifies the WCs at code review. The BA text changes (RQ-1 to RQ-4) don't block implementation. The image-generation question (ruling (a)) is a user business decision and doesn't block Layer 1 either way.

All claims below were checked in worktree `neuronforge-llm-attribution` @ `6351ebb1`. ts-jest and `uuid` internals were read (read only) from the main checkout's `node_modules`, because the worktree has none.

### 13.1 Requirement check: RC-1 to RC-15 as applied by BA

| RC | Applied correctly? | Note |
|---|---|---|
| RC-1 | ✅ | FR-7, FR-8, catalog "Areas" and "Grouping ids" |
| RC-2 | ✅ | Grouping table, FR-16, AC-10(b) |
| RC-3 | ✅ | FR-3, AC-12. Wording: service-layer calls (insights, briefing, leads) have no request correlation id. Trivially aligned by SA: the log names the correlation id where one exists, otherwise the grouping id |
| RC-4 | ✅ | FR-23 carve-out (a) |
| RC-5 | ✅ | Rows 17c–f, FR-19, AC-5, AC-18, KI-3 |
| RC-6 | ✅ | KI-1, FR-19, FR-24, AC-18, AC-24 |
| RC-7 | ✅ | AC-19 list without `onboarding`; onboarding conversation excluded |
| RC-8 | ✅ | FR-26, AC-22, AC-24 |
| RC-9 | ✅ | FR-11, FR-12, FR-13, AC-6, AC-13 |
| RC-10 | ✅ | NFR Logging. Count corrected by SA: `providerFactory.ts` has 6 real calls, not 8 (`:129` and `:182` are URL strings) |
| RC-11 | ✅, one hint superseded | FR-17 correctly says only "UUID v5 … helper in the catalog module". The "use the existing `uuid` dependency" hint in the RC-11 text is superseded by ruling (c); annotated in the requirement |
| RC-12 | ✅ | FR-21 exported function, AC-15 under code review, AC-18 caveats |
| RC-13 | ✅ | `full_site` covers chat-created landing pages |
| RC-14 | ✅ | Cache-hit row not in the catalog |
| RC-15 | ✅ | FR-21 legacy values; `onboarding` stays under `help` |

**Gap SA missed on 2026-09-16:** `VerifiedQuestions.embed()` (`VerifiedQuestions.ts:74-89`) serves two different calls:
- `similar()` (`:136`, a lookup from `Planner.ts:349`);
- `remember()` (`:197`, a store from `chat-v4/route.ts:1592`).

The catalog names only the lookup. Call names are permanent Layer 2 keys, and plan cache already splits lookup from store. So this is split now (WC-4, RQ-2).

**Stale line references:** Dev §2 is correct (build route `:840`/`:881`, usage map `:65-89`, regenerate `getUser` `:38`). They are cosmetic. BA may refresh them (RQ-4), but they don't block.

### 13.2 Rulings on Dev's items

| # | Ruling | Evidence |
|---|---|---|
| **(a)** Two uncatalogued calls | **Agree: neither is modified in Layer 1.** BA adds both to Excluded calls (RQ-1). **`ServiceGeneratorService`:** broken, same class as Story. **`GeneratedImageService`:** SA's technical view is below. **Whether image spend should count is the user's decision; SA does not decide it** | `ServiceGeneratorService.ts:275`, `:304` call `provider.complete(...)`. `BaseAIProvider` has no `complete` (`baseProvider.ts`, no match). `:314` also reads `response.choices`. It always throws into the fallback, so there are no ledger rows. `GeneratedImageService.ts:186-187`: `new OpenAI(...)` + `images.generate({ model: 'gpt-image-1' })`, a direct SDK call |
| | **Technical view on image spend.** The tracking infrastructure doesn't support image calls today: <br>• The provider layer has no image method (no `images` in `openaiProvider.ts`/`baseProvider.ts`). The call also bypasses the provider factory, which is itself a CLAUDE.md deviation. <br>• `trackAICall` (`aiAnalytics.ts:95`) and the usage card are token-based. Credits are `tokens / tokensPerCredit` (`usage/route.ts:350`). Image generation is priced per image or per image token at a very different rate, so writing raw tokens would misstate credits. <br>• Image generation already has its own guard: a daily per-business count (`GeneratedImageService.ts:170-183`). <br>**Effort if in scope:** medium, about one small slice of its own: <br>• an image method on the provider layer; <br>• image pricing; <br>• a rule for how many credits a picture is worth; <br>• attribution through the catalog (`website` / e.g. `image_generation`). <br>**SA recommendation:** a separate item (Layer 1.5 or later), not Layer 1, whatever the answer | — |
| **(b)** T14, `turnId: correlationId` | **Approved in scope.** Remove the SA gate. It restores FR-9's intent and matches row 2's "Turn (unchanged)". For the product it changes nothing observable | `chat-v4/route.ts:335-336`: `correlationId === turnId` whenever the header is absent or a UUID. The product UI sends no header (`ChatCommandPanel.tsx:919`), and `middleware.ts:46` doesn't forward one. Only a caller that sends a non-UUID header is affected. Today its analysis row gets `session_id = NULL` (`aiAnalytics.ts` `validSessionId`). **ChatBudget is unaffected:** turns are distinct non-null `session_id`s (`ChatBudget.ts:97`), already counted by the planner or cache-hit row, and tokens count every row regardless (`:101-104`). Without T14, the builder would also warn on every such call. BA notes it in FR-9, row 2 and AC-9 (RQ-3) |
| **(c)** UUID v5 via `crypto` | **Approved: implement v5 with Node `crypto`; don't use the `uuid` package.** Conditions: <br>• a test against the RFC 9562 vector; <br>• assert version nibble `5` and variant bits `10xx`; <br>• freeze the namespace constant and the name format (`${userId}:${date}`) with a "never change" comment. <br>Prefer `import { createHash, randomUUID } from 'crypto'` for consistency with `lib/business-os/**` (`MutateExecutor.ts:24`, `ActionLog.ts:15`); `node:crypto` is acceptable | `uuid@13.0.2` is `"type": "module"`. `jest.config.js` has no `transformIgnorePatterns`. Existing suites stub it: `lib/pilot/__tests__/transformFlatten.parentCarry.test.ts:11-19` ("ships ESM-only, which ts-jest does not transform"). A stubbed v5 would make AC-23 vacuous. The RC-11 hint was an implementation suggestion, not an FR |
| **(d)** `runId` on five methods | **Approved: all five required.** FR-16 wording aligned by SA | `CreateInsightParams.runId` `:378`, `createBatch` `:773`, `createCorrelatedInsight` `:1508`, `createOrUpdateHealthSummary` `:1851`, `saveCorrelationResults` `:2289`. Only callers: cron `:232`/`:245`/`:262` (`runId` `:142`) and `scripts/verify-insights.ts:98`/`:114` (`runId = crypto.randomUUID()`, `:57`). `lib/pilot/insight/BusinessInsightGenerator.ts:765` uses the other `lib/repositories/InsightRepository` (skill Rule 1) |
| **(e)** AC-14 rounding | **Approved.** The test asserts exact token and call sums per category against the totals. It asserts nothing about credit sums; rounding stays in the route, unchanged (FR-23). AC-14 wording aligned by SA | `usage/route.ts:350` rounds each category (`:367`) and the total (`:409`) separately; zero-token categories are filtered (`:364`) |
| **(f)** `lib/business-os/usage/usageCategories.ts` | **Approved.** Next 14 App Router route modules may only export handlers and route config. The new directory is fine; the map owns the Business OS owner card's categories, including the non-BOS ones it already lists | `usage/route.ts:65-96`, `:354-361` |
| **(g)** Attribution as a separate argument | **Approved.** A positional required argument is enforced by argument count, even through the `as Parameters<…>[0]` cast. A property inside the cast object would not be. Also accepted: <br>• `groupId` inside the options object for `generateWebsite`/`generateIntakeForm`: `userId` is already positional, those objects aren't cast, and the `= {}` defaults are removed; <br>• an optional trailing `groupId` on `enrichBlock`/`enrichBlocks`, per OQ-5 (see WC-5). <br>Enforcement relies on the `tsc` gate (WC-1) | `WebsiteSectionService.ts:519-529`; `IntakeGenerationService.ts:127` (`opts = {}`); `WebsiteBlockEnrichmentService.ts:154-162`, `:227-234` |
| **(h)** Group id sourcing | **Approved.** <br>• Chat: `groupId` is a required key typed `string \| undefined` (Q-6). <br>• Non-chat entry points always mint a fresh id and never read `x-correlation-id`. FR-8 permits reuse but doesn't require it. Minting keeps AC-24 a pure diff check, and stops a client from pinning one header UUID across many requests to merge unrelated actions into one group. <br>• **Condition:** every mint point logs `groupId`, alongside `correlationId` where one exists: the routes, `MutateExecutor.ts:808`, `WebsiteSectionService.ts:519`, `LeadAlertService.queueLeadReply` and the build route | `generate/route.ts:33`, `landing-pages/generate/route.ts:67` etc. use `header \|\| randomUUID()` for logs only |
| **Item 4** Direct Supabase calls in touched files | **Not fixed in Layer 1. Recorded as a follow-up** under the existing Business OS repo-conformance sweep. <br>Why: all are pre-existing reads/writes on non-ledger tables, unrelated to attribution, and Layer 1 adds **none**. The mandatory repository rule (new DB access goes through `lib/repositories/`) is therefore not waived, and T43 enforces it (WC-8). The one with a security dimension, `blocks/[blockId]/regenerate/route.ts:55-62`, is already OI-2 (separate fix, user decision 2026-09-17). <br>**Complete list** (Dev's F-8 plus SA additions): <br>• `landing-pages/generate/route.ts:80` <br>• `blocks/[blockId]/regenerate/route.ts:62` <br>• `WebsiteSectionService.ts:512` <br>• `usage/route.ts:218`, `:255`, `:286` <br>• `EmbeddingService.ts:208`, `:222`, `:244`, `:261`, `:283`, `:306`, `:334`, `:356` <br>• **SA additions:** `PlanCache.ts:178` (+ RPC), `VerifiedQuestions.ts:106`, `:140`, `:153`, `:201`; `LeadAlertService.ts:110-127`; `WebsiteBlockEnrichmentService.ts:458`, `:1211`, `:1241-1242` <br>• `ChatBudget.ts:158` (not touched) | — |

### 13.3 Other findings

1. **§3.1 design note, AC-3, AC-22 — type-level tests are NOT checked by Jest. High.**
   - `tsconfig.json:13` sets `isolatedModules: true`. ts-jest 29.4.5 reads it (`config-set.js:229`) and skips the language service (`ts-compiler.js:74`), so it runs transpile-only.
   - An unused `@ts-expect-error` does **not** fail `npx jest`. The claim "ts-jest type-checks test files" is wrong.
   - Only `tsc` enforces AC-3 and AC-22, and FR-12's "required attribution". → WC-1.
2. **§11 Step 8 is not independently shippable. High.**
   - Removing `opts = {}` from `generateIntakeForm` breaks `onboarding/build/route.ts:840` (`generateIntakeForm(user.id)`). At runtime `opts.regenerate` (`IntakeGenerationService.ts:131`) throws.
   - The build route wraps intake in a never-fatal `try`, so onboarding would **silently stop creating intake forms**.
   - T38's intake half must land in Step 8. → WC-2.
3. **§11 Step 10 order. Medium.** Once any call site is renamed (Steps 5–9), the new `feature` values fall into `other` (`usage/route.ts:355`) until Step 10 lands. The mapping is pure and has no dependencies, so it goes first. → WC-3.
4. **`WebsiteGenerationService.ts:32` imports `uuid`. Medium (test effort).** T39 must `jest.mock('uuid')` as the pilot tests do. → WC-6.
5. **Backward compatibility confirmed.**
   - `complete()`: trailing optional `context`, and the default literal stays byte-identical (`providerFactory.ts:324-328`). One-argument callers compile unchanged: `OnboardingConversationManager.ts:950`/`:995`/`:1097`/`:1397` and `WebsiteAnalyzer.ts:123`.
   - `generateEmbedding`: optional `callName`; the help bot (`help-bot-v2/route.ts:316`, `:622`) and internal (`:219`, `:258`) callers are unchanged.
   - `generateBatchEmbeddings` (`:150-200`) isn't edited.
   - No existing test calls any changed signature (grep over `*.test.ts`), so AC-16/AC-17 regressions reduce to the named suites, which all exist.
6. **Tenancy confirmed.** Every account source in §4 is server-side:
   - `getUser()`;
   - cron user ids from the DB;
   - `ctx.userId`;
   - `input.ownerId` resolved server-side;
   - the dispatch job's `userId`.

   T31 passing `user.id` instead of the body `userId` (`generate-from-profile/route.ts:64-71`) is a welcome hardening. No `tenant-isolation-guard` trigger: Layer 1 adds no service-role writes keyed by caller-supplied ids.
7. **Pino tasks (T4, T7) approved.** No cycle: `lib/logger` imports only `pino` and config. No `'use client'` module imports either file (grep). The level change from `console.log` to `logger.debug` for provider init lines is acceptable.
8. **Skill compliance.** No new API route, repository or plugin, so `new-api-route`/`new-repository`/`new-plugin` don't apply. The `business-os-insights` close-out (SKILL.md:105) is covered by T44.

### Required workplan changes (Dev)

All ten are applied by Dev (2026-09-17); see the application log in §13.4.

- **WC-1 (§3.1, §6.1, §6.2, §8, T2, T22, T42):** ✅ Applied
  - Remove the "ts-jest type-checks test files" note.
  - T42's `tsc --noEmit` gate must explicitly cover the new test files (`callCatalog.test.ts`, `BriefingNarrator.attribution.test.ts`) and fail on any new error, including TS2578 (unused `@ts-expect-error`).
  - Trace AC-3 (type part) and AC-22 (type part) to T42 as well as T2/T22.
  - Keep the runtime assertions in Jest.
- **WC-2 (§11, T26, T38):** ✅ Applied. Split T38.
  - Step 8: the build route mints one `newBosGroupId()` and passes it to `generateIntakeForm` (`:840`).
  - Step 9: the same id goes to `generateWebsite` (`:881`).
  - Add a Step 8 check that `tsc` shows no new error in `onboarding/build/route.ts`.
- **WC-3 (§11):** ✅ Applied. Move Step 10 (T40, T41) to run directly after Step 1. The legacy + new mapping must be live before any `feature` value changes.
- **WC-4 (§3.1, §4, T13, T15, §8):** ✅ Applied
  - Add chat call name `verified_question_store_embedding` for `VerifiedQuestions.remember()` (`:197`, from `chat-v4/route.ts:1592`). `verified_question_embedding` stays for `similar()` (`:136`).
  - `embed()` takes the call name.
  - Add row "4b" to §4, and add assertions for both names to T15 (AC-8, AC-9).
- **WC-5 (T36):** ✅ Applied. `enrichBlock` itself mints `newBosGroupId()` when `groupId` is absent, because `pages/[id]/enrich/route.ts:75` calls it directly. `enrichBlocks` mints once and passes the id to every `enrichBlock`. Test: two blocks in one `enrichBlocks` call share one id.
- **WC-6 (R-6, T39):** ✅ Applied. T39 mocks `uuid` (the `WebsiteGenerationService.ts:32` import). `callCatalog.ts` must not import `uuid`.
- **WC-7 (T14, §5, §8, §12):** ✅ Applied. T14 is approved (ruling (b)): remove "SA-gated". It is verified by T43 diff review (single token at `:1329`), and T15 asserts `AnalysisService` maps `request.turnId` → `sessionId`.
- **WC-8 (T43, §6.3):** ✅ Applied
  - Add the check: the diff introduces **no new** `supabaseServer.from(` / `.rpc(` / `.storage` call.
  - Record the item-4 list above as a follow-up in §9 (not a task).
- **WC-9 (§6.4 AC-18 pass rule):** ✅ Applied. "`component` values are in the catalog" excludes `BizQLPlanCache` (cache-hit row). If `/api/business-os/chat` (v1) is used in the window, `IntentParser` rows (excluded call, `IntentParser.ts:122-126`) are ignored too.
- **WC-10 (§3.6, T24, T31–T38):** ✅ Applied. Every group-id mint point logs `groupId` (with `correlationId` where one exists) at info or debug level (ruling (h)).

### Requirement text changes for BA (non-blocking)

- **RQ-1 — Excluded calls:**
  - add `lib/services/ServiceGeneratorService.ts:304` (broken, no LLM call, same class as Story);
  - add `lib/services/GeneratedImageService.ts:186` (direct SDK image generation, not in the ledger, **pending user decision** on whether image spend counts; SA recommends a separate item).
- **RQ-2 — Catalog and Per-Call table:**
  - add chat `verified_question_store_embedding` (row 4b: `VerifiedQuestions.ts:197`, account real, turn grouping; before: `business-os-chat` / `EmbeddingService`);
  - add row 4b to AC-8 and AC-9's row lists;
  - reword `verified_question_embedding` as "match (lookup)".
- **RQ-3 — FR-9, row 2, AC-9:** state that chat analysis uses the turn id in every case. It previously used the request correlation id, which equals the turn id unless a caller sends a non-UUID header (ruling (b)).
- **RQ-4 (optional):** refresh the line references listed in Dev §2.

**Trivial wording edits SA made in the requirement** (logged in its Change History, 2026-09-17):
- FR-16 and OQ-4(c): five methods;
- FR-3 and AC-12: correlation id or grouping id;
- AC-14: token and call sums;
- NFR Logging: 6 calls;
- RC-11: annotation.

### Optimisation Suggestions

- The builder could also emit the FR-3 error log when `userId` equals `process.env.SYSTEM_ADMIN_USER_ID` or the all-zero UUID. Both are valid UUIDs that FR-1 forbids and the tracker accepts silently. A one-line check would catch FR-1 regressions in logs before AC-19 does.
- Keep `buildBosCallContext` synchronous and side-effect-free apart from the log, so AC-22 tests stay pure.

### Approval

- [x] Workplan approved, **conditional on** Dev applying WC-1 to WC-10 before implementation (no SA re-review; verified at code review).
- [ ] User business decision outstanding (non-blocking for Layer 1): whether AI-generated website pictures should count against a business's monthly credits (ruling (a)).
  - *Dev note 2026-09-17:* resolved by the user. Website image generation moves to **Layer 1.5** (excluded from Layer 1, untouched); `ServiceGeneratorService` excluded. See §10.1. Checkbox left for SA to confirm.

### 13.4 Dev: WC application log (2026-09-17)

| WC | Applied where | What changed |
|---|---|---|
| WC-1 | §3.1 design notes, §6.1 intro + AC-3/AC-22 rows, §6.2 `tsc` gate, §8.1 (FR-12, FR-16), §8.2 (AC-3, AC-22), §9.1 R-1, T2, T22, T42 | Removed the "ts-jest type-checks test files" claim. The `tsc --noEmit -p .` gate covers touched files and all new test files (explicitly `callCatalog.test.ts`, `BriefingNarrator.attribution.test.ts`) and fails on any new error, incl. TS2578. AC-3 and AC-22 type parts traced to T42; runtime assertions stay in Jest |
| WC-2 | §4 rows 13/15, §5, §8, §9.1 R-10, §11 Steps 9/10, §12 | T38 split into **T38a** (Step 9, intake: mint shared id, pass to `:840`, `tsc` check on `onboarding/build/route.ts`) and **T38b** (Step 10, website: same id to `:881`) |
| WC-3 | §11, §12, §8.1 FR-21, §9.1 R-11 | T40/T41 moved to **Step 2**, directly after the catalog. Later steps renumbered (intake = 9, website = 10) |
| WC-4 | §1, §3.1 catalog, §3.4, §4 row 4b, §5, §6.1 AC-8/AC-9, §6.4 step 1, T1, T13, T15 | Added `verified_question_store_embedding` for `remember()` (`:197`); `verified_question_embedding` stays for `similar()` (`:136`); `embed()` takes the call name |
| WC-5 | §3.4, §6.1 AC-10(a), §9.1 R-1, T36, T39 | `enrichBlock` self-mints when `groupId` is absent; `enrichBlocks` mints once and shares it; tests for both |
| WC-6 | §3.1 import comment, §5, §6.1 intro + AC-5, §6.3, §9.1 R-6, T1, T39, T43 | T39 `jest.mock('uuid')`; `callCatalog.ts` must not import `uuid` (checked in T43) |
| WC-7 | §2 F-1, §4 row 2, §5, §8.1 FR-9, §8.2 AC-9, §6.1 AC-9, §6.3, T14, T15, T43 | "SA-gated" removed; T14 in scope; verified by T43 single-token diff and T15 (`request.turnId` → `sessionId`) |
| WC-8 | §6.3, §8.2, §9.3 FU-1, §2 F-8, T43 | T43 checks the diff adds no new `from(` / `.rpc(` / `.storage` call. The item-4 list (incl. SA additions) is recorded as follow-up FU-1, not a task |
| WC-9 | §6.4 AC-18 pass rule | Catalog check ignores `BizQLPlanCache` (cache-hit row) and `IntentParser` rows from chat v1 |
| WC-10 | §3.6 mint-point table, T21, T24, T27, T28, T31–T33, T35–T37, T38a, §6.3, T43 | Every group-id mint point logs `groupId` (+ `correlationId` where one exists) at info/debug; checked in T43 |

**Rulings recorded:**
- (a) → §2 F-2/F-3, §10, §10.1, §9.3 FU-2/FU-3;
- (b) → T14;
- (c) UUID v5 via Node crypto, tested against the RFC vector → §3.1, T1, T2, AC-23;
- (d) `runId` required on all 5 insight methods → §2, §3.4, T17;
- (e) AC-14 checks exact token and call sums → §6.1, T41;
- (f) mapping lives in `lib/business-os/usage/usageCategories.ts` → §3.5, T40;
- (g) attribution is a separate required argument → §3.4;
- (h) chat grouping id optional; non-chat entry points always generate a fresh id → §3.6;
- item 4: direct Supabase calls in touched files → follow-up for the repo-conformance sweep, not this cycle (FU-1, §9.3, incl. SA's added files).

**User decisions recorded (2026-09-17):** website image generation → Layer 1.5, untouched; `ServiceGeneratorService` excluded (broken); Pino conversion approved for `providerFactory.ts` (6) and `EmbeddingService.ts` (16), explicit tasks T4 and T7 (§10.1).

**SA optimisation adopted:** the FR-3 log also fires for `SYSTEM_ADMIN_USER_ID` and the all-zero UUID (§3.1, AC-12 test). The builder stays synchronous and side-effect-free apart from the log.

---

## 14. QA Testing Report

_QA to populate._

---

## 15. Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created | Dev workplan for Layer 1: line references verified against worktree (§2, 7 mismatches + 8 findings), catalog/helper design, per-call tasks, test plan incl. QA SQL, Pino flags, traceability, 9 SA questions, 46 tasks |
| 2026-09-17 | SA workplan review — Approved with changes | §13 populated: RC-1–RC-15 application verified; rulings (a)–(h) and item 4; findings (Jest runs transpile-only under `isolatedModules`, so type-level ACs need the `tsc` gate; Step 8 not independently shippable; usage mapping must precede renames; verified-question store embedding uncatalogued); WC-1–WC-10 for Dev, RQ-1–RQ-4 for BA; one non-blocking user decision (image-generation spend) |
| 2026-09-17 | SA changes applied — ready to implement | Dev applied WC-1–WC-10 (log in §13.4): `tsc` gate over new test files incl. TS2578; T38 split into T38a (intake, Step 9) / T38b (website, Step 10); usage mapping moved to Step 2; `verified_question_store_embedding` (row 4b); `enrichBlock` self-mints; `uuid` mocked in website test; T14 un-gated; no-new-direct-Supabase check + FU-1 follow-up list; AC-18 pass rule exceptions; mint-point logging. Recorded SA rulings (a)–(h) + item 4 (§10) and user decisions of 2026-09-17 (§10.1: image generation → Layer 1.5, `ServiceGeneratorService` excluded, Pino conversion approved as T4/T7). Status → SA approved, changes applied. 47 tasks, 12 steps |
