# V6 Workflow Data Schema — Regression Test Plan

> **Last Updated**: 2026-03-26

## Overview

This document defines the regression testing strategy for the V6 Intent Contract → DSL compilation → execution pipeline. The goal is to ensure that compiler changes (O-series fixes, new features) don't break previously working workflows.

---

## Motivation

The V6 compiler has grown through 26+ iterative fixes (O7–O26), each targeting a specific data flow, field mapping, or runtime execution issue. Each fix was validated against the active test scenario at the time, but there is no mechanism to verify that a new fix doesn't regress a previously working scenario.

**Without regression testing:**
- O26 (column mapping) could break O13 (flatten) if both touch the same compiler phase
- A new scenario could expose a latent bug masked by the current test data
- Refactors to shared infrastructure (e.g., `resolveFieldMismatch`, `buildSchemaMap`) have unbounded blast radius

**With regression testing:**
- Every commit can be validated against all known-good scenarios
- New scenarios are added as they're developed and verified
- CI integration provides automated safety net before merge

---

## Architecture

### Scenario Structure

Each regression scenario is a self-contained folder under `tests/v6-regression/scenarios/`:

```
tests/v6-regression/
├── scenarios/
│   ├── leads-email-summary/
│   │   ├── enhanced-prompt.json          # Input: enhanced prompt with EP key hints
│   │   ├── intent-contract.json          # Input: fixed Phase 1 LLM output (skip LLM call)
│   │   └── scenario.json                 # Metadata: name, description, expected step count, plugins
│   │
│   ├── complaint-email-logger/
│   │   ├── enhanced-prompt.json
│   │   ├── intent-contract.json
│   │   └── scenario.json
│   │
│   └── (future scenarios added here)
│
├── output/                               # Gitignored — generated during test run
│   ├── 2026-03-26-14-30-00/              # Timestamped run folder
│   │   ├── leads-email-summary/
│   │   │   ├── phase4-pilot-dsl-steps.json
│   │   │   ├── phase4-workflow-config.json
│   │   │   ├── phase-a-report.json
│   │   │   ├── phase-d-report.json
│   │   │   └── phase-d-log.txt
│   │   ├── complaint-email-logger/
│   │   │   └── (same structure)
│   │   └── regression-report.json        # Overall pass/fail summary
│   └── latest → 2026-03-26-14-30-00/    # Symlink to most recent run
│
└── run-regression.ts                     # Master regression runner script
```

### Scenario Metadata (`scenario.json`)

```json
{
  "name": "Customer Complaint Email Logger",
  "description": "Gmail search → dedup filter → scatter-gather append to Sheets",
  "created": "2026-03-26",
  "plugins": ["google-mail", "google-sheets"],
  "expected": {
    "min_steps": 6,
    "step_types": ["action", "transform", "scatter_gather"],
    "phase_a_checks": 13,
    "phase_d_success": true
  }
}
```

### What Each Phase Tests

| Phase | What It Validates | Pass Criteria |
|---|---|---|
| **Compile** | Pipeline Phase 0→4: vocabulary extraction, intent contract binding, IR conversion, DSL compilation | Compilation completes without error, DSL has ≥ `min_steps` steps |
| **Phase A** | Static DSL validation: variable resolution, data flow, field references, config coverage, schema completeness | 13/13 checks passed, 0 errors |
| **Phase D** | Real WorkflowPilot execution with mocked plugins: StepExecutor, ExecutionContext, ParallelExecutor, ConditionalEvaluator | `success: true`, 0 failed steps |

---

## Implementation Plan

### Step 1: Add Custom Path Support to Existing Scripts

Both `test-dsl-execution-simulator/index.ts` (Phase A) and `test-workflowpilot-execution.ts` (Phase D) currently read from hardcoded `output/vocabulary-pipeline/`. Add `--input-dir` and `--output-dir` CLI arguments so the regression runner can point them at scenario-specific folders.

**Files to modify:**
- `scripts/test-dsl-execution-simulator/index.ts` — accept `--input-dir` for DSL/config/schema paths, `--output-dir` for report
- `scripts/test-workflowpilot-execution.ts` — accept `--input-dir` for DSL/config, `--output-dir` for report/log

