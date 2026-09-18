---
name: bos-llm-call-standards
description: Make every Business OS AI call follow the LLM standards built in Layers 1, 1.1, 1.5, the logging clean-up and Layer 3. That means a catalogued call name, a server-side account, one grouping id per action, cost tracked through the provider layer, no owner text in logs, and (with Layer 3) one audit entry per action. Use when adding, changing or reviewing an LLM/AI call, embedding, image generation or AI feature in Business OS code — `lib/business-os/**`, `app/api/business-os/**`, and the Business OS services (`lib/services/Website*`, `Intake*`, `Onboarding*`, `LeadAlert*`, `GeneratedImage*`) and their routes. Does NOT apply to the agents side (`lib/agentkit/**` including V6, `lib/pilot/**`), which also uses `callWithTracking` / `ProviderFactory` under its own rules. It prevents the classic failures: spend landing on the platform account, ungroupable ledger rows, untracked cost, and owner text in production logs.
---

# bos-llm-call-standards

Use this whenever a Business OS feature **calls a model**: chat, embeddings, image generation, or a new AI step. That includes changing the prompt, model or caller of an existing call. The failure mode is quiet. The call works, but its cost is recorded on the platform account, cannot be grouped into the action that caused it, or the owner's words end up in production logs. Nothing breaks, so review is the only line of defence.

**Canonical sources (read + link, do not duplicate):**
- **Requirements:**
  - `docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md` (naming, attribution, grouping);
  - `docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md` (the checks);
  - `docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md` (onboarding, images, the platform-account helper).
  - `docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md` (Layer 3: one audit entry per AI action).
- **Logging:** `docs/workplans/BUSINESS_OS_LLM_LOGGING_CLEANUP_WORKPLAN.md` (the clean-up workplan) and `docs/SYSTEM_LOGGING_GUIDELINES.md` (the project guidelines).
- **The investigation that drives all of it:** `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md`.

**Worked references (copy their shape):**
- `lib/business-os/briefing/BriefingNarrator.ts`: a deterministic group (`bosBriefingGroupId`) plus `buildBosCallContext`;
- `app/api/website/generate-from-profile/route.ts`: a group minted per request, logged, and passed down;
- `lib/services/OnboardingConversationManager.ts`: `BosLlmOwner` threaded through a service; the privacy-safe logging.

---

## Standard 1: Naming (the catalog is the only source of labels)

- Every call has an **area** and a **stable call name** in `lib/business-os/llm/callCatalog.ts` (`BOS_LLM_AREAS`, `BOS_LLM_CALLS`). Call names are future config keys, so **never rename one** without a migration plan.
- Build the context with `buildBosCallContext({ userId, area, callName, groupId }, extras)`. It sets `feature` (`bosFeature(area)`), `component` (the call name) and `sessionId` (the group). **Never hand-type `feature` / `component`.**
- **Embeddings:** pass `toEmbeddingAttribution(context)` to `EmbeddingService.generateEmbedding`.
- **A new area** needs three additions:
  - an entry in `BOS_LLM_AREAS` and `BOS_LLM_CALLS`;
  - an **empty** list in `BOS_LEGACY_FEATURES`;
  - a usage-card category in `lib/business-os/usage/usageCategories.ts` (`bosCategoryFeatures(area)`).

## Standard 2: Attribution (the account is server-side, always)

- **The account comes from the server only:**
  - the session (`getUser()` in `@/lib/auth`);
  - the business a job is iterating;
  - the owner resolved from the database (for example, the site owner for a lead).
- **Never** from a request body, header, query string or client-supplied id.
- **Services take a `BosLlmOwner` (`{ userId, groupId }`)** from their caller and pass it down to every call. A required owner parameter makes a missing account a compile error.
- **Never target the platform account.** `lib/platformAccount.ts` is where the tracker lands a call with no valid account. That is a bug signal, not a destination (`isPlatformAccount` in the catalog).
- **Service-role writes by a caller-supplied id** → use the `tenant-isolation-guard` skill.
- **A new route** → the `new-api-route` skill, with one caveat: its admin-only variation (`.claude/skills/new-api-route/SKILL.md:118`, `app_metadata.role`) is stale (Layer 1.1 F-4). Admin checks use `AdminAccessService`, per CLAUDE.md § Security Rules.

