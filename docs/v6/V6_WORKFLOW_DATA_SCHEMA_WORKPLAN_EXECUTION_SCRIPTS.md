# V6 Pipeline — QA Testing Manual

> **Last Updated**: 2026-03-26
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent workplans**: [Execution Workplan](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md) · [Intent Contract Workplan](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md)

## Overview

This document is a step-by-step QA manual for testing the V6 Intent Contract → DSL compilation → agent execution pipeline. It guides a QA tester (human or AI agent) through the full validation cycle for a single workflow scenario.

**What this tests:** The V6 compiler pipeline — from an enhanced prompt (natural language workflow description) through DSL compilation, static validation, mock execution, and optionally live execution with real APIs.

**When to use:**
- After implementing a new compiler fix (O-series item)
- When testing a new workflow scenario end-to-end
- Before merging a feature branch into main
- To validate a regression after refactoring shared compiler infrastructure

---

## Prerequisites

Before starting, ensure:

- [ ] Node.js installed (v18+)
- [ ] `.env.local` configured with Supabase URL/key, OpenAI API key, `TEST_USER_ID`
- [ ] Dependencies installed (`npm install`)
- [ ] On the correct branch (`feature/v6-intent-contract-data-schema` or the branch under test)

---

## Testing Flow

```
Step 1: Obtain Enhanced Prompt
     ↓
Step 2: Validate EP Key Hints
     ↓
Step 3: Check / Generate IntentContract (Phase 1)
     ↓
Step 4: Compile DSL (Phase 0–4)
     ↓
Step 5: Validate DSL Structure (Phase A)
     ↓ (abort if failed)
Step 6: Mock Execution (Phase D)
     ↓ (abort if failed)
Step 7: Live Execution (Phase E) — optional, requires agent ID
     ↓
Step 8: QA Verdict
     ↓ (if passed)
Step 9: Add to Regression Suite — optional
```

---

## Step 1: Obtain Enhanced Prompt

Ask the user:

> **"Do you have a custom enhanced prompt JSON, or should we use the default?"**

| Option | Action |
|---|---|
| **Use default** | Use `scripts/test-intent-contract-generation-enhanced-prompt.json` |
| **Custom prompt** | Receive the file path from the user. Verify the file exists and is valid JSON. |

The enhanced prompt JSON must have this structure:

```json
{
  "plan_title": "...",
  "plan_description": "...",
  "sections": {
    "data": ["..."],
    "actions": ["..."],
    "output": ["..."],
    "delivery": ["..."]
  },
  "specifics": {
    "services_involved": ["google-mail", "google-sheets"],
    "resolved_user_inputs": [
      { "key": "...", "value": "..." }
    ]
  }
}
```

**Validation checklist:**
- [ ] File exists and is valid JSON
- [ ] `specifics.services_involved` is a non-empty array
- [ ] `specifics.resolved_user_inputs` is a non-empty array
- [ ] `sections` has at least `data` and `actions`

---

## Step 2: Validate EP Key Hints

The `resolved_user_inputs` keys must follow the EP Key Hints convention for the compiler's O8/O26 features to work correctly.

**Convention:** Plugin-specific keys use the format `plugin__capability__param_name`

**Examples of correct keys:**
- `google_sheets__table_read__spreadsheet_id`
- `google_sheets__table_create__columns`
- `google_mail__email_search__query`
- `google_mail__email_send__recipients`

**Generic keys (no prefix needed):**
- `user_email`, `complaint_keywords`, `qualification_rule`, `no_results_behavior`

**Validation logic:**

For each key in `resolved_user_inputs`:
1. If the key contains `__` → it has a prefix → ✅ OK
2. If the key does NOT contain `__`, check if it matches a known plugin parameter name:
   - `spreadsheet_id` → should be `google_sheets__table_read__spreadsheet_id` (or `table_create`)
   - `sheet_tab_name` → should be `google_sheets__table_read__sheet_tab_name`
   - `query` → should be `google_mail__email_search__query`
   - `recipients` → should be `google_mail__email_send__recipients`
   - `range` → should be `google_sheets__table_read__range`
3. If it's a generic key (not a plugin parameter) → ✅ OK, leave as-is

**If keys are missing prefixes:**

```
⚠️  EP Key Hints: 2 keys missing prefix — fixing before test:
   spreadsheet_id → google_sheets__table_read__spreadsheet_id
   sheet_tab_name → google_sheets__table_read__sheet_tab_name
```