**Backward compatible:** When no args provided, default to current `output/vocabulary-pipeline/` behavior.

### Step 2: Build Regression Runner (`run-regression.ts`)

The master script that orchestrates all scenarios:

```
npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts
```

**Flow per scenario:**

```
1.  Read scenario.json metadata
2.  Load enhanced-prompt.json
3.  EP Key Hints validation (see Pre-Flight section below)
4.  Run pipeline compiler:
      npx tsx scripts/test-complete-pipeline-with-vocabulary.ts \
        <scenario>/enhanced-prompt.json \
        --intent-contract <scenario>/intent-contract.json \
        --output-dir <run-output>/<scenario>/
5.  Validate compilation output:
      - DSL file exists and has ≥ min_steps steps
      - Config file exists and has ≥ 1 key
6.  Run Phase A simulator:
      npx tsx scripts/test-dsl-execution-simulator/index.ts \
        --input-dir <run-output>/<scenario>/
7.  Check Phase A result:
      - 13/13 checks passed (or expected count from scenario.json)
      - 0 errors
8.  Run Phase D mock execution:
      npx tsx scripts/test-workflowpilot-execution.ts \
        --input-dir <run-output>/<scenario>/
9.  Check Phase D result:
      - success === true
      - 0 failed steps
10. Record scenario result: PASS / FAIL with details
```

**Execution modes:**
- **Sequential** (default): Run scenarios one at a time. Simpler, clearer logs.
- **Parallel** (future): Run scenarios concurrently for faster CI. Requires isolated output dirs (already designed).

### Pre-Flight: EP Key Hints Validation (Step 3)

Before running the pipeline, the runner validates that `resolved_user_inputs` in the enhanced prompt follow the EP key hints convention (`plugin__capability__param_name`). This ensures the compiler's O8/O26 features work correctly.

**Validation logic:**

```typescript
function validateEPKeyHints(enhancedPrompt: any, plugins: string[]): {
  valid: boolean;
  warnings: string[];
  autoFixedKeys: { original: string; fixed: string }[];
}
```

1. Load `resolved_user_inputs` from the enhanced prompt
2. For each input key, check if it matches the EP key hint pattern: `plugin__capability__param_name`
3. If a key does NOT have the prefix but can be inferred from the `services_involved` list and plugin vocabulary:
   - Emit a **warning** to console: `⚠️ Key "spreadsheet_id" missing EP hint prefix — auto-fixing to "google_sheets__table_read__spreadsheet_id"`
   - Auto-fix the key **in memory only** (do not modify the scenario file on disk)
   - Continue the test with the fixed keys
4. Keys that cannot be inferred (generic keys like `complaint_keywords`, `no_results_behavior`) are left as-is — no warning

**Rules for auto-fix inference:**
- Match key name against plugin parameter names from the vocabulary (e.g., `spreadsheet_id` → found in `google-sheets` plugin → `google_sheets__table_read__spreadsheet_id`)
- If a key matches parameters in multiple plugins, use the `services_involved` list from the enhanced prompt to disambiguate
- If still ambiguous, emit warning but do NOT auto-fix — leave the key as-is

**Console output for EP validation:**

```
[1/2] leads-email-summary
   📦 Loading scenario...
   ⚠️  EP Key Hints: 2 keys missing prefix (auto-fixed in memory):
      spreadsheet_id → google_sheets__table_read__spreadsheet_id
      sheet_tab_name → google_sheets__table_read__sheet_tab_name
   ⚙️  Compile .............. ✅ (7 steps, 8.5s)
   ...
```

### Step 3: Console Output Specification

The regression runner outputs structured progress to the console during execution, and a summary at the end. The same summary is written to `regression-report.json` in the timestamped output folder.

**Header (printed once at start):**

```
╔══════════════════════════════════════════════════════════════════╗
║                V6 REGRESSION TEST SUITE                        ║
╚══════════════════════════════════════════════════════════════════╝

📋 Found 2 scenarios in tests/v6-regression/scenarios/
   1. leads-email-summary
   2. complaint-email-logger

══════════════════════════════════════════════════════════════════
```

