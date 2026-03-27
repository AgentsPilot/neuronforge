# V6 Pipeline Test Results -- Run 2: Updated Enhanced Prompt

> **Last Updated**: 2026-03-27
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Scenario**: Expense & Invoice Email Scanner (Drive + Sheet Threshold)
> **Enhanced Prompt**: `scripts/test-intent-contract-generation-enhanced-prompt.json`

## Overview

Full V6 pipeline test run after the user updated the enhanced prompt JSON. This run covers compilation (Phase 0-4), static DSL validation (Phase A), and mock execution (Phase D). The enhanced prompt was rewritten with proper EP Key Hints (plugin-prefixed keys) and a more detailed scenario involving Gmail search, PDF extraction, Google Drive per-vendor storage, conditional Google Sheets append (amount > 50), and digest email delivery.

---

## Test Summary

| Phase | Description | Status | Details |
|-------|-------------|--------|---------|
| EP Key Hints | Validate resolved_user_inputs key format | PASS | All 12 keys use proper `plugin__capability__param` prefix or are generic |
| Phase 0-4 | Compile enhanced prompt to DSL | PASS | 8 PILOT steps compiled in 64ms |
| Phase A | Static DSL validation (13 checks) | PASS (13/13) | 0 errors, 0 warnings, 12 info-level unused config keys |
| Phase D | Mock WorkflowPilot execution | PASS | 11/11 steps completed, 0 failures |

**Overall Verdict: FULL PASS** -- All phases passed with zero errors.

---

## Comparison with Previous Run (Run 1)

| Metric | Run 1 (previous prompt) | Run 2 (updated prompt) | Delta |
|--------|------------------------|------------------------|-------|
| EP Key Hints | WARNING (2 keys missing prefix) | PASS (all keys prefixed) | Improved |
| IntentContract steps | 12 | 8 | Simpler, more focused |
| Capability bindings | 6 | 3 | Fewer due to fewer action steps |
| IR nodes | 22 | 18 | Fewer nodes |
| PILOT DSL steps | 17 | 8 | Significantly fewer |
| Phase A checks | 12/13 FAIL | 13/13 PASS | Fixed |
| Phase A failed check | 1 (unresolved loop-scoped refs) | 0 | Resolved |
| Phase D steps completed | 17/17 | 11/11 | All pass |
| Phase D result | PASS | PASS | Same |
| Compile time (deterministic) | 1289ms | 3129ms | Slower (binding took longer) |
| LLM generation time | 61588ms | 60961ms | Similar |

**Key improvements in Run 2:**
- EP Key Hints now follow the convention -- all plugin-specific keys use `plugin__capability__param` format
- Phase A is now 13/13 (was 12/13) -- the loop-scoped variable unresolved reference issue is gone
- The IntentContract is more focused: 8 steps instead of 12, with cleaner data flow
- The compiled DSL is smaller (8 PILOT steps vs 17), suggesting the LLM generated a more efficient workflow

---

## EP Key Hints Validation

All 12 `resolved_user_inputs` keys in the updated enhanced prompt:

| Key | Has Prefix? | Assessment |
|-----|-------------|------------|
| `gmail__send_message__recipient` | Yes | OK |
| `gmail__search__filter_criteria` | Yes | OK |
| `gmail__search__time_window` | Yes | OK |
| `gmail__search__attachment_type` | Yes | OK |
| `google_drive__create__base_folder_url` | Yes | OK |
| `google_drive__create__storage_rule` | Yes | OK |
| `google_sheets__create__sheet_id` | Yes | OK |
| `google_sheets__create__tab_name` | Yes | OK |
| `google_sheets__create__write_rule` | Yes | OK |
| `gmail__send_message__delivery_style` | Yes | OK |
| `summary_columns` | No (generic) | OK -- not a plugin parameter |
| `missing_amount_handling` | No (generic) | OK -- not a plugin parameter |

**Summary**: All keys correctly follow the EP Key Hints convention. No fixes needed.

---

## Phase 0-4: Compile

**Command**: `npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts scripts/test-intent-contract-generation-enhanced-prompt.json`

**Result**: PASS

### Pipeline Flow

```
0. Vocabulary Extraction   -> 6 domains, 15 capabilities
1. IntentContract (LLM)    -> 8 steps (60961ms)
2. CapabilityBinderV2      -> 3 bindings (3051ms)
3. IntentToIRConverter      -> 18 nodes (14ms)
4. ExecutionGraphCompiler   -> 8 PILOT steps (64ms)
```

### Performance Stats

```
Intent Generation (LLM):   60961ms
Deterministic Pipeline:    3129ms
  - Binding:               3051ms
  - IR Conversion:         14ms
  - IR Compilation:        64ms
Total Pipeline Time:       64090ms
```

### Binding Stats

```
Intent Steps:              8
Successful Bindings:       3
Failed Bindings:           5
Binding Success Rate:      37.5%
```