Fix the keys **in the file** (update the enhanced prompt JSON) so future runs don't need re-fixing. Inform the user of the changes made.

---

## Step 3: Check / Generate IntentContract

Ask the user:

> **"Is there an existing IntentContract (phase1-intent-contract.json) to reuse, or should we generate a new one?"**

| Option | Action |
|---|---|
| **Reuse existing** | User provides the path (e.g., `output/vocabulary-pipeline/phase1-intent-contract.json`). Verify file exists. |
| **Generate new** | Will be generated in Step 4 via LLM call (costs tokens, takes ~10-15s). |

**When to reuse:** Testing compiler changes — same intent, different compilation. This makes the test deterministic from Phase 2 onward.

**When to generate new:** Testing a new scenario for the first time, or after changing the enhanced prompt.

---

## Step 4: Compile DSL (Phase 0–4)

Run the pipeline compiler:

```bash
# With existing IntentContract (deterministic — no LLM call):
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  <enhanced-prompt-path> \
  --intent-contract <intent-contract-path>

# Without IntentContract (full LLM run):
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  <enhanced-prompt-path>
```

**Expected output:** Pipeline completes without errors. Check:
- [ ] `output/vocabulary-pipeline/phase4-pilot-dsl-steps.json` exists and is non-empty
- [ ] `output/vocabulary-pipeline/phase4-workflow-config.json` exists and has config keys
- [ ] Console shows step count (e.g., "Compiled 10 DSL steps")
- [ ] No `ERROR` lines in console output

**Review `phase4-compiler-logs.txt`** for warnings:
- `[O11]` — unreferenced config keys (warning only, not blocking)
- `[O16]` — nullable→required parameter mappings
- `[O24]` — unresolvable custom_code (potential runtime issue)
- `[O26]` — column mapping results

**If compilation fails:** Check the error message. Common issues:
- `supabaseUrl is required` → missing `--import ./scripts/env-preload.ts`
- Plugin not found → check `services_involved` matches available plugin definitions
- LLM timeout → retry, or use `--intent-contract` with a known-good IntentContract

---

## Step 5: Validate DSL Structure (Phase A)

Run the static validator:

```bash
npx tsx scripts/test-dsl-execution-simulator/index.ts
```

**Expected output:**

```
✅ SIMULATION PASSED
   Passed: 13/13
   Failed: 0/13
```

**Pass criteria:**
- [ ] 13/13 checks passed
- [ ] 0 errors
- [ ] Warnings are acceptable (e.g., "Config key X not referenced" is informational)

**If Phase A fails: ❌ ABORT the test.** Do not proceed to Phase D.

Report the failure:
- Which checks failed
- The specific error messages
- The scenario and enhanced prompt used

**Common Phase A failures:**
| Failure | Likely Cause |
|---|---|
| Data flow break: "X not yet produced" | Compiler didn't connect step outputs correctly |
| Field mismatch: "X not in schema" | O10 reconciliation didn't catch a field name mismatch |
| Unresolved ref: `{{config.X}}` | Config key not in merged config (O7/O11 issue) |
| Conditional field error | Condition references a field that doesn't exist on the variable |

---

## Step 6: Mock Execution (Phase D)

Run the WorkflowPilot with mocked plugins:

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts
```

**Expected output:**

```
✅ PHASE D PASSED
   Success: ✅
   Steps completed: N
   Steps failed: 0
```

**Pass criteria:**
- [ ] `Success: ✅`
- [ ] Steps failed: 0
- [ ] Steps completed matches expected count from the scenario

**If Phase D fails: ❌ ABORT the test.** Do not proceed to Phase E.

Report the failure:
- Which step failed and the error message
- Review `output/vocabulary-pipeline/workflowpilot-execution-log.txt` for detailed engine logs
- Check `output/vocabulary-pipeline/workflowpilot-execution-report.json` for structured error data

**Common Phase D failures:**
| Failure | Likely Cause |
|---|---|
| `Map operation requires array input` | Transform input resolves to an object, not array (O23/O24 issue) |
| `Plugin executor not found` | Plugin not registered in mock (missing from scenario's services) |
| `Cannot read properties of undefined` | Variable reference resolves to undefined (data flow issue) |
| `Workflow pilot is disabled` | Mock Supabase not returning `pilot_enabled: true` |

---

## Step 7: Live Execution (Phase E) — Optional

Ask the user:

> **"Phase D passed. Do you want to run a live execution with real APIs? If yes, please provide an agent ID."**

| Option | Action |
|---|---|
| **Skip** | Proceed to Step 8 with Phase D as the final validation |
| **Run live** | User provides agent UUID. Proceed with Phase E. |

**Prerequisites for Phase E:**
- [ ] Agent exists in the `agents` table in Supabase
- [ ] Agent's `user_id` matches `TEST_USER_ID` in `.env.local`
- [ ] Plugin OAuth connections are active for all plugins in the DSL
- [ ] Real test data exists (emails in inbox, Google Sheet with data, etc.)

Run the live execution:

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
  --agent-id <agent-uuid>
```

