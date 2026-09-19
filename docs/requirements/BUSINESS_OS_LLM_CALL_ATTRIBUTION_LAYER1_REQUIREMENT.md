# Requirement: Business OS LLM Call Attribution — Layer 1

> **Last Updated**: 2026-09-18

**Created by:** BA
**Date:** 2026-09-16
**Status:** SA approved — changes applied, ready for Dev workplan (SA review 2026-09-16; RC-1 to RC-15 and user decisions applied 2026-09-17; SA workplan-review to-dos RQ-1 to RQ-4 applied 2026-09-17; SA code-review correction CR-1 applied 2026-09-17)

## Overview

Business OS makes LLM calls across six areas: Chat, Insights, Briefing, Website, Intake and Leads. Every call is metered into the usage ledger (`token_usage`), but eight call sites record their spend under the platform's system user instead of the business it was made for. Call and area names are also inconsistent, and there is no reliable way to tie a call back to the user action or background job that caused it. So we can't say what each business's AI activity costs, and the owner's usage card undercounts.

Layer 1 makes every in-scope Business OS LLM call land in the ledger:
- under the real account it ran for;
- with a consistent area name and a stable call name;
- with a grouping id for the action or job that caused it.

Layer 1 changes nothing else about how calls behave, and it ships no report or UI.

