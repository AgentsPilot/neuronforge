# Workplan: Business OS LLM — Layer 1.5

> **Last Updated**: 2026-09-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) (26 FRs / 24 ACs; SA approved, RC-1 to RC-20 applied; D-1 to D-5; OQ-A to OQ-J decided; **OQ-U2 / F-8 open**)
**Layer 1 context:** [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_WORKPLAN.md)
**Layer 1.1 context:** [BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_WORKPLAN.md)
**Branch:** `feature/business-os-llm-layer1-5` (worktree `neuronforge-llm-layer15`, off `main` @ `68938031`, Layer 1 PR #47 and Layer 1.1 PR #48 merged)
**Date:** 2026-09-17
**Status:** SA reviewed 2026-09-17 — **approved to implement** with WC-1 to WC-12 (§11); S11 stays user-gated; BA-1 / BA-2 pending on the requirement

## Overview

Layer 1.5 closes the three gaps Layer 1 left open and folds in two Layer 1.1 follow-ups:

- **(a)** the onboarding conversation extractions stop landing on the platform account and are recorded against the signed-in owner, in a new `onboarding` area, grouped per conversation;
- **(b)** AI image generation moves out of a hand-built OpenAI client and into the provider layer, so every generated image writes one ledger row — zero tokens, a configured per-image dollar cost — in its own `images` area;
- **(c)** the `SYSTEM_ADMIN_USER_ID || '00000000-…'` rule, written out in four places, becomes one dependency-free helper;
- **(d)** the Layer 1.1 LLM Usage tab covers both new areas with **no change to any check's logic**;
- **(e)** F-1 (`getChatUsage` must not answer a quiet zero) and F-6 (allowance config through a repository).

**No migration. No owner-visible change.** Image rows carry zero tokens, so no credit, allowance, gauge or `remaining` figure moves. Call counts rise, and nothing owner-facing renders them (FR-14 / RC-1).

This workplan maps every FR and AC to tasks and tests (§8), checks every file and line the requirement and its SA review cite against this worktree (§2 — **6 mismatches, 2 of them material**), sets out the design (§3), the measured typecheck-gate impact (§4.2), the test plan (§5), risks and rollout (§6), the questions SA must answer (§7), and an ordered sequence of independently shippable steps (§9, §10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Code-Reality Check](#2-code-reality-check)
3. [Design](#3-design)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Test Plan](#5-test-plan)
6. [Risks, Rollout and Follow-ups](#6-risks-rollout-and-follow-ups)
7. [Questions and Decisions for SA](#7-questions-and-decisions-for-sa)
8. [Traceability Matrix](#8-traceability-matrix)
9. [Implementation Sequence](#9-implementation-sequence)
10. [Task Checklist](#10-task-checklist)
11. [SA Review](#11-sa-review)
12. [QA Testing Report](#12-qa-testing-report)
13. [Commit Info](#13-commit-info)
14. [Change History](#change-history)

---

## 1. Analysis Summary

| Area | What Layer 1.5 touches |
|---|---|
| **Catalog** | `lib/business-os/llm/callCatalog.ts`: two new areas (`onboarding`, `images`), five new call names, two **empty** legacy-feature lists, `isPlatformAccount` / `platformAccountIds` / `isPlatformAccountEnvIgnored` rebuilt on the shared helper |
| **Onboarding** | `OnboardingConversationManager` (a required attribution argument on `processUserMessage`, a grouping id on `OnboardingState`, a context on each extractor) and `app/api/onboarding/chat/route.ts` (backfill on resume). No new DB write |
| **Images** | `CallContext.requestType` + `callWithTracking`'s `?? 'chat'`; a `generateImage` method on `OpenAIProvider`; `GeneratedImageService` loses its own `new OpenAI(...)`; `app/api/website/media/generate/route.ts` mints the group id |
| **Configuration (reads only)** | `system_settings_config` (image model, sizes, quality, per-image price — one read via `SystemConfigRepository`); `ais_system_config` (allowance keys, now via `ConfigRepository`) |
| **Ledger (writes)** | `token_usage`, through the **existing tracker only**. No new write path, no new `supabaseServer` write anywhere |
| **Ledger (reads)** | `TokenUsageRepository` gains a chat column set, its own limit constants, and two explicitly named chat methods (one per-account, one all-accounts) for F-1 |
| **Verification** | `llmUsageVerification.ts` / `llmUsageReport.ts`: **no logic change** — both new areas fall out of `BOS_LLM_AREAS`. One `USAGE_CATEGORIES` line per area; one explanatory note and one updated Check 3(c) sentence in the tab |
| **Shared helper** | New `lib/platformAccount.ts`; four call sites replaced. `AuditTrailService.ts:121` is **not** touched |
| **DB schema** | **No migration.** No index, no function, no column |
| **LLM calls** | None added. The onboarding calls keep their model, prompts, temperature and fallbacks |

---

## 2. Code-Reality Check

Every file and line cited by the requirement and its SA review was checked against this worktree at `68938031`. The type-check gate was run during planning (§4.2).

### 2.1 Verified references (match)

| Citation | Verified content |
|---|---|
| `OnboardingConversationManager.ts:947`, `:992`, `:1094`, `:1394` | `const factory = getProviderFactory();` — and `getProviderFactory` appears **nowhere else** in the file (only the import at `:15`). SA's claim holds |
| `OnboardingConversationManager.ts:951`, `:996`, `:1098`, `:1398` | `model: 'gpt-4o',` literal x4 (KI-C) |
| `OnboardingConversationManager.ts:462` | `async processUserMessage(userId, message, currentState, submittedServices?)` — `userId` is already the first parameter |
| `OnboardingConversationManager.ts:1979-1986` | `getInitialState(language)` returns `{ currentStep: 'language_selection', collectedData: {}, language }` |
| `OnboardingConversationManager.ts:117` | `export interface OnboardingState` — the type to extend |
| `OnboardingConversationManager.ts:522`, `:829` | The two manager-side restart paths, both through `getInitialState` |
| `OnboardingConversationManager.ts:527` | `const updatedState: OnboardingState = { ...state, collectedData: … }` — a top-level field survives a turn |
| `OnboardingConversationManager.ts:1030` | `extractClientAcquisition` is deterministic (not `async`, no model) |
| `app/api/onboarding/chat/route.ts:67` | `conversationId: z.string().uuid().optional()` — accepted and never used for attribution |
| `app/api/onboarding/chat/route.ts:79`, `:210` | `getUser()`; `manager.processUserMessage(user.id, data.message, currentState, data.services)` — one caller |
| `GeneratedImageService.ts:186-192` | `new OpenAI({ apiKey })` + `images.generate({ model: 'gpt-image-1', prompt, size, n: 1 })` — **no `quality`** |
| `GeneratedImageService.ts:134-183` | The five pre-provider refusals: no key, `PEOPLE`, reuse hit, unreadable count, cap reached |
| `GeneratedImageService.ts:194-198` | 200 with no `b64_json` → `{ ok: false, reason: 'failed' }` |
| `app/api/website/media/generate/route.ts:41` | The **only** caller of `generateImage`; `correlationId` already on the logger at `:30-31` |
| `baseProvider.ts:5-18` | `CallContext` — no `requestType` today |
| `baseProvider.ts:103`, `:133` | `request_type: 'chat'` hardcoded in both branches |
| `baseProvider.ts:113-140` | Failure branch writes `input_tokens: 0, output_tokens: 0, cost_usd: 0, success: false`, then re-throws |
| `openaiProvider.ts:239` | `request_type: 'thread_create'` — a non-chat value already flows |
| `aiAnalytics.ts:151` | `request_type: callData.request_type \|\| 'chat'` — the tracker needs no change |
| `aiAnalytics.ts:121` | `const SYSTEM_USER_ID = process.env.SYSTEM_ADMIN_USER_ID \|\| '00000000-0000-0000-0000-000000000000';` |
| `EmbeddingService.ts:46`, `IntentClassifier.ts:179`, `:698` | The same expression, three more times. A repo-wide grep finds **no fifth copy** |
| `AuditTrailService.ts:121` | `const systemAdminId = process.env.SYSTEM_ADMIN_USER_ID;` — falls back to `null`, a different rule. Correctly excluded |
| `providerFactory.ts:217-221` | `static isProviderAvailable(provider)` → `!!process.env.OPENAI_API_KEY` for `'openai'` |
| `providerFactory.ts:342-343` | `feature: 'onboarding', component: 'simple-complete'` — the legacy helper label |
| `callCatalog.ts:34`, `:38-61`, `:77-90` | `BOS_LLM_AREAS` (6), `BOS_LLM_CALLS`, `BOS_LEGACY_FEATURES` + `_FLAT` |
| `callCatalog.ts:104-111` | `bosRowFilter()` and `isBusinessOsFeature` are built from `BOS_LEGACY_FEATURES_FLAT` — RC-3's consequence is real |
| `callCatalog.ts:157`, `:174-177`, `:183-186` | `GroupIdFor<A>` (chat optional, everything else required); `BosLlmOwner`; `BosCallContextExtras` = `Omit<Partial<CallContext>, …>` — `requestType` becomes a legal extra with no catalog change |
| `usageCategories.ts:34-36`, `:38-66` | `bosCategoryFeatures(area)`; `USAGE_CATEGORIES` with the legacy `onboarding` under `help` at `:65` |
| `usageCategories.catalog.test.ts:19-36`, `:38-40` | Fails when an area has no category keyed by its own name; asserts the legacy `onboarding` maps to `help` |
| `llmUsageVerification.ts:161-169` | `areaOfFeature` loops `BOS_LLM_AREAS` — new areas classify with no edit |
| `llmUsageVerification.ts:550-580` | `computeAreaTotals` seeds one line **per `BOS_LLM_AREAS` entry** — a separate `images` line with no edit |
| `llmUsageVerification.test.ts:551`, `:555` | Asserts `lines.map(key) === [...BOS_LLM_AREAS, 'legacy']` — derived, so it survives new areas |
| `CheckPanels.tsx:309` | `{c.shownOnCard ? 'yes' : 'no (no tokens)'}` |
| `CheckPanels.tsx:329-365` | `AreaTotalsPanel` — `formatNumber`, `formatCostUsd`, no per-area label map. No new formatter or column needed |
| `CheckPanels.tsx:186-192` | The Check 3(c) Info block and the sentence FR-22 updates |
| `app/api/business-os/usage/route.ts:114-134` | `readAllowanceCredits` reads `ais_system_config` directly with `.in('config_key', [...])` and the documented `'10'` / `0.00048` fallbacks |
| `app/api/business-os/usage/route.ts:236` | `calls: usage.totalCalls` — RC-1's mechanism |
| `usageSummary.ts:191-200`, `:219` | `readTokensPerCredit(deps = { config: new ConfigRepository(supabaseServer) })`; `buildCardBreakdown`'s `.filter(([, v]) => v.tokens > 0)` |
| `route.test.ts:75`, `:160-162` | The `business-os-leads` fixture row with `tokens: 0, calls: 1`; `calls: 17`; the `leads` line absent from the breakdown — the pinned zero-token behaviour |
| `usageReport.ts:176-203`, `:348-374` | `getChatUsage` (optional `userId`, `.limit(10000)`, error → `summarise([], …)`); `getChatPricing` (`.limit(50000)`, all accounts, error → zeroed) |
| `app/api/admin/chat-usage/route.ts:44-47`, `:66`, `:72` | `AdminAccessService.getInstance().isAdmin(...)`; `getChatUsage({ from, userId })`; `200 { success: true, data: report }` |
| `TokenUsageRepository.ts:4-20` | The "every method REQUIRES an account id … no method can read 'all accounts'" header, and "deliberately imports nothing from `lib/business-os/**`" |
| `TokenUsageRepository.ts:80-89` | `TOKEN_USAGE_COLUMNS` (call/label/summary/count) and `TOKEN_USAGE_READ_LIMITS.MAX_CEILING = 5000` |
| `TokenUsageRepository.ts:276-330` | `listCallsInWindow` — the paging, de-duplication and `reachedCeiling` shape the new methods copy |
| `ConfigRepository.ts:5`, `:18`, `:25-38` | Default client is the **browser** client; `getSystemConfig` uses `.single()`; no multi-key method exists |
| `SystemConfigRepository.ts:5` | Default client is `supabaseServer` — safe to call from a route |
| `lib/ai/pricing.ts:42` | `FALLBACK_PRICING` — the documented in-code fallback pattern FR-13 cites |
| `turnUsage.ts:96-114` | The zero-token cache-hit row precedent (`input_tokens: 0, output_tokens: 0, cost_usd: 0`) |
| `admin/token-usage/drill-down/route.ts:499` | `case 'request_type': key = record.request_type \|\| 'unknown'` — a BI breakdown dimension only |
| `scripts/typecheck-bos-llm.ts:30-53`, `:56-62` | The three scope rules; the baseline rule AC-21 quotes |
| `LanguageContext.tsx:1140-1147` | `usage.category.*` has no `briefing`, `intake` or `leads` entry (F-10 confirmed; `onboarding` / `images` would be the same) |
| `npm run typecheck:bos-llm -- --list` | **119 files in scope** (13 core, 31 catalog-importer, 2 barrel, 71 caller, 2 attribution-test) — run 2026-09-17 on `68938031` |
| `npm run typecheck:bos-llm` | **119 files, 30 errors, 0 new, passed** |

### 2.2 Mismatches and findings

| # | Citation / assumption | Reality in this worktree | Impact on the plan |
|---|---|---|---|
| **M-1** **material** | Catalog Additions, FR-1, FR-4, AC-3, AC-23: "**the four** onboarding conversation calls", "the four onboarding call types appear under the `onboarding` area" | **`extractClientTracking` (`OnboardingConversationManager.ts:1093`) is dead code.** A repo-wide grep finds **no caller** — the only occurrence is its own declaration. Its step is retired: `case 'client_tracking'` (`:803-806`) is commented *"Retired. Reachable only by a conversation that was already standing here when the question was removed"* and calls `finalizeConfiguration` without any extraction. Separately, **`extractClientWorkflow` has two call sites** (`:608` and `:702`), so one conversation can record that call name twice | The **four methods** are still attributed (the plan does not delete the dead one — see Q-1), but **only three call names can ever appear live**: `business_story_extraction`, `client_workflow_extraction` (1–2 rows) and `adjustment_intent_extraction` (0..n, only if the owner asks for a change at the preview step). **AC-3 and AC-23's "four call types" cannot be satisfied in a live run.** Proposed rewording in Q-1; BA/SA must approve. Deleting the dead extractor is proposed as follow-up **F-12**, not this layer |
| **M-2** **material** | FR-10 / OQ-E: read the image configuration "in **one** read, following the existing pattern of `getAgentCreationConfig()` (`SystemConfigRepository.ts:333-345`)" | `getAgentCreationConfig` is at **`:335-347`**, and it is **not one read** — it is `Promise.all([this.getString(...), this.getString(...)])`, i.e. **two** `getByKey` round trips. Copying that shape for four values would be **four** round trips | The plan follows the FR's **binding requirement ("one read")**, not its illustrative citation: `getImageGenerationConfig()` is built on the existing **`getByKeys(keys)`** (`SystemConfigRepository.ts:79-98`), a single `.in('key', keys)` select. `getByCategoryAsMap('image_generation')` (`:105`) is the alternative; `getByKeys` is preferred because it names the keys explicitly and does not depend on the `category` column being seeded. Recorded for SA as a deviation from the cited example, not from the requirement (Q-3) |
| **M-3** | NFR Logging: "`aiAnalytics.ts` (16 `console.*` calls at `:97, :101, :122, :129, :137, :186, :208-209, :215-217, :233-235, :241, :245`)" | The **count is right (16)**, the **line list is not**. Actual: `:97, :101, :129, :137, :186, :208, :209, :216, :217, :218, :235, :236, :246, :297, :323, :372`. Three cited lines (`:122`, `:215`, `:241`) hold no `console.*` | Cosmetic. The optional F-8 task (§9 S11a) uses the real list |
| **M-4** | NFR Logging: "**Any other** touched file still using `console.*` is flagged" — but only `aiAnalytics.ts` is named | **Two more files Layer 1.5 touches are non-compliant**: `lib/orchestration/IntentClassifier.ts` — **16** `console.*` calls (FR-18 changes `:179` and `:698`), and `lib/ai/providers/openaiProvider.ts` — **4** `console.*` calls (FR-8 adds the image method here). `lib/services/EmbeddingService.ts` is clean (0) | Both are **flagged to the user in §6.3** with their counts, exactly as CLAUDE.md § Logging requires, and each gets its own **optional, separately-reviewable** conversion task (S11b, S11c) alongside F-8. The default plan does **not** convert them, for the same reason Layer 1 froze the tracker: they sit on hot paths this layer is already changing. **User decision required** |
| **M-5** | Task brief and AC-10: "the Layer 1.1 **owner-card snapshot test** must still pass" | There is **no `UsageCard` test of any kind** — `components/business-os/UsageCard.tsx` has no `__tests__` directory and no snapshot. The only snapshot in the repo is `app/api/business-os/usage/__tests__/__snapshots__/route.test.ts.snap`, which pins the **usage API response**, not the component | The snapshot to keep green is the **route characterization snapshot** (2 entries). AC-10's "`UsageCard.tsx` renders neither of the figures that changed" is proven by code review plus a **static source assertion** (T-U15), because there is no render harness to assert it in. Flagged to SA as Q-4 |
| **M-6** | Assorted line citations (`onboarding route :106/:129-131/:146/:180/:183-188/:205`, `GeneratedImageService.ts:243-247`, `AdminAccessService :44-52`, `llmUsageVerification.ts:162-168`, `SystemConfigRepository.ts:333-345`) | Line drift of 1–5 lines in each case; the cited **content** is present and correct in every one. Actual: onboarding route `:109`, `:126-127`, `:144`, `:181`, `:189`, `:210`; `hash()` at `:244-249`; `isAdmin` at `:44-47`; `areaOfFeature` at `:161-169`; `getAgentCreationConfig` at `:335-347` | Cosmetic only. This workplan uses the verified line numbers |

---

## 3. Design

### 3.1 Catalog additions (FR-2, FR-6, FR-19)

**File:** `lib/business-os/llm/callCatalog.ts`

```typescript
export const BOS_LLM_AREAS = [
  'chat', 'insights', 'briefing', 'website', 'intake', 'leads',
  'onboarding',   // new
  'images',       // new
] as const;

export const BOS_LLM_CALLS = {
  // …unchanged…
  onboarding: [
    'business_story_extraction',
    'client_workflow_extraction',
    'client_tracking_extraction',   // see M-1 / Q-1: the extractor exists but is unreachable
    'adjustment_intent_extraction',
  ],
  images: ['image_generation'],
} as const satisfies Record<BosLlmArea, readonly string[]>;

export const BOS_LEGACY_FEATURES = {
  // …unchanged…
  /*
   * EMPTY, AND IT MUST STAY EMPTY (FR-6, RC-3).
   * The legacy `onboarding` feature value is still written today by the
   * onboarding chat service and by generate-prompt-ideas, with real users.
   * Adding it here would put it into BOS_LEGACY_FEATURES_FLAT -> bosRowFilter()
   * -> Check 1's read, Check 2's platform-account read and isBusinessOsFeature:
   * every historical `onboarding` row would be pulled into the Business OS
   * filter, Check 2 ("nothing on the platform account") would fail, the value
   * would move out of `help`, and usageCategories.catalog.test.ts:38 would break.
   */
  onboarding: [],
  images: [],
} as const satisfies Record<BosLlmArea, readonly string[]>;
```

Consequences that need **no** code change, verified in §2.1:

| Consumer | Why it follows automatically |
|---|---|
| `GroupIdFor<A>` | Only `chat` is optional, so both new areas **require** a grouping id by type |
| `BosLlmAttribution` | Distributive over `BosLlmArea`; `callName` is narrowed per area |
| `areaOfFeature` / Check 1 | Loops `BOS_LLM_AREAS` |
| Check 4 (groups) | Operates on classified rows |
| `computeAreaTotals` | Seeds one line per `BOS_LLM_AREAS` entry → a separate `images` line |
| Check 5 "nothing in `other`" | Driven by `usageCategoryForFeature`, fed by the `USAGE_CATEGORIES` lines below |
| `bosRowFilter()` / `isBusinessOsFeature` | `business-os-onboarding` and `business-os-images` match the `business-os` prefix |

**The one manual edit per area (FR-20)** — `lib/business-os/usage/usageCategories.ts`, in area order before `documents`:

```typescript
{ key: 'onboarding', features: bosCategoryFeatures('onboarding') },  // ['business-os-onboarding']
{ key: 'images',     features: bosCategoryFeatures('images')     },  // ['business-os-images']
```

There is **no key collision**: the new *category key* `onboarding` and the legacy *feature value* `'onboarding'` (which stays in `help`, `:65`) are different things. `FEATURE_TO_CATEGORY` maps `'business-os-onboarding' → 'onboarding'` and `'onboarding' → 'help'`, so `usageCategories.catalog.test.ts:22` and `:38` both hold.

### 3.2 Onboarding grouping-id lifecycle (FR-3, FR-4)

**The field.** `OnboardingState` (`:117`) gains one top-level field:

```typescript
export interface OnboardingState {
  currentStep: OnboardingStep;
  collectedData: { … };
  language: Language;
  /**
   * Groups every LLM call of ONE onboarding conversation in the ledger.
   * Deliberately NOT named `conversationId`: ChatRequestSchema accepts a
   * client-supplied `conversationId` (route.ts:67) that the route ignores, and
   * attribution must never come from the request body (FR-4b).
   */
  attributionGroupId?: string;
}
```

Optional in the type, because a pre-Layer-1.5 snapshot deserialises without it. It is **required** where it matters — at the `processUserMessage` boundary (below).

**Mint.** `getInitialState()` (`:1979-1986`) returns `attributionGroupId: newBosGroupId()`. Every fresh-start and restart path already routes through it (route `:153`, `:169`, `:173`; manager `:522`, `:829`), so *restart = new group* comes for free with no extra code.

**Backfill on resume (FR-4c).** A new, deliberately narrow manager method:

```typescript
/** Gives a pre-Layer-1.5 snapshot a group before its first recorded call. Idempotent. */
ensureAttributionGroupId(state: OnboardingState): OnboardingState
```

The route calls it **immediately after `JSON.parse` of the snapshot** (`route.ts:127`) — i.e. before the state is persisted with the user message (`:181-189`) and before `processUserMessage` (`:210`). A resumed conversation is therefore never recorded with a missing group, and the backfilled id is persisted by a write that already happens. **No new `supabaseServer` call is added**: the id rides inside the existing `state_snapshot`.

**Lifecycle table:**

| Path | Line | Group |
|---|---|---|
| No prior conversation | route `:173` | Fresh, from `getInitialState` |
| Snapshot missing | route `:169` | Fresh |
| Old step names → delete + restart | route `:153` | Fresh |
| Resume, snapshot has a group | route `:127` | Reused |
| Resume, pre-1.5 snapshot | route `:127` | **Backfilled** by `ensureAttributionGroupId` |
| Unknown step inside the manager | manager `:522` | Fresh |
| `intent === 'restart'` at preview | manager `:829` | Fresh — **for the next turn**. The `extractAdjustmentIntent` call that *detected* the restart (`:822`) is recorded under the **pre-restart** group, which is correct: it belongs to the conversation that ended |

**The boundary (FR-3, RC-6).** `processUserMessage`'s loose `userId: string` becomes a required owner, so a missing account or group is a compile error:

```typescript
async processUserMessage(
  owner: BosLlmOwner,                 // { userId: string; groupId: string } — from the catalog
  message: string,
  currentState: OnboardingState,
  submittedServices?: ExtractedService[]
): Promise<{ … }>
```

The single caller (`route.ts:210`) passes `{ userId: user.id, groupId: currentState.attributionGroupId! }` — non-null because the route has just run `ensureAttributionGroupId` or `getInitialState`. `updateStateFromMessage` takes the same `owner` and hands it to each extractor; the four private extractors gain a second parameter `owner: BosLlmOwner` and build their own context:

```typescript
const context = buildBosCallContext({
  userId: owner.userId,
  area: 'onboarding',
  callName: 'business_story_extraction',   // per method
  groupId: owner.groupId,
});
const response = await factory.complete({ model: 'gpt-4o', … }, context);
```

No feature, area or call-name string is written at a call site beyond the typed literal the catalog checks (FR-2). Model, prompts, temperature, parsing and the `catch`-and-default fallbacks are untouched (FR-5). The `'gpt-4o'` literals are carried unchanged as **KI-C**.

### 3.3 The provider image method (FR-8)

**`lib/ai/providers/baseProvider.ts`** — two small changes:

```typescript
export interface CallContext {
  …
  /** Ledger `request_type`. Defaults to 'chat'; an image call passes its own. */
  requestType?: string;
}
```

and, at `:103` and `:133`, `request_type: 'chat'` becomes `request_type: context.requestType ?? 'chat'`. Nothing else in `callWithTracking` changes; the tracker is untouched (`aiAnalytics.ts:151` already forwards it).

**`lib/ai/providers/openaiProvider.ts`** — one new method:

```typescript
async generateImage(
  params: { model: string; prompt: string; size: string; quality: string; n: number },
  context: CallContext,
  pricing: { usdPerImage: number }
): Promise<OpenAI.Images.ImagesResponse> {
  return this.callWithTracking(
    context,
    'openai',
    params.model,
    'images/generate',
    () => this.openai.images.generate({ ...params }),
    // An image response carries no token usage, and FR-13 / OQ-F explicitly
    // reject writing non-zero tokens for an image.
    () => ({ inputTokens: 0, outputTokens: 0, cost: pricing.usdPerImage * params.n })
  );
}
```

- **No pricing policy enters `lib/ai/**`**: the price arrives as an argument, already resolved by the service.
- **Success** → one row: zero tokens, `cost_usd = usdPerImage × n`, `success: true`, the image request type.
- **Throw** → `callWithTracking`'s catch branch writes `success: false`, zero tokens, `cost_usd: 0` (`baseProvider.ts:113-140`) and re-throws.

**Tracking context**, built by the service through the catalog:

| Ledger column | Value |
|---|---|
| `user_id` | the business account (the route's `user.id`) |
| `feature` | `business-os-images` |
| `component` | `image_generation` |
| `session_id` | the route's grouping id |
| `request_type` | `'image_generation'` (Q-7), passed as the `requestType` extra — already legal in `BosCallContextExtras`, so no catalog change |
| `model_name` | the configured model |
| `input_tokens` / `output_tokens` | `0` / `0` |
| `cost_usd` | the resolved per-image price (or `0` on the failure row) |

**Reaching the method.** `ProviderFactory.getProvider('openai')` is declared `: BaseAIProvider` (`providerFactory.ts:73`), so the service cannot call `generateImage` on it without narrowing. The plan adds a narrow, explicitly typed accessor rather than an `as` cast:

```typescript
// lib/ai/providerFactory.ts
static getOpenAI(): OpenAIProvider { return this.getOpenAIProvider(); }   // already returns OpenAIProvider (:99)
```

The smallest change that keeps `no implicit any` and adds no cast. It touches the factory's **surface**, not the provider abstraction's behaviour — flagged to SA as **Q-2**.

### 3.4 Image configuration: keys and read path (FR-10)

**One read**, through `SystemConfigRepository.getByKeys` (see M-2), in a new convenience method beside `getAgentCreationConfig`:

```typescript
async getImageGenerationConfig(): Promise<ImageGenerationConfig>
```

| `system_settings_config` key | Meaning | Documented in-code default |
|---|---|---|
| `image_generation_model` | The model | `'gpt-image-1'` (today's literal, `GeneratedImageService.ts:188`) |
| `image_generation_sizes` | JSON map `aspect → size` | today's `SIZE_BY_ASPECT` (`:44-48`) |
| `image_generation_quality` | The pinned `quality` sent on every request | the provider's current default, written down explicitly |
| `image_generation_prices_usd` | JSON map `"model:size:quality" → usd` | the fallback map of §3.5 |

All four keys are fetched in **one** `.in('key', keys)` select and parsed once per call. Malformed JSON in a value logs at **warn** and falls back to the in-code default **for that key only** — one bad row must not leave images both unpriced *and* unsized.

Documented in the method's header: **the price key moves** if a real per-image price table arrives with the deduction layer.

### 3.5 Price resolution (FR-13)

Resolved by **the service**, never by `lib/ai/**`, in this exact order:

1. **Configured price** — `image_generation_prices_usd["<model>:<size>:<quality>"]`, if present and a finite number greater than 0.
2. **Documented in-code fallback map** — `IMAGE_FALLBACK_PRICING`, keyed the same way, in `GeneratedImageService.ts`, with a comment naming its source and date. This is the codebase's own pattern (`FALLBACK_PRICING` in `lib/ai/pricing.ts:42`, `DEFAULT_TOKENS_PER_CREDIT = 10`, `creditCostUsd ?? 0.00048`). A documented default that configuration overrides is not a hardcoded price; an unoverridable literal would be.
3. **`0`, with `logger.error({ model, size, quality }, …)`** naming all three.

**The row is written in every case** (Layer 1 FR-3: spend is never dropped). `quality` is **pinned** and sent explicitly, so a provider-side default change cannot silently invalidate the price.

### 3.6 `GeneratedImageService` and its route (FR-9, FR-11, FR-12, FR-15, FR-16)

**Signature.** `generateImage(owner: BosLlmOwner, prompt, aspect, section)` — the loose `userId: string` becomes a required owner, so a missing account or group is a compile error. `app/api/website/media/generate/route.ts` mints the group:

```typescript
const groupId = newBosGroupId();
requestLogger.info({ userId: user.id, groupId, section }, 'Generating a picture');
const result = await generateImage({ userId: user.id, groupId }, validated.prompt, validated.aspect, section);
```

Nothing is read from the body, query string or header for attribution (FR-12). `n: 1` is unchanged (RC-10).

**Row-writing edges (FR-9 (a)–(e)), mapped to the code:**

| Case | Where | Row |
|---|---|---|
| Provider unavailable | `:134-138` — **replaced by `ProviderFactory.isProviderAvailable('openai')`**, so the graceful `unavailable` path survives without reading the key in order to build a client (FR-9e) | **none** |
| `PEOPLE` match | `:140-142` | **none** |
| Reuse-cache hit | `:159-160` | **none** (KI-B: the ledger counts generations, not requests) |
| Unreadable daily count | `:172-175` | **none** |
| Daily cap reached | `:177-183` | **none** |
| Provider throws | the new `provider.generateImage(...)` call | **failure row** — zero tokens, `cost_usd: 0`, `success: false`, written by `callWithTracking` before it re-throws. The service's existing `catch` (`:238-241`) absorbs it and still returns `{ ok: false, reason: 'failed' }`, preserving the "never throws" contract |
| 200 with no image data | `:194-198` | **priced row** (already written on success by `callWithTracking`); the service still returns `{ ok: false, reason: 'failed' }` |
| Storage upload fails | `:209-212` | **row stays** — the image was paid for |
| `userMediaRepository.record` fails | `:216-225` | **row stays** |

The cap, including its fail-closed behaviour on an unreadable count, is unchanged (FR-16). `trackAICall` never throws (`aiAnalytics.ts:233-241`), which is what makes FR-15 true with no new code.

**Removed:** `import OpenAI from 'openai'` and `new OpenAI({ apiKey })` (`:33`, `:186`) — the last direct SDK construction on this path. `SIZE_BY_ASPECT` and the model literal become configuration defaults (§3.4).

### 3.7 `lib/platformAccount.ts` and every call site (FR-17, FR-18, FR-19)

**New file, importing nothing** — not even `@/lib/logger`, because an import would pull every importer of this helper into the type-check gate through scope rule 3:

```typescript
/**
 * The account a call lands on when it has no valid business account.
 *
 * ONE place for one rule. Read at call time so a late-loading environment
 * applies. IMPORTS NOTHING, ON PURPOSE: scripts/typecheck-bos-llm.ts puts every
 * catalog importer AND every file that imports one into the gate, so the
 * catalog imports this module and never the reverse.
 *
 * NOT the rule in AuditTrailService.ts:121, which falls back to `null`.
 */
export const ALL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';
export function platformAccountId(): string {
  return process.env.SYSTEM_ADMIN_USER_ID || ALL_ZERO_UUID;
}
```

| Call site | Change |
|---|---|
| `lib/analytics/aiAnalytics.ts:121` | `const SYSTEM_USER_ID = platformAccountId();` — **that line only** (Layer 1 FR-3; AC-14) |
| `lib/services/EmbeddingService.ts:46` | `return platformAccountId()` |
| `lib/orchestration/IntentClassifier.ts:179`, `:698` | the same, twice |
| `lib/business-os/llm/callCatalog.ts:189` | `ALL_ZERO_UUID` is imported instead of re-declared. `isPlatformAccount`, `platformAccountIds` and `isPlatformAccountEnvIgnored` keep **exactly** today's behaviour — case-insensitive comparison, the all-zero id always present, a non-UUID env value excluded from the id list and reported by the flag. They keep reading `process.env.SYSTEM_ADMIN_USER_ID` directly for the *set-but-not-a-UUID* distinction, which `platformAccountId()`'s `\|\|` collapses |
| `lib/services/AuditTrailService.ts:121` | **not changed** — a different rule (RC-11) |

### 3.8 `getChatUsage`: the result union and its consumers (FR-24)

**`lib/business-os/bizql/telemetry/usageReport.ts`**

```typescript
export type ChatUsageResult =
  | { ok: true; report: ChatUsageReport }
  | { ok: false; error: string };

export interface ChatUsageReport {
  … // unchanged fields
  /** True when the read hit its cap: the numbers below are a floor, not a total. */
  truncated: boolean;
  /** The cap that was applied, so a reader can say how far the window was read. */
  cap: number;
}
```

- a failed read → `{ ok: false, error }` plus an error log. **Never** a zeroed report;
- a capped read → `{ ok: true, report }` with `truncated: true` — the data is still returned;
- `getChatPricing` follows the identical pattern (`PricingResult`, `truncated`, `cap: 50_000`);
- **no direct Supabase call remains in the module**; the `supabaseServer` import is deleted.

**Consumers:**

| Consumer | Change |
|---|---|
| `app/api/admin/chat-usage/route.ts:66-72` | `ok: false` → `503 { success: false, error: 'Chat usage is temporarily unavailable' }` (details behind the `NODE_ENV === 'development'` guard) plus an error log. `ok: true` → today's `200 { success: true, data: report }`, where the report now carries `truncated` and `cap`. **It may no longer answer `200 { success: true }` with zeros** |
| `scripts/chat-usage-report.ts` | Prints `Could not read chat usage: <error>` and exits non-zero on `ok: false`; prints `Truncated at N rows — figures are a floor` under the header when `truncated` |

**Repository (RC-12 (a)–(d)) — `lib/repositories/TokenUsageRepository.ts`:**

```typescript
export const TOKEN_USAGE_COLUMNS = {
  … ,
  /** Chat telemetry (F-1). Adds user_id and the activity/model/latency dimensions.
   *  Payloads, metadata and error_message stay excluded. */
  chat: 'user_id, session_id, activity_type, activity_name, model_name, input_tokens, output_tokens, cost_usd, latency_ms, success, created_at',
} as const;

export const TOKEN_USAGE_CHAT_READ_LIMITS = {
  /** Today's cap (usageReport.ts:192). Kept as-is (RC-12d); NOT raised, and deliberately above MAX_CEILING. */
  USAGE_CEILING: 10_000,
  /** Today's cap (usageReport.ts:362). */
  PRICING_CEILING: 50_000,
  PAGE_SIZE: 1_000,
} as const;
```

Two **new, explicitly named** methods, both returning `{ rows, reachedCeiling }` exactly as `listCallsInWindow` does, both paging and de-duplicating on `id` the same way:

| Method | Account scope | Caller |
|---|---|---|
| `listChatCallsForAccountInWindow(userId, window, feature, opts)` | `.eq('user_id', userId)`, guarded by `assertAccount` | `getChatUsage({ userId })` |
| `listChatCallsAllAccountsInWindow(window, feature, opts)` | **deliberately unscoped**, documented with its only callers: the admin-gated `app/api/admin/chat-usage/route.ts` (`AdminAccessService` at `:44-47`) and the CLI script | `getChatUsage({})`, `getChatPricing` |

- **(a)** one explicitly named all-accounts method; **no existing method gains an optional account filter** — asserted by extending `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts`;
- **(b)** the repository still imports nothing from `lib/business-os/**`; `BOS_CHAT_FEATURE` is passed in as data (a `feature: string` argument, validated by the existing `LABEL_PATTERN`);
- **(c)** the new column entry excludes payloads, metadata and `error_message`;
- **(d)** the caps are today's, unchanged, with their **own** constants because they exceed `MAX_CEILING` (5,000). The new methods validate against `TOKEN_USAGE_CHAT_READ_LIMITS`, not `TOKEN_USAGE_READ_LIMITS`, and the header comment says why.

`LedgerCallRow` gains a sibling `LedgerChatRow` (the `UsageRow` shape already declared at `usageReport.ts:36-47`, plus `user_id`), exported from `lib/repositories/index.ts` with `export type`.

### 3.9 `getSystemConfigs` and the allowance read (FR-25)

**`lib/repositories/ConfigRepository.ts`** — a new multi-key method beside `getSystemConfig`:

```typescript
/** Several system config values in ONE round trip. getSystemConfig is .single(); this is .in(). */
async getSystemConfigs(keys: string[]): Promise<AgentRepositoryResult<Record<string, string>>> {
  try {
    const { data, error } = await this.supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', keys);
    if (error) throw error;
    const byKey: Record<string, string> = {};
    for (const row of data ?? []) byKey[row.config_key] = row.config_value;
    return { data: byKey, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}
```

**`app/api/business-os/usage/route.ts`** — `readAllowanceCredits` keeps its two keys, its documented fallbacks (`'10'`, `0.00048`) and its `null`-means-no-ceiling result, and swaps the direct `supabaseServer` call for the repository. Because `ConfigRepository` **defaults to the browser client** (`:5`, `:18`), the route constructs it with `supabaseServer` — the same mistake `readTokensPerCredit` documents in `usageSummary.ts` ("calling it from a route throws a 500 — which is exactly what happened"). It takes injectable deps in the same shape as `readTokensPerCredit`, so the route test can drive it:

```typescript
async function readAllowanceCredits(
  deps: AllowanceDeps = { config: new ConfigRepository(supabaseServer) }
): Promise<number | null>
```

Behaviour is unchanged for all four cases the characterization test pins: both keys present, keys absent, allowance `0`, an invalid value. The **route snapshot stays byte-identical**; only the test's fake DB wiring adapts to the repository call. No direct `ais_system_config` read remains in the route.

### 3.10 Layer 1.1 tab and report (FR-20, FR-21, FR-22, FR-23)

**No check logic changes.** The only edits are display copy:

| File | Edit |
|---|---|
| `CheckPanels.tsx` — `AreaTotalsPanel` (`:329`) | One explanatory note under the table: *zero tokens is expected for image rows — an image is priced per image, not per token; and the reuse cache means these are generations, not requests (KI-B)*. **No new formatter, no new column** — `formatNumber(0)` → `0`, `formatCostUsd` → `$0.0400 (estimated)` |
| `CheckPanels.tsx` — `LegacyLabelsPanel` (`:186-192`) | Check 3(c) stays **Info**; its sentence becomes: *since Layer 1.5 no live caller should write this label. Any row here is worth investigating — a website, intake or onboarding call that lost its context would appear with it. Match these times to your own test actions.* |

`BOS_LEGACY_HELPER_LABEL` stays in the catalog, unchanged, as the helper's no-context default (`providerFactory.ts:342-343`) and as the value Check 3 looks for. Promotion to Fail is **F-7**.

**Zero-token behaviour (FR-14), as it will actually read:**

| Reader | Effect of an image row |
|---|---|
| Credits, allowance, ring, `remaining`, daily series, per-category credits | **Unchanged** — `round(0 / tokensPerCredit)` = 0 |
| Card breakdown | **Unchanged** — the `images` category is hidden by `.filter(([, v]) => v.tokens > 0)`; `share` is guarded against a zero total |
| `totalCalls`, and a category's `calls` where that category already has tokens | **Increase.** Neither is rendered by `UsageCard.tsx` (M-5) |
| `summariseUsageByCategory` | `images` gains one call, zero tokens |
| `ChatBudget` (`:162`) | Unaffected — it filters on the chat feature value |
| Check 1 / Check 4 / area totals | Classified, grouped, and summed into a separate `images` line with its cost |
| Check 5 | `no (no tokens)` — already legible |

---

## 4. Files to Create / Modify

### 4.1 File list

| # | File | Action | Reason (FR) |
|---|---|---|---|
| 1 | `lib/platformAccount.ts` | **create** | FR-17 — the one platform-account rule, importing nothing |
| 2 | `lib/__tests__/platformAccount.test.ts` | **create** | AC-12 — env set to a UUID / unset / non-UUID |
| 3 | `lib/business-os/llm/callCatalog.ts` | modify | FR-2, FR-6, FR-19 — two areas, five call names, two empty legacy lists, helper reuse |
| 4 | `lib/business-os/usage/usageCategories.ts` | modify | FR-6, FR-20 — exactly one line per new area |
| 5 | `lib/services/OnboardingConversationManager.ts` | modify | FR-1 to FR-5 — owner on the boundary, group on the state, context on four extractors |
| 6 | `app/api/onboarding/chat/route.ts` | modify | FR-4c — backfill on resume; pass the owner. **No new DB write** |
| 7 | `lib/services/__tests__/OnboardingConversationManager.attribution.test.ts` | **create** | AC-1 to AC-4 (the name matches the gate's `*attribution*.test.ts` rule) |
| 8 | `lib/ai/providers/baseProvider.ts` | modify | FR-8 — `requestType?: string`; `?? 'chat'` at `:103`, `:133` |
| 9 | `lib/ai/providers/openaiProvider.ts` | modify | FR-8 — `generateImage` through `callWithTracking` |
| 10 | `lib/ai/providerFactory.ts` | modify | §3.3 / Q-2 — a typed `getOpenAI()` accessor so no cast is needed |
| 11 | `lib/ai/providers/__tests__/openaiProvider.image.test.ts` | **create** | AC-6, AC-7 — success row, failure row, request type, `n: 1` |
| 12 | `lib/repositories/SystemConfigRepository.ts` | modify | FR-10 — `getImageGenerationConfig()` on `getByKeys` (one read) |
| 13 | `lib/repositories/__tests__/SystemConfigRepository.image.test.ts` | **create** | AC-8 — one read, defaults, malformed JSON |
| 14 | `lib/services/GeneratedImageService.ts` | modify | FR-9 to FR-13, FR-15, FR-16 — provider layer, config, pricing, required owner |
| 15 | `lib/services/__tests__/GeneratedImageService.attribution.test.ts` | **create** | AC-6 to AC-9, AC-11 — every edge of FR-9, price precedence |
| 16 | `app/api/website/media/generate/route.ts` | modify | FR-11, FR-12 — mint, log and pass the group id |
| 17 | `app/api/website/media/generate/__tests__/route.test.ts` | **create** | AC-9 — the minted group reaches the row; two requests differ |
| 18 | `lib/analytics/aiAnalytics.ts` | modify | FR-18 — **line 121 only** (AC-14) |
| 19 | `lib/services/EmbeddingService.ts` | modify | FR-18 — line 46 |
| 20 | `lib/orchestration/IntentClassifier.ts` | modify | FR-18 — lines 179 and 698 |
| 21 | `lib/business-os/usage/__tests__/usageCategories.catalog.test.ts` | modify | AC-5 — empty legacy lists; `bosRowFilter()` does not match the legacy `onboarding` |
| 22 | `lib/business-os/llm/__tests__/callCatalog.test.ts` | modify | AC-5, AC-13 — the new areas; helper behaviour unchanged |
| 23 | `lib/business-os/usage/__tests__/llmUsageVerification.test.ts` | modify | AC-15, AC-16 — onboarding and image rows through Checks 1, 4, 5 and the area totals |
| 24 | `components/test-business-os/llm-usage/CheckPanels.tsx` | modify | FR-21, FR-22 — the note and the 3(c) sentence |
| 25 | `components/test-business-os/llm-usage/__tests__/LlmUsageVerification.test.tsx` | modify | AC-16, AC-17 — the note is present; 3(c) copy |
| 26 | `lib/business-os/bizql/telemetry/usageReport.ts` | modify | FR-24 — result union, `truncated`/`cap`, reads via the repository |
| 27 | `lib/business-os/bizql/telemetry/__tests__/usageReport.test.ts` | **create** | AC-18 — failure, truncation, no direct Supabase call |
| 28 | `lib/repositories/TokenUsageRepository.ts` | modify | FR-24 — chat column set, own limits, two named methods |
| 29 | `lib/repositories/index.ts` | modify | FR-24 — `export type { LedgerChatRow }` |
| 30 | `lib/repositories/__tests__/TokenUsageRepository.test.ts` | modify | AC-18 — the two new methods, caps, `reachedCeiling` |
| 31 | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | modify | AC-18 — no existing method gained an optional account filter; no catalog import; column allow-list |
| 32 | `app/api/admin/chat-usage/route.ts` | modify | FR-24 — never `200 { success: true }` on a failed read; surface truncation |
| 33 | `app/api/admin/chat-usage/__tests__/route.test.ts` | **create** | AC-18 — 503 on failure, truncation passed through |
| 34 | `scripts/chat-usage-report.ts` | modify | FR-24 — print both states |
| 35 | `lib/repositories/ConfigRepository.ts` | modify | FR-25 — `getSystemConfigs(keys)` |
| 36 | `app/api/business-os/usage/route.ts` | modify | FR-25 — `readAllowanceCredits` through the repository, built with `supabaseServer` |
| 37 | `app/api/business-os/usage/__tests__/route.test.ts` | modify | AC-19 — fake adapted; the snapshot stays byte-identical |
| 38 | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | FR-26 — both areas, the image call, zero-token reading, the FR-21 note, KI-B |
| 39 | `docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md` | modify | FR-26 — roadmap row for Layer 1.5's four parts and what is parked |
| 40 | `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` | modify | FR-26 — the `images` area decision, OQ-7 / OI-1 / UD-1 parked |
| 41 | `docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md` | modify | This file — progress, the AC-23 measurement, the scope delta |

**Not touched, deliberately:** `lib/services/AuditTrailService.ts` (RC-11); `lib/analytics/aiAnalytics.ts` beyond `:121` (AC-14); the four `'gpt-4o'` literals (KI-C); the daily image cap (FR-16); `ai_model_pricing` / `lib/ai/pricing.ts` (OQ-F); any migration.

### 4.2 Effect on `npm run typecheck:bos-llm` (AC-21)

**Measured in this worktree on 2026-09-17** by adding the three catalog imports Layer 1.5 introduces, running the gate, then reverting.

| Run | Files in scope | Errors | New | Result |
|---|---|---|---|---|
| Baseline, `68938031` as merged | **119** (13 core · 31 catalog-importer · 2 barrel · 71 caller · 2 attribution-test) | 30 | 0 | passed |
| With Layer 1.5's imports simulated | **124** | 30 | **0** | passed (94.3 s) |

**Scope delta: +5 files, exactly.**

| File | Reason it enters scope |
|---|---|
| `lib/services/OnboardingConversationManager.ts` | catalog-importer (`buildBosCallContext`, `newBosGroupId`, `BosLlmOwner`) |
| `lib/services/GeneratedImageService.ts` | catalog-importer (`buildBosCallContext`, `BosLlmOwner`) |
| `app/api/website/media/generate/route.ts` | catalog-importer (`newBosGroupId`) |
| `app/api/onboarding/chat/route.ts` | caller (imports the manager) |
| `app/api/website/media/route.ts` | caller (imports `GeneratedImageService`) |

**Baseline: no addition is expected or permitted.** The five newly-scoped files contributed **zero** pre-existing diagnostics (`30 errors, 0 new` in both runs), so `scripts/typecheck-bos-llm.baseline.json` must stay **byte-identical**. Any `--update-baseline` during implementation means a *new* error was introduced, and it must be fixed instead (the gate's own rule, `scripts/typecheck-bos-llm.ts:56-62`). If a genuinely pre-existing error does surface later, it is itemised here with its file and error code **before** the baseline is touched.

`lib/platformAccount.ts` **does not enter scope**: it is not under `SCOPED_DIRS`, it does not import the catalog, and — because it imports nothing — it drags no other file in. `aiAnalytics.ts`, `EmbeddingService.ts` and `IntentClassifier.ts` import *it*, not the catalog, so they and their importers stay out (OQ-G, confirmed by the +5 measurement).

---

## 5. Test Plan

`npm test` (Jest) throughout; no live provider, no live database. Every new rule is unit-testable (NFR Testability).

### 5.1 Unit: catalog, categories, helper

| Test | Asserts | AC |
|---|---|---|
| T-U1 `platformAccount.test.ts` | `platformAccountId()` with the env set to a UUID, unset (all-zero), and set to a non-UUID (returned as-is — the tracker's existing behaviour); read at call time; the module's import list is empty | AC-12 |
| T-U2 `callCatalog.test.ts` (extend) | `isPlatformAccount` / `platformAccountIds` / `isPlatformAccountEnvIgnored` unchanged, including case-insensitivity and the non-UUID case (the existing Layer 1.1 assertions pass **unedited**); both new areas have call names; `BOS_LEGACY_FEATURES.onboarding` and `.images` are `[]`; `BOS_LEGACY_FEATURES_FLAT` is unchanged by the additions | AC-5, AC-13 |
| T-U3 `usageCategories.catalog.test.ts` (extend) | The existing per-area loop now covers `onboarding` and `images`; `usageCategoryForFeature('onboarding') === 'help'` still holds (`:38`); **`isBusinessOsFeature('onboarding') === false`** and `bosRowFilter().features` does not contain it; no Business OS value lands in `other` | AC-5 |

### 5.2 Unit: onboarding

| Test | Asserts | AC |
|---|---|---|
| T-U4 | Each attributed extractor passes a context carrying the owner's account, `business-os-onboarding` and its own catalog call name; none passes the platform account, `'system'` or the legacy helper label | AC-1 |
| T-U5 | `@ts-expect-error` proves `processUserMessage` rejects a call with no account and a call with no group id | AC-2 |
| T-U6 | Two calls in one conversation share one group; a restart produces a different one; a conversation resumed from a pre-1.5 snapshot is backfilled **before** its first recorded call; every group is a valid UUID; a body-supplied `conversationId` never becomes the group | AC-3 |
| T-U7 | Same model, prompts, `response_format` and parsed result as today; the `catch` fallback still returns the documented defaults when a call throws | AC-4 |

### 5.3 Unit: images

| Test | Asserts | AC |
|---|---|---|
| T-U8 `openaiProvider.image.test.ts` | Success → one `trackAICall` with zero tokens, `cost = usdPerImage × n`, the image request type, the configured model, `success: true`. Throw → the failure row (zero tokens, `cost_usd: 0`, `success: false`) **and** a re-throw. `request_type` still defaults to `'chat'` when `context.requestType` is absent (no regression for any other caller) | AC-6, AC-7 |
| T-U9 `GeneratedImageService.attribution.test.ts` | **No row** for: provider unavailable, `PEOPLE` match, reuse hit, unreadable count, cap reached. **Failure row** on a throw, with `{ ok: false, reason: 'failed' }` still returned. **Priced row** on 200-with-no-data, with `{ ok: false, reason: 'failed' }` returned. **Row stays** when the upload or `record` fails afterwards. The service constructs no OpenAI client | AC-6, AC-7 |
| T-U10 | Price precedence: configured → in-code fallback → `0` with an error log naming model, size and quality. The key is `model:size:quality`. An explicit `quality` is sent. `lib/ai/**` contains no image price (grep assertion) | AC-8 |
| T-U11 `SystemConfigRepository.image.test.ts` | `getImageGenerationConfig()` issues **exactly one** `.in('key', …)` select; missing keys fall back to the documented defaults; malformed JSON in one key warns and falls back for that key only | AC-8 |
| T-U12 `media/generate/__tests__/route.test.ts` | The route's minted group reaches the ledger row; a second request gets a different group; the account is the route's `user.id` and never a body field; `n: 1`; a ledger write failure does not fail the request; the cap's refusals are unchanged | AC-9, AC-11 |

### 5.4 Unit / route: zero-token behaviour and the verification tab

| Test | Asserts | AC |
|---|---|---|
| T-U13 `route.test.ts` (extend) | With a `business-os-images` fixture row (`tokens: 0, calls: 1, cost > 0`): credits, allowance, ring, `remaining`, the daily series and every per-category credit figure are **identical** to the run without it; the `images` category is **absent** from `breakdown`; `data.calls` is **exactly one higher**; nothing divides by zero | AC-10 |
| T-U14 `usageCategories.test.ts` (extend) | `summariseUsageByCategory` adds one call and zero tokens to `images` | AC-10 |
| T-U15 static | `components/business-os/UsageCard.tsx` references neither `calls` nor `breakdown` (source assertion — see M-5 / Q-4) | AC-10 |
| T-U16 `ChatBudget` | Unchanged by an image row (existing tests pass) | AC-10 |
| T-U17 `llmUsageVerification.test.ts` (extend) | An onboarding row and an image row: Check 1 classifies both (right area, known call name, no false flags), Check 4 groups them, `computeAreaTotals` shows a **separate `images` line** with `0` tokens and its cost, Check 5 keeps both out of `other` and renders `no (no tokens)` — **with no change to any check's logic**. A synthetic extra catalog area flows through all four with only its `USAGE_CATEGORIES` line | AC-15, AC-16 |
| T-U18 `LlmUsageVerification.test.tsx` (extend) | The image row renders `0` and `$0.0400 (estimated)`; the explanatory note is present; Check 3(c) is still **Info** with the new sentence, and a helper-label row is still detected; a `generate-prompt-ideas` row (feature `onboarding`, component `generate-prompt-ideas`, real user) does **not** trip it | AC-16, AC-17 |
| T-U19 `llmUsageReport.test.ts` (extend) | The legacy `onboarding` value stays **excluded** from the platform-account query while `business-os-onboarding` and `business-os-images` are **included** | AC-17 |

### 5.5 Unit / route: the folded-in follow-ups

| Test | Asserts | AC |
|---|---|---|
| T-U20 `usageReport.test.ts` | `ok: false` with an error on a failed read and **never** an all-zero report; `ok: true` with `truncated: true` and the applied `cap` when the cap is hit; `getChatPricing` behaves identically; the module contains no `supabaseServer` import (source assertion) | AC-18 |
| T-U21 `TokenUsageRepository.test.ts` (extend) | Both new methods: the per-account one refuses a non-UUID account; the all-accounts one is deliberately unscoped and named so; the caps validate against `TOKEN_USAGE_CHAT_READ_LIMITS` (10,000 / 50,000, **unchanged**); `reachedCeiling` matches `listCallsInWindow`'s semantics; the chat column set excludes payloads, metadata and `error_message` | AC-18 |
| T-U22 `tokenUsageRepository.contract.test.ts` (extend) | **No existing method gained an optional account filter**; the repository still imports nothing from `lib/business-os/**`; the column allow-list is exhaustive | AC-18 |
| T-U23 `app/api/admin/chat-usage/__tests__/route.test.ts` | The 401 → 403 → 400 gate order is unchanged; a failed read gives **503 `{ success: false }`**, never `200 { success: true }` with zeros; a truncated read returns `200` with `truncated` and `cap`; error detail stays behind the `NODE_ENV` guard | AC-18 |
| T-U24 `route.test.ts` (usage, extend) | `readAllowanceCredits` through `getSystemConfigs`, built with `supabaseServer`: both keys present, both absent (documented fallbacks), allowance `0`, and an invalid value (both → `null`). **The two snapshot entries stay byte-identical**; only the fake's wiring changes. No direct `ais_system_config` read remains in the route (source assertion) | AC-19 |

### 5.6 Regression runs (must stay green, unedited where possible)

- `app/api/business-os/usage/__tests__/route.test.ts` **and its snapshot** — the Layer 1.1 characterization (M-5: this is the "owner-card snapshot").
- `lib/business-os/usage/__tests__/usageCategories.test.ts` — the untouched mapping regression guard.
- `lib/business-os/llm/__tests__/callCatalog.test.ts` platform-account block — unchanged assertions over the helper-backed implementation (AC-13).
- `lib/services/__tests__/EmbeddingService.attribution.test.ts`, `lib/ai/__tests__/providerFactory.complete.test.ts`.
- `lib/business-os/usage/__tests__/llmUsageReport.test.ts` and `llmUsageVerification.test.ts` — the area-derived assertions (`:551`, `:555`) must pass with 8 areas.
- `npm run typecheck:bos-llm` — **124 files, 0 new, baseline untouched** (§4.2).

### 5.7 QA live steps (AC-23, AC-24 — non-production environment only)

Run as an admin on `/test-business-os` → **LLM Usage**, with the test business selected and **Start now** clicked.

| # | Step | Expected |
|---|---|---|
| Q1 | **Record the owner's usage card BEFORE onboarding**: credits used, allowance, remaining, calls | Written into §12 and into UD-1 |
| Q2 | A brand-new owner runs a full onboarding conversation | Rows appear under the **`onboarding`** area, on **that owner's** account, sharing **one** group in Check 4 |
| Q3 | **Record the owner's usage card AFTER**, and compute the delta | **The credits one onboarding conversation consumes — the real number UD-1 needs.** Written into §12, this workplan and the requirement's UD-1 |
| Q4 | Record which call names appeared | Expected: `business_story_extraction`, `client_workflow_extraction` (once or twice), and `adjustment_intent_extraction` only if the owner asked for a change. **`client_tracking_extraction` will not appear — see M-1** |
| Q5 | Generate an image from the website editor | **One** row under **`images`** / `image_generation`, `0` tokens, a dollar cost, carrying the request's group |
| Q6 | Repeat the identical image request (reuse cache) | **No** new row (KI-B) |
| Q7 | **One deliberately failing image generation** (e.g. an invalid configured model) | A **failure row**: `0` tokens, `$0.0000`, **Success: no**. The editor shows its normal failure message; nothing throws to the user |
| Q8 | Check 2 | **Pass** — nothing on the platform account |
| Q9 | Check 3(c) | **Zero** helper-label rows for the window, with the updated Info text |
| Q10 | Area totals | Separate **`onboarding`** and **`images`** lines; the image cost on the `images` line; the explanatory note visible |
| Q11 | **AC-24** — after Q2–Q7, re-read the owner card | No credit, allowance, gauge or block moved because of the **image** rows; credits moved **only** by the onboarding tokens (Q3's number). Nothing was billed or blocked |

**AC-21 gate rule, as reworded by RC-15:** `npm run typecheck:bos-llm` must pass with **no new diagnostic**. A baseline **addition** is permitted only for an error proven pre-existing on a line this work did not touch, itemised in §4.2 with its file and error code — **never** to silence a new error. §4.2's measurement says **no addition should be needed**; if the baseline file changes at all, QA fails the criterion and the Dev must explain it in §4.2 first.

---

## 6. Risks, Rollout and Follow-ups

### 6.1 Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | The onboarding boundary change (`userId` → `BosLlmOwner`) breaks the one caller at runtime | Low | It is a **compile** error, and the gate now covers both files (§4.2). T-U5 pins it |
| R-2 | A resumed pre-1.5 conversation records a call with no group | Low | `ensureAttributionGroupId` runs at `route.ts:127`, before the persist at `:181` and before `processUserMessage` at `:210`. T-U6 covers it |
| R-3 | Nobody seeds the image config rows, so every image records $0 | **Medium** | The documented in-code fallback map (FR-13 step 2) is the *normal* path until the rows exist; step 3's `0` only happens for a model/size/quality nobody wrote down, and it logs at error level. T-U10 |
| R-4 | The pinned `quality` does not match what the provider charged before | Low | It is set from the provider's current default and recorded as the config default, so today's price stays valid; value and price move together thereafter |
| R-5 | The all-accounts repository method is later reused by a non-admin caller | Low | Its **name** says so, its doc comment names its only callers, and the contract test blocks the easier mistake (an optional filter on an existing method) |
| R-6 | Moving `usageReport`'s reads onto the repository changes what the report returns | Low | Same table, same filter, same order, same caps, same columns (plus the ones already selected). T-U20 compares the summarised output for identical input rows |
| R-7 | `ConfigRepository` built with the browser client throws a 500 in the route | Low | The route constructs it with `supabaseServer`, exactly as `readTokensPerCredit` documents. T-U24 |
| R-8 | An image row makes some unexamined consumer divide by tokens | Low | SA enumerated every reader against the merged code (§3.10); the chat cache-hit row (`turnUsage.ts:96-114`) and the `business-os-leads` fixture are the standing precedent |
| R-9 | Adding two areas breaks an existing area-derived assertion | Very low | Every one checked in §2.1 derives from `BOS_LLM_AREAS` (`llmUsageVerification.test.ts:551`, `:555`; `callCatalog.test.ts:324-343`) |
| R-10 | AC-3 / AC-23 cannot pass as written, because a fourth call type never fires | **Certain** (M-1) | Q-1: BA/SA reword to "every onboarding call type that fires", with the dead extractor recorded as F-12 |

### 6.2 Rollout

- **No migration, no feature flag, no new route, no new write path.** Every change is live on merge.
- **Owner-visible:** nothing, except the consequence recorded as **UD-1** — a brand-new business's first month now includes its own onboarding conversation. AC-23 Q1–Q3 measure it.
- **Operator-visible:** two new lines in the area totals, and image spend as one readable figure for the first time.
- **Rollback** is a revert: attribution labels are data, not schema. Rows written under Layer 1.5 labels stay valid and keep classifying, because `BOS_LLM_AREAS` is the only definition of them.
- **Ordering:** S1 and S2 (§9) are inert and shippable on their own; nothing before S3 changes any recorded row.

### 6.3 `console.*` in files this layer touches — flagged per CLAUDE.md § Logging

Three touched files log through `console.*`. Each is **flagged here and proposed for conversion**; the default plan converts **none** of them, and each has its own optional task so the user can switch any subset on.

| File | `console.*` calls | Why the default is "do not convert" | Optional task |
|---|---|---|---|
| `lib/analytics/aiAnalytics.ts` | **16** (`:97, :101, :129, :137, :186, :208, :209, :216, :217, :218, :235, :236, :246, :297, :323, :372` — corrected, M-3) | Layer 1 FR-3 froze it: it is the single write path for **every** ledger row, and FR-18 changes one line of it. AC-14 currently asserts nothing else moved. This is **F-8 / OQ-U2, open** | **S11a** |
| `lib/orchestration/IntentClassifier.ts` | **16** | Not named in the requirement (M-4). FR-18 changes two lines on an orchestration hot path this layer is not otherwise testing | **S11b** |
| `lib/ai/providers/openaiProvider.ts` | **4** | FR-8 adds the image method here. The four calls sit in `getInstance`'s guards, outside the image path | **S11c** |

`lib/services/EmbeddingService.ts` is already clean (0). `scripts/chat-usage-report.ts` uses `console.log` as its **output medium** (a CLI report), not as logging, and CLAUDE.md's rule is scoped to `lib/`, `app/` and `components/` — it is not converted, and FR-24's new "failed" / "truncated" lines are printed the same way.

**If the user approves any of S11a–S11c**, that conversion is a separate commit reviewed on its own, and AC-14 is restated for that file as *"apart from the helper line and a mechanical `console.*` → Pino conversion, the file's behaviour is unchanged"*.

### 6.4 Out of scope (from the requirement, restated so nothing drifts in)

Charging for images and credits per image (**OQ-7**, **D-2**); **OI-1**; **UD-1**'s decision (only its measurement is in scope); any deduction, enforcement or billing change; per-call/per-area model configuration including the four `'gpt-4o'` literals (**F-9**, Layer 2); audit events for AI activity; dollar-cost accuracy for token models; `lib/services/AuditTrailService.ts:121`; the daily image cap; **F-2**, **F-3**, **F-4**, **F-7**, **F-10**, **F-11**; Layer 1 **KI-1 to KI-6**, **OI-2**, **OI-3**; the excluded broken calls; any migration.

### 6.5 Follow-ups this workplan adds

| # | Item | Evidence |
|---|---|---|
| **F-12** (new) | Delete the unreachable `extractClientTracking` (`OnboardingConversationManager.ts:1093-1130`) and its retired `client_tracking` case (`:803-806`), or re-wire the question. Until then the catalog carries a call name that can never be written | M-1 |
| **F-13** (new) | `lib/orchestration/IntentClassifier.ts` (16) and `lib/ai/providers/openaiProvider.ts` (4) `console.*` → Pino, if the user declines S11b / S11c now | M-4, §6.3 |
| **F-14** (new) | `getChatPricing` has no `to` bound (`usageReport.ts:358-362` filters only `gte`), unlike `getChatUsage`. Harmless today; worth aligning when the window semantics are next revisited | §2.1 |

---

## 7. Questions and Decisions for SA

| # | Question | Dev's proposal |
|---|---|---|
| **Q-1** | **M-1: "four onboarding calls" is three live call types.** `extractClientTracking` is unreachable (its step is retired), and `extractClientWorkflow` fires at two steps. AC-3 and AC-23 as written cannot pass in a live run | Keep all four catalog call names and attribute all four methods (cheap, stable, and the dead one is then safe if it is ever re-wired). **Reword AC-3 / AC-23 to "every onboarding call type that fires in the session, each on the owner's account and in one group"**, and record the dead extractor as **F-12**. Needs BA to amend the requirement |
| **Q-2** | **Reaching `generateImage`.** `ProviderFactory.getProvider()` is declared `: BaseAIProvider`, so the service needs `as OpenAIProvider` or a typed accessor | Add `static getOpenAI(): OpenAIProvider`, delegating to the existing private `getOpenAIProvider()` (`:99`, already correctly typed). No cast, no behaviour change, no change to the provider abstraction itself. **Confirm this counts as a surface addition, not a factory-abstraction change requiring separate sign-off** |
| **Q-3** | **M-2: `getAgentCreationConfig` is two round trips**, so it cannot be the model for FR-10's "one read" | Build `getImageGenerationConfig()` on the existing `getByKeys(keys)` (one `.in()` select). Confirm `getByKeys` over `getByCategoryAsMap('image_generation')` |
| **Q-4** | **M-5: there is no `UsageCard` test.** AC-10's "`UsageCard.tsx` renders neither of the figures that changed" has no render harness | Prove it with a source assertion (T-U15) plus code review, and keep the **route** snapshot as the Layer 1.1 characterization guard. Building a jsdom harness for a component this layer does not change looks disproportionate — confirm |
| **Q-5** | **`getChatUsage`'s per-account path.** RC-12 names one *all-accounts* method, but the route also accepts `?userId=`, which needs the same chat column set | Two new named methods (`listChatCallsForAccountInWindow`, `listChatCallsAllAccountsInWindow`). No existing method gains an optional filter, which is what RC-12(a) actually forbids. Confirm |
| **Q-6** | **§6.3 / M-4: two more touched files log via `console.*`** (IntentClassifier 16, openaiProvider 4), beyond the one the requirement names | All three are flagged to the user (§6.3); the **freeze** is planned as instructed, with S11a–S11c as separately-switchable optional tasks. **The conversion decision is the user's** — SA should confirm the freeze is the right default while attribution is changing on these paths |
| **Q-7** | **The image `request_type` value.** FR-8 says "an image request type" without naming it | `'image_generation'` — matching the call name, and consistent with `'thread_create'` (`openaiProvider.ts:239`). Free text, used only as an admin BI dimension |

---

## 8. Traceability Matrix

### 8.1 FR → tasks → tests

| FR | Summary | Tasks | Tests |
|---|---|---|---|
| FR-1 | Onboarding on the owner's account | T11, T14 | T-U4 |
| FR-2 | Context built from the catalog | T5, T14 | T-U4, T-U2 |
| FR-3 | Required attribution on `processUserMessage` | T11 | T-U5 |
| FR-4 | One group per conversation; backfill on resume | T12, T13 | T-U6 |
| FR-5 | No behaviour change (KI-C carried) | T14 | T-U7, regression |
| FR-6 | Category lines; **empty** legacy lists | T6, T7 | T-U2, T-U3 |
| FR-7 | Attributed is not charged | — (no code) | T-U13, AC-23 Q1–Q3 |
| FR-8 | Provider image method + `requestType` | T16, T17, T18 | T-U8 |
| FR-9 | One row per image; the five edges | T22 | T-U9 |
| FR-10 | One config read; no hardcoded model; pinned quality | T19, T20 | T-U11 |
| FR-11 | Group minted at the one entry point | T24 | T-U12 |
| FR-12 | Account from the route | T22, T24 | T-U12 |
| FR-13 | Price precedence config → fallback → 0 | T21 | T-U10 |
| FR-14 | Zero-token behaviour everywhere | T7, T26 | T-U13, T-U14, T-U15, T-U16 |
| FR-15 | A failed ledger write never fails the request | T22 | T-U12 |
| FR-16 | The daily cap is unchanged | T22 | T-U9, regression |
| FR-17 | `lib/platformAccount.ts` | T1 | T-U1 |
| FR-18 | Four copies replaced; `AuditTrailService` not | T2, T3 | T-U1, review |
| FR-19 | The catalog reuses the helper | T4 | T-U2 |
| FR-20 | One manual edit per area; nothing else | T6, T7 | T-U17 |
| FR-21 | Zero-token rows read correctly; one note | T27 | T-U18 |
| FR-22 | Check 3(c) stays Info, text updated | T28 | T-U18 |
| FR-23 | Layer 1 AC-19's exclusion unchanged | T7 | T-U19 |
| FR-24 | F-1: result union, truncation, repository | T30–T35 | T-U20–T-U23 |
| FR-25 | F-6: allowance via `ConfigRepository` | T36, T37 | T-U24 |
| FR-26 | Docs | T38, T39, T40 | review (AC-22) |

### 8.2 AC → tasks → tests

| AC | Tasks | Tests |
|---|---|---|
| AC-1 | T11, T14 | T-U4 |
| AC-2 | T11 | T-U5 |
| AC-3 | T12, T13 | T-U6 *(wording pending Q-1)* |
| AC-4 | T14 | T-U7 + regression |
| AC-5 | T5, T6, T7 | T-U2, T-U3 |
| AC-6 | T16–T18, T22 | T-U8, T-U9 |
| AC-7 | T22 | T-U9 |
| AC-8 | T19–T21 | T-U10, T-U11 |
| AC-9 | T24 | T-U12 |
| AC-10 | T7, T26 | T-U13–T-U16 |
| AC-11 | T22, T24 | T-U12, regression |
| AC-12 | T1, T2, T3 | T-U1 + review |
| AC-13 | T4 | T-U2 (unedited Layer 1.1 assertions) |
| AC-14 | T2 | diff review (restated if S11a runs) |
| AC-15 | T6, T7 | T-U17 |
| AC-16 | T27 | T-U18 |
| AC-17 | T28 | T-U18, T-U19 |
| AC-18 | T30–T35 | T-U20–T-U23 |
| AC-19 | T36, T37 | T-U24 + snapshot |
| AC-20 | all | code review (§6.3 covers the `console.*` clause) |
| AC-21 | T42 | §4.2 measurement; baseline unchanged |
| AC-22 | T38–T40 | doc review |
| AC-23 | T43 | §5.7 Q1–Q10 (live) |
| AC-24 | T43 | §5.7 Q11 (live) |

---

## 9. Implementation Sequence

Twelve steps. Each is independently shippable and leaves the tree green; **S1** and **S2** change no recorded row at all.

| Step | What | Why it can ship alone |
|---|---|---|
| **S1** | The shared helper and its four call sites (T1–T4b) | Pure de-duplication, no behaviour change, no scope growth |
| **S2** | Catalog areas, call names, empty legacy lists, `USAGE_CATEGORIES` lines (T5–T7) | Inert until a caller uses them; proves FR-20 immediately |
| **S3** | Onboarding attribution: the boundary, the group, the contexts (T11–T15) | Self-contained; the gate covers it from here |
| **S4** | `CallContext.requestType` + `callWithTracking`'s `?? 'chat'` + the provider image method (T16–T18) | Additive; every existing caller keeps `'chat'` |
| **S5** | `getImageGenerationConfig` and price resolution (T19–T21) | Pure reads and pure functions, not yet wired in |
| **S6** | `GeneratedImageService` and its route on the provider layer (T22–T25) | The first step that writes an image row |
| **S7** | Verification coverage: the tab note, the 3(c) sentence, the check tests (T26–T29) | Display and tests only |
| **S8** | F-1: the repository methods, the result union, the route and the script (T30–T35) | Independent of (a)–(d) |
| **S9** | F-6: `getSystemConfigs` and `readAllowanceCredits` (T36–T37) | Independent |
| **S10** | Docs (T38–T40) | — |
| **S11** | **Optional, user-gated:** S11a `aiAnalytics.ts` (F-8 / OQ-U2), S11b `IntentClassifier.ts`, S11c `openaiProvider.ts` — `console.*` → Pino | Each a separate commit, reviewed on its own. **Not started without the user's explicit yes** |
| **S12** | Gates and QA handoff (T41–T43) | — |

---

## 10. Task Checklist

**S1 — Shared platform-account helper**
- [ ] **T1** Create `lib/platformAccount.ts` (`ALL_ZERO_UUID`, `platformAccountId()`), importing nothing; write the header explaining the typecheck-gate rule and the `AuditTrailService` non-target
- [ ] **T2** Replace `lib/analytics/aiAnalytics.ts:121` — **that line only**
- [ ] **T3** Replace `lib/services/EmbeddingService.ts:46`, `lib/orchestration/IntentClassifier.ts:179` and `:698`
- [ ] **T4** Rebuild `callCatalog.ts`'s `ALL_ZERO_UUID` / `isPlatformAccount` / `platformAccountIds` / `isPlatformAccountEnvIgnored` on the helper, behaviour identical
- [ ] **T4b** Add `lib/__tests__/platformAccount.test.ts`; confirm the Layer 1.1 catalog assertions pass **unedited**

**S2 — Catalog and categories**
- [ ] **T5** `BOS_LLM_AREAS` += `onboarding`, `images`; `BOS_LLM_CALLS` += the five call names
- [ ] **T6** `BOS_LEGACY_FEATURES` += two **empty** lists, with the RC-3 comment spelling out the Check 2 / `help` / catalog-test consequence
- [ ] **T7** `USAGE_CATEGORIES` += exactly one line per area; extend `usageCategories.catalog.test.ts` and `callCatalog.test.ts`

**S3 — Onboarding attribution**
- [ ] **T11** `processUserMessage(owner: BosLlmOwner, …)`; thread `owner` through `updateStateFromMessage`; update the single caller
- [ ] **T12** `attributionGroupId` on `OnboardingState`; minted in `getInitialState`; add `ensureAttributionGroupId`
- [ ] **T13** Call `ensureAttributionGroupId` in the route right after the snapshot parse (`:127`), before the persist (`:181`). **Add no `supabaseServer` call**
- [ ] **T14** Build and pass a catalog context in all four extractors; model, prompts, parsing and fallbacks untouched
- [ ] **T15** Add `OnboardingConversationManager.attribution.test.ts` (T-U4 to T-U7)

**S4 — Provider image path**
- [ ] **T16** `CallContext.requestType?: string`
- [ ] **T17** `callWithTracking`: `context.requestType ?? 'chat'` at `:103` and `:133`
- [ ] **T18** `OpenAIProvider.generateImage(params, context, pricing)` + `ProviderFactory.getOpenAI()` (Q-2); add `openaiProvider.image.test.ts`

**S5 — Image configuration and pricing**
- [ ] **T19** `SystemConfigRepository.getImageGenerationConfig()` on `getByKeys` — **one** read (Q-3)
- [ ] **T20** Documented in-code defaults for model, sizes and quality; malformed-JSON warn-and-fall-back per key
- [ ] **T21** `resolveImagePrice(config, model, size, quality)`: config → `IMAGE_FALLBACK_PRICING` → `0` with an error log naming all three

**S6 — Image service and route**
- [ ] **T22** `GeneratedImageService`: required `BosLlmOwner`; drop `new OpenAI`; `isProviderAvailable('openai')` for the `unavailable` path; call the provider with an explicit `quality` and `n: 1`; the five no-row edges, the priced-no-data row and row-stays-after-upload-failure; cap untouched
- [ ] **T23** Add `GeneratedImageService.attribution.test.ts` (T-U9, T-U10)
- [ ] **T24** `app/api/website/media/generate/route.ts`: mint with `newBosGroupId()`, log with the correlation id, pass the owner
- [ ] **T25** Add `media/generate/__tests__/route.test.ts` (T-U12)

**S7 — Verification coverage**
- [ ] **T26** Zero-token fixtures and assertions in `app/api/business-os/usage/__tests__/route.test.ts` and `usageCategories.test.ts`; the `UsageCard` source assertion
- [ ] **T27** The explanatory note in `AreaTotalsPanel`; extend `LlmUsageVerification.test.tsx`
- [ ] **T28** Check 3(c)'s updated Info sentence (logic unchanged); the `generate-prompt-ideas` non-trip case
- [ ] **T29** Extend `llmUsageVerification.test.ts` / `llmUsageReport.test.ts` for both new areas (T-U17, T-U19)

**S8 — F-1, chat usage**
- [ ] **T30** `TOKEN_USAGE_COLUMNS.chat` + `TOKEN_USAGE_CHAT_READ_LIMITS` (caps unchanged, own constants, documented)
- [ ] **T31** `listChatCallsForAccountInWindow` and `listChatCallsAllAccountsInWindow`, paging and `reachedCeiling` as `listCallsInWindow`; export `LedgerChatRow`
- [ ] **T32** Extend `TokenUsageRepository.test.ts` and `tokenUsageRepository.contract.test.ts` (no optional account filter; no catalog import; column allow-list)
- [ ] **T33** `getChatUsage` / `getChatPricing` → result unions with `truncated` + `cap`; remove the `supabaseServer` import
- [ ] **T34** `app/api/admin/chat-usage/route.ts`: 503 on `ok: false`, truncation surfaced; add its route test
- [ ] **T35** `scripts/chat-usage-report.ts` prints both states

**S9 — F-6, allowance config**
- [ ] **T36** `ConfigRepository.getSystemConfigs(keys)`
- [ ] **T37** `readAllowanceCredits` through it, constructed with `supabaseServer`, injectable deps; adapt the fake; **snapshot byte-identical**

**S10 — Documentation**
- [ ] **T38** `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`: both areas, the image call, zero-token reading, the FR-21 note, KI-B; ToC + Change History
- [ ] **T39** Layer 1 requirement roadmap: Layer 1.5's four parts and what is parked; Change History
- [ ] **T40** `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md`: the `images` area decision, OQ-7 / OI-1 / UD-1; Change History

**S11 — Optional, user-gated (do not start without an explicit yes)**
- [ ] **T44** *(S11a)* `lib/analytics/aiAnalytics.ts` — 16 `console.*` → Pino (F-8 / OQ-U2); restate AC-14
- [ ] **T45** *(S11b)* `lib/orchestration/IntentClassifier.ts` — 16 `console.*` → Pino
- [ ] **T46** *(S11c)* `lib/ai/providers/openaiProvider.ts` — 4 `console.*` → Pino

**S12 — Gates and handoff**
- [ ] **T41** `npm test` green, including every §5.6 regression and the untouched snapshot
- [ ] **T42** `npm run typecheck:bos-llm` — expect **124 files, 0 new, baseline unchanged**; record the numbers in §4.2
- [ ] **T43** QA live run §5.7 Q1–Q11; write the AC-23 credits measurement into §12, this workplan and UD-1

---

## 11. SA Review

**Reviewed by SA — 2026-09-17**
**Status:** ✅ **Approved to implement**, conditional on **WC-1 to WC-12**. Two items sit outside the Dev's hands: **BA-1 / BA-2** (requirement amendments, from Q-1 and M-2/M-3/M-4) and the **user's S11 decision** (Q-6). Neither blocks S1–S10 or S12.

The code-reality check is the strongest part of this plan: six mismatches found against a requirement I wrote, two of them material, each with its evidence attached. **All six are confirmed** against this worktree. M-2 in particular corrects my own OQ-E citation, and the Dev is right to follow the requirement's binding text ("one read") over its illustrative example.

**Independently verified before ruling:**

| Claim | Verified |
|---|---|
| M-1 — `extractClientTracking` is unreachable | ✔ The only occurrence of the name is its declaration (`:1093`); `case 'client_tracking'` (`:803-806`) is commented "Retired" and calls `finalizeConfiguration` only. `extractClientWorkflow` fires at `:608` **and** `:702`; the other two fire once each (`:569`, `:822`) |
| M-2 — `getAgentCreationConfig` is two round trips | ✔ `:335-347` is `Promise.all([getString, getString])`, each a `getByKey`. `getByKeys` (`:79-98`) is a single `.in('key', keys)` |
| M-4 — two further non-compliant touched files | ✔ `IntentClassifier.ts` 16, `openaiProvider.ts` 4, `EmbeddingService.ts` 0. **Also checked and clean:** `lib/ai/providerFactory.ts`, which the plan touches (T18) — its two `console.` hits are URLs inside error strings and it logs through Pino. That closes the list at three |
| M-5 — no `UsageCard` test | ✔ No `__tests__` under `components/business-os/`; the only snapshot in the repo is the usage-route one |
| Q-2 — `getOpenAIProvider()` | ✔ Private, already typed `: OpenAIProvider` (`:99`) |
| Q-5 — the contract-test mechanism exists | ✔ `tokenUsageRepository.contract.test.ts` enforces required-account signatures with `@ts-expect-error` lines backed by the gate — the right home for the two new methods (WC-5) |
| Nothing consumes `/api/admin/chat-usage` | ✔ Repo-wide grep finds no client caller, so the 503 change breaks no UI |
| `scripts/chat-usage-report.ts` uses `console` as its output medium | ✔ And it sits under `scripts/`, outside CLAUDE.md's `lib/`/`app/`/`components/` scope. The plan's reasoning stands |

### Rulings on §7

- **Q-1 — agreed, with two conditions.** Keep all four catalog call names and attribute all four extractors: the dead one is then type-safe if it is ever re-wired, and the cost is one unused configuration key. (i) The catalog entry carries an inline comment marking `client_tracking_extraction` **unreachable as of 2026-09-17**, pointing at F-12, so nobody reads its absence from the ledger as a defect. (ii) The **unit** tests still cover all four extractors (mocked), so attribution is proven for the dead one even though it cannot fire live. AC-3 and AC-23 need the BA amendment (BA-1). Additionally, add the `×2` case to T-U17: one conversation can legitimately record `client_workflow_extraction` twice, and Check 4's `summariseCalls` already renders it as `client_workflow_extraction ×2` — assert it, because "two identical calls in one group" is exactly the shape a reviewer would otherwise flag as a duplicate row.
- **Q-2 — approved, and this is the sign-off; no separate approval needed.** `ProviderFactory.getOpenAI()` delegating to the existing private `getOpenAIProvider()` is a **surface addition**, not a change to the provider abstraction: the singleton is preserved, no SDK is instantiated outside the factory, and provider *selection* semantics are untouched. It is strictly better than `as OpenAIProvider`, an unchecked assertion that CLAUDE.md rule 6 would require you to justify in a comment. Two conditions: (i) the accessor's doc comment scopes it — *"returns the concrete OpenAI provider for OpenAI-only capabilities (image generation); use `getProvider()` for anything provider-agnostic"* — so it does not become a general escape hatch; (ii) the image path states in a comment that OpenAI is the only image provider today, and **does not** invent an `image_generation_provider` key that would accept exactly one value. A capability interface (`ImageCapableProvider` plus config-driven selection) is the right shape the day a second image provider exists — recorded as **F-15**, not now.
- **Q-3 — approved.** `getByKeys` over `getByCategoryAsMap`: it names the keys explicitly and does not depend on the `category` column being seeded, which is the stronger argument. The requirement's binding text is "one read"; its `getAgentCreationConfig` citation is wrong (M-2 accepted; BA-2 corrects it). `getByKeys` selects `'*'` (`:85`), which is fine here — the column allow-list discipline is a `token_usage` rule about payload columns, and `system_settings_config` has none. The new method must log key names and counts only, never config **values**.
- **Q-4 — partly overruled.** Agreed that building a jsdom harness for a component this layer does not touch is disproportionate. But **drop T-U15**: scraping a `.tsx` for the strings `calls` and `breakdown` is a brittle proxy that would pass on a rewritten component that renders both, and fail on a comment. The claim is better proven three ways that already exist — **T-U13** at the API boundary (the real behavioural proof), the untouched route snapshot, and a **code-review citation recorded in this section** pointing at `UsageCard.tsx` and its header comment ("The API still returns a `breakdown` array. It is deliberately not read here"). Also correct the phrase "the Layer 1.1 owner-card snapshot" wherever it appears (M-5 accepted): it is the usage **route** characterization snapshot.
- **Q-5 — approved.** Two named methods honour OQ-I and RC-12(a) precisely: "all accounts" is reached by *calling a differently named method*, never by omitting an argument, which is the failure mode the rule exists to prevent. Three conditions: (i) extend the contract test with `@ts-expect-error` lines proving `listChatCallsForAccountInWindow` **requires** its account and that `listChatCallsAllAccountsInWindow` accepts **no account parameter at all** (WC-5); (ii) the all-accounts method logs at **info**, not debug, with the row count and `reachedCeiling` — it is the only cross-tenant read in that file and belongs in the logs; (iii) its doc comment names both callers (the admin-gated route and the CLI script) and the gate that protects the route.
- **Q-6 — the freeze is the right default; the decision is the user's.** Convert nothing in S1–S10. Technical risk per file, for that decision:
  - **`aiAnalytics.ts` (16) — highest.** Every ledger row in the product passes through `trackAICall`, and its `console.*` calls sit inside the insert's success and failure branches. Converting it in the same layer that changes its platform-account fallback would destroy the value of AC-14's diff review — the one-line change would be buried in a 16-line reformat. If approved: a **separate commit after S10**, purely mechanical, with the insert payload, the UUID validation and the fallback untouched, and AC-14 restated for the file. It would add a `createLogger` import, which is harmless for the gate (`lib/logger.ts` is not in scope and drags nothing in).
  - **`IntentClassifier.ts` (16) — medium.** An orchestration hot path with no test coverage in this layer; mechanical, but unverified by anything Layer 1.5 runs. Standalone commit if approved.
  - **`openaiProvider.ts` (4) — low.** All four sit in `getInstance`'s configuration guards, outside the image path, so a conversion cannot affect a tracked call. Still its own commit.
- **Q-7 — approved as `'image_generation'`.** The `'thread_create'` precedent is the right one: `request_type` is a **global endpoint-kind** dimension while `component` is the Business OS call name, so the overlap here is a coincidence of naming, not a duplicated column. One condition: it is an exported named constant in the provider module, used once, so the value cannot drift between the call and its test.

### Required changes (WC-n)

1. **WC-1 (§3.2, T11–T13) — no `!` at the boundary.** `currentState.attributionGroupId!` puts a non-null assertion at exactly the place RC-6 exists to protect. `getInitialState` and `ensureAttributionGroupId` must both return a type carrying a **required** id (e.g. `type AttributedOnboardingState = OnboardingState & { attributionGroupId: string }`), so the single caller passes the value with no assertion and the compiler carries the guarantee.
2. **WC-2 (T13) — the backfill must be assignment-based.** "Calls it immediately after the parse" permits discarding the return value of a pure function, which is a silent no-op bug. Write it as `const restoredState = manager.ensureAttributionGroupId(JSON.parse(...))`, and state in the plan that the reset path (route `:153`) may discard the backfilled id — which is correct, because a reset is a new conversation.
3. **WC-3 (§3.3, T18, T22) — pin `n`.** `cost: pricing.usdPerImage * params.n` inside a **single** row contradicts FR-9's "one ledger row per generated image" the moment `n > 1`. Either assert `n === 1` in the provider method (throwing on anything else, with the reason in the comment) or document at both sites that `n > 1` requires one row per image. Today's `n: 1` makes this free to pin now and expensive to notice later.
4. **WC-4 (T-U8, T-U9, T-U10) — assert the prompt never reaches the ledger or the logs.** The NFR is explicit and currently rests on AC-20's code review alone. One assertion: `trackAICall` receives no `request_payload` and no prompt in `metadata`, and the price-resolution error log names model, size and quality only.
5. **WC-5 (T32) — contract-test lines for both new methods**, per Q-5(i). This is the mechanism that made RC-12(a) enforceable in Layer 1.1; use it rather than a prose promise.
6. **WC-6 (T-U15, T26) — drop the `UsageCard` source assertion**, per Q-4. Keep T-U13 and the untouched snapshot, and record the component claim here as a review citation.
7. **WC-7 (§3.7, T4, T4b) — pin the relationship between the two platform-account notions.** After S1 two modules answer "what is the platform account": `platformAccountId()` (raw env or all-zero) and the catalog's `platformAccountIds()` / `isPlatformAccountEnvIgnored()` (UUID-only). The divergence is deliberate and correct, and therefore needs a test, not only a comment: with the env set to a UUID, `platformAccountIds()` contains `platformAccountId()`; with a non-UUID, `platformAccountId()` returns it verbatim while `platformAccountIds()` excludes it and `isPlatformAccountEnvIgnored()` is true. Cross-reference each module from the other.
8. **WC-8 (§3.4, T20) — name the `image_generation_quality` default.** "The provider's current default, written down explicitly" is not a value. R-4's mitigation and the correctness of the fallback price key `model:size:quality` both depend on the literal actually sent. Record the literal in §3.4 with its source; if it cannot be established from the provider's documentation with confidence, state which value the plan pins and that the fallback price is keyed to that value from day one.
9. **WC-9 (§3.8, T34) — state the status rule and log the truncation.** 503 for a failed dependency read is right; keep the 401 → 403 → 400 order ahead of it unchanged, and add `truncated` and `cap` to the route's existing info log line, not only to the response body — an operator reading logs must be able to tell that a figure was a floor.
10. **WC-10 (§5.7 Q7) — name the induced failure.** "E.g. an invalid configured model" only proves FR-9's failure row if it fails **at the provider**. Specify it: temporarily set `image_generation_model` to a non-existent model so the API returns an error, and state the expected row (zero tokens, `$0.0000`, `Success: no`, correct area, call name and group). If the service were to validate the model first, no row would be written and the step would prove nothing.
11. **WC-11 (§6.2) — note the intermediate state.** Between S2 and S6 the tab shows `onboarding` and `images` area lines with zeros, because `computeAreaTotals` seeds one line per area. Correct and inert, but it belongs in the rollout notes so an admin looking at the tab mid-rollout does not report it as a defect.
12. **WC-12 (§4.1 #29) — justify or drop the barrel export.** `export type { LedgerChatRow }` from `lib/repositories/index.ts` is needed only if something imports it from the barrel; `usageReport.ts` can import from the module path. Barrel surface is how files get dragged into gates and cycles — keep the smallest surface unless a caller needs it.

**Minor, not blocking:** the task numbering skips T8–T10 (the checklist runs T1–T7, T4b, then T11). Renumber, or note the gap, so the traceability tables cannot be misread as having lost three tasks.

### Amendments the BA must make

- **BA-1 (Q-1, M-1):** reword **AC-3** and **AC-23** from "the four onboarding call types" to *"every onboarding call type that fires in the session, each on the owner's account and sharing one group"*, and add a known issue (**KI-D**) recording that `extractClientTracking` is unreachable today, so three call types can fire live, with F-12 as the fix. The phrase "the four onboarding conversation calls" in the Proposed Catalog Additions, FR-1 and FR-4 needs the same qualifier: the *four methods* are attributed; *three* can fire.
- **BA-2 (M-2, M-3, M-4):** correct FR-10 / OQ-E's citation (`getAgentCreationConfig` is two round trips; `getByKeys` is the one-read primitive), replace the `aiAnalytics.ts` `console.*` line list with the verified one, and name **all three** non-compliant touched files in the NFR Logging section (`aiAnalytics.ts` 16, `IntentClassifier.ts` 16, `openaiProvider.ts` 4; `EmbeddingService.ts` and `providerFactory.ts` are clean), so OQ-U2 reaches the user with the full picture.

### Confirmations

- **Traceability** is complete: every FR and every AC maps to at least one task and one test, and the two that cannot be tested mechanically (FR-7, AC-20) are correctly routed to the live run and to code review.
- **Sequencing** is right, and the claim that S1 and S2 change no recorded row is true: the helper is pure de-duplication, and an area is inert until a caller names it.
- **Repository pattern, tenant isolation, CLAUDE.md:** no new write path, no new `supabaseServer` call, no new route, no migration; the one cross-tenant read is named, admin-gated and contract-tested; every account is server-side; Zod and Pino unchanged on the touched routes.
- **Gate measurement** (119 → 124 files, 30 errors, 0 new, no baseline addition) matches the scope rules behind OQ-G and independently confirms that `lib/platformAccount.ts` stays out of scope — which was the point of putting it there.
- **Scope:** nothing exceeds the requirement. The three additions beyond its literal text — `getOpenAI()`, `TOKEN_USAGE_CHAT_READ_LIMITS`, `LedgerChatRow` — are each the minimum needed to implement an FR, and each is called out rather than smuggled in.

### Approval

- [x] **Workplan approved — proceed with S1 to S10 and S12**, applying WC-1 to WC-12.
- [ ] **S11 (a/b/c)** — not started without the user's explicit yes (Q-6).
- [ ] **BA-1 and BA-2 applied to the requirement** — BA-1 before QA runs AC-3 / AC-23.

---

## 12. QA Testing Report

*(QA populates this section, including the AC-23 before/after usage-card figures and the credits one onboarding conversation consumed.)*

---

## 13. Commit Info

*(RM populates this section. Not committed by Dev.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created (Planning) | Workplan for Layer 1.5 (26 FRs / 24 ACs). Code-reality check against `68938031` found **6 mismatches**, 2 material: **M-1** `extractClientTracking` is dead code, so only three onboarding call types can fire live (AC-3 / AC-23 need rewording — Q-1); **M-2** the cited `getAgentCreationConfig` is two round trips, so FR-10's "one read" is built on `getByKeys` instead (Q-3). Also **M-4**: two further touched files log via `console.*` (`IntentClassifier` 16, `openaiProvider` 4) beyond the one the requirement names — all three flagged in §6.3, with the freeze planned and optional conversion tasks S11a–S11c; and **M-5**: there is no `UsageCard` test, so the "owner-card snapshot" is the usage-route characterization snapshot. Typecheck gate measured: **119 → 124 files, 30 errors, 0 new, no baseline addition needed**. 46 tasks in 12 steps; 24 unit/route tests plus 11 live QA steps |
| 2026-09-17 | SA review — approved with required changes | All six code-reality findings independently confirmed; a seventh file check added (`providerFactory.ts` is Pino-clean, closing M-4's list at three). Q-1 agreed (all four names kept, with an "unreachable" catalog comment and unit coverage for the dead extractor; AC wording goes back to the BA as BA-1); **Q-2 signed off here** — `getOpenAI()` is a factory *surface* addition, not an abstraction change, and is preferred over a cast, with a capability interface recorded as F-15; Q-3 approved (`getByKeys`, values never logged); **Q-4 partly overruled** — drop the `UsageCard` source assertion, prove the claim with T-U13, the untouched route snapshot and a review citation; Q-5 approved with `@ts-expect-error` contract lines and an info-level log on the cross-tenant read; Q-6 freeze confirmed as the default, with per-file risk recorded for the user's decision; Q-7 approved as `'image_generation'` via a named constant. WC-1 to WC-12 required: no `!` at the onboarding boundary, assignment-based backfill, `n === 1` pinned against FR-9, a prompt-never-logged assertion, contract-test lines, drop T-U15, pin the two platform-account notions against each other, name the `quality` literal, log truncation on the route, name the induced image failure, note the inert empty area lines mid-rollout, justify or drop the barrel export. BA-1 (AC-3 / AC-23 wording + KI-D) and BA-2 (M-2 / M-3 / M-4 corrections) go back to the BA |