**Expected output:**

```
✅ PHASE E PASSED
   Success: ✅
   Steps completed: N
   Steps failed: 0
```

**Pass criteria:**
- [ ] `Success: ✅`
- [ ] Steps failed: 0
- [ ] Verify real-world results: email received, sheet updated, files created, etc.

**If Phase E fails:** Report the failure with:
- `output/vocabulary-pipeline/live-execution-report.json` — structured step I/O data
- `output/vocabulary-pipeline/live-execution-log.txt` — full engine and plugin logs
- Which step failed and why (check step_io section for resolved inputs and outputs)

---

## Step 8: QA Verdict

Generate the QA report based on the results:

```
══════════════════════════════════════════════════════════════════
                    QA TEST REPORT
══════════════════════════════════════════════════════════════════

  Scenario: Customer Complaint Email Logger
  Enhanced Prompt: scripts/test-intent-contract-generation-enhanced-prompt.json
  IntentContract: output/vocabulary-pipeline/phase1-intent-contract.json (reused)
  Date: 2026-03-26

  Phase         Status    Details
  ────────────────────────────────────────────────────────
  EP Key Hints   ✅       All keys have prefix
  Compile        ✅       10 steps compiled
  Phase A        ✅       13/13 checks passed
  Phase D        ✅       10/10 steps, 0 failures
  Phase E        ✅       10/10 steps, real APIs verified

──────────────────────────────────────────────────────────
  ✅ QA PASSED — all phases successful
══════════════════════════════════════════════════════════════════
```

**On failure:**

```
──────────────────────────────────────────────────────────
  ❌ QA FAILED — Phase A had 2 errors

  Failed checks:
    - Data flow break: step5 references "foo" not yet produced
    - Field mismatch: step7 item.message_id not in schema
══════════════════════════════════════════════════════════════════
```

**QA pass = ALL executed phases passed.** If Phase E was skipped (user chose not to run live), the verdict is based on Compile + Phase A + Phase D.

**Output files for the QA report:**
- Console output (copy/paste or screenshot)
- `output/vocabulary-pipeline/execution-simulation-report.json` (Phase A)
- `output/vocabulary-pipeline/workflowpilot-execution-report.json` (Phase D)
- `output/vocabulary-pipeline/live-execution-report.json` (Phase E, if ran)

**QA Test Results MD (required):**

After completing the test, generate a structured markdown report at:

```
docs/workplans/v6-pipeline-test-results-YYYY-MM-DD-HH-MM-SS.md
```

The timestamp suffix ensures each test run is uniquely identifiable and historical results are preserved.

**Required sections in the report MD:**

```markdown
# V6 Pipeline Test Results — YYYY-MM-DD-HH-MM-SS

> **Date**: YYYY-MM-DD
> **Branch**: `feature/...`
> **Scenario**: <scenario name>
> **Enhanced Prompt**: <path to enhanced prompt used>

## Test Summary

| Phase | Description | Status | Details |
|-------|-------------|--------|---------|
| EP Key Hints | Validate resolved_user_inputs key format | PASS/FAIL | <details> |
| Phase 0-4 | Compile enhanced prompt to DSL | PASS/FAIL | <step count, compile time> |
| Phase A | Static DSL validation (13 checks) | PASS/FAIL (X/13) | <errors, warnings> |
| Phase D | Mock WorkflowPilot execution | PASS/FAIL | <steps completed/total> |
| Phase E | Live execution (if ran) | PASS/FAIL/SKIPPED | <steps completed, real results> |

**Overall Verdict: PASS / FAIL**

## Comparison with Previous Run (if applicable)

<table comparing key metrics with the previous test run>

## Issues Found (if any)

<list of issues discovered during this run>

## DAG

<paste the DAG from Phase A report>
```

**Naming convention:** Use the timestamp from when the test started, not when the report was written. Example: `v6-pipeline-test-results-2026-03-27-10-00-58.md`