**Per-scenario progress (printed as each phase completes):**

```
[1/2] leads-email-summary
   📦 Loading scenario...
   ✅ EP Key Hints: All keys have prefix
   ⚙️  Compile .............. ✅ (7 steps, 8.5s)
   🔍 Phase A .............. ✅ (13/13 checks)
   🚀 Phase D .............. ✅ (7/7 steps, 15.0s)
   ✅ PASS

[2/2] complaint-email-logger
   📦 Loading scenario...
   ⚠️  EP Key Hints: 2 keys missing prefix (auto-fixed in memory):
      spreadsheet_id → google_sheets__table_read__spreadsheet_id
      sheet_tab_name → google_sheets__table_read__sheet_tab_name
   ⚙️  Compile .............. ✅ (10 steps, 9.2s)
   🔍 Phase A .............. ✅ (13/13 checks)
   🚀 Phase D .............. ✅ (10/10 steps, 18.0s)
   ✅ PASS
```

**On failure, the failing phase shows the error and subsequent phases are skipped:**

```
[2/2] complaint-email-logger
   📦 Loading scenario...
   ✅ EP Key Hints: All keys have prefix
   ⚙️  Compile .............. ✅ (10 steps, 9.2s)
   🔍 Phase A .............. ❌ FAILED (11/13 checks, 2 errors)
      - Data flow break: step5 references "foo" not yet produced
      - Field mismatch: step7 item.message_id not in schema
   🚀 Phase D .............. ⏭️  SKIPPED (Phase A failed)
   ❌ FAIL — Phase A had 2 errors
```

**Summary section (printed at the end — identical content goes to both console and report file):**

```
══════════════════════════════════════════════════════════════════
                    REGRESSION SUMMARY
══════════════════════════════════════════════════════════════════

  Scenario                      Compile   Phase A   Phase D   Result
  ─────────────────────────────────────────────────────────────────
  leads-email-summary            ✅         ✅        ✅       PASS
  complaint-email-logger         ✅         ✅        ✅       PASS

──────────────────────────────────────────────────────────────────
  Total: 2 scenarios | Passed: 2 | Failed: 0
──────────────────────────────────────────────────────────────────

✅ REGRESSION PASSED — 2/2 scenarios passed

Report saved: tests/v6-regression/output/2026-03-26-14-30-00/regression-report.json
══════════════════════════════════════════════════════════════════
```

**On overall failure:**

```
──────────────────────────────────────────────────────────────────
  Total: 3 scenarios | Passed: 2 | Failed: 1
──────────────────────────────────────────────────────────────────

❌ REGRESSION FAILED — 2/3 scenarios passed

  Failed scenarios:
    - complaint-email-logger: Phase A had 2 errors

Report saved: tests/v6-regression/output/2026-03-26-14-30-00/regression-report.json
══════════════════════════════════════════════════════════════════
```

**Process exit code:** `0` if all scenarios pass, `1` if any scenario fails. This enables CI integration — the CI job fails if the regression fails.

### Regression Log File

In addition to console output, the runner writes a `regression-log.txt` to the timestamped output folder. This file captures:

1. **Everything printed to console** — header, per-scenario progress, summary
2. **Timestamps** — each line prefixed with `[HH:MM:SS]` for timing analysis
3. **Sub-script stdout/stderr** — full output from compile, Phase A, and Phase D scripts (captured from `execSync`)
4. **Error details** — stack traces, compilation warnings, Phase A validation messages

The log serves as a debug artifact — when a scenario fails in CI, the log shows exactly where and why.

**Implementation:** The runner uses a `Logger` class that writes to both `process.stdout` and a file write stream simultaneously:

```typescript
class RegressionLogger {
  private stream: fs.WriteStream

  constructor(logPath: string) {
    this.stream = fs.createWriteStream(logPath, { flags: 'w' })
  }

  log(message: string) {
    const timestamped = `[${new Date().toISOString().slice(11, 19)}] ${message}`
    console.log(message)            // Console (no timestamp — cleaner)
    this.stream.write(timestamped + '\n')  // File (with timestamp)
  }

  logSubProcess(label: string, output: string) {
    // Only write to file — sub-process output is too verbose for console
    this.stream.write(`--- ${label} stdout ---\n${output}\n--- end ---\n`)
  }
}
```

