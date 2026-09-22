# Workplan: Business OS LLM — Logging Clean-ups (OI-4 to OI-8)

> **Last Updated**: 2026-09-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md): open items **OI-4, OI-5, OI-6, OI-7**, plus **OI-8**, which the user folded into OI-7 (**D-OI8**, §15.1). Decision **D-6**, NFR Logging
**Context:** [BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md). The per-file risk notes are in SA's Q-6 answer (§11). The privacy finding is QA observation O-2 (§12).
**Branch:** `feature/business-os-llm-layer1-5` (worktree `neuronforge-llm-layer15`, fast-forwarded to `origin/main` @ `816ef757`, with Layers 1, 1.1 and 1.5 merged)
**Date:** 2026-09-18
**Status:** **QA PASSED 2026-09-18** (§13). **SA re-check 2026-09-18 — APPROVED for QA** (§16.1). Previously: Code Complete — CR-1 to CR-4 applied (§15.7). SA code review 2026-09-18 approved steps 1, 3, 4a, 4b and 4c as they stand (§16). SA approved the workplan with WC-1 to WC-5 (§12); all five are applied. The implementation notes, per-step file lists and gate results are in §15. Nothing is committed: RM commits per step (§15.3).

## Overview

Layer 1.5 deliberately left three files logging through `console.*`. This was user decision D-6, so the attribution diff stayed reviewable. QA also found that onboarding writes the owner's raw chat text to the server logs (O-2). This workplan closes all four open items. It uses four small steps, one commit per open item, in rising order of risk. **Only logging changes.** No insert payload, validation, fallback, control flow or signature moves.

## Table of Contents