---

## Step 9: Add to Regression Suite (Optional)

If the test passed, ask the user:

> **"QA passed. Should we add this scenario to the regression test suite?"**

If yes, follow these steps:

### 9.1 Create Scenario Folder

```bash
mkdir -p tests/v6-regression/scenarios/<scenario-name>
```

Use kebab-case for the folder name (e.g., `complaint-email-logger`, `leads-email-summary`).

### 9.2 Copy Input Files

```bash
# Copy the enhanced prompt
cp <enhanced-prompt-path> tests/v6-regression/scenarios/<scenario-name>/enhanced-prompt.json

# Copy the IntentContract (from the test run output)
cp output/vocabulary-pipeline/phase1-intent-contract.json tests/v6-regression/scenarios/<scenario-name>/intent-contract.json
```

### 9.3 Create Scenario Metadata

Create `tests/v6-regression/scenarios/<scenario-name>/scenario.json`:

```json
{
  "name": "<Scenario Display Name>",
  "description": "<Brief description of what the workflow does>",
  "created": "<YYYY-MM-DD>",
  "plugins": ["<list of plugins from services_involved>"],
  "expected": {
    "min_steps": <number of steps from Phase D>,
    "step_types": ["action", "transform", "scatter_gather"],
    "phase_a_checks": 13,
    "phase_d_success": true
  }
}
```

Fill in:
- `min_steps` — from the Phase D report (`steps_completed`)
- `step_types` — from the DSL (unique step types present)
- `plugins` — from the enhanced prompt's `services_involved`

### 9.4 Verify Regression

Run the regression suite to confirm the new scenario passes alongside existing ones:

```bash
npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts
```

Check: all scenarios pass, including the newly added one.

### 9.5 Commit

```bash
git add tests/v6-regression/scenarios/<scenario-name>/
git commit -m "test(v6-regression): add <scenario-name> scenario"
```

---

## Available Testing Scripts — Quick Reference

| Script | Phase | Command | What's Real | What's Mocked |
|--------|-------|---------|-------------|---------------|
| Pipeline Compiler | 0–4 | `npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts <prompt> [--intent-contract <path>]` | Full V6 pipeline | Nothing |
| DSL Simulator | A | `npx tsx scripts/test-dsl-execution-simulator/index.ts` | Static validation | All data |
| WorkflowPilot Mock | D | `npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts` | Full WorkflowPilot engine | Plugins, DB, LLM |
| Live Execution | E | `npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts --agent-id <UUID>` | Everything | Nothing |
| Regression Suite | All | `npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts` | Compile + A + D for all scenarios | Plugins, DB, LLM |

### CLI Arguments Reference

| Script | Argument | Default | Description |
|---|---|---|---|
| Pipeline | Positional arg 1 | Built-in prompt | Path to enhanced prompt JSON |
| Pipeline | `--intent-contract <path>` | — | Skip LLM, reuse IntentContract |
| Pipeline | `--output-dir <path>` | `output/vocabulary-pipeline/` | Output directory |
| Simulator | `--input-dir <path>` | `output/vocabulary-pipeline/` | Input directory for DSL/config |
| WorkflowPilot | `--input-dir <path>` | `output/vocabulary-pipeline/` | Input directory |
| WorkflowPilot | `--output-dir <path>` | Same as `--input-dir` | Output directory for report/log |
| Live Execution | `--agent-id <UUID>` | **required** | Agent ID in Supabase |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `supabaseUrl is required` | Add `--import ./scripts/env-preload.ts` to the command |
| `pilot_enabled` error in Phase D | Mock Supabase handles this — ensure latest script version |
| Phase A warnings about `Unknown transform operation` | Expected for `rows_to_objects` — simulator doesn't know it |
| Phase E token refresh shows 0 minutes | OAuth token expired — re-authenticate the plugin |
| Phase E hangs after completion | OpenAI client keeps connection — Ctrl+C to exit |
| `--intent-contract` still calls LLM | Flag must come **after** the positional prompt file argument |
| Phase D `Map operation requires array input` | Check if O23/O24 fixes are applied — run with latest compiler |
| `Plugin executor not found` in Phase E | Plugin doesn't have an executor (e.g., `document-extractor`) — see D-B5 in execution workplan |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-23 | Initial version | Documented all 5 testing scripts with usage, arguments, I/O files |
| 2026-03-26 | Rewritten as QA manual | Step-by-step testing flow, EP key hints validation, QA verdict format, regression suite integration |