**Output structure updated:**

```
tests/v6-regression/output/2026-03-26-14-30-00/
├── regression-report.json    # Structured results (JSON)
├── regression-log.txt        # Full progress log with timestamps
├── leads-email-summary/
│   └── (phase output files)
└── complaint-email-logger/
    └── (phase output files)
```

### Step 4: Regression Report File

After all scenarios complete, generate `regression-report.json` in the timestamped output folder. The report contains the same information as the console summary plus detailed per-phase data:

```json
{
  "timestamp": "2026-03-26T14:30:00.000Z",
  "duration_ms": 45000,
  "scenarios": {
    "total": 2,
    "passed": 2,
    "failed": 0
  },
  "overall_result": "PASS",
  "results": [
    {
      "scenario": "leads-email-summary",
      "status": "PASS",
      "ep_key_hints": {
        "valid": true,
        "warnings": [],
        "auto_fixed_keys": []
      },
      "compile": { "success": true, "steps": 7, "duration_ms": 8500 },
      "phase_a": { "success": true, "checks_passed": 13, "checks_failed": 0, "errors": [] },
      "phase_d": { "success": true, "steps_completed": 7, "steps_failed": 0, "duration_ms": 15000 }
    },
    {
      "scenario": "complaint-email-logger",
      "status": "PASS",
      "ep_key_hints": {
        "valid": false,
        "warnings": ["spreadsheet_id missing EP hint prefix", "sheet_tab_name missing EP hint prefix"],
        "auto_fixed_keys": [
          { "original": "spreadsheet_id", "fixed": "google_sheets__table_read__spreadsheet_id" },
          { "original": "sheet_tab_name", "fixed": "google_sheets__table_read__sheet_tab_name" }
        ]
      },
      "compile": { "success": true, "steps": 10, "duration_ms": 9200 },
      "phase_a": { "success": true, "checks_passed": 13, "checks_failed": 0, "errors": [] },
      "phase_d": { "success": true, "steps_completed": 10, "steps_failed": 0, "duration_ms": 18000 }
    }
  ]
}
```

### Step 5: Extract Initial Scenarios

| Scenario | Source | Action |
|---|---|---|
| **Leads Email Summary** | Git commit `5d5dd97` | Extract enhanced-prompt.json, run pipeline once to capture intent-contract.json |
| **Customer Complaint Logger** | Current `output/vocabulary-pipeline/` | Copy enhanced-prompt.json + phase1-intent-contract.json |
| **Gmail Invoice/Expense** | Git commit `9ffd375` | Deferred — needs EP key hints update first |

### Step 6: Pipeline Script Output Dir Support

`test-complete-pipeline-with-vocabulary.ts` also needs `--output-dir` support so the regression runner can direct output to the scenario-specific folder instead of the default `output/vocabulary-pipeline/`.

**Files to modify:**
- `scripts/test-complete-pipeline-with-vocabulary.ts` — accept `--output-dir` for all phase output files

---

## Adding New Scenarios

When a new workflow is tested end-to-end (through Phase E live execution), add it as a regression scenario:

1. Create folder: `tests/v6-regression/scenarios/<scenario-name>/`
2. Copy `enhanced-prompt.json` (the input to the pipeline)
3. Copy `phase1-intent-contract.json` (the fixed LLM output)
4. Create `scenario.json` with metadata and expected results
5. Run regression suite to verify: `npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts`
6. Commit the scenario folder

---

## Implementation Reference

This section provides all context needed for a new session to implement the regression suite.

### Key Files and Their Roles

