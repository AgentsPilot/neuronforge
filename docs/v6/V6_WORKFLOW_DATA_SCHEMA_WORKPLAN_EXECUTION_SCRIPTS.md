# V6 Workflow Data Schema — Testing Scripts Reference

> **Last Updated**: 2026-03-23
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent workplans**: [Execution Workplan](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md) · [Intent Contract Workplan](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md)

## Overview

Five testing scripts validate the V6 pipeline at progressive levels of integration — from static DSL analysis to live agent execution with real plugins. Each phase builds on the previous, adding more real components while maintaining the ability to test in isolation.

| Script | Phase | What's Real | What's Mocked | External Deps |
|--------|-------|-------------|---------------|---------------|
| `test-complete-pipeline-with-vocabulary.ts` | 0–4 | Full V6 pipeline (vocabulary → DSL) | Nothing | LLM provider (OpenAI) |
| `test-dsl-execution-simulator/index.ts` | A/A+ | Static validation + stub execution | All data | None |
| `test-dsl-pilot-simulator/index.ts` | B | StepExecutor, ExecutionContext, ParallelExecutor | Plugins, Supabase | None |
| `test-workflowpilot-execution.ts` | D | Full WorkflowPilot (all 8 phases) | Plugins, Supabase, LLM | None |
| `test-live-agent-execution.ts` | E | Everything — real plugins, real DB, real LLM | Nothing | Supabase, OAuth, LLM, plugin APIs |

### Recommended Testing Order

```
Phase 0-4 (compile DSL) → Phase A (validate structure) → Phase D (mock execution) → Phase E (live execution)
```

Phase B is available for lower-level StepExecutor debugging but is typically skipped in favor of Phase D.

---

## Script 1: Pipeline Compiler (`test-complete-pipeline-with-vocabulary.ts`)

Runs the full V6 pipeline: vocabulary extraction → IntentContract generation (LLM) → capability binding → IR conversion → DSL compilation.

### Usage

```bash
# Full pipeline with default prompt (invoice extraction)
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts

# Full pipeline with custom enhanced prompt
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json

# Deterministic run — skip LLM, reuse existing IntentContract
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json \
  --intent-contract output/vocabulary-pipeline/phase1-intent-contract.json

# Custom output directory
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json \
  --output-dir output/my-test-run
```

### Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| Positional arg 1 | No | Built-in invoice prompt | Path to custom enhanced prompt JSON |
| `--intent-contract <path>` | No | — | Load pre-built IntentContract, skip LLM call (deterministic from Phase 2 onward) |
| `--output-dir <path>` | No | `output/vocabulary-pipeline/` | Output directory for all artifacts |

### Input Files

- **Enhanced prompt JSON** — defines `plan_title`, `sections`, `specifics.services_involved`, `specifics.resolved_user_inputs`
- **IntentContract JSON** (optional) — previously generated IntentContract to reuse

### Output Files

| File | Phase | Description |
|------|-------|-------------|
| `phase0-plugin-vocabulary.json` | 0 | Extracted plugin vocabulary (domains, capabilities, actions, params) |
| `phase0-vocabulary-for-prompt.txt` | 0 | Formatted vocabulary text injected into LLM prompt |
| `phase0-workflow-config.json` | 0 | User-provided configuration values |
| `phase1-intent-contract.json` | 1 | LLM-generated IntentContract |
| `phase1-intent-raw-llm-output.txt` | 1 | Raw LLM response text |
| `phase2-bound-intent-contract.json` | 2 | BoundIntentContract with plugin bindings |
| `phase2-data-schema.json` | 2 | Data schema (slots, types, producers, consumers) |
| `phase3-execution-graph-ir-v4.json` | 3 | Execution graph IR (intermediate representation) |
| `phase4-pilot-dsl-steps.json` | 4 | **Final compiled DSL** — input for all downstream scripts |
| `phase4-workflow-config.json` | 4 | Merged config (IntentContract defaults + user overrides) |
| `phase4-compiler-logs.txt` | 4 | Detailed compiler debug logs (all phases) |

### When to Use

- **First run** — generate a new DSL from a prompt
- **After compiler changes** — re-compile with `--intent-contract` to test deterministically (same intent, different compilation)
- **Debugging** — review `phase4-compiler-logs.txt` for field reconciliation, config merging, normalization details

---

## Script 2: DSL Execution Simulator (`test-dsl-execution-simulator/index.ts`)

Static validation + stub-data simulation. Runs 13 checks on the compiled DSL without any external dependencies.

### Usage

```bash
npx tsx scripts/test-dsl-execution-simulator/index.ts
```

### Arguments

None. Reads from default `output/vocabulary-pipeline/` directory.

### Input Files

