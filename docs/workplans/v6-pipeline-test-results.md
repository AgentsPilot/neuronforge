# V6 Pipeline Test Results -- Invoice & Receipt Extraction Agent

> **Last Updated**: 2026-03-27
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Scenario**: Invoice & Receipt Extraction Agent (Gmail -> Drive + Sheets + Summary Email)
> **Enhanced Prompt**: `scripts/test-intent-contract-generation-enhanced-prompt.json`

## Overview

Full V6 pipeline test run covering compilation (Phase 0-4), static DSL validation (Phase A), and mock execution (Phase D) for the Invoice & Receipt Extraction Agent scenario.

---

## Test Summary

| Phase | Description | Status | Details |
|-------|-------------|--------|---------|
| EP Key Hints | Validate resolved_user_inputs key format | WARNING | 2 keys missing plugin prefix |
| Phase 0-4 | Compile enhanced prompt to DSL | PASS | 17 DSL steps compiled in 77ms |
| Phase A | Static DSL validation | FAIL (12/13) | 1 check failed: unresolved references |
| Phase D | Mock WorkflowPilot execution | PASS | 17/17 steps, 0 failures |

**Overall Verdict: PARTIAL PASS** -- Phase A has 1 failed validation check (unresolved references), but Phase D mock execution passes fully. The Phase A issue is a static simulator limitation for loop-scoped variables, not a runtime bug.

---

## EP Key Hints Validation

**Convention**: Plugin-specific keys should use the format `plugin__capability__param_name`.

| Key | Has Prefix? | Assessment |
|-----|-------------|------------|
| `user_email` | No (generic) | OK -- generic key, no plugin param |
| `email_scope` | No (generic) | OK -- generic key |
| `attachment_types` | No (generic) | OK -- generic key |
| `drive_folder_strategy` | No (generic) | OK -- generic key |
| `sheet_destination_strategy` | No (generic) | OK -- generic key |
| `extraction_fields_profile` | No (generic) | OK -- generic key |
| `multi_attachment_handling` | No (generic) | OK -- generic key |
| `summary_email_includes` | No (generic) | OK -- generic key |
| `missing_amount_handling` | No (generic) | OK -- generic key |
| `amount_threshold_usd` | No (generic) | OK -- generic key |
| `sheet_tab_name` | No | WARNING -- matches Google Sheets param `sheet_tab_name`. Should be `google_sheets__table_read__sheet_tab_name` or `google_sheets__table_create__sheet_tab_name` |
| `google_sheet_id_candidate` | No | WARNING -- maps to `spreadsheet_id`. Should be `google_sheets__table_read__spreadsheet_id` or similar |

**Summary**: 2 keys are missing plugin prefixes but match known plugin parameters. The compiler's O8/O26 features may not bind these optimally without prefixes.

---

## Phase 0-4: Compile

**Command**: `npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts scripts/test-intent-contract-generation-enhanced-prompt.json`

**Result**: PASS

### Pipeline Flow

```
0. Vocabulary Extraction   -> 6 domains, 15 capabilities
1. IntentContract (LLM)    -> 12 steps (61588ms)
2. CapabilityBinderV2      -> 6 bindings (1195ms)
3. IntentToIRConverter      -> 22 nodes (16ms)
4. ExecutionGraphCompiler   -> 17 PILOT steps (78ms)
```

### Performance Stats

```
Intent Generation (LLM):   61588ms
Deterministic Pipeline:    1289ms
  - Binding:               1195ms
  - IR Conversion:         16ms
  - IR Compilation:        78ms
Total Pipeline Time:       62877ms
```

### Binding Stats

```
Intent Steps:              12
Successful Bindings:       6
Failed Bindings:           6
Binding Success Rate:      50.0%
```

The 6 unbound steps are transform/aggregate steps (`extract_attachments`, `filter_valid_attachments`, `merge_transaction_data`, `split_by_amount_validity`, `split_by_amount_threshold`, `calculate_summary_metrics`) -- these are expected to be unbound since they are non-plugin steps.

### Data Schema Validation

- Total data slots: 24
- All 24 slots typed (no `any` types)
- O10 Field Reconciliation: 15 variables with output schemas, no field mismatches
- Cross-step type compatibility: all 7 connections validated
- Schema validation: 0 errors, 11 warnings, 9 fixes applied