| File | Role | Modification Needed |
|---|---|---|
| `scripts/test-complete-pipeline-with-vocabulary.ts` | Runs V6 pipeline Phase 0→4. Accepts enhanced prompt JSON + optional `--intent-contract` to skip LLM. Outputs phase files to `output/vocabulary-pipeline/` | Add `--output-dir` CLI arg |
| `scripts/test-dsl-execution-simulator/index.ts` | Phase A: 13 static validation checks on compiled DSL. Reads from `output/vocabulary-pipeline/` | Add `--input-dir` CLI arg |
| `scripts/test-workflowpilot-execution.ts` | Phase D: Real WorkflowPilot with mocked plugins. Reads from `output/vocabulary-pipeline/` | Add `--input-dir` and `--output-dir` CLI args |
| `scripts/env-preload.ts` | Loads `.env.local` via dotenvx. Required as `--import` for scripts that touch Supabase | No changes |
| `tests/v6-regression/run-regression.ts` | **NEW** — master regression runner | Create from scratch |

### How the Pipeline Script Works Today

```bash
# Full LLM run (Phase 1 calls OpenAI):
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json

# Skip LLM — use fixed IntentContract (deterministic from Phase 2 onward):
npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
  scripts/test-intent-contract-generation-enhanced-prompt.json \
  --intent-contract output/vocabulary-pipeline/phase1-intent-contract.json
```

The pipeline produces these files in the output dir:
- `phase0-workflow-config.json` — user config before merge
- `phase1-intent-contract.json` — LLM output (or loaded from file)
- `phase2-bound-intent-contract.json` — capability binding result
- `phase2-data-schema.json` — data schema
- `phase3-execution-graph-ir-v4.json` — IR
- `phase4-pilot-dsl-steps.json` — compiled DSL (**required by Phase A and D**)
- `phase4-workflow-config.json` — merged config (**required by Phase A and D**)
- `phase4-compiler-logs.txt` — compiler debug logs

### How Phase A and D Scripts Work Today

**Phase A** reads these files (hardcoded paths):
- `phase4-pilot-dsl-steps.json` (DSL steps)
- `phase4-workflow-config.json` (merged config)
- `phase2-data-schema.json` (optional, for schema checks)

Outputs: `execution-simulation-report.json`

**Phase D** reads these files (hardcoded paths):
- `phase4-pilot-dsl-steps.json` (DSL steps)
- `phase4-workflow-config.json` (merged config)

Outputs: `workflowpilot-execution-report.json` + `workflowpilot-execution-log.txt`

### EP Key Hints Convention

The EP (Enhanced Prompt) key hints follow the pattern: `plugin__capability__param_name`

Examples:
- `google_sheets__table_read__spreadsheet_id`
- `google_sheets__table_create__columns`
- `google_mail__email_search__query`
- `google_mail__email_send__recipients`

Generic keys (not plugin-specific) don't need prefixes:
- `user_email`, `complaint_keywords`, `no_results_behavior`, `qualification_rule`

The validation logic should check if a key matches a known plugin parameter name. The plugin vocabulary extraction (`PluginVocabularyExtractor`) provides the parameter lists per plugin. For regression purposes, a simpler heuristic suffices: check if the key name matches any known plugin parameter (e.g., `spreadsheet_id` is a Google Sheets param, `query` is a Gmail param).

### Git History for Scenario Extraction

| Scenario | Commit | Command to extract enhanced prompt |
|---|---|---|
| Leads Email Summary | `5d5dd97` | `git show 5d5dd97:scripts/test-intent-contract-generation-enhanced-prompt.json` |
| Customer Complaint Logger | `f612c35` (or current HEAD) | Copy from `scripts/test-intent-contract-generation-enhanced-prompt.json` |

For the IntentContract: run the pipeline once per scenario with full LLM call, then save the `phase1-intent-contract.json` output. This is a **one-time cost** per scenario.

### Regression Runner Implementation Outline

