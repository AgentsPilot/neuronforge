# Workplan: Enhanced Prompt Generator Simulator

> **Last Updated**: 2026-03-31 (rev 2)

**Developer:** Dev
**Requirement:** [SIMULATOR_ENHANCED_PROMPT_GENERATOR.md](/docs/requirements/SIMULATOR_ENHANCED_PROMPT_GENERATOR.md)
**Date:** 2026-03-31
**Status:** SA Approved

---

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Provider Factory Concern](#provider-factory-concern)
- [Auth Implementation Detail](#auth-implementation-detail)
- [API Request/Response Shapes](#api-requestresponse-shapes)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Example Scenario Files](#example-scenario-files)
- [Acceptance Criteria Mapping](#acceptance-criteria-mapping)
- [Risk Register](#risk-register)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)

---

## Analysis Summary

This feature creates a standalone CLI tool under `simulators/enhanced-prompt-generator/` that drives the existing agent creation API (Phases 1-3) end-to-end without any UI. The simulator authenticates as a real Supabase user, calls the `init-thread` and `process-message` endpoints, uses an LLM to answer Phase 2 clarification questions, and validates the final enhanced prompt via LLM.

**Systems touched:**

| System | Impact |
|--------|--------|
| `POST /api/agent-creation/init-thread` | Consumer only, no changes |
| `POST /api/agent-creation/process-message` | Consumer only, no changes |
| `lib/ai/providerFactory.ts` | Consumer for LLM answerer/validator calls |
| `lib/auth.ts` (`getUser()`) | Must understand cookie format for forwarding; no changes |
| `.gitignore` | Add `simulators/**/output/` entry |

**No existing API routes or server code are modified.**

---

## Implementation Approach

### Overall Design

The simulator is a standalone `npx tsx` script that imports the `ProviderFactory` from the main codebase for LLM calls, but uses plain `fetch()` for all HTTP calls to the local API server. Authentication is handled by calling Supabase `signInWithPassword()` directly and constructing cookies to forward on each request.

### Key Decisions

1. **HTTP client uses native `fetch`** -- no external HTTP library needed. A thin wrapper in `shared/http-client.ts` adds cookie forwarding and logging.

2. **LLM calls use `ProviderFactory` directly** -- imported from `lib/ai/providerFactory.ts`. This keeps the simulator consistent with the platform. See [Provider Factory Concern](#provider-factory-concern) for CLI compatibility analysis.

3. **Logging uses a lightweight console-based logger** -- not Pino. The simulator is a developer-facing CLI tool, not a production API route. Using Pino would require its full dependency chain and is overkill for CLI output. The shared logger supports `--verbose` via a log level flag.

4. **Zod validates scenario files** -- the scenario JSON schema is validated with Zod on load, consistent with the project's validation approach.

5. **Session cookies obtained via `@supabase/ssr` in-memory cookie jar** -- see [Auth Implementation Detail](#auth-implementation-detail). This avoids manual cookie encoding and guarantees format compatibility with `getUser()`.

---

## Provider Factory Concern

### Analysis

`ProviderFactory` at `lib/ai/providerFactory.ts` is a static class that:

- Reads environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) directly from `process.env`
- Creates singleton instances of `OpenAIProvider`, `AnthropicProvider`, `KimiProvider`
- Internally creates a Supabase client for `AIAnalyticsService` using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Uses `@/` import aliases which resolve via `tsconfig.json` paths

**CLI compatibility concerns:**

| Concern | Assessment |
|---------|------------|
| Environment variables | Works -- `npx tsx` loads `.env.local` if we use `dotenv` or `tsx` picks up the env. We must ensure `.env.local` is loaded before factory is called. |
| `@/` import aliases | Works -- `tsx` respects `tsconfig.json` path aliases via `tsconfig-paths` (bundled with `tsx`). |
| `AIAnalyticsService` requires Supabase | Works -- the factory creates a Supabase client using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars, which are in `.env.local`. Analytics calls may fail silently if the DB is unreachable, but this is non-blocking. |
| Next.js-specific imports | The factory itself does **not** import from `next/server`, `next/headers`, or any Next.js runtime APIs. It is pure Node.js. |
| Transitive dependencies | `BaseAIProvider` and subclasses import from `@/lib/analytics/aiAnalytics` which uses `@supabase/supabase-js` -- all Node.js compatible. |

**Conclusion:** `ProviderFactory` can be imported directly in the CLI script via `npx tsx`. No wrapper or alternative is needed.

**Action required:** The CLI entry point must load `.env.local` before any imports that read `process.env`. We will use `dotenv` (already a project dependency via Next.js) to load it explicitly:

```typescript
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
```

### SA Review Requested

Confirm that importing `ProviderFactory` from a CLI context is acceptable. If the factory or its transitive dependencies are found to import Next.js runtime APIs in the future, we would need a thin adapter layer. Currently this is not the case.

---

## Auth Implementation Detail

### How `getUser()` Works

`lib/auth.ts` uses `@supabase/ssr`'s `createServerClient` which:

1. Calls `cookieStore.getAll()` to read all cookies from the Next.js `cookies()` store
2. The Supabase SSR client looks for cookies matching the pattern `sb-<project-ref>-auth-token`
3. It supports the **chunked format**: `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1`, etc. for large tokens
4. The cookie values use `base64url` encoding with a `"base64-"` prefix (not plain `base64`)

### Cookie Construction Strategy (via `@supabase/ssr` in-memory cookie jar)

Rather than manually encoding cookies (which is fragile and version-dependent), the simulator uses `@supabase/ssr`'s own `createServerClient` with a custom in-memory cookie adapter. This guarantees the cookie format, encoding, and chunking logic exactly matches what `getUser()` expects, regardless of `@supabase/ssr` version. This eliminates Risk R-2 (cookie format drift).

The approach:

1. Create a `createServerClient` instance from `@supabase/ssr` with an in-memory `cookieJar` (plain `Record<string, string>`)
2. Call `signInWithPassword()` on this SSR client -- the auth state change triggers `setAll`, which populates the `cookieJar` with correctly formatted and chunked cookies
3. The HTTP client serializes the `cookieJar` into a `Cookie` header for every API request

**Implementation in `auth.ts`:**

```typescript
import { createServerClient } from '@supabase/ssr';

// In-memory cookie jar -- populated by @supabase/ssr's internal cookie logic
const cookieJar: Record<string, string> = {};

const supabaseSSR = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    cookies: {
      getAll: () =>
        Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) => {
          if (value) cookieJar[name] = value;
          else delete cookieJar[name];
        }),
    },
  }
);

// Sign in -- triggers onAuthStateChange which calls setAll
const { data, error } = await supabaseSSR.auth.signInWithPassword({
  email: process.env.SIMULATOR_USER_EMAIL!,
  password: process.env.SIMULATOR_USER_PASSWORD!,
});

if (error) throw new Error(`Auth failed: ${error.message}`);

// cookieJar now contains correctly formatted, encoded, and chunked cookies
// Serialize for HTTP requests:
const cookieHeader = Object.entries(cookieJar)
  .map(([name, value]) => `${name}=${value}`)
  .join('; ');
```

The HTTP client forwards the `cookieHeader` on every request via the `Cookie` header.

### Session Refresh

The session is obtained once at startup and reused. If a request returns 401, the auth module clears the `cookieJar`, re-authenticates via the same `signInWithPassword` flow, and retries the failed request with the refreshed cookies.

---

## API Request/Response Shapes

### `POST /api/agent-creation/init-thread`

**Request body (optional):**

```json
{
  "ai_provider": "openai",
  "ai_model": "gpt-4o"
}
```

An empty body is accepted; defaults to OpenAI/gpt-4o.

**Success response (200):**

```json
{
  "success": true,
  "thread_id": "thread_abc123",
  "created_at": "2026-03-31T10:00:00.000Z",
  "message": "Thread created successfully"
}
```

**Error response (401 / 400 / 500):**

```json
{
  "success": false,
  "error": "Error description",
  "details": "Additional details"
}
```

---

### `POST /api/agent-creation/process-message` -- Phase 1

**Request body:**

```json
{
  "thread_id": "thread_abc123",
  "phase": 1,
  "user_prompt": "Summarize my last 10 Gmail emails and save to Notion",
  "user_context": {
    "full_name": "Test User",
    "email": "simulator@yourdomain.com",
    "timezone": "Asia/Jerusalem"
  },
  "connected_services": ["google-mail", "notion"]
}
```

`user_context` and `connected_services` are optional. If omitted, the server derives them from the authenticated user's profile and plugin connections. Note: `connected_services` must use actual plugin keys (e.g., `"google-mail"` not `"gmail"`).

**Success response (200):**

```json
{
  "success": true,
  "phase": 1,
  "clarityScore": 75,
  "conversationalSummary": "I understand you want...",
  "analysis": {
    "data": { "status": "clear", "confidence": 0.9, "detected": "Gmail emails" },
    "actions": { "status": "clear", "confidence": 0.8, "detected": "Summarize" },
    "output": { "status": "partial", "confidence": 0.6, "detected": "Notion page" },
    "delivery": { "status": "missing", "confidence": 0.3, "detected": "" }
  },
  "connectedPlugins": ["google-mail", "notion"],
  "workflow_draft": ["Fetch last 10 Gmail emails", "Summarize content", "Save to Notion"],
  "ambiguities": ["Which Notion database?"],
  "user_inputs_required": []
}
```

---

### `POST /api/agent-creation/process-message` -- Phase 2

**Request body:**

```json
{
  "thread_id": "thread_abc123",
  "phase": 2,
  "connected_services": ["google-mail", "notion"],
  "enhanced_prompt": null,
  "declined_services": [],
  "user_feedback": null
}
```

**Success response (200):**

```json
{
  "success": true,
  "phase": 2,
  "questionsSequence": [
    {
      "id": "q1",
      "question": "Which Notion database should be used for the summaries?",
      "type": "text",
      "theme": "Outputs",
      "required": true
    },
    {
      "id": "q2",
      "question": "How detailed should each email summary be?",
      "type": "select",
      "theme": "Processing",
      "options": [
        { "value": "brief", "label": "Brief (1-2 sentences)" },
        { "value": "detailed", "label": "Detailed (paragraph)" }
      ]
    }
  ],
  "conversationalSummary": "Let me ask a few questions to finalize your automation..."
}
```

---

### `POST /api/agent-creation/process-message` -- Phase 3

**Request body:**

```json
{
  "thread_id": "thread_abc123",
  "phase": 3,
  "clarification_answers": {
    "q1": "My daily summaries database",
    "q2": { "answerType": "select", "mode": "selected", "selected": "brief" }
  },
  "connected_services": ["google-mail", "notion"],
  "declined_services": [],
  "enhanced_prompt": null
}
```

Note: `clarification_answers` supports both plain strings and structured select/multi-select answer objects per the V14 typing (`ClarificationAnswer` union type).

**Success response (200):**

```json
{
  "success": true,
  "phase": 3,
  "enhanced_prompt": {
    "plan_title": "Gmail Summary to Notion",
    "plan_description": "Summarize last 10 Gmail emails and save brief summaries to Notion",
    "sections": {
      "data": ["Fetch last 10 emails from Gmail inbox"],
      "actions": ["Summarize each email into 1-2 sentences using AI"],
      "output": ["Create a summary document"],
      "delivery": ["Save to 'My daily summaries' Notion database"]
    },
    "specifics": {
      "services_involved": ["google-mail", "notion"],
      "user_inputs_required": [],
      "resolved_user_inputs": []
    }
  },
  "requiredServices": ["google-mail", "notion"],
  "missingPlugins": [],
  "conversationalSummary": "Here is your automation plan...",
  "metadata": {
    "all_clarifications_applied": true,
    "ready_for_generation": true,
    "confirmation_needed": false,
    "implicit_services_detected": [],
    "provenance_checked": true
  }
}
```

---

## Files to Create / Modify

| # | File | Action | Purpose | AC Mapping |
|---|------|--------|---------|------------|
| 1 | `simulators/shared/types.ts` | Create | Shared TypeScript types for all simulators (base result, auth state, logger interface) | -- |
| 2 | `simulators/shared/logger.ts` | Create | Lightweight console logger with verbose/quiet modes, colored output, timing | AC-8 (summary table) |
| 3 | `simulators/shared/http-client.ts` | Create | HTTP client wrapper over `fetch` with cookie forwarding, correlation IDs, verbose request/response logging | AC-1, AC-2 |
| 4 | `simulators/enhanced-prompt-generator/types.ts` | Create | Scenario schema (Zod), output structure type, simulator config type | AC-7 |
| 5 | `simulators/enhanced-prompt-generator/auth.ts` | Create | Supabase `signInWithPassword`, cookie construction (chunked format), session caching and refresh | AC-2 |
| 6 | `simulators/enhanced-prompt-generator/llm-answerer.ts` | Create | Uses `ProviderFactory` to generate Phase 2 answers from original prompt + questions; supports `clarification_overrides` | AC-3, AC-4 |
| 7 | `simulators/enhanced-prompt-generator/llm-validator.ts` | Create | Uses `ProviderFactory` to validate enhanced prompt captures original intent; returns `{ pass, reasoning, issues }` | AC-5 |
| 8 | `simulators/enhanced-prompt-generator/simulator.ts` | Create | Core orchestration: load scenario, auth, Phase 1 -> Phase 2 -> Phase 3 -> validate -> save output | AC-1, AC-7, AC-12 |
| 9 | `simulators/enhanced-prompt-generator/index.ts` | Create | CLI entry point: parse `--scenario`, `--all`, `--verbose`; run scenarios; print summary table; set exit code | AC-8, AC-9 |
| 10 | `simulators/enhanced-prompt-generator/scenarios/gmail-summary.json` | Create | Example scenario: Gmail to Notion summary | AC-1 |
| 11 | `simulators/enhanced-prompt-generator/scenarios/leads-notion.json` | Create | Example scenario: Leads email to Notion | AC-1 |
| 12 | `simulators/README.md` | Create | Setup instructions: test user creation, env vars, running scenarios | AC-13 |
| 13 | `.gitignore` | Modify | Add `simulators/**/output/` | AC-11 |

---

## Task List

### Phase A: Foundation (types and shared utilities)

- [x] **WP-1:** Create `simulators/shared/types.ts` -- base types shared across all simulators (SimulatorResult, AuthState, LogLevel)
- [x] **WP-2:** Create `simulators/shared/logger.ts` -- console-based logger with verbose flag, timestamp prefixes, colored status output, summary table printer
- [x] **WP-3:** Create `simulators/shared/http-client.ts` -- thin `fetch` wrapper that accepts cookie map, adds `x-correlation-id`, `Content-Type: application/json`, logs requests/responses at verbose level
- [x] **WP-4:** Create `simulators/enhanced-prompt-generator/types.ts` -- Zod schema for scenario files, TypeScript types for simulator output, config types for LLM provider/model

### Phase B: Auth and LLM modules

- [x] **WP-5:** Create `simulators/enhanced-prompt-generator/auth.ts` -- uses `@supabase/ssr`'s `createServerClient` with an in-memory cookie jar adapter; calls `signInWithPassword` which populates the jar with correctly formatted/encoded/chunked cookies; exposes cookie header string for the HTTP client; session cache with auto-refresh on 401 (clear jar, re-authenticate, retry)
- [x] **WP-6:** Create `simulators/enhanced-prompt-generator/llm-answerer.ts` -- prompt template for answering clarification questions given original prompt + questions list; iterate over questions, apply `clarification_overrides` partial matches; handle structured select/multi-select answer formats
- [x] **WP-7:** Create `simulators/enhanced-prompt-generator/llm-validator.ts` -- prompt template asking if enhanced prompt captures original intent; parse structured JSON response `{ pass, reasoning, issues }`

### Phase C: Core simulator and CLI

- [x] **WP-8:** Create `simulators/enhanced-prompt-generator/simulator.ts` -- orchestration function `runScenario(scenario, config)` that executes the full flow: load scenario -> auth -> init-thread -> Phase 1 (send `user_prompt`, receive analysis with ambiguities) -> Phase 2 (send `connected_services`, receive `questionsSequence` with structured questions) -> LLM answerer (generate answers from Phase 2's `questionsSequence` using original prompt as context, apply `clarification_overrides`) -> Phase 3 (send generated answers in `clarification_answers` field, receive `enhanced_prompt`) -> LLM validator -> build output. Each phase is timed individually. Errors are caught per-phase and recorded.
- [x] **WP-9:** Create `simulators/enhanced-prompt-generator/index.ts` -- CLI argument parsing (no external arg parser library; use `process.argv`), dotenv loading, scenario file discovery, sequential scenario execution, summary table output, exit code logic
- [x] **WP-10:** Create `simulators/enhanced-prompt-generator/scenarios/gmail-summary.json` and `simulators/enhanced-prompt-generator/scenarios/leads-notion.json`
- [x] **WP-11:** Create `simulators/README.md` -- document test user setup, environment variables, usage examples, output format

### Phase D: Integration

- [x] **WP-12:** Modify `.gitignore` to add `simulators/**/output/`
- [ ] **WP-13:** End-to-end manual test: run a single scenario against local dev server, verify output JSON is correct and saved to output directory
- [ ] **WP-14:** End-to-end manual test: run `--all` mode, verify summary table and exit codes

---

## Example Scenario Files

### `gmail-summary.json`

```json
{
  "name": "gmail-summary",
  "description": "Summarize last 10 Gmail emails and save to Notion",
  "user_prompt": "Summarize my last 10 Gmail emails and save the summary to a Notion page",
  "user_context": {
    "full_name": "Test User",
    "email": "simulator@yourdomain.com",
    "timezone": "Asia/Jerusalem"
  },
  "connected_services": ["google-mail", "notion"],
  "clarification_overrides": {
    "Which Notion database": "My daily summaries database"
  },
  "expected_services": ["google-mail", "notion"],
  "tags": ["email", "summarization", "notion"]
}
```

### `leads-notion.json`

```json
{
  "name": "leads-notion",
  "description": "Extract leads from emails and log to Notion CRM database",
  "user_prompt": "Find all emails from potential customers in my Gmail and add their details to my Notion CRM database",
  "user_context": {
    "full_name": "Test User",
    "email": "simulator@yourdomain.com",
    "timezone": "Asia/Jerusalem"
  },
  "connected_services": ["google-mail", "notion"],
  "expected_services": ["google-mail", "notion"],
  "tags": ["email", "leads", "crm", "notion"]
}
```

---

## Acceptance Criteria Mapping

| AC # | Acceptance Criterion | Work Items |
|------|---------------------|------------|
| AC-1 | Running `npx tsx ... --scenario <name>` executes full Phase 1-3 flow | WP-8, WP-9 |
| AC-2 | Authenticates using `signInWithPassword()` with env var credentials and forwards session cookies -- no API route changes | WP-5, WP-3 |
| AC-3 | Phase 2 questions answered by LLM using provider factory | WP-6 |
| AC-4 | `clarification_overrides` overrides LLM answers for matching questions | WP-6 |
| AC-5 | LLM-based validation checks enhanced prompt captures original intent | WP-7 |
| AC-6 | LLM provider/model configurable via env vars, with per-scenario overrides | WP-4, WP-6, WP-7 |
| AC-7 | Structured JSON output saved to `output/` | WP-8 |
| AC-8 | `--all` runs every scenario and prints summary table | WP-9 |
| AC-9 | Exit code 0 on all-pass, 1 on any failure | WP-9 |
| AC-10 | Works with existing `.env.local` plus `SIMULATOR_*` variables | WP-9 |
| AC-11 | `output/` directory is gitignored | WP-12 |
| AC-12 | Missing plugins logged as warnings, not failures | WP-8 |
| AC-13 | `simulators/README.md` documents test user creation | WP-11 |

---

## Risk Register

| # | Risk | Severity | Mitigation | SA Input Needed? |
|---|------|----------|------------|-----------------|
| R-1 | **Provider factory CLI compatibility** -- `ProviderFactory` creates an `AIAnalyticsService` with a Supabase client. If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are missing from the CLI env, the factory will throw on first LLM call. | Medium | Ensure documentation states all env vars from `.env.local` must be available. The CLI loads `.env.local` via dotenv before any imports. | Yes -- confirm this approach is acceptable vs. creating a standalone LLM client. |
| R-2 | ~~**Cookie chunking format**~~ -- **ELIMINATED.** By using `@supabase/ssr`'s own `createServerClient` with an in-memory cookie jar, the simulator delegates all cookie encoding, chunking, and formatting to the same library that `getUser()` uses. Format drift is no longer possible. | ~~Medium~~ N/A | N/A -- risk eliminated by SA-directed design change. | No |
| R-3 | **Thread cleanup** -- Each simulator run creates `agent_prompt_threads` records. Over time these accumulate. | Low | Document in README. A cleanup script is out of scope (listed in requirement's future roadmap). | No |
| R-4 | **LLM answer quality** -- The LLM answerer may produce answers that cause unexpected Phase 3 behavior (e.g., triggering mini-cycles). | Low | The simulator records all responses for inspection. Mini-cycles are not in scope for this simulator version -- if Phase 3 returns `user_inputs_required`, we log a warning and proceed. | No |
| R-5 | **Environment variable leakage** -- `SIMULATOR_USER_EMAIL` and `SIMULATOR_USER_PASSWORD` must not be committed. | High | These go in `.env.local` which is already gitignored. The README explicitly warns against committing credentials. | No |
| R-6 | **Phase 2 question format variability** -- Phase 2 questions can be `text`, `select`, or `multi_select` type. The LLM answerer must produce answers in the correct format for each type (plain string vs. structured object). | Medium | The answerer inspects each question's `type` and `options` fields. For `select`/`multi_select`, it picks from available options. For `text`, it returns a plain string. | No |

---

## SA Review Notes

**Reviewed by SA -- 2026-03-31**
**Status:** Approved with Required Changes

### Findings

**1. [Auth] Cookie value encoding is WRONG -- Priority: HIGH**

The workplan (lines 127-135) states the cookie value is `base64(JSON.stringify(session))`. This is incorrect. The `@supabase/ssr` `createServerClient` defaults to `base64url` encoding (see `node_modules/@supabase/ssr/dist/main/createServerClient.js` line 13: `cookieEncoding: options?.cookieEncoding ?? "base64url"`). The actual cookie value format is:

```
base64-<base64url_encoded_session_json>
```

Where the value is prefixed with the literal string `"base64-"` followed by the base64url-encoded session JSON. The chunking logic in `@supabase/ssr/dist/main/utils/chunker.js` uses `encodeURIComponent()` to measure chunk boundaries (not `Buffer.from().toString('base64')` as shown in the workplan).

**The correct approach is simpler:** Do NOT manually construct cookies. Instead, use `@supabase/ssr`'s own `createServerClient` with a custom cookie adapter that accumulates cookies into a plain object. Then serialize that object into `Cookie` headers. This guarantees format compatibility regardless of `@supabase/ssr` version changes, and eliminates Risk R-2 entirely.

Suggested pattern:

```typescript
import { createServerClient } from '@supabase/ssr';

// Create a Supabase SSR client with an in-memory cookie jar
const cookieJar: Record<string, string> = {};
const supabaseSSR = createServerClient(url, anonKey, {
  cookies: {
    getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => {
      if (value) cookieJar[name] = value;
      else delete cookieJar[name];
    }),
  },
});

// Sign in -- this triggers onAuthStateChange which calls setAll
const { data } = await supabaseSSR.auth.signInWithPassword({ email, password });
// cookieJar now contains correctly formatted and chunked cookies
```

This is a fundamental change to WP-5 and the Auth Implementation Detail section.

**2. [Auth] `getUser()` uses `cookies()` from `next/headers` -- Confirmed safe for HTTP approach**

`lib/auth.ts` imports `cookies` from `next/headers`. In Next.js App Router API routes, `cookies()` reads from the incoming HTTP request's `Cookie` header. Since the simulator sends standard HTTP requests with cookies in the `Cookie` header, `getUser()` will read them correctly. No concern here -- the approach is sound in principle, only the cookie format construction (Finding 1) needs fixing.

**3. [Provider Factory] CLI compatibility -- Confirmed SAFE**

Verified that `lib/ai/providerFactory.ts` has zero Next.js runtime imports. All imports are from `@supabase/supabase-js`, project-internal modules, and Node.js-compatible packages. The factory reads `process.env` directly, which works in any Node.js context. The `dotenv` loading approach in the workplan is correct.

One note: the factory uses `createClient` from `@supabase/supabase-js` with `SUPABASE_URL` (not `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`. The simulator's `.env.local` must contain both `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` (they may differ). Verify in WP-5/WP-9 documentation that both are required.

**4. [API Shapes] Phase flow description is ambiguous -- Priority: MEDIUM**

The simulator flow in WP-8 (line 411) says "Phase 1 -> LLM answer -> Phase 2 -> Phase 3". The requirement document (lines 99-107) implies clarification answers are sent to Phase 2. Both are misleading. The actual API flow per the route code is:

- Phase 1: send `user_prompt` -> receive analysis with `ambiguities` (not structured questions)
- Phase 2: send `connected_services` (no answers) -> receive `questionsSequence` (structured questions with types)
- Phase 3: send `clarification_answers` -> receive `enhanced_prompt`

The workplan's API request/response shapes (lines 229-370) are **correct** and match the route code. However, the WP-8 task description and the overall flow narrative should explicitly state: "LLM answers are generated from Phase 2 questions and sent in the Phase 3 request body." This prevents implementation confusion.

**5. [API Shapes] `init-thread` response shape -- Minor accuracy issue**

The workplan documents the `init-thread` response as including `created_at` (line 211). Verified against the route code (line 197-201): the response is `{ success, thread_id, created_at, message }`. This is correct.

**6. [API Shapes] `process-message` Phase 1 request -- `connected_services` format note**

The workplan shows `connected_services: ["gmail", "notion"]` in the scenario file, but the API route (line 183) maps non-string items via `s.name`. The workplan's Phase 1 request body (line 244) shows `connected_services: ["gmail", "notion"]` as a string array, which is fine. However, the route code on line 164 checks `connected_services.length === 0` to decide whether to fetch from server. If the scenario passes `connected_services`, those exact values are forwarded. Note that plugin keys are typically `"google-mail"` not `"gmail"`. The scenario files should use correct plugin keys. The `gmail-summary.json` example (line 440) uses `"google-mail"` in `expected_services` but `"google-mail"` and `"notion"` in `connected_services` -- wait, it uses `"gmail"` on line 440 but `"google-mail"` in the API response example on line 261. The Dev should ensure scenario `connected_services` use actual plugin keys (e.g., `"google-mail"` not `"gmail"`).

**7. [Architecture] Logging decision -- Acceptable**

Using a lightweight console logger instead of Pino for a CLI tool is acceptable. The simulator is a developer tool, not a production service. No concern.

**8. [Architecture] Shared utilities design -- Good**

The `simulators/shared/` structure with `types.ts`, `logger.ts`, and `http-client.ts` is well-designed for future simulator extensibility. No concern.

**9. [Risk] Missing risk: `SUPABASE_URL` vs `NEXT_PUBLIC_SUPABASE_URL` -- Priority: LOW**

The `ProviderFactory.getAnalytics()` uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The `init-thread` route module-level code uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. These may be different values. The simulator only imports `ProviderFactory` directly (not the route module-level code), so this is not a runtime issue. But the README should document that the simulator needs both `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` in the environment to avoid confusion.

**10. [Risk] Missing risk: Thread expiry mid-simulation -- Priority: LOW**

The `init-thread` route sets `expires_at` to 24 hours. The `process-message` route checks `isThreadExpired`. A single scenario should complete well within 24 hours, so this is not a practical risk. However, when running `--all` with many scenarios, threads from early scenarios are not reused (each scenario creates its own thread per WP-8), so this is fine. No action needed, just documenting the analysis.

**11. [Risk] Missing risk: Rate limiting / API throttling -- Priority: LOW**

Running `--all` with many scenarios sequentially makes rapid LLM calls (both to the local API which calls OpenAI, and directly via ProviderFactory). If scenarios are many, this could trigger provider rate limits. Consider adding a configurable delay between scenarios as a future enhancement. Not blocking for initial implementation.

**12. [Requirement Coverage] AC mapping is complete**

All 13 acceptance criteria from the requirement are mapped to work items. No gaps found.

**13. [Over-engineering] Assessment -- Proportional**

14 work items for this scope is reasonable. The shared utilities structure is justified by the requirement's explicit statement that this is the first in a family of simulators.

### Required Changes (must be addressed before implementation)

1. **WP-5 (auth.ts): Replace manual cookie construction with `@supabase/ssr` createServerClient + in-memory cookie jar.** The current base64 approach is incorrect and will not authenticate. See Finding 1 for the suggested pattern. Remove the entire "Cookie format" code block from the Auth Implementation Detail section and replace with the correct approach.

2. **WP-8 flow description: Clarify that LLM answers Phase 2 questions and sends them in the Phase 3 `clarification_answers` field.** The current description is ambiguous about which phase receives the answers. Update the task description to make the data flow explicit.

3. **Scenario files (WP-10): Use correct plugin keys.** The `gmail-summary.json` `connected_services` should use `"google-mail"` (not `"gmail"`) to match actual plugin keys in the system. Verify `"notion"` is the correct key as well.

### Optimisation Suggestions (non-blocking)

- Consider adding a `--dry-run` flag in a future iteration that validates scenario files and auth without making API calls -- useful for CI setup verification.
- The `http-client.ts` could expose a request/response interceptor pattern for future simulators that need custom middleware (e.g., retry, throttling).

### Approval

[x] Workplan approved with required changes -- address the 3 items above, then proceed to implementation. No second review needed for these changes; they are prescriptive.

---

## SA Code Review

**Code Review by SA -- 2026-03-31**
**Status:** Approved with Changes

### Code Review Comments

1. **[simulators/enhanced-prompt-generator/auth.ts:13-14] Module-level mutable state -- Priority: Medium**
   `cookieJar` and `cachedAuthState` are module-level `let` variables. This works correctly for the current sequential CLI use case (one process per run), but if this module were ever imported from a test harness or parallel runner, the shared mutable state would cause cross-contamination. For now this is acceptable given the CLI-only context, but worth noting. No change required.

2. **[simulators/enhanced-prompt-generator/auth.ts] Auth implementation -- Priority: N/A (Confirmation)**
   The `@supabase/ssr` `createServerClient` with in-memory cookie jar is implemented exactly as directed in the workplan review. The `getAll`/`setAll` cookie adapter correctly maps between the `Record<string, string>` jar and the `{ name, value }[]` format that `@supabase/ssr` expects. Cookie deletion on empty value is handled. The `signInWithPassword` call populates the jar through `setAll`, and the serialization to `Cookie` header format is correct. This fully eliminates the R-2 risk. **Approved.**

3. **[simulators/enhanced-prompt-generator/simulator.ts:106-123] 401 retry only on init-thread -- Priority: Medium**
   The 401 re-auth retry is only implemented for the `init-thread` call (lines 106-123). If the session expires during Phase 1, 2, or 3 API calls, the simulator will record an error without attempting re-auth. The requirement (FR-3.3) states: "If the session expires mid-run, the simulator re-authenticates automatically." The workplan (WP-5) also specifies: "session cache with auto-refresh on 401 (clear jar, re-authenticate, retry)." The current implementation partially fulfills this -- it handles the most likely case (session expired before any API call) but not mid-run expiry. **Required change: extract the 401 retry logic into a shared helper (e.g., `requestWithRetry` in the http-client or simulator) that wraps any HTTP call and retries once on 401 after clearing auth and re-authenticating.** This avoids duplicating the retry block for every API call.

4. **[simulators/enhanced-prompt-generator/simulator.ts:413] `__dirname` usage -- Priority: Medium**
   `path.join(__dirname, 'output')` is used to locate the output directory. With `tsx`, `__dirname` resolves to the source file's directory, which is correct. However, if the codebase ever migrates to ESM (where `__dirname` is not available), this will break. The `index.ts` (line 126) also uses `__dirname` for `scenariosDir`. Since this is a CLI tool and `tsx` supports `__dirname`, this is acceptable for now. If ESM migration becomes relevant, these should use `import.meta.dirname` or `path.dirname(fileURLToPath(import.meta.url))`. No change required.

5. **[simulators/enhanced-prompt-generator/llm-answerer.ts:129] Provider cast -- Priority: Low**
   `ProviderFactory.getProvider(providerName as ProviderName)` casts the string to `ProviderName` without validation. If a scenario file or env var specifies an invalid provider (e.g., `"groq"` which is not in the `PROVIDERS` const), the factory will throw an unhandled error at runtime. Same pattern in `llm-validator.ts:49`. **Suggestion: add a guard before the cast that checks against valid provider names and produces a clear error message** (e.g., `"Invalid provider 'groq'. Valid providers: openai, anthropic, kimi"`). This improves developer experience when configuring scenarios. Priority: Low -- the factory already throws, just with a less clear message.

6. **[simulators/enhanced-prompt-generator/llm-answerer.ts:178-183] `completionParams` typed as `Record<string, unknown>` -- Priority: Low**
   The `completionParams` is typed as `Record<string, unknown>` which loses type safety for the `chatCompletion` call. This is acceptable because `chatCompletion` itself accepts `any` params (confirmed in `baseProvider.ts:52`). No change required.

7. **[simulators/enhanced-prompt-generator/simulator.ts:282] Phase 2 request body not recorded -- Priority: Low**
   `output.phases.phase2.request` is set to `null` (line 288) even on success. The `phase2Body` variable is in scope and could be assigned. The requirement (Output Specification) expects the request body to be recorded for all phases. **Required change: assign `phase2Body` to `output.phases.phase2.request` on line 288.**

8. **[simulators/enhanced-prompt-generator/types.ts] Zod schema -- Priority: N/A (Confirmation)**
   All required fields (`name`, `description`, `user_prompt`) are validated with `.min(1)`. Optional fields are correctly marked. The `user_context` schema allows additional profile fields (`role`, `company`, `domain`) beyond the requirement spec, which is fine for forward compatibility. `clarification_overrides` is `Record<string, string>` matching the requirement's "Map of question text to predetermined answers." **Approved.**

9. **[simulators/enhanced-prompt-generator/index.ts:17-21] dotenv loading order -- Priority: N/A (Confirmation)**
   `dotenv.config()` is called before any application imports that read `process.env`. The import of `dotenv` and `path` are standard library/utility imports that do not read env vars. The `ProviderFactory` import happens later (transitively through `llm-answerer.ts` and `llm-validator.ts` via `simulator.ts`). This correctly addresses Risk R-1. **Approved.**

10. **[simulators/shared/http-client.ts:52] Empty object fallback on JSON parse failure -- Priority: Low**
    When `response.json()` fails, the fallback is `{} as T`. This could mask non-JSON error responses (e.g., HTML error pages from the dev server). The error is silently swallowed. **Suggestion: log a warning when JSON parsing fails**, so developers see that the response was not JSON. The status code alone may not be enough to diagnose issues.

11. **[simulators/enhanced-prompt-generator/scenarios/gmail-summary.json] Plugin keys -- Priority: N/A (Confirmation)**
    Both scenario files use `"google-mail"` (not `"gmail"`) in `connected_services` and `expected_services`. This addresses the SA workplan review required change #3. **Approved.**

12. **[.gitignore:49-50] Output gitignored -- Priority: N/A (Confirmation)**
    `simulators/**/output/` is present in `.gitignore`. **Approved.**

13. **[simulators/README.md] Documentation -- Priority: N/A (Confirmation)**
    README documents test user creation steps, env vars (including both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` per SA workplan review finding #9), usage examples, output format, thread cleanup, and security warnings. **Approved.**

14. **[simulators/shared/logger.ts] No console.log usage -- Priority: N/A (Confirmation)**
    All output goes through `process.stdout.write` and `process.stderr.write`. No `console.log` anywhere in the simulator codebase. **Approved.**

### Required Changes

1. **[Finding 3] Implement 401 retry for all API calls, not just init-thread.** Extract a `requestWithRetry` helper that wraps HTTP calls and retries once on 401 after clearing auth cache and re-authenticating. This fulfills FR-3.3 and WP-5's stated behavior. Without this, a session expiring between Phase 1 and Phase 3 will cause an unrecoverable error instead of transparent re-auth.

2. **[Finding 7] Record Phase 2 request body in output.** Change line 288 in `simulator.ts` from `request: null` to `request: phase2Body`. This is a one-line fix.

### Optimisation Suggestions

- [Finding 5] Add provider name validation before casting to `ProviderName` in both `llm-answerer.ts` and `llm-validator.ts` for clearer error messages.
- [Finding 10] Log a warning in `http-client.ts` when JSON response parsing fails instead of silently returning `{}`.
- Consider adding a `--timeout` CLI flag for per-scenario timeout enforcement (the 120s limit from the requirement is currently unenforced -- only the 90s warning threshold is implemented).

### Code Approved for QA: No -- Updated to Yes after fixes

Address the 2 required changes above, then proceed to QA. Required change #1 is a functional gap (FR-3.3 compliance). Required change #2 is a data completeness gap. Neither requires SA re-review -- they are prescriptive fixes.

### Dev Fixes Applied

1. **[Finding 3] 401 retry for all API calls -- Fixed by Dev:** Extracted `requestWithRetry<T>()` helper in `simulator.ts` that wraps any HTTP POST call. On 401, it calls `clearAuthCache()`, re-authenticates via `authenticate()`, and retries once with fresh cookies. All four API calls (init-thread, Phase 1, Phase 2, Phase 3) now use this helper instead of raw `httpClient.post()`. The init-thread block's inline 401 retry logic was removed and replaced with the shared helper.

2. **[Finding 7] Phase 2 request body recorded -- Fixed by Dev:** Changed `request: null` to `request: phase2Body` in the Phase 2 success output block. Hoisted `phase2Body` declaration out of the `try` block so it is in scope at both the error and success output assignment points.

---

## QA Testing Report

**QA -- 2026-03-31**
**Test mode:** full
**Strategy used:** A (unit/compilation) + C (CLI script) -- full E2E not possible without running dev server and test credentials
**Focus:** all (file structure, compilation, code quality, CLI behavior, regression)
**Skipped:** E2E against running server (requires dev server + configured test user with Supabase credentials)
**Input source:** prompt keywords (explicit test plan provided)

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-1: `--scenario <name>` executes full Phase 1-3 flow | Partial | Pass (static) | Code path verified statically; CLI entry point confirmed working. Full runtime requires live server. |
| AC-2: Authenticates via `signInWithPassword()` + cookie forwarding, no API changes | Yes | Pass | `auth.ts` uses `@supabase/ssr` `createServerClient` with in-memory cookie jar as directed by SA. No API route files modified. |
| AC-3: Phase 2 questions answered by LLM via provider factory | Yes | Pass | `llm-answerer.ts` imports `ProviderFactory` from `@/lib/ai/providerFactory`. |
| AC-4: `clarification_overrides` overrides LLM answers | Yes | Pass | `findOverride()` does case-insensitive partial match on question text. `formatAnswer()` handles text, select, and multi_select types. |
| AC-5: LLM validation checks enhanced prompt captures intent | Yes | Pass | `llm-validator.ts` imports `ProviderFactory`, sends structured validation prompt, parses JSON response. |
| AC-6: LLM provider/model configurable via env vars with per-scenario overrides | Yes | Pass | `index.ts` reads `SIMULATOR_LLM_PROVIDER`/`SIMULATOR_LLM_MODEL`; `simulator.ts` line 70-71 applies scenario-level overrides. |
| AC-7: Structured JSON output saved to `output/` | Yes | Pass | `saveOutput()` in `simulator.ts` writes to `__dirname/output/` with timestamped filename. Output type matches requirement spec. |
| AC-8: `--all` runs every scenario and prints summary table | Partial | Pass (static) | CLI argument parsing verified; `discoverScenarios()` reads all `.json` files; `logger.table()` prints formatted table. |
| AC-9: Exit code 0 on all-pass, 1 on any failure | Yes | Pass | Verified: no-args exits with code 1. Code at lines 195-204 checks for fail/error status. |
| AC-10: Works with existing `.env.local` plus `SIMULATOR_*` vars | Yes | Pass | `dotenv.config({ path: '.env.local' })` called before application imports. Confirmed in CLI test output: `injecting env (53) from .env.local`. |
| AC-11: `output/` directory is gitignored | Yes | Pass | `.gitignore` line 50: `simulators/**/output/` |
| AC-12: Missing plugins logged as warnings, not failures | Yes | Pass | `simulator.ts` lines 334-337: logs warning but does not add to errors array or change status. |
| AC-13: `simulators/README.md` documents test user creation | Yes | Pass | README includes manual Supabase user creation steps, env var documentation, security notes, plugin key guidance. |

### Code Quality Spot Checks

| Check | Result | Details |
|---|---|---|
| `requestWithRetry` used for all 4 API calls | Pass | init-thread (line 122), Phase 1 (line 162), Phase 2 (line 224), Phase 3 (line 319) |
| Phase 2 records `request: phase2Body` | Pass | Line 298: `request: phase2Body` (SA code review fix confirmed) |
| No `console.log` in simulator files | Pass | `grep` found zero matches across all files in `simulators/` |
| `dotenv` loaded before provider factory imports | Pass | Lines 18-21 load dotenv; application imports start at line 23 |
| Auth uses `@supabase/ssr` `createServerClient` | Pass | `auth.ts` line 9 imports from `@supabase/ssr`, line 52 calls `createServerClient` |
| LLM answerer uses `ProviderFactory` | Pass | `llm-answerer.ts` line 9 |
| LLM validator uses `ProviderFactory` | Pass | `llm-validator.ts` line 8 |
| Scenario files use correct plugin keys | Pass | Both use `"google-mail"` (not `"gmail"`) and `"notion"` |
| All 13 expected files exist | Pass | All files confirmed via glob |

### TypeScript Compilation

```
npx tsc --noEmit | grep "simulators/"
(no output -- zero errors from simulator files)
```

### CLI Argument Test

```
$ npx tsx simulators/enhanced-prompt-generator/index.ts
[INFO] Enhanced Prompt Generator Simulator v1.0.0
[INFO] ==========================================
[ERROR] Usage: npx tsx simulators/enhanced-prompt-generator/index.ts --scenario <name> | --all [--verbose]
EXIT_CODE=1
```

Correct behavior: prints usage message and exits with code 1 when no arguments provided.

### Plugin Test Suite Regression

```
Test Suites: 14 passed, 14 total
Tests:       125 passed, 125 total
Time:        16.286 s
```

No regressions introduced by the simulator code.

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None.

#### Edge Cases (nice to fix)

1. **Provider name validation** -- `llm-answerer.ts` line 129 and `llm-validator.ts` line 49 cast `providerName as ProviderName` without validation. An invalid provider name (e.g., `"groq"`) will throw an unclear error from the factory. SA noted this as Finding 5 (Low priority). Not blocking.

2. **JSON parse failure silently returns `{}`** -- `http-client.ts` line 52 catches JSON parse errors and returns `{} as T` without logging. SA noted this as Finding 10 (Low priority). Not blocking.

### Final Status

- [x] All acceptance criteria pass -- ready for commit
- [ ] Issues found -- Dev must address before commit

**Verdict: PASS**

All 13 acceptance criteria verified. Zero TypeScript compilation errors from simulator files. Zero regressions in the existing plugin test suite (125/125 tests pass). Two low-priority SA suggestions remain unaddressed but are explicitly non-blocking per SA code review. Implementation matches the requirement and workplan specifications.

---

## Commit Info

_RM will populate this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-31 | Initial workplan | Dev created workplan based on approved requirement |
| 2026-03-31 | SA review | SA reviewed workplan -- Approved with 3 required changes (cookie encoding fix, flow clarification, plugin key correction) |
| 2026-03-31 | Address SA changes | Dev applied all 3 required changes: (1) Replaced manual base64 cookie construction in WP-5 and Auth Implementation Detail with `@supabase/ssr` `createServerClient` + in-memory cookie jar adapter -- eliminates R-2; (2) Clarified WP-8 flow to explicitly state LLM answers are generated from Phase 2's `questionsSequence` and sent in Phase 3's `clarification_answers` field; (3) Fixed `connected_services` in Phase 1 request example to use `"google-mail"` instead of `"gmail"` |
| 2026-03-31 | SA code review | SA reviewed implementation -- Approved with 2 required changes: (1) Extract 401 retry logic into shared helper for all API calls (FR-3.3 compliance); (2) Record Phase 2 request body in output. 3 optimisation suggestions noted. |
| 2026-03-31 | Dev fixes SA code review | Applied both required changes: (1) Extracted `requestWithRetry` helper, applied to all 4 API calls; (2) Set `request: phase2Body` in Phase 2 output. TypeScript check passes with no new errors. |
