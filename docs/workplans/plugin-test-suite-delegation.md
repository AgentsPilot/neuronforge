# Delegation Plan -- Plugin Test Suite

> **Last Updated**: 2026-03-27
> **Requirement**: [PLUGIN_TEST_SUITE_WORKPLAN.md](/docs/plugins/PLUGIN_TEST_SUITE_WORKPLAN.md)
> **BA Review**: [plugin-test-suite-ba-review.md](/docs/workplans/plugin-test-suite-ba-review.md)

## Overview

This document defines the agent orchestration plan for implementing the Plugin Test Suite feature. BA has approved the requirement with no blocking questions.

---

## Orchestration Flow

| Step | Agent | Action | Input | Output |
|------|-------|--------|-------|--------|
| 1 | **Dev** | Create detailed workplan | Requirement MD + BA review | `docs/workplans/plugin-test-suite-dev-workplan.md` |
| 2 | **SA** | Review Dev workplan | Dev workplan MD | Approve or return feedback |
| 3 | **Dev** | Implement (if SA approved) | Approved workplan | Test files, shared utilities, npm scripts |
| 4 | **SA** | Code review | Implemented code | Approve or return feedback |
| 5 | **QA** | Test the implementation | Implemented code | Test report (run all plugin tests, verify no network calls) |
| 6 | **TL** | Write retrospective | All artifacts | Retrospective MD, present to user |
| 7 | **RM** | Commit (after user approval) | User approval | Commit on current branch |

---

## Dev Workplan Expectations

The Dev workplan should include:

1. **Phased implementation order** -- the 68 actions across 11 plugins should be grouped into manageable phases (e.g., shared utilities first, then plugins in batches).
2. **Shared utilities first** -- `mock-fetch.ts`, `mock-connection.ts`, `mock-plugin-manager.ts` must be implemented before any test files.
3. **Jest config note** -- confirm that `jest.config.js` (not `.ts`) supports the `tests/plugins/` path without changes, or document needed changes.
4. **npm scripts** -- define the exact `package.json` changes.
5. **Per-plugin task breakdown** -- each plugin test file is a task with estimated action count.
6. **Integration test** -- document-extractor integration test as a separate task.
7. **Fixture handling** -- confirm the PDF fixture file location and any setup needed.

---

## SA Review Focus Areas

- Mocking approach correctness (fetch-level mock vs. module mock)
- Shared utility API design
- Test isolation (no test should depend on another test's state)
- Consistency with project conventions (import patterns, TypeScript strict mode)
- No accidental real network calls possible

---

## QA Verification Checklist

- All 4 npm scripts run without errors
- All 68 action tests pass
- Integration test passes
- No network calls are made (verify via fetch mock assertions)
- Test output is verbose and readable
- Exit code 0 on full suite pass

---

## Notes

- **Current branch**: `feature/v6-intent-contract-data-schema` -- all work happens here.
- **Jest config file**: The actual file is `jest.config.js`, not `jest.config.ts` as stated in the requirement doc. Dev should use the correct filename in all commands.
- **Scope**: This is a test-only feature -- no production code changes except `package.json` scripts.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-27 | Initial delegation plan | Defined full orchestration flow for plugin test suite |