```typescript
// tests/v6-regression/run-regression.ts

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

interface ScenarioMeta {
  name: string
  description: string
  plugins: string[]
  expected: {
    min_steps: number
    phase_a_checks: number
    phase_d_success: boolean
  }
}

interface ScenarioResult {
  scenario: string
  status: 'PASS' | 'FAIL'
  ep_key_hints: { valid: boolean; warnings: string[]; auto_fixed_keys: any[] }
  compile: { success: boolean; steps: number; duration_ms: number; error?: string }
  phase_a: { success: boolean; checks_passed: number; checks_failed: number; errors: string[] }
  phase_d: { success: boolean; steps_completed: number; steps_failed: number; duration_ms: number; error?: string }
}

async function main() {
  const scenariosDir = path.join(process.cwd(), 'tests', 'v6-regression', 'scenarios')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputDir = path.join(process.cwd(), 'tests', 'v6-regression', 'output', timestamp)

  // 1. Discover scenarios (each subfolder with scenario.json)
  const scenarios = fs.readdirSync(scenariosDir)
    .filter(d => fs.existsSync(path.join(scenariosDir, d, 'scenario.json')))

  // 2. Print header
  printHeader(scenarios)

  const results: ScenarioResult[] = []

  // 3. Run each scenario sequentially
  for (let i = 0; i < scenarios.length; i++) {
    const scenarioName = scenarios[i]
    const scenarioDir = path.join(scenariosDir, scenarioName)
    const scenarioOutputDir = path.join(outputDir, scenarioName)
    fs.mkdirSync(scenarioOutputDir, { recursive: true })

    console.log(`\n[${i + 1}/${scenarios.length}] ${scenarioName}`)
    console.log(`   📦 Loading scenario...`)

    const meta: ScenarioMeta = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'scenario.json'), 'utf-8'))
    const enhancedPrompt = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'enhanced-prompt.json'), 'utf-8'))

    // Step 3: EP Key Hints validation + auto-fix
    const epResult = validateEPKeyHints(enhancedPrompt, meta.plugins)
    // ... print warnings, apply fixes in memory ...
    // Write fixed enhanced prompt to temp file in scenarioOutputDir for the pipeline to read

    // Step 4: Compile
    // execSync(`npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts ...`)

    // Step 6: Phase A
    // execSync(`npx tsx scripts/test-dsl-execution-simulator/index.ts --input-dir ${scenarioOutputDir}`)

    // Step 8: Phase D (skip if Phase A failed)
    // execSync(`npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts --input-dir ${scenarioOutputDir}`)

    // Step 10: Record result
    // results.push(scenarioResult)
  }

  // 4. Print summary + write report
  printSummary(results)
  writeReport(outputDir, results)

  // 5. Exit with code
  const allPassed = results.every(r => r.status === 'PASS')
  process.exit(allPassed ? 0 : 1)
}
```

### Key Implementation Decisions

1. **The runner calls sub-scripts via `execSync`**, not by importing their functions. This keeps each phase isolated and matches how users run the scripts manually. The runner captures stdout/stderr and parses the output report JSON files.

2. **EP key hint auto-fix** writes a temporary `enhanced-prompt-fixed.json` to the scenario output dir. The pipeline reads from this temp file instead of the original. The original scenario files are never modified.

3. **Phase skipping**: If Phase A fails, Phase D is skipped and marked as `SKIPPED` in the report. The scenario status is `FAIL`.

4. **Timeout**: Each `execSync` call has a timeout (120s for compile, 60s for Phase A, 120s for Phase D). Timeout = FAIL.

5. **Historical output**: Each run creates a new timestamped folder. Old runs are preserved. A `latest` symlink (or copy on Windows) points to the most recent run.

---

## Future Enhancements

| Enhancement | Description | When |
|---|---|---|
| **CI integration** | Add to GitHub Actions as a pre-merge check | When regression suite is stable with 3+ scenarios |
| **Parallel execution** | Run scenarios concurrently (already designed with isolated output dirs) | When suite grows beyond 5 scenarios and sequential is too slow |
| **Phase E regression** | Optional live execution with real APIs for critical scenarios | Requires test data seeding and cleanup |
| **Snapshot comparison** | Compare generated DSL against a golden snapshot, flag structural changes | When compiler changes stabilize |
| **Gmail Invoice/Expense scenario** | Update enhanced prompt with EP key hints, add to regression set | Next session |
| **npm test integration** | `npm run test:v6-regression` command in package.json | After CI integration |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-26 | Created | Initial regression plan with 2 scenarios, 3-phase validation |
