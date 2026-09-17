# LLM Credit, Cost and Audit Tracking — Investigation

> **Last Updated**: 2026-09-17

## Overview

This investigation maps how LLM calls are metered (tokens, dollar cost, Pilot Credits), audited, configured and attributed to users today. It is the input to requirements for these Business OS LLM standards: (1) no hardcoded models, and every call configurable in the DB and the admin page; (2) the credit cost of every call is tracked; (3) every call is recorded in the audit trail; (4) every call is attributed to the real user rather than `system`.

- **Round 1** (sections A–D) covers the shared infrastructure and the Business OS calls.
- **Round 2** (sections F–G) looks at the AgentsPilot AI Agents side to answer the open questions about real dollar cost and audit granularity, and to find what can be reused.
- **Round 3** (section I) checks whether existing reporting can serve as Layer 1's "tracking is complete" proof.

Requirements are written layer by layer (see [Decisions & Direction](#e-decisions--direction)). Layer 1 (SA approved, ready for Dev workplan): [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md).

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
- [H. Reuse, Gaps and Suggested First Layer](#h-reuse-gaps-and-suggested-first-layer)
- [I. Existing Reporting vs. the Layer 1 Verification Report](#i-existing-reporting-vs-the-layer-1-verification-report)
- [J. Known Issues Found (not in scope)](#j-known-issues-found-not-in-scope)
- [K. Open Questions and Open Items](#k-open-questions-and-open-items)
- [Change History](#change-history)

---

## Summary

| Standard | Today |
|---|---|
| 1. Model in DB + admin entry | 3 of 18 Business OS call sites read a DB key. None of those keys can be edited in any admin page. |
| 2. Credit cost tracked | Partly. Every call through the provider layer writes a `token_usage` row with tokens and `cost_usd`. Business OS credits are only derived when the usage screen is read, and nothing is deducted. Only agent runs deduct credits. AI image generation isn't recorded at all. |
| 3. Every call in the audit trail | No. There is no LLM-call event, and the provider layer never writes to `audit_trail`. The agents side audits per run and per step, not per call. |
| 4. Real user ID | 8 of the 18 Business OS sites don't pass one, and they land on the system user. The same gap exists on the agents side for V6 intent generation and in the onboarding conversation (4 calls per session). |

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

### A.2 How reliable `cost_usd` is

- `calculateCostSync` only reads the in-memory price cache. It **never loads** `ai_model_pricing` itself (`pricing.ts:241-250`). Only the async `calculateCost` / `getPricing` / `refreshPricingCache` load the table (`:119-171`, `:288-290`). I didn't confirm that anything warms the cache per server instance.
- If the cache is cold, it falls back to the hardcoded `FALLBACK_PRICING` list (`pricing.ts:42-114`). Any model not on that list is recorded at **$0** with only a console warning (`:252-255`).
- Only input and output token rates are modelled. There is no cached-input or batch discount.
- The provider layer has no image-generation method, and the pricing model is per token only, so per-image spend can't be represented (see D, `GeneratedImageService.ts`).

### A.3 Tokens to Pilot Credits

- Credits are based on **token count, not cost**: `ceil(tokens / tokens_per_pilot_credit)`, default 10 (`lib/utils/pricingConfig.ts:102-108`). The rate lives in `ais_system_config`.
- A gpt-4o token, a gpt-4o-mini token and an embedding token all cost the same number of credits.
- `CreditService` only has agent-scoped charges: `chargeForExecution` (`lib/services/CreditService.ts:155`), `chargeForCreation` (`:222`) and `chargeTokensWithIntensity` (`:444`). **Business OS never calls any of them.**

### A.4 Business OS usage screen

`app/api/business-os/usage/route.ts`:

- Reads `token_usage` through `getUsageAnalytics({ userId })` (`:186`) and converts tokens to credits at read time (`:112-125`, `:200`).
- The allowance is `monthly_ai_allowance_usd / pilot_credit_cost_usd` (`:143-163`). It is **display only**.
- The card counts **down** "credits remaining" against that allowance (`components/business-os/UsageCard.tsx:1-24`), and doesn't render the category breakdown (`:21-24`).
- The route's own comment says the `user_subscriptions` ledger understates real consumption 13x (`:250-258`).
- Feature-to-category mapping is at `:49-69` (at `:65-89` on the Layer 1 branch base).
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

---

## D. Business OS LLM Calls — Current Behaviour

All calls go to OpenAI. The required after-state is in the Layer 1 requirement.

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
| 18 | WebsiteAnalyzer `lib/services/WebsiteAnalyzer.ts:123` | From caller | Broken | none | Website (dead, excluded) |

**Found at SA reviews, not in the original 18:**

| Call | Where | Behaviour today | Layer 1 status |
|---|---|---|---|
| Onboarding conversation (4 calls per session) | `lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397` | Via `complete()`, recorded as `system` / `onboarding` | **Excluded; moved to Layer 1.5** (E.8) |
| Service generator | `lib/services/ServiceGeneratorService.ts:275`, `:304` | Broken: calls a `complete` method the provider doesn't have (and reads `response.choices`, `:314`). It always falls back, so there is no LLM spend and no ledger row | **Excluded** (same class as Story; retire-vs-fix separately) (E.9) |
| AI image generation | `lib/services/GeneratedImageService.ts:186-187` | Direct OpenAI SDK `images.generate` (`gpt-image-1`), bypassing the provider layer, so it is **not recorded in `token_usage`**. Images are priced per image, not per token. It has its own daily per-business image cap (`:170-183`) | **Excluded; moved to Layer 1.5** (user decision 2026-09-17) (E.9) |

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

- Remain open for the later layers that need them.

### E.7 Layer 1 decisions (2026-09-16)

1. Usage card totals rising is accepted.
2. Legacy and broken calls stay excluded from Layer 1: chat v2, chat v1, the story route, WebsiteAnalyzer. The LeadReplyRecommender bug stays parked.
3. No backfill of past system-attributed usage.
4. V6 intent-generation attribution is a separate item.
5. A data-only proof is acceptable (Q11). The extended chat usage report is moved **out of Layer 1 into Layer 1.5**; Layer 1 is proven by QA test evidence.
6. Admin API route authentication (Q12) is handled as a separate security fix.

### E.8 Layer 1 finalisation decisions (2026-09-17)

1. **Onboarding conversation LLM calls** (4 per session, `OnboardingConversationManager.ts`, still on the platform account) are **not in Layer 1**. They are added to **Layer 1.5**, next to the extended usage report.
2. **"Credits remaining" dropping from background work** is not solved now. It is recorded as an open item to handle later, layer TBD (K, OI-1).
3. **The cross-tenant read in the website block regenerate route** is recorded as an open issue to handle later, out of Layer 1 scope (J, OI-2).

SA's required changes RC-1 to RC-15 were applied to the Layer 1 requirement on the same date. Its status is SA approved, ready for Dev workplan.

### E.9 Decisions after the SA workplan review (2026-09-17)

1. **Service generator** (`ServiceGeneratorService.ts:304`) is excluded from Layer 1. It is broken and makes no LLM spend (RQ-1).
2. **AI image generation** (`GeneratedImageService.ts:186`) is excluded from Layer 1 and **moved to Layer 1.5**, next to the extended usage report and the onboarding conversation calls (user decision). Open business question for then: should AI images count against monthly credits, and how many credits is one image worth? (K, OQ-7)
3. **Pino conversion** of `lib/ai/providerFactory.ts` (6 real `console.*` calls) and `lib/services/EmbeddingService.ts` (16) is **approved by the user for this cycle**, as part of Layer 1 delivery.
4. Requirement refinements from the workplan review: the verified-question store embedding gets its own call name (RQ-2), and chat analysis always uses the turn id (RQ-3). Both are in the Layer 1 requirement.

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
- "Sync pricing" upserts a hardcoded catalog (`pricing/sync/route.ts:31-375`) with no embedding or image models.

### F.5 Reconciliation

- `TokenReconciliationService` compares our own two token records (`lib/services/TokenReconciliationService.ts:72-133`). It doesn't check against provider invoices.
- Batch mode looks inconsistent (`:215-232`). Whether it runs after every execution is unverified.

### F.6 Conclusion (business terms)

**Can we know what each call cost us?** Yes in principle, not reliably today.

- **Gaps:**
  - a hardcoded price fallback, with unknown models costed at $0;
  - no cached-prompt discounts;
  - no invoice reconciliation;
  - some calls recorded under the system user or not recorded at all (including AI images);
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

Yes, it is the same infrastructure. Business OS needs a real user, area/call names and a grouping id, which Layer 1 provides. Suggested audit granularity for a later layer: per action.

---

## H. Reuse, Gaps and Suggested First Layer

### H.1 What exists and can be reused

| Capability | Reuse for Business OS |
|---|---|
| Per-call ledger (`token_usage`) | Yes, as is |
| Correlation fields | Yes. Layer 1 uses `feature` = area, `component` = call name, `session_id` = UUID grouping id |
| Per-action audit events carrying token totals | Yes, as the pattern |
| DB-driven provider + model per purpose | Yes, as the pattern |
| Admin price table | Yes, once read reliably |
| Admin-gated chat usage report (`/api/admin/chat-usage` + `usageReport.ts`) | Base for the Layer 1.5 report |

### H.2 What's missing

1. Correct attribution (Layer 1; onboarding conversation and AI images Layer 1.5; V6 separate).
2. A stable naming scheme (Layer 1).
3. A reliable dollar figure.
4. Per-call model configuration (Layer 2).
5. Per-action audit events.
6. A completeness report (Layer 1.5).
7. Admin identity on pricing and config changes, and authentication on `/api/admin/**` (separate security fix).
8. Image-generation tracking: an image method in the provider layer, image pricing, and a credits rule (Layer 1.5).

### H.3 First layer (as decided)

The Layer 1 requirement is [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) (26 FRs, 24 ACs; SA approved, ready for Dev workplan).

- **Layer 1:** every in-scope Business OS AI call is recorded against the right business, with area, call name and UUID grouping id, through a new call catalog and attribution builder. The usage category mapping is updated in the same release. `providerFactory.ts` and `EmbeddingService.ts` are converted to Pino. Proof is QA test evidence and code review.
- **Layer 1.5:**
  - (a) the extended admin data report (I.5);
  - (b) onboarding conversation attribution (E.8.1);
  - (c) AI image generation brought into usage tracking, with the open question of whether and how images count against credits (E.9.2, OQ-7).
- **Layer 2:** JSON model configuration per area.
- **Later:**
  - cost accuracy;
  - per-action audit events;
  - admin UI;
  - deduction and enforcement;
  - "credits remaining" treatment of background work (OI-1, layer TBD).

---

## I. Existing Reporting vs. the Layer 1 Verification Report

**Required at the time (now Layer 1.5):** per business × area, for a period, calls, tokens and estimated cost, plus proof that no Business OS rows land on the system user.

### I.1 `lib/business-os/bizql/telemetry/usageReport.ts`

| Aspect | Finding |
|---|---|
| What it reports | `getChatUsage`: turns, calls, cost, cost per turn, tokens, cache layers, repair rate, failures, latency, `turnsCovered` (`:48-96`, `:111-172`). `getChatPricing`: per-user cost and distributions (`:227-259`, `:274-345`) |
| Source / filters | `feature = 'business-os-chat'` hard-coded (`:187`, `:358`); date window; optional `user_id`. Row cap 10,000 / 50,000, which truncates silently |
| Coverage | Chat only |
| System rows | Can't flag them |
| Caller | `GET /api/admin/chat-usage` (`chat-usage/route.ts:21`, `:65`), properly admin-gated (`:37-52`) |

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
- **Status:** separate security fix (E.7.6).

### I.4 Naming gotcha for Layer 1

- Chat keeps `business-os-chat` (ChatBudget, usageReport).
- The usage category mapping maps new and legacy values into the new categories.
- `onboarding` stays under help.
- Captured in Layer 1 FR-5, FR-21.

### I.5 Conclusion

Existing screens can't serve as the proof. The smallest option is extending the chat usage report. **Decided: Layer 1.5.**

---

## J. Known Issues Found (not in scope)

| Issue | Evidence | Status |
|---|---|---|
| **Admin API routes are unauthenticated** | `middleware.ts:84` skips `/api`; no gate in `app/admin/layout.tsx`; no auth in the admin token-usage, stats, dashboard, system-config, pricing, helpbot-config and agent-generation-config routes | Separate security fix (outside this effort) |
| **OI-2 — Website block regenerate reads another business's block (cross-tenant read)** | `app/api/website/blocks/[blockId]/regenerate/route.ts:55-61` calls the unscoped `WebsiteBlockRepository.findById` (`WebsiteBlockRepository.ts:220-226`); the other business's content is sent to the AI (`:73`) and the rewrite returned | **Open issue, handle later** (user decision 2026-09-17); separate fix with the `tenant-isolation-guard` skill; out of Layer 1 |
| **KI-1 — Chat "rewrite a section field" never works** | `WebsiteSectionService.ts:519-529` sends `field`/`language`/`context`; `regenerateField` reads `fieldToRegenerate`/`targetLanguage`/`businessProfile` (`WebsiteAIContentService.ts:278-284`) | Open — separate fix; Layer 1 adds attribution only (compile-only) |
| **AI images aren't tracked as usage** | `lib/services/GeneratedImageService.ts:186-187` calls the OpenAI SDK directly (`images.generate`), bypassing the provider layer and the ledger; only a daily per-business cap applies (`:170-183`) | **Layer 1.5** (user decision 2026-09-17); open business question OQ-7 |
| **Service generator AI never runs** | `lib/services/ServiceGeneratorService.ts:275`, `:304` call a non-existent `complete` on the provider; `:314` reads `response.choices`; always falls back, no spend | Excluded from Layer 1; retire-vs-fix separately |
| Onboarding conversation LLM calls on the platform account | `lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397` | **Layer 1.5** (user decision 2026-09-17) |
| LeadReplyRecommender never uses the model's answer | `LeadReplyRecommender.ts:112` reads `response?.content`, but `chatCompletion` returns `choices[0].message.content` | **Parked by user**, 2026-09-16 |
| Plan cache store may not run (fire-and-forget on serverless) | `Planner.ts:640-648` | Pre-existing; noted in Layer 1 (KI-2) |
| Block-content AI generation (hero/about/FAQ/features) has no production trigger | All callers pass `useAI = false`: `app/api/website/pages/route.ts:172`, `pages/[id]/enrich/route.ts:80`, `WebsitePublishService.ts:367` | Informational (Layer 1 KI-3) |
| Drill-down "System" bucket never matches real system-attributed rows | `drill-down/route.ts:216-223` vs `aiAnalytics.ts:120-126` | Open |
| Drill-down and usage reports truncate silently | `drill-down/route.ts:202-241`; `usageReport.ts:191`, `:361` | Open (usage report part in Layer 1.5) |
| Drill-down comparison ignores feature/component/request_type/endpoint filters | `drill-down/route.ts:331-353` | Open |
| Pricing audit events have no admin identity | `pricing/route.ts:102`, `:167`, `:234` | Open |
| V6 intent-contract route trusts `x-user-id` header | `app/api/v6/generate-ir-intent-contract/route.ts:41-43` | Needs SA check |
| Several audit actions have no `EVENT_METADATA` entry | `AGENT_EXECUTED`, `PILOT_STEP_EXECUTED`, `TOKEN_DISCREPANCY_DETECTED` | Open |
| Story route always throws | `app/api/business-os/story/route.ts:183` | Excluded from Layer 1 |
| WebsiteAnalyzer is dead and broken | `lib/services/WebsiteAnalyzer.ts:123-139` | Excluded from Layer 1 |
| `console.*` logging in touched or admin files | `lib/ai/providerFactory.ts` (6 real calls), `lib/services/EmbeddingService.ts` (16). Also `token-usage/stats`, `users/[id]/stats`, `system-config`, `system-config/pricing` routes | First two: **conversion approved by the user for Layer 1 (2026-09-17)**. Others convert when touched |

---

## K. Open Questions and Open Items

**Resolved:**

- [x] **Q2 — Does automatic AI work count against the business?** (raised by: BA | status: **resolved 2026-09-16**) Yes; implemented in Layer 1 FR-1, FR-2.
- [x] **Q8 — Legacy and broken calls** (raised by: BA | status: **resolved 2026-09-16**) Excluded from Layer 1 with reasons. Extended 2026-09-17 with the service generator.
- [x] **Q9 — Past usage recorded under the system user** (raised by: BA | status: **resolved 2026-09-16**) Left as is, no backfill.
- [x] **Q10 — V6 intent-generation attribution** (raised by: BA | status: **resolved 2026-09-16**) Separate item.
- [x] **Q11 — Where the Layer 1 proof is read** (raised by: BA | status: **resolved 2026-09-16**) Data-only proof accepted; report moved to Layer 1.5; Layer 1 proven by QA evidence.
- [x] **Q12 — Admin API authentication** (raised by: BA | status: **handled separately**) Separate security fix.
- [x] **Onboarding conversation attribution** (raised by: SA | status: **resolved 2026-09-17**) Not in Layer 1; Layer 1.5.
- [x] **AI image generation spend in Layer 1?** (raised by: SA | status: **resolved 2026-09-17**) No; excluded and moved to Layer 1.5.
- [x] **Pino conversion of `providerFactory.ts` / `EmbeddingService.ts`** (raised by: SA | status: **approved by the user 2026-09-17**) In Layer 1.

**Open items (handle later):**

- [ ] **OI-1 — "Credits remaining" drops from background work.** (raised by: SA | status: open, layer TBD — user decision 2026-09-17)
  - **What happens:** the usage card shows credits *remaining* against the monthly allowance. Once Layer 1 ships, the nightly insight run and the daily briefing count toward the business, so "remaining" goes down even on days the owner does nothing, and some businesses may reach zero.
  - **Impact:** display only (nothing is blocked or charged), but owners may see it as unexplained consumption.
  - *BA suggestion for when it is picked up:* decide whether background work counts against the allowance, is shown separately, or is covered by a larger allowance.
- [ ] **OI-2 — Website block regenerate cross-tenant read.** (raised by: SA | status: open issue, handle later — user decision 2026-09-17) See J.

**Deferred questions:**

- [ ] **OQ-7 — Should AI-generated images count against a business's monthly credits, and how many credits is one image worth?** (raised by: SA / BA | status: open, to be answered when Layer 1.5 is written). Images are priced per image, not per token, so today's rule (credits = tokens ÷ tokens per credit) can't express them. *BA suggestion:* decide together with OI-1, since both are about what an owner's allowance should include.
- [ ] **Q1 — What should a credit represent?** (raised by: BA | status: open, deferred to the deduction layer). *BA suggestion:* decide in the deduction layer; make the dollar figure trustworthy first.
- [ ] **Q4 — Audit granularity** (raised by: BA | status: open, deferred to the audit layer). *BA suggestion:* per action.
- [ ] **Q6 — Should failed or discarded attempts count?** (raised by: BA | status: deferred to the deduction layer).

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