### Config Reference Consistency (O11)

- Referenced config keys: `gmail_search_query`, `extraction_mime_types`, `drive_folder_name`, `amount_threshold_usd`, `google_sheet_id_candidate`, `sheet_tab_name`, `user_email`
- 3 unreferenced config keys: `email_scope`, `attachment_types`, `gmail_search_max_results`

### Compiler Warnings (non-blocking)

- `drive_folder_name` config key referenced in DSL but not present in enhanced prompt's `resolved_user_inputs` (LLM inferred it from the intent but no default value was provided)
- `insert_data_option` and `options` parameters had no fuzzy match in workflow config
- Scatter_gather step5 had redundant `gather.outputKey` (auto-removed by Phase 4.5)

### Output Files Generated

- `output/vocabulary-pipeline/phase0-plugin-vocabulary.json` (35 KB)
- `output/vocabulary-pipeline/phase0-vocabulary-for-prompt.txt` (14 KB)
- `output/vocabulary-pipeline/phase1-intent-contract.json` (22 KB)
- `output/vocabulary-pipeline/phase2-bound-intent-contract.json` (64 KB)
- `output/vocabulary-pipeline/phase2-data-schema.json` (35 KB)
- `output/vocabulary-pipeline/phase3-execution-graph-ir-v4.json` (62 KB)
- `output/vocabulary-pipeline/phase4-pilot-dsl-steps.json` (41 KB)
- `output/vocabulary-pipeline/phase4-workflow-config.json` (879 B)
- `output/vocabulary-pipeline/phase4-compiler-logs.txt` (26 KB)

### OAuth Token Warnings (expected in test environment)

4 OAuth token refresh failures logged (status 400, "Invalid token") -- expected because the test environment does not have valid OAuth tokens. These do not affect compilation.

---

## Phase A: Static DSL Validation

**Command**: `npx tsx scripts/test-dsl-execution-simulator/index.ts`

**Result**: FAIL (12/13 checks passed, 1 failed)

### Full Console Output

```
DSL Execution Simulator -- Phase A

Loading input files...
  Loaded 17 DSL steps from phase4-pilot-dsl-steps.json
  Loaded 15 config keys from phase4-workflow-config.json (post-O7 merge)
  Loaded data schema from phase2-data-schema.json

Simulating DSL execution...

  step1  (action) [google-mail/search_emails]                         -> unread_emails (object{5 keys})
  step2  (transform)                                                  -> all_attachments (array[3])
  step3  (transform)                                                  -> filtered_attachments (array[3])
  step4  (action) [google-drive/get_or_create_folder]                 -> drive_folder (object{6 keys})
         WARNING: Unresolved: {{input.drive_folder_name}}
  step6  (action) [google-mail/get_email_attachment]                  -> attachment_content (object{6 keys})
         WARNING: Unresolved: {{attachment.message_id}}, {{attachment.attachment_id}}, {{attachment.filename}}
  step7  (action) [google-drive/upload_file]                          -> drive_file (object{8 keys})
  step8  (action) [document-extractor/extract_structured_data]        -> extracted_fields (object{5 keys})
  step9  (transform)                                                  -> attachment_result (object{9 keys})
         WARNING: Unknown transform operation: set
  [scatter_gather iterations x3]
  step5  (scatter_gather)                                             -> processed_attachments (array[3])
  step10 (transform) Filter subset for valid_transactions             -> valid_transactions (array[3])
  step11 (transform) Filter subset for invalid_transactions           -> invalid_transactions (array[3])
  step12 (transform) Filter subset for high_value_transactions        -> high_value_transactions (array[0])
  step13 (transform) Filter subset for low_value_transactions         -> low_value_transactions (array[3])
  step14 (action) [google-sheets/get_or_create_sheet_tab]             -> sheet_tab (object{5 keys})
  step15 (action) [google-sheets/append_rows]                         -> sheet_append_result (object{8 keys})
  step16 (transform) Count items for total_transaction_count          -> total_transaction_count (number)
  step17 (transform) Aggregate sum for total_amount_sum               -> total_amount_sum (number)
  step18 (transform) Count items for high_value_count                 -> high_value_count (number)
  step19 (transform) Aggregate sum for high_value_sum                 -> high_value_sum (number)
  step20 (ai_processing)                                              -> email_content (object{2 keys})
  step21 (action) [google-mail/send_email]

Simulation Summary:
   Steps: 29 total, 29 executed, 0 skipped
   Warnings: 4
   Errors: 0

Validation (13 checks):
   Passed: 12/13
   Failed: 1/13
```

