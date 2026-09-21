# Workplan: Business OS LLM — Layer 2: Model Settings per Area

> **Last Updated**: 2026-09-20

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md): 18 FRs (FR-9 deferred), 16 ACs. Approved; SA RC-1 to RC-12 applied; user answers BQ-1 (approved as written, onboarding never switchable) and BQ-2 (yes, Step 0 in this layer, ships first).
**Context:** [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md); the Layer 1, 1.5 and 3 requirements; the `bos-llm-call-standards` skill; the Layer 3 workplan [BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md) (format and its Step 0 precedent).
**Branch:** Step 0 was built on `feature/business-os-llm-layer2-model-settings` (worktree `neuronforge-llm-layer15`, off `main` `e35c83d4`) and is **merged to `main`**. **Step 1 is on `feature/business-os-llm-layer2-step1`** (worktree `neuronforge-llm-layer2-step1`, off `main` `ba25fb9a`). Each step is its own PR (see §9 release mechanics).
**Date:** 2026-09-19
**Status:** **Step 0 merged and deployed. Step 1 code complete (uncommitted, in its own worktree); SA code review + QA done, all S1-1 … S1-12 and D-Q1 … D-Q8 fixed; SA re-check ✅ approved with one must-fix (R-1, the read budget), see "SA Re-check — Step 1".** Step 1 ships the machinery only — **no call site changes behaviour** and nothing calls the resolver. The seed migration file is written and **NOT applied** (§9 P-1 … P-5b). Steps 2–4 not started. SA APPROVED WITH CHANGES (§15); RC-W1 to RC-W11 and the Q-1 to Q-12 rulings are applied in the body below.
**Open items waiting on the user:** (1) the final live QA off/on check for lead-reply and chat AI on the live system, since no test environment exists yet (§6.5, §7.5, AC-13): **pending user decision**. (2) Converting the 2 `console.error` calls in `app/business-os/website/page.tsx` in Step 3 (§12): **pending user OK**.

## Overview

Layer 2 moves every catalogued Business OS AI call's model, provider, temperature and on/off switch into one JSON row per area in `system_settings_config` (`bos_llm_area_<area>`, eight rows). A server-only resolver reads the eight rows once a minute. It applies guardrails (price coverage, allowed provider, temperature bounds, reasoning-model rules) and code-owned locks, and resolves each field in the order call override → area value → code default. Before any row exists, Step 0 closes the unauthenticated settings and pricing admin routes.

The layer ships in five PRs. **Each is a zero-behaviour-change deploy.** The seed copies what runs today, including any values stored under the old single-purpose keys, and it is applied between Step 1 and Step 2. The code that reads the rows deploys only after that.

This workplan:
- checks the requirement's citations against `e35c83d4` and lists 14 new findings (§2). Three change the design: analysis also sends `frequency_penalty`; the reasoning-model family is not the `max_completion_tokens` family; a stored single-purpose value that fails a guardrail would change behaviour on the seed;
- sets out the design (§3), each step with files, tasks, tests, gates and rollout (§4 to §8), the release mechanics (§9), the before/after parameter snapshot (§10), traceability (§11), `console.*` flags (§12), risks (§13) and questions for SA (§14, all resolved).

SA's review (§15) widened N-3: the seed must reproduce what today's boolean and string readers return, not just what the stored value looks like. So the apply order now has a canonical-value stop at P-3 and a legacy-vs-resolver equivalence check at **P-5b** (RC-W1).

## Table of Contents

1. [Traceability (FR → step)](#1-traceability-fr--step)
2. [Code-Reality Check](#2-code-reality-check)
3. [Design](#3-design)
4. [Step 0 — Secure the settings and pricing routes](#4-step-0--secure-the-settings-and-pricing-routes)
5. [Step 1 — Policy, schema, resolver, retry, change script, seed file (inert)](#5-step-1--policy-schema-resolver-retry-change-script-seed-file-inert)
6. [Step 2 — Wire the non-chat areas](#6-step-2--wire-the-non-chat-areas)
7. [Step 3 — Chat, chat gates, images, the ★ messages](#7-step-3--chat-chat-gates-images-the--messages)
8. [Step 4 — Literal check and docs](#8-step-4--literal-check-and-docs)
9. [Release Mechanics and Apply Order](#9-release-mechanics-and-apply-order)
10. [Per-Call Parameter Snapshot (zero behaviour change)](#10-per-call-parameter-snapshot-zero-behaviour-change)
11. [AC Traceability](#11-ac-traceability)
12. [`console.*` in Touched Files](#12-console-in-touched-files)
13. [Risks](#13-risks)
14. [Questions for SA](#14-questions-for-sa)
15. [SA Review Notes](#15-sa-review-notes)
16. [QA Testing Report](#16-qa-testing-report)
17. [Commit Info](#17-commit-info)

---

## 1. Traceability (FR → step)

| FR | What | Step | Tests (§4–§8) |
|---|---|---|---|
| FR-1 | Admin-only settings and pricing routes; repository switch; Zod; Pino; refuse `bos_llm_area_*`; live RLS check | 0 | T0-1 … T0-6 |
| FR-2 | One row per area, `bos_llm_area_<area>`, category `business_os_llm` | 1 (schema, seed file); seed applied after Step 1 | T1-1, T1-9 |
| FR-3 | Policy module: defaults, switchability, allowed providers, temperature bounds and locks; typed against the catalog | 1 | T1-2 (type-level), T1-3 |
| FR-4 | "Not set" temperature; absent inherits, `null` sends none | 1 (resolver); 2 (onboarding sites) | T1-4, T2-S |
| FR-5 | One resolver, field by field; fixed-key read; never throws | 1 | T1-4, T1-5 |
| FR-6 | Fallback to today on missing / invalid / unreadable | 1 | T1-5 |
| FR-7 | Guardrails incl. `hasPricing`, image price coverage, reasoning models | 1 | T1-6, T1-7 |
| FR-8 | Locks (onboarding, planner) | 1 | T1-8 |
| FR-9 | Deferred (RC-8) | — | — |
| FR-10 | 60 s cache, 10 s retry on failure | 1 | T1-10 |
| FR-11 | One retry with the default on a classified model-not-found, inside `runAiAction`; negative cache | 1 (helper); 2, 3 (used at sites) | T1-11, T2-R |
| FR-12 | Every catalog call uses the resolved settings; chat v1/v2 entry gates | 2, 3 | T2-S, T3-S, T3-G |
| FR-13 | Record the model that ran (intake `generated_from.model`, insights ledger `model_name`, planner `diagnostics.model` incl. repair attempts, image price key) | 2 (intake, insights), 3 (planner, images) | T2-M, T2-M-I, T3-M, T3-S |
| FR-14 | "Off" per the table; three languages; image model into the images row | 2, 3 | T2-O, T3-O |
| FR-15 | Literal check in the existing CI job | 4 | T4-1 |
| FR-16 | Seed migration, zero behaviour change, apply order (incl. P-3 canonical stop and P-5b equivalence, RC-W1), old keys marked superseded | 1 (file, script modes), §9 (apply) | T1-9, T1-13b, §10, AC-13 |
| FR-17 | Change tracking: change script (validated; refuses locked fields; `--include-calls`), change-seen info log, route refusal | 0 (refusal), 1 (script, log) | T0-2, T1-12, T1-13 |
| FR-18 | Skill, investigation, roadmap, KI-C, runbook | 4 | review |

---

## 2. Code-Reality Check

Checked against `e35c83d4` on 2026-09-19.

### 2.1 Citations that hold

- `app/api/admin/system-config/route.ts` has GET, PUT and POST, no auth, a module-level service-role `createClient`, `error.message` returned in every 500, **7** `console.*` calls (F-1, V-10).
- `pricing/route.ts` has GET/PUT/POST/DELETE, direct Supabase on `ai_model_pricing`, **12** `console.*`, `error.message` leaks. `pricing/sync/route.ts` has POST, **0** `console.*` (it already uses Pino), and `error.message` leaks at `:447`.
- The only caller of any of them is `app/admin/system-config/page.tsx`: GET `:143`, pricing GET `:193`, pricing PUT `:291`, pricing sync `:334`, settings PUT `:410` (`{ updates: { payment_grace_period_days } }`). **Nobody calls settings POST, pricing POST or pricing DELETE** (grep over `.ts/.tsx/.js/.sh/.py`).
- The admin-check precedent is `app/api/admin/business-os/llm-usage/route.ts:49-64`: `getUser()` → 401 → `AdminAccessService.getInstance().isAdmin({ id, email })` inside try/catch (fail closed) → 403. Its test is `app/api/admin/business-os/llm-usage/__tests__/route.test.ts`.
- Inventory rows: every model/temperature literal is where the requirement says (§10 lists each with its line). `complete()` omits `temperature` when it is `undefined` (`providerFactory.ts:342-344`).
- `hasPricing(provider, model)` exists (`lib/ai/pricing.ts:280`) and loads the DB prices into the module cache (1 h TTL).
- `IMAGE_GENERATION_CONFIG_DEFAULTS.model = 'gpt-image-1'` and `IMAGE_FALLBACK_PRICING` (gpt-image-1 × 3 sizes × 3 qualities) are in `SystemConfigRepository.ts:46-78`.
- `callWithTracking` rethrows the original error after a 0-token failed ledger row (`baseProvider.ts:150-192`), so the classifier can read `error.status` / `error.code`.

### 2.2 New findings

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **N-1** | **Chat `analysis` also sends `frequency_penalty: 0.3`**, not only the planner | `AnalysisService.ts:135` | RC-11's "a call that sends `frequency_penalty` rejects a reasoning model" applies to analysis too. The policy records `sendsSamplingPenalty` per call; planner and analysis both set it (Q-3) |
| **N-2** | **The reasoning-model family is not the `max_completion_tokens` family.** `usesMaxCompletionTokens` covers `gpt-4.1*`, which accepts `temperature`. It is also a **private** method | `openaiProvider.ts:134-141` | A separate exported `rejectsSamplingParameters(model)` beside it, with its own list (`gpt-5*`, `o1*`, `o3*`, `o4*`). `gpt-4.1*` is not in it (Q-4, approved). **SA found an `o1` gap (RC-W5):** `o1*` is not in `usesMaxCompletionTokens`, so it would get `max_tokens` and a non-retried 400. Fix in §3.3 |
| **N-3** | **A stored single-purpose value that fails a guardrail would change behaviour on the seed.** For example, if `image_generation_model` holds a model not priced at every size and quality, or `lead_reply_recommender_model` holds an unpriced model, the resolver would reject the seeded value and fall back to the code default. Today that value runs | DEC-6 + DEC-7 | The pre-apply check (§9, P-3) runs the guardrail over the stored values. On any failure: stop and escalate. Never seed silently. **Wider than stated (SA, RC-W1):** today's readers do not match the seed's unwrap rules. Leads' `getBoolean` gives `false` for any string other than `'true'`; analysis's `getBoolean` gives `false` for such a string and `Boolean(value)` for other types (`0` = off); model keys are `String(value)` with no trimming. The seed would map `"no"`, `"0"` or `0` to NULL → default `true`, **switching an off feature back on**. So P-3 also stops on any non-canonical value, and P-5b compares the legacy readers with the resolver after the seed (§3.6, §9) |
| **N-4** | **Images already have an "unavailable" message in all three languages**: `media.generate.unavailable` = "Image generation is not available right now." The UI maps `reason` → `t('media.generate.<reason>')` | `LanguageContext.tsx:3044` (+ es, he); `MediaLibraryPicker.tsx:207-211`; `GeneratedImageService.ts:212, 287` | Images off returns the existing `reason: 'unavailable'`. No new string, and `LanguageContext.tsx` (8 `console.*`) is not touched (Q-6, approved by SA) |
| **N-5** | **The website page swallows `regenerate` and `enhance-testimonial` failures** (it only logs them). "The message next to the button" needs new page state | `app/business-os/website/page.tsx:2912-2922`, `:3370-3375` | Step 3 adds an `aiUnavailable` notice state and three `LABELS` strings (en/es/he) in the page's own `LABELS` map (`:294`, `:472`, `:650`) |
| **N-6** | **The chat mutate path creates the landing page before generating it** | `MutateExecutor.ts:807-835` | "No page is overwritten" is met either way. **SA ruling (Q-7 reversed, RC-W3):** keep creating the page (the owner already confirmed the write; the in-code precedent at `:804-805` is "the page exists … better than refusing"), skip generation, and reply with the preview link plus the translated sentence. The off check lives in one place, `generateWebsite`'s `onAiDisabled` option (§3.8) |
| **N-7** | **Chat v1 and v2 do not know the reader's language at entry** (v2's body has no `language`; v1 detects it from the model's output) | `chat-v2/route.ts:74-90`; `chat/route.ts:116, 199` | When chat is off, the gate reads the profile language through `businessProfileRepository` (only on the off path). The message map sits next to chat-v4's `CHAT_ERRORS` in a shared server module |
| **N-8** | **Adding a catalog import to `SystemConfigRepository` would pull it, and every importer, into the `typecheck:bos-llm` scope** (scope = catalog importers + their importers) | `scripts/typecheck-bos-llm.ts:30-57` | The resolver passes the eight keys to the **existing** `getByKeys`. The repository gains no catalog import. The policy module **references** `IMAGE_GENERATION_CONFIG_DEFAULTS.model` rather than the reverse (RC-12's "referenced from" branch). **Correction (SA, RC-W9):** `lib/business-os/llm/` is a CORE dir (`typecheck-bos-llm.ts:76`), so any **caller** of it joins the scope whatever the callee imports: `scripts/bos-llm-settings.ts` in Step 1, and chat v1/v2 routes in Step 3. The `--list` diff is recorded at every step (§5.4, §7.4) |
| **N-9** | **`SystemConfigRepository.set` does not invalidate `SystemConfigService`'s 5-minute in-process cache**, which `SystemConfigService.set` did | `SystemConfigService.ts:281`; `SystemConfigRepository.ts:259-313` | After Step 0, a PUT through the admin page takes up to 5 min to reach readers that use `SystemConfigService` **on the same instance**. The only key the page PUTs, `payment_grace_period_days`, is read directly (`stripe/webhook/route.ts:373`), so there is no practical effect. Recorded as a deviation; **accepted by SA (Q-2)** |
| **N-10** | `pricing/sync` `POST()` takes no `request`, so it has no correlation id | `pricing/sync/route.ts:25` | Signature becomes `POST(request: NextRequest)` |
| **N-11** | The image price guardrail needs the configured sizes and prices, which live in four other keys | `getImageGenerationConfig` | On refill, `getImageGenerationConfig()` is called **only when** the resolved image model differs from the code default. So in the seeded state there is still one query a minute (Q-5, approved; with RC-W7(b) a model equal to the default skips the check) |
| **N-12** | **Leads reads its two keys on every call today, uncached** | `LeadReplyRecommender.ts:95-98` | After Layer 2 a change takes ≤ 60 s instead of the next call. DEC-8 accepts this; noted for QA's AC-13 timing |
| **N-13** | `hasPricing` → `getPricingInternal` logs `console.log('ℹ️ Using fallback pricing …')` on every fallback hit | `pricing.ts:185` | Up to one line per configured model per refill per instance. `pricing.ts` is used read-only and is **not** touched here; its 9 `console.*` belong to the tracked RC-10b follow-up |
| **N-14** | `app/admin/system-config/page.tsx` needs **no change**: response shapes stay the same, and the page only checks `response.ok` | `:143-150`, `:410-420` | "Verify only"; its 20 `console.*` are flagged, not converted (§12) |

---

## 3. Design

### 3.1 Files under `lib/business-os/llm/` (new, server-only)

| File | Imports | Purpose |
|---|---|---|
| `modelSettingsPolicy.ts` | `callCatalog` (types + `BOS_LLM_AREAS`), `IMAGE_GENERATION_CONFIG_DEFAULTS` (reference only) | **The only place a model name or temperature is written for catalogued calls** (FR-3, FR-15 exemption). Holds `BOS_LLM_CALL_POLICY`, `BOS_LLM_SETTINGS_EXCLUDED_CALLS` (the four chat embeddings, DEC-3), `bosLlmAreaKey(area)`, `BOS_LLM_SETTINGS_CATEGORY = 'business_os_llm'`, `TEMPERATURE_BOUNDS = { min: 0, max: 1 }`, `ALLOWED_PROVIDERS_LAYER2 = ['openai']` |
| `modelSettingsSchema.ts` | `zod`, the policy | Row Zod schema, shared by the resolver and the change script (RC-9) |
| `modelSettings.ts` | policy, schema, `systemConfigRepository`, `hasPricing`, `rejectsSamplingParameters`, `usesMaxCompletionTokens`, logger | `resolveBosLlmSettings<A extends BosLlmArea>(area: A, callName: Exclude<BosLlmCallName<A>, ExcludedCall>): Promise<ResolvedBosLlmSettings>` (typed, so a typo is a `typecheck:bos-llm` error, RC-W7a); `isBosLlmAreaEnabled(area): Promise<boolean>` (the explicit area-level check used by the three chat entry gates, RC-W7d); the cache, guardrails, locks, the change-seen log, `validateAreaRow` (for the script), and `__resetBosLlmSettingsForTests()` |
| `modelFallback.ts` | resolver types, logger | `withModelFallback(resolved, attempt)`, `isModelUnavailableError(err)`, the negative cache |

**Policy entry type (per call):**

```typescript
interface BosLlmCallPolicy {
  default: { provider: 'openai'; model: string; temperature: number | null }; // null = send none
  switchable: boolean;           // DEC-5
  allowedProviders: readonly ['openai'];
  temperature: 'free' | { locked: number } | 'not_applicable'; // images = not_applicable
  sendsSamplingPenalty: boolean; // N-1: planner, analysis → a reasoning model is rejected as a field
  kind: 'token' | 'image';       // selects the price guardrail
}
```

`BOS_LLM_CALL_POLICY` is typed `{ [A in BosLlmArea]: { [C in Exclude<BosLlmCallName<A>, ExcludedCall>]: BosLlmCallPolicy } }`, and `BOS_LLM_SETTINGS_EXCLUDED_CALLS` is typed against the catalog too. A new catalog call with no policy and no exclusion is therefore a **`typecheck:bos-llm` error** (RC-1d). An area-level `onboarding` lock (switchable: false for the area) is held in `BOS_LLM_AREA_LOCKS`.

**Step 3 deferral uses the lock (RC-W8b, Q-11):** in Step 2 the policy sets `switchable: false` for `website/full_site`, `website/field_regenerate` and `website/testimonial_enhance`; Step 3 flips them to `true` when their ★ off paths ship. There is no separate `STEP3_PENDING_SWITCHES` set. One mechanism, and the resolver's output stays truthful (a locked call reports `enabled: true`).

### 3.2 Row schema (DEC-2, RC-3)

```typescript
const FieldSet = z.object({
  enabled: z.unknown().optional(),     // validated field by field by the guardrails,
  provider: z.unknown().optional(),    // not by Zod, so that one bad field falls back alone (FR-6)
  model: z.unknown().optional(),
  temperature: z.unknown().optional(), // absent = inherit; null = send none
});
const AreaRow = FieldSet.extend({ calls: z.record(z.string(), FieldSet).optional() }).passthrough();
```

Zod decides only "is this an object with the right shape of containers". A non-object row → the code defaults for the area plus an error log. Fields are validated by the guardrails, one by one (FR-6's "single invalid field falls back alone"). Unknown top-level keys (from `passthrough`) and unknown `calls` names are warned about and ignored. JSON-string values are parsed with the repository's `asObject` behaviour (a JSONB value may arrive as a string). The resolver keeps its own private copy of that helper (a few lines). The repository's version stays unexported, so the repository's public surface doesn't change.

### 3.3 Resolution (FR-5, FR-7, FR-8)

For each call, per field: `calls[call].field` → `area.field` → `policy.default.field`. At each level a present field is validated; a rejected value logs `error { area, callName, field, level, reason, value? }` (value only for provider/model labels) and resolution continues at the next level.

**The code default is the last level and is never guardrail-checked at runtime (RC-W7b).** A row value equal to the code default is accepted without a price query. T1-3 asserts, once in tests, that every default passes the guardrails. `hasPricing` is **memoised per distinct `provider:model` within one refill** (RC-W7c), because `pricing.ts:168-171` reloads the pricing table on every call while its cache is empty (for example during a DB outage). The rules:

| Field | Accepted when |
|---|---|
| `provider` | in `policy.allowedProviders` |
| `model` (token) | a non-empty string ≤ 100 chars; `hasPricing(provider, model)` is true (awaited at refill, memoised, RC-5, RC-W7c); not (`sendsSamplingPenalty` or a locked temperature) with `rejectsSamplingParameters(model)` (RC-11); **and not `rejectsSamplingParameters(model) && !usesMaxCompletionTokens(model)`** (RC-W5: a reasoning model that would be sent `max_tokens`, today `o1*`, is rejected on every token call) |
| `model` (image) | every size in the configured image sizes is priced at `low`, `medium` and `high` in config prices or `IMAGE_FALLBACK_PRICING` (RC-5, N-11) |
| `temperature` | absent (inherit), `null` (send none), or a finite number 0 ≤ t ≤ 1 (RC-2). Ignored with a warn when the policy is `locked` (planner, FR-8) or `not_applicable` (images) |
| `enabled` | a boolean. Ignored with a warn where the policy is not switchable (onboarding area and calls; planner call; in Step 2 only, the three deferred website calls) |

**Resolver vs change script on locked fields (RC-W8a):** the resolver **ignores** a locked or non-switchable field with a warn (onboarding `enabled`, planner `enabled`/`temperature`, images `temperature`, and the Step 2 website locks). `validateAreaRow` reports the same field as a **rejection** for the change script, which exits non-zero and writes nothing, so an operator's intent never silently fails to happen.

**Area `enabled: false`** turns off every switchable call in the area, unless a call sets `enabled: true`. The planner has no call-level switch but follows the chat area's switch. The chat area switch is the only way to turn the planner off, and chat's route-entry gate enforces it through `isBosLlmAreaEnabled('chat')` (RC-W7d, §7).

**After resolution:** if the model rejects sampling parameters and the resolved temperature is a number, the temperature becomes "not sent" with a warn (RC-11). The result:

```typescript
interface ResolvedBosLlmSettings {
  area: BosLlmArea; callName: string;
  enabled: boolean; provider: 'openai'; model: string;
  temperature: number | undefined; // undefined = do not send
  defaultModel: string;            // for the retry (FR-11)
}
```

Call sites spread `...(s.temperature !== undefined ? { temperature: s.temperature } : {})`, so "not set" never sends the key. This matters for the direct `chatCompletion` calls; `complete()` already omits `undefined`.

### 3.4 Cache (DEC-8, FR-10)

- One module-level snapshot: `{ resolvedByCall: Map, rows: Map<area, {updatedAt, fingerprint}>, loadedAt, nextRefreshAt }`.
- **Refill** is `getByKeys(eight keys)` (N-8), then validation of all eight areas at once (including the awaited `hasPricing` calls, memoised per `provider:model` for the refill, RC-W7c; values equal to the code default skip the check, RC-W7b). The resolved map is cached, so a warm call is a map lookup with no await on I/O.
- Refill when `now ≥ nextRefreshAt`. On success `nextRefreshAt = now + 60 s`. On repository error, keep the previous snapshot, or the defaults if there is none; `nextRefreshAt = now + 10 s`; warn.
- A missing row is a valid, cached result (debug log).
- Concurrent callers share one in-flight refill promise, so there is no thundering herd.
- **Change-seen log (DEC-10.2):** on refill, compare each area's resolved fields with the previous snapshot. For any change, log `info { area, changes: [{ callName, field, from, to }], rowUpdatedAt }`. The first load after a cold start logs nothing. Labels only, never prompt text.
- The resolver never throws: the whole refill is `try/catch`, and any unexpected exception is treated as a repository error.

### 3.5 Retry (DEC-9, RC-7, FR-11)

```typescript
withModelFallback<T>(s: ResolvedBosLlmSettings, attempt: (model: string) => Promise<T>): Promise<{ result: T; modelUsed: string }>
```

- If `s.provider:s.model` is in the negative cache, go straight to `attempt(s.defaultModel)`.
- Otherwise `attempt(s.model)`. On error: retry only if `s.model !== s.defaultModel` **and** `isModelUnavailableError(err)`. Then add `provider:model` to the negative cache (expiring with the settings window, 60 s), log `error { area, callName, rejectedModel, defaultModel, errCode }`, and run `attempt(s.defaultModel)`. Any other error is rethrown unchanged.
- **Classifier (code-owned):** `err.status === 404 && err.code === 'model_not_found'`, or `err.status === 403 && err.code` is in `['model_not_found', 'unsupported_model']`, or `err.status === 404 && err.param === 'model'`. Never the message text (Q-8, approved as listed). **Before Step 3:** run one image call with an unknown model on a non-production key and record what the Images API returns. If it is a 400 the classifier does not cover, images simply do not retry (the owner is told the image failed, as today); the classifier is **not** widened for it.
- **Placement:** every site wraps only its provider call, inside its existing `runAiAction` scope. That gives one audit entry, `callCount 2`, `failedCallCount 1`, both models, and outcome `succeeded` (V-8).
- `modelUsed` feeds FR-13.
- **Anything derived from the model is built inside the attempt, or reassigned from `modelUsed` after it.** Images build the price resolver inside the attempt, so the price follows the model that ran (RC-W4). The planner reassigns its loop model to `modelUsed`, so repair attempts and every `diagnostics({ model })` use the model that worked (RC-W6).

### 3.6 Change script (FR-17, RC-9)

`scripts/bos-llm-settings.ts`, run as **`npm run bos:llm-settings -- <command>`** (or `npx tsx --import ./scripts/env-preload.ts scripts/bos-llm-settings.ts <command>`). **Plain `npx tsx scripts/bos-llm-settings.ts` cannot work (S1-1):** `lib/supabaseServer.ts` builds the service-role client at import, and ES imports run before any statement the script could execute, so it dies with `Error: supabaseUrl is required` before printing its usage. Every command first logs the Supabase host it is about to use (S1-11), because P-3 and P-5b are run by hand against production. Commands:
- `get <area>` prints the row and the resolved settings per call.
- `set <area> --file row.json [--dry-run]` or `set <area> --enabled false` (a shorthand that merges into the stored row).
- **`set <area> --enabled false` and call-level overrides (RC-W8c):** if the stored row has any `calls.<name>.enabled: true` that would keep calls on, the script lists them and **refuses** unless `--include-calls` is given, which also sets those overrides to `false`. The emergency switch must do what it says. The runbook documents this (§8).
- It validates with **the same** schema and guardrail functions the resolver uses (exported from `modelSettings.ts` as `validateAreaRow(area, row) → { ok, rejected[] }`). Any rejected field, **including a locked or non-switchable field (RC-W8a)**, means a non-zero exit and **nothing written**. Otherwise it writes `systemConfigRepository.set(bosLlmAreaKey(area), row, 'business_os_llm', <description>)`.
- `--dry-run` prints the diff only.
- `verify-stored` (read-only, Q-12) is the P-3 pre-check before the seed (N-3). It runs the six stored single-purpose values through the same guardrails, **and flags any value that is not canonical (RC-W1a)**. Canonical means a JSON boolean; a string `true`/`false` in any case; or a non-empty, trimmed model string with no stray quotes. Any flag or rejection → non-zero exit, and the apply stops.
- `verify-equivalence` (read-only, RC-W1b) is the P-5b post-seed check. For the six F-3 fields it calls the **real, still-deployed legacy getters** (`systemConfigRepository.getBoolean` / `get` as leads uses them today, `SystemConfigService.getBoolean` / `get` as the planner and analysis use them, and `getImageGenerationConfig().model`) and compares each with what `resolveBosLlmSettings` returns from the seeded rows. Any difference → non-zero exit, printed per field; the operator runs the seed rollback `DELETE` (safe, because no reader of the rows is deployed yet) and escalates.
- It logs through Pino (`createLogger({ module: 'BosLlmSettingsScript' })`). It uses the service-role default client of the repository, run only by operators with `.env.local`. That is intentional and documented in the header.

### 3.7 Seed (FR-16, DEC-6, RC-4)

`supabase/migrations/20261003_seed_bos_llm_area_settings.sql` (renamed from `20261002_…`, taken by a migration merged in the meantime — D-19; the date still sorts after the Step 0 policy migration):

- A CTE reads the six F-3 keys and unwraps them. For strings: `CASE jsonb_typeof(value) WHEN 'string' THEN value #>> '{}' END`, then a second unwrap if the text itself starts with `"` (double-encoded). For booleans: `jsonb_typeof = 'boolean'` → the value; `'string'` → `lower(value #>> '{}') IN ('true','false')`. Anything else → NULL → the code default.
- **These unwrap rules are only safe for canonical values (RC-W1).** Today's readers treat a non-canonical value differently (e.g. `"no"`, `"0"` or `0` read as **off**; the seed would map them to the default **on**). The seed is therefore never applied unless P-3 `verify-stored` passes with no non-canonical flag, and it is kept only if P-5b `verify-equivalence` shows no difference (§9).
- `INSERT … VALUES (bos_llm_area_<area>, jsonb_build_object(…), 'business_os_llm', '<description>') ON CONFLICT (key) DO NOTHING` for the eight rows. The values are in §10's "seeded row" column.
- `UPDATE system_settings_config SET description = description || ' — superseded by bos_llm_area_<area> (Layer 2)'` for the six old keys, guarded with `NOT LIKE '%superseded%'` so it is re-runnable.
- A header comment carries the pre-check, post-check and rollback SQL (§9), and names the two script gates around it: P-3 `verify-stored` before, P-5b `verify-equivalence` after.

### 3.8 "Off" paths (FR-14)

| Call | Where `enabled` is checked | Off result |
|---|---|---|
| insights ×3 | before each `chatCompletion` | the existing translated-template branch (reason `disabled`, info log) |
| briefing | `BriefingNarrator` before the call | the existing deterministic composer |
| website `full_site` | **One check point (RC-W3):** `generateWebsite(…, { onAiDisabled: 'fallback' \| 'fail' })`, checked once inside `WebsiteGenerationService` where it resolves the settings for `callLLM` (no separate pre-checks, so no race with a refill between check and call). The onboarding build passes `'fallback'`; generate-from-profile and the chat mutate path pass `'fail'` | build: starter copy, `{ source: 'fallback', reason: 'disabled' }`. generate-from-profile: `{ success: false, code: 'ai_unavailable' }`, no content written; the page shows `labels.ai_unavailable`. Chat mutate: **the page is still created** (the owner already confirmed the write, Q-7 reversed), generation is skipped, no content written, and the reply is the preview link plus the translated sentence |
| website `landing_page` | the route, before the call | the existing `getDefaultContent()` path |
| website `field_regenerate`, `testimonial_enhance` | in the service, before the call → the routes return **HTTP 200** `{ success: false, code: 'ai_unavailable' }` (Q-9: a disabled feature is not a server fault) | the page shows `labels.ai_unavailable` beside the button (N-5) |
| website dormant blocks | in the service | the per-block templates |
| intake ×2 | before the call | three generic questions / the owner's own words |
| leads | replaces the `ENABLED_KEY` read | the deterministic ladder (existing `disabled` reason) |
| onboarding ×4 | not switchable | — |
| chat (area) | `isBosLlmAreaEnabled('chat')` (RC-W7d). **chat-v4:** immediately before `if (!budget.allowed)` (`chat-v4/route.ts:736`), i.e. after the in-progress fill (4a) and confirm/cancel (4) branches and before any planner, analysis or embedding call (RC-W2, Q-10). If chat is off and the budget is also exhausted, the chat-off message wins. **chat-v2:** after auth, the feature flag and Zod. **chat (v1):** after auth | the translated "assistant is unavailable" message, with the route's normal success shape. A parked write can still be confirmed or cancelled while chat is off (that path makes no LLM call) |
| chat `analysis` | replaces `isAnalysisEnabled()` | the planner's own sentence |
| images | `generateImage`, **after the reuse check (`GeneratedImageService.ts:309`)** and before the daily count (RC-W4): handing back an existing picture costs nothing and is not AI | the existing `reason: 'unavailable'` → `media.generate.unavailable` (N-4, Q-6) |

---

## 4. Step 0 — Secure the settings and pricing routes

**Scope:** FR-1, AC-1. Anonymous writes stop, and the admin page is unchanged for admins. **Size: S–M** (~3 route files rewritten, ~350 lines of production code, ~450 lines of tests, plus one migration only if the RLS check needs it).

### 4.1 Settings POST: proposal — **delete**

**Proposal: delete `POST /api/admin/system-config`.** Next.js then returns **405** for POST (AC-1 accepts 404/405).
- It has no caller anywhere (§2.1).
- The admin page creates nothing; it only updates (PUT).
- A gated POST would be a second, untested write path, and it would need its own `bos_llm_area_*` refusal and its own tests. Deleting it removes the path, so there is nothing left to secure.
- PUT's repository `set` already inserts a missing key, so an admin can still create one when needed.
- `SystemConfigService.create` becomes unused by this route; it is left in place, since the service is deprecated and removed separately.

### 4.2 Files

| File | Action | Change |
|---|---|---|
| `app/api/admin/system-config/route.ts` | modify (rewrite) | Delete POST. GET/PUT: correlation id, `getUser()` → 401, `AdminAccessService.getInstance().isAdmin({ id, email })` in try/catch, fail closed → 403. PUT body `z.object({ updates: z.record(z.string().min(1).max(100), z.unknown()).refine(n ≥ 1 && n ≤ 50) })` → 400. Any key matching `/^bos_llm_area_/` → 400 (DEC-10). Reads `systemConfigRepository.getAll()`, writes `systemConfigRepository.setMultiple(updates)`. Keeps the deprecated `routing_min_executions` warning as a Pino warn. Pino info `{ userId, keys }` (keys only, no values). `details` only in development. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. Response shapes unchanged. The module-level `createClient` is removed |
| `app/api/admin/system-config/pricing/route.ts` | modify | The same gate on GET/PUT/POST/DELETE. **RC-W10:** pass the admin's `user.id` to `logAIPricingUpdated` / `Created` / `Deleted` (today `null`, TODO at `:101`), and make those three calls non-blocking (`.catch` → Pino error), so an audit failure cannot 500 a write that already succeeded. Zod: PUT `{ id, input_cost_per_token? ≥ 0, output_cost_per_token? ≥ 0 }` with a `refine` requiring **at least one** cost field (today's semantics kept, RC-W10); POST `{ provider: 1..50, model_name: 1..100, input/output ≥ 0, effective_date?: ISO }`; DELETE `?id=`. The `id` type follows the live column (§4.4, query R-3). 12 `console.*` → Pino. No `error.message` outside development. The direct Supabase access stays (RC-10b follow-up), with a header comment naming the follow-up and why the service role is used |
| `app/api/admin/system-config/pricing/sync/route.ts` | modify | `POST(request)` (N-10), the same gate, correlation id on the existing Pino logger, no `error.message` outside development |
| `lib/admin/requireAdminRoute.ts` | create (Q-1: extract, SA Rule 7 sign-off) | `requireAdmin(requestLogger): Promise<{ user } \| NextResponse>` (discriminated union): the exact inline precedent (`llm-usage/route.ts:49-64`), server-only, fail closed, `AdminAccessService` only (never `profiles.role`). Logs `userId` only, never the email. Extracted because Step 0 applies it to 6 handlers in 3 files |
| `lib/admin/__tests__/requireAdminRoute.test.ts` | create | T0-7: the helper tested once (401, 403, 403 on `isAdmin` throw, `{ user }` on admin, email never logged) |
| `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` | **created 2026-09-20** (T0.6 — the §4.4 read found both failure modes) | Enables RLS on `ai_model_pricing`; adds `public.is_platform_admin()` (SECURITY DEFINER over `admin_users`, never `profiles.role`) plus admin-only SELECT and write policies; REVOKEs INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from `anon` and `authenticated` on **both** tables; drops the two broken `system_settings_config` write policies and replaces them with one `admin_users`-backed policy. `system_settings_config` SELECT is untouched (the browser theme provider, `OrchestrationService` and `MemoryCompressor` read it with the anon client). Commented rollback + verification block at the end. **Applied to production by the user on 2026-09-20** (§4.4). |
| `lib/repositories/AiModelPricingRepository.ts` | create (T0.10) | Six methods on `AgentRepositoryResult<T>`, injectable client, own Pino service logger, never throws; `user_id` exemption documented in the header |
| `lib/repositories/types.ts` | modify (T0.10) | `AiModelPricing`, `CreateAiModelPricingInput`, `AiModelPricingSyncEntry`, `AiModelPricingSyncResult` |
| `lib/repositories/index.ts` | modify (T0.10) | Barrel export of the class, the singleton and the four types |
| `lib/repositories/__tests__/AiModelPricingRepository.test.ts` | create (T0.13) | T0-8: 17 cases against an injected client, including "never issues an upsert" |
| `lib/audit/events.ts` | modify (T0.12) | `AI_PRICING_ZERO_SET` + critical/SOC2 metadata |
| `lib/audit/admin-helpers.ts` | modify (S-1, T0.12) | `logAIPricingZeroCost` helper; `logAIPricingSynced` is now actually called |
| `lib/audit/types.ts` | modify (T0.12, D-10) | Registers the `ai_pricing` entity type the three existing pricing helpers already write |
| `app/api/admin/system-config/__tests__/dataAccess.test.ts` | create (T0.13) | Static gate: no `createClient` / `supabaseServer` / `supabaseClient` / `@supabase/supabase-js` import, no `.from('…')`, no `console.*` anywhere under `app/api/admin/system-config/**` |
| `app/api/admin/system-config/__tests__/route.test.ts` | create | T0-1, T0-2, T0-3 |
| `app/api/admin/system-config/pricing/__tests__/route.test.ts` | create | T0-4 |
| `app/api/admin/system-config/pricing/sync/__tests__/route.test.ts` | create | T0-5 |
| `app/admin/system-config/page.tsx` | **verify only** | Not modified (N-14) |

### 4.3 Tasks

- ✅ **T0.0** Baselines recorded on the step base (2026-09-20): `npm run typecheck:bos-llm` = **156 files in scope, 30 errors, 0 new**; full `tsc --noEmit` (with `NODE_OPTIONS=--max-old-space-size=8192`) = **2,045 pre-existing errors**, none of them in the Step 0 files.
- ✅ **T0.1** The user ran the RLS read on production (2026-09-20); the results are recorded in §4.4 and they required a migration.
- ✅ **T0.2** (Q-1 resolved: extract) `lib/admin/requireAdminRoute.ts` + `lib/admin/__tests__/requireAdminRoute.test.ts`.
- ✅ **T0.3** `system-config/route.ts` rewritten: POST deleted, gate, Zod, repository, `bos_llm_area_*` refusal, Pino (7 `console.*` → 0), no leaks, response shapes unchanged.
- ✅ **T0.4** `pricing/route.ts`: gate on all four methods, Zod (PUT at-least-one-cost `refine`), Pino (12 `console.*` → 0), no leaks, admin `user.id` into the three audit calls, an audit failure cannot 500 a completed write (RC-W10).
- ✅ **T0.5** `pricing/sync/route.ts`: `POST(request: NextRequest)`, correlation id, gate, no leak.
- ✅ **T0.6** `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` written (see §4.2 for what it does and §4.4 for the evidence) and **APPLIED to production by the user on 2026-09-20**, ahead of the code deploy. It applied fully and cleanly — no partial state, nothing broken. Post-apply verification output is in §4.4.
- ✅ **T0.7** Tests T0-1 … T0-7 written and green; gates run (§4.6 records the output).
- ⬜ **T0.8** Manual check as an admin (dev server): the page loads, the billing save works, a pricing edit works, sync works. As a non-admin: 403 on each.
- ⬜ **T0.9** SA code review → QA → user → RM merges and **deploys Step 0 alone**. Record the deploy in §17.
- ✅ **T0.10** (added 2026-09-20, SA addendum after §15) `lib/repositories/AiModelPricingRepository.ts` + row/input types + barrel export. The `user_id` exemption is documented in the header.
- ✅ **T0.11** (added 2026-09-20) `pricing/route.ts` and `pricing/sync/route.ts` moved onto `aiModelPricingRepository`; both module-level `createClient` calls deleted; PUT/DELETE answer 404 on a missing row; response shapes unchanged.
- ✅ **T0.12** (added 2026-09-20) Zero-price policy, Step 0 half: `AI_PRICING_ZERO_SET` audit event + `logAIPricingZeroCost` helper + an error-level log, on any saved `$0` cost (PUT and POST).
- ✅ **T0.13** (added 2026-09-20) Tests T0-8 (repository unit, injected client) and T0-9 (zero-price log + audit); the existing route suites moved to a repository double **with no assertion changed** (only the queued mock values, which are arrangement); plus the static no-direct-Supabase gate.

> **Scope change, 2026-09-20 (user):** the pricing route’s direct Supabase access is **no longer deferred to RC-10b** — it is fixed inside Step 0 (mandatory rule: all DB access through `lib/repositories/`). The full spec is the **SA Addendum** after §15. D-4 in §4.8 is superseded for these two routes.

### 4.4 Live RLS check (FR-1; the user runs these, read-only, in the Supabase SQL editor on production)

Run all four statements as **one** read-only block in the Supabase SQL editor on production, and paste each result set under Result below.

```sql
-- R-1: RLS enabled?
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('system_settings_config', 'ai_model_pricing');

-- R-2: every policy on both tables
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('system_settings_config', 'ai_model_pricing')
ORDER BY tablename, policyname;

-- R-3: table grants to the client roles, and the column types Step 0/1 depend on
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('system_settings_config', 'ai_model_pricing')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'system_settings_config' AND column_name IN ('key', 'value', 'category', 'updated_at'))
    OR (table_name = 'ai_model_pricing' AND column_name = 'id'));
```

**How to read it (decision table):**

| R-1 `relrowsecurity` | R-2 policies | Verdict | Step 0 action |
|---|---|---|---|
| true | only `SELECT` for anon/authenticated/`{public}` (or none) | ✅ acceptable (labels only) | No migration |
| true | any `INSERT`/`UPDATE`/`DELETE`/`ALL` whose `roles` include `anon`, `authenticated` or `{public}` | ❌ open write | Migration drops that policy (and re-adds SELECT-only if it was `ALL`) |
| **false** | — | ❌ if R-3 shows INSERT/UPDATE/DELETE granted to anon/authenticated (the Supabase default) | Migration: `ENABLE ROW LEVEL SECURITY` + an explicit `SELECT` policy for anon/authenticated (`theme-provider.tsx:61-65` reads with the anon key). The service role bypasses RLS, so the routes are unaffected |

**Result:** run by the user on production, **2026-09-20**.

| Query | Result | Read on |
|---|---|---|
| R-1 (RLS enabled) | `ai_model_pricing`: **RLS DISABLED**. `system_settings_config`: RLS enabled. | 2026-09-20 |
| R-2 (policies) | Raw `pg_policies` rows pasted verbatim below the table (SA R-3). In summary — `system_settings_config`: SELECT open to `public` + `authenticated` (labels and model names — kept). Two write policies, both broken: **"Only admins can modify settings"** trusts `profiles.role = 'admin'`, and `profiles` is user-writable (its UPDATE policy is `USING (auth.uid() = id)` with no `WITH CHECK` and no column restriction), so any signed-in user can self-promote and then write any setting; **"Only admins can modify system settings config"** trusts `auth.users.role = 'admin'`, which is always `authenticated`, so it is inert. `ai_model_pricing`: no policies (RLS is off). | 2026-09-20 |
| R-3 (grants + column types) | `ai_model_pricing`: `anon` **and** `authenticated` hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER — i.e. anyone holding the public anon key can rewrite or truncate the table every credit charge is computed from. `ai_model_pricing.id` is **uuid** (D-1 narrowed accordingly). | 2026-09-20 |

**R-2 raw rows for `system_settings_config`, as returned on 2026-09-20 (SA R-3 — evidence, not prose):**

```
system_settings_config | "Allow authenticated users to read settings" | PERMISSIVE | {authenticated} | SELECT | qual: true  | with_check: null
system_settings_config | "Anyone can read system settings config"     | PERMISSIVE | {public}        | SELECT | qual: true  | with_check: null
system_settings_config | "Only admins can modify settings"            | PERMISSIVE | {authenticated} | ALL    | qual/with_check: EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
system_settings_config | "Only admins can modify system settings config" | PERMISSIVE | {public}     | ALL    | qual: EXISTS (SELECT 1 FROM auth.users WHERE users.id = auth.uid() AND users.role::text = 'admin') | with_check: null
```

**Conclusion (the safety pre-check the migration depends on):** the two read policies — `"Allow authenticated users to read settings"` (`{authenticated}`, `SELECT`, `qual: true`) and `"Anyone can read system settings config"` (`{public}`, `SELECT`, `qual: true`) — **stand on their own**. They are separate `SELECT` policies, not the `FOR ALL` policies being dropped. Dropping `"Only admins can modify settings"` and `"Only admins can modify system settings config"` therefore **cannot** remove anon or authenticated read access: `lib/design-system-v2/theme-provider.tsx`'s `v2_custom_tokens` read, and the anon-client config reads in `OrchestrationService` and `MemoryCompressor`, keep working. (Permissive policies OR together, so the new admin-only write policy does not narrow those reads either.) The migration's PRE-APPLY CHECK block asks the operator to re-confirm this immediately before applying, since the drop cannot be undone in place.

**Still to paste when the migration is applied (SA R-4):** the R-3 grant rows for **`system_settings_config`** — the first read recorded them for `ai_model_pricing` only, so the REVOKE on that table runs without written evidence of what was there. Bookkeeping, not risk: the REVOKE is a no-op for anything not granted, and the rollback deliberately re-grants only what was recorded.

**Post-apply verification, production, 2026-09-20** (run by the user after applying the migration — the file's own VERIFICATION block):

```
RLS enabled:        ai_model_pricing = true ; system_settings_config = true
Policies:           ai_model_pricing_admin_select {authenticated} SELECT
                    ai_model_pricing_admin_write  {authenticated} ALL
                    system_settings_config_admin_write {authenticated} ALL
                    "Allow authenticated users to read settings" {authenticated} SELECT   (pre-existing, kept)
                    "Anyone can read system settings config"     {public}        SELECT   (pre-existing, kept)
                    -- both broken FOR ALL policies (profiles.role / auth.users.role) are gone
Grants (anon/authenticated/PUBLIC): SELECT only, on both tables
Function:           is_platform_admin  prosecdef=true  proconfig={search_path=pg_catalog, public}
```

Every line is what the migration intended: RLS on for both tables, the three new `admin_users`-backed policies in place, **both** broken `FOR ALL` policies gone, the two pre-existing `SELECT` policies untouched (so the browser theme provider and the anon-client config reads keep working — the R-3 safety pre-check held in practice, not only on paper), client roles left with `SELECT` and nothing else, and `is_platform_admin()` SECURITY DEFINER with `search_path` pinned `pg_catalog, public` (SA R-1).

**Applying before the code deploy was harmless, and there is no deploy-order dependency.** The migration only constrains **direct** `anon`/`authenticated` access. Every application reader and writer of both tables uses the **service role**, which bypasses RLS by role attribute: `lib/ai/pricing.ts`, `systemConfigRepository`/`supabaseServer`, `aiModelPricingRepository`, the three Step 0 routes, the other admin config routes and the Stripe webhook. The three anon-client consumers are `SELECT`-only on `system_settings_config`, whose read policies were not touched. So the migration is correct both before and after the Step 0 deploy, in either order.

**The rollback block is now the operational record, not a pre-apply precaution:** it is the documented way back if something surfaces later. Its `system_settings_config` GRANT is still deliberately left for the operator to fill from the grants captured at apply time (QA D-Q4) — the post-apply read above records the **end** state (`SELECT` only), not what was revoked.

**Verdict:** ❌ both failure modes in the decision table are present — a table with RLS off and full client write grants, and a table whose write policies are backed by a user-writable column. **Migration written:** `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` (T0.6, §4.2). It is **not applied** — the user applies migrations, after the Step 0 deploy, then re-runs R-1/R-2/R-3 (the verification block at the end of the file) and pastes the result here.

Verified by grep before revoking (2026-09-20): **no app code writes either table with the anon/authenticated client.** Every writer is service-role (the three admin routes, `systemConfigRepository`/`supabaseServer`, the other admin config routes, the Stripe webhook). The only browser-client touches are reads — `lib/design-system-v2/theme-provider.tsx` (`v2_custom_tokens`), `OrchestrationService` and `MemoryCompressor` — which is why `system_settings_config` SELECT stays open. `ai_model_pricing` is read only by service-role code (`lib/ai/pricing.ts`, the admin routes, two scripts), so its reads stay closed to ordinary clients and the new SELECT policy is admin-only.

### 4.5 Tests

| ID | File | Asserts | AC |
|---|---|---|---|
| T0-1 | `system-config/__tests__/route.test.ts` | GET/PUT: 401 signed out; 403 non-admin; 403 when `isAdmin` throws; **no repository call** in any of these. Admin GET → `{ success, data }`, same shape | AC-1 |
| T0-2 | same | PUT: invalid body (missing `updates`, array, 0 keys, 51 keys, empty key) → 400; `{ updates: { bos_llm_area_chat: {…} } }` → 400 and no write; the mixed-type billing body → 200 and `setMultiple` called with it unchanged; a repository error → 500 whose body has no message outside development | AC-1 |
| T0-3 | same | `POST` is not exported (module shape), so Next.js answers 405 | AC-1 |
| T0-4 | `pricing/__tests__/route.test.ts` | 401/403 for GET/PUT/POST/DELETE with no Supabase call; Zod 400s (incl. PUT with neither cost field); PUT with only one cost field → 200; admin happy path per method; the audit call receives the admin's `user.id`; an audit call that rejects still returns 200 (RC-W10); no `error.message` outside development | AC-1 |
| T0-5 | `pricing/sync/__tests__/route.test.ts` | 401/403 with no write; an admin runs the sync (Supabase mocked) | AC-1 |
| T0-6 | static (`grep` in the gate list) | 0 `console.*` in the three route files | AC-1 |
| T0-8 | `lib/repositories/__tests__/AiModelPricingRepository.test.ts` | The repository against an **injected** client: `listAll` ordering / `[]` on empty / no retired filter; `findById` and `updateCosts` "no such row" → `{ null, null }`; the empty-`costs` guard issues no query; `deleteById` false when nothing matched; `syncMany` update path, insert path, newest-row-wins lookup, a per-row failure that does not abort, and **no `upsert` ever**; every method returns `{ data: null, error }` instead of throwing | AC-1 |
| T0-9 | `pricing/__tests__/route.test.ts` | A PUT and a POST that save `$0` produce the error-level log **and** the `AI_PRICING_ZERO_SET` audit call carrying the admin id (the ordinary audit entry is still written); a non-zero save produces neither; a rejected zero-audit still returns 200; a numeric-as-string `'0'` from PostgREST counts as zero | AC-1 |
| T0-10 | `system-config/__tests__/dataAccess.test.ts` | Static: no `createClient`, no `@supabase/supabase-js` / `supabaseServer` / `supabaseClient` import, no `.from('…')` and no `console.*` anywhere under `app/api/admin/system-config/**` | AC-1 |
| T0-7 | `lib/admin/__tests__/requireAdminRoute.test.ts` | The helper once: 401 signed out, 403 non-admin, 403 when `isAdmin` throws, `{ user }` for an admin; the email never appears in a log call (Q-1). Each route keeps its own 401/403 test (T0-1, T0-4, T0-5) | AC-1 |

### 4.6 Gates

Re-run after S-1, S-2, the D-1 narrowing, the migration and T0.10–T0.13 (2026-09-20, second pass).

| Gate | Result (2026-09-20, after the SA fixes + repository switch) |
|---|---|
| `npm run typecheck:bos-llm` | ✅ `typecheck-bos-llm: 156 files in scope, 30 errors, 0 new (92.1s)` → `typecheck-bos-llm: passed`. Scope count unchanged: these routes and the new repository are outside it |
| Full `tsc --noEmit` per-file diff | ✅ **2,038** errors repo-wide, down from the 2,045 baseline. The only lines matching the touched files are the **4 pre-existing** `'reward_config'` entity-type errors in `lib/audit/admin-helpers.ts:76,100,124,148` (the reward-config helpers, untouched here — recorded as a follow-up in §4.9). Zero errors in the routes, the repository, its test, `lib/admin`, `lib/audit/events.ts` and `lib/audit/types.ts` |
| `npx jest app/api/admin lib/admin lib/repositories` | ✅ `Test Suites: 29 passed, 29 total` / `Tests: 284 passed, 284 total` |
| `npm run build` (`next build`) | ✅ `✓ Compiled successfully`, `✓ Generating static pages (295/295)`, exit 0; the three routes build as dynamic (`ƒ /api/admin/system-config`, `…/pricing`, `…/pricing/sync`). The `DYNAMIC_SERVER_USAGE` lines in the output come from other, untouched routes and are pre-existing |
| No `console.*` in the three routes | ✅ 0 (was 7 + 12 + 0), now enforced by T0-10 rather than by eye |
| No `createClient` / `supabaseServer` under `app/api/admin/system-config/**` | ✅ 0 — asserted by T0-10 |

**Scope-count note (2026-09-20):** a run made straight after QA's `npx next dev` session reported `146 files in scope` instead of 156, with the same `30 errors, 0 new`. The cause is `.next/types/**`, which the gate's import graph walks: a dev server leaves a different set of generated route-type files than `next build` does. Re-running `npm run build` restores `156 files in scope`. Nothing in the Step 0 code is in scope either way — reverting `system-config/route.ts` to HEAD did not move the count. Run the gate after a build, not after a dev session.

First pass, before the SA fixes (kept for the record): `typecheck:bos-llm` 156 files / 30 errors / 0 new; `tsc --noEmit` 2,045 errors, none in the Step 0 files; `npx jest app/api/admin/system-config lib/admin` 4 suites / 44 tests; `npm run build` compiled successfully.

### 4.7 Rollout notes

- Deploy Step 0 alone. After deploy, **L-0:** as an admin, open `/admin/system-config`, save billing, edit one price and revert it, run sync. Anonymous `curl -X PUT` → 401; `curl -X POST` → 405.
- If a migration was written (T0.6): the user applies it after the Step 0 deploy, runs R-2 again, and pastes the result into §4.4. The seed (§9) waits for both.

---

### 4.8 Implementation notes and deviations (Dev, 2026-09-20)

| # | Note |
|---|---|
| D-1 | **`ai_model_pricing.id` is a uuid — schema narrowed (2026-09-20).** R-3 came back `uuid`, so `pricingIdSchema` is now `z.string().trim().uuid()` instead of `string \| number → String()`. A mistyped id is a 400 from the route rather than a PostgREST 500 out of `.single()`, which also retires SA's S-5 nits (`z.number().int()` accepting `1e21`, and a wrong-typed id surfacing as a 500). The admin page already sends the uuid string, so nothing changes for it |
| D-2 | **Audit calls are `await ....catch(...)`, not fire-and-forget.** RC-W10 asks that an audit failure cannot 500 a write that already succeeded, which the `.catch` gives. The `await` is kept because a detached promise can be killed when a Vercel serverless invocation ends, which would silently lose admin audit entries. This matches CLAUDE.md § Audit Trail |
| D-3 | **The SA non-blocking suggestion (cost `> 0` rather than `>= 0`) was not adopted in Step 0.** `>= 0` is what §4.2 specifies and what the route accepts today; a stricter rule is a behaviour change to an admin screen and belongs with the DEC-7 price-coverage work. Raised again here for the Step 0 code review |
| D-4 | **The pricing routes still use the module-level service-role client** (tracked follow-up RC-10b), now with a header comment stating why: `ai_model_pricing` is platform-wide and has no `user_id` to scope by. `system-config/route.ts` no longer creates a client at all — it goes through `systemConfigRepository` |
| D-5 | **N-9 stands unchanged:** `systemConfigRepository.set` does not invalidate the 5-minute in-process cache in `SystemConfigService`. Accepted by SA (Q-2); no practical effect for `payment_grace_period_days`, which is read directly |
| D-6 | **`console.*` in touched files:** 7 in `system-config/route.ts` and 12 in `pricing/route.ts` converted to Pino with a `correlationId` child logger (0 remain across the three routes). `app/admin/system-config/page.tsx` (20) is **not** touched and stays flagged per §12 |
| D-7 | `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` are set on all three routes: cookie- and admin-dependent handlers must never be cached, and Pino plus the repository are Node-only |
| D-8 | **Repository switch (T0.11) supersedes D-4 for these two routes.** Both pricing routes now go through `aiModelPricingRepository`; neither file constructs a Supabase client, and T0-10 keeps it that way. RC-10b is closed for `app/api/admin/system-config/**`. `lib/ai/pricing.ts` deliberately stays as it is and moves in Step 1 (SA addendum §E), as does `app/api/admin/agent-generation-config/route.ts:39`, which reads the table directly too |
| D-9 | **Deliberate behaviour change in the sync (SA addendum §D.2).** The old lookup was `.select('id').eq(provider).eq(model_name).single()`. The unique constraint permits several `effective_date` rows per model, and with more than one `.single()` errored, the row read as missing and the sync **inserted another duplicate on every run**. `syncMany` now orders by `effective_date` descending, takes one row with `maybeSingle`, and updates the newest. Still not an upsert (an upsert on `(provider, model_name, effective_date)` would add a row per model per run) — T0-8 asserts that |
| D-10 | **`ai_pricing` registered as an audit entity type** (`lib/audit/types.ts`). The three existing pricing helpers already write that value and each produced a `tsc` error; the new `AI_PRICING_ZERO_SET` helper would have added a fourth. Registering it (same precedent and comment style as `subscription` / `boost_pack`) removes all four. The only consumer of the list is a containment test, and `Record<EntityType, number>` is built as `Record<string, number>`, so nothing else moves |
| D-11 | **Sync per-row logs lose the `correlationId`** (SA addendum §D): they now come from the repository's own `AiModelPricingRepository` service logger. The route keeps the request on the trail with one summary line carrying `userId` and the three counts, and the audit entry is emitted only when the sync actually ran |
| D-12 | **The sync catalogue contains no zero prices**, so the zero-price rule is applied only in PUT/POST, per SA addendum §F.3. If a future catalogue ever carried one, the check would need a pre-call filter in the sync route |
| D-14 | **Known false-positive in the zero-price alert (SA C-1), accepted for Step 0.** `reportZeroPrice` fires when **either** cost is `0`, so an input-only **embedding** model — where `output: 0` is legitimate pricing, `lib/ai/pricing.ts:69-71`, `text-embedding-*` — raises a critical-severity `AI_PRICING_ZERO_SET` entry and an error-level log every time it is saved through the admin screen. Not fixed now: the Step 0 half is deliberately blunt attribution, and narrowing it belongs with the half that actually protects the money. **Step 1 owner:** the resolver guardrail (SA addendum §F.5–F.7) uses `getPricing(...).input > 0 && .output > 0` for the Layer 2 area check only, and §3.3 records the embeddings caveat so the rule is never pushed into `calculateCost` / `hasPricing`. Step 1 narrows the alert to the same rule (alert when `input === 0`, or when `output === 0` and the model is not an input-only embedding model). Today the practical exposure is small: the sync catalogue has no zero prices and no embedding rows (D-12), so this can only fire on a manual admin save. **QA D-Q9 widens the same point:** the check reads the **post-update row**, so editing only the input cost of a model whose output cost is already `0` also raises a critical entry. Same Step 1 rule narrows both |
| D-15 | **Migration hardening after the SA re-review (2026-09-20).** R-1: `is_platform_admin()` now pins `SET search_path = pg_catalog, public` (built-ins ahead of `public` inside a SECURITY DEFINER body). R-2: both REVOKEs now name `PUBLIC` alongside `anon`/`authenticated`, since a privilege held via PUBLIC would survive a role-only revoke and grants are checked before RLS; the rollback block deliberately does **not** re-grant PUBLIC (nothing recorded one, and it would leave the tables more open than they started — SA R-4), and says so. R-3/R-4: the file gained a PRE-APPLY CHECK block telling the operator to re-confirm the standalone SELECT policy and to paste the `system_settings_config` grant rows into §4.4 |
| D-16 | **QA defects fixed (2026-09-20).** **D-Q4** (Medium): the migration's ROLLBACK no longer re-grants write privileges on `system_settings_config` — §4.4 R-3 recorded grants for `ai_model_pricing` only, so restoring a guessed set could leave that table more open than it started. The block now re-grants only `ai_model_pricing` (recorded) and instructs the operator to paste the grants captured by the PRE-APPLY CHECK for the other table. **D-Q1**: the reserved-key test now compares a canonical form (`NFKC` + invisible-character strip + `trim` + `toLowerCase`), and keys are additionally restricted to `[A-Za-z0-9_.:-]`, so zero-width, full-width and Cyrillic look-alike variants of `bos_llm_area_chat` are all 400s (4 new cases). **D-Q2**: keys the request sent but the write could not carry (`__proto__`) are refused with a 400 naming them, instead of a 200 "updated successfully"; the raw key list is read off the parsed JSON with `getOwnPropertyNames` before Zod. **D-Q3**: `requireAdmin` wraps `getUser()` and answers 401 when the auth lookup throws (was a 500), with a test. Also taken while in the file: **D-Q6** (the PRE-APPLY CHECK now inlines both read-only queries) and **D-Q7** (`lower(au.email) = lower(…)` in `is_platform_admin()`) |
| D-17 | **`ai_model_pricing` is now admin-SELECT-only under RLS (live since 2026-09-20), which makes a future client-side price read fail *silently empty*.** Correct today: every reader is service-role and bypasses RLS (`lib/ai/pricing.ts:121-128`, `app/api/admin/agent-generation-config/route.ts:39`, the admin route via `aiModelPricingRepository`, two scripts). But a browser or user-session read would not error — PostgREST would return `[]`, and the caller would see "no pricing" rather than "not allowed". Two places must know this: **Step 1's `listActive()`** (when `lib/ai/pricing.ts` moves to the repository, an empty result must be logged as a distinguishable condition, not treated as "no prices configured"), and **anyone adding a client-side pricing view**, who needs either an API route behind `requireAdmin` or a widened policy — not a direct browser query |
| D-13 | **S-1 resolved:** `logAIPricingSynced` is now called with the admin's id, `{ models_updated, models_added, source: 'admin_catalog_sync' }`, awaited with `.catch` like the other three. **S-2 resolved:** the reserved-key test normalises with `trim().toLowerCase()`, and padded keys are refused outright with their own 400 (so `BOS_LLM_AREA_chat`, `Bos_Llm_Area_Chat`, `' bos_llm_area_chat'` and `'bos_llm_area_chat '` are all refused). **D-3/S-6 settled** by the user's zero-price decision: the `>= 0` range stays, and T0.12 makes a saved `$0` loud and attributable |

---

### 4.9 Follow-ups recorded out of Step 0 (do not widen this step)

| # | Item | Evidence | Why not now |
|---|---|---|---|
| F-1 | **`profiles` self-promotion.** The `profiles` UPDATE policy is `USING (auth.uid() = id)` with no `WITH CHECK` and no column restriction, so any signed-in user can set their own `profiles.role = 'admin'`. Today that buys them the dropped `system_settings_config` write policy (closed by the Step 0 migration) — but `profiles.role` is read in other places, and the write-side hole itself remains | §4.4 R-2 (the policy text); `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`; `/api/user/profile` PUT writes `role` straight from the request body | Platform-wide blast radius: restricting the column set on `profiles` touches onboarding personas and the profile settings UI. Needs its own requirement, not a line in a security migration. The Step 0 migration removes the one privilege escalation that reached these two tables |
| F-2 | **The rest of `/api/admin/*` is still unauthenticated** (SA S-4): `orchestration-config`, `ui-config`, `memory-config`, `agent-generation-config` (which also reads `ai_model_pricing` directly), `calculator-config` (no auth at all, plus `console.*`), and `settings/admin-users` (requires only a login, then lets the caller add themselves to the legacy `admin_users` **config key**). Two things were checked and hold: none of them can write an arbitrary `system_settings_config` key, and `AdminAccessService` reads the `admin_users` **table**, so the legacy route cannot mint an admin who passes `requireAdmin` | SA §15 S-4 | Step 0's scope is the settings and pricing routes that Layer 2 depends on. `requireAdmin` now exists and is tested, so the sweep is a mechanical follow-up — and each of those routes needs its own Zod and Pino pass, which is a separate review |
| F-3 | `lib/audit/admin-helpers.ts:76,100,124,148` write the unregistered `reward_config` entity type, producing four pre-existing `tsc` errors | §4.6 `tsc` output | The same one-line fix as D-10, but for a system Layer 2 does not touch; grouped with the reward-config work |
| F-4 | Pricing `sync` still does ~40 sequential round trips (now inside `syncMany`) | SA §15 optimisation note | Correctness and attribution first; batching is a performance change that deserves its own test |
| F-0 | **The route-level hole is still open in production until Step 0 deploys — this is now the top priority for the cycle.** The migration (applied 2026-09-20) closes *direct* `anon`/`authenticated` access to both tables, but the still-deployed admin routes write with the **service role**, which bypasses RLS entirely, and they are unauthenticated in production. So anyone can still rewrite pricing or any system setting through `/api/admin/system-config*` until the Step 0 code ships | §4.4 (the live read + post-apply verification); the pre-Step-0 routes on `main` | Not a follow-up to defer — it is the reason Step 0 deploys alone and first (§4.7). Shipping the deploy is what closes it; nothing else in this workplan does |
| F-5 | **Migration filename sorts before ten already-applied migrations** (QA D-Q5): `20260920a_…` sits behind `20260922_…`–`20260930_…`, and the letter suffix is non-numeric | QA §QA-7 | Harmless under the documented manual SQL-editor apply, and the file is already referenced by name in §4.2, §4.4, §4.6 and three Change History rows. Renaming it now would churn the doc while it is under review; the Step 1 seed migration (`20261002_…`) restores chronological order |
| F-6 | **The static data-access gate is string-matched** (QA D-Q8): `not.toContain('createClient')` also trips on the word in a comment, and a relative `../../../../lib/supabaseServer` import or a `.from(TABLE)` constant would slip past | QA §QA-7 | It does its job for the current code (all four route files are clean and use `@/` imports). Tighten to an AST or import-graph check when the gate is next touched — a Step 1 candidate, since Step 1 adds the resolver's own import rules |
| F-7 | **`npm run dev` cannot start on Windows** (QA D-Q10): the script pipes through `grep`, which `cmd.exe` does not have | QA §QA-7 | Pre-existing and unrelated to Step 0; `npx next dev` is the workaround. Belongs to a tooling cleanup, not a security step |

---

## 5. Step 1 — Policy, schema, resolver, retry, change script, seed file (inert)

**Scope:** FR-2 to FR-8, FR-10, FR-11 (helper), FR-16 (file), FR-17 (script and log), the RC-11 family test, and the "before" half of AC-2. **Nothing calls the resolver**, so deploy is inert; the seed is applied **after** this merges (§9). **Size: L** (~700 lines of production code, ~1,100 lines of tests).

### 5.1 Files

| File | Action | Change |
|---|---|---|
| `lib/business-os/llm/modelSettingsPolicy.ts` | create | §3.1; the defaults per §10 "code default" column |
| `lib/business-os/llm/modelSettingsSchema.ts` | create | §3.2 |
| `lib/business-os/llm/modelSettings.ts` | create | §3.3, §3.4; `validateAreaRow` exported for the script |
| `lib/business-os/llm/modelFallback.ts` | create | §3.5 |
| `lib/ai/providers/openaiProvider.ts` | modify | Add `export function rejectsSamplingParameters(model: string): boolean` at module scope (N-2, Q-4). **RC-W5 (option chosen: the first of SA's two):** also export `usesMaxCompletionTokens(model)` at module scope, and make the private method delegate to it, so its behaviour is byte-identical. The token guardrail uses both (§3.3). **No change** to the provider's request building. Chosen over "reject `o1*` outright" because it is generic: any future reasoning family outside the `max_completion_tokens` list is caught by the same rule |
| `scripts/bos-llm-settings.ts` | create | §3.6, incl. `verify-stored` (canonical check) and `verify-equivalence` (RC-W1). Joins the `typecheck:bos-llm` scope as a caller of a CORE dir (RC-W9) |
| `supabase/migrations/20261003_seed_bos_llm_area_settings.sql` | create | §3.7 (file only, **not applied**). Renamed from `20261002_…`: that timestamp was taken by the merged `20261002_profiles_role_privilege_guard.sql` (D-19) |
| `lib/business-os/llm/__fixtures__/seededRows.ts` | create | The eight seeded rows as data, shared by T1-9 and T1-14. In `__fixtures__` so Jest does not collect it as a suite (D-20) |
| `lib/ai/pricing.ts` | modify | SA addendum §E: reads through `aiModelPricingRepository.listActive()`, its module-level `createClient` deleted, its **9 `console.*` converted to Pino**, and the oldest-price-wins cache bug fixed. Gains `isInputOnlyPricedModel` for the D-14 alert narrowing |
| `lib/repositories/AiModelPricingRepository.ts` | modify | Adds `listActive()` (not retired, `effective_date` DESC), the method Step 0 deliberately left out |
| `lib/repositories/__tests__/AiModelPricingRepository.test.ts` | modify | `listActive` cases; `is` added to the client double's chain |
| `lib/ai/__tests__/pricing.test.ts` | create | The move, the cache-order fix, and that the `> 0` rule stayed out of `hasPricing` |
| `app/api/admin/system-config/pricing/route.ts` + its test | modify | **D-14 / QA D-Q9 narrowing**, which the Step 0 review assigned to Step 1: the zero-price alert no longer fires on an input-only embedding model's legitimate `output: 0` |
| `lib/business-os/llm/__tests__/modelSettingsPolicy.test.ts` | create | T1-2, T1-3 |
| `lib/business-os/llm/__tests__/modelSettings.test.ts` | create | T1-4 … T1-8, T1-10, T1-12 |
| `lib/business-os/llm/__tests__/modelFallback.test.ts` | create | T1-11 |
| `lib/business-os/llm/__tests__/modelSettingsSeed.test.ts` | create | T1-9 |
| `lib/ai/providers/__tests__/openaiProvider.samplingFamily.test.ts` | create | T1-7 |
| `scripts/__tests__/bos-llm-settings.test.ts` | create | T1-13, T1-13b |
| `lib/business-os/llm/__tests__/callParams.snapshot.test.ts` + `__snapshots__/` | create | **T1-14: AC-2 "before".** One test per in-scope call. It mocks `ProviderFactory.getProvider('openai').chatCompletion`, `getProviderFactory().complete`, `generateImage`'s provider and the repository reads, drives each site once, and snapshots `{ provider, model, hasTemperature, temperature }`, plus whether a call was made, with the old keys absent and set to fixture values. Committed on today's code |

### 5.2 Tasks

- ✅ **T1.0** Baselines recorded (§5.4): `typecheck:bos-llm` 146 files / 30 errors / 0 new; full `tsc` 2,034 errors excluding generated `.next/types`.
- ✅ **T1.1** Policy module with every call's default from §10. `IMAGE_GENERATION_CONFIG_DEFAULTS.model` is referenced, not copied (N-8). `website/full_site`, `field_regenerate`, `testimonial_enhance` are `switchable: false` until Step 3 (RC-W8b).
- ✅ **T1.2** Schema.
- ✅ **T1.3** Resolver: typed signature (RC-W7a), `isBosLlmAreaEnabled` (RC-W7d), refill, guardrails (defaults never checked, `hasPricing` memoised per refill: RC-W7b/c), locks, reasoning rule incl. the `o1` / `max_tokens` rule (RC-W5), cache, change-seen log, never-throw.
- ✅ **T1.4** `rejectsSamplingParameters` and the module-level `usesMaxCompletionTokens` (private method delegates) in `openaiProvider.ts`.
- ✅ **T1.5** Retry helper and classifier.
- ✅ **T1.6** Change script: `get`, `set` (locked fields rejected, `--include-calls`), `verify-stored` (canonical check), `verify-equivalence` (RC-W1, RC-W8).
- ✅ **T1.7** Seed migration file (`20261003_…`, D-19), with the pre-check, post-check and rollback SQL in its header.
- ✅ **T1.8** Tests T1-2 … T1-14 written and passing; gates re-run (§5.4). **Plus** the SA addendum §E move of `lib/ai/pricing.ts` and the D-14 alert narrowing, both with tests.
- ⬜ **T1.9** SA code review (including the seed SQL) → QA → user → RM merges and deploys (inert).
- ⬜ **T1.10** **Apply order** (§9 P-1 … P-6, incl. P-5b): the user runs the pre-checks, applies the seed, runs the post-check and the equivalence check; QA records AC-13 items 1–2.

### 5.3 Tests

| ID | Asserts | AC |
|---|---|---|
| T1-2 | Type-level: `// @ts-expect-error` fixtures where (a) a policy map missing one catalog call and (b) `resolveBosLlmSettings('insights', 'insight_contnet')` (a typo) and a mismatched area/call pair each fail to compile (RC-W7a); checked by the `typecheck:bos-llm` scope, since the file sits under `lib/business-os/llm/` | FR-3 (AC-12) |
| T1-3 | Every catalog call is either in the policy or in `BOS_LLM_SETTINGS_EXCLUDED_CALLS` (exactly the four embeddings); all `allowedProviders` are `['openai']`; onboarding not switchable; planner locked at 0; the three deferred website calls `switchable: false` in Step 1/2 (RC-W8b); **every code default passes the guardrails** (RC-W7b); a row value equal to the default triggers no `hasPricing` call | FR-3, DEC-5 |
| T1-4 | Precedence per field (call → area → default); absent inherits; `temperature: null` → `undefined` (not sent); unknown `calls` name and unknown top-level key → ignored + warn; `getByKeys` called with exactly the eight keys; `getByCategory` never called | AC-3 |
| T1-5 | Missing row → defaults (debug); non-object row (string `"x"`, array, number) → area defaults + error; one bad field falls back alone; repository `{ error }` → last good, or defaults when none; repository throws → same; resolver never rejects | AC-4 |
| T1-6 | Rejected with an error log naming area/call/field/reason: unpriced token model (`hasPricing` → false), image model missing any size × {low, medium, high}, provider `anthropic`, temperature 1.5 and -0.1, `enabled: "false"`. Accepted: temperature 0 for `analysis`; a priced model; `hasPricing` called on refill only (N calls → 0 extra), and **once per distinct `provider:model` per refill** even when three calls name the same model (RC-W7c) | AC-5 |
| T1-7 | `rejectsSamplingParameters`: true for `gpt-5`, `gpt-5.4-mini`, `o3`, `o4-mini`, `o1`; false for `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-image-1`. Module-level `usesMaxCompletionTokens` returns exactly what the private method returned for the same list (delegation, zero behaviour change). Resolver: such a model on `insights` → temperature not sent + warn; the same model on `planner` and on `analysis` (N-1) → model rejected, default used; **`o1` (priced) on any token call, e.g. `insights`, → model rejected, default used (RC-W5)** | AC-15 |
| T1-8 | `enabled: false` on the onboarding area, on an onboarding call, and on `calls.planner`; `calls.planner.temperature: 0.5`; temperature on `images` → each ignored + warn, locked value used | AC-6 |
| T1-9 | Seed SQL (static): eight `INSERT … ON CONFLICT (key) DO NOTHING` with category `business_os_llm`; the default JSON of each row parses and **passes `validateAreaRow`**; resolving the default rows gives exactly §10's "after" column; the six unwrap expressions are present; the `superseded` update is guarded | FR-16, AC-2 (seed side) |
| T1-10 | Fake timers: a changed row is not seen at 59 s and is seen at 60 s; after a read error the next attempt is at 10 s, and calls in between do not query; concurrent callers → one query | AC-7 |
| T1-11 | Model-not-found (404 `model_not_found`) on a non-default model → exactly one retry with the default, error log, negative cache hit on the next call within 60 s (no failed attempt); the same error on the default model → rethrown, no retry; 429, timeout and 500 → rethrown, no retry; `modelUsed` returned. **With a real `runAiAction` + `withUsageScope` and a mocked provider that goes through `callWithTracking`:** one audit entry, `callCount 2`, `failedCallCount 1`, both models, outcome `succeeded`, and a 0-token failed ledger row | AC-8 |
| T1-12 | Change-seen log: a second refill with a changed `leads.enabled` logs info `{ area: 'leads', changes: [{ field: 'enabled', from: true, to: false }], rowUpdatedAt }`; the first load logs nothing; a sentinel prompt string is never logged | FR-17 |
| T1-13 | Script: an unpriced model or temperature 1.5 → non-zero exit, `set` never called; **a locked field (onboarding `enabled`, `calls.planner.enabled`, `calls.planner.temperature`, images `temperature`) → non-zero exit, nothing written (RC-W8a)**; `set leads --enabled false` with a stored `calls.reply_recommendation.enabled: true` → refuses and lists it; with `--include-calls` → writes both as `false` (RC-W8c); a valid row → `set(key, row, 'business_os_llm', …)`; `--dry-run` writes nothing. `verify-stored`: `"no"`, `"0"`, `0`, `" gpt-4o "`, `"\"gpt-4o\""` each flagged non-canonical → non-zero exit; canonical values (`true`, `"TRUE"`, `"gpt-4o-mini"`) pass | AC-16 |
| **T1-13b** | **`verify-equivalence` (RC-W1b, P-5b):** with the legacy getters and the resolver fed the same fixture store, matching values → exit 0; a fixture where the legacy reader returns `false` (e.g. stored `"no"` on `lead_reply_recommender_enabled`) but the seeded row resolves `true` → non-zero exit naming the field; a model mismatch → non-zero exit; the script never writes | AC-2, AC-13 |
| T1-14 | AC-2 "before" snapshot (above) | AC-2 |

### 5.4 Gates

Run by Dev on 2026-09-20 in the worktree `neuronforge-llm-layer2-step1` (branch `feature/business-os-llm-layer2-step1`, off `main` `ba25fb9a`). Nothing is committed.



| Gate | Result |
|---|---|
| `npm run typecheck:bos-llm` — **before** | `146 files in scope, 30 errors, 0 new` — passed |
| `npm run typecheck:bos-llm` — **after** | `typecheck-bos-llm: 168 files in scope, 30 errors, 0 new` — passed (re-run 2026-09-21). **`scripts/typecheck-bos-llm.baseline.json` unchanged** (never regenerated) |
| Scope `--list` diff (RC-W9) | **+12 source files, all expected**: the 4 new `llm/` modules, the 5 new `llm/` tests, `__fixtures__/seededRows.ts`, `scripts/bos-llm-settings.ts` (catalog-importer) and `scripts/__tests__/bos-llm-settings.test.ts` (caller). **No repository joined the scope** (N-8 holds). A later run reported 168 rather than 158: the extra 10 are generated `.next/types/app/api/**` route files that exist only because `next build` had been run in the same worktree. They are build output, not source, and carry no errors |
| `npm run build` | `✓ Compiled successfully` (re-run 2026-09-21), full route table emitted. (The `DYNAMIC_SERVER_USAGE` log lines during page-data collection are pre-existing and unrelated.) |
| `npx jest lib/business-os/llm lib/ai lib/repositories scripts/__tests__ app/api/admin/system-config` | **39 suites, 535 tests, 1 snapshot — all passed** (re-run 2026-09-21 after the QA fixes; 523 → 533 → 535) |
| **S1-1 — the script, run end to end against production (read-only)** | `npm run bos:llm-settings` → usage, **exit 2**. `-- get leads` → **exit 0**, `rowPresent: false`, resolved `{ enabled: true, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 }`. `-- verify-stored` → **exit 0**, six × "Not stored; the seed will use the code default", then "All stored legacy values are canonical and accepted". `-- verify-equivalence` → **exit 0**, six × "Legacy reader and resolver agree", then `{ checked: 6 }` "Legacy readers and resolver agree on every field". Each run first logged `{ command, supabaseHost: 'jgccgkyhpwirgknnceoh.supabase.co' }` (S1-11) |
| **S1-2 — mutation proof of the evidence window** | Each of SA's four mutations in `WebsiteAIContentService.ts` now fails the right test, one at a time: `:401` hero model → `× website/hero_content`; `:403` hero temperature → `× website/hero_content`; `:316` field_regenerate model → `× website/field_regenerate`; `:361` testimonial model → `× website/testimonial_enhance` (each `Tests: 1 failed, 26 passed`). File restored → `Tests: 27 passed`. |
| **D-Q1 — QA's seven mutations, plus the eighth SA/QA asked for, re-run after the fix** | Each applied alone, suite run, file restored from a byte-for-byte backup. **All eight now CAUGHT** (each `Tests: 1 failed, 28 passed, 29 total`): `Planner.ts:447` `model,` → literal → `× chat/planner`; `AnalysisService.ts:127` → `× chat/analysis`; `LeadReplyRecommender.ts:103` → `× leads/reply_recommendation`; `providerFactory.ts` pins the model (12 of 22 calls) → `× complete() passes the caller's model through and synthesises no temperature`; `providerFactory.ts` forces `temperature ?? 0.9` → same test; `openaiProvider.ts` `chatCompletion` pins the model (8 calls) → `× chatCompletion() spreads the caller's params and pins nothing`; a duplicate `model:` key in `InsightRepository` insight_content → `× insights/insight_content`; a second call site sharing `callName: 'insight_content'` → `× insights/insight_content`. Tree restored → `Tests: 29 passed, 29 total`, and `git status --porcelain` back to the 8 modified + 16 untracked baseline |
| **S1-3 — mutation proof of the seed parser** | Migration insights `'temperature', 0.3` → `0.35` → `× writes exactly the rows the fixture describes, value for value` (`Tests: 1 failed, 9 passed`). Reverted → `Tests: 10 passed`. |
| No `'use client'` module imports the resolver, the policy, the schema or the fallback | grep over `app/`, `components/`, `lib/`, `hooks/`: **none** |
| Owner usage-route snapshot | untouched (`app/api/business-os/usage/__tests__/__snapshots__/route.test.ts.snap` not modified) |
| Full `tsc` (pre-existing baseline, informational) | **2,038 errors; 2,034 excluding generated `.next/types`** — unchanged from the documented baseline, and **0 of them in any file this step touched**. Needs `NODE_OPTIONS=--max-old-space-size=8192` |

**Worktree note (not a code change):** the worktree had no `node_modules` and no `.env.local`; both were provided from the main checkout (a `node_modules` junction, and a copy of `.env.local`, which is git-ignored and does not appear in `git status`). `npm run build` cannot collect page data without the Supabase env vars.

### 5.5 Rollout notes

No call site imports the resolver, so **nothing in Business OS changes behaviour on this deploy**. The seed is applied **after** this deploy and **before** Step 2 merges (§9).

**One thing was not provably inert, and it is not Business OS (S1-4) — now measured: no billing impact.** `lib/ai/pricing.ts` moved to the repository in this step, and with it the fix for a latent bug: the cache kept the **oldest** price for any model with more than one active `ai_model_pricing` row, because the rows arrive newest-first and every row overwrote the last. From this deploy such a model is charged at its **newest** rate — across the whole product, not only Business OS — and a price dated in the future no longer charges before its date (S1-5).

**Evidence, measured on production on 2026-09-20 (the §9 step 1b query, read-only):** three models have more than one active row, and in every one the minimum and maximum input rate are **identical**:

```
anthropic | claude-3-5-sonnet-20241022 | 4 active rows | input 0.00000300 = 0.00000300 | 2024-10-22 .. 2026-06-29
anthropic | claude-3-haiku-20240307    | 4 active rows | input 0.00000025 = 0.00000025 | 2024-03-07 .. 2026-06-29
openai    | gpt-4o-mini                | 4 active rows | input 0.00000015 = 0.00000015 | 2024-07-18 .. 2026-06-29
```

The same check on `output_cost_per_token` (`HAVING count(*) > 1 AND min(output) <> max(output)`) returned **zero rows**.

**Conclusion: the newest-price-wins fix changes no charge, on either side, today.** Picking the wrong row among identical prices was never visible, which is precisely why the bug survived. **The guarantee is not permanent** — it holds only while duplicate rows stay price-identical — so §9 step 1b stays in the plan as a **re-check before every deploy that carries this reader**, not as a one-off. See also the follow-up in §5.8: those duplicates should not exist in the first place.

---

### 5.6 Implementation notes and deviations (Dev, 2026-09-20)

| # | Note |
|---|---|
| D-18 | **A locked field is reported only when it would CHANGE something, and only at the level that targets that call.** Two cases forced this, both found by the tests: (a) the seeded chat row sets `temperature: 0` at the **area** level for `analysis`, and the planner's temperature is locked at 0 — reporting the area value as an ignored field would warn on every refill and, worse, would make `validateAreaRow` refuse the very row the seed writes; (b) the seeded onboarding row sets `enabled: true` on an area that is always on. So: a **call-level** locked value is reported unless it equals the locked value, and an **area-level** locked value is reported only for `enabled` on the onboarding area and for `temperature` on images, where the area has no other call it could be meant for. A thwarted intent (planner `enabled: false`, planner `temperature: 0.5`, onboarding `enabled: false`, any image temperature) still warns in the resolver and still makes the change script exit non-zero (RC-W8a). |
| D-19 | **Seed migration renamed to `20261003_seed_bos_llm_area_settings.sql`.** §3.7 specified `20261002_…`, but `20261002_profiles_role_privilege_guard.sql` was merged to `main` (PR #65) in the meantime. `20261003` keeps the file after the Step 0 policy migration and in chronological order. |
| D-20 | **`SEEDED_ROWS` lives in `lib/business-os/llm/__fixtures__/seededRows.ts`,** not inside a test file: two suites need it (T1-9 proves the SQL matches it, T1-14 proves resolving it reproduces today), and Jest's `testMatch` collects everything under `__tests__/`, so a fixture there would fail as an empty suite. |
| D-21 | **T1-14 proves the AC-2 "before" side from the call sites' SOURCE, not by driving each of the 12 services.** §5.1 described a test that mocks the provider and the repository and "drives each site once". Driving 22 calls across 12 services (each with its own Supabase, repository and audit dependencies) is a large mocking surface for assertions that are still only about `{ provider, model, temperature }` — and Steps 2 and 3 must drive those sites anyway (T2-S / T3-S), which is where the real request is compared. The test proves the same claim three ways instead: **(A)** for every one of the 22 calls it reads the call site's own file and asserts today's value is still written where the inventory says it is — the literal, the constant (`OPENAI_MODELS.GPT_4O_MINI`, `MODEL`) or the stored key — and that the four onboarding extractors and the image call still send **no** temperature; **(B)** with no configuration at all the resolver returns exactly that table; **(C)** with the eight seeded rows it returns the same table again, and that result is the committed snapshot. (A) is what keeps the policy honest against the code; it is expected to be replaced call by call in Steps 2–3 as each literal leaves its file, after which the FR-15 gate forbids the literals outright. **For SA: this is the one place the implementation is narrower than §5.1 as written.** |
| D-22 | **The change script also refuses an unknown call name or an unknown top-level key** (§3.6 required only rejected and locked fields). An operator writing `calls.insight_contnet` would otherwise get exit 0 and a row that does nothing. The resolver still only warns and ignores, as DEC-2 requires. |
| D-23 | **`BOS_LLM_AREA_KEY_PREFIX` is duplicated, deliberately, in `app/api/admin/system-config/route.ts` (S-8).** Having the route import the policy module would pull the whole route — and everything it imports — into the `typecheck:bos-llm` scope for one string. Instead `modelSettingsPolicy.test.ts` reads the route's source and asserts the two constants are equal, so they cannot drift. |
| D-24 | **D-14 / QA D-Q9 closed here, as the Step 0 review assigned.** `reportZeroPrice` now alerts when the **input** cost is 0, or when the **output** cost is 0 **and** the model is not input-only. The predicate is `isInputOnlyPricedModel(provider, model)` in `lib/ai/pricing.ts` (`text-embedding-*` on OpenAI), placed beside the price table that documents those rows. It changes **no** charge: `calculateCost`, `calculateCostSync` and `hasPricing` are untouched, and a test asserts `hasPricing` still says yes to an embedding model and to a 0/0 row — which is exactly why the Layer 2 guardrail uses `getPricing(…).input > 0 && .output > 0` instead (SA addendum §F.5–F.6). Three route tests cover it. |
| D-25 | **`lib/ai/pricing.ts`: 9 `console.*` converted to Pino** (`createLogger({ module: 'AiPricing' })`), flagged to the user with the move. Two notes: the per-call "Calculating cost for …" and "Cost breakdown" lines are now **debug** (they ran at `log` level on every billed call), and the oldest-price-wins cache bug is fixed by keeping the FIRST row per `provider:model`, with a `superseded` count in the load log so duplicate rows stay visible. Per D-17 an empty result is logged as `activeRows: 0` — "the query matched nothing" — which is distinguishable from a failed read. |
| D-26 | **`GuardrailContext`, `FieldCheck`, `checkModelAcceptable` and `evaluateAreaRow` are exported** from `modelSettings.ts`. `checkModelAcceptable` exists so T1-3 can prove every **code default** would itself pass the guardrails with the "equals the default" shortcut bypassed — the claim that makes RC-W7b safe. That test runs against the **real** pricing module with the database read empty, so the proof is against the in-code price table we actually ship. |
| D-27 | **How `enabled` resolves for a locked call, for the Step 2/3 call sites.** §3.1 says a locked call reports `enabled: true`; §3.3 says the planner "follows the chat area's switch". Implemented as §3.1 states: a non-switchable call (planner, the four onboarding extractors, and the three Step 3 website calls) **always** resolves `enabled: true`, and chat's area switch is enforced at route entry through `isBosLlmAreaEnabled('chat')` (RC-W7d), never through the planner's own flag. This keeps the three deferred website calls truthful in Step 2, where their off paths do not exist yet. |


---

### 5.7 Response to the SA Step 1 review (Dev, 2026-09-20)

Every item is addressed in code; nothing is deferred. Re-run gates in §5.4.

| SA item | What was done |
|---|---|
| **S1-1** (High) — the script cannot be run as documented, so P-3 and P-5b are unrunnable | **Fixed and proven by running it.** Added `npm run bos:llm-settings` (`tsx --import ./scripts/env-preload.ts scripts/bos-llm-settings.ts`) and corrected the invocation in all four places: the script header, the migration header (P-3 / P-5 / P-5b lines), §3.6 and §9. The script header now explains *why* the plain form cannot work (the service client is built at import, before any statement the script could run), so nobody "simplifies" it back. **Run end to end against production, read-only** — output in §5.4: no-args → usage, exit **2**; `get leads` → exit **0**; `verify-stored` → exit **0**, all six legacy keys *not stored*; `verify-equivalence` → exit **0**, `checked: 6`, "Legacy readers and resolver agree on every field". Two facts for the apply: **no `bos_llm_area_*` row exists yet** (P-1 looks clean) and **none of the six legacy keys is stored**, so the seed will write the code defaults. |
| **S1-2** (High) — four calls' evidence is satisfiable by a sibling's identical literal | **Fixed and proven by mutation.** The window is now clamped to the anchor's own call block, bounded by the neighbouring `callName:` / `callContext(owner, …)` anchors. Two layouts exist and the test knows which is which: most sites build the request *before* naming the call (block = previous boundary → this anchor), the four onboarding extractors name the call *first* (`side: 'after'`, block = this anchor → next boundary). SA's four mutations now each fail the right test — see §5.4 — and the file was restored green. |
| **S1-3** (Medium) — T1-9 checks the seed SQL by substring only | **Fixed.** T1-9 now parses the migration's own `jsonb_build_object(…)` trees — including the `stored.*` columns, resolved through the CTE's `COALESCE` defaults — and compares them with the fixture value for value, plus a second case asserting those six defaults are today's values. Proven by mutating the migration (insights `0.3` → `0.35`): the new test fails, and passes again on revert. |
| **S1-4** (Medium) — the newest-price-wins fix is a real charging change in a step sold as inert | **Measured on production 2026-09-20: no billing impact, evidence in §5.5.** Three models have 4 active rows each, all price-identical on input; the output-side check returned zero rows. So the fix changes no charge today — which is also why the bug stayed invisible. §5.5 carries the raw evidence and the explicit conclusion, and §9 step **1b** keeps the query as a **re-check before every deploy that carries this reader**, because the guarantee lasts only while the duplicates stay price-identical. The duplicates themselves are a data-hygiene follow-up (§5.8). |
| **S1-5** (Medium) — `listActive()` has no date filter and no tie-break | **Fixed.** `.lte('effective_date', <today UTC>)` so a price entered ahead of time starts on its date rather than when it is saved, plus `.order('created_at', { ascending: false })` as a deterministic secondary sort. Both documented in the method and tested. |
| **S1-6** (Medium) — the repository header's "every caller is admin-gated" is now false | **Fixed.** The header states the two permitted caller classes: the admin surface (routes and operator scripts, behind `requireAdmin`) and the single ungated **billing reader** `lib/ai/pricing.ts` (`listActive()` only), with why that one is safe — read-only, no caller-supplied filter, platform-wide price labels, never returned to a browser, cached — and the rule "no caller outside these two". |
| **S1-7** (Medium) — the website kill switch is partial *and silent* until Step 3 | **Fixed.** `set <area> --enabled false` now lists, by name, every call in that area that cannot be switched off and will keep spending, at warn, with "PARTIAL SWITCH". A warning, not a refusal — refusing would make the switch useless for the five calls it does cover. It is computed from the policy via `isSwitchableBosLlmCall`, so it disappears by itself when Step 3 flips the three website calls to `switchable: true`. §7.5 records it; the runbook (Step 4, FR-18) must repeat it. Two tests: website warns and names the three; insights does not warn. |
| **S1-8** (Low) — provider and model can decohere on a fallback | **Fixed** (one line): when the model ends up at the code default, the default's provider goes with it. Unreachable today, tested anyway, because the trap is waiting for the first call that allows a second provider. |
| **S1-9** (Low) — D-18 hides an area-level locked temperature that differs | **Fixed as the ruling requires.** An area-level temperature that differs from a locked value is now reported as `adjusted`: visible in the resolver's warn log and in `get`, non-blocking for the change script, and still silent for the seed's `0 === 0`. Tested both ways. |
| **S1-10** (Low) — the RC-11 "temperature dropped" issue always says `level: 'area'` | **Fixed:** reported as `level: 'call'` with the call name, with a comment that it is a per-call decision taken after resolution, not a claim about which level the value came from. |
| **S1-11** (Low) — the verify commands do not say which database they are talking to | **Fixed:** every command logs `{ command, supabaseHost }` before doing anything. Host only, never a key. Tested. |
| **S1-12** (Low) — the superseded marker turns a NULL description into the key | **Fixed:** `COALESCE(description, '')`, so a row that had no description ends up with none again after the documented rollback. |


---

### 5.8 Follow-ups recorded out of Step 1 (do not widen this step)

| # | Item | Evidence | Why not now |
|---|---|---|---|
| FU-1 | **`ai_model_pricing` accumulates identical active rows.** Each of the three models in §5.5 carries **4 active rows that differ only by `effective_date`** (2024 … 2026-06-29), same provider, same model, same rates. That is how the oldest-price-wins bug stayed invisible for so long: with identical prices, choosing the wrong row never showed up on a bill. If the catalogue sync keeps stamping a fresh `effective_date` on every run, the count grows without bound — every duplicate is another row the reader must sort past, and another chance for a real price difference to hide among look-alikes. **Cross-reference S1-5:** `effective_date <= today` plus the `created_at` tie-break is what makes the choice among identical-looking rows well-defined; it does not stop them being created. Candidate owner: whoever next touches the pricing sync (see D-9 — the sync's `.single()` duplicate hazard was fixed in Step 0, but it still re-stamps the date each run). **Not acted on in Step 1** — deleting or retiring production price history is a data change with its own review, and it is not needed to make this step safe | §5.5 (measured 2026-09-20); §4.8 D-9; `pricing/sync/route.ts` | Step 1 must not change production data. The measurement says the reader is safe today; the clean-up is a separate, reviewed change |


---

### 5.9 Response to the QA Step 1 report (Dev, 2026-09-21)

| QA defect | What was done |
|---|---|
| **D-Q1** (High) — seven mutation-proved false negatives in T1-14 leg (A) | **Fixed; the waiver was not taken.** Three additions, one per blind spot. **(a) The stored-key calls:** `chat/planner`, `chat/analysis` and `leads/reply_recommendation` now assert that the request object passes the resolved variable itself — `/^\s*model,\s*$/m` inside the call's own block — so `model,` → `model: 'gpt-4o',` fails. **(b) The shared builders:** a new describe block reads `providerFactory.complete()` and `openaiProvider.chatCompletion()` directly and asserts each forwards the caller's model unchanged (`model: params.model,`; `{ ...params, stream: false as const }`; `params.model` to `callWithTracking`), pins no model (no quoted `model:`), and synthesises no temperature (`complete()` forwards one only inside `if (params.temperature !== undefined)`, with no `??` default and no numeric literal; `chatCompletion` mentions temperature nowhere). **(c) The two text escapes:** every anchor must occur **exactly once** in its file (a second call site for the same call name now fails), and every model evidence item asserts the block contains **exactly one** `model:` / `model,` assignment (a duplicate key, which wins in JavaScript, now fails). |
| **D-Q2** (Medium) — no read timeout; a hung read blocks every caller for ever | **Fixed.** `BOS_LLM_SETTINGS_READ_TIMEOUT_MS = 3_000`: the refill races `getByKeys` against a budget and a hang now lands on the ordinary failure path — last good settings, or the code defaults on a cold start, warn log, retry in ten seconds. The timer is cleared in a `finally` and `unref`'d so it can never hold a serverless invocation open. **Deliberately NOT stale-while-revalidate** (SA's and QA's suggestion): serving a stale snapshot while refreshing in the background would mean a changed row takes effect on the call *after* the 60-second boundary, and **AC-7 says in as many words that a changed row is used *at* 60 seconds**. **Corrected cost (R-2):** while a database really is stalled it is not "one call a minute" — **every** call arriving inside the budget window waits for it, i.e. roughly **3 seconds in every 13** (3 s budget, then a 10 s back-off during which callers are served the last good settings with no wait). That is bounded and logged, and strictly better than the unbounded wait it replaces. **SA upheld the call (2026-09-21):** keep it exact, no stale-while-revalidate, AC-7 unchanged — under SWR an emergency "off" always lets one more paid call through per instance, and on a low-traffic instance the refresh makes the switch's latency unbounded; a rare bounded wait is the better trade for a kill switch. |
| **D-Q3** (Low) — `verify-stored` says "checked: 6" when six keys were absent | **Fixed.** It now counts present and absent separately and says which: with nothing stored it reports "No legacy value is stored: nothing to check, and the seed will write the code defaults for all six", and with some stored, "N stored legacy value(s) are canonical and accepted; M not stored (code defaults)". Both key lists are in the log fields. |
| **D-Q4** (Low) — P-5b passes vacuously on this database | **Recorded, not papered over.** §9 P-5b now states plainly that on a database where none of the six keys is stored — production, as measured — it exercises no unwrap branch at all, so it compares the legacy readers' *fallbacks* with the migration's *literals*; RC-W1's real failure mode is covered by T1-13b's fixtures and by P-3. |
| **D-Q5** (Low) — a priced image model is accepted on a token call | **Fixed.** `checkTokenModel` refuses a model whose family is an image family (`isImageModelName`, prefix-based: `gpt-image`, `dall-e`, `imagen`), with reason `image_model_on_token_call`, before any price lookup. The old defence was an accident — `gpt-image-1` missing from the in-code price table — and one operator-added pricing row removed it; the resulting 400 is not `model_not_found`, so the retry could not have recovered it. |
| **D-Q7** (Low) — the seed SQL has never been parsed by PostgreSQL | **Recorded, with the check that closes it.** §9 gains **P-3b**: `BEGIN;` → the migration → `ROLLBACK;` in the SQL editor before P-4, expecting 8 rows and no error. Also in the migration header. No test can do this; saying so is the honest answer. |
| **D-Q8** (Low) — the rollback leaves `''` where the description was `NULL` | **Fixed** in the migration header's rollback: `NULLIF(replace(…), '')`, with the reason beside it. |
| **QA's P-5c** (re-runnability proved, not asserted) | **Folded into §9** and the migration header: fingerprint the eight rows with `md5(value::text)`, apply the file a second time, re-fingerprint — identical, and `updated_at` unmoved. |
| **D-Q6** (environment) | **Not a code defect and not worked around.** The shared `node_modules` lost every entry sorting before `@next` (including `.bin`, `@babel` and `@jest/core`), so `npx jest`, `node node_modules/jest/bin/jest.js` and `tsx` are all unrunnable from this worktree — confirmed again at the start of this pass. The gates for this round are therefore **BLOCKED pending `npm ci` in the main checkout** (§5.4). |


---

### 5.10 Response to the SA re-check (Dev, 2026-09-21)

| SA item | What was done |
|---|---|
| **R-1** (Medium, must fix) — the budget covered only `getByKeys`; the same refill's `getPricing` / `getImageGenerationConfig` awaits were unbounded behind the shared in-flight promise | **Fixed.** The budget now races the **whole refill**: `withReadBudget(buildSnapshot())`. `buildSnapshot` was made **free of side effects** in the same change — it touches no module state and writes no log line — so a build that loses the race and keeps running in the background can never overwrite the snapshot served in its place, nor log settings nobody used; the logging and caching happen in `refill` after the race is won. **Proved, not asserted:** the new test hangs the price lookup on a row that configures a non-default model, and on the **pre-R-1 shape** (budget on the row read only) it fails after 5,022 ms — `× falls back to today when the price lookup hangs, instead of waiting for ever` — while the row-read case still passes. With the fix, both cases settle at the budget with the ordinary warn and today's values, and a third case proves a warm instance serves its **last good** settings when a later refill hangs. |
| **R-2** (correction) — the stated cost of the timeout was wrong | **Corrected everywhere it was written:** §5.9, the Change History row of 2026-09-21, and the constant's own comment in `modelSettings.ts`. It is **not** "one call per instance per minute": while a database is stalled, **every call arriving inside the budget window waits for it — roughly 3 seconds in every 13** (3 s budget, then a 10 s back-off during which callers are served the last good settings with no wait). |
| **D-Q2 ruling** — upheld | Kept exactly as implemented: no stale-while-revalidate, AC-7 unchanged. SA's reasoning is recorded beside mine in §5.9, because it is the stronger of the two: under SWR an emergency "off" always lets one more paid call through per instance, and on a low-traffic instance the refresh makes the switch's latency unbounded — a rare bounded wait is the better trade for a kill switch. |
| **Leg (A) ruling** — stop hardening it; move the guarantee to the boundary | **Written into §6.3 and §7.3 so Steps 2 and 3 inherit it**, not left in this section where it would be missed: T2-S / T3-S **spy at `chatCompletion` / `complete`** and assert the **whole request object plus the call count**, and **each call's leg-(A) entry is deleted from `callParams.snapshot.test.ts` as its call site is wired**. Recorded with SA's two further escapes — rewriting `params` one line above the inspected slice, and a `...spread` after the recorded `model` (which `singleModel` does not count, because it counts assignments) — and the class they belong to: *the recorded text is still there but is not what reaches the provider.* Leg (A) stays as a **drift alarm** for the calls not yet wired; it gets no further hardening. |
| **R-3** (non-blocking) — P-5b / P-5c ordering differed between §9 and the migration header | **Fixed:** the header now reads P-5 → P-5b → P-5c, matching §9. |
| **R-4** (non-blocking) — S1-8 silently reverts a provider-only configuration | **Recorded, not built for** (below). |

**Known limitation (R-4).** S1-8 makes the provider follow the model: when the model ends up at the code default, the default's provider goes with it. A row that sets **only** `provider`, leaving the model to the default, therefore has its provider silently reverted. That is unreachable today — every call's `allowedProviders` is `['openai']`, so the only accepted provider *is* the default's — and building for it now would mean choosing between two wrong answers (a provider without a model it can serve, or a decohered pair) with no real call to test against. **The layer that first allows a second provider owns this:** at that point `provider` and `model` should resolve as one unit, per level, rather than field by field, and this note is the reason why.

---

## 6. Step 2 — Wire the non-chat areas

**Scope:** FR-12 for insights, briefing, intake, leads, onboarding (model/temperature only), website (`full_site` model/temperature and its build-path off; `landing_page`; `field_regenerate` / `testimonial_enhance` model/temperature; the dormant blocks), FR-11 at each site, FR-13 intake, and the existing-fallback off paths. **Requests are identical (AC-2).** **Size: M** (~12 sites, ~250 lines of production diff, ~500 lines of tests).

`field_regenerate` / `testimonial_enhance` off, and `full_site` off from the page and chat, need the ★ messages, so they move to **Step 3**. Until then these three calls are **`switchable: false` in the policy** (the existing lock mechanism, RC-W8b, Q-11): the resolver ignores an `enabled` value for them with a warn and reports `enabled: true`, and the change script rejects `enabled` for them. Step 3 flips them to `switchable: true`. This keeps Step 2 from shipping a half-built off path, with one mechanism and no `STEP3_PENDING_SWITCHES` set.

### 6.1 Files

| File | Change |
|---|---|
| `lib/business-os/insight/repository/InsightRepository.ts` | 3 sites (`:727`, `:1742`, `:2130`): resolve, off → the existing template branch, `withModelFallback` around `chatCompletion` |
| `lib/business-os/briefing/BriefingNarrator.ts` | `:114`: drop the `OPENAI_MODELS` import; resolve; off → composer |
| `lib/business-os/leads/LeadReplyRecommender.ts` | Drop `ENABLED_KEY` / `MODEL_KEY` reads (`:41-42`, `:95-98`); resolve; the existing `disabled` reason |
| `lib/services/IntakeGenerationService.ts` | Drop `MODEL` (`:57`); resolve; FR-13: `generated_from.model = modelUsed` (`:204`); off → the three generic questions |
| `app/api/intake/form/infer-question/route.ts` | `:135`/`:164`: resolve; off → the free-text question |
| `lib/services/OnboardingConversationManager.ts` | 4 sites (`:1066`, `:1112`, `:1220`, `:1537`): resolve model; temperature is sent only if resolved (seeded `null` → not sent); `enabled` ignored (locked) |
| `lib/services/WebsiteGenerationService.ts` | `:560`/`:566`: resolve model/temperature. Add the `onAiDisabled: 'fallback' \| 'fail'` option to `generateWebsite` (RC-W3), defaulting to `'fallback'`; the onboarding build passes `'fallback'` explicitly. In Step 2 `full_site` is locked on, so the option is wired but its off branch is reachable only in tests; the `'fail'` callers arrive in Step 3 |
| `app/api/website/landing-pages/generate/route.ts` | `:116`/`:127`: resolve; off → `getDefaultContent()` with the existing warning |
| `lib/services/WebsiteAIContentService.ts` | 6 sites (`:316`, `:361`, `:401`, `:450`, `:588`, `:650`): resolve model/temperature; dormant blocks off → templates |
| `lib/business-os/llm/__tests__/callParams.snapshot.test.ts` | Seeded-rows variant for these areas; must match T1-14 byte for byte |
| `lib/business-os/llm/__tests__/modelSettings.off.nonchat.test.ts` | create: T2-O |
| existing attribution tests for these services | Mock the resolver (a default-returning `jest.mock`) so they stay unchanged in assertion |

### 6.2 Tasks

- ⬜ **T2.0** Confirm §9 P-6 (seed applied and post-checked) **before merging**.
- ⬜ **T2.1** Insights ×3 · ⬜ **T2.2** Briefing · ⬜ **T2.3** Leads · ⬜ **T2.4** Intake ×2 (+ FR-13) · ⬜ **T2.5** Onboarding ×4 · ⬜ **T2.6** Website `full_site` (build path), `landing_page`, the AI-content service ×6.
- ⬜ **T2.7** Tests T2-S, T2-O, T2-R, T2-M, T2-M-I; gates.
- ⬜ **T2.8** SA → QA (AC-13 item 3 for these areas) → user → RM.

### 6.3 Tests

| ID | Asserts | AC |
|---|---|---|
| T2-S | **Spies at the provider boundary** — the mocked `ProviderFactory.getProvider('openai').chatCompletion` and `getProviderFactory().complete` — and asserts the **whole request object** and the **number of calls made**, per call site. **This is where the guarantee lives (SA ruling, 2026-09-21).** T1-14's leg (A) reads source text: it is a drift alarm, not a soundness proof, and SA demonstrated two further escapes on this tree that no amount of text matching closes (rewriting `params` one line above the inspected slice; a `...spread` after the recorded `model`, which `singleModel` does not count). **As each call site is wired in this step, delete its leg-(A) entry from `callParams.snapshot.test.ts`** — the boundary assertion replaces it, and Step 4's FR-15 gate then forbids the literal outright. **Drives each Step 2 call site once** with the seeded rows (and with F-3 fixture values) and captures the **whole request object at the provider boundary** — the mocked `chatCompletion` / `complete()` argument in full, not only `{ provider, model, temperature }` — plus **how many calls were made**. Both are compared with T1-14's snapshot and with the site's pre-Layer-2 request. This is what discharges §5.1's "drive each site once" (SA ruling on D-21, condition b): T1-14 proves the text at the call sites, T2-S proves the dataflow, so a parameter added by a wrapper, a value overridden downstream, a second call site for the same call, or a call that stops being made at all is caught here | AC-2 |
| T2-O | Per area: `enabled: false` → provider mock not called, the ledger tracker not called, `runAiAction` writes no entry, the existing fallback is returned (insights, briefing, intake ×2, leads, `landing_page`, dormant block). `full_site` with the lock lifted in the test policy and `onAiDisabled: 'fallback'` → starter copy with `reason: 'disabled'`. With the real Step 2 policy, `website.enabled: false` does **not** turn off `full_site`, `field_regenerate` or `testimonial_enhance` (locked, warn logged) | AC-9 (part) |
| T2-R | One site per mechanism (`chatCompletion`: insights; `complete()`: intake) with a 404 `model_not_found` on an overridden model → retried with the default | AC-8 (at site) |
| T2-M | Intake with `intake.model` overridden to a priced model → `generated_from.model` is that model; after a retry → the default | AC-10 (part) |
| **T2-M-I** | **(RC-W11)** Insights with an `insights.model` override to a priced model → the provider receives that model **and** the tracked ledger row's `model_name` is that model (through `callWithTracking`, not a mocked tracker) | AC-10 (part) |

### 6.4 Gates

As in Step 1 (incl. the RC-W9 `--list` diff: every Step 2 call site becomes a caller of `lib/business-os/llm/`), plus `npx jest lib/business-os/insight lib/business-os/briefing lib/business-os/leads lib/services app/api/intake app/api/website`. No new `'use client'` import path to the resolver (the website services are server-only; checked with `next build`).

### 6.5 Rollout notes

- **Must not merge before the seed is applied** (§9). If it were deployed first, leads would lose any stored `lead_reply_recommender_*` override for the window.
- After deploy, AC-13 item 3 (one action per area).
- **AC-13 items 4–5, the leads on/off cycle (switch lead-reply AI off with the change script, check the fallback and the info log, switch it back on): pending user decision.** No test environment exists yet, so this would run on the live system. The user is being asked whether that is acceptable. Until the user decides, QA does not run it and AC-13 items 4–5 stay open.

---

## 7. Step 3 — Chat, chat gates, images, the ★ messages

**Scope:** FR-12 for chat planner and analysis (stop reading `bizchat_*`); the chat v1/v2/v4 entry gates (RC-6); images (model into the area row, off → `unavailable`); the ★ messages (BQ-1); FR-13 planner `diagnostics.model`; and switching on the Step 2 deferred off paths. **Size: M–L** (~350 lines of production diff, ~600 lines of tests).

### 7.1 Files

| File | Change |
|---|---|
| `lib/business-os/bizql/planner/Planner.ts` | Drop the `SystemConfigService` import and `resolveModel` (`:118-124`); resolve `chat/planner`; temperature stays the policy's locked 0 (sent from the resolved value, so the `0` literal leaves the file); `withModelFallback`. **RC-W6:** `model` is resolved once at `:330` and then used by the 3-attempt loop (`:440`) and every `fail(...)` / `diagnostics({ model })` (`:505, 539, 550, 565, 663, 726, 737, 747`). After `withModelFallback`, reassign the loop's model to `modelUsed`, so repairs run on the model that worked and every diagnostics path reports it (FR-13) |
| `lib/business-os/bizql/analyse/AnalysisService.ts` | Drop `SystemConfigService` and both key reads (`:90-96`); resolve; off → the planner's sentence (existing) |
| `lib/business-os/llm/aiUnavailableMessages.ts` | create: `AI_UNAVAILABLE_CHAT: Record<'en'\|'he'\|'es', string>` (the three sentences, reviewed by the user) + `respondChatUnavailable(...)`. No catalog import. Note (RC-W9): its callers (chat v1/v2) join the `typecheck:bos-llm` scope anyway, because `lib/business-os/llm/` is a CORE dir |
| `app/api/business-os/chat-v4/route.ts` | Gate `isBosLlmAreaEnabled('chat')` **immediately before `if (!budget.allowed)` (`:736`)** (RC-W2, Q-10): after the in-progress fill (4a) and confirm/cancel (4) branches, before any planner, analysis or embedding call. Chat off + budget exhausted → the chat-off message wins. Returns the normal turn shape with the sentence. No LLM call, so no audit entry |
| `app/api/business-os/chat-v2/route.ts` | Gate after auth, the feature flag and Zod (RC-W2); language from `businessProfileRepository.findByUserId` only on the off path (N-7); the v2 success shape with the sentence |
| `app/api/business-os/chat/route.ts` | Gate after auth (v1); otherwise the same as v2 |
| `lib/services/GeneratedImageService.ts` | **RC-W4:** the resolved model replaces `config.model` in **both** the request (`:356`) and the price resolver (`imagePriceResolver(config.pricesUsd, <model>, …)`, `:344`). The price resolver is built **inside** the `withModelFallback` attempt, so the price follows `modelUsed` (otherwise an overridden model is priced as the old one, or at $0). Sizes/quality/prices unchanged. Off check **after the reuse check (`:309`)** and before the daily count → `{ ok: false, reason: 'unavailable' }` (N-4, Q-6) |
| `app/api/website/generate-from-profile/route.ts` | Call `generateWebsite(…, { onAiDisabled: 'fail' })` (RC-W3); on the `disabled` outcome return HTTP 200 `{ success: false, code: 'ai_unavailable', error: <en sentence> }`, with no content written. No separate pre-check |
| `lib/business-os/bizql/mutate/MutateExecutor.ts` | **Q-7 reversed (RC-W3):** keep creating the landing page as today; call `generateWebsite(…, { onAiDisabled: 'fail' })`; on `disabled`, skip generation, write no content, and reply with the preview link plus the translated sentence (the `:804-805` precedent). No pre-check |
| `app/api/website/blocks/[blockId]/regenerate/route.ts`, `app/api/website/enhance-testimonial/route.ts` | Map the service's `disabled` outcome → HTTP 200 `{ success: false, code: 'ai_unavailable' }` (Q-9) |
| `lib/services/WebsiteAIContentService.ts` | `field_regenerate`, `testimonial_enhance`: off → a typed `disabled` outcome |
| `app/business-os/website/page.tsx` | `LABELS.ai_unavailable` in en/es/he; show it beside the regenerate and testimonial buttons and in the generate-from-profile notice when `code === 'ai_unavailable'` (N-5). Convert its 2 `console.error` to the existing `logger` in a separate commit: **pending user OK** (§12) |
| `lib/business-os/llm/modelSettingsPolicy.ts` | Flip `website/full_site`, `field_regenerate`, `testimonial_enhance` to `switchable: true` (RC-W8b) |
| tests | `callParams.snapshot.test.ts` (chat + images, seeded) T3-S; `modelSettings.off.chat.test.ts` T3-G/T3-O; route tests for v1/v2/v4 gates; `GeneratedImageService.attribution.test.ts` / Planner / Analysis tests keep passing with the resolver mocked |

### 7.2 Tasks

- ⬜ **T3.0** (Q-8) Before any Step 3 code: one image call with an unknown model on a non-production OpenAI key; record the status/code here. The classifier is not widened for it.
- ⬜ **T3.1** Planner (+ FR-13, loop model = `modelUsed`, RC-W6) · ⬜ **T3.2** Analysis · ⬜ **T3.3** Message module · ⬜ **T3.4** v4/v2/v1 gates (RC-W2 placement) · ⬜ **T3.5** Images (resolved model in request and price, price built inside the attempt, off after reuse: RC-W4) · ⬜ **T3.6** `full_site` `'fail'` callers (route + mutate; mutate still creates the page, RC-W3) and flip the three website locks · ⬜ **T3.7** regenerate/testimonial off + the page notice (+ `console.*` conversion, pending user OK) · ⬜ **T3.8** Tests, gates · ⬜ **T3.9** SA → QA → user → RM.

### 7.3 Tests

| ID | Asserts | AC |
|---|---|---|
| T3-S | **Same obligation as T2-S**, and the same ruling: spy at `chatCompletion` / `complete`, assert the **whole request object** plus the **call count**, and **delete each call's leg-(A) entry from `callParams.snapshot.test.ts` as its site is wired**. Each Step 3 site is driven once and compared with T1-14 and with the pre-Layer-2 request. Planner and analysis requests with the seeded rows equal T1-14, including the `bizchat_*` fixture values; images request `model` equal to the `image_generation_model` fixture; **the image price key's model equals the request model, with an override and after a retry to the default (RC-W4)** | AC-2, AC-10 |
| T3-G | Chat area off: `chat-v4`, `chat-v2`, `chat` each return the sentence in en/he/es; the planner, analysis, `EmbeddingService`, `AIDataLayerService` and `IntentParser` mocks are not called; no ledger or audit write. **chat-v4 (RC-W2):** with chat off, a parked write can still be confirmed and cancelled, and that path calls no planner, analysis or embedding mock; chat off + budget exhausted → the chat-off message, not the budget refusal | AC-9 |
| T3-O | `analysis` off → the planner sentence; images off → `reason: 'unavailable'`, provider not called; **images off with a reusable existing picture → the picture is returned (reuse check runs first, RC-W4)**; `full_site` off → generate-from-profile returns HTTP 200 `ai_unavailable` with **no** content write; the mutate path **creates the page**, writes no content, calls no provider, and replies with the preview link plus the sentence (RC-W3); the build still finishes with starter copy (`'fallback'`, T2-O); regenerate/testimonial → HTTP 200 `ai_unavailable`, no provider call | AC-9 |
| T3-M | Planner `diagnostics.model` = the model that ran (override; after retry = default). **Retry, then a repair attempt (RC-W6):** the repair request uses `modelUsed`, and every `fail(...)` / `diagnostics` path reports it | AC-10 (part) |
| T3-L | Page labels: `ai_unavailable` exists in all three `LABELS` maps (static test) | AC-9 |

### 7.4 Gates

As in Step 2, plus `npx jest app/api/business-os lib/business-os/bizql lib/services/__tests__/GeneratedImageService*`, the chat-v4 suites unedited and passing, and `next build` (the page is `'use client'`: it must import no resolver module, only read `code`). **RC-W9:** `chat-v2/route.ts` and `chat/route.ts` join the `typecheck:bos-llm` scope as callers of `lib/business-os/llm/`. Record the `--list` diff, fix any new error in those files, and use `--update-baseline` only for errors that already existed, listed in the PR.

### 7.5 Rollout notes

New messages appear only when a row switches something off. After deploy, QA: AC-13 item 3 for chat and images.

**Until this step deploys, the website kill switch is partial (S1-7).** `set website --enabled false` stops five of the eight website calls; `full_site`, `field_regenerate` and `testimonial_enhance` keep running, because their ★ "AI writing is unavailable" paths ship here in Step 3 and a call with no off path must not resolve to `enabled: false` (RC-W8b, D-27). The change script says so, by name, every time an area with such calls is switched off, and the runbook (§8, FR-18) must repeat it. **When this step lands, flip those three to `switchable: true` in the policy and the warning disappears on its own** — it is computed from the policy, not hard-coded.

**Final live off/on check for chat AI (switch `chat` off with the change script, check all three routes return the sentence in each language, then switch it back on): pending user decision.** No test environment exists yet, so this would run on the live system, where real users would see the "assistant is unavailable" message for up to ~60 s each way. The user is being asked whether that is acceptable. Until the user decides, QA does not run it and records it as open; the automated coverage (T3-G, T3-O) stands in the meantime.

---

## 8. Step 4 — Literal check and docs

**Scope:** FR-15, FR-18. **Size: S** (~150 lines of script and tests, plus doc edits).

### 8.1 Files

| File | Change |
|---|---|
| `scripts/check-bos-llm-literals.ts` | create. Scope: non-test files that import `callCatalog` (the same derivation helper as `scripts/typecheck-bos-llm.ts`, imported, not copied). Fails on quoted `gpt-`, `claude-`, `o1`/`o3`/`o4` model ids, `kimi-`, `text-embedding-`, `gpt-image-`, on `OPENAI_MODELS.`, and on `temperature:\s*[0-9.]`. Only exemption: `lib/business-os/llm/modelSettingsPolicy.ts` with a reason string |
| `scripts/__tests__/check-bos-llm-literals.test.ts` | create: T4-1 |
| `package.json` | `"check:bos-llm-literals": "tsx scripts/check-bos-llm-literals.ts"` |
| `.github/workflows/bos-llm-typecheck.yml` | One more step in the existing job: `npm run check:bos-llm-literals` |
| `.claude/skills/bos-llm-call-standards/SKILL.md` | Standard 8 "Model settings" (resolver, policy, `withModelFallback`, new-area checklist item = row + defaults + policy, the literal check); remove the KI-C exception from Standard 4; the review checklist gains one line |
| `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md`, `docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md` (roadmap), `docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md` (KI-C closed) | Change History rows |
| `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` | create (new `docs/runbooks/` directory, accepted by SA): how to read, change and switch off an area with the script; the emergency path, incl. `--enabled false` refusing while call-level `enabled: true` overrides exist and `--include-calls` (RC-W8c); locked fields are refused by the script (RC-W8a); expected propagation (≤ 60 s); rollback, incl. that a value changed only in an area row is lost on a code revert |

### 8.2 Tasks and tests

- ⬜ **T4.1** Script + test T4-1: passes on the branch; fails on a planted `model: 'gpt-4o'` and on `temperature: 0.5` in a temp file that imports the catalog; does not fail on the policy module; does not scan `IntentParser.ts` (no catalog import). **AC-11**
- ⬜ **T4.2** Workflow step + npm script.
- ⬜ **T4.3** Docs (AC-14).
- ⬜ **T4.4** SA → QA → user → RM.

### 8.3 Gates

`npm run check:bos-llm-literals` exits 0; `typecheck:bos-llm` unchanged; `next build`.

---

## 9. Release Mechanics and Apply Order

Five PRs from this branch, in order (RM splits by commit, as in Layer 3). **Each merges only after SA ✅, QA ✅ and the user's approval.**

| # | Event | Gate before it |
|---|---|---|
| 1 | **Step 0 merged and deployed** | — |
| 1a | Step 0 policy migration applied (only if §4.4 required one); R-2 re-run and pasted | 1 |
| **1b** | **Pre-deploy price RE-CHECK (S1-4). Measured on production 2026-09-20: no billing impact — see §5.5. Re-run it before every deploy that carries this reader,** because the guarantee holds only while duplicate rows stay price-identical. Fixing the oldest-price-wins cache bug means any model with more than one active `ai_model_pricing` row starts being charged at its **newest** rate the moment Step 1 deploys (today it is charged at its oldest). Run, read-only, **before** the deploy:<br>`SELECT provider, model_name, count(*) AS rows, min(effective_date) AS oldest, max(effective_date) AS newest, min(input_cost_per_token) AS min_in, max(input_cost_per_token) AS max_in, min(output_cost_per_token) AS min_out, max(output_cost_per_token) AS max_out FROM ai_model_pricing WHERE retired_date IS NULL GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2;`<br>**0 rows, or rows whose min and max rates are identical → no charge changes; proceed.** Rows with a rate spread → paste them into §10.2, show SA the price delta, and decide before deploying. Also run the same check on `output_cost_per_token` (`HAVING count(*) > 1 AND min(output_cost_per_token) <> max(output_cost_per_token)`). The same change stops a future-dated row from charging before its date (S1-5) | 1 |
| 2 | **Step 1 merged and deployed** (inert *except* the pricing-cache fix, 1b) | 1, 1b (1a if any) |
| P-1 | **Pre-check A:** no area row exists. `SELECT key, updated_at FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%';` → **must return 0 rows**. If any row exists, **stop**: it may have been planted through the pre-Step-0 open routes, and `ON CONFLICT DO NOTHING` would keep it. Escalate to SA and the user | 1, 2 |
| P-2 | **Pre-check B:** record the stored F-3 values (the "before" of §10): `SELECT key, value, jsonb_typeof(value), updated_at FROM system_settings_config WHERE key IN ('bizchat_planner_model','bizchat_analysis_model','bizchat_analysis_enabled','lead_reply_recommender_model','lead_reply_recommender_enabled','image_generation_model');` → paste into §10.2 | P-1 |
| P-3 | **Pre-check C (N-3, RC-W1a):** run `npm run bos:llm-settings -- verify-stored` against the same database (S1-1: the plain `npx tsx` form cannot load the environment). It validates each P-2 value through the resolver's guardrails (price coverage, reasoning rule) **and flags any non-canonical value** (canonical: JSON boolean; string `true`/`false` in any case; non-empty trimmed model string with no stray quotes). **Any rejection or flag → stop**; the seed would change behaviour. Escalate: price the model first, normalise the stored value to what today's reader returns (a user-approved write), or record a user decision | P-2 |
| **P-3b** | **Dry run — let PostgreSQL parse the file (D-Q7).** No test can do this: T1-9 reads the SQL as text, so a syntax or type error would first appear during the real apply. In the SQL editor run `BEGIN;` → the whole migration → `ROLLBACK;` and confirm it reports 8 inserted rows and no error. **Any error → STOP**; nothing is written, because the transaction is rolled back | P-3 |
| P-4 | **Apply the seed** (`20261003_seed_bos_llm_area_settings.sql`, renamed — D-19) in the SQL editor | P-3b |
| P-5 | **Post-check:** `SELECT key, value FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%' ORDER BY key;` → 8 rows that match §10's "seeded row" with the P-2 values substituted; then `npm run bos:llm-settings -- get <area>` for all eight → the resolved settings equal §10's "after" column. Paste both into §10.2 | P-4 |
| **P-5b** | **Post-seed parity check (RC-W1b).** **Scope, stated plainly (D-Q4): on a database where none of the six legacy keys is stored — which is production as measured on 2026-09-20 — this check passes *vacuously with respect to the unwrap rules*.** It compares the legacy readers' **fallbacks** with the migration's **literals**; not one unwrap branch (`"true"`, a JSON-encoded string, a double-encoded string) is executed, so RC-W1's actual failure mode is proved by T1-13b's fixtures and by P-3, not by this run. It is still worth running: it is the only check that compares the two code paths on the real rows. Run `npm run bos:llm-settings -- verify-equivalence` against the same database. For the six F-3 fields it compares what the **still-deployed legacy readers** return (the real getters) with what the resolver returns from the seeded rows. **Exit 0 → continue. Any difference → run the seed rollback `DELETE FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%'` at once** (safe: no code that reads the rows is deployed yet), paste the output into §10.2, and escalate to SA and the user. Step 2 does not merge until P-5b passes | P-5 |
| **P-5c** | **Re-runnability, proved rather than asserted (QA).** Record `SELECT key, md5(value::text) AS fingerprint FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%' ORDER BY key;`, apply the migration a **second** time, and run it again: all eight fingerprints must be **byte-identical**, and `updated_at` must not move. That is what `ON CONFLICT (key) DO NOTHING` promises; this is the only check that demonstrates it on the real table | P-5b |
| P-6 | QA records AC-13 items 1–2 | P-5c |
| 3 | **Step 2 merged and deployed** | P-6 |
| 4 | **Step 3 merged and deployed** | 3 |
| 5 | **Step 4 merged** | 4 |

**Rollback:** code revert only. The old keys stay (marked superseded). Reverting Step 2 or 3 restores the old reads, so a value changed **only** in an area row after the seed would be lost on revert. The runbook says so. The seed can be undone with `DELETE FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%'`, but only while no code that reads the rows is deployed.

---

## 10. Per-Call Parameter Snapshot (zero behaviour change)

### 10.1 Table

**S(k)** = the stored value of key k if present and valid (P-2), else the default shown. "Seeded row" is where the value lives after the seed (A = area level, C = call override). **After** = the resolver's output for the seeded rows, which is what the call sends. T1-14 captures the "before" column in code; T2-S / T3-S assert "after" = "before".

| Area | Call | Mechanism (unchanged) | Provider before → after | Model before | Model after (seeded row) | Temp before | Temp after (seeded row) | Enabled before → after | Switchable | Step |
|---|---|---|---|---|---|---|---|---|---|---|
| chat | `planner` | `chatCompletion` (tools, `frequency_penalty`) | openai → openai | S(`bizchat_planner_model`, `gpt-4o-mini`) | same (C) | 0 | 0 (locked) | on → on | area only | 3 |
| chat | `analysis` | `chatCompletion` (`frequency_penalty`) | openai → openai | S(`bizchat_analysis_model`, `gpt-4o-mini`) | same (C) | 0 | 0 (A) | S(`bizchat_analysis_enabled`, true) → same (C) | yes | 3 |
| chat | 4 embeddings | `EmbeddingService` | — | `helpbot_embedding_model` | unchanged (excluded) | — | — | on → on (area gate stops them) | via area | — |
| insights | `insight_content` | `chatCompletion` | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (A) | 0.3 | 0.3 (A) | on → on | yes | 2 |
| insights | `correlated_insight` | `chatCompletion` | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (A) | 0.4 | 0.4 (C) | on → on | yes | 2 |
| insights | `health_summary` | `chatCompletion` | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (A) | 0.5 | 0.5 (C) | on → on | yes | 2 |
| briefing | `daily_narration` | `chatCompletion` | openai → openai | `gpt-4o-mini` (`OPENAI_MODELS`) | `gpt-4o-mini` (A) | 0.3 | 0.3 (A) | on → on | yes | 2 |
| website | `full_site` | `complete()` JSON | openai → openai | `gpt-4o` | `gpt-4o` (C) | 0.7 | 0.7 (A) | on → on | yes | 2 (params), 3 (off outside build) |
| website | `landing_page` | `chatCompletion` JSON | openai → openai | `gpt-4o` | `gpt-4o` (C) | 0.7 | 0.7 (A) | on → on | yes | 2 |
| website | `field_regenerate` | `complete()` | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (A) | 0.7 | 0.7 (A) | on → on | yes | 2 (params), 3 (off) |
| website | `testimonial_enhance` | `complete()` | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (A) | 0.5 | 0.5 (C) | on → on | yes | 2 (params), 3 (off) |
| website | `hero/about/faq/features_content` (dormant) | `complete()` | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (A) | 0.7 | 0.7 (A) | on → on | yes | 2 |
| intake | `form_generation` | `complete()` JSON | openai → openai | `gpt-4o` | `gpt-4o` (A) | 0.3 | 0.3 (A) | on → on | yes | 2 |
| intake | `question_inference` | `complete()` JSON | openai → openai | `gpt-4o-mini` | `gpt-4o-mini` (C) | 0.2 | 0.2 (C) | on → on | yes | 2 |
| leads | `reply_recommendation` | `chatCompletion` JSON | openai → openai | S(`lead_reply_recommender_model`, `gpt-4o-mini`) | same (A) | 0.2 | 0.2 (A) | S(`lead_reply_recommender_enabled`, true) → same (A) | yes | 2 |
| onboarding | `business_story_extraction` | `complete()` JSON | openai → openai | `gpt-4o` | `gpt-4o` (A) | **not sent** | not sent (A: `null`) | on → on | **no** | 2 |
| onboarding | `client_workflow_extraction` | `complete()` JSON | openai → openai | `gpt-4o` | `gpt-4o` (A) | not sent | not sent (A) | on → on | no | 2 |
| onboarding | `client_tracking_extraction` | `complete()` JSON | openai → openai | `gpt-4o` | `gpt-4o` (A) | not sent | not sent (A) | on → on | no | 2 |
| onboarding | `adjustment_intent_extraction` | `complete()` JSON | openai → openai | `gpt-4o` | `gpt-4o` (A) | not sent | not sent (A) | on → on | no | 2 |
| images | `image_generation` | `generateImage` | openai → openai | S(`image_generation_model`, `gpt-image-1`) | same (A) | — | — (not applicable) | on → on | yes | 3 |
| *(gate only)* | chat v2 `AIDataLayerService` | — | unchanged | `gpt-4o` / env | unchanged | — | unchanged | on → on (chat-area gate) | via area | 3 |
| *(gate only)* | chat v1 `IntentParser` | — | unchanged | `gpt-4o-mini` | unchanged | 0.1 | unchanged | on → on (chat-area gate) | via area | 3 |

**Seeded rows (summary):**

| Key | Area level | `calls` overrides |
|---|---|---|
| `bos_llm_area_chat` | enabled true, openai, `gpt-4o-mini`, 0 | `planner: { model: S }`, `analysis: { model: S, enabled: S }` |
| `bos_llm_area_insights` | true, openai, `gpt-4o-mini`, 0.3 | `correlated_insight: { temperature: 0.4 }`, `health_summary: { temperature: 0.5 }` |
| `bos_llm_area_briefing` | true, openai, `gpt-4o-mini`, 0.3 | — |
| `bos_llm_area_website` | true, openai, `gpt-4o-mini`, 0.7 | `full_site: { model: 'gpt-4o' }`, `landing_page: { model: 'gpt-4o' }`, `testimonial_enhance: { temperature: 0.5 }` |
| `bos_llm_area_intake` | true, openai, `gpt-4o`, 0.3 | `question_inference: { model: 'gpt-4o-mini', temperature: 0.2 }` |
| `bos_llm_area_leads` | S(enabled), openai, S(model), 0.2 | — |
| `bos_llm_area_onboarding` | true, openai, `gpt-4o`, `null` | — |
| `bos_llm_area_images` | true, openai, S(model) | — (no temperature key) |

### 10.2 Recorded values (filled in at P-2 / P-5 and after each deploy)

| Checkpoint | Recorded by | Result |
|---|---|---|
| **1b** duplicate active price rows (S1-4, pre-deploy re-check) | user | **Run 2026-09-20 on production.** 3 models with >1 active row (`claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`, `gpt-4o-mini` — 4 rows each), **all price-identical on input**; the output-side check returned 0 rows → **no charge changes**. Raw output in §5.5; re-run before each deploy carrying this reader |
| P-1 / P-2 observed while running the script (S1-1) | Dev | **2026-09-20:** no `bos_llm_area_*` row exists, and **none of the six legacy keys is stored** — `verify-stored` exit 0, `verify-equivalence` exit 0 (`checked: 6`). The user still runs P-1 and P-2 formally at apply time |
| P-2 stored F-3 values | user | *(pending — expected to show all six keys absent, per the row above)* |
| P-5 rows + resolved settings | user / QA | *(pending)* |
| P-5b `verify-equivalence` output (legacy readers vs resolver, six fields) | user / QA | *(pending)* |
| After Step 2 deploy: one action per Step 2 area; ledger `model_name` matches "after" | QA | *(pending)* |
| After Step 3 deploy: chat and images | QA | *(pending)* |
| Live off/on cycle: lead-reply (after Step 2) and chat (after Step 3) | QA | **pending user decision** (no test environment; §6.5, §7.5) |

---

## 11. AC Traceability

| AC | What | Step | Tests / check |
|---|---|---|---|
| AC-1 | Step 0 routes: 401/403/400, POST gone, pricing/sync gated, no leaks, no `console.*`, page works, RLS recorded, Step 0 before seed | 0 | T0-1…T0-7; T0.8 manual; §4.4; §9 |
| AC-2 | Identical requests for every in-scope call | 1 (before), 2, 3 (after) | T1-14, T1-9, T1-13b, T2-S, T3-S; §10; P-3 canonical stop + **P-5b** legacy-vs-resolver parity on the live DB (RC-W1) |
| AC-3 | Precedence, absent/null, unknown names, fixed-key read | 1 | T1-4 |
| AC-4 | Missing / non-object / one bad field / repository error; never throws | 1 | T1-5 |
| AC-5 | Guardrails: unpriced token model, image coverage, provider, temperature bounds, non-boolean enabled; 0 accepted | 1 | T1-6 |
| AC-6 | Locks: onboarding, planner switch and temperature | 1 | T1-8 |
| AC-7 | 60 s window; 10 s retry after failure | 1 | T1-10 |
| AC-8 | One retry with default; one audit entry; 0-token row; negative cache; no retry otherwise | 1, 2 | T1-11, T2-R |
| AC-9 | Off per area incl. chat v1/v2/v4 gates (v4 gate before the budget refusal; parked write still confirmable), `full_site` three callers via `onAiDisabled`, `landing_page` default, images after reuse, three languages | 2, 3 | T2-O, T3-G, T3-O, T3-L |
| AC-10 | Ledger/audit/intake/planner/image price record the model that ran | 2, 3 | T2-M, **T2-M-I (insights: provider model + ledger `model_name`, RC-W11)**, T3-M (incl. repair after retry, RC-W6), T3-S (image price key, RC-W4), T1-11 (audit models); live check after Step 2 (§10.2) |
| AC-11 | Literal check passes / fails as specified; only exemption; runs in the existing job | 4 | T4-1 |
| AC-12 | `typecheck:bos-llm` 0 new, `next build`, no new direct Supabase outside repositories, usage snapshot unchanged | every step | §4.6, §5.4, §6.4, §7.4, §8.3 |
| AC-13 | Live: pre-apply, rows, per-area behaviour, leads off/on cycle, info log | §9, after 2 and 3 | P-1…P-6 incl. P-5b; QA live. **Items 4–5 (leads off/on) and the chat off/on check: pending user decision** (§6.5, §7.5) |
| AC-14 | Docs | 4 | T4.3 review |
| AC-15 | Reasoning models: temperature not sent; planner (and analysis, N-1) reject the model; `o1*` rejected on token calls (RC-W5) | 1 | T1-7 |
| AC-16 | Change script refuses invalid rows (incl. locked fields), refuses `--enabled false` with live call overrides unless `--include-calls`, writes valid ones via the repository | 1 | T1-13 |

**AC-12 note on "no new direct Supabase call":** the pricing routes keep their existing direct access (RC-10b follow-up). No new direct call is added anywhere; the system-config route **loses** its direct client.

---

## 12. `console.*` in Touched Files

| File | `console.*` | Step | Action |
|---|---|---|---|
| `app/api/admin/system-config/route.ts` | **7** | 0 | Converted (FR-1 requires it) |
| `app/api/admin/system-config/pricing/route.ts` | **12** | 0 | Converted (FR-1 requires it) |
| `app/api/admin/system-config/pricing/sync/route.ts` | 0 | 0 | — |
| `app/business-os/website/page.tsx` | **2** (`:2635`, `:2667`) | 3 | **Convert** to the page's existing `logger` in a separate commit inside Step 3 (CLAUDE.md § Logging). **Pending user OK**: the user is expected to approve; the conversion goes ahead unless the user explicitly declines |
| `lib/ai/providers/openaiProvider.ts`, `SystemConfigRepository.ts` (not modified), all Step 2/3 call sites, chat routes, `MutateExecutor.ts`, `GeneratedImageService.ts` | 0 | 1–3 | — |
| **Not touched, flagged only:** `app/admin/system-config/page.tsx` | **20** | — | Verify-only in Step 0 (N-14). Proposed as a follow-up with the admin-screen layer, which rewrites this page |
| `lib/ai/pricing.ts` | **9** | 1 | **Converted** (D-25). The file moved to `aiModelPricingRepository.listActive()` in this step (SA addendum §E), so CLAUDE.md § Logging applies: `createLogger({ module: 'AiPricing' })`; 0 `console.*` remain |
| **Not touched, flagged only:** `lib/business-os/LanguageContext.tsx` | **8** | — | Avoided by reusing `media.generate.unavailable` (N-4; Q-6 approved by SA, so it stays untouched) |

---

## 13. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | The seed is applied late, or Step 2 is deployed before it, and stored F-3 overrides are replaced by code defaults | Medium (process) | §9 gates; T2.0 blocks merge; RM checklist; P-5 pasted before Step 2's PR is approved |
| R-2 | A stored F-3 value fails a guardrail, or is non-canonical and read differently by today's reader (e.g. `"no"` = off today, default on after the seed), so the seed changes behaviour (N-3, RC-W1) | Low | P-3 `verify-stored` (guardrails + canonical check), stop on any flag; P-5b `verify-equivalence` against the real legacy getters, rollback `DELETE` on any difference |
| R-3 | A row planted through the open routes before Step 0 survives the seed | Low | P-1 must return 0 rows |
| R-4 | An open RLS write policy bypasses the route fix | **Was real, now closed at the database** | §4.4 found RLS off on `ai_model_pricing` with full client write grants, and two broken write policies on `system_settings_config`. The Step 0 migration was **applied to production on 2026-09-20** and verified (§4.4) |
| R-15 | **Production is writable through the still-deployed unauthenticated admin routes until Step 0 ships.** The applied migration does not cover this: those routes use the service role, which bypasses RLS | **Certain until the deploy** | Deploy Step 0 alone and first (§4.7, F-0). The window is exactly "migration applied → Step 0 deployed", so the deploy is the mitigation; no code change shortens it |
| R-5 | Step 0 breaks the admin page for admins | Low | Response shapes unchanged; same-origin cookies; T0.8 manual; L-0 |
| R-6 | A resolver bug breaks every Business OS AI call | Low, **high impact** | Never-throw design (T1-5); the whole refill in try/catch; defaults on any fault; Step 1 inert for one deploy before any site uses it |
| R-7 | `hasPricing` false negative (DB pricing not loaded, model only in DB) rejects a valid configured model | Low | `hasPricing` loads the DB itself (V-6); the fallback is today's value, not an outage; the error log names the field |
| R-8 | The retry doubles cost on a misclassified error | Low | Narrow classifier on `status` + `code` only (T1-11 negative cases); negative cache |
| R-9 | Chat-off gate strands a parked write | Resolved by design | RC-W2: the v4 gate sits after the fill and confirm/cancel branches, just before the budget refusal, so a parked write can still be confirmed or cancelled (T3-G) |
| R-10 | The reasoning-model family list drifts from OpenAI | Medium over time | Code-owned list with tests; a wrong "false" means a 400 on a rare configuration and the DEC-9 retry does not apply; the runbook tells operators to test a new family on a non-production database first |
| R-11 | Scope growth in `typecheck:bos-llm` changes the baseline | **Certain** in Steps 1–3 (RC-W9 correction: any caller of `lib/business-os/llm/`, a CORE dir, joins the scope, e.g. the change script, every Step 2 site, chat v1/v2) | N-8 still keeps the repository out; `--list` diff recorded at every step; new errors in touched files fixed; `--update-baseline` only for pre-existing errors, listed in the PR |
| R-12 | Up to 60 s propagation surprises QA in AC-13 | Known | Runbook + test script wait ≥ 60 s |
| R-13 | An overridden image model is priced as the old model, or at $0 | Resolved by design | RC-W4: the price resolver is built inside the `withModelFallback` attempt from the model that ran (T3-S) |
| R-14 | The live off/on QA check runs on production (no test environment), so real users briefly see the "off" behaviour | Depends on user decision | Pending user decision (§6.5, §7.5); automated coverage T2-O / T3-G / T3-O stands meanwhile |

---

## 14. Questions for SA

All twelve are **resolved** by SA (§15, 2026-09-19); the rulings are applied in the body of this workplan.

| # | Question | Dev recommendation | SA ruling (§15) |
|---|---|---|---|
| **Q-1** | Extract the inline admin gate into `lib/admin/requireAdminRoute.ts` (6 handlers in 3 files), or keep it inline per the V-11 precedent? | **Extract.** Same code, one tested place; the precedent routes stay unchanged | **Resolved:** extract (SA Rule 7 sign-off; logs `userId` only; helper tested once + per-route 401/403). Applied in §4.2, T0.2, T0-7 |
| **Q-2** | Settings POST: delete or gate? And accept N-9 (repository `set` does not invalidate `SystemConfigService`'s in-process cache)? | **Delete** (§4.1). **Accept N-9**: the only key the page writes is read uncached | **Resolved:** delete POST confirmed; N-9 accepted. Applied in §4.1, N-9 |
| **Q-3** | N-1: analysis also sends `frequency_penalty`. Apply RC-11's "reject the model" rule to analysis as well (generic `sendsSamplingPenalty` flag)? | **Yes**, it is the same 400 | **Resolved:** yes, `sendsSamplingPenalty: true` for planner and analysis. Applied in §3.1, T1-7 |
| **Q-4** | The reasoning family: `gpt-5*`, `o1*`, `o3*`, `o4*` (not `gpt-4.1*`, N-2); as an exported module function in `openaiProvider.ts`, not a change to the private method? | **Yes** to both | **Resolved:** yes, plus RC-W5 (`o1` / `max_tokens` gap): module-level `usesMaxCompletionTokens` exported, token guardrail rejects `rejectsSamplingParameters && !usesMaxCompletionTokens`. Applied in §3.3, §5.1, T1-7 |
| **Q-5** | N-11: the image price guardrail reads `getImageGenerationConfig()` on refill only when the image model differs from the default. Acceptable against DEC-8's "one query a minute"? | **Yes**. The seeded state stays at one query | **Resolved:** yes, with RC-W7(b): a model equal to the default skips the check. Applied in §3.3, §3.4 |
| **Q-6** | Images off: reuse the existing `media.generate.unavailable` ("Image generation is not available right now.") rather than add new wording? | **Reuse.** Same meaning; avoids touching `LanguageContext.tsx` | **Resolved:** reuse `media.generate.unavailable`; `LanguageContext.tsx` untouched. Applied in §3.8, §12 |
| **Q-7** | Chat mutate path with `full_site` off: check **before** creating the landing page (no page, reply with the message), or create the draft and skip generation? | **Before**, so no empty draft is left | **Resolved (reversed):** create the page, skip generation, reply with preview link + sentence; one `onAiDisabled` check point (RC-W3). Applied in N-6, §3.8, §6.1, §7.1, T3-O |
| **Q-8** | The model-unavailable classifier (§3.5): `404+model_not_found`, `403+{model_not_found, unsupported_model}`, `404+param=model`. Enough, or too wide? | As listed | **Resolved:** as listed; T3.0 records what the Images API returns for an unknown model; classifier not widened. Applied in §3.5, §7.2 |
| **Q-9** | `ai_unavailable` from the regenerate / testimonial / generate-from-profile routes: HTTP 200 with `success: false, code`, or 503? | **200 + code**. The page branches on the body today, and 503 would read as an outage in monitoring | **Resolved:** HTTP 200 + `success: false, code: 'ai_unavailable'`. Applied in §3.8, §7.1, T3-O |
| **Q-10** | Chat-off gate placement in chat-v4: before the pending-write confirm/cancel branch (strict "no chat at all"), or after it (let a parked write be confirmed; that path makes no LLM call)? | **After the pending-write branch, before budget and planning.** Confirming a parked write is not AI spend, and the budget gate sets the precedent | **Resolved:** immediately before `if (!budget.allowed)` (`chat-v4/route.ts:736`); v2 after auth/flag/Zod; v1 after auth (RC-W2). The §7.1 vs Q-10 contradiction is removed. Applied in §3.8, §7.1, T3-G, R-9 |
| **Q-11** | Step 2 wires `field_regenerate`/`testimonial_enhance`/`full_site` params but defers their ★ off paths to Step 3, enforced by `STEP3_PENDING_SWITCHES` (the script refuses `enabled: false` for them until Step 3). OK? | **Yes.** It keeps each PR complete | **Resolved:** defer via the existing lock (`switchable: false` in Step 2, `true` in Step 3), no `STEP3_PENDING_SWITCHES` (RC-W8b). Applied in §3.1, §6, §7.1 |
| **Q-12** | Should the change script also expose `verify-stored` (P-3)? It is a read-only mode of the same file | **Yes** | **Resolved:** yes, plus `verify-equivalence` (RC-W1b, P-5b). Applied in §3.6, §9, T1-13b |

---

## 15. SA Review Notes

## SA Workplan Review

**Reviewed by SA — 2026-09-19** (checked against the code at `e35c83d4` in this worktree, not against the doc)
**Verdict: APPROVED WITH CHANGES.** Step 0 may start now; it only needs RC-W10. RC-W1 to RC-W9 and RC-W11 must go into this workplan (docs only) before Step 1 code starts. A second SA pass on the edited sections is not needed. SA checks them at each step's code review.

### Verification of the Dev's claims

| Claim | Verdict | Evidence |
|---|---|---|
| §2.1 Step 0 routes (7 / 12 / 0 `console.*`, `error.message` leaks, module-level service-role client, `sync` `POST()` without `request`) | ✅ Holds | `system-config/route.ts:1-8, 14, 42, 87`; `pricing/route.ts` 12 matches; `pricing/sync/route.ts:25, 447` |
| Only caller is `app/admin/system-config/page.tsx`, and nothing calls settings POST | ✅ Holds | The page calls settings GET `:143` and PUT `:410` (`{ updates: { payment_grace_period_days } }`), plus pricing GET `:193`, PUT `:291` and sync POST `:334`. A grep of `.ts/.tsx/.js/.mjs/.json/.yml` finds no other reference. `middleware.ts:83` skips `/api` |
| Admin precedent | ✅ Holds | `llm-usage/route.ts:49-64`. No `profiles`/`role` use in the three routes |
| N-1 analysis sends `frequency_penalty` | ✅ Holds | `AnalysisService.ts:135` (with `temperature: 0`, `:131`) |
| N-2 family ≠ `max_completion_tokens` family; the method is private | ✅ Holds, plus an **o1 gap** (RC-W5) | `openaiProvider.ts:133-140`. `o1*` is **not** in `usesMaxCompletionTokens` |
| N-3 a stored value can change behaviour on the seed | ✅ Holds, and **wider than stated** (RC-W1) | See RC-W1: today's boolean/string readers do not match the seed's unwrap rules |
| N-4 existing image "unavailable" string in three languages | ✅ Holds | `LanguageContext.tsx:3044` (en), `:6387` (es), `:8465` (he); `MediaLibraryPicker.tsx:210` |
| N-5 the page swallows regenerate/testimonial failures | ✅ Holds | `page.tsx:2918-2920` and `:3370-3374` only log |
| N-6 mutate creates the page before generating it | ✅ Holds; the Q-7 ruling reverses the Dev's recommendation | `MutateExecutor.ts:774-835`; the in-code precedent is at `:804-805` |
| N-7 v1/v2 lack the language at entry | ✅ Holds | `chat-v2/route.ts:90`; `businessProfileRepository.findByUserId` is already used by v4 (`chat-v4/route.ts:395`) |
| N-8 catalog import scope effect | ✅ Holds for the repository. **R-11 is wrong for Step 3** (RC-W9) | `typecheck-bos-llm.ts:76` treats `SCOPED_DIRS = ['lib/business-os/llm/', …]` as CORE whatever it imports. `--list` today does not include chat-v2 or chat v1 |
| N-9 repository `set` does not invalidate the service cache | ✅ Holds; accepted | `SystemConfigService.ts:61-62, 281`. `payment_grace_period_days` is read only by `stripe/webhook/route.ts:373`, directly |
| N-10 … N-14 | ✅ Hold | `pricing.ts:185` fallback log; `LeadReplyRecommender.ts:95-98` reads on every call; the page checks only `response.ok` / `success` |
| `complete()` rethrows the raw provider error (classifier can read `status`/`code`) | ✅ Holds | `providerFactory.ts:317-363` has no catch. `baseProvider.ts:139-184` rethrows after a 0-token failed row |
| `runAiAction` outcome with a retry | ✅ `succeeded` | `aiActionAudit.ts:165-176`: the last attempt per `component` wins |
| §10 snapshot table vs code | ✅ Every row checked | insights `:727/1742/2130` (0.3/0.4/0.5), briefing `OPENAI_MODELS.GPT_4O_MINI` 0.3, `full_site` `gpt-4o` 0.7, landing `gpt-4o` 0.7, intake `MODEL='gpt-4o'` / `gpt-4o-mini` 0.2, leads keys, planner `bizchat_planner_model` + `temperature: 0` + `frequency_penalty` |

### Required changes

1. **RC-W1: the seed must match today's readers exactly (widens N-3). High.** Today, leads uses `systemConfigRepository.getBoolean` (`SystemConfigRepository.ts:247-253`): any string other than `'true'` (in any case) gives **false**, and a number gives the default. Analysis uses `SystemConfigService.getBoolean` (`:137-150`): any string other than `'true'` gives **false**, and any other type gives `Boolean(value)`, so `0` means off. Model keys are `String(value)`, with no trimming and no unwrapping. §3.7 maps an unrecognised value (`"no"`, `"0"`, `0`) to NULL, which becomes the default `true`. **That would switch a feature that is off today back on.** Two fixes:
   - (a) `verify-stored` (P-3) also flags any F-3 value that is not canonical, and the apply stops on any flag. Canonical means: a JSON boolean; a string `true`/`false` in any case; or a non-empty, trimmed model string with no stray quotes.
   - (b) Add **P-5b**, a `verify-equivalence` script mode. For the six fields it compares what the **still-deployed legacy readers** return (call the real getters) with what the resolver returns from the seeded rows. On any difference, run the seed rollback `DELETE`, which is safe because no reader is deployed yet, and escalate. Add a test for it (T1-13b).
2. **RC-W2: chat-v4 gate placement (Q-10). High.** §7.1 says "before budget, pending-write and planning", but Q-10 says "after the pending-write branch", and these contradict. Ruling: put the gate **immediately before `if (!budget.allowed)` (`chat-v4/route.ts:736`)**. That is after the in-progress fill (4a) and confirm/cancel (4) branches, and before any planner, analysis or embedding call. If chat is off and the budget is also exhausted, the chat-off message wins. v2: after auth, the feature flag and Zod. v1: after auth. T3-G adds: with chat off, a parked write can still be confirmed or cancelled, and that path calls no planner, analysis or embedding mock. Fix §3.8 and §7.1 to match.
3. **RC-W3: `full_site` off from the page and from chat (Q-7 reversed). Medium.**
   - **Chat mutate path:** keep creating the page. Skip generation, and reply with the preview link plus the translated sentence. The write has already been confirmed by the owner when `MutateExecutor` runs, and the code's documented precedent (`:804-805`) is "the page exists … better than refusing". A new draft is not an overwrite.
   - **One check point instead of pre-checks:** pass an option into `generateWebsite`, e.g. `onAiDisabled: 'fallback' | 'fail'`. The onboarding build passes `fallback` (starter copy). generate-from-profile and mutate pass `fail`, which returns `code: 'ai_unavailable'` and writes no content. This removes the duplicated pre-checks and the race where a refill lands between the pre-check and `callLLM`.
4. **RC-W4: images price the model that ran. High.**
   - `GeneratedImageService.ts:344` builds `imagePriceResolver(config.pricesUsd, config.model, …)`, and `:356` sends `config.model`. Step 3 must use the resolved model in **both** places. The price resolver must be built **inside** the `withModelFallback` attempt, so the price follows `modelUsed`. Otherwise an overridden model is priced as the old one, or at $0.
   - Place the off check **after the reuse check (`:309`)** and before the daily count. Handing back an existing picture costs nothing and is not AI.
   - T3-S asserts that the price key's model equals the request model, including after a retry.
5. **RC-W5: reasoning family (Q-4). Medium.** Approved: `gpt-5*`, `o1*`, `o3*`, `o4*`, not `gpt-4.1*`, as an exported module function. But `o1*` is outside `usesMaxCompletionTokens`, so an `o1` model on any call that sends `max_tokens` fails with a 400 that is not retried. Choose one fix:
   - also export `usesMaxCompletionTokens` at module scope, with the private method delegating to it (zero behaviour change), and have the token guardrail reject a model where `rejectsSamplingParameters(m) && !usesMaxCompletionTokens(m)`; or
   - reject `o1*` outright in Layer 2.

   T1-7 covers `o1`.
6. **RC-W6: planner retry and repair loop. Medium.** `Planner.ts:330` resolves `model` once. Then the 3-attempt loop (`:440`) and every `fail(...)` / `diagnostics({ model })` (`:505, 539, 550, 565, 663, 726, 737, 747`) use it. After `withModelFallback`, reassign the loop's model to `modelUsed`. Repairs then run on the model that worked, and every diagnostics path reports it (FR-13). T3-M adds "retry, then a repair attempt".
7. **RC-W7: resolver details. Medium.**
   - (a) Type the resolver as `resolveBosLlmSettings<A extends BosLlmArea>(area: A, callName: Exclude<BosLlmCallName<A>, ExcludedCall>)`, so a typo is a `typecheck:bos-llm` error, not a silent default.
   - (b) The code default is the last level and is **never** guardrail-checked at runtime. A row value equal to the code default is accepted without a price query. T1-3 asserts that every default passes the guardrails.
   - (c) Memoise `hasPricing` per distinct `provider:model` within one refill. `pricing.ts:168-171` reloads the table on **every** call while its cache is empty, for example during a DB outage.
   - (d) Expose an explicit area-level check (`isBosLlmAreaEnabled('chat')`) for the three entry gates, rather than deriving it from a call.
8. **RC-W8: change script. Medium.**
   - (a) `validateAreaRow` treats a locked or non-switchable field as a **rejection** for the script: onboarding `enabled`, planner `enabled`/`temperature`, and images `temperature`. The script exits non-zero and writes nothing, so an operator's intent never silently fails to happen. The resolver still ignores such a field with a warn.
   - (b) Replace `STEP3_PENDING_SWITCHES` with the existing lock. The three calls are `switchable: false` in Step 2 and switch to `true` in Step 3. That keeps one mechanism and keeps the resolver's output truthful (Q-11).
   - (c) `set <area> --enabled false` lists any call-level `enabled: true` overrides that would keep calls on, and refuses unless `--include-calls` is given, which also sets those overrides to false. The emergency switch must do what it says. The runbook documents this.
9. **RC-W9: typecheck scope correction (R-11). Medium.** Step 3 makes `app/api/business-os/chat-v2/route.ts` and `app/api/business-os/chat/route.ts` **callers** of `lib/business-os/llm/` (a CORE dir), so they join the `typecheck:bos-llm` scope whatever `aiUnavailableMessages.ts` imports. The same applies to `scripts/bos-llm-settings.ts` in Step 1. At each step, record the `--list` diff and fix any new errors in the files you touch. Use `--update-baseline` only for errors that already existed, and list them in the PR.
10. **RC-W10: Step 0 pricing route. Low.**
    - Pass the admin's `user.id` to `logAIPricingUpdated` / `Created` / `Deleted`. Today it is `null` with a TODO at `pricing/route.ts:101`.
    - Make those three calls non-blocking (`.catch`), so an audit failure cannot 500 a write that already succeeded.
    - Keep PUT's current "at least one cost field" semantics with a Zod `refine`, instead of requiring both fields.
11. **RC-W11: AC-10 coverage. Low.** AC-10 names insights. Add a T2-M variant: with an insights model override, the provider receives that model and the tracked ledger row's `model_name` is that model.

### Answers to Q-1 … Q-12

| # | Ruling |
|---|---|
| Q-1 | **Extract** it: 6 handlers in 3 files. Rule 7 sign-off: it is the exact precedent, server-only, and returns a discriminated union (`{ user } \| NextResponse`). It logs `userId` only, never the email. Test the helper once, and keep a 401/403 test per route. `lib/admin/` is acceptable |
| Q-2 | **Delete POST**, confirmed (see Step 0 ruling). **Accept N-9** |
| Q-3 | **Yes.** `sendsSamplingPenalty: true` for planner and analysis. Analysis never throws, so without this the 400 would silently drop analysis on every turn |
| Q-4 | **Yes**, with RC-W5 (the `o1` / `max_tokens` gap) |
| Q-5 | **Yes**, with RC-W7(b): a model equal to the default skips the check |
| Q-6 | **Reuse** `media.generate.unavailable`. It has the same meaning as the approved wording ("not available" vs "unavailable") and avoids touching `LanguageContext.tsx` |
| Q-7 | **Reversed**: create the page and skip generation (RC-W3) |
| Q-8 | **As listed.** Before Step 3, run one call on a non-production key to confirm what the Images API returns for an unknown model. If it is a 400 not covered by the classifier, images simply do not retry, which is acceptable: the owner is told the image failed, as today. Do not widen the classifier for it |
| Q-9 | **HTTP 200 + `success: false, code: 'ai_unavailable'`.** A disabled feature is not a server fault, and the page already branches on the body |
| Q-10 | **Immediately before the `!budget.allowed` refusal** (RC-W2) |
| Q-11 | **Yes to deferring**, but via the existing lock, not a new set (RC-W8b) |
| Q-12 | **Yes** (and add `verify-equivalence`, RC-W1b) |

### Step 0 ruling (settings POST)

**Confirmed: delete `POST /api/admin/system-config`.** Evidence:
- The admin page makes two calls to this route, GET (`:143`) and PUT (`:410`). Its other calls go to `pricing` and `pricing/sync`.
- No other file in `app/`, `lib/`, `components/`, `scripts/` or config references the route.
- `middleware.ts` puts nothing in front of `/api`.

PUT's repository `set` still inserts a missing key, so admins lose no capability. The plan uses `AdminAccessService.getInstance().isAdmin({ id, email })`, fails closed and never reads `profiles.role`. The GET/PUT response shapes match `SystemConfigService.getAll` and `setMultiple` (same `select('*')`, ordered by category, key), so `page.tsx` needs no change (N-14).

### Other checks

- **Apply order (§9):** correct, with RC-W1 added. P-1 (no planted row), P-3 (stop on any rejection) and T2.0 (Step 2 cannot merge before P-6) implement RC-4. The old key holding an unpriced model stops at P-3. The new P-5b is the second safety net.
- **Retry (§3.5):** correct placement. Each site wraps only its provider call inside its `runAiAction` scope. The failed attempt writes 0 tokens, so nothing is counted twice. T1-11 with a real `runAiAction` + `callWithTracking` is the right proof.
- **Cache (§3.4):** correct. It holds one shared in-flight promise, backs off 10 s on error, never throws, and logs changes as labels only. Add RC-W7(c).
- **Standards:** repository pattern (a `getByKeys` read, no new direct Supabase; the pricing routes' existing direct access is the tracked RC-10b follow-up), Zod on every Step 0 body, Pino with a `correlationId`, and no model literals outside the policy module (Step 4 check). `typecheck:bos-llm` + `next build` are gates at every step. The `console.*` handling in §12 follows CLAUDE.md.
- **AC coverage:** AC-1 to AC-16 all trace to a test or a live check (§11), with RC-W11 closing the AC-10 gap.

### Optimisation suggestions (non-blocking)

- Pricing Zod: require a cost **> 0**, matching the image price rule (`SystemConfigRepository.ts:533`). A $0 row makes `hasPricing` true while recording $0, which is the hole DEC-7 exists to close.
- `aiUnavailableMessages.ts` could live beside chat-v4's `CHAT_ERRORS`, but under `lib/business-os/llm/` is fine given RC-W9.
- `docs/runbooks/` is a new directory. That is acceptable, or put the runbook next to the investigation doc.

### Approval

- [x] Workplan approved, with changes RC-W1 to RC-W11. Step 0 may proceed now.

---

## SA Code Review — Step 0

**Reviewed by SA — 2026-09-20** (working tree of `neuronforge-llm-layer15`, branch `feature/business-os-llm-layer2-model-settings`, uncommitted; reviewed against the code, not the doc)
**Verdict: APPROVED WITH CHANGES.** Two must-fix items (S-1, S-2), plus the S-6 ruling carried into Step 1. Nothing found that undermines the Step 0 design: the gate is fail-closed, the response contract is genuinely unchanged, and the `bos_llm_area_*` refusal cannot be defeated in a way that reaches Step 1's resolver. Re-review is a diff read of S-1/S-2 only.

### What was verified (and holds)

| Check | Verdict | Evidence |
|---|---|---|
| The gate is the first statement in all six handlers, before any body parse or query | ✅ | `system-config/route.ts:75, 105`; `pricing/route.ts:110, 141, 209, 268`; `pricing/sync/route.ts:40` |
| 401 signed out → 403 non-admin → fail closed when the check throws; `AdminAccessService` only, never `profiles.role` | ✅ | `lib/admin/requireAdminRoute.ts:59-79`; `AdminAccessService` reads the `admin_users` **table** (`lib/repositories/AdminUserRepository.ts:1-15`) |
| No route to a service-role write that skips the gate; no second handler and no ungated method | ✅ | Only `GET` and `PUT` are exported (`__tests__/route.test.ts:216` asserts the module shape); `system-config/route.ts` no longer constructs a Supabase client at all; both pricing files gate every exported method |
| Deleting settings `POST` is safe | ✅ | A repo-wide grep (all extensions, `.next` excluded) finds the path only in `page.tsx` (GET/PUT), the new tests, and two docs that mention the screen, not the verb. **No `POST` caller in any component, script, test or doc** |
| The `bos_llm_area_*` refusal survives nesting and prototype pollution | ✅ | Probed against the repo's zod (3.25.76): `z.record` drops a JSON `__proto__` key and `Object.prototype` is untouched; nested keys are values, never row keys; a mixed body is refused whole (`system-config/route.ts:133-147`) |
| Repository + Zod + Pino + `correlationId` | ✅ | `systemConfigRepository.getAll` / `setMultiple`; `putBodySchema`, `postBodySchema`, `pricingIdSchema`; **0 `console.*`** across the three routes (was 7 + 12 + 0); a `child({ correlationId })` logger in every handler |
| No internal error text outside development; nothing logs a secret or owner content | ✅ | `devDetails()` and `invalidBody()` gate on `NODE_ENV === 'development'`; PUT logs `keys` only (`system-config/route.ts:161-162`); the gate logs `userId` only and never the email (`requireAdminRoute.test.ts:80-96`) |
| The admin UI keeps working — request **and** response shapes truly unchanged | ✅ | Read `app/admin/system-config/page.tsx` directly: GET `:143` consumes `{ success, data: [{ key, value, category }] }`; the billing save `:410` sends `{ updates: { payment_grace_period_days: number } }` and passes the record schema; pricing PUT `:291` sends `{ id, input_cost_per_token, output_cost_per_token }` and passes; sync `:334` sends no body and the route reads none. N-14 holds |
| The tests prove denial, rather than asserting mocks | ✅ | Every 401/403 case asserts **zero** data access (`dataCalls() === 0`, `mockOps.length === 0`), so the request died before any query. Re-ran on review: `4 suites / 44 tests` green |
| No scope creep | ✅ | Every changed line maps to §4.2/§4.3. `runtime`/`dynamic` (D-7) and `MAX_KEYS_PER_REQUEST = 50` are in the plan |

### Findings

| # | File:line | Finding | Severity |
|---|---|---|---|
| S-1 | `app/api/admin/system-config/pricing/sync/route.ts:399-456` | **The most destructive pricing write is now the only unaudited one.** The sync rewrites ~40 `ai_model_pricing` rows and writes no audit entry, while the three single-row writes carry the admin id after RC-W10. `logAIPricingSynced(userId, { models_updated, models_added, source })` already exists at `lib/audit/admin-helpers.ts:264` and is called from nowhere in the repo. Add one non-blocking `await … .catch(…)` after the loop, in the same shape as `pricing/route.ts:189-192`. Four lines, and it completes RC-W10's intent: every admin pricing write is attributable | **High — must fix** |
| S-2 | `app/api/admin/system-config/route.ts:49, 133` | **The reserved-key test is case- and whitespace-sensitive.** `/^bos_llm_area_/` lets `BOS_LLM_AREA_chat` and `" bos_llm_area_chat"` through as new rows. This is not an escalation and not a shadow of a real row — Step 1 refills with `getByKeys` on the eight exact keys (§3.4), so a variant row is inert junk — but it defeats the stated guarantee of FR-17/DEC-10, and an operator who later "fixes" the casing in SQL ends up with a row that never passed `validateAreaRow`. Normalise before the test (`key.trim().toLowerCase()`) and reject any key with leading or trailing whitespace. Add both cases to T0-2 | **Medium — must fix** |
| S-3 | `app/api/admin/system-config/pricing/route.ts:168-176`, `:285-297` | A `PUT` for an id that does not exist returns **500** (PostgREST `PGRST116` through `.single()`), and a `DELETE` for a missing id returns **200** with no audit entry. Pre-existing, not introduced here. A 404 on both would be truer, and would also turn a mistyped id (S-5) into a clean 4xx | Low |
| S-4 | `app/api/admin/{orchestration-config,ui-config,memory-config,agent-generation-config,calculator-config}/route.ts`, `app/api/admin/settings/admin-users/route.ts` | **Scope observation — do not fix in Step 0.** The neighbouring admin config routes are still ungated (`calculator-config` has no auth at all, plus `console.*`; `settings/admin-users` requires only a *login* and then lets the caller add themselves to the legacy `admin_users` **config key**). Two things were checked and hold: (a) none of them can write an arbitrary `system_settings_config` key — they write fixed key lists, and `calculator-config` maps through an allow-list into `ais_system_config` — so FR-17 is not defeated through a side door; (b) `AdminAccessService` reads the `admin_users` **table**, not that config key, so the legacy route cannot mint an admin who passes `requireAdmin`. Record as a follow-up ("the rest of `/api/admin/*` on `requireAdmin`") | Medium (follow-up) |
| S-5 | `app/api/admin/system-config/pricing/route.ts:55-57` | **Ruling on D-1 — accepted, no change.** `string \| number → String()` is correct against a `uuid` or a `bigint` column; the worst case is a PostgREST 4xx, never the wrong row, and the admin page already sends a string. Two nits for when R-3 lands and the schema is narrowed: `z.number().int()` accepts `1e21`, which stringifies to `"1e+21"`, and a wrong-typed id surfaces as a 500 (S-3) | Low |
| S-6 | `app/api/admin/system-config/pricing/route.ts:59` | **Ruling on D-3 — the deviation stands for Step 0.** `>= 0` is what §4.2 specifies and what the screen accepts today; tightening an admin input range inside a security fix is the wrong cycle. But the hole is real and now confirmed: `hasPricing` (`lib/ai/pricing.ts:280-283`) returns `true` for a `0/0` row, so a zero price means (a) that model's usage is charged **nothing** and (b) under Layer 2 it **passes** the price-coverage guardrail. **Condition on Step 1:** the model guardrail (§3.3, "model (token)") must treat a `0/0` price as *unpriced* — unless the user rules that a zero price is legitimate (see below) | Medium (condition on Step 1) |
| S-7 | the four test files | Denial is proved properly (zero data access), and the shared gate is tested once, including "the email never reaches a log". Missing: (a) the S-2 case/whitespace keys; (b) a sync test that the audit entry is written (arrives with S-1). Deliberately **not** missing: a test that the real `AdminAccessService` denies — that is `getUser`/`admin_users` behaviour and belongs to T0.8's manual check | Low |
| S-8 | `app/api/admin/system-config/route.ts:49` vs Step 1's `bosLlmAreaKey` | **Step 1 conflict, decide before Step 1 code.** The `bos_llm_area_` prefix will exist in two places. Preferred: Step 1 exports `BOS_LLM_AREA_KEY_PREFIX` from `lib/business-os/llm/` and the route imports it. Caveat, which is why this is a choice and not an instruction: that import pulls this route into the `typecheck:bos-llm` scope (RC-W9). If that is unwanted, keep the literal and add a cross-reference comment in **both** files | Low |
| S-9 | `app/admin/system-config/page.tsx` | Correctly **not** touched, and its 20 `console.*` are flagged in D-6 as pending the user's OK — that satisfies CLAUDE.md § Logging, which binds files you modify. Note for T0.8/QA: a signed-in **non-admin** now sees the page's error banner reading `403 {"success":false,"error":"Forbidden"}`. That is the correct new behaviour, not a regression | Info |

### Optimisation suggestions (non-blocking)

- `lib/admin/requireAdminRoute.ts:69-72`: the fail-closed `catch` ends in the same 403 as a plain denial. A distinguishing field (`reason: 'check_failed'`) would make an `admin_users` outage greppable apart from a genuine non-admin.
- `pricing/sync/route.ts`: ~40 sequential read-then-write round trips per sync; a single `upsert` on `(provider, model_name)` would be one statement. Out of Step 0's scope — worth a line under RC-10b.

### Code Approved for QA

**Yes, conditionally:** land S-1 and S-2 (with their two tests), then QA. S-3, S-4, S-8 and the suggestions do not gate this step. S-6 is carried into the Step 1 review.

---

## SA Addendum — Step 0 scope change: `AiModelPricingRepository` + the zero-price policy

**Written by SA — 2026-09-20, on the user's instruction.** This **overrides** two earlier calls in this document: the RC-10b deferral of the pricing route's data access (§4.2, D-4, and S-4's "tracked follow-up" framing), and the S-6 ruling that a zero price needs no handling in Step 0. Direct Supabase access in a route is a **mandatory-rule violation** (CLAUDE.md § Mandatory Rules 1), and "the file already did it that way" does not waive it. It is fixed **inside Step 0**.

Spec only — the Dev implements. Nothing below changes the HTTP contract of any route: the admin page (`app/admin/system-config/page.tsx`) must still need no edit.

### A. Ruling 1 — a new repository, not an extension

**Create `lib/repositories/AiModelPricingRepository.ts`.** Do **not** add pricing methods to `SystemConfigRepository`.

| Why | Evidence |
|---|---|
| The convention is one repository per table/entity | 58 repositories in `lib/repositories/`, each named for its entity; `SystemConfigRepository` is bound to `system_settings_config` and its whole surface is key/value shaped (`getByKey`, `set`, `setMultiple`, `inferCategory`) |
| A second table inside it would break its own abstraction | `set()` / `setMultiple()` take a *key*; `ai_model_pricing` is row-shaped with an `id`, `provider`, `model_name`. There is no honest way to express `updateCosts(id, …)` in that surface |
| The barrel expects one export pair per entity | `lib/repositories/index.ts:9-13` exports `{ XRepository, xRepository }` per file |

Shape it exactly like its closest sibling, `SystemConfigRepository.ts:110-118`: a class with an **injectable** `SupabaseClient` (`constructor(supabaseClient?: SupabaseClient)`, defaulting to `supabaseServer`), a private `createLogger({ service: 'AiModelPricingRepository' })`, per-method `this.logger.child({ method, … })` with a `duration` on every log line, every method returning the shared result type and **never throwing**, plus a `export const aiModelPricingRepository = new AiModelPricingRepository();` singleton and a line in `lib/repositories/index.ts`. The injectable client is what makes T0-8 a real unit test.

The row type goes in `lib/repositories/types.ts`, beside `SystemSettingsConfig` (`:347`):

```typescript
export interface AiModelPricing {
  id: string;
  provider: string;
  model_name: string;
  /**
   * `numeric` columns come back from PostgREST as strings on some paths and as
   * numbers on others — `lib/ai/pricing.ts:23-24` types them as strings and
   * `parseFloat`s them, while the admin screen treats them as numbers. The union
   * is the honest type; the route must pass rows through untouched so today's
   * response bytes are unchanged.
   */
  input_cost_per_token: number | string;
  output_cost_per_token: number | string;
  effective_date: string;
  retired_date: string | null;
  created_at: string;
}
```

### B. Ruling 2 — the exact method surface

`RepositoryResult<T>` = the existing `AgentRepositoryResult<T>` from `./types` (`{ data: T | null; error: Error | null }`), imported under the local alias `RepositoryResult`, exactly as `AdminUserRepository.ts:20` does. **No method throws**; a failure is `{ data: null, error }`.

| # | Signature | Semantics the route depends on |
|---|---|---|
| 1 | `listAll(): Promise<RepositoryResult<AiModelPricing[]>>` | `select('*')`, `.order('provider').order('model_name')`. **Includes retired rows** — that is what the admin GET returns today; do not add an `is('retired_date', null)` filter here or the screen silently loses rows. `data` is `[]`, never `null`, on success |
| 2 | `findById(id: string): Promise<RepositoryResult<AiModelPricing \| null>>` | The before-image for the audit entry on PUT and DELETE. `.eq('id', id).maybeSingle()`; a missing row is `{ data: null, error: null }`, mirroring `SystemConfigRepository.getByKey:133-139` |
| 3 | `create(input: CreateAiModelPricingInput): Promise<RepositoryResult<AiModelPricing>>` | `.insert(input).select().single()`. `CreateAiModelPricingInput = { provider: string; model_name: string; input_cost_per_token: number; output_cost_per_token: number; effective_date: string }`. The **route** resolves the `effective_date` default (`new Date().toISOString()`), as it does today — the repository holds no clock policy |
| 4 | `updateCosts(id: string, costs: { input_cost_per_token?: number; output_cost_per_token?: number }): Promise<RepositoryResult<AiModelPricing \| null>>` | `.update(costs).eq('id', id).select().maybeSingle()`. **`{ data: null, error: null }` means "no such row"**, which lets the route answer **404** instead of today's 500 (closes S-3). An empty `costs` object returns an `Error` result without touching the DB (Zod already refuses it; this is the repository's own guard) |
| 5 | `deleteById(id: string): Promise<RepositoryResult<boolean>>` | `.delete().eq('id', id).select('id')`; `data = (rows?.length ?? 0) > 0`, so the route can answer 404 and skip the audit entry when nothing was deleted (closes the second half of S-3) |
| 6 | `syncMany(entries: AiModelPricingSyncEntry[]): Promise<RepositoryResult<AiModelPricingSyncResult>>` | See §D. `AiModelPricingSyncEntry` = `CreateAiModelPricingInput`; `AiModelPricingSyncResult = { updated: string[]; created: string[]; failed: string[] }` (model names, so the route's response body is byte-identical) |

Not in the surface, deliberately: no `listActive()`, no `hasPricing`, no `upsert`, no `retire()`. Step 0 gets exactly what the two routes call — the reader moves in Step 1 (§C) and brings `listActive()` with it.

### C. Ruling 3 — the `user_id` exemption, documented in the file

`ai_model_pricing` has **no `user_id` column**: it is platform-wide reference data (one price per provider/model), not tenant data. The mandatory `.eq('user_id', userId)` scoping therefore **does not apply**, and this must be stated in the repository header rather than silently skipped. Required header block (wording is the Dev's, content is not):

- The table is platform-wide; there is no tenant dimension, so there is nothing to scope and no cross-tenant read or write is possible through this repository.
- `supabaseServer` (service role) is therefore **intentional**, in the same way and for the same reason as `AdminUserRepository.ts:1-15`.
- Because scoping cannot protect it, **authorisation is the caller's job**: every caller must already be behind `requireAdmin` (`lib/admin/requireAdminRoute.ts`). Name the current callers.
- The `tenant-isolation-guard` ownership pre-check is **not applicable** here (no owner column), and no method accepts a caller-supplied filter, table name or column list — only ids and typed cost fields. State that, so a future reader does not "add a filter parameter" and reopen the question.
- Cross-reference: CLAUDE.md § Security Rules, and `docs/REPOSITORY_STRATEGY.md` (server-side only — never import this from a `'use client'` component).

### D. Ruling 4 — what changes shape in the sync path, and what must not

The catalogue array stays in `pricing/sync/route.ts` (it is data, not data *access*). The per-row loop (`:399-438`) moves into `syncMany`. Three things are load-bearing:

1. **Do not turn it into an `upsert`.** The table's unique constraint is `(provider, model_name, effective_date)` — see `supabase/migrations/20260213_add_claude_46_pricing.sql:21`, `ON CONFLICT (provider, model_name, effective_date)` — and the sync stamps `effective_date = now()` on **every** run. An upsert on that constraint would insert a brand-new row on every sync and the table would grow without bound. Keep today's semantics: match on `(provider, model_name)` **only**, update the matched row in place, insert when there is none.
2. **Fix the duplicate-row hazard while moving it** (record as a deliberate behaviour change in §4.8). Today's lookup is `.select('id').eq(provider).eq(model_name).single()` (`:401-406`). The unique constraint *permits* several `effective_date` rows per model, and with more than one `.single()` returns an error, `existing` is falsy, and the sync **inserts yet another duplicate** — every run makes it worse. In `syncMany` use `.order('effective_date', { ascending: false }).limit(1).maybeSingle()` and update the newest row.
3. **Per-row failures stay per-row.** One row's error goes into `failed` and is logged by the repository; it never aborts the run and never becomes an `error` on the result. The route's response body stays exactly `{ success, message, data: { updated, created, failed, total } }` with `failed` as model names — T0-5 already asserts `data.created` and `data.failed`.

**Logging seam.** The repository logs with its own `createLogger({ service: 'AiModelPricingRepository' })`, so the ~40 per-row lines lose the request's `correlationId`. Accepted, and deliberately **not** solved by passing a logger into the repository (that would be a new pattern for one call site, CLAUDE.md Mandatory Rule 7). The route keeps the correlation trail by logging **one** summary line after the call: `requestLogger.info({ userId, updated: …, created: …, failed: [...] }, 'Pricing sync complete')`.

**The S-1 audit call stays in the route.** Audit is attribution, and the admin id lives in the route — this matches `pricing/route.ts:189-192`, where the audit call sits beside the write and not inside the data layer. Feed it from `syncMany`'s counts:
`await logAIPricingSynced(gate.user.id, { models_updated: r.updated.length, models_added: r.created.length, source: 'admin_catalog_sync' }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`.
Emit it **only when the sync actually ran** (i.e. not on the repository-error path), and after the summary log.

### E. Ruling 5 — `lib/ai/pricing.ts` stays in Step 0, and moves in Step 1

**Ruling: it does NOT move in Step 0.** Reasons, in order of weight:

1. It is the **cost engine on the hot path of every billed LLM call** (`calculateCostSync` is called by `openaiProvider.ts:5`, `kimiProvider.ts:9`, `anthropicProvider.ts:7`, and `calculateCost` by `MemorySummarizer.ts:520`). Step 0 is a security step that must be deployable alone (§4.7); putting a rewrite of the billing reader in the same deploy trades one risk for a bigger one.
2. It is **not a route**. Mandatory Rule 1 bites hardest on `app/api/**`; a `lib/` module with its own cache is a planned migration, not a violation left in the diff the user is reviewing.
3. **Step 1 has to touch it anyway** — it needs `hasPricing` plus the new `> 0` rule (§F), so the move lands with tests that exercise it.

**Step 1 takes, as a named task (add to §5.1 when Step 1 starts):**
- `lib/ai/pricing.ts` reads through `aiModelPricingRepository.listActive()` (new then: `select('*').is('retired_date', null).order('effective_date', { ascending: false })`), its module-level `createClient` (`:121-125`) is deleted, and its **9 `console.*` calls** become Pino (`createLogger({ module: 'AiPricing' })`) — flag them to the user at that point, per CLAUDE.md § Logging.
- **A latent mispricing bug to fix in the same move, not before:** `:146-153` fills the cache with a `forEach` over rows ordered **newest-first**, and each `pricingCache.set(key, …)` overwrites the previous one — so for any model with more than one `effective_date` row the cache ends up holding the **oldest** price. Add a "first row per `provider:model` wins" guard and a test. (Related to D.2: the sync has been able to create exactly those duplicate rows.)

**Also out of Step 0, record as a follow-up:** `app/api/admin/agent-generation-config/route.ts:39` reads `ai_model_pricing` directly too (and is ungated — see S-4). It joins the same migration.

### F. The user's decision on zero prices (option b), and where each half belongs

**Decision (user, 2026-09-20):** a `$0` price stays **allowed**, but saving one is loud, attributable, and must never silently become "free AI" in Layer 2.

**Step 0 — the pricing route (not the repository; this is policy + attribution, not data access):**

1. The Zod schema stays `costSchema = z.number().finite().min(0)`. **D-3 is now settled: accepted as written, with the additions below** — no range change.
2. On any PUT or POST where a **saved** value is `0` for either cost field, after the write succeeds:
   - `requestLogger.error({ userId, pricingId, provider, model_name, input_cost_per_token, output_cost_per_token }, 'Zero price saved for an AI model — usage of this model will be billed at $0')`. Error level is intentional: it is a revenue event, not a warning.
   - **A dedicated audit entry**, in addition to the normal `AI_PRICING_UPDATED` / `AI_PRICING_CREATED` one, so it is findable without reading every pricing change: add `AI_PRICING_ZERO_SET: 'AI_PRICING_ZERO_SET'` to `lib/audit/events.ts:166-169` with metadata `{ severity: 'critical', complianceFlags: ['SOC2'], description: 'AI model price set to zero (usage billed at $0)' }` (same severity as `AI_PRICING_DELETED:741-744` — comparable revenue effect), and a helper beside the other three: `logAIPricingZeroCost(userId: string | null, pricingId: string, data: { provider: string; model_name: string; input_cost_per_token: number; output_cost_per_token: number; source: 'update' | 'create' }): Promise<void>`. It carries the acting **admin user id**, per the user's decision.
   - Awaited with `.catch(…)` exactly like the other audit calls (RC-W10 / D-2): a failed audit must not 500 a write that succeeded.
3. The sync path needs no zero check — the catalogue contains no zero prices — but if `syncMany` is ever given one, the same rule applies; a single pre-call filter in the route is enough. Optional, note it in §4.8 either way.
4. **Test T0-9** (new): a PUT and a POST that save `0` produce (a) an error-level log and (b) the `AI_PRICING_ZERO_SET` audit call carrying the admin id; a non-zero save produces **neither**; an audit rejection still returns 200.

**Step 1 — the resolver guardrail (this is the half that actually protects the money):**

5. §3.3, "model (token)": `hasPricing(provider, model)` is **not sufficient** and must not be the gate. Confirmed: `hasPricing` (`lib/ai/pricing.ts:280-283`) returns `true` for a `0/0` row. Replace it in the guardrail with the resolved price itself — `const p = await getPricing(provider, model); accept only if p !== null && p.input > 0 && p.output > 0` — memoised per `provider:model` per refill exactly as RC-W7c specifies for `hasPricing`. A zero-priced model is **rejected as a field**, the area falls back to the code default for that field, and the rejection is logged with `reason: 'zero_price'`.
6. **Caveat to write into §3.3 so nobody over-applies it:** `output: 0` is legitimate for embedding models (`lib/ai/pricing.ts:69-71`, `text-embedding-*` — priced on input only). The `> 0` rule belongs to the **Layer 2 area guardrail** only; do **not** push it into `calculateCost`, `calculateCostSync` or a global `hasPricing` change.
7. **T1-6 extension:** a `0/0` row is rejected by the guardrail and the area falls back to the code default; an embedding model's `output: 0` is untouched by the rule (assert the rule is not global).
8. This supersedes S-6's "condition on Step 1" — same outcome, now with the user's decision behind it and the Step 0 half specified.

### G. Step 0 task list (added to §4.3) and tests

- ⬜ **T0.10** `lib/repositories/AiModelPricingRepository.ts` + the `AiModelPricing` / `CreateAiModelPricingInput` / `AiModelPricingSyncEntry` / `AiModelPricingSyncResult` types in `lib/repositories/types.ts` + the `lib/repositories/index.ts` export. Header per §C (the `user_id` exemption, the service-role justification, "callers must be behind `requireAdmin`", server-side only).
- ⬜ **T0.11** `pricing/route.ts` and `pricing/sync/route.ts` switch to `aiModelPricingRepository`; both module-level `createClient` calls are **deleted**; the routes keep their gate, Zod, Pino and response shapes. PUT and DELETE gain **404** on a missing row (S-3). §4.8 gains D-8 (repository switch, RC-10b closed for these two routes) and D-9 (the `syncMany` duplicate-row fix, D.2).
- ⬜ **T0.12** The zero-price half of §F: `AI_PRICING_ZERO_SET` event + `logAIPricingZeroCost` helper + the error log and audit call in PUT/POST.
- ⬜ **T0-8** (test) `lib/repositories/__tests__/AiModelPricingRepository.test.ts`, with an **injected** mock client: `listAll` ordering and `[]` on empty; `findById` missing row → `{ null, null }`; `updateCosts` no-match → `{ null, null }` and empty-`costs` guard; `deleteById` false when nothing matched; `syncMany` update path, insert path, a per-row failure that does not abort, the newest-row-wins lookup, and **an assertion that no `upsert` is ever issued**; every method returns `{ data: null, error }` instead of throwing.
- ⬜ **T0-9** (test) the zero-price log + audit, per §F.4.
- ⬜ Existing tests must keep passing **unchanged in their assertions**: `pricing/__tests__/route.test.ts` and `pricing/sync/__tests__/route.test.ts` move from the `@supabase/supabase-js` double to a repository double, but the asserted statuses, bodies and "no data access when refused" checks stay identical. If an assertion has to change, the response contract changed — stop and flag it.
- ⬜ **§4.6 gates re-run** after the switch, plus one added static gate: **no `createClient` / `supabaseServer` import remains in `app/api/admin/system-config/**`**.

### H. What has NOT changed

S-1 and S-2 are still the blocking code-review items and are unaffected by this addendum (S-1's audit call simply lands in the route as specified in §D). The verdict on Step 0 remains **APPROVED WITH CHANGES**; this addendum adds T0.10–T0.13 to the same review cycle, so the Step 0 re-review covers the gate fixes, the repository switch and the zero-price policy together.

---

---

## SA Code Review — Step 0 (re-review)

**Reviewed by SA — 2026-09-20** (working tree of `neuronforge-llm-layer15`, branch `feature/business-os-llm-layer2-model-settings`, uncommitted. Reviewed against `git diff` + the untracked files, not against the Dev's summary. Gates re-run by SA, not taken on trust.)

**Verdict: APPROVED WITH CHANGES.** All of S-1, S-2, D-1 and T0.10–T0.13 land as specified, and I could not find a way to reach a pricing or settings write without passing the gate. **No code change is required.** The changes are confined to the **migration file** (R-1, R-2) plus one **pre-apply verification step** (R-3) that the user must perform before applying to production, and two docs hand-offs (P-1, P-2).

### What I verified independently (and holds)

| Check | Verdict | Evidence |
|---|---|---|
| **S-1** — the sync is audited | ✅ | `pricing/sync/route.ts` writes `logAIPricingSynced(gate.user.id, { models_updated, models_added, source: 'admin_catalog_sync' })`, `await … .catch(…)` so a failed audit cannot fail a sync that ran, and it sits **after** the success path so it is not emitted on a 500. Asserted twice in `sync/__tests__/route.test.ts` (entry + counts; and "no audit entry" on the 500 path) |
| **S-2** — reserved-key normalisation | ✅ | `system-config/route.ts:59-61` `isReservedKey` = `key.trim().toLowerCase().startsWith('bos_llm_area_')`; `:64-66` `isPaddedKey` refuses any padded key outright with its own 400. Tested for `BOS_LLM_AREA_chat`, `Bos_Llm_Area_Chat`, `' bos_llm_area_chat'`, `'bos_llm_area_chat '` **and** a padded non-reserved key (`__tests__/route.test.ts:159-180`). The reserved check runs first, so a padded reserved key answers with the reserved message — consistent with the tests |
| **D-1** — uuid narrowing | ✅ | `pricing/route.ts:53` `z.string().trim().uuid()`, used by PUT **and** by the DELETE query param. A non-uuid string and a numeric id are both 400s with `mockOps.length === 0` — the id never reaches PostgREST. S-5's two nits (`1e21`, wrong-type → 500) are retired by construction |
| **T0.10 repository conformance** to the addendum §A–§C and `docs/REPOSITORY_STRATEGY.md` | ✅ | `AiModelPricingRepository.ts`: injectable client defaulting to `supabaseServer`, own `createLogger({ service: … })`, `child({ method, … })` + `duration` on every line, all six methods on `AgentRepositoryResult` aliased as `RepositoryResult`, none throws, singleton + barrel export (`index.ts:13`, types at `:82-86`). `listAll` has **no** `retired_date` filter (asserted). Row/input types at `types.ts:347-389` with the `number \| string` numeric note |
| **The `user_id` exemption is documented, not skipped** | ✅ | `AiModelPricingRepository.ts:1-35` states all five required points: platform-wide table with no owner column, service role intentional (`AdminUserRepository` precedent), **authorisation is the caller's job** with both current callers named, `tenant-isolation-guard` not applicable + "do not add a filter parameter", and the CLAUDE.md / REPOSITORY_STRATEGY cross-reference with "server-side only" |
| **`syncMany` is not an upsert**, and the `.single()` duplicate bug is fixed correctly | ✅ | Lookup is `.eq(provider).eq(model_name).order('effective_date', desc).limit(1).maybeSingle()` → update the **newest** row; insert only when there is none. `AiModelPricingRepository.test.ts:255-284` asserts the exact `eq`/`order`/`limit`/`maybeSingle` chain, and asserts **no `upsert` on any call across a two-entry run**. A per-row failure lands in `failed` and the run continues (asserted). This is the right fix: matching on `(provider, model_name)` keeps one row per model, whereas an upsert on the real constraint `(provider, model_name, effective_date)` would add a row per model per run |
| **404 paths** | ✅ | PUT `:211` and DELETE `:330` answer 404 off `{ data: null }` / `false` from the repository, and **write no audit entry** — both asserted. `deleteById` derives the boolean from `.select('id')` rows, so a 404 is a real "nothing matched", not a guess |
| **Route suites really did move to a repository double with no assertion changed** | ✅ (read, not taken on trust) | Both suites mock `@/lib/repositories/AiModelPricingRepository` and no longer mock `@supabase/supabase-js`. The denial proof is unchanged in kind and in strength: every 401/403/400 case still asserts `mockOps.length === 0`. The only differences are **arrangement** — queued values now follow the repository contract (`null` for "no row", an array for `deleteById`, `{ updated, created, failed }` for `syncMany`) — plus the two additions the addendum ordered (404s, zero-price). The asserted statuses and response bodies are byte-for-byte the pre-switch contract: GET `{ success: true, data: [ROW] }`, PUT `{ success, data, message: 'Pricing updated successfully' }`, sync `{ success, message, data: { updated, created, failed, total } }` |
| **The static gate is a real gate** | ✅ | `__tests__/dataAccess.test.ts` walks `app/api/admin/system-config/**` recursively (skipping `__tests__`), asserts ≥3 files were found — so it cannot silently pass on an empty list — and per file forbids `createClient`, `@/lib/supabaseServer`, `@/lib/supabaseClient`, `@supabase/supabase-js`, a raw `.from('…')` and `console.*`. That is exactly the shape of the pre-Step-0 code, so a regression fails the suite |
| **Zero-price implementation** | ✅ | `pricing/route.ts:117-149` `reportZeroPrice`: fires when **either** saved cost is 0 (`if (input !== 0 && output !== 0) return`), error-level Pino line, then `logAIPricingZeroCost` awaited with `.catch`. `events.ts:170` + `:751-757` register `AI_PRICING_ZERO_SET` at `severity: 'critical'` / `['SOC2']` exactly as specified; `admin-helpers.ts:261-297` carries the acting admin id and `entityType: 'ai_pricing'`. T0-9 covers PUT, POST, the negative case, a rejected audit, and PostgREST's numeric-as-string `'0'` |
| **D-12 claim** (the sync catalogue has no zero prices) | ✅ | Checked the catalogue directly: 42 entries, **no** `cost_per_token: 0` and no embedding models. The route-side zero check is therefore genuinely unreachable from the sync |
| **`console.*` in every touched file** | ✅ | 0 across all ten changed/new files (three routes, `lib/admin/requireAdminRoute.ts`, the repository, the two audit files, `audit/types.ts`, the two repository barrel/type files). `app/admin/system-config/page.tsx` (20) is correctly untouched and still flagged in §12 / D-6 |
| **Gates re-run by SA** | ✅ | `npx jest app/api/admin lib/admin lib/repositories` → **29 suites / 284 tests passed**, matching §4.6. Full `tsc --noEmit`: the **only** errors matching any touched file are the four pre-existing `'reward_config'` lines at `lib/audit/admin-helpers.ts:76,100,124,148`. Zero new type errors in the routes, the repository, its test, `lib/admin` or the audit files |
| **Scope creep** | ✅ none | Every changed file appears in §4.2. Nothing touches `lib/ai/pricing.ts`, `agent-generation-config`, the neighbouring admin routes or the `profiles` policy — all correctly deferred |
| **Step 1 conflicts** | ✅ none introduced | S-8 (the `bos_llm_area_` prefix constant) is still the only one, still a Step 1 decision. The repository's method surface deliberately omits `listActive()` / `hasPricing`, which is what Step 1 adds when `lib/ai/pricing.ts` moves — no rework, only addition |

### Findings

**Migration (`supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql`) — the artefact that reaches production.**

| # | File:line | Finding | Severity |
|---|---|---|---|
| R-1 | `…20260920a_lock…sql:101` | **`SET search_path = public, pg_catalog` puts `public` ahead of `pg_catalog` in a SECURITY DEFINER function.** The body calls `lower()` and `nullif()`; with `public` searched first, a `public.lower(text)` would shadow the built-in inside a definer-rights function. In this database that is not currently exploitable — Postgres 15 no longer grants `CREATE` on `public` to `PUBLIC`, and Supabase does not grant it to `anon`/`authenticated` — so this is hardening, not a live hole. But it is a one-token fix on the single most privileged object the migration creates. **Change to `SET search_path = pg_catalog, public`** | **Medium — fix before applying** |
| R-2 | `…20260920a_lock…sql:162-168` | **The REVOKEs name `anon, authenticated` but not `PUBLIC`.** A privilege held via `PUBLIC` rather than via the two roles survives this migration untouched, and grants are checked **before** RLS — the layer the file itself calls "the primary lock". The verification block *queries* `PUBLIC` but the REVOKE never names it, so the operator would see the row and have no statement that removes it. **Add `PUBLIC` to both REVOKE statements** (a harmless no-op if nothing is granted that way) | **Medium — fix before applying** |
| R-3 | §4.4, R-2 result row | **The safety of the two `DROP POLICY` statements rests on a prose summary, not on the raw `pg_policies` output.** §4.4 records "SELECT open to `public` + `authenticated`" as a sentence; the actual rows were not pasted. If that read openness is in fact delivered **by one of the two `FOR ALL` policies being dropped** rather than by a separate `SELECT` policy, then applying this migration silently removes anon SELECT on `system_settings_config` and **the browser theme provider stops loading `v2_custom_tokens`** (and the anon-client `OrchestrationService` / `MemoryCompressor` config reads start returning nothing and fall back to defaults). This is the one plausible way this migration breaks a live read path. It is cheap to close: re-run the R-2 query and confirm a policy with `cmd = 'SELECT'` whose name is **neither** of the two being dropped, before applying. See the go/no-go below | **High — verify before applying (no code change)** |
| R-4 | §4.4, R-3 result row | The R-3 result records the grant rows for **`ai_model_pricing` only**; what `anon`/`authenticated` held on `system_settings_config` was never written down. So the migration revokes privileges on that table without recorded evidence of what was there, and the rollback block `GRANT`s the full write set back **unconditionally** — which could leave the table *more* open than it started. Rollback is to a knowingly insecure state anyway, so this is bookkeeping rather than risk: **paste the full R-3 rows for both tables into §4.4** when re-running the verification | Low |
| R-5 | `…20260920a_lock…sql:96-121` | **`is_platform_admin()` is correct.** SECURITY DEFINER is genuinely required (`admin_users` is RLS-locked to `service_role` by `20260701_create_admin_users.sql`, which does **not** use `FORCE`, so a definer function owned by the table owner reads it); it mirrors `AdminAccessService.isAdmin` steps 1 and 2 (`user_id` match, or an `is_active` row whose `email` equals the lowercased JWT email — and `AdminUserRepository.normalizeEmail` does store `trim().toLowerCase()`, so the comparison lines up); omitting step 3 (the `ADMIN_EMAILS` env fallback) is correct and correctly explained. `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role` is right — `anon` never evaluates either policy, since both are `TO authenticated`. **One operator caveat, not a defect:** this presumes the migration is applied by a role that owns (or bypasses RLS on) `admin_users` — true in the Supabase SQL editor, which runs as `postgres` | Info (correct) |
| R-6 | `…20260920a_lock…sql:229-262` | **The rollback does reverse the migration**, in a safe order (policies dropped before the function they depend on; RLS disabled; grants restored). Two cosmetic gaps: it does not restore the two original `COMMENT ON TABLE` texts, and `DROP FUNCTION IF EXISTS public.is_platform_admin()` will fail if a *later* migration adds a policy that uses it. Both acceptable; the file already warns that the two recreated policies are reconstructions rather than byte-exact copies | Low |
| R-7 | `…20260920a_lock…sql:264-272` | **The FORCE-RLS-left-commented judgement is right, and so is the reasoning.** `service_role` bypasses RLS by role attribute, not by ownership, so FORCE changes nothing for any application path; it would only blind the Supabase table editor and owner psql sessions. Leaving it as a documented opt-in is the correct call | Info (agreed) |
| R-8 | whole file | **Idempotent and re-runnable**, verified statement by statement: `CREATE OR REPLACE FUNCTION`, `ENABLE ROW LEVEL SECURITY` (no-op when already on), `DROP POLICY IF EXISTS` before every `CREATE POLICY`, `REVOKE`/`GRANT`/`COMMENT` all naturally idempotent, everything inside one `BEGIN`/`COMMIT` | Info (correct) |

**Read-path safety — the billing question, verified end to end.**

| # | Finding | Severity |
|---|---|---|
| R-9 | **Turning RLS on over `ai_model_pricing` with an admin-only SELECT policy cannot break a price read.** I enumerated every reader in the repo rather than trusting the grep note: `lib/ai/pricing.ts:121-129` builds its own client with `SUPABASE_SERVICE_ROLE_KEY`; `app/api/admin/agent-generation-config/route.ts:7-9,39` is a module-level service-role client; the admin pricing route reads through the repository → `supabaseServer`, and `lib/supabaseServer.ts:9-15` uses the service-role key with **no anon fallback** (a missing key throws at construction rather than degrading to anon — so there is no silent "reads as anon in production" path); `scripts/analyze-pricing-discrepancies.ts` and `scripts/calculate-gpt4o-cost.ts` are service-role. **There is no browser-side or `supabaseServerAuth` reader of `ai_model_pricing` anywhere**, and no SQL view, function or trigger over the table exists in `supabase/`. `service_role` has BYPASSRLS, so every one of these is unaffected. **Billing does not break** | Info (the key clearance) |
| R-10 | **The REVOKEs cannot break a live write path.** I checked every `system_settings_config` consumer against the client it actually uses: the only browser-client (`@/lib/supabaseClient`) touches are `theme-provider.tsx:63` (SELECT), `OrchestrationService.ts:59,90,114` (SELECT only — the file issues no `insert`/`update`/`upsert`/`delete` at all) and `MemoryCompressor.ts:335` (SELECT). Every writer is service-role: the admin config routes, `SystemConfigRepository` (`supabaseServer`), the Stripe webhook, `admin-users` / `platform-users`. `SystemConfigService` takes its client as a parameter, and its only two write callers are `app/api/admin/helpbot-config/route.ts:139` (service-role client) and `CurrencyService.updateRatesFromAPI`, which has **zero callers repo-wide** — confirmed by grep, so the migration's claim holds | Info (the second key clearance) |

**Code (non-blocking; none of these gate QA).**

| # | File:line | Finding | Severity |
|---|---|---|---|
| C-1 | `app/api/admin/system-config/pricing/route.ts:125` | **The zero-price alert will fire on legitimate embedding rows.** `reportZeroPrice` triggers when *either* cost is 0, which is what the SA addendum §F.2 specified — but `lib/ai/pricing.ts:69-72` shows `text-embedding-3-small/large/ada-002` are priced input-only with `output: 0`. Editing such a row's input price therefore writes a **`critical`**-severity audit entry and an error-level log for a completely normal change. The implementation is conformant, so this is my spec to correct, not the Dev's code: the sync catalogue contains no embeddings (verified), so nothing fires today, but the moment an embedding row is edited through the screen the critical channel takes a false positive. **Record it in §4.8 and decide in Step 1** — the natural narrowing is "input = 0, or output = 0 on a model that is not input-only" | Medium (non-blocking; carry into Step 1 with S-6 / §F.5) |
| C-2 | `lib/audit/admin-helpers.ts:76,100,124,148` | D-10's own reasoning applies equally to the four `'reward_config'` errors sitting in a file this cycle **does** touch: registering it is the same one-line change, in the same array, with the same justification (the helpers already write the value), and it would take a touched file from 4 `tsc` errors to 0. F-3 defers it on the grounds that Layer 2 does not own reward-config — reasonable, but it is worth ~30 seconds if the RM is already in the file | Low |
| C-3 | `lib/admin/requireAdminRoute.ts:60` | `getUser()` sits outside the `try`, so an auth-layer throw becomes the route's 500 rather than a 401/403. Still fail-closed (no handler runs), so not a hole — but a `catch` returning 401 would make an auth outage read correctly in the logs. Pairs with the earlier suggestion to tag the fail-closed 403 with `reason: 'check_failed'` | Low |
| C-4 | `app/api/admin/system-config/pricing/route.ts:106-108` | `toNumber` returns `NaN` for an unparseable numeric string, and `NaN !== 0`, so a corrupt value would *skip* the zero-price alert rather than raise it. Unreachable in practice (the column is `numeric`), noted only so nobody "simplifies" the comparison later | Low |

**Process / scope.**

| # | Finding | Severity |
|---|---|---|
| P-1 | **Registering `ai_pricing` in `lib/audit/types.ts` (D-10) is acceptable, not scope creep.** It is required for `AI_PRICING_ZERO_SET` to type-check, it is additive to a `readonly` tuple, and I confirmed the blast radius is nil: the only consumers of `AUDIT_ENTITY_TYPES` are the `EntityType` alias, `CLIENT_WRITABLE_ENTITY_TYPES` (an explicit three-value list that does **not** include it) and `AI_ACTION_ENTITY_TYPE`, so no client-writable surface widens and no stored row changes shape. It also retires three pre-existing type errors the older pricing helpers were already producing | Info (approved) |
| P-2 | **F-1 and F-2 are captured well enough to hand off, with two gaps to close when Step 0 merges.** `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` § Open Items already carries the matching items (#1 self-promotion, #2 gate the `/api/admin/*` routes), so neither follow-up dies with this workplan. But (a) that doc's item #1 is scoped to `app/api/user/profile/route.ts` + the `ProfileTabV2` option — it does **not** mention the actual write hole §4.4 found, the `profiles` UPDATE policy `USING (auth.uid() = id)` with no `WITH CHECK` and no column restriction; and (b) the same doc's threat table asserts *"no code reads `profiles.role` for access"*, which was **untrue** until this migration drops the `system_settings_config` policy that did exactly that. **Add both to `ADMIN_IDENTIFICATION_AND_ACCESS.md` (Open Items + a Change History row) when Step 0 merges** — that is where a future reader will look, not in this workplan | Medium (docs, do at merge) |
| P-3 | No Step 1 conflict introduced, and no scope creep. §4.9's F-1…F-4 each carry evidence and a why-not-now, which is the right level for a hand-off | Info |

### Go / no-go for applying the migration to production

**GO — conditional on three things, in this order.** The migration is well-reasoned, idempotent, reversible, and I could not find a read path it breaks. The conditions below are cheap, and two of them are one-line edits.

1. **Make the two edits first** — R-1 (`SET search_path = pg_catalog, public`) and R-2 (add `PUBLIC` to both REVOKE statements). Neither changes behaviour in the expected case; both remove a way this could be wrong.
2. **Run the R-2 `pg_policies` query on production before applying, and confirm with your own eyes that `system_settings_config` has a `SELECT` policy whose `policyname` is neither `"Only admins can modify settings"` nor `"Only admins can modify system settings config"`** (R-3). If no such separate SELECT policy exists, **stop** — the two `DROP POLICY` statements would take anonymous read access with them and the V2 theme provider would stop loading `v2_custom_tokens`. Paste the raw rows into §4.4 while you are there, along with the `system_settings_config` grant rows (R-4).
3. **Apply after the Step 0 deploy**, as §4.7 already says, then re-run the verification block and do the three-minute smoke test it lists: `/admin/system-config` loads, one price edit + revert, one sync, and the V2 theme still picks up custom tokens.

**What you must know before you run it:**

- **Billing will not break.** Every reader of `ai_model_pricing` in this repo is service-role and `service_role` bypasses RLS; there is no browser-side reader and no anon fallback in `supabaseServer`. This was the main risk and it is cleared (R-9).
- **Nothing in the app writes either table as `anon` or `authenticated`**, so the REVOKEs are inert for the application and hostile only to a stranger holding the public anon key (R-10).
- **After this, an `authenticated` session can only write these tables if it is in `admin_users`.** Every app write path is service-role so nothing changes — but if you ever edit these tables from a logged-in session or a non-service-role tool, seed yourself into `admin_users` first.
- The two policies being dropped are the `profiles.role` one (a real privilege-escalation path, since `profiles` is user-writable) and an inert `auth.users.role` one. **The `profiles` self-promotion hole itself is not closed by this migration** — it is F-1. After applying this, `profiles.role` no longer buys write access to *these two* tables, but it remains a live platform-wide follow-up.

### Code Approved for QA

**Yes — unconditionally, for the code.** S-1, S-2, D-1 and T0.10–T0.13 are delivered as specified; the gates reproduce; C-1…C-4 are non-blocking, and C-1 is carried into the Step 1 review alongside S-6 / §F.5. **The migration is a separate approval** and is gated on the three conditions above. T0.8 (the manual admin / non-admin check) is still open and should run before QA signs off.


## SA Code Review — Step 1

**Reviewed by SA — 2026-09-20** (worktree `neuronforge-llm-layer2-step1`, branch `feature/business-os-llm-layer2-step1` off `main` `ba25fb9a`, **uncommitted**. Reviewed against the code and the gates, not the Dev summary. SA changed nothing but this document.)
**Status:** 🔄 **Fix Required** — 2 must-fix before QA, 1 of which also blocks the seed apply. Nothing in the design is wrong; both blocking items are in the *proof*, not in the machinery.
**Code Approved for QA:** **Not yet** — after S1-1 and S1-2. The rest may travel with the PR or as follow-ups, as marked.

### What SA re-ran and verified independently

| Check | Result |
|---|---|
| `npx jest lib/business-os/llm lib/ai lib/repositories/__tests__/AiModelPricingRepository.test.ts scripts/__tests__ app/api/admin/system-config` | **18 suites / 343 tests / 1 snapshot — all pass** |
| `npm run typecheck:bos-llm` | `168 files in scope, 30 errors, 0 new` — passed (168 vs 158 is the generated `.next/types`, as §5.4 states) |
| `console.*` in every touched file | **0** in all nine (`pricing.ts`, `openaiProvider.ts`, `AiModelPricingRepository.ts`, the pricing route, the script and the four `llm/` modules) |
| Explicit `any` in the new modules | none |
| Client-side import of the resolver / policy / schema / fallback, or of `lib/ai/pricing` | none. `app/admin/system-flow/page.tsx` only *names* `lib/ai/pricing.ts` in a description string; no edge-runtime route exists, so the new module-level `supabaseServer` construction behind `pricing.ts` is safe |
| Seed SQL read line by line against §10 and `__fixtures__/seededRows.ts` | **All eight rows match**, value for value (chat 0 + planner no temperature; insights 0.3/0.4/0.5; briefing 0.3; website 0.7 + `full_site`/`landing_page` `gpt-4o` + `testimonial_enhance` 0.5; intake `gpt-4o` 0.3 + `question_inference` `gpt-4o-mini` 0.2; leads 0.2 + S(); onboarding `gpt-4o` + explicit `NULL`; images no temperature key). Verified by SA by hand — see S1-3 for why the test does not do this |
| Legacy readers named in `scripts/bos-llm-settings.ts:88-126` vs the real call sites | **Correct**: `SystemConfigService` for the two chat models and `bizchat_analysis_enabled` (as `Planner.ts:118-124` and `AnalysisService.ts:91-95` use it), `systemConfigRepository` for the two leads keys (`LeadReplyRecommender.ts:95-98`), `getImageGenerationConfig().model` for images |

### Code Review Comments

1. **`scripts/bos-llm-settings.ts:1-60` — the script cannot be run as documented; P-3 and P-5b are unrunnable today. Priority: High (blocks the seed apply).** It loads no environment, unlike every other operational script in `scripts/` (which all call `dotenv.config({ path: '.env.local' })`), and `lib/supabaseServer.ts:15` builds the service client at *import*. SA ran it: `npx tsx scripts/bos-llm-settings.ts` → `Error: supabaseUrl is required.` before a single line of usage prints. The repo already ships the fix — `scripts/env-preload.ts` — and SA verified it works: `npx tsx --import ./scripts/env-preload.ts scripts/bos-llm-settings.ts` prints the usage after injecting 62 variables from `.env.local`. **Fix:** adopt that invocation (or an `npm run bos:llm-settings` wrapper) and correct it in **all four places** it is written down: the script header (lines 11-15), the migration header (P-3 line 31, P-5b line 42), §3.6 and §9 (P-3, P-5b). Dev evidently never ran the script end to end; QA must, read-only, before the apply. **S1-1.**

2. **`lib/business-os/llm/__tests__/callParams.snapshot.test.ts:111-112, 259-272` — proof leg (A) has demonstrated false negatives; four of the twenty-two calls can change behaviour with the test still green. Priority: High.** The evidence check anchors on `callName: '<x>'` and accepts the literal anywhere within ±45 lines, so a *sibling* call's identical literal satisfies it. SA mutated the real file in memory and re-ran the test's own window logic:

   | Mutated call site | Evidence still passes |
   |---|---|
   | `WebsiteAIContentService.ts:401` — `hero_content` model → `gpt-4o` | **yes** (satisfied by `about_content`'s line 450) |
   | `WebsiteAIContentService.ts:403` — `hero_content` temperature → 0.15 | **yes** (satisfied by `about_content`'s line 452) |
   | `WebsiteAIContentService.ts:316` — `field_regenerate` model | **yes** (satisfied by `testimonial_enhance`'s line 361) |
   | `WebsiteAIContentService.ts:361` — `testimonial_enhance` model | **yes** (satisfied by `hero_content`'s line 401) |
   | the other 18 calls, including all three `InsightRepository` calls | no — they fail correctly |

   **Fix:** bound each window by the neighbouring `callName:` anchors (search only between the previous and the next anchor in that file), or match inside the enclosing call object. Not a redesign — a smaller window. **S1-2.**

3. **`lib/business-os/llm/__tests__/modelSettingsSeed.test.ts:79-130` — T1-9 proves the migration by substring only. Priority: Medium.** It asserts the eight keys, the category, one `ON CONFLICT DO NOTHING`, the six unwrap expressions and the superseded guard — but it never compares the SQL's `jsonb_build_object(...)` values with `SEEDED_ROWS`. Every "the seed changes nothing" claim (leg C of T1-14, and the second half of T1-9) therefore runs on the **fixture**, not on the file the user pastes into the SQL editor. SA has hand-verified that the two are identical today, so this is not a blocker for the apply; it is a blocker for trusting the test the next time the seed is edited. **Fix:** extract each area's `VALUES` block from the SQL and compare its literal key/value pairs with the fixture. **S1-3.**

4. **`lib/ai/pricing.ts:150-176` — the cache fix is a real production behaviour change, in a step advertised as inert. Priority: Medium.** Any model with more than one non-retired `ai_model_pricing` row is priced at its **newest** `effective_date` from the moment Step 1 deploys, where today it is priced at its **oldest**. That is the right fix and SA assigned it, but it must not travel as "inert". **Fix:** say so in §5.5 and §9, and run this read-only query *before* the Step 1 deploy so the blast radius is known in advance:

   ```sql
   SELECT provider, model_name, count(*) AS rows,
          min(effective_date) AS oldest, max(effective_date) AS newest
     FROM ai_model_pricing
    WHERE retired_date IS NULL
    GROUP BY 1, 2
   HAVING count(*) > 1
    ORDER BY 1, 2;
   ```

   Zero rows → the change really is inert. Any rows → the user should see the price delta before it starts charging. **S1-4.**

5. **`lib/repositories/AiModelPricingRepository.ts:110-117` — `listActive()` has no `effective_date <= current_date` filter and no tie-break. Priority: Medium.** With "newest wins" now in force, a price entered ahead of time takes effect the moment it is saved rather than on its date. Add `.lte('effective_date', <today>)`, or state in the header why a future-dated row is meant to apply immediately; and add `.order('created_at', { ascending: false })` as a secondary sort so the result stays deterministic even if the `(provider, model_name, effective_date)` uniqueness ever lapses. **S1-5.**

6. **`lib/repositories/AiModelPricingRepository.ts:20-25` — the header's security invariant is now false. Priority: Medium.** It states "Every caller must already be behind the admin gate `requireAdmin` … Do not add a caller that is not behind that gate", and Step 1 adds exactly such a caller: `lib/ai/pricing.ts`, on the hot path of every billed call, from any user's request. The *decision* is right (platform reference data, no tenant column, service role, read-only), but the rule as written now misleads the next reviewer. **Fix:** distinguish the two caller classes in the header — admin-gated readers/writers of the admin surface, and the single service-role billing reader — and keep the "no new caller outside these two" rule. D-17's empty-result note is correctly carried in both files. **S1-6.**

7. **`modelSettingsPolicy.ts:190-193` with `modelSettings.ts:543-555` — the website kill switch is partial *and silent* between Step 2 and Step 3. Priority: Medium.** `full_site`, `field_regenerate` and `testimonial_enhance` are `switchable: false` (RC-W8b, correct), and a locked call always resolves `enabled: true` (D-27, correct). The consequence is that `set website --enabled false` succeeds, reports nothing unusual, and leaves three of the eight website calls spending — while RC-W8c makes the script refuse the far smaller case of a call-level `enabled: true`. **Fix:** `commandSet` must list the non-switchable calls that will keep running whenever `--enabled false` is used on an area that has any (a warning, not a refusal — a refusal would make the switch useless), and §7.5 plus the runbook must state that the website switch is partial until Step 3. **S1-7.**

8. **`modelSettings.ts:476-502` — provider and model can decohere on a fallback. Priority: Low (latent).** They resolve independently, so a rejected model falls back to the *code default model* while `provider` keeps a configured value. Unreachable while every call's `allowedProviders` is `['openai']`, but it is a trap for the first call that legitimately allows a second provider: `{ provider: 'anthropic', model: 'gpt-4o' }` is plausible and wrong. **Fix (one line):** when the model ends up at `defaults.model`, take `defaults.provider` with it. **S1-8.**

9. **`modelSettings.ts:512-517` — D-18 is implemented as "call level only", not as "only when it would change something". Priority: Low.** See the ruling below: the principle is accepted, but an **area**-level temperature that differs from a locked value (chat `temperature: 0.7` while the planner is locked at 0) is currently reported nowhere, so an operator gets no sign that half of their intent did not land. **Fix:** report it as `kind: 'adjusted'` when it differs from the locked value — visible in the resolver log and in `get`, non-blocking for the change script, and still silent for the seed's `0 === 0`. **S1-9.**

10. **`modelSettings.ts:570` — the RC-11 "temperature dropped" issue always logs `level: 'area'`. Priority: Low.** It is pushed after resolution, so it no longer knows which level the value came from. Either carry the level through or use `level: 'call'` with the call name (already set). Cosmetic, but these logs are the only Layer 2 diagnostics until the admin screen ships. **S1-10.**

11. **`scripts/bos-llm-settings.ts:319-365` — `verify-stored` does not say which database it is talking to. Priority: Low.** P-3 and P-5b are run by hand, against production, from a worktree whose `.env.local` was copied in. Log the Supabase project host once at the start of both verify commands, so the operator can see it before acting on the exit code. **S1-11.**

12. **`supabase/migrations/20261003_seed_bos_llm_area_settings.sql:211-221` — the superseded marker turns a NULL description into the key.** `COALESCE(description, key) || ' — superseded…'`, while the documented rollback only `replace()`s the suffix, so a row that had no description keeps the key as its description. Priority: Low; cosmetic, and re-runnable either way.

### Rulings on the deviations

| Deviation | Ruling |
|---|---|
| **D-18** — a locked field is reported only when it would *change* something | **ACCEPTED.** The alternative is worse in both directions: the resolver would warn every 60 seconds about the very row the seed writes, and `validateAreaRow` — which blocks on any non-`adjusted` issue — would refuse the seeded chat and onboarding rows, so the change script could not rewrite what the migration just wrote. The rule hides no real misconfiguration in the two cases that motivated it (`enabled: true` on an always-on area; a locked temperature set to its locked value): in both, intent and outcome agree. **Condition: S1-9** — apply the same "would change something" test at the *area* level for a locked temperature, as a non-blocking `adjusted` report, instead of skipping that level entirely. A thwarted intent must be visible somewhere. |
| **D-21** — T1-14 proves AC-2's "before" from the call sites' source, not by driving the twelve services | **ACCEPTED AS AMENDED.** It is **not** a tautology: legs (B) and (C) are genuine assertions — an independently written table of 22 calls compared with what the resolver actually returns, first with no configuration and then with the eight seeded rows — and those are the claims Step 1 exists to make. Leg (A) is the only novel proof and it is the weak one, in two distinct ways: **(i) it is currently unsound** (S1-2: four calls' evidence is satisfiable by a sibling), and **(ii) even once sound it proves *text*, not dataflow** — a parameter added by a wrapper or a shared request builder, a value overridden downstream, a second call site for the same call, or a call that stops being made at all are all invisible to it. The narrower Step 1 test is proportionate **only because Steps 2 and 3 drive the real sites**, so that obligation must be written where it will be honoured. **Conditions:** (a) fix S1-2; (b) amend §6.3 and §7.3 so that T2-S / T3-S capture the **whole request object at the provider boundary** — not just `{ provider, model, temperature }` — and assert the **number of calls made**, comparing against this snapshot. With (a) and (b), §5.1's "drive each site once" is discharged, not dropped. |
| **D-22** — the script also refuses an unknown call name or top-level key | **ACCEPTED.** Stricter than §3.6 in the right direction: `calls.insight_contnet` is an operator typo that would otherwise exit 0 and do nothing. The resolver correctly keeps DEC-2's ignore-and-warn, so a stale key in a stored row can never break resolution. The asymmetry is the point. |
| **D-23** — `bos_llm_area_` duplicated in the admin route | **ACCEPTED.** Verified both ends: `app/api/admin/system-config/route.ts:49` and `modelSettingsPolicy.ts:52`, kept in step by `modelSettingsPolicy.test.ts:191-194`, which reads the route's source and matches the constant. One duplicated string is a better trade than pulling a whole API route and its import graph into the `typecheck:bos-llm` scope. |
| **D-24** (zero-price alert narrowed) and **D-25** (`pricing.ts` Pino + cache fix) | **ACCEPTED**, with **S1-4** and **S1-5**. The narrowing is correct and contained: `isInputOnlyPricedModel` sits beside the price table that documents those rows, `calculateCost` / `calculateCostSync` / `hasPricing` are untouched, and Layer 2 keeps its own stricter `input > 0 && output > 0` rule — verified at `modelSettings.ts:244` and in its test at `modelSettings.test.ts:246-264`. The Pino conversion is complete and the demotion of the two per-call lines to `debug` is right. The cache fix is real and tested (`pricing.test.ts:75-91`, newest-first with a `superseded` count) — but it is a behaviour change; see S1-4. |
| **D-26** — extra exports for testability | **ACCEPTED.** `checkModelAcceptable` earns its keep: it is what proves every code default would itself pass the guardrails, which is the only thing that makes RC-W7b ("the default is never checked at runtime") safe rather than convenient. |
| **D-27** — a locked call reports `enabled: true`; chat-off enforced at route entry | **ACCEPTED for chat and onboarding** — the planner following the chat area through `isBosLlmAreaEnabled` at route entry is the correct single mechanism, and onboarding cannot be switched off at all. **Conditional on S1-7 for website**, where the same rule carries an operational cost nobody is told about. |
| **D-19**, **D-20** — migration renamed; fixture in `__fixtures__` | Accepted; housekeeping. |

### What holds, and is worth recording

- **The resolver's three promises hold.** Never-throws is real at three layers (`evaluateAreaRow` tolerates any shape, `refill` wraps everything, `resolveBosLlmSettings` has a final catch). The cache is correct: `getSnapshot` assigns `inFlight` synchronously before any `await`, so a burst shares one read; a failed read keeps the last good snapshot and retries at 10 s without querying in between; each serverless instance costs one `getByKeys` of eight keys per minute. No path found by which a cron or a burst can hammer the database.
- **The guardrails fail safe in every combination SA tried**: an unpriced model, a 0/0 row, a rejected provider, a temperature out of range, a non-boolean `enabled`, a non-object row, a JSON-string row, an unknown call name, a reasoning model on a penalty-sending call, and `o1` on any token call all fall back to today's value and log. The two reasoning families are right precisely because they differ: `gpt-4.1` takes a temperature but uses `max_completion_tokens`, while `o1` rejects sampling parameters and predates it — which is exactly what the `rejectsSamplingParameters && !usesMaxCompletionTokens` rule catches. The `openaiProvider` change is safe for existing callers: the private method delegates to a module function with an identical body, and the request building is untouched.
- **Repository pattern, Zod and Pino** are all satisfied, including the one that mattered most: `lib/ai/pricing.ts` no longer builds its own Supabase client.
- **Nothing here will fight Steps 2 or 3**, with the single exception noted in S1-7.

### Go / no-go for applying the seed migration

**GO — conditional on S1-1 only.** The SQL itself is sound: SA read it against §10 and the fixture and they agree row for row; `ON CONFLICT (key) DO NOTHING` cannot overwrite; the file is re-runnable; the superseded marker is guarded; and the rollback `DELETE` is safe *while and only while* no deployed code reads the rows, which is true until Step 2 ships.

The unwrap rules are right for canonical values and, for booleans, agree with **both** of today's readers — SA checked them separately, because they differ: `SystemConfigRepository.getBoolean` returns the *fallback* for a value that is neither string nor boolean, while `SystemConfigService.getBoolean` returns `Boolean(value)`. So a stored `0` reads **off** today for `bizchat_analysis_enabled` and **on** for the leads key; the seed maps both to the code default (on). That entire class — any stored string that is not `true`/`false`, and any number, object or JSON `null` — is exactly what P-3 refuses: `isCanonicalLegacyValue` (`scripts/bos-llm-settings.ts:171-181`) rejects `"no"`, `"0"`, `0`, `false`-as-anything-but-`"false"`, untrimmed and quoted values, and every non-string. **P-3 is therefore the single thing standing between a non-canonical stored value and a feature silently switching back on — and it cannot be run today (S1-1). That is the whole condition.**

**Order of operations** (this does not replace §9; it makes the pre-deploy check and the runnable commands explicit):

| # | Step | Who | Stop rule |
|---|---|---|---|
| 0 | Fix **S1-1** and **S1-2**, re-run the gates → QA → user approval → RM merges Step 1 | Dev → SA → QA → user → RM | — |
| 0a | **Before the Step 1 deploy**, run the S1-4 duplicate-price query (read-only) | user | Rows returned → show SA and decide before deploying; it changes what some models are charged |
| 1 | Deploy Step 1 (inert: nothing imports the resolver) | RM | — |
| 2 | **P-1** `SELECT key, updated_at FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%';` | user | **Any row → STOP.** `DO NOTHING` would keep a row planted through the pre-Step-0 open routes |
| 3 | **P-2** record the six stored values (`key, value, jsonb_typeof(value), updated_at`) into §10.2 | user | — |
| 4 | **P-3** `npx tsx --import ./scripts/env-preload.ts scripts/bos-llm-settings.ts verify-stored` | user / QA | **Exit ≠ 0 → STOP** and escalate. Do not "normalise the value and carry on" without a recorded user decision |
| 5 | **P-4** apply `20261003_seed_bos_llm_area_settings.sql` in the SQL editor | user | — |
| 6 | **P-5** eight rows back, matching §10 with the P-2 values substituted; `get <area>` for all eight; paste both into §10.2 | user / QA | A row that does not match §10 → roll back (step 8) |
| 7 | **P-5b** `npx tsx --import ./scripts/env-preload.ts scripts/bos-llm-settings.ts verify-equivalence` | user / QA | **Exit ≠ 0 → roll back immediately** (step 8) and escalate |
| 8 | *(only if needed)* `DELETE FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%';` | user | Safe **only** before Step 2 deploys |
| 9 | **P-6** QA records AC-13 items 1–2; Step 2 may then merge | QA | P-5b must be green |

Note for the operator: P-5b compares **six** fields — the only ones that have a legacy reader to compare against. The other sixteen calls are covered by T1-14 and §10, and are re-proved at the provider boundary in Steps 2 and 3. That is the correct scope, not a gap.

### Optimisation suggestions (non-blocking)

- `getSnapshot` (`modelSettings.ts:692-701`) makes every caller *wait* for a slow refill instead of serving the last good snapshot while it revalidates. On the hot path of an owner action, stale-while-revalidate is strictly better and costs three lines.
- `rejectsSamplingParameters` is a prefix allow-list, so the next reasoning family (a `gpt-6*`, say) would be accepted, sent a temperature and fail with a 400 that the DEC-9 classifier deliberately does not catch. Acceptable, and already implied by §3.5 — worth one sentence in the runbook so it is a known review point whenever a family is added.
- `verify-stored` stops on a JSON `null` or a numeric value even where today's reader and the seed agree. Safe, and the right default — just make sure the runbook says "escalate", not "improvise".

---

## SA Re-check — Step 1

**Reviewed by SA — 2026-09-21** (same worktree, still uncommitted; limited to what changed since the 2026-09-20 review. Docs-only edit from SA.)
**Status:** ✅ **Approved with one must-fix** — S1-1 … S1-12 and D-Q1 … D-Q8 all land as described, and SA re-ran the gates: **39 suites / 535 tests pass**, `typecheck:bos-llm` **168 files / 30 errors / 0 new**. The single must-fix (R-1) is a gap *inside* the D-Q2 fix, not a regression.

### 1. Is leg (A) sound now?

**It is as sound as a source-reading assertion can be, and it is not a soundness proof. The residual class is named below rather than left implicit.**

What genuinely improved: the window is clamped to the anchor's own call block (so a sibling's identical literal is out of reach), anchors must occur exactly once per file, model evidence must find exactly one assignment in its block, the three stored-key calls now assert the *resolved variable* reaches the request, and the two shared builders are read directly. SA re-ran the four original mutations and the suite is green on a clean tree; all eleven mutations found so far are caught.

**Residual class — "the recorded text is still there, but it is no longer what reaches the provider".** Three spellings, two of which SA proved on this tree (each applied alone, suite run, file restored and confirmed byte-identical by `md5sum`, tree back to the 8-modified/16-untracked baseline):

| # | Spelling | Proof |
|---|---|---|
| (i) | **Rewrite upstream of an inspected slice.** `lib/ai/providerFactory.ts`: inserting `params = { ...params, model: 'gpt-4o', temperature: 0.9 };` one line *above* the `// Build chat completion params` marker changes the model and temperature of all 12 `complete()` callers | **Suite passes** (29/29). The builder check slices from that marker, so anything before it is invisible |
| (ii) | **Override downstream inside the same object.** `InsightRepository` `insight_content`: adding `...this.insightOverrides,` after the recorded `model` / `temperature` | **Suite passes** (29/29). `singleModel` counts `model:` assignments, and a spread is not one |
| (iii) | **Reachability.** The test asserts that text exists, never that the call is still made, or made once | Not probed; structural — §5.1's original "drive each site once" was the only thing that covered it |

**Ruling: stop hardening leg (A).** Each round of source-reading rules has closed the spellings found and left the class open — that is the nature of the technique, not a failure of this implementation. Leg (A) is a **drift alarm on the inventory**, and a good one; the **guarantee** belongs at the provider boundary, which is what the D-21 amendment already requires. That amendment is now strengthened in two ways, and both are binding on Steps 2 and 3:

- **T2-S / T3-S must spy at the provider boundary** (`chatCompletion` / `complete`) and assert the **whole request object** and the **number of calls made** — not a source read, and not only `{ provider, model, temperature }`. This closes (i), (ii) and (iii) at once, because it observes what is actually sent.
- **When a call site is wired, its leg-(A) entry is deleted**, not kept. A stale entry that no longer describes a live literal is false comfort, and D-21's own plan ("replaced call by call as each literal leaves its file") already says so — it must be enforced in the Step 2/3 checklists.

No further work on leg (A) in Step 1.

### 2. D-Q2 — the read timeout: **keep it exact. Do not adopt stale-while-revalidate, and do not reword AC-7.**

The Dev's reasoning is right, and the operator's promise is what settles it. The control this layer exists to give an owner-operator is: *switch an area off and the spending stops*. Under the current design the worst case is "the boundary call sees the change" — 60 s, plus up to 3 s if the database is stalled at that moment. Under SWR the first call after every boundary is **guaranteed** to use the old value, so an emergency "off" always lets one more paid call through per instance; and on a low-traffic instance the refresh is fire-and-forget with no caller to surface its failure, so the switch's latency stops being bounded at all. Trading a *certain* extra call and an *unbounded* tail for a *rare, bounded* 3 s wait is the wrong way round for a kill switch. AC-7 stays as written.

Two corrections to how the cost is recorded, neither changing the ruling:

1. **R-1 — must-fix (Medium).** The budget covers only `getByKeys` (`modelSettings.ts:688-704`). The same refill also awaits `getPricing(...)` and `getImageGenerationConfig()` inside `evaluateAreaRow`, and **those are unbounded**. They are skipped while every configured model equals its code default — which is true of the seeded rows, and therefore invisible today — but the moment an operator configures a different model (the whole point of the layer), a hung pricing read hangs the refill and, through the shared in-flight promise, every concurrent caller: exactly the defect D-Q2 fixed, one layer down. **Fix:** race the whole of `refill()` against the budget rather than the row read alone. It is strictly stronger, simpler, and lands on the same failure path.
2. **R-2 — Low (wording).** §5.9 D-Q2 says the cost is "one call per instance per minute may wait up to 3 s". It is really *every call arriving during the ≤3 s window*, because `getSnapshot` hands concurrent callers the in-flight promise — i.e. while the database is stalled, roughly 3 s of waiting in every 13 s cycle (3 s budget, then 10 s of last-good served instantly). Still bounded, still the right trade; record it accurately.

### 3. D-Q4, D-Q7 and the added checks — sufficient, and the seed go/no-go **stands: GO**

- **D-Q4 (P-5b vacuous)** — correctly recorded rather than papered over. It is worth noting *why* it is vacuous: the Dev's production run proved **none of the six legacy keys is stored**, so the seed writes pure code defaults and the SQL's unwrap branches are dead on this database. That removes the very risk RC-W1 was guarding, and it is covered where it can be: T1-13b's fixtures, and P-3 as a "nothing has appeared since" gate.
- **D-Q7 (never parsed by Postgres)** — **P-3b** (`BEGIN;` → migration → `ROLLBACK;`) is the right answer and the only possible one; it is in both §9 and the migration header.
- **P-5c** (fingerprint, apply twice, re-fingerprint) turns the re-runnability claim into evidence. Good addition.
- **R-3 — nit:** §9 orders P-5 → P-5b → P-5c, the migration header orders P-5 → P-5c → P-5b. Both are safe (`ON CONFLICT DO NOTHING`); align them so the operator is not choosing.

**Go/no-go: unchanged — GO.** The one condition SA attached on 2026-09-20 (S1-1, the unrunnable script) is closed and proven end to end against production, read-only: `verify-stored` and `verify-equivalence` both exit 0, each logging `supabaseHost` first. The order of operations in the earlier review stands, with **P-3b inserted before P-4** and **P-5c after P-5**, and with the §9 step-1b pricing-duplicates query re-run before the deploy that carries the new reader (it was measured on 2026-09-20 as no-billing-impact, and that guarantee holds only while the duplicate rows stay price-identical).

### Must-fix

1. **R-1** — extend the 3 s budget to the whole refill, not just `getByKeys` (`lib/business-os/llm/modelSettings.ts:688-704`, `:706-745`). Medium; small; re-run the D-Q2 tests.

### Recorded, not blocking

- **R-2** (the timeout's real cost, §5.9), **R-3** (P-5b/P-5c order).
- **R-4 (Low)** — S1-8 landed as `if (model === defaults.model) provider = defaults.provider;` (`modelSettings.ts:533`), which is fail-safe but also silently reverts a **provider-only** configuration, and reports nothing. Unreachable while `ALLOWED_PROVIDERS_LAYER2` is `['openai']`. **Must be revisited in the same change that allows a second provider**, ideally by reporting the revert as `adjusted` so an operator sees why their provider did not take effect.
- **R-5** — the residual leg-(A) class above is recorded here as the authoritative statement; §5.1 should point at it rather than restate it.

---

## 16. QA Testing Report

## QA Test Report — Step 0

**QA — 2026-09-20** (worktree `neuronforge-llm-layer15`, branch `feature/business-os-llm-layer2-model-settings`, **uncommitted**; tested against the code, not the Dev/SA summaries. Nothing was committed, no migration was applied, no production data was written.)
**Test mode:** full (Step 0 only)
**Strategy used:** A + B (Jest unit/integration, re-run and read adversarially), C (a throw-away probe suite for the reserved-key refusal, deleted after the run), live HTTP against `next dev` (T0.8), plus static review of the migration and of the admin page's response contract
**Focus:** api, security, schema
**Skipped:** Playwright (no browser journey in Step 0; the page regression is covered by the contract diff in QA-4 and, for the signed-in half, by the blocked items below)
**Input source:** prompt keywords + §4.5 / §4.8 / §4.9 of this workplan and AC-1 of the requirement

### QA-1. Gates (run by QA, verbatim)

| Gate | Output | Verdict |
|---|---|---|
| `npm run typecheck:bos-llm` | `typecheck-bos-llm: 156 files in scope, 30 errors, 0 new (106.6s)` then `typecheck-bos-llm: passed` (exit 0) | ✅ matches §4.6; the 30 are pre-existing |
| `npm run build` | `✓ Compiled successfully`, `✓ Generating static pages (295/295)`, `EXIT=0`. The three routes build dynamic: `ƒ /api/admin/system-config`, `ƒ /api/admin/system-config/pricing`, `ƒ /api/admin/system-config/pricing/sync`, and `ƒ /admin/system-config` | ✅ every `DYNAMIC_SERVER_USAGE` error line in the log names another route (`/api/admin/dashboard`, `/api/cron/*`, `/api/v2/*`) — **pre-existing** |
| `npx jest app/api/admin lib/admin lib/repositories` | `Test Suites: 29 passed, 29 total` / `Tests: 284 passed, 284 total` / `Time: 9.479 s` | ✅ matches §4.6 |
| Full `tsc --noEmit` | **Not re-run by QA** (≈2,038-error baseline, ~10 min). The scoped typecheck is green with 0 new, and the 4 pre-existing `reward_config` errors in `lib/audit/admin-helpers.ts:76,100,124,148` are already recorded as F-3 | ⚪ accepted as pre-existing per §4.6 |

### QA-2. Test coverage against AC-1 / §4.5

| ID | Criterion | Tested? | Result | Evidence |
|---|---|---|---|---|
| T0-1 | settings GET/PUT: 401 signed out, 403 non-admin, 403 when `isAdmin` throws, **no data access** | ✅ | **PASS** | `__tests__/route.test.ts`; `dataCalls() === 0` on all three denials, and the suite additionally mocks `@/lib/supabaseServer` to throw if touched. Combined with the static gate (T0-10) the "never reaches the database" claim is sound: the module imports no client and contains no `.from('…')`, so the repository double is the only door and it stays shut |
| T0-2 | PUT Zod 400s; `bos_llm_area_*` refused; mixed-type billing body passes through unchanged; 500 leaks nothing | ✅ | **PASS** (with D-Q1 / D-Q2) | 6 invalid-body cases, 4 case/padding variants, a mixed-body case, "logs keys never values", two no-leak 500s. See QA-3 for the two refusal gaps I found |
| T0-3 | settings `POST` deleted → 405 | ✅ | **PASS** | Module shape asserted (`Object.keys(route)` = `['GET','PUT','dynamic','runtime']`) **and** proved live: `POST /api/admin/system-config` → **405**, `DELETE` → **405** |
| T0-4 | pricing GET/PUT/POST/DELETE: 401/403 with no data access; Zod 400s incl. "neither cost field"; admin happy paths; audit carries `user.id`; a rejected audit still returns 200; no leak | ✅ | **PASS** | `pricing/__tests__/route.test.ts` (21 cases); `mockOps.length === 0` on every denial; the two 404 paths are asserted to write **no** audit entry |
| T0-5 | sync: 401/403 with no write; admin sync runs; one attributable audit entry; a 500 writes none | ✅ | **PASS** | `pricing/sync/__tests__/route.test.ts` (8 cases) |
| T0-6 / T0-10 | static: no `console.*`, no `createClient` / raw client import / `.from('…')` anywhere under `app/api/admin/system-config/**` | ✅ | **PASS** (with D-Q8) | `__tests__/dataAccess.test.ts`, recursive, asserts ≥3 files |
| T0-7 | `requireAdmin` helper once: 401 / 403 / 403-on-throw / `{ user }`; email never logged | ✅ | **PASS** (with D-Q3) | `lib/admin/__tests__/requireAdminRoute.test.ts` (5 cases) |
| T0-8 | `AiModelPricingRepository` against an injected client, incl. **never issues an upsert** and never throws | ✅ | **PASS** | `lib/repositories/__tests__/AiModelPricingRepository.test.ts` (17 cases); the newest-row-wins lookup (D-9) is asserted |
| T0-9 | zero-price: error log + `AI_PRICING_ZERO_SET` with the admin id on PUT and POST; not on a non-zero save; a rejected zero-audit still returns 200; `'0'` from PostgREST counts | ✅ | **PASS** (with D-Q9) | 5 cases in the pricing suite |
| T0.8-a | **Live, anonymous:** 401 on every gated handler | ✅ | **PASS** | Real HTTP against `next dev` on :3000 — settings `GET`/`PUT` → **401** `{"success":false,"error":"Unauthorized"}`; pricing `GET`/`PUT`/`POST`/`DELETE` → **401**; `pricing/sync POST` → **401**; `GET pricing/sync` → **405**. A bogus `Authorization: Bearer` and a garbage `sb-access-token` cookie both → **401**, not 500 |
| T0.8-b | **Live, signed-in non-admin → 403** | ❌ not run | **BLOCKED** | I have no non-admin credentials. `.env.local` carries a test **user id/email** but no password, there is no seeded e2e login, and `ADMIN_EMAILS` is unset so I cannot mint an admin either. Creating a user against the live Supabase project would be a production data write, which I will not do unprompted. The 403 path is covered by unit tests on all six handlers plus the helper suite, but it is **not** live-verified |
| T0.8-c | **Live, admin: `/admin/system-config` loads, billing save, price edit, sync** | ❌ not run | **BLOCKED** | Same reason — no admin session. What I could verify: the page compiles and is served (`GET /admin/system-config` → 200, 35,597 bytes, renders "System Config") and its request/response contract is unchanged (QA-4). **The save / edit / sync round-trip as an admin remains unverified and must be run by the user (L-0, §4.7).** |
| §4.4 | live RLS read recorded; a migration drops the anon/authenticated write policies | ✅ | **PASS (review only)** | R-1/R-2/R-3 results and the raw `pg_policies` rows are in §4.4; the migration is reviewed in QA-5. **Not applied by QA** |
| AC-1 | "no `error.message` outside development" | ✅ | **PASS** | All four 500 handlers go through `devDetails()` / the inline `NODE_ENV === 'development'` guard; two suites assert the internal text is absent from the body |

**Counts: 13 PASS, 0 FAIL, 2 BLOCKED.**

### QA-3. Adversarial review of the test suite itself

What the suites genuinely prove:

- **"A refused caller never reaches the database" holds**, and not merely because a mock went uncalled. The chain is: (1) `requireAdmin` is the first statement in all six handlers, before any `request.json()`; (2) the route modules import **no** Supabase client and contain no `.from('…')` — asserted statically by T0-10, so the repository is the only data door; (3) the repository double records every call and each denial asserts zero calls; (4) the settings suite additionally makes `supabaseServer` throw on use. Live requests with no session, a bogus bearer and a garbage cookie all stop at 401.
- **The deleted POST is genuinely unreachable** — proved at the HTTP layer (405), not only by module shape.
- **`bos_llm_area_*` cannot be smuggled through by nesting, arrays, duplicate JSON keys or `__proto__`.** I probed 17 payload shapes: an array `updates` → 400; nested `{a:{bos_llm_area_chat:…}}` writes only `a` (correct — a nested key is a value, not a settings key); duplicate JSON keys resolve last-wins, and the reserved key is refused when it is the surviving one and simply absent when it is not; `{"updates":{"__proto__":{…}}}` → 400 (the key is swallowed by Zod's record parse, leaving 0 keys, which the `≥ 1` refine rejects). No probe reached `setMultiple` with a reserved key.

Where the suite over-claims — two cases the tests do not cover (probe suite run, then deleted; it is not left in the tree):

1. **Unicode defeats the prefix test** (D-Q1). `'​bos_llm_area_chat'` (zero-width space — not whitespace, so `trim()` does not remove it), `'bоs_llm_area_chat'` (Cyrillic `о`) and `'ｂos_llm_area_chat'` (full-width `ｂ`) all return **200** and are written verbatim. S-2 closed ASCII case and ASCII padding only.
2. **A `__proto__` key is dropped silently while the route reports success** (D-Q2): `{"updates":{"__proto__":1,"ok_key":2}}` → 200 `Configuration updated successfully`, `setMultiple` receives only `["ok_key"]`.

One missing negative case worth adding regardless: **`getUser()` throwing** (D-Q3) — untested, and the behaviour is a 500 rather than the documented 401/403.

I did **not** add these as permanent tests: the worktree is under review and uncommitted, and the brief was to report code defects rather than change the Dev's tree. Each has a one-line home — the `it.each` reserved-key table in `route.test.ts` for D-Q1/D-Q2, and `requireAdminRoute.test.ts` for D-Q3.

### QA-4. Response contract vs `app/admin/system-config/page.tsx` (verify-only, N-14)

| Page call | Page expects | Route now returns | Verdict |
|---|---|---|---|
| `GET /api/admin/system-config` (`:143`) | `{ success, data: SystemSetting[] }`, then `.filter(s => s.category === 'billing')` and `parseInt/parseFloat(s.value)` | `{ success: true, data: systemConfigRepository.getAll() }`. The repository's `getAll` is **byte-identical** to the old `SystemConfigService.getAll` — same `select('*')`, same `.order('category').order('key')` | ✅ unchanged |
| `PUT /api/admin/system-config` (`:410`, `{ updates: { payment_grace_period_days } }`) | `{ success, message }` | `{ success: true, message: 'Configuration updated successfully' }` — identical string | ✅ unchanged |
| `GET …/pricing` (`:193`) | `{ success, data: [...] }` | same, same ordering (`provider`, then `model_name`), retired rows still included | ✅ unchanged |
| `PUT …/pricing` (`:291`) | `{ success, data, message }` | identical, including `message: 'Pricing updated successfully'` | ✅ unchanged |
| `POST …/pricing/sync` (`:334`) | `{ success, message }`, then `fetchData(true)` | identical; `data: { updated, created, failed, total }` unchanged too | ✅ unchanged |
| Error paths | the page only reads `response.ok`, then `result.error` | 500 bodies keep `{ success: false, error }` but the message is now generic instead of the raw DB text; new **404** on a missing pricing row (PUT/DELETE) and **400** on a non-uuid id — neither is reachable from the page, which only PUTs ids it just listed | ✅ no page change needed |
| Category preservation | the page re-filters by `category` on every load | `systemConfigRepository.set` updates **only** `value` + `updated_at` on an existing key, so `category` survives a save | ✅ no silent re-categorisation |

One behavioural note, not a contract break: the page has **no** handling for 401/403, so a non-admin who opens `/admin/system-config` now sees "Failed to fetch system settings: 403 …" rather than a sign-in prompt. The page is a client component under a client-only layout with no server guard, so it still renders for anonymous callers; only the data is now protected. Pre-existing, adjacent to F-2, not a Step 0 regression.

### QA-5. Migration review — `20260920a_lock_system_settings_and_pricing_rls.sql` (read, **not applied**)

**Re-runnable: yes.** `CREATE OR REPLACE FUNCTION`; `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (no-op when already on); every policy is `DROP POLICY IF EXISTS` + `CREATE POLICY`; `REVOKE` and `COMMENT` are idempotent. The whole change is one `BEGIN … COMMIT`.

**Claims I could check from the code, and they hold:** every `ai_model_pricing` reader is service-role (`lib/ai/pricing.ts:121-128`, `agent-generation-config/route.ts:39`, two scripts, the admin route via the repository) — no browser reader exists, so enabling RLS cannot blank a user-facing screen. Every `system_settings_config` **writer** is service-role (`ui-config`, `memory-config`, `orchestration-config`, `onboarding-config`, `agent-generation-config` each build their own service-role client; `settings/admin-users` uses `supabaseServer`), and the three anon-client consumers (`theme-provider.tsx` — a `'use client'` file — `OrchestrationService`, `MemoryCompressor`) are `select(...)` only. The REVOKEs therefore break nothing I can find.

**Rollback:** it reverses the change in the right order (drop the three new policies, disable RLS on `ai_model_pricing`, re-grant, recreate the two old policies, drop the function) and correctly does **not** recreate the two SELECT policies it never dropped — but see **D-Q4**.

**PRE-APPLY CHECK executable by the user?** Yes in substance — "re-run R-2 from §4.4 and confirm a SELECT policy survives that is neither of the two being dropped" — but it is the only step in the file with no SQL beside it (**D-Q6**). Further operator-facing flags: **D-Q5** (filename sort order) and **D-Q7** (`au.email` case assumption).

### QA-6. Audit entries — serialisation and blocking

| Check | Result |
|---|---|
| `AI_PRICING_ZERO_SET` registered | ✅ `lib/audit/events.ts:170` + metadata at `:753` (`severity: 'critical'`, `SOC2`) |
| `ai_pricing` entity type registered | ✅ `lib/audit/types.ts:70` (D-10) — removes the four would-be `tsc` errors |
| Payloads serialise | ✅ all four helpers pass plain JSON (numbers, strings, the row objects). **`sanitizeChanges` does not eat the costs**: it inspects only the *top-level* keys of `changes`, which are `before`/`after`, so `input_cost_per_token` — a field name containing the sensitive word `token` — is preserved. (A future caller passing `{ input_cost_per_token: { from, to } }` at the top level **would** get `***REDACTED***`; worth knowing for Step 1.) |
| Non-blocking | ✅ in practice. `auditLog` → `AuditTrailService.log()` queues into a batch and swallows its own errors (`handleError`), so it effectively never rejects; every call site additionally has `.catch(err => requestLogger.error(…))`. D-2's deliberate `await` keeps the write alive across a serverless invocation without letting it 500 a completed write — asserted by "still returns 200 when the audit call rejects" in both pricing suites |
| Attribution | ✅ all four now carry `gate.user.id` (was `null`); the sync entry is emitted **only** when the sync actually ran, and the two 404 paths write nothing |
| Minor | `logAIPricingUpdated`'s `details.fields_updated = Object.keys(changes.after)` lists **every** column of the updated row, not the fields the admin changed. Pre-existing shape, carried over unchanged; the route's own Pino line does log the true `fields` |

### QA-7. Defects

No High-severity defect. Nothing here blocks the code; the Medium is in the migration's rollback block, which is applied by hand.

**Medium**

1. **D-Q4 — the migration's ROLLBACK can grant more than existed.** File: `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql`, ROLLBACK block. It re-grants `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on **`system_settings_config`** to `anon, authenticated` and states it "restores the privileges the 2026-09-20 read actually recorded" — but §4.4 R-3 recorded grants for **`ai_model_pricing` only**, as the file's own PRE-APPLY CHECK admits ("paste the R-3 grant rows for BOTH tables"). Expected: a rollback returns the table to exactly its prior state. Actual: if `system_settings_config` held fewer client write grants than `ai_model_pricing` did, rolling back leaves it **more open than it started** — on the table that will hold the `bos_llm_area_*` rows. Fix shape: comment that GRANT out and replace it with "paste the grants recorded at PRE-APPLY here", or make the rollback conditional on that read.

**Low**

2. **D-Q1 — the `bos_llm_area_*` refusal is defeated by invisible or look-alike Unicode.** File: `app/api/admin/system-config/route.ts` (`isReservedKey` / `isPaddedKey`). Reproduce: `PUT {"updates":{"​bos_llm_area_chat":{…}}}` → **200**, key written verbatim; same for a Cyrillic `о` and a full-width `ｂ`. Expected 400, as for `BOS_LLM_AREA_chat` and `' bos_llm_area_chat'`. Impact is confined — Step 1's resolver reads the eight exact keys so the row is inert, and the caller must already be an admin — but it produces a row that reads to an operator like a real area row that never passed `validateAreaRow`, which is exactly what S-2 set out to prevent. Fix shape: `normalize('NFKC')` plus stripping default-ignorable/format characters before the prefix test, or simply require `/^[A-Za-z0-9_]+$/`.
3. **D-Q2 — a `__proto__` key is dropped silently and reported as saved.** Same file. `PUT {"updates":{"__proto__":1,"ok_key":2}}` → **200 "Configuration updated successfully"** while `setMultiple` receives only `ok_key`. No prototype pollution is reachable (Zod's assignment lands on the parsed object's own prototype, and `setMultiple` iterates own entries), so this is a truthfulness bug, not a security one. Fix shape: refuse `__proto__` / `constructor` / `prototype` explicitly, or compare the written key set with the requested one.
4. **D-Q3 — `requireAdmin` does not guard `getUser()`.** File: `lib/admin/requireAdminRoute.ts:60`. If the auth call throws (Supabase outage, malformed cookie jar) the exception escapes to the handler's outer `catch` and the caller gets **500**, not 401/403. Still fail-closed — no data access happens — but it contradicts the helper's own documented contract ("401 signed out → 403 not an admin. Nothing else") and is untested. Fix shape: wrap `getUser()` in the same try/catch, return 401, add one test.
5. **D-Q5 — the migration filename sorts before ten already-applied migrations.** `20260920a_…` sits behind `20260922_…` … `20260930_…` and carries a non-numeric suffix. Harmless under the documented manual SQL-editor apply, but it breaks chronological reading and would be an out-of-order file for any CLI-driven apply. Fix shape: rename to a stamp after the newest applied migration (the seed already plans `20261002_…`).
6. **D-Q6 — the PRE-APPLY CHECK is the only step in the migration with no runnable SQL.** It tells the operator to "re-run the R-2 policy query from workplan §4.4", while the VERIFICATION block below inlines its queries. An operator working from the file alone cannot run the check. Fix shape: paste the six-line `pg_policies` query into the header.
7. **D-Q7 — `is_platform_admin()` assumes `admin_users.email` is stored lower-cased.** It compares `au.email = lower(nullif(auth.jwt() ->> 'email',''))`, while `AdminAccessService` lower-cases **both** sides in JS. A mixed-case stored row would not match the policy. Second-line defence only (all writes are service-role), hence Low. Fix shape: `lower(au.email) = lower(…)`.
8. **D-Q8 — the static data-access gate is string-matched and slightly brittle.** `expect(source).not.toContain('createClient')` also fails on the word inside a comment (false positive), while a relative import (`../../../../lib/supabaseServer`) or a `.from(TABLE)` constant would slip past (false negative). It does its job for the current code; worth tightening when next touched.

**Edge cases / informational**

9. **D-Q9 — the zero-price alert fires on rows the admin did not zero.** `reportZeroPrice` inspects the **post-update row**, so editing only the input cost of a model whose output cost is already `0` raises a critical `AI_PRICING_ZERO_SET` and an error log. Wider than the embedding false-positive already accepted as D-14; both should be narrowed by the same Step 1 rule.
10. **D-Q10 — `npm run dev` cannot start on Windows.** The script pipes through `grep`, which npm hands to `cmd.exe`: `'agent_execution.*select' is not recognized as an internal or external command`. Pre-existing and unrelated to Step 0 — the live checks were run with `npx next dev -p 3000`, the same server without the log filter.

### QA-8. Test outputs (verbatim extracts)

```
typecheck-bos-llm: 156 files in scope, 30 errors, 0 new (106.6s)
typecheck-bos-llm: passed

Test Suites: 29 passed, 29 total
Tests:       284 passed, 284 total
Time:        9.479 s

 ✓ Compiled successfully
 ✓ Generating static pages (295/295)
ƒ /api/admin/system-config                            0 B                0 B
ƒ /api/admin/system-config/pricing                    0 B                0 B
ƒ /api/admin/system-config/pricing/sync               0 B                0 B
EXIT=0
```

Live, anonymous, against `next dev` on :3000:

```
GET      /api/admin/system-config              -> 401 {"success":false,"error":"Unauthorized"}
PUT      /api/admin/system-config              -> 401 {"success":false,"error":"Unauthorized"}
POST     /api/admin/system-config              -> 405
DELETE   /api/admin/system-config              -> 405
GET      /api/admin/system-config/pricing      -> 401 {"success":false,"error":"Unauthorized"}
PUT      /api/admin/system-config/pricing      -> 401 {"success":false,"error":"Unauthorized"}
POST     /api/admin/system-config/pricing      -> 401 {"success":false,"error":"Unauthorized"}
DELETE   /api/admin/system-config/pricing?id=. -> 401 {"success":false,"error":"Unauthorized"}
POST     /api/admin/system-config/pricing/sync -> 401 {"success":false,"error":"Unauthorized"}
GET      /api/admin/system-config/pricing/sync -> 405
bogus-bearer PUT -> 401      bogus-cookie GET -> 401
GET /admin/system-config -> 200 (35,597 bytes, renders "System Config")
```

Reserved-key probe (temporary suite, deleted after the run) — status / whether `setMultiple` was called / keys written:

```
__proto__ wrapper            status=400 wrote=false
__proto__ direct             status=200 wrote=true  keys=["ok_key"]                  <- D-Q2
ZWSP prefix                  status=200 wrote=true  keys=["<ZWSP>bos_llm_area_chat"] <- D-Q1
NBSP prefix                  status=400 wrote=false
cyrillic o lookalike         status=200 wrote=true  keys=["bоs_llm_area_chat"]       <- D-Q1
fullwidth                    status=200 wrote=true  keys=["ｂos_llm_area_chat"]       <- D-Q1
dup json keys reserved last  status=400 wrote=false
dup json keys reserved first status=200 wrote=true  keys=["a"]
dup inner keys               status=400 wrote=false
array of pairs               status=400 wrote=false
nested reserved in value     status=200 wrote=true  keys=["a"]
101-char key                 status=400 wrote=false
newline padded / tab inside   status=400 wrote=false
```

### QA-9. Final status

- [x] **Code: SHIP** — all three gates pass, 13 of 15 checks pass, none fail, no High-severity defect. The gate is fail-closed and live-proved for anonymous callers, the deleted POST really is a 405, the repository switch is clean, and the admin page's contract is unchanged on every path it uses.
- [ ] **Two conditions before Step 0 is called done:**
  1. **The user must run T0.8-b and T0.8-c** (L-0, §4.7): signed in as a **non-admin** → 403 on the settings and pricing routes; signed in as an **admin** → `/admin/system-config` loads, the billing save works, a price edit works, and sync works. I could not sign in (no credentials, and minting a user would write to the live project), so the regression that matters most — the admin screen over rewritten routes — is **unverified by QA**. This is the one item that could still surface a High.
  2. **Fix D-Q4 before the migration is handed to an operator.** The file is otherwise re-runnable, reversible and well-commented; D-Q5 to D-Q7 are polish that costs minutes while it is open.
- [ ] D-Q1, D-Q2 and D-Q3 are Dev's call: each is a few lines plus a test, and D-Q1 reopens something S-2 was meant to close.

---

## QA Test Report — Step 1

**QA — 2026-09-20** (worktree `neuronforge-llm-layer2-step1`, branch `feature/business-os-llm-layer2-step1`, **uncommitted**. QA changed nothing but this document; every mutation below was reverted and the tree proved clean.)
**Test mode:** full · **Strategy:** A + B + C (Jest unit/integration, plus the change script run for real, read-only, against production) · **Focus:** the zero-behaviour-change proof, the resolver contract, the guardrails, the seed, pricing · **Skipped:** E2E (not set up in this repo, per CLAUDE.md § Testing) · **Input source:** prompt keywords + §5.3 / §5.4 / §9 / §10.2

**Verdict: 🔄 CONDITIONAL SHIP.** The machinery is sound — 57 new adversarial probes plus the 533-test gate found **no defect in the resolver, the guardrails, the locks, the cache, the fallback helper or the pricing fix**. The one High is again in the **proof**, not the machinery: T1-14's evidence leg (A) still has **seven** demonstrated false negatives, including the three stored-key calls and the two shared request builders that 20 of the 22 calls pass through. S1-2 narrowed the window; it did not close the class.

**Counts: 34 PASS · 1 FAIL · 2 BLOCKED. Defects: 1 High, 1 Medium, 6 Low.**

---

### QA-1. Gates (run by QA, verbatim)

| Gate | Result |
|---|---|
| `npm run typecheck:bos-llm` | `168 files in scope, 30 errors, 0 new (228.3s)` — **passed**. Matches §5.4 and SA's 168. Baseline file untouched |
| `npm run build` | `✓ Compiled successfully`, full route table, **exit 0**. The `DYNAMIC_SERVER_USAGE` and `ConnectJS` lines during page-data collection are **pre-existing** and unrelated to this step (they name `/api/admin/dashboard`, the crons, `/api/plugins/available`, the v2 analytics routes) |
| `npx jest lib/business-os/llm lib/ai lib/repositories scripts/__tests__ app/api/admin/system-config` | **39 suites / 533 tests / 1 snapshot — all passed**, 15.6 s. **No pre-existing failure in scope.** Re-run after all mutations: 533/533 again |

---

### QA-2. Attacking the zero-behaviour-change proof (the main event)

Twenty mutations, each applied to one line of real production code, run against `callParams.snapshot.test.ts`, then reverted from a byte-for-byte backup. **Caught = the suite went red.**

| # | Call / target | Mutation | Caught? |
|---|---|---|---|
| **M1** | `chat/planner` — `Planner.ts:447` | `model,` → `model: 'gpt-4o',` (the value actually sent, not the config fallback) | ❌ **NO** |
| **M2** | `chat/analysis` — `AnalysisService.ts:127` | `model,` → `model: 'gpt-4o',` | ❌ **NO** |
| **M3** | `leads/reply_recommendation` — `LeadReplyRecommender.ts:103` | `model,` → `model: 'gpt-4o',` | ❌ **NO** |
| **M4** | **wrapper** — `providerFactory.ts:336` (`complete()`) | `model: params.model,` → `model: 'gpt-4o',` — changes the model on **12 of the 22 calls** (website ×6, intake ×2, onboarding ×4) | ❌ NO by T1-14; ✅ **caught by the full gate** (1 suite in `lib/ai`) |
| **M5b** | **wrapper** — `providerFactory.ts:344` | always send a temperature, defaulting to `0.9` — gives the four onboarding extractors a temperature they have never sent | ❌ **NO** (T1-14 *and* full gate) |
| **M20** | **wrapper** — `openaiProvider.ts:191` (`chatCompletion`) | `{ ...params, model: 'gpt-4o', stream: false }` — changes the model on the **8 `chatCompletion` calls** (insights ×3, briefing, landing_page, leads, planner, analysis) | ❌ **NO** (T1-14 *and* full gate) |
| **M17** | `insights/insight_content` — `InsightRepository.ts` | insert a **duplicate `model:` key** after the recorded one (JS last-wins → `gpt-4o` is sent) | ❌ **NO** |
| **M18** | `insights/insight_content` | add a **second call site** for the same `callName` with a different model and temperature (leg A anchors on `findIndex` = the first match only) | ❌ **NO** |
| M6 | `intake/form_generation` — `IntakeGenerationService.ts:57` | `const MODEL = 'gpt-4o'` → `'gpt-4o-mini'` | ✅ yes |
| M7 | `intake/form_generation` — `:258` | `model: MODEL,` → `model: 'gpt-4o-mini',` | ✅ yes |
| M8 | `briefing/daily_narration` — `BriefingNarrator.ts:114` | `OPENAI_MODELS.GPT_4O_MINI` → `OPENAI_MODELS.GPT_4O` | ✅ yes |
| M19 | `briefing` (constant) — `openaiProvider.ts:39` | `GPT_4O_MINI: 'gpt-4o-mini'` → `'gpt-4o'` | ✅ yes |
| M9 | `images/image_generation` — `GeneratedImageService.ts:356` | `model: config.model,` → `model: 'dall-e-3',` | ✅ yes |
| M10 | `website/full_site` — `WebsiteGenerationService.ts:560` | `'gpt-4o'` → `'gpt-4o-mini'` | ✅ yes |
| M11 | `website/landing_page` — `generate/route.ts:127` | `temperature: 0.7` → `0.5` | ✅ yes |
| M12 | `website/faq_content` — `WebsiteAIContentService.ts:588` | `'gpt-4o-mini'` → `'gpt-4o'` | ✅ yes |
| M13 | `website/features_content` — `:652` | `temperature: 0.7` → `0.3` | ✅ yes |
| M14 | `insights/health_summary` — `InsightRepository.ts:2131` | `temperature: 0.5` → `0.9` | ✅ yes |
| M15 | `onboarding/business_story_extraction` — `:1066` | `'gpt-4o'` → `'gpt-4o-mini'` | ✅ yes |
| M16 | `onboarding/adjustment_intent_extraction` | insert `temperature: 0.5,` into the request object | ✅ yes (the `absent` window covers the object) |

**M1 and M3 survive far more than T1-14.** Re-run against `lib/business-os lib/ai lib/services` — **113 suites / 1,956 tests — all green** with the planner sending `gpt-4o` on every turn, and again with the lead recommender doing the same. Nothing in this repository would notice.

**Every mutation reverted.** `git status --porcelain` after the run is byte-identical to the pre-run baseline (the same 8 modified + 16 untracked entries); the Step 1 additions to `openaiProvider.ts` (`rejectsSamplingParameters`, `usesMaxCompletionTokens`) are intact; `providerFactory.ts` shows `0` lines of diff; the gate re-runs at **533/533**. → **Defect D-Q1 (High).**

---

### QA-3. The change script, exercised for real (read-only only; `set` never run)

Run from a clean shell in the worktree, against **production** (`jgccgkyhpwirgknnceoh.supabase.co`, logged by the script itself before each command — S1-11 works).

| Command | Exit | Result |
|---|---|---|
| `npm run bos:llm-settings` (no args) | **2** | usage + every area and call listed |
| `... -- frobnicate` | **2** | usage, `command: "frobnicate"` echoed |
| `... -- get` (no area) | **2** | `Unknown area` + the eight names |
| `... -- get nosucharea` | **2** | `Unknown area`, `area: "nosucharea"` |
| `... -- get <area>` × **all eight** | **0** each | `rowPresent: false` on all eight, `issues: []`, `areaEnabled: true` |
| `... -- verify-stored` | **0** | `getByKeys keyCount: 6, count: 0`; six × "Not stored; the seed will use the code default" |
| `... -- verify-equivalence` | **0** | six × "Legacy reader and resolver agree", `checked: 6` |

**The 22 resolved calls reproduce §10's "after" column exactly**, live, with no configuration at all: chat `gpt-4o-mini`/0 ×2 · insights `gpt-4o-mini` 0.3/0.4/0.5 · briefing `gpt-4o-mini`/0.3 · website `gpt-4o` 0.7 (full_site, landing_page), `gpt-4o-mini` 0.7 (field_regenerate, hero, about, faq, features), `gpt-4o-mini` 0.5 (testimonial_enhance) · intake `gpt-4o`/0.3 and `gpt-4o-mini`/0.2 · leads `gpt-4o-mini`/0.2 · onboarding ×4 `gpt-4o`/**not set** · images `gpt-image-1`/**not set**. **Dev's two production claims are independently confirmed: no `bos_llm_area_*` row exists, and none of the six legacy keys is stored.** That is P-1 and P-2 observed (the user still runs them formally).

Bad input on the **`set`** path could not be exercised live (instruction: do not run `set`). Verified instead from `scripts/bos-llm-settings.ts:250-360` + `scripts/__tests__/bos-llm-settings.test.ts`, both green in the gate: an unpriced model or `temperature: 1.5` → exit 1, nothing written; a locked field (onboarding `enabled`, `calls.planner.enabled`/`.temperature`, images `temperature`) → exit 1 via `validateAreaRow`'s non-`adjusted` filter; an unknown call name or top-level key → exit 1 (D-22); a malformed/unparseable `--file` → exit 2; `--enabled` with anything but `true`/`false` → exit 2; `--file` **and** `--enabled` together → exit 2; `--enabled false` with a live `calls.*.enabled: true` → exit 1 listing them, and `--include-calls` writes both false; `--enabled false` on `website` warns **PARTIAL SWITCH** naming the three non-switchable calls (S1-7). **All exit codes are right, and nothing is written on any failure path.**

---

### QA-4. The seed migration (read, **not applied**)

| Check | Result |
|---|---|
| Never overwrites | ✅ one `ON CONFLICT (key) DO NOTHING`, no `DO UPDATE`, no `DELETE` **statement** (the rollback lives in the header as an instruction) |
| Re-runnable | ✅ `DO NOTHING` + the `AND COALESCE(description, '') NOT LIKE '%superseded%'` guard on the marker UPDATE. `ON CONFLICT (key)` has precedent in two merged migrations (`20260212_agent_generation_config.sql`, `20260629_seed_memory_config_defaults.sql`), so the unique index on `key` exists |
| Rollback safe | ✅ `DELETE … WHERE key LIKE 'bos\_llm\_area\_%'` removes only what this file adds, and is safe while no deployed code reads the rows (true until Step 2). ⚠️ the marker rollback leaves `''` where the description was `NULL` — **D-Q8** |
| P-1/P-2/P-3/P-5/P-5b executable in §9's order | ✅ every command in the header and in §9 is the working `npm run bos:llm-settings -- …` form, and QA ran P-1 (via `get` ×8), P-2 (via `verify-stored`'s read), P-3 and P-5b's command shape live |
| Values match §10 and the fixture | ✅ T1-9 now **parses** the migration's `jsonb_build_object` trees and the CTE's `COALESCE` defaults and compares them value-for-value with `SEEDED_ROWS` (read line by line — S1-3 is genuinely closed, not a substring test any more) |
| §10 "after" reproduced | ✅ T1-9 resolves all 22 seeded calls to `bosLlmCodeDefaults`, and QA's live `get` ×8 gives the same 22 values |

**P-3 refuses every spelling that reads as *off* today — confirmed by reading both readers, not by assumption.** `SystemConfigService.getBoolean` (chat) is `typeof value === 'string' ? value.toLowerCase() === 'true' : Boolean(value)`; `SystemConfigRepository.getBoolean` (leads) is `boolean → itself; string → === 'true'; anything else → fallback`. Against `isCanonicalLegacyValue` (`scripts/bos-llm-settings.ts:205-216`):

| Stored | Reads today | Canonical? | Seed would write | Verdict |
|---|---|---|---|---|
| `"no"` | chat **off**, leads **off** | ❌ refused | (blocked) | ✅ safe |
| `"0"` | chat **off**, leads **off** | ❌ refused | (blocked) | ✅ safe |
| `0` (number) | chat **off**, leads **on** (fallback) | ❌ refused (`typeof !== 'string'`) | (blocked) | ✅ safe |
| JSON `null` | chat off / leads fallback | ❌ refused | (blocked) | ✅ safe |
| object / array | — | ❌ refused | (blocked) | ✅ safe |
| `false` (JSON boolean) | **off** | ✅ canonical | `false` | ✅ identical |
| `"false"` / `"FALSE"` | **off** (both readers lower-case and compare to `'true'`) | ✅ canonical | `false` | ✅ identical |
| `" gpt-4o "`, `"\"gpt-4o\""` | leads sends it **verbatim** (`String(value)`, no trim/unquote); images trims+unquotes | ❌ refused | (blocked) | ✅ safe (the two readers disagree, so refusing is right) |

**No value was found that reads *off* today and would be seeded *on*.** (Note for the record: SA's summary that `SystemConfigService.getBoolean` "returns `Boolean(value)`" is imprecise — it special-cases strings — but the conclusion is unchanged, and it happens to make the string cases *safer*, not less safe.)

**What the "nothing is stored" fact means for P-5b — read this before treating P-5b as a parity proof.** With all six keys absent (QA measured `count: 0` live), the seed's `legacy` CTE returns **zero rows**, every `COALESCE` falls to its default, and the eight rows are written entirely from the literals in the SQL. So **none of the unwrap logic runs** — not `jsonb_typeof(value) = 'string'`, not the `btrim(btrim(…), '"')` double-unwrap, not `IN ('true','false')`. Consequently:

- **Before the apply**, `verify-equivalence` compares a hardcoded legacy fallback with a hardcoded code default — it passes tautologically (QA saw exactly that: exit 0, `checked: 6`, with no row present).
- **After the apply** it gains exactly one real assertion: *the literal written by the migration equals the fallback the still-deployed legacy reader returns*. That is worth having — it would catch a typo in the SQL — but it is **not** a test of the unwrap rules, and it does not exercise the class of bug RC-W1 was written for.
- So the honest record for §10.2 is: **P-5b passes vacuously with respect to RC-W1 on this database.** → **D-Q4 (Low, documentation/claim accuracy).**

**Not verified by anyone, including QA: the SQL has never been parsed by PostgreSQL.** T1-9 is a text/AST-of-text test and cannot be otherwise. The one construct worth a live parse is `FROM stored, LATERAL (VALUES (…, jsonb_build_object(…, stored.planner_model), …)) AS row_values(key, value, description)` — referencing an outer column inside a `VALUES` list in a `LATERAL`. It is legal PostgreSQL, but P-4 would be its first execution. → **D-Q7 (Low)**, with a mitigation in the post-apply checks below.

---

### QA-5. The resolver contract (57 adversarial probes, all green)

A temporary probe suite (`zz-qa-adversarial.tmp.test.ts`, **deleted after the run**) drove the resolver with the repository and pricing mocked.

**Never throws — 26 malformed row shapes + 6 failure modes, every one falls back to today's value:** row = `"x"` / `[1,2]` / `42` / `null` / `true`; `calls` = a string / an array / `42` / `null`; `model` = a number / `""` / `"  gpt-4o  "` / 300 chars / an object; `provider` = `5` / `"anthropic"`; `temperature` = `"0.5"` / `NaN` / `Infinity` / `1.5` / `-0.1`; `enabled` = `"true"` / `1`; an all-nonsense row; a **JSON-string row** (parsed correctly — `{"temperature":0.4}` resolves to 0.4) and a JSON-string row with a bad inner value (falls back to 0.3). Plus: repository `{ error }`; repository **throws**; `data: undefined`; `data` not an array; `getPricing` **throws**; `getImageGenerationConfig` **throws**; `isBosLlmAreaEnabled` on a DB error → `true`; `validateAreaRow(Symbol())` → resolves. **Every case returns today's `{ openai, gpt-4o-mini, 0.3 }` and logs.** ✅

**Cache and burst — no hammering vector found**, confirming SA:
- 100 concurrent callers on a cold cache → **exactly 1** `getByKeys`. `getSnapshot` assigns `inFlight` synchronously before any await, so the herd really is shared.
- After a failed read, **50 sequential** calls issue **0** further reads until the 10 s window elapses.
- T1-10's fake-clock 59 s / 60 s / 10 s cases pass in the gate.

**Timeout — the one real machinery finding.** With `getByKeys` returning a promise that never settles, `resolveBosLlmSettings` **never settles either** (probe result `HUNG` after 1.2 s of real time). There is no `Promise.race` timeout anywhere in `getSnapshot`/`refill`; `onReadFailure` is only reached when the read *settles*. On a cold start there is not even a last-good snapshot to serve. "Never throws" holds; "a configuration fault can never fail an owner action" (`modelSettings.ts:12-14`) does **not** — it can stall one for as long as the Supabase client takes to give up. Inert in Step 1; a hot-path dependency for every Business OS action from Step 2. → **D-Q2 (Medium).**

**Wrong-but-plausible resolutions — one found:** a *priced* image model is accepted on a **token** call (`insights` resolved to `model: 'gpt-image-1'`). `gpt-image-1` is absent from `FALLBACK_PRICING`, so it is refused today; but `ai_model_pricing` is operator-editable and adding an image-cost row is a plausible thing to do, after which the guardrail would accept it and every insights call would 400 — with a code the DEC-9 classifier deliberately does not catch, so `withModelFallback` would not rescue it for the whole 60 s window. → **D-Q5 (Low).** *(Also noted, not a defect: if `getByKeys` ever returned two rows for one key, the last wins — unreachable, `key` is unique.)*

---

### QA-6. Guardrails and locks (each must fall back to today, not fail)

| Case | Result |
|---|---|
| Zero-priced model (`0/0`) | ✅ rejected → `gpt-4o-mini` 0.3 |
| Input priced, **output** 0 | ✅ rejected (the Layer-2-local `input > 0 && output > 0` rule, not `hasPricing`) |
| Unpriced model (`getPricing` → `null`) | ✅ rejected |
| `getPricing` throws | ✅ treated as unpriced, warn, default used |
| Image model missing one size × quality | ✅ rejected → `gpt-image-1` |
| Image model fully priced at every size × {low, medium, high} | ✅ accepted (`dall-e-3`) |
| Provider `anthropic` / a number | ✅ rejected → `openai`, and the sibling fields in the same row still apply |
| Temperature `1.5` / `-0.1` / `"0.5"` / `NaN` / `Infinity` | ✅ all rejected → 0.3 |
| Reasoning model on `insights` (`gpt-5`) | ✅ model kept, **temperature not sent** (RC-11) |
| Reasoning model on `planner` (locked temp) | ✅ **model rejected** → `gpt-4o-mini`, temp 0 |
| Reasoning model on `analysis` (`o3`, sampling penalty) | ✅ **model rejected** → `gpt-4o-mini` |
| `o1` on a plain token call (`max_tokens` rule, RC-W5) | ✅ **model rejected** |
| **LOCK** onboarding `enabled: false` | ✅ ignored; call `enabled: true`, `isBosLlmAreaEnabled('onboarding')` → `true` |
| **LOCK** `calls.planner.enabled: false` + `temperature: 0.5` | ✅ both ignored → `enabled: true`, `temperature: 0` |
| **LOCK** images `temperature: 0.5` | ✅ ignored → not sent |
| Area `enabled: false` (chat) | ✅ `analysis` off, `planner` stays `true` (D-27), `isBosLlmAreaEnabled('chat')` → `false` |
| Area `enabled: false` (website) | ✅ `landing_page` off; `full_site` stays `true` — the S1-7 partial switch, correctly truthful |

**Sixteen for sixteen fall back to today's behaviour. No guardrail fails a call.**

---

### QA-7. The pricing changes

| Check | Result |
|---|---|
| Oldest-price-wins bug was real | ✅ confirmed in `HEAD`: `pricingCache.set(key, …)` inside a `forEach` over newest-first rows — the **last** (oldest) write won |
| Fixed | ✅ `loadPricingFromDatabase` now keeps the **first** row per `provider:model` and counts the rest as `superseded` |
| Ordering deterministic | ✅ `listActive()` = `.is('retired_date', null).lte('effective_date', <today UTC>).order('effective_date', desc).order('created_at', desc)` — S1-5 landed, both the date filter and the tie-break, documented in the method and tested |
| No reader moved off the service role | ✅ the **opposite**: `lib/ai/pricing.ts` dropped its own `createClient(URL, SERVICE_ROLE_KEY)` and now reads through `aiModelPricingRepository`, whose default client is `supabaseServer` (service role). Still RLS-exempt by design, so the admin-SELECT-only policy from Step 0 is satisfied. No `createClient` remains in the file |
| `hasPricing` / `calculateCost` / `calculateCostSync` untouched | ✅ `hasPricing` is still `getPricingInternal(...) !== null` — no `> 0` rule leaked in |
| D-14 narrowing | ✅ `isInputOnlyPricedModel` is OpenAI + `text-embedding-*` only; the three route tests pass |
| **Unadvertised improvement worth recording** | the old loader did `pricingCache.clear()` **before** repopulating, so a concurrent read during a refresh saw an empty cache (and `getPricingInternal` re-triggers a load when `size === 0`). The new one builds into a fresh `Map` and swaps. Strictly better under load |

---

### QA-8. Defects

#### High

1. **D-Q1 — T1-14 leg (A) still has seven demonstrated false negatives; the stored-key calls and the shared request builders are unguarded.** — Files: `lib/business-os/llm/__tests__/callParams.snapshot.test.ts:120-200, 259-300`.
   - **Reproduce:** the seven ❌ rows in QA-2 (M1, M2, M3, M5b, M17, M18, M20). Each is a one-line change to production code; each is a genuine change to what the provider receives; each leaves `Tests: 27 passed` and, for M5b/M17/M18/M20, the whole 533-test gate green. M1 and M3 additionally survive **1,956 tests** across `lib/business-os lib/ai lib/services`.
   - **Expected:** AC-2's "before" record fails when a call's `{ provider, model, temperature }` changes.
   - **Actual:** three distinct blind spots. **(a) The three stored-key calls** (`chat/planner`, `chat/analysis`, `leads/reply_recommendation`) anchor on the *config read's fallback literal* (`getString(MODEL_KEY, 'gpt-4o-mini')`, `'bizchat_planner_model'` ± 4 lines) and never assert that the resolved variable is what reaches the request — `Planner.ts:447`, `AnalysisService.ts:127` and `LeadReplyRecommender.ts:103` are all `model,` and are checked by nothing. **(b) The shared request builders** — `providerFactory.complete()` (12 calls) and `openaiProvider.chatCompletion()` (8 calls) — are outside every evidence window by construction, because leg (A) only reads the call site's own file. **(c) Two text-level escapes** at a call site that *is* covered: a duplicate `model:` key later in the same object literal (last-wins) and a second call site for the same `callName` (`findIndex` takes the first anchor only).
   - **Note on severity:** this is a defect in the **proof**, not in the machinery — Step 1 is inert, and SA's amended D-21 ruling already obliges T2-S/T3-S to capture the whole request at the provider boundary. But SA graded the same class (four false negatives, one file) **High**, and this set is strictly larger and includes the wrapper class, which no later step's per-call assertion automatically covers either unless it asserts the *number* of calls and the *whole* object. Cheap to close: three "the resolved variable is what is passed" assertions, one assertion that each wrapper forwards `params.model` unchanged and does not synthesise a temperature, a `lastIndexOf`-vs-`indexOf` duplicate-anchor check, and a "no second `model:` in the block" check.

#### Medium

2. **D-Q2 — the resolver has no read timeout: a hung database read blocks every caller indefinitely, with no last-good to serve on a cold start.** — File: `lib/business-os/llm/modelSettings.ts:707-716` (`getSnapshot`) and `:659-698` (`refill`). Severity: Medium (inert in Step 1; hot path from Step 2).
   - **Reproduce:** make `systemConfigRepository.getByKeys` return a promise that never settles; call `resolveBosLlmSettings('insights','insight_content')`. QA's probe returned `HUNG` — the call had not settled after 1.2 s and never would.
   - **Expected:** the documented contract, `modelSettings.ts:12-14` — "a database outage … degrades to the code default … A configuration fault can never fail an owner action."
   - **Actual:** only a *settled* rejection reaches `onReadFailure`. A hang (socket stall, a Supabase incident that holds the connection, a serverless cold start against a paused project) propagates to every awaiting caller, and `inFlight` keeps every later caller on the same stuck promise. **Fix shape:** race the refill against a short budget (2–3 s) into `onReadFailure`, and take SA's stale-while-revalidate suggestion so a warm instance never waits on a refill at all.

#### Low

3. **D-Q3 — `verify-stored` reports success as "All stored legacy values are canonical and accepted `{ checked: 6 }`" when **zero** values were actually checked.** — `scripts/bos-llm-settings.ts:412`. Live evidence: the production run logged six × "Not stored; the seed will use the code default" and then `checked: 6`. P-3 is the one hard stop between a non-canonical value and a feature silently flipping; its success line must distinguish "6 present and clean" from "0 stored, 6 code defaults will be written". Count and report the two separately.
4. **D-Q4 — the workplan and the SA review overstate what P-5b proves on this database.** See QA-4: with nothing stored, `verify-equivalence` never executes a single unwrap branch, so RC-W1's actual failure mode is untested by it. Not a code change — §9 P-5b and §10.2 should say "passes vacuously with respect to the unwrap rules; the parity it proves is migration-literal vs legacy fallback".
5. **D-Q5 — the token guardrail accepts an image model on a token call if that model is priced.** — `modelSettings.ts:224-247` (`checkTokenModel`) has no notion of model *kind*; `policy.kind` only selects which checker runs, never excludes the other kind's models. Refused today only because `gpt-image-1` is absent from `FALLBACK_PRICING` — a single operator-added `ai_model_pricing` row removes that accident. The resulting provider 400 is not `model_not_found`, so `withModelFallback` will not recover it and the area is broken for the whole 60 s window. One line in `checkTokenModel`.
6. **D-Q7 — the seed SQL has never been parsed by PostgreSQL.** T1-9 cannot do it. Mitigated by the dry-run in the post-apply checks below.
7. **D-Q8 — the documented rollback leaves `''` where the description was `NULL`.** `COALESCE(description,'') || suffix` then `replace(…, '')` yields an empty string, not `NULL`. S1-12's stated goal ("a row that had no description ends up with none again") is met in spirit only. Cosmetic; `NULLIF(replace(...), '')` in the header's rollback closes it.

#### Blocked / environment (not a code defect)

8. **D-Q6 — five seed-SQL mutations could not be executed: the shared `node_modules` was partially deleted mid-session.** After all three gates and all twenty code mutations had completed, `C:\…\neuronforge\node_modules` lost every entry sorting before `@next` — including `.bin`, `@jest` and `@jest/core` — leaving `npx jest` and `node node_modules/jest/bin/jest.js` both unrunnable (820 of ~1,500 package dirs remain, and the count has been static since). No process of QA's deletes files, and the tree under test is untouched and clean. **The repo's `node_modules` needs `npm ci` before anyone runs tests again.** The five blocked mutations were S1 (insights area temperature 0.3→0.35), S2 (`full_site` model), S3 (the images `COALESCE` default), S4 (`DO NOTHING` → `DO UPDATE`) and S5 (removing the re-runnable `NOT LIKE '%superseded%'` guard). Verified instead by reading `modelSettingsSeed.test.ts:143-247` line by line: `migrationRow()` genuinely parses the file's `jsonb_build_object` trees (with `storedDefaults()` resolving `stored.*` through the CTE's `COALESCE`) and compares them to `SEEDED_ROWS` value-for-value, so S1–S3 would fail `writes exactly the rows the fixture describes`; S4 would fail both `toHaveLength(1)` on `ON CONFLICT (key) DO NOTHING` and `not.toMatch(/DO UPDATE/i)`; S5 would fail `marks the old keys superseded, re-runnably`. Dev's S1-3 mutation proof (insights `0.3` → `0.35` → 1 failed) is consistent with that reading. **Recorded as BLOCKED, not as PASS.**

---

### QA-9. AC coverage

| AC | Tested? | Result | Notes |
|---|---|---|---|
| AC-2 (identical request per call) | ⚠️ | **Partial** | Legs B and C hold, and QA re-proved them **live** for all 22 calls (QA-3). Leg A has 7 false negatives — **D-Q1** |
| AC-3 (precedence, null, unknown names, fixed-key read) | ✅ | Pass | T1-4 + QA's unknown-call-name and JSON-string-row probes; `getByKeys` called with exactly the eight keys |
| AC-4 (missing / non-object / one bad field / repo error; never throws) | ✅ | Pass | 26 malformed shapes + 6 failure modes, all fall back. **Caveat: a *hang* is not covered — D-Q2** |
| AC-5 (guardrails) | ✅ | Pass | 9/9, incl. the Layer-2-local `> 0` rule on both sides |
| AC-6 (locks) | ✅ | Pass | 5/5 locks ignored with the locked value used |
| AC-7 (60 s / 10 s) | ✅ | Pass | T1-10 fake clock + QA's 100-concurrent and 50-sequential probes |
| AC-8 (retry, negative cache, audit) | ✅ | Pass | T1-11 in the gate; classifier reads `status`/`code`/`param` only, never message text |
| AC-15 (reasoning models) | ✅ | Pass | 4/4 incl. the `o1` / `max_tokens` rule |
| AC-16 (script refuses invalid rows) | ✅ | Pass | Live for every read-only failure path; `set` paths from the (green) script suite + code read |
| AC-12 (gates) | ✅ | Pass | typecheck 0 new, build clean, no new direct Supabase outside repositories — `pricing.ts` **lost** its client; usage snapshot untouched |
| AC-13 items 1–2 (live) | ⏸ | **Pending the apply** | P-1/P-2 pre-observed by QA (0 area rows, 0 legacy keys); items 2 onward need P-4 |
| AC-9, AC-10, AC-11, AC-14 | — | Out of Step 1 | Steps 2–4 |

---

### QA-10. What can only be proven after the seed is applied — the exact post-apply checks for the user

Run in order; **stop on the first failure** and do not continue to Step 2.

**Before P-4 — two extra safety steps QA recommends (they cost one minute and cover D-Q7):**

```sql
-- 0a. Re-run §9 step 1b immediately before the Step 1 DEPLOY (not the seed):
SELECT provider, model_name, count(*) AS rows,
       min(input_cost_per_token)  AS min_in,  max(input_cost_per_token)  AS max_in,
       min(output_cost_per_token) AS min_out, max(output_cost_per_token) AS max_out
  FROM ai_model_pricing WHERE retired_date IS NULL
 GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 1,2;
-- Every row must have min = max on BOTH sides. A spread -> stop, show SA the delta.

-- 0b. Parse-and-discard run of the seed (D-Q7: this SQL has never been executed).
BEGIN;
  -- paste the whole contents of 20261003_seed_bos_llm_area_settings.sql here
  SELECT key, jsonb_pretty(value) FROM system_settings_config
   WHERE key LIKE 'bos\_llm\_area\_%' ORDER BY key;   -- expect 8 rows
ROLLBACK;
-- Any syntax error, or a row count other than 8, means STOP before the real apply.
```

**P-1 (before the apply):**
```sql
SELECT key, updated_at FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%';
```
→ **must be 0 rows.** QA observed 0 on 2026-09-20; re-confirm at apply time. Any row → STOP (`DO NOTHING` would keep it).

**P-2:**
```sql
SELECT key, value, jsonb_typeof(value), updated_at FROM system_settings_config
 WHERE key IN ('bizchat_planner_model','bizchat_analysis_model','bizchat_analysis_enabled',
               'lead_reply_recommender_model','lead_reply_recommender_enabled','image_generation_model');
```
→ QA measured **0 rows** on 2026-09-20. Paste the result into §10.2 either way. If any row has appeared since, P-3 becomes a real check rather than a formality.

**P-3:** `npm run bos:llm-settings -- verify-stored` → **exit 0**. Check the logged `supabaseHost` is the production project before believing the code. Per **D-Q3**, read the per-key lines, not only the summary: "Not stored" ≠ "checked".

**P-4:** apply `supabase/migrations/20261003_seed_bos_llm_area_settings.sql` in the SQL editor.

**P-5:**
```sql
SELECT key, jsonb_pretty(value) FROM system_settings_config
 WHERE key LIKE 'bos\_llm\_area\_%' ORDER BY key;                     -- 8 rows, matching §10's "seeded row"
SELECT key, description FROM system_settings_config
 WHERE description LIKE '%superseded by bos_llm_area_%';               -- expect 0 rows (no legacy key is stored)
```
then `npm run bos:llm-settings -- get <area>` for **all eight** → exit 0 each, and the resolved values must equal, call for call, the 22 values QA recorded live in QA-3 above (which are §10's "after" column). Paste both into §10.2.

**P-5b:** `npm run bos:llm-settings -- verify-equivalence` → **exit 0**, `checked: 6`. Record in §10.2 that, because nothing was stored, **this run proves migration-literal vs legacy-fallback parity only, and exercises none of the unwrap rules (D-Q4)**. Any difference → run the rollback `DELETE FROM system_settings_config WHERE key LIKE 'bos\_llm\_area\_%';` at once and escalate.

**P-5c (QA's addition — re-runnability, proven rather than assumed):** apply the migration file a **second** time. It must complete without error and leave the 8 rows byte-identical (`SELECT key, md5(value::text) …` before and after). This is the only live proof that `ON CONFLICT (key) DO NOTHING` and the `NOT LIKE '%superseded%'` guard behave as claimed.

**P-6:** QA records AC-13 items 1–2 in §10.2. Step 2 does not merge until P-5b and P-5c are green.

**Cannot be proven at any point before Step 2 deploys:** AC-13 items 3–5 (one action per area; the leads off/on cycle) and the ledger `model_name` check — no call site reads the resolver yet, so there is nothing to observe. That is correct for an inert step, not a gap.

---

### QA-11. Final status

- [x] **Machinery: PASS.** The resolver, guardrails, locks, cache, fallback helper, change script and pricing fix all behave as documented under everything QA could throw at them, with **one** exception (D-Q2, the missing read timeout).
- [ ] **CONDITIONAL SHIP.** One High is open — **D-Q1**, the seven mutation-proved false negatives in the AC-2 "before" evidence. Per the standing rule QA does not mark "ready for commit" with a High open. Two acceptable routes:
  1. **Dev closes D-Q1** (≈30 lines of assertions, listed in the defect) and re-runs the gate — QA's recommendation, since SA already graded this class High and the wrapper blind spot is not covered by any later step by default; or
  2. **SA and the user formally waive it**, on the record, on the grounds that Step 1 is inert and SA's amended D-21 obligation (T2-S/T3-S capture the **whole request object at the provider boundary** *and* the **number of calls made**) will catch all seven at the point they could do harm. If this route is taken, §6.3/§7.3 must say explicitly that those tests also cover the shared builders and the stored-key calls.
- [ ] **D-Q2 (Medium)** should be fixed before Step 2 wires the first call site, not after.
- [ ] **D-Q3, D-Q5, D-Q7, D-Q8** are minutes of work each and are worth taking while the files are open; **D-Q4** is a wording change in §9/§10.2.
- [ ] **Environment: `npm ci` is needed in the main checkout** before anyone runs tests again (D-Q6). The branch itself is unaffected and its tree is clean.
- [x] **Seed migration: GO** from QA's side, once D-Q1 is resolved and with P-5c and the `BEGIN/ROLLBACK` dry run added to the order.

---

## 17. Commit Info

*(RM populates: per-step commit, PR and deploy.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Created (Planning) | Code-reality check against `e35c83d4` (N-1 to N-14); design; Steps 0–4 with files, tasks, tests, gates and rollout; apply order P-1 to P-6; per-call parameter snapshot; AC traceability; `console.*` flags; risks; Q-1 to Q-12 for SA |
| 2026-09-19 | SA workplan review: APPROVED WITH CHANGES | Verified N-1 to N-14 and the §10 snapshot against `e35c83d4`. Confirmed deletion of settings POST (no caller). Required changes RC-W1 to RC-W11: the seed must match today's boolean/string readers, plus a P-5b legacy-vs-resolver equivalence check; chat-v4 gate goes just before the budget refusal; mutate creates the page and skips generation, with one `onAiDisabled` check point; images price the model that ran; the `o1` / `max_tokens` gap; the planner loop uses `modelUsed`; typed resolver, defaults never checked, `hasPricing` memoised; script refuses locked fields and the Step 3 deferral uses the lock; typecheck scope grows with chat v1/v2; pricing audit gets the admin id; insights AC-10 test. Answered Q-1 to Q-12 |
| 2026-09-20 | **Step 0 scope change (user) + SA spec addendum** | The pricing route’s direct Supabase access is fixed **in Step 0**, not deferred to RC-10b. SA spec (addendum after §15): a **new** `AiModelPricingRepository` (not an extension of `SystemConfigRepository`), six methods (`listAll`, `findById`, `create`, `updateCosts`, `deleteById`, `syncMany`) on `AgentRepositoryResult`, the **`user_id` exemption documented in the header** (platform-wide table, no tenant column, service role intentional, authorisation is `requireAdmin`’s job). `syncMany` must **not** become an `upsert` — the unique constraint is `(provider, model_name, effective_date)` and the sync re-stamps the date every run — and it fixes the `.single()` duplicate-row hazard. `lib/ai/pricing.ts` **stays** in Step 0 and moves in Step 1 with its 9 `console.*`, a `listActive()` and the oldest-price-wins cache bug. Zero prices (user decision, option b): `$0` stays allowed but is logged at **error** level and written to the audit trail as a new `AI_PRICING_ZERO_SET` entry naming the admin (Step 0), and Layer 2 must reject a zero-priced model via `getPricing(...).input > 0 && .output > 0` rather than `hasPricing` (Step 1; embeddings caveat noted). New tasks T0.10–T0.13 |
| 2026-09-20 | **SA code review of Step 0: APPROVED WITH CHANGES** | Verified the gate order and fail-closed behaviour on all six handlers, that settings `POST` has no caller anywhere, that the `bos_llm_area_*` refusal survives nesting and `__proto__` (probed against zod 3.25.76), that the admin page's request and response shapes are unchanged (read `page.tsx` directly), and that the 401/403 tests prove zero data access. Must fix: **S-1** the pricing **sync** rewrites ~40 rows with no audit entry while `logAIPricingSynced` sits unused; **S-2** the reserved-key regex is case- and whitespace-sensitive. Rulings: **D-1 accepted** (`string|number` -> `String()` is safe against a uuid or a bigint column); **D-3 stands for Step 0**, with a condition on Step 1 — `hasPricing` returns true for a `0/0` row, so a zero price must count as unpriced in §3.3 unless the user rules a zero price legitimate. Recorded outside scope: the neighbouring admin config routes are still ungated (S-4), and the Step 1 prefix-constant choice (S-8) |
| 2026-09-20 | **Step 0 implemented** (code complete, uncommitted) | `lib/admin/requireAdminRoute.ts` plus 4 test files; `system-config/route.ts` rewritten (POST deleted, admin gate, Zod, repository, `bos_llm_area_*` refusal, Pino); `pricing/route.ts` and `pricing/sync/route.ts` gated, Zod-validated, Pino-converted, audit entries carry the admin id and tolerate an audit failure (RC-W10). T0.0, T0.2–T0.5 and T0.7 ticked. T0.1 (production RLS read), T0.6 (conditional migration), T0.8 (manual admin check) and T0.9 (reviews) remain open. Gates in §4.6; deviations in §4.8 |
| 2026-09-20 | **Step 0 RLS migration APPLIED to production** (docs-only update; no code change, nothing committed) | The user applied `20260920a_lock_system_settings_and_pricing_rls.sql` ahead of the code deploy; it applied fully and cleanly. T0.6 and the §4.2 file row updated from "written, not applied" to applied-with-date, and the post-apply verification output pasted into §4.4: RLS true on both tables, the three `admin_users`-backed policies present, both broken `FOR ALL` policies gone, the two pre-existing SELECT policies kept, client roles left with SELECT only, `is_platform_admin` `prosecdef=true` with `search_path=pg_catalog, public`. §4.4 now states why applying before the deploy was harmless (the migration constrains only direct anon/authenticated access; every app path is service-role) and that the rollback block is now the operational record. Consequences recorded: **F-0 / R-15** — the route-level hole stays open in production until Step 0 deploys, since the still-deployed unauthenticated routes write with the service role and bypass RLS, which raises the priority of shipping Step 0; and **D-17** — `ai_model_pricing` is now admin-SELECT-only, so a future browser-side price read would return an empty set rather than an error (flagged for Step 1's `listActive()` and for any client-side pricing view) |
| 2026-09-20 | **QA defects fixed** (Step 0, uncommitted) | **D-Q4** (Medium): the migration's ROLLBACK re-grants only `ai_model_pricing` — the table whose grants §4.4 actually recorded — and tells the operator to paste the PRE-APPLY grants for `system_settings_config` rather than guess, so a rollback can no longer leave that table more open than it started. **D-Q1**: reserved-key matching moved to a canonical form (NFKC + invisible-character strip + trim + lower-case) plus an ASCII-identifier charset rule, closing the zero-width, full-width and Cyrillic look-alike variants (4 new tests). **D-Q2**: a key the write cannot carry (`__proto__`) is now a 400 naming it, not a 200 "updated successfully" (1 new test, raw-JSON body). **D-Q3**: `requireAdmin` guards `getUser()` and answers 401 on an auth throw instead of 500 (1 new test). Taken while in the migration: **D-Q6** (both pre-apply queries inlined) and **D-Q7** (`lower(au.email)`). Recorded as follow-ups instead of fixed: **D-Q5** → F-5, **D-Q8** → F-6, **D-Q10** → F-7, **D-Q9** folded into D-14. Gates re-run: typecheck 0 new, 29 suites / 290 tests, build clean |
| 2026-09-20 | **SA re-review changes applied — migration only** (code unchanged, uncommitted) | **R-1**: `is_platform_admin()` pins `SET search_path = pg_catalog, public`. **R-2**: both REVOKEs now name `PUBLIC` as well as `anon`/`authenticated`, with the rollback's deliberate asymmetry (no PUBLIC re-grant) stated in the file. **R-3/R-4**: the migration gained a PRE-APPLY CHECK block, and §4.4 now carries the four raw `pg_policies` rows verbatim plus the explicit conclusion that the two standalone `SELECT` policies are not the `FOR ALL` policies being dropped — so anon/authenticated reads survive; the `system_settings_config` grant rows are still to be pasted at apply time. **C-1** recorded as D-14: the zero-price alert fires on input-only embedding models (legitimate `output: 0`) and will raise critical false positives until the Step 1 guardrail narrows it. Gates re-run: typecheck 0 new, 29 suites / 284 tests, build clean |
| 2026-09-20 | **Step 0 second pass: SA fixes + RLS migration + repository switch** (code complete, uncommitted) | **S-1** fixed: the pricing sync now writes `logAIPricingSynced` with the admin's id, non-blocking. **S-2** fixed: the `bos_llm_area_*` refusal normalises `trim().toLowerCase()` and padded keys are refused (4 new T0-2 cases). **D-1** tightened to a uuid after R-3. **T0.1** results recorded in §4.4 and **T0.6** written as `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` (RLS on `ai_model_pricing`, `is_platform_admin()` over `admin_users`, client write grants revoked on both tables, the two `profiles.role`/`auth.users.role` write policies replaced) — **written, not applied**. **T0.10–T0.13** (SA addendum): new `AiModelPricingRepository`, both pricing routes moved onto it with 404s on a missing row, the sync duplicate-row bug fixed, the zero-price policy (`AI_PRICING_ZERO_SET` + error log), 17-case repository unit test, route suites moved to a repository double with no assertion changed, and a static no-direct-Supabase/no-`console.*` gate. Follow-ups F-1 to F-4 recorded in §4.9. Gates in §4.6: typecheck 0 new, `tsc` 2,038 (was 2,045), 29 suites / 284 tests, build clean |
| 2026-09-19 | SA changes applied to the body (docs only) | RC-W1: `verify-stored` canonical check at P-3, new `verify-equivalence` mode and **P-5b** post-seed parity check with rollback `DELETE`, T1-13b. RC-W2: chat-v4 gate just before `!budget.allowed`, §3.8/§7.1 contradiction with Q-10 removed, T3-G parked-write case. RC-W3: Q-7 reversed, one `onAiDisabled` check point, mutate still creates the page. RC-W4: images price the resolved/used model, off check after reuse. RC-W5: first option chosen (export `usesMaxCompletionTokens`, reject reasoning models outside it; covers `o1`). RC-W6: planner loop uses `modelUsed`. RC-W7: typed resolver, `isBosLlmAreaEnabled`, defaults never checked, `hasPricing` memoised. RC-W8: script rejects locked fields, Step 3 deferral via `switchable: false`, `--include-calls`. RC-W9: scope growth recorded per step, R-11 corrected. RC-W10: pricing audit gets admin id, non-blocking, PUT at-least-one-cost. RC-W11: T2-M-I in the AC table. Q-1 to Q-12 marked resolved (§14). Recorded as pending: the live lead-reply/chat off/on QA check (**pending user decision**, no test environment) and the `page.tsx` `console.error` conversion (**pending user OK**). SA's non-blocking optimisation (pricing cost > 0) not adopted; left for Step 0 code review |
| 2026-09-21 | **SA re-check answered — R-1 fixed, R-2 corrected, rulings recorded (still uncommitted)** | **R-1 (must fix):** the 3-second budget now races the **whole refill** (`withReadBudget(buildSnapshot())`), not just the row read, so a hang in `getPricing` or `getImageGenerationConfig` — both reachable the moment an operator configures a non-default model — lands on the same ordinary failure path. `buildSnapshot` is now side-effect free, so a build that loses the race cannot later overwrite the snapshot served in its place. Three new tests: the row read hangs, the price lookup hangs, and a warm instance serves its last good settings through a hung refill; on the pre-R-1 shape the price-lookup case fails after 5,022 ms, which is the proof the fix was needed. **R-2:** the cost of the timeout corrected wherever written — not "one call a minute" but ~3 s in every 13 while the database is stalled. **D-Q2 upheld** (no SWR, AC-7 unchanged), with SA's reasoning recorded beside the Dev's. **Leg (A) ruling written into §6.3 / §7.3:** T2-S / T3-S spy at the provider boundary and assert the whole request object plus the call count, and each leg-(A) entry is deleted as its call site is wired; leg (A) is a drift alarm and gets no further hardening (SA proved two more escapes: a `params` rewrite above the slice, and a `...spread` after the recorded `model`). **R-3:** the migration header's P-5b / P-5c order now matches §9. **R-4** recorded as a known limitation owned by the layer that first allows a second provider. Gates re-run: `typecheck-bos-llm: 168 files in scope, 30 errors, 0 new`; `next build` ✓; jest **39 suites / 538 tests / 1 snapshot**. §5.10 answers each item. |
| 2026-09-21 | **QA-round fixes verified: eight mutations caught, three gates green** | Environment restored (`npm ci`: 841 packages, 165 `.bin` entries), so the runs owed from the previous row were made. Three self-inflicted failures in the new D-Q1 assertions were fixed first: the leads anchor was not unique (`MODEL_KEY` appears twice — anchored on `getString(MODEL_KEY, 'gpt-4o-mini')` instead), the model-assignment regex missed an inline object literal (the image call builds its request on one line), and the two builder assertions compared multi-line snippets against a CRLF working tree (a `readNormalised` helper). **All eight mutations now caught** — the three stored-key call sites, both shared request builders (model pinned, and a synthesised temperature), the duplicate `model:` key and the second call site sharing a call name — each `1 failed, 28 passed`, tree restored to baseline. Gates: `typecheck-bos-llm: 168 files in scope, 30 errors, 0 new` — passed, baseline unchanged; `npm run build` → `✓ Compiled successfully`; jest selection **39 suites / 535 tests / 1 snapshot, all passed**. §5.4's "unverified" warning removed and the evidence recorded there. **Open for SA:** the D-Q2 trade-off (no stale-while-revalidate, to keep AC-7's "used at 60 s" exact) — left as implemented, for the next review round to rule on. |
| 2026-09-21 | **QA Step 1 report answered — D-Q1 … D-Q8 addressed (still uncommitted); gates BLOCKED on the environment** | **D-Q1 (High):** T1-14 leg (A) closed on all three blind spots — the three stored-key calls now assert the resolved variable reaches the request (`/^\s*model,$/m`), the two shared request builders are asserted directly (forward `params.model`, pin no model, synthesise no temperature), every anchor must be unique in its file, and every model evidence item must find exactly one model assignment in the block. **D-Q2 (Medium):** the refill is raced against a 3-second budget, so a hung read degrades like a failed one; stale-while-revalidate deliberately NOT adopted because it would break AC-7's "used at 60 seconds" — later upheld by SA. (The cost was first stated wrongly as "one call a minute"; corrected under R-2 to ~3 s in every 13 while the database is stalled.) **D-Q3:** `verify-stored` distinguishes present from absent. **D-Q5:** an image-family model is refused on a token call. **D-Q8:** the rollback restores NULL. **D-Q4 and D-Q7 recorded as limitations**, with QA's P-5b scope note, the P-3b `BEGIN … ROLLBACK` dry run and the P-5c md5 re-apply proof folded into §9 and the migration header. **D-Q6:** the shared `node_modules` is still missing everything before `@next` (`.bin`, `@babel`, `@jest/core`), so jest, tsx and next are unrunnable; the three gates and the seven mutation proofs could not be re-run this round and are recorded as BLOCKED pending `npm ci`. §5.9 answers each item. |
| 2026-09-21 | **SA re-check of Step 1: APPROVED with one must-fix; seed go/no-go stands (GO)** | Limited to what changed since the 2026-09-20 review. Gates re-run by SA: **39 suites / 535 tests pass**, `typecheck:bos-llm` **168 files / 30 errors / 0 new**. S1-1 … S1-12 and D-Q1 … D-Q8 all verified in the code, including the script proven end to end against production and the clamped evidence windows. **Leg (A) ruled as sound as a source-reading assertion can be, and explicitly not a soundness proof:** SA proved two residual escapes on this tree and restored it byte-identical — (i) rewriting `params` one line *above* `providerFactory.complete()`'s inspected slice changes 12 calls with the suite green, (ii) a `...spread` after the recorded `model`/`temperature` in `InsightRepository` passes because `singleModel` counts assignments, not spreads; (iii) reachability is never asserted. Ruling: **stop hardening leg (A)** — it is a drift alarm; the guarantee moves to the provider boundary, and the D-21 amendment is strengthened so **T2-S / T3-S spy at the boundary and assert the whole request object plus the call count**, and each call's leg-(A) entry is **deleted** when its site is wired. **D-Q2 ruled: keep it exact — no stale-while-revalidate, AC-7 unchanged**, because an emergency "off" under SWR always lets one more paid call through per instance and has an unbounded tail on a low-traffic instance, whereas the 3 s wait is rare and bounded. **Must-fix R-1 (Medium):** the budget covers only `getByKeys`; the same refill's `getPricing` / `getImageGenerationConfig` awaits are unbounded and sit behind the shared in-flight promise — invisible today (every seeded model equals its default) but live the moment an operator configures a different model. Race the whole `refill()` against the budget. Recorded, non-blocking: **R-2** the timeout's real cost is every call arriving in the ≤3 s window (~3 s per 13 s while the DB is stalled), not one call a minute; **R-3** §9 and the migration header order P-5b/P-5c differently; **R-4** S1-8 silently reverts a provider-only configuration (unreachable until a second provider is allowed — revisit then, ideally reporting it as `adjusted`); **R-5** the residual leg-(A) class is recorded in the re-check as authoritative. **D-Q4 / D-Q7 handled sufficiently:** P-3b (`BEGIN … ROLLBACK`) and P-5c (fingerprint, apply twice, re-fingerprint) close them, and P-5b's vacuity is a consequence of none of the six legacy keys being stored — which also removes the risk RC-W1 guarded. **Seed migration: GO**, condition S1-1 closed, with P-3b before P-4, P-5c after P-5, and §9 step 1b re-run before the deploy carrying the new pricing reader |
| 2026-09-20 | **SA Step 1 review answered — S1-1 … S1-12 all fixed (still uncommitted)** | **S1-1:** `npm run bos:llm-settings` added (`tsx --import ./scripts/env-preload.ts`), the invocation corrected in the script header, the migration header, §3.6 and §9, and the script **run end to end against production, read-only**: usage exit 2, `get leads` exit 0, `verify-stored` exit 0 (none of the six legacy keys is stored), `verify-equivalence` exit 0 with `checked: 6` — and no `bos_llm_area_*` row exists yet. **S1-2:** T1-14's evidence window is now bounded by the neighbouring call anchors (with an explicit `side` for the onboarding layout); SA's four mutations each fail the right test and the file reverts green. **S1-3:** T1-9 parses the migration's `jsonb_build_object` trees and the CTE's COALESCE defaults and compares them with the fixture value for value; proven by mutating the SQL. **S1-4:** §5.5 and §9 step 1b record that the newest-price-wins fix is a real, product-wide charging change and gate the deploy on the read-only duplicate-price query. **S1-5:** `listActive()` gains `lte('effective_date', today)` and a `created_at` tie-break. **S1-6:** the repository header now names the two caller classes, including the ungated billing reader. **S1-7:** the change script warns, by name, which calls keep spending when an area is switched off, computed from the policy. **S1-8/9/10/11/12:** provider follows the model on fallback; an area-level locked temperature that differs is reported as `adjusted`; the RC-11 drop is reported at call level; both verify commands name the Supabase host; the superseded marker no longer turns a NULL description into the key. SA rulings applied: D-18 with S1-9, D-21 with §6.3/§7.3 now requiring T2-S/T3-S to capture the whole request object at the provider boundary plus the call count, D-22 … D-27 accepted. §5.7 answers each item. |
| 2026-09-20 | **Step 1 implemented (code complete, uncommitted)** | Branch `feature/business-os-llm-layer2-step1` off `main` `ba25fb9a`. New under `lib/business-os/llm/`: `modelSettingsPolicy.ts` (every call's code default, locks, allowed providers, temperature bounds — the only place a Business OS model name or temperature is written), `modelSettingsSchema.ts`, `modelSettings.ts` (typed resolver, 60 s cache with a shared in-flight read and a 10 s retry after a failed one, guardrails, locks, the change-seen log, `isBosLlmAreaEnabled`, `validateAreaRow`, never throws) and `modelFallback.ts` (one retry on a classified model-not-found, negatively cached for the settings window). `openaiProvider.ts` exports `rejectsSamplingParameters` and a module-level `usesMaxCompletionTokens` that the private method now delegates to (RC-W5). `scripts/bos-llm-settings.ts` adds `get` / `set` / `verify-stored` / `verify-equivalence`, validating with the resolver's own schema and guardrails before any write. Seed migration **written, not applied**, renamed `20261003_…` (D-19), with the P-1…P-5b checks and the rollback in its header. Per the SA addendum §E, `lib/ai/pricing.ts` moved to `aiModelPricingRepository.listActive()` (new method), its 9 `console.*` became Pino, and the oldest-price-wins cache bug is fixed; per D-14 / QA D-Q9 the zero-price alert no longer fires on an input-only embedding model. Tests: 5 new `llm/` suites, the provider family suite, the script suite, `lib/ai/__tests__/pricing.test.ts`, `listActive` cases and 3 zero-price cases — all passing. Gates in §5.4: `typecheck:bos-llm` 158 files / 30 errors / **0 new**, baseline unchanged; `next build` clean; `tsc` unchanged at 2,034 (excluding generated `.next/types`) with none in a touched file. Deviations D-18 … D-27 in §5.6 — **D-21 is the one SA should look at first**. |
| 2026-09-20 | **SA code review of Step 0 (re-review): APPROVED WITH CHANGES** | Re-verified against the working tree, not the Dev summary. **S-1**, **S-2** and the **D-1** uuid narrowing all land as specified. **T0.10-T0.13** conform to the SA addendum and REPOSITORY_STRATEGY: injectable client, `AgentRepositoryResult`, never throws, the `user_id` exemption documented with all five required points, `syncMany` proven not to be an upsert and the `.single()` duplicate bug fixed by newest-row-wins, 404s on both missing-row paths, and the route suites genuinely moved to a repository double with only arrangement changed (read the tests; every denial still asserts zero data access). The static gate is real (recursive, asserts >=3 files, forbids `createClient` / raw clients / `.from('...')` / `console.*`). Gates re-run by SA: **29 suites / 284 tests pass**; full `tsc` shows the only touched-file errors are the 4 pre-existing `reward_config` ones. Zero-price policy and the `ai_pricing` entity type (D-10) approved — blast radius confirmed nil. **Migration: GO, conditional** on (1) `search_path` reordered to `pg_catalog, public` (R-1), (2) `PUBLIC` added to both REVOKEs (R-2), (3) the operator confirming from raw `pg_policies` output that `system_settings_config` has a SELECT policy independent of the two being dropped (R-3) — otherwise the DROPs would take anonymous read access with them and break the V2 theme provider. Billing-break risk cleared: every `ai_model_pricing` reader is service-role, `supabaseServer` has no anon fallback, no browser reader exists (R-9); no anon/authenticated writer of either table exists (R-10). Non-blocking: **C-1** the zero-price alert will false-positive on input-only embedding models (an SA spec correction, carried into Step 1 with S-6). **P-2**: fold F-1's real write hole (the `profiles` UPDATE policy with no `WITH CHECK`) and the now-stale "no code reads profiles.role for access" claim into `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` at merge |
| 2026-09-20 | **QA test report for Step 0: SHIP, with two blocked live checks** | Gates re-run by QA: `typecheck:bos-llm` 156 files / 30 errors / **0 new**; `npm run build` clean (295/295, exit 0, the three routes dynamic); **29 suites / 284 tests pass**. 13 PASS, 0 FAIL, 2 BLOCKED. Live HTTP proof (anonymous) that all six handlers answer 401 and that the deleted settings `POST` is a real **405**; a bogus bearer and a garbage cookie also give 401, not 500. Adversarial probe of the reserved-key refusal (17 payload shapes): nesting, arrays, duplicate JSON keys and `__proto__` are all safe, but **D-Q1** zero-width / Cyrillic / full-width look-alikes defeat the prefix test and are written, and **D-Q2** a `__proto__` key is dropped while the route still reports success. Ten defects, none High: **D-Q4 (Medium)** the migration ROLLBACK re-grants writes on `system_settings_config` that the §4.4 read never recorded; D-Q1, D-Q2, D-Q3 (`getUser()` unguarded → 500 instead of 401), D-Q5 to D-Q8 Low; D-Q9, D-Q10 informational. Response contract verified unchanged on all five page calls (`getAll` is byte-identical to the old service call; `set` preserves `category`). Audit entries serialise correctly (`sanitizeChanges` does not redact `*_cost_per_token`) and are effectively non-blocking. **BLOCKED: T0.8-b (non-admin 403) and T0.8-c (admin page load / billing save / price edit / sync)** — no credentials, and minting a user would write to the live project; the user must run L-0. Full report in §16 |
| 2026-09-20 | **SA code review of Step 1: FIX REQUIRED (2 must-fix), seed migration GO conditional on one of them** | Re-verified against the working tree: 18 suites / 343 tests pass, `typecheck:bos-llm` 0 new, 0 `console.*` in all nine touched files, no client-side import of the resolver or of `lib/ai/pricing`, and the seed SQL read by hand against §10 and the fixture — all eight rows match value for value. **S1-1 (High):** `scripts/bos-llm-settings.ts` loads no environment and crashes at import (`Error: supabaseUrl is required.`), so **P-3 and P-5b cannot be run as documented**; the repo's own `scripts/env-preload.ts` fixes it (SA verified) and the invocation must be corrected in the script header, the migration header, §3.6 and §9. **S1-2 (High):** T1-14's evidence check uses a ±45-line window, and SA demonstrated four false negatives in `WebsiteAIContentService.ts` (`hero_content` model and temperature, `field_regenerate` model, `testimonial_enhance` model) where a sibling call's identical literal satisfies the check. Medium: T1-9 proves the seed SQL by substring only (S1-3); the `lib/ai/pricing.ts` newest-price-wins fix is a **real production charging change** in a step advertised as inert and needs a pre-deploy duplicate-row query (S1-4); `listActive()` lacks an `effective_date <= today` filter and a tie-break (S1-5); `AiModelPricingRepository`'s "every caller is admin-gated" header is now false (S1-6); the website kill switch is partial and silent between Steps 2 and 3 (S1-7). Rulings: **D-18 accepted** with S1-9 (report an area-level locked temperature that differs, as a non-blocking `adjusted`); **D-21 accepted as amended** — legs B and C are real, not a tautology, but leg A is unsound today and proves text rather than dataflow, so §6.3/§7.3 must make T2-S/T3-S capture the whole request object at the provider boundary plus the call count; **D-22, D-23, D-24, D-25, D-26 accepted**; **D-27 accepted for chat and onboarding, conditional on S1-7 for website**. **Seed migration: GO, conditional on S1-1 only**, with the order of operations (incl. a pre-deploy pricing-duplicates check) spelled out in the review |
| 2026-09-20 | **QA test report for Step 1: CONDITIONAL SHIP (1 High open)** | Gates re-run by QA verbatim: `typecheck:bos-llm` **168 files / 30 errors / 0 new**; `npm run build` **Compiled successfully, exit 0** (the `DYNAMIC_SERVER_USAGE` lines are pre-existing); **39 suites / 533 tests / 1 snapshot pass**, no pre-existing failure in scope. **34 PASS / 1 FAIL / 2 BLOCKED; 1 High, 1 Medium, 6 Low.** **D-Q1 (High):** twenty one-line mutations of real call sites show T1-14 leg (A) still has **seven** false negatives after S1-2 — the three stored-key calls (`Planner.ts:447`, `AnalysisService.ts:127`, `LeadReplyRecommender.ts:103` are all `model,` and are asserted by nothing, only the config read's fallback literal is), the two shared request builders (`providerFactory.complete()` = 12 calls, `openaiProvider.chatCompletion()` = 8 calls, plus a synthesised temperature on the four onboarding extractors), a duplicate `model:` key in the same object literal, and a second call site for the same `callName`. The planner and leads mutations survive **1,956 tests** across `lib/business-os lib/ai lib/services`. **D-Q2 (Medium):** the resolver has no read timeout — a hung `getByKeys` leaves every caller pending forever with no last-good on a cold start (probe `HUNG`), contradicting "a configuration fault can never fail an owner action"; inert now, hot path from Step 2. Low: `verify-stored` says "checked: 6" when six were absent and none checked (D-Q3); P-5b passes **vacuously** with respect to RC-W1 because nothing is stored, so no unwrap branch ever executes (D-Q4); a priced **image** model is accepted on a **token** call (D-Q5); the seed SQL has never been parsed by PostgreSQL (D-Q7); the rollback leaves `''` where the description was NULL (D-Q8). **Everything else passed:** 57 adversarial probes — 26 malformed row shapes plus repository error/throw/undefined/non-array, `getPricing` throw, image-config throw — all fall back to today; 100 concurrent callers share **1** read and 50 sequential calls after a failure issue **0**; 16/16 guardrail and lock cases fall back rather than fail; the oldest-price-wins bug is confirmed present in `HEAD` and fixed, `listActive()` has both the `effective_date <= today` filter and the `created_at` tie-break, and `lib/ai/pricing.ts` **dropped** its own `createClient` for the repository's service-role client (no reader moved off the service role). The change script was **run for real against production, read-only**: all eight `get` commands exit 0 and reproduce §10's "after" column for **all 22 calls**; `verify-stored` and `verify-equivalence` exit 0; every bad-input path exits 2; **no `bos_llm_area_*` row exists and none of the six legacy keys is stored** — Dev's two claims independently confirmed. P-3 was checked against **both** `getBoolean` implementations: no stored value was found that reads *off* today and would be seeded *on*. **BLOCKED (environment, D-Q6):** the shared `node_modules` lost every entry before `@next` (incl. `.bin` and `@jest`) mid-session, so five seed-SQL mutations could not be executed — verified by reading T1-9 instead, which genuinely parses the migration's `jsonb_build_object` trees; **`npm ci` is needed in the main checkout**. QA-10 gives the exact post-apply commands, adding a `BEGIN … ROLLBACK` dry run and a **P-5c** second-apply re-runnability proof. Full report in §16 |
