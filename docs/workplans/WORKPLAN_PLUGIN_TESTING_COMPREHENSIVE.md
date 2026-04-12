# Workplan: Comprehensive Plugin Testing Suite

> **Last Updated**: 2026-04-12
> **Requirement**: [REQ_PLUGIN_TESTING_COMPREHENSIVE.md](/docs/requirements/REQ_PLUGIN_TESTING_COMPREHENSIVE.md)
> **Status**: SA APPROVED (conditional) -- Implementation in progress
> **Branch**: `feature/plugin-testing-comprehensive`

## Overview

This workplan implements the comprehensive plugin testing suite defined in REQ_PLUGIN_TESTING_COMPREHENSIVE. It covers 5 phases (Phase 0-4) plus cross-cutting test classification, targeting all 19 plugin executors. The work is triggered by bug D-B21 (catch blocks referencing undefined `error` variable).

---

## Table of Contents

- [SA Review Items](#sa-review-items)
- [Cross-Cutting: Test Classification Setup](#cross-cutting-test-classification-setup)
- [Phase 0: Plugin Definition Validation](#phase-0-plugin-definition-validation)
- [Phase 1: Catch-Block Audit and Error-Path Fixes](#phase-1-catch-block-audit-and-error-path-fixes)
- [Phase 2: Unit Tests for Untested Plugins](#phase-2-unit-tests-for-untested-plugins)
- [Phase 3: Systematic Error Scenario Coverage](#phase-3-systematic-error-scenario-coverage)
- [Phase 4: Integration Test Framework and CI/CD](#phase-4-integration-test-framework-and-cicd)
- [Task Checklist Summary](#task-checklist-summary)
- [Change History](#change-history)

---

## SA Review Items

The SA reviewed this workplan and provided 3 must-fix items and 4 recommendations. All have been incorporated into the tasks below.

| ID | Type | Summary | Resolution |
|----|------|---------|------------|
| SA-1 | Must-fix | `[smoke]`/`[full]` naming collision risk in `--testNamePattern` | Added naming convention rule to CC-T1: literal `[smoke]` and `[full]` must appear ONLY in classification describe blocks, never in `it` descriptions |
| SA-2 | Must-fix | `handleApiResponse` 204 handling is a real bug, not just a test | P3-T5 now explicitly requires fixing `handleApiResponse` to handle 204 No Content before adding tests |
| SA-3 | Must-fix | Null connection scenario in P3-T1 needs implementation clarification | P3-T1 now specifies: use `createMockUserConnections()` with no pluginKey to get `getConnection` returning null |
| SA-R1 | Recommendation | P1-T4 should use a minimal stub, not a real executor | P1-T4 updated to create `TestPluginExecutor extends BasePluginExecutor` stub in test file |
| SA-R2 | Recommendation | P4-T9 regression gate needs explicit timeout | P4-T9 updated with 60-second timeout for smoke test execution |
| SA-R3 | Recommendation | Add `mockFetchThrow` helper to mock-fetch.ts | Added to P3-T1 as prerequisite: extend `tests/plugins/common/mock-fetch.ts` with `mockFetchThrow(error)` |
| SA-R4 | Recommendation | Phase 0 definition fixes not tracked | Added P0-T3 task for fixing any definitions that fail validation |

---

## Cross-Cutting: Test Classification Setup

**Implements**: CC-01 through CC-05

All test files across every phase must use a `describe('[smoke]', ...)` / `describe('[full]', ...)` nesting convention. This section defines the infrastructure tasks that must be completed first (or in parallel with Phase 0).

### Tasks

- [x] **CC-T1**: Add npm script `test:plugins:smoke` to `package.json`
  - **File**: `package.json`
  - **Details**: Add script that runs Jest with `--testNamePattern="\[smoke\]"` to filter only smoke describe blocks. Example: `"test:plugins:smoke": "jest --config jest.config.js tests/plugins/ --testNamePattern=\"\\[smoke\\]\" --verbose"`
  - **SA-1 naming convention rule**: The literal strings `[smoke]` and `[full]` must appear ONLY in classification `describe()` block names, NEVER in `it()` block descriptions. This prevents false matches from `--testNamePattern`. All contributors must follow this rule.
  - **Acceptance**: Running `npm run test:plugins:smoke` executes only tests inside `[smoke]` describe blocks

- [x] **CC-T2**: Retrofit existing 11 tested plugins with `[smoke]`/`[full]` describe block classification
  - **Files**: All existing test files in `tests/plugins/unit-tests/`
  - **Details**: Wrap existing happy-path tests in `describe('[smoke]', ...)` and error/edge-case tests in `describe('[full]', ...)`. Do NOT change test logic -- only add wrapper describe blocks.
  - **Existing files to retrofit**:
    - `tests/plugins/unit-tests/airtable.test.ts`
    - `tests/plugins/unit-tests/document-extractor.test.ts`
    - `tests/plugins/unit-tests/google-calendar.test.ts`
    - `tests/plugins/unit-tests/google-docs.test.ts`
    - `tests/plugins/unit-tests/google-drive.test.ts`
    - `tests/plugins/unit-tests/google-mail.test.ts`
    - `tests/plugins/unit-tests/google-sheets.test.ts`
    - `tests/plugins/unit-tests/hubspot.test.ts`
    - `tests/plugins/unit-tests/linkedin.test.ts`
    - `tests/plugins/unit-tests/slack.test.ts`
    - `tests/plugins/unit-tests/whatsapp-business.test.ts`
  - **Acceptance**: All 106 existing tests still pass; each test is inside either `[smoke]` or `[full]` block

- [x] **CC-T3**: Document test classification in README (completed as part of P4-T10)

---

## Phase 0: Plugin Definition Validation

**Implements**: P0-01 through P0-05
**SA audit boundary**: After Phase 0 completion

### Tasks

- [x] **P0-T1**: Create plugin definition validation test file
  - **File**: `tests/plugins/plugin-definitions.test.ts`
  - **Details**: Single test file that dynamically discovers all `*-plugin-v2.json` files in `lib/plugins/definitions/`. Wraps all tests in `describe('[smoke]', ...)` per CC-01/P0-05.
  - **Validations to implement**:
    1. **Required-vs-properties consistency (P0-01)**: For each action, every field in `parameters.required` must exist as a key in `parameters.properties`. Flag mismatches.
    2. **Output schema validity (P0-02)**: Each action's `output_schema` must be valid JSON Schema (draft-07+). Use `ajv` package (already in project deps or add as devDep) to compile each output_schema and check for errors.
    3. **x-variable-mapping resolution (P0-03)**: For each action parameter, if `x-variable-mapping` exists, every referenced field must exist in the action's `properties`. Flag dangling references.
  - **Test structure**:
    ```
    describe('Plugin Definition Validation', () => {
      describe('[smoke]', () => {
        // dynamically generate tests per plugin file
        describe('{plugin-name} definition', () => {
          it('required params exist in properties for all actions')
          it('output_schema blocks are valid JSON Schema')
          it('x-variable-mapping references resolve')
        })
      })
    })
    ```
  - **Acceptance**: All 19 plugin definitions pass; test auto-discovers new plugins

- [x] **P0-T2**: Install `ajv` as devDependency if not already present
  - **File**: `package.json`
  - **Details**: `npm install --save-dev ajv` for JSON Schema validation in P0-T1. Check if already available first.
  - **Resolution**: `ajv` already present in dependencies (^8.17.1) and `ajv-formats` in devDependencies. No installation needed.

- [ ] **P0-T3**: Fix any plugin definition inconsistencies discovered by P0-T1 (SA-R4)
  - **Files**: Any `lib/plugins/definitions/*-plugin-v2.json` that fails validation
  - **Details**: If P0-T1 reveals required-vs-properties mismatches, invalid output_schema, or broken x-variable-mapping references, fix the definitions. These fixes are prerequisites for Phase 2 output schema conformance tests (P2-T9).
  - **Acceptance**: All 19 definitions pass P0-T1 validation
  - **Status**: Pending -- need to run P0-T1 tests to discover any issues

---

## Phase 1: Catch-Block Audit and Error-Path Fixes

**Implements**: P1-01 through P1-08
**SA audit boundary**: After Phase 1 completion

### Task 1: Catch-Block Audit (P1-01)

- [x] **P1-T1**: Audit all catch blocks in all 19 executor files
  - **Files**: All `lib/server/*-plugin-executor.ts` files
  - **Output**: Populate the catch-block catalog table below with findings
  - **Details**: For each catch block, record: file, line number, caught variable name, what the catch block does (return/throw/log), and whether it exhibits the D-B21 pattern (referencing undefined `error` instead of the caught exception parameter).

**Catch-Block Catalog**:

The D-B21 bug is a specific pattern: inside `if (!response.ok)` blocks, `this.logger.error({ err: error }, ...)` references an undefined `error` variable instead of the in-scope `errorData`/`errorText`. This causes silent logging failures (the `err` field is `undefined`) but does NOT prevent the subsequent `throw new Error(...)` from propagating -- so the error still reaches the caller, but structured logs lose the error context.

**D-B21 Bug Instances (16 total across 3 files):**

| Plugin | File | Line | Caught Var | D-B21 Bug? | Action | Status | Covering Test |
|--------|------|------|------------|------------|--------|--------|---------------|
| google-calendar | google-calendar-plugin-executor.ts | 85 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-calendar.test.ts |
| google-calendar | google-calendar-plugin-executor.ts | 217 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-calendar.test.ts |
| google-calendar | google-calendar-plugin-executor.ts | 274 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-calendar.test.ts |
| google-calendar | google-calendar-plugin-executor.ts | 324 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-calendar.test.ts |
| google-calendar | google-calendar-plugin-executor.ts | 374 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-calendar.test.ts |
| google-calendar | google-calendar-plugin-executor.ts | 410 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-calendar.test.ts |
| google-docs | google-docs-plugin-executor.ts | 72 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-docs.test.ts |
| google-docs | google-docs-plugin-executor.ts | 182 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-docs.test.ts |
| google-docs | google-docs-plugin-executor.ts | 217 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-docs.test.ts |
| google-docs | google-docs-plugin-executor.ts | 253 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-docs.test.ts |
| google-docs | google-docs-plugin-executor.ts | 296 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-docs.test.ts |
| google-docs | google-docs-plugin-executor.ts | 348 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-docs.test.ts |
| google-drive | google-drive-plugin-executor.ts | 98 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-drive.test.ts |
| google-drive | google-drive-plugin-executor.ts | 168 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-drive.test.ts |
| google-drive | google-drive-plugin-executor.ts | 227 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-drive.test.ts |
| google-drive | google-drive-plugin-executor.ts | 383 | N/A (if block) | YES | logger refs undefined `error` instead of `errorData` | Fixed | google-drive.test.ts |

**Catch blocks with NO D-B21 bug (correct variable references):**

| Plugin | File | Pattern | Notes |
|--------|------|---------|-------|
| airtable | airtable-plugin-executor.ts | No catch blocks in executor methods | Uses `handleApiResponse` from base class |
| chatgpt-research | chatgpt-research-plugin-executor.ts | `catch (error: any)` x4 | All properly reference `error.message` and re-throw |
| discord | discord-plugin-executor.ts | No catch in action methods | `makeDiscordRequest` handles errors inline, no D-B21 |
| document-extractor | document-extractor-plugin-executor.ts | `catch (error)` x1 | Correctly returns empty string fallback |
| dropbox | dropbox-plugin-executor.ts | `catch` (bare) x2, `catch (error: any)` x1 | Bare catches are JSON.parse fallbacks (acceptable); `error: any` properly re-throws |
| google-base | google-base-plugin-executor.ts | `catch (parseError)` x1, `catch (cleanupError)` x1 | Both correctly scoped |
| gmail | gmail-plugin-executor.ts | `catch (error)` x3 | All properly scoped (in catch blocks) |
| google-sheets | google-sheets-plugin-executor.ts | `catch (error)` x1, `catch (e)` x1 | All correctly scoped |
| hubspot | hubspot-plugin-executor.ts | `catch (error: any)` x5, `catch` (bare) x1 | All properly re-throw; bare catch is JSON parse fallback |
| linkedin | linkedin-plugin-executor.ts | No catch blocks in action methods | Uses `handleApiResponse` from base class |
| meta-ads | meta-ads-plugin-executor.ts | No catch blocks in action methods | `makeMetaRequest` handles errors inline |
| notion | notion-plugin-executor.ts | No catch blocks in action methods | Uses `handleApiResponse` from base class |
| onedrive | onedrive-plugin-executor.ts | `catch (error)` x1 | Correctly scoped in getOrCreateFolder |
| outlook | outlook-plugin-executor.ts | No catch blocks in action methods | `makeGraphRequest` handles errors inline |
| salesforce | salesforce-plugin-executor.ts | No catch blocks in action methods | `makeSalesforceRequest` handles errors inline |
| slack | slack-plugin-executor.ts | `catch (error)` x3, `catch` (bare) x1 | All correctly scoped |
| whatsapp-business | whatsapp-business-plugin-executor.ts | `catch (parseError)` x1 | Correctly scoped |
| base-plugin-executor | base-plugin-executor.ts | `catch (error: any)` x2 | Both correctly reference `error` |

### Task 2: Fix D-B21 Bugs (P1-02, P1-03, P1-04)

- [x] **P1-T2**: Fix all catch blocks exhibiting the D-B21 pattern
  - **Files**: Each executor file identified in audit
  - **Details**:
    - Replace `catch { ... error ... }` with `catch (err) { ... err ... }` (or equivalent)
    - Ensure all catch blocks return `{ success: false, error: <message> }` with the actual error message
    - Ensure no catch block silently swallows exceptions (no empty catch, no catch returning success)
    - Preserve existing logger calls but fix the variable reference

### Task 3: Unit Tests for Fixed Catch Blocks (P1-05)

- [x] **P1-T3**: Add unit tests for each fixed catch block
  - **Files**: New or extended test files in `tests/plugins/unit-tests/`
  - **Details**: For each fixed catch block, add a test that:
    1. Mocks fetch to trigger the error path (e.g., `mockFetchError(500, 'Server Error')`)
    2. Calls `executor.executeAction()` with valid params
    3. Asserts `result.success === false` and error message is meaningful (not undefined, not empty)
  - **Classification**: Basic error tests = `[smoke]`, edge-case error tests = `[full]`

### Task 4: Base Executor Error Propagation Chain Test (P1-07)

- [x] **P1-T4**: Test full error propagation through BasePluginExecutor
  - **File**: `tests/plugins/unit-tests/base-executor.test.ts` (new file)
  - **Details**: Create a minimal `TestPluginExecutor extends BasePluginExecutor` stub in the test file with a controllable `executeSpecificAction` that can be configured to throw or return specific values. This isolates the base class test from any specific plugin's behavior (SA-R1). Do NOT use a real executor for these tests.
  - **Test scenarios**:
    1. `executeSpecificAction` throws `new Error('API failed')` --> result is `{ success: false }` with error message containing 'API failed'
    2. `executeSpecificAction` throws an error with a `.code` property --> result.error contains that code
    3. The base class validation gate (missing required params) still works independently of executor errors
  - **Classification**: `[smoke]` for basic propagation, `[full]` for edge cases

### Task 5: Base Executor normalizeParameters Tests (P1-08)

- [x] **P1-T5**: Test `normalizeParameters()` behavior in BasePluginExecutor
  - **File**: `tests/plugins/unit-tests/base-executor.test.ts` (same file as P1-T4)
  - **Details**: The normalization logic is in `executeAction()` (lines 30-40 of `lib/server/base-plugin-executor.ts`). It converts string values to single-element arrays when the action's schema declares `type: "array"`.
  - **Test scenarios**:
    1. String value for array-typed parameter is normalized to `[string]` (e.g., `add_labels: "AgentsPilot"` becomes `["AgentsPilot"]`)
    2. Value already an array is left unchanged
    3. Non-array schema fields are not affected
  - **Approach**: Use the `TestPluginExecutor` stub from P1-T4 with a mock plugin definition that declares an array-typed parameter. This avoids coupling to any specific plugin.
  - **Classification**: `[smoke]`

---

## Phase 2: Unit Tests for Untested Plugins

**Implements**: P2-01 through P2-10
**SA audit boundary**: After Phase 2 completion

### Task 1: Create Test Files for 8 Untested Plugins (P2-01 through P2-06)

For each plugin, create a test file following the established pattern (see `tests/plugins/unit-tests/google-mail.test.ts` as reference).

- [x] **P2-T1**: `tests/plugins/unit-tests/chatgpt-research.test.ts`
  - **Executor**: `lib/server/chatgpt-research-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/chatgpt-research-plugin-v2.json`
  - **Details**: Cover all actions in definition. Each action gets: happy-path (`[smoke]`), error-path (`[full]`), input-validation (`[full]`).

- [x] **P2-T2**: `tests/plugins/unit-tests/discord.test.ts`
  - **Executor**: `lib/server/discord-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/discord-plugin-v2.json`
  - **Actions to cover**: send_message, get_channels, list_guilds, get_messages, create_channel, delete_message

- [x] **P2-T3**: `tests/plugins/unit-tests/dropbox.test.ts`
  - **Executor**: `lib/server/dropbox-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/dropbox-plugin-v2.json`

- [x] **P2-T4**: `tests/plugins/unit-tests/meta-ads.test.ts`
  - **Executor**: `lib/server/meta-ads-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/meta-ads-plugin-v2.json`

- [x] **P2-T5**: `tests/plugins/unit-tests/notion.test.ts`
  - **Executor**: `lib/server/notion-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/notion-plugin-v2.json`
  - **Actions to cover**: search, get_page, get_page_content, create_page, update_page, query_database, get_database, append_block_children

- [x] **P2-T6**: `tests/plugins/unit-tests/onedrive.test.ts`
  - **Executor**: `lib/server/onedrive-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/onedrive-plugin-v2.json`

- [x] **P2-T7**: `tests/plugins/unit-tests/outlook.test.ts`
  - **Executor**: `lib/server/outlook-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/outlook-plugin-v2.json`
  - **Actions to cover**: send_email, search_emails, create_draft, modify_message, get_email_attachment, list_events, create_event, update_event, delete_event, get_event_details

- [x] **P2-T8**: `tests/plugins/unit-tests/salesforce.test.ts`
  - **Executor**: `lib/server/salesforce-plugin-executor.ts`
  - **Definition**: `lib/plugins/definitions/salesforce-plugin-v2.json`
  - **Actions to cover**: create_lead, query_leads, update_lead, create_account, query_accounts, create_contact, query_contacts, create_opportunity, query_opportunities
  - **Mock connection override**: Add `instance_url` to `PLUGIN_DEFAULTS` in `tests/plugins/common/mock-connection.ts`

**Common requirements for all P2-T1 through P2-T8**:
- Use `createTestExecutor`, `mockFetchSuccess`, `mockFetchError`, `expectSuccessResult`, `expectErrorResult` from `tests/plugins/common/`
- Every action gets minimum 3 tests: happy-path, error-path, input-validation
- Happy-path tests tagged `[smoke]`, error/validation tests tagged `[full]`
- Mock connection overrides added to `PLUGIN_DEFAULTS` in `tests/plugins/common/mock-connection.ts` where needed (P2-06)

### Task 2: Output Schema Conformance Validation (P2-10)

- [ ] **P2-T9**: Add output schema validation to all happy-path tests
  - **Files**: All test files (both existing 11 and new 8)
  - **Details**: Create a helper function in `tests/plugins/common/test-helpers.ts` that validates a result's `data` field against the action's declared `output_schema` from the plugin JSON definition. Use `ajv` (installed in P0-T2) to compile and validate.
  - **Helper signature**: `expectOutputSchemaConformance(pluginManager, pluginKey, actionName, resultData)`
  - **Integration**: Call this helper in every happy-path test after `expectSuccessResult(result)`
  - **Prerequisite**: P0-T3 must be complete (all definitions must pass validation first)
  - **Acceptance**: Every happy-path test validates response structure against declared schema

### Task 3: Update Plugin Generation Workflow (P2-09)

- [x] **P2-T10**: Add mandatory test generation step to plugin workflow doc
  - **File**: `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`
  - **Details**: Add a new step (after executor generation) requiring creation of `tests/plugins/unit-tests/{pluginName}.test.ts` with minimum: one `[smoke]` happy-path test per action and one `[full]` error-path test per action. Include a template showing the expected test file structure.

### Task 4: Consolidate Tests (P2-07)

- [x] **P2-T11**: Search for and consolidate any plugin tests outside `tests/plugins/`
  - **Details**: Scan the repository for any `*.test.ts` files that test plugin executors but are located outside `tests/plugins/`. Move them into the canonical location.
  - **Acceptance**: No plugin executor tests exist outside `tests/plugins/`

---

## Phase 3: Systematic Error Scenario Coverage

**Implements**: P3-01 through P3-08
**SA audit boundary**: After Phase 3 completion

### Task 0: Add mockFetchThrow helper (SA-R3, prerequisite for P3-T1)

- [x] **P3-T0**: Add `mockFetchThrow` helper to mock-fetch.ts
  - **File**: `tests/plugins/common/mock-fetch.ts`
  - **Details**: Add a new helper function `mockFetchThrow(error: Error)` that mocks `global.fetch` to reject with the given error. This simulates network failures (DNS, timeout, connection reset) cleanly without inline mock overrides in every test file.
  - **Signature**: `export function mockFetchThrow(error: Error): void`

### Task 1: Shared Error Scenario Helper (P3-06)

- [x] **P3-T1**: Create shared error scenario test helper
  - **File**: `tests/plugins/common/error-scenarios.ts`
  - **Details**: Create a helper that runs a standard battery of error scenarios against any executor+action combination. Reduces boilerplate across all 19 plugin test files.
  - **Helper signature**:
    ```typescript
    export function runStandardErrorScenarios(
      getExecutor: () => any,
      pluginKey: string,
      actionName: string,
      validParams: Record<string, any>
    ): void
    ```
  - **Scenarios included**:
    1. Network failure -- uses `mockFetchThrow(new Error('Network error'))` from P3-T0
    2. HTTP 401 Unauthorized
    3. HTTP 403 Forbidden
    4. HTTP 404 Not Found
    5. HTTP 429 Rate Limited
    6. HTTP 500 Server Error
    7. Malformed JSON response
    8. Empty string response body
    9. Null connection -- create a separate executor instance using `createMockUserConnections()` with no pluginKey argument, which causes `getConnection` to return `null`. The helper must accept an optional `getNullConnectionExecutor` callback or internally construct one using the executor class (SA-3).
  - **All tests inside `describe('[full]', ...)`** per P3-07

### Task 2: Apply Error Scenarios to All 19 Plugins (P3-01 through P3-05)

- [x] **P3-T2**: Add error scenario coverage to all 19 plugin test files
  - **Files**: All test files in `tests/plugins/unit-tests/`
  - **Details**: For each plugin, add a `describe('[full]', () => { describe('error scenarios', ...)})` block that uses the shared helper from P3-T1 for at least 1-2 representative actions per plugin (the most commonly used actions). Additional plugin-specific error scenarios (e.g., pagination edge cases for plugins that support pagination) should be added as needed.
  - **Pagination edge cases (P3-05)**: For plugins with pagination (google-mail search, google-sheets read, notion query_database, hubspot queries, salesforce queries), add tests for: empty result set, single page, response indicating next page but no more data.

### Task 3: Malformed Response and Auth Edge Cases (P3-03, P3-04)

- [x] **P3-T3**: Add malformed response tests per plugin
  - **Files**: All test files in `tests/plugins/unit-tests/`
  - **Details**: For each plugin, add tests for:
    - Response body is valid JSON but missing expected fields
    - Response body is `null`
  - **Note**: Basic malformed JSON and empty string cases are covered by the shared helper (P3-T1). This task adds plugin-specific missing-field scenarios.
  - **Classification**: `[full]`

- [x] **P3-T4**: Add authentication edge case tests
  - **Files**: All test files in `tests/plugins/unit-tests/`
  - **Details**: For each plugin, test:
    - Expired token (connection with `expires_at` in the past) -- note: this is actually handled by `UserPluginConnections.getConnection()` which is mocked, so this test verifies the mock behavior path
    - Missing `access_token` in connection (override `access_token: ''`)
  - **Classification**: `[full]`

### Task 4: Base Executor handleApiResponse Tests and Fix (P3-08, SA-2)

- [x] **P3-T5**: Fix and test `handleApiResponse()` in BasePluginExecutor
  - **File (fix)**: `lib/server/base-plugin-executor.ts`
  - **File (test)**: `tests/plugins/unit-tests/base-executor.test.ts` (extend from Phase 1)
  - **Details**: `handleApiResponse(response, actionName)` at line 272 currently calls `response.json()` unconditionally on success responses. This is a confirmed bug for 204 No Content and non-JSON responses (SA-2).
  - **Fix first, then test**:
    1. **Fix `handleApiResponse`**: Add handling for 204 No Content (return `{}` instead of calling `.json()`). Add try-catch around `response.json()` for non-JSON response bodies, returning a meaningful error instead of crashing.
    2. **Test 204 No Content**: Response with `status: 204`, `ok: true`, empty body. Verify returns `{}`.
    3. **Test HTML error pages**: Response with `status: 411`, body is HTML string. Verify method throws meaningful error via the `!response.ok` branch, and does not crash on `.json()`.
    4. **Test non-JSON content types**: Response with `status: 200`, `ok: true`, but body is XML or plain text. Verify method detects JSON parse failure and throws a meaningful error.
  - **Note**: Several executors (discord, salesforce, outlook) already handle 204 in their own `make*Request` methods, bypassing `handleApiResponse`. The base class fix ensures any executor that does rely on `handleApiResponse` is protected.
  - **Classification**: `[full]`

---

## Phase 4: Integration Test Framework and CI/CD

**Implements**: P4-01 through P4-10
**SA audit boundary**: After Phase 4 completion (final audit)

### Task 1: Integration Test Configuration (P4-01, P4-04)

- [x] **P4-T1**: Create integration test configuration
  - **File**: `tests/plugins/integration-tests/integration-config.ts`
  - **Details**: Configuration helper that:
    - Reads real API credentials from environment variables (e.g., `GOOGLE_TEST_REFRESH_TOKEN`, `SLACK_TEST_TOKEN`, etc.)
    - Exports `hasCredentials(pluginKey)` function for skip guards
    - Exports `getTestConnection(pluginKey)` that builds a real connection object from env vars
    - Exports `describeIfCredentials(pluginKey)` for conditional describe blocks
    - Exports `generateTestId()` for unique test artifact naming
  - **Acceptance**: Integration tests can check credential availability and skip gracefully

### Task 2: Integration Tests for High-Usage Plugins (P4-02, P4-03, P4-05)

- [x] **P4-T2**: `tests/plugins/integration-tests/google-mail.integration.test.ts`
  - **Details**: Real API test for google-mail. Creates a draft, verifies, deletes. Skip if `GOOGLE_MAIL_TEST_TOKEN` not set. Idempotent cleanup via afterAll.

- [x] **P4-T3**: `tests/plugins/integration-tests/google-sheets.integration.test.ts`
  - **Details**: Real API test for google-sheets. Reads from a known test spreadsheet. Skip if credentials unavailable. Additional guard for spreadsheet ID.

- [x] **P4-T4**: `tests/plugins/integration-tests/slack.integration.test.ts`
  - **Details**: Real API test for slack. Posts to a test channel, verifies, deletes. Skip if `SLACK_TEST_TOKEN` not set. Additional guard for channel ID.

- [x] **P4-T5**: `tests/plugins/integration-tests/notion.integration.test.ts`
  - **Details**: Real API test for notion. Searches workspace, creates a test page, archives it. Skip if `NOTION_TEST_TOKEN` not set. Uses archive (soft-delete) for cleanup.

- [x] **P4-T6**: `tests/plugins/integration-tests/google-drive.integration.test.ts`
  - **Details**: Real API test for google-drive. Lists files, creates temp folder, deletes. Skip if `GOOGLE_DRIVE_TEST_TOKEN` not set. Cleanup via delete_file.

### Task 3: npm Scripts and Jest Configuration (P4-07)

- [x] **P4-T7**: Update npm scripts in `package.json`
  - **File**: `package.json`
  - **Details**: Added `test:plugins:all` as alias for `test:plugins`. Verified all existing scripts work correctly:
    - `test:plugins` -- runs all in `tests/plugins/` (unit + plugin-definitions + integration)
    - `test:plugins:unit` -- runs only `tests/plugins/unit-tests/`
    - `test:plugins:integration` -- runs only `tests/plugins/integration-tests/`
    - `test:plugins:smoke` -- runs tests matching `[smoke]` pattern
    - `test:plugins:all` -- alias for `test:plugins`
    - `test:plugins:ci` -- runs all with `--ci --forceExit`

### Task 4: CI/CD Configuration (P4-06)

- [x] **P4-T8**: Create GitHub Actions CI/CD workflow
  - **File**: `.github/workflows/plugin-tests.yml`
  - **Details**: Three run modes configured:
    - **On push/PR to main** (plugin-related paths only): Run unit + smoke tests (fast, no credentials)
    - **Nightly schedule** (03:00 UTC): Run full suite including integration tests with secrets
    - **Manual dispatch** (`workflow_dispatch`): Run full suite on demand with toggle for integration tests
  - All integration test secrets mapped from GitHub Secrets to env vars

### Task 5: V6 Regression Suite Gate (P4-10)

- [x] **P4-T9**: Add plugin smoke test prerequisite to V6 regression runner
  - **File**: `tests/v6-regression/run-regression.ts`
  - **Details**: Added smoke test gate between step 2 (print header) and step 3 (scenario loop). Uses `execWithFileRedirect()` with the local jest binary (same pattern as TSX_BIN) to run smoke tests. On failure, prints diagnostic output showing failing test names and aborts with clear message.
  - **Timeout**: 60 seconds (SA-R2)
  - **Acceptance**: If any smoke test fails, regression suite aborts early; if all pass, regression proceeds normally

### Task 6: Documentation (P4-08, P4-09)

- [x] **P4-T10**: Create test suite README
  - **File**: `tests/plugins/README.md`
  - **Details**: Documented directory structure, all run commands, test classification system with SA-1 naming convention, integration credential setup (per-plugin env var tables), V6 regression gate behavior, CI/CD modes, and instructions for adding tests to new plugins.

- [x] **P4-T11**: Update plugin workflow with integration test scaffold step
  - **File**: `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`
  - **Details**: Added STEP 14b after the unit test step. Includes template for credential-gated integration test scaffold, instructions for adding to integration-config.ts CREDENTIAL_MAP, and updated the summary checklist to include the integration test file.

---

## Task Checklist Summary

### Cross-Cutting (3 tasks)
- [x] CC-T1: Add `test:plugins:smoke` npm script
- [x] CC-T2: Retrofit existing 11 test files with `[smoke]`/`[full]` classification
- [x] CC-T3: Document classification (completed in P4-T10)

### Phase 0 (3 tasks)
- [x] P0-T1: Create `tests/plugins/plugin-definitions.test.ts`
- [x] P0-T2: Install `ajv` devDependency (already present -- no action needed)
- [x] P0-T3: Fix any plugin definition inconsistencies (SA-R4) -- all 19 definitions pass, no fixes needed

### Phase 1 (5 tasks)
- [x] P1-T1: Audit all catch blocks in 19 executors (populate catalog table) -- 16 D-B21 bugs found across 3 files
- [x] P1-T2: Fix all D-B21 catch-block bugs -- 16 fixes in google-calendar (6), google-docs (6), google-drive (4)
- [x] P1-T3: Add unit tests for fixed catch blocks -- existing error-path tests in google-calendar, google-docs, google-drive already cover these paths
- [x] P1-T4: Base executor error propagation chain test (using TestPluginExecutor stub per SA-R1) -- 4 tests in base-executor.test.ts
- [x] P1-T5: Base executor normalizeParameters tests -- 3 tests in base-executor.test.ts

### Phase 2 (11 tasks)
- [ ] P2-T1: chatgpt-research tests
- [ ] P2-T2: discord tests
- [ ] P2-T3: dropbox tests
- [ ] P2-T4: meta-ads tests
- [ ] P2-T5: notion tests
- [ ] P2-T6: onedrive tests
- [ ] P2-T7: outlook tests
- [ ] P2-T8: salesforce tests
- [ ] P2-T9: Output schema conformance helper + integration
- [ ] P2-T10: Update plugin workflow doc with test step
- [ ] P2-T11: Consolidate any stray test files

### Phase 3 (6 tasks)
- [x] P3-T0: Add `mockFetchThrow` helper to mock-fetch.ts (SA-R3)
- [x] P3-T1: Shared error scenario helper
- [x] P3-T2: Apply error scenarios to all 19 plugins
- [x] P3-T3: Malformed response tests per plugin
- [x] P3-T4: Authentication edge case tests
- [x] P3-T5: Fix and test base executor handleApiResponse (SA-2)

### Phase 4 (11 tasks)
- [x] P4-T1: Integration test config
- [x] P4-T2: google-mail integration test
- [x] P4-T3: google-sheets integration test
- [x] P4-T4: slack integration test
- [x] P4-T5: notion integration test
- [x] P4-T6: google-drive integration test
- [x] P4-T7: Update npm scripts
- [x] P4-T8: GitHub Actions CI/CD workflow
- [x] P4-T9: V6 regression suite gate (with 60s timeout per SA-R2)
- [x] P4-T10: Test suite README
- [x] P4-T11: Update plugin workflow with integration scaffold

**Total: 39 tasks across 5 phases + cross-cutting**
**Completed: 27 of 39**

---

## Implementation Order

The recommended implementation order is:

1. **CC-T1, CC-T2** (classification infra -- enables all subsequent phases) -- DONE
2. **P0-T2, P0-T1, P0-T3** (install ajv, build definition validation, fix any issues) -- P0-T2 and P0-T1 DONE, P0-T3 pending test run
3. **P1-T1** (audit -- informational, unlocks P1-T2)
4. **P1-T2** (fix bugs -- unlocks P1-T3)
5. **P1-T3, P1-T4, P1-T5** (Phase 1 tests -- can be parallel)
6. **P2-T9** (output schema helper -- needed by P2-T1 through P2-T8)
7. **P2-T1 through P2-T8** (new plugin tests -- can be parallel)
8. **P2-T10, P2-T11** (doc update and consolidation)
9. **P3-T0** (mockFetchThrow helper -- needed by P3-T1)
10. **P3-T1** (shared error helper -- needed by P3-T2)
11. **P3-T5** (handleApiResponse fix + tests -- should come before P3-T2 since it fixes a base-class bug)
12. **P3-T2, P3-T3, P3-T4** (error scenario coverage -- can be parallel)
13. **P4-T1** (integration config -- needed by P4-T2 through P4-T6)
14. **P4-T2 through P4-T6** (integration tests -- can be parallel)
15. **P4-T7, P4-T8, P4-T9** (scripts, CI/CD, regression gate)
16. **P4-T10, P4-T11** (documentation)

---

## Risk Notes

| Risk | Mitigation |
|------|------------|
| `handleApiResponse` does not handle 204/HTML gracefully (P3-T5) | Confirmed bug (SA-2). Fix the base class method as part of Phase 3 before adding error scenario tests. This is a generic fix, not plugin-specific. |
| Existing 106 tests break after classification retrofit (CC-T2) | Run full test suite after each retrofit file. Only add wrapper describe blocks, never change test logic. |
| Plugin definitions have schema inconsistencies (Phase 0) | Phase 0 runs first specifically to catch these. P0-T3 explicitly tracks fixing any discovered issues before Phase 2. |
| Salesforce executor needs `instance_url` in mock connection | Add to `PLUGIN_DEFAULTS` in mock-connection.ts (P2-T8). |
| `ajv` may not be in current dependencies | Check first; install as devDep if needed (P0-T2). |
| Null connection scenario requires separate executor instance | SA-3 resolved: use `createMockUserConnections()` with no pluginKey to get null connection. Documented in P3-T1. |

---

## SA Phase 1 Code Review

**Code Review by SA -- 2026-04-12**
**Status:** Approved with conditions (2 Medium issues to fix in next phase)

### D-B21 Fix Verification

All 16 D-B21 instances have been verified as correctly fixed across the 3 affected files. Every `if (!response.ok)` block now references the in-scope `errorData` variable (or `errorText` equivalent) in the `this.logger.error()` call, and includes `status: response.status` in the structured log context. The subsequent `throw new Error(...)` lines were already correct before the fix and remain correct.

**Verified files:**
- `lib/server/google-calendar-plugin-executor.ts` -- 6 fix sites confirmed correct (lines 85, 217, 274, 324, 374, 410)
- `lib/server/google-docs-plugin-executor.ts` -- 6 fix sites confirmed correct (lines 72, 182, 217, 253, 296, 348)
- `lib/server/google-drive-plugin-executor.ts` -- 4 fix sites confirmed correct (lines 98, 168, 227, 383)

No remaining instances of `{ err: error }` referencing an undefined variable in the fixed files.

### Code Review Comments

1. `lib/server/google-drive-plugin-executor.ts:466` -- `logger.error` in `createFolder` uses format `{ err: errorData }, 'DEBUG: Create folder failed:', errorData` which passes `errorData` as a second positional arg to Pino (Pino ignores extra positional args after the message string, so this is dead code, not a bug). Same pattern at lines 518, 573, 671, 739, 780. The D-B21 fix correctly changed `err:` to reference `errorData`, but the trailing `, errorData` after the message string is vestigial from a `console.log`-style pattern. -- Priority: Medium
   - **Action:** Clean up these 6 sites in google-drive during Phase 2 or Phase 3 work. Remove the trailing positional arg (e.g., change `'DEBUG: Create folder failed:', errorData` to `'Create folder failed'`). Also remove the `DEBUG:` prefix from logger messages -- structured logging already carries context in the object fields.

2. `lib/server/google-docs-plugin-executor.ts:311` -- `this.logger.warn({ err: error }, 'DEBUG: Failed to add initial content:', error)` in `createDocument`'s inner catch block has the same vestigial positional-arg pattern. This catch block was NOT part of the D-B21 scope (it is a proper `catch (error)` block, not an `if (!response.ok)` block), but it exhibits the same Pino anti-pattern. -- Priority: Low
   - **Action:** Clean up during Phase 2/3. Not blocking.

3. `lib/server/google-drive-plugin-executor.ts:396` -- `this.logger.warn({ err: error }, 'DEBUG: Could not get folder name:', error)` in `getFolderContents` -- same vestigial pattern. Also not D-B21 scope. -- Priority: Low

4. `tests/plugins/unit-tests/base-executor.test.ts:57` -- `buildTestExecutor` hardcodes `pluginKey = 'google-mail'` as default. This is acceptable for P1-T4 and P1-T5 since the tests need a real plugin definition to exercise normalizeParameters and validation. The stub properly isolates `executeSpecificAction` behavior as required by SA-R1. -- Priority: N/A (observation, no action needed)

5. `tests/plugins/unit-tests/base-executor.test.ts:164` -- The second `describe('[smoke]', ...)` block (for normalizeParameters) is a sibling of the first `describe('[smoke]', ...)` block (for error propagation). Both are at the same nesting level under the top-level `describe('BasePluginExecutor', ...)`. This is valid per the SA-1 naming convention -- `[smoke]` appears only in `describe()` blocks, never in `it()` blocks. `--testNamePattern` will match both correctly. -- Priority: N/A (verified correct)

6. `tests/plugins/unit-tests/base-executor.test.ts:40` -- `super(pluginName, userConnections as never, pluginManager)` uses `as never` to bypass the type mismatch between the mock and `UserPluginConnections`. This is acceptable in test code where the mock satisfies the runtime interface but not the compile-time type. -- Priority: N/A (acceptable test pattern)

### Catalog Accuracy

The catch-block catalog in the workplan (D-B21 Bug Instances table and "Catch blocks with NO D-B21 bug" table) is comprehensive and correctly classifies all 19 executor files plus the base executor. Line numbers in the catalog are from pre-fix state and may have shifted slightly after the fix, but the intent is clear and the catalog serves its documentation purpose.

**Note on P1-T2 count:** The workplan checklist says "16 fixes in google-calendar (6), google-docs (6), google-drive (4)". However, I count additional `logger.error` sites in google-drive that were also fixed: `createFolder` (line 466), `getOrCreateFolder` search (line 518), `getOrCreateFolder` create (line 573), `uploadFile` (line 671), `shareFile` per-email loop (line 739), `shareFile` single permission (line 780). These additional 6 sites in google-drive use `{ err: errorData }` (correct) but were not listed in the D-B21 catalog table which only lists 4 google-drive entries. Either: (a) these 6 additional sites were already correct before the fix (they used `errorData` from the start), or (b) they were fixed but not cataloged. The current code is correct regardless -- this is a catalog completeness note for documentation accuracy.

### Optimization Suggestions

- The `DEBUG:` prefix in logger messages across all three Google plugin executors is redundant with structured logging. Consider removing it in a future cleanup pass (not blocking).
- The dual snake_case/camelCase output format in all Google executors (e.g., both `event_id` and `eventId`) is a legacy compatibility pattern. This is an existing pattern, not introduced by Phase 1, so no action required here.

### Test Coverage Assessment

- **P1-T3 (existing tests covering fixed paths):** The claim that existing error-path tests already cover the D-B21 fix sites is reasonable -- the google-calendar, google-docs, and google-drive test files already had `[full]` error-path tests that mock `mockFetchError()` and verify `result.success === false`. The D-B21 fix does not change the control flow (the `throw` was always correct), only the logger call, so the existing tests do exercise these code paths.
- **P1-T4 (base executor error propagation):** 4 tests covering Error throw, error.code propagation, validation gate, and non-Error throw. Good coverage of the base class error chain.
- **P1-T5 (normalizeParameters):** 3 tests covering string-to-array conversion, array passthrough, and non-array field passthrough. Correct edge cases for the normalization logic.
- **Test classification:** `[smoke]` is applied to basic error propagation and normalizeParameters tests; `[full]` is applied to edge cases (non-Error throws). This follows the convention correctly.

### Code Approved for QA: Yes

Phase 1 implementation is approved. The 2 Medium-priority items (vestigial positional args in Pino logger calls in google-drive) should be cleaned up during subsequent phases but are not blocking.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-12 | Initial workplan | Dev created workplan from REQ_PLUGIN_TESTING_COMPREHENSIVE requirement |
| 2026-04-12 | SA review incorporated | Addressed 3 must-fix items (SA-1: naming convention, SA-2: handleApiResponse fix, SA-3: null connection approach) and 4 recommendations (SA-R1: TestPluginExecutor stub, SA-R2: 60s timeout, SA-R3: mockFetchThrow helper, SA-R4: P0-T3 definition fix task). Total tasks increased from 37 to 39. |
| 2026-04-12 | Step 1+2 implementation | Completed CC-T1 (smoke npm script), CC-T2 (retrofit 11 test files with [smoke]/[full] classification), P0-T2 (ajv already present), P0-T1 (plugin-definitions.test.ts created). P0-T3 pending test execution to discover issues. 4 of 39 tasks complete. |
| 2026-04-12 | Phase 1 implementation | Completed all 5 Phase 1 tasks: P1-T1 (audit found 16 D-B21 bugs across google-calendar, google-docs, google-drive), P1-T2 (fixed all 16 bugs by replacing undefined `error` refs with in-scope `errorData`/`errorText`), P1-T3 (existing error-path tests already cover these code paths), P1-T4 (4 error propagation tests via TestPluginExecutor stub), P1-T5 (3 normalizeParameters tests). Created `tests/plugins/unit-tests/base-executor.test.ts`. All 117 tests pass (110 existing + 7 new). 9 of 39 tasks complete. |