1. [Verified Inventory](#1-verified-inventory)
2. [Conventions Applied](#2-conventions-applied)
3. [Mapping Tables](#3-mapping-tables)
4. [Other Raw or Derived Owner Text in lib/services (listed, not fixed)](#4-other-raw-or-derived-owner-text-in-libservices-listed-not-fixed)
5. [Test Plan](#5-test-plan)
6. [Gates (after every step)](#6-gates-after-every-step)
7. [Steps and Commits](#7-steps-and-commits)
8. [Risks](#8-risks)
9. [Questions for SA](#9-questions-for-sa)
10. [Task List](#10-task-list)
11. [Closure](#11-closure)
12. [SA Review Notes](#12-sa-review-notes)
13. [QA Testing Report](#13-qa-testing-report)
14. [Commit Info](#14-commit-info)
15. [Implementation Notes](#15-implementation-notes)

---

## 1. Verified Inventory

Every line below was re-read on `816ef757`.

| File | Count | Lines | Differs from the requirement? |
|---|---|---|---|
| `lib/analytics/aiAnalytics.ts` | 16 `console.*` | `:98, :102, :130, :138, :187, :209, :210, :217, :218, :219, :236, :237, :247, :298, :324, :373` | **Yes, +1 on every line.** The one-line FR-18 import added a line above them. The requirement's M-3 list (`:97 … :372`) is from before that |
| `lib/orchestration/IntentClassifier.ts` | 16 `console.*` | `:60, :81, :90, :109, :115, :227, :410, :420, :446, :475, :614, :744, :807, :817, :854, :900` | No |
| `lib/ai/providers/openaiProvider.ts` | 4 `console.*` | `:114, :119, :403, :435` | **Yes.** Only `:114` and `:119` are in the `getInstance` guards. `:403` is `deleteThread` and `:435` is `createThreadWithSystemPrompt`, both thread-helper error branches. They are still outside the image path and any tracked call, so the risk stays low. SA's Q-6 note should be corrected |
| `lib/services/OnboardingConversationManager.ts` | 6 raw-`message` Pino calls | `:510` (call starts here; `message` is on `:511`), `:602, :704, :1124, :1425, :1430` | No. The line numbers match |
| `app/api/onboarding/chat/route.ts` | **1 raw-`message` Pino call** (not in OI-7's list) | `:208`, `requestLogger.info({ userId, currentStep, message: data.message }, 'Processing onboarding message')` at **info** | **Yes, a new finding.** It logs the same raw text on every turn, at a level that ships in production. It is folded into OI-7 because it is the same defect (see Q-3) |

**Logger resolution.** `@/lib/logger` resolves to `lib/logger.ts`, because a file wins over the `lib/logger/` directory. That logger has **no `redact` configuration**. The redaction list in `lib/logger/config.ts`, which `SYSTEM_LOGGING_GUIDELINES.md` § Sensitive Data Redaction describes, therefore does **not** apply. No conversion here may rely on redaction to hide anything. This is recorded for SA and is not fixed here.

**Gate scope.** `npm run typecheck:bos-llm -- --list` puts `OnboardingConversationManager.ts` (a catalog importer) and `app/api/onboarding/chat/route.ts` (a caller) in scope. `aiAnalytics.ts`, `IntentClassifier.ts` and `openaiProvider.ts` are **not** in scope. None of the five files has a baseline entry.

---

## 2. Conventions Applied

- **Logger per file:** `const logger = createLogger({ service: 'AIAnalyticsService' })`, `createLogger({ module: 'IntentClassifier' })` and `createLogger({ service: 'OpenAIProvider' })`. These follow `ProviderFactory` (`module`) and the service classes (`service`). The existing loggers in the OI-7 files stay as they are.
- **Shape:** `logger.level({ ...context }, 'message')`. Errors go in as `{ err }`. Keys are camelCase.
- **Levels:** `console.error` → `error` and `console.warn` → `warn`, one to one. **No level is raised.** A `console.log` becomes:
  - `debug` when it fires once per LLM call or once per step on a hot path;
  - `info` when it marks an operational event, meaning extra LLM spend, a batch summary or a cache reset.

  Production runs at `info` (`lib/logger.ts:16`), so every `debug` line goes quiet in production. That is intended: today those lines print on every LLM call.
- **Messages:** no emojis and no `[Prefix]` tags. The `module` / `service` binding replaces the prefix.
- **Content:** a converted call logs **the same fields as today or fewer**, with two named exceptions (WC-2). No conversion reads `request_payload`, `response_metadata`, `metadata`, `error_message`, a prompt, or owner text.
  - **Exception 1, the non-sensitive context keys** named in the tables below (for example `feature`, `threadId`, `fallbackThreshold`).
  - **Exception 2, `{ err }` detail (WC-2).** `openaiProvider.ts:403` and `:435` logged only `error.message`. They now log `{ err }`, which adds the stack and the OpenAI `APIError`'s own fields: `status`, request id, the error body and the **response** headers (including `openai-organization` / `openai-project`). `IntentClassifier.ts:410` logged no error at all and now logs `{ err }` (a Supabase config-read error). **SA accepted these:**
    - they are error paths only, and rare;
    - there are no credentials (the request headers, which carry the key, are not on the error);
    - the SDK does not echo prompts;
    - `{ err }` is the CLAUDE.md convention.

  So this diff is **not** strictly subtractive on those three lines.

---

## 3. Mapping Tables

### 3.1 OI-6: `lib/ai/providers/openaiProvider.ts` (4 → 4)

| Line | Current | New | Why this level and content |
|---|---|---|---|
| `:114` | `console.error('❌ Missing OpenAI API key')` | `logger.error('OpenAI API key not configured')` | Unchanged level. It is a configuration fault just before a throw. The key's value is never logged |
| `:119` | `console.error('❌ AI Analytics service not provided')` | `logger.error('AI analytics service not provided')` | Unchanged level, just before a throw |
| `:403` | `console.error(\`⚠️ Failed to delete thread ${threadId}:\`, error.message)` | `logger.error({ err: error, threadId }, 'Failed to delete thread')` | Unchanged level (see Q-5 on `warn`). `{ err }` adds the stack and the SDK error's own fields: status, request id and response headers. The response headers carry no credentials |
| `:435` | `console.error('❌ Failed to inject system prompt, cleaning up thread:', error.message)` | `logger.error({ err: error, threadId: thread.id }, 'Failed to inject system prompt; deleting the thread')` | Unchanged level. **`systemPrompt` is not logged.** The SDK error does not echo request content |

### 3.2 OI-7: raw owner text (7 calls, content only, no level change)

| File:line | Current | New | Why |
|---|---|---|---|
| Manager `:510` | `debug({ userId, groupId, currentStep, message }, 'Processing user message')` | `debug({ userId, groupId, currentStep, messageLength: message.length }, …)` | Keeps the owner, group and step context. The raw text is dropped |
| Manager `:602` | `info({ message }, 'Extracting business story from message')` | `info({ userId: owner.userId, groupId: owner.groupId, step: 'business_story', messageLength }, …)` | `owner` is in scope (`updateStateFromMessage`), so the line gains context and loses the text |
| Manager `:704` | `warn({ message }, 'Could not extract price from message')` | `warn({ userId, groupId, step: 'client_workflow', messageLength }, …)` | Same reason as `:602` |
| Manager `:1124` | `info({ message, result }, 'Extracted client acquisition from multi-select')` | `info({ result, messageLength }, …)` | `result` is derived from the chips: channel names and booleans. `extractClientAcquisition(message)` has no `owner`, and **its signature is not changed** |
| Manager `:1425` | `info({ message, extracted: parsed }, 'Extracted price from message')` | `info({ extracted: parsed, messageLength }, …)` | The number is the derived field. `extractPriceFromMessage` has no `owner`, and its signature is not changed |
| Manager `:1430` | `warn({ message }, 'Could not extract numeric price from message')` | `warn({ messageLength }, …)` | Same as `:1425` |
| Route `:208` | `requestLogger.info({ userId, currentStep, message: data.message }, 'Processing onboarding message')` | `requestLogger.info({ userId, currentStep, messageLength: data.message.length }, …)` | `correlationId` is already bound on `requestLogger` |
| **Manager `:595`** *(found during implementation, DV-1)* | `info({ companyName: name }, 'Business name given')` | `info({ userId, groupId, nameLength: name.length }, …)` | `name` **is** the raw message (`message.trim()`, "taken exactly as typed"). It is the eighth raw-text line; §4 had mislabelled it a derived fact |

As implemented, `:704` logs `step: 'service_details'`: the price question is asked in that step, not in `client_workflow`.

### 3.2a OI-8: derived owner text at debug only (D-OI8, folded into the OI-7 step)

Everything below is text the model derived from what the owner typed. It is kept for local debugging, but **only at `debug`**. Production runs at `info` (`lib/logger.ts:16`), so none of it reaches production logs. Where the line also marks an event worth seeing in production, that event stays at its level **without the text**, and the text moves to a separate `debug` line.

| File:line (at `816ef757`) | Before | After |
|---|---|---|
| Manager `:604` | `info({ businessStory }, 'Business story extracted')` | `debug(…)` |
| Manager `:859` *(DV-2: missed in §4)* | `info({ adjustment }, 'Adjustment intent extracted')`, where `adjustment.details` is the model's reading of the owner's request | `info({ intent }, …)` + `debug({ adjustment }, 'Adjustment intent extracted: details')` |
| Manager `:997` | `info({ extracted }, 'Extracted business story')` | `debug(…)` |
| Manager `:1043` | `info({ extracted }, 'Extracted client workflow')` | `debug(…)` |
| Manager `:1151` | `info({ extracted }, 'Extracted client tracking')` (unreachable, KI-D) | `debug(…)` |
| Manager `:1547, :1552, :1557` | `info({ details }, '… requested (not yet implemented)')` | `debug(…)` |
| Manager `:1561` | `info({ intent, details }, 'Unknown adjustment intent')` | `info({ intent, detailsLength }, …)` + `debug({ details }, 'Unknown adjustment intent: details')` |
| `OnboardingChatService.ts:179` | `error({ err: parseError, content }, 'Failed to parse LLM JSON response')` | `error({ errName, contentLength }, …)` + `debug({ err: parseError, content }, 'Unparseable LLM JSON response')`. See DV-3: a JSON `SyntaxError`'s **message quotes the start of the text** (`Unexpected token 'D', "DERIVED-MA"... is not valid JSON`), so even `{ err }` alone at error would leak it |

**Kept at their level:** `:697` (`price`, a number), `:778` (service names), `:813` (`clientAcquisition`: channel labels and booleans). These are structured facts, not free text. They are recorded for SA in §15.4.

### 3.3 OI-5: `lib/orchestration/IntentClassifier.ts` (16 → 16)

None of these calls logs prompt text today, and none will.

| Line | Current (abridged) | New | Level rationale |
|---|---|---|---|
| `:60` | `log('Cache hit for step classification')` | `debug('Cache hit for step classification')` | Once per step on the hot path |
| `:81` | `log('explicit input+prompt, classified as "generate"')` | `debug({ intent: 'generate', method: 'explicit' }, 'Step has explicit input and prompt; classified without intent analysis')` | Once per step |
| `:90` | `log(\`Quick classified as "${intent}" in ${elapsed}ms\`)` | `debug({ intent, confidence, elapsedMs, method: 'pattern' }, 'Step classified by pattern')` | Once per step |
| `:109` | `log(\`LLM classified as … confidence in ${elapsed}ms\`)` | `info({ intent, confidence, elapsedMs, method: 'llm' }, 'Step classified by LLM')` | **info**: an LLM call was spent, which is operational |
| `:115` | `error('Classification error:', error)` | `error({ err: error }, 'Classification failed; falling back to generate')` | Unchanged level |
| `:227` | `error('LLM classification failed:', error)` | `error({ err: error }, 'LLM classification failed; falling back to pattern check')` | Unchanged |
| `:410` | `warn('Could not fetch confidence threshold, using default 0.7')` | `warn({ err: error, fallbackThreshold: 0.7 }, 'Could not fetch confidence threshold; using the default')` | Unchanged. Adds the DB error, which is `undefined` when the result is simply empty |
| `:420` | `error('Error fetching confidence threshold:', error)` | `error({ err: error, fallbackThreshold: 0.7 }, 'Error fetching confidence threshold; using the default')` | Unchanged |
| `:446` | `log(\`Batch classified ${n} steps in …\`)` | `info({ stepCount, elapsedMs, avgMsPerStep }, 'Batch classified')` | **info**: once per batch |
| `:475` | `log('Cache cleared')` | `info('Classification cache cleared')` | **info**: a state change, and rare |
| `:614` | `error('Validation failed:', error)` | `error({ err: error }, 'Validation failed; returning the primary classification')` | Unchanged |
| `:744` | `error('Enhanced classification failed:', error)` | `error({ err: error }, 'Enhanced classification failed; falling back to LLM classification')` | Unchanged |
| `:807` | `warn(\`Ambiguous step … ${n} conflicting intents\`)` | `warn({ conflictingIntentCount }, 'Ambiguous step detected')` | Unchanged |
| `:817` | `log('Pattern match found but ambiguity detected, escalating to LLM')` | `info('Pattern match ambiguous; escalating to LLM')` | **info**: this escalation leads to an LLM call |
| `:854` | `log('Validation detected disagreement, escalating …')` | `info('Validation disagreed; escalating to enhanced classification')` | **info**: this escalation leads to an extra LLM call |
| `:900` | `error('Bulletproof classification failed:', error)` | `error({ err: error }, 'Bulletproof classification failed; falling back to generate')` | Unchanged |

### 3.4 OI-4: `lib/analytics/aiAnalytics.ts` (16 → 12)

*(The planned "16 → 13" was a miscount. The three merges below remove 4 calls, not 3: 16 − 1 − 2 − 1 = 12.)*

**Untouched:** the `insertData` literal (`:144-185`), `isValidUUID`, `platformAccountId()`, `finalUserId`, `validSessionId`, the `.insert(...).select(...)` call and every branch condition. The only other additions are the `createLogger` import and the `logger` constant.

| Line(s) | Current | New | Level and content rationale |
|---|---|---|---|
| `:98` | `warn('⚠️ No Supabase client available, skipping tracking')` | `logger.warn({ feature, component, model }, 'No Supabase client; AI call not tracked')` | Unchanged level. The added fields are labels, not payload |
| `:102` | `log('📊 Starting AI call tracking:', {user_id, feature, component, model, cost, activity_type})` | `logger.debug({ userId, feature, component, model, costUsd, activityType }, 'Tracking AI call')` | **debug**: fires on every LLM call in the product. Same fields |
| `:130` | `warn(\`⚠️ Invalid user_id format: "${user_id}", using SYSTEM_USER_ID\`)` | `logger.warn({ invalidUserId: callData.user_id }, 'Invalid user_id; recording against the platform account')` | Unchanged level and value (the value was already in the message) |
| `:138` | `warn(\`⚠️ Invalid session_id format: "${session_id}", setting to null\`)` | `logger.warn({ invalidSessionId: callData.session_id }, 'Invalid session_id; recording with no session')` | Unchanged |
| `:187` | `log('💾 Inserting to token_usage table:', {13 scalar fields})` | `logger.debug({ callId, userId, model, inputTokens, outputTokens, totalTokens, feature, component, activityType, agentId, executionId, costUsd, success }, 'Inserting token_usage row')` | **debug**: once per call. It reads **the same 13 scalars and nothing else**: no `request_payload`, no `metadata` |
| `:209` + `:210` | two `console.error`s: the DB error, then a sample of four fields | **4b:** **one** `logger.error({ err: error, userId, model, callId, inputTokens, outputTokens }, 'Failed to insert token_usage row')`. **4c (WC-1):** `err: { code, message, hint }`, which drops `details` | Unchanged level. Merged because `{ err }` plus the fields carries both. 4c exists because a Postgres `details` holds "Failing row contains (…)" (Q-2) |
| `:217` + `:218` + `:219` | three `console.log`s: "tracked", the raw `data` dump, a summary | **one** `logger.debug({ id, callId, feature, activityType, agentId, executionId, tokens: { input, output, total }, costUsd, createdAt }, 'AI call tracked')` | **debug**: once per call. `data` holds only the five columns in `.select(...)`, and all five are already in the summary, so merging loses nothing |
| `:236` + `:237` | two `console.error`s: the exception, then `{ name, message, stack.slice(0,500) }` | **one** `logger.error({ err: error }, 'AI call tracking threw; row not written')` | Unchanged level. The `err` serializer carries the name, message and full stack. This **removes 3 pre-existing TS18046 errors** (`:238-240`) — see §6 |
| `:247` | `warn('⚠️ No Supabase client available for analytics')` | `logger.warn('No Supabase client; returning the placeholder usage report')` | Unchanged |
| `:298` | `error('Error fetching usage analytics:', error)` | `logger.error({ err: error }, 'Failed to fetch usage analytics')` | Unchanged |
| `:324` | `warn(\`⚠️ hit the ${maxRows}-row ceiling …\`)` | `logger.warn({ maxRows, rowsFetched: rows.length }, 'Row ceiling reached; this report is understated. Aggregate in SQL instead')` | Unchanged |
| `:373` | `error('Error fetching agent analytics:', error)` | `logger.error({ err: error }, 'Failed to fetch agent analytics')` | Unchanged |

**Sensitive-content check:**
- No converted call starts logging a field it did not log before.
- No call moves to a higher level.
- The three `console.log` payloads now go to `debug`, so they are no longer printed in production.

---

## 4. Other Raw or Derived Owner Text in `lib/services` (listed, not fixed)

I searched every `logger` and `console` call in `lib/services/**`: shorthand fields, multi-line objects, template interpolation and `.slice` / `.substring` previews. **No other service logs raw owner chat text.** The calls below log text **derived** from it, meaning LLM paraphrases or free-text extraction fields. They are candidates for a follow-up if SA reads "extracted fields" narrowly (Q-4):

| File:line | Level | Field | What it holds |
|---|---|---|---|
| `OnboardingConversationManager.ts:604` | info | `{ businessStory }` | The whole extraction: `description`, `pain_points`, `goals` and `target_audience`. This is a **close paraphrase of the owner's own words** |
| `OnboardingConversationManager.ts:997` | info | `{ extracted }` | The same object from inside `extractBusinessStory`. It duplicates `:604` |
| `OnboardingConversationManager.ts:1043` | info | `{ extracted }` | Client-workflow extraction: service names, prices, booking and payment method |
| `OnboardingConversationManager.ts:1151` | info | `{ extracted }` | Client-tracking extraction. Unreachable (KI-D) |
| `OnboardingConversationManager.ts:1547, :1552, :1557, :1561` | info | `{ details }` | Adjustment details the LLM extracted from owner text |
| `OnboardingConversationManager.ts:595, :697, :778` | info | `companyName`, `price`, service names | Short business facts. Low sensitivity |
| `OnboardingChatService.ts:179` | error | `{ err, content }` | The **full LLM response** when JSON parsing fails. It is an extraction of the owner's bio |
| `StockImageService.ts:226` | warn | `{ query }` | A stock-library search query. Low sensitivity |

---

## 5. Test Plan

| ID | Step | Test | Proves |
|---|---|---|---|
| **T-1** | OI-6 | Existing `lib/ai/providers/__tests__/openaiProvider.image.test.ts`, which already mocks `@/lib/logger`, plus the static check (§6 G5) | No behaviour change; no `console.*` left |
| **T-2** | OI-7 | **New `describe` block, "owner text never reaches a logger".** It uses a capturing `createLogger` mock (`level` + `args`), like Layer 1.5's WC-4 test (`GeneratedImageService.attribution.test.ts:149-153`). It sends a sentinel message (`'OWNER-TEXT-7f3a <unique> 150'`) through `processUserMessage` in the `business_story` step, the price question (a parseable and an unparseable reply), and the client-acquisition multi-select. It asserts `JSON.stringify(logged)` never contains the sentinel, while `messageLength` **is** logged. The LLM mock returns fixed JSON that does not echo the input, so the test isolates the raw-message lines | No raw owner text in any manager log call, at any level |
| **T-3** | OI-7 | The same sentinel assertion in `app/api/onboarding/chat/__tests__/route.attribution.test.ts`, whose logger mock gains a capture | The route's `:208` line is clean |
| **T-4** | OI-5 | Existing `lib/orchestration/__tests__/IntentClassifier.test.ts`, plus G5. **Pre-existing failure on `main`:** 1 of its tests, "should cache confidence threshold", fails because `mockSupabase.from` call counts build up across tests. The gate is **the same single failure before and after**. It is not fixed here | No regression in classification. No `console.*` left |
| **T-5** | OI-4 (commit 4a) | **New characterization test `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts`, committed *before* the conversion.** No existing test covers the insert payload: the one real-tracker use in `GeneratedImageService.attribution.test.ts:252` only checks that nothing throws. The test uses a fake Supabase client that records the `insert(...)` argument, a fixed system time (fake timers) and a fixed `call_id`. It covers these cases, with the payload **snapshotted**: (a) full valid data with `metadata.execution_id`; (b) an invalid `user_id` with `SYSTEM_ADMIN_USER_ID` set, and again unset (all-zero id); (c) an invalid `session_id` (→ `null`); (d) no `call_id` (property matcher `/^call_\d+_/`); (e) an insert error resolves with no throw; (f) an insert that throws resolves; (g) no client means no insert | **The inserted row is byte-identical before and after** |
| **T-6** | OI-4 | In the same file, a sentinel placed in `request_payload`, `response_metadata`, `metadata` and `error_message`. The test asserts it appears in **neither** the `console` spies nor the mocked `createLogger` capture, on the success, DB-error and exception paths. This holds before the conversion (via `console`) and after it (via the logger) | The conversion did not start logging payloads |
| **T-7** | OI-4 | Existing `GeneratedImageService.attribution.test.ts` and `openaiProvider.image.test.ts`. After 4b, the tracker's failure log goes to the file's `logged` capture instead of `console`. Only `:288` searches `logged`, and it filters on `'No price'`, so nothing collides | The existing tests still pass |

**Scope note for T-2 and T-3:** any **new** test file that imports `OnboardingConversationManager` or the route becomes a gate "caller" and grows `typecheck:bos-llm` scope from 140 to 141. Putting T-2 and T-3 in the **existing** `*.attribution.test.ts` files keeps the scope at exactly 140. WC-4 set the precedent for this. This is Q-1.

---

## 6. Gates (after every step)

Baseline, measured on `816ef757` on 2026-09-18:

| Gate | Command | Baseline | Pass rule |
|---|---|---|---|
| **G1** `typecheck:bos-llm` | `npm run typecheck:bos-llm` | **140 files, 30 errors, 0 new, passed.** Baseline JSON blob `8cff995b` | Same file count, 0 new errors, and `git diff --exit-code scripts/typecheck-bos-llm.baseline.json` clean. Record the scope with `-- --list` before and after each step |
| **G2** full `tsc` | `npx tsc --noEmit`, counting `error TS` lines that do **not** start with `.next/` (a dev-server build is present: +4 `.next/types` errors) | **2,045** | Steps 1 to 3: **2,045**, with the same per-file distribution. **Step 4: 2,042.** Exactly the three `lib/analytics/aiAnalytics.ts(238-240) TS18046` errors disappear, and nothing else changes (Q-6) |
| **G3** NUL bytes | `for f in $(git diff --name-only HEAD~1); do [ "$(tr -cd '\000' < "$f" \| wc -c)" -eq 0 ] \|\| echo "NUL: $f"; done` | — | No output |
| **G4** usage-route snapshot | `npx jest app/api/business-os/usage/__tests__/route.test.ts` + `git diff --exit-code app/api/business-os/usage/__tests__/__snapshots__/` | 2 snapshots pass, file unedited | Unchanged and passing |
| **G5** no `console.*` | `grep -n "console\." <converted file>` | 16 / 16 / 4 | No matches, meaning grep exits 1. For OI-7: `grep -n -E "\{[^}]*\bmessage\b[,}]\|message: data\.message" OnboardingConversationManager.ts route.ts` finds no logger payload |
| **G6** Jest, touched area | `npx jest lib/ai/providers lib/orchestration lib/analytics lib/services/__tests__/OnboardingConversationManager.attribution.test.ts lib/services/__tests__/GeneratedImageService.attribution.test.ts app/api/onboarding app/api/business-os/usage` | 6 suites, 102 of 103 tests pass (the known IntentClassifier failure), 2 snapshots | Same, plus the new tests |
| **G7** diff shape | `git show --stat HEAD` | — | Only that step's files. Step 4b: **`lib/analytics/aiAnalytics.ts` only**, with every hunk a logging line or the import/constant |

---

## 7. Steps and Commits

These are in rising order of risk. Each commit is independently revertible, and RM makes the commits.

| Step | Open item | Files | Commit (Conventional) |
|---|---|---|---|
| 1 | OI-6 | `lib/ai/providers/openaiProvider.ts` | `refactor(ai): log OpenAIProvider through Pino (OI-6)` |
| 2 | OI-7 + OI-8 | `lib/services/OnboardingConversationManager.ts`, `app/api/onboarding/chat/route.ts`, `lib/services/OnboardingChatService.ts`, the two existing `*.attribution.test.ts` files, **new** `lib/services/__tests__/OnboardingChatService.logging.test.ts` | `fix(onboarding): never log the owner's raw text; derived text at debug only (OI-7, OI-8)` |
| 3 | OI-5 | `lib/orchestration/IntentClassifier.ts` | `refactor(orchestration): log IntentClassifier through Pino (OI-5)` |
| 4a | OI-4 | **new** `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` + its snapshot | `test(analytics): characterize trackAICall's inserted row (OI-4)` |
| 4b | OI-4 | `lib/analytics/aiAnalytics.ts` **only** | `refactor(analytics): log the AI tracker through Pino (OI-4)` |
| 4c | OI-4 (WC-1) | `lib/analytics/aiAnalytics.ts` (one call) + `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` (two cases) | `fix(analytics): never log a failed token_usage row's contents (OI-4)` |

**Why step 4 is two commits (Q-7):**
- The characterization snapshot is recorded against the **untouched** tracker.
- 4b then leaves the test and its `.snap` unedited, and it must pass them.
- That is the direct proof that the row is byte-identical, and it keeps 4b a single-file, purely mechanical diff, which is what SA asked for.

---

## 8. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | OI-4 accidentally changes the insert payload of every `token_usage` row | Low | T-5 snapshot committed first (4a); 4b is a single-file diff, reviewed hunk by hunk (G7); `insertData` literal not touched |
| R-2 | `{ err: error }` on the tracker's DB-error path now fully serializes a `PostgrestError`. A NOT NULL or CHECK violation's `details` contains `Failing row contains (…)`, i.e. the **whole row, including `request_payload` and `metadata`** | Medium, and **already true today** (`console.error(…, error)` prints the same object at the same level) | No escalation, same level and same data. Whether to narrow it to `{ code, message, hint }` is Q-2 |
| R-3 | Visibility loss in production: per-call tracker lines and per-step classifier lines move to `debug`, which production does not print | Certain, and intended | Failures stay at `warn` / `error`. LLM-spending classifier events are `info`. Anyone who needs the traces can set the level |
| R-4 | Merging `:236`+`:237` changes one edge case. Today, a `null` or `undefined` thrown value makes `error.name` throw *inside* the catch, so `trackAICall` rejects. After the change it resolves | Very low | This is the documented contract ("logs and swallows its own failures"). Covered by T-5 (f) |
| R-5 | IntentClassifier has thin test coverage (SA's medium risk) | Medium | Only log statements change. No control flow is touched. G6 covers what exists, and G7 checks the diff shape |
| R-6 | Adding a Pino import to a module bundled for the client or edge | None found | No `'use client'` or edge-runtime importer of the three modules. `lib/logger.ts` sets `browser.asObject` anyway. `lib/logger.ts` is not in the gate scope (SA Q-6) |
| R-7 | Redaction is not active on `@/lib/logger` (§1) | Pre-existing | Nothing here relies on it. Recorded for a follow-up |

---

## 9. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| **Q-1** | Put the OI-7 tests in the **existing** `*.attribution.test.ts` files (gate scope stays at 140), or in a new `*.logging.test.ts` (scope becomes 141, with no baseline change)? | Existing files. The brief says scope must not change, and WC-4 set the precedent |
| **Q-2** | OI-4 `:209`: log the Postgres error in full as `{ err }` (the standard, and exactly today's data), or narrow it to `{ err: { code, message, hint } }` so a constraint violation cannot dump the row (R-2)? | Narrow it. It is a one-line logging choice, and it stops the only path by which payloads reach the logs. It is mechanical in spirit, but it **is** a content change, so it needs your call |
| **Q-3** | Include `app/api/onboarding/chat/route.ts:208` (raw text at **info**) in the OI-7 commit? | Yes. It is the same defect, and it fires on every turn in production |
| **Q-4** | Do the derived-text lines in §4 (`:604` / `:997` `businessStory`, `OnboardingChatService.ts:179` `content`) count as "extracted fields" (allowed), or should they become a follow-up OI? | Record a new follow-up, OI-8. Keep OI-7 to raw text, as the brief scopes it |
| **Q-5** | `openaiProvider.ts:403` is a swallowed, non-breaking failure logged at `error`. Keep `error` (strictly mechanical) or use `warn`? | Keep `error`. This workplan changes no levels on error paths |
| **Q-6** | G2 will read **2,042**, not 2,045, after step 4, because the `:236`/`:237` merge removes three pre-existing TS18046 errors. Accept this as the expected delta? | Yes. It is a decrease on exactly the rewritten lines, and it is asserted by file and line |
| **Q-7** | Step 4 as two commits (4a test, 4b conversion), against "one commit per step"? | Yes, for the reason in §7 |
| **Q-8** | Correct your Q-6 note in the Layer 1.5 workplan: 2 of the 4 `openaiProvider.ts` calls are in thread helpers, not in `getInstance`. The risk rating is unchanged | Correction only |

---

## 10. Task List

- [x] **T0** SA reviews this workplan; answers Q-1 to Q-8 recorded in §12. Done by SA: approved with WC-1 to WC-5
- [x] **T1** Record the G1 `--list` and G2 per-file baseline to scratch (not committed). Done by Dev: 140 files; 2,045 errors across 387 files
- [x] **T2** Step 1 (OI-6): convert `openaiProvider.ts` per §3.1; run G1–G7. Done by Dev
- [x] **T3** Step 2 (OI-7 + OI-8): the T-2 / T-3 sentinel tests plus the OI-8 debug-only tests; then change the raw-text and derived-text lines per §3.2 / §3.2a; run G1–G7. Done by Dev: **8** raw-text lines (DV-1) and 12 derived-text lines. Each new test was **proven red** against the untouched file: manager 8 of 8 fail, route 1 of 1, `OnboardingChatService` 1 of 1
- [x] **T4** Step 3 (OI-5): convert `IntentClassifier.ts` per §3.3; run G1–G7 (same single pre-existing test failure). Done by Dev
- [x] **T5** Step 4a: write the T-5 / T-6 characterization test against the untouched tracker, with the snapshot; run G1–G7. Done by Dev: 14 tests, 7 snapshots (WC-4)
- [x] **T6** Step 4b: convert `aiAnalytics.ts` per §3.4; the T-5 snapshot and test file unedited and passing; G2 = 2,042 (Q-6); G7 = single file. Done by Dev: 4a's test and `.snap` are byte-identical (`cmp`), with 14 of 14 passing
- [x] **T6c** Step 4c (WC-1): narrow `:209` to `{ code, message, hint }` and add the `details`-sentinel case (plus R-4's null-throw case, DV-4); G2 = 2,042. Done by Dev: the details case fails on 4b and passes on 4c
- [ ] **T7** Hand to SA for code review, then QA
- [x] **T8** On completion: update the requirement, the investigation doc and `SYSTEM_LOGGING_GUIDELINES.md` (§11, WC-5). Done by Dev

---

## 11. Closure

This workplan closes **OI-4, OI-5, OI-6, OI-7 and OI-8** (OI-8 was folded in by the user, D-OI8). It opens two follow-ups, **OI-9** and **OI-10** (WC-5). Done by Dev on 2026-09-18:

- [x] [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md):
  - OI-4 to OI-8 marked **Resolved (code complete, pending SA code review, QA and commit)**, with this workplan as the reference;
  - OI-9 and OI-10 added as **Open**;
  - a Change History row. RM adds the commit refs.
- [x] [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md): a status note and a Change History row.
- [x] [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md) § Sensitive Data Redaction now says redaction is **not** active (OI-9), and that nothing sensitive may rely on it.
- [x] The Layer 1.5 workplan's Q-6 note was already corrected by SA (Q-8).

**The follow-ups:**
- **OI-9: redaction is never switched on.** `lib/logger.ts` shadows `lib/logger/index.ts` and `config.ts`, so no server logger applies the `redact` list. The fix changes every log line in the product and needs its own workplan. **It also carries D-OI8's assumption:** derived onboarding text is kept at `debug`, and stays out of production **only because production runs at `info`** (`lib/logger.ts:16`). If anyone lowers the production level, those lines would appear. That could happen by editing `:16`, or by adding the `LOG_LEVEL` override that `lib/logger/config.ts` has and `lib/logger.ts` does not. OI-9's workplan must keep that in view.
- **OI-10: the pre-existing `IntentClassifier.test.ts` failure** ("should cache confidence threshold": `mockSupabase.from` call counts leak across tests because nothing clears them).

---

## 12. SA Review Notes

**Reviewed by SA — 2026-09-18**
**Status:** ✅ **Approved to implement, conditional on WC-1 to WC-5.** No user decision blocks the work. Q-4 is ruled below, but the user should know what it leaves in the logs (see "For the user").

A careful plan. The inventory re-check caught real drift and two genuine privacy findings, and the step order and gates are right. I verified the following on `816ef757`:
- **Counts.** 16 / 16 / 4, and the `aiAnalytics.ts` lines are `:98 … :373`, i.e. +1.
- **`openaiProvider.ts`.** `:114` and `:119` are in `getInstance`; `:403` and `:435` are thread-helper error branches.
- **OI-7.** The six manager lines log `message`. The route's `:208` (now `:208-212`) logs `message: data.message` at **info**.
- **Surprise 3.** `lib/logger.ts` is a bare `pino({ level, browser })` with no `redact`. `lib/logger/config.ts` holds the redact list, but no server import resolves to it: `@/lib/logger` hits the file first, and only `@/lib/logger/client` is imported from that directory.
- **Surprise 4.** `IntentClassifier.test.ts` fails exactly 1 of 23 on main ("should cache confidence threshold").
- **Error serialization.** Pino 10's default `err` serializer still applies with no explicit serializers, so `{ err }` serializes as the plan assumes.

### Rulings

- **Q-1 — agreed.** Put the OI-7 tests in the existing `OnboardingConversationManager.attribution.test.ts` and `route.attribution.test.ts`. The scope stays at 140, and those files are already where attribution-adjacent behaviour of these two modules is pinned.
- **Q-2 — narrow it, and I'm ruling it rather than sending it to the user.** It only removes data from the logs, and the cost is limited to debugging a rare constraint failure, where `code` and `message` are enough to act on. But it is a **content** change, so it must not ride inside the "purely mechanical" 4b (WC-1). Log `{ err: { code, message, hint } }`, and drop `details`, which is where Postgres puts "Failing row contains (…)". I also checked `hint`: it carries no row data on constraint violations.
- **Q-3 — agreed.** Fold the route's `:208` into OI-7. It is the same defect at a higher level (info, which ships in production, on every turn), so it is the most important line in the commit.
- **Q-4 — OI-8 as a follow-up.** OI-7 stays scoped to raw text, which is what QA's O-2 found and what this commit can prove with a sentinel test. Derived text needs a different kind of test (the extraction object, not the message), and it touches `OnboardingChatService.ts`, a file outside this workplan. Two conditions:
  - Record OI-8 **with priority**, not as backlog. The derived lines are paraphrases of what the owner typed. `:604` and `:997` are at **info**; `OnboardingChatService.ts:179` logs the whole LLM response at **error**. Both levels ship in production.
  - OI-8's fix shape: log sizes, keys and counts, and never the extraction's free-text fields.
- **Q-5 — keep `error`.** Level changes on error paths are out of scope for a mechanical conversion. An undeleted thread is a resource leak, so it is arguably an error anyway.
- **Q-6 — agreed: 2,042 is the expected G2 after step 4b.** The three TS18046 errors must disappear from exactly `aiAnalytics.ts(238-240)`, and the rest of the per-file distribution must match. Any other movement fails G2. (If WC-1 adds a step 4c, 4c must also read 2,042.)
- **Q-7 — agreed**, and extended by WC-1. 4a is the characterization test against the untouched tracker. 4b is the mechanical conversion and must pass that test unedited. The Q-2 narrowing becomes its own **4c**.
- **Q-8 — done.** I added a correction under my Q-6 note in the Layer 1.5 workplan (§11): two of the four calls are thread helpers, not `getInstance`. The **low** rating stands.

### Level mapping and content review

- **Levels.** No line becomes more visible than today. `console.*` printed unconditionally in production, so:
  - every `log` → `debug` is quieter;
  - `log` → `info` keeps the same visibility, and is used only where an LLM call is spent or a batch/cache event happens;
  - every `warn` and `error` is unchanged.

  The choices in §3.3 and §3.4 are right line by line. The IntentClassifier `info` lines fire only on LLM-spending or escalation paths, never per step.
- **Content.** §2's rule, "a converted call logs the same fields as today or fewer", is **not true** of two lines, and the plan should say so (WC-2):
  - `openaiProvider.ts:403` and `:435` today log only `error.message`. `{ err }` adds the stack and the OpenAI `APIError`'s own fields: `status`, `request_id`, the error body and the **response** headers, which include `openai-organization` / `openai-project`.
  - None of that is a credential (request headers, which carry the key, are not on the error), and the SDK does not echo prompts. So I accept `{ err }` here, as the CLAUDE.md convention.
  - `IntentClassifier.ts:410` gains `err` too; a Supabase config-read error carries no user data. Accepted.
  - Everything else in §3 logs the same data or less. On the tracker's error path, R-2 is real and pre-existing, and WC-1 closes it.
- **OI-4 stays mechanical.**
  - §3.4 leaves the `insertData` literal, `isValidUUID`, `platformAccountId()`, `finalUserId`, `validSessionId`, the `.insert().select()` and every branch condition alone.
  - R-4 (a `null` throw no longer re-throws out of the catch) is a behaviour change, but it is the documented "never throws" contract, and T-5(f) pins it. Accepted.

### Required changes (WC-n)

1. **WC-1 (Q-2, Q-7, §7) — make the narrowing its own step, 4c, with its own test.**
   - 4b converts `:209` mechanically, as `{ err: error, … }`, which is today's data.
   - 4c changes that one call to `{ err: { code, message, hint }, … }` and adds a T-6 case where the fake Postgres error's `details` contains the sentinel (as a real "Failing row contains (…)" would).
   - That case **cannot** live in 4a: today's `console.error(…, error)` prints `details`, so it would fail against the untouched tracker. Putting it in 4b would break "4b passes 4a's tests unedited" and "4b is a single-file mechanical diff".
   - 4c's commit is `fix(analytics): never log a failed token_usage row's contents (OI-4)`. Its G7 is `aiAnalytics.ts` plus the test file only.
2. **WC-2 (§2, §3.1) — correct the "same fields or fewer" claim.** State the two exceptions (`openaiProvider.ts:403`/`:435`, `IntentClassifier.ts:410`), what `{ err }` adds, and why it is accepted (error paths only, rare, no credentials, the CLAUDE.md `{ err }` convention). A reviewer reading §2 today would believe the diff is strictly subtractive, and it is not.
3. **WC-3 (T-2) — cover every raw-text line with the sentinel, by path.** The plan names the business-story step, the price question (parseable and not) and the multi-select. Map each of the seven lines to the test case that exercises it, including `:510` (every path) and `:704`. Assert that `messageLength` is logged on each. Also assert that the **LLM mock's response** does not contain the sentinel: that is what makes the test prove "raw text" rather than "whatever the mock returns". A line that no test case reaches is not proven.
4. **WC-4 (T-5) — pin the snapshot's determinism.**
   - Freeze `Date` (it feeds `metadata.timestamp`) and `Math.random`, or use property matchers for `call_id` *and* `metadata.timestamp`.
   - Set and restore `SYSTEM_ADMIN_USER_ID` per case.
   - Assert that the fake client received **exactly one** `insert` call and the unchanged `.select(...)` column string.

   A snapshot that passes by accident (e.g. a matcher on the whole `metadata`) would make 4b's "byte-identical" claim hollow.
5. **WC-5 (§11) — record two follow-ups with this closure, not only OI-8.**
   - **OI-9: redaction is not active.** `SYSTEM_LOGGING_GUIDELINES.md` § Sensitive Data Redaction describes protection that no server logger applies, because `lib/logger.ts` shadows `lib/logger/index.ts` and `config.ts`. The fix changes every log line in the product, so it needs its own workplan and review. Until then, the guidelines doc must stop claiming the protection exists (a one-line correction the BA or Dev can make with this closure).
   - **OI-10: the pre-existing `IntentClassifier.test.ts` failure** ("should cache confidence threshold", mock call counts leaking across tests). It is not fixed here, but it should not become permanent background noise.

### Gates

G1–G7 are right, with baselines measured on `816ef757` and exact pass rules. Two additions:
- **G2 runs after 4c as well.**
- **G5's OI-7 regex misses multi-line objects.** Keep it as a quick check, but the sentinel tests (T-2, T-3) are the binding proof, and G5 should say so.

### CLAUDE.md / `SYSTEM_LOGGING_GUIDELINES.md` compliance

The conventions in §2 comply:
- `createLogger` per file, with `module` / `service`;
- structured context first;
- `{ err }` for errors;
- no emojis or prefixes;
- `debug`/`info` split by frequency and operational meaning.

The redaction section of the guidelines is itself wrong today (WC-5, OI-9). No step here relies on it, and the plan says so explicitly (§1, R-7).

### Approval

- [x] Workplan approved. Implement in the order 1 → 2 → 3 → 4a → 4b → 4c, applying WC-1 to WC-5.
- [x] Q-8 correction made in the Layer 1.5 workplan §11.

## 13. QA Testing Report

**QA — 2026-09-18** (short QA, as requested)
**Test mode:** smoke+ (all gates once, plus one live conversation)
**Strategy used:** A/B (the touched Jest set) and C (a live test script driving `OnboardingConversationManager` directly, with real Pino output)
**Focus:** logging privacy (OI-7/OI-8), OI-4 tracker behaviour
**Skipped:** E2E and the chat route over HTTP. The route's `:208` line is covered by T-3.
**Input source:** prompt keywords

### Automated results

| Check | Result |
|---|---|
| Touched Jest set (G6, `--ci`: 9 suites, i.e. G6 paths + `OnboardingChatService.logging.test.ts`, excluding `TokenBudget*`) | ✅ **145 of 146 pass**, 9 snapshots pass. The only failure is the known OI-10 test, `IntentClassifier › Confidence Threshold › should cache confidence threshold`. *(The plain §6 G6 command also selects `TokenBudgetManager.test.ts` (OI-11) and `TokenBudgetPredictor.test.ts`, which passes 23 of 23; neither is in the 146.)* |
| `npm run typecheck:bos-llm` | ✅ 140 files, 30 errors, 0 new, passed. `git diff --exit-code scripts/typecheck-bos-llm.baseline.json` is clean |
| Full `tsc --noEmit`, excluding `.next/` | ✅ **2,042** |
| NUL bytes (all 12 modified + 3 untracked files) | ✅ 0 |
| `console.*` in `openaiProvider.ts` / `IntentClassifier.ts` / `aiAnalytics.ts` | ✅ 0 / 0 / 0 |
| Usage-route snapshot directory | ✅ untouched |

### Live onboarding conversation: log checks

**Setup.** One conversation for test account `2f734ed5-…-bea3` (group `a91e7d95-8c39-4316-99d8-87c47cf71164`). It used a throwaway in-memory state and wrote no onboarding data: the manager itself does no DB writes. It had 7 turns: language → business name → business story (LLM) → "Services with fixed prices" chip (LLM) → service names (LLM) → price "175 ILS each, note …" (parsed) → "No, that's all" → `client_acquisition`. The three LLM calls were the only live AI calls.

**Sentinels:** name `QASENTNAMEKVRQ`, description `QASENTDESCMXWB`, services `QASENTSVCAHJPL` / `QASENTSVCBYTDN`, price `QASENTPRICEWGZ`. None contains a digit or `0` (the price-parser bug).

**How the logs were captured.** The app's own `lib/logger.ts` base logger was captured through a `pino.multistream`, with one destination at `info` and one at `debug`. Product code was not changed; pino was wrapped at load time in the script only. A separate check confirmed that `NODE_ENV=production` gives `level: 'info'` with debug disabled, and development gives `debug`. No other file on this path reads `NODE_ENV`. The `info` stream is therefore exactly what production would emit.

| Level | What was searched for | Result |
|---|---|---|
| **(a) info (production)**: 9 lines, all level 30 | All 5 sentinels; raw-message phrases (`Pawsome`, `studio in Haifa, tag`, `175 ILS each`, `each takes about an hour`, `No, that`); AI summary text (`A small dog grooming studio`, `gentle care`, `pet owners`, `client_tracking`, `full bath`, `breed trim`) | ✅ **None found.** The lines carry only ids, `nameLength`, `messageLength`, `pricingModel: fixed`, `servicesMissingPriceCount: 2`, `extracted/price: 175` and counts |
| **(b) debug (development)**: 31 lines (22 debug) | The same terms | ✅ **The AI summaries are present, at debug only:** `Extracted business story`, `Business story extracted` (the model's `description`, logged before the owner's own words overwrite it) and `Extracted client workflow`. ✅ **No raw-message phrase and no raw-message field** (`message`, `content`, `text`, `companyName`) at any level. ✅ **The name and price sentinels appear nowhere**; neither is ever sent to the model |

**Observation (not a bug, D-OI8 as designed).** At debug, the description and service sentinels do appear, but **only inside model-returned fields**. The model copied `QASENTDESCMXWB` into `company_name` and kept the service names verbatim in `services[].name`. So "derived" text at debug can be near-verbatim owner text. D-OI8 accepts this because it stays at debug. The OI-9 assumption (production stays at `info`) is what keeps it out of production.

### Ledger check (`trackAICall`, read-only)

`token_usage` where `user_id` is the test account and `session_id` is the group: **3 rows, one per LLM call**. They are `business_story_extraction` (865/106 tokens, $0.003222), `client_workflow_extraction` (2047/54, $0.005658) and `client_workflow_extraction` (2073/193, $0.007113). All three have feature `business-os-onboarding`, provider `openai`, `success: true` and the correct user and session. Their ids match the debug `AI call tracked` lines, and no tracker warn or error was logged. ✅ Rows are written normally.

### Bugs

None in this change.

Already known and still open, not caused by this change:
- OI-10 (IntentClassifier test);
- OI-11 (TokenBudgetManager tests);
- the price parser's `'0'` substring bug (§16).

### Final Status

- [x] All checks pass — **QA PASSED, ready for commit** (RM split per §15.3)
- [ ] Issues found

## 14. Commit Info

*(RM to populate.)*

---

## 15. Implementation Notes

### 15.1 User decision D-OI8 (2026-09-18)

**Derived owner text is kept at `debug` only, never at `info` or above.** This covers the model's extractions of what the owner typed (the business story, the client workflow, the adjustment details) and `OnboardingChatService`'s unparseable model response.

- **Why:** `lib/logger.ts:16` sets the level to `'info'` in production and `'debug'` otherwise. These lines therefore appear in local development, where the user wants them for debugging, and never in production.
- **Raw typed text is different.** It is removed at **every** level (OI-7).
- **The assumption:** this holds only while production stays at `info`. It is recorded under OI-9 (§11).
- **Folded into step 2** as OI-7 + OI-8.

### 15.2 SA's required changes

| WC | How it was applied |
|---|---|
| WC-1 | Step **4c**. 4b logs `{ err: error, … }`, which is today's data. 4c narrows that one call to `err: { code, message, hint }`. 4c's new test case gives the fake Postgres error a `details` of `Failing row contains (<sentinel> …)`. It **fails on 4b and passes on 4c**, and it also asserts that `23502` and the message are still logged |
| WC-2 | §2 now names the three `{ err }` exceptions and says why they are accepted |
| WC-3 | The per-line map is in the test's header comment (`OnboardingConversationManager.attribution.test.ts`) and in §15.5. Every raw-text line is reached by a named case. Each case asserts `messageLength` (or `nameLength`) is logged. An `afterEach` asserts that **no model response** contains the sentinel, that no log line contains it, and that no non-debug line contains the derived marker. The mock serializes each log call's fields **at call time**, as Pino does, because the manager mutates `businessStory` after logging it |
| WC-4 | Frozen clock (`jest.useFakeTimers` + `setSystemTime`), fixed `Math.random`, **no property matchers**. `SYSTEM_ADMIN_USER_ID` is saved, cleared and restored per test. Every row case asserts **exactly one** insert, the table `token_usage` and the unchanged `.select(...)` column string. Because Jest snapshots sort keys, case (a) also snapshots `JSON.stringify(row)`, which pins the row's **key order** |
| WC-5 | OI-9 and OI-10 recorded (§11, requirement, investigation doc). The guidelines doc was corrected |

### 15.3 Files per step (for RM: one commit each)

Nothing is committed. Each step's files are distinct, **except two overlaps** that RM must split by hunk (`git add -p`):

| Step | Files | Notes |
|---|---|---|
| 1 (OI-6) | `lib/ai/providers/openaiProvider.ts` | — |
| 2 (OI-7 + OI-8) | `lib/services/OnboardingConversationManager.ts`, `lib/services/OnboardingChatService.ts`, `app/api/onboarding/chat/route.ts`, `lib/services/__tests__/OnboardingConversationManager.attribution.test.ts`, `app/api/onboarding/chat/__tests__/route.attribution.test.ts`, **new** `lib/services/__tests__/OnboardingChatService.logging.test.ts` | — |
| 3 (OI-5) | `lib/orchestration/IntentClassifier.ts` | — |
| 4a | **new** `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` **without** its two 4c cases; **new** `lib/analytics/__tests__/__snapshots__/aiAnalytics.trackAICall.test.ts.snap` | **Overlap 1:** the test file's two cases "on a constraint violation whose details hold the failing row" and "a thrown null is swallowed too" belong to 4c. The `.snap` is identical in 4a and 4c |
| 4b | `lib/analytics/aiAnalytics.ts` **without** the 4c hunk | **Overlap 2:** the one hunk at the `logger.error` in the insert's error branch, i.e. the 3-line comment plus `err: { code: error.code, message: error.message, hint: error.hint }` (4b has `err: error`), belongs to 4c |
| 4c | the 4c hunk of `aiAnalytics.ts` + the two 4c test cases | — |
| docs | this workplan, `docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md`, `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md`, `docs/SYSTEM_LOGGING_GUIDELINES.md` | A `docs:` commit, or folded into the last step |

### 15.4 Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| DV-1 | An **eighth raw-text line**, `OnboardingConversationManager.ts:595`. `companyName` is `message.trim()`, the whole message, logged at info. It is now `nameLength` | Found while mapping the tests; §4 had mislabelled it a derived fact |
| DV-2 | `:859` `info({ adjustment })` (not in §4) is now split: `intent` at info, the whole object at debug | Its `details` is derived owner text (D-OI8) |
| DV-3 | `OnboardingChatService.ts:179` does **not** keep `{ err }` at error. It logs `errName` + `contentLength` at error, and `{ err, content }` at debug | A JSON `SyntaxError`'s message quotes the start of the text it failed on (verified in Node 22: ``Unexpected token 'D', "DERIVED-MA"... is not valid JSON``), so `{ err }` at error would leak derived text |
| DV-4 | R-4's thrown-null case is pinned in **4c**, not in T-5(f) in 4a | On the untouched tracker a thrown null **rejects** (the catch reads `error.name`), so 4a cannot assert "resolves". After 4b it resolves. Putting the case in 4b would break "4b leaves 4a's tests unedited" |
| DV-5 | `aiAnalytics.ts`: 16 → **12** logger calls, not 13 | The planned count was an arithmetic slip; the mapping itself is unchanged |
| DV-6 | T-2's sentinel has no digit, and the parseable-price case uses `175` | See the price-parser finding in §15.6 |

### 15.5 Test and gate results

**Raw-text lines and the cases that reach them (WC-3):**

| Line (at `816ef757`) | Case |
|---|---|
| `:510` Processing user message | every case (`afterEach`) |
| `:595` Business name given | business_name |
| `:602` Extracting business story | business_story |
| `:704` Could not extract price | an unparseable price |
| `:1124` Extracted client acquisition | client_acquisition |
| `:1425` Extracted price | a parseable price |
| `:1430` Could not extract numeric price | an unparseable price |
| route `:208` Processing onboarding message | route: a new and a resumed conversation |

**Gates after each step:**

| Step | G1 `typecheck:bos-llm` | G2 full `tsc` (excl. `.next/`) | G3 NUL | G4 usage snapshot | Step tests |
|---|---|---|---|---|---|
| 1 | 140 files, 30 errors, 0 new; scope and baseline identical | 2,045, per-file distribution identical | 0 | 2 pass, file untouched | provider + image suites: 39 of 39 |
| 2 | same | 2,045, identical | 0 | same | onboarding: 32 of 32. New tests red on the old code: 8 of 8, 1 of 1, 1 of 1 |
| 3 | same | 2,045, identical | 0 | same | `IntentClassifier.test.ts`: 22 of 23; the one failure is the pre-existing OI-10 |
| 4a | same | 2,045, identical | 0 | same | 14 of 14, 7 snapshots written, then passing under `--ci` |
| 4b | same | **2,042**: only `aiAnalytics.ts` changes (9 → 6), exactly the three TS18046 at `:238-240` | 0 | same | 4a's files unedited (`cmp`): 14 of 14, 7 snapshots |
| 4c | same | **2,042**, same as 4b | 0 | same | 16 of 16; the `details` case fails on 4b |

**Final G5:** `console.*` count is 0 in all three converted files. The OI-7 regex finds no logger payload (a quick check only; the sentinel tests are the binding proof).

**Final G6** (every suite that imports a touched module, plus the usage route): 9 suites, 138 tests, 137 pass, 9 snapshots. The one failure is OI-10.

### 15.6 For SA

1. **Derived text still reaches `error` through `{ err }` on the manager's extractor failures.** The catch blocks at original `:1013`, `:1053`, `:1163` and `:1457` log `{ err: error }`. If the model returns non-JSON, that `SyntaxError` quotes about the first 10 characters of the model's output. I left them as they are: they are outside the listed lines, and narrowing them loses the provider-error detail they exist for. **Suggest folding this into OI-9, or a small follow-up.**
2. **A pre-existing functional bug, not a logging one.** `extractPriceFromMessage` treats a reply as "free" when it merely **contains** `'0'` (`freePatterns` includes `'0'`, and the check uses `.includes`). So "100", "150" and "₪250" all record a price of **0**. Not fixed here. It needs its own `fix/` item, and the user should hear about it.
3. **Kept at info as structured facts:** `:697` (price), `:778` (service names), `:813` (acquisition channels and booleans). Tell us if you read service names as owner text.
4. **Unrelated pre-existing failures** in `lib/orchestration/__tests__/TokenBudgetManager.test.ts`: 17 of 21 fail on the untouched code too. They do not import `IntentClassifier` and are not counted in G6. *(Recorded as **OI-11** per SA ruling (c).)*

### 15.7 SA code-review fixes (CR-1 to CR-4), 2026-09-18

All four are in step 2's files plus one doc, so the RM split (§15.3) is unchanged. They go in step 2's commit, and the guidelines doc goes with the docs.

| CR | Hunk | Test (in the existing `OnboardingConversationManager.attribution.test.ts`; gate scope stays 140) |
|---|---|---|
| CR-1 ✅ | `OnboardingConversationManager.ts` "Services missing price": `servicesMissingPrice.map(s => s.name)` → `servicesMissingPriceCount`. The names are not moved to debug; they are raw text | Two form-submitted services whose names carry the sentinel: the line is exactly `{ servicesMissingPriceCount: 2 }` at info, and the sentinel appears at **no** level |
| CR-2 ✅ | A module helper `logExtractionFailure(error, message)` replaces `logger.error({ err: error }, …)` in the four extractor catch blocks (originally `:1013, :1053, :1163, :1457`, now the four `… extraction failed` lines). A `SyntaxError` logs `{ errName }` at error and `{ err }` at debug (`…: parse error detail`). Any other error keeps `{ err }` at error. The response length is not in scope inside the catch, so only the name is logged | Non-JSON model output carrying the derived marker, for business story, client workflow and adjustment intent through `processUserMessage`, and client tracking directly (KI-D): the error line is exactly `{ errName: 'SyntaxError' }`, the detail line is at debug and holds the quoted text. The same three with a provider `Error`: full `{ err }` still at error. The log mock now serializes errors to `{ name, message }`, as Pino does, because plain JSON reduced them to `{}` and would have hidden a leak |
| CR-3 ✅ | A module constant `KNOWN_ADJUSTMENT_INTENTS` (the seven intents `PREVIEW_ADJUSTMENT_PROMPT` allows) and a helper `intentFields(intent)`, which gives `{ intent }` for a known label and `{ intentLength }` otherwise. Used at "Adjustment intent extracted" and "Unknown adjustment intent". The value itself is at debug | A known label (`modify_services`) is logged as `{ intent }` at info. A model-invented intent carrying the derived marker gives `{ intentLength }` on both info lines, no `intent` key, and the value only on the debug line |
| CR-4 ✅ | `docs/SYSTEM_LOGGING_GUIDELINES.md`: `Last Updated` header, a TOC entry, a Change History section with the row "Redaction marked not active (OI-9); owner-text rule added", and the owner-text rule written into the redaction warning | — |
| OI-11 ✅ | Recorded beside OI-10 in the requirement's open items and in the investigation doc | — |

**Red first:** against the pre-CR manager, 6 of the 9 new cases fail. They are CR-1, CR-3, the three `SyntaxError` cases and client tracking. The three provider-error cases pass both before and after, as they should, because that behaviour is unchanged.

**Gates after the CRs:**

| Gate | Result |
|---|---|
| `typecheck:bos-llm` | 140 files, 30 errors, 0 new, passed. Scope list identical; baseline JSON untouched |
| Full `tsc` (excl. `.next/`) | 2,042, the same per-file distribution as after 4b |
| Manager test file | 33 of 33 |
| Touched Jest set (G6, `--ci`) | 9 suites, 146 tests: 145 pass, 9 snapshots. The one failure is OI-10 |
| NUL bytes | 0 |
| Usage-route snapshot | 2 pass, file untouched |

---

## 16. SA Code Review

**Code Review by SA — 2026-09-18**
**Status:** 🔄 **Fix Required: CR-1 (Medium), CR-2 to CR-4 (Low).** All four are small and sit in step 2's files plus one doc. **Steps 1, 3, 4a, 4b and 4c are approved as they stand**, and the RM split is unaffected. SA re-checks only the CR hunks.

The mechanical steps are exactly mechanical, the 4a → 4b proof is real, and the privacy tests are built the right way: a sentinel, the model proven not to echo it, and fields captured at call time. The CRs apply the user's own D-OI8 rule to the last few lines it reaches.

### Gates, re-run by SA

| Gate | Result |
|---|---|
| `typecheck:bos-llm` | **140 files, 30 errors, 0 new, passed.** Baseline unchanged |
| Jest, G6 set, `--ci` | **9 suites, 138 tests: 137 pass, 9 snapshots.** The one failure is OI-10 ("should cache confidence threshold") |
| `console.*` in the three converted files | **0 / 0 / 0** |
| Usage-route snapshot | Untouched |
| 4b vs 4a | Diffing the saved `step4b/aiAnalytics.ts` against the current file gives **exactly the 4c hunk**: the 3-line comment, and `err: error` → `err: { code, message, hint }`. The saved 4a test differs from the current one **only** by the two appended 4c cases. The saved 4a `.snap` is **byte-identical** to the current one (`cmp`) |
| Snapshot determinism (WC-4) | Fake timers with `setSystemTime`, a fixed `Math.random`, **no property matchers**, the env saved and restored per case, and `JSON.stringify(row)` pinning key order. It passes under `--ci`, so nothing was written |

Full `tsc` (2,045 → 2,042) was not re-run. The Dev's per-file evidence is consistent with Q-6, and the binding gate is green.

### Findings by focus area

1. **Privacy.**
   - Raw text is gone from every listed line, plus DV-1's `:595`, where the business name is the whole message. The route logs `messageLength`.
   - Derived text now appears at **debug only**: `businessStory`, the three extractions, the adjustment `details`, and `OnboardingChatService`'s `content`.
   - **DV-3 is correct, and it is the pattern to reuse.** A JSON `SyntaxError`'s message quotes the text it failed on, so the error line carries `errName` + `contentLength` and the detail goes to debug.
   - Three places still leak: CR-1 to CR-3.
2. **OI-4 is purely mechanical in 4b.**
   - The 4b diff touches only logger calls, the import and the `logger` constant.
   - The `insertData` literal, `isValidUUID`, `platformAccountId()`, `finalUserId`, `validSessionId`, the `.insert().select()` and every branch condition are unchanged.
   - The 4a snapshot passes unedited against 4b.
   - 4c touches only the insert's failure-path log. Its test proves `details` ("Failing row contains …") is gone while `23502` and the message remain.
   - **DV-4 is right.** On the untouched tracker, a thrown `null` makes the catch itself throw. The case can therefore be pinned only once the catch stops reading `error.name`, and 4c keeps "4b passes 4a unedited" intact.
3. **Levels and WC-2.**
   - Every mapping follows §3. No line became more visible: `log` → `debug` is quieter; `log` → `info` appears only on LLM-spend, batch or cache events; `warn` and `error` are unchanged.
   - The three accepted `{ err }` additions (`openaiProvider.ts:403`/`:435`, `IntentClassifier.ts:410`) are as documented in §2.
   - DV-2 (splitting `adjustment`) and DV-5 (12 calls, not 13) are accepted.
4. **Docs.**
   - The requirement's OI-4 to OI-8 rows read "Resolved 2026-09-18: code complete, pending SA code review, QA and commit".
   - OI-9's row records the D-OI8 assumption: derived text stays out of production only while production stays at `info`.
   - OI-10 is open.
   - `SYSTEM_LOGGING_GUIDELINES.md` opens its redaction section with an explicit "not active today" warning. Correct and clear; see CR-4 for its metadata.
5. **RM split — feasible.**
   - Both overlaps are single contiguous hunks: one in `aiAnalytics.ts`, and the two 4c cases appended at the end of their `describe`.
   - `git add -p` separates them, and the scratchpad copies are a reference to diff against.
   - The CR fixes touch only step 2's files and one doc.

### Rulings on §15.6

- **(a) Extractor catch blocks** — `OnboardingConversationManager.ts` `:1026`, `:1066`, `:1176`, `:1470` on the current tree (originally `:1013`, `:1053`, `:1163`, `:1457`). **Narrow them now (CR-2).**
  - They are in step 2's file, and DV-3 already set the shape.
  - D-OI8 says derived text goes to debug only, and a `SyntaxError`'s message *is* derived text, even at ~10 characters.
  - Narrowing loses nothing the Dev wants to keep: only a `SyntaxError` loses its message at error, and provider errors keep the full `{ err }`.
- **(b) Price, service names, channels at info.**
  - Price (`:704`, a number), collection method (`:813`, a label) and the acquisition result (`:823`, `:1137`, derived deterministically from chip labels) are **structured facts**. They are fine at info.
  - **Service names are not.** From the services form they are the owner's verbatim typing; from the model they are a paraphrase. So `:788` is out: **CR-1**.
- **(c) `TokenBudgetManager.test.ts` — confirmed unrelated.**
  - It fails **17 of 21** on this tree.
  - Neither the test nor `TokenBudgetManager.ts`, `TokenBudgetPredictor.ts` or `types.ts` imports any changed file, and none of them is in the diff.
  - Record it as **OI-11** beside OI-10 (pre-existing test failures on `main`).

### Code Review Comments

1. **CR-1 — `OnboardingConversationManager.ts:788` — Priority: Medium.**
   - `logger.info({ servicesMissingPrice: servicesMissingPrice.map(s => s.name) }, …)` logs service names at info, which reaches production. With the services form, these are verbatim owner input, which D-OI8 removes at every level.
   - Log `servicesMissingPriceCount` only. Do **not** move the names to debug: when they came from the form they are raw text, not derived.
   - Add the sentinel to a form-submitted service name in the existing `service_details` test case.
2. **CR-2 — extractor catch blocks `:1026`, `:1066`, `:1176`, `:1470` — Priority: Low.**
   - Apply DV-3's shape: a `SyntaxError` logs `errName` at error, with `{ err }` at debug.
   - Any other error keeps `{ err }` at error.
   - Add one test: a non-JSON model reply carrying the derived marker reaches no non-debug line.
3. **CR-3 — `:871` and `:1575`, `intent` at info — Priority: Low.**
   - `adjustment.intent` is whatever the model returned. In the `default` branch it is, by definition, not a known label, so it can be arbitrary model text.
   - Log it at info only when it is a known label. Otherwise log `intentLength` at info and the value at debug.
4. **CR-4 — `docs/SYSTEM_LOGGING_GUIDELINES.md` — Priority: Low.** It now makes a materially different security statement but has no `Last Updated` header and no Change History (CLAUDE.md § Documentation Standards). Add both, with a row like "Redaction marked not active (OI-9); owner-text rule added".

### Pre-existing bug found alongside (not a logging item; for the coordinator)

**Onboarding records many prices as 0.** The root cause is in `lib/services/OnboardingConversationManager.ts:1419-1420`:

```typescript
const freePatterns = ['free', 'חינם', 'gratis', '0', 'nothing', 'no charge', 'בחינם', 'ללא תשלום'];
if (freePatterns.some(p => trimmed.toLowerCase() === p || trimmed.toLowerCase().includes(p))) {
```

- `'0'` is a "free" pattern, and the test is a substring `includes`, so any reply containing the digit 0 ("100", "150", "250 ILS", "₪1,200") returns **0** before the number is parsed. "175" survives only because it contains no zero.
- `'free'` has the same flaw on a smaller scale (e.g. "freelance rate 90").
- The fix belongs in its own `fix/` item: whole-word matching for the free words, and `0` counts as free only when the whole reply is zero.

### Code Approved for QA: **No — pending CR-1 to CR-4.** Steps 1, 3, 4a, 4b and 4c are approved as they stand.

**Dev response (2026-09-18):** CR-1 to CR-4 are applied, and OI-11 is recorded. See §15.7. Ready for the SA re-check of the CR hunks.

### 16.1 SA Re-check of CR-1 to CR-4

**Re-checked by SA — 2026-09-18**
**Status:** ✅ **APPROVED — Code Approved for QA: Yes.** No CR remains open. The two notes below are optional.

**Gates, re-run by SA:**

| Gate | Result |
|---|---|
| `typecheck:bos-llm` | 140 files, 30 errors, 0 new; the baseline is unchanged |
| Jest, G6 set, `--ci` | 145 of 146 pass, 9 snapshots. The one failure is the known OI-10 test |
| Usage-route snapshot | Untouched |

**Confinement (the per-step split still holds):**
- Only three files changed after the §16 review: `OnboardingConversationManager.ts`, its `attribution.test.ts`, and `docs/SYSTEM_LOGGING_GUIDELINES.md` (by modification time).
- Step 4 is unchanged. The saved `step4b/aiAnalytics.ts` still differs from the current file by exactly the 4c hunk. The 4a test still differs only by the two 4c cases (31 added lines). The `.snap` is byte-identical.
- So RM's split in §15.3 is still valid as written: the CR hunks join step 2, and CR-4 joins the docs commit.

**Findings:**
- **CR-1:** `:827` now logs `servicesMissingPriceCount` only, and names are logged at no level. `:1719` builds the service names into the **reply** to the owner, not into a log call.
- **CR-2:** `logExtractionFailure` behaves as specified, and all four catch blocks use it:
  - a `SyntaxError` logs `{ errName }` at error and `{ err }` at debug;
  - any other error keeps `{ err }` at error.

  `JSON.parse` failures are same-realm `SyntaxError`s, so `instanceof` is reliable.
- **CR-3:** `KNOWN_ADJUSTMENT_INTENTS` is exactly the seven labels in `PREVIEW_ADJUSTMENT_PROMPT`'s `"intent"` enum (`:472`): `add_capability`, `remove_capability`, `modify_services`, `modify_pipeline`, `change_payment_mode`, `restart`, `confirm`. `intentFields()` is used at both info sites.
- **CR-4:** the guidelines doc has `Last Updated`, a ToC entry, the owner-text rule and a Change History row.
- **Onboarding path at info and above.** Every `info`/`warn`/`error` call in `OnboardingConversationManager.ts`, `OnboardingChatService.ts` and the onboarding route was re-read. They carry only ids, lengths, counts, numbers, step names, or labels that are chip-derived or code-defined. No raw or derived owner text appears at info or above.
- **The mock change doesn't mask anything; it removes a mask.**
  - Serialising `Error` values as `{ name, message }`, recursively via the replacer, captures the message, which is exactly where a `SyntaxError` quotes text. The old `{}` hid it.
  - Pino's serializer also emits `stack` and own properties. `stack` repeats the message, and no owner text is carried in custom error properties on this path.
  - Skipping *rejected* model calls in the echo check is correct: a rejected call returned nothing to echo.

**Optional, not blocking:**
- `:709` (`pricingModel`) and `:1024` (`vertical`) log model-returned values at info. Both are prompted enums with defaults, so the risk is far lower than CR-3's `default` branch. If they are ever hardened, `intentFields`' known-label pattern applies.
- The direct-extractor test at `attribution.test.ts:439-440` pushes a synthetic "Processing user message" line so the shared `afterEach` passes. It hides no leak check, but scoping that one assertion to cases that go through `processUserMessage` would be cleaner.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-18 | Created | Dev workplan for OI-4 to OI-7: inventory verified on `816ef757`, per-line mappings, test plan, gates with measured baselines, 8 questions for SA |
| 2026-09-18 | SA review: approved with required changes | Inventory, the six surprises and the pre-existing test failure verified. Q-1, Q-3, Q-5, Q-6, Q-7 agreed. Q-2 ruled: narrow the tracker's DB-error log to `{ code, message, hint }`, as its own step **4c** so 4b stays mechanical (WC-1). Q-4 ruled: OI-8 as a **priority** follow-up. Q-8 correction made in the Layer 1.5 workplan. WC-2: correct §2's "same fields or fewer" (`{ err }` adds stack and SDK fields on three lines, accepted). WC-3: sentinel coverage mapped per line, LLM mock proven not to echo. WC-4: deterministic snapshot. WC-5: record OI-9 (redaction never applied; correct the guidelines doc) and OI-10 (the pre-existing IntentClassifier test failure) |
| 2026-09-18 | Code complete | Steps 1, 2 (OI-7 + OI-8 per user decision D-OI8), 3, 4a, 4b and 4c implemented, uncommitted. WC-1 to WC-5 applied. Deviations DV-1 to DV-6. Gate results per step, the RM split and items for SA are in §15. Requirement, investigation doc and logging guidelines updated |
| 2026-09-18 | SA code review: Fix Required | Gates re-run: typecheck 140 / 30 / 0 new, baseline unchanged; G6 Jest 137 of 138 (OI-10 only), 9 snapshots under `--ci`; `console.*` 0 / 0 / 0. 4b vs saved 4a state: exactly the 4c hunk differs, snapshot byte-identical. Steps 1, 3, 4a, 4b, 4c approved; DV-1 to DV-6 accepted. CR-1 (Medium): `:788` logs owner-typed service names at info. CR-2: narrow the four extractor catch blocks to the DV-3 shape (ruling (a)). CR-3: model-returned `intent` at info only when it is a known label. CR-4: `SYSTEM_LOGGING_GUIDELINES.md` needs Last Updated and Change History. Ruling (b): price, collection and channel labels OK at info; service names are not. Ruling (c): TokenBudgetManager 17 of 21 failures unrelated, record as OI-11. Pre-existing price-parser root cause recorded (`:1419-1420`, `'0'` matched by substring) |
| 2026-09-18 | CR-1 to CR-4 applied | CR-1: service names out of the logs (a count at info). CR-2: `logExtractionFailure`: a `SyntaxError` gets its name at error and detail at debug; other errors unchanged. CR-3: `KNOWN_ADJUSTMENT_INTENTS` + `intentFields`: an unknown model intent is logged by length at info, value at debug. CR-4: logging guidelines get Last Updated, Change History and the owner-text rule. OI-11 recorded. 9 new test cases (6 red on the pre-CR code). Gates: typecheck 140 / 30 / 0 new, baseline untouched; `tsc` 2,042; G6 145 of 146 (OI-10 only); NUL 0; usage snapshot untouched (§15.7) |
| 2026-09-18 | SA re-check: APPROVED for QA | CR-1 to CR-4 verified. Service names no longer logged; `logExtractionFailure` narrows only `SyntaxError`; `KNOWN_ADJUSTMENT_INTENTS` equals the preview prompt's seven intents; guidelines doc has Last Updated + Change History. No raw or derived owner text at info or above in the onboarding path. Test mock change removes a mask rather than adding one. Gates: typecheck 140 / 30 / 0 new, baseline unchanged; Jest 145 of 146 (OI-10 only), 9 snapshots. Only step 2 files and the guidelines doc changed; step 4a/4b/4c states re-verified, so the RM split in §15.3 stands. Optional notes: `pricingModel` / `vertical` labels, synthetic log line in one test |
| 2026-09-18 | QA: PASSED | Jest 145 of 146 (OI-10 only), 9 snapshots; typecheck 140 / 30 / 0 new, baseline unchanged; `tsc` 2,042; NUL 0; `console.*` 0 / 0 / 0. One live onboarding conversation, with real Pino output captured at info and at debug. Info: no sentinel, no raw phrase, no AI summary. Debug: AI summaries present; no raw-message field; model-echoed sentinels only inside model-returned fields (D-OI8). Ledger: 3 `token_usage` rows, correct user and session. No bugs (§13) |
