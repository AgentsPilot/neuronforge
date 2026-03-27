# BA Review -- Plugin Test Suite

> **Last Updated**: 2026-03-27
> **Requirement Document**: [PLUGIN_TEST_SUITE_WORKPLAN.md](/docs/plugins/PLUGIN_TEST_SUITE_WORKPLAN.md)

## Overview

The requirement defines a comprehensive test suite for all 11 NeuronForge V2 plugin executors, covering 68 actions total. Tests are fully isolated (mocked fetch, mocked OAuth, mocked PluginManagerV2) and split into unit tests and integration tests.

---

## Requirement Quality Assessment

### Clarity -- GOOD

- The scope is explicitly defined: 11 plugins, 68 actions, each with a named test file.
- The mocking strategy is clearly described at three levels (fetch, connection, plugin manager).
- The test structure per plugin is specified with a code template.
- Special cases (document-extractor using DeterministicExtractor instead of fetch) are called out with a dedicated mocking approach.

### Completeness -- GOOD

- Directory structure is fully specified.
- Every plugin and every action is enumerated in a coverage table.
- Shared utilities (mock-fetch, mock-connection, mock-plugin-manager) are described with their APIs.
- npm script entries are defined.
- The regression runner command and CI behavior are specified.
- A process for adding new plugins is documented.

### Acceptance Criteria -- IMPLICITLY DEFINED

The document does not have a formal "Acceptance Criteria" section, but the criteria are clear from context:

1. All 11 test files exist and pass under `tests/plugins/unit-tests/`.
2. The document-extractor integration test exists and passes under `tests/plugins/integration-tests/`.
3. The three shared utilities exist under `tests/plugins/common/`.
4. The four npm scripts (`test:plugins`, `test:plugins:unit`, `test:plugins:integration`, `test:plugins:ci`) are added to `package.json` and work correctly.
5. `npx jest --config jest.config.js tests/plugins/ --ci --forceExit` exits 0.
6. No real network calls are made during test execution.

### Scope and Deliverables -- CLEAR

| Deliverable | Status |
|---|---|
| 3 shared test utilities | Defined |
| 11 unit test files (68 actions) | Defined per plugin |
| 1 integration test file | Defined |
| 1 PDF fixture file | Already provided |
| 4 npm scripts in package.json | Defined |
| Jest config compatibility | Open item (minor -- existing config already supports `tests/` path via glob) |

---

## Questions and Observations

### Non-blocking observations

1. **Jest config references `jest.config.ts` but file is `jest.config.js`.** The requirement doc commands use `--config jest.config.ts` but the actual project file is `jest.config.js`. The Dev should use the correct filename. This is a minor discrepancy, not a blocker.

2. **Jest config `roots` is set to `<rootDir>`.** The existing Jest config already discovers test files anywhere in the project via glob patterns, so `tests/plugins/` will be discovered. No config change needed beyond possibly adding `tests/` to `collectCoverageFrom` if coverage reporting for test helpers is desired.

3. **No mention of ts-jest compatibility issues.** The existing Jest config uses `ts-jest` which should work fine for the new test files. No concern here.

4. **Phase ordering.** The requirement is large (68 actions across 11 plugins). Dev should propose a phased implementation plan in the workplan -- this is expected in the next step.

### Blocking questions

None. The requirement is clear enough to proceed.

---

## Verdict: APPROVED

The requirement document is well-structured, comprehensive, and actionable. No blocking ambiguities. Ready for Dev to create a detailed implementation workplan.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-27 | Initial BA review | Reviewed and approved requirement document |