### Failed Check Details

**Unresolved References** (1 failed check covering 4 unique references):

| Reference | Step | Analysis |
|-----------|------|----------|
| `{{input.drive_folder_name}}` | step4 | Config key `drive_folder_name` is referenced in DSL but not present in `resolved_user_inputs`. The LLM inferred this config key from the intent's `drive_folder_name` config entry, but the enhanced prompt does not provide a default value. |
| `{{attachment.message_id}}` | step6 | Loop-scoped variable. The `attachment` variable is the scatter_gather item variable -- it is only available inside the loop body. The static simulator flags this because it processes inner steps before the scatter_gather wrapper. At runtime (Phase D), this resolves correctly. |
| `{{attachment.attachment_id}}` | step6 | Same as above -- loop-scoped variable, resolves at runtime. |
| `{{attachment.filename}}` | step6 | Same as above -- loop-scoped variable, resolves at runtime. |

### Warning Details (informational, non-blocking)

- **Missing config key**: `drive_folder_name` -- referenced but not in workflowConfig
- **Unknown transform operation**: `set` -- the simulator does not know the `set` transform operation (works at runtime)
- **9 unused config keys**: `email_scope`, `attachment_types`, `gmail_search_max_results`, `drive_folder_strategy`, `sheet_destination_strategy`, `extraction_fields_profile`, `multi_attachment_handling`, `summary_email_includes`, `missing_amount_handling`

### Assessment

The Phase A failure is **partially a false positive**:
- The `{{attachment.*}}` references (3 of 4 unresolved refs) are loop-scoped variables that correctly resolve at runtime in Phase D. This is a known limitation of the static simulator.
- The `{{input.drive_folder_name}}` reference is a **real issue** -- the LLM generated a config key `drive_folder_name` that is not provided in the enhanced prompt's `resolved_user_inputs`. At runtime, this would resolve to `undefined`, causing the Drive folder to be created without a specified name (the plugin would likely use a default or error).

---

## Phase D: Mock WorkflowPilot Execution

**Command**: `npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts`

**Result**: PASS

### Summary

```
PHASE D -- WORKFLOWPILOT EXECUTION REPORT
======================================================================

Summary:
   Success: PASS
   Steps completed: 17
   Steps failed: 0
   Steps skipped: 0
   Execution time: 35519ms
   Total tokens: 12950
   Execution ID: dffbde48-3561-4b17-88c3-31313e461f8c
```

### Completed Steps (all 17)

```
step1  - Search Gmail for unread emails with attachments           [google-mail/search_emails]
step2  - Extract attachments array from emails                     [transform]
step3  - Filter attachments to only PDF and image types            [transform]
step4  - Get or create Google Drive folder                         [google-drive/get_or_create_folder]
step5  - Loop over filtered_attachments (scatter_gather)           [3 iterations]
  step6  - Download attachment content from Gmail                  [google-mail/get_email_attachment]
  step7  - Upload attachment to Google Drive folder                [google-drive/upload_file]
  step8  - Extract structured transaction fields                   [document-extractor/extract_structured_data]
  step9  - Merge extracted fields with email metadata              [transform: set]
step10 - Filter subset for valid_transactions                      [transform: filter]
step11 - Filter subset for invalid_transactions                    [transform: filter]
step12 - Filter subset for high_value_transactions                 [transform: filter]
step13 - Filter subset for low_value_transactions                  [transform: filter]
step14 - Get or create Google Sheets tab                           [google-sheets/get_or_create_sheet_tab]
step15 - Append high value transactions to Google Sheets           [google-sheets/append_rows]
step16 - Count items for total_transaction_count                   [transform: reduce]
step17 - Aggregate sum for total_amount_sum                        [transform: reduce]
step18 - Count items for high_value_count                          [transform: reduce]
step19 - Aggregate sum for high_value_sum                          [transform: reduce]
step20 - Generate summary email content                            [ai_processing]
step21 - Send summary email to user                                [google-mail/send_email]
```