| File | Required | Description |
|------|----------|-------------|
| `phase4-pilot-dsl-steps.json` | Yes | Compiled DSL |
| `phase4-workflow-config.json` | Yes | Merged config |
| `phase2-data-schema.json` | No | Data schema (for enhanced validation) |

### Output Files

| File | Description |
|------|-------------|
| `execution-simulation-report.json` | Full report with step log, validation results, DAG visualization |

### Validation Checks (13)

**Phase A (6 checks):**
1. Variable resolution — all `{{input.X}}` and `{{step.field}}` refs resolve
2. Data flow chain — each step's input was produced by an earlier step
3. Config coverage — every config key in DSL has a value
4. Field consistency — `{{variable.field}}` matches upstream output schema
5. Schema completeness — all steps have output schemas
6. Duplicate output variables — no two steps produce the same variable

**Phase A+ (7 checks):**
7. Cross-step field reference tracing — field names match across the chain
8. Scatter-gather item field validation — iteration item refs verified
9. Conditional condition field validation — condition fields exist, types match
10. Config value type checking — values match expected types
11. Output schema completeness — required fields present
12. Duplicate detection — no redundant output variables
13. DAG visualization — execution order graph

### When to Use

- **After every pipeline compilation** — quick sanity check (< 1 second)
- **Before Phase D or E** — catch structural issues before running the engine

---

## Script 3: Pilot Simulator (`test-dsl-pilot-simulator/index.ts`)

Runs DSL through real Pilot engine components (StepExecutor, ExecutionContext, ParallelExecutor) with mocked plugins. Validates the DSL is actually executable in the real engine.

### Usage

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-dsl-pilot-simulator/index.ts
```

### Arguments

None. Reads from default `output/vocabulary-pipeline/` directory.

### Input Files

| File | Required | Description |
|------|----------|-------------|
| `phase4-pilot-dsl-steps.json` | Yes | Compiled DSL |
| `phase4-workflow-config.json` | Yes | Merged config |

### Output Files

| File | Description |
|------|-------------|
| `pilot-simulation-report.json` | Execution summary with step log and errors |

### Mock Setup

- **PluginExecuterV2** — returns stub data generated from step's `output_schema`
- **Supabase** — not used (StepExecutor created without StateManager)
- **LLM** — not called (AI steps skipped or mocked)

### When to Use

- **Debugging StepExecutor routing** — verify step types are dispatched correctly
- **Testing scatter-gather mechanics** — verify fan-out/collect with stub data
- **Lower-level debugging** — when Phase D fails and you need to isolate StepExecutor behavior

---

## Script 4: WorkflowPilot Execution (`test-workflowpilot-execution.ts`)

Runs DSL through the **real WorkflowPilot** with all 8 execution phases, real WorkflowParser, real ConditionalEvaluator — but with mocked plugins, mocked Supabase, and mocked LLM. Zero external dependencies.

### Usage

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts
```

### Arguments

None. Reads from default `output/vocabulary-pipeline/` directory.

### Input Files

| File | Required | Description |
|------|----------|-------------|
| `phase4-pilot-dsl-steps.json` | Yes | Compiled DSL |
| `phase4-workflow-config.json` | Yes | Merged config |

### Output Files

| File | Description |
|------|-------------|
| `workflowpilot-execution-report.json` | Execution summary with step details |
| `workflowpilot-execution-log.txt` | Full console output (all engine logs) |

### Mock Setup

- **PluginExecuterV2** — singleton patched to return stub data from output schemas
- **StepExecutor.executeLLMDecision** — prototype patched to return stub data (no real OpenAI calls)
- **Supabase** — proxy-based mock that handles any query chain pattern; returns `pilot_enabled: true`
- **AuditTrailService** — disabled (no DB writes)
- **Agent** — in-memory object with pilot_steps, plugins, inputValues

### When to Use

- **After compiler changes** — verify the full engine accepts the DSL
- **Before going live** — confirm execution flow (conditionals, scatter-gather, transforms) works end-to-end
- **Debugging engine issues** — review `workflowpilot-execution-log.txt` for detailed engine logs

---

## Script 5: Live Agent Execution (`test-live-agent-execution.ts`)

Full end-to-end execution with **real plugins, real database, real LLM**. Saves DSL to an actual agent, refreshes OAuth tokens, executes via WorkflowPilot, and captures step-by-step I/O.

### Usage

```bash
# Basic — uses default DSL and config from output/vocabulary-pipeline/
npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
  --agent-id 4d30ef95-7246-4c7d-8ef3-c199fc611e0c

# Custom DSL and config paths
npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
  --agent-id 4d30ef95-7246-4c7d-8ef3-c199fc611e0c \
  --dsl output/my-test/phase4-pilot-dsl-steps.json \
  --config output/my-test/phase4-workflow-config.json
```

### Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--agent-id <UUID>` | **Yes** | — | Agent ID (must exist in Supabase) |
| `--dsl <path>` | No | `output/vocabulary-pipeline/phase4-pilot-dsl-steps.json` | Compiled DSL file |
| `--config <path>` | No | `output/vocabulary-pipeline/phase4-workflow-config.json` | Workflow config file |

### Prerequisites

- `.env.local` with `TEST_USER_ID`, Supabase URL/key, OpenAI API key
- Agent must exist in the `agents` table with matching `user_id`
- Plugin OAuth connections must be active for all plugins in the DSL
- Real test data must exist (e.g., a Google Sheet with data, emails in inbox)

### Pre-Flight Checks

The script performs 7 pre-flight checks before execution:

1. **Parse CLI arguments** — validate `--agent-id` is provided
2. **Load and validate DSL** — must be non-empty array with `id`, `type`, `name` fields
3. **Load and validate config** — must be non-empty object
4. **Verify agent exists** — queries Supabase by `agent_id` + `user_id`
5. **Validate plugin connections** — checks all plugins referenced in DSL are connected
6. **Refresh OAuth tokens** — refreshes tokens expiring within 60 minutes
7. **Update agent** — saves compiled `pilot_steps` to the agent record

### Output Files

| File | Description |
|------|-------------|
| `live-execution-report.json` | Full report: summary, step details, step I/O, plugin status, config keys |
| `live-execution-log.txt` | Full console output including all engine and plugin logs |

### Step I/O Capture

The script patches `StepExecutor.prototype.execute` to capture per-step:

| Field | Description |
|-------|-------------|
| `step_id` | Step identifier |
| `type` | Step type (action, transform, ai_processing, conditional) |
| `plugin` / `action` | Plugin and action name (for action steps) |
| `description` | Step description |
| `resolved_input` | Input data after variable resolution |
| `output` | Step output data (truncated to 2000 chars) |
| `status` | `ok` or `error` |
| `duration_ms` | Execution time in milliseconds |
| `error` | Error message (if failed) |

### When to Use

- **Final validation** — confirm real data flows correctly through all steps
- **After compiler fixes** — verify the fix works with real APIs, not just mocks
- **Demo/testing** — run a real agent and check results (email sent, sheet updated, etc.)

---

## Typical Workflow

### 1. Create or Update Enhanced Prompt

Edit `scripts/test-intent-contract-generation-enhanced-prompt.json` with your workflow definition:

```json
{
  "plan_title": "My Workflow",
  "sections": {
    "data": ["- Read data from..."],
    "actions": ["- Filter where..."],
    "output": ["- Generate HTML..."],
    "delivery": ["- Send email to..."]
  },
  "specifics": {
    "services_involved": ["google-sheets", "google-mail"],
    "resolved_user_inputs": [
      { "key": "google_sheets__table_read__spreadsheet_id", "value": "1abc..." },
      { "key": "google_mail__email_send__recipients", "value": "user@example.com" }
    ]
  }
}
```

### 2. Compile DSL (Phase 0–4)

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json
```

### 3. Validate DSL (Phase A)

```bash
npx tsx scripts/test-dsl-execution-simulator/index.ts
```

Check: `13/13 checks passed, 0 errors`

### 4. Test with Mocked Engine (Phase D)

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts
```

Check: `Success: ✅`, all steps completed

### 5. Run Live (Phase E)

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
  --agent-id <your-agent-id>
```

Check: `PHASE E PASSED`, verify real results (email received, sheet updated)

### 6. Iterate on Compiler Fix

After making a compiler change, re-compile deterministically (skip LLM):

```bash
# Re-compile with same IntentContract
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json \
  --intent-contract output/vocabulary-pipeline/phase1-intent-contract.json

# Validate
npx tsx scripts/test-dsl-execution-simulator/index.ts

# Test with engine
npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `supabaseUrl is required` | Add `--import ./scripts/env-preload.ts` to the command |
| `pilot_enabled` error in Phase D | Mock Supabase handles this — ensure you're running the latest script |
| Phase A warnings about `Unknown transform operation` | Expected for `rows_to_objects` — runtime handles it, simulator doesn't know the operation |
| Phase E `token valid (expires in X min)` shows 0 | Token refresh failed — check OAuth credentials in plugin_connections |
| Phase E hangs after completion | OpenAI client keeps connection alive — Ctrl+C to exit |
| `--intent-contract` still calls LLM | Ensure the flag comes **after** the positional prompt file argument |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-23 | Initial version | Documented all 5 testing scripts with usage, arguments, I/O files, and examples |