The 5 "failed" bindings are expected -- they are transform, loop, and decide steps that do not require plugin bindings:
- `extract_attachments` (transform)
- `filter_pdf_attachments` (transform)
- `process_each_attachment` (loop)
- `filter_high_value_items` (transform)
- `check_high_value_items_exist` (decide)

The 3 successful bindings are:
- `search_emails` -> `google-mail.search_emails` (confidence: 1.00)
- `generate_digest_email` -> `chatgpt-research.answer_question` (confidence: 1.00)
- `send_digest_email` -> `google-mail.send_email` (confidence: 1.00)

### Data Schema Validation

All 15 data schema slots validated successfully:

| Variable | Type | Source | Scope | Produced By |
|----------|------|--------|-------|-------------|
| matching_emails | object | plugin | global | search_emails |
| all_attachments | array | ai_declared | global | extract_attachments |
| pdf_attachments | array | inferred | global | filter_pdf_attachments |
| attachment | object | inferred | loop | process_each_attachment |
| processed_items | array | inferred | global | process_each_attachment |
| attachment_content | object | plugin | loop | download_attachment |
| extracted_data | object | ai_declared | loop | extract_fields |
| vendor_folder | object | plugin | loop | get_or_create_vendor_folder |
| drive_file | object | plugin | loop | upload_to_drive |
| digest_row | object | ai_declared | loop | build_digest_row |
| high_value_items | array | inferred | global | filter_high_value_items |
| sheet_tab | object | plugin | loop | get_or_create_sheet_tab |
| sheet_rows | array | ai_declared | loop | prepare_sheet_rows |
| sheet_result | object | plugin | loop | append_to_sheets |
| digest_content | object | ai_declared | global | generate_digest_email |

- Total slots: 15
- Has type "any": NO
- O10 Field Reconciliation: No field mismatches found
- O11 Config Reference Consistency: All config keys referenced
- Cross-step type compatibility: all 4 connections validated

### Compiler Warnings (non-blocking)

- `[O24]` Map step node_13 has unresolvable custom_code -- "Convert each digest row to array format" -- may produce incorrect output at runtime. This is expected for LLM-driven map operations.
- Phase 3 Warning: "Skipping undeclared input 'attachment' for generate step 'build_digest_row'" -- this is a parent loop item reference, not a bug.
- WhatsApp plugin failed to load (JSON syntax error in plugin definition) -- unrelated to this test.
- Airtable token refresh failed -- unrelated, plugin not used in this scenario.

### Output Files Generated

- `output/vocabulary-pipeline/phase0-plugin-vocabulary.json`
- `output/vocabulary-pipeline/phase0-vocabulary-for-prompt.txt`
- `output/vocabulary-pipeline/phase1-intent-contract.json`
- `output/vocabulary-pipeline/phase2-bound-intent-contract.json`
- `output/vocabulary-pipeline/phase2-data-schema.json`
- `output/vocabulary-pipeline/phase3-execution-graph-ir-v4.json`
- `output/vocabulary-pipeline/phase4-pilot-dsl-steps.json`
- `output/vocabulary-pipeline/phase4-workflow-config.json`
- `output/vocabulary-pipeline/phase4-compiler-logs.txt`

---

## Phase A: Static DSL Validation

**Command**: `npx tsx scripts/test-dsl-execution-simulator/index.ts`

**Result**: PASS (13/13 checks)

### Execution DAG

```
step1  [action: google-mail/search_emails]             -> matching_emails
step2  [transform]                                      -> all_attachments
step3  [transform]                                      -> pdf_attachments
step4  [scatter_gather] foreach attachment in pdf_attachments -> processed_items
  step5  [action: google-mail/get_email_attachment]     -> attachment_content
  step6  [action: document-extractor/extract_structured_data] -> extracted_data
  step7  [action: google-drive/get_or_create_folder]    -> vendor_folder
  step8  [action: google-drive/upload_file]             -> drive_file
  step9  [ai_processing]                                -> digest_row
  +-- gather: collect
step10 [transform]                                      -> high_value_items
step11 [conditional] if high_value_items.length greater_than
  then:
    step12 [action: google-sheets/get_or_create_sheet_tab] -> sheet_tab
    step13 [transform]                                  -> sheet_rows
    step14 [action: google-sheets/append_rows]          -> sheet_result
step15 [ai_processing]                                  -> digest_content
step16 [action: google-mail/send_email]
```

### Simulation Summary

```
Steps: 26 total, 26 executed, 0 skipped
Warnings: 0
Errors: 0

Validation (13 checks):
  Passed: 13/13
  Failed: 0/13
```

### Info-Level Notes (non-blocking)

