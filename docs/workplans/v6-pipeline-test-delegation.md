# V6 Pipeline Test — QA Delegation

> **Last Updated**: 2026-03-27
> **Delegated by**: TL
> **Assigned to**: QA

## Overview

QA is being triggered to run the V6 pipeline end-to-end test using the existing test scripts and the default enhanced prompt. This is a testing-only task — no BA, Dev, or SA involvement is needed.

## QA Instructions

Follow the step-by-step QA manual at `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md`.

### Specific directives

1. **Enhanced Prompt**: Use the default file at `scripts/test-intent-contract-generation-enhanced-prompt.json`.
2. **EP Key Hints (Step 2)**: Validate the `resolved_user_inputs` keys. Two keys (`sheet_tab_name` and `google_sheet_id_candidate`) may need plugin prefixes per the convention — fix them if necessary.
3. **IntentContract (Step 3)**: Generate a new IntentContract (do not reuse an existing one unless one is already present in `output/vocabulary-pipeline/`).
4. **Run Steps 4-6**: Compile DSL (Phase 0-4), validate DSL structure (Phase A), and run mock execution (Phase D).
5. **Skip Phase E**: Do not run live execution — the user did not request it.
6. **Report**: Share the full console output and QA verdict (Step 8 format) with the user.

### Commands to run (in order)

```bash
# Step 4 — Compile
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts scripts/test-intent-contract-generation-enhanced-prompt.json

# Step 5 — Phase A static validation
npx tsx scripts/test-dsl-execution-simulator/index.ts

# Step 6 — Phase D mock execution
npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts
```

## Status

| Step | Status |
|------|--------|
| QA triggered | Pending |
| Test execution | Pending |
| Results reported | Pending |
