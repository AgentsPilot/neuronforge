# OpenAI Runtime Issues Analysis

**Date**: 2026-03-03
**Status**: 5 RUNTIME ISSUES IDENTIFIED
**Root Cause**: Semantic ambiguity in transform steps

---

## Overview

OpenAI identified 5 runtime issues that would cause execution failures. All stem from a common problem: **transform steps with vague descriptions don't guarantee output structure**, causing downstream steps to reference non-existent fields.

This is exactly the "Semantic Determinism Principle" issue described in CLAUDE.md.

---

## Issue #1: Step 2 Flatten Output Schema Not Guaranteed ⚠️ CRITICAL

### Problem
**Step 5** expects `attachment_ref` to have:
- `attachment_ref.message_id`
- `attachment_ref.attachment_id`
- `attachment_ref.filename`

But **Step 2** (flatten transform) only says:
```json
"custom_code": "Extract attachments array from emails, preserving email sender and subject for each attachment"
```

This doesn't guarantee `message_id` and `attachment_id` will be in the output.

### Runtime Impact
Step 5 will receive `{{attachment_ref.message_id}}` = `undefined`, causing Gmail API to fail.

### Root Cause Phase
**Phase 1 (IntentContract Generation - LLM)**

The LLM-generated IntentContract for the flatten transform doesn't specify output schema. The IntentContract should have:

```json
{
  "id": "extract_attachments",
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "input": "unread_emails",
    "output_schema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "message_id": { "type": "string", "description": "Gmail message ID" },
          "attachment_id": { "type": "string", "description": "Gmail attachment ID" },
          "filename": { "type": "string" },
          "mimeType": { "type": "string" },
          "email_sender": { "type": "string" },
          "email_subject": { "type": "string" }
        },
        "required": ["message_id", "attachment_id", "filename"]
      }
    }
  }
}
```

### Proposed Fix

**Option A (Preferred): Fix in IntentContract Generation Prompt**

Add guidance to the IntentContract system prompt to specify output schemas for transforms:

```markdown
## Transform Steps Must Declare Output Schema

When creating transform steps (flatten, map, filter), you MUST specify the output schema
if downstream steps reference specific fields:

✅ GOOD:
{
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "input": "emails",
    "output_schema": {
      "type": "array",
      "items": {
        "properties": {
          "message_id": { "type": "string" },
          "attachment_id": { "type": "string" }
        }
      }
    }
  }
}

❌ BAD:
{
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "description": "Extract attachments"  // No schema!
  }
}
```

**Option B: Add Validation in IntentToIRConverter**

Detect when a transform output is used in field extraction and warn if no schema provided:

```typescript
// In convertTransform()
if (!step.transform.output_schema) {
  // Check if this variable is used with field access downstream
  const usedWithFields = this.checkFieldAccessDownstream(step.output, ctx)
  if (usedWithFields.length > 0) {
    ctx.warnings.push(
      `Transform ${step.id} output '${step.output}' is accessed with fields ` +
      `[${usedWithFields.join(', ')}] but no output_schema provided. ` +
      `Runtime may fail if transform doesn't produce these fields.`
    )
  }
}
```

---

## Issue #2: Step 7 Drive Link Field Name Mismatch ⚠️ MEDIUM

### Problem
**Step 7** uses:
```json
"file_url": "{{drive_file.web_view_link}}"
```

But the Drive plugin schema might return `webViewLink` (camelCase) or `url` instead.

### Runtime Impact
Document extractor receives `file_url: undefined`, cannot fetch document, extraction fails.

### Root Cause Phase
**Phase 2 (Capability Binding) or Phase 3 (IR Conversion)**

The binder/converter should validate that `drive_file.web_view_link` exists in the Drive `upload_file` action's output schema.

### Proposed Fix

**Add output schema validation in IntentToIRConverter**

When generating parameters that reference fields from previous outputs:

```typescript
private validateFieldAccess(
  variable: string,
  field: string,
  ctx: ConversionContext
): void {
  // Find the step that produces this variable
  const sourceStep = this.findVariableSource(variable, ctx)
  if (!sourceStep) {
    ctx.warnings.push(`Variable '${variable}' not found in previous steps`)
    return
  }

  // Get the output schema from plugin action or transform
  const outputSchema = this.getOutputSchema(sourceStep)
  if (!outputSchema) {
    ctx.warnings.push(
      `Cannot validate field access '${variable}.${field}' - ` +
      `source step has no output schema`
    )
    return
  }

  // Check if field exists
  if (!this.fieldExistsInSchema(field, outputSchema)) {
    ctx.warnings.push(
      `Field '${field}' not found in '${variable}' output schema. ` +
      `Available fields: ${this.listFields(outputSchema).join(', ')}`
    )
  }
}
```

**Also: Add to google-drive plugin schema**

Ensure `upload_file` action has complete `output_guidance`:

```json
"output_guidance": {
  "sample_output": {
    "file_id": "1abc...",
    "name": "invoice.pdf",
    "web_view_link": "https://drive.google.com/file/d/...",
    "webViewLink": "https://drive.google.com/file/d/...",  // Both formats
    "mimeType": "application/pdf"
  }
}
```

---

## Issue #3: Step 8 Output Schema Doesn't Match Step 15 Expectations ⚠️ CRITICAL

### Problem
**Step 15** (inside loop) references:
```json
"fields": {
  "Date": "{{transaction.date}}",
  "Email Sender": "{{transaction.email_sender}}",
  "Email Subject": "{{transaction.email_subject}}",
  "Drive Link": "{{transaction.drive_link}}"
}
```

But **Step 8** (map transform) only says:
```json
"custom_code": "Merge transaction fields with email sender, subject, and Drive file link"
```

No guarantee that output has `email_sender`, `email_subject`, or `drive_link` fields.

### Runtime Impact
Sheets append receives `{{transaction.email_sender}}` = `undefined`, creates incomplete rows.

### Root Cause Phase
**Phase 1 (IntentContract Generation - LLM)**

The map transform IntentContract should specify output schema:

```json
{
  "id": "merge_transaction_metadata",
  "kind": "transform",
  "transform": {
    "op": "map",
    "input": "extracted_fields",
    "output_schema": {
      "type": "object",
      "properties": {
        "date": { "type": "string" },
        "vendor": { "type": "string" },
        "amount": { "type": "number" },
        "currency": { "type": "string" },
        "invoice_number": { "type": "string" },
        "email_sender": { "type": "string", "from": "attachment_ref.sender" },
        "email_subject": { "type": "string", "from": "attachment_ref.subject" },
        "drive_link": { "type": "string", "from": "drive_file.web_view_link" }
      }
    }
  }
}
```

### Proposed Fix

**Same as Issue #1**: Update IntentContract generation prompt to require output schemas for map transforms, especially when merging multiple sources.

---

## Issue #4: Step 16 Hardcodes spreadsheet_id ⚠️ MEDIUM

### Problem
**Step 14** uses:
```json
"spreadsheet_id": "{{config.google_sheet_id}}"
```

But **Step 16** hardcodes:
```json
"spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
```

This breaks config-driven design and makes workflows non-reusable.

### Runtime Impact
If user changes `config.google_sheet_id`, Step 14 creates/gets tab in new spreadsheet, but Step 16 still appends to hardcoded spreadsheet. Data goes to wrong place.

### Root Cause Phase
**Phase 3 (IntentToIRConverter) or Phase 4 (ExecutionGraphCompiler)**

The compiler is generating the hardcoded value instead of using the config reference.

### Analysis

Looking at the IntentContract ([bound-intent-contract.json](output/vocabulary-pipeline/bound-intent-contract.json:514)), Step 16 doesn't have `spreadsheet_id` in its config at all:

```json
{
  "id": "append_transaction_row",
  "kind": "deliver",
  "deliver": {
    "domain": "table",
    "intent": "append",
    "input": "transaction",
    "destination": "sheet_tab",  // References sheet_tab, not spreadsheet_id
    "mapping": [...]
  }
}
```

The compiler is incorrectly extracting `spreadsheet_id` from somewhere (probably from Step 14's artifact options).

### Proposed Fix

**Fix in IntentToIRConverter or ExecutionGraphCompiler**

When compiling a `deliver` step with `destination: "sheet_tab"`:

1. The `sheet_tab` variable was created by Step 14 (artifact step)
2. Step 14 already has `spreadsheet_id` in its config
3. Step 16 should NOT repeat `spreadsheet_id` - the runtime should extract it from `sheet_tab` reference

**Correct PILOT DSL for Step 16**:

```json
{
  "step_id": "step16",
  "type": "action",
  "plugin": "google-sheets",
  "operation": "append_rows",
  "config": {
    "sheet_tab_id": "{{sheet_tab.sheet_id}}",  // Extract from sheet_tab output
    "values": [["{{transaction.date}}", "{{transaction.vendor}}", ...]]
  }
}
```

OR, if the plugin schema requires spreadsheet_id:

```json
{
  "config": {
    "spreadsheet_id": "{{sheet_tab.spreadsheet_id}}",  // From sheet_tab, not config
    "sheet_id": "{{sheet_tab.sheet_id}}",
    "values": [...]
  }
}
```

---

## Issue #5: Step 17 Missing total_count and total_amount Inputs ⚠️ LOW

### Problem
**Step 17** prompt says:
```
"Overview section with total count and sum of all transactions"
```

But only passes:
```json
"input": {
  "valid_transactions": "{{valid_transactions}}",
  "high_value_transactions": "{{high_value_transactions}}"
}
```

The `total_count` and `total_amount` variables (created in Steps 12-13) are not passed.

### Runtime Impact
The AI will re-count and re-sum the transactions (more tokens, less deterministic) instead of using pre-computed values.

### Root Cause Phase
**Phase 1 (IntentContract Generation - LLM) or Phase 3 (IR Conversion)**

The IntentContract for Step 17 should list all required inputs:

```json
{
  "id": "generate_summary_email",
  "kind": "generate",
  "inputs": [
    "valid_transactions",
    "high_value_transactions",
    "transaction_metrics"  // This contains total_count and total_amount
  ]
}
```

OR:

```json
{
  "inputs": [
    "valid_transactions",
    "high_value_transactions",
    "total_count",
    "total_amount"
  ]
}
```

### Proposed Fix

**Option A: Use transaction_metrics output**

The aggregate step (Step "split_by_threshold") has `output: "transaction_metrics"` which should contain all outputs including subsets and aggregates. The compiler should make all aggregate outputs available under this single object.

**Option B: List all inputs explicitly**

Update IntentContract generation to list scalar aggregate outputs as separate inputs when referenced in prompts.

---

## Summary of Fixes Needed

### Phase 1: IntentContract Generation (LLM System Prompt)

1. **Require output_schema for transforms**: When transform outputs are used with field access, require output_schema
2. **List all inputs for generate steps**: Include aggregate results explicitly in inputs
3. **Avoid hardcoding in deliver steps**: Use destination variable references, not repeated config

### Phase 2: Capability Binding (Validation Enhancement)

1. **Validate field access**: Check that referenced fields exist in source variable's output schema
2. **Warn on missing schemas**: Flag transforms without schemas when fields are accessed downstream

### Phase 3: IR Conversion (Validation Enhancement)

1. **Validate variable references**: Check all {{variable.field}} references against available schemas
2. **Detect hardcoded values**: Warn when deliver steps duplicate artifact config instead of referencing destination

### Phase 4: Compilation (Runtime Safety)

1. **Extract destination metadata**: When deliver step references a destination variable, extract needed IDs from that variable's output
2. **Include all aggregate outputs**: Make all outputs from aggregate steps available in compiled form

---

## Recommended Immediate Action

**Priority 1 (CRITICAL - Blocks Execution)**:
- Issue #1: Add output_schema requirement to IntentContract prompt for transforms
- Issue #3: Same as #1 (map output schema)

**Priority 2 (MEDIUM - Causes Data Issues)**:
- Issue #4: Fix deliver step to extract IDs from destination variable
- Issue #2: Add output schema validation warnings

**Priority 3 (LOW - Suboptimal but Works)**:
- Issue #5: Include aggregate outputs in generate inputs

---

## Architecture Principle Alignment

All fixes maintain the core principles:

✅ **No Hardcoding**: Fixes use schema-driven validation and prompt guidance
✅ **Schema-Driven**: Leverage plugin output schemas for validation
✅ **Fix at Root Cause**: Issues #1, #3, #5 fixed in Phase 1 (LLM prompt)
✅ **Deterministic Safety Nets**: Issues #2, #4 add validation in deterministic phases
✅ **Scalable**: All fixes work for any plugin/workflow following the patterns