## Standard 3: Grouping (one id per user action or job)

- **Mint one grouping id per action,** in the function that owns the action, and pass it to every call the action makes:
  - `newBosGroupId()` per request;
  - `bosBriefingGroupId(userId, date)` for the briefing;
  - the chat turn id (`app/api/business-os/chat-v4/route.ts`);
  - the cron `runId` (`app/api/cron/insight-detect/route.ts`).
- **Log the id where it is minted** (as `generate-from-profile` does), so an action can be traced.
- **Never take the group from the request** (Layer 1.5 RC-5: onboarding's group is stored state, not the body's `conversationId`).

## Standard 4: Cost tracking (through the provider layer, always)

- **Every call goes through `BaseAIProvider.callWithTracking`** (`lib/ai/providers/baseProvider.ts`): chat and JSON via the providers or `getProviderFactory().complete(…, context)`, embeddings via `EmbeddingService`, images via `generateImage` (`lib/services/GeneratedImageService.ts`).
  - **No direct SDK calls** (`new OpenAI()`, `openai.images.generate`), and **no `trackAICall` by hand**.
  - *The one sanctioned exception:* the chat cache-hit row in `lib/business-os/bizql/telemetry/turnUsage.ts` (`recordCachedTurn`). It is a zero-token row with no model call, and its component is listed in `BOS_KNOWN_NON_CATALOG_COMPONENTS`.
- **Images are priced per image** (both in `GeneratedImageService.ts`):
  - `imagePriceResolver` prices the image **after** the call, at the quality the provider reports (Layer 1.5 D-7);
  - `resolveImagePrice` does the lookup: configuration (`system_settings_config`, via `SystemConfigRepository.getImageGenerationConfig`), then the documented fallback in `IMAGE_FALLBACK_PRICING`, then $0 with an error log.
- **No hardcoded model names or prices** (CLAUDE.md rule 5). *Known exception carried forward:* the onboarding extractors' `'gpt-4o'` literals (Layer 1.5 KI-C, to Layer 2).

## Standard 5: Privacy and logging

- **Pino only** (`createLogger`), with the correlation id on request paths.
- **Never log what the owner typed, at any level:** a prompt, a message, a form value. Log its **length**, the step, and ids.
- **Text a model derived from owner input goes to `debug` only:** extractions, summaries, the model's output. Production runs at `info` (`lib/logger.ts`), so debug stays local.
- **A JSON `SyntaxError` quotes the text it failed on.** On a parse failure, log only `errName` (and a length) at error, and the full error at debug. See `logExtractionFailure` in `OnboardingConversationManager.ts`, and the parse catch in `lib/services/OnboardingChatService.ts`.
- **A model-returned label** is logged at info only if it is one of the known labels; otherwise log its length (`KNOWN_ADJUSTMENT_INTENTS` in the same file).
- **Log redaction is not active** (open item OI-9 in the Layer 1.5 requirement). Never rely on it.

## Standard 6: Audit trail (coming with Layer 3, steps 1–5; finalise when the pattern exists in code)

> **What exists on `main` today, and what does not.**
> - **Decided** in `docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md` (OQ-2, OQ-3): the event names and the entity type.
> - **Already on `main`** (step 0): the exclusion constants `AI_ACTION_ENTITY_TYPE` (`'ai_action'`) and `AI_ACTION_EVENT_PREFIX` (`'BUSINESS_AI_ACTION_'`) in `lib/audit/requestSchemas.ts`, and the owner-read exclusion (below).
> - **Not on `main` yet:** the two events are not registered in `lib/audit/events.ts`, and there is no accumulator and no emitter.
>
> The design is in `docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md` §3. Update this section when step 3 lands.

- **One audit entry per AI action or job, never per call.**
  - The events are `BUSINESS_AI_ACTION_COMPLETED` / `BUSINESS_AI_ACTION_FAILED`, the entity type `ai_action`, and the entity id is the grouping id.
  - The totals will come from an in-process accumulator: an `AsyncLocalStorage` scope that the provider layer's `callWithTracking` feeds. They never come from a ledger read-back. *(The module and wrapper names in the workplan are proposals.)*
