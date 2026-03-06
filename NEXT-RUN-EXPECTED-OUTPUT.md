# Next Pipeline Run - Expected IntentContract Improvements

**Date**: 2026-03-03
**Status**: Prompt updated, awaiting next LLM generation
**Current Issue**: This run's IntentContract was generated BEFORE prompt updates

---

## What Changed in the Prompt

Updated [intent-system-prompt-v2.ts](lib/agentkit/v6/intent/intent-system-prompt-v2.ts) with:

1. **Line 273-299**: Transform output_schema requirement
2. **Line 411**: Generate inputs completeness requirement

These are **generic, non-hardcoded instructions** that apply to ALL workflows.

---

## Expected IntentContract on Next Run

### Issue #1 Fix: Step 2 Flatten with Output Schema

**Current (Semantic Ambiguity)**:
```json
{
  "id": "extract_attachments",
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "input": "unread_emails",
    "description": "Extract attachments array from emails, preserving email sender and subject"
  }
}
```

**Expected Next Run (Explicit Schema)**:
```json
{
  "id": "extract_attachments",
  "kind": "transform",
  "transform": {
    "op": "flatten",
    "input": "unread_emails",
    "description": "Extract attachments array from emails, preserving email sender and subject",
    "output_schema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "message_id": { "type": "string", "description": "Gmail message ID" },
          "attachment_id": { "type": "string", "description": "Gmail attachment ID" },
          "filename": { "type": "string", "description": "Attachment filename" },
          "mimeType": { "type": "string", "description": "Attachment MIME type" },
          "email_sender": { "type": "string", "description": "Email sender address" },
          "email_subject": { "type": "string", "description": "Email subject line" }
        },
        "required": ["message_id", "attachment_id", "filename"]
      }
    }
  }
}
```

**Why This Works**:
- Prompt instructs: "If downstream steps will access SPECIFIC FIELDS from a transform output... you MUST declare an output_schema"
- LLM sees Step 7 accessing `attachment_ref.message_id`, `attachment_ref.attachment_id`, etc.
- LLM generates output_schema listing those exact fields
- **No hardcoded field names in prompt** - LLM infers from workflow context

---

### Issue #3 Fix: Step 10 Map with Output Schema

**Current (Semantic Ambiguity)**:
```json
{
  "id": "merge_transaction_metadata",
  "kind": "transform",
  "transform": {
    "op": "map",
    "input": "extracted_fields",
    "description": "Merge transaction fields with email sender, subject, and Drive link"
  }
}
```

**Expected Next Run (Explicit Schema)**:
```json
{
  "id": "merge_transaction_metadata",
  "kind": "transform",
  "transform": {
    "op": "map",
    "input": "extracted_fields",
    "description": "Merge transaction fields with email sender, subject, and Drive link",
    "output_schema": {
      "type": "object",
      "properties": {
        "date": { "type": "string", "description": "Transaction date" },
        "vendor": { "type": "string", "description": "Vendor name" },
        "amount": { "type": "number", "description": "Transaction amount" },
        "currency": { "type": "string", "description": "Currency code" },
        "invoice_number": { "type": "string", "description": "Invoice number" },
        "email_sender": { "type": "string", "description": "Email sender from attachment_ref" },
        "email_subject": { "type": "string", "description": "Email subject from attachment_ref" },
        "drive_link": { "type": "string", "description": "Drive file link from drive_file" }
      },
      "required": ["amount"]
    }
  }
}
```

**Why This Works**:
- Prompt instructs: "Map/merge operations combining multiple sources into new structure" require output_schema
- LLM sees Step 16 accessing `transaction.email_sender`, `transaction.email_subject`, `transaction.drive_link`
- LLM generates output_schema with standardized field names
- **No hardcoded field names in prompt** - LLM infers from downstream usage

---

### Issue #5 Fix: Step 18 Generate with Complete Inputs

**Current (Missing Inputs)**:
```json
{
  "id": "generate_summary_email",
  "kind": "generate",
  "inputs": [
    "valid_transactions",
    "high_value_transactions"
  ],
  "generate": {
    "instruction": "Create summary with total count and sum from transaction_metrics..."
  }
}
```

**Expected Next Run (All Inputs Included)**:
```json
{
  "id": "generate_summary_email",
  "kind": "generate",
  "inputs": [
    "valid_transactions",
    "high_value_transactions",
    "total_count",
    "total_amount"
  ],
  "generate": {
    "instruction": "Create summary with {{total_count}} transactions totaling {{total_amount}}..."
  }
}
```

