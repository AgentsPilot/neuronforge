# LLM Credit, Cost and Audit Tracking — Investigation

> **Last Updated**: 2026-09-18

## Overview

This investigation maps how LLM calls are metered (tokens, dollar cost, Pilot Credits), audited, configured and attributed to users today. It is the input to requirements for these Business OS LLM standards: (1) no hardcoded models, and every call configurable in the DB and the admin page; (2) the credit cost of every call is tracked; (3) every call is recorded in the audit trail; (4) every call is attributed to the real user rather than `system`.

- **Round 1** (sections A–D) covers the shared infrastructure and the Business OS calls.
- **Round 2** (sections F–G) looks at the AgentsPilot AI Agents side to answer the open questions about real dollar cost and audit granularity, and to find what can be reused.
- **Round 3** (section I) checks whether existing reporting can serve as Layer 1's "tracking is complete" proof.

Requirements are written layer by layer (see [Decisions & Direction](#e-decisions--direction)):
- Layer 1 (merged, PR #47): [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md).
- Layer 1.1 (merged, PR #48): [BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md).
- Layer 1.5 (merged): [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md).
- Logging clean-up (merged, PR #50): [BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md). It resolves Layer 1.5's open items OI-4 to OI-8:
  - the tracker (`aiAnalytics.ts`), `IntentClassifier.ts` and `openaiProvider.ts` now log through Pino;
  - a failed `token_usage` insert no longer logs the failing row;
  - onboarding never logs the owner's raw text, and logs text derived from it at `debug` only.

  OI-9 (log redaction is not active), OI-10 and OI-11 (pre-existing orchestration test failures) are open.
- **Layer 3 — AI activity audit trail (steps 0–2 merged and deployed; steps 3–5 code-complete 2026-09-19, pending review; user decisions D-1 to D-6):** [BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md) — standard #3; see E.12.

**Status:** Draft — BA investigation. Line numbers were accurate on 2026-09-16 (branch `feature/business-os-purge-slice-2`). Findings refined by SA code checks are recorded in the Layer 1 requirement's SA Review and in the Layer 1 workplan §13.

---

## Table of Contents

- [Summary](#summary)
- [A. Credit and Cost Tracking (shared infrastructure)](#a-credit-and-cost-tracking-shared-infrastructure)
- [B. Audit Trail](#b-audit-trail)
- [C. Model Configuration and Admin Pages](#c-model-configuration-and-admin-pages)
- [D. Business OS LLM Calls — Current Behaviour](#d-business-os-llm-calls--current-behaviour)
- [E. Decisions & Direction](#e-decisions--direction)
- [F. Q1 — Actual Dollar Cost (AgentsPilot AI Agents side)](#f-q1--actual-dollar-cost-agentspilot-ai-agents-side)
- [G. Q4 — Audit Trail on the AgentsPilot AI Agents side](#g-q4--audit-trail-on-the-agentspilot-ai-agents-side)
- [H. Reuse, Gaps and Layers](#h-reuse-gaps-and-layers)
- [I. Existing Reporting vs. the Layer 1 Verification Report](#i-existing-reporting-vs-the-layer-1-verification-report)
- [J. Known Issues Found (not in scope)](#j-known-issues-found-not-in-scope)
- [K. Open Questions and Open Items](#k-open-questions-and-open-items)
- [Change History](#change-history)

---

## Summary

| Standard | Today |
|---|---|
| 1. Model in DB + admin entry | 3 of 18 Business OS call sites read a DB key. None of those keys can be edited in any admin page. |
| 2. Credit cost tracked | Partly. Every call through the provider layer writes a `token_usage` row with tokens and `cost_usd`. Business OS credits are only derived when the usage screen is read, and nothing is deducted. Only agent runs deduct credits. AI image generation isn't recorded at all (Layer 1.5 records it in its own `business-os-images` area, without charging for it). |
| 3. Every call in the audit trail | No. There is no LLM-call event, and the provider layer never writes to `audit_trail`. The agents side audits per run and per step, not per call. **Layer 3 writes one audit entry per AI action, linked to its ledger rows by the grouping id** (E.12). Every Business OS area is wired through `runAiAction` (steps 3–4, code-complete 2026-09-19). By user decision the entries use the existing queued audit path, so some may occasionally be lost (Layer 3 KI-B). |
| 4. Real user ID | 8 of the 18 Business OS sites didn't pass one and landed on the system user (fixed by Layer 1). The same gap exists on the agents side for V6 intent generation and in the onboarding conversation (fixed by Layer 1.5). |

**Urgent finding (section I.3):** most `/api/admin/**` routes have **no authentication**. Middleware skips every `/api` path and the admin layout has no gate. This is being handled as a separate security fix outside this effort.

---

## A. Credit and Cost Tracking (shared infrastructure)

### A.1 Call flow

| Step | What happens | Where |
|---|---|---|
| 1 | Caller passes a `CallContext` (`userId`, `feature`, `component`, `sessionId`, `workflow_step`, `category`, `activity_*`, `agent_id`, `execution_id`) | `lib/ai/providers/baseProvider.ts:5-18` |
| 2 | `chatCompletion` / `createEmbedding` wrap the API call in `callWithTracking` | `lib/ai/providers/openaiProvider.ts:106-146`, `:167-190` |
| 3 | `callWithTracking` **awaits** the tracking write on success and on failure (failures are recorded with 0 tokens, $0) | `baseProvider.ts:70-144` (`:86`, `:115`) |
| 4 | Dollar cost comes from `calculateCostSync` | `lib/ai/pricing.ts:235-260` |
| 5 | `AIAnalyticsService.trackAICall` inserts one row into **`token_usage`**; DB errors are logged and swallowed | `lib/analytics/aiAnalytics.ts:95-242` (insert `:202-205`, swallow `:207`, `:234`) |
| 6 | A non-UUID `user_id` (e.g. `'system'`, `'unknown'`) is replaced with `SYSTEM_ADMIN_USER_ID` or the all-zero UUID. **It is never stored as NULL.** A non-UUID `session_id` is set to NULL | `aiAnalytics.ts:120-138` |

*(Layer 1.5 adds an image path through the same wrapper: `request_type` becomes an optional part of the call context, defaulting to `chat`, and the tracker itself needs no change because it already forwards the value.)*

### A.2 How reliable `cost_usd` is

- `calculateCostSync` only reads the in-memory price cache. It **never loads** `ai_model_pricing` itself (`pricing.ts:241-250`). Only the async `calculateCost` / `getPricing` / `refreshPricingCache` load the table (`:119-171`, `:288-290`). I didn't confirm that anything warms the cache per server instance.
- If the cache is cold, it falls back to the hardcoded `FALLBACK_PRICING` list (`pricing.ts:42-114`). Any model not on that list is recorded at **$0** with only a console warning (`:252-255`).
- Only input and output token rates are modelled. There is no cached-input or batch discount.
- The provider layer has no image-generation method, and the pricing model is per token only, so per-image spend can't be represented (see D, `GeneratedImageService.ts`). *(Layer 1.5 adds an image path through the provider layer and a **configurable per-image price**, kept out of `ai_model_pricing`, which is strictly per token. Its precedence is configuration → a documented in-code fallback → 0 with an error log, so an image never silently records $0; and it never writes non-zero tokens for an image.)*

### A.3 Tokens to Pilot Credits

- Credits are based on **token count, not cost**: `ceil(tokens / tokens_per_pilot_credit)`, default 10 (`lib/utils/pricingConfig.ts:102-108`). The rate lives in `ais_system_config`.
- A gpt-4o token, a gpt-4o-mini token and an embedding token all cost the same number of credits.
- `CreditService` only has agent-scoped charges: `chargeForExecution` (`lib/services/CreditService.ts:155`), `chargeForCreation` (`:222`) and `chargeTokensWithIntensity` (`:444`). **Business OS never calls any of them.**
- **Consequence for images (Layer 1.5):** an image row has zero tokens, so it contributes zero credits everywhere credits are computed. That is why "track only, don't charge" needs no credit-rule change, and why the charging question (OQ-7) can't be answered without first deciding what a credit represents (Q1). **What does change:** call counts. The usage API returns `usage.totalCalls` and the summary function counts `COUNT(*)`, so a zero-token row is counted — but `UsageCard.tsx` renders neither calls nor the breakdown, so nothing owner-facing moves (Layer 1.5 RC-1).

### A.4 Business OS usage screen

`app/api/business-os/usage/route.ts`:

- Reads `token_usage` through `getUsageAnalytics({ userId })` (`:186`) and converts tokens to credits at read time (`:112-125`, `:200`). *(On `main` after Layer 1 it reads per-feature totals from the `business_os_usage_summary` database function, falling back to reading rows. Layer 1.1 extracts this into `lib/business-os/usage/usageSummary.ts` with no behaviour change.)*
- The allowance is `monthly_ai_allowance_usd / pilot_credit_cost_usd` (`:143-163`). It is **display only**. *(Layer 1.5 F-6 moves that config read into `ConfigRepository` — which needs a new multi-key method and must be constructed with `supabaseServer`, because the repository defaults to the browser client.)*
- The card counts **down** "credits remaining" against that allowance (`components/business-os/UsageCard.tsx:1-24`), and doesn't render the category breakdown (`:21-24`).
- The route's own comment says the `user_subscriptions` ledger understates real consumption 13x (`:250-258`).
- Feature-to-category mapping is at `:49-69` (extracted to `lib/business-os/usage/usageCategories.ts` by Layer 1).
- The only hard stop is the chat daily budget (`lib/business-os/bizql/telemetry/ChatBudget.ts:149-189`), keyed on `feature='business-os-chat'`.

### A.5 Embeddings

`lib/services/EmbeddingService.ts`:

- Embeddings go through `createEmbedding`, so they are tracked.
- `generateEmbedding` accepts optional attribution (`:99-123`). Without it, the call is recorded as the system user under feature `helpbot`.
- `generateBatchEmbeddings` is always system/helpbot (`:172-179`).
- It returns a second, separate cost figure from `helpbot_embedding_cost_per_1k_tokens` (`:79-86`).

### A.6 The `system` user

- `getProviderFactory().complete()` hardcodes `userId: 'system'`, `feature: 'onboarding'`, `component: 'simple-complete'` (`lib/ai/providerFactory.ts:324-328`).
- It **is** tracked, despite the comment "no tracking" at `:323`.
- The cost goes to the admin or all-zero user. It isn't on the business's usage card and can't be traced back to the business.
- **Callers outside Business OS:** the onboarding conversation is the only live one. `WebsiteAnalyzer.ts` also calls the helper, but it is dead and broken, so its LLM call always fails (row 18; SA code review CR-1, 2026-09-17). *(Layer 1.5 converts the onboarding conversation to the catalog builder. SA verified that afterwards **no live caller** uses the no-context default: every other live caller passes a context, and the three apparent context-less callers throw before any call.)*
- The platform account itself (`SYSTEM_ADMIN_USER_ID`, or the all-zero UUID when unset) is written out in four places today; Layer 1.5 replaces them with one dependency-free helper at `lib/platformAccount.ts`. `AuditTrailService.ts:121` looks similar but is a **different rule** (it falls back to `null`) and is deliberately not touched.

---

## B. Audit Trail

- **It is a separate thing from `token_usage`.**
  - `audit_trail` is a compliance log of meaningful actions (`lib/services/AuditTrailService.ts:202-225`), queued in memory and flushed every 5s (`:230-234`), and kept for 365 days (`:43-47`).
  - `token_usage` is the per-call metering ledger.
  - The two share no key.
- **There is no LLM-call event** in `lib/audit/events.ts`. The nearest are `MODEL_ROUTING_DECISION` (`:59`), `PILOT_ROUTING_DECISION` (`:206`) and `AI_PRICING_*` (`:157-160`).
- An unregistered action still saves, but as "Unknown event" at `info` severity (`:836-841`).
- **Nothing logs LLM calls automatically.**
- A missing `userId` becomes `SYSTEM_ADMIN_USER_ID` with `system_action: true` (`AuditTrailService.ts:105-126`).
- **Risk:** the in-memory queue plus a 5s timer can lose entries when a serverless function freezes.

**Re-checked for Layer 3 (2026-09-18, `main` 7646760a)** — detail in the [Layer 3 requirement, Findings](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md#findings-from-the-code):

- `log()` returns once the entry is **queued**, not written; batches go out every 5 seconds or at 100 entries (`AuditTrailService.ts:43-44`, `:86-102`). So a caller's `.catch` never sees a write failure.
- A failed write **loses its whole batch** — the queue is emptied before the insert (`:224-248`).
- The loss risk is **structural**: the flush timer is `unref`'d and the only safety net is `beforeExit` (`:260-282`, `:525-529`), which does not run when a serverless function is frozen. The framework is **Next.js 14.2.35** (no `after()`), and `@vercel/functions` (`waitUntil`) is **not installed**. Even the business purge's *critical* events are not flushed before the response (`ResetService.ts:100-119`, `:231-253`). The loss **rate** is unknown.
- Passing the HTTP request stores an **auth credential** in the audit entry's `session_id` (the Supabase access / refresh cookie or the start of the `Authorization` header, `:182-190`).
- The entity-type list is a closed union (`lib/audit/types.ts:17-51`).
- `applyRetentionPolicy()` exists (`:468-485`) but no scheduled job in `vercel.json` runs it.
- **User decision (Layer 3 D-4, 2026-09-18): the audit service is kept exactly as it is.** Layer 3's AI entries use this queued path, and the loss risk is accepted as Layer 3 **KI-B**, with a recommended later change (**OI-D**).

---

## C. Model Configuration and Admin Pages

- **Model keys live in `system_settings_config`.** They are read through `SystemConfigService` (deprecated) or `systemConfigRepository`. Credit rates live in `ais_system_config`.
- **Business OS keys** `bizchat_planner_model`, `bizchat_analysis_model` and `lead_reply_recommender_model` fall back to `gpt-4o-mini` in code. I found no seeding migration.
- **Admin pages:**
  - `/admin/system-config` shows only billing, pricing, boost packs and the calculator (`app/admin/system-config/page.tsx:163-172`). **No `bizchat_*` or `lead_reply_*` key is editable.**
  - `helpbot_embedding_model` is editable on `/admin/helpbot-config` (`route.ts:34`, `:88`), and the chat embeddings share it.
  - **Existing pattern:** hardcoded key lists per page, e.g. `app/api/admin/agent-generation-config/route.ts:21-223`.
- **Unguarded config write:** `PUT /api/admin/system-config` (`route.ts:42-81`) upserts any key with no authentication (I.3).
- **Routing:** `lib/orchestration/RoutingService.ts` (AIS complexity routing) doesn't fit fixed per-feature Business OS calls.
- **Layer 1.5 note:** the image model, its sizes, its quality and its per-image price are the first configuration values added for a non-token call. SA decided they live **together in `system_settings_config`**, read through `SystemConfigRepository` in **one** round trip — a new `getImageGenerationConfig()` built on the existing `getByKeys` (corrected 2026-09-18: `getAgentCreationConfig()` is two round trips and is not the model). The price key moves if a real per-image price table arrives with the deduction layer. Layer 2 picks up the model key. The onboarding conversation's `'gpt-4o'` literals are carried unchanged and handed to Layer 2 (Layer 1.5 KI-C / F-9).

---

## D. Business OS LLM Calls — Current Behaviour

All calls go to OpenAI. The after-state is in the Layer 1 requirement.

| # | Call | Model source | userId passed | feature / component | Area |
|---|---|---|---|---|---|
| 1 | Chat v4 planner `lib/business-os/bizql/planner/Planner.ts:443` (`:444` on the Layer 1 branch base) | DB | Real (`request.userId`) | business-os-chat / BizQLPlanner (+turnId) | Chat |
| 2 | Chat v4 analysis `AnalysisService.ts:124` | DB | Real | business-os-chat / BizQLAnalysis | Chat |
| 3a | Plan cache lookup embedding `bizql/cache/PlanCache.ts:226` | DB (shared with help bot) | Real | business-os-chat / EmbeddingService | Chat |
| 3b | Plan cache store embedding `PlanCache.ts:333` | DB (shared) | **system** (no attribution) | **helpbot** / EmbeddingService | Chat |
| 4 | Verified questions embedding `bizql/planner/VerifiedQuestions.ts:81` (`embed()`, shared by lookup `similar()` and store `remember()`; split into two call names in Layer 1, per SA workplan review) | DB (shared) | Real | business-os-chat / EmbeddingService | Chat |
| 5 | Chat v2 legacy `ai-data-layer/AIDataLayerService.ts:895`, `:1243` | env / hardcoded `gpt-4o` | **Not tracked** (direct SDK) | none | Chat (legacy, excluded) |
| 6 | Chat v1 `IntentParser.ts:114` | Hardcoded | Real | business-os-chat / IntentParser | Chat (legacy, excluded) |
| 7 | Insight content `insight/repository/InsightRepository.ts:717` | Hardcoded | **'system'** (userId available, `:608`) | insight-generation | Insights |
| 8 | Correlated insight `InsightRepository.ts:1728` | Hardcoded | **'system'** (userId available, `:1659`) | correlated-insight-generation | Insights |
| 9 | Health summary `InsightRepository.ts:2113` | Hardcoded | Real | health-summary-generation | Insights |
| 10 | Daily briefing `briefing/BriefingNarrator.ts:106` | Constant | Optional, `?? 'unknown'`; callers pass it | business-os / daily-briefing | Briefing |
| 11 | Story `app/api/business-os/story/route.ts:183` | Constant | Not tracked (always throws) | none | Briefing (broken, excluded) |
| 12 | Lead reply `leads/LeadReplyRecommender.ts:98` | DB | Real | lead-reply / LeadReplyRecommender | Leads |
| 13 | Intake form generation `lib/services/IntakeGenerationService.ts:249` | Hardcoded | **system** (`complete()`) | onboarding / simple-complete | Intake |
| 14 | Intake infer question `app/api/intake/form/infer-question/route.ts:123` | Hardcoded | **system** (`user.id` available, `:62`) | onboarding / simple-complete | Intake |
| 15 | Website generation `lib/services/WebsiteGenerationService.ts:546` | Hardcoded | **system** | onboarding / simple-complete | Website |
| 16 | Landing page `app/api/website/landing-pages/generate/route.ts:102` | Hardcoded | Real | landing-page-generation / LandingPageGenerateAPI | Website |
| 17 | Website block content, 6 calls `lib/services/WebsiteAIContentService.ts:301` (field), `:337` (testimonial), `:371` (hero), `:414` (about), `:546` (FAQ), `:602` (features) | Hardcoded | **system** | onboarding / simple-complete | Website (hero/about/FAQ/features have no production trigger, SA) |
| 18 | WebsiteAnalyzer `lib/services/WebsiteAnalyzer.ts:123` | From caller | Broken: calls non-existent methods (`getDefaultModel`, and `complete` on the wrong type) and reads `.choices` from the helper's result, so the LLM call always fails. No LLM spend | none | Website (dead and broken, excluded; fix vs retire decided separately; SA code review CR-1) |

**Found at SA reviews, not in the original 18:**

| Call | Where | Behaviour today | Status |
|---|---|---|---|
| Onboarding conversation (four extraction methods; **three can fire live**) | `lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397` (inside `extractBusinessStory`, `extractClientWorkflow`, `extractClientTracking`, `extractAdjustmentIntent`; `extractClientAcquisition` uses no model). **`extractClientTracking` is unreachable** — its step (`:803-806`) is retired (Layer 1.5 KI-D); `extractClientWorkflow` can fire twice in one conversation | Via `complete()`, recorded as `system` / `onboarding`. The only live non-Business OS caller of the helper. Each passes `model: 'gpt-4o'` as a literal | Excluded from Layer 1; **Layer 1.5 part (a)** — attributed to the owner under a new `business-os-onboarding` area, with a grouping id minted per conversation (E.8, E.11). All four names kept, the dead one covered by unit tests; deleting it is F-12. The model literals are carried and handed to Layer 2 (KI-C / F-9) |
| Service generator | `lib/services/ServiceGeneratorService.ts:275`, `:304` | Broken: calls a `complete` method the provider doesn't have (and reads `response.choices`, `:314`). It always falls back, so there is no LLM spend and no ledger row | **Excluded** (same class as Story; retire-vs-fix separately) (E.9) |
| AI image generation | `lib/services/GeneratedImageService.ts:186-187`; one caller, `app/api/website/media/generate/route.ts:41`, always `n: 1` | Direct OpenAI SDK `images.generate` (`gpt-image-1`), bypassing the provider layer, so it is **not recorded in `token_usage`**. Images are priced per image, not per token. It has its own daily per-business image cap (`:170-183`). A repeated request is served from the reuse cache (`:159-160`) and generates nothing | Excluded from Layer 1; **Layer 1.5 part (b)** — recorded in its own **`business-os-images`** area, tracked but **not charged**; charging parked (E.9, E.11, OQ-7) |

---

## E. Decisions & Direction

### E.1 Delivery approach

- **Build in small layers, one at a time.** Each layer must ship on its own and leave time to digest and test it before the next begins.
- **Don't answer every question up front and then build.**

### E.2 Admin configuration shape (Q5)

**Decision:** yes to all. Admins control the model, provider, temperature and an on/off switch for each call. One settings entry per area, stored as one JSON value in DB config. How it appears in the admin UI is designed later.

**BA refinement:** each area's entry lists its calls by name, each with its own settings and optional area-wide defaults. The call names match those in the usage ledger. The JSON-per-area shape is a new pattern and needs SA review.

### E.3 Q2 — Automatic AI work counts against the business

- **Decision:** yes. AI work triggered by a user, or run for a user's account (including insights, briefing and lead replies), is attributed to that user.
- **Deferred:** *what* gets deducted is decided later.

### E.4 Q3 — Enforce the allowance / stop at zero

- **Deferred** until tracking is confirmed complete.

### E.5 Parked

- The LeadReplyRecommender bug is parked.

### E.6 Q1 and Q4

- Q1 remains open for the deduction layer.
- **Q4 (audit granularity) is resolved by the user (2026-09-18, Layer 3 D-1):** one audit entry per user action or background job, not per call (E.12).

### E.7 Layer 1 decisions (2026-09-16)

1. Usage card totals rising is accepted.
2. Legacy and broken calls stay excluded from Layer 1: chat v2, chat v1, the story route, WebsiteAnalyzer. The LeadReplyRecommender bug stays parked.
3. No backfill of past system-attributed usage.
4. V6 intent-generation attribution is a separate item.
5. A data-only proof is acceptable (Q11). The extended chat usage report is moved **out of Layer 1 into Layer 1.5**; Layer 1 is proven by QA test evidence. *(Superseded 2026-09-17 by E.10: the report moved again, to Layer 1.1.)*
6. Admin API route authentication (Q12) is handled as a separate security fix.

### E.8 Layer 1 finalisation decisions (2026-09-17)

1. **Onboarding conversation LLM calls** (4 per session, `OnboardingConversationManager.ts`, still on the platform account) are **not in Layer 1**. They are added to **Layer 1.5**.
2. **"Credits remaining" dropping from background work** is not solved now. It is recorded as an open item to handle later, layer TBD (K, OI-1).
3. **The cross-tenant read in the website block regenerate route** is recorded as an open issue to handle later, out of Layer 1 scope (J, OI-2).

SA's required changes RC-1 to RC-15 were applied to the Layer 1 requirement on the same date. Its status is SA approved, ready for Dev workplan.

### E.9 Decisions after the SA workplan review (2026-09-17)

1. **Service generator** (`ServiceGeneratorService.ts:304`) is excluded from Layer 1. It is broken and makes no LLM spend (RQ-1).
2. **AI image generation** (`GeneratedImageService.ts:186`) is excluded from Layer 1 and **moved to Layer 1.5**, next to the onboarding conversation calls (user decision). Open business question for then: should AI images count against monthly credits, and how many credits is one image worth? (K, OQ-7)
3. **Pino conversion** of `lib/ai/providerFactory.ts` (6 real `console.*` calls) and `lib/services/EmbeddingService.ts` (16) is **approved by the user for this cycle**, as part of Layer 1 delivery.
4. Requirement refinements from the workplan review: the verified-question store embedding gets its own call name (RQ-2), and chat analysis always uses the turn id (RQ-3). Both are in the Layer 1 requirement.
5. **SA code review CR-1 (docs only):** the Layer 1 requirement had described WebsiteAnalyzer as a working caller outside Business OS. It is dead and broken, as row 18 already said, so the onboarding conversation is the only live one. Corrected in the requirement (FR-12, AC-7, Excluded calls). No scope change.

### E.10 Layer 1.1 decisions (2026-09-17, after Layer 1 merged as PR #47)

1. **A verification tab now.** Platform admins need to confirm Layer 1 attribution without SQL. So a read-only **LLM Usage** tab on the internal Business OS test page (`/test-business-os`) shows, for a chosen business and start time:
   - its Business OS calls;
   - calls on the platform account;
   - legacy labels;
   - calls grouped by action;
   - the usage-card category view.
2. **Merge with the Layer 1.5 report.** Layer 1.1 takes over the "extended usage report" (I.5). It builds the report API now, and the tab is its first UI. Layer 1.5 keeps only the onboarding conversation calls and AI image tracking.
3. **Admins only,** checked on the server through `AdminAccessService` / `admin_users`, never `profiles.role`. The page being internal is not a protection.
4. **Start now,** on top of merged `main`.
5. **One business at a time is enough (OQ-U1, user decision 2026-09-17).**
   - One selected business per view, plus the platform-wide "nothing on the platform account" check, replaces the planned all-businesses × areas report **for now**.
   - An all-businesses overview may come later if needed. It would need a database change: a read-only function for per-area totals, SA follow-up F-2, because PostgREST aggregates are disabled and paging every account's rows doesn't scale.

Requirement: [BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md). SA approved with changes (RC-1 to RC-14 applied); 24 FRs, 24 ACs; no migration. **Merged as PR #48.**

### E.11 Layer 1.5 decisions (2026-09-17, after Layer 1.1 merged as PR #48)

Layer 1.5 is **four parts**, and it changes nothing about what anyone is charged. Requirement: [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) (26 FRs, 24 ACs; **SA approved 2026-09-17**, RC-1 to RC-20 applied; BA-1, BA-2 and D-6 applied 2026-09-18; **merged**).

**User decisions:**

1. **AI images: track only, don't charge (option B).** Image spend becomes visible in the usage ledger, per business, and in cost reporting, but does **not** consume credits yet.
   - **The charging decision is parked and must be revisited.** OQ-7 stays open and is linked to OI-1 and the future deduction layer.
   - **Credits per image: parked** with it.
   - Mechanically this works because an image row has zero tokens, so it adds zero credits (A.3).
2. **Onboarding conversation: attribute to the owner (option A).** The 4 calls per session are recorded against the new owner's account, with an area and call names. Since charging isn't handled yet, **"attributed" does not mean "charged"**. *(All four extraction methods are attributed; only three can fire live — see E.11 amendments below.)*
3. **One shared platform-account helper** replaces the four copies of `SYSTEM_ADMIN_USER_ID || '00000000-…'` (`aiAnalytics.ts:121`, `EmbeddingService.ts:46`, `IntentClassifier.ts:179` and `:698`) and backs the catalog's `isPlatformAccount` / `platformAccountIds`. No behaviour change.
4. **Small follow-ups folded in:** Layer 1.1 **F-1** (the chat usage report's silent 10,000-row cap and its all-zero report on a failed read; its reads move onto `TokenUsageRepository`) and **F-6** (the allowance config read moves into `ConfigRepository`). **Out of scope: OI-1** — decided with the deduction layer.
5. **The verification tab is updated** so the new areas and calls are covered, "otherwise Layer 1.5 has no proof". Zero-token, non-zero-cost rows must read correctly in the tab and in the area totals.
6. **D-6 (2026-09-18, OQ-U2 / F-8) — option A, keep the freeze.** Layer 1.5 converts **none** of the three touched files that still log through `console.*` — `lib/analytics/aiAnalytics.ts` (16), `lib/orchestration/IntentClassifier.ts` (16), `lib/ai/providers/openaiProvider.ts` (4). Only the lines the FRs need are changed. This is a **deliberate, user-approved exception** to CLAUDE.md § Logging's "convert touched files" rule: all three sit on paths Layer 1.5 is already changing, and mixing a mechanical logging rewrite into that diff would bury the attribution change the reviewers need to see. The three conversions are open items **OI-4, OI-5, OI-6** (K). *(Done since by the logging clean-up, PR #50.)*

**SA decisions (review 2026-09-17, RC-1 to RC-20 applied by the BA):**

- **Images get their own area, `business-os-images` / `image_generation`** — the BA's "put them under `website`" proposal was **overridden**. The owner card never renders the breakdown, the operator report's area totals are the only place image spend becomes one figure, and an area mixing per-token and per-image pricing would corrupt any future per-area arithmetic. The link to the website request is kept in the **grouping id**, not the label.
- **Both new areas carry an EMPTY legacy-features list.** Adding the legacy `onboarding` value would pull every historical row into the Business OS filter, fail the "nothing on the platform account" check, move the value out of `help` and break the catalog test.
- **The zero-token claim was corrected:** credits, the allowance, the ring, `remaining`, the daily series and the breakdown's credit figures are unchanged, but **call counts rise** — which nothing owner-facing renders (A.3, A.4).
- **Price precedence:** configuration → a documented in-code fallback → 0 with an error-level log, keyed by model + size + quality. *(D-7, 2026-09-18: quality is **not** pinned — the request stays at `auto` so images are unchanged, and each image is priced after the call at the quality the provider **reports** it used, or at `high` with a warning if none is reported.)*
- **Grouping ids:** onboarding mints one in `getInitialState()` and carries it on the conversation state (never the client-supplied `conversationId`, and pre-1.5 snapshots are backfilled on resume); images take the id the one entry-point route mints.
- **Shared helper:** a dependency-free `lib/platformAccount.ts` that the catalog imports, never the reverse, so the type-check gate's file scope doesn't grow.
- **Failed images write a failure row**, and a 200 response with no image data still writes a **priced** row, because it was billed.
- **F-8 / OQ-U2** (the `aiAnalytics.ts` `console.*` question) was left open for the user — **resolved 2026-09-18 by D-6** above.
- **New user note UD-1** (K): attributing onboarding to the owner means a brand-new business opens its dashboard with part of its first month's allowance already used, for a conversation it had before it started. Nothing is billed or blocked; the live run measures the real number so the choice can be made on evidence with the deduction layer.
- SA follow-ups tracked outside the layer: F-7 (promote the legacy-helper-label check to Fail after an observation period), F-9 (onboarding model configuration), F-10 (missing `usage.category.*` dictionary entries), F-11 (the 32-bit image reuse hash). F-8 became OI-4.

**Amendments from the workplan SA review (applied 2026-09-18):**

- **BA-1 — three live onboarding call types, not four.** `extractClientTracking` (`OnboardingConversationManager.ts:1093`) is dead code: its step (`:803-806`) is retired. All four catalog names are kept (the dead one with an "unreachable as of 2026-09-17" comment and unit coverage), the live QA run now expects **three** call types at most, and the dead extractor is Layer 1.5 **KI-D**, with **F-12** (delete it, or re-wire the question) as the fix. `client_workflow_extraction` can legitimately fire twice in one conversation.
- **BA-2 — three corrections.** The image configuration read is `getImageGenerationConfig()` on the existing `getByKeys` (one round trip), not modelled on the two-round-trip `getAgentCreationConfig()` (M-2); the `aiAnalytics.ts` `console.*` line list is `:97, :101, :129, :137, :186, :208, :209, :216, :217, :218, :235, :236, :246, :297, :323, :372` (M-3); and **three** touched files are non-compliant, not one — `aiAnalytics.ts`, `IntentClassifier.ts` and `openaiProvider.ts` (M-4). `EmbeddingService.ts` and `providerFactory.ts` are clean.

### E.12 Layer 3 — AI activity audit trail (2026-09-18)

Standard #3. Requirement: [BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md) (28 FRs, 27 ACs; **SA approved 2026-09-18, RC-1 to RC-12 applied, ready for Dev workplan**). **The user decided all four business questions on 2026-09-18:**

1. **D-1 — Granularity: agreed.** One audit entry per user action or background job, linked to its calls through the Layer 1 grouping id — the same shape as the agents side (§G). **Resolves Q4.**
2. **D-2 — What is recorded: agreed**, including the AI call names and model names: who (the business account; the actor — the owner, or the platform for background jobs), area, action type, grouping id, number of LLM calls and failed calls, tokens, estimated cost, success or failure. **Never** prompts, owner text, AI output, error message text, the business name or request metadata.
3. **D-3 — Background jobs: agreed.** One entry per business per insight run and per briefing narration, at info severity, marked as scheduled, with the platform as the actor.
4. **D-4 — Reliability: not changed now.** The audit service is **kept exactly as it is**; AI audit entries use the existing queued `AuditTrailService.log()` path with a non-blocking `.catch`, like every other audit event.
   - **Known risk of the layer (Layer 3 KI-B):** entries are queued and flushed in batches (every 5 s or 100 entries); the queue is cleared before the insert, so a failed insert loses the whole batch; and nothing forces a flush before a serverless function freezes after its response (Next.js 14.2.35 has no `after()`; `@vercel/functions` / `waitUntil` isn't installed). **Some AI audit entries may occasionally be lost.** Every call is still in the usage ledger under the same grouping id.
   - **Recommendation to change it later (Layer 3 OI-D):** write AI entries immediately and await confirmation with a short time limit (about 1–2 s), so owner actions are never held up and background jobs are unaffected.
   - The **service-wide** fix stays a separate item (Layer 3 OI-A).
   - Layer 3's QA check tolerates the documented loss: it waits for the flush, and records any missing entry as a KI-B occurrence, not a defect.

**After the SA review (2026-09-18):** **D-5** — the audit API routes, which trusted a client-sent user id and checked no login, are fixed as **step 0 of Layer 3**, before any AI entry is written; **D-6** — AI entries are **hidden from owners** (`/monitoring`, its CSV export, any owner-scoped read) until the charging decision. Detail, and SA's RC-1 to RC-12, in the requirement.

---

## F. Q1 — Actual Dollar Cost (AgentsPilot AI Agents side)

### F.1 What the agents side records

| Record | Holds real $ cost? | Where |
|---|---|---|
| `token_usage.cost_usd` per call, with `agent_id`, `execution_id`, `workflow_step`, `model_name`, `provider` | **Yes.** The only per-call dollar record | `aiAnalytics.ts:141-184` |
| `agent_executions.logs.tokensUsed` | No. Tokens only; Pilot runs store prompt/completion as 0 | `app/api/run-agent/route.ts:366`, `:588-595` |
| `credit_transactions` / `user_subscriptions` | No. Intensity-adjusted tokens | `CreditService.ts:444-525` |
| `agent_intensity_metrics.total_creation_cost_usd` | **Not our cost.** Credits × `pilot_credit_cost_usd` | `lib/services/AgentIntensityService.ts:92-101`, `:144` |
| `billing_events` | No per-call cost | `CreditService.ts:73-79`, `:291-300` |

### F.2 How agent runs are charged

1. `/api/run-agent` calls `chargeTokensWithIntensity(rawTokens, intensityScore)` (`run-agent/route.ts:567-576`).
2. The charge is **tokens × (1 + AIS/10)** (`CreditService.ts:451-452`). AIS is a complexity score (`lib/utils/updateAgentIntensity.ts:206-227`), with no model price or dollar cost.
3. The AIS figure recorded for tracking uses the default score of 5.0 (`run-agent/route.ts:507`, `:522-523`).
4. The pre-run check compares the balance with the last run's token cost (`:100-103`).

### F.3 Agent creation

- `/api/create-agent` doesn't deduct credits. It sums creation tokens by `session_id` and `activity_type IN ('agent_creation','agent_generation')` into AIS (`app/api/create-agent/route.ts:351-432`).
- **Attribution gap:** the V6 intent-contract call is tracked as `userId: 'system'` with `activity_type: 'intent_contract_generation'` (`lib/agentkit/v6/intent/generate-intent.ts:71-81`). It is excluded from the creation total and from the user's usage.
- That route trusts an `x-user-id` header with no authentication (`app/api/v6/generate-ir-intent-contract/route.ts:41-43`).

### F.4 How pricing is maintained

- `ai_model_pricing` edits write `AI_PRICING_*` audit events with `userId: null` (`app/api/admin/system-config/pricing/route.ts:101-109`, `:166-175`, `:233-238`).
- "Sync pricing" upserts a hardcoded catalog (`pricing/sync/route.ts:31-375`) with no embedding or image models. *(Layer 1.5 deliberately keeps per-image pricing out of this per-token table — SA confirmed it cannot express a per-image price, and writing non-zero tokens for an image is explicitly rejected; see A.2 and E.11.)*

### F.5 Reconciliation

- `TokenReconciliationService` compares our own two token records (`lib/services/TokenReconciliationService.ts:72-133`). It doesn't check against provider invoices.
- Batch mode looks inconsistent (`:215-232`). Whether it runs after every execution is unverified.

### F.6 Conclusion (business terms)

**Can we know what each call cost us?** Yes in principle, not reliably today.

- **Gaps:**
  - a hardcoded price fallback, with unknown models costed at $0;
  - no cached-prompt discounts;
  - no invoice reconciliation;
  - some calls recorded under the system user or not recorded at all (including AI images — closed by Layer 1.5 for images and the onboarding conversation);
  - customer credits ignore real cost;
  - pricing changes audited without the admin's identity.

---

## G. Q4 — Audit Trail on the AgentsPilot AI Agents side

### G.1 What gets audited, and at what granularity

| Moment | Event(s) | Granularity | Where |
|---|---|---|---|
| Agent created | `AGENT_CREATED`, `AGENT_CONFIG_SAVED` | Per action | `app/api/create-agent/route.ts:231-252`, `:301-311` |
| Creation AIS scored | `AIS_SCORE_CALCULATED` | Per agent | `AgentIntensityService.ts:191-197` |
| AgentKit run | `AGENTKIT_EXECUTION_STARTED` plus plugin, iteration and limit events | Per run / plugin call / limit breach | `lib/agentkit/runAgentKit.ts:324-343`, `:520-536`, `:562+` |
| Pilot step | `PILOT_STEP_EXECUTED` with token counts | **Per step** | `lib/pilot/StepExecutor.ts:580-594` |
| Run finished | `AGENT_EXECUTED` | Per run | `app/api/run-agent/route.ts:637-664` |
| Token mismatch | `TOKEN_DISCREPANCY_DETECTED` | Per execution, on anomaly | `TokenReconciliationService.ts:175-190` |

No event is written per LLM call.

### G.2 The trail that actually exists per call

`token_usage` is the per-call trail: AgentKit (`runAgentKit.ts:479-500`) and Pilot `ai_processing` (`StepExecutor.ts:1970-1991`) tag `agent_id`, `execution_id` and step. It is joined to audit events by those ids.

### G.3 Reusable for Business OS?

Yes, it is the same infrastructure. Business OS needs a real user, area/call names and a grouping id, which Layer 1 provides. Suggested audit granularity for a later layer: per action. *(Decided by the user, Layer 3 D-1, 2026-09-18: one entry per AI action, joined to the ledger by the grouping id.)*

---

## H. Reuse, Gaps and Layers

### H.1 What exists and can be reused

| Capability | Reuse for Business OS |
|---|---|
| Per-call ledger (`token_usage`) | Yes, as is — including zero-token rows, which already exist (the chat cache-hit row) and are what an image row looks like with a cost added |
| Correlation fields | Yes. Layer 1 uses `feature` = area, `component` = call name, `session_id` = UUID grouping id. Layer 1.5 adds an optional `request_type` for images, which the tracker already forwards. Layer 3 uses the grouping id to join its audit entries to these rows |
| Per-action audit events carrying token totals | Yes, as the pattern (Layer 3) |
| DB-driven provider + model per purpose | Yes, as the pattern — `system_settings_config` is also where the image model, sizes, quality and price go (Layer 1.5), read in one round trip with `getByKeys` |
| Admin price table | Yes, once read reliably (per token only; per-image price is separate, Layer 1.5) |
| Admin-gated chat usage report (`/api/admin/chat-usage` + `usageReport.ts`) | Pattern for the Layer 1.1 report API (admin gate, Zod, Pino). Its own two silent failures are fixed by Layer 1.5 (F-1) |
| `TokenUsageRepository` + `usageSummary.ts` (Layer 1.1) | Yes. Layer 1.5 moves the chat usage report onto the repository with one explicitly named all-accounts method (F-1). Layer 3 may read the ledger back by grouping id through it (Layer 3 OQ-4) |
| `AuditTrailService.log()` (queued) | Yes, **as is** — Layer 3's write path by user decision (D-4), with its accepted loss risk (Layer 3 KI-B) |

### H.2 What's missing

1. Correct attribution (Layer 1, merged; onboarding conversation Layer 1.5, merged; V6 separate).
2. A stable naming scheme (Layer 1, merged).
3. A reliable dollar figure.
4. Per-call model configuration (Layer 2).
5. Per-action audit events (**Layer 3**, draft; decisions made).
6. A completeness report (**Layer 1.1**, merged; single business at a time, E.10.5).
7. Admin identity on pricing and config changes, and authentication on `/api/admin/**` (separate security fix).
8. Image-generation tracking: an image method in the provider layer, image pricing, and a credits rule. **Layer 1.5 delivers the first two — in a dedicated `business-os-images` area — and deliberately leaves the credits rule open** (track only, don't charge; OQ-7 parked).
9. A reliable audit write path: the audit service can silently lose entries for every product (Layer 3 OI-A), and for AI entries specifically (Layer 3 KI-B, change recommended as OI-D).

### H.3 Layers (as decided)

> Indicative. Each layer gets its own requirement.

| Layer | Delivers | Status |
|---|---|---|
| **1** | Every in-scope Business OS AI call recorded against the right business, with area, call name and UUID grouping id, through a call catalog and attribution builder. Usage category mapping updated in the same release. `providerFactory.ts` and `EmbeddingService.ts` converted to Pino. Proof by QA test evidence and code review. [Requirement](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) (26 FRs, 24 ACs) | Merged (PR #47) |
| **1.1** | **LLM Usage verification tab and report API.** An admin-only, read-only tab on `/test-business-os`. Choose **one business** and a start time, refresh, and see five checks: calls, nothing on the platform account (platform-wide), no legacy labels, grouped by action, usage-card view. Also area totals, display caps, and an Incomplete status when the 5,000-row read ceiling is hit. Takes over the extended usage report (I.5) (E.10). One business at a time is enough for now (E.10.5). Adds `TokenUsageRepository`, `usageSummary.ts` and shared catalog constants; no migration. [Requirement](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md) (24 FRs, 24 ACs) | Merged (PR #48) |
| **1.5** | **Four parts** (E.11). **(a)** Onboarding conversation attributed to the **owner** under a new `business-os-onboarding` area, with a grouping id minted per conversation and required attribution on `processUserMessage` ("attributed" ≠ "charged"; user note UD-1). Four methods attributed, **three can fire live** (KI-D, F-12). **(b)** AI image generation through the provider layer, recorded in its **own `business-os-images` area** with zero tokens, a dollar cost, and a configurable model, size, quality and per-image price read in one `getByKeys` round trip (configuration → documented fallback → 0 with an error log). **Track only, don't charge** — credits, allowance, ring and `remaining` don't move; call counts do, and nothing owner-facing renders them. Whether images consume credits is **parked** (OQ-7, with OI-1, UD-1 and Q1 in the deduction layer). **(c)** One dependency-free `lib/platformAccount.ts` replacing the four copies of the platform-account rule, imported *by* the catalog so the type-check gate doesn't grow; `AuditTrailService.ts:121` is a different rule and is not touched. **(d)** The Layer 1.1 verification tab and report cover both new areas. **Folded in:** F-1 (chat usage report truncation and failed-read zeros surfaced as a result union; reads move to `TokenUsageRepository` with one named all-accounts method) and F-6 (allowance config through `ConfigRepository`, new multi-key method, `supabaseServer`). **Out of scope:** OI-1, and — by user decision D-6 — the `console.*` → Pino conversion of the three touched files (OI-4 to OI-6, since done by the logging clean-up, PR #50). [Requirement](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) (26 FRs, 24 ACs) | Merged |
| **Logging clean-up** | Pino for the tracker, the intent classifier and the OpenAI provider; no ledger row or raw owner text in logs (Layer 1.5 OI-4 to OI-8). [Workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md) | Merged (PR #50) |
| **2** | JSON model configuration per area, keyed by the Layer 1 call names — including the onboarding conversation's `'gpt-4o'` literals (Layer 1.5 KI-C / F-9) | Planned |
| **3** | **AI activity audit trail** (standard #3, E.12). One audit entry per AI action or background job (D-1) — chat turn, insight run per business, briefing, website / intake / landing generation, lead reply, onboarding turn, image request — with who, area, action type, grouping id, call count, tokens, estimated cost, outcome, call names and model names; never prompts, owner text or AI output (D-2). Background jobs audited per business per run, info, scheduled, platform as actor (D-3). Written through the **existing queued audit path, unchanged** (D-4): occasional loss is the accepted known risk **KI-B**, with **OI-D** (immediate, awaited AI writes with a ~1–2 s cap) recommended for later. **Step 0 secures the audit API routes (D-5); AI entries are hidden from owners (D-6).** [Requirement](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md) (28 FRs, 27 ACs) | SA approved — changes applied, ready for Dev workplan |
| **Later** | Cost accuracy; admin UI; deduction and enforcement, including **whether AI images consume credits (OQ-7)**, the "credits remaining" treatment of background work (OI-1) and onboarding spend inside a new owner's first month (UD-1); owner-facing visibility of image spend; an all-businesses usage overview if needed (needs a database function, Layer 1.1 F-2); immediate, awaited AI audit writes (Layer 3 OI-D) and a platform-wide durable audit write path (Layer 3 OI-A) | Planned |

---

## I. Existing Reporting vs. the Layer 1 Verification Report

**Required at the time (now Layer 1.1):** per business × area, for a period, calls, tokens and estimated cost, plus proof that no Business OS rows land on the system user. **Layer 1.1 delivers it one business at a time** (E.10.5).

### I.1 `lib/business-os/bizql/telemetry/usageReport.ts`

| Aspect | Finding |
|---|---|
| What it reports | `getChatUsage`: turns, calls, cost, cost per turn, tokens, cache layers, repair rate, failures, latency, `turnsCovered` (`:48-96`, `:111-172`). `getChatPricing`: per-user cost and distributions (`:227-259`, `:274-345`) |
| Source / filters | `feature = 'business-os-chat'` hard-coded (`:187`, `:358`); date window; optional `user_id`. Row cap 10,000 / 50,000, which truncates silently |
| Coverage | Chat only |
| System rows | Can't flag them |
| Caller | `GET /api/admin/chat-usage` (`chat-usage/route.ts:21`, `:65`), properly admin-gated (`:37-52`) |
| Fix | Its silent truncation, its all-zero report on a failed read and its direct Supabase reads are **Layer 1.5 (F-1)**: the function returns a result union, the report carries `truncated` and the applied cap, the caps stay as they are, and the cross-account read becomes one explicitly named repository method |

### I.2 Admin token-usage screens

| Route | Isolate Business OS? | Isolate system-user rows? | Admin auth |
|---|---|---|---|
| `token-usage` | Free-text only | No | **None** |
| `token-usage/stats` | No | No | **None** |
| `token-usage/drill-down` (UI `/admin/analytics`) | One feature at a time | Not correctly | **None** |
| `users/[id]/stats` | No | No | **None** |
| `dashboard` | No | No | **None** |

**Drill-down gotchas:**
1. Its "System" bucket matches only NULL user ids (`drill-down/route.ts:216-223`), but the tracker writes a UUID fallback.
2. Silent 1,000-row truncation (`:202-241`).
3. The period comparison ignores feature/component filters (`:331-353`).
4. Categories are agent-centric.
5. User labels come from an unpaged `listUsers()`.

### I.3 Admin API authentication (security)

- `middleware.ts:84` skips `/api`, and `app/admin/layout.tsx` has no gate. The token-usage, stats, drill-down, user stats, dashboard, system-config, pricing, helpbot-config and agent-generation-config routes are unauthenticated.
- **Status:** separate security fix (E.7.6). The Layer 1.1 routes must gate themselves in the route, not rely on middleware.

### I.4 Naming gotcha for Layer 1

- Chat keeps `business-os-chat` (ChatBudget, usageReport).
- The usage category mapping maps new and legacy values into the new categories.
- `onboarding` stays under help. *(Layer 1.5 keeps the legacy `onboarding` value under help — the onboarding chat and prompt-ideas flows still write it — and gives the new `business-os-onboarding` and `business-os-images` values their own categories, each added as exactly one `USAGE_CATEGORIES` line with an **empty** legacy list.)*
- Captured in Layer 1 FR-5, FR-21.

### I.5 Conclusion

- Existing screens can't serve as the proof. The smallest option is extending the chat usage report.
- Decided: Layer 1.5 (2026-09-16). **Moved to Layer 1.1 on 2026-09-17** (E.10).
- It is delivered as an admin-only report API behind the LLM Usage tab on `/test-business-os`, one business at a time. It reuses the `chat-usage` admin-gate pattern, the call catalog and `summariseUsageByCategory`.
- The SA chose a new `TokenUsageRepository` over extending `usageReport.ts`, which stayed as follow-up F-1. **F-1 is folded into Layer 1.5** (E.11.4), with four conditions on the cross-account read so the repository's "never read all accounts by omission" guard stays intact.

---

## J. Known Issues Found (not in scope)

| Issue | Evidence | Status |
|---|---|---|
| **Admin API routes are unauthenticated** | `middleware.ts:84` skips `/api`; no gate in `app/admin/layout.tsx`; no auth in the admin token-usage, stats, dashboard, system-config, pricing, helpbot-config and agent-generation-config routes | Separate security fix (outside this effort) |
| **OI-2 — Website block regenerate reads another business's block (cross-tenant read)** | `app/api/website/blocks/[blockId]/regenerate/route.ts:55-61` calls the unscoped `WebsiteBlockRepository.findById` (`WebsiteBlockRepository.ts:220-226`); the other business's content is sent to the AI (`:73`) and the rewrite returned | **Open issue, handle later** (user decision 2026-09-17); separate fix with the `tenant-isolation-guard` skill; out of Layer 1 |
| **KI-1 — Chat "rewrite a section field" never works** | `WebsiteSectionService.ts:519-529` sends `field`/`language`/`context`; `regenerateField` reads `fieldToRegenerate`/`targetLanguage`/`businessProfile` (`WebsiteAIContentService.ts:278-284`) | Open — separate fix; Layer 1 adds attribution only (compile-only) |
| **AI images aren't tracked as usage** | `lib/services/GeneratedImageService.ts:186-187` calls the OpenAI SDK directly (`images.generate`), bypassing the provider layer and the ledger; only a daily per-business cap applies (`:170-183`) | **Layer 1.5 part (b)** — recorded in its own `business-os-images` area, tracked but **not charged** (user decisions D-1/D-2, 2026-09-17); charging question OQ-7 parked |
| **Service generator AI never runs** | `lib/services/ServiceGeneratorService.ts:275`, `:304` call a non-existent `complete` on the provider; `:314` reads `response.choices`; always falls back, no spend | Excluded from Layer 1; retire-vs-fix separately |
| Onboarding conversation LLM calls on the platform account | `lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397` | **Layer 1.5 part (a)** — attributed to the owner (user decision D-3, 2026-09-17) |
| **`extractClientTracking` is unreachable (dead code)** | `OnboardingConversationManager.ts:1093` has no caller; its step, `case 'client_tracking'` (`:803-806`), is retired and calls `finalizeConfiguration` without any extraction | Layer 1.5 **KI-D** — attributed anyway, covered by unit tests; only three onboarding call types can fire live. Fix is **F-12** (delete it and the retired case, or re-wire the question) |
| Onboarding conversation hardcodes `model: 'gpt-4o'` | `OnboardingConversationManager.ts:951`, `:996`, `:1098`, `:1398` (CLAUDE.md rule 5) | Carried unchanged by Layer 1.5 (KI-C) and handed to Layer 2's per-area model configuration (F-9) |
| LeadReplyRecommender never uses the model's answer | `LeadReplyRecommender.ts:112` reads `response?.content`, but `chatCompletion` returns `choices[0].message.content` | **Parked by user**, 2026-09-16 |
| Plan cache store may not run (fire-and-forget on serverless) | `Planner.ts:640-648` | Pre-existing; noted in Layer 1 (KI-2) |
| Block-content AI generation (hero/about/FAQ/features) has no production trigger | All callers pass `useAI = false`: `app/api/website/pages/route.ts:172`, `pages/[id]/enrich/route.ts:80`, `WebsitePublishService.ts:367` | Informational (Layer 1 KI-3) |
| Drill-down "System" bucket never matches real system-attributed rows | `drill-down/route.ts:216-223` vs `aiAnalytics.ts:120-126` | Open |
| Drill-down and usage reports truncate silently | `drill-down/route.ts:202-241`; `usageReport.ts:191`, `:361` | Open for the drill-down. The Layer 1.1 report is exact with display caps and an Incomplete status; **`usageReport.ts`'s two silent failures (truncation, all-zero report on a failed read) are fixed in Layer 1.5, F-1** |
| Drill-down comparison ignores feature/component/request_type/endpoint filters | `drill-down/route.ts:331-353` | Open |
| Pricing audit events have no admin identity | `pricing/route.ts:102`, `:167`, `:234` | Open |
| V6 intent-contract route trusts `x-user-id` header | `app/api/v6/generate-ir-intent-contract/route.ts:41-43` | Needs SA check |
| Several audit actions have no `EVENT_METADATA` entry | `AGENT_EXECUTED`, `PILOT_STEP_EXECUTED`, `TOKEN_DISCREPANCY_DETECTED` | Open — Layer 3 OQ-6 (BA suggests a separate follow-up) |
| **Audit entries can be silently lost, for every product** | `AuditTrailService.ts:43-44`, `:86-102`, `:224-248`, `:260-282`, `:525-529`; Next.js 14.2.35 (no `after()`), no `@vercel/functions`; the purge's critical events are not flushed (`ResetService.ts:100-119`, `:231-253`) | **Layer 3 OI-A** — separate, service-wide decision. For AI entries, the user accepted the risk for now (Layer 3 D-4 → **KI-B**) and a later change is recommended (**OI-D**) |
| **The audit service stores an auth credential in `session_id` when a request is passed** | `AuditTrailService.ts:182-190` (access / refresh cookie, or the start of the `Authorization` header) | **Layer 3 OI-B** — separate security fix; Layer 3 never passes the request |
| **No scheduled audit retention** | `applyRetentionPolicy()` (`AuditTrailService.ts:468-485`) is not called by any job in `vercel.json` | **Layer 3 OI-C** — SA to confirm |
| Story route always throws | `app/api/business-os/story/route.ts:183` | Excluded from Layer 1 |
| **WebsiteAnalyzer is dead and broken, no LLM spend** | `lib/services/WebsiteAnalyzer.ts:123-139`: calls non-existent methods (`getDefaultModel`, and `complete` on the wrong type) and reads `.choices` from the helper's result, so its LLM call always fails. It is **not** a working caller of the simple completion helper (SA code review CR-1, 2026-09-17) | Excluded from Layer 1; fix vs retire decided separately |
| The platform-account rule is written out four times | `aiAnalytics.ts:121`, `EmbeddingService.ts:46`, `IntentClassifier.ts:179`, `:698`, mirrored in `callCatalog.ts` | **Layer 1.5 part (c)** — one dependency-free `lib/platformAccount.ts`, no behaviour change. `AuditTrailService.ts:121` is a **different** rule (falls back to `null`) and is explicitly not a target |
| The allowance config is read directly from `ais_system_config` in a route | `app/api/business-os/usage/route.ts` (`readAllowanceCredits`) | **Layer 1.5, F-6** — moves into `ConfigRepository` (new multi-key method, constructed with `supabaseServer`) |
| The image reuse key is a 32-bit non-cryptographic hash | `GeneratedImageService.ts:243-247` — scoped per user, so no cross-tenant leak, but a collision silently suppresses a legitimate regeneration | Layer 1.5 follow-up F-11 |
| `usage.category.*` dictionary entries are missing for several areas | `lib/business-os/LanguageContext.tsx:1139-1147` — harmless while the card doesn't render the breakdown | Layer 1.5 follow-up F-10 |
| `console.*` logging in touched or admin files | `lib/ai/providerFactory.ts` (6 real calls), `lib/services/EmbeddingService.ts` (16) — both **converted in Layer 1** (user-approved 2026-09-17). Layer 1.5 touched three more non-compliant files: `lib/analytics/aiAnalytics.ts` (16), `lib/orchestration/IntentClassifier.ts` (16), `lib/ai/providers/openaiProvider.ts` (4). Also the `token-usage/stats`, `users/[id]/stats`, `system-config`, `system-config/pricing` routes | Layer 1.5's three: deliberately not converted in Layer 1.5 (D-6), then **converted by the logging clean-up (PR #50)**. The admin routes convert when touched |

---

## K. Open Questions and Open Items

**Resolved:**

- [x] **Q2 — Does automatic AI work count against the business?** (raised by: BA | status: **resolved 2026-09-16**) Yes; implemented in Layer 1 FR-1, FR-2.
- [x] **Q4 — Audit granularity** (raised by: BA | status: **resolved by the user 2026-09-18, Layer 3 D-1**) One audit entry per user action or background job, not per call, linked to its calls by the grouping id. With it the user decided D-2 (fields, including call and model names), D-3 (background jobs audited per business per run, info, scheduled, platform as actor) and D-4 (the audit service unchanged; loss accepted as Layer 3 KI-B; change recommended as OI-D). See E.12.
- [x] **Q8 — Legacy and broken calls** (raised by: BA | status: **resolved 2026-09-16**) Excluded from Layer 1 with reasons. Extended 2026-09-17 with the service generator. WebsiteAnalyzer's reason was sharpened by CR-1 (dead and broken, no LLM spend).
- [x] **Q9 — Past usage recorded under the system user** (raised by: BA | status: **resolved 2026-09-16**) Left as is, no backfill.
- [x] **Q10 — V6 intent-generation attribution** (raised by: BA | status: **resolved 2026-09-16**) Separate item.
- [x] **Q11 — Where the Layer 1 proof is read** (raised by: BA | status: **resolved 2026-09-16**) Data-only proof accepted for Layer 1. The report moved to Layer 1.5, then to **Layer 1.1** as an admin-only tab plus report API (2026-09-17, E.10).
- [x] **Q12 — Admin API authentication** (raised by: BA | status: **handled separately**) Separate security fix.
- [x] **Onboarding conversation attribution** (raised by: SA | status: **resolved 2026-09-17**) Not in Layer 1; **Layer 1.5, attributed to the owner** under a new `business-os-onboarding` area (option A, E.11.2). "Attributed" does not mean "charged" — see UD-1.
- [x] **AI image generation spend in Layer 1?** (raised by: SA | status: **resolved 2026-09-17**) No; excluded and moved to Layer 1.5, where it is **tracked but not charged**, in its own `business-os-images` area (option B + SA override of the BA's `website` proposal, E.11.1).
- [x] **Pino conversion of `providerFactory.ts` / `EmbeddingService.ts`** (raised by: SA | status: **approved by the user 2026-09-17**) In Layer 1.
- [x] **Layer 1.1 OQ-U1 — Is one business at a time enough to replace the all-businesses report?** (raised by: BA | status: **resolved 2026-09-17**) Yes, for now: one business plus the platform-wide check. An all-businesses overview may come later and would need a database change (F-2) (E.10.5).
- [x] **Layer 1.5 OQ-A to OQ-J** (raised by: BA | status: **decided by SA 2026-09-17**) Onboarding area and call names approved; images in their own area; grouping id minted in `getInitialState`; image method on `OpenAIProvider` via `callWithTracking` with an optional request type; model, sizes and price together in `system_settings_config`; no migration; a dependency-free `lib/platformAccount.ts`; the legacy-helper-label check stays Info; one explicitly named all-accounts repository method; failed images write a failure row. All are written into the Layer 1.5 FRs and ACs.
- [x] **Layer 1.5 OQ-U2 — Convert the touched `console.*` files to Pino in Layer 1.5 (F-8)?** (raised by: SA, widened to three files by the workplan review | status: **resolved by the user 2026-09-18 — option A, keep the freeze (D-6)**). None of `aiAnalytics.ts`, `IntentClassifier.ts` or `openaiProvider.ts` was converted in Layer 1.5. A deliberate, user-approved exception to CLAUDE.md § Logging (E.11.6).
- [x] **OI-4, OI-5, OI-6 — Pino conversion of `aiAnalytics.ts`, `IntentClassifier.ts`, `openaiProvider.ts`** (raised by: SA / Dev | status: **resolved by the logging clean-up, PR #50**, 2026-09-18). OI-7 and OI-8 resolved there too; OI-9 to OI-11 are open and tracked in the Layer 1.5 requirement and the logging clean-up workplan.

**Open items (handle later):**

- [ ] **OI-1 — "Credits remaining" drops from background work.** (raised by: SA | status: open, layer TBD — user decision 2026-09-17; **explicitly out of scope for Layer 1.5**, decided with the deduction layer)
  - **What happens:** the usage card shows credits *remaining* against the monthly allowance. Once Layer 1 ships, the nightly insight run and the daily briefing count toward the business, so "remaining" goes down even on days the owner does nothing, and some businesses may reach zero.
  - **Impact:** display only (nothing is blocked or charged), but owners may see it as unexplained consumption.
  - *BA suggestion for when it is picked up:* decide whether background work counts against the allowance, is shown separately, or is covered by a larger allowance. Decide it together with OQ-7, UD-1 and Q1.
- [ ] **UD-1 — A new owner's first month shows the onboarding conversation already spent.** (raised by: SA in the Layer 1.5 review | status: **recorded and parked**, 2026-09-17)
  - **What happens:** Layer 1.5 attributes the onboarding calls to the owner, and the card counts *down* from a monthly allowance, so a brand-new business opens its dashboard with a slice of its first month already used — for a conversation it had before it started. Nothing is billed or blocked.
  - **Evidence first:** the Layer 1.5 live run records the owner's card figures before and after an onboarding conversation, so the real number is known.
  - **The question:** should onboarding count against the owner's monthly allowance, or be attributed but excluded from the gauge? Decide with OI-1 and OQ-7 in the deduction layer.
- [ ] **OI-2 — Website block regenerate cross-tenant read.** (raised by: SA | status: open issue, handle later — user decision 2026-09-17) See J.
- [ ] **Layer 3 KI-B — Some AI audit entries may occasionally be lost.** (raised by: BA, Layer 3 | status: **accepted known risk — user decision D-4, 2026-09-18**) AI entries use the existing queued path (5 s / 100-entry batches; a failed insert loses the batch; no flush before a serverless freeze). Every call is still in the usage ledger. Layer 3's live QA run takes the first measurement.
- [ ] **Layer 3 OI-D — Recommended later change: write AI audit entries immediately and await them with a ~1–2 s cap.** (raised by: BA, Layer 3 | status: **open — recommended, not scheduled**) Owner actions are never held up by more than the cap; background jobs are unaffected; closes KI-B for AI entries only. BA suggestion: revisit once the Layer 3 QA run and early production show how often KI-B occurs, or together with OI-A.
- [ ] **Layer 3 OI-A — Audit entries can be silently lost, for every product.** (raised by: BA, Layer 3 | status: open — separate, service-wide decision) See J and the [Layer 3 requirement](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md#known-issues-and-open-items).
- [ ] **Layer 3 OI-B — The audit service stores an auth credential in `session_id` when a request is passed.** (raised by: BA, Layer 3 | status: open — separate security fix) See J.
- [ ] **Layer 3 OI-C — No scheduled audit retention.** (raised by: BA, Layer 3 | status: open — SA to confirm) See J.

**Deferred questions:**

- [ ] **OQ-7 — Should AI-generated images count against a business's monthly credits, and how many credits is one image worth?** (raised by: SA / BA | status: **open and parked by the user, 2026-09-17**). Images are priced per image, not per token, so today's rule (credits = tokens ÷ tokens per credit) can't express them. **Layer 1.5 deliberately makes image spend visible first, without charging for it** — and, with the dedicated `business-os-images` area, the per-month image cost is readable as one figure, which is the evidence this decision needs. *BA suggestion:* decide together with OI-1, UD-1 and Q1 in the deduction layer. A follow-on question belongs with it: once charging is decided, should the owner see image spend on the usage card, and in what unit?
- [ ] **Q1 — What should a credit represent?** (raised by: BA | status: open, deferred to the deduction layer). *BA suggestion:* decide in the deduction layer; make the dollar figure trustworthy first.
- [ ] **Q6 — Should failed or discarded attempts count?** (raised by: BA | status: deferred to the deduction layer).

Layer 1.1's open questions are all resolved; the SA's decisions and follow-ups (F-1 to F-4) are in the [Layer 1.1 requirement](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md#sa-review). F-1 and F-6 are folded into Layer 1.5; F-2, F-3 and F-4 remain open follow-ups, joined by the Layer 1.5 follow-ups F-7, F-9, F-10, F-11 and F-12 ([Layer 1.5 requirement](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md#sa-review)). F-8 became OI-4.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-16 | Created | Round 1: shared credit/cost flow, audit trail, model config and admin pages, per-call inventory of Business OS LLM calls |
| 2026-09-16 | Round 2 + decisions | Added user decisions (layered delivery, Q2, Q3 deferral, Q5 config shape, LeadReplyRecommender parked); agents-side investigation for Q1 and Q4; reuse/gaps; suggested Layer 1 |
| 2026-09-16 | Round 3 | Added section I (existing reporting vs Layer 1 verification); confirmed `/api/admin/**` is unauthenticated; naming gotchas; renumbered J/K; added Q11, Q12 |
| 2026-09-16 | Layer 1 decisions + requirement | Added E.7; resolved Q2, Q8–Q11; Q12 handled separately; H.3 points to the Layer 1 requirement |
| 2026-09-17 | Layer 1 finalised (SA approved) | Added E.8 (onboarding conversation → Layer 1.5; "credits remaining" drop → OI-1, layer TBD; block regenerate cross-tenant read → OI-2); D notes the onboarding conversation and block-content no-trigger finding; J adds OI-2, KI-1, onboarding conversation, plan-cache store and block-content rows, Pino flags; K renamed "Open Questions and Open Items" with OI-1/OI-2; H.3 updated with Layer 1.5 contents and final counts (26 FRs, 24 ACs); sections B–I condensed where the requirement is now the source of detail |
| 2026-09-17 | SA workplan review follow-up (RQ-1) + user decisions | Added E.9: service generator (`ServiceGeneratorService.ts:304`, broken, no spend) excluded; AI image generation (`GeneratedImageService.ts:186`, direct SDK, not in `token_usage`, per-image pricing, own daily cap) excluded and moved to Layer 1.5 with open business question OQ-7 (do images count against monthly credits, credits per image); Pino conversion of `providerFactory.ts` (6 calls) and `EmbeddingService.ts` (16) approved for Layer 1. D gains a "found at SA reviews" table; A.2/F.4/F.6 note image spend isn't representable; H.2/H.3 Layer 1.5(c); J adds image and service-generator rows and updates the Pino row; K adds OQ-7 and the two resolved items. Refreshed line refs noted (`Planner.ts:444`, usage mapping `:65-89`) |
| 2026-09-17 | SA code review CR-1 mirrored (docs only) | No contradiction existed: row 18 already listed WebsiteAnalyzer as dead and broken. Sharpened the evidence (calls non-existent `getDefaultModel` and `complete` on the wrong type; LLM call always fails; no spend) in D row 18 and J. A.6 now states the onboarding conversation is the only live non-Business OS caller of `getProviderFactory().complete()`. Added E.9.5 and the Q8 note, matching the Layer 1 requirement's corrected FR-12/AC-7 |
| 2026-09-17 | Layer 1.1 added to the layers (user decisions) | Added E.10 (verification tab now; merge with the Layer 1.5 report; admins only; start on merged main). H renamed "Reuse, Gaps and Layers"; H.3 is now a layers table with Layer 1 merged (PR #47), Layer 1.1 (LLM Usage tab + report API, draft) and Layer 1.5 reduced to onboarding conversation + AI images. I intro, I.3 and I.5 point at Layer 1.1; J truncation row and K Q11 updated; overview links the Layer 1.1 requirement; A.4 notes the post-Layer-1 usage summary function and extracted category mapping |
| 2026-09-17 | Layer 1.1 SA approved + OQ-U1 decided | Added E.10.5 (user decision OQ-U1: one business at a time plus the platform-wide check is enough for now; an all-businesses overview may come later and needs a database function, F-2). H.3 Layer 1.1 row → SA approved, ready for Dev workplan (24 FRs, 24 ACs, no migration, `TokenUsageRepository`, `usageSummary.ts`, catalog constants, Incomplete status); "Later" row adds the optional all-businesses overview. H.2, I intro, I.5, J truncation row and K updated (OQ-U1 resolved; `usageReport.ts` → F-1); A.4 notes the `usageSummary.ts` extraction |
| 2026-09-17 | Layer 1.5 follow-up added | H.3 layers table 1.5(c): one shared helper for the platform-account fallback, replacing five copies; no behaviour change (user decision) |
| 2026-09-17 | Layer 1.5 scoped + requirement written (user decisions) | Added E.11 with the user's Layer 1.5 decisions: **AI images tracked but not charged (option B)** with the **charging decision parked** (OQ-7 stays open, linked to OI-1 and the deduction layer; credits per image parked); **onboarding conversation attributed to the owner (option A)**, "attributed" ≠ "charged"; one shared platform-account helper; Layer 1.1 follow-ups **F-1** and **F-6** folded in, **OI-1 out of scope**; the verification tab updated so Layer 1.5 has proof. H.3 Layer 1.5 row rewritten as the four parts and linked to [the requirement](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) (26 FRs, 24 ACs, draft); Layer 1.1 marked merged (PR #48); "Later" row adds OQ-7 and owner-facing image visibility. A.2, A.3, A.4, A.6, C, D (image and onboarding rows), F.4, F.6, H.1, H.2, I.1, I.4, I.5, J (image, onboarding, truncation, platform-helper, allowance-config and Pino rows) and K (OQ-7 parked, OI-1 out of Layer 1.5 scope, onboarding and image items resolved) annotated. Overview links the Layer 1.5 requirement |
| 2026-09-17 | Layer 1.5 SA approved (RC-1 to RC-20 applied) — mirrored | E.11 gains the SA decisions: **images get their own area `business-os-images`** (the BA's `website` proposal overridden, because the owner card never renders the breakdown and the area totals are the only place image spend becomes one figure); both new areas carry **empty legacy-feature lists** or Check 2 and the `help` mapping break; the zero-token claim corrected — **call counts do rise**, nothing owner-facing renders them; price precedence configuration → documented fallback → 0 with `quality` pinned; grouping ids minted in `getInitialState` (never the body's `conversationId`) and at the one image route; a dependency-free `lib/platformAccount.ts` imported *by* the catalog; failed and empty-but-billed images write rows; **F-8 (`aiAnalytics.ts` Pino conversion) left open as user question OQ-U2**; new user note **UD-1** (a new owner's first month shows its own onboarding conversation already spent — measured by the live run, decided with OI-1 and OQ-7). H.3 Layer 1.5 row rewritten and marked SA approved, ready for Dev workplan; Summary, A.1, A.2, A.3, A.4, A.6, C, D (onboarding and image rows), F.4, F.6, H.1, H.2, I.1, I.4, I.5, J (image area, onboarding model literals, platform-helper, allowance-config, reuse hash, dictionary entries and `console.*` rows) and K (Layer 1.5 OQ-A–OQ-J resolved, UD-1 and OQ-U2 added, OQ-7 updated) mirrored. Overview marks Layer 1.5 SA approved |
| 2026-09-18 | Layer 1.5 workplan amendments (BA-1, BA-2) + user decision D-6 — mirrored | **D-6 (user, 2026-09-18) — keep the freeze:** Layer 1.5 converts none of the three touched non-compliant files; recorded in E.11.6 as a deliberate, user-approved exception to CLAUDE.md § Logging, with the reason; OQ-U2 moved to Resolved; the three conversions added to K's open items as **OI-4** (`aiAnalytics.ts`, 16, highest risk, separate mechanical commit), **OI-5** (`IntentClassifier.ts`, 16, medium risk, no Layer 1.5 test coverage) and **OI-6** (`openaiProvider.ts`, 4, low risk, `getInstance` guards only); J's `console.*` row and H.3 updated; F-8 superseded by OI-4. **BA-1:** `extractClientTracking` is dead code, so three onboarding call types can fire live — new J row, D onboarding row and E.11 amendment (Layer 1.5 KI-D, F-12). **BA-2:** image config read is `getImageGenerationConfig()` on `getByKeys` (one round trip), not the two-round-trip `getAgentCreationConfig()` (C, H.1, H.3); corrected `aiAnalytics.ts` line list; three non-compliant touched files named. Summary and overview updated |
| 2026-09-18 | Layer 1.5 implemented (code complete) — mirrored | E.11 is implemented and awaits SA code review ([workplan](/docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md)). Image rows: zero tokens and a per-image cost; the request keeps quality `auto` and each image is priced by the quality the provider reports it used (CR-1 option C, user decision 2026-09-18), from `image_generation_prices_usd` with a documented fallback map; the charging decision (OQ-7) stays parked with OI-1 and UD-1. F-1: the chat usage report now reports a failed read as a failure and a capped read as truncated. F-6: the allowance read goes through `ConfigRepository.getSystemConfigs` |
| 2026-09-18 | Layer 1.5 image quality (SA code review CR-1, user decision D-7) — one-line mirror | E.11's "Price precedence" bullet no longer says quality is pinned: per D-7 the request stays at `auto` (images unchanged) and each image is priced after the call at the quality the provider reports, or at `high` with a warning if none is reported. Detail in the Layer 1.5 requirement (D-7, FR-10, FR-13, AC-8, KI-E) |
| 2026-09-18 | Logging clean-up (OI-4 to OI-8) — mirrored | The [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md) is code complete: the tracker, the intent classifier and the OpenAI provider log through Pino; a failed ledger insert no longer logs the row; onboarding logs no raw owner text, and logs derived text at debug only (D-OI8). OI-9 (redaction not active) and OI-10 added as open in the Layer 1.5 requirement |
| 2026-09-18 | Logging clean-up SA code review (CR-1 to CR-4) — mirrored | Onboarding no longer logs service names (a count instead), an extractor parse error logs only its name at error, and a model-returned adjustment intent reaches info only as a known label. OI-11 (pre-existing `TokenBudgetManager.test.ts` failures, 17 of 21) added as open beside OI-10 |
| 2026-09-18 | Layer 3 (AI activity audit trail) requirement drafted; Q4 advanced | Added E.12 and the [Layer 3 requirement](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md) (20 FRs, 20 ACs, draft). **Q4 advanced:** agreed direction one audit event per user action or background job, linked to the ledger by the grouping id, pending the user's confirmation (BD-1); BD-3 (audit background jobs — BA: yes, one per business per run) and BD-4 (make AI events durable — BA: yes) put to the user. §B re-checked against `main` 7646760a: entries are queued, not written, when `log()` returns; a failed write drops its batch; no `after()` / `waitUntil` (Next.js 14.2.35, no `@vercel/functions`) so queued entries can be lost when a serverless function freezes — even the purge's critical events are not flushed; an auth credential is stored in `session_id` when a request is passed; no scheduled retention. New J rows and K open items **Layer 3 OI-A to OI-C**; the unregistered agents events row points at Layer 3 OQ-6. H.2 items 5 and 9, H.3 (Layer 1.5 and the logging clean-up marked merged; new Layer 3 row; "per-action audit events" removed from Later) and G.3 updated; OI-4 to OI-6 moved to Resolved (logging clean-up, PR #50); overview and Summary link Layer 3 |
| 2026-09-18 | Layer 3 user decisions D-1 to D-4 — mirrored; Q4 resolved | **Q4 resolved** (Layer 3 D-1: one entry per user action or background job, linked by the grouping id). E.12 rewritten with the four user decisions: D-2 fields agreed including call and model names; D-3 background jobs audited per business per run, info, scheduled, platform as actor; **D-4 reliability not changed** — the audit service stays as it is and AI entries use the existing queued `log()` path. The loss is recorded as Layer 3 **KI-B** (accepted known risk) and the recommended later change — immediate AI writes awaited with a ~1–2 s cap — as Layer 3 **OI-D**; OI-A stays the service-wide item. Summary, §B, G.3, H.1, H.2 item 9, H.3 (Layer 3 row: decisions recorded, pending SA; Later adds OI-D), J (audit-loss row) and K (Q4 moved to Resolved; KI-B and OI-D added to open items) updated |
| 2026-09-18 | Layer 3 SA approved (RC-1 to RC-12 applied) + user decisions D-5, D-6 — one-line mirrors | Overview, E.12 (header counts and one closing line) and the H.3 Layer 3 row now record: SA approved, ready for Dev workplan (28 FRs, 27 ACs); **D-5** the audit API routes are secured as step 0 of Layer 3, before any AI entry is written; **D-6** AI entries hidden from owners until the charging decision. Other Layer 3 references in this doc (H.1 read-back, J / K OI-C "SA to confirm") are superseded by the requirement and left as they were |
| 2026-09-19 | Layer 3 steps 3–5 code-complete — mirrored | Every Business OS area writes one AI audit entry per action through `runAiAction`: chat turns, insight runs, briefings, website and intake generation, onboarding turns and builds, lead replies, images. The owner-policy migration has been applied. Standard #3 is met in code, pending review, QA and deploy |
