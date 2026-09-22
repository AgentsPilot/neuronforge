# Workplan: Business OS LLM Call Attribution — Layer 1

> **Last Updated**: 2026-09-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) (26 FRs / 24 ACs, SA approved 2026-09-17)
**Evidence:** [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md)
**Branch:** `feature/business-os-llm-attribution-layer1` (worktree `neuronforge-llm-attribution`, off `origin/main` @ `6351ebb1`)
**Date:** 2026-09-17
**Status:** SA code review 2026-09-17: Approved with fixes (CR-1 docs only, §13.5; applied). User-approved addition T46–T47 (scoped CI type-check gate + chat label constant, §12.2) implemented; SA review §13.6: T47 approved; T46 approved after CR-2 + S-5 re-verification (§13.6.3). Layer 1 fully SA-approved. **QA 2026-09-17: PASS WITH ISSUES (§14): no Layer 1 bugs; pre-existing P-1/P-2 and test-strength notes W-1 to W-5 are non-blocking. User approved; committed and PR #47 opened (§15).** S-6 (required check on main) is recorded as open issue OI-3 in the requirement. (SA workplan review 2026-09-17: Approved with changes; WC-1 to WC-10 applied, see §13.4. Implementation 2026-09-17, see §12.1. Not committed; RM commits after SA code review, QA and user approval.)

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
13. [SA Review Notes](#13-sa-review-notes) (code review: §13.5)
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

**Not touched:** `lib/analytics/aiAnalytics.ts`, `lib/ai/providers/baseProvider.ts` (read only), `UsageCard.tsx`, and all excluded calls: `AIDataLayerService.ts`, `IntentParser.ts`, `story/route.ts`, `WebsiteAnalyzer.ts`, `OnboardingConversationManager.ts`, `ServiceGeneratorService.ts` (broken; excluded per user decision 2026-09-17) and `GeneratedImageService.ts` (website image generation; moved to Layer 1.5 per user decision 2026-09-17). Also untouched: `lib/repositories/InsightRepository.ts`, the agents-side "insights" system. Per the `business-os-insights` skill (Rule 1), it is a different class from `lib/business-os/insight/repository/InsightRepository.ts`. `lib/pilot/insight/BusinessInsightGenerator.ts:765` uses that other class and is unaffected.

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

**Backward compatibility:** the parameter is trailing and optional, and the default object literal is byte-identical. The only working caller outside Business OS, `OnboardingConversationManager.ts:950/:995/:1097/:1397`, calls `complete({...})` with one argument and compiles and behaves unchanged (AC-7). `WebsiteAnalyzer.ts` is **not** a working `complete()` caller (CR-1): `extractInformationWithLLM` (`:97-123`) calls `getDefaultModel` (not on `SimpleProvider`) and then `complete` on a `BaseAIProvider` (no such method), so its LLM call always fails, with no LLM spend and no ledger row. It is dead and broken like `ServiceGeneratorService`, stays untouched, and is follow-up FU-4. The misleading comment at `:323` is corrected. `CallContext` is imported as a type from `./providers/baseProvider`, which is already imported.

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

**Explicitly unchanged (AC-21, AC-24):** `lib/analytics/aiAnalytics.ts`, `lib/ai/providers/baseProvider.ts`, `lib/business-os/ai-data-layer/AIDataLayerService.ts`, `lib/business-os/IntentParser.ts`, `app/api/business-os/story/route.ts`, `lib/services/WebsiteAnalyzer.ts` (broken: calls non-existent `getDefaultModel` / `BaseAIProvider.complete`, no LLM call; FU-4), `lib/services/OnboardingConversationManager.ts`, `lib/services/ServiceGeneratorService.ts` (F-2, excluded: broken), `lib/services/GeneratedImageService.ts` (F-3, Layer 1.5), `UsageCard.tsx`, `scripts/verify-insights.ts`, `app/api/cron/insight-detect/route.ts` (already passes a `string` `runId`). No `supabase/migrations/**` file. **Update (T47, user-approved addition):** `turnUsage.ts`, `ChatBudget.ts` and `usageReport.ts` were later changed to read the chat label from `BOS_CHAT_FEATURE`: identical string, no behaviour change (§12.2, §13.6).

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
| AC-7 | `providerFactory.complete.test.ts` | One-arg `complete({...})` (the onboarding conversation form) resolves `{ content }` from `choices[0].message.content`. `tsc` on `OnboardingConversationManager.ts` has no new errors (T42). `WebsiteAnalyzer.ts` is not evidence for AC-7: it is broken and makes no `complete()` call (CR-1, FU-4); `tsc` only confirms its two pre-existing errors are unchanged |
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
| FR-12 Other callers unchanged, BOS required | T3, T26, T30, T34, T36 | AC-7 (onboarding conversation, the only working non-BOS caller; WebsiteAnalyzer is broken, FU-4), `tsc` gate (T42, WC-1) |
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
| AC-7 | T3 | T5 + T42 `tsc` (onboarding conversation caller; WebsiteAnalyzer excluded as broken, CR-1) |
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
| FU-4 | **`WebsiteAnalyzer`** (`lib/services/WebsiteAnalyzer.ts:97-123`, `extractInformationWithLLM`) is broken the same way as `ServiceGeneratorService`: it calls `getDefaultModel` (not on `SimpleProvider`) and `complete` on a `BaseAIProvider` (no such method), and reads `response.choices`. No LLM call, no ledger row. Untouched in Layer 1. Fix vs retire decided separately; if fixed, attribute it through the catalog | Separate decision (fix vs retire) | SA code review 2026-09-17, CR-1 |

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
- [x] T0: `npm ci` in worktree; run `chat-budget.test.ts` + `usage-report.test.ts`; record `tsc --noEmit -p .` baseline errors for touched files

**Step 1: Catalog**
- [x] T1: Create `lib/business-os/llm/callCatalog.ts` (§3.1): catalog incl. `verified_question_store_embedding` (WC-4); UUID v5 via Node `crypto`, no `uuid` import (ruling (c), WC-6); frozen namespace + name format with "never change" comment; FR-3 log also for `SYSTEM_ADMIN_USER_ID` / all-zero UUID
- [x] T2: `lib/business-os/llm/__tests__/callCatalog.test.ts`: runtime AC-10d, AC-12, AC-22, AC-23 (RFC 9562 vector, version nibble `5`, variant `10xx`); `@ts-expect-error` cases for AC-22 (verified by `tsc`, not Jest; WC-1). Run the `tsc` filter on both files

**Step 2: Usage mapping (moved up, WC-3)**
- [x] T40: Create `lib/business-os/usage/usageCategories.ts` (ruling (f)); `usage/route.ts` imports it (replaces `:65-96`, `:354-361`)
- [x] T41: `lib/business-os/usage/__tests__/usageCategories.test.ts` (AC-14: exact token + call sums, no credit-sum assertion; ruling (e))

**Step 3: `complete()` helper**
- [x] T3: Optional `context?: CallContext` on `SimpleProvider.complete` + impl; fix `:323` comment
- [x] T4: Pino-convert `lib/ai/providerFactory.ts`: 6 `console.*` calls → `createLogger({ module: 'ProviderFactory' })` (user approved 2026-09-17)
- [x] T5: `lib/ai/__tests__/providerFactory.complete.test.ts` (AC-6, AC-7, AC-12)

**Step 4: Embedding service**
- [x] T6: `callName` on `generateEmbedding` attribution → `component`
- [x] T7: Pino-convert `lib/services/EmbeddingService.ts`: 16 `console.*` calls → `createLogger({ service: 'EmbeddingService' })`, errors as `{ err }` (user approved 2026-09-17)
- [x] T8: `lib/services/__tests__/EmbeddingService.attribution.test.ts` (AC-13)

**Step 5: Chat**
- [x] T9: Row 1 `Planner.ts:481-491` via builder, `activity_type` extras
- [x] T10: Row 2 `AnalysisService.ts:137-143` via builder
- [x] T11: Row 3a `PlanCache.ts:226-230` via `toEmbeddingAttribution`
- [x] T12: Row 3b: `turnId?` on `PlanCache.store` args; attribution at `:333`; `Planner.ts:641-648` passes `turnId: request.turnId`
- [x] T13: Rows 4 + 4b: `embed()` in `VerifiedQuestions.ts:74` takes the call name; `similar()` (`:136`) passes `verified_question_embedding`, `remember()` (`:197`) passes `verified_question_store_embedding`; context at `:81-85` via `toEmbeddingAttribution` (WC-4)
- [x] T14: `chat-v4/route.ts:1329` `turnId: correlationId` → `turnId` (approved in scope, ruling (b); verified by T43 single-token diff and T15; WC-7)
- [x] T15: `lib/business-os/bizql/__tests__/llm-attribution.test.ts` (AC-2; AC-8 incl. rows 4 and 4b by name; AC-9 incl. 4b and `AnalysisService` `request.turnId` → `sessionId`; AC-10a; AC-11)
- [x] T16: Run `chat-budget.test.ts`, `usage-report.test.ts`, `plan-cache-safety.test.ts`, `calendar-dates.test.ts` unchanged (AC-11, AC-17)

**Step 6: Insights**
- [x] T17: `runId: string` (required, ruling (d)) on `CreateInsightParams`, `createBatch`, `saveCorrelationResults`, `createCorrelatedInsight`, `createOrUpdateHealthSummary`; pass `runId` to generators at `:449`, `:1577`, `:1891`
- [x] T18: Rows 7/8/9 contexts (`:724-728`, `:1735-1739`, `:2120-2124`) via builder
- [x] T19: `lib/business-os/insight/__tests__/insight-llm-attribution.test.ts` (AC-1, AC-8, AC-10b)
- [x] T20: Confirm cron route + `scripts/verify-insights.ts` compile unchanged (`tsc` filter)

**Step 7: Briefing**
- [x] T21: `narrateBriefing` `userId: string`; context via builder + `bosBriefingGroupId(userId, facts.day.date)`; keep `activity_type: 'narration'`; include `groupId` in the existing narration log
- [x] T22: `lib/business-os/briefing/__tests__/BriefingNarrator.attribution.test.ts` (AC-3 runtime, AC-8; `@ts-expect-error` part verified by `tsc`, WC-1)

**Step 8: Leads**
- [x] T23: `recommendLeadReply(..., userId, groupId)`; context `:109` via builder; nothing else in the function changes
- [x] T24: `LeadAlertService.queueLeadReply` mints `newBosGroupId()` before `:334`, **logs `groupId`** (WC-10) and passes it
- [x] T25: `lib/business-os/leads/__tests__/lead-reply-attribution.test.ts` (AC-8, AC-10c)

**Step 9: Intake (+ intake half of the build route, WC-2)**
- [x] T26: `generateIntakeForm(userId, { groupId, regenerate? })` (default removed); `callLLM(owner, …)` passes context to `complete()`
- [x] T27: `intake/form/generate/route.ts:47` mints group id and **logs `{ correlationId, groupId }`** (WC-10)
- [x] T28: `infer-question/route.ts` mints group id and **logs `{ correlationId, groupId }`** (WC-10); `infer(text, language, owner)`; context at `:123`
- [x] T38a: `onboarding/build/route.ts`: mint one `newBosGroupId()` (logged with `correlationId`, WC-10) before the intake call and pass it to `generateIntakeForm(user.id, { groupId })` at `:840`. Check: `tsc` shows no new error in `app/api/onboarding/build/route.ts` (WC-2)
- [x] T29: `lib/services/__tests__/intake-llm-attribution.test.ts` (AC-4, AC-8, AC-10a)

**Step 10: Website**
- [x] T30: `generateWebsite(userId, { groupId, … })`; `callLLM(owner, …)` context at `:546`
- [x] T31: `generate-from-profile/route.ts:78` mints group id, **logs it** (WC-10), passes `user.id`
- [x] T32: `MutateExecutor.ts:808` mints group id and **logs it** (WC-10)
- [x] T33: Row 16 `landing-pages/generate/route.ts:118-122` via builder with minted group id, **logged** (WC-10)
- [x] T34: `WebsiteAIContentService`: `owner` on `generateBlockContent`, `regenerateField`, `enhanceTestimonial` and the 4 private generators; contexts at `:301/:337/:371/:414/:546/:602`
- [x] T35: `blocks/[blockId]/regenerate/route.ts:68` and `enhance-testimonial/route.ts:35` mint group id, **log it** (WC-10), pass `user.id` (OI-2 not touched)
- [x] T36: `WebsiteBlockEnrichmentService`: trailing `groupId?` on `enrichBlock`/`enrichBlocks`; **`enrichBlock` mints its own `newBosGroupId()` when absent** (direct caller `pages/[id]/enrich/route.ts:75`); `enrichBlocks` mints once and passes the id to every `enrichBlock`; both mint points log `groupId` (WC-5, WC-10); `owner` into the 4 `*WithAI` methods (`:418/:624/:1018/:1078`)
- [x] T37: `WebsiteSectionService.ts:519`: add second arg `{ userId, groupId: newBosGroupId() }` only, **logging `groupId`** (WC-10); request shape unchanged (KI-1)
- [x] T38b: `onboarding/build/route.ts`: pass the id minted in T38a to `generateWebsite(user.id, { groupId, … })` at `:881` (WC-2)
- [x] T39: `lib/services/__tests__/website-llm-attribution.test.ts` (AC-5, AC-8, AC-10a incl. two blocks in one `enrichBlocks` call sharing one id and a lone `enrichBlock` self-minting; `jest.mock('uuid')`; WC-5, WC-6)

**Step 11: Close-out**
- [x] T42: Full Jest run for touched areas + existing suites (AC-16, AC-17). **`tsc --noEmit -p .` gate** (WC-1): filter on every touched file **and every new test file** (explicitly `callCatalog.test.ts` and `BriefingNarrator.attribution.test.ts`); fail on any error not in the T0 baseline, including **TS2578** (unused `@ts-expect-error`). Verifies the type parts of AC-3 and AC-22 and the FR-12/FR-16 required arguments
- [x] T43: Diff review (§6.3): AC-15; AC-21 (incl. `ServiceGeneratorService.ts`, `GeneratedImageService.ts` untouched); AC-24; T14 single-token diff (WC-7); **no new direct Supabase `from(` / `.rpc(` / `.storage` call** (WC-8); every mint point logs `groupId` (WC-10); no `uuid` import in `callCatalog.ts` (WC-6)
- [x] T44: One-line attribution note in `docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md`
- [x] T45: Update this workplan: task marks, Status → Code Complete, notify TL for SA code review

**Step 12: User-approved additions (2026-09-17, before QA; pending SA review)**
- [x] T46: CI type check scoped to Business OS LLM attribution: `scripts/typecheck-bos-llm.ts` + committed baseline `scripts/typecheck-bos-llm.baseline.json`, npm script `typecheck:bos-llm`, workflow `.github/workflows/bos-llm-typecheck.yml` (PRs and pushes to `main`). Proven to fail on a bad call name, a missing `userId`, and an unused `@ts-expect-error` (TS2578), and to pass on today's code (§12.2). **CR-2 applied:** scope widened through compiler-resolved imports to barrels and direct callers (36 → 96 files), baseline refreshed (21 → 30 errors, +9 pre-existing), proven on a dropped `runId` in the insight cron and a dropped `userId` in `BriefingStore.ts`. **S-5 applied** (workflow permissions, concurrency, timeout)
- [x] T47: Remove the hand-typed chat label: `bosFeature(area)` + `BOS_CHAT_FEATURE` exported from `callCatalog.ts` (the builder uses `bosFeature` too); used in `ChatBudget.ts:161`, `usageReport.ts:187`/`:358`, `turnUsage.ts:105` (cache-hit row stays a non-LLM row) and for the `business-os-*` entries in `usageCategories.ts`. Pure refactor, identical strings; `IntentParser.ts` untouched

**Total: 49 tasks (T0–T37, T38a, T38b, T39–T47) in 13 steps (0–12). T46–T47 are a user-approved addition pending SA review.**

### 12.1 Implementation Notes (Dev, 2026-09-17)

**Verification results**

| Check | Before (T0 baseline) | After | Result |
|---|---|---|---|
| Jest, touched areas (`lib/business-os lib/services lib/ai app/api/website app/api/intake app/api/business-os`) | 83 suites, 1,395 passed, 28 skipped | 94 suites, 1,510 passed, 28 skipped (+10 new suites, +1 `lib/server/website-plugin-executor.test.ts` added to the run) | All green |
| `chat-budget.test.ts`, `usage-report.test.ts` (AC-17) | pass | pass, no edits | ✅ |
| Full `tsc --noEmit -p .` (includes all test files) | 2,045 errors | 2,045 errors; 0 new, 0 resolved; 0 TS2578 | ✅ (WC-1 gate) |
| Full Jest suite (whole repo) | — | 21 suites / 129 tests fail | Pre-existing: the identical 21 suites and 129 tests fail on a clean `git archive` of `9e904f32` (missing `DeclarativeCompiler`, `_DEPRECATED` modules, V6/pilot/orchestration suites). None touches this change |
| T43 diff review | — | no excluded file, migration, `aiAnalytics.ts` or `baseProvider.ts` change; no new `.from(` / `.rpc(` / `.storage`; no free-typed Business OS `feature:` literal outside the catalog; T14 is a one-token diff; AC-15 diff is signature + import + context only; no `uuid` import in the catalog; every `newBosGroupId()` site logs `groupId`; 0 `console.*` in touched files | ✅ |

Per-step `tsc` checks used a subset program (touched files + their import graph) compared against the T0 baseline by (file, code, message), because a full run takes ~10 minutes; the full run was repeated at close-out.

**Deviations from the workplan (for SA)**

| # | Deviation | Why |
|---|---|---|
| D-1 | `enrichBlock` mints its own group id **lazily, only when an AI branch runs** (and `enrichBlocks` only when `useAI` is true), rather than on every call | All production callers pass `useAI = false` (KI-3). Minting and logging a group on every non-AI enrichment would add log noise for a group nothing is recorded under. WC-5's guarantee (a lone `enrichBlock` AI call is grouped under a fresh UUID; blocks in one `enrichBlocks` share one) is unchanged and tested |
| D-2 | `uuidV5` and `isUuid` are exported from `callCatalog.ts` in addition to the §3.1 surface | `uuidV5` is exported so the RFC vector can be tested directly (ruling (c)); `isUuid` is shared by the tests instead of re-declaring the regex in each file |
| D-3 | Row 16 (landing-page route) passes `correlationId` into the builder | So the FR-3 log names the request, as §3.1/Q-7 describe for route-level calls. Other routes pass the owner to a service, where the service builds the context |
| D-4 | `BriefingNarrator` adds `groupId` to its existing failure `warn` log (there is no success log to extend) | T21 says "include `groupId` in the existing narration log"; the failure log is the only one on that path |
| D-5 | `generate-from-profile/route.ts` now calls `generateWebsite(user.id, …)` instead of the body `userId` | Planned in T31; recorded because it is a (safe) behaviour-visible line: the two are already checked equal at `:67`, so nothing changes for a valid request |
| D-6 | `docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md`: the note is on the `InsightRepository.ts` module-map row plus a Change History row, and Last Updated bumped | T44 close-out per the `business-os-insights` skill |

**Things SA should look at closely**

1. **`narrateBriefing(facts, language = 'en', userId: string, …)`**: a required parameter after a defaulted one. TypeScript allows it and the only caller (`BriefingStore.ts:51`) passes all four; a future caller must pass `language` explicitly (or `undefined`).
2. **`WebsiteSectionService.regenerateSectionField`** (KI-1): only a second argument and a mint log were added; the broken request shape and its `as Parameters<…>[0]` cast are untouched. The pre-existing TS2352 on that cast is still in the baseline.
3. **Required-parameter changes rely on `tsc`**: `generateWebsite`/`generateIntakeForm` defaults removed, `runId` required ×5, `groupId` on `recommendLeadReply`. All callers found by grep were updated and the full `tsc` gate shows no new error, but `next.config.js` still ignores TS errors at build.
4. **Pino conversions (T4, T7)**: provider initialisation lines moved from `console.log` to `logger.debug` (not visible at production `info` level); EmbeddingService progress lines are `info`, errors `error` with `{ err }`.
5. **Tests reach private methods by bracket access** (`repo['generateLocalizedContent']`, `service['callLLM']`) as planned in §6, and use a chainable Proxy stub for `supabaseServer` in the chat and lead tests.
6. **SA optimisation adopted**: the builder's FR-3 `logger.error` also fires for `SYSTEM_ADMIN_USER_ID` and the all-zero UUID (TL confirmed keeping it).

**Files changed:** 26 modified/created source and doc files, listed in the Dev report to TL; 10 new test files (`callCatalog`, `usageCategories`, `providerFactory.complete`, `EmbeddingService.attribution`, `llm-attribution` (chat), `insight-llm-attribution`, `BriefingNarrator.attribution`, `lead-reply-attribution`, `intake-llm-attribution`, `website-llm-attribution`).

---

### 12.2 Scoped Type-Check Gate and Chat Label (T46, T47; user-approved addition, pending SA review)

**Why.** The catalog's `as const` unions are only enforced by `tsc`, and nothing runs `tsc` as a gate: `next.config.js` has `ignoreBuildErrors: true`, Jest is transpile-only (`isolatedModules`), the only CI workflow was `plugin-tests.yml`, and the repo carries 2,045 `tsc` errors. A wrong or missing area/call name would ship and write a wrong ledger label.

**Approach chosen (T46): a TypeScript Compiler API script with a committed baseline, no new dependencies.**

| Option | Verdict |
|---|---|
| Small scoped `tsconfig` + `tsc -p` | Rejected: `tsc` reports errors in every transitively imported file, so unrelated modules' errors leak in, and the scoped files already carry 21 pre-existing errors on untouched lines (KI-1 cast, `WebsiteBlockEnrichmentService` content types, onboarding build route, regenerate route) |
| Run full `tsc` and filter its text output | Works, but ~10 minutes, and literal-union order in messages varies between runs, so text matching is flaky |
| **Compiler API script** (`scripts/typecheck-bos-llm.ts`, run with the existing `tsx`) | **Chosen.** Builds the same program as `tsc -p tsconfig.json`, then asks the checker for diagnostics of the in-scope files only. The checker is lazy, so other modules' errors are never reported. ~1 minute locally |

How it works:

1. **Scope (derived from the import graph, not hand-listed; widened by CR-2).** Imports are resolved by the TypeScript compiler, not a regex: `ts.preProcessFile` collects every import, `export … from`, `import()` and `require()` specifier (type-only imports included), and `ts.resolveModuleName` resolves each one with the tsconfig options. So `@/` aliases, relative paths and `index.ts` barrels are followed exactly as `tsc` follows them. The candidate files are the tsconfig program's project files (no `.d.ts`, no `node_modules`). Scope has three layers:
   - **Core** (36 files): everything under `lib/business-os/llm/` and `lib/business-os/usage/`; every file whose imports resolve to `callCatalog.ts` (the only way to use `buildBosCallContext`, `toEmbeddingAttribution`, `newBosGroupId`, `bosBriefingGroupId`, `bosFeature` or `BosLlmOwner`); every test named `*attribution*.test.ts`.
   - **Barrels** (2): any file that re-exports (`export … from`, detected in the AST) an in-scope module, repeated to a fixed point so barrels of barrels count. Today: `lib/business-os/insight/repository/index.ts` and `lib/business-os/insight/index.ts`.
   - **Callers** (58): every file that **directly** imports a core or barrel file, one level only. This is where a missing **required** argument (`runId`, `groupId`, `userId`) is reported, because callers usually don't import the catalog. It brings in, among others, `app/api/cron/insight-detect/route.ts` (via the repository barrel), `lib/business-os/briefing/BriefingStore.ts` (relative import), `scripts/verify-insights.ts` (dynamic `import()` of the barrel), `app/api/business-os/usage/route.ts`, `my-day/route.ts`, `DailyBriefingDispatchService.ts`, the lead form routes and the bizql tests and scripts.
   - **Today: 96 files.** `npm run typecheck:bos-llm -- --list` prints each file with its layer. To extend: import the catalog, or call an attributed service (automatic); follow the test naming convention; or add a directory to `SCOPED_DIRS`.
2. **Baseline:** `scripts/typecheck-bos-llm.baseline.json` holds today's **30** pre-existing errors in scope as **23** keys of (file, code, headline message) with counts. There are no line numbers, so unrelated edits don't break it. Union members inside quoted types are sorted (string-literal unions at any depth, and named unions at the top level), so the checker's run-to-run ordering doesn't break it either (seen for both `'"a" | "b"'` and `'MutateResult | ComputeResult | …'`).
   - **CR-2 baseline additions** (9 errors in 5 newly scoped caller files, all on untouched lines, all present in the T0 full-`tsc` baseline): `app/api/book/manage/[token]/reschedule/route.ts` TS2352 ×1; `scripts/bizql-capability-sweep.ts` TS2339 ×1; `scripts/bizql-conversation-test.ts` TS2339 ×1; `scripts/bizql-planner-test.ts` TS2339 ×3; `tests/business-os-chat/run-eval.ts` TS2339 ×3. One existing key (`blocks/[blockId]/regenerate/route.ts` TS2322) was re-keyed by the union normalisation; it is the same single error. `--update-baseline` is only for a pre-existing error that comes into scope, never for a new one. Fixed baseline entries are reported, not failed.
3. **Fails (exit 1)** on any error not covered by the baseline, including TS2578. A scoped file missing from the tsconfig program exits 2 rather than being skipped silently.
4. **CI:** `.github/workflows/bos-llm-typecheck.yml`, same conventions as `plugin-tests.yml` (Node 18, `actions/setup-node@v4` with npm cache, `npm ci`). Runs on `pull_request` and `push` to `main` (+ `workflow_dispatch`), with **no path filter** because the scope is import-derived. `NODE_OPTIONS=--max-old-space-size=6144`, because the program covers the whole repo. After S-5 it also has `permissions: contents: read`, `concurrency` (group `bos-llm-typecheck-${{ github.ref }}`, `cancel-in-progress: true`) and job `timeout-minutes: 15`.
5. **Runtime:** ~65 s locally for the gate with 96 files in scope (was ~60 s with 36; the import-graph scan adds a few seconds, and `--list` alone takes ~20 s).

**Gate proof, CR-2 (2026-09-17, local, 96-file scope).** Each mutation was applied alone, the gate run, and the file restored from a backup copy (byte-identical, `cmp`). At the end, `git diff` and `git status --porcelain` were byte-identical to a snapshot taken before the proof.

| Change introduced | Gate result |
|---|---|
| `repository.createBatch(userId, prioritized)` in `app/api/cron/insight-detect/route.ts` (`runId` dropped at a **caller** reached through the barrel) | `31 errors, 1 new`: TS2554 `Expected 3 arguments, but got 2.` at `:232`, exit 1 |
| `narrateBriefing(facts, language, businessType)` at `lib/business-os/briefing/BriefingStore.ts:51` (`userId` dropped at a relative-import caller) | `1 new`: TS2345 `Argument of type 'BusinessType' is not assignable to parameter of type 'string'.`, exit 1 |
| `callName: 'ful_site'` in `WebsiteGenerationService.ts:570` | `1 new`: TS2820 `… Did you mean '"full_site"'?`, exit 1 |
| None (clean, after all restores) | `96 files in scope, 30 errors, 0 new (65.1s)`, passed, exit 0 |

**Gate proof, original T46 (2026-09-17, 36-file scope; each change reverted from a backup copy afterwards):**

| Change introduced | Gate result |
|---|---|
| None (today's code) | `36 files in scope, 21 errors, 0 new`, passed, exit 0 |
| `callName: 'ful_site'` in `WebsiteGenerationService.ts` | TS2820 `'"ful_site"' is not assignable … Did you mean '"full_site"'?`, exit 1 |
| `userId` removed from `buildBosCallContext` in `LeadReplyRecommender.ts` | TS2345 `Property 'userId' is missing`, exit 1 |
| `callName: 'planner'` for area `website` in `callCatalog.test.ts` | TS2345 `'"planner"' is not assignable …`, exit 1 |
| Wrong-area `@ts-expect-error` case made valid (`callName: 'planner'` for `chat`) | TS2578 `Unused '@ts-expect-error' directive`, exit 1 |
| After revert (via `npm run typecheck:bos-llm`) | `0 new`, passed, exit 0 |

**Chat label (T47).** `bosFeature(area): \`business-os-${A}\`` is the single place the prefix is written. `buildBosCallContext` uses it, and `BOS_CHAT_FEATURE = bosFeature('chat')` replaces the four hand-typed `'business-os-chat'` literals in chat telemetry. `usageCategories.ts` uses `bosFeature(...)` for its six Business OS entries; the legacy values stay literal. A new `callCatalog.test.ts` case pins `BOS_CHAT_FEATURE === 'business-os-chat'`. The three telemetry files have **0** `console.*` calls. Their pre-existing direct `supabaseServer` reads are unchanged (only the `.eq('feature', …)` argument changed) and are already on FU-1.

**Verification after T46/T47:**
- Jest, touched areas: 94 suites, 1,512 passed, 28 skipped. `chat-budget.test.ts` and `usage-report.test.ts` pass unedited.
- Full `tsc`: 2,045 errors, 0 new, 0 resolved, 0 TS2578. The new script itself compiles clean.
- Gate: passed, 0 new.

**Note for SA:** the script is a CLI under `scripts/` and prints its report with `console.*`, like `scripts/schema-check.ts`. The CLAUDE.md Pino rule covers `lib/`, `app/` and `components/`.

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

### 13.5 SA Code Review

**Code Review by SA — 2026-09-17**
**Status:** ✅ Code Approved, with one documentation fix (CR-1)

**Verdict: APPROVED WITH FIXES.** The code needs no changes. CR-1 is a workplan and requirement text correction. It does **not** block QA, but it must be in before RM commits.

Reviewed in worktree `neuronforge-llm-attribution` (uncommitted diff on `9e904f32`): 27 modified files (25 code/doc files plus this workplan and the insights doc) and 12 untracked files (2 modules, 10 tests).

#### 13.5.1 Independent verification

| Check | SA result | Matches Dev? |
|---|---|---|
| Jest, touched areas (`lib/business-os lib/services lib/ai app/api/website app/api/intake app/api/business-os`) | 93 suites / 1,488 passed / 28 skipped; plus `lib/server/website-plugin-executor.test.ts` 1 suite / 22 passed = **94 / 1,510** | ✅ |
| `chat-budget.test.ts`, `usage-report.test.ts` | Pass, and neither file is in the diff | ✅ |
| Full `tsc --noEmit -p .` | **2,045 errors, 0 TS2578.** Every error in a touched file is on unchanged code: `EmbeddingService.ts:129/185` `createEmbedding`; `WebsiteBlockEnrichmentService.ts` `EnrichmentResult` variance; `WebsiteSectionService.ts:525` TS2352 (KI-1 cast); `regenerate/route.ts:76` profile type; `onboarding/build/route.ts:395-397` null checks. There is none in any new file or in any caller of a changed signature (cron, `verify-insights.ts`, `BriefingStore.ts`, `WebsitePublishService.ts`, `pages/[id]/enrich`, `pages/route.ts`, `OnboardingConversationManager.ts`) | ✅ |
| **Type-level tests really bite (AC-3, AC-22)** | SA ran `tsc` on a subset program holding copies of `callCatalog.test.ts` and `BriefingNarrator.attribution.test.ts`, with the "bad" line fixed in each (`full_site`→`planner` on a chat attribution; `groupId: undefined`→`G1` on intake; `narrateBriefing(facts, 'en')`→`+ U1`). **Each mutation produced TS2578.** The unmutated files compile clean. The `@ts-expect-error` cases are effective, not vacuous | ✅ |
| Excluded files unchanged (AC-21) | `git diff` is empty for `lib/analytics/`, `lib/ai/providers/`, `GeneratedImageService.ts`, `ServiceGeneratorService.ts`, `OnboardingConversationManager.ts`, `WebsiteAnalyzer.ts`, `IntentParser.ts`, `story/`, `bizql/telemetry/`, `components/`, `scripts/`, `supabase/` | ✅ |
| No new direct Supabase call (WC-8) | No `+` line in the diff has `.from(` / `.rpc(` / `.storage` | ✅ |
| Pino (NFR Logging, CLAUDE.md rule 3) | 0 `console.*` calls in every touched and new file. `providerFactory.ts` 6 → 0, `EmbeddingService.ts` 16 → 0; errors logged as `{ err }` | ✅ |
| No new `any` | No `+` line adds `any`. The `as never` on `AnalysisService`'s context and `profile: any` in `WebsiteGenerationService.callLLM` were already there | ✅ |
| AC-15 | `LeadReplyRecommender.ts` diff hunks: import (`:30`), signature (`:78-80`), context literal (`:112`). Nothing from `:113` onward | ✅ |
| T14 (WC-7) | `chat-v4/route.ts`: one-token change at `:1329`; `turnId` is in scope (`:335`) | ✅ |

#### 13.5.2 Per-row correctness and tenancy

Every row was checked in the diff for `feature` / `component` / `session_id` and traced back to its account source.

| Row | Context (verified) | Account source (server-side) | Group source |
|---|---|---|---|
| 1 planner | `business-os-chat` / `planner` / `request.turnId`; `activity_type` kept via extras | `chat-v4` `getUser()` | turn |
| 2 analysis | `… / analysis / request.turnId` | `chat-v4` `user.id` | turn (T14) |
| 3a / 3b | `… / plan_cache_lookup_embedding` · `plan_cache_store_embedding` / turn. `category`/`activity_*` unchanged (set inside EmbeddingService) | Planner `request.userId` | turn; 3b via new `store({ turnId })` (`Planner.ts:652`) |
| 4 / 4b | `… / verified_question_embedding` (`similar`) · `verified_question_store_embedding` (`remember`) | Planner / `chat-v4` `user.id` | turn |
| 7 / 8 / 9 | `business-os-insights` / `insight_content` · `correlated_insight` · `health_summary` / `runId` | the cron's DB-iterated `userId` (`insight-detect/route.ts:205`); `'system'` is gone | cron `runId` (`:142`), required on all 5 public methods and 3 private generators |
| 10 | `business-os-briefing` / `daily_narration` / v5(`userId`, `facts.day.date`); `activity_type: 'narration'` kept; `'unknown'` gone | `my-day` `user.id` or the dispatch job's `userId`, via `BriefingStore.ts:51` | derived |
| 12 | `business-os-leads` / `reply_recommendation` / minted per enquiry (`LeadAlertService.ts:336`) | `input.ownerId`, resolved from DB records by all 5 `notifyOwnerOfLead` callers (website page / business profile / booking row) | minted |
| 13 / 14 | `business-os-intake` / `form_generation` · `question_inference` | `getUser()` in both routes; the build route uses `user.id` | minted at the route (`generate/route.ts:49`, `infer-question/route.ts:67`); build route shares one (`:825`) |
| 15 | `business-os-website` / `full_site` | `generate-from-profile` now passes **`user.id`** (D-5); `MutateExecutor` `ctx.userId`; build route `user.id` | minted (`generate-from-profile:76`, `MutateExecutor:811`, build `:825`) |
| 16 | `… / landing_page` via the builder in the route | `getUser()` | minted (`:91`) |
| 17a / 17b | `… / field_regenerate` · `testimonial_enhance`, with the owner as a separate positional argument | `regenerate` `user.id`; `enhance-testimonial` `user.id`; `WebsiteSectionService` `userId` param (KI-1, compile-only; the request object at `:525-535` is unchanged) | minted (`regenerate:68`, `enhance-testimonial:34`, `WebsiteSectionService:521`) |
| 17c–f | `… / hero_content` · `about_content` · `faq_content` · `features_content` | `enrichBlock(s)` `userId`, from `getUser()` at every caller | `enrichBlocks` shared, or `enrichBlock` lazy self-mint (D-1) |

**Tenancy: no finding.** No attribution field is read from a body, query string or header. The intake and website tests also cover a hostile body `userId`/`groupId`, and it is ignored. `x-correlation-id` reaches the builder only as the FR-3 log field (D-3); it is never written to the ledger. Layer 1 adds no service-role write keyed by a caller-supplied id, so `tenant-isolation-guard` doesn't trigger. OI-2 (`regenerate` reads a block without an owner check) is unchanged and still tracked separately. Attribution there uses the **requester's** `user.id`, which is correct for spend.

#### 13.5.3 Backward compatibility, RC-3, no behaviour change

- **`getProviderFactory().complete()`:** `context` is a trailing optional parameter, and `context ?? { userId: 'system', feature: 'onboarding', component: 'simple-complete' }` is identical to the old literal. AC-6 asserts both paths with `toStrictEqual`, plus reference identity for the passed context. `OnboardingConversationManager.ts:950/995/1097/1397` compile unchanged.
- **`EmbeddingService`:** `callName` is optional, and the only change inside the context is `component: attribution?.callName ?? 'EmbeddingService'`. AC-13 pins the helpbot default and the batch context byte-for-byte. Help bot callers are unchanged.
- **RC-3:** `buildBosCallContext` never throws. It logs at `error` (`callCatalog.ts:130-136`) and returns `userId` unchanged. `aiAnalytics.ts:121-126` still moves it to the system user, so the row is written. `aiAnalytics.ts` and `baseProvider.ts` are byte-identical.
- **No behaviour change:** no model, prompt, temperature, token limit or response handling changed in any row.
  - **ChatBudget and the chat usage report** read `feature`, `session_id` and `activity_type`, never `component` (`usageReport.ts:129/142/153`), so renaming `BizQLPlanner` → `planner` etc. doesn't affect them. No other code or SQL filters on the old component values; the admin drill-down only passes through a user-chosen filter (OQ-2, accepted).
  - **The RC-4 carve-out applies only to 3b:** 4b already wrote `business-os-chat`.
- **Usage mapping (RC-15):** it contains every new and legacy value in FR-21, and `onboarding` stays under `help`. `business_os_usage_summary` groups by feature with no feature filter, so nothing new is dropped. `UsageCard.tsx` doesn't render `breakdown`, so the missing `usage.category.briefing/intake/leads` labels need no change (FR-21).

#### 13.5.4 WC-1 … WC-10: implemented, not just documented

| WC | Evidence in code | Result |
|---|---|---|
| WC-1 | Full `tsc` gate re-run by SA (0 new, 0 TS2578), plus the mutation proof in §13.5.1 | ✅ |
| WC-2 | `onboarding/build/route.ts:825` mints `buildGroupId` → intake `:848-850` and website `:891`; `generateIntakeForm` default removed | ✅ |
| WC-3 | `usageCategories.ts` carries legacy + new values; the route imports it | ✅ |
| WC-4 | `VerifiedQuestions.embed(…, callName)`; `similar` / `remember` pass distinct names; catalog + tests assert both | ✅ |
| WC-5 | `enrichBlock` trailing `groupId?` + self-mint; `enrichBlocks` mints once and passes it down (`WebsiteBlockEnrichmentService.ts:249-254`); tested (shared, caller-supplied, lone) | ✅ (lazy, see D-1) |
| WC-6 | `callCatalog.ts` imports only `crypto`; website test mocks `uuid` | ✅ |
| WC-7 | Single-token `:1329`; `analyse` test asserts `request.turnId` → `sessionId` | ✅ |
| WC-8 | No new `.from(` / `.rpc(` / `.storage` | ✅ |
| WC-9 | §6.4 pass rule carries both exceptions | ✅ (QA-facing) |
| WC-10 | All 11 mint points log `groupId`: routes at `info` with the request's child logger (so `correlationId` is attached); `MutateExecutor` `info`; `WebsiteSectionService` `info`; build route `info`; `LeadAlertService` `debug` (child carries `ownerId`, `contactId`); enrichment `debug` | ✅ |

#### 13.5.5 Deviations

| # | SA judgement |
|---|---|
| D-1 lazy self-mint | **Accepted.** WC-5's guarantee holds: every AI call made without a supplied id still gets a UUID group, and blocks in one `enrichBlocks` share it. It also avoids logging groups nothing is recorded under. The `aiOwner()` closure runs only on an AI branch, and at most once per `enrichBlock`, so no block can get two ids |
| D-2 export `uuidV5`, `isUuid` | **Accepted.** Needed to test the RFC vector directly (ruling (c)). `isUuid` has no other production importer yet, so this adds no competing validation pattern. Don't let it become a second source of truth next to `chat-v4`'s local `isUuid` without consolidating |
| D-3 `correlationId` into the builder (row 16) | **Accepted.** Log-only field, per FR-3/AC-12; never persisted |
| D-4 `groupId` on the failure `warn` | **Accepted.** There is no success log on that path, and the id is derivable anyway (v5 of account + date) |
| D-5 `generate-from-profile` passes `user.id` | **Accepted; a small hardening.** Equal to the body value after the `:67` check, so no behaviour change for a valid request |
| D-6 insights doc placement | **Accepted.** Satisfies the `business-os-insights` skill close-out |

#### 13.5.6 Dev's flagged items

1. **Required `userId` after defaulted `language` (`BriefingNarrator.ts:82-88`).** Accepted. There is one caller, and TS makes `language` effectively required-but-undefined-able, so no call can silently drop the account. Reordering would be a wider signature change for no gain.
2. **KI-1 left broken.** Accepted, as FR-19 requires. The request object is unchanged, and the owner is a positional argument the cast cannot hide.
3. **Required params enforced only by `tsc`.** Accepted residual risk (R-1), mitigated in this cycle by the full gate run. It is a repo-wide gap, not introduced here → optional suggestion S-4.
4. **Provider init logs at `debug`.** Accepted, as approved in §13.3 item 7.
5. **Bracket access to private methods; Proxy stub of `supabaseServer`.** Accepted for this cycle. Bracket access keeps type checking, unlike `as any`. The Proxy stub resolves every chain to one shared result. That is acceptable because the tests assert provider contexts, not queries, but it would hide a query-shape regression if these tests were ever extended to cover DB behaviour.
6. **Extra error log for `SYSTEM_ADMIN_USER_ID` / all-zero.** Accepted. See QA note Q-1.

#### 13.5.7 Findings (ranked)

No High or Medium findings.

| # | File:line | Finding | Priority |
|---|---|---|---|
| F-A | Workplan §3.2 "Backward compatibility", §6.1 AC-7, §5; requirement FR-12 | **Inaccurate evidence.** `WebsiteAnalyzer.ts:101-123` is **not** a one-argument `getProviderFactory().complete()` caller. It calls `this.factory.getDefaultModel('openai')` (doesn't exist on `SimpleProvider`) and then `provider.complete(...)` on a `BaseAIProvider` (doesn't exist), and reads `response.choices`. `tsc` flags both (pre-existing, untouched file). It is broken the same way as `ServiceGeneratorService` (F-2/FU-3): the website-analysis LLM call always throws, so no ledger row is written. **No impact on Layer 1 correctness**: AC-7 still holds through `OnboardingConversationManager`. But the docs claim a working caller that doesn't exist, and a second silently broken Business OS AI call is untracked | Low → **CR-1** |
| F-B | `lib/services/__tests__/*`, routes | **Test gap:** no automated test covers the mint point or the `user.id` source in `generate-from-profile`, `blocks/[blockId]/regenerate`, `MutateExecutor.ts:811` or `onboarding/build/route.ts:825`. SA verified each by review (§13.5.2), and QA §6.4 steps 4–5 exercise the first two live | Low (optional S-1) |
| F-C | `insight-llm-attribution.test.ts` | `runId` forwarding is tested at runtime for `createBatch`→`create` and `saveCorrelationResults`→children, but not for `create`/`createCorrelatedInsight`/`createOrUpdateHealthSummary` → private generator. `tsc` enforces it (required positional `runId`), and QA step 2 checks it live | Low (optional S-2) |
| F-D | `lib/services/LeadAlertService.ts:337` | The group-id mint log is `debug`, so in production (`info`) an enquiry's usage group can't be linked back from logs. Allowed by WC-10 ("info or debug"), but it is the only request-less mint point without an `info` line | Low (optional S-3) |
| F-E | `app/api/onboarding/build/route.ts:825-826` | Mints and logs `buildGroupId` even when neither intake nor website runs: one idle log line per build | Cosmetic |

#### Required fixes

- **CR-1 (docs only; before RM commit, doesn't block QA).**
  - **Dev (workplan):** in §3.2, §5 "Explicitly unchanged" and §6.1 AC-7, stop citing `WebsiteAnalyzer.ts:123` as a working one-argument `complete()` caller. Say it is broken (it calls the non-existent `getDefaultModel`/`BaseAIProvider.complete`) and untouched.
  - **Dev (workplan):** add **FU-4** to §9.3 next to FU-3: "`WebsiteAnalyzer.extractInformationWithLLM` is broken the same way as `ServiceGeneratorService`; no LLM call, no ledger row; separate fix; attribute through the catalog when fixed."
  - **BA (requirement):** in FR-12 and the Excluded calls table, note WebsiteAnalyzer as broken rather than "keeps working unchanged".
  - ✅ **Dev part applied 2026-09-17:** §3.2 backward-compatibility note, §5 "Explicitly unchanged", §6.1 AC-7, §8.1 FR-12 and §8.2 AC-7 no longer cite WebsiteAnalyzer as a working caller; FU-4 added to §9.3. No code touched. (BA part is tracked in the requirement.)

#### Optimisation Suggestions (optional, non-blocking)

- **S-1:** Add route-level tests for `generate-from-profile` (hostile body `userId` equal to the session, `generateWebsite` receives `user.id` + UUID `groupId`) and `blocks/[blockId]/regenerate` (owner argument = `user.id`), mirroring the existing intake and testimonial route tests.
- **S-2:** One test per insight public method asserting the generator receives the same `runId` (spy on the private generator via bracket access).
- **S-3:** Raise `LeadAlertService.ts:337` to `info`, for parity with the other mint points.
- **S-4 (follow-up, not this cycle):** A CI `tsc` diff gate (touched files, TS2578 included). `next.config.js` ignores type errors and Jest is transpile-only, so the "required attribution" guarantees are only as strong as someone remembering to run `tsc`.

#### QA notes (for §6.4)

- **Q-1:** `TEST_USER_ID` **must not** equal `SYSTEM_ADMIN_USER_ID` in the QA environment. Otherwise AC-19 reports that business's legitimate rows as system-user rows, and every call emits the FR-3 error log by design.
- **Q-2:** Expect FR-3 `error` logs from any chat eval script run with a non-UUID user id (e.g. `tests/business-os-chat/run-eval.ts`). That is by design, not a regression.

#### Scope creep check

Nothing excluded was touched: `GeneratedImageService`, `ServiceGeneratorService`, `LeadReplyRecommender` response handling (AC-15), OI-1, OI-2 (`regenerate` ownership read unchanged), FU-1 (no repository refactors). No migration.

### Code Approved for QA: Yes

QA may start now. CR-1 (documentation only) must be applied before RM commits; SA doesn't need to re-review it.

### 13.6 SA Code Review Addendum: T46 (scoped type-check gate) and T47 (chat label from the catalog)

**Code Review by SA — 2026-09-17**

| Item | Verdict |
|---|---|
| **T46 gate** | 🔄 **Fix Required: CR-2.** The mechanism works, but the scope misses the callers of the required parameters. That is half of what the gate is for |
| **T47 chat label** | ✅ **Approved** |
| CR-1 | ✅ Applied (workplan §3.2/§5/§6.1/§8/§9.3 FU-4; requirement FR-12, AC-7, AC-21, AC-24, Excluded calls). Docs only |

QA may continue on the Layer 1 behaviour. **CR-2 must land (with SA spot-check of the proof) before RM commits**, because the workflow is part of this commit.

#### 13.6.1 Independent verification

| Check | Result |
|---|---|
| Gate on current code (`npm run typecheck:bos-llm`) | 36 files in scope, 21 errors, 0 new, **exit 0**, 55 s locally |
| Mutation 1: `callName: 'ful_site'` (`WebsiteGenerationService.ts`) | Reported TS2820 ("Did you mean 'full_site'?"), **exit 1** |
| Mutation 2: `userId` removed from `buildBosCallContext` (`LeadReplyRecommender.ts`) | Reported TS2345 "Property 'userId' is missing", **exit 1** |
| Mutation 3: required `runId` dropped at a **caller**, `repository.createBatch(userId, prioritized)` in `app/api/cron/insight-detect/route.ts` | **Not reported.** The run showed "2 new", not 3. A real TS2554 that ships silently → CR-2 |
| Restore | All four files copied back from backups: md5 matches, and `git status` / `git diff` are byte-identical to the pre-test snapshot |
| TS2578 (unused `@ts-expect-error`) | Covered: both type-test files are in scope, and SA's §13.5.1 mutation proof fires TS2578 |
| T47 tests | `chat-budget.test.ts`, `usage-report.test.ts`, `llm/`, `usage/`: 4 suites / 66 passed. The two chat test files are **not** in the diff |
| Scope creep | Non-doc diff = the 25 files reviewed in §13.5 + `ChatBudget.ts`, `turnUsage.ts`, `usageReport.ts` + `package.json` (one script line); new: script, baseline, workflow. Doc diffs are CR-1 only. Nothing else |

#### 13.6.2 Findings

| # | File:line | Finding | Priority |
|---|---|---|---|
| G-1 | `scripts/typecheck-bos-llm.ts` `scopedFiles()` / `CATALOG_IMPORT` | **Scope is "files that import the catalog", but a required-parameter error lands in the *caller*.** Callers of the changed required signatures that don't import the catalog are out of scope, so a dropped or missing argument there passes the gate (mutation 3). Today that means: `app/api/cron/insight-detect/route.ts` (`runId`; imports via the **barrel** `@/lib/business-os/insight/repository`), `scripts/verify-insights.ts` (`runId`), `lib/business-os/briefing/BriefingStore.ts` (`userId`; **relative** `./BriefingNarrator` import), and **any future new caller** of `generateWebsite` / `generateIntakeForm` / `recommendLeadReply` / `regenerateField` / `enhanceTestimonial` / `generateBlockContent` / the insight methods that doesn't itself mint an id. The account and call-name checks (mutations 1–2) are covered; the "can't forget attribution" guarantee (FR-12, FR-16, FR-17) is not | **Medium → CR-2** |
| G-2 | Baseline keying | **The premise of the question is outdated: the baseline already stores a count per key** (`texts.length > allowed`, and `--update-baseline` writes counts). A second identical error in the same file therefore **fails**. The only residual mask is "fix one baselined error and add an identical one in the same change", which nets to zero. That is negligible and needs no line numbers. **Acceptable as is** | Info |
| G-3 | `app/api/business-os/usage/route.ts` | Not in scope (imports `usageCategories`, not the catalog). Its only use is `summariseUsageByCategory`, which takes no attribution types, so the risk is low. CR-2's importer rule covers it anyway | Low (fixed by CR-2) |
| G-4 | Type-only imports; tests outside `*attribution*` | **No gap.** `import type { BosLlmOwner } from '…/callCatalog'` and `{ …, type BosLlmOwner }` both match (`from '…'` is on the final line even for multi-line imports). `callCatalog.test.ts` and `usageCategories.test.ts` are covered by `SCOPED_DIRS`, and `providerFactory.complete.test.ts` by its catalog import | Info |
| G-5 | `.github/workflows/bos-llm-typecheck.yml` | Correct: PR + push to `main` + manual; no secrets; Node 18 and `setup-node` npm cache, like `plugin-tests.yml`. No path filter is justified (scope is import-derived). `process.exit(1)` for new errors and `2` for config/scope errors propagate through `npm run`, so the check fails properly. Cost: one `npm ci` plus about a minute of checking per PR. Missing (optional): `permissions: contents: read`, `timeout-minutes`, and `concurrency` with cancel-in-progress | Low (S-5) |
| G-6 | `scripts/typecheck-bos-llm.ts` | Quality is good: no new dependencies (`typescript`, `tsx` already in `package.json`); `stableMessage` handles the union-order flake; a scoped file missing from the program fails loudly (exit 2); failure output lists `file(line,col): error TSxxxx: message`; stale baseline entries are reported without failing. `console.*` in `scripts/` is **accepted**: the CLAUDE.md Pino rule covers `lib/`, `app/`, `components/`, and a CLI's stdout/stderr and exit code are its interface (precedent `scripts/schema-check.ts`) | Info |
| G-7 | Workflow memory | `NODE_OPTIONS=--max-old-space-size=6144` builds the whole-repo program. That fits a standard hosted runner (a local `tsc` without a raised heap hit OOM at ~4 GB). Watch it if the runner type changes | Info |
| T-1 | `callCatalog.ts:65-77`, `ChatBudget.ts:162`, `usageReport.ts:188/:359`, `turnUsage.ts:107`, `usageCategories.ts:30-61` | **T47 is a pure refactor.** `bosFeature(area)` returns `` `business-os-${area}` `` (typed as a template literal), so every string is identical, and a test pins `BOS_CHAT_FEATURE === 'business-os-chat'`. No `'use client'` module imports the catalog, `usageCategories` or the three telemetry files, so the catalog's `crypto` import can't reach a browser bundle. `IntentParser.ts` is untouched. Bonus: the three telemetry files are now inside the gate's scope | ✅ |

#### Required fix

- **CR-2 (Dev, T46): cover the callers.** ✅ **Applied by Dev 2026-09-17** (§12.2): scope now resolves imports through the compiler (`ts.preProcessFile` + `ts.resolveModuleName`) and adds re-export barrels (to a fixed point) plus their and the core's direct importers, for 36 → 96 files. It covers `insight-detect/route.ts` via the repository barrel, `BriefingStore.ts`, `scripts/verify-insights.ts` (dynamic import) and `usage/route.ts`. The baseline was refreshed: 21 → 30 errors, +9 pre-existing in 5 caller files, listed in §12.2. Union normalisation was extended to named unions after one of them reordered between runs. Proof: dropped `runId` in the cron → TS2554, exit 1; dropped `userId` at `BriefingStore.ts:51` → TS2345, exit 1; `'ful_site'` → TS2820, exit 1; clean → 0 new, exit 0 (65 s); `git diff`/`status` byte-identical to the pre-proof snapshot. Header comment SCOPE section updated. Awaiting SA spot-check.
  - **Extend the scope:** add **every source file (tests included) that directly imports an in-scope non-test file**. Resolve the imports through the TypeScript program rather than a regex: for each import, export-from and dynamic-import specifier, use `ts.resolveModuleName` (or the program's resolved modules), so **relative imports and `index.ts` barrels** are followed. A re-export-only barrel should pass through to its importers. That is what brings in `insight-detect/route.ts`, `BriefingStore.ts`, `scripts/verify-insights.ts` and `usage/route.ts`.
  - **Refresh the baseline:** run `--update-baseline` once. SA's sample of importers found only about 3 pre-existing errors, so the baseline stays small.
  - **Prove it:** add mutation 3 to the §12.2 evidence (drop `runId` in the cron route → gate exits 1), plus one relative-import caller (e.g. drop `userId` in `BriefingStore.ts:51` → exit 1). Then revert and confirm a clean `git diff`.
  - **Update the header comment:** the SCOPE section should describe the importer rule.

#### Optimisation Suggestions (optional)

- **S-5:** ✅ *Applied by Dev 2026-09-17* (`permissions: contents: read`, `concurrency` group `bos-llm-typecheck-${{ github.ref }}` with `cancel-in-progress: true`, `timeout-minutes: 15`; YAML validated). In the workflow, add `permissions: contents: read`, `timeout-minutes: 15`, and `concurrency: { group: bos-llm-typecheck-${{ github.ref }}, cancel-in-progress: true }`.
- **S-6:** Consider making this job a required status check on `main` in branch protection. Otherwise a red run is advisory only (this is a repo-settings action for the user or an admin, not a code change).

### Code Approved for QA: Yes (Layer 1 behaviour). Commit blocked on CR-2.

#### 13.6.3 CR-2 / S-5 re-verification (SA, 2026-09-17)

**T46 verdict: ✅ Approved. CR-2 is resolved and S-5 is verified. The Layer 1 code, including T46 and T47, is now fully SA-approved for QA and for commit after QA and user approval.** S-6 (make the job a required check on `main`) is still open. It is a repo-settings action for an admin.

| Check | SA result |
|---|---|
| Scope (`--list`) | 96 files: 4 core, 30 catalog importers, 2 attribution tests, **2 barrels** (`lib/business-os/insight/index.ts`, `…/insight/repository/index.ts`), 58 callers. Includes `insight-detect/route.ts`, `BriefingStore.ts`, `scripts/verify-insights.ts`, `usage/route.ts` |
| **Proof: cron `runId`** (`createBatch(userId, prioritized)`) | `insight-detect/route.ts(232,43): TS2554 Expected 3 arguments, but got 2`, **exit 1** |
| **Proof: BriefingStore `userId`** (`narrateBriefing(facts, language)`) | `BriefingStore.ts(51,27): TS2554 Expected 3-4 arguments, but got 2`, **exit 1** |
| Restore | Both files copied back from backups: md5 matches; `git status` and `git diff` byte-identical to the pre-test snapshot |
| Clean run | 96 files, 30 errors, **0 new, exit 0**, about 73 s locally |
| **The 9 baseline additions are pre-existing** | All 9 match the full-program `tsc` output line for line: reschedule `:112` TS2352; `bizql-capability-sweep.ts:99`, `bizql-conversation-test.ts:110`, `bizql-planner-test.ts:121/122/122`, `run-eval.ts:245/247/248` TS2339. **None of those five files differs from `9e904f32`** (`git diff --name-only 9e904f32`). The types involved (`Query`, `ComputeResult \| MutateResult \| ForEachResult`, the reschedule service row) are not in this diff. So they aren't caused by Layer 1 |
| **Is one caller level enough?** | Yes. Every **required** signature change is in a scoped core file: `generateWebsite`, `generateIntakeForm`, `WebsiteAIContentService` methods, `recommendLeadReply`, `narrateBriefing`, the 5 insight methods (barrels followed), and `PlanCache.store`. A caller of a caller can only break if a signature it uses changed, and those are all consumed by direct importers. The only changed files **outside** core/barrel are `providerFactory.ts` (`context?`) and `EmbeddingService.ts` (`callName?`). Both are **optional** additions and can't break any caller. No caller-layer file re-exports a core symbol through an `import`-then-`export { X }` pattern (grep over all 58), so there's no hidden barrel |
| **Can union normalization mask a different error?** | No, in any practical sense. Sorting top-level union members only reorders operands of a commutative `\|`, so two headlines that normalize alike describe the same types. A distinct error still differs in file, code or member set. Known imprecision: the depth counter treats `>` in `=>` as a closing bracket, so a function type in a quoted message may be split oddly. That only risks a *non-normalized* key (a flaky "new" error, i.e. fail-safe), not a merged one. Masking also still needs the per-key **count** to stay within the baseline |
| Workflow (S-5) | YAML parses: triggers `push`/`pull_request` on `main` + `workflow_dispatch`; `permissions: contents: read`; `concurrency` group per ref with cancel-in-progress; `timeout-minutes: 15`; 4 steps; no secrets. Exit codes still propagate (1 new errors / 2 config) |

**Residual notes (no action):**
- The quoted-type split imprecision noted above is fail-safe.
- `cancel-in-progress` also applies to pushes on `main`: only the latest push's check is kept, which is acceptable.

---

## 14. QA Testing Report

**QA — 2026-09-17**
**Test mode:** full (automated verification + live run, AC-18 to AC-21)
**Strategy used:** A/B (Jest, existing + 10 new suites; scoped and full `tsc`), C (a gitignored `tsx` driver script that calls the real services and route handlers with the real test account against the live Supabase project and real OpenAI), plus ledger SQL (read-only)
**Focus:** all (api, pipeline-free; schema; security of attribution sources)
**Skipped:** Playwright/E2E (no UI change; the usage card was checked through its route handler). Some AC-18 paths were not reachable; see "Skipped items"
**Input source:** TL trigger prompt (workplan §6.4 as the manual)

### 14.1 Environment

| Item | Value |
|---|---|
| Code | Worktree `neuronforge-llm-attribution`, branch `feature/business-os-llm-attribution-layer1`, uncommitted on `9e904f32` |
| Database | Current Supabase project (future staging; no real customers). 4 business profiles |
| LLM | Real OpenAI calls through the provider factory |
| Env | `.env.local` copied from the main checkout for the run (gitignored, `.gitignore:46`), deleted afterwards. No secret values were printed or written to any file |
| Driver | `scripts/tmp-qa-llm-attribution.ts` (gitignored `scripts/tmp-*.ts`, deleted afterwards), run with `npx tsx --import ./scripts/env-preload.ts`. Route handlers were called directly. Session auth was stubbed with a `require.cache` entry for `lib/auth.ts` that returns the test account, and `server-only` was stubbed as an empty module (outside the Next bundler it can't be resolved) |
| **Test account** | **`2f734ed5-3681-4049-880d-3de7b096bea3`**: has a business profile; not `SYSTEM_ADMIN_USER_ID`; not the all-zero UUID; not in `admin_users` (satisfies Q-1). Created 2026-09-16 and looks like a test account. The other three profiles were rejected: two are `admin_users` rows, and the third is an older, more active account |
| Window | `WINDOW_START = 2026-09-17T13:58:11Z` (after a first attempt at 13:55 that failed on `server-only` before any LLM call; no rows were written in that attempt). The insight cron ran 14:02:31–14:04:08Z |

### 14.2 Part 1: automated verification

| Check | Expected | Result |
|---|---|---|
| Jest, touched areas (`lib/business-os lib/services lib/ai app/api/website app/api/intake app/api/business-os lib/server/website-plugin-executor.test.ts`) | ~94 suites / 1,512 passed | ✅ **94 suites passed, 1,512 passed, 28 skipped** (18.7 s). Includes `chat-budget.test.ts` and `usage-report.test.ts` (AC-17, unedited) |
| `npm run typecheck:bos-llm` | 96 files, 30 known, 0 new, exit 0 | ✅ **96 files in scope, 30 errors, 0 new (77.6 s), passed, exit 0** |
| Full `tsc --noEmit -p .` (worktree) | 2,045, 0 new | ✅ **2,045 errors, 0 TS2578** |
| Full `tsc` on a clean `git archive 9e904f32` (node_modules junctioned) | compare | ✅ **2,045 errors. Per-file error counts are identical.** A line-free set diff leaves 14 pairs that differ only by the absolute path inside `import("…")` type names and by union member order (`"database" \| "template" …` vs `"database" \| "ai" …`). **0 new errors** |
| Code-review ACs spot-checked | — | ✅ T14 is the one-token diff at `chat-v4/route.ts:1329`. AC-15: the `LeadReplyRecommender.ts` diff is the import, the `groupId` param and the context literal only. AC-21: no excluded file and no migration in `git diff --name-only 9e904f32`. AC-24: `providerFactory.ts` has 2 `console.` matches, both URL strings; `EmbeddingService.ts` has 0 |

**AC to test mapping (spot-check for assertion strength):**

| AC | Test | Asserts real behaviour? | Notes |
|---|---|---|---|
| AC-1 | `insight-llm-attribution.test.ts` | ✅ Real private generators; provider spy; `toEqual` on the full context | Public method → generator `runId` hop is not unit-tested (F-C). **Now proven live:** cron rows carry the run id (§14.3) |
| AC-2 | `llm-attribution.test.ts` row 3b | ✅ Real `PlanCache.store`; only the DB and provider are faked | — |
| AC-3 | `BriefingNarrator.attribution.test.ts` | ✅ `toStrictEqual` context; `@ts-expect-error` enforced by the gate (file in scope) | — |
| AC-4 | `intake-llm-attribution.test.ts` | ✅ Real service and real route handlers (auth mocked); a hostile body `userId`/`groupId` is ignored | — |
| AC-5 | `website-llm-attribution.test.ts` | ✅ for the service contexts | **Weak (W-2):** full_site goes through private `callLLM`, not `generateWebsite` or the `generate-from-profile` route, and the regenerate route isn't tested. The route-level account source (D-5 `user.id` swap) is code review only (SA S-1 still open) |
| AC-6 / AC-7 / AC-12 | `providerFactory.complete.test.ts` | ✅ Real `getProviderFactory().complete`; `toBe` reference plus `toStrictEqual` default; provider called once | Cosmetic (W-1): header comment still lists WebsiteAnalyzer as a no-context caller, which CR-1 corrected |
| AC-8 | area files | ✅ One assertion per row, including distinct 4 / 4b names | — |
| AC-9 | `llm-attribution.test.ts` | ✅ for Planner / AnalysisService / cache / verified questions | **Weak (W-5):** the T14 route change (analysis gets `turnId`, not `correlationId`) is diff review only; there is no route-level test |
| AC-10(a) | chat, website, intake files | ✅ chat (repair shares turn), website (`enrichBlocks` shares, lone `enrichBlock` self-mints) | **Weak (W-3):** intake "two calls in one action share one id" is proven only by code review of the onboarding build route (Q-8); the tests show only that two requests differ |
| AC-10(b)(c)(d) | insight, leads, catalog files | ✅ | (b) also proven live across 3 real businesses |
| AC-11 | `llm-attribution.test.ts` + `usage-report.test.ts` | ✅ | — |
| AC-13 | `EmbeddingService.attribution.test.ts` | ✅ `toStrictEqual` for the help bot default and the batch context | — |
| AC-14 | `usageCategories.test.ts` | ✅ Table-driven; exact token and call sums | — |
| AC-16 / AC-17 | existing suites | ✅ All green | — |
| AC-22 / AC-23 | `callCatalog.test.ts` | ✅ RFC 9562 vector, version/variant bits, runtime spread order; type cases enforced by the gate | — |

None of the weak spots is a mock-around. Each weak AC has a real assertion at the service layer, and the gaps are at the route/entry-point layer. The live run closes W-3 and W-5 only partly (see §14.5).

### 14.3 Part 2: live run (AC-18, AC-19)

| Area | Call exercised (how) | Row found | user_id ok | feature | component | session_id / grouping | Pass |
|---|---|---|---|---|---|---|---|
| chat | `POST chat-v4` route ×2 (turn ids `4ccc7b0e…`, `e3a33693…` as `x-correlation-id`) | ✅ 6 | ✅ test | `business-os-chat` | `planner` (`activity_type` plan, repair, repair per turn) | ✅ 3 rows share each turn id; two turns differ | ✅ |
| chat | `POST chat-v4` "How many contacts do I have?" ×2 (turns `53c0a486…`, `a8d4b4bf…`) | ✅ 4 | ✅ | `business-os-chat` | `verified_question_embedding` + `planner` | ✅ both calls of each turn share the turn id (live AC-10(a) for chat) | ✅ |
| chat | `VerifiedQuestions.remember()` direct (turn `1868f8b3…`) | ✅ 1 | ✅ | `business-os-chat` | `verified_question_store_embedding` | ✅ turn id | ✅ |
| chat | `analyse()` direct (turn `4d5e4152…`) | ✅ 1 | ✅ | `business-os-chat` | `analysis` | ✅ turn id | ✅ |
| insights | Per-user replica of the cron loop, real `DetectorEngine` / `InsightPrioritizer` / `InsightRepository` (run `f22f6caa…`) | ✅ 1 | ✅ | `business-os-insights` | `health_summary` | ✅ = run id | ✅ |
| insights | **`GET /api/cron/insight-detect`** handler (run `13757ed6…`, 4 businesses) | ✅ 6 | ✅ each row on its own business (test account + 3 others); none on system | `business-os-insights` | `insight_content` ×3, `health_summary` ×3 | ✅ all 6 share `session_id` = run id `13757ed6…` across different `user_id`s (live AC-10(b)) | ✅ |
| briefing | `getBriefing()` (store; non-quiet day, cache miss) + `narrateBriefing()` ×2 direct | ✅ 3 | ✅ | `business-os-briefing` | `daily_narration` (`activity_type` narration) | ✅ all 3 = `e2786667-3f67-52af-8e70-2fe7a3dd73bd` = `bosBriefingGroupId(test, 2026-09-17)` (stable same account and day) | ✅ |
| leads | `recommendLeadReply()` direct ×2, same input, fresh `newBosGroupId()` each | ✅ 2 | ✅ | `business-os-leads` | `reply_recommendation` | ✅ two different UUIDs | ✅ (answer fell back `empty_response`: known parked parsing bug, as expected) |
| intake | `POST /api/intake/form/generate` handler | ✅ 1 | ✅ | `business-os-intake` | `form_generation` | ✅ UUID = the id in the route's mint log | ✅ (content fell back; see pre-existing finding P-1) |
| intake | `POST /api/intake/form/infer-question` handler (body carried a hostile `userId` + `groupId`) | ✅ 1 | ✅ session account, body ignored | `business-os-intake` | `question_inference` | ✅ UUID = mint log id, not the body's | ✅ |
| website | `WebsiteGenerationService['callLLM']` direct (full_site) | ✅ 1 | ✅ | `business-os-website` | `full_site` | ✅ UUID | ✅ |
| website | `POST /api/website/landing-pages/generate` handler | ✅ 1 | ✅ | `business-os-website` | `landing_page` | ✅ UUID = mint log id | ✅ |
| website | `POST /api/website/enhance-testimonial` handler (hostile body `userId`) | ✅ 1 | ✅ session account | `business-os-website` | `testimonial_enhance` | ✅ UUID = mint log id | ✅ |
| website | `WebsiteAIContentService.regenerateField()` direct | ✅ 1 | ✅ | `business-os-website` | `field_regenerate` | ✅ UUID | ✅ |

**Pass rule (§6.4, WC-9):** every in-window `business-os-*` row uses a catalog `feature`/`component` pair, and no row has a null `session_id`. No `BizQLPlanCache` or `IntentParser` rows appeared, so no exclusion was needed. All rows `success = true`.

**AC-19:** ✅ **0 rows** on `SYSTEM_ADMIN_USER_ID` or the all-zero UUID for the 12 listed feature values, and **0 rows of any feature** on those two accounts in the whole window (13:58:11Z → end of cron), even though the cron processed every business in the environment.

**WC-10 mint-point logs:** ✅ The `info` lines carry `groupId` + `correlationId` and match the ledger `session_id` exactly for `IntakeGenerateAPI`, `IntakeInferQuestionAPI`, `LandingPageGenerateAPI` and `EnhanceTestimonialAPI`. The cron logs `runId` at start and on completion, matching the ledger. `LeadAlertService`, `generate-from-profile`, the regenerate route, `MutateExecutor`, `WebsiteSectionService` and the onboarding build mint points were not on the exercised path (see skipped items).

**SQL used** (read-only; run through the Supabase service client with the equivalent filters):

```sql
-- AC-18: all rows in the window (every user, to see anything unexpected)
select created_at, user_id, feature, component, session_id, activity_type,
       input_tokens, output_tokens, success
from token_usage
where created_at >= '2026-09-17T13:58:11Z'
order by created_at;

-- AC-18 grouping
select feature, session_id, array_agg(distinct component) as calls, count(*) as rows
from token_usage
where created_at >= '2026-09-17T13:58:11Z'
  and user_id = '2f734ed5-3681-4049-880d-3de7b096bea3'
  and feature like 'business-os-%'
group by feature, session_id
order by min(created_at);

-- AC-19 (expect zero)
select feature, component, count(*)
from token_usage
where created_at >= '2026-09-17T13:58:11Z'
  and user_id in (:system_admin_user_id, '00000000-0000-0000-0000-000000000000')
  and feature in ('business-os-chat','business-os-insights','business-os-briefing',
                  'business-os-website','business-os-intake','business-os-leads',
                  'insight-generation','correlated-insight-generation','health-summary-generation',
                  'landing-page-generation','lead-reply','business-os')
group by feature, component;

-- AC-19 (stricter, any feature)
select feature, component
from token_usage
where created_at >= '2026-09-17T13:58:11Z'
  and user_id in (:system_admin_user_id, '00000000-0000-0000-0000-000000000000');
```

### 14.4 Usage category check (AC-20, AC-21)

`GET /api/business-os/usage?range=last_24h` route handler, called for the test account before and after the run:

| | credits | calls | breakdown |
|---|---|---|---|
| Before | 73 | 1 | `insights` 73 / 1 call (a legacy `health-summary-generation` row from 2026-09-16) |
| After | **7,547** | **26** | `chat` 6,397 / 12 · `website` 407 / 4 · `briefing` 368 / 3 · `insights` 212 / 3 · `intake` 118 / 2 · `leads` 45 / 2 |

- ✅ Every new area has its own category; **no `other` bucket**.
- ✅ The call counts match the ledger exactly: chat 12 (6 + 6), website 4, briefing 3, insights 3 (1 legacy + 2 new, merged into one category as FR-21 requires), intake 2, leads 2 = 26.
- ✅ Total credits include every new area; here the category credits happen to sum exactly to the total (not required, ruling (e)).
- ✅ Grouping sanity: insight rows' `session_id` equals the run id (`f22f6caa…` per-user, `13757ed6…` cron); briefing `session_id` is the same for 3 narrations of the same account and day and equals `bosBriefingGroupId`; each chat row's `session_id` equals the turn id sent as `x-correlation-id`.
- ✅ AC-21: re-checked by diff (§14.2).

### 14.5 Issues Found

#### Bugs in Layer 1 (must fix before commit)

None.

#### Pre-existing findings (not caused by Layer 1; for TL to route)

1. **P-1: Intake form generation always falls back to the generic form.** Severity: Medium (product quality, not attribution). File: `lib/services/IntakeGenerationService.ts` (response validation after the `complete()` call). Layer 1's diff there is only the context argument.
   - Repro: `POST /api/intake/form/generate` for a coaching business.
   - Expected: model questions are used (`contentSource: 'llm'`).
   - Actual: the call succeeds (389 output tokens, now correctly billed to the owner), but Zod rejects every question (`questions.N.maxFiles: Number must be greater than 0`, `showIfIndex: Expected number, received null`, `showIfEquals: Invalid input`). The service logs an error and saves the 3-question fallback (`source: "fallback"`). The owner pays for a call whose output is discarded. Same class as the parked lead-reply parsing bug.
2. **P-2 (known, parked): Lead reply recommender** returns `fallback / empty_response` for a normal enquiry. As expected; attribution still recorded.
3. **P-3 (observation): Chat planner** needed plan + 2 repairs and accepted "soft problems" (`answer.text is required`, absolute-date anchor) for "Compare my bookings and invoices this month…". A repeated identical question was not served from the plan cache (`cache: miss` both times). Behaviour is unchanged by Layer 1; the repair rows are correctly marked `activity_type: repair` under one turn id.

#### Test-strength notes (Low, non-blocking)

- **W-1:** `lib/ai/__tests__/providerFactory.complete.test.ts:1-5` header comment still names WebsiteAnalyzer as a working no-context caller (stale after CR-1). Cosmetic.
- **W-2:** no route-level test for `generate-from-profile` (D-5 `user.id`) or `blocks/[blockId]/regenerate` (SA S-1 still open). Not live-tested either (see skipped items).
- **W-3:** intake "two calls in one action share an id" (onboarding build route) is code review only.
- **W-5:** T14 (chat analysis uses `turnId`) has no route-level test, and live analysis was invoked directly because the planner didn't emit an `analyse` step.

### 14.6 Skipped items and reasons

| Item | Reason |
|---|---|
| `correlated_insight` live row | The cron ran for all 4 businesses but `patternsMatched: 0`, so no correlated insight was generated. Covered by AC-1/AC-8 unit tests only |
| `insight_content` for the **test account** | Its 2 detections matched existing insights, which were updated rather than re-generated. `insight_content` was verified live on 3 other businesses in the same cron run, each on its own account |
| `plan_cache_lookup_embedding` / `plan_cache_store_embedding` (rows 3a/3b) | `bizchat_plan_semantic_cache_enabled` is unset (default `false`) in this environment, so no semantic embedding runs. System config was **not** changed, because it is shared. Covered by AC-2 and the row 3a unit test (3b is also a documented allowed absence) |
| Chat cache-hit row (`BizQLPlanCache`) | The repeated question was a cache miss (P-3). Not a catalog call; AC-11 covers it |
| `generate-from-profile` route / full `generateWebsite` | Would create a homepage and blocks and adopt a template on the test account. Used the narrower `callLLM` (the same LLM call and context) |
| `blocks/[blockId]/regenerate` builder route | The test account has no website blocks, and using another tenant's block (the route has no ownership check, OI-2) was not acceptable. Called `regenerateField` directly instead |
| `LeadAlertService` / public enquiry form path | Would notify the owner (external message). Called `recommendLeadReply` directly with fresh group ids, as instructed |
| `/api/business-os/my-day`, `DailyBriefingDispatchService`, `/api/cron/daily-briefing` | Dispatch/email path forbidden; `getBriefing` + `narrateBriefing` used instead |
| Onboarding build route, `MutateExecutor` website path, `WebsiteSectionService` (KI-1), rows 17c–f (KI-3) | Not reachable safely or no production trigger; excluded by §6.4 |
| Playwright / usage card UI | No UI change; the route handler output was verified |

**Data left on the test account (test data only):** one intake draft form (fallback content), one verified-question row ("show my unpaid invoices"), updated `insights` rows and a refreshed health summary, and a briefing cache row for 2026-09-17. The cron also refreshed insights and health summaries for the other businesses in this environment (user-accepted). No emails, WhatsApp, SMS or notifications were sent. No payments, purge or deletes.

### 14.7 Final Status

- [x] All acceptance criteria pass: ready for commit (subject to user approval; CR-1 and CR-2 already applied)
- [ ] Issues found: Dev must address before commit

**Verdict: PASS WITH ISSUES.** Layer 1 has no defects. AC-1 to AC-17 and AC-22 to AC-24 are verified by passing tests, the scoped gate and full `tsc` with 0 new errors, and diff checks. AC-18 to AC-21 are verified live: 30 in-window ledger rows across all six areas, all on the correct account with catalog names and UUID groups, 0 system-user rows, and the usage card shows every new area in its own category. The issues are pre-existing product bugs (P-1 intake fallback, P-2 lead fallback), low-severity test-strength notes (W-1 to W-5) and paths that could not be run live (§14.6). None of them blocks the commit.

---

## 15. Commit Info

| Item | Value |
|---|---|
| Branch | `feature/business-os-llm-attribution-layer1` (from `origin/main` `718524e9`) |
| Docs commits | `6351ebb1` requirement + investigation; `9e904f32` workplan (SA approved) + requirement updates |
| Implementation | `18bd120e` feat(business-os): attribution across all 6 areas, `callCatalog.ts`, `usageCategories.ts`, 10 test files |
| CI | `9bd48f96` ci(business-os): scoped type check (`scripts/typecheck-bos-llm.ts`, baseline, `bos-llm-typecheck.yml`) |
| Docs | `f4c93a64` docs(business-os): SA review, QA report, known issues |
| Pull request | [#47](https://github.com/AgentsPilot/neuronforge/pull/47) to `main`: CI 3/3 passing at open; not merged, auto-merge off |
| Open after merge | OI-3: make `bos-llm-typecheck` a required check on `main` (GitHub admin) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created | Dev workplan for Layer 1: line references verified against worktree (§2, 7 mismatches + 8 findings), catalog/helper design, per-call tasks, test plan incl. QA SQL, Pino flags, traceability, 9 SA questions, 46 tasks |
| 2026-09-17 | SA workplan review — Approved with changes | §13 populated: RC-1–RC-15 application verified; rulings (a)–(h) and item 4; findings (Jest runs transpile-only under `isolatedModules`, so type-level ACs need the `tsc` gate; Step 8 not independently shippable; usage mapping must precede renames; verified-question store embedding uncatalogued); WC-1–WC-10 for Dev, RQ-1–RQ-4 for BA; one non-blocking user decision (image-generation spend) |
| 2026-09-17 | SA changes applied — ready to implement | Dev applied WC-1–WC-10 (log in §13.4): `tsc` gate over new test files incl. TS2578; T38 split into T38a (intake, Step 9) / T38b (website, Step 10); usage mapping moved to Step 2; `verified_question_store_embedding` (row 4b); `enrichBlock` self-mints; `uuid` mocked in website test; T14 un-gated; no-new-direct-Supabase check + FU-1 follow-up list; AC-18 pass rule exceptions; mint-point logging. Recorded SA rulings (a)–(h) + item 4 (§10) and user decisions of 2026-09-17 (§10.1: image generation → Layer 1.5, `ServiceGeneratorService` excluded, Pino conversion approved as T4/T7). Status → SA approved, changes applied. 47 tasks, 12 steps |
| 2026-09-17 | Implementation — Code Complete | Steps 0–11 implemented on `feature/business-os-llm-attribution-layer1` (not committed). 47/47 tasks ticked. Jest touched areas 94 suites green; full `tsc` 2,045 → 2,045 (0 new, 0 TS2578); full-repo Jest failures (21 suites) proven pre-existing on clean `9e904f32`. Deviations D-1–D-6 and SA focus points in §12.1. Status → Code Complete — awaiting SA code review |
| 2026-09-17 | SA code review — Approved with fixes | §13.5: SA re-ran Jest (94 / 1,510) and full `tsc` (2,045, 0 TS2578), and mutation-tested the `@ts-expect-error` cases (each fires TS2578). Every row's context and account source verified server-side; WC-1–WC-10 confirmed in code; D-1–D-6 accepted. No code change required. CR-1 (docs): WebsiteAnalyzer is not a working `complete()` caller; add FU-4. Optional S-1–S-4; QA notes Q-1/Q-2. Code approved for QA |
| 2026-09-17 | CR-1 applied (docs only) | WebsiteAnalyzer corrected from "working non-BOS `complete()` caller" to broken and untouched in §3.2, §5, §6.1 AC-7, §8.1 FR-12, §8.2 AC-7; FU-4 added (fix vs retire decided separately). No code change |
| 2026-09-17 | T46–T47 added — user-approved, pending SA review | Step 12 (§12.2). T46: scoped type-check gate (`scripts/typecheck-bos-llm.ts`, Compiler API over the full program, diagnostics for import-derived scope only, committed baseline of 21 pre-existing errors / 17 keys; npm `typecheck:bos-llm`; workflow `bos-llm-typecheck.yml` on PR/push to main). Proven to fail on `'ful_site'`, a missing `userId`, a wrong-area call name and an unused `@ts-expect-error`, and to pass on today's code. T47: `bosFeature` / `BOS_CHAT_FEATURE` replace hand-typed `business-os-*` labels in chat telemetry and `usageCategories.ts` (identical strings). Jest 94 suites / 1,512 green; full `tsc` 2,045, 0 new |
| 2026-09-17 | SA review of T46–T47 | §13.6: T47 approved (pure refactor, identical strings, chat tests unedited and green). T46 Fix Required, CR-2: the gate catches bad call names and missing accounts (SA mutation-tested), but missed a dropped required `runId` in the insight cron, because callers that don't import the catalog (barrel/relative imports) are out of scope. Extend scope to resolved direct importers, refresh the baseline, add the proof. Baseline already counts per key (acceptable). Optional S-5 (workflow hardening), S-6 (required status check). QA may proceed; commit blocked on CR-2 |
| 2026-09-17 | CR-2 + S-5 applied (T46) | Gate scope now derived from compiler-resolved imports: core (catalog, usage mapping, catalog importers, attribution tests), re-export barrels to a fixed point, and direct callers. 36 → 96 files. Baseline 21 → 30 errors / 17 → 23 keys (+9 pre-existing on untouched lines in 5 caller files); named-union ordering normalised. Proven: dropped `runId` in `insight-detect/route.ts` → exit 1, dropped `userId` at `BriefingStore.ts:51` → exit 1, `'ful_site'` → exit 1, clean → exit 0 (~65 s); tree restored byte-identical. Workflow hardened (permissions, concurrency, timeout). Pending SA spot-check |
| 2026-09-17 | SA re-verification of CR-2 / S-5 — T46 approved | §13.6.3: SA reran the proofs (cron `runId` and BriefingStore `userId` each TS2554, exit 1; restored byte-identical; clean run 0 new). Confirmed the 9 baseline additions are pre-existing (files unchanged since `9e904f32`). One caller level is sufficient: all required signature changes are in core; out-of-core changes are optional params. Union normalization is commutative-only and fail-safe. Workflow YAML valid. Layer 1 (incl. T46/T47) fully SA-approved for QA |
| 2026-09-17 | QA — PASS WITH ISSUES | §14 populated. Part 1: Jest 94 suites / 1,512 passed; `typecheck:bos-llm` 96 files, 30 known, 0 new; full `tsc` 2,045 with per-file counts identical to a clean `9e904f32` archive (0 new, 0 TS2578); AC mapping spot-checked, with weak spots W-1 to W-5 (route-level coverage, stale comment). Part 2: live run on test account `2f734ed5…` against the current Supabase project with real OpenAI. 30 ledger rows across chat (planner, analysis, verified-question lookup/store), insights (per-user + cron over 4 businesses: `insight_content`, `health_summary`, one run id across accounts), briefing (stable v5 group), leads, intake and website (full_site, landing_page, testimonial_enhance, field_regenerate). All on the correct account with catalog names and UUID groups; 0 system/all-zero rows; usage card shows all six categories, no `other`, 26 calls matching the ledger. No Layer 1 bugs. Pre-existing P-1 (intake generation always falls back on Zod rejection) and P-2 (lead reply fallback, parked). Not live: correlated_insight (no pattern matched), plan-cache embeddings (semantic cache off), cache-hit row, generate-from-profile / regenerate routes, LeadAlertService (would notify). No external messages sent |
| 2026-09-17 | Committed + PR #47 | §15 populated with commit hashes and PR. Corrected §1 and §5 "not touched" lists: `turnUsage.ts`, `ChatBudget.ts` and `usageReport.ts` were changed by the later user-approved T47 (label constant only). S-6 (required check on `main`) recorded as open issue OI-3 in the requirement |