**Why now:** this is the foundation for every later layer (see the [Layers Roadmap](#layers-roadmap)). The user decided that tracking must be confirmed complete before deciding what to deduct or enforce.

**Evidence:** [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md) (sections A, D, E, I), plus the SA code checks in the [SA Review](#sa-review) and the SA workplan review ([workplan §13](/docs/workplans/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_WORKPLAN.md)).

---

## Table of Contents

- [User Stories](#user-stories)
- [Scope](#scope)
- [Area and Call Catalog](#area-and-call-catalog)
- [Per-Call Before / After](#per-call-before--after)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Layers Roadmap](#layers-roadmap)
- [Known Issues and Open Items](#known-issues-and-open-items)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## User Stories

- As a **platform operator**, I want every Business OS AI call recorded against the business it served, so that I can see what each business's AI activity really costs us.
- As a **platform operator**, I want every call to carry a clear area and call name, so that spend can be broken down by what the product was doing, and so the same names can later be used to configure each call's model.
- As a **platform operator**, I want every call linked to the user action or background job that caused it, so that I can see the full cost of one chat question, one insight run or one website generation.
- As a **business owner**, I want my usage card to include all the AI work done for my business (website, intake, insights, briefing, leads), so that the number reflects what I actually used.
- As a **QA engineer**, I want each in-scope call's attribution to be testable, so that Layer 1 can be proven complete without a dedicated report.

---

## Scope

### In scope

All Business OS LLM calls listed in [Per-Call Before / After](#per-call-before--after):
- the chat v4 calls and their embeddings;
- insights;
- the daily briefing;
- website generation (full site, landing page, block content);
- intake form generation and question inference;
- the lead reply recommender.

Also in scope:
- a new Business OS LLM call catalog and attribution builder (FR-26);
- the shared "simple completion" helper those calls use (optional context only, FR-11);
- the shared embedding service, as far as Business OS callers need it (FR-13);
- the owner usage API's area-to-category mapping (FR-21).

### Excluded calls

These calls stay as they are in Layer 1 and must not be modified by this work:

| Call | Location | Reason for exclusion |
|---|---|---|
| Chat v2 (legacy) | `lib/business-os/ai-data-layer/AIDataLayerService.ts:895`, `:1243` | Legacy chat path. It bypasses the provider layer (direct SDK) and is superseded by chat v4. Retire-vs-fix is decided separately (user decision 2026-09-16) |
| Chat v1 (legacy) | `lib/business-os/IntentParser.ts:114` | Legacy chat path with no UI caller found. Superseded by chat v4 (user decision 2026-09-16) |
| Story | `app/api/business-os/story/route.ts:183` | Broken: calls a method that doesn't exist, so it always serves its fallback and makes no LLM call. No caller (user decision 2026-09-16) |
| WebsiteAnalyzer | `lib/services/WebsiteAnalyzer.ts:123` | **Dead and broken, no LLM spend; fix vs retire decided separately.** It calls methods that don't exist (`getDefaultModel`, and `complete` on the wrong type) and reads a response shape the helper doesn't return, so its LLM call always fails (user decision 2026-09-16; confirmed by SA code review CR-1, 2026-09-17) |
| Onboarding conversation (4 calls per session) | `lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397` (live through `app/api/onboarding/chat/route.ts:99`) | Still recorded on the platform account (`system` / `onboarding`). Kept out to hold Layer 1's focus. **Moved to Layer 1.5** (user decision 2026-09-17) — now specified in [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) part (a), attributed to the owner under a new `business-os-onboarding` area |
| Service generator | `lib/services/ServiceGeneratorService.ts:304` (also `:275`) | Broken: calls a `complete` method the provider doesn't have (and reads `response.choices` at `:314`). It always falls back, so there is no LLM spend and no ledger row. Same class as Story. Retire-vs-fix decided separately (SA workplan review 2026-09-17, RQ-1) |
| AI image generation | `lib/services/GeneratedImageService.ts:186` | Direct OpenAI image generation (`gpt-image-1`) that bypasses the provider layer, so it isn't recorded in `token_usage` at all. The provider layer has no image method, and images are priced per image, not per token, so the token-based ledger and credits can't represent them correctly. It already has its own daily per-business image cap (`:170-183`). **Moved to Layer 1.5** (user decision 2026-09-17) — now specified in [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) part (b): recorded in **its own area `business-os-images`** (SA decision, 2026-09-17), **tracked but not charged**; the charging question [OQ-7](#open-questions) stays open and parked |

The lead reply recommender **is** in scope for naming and grouping (it already passes the real account). Its known parsing bug is **parked** and must not be fixed or changed as part of Layer 1 (see [Out of Scope](#out-of-scope--future-roadmap)).

---

## Area and Call Catalog

### Areas and how they are recorded

Areas are a fixed list. Recording follows SA decision OQ-1: no schema change, existing `token_usage` columns.

| Area | Meaning | Recorded `feature` value |
|---|---|---|
| `chat` | Business OS chat (v4) | `business-os-chat` (unchanged) |
| `insights` | Insight detection content, correlated insights, business health summary | `business-os-insights` |
| `briefing` | Daily briefing narration | `business-os-briefing` |
| `website` | Website and landing page generation, block content | `business-os-website` |
| `intake` | Intake form generation and question inference | `business-os-intake` |
| `leads` | Incoming lead handling | `business-os-leads` |

*(Layer 1.5 adds two more areas: `onboarding` → `business-os-onboarding` and `images` → `business-os-images`, each with an **empty** legacy-features list.)*

| What | Ledger column |
|---|---|
| Area | `feature` = `business-os-<area>` |
| Call name | `component` = the catalog call name |
| Grouping id | `session_id` = a UUID |

Existing `activity_type`, `activity_name` and `category` values stay unchanged. They carry the chat repair and cache-hit markings. Layer 1 adds no new activity values.

### Call names

- Once shipped they are **stable**, because they become the keys of the Layer 2 model configuration.
- They are unique within their area.
- The final list is fixed in the Dev workplan, in the catalog module (FR-26), and not changed afterwards.

| Area | Call name | What it does |
|---|---|---|
| chat | `planner` | Plans the answer to a question (includes repair attempts; see FR-15) |
| chat | `analysis` | Writes the analysis sentence for a result |
| chat | `plan_cache_lookup_embedding` | Embeds the question to look up a cached plan |
| chat | `plan_cache_store_embedding` | Embeds the question to store a successful plan |
| chat | `verified_question_embedding` | Embeds the question to match (look up) verified questions |
| chat | `verified_question_store_embedding` | Embeds a question to store it as a verified question (split from the lookup, as plan cache is; RQ-2) |
| insights | `insight_content` | Writes title, description and recommendation for one detected issue |
| insights | `correlated_insight` | Writes the story for a group of connected issues |
| insights | `health_summary` | Writes the business health executive summary |
| briefing | `daily_narration` | Writes the daily briefing text |
| website | `full_site` | Generates full website content. This includes landing pages created from chat (`MutateExecutor.ts:806-815`), which use the full-site generator; the call name follows the generator |
| website | `landing_page` | Generates a landing page through the dedicated landing-page route only (row 16) |
| website | `field_regenerate` | Regenerates one field of a website block |
| website | `testimonial_enhance` | Polishes a testimonial |
| website | `hero_content` | Generates hero block content (no production trigger today; see FR-19) |
| website | `about_content` | Generates about block content (no production trigger today) |
| website | `faq_content` | Generates FAQ block content (no production trigger today) |
| website | `features_content` | Generates features block content (no production trigger today) |
| intake | `form_generation` | Generates an intake form |
| intake | `question_inference` | Turns an owner's note into one intake question |
| leads | `reply_recommendation` | Picks which of the business's links to send a new lead |

**Not in the catalog:** the chat cache-hit row written by `turnUsage.ts:95-111` (component `BizQLPlanCache`). It records zero tokens and is not an LLM call. It stays unchanged, and its marking is covered by AC-11.

### Grouping ids

A group is the user action or background job a call belongs to. Every grouping id is a UUID. The entry point that represents the action or job owns the id; services accept it as a parameter and don't mint their own when a caller has one.

| Area | One group is… | Grouping id source |
|---|---|---|
| chat | One chat turn | Existing `turnId` (unchanged) |
| insights | One scheduled insight run, per business. The group key is (account, grouping id): every business in one run shares the run's id and is told apart by its account. The health summary in that run shares the group | Cron `runId` (`app/api/cron/insight-detect/route.ts:142`) |
| briefing | One business on one business-local day. Re-narrations the same day, after the facts change, share the group | Deterministic UUID v5 of (account, briefing date), produced by a helper in the catalog module |
| website | One owner request: a full-site generation, a landing-page generation, one field regeneration, one testimonial enhancement, or one chat website operation. Block-content calls made during a build share that build's group | New UUID at each entry point: `app/api/website/generate-from-profile/route.ts`, `app/api/website/landing-pages/generate/route.ts`, `app/api/website/blocks/[blockId]/regenerate/route.ts`, `app/api/website/enhance-testimonial/route.ts`, `MutateExecutor.ts:806-808` (chat mutate context has no turn id; don't thread it through) |
| intake | One form-generation request, or one question-inference request | New UUID at `app/api/intake/form/generate/route.ts:47` and `app/api/intake/form/infer-question/route.ts` |
| onboarding build | The onboarding build may pass **one** UUID to both intake and website generation, since it is one owner action (`app/api/onboarding/build/route.ts:840` intake, `:881` website). Permitted, not required | Minted at the build route |
| leads | One incoming enquiry. Not the contact, because one contact can send several enquiries | New UUID minted in `LeadAlertService.ts` before `recommendLeadReply` (`:334`) |

A caller's `x-correlation-id` may be reused as the grouping id **only** when it is a valid UUID (the rule in `chat-v4/route.ts:326-336`). Otherwise the entry point uses `crypto.randomUUID()`. Non-UUID values are dropped by the tracker, so they would silently lose the grouping.

*(Layer 3 uses these grouping ids to link one AI audit entry per action to its ledger rows — see the [Layers Roadmap](#layers-roadmap).)*

---

## Per-Call Before / After

"Before" is from the investigation (section D). "After" is the required state. Area and call name are recorded as described in the [catalog](#areas-and-how-they-are-recorded).

| # | Call (location) | Before: account | Before: naming | After: account | After: area / call | After: grouping |
|---|---|---|---|---|---|---|
| 1 | Chat planner (`bizql/planner/Planner.ts:444`) | Real | business-os-chat / BizQLPlanner | Real (unchanged) | chat / `planner` | Turn (unchanged) |
| 2 | Chat analysis (`bizql/analyse/AnalysisService.ts:124`) | Real | business-os-chat / BizQLAnalysis | Real (unchanged) | chat / `analysis` | Turn: **always** the turn id. Previously the request correlation id, which equals the turn id unless a caller sends a non-UUID header; the product UI sends none, so nothing visible changes (RQ-3) |
| 3a | Plan cache lookup embedding (`bizql/cache/PlanCache.ts:226`) | Real | business-os-chat / EmbeddingService | Real (unchanged) | chat / `plan_cache_lookup_embedding` | Turn (unchanged) |
| **3b** | **Plan cache store embedding** (`PlanCache.ts:333`, called from `Planner.ts:640-648`) | **System user** | **helpbot** / EmbeddingService | **Real** (the account whose turn produced the plan) | chat / `plan_cache_store_embedding` | **Turn** (`request.turnId`, passed into `store`) |
| 4 | Verified question lookup embedding (`bizql/planner/VerifiedQuestions.ts` `similar()` `:136` via `embed()` `:74-89`; called from `Planner.ts:349`) | Real | business-os-chat / EmbeddingService | Real (unchanged) | chat / `verified_question_embedding` | Turn (unchanged) |
| 4b | Verified question store embedding (`VerifiedQuestions.ts` `remember()` `:197` via `embed()`; called from `chat-v4/route.ts:1592`) | Real | business-os-chat / EmbeddingService | Real (unchanged) | chat / `verified_question_store_embedding` | Turn |
| **7** | **Insight content** (`insight/repository/InsightRepository.ts:717`) | **'system'** (account available, `:608`) | insight-generation / InsightRepository | **Real** (the business analysed) | insights / `insight_content` | Run (`runId`) |
| **8** | **Correlated insight** (`InsightRepository.ts:1728`) | **'system'** (account available, `:1659`) | correlated-insight-generation / InsightRepository | **Real** | insights / `correlated_insight` | Run (`runId`) |
| 9 | Health summary (`InsightRepository.ts:2113`) | Real | health-summary-generation / InsightRepository | Real (unchanged) | insights / `health_summary` | Run (`runId`) |
| **10** | **Daily briefing** (`briefing/BriefingNarrator.ts:106`) | **Optional, falls back to 'unknown'** (callers do pass it: `BriefingStore.ts:51`; `app/api/business-os/my-day/route.ts:119`; `DailyBriefingDispatchService.ts:222`) | business-os / daily-briefing | **Real, required** (no fallback) | briefing / `daily_narration` | UUID v5 (account, date) |
| 12 | Lead reply (`leads/LeadReplyRecommender.ts:98`) | Real | lead-reply / LeadReplyRecommender | Real (unchanged) | leads / `reply_recommendation` | New UUID per enquiry |
| **13** | **Intake form generation** (`lib/services/IntakeGenerationService.ts:249`) | **System** (via shared helper) | onboarding / simple-complete | **Real** | intake / `form_generation` | Request UUID |
| **14** | **Intake question inference** (`app/api/intake/form/infer-question/route.ts:123`) | **System** (account available, `:62`) | onboarding / simple-complete | **Real** | intake / `question_inference` | Request UUID |
| **15** | **Full website generation** (`lib/services/WebsiteGenerationService.ts:546`), incl. chat-created landing pages | **System** | onboarding / simple-complete | **Real** | website / `full_site` | Request UUID |
| 16 | Landing page route (`app/api/website/landing-pages/generate/route.ts:102`) | Real | landing-page-generation / LandingPageGenerateAPI | Real (unchanged) | website / `landing_page` | Request UUID |
| **17a** | **Field regenerate** (`WebsiteAIContentService.ts:301`) | **System** | onboarding / simple-complete | **Real** | website / `field_regenerate` | Request UUID |
| **17b** | **Testimonial enhance** (`WebsiteAIContentService.ts:337`) | **System** | onboarding / simple-complete | **Real** | website / `testimonial_enhance` | Request UUID |
| **17c–f** | **Hero / about / FAQ / features** (`WebsiteAIContentService.ts:371`, `:414`, `:546`, `:602`) | **System** | onboarding / simple-complete | **Real** | website / `hero_content`, `about_content`, `faq_content`, `features_content` | The build's UUID. **No production trigger today** (FR-19) |

Rows in **bold** change attribution. The other rows change naming and grouping only.

---

## Functional Requirements

### Attribution

1. **FR-1 — Real account.** Every in-scope call must be recorded in the usage ledger under the account it ran for: the business owner's account whose request or data caused the call. Call sites must never pass the system user, the all-zero placeholder, or strings such as `'system'` or `'unknown'`.
2. **FR-2 — Background work belongs to the business.** Calls made by background jobs (the insight cron, lead-triggered work, briefing generation) are attributed to the business whose data is being processed, as for user-triggered calls.
3. **FR-3 — Missing or invalid account: log, never drop spend.**
   - A missing account is prevented at compile time: the attribution type (FR-26) requires the account.
   - If the runtime account value is not a valid UUID, the attribution builder emits an **error-level** structured log naming the area, call name and the request correlation id (or the grouping id where the call has no request correlation id, e.g. insights, briefing, leads).
   - The call still completes, and user-facing behaviour is unchanged.
   - The ledger row is still written. The existing tracker fallback (`aiAnalytics.ts:120-130`) places it on the system user, where the platform-account check will catch it. *(2026-09-17: that check is now delivered by Layer 1.1, Check 2, rather than Layer 1.5.)*
   - Spend is never dropped.
   - `lib/analytics/aiAnalytics.ts` is **not** modified. *(Layer 1.5 changes one line of it — the platform-account fallback moves to a shared helper — with no behaviour change. Its 16 `console.*` calls were **not** converted in that layer: the user kept the freeze on 2026-09-18 (Layer 1.5 D-6); the conversion, Layer 1.5 open item OI-4, was since done by the logging clean-up, PR #50.)*

### Naming

4. **FR-4 — Area.** Every in-scope call must be recorded with an area from the fixed list: `chat`, `insights`, `briefing`, `website`, `intake`, `leads`.
5. **FR-5 — Chat keeps its feature value.** Chat calls must keep the existing feature value `business-os-chat`. The chat daily limit (`ChatBudget.ts:161`), the admin chat usage report (`usageReport.ts:187`, `:358`) and the owner's usage API (`usage/route.ts:65-89`) depend on it.
6. **FR-6 — Call name.** Every in-scope call must be recorded with its call name from the [catalog](#call-names). Call names are stable identifiers: once released they must not be renamed without a migration plan, because Layer 2 uses them as configuration keys.
7. **FR-7 — Ledger mapping.** For every in-scope call, the area is recorded in `feature` as `business-os-<area>`, the call name in `component`, and the grouping id in `session_id`. Existing `activity_type`, `activity_name` and `category` values are left unchanged, and no schema change is made.

### Grouping

8. **FR-8 — Grouping id.** Every in-scope call must be recorded with a grouping id that identifies the user action or background job it belongs to, as defined in the [grouping table](#grouping-ids). All calls made for the same action or job carry the same grouping id. **Every grouping id is a UUID.** A caller's `x-correlation-id` may be reused only when it is a valid UUID; otherwise `crypto.randomUUID()` is used.
9. **FR-9 — Chat grouping unchanged.** Chat calls must keep using the chat turn id exactly as today. The chat daily limit counts distinct turns from it (`ChatBudget.ts:97`), and the chat usage report groups by it (`usageReport.ts:112-113`).
   - **Chat analysis (row 2) now uses the turn id in every case** (SA ruling (b), workplan T14, RQ-3). It previously received the request correlation id.
   - The two are identical whenever the correlation header is absent or a valid UUID. The product UI sends no correlation header, so there is no visible change.
   - Only a caller sending a non-UUID header was affected: its analysis row used to be recorded with no grouping id.
10. **FR-10 — Grouping sources.** Grouping ids come from the sources in the [grouping table](#grouping-ids). The entry point that represents the user action or job owns the id; services accept it as a parameter and don't mint their own when a caller supplies one.

### Shared helpers

11. **FR-11 — Simple completion helper.** `getProviderFactory().complete()` (`lib/ai/providerFactory.ts:291-333`) gains an **optional** context parameter.
    - When given, the context is passed to the provider as is.
    - When absent, today's default (`system` / `onboarding` / `simple-complete`, `:324-328`) stays byte-for-byte unchanged.
    - The misleading "no tracking" comment (`:323`) is corrected.
    - Every in-scope caller (rows 13, 14, 15, 17a–f) passes a context built by the attribution builder (FR-26).
12. **FR-12 — Other callers of the simple helper.**
    - **Only live caller outside Business OS:** the onboarding conversation (`OnboardingConversationManager.ts`, excluded). It keeps calling the helper without a context and keeps working unchanged. It is not converted in Layer 1 (Layer 1.5).
    - **WebsiteAnalyzer is not a working caller** (SA code review CR-1, 2026-09-17). It is dead and broken: it calls methods that don't exist (`getDefaultModel`, and `complete` on the wrong type), so its LLM call always fails. It is in the [Excluded calls](#excluded-calls) table and is not modified. Layer 1 makes no promise about its behaviour beyond leaving the file untouched.
    - **Business OS callers can't forget attribution,** because the Business OS service methods that call the helper take a **required** attribution parameter.
13. **FR-13 — Embedding service.** `generateEmbedding`'s existing optional attribution (`lib/services/EmbeddingService.ts:99-123`) gains a call name, and Business OS callers pass it through the attribution builder. A Business OS chat embedding must never be recorded under the help bot's feature. The help bot default and the batch path (`:113-121`, `:172-179`) stay byte-identical.

### Per-area changes

14. **FR-14 — Plan cache store.** The plan cache store embedding (row 3b) must be attributed to the account and turn whose successful plan is being stored. `turnId` is added to the store arguments (`PlanCache.ts:282-289`) and passed from `Planner.ts:640-648`, the same way the lookup passes it (`PlanCache.ts:226-230`).
15. **FR-15 — Chat repairs and cache hits.** Chat planner repair attempts must keep the existing marking that tells them apart from first attempts (`Planner.ts:490`), and they are recorded under call name `planner`. The cache-hit row (`turnUsage.ts:95-111`) is not an LLM call and stays unchanged (see [catalog](#call-names)).
16. **FR-16 — Insights.** Insight content (row 7), correlated insight (row 8) and health summary (row 9) must be attributed to the business being analysed, with the cron `runId` as the grouping id.
    - The group key is (account, grouping id).
    - `runId` becomes a **required** parameter of every public repository method that reaches these calls: `create` (via its params), `createBatch`, `saveCorrelationResults`, `createCorrelatedInsight` and `createOrUpdateHealthSummary` (SA workplan review 2026-09-17). Both existing callers (the cron, and `scripts/verify-insights.ts:98`, `:114`) already pass it.
17. **FR-17 — Briefing.** The briefing narration (row 10) must require the account; the `'unknown'` fallback is removed. The grouping id is a deterministic UUID v5 of (account, briefing date), produced by a helper in the catalog module, so re-narrations on the same day share the group.
18. **FR-18 — Intake.** Intake form generation (row 13) and question inference (row 14) must be attributed to the owner's account, with one new UUID per request, minted at the route. The onboarding build may pass one shared UUID to both intake and website generation.
19. **FR-19 — Website.**
    - **Attribution:** full-site generation (row 15, including chat-created landing pages), the landing-page route (row 16) and all six block-content calls (rows 17a–f) must be attributed to the owner's account, with the grouping defined in the catalog.
    - **Explicit account parameter:** the account is **passed explicitly** to `generateBlockContent`, `regenerateField` and `enhanceTestimonial` (`WebsiteAIContentService.ts:228`, `:278`, `:317`) and down to the private generators. It is never derived from the business profile, which has no account field.
    - **Rows 17c–f:** attributed, but they have **no production trigger today**: all `enrichBlock`/`enrichBlocks` callers pass `useAI = false`. They are verified by automated tests only.
    - **Chat "rewrite a section field" path** (`WebsiteSectionService.ts:519`): Layer 1 only adds the attribution argument so it compiles. It must **not** fix that path's broken request shape (see [KI-1](#known-issues-and-open-items)).
20. **FR-20 — Leads.** The lead reply recommender (row 12) keeps its current account, and gains area `leads`, call name `reply_recommendation`, and a new UUID per enquiry minted in `LeadAlertService.ts` before `recommendLeadReply` (`:334`). Its response handling must not be changed (parked bug).

### Usage card

21. **FR-21 — Category mapping, same release.** The owner usage API's category mapping must be extracted from `app/api/business-os/usage/route.ts:65-89` into an **exported pure function**, and updated in the same release:
    - `chat` ← `business-os-chat` (unchanged)
    - `website` ← `business-os-website`, `landing-page-generation`
    - `insights` ← `business-os-insights`, `health-summary-generation`, `insight-generation`, `correlated-insight-generation`
    - `briefing` ← `business-os-briefing`, `business-os`
    - `intake` ← `business-os-intake`
    - `leads` ← `business-os-leads`, `lead-reply`
    - `help` keeps `onboarding`, which the onboarding chat and prompt-ideas flows still write with real users. Existing `help` entries are otherwise unchanged. *(Layer 1.5 adds one category line each for the new `business-os-onboarding` and `business-os-images` values, with **empty** legacy lists, and leaves the legacy `onboarding` value under `help`.)*

    Legacy values map into the new categories, so a 30-day window that straddles the release doesn't split. No in-scope Business OS call may fall into `other`. The card doesn't render the breakdown (`components/business-os/UsageCard.tsx:21-24`), so no UI text or translation change is needed.
22. **FR-22 — Consumption may rise and "credits remaining" may drop (accepted, display only).**
    - **What changes:** previously system-attributed calls now count for the business. So the credits a business has consumed may rise, and the card's "credits remaining" against the monthly allowance may drop.
    - **Background work:** this includes the nightly insight run and the daily briefing, even on days the owner does nothing, and "remaining" may reach zero.
    - **Accepted:** the rise was accepted on 2026-09-16. The drop from background work is **not solved in Layer 1** and is recorded as [OI-1](#known-issues-and-open-items), to be handled later (layer TBD).
    - **Display only:** nothing is blocked or charged.

### Behaviour preservation

23. **FR-23 — No behaviour change beyond attribution.** For every in-scope call, Layer 1 must not change any of the following:
    - model, provider, prompts, temperature or token limits;
    - response handling, fallbacks, caching or the result shown to the user;
    - cost calculation, credits deduction or chat daily limits.

    **Explicit carve-outs** (accepted consequences of FR-14 and FR-21):
    - (a) Plan-cache store embeddings (row 3b) now count toward the chat daily token ceiling and the chat usage report's call count and cost per turn, about tens of tokens per stored plan.
    - (b) Usage categorisation changes per FR-21.
24. **FR-24 — Excluded calls untouched.** The [excluded calls](#excluded-calls) must not be modified. The only exception is FR-19's compile-only attribution argument on the chat "rewrite a section field" path, which is not an excluded call.
25. **FR-25 — No backfill.** Usage recorded before release stays as it is, including rows on the system user (user decision, 2026-09-16).

### Catalog module

26. **FR-26 — Business OS LLM call catalog and attribution builder.** One module under `lib/business-os/` (proposed `lib/business-os/llm/callCatalog.ts`; final path fixed in the workplan) must export:
    - the area list and a per-area call-name map, as constants;
    - an attribution type (account, area, call name, grouping id), with the call name restricted to its area;
    - one builder that returns the provider call context:
      - area → `feature`, call name → `component`, grouping id → `session_id`;
      - it preserves any extra fields the caller passes, such as the repair marking;
      - it performs the FR-3 validation and logging;
    - the briefing grouping-id helper (FR-17).

    Every in-scope call site uses the builder. No free-typed feature, component or call-name strings at call sites. The module lives under `lib/business-os/`, not `lib/ai/`, so the shared provider layer stays product-agnostic. SA approved this new pattern (CLAUDE.md rule 7) on 2026-09-16.

---

## Non-Functional Requirements

- **Performance:** attribution adds no additional LLM calls and no extra database round trips for calls that already hold the account.
- **Reliability:** a failure to record usage must never fail the user's request (existing behaviour preserved). Spend is never dropped (FR-3).
- **Security / tenancy:** the account and grouping id come only from server-side sources: the authenticated session (`getUser()`), database records the job iterates, or ids resolved server-side (e.g. the lead owner from the site). **No attribution field may be read from a request body, query string or header.** The one exception is reusing a valid-UUID `x-correlation-id` as a grouping id (FR-8), which never carries the account.
- **Logging:**
  - Touched files use structured Pino logging.
  - `lib/ai/providerFactory.ts` (6 `console.*` calls; two further matches are URL strings) and `lib/services/EmbeddingService.ts` (16) are touched non-compliant files.
  - **The user approved converting both to Pino in this cycle (2026-09-17).** The conversion is part of Layer 1 delivery.
  - `lib/analytics/aiAnalytics.ts` is **not touched** in Layer 1.
  - FR-3 errors include area, call name and correlation id.
- **Maintainability:** areas, call names and the builder are defined once (FR-26).
- **Testability:** each in-scope call's attribution must be verifiable in automated tests without calling a real LLM provider.
- **Accessibility:** not applicable (no UI change).

---

## Acceptance Criteria

Verification is by QA test evidence and code review. No report or UI ships in Layer 1.

**Automated tests (unit/integration, provider mocked):**

- [ ] **AC-1** (FR-1, FR-16) — For insight content (row 7) and correlated insight (row 8), the context passed to the provider carries the analysed business's account id, not `'system'`.
- [ ] **AC-2** (FR-1, FR-14) — For the plan cache store embedding (row 3b), the context carries the turn's account id and turn id, and does not carry the help bot feature.
- [ ] **AC-3** (FR-1, FR-17) — The briefing narration requires the account (type-level). A test shows no code path passes `'unknown'` or the system user.
- [ ] **AC-4** (FR-1, FR-18) — Intake form generation and question inference pass the owner's account id to the provider.
- [ ] **AC-5** (FR-1, FR-19) — Full-site generation, field regenerate, testimonial enhance, and each of hero, about, FAQ and features content pass the owner's account id to the provider. Rows 17c–f are proven by this test only.
- [ ] **AC-6** (FR-11) — Calling the simple completion helper **with** a context passes exactly that context to the provider. Calling it **without** a context produces the unchanged default (`system` / `onboarding` / `simple-complete`).
- [ ] **AC-7** (FR-12) — The live caller of the simple completion helper outside Business OS (the onboarding conversation) still compiles and calls the helper without a context, getting the unchanged default (existing tests pass, or a test covers the no-context path). WebsiteAnalyzer is dead and is not tested (CR-1).
- [ ] **AC-8** (FR-4, FR-6, FR-7) — For every row in the [Per-Call Before / After](#per-call-before--after) table (including rows 4 and 4b, which must carry their two distinct call names), a test asserts `feature` = `business-os-<area>` and `component` = the catalog call name. The cache-hit row is not covered (FR-15).
- [ ] **AC-9** (FR-5, FR-9) — All chat calls (rows 1, 2, 3a, 3b, 4, 4b) are recorded with feature `business-os-chat`. Rows 1, 3a and 4 keep the turn id as before, row 4b carries the turn id, and row 2 (chat analysis) carries the request's turn id in every case, not the request correlation id.
- [ ] **AC-10** (FR-8, FR-10, FR-16, FR-20) — Grouping:
  - (a) For chat, website and intake, two calls within one action share one grouping id, and a second action gets a different one.
  - (b) For insights, two businesses in one run share `session_id` but differ by account, and a second run has a different `session_id`.
  - (c) For leads, two enquiries from the same contact get different grouping ids.
  - (d) Every grouping id is a valid UUID.
- [ ] **AC-11** (FR-15) — A planner repair attempt and a cache hit keep their existing markings. The existing chat usage report tests (repair rate, cache hit rate) pass unchanged.
- [ ] **AC-12** (FR-3) — When the attribution builder receives an account that isn't a valid UUID, it emits an error-level log naming area, call name and the correlation id (or grouping id where none exists), the call completes, and the provider is called exactly once.
- [ ] **AC-13** (FR-13) — The embedding service's help bot callers and batch path still record their existing attribution (regression test).
- [ ] **AC-14** (FR-21) — The exported category-mapping function:
  - maps each new `business-os-<area>` value and each legacy value listed in FR-21 to its category;
  - keeps `onboarding` under `help`;
  - puts none of the listed values in `other`;
  - produces per-category tokens and call counts that sum exactly to the totals (credits are rounded per category and are not required to sum; rounding is unchanged, FR-23).
- [ ] **AC-16** (FR-23) — For each in-scope call, existing tests covering model, prompt, response handling and fallback pass unchanged.
- [ ] **AC-17** (FR-9, FR-23) — Existing chat daily limit tests (`lib/business-os/bizql/__tests__/chat-budget.test.ts`) and usage report tests (`usage-report.test.ts`) pass unchanged.
- [ ] **AC-22** (FR-26) — The attribution builder maps area → `feature`, call name → `component` and grouping id → `session_id`, and preserves extra fields such as the repair `activity_type`. A test for a call name outside its area fails type checking (compile-time test or `@ts-expect-error`).
- [ ] **AC-23** (FR-17) — The briefing grouping-id helper returns the same UUID for the same account and date, and different UUIDs for a different date or a different account.

**Code review checks (diff inspection):**

- [ ] **AC-15** (FR-20, FR-23) — The lead reply recommender's response handling is unchanged in the diff, apart from the added naming and grouping context.
- [ ] **AC-24** (FR-24, NFR Security, NFR Logging):
  - Every in-scope call site builds its context through the builder, with no free-typed feature, component or call-name strings.
  - No attribution field is read from a request body, query string or header (except a valid-UUID `x-correlation-id` as grouping id).
  - `aiAnalytics.ts` is unchanged.
  - The chat "rewrite a section field" request shape is unchanged.
  - `providerFactory.ts` and `EmbeddingService.ts` are converted to Pino, with no remaining `console.*` logging calls (user-approved 2026-09-17).
  - The excluded calls, including `WebsiteAnalyzer.ts`, `ServiceGeneratorService.ts` and `GeneratedImageService.ts`, are unchanged.

**QA run against a real environment:**

- [ ] **AC-18** (FR-1, FR-4–FR-8) — QA exercises each reachable call at least once with a test business:
  - a chat question (cache miss and cache hit);
  - an insight run (cron) that produces insight content, correlated insight and health summary;
  - the daily briefing;
  - a full website generation, and a landing page through the dedicated route;
  - field regenerate **through the website builder route only**, and testimonial enhance;
  - an intake form generation and a question inference;
  - an incoming lead enquiry.

  A direct query against the usage ledger for the test window shows every resulting row has the test business's account, the correct `feature` and `component`, and a UUID `session_id` shared within each action.
  - **Excluded from this QA run:** rows 17c–f (no production trigger; AC-5 covers them) and the chat "rewrite a section field" path (broken; KI-1).
  - **Caveat:** the plan cache store embedding (row 3b) is fire-and-forget and may not run on serverless after the response is sent. A missing 3b row does **not** fail AC-18; AC-2 covers it.
- [ ] **AC-19** (FR-1) — In the same QA window, a direct query shows **zero** rows under the system user or the all-zero placeholder for these feature values:
  - `business-os-chat`, `business-os-insights`, `business-os-briefing`, `business-os-website`, `business-os-intake`, `business-os-leads`;
  - the legacy `insight-generation`, `correlated-insight-generation`, `health-summary-generation`, `landing-page-generation`, `lead-reply`, `business-os`.

  `onboarding` is **deliberately excluded** from this query, because the out-of-scope onboarding conversation keeps writing `system` / `onboarding`. *(Layer 1.5 attributes that conversation to the owner under the new `business-os-onboarding` value; the legacy `onboarding` value stays excluded, because other onboarding flows still write it, and Layer 1.5 requires the new areas' legacy lists to stay empty for exactly this reason.)*
- [ ] **AC-20** (FR-21, FR-22) — The test business's usage card loads, and its total includes the website, intake, insights, briefing and leads activity from AC-18.
- [ ] **AC-21** (FR-24, FR-25) — The diff contains no change to the excluded calls (including WebsiteAnalyzer, the onboarding conversation, the service generator and AI image generation), and no data migration or backfill of existing usage rows.

*AC numbering is kept stable from the SA-reviewed draft. AC-22 to AC-24 were added when the RCs were applied.*

---

## Out of Scope / Future Roadmap

| Item | Where it goes |
|---|---|
| Extended usage report (all Business OS areas + system-user count + truncation warning) | **Layer 1.1** (user decision 2026-09-17: moved from Layer 1.5; delivered as the admin-only LLM Usage tab on `/test-business-os` and its report API — see [Layer 1.1 requirement](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md)) |
| Onboarding conversation attribution (4 calls per session, `OnboardingConversationManager.ts`) | **Layer 1.5**, part (a) — attributed to the owner under a new `business-os-onboarding` area (user decision 2026-09-17): [Layer 1.5 requirement](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) |
| AI image generation spend (`GeneratedImageService.ts`): tracking images, and whether and how they count toward credits | **Layer 1.5**, part (b) — recorded in its own `business-os-images` area, **tracked, not charged** (user decision 2026-09-17). The charging question (OQ-7) and credits per image are **parked** and revisited with OI-1 in the deduction layer: [Layer 1.5 requirement](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) |
| Model, provider, temperature and on/off configuration per call (JSON per area in DB config) | Layer 2 — including the onboarding conversation's hardcoded `'gpt-4o'` (Layer 1.5 KI-C, follow-up F-9) |
| "Credits remaining" dropping from background work | Open item OI-1, layer TBD (user decision 2026-09-17; explicitly **out of scope for Layer 1.5**, decided with the deduction layer alongside Layer 1.5's UD-1) |
| Cross-tenant read in the website block regenerate route | Open issue OI-2, separate security fix (user decision 2026-09-17) |
| Fixing the chat "rewrite a section field" request shape | Known issue KI-1, separate fix |
| Dollar-cost accuracy (price table loading, unpriced models, embeddings pricing) | Later layer. *(Layer 1.5 adds per-image pricing only, for the new image rows.)* |
| Per-action audit trail events for Business OS AI activity | **Layer 3** — one audit entry per AI action, linked to its ledger rows by this layer's grouping id: [Layer 3 requirement](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md): steps 0–2 merged and deployed; steps 3–5 (every area wired) code-complete 2026-09-19, pending review |
| Admin UI for usage or model configuration | Later layer |
| Credits deduction, allowance enforcement, what happens at zero | Later layer |
| V6 intent-generation attribution (AgentsPilot agents product) | Separate item (user decision 2026-09-16) |
| Authentication on `/api/admin/**` routes | Separate security fix, handled outside this effort |
| LeadReplyRecommender parsing bug (`LeadReplyRecommender.ts:112`) | Parked by user |
| Excluded legacy or broken calls (chat v2, chat v1, story, WebsiteAnalyzer, service generator) | Retire-vs-fix decided separately |
| Modifying `lib/analytics/aiAnalytics.ts` (including its system-user fallback) | Not in Layer 1. *(Layer 1.5 moves its platform-account fallback line to a shared helper, with no behaviour change; its Pino conversion was deferred by the user (2026-09-18) as Layer 1.5 open item OI-4, and then done by the logging clean-up, PR #50.)* |
| Backfilling historical system-attributed usage | Not planned (user decision 2026-09-16) |

---

## Layers Roadmap

> **Indicative only.** Each layer gets its own requirement, written when that layer comes up. Order and content may change after each layer is digested and tested.

| Layer | Delivers | Depends on |
|---|---|---|
| **1 (this)** | Every in-scope Business OS LLM call recorded against the right business, with area, call name and grouping id | — |
| **1.1** | **LLM Usage verification tab and report API** (user decision 2026-09-17; takes over the Layer 1.5 extended usage report). An admin-only, read-only tab on `/test-business-os`: pick a business and a start time, refresh, and see: (1) its Business OS calls; (2) Business OS calls on the platform account (Pass if 0); (3) legacy labels; (4) calls grouped by action; (5) the usage-card category view. Also area totals (calls, tokens, estimated cost) and truncation warnings. One business at a time is enough for now (user decision D-4, 2026-09-17); an all-businesses overview may come later and would need a database change (Layer 1.1 follow-up F-2). Requirement: [BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md). **Merged (PR #48)** | Layer 1 |
| **1.5** | **Four parts** (user decisions 2026-09-17; **SA approved 2026-09-17**, RC-1 to RC-20 applied; **merged**). Requirement: [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md).<br>**(a) Onboarding conversation** — the 4 calls per session are attributed to the **new owner's account** under a new `onboarding` area (`business-os-onboarding`), with one grouping id per conversation (option A). "Attributed" does not mean "charged": no deduction changes. Recorded user note **UD-1**: a brand-new business will see part of its first month's allowance already used, for its own onboarding conversation; the live run measures the real number so the allowance question can be decided with the deduction layer.<br>**(b) AI image generation** — images go through the provider layer and are recorded in **their own area `business-os-images`** (SA decision: not under `website`, so image spend is one readable figure in the area totals and per-token and per-image units never mix), with zero tokens, a dollar cost, a configurable model, size, quality and per-image price. **Track only, don't charge (option B).** Whether an image consumes credits, and how many credits one image is worth, is **parked** (OQ-7 stays open and is revisited with OI-1 and UD-1 in the deduction layer). Credits, the allowance, the ring and `remaining` do not move; call counts do, and nothing owner-facing renders them.<br>**(c) One shared platform-account helper** — a dependency-free `lib/platformAccount.ts` replaces the copies in `lib/analytics/aiAnalytics.ts:121`, `lib/services/EmbeddingService.ts:46` and `lib/orchestration/IntentClassifier.ts:179`, `:698`, and backs the catalog's `isPlatformAccount` / `platformAccountIds`. No behaviour change. `AuditTrailService.ts:121` is explicitly **not** a target (different rule).<br>**(d) Verification coverage** — the Layer 1.1 LLM Usage tab and report cover the new areas and the image call, otherwise Layer 1.5 has no proof.<br>**Folded in:** Layer 1.1 follow-ups **F-1** (the chat usage report's silent 10,000-row cap and its all-zero report on a failed read; its reads move onto `TokenUsageRepository`) and **F-6** (the allowance config read moves into `ConfigRepository`). **Out of scope:** OI-1. The `console.*` freeze: the user kept it on 2026-09-18 (D-6), so `aiAnalytics.ts` (16), `IntentClassifier.ts` (16) and `openaiProvider.ts` (4) were not converted in Layer 1.5; they were converted afterwards by the **logging clean-up (PR #50)**. *(The extended usage report previously listed here moved to Layer 1.1, 2026-09-17.)* | Layer 1, Layer 1.1 |
| **2** | Model, provider, temperature and on/off per call, stored as one JSON configuration per area, keyed by the Layer 1 call names; no hardcoded models — including the onboarding conversation's `'gpt-4o'` literals (Layer 1.5 KI-C / F-9) | Layer 1 call names |
| **3** | **AI activity audit trail** (standard #3, "every LLM call is recorded in the audit trail"). **User decisions 2026-09-18:** **D-1** one audit entry per AI action or background job — a chat turn, an insight run per business, a briefing, a website / intake / landing generation, a lead reply, an onboarding turn, an image request — linked to the per-call ledger rows through this layer's grouping ids (resolves investigation Q4); **D-2** it records who, area, action type, grouping id, number of calls, tokens, estimated cost, outcome, call names and model names, and **never** prompts, owner text or AI output; **D-3** background jobs write one entry per business per run, at info severity, marked scheduled, with the platform as actor; **D-4** the audit service is **kept exactly as it is** — entries use the existing queued path, so some may occasionally be lost (known risk **KI-B**), with immediate, awaited AI writes (~1–2 s cap) **recommended for later (OI-D)**; **D-5** the audit API routes are secured as step 0, before any AI entry is written; **D-6** AI entries are hidden from owners until the charging decision. Requirement: [BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md) — **SA approved 2026-09-18, ready for Dev workplan** | Layer 1 grouping ids; Layer 1.5 areas |
| **Later** | Cost accuracy; admin UI (usage + model config + audit); credits deduction and enforcement, including **whether AI images consume credits (OQ-7)**, the "credits remaining" treatment of background work (OI-1) and onboarding spend inside a new owner's first month (Layer 1.5 UD-1); immediate, awaited AI audit writes (Layer 3 OI-D) and a platform-wide durable audit write path (Layer 3 OI-A) | Layers 1–3 |

---

## Known Issues and Open Items

These were found during the investigation and SA reviews. **None is fixed in Layer 1.**

| Id | Type | Description (business terms) | Evidence | Status |
|---|---|---|---|---|
| **OI-1** | Open item | **"Credits remaining" drops from background work.** The usage card shows credits *remaining* against the monthly allowance. Once Layer 1 ships, the nightly insight run and the daily briefing count toward the business, so an owner who does nothing on a given day still sees "remaining" go down, and some businesses may reach zero. It is display only (nothing is blocked or charged), but it can confuse owners or look like unexplained consumption. Options to weigh later include not counting background work against the allowance, labelling it, or raising the allowance | `components/business-os/UsageCard.tsx:1-24`; FR-22 | Open — handle later, layer TBD (user decision 2026-09-17). Explicitly **out of scope for Layer 1.5** (user decision 2026-09-17); decided with the deduction layer, together with OQ-7 and Layer 1.5's UD-1 (onboarding spend inside a new owner's first month) |
| **OI-2** | Open issue (security) | **Website block regenerate can read another business's content.** The route that rewrites a website block looks the block up without checking that it belongs to the signed-in business. It then feeds that block's content to the AI and returns the rewrite. So someone who knows or guesses another business's block id can read that business's content | `app/api/website/blocks/[blockId]/regenerate/route.ts:55-61`, `:73`; unscoped `WebsiteBlockRepository.findById` (`WebsiteBlockRepository.ts:220-226`) | Open — handle later as a separate fix using the `tenant-isolation-guard` skill; out of Layer 1 (user decision 2026-09-17) |
| **OI-3** | Open issue (process) | **The new attribution type check doesn't block merges yet.** The `bos-llm-typecheck` CI workflow catches a missing business account, a misspelled or wrong-area call name, or a caller that stops passing the grouping id. Until it is marked as a required status check on `main`, a failing run is only a warning on the PR and the change can still be merged | `.github/workflows/bos-llm-typecheck.yml`; workplan §13.6 (SA S-6) | Open — needs someone with GitHub admin rights to add it under Settings → Branches → `main` → required status checks (user decision 2026-09-17) |
| **KI-1** | Known issue | **Chat "rewrite a section field" never works.** When the chat asks to rewrite one field of a website section, it sends the request in the wrong shape, so it fails before any AI call and the owner gets no rewrite. Layer 1 adds attribution there only so the code compiles, and doesn't fix it | `WebsiteSectionService.ts:519-529` sends `field` / `language` / `context`; `regenerateField` reads `fieldToRegenerate` / `targetLanguage` / `businessProfile` (`WebsiteAIContentService.ts:278-284`) | Open — separate fix |
| **KI-2** | Known issue | **Plan cache store may not run.** Storing a successful chat plan happens after the response is sent. On serverless it may never run, so that small embedding cost may go unrecorded (and the plan isn't cached) | `Planner.ts:640-648` (`void cache.store(...)`) | Pre-existing; not a Layer 1 defect |
| **KI-3** | Known issue | **Block-content AI generation is switched off.** Hero, about, FAQ and features block generation have no production trigger (all callers pass `useAI = false`). They are attributed in Layer 1 for completeness | `app/api/website/pages/route.ts:172`, `app/api/website/pages/[id]/enrich/route.ts:80`, `lib/services/WebsitePublishService.ts:367` | Informational |
| **KI-4** | Known issue | **Service generator AI never runs.** The service generator calls a method the AI provider doesn't have, so it always falls back to its non-AI output. There is no AI spend and no usage row. Excluded from Layer 1 | `lib/services/ServiceGeneratorService.ts:275`, `:304`, `:314` | Open — retire-vs-fix decided separately |
| **KI-5** | Known issue | **AI images aren't tracked as usage.** Generated website images call OpenAI directly, outside the provider layer, so they never appear in the usage ledger or on the usage card. They are limited only by a daily per-business image cap | `lib/services/GeneratedImageService.ts:170-187` | Moved to Layer 1.5 (user decision 2026-09-17). Layer 1.5 records them in their own `business-os-images` area and makes the spend visible to operators; the owner-facing view and charging stay parked with OQ-7 |
| **KI-6** | Known issue | **AI intake forms never work.** Intake form generation makes a real AI call (now correctly charged to the business), but validation rejects every question the model returns (`maxFiles` must be greater than 0, `showIfIndex` is null), so it always falls back to the generic 3-question form. The spend is wasted on every generation. Same class as the parked lead-reply parsing bug. Found in QA (P-1) | `lib/services/IntakeGenerationService.ts` (validation of the generated questions); workplan §14 | Parked — handle later (user decision 2026-09-17) |

---

## Open Questions

All six were resolved by SA on 2026-09-16 (details in the [SA Review](#open-question-decisions)).

- [x] **OQ-1 — Ledger fields.** Resolved: `feature` = `business-os-<area>`, `component` = call name, `session_id` = UUID grouping id; `activity_*` / `category` unchanged. Applied in FR-7, FR-8.
- [x] **OQ-2 — Consumers of renamed values.** Resolved: only the owner usage API mapping is affected. Legacy values map into the new categories (FR-21). The admin drill-down will show old and new values as separate buckets for historical periods (accepted; consolidated view in Layer 1.1, moved from Layer 1.5 on 2026-09-17).
- [x] **OQ-3 — Mandatory attribution on the simple helper.** Resolved: optional on the shared helper, required at the Business OS service layer through the typed builder. Applied in FR-11, FR-12, FR-26.
- [x] **OQ-4 — Insight run id.** Resolved: the cron `runId` exists and reaches all three insight calls; the group key is (account, `runId`); `runId` becomes required on the public repository methods on that path. Applied in FR-16.
- [x] **OQ-5 — Account source for website block content.** Resolved: passed explicitly from each caller, never derived from the profile. Applied in FR-19.
- [x] **OQ-6 — Plan cache store turn id.** Resolved: `request.turnId` is in scope at the store call; add it to the store arguments. Applied in FR-14; fire-and-forget caveat in AC-18 and KI-2.

User decisions requested by SA (answered 2026-09-17):

- [x] **Onboarding conversation** — not in Layer 1; added to the Excluded calls table and to Layer 1.5. *(Layer 1.5 decision D-3, 2026-09-17: attribute to the owner, option A, under a new `business-os-onboarding` area.)*
- [x] **"Credits remaining" drop from background work** — not solved now; recorded as OI-1, layer TBD. *(Confirmed out of scope for Layer 1.5, 2026-09-17, and joined there by UD-1.)*
- [x] **AI image generation spend in Layer 1?** (SA workplan review ruling (a)) — no; excluded and moved to Layer 1.5. *(Layer 1.5 decision D-1, 2026-09-17: track only, don't charge, option B, in its own `business-os-images` area.)*

Deferred to the deduction layer (not needed for Layer 1, and deliberately **not** answered by Layer 1.5):

- [ ] **OQ-7 — Should AI-generated images count against a business's monthly credits, and how many credits is one image worth?** (raised by: SA / BA | status: **open and parked by the user, 2026-09-17**). Images are priced per image, not per token, so today's rule (credits = tokens ÷ tokens per credit) can't express them. *BA suggestion:* decide together with OI-1 and Layer 1.5's UD-1, since all three are about what an owner's allowance should include. Layer 1.5 deliberately makes image spend visible first, in its own area, without charging for it, so the decision can be made on real numbers — see [Layer 1.5, "The parked charging decision"](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md).

---

## Notes on Integration Points

| Area | Files |
|---|---|
| New | `lib/business-os/llm/callCatalog.ts` (proposed path; FR-26) |
| Shared helpers | `lib/ai/providerFactory.ts` (`getProviderFactory().complete()`; Pino conversion), `lib/services/EmbeddingService.ts` (Pino conversion), `lib/ai/providers/baseProvider.ts` (`CallContext`, read only). `lib/analytics/aiAnalytics.ts` is **not modified** |
| Chat | `lib/business-os/bizql/planner/Planner.ts`, `bizql/analyse/AnalysisService.ts`, `bizql/cache/PlanCache.ts`, `bizql/planner/VerifiedQuestions.ts` (lookup and store), `app/api/business-os/chat-v4/route.ts` (analysis turn id; verified-question store caller); unchanged but relied on: `bizql/telemetry/ChatBudget.ts`, `bizql/telemetry/usageReport.ts`, `bizql/telemetry/turnUsage.ts` |
| Insights | `lib/business-os/insight/repository/InsightRepository.ts`, `app/api/cron/insight-detect/route.ts`, `scripts/verify-insights.ts` |
| Briefing | `lib/business-os/briefing/BriefingNarrator.ts`, `BriefingStore.ts`, `app/api/business-os/my-day/route.ts`, `DailyBriefingDispatchService.ts` |
| Website | `lib/services/WebsiteGenerationService.ts`, `lib/services/WebsiteAIContentService.ts`, `lib/services/WebsiteBlockEnrichmentService.ts`, `lib/services/WebsiteSectionService.ts` (compile-only), `MutateExecutor.ts`, `app/api/website/generate-from-profile/route.ts`, `app/api/website/landing-pages/generate/route.ts`, `app/api/website/blocks/[blockId]/regenerate/route.ts`, `app/api/website/enhance-testimonial/route.ts` |
| Intake | `lib/services/IntakeGenerationService.ts`, `app/api/intake/form/generate/route.ts`, `app/api/intake/form/infer-question/route.ts`, `app/api/onboarding/build/route.ts` (`:840` intake, `:881` website; optional shared UUID) |
| Leads | `lib/business-os/leads/LeadReplyRecommender.ts`, `LeadAlertService.ts` |
| Usage | `app/api/business-os/usage/route.ts` (mapping at `:65-89` extracted to an exported function); `components/business-os/UsageCard.tsx` (no change) |
| Excluded (must not change) | `AIDataLayerService.ts`, `IntentParser.ts`, `story/route.ts`, `WebsiteAnalyzer.ts` (dead and broken), `OnboardingConversationManager.ts`, `ServiceGeneratorService.ts`, `GeneratedImageService.ts` |
| DB | `token_usage` (writes only; **no schema change**) |

The Business OS Insights module has its own skill and as-built doc ([BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md)). Dev should use it when touching `lib/business-os/insight/**` or the insight crons.

---

## SA Review

**Reviewed by SA — 2026-09-16**
**Status:** Approved with changes. **BA applied all required changes on 2026-09-17; user decisions answered 2026-09-17.**

**Verdict: APPROVED WITH CHANGES.** The scope is right-sized and the approach fits the existing ledger. No schema change is needed. The 15 required changes below (RC-1 to RC-15) mostly tighten wording and ACs so they match the code. BA applies them to the FRs and ACs, then the Dev workplan can start. Two items need a business answer (see [Items needing a user decision](#items-needing-a-user-decision)). RC-7 depends on the first one.

All claims below were checked with text search on branch `feature/business-os-purge-slice-2`.

### Open Question decisions

#### OQ-1 — Ledger fields: `feature` = area, `component` = call name, `session_id` = grouping id

| What | Column | Value | Evidence |
|---|---|---|---|
| Area | `feature` | `business-os-<area>`: `business-os-chat` (unchanged), `business-os-insights`, `business-os-briefing`, `business-os-website`, `business-os-intake`, `business-os-leads` | Chat already conforms. `ChatBudget.ts:161` and `usageReport.ts:187`, `:358` key only on `business-os-chat` |
| Call name | `component` | Catalog call name, e.g. `planner`, `full_site` | Nothing reads Business OS `component` values. `BizQLPlanner`, `BizQLAnalysis`, `InsightRepository`, `LeadReplyRecommender`, `LandingPageGenerateAPI`, `daily-briefing` and `simple-complete` appear only where they are written. The drill-down treats `component` as a free-form filter/group key (`drill-down/route.ts:213`, `:507-508`) |
| Grouping id | `session_id` | A **UUID** | The column is `uuid`. `chat-v4/route.ts:326-336` says so, and `aiAnalytics.ts` (`validSessionId`, right after the user-id fallback) sets any non-UUID to NULL. The chat daily limit counts distinct `session_id` (`ChatBudget.ts:97`), and the usage report groups by it (`usageReport.ts:112-113`) |

**Rejected alternatives:**
- `activity_type` / `activity_name` are already taken by chat. They carry the repair marking (`Planner.ts:490`) and the cache-hit layer (`turnUsage.ts:108-109`), which `usageReport.ts:129-142` reads (FR-15). Embeddings also set them (`EmbeddingService.ts:119-120`).
- `workflow_step` / `execution_id` mean something specific on the agents side (`runAgentKit.ts`, `StepExecutor.ts`).

**Leave unchanged:** existing `activity_type` values (`plan`/`repair`, `embedding`, `narration`) and `category` values. Layer 1 adds no new activity values.

#### OQ-2 — Consumers of renamed values: only the owner usage route

The search covered `app`, `lib`, `components`, `scripts`, `supabase` (SQL) and all `*.test.ts`. The only code keyed on a value that changes is the `CATEGORIES` map in `app/api/business-os/usage/route.ts:49-69` (`landing-page-generation` at `:64`, `health-summary-generation` at `:65`).

**Not affected:**
- `ChatBudget.ts:161` and `usageReport.ts:187`, `:358`: chat value unchanged.
- Admin drill-down: generic `feature`/`component` filters. Its category lists (`drill-down/route.ts:159-182`, `:1081+`) key on `activity_type`/`category`, which don't change.
- No tests, scripts, migrations or SQL functions use the old values.
- `UsageCard.tsx` doesn't read the breakdown (`:20-24`).

**Consequence (accepted):** the admin drill-down will show old and new values as separate buckets for historical periods. No backfill (FR-25). The consolidated view is Layer 1.5. *(2026-09-17: moved to Layer 1.1.)*

#### OQ-3 — Simple helper: optional context, required for Business OS through a typed builder

`getProviderFactory().complete()` (`providerFactory.ts:291-333`) gets an optional `context?: CallContext`.
- **Context given:** it is passed to `chatCompletion` as is.
- **Context absent:** today's default (`system` / `onboarding` / `simple-complete`, `:324-328`) stays byte-for-byte.
- The misleading "no tracking" comment (`:323`) gets corrected.

**Business OS callers can't forget the context,** because it is required by type at the Business OS layer (RC-8). The service methods that call `complete()` take a required attribution parameter. The shared helper stays backward-compatible.

**Non-Business OS callers (unchanged in Layer 1):**
- `lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397`. Live through `app/api/onboarding/chat/route.ts:99`; see business decision 1. *(Layer 1.5 converts these four to the catalog builder, with required attribution on `processUserMessage`, after which they are the last context-less callers to be closed.)*
- `lib/services/WebsiteAnalyzer.ts:123` (dead, excluded). *(CR-1, 2026-09-17: not a working caller. It calls non-existent methods (`getDefaultModel`, `complete` on the wrong type), so its LLM call always fails. The only live non-BOS caller is the onboarding conversation. FR-12 corrected.)*

**Rejected:** making the context mandatory for every caller would pull the onboarding conversation into scope.

#### OQ-4 — Insight run id: yes, `runId` exists and reaches all three LLM calls

- `runId = crypto.randomUUID()` is created once per cron invocation (`app/api/cron/insight-detect/route.ts:142`).
- It is passed to `createBatch` (`:232`), `saveCorrelationResults` (`:245-250`) and `createOrUpdateHealthSummary` (`:262-267`).
- In the repository it is already in scope where each LLM call happens:
  - `create()` → `generateLocalizedContent` (`InsightRepository.ts:398`, `:449`);
  - `createCorrelatedInsight(…, runId)` → `generateCorrelatedContent` (`:1508`, `:1577`);
  - `createOrUpdateHealthSummary(…, runId)` → `generateHealthNarrative` (`:1851`, `:1891`).
- The same value is already stored as `insights.detection_run_id` (`:422`, `:460`), so ledger rows join to the insights they produced.
- The only callers are the cron and `scripts/verify-insights.ts:98`, and both pass `runId`.

**Decisions:**
- **(a)** `runId` covers every call in a run for all businesses. The grouping key is **(`user_id`, `session_id`)**, not `session_id` alone (RC-2). Don't mint a separate id per business.
- **(b)** In the cron, the health summary shares the run's id. "A health summary generation is its own group" is dropped, because no other health-summary generator exists. `call_name` already tells the three calls apart.
- **(c)** `runId` becomes required on those three repository methods (both callers already pass it). *Workplan review 2026-09-17: extended to all five public methods on the path, see FR-16.*

#### OQ-5 — Website block content: pass the account explicitly, never derive it from the profile

`BusinessProfileData` has no account field (`WebsiteAIContentService.ts:33-39`), so the account can't come from the profile. Each public method takes an explicit attribution argument from its caller:
- `generateBlockContent` (`:228`)
- `regenerateField` (`:278`)
- `enhanceTestimonial` (`:317`)

The attribution is passed down to the private generators (`:352`, `:396`, `:525`, `:582`). Where each caller gets the account:

| Caller | Account source | Grouping |
|---|---|---|
| `app/api/website/blocks/[blockId]/regenerate/route.ts:68` | `getUser()` → `user.id` (`:40`) | New UUID per request |
| `app/api/website/enhance-testimonial/route.ts:35` | `getUser()` → `user.id` | New UUID per request |
| `lib/services/WebsiteBlockEnrichmentService.ts:418`, `:624`, `:1018`, `:1078` | `userId`, already a parameter of `enrichBlock`/`enrichBlocks` (`:154-155`, `:227-228`) | The build's id, supplied by the caller (new UUID if none) |
| `lib/services/WebsiteSectionService.ts:519` (from `MutateExecutor.ts:936`) | `params.userId`, set server-side from `ctx.userId` | New UUID per operation; see RC-6 |

**Finding:** rows 17c–f are **unreachable in production**. All three `enrichBlocks`/`enrichBlock` callers pass `useAI = false`: `app/api/website/pages/route.ts:172`, `app/api/website/pages/[id]/enrich/route.ts:80`, `lib/services/WebsitePublishService.ts:367`. See RC-5.

#### OQ-6 — Plan cache store: the turn id is in scope at the store call

- `PlanCache.store()` is called from exactly one place, `Planner.ts:640-648`, as `void cache.store({… userId: request.userId …})`.
- `request.turnId` is already in scope there; the planner call uses it at `Planner.ts:485`.
- **Fix shape:** add `turnId` to the `store` args (`PlanCache.ts:282-289`) and pass `{ userId, feature, turnId, callName }` to `generateEmbedding` at `PlanCache.ts:333`, the same way the lookup does at `:226-230`.
- **Caveat (pre-existing, not a Layer 1 defect):** the store is fire-and-forget. On serverless the embedding may never run after the response is sent, so a missing 3b row in the QA run doesn't fail AC-18.

### Other checks

| Check | Result |
|---|---|
| **Rule 7: new pattern** | Yes. A Business OS LLM call catalog plus a context builder is a new pattern. **SA approves it** in the shape set out in RC-8. It belongs under `lib/business-os/`, not `lib/ai/`, so the shared provider layer stays product-agnostic |
| **Tenancy: account source** | All server-side, never from client input. Routes use `getUser()`. The insight cron iterates user ids read from the database. Leads use `ownerId`, resolved server-side from the site subdomain or `user_code` (`app/api/website/forms/contact/route.ts:66-98`, `app/api/conversion/contact/route.ts:74`). Briefing uses `user.id` (`app/api/business-os/my-day/route.ts:119`) or the dispatch job's `userId` (`DailyBriefingDispatchService.ts:222`). Chat mutate uses `ctx.userId`. **Rule for the workplan:** no attribution field may be read from a request body, query string or header |
| **FR-3 vs the `aiAnalytics` fallback** | **Conflict.** A missing or non-UUID user id is rewritten to `SYSTEM_ADMIN_USER_ID` / all-zero before insert (`aiAnalytics.ts:120-130`). So AC-12's "no usage row is written under the system user" could only hold by skipping the ledger write, which would lose real spend. Resolved in RC-3 |
| **Scope: call sites** | All 18 investigation rows checked. Gaps: onboarding conversation (4 calls, not listed; decision 1). Rows 17c–f are unreachable (RC-5). The chat "rewrite a section field" path is broken (RC-6). Chat-created landing pages use the `full_site` generator (RC-13) |
| **User-visible beyond the usage card** | (1) The card counts **down** "credits remaining" against the monthly allowance (`UsageCard.tsx:1-24`). Automatic work (insights cron, briefing) now reduces "remaining" with no owner action (decision 2). (2) Plan-cache store embeddings now count toward the chat daily **token** ceiling (`ChatBudget.ts:99-105`), about tens of tokens per stored plan; SA accepts this under RC-4. Nothing else is visible |
| **Touched files still using `console.*`** | `lib/ai/providerFactory.ts` (8), `lib/services/EmbeddingService.ts` (16). The workplan must flag both and propose Pino conversion per CLAUDE.md. `lib/analytics/aiAnalytics.ts` (16) **must not be touched**: RC-3 removes the need. *(2026-09-17: providerFactory count corrected to 6 real calls; conversion of both approved by the user for this cycle. The `aiAnalytics.ts` conversion resurfaced in the Layer 1.5 review as F-8 / OQ-U2; on 2026-09-18 the user kept the freeze, so it became Layer 1.5 open item OI-4, since done by the logging clean-up, PR #50.)* |
| **Out-of-scope security finding (for TL, not Layer 1)** | `app/api/website/blocks/[blockId]/regenerate/route.ts:55-61` says "Verify block ownership" but calls `WebsiteBlockRepository.findById(blockId)`, which has no user scope (`WebsiteBlockRepository.ts:220-226`). Another business's block content is then fed into the prompt (`:73`) and the rewrite is returned. This is a cross-tenant read. Track it as a separate fix with the `tenant-isolation-guard` skill. Layer 1 must not expand to fix it. **→ Recorded as OI-2 (2026-09-17)** |

### Required changes (BA to apply)

1. **RC-1 (FR-7, FR-8, OQ-1):** Record the column mapping from OQ-1 in FR-7. Add to FR-8 that every grouping id is a UUID. A caller's `x-correlation-id` may be reused only when it is a UUID (the `chat-v4/route.ts:326-336` rule); otherwise use `crypto.randomUUID()`. — **Applied 2026-09-17:** FR-7, FR-8, catalog "Areas and how they are recorded" and "Grouping ids".
2. **RC-2 (grouping table, FR-16, AC-10):** Insights: one group = the cron `runId` for one business. The group key is (`user_id`, `session_id`), and the health summary shares the run's group. Change AC-10 for insights to: "two businesses in one run share `session_id` but differ by `user_id`; a second run has a different `session_id`." — **Applied 2026-09-17:** grouping table, rows 7–9, FR-16, AC-10(b).
3. **RC-3 (FR-3, AC-12):** Rewrite FR-3:
   - A missing account is prevented at compile time: the attribution type requires `userId`.
   - If the runtime value isn't a valid UUID, the builder emits an error-level log naming area, call name and correlation id.
   - The call still completes, and the ledger row is still written (the existing tracker fallback places it on the system user, where the Layer 1.5 system-user count will catch it).
   - Spend is never dropped.
   - `aiAnalytics.ts` is not modified.

   AC-12 becomes: "error-level log emitted, call completes, provider called once". Remove "no usage row is written under the system user". AC-19 stays the real-environment proof. — **Applied 2026-09-17:** FR-3, AC-12, NFR Reliability, Out of Scope (aiAnalytics row).
4. **RC-4 (FR-23):** Add an explicit carve-out. The plan-cache store embedding (row 3b) now counts toward the chat daily token ceiling and the chat usage report's call count and cost per turn. This follows directly from FR-14 and is accepted. AC-17's unit tests are unaffected. — **Applied 2026-09-17:** FR-23 carve-out (a).
5. **RC-5 (rows 17c–f, AC-5, AC-18):** Keep `hero_content`, `about_content`, `faq_content` and `features_content` in the catalog and attribute them (`userId` is already available in `WebsiteBlockEnrichmentService`), but note they have no production trigger today (`useAI = false` at all three callers). Verify them by automated tests (AC-5, AC-8) only, and drop them from AC-18's real-environment list. — **Applied 2026-09-17:** catalog, row 17c–f, FR-19, AC-5, AC-18, KI-3.
6. **RC-6 (known issues, FR-24):** Add a known issue. The chat "rewrite a section field" path passes the wrong request shape (`WebsiteSectionService.ts:519-529` sends `field`/`language`/`context`, but `regenerateField` reads `fieldToRegenerate`/`targetLanguage`/`businessProfile`, `WebsiteAIContentService.ts:278-284`). It always throws before any LLM call. Layer 1 only adds the attribution argument there so it compiles, and must not fix the shape. QA exercises `field_regenerate` through the website builder route only. — **Applied 2026-09-17:** KI-1, FR-19, FR-24, AC-18, AC-24.
7. **RC-7 (AC-19, exclusions):** List the Business OS feature values AC-19 queries: the six `business-os-*` values plus the legacy `insight-generation`, `correlated-insight-generation`, `health-summary-generation`, `landing-page-generation`, `lead-reply` and `business-os`. **Exclude `onboarding`**: the out-of-scope onboarding conversation keeps writing `system`/`onboarding`. Add the onboarding conversation to the Excluded calls table, or to scope, depending on decision 1. — **Applied 2026-09-17:** AC-19 value list with `onboarding` excluded; onboarding conversation added to Excluded calls (decision 1 = exclude, Layer 1.5); AC-21.
8. **RC-8 (NFR Maintainability, Rule 7):** Name the new pattern. One module, `lib/business-os/llm/callCatalog.ts` (final path fixed in the workplan), exporting:
   - `BOS_LLM_AREAS` and a per-area call-name map, `as const`;
   - a `BosLlmAttribution` type (`userId`, `area`, `callName`, `groupId`) with the call name type-narrowed to its area;
   - one builder that returns a `CallContext` (feature from area, component from call name, `sessionId` from group id), preserves any extra fields the caller passes (`activity_type` for repair, etc.) and performs the RC-3 validation/log;
   - the briefing group-id helper (RC-11).

   Every in-scope call site uses the builder. No free-typed feature, component or call-name strings at call sites. — **Applied 2026-09-17:** new FR-26, AC-22, AC-24, NFR Maintainability, Integration Points.
9. **RC-9 (FR-11, FR-12, FR-13):** Record the OQ-3 design. For FR-13, `generateEmbedding`'s existing optional `attribution` gains `callName`. Business OS callers pass it through the builder. The help bot default and the batch path (`EmbeddingService.ts:113-121`, `:172-179`) stay byte-identical. — **Applied 2026-09-17:** FR-11, FR-12, FR-13, AC-6, AC-13. *FR-12 and AC-7 corrected by CR-1 (2026-09-17): the onboarding conversation is the only live non-BOS caller; WebsiteAnalyzer is dead.*
10. **RC-10 (NFR Logging):** Name `providerFactory.ts` and `EmbeddingService.ts` as touched non-compliant files the workplan must flag and propose converting. State that `aiAnalytics.ts` is not touched. — **Applied 2026-09-17:** NFR Logging, AC-24. *Conversion of both approved by the user for this cycle (2026-09-17).*
11. **RC-11 (FR-10 grouping sources):** Add the table below. Rule: the entry point that represents the user action or job owns the id. Services accept it as a parameter and don't mint their own when a caller has one.

    | Area | Grouping id source |
    |---|---|
    | chat | Existing `turnId` (unchanged) |
    | insights | `runId` (`insight-detect/route.ts:142`) |
    | briefing | Deterministic UUID v5 from (`userId`, `facts.day.date`), implemented in the catalog module with Node `crypto` (*superseded 2026-09-17: `uuid@13` is ESM-only and does not load under the Jest config; see workplan §13 ruling (c)*). Re-narrations on the same day, after facts change (`BriefingStore.ts:42-51`), share the group. The helper lives in the catalog module |
    | website | New UUID at each entry point: `app/api/website/generate-from-profile/route.ts`, `app/api/website/landing-pages/generate/route.ts`, the regenerate and enhance-testimonial routes, and `MutateExecutor.ts:806-808` (chat has no `turnId` in mutate context; don't thread it through) |
    | intake | New UUID at `app/api/intake/form/generate/route.ts:47` and `app/api/intake/form/infer-question/route.ts` |
    | onboarding build | `app/api/onboarding/build/route.ts:739`, `:777` may pass **one** UUID to both intake and website generation, since it is one owner action. Permitted, not required. *(Lines refreshed 2026-09-17: `:840` intake, `:881` website.)* |
    | leads | New UUID minted in `LeadAlertService.ts` before `recommendLeadReply` (`:334`). **Not** `contactId`: one contact can send several enquiries |

    — **Applied 2026-09-17:** catalog "Grouping ids" table, FR-10, FR-17, FR-18, FR-20, AC-10, AC-23.
12. **RC-12 (AC testability):**
    - **AC-14:** the category mapping must be extracted from `app/api/business-os/usage/route.ts` into an exported pure function. No test exists for this route today.
    - **AC-15:** relabel as a code-review check (diff inspection), not an automated test.
    - **AC-18:** add the 3b fire-and-forget caveat (OQ-6) and the RC-5/RC-6 exclusions.

    — **Applied 2026-09-17:** FR-21, AC-14, AC-15 moved under code review checks, AC-18.
13. **RC-13 (catalog):** State that chat-created landing pages (`MutateExecutor.ts:806-815`) use `WebsiteGenerationService.generateWebsite` and are recorded as `website` / `full_site`. The call name follows the generator, which is also the Layer 2 config key. `landing_page` is only the dedicated route (row 16). — **Applied 2026-09-17:** catalog (`full_site`, `landing_page`), row 15, FR-19.
14. **RC-14 (FR-15, AC-8, AC-9):** State that the zero-token cache-hit row (`turnUsage.ts:95-111`, component `BizQLPlanCache`) is not an LLM call, isn't in the catalog and is left unchanged. AC-8 doesn't cover it; AC-11 keeps covering its marking. — **Applied 2026-09-17:** catalog "Not in the catalog", FR-15, AC-8.
15. **RC-15 (FR-21):**
    - `onboarding` stays mapped to `help`. It is still written, with real users, by `OnboardingChatService.ts:126`, `:223` and `app/api/onboarding/generate-prompt-ideas/route.ts:130`.
    - Map both the new and the legacy values into the new categories, so a 30-day window that straddles the release doesn't split:
      - `website` ← `business-os-website`, `landing-page-generation`;
      - `insights` ← `business-os-insights`, `health-summary-generation`, `insight-generation`, `correlated-insight-generation`;
      - `briefing` ← `business-os-briefing`, `business-os`;
      - `intake` ← `business-os-intake`;
      - `leads` ← `business-os-leads`, `lead-reply`.

    — **Applied 2026-09-17:** FR-21, AC-14.

### Items needing a user decision

1. **Onboarding conversation.** When a new owner chats through onboarding, 4 AI calls per session are still recorded on the platform account, not the business. They aren't in the Layer 1 list. **SA recommendation:** leave them out of Layer 1 to keep scope tight, and list them as an explicit exclusion. — **User decision 2026-09-17:** not in Layer 1; added to Layer 1.5 in the roadmap, next to the extended usage report. Applied to Excluded calls, Out of Scope and Layers Roadmap. *(The extended usage report later moved to Layer 1.1, 2026-09-17. Layer 1.5 decision D-3, 2026-09-17: the calls are attributed to the owner; its SA review added user note UD-1 about a new owner's first-month allowance.)*
2. **"Credits remaining" on the usage card.** The card shows credits **remaining** against the monthly allowance, not credits used. After release, automatic work (the daily insight run and the daily briefing) lowers "remaining" even on days the owner does nothing, and some businesses may show zero remaining. It is display-only: nothing is blocked. The 2026-09-16 acceptance says "totals may rise". Please confirm it also covers "remaining may drop, possibly to zero, from automatic work." — **User decision 2026-09-17:** don't solve now; record as an open item to handle later, layer TBD. Applied as OI-1 and FR-22. *(Confirmed out of scope for Layer 1.5, 2026-09-17.)*

**Also recorded (user decision 2026-09-17):** the cross-tenant read in the website block regenerate route is an open issue to handle later, out of Layer 1 scope → OI-2.

### Requirement to-dos from the SA workplan review (2026-09-17)

Source: [workplan §13](/docs/workplans/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_WORKPLAN.md), "Requirement text changes for BA (non-blocking)".

- **RQ-1 — Excluded calls.** `ServiceGeneratorService.ts:304` (broken, no LLM spend) and `GeneratedImageService.ts:186` (direct SDK image generation, not in the ledger). — **Applied 2026-09-17:** Excluded calls table, KI-4, KI-5, AC-21, AC-24, Out of Scope, Integration Points. User decision 2026-09-17: image generation moved to **Layer 1.5** (Layers Roadmap 1.5(b), previously 1.5(c)), with open business question OQ-7. *(Layer 1.5 decision D-1, 2026-09-17: tracked but not charged, in its own `business-os-images` area; OQ-7 stays parked.)*
- **RQ-2 — Verified question store embedding.** Separate call name for `VerifiedQuestions.remember()`. — **Applied 2026-09-17:** catalog `verified_question_store_embedding` (lookup reworded as "match (look up)"), per-call row 4b, AC-8, AC-9, Integration Points.
- **RQ-3 — Chat analysis always uses the turn id** (ruling (b), T14). — **Applied 2026-09-17:** FR-9, per-call row 2, AC-9.
- **RQ-4 (optional) — Stale line references.** — **Applied 2026-09-17:** row 1 `Planner.ts:444`; usage mapping `:65-89` (FR-5, FR-21, Integration Points); onboarding build `:840` / `:881` (grouping table, Integration Points, RC-11 annotation); providerFactory 6 `console.*` calls (NFR Logging, Other checks annotation). SA evidence text elsewhere is kept as reviewed.

**Also recorded:** Pino conversion of `providerFactory.ts` and `EmbeddingService.ts` approved by the user for this cycle (2026-09-17). Applied in NFR Logging and AC-24.

### Requirement correction from the SA code review (2026-09-17)

- **CR-1 — WebsiteAnalyzer is not a working caller of the simple helper.** FR-12 described `lib/services/WebsiteAnalyzer.ts` as a non-BOS caller that "keeps working unchanged". SA verified it is dead and broken: it calls non-existent methods (`getDefaultModel`, and `complete` on the wrong type), so its LLM call always fails. This matches investigation row 18. — **Applied 2026-09-17:**
  - FR-12 now names the onboarding conversation as the only live non-BOS caller;
  - AC-7 tests only that caller;
  - the Excluded calls reason for WebsiteAnalyzer is now "dead and broken, no LLM spend; fix vs retire decided separately";
  - AC-21, AC-24 and Integration Points list WebsiteAnalyzer explicitly;
  - OQ-3 and RC-9 are annotated.

  No scope change: WebsiteAnalyzer was already excluded and untouched.

### Approval

- [x] Requirement approved for Dev workplan, **conditional on** BA applying RC-1 to RC-15 and the user answering decisions 1–2. RC-7 wording depends on decision 1.
- [x] Conditions met 2026-09-17: RC-1 to RC-15 applied by BA; decisions 1–2 answered by the user. **Ready for Dev workplan.**
- [x] SA workplan-review requirement to-dos RQ-1 to RQ-4 applied by BA (2026-09-17). Non-blocking for implementation.
- [x] SA code-review requirement correction CR-1 applied by BA (2026-09-17). Docs only.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-16 | Created (Draft) | Layer 1 requirement written from the investigation and the user's decisions of 2026-09-16: attribution, area/call naming, grouping ids, shared helper fix, usage card mapping; excluded calls; Layer 1.5 report moved out; indicative layers roadmap |
| 2026-09-16 | SA review — Approved with changes | Added SA Review section: OQ-1–OQ-6 resolved with code evidence (feature=`business-os-<area>`, component=call name, session_id=UUID grouping id; optional context on `complete()`; cron `runId`; explicit website attribution; turnId in scope at plan-cache store); 15 required changes (RC-1–RC-15); 2 user decisions (onboarding conversation exclusion, "credits remaining" drop from automatic work); out-of-scope cross-tenant finding on the block regenerate route; OQs marked resolved; status updated |
| 2026-09-17 | RCs applied + user decisions — ready for Dev workplan | Applied RC-1–RC-15: ledger mapping and UUID grouping ids (FR-7, FR-8), grouping-source table (FR-10), insights group key and required `runId` (FR-16), FR-3 rewritten (log, never drop spend, `aiAnalytics` untouched), FR-23 carve-out for plan-cache embeddings, rows 17c–f test-only, chat section-field path compile-only (KI-1), AC-19 feature list excluding `onboarding`, new FR-26 call catalog and builder, optional context on `complete()` and embedding call name, Pino flags for `providerFactory.ts`/`EmbeddingService.ts`, briefing UUID v5 and per-enquiry lead UUID, exported category mapping with legacy values, AC-15 as code review. User decisions 2026-09-17: onboarding conversation excluded and added to Layer 1.5; "credits remaining" drop recorded as OI-1 (layer TBD); block regenerate cross-tenant read recorded as OI-2. Added Known Issues and Open Items section, AC-22–AC-24. Status → SA approved, ready for Dev workplan. Final count: 26 FRs, 24 ACs |
| 2026-09-17 | SA trivial wording alignment (workplan review) | Aligned with SA workplan rulings (workplan §13, 2026-09-17), no scope change: FR-16 and OQ-4(c) `runId` required on all five public insight repository methods (ruling d); FR-3 and AC-12 log names the correlation id, or the grouping id where no request correlation id exists; AC-14 asserts exact token and call sums, not rounded credits (ruling e); NFR Logging `providerFactory.ts` count 8 → 6 real calls; RC-11 `uuid` dependency hint marked superseded by Node `crypto` UUID v5 (ruling c). Pending BA: RQ-1 to RQ-4 in workplan §13 |
| 2026-09-17 | BA applied SA workplan-review to-dos RQ-1–RQ-4 + user decisions | RQ-1: `ServiceGeneratorService.ts:304` (broken) and `GeneratedImageService.ts:186` (direct image SDK, not in ledger) added to Excluded calls, with KI-4/KI-5; AI image generation moved to Layer 1.5(c) (user decision 2026-09-17) with open business question OQ-7 (do images count against monthly credits, and how many credits per image). RQ-2: new chat call name `verified_question_store_embedding` (row 4b), lookup reworded; AC-8/AC-9 cover rows 4 and 4b. RQ-3: FR-9, row 2 and AC-9 state chat analysis always uses the turn id (T14; no visible change). RQ-4: line refs refreshed (`Planner.ts:444`, usage mapping `:65-89`, onboarding build `:840`/`:881`). User approval 2026-09-17 of Pino conversion for `providerFactory.ts` and `EmbeddingService.ts` recorded in NFR Logging and AC-24. No FR/AC added or removed: 26 FRs, 24 ACs |
| 2026-09-17 | BA applied SA code-review correction CR-1 (docs only) | FR-12 no longer treats `WebsiteAnalyzer.ts` as a working non-BOS caller of `getProviderFactory().complete()`: SA verified it is dead and broken (calls non-existent `getDefaultModel` and `complete` on the wrong type; its LLM call always fails). The onboarding conversation is the only live non-BOS caller. AC-7 narrowed to that caller. Excluded calls reason for WebsiteAnalyzer set to "dead and broken, no LLM spend; fix vs retire decided separately"; AC-21, AC-24 and Integration Points name it; OQ-3 and RC-9 annotated. No scope change; 26 FRs, 24 ACs |
| 2026-09-17 | QA finding parked | Added KI-6: AI intake form generation always falls back because validation rejects the model's questions (QA P-1, workplan §14). Pre-existing, not caused by Layer 1; parked per user decision 2026-09-17. No scope change |
| 2026-09-17 | Open issue added | Added OI-3: the `bos-llm-typecheck` CI check is not yet a required status check on `main`, so a failure warns but does not block a merge. Needs GitHub admin (SA S-6); recorded as open per user decision 2026-09-17. No scope change |
| 2026-09-17 | Roadmap: Layer 1.1 added (user decision) | Added Layer 1.1, the admin-only LLM Usage verification tab on `/test-business-os` and its report API ([Layer 1.1 requirement](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md)). It takes over the extended usage report, removed from Layer 1.5 (now: onboarding conversation calls, AI image tracking). Out of Scope row, FR-3 note, OQ-2 and SA-review annotations updated to point at Layer 1.1. Layer 1 scope unchanged; 26 FRs, 24 ACs |
| 2026-09-17 | Roadmap: Layer 1.1 scope decision recorded | Layer 1.1 roadmap row now records user decision D-4 (OQ-U1): one business at a time plus the platform-wide check is enough for now; an all-businesses overview would need a database change (Layer 1.1 F-2). Wording only; Layer 1 scope unchanged |
| 2026-09-17 | Layer 1.5 follow-up added | Roadmap 1.5(c): replace the repeated platform-account fallback (`SYSTEM_ADMIN_USER_ID` or the all-zero id) in `aiAnalytics.ts`, `EmbeddingService.ts`, `IntentClassifier.ts` (×2) and `callCatalog.ts` with one shared helper; no behaviour change (user decision). No FR/AC change |
| 2026-09-17 | Roadmap: Layer 1.5 scoped and its requirement written | Layer 1.5 is now four parts and links to [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md): (a) onboarding conversation attributed to the owner (D-3, "attributed" ≠ "charged"); (b) AI images tracked with a configurable model and per-image price but **not charged** (D-1/D-2) — **OQ-7 and credits-per-image are parked** and move to the deduction layer, with OI-1 **out of Layer 1.5 scope** (D-4); (c) one shared platform-account helper; (d) Layer 1.1 verification coverage for both (D-5). Layer 1.1 follow-ups F-1 and F-6 folded into Layer 1.5. Excluded-calls rows, Out of Scope rows, FR-3, FR-21, AC-19, KI-5, OI-1, OQ-3 and OQ-7 annotated to point at Layer 1.5. Layer 1 scope unchanged; 26 FRs, 24 ACs |
| 2026-09-17 | Roadmap mirror: Layer 1.5 SA decisions | Mirrored the Layer 1.5 SA review (RC-1 to RC-20 applied): images are recorded in **their own area `business-os-images`**, not under `website` (SA override of the BA proposal), and the onboarding conversation under a new `business-os-onboarding` area, both with **empty legacy-feature lists** so Check 2 and the `help` mapping are unaffected; the shared helper is a dependency-free `lib/platformAccount.ts` and `AuditTrailService.ts:121` is explicitly not a target; Layer 1.5 records user note **UD-1** (a new owner's first month shows its own onboarding conversation already spent — measured by its live run, decided with the deduction layer alongside OI-1 and OQ-7) and follow-up **F-8** (`aiAnalytics.ts` Pino conversion, pending the user). Updated: the two Excluded-calls rows, the areas table note, FR-3, FR-21, AC-19, the Out of Scope rows, the Layers Roadmap 1.5 and Later rows, OI-1, KI-5, OQ-3, OQ-7, the user-decision notes, the `console.*` row and RQ-1. Layer 1 scope unchanged; 26 FRs, 24 ACs |
| 2026-09-18 | Roadmap mirror: `console.*` freeze | Layer 1.5 F-8 / OQ-U2 resolved by the user (keep the freeze): `aiAnalytics.ts`, `IntentClassifier.ts` and `openaiProvider.ts` are not converted in Layer 1.5; tracked as Layer 1.5 open items OI-4 to OI-6. No FR/AC change |
| 2026-09-18 | Layer 1.5 implemented (code complete) | Layer 1.5 is implemented on `feature/business-os-llm-layer1-5` and awaits SA code review: [workplan](/docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md). Two implementation facts for the roadmap row: the image `quality` is pinned to `high` (the call used to omit it and take the provider's `auto`, which is not a price point), and the documented per-image fallback prices live beside the other image defaults in `SystemConfigRepository`. Nothing else in the 1.5 row changed |
| 2026-09-18 | Correction: Layer 1.5 image quality | Supersedes the "quality is pinned to `high`" note in the row above. SA code review CR-1 and user decision (Layer 1.5 D-7, option C): image requests keep quality `auto` (images and cost unchanged), and each image is priced after the call at the quality the provider reports (model + size + reported quality; no reported quality → priced at `high` with a warning). Quality stays configurable (`image_generation_quality`, default `auto`). No FR/AC change here |
| 2026-09-18 | Roadmap: Layer 3 (AI activity audit trail) added; Layer 1.5 and the logging clean-up merged | New roadmap row **3** for standard #3, linking the [Layer 3 requirement](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md) (draft): one audit event per AI action or background job, joined to the ledger by this layer's grouping ids; never prompts, owner text or AI output; proposed BD-1 (per action), BD-3 (audit background jobs, recommended) and BD-4 (durable events, recommended). "Per-action audit events" moved from Later and from the Out of Scope table to Layer 3; Later now also lists a platform-wide durable audit path (Layer 3 OI-A). Layer 1.1 and 1.5 rows marked merged; the Layer 1.5 `console.*` note, FR-3, the `aiAnalytics.ts` Out of Scope row and the SA `console.*` check record that the three conversions were done by the logging clean-up (PR #50). A note under the grouping table points at Layer 3. Layer 1 scope unchanged; 26 FRs, 24 ACs |
| 2026-09-18 | Roadmap mirror: Layer 3 user decisions | Layer 3 row now records the user's decisions of 2026-09-18: **D-1** one entry per action or job (resolves investigation Q4); **D-2** recorded fields including call and model names, never content; **D-3** background jobs one entry per business per run, info, scheduled, platform as actor; **D-4** the audit service kept as it is — occasional loss is Layer 3's accepted known risk **KI-B**, and immediate awaited AI writes (~1–2 s cap) are recommended for later as **OI-D**. The "durable events" proposal is withdrawn from the row; Later adds OI-D beside OI-A; the Out of Scope row notes the decisions. Layer 1 scope unchanged; 26 FRs, 24 ACs |
| 2026-09-18 | Roadmap mirror: Layer 3 SA approved | Layer 3 row and its Out of Scope row now say SA approved (RC-1 to RC-12 applied), ready for Dev workplan, and add the user's **D-5** (audit API routes secured as step 0, before any AI entry is written) and **D-6** (AI entries hidden from owners until the charging decision). Layer 1 scope unchanged; 26 FRs, 24 ACs |
| 2026-09-19 | Roadmap mirror: Layer 3 wired | The Layer 3 row now records steps 0–2 merged and deployed, and steps 3–5 (every Business OS area writing one AI audit entry per action) code-complete. Layer 1 scope unchanged |
