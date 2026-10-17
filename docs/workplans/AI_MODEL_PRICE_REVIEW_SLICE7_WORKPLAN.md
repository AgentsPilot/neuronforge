# Workplan: AI Model Price Review, Slice 7 (price readers on the authoritative store)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): R-1 (DB authoritative, image sibling table, embeddings as token rows, fallbacks kept and never shrunk), SA findings 2, 3, 4, 6, 7; R-9 row 7; the slice 8 notes under R-9
**Branch:** `feature/ai-model-price-review-slice7` (worktree `neuronforge-model-pricing-s7`, cut from `98735db9`; origin/main `ac674ceb` merged in 2026-10-16 per RC7-1, a fast-forward, slice 6 included)
**Date:** 2026-10-16
**Status:** Code complete 2026-10-17, uncommitted, awaiting SA code review and QA. SA-approved with RC7-1..RC7-14; RC7-5 (§3.6) confirmed with C-1 (implemented). User decisions BQ-7a and BQ-7b recorded (§8). No migration. **Money path.** Implementation notes and deviations: 10.1.

## Overview

Slice 7 makes the price readers take their prices from the database first: cached input from `ai_model_pricing.cached_input_cost_per_token`, images from `ai_model_image_pricing`, and the embedding service's own cost figure from the shared pricing reader. Today the cached column is all NULL, the image table is empty, and the one embedding row (added by runbook for BQ-7a) equals the in-code price bit for bit, so **every charge stays exactly what it is today**. What changes is that a price applied by slice 8 will be charged without a code change. The in-code tables stay as outage fallbacks and as the only source of the conservative rate (finding 3). Expected migration: none.

## Table of Contents

