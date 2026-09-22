# Requirement: Business OS LLM — Layer 2: Model Settings per Area

> **Last Updated**: 2026-09-21

**Created by:** BA
**Date:** 2026-09-19
**Status:** **Delivered (code) — with three named exceptions (2026-09-21).** Steps 0-3 merged (PRs #61, #79, #85, #87) and the eight area rows seeded in production; Step 4 (the FR-15 literal gate, the skill and the [operator runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md)) is code-complete and in review. SA reviewed 2026-09-19 (APPROVED WITH CHANGES); RC-1 to RC-12 applied to the body below. The user answered BQ-1 and BQ-2 on 2026-09-19.

**The three exceptions, stated because "Delivered" would hide them** (SA Step 4 review):

1. **The anti-drift property is not in force.** `npm run check:bos-llm-literals` runs in CI but the job is **not a required status check** on `main` (the only required context is `Admin authz surface guard`). A contributor can hardcode a model, watch the check go red and merge. Closing it is a repository-settings change and belongs to the user.
2. **chat-v2 still picks its own model, and its spend never reaches the ledger.** `AIDataLayerService` reads `process.env.OPENAI_CHAT_MODEL` through the raw OpenAI SDK and writes no `token_usage` row (F-13 / DEC-11, decided, not a defect). The *kill switch* covers it — the chat entry gate stops it — but "an operator can change any Business OS model without a deploy" is **false for chat-v2**, and its cost is invisible.
3. **The Step 2 and Step 3 post-deploy checks are unrun.** Nothing has yet confirmed in production that the wired areas resolve their rows. Delivered in code is not delivered in production.

**Still open after delivery:** the **admin screen** (a later layer — until it ships, the change script and the seed migration are the only sanctioned writers); post-deploy checks for Steps 2 and 3; and the follow-ups carried in the workplan — FU-3 (who may change a live setting, parked by the user), FU-4 (`ImageGenerationConfig.model` has no reader left), FU-5 (the boundary suites drive one public entry of seventeen), FU-7 (the gate is not a required status check) and FU-8 (the resolver's fail-open warning message is untrue in the dangerous case), plus FU-6's monitoring half (an alert on repeated resolver read failures; the **fail-open** behaviour itself is documented in the runbook §5). `AC-13` items 4-5 remain a live check.

## Overview

This layer delivers the user's Business OS LLM standard **#1: "every AI call's model, provider, temperature and on/off switch is configured in the database, with an admin entry point"**. Standards #2 to #4 are done: cost tracked, recorded under the real user, and in the audit trail (Layers 1, 1.1, 1.5, the logging clean-up and Layer 3). Today each Business OS call site chooses its own settings. Some write a model name and temperature straight into the code (`'gpt-4o'`, `0.3`). A few read single-purpose keys that were added one at a time (`bizchat_planner_model`, `lead_reply_recommender_enabled`, …). Changing a model is therefore mostly a code change and a deploy, and there is no uniform way to switch an area's AI off.

**In the user's words (confirmed scope):** *"Each Business OS area's AI calls get their model, provider, temperature and on/off switch from one JSON setting per area in the database; the admin screen comes in a later layer."*

Layer 2 adds **one JSON row per Business OS area** in `system_settings_config`, eight rows in all (chat, insights, briefing, website, intake, leads, onboarding, images). Every catalogued call reads its settings from its area's row. The row may override single calls. **On deploy, nothing changes:** the migration seeds each row with exactly what runs today, and the values in code today become the fallback defaults. A missing, broken or unreadable row therefore behaves exactly like today.

**Step 0 ships first (user decision BQ-2, 2026-09-19):** before any Layer 2 row exists, the unprotected platform-settings and model-pricing admin routes are closed to everyone except platform admins (F-1, DEC-12, FR-1).

**Evidence:**
- [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md): the investigation behind all layers.
- [Layer 1](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md): the area and call catalog. Call names were made stable *because* they become the Layer 2 config keys.
- [Layer 1.5](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md): KI-C, the onboarding `'gpt-4o'` literals carried forward to this layer. It also covers image model/price configuration.
- [Layer 3](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md): audit entries already record the model names each action used.
- Code read on 2026-09-19 in the worktree `feature/business-os-llm-layer2-model-settings` (fresh off `main`), and verified by SA the same day. See [Findings](#findings-from-the-code) and [SA Review](#sa-review).

---

## Table of Contents

- [Findings from the Code](#findings-from-the-code)
- [Current Settings Inventory](#current-settings-inventory)
- [Decisions (BA, SA-approved)](#decisions-ba-sa-approved)
- [What "Off" Means, Per Area](#what-off-means-per-area)
- [User Stories](#user-stories)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Delivery Order](#delivery-order)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## Findings from the Code

| # | Finding | Evidence | Consequence for this layer |
|---|---|---|---|
| **F-1** | **The settings and pricing tables can be written by anyone.** `/api/admin/system-config` has `GET`, `PUT` and an uncalled `POST`, none with a login or admin check. `PUT` updates any `system_settings_config` key and can also **create** keys (`SystemConfigService.set` updates, else inserts). All write with the service role and return `error.message` to the client. `GET` returns every setting. The sibling `pricing` (GET/PUT/POST/DELETE) and `pricing/sync` (POST) routes have the same gap over `ai_model_pricing`. `middleware.ts` skips all `/api` paths, so nothing in front of the routes checks either | `app/api/admin/system-config/route.ts`, `pricing/route.ts`, `pricing/sync/route.ts`; `SystemConfigService.ts:224-300`; `middleware.ts:81-84`; SA V-10 | Once Layer 2 ships, an anonymous request could switch off, or re-point to an expensive model, every Business OS AI call, or delete a price and zero cost tracking. Closed in Step 0 ([DEC-12](#decisions-ba-sa-approved), FR-1) |
| **F-2** | **Settings differ *within* an area.** Website `full_site` uses `gpt-4o` while the block calls use `gpt-4o-mini`. Insights uses temperatures 0.3 / 0.4 / 0.5 for its three calls. Chat planner and analysis read separate keys | [Inventory](#current-settings-inventory) | A single value per area would change behaviour on deploy. Per-call overrides are needed (DEC-1) |
| **F-3** | **Some calls already read single-purpose keys:** `bizchat_planner_model`, `bizchat_analysis_model`, `bizchat_analysis_enabled`, `lead_reply_recommender_model`, `lead_reply_recommender_enabled`, `image_generation_model`. Production may hold non-default values in them. Chat reads its keys through the deprecated `SystemConfigService` with `supabaseServer`; leads reads through `systemConfigRepository` | `Planner.ts:118-124`, `AnalysisService.ts:90-96`, `LeadReplyRecommender.ts:40-42,95-98`, `SystemConfigRepository.ts:13-18`; SA V-3 | For a zero-change deploy, the seed must copy the **stored** values, not the code defaults, and must be applied before the reading code deploys (DEC-6) |
| **F-4** | **The shared `complete()` helper always uses OpenAI**, whatever the caller wants | `lib/ai/providerFactory.ts:332` | With OpenAI the only allowed provider in Layer 2 (DEC-4), `complete()` already honours model and temperature. Call sites stay on it; moving off it belongs to the layer that first allows another provider (RC-8) |
| **F-5** | **Not every provider can serve every call.** The planner uses tools with `tool_choice: 'required'` and `frequency_penalty`. Several calls use JSON mode. Embeddings and images exist only on the OpenAI provider (`GeneratedImageService.ts:55-61`) | `Planner.ts:444-481`, `AnalysisService.ts:125-137` | Which providers a call may use is decided in code, per call, not by the row (DEC-4) |
| **F-6** | **The planner's temperature of 0 is deliberate.** The in-code note records that 0.3 recovered only 1 run in 4, and that the plan cache relies on a stable plan for the same question | `Planner.ts:451-474` | The planner's temperature is locked (DEC-5) |
| **F-7** | **All four onboarding extractors send no temperature**, so the provider default applies | `OnboardingConversationManager.ts:1065-1072`, `:1111-1118`, `:1219-1226`, `:1536-1543`; SA V-2 | The settings must be able to say "not set". Seeding them with a number would change behaviour (FR-4) |
| **F-8** | **The embedding model is shared with the help bot** (`helpbot_embedding_model`), and stored vectors (plan cache, verified questions) depend on it. Changing it silently makes stored vectors incomparable | `EmbeddingService.ts:110-115` | Embeddings are excluded from area settings (DEC-3) |
| **F-9** | **A model with no price records $0 of spend.** Token models are priced by `calculateCostSync(provider, model, …)` from `ai_model_pricing` with a code fallback (`lib/ai/pricing.ts`), which has no Groq entries. `pricing.ts` already exports `hasPricing(provider, model)`, which loads the database prices into the same module cache. Images are priced from `image_generation_prices_usd`, then `IMAGE_FALLBACK_PRICING`, which lists only `gpt-image-1`; `quality: 'auto'` is priced after the call by the reported quality, or at `high` if none is reported | `pricing.ts:42-114`, `:166-190`, `:235-259`, `:280-283`; `SystemConfigRepository.ts:68-78`; `GeneratedImageService.ts:66-113`, `:343-357`; SA V-6, V-7 | A model is accepted only if it is fully priced (DEC-7). This keeps standard #2 intact |
| **F-10** | **A provider can be selectable but not usable.** `isProviderAvailable` does not know Groq, and a provider with no API key throws on first use | `providerFactory.ts:231-242`, `:192-210` | Not reachable in Layer 2, because only OpenAI is allowed (DEC-4). Handling is deferred with the first non-OpenAI provider (RC-8) |
| **F-11** | **Existing config readers cache for 5 minutes,** and one of them (`SystemConfigService`) is deprecated in favour of `SystemConfigRepository` | `SystemConfigService.ts:15-62`; `modelResolver.ts:36`; `InsightsConfigService.ts:132` | The new reader goes through the repository and uses a shorter window (DEC-8) |
| **F-12** | **Intake saves the model name onto the draft** it generated (`generated_from.model = MODEL`) | `IntakeGenerationService.ts:204` | It must save the model that actually ran (FR-13) |
| **F-13** | **Two live chat paths sit outside the catalog.** Chat v2 (`AIDataLayerService`, `gpt-4o` or env `OPENAI_CHAT_MODEL`) is live for owners through a "V2 / V4" toggle in the chat header. Chat v1 (`/api/business-os/chat` → `IntentParser`) has no UI caller, but any signed-in user can still POST to it | `ChatCommandPanel.tsx:670`, `:1157`, `:1247`, `:1591-1612`; `AIDataLayerService.ts:896`, `:1244`; SA V-4 | If "chat off" gated only the catalogued chat route, spend would continue through v1 and v2. The chat-area switch gates the entry of all three (RC-6, FR-12) |
| **F-14** | **`full_site` has three callers:** the onboarding build, the website page's "generate from profile", and chat's mutate executor. **`landing_page` is a separate route**, not the `full_site` generator | `onboarding/build/route.ts:899`, `app/business-os/website/page.tsx:1804`, `MutateExecutor.ts:808-821`; `app/api/website/landing-pages/generate/route.ts:106-193`; SA V-1, V-5 | Each caller's "off" behaviour is defined separately ([What "Off" Means](#what-off-means-per-area)) |
| **F-15** | **The `system_settings_config` RLS policies are not in the repo.** A `'use client'` module reads the table with the anon-key client, so some SELECT policy is open. Whether anon or authenticated users can write is unknown, and an open write policy would bypass any route fix | `lib/design-system-v2/theme-provider.tsx:61-65`; SA V-9 | A live RLS check is part of Step 0 (FR-1) |
| **F-16** | **Reasoning-model families reject sampling parameters.** `openaiProvider` already renames `max_tokens` for `gpt-5*`, `gpt-4.1*`, `o3*`, `o4*` but passes `temperature` and `frequency_penalty` through, which those models reject with a 400 that is not a model-not-found error | `openaiProvider.ts:134-160`; SA V-13 | A code-owned family test decides what is sent (FR-7, RC-11) |

---

## Current Settings Inventory

These are today's values (verified by SA, V-1 to V-3), and they become the **code defaults** and the **seed** (subject to F-3). "Stored key" means the value may already be overridden in the database.

| Area | Call | Provider | Model today | Temperature today | Source today | Today's fallback when the call fails |
|---|---|---|---|---|---|---|
| chat | `planner` | openai | `gpt-4o-mini` | **0 (locked, DEC-5)** | stored key `bizchat_planner_model` | "I couldn't understand" reply |
| chat | `analysis` | openai | `gpt-4o-mini` | 0 | stored keys `bizchat_analysis_model`, `bizchat_analysis_enabled` (default on) | keeps the planner's sentence |
| chat | 4 embedding calls | openai | `text-embedding-3-small` | — | shared key `helpbot_embedding_model` | — **excluded, DEC-3** |
| insights | `insight_content` | openai | `gpt-4o-mini` | 0.3 | literal, `InsightRepository.ts:727` | translated templates |
| insights | `correlated_insight` | openai | `gpt-4o-mini` | 0.4 | literal, `:1742` | translated templates |
| insights | `health_summary` | openai | `gpt-4o-mini` | 0.5 | literal, `:2130` | translated templates |
| briefing | `daily_narration` | openai | `gpt-4o-mini` | 0.3 | `OPENAI_MODELS.GPT_4O_MINI`, `BriefingNarrator.ts:114` | deterministic composer |
| website | `full_site` | openai | `gpt-4o` | 0.7 | literal, `WebsiteGenerationService.ts:560` (three callers, F-14) | generic starter copy, marked `fallback` |
| website | `landing_page` | openai | `gpt-4o` | 0.7 | literals, `app/api/website/landing-pages/generate/route.ts:116`, `:127` (separate route; JSON mode; direct `ProviderFactory.getProvider('openai').chatCompletion`) | `getDefaultContent()` with `success: true` and a `warning` |
| website | `field_regenerate` | openai | `gpt-4o-mini` | 0.7 | literal, `WebsiteAIContentService.ts:316` | **none**: request fails |
| website | `testimonial_enhance` | openai | `gpt-4o-mini` | 0.5 | literal, `:361` | **none**: request fails |
| website | `hero_content`, `about_content`, `faq_content`, `features_content` | openai | `gpt-4o-mini` | 0.7 | literals, `:401`, `:450`, `:588`, `:650` (dormant paths, Layer 1 KI-1 / KI-3) | per-block templates |
| intake | `form_generation` | openai | `gpt-4o` | 0.3 | literal `MODEL`, `IntakeGenerationService.ts:57` | three generic questions |
| intake | `question_inference` | openai | `gpt-4o-mini` | 0.2 | literal, `infer-question/route.ts:135` | the owner's own words as a free-text question |
| leads | `reply_recommendation` | openai | `gpt-4o-mini` | 0.2 | stored keys `lead_reply_recommender_model`, `_enabled` (default on) | deterministic ladder |
| onboarding | `business_story_extraction`, `client_workflow_extraction` | openai | `gpt-4o` | **not set** | literals (Layer 1.5 KI-C), `OnboardingConversationManager.ts:1065-1072`, `:1111-1118` | default extraction |
| onboarding | `client_tracking_extraction` (unreachable), `adjustment_intent_extraction` | openai | `gpt-4o` | **not set** | literals, `OnboardingConversationManager.ts:1219-1226`, `:1536-1543` | default; adjustment defaults to **"confirm"** |
| images | `image_generation` | openai | `gpt-image-1` | — | stored key `image_generation_model`; code default `IMAGE_GENERATION_CONFIG_DEFAULTS.model` (moves into / is referenced from the policy module, RC-12) | owner told it failed |
| *(not catalogued — gate only)* | chat v2 `AIDataLayerService` | openai | `gpt-4o` or env `OPENAI_CHAT_MODEL` | — | literal / env | Entry gated by the chat area's `enabled` (RC-6). No settings wired into its model |
| *(not catalogued — gate only)* | chat v1 `IntentParser` | openai | `gpt-4o-mini` | 0.1 | literal | Entry gated by the chat area's `enabled` (RC-6). Not in the catalog (Layer 1 exclusion) — DEC-11 |

---

## Decisions (BA, SA-approved)

These are the technical decisions made by the BA under the user's standing rule, each with its rationale. SA approved all twelve on 2026-09-19; the SA changes are merged into the text below and referenced by RC number.

| # | Decision | Rationale |
|---|---|---|
| **DEC-1** | **Granularity: one row per area, with area-level values plus optional per-call overrides inside the same JSON.** A call's setting resolves field by field: **call override → area value → code default**. | F-2: a single value per area cannot reproduce today, so it would change behaviour. Per-call-only rows would repeat the same model 8 times in the website row. Area values plus sparse overrides reproduce today with the fewest entries, and "switch the whole area" stays one edit |
| **DEC-2** | **Row shape and keys.** Keys are `bos_llm_area_<area>` (for example `bos_llm_area_insights`), in category `business_os_llm`. The value is an object: `enabled`, `provider`, `model`, `temperature`, and an optional `calls` map keyed by catalog call name, where each entry may set `provider`, `model`, `temperature`, and `enabled` (only where DEC-5 allows). A Zod schema validates it. **(RC-3)** A field that is **absent** inherits from the next level. `temperature: null` means **send no temperature**. Unknown top-level fields are ignored with a warn log. The resolver reads the eight rows by their fixed keys (`getByKeys`), **never by category**, because a category is editable. | Area and call names come from `callCatalog.ts`, which is already the one source of these names. The `bos_llm_` prefix avoids confusion with the unrelated agents-side `insights_*` keys (`InsightsConfigService`). Absent vs `null` lets an operator remove a code-default temperature (needed for FR-7's reasoning-model rule) |
| **DEC-3** | **Embeddings are not in the area settings.** The four chat embedding calls keep the shared `helpbot_embedding_model` key and cannot be switched off on their own. Chat's area switch still stops them because the gate runs at **chat route entry**, before any embedding call (RC-6). | F-8: changing the embedding model is a data migration (re-embedding stored vectors), not a setting |
| **DEC-4** | **Each call's allowed providers are a code-owned list.** A row may choose only from that list. Layer 2 ships every call with **OpenAI only** allowed; `provider` stays in the schema, validated against `['openai']`. Adding a provider to a call's list is a later, code-reviewed change, made only after a test proves the provider serves that call's features (JSON mode, tools, penalties). **Consequence (RC-8):** Layer 2 does not handle "provider has no API key" (former FR-9) and does not move call sites off the `complete()` helper; both go to the layer that first allows a non-OpenAI provider. | F-4, F-5, F-10: a provider that silently drops `tool_choice` or JSON mode breaks the feature without an error. With OpenAI only, `complete()` already honours model and temperature, so moving off it is risk without benefit |
| **DEC-5** | **Some settings are locked in code and ignored if a row sets them (with a warning):**<br>- **onboarding** cannot be switched off (area or call) — confirmed by the user (BQ-1);<br>- **chat `planner`** cannot be switched off on its own, and its temperature is locked at 0;<br>- **chat `analysis`**, **leads**, **insights**, **briefing**, **intake**, **website** and **images** can be switched off. | Onboarding is how a business gets set up. With it off, the adjustment extractor would read every change request as "confirm" (inventory), which is a silent wrong outcome. Planner: F-6 |
| **DEC-6** | **Seeding copies what is stored, then the old keys stop being read.** For each field, the migration takes the existing single-purpose key's stored value if one is present (F-3), otherwise the code default. **(RC-4)** The seed SQL unwraps JSON-encoded strings (`'"gpt-4o-mini"'`) and string booleans (`'true'`). **Apply order:** Step 0 deployed → pre-apply check that no `bos_llm_area_*` row exists yet (a row planted through today's open PUT/POST would survive `ON CONFLICT DO NOTHING`) → seed migration applied → only then the code that reads the rows is deployed. After that, code reads only the area rows. The old keys stay in place, with their description marked "superseded by `bos_llm_area_*`", and are deleted in a later clean-up. | Zero behaviour change on deploy, including any production override nobody remembers setting. Deploying the reader before the seed would replace F-3 overrides with code defaults in that window. Keeping the old rows makes rollback a code revert only |
| **DEC-7** | **Guardrails: a value outside the rules is ignored field by field, and that field falls back to the next level.**<br>- The provider must be on the call's allowed list (DEC-4).<br>- **(RC-5)** A token model must pass `hasPricing(provider, model)` from `lib/ai/pricing.ts` (never a copy of its lookup), evaluated when the settings cache refills, never on every call. An image model is accepted only if **every configured size** has a price at `low`, `medium` **and** `high` (config or `IMAGE_FALLBACK_PRICING`).<br>- **(RC-2)** The temperature must be not set, `null`, or a number from **0 to 1**, for every call. The planner is locked at 0 (DEC-5).<br>- **(RC-11)** Reasoning-model rules: see FR-7.<br>- `enabled` must be a boolean.<br>An ignored field is logged at error level, with area, call, field and reason. | Cost tracking (standard #2) must never go to $0 because of a setting (F-9); `quality: 'auto'` makes any unpriced size/quality combination a $0 row. The upper limit of 1 is the common range across our providers (Anthropic's maximum is 1). No call today exceeds 0.7, and analysis is seeded at 0 |
| **DEC-8** | **Caching: settings are read at most once a minute per server instance, all eight rows in one query.** A "row missing" result is cached too. A failed read keeps serving the last good settings (or the defaults if there are none) and is retried after **10 seconds**. | An off-switch used in an emergency (a cost runaway, a bad model) should take effect in about a minute. The existing 5-minute windows (F-11) are too slow for that. One query a minute per instance costs nothing measurable |
| **DEC-9** | **A model the provider rejects is retried once with the code default. (RC-7)** The retry wraps the provider call **inside** the `runAiAction` scope, never around the service or route, so there is one audit entry. It fires only when the resolved model differs from the code default, and only on an OpenAI model-not-found / not-permitted error, recognised by a code-owned classifier over `error.code` / status. No other error is retried. The rejected `provider:model` is negatively cached per instance for the settings window, so later calls go straight to the default. An error log names area, call and the rejected model. | A priced model can still be unavailable to our API key, and without the retry that would be a Business OS outage caused by a setting. Retrying other errors would double cost and hide real failures. Inside the scope, the failed attempt writes a 0-token ledger row, the audit entry shows `callCount 2`, `failedCallCount 1` and both models, and the outcome stays "succeeded" (SA V-8) |
| **DEC-10** | **Change tracking in this layer (no admin UI):**<br>1. Rows change only through a committed migration or the checked-in change script. **(RC-9)** The script writes through `SystemConfigRepository.set` after the same Zod schema and guardrails the resolver uses, so a row the resolver would reject cannot be written. Until the admin-screen layer, the generic `PUT`/`POST /api/admin/system-config` **refuses** `bos_llm_area_*` keys with 400.<br>2. When an instance first sees a changed row, it logs at info: area, what changed (enabled / provider / model / temperature, old → new), and the row's `updated_at`.<br>3. Every AI audit entry already records the models an action used (Layer 3 FR-4).<br>A database-level change history arrives with the admin screen layer, where each save writes an audit entry with the admin as actor. | Values here are platform labels, not owner data, so logging them is safe. A database trigger writing to `audit_trail` would be a new pattern for this table (CLAUDE.md rule 7), and it is not needed until there is a screen |
| **DEC-11** | **The chat v1 `IntentParser` is not wired to settings.** It is excluded from the catalog (Layer 1), records no grouping id, and is listed in `BOS_KNOWN_NON_CATALOG_COMPONENTS`. **(RC-1e)** It does not import `callCatalog`, so it is outside the FR-15 check's scope and needs no exemption. **(RC-6)** Its route entry is still gated by the chat area's `enabled`, as is chat v2. | Wiring settings into a component outside the catalog would make it look supported; gating its entry keeps "chat off" honest |
| **DEC-12** | **Step 0: close the settings and pricing routes before any Layer 2 row exists (RC-10; user approved as BQ-2).** Detailed in FR-1: `system-config` GET/PUT admin-gated and POST deleted or gated; `pricing` and `pricing/sync` admin-gated; live RLS check with a policy-drop migration if needed; Zod, Pino, no error leaks. The admin check uses `AdminAccessService` (never `profiles.role`). | F-1, F-15. Follows Layer 3's precedent (its D-5: secure the audit routes first, inside the layer). An anonymous price insert or delete would defeat DEC-7 and zero cost tracking today |

---

## What "Off" Means, Per Area

The owner's experience when an area (or a switchable call) is off. No AI call is made, so there is no ledger row and no AI audit entry (Layer 3 FR-7). An info log records `area`, `call` and reason `disabled`. **The rows marked ★ show the owner something new; the user approved them as written on 2026-09-19 (BQ-1).**

| Area / call | When off, the owner… | Mechanism |
|---|---|---|
| chat (whole area) ★ | sees a short, translated message in the chat: *"The assistant is unavailable right now. Please try again later."* Nothing else on the dashboard changes. This applies whichever chat version is used (v4, v2 via the header toggle, or a direct call to v1) | New message path at the entry of the chat route, `/api/business-os/chat-v2` and `/api/business-os/chat` (RC-6). No planner, analysis, embedding, `AIDataLayerService` or `IntentParser` call runs |
| chat `analysis` | sees nothing different. The answer uses the planner's own sentence | Already exists (`bizchat_analysis_enabled`) |
| insights | still gets insights, worded from translated templates instead of personalised prose | Existing fallback |
| briefing | still gets the daily briefing, in plainer wording | Existing deterministic composer |
| website: `full_site` ★ | **during onboarding:** gets a site built with generic starter copy that they can edit (the build is not blocked). **From the website page ("generate from profile") and from chat's mutate path:** sees *"AI writing is unavailable right now"* and no page is overwritten (RC-1f) | Existing fallback during the build. New message for the other two callers |
| website: `landing_page` | gets the default landing-page content, as today when the call fails (no new message) | Existing `getDefaultContent()` path (RC-8) |
| website: `field_regenerate`, `testimonial_enhance` ★ | sees *"AI writing is unavailable right now"* next to the button. Their text is unchanged | New message. Today these calls have no fallback and return a generic error |
| website: block content (dormant) | gets the per-block templates | Existing fallback |
| intake: `form_generation` | gets a short starter form (three generic questions) to edit | Existing fallback |
| intake: `question_inference` | gets their own words added as a free-text question | Existing fallback |
| leads | still gets a reply suggestion, chosen by the fixed rules instead of the AI | Existing (`disabled` reason) |
| images ★ | sees *"Image generation is unavailable right now"*. Stock photos are unaffected | New message |
| onboarding | cannot be switched off (DEC-5; confirmed by the user, BQ-1) | — |

---

## User Stories

- As a **platform operator**, I want to change the model or temperature of any Business OS AI call by changing a setting, not by shipping code, so that I can compare models, react to price changes and move off deprecated models quickly.
- As a **platform operator**, I want to switch an area's AI off in about a minute, so that I can stop a cost runaway or a misbehaving model without a deploy.
- As a **platform operator**, I want a bad or missing setting to fall back to today's behaviour, so that a configuration mistake never takes Business OS down.
- As a **platform operator**, I want only fully priced models to be accepted, so that AI cost tracking stays complete whatever is configured.
- As a **business owner**, I want Business OS to keep working when an AI feature is switched off, with plainer results or a clear message, never a broken screen.
- As a **business owner**, I want nobody outside the platform team to be able to change how my AI features behave or what they cost.

---

## Functional Requirements

### (0) Step 0 — secure the settings and pricing routes (DEC-12, RC-10; in scope per BQ-2, ships first)

1. **FR-1 — Admin-only settings and pricing routes.**
   - **`/api/admin/system-config`:** `GET` and `PUT` return 401 without a session and 403 for a non-admin, using the inline check precedent (`getUser()` → `AdminAccessService.getInstance().isAdmin({ id, email })`, as in `app/api/admin/business-os/llm-usage/route.ts:49-64`). Never `profiles.role`. The uncalled `POST` is **deleted**, or gated the same way (Dev proposes in the workplan, SA confirms).
   - The route moves to `SystemConfigRepository`, off the deprecated `SystemConfigService`.
   - Zod validates the body as `{ updates: Record<string, unknown> }` (non-empty keys, bounded count), so the admin page's mixed-type billing save keeps working. `PUT` / `POST` refuse any `bos_llm_area_*` key with 400 (DEC-10).
   - No `error.message` reaches the client outside development.
   - Its 7 `console.*` calls become Pino with a `correlationId`.
   - **`/api/admin/system-config/pricing`** (GET/PUT/POST/DELETE) and **`pricing/sync`** (POST) get the same admin gate and error handling; `pricing`'s 12 `console.*` calls become Pino. Moving `ai_model_pricing` access into a repository is a tracked follow-up, not Step 0.
   - **Live RLS check,** recorded in the workplan: `pg_policies` for `system_settings_config` and `ai_model_pricing`. SELECT for anon/authenticated is acceptable (labels only). Any INSERT/UPDATE/DELETE policy for anon/authenticated is dropped in a Step 0 migration.
   - The only UI caller, `app/admin/system-config/page.tsx`, keeps loading and saving for platform admins.
   - **Step 0 is merged and deployed before the seed migration is applied** (DEC-6 apply order).

### (a) The settings

2. **FR-2 — One row per area.** The eight areas in `BOS_LLM_AREAS` each have one `system_settings_config` row, keyed and shaped as DEC-2 describes.
   - A `calls` entry whose name is not a catalog call of that area is ignored and logged at warn. Unknown top-level fields are ignored with a warn log.
   - Adding an area to the catalog requires adding its row, its code defaults and its call policy. The standards skill's "new area" checklist gains this item.
3. **FR-3 — Code defaults and call policy.** One server-only module under `lib/business-os/llm/` holds, for every catalog call:
   - its **code default** (the [inventory](#current-settings-inventory) value), including the image model (`IMAGE_GENERATION_CONFIG_DEFAULTS.model` moves into, or is referenced from, this module — RC-12);
   - whether it can be switched off (DEC-5);
   - its allowed providers (DEC-4: `['openai']` for every call in Layer 2);
   - its temperature bounds (DEC-7), and whether temperature is locked.

   It is the **only** place in Business OS catalogued call-site code where a model name or temperature is written (FR-15). It is typed against the catalog, so a catalog call with no default **fails the `typecheck:bos-llm` gate** (RC-1d; `next build` ignores type errors).
4. **FR-4 — "Not set" temperature.** A temperature may be not set. The call then sends no temperature and the provider default applies, as all four onboarding extractors do today (F-7). In a row, an absent `temperature` inherits from the next level and `temperature: null` means "send none" (DEC-2). The seed records "not set" for the four extractors.
5. **FR-5 — Resolution.** Every catalog call except embeddings (DEC-3) gets `{ enabled, provider, model, temperature }` from one resolver, field by field in the order call override → area value → code default.
   - The resolver **never throws**. With the cache warm it adds no latency.
   - It reads the eight rows by fixed key through one `SystemConfigRepository` `getByKeys` query (following `getImageGenerationConfig`), never by category, never through `supabaseServer` directly and never through the deprecated `SystemConfigService`.
6. **FR-6 — Fallback: behave like today.**
   - A **missing** row → the code defaults, logged at debug.
   - A row that is **not a valid object** → the code defaults for the whole area, logged at error.
   - A **single invalid field** → only that field falls back (DEC-7).
   - **Database unreachable** → the last good settings for that instance, or the code defaults, logged at warn.
   - In no case does a configuration problem fail or block an AI call or an owner action.

### (b) Guardrails and caching

7. **FR-7 — Guardrails.** DEC-7 applies to every field at every level. A rejected field is logged at error with area, call, field and reason. The rejected value is logged only if it is a platform label (a model or provider name), which it always is here.
   - **Price check (RC-5):** token models via `hasPricing(provider, model)`, evaluated on cache refill; image models need a price for every configured size at `low`, `medium` and `high`.
   - **Reasoning models (RC-11):** one exported, code-owned family test next to `usesMaxCompletionTokens` decides whether a model "rejects sampling parameters". For such a model, a resolved temperature is **not sent** (warn log). A call that sends a locked temperature or `frequency_penalty` (the planner) **rejects** such a model as a field, and the model falls back per DEC-7, because that 400 is not covered by DEC-9.
8. **FR-8 — Locked settings.** DEC-5 locks are applied after resolution. A row that tries to switch off onboarding or the planner, or to change the planner's temperature, is ignored for that field and logged at warn.
9. **FR-9 — Unavailable provider.** **Deferred (RC-8)** to the layer that first allows a non-OpenAI provider. With OpenAI the only allowed provider, a row cannot select an unconfigured provider. Number kept for traceability.
10. **FR-10 — Caching window.** DEC-8: a change takes effect on each instance within **60 seconds**. Tests can clear the cache.
11. **FR-11 — Model rejected by the provider.** DEC-9 as amended by RC-7: one retry with the code default, inside the `runAiAction` scope, only when the resolved model differs from the default and only on a classified OpenAI model-not-found / not-permitted error; the rejected `provider:model` is negatively cached for the settings window.

### (c) Call sites

12. **FR-12 — Every catalog call uses the resolved settings.** This covers every call in the [inventory](#current-settings-inventory) except the embeddings and the two non-catalogued chat paths.
    - Each call takes its model, provider and temperature from the resolver, and checks `enabled` before calling.
    - Call sites keep their current provider-call mechanism (including the `complete()` helper for website, intake and onboarding, and `landing_page`'s direct `chatCompletion`). Moving off `complete()` is deferred (RC-8).
    - Only the model and temperature change. Prompts, `max_tokens`, `frequency_penalty`, JSON mode and tools stay exactly as they are.
    - **Chat gates (RC-6):** the chat area's `enabled` is also checked at the entry of `/api/business-os/chat-v2` (`AIDataLayerService`) and `/api/business-os/chat` (v1, `IntentParser`), returning the same unavailable message. This is a gate only; no settings are wired into their models.
13. **FR-13 — Record the model that actually ran.** Intake's saved `generated_from.model` (F-12), and any other stored or returned "model used" value (for example the planner's `diagnostics.model`), carry the resolved model (or the retry's default model, FR-11). The ledger and Layer 3 audit entries already record the model sent to the provider, and this must stay true.
14. **FR-14 — Off behaves as in the table.** When a call resolves to `enabled: false`, it makes no provider call and follows [What "Off" Means](#what-off-means-per-area), including `full_site`'s three callers and `landing_page`'s existing default content. The new owner-facing messages exist in English, Hebrew and Spanish.
    - **Images:** the image model moves from `image_generation_model` into the images area row (seeded per DEC-6). Sizes, quality and prices stay in their existing keys. Moving off the deprecated `gpt-image-1` is then a settings change, allowed only once the new model is priced for every size at every quality (DEC-7).
15. **FR-15 — No hardcoded model names or temperatures in Business OS call sites (RC-12).**
    - A sibling script (for example `scripts/check-bos-llm-literals.ts`) runs as a second step in the existing `bos-llm-typecheck.yml` job; no new workflow.
    - Scope: non-test files that import `callCatalog`. It fails on quoted model literals (for example `gpt-`, `claude-`, `o3`, `kimi-`, `text-embedding-`, `gpt-image-`), `OPENAI_MODELS.*`, and numeric `temperature:` literals.
    - Exemptions are **named files with a reason**, never a directory: the FR-3 policy module, and the operator script `scripts/bos-llm-settings.ts` (its P-5b `verify-equivalence` mode exists to compare the superseded keys and their legacy defaults with the area rows). `IntentParser.ts` does not import the catalog, so it is out of scope and needs no exemption (RC-1e).
    - The check lands once the last literal is gone (Delivery Step 4).

### (d) Seeding, change tracking, documentation

16. **FR-16 — Seed migration, zero behaviour change.**
    - One migration inserts the eight rows per DEC-6, unwrapping JSON-encoded strings and string booleans from the F-3 keys, and never overwrites a row that already exists.
    - **Apply order (RC-4):** Step 0 deployed → pre-apply check confirms no `bos_llm_area_*` row exists → seed applied → the reading code deployed. The workplan records each step.
    - The workplan records, before and after deploy, the resolved settings for every call, and they must be identical to the [inventory](#current-settings-inventory) (or to the stored key's value where F-3 applies).
    - The old single-purpose keys are marked superseded, not deleted.
17. **FR-17 — Change tracking.** DEC-10, including the RC-9 change script (repository write after schema + guardrail validation) and the generic routes' refusal of `bos_llm_area_*` keys. Nothing that logs a setting change may log prompt or owner content.
18. **FR-18 — Documentation.**
    - The `bos-llm-call-standards` skill gains a "Model settings" standard: the resolver, the policy module, the new-area checklist item and the FR-15 check. The KI-C exception is removed from its Standard 4.
    - The investigation doc and the Layer 1 roadmap record Layer 2, and Layer 1.5 KI-C is marked closed.
    - A short runbook explains how an operator changes a setting (via migration or the change script) and how to switch an area off in an emergency.
    - Each changed doc gets a Change History row.

---

## Non-Functional Requirements

- **Reliability:** configuration can never cause an outage (FR-6, FR-7, FR-11). The worst case is today's behaviour.
- **Performance:** at most one settings query per instance per minute. Price checks run on cache refill only. A warm cache adds no measurable latency to a call.
- **Security:** only platform admins can write settings or prices (FR-1). No anon/authenticated INSERT/UPDATE/DELETE policy remains on `system_settings_config` or `ai_model_pricing` (FR-1 live RLS check). The settings rows hold no secrets and no owner data.
- **Cost integrity:** every model that can be configured is fully priced (DEC-7). The ledger and audit entries record the model that actually ran (FR-13).
- **Repository pattern:** all reads and the change script's writes go through `SystemConfigRepository`; the migration is the only other writer. `ai_model_pricing` repository work is a tracked follow-up.
- **Logging:** Pino only, with correlation ids on request paths, and no prompts or owner text (skill Standard 5). Touched files that still use `console.*` are flagged and converted per CLAUDE.md.
- **Type safety:** the policy module and resolver live under `lib/business-os/llm/`, inside the `typecheck:bos-llm` gate, with 0 new diagnostics and the baseline unchanged. The resolver is server-only, and no `'use client'` module may import it (the PR #53 lesson).
- **Pattern precedents (SA-1, rule 7 signed off):** the repository read of `getImageGenerationConfig`, the cache/fallback shape of `effort-estimator/modelResolver.ts`, the JSON-per-section shape of `InsightsConfigService`. Do **not** mirror `AgentGenerationConfigService`.
- **Testability:** the resolver, guardrails, locks, cache, retry and off paths are testable with the repository and provider mocked.

---

## Acceptance Criteria

**Step 0**
- [ ] **AC-1** (FR-1):
  - `GET` and `PUT /api/admin/system-config` return 401 without a session and 403 for a signed-in non-admin, and write nothing. A platform admin can read and write. An invalid body returns 400. A `bos_llm_area_*` key in `PUT` returns 400.
  - `POST /api/admin/system-config` is deleted (404/405) or gated identically.
  - `pricing` (GET/PUT/POST/DELETE) and `pricing/sync` (POST) return 401 / 403 the same way, and work for an admin.
  - No `error.message` reaches the client outside development. No `console.*` remains in the three touched route files.
  - The admin settings page still loads and saves (including the billing save) and runs pricing sync.
  - The live RLS check for both tables is recorded in the workplan, and any anon/authenticated write policy is dropped by a Step 0 migration.
  - The Step 0 deploy precedes the seed migration (both recorded in the workplan).

**Settings and fallback (unit tests, repository and provider mocked)**
- [ ] **AC-2** (FR-5, FR-16): with the seeded rows, the request sent to the provider by **every** in-scope call (model, provider, temperature or its absence) is identical to the request it sent before this layer. A parameter snapshot is taken per call before and after.
- [ ] **AC-3** (FR-2, FR-4, FR-5): precedence. A call override beats the area value, which beats the code default, field by field. An absent field inherits; `temperature: null` sends no temperature. A `calls` entry for an unknown call name, and an unknown top-level field, are ignored with a warning. The rows are read by fixed key, not by category.
- [ ] **AC-4** (FR-6): a missing row gives the code defaults. A non-object row gives the code defaults plus an error log. One invalid field falls back alone. A repository error gives the last good settings, or the defaults if there are none. The resolver never throws in any of these cases.
- [ ] **AC-5** (FR-7): each of these is ignored for its field only, with an error log naming area, call, field and reason:
  - a token model for which `hasPricing` is false;
  - an image model missing a price for any configured size at `low`, `medium` or `high`;
  - a provider other than `openai`;
  - a temperature of 1.5 or -0.1;
  - a non-boolean `enabled`.

  A temperature of 0 is accepted for `analysis` (and any call).
- [ ] **AC-6** (FR-8): `enabled: false` on onboarding, or on the planner alone, and a planner temperature of 0.5 are each ignored with a warning. The call runs with the locked value.
- [ ] **AC-7** (FR-10): with a fake clock, a changed row is not used at 59 seconds and is used after 60. A failed read is retried after 10 seconds, not on every call.
- [ ] **AC-8** (FR-11): a provider "model not found" error on a non-default model causes exactly one retry with the code default and an error log, producing **one** audit entry with `failedCallCount: 1`, both models listed, outcome `succeeded`, and a 0-token failed ledger row. The next call within the settings window goes straight to the default (negative cache). The same error on the default model, or a timeout / rate-limit error, causes no retry.
- [ ] **AC-15** (FR-7, RC-11): for a model the family test marks as rejecting sampling parameters, a resolved temperature is not sent (warn log); the same model configured for the planner is rejected as a field and the planner runs on its default.

**Off behaviour (unit or integration tests, one per area)**
- [ ] **AC-9** (FR-12, FR-14): for each switchable area and call, `enabled: false` means no provider call, no ledger row, no AI audit entry, and the owner-visible result given in [What "Off" Means](#what-off-means-per-area), in English, Hebrew and Spanish where a message is shown. Specifically: chat off also blocks `/api/business-os/chat-v2` and `/api/business-os/chat` at entry with the same message; `full_site` off lets the onboarding build finish with starter copy but shows the unavailable message (no overwrite) from the website page and chat's mutate path; `landing_page` off returns the default content.

**Recording, change tracking and code hygiene**
- [ ] **AC-10** (FR-13): with the insights area model set to a different priced model in a test database, `token_usage.model_name` and the Layer 3 audit entry's model list show that model. Intake's saved `generated_from.model` shows the model that ran.
- [ ] **AC-11** (FR-15): the literal-check script passes on the branch and fails on a planted `model: 'gpt-4o'` or `temperature: 0.5` in a file that imports `callCatalog`. Its exemptions are **named files, each with a reason and printed by `--list`** — two as shipped: the FR-3 policy module, and `scripts/bos-llm-settings.ts`, whose `verify-equivalence` mode must name the superseded keys and their legacy defaults (SA Step 4 finding 8; a directory exclusion was rejected). A further exemption is a code change with an SA review. It runs as a step in the existing `bos-llm-typecheck.yml` job.
- [ ] **AC-12** (NFRs): `npm run typecheck:bos-llm` shows 0 new diagnostics with the baseline unchanged. `next build` passes. No new direct Supabase call outside `lib/repositories/`. The owner usage-route snapshot is unchanged.
- [ ] **AC-16** (FR-17, RC-9): the change script refuses a row the resolver would reject (for example an unpriced model or temperature 1.5) and writes nothing; a valid row is written through `SystemConfigRepository.set`.

**Live (non-production)**
- [ ] **AC-13** (FR-16, FR-10, FR-14, FR-17): after the migration, QA checks all of the following:
  1. The pre-apply check found no `bos_llm_area_*` row, and the apply order in FR-16 was followed.
  2. The eight rows exist and match the recorded inventory (including any F-3 stored values, correctly unwrapped).
  3. One action per area behaves as before.
  4. Switch leads off with the documented script, submit an enquiry at least 60 seconds later, and see the fixed-rules suggestion with no ledger row. The instance logs the change at info.
  5. Switch leads back on and see the AI suggestion return.
- [ ] **AC-14** (FR-18): the skill, investigation doc, Layer 1 roadmap, Layer 1.5 KI-C and the runbook are updated, each with a Change History row.

---

## Delivery Order

Each step is a small PR with zero behaviour change on deploy (SA slice order, updated for the user's answers).

| Step | PR content | Behaviour on deploy |
|---|---|---|
| **0** | FR-1: gate `system-config` (GET/PUT; POST deleted or gated) + `pricing` + `pricing/sync`, repository switch, Zod, Pino, refuse `bos_llm_area_*`, live RLS check (+ policy-drop migration if needed). AC-1 | Anonymous writes stop; admin page unchanged for admins |
| **1** | Policy module (defaults, locks, allowed providers, bounds, reasoning-model family test), Zod schema, resolver + 60 s cache + guardrails (FR-4 to FR-8, FR-10) + retry helper (FR-11), `SystemConfigRepository` read method, change script (FR-17), seed migration **file**, unit tests (AC-3 to AC-8, AC-15, AC-16). After merge: pre-apply check, then seed applied | Inert: nothing calls the resolver; rows exist but are unread |
| **2** | Wire non-chat areas with existing fallbacks: insights, briefing, intake, leads, onboarding (model/temperature only; not switchable), website `landing_page` + dormant blocks, `full_site` model/temperature. Parameter snapshot per call (AC-2); FR-13 intake `generated_from.model` | Identical requests (AC-2) |
| **3** | Chat (planner, analysis; stop reading the `bizchat_*` keys) + chat v1/v2 entry gates (FR-12), images (model into area row), and the ★ "off" messages (BQ-1 approved) | Identical requests; new messages appear only when an area is switched off |
| **4** | FR-15 literal check (lands once the last literal is gone), skill / runbook / investigation / KI-C docs (FR-18) | None |

---

## Out of Scope / Future Roadmap

| Item | Why / where |
|---|---|
| The admin screen for these settings | The next layer. It also brings per-save audit entries with the admin as actor (DEC-10), and lifts the generic route's refusal of `bos_llm_area_*` keys |
| Settings per business (switch AI off for one owner only) | Not requested. The rows are platform-wide |
| Configuring embeddings | DEC-3. A model change needs a re-embedding plan |
| Configuring `max_tokens`, `frequency_penalty`, prompts, JSON mode | Behaviour, not model choice. Stays in code |
| Enabling a non-OpenAI provider for any call; "unavailable provider" handling (former FR-9); moving call sites off the `complete()` helper | DEC-4, RC-8. Added per call after a proving test, in the layer that first allows another provider |
| Wiring model settings into chat v2 (`AIDataLayerService`) or chat v1 (`IntentParser`) | Layer 2 only gates their entry on the chat area's `enabled` (FR-12, RC-6) |
| Whether the owner-visible "V2 / V4" chat toggle should stay visible | Out of scope for Layer 2. **Pending:** the user is asking Offir whether chat V2 (and V1) can be deprecated; the gate in FR-12 applies regardless of the answer |
| New image sizes or qualities for a future image model | The existing image keys and code limits still apply |
| Moving `ai_model_pricing` access into a repository (pricing routes, `lib/ai/pricing.ts` direct `createClient`, `console.*` in `pricing.ts`) | Tracked follow-up (RC-10b) |
| The five other unauthenticated admin config routes (agent-generation, memory, onboarding, orchestration, ui) | Agent-platform settings, same F-1 class; they write fixed keys only and cannot write `bos_llm_area_*` rows. Tracked follow-up |
| Public `GET /api/system-config?keys=` returns any key without auth (after Layer 2, including the area rows) | Labels only, low risk. Tracked follow-up |
| Credit deduction / billing decisions; Layer 3 OI-D audit-queue work | Parked by the user |
| Retiring chat v1 (`/api/business-os/chat`, `IntentParser`); deleting the superseded single-purpose keys | Follow-up clean-ups (DEC-11, DEC-6), subject to the Offir deprecation answer above |

---

## Open Questions

**Business questions for the user**

- [x] **BQ-1 — What the owner sees when AI is switched off** (raised by: BA | status: **resolved 2026-09-19 — APPROVED as written**). The user approved the [★ rows](#what-off-means-per-area): the unavailable message in chat; the "AI writing is unavailable" message for the website AI-writing buttons (and `full_site` outside onboarding); the "image generation is unavailable" message; the onboarding build continuing with editable starter copy. The user also confirmed that **onboarding can never be switched off** (DEC-5).
- [x] **BQ-2 — Fix the open settings door as part of this layer?** (raised by: BA | status: **resolved 2026-09-19 — YES**). Step 0 (secure `system-config` GET/PUT/POST, `pricing` and `pricing/sync`, per RC-10 / FR-1) is in Layer 2 and ships first.

**Technical items for SA** (all resolved by the SA Review, 2026-09-19)

- [x] **SA-1** — DEC-1 to DEC-12 approved (with RC-2 to RC-10 applied); CLAUDE.md rule 7 sign-off for the policy module and resolver, built from the V-14 precedents.
- [x] **SA-2** — Pricing routes share F-1 (now in Step 0). RLS is not in the repo; a live check is part of Step 0 (FR-1).
- [x] **SA-3** — Reasoning models: RC-11, applied in FR-7 / AC-15.
- [x] **SA-4** — Inventory confirmed: `landing_page` is a separate route (V-1); all four onboarding extractors send no temperature (V-2).

**Not a Layer 2 question:** chat V2 / V1 deprecation — the user is asking Offir (see [Out of Scope](#out-of-scope--future-roadmap)).

---

## Notes on Integration Points

| System | Change |
|---|---|
| `lib/business-os/llm/callCatalog.ts` | Unchanged names. The new policy module is keyed by its types (FR-3) |
| New: policy module + resolver under `lib/business-os/llm/` | Defaults, locks, allowed providers, bounds, reasoning-model family use, resolution, cache, retry helper (FR-3 to FR-11) |
| `lib/repositories/SystemConfigRepository.ts` | One `getByKeys` read method for the eight area rows (following `getImageGenerationConfig`); `set` used by the change script and the Step 0 route |
| New: checked-in change script | Validated writes of area rows (FR-17) |
| `supabase/migrations/` | Seed migration (FR-16); Step 0 RLS policy-drop migration if the live check needs one (FR-1) |
| Call sites | `Planner.ts`, `AnalysisService.ts`, `InsightRepository.ts`, `BriefingNarrator.ts`, `WebsiteGenerationService.ts`, `WebsiteAIContentService.ts`, `app/api/website/landing-pages/generate/route.ts`, `IntakeGenerationService.ts`, `app/api/intake/form/infer-question/route.ts`, `LeadReplyRecommender.ts`, `OnboardingConversationManager.ts`, `GeneratedImageService.ts` |
| "Off" surfaces | The chat route, `/api/business-os/chat-v2`, `/api/business-os/chat` (v1) entry gates; `onboarding/build/route.ts`, `app/business-os/website/page.tsx`, `MutateExecutor.ts` (`full_site` callers); the website editor buttons and image surfaces for the new messages |
| `lib/ai/openaiProvider.ts` | The exported reasoning-model family test next to `usesMaxCompletionTokens` (FR-7, RC-11) |
| `lib/ai/providerFactory.ts`, `lib/ai/pricing.ts` | Read-only use: provider selection and `hasPricing` for the guardrails. `complete()` is unchanged and still used by its current callers |
| `app/api/admin/system-config/route.ts`, `pricing/route.ts`, `pricing/sync/route.ts`; `app/admin/system-config/page.tsx` (caller, verify only) | Step 0 (FR-1) |
| `scripts/check-bos-llm-literals.ts` (name indicative), `.github/workflows/bos-llm-typecheck.yml` | FR-15 check as a second job step |
| `.claude/skills/bos-llm-call-standards/SKILL.md` | FR-18 |
| Unchanged | `token_usage`, `audit_trail`, `runAiAction`, `EmbeddingService`, the agents-side config services |

---

## SA Review

**Reviewed by SA — 2026-09-19** (requirement review, before the workplan; verified against the code in this worktree, not the doc)
**Verdict: APPROVED WITH CHANGES.** The shape is right: one JSON row per area, sparse per-call overrides, code defaults, a resolver that never throws, and a seed that copies what is stored. The required changes below fix five factual errors, close two gaps in the "off" switch and Step 0, and cut work that Layer 2 does not need.

### Verification notes (what the code shows)

| # | Topic | Finding | Evidence |
|---|---|---|---|
| V-1 | `landing_page` (*confirm*) | **Not the same generator as `full_site`.** It is a separate route: `gpt-4o`, temperature `0.7`, JSON mode, calling `ProviderFactory.getProvider('openai').chatCompletion` directly (not the `complete()` helper). On a throw or a bad parse it already returns `getDefaultContent()` with `success: true` and a `warning`, so it has an existing fallback | `app/api/website/landing-pages/generate/route.ts:106-128`, `:146-163`, `:176-193` |
| V-2 | Onboarding temperatures (*confirm*) | **All four extractors send no temperature**, not only the two the inventory marks. Seed "not set" for all four | `OnboardingConversationManager.ts:1065-1072`, `:1111-1118`, `:1219-1226`, `:1536-1543` |
| V-3 | Rest of the inventory | Matches the code: insights 0.3 / 0.4 / 0.5, briefing 0.3, website 0.7 / 0.5, intake 0.3 / 0.2, leads 0.2, **analysis 0**, planner 0. Chat reads its keys through the deprecated `SystemConfigService` with `supabaseServer`; leads reads through `systemConfigRepository`. No catalog call is missing | `grep callName:` over `lib/`, `app/` gives 21 call sites and all catalog names |
| V-4 | Live BOS LLM calls outside the catalog | **Chat v2 (`AIDataLayerService`, `gpt-4o` or env `OPENAI_CHAT_MODEL`) is live for owners.** A "V2 / V4" toggle in the chat header switches to it. Chat v1 (`/api/business-os/chat` → `IntentParser`) has **no UI caller**, but any signed-in user can still POST to it. If "chat off" gates only chat-v4, spend continues through both | `ChatCommandPanel.tsx:670`, `:1157`, `:1247`, `:1591-1612`; `AIDataLayerService.ts:896`, `:1244` |
| V-5 | `full_site` callers | **Three callers**, not two: the onboarding build, the website page's "generate from profile", and chat's mutate executor | `onboarding/build/route.ts:899`, `app/business-os/website/page.tsx:1804`, `MutateExecutor.ts:808-821` |
| V-6 | Pricing guardrail | **Enforceable.** Providers price with `calculateCostSync(provider, params.model, …)`, keyed on the exact `provider:model` string sent. `lib/ai/pricing.ts` already exports `hasPricing(provider, model)`. It loads `ai_model_pricing` into the same module cache, then falls back to `FALLBACK_PRICING`. Once `hasPricing` has run on an instance, the sync path on that instance sees the same prices. Caveat: `calculateCostSync` never loads the database itself, so the guardrail **must** call `hasPricing`, not a copy of the lookup | `openaiProvider.ts:179`, `:491-498`; `pricing.ts:166-190`, `:235-259`, `:280-283` |
| V-7 | Images price coverage | `quality: 'auto'` is priced **after** the call by the quality the provider reports, and at `high` when none is reported. "At least one price entry for the model" is too weak: every other size/quality combination would record $0 | `GeneratedImageService.ts:66-113`, `:343-357` |
| V-8 | Retry vs attribution/audit (DEC-9) | **Safe if the retry sits inside the provider-call closure.** A failed call writes a ledger row with 0 tokens and `errorCode = error.code`, so no tokens are counted twice. Every catalog call that has an audit scope wraps it at route level (`runAiAction` → `withUsageScope`). A call-level retry therefore gives one audit entry with `callCount 2`, `failedCallCount 1`, both models, and outcome `succeeded` (last attempt per call name wins). A retry placed **outside** `runAiAction` would write two audit entries | `baseProvider.ts:139-151`; `aiActionAudit.ts:165-176`, `:267-290` |
| V-9 | `system_settings_config` RLS | **Cannot be verified from the repo.** Neither the table's DDL nor its policies are in `supabase/migrations` (only seeds use it). A `'use client'` module reads it with the browser (anon-key) client, so some SELECT policy is open (`lib/design-system-v2/theme-provider.tsx:61-65`). Whether anon or authenticated users can INSERT, UPDATE or DELETE is unknown. The anon key ships in the browser bundle, so an open write policy would bypass any route fix | `supabase/migrations/20260212_agent_generation_config.sql`, `20260629_seed_memory_config_defaults.sql` |
| V-10 | Step 0 routes | `system-config/route.ts` has **GET, PUT and POST**. None has auth, all write with the service role and return `error.message` to the client, and the file has **7** `console.*` calls. PUT can also **create** keys (`SystemConfigService.set` updates, else inserts). `pricing/route.ts` (GET/PUT/POST/DELETE, **12** `console.*`, direct Supabase to `ai_model_pricing`) and `pricing/sync/route.ts` (POST, 0 `console.*`) have the same gap. The only UI caller is `app/admin/system-config/page.tsx` (GET `:143`, PUT `:410` with `{ updates: {…} }` of mixed value types, and the pricing GET/PUT/POST/sync). **POST `/api/admin/system-config` has no caller.** The five other admin config routes (agent-generation, memory, onboarding, orchestration, ui) also lack auth but write fixed keys only, so they cannot write `bos_llm_area_*` rows | route files; `SystemConfigService.ts:224-300` |
| V-11 | Admin pattern | No shared `requireAdmin` helper exists. The precedent is the inline `getUser()` → `AdminAccessService.getInstance().isAdmin({ id, email })` → 401/403 check in `app/api/admin/business-os/llm-usage/route.ts:49-64` and `audit-trail/route.ts:29-42`. Admins in `admin_users` keep the settings page working, because a same-origin fetch sends the session cookie | — |
| V-12 | CI literal gate | **Cheap.** The 37 non-test files that import `callCatalog` contain exactly the call-site model and temperature literals, with no false positives (checked with a quoted-literal regex). A sibling script run as one more step in the existing `bos-llm-typecheck.yml` job needs no new workflow. `IntentParser.ts` does **not** import the catalog, so it is outside this scope and **needs no exemption** | `scripts/typecheck-bos-llm.ts` header (scope derivation) |
| V-13 | Reasoning-model parameters (SA-3) | `openaiProvider.usesMaxCompletionTokens()` already renames `max_tokens` for `gpt-5*`, `gpt-4.1*`, `o3*`, `o4*`, but it passes `temperature` and `frequency_penalty` through. Those models reject non-default values with a 400 that is **not** a model-not-found error, so DEC-9 would not catch it. `groqProvider` sends `temperature 0.7` when none is given, so "not set" only holds on OpenAI today | `openaiProvider.ts:134-160`; `groqProvider.ts:113` |
| V-14 | Pattern precedents (SA-1) | The approved precedents are: the repository read in `getImageGenerationConfig` (one `getByKeys`, per-key fallback, never throws), the cache/fallback shape of `effort-estimator/modelResolver.ts`, and the JSON-per-section shape of `InsightsConfigService`. **Do not mirror** `AgentGenerationConfigService` (`lib/agentkit/v6/config/`), which uses a direct `createClient` and `console.*` | — |

### Rulings

| Item | Ruling |
|---|---|
| DEC-1 | ✅ Approved |
| DEC-2 | ✅ Approved with change RC-3: absent vs `null` temperature; unknown top-level fields ignored with warn; read by the eight fixed keys, never by category |
| DEC-3 | ✅ Approved. "Chat off stops the embeddings" holds only if the gate runs at chat route entry (RC-6) |
| DEC-4 | ✅ Approved. Consequence: Layer 2 does not need FR-9 or FR-12's "move off `complete()`" (RC-8) |
| DEC-5 | ✅ Approved |
| DEC-6 | ✅ Approved with change RC-4 (apply order, value unwrapping, pre-planted row check) |
| DEC-7 | ✅ Approved with change RC-2 (0 allowed for every call) and RC-5 (`hasPricing`, image price coverage) |
| DEC-8 | ✅ Approved |
| DEC-9 | ✅ Approved with change RC-7 (placement, trigger, negative cache) |
| DEC-10 | ✅ Approved with change RC-9 (the script validates; generic routes refuse `bos_llm_area_*`) |
| DEC-11 | ✅ Approved (IntentParser out of scope), with factual correction RC-1(e): no gate exemption is needed |
| DEC-12 | ✅ Approved and widened (RC-10) |
| SA-1 | ✅ Rule 7 sign-off for the policy module and resolver, built from the V-14 precedents |
| SA-2 | Partly answered: pricing routes share F-1 (V-10). RLS needs a live check in Step 0 (RC-10) |
| SA-3 | ✅ Approved with change RC-11 |
| SA-4 | ✅ Confirmed: V-1, V-2 |

### Required changes

1. **RC-1 — Factual corrections to the doc.** (a) `landing_page` row: separate route `app/api/website/landing-pages/generate/route.ts:116`/`:127`, `gpt-4o`, 0.7, direct `chatCompletion`, existing fallback = default content (V-1). (b) All four onboarding extractors: temperature "not set" (V-2). (c) F-1: the route also has an uncalled **POST**, and PUT can create keys (V-10). (d) FR-3: "fails to build" should read "fails the `typecheck:bos-llm` gate", because `next build` ignores type errors. (e) DEC-11 / FR-15 / AC-11: IntentParser is outside the gate scope, so drop the exemption (V-12). (f) Off table: `full_site` has three callers, and chat's mutate path must behave like the editor path (V-5).
2. **RC-2 — DEC-7 temperature rule.** "0 only for the planner" would reject analysis's seeded 0, which is a behaviour change. Rule: every call accepts 0 to 1 or not set, and the planner is locked at 0.
3. **RC-3 — DEC-2 schema.** A field that is **absent** inherits from the next level. `temperature: null` means **send no temperature**. Without this an operator cannot remove a code-default temperature (needed for RC-11). The resolver reads the eight rows by fixed key (`getByKeys`), never by `category`, because a category is editable.
4. **RC-4 — DEC-6 / FR-16 apply order and seed safety.** (i) Step 0 is deployed **before** the seed migration is applied. (ii) The seed is applied **before** the code that reads the rows is deployed. Otherwise production overrides in the F-3 keys are replaced by code defaults in that window. (iii) The seed SQL unwraps JSON-encoded strings (`'"gpt-4o-mini"'`) and string booleans (`'true'`). (iv) The pre-apply checklist confirms that no `bos_llm_area_*` row exists yet. `ON CONFLICT DO NOTHING` would keep a row planted through today's open PUT/POST.
5. **RC-5 — DEC-7 price check.** Token models are checked with `hasPricing(provider, model)` from `lib/ai/pricing.ts` (V-6), evaluated when the settings cache refills, never on every call. The image model is accepted only if every configured size has a price at `low`, `medium` **and** `high` (config or `IMAGE_FALLBACK_PRICING`) (V-7).
6. **RC-6 — Chat "off" must actually stop chat spend.** The chat-area `enabled` check also gates the entry of `/api/business-os/chat-v2` and `/api/business-os/chat` (v1), returning the same unavailable message. It is a gate only: no settings are wired into their models (V-4).
7. **RC-7 — DEC-9 placement.** The retry wraps the provider call **inside** the `runAiAction` scope (one audit entry), never around the service or route. It fires only when the resolved model ≠ the code default, and only on an OpenAI model-not-found or not-permitted error (a code-owned classifier over `error.code` / status). The rejected `provider:model` is negatively cached per instance for the settings window, so each call does not pay a failed round trip. AC-8 also asserts one audit entry with `failedCallCount: 1` and a 0-token failed ledger row.
8. **RC-8 — Cut from Layer 2 (right-sizing).** FR-9 (unavailable provider) and FR-12's "move website / intake / onboarding off the `complete()` helper" go to the layer that first allows a non-OpenAI provider (DEC-4). With OpenAI the only allowed provider, `complete()` already honours model and temperature, so moving off it is risk without benefit. Keep `provider` in the schema, validated against `['openai']`. Also: `landing_page` off uses its **existing** default-content path, with no new message.
9. **RC-9 — DEC-10 enforced in code, not only by process.** The checked-in change script writes through `SystemConfigRepository.set`, after the same Zod schema and guardrails the resolver uses. A row it would reject cannot be written. Until the admin-screen layer, the generic `PUT`/`POST /api/admin/system-config` **refuses** `bos_llm_area_*` keys (400).
10. **RC-10 — Step 0 scope (DEC-12 widened).** (a) `system-config` GET/PUT get the admin check (V-11 pattern). POST is **deleted** (no caller) or gated. The route moves to `SystemConfigRepository`, off the deprecated `SystemConfigService`. Zod accepts `{ updates: Record<string, unknown> }` (non-empty keys, bounded count), so the billing save on the admin page keeps working. No `error.message` leaks outside development. 7 `console.*` calls become Pino with a `correlationId`. (b) `pricing` (GET/PUT/POST/DELETE) and `pricing/sync` (POST) get the same gate plus Pino (12 calls), because an anonymous price insert or delete defeats RC-5 and zeroes cost tracking today. Moving `ai_model_pricing` access into a repository is a **tracked follow-up**, not Step 0. (c) **Live RLS check**, recorded in the workplan: `pg_policies` for `system_settings_config` and `ai_model_pricing`. SELECT for anon/authenticated is acceptable (labels only). Any INSERT/UPDATE/DELETE policy for anon/authenticated is dropped in a Step 0 migration.
11. **RC-11 — SA-3, reasoning models.** One exported, code-owned family test next to `usesMaxCompletionTokens` decides "rejects sampling parameters". For such a model, a resolved temperature is **not sent** (warn log). A call that sends a locked temperature or `frequency_penalty` (the planner) **rejects** such a model as a field (DEC-7 fallback), because that 400 is not covered by DEC-9 (V-13).
12. **RC-12 — FR-15 mechanism.** A sibling script (for example `scripts/check-bos-llm-literals.ts`) runs as a second step in the existing `bos-llm-typecheck.yml` job. Its scope is non-test files that import `callCatalog`, matching quoted model literals, `OPENAI_MODELS.*` and numeric `temperature:` literals. Exemptions are named files with reasons — the FR-3 policy module (V-12) and, as shipped, the operator script (SA Step 4 finding 8). `IMAGE_GENERATION_CONFIG_DEFAULTS.model` moves into, or is referenced from, the policy module so FR-3 stays the single place.

### Slice order (each PR small; zero behaviour change on deploy)

| Step | PR content | Behaviour on deploy |
|---|---|---|
| **0** | RC-10: gate `system-config` + `pricing` + `pricing/sync`, repository switch, Zod, Pino, refuse `bos_llm_area_*`, live RLS check (+ policy-drop migration if needed) | Anonymous writes stop; admin page unchanged for admins |
| **1** | Policy module (defaults, locks, allowed providers, bounds), Zod schema, resolver + 60 s cache + guardrails (RC-2/3/5/11) + retry helper (RC-7), `SystemConfigRepository` read method, change script (RC-9), seed migration **file**, unit tests (AC-3 to AC-8) | Inert: nothing calls the resolver. Seed then applied (rows unread) |
| **2** | Wire non-chat areas with existing fallbacks: insights, briefing, intake, leads, onboarding (model/temperature only; not switchable), website `landing_page` + dormant blocks, `full_site` model/temperature. Parameter snapshot per call (AC-2); FR-13 intake `generated_from.model` | Identical requests (AC-2) |
| **3** | Chat (planner, analysis; stop reading the `bizchat_*` keys) + RC-6 gates, images (model into area row), and the ★ "off" messages once **BQ-1** is answered | Identical requests; new messages appear only when an area is switched off |
| **4** | FR-15 literal gate (RC-12, lands once the last literal is gone), skill / runbook / investigation / KI-C docs (FR-18) | None |

### Follow-ups (not Layer 2)

- Move `ai_model_pricing` access into a repository (pricing routes, `lib/ai/pricing.ts` direct `createClient`, `console.*` in `pricing.ts`).
- The five other unauthenticated admin config routes (agent-generation, memory, onboarding, orchestration, ui): agent-platform settings, same F-1 class.
- Public `GET /api/system-config?keys=` returns any key without auth. After Layer 2 that includes the area rows (labels only, low risk).
- Retire chat v1 (`/api/business-os/chat`, no UI caller) and decide the future of the owner-visible V2 compare toggle.

### Workplan approval condition

The Developer may write the workplan once the BA applies RC-1 to RC-12 (docs only), and **BQ-2 is answered** (Step 0 in scope; SA recommends yes). BQ-1 blocks only Step 3's ★ messages.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Created (Draft) | Layer 2 scope as confirmed by the user; code findings F-1 to F-12; current settings inventory; BA decisions DEC-1 to DEC-12 for SA review; business questions BQ-1, BQ-2 |
| 2026-09-19 | SA review: APPROVED WITH CHANGES | Verified against code: V-1 to V-14 (landing_page is a separate route with its own fallback; all four onboarding extractors send no temperature; chat v2 live via owner toggle; `full_site` has three callers; `hasPricing` makes the price guardrail enforceable; retry is audit-safe inside `runAiAction`; RLS not in repo, needs a live check; Step 0 must cover POST and the pricing routes; the CI gate is cheap and needs no IntentParser exemption). Rulings on DEC-1 to DEC-12 and SA-1 to SA-4; required changes RC-1 to RC-12; Layer 2 no longer includes FR-9 or the move off `complete()`; slice order Step 0 to 4 |
| 2026-09-19 | Approved — ready for Dev workplan | BA applied RC-1 to RC-12 into the body: F-1/F-4/F-7/F-9/F-10 corrected, F-13 to F-16 added; inventory fixed (`landing_page`, four onboarding extractors "not set", chat v1/v2 gate-only rows); DEC-2/3/4/6/7/9/10/11/12 amended; off table (chat v1/v2 gates, `full_site` three callers, `landing_page` existing default); FR-1 widened, FR-9 deferred, FR-3/4/5/7/11/12/14/15/16/17 amended; AC-1/3/5/8/9/11/13 amended, AC-15/AC-16 added; new Delivery Order section. User answers recorded: BQ-1 approved as written (onboarding never switchable off), BQ-2 yes (Step 0 in layer, ships first). Out of Scope notes the pending chat V2/V1 deprecation question with Offir. SA Review kept unchanged as the record |
| 2026-09-21 | **Delivered — Step 4 code-complete; status updated** | All 22 catalogued calls resolve provider, model, temperature and on/off from eight `system_settings_config` rows. Step 4 adds `npm run check:bos-llm-literals` as a second step in the existing `bos-llm-typecheck` CI job (**AC-11**): it fails on a quoted model id, `OPENAI_MODELS.*` / `BOS_LLM_CALL_POLICY.*`, a number bound to a temperature-ish name (including `?? 0.7`, a ternary and a default parameter), a read of a superseded key or a model taken from `process.env.*MODEL*`, in any non-test file that imports the call catalog, with two named exemptions (see the QA row below — as first written this said "the policy module as its only exemption"). Proved both ways — a deliberate re-hardcode was planted and reverted at one call site **per area**, all eight failing the check with the right file and line, and the clean tree passing. **AC-14:** the `bos-llm-call-standards` skill gains Standard 8 and loses the stale KI-C exception; the investigation doc, the Layer 1 roadmap and Layer 1.5 KI-C are updated; the operator runbook is new, and records that the kill switch **fails open** (FU-6). AC-11 and AC-14 are Dev-verified and await QA |
| 2026-09-21 | SA Step 4 review applied; status reworded | Status is now **"Delivered (code) — with three named exceptions"** on SA's recommendation, naming them: the literal gate is **not a required status check** so it cannot block a merge; **chat-v2 still picks its own model and writes no ledger row** (F-13 / DEC-11); and the Step 2/3 **post-deploy checks are unrun**. Plain "Delivered" hid all three. The gate itself gained the shapes SA proved it missed, and its **blind class is now stated** in the script header, the skill and the test suite: it is syntactic, so a model or temperature arriving from another module, from a computed string or through an unnamed variable is invisible to it |
| 2026-09-21 | QA Step 4 review applied | **AC-11 and FR-15 no longer say "the only exemption is the policy module"** (QA D4-2): the shipped gate has **two named exemptions**, each with a reason and printed by `--list` — the policy module and the operator script, per SA's Step 4 finding 8, which rejected a `scripts/` directory exclusion. An acceptance criterion must not be marked verified against text the code no longer matches. Also: the four temperature evasions QA proved at real call sites (`??=`, `||=`, a destructuring default, `satisfies`) are now **caught**, not documented — two of them contradicted a guarantee the gate's own header had made — and the duplicated "still open" paragraph is removed |