### Execution Flow Highlights

- **Scatter/gather (step5)**: Successfully iterated over 3 mock attachments, running steps 6-9 for each
- **Subset filtering (steps 10-13)**: Successfully split processed attachments into valid/invalid and high/low value groups
- **Aggregation (steps 16-19)**: Successfully computed count and sum metrics
- **AI processing (step20)**: Summary email generated via mock LLM (12,950 tokens)
- **Email delivery (step21)**: Summary email sent to meiribarak@gmail.com (mocked)

### Non-blocking Warnings

- `ShadowAgent Init failed (non-blocking): Cannot read properties of null (reading 'production_ready')` -- expected in test environment, non-blocking
- `execution_metrics foreign key constraint violation` -- expected because mock agent ID does not exist in agents table
- Pre-flight warning: `Step 'step20' has unknown type 'ai_processing'` -- informational, step executed successfully

---

## Issues Found

### Bugs (should fix before merge)

1. **Missing `drive_folder_name` config key** -- The LLM-generated IntentContract includes a `drive_folder_name` config key that is not provided in the enhanced prompt's `resolved_user_inputs`. This means `{{input.drive_folder_name}}` resolves to `undefined` at runtime.
   - **File**: `scripts/test-intent-contract-generation-enhanced-prompt.json`
   - **Severity**: Medium
   - **Fix options**:
     - (a) Add `{ "key": "drive_folder_name", "value": "Invoice_Receipts" }` to `resolved_user_inputs` in the enhanced prompt
     - (b) Add a default value in the IntentContract's config section (the LLM already suggested `Invoice_Receipts` as a hint)
   - **Impact**: At runtime, the Google Drive `get_or_create_folder` action would receive an undefined folder name

### Edge Cases (nice to fix)

1. **Phase A simulator does not understand loop-scoped variables** -- The static simulator flags `{{attachment.*}}` references as unresolved because it processes inner scatter_gather steps before the wrapper establishes the loop variable scope. This causes a false positive in the unresolved references check.
   - **File**: `scripts/test-dsl-execution-simulator/index.ts`
   - **Severity**: Low
   - **Impact**: Phase A reports 12/13 instead of 13/13 for workflows with scatter_gather loops

2. **Phase A simulator does not know `set` transform operation** -- The `set` transform type (used for merging fields from multiple sources) is flagged as unknown.
   - **File**: `scripts/test-dsl-execution-simulator/index.ts`
   - **Severity**: Low
   - **Impact**: Warning only, does not affect pass/fail

3. **9 unused config keys** -- The enhanced prompt provides several config keys (`email_scope`, `attachment_types`, `gmail_search_max_results`, etc.) that are not referenced in the compiled DSL. These were likely intended as guidance for the LLM but are not wired into the workflow.
   - **Severity**: Low (informational)
   - **Impact**: No runtime impact; the keys are simply ignored

### Performance Issues

None identified. The deterministic pipeline (binding + IR + compilation) completes in 1,289ms. The LLM call (61,588ms) dominates total time, which is expected.

---

## Output Reports

- **Phase A**: `C:\Users\Barak\My Projects\AgentsPilot\neuronforge\output\vocabulary-pipeline\execution-simulation-report.json`
- **Phase D**: `C:\Users\Barak\My Projects\AgentsPilot\neuronforge\output\vocabulary-pipeline\workflowpilot-execution-report.json`
- **Compiler logs**: `C:\Users\Barak\My Projects\AgentsPilot\neuronforge\output\vocabulary-pipeline\phase4-compiler-logs.txt`

---

## Final Status

- [ ] All phases pass -- ready for commit
- [x] Issues found -- Dev should address before commit

**Blocking item**: The `drive_folder_name` missing config key (Medium severity) should be resolved by adding it to the enhanced prompt's `resolved_user_inputs` with a default value like `"Invoice_Receipts"`.

**Non-blocking items**: Phase A simulator limitations (loop-scoped variables, unknown `set` operation) are known issues with the test tooling, not with the pipeline itself. Phase D confirms runtime correctness.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-27 | Initial test run | Full pipeline test for Invoice & Receipt Extraction Agent scenario |
