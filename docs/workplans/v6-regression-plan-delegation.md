# Delegation Plan: V6 Regression Test Suite

> **Last Updated**: 2026-03-26
> **Requirement Doc**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md)
> **BA Review**: [v6-regression-plan-ba-review.md](/docs/workplans/v6-regression-plan-ba-review.md)
> **Branch**: `feature/v6-intent-contract-data-schema`

---

## Delegation Sequence

### 1. Dev -- Create Workplan

**Task**: Read the requirement document and create a detailed workplan at `docs/workplans/v6-regression-plan-workplan.md`.

The workplan must break the requirement into implementable tasks with:
- Task ordering and dependencies
- File-by-file change list (which files to create, which to modify)
- For each modified file: what specifically changes and why
- Estimated complexity per task
- Any technical decisions that need SA input

**Key context for Dev**:
- The pipeline script (`scripts/test-complete-pipeline-with-vocabulary.ts`) already has `--output-dir` support -- verify and skip if complete
- Phase A script (`scripts/test-dsl-execution-simulator/index.ts`) needs `--input-dir` CLI arg added with backward compatibility
- Phase D script (`scripts/test-workflowpilot-execution.ts`) needs `--input-dir` and `--output-dir` CLI args with backward compatibility
- The new regression runner (`tests/v6-regression/run-regression.ts`) is the main deliverable
- Two initial scenarios must be extracted from git history
- Windows compatibility required for the `latest` output pointer (no symlinks)

**Input**: Requirement doc, existing script source code
**Output**: `docs/workplans/v6-regression-plan-workplan.md`

---

### 2. SA -- Review Workplan

**Task**: Review Dev's workplan for architectural correctness.

Review criteria:
- Are the modifications to existing scripts backward compatible?
- Is the `execSync` approach for sub-script invocation appropriate?
- Is the folder structure and output organization sound?
- Does the EP Key Hints validation logic make sense given the plugin vocabulary system?
- Are there any risks to existing functionality?
- Is error handling adequate (timeouts, missing files, malformed JSON)?

**Input**: Dev workplan, requirement doc
**Output**: APPROVED or feedback with specific issues for Dev to address

---

### 3. Dev -- Implement

**Task**: Implement the regression test suite according to the SA-approved workplan.

Implementation order (suggested):
1. Modify Phase A script -- add `--input-dir` support
2. Modify Phase D script -- add `--input-dir` and `--output-dir` support
3. Create scenario folder structure and extract initial scenarios
4. Build the RegressionLogger class
5. Build EP Key Hints validation function
6. Build the regression runner (run-regression.ts)
7. Run the full suite and verify both scenarios pass

**Input**: SA-approved workplan, requirement doc
**Output**: All code changes, confirmation that both scenarios pass

---

### 4. SA -- Code Review

**Task**: Review all code changes from Dev implementation.

Review criteria:
- Code quality and TypeScript correctness
- Backward compatibility of modified scripts
- Error handling robustness
- Console output matches requirement specification
- Report JSON structure matches requirement schema
- No hardcoded paths that should be configurable
- No side effects on existing pipeline functionality

**Input**: Code diff from Dev
**Output**: APPROVED or specific issues for Dev to fix

---

### 5. QA -- Test

**Task**: Verify the regression suite works correctly.

Test plan:
- Run the regression suite end-to-end: `npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts`
- Verify both scenarios pass (Leads Email Summary, Customer Complaint Logger)
- Verify console output matches the format specified in the requirement
- Verify `regression-report.json` is generated with correct structure
- Verify `regression-log.txt` captures timestamps and sub-process output
- Verify existing scripts still work with their default paths (backward compatibility)
- Verify exit code is 0 when all pass
- Test failure case: temporarily break a scenario and verify exit code is 1 and failure output is correct

**Input**: Implemented code, requirement doc
**Output**: QA report with pass/fail for each test case

---

### 6. TL -- Retrospective

After QA passes, TL writes retrospective to `docs/retrospectives/retrospective.md` and presents to user for approval.

---

### 7. RM -- Commit

After user approves retrospective, RM commits all changes to branch `feature/v6-intent-contract-data-schema` with message:
```
feat(v6-regression): add regression test suite for V6 pipeline scenarios
```

---

## Status Tracking

| Step | Agent | Status | Notes |
|---|---|---|---|
| 1 | Dev | PENDING | Create workplan |
| 2 | SA | PENDING | Review workplan |
| 3 | Dev | PENDING | Implement |
| 4 | SA | PENDING | Code review |
| 5 | QA | PENDING | Test |
| 6 | TL | PENDING | Retrospective |
| 7 | RM | PENDING | Commit |