1. [Live facts](#1-live-facts-read-only-2026-10-16) · 2. [Analysis](#2-analysis) · 3. [Design](#3-design) · 4. [Guards](#4-guards) · 5. [Proof of identical charges](#5-proof-of-identical-charges) · 6. [Files](#6-files) · 7. [Open questions for SA](#7-open-questions-for-sa) · 8. [Business questions](#8-business-questions) · 9. [Risks](#9-risks) · 10. [Task list](#10-task-list) · [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Live facts (read-only, 2026-10-16)

Read by a select-only script with the service role (project `jgccgkyh…`); nothing written.

| Fact | Value | Consequence |
|---|---|---|
| `ai_model_pricing` | 54 rows, 42 active, 0 future-dated (55 / 43 after the BQ-7a runbook row) | Token charges come from these rows **only on a warm instance** (SA fact below) |
| Active rows with `cached_input_cost_per_token` set | **0** | Cached input keeps today's 50% rule everywhere |
| Embedding rows (active) | none at the first read. **Since 2026-10-16 19:56 UTC one row** (BQ-7a, TL via the runbook): `549fcc6e-…`, `input_cost_per_token` 2e-8 (a JSON number from `select('*')`), output 0, cached NULL | `Number(2e-8) × 1000 === 0.00002`, bit-identical to `FALLBACK_PRICING`; checked live, read-only. Warm or cold, the embedding charge is unchanged |
| `ai_model_image_pricing` | **0 rows** | Images keep today's chain |
| `image_generation_prices_usd`, `_model`, `_sizes`, `_quality` | **all absent** | Images priced from `IMAGE_FALLBACK_PRICING`; sizes and quality are the code defaults |
| `bos_llm_area_images` | `openai` / `gpt-image-2.5-flare`, enabled | The live image model (migration `20261067`) |
| `helpbot_embedding_model` / `helpbot_embedding_cost_per_1k_tokens` | `text-embedding-3-small` / `0.00002` | The setting equals the fallback; switching the reader changes no figure |
| Token areas | chat, insights, briefing, leads on `gpt-4o-mini`; website `gpt-4o-mini` (+ `gpt-4o` for full_site, landing_page); intake, onboarding `gpt-4o` | The golden table uses these models. Every configured value equals its code default, so the guardrail never calls `getPricing` |

**SA live check (RC7-5, 2026-10-16, read-only).** The token cache is cold on most BOS instances: `calculateCostSync` reads only the warm cache, and nothing on a BOS path warms it when every area uses its default (RC-W7b). For `gpt-4o-mini` and `gpt-4o` the warm value (`Number(row) × 1000`) equals `FALLBACK_PRICING` bit for bit, with cached NULL, so warming changes no BOS charge today. For 19 other models warm and cold already differ: 18 by float noise (about 1e-18), and `google:gemini-1.5-flash` by a real amount (0.00008 against 0.000075 per 1K).

## 2. Analysis

| Reader (on `98735db9`) | Today | Finding |
|---|---|---|
| `openaiProvider.calculateCost` (chat and embeddings) | `calculateCostSync('openai', model, prompt - cached + Math.round(cached / 2), completion)` | 7. The 50% rule lives in the provider; the cached column is never read |
| `lib/ai/pricing.ts` cache | Active rows (`listActive`, `select('*')`), newest first, per 1K; 1 h TTL; `FALLBACK_PRICING` on a miss | The column is already fetched; only the cache drops it |
| Embedding **charge** | Same provider path, so already DB first, fallback second | **Scope item 2 is already true for the charge.** Only `EmbeddingService`'s returned and logged `cost` reads the setting (finding 6) |
| `GeneratedImageService.resolveImagePrice` | setting, then `IMAGE_FALLBACK_PRICING`, then $0 with an error log | `priceFor` is **synchronous** (called inside the provider's metrics function), so DB prices must be loaded before the call |
| `modelSettings.checkImageModel` (Layer 2 guardrail) | Its own copy of setting then fallback (`> 0`) | Finding 2. A second reader that must agree with charging |
| `chargePricing.ts` conservative rate | Max of `inCodeTokenPrices()` and `IMAGE_FALLBACK_PRICING` | Finding 3. Must not read the DB; unchanged by this slice |
| `comparisonModel.ts` "current" | Cached = derived half; image = setting then fallback; header says "until slice 7" | RR-4 says current = what we charge. See O-3 |

**Requirement wording to reconcile.** R-1's copies table and R-9 row 7 say "stop reading the two settings". The task brief puts the image setting second in the chain. Both are identical today (the setting is absent). **SA O-1: drop it (R-1); the user confirmed with BQ-7b.**

## 3. Design

### 3.1 Cached input (pricing layer holds the lookup, provider keeps the OpenAI rule)

- `pricing.ts`: the cache entry gains `cachedInput?: number` (per 1K). It is set only when the column is a finite number **> 0**. NULL, 0 and NaN leave it unset. A stored 0 would make cached tokens free, so it falls back to the derived rule, which charges more (never less).
- New export `calculateCostWithCachedSync(provider, model, { promptTokens, cachedTokens, completionTokens, derivedCachedTokens })`. It does **one** lookup, so the input and cached rates always come from the same row:
  - when the row has `cachedInput`: `(prompt - cached)/1000 × input + cached/1000 × cachedInput + completion/1000 × output`;
  - otherwise it returns **exactly** `calculateCostSync(provider, model, prompt - cached + derivedCachedTokens, completion)`, today's expression, so floating-point results are bit-identical.
- `openaiProvider.calculateCost` passes `derivedCachedTokens: Math.round(cached / 2)`. The 50% figure is OpenAI's published rule for how a request was served. It stays in the provider with its comment, and no SDK type enters `pricing.ts`.
- The fallback tables never carry a cached rate. Cold instance or DB down means the derived rule, as today.
- `calculateCostSync`, `getPriceStatusSync`, `listPricedModels` and `inCodeTokenPrices` keep their signatures and results. `AiModelPricing` (types.ts) gains `cached_input_cost_per_token?: number | string | null`.
- Alternative (O-2): the provider asks `getCachedInputRateSync` and composes the sum itself. Rejected because it needs two lookups that could disagree.
- **SA O-2 (approved):** on a miss, the new function delegates to `calculateCostSync`, so the "no pricing" warn fires exactly once (tested). When `cachedInput` is absent it returns the result of today's expression itself, not a recomputation. **SA O-5:** a stored 0 is unset (derived rule).

### 3.2 Images (one resolver, three readers)

- **New repository** `lib/repositories/AiModelImagePricingRepository.ts` (`new-repository` + `tenant-isolation-guard` skills, RC7-12), **read-only**, two methods:
  - `listActive()`: the billing reader (caller: `imagePricing.ts`). Same rule as the token reader: `retired_date IS NULL`, `effective_date <= today (UTC)`, ordered `effective_date DESC, created_at DESC`; selects `id, provider, model_name, size, quality, cost_per_image, effective_date, created_at`;
  - `listActiveExact()`: the admin comparison (RC7-7), same filter and order, `cost_per_image::text`;
  - header modelled on `AiModelPricingRepository`: unscoped by design (platform price list, no owner column), service role intentional, the two caller classes named. Client injection with a `supabaseServer` default, `RepositoryResult`, never throws, no caller-supplied filter. Exported from `index.ts`. A unit test per method (filter, order, error);
  - no write method; slice 8's apply RPC is the only writer. Read-only is pinned by `livePriceWrites.guard` LW-2 (RC7-2).
- **New module** `lib/ai/imagePricing.ts`, server-only, dependency-light (logger, the new repository, `IMAGE_FALLBACK_PRICING`), shared by `modelSettings.ts` and `GeneratedImageService.ts` without a cycle. It must **not** import `pricing.ts`, which imports it (RC7-3): the 1 h TTL moves to a tiny shared module `lib/ai/pricingCacheTtl.ts` imported by both.
  - `loadImagePrices(): Promise<ImagePriceTable>`, a per-instance cache keyed `provider:model:size:quality` (RC7-3):
    - **an empty table is a loaded table:** a successful read with 0 rows sets `loadedAt` (the table is empty today; otherwise every image call and refill would query);
    - **single-flight:** one in-flight promise shared by concurrent callers;
    - **failure** keeps the previous map and leaves `loadedAt` unchanged; never throws; warn log;
    - `invalidateImagePrices()` marks the map stale without fetching (RC7-4).
  - `selectActiveImagePrices(rows)`: a **pure** function, the one selection rule (newest active row per key, price > 0), used by the cache and the comparison (RC7-7).
  - `resolveImagePriceFrom(table, provider, model, size, quality) → { usdPerImage, source: 'table' | 'fallback' | 'unpriced' }`: table row (> 0), then `IMAGE_FALLBACK_PRICING` (> 0), then 0.
  - `refreshPricingCache()` in `pricing.ts` reloads the token rows and calls `invalidateImagePrices()`; it never fetches images itself, so `pricing.test.ts` and every suite that refreshes stays network-free (RC7-4, tested).
- `GeneratedImageService`:
  - `loadImagePrices()` starts alongside `getImageGenerationConfig()` (`Promise.all`, SA optimisation), with a **bounded wait of about 2 s**; on timeout the fallback-only table is used, with a warn. It never hangs and never throws (RC7-3);
  - the resolver is still built **inside** the `withModelFallback` attempt from the model that runs (RC-W4 kept), from the loaded table;
  - `resolveImagePrice` keeps its exported name; its first parameter becomes the loaded table (RC7-6). `ImagePriceSource` `'config'` becomes `'table'`; the `priceSource` log value changes accordingly (PR description note);
  - the provider key is `PROVIDERS.OPENAI`, the provider that bills (`getOpenAI()`). **SA O-6**, with RC7-14: one test pins that the `images` / `image_generation` policy allows only `openai`.
- `modelSettings.checkImageModel` (RC7-11): the image table is loaded **lazily** through the `GuardrailContext` memo (like `imageConfig`), only when an image model other than the default is checked, inside the existing budget. A failed or slow load gives a fallback-only table and never throws. `getImageGenerationConfig` stays the source of sizes. Then `resolveImagePriceFrom` per size × required quality.
- **The setting `image_generation_prices_usd`: dropped** from charging, the guardrail and the comparison (SA O-1; user BQ-7b). `getImageGenerationConfig` keeps parsing it until slice 14 and still supplies sizes and quality.

### 3.3 Embeddings

- **Charge:** no code change. It is already DB first through `openaiProvider.createEmbedding` → `calculateCost` → `calculateCostSync` (cached = 0, so the new path returns today's value).
- `EmbeddingService`'s figure equals the charge (RC7-10): after the call it uses the same lookup the provider charged with, `calculateCostSync(PROVIDERS.OPENAI, model, tokens, 0)`, not the async `calculateCost` (which could load rows on a cold instance after the charge was taken from the fallback) and not the setting `helpbot_embedding_cost_per_1k_tokens`. Today's figure is identical. P-2 asserts the returned `cost` equals the ledger row's `cost_usd`.
- **No seed migration in this slice.** SA ruled against seeding through a migration (LW-5; a live-price write outside the one writer). The user nevertheless decided "write it now" (BQ-7a), and **TL satisfied that outside this slice's code**: the `text-embedding-3-small` row (0.02 / 0 per 1M, `549fcc6e-…`) was applied on production on 2026-10-16 19:56 UTC with the slice 6 emergency SQL runbook, with the user's approval; logged in the runbook's run log and the requirement. Slice 7 adds no migration and no seed. Fixtures that assumed "no embedding row" use the row instead (P-2).

### 3.4 Conservative rate (FR-12)

`chargePricing.ts` is **not edited**. It keeps reading only `inCodeTokenPrices()` and `IMAGE_FALLBACK_PRICING`. Neither table is edited. Proof in section 5 (P-6, P-7).

### 3.5 Cache

Token rows: the existing 1 h cache, one more field. Image rows: their own map on the same TTL (shared constant, RC7-3) with the RC7-3 semantics. Both are per instance (finding 4). "In effect on all servers within 1 hour" remains the only claim slice 8 may make.

### 3.6 Token cache warm on Business OS paths (RC7-5; awaiting SA's short confirmation)

**Problem.** `calculateCostSync` reads only the warm token cache. On a BOS instance where every area uses its code default (prod today), nothing loads it: the guardrail returns early for a default (RC-W7b), and the providers never load it. Such an instance charges from `FALLBACK_PRICING`. Without a warm, a cached rate applied by slice 8 would be charged only on warm instances.

**What.** One new export in `pricing.ts`, `warmPricingCache(maxWaitMs): Promise<void>`:
- **no-op when fresh:** returns at once when the cache is non-empty and younger than the TTL (a synchronous check, no await on the hot path);
- **single-flight:** `loadPricingFromDatabase` gets one shared in-flight promise. `getPricingInternal`, `listPricedModels`, `refreshPricingCache` and the warm all join it, so concurrent cold callers make one read, not N. This changes no result, only the number of reads;
- **bounded:** it awaits the shared load for at most `maxWaitMs`. On timeout it returns; the load keeps running and lands for later calls;
- **never throws:** `loadPricingFromDatabase` already never throws; the race and the timer are wrapped as well. The timer is `unref`'d;
- **whole table:** the cache loads all active rows in one `listActive()` read, so "warm for the resolved models" is "warm the cache". No per-model variant: it would be a second loader.

**C-1 (SA, 2026-10-17; implemented).** A refresh never joins a read in flight.
- `refreshPricingCache()` always starts a NEW read, chained after the read in flight (which may have begun before an apply committed). That new read becomes the shared promise, so later lookups and the warm join it.
- Every read takes a generation number when it starts. It applies its rows only if no newer read has applied already, so an older read finishing late never overwrites a newer one.
- Lookups (`getPricingInternal`, `listPricedModels`) and the warm still join a read in flight.
- **Images:** the same rule after `invalidateImagePrices()`. It bumps an epoch. A read that began in an older epoch is discarded and cannot mark the cache fresh. A load after the invalidation does not join it; it chains a new read.
- **Tests:**
  - `lib/ai/__tests__/pricing.slice7.test.ts`: a read in flight plus a refresh, in both readiness orders; a lookup made after the refresh joins the refresh's read; failures keep the best rows;
  - `imagePricing.test.ts`: the invalidation cases, in both orders.

**Where.** In `modelSettings.ts` `refill()`, the path every BOS call resolves through:
- `refill()` starts `warmPricingCache(BOS_PRICE_WARM_WAIT_MS)` **in parallel with**, and **outside**, `withReadBudget(buildSnapshot())`. `BOS_PRICE_WARM_WAIT_MS` is about 1,500 ms, below the 3 s settings budget;
- `refill()` bounds the warm a second time (`startPriceWarm` races it with a `BOS_PRICE_WARM_WAIT_MS` timer), so even a warm that never settles cannot hold the refill (QA M10, tested with fake timers);
- `refill()` awaits both with `Promise.allSettled`, so the settings result, its logging, `snapshot`, `nextRefreshAt` and `onReadFailure` are exactly as today. A slow, failed or timed-out price read can neither fail nor delay the settings beyond its own bound, and never marks the settings `fromFailedRead`;
- settings are cached for 60 s, so the warm is attempted at most once a minute per instance, and is a synchronous no-op while the price cache is fresh. When a refill finds the price cache older than 1 h, it reloads it. Between refills, `calculateCostSync` keeps serving the loaded (possibly stale-by-minutes) rows, as today on a warm instance;
- the first BOS call on a cold instance therefore waits for `max(settings read, min(price read, 1.5 s))` instead of the settings read alone. In practice both are one PostgREST round trip, run in parallel;
- `resolveBosLlmSettings` and `isBosLlmAreaEnabled` are unchanged, and so is the hot path once warm.

**Not universal.** Nothing is added to `baseProvider`, `openaiProvider` or any other provider (SA). Embeddings do not resolve through settings (DEC-3), but their charge is warm/cold identical after BQ-7a (§1).

**Residual for SA to confirm.** The token cache is module state shared by everything on the instance. Once a BOS call warms it, a **non-BOS** call on the same instance (agent platform, help bot) also prices from the rows. That already happens today whenever anything on the instance makes an async pricing read: `MemorySummarizer` `calculateCost`, `listPricedModels` from the admin options, or the guardrail checking a non-default model. So the warm makes an existing state more frequent; it adds no new one. The exposure is the 19 models in §1: 18 differ by about 1e-18 (no credit effect), and `google:gemini-1.5-flash` by 0.000005 per 1K tokens, which the rows (the authority) already charge on any warm instance. Dev proposes to accept this and record it in the slice 8 note. The alternative, a BOS-only token cache, would be a second loader and a second source of truth, so Dev does not recommend it.

**Proof (P-1d, RC7-8).**
- For every live BOS model (`gpt-4o-mini`, `gpt-4o`, `text-embedding-3-small`), with prod-shaped rows (JSON numbers, as `select('*')` returns them), the warm and the cold path give bit-identical costs (`toBe`).
- Unit tests:
  - fresh → no read;
  - stale → one read;
  - concurrent cold callers → one read (single-flight);
  - a hung read → `refill` returns its settings within the settings budget, and the warm returns by `maxWaitMs`;
  - a failed price read → settings unaffected, `fromFailedRead` false;
  - a settings failure → the warm still runs.
- Ten suites in `lib/business-os/llm/__tests__` mock `@/lib/ai/pricing` with a factory: `modelSettings*` (5), `callParams.*` (3), `adminSettingsView`, `modelOptions`. Each mock gains `warmPricingCache: jest.fn().mockResolvedValue(undefined)`. That is a mock addition only, with no assertion edit. **SA please confirm** that this sits within the RC7-6 class.

## 4. Guards

**`chargingUntouched.guard.test.ts` (slice 3): re-scope, do not retire.** It never scanned the charging files. It pins that the **research and review** files read charging modules only through named read exports, never write a live table, and never price a call or refresh the billing cache. All of that stays true and useful after slice 7. Plan:

1. Rewrite the header: "The review code never prices a call. Charging changes only in the charging modules, under their own suites (slice 7: `chargeParity.test.ts`)." Keep the file name, to avoid churn across slices 6 and 8 (O-4).
2. Allow-lists (RC7-7): `'@/lib/ai/imagePricing'`: the pure functions only (`selectActiveImagePrices`, `resolveImagePriceFrom`), **never** `loadImagePrices`; an `aiModelImagePricingRepository` method pin: `listActiveExact` only. `resolveImagePrice` stays allowed.
3. The `listActive` body pin stays unchanged (slice 7 does not edit `AiModelPricingRepository`).

**New guard `lib/ai/__tests__/chargeSources.guard.test.ts`** (RC7-9, wording per SA F-2): a fixed list of five directory trees (about 700 files): `lib/ai`, `lib/business-os/llm`, `lib/services`, `lib/repositories`, `app/api`. Every G-n has one negative control, in the LW-4 style. G-4 is a rule, `readsRetiredSetting(text)`, tested on planted text (SA F-3).
- G-1 The **full** import-specifier set of `chargePricing.ts` equals the expected set: `inCodeTokenPrices`, `isInputOnlyPricedModel`, `IMAGE_FALLBACK_PRICING`, the `UsageCallRecord` type from `usageScope`, and `chargeClassification`'s exports. So no `imagePricing`, no repository and no `calculateCost*`, and the conservative rate cannot become DB-sourced.
- G-2 `cached_input_cost_per_token` is read for charging only in `lib/ai/pricing.ts`. Allowed besides that: the types, the review code, the migrations, and `AiModelPricingRepository.ts`, whose `listActiveExact` select names the column.
- G-3 `IMAGE_FALLBACK_PRICING` is read only by `imagePricing.ts`, `chargePricing.ts` and the review code. The guardrail and the service no longer hold copies of the chain.
- G-4 (kept, SA O-1) `GeneratedImageService.ts`, `modelSettings.ts` and `comparisonModel.ts` no longer read `pricesUsd`. `EmbeddingService.ts` no longer names `helpbot_embedding_cost_per_1k_tokens`.
- ~~G-5~~ dropped: covered by `livePriceWrites.guard` LW-2 (RC7-2).

**`livePriceWrites.guard` (slice 6, now on main; this slice owns the edit, SA O-7 / RC7-2):**
- Generalise the single `REPOSITORY` constant into a read-only repository map:
  - `AiModelPricingRepository.ts` → `listActive`, `listActiveExact`, `listAll`;
  - `AiModelImagePricingRepository.ts` → `listActive`, `listActiveExact`.

  The map drives the LW-1 exemption and LW-2 (no write call; exactly these methods). A plain `LITERAL_ALLOWED` entry is not enough, for two reasons: the non-repository branch rejects a `TABLE` constant, and its non-vacuity check expects one chain per file.
- `REPOSITORY_TABLES` gets the new file → `['ai_model_image_pricing']`.
- Add a negative control for the new file, and update the header line.
- The table name is never quoted in a string outside the repository, so a log message cannot trip LW-1.
- Slice 8 must not duplicate the entry.

## 5. Proof of identical charges

All offline (mocked repositories), deterministic, exact equality (`toBe`, i.e. `Object.is`, never `toBeCloseTo`). New suite `lib/ai/__tests__/chargeParity.test.ts`. Prod-shaped state: active token rows with cached NULL, the `text-embedding-3-small` row (2e-8 / 0, as a JSON number, since BQ-7a), an empty image table, no image price setting.

**RC7-8 (binding).**
- **The reference is self-contained:** literal rates, today's operations in today's order written out. No call to `calculateCostSync`, `resolveImagePrice`, `inCodeTokenPrices` or `IMAGE_FALLBACK_PRICING`. P-3 checks against literal flare values, not the map. Expected costs are literal numbers.
- **Test first:** T-9 is written and run green on the **unmodified tree** before T-3. Its output is recorded in §5.1, and the suite is not edited after that.
- **The real provider:** P-1 drives the real `OpenAIProvider` (SDK mocked, as `openaiProvider.priceStatus.test.ts` does), so the private `calculateCost` and the ledger's `cost_usd` are both covered.
- **Added cases:**
  - cached > prompt (the clamp);
  - usage missing;
  - an unpriced model (0, and exactly one warn);
  - warm against cold (P-1d, RC7-5);
  - an embedding through `createEmbedding`;
  - an image whose reported quality differs from the requested one.

| # | Golden call (area, model) | Inputs | Expect |
|---|---|---|---|
| P-1 | chat planner, `gpt-4o-mini` | prompt 1,200, cached 0 / 512 / 301 (odd, exercises `Math.round`), completion 150 | new == reference, bit for bit |
| P-1b | insight, briefing, leads (`gpt-4o-mini`); website full_site, intake, onboarding (`gpt-4o`) | typical tokens, cached 0 and > 0 | same |
| P-1c | DB unavailable (cold instance) | same calls | fallback values, as today |
| P-1d | warm vs cold (RC7-5) | every live BOS model, prod-shaped rows | bit-identical |
| P-2 | embedding, `text-embedding-3-small`, through `createEmbedding` | 37 and 8,191 tokens; row present and absent | provider cost == literal reference; `EmbeddingService` `cost` == the ledger row's `cost_usd` (RC7-10) |
| P-3 | image `gpt-image-2.5-flare` | 3 sizes × low, medium, high, xhigh, max; quality unreported (priced as high) | == `IMAGE_FALLBACK_PRICING[key]`, source `fallback` |
| P-3b | image key priced nowhere | — | $0 + error log + `unpriced` status, so the charge takes the conservative rate (as today) |
| P-4 | Layer 2 guardrail | flare passes; an unpriced model gets `image_price_missing`; a token model unchanged | same verdicts as today |
| P-5 | `priceActionForCharge` on one action of each kind | P-1..P-3 records | same `costUsd`, `isFallbackPriced` |
| P-6 | `conservativeRateDerivation()` | before, and after loading a DB image row of $9 and a cached rate | **deep-equal** (DB never reaches it) |
| P-7 | never shrink | — | `git diff 98735db9 -- lib/ai/pricing.ts` shows no change inside `FALLBACK_PRICING`; `IMAGE_FALLBACK_PRICING` byte-identical (QA check) |

**Positive tests** (the new behaviour, for slice 8):
- a cached rate on a row is used, both when it is below half the input rate and when it is above it;
- a cached rate of 0 or NaN falls back to the derived rule;
- an image table row beats the fallback;
- the newest of two active rows wins;
- a row with a future `effective_date` is ignored, by the repository filter (repository unit test);
- an image read that fails keeps the previous map;
- the guardrail accepts a model priced only in the table;
- `refreshPricingCache` reloads the token rows and **invalidates** the image map without fetching it (RC7-4);
- the image cache: an empty read counts as loaded, concurrent callers make one read, a failure leaves `loadedAt` unchanged, and the service's ~2 s bounded wait falls back with a warn (RC7-3);
- the guardrail loads the image table only for a non-default image model (RC7-11);
- the comparison's current equals the charging resolver for the same rows, for tokens (cached included) and images (RC7-7 truth test);
- the `images` policy allows only `openai` (RC7-14);
- the TTL is honoured, using fake timers with an explicit `Date.now` mock, never `advanceTimers: true` (flake pattern #399).

**Suites that must pass unedited:**
- `pricing.test.ts`, `chargePricing.test.ts`, `chargeClassification.test.ts`;
- `openaiProvider.image.test.ts`, `openaiProvider.priceStatus.test.ts`;
- `EmbeddingService.attribution.test.ts`;
- `callParams.snapshot.test.ts`, and the `modelSettings*` suites not listed below.

**Pre-approved edits (RC7-6), the only assertion edits allowed:**
- `GeneratedImageService.attribution.test.ts` ("uses the configured price first", "keys the price on model, size and quality", "uses a configured price for the reported quality before the fallback"), `modelSettings.test.ts` ("accepts an image model priced for every configured size and quality") and `callParams.boundary.step3.test.ts` (prices fed through `pricesUsd`): move the same prices from `pricesUsd` into an image-table mock, with the same expected outcome. Each suite gains one assertion that a `pricesUsd` value is now ignored.
- `priceCoverage.test.ts`: the `resolveImagePrice` first argument only (the loaded table).
- `'config'` → `'table'` where `ImagePriceSource` is asserted.

Mock additions (`imagePricing`, `warmPricingCache`) are not assertion edits; they are listed at code review. Any other assertion edit needs SA.

### 5.1 First run of `chargeParity` on the unmodified tree

**Run 2026-10-16** on the unmodified code tree at `ac674ceb`. The working tree held only doc edits and this new suite. `npx jest lib/ai/__tests__/chargeParity.test.ts --ci`: **1 suite, 21 tests, 21 passed**.

**Frozen file:** sha256 `cdb1aeaf7e18dbd88f6f5ce36c9e68c9811f6ba1c3483ff82c4d105ca56d5d6e`. QA re-hashes at code review. Any difference means the suite was edited.
- **Method (SA ruling 5):** `cdb1aeaf…` is `sha256sum` of the file as written, which contains **no CR byte** (`grep -c` of CR = 0). So it equals the sha256 of the LF-normalised content: `tr -d CR < file | sha256sum` gives the same value. No re-pin was needed.
- **Second pin:** `git hash-object lib/ai/__tests__/chargeParity.test.ts` = `d1231341bf6ae57ce4a7fe15314a015ffcbff65e`.
- **Re-check after T-3..T-10:** both hashes are unchanged, and the suite is 21/21 against the slice 7 code.

**What it covers:**
- **P-1 / P-1b.** Ten golden calls, cold and warm: ledger `cost_usd` and scope `costUsd` equal literals. The calls cover:
  - chat on `gpt-4o-mini`, cached 0 / 512 / 301 / above the prompt;
  - insights, briefing and leads;
  - website, intake and onboarding on `gpt-4o`.
- **P-1c.** The database down.
- **P-1d.** Warm against cold, compared with `Object.is`.
- **Usage missing.**
- **An unpriced model:** $0, `unpriced`, exactly one warn.
- **P-2.** Embeddings through `createEmbedding`, cold or warm, with the row present or absent. `EmbeddingService`'s figure equals the ledger.
- **P-3.** All 15 flare size × quality keys; quality unreported, priced as high; reported quality different from the requested one; the live request (model, size, quality, n).
- **P-3b.** An unknown quality: $0, `unpriced`, one error log.
- **P-4.** Guardrail verdicts: flare is accepted; sunburst is refused with `image_price_missing`; `gpt-imaginary` is refused with `unpriced_model` (×4 insights calls).
- **P-5.** `priceActionForCharge`. Measured, plus conservative 0.09 (text) and 0.212 (image); total 0.35624824.
- **P-6.** The conservative derivation stays at the in-code maxima, with a disagreeing database (a $9 image row and a huge token row with a cached rate).

**Harness:**
- An in-memory fake behind `supabaseServer` holds the production rows from 2026-10-16, so every repository, old or new, reads production-shaped data.
- `jest.isolateModules` gives a cold instance per scenario.
- The SDK and `UserMediaRepository` are mocked.
- No network.

**Runtime:** 5–12 s locally on Windows. It runs in the normal Jest shards, not in `test:bos-llm`.
- **Where the time goes:** module transform and import, about 11 fresh registries (`jest.isolateModules`), each loading the provider, pricing, settings and service graph (supabase-js included). The test bodies take milliseconds.
- **CI:** measure the shard on the PR. If it finishes after Build, move the suite to a shard that does not. Never split or tune the file (SA ruling 5).

**CI time:** two new small suites, no network, no new job. `chargeParity` lives in `lib/ai/__tests__` (the normal shards), not in the `test:bos-llm` critical-path job.

## 6. Files

| File | Action | Reason |
|---|---|---|
| `lib/ai/pricing.ts` | modify | `cachedInput` in the cache; `calculateCostWithCachedSync`; single-flight load; `warmPricingCache` (RC7-5); `refreshPricingCache` invalidates images; header |
| `lib/ai/pricingCacheTtl.ts` | create | The shared 1 h TTL, so `imagePricing.ts` never imports `pricing.ts` (RC7-3) |
| `lib/ai/imagePricing.ts` | create | Image price cache, the pure selection rule and the one resolver |
| `lib/repositories/AiModelImagePricingRepository.ts` | create | Read-only `listActive` + `listActiveExact`. **No data-export descriptor:** a platform table with no `user_id` (RC7-12) |
| `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts` | modify | RC7-2 read-only repository map |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | `AiModelImagePricing` type; cached field on `AiModelPricing`; export |
| `lib/ai/providers/openaiProvider.ts` | modify | `calculateCost` calls the new function; the 50% rule stays here |
| `lib/services/GeneratedImageService.ts` | modify | Load table in the attempt; resolver delegates |
| `lib/business-os/llm/modelSettings.ts` | modify | `checkImageModel` uses the shared resolver, lazily (RC7-11); `refill` warms the token cache (RC7-5) |
| `lib/services/EmbeddingService.ts` | modify | Cost = `calculateCostSync` after the call, not the setting (RC7-10) |
| `lib/repositories/SystemConfigRepository.ts` | modify (comments only) | `IMAGE_FALLBACK_PRICING` header: non-authoritative outage fallback + conservative source, never shrink (R-1). **No value changes** |
| `lib/ai/pricing-research/comparisonModel.ts` | modify (O-3, RC7-7) | "current" = what is charged: fresh exact rows via `listActiveExact`, never the cache; cached = column when > 0 (basis `table`) else derived; image basis `table` with the image row id; `imageCoverage` = table ∪ fallback ∪ area models; `image_setting` no longer produced; header rewritten |
| `lib/ai/pricing-research/__tests__/chargingUntouched.guard.test.ts` | modify | Re-scope (section 4) |
| `lib/ai/__tests__/chargeParity.test.ts`, `chargeSources.guard.test.ts`, `imagePricing.test.ts`; `lib/repositories/__tests__/AiModelImagePricingRepository.test.ts` | create | Proof and guards |
| `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md` | modify | RC7-13: status sentence, R-1 copies row "(slice 7)", the slice 3 note replaced by the slice 7 note for slice 8, BQ-7a/7b decisions, Change History (done 2026-10-16) |
| `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md` | modify | BQ-7a run-log row (done 2026-10-16). §6's "image prices are still in code until slice 7" sentence is corrected at code complete |

`chargePricing.ts`, `chargeClassification.ts`, `AiModelPricingRepository.ts`, `FALLBACK_PRICING` and the values in `IMAGE_FALLBACK_PRICING` are **not edited**. No migration. No route.

## 7. Open questions for SA

**All ruled by SA on 2026-10-16** (table under SA Review Notes):

| # | Ruling |
|---|---|
| O-1 | Drop the setting |
| O-2 | Approved |
| O-3 | Approved, with RC7-7 |
| O-4 | Re-scope in place |
| O-5 | A stored 0 is unset |
| O-6 | `PROVIDERS.OPENAI`, plus RC7-14 |
| O-7 | Slice 6 merged first, so slice 7 owns the guard edit |

The questions are kept below for the record. **Still open: SA's short confirmation of §3.6 (RC7-5), including its residual and the RC7-6 class for the `warmPricingCache` mock additions.**

- **O-1** The image price setting: drop it from charging, the guardrail and the comparison (R-1, R-9 row 7; recommended), or keep it between the table and the fallback (task brief)? Identical today either way. Dropping it leaves Apply as the only way to change an image price.
- **O-2** Cached-input placement: one combined lookup in `pricing.ts`, with the provider passing the derived 50% token count (recommended, section 3.1), or the provider composing it from a rate getter?
- **O-3** Update `comparisonModel.ts` in this slice, so "current" equals what is charged (cached from the column when set; image from the table, with basis `'table'` and the image row id)? Recommended yes, since the charging change and the truth of the review page should ship together. No migration is needed: `current_row_id` has no FK, and slice 8 resolves it by `kind`. This also retires the slice 8 note "re-derive cached, never compare with the column": after slice 7 the column **is** current when set. The slice 8 stale check must follow this, which needs TL coordination with the `-s8` planner.
- **O-4** Re-scope `chargingUntouched.guard` in place (recommended), or rename it to `reviewCodeReadsOnly.guard`?
- **O-5** A stored cached rate of 0 is allowed by the column CHECK (`>= 0`). Treat it as unset (derived rule, recommended), or honour it?
- **O-6** Image provider key: use `PROVIDERS.OPENAI` because `getOpenAI()` is the provider that runs, or `settings.provider` from the area row? They are equal today, and the policy has a single image provider (F-15).
- **O-7** Merge order with slice 6 for the `livePriceWrites.guard` allow-list edit (section 4). Dev proposes that slice 7 rebases on slice 6 if slice 6 merges first, and otherwise hands slice 6 the two-line edit.

## 8. Business questions

**Decided by the user on 2026-10-16, via TL:**
- **BQ-7a: "Write it now."** SA argued against a seed migration, so the slice carries **no migration and no seed**. TL wrote the row on production with the emergency SQL runbook, with the user's approval:
  - when: 2026-10-16, 19:56 UTC;
  - row: `549fcc6e-3f63-4d06-b959-71c77759a12e`, at 0.02 / 0 per 1M;
  - fingerprint: all models `76c7cfe8…` → `8d6bbb23…`; other models unchanged;
  - charge: unchanged.
- **BQ-7b: yes.** The image-price setting no longer affects charging (matches O-1).

The original questions are kept below for the record.

- **BQ-7a** Should the price of the embedding model (`text-embedding-3-small`, $0.02 per million tokens) be written into the price table now, by a one-off database change, or the first time you approve prices with "Check provider prices"? **Recommendation: at the first approval.** The charge is the same either way, and it keeps a single, recorded path for every price change.
- **BQ-7b** (only if SA picks O-1 "drop") Today a hidden setting could override image prices. It is not used in production. Should it be switched off, so that approving a price is the only way to change what an image costs? **Recommendation: yes.**

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A float difference changes a charge by 1e-18 | Fallback branch returns today's exact expression; P-1 asserts `toBe` |
| R-2 | Image price load adds latency or a failure point to image generation | One cached read per hour per instance (an empty table counts as loaded), single-flight, ~2 s bounded wait, never throws, fallback on failure (RC7-3) |
| R-3 | Guardrail refill exceeds its 3 s budget on a cold image read | Lazy, only for a non-default image model (RC7-11); inside `withReadBudget`; degrades to the code default |
| R-4 | `livePriceWrites.guard` red on the new repository | This slice owns the edit (RC7-2); the merge queue refuses a PR without it |
| R-9 | The token warm (RC7-5) delays the first BOS call on a cold instance, or warms non-BOS prices on the same instance | In parallel with the settings read, bounded at ~1.5 s, outside the settings budget; the residual is disclosed in §3.6 for SA |
| R-5 | Test suites that mock `pricing` or `SystemConfigRepository` break on the new import | Mock additions only; assertion edits need SA |
| R-6 | `GeneratedImageService` ↔ `modelSettings` import cycle | Shared resolver in `lib/ai/imagePricing.ts`, which imports neither |
| R-7 | A future DB cached rate above half the input rate charges more than today | Intended (the DB is authoritative); positive test covers both directions |
| R-8 | Merge conflict with slice 6 | Resolved: origin/main `ac674ceb` merged as a fast-forward (RC7-1), no conflict |

## 10. Task list

- [x] T-0 SA reviewed (RC7-1..RC7-14, O-1..O-7 ruled); BQ-7a/7b decided by the user; RC7-1 merge done (fast-forward to `ac674ceb`); RC7-13 requirement edits and the runbook run-log row done
- [x] T-0b SA confirmed §3.6 (RC7-5) on 2026-10-17, with C-1 (implemented above) and rulings 1–5
- [x] T-9 **first** (RC7-8), done 2026-10-16 (§5.1, 21/21 on the unmodified tree, hash recorded): `chargeParity.test.ts` reference and golden literals, run green on the unmodified tree, output in §5.1; the suite is frozen after that. The cases that need new code (P-1d, positive tests) go in separate suites
- [x] T-1 Repository (`listActive`, `listActiveExact`) + types + `index.ts` + unit tests (RC7-12); the `livePriceWrites.guard` map edit (RC7-2), done 2026-10-16.
  - Repository suite: 11/11. Guard: 21/21, including the new negative control.
  - Note for SA: LW-2's write matcher now also refuses `.rpc(` in a read-only repository. The token repository has none.
- [x] T-2 `lib/ai/pricingCacheTtl.ts` + `lib/ai/imagePricing.ts` + `imagePricing.test.ts` (RC7-3 semantics, the pure selection rule, invalidate), done 2026-10-16, 18/18. Not yet imported by any charging file: `pricing.ts` adopts the shared TTL in T-3.
  - **Deviation for SA:** on timeout, `loadImagePricesWithin` returns the **last loaded** map, not an empty one. On a cold instance that map is empty, so the result is the fallback-only table SA described. On a warm instance whose TTL has just expired, it is the last good prices, consistent with "a failure keeps the previous map".
- Scoped `tsc` of every new or edited file: clean. The only errors in the graph are 2 that already exist on main, in `EmbeddingService.ts` (`createEmbedding` is not on `BaseAIProvider`). T-6 touches that file; SA, fix them there or leave them?
- Locally, `openaiPricingAdapter.test.ts` fails 6 cases. That file is untouched: the fixtures are checked out with CRLF (`core.autocrlf=true`), the known Windows pattern. CI is unaffected.
- [x] T-3 `pricing.ts`: cached field + `calculateCostWithCachedSync`; single-flight with C-1; `warmPricingCache`; `refreshPricingCache` invalidates images (RC7-4); shared TTL
- [x] T-4 `openaiProvider.calculateCost` switched; the 50% rule stays in the provider as `derivedCachedTokens`
- [x] T-5 `GeneratedImageService` (`Promise.all` with `loadImagePricesWithin`, about 2 s) + `modelSettings` (lazy image load, 1 s bound, RC7-11; refill warm, RC7-5); RC7-6 test edits; RC7-14 test
- [x] T-6 `EmbeddingService` figure = `calculateCostSync(PROVIDERS.OPENAI, model, prompt_tokens, 0)` (RC7-10); the 2 type errors fixed type-only (ruling 4)
- [x] T-7 Comment-only headers on `IMAGE_FALLBACK_PRICING` and `FALLBACK_PRICING` (R-1 wording); no value changed
- [x] T-8 `comparisonModel.ts` (RC7-7) + `comparisonTruth.test.ts`
- [x] T-10 `chargeSources.guard.test.ts` (RC7-9, negative controls); `chargingUntouched.guard` re-scoped (O-4, RC7-7 allow-lists)
- [x] T-11 Runs, recorded in 10.1
- [x] T-12 Runbook §6 image sentence corrected; requirement status; `git diff --numstat` after each doc edit
- [x] T-13 Handed over uncommitted for SA code review

### 10.1 Implementation notes and deviations (for SA code review)

- **Mock additions (ruling 1).** Ten suites got `warmPricingCache: jest.fn().mockResolvedValue(undefined)` in their `@/lib/ai/pricing` factory: `adminSettingsView`, `callParams.boundary.step2`, `callParams.boundary.step3`, `callParams.snapshot`, `modelOptions`, `modelSettings.off.chat`, `modelSettings.off.nonchat`, `modelSettings`, `modelSettings.wiring.nonchat`, `modelSettingsSeed` (all in `lib/business-os/llm/__tests__`).
  - **Also needed in the same class:** the eight of them that mocked `calculateCostSync` got `calculateCostWithCachedSync` with the same value (0, or 0.0001 in `wiring.nonchat`). The provider now calls it; a missing mock would turn a call into a failure row.
- **Image table mocks (RC7-6 class).** `GeneratedImageService.attribution`, `modelSettings` and `callParams.boundary.step3` gained an `AiModelImagePricingRepository` mock, empty by default. `comparisonModel.test` gained an `AiModelImagePricingRepository.listActiveExact` mock. The two `modelSettings`-family suites also call `__resetImagePricesForTests()` in `beforeEach`.
- **RC7-6 edits, as pre-approved:**
  - prices moved from `pricesUsd` into the table mock (image attribution ×2, `modelSettings` ×1, `step3`);
  - each suite gains an "ignored" assertion: image attribution ×2 new cases, `modelSettings` ×1 new case, `step3` uses a 99 decoy in the setting plus one `not.toBe(99)`;
  - `{}` → `new Map()` / `priceTable()` arguments (`priceCoverage` ×2, image attribution ×3);
  - one type-only change: the throwing Proxy is now typed as a map.
- **Assertion edits OUTSIDE the RC7-6 class: SA please confirm.** Two edits in `comparisonModel.test.ts`, both forced by O-3 and RC7-7:
  - "cached input is derived … (no reader until slice 7)" now expects the stored column (`'0.01'`, basis `table`). A new case keeps the derived expectation for a model with no stored rate.
  - The manual-entry snapshot's `current_cached_input_cost_per_token` is `'0.00000001'` (was the derived `'0.000000075'`).
- **P-1d for the embedding row** is in `pricing.slice7.test.ts`, not in `chargeParity`: the frozen suite may not be edited. It asserts `0.00000002 * 1000` `toBe` `0.00002`, and warm `Object.is` cold for 1 / 37 / 8,191 / 100,000 tokens with row `549fcc6e…`. `chargeParity`'s P-2 already charges the row warm and cold to the same literal.
- **Guardrail image wait:** `BOS_GUARDRAIL_IMAGE_PRICE_WAIT_MS = 1_000`, inside the 3 s refill budget, so a slow image read cannot fail the settings. Not in the workplan before; SA please confirm the number.
- **Image provider in the guardrail:** `checkImageModel` receives the row's provider. The policy allows only `openai` (RC7-14 test), so it equals `PROVIDERS.OPENAI`. That avoids importing the provider factory into `modelSettings`.
- **`GuardrailContext.imagePrices` is optional.** `adminSettingsView.test` builds a context literal without it, and it then loads on demand.
- **`AiModelPricing` type** gained the optional `cached_input_cost_per_token`.
- **`resolveImagePrice` source value** `'config'` → `'table'` (the `priceSource` log value; mention in the PR).
- **Local-only failures, not caused by this slice:** they come from CRLF in the Windows checkout (`core.autocrlf=true`), and the files are untouched:
  - `openaiPricingAdapter.test.ts` (6 cases: fixture line endings);
  - `servicesAreDraftsWithWords.guard` and `theChainHoldsEndToEnd` (newline-anchored source patterns).


### 10.2 Runs, 2026-10-17 (local, Windows)

| Run | Result |
|---|---|
| `chargeParity` (frozen) | 21/21; sha256 and `git hash-object` unchanged |
| `lib/ai` | 25/26 suites, 457/463 tests; the 6 failures are `openaiPricingAdapter` (CRLF fixtures, untouched) |
| `lib/ai/pricing-research` | 15/16 suites, 305/311; the same 6 |
| `lib/business-os/llm` and `npm run test:bos-llm` | 23/23 suites, 635/635 |
| `app/admin/system-config` | 10/10, 145/145 |
| `app/api/admin/model-pricing` | 3/3, 51/51 |
| `supabase/migrations` | 43/43, 2322/2322 |
| `lib/services` / `lib/repositories` | 44/44, 680/680 / 102/102, 2400/2400 |
| `lib/business-os` + `app/api/business-os` | 430/432 suites, 13642 passed, 3 failed (2 onboarding guards with newline-anchored patterns on CRLF, untouched) |
| `npm run test:bos-entitlements` | 281/281, 8470/8470 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| Tailwind guard (`app/__tests__/tailwind-css-escape.guard.test.ts`) | 6/6 |
| `typecheck:bos-llm` | 549 files, 28 errors, **0 new**; baseline file byte-identical (it reports one entry, `app/api/onboarding/build/route.ts`, as fixed; not touched here, not updated) |
| `check:bos-llm-literals` | 64 files, 0 violations |
| ESLint, touched files | 0 errors in new or slice-changed code; the 3 errors are the pre-existing `@ts-ignore` lines in `openaiProvider.ts` (same lines on main) |
| `tsc --noEmit` at 8 GB | 4 errors in touched files, all in `pricing.slice7.test.ts` (script scope collided with `pricing.test.ts`), fixed with `export {}`; scoped re-check of every touched file: 0. The 2 `EmbeddingService` errors are gone |


### 10.3 Code review and QA fixes (2026-10-17)

- **F-1 (SA, required).** `comparisonModel.ts` `tokenCurrent` shows a stored cached rate as current only for OpenAI, the one provider whose charge reads it; the derived OpenAI branch is unchanged, and the header says other providers are not compared. A new `comparisonTruth` case (an anthropic row with a cached rate) asserts the unit is not `table` and that `calculateCostSync('anthropic', …)` ignores the column. **Proved to bite:** it failed on the unfixed code, and again with the provider gate removed by a mutation (file restored, `cmp` identical).
- **F-2 (SA, doc).** The `chargeSources.guard` header and §4 now say "a fixed list of five directory trees (about 700 files)".
- **F-3 (SA, done).** G-4 is the rule `readsRetiredSetting(text)`, tested on planted text for both settings and on stripped comments.
- **F-4 (SA).** Comments on the token generation discard and the image epoch discard: backstops that cannot fire while reads are chained.
- **QA M10.** `startPriceWarm` now bounds the warm itself as well, and a `modelSettings` test gives the warm a promise that never settles. The settings return at `BOS_PRICE_WARM_WAIT_MS` (below the 3 s budget) with `fromFailedRead` false. **Proved to bite:** with the bound removed, the test fails (timeout); file restored, `cmp` identical.
- **QA M08 / M08b.** The "ready first" tests are renamed: they prove the result is right in both orders (through chaining), not that the backstop fires.

### 10.4 PR notes

- **Logs (D-6):** the image price source in logs (`priceSource`) is now `table` or `fallback`; the value `config` is gone. Update any log filter that used it.
- **Charges:** identical for today's database state (QA: 1479 figures, 0 differences against main).
- **Slice 8 (relayed by TL):** the SA F-1 amendment to the stale check (cached input for OpenAI lines only) and F-5 (bound the post-apply `refreshPricingCache()`).

---

## SA Review Notes

**Reviewed by SA — 2026-10-16** (workplan against `98735db9` and origin/main `ac674ceb`; read-only live checks with a select-only script)
**Status:** ✅ Approved with conditions. RC7-1..RC7-14 are folded into this workplan before T-1. RC7-5 is a design addition: Dev writes it into §3, and SA confirms it (short pass, not a full re-review) before T-3. The other items need no second review and are checked at code review.

### Facts SA re-checked

- **Slice 6 is merged.** PR #441 is in origin/main (`ac674ceb`). The branch is still off `98735db9`. So O-7 is decided by events, see RC7-1 and RC7-2.
- **The token cache is cold on most BOS instances.** `calculateCostSync` reads only the warm cache. On a BOS instance where every area uses its code default, nothing warms that cache: `checkModel` returns early for the default (RC-W7b), so it never calls `getPricing`. Nothing in the provider path warms it either. On such an instance today's token charges come from `FALLBACK_PRICING`, not from the rows. §1 row 1 ("token charges already come from these rows") is true only on a warm instance. This is finding 4's twin, and it matters here: without a fix, a cached rate applied by slice 8 would be charged only on warm instances.
- **The rows match the fallback for the BOS models.** Live, read-only, 2026-10-16: for `gpt-4o-mini` and `gpt-4o`, the cache value (`Number(row) × 1000`) equals `FALLBACK_PRICING` bit for bit, with cached NULL. `text-embedding-3-small` has no row. Warming for the BOS models therefore changes no charge today. For 19 other models the warm and cold values already differ: 18 by float noise (about 1e-18, e.g. `gpt-4.1-mini` 0.00039999999999999996 against 0.0004), and `google:gemini-1.5-flash` by a real amount (0.00008 against 0.000075 per 1K). A universal warm would change agent-platform charges on cold instances. See RC7-5.
- `ai_model_image_pricing`: 0 rows. Its columns match §3.2. The CHECK requires `cost_per_image > 0`, and the table is admin-SELECT under RLS. The proposal-line CHECK requires `current_basis = 'table'` to come with `current_row_id`, and `current_row_id` has no FK. That supports O-3.
- **These suites assert on the setting** and cannot pass unedited if O-1 is "drop":
  - `GeneratedImageService.attribution.test.ts`: "uses the configured price first", "keys the price on model, size and quality", "uses a configured price for the reported quality before the fallback";
  - `modelSettings.test.ts`: "accepts an image model priced for every configured size and quality";
  - `callParams.boundary.step3.test.ts`: its prices are fed through `pricesUsd`. Its own comment warns that the override would then be refused, and the test would pass for the wrong reason.
  - `priceCoverage.test.ts` calls `resolveImagePrice({}, …)`.
  - §5's "pass unedited" list is wrong for these. See RC7-6.
- **Logging.** None of the touched files uses `console.*` (all 0).

### O-rulings

| # | Ruling |
|---|---|
| **O-1** | **Drop** the setting from charging, the guardrail and the comparison. R-1's copies table and R-9 row 7 are the authority. The user approved R-9 on 2026-10-14, so BQ-7b is already decided and is not re-asked. Keeping the setting would leave a second, unaudited way to change a charged price, a `system_settings_config` write, beside the one-writer rule slice 6 just enforced. `getImageGenerationConfig` keeps parsing it until slice 14, and still supplies sizes and quality. Conditions: RC7-6, and G-4 kept |
| **O-2** | **Approved.** One combined lookup in `pricing.ts`, with the provider passing the derived token count. On a miss it delegates to `calculateCostSync`, so the "no pricing" warn fires exactly once (test it). When `cachedInput` is absent, it must return the result of today's expression itself, not a recomputation |
| **O-3** | **Approved, with RC7-7.** "Current" must equal what is charged, and the review page and the charge change should ship together. This retires the slice 3 note "re-derive, never compare with the column". The replacement note is below, for TL to relay to the `-s8` planner |
| **O-4** | **Re-scope in place.** Keep the file name. Rewrite the header as proposed. The allow-list changes are in RC7-7 |
| **O-5** | **A stored 0 is unset.** Use the derived rule, which charges more and so never undercharges. The same rule applies in the comparison (RC7-7) and in slice 8's stale check. A 0 can reach the column only by hand-written SQL: the proposal-line CHECK already requires a cached price above 0, and the slice 6 runbook writes NULL |
| **O-6** | **`PROVIDERS.OPENAI`.** The price key must name the provider that actually bills, which is `getOpenAI()`. Add one assertion that the images policy allows only `openai` (F-15), so the key and the area row cannot drift apart silently (RC7-14) |
| **O-7** | **Settled: slice 6 merged first, so slice 7 owns the edit.** Merge origin/main into this branch before T-1 (RC7-1) and make the guard edit in this slice (RC7-2). Main cannot go red: the merge queue tests each PR against main plus the PRs queued ahead of it, so a PR without the edit is rejected in the queue, never merged. Slice 8 must not duplicate the entry |

### Required changes

1. **RC7-1 Rebase.** Merge origin/main (`ac674ceb` or later) into the branch before T-1. Update the header, the §4 slice 6 paragraph and R-8. The `types.ts` and `index.ts` hunks from slice 6 (the Sync types removed) are the expected conflicts.
2. **RC7-2 `livePriceWrites.guard`** (this slice owns the edit):
   - Generalise the single `REPOSITORY` constant into a read-only repository map: `AiModelPricingRepository.ts` → `listActive`, `listActiveExact`, `listAll`; `AiModelImagePricingRepository.ts` → `listActive`, `listActiveExact`. Use the map for the LW-1 exemption and for LW-2 (no write call; exactly these methods).
   - **Why a plain `LITERAL_ALLOWED` entry is not enough:**
     - the non-repository branch rejects a `TABLE` constant;
     - its non-vacuity check expects exactly one chain per file, and this repository has two methods.
   - `REPOSITORY_TABLES` gets the new file → `['ai_model_image_pricing']`.
   - Add a negative control for the new file, and update the header line.
   - G-5 is then covered by LW-2. Drop G-5.
   - Never quote the table name in a string outside the repository (a log message would trip LW-1).
3. **RC7-3 Image cache semantics.**
   - **An empty table is a loaded table.** A successful read with 0 rows sets `loadedAt`. The table is empty today, so "refresh on an empty cache" would query the database on every image call and every guardrail refill.
   - **Single-flight.** One in-flight promise, shared by concurrent callers.
   - **Failure.** A failure keeps the previous map and leaves `loadedAt` unchanged.
   - **Bounded wait.** The wait in `GeneratedImageService` is bounded, about 2 s. On timeout the fallback-only table is used, with a warn. It never hangs and never throws.
   - **No import cycle.** `imagePricing.ts` must not import `pricing.ts`, which imports it. Move the TTL into a small shared module, or own an equal constant pinned by a test.
4. **RC7-4 `refreshPricingCache` invalidates the image cache.** It reloads the token rows, and it marks the image map stale (the next image read reloads). It must not fetch images itself. The effect for slice 8 on that instance is the same, and `pricing.test.ts` (7 calls), with every other suite that refreshes, stays network-free. An unmocked image repository would otherwise reach `https://test.supabase.co` from the jest setup env. Test it.
5. **RC7-5 Token cache warm on BOS paths** (design in §3, SA confirms before T-3):
   - **What.** Before a BOS token call is priced, the token cache is loaded for the resolved models, defaults included.
   - **Where.** Use the `resolveBosLlmSettings` refill path (every BOS call resolves through it).
   - **Bounds.** Single-flight, bounded, never throws. A slow price read must not fail or degrade the settings refill. Either keep it outside `withReadBudget`, or make a timeout there degrade the price read only, never the settings.
   - **Not universal.** Do not warm in `baseProvider` or the providers. That would change agent-platform charges on cold instances (facts above).
   - **Proof.** P-1d: warm and cold give bit-identical results for every live BOS model, using prod-shaped rows (JSON numbers, as `select('*')` returns them).
   - **Record.** Put the SA live check in §1.
6. **RC7-6 Assertion edits, listed in advance.** SA pre-approves one class of edit for the suites listed above: move the same prices from `pricesUsd` into an image-table mock, keeping the same expected outcome. Each of those suites gains one assertion that a `pricesUsd` value is now ignored. `resolveImagePrice` keeps its name; the first parameter becomes the loaded table, so the edit to `priceCoverage.test.ts` is the argument only. `ImagePriceSource` `'config'` becomes `'table'`. Any other assertion edit needs SA. Correct §5's "unedited" list.
7. **RC7-7 O-3 implementation.**
   - **Fresh and exact.** The comparison reads fresh, exact rows: the new repository's `listActiveExact()` (`cost_per_image::text`, the same filter and order). It never reads the per-instance cache and never calls `loadImagePrices`.
   - **One selection rule.** The newest active row per key, with a price above 0, is a pure function exported from `imagePricing.ts`. The cache and the comparison both use it.
   - **Token cached-input current.** The column value when `parseDecimal > 0` (basis `table`), else the derived half (basis `derived`). This follows O-5.
   - **Image current.**
     - Basis `table`, with `current_row_id` = the image row id (the DB CHECK requires it).
     - `imageCoverage`: table rows ∪ fallback ∪ area models. The setting is no longer part of it.
     - `image_setting` is no longer produced. It stays in the types and the CHECK for historic lines.
   - **Header.** Rewrite the `comparisonModel.ts` header.
   - **`chargingUntouched` allow-lists:**
     - `@/lib/ai/imagePricing`: the pure functions only, never `loadImagePrices`;
     - an `aiModelImagePricingRepository` method pin: `listActiveExact` only.
   - **Truth test.** For the same rows, the comparison's current equals the charging resolver, for tokens (cached input included) and for images.
8. **RC7-8 `chargeParity` must not drift with the code.**
   - **Self-contained reference.** Literal rates, today's operations in today's order written out. No call to `calculateCostSync`, `resolveImagePrice`, `inCodeTokenPrices` or `IMAGE_FALLBACK_PRICING`, all of which this slice touches or wraps. P-3 checks against literal flare values, not the map.
   - **Golden literals.** The expected costs are literal numbers.
   - **Test first.** T-9 moves before T-3. It is run green on the unmodified tree, the output is recorded in §5, and the suite is not edited after that.
   - **Real provider.** P-1 drives the real `OpenAIProvider` (SDK mocked, as `openaiProvider.priceStatus.test.ts` does), so the private `calculateCost` and the ledger's `cost_usd` are both covered.
   - **Add cases:**
     - cached > prompt (the clamp);
     - usage missing;
     - unpriced model (0 and exactly one warn);
     - warm against cold (RC7-5);
     - embedding through `createEmbedding`;
     - image reported quality ≠ requested.
   - **Equality.** `toBe` (`Object.is`) is the right equality.
9. **RC7-9 Guards stay cheap and are proven to bite.**
   - **No tree walk.** `chargeSources.guard` scans a fixed list of directories (`lib/ai`, `lib/business-os/llm`, `lib/services`, `app/api`). Without a walk the under-100 ms claim holds.
   - **Negative controls.** Every G-n gets one, LW-4 style.
   - **G-1** compares the full import-specifier set of `chargePricing.ts`, the `usageScope` type and `chargeClassification` included.
   - **G-2 allow-list** includes `AiModelPricingRepository.ts`, whose `listActiveExact` select names the column.
10. **RC7-10 `EmbeddingService`'s figure equals the charge.**
    - Use the same lookup the provider charged with: `calculateCostSync(PROVIDERS.OPENAI, model, tokens, 0)` after the call.
    - Not the async `calculateCost`. That can load rows on a cold instance after the charge was taken from the fallback, and then report a different number.
    - P-2 asserts that the returned `cost` equals the ledger row's `cost_usd`.
11. **RC7-11 Guardrail load is lazy.** Load the image table through the `GuardrailContext` memo (like `imageConfig`), and only when an image model other than the default is checked. It runs inside the existing budget. A failed or slow load gives a fallback-only table and never throws. `getImageGenerationConfig` stays the source of sizes.
12. **RC7-12 Repository** (`new-repository` and `tenant-isolation-guard` skills):
    - **Header.** Modelled on `AiModelPricingRepository`: unscoped by design (no owner column, platform price list), service role intentional, two caller classes:
      - the billing reader, `imagePricing.ts` → `listActive`;
      - the admin comparison → `listActiveExact`.
    - **Shape.** Client injection with a `supabaseServer` default, `RepositoryResult`, never throws, no caller-supplied filter.
    - **Tests.** A unit test per method (filter, order, error).
    - **Export.** Export it from `index.ts`.
    - **Data export.** It needs no data-export descriptor (platform table, no `user_id`). State that in §6.
13. **RC7-13 Requirement edits.**
    - In R-1's copies table, "`image_generation_prices_usd` | No longer read (slice 6)" becomes "(slice 7)".
    - Replace the slice 3 note "Stale check per basis" with the slice 8 note below.
    - Status sentence and Change History row.
    - Run `git diff --numstat` after each doc edit.
14. **RC7-14 O-6 assertion.** One test pins that the `images` / `image_generation` policy allows only `openai`.

### Optimisation suggestions

- In `GeneratedImageService`, start `loadImagePrices()` alongside `getImageGenerationConfig()` (`Promise.all`). The resolver is still built inside the attempt (RC-W4).
- The `priceSource` log value changes from `config` to `table`. Mention it in the PR description, for anyone filtering logs.

### Note for the slice 8 planner (TL relays verbatim)

> **Slice 7 changes what "current" means. Replace the slice 3 note "Stale check per basis" with this.**
>
> 1. **Token lines.**
>    - **Cached input.** After slice 7 the cached-input column IS the charged rate when it is above 0. The apply RPC compares the snapshot with the live active row as slice 7 charges it, never with a re-derived half alone:
>      - `input_cost_per_token` and `output_cost_per_token` are compared exactly;
>      - the expected cached value is `CASE WHEN live.cached_input_cost_per_token > 0 THEN live.cached_input_cost_per_token WHEN line.provider = 'openai' THEN live.input_cost_per_token / 2 ELSE NULL END`, compared `IS NOT DISTINCT FROM current_cached_input_cost_per_token`.
>      - A 0 in the column counts as unset (slice 7 O-5). Apply writes the cached rate only as NULL or above 0.
>    - **Basis `table`.** `current_row_id` must still be the active row for (provider, model).
>    - **Basis `in_code_fallback`.** The line is stale if any active row now exists for (provider, model). The RPC cannot see the in-code values, so the apply route recomputes `lineContextFor` on the server and refuses if it differs from the snapshot.
> 2. **Image lines.**
>    - **`current_row_id` by kind.** It is resolved by `kind`: token lines in `ai_model_pricing`, image lines in `ai_model_image_pricing` (no FK).
>    - **Basis `table`.** The row id must still be the active row for (provider, model, size, quality), with an equal `cost_per_image`.
>    - **Basis `in_code_fallback`.** Stale if an active image row now exists for the key; otherwise the route-side recompute decides, as for tokens.
>    - **Basis `image_setting`.** Always stale: slice 7 no longer produces it, and the line must be resubmitted. None exists live.
> 3. **Cache.** `refreshPricingCache()` after apply reloads the token rows and invalidates the image cache, on that instance only. Claim only "in effect on all servers within 1 hour". Slice 7 makes BOS token calls warm the cache on the settings path. Non-BOS paths can still serve the in-code table on a cold instance. That is not a BOS charge, but do not claim more.
> 4. **The image guardrail is all or nothing per model.** An image model is accepted for the `images` area only when every configured size is priced at low, medium and high (table or fallback). A per-model apply of part of a new image model's set leaves that model refused. Say so in the apply UI, or apply the set as one batch.
> 5. **Allow-lists.** `AiModelImagePricingRepository.ts` is already in `livePriceWrites.guard` (slice 7, read-only map). Slice 8 adds only its own functions and tables (the SC6-8 note), and keeps the image repository read-only: the writer is the RPC.
> 6. **Unchanged.** The rollback-lock note stands.

### Business questions

None to ask the user.
- **BQ-7a** (seed the embedding price now): SA rules **no**. The charge is the same, it would be a live-price write outside the one writer (LW-5), and Q6 already puts embeddings in the first real round (slice 12).
- **BQ-7b**: already decided by the user's approval of R-9 (row 7, 2026-10-14). TL may mention it as information: "a hidden setting can no longer change what an image costs; approving a price is the only way".

### Approval
[x] Workplan approved with conditions. Fold RC7-1..RC7-14 into the workplan, get SA's short confirmation of the RC7-5 design, then proceed. Money path: SA code review and QA, including the recorded first run of `chargeParity` against the unmodified tree, before any commit.

### SA confirmation (RC7-5) — 2026-10-17

**Status:** ✅ §3.6 confirmed, with one change (C-1) that Dev makes in T-3. The design is what RC7-5 asked for:
- the warm is outside the settings read budget and joined with `allSettled`, so the settings result, `fromFailedRead` and `nextRefreshAt` stay as they are today;
- it is bounded at about 1.5 s and never throws;
- it is a no-op when the cache is fresh;
- nothing is added to the providers.

**Residual accepted.** Once a BOS call warms the instance, non-BOS calls on that instance also price from the rows. That state already exists today on any warm instance, and the rows are the authority (R-1). A BOS-only cache would be a second loader. Record the residual in the slice 8 note, next to item 3 ("non-BOS paths can still charge in-code prices on a cold server").

**C-1 (required): a refresh must not join an in-flight load.**
- **The problem.** With single-flight, `refreshPricingCache()` would join a read that started before slice 8's apply committed. That read returns the pre-apply rows, so the refresh does nothing on that instance.
- **The fix.** `refreshPricingCache()` always starts a new read, chained after any read in flight. That read is the new shared promise. A completion from an older read must never overwrite a newer one: use a generation counter, or assign only if this read is still the latest. `getPricingInternal`, `listPricedModels` and the warm may join an in-flight read.
- **Test.** A read is in flight, a refresh is issued, and both resolve in either order. The cache must end on the refresh's rows.
- **Images.** The same rule applies to the image cache once it is invalidated (RC7-4). A read that started before the invalidation must not mark the cache fresh.

**Rulings on the Dev's extra decisions**
1. **Yes, inside the RC7-6 class.** Adding `warmPricingCache: jest.fn().mockResolvedValue(undefined)` to the 10 `@/lib/ai/pricing` mock factories is a mock addition with no assertion edit. List the 10 files in the code review.
2. **Accept: on timeout, return the last loaded image prices.** They are the authority's latest known values. On a cold instance that is an empty map, which means the in-code fallback, as RC7-3 requires. Log the timeout at warn with the map's age.
3. **Accept: `.rpc(` is refused in read-only repositories.** This is stricter and matches "the writer is the RPC, through its own repository". The negative control is already in place.
4. **Fix the two type errors in T-6, as a type-only change.**
   - **How.** Narrow the provider returned by `ProviderFactory.getProvider(PROVIDERS.OPENAI)` to `OpenAIProvider`, using a type assertion with a one-line comment (CLAUDE.md rule 6 and the "fix TS errors anyway" gotcha). `getProvider('openai')` returns that same singleton.
   - **What stays.** Keep the `getProvider` call. `EmbeddingService.attribution.test.ts` spies on it, so switching to `getOpenAI()` would force a mock edit.
   - **Checks.** No runtime change. Confirm that `typecheck:bos-llm` and its baseline are unchanged. The file is not in the baseline today.
5. **Acceptable**, with three conditions:
   - **CI time.** Measure the shard that runs `chargeParity` in CI on the PR. That shard must still finish before Build. If it does not, move the suite to a shard that does: no new job, and the suite is never split by editing it.
   - **Where the time goes.** In the code review, give one line on what the 5–12 s is, probably transform and import cost. Do not tune the frozen file.
   - **The hash.** Re-hash with `git hash-object lib/ai/__tests__/chargeParity.test.ts`, or a sha256 of the LF-normalised content, never the raw Windows checkout. With CRLF the raw bytes differ between Windows and CI (the #394 pattern). Record which method produced `cdb1aeaf…`, and re-derive it that way if it was raw bytes.

**BQ-7a update.** The TL applied the embedding row through the emergency runbook on 2026-10-16: row `549fcc6e…`, $0.02 per 1M, no charge change. Record it in §1. P-2 and P-1d use that row (JSON number), and warm against cold stays bit-identical: 0.00000002 × 1000 must equal 0.00002 exactly. Dev asserts that with `toBe` in P-1d; it is not assumed.

**Proceed to T-3** once C-1 is in §3.6.

### SA Code Review — 2026-10-17

**Code Review by SA — 2026-10-17** (uncommitted tree on `feature/ai-model-price-review-slice7` at `ac674ceb`; read-only)
**Status:** ✅ Code approved, with one condition (F-1). F-1 is in the comparison only, not the charging path. QA may start once F-1 is in. SA does not re-review the whole slice: QA confirms the F-1 test, and SA glances at that diff in `comparisonModel.ts` at hand-off.

#### What SA verified

- **Frozen `chargeParity.test.ts`.** `sha256sum` = `cdb1aeaf7e18dbd88f6f5ce36c9e68c9811f6ba1c3483ff82c4d105ca56d5d6e` and `git hash-object` = `d1231341bf6ae57ce4a7fe15314a015ffcbff65e`. Both match the T-9 pins. The expectations are literals, and the reference formula (`todayChatCost`, `RATE`, `FLARE_USD`) uses literal rates. The live modules are `require`d only as the system under test, never for an expected value (RC7-8). Result: 21/21 against the slice 7 code (about 8.8 s alone).
- **Charges are bit-identical for today's DB state**, path by path:
  - *Tokens* (`openaiProvider` → `calculateCostWithCachedSync`). Every row has cached NULL, so `cachedInput` is never set. The function returns `calculateCostSync(p, m, prompt - cached + Math.round(cached / 2), completion)`, which is today's expression with the same operands in the same order. The clamp `Math.min(cachedInputTokens, prompt)` stays in the provider, unchanged. A miss warns once, from `calculateCostSync`.
  - *Warm against cold.* For gpt-4o and gpt-4o-mini, `Number(row) × 1000` equals the fallback (SA live check, RC7-5). The warm therefore changes the source of the price, not its value.
  - *Embeddings.* The provider charge goes down the same path with cached 0, so it is unchanged. The figure `EmbeddingService` reports is now `calculateCostSync(openai, model, prompt_tokens, 0)` = `(p / 1000) × 0.00002 + 0`. This equals the old `(total / 1000) × 0.00002`, because `prompt_tokens == total_tokens` for embeddings and `x + 0 === x`. The 2e-8 row gives `Number(2e-8) × 1000 === 0.00002` (P-1d, `toBe`).
  - *Images.* The table is empty and the setting is absent. The resolver therefore returns `IMAGE_FALLBACK_PRICING[key]`. The old code accepted any `typeof number` fallback, and the new code requires a value above 0. All 15 flare entries are above 0, so the two agree.
  - *Conservative rate.* `chargePricing.ts` is not edited, and G-1 pins its import set.
- **C-1.**
  - A refresh never joins a read in flight: `startLoad(inFlightLoad)` chains after it.
  - Reads are serialised. A new read starts only when nothing is in flight, or chained behind the read in flight. The generation check is defence in depth (F-4).
  - The cases are tested: in-flight then refresh, a refresh whose result is "ready first", a later lookup joining the refresh's read, and failures.
  - The image cache uses an epoch with the same chaining: a read that started before an invalidation is discarded and never marks the cache fresh. Tested in both orders.
- **The warm in `refill()`.**
  - It runs outside `withReadBudget`, under `Promise.allSettled`, bounded at `BOS_PRICE_WARM_WAIT_MS` = 1.5 s with an `unref`'d timer.
  - `startPriceWarm` survives a synchronous throw and a rejection, and both are tested. A settings failure still warms the cache (tested), and `fromFailedRead` is untouched.
  - Nothing is added to `baseProvider` or any provider.
  - Side effect: the snapshot's `loadedAt` and `nextRefreshAt` can now be stamped up to 1.5 s later on a cold refill. That is immaterial.
- **The image resolver.**
  - The order is table (above 0) → fallback (above 0) → `$0` + `unpriced`, and the service logs the error.
  - `loadImagePricesWithin` defaults to 2 s. On timeout it returns the last loaded map and warns with the map's age (ruling 2).
  - The guardrail loads the table lazily, through the context memo, only for a non-default image model (tested: 0 reads, then 1 read), within 1 s, and never rejects.
  - `pricesUsd` is gone from all three readers (G-4).
- **Comparison (RC7-7).** It reads fresh `listActiveExact` rows from both tables and uses the same selection rule and resolver as charging. `image_setting` is no longer produced, and an image line snapshots `current_row_id`. `comparisonTruth.test.ts` runs the real charging code on the same rows, and it is meaningful for OpenAI. See F-1 for the gap in it.
- **Guards.**
  - G-1..G-4 each have a negative control. G-4's is weak (F-3).
  - `chargingUntouched` is re-scoped in place. Its allow-list adds `imagePriceKey`, which is pure, so that is accepted. The method pin now covers both repositories, with a non-vacuity count.
  - `livePriceWrites` has the `READ_ONLY_REPOSITORIES` map. LW-1 exempts the repositories in that map, LW-2 runs per repository (`.rpc(` refused, ruling 3), and there is a negative control for the image repository.
- **Repository and tenant isolation.** `AiModelImagePricingRepository` is read-only. It takes an injected client and defaults to `supabaseServer` (the reason is in the header). It returns `RepositoryResult`, never throws, takes no caller-supplied filter, and uses Pino with `service`. Its UTC `effective_date` filter and its order match the token repository. It is exported from `index.ts`, and a unit test covers each method. There is no owner column, so it needs no `user_id` scope and no data-export descriptor. Its two caller classes are named, and the guards pin them.
- **`bos-llm-call-standards`.** No new AI call, catalog entry or model literal. The attribution, `withUsageScope` and ledger paths are unchanged, and P-1 covers the ledger `cost_usd` and the scope `costUsd`. `typecheck:bos-llm`: 549 files, 28 errors, **0 new**, and the baseline file is unmodified. The one "fixed" entry, `app/api/onboarding/build/route.ts`, is untouched by this slice: leave the baseline alone. No `console.*` appears in any touched source file.
- **Runs (SA, local).** 12 suites (parity, guards, slice 7 units, comparison, repository, image and embedding attribution): **242/242**.

#### Code Review Comments

1. **`lib/ai/pricing-research/comparisonModel.ts` `tokenCurrent` (~line 238): "current" claims a stored cached rate that is not charged for non-OpenAI providers. Priority: Medium. Required (F-1).**
   - **Why.** Only `openaiProvider` calls `calculateCostWithCachedSync`. `anthropicProvider` and `kimiProvider` call `calculateCostSync` and never read `cachedInput`. A cached rate stored on an Anthropic row (reachable in slice 8 through manual entry) would show on the review page as current with basis `table`, but would not be charged. That breaks RR-4 ("current = what we charge"). It has no effect today, because the column is all NULL.
   - **Fix.**
     - Gate the stored-rate branch on the provider that charges it: `if (provider === 'openai' && storedCached !== null && signOfDecimal(parseDecimal(storedCached)) > 0)`. Keep the `else if (provider === 'openai' && …)` derived branch as it is.
     - Update the header bullet: "cached input (OpenAI only, the one provider whose charge reads it): …; other providers: not compared".
     - Add one case to `comparisonTruth.test.ts`: an `anthropic` row with `cached_input_cost_per_token` set gives a `cached_input` unit that is not `table` (unpriced / not compared), and `calculateCostSync('anthropic', …)` ignores the column.
   - **Slice 8 note, item 1. TL relays this amendment.** The expected cached value becomes `CASE WHEN line.provider = 'openai' AND live.cached_input_cost_per_token > 0 THEN live.cached_input_cost_per_token WHEN line.provider = 'openai' THEN live.input_cost_per_token / 2 ELSE NULL END`. The apply UI must either refuse a cached rate for a non-OpenAI line, or label it "stored, not charged".
2. **`lib/ai/__tests__/chargeSources.guard.test.ts` header, and workplan §4 / RC7-9 wording. Priority: Low. Doc only (F-2).**
   - **Why.** The scan walks five directory trees recursively: 679 files, about 8.5 MB, about 1.8 s of I/O, and about 8.5 s per suite locally. `lib/repositories` was added, which G-2 and G-3 need. That is acceptable, but "no tree walk / under 100 ms" is not true.
   - **Fix.** Say "a fixed list of five directory trees (about 700 files)" in the header and in §4. Do not otherwise change the guard.
3. **`chargeSources.guard.test.ts` G-4 negative control. Priority: Low. Optional (F-3).**
   - **Why.** It matches a regex against a literal string, not against the rule.
   - **Fix.** Extract `readsRetiredSetting(text)`, use it in the G-4 tests, and give it a planted text, as G-2 and G-3 do.
4. **`lib/ai/pricing.ts` generation check. Priority: Low. No change (F-4).**
   - **Why.** Every read is chained, so the `generation < appliedGeneration` branch is unreachable today. The "ready first" test proves the ordering by chaining, not by the counter.
   - **Ruling.** Keep the counter as defence in depth. A one-line comment saying so is welcome, not required.
5. **Single-flight residual. Priority: Low. Slice 8 item, no change here (F-5).**
   - **Why.** A hung token read now holds every async lookup on that instance, and any `refreshPricingCache()` (chained behind it), until the fetch errors. Before, each caller issued its own read. The sync charge path and the warm (bounded) are unaffected.
   - **Slice 8.** Slice 8's apply route must bound its `refreshPricingCache()` (race it with a timeout) and claim only "in effect within 1 hour". TL adds this to the slice 8 note, item 3.

#### Rulings on the deviations (§10.1)

| # | Deviation | Ruling |
|---|---|---|
| D-1 | Two assertion edits in `comparisonModel.test.ts` | **Accepted.** O-3 and RC7-7 force them. The derived expectation survives in the new case. Both fixtures are OpenAI rows, so they stay valid after F-1 |
| D-2 | `calculateCostWithCachedSync` added to 8 `@/lib/ai/pricing` mocks | **Accepted, RC7-6 mock class.** Same value as each suite's `calculateCostSync` mock. No assertion changed |
| D-3 | `BOS_GUARDRAIL_IMAGE_PRICE_WAIT_MS` = 1 s | **Accepted.** It runs in parallel with the image config read and inside the 3 s refill budget. Only a non-default image model reaches it |
| D-4 | P-1d in `pricing.slice7.test.ts` | **Accepted.** Required by the frozen-file rule. `chargeParity` P-2 already charges the row warm and cold to the same literal |
| D-5 | `GuardrailContext.imagePrices` optional | **Accepted.** `newGuardrailContext()` always sets it, and the optional only serves a test literal. It still loads on demand |
| D-6 | `priceSource` `'config'` → `'table'` | **Accepted** (pre-approved by RC7-6). It must appear in the PR description for anyone filtering logs |

#### Optimisation Suggestions

- **CI time (ruling 5).** The Jest gate assigns suites to its 3 shards with `--shard` (by path hash, `maxWorkers=4`), so a suite cannot be placed by hand without a config change. Measure the shard that runs `chargeParity` on the PR, and act only if that shard finishes after Build. Where the time goes: module transform and import across about 11 `jest.isolateModules` registries. The test bodies take milliseconds. Do not tune the frozen file.
- **Local CRLF failures.** `openaiPricingAdapter` and two onboarding guards fail locally on CRLF, the known #394 pattern. They are untouched by this slice. CI on LF is the authority.

#### Code Approved for QA: Yes, after F-1

QA must also:
- re-hash `chargeParity` (`git hash-object`);
- confirm P-7: `git diff 98735db9 -- lib/ai/pricing.ts` changes nothing inside `FALLBACK_PRICING`, and `IMAGE_FALLBACK_PRICING` values are byte-identical (the comment-only header is fine);
- run the full Jest gate.

### SA hunk check — 2026-10-17

**Status:** ✅ Approved for QA and commit, with no further fixes. I checked only the diffs (branch at origin/main `e5bc1e1f`, uncommitted).

1. **F-1: done as specified.**
   - `tokenCurrent` counts the stored cached rate only when `provider === 'openai'`, and the derived branch is unchanged. The header bullet is updated.
   - `comparisonTruth` has an anthropic row with a cached rate. Its `cached_input` unit is `unpriced` (not `table`), and `calculateCostSync('anthropic', …)` charges at the input rate.
   - TL still relays the slice 8 note amendment (F-1 CASE, F-5 bounded refresh).
2. **QA M10 `startPriceWarm` bound: approved.**
   - It never throws or rejects. A synchronous throw returns at once, and the race is between a promise that has a `.catch` and a timer that only resolves.
   - The timer is `unref`'d and cleared in `finally`.
   - Normal path: the warm settles first, so `refill` waits exactly as before. Settings, `fromFailedRead` and `nextRefreshAt` are untouched.
   - Hung warm: `refill` returns at 1.5 s, inside the 3 s settings budget, and the read keeps running.
   - Charging is unaffected: the bound only stops `refill` waiting, and the shared read still lands.
   - The fake-timer test uses explicit `advanceTimersByTimeAsync` steps (not `advanceTimers: true`, #399), and checks both sides of the boundary.
3. **F-2 / F-3 / F-4: done.**
   - The guard header and §4 say "five directory trees (about 700 files)". The original RC7-9 text in the SA section is left as the historical record.
   - `readsRetiredSetting(text)` is the G-4 rule. It is tested on planted text for both settings and on stripped comments.
   - The BACKSTOP comments are in `pricing.ts` and `imagePricing.ts`.
4. **Frozen suite.** sha256 is `cdb1aeaf…5d6e` and `git hash-object` is `d1231341…`, both unchanged. The 7 affected suites, including `chargeParity`, pass 170/170 (SA local run).

---

## QA Testing Report

**QA — 2026-10-17**
**Test mode:** full (money path)
**Strategy used:** A + B (Jest re-runs, mocked repositories) and C (a separate scratch Jest probe that loads origin/main code and branch code from `git archive` exports, plus 19 mutants run on a scratch copy). This is a pricing change with no UI, so suite re-runs, mutation checks and a bit-for-bit comparison against main are the strongest proof.
**Focus:** api, schema, performance (pricing, charging, cache)
**Skipped:** browser check (none possible before deploy; listed under the manual checks below). `typecheck:bos-llm` and ESLint were not re-run (the Dev's and SA's figures stand)
**Input source:** prompt keywords (TL brief), plus the three checks SA asked of QA at code review

**Tree tested:** the uncommitted tree with the **pre-F-1** comparison code. SA's F-1 (Code Review comment 1) is **not yet implemented**: `tokenCurrent` still accepts a stored cached rate for any provider. Every source file was byte-compared (CR stripped) with the QA export after the runs, and none had changed.

All work was done read-only in the worktree. Mutants and probes ran only on scratch exports. Nothing was installed, stashed, staged or committed, and nothing was written to the DB. Main base = `ac674ceb`. `origin/main` is now `fdaf90c1`; its extra commits touch only `BusinessDataExportRepository` and its test, with no pricing overlap.

### Step 1: re-runs (local, Windows)

| Run | Result |
|---|---|
| `chargeParity.test.ts` | ✅ 1/1 suites, **21/21** |
| `lib/ai` | 25/26 suites, 457/463 (6 = `openaiPricingAdapter`, CRLF, see below) |
| `lib/ai/pricing-research` | 15/16 suites, 305/311 (the same 6) |
| `lib/business-os/llm` | ✅ 23/23, 635/635 |
| `lib/services` | ✅ 44/44, 680/680 |
| `lib/repositories` | ✅ 102/102, 2400/2400 |
| `app/admin/system-config` | ✅ 10/10, 145/145 |
| `app/api/admin/model-pricing` | ✅ 3/3, 51/51 |
| `supabase/migrations` | ✅ 43/43, 2322/2322 |
| `npm run test:bos-entitlements` | ✅ 281/281, 8470/8470 |
| `npm run test:bos-llm` | ✅ 23/23, 635/635 |
| `npm run test:authz-guard` | ✅ 2/2, 203/203 |
| Tailwind guard | ✅ 1/1, 6/6 |
| **Full Jest gate** (`jest.gate.config.js`, SA's request) | 1468/1477 suites; 37268 passed, 18 failed, 34 skipped. **None of the failures comes from this slice:** 13 are CRLF and 5 are Windows-only (see below) |

**Proof that the 9 failures the Dev reported come from CRLF and not from this slice:**
- **Not touched by the slice.** None of the files these suites read is in the slice's diff: `__fixtures__/openai-pricing-2026-10-14.md`, `app/api/onboarding/build/route.ts`, `OnboardingConversationManager.ts`, `OnboardingConfigurationService.ts`.
- **CRLF only on this machine.** `git ls-files --eol` shows all four as `i/lf w/crlf`: LF in the index, CRLF in this Windows checkout (`core.autocrlf=true`). The blob of `route.ts` has 0 CR bytes, counted by Node.
- **Pass with LF line endings.** All three suites pass on an LF `git archive` export:
  - export of `ac674ceb`: 3/3 suites, 79/79;
  - the same export with the slice 7 files laid over it: 3/3, 79/79.
- **Fail with CRLF.** In the worktree the same suites fail 6 + 3, as the Dev reported.
- **CI sees LF.** `.gitattributes` sets no `text` attribute for these paths (it has `eol=lf` only for `*.sh`, workflows and the cleanup SQL), and Linux CI has no autocrlf, so CI checks out the LF blobs.

**The other gate failures:**
- **4 more CRLF failures.** Three `components/crm/contact-drawer` guards fail 2 + 1 + 1 in the worktree and pass on the LF branch export.
- **5 Windows-only failures.** `publicEndpointsAreThrottled` (3: the Windows backslash path separator in the `app/api/...` paths), `supabaseFetch` (1) and `oneAddressPolicy` (1). They fail identically on the LF export of `ac674ceb` and on the main checkout (`e49a4719`), so they exist on main and are unrelated to pricing.

### Step 2: mutants (scratch export of the branch; 40 suites, 922 tests; baseline 40/40 green)

| # | Mutant | Caught? | By |
|---|---|---|---|
| M01 | Cached rate 0 used (O-5) | ✅ | `pricing.slice7` ×2, `comparisonTruth` |
| M01b | Comparison: a stored 0 counted as set | ✅ | `comparisonTruth` |
| M02 | NULL cached rate gets a derived rate for non-OpenAI rows (charging) | ⚠️ survived, **equivalent** | Only `openaiProvider` calls `calculateCostWithCachedSync`, and other providers call `calculateCostSync`, which ignores `cachedInput`. No charge can change today. This is the same fact behind SA's F-1 |
| M02b | Comparison: derived half for non-OpenAI | ✅ | `comparisonModel` (O-8 case) |
| M03 | Derived 50% → 60% | ✅ | `chargeParity` ×4, `openaiProvider.priceStatus` ×2, and the QA bit-identical probe (600 of 1479 figures differ) |
| M04 | Image resolver prefers the in-code price over the table | ✅ | `imagePricing`, `GeneratedImageService.attribution` ×3, `callParams.boundary.step3` |
| M05 | Charging re-reads `image_generation_prices_usd` | ✅ | `GeneratedImageService.attribution` ×2, `step3`, `chargeSources.guard` G-4 |
| M06 | $0 instead of the fallback on a table miss | ✅ | 6 suites, 24 tests (incl. `chargeParity` P-3, `priceCoverage`) |
| M07 | Refresh joins the in-flight read (C-1) | ✅ | `pricing.slice7` ×4 |
| M08 | An older token read may overwrite a newer one (generation check removed) | ⚠️ survived, **equivalent** | Reads are always chained and never overlap, so the check cannot fire. SA F-4 agrees: keep it as defence in depth |
| M08b | An image read that began before an invalidation may apply | ⚠️ survived, **equivalent** | The read is chained the same way. `isFresh` also requires `pricesEpoch === epoch`, so an older read can never mark the cache fresh |
| M09 | A warm rejection reaches `refill` (`Promise.all`) | ✅ | `modelSettings` ×8 |
| M09b | `warmPricingCache` throws | ✅ | `pricing.slice7` ×5 |
| M10 | Warm moved inside the settings read budget | ❌ **survived** | No test hangs the warm while it runs inside `refill`. Edge case 1 |
| M11 | The FR-12 conservative rate reads the DB through `calculateCostSync` (G-1) | ✅ | `chargeSources.guard` G-1, `chargeParity` P-6 |
| M12 | `EmbeddingService` reports a different rate than the ledger | ✅ | `chargeParity` P-2 |
| M12b | `EmbeddingService` uses `total_tokens + 1` | ✅ | `chargeParity` P-2 |
| M13 | Comparison "current" ignores the cached column | ✅ | `comparisonTruth`, `comparisonModel` ×2 |
| M13b | Comparison image "current" ignores the table | ✅ | `comparisonTruth` ×2 |

**Result:** 15 of 19 caught. Three survivors are equivalent (M02, M08, M08b). One is a real test gap with low risk (M10).

### Step 3: bit-identical proof (independent of the Dev's tests)

- **Setup.** One scratch Jest probe ran once against an LF `git archive` export of `ac674ceb` and once against the same export with the slice 7 files laid over it.
- **DB fake.** 43 active `ai_model_pricing` rows, all with cached NULL:
  - `gpt-4o`, `gpt-4o-mini` and `text-embedding-3-small` `549fcc6e…` at `0.00000002` / 0, as JSON numbers;
  - 40 rows for other models. The lookup matches keys exactly, so these rows cannot affect the models tested.
- **Other state.** No image rows; the image price setting absent (main got `{}`, the branch the table it loaded); the embedding setting at 0.00002.
- **The real code paths:**
  - tokens: `OpenAIProvider.calculateCost`, cold, then warm after the 43 rows load (`getCacheStats().size === 43` was asserted);
  - images: `imagePriceResolver(...).priceFor`;
  - embeddings: `EmbeddingService`'s reported figure.
- **Inputs:**
  - `gpt-4o-mini` and `gpt-4o`: prompt 0/1/7/333/1200/1201/4097/99999 × cached 0/1/3/151/301/512/1023/=prompt/prompt+5 (the clamp) × completion 0/1/149/150/2049, plus usage missing, usage empty and no `prompt_tokens_details`;
  - embedding: 0/1/37/8191/12345/100001 tokens, charge and reported figure;
  - `gpt-image-2.5-flare`: 3 sizes × low/medium/high/xhigh/max × requested `auto`/same/`low`, plus quality unreported, an unknown quality and an unknown model.
- **Result: 1479 figures, 0 differences** (`===` and identical float64 bits). Warm equals cold in both versions for every figure. `conservativeRateDerivation()`, `inCodeTokenPrices()` and `IMAGE_FALLBACK_PRICING` are deep-equal between the two versions.
- **Sensitivity.** With M03 applied, the same probe reports 600 differences, so the probe does detect a change.

### Step 4: static checks

| Check | Result |
|---|---|
| `console.*` in the 36 changed or new `.ts` files | ✅ 0 |
| Backslash followed by a hex digit in the 3 touched docs | ✅ 0 |
| `lib/business-os/llm/chargePricing.ts`, `chargeClassification.ts`, `AiModelPricingRepository.ts` | ✅ no diff from `ac674ceb` or `98735db9`, not in `git status` |
| In-code price values (P-7, SA's request) | ✅ `git diff 98735db9 -- lib/ai/pricing.ts`: no hunk inside the `FALLBACK_PRICING` body; the only nearby change is the comment block added above it. Every `SystemConfigRepository.ts` hunk is a comment line. `inCodeTokenPrices()` and `IMAGE_FALLBACK_PRICING` are deep-equal at runtime (step 3) |
| `chargeParity.test.ts` frozen hash (SA's request) | ✅ raw sha256 = LF-normalised sha256 = `cdb1aeaf7e18dbd88f6f5ce36c9e68c9811f6ba1c3483ff82c4d105ca56d5d6e`; `git hash-object` = `d1231341bf6ae57ce4a7fe15314a015ffcbff65e` (both match §5.1) |

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Every charge identical today (tokens, cached, embeddings, images) | ✅ | Pass | 1479/1479 bit-identical; `chargeParity` 21/21 |
| Cached input from the DB when > 0; 0, NULL and NaN fall back to the derived rule (O-2, O-5) | ✅ | Pass | M01, M03 caught |
| Images: table, then fallback, then $0 + unpriced; setting dropped (O-1, BQ-7b) | ✅ | Pass | M04, M05, M06 caught |
| Conservative rate stays in-code (FR-12, G-1) | ✅ | Pass | M11 caught; P-6 |
| `EmbeddingService` figure equals the ledger (RC7-10) | ✅ | Pass | M12, M12b caught |
| Refresh never joins an in-flight read (C-1) | ✅ | Pass | M07 caught; generation and epoch checks are unreachable backstops |
| Warm bounded, never throws, never degrades settings (RC7-5) | ⚠️ | Partial | M09 and M09b caught; "outside the settings budget" is not pinned (M10) |
| Comparison "current" equals what is charged (RC7-7, RR-4) | ⚠️ | Partial | M13 and M13b caught for OpenAI. For non-OpenAI cached rates it is wrong until SA F-1 lands (no effect today: the column is all NULL) |
| No new failures in neighbouring suites or the full gate | ✅ | Pass | All 18 gate failures are CRLF or Windows-only and also fail on main |

### Issues Found

#### Bugs (must fix before commit)
1. **SA F-1 is still open: the comparison shows a non-OpenAI cached rate as current, but that rate is never charged.** File: `lib/ai/pricing-research/comparisonModel.ts`, `tokenCurrent`. Severity: **Medium**. It is SA-required; this path is the comparison, not charging, and has no effect today.
   - **Steps to reproduce:** give an `anthropic` row `cached_input_cost_per_token` > 0.
   - **Expected:** no `table` cached current, because `anthropicProvider` charges through `calculateCostSync`, which ignores the column.
   - **Actual:** the comparison reports a current cached rate with basis `table`.
   - **Fix:** as specified in SA comment 1. QA must then re-run `comparisonTruth`, `comparisonModel`, `chargingUntouched.guard` and `chargeParity` (re-hash), and confirm the new F-1 case fails if the provider gate is removed.

#### Performance Issues (should fix)
None found. The first Business OS call on a cold instance waits up to the longer of the settings read and the 1.5 s warm bound, as designed in §3.6. SA's F-5 (a hung token read holds the async lookups on that instance) is a slice 8 item.

#### Edge Cases (nice to fix)
1. **Test promised in §3.6 is missing: "a hung read → `refill` returns its settings within the settings budget".** Only the warm's own bound is tested (`pricing.slice7`). No `modelSettings` test gives `warmPricingCache` a promise that never settles. As a result, mutant M10 (the warm moved inside `withReadBudget`) passes all 922 tests. Today this is harmless, because the real warm returns within 1.5 s, inside the 3 s budget. The SA condition "outside the budget" is still unpinned. Suggested fix: a `modelSettings` case with `warm.mockReturnValue(new Promise(() => undefined))` asserting that the settings resolve and `fromFailedRead` is false. File: `lib/business-os/llm/__tests__/modelSettings.test.ts`. Severity: Low.
2. **The generation counter (tokens) and the epoch discard (images) cannot be reached** (M08, M08b; SA F-4). Keep them as a backstop. The C-1 test titles "ready first" overstate what they prove. Severity: Info.

### Manual checks for the user after deploy
1. **Admin AI activity view.** Business OS charges for chat, insights, website, intake and onboarding look the same as before deploy for comparable calls (same models, similar token counts).
2. **Image generation.** One image charges as before: for `gpt-image-2.5-flare` at 1024x1024 high, $0.054 (0.212 at max). The log's `priceSource` now reads `fallback` (the `config` value is gone).
3. **Model pricing page.** The "ours" column now shows cached input from the table where a row sets it; today every row is NULL, so it still shows the derived half. Image values show basis `in_code_fallback` until an image row is approved; after that they show `table`.

### Test Outputs / Logs
```text
chargeParity: Test Suites: 1 passed, 1 total / Tests: 21 passed, 21 total
full gate: suites 1468/1477, tests 37268/37320 passed, 18 failed (13 CRLF, 5 Windows-only, all fail on main too)
LF export ac674ceb (adapter + 2 onboarding guards): 3 passed / 79 passed
LF export branch    (same 3):                         3 passed / 79 passed
bit-identical: keys main 1479 branch 1479 compared 1479 differences 0
  conservativeRateDerivation equal: true; inCodeTokenPrices equal: true; IMAGE_FALLBACK equal: true
  warm!=cold count (either version): 0
  probe sensitivity (M03 applied): 600 of 1479 differ
mutants: 15/19 caught; survivors M02, M08, M08b (equivalent), M10 (test gap)
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit. **The charging path passes QA:** every charge is bit-identical to main. The one blocker is SA's required F-1 in the comparison, after which QA re-runs the four suites named under Bug 1. Edge case 1 is optional

---

## Commit Info

_(RM to populate.)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan written | Live read-only snapshot; design for cached input, images, embeddings; guard plan; proof table P-1..P-7; O-1..O-7; BQ-7a, BQ-7b. No code |
| 2026-10-16 | SA conditions folded; user decisions; merge | RC7-1..RC7-14 folded into sections 1-10. Changes: RC7-5 design written as §3.6 (awaiting SA confirmation); RC7-1 origin/main `ac674ceb` merged (fast-forward); BQ-7a "write it now", satisfied by TL via the runbook (row `549fcc6e-…`, no migration in this slice); BQ-7b yes. Embedding facts updated: an active row now exists, bit-identical to the fallback. Task order: T-9 first |
| 2026-10-16 | T-9, T-1, T-2 done | `chargeParity` frozen: 21/21 on the unmodified tree, hash in §5.1. Image repository and RC7-2 guard map (T-1). Image price module and shared TTL (T-2). Stopped before T-3, pending SA confirmation of §3.6 |
| 2026-10-17 | SA confirmed RC7-5 with C-1; T-3..T-13 done | Shipped: the C-1 ordered refresh (tokens and images); the warm on the settings refill; cached input from the row; the shared image resolver in the service, the guardrail and the comparison; the image setting dropped (O-1, BQ-7b); the `EmbeddingService` figure equal to the charge, with its type errors fixed; `chargeSources.guard`; `chargingUntouched.guard` re-scoped. `chargeParity` is still 21/21 with both hashes unchanged. Deviations for SA are in 10.1 |
| 2026-10-17 | SA code review | Approved with one condition (F-1: comparison cached-input "current" only for OpenAI, plus a slice 8 note amendment). F-2..F-5 low. Deviations D-1..D-6 accepted. Hashes verified, 242/242 locally, `typecheck:bos-llm` 0 new |
| 2026-10-17 | SA code review and QA fixes | F-1: the comparison shows a stored cached rate only for OpenAI, with a new truth case proved to bite. F-2: guard wording. F-3: `readsRetiredSetting` rule. F-4: backstop comments. QA M10: the warm is bounded in `refill` too, with a hung-warm test proved to bite. M08 and M08b titles corrected. PR notes added (D-6). origin/main merged |
