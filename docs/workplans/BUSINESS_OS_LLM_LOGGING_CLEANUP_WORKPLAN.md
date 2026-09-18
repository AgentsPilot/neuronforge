# Workplan: Business OS LLM — Logging Clean-ups (OI-4 to OI-7)

> **Last Updated**: 2026-09-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md): open items **OI-4, OI-5, OI-6, OI-7**, decision **D-6**, NFR Logging
**Context:** [BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_LAYER1_5_WORKPLAN.md). The per-file risk notes are in SA's Q-6 answer (§11). The privacy finding is QA observation O-2 (§12).
**Branch:** `feature/business-os-llm-layer1-5` (worktree `neuronforge-llm-layer15`, fast-forwarded to `origin/main` @ `816ef757`, with Layers 1, 1.1 and 1.5 merged)
**Date:** 2026-09-18
**Status:** SA reviewed 2026-09-18. **Approved to implement** with WC-1 to WC-5 (§12); step 4 becomes 4a / 4b / 4c. No code written.

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
- **Content:** a converted call logs **the same fields as today or fewer**. The only exceptions are the non-sensitive context keys named in the tables below. No conversion reads `request_payload`, `response_metadata`, `metadata`, `error_message`, a prompt, or owner text.

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

### 3.4 OI-4: `lib/analytics/aiAnalytics.ts` (16 → 13)

**Untouched:** the `insertData` literal (`:144-185`), `isValidUUID`, `platformAccountId()`, `finalUserId`, `validSessionId`, the `.insert(...).select(...)` call and every branch condition. The only other additions are the `createLogger` import and the `logger` constant.

| Line(s) | Current | New | Level and content rationale |
|---|---|---|---|
| `:98` | `warn('⚠️ No Supabase client available, skipping tracking')` | `logger.warn({ feature, component, model }, 'No Supabase client; AI call not tracked')` | Unchanged level. The added fields are labels, not payload |
| `:102` | `log('📊 Starting AI call tracking:', {user_id, feature, component, model, cost, activity_type})` | `logger.debug({ userId, feature, component, model, costUsd, activityType }, 'Tracking AI call')` | **debug**: fires on every LLM call in the product. Same fields |
| `:130` | `warn(\`⚠️ Invalid user_id format: "${user_id}", using SYSTEM_USER_ID\`)` | `logger.warn({ invalidUserId: callData.user_id }, 'Invalid user_id; recording against the platform account')` | Unchanged level and value (the value was already in the message) |
| `:138` | `warn(\`⚠️ Invalid session_id format: "${session_id}", setting to null\`)` | `logger.warn({ invalidSessionId: callData.session_id }, 'Invalid session_id; recording with no session')` | Unchanged |
| `:187` | `log('💾 Inserting to token_usage table:', {13 scalar fields})` | `logger.debug({ callId, userId, model, inputTokens, outputTokens, totalTokens, feature, component, activityType, agentId, executionId, costUsd, success }, 'Inserting token_usage row')` | **debug**: once per call. It reads **the same 13 scalars and nothing else**: no `request_payload`, no `metadata` |
| `:209` + `:210` | two `console.error`s: the DB error, then a sample of four fields | **one** `logger.error({ err: error, userId, model, callId, inputTokens, outputTokens }, 'Failed to insert token_usage row')` | Unchanged level. Merged because `{ err }` plus the fields carries both. **See Q-2 about what a Postgres error can contain** |
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
| 2 | OI-7 | `lib/services/OnboardingConversationManager.ts`, `app/api/onboarding/chat/route.ts`, the two existing `*.attribution.test.ts` files | `fix(onboarding): never log the owner's raw chat text (OI-7)` |
| 3 | OI-5 | `lib/orchestration/IntentClassifier.ts` | `refactor(orchestration): log IntentClassifier through Pino (OI-5)` |
| 4a | OI-4 | **new** `lib/analytics/__tests__/aiAnalytics.trackAICall.test.ts` + its snapshot | `test(analytics): characterize trackAICall's inserted row (OI-4)` |
| 4b | OI-4 | `lib/analytics/aiAnalytics.ts` **only** | `refactor(analytics): log the AI tracker through Pino (OI-4)` |

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

- [ ] **T0** SA reviews this workplan; answers Q-1 to Q-8 recorded in §12
- [ ] **T1** Record the G1 `--list` and G2 per-file baseline to scratch (not committed)
- [ ] **T2** Step 1 (OI-6): convert `openaiProvider.ts` per §3.1; run G1–G7
- [ ] **T3** Step 2 (OI-7): add the T-2 / T-3 sentinel tests (they fail first on today's code), then change the 7 calls per §3.2; run G1–G7
- [ ] **T4** Step 3 (OI-5): convert `IntentClassifier.ts` per §3.3; run G1–G7 (same single pre-existing test failure)
- [ ] **T5** Step 4a: write the T-5 / T-6 characterization test against the untouched tracker; commit the snapshot; run G1–G7
- [ ] **T6** Step 4b: convert `aiAnalytics.ts` per §3.4; the T-5 snapshot and test file unedited and passing; G2 = 2,042 (Q-6); G7 = single file
- [ ] **T7** Hand to SA for code review, then QA
- [ ] **T8** On completion: update the requirement and the investigation doc (§11)

---

## 11. Closure

This workplan closes **OI-4, OI-5, OI-6 and OI-7**. When it is complete, BA or Dev updates the following:

- [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md):
  - set rows OI-4 to OI-7 in the open-items table to **Closed**, with the commit refs;
  - annotate the NFR Logging table and D-6 ("converted in a follow-up");
  - add a Change History row.
- [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md): note that the tracker, the classifier and the OpenAI provider now log through Pino, and that onboarding no longer logs owner text. Add a Change History row.
- If SA accepts Q-4: add **OI-8**, derived owner text in onboarding logs, with the §4 list.
- The Layer 1.5 workplan's SA Q-6 note: the correction in Q-8.

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

*(QA to populate.)*

## 14. Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-18 | Created | Dev workplan for OI-4 to OI-7: inventory verified on `816ef757`, per-line mappings, test plan, gates with measured baselines, 8 questions for SA |
| 2026-09-18 | SA review: approved with required changes | Inventory, the six surprises and the pre-existing test failure verified. Q-1, Q-3, Q-5, Q-6, Q-7 agreed. Q-2 ruled: narrow the tracker's DB-error log to `{ code, message, hint }`, as its own step **4c** so 4b stays mechanical (WC-1). Q-4 ruled: OI-8 as a **priority** follow-up. Q-8 correction made in the Layer 1.5 workplan. WC-2: correct §2's "same fields or fewer" (`{ err }` adds stack and SDK fields on three lines, accepted). WC-3: sentinel coverage mapped per line, LLM mock proven not to echo. WC-4: deterministic snapshot. WC-5: record OI-9 (redaction never applied; correct the guidelines doc) and OI-10 (the pre-existing IntentClassifier test failure) |
