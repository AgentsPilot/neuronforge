---
name: bos-llm-call-standards
description: Make every Business OS AI call follow the LLM standards built in Layers 1, 1.1, 1.5, the logging clean-up and Layer 3. That means a catalogued call name, a server-side account, one grouping id per action, cost tracked through the provider layer, no owner text in logs, one audit entry per AI action (`runAiAction`), and a model/temperature resolved from the area settings instead of hardcoded. Use when adding, changing or reviewing an LLM/AI call, embedding, image generation or AI feature in Business OS code — `lib/business-os/**`, `app/api/business-os/**`, and the Business OS services (`lib/services/Website*`, `Intake*`, `Onboarding*`, `LeadAlert*`, `GeneratedImage*`) and their routes. Does NOT apply to the agents side (`lib/agentkit/**` including V6, `lib/pilot/**`), which also uses `callWithTracking` / `ProviderFactory` under its own rules. It prevents the classic failures: spend landing on the platform account, ungroupable ledger rows, untracked cost, and owner text in production logs.
---

# bos-llm-call-standards

Use this whenever a Business OS feature **calls a model**: chat, embeddings, image generation, or a new AI step. That includes changing the prompt, model or caller of an existing call. The failure mode is quiet. The call works, but its cost is recorded on the platform account, cannot be grouped into the action that caused it, or the owner's words end up in production logs. Nothing breaks, so review is the only line of defence.

**Canonical sources (read + link, do not duplicate):**
- **Requirements:**
  - `docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md` (naming, attribution, grouping);
  - `docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md` (the checks);
  - `docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md` (onboarding, images, the platform-account helper).
  - `docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md` (Layer 3: one audit entry per AI action);
  - `docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md` (Layer 2: model settings per area, the kill switch, FR-15).
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
- **A new route** → the `new-api-route` skill. Its admin-only variation is now correct: admin routes use the canonical `requireAdmin` gate (`lib/admin/requireAdminRoute.ts`) as their first statement — never `app_metadata.role` (the stale Layer 1.1 F-4 instruction) and never `profiles.role`, per CLAUDE.md § Security Rules.

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
- **No hardcoded model names or prices** (CLAUDE.md rule 5). There is **no exception left**: Layer 2 Step 2 removed the onboarding extractors' `'gpt-4o'` literals (Layer 1.5 KI-C, closed), and Standard 8 is now enforced by CI.

## Standard 5: Privacy and logging

- **Pino only** (`createLogger`), with the correlation id on request paths.
- **Never log what the owner typed, at any level:** a prompt, a message, a form value. Log its **length**, the step, and ids.
- **Text a model derived from owner input goes to `debug` only:** extractions, summaries, the model's output. Production runs at `info` (`lib/logger.ts`), so debug stays local.
- **A JSON `SyntaxError` quotes the text it failed on.** On a parse failure, log only `errName` (and a length) at error, and the full error at debug. See `logExtractionFailure` in `OnboardingConversationManager.ts`, and the parse catch in `lib/services/OnboardingChatService.ts`.
- **A model-returned label** is logged at info only if it is one of the known labels; otherwise log its length (`KNOWN_ADJUSTMENT_INTENTS` in the same file).
- **Log redaction is not active** (open item OI-9 in the Layer 1.5 requirement). Never rely on it.

## Standard 6: Audit trail (one entry per AI action)

Every AI action writes exactly one `audit_trail` entry that summarises its LLM calls (Layer 3: `docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md`, design in `docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md` §3).

- **Wrap the function that performs ONE action in `runAiAction`** (`lib/business-os/llm/aiActionAudit.ts`). Pass:
  - `area`;
  - `actionType` (the `AiActionType` list);
  - the action's `groupId`;
  - `trigger` (`'user'`, `'scheduled'` or `'external'`);
  - the server-side `accountId`.

  It returns the action's own value, or rethrows its own error, unchanged.
  - An account known only later (a route that authenticates inside the action): call `h.setAccount(user.id)`.
  - An action that degrades without throwing (a fallback, an empty image): call `h.markFailed(code)` (`AiFailureCode`). For website and intake results, use `markGenerationResult(h, result)`.
- **Worked references:**
  - `app/api/business-os/chat-v4/route.ts`: a thin `POST` wrapping `handleChatTurn`;
  - `app/api/cron/insight-detect/route.ts`: one action per business per run;
  - `lib/business-os/briefing/BriefingStore.ts`: `getBriefing`'s required `trigger`;
  - `app/api/onboarding/build/route.ts`: one action spanning two areas;
  - `lib/business-os/bizql/mutate/MutateExecutor.ts`: a nested action with its own group.