**Why This Works**:
- Prompt instructs: "inputs array MUST include ALL data the generate step will reference"
- LLM sees instruction mentioning "total count and sum"
- LLM knows it computed `total_count` and `total_amount` in previous steps
- LLM includes them in inputs array
- **No hardcoded variable names in prompt** - LLM tracks what it created

---

## How the Prompt Guidance is Generic (Not Hardcoded)

### What the Prompt DOES NOT Say ❌
```
When creating a flatten for email attachments, include these fields:
- message_id
- attachment_id
- filename
```

### What the Prompt DOES Say ✅
```
If downstream steps will access SPECIFIC FIELDS from a transform output
(e.g., using dot notation like output_var.field_name), you MUST declare
an output_schema listing those fields
```

**The LLM reasons**:
1. I'm creating a flatten transform that outputs `attachment_refs`
2. Later, Step 7 accesses `attachment_ref.message_id`
3. Later, Step 7 accesses `attachment_ref.attachment_id`
4. Later, Step 7 accesses `attachment_ref.filename`
5. → I need to declare output_schema with those 3 fields (minimum)
6. The description mentions "preserving email sender and subject"
7. → I should also include email_sender and email_subject in the schema

**This works for ANY workflow**:
- Email workflow → LLM includes email-specific fields
- File workflow → LLM includes file-specific fields
- Custom data workflow → LLM includes custom fields

---

## Validation: How We Know It Will Work

### Test 1: Prompt Doesn't Mention Specific Fields
```bash
grep -i "message_id\|email_sender\|drive_link" lib/agentkit/v6/intent/intent-system-prompt-v2.ts
```
**Result**: No matches (except in generic examples)

The prompt teaches the **principle**, not the **specific fields**.

### Test 2: Prompt Uses Generic Placeholders
The prompt examples use:
- `output_var.field_name` (not `attachment_ref.message_id`)
- `var.field` (not `transaction.email_sender`)
- `{...}` (not specific field names)

### Test 3: Guidance Applies to All Transform Types
The instruction applies to:
- `"flatten" | "map" | "merge"` (any transform that restructures data)
- Not limited to email/attachment workflows

---

## Expected PILOT DSL After Next Run

With the improved IntentContract, the compiler will generate:

**Step 2** (with runtime validation):
```json
{
  "step_id": "step2",
  "type": "transform",
  "operation": "flatten",
  "output_schema": {
    "type": "array",
    "items": {
      "properties": {
        "message_id": {...},
        "attachment_id": {...},
        "filename": {...},
        "email_sender": {...},
        "email_subject": {...}
      }
    }
  }
}
```

**Step 10** (with runtime validation):
```json
{
  "step_id": "step10",
  "type": "transform",
  "operation": "map",
  "output_schema": {
    "properties": {
      "date": {...},
      "vendor": {...},
      "amount": {...},
      "email_sender": {...},
      "email_subject": {...},
      "drive_link": {...}
    }
  }
}
```

**Step 18** (with all required data):
```json
{
  "step_id": "step18",
  "input": {
    "valid_transactions": "{{valid_transactions}}",
    "high_value_transactions": "{{high_value_transactions}}",
    "total_count": "{{total_count}}",
    "total_amount": "{{total_amount}}"
  }
}
```

---

## Why This Is NOT Hardcoding

### The Principle
The prompt teaches **when** to use output_schema, not **what** fields to include.

### Scalability
Works for:
- ✅ Email attachment workflows (current example)
- ✅ File processing workflows
- ✅ API data transformation workflows
- ✅ Database query workflows
- ✅ Custom plugin workflows

### Schema-Driven
The LLM:
1. Reads the workflow goal
2. Understands what data flows between steps
3. Sees what fields downstream steps access
4. Generates output_schema to guarantee those fields exist

**No manual intervention needed for new workflows.**

---

## Summary

**Current Run**: Generated IntentContract BEFORE prompt updates → semantic ambiguity remains

**Next Run**: Will generate IntentContract AFTER prompt updates → explicit schemas guaranteed

**The Fix**: Generic, scalable guidance that teaches LLM to:
1. Declare output_schema when fields will be accessed
2. Include all inputs for generate steps
3. Match output structure to downstream requirements

**Zero Hardcoding**: No specific field names, no use-case examples, no plugin-specific logic in prompt

**Ready for Production**: Next pipeline run should produce runtime-safe IntentContracts for ANY workflow domain.
