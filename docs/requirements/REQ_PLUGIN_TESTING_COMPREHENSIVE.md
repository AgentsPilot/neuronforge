# Comprehensive Plugin Testing Suite

> **Last Updated**: 2026-04-12
> **Author**: BA Agent
> **Triggered by**: Bug D-B21 (catch blocks in plugin executors reference undefined `error` variable)
> **Status**: DRAFT -- Awaiting SA review

## Overview

This requirement defines a comprehensive testing strategy for all 19 AgentPilot plugin executors. The initiative was triggered by bug D-B21, which revealed that catch blocks in plugin executors reference an undefined `error` variable, silently swallowing real API errors. Investigation showed that 8 of the 19 plugins have zero test coverage, and none of the existing 106 test cases cover error-path behavior systematically.

The deliverable is a single feature with five phases (Phase 0 through Phase 4), enabling incremental progress tracking and SA audit at each phase boundary.

---

## Table of Contents

- [Background and Motivation](#background-and-motivation)
- [Scope](#scope)
- [Cross-Cutting: Test Classification (Smoke vs Full)](#cross-cutting-test-classification-smoke-vs-full)
- [Phase 0: Plugin Definition Validation](#phase-0-plugin-definition-validation)
- [Phase 1: Catch-Block Audit and Error-Path Fixes](#phase-1-catch-block-audit-and-error-path-fixes)
- [Phase 2: Unit Tests for Untested Plugins](#phase-2-unit-tests-for-untested-plugins)
- [Phase 3: Systematic Error Scenario Coverage](#phase-3-systematic-error-scenario-coverage)
- [Phase 4: Integration Test Framework and CI/CD](#phase-4-integration-test-framework-and-cicd)
- [Non-Functional Requirements](#non-functional-requirements)
- [Out of Scope](#out-of-scope)
- [Dependencies](#dependencies)
- [Acceptance Criteria Summary](#acceptance-criteria-summary)
- [Change History](#change-history)

---

## Background and Motivation

**Bug D-B21**: Multiple plugin executors contain catch blocks that reference an undefined `error` variable instead of the caught exception parameter. This causes real API errors to be swallowed, making debugging extremely difficult and potentially returning misleading success responses to users.

**Current state of testing**:

| Metric | Value |
|--------|-------|
| Total plugins | 19 |
| Plugins with unit tests | 11 |
| Plugins with zero tests | 8 |
| Total existing test cases | 106 |
| Plugins with integration tests | 1 (document-extractor) |
| Error-path test coverage | Minimal / inconsistent |

**Plugins WITHOUT tests**: chatgpt-research, discord, dropbox, meta-ads, notion, onedrive, outlook, salesforce

**Plugins WITH tests**: airtable, document-extractor, google-calendar, google-docs, google-drive, google-mail, google-sheets, hubspot, linkedin, slack, whatsapp-business

---

## Scope

- **All 19 plugin executors** are in scope
- **All 19 plugin JSON definitions** are in scope (Phase 0 static validation)
- **Unified test location**: `tests/plugins/` -- any tests that exist elsewhere must be consolidated here
- **Integration test location**: `tests/plugins/integration-tests/` -- this directory already exists (contains document-extractor integration tests) and is the canonical location for all plugin integration tests
- **Test infrastructure**: Reuse and extend the existing common helpers at `tests/plugins/common/` (test-helpers.ts, mock-fetch.ts, mock-user-connections.ts, mock-connection.ts, mock-plugin-manager.ts)
- **Both mock-based and real-API tests** are required (mock for CI, real for periodic validation)

### All 19 Plugins

| # | Plugin Key | Executor Location | Has Tests |
|---|-----------|-------------------|-----------|
| 1 | airtable | `lib/server/airtable-plugin-executor.ts` | Yes |
| 2 | chatgpt-research | `lib/server/chatgpt-research-plugin-executor.ts` | No |
| 3 | discord | `lib/server/discord-plugin-executor.ts` | No |
| 4 | document-extractor | `lib/server/document-extractor-plugin-executor.ts` | Yes |
| 5 | dropbox | `lib/server/dropbox-plugin-executor.ts` | No |
| 6 | google-calendar | `lib/server/google-calendar-plugin-executor.ts` | Yes |
| 7 | google-docs | `lib/server/google-docs-plugin-executor.ts` | Yes |
| 8 | google-drive | `lib/server/google-drive-plugin-executor.ts` | Yes |
| 9 | google-mail | `lib/server/google-mail-plugin-executor.ts` | Yes |
| 10 | google-sheets | `lib/server/google-sheets-plugin-executor.ts` | Yes |
| 11 | hubspot | `lib/server/hubspot-plugin-executor.ts` | Yes |
| 12 | linkedin | `lib/server/linkedin-plugin-executor.ts` | Yes |
| 13 | meta-ads | `lib/server/meta-ads-plugin-executor.ts` | No |
| 14 | notion | `lib/server/notion-plugin-executor.ts` | No |
| 15 | onedrive | `lib/server/onedrive-plugin-executor.ts` | No |
| 16 | outlook | `lib/server/outlook-plugin-executor.ts` | No |
| 17 | salesforce | `lib/server/salesforce-plugin-executor.ts` | No |
| 18 | slack | `lib/server/slack-plugin-executor.ts` | Yes |
| 19 | whatsapp-business | `lib/server/whatsapp-business-plugin-executor.ts` | Yes |

---

## Cross-Cutting: Test Classification (Smoke vs Full)

**Goal**: Every test case must be classified as either **smoke** (basic sanity) or **full** (extended/deep validation). This enables a future quick-feedback mode where only smoke tests run, while the full suite is reserved for deeper validation.

This requirement applies across all phases (Phase 0 through Phase 4).

### Requirements

| ID | Requirement |
|----|-------------|
| CC-01 | Every test case (`it` block) must be tagged as either `smoke` or `full`. The tagging mechanism is a **Jest tag convention** using `describe` block nesting: each plugin test file must contain a top-level `describe('[smoke]', ...)` block for smoke tests and a `describe('[full]', ...)` block for full/extended tests. |
| CC-02 | **Smoke tests** must cover the minimum viable validation for a plugin: one happy-path test per action, and one basic error-path test (e.g., API returns 500). Smoke tests must complete in under 5 seconds per plugin. |
| CC-03 | **Full tests** cover all remaining scenarios: comprehensive error codes, malformed responses, pagination edge cases, authentication edge cases, and network failures. |
| CC-04 | Add a Jest `--testPathPattern` or `--grep` based npm script to run only smoke tests: `npm run test:plugins:smoke`. This script must filter to `[smoke]` describe blocks only. |
| CC-05 | Document the classification approach in `tests/plugins/README.md` (created in Phase 4, requirement P4-08), including how to tag new tests and how to run each subset. |

### Classification Guidelines

| Classification | What belongs here | Example |
|----------------|-------------------|---------|
| **smoke** | Happy-path per action, basic API error (500), basic auth failure (missing token) | "should send a message successfully", "should return error on 500 response" |
| **full** | All HTTP error codes (401, 403, 404, 429), malformed JSON, empty responses, pagination, network failures, null connection, expired token | "should handle rate limiting (429)", "should handle malformed JSON response" |

### Acceptance Criteria

- Every test case across all phases is classified as either `[smoke]` or `[full]`
- `npm run test:plugins:smoke` runs only smoke tests and completes in under 30 seconds for all 19 plugins
- The classification is documented in the test suite README

---

## Phase 0: Plugin Definition Validation

**Goal**: Validate that every plugin's JSON definition file (`lib/plugins/definitions/{name}-plugin-v2.json`) is internally consistent and schema-correct before any executor-level testing begins. This is a static check that requires no executor code and prevents schema drift from silently breaking downstream phases.

**Rationale**: Schema inconsistencies (e.g., a required param not listed in properties, invalid JSON Schema in output_schema, or x-variable-mapping referencing non-existent fields) can cause subtle runtime failures that are difficult to trace. Catching these statically is cheaper and faster than discovering them through executor test failures in later phases.

### Requirements

| ID | Requirement |
|----|-------------|
| P0-01 | For every plugin JSON definition, validate that all fields listed in `required` arrays (for each action's parameters) actually exist as keys in the corresponding `properties` object. Flag any required param that has no matching property definition. |
| P0-02 | For every plugin JSON definition, validate that all `output_schema` blocks are valid JSON Schema. Each output_schema must parse without errors against the JSON Schema meta-schema (draft-07 or later). Flag any output_schema that contains invalid types, malformed `$ref` entries, or structurally broken schema definitions. |
| P0-03 | For every plugin JSON definition, validate that all `x-variable-mapping` references (used in action parameter schemas) point to fields that actually exist in the corresponding `properties` object. Flag any x-variable-mapping value that references a non-existent property. |
| P0-04 | Create a single test file at `tests/plugins/plugin-definitions.test.ts` that runs the above validations across all 19 plugin definitions. The test must dynamically discover all `*-plugin-v2.json` files in `lib/plugins/definitions/` so that newly added plugins are automatically covered. |
| P0-05 | All Phase 0 tests must be classified as `[smoke]` per CC-01, since they are fast static checks that should run on every commit. |

### Acceptance Criteria

- All 19 plugin JSON definitions pass required-vs-properties consistency checks
- All output_schema blocks across all plugins validate as legal JSON Schema
- All x-variable-mapping references resolve to existing properties
- A single test file covers all definitions and auto-discovers new plugins
- All Phase 0 tests are classified as `[smoke]`

---

## Phase 1: Catch-Block Audit and Error-Path Fixes

**Goal**: Audit every catch block in all 19 plugin executors, fix the D-B21 variable reference bug, and ensure all error paths return structured, debuggable error results.

### Requirements

| ID | Requirement |
|----|-------------|
| P1-01 | Audit every `catch` block in all 19 executor files. Catalog each catch block with: file, line number, caught variable name, what is returned/thrown. |
| P1-02 | Fix all instances where catch blocks reference an undefined `error` variable (the D-B21 pattern). Ensure the caught exception parameter is used consistently. |
| P1-03 | Ensure all catch blocks return a structured error result: `{ success: false, error: <message> }` with the actual error message, not a generic string. |
| P1-04 | Ensure no catch block silently swallows exceptions (no empty catch, no catch that returns success). |
| P1-05 | Add a unit test for each fixed catch block that verifies the error is correctly propagated (not swallowed). Each test must be classified as `[smoke]` or `[full]` per CC-01. |
| P1-06 | Produce a summary table in the workplan showing all catch blocks found, their status (fixed/already-correct), and the test that covers them. |
| P1-07 | Add a test that verifies the full error propagation chain through the base executor class: `BasePluginExecutor.executeAction()` calls `executeSpecificAction()`, the action throws an error, and the error surfaces correctly back through the base class as a structured `{ success: false, error: <message> }` result. This test specifically validates that the base class validation gate (the schema validation in `executeAction()`) is not the only error path -- errors thrown inside `executeSpecificAction()` must also propagate correctly. This addresses the scenario where D-B21-style bugs in executor internals prevent errors from ever reaching the base class validation gate. |
| P1-08 | Add tests for the base executor's `normalizeParameters()` method, which converts string values to arrays when the schema expects an array type (e.g., `add_labels: "AgentsPilot"` → `["AgentsPilot"]`). Tests must verify: (a) string-to-array normalization when schema declares `type: "array"`, (b) values that are already arrays are left unchanged, (c) non-array schema fields are not affected by normalization. This is a base-class correctness test for a previously fixed issue discovered during V6 pipeline scatter-gather execution. |

### Acceptance Criteria

- Every catch block across all 19 executors is cataloged in the workplan
- Zero instances of the D-B21 pattern remain (undefined `error` variable reference in catch blocks)
- Every fixed catch block has a corresponding unit test proving the error surfaces correctly
- The full error propagation chain through BasePluginExecutor (executeAction -> executeSpecificAction -> throw -> structured error result) is tested and verified
- Base executor parameter normalization (string-to-array conversion) is tested and verified
- All existing 106 tests continue to pass

---

## Phase 2: Unit Tests for Untested Plugins

**Goal**: Bring the 8 untested plugins to full unit test coverage, matching the depth and patterns of the existing 11 tested plugins.

### Requirements

| ID | Requirement |
|----|-------------|
| P2-01 | Write unit tests for all 8 untested plugins: chatgpt-research, discord, dropbox, meta-ads, notion, onedrive, outlook, salesforce. |
| P2-02 | Each plugin test file must cover every action defined in the plugin's JSON definition (`lib/plugins/definitions/{name}-plugin-v2.json`). |
| P2-03 | Each action must have at minimum: one happy-path test (success response), one error-path test (API error response), and one input-validation test (missing/invalid required parameters). |
| P2-04 | All tests must use the existing test infrastructure: `createTestExecutor`, `mockFetchSuccess`, `mockFetchError`, `expectSuccessResult`, `expectErrorResult`, etc. from `tests/plugins/common/`. |
| P2-05 | Test files must be located at `tests/plugins/{plugin-key}.test.ts` (or a subdirectory if needed for organization). |
| P2-06 | If any plugin requires plugin-specific mock connection overrides (like whatsapp-business and linkedin already have in `mock-connection.ts`), add them to the `PLUGIN_DEFAULTS` map. |
| P2-07 | Consolidate any tests found outside `tests/plugins/` into this location. |
| P2-08 | Every test case must be classified as `[smoke]` or `[full]` per CC-01. At minimum, the happy-path test for each action must be tagged `[smoke]`; error-path and validation tests should be tagged `[full]`. |
| P2-09 | Update the plugin creation standards document (`docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`) to include a mandatory test generation step. Specifically, add a new step (or extend an existing step) in the workflow that requires generating a unit test file at `tests/plugins/{pluginName}.test.ts` for every new plugin, covering at minimum: one `[smoke]` happy-path test per action and one `[full]` error-path test per action. This ensures any future plugin created via the workflow ships with tests from day one. |
| P2-10 | For each action's happy-path test, verify that the mock response structure conforms to the plugin's declared `output_schema` from the JSON definition. The test must validate the response shape against the JSON schema (not just check that the response "looks right"). This ensures that the executor's actual output matches what downstream consumers (e.g., the V6 pipeline's CapabilityBinder) expect based on the schema. This would catch issues such as an action being bound to a pipeline step where the actual output shape differs from the declared schema. |

### Acceptance Criteria

- All 19 plugins have unit tests under `tests/plugins/`
- Every action in every plugin definition has at least 3 test cases (happy path, error path, validation)
- All happy-path tests validate response structure against the plugin's declared output_schema
- All tests pass in CI using mock fetch (no real API calls)
- No test files for plugins exist outside the `tests/plugins/` directory
- Every test case is classified as `[smoke]` or `[full]`
- `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` includes a mandatory test generation step for new plugins

---

## Phase 3: Systematic Error Scenario Coverage

**Goal**: Add comprehensive error scenario tests that go beyond basic API error responses, covering real-world failure modes that affect users.

### Requirements

| ID | Requirement |
|----|-------------|
| P3-01 | For every plugin executor, add tests for **network-level failures**: fetch throws (network error / DNS failure), connection timeout, connection reset. Use `mockFetchSequence` or custom mock to simulate `fetch` rejecting with an Error. |
| P3-02 | For every plugin executor, add tests for **HTTP error codes**: 401 Unauthorized (expired/invalid token), 403 Forbidden (insufficient permissions), 404 Not Found (deleted resource), 429 Too Many Requests (rate limited), 500/502/503 Server Error. |
| P3-03 | For every plugin executor, add tests for **malformed response handling**: response body is not valid JSON, response body is valid JSON but missing expected fields, response body is an empty string, response body is `null`. |
| P3-04 | For every plugin executor, add tests for **authentication edge cases**: expired token (connection.expires_at in the past), missing access_token, null connection (plugin not connected). |
| P3-05 | Where applicable, add tests for **pagination edge cases**: empty result set, single page, response with next page token but no more data. |
| P3-06 | Create a shared error scenario test helper in `tests/plugins/common/` that can run a standard battery of error scenarios against any executor+action combination, reducing boilerplate. |
| P3-07 | All error scenario tests added in this phase must be classified as `[full]` per CC-01, since they represent extended validation beyond basic smoke coverage. |
| P3-08 | Add tests for the base class `handleApiResponse(response, actionName)` method from `BasePluginExecutor`, which is used by many executors. These tests must cover: (a) **204 No Content** responses (e.g., the modify_email delete case where no body is returned), verifying the method handles empty bodies gracefully; (b) **HTML error pages** instead of JSON (e.g., the 411 Length Required error that returns HTML), verifying the method detects non-JSON content and returns a meaningful error; (c) **non-JSON content types** generally (XML, plain text, binary), verifying the method does not attempt to JSON.parse non-JSON bodies. These are base-class-level tests that protect all plugins using `handleApiResponse`. |

### Acceptance Criteria

- Every plugin has tests for: network failure, 401, 403, 429, 500, malformed JSON response, missing token, and null connection
- A shared error scenario helper exists and is used by at least 50% of plugin test files
- All error scenarios return `{ success: false }` with a meaningful error message (not undefined, not empty string)
- The base class `handleApiResponse` method is tested for 204 No Content, HTML error pages, and non-JSON content types
- All tests pass
- All Phase 3 tests are classified as `[full]`

---

## Phase 4: Integration Test Framework and CI/CD

**Goal**: Establish an integration test framework for real-API validation, configure CI/CD, and ensure the test suite can run in both mock and real modes.

### Requirements

| ID | Requirement |
|----|-------------|
| P4-01 | Create an integration test runner configuration that allows tests to call real plugin APIs using real credentials stored in environment variables. |
| P4-02 | Integration tests must be placed in the existing `tests/plugins/integration-tests/` directory (which already contains `document-extractor.integration.test.ts`). All integration test files must follow the naming convention `{plugin-key}.integration.test.ts` within this directory. |
| P4-03 | Integration tests must be idempotent: create test data, verify, clean up. They must not leave artifacts in connected accounts. |
| P4-04 | Integration tests must skip gracefully when credentials are not available (e.g., `describe.skipIf(!process.env.GOOGLE_TEST_TOKEN)`). |
| P4-05 | Start with integration tests for 3-5 high-usage plugins (e.g., google-mail, google-sheets, slack, notion, google-drive). Remaining plugins can be added incrementally. |
| P4-06 | Configure CI/CD for the test suite with the following run modes: (a) **On dedicated schedule** (e.g., nightly) -- full unit + integration tests; (b) **On demand** -- triggered manually for validation; (c) **On every commit** -- unit tests only, if the full suite runs under a threshold (e.g., 60 seconds). |
| P4-07 | Add a Jest configuration or npm script that separates unit tests from integration tests: `npm run test:plugins` (unit only), `npm run test:plugins:integration` (real APIs, runs files in `tests/plugins/integration-tests/`), `npm run test:plugins:all` (both). |
| P4-08 | Document the integration test setup in a README at `tests/plugins/README.md`: how to configure credentials, how to run, what each mode does, the test classification system (smoke vs full), and the integration test directory structure. |
| P4-09 | Update `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` to include an integration test scaffold step for new plugins. When a new plugin is generated, the workflow must create a placeholder integration test file at `tests/plugins/integration-tests/{pluginName}.integration.test.ts` with skippable test stubs (guarded by credential availability) for at least the plugin's most common action. |
| P4-10 | Integrate plugin smoke tests as a prerequisite gate in the V6 regression suite (`tests/v6-regression/run-regression.ts`). Before running Phase A/D regression scenarios, the suite must execute `test:plugins:smoke`. If any plugin smoke test fails, the regression suite must abort early with a clear error message indicating which plugin(s) failed and that workflow regression testing was skipped because the plugin layer is broken. Rationale: there is no value in testing V6 pipeline workflows if the underlying plugin executors are failing — this creates a fail-fast feedback loop that surfaces the root cause immediately. |

### Acceptance Criteria

- Integration tests exist for at least 3 plugins under `tests/plugins/integration-tests/` and successfully call real APIs when credentials are provided
- Integration tests skip cleanly when credentials are absent
- `npm run test:plugins` runs all unit tests (mock-based) and completes without real API calls
- `npm run test:plugins:integration` runs integration tests from `tests/plugins/integration-tests/` against real APIs
- CI/CD configuration exists with schedule, on-demand, and conditional per-commit modes
- README documents the setup including test classification and integration test location
- `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` includes an integration test scaffold step for new plugins
- V6 regression suite runs `test:plugins:smoke` as a prerequisite and aborts with a clear message if any smoke test fails

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-01 | All unit tests (mock-based) must complete in under 60 seconds total for the full 19-plugin suite. |
| NF-02 | Test output must clearly indicate which plugin and which action is being tested (descriptive `describe`/`it` blocks). |
| NF-03 | No test may depend on execution order or state from another test (full isolation). |
| NF-04 | Test files must follow TypeScript strict mode -- no implicit `any`. |
| NF-05 | Mock connection defaults in `mock-connection.ts` must be extended for any plugin that requires plugin-specific connection fields. |
| NF-06 | All smoke-classified tests (`[smoke]` blocks) must complete in under 30 seconds total for the full 19-plugin suite. |

---

## Out of Scope

- Refactoring plugin executor internals (beyond the catch-block fixes in Phase 1)
- Adding new plugin functionality
- UI testing of plugin configuration screens
- Performance benchmarking of plugin executors
- Testing the PluginManagerV2 or plugin registry themselves (separate concern)
- Pilot engine / StepExecutor variable resolution tests (e.g., `{{results.files[0].id}}` array index access) -- these are a pipeline concern, not plugin executor scope. Recommended as a follow-up requirement for Pilot/StepExecutor testing

---

## Dependencies

| Dependency | Phase | Notes |
|------------|-------|-------|
| Existing test infrastructure in `tests/plugins/common/` | All | Must be preserved and extended, not replaced |
| Existing integration test directory at `tests/plugins/integration-tests/` | Phase 4 | Already contains document-extractor integration tests; all new integration tests go here |
| Plugin JSON definitions in `lib/plugins/definitions/` | Phase 0, Phase 2+ | Source of truth for which actions each plugin supports and their declared schemas |
| JSON Schema meta-schema (draft-07 or later) | Phase 0 | Required for validating output_schema blocks against the JSON Schema specification |
| Base plugin executor at `lib/server/base-plugin-executor.ts` | Phase 1, Phase 3 | Required for P1-07 error propagation chain test, P1-08 parameter normalization tests, and P3-08 handleApiResponse tests |
| Plugin executor source files in `lib/server/` | Phase 1+ | Must be readable to audit catch blocks |
| Plugin creation workflow at `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` | Phase 2, Phase 4 | Must be updated to include test generation steps for new plugins |
| Per-plugin documentation at `docs/plugins/{pluginName}-plugin.md` | Phase 2, Phase 4 | Individual plugin docs generated by the workflow |
| Real API credentials for integration tests | Phase 4 | Required only for integration test development and execution |
| V6 regression suite at `tests/v6-regression/run-regression.ts` | Phase 4 | Must be modified to add plugin smoke test prerequisite gate (P4-10) |
| CI/CD platform configuration access | Phase 4 | Needed to set up scheduled/on-demand runs |

---

## Acceptance Criteria Summary

| Phase | Key Metric | Target |
|-------|-----------|--------|
| Phase 0 | Plugin definitions passing required-vs-properties check | 19/19 |
| Phase 0 | Output schemas valid as JSON Schema | All across 19 plugins |
| Phase 0 | x-variable-mapping references resolved | All across 19 plugins |
| Phase 1 | D-B21 catch-block bugs remaining | 0 |
| Phase 1 | Catch blocks audited and cataloged | 100% across 19 plugins |
| Phase 1 | Base executor error propagation chain tested | Yes |
| Phase 1 | Base executor parameter normalization tested | Yes |
| Phase 2 | Plugins with unit tests | 19/19 |
| Phase 2 | Minimum tests per action | 3 (happy, error, validation) |
| Phase 2 | Happy-path tests validate against output_schema | Yes |
| Phase 2 | Plugin workflow updated with test step | Yes |
| Phase 3 | Error scenarios covered per plugin | Network failure, 401, 403, 429, 500, malformed JSON, missing token, null connection |
| Phase 3 | Shared error helper created | Yes |
| Phase 3 | handleApiResponse base-class coverage | 204 No Content, HTML error pages, non-JSON content types |
| Phase 4 | Plugins with integration tests | At least 3, in `tests/plugins/integration-tests/` |
| Phase 4 | CI/CD modes configured | Schedule + on-demand + conditional per-commit |
| Phase 4 | Plugin workflow updated with integration test scaffold | Yes |
| Phase 4 | V6 regression suite gates on plugin smoke tests | Yes — aborts early on failure |
| Cross-cutting | All tests classified as smoke or full | Yes |
| Cross-cutting | Smoke-only run script available | `npm run test:plugins:smoke` |
| All | Existing 106 tests still passing | Yes |
| All | Test location consolidated | All under `tests/plugins/` |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-12 | Initial draft | BA created requirement based on user decisions and D-B21 bug investigation |
| 2026-04-12 | User feedback incorporation | 3 items: (1) Explicitly reference `tests/plugins/integration-tests/` as integration test directory (updated Scope, P4-02, P4-07, P4-09, Dependencies, Acceptance Summary). (2) Add requirements to update `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md` so new plugins ship with tests (added P2-09, P4-09, updated Dependencies). (3) Add cross-cutting test classification system -- smoke vs full tagging (added CC-01 through CC-05 section, updated P1-05, P2-08, P3-07, NF-06, Acceptance Summary). |
| 2026-04-12 | User suggestions -- 4 additions | (1) Added Phase 0: Plugin Definition Validation (P0-01 through P0-05) for static JSON schema consistency checks before executor testing. (2) Added P1-07 to Phase 1 for base executor error propagation chain test (executeAction -> executeSpecificAction -> throw -> structured error). (3) Added P2-10 to Phase 2 for output schema conformance validation on happy-path tests. (4) Added P3-08 to Phase 3 for handleApiResponse base-class coverage (204 No Content, HTML error pages, non-JSON content types). Updated ToC, Scope, Dependencies, and Acceptance Criteria Summary accordingly. |
| 2026-04-12 | V6 pipeline pattern analysis | Added P1-08 for base executor parameter normalization tests (string-to-array conversion). Added Pilot engine variable resolution testing to Out of Scope as a recommended follow-up requirement. Updated Dependencies and Acceptance Criteria Summary. |
| 2026-04-12 | Regression suite integration | Added P4-10: V6 regression suite (`run-regression.ts`) must run `test:plugins:smoke` as a prerequisite gate before Phase A/D scenarios, aborting early with clear message on failure. Updated Dependencies, Acceptance Criteria Summary. |