- **The totals come from the usage scope** (`lib/ai/usageScope.ts`), which `BaseAIProvider.callWithTracking` feeds once per call. There is **no ledger read-back**.
  - Only calls whose `sessionId` is the action's group are counted. A Business OS call left out with a "different grouping id" warning is a wiring bug to fix; a left-out call from another product is expected.
  - A nested `runAiAction` with its own group writes its own entry.
  - An action with **no** LLM call writes **no** entry.
- **The entry is built only by `buildAiAuditEntry`.**
  - It carries event `BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`, entity `ai_action`, and entity id = the grouping id.
  - `details` holds ids, counts, tokens, the cost, call names, models, the outcome and an error **code**. `details.areas` (from the calls) is authoritative for multi-area actions.
  - **Never** a prompt, owner text, AI output, an error message, the business name, or the HTTP request.
  - Severity and flags come only from `EVENT_METADATA`: COMPLETED is info, FAILED is warning.
- **It is written as `void AuditTrail.log(entry).catch(…)`,** inside `runAiAction`. Never `await` it (it can wait on a 100-row insert), never flush, never write one yourself.
- **Identities are checked before writing** (`validateIdentities`): the group and account are UUIDs, and the account is never the platform account. Scheduled and external actions use the platform actor (`platformActorId`).
- **AI entries are operator-only.** Owner reads exclude them in the query (`AuditTrailRepository.listOwnerEntries`). The owner RLS policy hides them from direct reads (`supabase/migrations/20260930_audit_trail_owner_policy_hides_ai_actions.sql`). A browser can never write one (the allow-list in `lib/audit/requestSchemas.ts`).
- **Server-only:** `aiActionAudit.ts` reaches the provider layer and `node:async_hooks`. No `'use client'` module may import it, even indirectly (the PR #53 build failure). Keep pure helpers in dependency-free files, like `lib/business-os/briefing/briefingLines.ts`, and run `next build`.
- **Known limit (KI-B):** the audit service queues and batches, so an entry can be delayed or occasionally lost; the calls are always in the usage ledger under the same group.

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

## Standard 8: Model settings (resolve them; never write them)

Layer 2 moved every catalogued call onto settings an operator can change without a deploy. A call site that hardcodes a model still works, still tracks cost and still passes every attribution test — it just stops obeying its area row, and nobody finds out until someone changes a setting and nothing happens.

- **Resolve, then call.** `const settings = await resolveBosLlmSettings(area, callName)` (`lib/business-os/llm/modelSettings.ts`) returns `{ enabled, provider, model, temperature }`. The resolver **never throws**: a missing row, an invalid field, a dead database or a 3-second hang all degrade to the code defaults, which are today's behaviour.
- **Honour `enabled: false`:** make no provider call, write no ledger row and no audit entry, and return the area's documented fallback (`aiUnavailableMessages.ts` for owner-facing text). An area-wide entry gate uses `isBosLlmAreaEnabled(area)`.
- **Build the request INSIDE the retry:** `await withModelFallback(settings, (model) => provider.chatCompletion({ model, ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}) }, context))`. `withModelFallback` (`lib/business-os/llm/modelFallback.ts`) retries once on the code default when a configured model is refused, so a bad setting can never take a feature down. Building the request outside the callback means the retry re-sends the model that was just refused.
- **Report the model that RAN**, not the one you asked for: `modelUsed` from the fallback, in any stored `generated_from.model`, `diagnostics.model` or cache entry (FR-13).
- **Defaults live in exactly one file:** `lib/business-os/llm/modelSettingsPolicy.ts`. It is typed against the catalog, so a new catalogued call with no policy entry is a `typecheck:bos-llm` error.
- **A new area or call needs three things:** a policy entry (model, temperature, `switchable`), a row field in the seed/migration if it should be operator-visible from day one, and a decision on whether it can be switched off. `switchable: true` with no off path is a lie the operator will act on.
- **`npm run check:bos-llm-literals` is CI** (a second step in `.github/workflows/bos-llm-typecheck.yml`). It fails on a quoted model id (`'gpt-4o'`, `'o3-mini'`, `'chatgpt-4o-latest'`, `'gpt-image-1'`), on `OPENAI_MODELS.*` or `BOS_LLM_CALL_POLICY.*`, on a number bound to a name like `temperature` (including `?? 0.7`, `??=`, `||=`, a ternary, a default parameter, a class property, a destructuring default and `satisfies number`), on a read of a superseded key (`bizchat_planner_model`, `image_generation_model`, …) and on `process.env.*MODEL*`, in any non-test file that imports the catalog. Exempt files are named, with reasons, and both `--list` and the failure output print them: the policy module and the operator script. A third is a code change with an SA review, never a directory exclusion. Comments are not scanned — prose may name a model; code may not.
- **Know what that check does NOT see, or you will trust it too far.** It is syntactic: it sees a value written **at** the call site. It does **not** see a model or temperature that arrives from **another module** (`import { PREFERRED_MODEL }` — SA proved this end to end with the gate green), one that is **computed** (`['gpt','4o'].join('-')`, a template literal, a JSON file), one reached through an **unnamed variable** (`const t = 0.7`), a model id **outside its pattern list**, or `process.env` **one alias away**. A green run means no call site hardcodes in plain sight; it does **not** mean every call site obeys its area row — that is what the per-site boundary tests (`callParams.boundary.*.test.ts`) prove. **It is also not a required status check today**, so a red run does not block a merge. Review accordingly: read the call site, do not read the badge.
- **Operator side:** [BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md). Worth knowing while you code: the kill switch **fails open** — an instance that cannot read the settings treats every area as enabled.
- **Worked references:** `lib/business-os/briefing/BriefingNarrator.ts` (the smallest complete shape), `lib/services/GeneratedImageService.ts` (the price resolved inside the attempt, so cost follows the model that ran), `lib/business-os/bizql/planner/Planner.ts` (a retry plus a repair loop reporting the right model).

---

## Review checklist

- [ ] The call name exists in `BOS_LLM_CALLS`; the context is built with `buildBosCallContext` (or `toEmbeddingAttribution`)
- [ ] The account comes from the session, the job, or a DB lookup, never the request; `BosLlmOwner` is threaded through
- [ ] One grouping id per action, minted by the owning function, logged where minted, shared by every call
- [ ] The call goes through the provider layer (`callWithTracking`); no SDK call, no hand-written `trackAICall`, no hardcoded model or price
- [ ] No prompt, owner text or model output at info or above; the `SyntaxError` pattern on parse failures
- [ ] A new area: catalog entry + empty legacy list + usage category
- [ ] Tests: area / call name / account / group asserted; a sentinel shows raw text never logged
- [ ] The model and temperature come from `resolveBosLlmSettings`, inside `withModelFallback`; `enabled: false` makes no call; the default is in `modelSettingsPolicy.ts`
- [ ] `typecheck:bos-llm` 0 new, baseline unchanged; `check:bos-llm-literals` passes; the LLM Usage tab green; the usage snapshot unchanged
- [ ] The action is wrapped in `runAiAction` (one entry, never awaited); failures signalled with `markFailed`; no `'use client'` path imports it; `next build` passes

## Anti-patterns (probable bugs)

- **`getProviderFactory().complete(params)` with no context.** It is recorded as `userId: 'system'`, `onboarding` / `simple-complete`, and lands on the platform account.
- **A `userId` / `groupId` from the request body or `x-user-id`,** or a client `conversationId` used as the group.
- **`logger.info({ message }, …)`**, `{ prompt }`, `{ content }`, a raw error at error level on a JSON parse failure, or `console.*`.
- **`as never` / `as any` around a context or attribution** to silence the catalog's types. Fix the call name instead.
- **A fresh `newBosGroupId()` per call** instead of per action (one action becomes many groups).
- **`await AuditTrail.log(…)`** on a request path, or an audit entry per call.
- **A direct `openai.*` call "just for this one feature",** or a model name or price literal in feature code.
- **`model: 'gpt-4o'` or `temperature: 0.7` at a call site** — including the disguised forms `settings.temperature ?? 0.7`, `OPENAI_MODELS.GPT_4O_MINI`, and a request built OUTSIDE the `withModelFallback` callback so the retry re-sends the refused model.
- **A shared helper that imports the catalog.** Every file that imports the helper is then pulled into the `typecheck:bos-llm` gate with it. This is why `lib/platformAccount.ts` imports nothing: the catalog imports it, never the reverse (Layer 1.5 OQ-G).

## When NOT to use

The agents side (`lib/agentkit/**` including V6, `lib/pilot/**`, agent execution) has its own attribution (`agent_id` / `execution_id`) and audit events. Follow the V6 Work Protocol in CLAUDE.md there, not this skill. Non-Business OS helpers (`help`, the legacy `onboarding` feature value) are out of scope too.
