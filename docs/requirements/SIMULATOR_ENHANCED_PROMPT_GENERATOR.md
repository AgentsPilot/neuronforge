# Requirement: Simulator - Enhanced Prompt Generator

> **Last Updated**: 2026-04-03

**Created by:** BA
**Date:** 2026-03-31
**Status:** Approved

---

## Overview

The Enhanced Prompt Generator Simulator is a CLI tool that automates the thread-based agent creation flow (Phases 1-3) against the real running APIs. Given a natural-language prompt and scenario configuration, the simulator authenticates as a real user, calls `init-thread` and `process-message` endpoints, uses an LLM to answer Phase 2 clarification questions, and validates that the final enhanced prompt captures the original intent. Results are saved as JSON for inspection and regression tracking.

This is the first simulator in a planned family of simulators. The folder structure and shared utilities should be designed with extensibility in mind.

---

## Table of Contents

- [Goals](#goals)
- [Non-Goals](#non-goals)
- [User Stories](#user-stories)
- [Architecture](#architecture)
- [Auth Strategy](#auth-strategy)
- [Functional Requirements](#functional-requirements)
- [Scenario File Specification](#scenario-file-specification)
- [Output Specification](#output-specification)
- [Acceptance Criteria](#acceptance-criteria)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Notes on Integration Points](#notes-on-integration-points)
- [Change History](#change-history)

---

## Goals

1. Automate end-to-end testing of the agent creation flow (Phases 1 through 3) without manual UI interaction
2. Validate that the enhanced prompt produced by Phase 3 faithfully captures the original user intent
3. Enable regression testing by running multiple scenarios in sequence and saving structured output
4. Use real LLM calls throughout (no mocks) to test the actual API behavior
5. Require zero changes to existing API routes -- the simulator authenticates through existing mechanisms

## Non-Goals

1. Replacing unit or integration tests for individual API routes
2. Testing Phase 4 (technical workflow generation) -- future simulator
3. Testing the UI layer or frontend components
4. Running in CI/CD pipelines (future consideration, may require dedicated test credentials)
5. Mocking LLM responses -- the simulator calls real APIs

---

## User Stories

- As a developer, I want to run a CLI command that executes the full agent creation flow for a given prompt so that I can verify the pipeline produces correct enhanced prompts without manually clicking through the UI
- As a developer, I want to define multiple scenarios as configuration files so that I can run regression suites across different prompt types
- As a developer, I want the simulator to use an LLM to answer Phase 2 clarification questions so that the flow completes autonomously without human intervention
- As a developer, I want the simulator output saved as structured JSON so that I can compare results across runs and detect regressions
- As a developer, I want an automated LLM-based validation step that checks whether the enhanced prompt captures the original intent so that I get a pass/fail signal without manual review

---

## Architecture

### Folder Structure

```
simulators/
  enhanced-prompt-generator/
    index.ts                    # CLI entry point
    simulator.ts                # Core simulator orchestration logic
    auth.ts                     # Authentication helper (session management)
    llm-answerer.ts             # LLM-based Phase 2 question answerer
    llm-validator.ts            # LLM-based enhanced prompt validation
    types.ts                    # TypeScript types for scenario, output, config
    scenarios/
      gmail-summary.json        # Example scenario file
      leads-notion.json         # Example scenario file
    output/                     # Generated output (gitignored)
      gmail-summary_2026-03-31T10-00-00.json
  shared/                       # Shared utilities for all simulators (future)
    http-client.ts              # HTTP client with cookie jar support
    logger.ts                   # Simulator logging utility
    types.ts                    # Shared types across simulators
  README.md                     # Setup instructions including test user creation
```

### Simulator Flow

```
1. Load scenario file
2. Authenticate (obtain session cookies)
3. Call POST /api/agent-creation/init-thread
   -> Receive thread_id
4. Call POST /api/agent-creation/process-message (Phase 1)
   -> Send user_prompt from scenario
   -> Receive Phase 1 analysis with clarification questions
5. Use LLM to generate answers to Phase 2 clarification questions
   -> Input: original prompt + questions from Phase 1
   -> Output: clarification_answers object
6. Call POST /api/agent-creation/process-message (Phase 2)
   -> Send clarification_answers
   -> Receive enhanced_prompt draft
7. Call POST /api/agent-creation/process-message (Phase 3)
   -> Send enhanced_prompt for finalization
   -> Receive final enhanced_prompt with OAuth gate status
8. Validate: send original prompt + final enhanced_prompt to LLM
   -> Ask: "Does this enhanced prompt faithfully capture the original intent?"
   -> Receive pass/fail with reasoning
9. Save full output as JSON
```

### Execution Method

```bash
# Run a single scenario
npx tsx simulators/enhanced-prompt-generator/index.ts --scenario gmail-summary

# Run all scenarios in the scenarios folder
npx tsx simulators/enhanced-prompt-generator/index.ts --all

# Run with verbose logging
npx tsx simulators/enhanced-prompt-generator/index.ts --scenario gmail-summary --verbose
```

---

## Auth Strategy

### Problem

The existing API routes authenticate via `getUser()` in `lib/auth.ts`, which reads Supabase auth cookies from the Next.js `cookies()` header store. The simulator runs as a CLI process, not a browser, so it has no cookies.

### Recommended Approach: Supabase `signInWithPassword` + Cookie Forwarding

The simulator authenticates using Supabase's `signInWithPassword()` with dedicated test credentials stored in environment variables, then forwards the resulting session tokens as cookies on every HTTP request.

**How it works:**

1. The simulator creates a Supabase client using `@supabase/supabase-js` with the project's anon key (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
2. It calls `supabase.auth.signInWithPassword({ email, password })` using env vars `SIMULATOR_USER_EMAIL` and `SIMULATOR_USER_PASSWORD`
3. The sign-in returns `session.access_token` and `session.refresh_token`
4. The simulator includes these tokens as Supabase auth cookies on every HTTP request to the API:
   - `sb-<project-ref>-auth-token` cookie containing the base64-encoded session JSON
   - Alternatively, set the cookies in the format that `@supabase/ssr` expects (the `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1` chunked format)
5. The existing `getUser()` function in `lib/auth.ts` reads these cookies via `cookies()` and validates the session -- no API route changes needed

**Why this approach:**

| Criterion | Assessment |
|-----------|------------|
| Zero API changes | The simulator authenticates exactly as the browser does |
| Uses real auth | The session is a real Supabase session with RLS enforcement |
| Simple implementation | Supabase JS client handles token management |
| Test isolation | Dedicated test user account ensures simulator data is separate |

**Required environment variables (add to `.env.local` or simulator-specific `.env`):**

```
SIMULATOR_USER_EMAIL=simulator@yourdomain.com
SIMULATOR_USER_PASSWORD=<secure-password>
SIMULATOR_BASE_URL=http://localhost:3000
SIMULATOR_LLM_PROVIDER=openai
SIMULATOR_LLM_MODEL=gpt-4o
```

**Test user setup:**

The simulator requires a dedicated Supabase user account. Manual creation steps are documented in `simulators/README.md`. This includes:

- Creating the user in the Supabase dashboard or via the Supabase CLI
- Configuring plugin connections for the scenarios being tested (e.g., Gmail, Notion)
- Ensuring the user's `plugin_connections` table entries are pre-configured

A setup script to automate user creation is a future enhancement (see [Out of Scope](#out-of-scope--future-roadmap)).

### Alternative Considered: Service Role Token Injection

Injecting a service-role-based session was considered but rejected because:
- It bypasses RLS, which means the simulator would not test the same auth path as real users
- It would require understanding the internal cookie format that `@supabase/ssr` expects, which is fragile
- It would not test the actual authentication flow

---

## Functional Requirements

### FR-1: CLI Entry Point

1. The CLI accepts `--scenario <name>` to run a single scenario by filename (without extension)
2. The CLI accepts `--all` to run every `.json` file in the `scenarios/` folder
3. The CLI accepts `--verbose` for detailed console logging
4. The CLI exits with code 0 if all scenarios pass validation, code 1 if any fail
5. The CLI prints a summary table at the end showing each scenario's status (pass/fail/error), duration, and validation result

### FR-2: Scenario Loading

1. Scenarios are loaded from `simulators/enhanced-prompt-generator/scenarios/`
2. Each scenario is a single JSON file conforming to the schema defined in [Scenario File Specification](#scenario-file-specification)
3. Invalid scenario files produce a clear error message and are skipped (not crash the whole run)

### FR-3: Authentication

1. The simulator authenticates once per run using `signInWithPassword()`
2. Session tokens are cached and reused across all scenarios in a run
3. If the session expires mid-run, the simulator re-authenticates automatically
4. Auth failure at startup is a fatal error -- the simulator exits with a clear message

### FR-4: Phase 1 Execution (Analyze)

1. Call `POST /api/agent-creation/init-thread` to create a new thread
2. Call `POST /api/agent-creation/process-message` with `phase: 1` and the scenario's `user_prompt`
3. Optionally include `connected_services` from the scenario file if specified
4. Optionally include `user_context` from the scenario file if specified
5. Store the full Phase 1 response (analysis, clarification questions, connected plugins)

### FR-5: Phase 2 Execution (Clarify)

1. Extract clarification questions from the Phase 1 response
2. If no clarification questions exist, skip Phase 2 (proceed directly to Phase 3)
3. Send the original prompt and clarification questions to an LLM to generate answers
4. The LLM answerer should produce answers that are consistent with the original prompt's intent
5. If the scenario file includes `clarification_overrides`, use those values instead of LLM-generated answers for the specified questions
6. Call `POST /api/agent-creation/process-message` with `phase: 2` and the generated answers
7. Store the full Phase 2 response (enhanced prompt draft)

### FR-6: Phase 3 Execution (Finalize)

1. Call `POST /api/agent-creation/process-message` with `phase: 3`
2. Store the full Phase 3 response (final enhanced prompt, OAuth gate status)
3. If Phase 3 reports `missingPlugins`, the simulator logs a warning but does not treat it as a failure. The simulator tests prompt generation, not plugin connectivity. The warning is recorded in the output under `phases.phase3.missing_plugins`.

### FR-7: LLM-Based Answerer and Validator

1. The LLM answerer (Phase 2 question answering) and LLM validator (post-Phase 3 intent check) must use the provider factory from `lib/ai/providerFactory.ts` for consistency with the rest of the platform
2. The provider and model used for answerer and validator calls are configured via environment variables: `SIMULATOR_LLM_PROVIDER` (default: `"openai"`) and `SIMULATOR_LLM_MODEL` (default: provider's default model)
3. Scenario-level overrides via `ai_provider` and `ai_model` fields in the scenario file take precedence over the environment variable defaults for that scenario's answerer and validator calls
4. After Phase 3 completes, send the original prompt and the final enhanced prompt to the LLM validator
5. The validation prompt should ask: "Does this enhanced prompt faithfully and completely capture the user's original intent? Are there any missing elements, misinterpretations, or additions that were not requested?"
6. The LLM returns a structured response: `{ pass: boolean, reasoning: string, issues: string[] }`
7. A validation failure does not prevent output from being saved -- it is recorded in the output

### FR-8: Output Saving

1. Save complete output as JSON to `simulators/enhanced-prompt-generator/output/`
2. Filename format: `<scenario-name>_<ISO-timestamp>.json`
3. Output structure defined in [Output Specification](#output-specification)
4. The `output/` directory should be gitignored

### FR-9: Error Handling

1. HTTP errors from API calls are caught, logged, and recorded in the output (not thrown)
2. LLM errors (answerer or validator) are caught and recorded; the scenario is marked as `error`
3. Each scenario runs independently -- one scenario failure does not stop subsequent scenarios
4. All errors include the phase where they occurred and the raw error response

---

## Scenario File Specification

**File:** `simulators/enhanced-prompt-generator/scenarios/<name>.json`

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
  "connected_services": ["gmail", "notion"],
  "clarification_overrides": {
    "Which Notion database should be used?": "My daily summaries database"
  },
  "expected_services": ["gmail", "notion"],
  "tags": ["email", "summarization", "notion"],
  "ai_provider": "openai",
  "ai_model": "gpt-4o"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique scenario identifier (used in output filename) |
| `description` | string | Yes | Human-readable description of what this scenario tests |
| `user_prompt` | string | Yes | The natural-language prompt to send in Phase 1 |
| `user_context` | object | No | User context to include in Phase 1 (overrides server defaults) |
| `connected_services` | string[] | No | Plugin keys to pass as connected services. If omitted, the API fetches from the user's actual connections |
| `clarification_overrides` | object | No | Map of question text (partial match) to predetermined answers. Overrides LLM-generated answers for matching questions |
| `expected_services` | string[] | No | Services expected in the final enhanced prompt (for validation) |
| `tags` | string[] | No | Tags for filtering/grouping scenarios |
| `ai_provider` | string | No | AI provider for this scenario's answerer/validator LLM calls (overrides `SIMULATOR_LLM_PROVIDER` env var) |
| `ai_model` | string | No | AI model for this scenario's answerer/validator LLM calls (overrides `SIMULATOR_LLM_MODEL` env var) |

---

## Output Specification

**File:** `simulators/enhanced-prompt-generator/output/<name>_<timestamp>.json`

```json
{
  "scenario": {
    "name": "gmail-summary",
    "user_prompt": "Summarize my last 10 Gmail emails...",
    "file": "gmail-summary.json"
  },
  "run": {
    "timestamp": "2026-03-31T10:00:00.000Z",
    "duration_ms": 45200,
    "simulator_version": "1.0.0",
    "base_url": "http://localhost:3000",
    "ai_provider": "openai",
    "ai_model": "gpt-4o"
  },
  "auth": {
    "success": true,
    "user_id": "uuid",
    "email": "simulator@yourdomain.com"
  },
  "phases": {
    "phase1": {
      "success": true,
      "duration_ms": 12300,
      "thread_id": "thread_abc123",
      "request": { "...phase 1 request body..." },
      "response": { "...full Phase 1 API response..." },
      "clarification_questions": ["Question 1?", "Question 2?"]
    },
    "phase2": {
      "success": true,
      "duration_ms": 15400,
      "skipped": false,
      "generated_answers": { "Question 1?": "Answer 1", "Question 2?": "Answer 2" },
      "request": { "...phase 2 request body..." },
      "response": { "...full Phase 2 API response..." }
    },
    "phase3": {
      "success": true,
      "duration_ms": 8900,
      "request": { "...phase 3 request body..." },
      "response": { "...full Phase 3 API response..." },
      "enhanced_prompt": { "...extracted enhanced prompt object..." },
      "missing_plugins": []
    }
  },
  "validation": {
    "pass": true,
    "reasoning": "The enhanced prompt accurately captures...",
    "issues": [],
    "duration_ms": 3200
  },
  "status": "pass",
  "errors": []
}
```

| Top-Level Field | Description |
|-----------------|-------------|
| `scenario` | Metadata about the scenario that was run |
| `run` | Execution metadata (timing, environment) |
| `auth` | Authentication result |
| `phases` | Per-phase request/response pairs with timing |
| `validation` | LLM validation result (pass/fail + reasoning) |
| `status` | Overall status: `"pass"`, `"fail"` (validation failed), or `"error"` (execution error) |
| `errors` | Array of error objects if any phase failed |

---

## Non-Functional Requirements

- **Performance:** Each scenario should complete within 120 seconds (accounting for multiple LLM calls). The simulator should log a warning if a scenario exceeds 90 seconds.
- **Security:** Test credentials must never be committed to the repository. They must come from environment variables or a local `.env` file that is gitignored.
- **Reliability:** The simulator must handle transient API errors gracefully (log and continue to next scenario, do not crash).
- **Observability:** All HTTP requests and responses should be logged at verbose level. Summary output should be printed at normal level.

---

## Acceptance Criteria

- [ ] Running `npx tsx simulators/enhanced-prompt-generator/index.ts --scenario <name>` executes the full Phase 1-3 flow against a running local server
- [ ] The simulator authenticates using `signInWithPassword()` with env var credentials and forwards session cookies -- no changes to any existing API route
- [ ] Phase 2 clarification questions are answered by an LLM call using the provider factory (`lib/ai/providerFactory.ts`), producing contextually appropriate answers
- [ ] The `clarification_overrides` field in the scenario file overrides LLM answers for matching questions
- [ ] After Phase 3, an LLM-based validation checks that the enhanced prompt captures the original intent
- [ ] LLM provider/model for answerer and validator is configurable via `SIMULATOR_LLM_PROVIDER` and `SIMULATOR_LLM_MODEL` env vars, with per-scenario overrides
- [ ] A structured JSON output file is saved to `simulators/enhanced-prompt-generator/output/`
- [ ] Running with `--all` executes every scenario in the `scenarios/` folder and prints a summary table
- [ ] The CLI exits with code 0 on all-pass, code 1 on any failure or error
- [ ] The simulator works with the existing `.env.local` environment variables plus the `SIMULATOR_*` variables
- [ ] The `output/` directory is gitignored
- [ ] Missing plugin connections reported by Phase 3 are logged as warnings, not treated as failures
- [ ] A `simulators/README.md` file documents the manual test user creation steps

---

## Out of Scope / Future Roadmap

- **Phase 4 simulation:** Extending the simulator to test technical workflow generation (Phase 4) is planned as a follow-up
- **CI/CD integration:** Running simulators in CI pipelines with dedicated test infrastructure
- **Snapshot-based regression:** Comparing output JSON against baseline snapshots to detect unexpected changes
- **Additional simulators:** The `simulators/` top-level folder is designed to host multiple simulators (e.g., V6 pipeline simulator, plugin execution simulator)
- **Parallel scenario execution:** Running multiple scenarios concurrently for faster regression runs
- **Retry logic:** Automatic retry on transient LLM or API failures
- **Test user setup script:** Automated script for creating the simulator test user and configuring plugin connections

---

## Resolved Questions

| # | Question | Resolution | Resolved Date |
|---|----------|------------|---------------|
| 1 | Which LLM provider/model should the simulator use for answerer and validator calls? | Use the provider factory from `lib/ai/providerFactory.ts` for consistency. Provider and model are configured via `SIMULATOR_LLM_PROVIDER` and `SIMULATOR_LLM_MODEL` env vars, with per-scenario overrides via `ai_provider`/`ai_model` fields. | 2026-04-03 |
| 2 | Should the test user be manually created or should we provide a setup script? | Document manual creation steps in `simulators/README.md`. A setup script is a future enhancement. | 2026-04-03 |
| 3 | How should missing plugin connections be handled? | Scenarios log a warning if Phase 3 reports missing plugins, but do not treat it as a failure. The simulator tests prompt generation, not plugin connectivity. | 2026-04-03 |

---

## Notes on Integration Points

| System | Impact | Details |
|--------|--------|---------|
| `POST /api/agent-creation/init-thread` | Read-only consumer | Simulator calls this endpoint; no changes required |
| `POST /api/agent-creation/process-message` | Read-only consumer | Simulator calls this endpoint for phases 1-3; no changes required |
| `lib/auth.ts` (`getUser()`) | No changes | Simulator authenticates via cookie forwarding to work with existing auth |
| `@supabase/supabase-js` | New dependency usage | Simulator uses Supabase client for `signInWithPassword()` (already a project dependency) |
| `lib/ai/providerFactory.ts` | Consumer | Simulator uses provider factory for answerer and validator LLM calls |
| `agent_prompt_threads` table | Write side-effect | Each simulator run creates thread records. Consider periodic cleanup of simulator-created threads |
| `.gitignore` | Modification needed | Add `simulators/**/output/` to gitignore |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-31 | Initial draft | BA created requirement document based on user input |
| 2026-04-03 | Approved | Resolved all 3 open questions: (1) LLM calls use provider factory with SIMULATOR_LLM_PROVIDER/MODEL env vars, (2) test user setup documented in simulators/README.md, (3) missing plugins logged as warning not failure. Status changed from Draft to Approved. |
