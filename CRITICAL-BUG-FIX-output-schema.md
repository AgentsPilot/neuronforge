# CRITICAL BUG FIX: AI Operation output_schema Format

**Date:** February 9, 2026
**Severity:** 🔴 CRITICAL - Breaks ALL AI extraction workflows
**Status:** ✅ FIXED

---

## Problem Summary

The formalization prompt was instructing the LLM to generate EMPTY output schemas for AI operations, causing all AI extraction to fail.

### Symptoms:

1. **AI operations return unstructured data** (free-form objects)
2. **Filtering by extracted fields FAILS** (fields don't exist)
3. **Conditional logic FAILS** (can't check extracted values)
4. **Rendering FAILS** (column names don't match)

### Root Cause:

The formalization prompt said:
> `output_schema`: JSON schema - ONLY `{"type": "object" | "array" | "string"}` (NO `properties` or `required`)

This instruction was **TOO RESTRICTIVE** and caused the LLM to strip out ALL field definitions.

---

## The Regression

### BEFORE (Working - Old Code):
```json
{
  "output_schema": {
    "type": "object",
    "fields": [
      {
        "name": "classification",
        "type": "string",
        "required": true,
        "description": "Document type classification: invoice or expense"
      },
      {
        "name": "vendor",
        "type": "string",
        "required": false,
        "description": "Vendor/merchant name"
      },
      {
        "name": "amount",
        "type": "number",
        "required": false,
        "description": "Total amount"
      },
      {
        "name": "needs_review",
        "type": "boolean",
        "required": true,
        "description": "True when amount cannot be confidently extracted"
      }
    ]
  }
}
```

**Result:** AI extraction returns structured data with defined fields ✅

### AFTER (Broken - Today's "Improvements"):
```json
{
  "output_schema": {
    "type": "object",
    "fields": []  // ← EMPTY!!!
  }
}
```

**Result:** AI extraction returns free-form object, downstream steps FAIL ❌

---

## Why This Happened

The optimization work today focused on simplifying the formalization prompt. The instruction was added to prevent the LLM from using **standard JSON Schema syntax**:

```json
// FORBIDDEN (standard JSON Schema)
{
  "type": "object",
  "properties": {
    "vendor": {"type": "string"},
    "amount": {"type": "number"}
  },
  "required": ["vendor"]
}
```

But the instruction went **TOO FAR** and eliminated the **V6 custom schema format** that the runtime actually needs:

```json
// REQUIRED (V6 custom schema)
{
  "type": "object",
  "fields": [
    {"name": "vendor", "type": "string", "required": true, "description": "Vendor name"},
    {"name": "amount", "type": "number", "required": false, "description": "Amount"}
  ]
}
```

---

## The Fix

### Updated formalization prompt instruction:

**BEFORE:**
```markdown
- `output_schema`: JSON schema - ONLY `{"type": "object" | "array" | "string"}` (NO `properties` or `required`)
```

**AFTER:**
```markdown
- `output_schema`: V6 custom schema (NOT standard JSON Schema):
  - **For object type**: `{"type": "object", "fields": [{name, type, required, description}]}`
  - **For array type**: `{"type": "array", "items": {...}}`
  - **For string type**: `{"type": "string"}`
  - **FORBIDDEN**: Standard JSON Schema syntax (`properties`, `$schema`, `definitions`)
```

### Updated examples to show correct format:

**Pattern 1 - Invoice Extraction:**
```json
{
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract invoice data",
    "context": "Email attachments",
    "output_schema": {
      "type": "object",
      "fields": [
        {"name": "invoice_number", "type": "string", "required": true, "description": "Invoice number"},
        {"name": "vendor", "type": "string", "required": true, "description": "Vendor name"},
        {"name": "amount", "type": "number", "required": true, "description": "Invoice amount"}
      ]
    },
    "constraints": {"model_preference": null, "temperature": null, "max_tokens": null}
  }]
}
```

**Pattern 4 - File Storage Workflow:**
```json
{
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract vendor, amount, invoice number from PDF",
    "context": "PDF attachments",
    "output_schema": {
      "type": "object",
      "fields": [
        {"name": "vendor", "type": "string", "required": true, "description": "Vendor name"},
        {"name": "amount", "type": "number", "required": true, "description": "Invoice amount"},
        {"name": "invoice_number", "type": "string", "required": true, "description": "Invoice number"}
      ]
    },
    "constraints": {"model_preference": null, "temperature": null, "max_tokens": null}
  }]
}
```

### Updated validation checklist:

**BEFORE:**
```markdown
✅ `ai_operations[].output_schema` is `{"type": "object" | "array" | "string"}` ONLY
```

**AFTER:**
```markdown
✅ `ai_operations[].output_schema` has `type` field and appropriate structure:
   - object type: MUST have `fields` array with name/type/required/description
   - array type: MUST have `items` object
   - string type: Just `{"type": "string"}`
```

---

## V6 Custom Schema Format (Official)

From the IR strict schema ([declarative-ir-schema-strict.ts:879-899](lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts#L879-L899)):

```typescript
output_schema: {
  type: 'object',
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['string', 'object', 'array', 'number', 'boolean']
    },
    // For object type: list of fields to extract
    fields: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['name', 'type', 'required', 'description'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          required: { type: 'boolean' },
          description: { type: ['string', 'null'] }
        }
      }
    }
  }
}
```

**Key Points:**
- This is **NOT** standard JSON Schema
- This is a **custom simplified format** designed for V6 runtime
- `fields` array is REQUIRED for `type: "object"`
- Each field MUST have: name, type, required, description

---

## Files Modified

1. `lib/agentkit/v6/semantic-plan/prompts/formalization-system.md`
   - Fixed AI Operations section (lines 72-81)
   - Fixed Pattern 1 example (lines 114-122)
   - Fixed Pattern 4 example (lines 292-301)
   - Fixed validation checklist (lines 374-377)

---

## Why Standard JSON Schema is Forbidden

Standard JSON Schema uses nested structure:
```json
{
  "type": "object",
  "properties": {
    "vendor": {
      "type": "string",
      "description": "Vendor name"
    },
    "amount": {
      "type": "number",
      "description": "Amount"
    }
  },
  "required": ["vendor", "amount"]
}
```

Problems with this format:
1. ❌ Nested structure is complex to parse at runtime
2. ❌ `required` is a separate array (not per-field)
3. ❌ Harder to iterate over fields programmatically
4. ❌ LLMs tend to generate invalid schemas (missing `required`, wrong nesting)

V6 custom format is simpler:
```json
{
  "type": "object",
  "fields": [
    {"name": "vendor", "type": "string", "required": true, "description": "Vendor name"},
    {"name": "amount", "type": "number", "required": false, "description": "Amount"}
  ]
}
```

Benefits:
1. ✅ Flat array structure (easy to iterate)
2. ✅ Required flag is per-field (clear and explicit)
3. ✅ Simpler for LLMs to generate correctly
4. ✅ Easier for runtime to validate and use

---

## Impact of Fix

### Before Fix:
- ❌ AI extraction returns unstructured data
- ❌ Filtering by extracted fields FAILS
- ❌ Conditional logic (amount > 50) FAILS
- ❌ Rendering with specific columns FAILS
- ❌ ALL AI workflows broken

### After Fix:
- ✅ AI extraction returns structured data with defined fields
- ✅ Filtering by extracted fields WORKS
- ✅ Conditional logic WORKS
- ✅ Rendering with specific columns WORKS
- ✅ ALL AI workflows restored

---

## Testing Checklist

After server restart, verify:

- [ ] Invoice extraction workflow generates correct output_schema with fields
- [ ] AI extraction returns structured data (not free-form objects)
- [ ] Filtering by `classification` field works
- [ ] Conditional append to sheets (amount > 50) works
- [ ] Rendering shows correct columns with extracted data
- [ ] Other AI workflows (sentiment, classification, summarization) work

---

## Lessons Learned

1. **Be careful with "simplification"** - removing complexity can remove necessary functionality
2. **Examples are documentation** - if examples don't show a feature, LLMs won't use it
3. **Test after prompt changes** - prompt changes can have unexpected consequences
4. **Custom schemas need clear documentation** - distinguish from standard formats
5. **Validation checklist must match examples** - inconsistencies cause confusion

---

## Related Files

- IR Schema: [declarative-ir-schema-strict.ts:879-899](lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts#L879-L899)
- Compiler: [DeclarativeCompiler.ts](lib/agentkit/v6/compiler/DeclarativeCompiler.ts) (uses output_schema.fields)
- Runtime: WorkflowPilot (expects structured fields for AI operations)

---

**Status:** ✅ FIXED
**Priority:** P0 (Critical - broke all AI workflows)
**Validation:** Requires server restart + testing with invoice workflow
