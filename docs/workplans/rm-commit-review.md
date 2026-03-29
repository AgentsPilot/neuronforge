# RM Commit Review — Uncommitted Changes Analysis

> **Last Updated**: 2026-03-27
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Latest commit**: `90197d6` docs(v6): QA testing manual + regression test plan

## Overview

Analysis of all uncommitted files on the current feature branch, grouped into logical commit recommendations following the project's Conventional Commits style.

---

## File Inventory

### Modified (tracked)

| File | Category | Lines Changed | Assessment |
|------|----------|---------------|------------|
| `dev.log` | Runtime log | +3727 / -22540 | EXCLUDE -- runtime log, not committed |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md` | Workplan doc | +1 line (F2 item) | Include -- documents Phase A simulator limitation |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md` | QA manual | +47 lines | Include -- adds QA test results MD template |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md` | Workplan doc | +1 line (O27 item) | Include -- documents O27 bug and fix |
| `lib/pilot/StepExecutor.ts` | Runtime code | +25 lines (net) | Include -- O27 fix for `transformParametersForPlugin` |
| `scripts/test-dsl-execution-simulator/dsl-simulator.ts` | Test tooling | +18 lines | Include -- F2 partial fix for flatten schema generation |
| `scripts/test-intent-contract-generation-enhanced-prompt.json` | Test fixture | +102 / -82 lines | Include -- new scenario (Expense & Invoice Email Scanner) |

### Untracked (new)

| File | Category | Assessment |
|------|----------|------------|
| `docs/workplans/v6-pipeline-test-delegation.md` | QA delegation doc | Include -- QA task delegation record |
| `docs/workplans/v6-pipeline-test-results.md` | QA test report (Run 1) | Include -- partial pass results |
| `docs/workplans/v6-pipeline-test-results-run2.md` | QA test report (Run 2) | Include -- full pass results |
| `tests/v6-regression/scenarios/expense-invoice-email-scanner/scenario.json` | Regression scenario | Include -- new regression scenario metadata |
| `tests/v6-regression/scenarios/expense-invoice-email-scanner/enhanced-prompt.json` | Regression scenario | Include -- scenario enhanced prompt |
| `tests/v6-regression/scenarios/expense-invoice-email-scanner/intent-contract.json` | Regression scenario | Include -- captured IntentContract for replay |

### Excluded

| File | Reason |
|------|--------|
| `dev.log` | Runtime log file, not meaningful for version control |
| `.claude/settings.local.json` | Already staged in a previous diff but is a local editor setting -- should not be committed |

---

## Recommended Commits

### Commit 1: O27 bug fix in StepExecutor

**Files:**
- `lib/pilot/StepExecutor.ts`
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md` (O27 entry)

**Message:**

```
fix(pilot): O27 — preserve array fields and skip x-variable-mapping metadata in transformParametersForPlugin

transformParametersForPlugin had two sub-issues: (27a) it deleted the
`fields` array param for document-extractor because typeof [] === 'object'
entered the flattening path, and (27b) it flattened x-variable-mapping
bare refs as runtime params, overriding correctly resolved {{}} references.
Fix adds Array.isArray guard and bare-ref detection to skip metadata objects.

Files changed:
- lib/pilot/StepExecutor.ts — O27a/b guards in transformParametersForPlugin()
- docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md — O27 open item entry

Workplan: docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md
Reviewed by: SA  Tested by: QA (Phase D pass confirms fix)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**Rationale:** This is a runtime bug fix in production code. It should be its own atomic commit so it can be cherry-picked or reverted independently.

---

### Commit 2: Phase A simulator improvement + QA manual update

**Files:**
- `scripts/test-dsl-execution-simulator/dsl-simulator.ts`
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md` (F2 entry)
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md` (QA test results MD template)

**Message:**

```
feat(test): F2 — improve flatten schema handling in DSL simulator + add QA report template

Phase A simulator generated incorrect stub data when a flatten step
transforms items to a different schema (e.g., emails to attachments).
Fix detects low property overlap between input and output schemas and
generates stubs from the output schema instead. Also adds a structured
QA test results MD template to the execution scripts manual.

Files changed:
- scripts/test-dsl-execution-simulator/dsl-simulator.ts — F2 flatten schema-aware generation
- docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md — F2 open item entry
- docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md — QA report MD template

Workplan: docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**Rationale:** Test tooling improvements are separate from production code fixes. Groups the simulator code change with its documentation.

---

### Commit 3: New test scenario + enhanced prompt update + QA test results

**Files:**
- `scripts/test-intent-contract-generation-enhanced-prompt.json`
- `tests/v6-regression/scenarios/expense-invoice-email-scanner/scenario.json`
- `tests/v6-regression/scenarios/expense-invoice-email-scanner/enhanced-prompt.json`
- `tests/v6-regression/scenarios/expense-invoice-email-scanner/intent-contract.json`
- `docs/workplans/v6-pipeline-test-delegation.md`
- `docs/workplans/v6-pipeline-test-results.md`
- `docs/workplans/v6-pipeline-test-results-run2.md`

**Message:**

```
test(v6-regression): add Expense & Invoice Email Scanner scenario with QA test results

Adds the Expense & Invoice Email Scanner as a new regression scenario
covering scatter-gather loops, conditional branches (amount > 50),
document extraction, Drive per-vendor storage, and Sheets append.
Updates the default enhanced prompt to this scenario. Includes QA test
results for Run 1 (partial pass) and Run 2 (full pass after EP rewrite).

Files changed:
- scripts/test-intent-contract-generation-enhanced-prompt.json — replaced with Expense & Invoice Scanner scenario
- tests/v6-regression/scenarios/expense-invoice-email-scanner/ — new regression scenario (3 files)
- docs/workplans/v6-pipeline-test-delegation.md — QA delegation record
- docs/workplans/v6-pipeline-test-results.md — Run 1 test report (partial pass)
- docs/workplans/v6-pipeline-test-results-run2.md — Run 2 test report (full pass)

Workplan: docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**Rationale:** All test scenario files and their QA results belong together as one logical unit: "we added a new scenario and tested it."

---

## Commit Order

| Order | Commit | Depends On |
|-------|--------|------------|
| 1 | O27 bug fix (StepExecutor) | None -- standalone fix |
| 2 | F2 simulator improvement + QA template | None -- standalone |
| 3 | New regression scenario + QA results | Should come after commits 1 and 2 since the test results were produced with those fixes applied |

---

## Items NOT Ready for Commit

| Item | Reason |
|------|--------|
| `dev.log` | Runtime log -- never committed |
| `.claude/settings.local.json` | Local editor config -- should remain unstaged |

---

## Awaiting Approval

These recommendations are ready for TL or user review. No commits will be made until explicit approval is given.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-27 | Initial analysis | RM review of all uncommitted files on feature/v6-intent-contract-data-schema |
