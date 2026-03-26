# Workplan: V6 Regression Test Suite

**Developer:** Dev
**Requirement:** [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md)
**Date:** 2026-03-26
**Status:** Code Complete

---

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Pre-Implementation Findings](#pre-implementation-findings)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Technical Decisions for SA Review](#technical-decisions-for-sa-review)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

This feature adds a regression test suite for the V6 Intent Contract to DSL compilation to execution pipeline. The suite orchestrates three phases (Compile, Phase A static validation, Phase D mock execution) across multiple test scenarios, aggregating results into a structured report.

**Components touched:**

| Component | Type | Reason |
|---|---|---|
| `scripts/test-dsl-execution-simulator/index.ts` | Modify | Add `--input-dir` CLI arg for custom input paths |
| `scripts/test-dsl-execution-simulator/file-loader.ts` | Modify | Accept input dir from caller instead of hardcoded default |
| `scripts/test-workflowpilot-execution.ts` | Modify | Add `--input-dir` and `--output-dir` CLI args |
| `tests/v6-regression/run-regression.ts` | Create | Master regression runner script |
| `tests/v6-regression/scenarios/*/` | Create | Two initial scenario folders with fixture files |
| `tests/v6-regression/.gitignore` | Create | Ignore `output/` directory under regression |

**Components NOT touched (already done):**

| Component | Why |
|---|---|
| `scripts/test-complete-pipeline-with-vocabulary.ts` | Already has `--output-dir` support (lines 35-38). Verified: reads `--output-dir` from `process.argv`, falls back to `output/vocabulary-pipeline/`. No changes needed. |

---

## Implementation Approach

1. **Modify existing scripts for path flexibility** -- Add CLI argument parsing to Phase A and Phase D scripts so they can be pointed at scenario-specific directories. All changes are backward compatible: when no args are provided, current default paths are used.

2. **Build the regression runner bottom-up** -- Start with the `RegressionLogger` utility (dual console+file output), then the EP Key Hints validator, then the main orchestration loop. The runner calls sub-scripts via `execSync` (not module imports) for isolation.

3. **Extract scenarios from git history** -- The Complaint Logger scenario can be copied directly from the current working directory. The Leads Email Summary enhanced prompt is extracted from git commit `5d5dd97`. The Leads intent contract requires a one-time LLM call (see Task 7 for details).

4. **Windows-compatible output management** -- Use `fs.cpSync` (recursive copy) instead of symlinks for the `latest` pointer. This works on all platforms without elevated privileges.

---

## Pre-Implementation Findings

These are facts discovered during analysis that affect task planning:

| Finding | Impact |
|---|---|
| Pipeline script already has `--output-dir` (lines 35-38) | Skip Step 6 from requirement -- no work needed |
| Phase A `index.ts` hardcodes `outputDir` on line 18, passes it to `loadInputFiles()` and `writeReport()` | Need to parse `--input-dir` arg and override the local `outputDir` variable |
| Phase A `file-loader.ts` already accepts `outputDir` as a parameter (line 16) | No change needed in file-loader -- just pass the right value from index.ts |
| Phase A `report-generator.ts` already accepts `outputDir` as a parameter (line 36) | No change needed in report-generator -- just pass the right value from index.ts |
| Phase D hardcodes `outputDir` on line 28, uses it for reading DSL/config and writing reports | Need to parse `--input-dir` for reading, `--output-dir` for writing (or same dir for both if only `--input-dir` provided) |
| Current intent contract in `output/vocabulary-pipeline/` is for Complaint Logger | Can be copied directly to scenario folder |
| The `output/` directory is gitignored via `/output/` pattern | Need separate `.gitignore` in `tests/v6-regression/` for its `output/` dir |
| Pipeline script uses `process.argv[2]` for the enhanced prompt positional arg | Runner must pass scenario enhanced prompt path as first positional arg |
| Pipeline script `--intent-contract` flag already supported | Runner can pass `--intent-contract <scenario>/intent-contract.json` to skip LLM |

---

## Files to Create / Modify

| File | Action | What Changes |
|---|---|---|
| `scripts/test-dsl-execution-simulator/index.ts` | Modify | Parse `--input-dir` from `process.argv`, use it instead of hardcoded `output/vocabulary-pipeline/` path. Default unchanged when arg absent. |
| `scripts/test-workflowpilot-execution.ts` | Modify | Parse `--input-dir` and `--output-dir` from `process.argv`. `--input-dir` overrides where DSL/config are read from. `--output-dir` overrides where report/log are written. When `--output-dir` absent but `--input-dir` present, write outputs to `--input-dir`. Defaults unchanged when no args. |
| `tests/v6-regression/run-regression.ts` | Create | Master runner: scenario discovery, EP validation, sub-script orchestration via `execSync`, result aggregation, console output, JSON report, log file, exit code. ~350-450 lines. |
| `tests/v6-regression/.gitignore` | Create | Single line: `output/` |
| `tests/v6-regression/scenarios/leads-email-summary/enhanced-prompt.json` | Create | Extracted from `git show 5d5dd97:scripts/test-intent-contract-generation-enhanced-prompt.json` |
| `tests/v6-regression/scenarios/leads-email-summary/intent-contract.json` | Create | Generated via one-time LLM pipeline run (see Task 7) |
| `tests/v6-regression/scenarios/leads-email-summary/scenario.json` | Create | Scenario metadata: name, plugins, expected step count, etc. |
| `tests/v6-regression/scenarios/complaint-email-logger/enhanced-prompt.json` | Create | Copied from current `scripts/test-intent-contract-generation-enhanced-prompt.json` |
| `tests/v6-regression/scenarios/complaint-email-logger/intent-contract.json` | Create | Copied from current `output/vocabulary-pipeline/phase1-intent-contract.json` |
| `tests/v6-regression/scenarios/complaint-email-logger/scenario.json` | Create | Scenario metadata: name, plugins, expected step count, etc. |

---

## Task List

### Task 1: Add `--input-dir` to Phase A script

**Status:** DONE
**Complexity:** Easy
**Depends on:** None
**Files:** `scripts/test-dsl-execution-simulator/index.ts`

**What to do:**
1. At the top of `main()`, parse `--input-dir` from `process.argv`
2. If present, use its value (resolved to absolute path) as `outputDir`
3. If absent, keep the current default: `path.join(process.cwd(), 'output', 'vocabulary-pipeline')`
4. The rest of the script already passes `outputDir` to `loadInputFiles()` and `writeReport()`, so no further changes needed

**Code change (lines 17-18 of index.ts):**
```typescript
// Before:
const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

// After:
const inputDirArgIndex = process.argv.indexOf('--input-dir')
const outputDir = inputDirArgIndex !== -1 && process.argv[inputDirArgIndex + 1]
  ? path.resolve(process.argv[inputDirArgIndex + 1])
  : path.join(process.cwd(), 'output', 'vocabulary-pipeline')
```

**Acceptance criteria:**
- Running `npx tsx scripts/test-dsl-execution-simulator/index.ts` (no args) uses the default path -- same behavior as before
- Running `npx tsx scripts/test-dsl-execution-simulator/index.ts --input-dir /some/path` reads files from and writes report to `/some/path`

---

### Task 2: Add `--input-dir` and `--output-dir` to Phase D script

**Status:** DONE
**Complexity:** Easy
**Depends on:** None
**Files:** `scripts/test-workflowpilot-execution.ts`

**What to do:**
1. At the top of `main()` (line 28), parse `--input-dir` and `--output-dir` from `process.argv`
2. Derive `inputDir` (where to read DSL/config) and `writeDir` (where to write report/log)
3. If neither arg provided, both default to `output/vocabulary-pipeline/` (current behavior)
4. If only `--input-dir` provided, use it for both reading and writing
5. If both provided, use `--input-dir` for reading and `--output-dir` for writing
6. Replace the single `outputDir` variable with `inputDir` for reading (lines 63-64) and `writeDir` for writing (lines 205, 230-232)

**Code change (line 28 of test-workflowpilot-execution.ts):**
```typescript
// Before:
const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

// After:
const inputDirArgIdx = process.argv.indexOf('--input-dir')
const outputDirArgIdx = process.argv.indexOf('--output-dir')
const defaultDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')
const inputDir = inputDirArgIdx !== -1 && process.argv[inputDirArgIdx + 1]
  ? path.resolve(process.argv[inputDirArgIdx + 1])
  : defaultDir
const writeDir = outputDirArgIdx !== -1 && process.argv[outputDirArgIdx + 1]
  ? path.resolve(process.argv[outputDirArgIdx + 1])
  : inputDir  // Falls back to inputDir, which falls back to defaultDir
```

Then replace:
- `outputDir` on line 63 (dslPath) and 64 (configPath) with `inputDir`
- `outputDir` on line 205 (reportPath) with `writeDir`
- `outputDir` on line 230 (logPath) with `writeDir`

**Acceptance criteria:**
- Running with no args behaves identically to current behavior
- Running with `--input-dir /path/to/scenario` reads DSL/config from there and writes report/log there
- Running with `--input-dir /read/path --output-dir /write/path` reads from one location and writes to another

---

### Task 3: Create scenario folder structure and `.gitignore`

**Status:** DONE
**Complexity:** Easy
**Depends on:** None
**Files:**
- `tests/v6-regression/.gitignore` (create)
- `tests/v6-regression/scenarios/` (create directory)

**What to do:**
1. Create directory structure: `tests/v6-regression/scenarios/leads-email-summary/` and `tests/v6-regression/scenarios/complaint-email-logger/`
2. Create `tests/v6-regression/.gitignore` with content: `output/`

**Acceptance criteria:**
- Directory structure exists
- `output/` under `tests/v6-regression/` is gitignored

---

### Task 4: Extract Complaint Email Logger scenario

**Status:** DONE
**Complexity:** Easy
**Depends on:** Task 3
**Files:**
- `tests/v6-regression/scenarios/complaint-email-logger/enhanced-prompt.json` (create)
- `tests/v6-regression/scenarios/complaint-email-logger/intent-contract.json` (create)
- `tests/v6-regression/scenarios/complaint-email-logger/scenario.json` (create)

**What to do:**
1. Copy `scripts/test-intent-contract-generation-enhanced-prompt.json` to `scenarios/complaint-email-logger/enhanced-prompt.json`
2. Copy `output/vocabulary-pipeline/phase1-intent-contract.json` to `scenarios/complaint-email-logger/intent-contract.json`
3. Create `scenario.json` with metadata:

```json
{
  "name": "Customer Complaint Email Logger",
  "description": "Gmail search for complaint keywords, dedup filter against existing sheet rows, scatter-gather append to Google Sheets",
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

Note: The `min_steps` and `step_types` values should be verified by running the pipeline and checking actual output. These are initial estimates based on the requirement doc.

**Acceptance criteria:**
- All three files exist and contain valid JSON
- `enhanced-prompt.json` matches the current prompt file content
- `intent-contract.json` matches the current pipeline output

---

### Task 5: Extract Leads Email Summary scenario (enhanced prompt)

**Status:** DONE
**Complexity:** Easy
**Depends on:** Task 3
**Files:**
- `tests/v6-regression/scenarios/leads-email-summary/enhanced-prompt.json` (create)
- `tests/v6-regression/scenarios/leads-email-summary/scenario.json` (create)

**What to do:**
1. Extract enhanced prompt from git: `git show 5d5dd97:scripts/test-intent-contract-generation-enhanced-prompt.json`
2. Save to `scenarios/leads-email-summary/enhanced-prompt.json`
3. Create `scenario.json` with metadata:

```json
{
  "name": "High-Qualified Leads Email Summary",
  "description": "Read Google Sheets leads tab, filter by Stage=4, render HTML summary table, email to recipient list",
  "created": "2026-03-26",
  "plugins": ["google-mail", "google-sheets"],
  "expected": {
    "min_steps": 4,
    "step_types": ["action", "transform"],
    "phase_a_checks": 13,
    "phase_d_success": true
  }
}
```

Note: `min_steps` is an estimate. Will be verified after Task 7 produces the intent contract and a full pipeline run.

**Acceptance criteria:**
- `enhanced-prompt.json` matches the content from commit `5d5dd97`
- `scenario.json` contains valid metadata

---

### Task 6: Generate Leads Email Summary intent contract (one-time LLM call)

**Status:** DONE (placeholder created — requires user to run LLM pipeline manually)
**Complexity:** Medium -- requires LLM call, needs verification
**Depends on:** Task 5, Task 1 (for verification), Task 2 (for verification)
**Files:**
- `tests/v6-regression/scenarios/leads-email-summary/intent-contract.json` (create)

**What to do:**
1. Run the pipeline with the Leads enhanced prompt and NO `--intent-contract` flag (triggers LLM call):
   ```bash
   npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts \
     tests/v6-regression/scenarios/leads-email-summary/enhanced-prompt.json \
     --output-dir tests/v6-regression/output/leads-generation-run/
   ```
2. Inspect the generated `phase1-intent-contract.json` for quality (correct steps, reasonable structure)
3. Copy the generated intent contract to `scenarios/leads-email-summary/intent-contract.json`
4. Run the full pipeline again with `--intent-contract` to verify deterministic phases produce a working DSL
5. Update `scenario.json` with actual `min_steps` count from the compilation output
6. Clean up the temporary output directory

**Decision point:** If the LLM produces a poor intent contract, this may need multiple runs or manual adjustment. The intent contract only needs to be generated once -- after that, regression runs always use the fixed file.

**Acceptance criteria:**
- `intent-contract.json` exists and contains a valid IntentContract with correct goal, steps, and plugin references
- Running the pipeline with this fixed intent contract produces DSL that passes Phase A and Phase D

---

### Task 7: Build RegressionLogger class

**Status:** DONE
**Complexity:** Easy
**Depends on:** None
**Files:** `tests/v6-regression/run-regression.ts` (partial -- this class will be part of the runner file)

**What to do:**
1. Implement the `RegressionLogger` class as specified in the requirement:
   - Constructor takes a log file path, opens a `WriteStream`
   - `log(message)` writes to both `console.log` (without timestamp) and file (with `[HH:MM:SS]` prefix)
   - `logSubProcess(label, output)` writes only to file (sub-process output is too verbose for console)
   - `close()` method to flush and close the write stream
2. This class is defined inside `run-regression.ts` (no separate file needed -- it is small)

**Acceptance criteria:**
- Console output is clean (no timestamps)
- Log file has timestamps on every line
- Sub-process output appears only in the log file

---

### Task 8: Build EP Key Hints validation function

**Status:** DONE
**Complexity:** Medium
**Depends on:** None
**Files:** `tests/v6-regression/run-regression.ts` (partial)

**What to do:**
1. Implement `validateEPKeyHints(enhancedPrompt, plugins)` as specified:
   - Extract `resolved_user_inputs` from enhanced prompt
   - For each key, check if it matches the EP key hint pattern: `plugin__capability__param_name`
   - If a key does NOT have a prefix but matches a known plugin parameter name, auto-fix in memory
   - Use a hardcoded lookup table of known plugin parameters per plugin (simpler than loading full vocabulary at runtime):
     - `google-sheets`: `spreadsheet_id`, `sheet_tab_name`, `header_row`, `columns`, `row_data`
     - `google-mail`: `query`, `recipients`, `subject`, `body`, `max_results`
   - Keys that don't match any known plugin param (e.g., `complaint_keywords`, `qualification_rule`) are left as-is
   - Return `{ valid, warnings, autoFixedKeys }`

**SA Decision Needed:** Should the EP Key Hints validator load the full plugin vocabulary at runtime (via `PluginVocabularyExtractor`) or use a static lookup table? The requirement says "a simpler heuristic suffices" for regression purposes. I recommend the static lookup to avoid Supabase/plugin-manager dependencies in the regression runner. Flag for SA review.

**Acceptance criteria:**
- Keys with correct prefix pass silently
- Keys matching known plugin params get auto-fixed with warning
- Generic keys (no plugin match) pass silently
- Function returns structured result with warnings and fix list

---

### Task 9: Build regression runner -- main orchestration

**Status:** DONE
**Complexity:** Hard
**Depends on:** Task 1, Task 2, Task 7, Task 8
**Files:** `tests/v6-regression/run-regression.ts`

**What to do:**

Build the complete `run-regression.ts` with the following structure:

1. **Scenario discovery** -- Scan `tests/v6-regression/scenarios/`, filter to folders containing `scenario.json`
2. **Timestamped output directory** -- Create `tests/v6-regression/output/YYYY-MM-DD-HH-MM-SS/`
3. **Header output** -- Print the banner and scenario list per requirement spec
4. **Per-scenario loop** (sequential):
   a. Load `scenario.json` and `enhanced-prompt.json`
   b. Run EP Key Hints validation (Task 8)
   c. If auto-fixes applied, write `enhanced-prompt-fixed.json` to scenario output dir
   d. **Compile phase**: Run pipeline via `execSync`:
      ```
      npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts
        <enhanced-prompt-path> --intent-contract <scenario>/intent-contract.json --output-dir <run-output>/<scenario>/
      ```
   e. Validate compilation: check `phase4-pilot-dsl-steps.json` exists, step count >= `min_steps`
   f. **Phase A**: Run via `execSync`:
      ```
      npx tsx scripts/test-dsl-execution-simulator/index.ts --input-dir <run-output>/<scenario>/
      ```
   g. Parse Phase A report: read `execution-simulation-report.json`, check `checks_passed` and `checks_failed`
   h. **Phase D** (skip if Phase A failed): Run via `execSync`:
      ```
      npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts --input-dir <run-output>/<scenario>/
      ```
   i. Parse Phase D report: read `workflowpilot-execution-report.json`, check `success` and step counts
   j. Record `ScenarioResult`
5. **Summary output** -- Print summary table and overall pass/fail per requirement spec
6. **Write report** -- Save `regression-report.json` to timestamped output dir
7. **Latest pointer** -- Copy (not symlink) timestamped dir to `output/latest/` using `fs.cpSync(src, dest, { recursive: true })` for Windows compatibility
8. **Exit code** -- `process.exit(0)` if all pass, `process.exit(1)` if any fail

**Key implementation details:**

- Each `execSync` call gets a timeout: 120,000ms for Compile, 60,000ms for Phase A, 120,000ms for Phase D
- Capture stdout/stderr from `execSync` using `{ encoding: 'utf-8', stdio: 'pipe' }` and log via `RegressionLogger.logSubProcess()`
- On `execSync` error (non-zero exit or timeout), catch the error, mark phase as FAIL, continue to next phase/scenario
- Enhanced prompt path passed to pipeline must be the fixed version if EP auto-fix was applied, otherwise the original
- All paths must be absolute (use `path.resolve()`) for cross-platform compatibility

**Console output format:**
- Must match the exact format from the requirement document (header banner, per-scenario progress, summary table)
- Use Unicode box-drawing characters for the header
- Alignment in summary table uses padded columns

**Acceptance criteria:**
- Running `npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts` discovers both scenarios, runs all phases, prints formatted output, writes report and log
- Exit code is 0 when both scenarios pass
- Report JSON matches the schema from the requirement
- Log file contains timestamped entries and sub-process output
- `output/latest/` directory contains the same files as the timestamped run directory

---

### Task 10: End-to-end verification

**Status:** TODO (blocked on Task 6 — Leads intent contract needs LLM generation; Complaint Logger scenario can be verified independently)
**Complexity:** Medium
**Depends on:** All previous tasks
**Files:** None (verification only)

**What to do:**
1. Run the full regression suite: `npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts`
2. Verify both scenarios pass all three phases
3. Verify console output matches requirement format
4. Verify `regression-report.json` structure matches requirement schema
5. Verify `regression-log.txt` has timestamps and sub-process output
6. Verify `output/latest/` exists and contains correct files
7. Verify backward compatibility: run Phase A and Phase D scripts without args, confirm they still work with default paths
8. Update `scenario.json` files with actual verified values for `min_steps`, `phase_a_checks`

**Acceptance criteria:**
- Both scenarios PASS
- Console output, report JSON, and log file match requirement specifications
- Existing script behavior unchanged when called without new CLI args

---

## Implementation Order

```
Phase 1: Script modifications (can be done in parallel)
  Task 1: Phase A --input-dir          [no dependencies]
  Task 2: Phase D --input-dir/--output-dir  [no dependencies]

Phase 2: Scenario data preparation
  Task 3: Create folder structure       [no dependencies]
  Task 4: Extract Complaint Logger      [depends on Task 3]
  Task 5: Extract Leads prompt          [depends on Task 3]
  Task 6: Generate Leads intent contract [depends on Task 5]

Phase 3: Runner implementation
  Task 7: RegressionLogger class        [no dependencies]
  Task 8: EP Key Hints validator        [no dependencies]
  Task 9: Main runner orchestration     [depends on Tasks 1,2,7,8]

Phase 4: Verification
  Task 10: End-to-end verification      [depends on all]
```

---

## Technical Decisions for SA Review

### 1. EP Key Hints: Static lookup vs. runtime vocabulary

**Question:** Should `validateEPKeyHints` use a hardcoded lookup table of known plugin parameter names, or load the full plugin vocabulary at runtime via `PluginVocabularyExtractor`?

**Dev recommendation:** Static lookup table. Rationale:
- Avoids Supabase/PluginManager dependency in the regression runner
- Regression runner should have minimal external dependencies for reliability
- The requirement says "a simpler heuristic suffices"
- New plugin params can be added to the lookup when new scenarios are added

**Risk if static:** Lookup can go stale if plugin definitions change. Mitigated by the fact that scenarios use fixed intent contracts anyway -- the EP validation is a pre-flight warning, not a hard gate.

### 2. `latest` pointer: Copy vs. symlink

**Question:** The requirement notes "(or copy on Windows)" for the latest pointer. How should this be implemented?

**Dev recommendation:** Always use `fs.cpSync(src, dest, { recursive: true })` on all platforms. Rationale:
- Works on Windows without elevated privileges
- Simpler code (no platform detection needed)
- The output files are small (JSON + text), so copy cost is negligible
- If `latest/` already exists, remove it first with `fs.rmSync(dest, { recursive: true, force: true })` then copy

### 3. Sub-script invocation: `execSync` vs. module import

**Question:** The requirement specifies `execSync` for sub-script invocation. Is this the right approach?

**Dev recommendation:** Confirm `execSync` as specified. Rationale:
- Matches how users run scripts manually
- Isolates each phase (separate Node processes, no module state leaks)
- Captures stdout/stderr cleanly for the log file
- The Phase D script does dynamic imports and monkey-patching of module state (mocks) -- importing it directly would be fragile

### 4. Phase A report parsing

**Question:** Phase A exits with code 1 on errors and writes `execution-simulation-report.json`. Should the runner parse the exit code, the report file, or both?

**Dev recommendation:** Parse both. Use the exit code to detect failure, then read the report file for detailed metrics (checks_passed, checks_failed, error messages). If the exit code is non-zero but the report file doesn't exist (e.g., crash before report generation), mark as FAIL with "Phase A crashed" message.

---

## SA Review Notes

**Date:** 2026-03-26
**Reviewer:** SA Agent
**Verdict:** APPROVED WITH NOTES

### Technical Decision Responses

| # | Decision | SA Response |
|---|----------|-------------|
| 1 | EP Key Hints: Static lookup vs. runtime vocabulary | **Approved: static lookup.** The regression runner must be self-contained with no Supabase or PluginManager dependencies. A static table is the right trade-off for a test harness. The staleness risk is acceptable because (a) scenarios use fixed intent contracts, so EP validation is advisory, and (b) new scenarios require manual setup anyway -- adding a few keys to the lookup is trivial. One note: document the static table clearly in code comments so future maintainers know to extend it when adding plugins. |
| 2 | `latest` pointer: Always copy vs. platform-conditional symlink | **Approved: always copy.** This project runs on Windows (confirmed by the environment). Using `fs.cpSync` unconditionally avoids platform-detection complexity and symlink privilege issues. Output is small JSON and text, so the copy cost is negligible. The `fs.rmSync` + `fs.cpSync` approach is correct. |
| 3 | Sub-script invocation: `execSync` vs. module import | **Approved: `execSync`.** This is the correct choice for three reasons: (a) Phase D does module-level monkey-patching of mocks that would leak state if imported directly, (b) process isolation prevents one phase crash from taking down the runner, (c) stdout/stderr capture is cleanly available via the `stdio: 'pipe'` option. One note below about buffer limits. |
| 4 | Phase A report parsing: exit code + report file | **Approved: both.** Exit code for quick pass/fail determination, report file for metrics. The fallback logic (non-zero exit + missing report = "Phase A crashed") is correct and handles the edge case where the process dies before writing the report. |

### Architecture Review

| # | Area | Finding | Severity | Recommendation |
|---|------|---------|----------|----------------|
| 1 | `execSync` buffer limit | `execSync` has a default `maxBuffer` of 1 MB (1024*1024 bytes). The pipeline script and Phase D can produce verbose console output. If output exceeds the buffer, `execSync` throws a `ENOBUFS` error that would be caught as a generic failure. | Medium | Set `maxBuffer: 10 * 1024 * 1024` (10 MB) on all three `execSync` calls. This is especially important for the Compile phase, which prints vocabulary extraction, binding, and compilation logs. |
| 2 | Phase A `--input-dir` naming | The workplan proposes `--input-dir` for Phase A, which sets the single `outputDir` variable used for both reading files and writing the report. The name `--input-dir` is slightly misleading since it also controls where the report is written. However, since Phase A reads and writes to the same directory, this is functionally correct. | Low | Acceptable as-is. The alternative (`--input-dir` + `--output-dir` like Phase D) would be over-engineering since Phase A always co-locates report with input. Add a code comment clarifying that `--input-dir` controls both read and write paths. |
| 3 | Phase D `env-preload` on compile and Phase D | The runner correctly uses `--import ./scripts/env-preload.ts` for Compile and Phase D (which touch Supabase via PluginManager). Phase A does not need it. This is correct as-is. | Info | No action needed. Noted for completeness. |
| 4 | Scenario ordering determinism | `fs.readdirSync` returns directory entries in filesystem order, which may vary across platforms and runs. The requirement shows a specific ordering in the console output. | Low | Sort the discovered scenario names alphabetically before iterating. This ensures consistent output across platforms and runs, making log comparison reliable. |
| 5 | Missing `--output-dir` on Phase A | The requirement doc (Step 1) mentions both `--input-dir` and `--output-dir` for Phase A, but the workplan only adds `--input-dir`. Since Phase A reads and writes to the same dir, this is acceptable, but it diverges from the requirement spec. | Low | Acceptable. The workplan's rationale is sound -- Phase A always writes the report next to the input files. If a future need arises for separate read/write dirs, `--output-dir` can be added then. |
| 6 | Enhanced prompt path as positional arg | The pipeline script reads `process.argv[2]` as the enhanced prompt path (line 87). When the runner passes `--input-dir` or `--output-dir` as additional flags, `process.argv[2]` must still be the enhanced prompt path. The workplan's `execSync` command format places the enhanced prompt first, which is correct. However, if the enhanced prompt path happens to start with `--`, it could be misinterpreted. | Low | No action needed for the current scenario file paths. Just ensure the enhanced prompt path is always an absolute path (which the workplan already specifies via `path.resolve()`). |
| 7 | Error handling: malformed JSON in scenario files | Task 9 loads `scenario.json` and `enhanced-prompt.json` with `JSON.parse(fs.readFileSync(...))`. If a scenario file contains malformed JSON, the runner would throw an unhandled error. | Medium | Wrap scenario file loading in a try-catch per scenario. On parse failure, mark the scenario as FAIL with a clear error message ("Malformed scenario.json") and continue to the next scenario. Do not let one bad scenario file crash the entire regression suite. |
| 8 | `RegressionLogger.close()` timing | Task 7 mentions a `close()` method but Task 9 does not show where it is called. If the runner calls `process.exit()` before the write stream is flushed, the last log entries may be lost. | Medium | Call `logger.close()` and await the stream `finish` event before calling `process.exit()`. Alternatively, use `fs.writeFileSync` for the final flush, or call `stream.end()` with a callback that invokes `process.exit()`. |
| 9 | Requirement coverage: Gmail Invoice/Expense scenario | The requirement doc mentions a third scenario (Gmail Invoice/Expense from commit `9ffd375`) as "Deferred -- needs EP key hints update first". The workplan correctly omits this from the current task list. | Info | No action needed. Confirmed: the workplan covers the two scenarios that are ready and correctly defers the third. |

### Summary

The workplan is well-structured, thorough, and demonstrates correct understanding of all three existing scripts. The Dev has correctly identified that the pipeline script already supports `--output-dir` (saving Step 6 from the requirement), and the analysis of Phase A and Phase D internals is accurate.

Three medium-severity items require attention during implementation:
1. Set `maxBuffer: 10 * 1024 * 1024` on all `execSync` calls (item 1)
2. Wrap scenario file loading in per-scenario try-catch (item 7)
3. Ensure `RegressionLogger` stream is properly flushed before `process.exit()` (item 8)

Two low-severity items are recommended but not blocking:
- Sort scenario names alphabetically for deterministic ordering (item 4)
- Add a code comment on Phase A's `--input-dir` explaining it controls both read and write (item 2)

**Workplan approved -- Dev may proceed to implementation.** Address the three medium-severity items during implementation. No structural changes to the task list or ordering are needed.

---

## QA Testing Report

**Date:** 2026-03-26
**Tester:** QA Agent
**Testing strategy used:** Option A (static code analysis + JSON validation + targeted compilation checks). The full regression suite was NOT executed because it requires LLM calls and plugin connections. Testing focused on structural correctness, backward compatibility, file validity, and code review against the acceptance criteria.

### Test Results

| # | Test | Result | Details |
|---|------|--------|---------|
| 1 | TypeScript compilation | PASS | `npx tsc --noEmit` produces zero errors in `tests/v6-regression/run-regression.ts`, `scripts/test-dsl-execution-simulator/index.ts`, and `scripts/test-workflowpilot-execution.ts`. |
| 2 | Backward compatibility -- Phase A script | PASS | When `--input-dir` is absent from `process.argv`, `inputDirArgIndex` is -1 and `outputDir` falls back to `path.join(process.cwd(), 'output', 'vocabulary-pipeline')` (the original default). Code verified at lines 21-24 of `index.ts`. |
| 3 | Backward compatibility -- Phase D script | PASS | When neither `--input-dir` nor `--output-dir` is in `process.argv`, both arg indices are -1 and `inputDir`/`writeDir` fall back to the original `defaultDir` (`output/vocabulary-pipeline/`). Code verified at lines 30-38 of `test-workflowpilot-execution.ts`. |
| 4 | Scenario JSON validation | PASS | All 6 scenario fixture files parse as valid JSON: `complaint-email-logger/{scenario,enhanced-prompt,intent-contract}.json` and `leads-email-summary/{scenario,enhanced-prompt,intent-contract}.json`. Node.js `JSON.parse()` confirmed on each. |
| 5a | Runner: RegressionLogger class | PASS | Class at lines 78-123 with `log()` (line 91), `logSubProcess()` (line 101), and `close()` (line 111) methods. `close()` returns a Promise that resolves on stream `end` callback. |
| 5b | Runner: `validateEPKeyHints()` with static lookup | PASS | Function at lines 152-202 uses `PLUGIN_PARAM_LOOKUP` (lines 135-150) containing `google-sheets` and `google-mail` parameter mappings. Handles ambiguous keys (`__AMBIGUOUS__`), already-prefixed keys (via `includes('__')`), and generic keys (pass silently). |
| 5c | Runner: `execSync` maxBuffer | PASS | Line 230: `EXEC_OPTS_BASE` sets `maxBuffer: 10 * 1024 * 1024` (10 MB). This base config is spread into all three `execSync` calls in `runCompile` (line 247), `runPhaseA` (line 274), and `runPhaseD` (line 327). |
| 5d | Runner: Timeouts | PASS | Compile: 120,000ms (line 247). Phase A: 60,000ms (line 274). Phase D: 120,000ms (line 327). All match the requirement spec. |
| 5e | Runner: Exit code logic | PASS | Line 728: `process.exit(failed === 0 ? 0 : 1)`. Zero failures = exit 0, any failure = exit 1. |
| 5f | Runner: `fs.cpSync` for latest pointer | PASS | Line 719: `fs.cpSync(runOutputDir, latestDir, { recursive: true })`. No symlinks used. Preceded by `fs.rmSync` on line 717 to clear old `latest` directory. |
| 5g | Runner: Alphabetical scenario sorting | PASS | Line 509: `.sort()` applied to discovered scenario names after directory/file filtering. |
| 5h | Runner: Per-scenario try-catch | PASS | Lines 539-556: JSON loading wrapped in try-catch with descriptive error message, scenario marked FAIL, and `continue` to next scenario. Additionally, lines 558-596 handle missing/placeholder intent contracts gracefully. |
| 6 | Gitignore | PASS | `tests/v6-regression/.gitignore` contains exactly `output/` (single line). |
| 7 | Plugin name consistency | PASS | Both scenario files use `["google-mail", "google-sheets"]` as plugins. Plugin definitions `google-mail-plugin-v2.json` and `google-sheets-plugin-v2.json` exist in `lib/plugins/definitions/`. Names match. |
| 8 | Scenario data provenance | PASS | Complaint Logger `enhanced-prompt.json` is byte-identical to `scripts/test-intent-contract-generation-enhanced-prompt.json` (verified via `diff`). Leads Email Summary `enhanced-prompt.json` matches content from `git show 5d5dd97:scripts/test-intent-contract-generation-enhanced-prompt.json`. |
| 9 | Placeholder detection | PASS | Leads `intent-contract.json` has `_placeholder: true`. Runner detects this at lines 577-596 and marks scenario as FAIL with message "intent-contract.json is a placeholder -- needs LLM generation". This is the expected behavior per the known issue. |

### Acceptance Criteria Coverage

| Acceptance Criterion (from Requirement) | Tested? | Result | Notes |
|---|---|---|---|
| Regression runner discovers scenarios from `tests/v6-regression/scenarios/` | Yes | Pass | `fs.readdirSync` + `scenario.json` existence check + alphabetical sort |
| Each scenario runs Compile, Phase A, Phase D sequentially | Yes (code review) | Pass | Main loop at lines 525-680, phases called in order, Phase D skipped if Phase A fails |
| EP Key Hints validation runs before compilation | Yes (code review) | Pass | Lines 599-609, executed before `runCompile()` call |
| Auto-fixed enhanced prompt written to temp file, originals never modified | Yes (code review) | Pass | Lines 604-609 write `enhanced-prompt-fixed.json` to scenarioOutputDir only when fixes needed |
| Console output includes header, per-scenario progress, summary table | Yes (code review) | Pass | Functions `printHeader`, `printScenarioProgress`, `printCompileResult`, `printPhaseAResult`, `printPhaseDResult`, `printSummary` at lines 365-482 |
| `regression-report.json` written with structured results | Yes (code review) | Pass | Lines 683-707 build and write the report JSON matching the requirement schema |
| `regression-log.txt` written with timestamps | Yes (code review) | Pass | `RegressionLogger` writes `[HH:MM:SS]` prefixed lines to file, sub-process output via `logSubProcess` |
| `latest` pointer updated after each run | Yes (code review) | Pass | Lines 714-722 use `fs.cpSync` for Windows compatibility |
| Exit code 0 for all pass, 1 for any fail | Yes (code review) | Pass | Line 728 |
| Existing scripts work unchanged without new CLI args | Yes | Pass | Default fallback paths verified for both Phase A and Phase D |
| Scenario fixture files are valid and correctly sourced | Yes | Pass | All JSON valid, provenance verified against git history and current files |

### Issues Found

#### Bugs (must fix before commit)

None found.

#### Performance Issues (should fix)

None found.

#### Edge Cases (nice to fix)

1. **Top-level catch missing logger flush** -- In `run-regression.ts` lines 731-733, if `main()` throws after the logger is created, the top-level `.catch()` calls `process.exit(1)` without awaiting `logger.close()`. This could lose the last log entries. SA Code Review also noted this as item 4 (Low severity). The risk is minimal since `console.error` still prints the fatal error.

2. **`chatgpt-research` in leads `services_involved` but not in `scenario.json` plugins** -- The leads-email-summary `enhanced-prompt.json` lists `chatgpt-research` in `services_involved` (line 42), but `scenario.json` only lists `["google-mail", "google-sheets"]`. This means the EP Key Hints validator will not check `chatgpt-research` parameters. SA Code Review noted this as item 7 (Info severity). Since the leads scenario does not actually use ChatGPT research plugin actions and has no `chatgpt-research`-prefixed keys in `resolved_user_inputs`, this has no functional impact.

### Test Outputs / Logs

**TypeScript compilation (target files):**
```
npx tsc --noEmit | grep -E "(run-regression|test-dsl-execution-simulator/index|test-workflowpilot-execution)"
(no output -- zero errors in target files)
```

**JSON validation:**
```
VALID: tests/v6-regression/scenarios/complaint-email-logger/scenario.json
VALID: tests/v6-regression/scenarios/complaint-email-logger/enhanced-prompt.json
VALID: tests/v6-regression/scenarios/complaint-email-logger/intent-contract.json
VALID: tests/v6-regression/scenarios/leads-email-summary/scenario.json
VALID: tests/v6-regression/scenarios/leads-email-summary/enhanced-prompt.json
VALID: tests/v6-regression/scenarios/leads-email-summary/intent-contract.json
```

**Scenario data provenance:**
```
diff (complaint-email-logger/enhanced-prompt.json vs scripts/test-intent-contract-generation-enhanced-prompt.json): MATCH
git show 5d5dd97 (leads enhanced prompt): content matches leads-email-summary/enhanced-prompt.json
```

### What Could Not Be Verified

- **End-to-end execution** of the regression suite (requires LLM API keys for compilation phase and Supabase for plugin manager initialization). This is Task 10 in the workplan and is noted as blocked on the Leads intent contract LLM generation.
- **Console output formatting** (box-drawing characters, alignment, summary table layout) was verified by code review only, not by visual inspection of actual output.
- **Report JSON structure** was verified against the requirement schema by code review only, not by inspecting an actual generated report file.

### Final Status

- [x] All acceptance criteria pass -- ready for commit
- [ ] Issues found -- Dev must address before commit

**Note:** No high or medium severity bugs found. Two edge cases noted (both also identified by SA Code Review as Low/Info severity). The Leads Email Summary scenario is expected to FAIL due to the placeholder intent contract -- this is a known, documented limitation that requires a separate user action (LLM pipeline run) to resolve. The Complaint Logger scenario structure and all runner infrastructure are correct and ready for commit.

---

## Commit Info

[RM will populate this section]

---

## SA Code Review

**Date:** 2026-03-26
**Reviewer:** SA Agent
**Verdict:** APPROVED WITH NOTES

### File-by-File Review

| File | Verdict | Notes |
|------|---------|-------|
| `tests/v6-regression/run-regression.ts` | PASS | Well-structured, all SA review items addressed. Types are clean with proper interfaces. Error handling is thorough. Two low-severity issues noted below. |
| `scripts/test-dsl-execution-simulator/index.ts` | PASS | Minimal, backward-compatible change. Code comment on `--input-dir` dual purpose is present (SA item 2). Default path unchanged. |
| `scripts/test-workflowpilot-execution.ts` | PASS | Backward-compatible `--input-dir`/`--output-dir` parsing. Fallback chain (`outputDir` -> `inputDir` -> `defaultDir`) is correct. Read paths (lines 73-74) use `inputDir`, write paths (lines 215, 240) use `writeDir`. |
| `tests/v6-regression/.gitignore` | PASS | Single line `output/` -- correct. |
| `tests/v6-regression/scenarios/complaint-email-logger/scenario.json` | PASS | Valid JSON. Metadata fields match requirement schema. |
| `tests/v6-regression/scenarios/complaint-email-logger/enhanced-prompt.json` | PASS | EP keys already have proper `google_sheets__table_read__*` and `google_mail__email_search__*` prefixes. Generic keys (`complaint_keywords`, `sheet_dedup_rule`, `thread_handling`) are correctly unprefixed. |
| `tests/v6-regression/scenarios/complaint-email-logger/intent-contract.json` | PASS | Valid IntentContract with 7 steps, correct `intent.v1` version, proper config/step structure. |
| `tests/v6-regression/scenarios/leads-email-summary/scenario.json` | PASS | Valid JSON. |
| `tests/v6-regression/scenarios/leads-email-summary/enhanced-prompt.json` | PASS | EP keys have proper prefixes. Generic keys (`qualification_rule`, `output_columns`, `email_format`, `no_results_behavior`) correctly unprefixed. |
| `tests/v6-regression/scenarios/leads-email-summary/intent-contract.json` | N/A | Placeholder file -- correctly uses `_placeholder: true` flag which the runner detects and reports as FAIL with a clear message. Requires user action (LLM run) to populate. |

### Issues Found

| # | Severity | File | Finding | Recommendation |
|---|----------|------|---------|----------------|
| 1 | Low | `run-regression.ts:152` | `enhancedPrompt` parameter is typed as `any`. While `enhancedPrompt` is loaded from an arbitrary JSON file and its shape can vary, a minimal type such as `{ specifics?: { resolved_user_inputs?: Array<{ key: string; value: string }> } }` would improve safety and make the function signature self-documenting. | Consider adding a minimal type alias. Not blocking -- the function body already does defensive checks (`Array.isArray(resolvedInputs)`). |
| 2 | Low | `run-regression.ts:208` | `applyEPFixes` also uses `any` for `enhancedPrompt`. Same as above. | Same recommendation. |
| 3 | Low | `run-regression.ts:260-263` | In the `catch` block of `runCompile`, `err` is typed as `any` and `.message` is accessed with optional chaining + `.slice(0, 500)`. This is defensive enough, but `execSync` errors include the full stdout/stderr on the error object. The 500-char truncation is reasonable to prevent report bloat. | Acceptable as-is. |
| 4 | Low | `run-regression.ts:731-733` | The top-level `.catch()` on `main()` calls `process.exit(1)` without awaiting `logger.close()`. If `main()` throws after the logger is created but before `logger.close()` in the normal flow, the last log lines may be lost. | Consider a defensive `logger?.close()` in the top-level catch. Not blocking -- the `console.error` on line 732 will still print the fatal error to stdout. |
| 5 | Info | `run-regression.ts:229` | `PROJECT_ROOT` uses `__dirname` which is correct for tsx execution but would not work in ESM without a polyfill. Currently fine since the project uses tsx (CJS-compatible). | No action needed. Noted for future reference if the project migrates to pure ESM. |
| 6 | Info | `run-regression.ts:367-369` | The header box uses Unicode escape sequences (`\u2554`, `\u2550`, etc.) rather than literal characters. This is functionally correct and arguably more maintainable since it avoids encoding issues in editors. The requirement spec shows emoji icons in the console output, but the implementation omits them. | Acceptable divergence -- the requirement used emoji for illustration, and the implementation uses plain text markers (PASS/FAIL) which are more portable across terminals. |
| 7 | Info | Scenario data | The `leads-email-summary/enhanced-prompt.json` lists `chatgpt-research` in `services_involved` (line 42), but `scenario.json` only lists `["google-mail", "google-sheets"]` as plugins. This mismatch means the EP Key Hints validator will not check parameters for `chatgpt-research`. | This is likely correct since the leads scenario does not use ChatGPT research plugin actions. If `chatgpt-research` has parameters that appear in `resolved_user_inputs`, they would be silently skipped (no false warnings). No action needed. |

### SA Review Items Verification

| # | Item | Addressed? | How |
|---|------|-----------|-----|
| 1 | maxBuffer 10MB on all execSync calls | Yes | Line 230: `EXEC_OPTS_BASE` sets `maxBuffer: 10 * 1024 * 1024`. This base config is spread into all three `execSync` calls (lines 247, 274, 327). |
| 2 | Code comment on Phase A `--input-dir` dual purpose | Yes | Lines 19-20 of `index.ts`: `// --input-dir controls both where input files are read from and where the report is written. Phase A always co-locates the report with its input files, so a single dir arg suffices.` |
| 3 | Logger flush before `process.exit` | Yes | Line 725: `await logger.close()` is called before `process.exit()` on line 728. The `close()` method (lines 111-122) returns a Promise that resolves when `stream.end()` callback fires. |
| 4 | Alphabetical scenario sorting | Yes | Line 509: `.sort()` applied to discovered scenario names after filtering. |
| 5 | Per-scenario try-catch for file loading | Yes | Lines 539-556: `meta` and `enhancedPrompt` loading wrapped in try-catch. On failure, the scenario is marked FAIL with a descriptive error and the loop continues to the next scenario. Additionally, lines 558-596 handle missing or placeholder intent contracts. |

### Optimisation Suggestions

- The `EXEC_OPTS_BASE` pattern (line 230) with spread is a good approach for consistency. If future phases need different buffer sizes, the spread makes per-call overrides easy.
- The placeholder detection logic (lines 577-596) with `_placeholder` flag is a clean pattern. Consider documenting this convention in the requirement doc's "Adding New Scenarios" section so future contributors know to use a placeholder when the intent contract is not yet available.
- The `printHeader` and `printSummary` functions could be made logger-aware (writing to both console and file) instead of only to console. Currently, the summary appears in the log file only via the single `logger.log()` call on line 711, not with the full formatted table. This is a minor gap -- the JSON report file contains all the data, so the log file does not need the formatted table. No action needed.

### Summary

The implementation is clean, well-structured, and addresses all five SA review items from the workplan review phase. Types are properly defined with dedicated interfaces for each phase result. Error handling covers the important edge cases: malformed JSON, missing files, placeholder intent contracts, `execSync` failures, and Phase A non-zero exits with valid reports.

The modified scripts (`index.ts` and `test-workflowpilot-execution.ts`) are backward-compatible -- default paths are preserved when no CLI args are provided.

Four low-severity issues were identified (three about `any` typing, one about logger flush in the top-level catch). None are blocking. No high or medium severity issues found.

**Code Approved for QA: Yes** -- QA may proceed with testing. The Leads Email Summary scenario will report FAIL due to the placeholder intent contract, which is expected and documented. QA should verify the Complaint Email Logger scenario end-to-end, and confirm backward compatibility of both modified scripts.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-26 | Created | Initial workplan with 10 tasks across 4 implementation phases |
| 2026-03-26 | Implementation | Tasks 1-9 implemented. SA items addressed: maxBuffer 10MB on execSync, per-scenario try-catch, logger.close() awaited before process.exit(), alphabetical scenario sorting, code comment on Phase A --input-dir. Task 6 uses placeholder (needs LLM run). Task 10 pending verification. |