- **Only the agreed fields:** ids, counts, tokens, cost, call names, models, outcome, and an error **code**. Never a prompt, owner text, AI output, error message, business name or the HTTP request.
- **`void AuditTrail.log(entry).catch(…)`.** Never `await` it (it can wait on a 100-row insert), never flush.
- **Severity and compliance flags come only from `EVENT_METADATA`:** COMPLETED is info, FAILED is warning. The caller never passes them (Layer 3 RC-5).
- **Before writing:** the account and actor are UUIDs, and the account is not the platform account. A bad row fails a whole shared batch.
- **Background jobs:** the platform actor, with trigger `scheduled` (leads: `external`).
- **AI entries are operator-only** *(live since step 0)*. Owner reads exclude them in the query, in `AuditTrailRepository.listOwnerEntries`.

## Standard 7: Proof (the definition of done)

- **Tests assert the context each call receives:** area (`business-os-<area>`), call name, the account, and the grouping id. They also assert that raw input **never reaches a logger at any level**, using a capturing `createLogger` mock with a sentinel string.
  - Examples: `lib/services/__tests__/OnboardingConversationManager.attribution.test.ts`, `GeneratedImageService.attribution.test.ts`, `EmbeddingService.attribution.test.ts`, `lib/business-os/insight/__tests__/insight-llm-attribution.test.ts`.
- **`npm run typecheck:bos-llm` passes** (CI: `.github/workflows/bos-llm-typecheck.yml`) with **0 new** errors and `scripts/typecheck-bos-llm.baseline.json` **unchanged**. The gate's scope (`scripts/typecheck-bos-llm.ts`) is:
  - everything under `lib/business-os/llm/` and `lib/business-os/usage/`;
  - every file that imports the catalog;
  - barrels that re-export one;
  - every file that imports any of those;
  - every test named `*attribution*.test.ts`.
- **Live:** the **LLM Usage** tab on `/test-business-os` (`components/test-business-os/llm-usage/`) shows the new calls under the right account and area, with a group, and every check green.
- **The owner usage-route snapshot is unchanged:** `app/api/business-os/usage/__tests__/__snapshots__/route.test.ts.snap`.

---

## Review checklist

- [ ] The call name exists in `BOS_LLM_CALLS`; the context is built with `buildBosCallContext` (or `toEmbeddingAttribution`)
- [ ] The account comes from the session, the job, or a DB lookup, never the request; `BosLlmOwner` is threaded through
- [ ] One grouping id per action, minted by the owning function, logged where minted, shared by every call
- [ ] The call goes through the provider layer (`callWithTracking`); no SDK call, no hand-written `trackAICall`, no hardcoded model or price
- [ ] No prompt, owner text or model output at info or above; the `SyntaxError` pattern on parse failures
- [ ] A new area: catalog entry + empty legacy list + usage category
- [ ] Tests: area / call name / account / group asserted; a sentinel shows raw text never logged
- [ ] `typecheck:bos-llm` 0 new, baseline unchanged; the LLM Usage tab green; the usage snapshot unchanged
- [ ] (Once Layer 3 lands) one non-awaited audit entry per action, with validated ids

## Anti-patterns (probable bugs)

- **`getProviderFactory().complete(params)` with no context.** It is recorded as `userId: 'system'`, `onboarding` / `simple-complete`, and lands on the platform account.
- **A `userId` / `groupId` from the request body or `x-user-id`,** or a client `conversationId` used as the group.
- **`logger.info({ message }, …)`**, `{ prompt }`, `{ content }`, a raw error at error level on a JSON parse failure, or `console.*`.
- **`as never` / `as any` around a context or attribution** to silence the catalog's types. Fix the call name instead.
- **A fresh `newBosGroupId()` per call** instead of per action (one action becomes many groups).
- **`await AuditTrail.log(…)`** on a request path, or an audit entry per call.
- **A direct `openai.*` call "just for this one feature",** or a model name or price literal in feature code.
- **A shared helper that imports the catalog.** Every file that imports the helper is then pulled into the `typecheck:bos-llm` gate with it. This is why `lib/platformAccount.ts` imports nothing: the catalog imports it, never the reverse (Layer 1.5 OQ-G).

## When NOT to use

The agents side (`lib/agentkit/**` including V6, `lib/pilot/**`, agent execution) has its own attribution (`agent_id` / `execution_id`) and audit events. Follow the V6 Work Protocol in CLAUDE.md there, not this skill. Non-Business OS helpers (`help`, the legacy `onboarding` feature value) are out of scope too.
