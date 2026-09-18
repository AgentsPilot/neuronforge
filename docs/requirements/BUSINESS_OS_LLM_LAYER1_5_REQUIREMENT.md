# Requirement: Business OS LLM — Layer 1.5

> **Last Updated**: 2026-09-18

**Created by:** BA
**Date:** 2026-09-17
**Status:** SA approved — changes applied, ready for Dev workplan (SA review 2026-09-17; RC-1 to RC-20 applied 2026-09-17; workplan-review amendments BA-1 and BA-2 applied 2026-09-18; SA code-review correction CR-1 applied 2026-09-18 as user decision D-7). **OQ-U2 / F-8 resolved by the user 2026-09-18 (D-6): keep the freeze** — Layer 1.5 converts none of the three touched non-compliant files; the conversions are open items OI-4 to OI-6.

## Overview

Layer 1 (PR #47) gave every in-scope Business OS LLM call a real business account, an area, a stable call name and a grouping id. Layer 1.1 (PR #48) added the admin-only **LLM Usage** verification tab and report API. Both are merged.

Two kinds of AI spend were deliberately left out, and one piece of duplicated code was left behind:

| Left out | Today |
|---|---|
| **Onboarding conversation** (four extraction methods; three can fire live, KI-D) | Recorded on the platform account as `onboarding` / `simple-complete`, so a new owner's onboarding spend belongs to nobody |
| **AI image generation** | Calls OpenAI directly, outside the provider layer, so it is **not recorded at all** — not in the ledger, not on the usage card, not in the admin report |
| **Platform-account rule** | The same `SYSTEM_ADMIN_USER_ID || '00000000-…'` line is written out in four places |

Layer 1.5 closes all three, extends the verification tab so the new spend is provable, and folds in two small follow-ups from the Layer 1.1 SA review (F-1, F-6).

**It does not change what anyone is charged**, and it does not change what images look like (D-7). Images are tracked, not charged; the charging decision is parked and must be revisited (see [The parked charging decision](#the-parked-charging-decision)). One consequence is user-visible and recorded as [UD-1](#for-the-user-business-decisions): a brand-new business will see part of its first month's allowance already used, for its own onboarding conversation.

**Evidence and context:**
- [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) — the catalog pattern, excluded calls, KI-5, OQ-7.
- [BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md) — the checks, `TokenUsageRepository`, follow-ups F-1 to F-4.
- [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md) — A.2 (pricing is token-based), A.3 (credits are token counts), E.9, E.10, E.11.
- [BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md) — code-reality check (M-1 to M-6), SA review §11 (BA-1, BA-2) and the SA code review (CR-1).

---

## Table of Contents

- [User Decisions](#user-decisions)
- [The parked charging decision](#the-parked-charging-decision)
- [User Stories](#user-stories)
- [Scope](#scope)
- [Catalog Additions](#catalog-additions)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Known Issues and Open Items](#known-issues-and-open-items)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## User Decisions

Recorded 2026-09-17 and 2026-09-18, relayed through the coordinator. Quoted as given.

| # | Decision |
|---|---|
| **D-1** | **"AI images: track only, don't charge (option B)."** Image spend becomes visible in the usage ledger, per business, and in cost reporting, but does **not** consume credits yet. **"Explicitly document that the charging decision is parked and must be revisited"** — OQ-7 stays open and is linked to OI-1 and the future deduction layer |
| **D-2** | **"Credits per image: parked"** with the charging decision |
| **D-3** | **"Onboarding conversation: attribute to the owner (option A)."** The 4 calls per session are recorded against the new owner's account, with area and call names. Since charging isn't handled yet, **"attributed" does not mean "charged"** |
| **D-4** | **"Fold in the small follow-ups"** and say so in the doc: **F-1** (`getChatUsage`: silent 10,000-row cap and the all-zero report on read failure; move its reads onto `TokenUsageRepository`) and **F-6** (`readAllowanceCredits`'s direct `ais_system_config` read moves into `ConfigRepository`). **Out of scope: OI-1** ("credits remaining" drops from background work) — decided with the deduction layer |
| **D-5** | **"Update the LLM Usage verification tab"** so the new areas and calls are covered, **"otherwise Layer 1.5 has no proof"** |
| **D-6** | *(2026-09-18, OQ-U2 / F-8)* **Option A — keep the freeze.** Layer 1.5 converts **none** of the three touched files that still log through `console.*` (`lib/analytics/aiAnalytics.ts`, `lib/orchestration/IntentClassifier.ts`, `lib/ai/providers/openaiProvider.ts`); only the lines the FRs need are changed. The three conversions are recorded as open items to handle later ([OI-4 to OI-6](#known-issues-and-open-items)) |
| **D-7** | *(2026-09-18, SA code review CR-1)* **Option C — keep image quality `auto`, record the true cost.** Images are generated exactly as today (quality `auto`, so how they look and what they cost the platform are unchanged). Each image is priced **after** the call, at the quality the provider **reports it actually used**: model + size + reported quality. If the provider reports no quality, the image is priced at `high` and a warning is logged. Quality stays a setting — `image_generation_quality`, default `auto` — so it can be changed later without a deploy |

*Note on D-3's "4 calls":* the four **extraction methods** are all attributed, but only **three** call types can fire in a live session, because `extractClientTracking` is unreachable today ([KI-D](#known-issues-and-open-items)).

**D-6 is a deliberate, user-approved exception** to CLAUDE.md § Logging ("if you touch a file that still logs via `console.*`, … proceed with the conversion once the user approves, unless they explicitly decline"). The user declined the conversion **for this layer**, for this reason: all three files sit on paths Layer 1.5 is already changing (the ledger's single write path, an orchestration hot path, and the provider this layer adds an image method to), and mixing a mechanical logging rewrite into the same diff would bury the attribution change the reviewers need to see. The files are flagged, not forgotten: each has its own open item with its risk note.

**Why D-7:** the first implementation pinned the request quality to `high` so the price could be looked up before the call. That changes what every generated image looks like and can cost up to about **4×** more per image — a behaviour change inside a layer whose only job is to track. D-7 keeps the images unchanged and still records a true cost, by pricing each image from what the provider says it did. Pricing a missing reported quality at `high` errs on the side of over-stating spend rather than hiding it.

---

## The parked charging decision

**Parked, and to be revisited.** Layer 1.5 makes AI image spend *visible*. It deliberately does not decide:

- whether an AI-generated image should consume a business's monthly credits (**OQ-7**, still open);
- how many credits one image is worth (**D-2**, parked).

**Why it can't be settled here:** credits are a token count (`ceil(tokens / tokens_per_pilot_credit)`), and an image has no tokens. Any answer needs a rule that converts a per-image price into credits, and that rule belongs with the wider question of what a credit represents.

**Where it is revisited:** together with **OI-1** ("credits remaining" drops from background work), **UD-1** (onboarding spend inside a new owner's first month) and **Q1** ("what should a credit represent?") in the deduction and enforcement layer. Until then:

- image rows carry a dollar cost and **zero tokens**, so they add **zero credits** everywhere credits are computed;
- no credit, allowance, gauge or `remaining` figure moves because of an image (FR-14). Call counts do rise, which nothing owner-facing renders (RC-1);
- nothing is blocked, throttled or billed because of an image beyond the existing daily image cap (FR-16);
- with images in their own area (RC-2), the per-month image cost is readable as one figure in the admin report, which is the evidence the charging decision needs.

---

## User Stories

- As a **platform operator**, I want a new owner's onboarding AI calls recorded against their account, so that onboarding spend is attributed like every other Business OS call.
- As a **platform operator**, I want every AI-generated image to appear in the usage ledger with its true cost, in its own area, so that image spend stops being invisible and can be read as one number.
- As a **platform operator**, I want the image model, its sizes, its quality and its price to be configurable, so that a price change or a model change doesn't need a code change.
- As a **platform admin**, I want the LLM Usage tab to cover onboarding and image calls, so that I can prove Layer 1.5 the same way I proved Layer 1.
- As a **developer**, I want one helper for "is this the platform account", so that four copies of the same rule can't drift apart.
- As a **platform operator**, I want the chat usage report to say when it truncated or failed, so that a quiet zero is never mistaken for "no usage".
- As a **business owner**, I want nothing about my bill, my credits or my generated images to change yet, because the charging decision hasn't been made.

---

## Scope

### In scope

- **(a) Onboarding conversation attribution** — FR-1 to FR-7.
- **(b) AI image generation tracking** — FR-8 to FR-16.
- **(c) One shared platform-account helper** — FR-17 to FR-19.
- **(d) Verification coverage** in the Layer 1.1 tab and report — FR-20 to FR-23.
- **(e) Folded-in follow-ups** F-1 and F-6 — FR-24, FR-25.
- **(f) Documentation** — FR-26.

### Out of scope

| Item | Why |
|---|---|
| Charging for images; credits per image | Parked (D-1, D-2); OQ-7 stays open |
| **OI-1** — "credits remaining" drops from background work, and **UD-1** — onboarding spend inside a new owner's first month | Decided with the deduction layer (D-4). AC-23 measures UD-1's real number (RC-18) |
| Deduction, enforcement or any change to what a business is charged | Later layer |
| Changing the quality (and therefore the look and cost) of generated images | Unchanged — quality stays `auto` (D-7); changing it later is a configuration change, not a code change |
| Per-call model configuration UI or JSON config, including the onboarding calls' `'gpt-4o'` literals | Layer 2 (F-9, RC-17) |
| Audit events for AI activity | Later layer |
| Dollar-cost accuracy for token models (price table loading, unpriced models) | Later layer |
| **`console.*` → Pino conversion** of `lib/analytics/aiAnalytics.ts` (16), `lib/orchestration/IntentClassifier.ts` (16) and `lib/ai/providers/openaiProvider.ts` (4). Only the lines the FRs need are changed in these files | **User decision D-6 (2026-09-18): keep the freeze.** Open items OI-4, OI-5, OI-6 |
| Deleting or re-wiring the unreachable `extractClientTracking` | KI-D, follow-up F-12 |
| `lib/services/AuditTrailService.ts:121` | A **different** rule (falls back to `null`, not to the all-zero UUID); converting it would change behaviour (RC-11) |
| The existing daily per-business image cap | Unchanged (FR-16) |
| Other Layer 1.1 follow-ups: **F-2** (database function for all-businesses totals), **F-3** (`DATA_ACCESSED` audit event), **F-4** (stale `new-api-route` skill) | Not folded in |
| SA follow-ups **F-7** (promote Check 3(c) to Fail), **F-10** (missing `usage.category.*` dictionary entries), **F-11** (32-bit image reuse hash) | Tracked, not this layer |
| Layer 1 known issues KI-1 to KI-6, OI-2, OI-3 | Separate items |
| The excluded broken calls (chat v2, chat v1, story, WebsiteAnalyzer, service generator) | Unchanged |

---

## Catalog Additions

Decided by SA (OQ-A approved as proposed; **OQ-B overridden** — images get their own area). The names are **stable** once shipped, because Layer 2 uses them as configuration keys.

| Part | Area → feature | Call names | Grouping id |
|---|---|---|---|
| Onboarding conversation | **new area `onboarding`** → `business-os-onboarding` | `business_story_extraction` (`OnboardingConversationManager.ts:950`), `client_workflow_extraction` (`:995`; can fire **twice** in one conversation, from `:608` and `:702`), `client_tracking_extraction` (`:1097` — **unreachable as of 2026-09-17**, KI-D / F-12), `adjustment_intent_extraction` (`:1397`; fires only if the owner asks for a change at the preview step) | One per onboarding conversation, minted in `getInitialState()` (FR-4) |
| AI image generation | **new area `images`** → `business-os-images` | `image_generation` | The owner request that asked for the image, minted at the route (FR-11) |

**All four onboarding call names are kept** (SA ruling on workplan Q-1): the dead extractor is then type-safe if it is ever re-wired, and the cost is one unused configuration key. The catalog entry for `client_tracking_extraction` carries an inline comment marking it **unreachable as of 2026-09-17** and pointing at F-12, so nobody reads its absence from the ledger as a defect.

**Why images get their own area (SA, OQ-B):**
1. The owner card never renders the breakdown, and a zero-token category is hidden from it anyway, so "Website" buys the owner nothing.
2. The only live consumer is the operator report, where `computeAreaTotals` is the one place image spend becomes a single figure — under `website` it would be mixed into text-generation spend and could only be separated by row-level filtering, which the tab caps.
3. Unit homogeneity: an area mixing per-token and per-image pricing makes any future per-area cost/token arithmetic wrong, and an image model is not a chat model (areas are Layer 2 configuration keys).

The link to the website request is preserved **in the grouping id**, not in the label (FR-11).

**Both new areas carry an EMPTY legacy-features list (FR-6, RC-3).**

---

## Functional Requirements

### (a) Onboarding conversation attribution

1. **FR-1 — Real account.** The four onboarding extraction methods (`lib/services/OnboardingConversationManager.ts:950`, `:995`, `:1097`, `:1397`) must be recorded under the **signed-in owner's account**, taken server-side from `getUser()` in `app/api/onboarding/chat/route.ts`. They must never be recorded on the platform account.
   - **All four methods are attributed; three can fire live.** `extractClientTracking` (`:1093`) is unreachable today — its step (`:803-806`) is retired — so it is attributed for type safety and proven by unit tests only ([KI-D](#known-issues-and-open-items)).
   - The account is already available: the route passes `user.id` into `processUserMessage` (`route.ts:210`). It is threaded to each extraction method; no attribution field is read from the request body.
   - SA verified these are the only LLM calls in the file: `getProviderFactory()` appears at `:947`, `:992`, `:1094`, `:1394` and nowhere else. `extractClientAcquisition` is deterministic parsing with no model.
2. **FR-2 — Catalog attribution.** Each call passes a context built by `buildBosCallContext` with the area and call name from the [catalog](#catalog-additions). No feature, area or call-name string is written at the call site.
3. **FR-3 — Required attribution on the public boundary (RC-6).** `processUserMessage` (`OnboardingConversationManager.ts:462`) takes a **required** attribution value — an owner type carrying the account and the grouping id, or a required `groupId` beside the existing `userId` — not an ad-hoc parameter on each private extractor. The private methods receive it from the turn.
   - There is exactly one caller (`route.ts:210`), so this is a small change that makes a missing account or grouping id a **compile error**, as Layer 1 FR-12 does elsewhere.
4. **FR-4 — Grouping id: one onboarding conversation (RC-5).** Every onboarding call type that fires in one business's onboarding conversation shares one grouping id.
   - **(a) Where it is minted:** in `OnboardingConversationManager.getInitialState()` (`:1979-1986`) with `newBosGroupId()`, and stored as a top-level field on `OnboardingState`. The state is persisted as `metadata.state_snapshot` on every row and restored on resume; `updateStateFromMessage` deep-copies with `{ ...state }` (`:527`), so the field survives a turn.
   - **(b) It must not be named `conversationId`, and must never be read from the request body.** `ChatRequestSchema` already accepts a client-supplied `conversationId` (`route.ts:67`) that the route ignores; the state field is named distinctly (e.g. `attributionGroupId`) so no future edit wires the body field into attribution.
   - **(c) Resumed pre-Layer-1.5 conversations are backfilled:** a snapshot written before this release has no id, so the manager mints one on restore, **before** the state is persisted with the user message. A resumed conversation is never recorded with a missing group.
   - **Restart = new group** comes for free: every restart path routes through `getInitialState` (route `:153`, `:169`, `:173`; manager `:522` unknown step, `:829` `intent === 'restart'`).
   - The grouping id rides inside the existing `state_snapshot` and **must not add a new direct `supabaseServer` write**; any write that becomes necessary goes through `OnboardingConversationRepository`.
5. **FR-5 — No behaviour change, and one carried known issue (RC-17).** Model, prompts, temperature, response parsing and the existing fallbacks on failure are unchanged. Onboarding still works when a call fails.
   - **Carried, not blessed:** the four methods pass `model: 'gpt-4o'` as a literal (`:951`, `:996`, `:1098`, `:1398`), against CLAUDE.md mandatory rule 5. Layer 1.5 deliberately does not change it, because attribution and model configuration are separate layers. It is recorded as [KI-C](#known-issues-and-open-items) and handed to Layer 2's per-area model configuration (F-9).
6. **FR-6 — Usage-card category, and an EMPTY legacy list (RC-3, RC-4).**
   - `USAGE_CATEGORIES` gains exactly one line per new area: `{ key: 'onboarding', features: bosCategoryFeatures('onboarding') }` and `{ key: 'images', features: bosCategoryFeatures('images') }`. The existing catalog test (`usageCategories.catalog.test.ts:19-36`) already fails when an area has no category keyed by its own name.
   - **Both new areas must have empty `BOS_LEGACY_FEATURES` entries, and the legacy `onboarding` value must never be added to them.** `BOS_LEGACY_FEATURES_FLAT` feeds `bosRowFilter()`, which drives Check 1's read, Check 2's platform-account read and `isBusinessOsFeature` (`llmUsageReport.ts:104-107`, `callCatalog.ts:104-111`). Adding it would pull every historical `onboarding` row into the Business OS filter, **fail Check 2** ("nothing on the platform account"), move the value out of `help` and break `usageCategories.catalog.test.ts:38`.
   - The legacy `onboarding` feature value **stays mapped to `help`**: the onboarding chat service and prompt-ideas flows still write it with real users.
   - No Business OS value may fall into `other`. The card renders no breakdown labels, so no UI text or translation change is needed (the missing dictionary entries are F-10).
7. **FR-7 — "Attributed" is not "charged" (D-3).** Onboarding calls now count toward the business's consumption figures in the same way every other Business OS call does. Layer 1.5 changes no deduction, allowance or block.
   - The user-visible consequence — a brand-new business opening its dashboard with part of its first month already used — is recorded as **UD-1** and measured by AC-23 (RC-18), so it can be decided on a real number with the deduction layer.

### (b) AI image generation tracking

8. **FR-8 — Images go through the provider layer, in this shape (RC-7, D-7).** `lib/services/GeneratedImageService.ts` must no longer construct an OpenAI client itself (`:186-192`).
   - **Provider method:** an image method on `OpenAIProvider`, taking the request (`model`, `prompt`, `size`, `quality`, `n`), the tracking context, and the **pricing supplied by the service**, wrapped in the existing `callWithTracking` (`baseProvider.ts:70-145`) with `extractMetrics` returning `inputTokens: 0, outputTokens: 0` and the cost.
   - **The cost is computed after the call (D-7):** because the price depends on the quality the provider **reports** it used, the service supplies its price resolution in a form the provider can apply to the response (for example, a function of the reported quality). The exact shape is a Dev / SA detail; the requirement is that the cost written to the ledger is resolved from the response, not from the request.
   - **Request type:** `CallContext` gains an optional `requestType?: string`, and `callWithTracking` uses `context.requestType ?? 'chat'` where `'chat'` is hardcoded today (`baseProvider.ts:103`, `:133`). The image call passes an image request type.
   - **The tracker needs no change:** `aiAnalytics.ts:151` already does `request_type: callData.request_type || 'chat'`, and `openaiProvider.ts:239` already writes a non-chat value. `request_type` is free text used only as an admin BI breakdown dimension (`admin/token-usage/drill-down/route.ts:499`); nothing in Business OS filters on it. **AC-14 stays intact.**
   - **No pricing policy in `lib/ai/**`:** the price table, its precedence and the missing-quality rule live in the service (FR-13); the provider only applies what it is given to the response.
   - `BosCallContextExtras` already permits `requestType` as an extra, so the catalog needs no change for it.
   - Adding the method touches `openaiProvider.ts`, which has 4 `console.*` calls; per **D-6** they are **not** converted in this layer (OI-6).
9. **FR-9 — One ledger row per generated image, and the edge cases (RC-2, RC-9).** Every image that is actually generated writes one `token_usage` row with the business account, the **`images` area and `image_generation` call name**, the grouping id (FR-11), **zero input and output tokens**, the estimated dollar cost (FR-13), the model, and success or failure.
   - **(a) No row at all** for anything refused before the provider call: no provider available, a `PEOPLE` match, a reuse-cache hit, the daily cap reached, or an unreadable daily count (`:129-183`).
   - **(b) A thrown provider call** writes the standard failure row from `callWithTracking`'s catch branch (`baseProvider.ts:113-140`): `success: false`, zero tokens, `cost_usd: 0`. It re-throws, and the service's existing `try/catch` absorbs it and still returns `{ ok: false, reason: 'failed' }`.
   - **(c) A 200 response with no image data** (`:194-198`) **was billed**: the row is written **with its cost** (priced per FR-13, from the reported quality or the `high` fallback), and the service still returns `{ ok: false, reason: 'failed' }`.
   - **(d) A storage-upload or `userMediaRepository.record` failure** happens after generation, so the row **stays** — the image was paid for.
   - **(e) The graceful `unavailable` path is kept** by asking `ProviderFactory.isProviderAvailable('openai')` (`providerFactory.ts:217-221`) instead of reading the API key in order to construct a client.
10. **FR-10 — No hardcoded model; one configuration read; quality stays `auto` (RC-8, OQ-E, BA-2 / M-2, D-7).** The image model (today the literal `'gpt-image-1'`, `:188`), its size options, its request quality **and its per-image prices** live together in `system_settings_config` and are read through `SystemConfigRepository` in **one** round trip: a new `getImageGenerationConfig()` built on the existing **`getByKeys(keys)`** (`SystemConfigRepository.ts:79-98`), a single `.in('key', keys)` select.
    - *Correction (BA-2 / M-2):* `getAgentCreationConfig()` (`:335-347`) is **not** the model to copy — it is `Promise.all` over two `getByKey` calls, i.e. two round trips. The binding requirement is "one read"; `getByKeys` is the one-read primitive.
    - The method logs key names and counts only, never configuration **values**.
    - `ais_system_config` holds platform economics (`tokens_per_pilot_credit`, `pilot_credit_cost_usd`, `monthly_ai_allowance_usd`), not model prices, so splitting the price there would mean two tables, two repositories and two round trips for one call.
    - Documented: the price key moves if a real per-image price table arrives with the deduction layer.
    - **Quality is a setting, and its default is `auto` (D-7).** The request quality comes from `image_generation_quality`, whose documented default is **`auto`** — the provider's current behaviour, so images look and cost exactly as they do today. It is **not** pinned to a fixed value such as `high`: that would change every generated image and could cost up to about 4× more, a behaviour change inside a tracking-only layer. Changing the quality later is a configuration change, not a deploy.
    - *Superseded (CR-1 / D-7):* the earlier wording "**`quality` is pinned** … so a provider-side default change would silently invalidate the price" is withdrawn. The price is protected from a provider-side default change a different way: it is resolved from the quality the provider **reports** it used (FR-13), not from the quality that was requested.
11. **FR-11 — Grouping id, minted at the one entry point (RC-10).** `generateImage` has exactly one caller, `app/api/website/media/generate/route.ts:41`, and always requests `n: 1`.
    - That route mints the grouping id with `newBosGroupId()`, logs it with the request's correlation id, and passes a **required** owner (account + grouping id) into the service.
    - The image row therefore carries the group of the owner request that asked for it — which is how an image stays tied to the website work that triggered it, even though it is recorded in its own area.
    - No multi-image or website-build path exists today; if one is added later it reuses its own entry point's id.
12. **FR-12 — Account source.** The account is the `userId` the service already receives (`:129`), resolved server-side by its caller (`media/generate/route.ts:35-45`). No attribution field comes from a request body, query string or header.
13. **FR-13 — Per-image pricing, resolved after the call from the reported quality (RC-8, D-7).** The dollar cost of an image never comes from the token price table (`ai_model_pricing` and `lib/ai/pricing.ts` are strictly per token, OQ-F).
    - **The price key is model + size + the quality the provider reports it actually used**, read from the response once the image has been generated — **not** the quality that was requested. With the request quality at `auto`, the provider chooses the quality, and the ledger must record what it actually charged for.
    - **If the response reports no quality**, the image is priced **as `high`** and a **warning** is logged naming the model and size. Pricing at the most expensive tier over-states spend rather than hiding it.
    - **Precedence, in this order**, for that model + size + reported quality:
      1. the configured price (FR-10);
      2. a **documented in-code fallback map**, the codebase's own pattern for this case (`FALLBACK_PRICING` in `lib/ai/pricing.ts`, `DEFAULT_TOKENS_PER_CREDIT = 10`, `creditCostUsd ?? 0.00048`). A documented default that configuration overrides is not a "hardcoded price"; an unoverridable literal would be. The fallback map must cover every quality the provider can report for each configured model and size;
      3. **0, with an error-level log naming the model, size and quality.**
    - The row is always written, whatever the price resolution (Layer 1 FR-3's rule: spend is never dropped). An image must never silently record $0 because nobody seeded a configuration row.
14. **FR-14 — How a zero-token, non-zero-cost row behaves everywhere it is read (RC-1, corrected).** Verified by SA against the merged code.
    - **Unchanged:** every credit figure (`round(0 / tokensPerCredit)` = 0), the allowance, the card's ring and `remaining`, the daily series, and every per-category credit figure. No credit or allowance logic changes.
    - **Unchanged:** the card's **breakdown**, which hides a category with no tokens (`buildCardBreakdown`'s `.filter(([, v]) => v.tokens > 0)`), and whose `share` is already guarded against a zero total.
    - **Changes, by design:** the usage API's **call counts rise**. `route.ts:236` returns `calls: usage.totalCalls`, and both `business_os_usage_summary` (`COUNT(*)`) and the row fallback count every row regardless of tokens; a category line that already has tokens also shows one more call. This is the **pinned behaviour for zero-token rows today** (`app/api/business-os/usage/__tests__/route.test.ts:75`, `:160`, `:162`) and **`UsageCard.tsx` renders neither calls nor the breakdown**, so nothing owner-facing moves. Do not claim the response is byte-identical.
    - **`summariseUsageByCategory`:** adds one call and zero tokens to the `images` category.
    - **Chat daily limit (`ChatBudget`):** unaffected — it filters on the chat feature value only (`ChatBudget.ts:162`).
    - **Admin LLM Usage report:** image rows appear in Check 1, are grouped in Check 4, and are counted in the **`images`** area total with their cost (FR-20 to FR-22). Check 5 renders `no (no tokens)`, which is already legible.
    - **Anything that divides by tokens** must not treat a zero-token row as a division by zero or as "no data".
    - **Precedent:** zero-token ledger rows already exist and are exercised — the chat cache-hit row (`turnUsage.ts:97-113`) and the fixture `business-os-leads` row with `tokens: 0, calls: 1`.
15. **FR-15 — Failure must not lose spend.** A failure to record usage never fails the owner's image request, and a recorded image is never silently dropped. `trackAICall` never throws (`aiAnalytics.ts:233-241`), and the service's existing "never throws" contract is preserved.
16. **FR-16 — The daily image cap is unchanged.** The existing per-business daily generation limit (`GeneratedImageService.ts:170-183`), including its fail-closed behaviour when the count can't be read, stays exactly as it is. Layer 1.5 adds no second limit.

### (c) Shared platform-account helper

17. **FR-17 — One helper, at `lib/platformAccount.ts` (RC-11, OQ-G).** One exported helper returns the platform account id (`SYSTEM_ADMIN_USER_ID`, or the all-zero UUID when unset), read at call time. It is the only place that rule is written.
    - **It imports nothing**, and the catalog imports it — never the reverse. `scripts/typecheck-bos-llm.ts:30-53` puts every catalog-importer **and every file that imports one** in the gate's scope, so a helper that lived in (or imported) the catalog would drag `aiAnalytics.ts`, `EmbeddingService.ts`, `IntentClassifier.ts` and all their importers into the gate.
    - It sits at `lib/` root beside `lib/logger.ts` and `lib/auth.ts`: it is an identity rule, not an AI or Business OS rule. No cycle is possible because it has no imports.
18. **FR-18 — Replace the copies.** These four copies are replaced by the helper, with **no behaviour change**, and **only those lines** change in each file (D-6):
    - `lib/analytics/aiAnalytics.ts:121` (the tracker's fallback — **this one line only**; the tracker is otherwise untouched, Layer 1 FR-3; its 16 `console.*` calls are **not** converted, OI-4);
    - `lib/services/EmbeddingService.ts:46`;
    - `lib/orchestration/IntentClassifier.ts:179` and `:698` (its 16 `console.*` calls are **not** converted, OI-5).
    - **Explicit non-target:** `lib/services/AuditTrailService.ts:121` looks similar but is a **different rule** — `SYSTEM_ADMIN_USER_ID` falling back to `null`, not to the all-zero UUID. Converting it would change behaviour; it is out of scope.
19. **FR-19 — The catalog reuses it.** `isPlatformAccount` and `platformAccountIds` in `lib/business-os/llm/callCatalog.ts` are built on the same helper, keeping their current behaviour exactly: case-insensitive comparison, the all-zero UUID always included, and a non-UUID environment value excluded from the id list and reported by `isPlatformAccountEnvIgnored`.

### (d) Verification coverage

20. **FR-20 — What a new area costs, and what it must not cost (RC-4).** Adding an area requires **exactly one** manual edit: a `{ key: area, features: bosCategoryFeatures(area) }` line in `USAGE_CATEGORIES` — a hand-ordered list that also carries non-Business-OS features — and that edit is already enforced by `usageCategories.catalog.test.ts:19-36`.
    - **Everything else must follow from the catalog with no edit:** Check 1 (classification), Check 4 (grouping), the area totals (`llmUsageVerification.ts:550-580`) and Check 5's "nothing in `other`" rule (`:161-169`, `usageCategories.ts:34-36`).
    - Any *other* place that still needs a manual edit is a defect to fix in Layer 1.5.
21. **FR-21 — Zero-token rows read correctly, with no new UI machinery (RC-20).** No new formatter and no new column: `formatNumber(0)` renders `0`, `formatCostUsd` renders `$0.0400 (estimated)`, and Check 5 already prints `no (no tokens)` (`CheckPanels.tsx:309`). With the dedicated `images` line in the area totals, an operator reads `images · N calls · 0 tokens · $X` without ambiguity.
    - The only addition is **one explanatory note in the tab**: zero tokens is expected for image rows, and their cost is per image.
22. **FR-22 — The legacy helper-label check goes quiet, and why that is now provable (RC-19).** After FR-1, the onboarding extractors are verifiably the **last live context-less callers** of `getProviderFactory().complete()`.
    - Every other live caller passes a context (`IntakeGenerationService.ts:267-272`, `app/api/intake/form/infer-question/route.ts:160-165`, `WebsiteGenerationService.ts:567-572`, and the rest).
    - The three that *look* context-less — `app/api/business-os/story/route.ts:180-188`, `ServiceGeneratorService.ts:304`, `WebsiteAnalyzer.ts:123` — call `.complete()` on a `BaseAIProvider` instance, which has no such method, so they throw before any call (Layer 1's excluded broken calls).
    - `app/api/onboarding/generate-prompt-ideas/route.ts:128-135` writes `feature: 'onboarding'` with component `generate-prompt-ideas` and a real user id, so it never trips Check 3, which matches the label **pair**.
    - Layer 1.1 Check 3(c) therefore keeps reporting the legacy helper label as **Info**, with its text updated: no live caller should write this any more, so any row is worth investigating. `BOS_LEGACY_HELPER_LABEL` stays in the catalog as the helper's no-context default and as the value the check looks for. Promotion to **Fail** is follow-up **F-7**, after an observation period (OQ-H).
23. **FR-23 — Layer 1 AC-19's exclusion is unchanged.** The legacy `onboarding` feature value stays excluded from the "nothing on the platform account" query: the onboarding chat service and prompt-ideas flows still write it, with real users. `business-os-onboarding` and `business-os-images` are included automatically as Business OS values — which is exactly why FR-6's empty legacy lists matter.

### (e) Folded-in follow-ups

24. **FR-24 — F-1: the chat usage report must not lie (RC-12, RC-13).** In `lib/business-os/bizql/telemetry/usageReport.ts`:
    - **How the states are surfaced (RC-13, decided):** `getChatUsage` returns a **result union** — `{ ok: true; report } | { ok: false; error }` — and the report itself carries `truncated` and the `cap` that was applied. A failed read is `ok: false`; a truncated read is `ok: true` with `truncated: true`. `/api/admin/chat-usage` must **not** answer `200 { success: true }` with a zeroed report on a failed read, and must pass the truncation state to the caller; `scripts/chat-usage-report.ts` prints both states. `getChatPricing` follows the same pattern for its 50,000-row cap.
    - **Repository (RC-12):** its `token_usage` reads move onto `TokenUsageRepository`, so no direct Supabase call remains in the module, with four conditions:
      - **(a)** the cross-account read is **one explicitly named method** (e.g. `listChatCallsAllAccountsInWindow`), documented with its single admin-gated caller (`app/api/admin/chat-usage/route.ts`, `AdminAccessService` at `:44-47`). Existing per-account guards stay, and a contract test asserts **no existing method gained an optional account filter**;
      - **(b)** the repository still must **not** import the catalog (Layer 1.1 RC-7) — `BOS_CHAT_FEATURE` is passed in as data;
      - **(c)** the extra columns (`user_id`, `activity_type`, `activity_name`, `model_name`, `latency_ms`) go into a **new named entry** in `TOKEN_USAGE_COLUMNS`; payloads, metadata and `error_message` stay excluded;
      - **(d)** today's caps (10,000 / 50,000) exceed `TOKEN_USAGE_READ_LIMITS.MAX_CEILING` (5,000): **keep them as they are, do not silently raise them**, give the method its own documented limit constants, and return `reachedCeiling` exactly as `listCallsInWindow` does.
25. **FR-25 — F-6: allowance config through the repository (RC-14).** `readAllowanceCredits` in `app/api/business-os/usage/route.ts` no longer reads `ais_system_config` directly.
    - **(a)** "One round trip" needs a **new** `ConfigRepository` method: `getSystemConfig` reads a single key with `.single()` (`ConfigRepository.ts:25-38`), so add e.g. `getSystemConfigs(keys: string[])` using `.in('config_key', keys)`.
    - **(b)** `ConfigRepository` **defaults to the browser Supabase client** (`:5`, `:18`), so the route must construct it with `supabaseServer` — exactly as `readTokensPerCredit` documents in `usageSummary.ts` ("calling it from a route throws a 500 — which is exactly what happened").
    - Behaviour is unchanged: both keys (`monthly_ai_allowance_usd`, `pilot_credit_cost_usd`), the documented fallbacks, and `null` when no ceiling applies.

### (f) Documentation

26. **FR-26 — Docs updated.**
    - `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`: the LLM Usage section covers the new `onboarding` and `images` areas, the image call, how a zero-token row reads, and the note from FR-21.
    - The Layer 1 requirement's roadmap and the investigation doc show Layer 1.5's four parts, the `images` area decision, and what is parked (the charging decision, OI-1, UD-1).
    - Each carries a Change History row.

---

## Non-Functional Requirements

- **Security and tenancy:**
  - Every account is server-side: onboarding from `getUser()` (`route.ts:79`, `:210`), images from the `userId` the route already resolved (`media/generate/route.ts:35-45`). No attribution field is read from a body, query string or header — subject to FR-4(b), which keeps the client-supplied `conversationId` out of attribution.
  - No new route, no new `supabaseServer` write, no RLS bypass and no caller-supplied-id write path, so the `tenant-isolation-guard` pattern is not triggered.
  - Image prompts are never written to the ledger (Layer 1.1 FR-20: no prompts, payloads or metadata).
- **Repository pattern:** all new reads go through `lib/repositories/` — `SystemConfigRepository` (FR-10), `ConfigRepository` (FR-25), `TokenUsageRepository` (FR-24). The ledger write continues through the existing tracker, the single write path. The onboarding route's pre-existing direct `supabaseServer` calls on `onboarding_conversations` are out of scope, and **the grouping id must not add a new one** (FR-4).
- **Configuration, not code:** the image model, its sizes, its request quality (default `auto`, D-7) and its per-image prices are configuration values read at call time, with a documented in-code fallback (FR-13) and no unoverridable literal (CLAUDE.md mandatory rule 5). The onboarding calls' `'gpt-4o'` literals are a carried known issue (KI-C, F-9).
- **No behaviour change to images (D-7):** the images a business receives — their quality, look and platform cost — are unchanged by Layer 1.5. Only their recording is new.
- **Logging:**
  - Pino everywhere in new code, with `correlationId` on request paths. New error and warning paths (price resolution falling through to 0, a response with no reported quality priced as `high`, a failed or truncated chat usage read) log at error or warn level with enough context to act on, and never include prompts.
  - **Three touched files still log through `console.*`, flagged as CLAUDE.md § Logging requires (BA-2 / M-4):**

    | File | `console.*` calls | Why Layer 1.5 touches it | Open item |
    |---|---|---|---|
    | `lib/analytics/aiAnalytics.ts` | **16**, at `:97, :101, :129, :137, :186, :208, :209, :216, :217, :218, :235, :236, :246, :297, :323, :372` (corrected, M-3) | FR-18, line `:121` only | OI-4 (F-8) |
    | `lib/orchestration/IntentClassifier.ts` | **16** | FR-18, lines `:179` and `:698` | OI-5 |
    | `lib/ai/providers/openaiProvider.ts` | **4** | FR-8, the new image method | OI-6 |

    `lib/services/EmbeddingService.ts` and `lib/ai/providerFactory.ts` are clean (SA verified).
  - **User decision D-6 (2026-09-18): keep the freeze.** Layer 1.5 converts none of the three; only the lines the FRs need are changed. This is a **deliberate, user-approved exception** to CLAUDE.md's "convert touched files" rule, for the reason given under [D-6](#user-decisions). The conversions are OI-4 to OI-6.
- **Type safety and CI:** new files that import the catalog fall under `npm run typecheck:bos-llm`; the Dev records the scope delta, as in Layer 1.1. `TokenUsageRepository` must still not import the catalog. Baseline handling is AC-21 (RC-15).
- **Performance:** attribution adds no extra LLM call. Image generation adds one configuration read plus the existing ledger write. The chat usage report's reads must not be slower than today's single capped read for typical windows.
- **Backward compatibility:** **no migration** (OQ-F confirmed). Historical rows keep their labels; nothing is backfilled, except the in-flight onboarding snapshots of FR-4(c), which gain a grouping id on resume.
- **Testability:** every new rule is unit-testable without a live provider: the attribution context, image price resolution from the reported quality and its precedence, the missing-quality `high` fallback, the zero-token behaviour, the image edge cases (FR-9), and the chat report's truncation and failure states.

---

## Acceptance Criteria

**(a) Onboarding conversation (unit and integration tests, provider mocked):**

- [ ] **AC-1** (FR-1, FR-2) — Each of the four onboarding extraction methods — **including the unreachable `extractClientTracking`, exercised directly in a unit test** (KI-D) — passes a context carrying the signed-in owner's account id, `business-os-onboarding` and its catalog call name. None passes the platform account, `'system'` or the legacy helper label.
- [ ] **AC-2** (FR-3) — The attribution is required by type on `processUserMessage`: a call site that omits the account or grouping id fails type checking (compile-time test or `@ts-expect-error`).
- [ ] **AC-3** (FR-4) — **Every onboarding call type that fires in the session, each on the owner's account and sharing one group** (BA-1): calls within one onboarding conversation share one grouping id — including `client_workflow_extraction` fired twice in one conversation; a conversation that is cleared or restarted produces a different one; a conversation resumed from a pre-Layer-1.5 snapshot is backfilled before its first recorded call, so no call is recorded without a group. Every grouping id is a valid UUID, and none is ever taken from the request body's `conversationId`. The unreachable `client_tracking_extraction` is covered by unit test only (AC-1).
- [ ] **AC-4** (FR-5) — Existing onboarding behaviour is unchanged: same model and prompts, same parsed result, and the same fallback when a call fails (existing tests pass; new tests cover the fallback path).
- [ ] **AC-5** (FR-6) — The category mapping sends `business-os-onboarding` and `business-os-images` to their own categories, keeps the legacy `onboarding` under `help`, and puts no Business OS value in `other`. **`BOS_LEGACY_FEATURES` for both new areas is empty**, and a test asserts that `bosRowFilter()` / `isBusinessOsFeature` do not match the legacy `onboarding` value. The existing `usageCategories` tests pass, including `usageCategories.catalog.test.ts:38`.

**(b) AI image generation (unit and integration tests, provider mocked):**

- [ ] **AC-6** (FR-8, FR-9) — A successful generation writes exactly one ledger row with: the business account, `business-os-images` / `image_generation`, the grouping id, zero input and output tokens, the configured model, an image request type, and a dollar cost. `GeneratedImageService` constructs no OpenAI client of its own, and `lib/ai/**` contains no image pricing policy.
- [ ] **AC-7** (FR-9) — Row-writing edges: **no row** for an unavailable provider, a refused prompt, a reuse-cache hit, the cap reached, or an unreadable count; a **failure row** (zero tokens, zero cost, `success: false`) when the provider call throws, with the service still returning `{ ok: false, reason: 'failed' }`; a **priced row** when the provider returns 200 with no image data; and the row **stays** when the storage upload or the media record fails afterwards.
- [ ] **AC-8** (FR-10, FR-13, D-7) — Quality and pricing:
  - the request sends the configured `image_generation_quality`, whose default is **`auto`**; no code path pins it to `high` or any other fixed value;
  - the cost is resolved **after** the call from **model + size + the quality the response reports**: with a mocked response reporting `low`, `medium` and `high`, the row's cost is the matching price for each;
  - with a mocked response that reports **no** quality, the row is priced **as `high`** and a **warning** is logged naming the model and size;
  - precedence for the resolved key is configuration → documented in-code fallback → 0 with an error-level log naming model, size and quality;
  - the model, sizes, quality and prices come from **one** `getImageGenerationConfig()` read built on `getByKeys`, which logs no configuration values;
  - no image model name or unoverridable price literal remains in the service.
- [ ] **AC-9** (FR-11, FR-12) — The grouping id minted by `app/api/website/media/generate/route.ts` reaches the ledger row, and a second request gets a different one. The account is the one the route resolved, never taken from a request body. The provider is asked for `n: 1`.
- [ ] **AC-10** (FR-14) — With a zero-token, non-zero-cost row in the data:
  - every credit figure, the allowance, the ring, `remaining`, the daily series and every per-category credit figure are **unchanged**;
  - the card's **breakdown is unchanged** (the tokenless category stays hidden), and nothing divides by zero;
  - the response's **call counts increase** — `totalCalls`, and the category line's `calls` where that category already has tokens — matching the pinned zero-token behaviour in `app/api/business-os/usage/__tests__/route.test.ts`;
  - `UsageCard.tsx` renders neither of the figures that changed;
  - `summariseUsageByCategory` adds one call and zero tokens to `images`;
  - the chat daily limit is unaffected.
- [ ] **AC-11** (FR-15, FR-16) — A ledger write failure doesn't fail the image request, and the image is still returned. The daily cap behaviour, including refusing when the count can't be read, is unchanged (existing tests pass).

**(c) Shared platform-account helper:**

- [ ] **AC-12** (FR-17, FR-18) — `lib/platformAccount.ts` exists, imports nothing, and a code review finds no remaining copy of the `SYSTEM_ADMIN_USER_ID || '00000000-…'` expression in the four named files. `AuditTrailService.ts:121` is **not** changed. A unit test covers: environment set to a UUID, unset, and set to a non-UUID.
- [ ] **AC-13** (FR-19) — `isPlatformAccount`, `platformAccountIds` and `isPlatformAccountEnvIgnored` behave exactly as before, including case-insensitivity and the non-UUID environment case (existing Layer 1.1 tests pass unchanged). The catalog imports the helper and the helper imports nothing, so `npm run typecheck:bos-llm`'s file scope does not grow through it.
- [ ] **AC-14** (FR-18, D-6) — **Freeze version (user decision 2026-09-18):** apart from line `:121`, `lib/analytics/aiAnalytics.ts` is **unchanged** in the diff — no `console.*` conversion, no reformat. Likewise `lib/orchestration/IntentClassifier.ts` changes only at `:179` and `:698`, and `lib/ai/providers/openaiProvider.ts` changes only by the added image method; neither file's existing `console.*` calls are converted.

**(d) Verification coverage:**

- [ ] **AC-15** (FR-20) — With onboarding and image rows in the data, Check 1 classifies them (correct area, known call name, no false flags), Check 4 groups them — including one conversation recording `client_workflow_extraction` twice, rendered as `client_workflow_extraction ×2` — the area totals include a separate `images` line, and Check 5 keeps them out of `other` — with **no change to the check logic** and exactly one `USAGE_CATEGORIES` line per new area. A test adds a catalog entry and shows every check picks it up.
- [ ] **AC-16** (FR-21) — An image row is displayed with `0` tokens and its cost; the `images` area total shows calls, `0` tokens and its cost; Check 5 shows `no (no tokens)`; and the explanatory note is present. No new formatter or column was added.
- [ ] **AC-17** (FR-22, FR-23) — Check 3(c) still reports the legacy helper label as Info, with the updated text, and a row carrying it is still detected. A `generate-prompt-ideas` row (feature `onboarding`, different component, real user) does **not** trip it. The legacy `onboarding` value remains excluded from the platform-account query, while `business-os-onboarding` and `business-os-images` are included.

**(e) Folded-in follow-ups:**

- [ ] **AC-18** (FR-24) — `getChatUsage`:
  - returns `ok: false` with an error on a failed read, and never an all-zero report;
  - returns `ok: true` with `truncated` and the applied `cap` when more rows exist than the cap;
  - reads through `TokenUsageRepository`, with no direct Supabase call left in the module, using one explicitly named all-accounts method; a contract test asserts no existing repository method gained an optional account filter, the repository still doesn't import the catalog, the new column set excludes payloads, metadata and `error_message`, and the caps are unchanged with `reachedCeiling` returned;
  - `/api/admin/chat-usage` never answers `200 { success: true }` with a zeroed report, and surfaces truncation; the script prints both states. `getChatPricing` behaves the same way.
- [ ] **AC-19** (FR-25) — `readAllowanceCredits` reads both keys through a new multi-key `ConfigRepository` method built with `supabaseServer`, with the route's response unchanged for: both keys present, keys missing (documented fallbacks), and a zero or invalid value (no ceiling). No direct `ais_system_config` read remains in the route, and the route's characterization test and snapshot (`app/api/business-os/usage/__tests__/route.test.ts:234-255`) still pass with the fake adapted to the repository call.

**(f) Code review and documentation:**

- [ ] **AC-20** (NFR Repository, NFR Config, NFR Logging) — Code review finds: no new direct Supabase call outside `lib/repositories/` (including none added to the onboarding route); no hardcoded image model, size, pinned quality or unoverridable price; no prompt text in the ledger or the logs; no **new** `console.*` introduced anywhere. The pre-existing `console.*` calls in `aiAnalytics.ts`, `IntentClassifier.ts` and `openaiProvider.ts` are left as they are by user decision D-6 (OI-4 to OI-6), and that is not a finding.
- [ ] **AC-21** (NFR Type safety, RC-15) — `npm run typecheck:bos-llm` passes with **no new diagnostic**. Baseline **additions** are permitted only for errors proven pre-existing on lines this work did not touch, each itemised in the workplan with its file and error code (the gate's own rule, `scripts/typecheck-bos-llm.ts:56-62`), and never to silence a new error. The Dev records the scope delta.
- [ ] **AC-22** (FR-26) — The test page scope doc covers both new areas, the image call, how a zero-token row reads and the FR-21 note. The Layer 1 requirement and the investigation doc show Layer 1.5's four parts, the `images` area and what is parked. Each has a Change History row.

**End-to-end QA run (non-production environment only, as in Layer 1.1 AC-21):**

- [ ] **AC-23** (all parts, RC-18, BA-1, D-7) — With the LLM Usage tab open on the test business and "Start now" clicked:
  - a new owner runs an onboarding conversation → **every onboarding call type that fires in the session appears under the `onboarding` area, each on that owner's account and sharing one group.** Expect **three** call types at most, not four: `business_story_extraction`, `client_workflow_extraction` (once or twice), and `adjustment_intent_extraction` only if the owner asks for a change at the preview step. **`client_tracking_extraction` will not appear** — it is unreachable (KI-D), and its absence is not a defect;
  - **the owner's usage card figures are recorded before and after that conversation, and the credits it consumed are written into the workplan and into UD-1** — this is the real number the parked allowance question needs;
  - an image is generated from the website editor, with the quality setting at its default `auto` → one row appears under the **`images`** area with `image_generation`, zero tokens and a dollar cost, carrying the request's group. **The quality the provider reported is recorded in the workplan next to the cost**, and the cost matches the price for that model + size + reported quality;
  - a second identical image request (served from the reuse cache) adds **no** row;
  - **one deliberately failing image generation** — induced at the provider, by temporarily configuring a non-existent image model — produces a failure row with zero tokens, `$0.0000`, `Success: no`, and the correct area, call name and group;
  - Check 2 stays Pass (nothing on the platform account), and Check 3(c) shows zero legacy helper-label rows for the window;
  - the area totals show separate `onboarding` and `images` lines, with the image cost on the `images` line.
- [ ] **AC-24** (D-1, D-3, FR-14) — In that run, no credit balance, allowance, gauge or block changes as a result of the **image** rows; the owner's credits move only by the onboarding tokens (AC-23's measurement), and nothing is billed or blocked.

---

## Out of Scope / Future Roadmap

See the [Scope](#out-of-scope) table above. In summary:

| Item | Where it goes |
|---|---|
| Charging for images, credits per image | Parked; OQ-7, with OI-1, UD-1 and Q1, in the deduction layer |
| "Credits remaining" treatment of background work (OI-1) and onboarding spend in a new owner's first month (UD-1) | Deduction layer (D-4); AC-23 measures UD-1 |
| Owner-facing visibility of image spend | With the charging decision (UD-2) |
| Changing the quality of generated images | A configuration change (`image_generation_quality`), when and if the user wants it (D-7) |
| Per-call model configuration (JSON per area), including the onboarding `'gpt-4o'` literals | Layer 2 (F-9) |
| `console.*` → Pino in `aiAnalytics.ts`, `IntentClassifier.ts`, `openaiProvider.ts` | Open items **OI-4, OI-5, OI-6** (D-6) |
| Delete or re-wire the unreachable `extractClientTracking` | F-12 (KI-D) |
| Promote Check 3(c) to Fail | F-7, after an observation period |
| Missing `usage.category.*` dictionary entries | F-10, when the card renders the breakdown |
| The 32-bit image reuse hash | F-11 |
| F-2 (database function for an all-businesses view), F-3 (`DATA_ACCESSED` audit event), F-4 (stale skill) | Tracked follow-ups |
| Layer 1 known issues (KI-1 to KI-6), OI-2, OI-3 | Separate items |

---

## Known Issues and Open Items

| Id | Description | Status |
|---|---|---|
| **OQ-7** | Should AI-generated images count against a business's monthly credits, and how many credits is one image worth? | **Open and parked** (D-1, D-2). Revisit with OI-1, UD-1 and Q1 in the deduction layer |
| **OI-1** | "Credits remaining" drops from background work | Open; out of scope here (D-4) |
| **OI-4** | **`lib/analytics/aiAnalytics.ts` — 16 `console.*` calls to convert to Pino** (`:97, :101, :129, :137, :186, :208, :209, :216, :217, :218, :235, :236, :246, :297, :323, :372`). **SA risk: highest** — every ledger row in the product passes through `trackAICall`, and its `console.*` calls sit inside the insert's success and failure branches. **How:** a separate, purely mechanical commit, with the insert payload, the UUID validation and the platform-account fallback untouched. (Formerly F-8.) | **Resolved 2026-09-18: code complete**, pending SA code review, QA and commit. See the [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md), steps 4a–4c: a characterization snapshot first, then a mechanical conversion (16 → 12 Pino calls), then the failure log narrowed to `code` / `message` / `hint` so a failing row is never logged |
| **OI-5** | **`lib/orchestration/IntentClassifier.ts` — 16 `console.*` calls to convert to Pino.** **SA risk: medium** — an orchestration hot path with no Layer 1.5 test coverage, so a mechanical conversion would be unverified by anything this layer runs. Standalone commit | **Resolved 2026-09-18: code complete**, pending SA code review, QA and commit. See the [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md), step 3 |
| **OI-6** | **`lib/ai/providers/openaiProvider.ts` — 4 `console.*` calls to convert to Pino.** **SA risk: low** — all four sit in `getInstance`'s configuration guards, outside the image path, so a conversion cannot affect a tracked call. *(Corrected 2026-09-18: `:114` and `:119` are in `getInstance`; `:403` and `:435` are thread-helper error branches. The risk is still low.)* Standalone commit | **Resolved 2026-09-18: code complete**, pending SA code review, QA and commit. See the [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md), step 1 |
| **OI-7** | **Onboarding logs what the owner types (privacy).** `lib/services/OnboardingConversationManager.ts` writes the owner's raw chat message into server logs: `:511` (debug, "Processing user message"), `:602` (info), `:704` (warn), `:1124` (info), `:1425` (info), `:1430` (warn). This predates Layer 1.5 (Layer 1.5 only added `groupId` to the `:511` line). Fix: log the step, lengths or extracted fields, never the raw text. Found by QA (O-2), user decision 2026-09-18 | **Resolved 2026-09-18: code complete**, pending SA code review, QA and commit. See the [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md), step 2. Also fixed: `:595` (the business name is the raw message) and `app/api/onboarding/chat/route.ts:208` (raw text at **info** on every turn). Raw text is now logged at no level; lengths are logged instead |
| **OI-8** | **Onboarding logs text derived from what the owner types.** The model's extractions (business story, client workflow, adjustment details) were logged at **info**, and `OnboardingChatService.ts:179` logged the whole model response at **error** on a parse failure. **User decision D-OI8 (2026-09-18):** keep it, but at `debug` only. Production runs at `info` (`lib/logger.ts:16`), so these lines show locally and never in production | **Resolved 2026-09-18: code complete**, pending SA code review, QA and commit. See the [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md), step 2 (with OI-7) |
| **OI-9** | **Log redaction is never switched on.** `@/lib/logger` resolves to `lib/logger.ts`, which has no `redact` list; the list in `lib/logger/config.ts` is applied by no server logger. The fix changes every log line in the product and needs its own workplan. **Carries D-OI8's assumption:** derived onboarding text stays out of production only while production stays at `info`; lowering the level would expose it | Open — follow-up (SA WC-5). `SYSTEM_LOGGING_GUIDELINES.md` corrected to stop claiming redaction is active |
| **OI-10** | **`lib/orchestration/__tests__/IntentClassifier.test.ts` fails 1 of 23 on `main`** ("should cache confidence threshold"): the mock client's call counts leak across tests | Open — follow-up (SA WC-5) |
| **OI-11** | **`lib/orchestration/__tests__/TokenBudgetManager.test.ts` fails 17 of 21 on `main`**, on untouched code. Unrelated to the logging clean-up: neither the test nor `TokenBudgetManager.ts`, `TokenBudgetPredictor.ts` or `types.ts` imports a changed file (SA code review ruling (c), 2026-09-18) | Open — follow-up, pre-existing test failure beside OI-10 |
| **UD-1** | A brand-new business sees part of its first month's allowance already used, for its own onboarding conversation. Nothing is billed or blocked | Recorded; decision with the deduction layer. **Measured by QA on 2026-09-18 (AC-23, workplan §12):** one onboarding conversation, including one change request at the preview step, used **5,539 tokens = 554 credits** (about **2.7%** of the 20,833-credit monthly allowance; about **$0.0166** provider cost). Owner card: used 14,100 → 14,654, remaining 6,733 → 6,179 |
| **KI-A** | Image spend is invisible to the business owner. Layer 1.5 makes it visible to operators only, because showing an owner a cost they aren't charged for would confuse the credits story. With the `images` area it is now one readable figure (UD-2) | Accepted for now; revisit with OQ-7 |
| **KI-B** | The image reuse cache means a repeated request costs nothing and writes no row. Anyone counting images from the ledger is counting **generations**, not requests. (The reuse key is a 32-bit hash — F-11) | Informational; stated in the tab and the scope doc |
| **KI-C** | The four onboarding methods pass `model: 'gpt-4o'` as a literal (`OnboardingConversationManager.ts:951`, `:996`, `:1098`, `:1398`), against CLAUDE.md rule 5. Layer 1.5 carries it unchanged rather than blessing it | Open — Layer 2 per-area model configuration (F-9, RC-17) |
| **KI-D** | **`extractClientTracking` is unreachable today.** Its only occurrence is its own declaration (`OnboardingConversationManager.ts:1093`), and its step, `case 'client_tracking'` (`:803-806`), is retired — it calls `finalizeConfiguration` without any extraction. So only **three** onboarding call types can fire live (`business_story_extraction`; `client_workflow_extraction`, which can fire twice, from `:608` and `:702`; and `adjustment_intent_extraction`, only if the owner asks for a change). All four catalog names are kept, the dead one is attributed and covered by unit tests, and its catalog entry is commented "unreachable as of 2026-09-17" (workplan M-1, SA ruling on Q-1) | Open — **F-12**: delete the extractor and its retired case, or re-wire the question |
| **KI-E** | **An image with no reported quality is priced as `high`** (D-7). If the provider omits the quality it used, the ledger over-states that image's cost rather than under-stating it, and a warning is logged. Frequent warnings would mean the recorded image cost is an upper bound, not an exact figure | Informational; watch the warning count after release |
| Layer 1 | KI-1 to KI-6, OI-2, OI-3 unchanged | Separate items |

**Follow-ups tracked outside this layer:** F-7 (Check 3(c) → Fail), F-9 (onboarding model configuration), F-10 (`usage.category.*` dictionary entries), F-11 (image reuse hash), **F-12** (the unreachable `extractClientTracking`, KI-D). F-8 is superseded by **OI-4**. Found during the logging clean-up and reported to SA (not in this requirement's scope): the onboarding price parser treats any reply **containing** `0` as free, so "100" or "250" records a price of 0.

---

## Open Questions

### For SA — all resolved 2026-09-17

- [x] **OQ-A — The onboarding area and call names.** **Approved as proposed:** area `onboarding` → `business-os-onboarding`, calls `business_story_extraction`, `client_workflow_extraction`, `client_tracking_extraction`, `adjustment_intent_extraction`. Applied in the [catalog](#catalog-additions) and FR-1, FR-2. The new area's legacy list must be empty (RC-3, FR-6). *(Workplan Q-1, 2026-09-17: all four names kept; `client_tracking_extraction` is unreachable, KI-D.)*
- [x] **OQ-B — Where image calls belong.** **BA proposal overridden:** images get their **own area** `images` → `business-os-images`, call name `image_generation`. Applied in the catalog, FR-9, FR-11, FR-14, AC-6, AC-15, AC-16, AC-23, KI-B.
- [x] **OQ-C — The onboarding grouping id.** Minted in `getInitialState()` with `newBosGroupId()` and carried on `OnboardingState`; never named `conversationId` and never read from the body; resumed pre-1.5 snapshots are backfilled. Applied in FR-4, AC-3.
- [x] **OQ-D — The provider-layer image path.** An image method on `OpenAIProvider` through `callWithTracking`, with an optional `requestType` on `CallContext` defaulting to `'chat'`; the tracker needs no change; pricing is supplied by the service. Applied in FR-8, AC-6. *(D-7, 2026-09-18: the cost is resolved from the response's reported quality.)*
- [x] **OQ-E — Where the image configuration lives.** Model, sizes, quality **and** per-image prices together in `system_settings_config`, read through `SystemConfigRepository` in one read — built on `getByKeys` (BA-2 correction). Applied in FR-10, AC-8.
- [x] **OQ-F — Does per-image pricing need a migration?** **No.** `ai_model_pricing` is strictly per token and cannot express a per-image price; writing non-zero tokens for an image is explicitly rejected. Applied in FR-13, NFR Backward compatibility.
- [x] **OQ-G — Where the shared platform-account helper lives.** A dependency-free `lib/platformAccount.ts` that the catalog imports, never the reverse, so the typecheck gate's scope does not grow. Applied in FR-17, FR-19, AC-12, AC-13.
- [x] **OQ-H — Should Check 3(c) become a Fail?** Not in Layer 1.5; it stays **Info**, with the evidence written into FR-22. Promotion is follow-up F-7.
- [x] **OQ-I — The chat report's all-accounts mode.** One explicitly named method on `TokenUsageRepository` (not an optional filter, not a second repository), with four conditions. Applied in FR-24, AC-18.
- [x] **OQ-J — Does a failed image write a row?** **Yes** — the provider layer's existing failure row, plus the four edge rules. Applied in FR-9, AC-7, AC-23.

### For the user (business decisions)

- [x] **OQ-U2 — Should the touched `console.*` files be converted to Pino in this layer (F-8)?** (raised by: SA via RC-16, widened by BA-2 to three files | status: **resolved by the user 2026-09-18 — option A, keep the freeze (D-6)**). Layer 1.5 converts none of `aiAnalytics.ts` (16), `IntentClassifier.ts` (16) or `openaiProvider.ts` (4); only the lines the FRs need are changed. The conversions are open items **OI-4, OI-5, OI-6**, each with SA's risk note. Applied in D-6, Scope, FR-8, FR-18, NFR Logging, AC-14, AC-20, Known Issues.
- [x] **OQ-U3 — Image quality: pin it, or keep `auto`?** (raised by: SA code review CR-1 | status: **resolved by the user 2026-09-18 — option C (D-7)**). Keep quality `auto` so images are unchanged; price each image after the call at the quality the provider reports it used, falling back to `high` with a warning when none is reported; keep quality as the `image_generation_quality` setting (default `auto`). Applied in D-7, Scope, FR-8, FR-9(c), FR-10, FR-13, NFR, AC-8, AC-20, AC-23, KI-E.
- [ ] **OQ-7 (still open) — Should AI images count against monthly credits, and how many credits is one image worth?** (raised by: SA / BA | status: **parked by the user 2026-09-17**, D-1 and D-2). To be answered with OI-1, UD-1 and Q1 in the deduction layer, on the numbers Layer 1.5 makes visible.
- [ ] **UD-1 — Should a new owner's onboarding conversation count against their first monthly allowance, or be attributed but excluded from the gauge?** (raised by: SA | status: **recorded, parked**). D-3 attributes those calls to the owner, and the card counts *down* from a monthly allowance, so a brand-new business opens its dashboard with a slice of its first month already used — for a conversation it had before it started. Nothing is blocked or billed. **AC-23 (RC-18) measures exactly how much**, so the decision can be made on evidence with the deduction layer.
- [ ] **UD-2 / Owner-facing image visibility.** Image spend stays operator-only for now; with the `images` area it is already reportable as its own line, ready for the day the charging decision is taken. Once charging is decided, should the owner see image spend on the usage card, and in what unit? (raised by: BA / SA | status: pending, with OQ-7).

---

## Notes on Integration Points

| Area | Files |
|---|---|
| Onboarding | `lib/services/OnboardingConversationManager.ts` (`:462` `processUserMessage`, the four extractors — one unreachable, KI-D — `getInitialState` `:1979-1986`), `app/api/onboarding/chat/route.ts` (account; state snapshot persistence), `OnboardingConversationRepository` (only if a write becomes necessary) |
| Images | `lib/services/GeneratedImageService.ts` (`:128-249`; price resolution from the reported quality), `app/api/website/media/generate/route.ts:41` (the one caller; mints the group id), `lib/ai/providers/openaiProvider.ts` (new image method; its `console.*` untouched, OI-6) + `baseProvider.ts` (`:103`, `:133` request type), `lib/repositories/SystemConfigRepository.ts` (`getImageGenerationConfig` on `getByKeys`; `image_generation_quality` default `auto`) |
| Catalog | `lib/business-os/llm/callCatalog.ts` (areas `onboarding` and `images` with **empty** legacy lists; the "unreachable" comment on `client_tracking_extraction`; `isPlatformAccount` / `platformAccountIds` rebuilt on the shared helper) |
| Usage mapping | `lib/business-os/usage/usageCategories.ts` (one line per new area; legacy `onboarding` stays under `help`), `usageCategories.catalog.test.ts` |
| Verification | `lib/business-os/usage/llmUsageVerification.ts` (`computeAreaTotals:550-580`), `llmUsageReport.ts`, `llmUsageReportTypes.ts`, `components/test-business-os/llm-usage/LlmUsageVerification.tsx` and `CheckPanels.tsx` (the FR-21 note), `app/api/admin/business-os/llm-usage/**` |
| Platform helper | **new** `lib/platformAccount.ts`; `lib/analytics/aiAnalytics.ts:121` (one line; OI-4), `lib/services/EmbeddingService.ts:46`, `lib/orchestration/IntentClassifier.ts:179`, `:698` (OI-5). **Not** `lib/services/AuditTrailService.ts:121` |
| F-1 | `lib/business-os/bizql/telemetry/usageReport.ts`, `app/api/admin/chat-usage/route.ts`, `scripts/chat-usage-report.ts`, `lib/repositories/TokenUsageRepository.ts` (one named all-accounts method, new column entry, own limit constants) |
| F-6 | `app/api/business-os/usage/route.ts` (`readAllowanceCredits`), `lib/repositories/ConfigRepository.ts` (new multi-key method, `supabaseServer`) |
| Docs | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`, the Layer 1 requirement (roadmap), the investigation doc |
| DB | `token_usage` (writes, through the existing tracker), `system_settings_config` and `ais_system_config` (reads). **No migration** (OQ-F) |
| CI | `npm run typecheck:bos-llm` (AC-21 wording per RC-15) |

---

## SA Review

**Reviewed by SA — 2026-09-17**
**Status:** 🔄 Revision Required — approved in substance, conditional on RC-1 to RC-20 being applied by the BA before the Dev workplan. **BA applied RC-1 to RC-20 on 2026-09-17.** RC-16 was left open pending the user and is **resolved 2026-09-18 (D-6, keep the freeze)**. Workplan-review amendments **BA-1 and BA-2 applied 2026-09-18** (see [below](#amendments-from-the-workplan-sa-review-2026-09-17)). SA code-review correction **CR-1 applied 2026-09-18 as user decision D-7** (see [below](#correction-from-the-sa-code-review-2026-09-18)); it supersedes RC-8's "pin `quality`".

The four parts are the right work in the right places: attribution at the call site and the entry point, tracking in the provider layer, one helper for one rule, and verification derived from the catalog. Nothing here changes what a business is charged, and the zero-token design holds against the merged code — with one factual correction (RC-1) and one taxonomy override (RC-2).

Every claim below was checked against the worktree at `origin/main` 68938031.

### The zero-token, non-zero-cost row — verified against the merged code

| Reader | File | What a zero-token image row does |
|---|---|---|
| Credits (card, report) | `usageSummary.ts` `toCredits`; `app/api/business-os/usage/route.ts:236` | `round(0 / tokensPerCredit)` = **0 credits**. No allowance, gauge or `remaining` movement. ✔ as stated |
| Card breakdown | `usageSummary.ts` `buildCardBreakdown` — `.filter(([, v]) => v.tokens > 0)` | A category with no tokens is **hidden**; `share` divides by `usage.totalTokens` behind a `usage.totalTokens ?` guard, so no division by zero. ✔ as stated |
| Card **call count** | `route.ts:236` `calls: usage.totalCalls`; `business_os_usage_summary` `COUNT(*)`; `summaryFromRpcRows` | **Increases.** See RC-1 — the requirement says "unchanged" |
| `summariseUsageByCategory` | `usageCategories.ts` | Adds one call, zero tokens. ✔ as stated |
| `ChatBudget` | `ChatBudget.ts:162` `.eq('feature', BOS_CHAT_FEATURE)` | Unaffected — image rows carry a different feature. ✔ as stated |
| Check 1 / Check 4 / area totals | `llmUsageVerification.ts` `classifyCallRow`, `evaluateGroupsCheck`, `computeAreaTotals:553-580` | Cost and calls are summed independently of tokens; no token-weighted arithmetic anywhere. ✔ as stated |
| Check 5 | `evaluateUsageCardCheck` | Renders `shownOnCard: v.tokens > 0` → an explicit `no (no tokens)` in the tab (`CheckPanels.tsx:309`). ✔ and already legible |
| Tab display | `formatters.ts` `formatNumber(0)` → `0`; `formatCostUsd` → `$0.0400 (estimated)` | Reads correctly today; no new formatter needed (RC-20) |

**Precedent:** a zero-token ledger row already exists and is already exercised — the chat cache-hit row (`turnUsage.ts:97-113`, `BOS_KNOWN_NON_CATALOG_COMPONENTS.BizQLPlanCache`) and the fixture `business-os-leads` row with `tokens: 0, calls: 1` in `app/api/business-os/usage/__tests__/route.test.ts:75`, which the pinned response counts in `calls: 17` (`:160`) and excludes from the breakdown (`:162`). The image row is the same shape with a cost added. Nothing drops it, nothing divides by it.

### Open-question decisions

- **OQ-A — onboarding area and call names: APPROVED as proposed.** New area `onboarding` → `business-os-onboarding`, calls `business_story_extraction`, `client_workflow_extraction`, `client_tracking_extraction`, `adjustment_intent_extraction`. Verified these are exactly the LLM calls in the file: `getProviderFactory()` appears at `OnboardingConversationManager.ts:947, 992, 1094, 1394` and nowhere else, inside `extractBusinessStory` (`:946`), `extractClientWorkflow` (`:991`), `extractClientTracking` (`:1093`) and `extractAdjustmentIntent` (`:1393`). `extractClientAcquisition` is deterministic multi-select parsing, no model. The new area's legacy list must be **empty** — see RC-3. *(Workplan M-1 / BA-1, 2026-09-17: `extractClientTracking` has no caller — see KI-D.)*

- **OQ-B — where image calls belong: OVERRIDDEN. A new area `images` (`business-os-images`), call name `image_generation`.** Not `website`. Reasons, in order:
  1. **The owner-mental-model argument has no live consumer.** `components/business-os/UsageCard.tsx` renders credits and remaining only; its header comment states the `breakdown` array "is deliberately not read here". A zero-token category is hidden anyway (`buildCardBreakdown`). Placing images under "Website" buys the owner nothing today.
  2. **The only live consumer is the operator report, and `website` hides the number there.** `computeAreaTotals` (`llmUsageVerification.ts:553-580`) is the one place image spend becomes a single figure. Under `website` it is added to text-generation spend and cannot be separated without row-level filtering, which the tab caps at 5,000 rows over a 7-day window. The point of part (b) is that image spend stops being invisible, and the parked charging decision (OQ-7) will need a real per-month image cost to be decided on.
  3. **Unit homogeneity.** An area whose rows mix per-token and per-image pricing makes any future per-area cost/token arithmetic wrong. Areas are also Layer 2 configuration keys, and an image model is not a chat model.

  Cost of the override: one entry in `BOS_LLM_AREAS`, one in `BOS_LLM_CALLS`, one `{ key: 'images', features: bosCategoryFeatures('images') }` line in `USAGE_CATEGORIES`. The grouping id still ties the image to the website request that asked for it (FR-11), so the link the BA wanted is preserved where it belongs — in the group, not the label.

- **OQ-C — onboarding grouping id: mint it in `getInitialState` and carry it in `OnboardingState`.** Verified feasible and correct: the whole state is persisted as `metadata.state_snapshot` on every row (`app/api/onboarding/chat/route.ts:129-131, 183-188, 210-219`) and restored on resume (`:126`); `updateStateFromMessage` deep-copies with `{ ...state }` (`:527`), so a top-level field survives a turn. Every restart path already routes through `getInitialState` — route `:153`, `:169`, `:173`, manager `:522` (unknown step) and `:829` (`intent === 'restart'`) — so "a restart is a new group" comes for free. Two conditions in RC-5.

- **OQ-D — the provider-layer image path: an image method on `OpenAIProvider`, through `callWithTracking`, with an optional request type.** Confirmed viable and minimal:
  - `callWithTracking` (`baseProvider.ts:70-145`) already records success and failure rows with a caller-supplied `cost`; `extractMetrics` can return `inputTokens: 0, outputTokens: 0, cost: priceUsd`.
  - `request_type: 'chat'` is hardcoded at `baseProvider.ts:103` and `:133`. Add `requestType?: string` to `CallContext` and use `context.requestType ?? 'chat'`. **The tracker needs no change**: `aiAnalytics.ts:151` already does `request_type: callData.request_type || 'chat'`, and `openaiProvider.ts:239` already writes a non-chat value (`thread_create`). `request_type` is free text used only as an admin BI breakdown dimension (`app/api/admin/token-usage/drill-down/route.ts:499`); nothing in Business OS filters on it. AC-14 stays intact.
  - `BosCallContextExtras` is `Omit<Partial<CallContext>, 'userId'|'feature'|'component'|'sessionId'>`, so `requestType` becomes a legal extra automatically — no catalog change.
  - Shape: `generateImage(params: { model, prompt, size, quality, n }, context: CallContext, pricing: { usdPerImage: number })`. The price is resolved by the service and passed in, so `lib/ai/**` holds no pricing policy and stays product-agnostic. *(CR-1 / D-7, 2026-09-18: the price now depends on the quality reported in the response, so the service supplies a resolution the provider applies to the response rather than a fixed `usdPerImage`; the "no pricing policy in `lib/ai/**`" rule is unchanged. See FR-8.)*

- **OQ-E — configuration location: the model, its sizes AND the per-image price all in `system_settings_config`, through `SystemConfigRepository`, in one read.** That table is already the model-configuration home with documented in-code defaults — `getAgentCreationConfig()` (`SystemConfigRepository.ts:333-345`), `getAgentGenerationConfig()`, `getAgentExecutionAIProcessingConfig()`. Add `getImageGenerationConfig()` in the same shape (or `getByCategoryAsMap('image_generation')`, `:105`). Splitting the price into `ais_system_config` would mean two tables, two repositories and two round trips for one call; `ais_system_config` holds platform economics (`tokens_per_pilot_credit`, `pilot_credit_cost_usd`, `monthly_ai_allowance_usd`), not model prices. Document that the price key moves if a real per-image price table arrives with the deduction layer. *(Corrected by BA-2 / M-2, 2026-09-18: `getAgentCreationConfig()` (`:335-347`) is two `getByKey` round trips, so it is not the one-read model; `getImageGenerationConfig()` is built on `getByKeys` (`:79-98`). SA approved `getByKeys` over `getByCategoryAsMap` in the workplan review, Q-3.)*

- **OQ-F — no migration.** Confirmed: `ai_model_pricing` is strictly per token (`input_cost_per_token` / `output_cost_per_token`, `lib/ai/pricing.ts:9-27`) and cannot express a per-image price; and recording an image as "one token" to reuse it would put a lie in the column FR-14 depends on. A configuration key plus an in-code fallback map (RC-8) needs no schema change. **Explicitly rejected:** any variant that writes non-zero tokens for an image.

- **OQ-G — the shared helper: a new dependency-free module at `lib/platformAccount.ts`, imported *by* the catalog and importing nothing itself.** This is the only arrangement that does not grow the type-check gate. Per `scripts/typecheck-bos-llm.ts:30-53`, scope = (1) files under `lib/business-os/llm/` and `lib/business-os/usage/` plus **every file that imports the catalog**, (2) barrels re-exporting those, (3) **every file that imports a file from 1 or 2**. So:
  - helper inside `callCatalog.ts` → `aiAnalytics.ts`, `EmbeddingService.ts` and `IntentClassifier.ts` become catalog-importers, and every file importing *them* becomes a caller. Unacceptable.
  - helper in a module that itself imports the catalog → the same outcome via rule 3.
  - helper importing nothing, catalog importing it → the helper is not in scope and its other importers are not pulled in. ✔

  Place it at `lib/` root beside `lib/logger.ts` and `lib/auth.ts`: it is an identity rule, not an AI or Business OS rule. No cycle is possible because it has no imports.

- **OQ-H — Check 3(c) stays Info in Layer 1.5.** Agreed, and the premise is verified: after FR-1 the four onboarding extractors are the **only** remaining live callers of `getProviderFactory().complete()` without a context. Every other live caller passes one (`IntakeGenerationService.ts:267-272`, `app/api/intake/form/infer-question/route.ts:160-165`, `WebsiteGenerationService.ts:567-572`, and the rest). The three that look context-less — `app/api/business-os/story/route.ts:180-188`, `ServiceGeneratorService.ts:304`, `WebsiteAnalyzer.ts:123` — call `.complete()` on a `BaseAIProvider` instance, which has no such method, so they throw before any call (Layer 1's excluded broken calls). Note also that `app/api/onboarding/generate-prompt-ideas/route.ts:128-135` writes `feature: 'onboarding'` with component `generate-prompt-ideas` and a real user id — it never trips Check 3, which matches the label *pair*. Promotion to Fail is a follow-up after an observation period (F-7).

- **OQ-I — the chat report's all-accounts mode: one explicitly named method on `TokenUsageRepository`, not an optional filter and not a second repository.** The file-header invariant ("every method REQUIRES an account id or a non-empty list, and no method can read 'all accounts'") is a guard against *omission*, not against a deliberate, named, admin-only read. A method whose name contains `AllAccounts`, documented with its single admin-gated caller (`app/api/admin/chat-usage/route.ts`, `AdminAccessService` at `:44-52`), satisfies the rule's intent; a second repository on the same table would duplicate the guards and the column allow-list for no gain. Conditions in RC-12.

- **OQ-J — a failed image generation writes a failure row.** Follow the provider layer, as the BA proposed: `callWithTracking`'s catch branch (`baseProvider.ts:113-140`) already writes `success: false`, zero tokens, `cost_usd: 0`, then re-throws. `GeneratedImageService`'s existing `try/catch` absorbs the throw and still returns `{ ok: false, reason: 'failed' }`, so its "never throws" contract is untouched. RC-9 closes the two edges FR-9 leaves ambiguous.

### Required changes (RC-n) — BA applies before the Dev workplan

1. **RC-1 (FR-14, AC-10) — correct the "owner usage card is unchanged" claim.** The usage API returns `calls: usage.totalCalls` (`app/api/business-os/usage/route.ts:236`), and both the database function (`COUNT(*)`) and the row fallback count every row regardless of tokens. A zero-token image row **increments** that number, and increments the `calls` field of its category line in `breakdown` when that category already has tokens. Reword FR-14 and AC-10 to: *credits, the ring, the allowance, `remaining`, the daily series and every breakdown credit figure are unchanged; the response's call counts increase, which is already the pinned behaviour for zero-token rows (`route.test.ts:75, :160, :162`) and is not rendered by `UsageCard.tsx`.* Do not assert that the card's response is byte-identical. — **Applied 2026-09-17:** FR-14 rewritten into "unchanged / changes by design" with the precedent; AC-10 rewritten; the parked-decision section and AC-24 aligned.
2. **RC-2 (Proposed Catalog Additions, FR-9, FR-11, OQ-B) — images get their own area** `images` → `business-os-images`, call name `image_generation`. Update the catalog table, FR-9, FR-14's admin bullet, AC-6, AC-15, AC-16, AC-23 and KI-B accordingly. FR-11's grouping rule is unchanged: the image still carries the owner request's group id. — **Applied 2026-09-17:** the catalog section (retitled, with SA's three reasons), FR-6, FR-9, FR-11, FR-14, FR-20, FR-23, AC-5, AC-6, AC-9, AC-15, AC-16, AC-23, KI-A, KI-B, Integration Points.
3. **RC-3 (FR-6, FR-23, catalog) — both new areas must have EMPTY `BOS_LEGACY_FEATURES` entries, and `onboarding` must never be added to them.** `BOS_LEGACY_FEATURES_FLAT` feeds `bosRowFilter()`, which drives Check 1's read, Check 2's platform-account read and `isBusinessOsFeature` (`llmUsageReport.ts:104-107`, `callCatalog.ts:84-103`). Adding the helper-label feature there would pull every historical `onboarding` row into the Business OS filter, fail Check 2 ("nothing on the platform account"), move the value out of `help` and break `usageCategories.catalog.test.ts:38`. State this as a requirement, not an implementation detail. — **Applied 2026-09-17:** FR-6 (explicit requirement with the consequence), FR-23, the catalog section, AC-5 (assertion added).
4. **RC-4 (FR-20, AC-15) — soften "any place that still needs a manual edit is a defect".** One manual edit is correct and already guarded: `USAGE_CATEGORIES` is a hand-ordered list that also carries non-Business-OS features, and `usageCategories.catalog.test.ts:19-36` already fails when an area has no category keyed by the area name. Required wording: *adding an area requires exactly one `{ key: area, features: bosCategoryFeatures(area) }` line, enforced by the existing catalog test; Check 1, Check 4, the area totals and Check 5's "not in other" rule need no edit* (`llmUsageVerification.ts:162-168, :558`, `usageCategories.ts:29-35`). — **Applied 2026-09-17:** FR-20 rewritten, FR-6 first bullet, AC-15.
5. **RC-5 (FR-4, OQ-C) — three conditions on the grouping id.** (a) It is minted in `OnboardingConversationManager.getInitialState()` (`:1979-1986`) with `newBosGroupId()` and stored on `OnboardingState`. (b) It must **not** be named `conversationId` and must never be read from the request body — `ChatRequestSchema` already accepts a client-supplied `conversationId` (`route.ts:67`) which the route ignores; name the state field distinctly (e.g. `attributionGroupId`) so no future edit wires the body field into attribution. (c) A conversation resumed from a snapshot written before Layer 1.5 has no id: the manager backfills one on restore, before the state is persisted with the user message (`route.ts:183-188`), so a resumed conversation is never recorded with a missing group. — **Applied 2026-09-17:** FR-4 (a)(b)(c) with the persistence evidence and the restart paths, AC-3, NFR Security.
6. **RC-6 (FR-3) — put the required attribution on the public boundary.** `processUserMessage` (`OnboardingConversationManager.ts:462`) takes a required `BosLlmOwner` (or a required `groupId` beside the existing `userId`), not an ad-hoc parameter on each private extractor; the private methods receive it from the turn. There is exactly one caller (`route.ts:207`), so this is a one-line change that makes a missing account or group a compile error, as Layer 1 FR-12 does elsewhere. — **Applied 2026-09-17:** FR-3 rewritten, AC-2.
7. **RC-7 (FR-8, OQ-D) — write the provider-layer shape into the FR**, including the optional `requestType` on `CallContext` defaulting to `'chat'` in `callWithTracking` (`baseProvider.ts:103, :133`); the explicit statement that `lib/analytics/aiAnalytics.ts` needs no change for this because it already forwards `request_type` (`:151`); and that the price is resolved by the service and passed to the provider, so no pricing policy enters `lib/ai/**`. — **Applied 2026-09-17:** FR-8 (four bullets), AC-6, Integration Points. *(FR-8 amended 2026-09-18 by CR-1 / D-7: the service's pricing is applied to the response's reported quality.)*
8. **RC-8 (FR-10, FR-13) — fix the price-resolution precedence, and pin `quality`.** FR-13's "missing price → cost 0" as the *primary* path would ship a feature that records every image at $0 until someone seeds a config row, which defeats part (b). Required order: **configuration → a documented in-code fallback map → 0 with an error-level log naming the model**. The in-code fallback is this codebase's own pattern for exactly this case (`lib/ai/pricing.ts` `FALLBACK_PRICING`, `DEFAULT_TOKENS_PER_CREDIT = 10`, `creditCostUsd ?? 0.00048`) and does not breach "no hardcoded prices", which forbids an unoverridable literal, not a documented default. Also: the price key must include **model + size + quality**, and the request must send an explicit `quality` — today the call omits it (`GeneratedImageService.ts:186-192`) and takes the provider's default, so a provider-side default change would silently invalidate the price. — **Applied 2026-09-17:** FR-13 (numbered precedence), FR-10 (one read, quality pinned, key location), AC-8, NFR Configuration. **Amended 2026-09-18 by SA code review CR-1 and user decision D-7:** the precedence (config → documented fallback → 0) and the model + size + quality key **stand**, but "pin `quality`" is **withdrawn**. Pinning the request quality (the implementation used `high`) changes what every image looks like and can cost up to about 4× more — a behaviour change in a tracking-only layer. Instead the request quality stays the `image_generation_quality` setting with default **`auto`**, and the price is resolved **after** the call from the quality the provider **reports** it used; a missing reported quality is priced as `high` with a warning. That protects the price from a provider-side default change just as well, without changing the images. Applied in FR-8, FR-9(c), FR-10, FR-13, AC-8, AC-20, AC-23, KI-E.
9. **RC-9 (FR-9, OQ-J) — state the edge semantics FR-9 leaves open.** (a) Refusals before the provider call — no API key, `PEOPLE` match, reuse-cache hit, cap reached, unreadable count (`:129-183`) — write **no row**. (b) A thrown provider call writes the standard failure row. (c) A 200 response with no image data (`:194-198`) was billed, so the row is written **with its cost** and the service still returns `{ ok: false, reason: 'failed' }`. (d) A storage-upload or `userMediaRepository.record` failure happens **after** generation, so the row stays — the image was paid for. (e) Keep the graceful `unavailable` path by asking `ProviderFactory.isProviderAvailable('openai')` (`providerFactory.ts:217-221`) instead of reading the key in order to construct a client. — **Applied 2026-09-17:** FR-9 (a)–(e), AC-7, AC-23 (failing-image step).
10. **RC-10 (FR-11, AC-9) — drop the multi-image and website-build language.** `generateImage` has exactly one caller (`app/api/website/media/generate/route.ts:41`) and always requests `n: 1`; no website build path generates images. Required: *the entry-point route mints the group id with `newBosGroupId()`, logs it with the correlation id, and passes a required owner into the service.* Replace AC-9's "two images in one request share the group" with "the route's group id reaches the ledger row, and a second request gets a different one" — the current AC is not exercisable. — **Applied 2026-09-17:** FR-11 rewritten, AC-9 rewritten, Integration Points.
11. **RC-11 (FR-17 to FR-19, OQ-G) — name the module and the rule that protects the gate:** the helper imports nothing and the catalog imports the helper, never the reverse, because `scripts/typecheck-bos-llm.ts` puts every catalog-importer *and every file importing one* in scope. Add an explicit non-target: `lib/services/AuditTrailService.ts:121` looks similar but is a **different rule** (`SYSTEM_ADMIN_USER_ID` falling back to `null`, not to the all-zero UUID); converting it would change behaviour and it is out of FR-18. — **Applied 2026-09-17:** FR-17 (module named, gate rule), FR-18 (non-target), AC-12, AC-13, Scope "out of scope", Integration Points.
12. **RC-12 (FR-24, OQ-I) — four conditions on the cross-account read.** (a) An explicitly named method on `TokenUsageRepository` (e.g. `listChatCallsAllAccountsInWindow`), documented with its single admin-gated caller; existing per-account guards stay, and a contract test asserts no existing method gained an optional account filter. (b) The repository still must **not** import the catalog (`TokenUsageRepository.ts` header, Layer 1.1 RC-7) — `BOS_CHAT_FEATURE` is passed in as data. (c) The extra columns (`user_id`, `activity_type`, `activity_name`, `model_name`, `latency_ms`) go into a new named entry in `TOKEN_USAGE_COLUMNS`; payloads, metadata and `error_message` stay excluded. (d) The current caps (10,000 / 50,000) exceed `TOKEN_USAGE_READ_LIMITS.MAX_CEILING` (5,000): keep them as they are today, do not silently raise them, give the method its own documented limit constants, and return `reachedCeiling` exactly as `listCallsInWindow` does. — **Applied 2026-09-17:** FR-24 "Repository" bullet (a)–(d), AC-18.
13. **RC-13 (FR-24, AC-18) — say how a failed read is surfaced.** "Must surface an error" is not implementable as written: `getChatUsage` returns `ChatUsageReport`, and both consumers (`app/api/admin/chat-usage/route.ts:66`, `scripts/chat-usage-report.ts`) read it directly. Choose one and state it — a result union (`{ ok: false, error }`), or added `readError` / `truncated` / `cap` fields on the report. Whichever is chosen, the route must not answer `200 { success: true }` with a zeroed report, and the script must print the state. — **Applied 2026-09-17 (BA choice):** a **result union** `{ ok: true; report } | { ok: false; error }`, with `truncated` and the applied `cap` carried **on the report** so a truncated read still returns its data. Written into FR-24's first bullet and AC-18; `getChatPricing` follows the same pattern.
14. **RC-14 (FR-25, AC-19) — two facts the FR must carry.** (a) "One round trip" requires a **new** `ConfigRepository` method: `getSystemConfig` reads one key with `.single()` (`ConfigRepository.ts:25-37`); add e.g. `getSystemConfigs(keys: string[])` using `.in('config_key', keys)`. (b) `ConfigRepository` defaults to the **browser** Supabase client (`:5, :18`); the route must construct it with `supabaseServer`, exactly as `readTokensPerCredit` documents (`usageSummary.ts`: "calling it from a route throws a 500 — which is exactly what happened"). AC-19 must also state that the route's characterization test and snapshot (`app/api/business-os/usage/__tests__/route.test.ts:234-255`) still pass with the fake adapted to the repository call. — **Applied 2026-09-17:** FR-25 (a)(b), AC-19, Integration Points.
15. **RC-15 (AC-21, CI) — make the baseline rule achievable.** Layer 1.5 brings new files into the gate (`OnboardingConversationManager.ts` and its route, `GeneratedImageService.ts` and its route, plus whatever imports them). "Baseline unchanged" only holds if none of them carries a pre-existing error. Reword AC-21 to match the gate's own documented rule (`scripts/typecheck-bos-llm.ts:56-62`): *no new diagnostic; baseline **additions** are permitted only for errors proven pre-existing on lines this work did not touch, each itemised in the workplan with its file and code; never to silence a new error.* The Dev still records the scope delta. — **Applied 2026-09-17:** AC-21 rewritten, NFR Type safety.
16. **RC-16 (NFR Logging, FR-18, AC-14) — resolve the `console.*` collision before the workplan.** `lib/analytics/aiAnalytics.ts` contains **16** `console.*` calls (`:97, :101, :122, :129, :137, :186, :208-209, :215-217, :233-235, :241, :245`). CLAUDE.md § Logging requires a touched file to be flagged and proposed for Pino conversion; Layer 1 FR-3 deliberately froze this file, and AC-14 asserts the diff contains nothing but the one line. Both cannot stand silently. Record it in the requirement as **flagged and deferred by decision**, with the Layer 1 FR-3 reason (the tracker is the single write path for every ledger row and is out of scope for behaviour changes), and let the user accept or decline the conversion as its own item (F-8). — **Applied 2026-09-17, left open pending the user; resolved 2026-09-18:** the user chose **option A, keep the freeze (D-6)**, for all three touched non-compliant files. AC-14 is the freeze version; NFR Logging carries the corrected line list (M-3) and the full three-file table (M-4); the three conversions are **OI-4, OI-5, OI-6** with SA's risk notes; D-6 records the deliberate exception to CLAUDE.md § Logging. *(The line list quoted in this RC was corrected by BA-2 / M-3: `:122`, `:215` and `:241` hold no `console.*`.)*
17. **RC-17 (FR-5) — record the hardcoded model as a carried known issue.** The four onboarding calls pass `model: 'gpt-4o'` literally (`:951, :996, :1098, :1398`), against CLAUDE.md mandatory rule 5. FR-5's "no behaviour change" is right for this layer, but the requirement must say so explicitly and hand it to Layer 2's per-area model configuration, so the record does not read as blessing the literal. — **Applied 2026-09-17:** FR-5 "carried, not blessed", new **KI-C**, Scope out-of-scope row, follow-up F-9.
18. **RC-18 (AC-23) — make the live run answer the parked question.** Add two steps: record the **credits the onboarding conversation consumed** for that owner (card figures before and after), and run one **failing** image generation to confirm the failure row appears with zero cost and `Success: no`. The first gives the user a real number for UD-1 below; the second closes OQ-J in the environment, not only in tests. — **Applied 2026-09-17:** AC-23 (two new steps, area-total wording), AC-24, UD-1.
19. **RC-19 (FR-22) — strengthen the evidence sentence.** State in FR-22 that after FR-1 the four onboarding extractors are verifiably the last live context-less callers of `getProviderFactory().complete()`; that `generate-prompt-ideas` writes the `onboarding` feature with a different component and real users, so it never trips Check 3; and that the three apparent context-less callers throw before any call. That is what makes a later promotion to Fail (OQ-H) safe. — **Applied 2026-09-17:** FR-22 rewritten with the four pieces of evidence, AC-17 (prompt-ideas case added), F-7.
20. **RC-20 (FR-21) — say what "clear enough" means, and note that no formatter change is needed.** `formatNumber(0)` renders `0` and `formatCostUsd` renders `$0.0400 (estimated)` (`components/test-business-os/llm-usage/formatters.ts`); Check 5 already prints `no (no tokens)` (`CheckPanels.tsx:309`). With RC-2's dedicated `images` line in the area totals, an operator reads `images · N calls · 0 tokens · $X` without ambiguity. Reduce FR-21 to: one explanatory note in the tab (zero tokens is expected for image rows; cost is per image), no new formatter, no new column. — **Applied 2026-09-17:** FR-21 reduced to the note, AC-16.

### Confirmations (no change needed)

- **Tenant isolation.** Every account is server-side: onboarding from `getUser()` (`route.ts:79, :207`), images from the `userId` the route already resolved (`media/generate/route.ts:35-45`). No attribution field is read from a body, query or header, subject to RC-5(b). No new route, no new `supabaseServer` write, no RLS bypass, no caller-supplied-id write path — the `tenant-isolation-guard` pattern is not triggered.
- **Repository pattern.** All new reads are configuration and ledger reads through `SystemConfigRepository`, `ConfigRepository` and `TokenUsageRepository`. The ledger write continues through the existing tracker, the single write path. The onboarding route's existing direct `supabaseServer` calls on `onboarding_conversations` (`:106, :146, :180, :205`) are pre-existing and out of scope — **but the grouping id must not add a new one**: it rides inside the existing `state_snapshot`, and any write that becomes necessary goes through `OnboardingConversationRepository`.
- **Provider factory.** Part (b) removes the last direct `new OpenAI(...)` on this path (`GeneratedImageService.ts:186`) — a real improvement, made in the provider layer rather than in the service.
- **`aiAnalytics.ts` stays untouched beyond FR-18's single line.** The image path needs nothing from it (`request_type` already flows through `:151`), and `trackAICall` never throws (`:233-241`), which is what makes FR-15 true without new code.
- **Scope.** Parts (a) to (f) are proportionate. Nothing in Layer 1 or Layer 1.1 changes behaviour except the two deliberate additions (onboarding rows move off the platform account; image rows appear), plus the call-count consequence in RC-1.

### Follow-ups (tracked, not Layer 1.5)

| # | Item | Evidence |
|---|---|---|
| F-7 | Promote Check 3(c) to Fail once the legacy helper label has been observed at zero for an agreed period | OQ-H, FR-22 |
| F-8 | `lib/analytics/aiAnalytics.ts` Pino conversion (16 `console.*` calls) — user decision, see RC-16. *(Resolved 2026-09-18: not in this layer; now **OI-4**, alongside OI-5 and OI-6.)* | CLAUDE.md § Logging |
| F-9 | Per-area model configuration for the onboarding calls (the `'gpt-4o'` literals) | RC-17, Layer 2 |
| F-10 | `usage.category.*` dictionary entries are missing for `briefing`, `intake`, `leads` (and would be for `onboarding` / `images`). Harmless today — the card does not render the breakdown — but needed the moment it does | `lib/business-os/LanguageContext.tsx:1139-1147` |
| F-11 | `GeneratedImageService.hash()` is a 32-bit non-cryptographic hash used as the reuse key. Scoped per user, so no cross-tenant leak, but a collision silently suppresses a legitimate regeneration | `GeneratedImageService.ts:243-247` |
| F-12 | *(added from the workplan review)* Delete the unreachable `extractClientTracking` (`OnboardingConversationManager.ts:1093-1130`) and its retired `client_tracking` case (`:803-806`), or re-wire the question | KI-D, workplan M-1 |

### For the user (business terms, not blocking Layer 1.5)

- **UD-1 — a new owner's first month will show the onboarding conversation already spent.** D-3 attributes those four calls to the owner, and the usage card counts *down* from a monthly allowance, so a brand-new business opens its dashboard with a slice of its first month already used — for a conversation it had before it started. Nothing is blocked or billed; it is what the card displays. AC-23 is being extended (RC-18) to measure exactly how much, so "should onboarding count against the owner's monthly allowance, or be attributed but excluded from the gauge?" can be answered on a real number, with the deduction layer. — **Recorded 2026-09-17** in [Open Questions → for the user](#for-the-user-business-decisions), Known Issues, the parked-decision section and AC-23.
- **UD-2 — image spend stays operator-only** (unchanged from KI-A), and with RC-2 it is now reportable as its own line, so a dedicated "images" category is already in place for the day the charging decision is taken. — **Recorded 2026-09-17** in KI-A and the user questions.

### Amendments from the workplan SA review (2026-09-17)

Source: [workplan §11](/docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md), "Amendments the BA must make".

- **BA-1 (workplan Q-1, M-1) — three live onboarding call types, not four.** `extractClientTracking` (`OnboardingConversationManager.ts:1093`) is dead code: its step (`:803-806`) is retired. — **Applied 2026-09-18:**
  - AC-3 and AC-23 reworded to *"every onboarding call type that fires in the session, each on the owner's account and sharing one group"*; AC-23 now expects **three** call types at most and states that `client_tracking_extraction` will not appear;
  - new **KI-D** records the dead extractor, with **F-12** as the fix;
  - the qualifier "the four *methods* are attributed; *three* can fire" added to the Overview, the D-3 note, the Catalog Additions (with the "unreachable as of 2026-09-17" catalog comment and the `client_workflow_extraction` ×2 note) and FR-1; FR-4 now speaks of "every onboarding call type that fires";
  - AC-1 requires unit coverage of the dead extractor; AC-3 and AC-15 cover `client_workflow_extraction` fired twice in one group.
- **BA-2 (workplan M-2, M-3, M-4) — three corrections.** — **Applied 2026-09-18:**
  - **M-2:** FR-10 (and an annotation on OQ-E) now names `getImageGenerationConfig()` built on the existing **`getByKeys`** (one round trip), and states that `getAgentCreationConfig()` is two round trips and not the model; AC-8 matches;
  - **M-3:** the `aiAnalytics.ts` `console.*` line list is now `:97, :101, :129, :137, :186, :208, :209, :216, :217, :218, :235, :236, :246, :297, :323, :372` (NFR Logging, OI-4; RC-16 annotated);
  - **M-4:** NFR Logging names **all three** non-compliant files this layer touches — `aiAnalytics.ts` (16), `lib/orchestration/IntentClassifier.ts` (16), `lib/ai/providers/openaiProvider.ts` (4) — and notes `EmbeddingService.ts` and `providerFactory.ts` are clean.

### Correction from the SA code review (2026-09-18)

- **CR-1 — pinning image quality is a behaviour change.** The implementation pinned the request quality to `high` so the price could be known before the call. That changes what every generated image looks like and can cost up to about **4×** more per image — a behaviour change inside a layer that is meant only to track. SA put the choice to the user. — **User decision 2026-09-18, option C (D-7); applied 2026-09-18:**
  - **keep quality `auto`** — images are unchanged; quality stays the `image_generation_quality` setting (default `auto`), so it can be changed later without a deploy (FR-10, NFR);
  - **record the true cost** — each image is priced **after** the call at model + size + **the quality the provider reports it used**; if none is reported, it is priced as `high` and a warning is logged (FR-13, KI-E);
  - the service supplies pricing the provider applies to the response, so no pricing policy enters `lib/ai/**` (FR-8; OQ-D annotated);
  - RC-8's "pin `quality`" withdrawn (RC-8 annotated); FR-9(c), AC-8, AC-20 and AC-23 updated; **OQ-U3** recorded as resolved;
  - the parked charging decision (**OQ-7**) is **unchanged**.

### Approval

- [x] Approved in substance, **conditional on** RC-1 to RC-20 being applied by the BA.
- [x] **Conditions met 2026-09-17:** RC-1 to RC-20 applied by the BA; OQ-A to OQ-J decisions written into the FRs and ACs; UD-1 and UD-2 recorded. **Ready for the Dev workplan.**
- [x] **RC-16 / F-8 resolved 2026-09-18:** the user chose **keep the freeze (D-6)** for all three touched non-compliant files; AC-14 is the freeze version and the conversions are open items OI-4 to OI-6.
- [x] **BA-1 and BA-2 applied 2026-09-18** (workplan SA review §11).
- [x] **CR-1 applied 2026-09-18** as user decision **D-7** (keep quality `auto`, price from the reported quality).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created (Draft) | Layer 1.5 requirement from the user's decisions of 2026-09-17: onboarding conversation attributed to the owner (D-3); AI images tracked but not charged, with the charging decision explicitly parked (D-1, D-2, OQ-7); one shared platform-account helper; the Layer 1.1 verification tab extended to cover both (D-5); follow-ups F-1 and F-6 folded in, OI-1 out of scope (D-4). 26 FRs, 24 ACs; 10 SA open questions and 2 parked user decisions |
| 2026-09-17 | SA review — revision required | Approved in substance, conditional on RC-1 to RC-20. OQ-A approved as proposed; **OQ-B overridden** — images get their own area `business-os-images` / `image_generation`, not `website`, because the owner card never renders the breakdown and the area totals are the only place image spend becomes one figure; OQ-C grouping id minted in `getInitialState` and carried in `OnboardingState` (never the body's `conversationId`); OQ-D image method on `OpenAIProvider` through `callWithTracking` with an optional `requestType` defaulting to `chat` (the tracker already forwards it); OQ-E model, sizes and per-image price together in `system_settings_config` via `SystemConfigRepository`; OQ-F no migration; OQ-G a dependency-free `lib/platformAccount.ts` that the catalog imports, never the reverse, to keep the typecheck gate from growing; OQ-H 3(c) stays Info; OQ-I one explicitly named all-accounts method on `TokenUsageRepository`; OQ-J failure rows come free from the provider layer. Main corrections: the card's **call counts do change** for a zero-token row (RC-1), the new areas must carry an empty legacy list or Check 2 breaks (RC-3), price precedence must be config → documented fallback → 0 (RC-8), one caller and `n: 1` for images (RC-10), the `aiAnalytics.ts` `console.*` collision must be settled before the workplan (RC-16). 5 follow-ups (F-7 to F-11) and 2 user notes (UD-1, UD-2) |
| 2026-09-17 | BA applied RC-1 to RC-20 — ready for Dev workplan | Corrected the zero-token claim: credits, ring, allowance, `remaining`, daily series and breakdown credits are unchanged, **call counts rise** and nothing owner-facing renders them (RC-1, FR-14, AC-10, AC-24). Images moved to their own area `business-os-images` / `image_generation` throughout, with the grouping id still tying an image to the request that asked for it (RC-2). Empty legacy lists required for both new areas, with the Check 2 / `help` / catalog-test consequence stated (RC-3, FR-6, AC-5). FR-20 softened to "exactly one `USAGE_CATEGORIES` line, enforced by the existing test" (RC-4). Grouping id minted in `getInitialState`, carried on `OnboardingState`, never named or read as `conversationId`, backfilled on resume (RC-5, FR-4, AC-3). Required attribution moved to `processUserMessage` (RC-6, FR-3). Provider-layer image shape, optional `requestType` and "no pricing policy in `lib/ai/**`" written into FR-8 (RC-7). Price precedence config → documented in-code fallback → 0 with an error log, key on model+size+quality, `quality` pinned, one `SystemConfigRepository` read (RC-8, FR-10, FR-13, AC-8). Image row edge semantics (a)–(e) (RC-9, FR-9, AC-7). One caller and `n: 1`; the route mints and logs the group id (RC-10, FR-11, AC-9). `lib/platformAccount.ts` named with the typecheck-gate rule, `AuditTrailService.ts:121` excluded as a different rule (RC-11, FR-17, FR-18). Four conditions on the cross-account repository read (RC-12, FR-24, AC-18). Failed/truncated chat reads surfaced as a **result union with `truncated` and `cap` on the report** — BA's choice under RC-13. New multi-key `ConfigRepository` method built with `supabaseServer`, route test kept green (RC-14, FR-25, AC-19). AC-21 reworded to the gate's own baseline rule (RC-15). `aiAnalytics.ts` `console.*` collision recorded as flagged-and-deferred with both options and **user question OQ-U2 / F-8 left open** (RC-16). Onboarding `'gpt-4o'` literals recorded as **KI-C** and handed to Layer 2 (RC-17, F-9). AC-23 extended to measure the onboarding credits (UD-1) and to run a failing image generation (RC-18). FR-22's evidence strengthened (RC-19, AC-17). FR-21 reduced to one explanatory note, no new formatter or column (RC-20, AC-16). Added UD-1, UD-2, KI-C and follow-ups F-7 to F-11; OQ-A to OQ-J marked resolved. Status → SA approved, ready for Dev workplan. Counts unchanged: **26 FRs, 24 ACs** |
| 2026-09-18 | Workplan SA amendments BA-1 / BA-2 + user decision D-6 (OQ-U2) | **BA-1:** `extractClientTracking` is unreachable (its step is retired), so only three onboarding call types can fire live — AC-3 and AC-23 reworded to "every onboarding call type that fires in the session, each on the owner's account and sharing one group", AC-23 expects three and says `client_tracking_extraction` will not appear; new **KI-D** with fix **F-12**; all four catalog names kept with an "unreachable as of 2026-09-17" note and unit coverage for the dead one (AC-1); the `client_workflow_extraction` ×2 case added (AC-3, AC-15); Overview, D-3 note, Catalog Additions, FR-1 and FR-4 qualified. **BA-2:** FR-10 / OQ-E now build `getImageGenerationConfig()` on `getByKeys` (one round trip), not on the two-round-trip `getAgentCreationConfig()` (M-2); the `aiAnalytics.ts` `console.*` line list corrected (M-3); NFR Logging names all three touched non-compliant files — `aiAnalytics.ts` 16, `IntentClassifier.ts` 16, `openaiProvider.ts` 4 (M-4). **D-6 (user, 2026-09-18) — keep the freeze:** Layer 1.5 converts none of the three; only the lines the FRs need change; OQ-U2 resolved; AC-14 set to the freeze version; AC-20 adjusted; the three conversions recorded as **OI-4** (`aiAnalytics.ts`, highest risk, separate mechanical commit), **OI-5** (`IntentClassifier.ts`, medium risk, no Layer 1.5 test coverage) and **OI-6** (`openaiProvider.ts`, low risk, `getInstance` guards only), recorded as a deliberate, user-approved exception to CLAUDE.md § Logging with the reason. F-8 superseded by OI-4; F-12 added. AC-23's induced image failure named (a non-existent configured model). Status updated. Counts unchanged: **26 FRs, 24 ACs** |
| 2026-09-18 | SA code review CR-1 + user decision D-7 (image quality) | The implementation had pinned the image request quality to `high`, which would change what every generated image looks like and cost up to about 4× more — a behaviour change in a tracking-only layer. **User decision 2026-09-18, option C (D-7):** keep quality **`auto`** (images unchanged); record the true cost by pricing each image **after** the call at model + size + the quality the provider **reports** it used; if none is reported, price it as `high` and log a warning; quality stays the `image_generation_quality` setting (default `auto`), changeable without a deploy. Applied in D-7 (with the reason), Overview, User Stories, Scope, FR-8 (service-supplied pricing applied to the response; no pricing policy in `lib/ai/**`), FR-9(c), FR-10 (the "pin `quality`" bullet withdrawn and marked superseded), FR-13 (post-call resolution from the reported quality, `high` fallback with a warning, fallback map covering every reportable quality), NFR Configuration / new "no behaviour change to images" / Logging / Testability, AC-8 (reported-quality and missing-quality cases; no pinned quality), AC-20, AC-23 (reported quality recorded with the cost), new **KI-E**, **OQ-U3** resolved, OQ-D and RC-7 / RC-8 annotated, SA Review correction section and approval. **OQ-7 (the parked charging decision) is unchanged.** Counts unchanged: **26 FRs, 24 ACs** |
| 2026-09-18 | UD-1 measured (QA) | AC-23 live run: one onboarding conversation = 5,539 tokens = 554 credits (≈2.7% of the 20,833-credit monthly allowance, ≈$0.0166 provider cost). Recorded in the UD-1 row; the decision stays with the deduction layer. No FR/AC change |
| 2026-09-18 | Open item OI-7 (privacy) | QA observation O-2: onboarding writes the owner's raw chat text to server logs (6 lines in `OnboardingConversationManager.ts`, pre-existing). Recorded as a follow-up per user decision. No FR/AC change |
| 2026-09-18 | Open items OI-4 to OI-8 resolved; OI-9 and OI-10 added | The [logging clean-up workplan](/docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md) is code complete, pending SA code review, QA and commit. OI-4, OI-5 and OI-6 are converted to Pino. OI-7: raw owner text is removed from every log level, including two more lines (`:595` and the route `:208`). OI-8 is added and resolved per user decision D-OI8 (derived text at debug only). OI-9 (redaction never active) and OI-10 (the pre-existing IntentClassifier test failure) are added as open. No FR/AC change |
| 2026-09-18 | OI-11 added; OI-7/OI-8 extended by SA code review CR-1 to CR-3 | OI-11: the pre-existing `TokenBudgetManager.test.ts` failures (17 of 21). CR-1: service names are no longer logged (a count instead). CR-2: an extractor's JSON parse error logs only its name at error. CR-3: a model-returned adjustment intent is logged at info only when it is a known label. No FR/AC change |