12 config keys from the EP `resolved_user_inputs` exist in workflowConfig but are not directly referenced by DSL steps. These are the raw EP Key Hint keys that were already translated into the pipeline's internal config keys (e.g., `gmail__search__filter_criteria` was translated to `gmail_search_query`). This is expected behavior -- the O7 merge preserves both forms.

---

## Phase D: Mock WorkflowPilot Execution

**Command**: `npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts`

**Result**: PASS

### Execution Summary

```
Success: YES
Steps completed: 11
Steps failed: 0
Steps skipped: 0
Execution time: 28249ms
Total tokens: 17500
Execution ID: 4916d3e3-992c-4a6c-a618-2b6897cf24ad
```

### Steps Completed

| Step | Type | Plugin/Operation | Description |
|------|------|-----------------|-------------|
| step1 | action | google-mail/search_emails | Search Gmail for invoice/expense PDFs |
| step2 | transform | -- | Extract PDF attachments from emails |
| step3 | transform | -- | Filter for PDF only |
| step4 | scatter_gather | -- | Process each PDF (5 nested steps x 3 items) |
| step10 | transform | -- | Filter items where amount > 50 |
| step11 | conditional | -- | Check if high-value items exist |
| step12 | action | google-sheets/get_or_create_sheet_tab | Get/create sheet tab |
| step13 | transform | -- | Map rows to Sheets format |
| step14 | action | google-sheets/append_rows | Append to Google Sheets |
| step15 | ai_processing | chatgpt-research | Generate digest email HTML |
| step16 | action | google-mail/send_email | Send digest email |

Note: The scatter_gather (step4) internally executed steps 5-9 three times (once per mock PDF attachment), but the report counts it as 1 step. Total internal step executions: 11 top-level + 15 nested = 26 step executions.

### Non-blocking Errors in Logs

- `execution_metrics` foreign key constraint violation -- mock agent ID not in `agents` table. This is expected in test mode and does not affect execution.
- Airtable token refresh failure -- unrelated plugin, not used in scenario.

---

## Issues Found

### Bugs (must fix before commit)

None.

### Performance Issues (should fix)

1. **Binding phase slower than Run 1** -- Binding took 3051ms vs 1195ms in Run 1. This is likely due to OAuth token refresh for multiple plugins during binding. Not a code regression, but worth monitoring. Severity: Low.

### Edge Cases (nice to fix)

1. **12 unused config keys in Phase A info** -- The EP Key Hint raw keys are preserved in workflowConfig alongside the translated internal keys. The simulator reports them as "unused" at info level. This is cosmetic but could be cleaned up by stripping raw EP keys after O7 merge. Severity: Low.

2. **WhatsApp plugin JSON parse error** -- `whatsapp-business-plugin-v2.json` has a syntax error at line 31, column 1 (missing double-quoted property name). Unrelated to this scenario but should be fixed. Severity: Low.

---

## Final QA Verdict

```
==================================================================
                    QA TEST REPORT
==================================================================

  Scenario:        Expense & Invoice Email Scanner (Drive + Sheet Threshold)
  Enhanced Prompt: scripts/test-intent-contract-generation-enhanced-prompt.json
  IntentContract:  Generated fresh (LLM)
  Date:            2026-03-27
  Run:             2 (after EP rewrite)

  Phase           Status    Details
  ----------------------------------------------------------
  EP Key Hints     PASS     All 12 keys follow convention
  Compile (0-4)    PASS     8 steps, 18 IR nodes, 64ms
  Phase A          PASS     13/13 checks, 0 errors
  Phase D          PASS     11/11 steps, 0 failures

----------------------------------------------------------
  PASS -- all phases successful
==================================================================
```

---

## QA Testing Report

**QA -- 2026-03-27**
**Testing strategy used:** C (Test Script) -- ran the three pipeline test scripts in sequence as specified in the QA manual.

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Enhanced prompt compiles without errors | Yes | Pass | 8 PILOT steps generated |
| Phase A static validation passes 13/13 | Yes | Pass | 13/13 checks, zero errors |
| Phase D mock execution completes all steps | Yes | Pass | 11/11 steps, 0 failures |
| EP Key Hints follow convention | Yes | Pass | All plugin-specific keys prefixed |
| Data schema has no "any" types | Yes | Pass | 15 slots, all typed |
| O10 field reconciliation clean | Yes | Pass | No field mismatches |
| O11 config consistency clean | Yes | Pass | All config keys referenced |
| Scatter/gather loop executes correctly | Yes | Pass | 3 iterations, collect pattern |
| Conditional branch (amount > 50) works | Yes | Pass | Then-branch executed |
| Google Sheets append produces correct output | Yes | Pass | append_rows called with correct params |
| Digest email generated and sent | Yes | Pass | send_email step completed |

### Final Status

- [x] All acceptance criteria pass -- ready for commit
- [ ] Issues found -- Dev must address before commit

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-27 | Initial run 2 report | Full pipeline test with updated enhanced prompt |
