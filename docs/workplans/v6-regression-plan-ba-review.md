# BA Review: V6 Regression Test Plan

> **Last Updated**: 2026-03-26
> **Requirement Doc**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md)

## Overview

The requirement defines a regression testing framework for the V6 Intent Contract to DSL compilation to execution pipeline. It introduces a scenario-based test runner that orchestrates three existing test phases (Compile, Phase A static validation, Phase D mock execution) across multiple scenarios, with structured console output, JSON reports, and a log file.

---

## Summary of Deliverables

1. **CLI argument support** for existing Phase A and Phase D scripts (`--input-dir`, `--output-dir`)
2. **New regression runner** (`tests/v6-regression/run-regression.ts`) that discovers scenarios, runs sub-scripts via `execSync`, and aggregates results
3. **EP Key Hints pre-flight validation** with auto-fix-in-memory logic
4. **Structured console output** with per-scenario progress and summary table
5. **Regression report** (`regression-report.json`) and **log file** (`regression-log.txt`) per run
6. **Two initial scenarios** extracted from git history: Leads Email Summary and Customer Complaint Logger
7. **RegressionLogger class** for dual-output (console + file)

---

## Clarity Assessment

| Aspect | Verdict | Notes |
|---|---|---|
| Problem statement / motivation | Clear | Well-articulated why regression is needed given 26+ iterative fixes |
| Architecture / folder structure | Clear | Scenario structure, output structure, and file naming all specified |
| Scenario metadata format | Clear | `scenario.json` schema provided with example |
| Runner flow | Clear | 10-step per-scenario flow documented with exact CLI commands |
| Console output format | Clear | Full examples for success, failure, and summary cases |
| Report JSON schema | Clear | Complete example with all fields |
| EP Key Hints validation | Clear | Rules, inference logic, and edge cases documented |
| Phase skipping logic | Clear | Phase A failure skips Phase D |
| Existing script modifications | Clear | Exact files listed, backward compatibility requirement stated |
| Scenario extraction steps | Clear | Git commits referenced, extraction commands provided |
| Timeouts | Clear | 120s compile, 60s Phase A, 120s Phase D |
| Exit codes | Clear | 0 = all pass, 1 = any fail |

---

## Questions and Observations

### Non-blocking observations (informational, do not require user input)

1. **Pipeline script already has `--output-dir`**: The requirement document states that `test-complete-pipeline-with-vocabulary.ts` needs `--output-dir` support (Step 6), but the current code already implements this (lines 35-38 of the script). Dev should verify and skip this if already done.

2. **Windows symlink limitation**: The requirement mentions a `latest` symlink for the most recent run output. On Windows, symlinks require elevated privileges. The requirement already notes "(or copy on Windows)" as an alternative. Dev should implement the Windows-compatible approach.

3. **IntentContract capture for Leads Email Summary**: The requirement says to extract the enhanced prompt from git commit `5d5dd97` and then "run pipeline once to capture intent-contract.json." This requires an LLM call (OpenAI). Dev should document whether this one-time generation step is expected during implementation or whether the user will provide the file.

### No blocking questions

The requirement is comprehensive, well-structured, and contains sufficient implementation detail including code outlines, exact CLI arguments, file paths, JSON schemas, and console output specifications. All acceptance criteria are implicitly defined through the expected behavior (13/13 Phase A checks, Phase D success, report structure, exit codes).

---

## Verdict: APPROVED

The requirement is clear, complete, and ready for Dev to create a workplan. No blocking ambiguities were found.
