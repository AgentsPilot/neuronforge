# Complete Issue Analysis: Generated Intent Contract
**Date:** 2026-02-25
**File:** output/intent-contract.json

---

## Executive Summary

The generated Intent Contract has **systematic implicit schema violations** where transform expressions reference nested fields (`$.item.result.amount`, `$.item.result.vendor`, etc.) without those fields being explicitly declared in upstream step outputs.

**Critical Finding:** The LLM is correctly using `$.item` syntax but inventing deeply nested object structures that were never declared in the schema.

---

## Issue #1: Implicit Schema - filter_valid_transactions

**Location:** Step `filter_valid_transactions` (lines 507-527)

**Problem:**
```json
{
  "id": "filter_valid_transactions",
  "type": "transform",
  "transform": {
    "kind": "filter",
    "source": { "ref": "$.process_attachments.processed_attachments" },
    "expr": {
      "op": "not_empty",
      "left": { "ref": "$.item.result.amount" }  // ← References $.item.result.amount
    }
  }
}
```

**Upstream Step Output:**
```json
{
  "id": "process_attachments",
  "outputs": {
    "processed_attachments": "array of processed attachments with extraction results"
  }
}
```

**Violation:** The output description "array of processed attachments with extraction results" is **too vague**. It does NOT explicitly declare that items have a nested `result` object with an `amount` field.

**Expected:** The output should enumerate fields: `"processed_attachments": "array where each item = {result: {attachment_id, filename, email_id, email_subject, email_from, email_date, drive_file_id, drive_link, date, vendor, amount, currency, invoice_number, confidence}}"`

---

## Issue #2: Implicit Schema - filter_skipped_transactions

**Location:** Step `filter_skipped_transactions` (lines 528-548)

**Problem:**
```json
{
  "id": "filter_skipped_transactions",
  "type": "transform",
  "transform": {
    "kind": "filter",
    "source": { "ref": "$.process_attachments.processed_attachments" },
    "expr": {
      "op": "is_empty",
      "left": { "ref": "$.item.result.amount" }  // ← References $.item.result.amount
    }
  }
}
```

**Same upstream source:** `$.process_attachments.processed_attachments`

**Violation:** Same as Issue #1 - implicit nested schema not declared.

---

## Issue #3: Implicit Schema - filter_over_50

**Location:** Step `filter_over_50` (lines 549-570)

**Problem:**
```json
{
  "id": "filter_over_50",
  "type": "transform",
  "transform": {
    "kind": "filter",
    "source": { "ref": "$.filter_valid_transactions.valid_transactions" },
    "expr": {
      "op": "gt",
      "left": { "ref": "$.item.result.amount" },  // ← References $.item.result.amount
      "right": 50
    }
  }
}
```

**Upstream Step Output:**
```json
{
  "id": "filter_valid_transactions",
  "outputs": {
    "valid_transactions": "transactions with valid amount"
  }
}
```

**Violation:** Output "transactions with valid amount" doesn't describe nested structure. Compiler won't know what `$.item.result.amount` refers to.

---

## Issue #4: Implicit Schema - prepare_sheet_rows

**Location:** Step `prepare_sheet_rows` (lines 571-611)

**Problem:**
```json
{
  "id": "prepare_sheet_rows",
  "type": "transform",
  "transform": {
    "kind": "map",
    "source": { "ref": "$.filter_over_50.over_50_transactions" },
    "template": [
      { "ref": "$.item.result.date" },        // ← 8 nested refs
      { "ref": "$.item.result.vendor" },
      { "ref": "$.item.result.amount" },
      { "ref": "$.item.result.currency" },
      { "ref": "$.item.result.invoice_number" },
      { "ref": "$.item.result.email_from" },
      { "ref": "$.item.result.email_subject" },
      { "ref": "$.item.result.drive_link" }
    ]
  }
}
```

**Upstream Step Output:**
```json
{
  "id": "filter_over_50",
  "outputs": {
    "over_50_transactions": "transactions with amount > 50"
  }
}
```

**Violation:** References 8 deeply nested fields (`$.item.result.*`) without any declaration of what fields exist in the result object.

---

## Issue #5: Implicit Schema - sum_all_amounts aggregate

**Location:** Step `sum_all_amounts` (lines 631-646)

**Problem:**
```json
{
  "id": "sum_all_amounts",
  "type": "aggregate",
  "aggregate": {
    "source": { "ref": "$.filter_valid_transactions.valid_transactions" },
    "metrics": [
      {
        "metric": "sum",
        "field": "result.amount",  // ← References nested result.amount
        "as": "total_amount"
      }
    ]
  }
}
```

**Upstream Step Output:**
```json
{
  "id": "filter_valid_transactions",
  "outputs": {
    "valid_transactions": "transactions with valid amount"
  }
}
```

**Violation:** The `field` parameter references `result.amount` (nested path) but the schema doesn't declare this structure.

---

## Issue #6: Implicit Schema - sum_over_50 aggregate

**Location:** Step `sum_over_50` (lines 662-677)

**Problem:**
```json
{
  "id": "sum_over_50",
  "type": "aggregate",
  "aggregate": {
    "source": { "ref": "$.filter_over_50.over_50_transactions" },
    "metrics": [
      {
        "metric": "sum",
        "field": "result.amount",  // ← References nested result.amount
        "as": "over_50_amount"
      }
    ]
  }
}
```

**Same issue as #5** - nested field path not declared in schema.

---

## Issue #7: Nested Loop Variable Scoping (Potentially Valid but Complex)

**Location:** Step `enrich_email_attachments` nested loop (lines 249-304)

**Structure:**
```
enrich_attachments (loop over email_results)
  └─> item_var: "email_result"
      └─> enrich_email_attachments (nested loop over email_result.result.attachments)
          └─> item_var: "attachment"
              └─> References:
                  - $.email_result.result.email_id
                  - $.email_result.result.email_subject
                  - $.email_result.result.email_from
                  - $.email_result.result.email_date
```

**Analysis:** This is **valid per scoping rules** - the nested loop can reference the outer loop's item variable (`email_result`). However, it depends on:

1. The outer loop collecting items with structure `{attachments_with_context: [...]}`
2. Each `email_result` having a nested `result` object with email metadata

**Potential Issue:** The structure is deeply nested and fragile. If the parent loop's output structure changes, this breaks.

---

## Issue #8: Redundant/Inefficient Workflow Pattern

**Location:** Steps `flatten_attachments` (line 233) + `enrich_attachments` (line 239) + `flatten_enriched` (line 305)

**Pattern:**
```
1. process_emails → email_results (array of {result: {email_id, email_subject, email_from, email_date, attachments: [...]}})
2. flatten_attachments → all_attachments (flattens email_results[].result.attachments)
3. enrich_attachments → enriched_attachments (loops over email_results again to add context)
4. flatten_enriched → flat_enriched (flattens enriched_attachments)
5. process_attachments → loops over flat_enriched
```

**Problem:** This is overly complex:
- Step 2 (`flatten_attachments`) is **never used** - its output `all_attachments` is never referenced
- Steps 3-4 (`enrich_attachments` + `flatten_enriched`) could be replaced by a single transform
- The workflow flattens, then re-enriches, then flattens again

**Better Pattern:**
```
1. process_emails → email_results
2. flatten_and_enrich (single transform/loop) → enriched_attachments
3. process_attachments → loops over enriched_attachments
```

**Impact:** While this works, it creates unnecessary steps that the compiler must process.

---

## Issue #9: AI Generate with Many Inputs (Valid but Check Scoping)

**Location:** Step `generate_summary_email` (lines 694-767)

**Inputs:**
```json
"inputs": {
  "all_transactions": { "ref": "$.filter_valid_transactions.valid_transactions" },
  "over_50_transactions": { "ref": "$.filter_over_50.over_50_transactions" },
  "skipped_transactions": { "ref": "$.filter_skipped_transactions.skipped_transactions" },
  "total_count": { "ref": "$.count_all_transactions.total_count" },
  "total_amount": { "ref": "$.sum_all_amounts.total_amount" },
  "over_50_count": { "ref": "$.count_over_50.over_50_count" },
  "over_50_amount": { "ref": "$.sum_over_50.over_50_amount" },
  "skipped_count": { "ref": "$.count_skipped.skipped_count" },
  "folder_link": { "ref": "$.create_drive_folder.web_view_link" }
}
```

**But ai_generate.input uses:**
```json
"input": { "ref": "$.all_transactions" }  // ← Step input alias
```

**Analysis:** This is **valid with pattern 5** - the step declares `all_transactions` as an input, then references it as `$.all_transactions`. However:

1. The `ai_generate.instruction` references multiple input keys but `ai_generate.input` only refs one
2. This might confuse the compiler - how does it pass 9 inputs if the instruction says "from all_transactions input" but the actual input field only refs one?

**Potential Issue:** The instruction text says "from all_transactions input" and "from over_50_transactions input" but the `input` field only points to `$.all_transactions`. This might be a semantic mismatch.

---

## Root Cause Analysis

### Primary Root Cause: Vague Output Descriptions

The LLM is writing **generic output descriptions** like:
- ❌ "array of processed attachments with extraction results"
- ❌ "transactions with valid amount"
- ❌ "transactions with amount > 50"

Instead of **explicit schema declarations** like:
- ✅ "array where each item has {result: {attachment_id, filename, email_id, email_subject, email_from, email_date, drive_file_id, drive_link, date, vendor, amount, currency, invoice_number, confidence}}"

### Why This Happens

The current prompt says:
> "Transform expr can ONLY reference fields that were declared in the source step's outputs"

But it doesn't explain **HOW** to declare fields - should outputs be:
1. Plain English descriptions? "array of objects with attachment data"
2. Structured schemas? "array<{attachment_id: string, filename: string, ...}>"
3. Field enumerations? "array where each item has: attachment_id, filename, ..."

The LLM is choosing option #1 (plain English) which is too vague for the compiler.

---

## Proposed Fixes (Prompt Changes)

### Fix #1: Add Explicit Schema Declaration Format

**Add to Section 4 (Canonical Step Shapes) after outputs field:**

```
CRITICAL OUTPUT SCHEMA RULES:
1. For primitive outputs (string, number, boolean):
   "output_key": "description of single value"
   Example: "folder_id": "created folder ID"

2. For array outputs where items have nested structure:
   You MUST enumerate all fields that downstream steps will reference:
   "output_key": "array where each item has: {field1, field2, field3, ...}"

   Example:
   ✅ CORRECT: "processed_items": "array where each item has: {id, name, status, metadata: {date, user}}"
   ❌ WRONG: "processed_items": "array of processed items"

3. For object outputs:
   Enumerate nested fields if downstream steps reference them:
   "output_key": "object with: {field1, field2, nested: {subfield1, subfield2}}"

4. If you reference $.item.result.amount downstream, then the source step MUST declare:
   "items": "array where each item has: {result: {amount, ...}}"
```

### Fix #2: Strengthen Transform Rule #3

**Change in CRITICAL TRANSFORM SCOPING RULES:**

```diff
- 3. Transform expr can ONLY reference fields that were declared in the source step's outputs:
-    - If downstream transform needs $.item.fieldX, then source step.outputs must describe fieldX
-    - Do NOT reference implicit fields that weren't explicitly declared upstream
-    - Declare all required fields in the source step's output schema description

+ 3. Transform expr can ONLY reference fields that were EXPLICITLY ENUMERATED in the source step's outputs:
+    - If you reference $.item.result.amount, the source step.outputs MUST say: "array where each item has: {result: {amount, ...}}"
+    - Generic descriptions like "array of objects" or "array of results" are NOT sufficient
+    - You MUST enumerate every field path you plan to reference downstream
+    - Example:
+      ✅ Source outputs: "items": "array where each item has: {id, name, metadata: {date, user}}"
+      ✅ Transform can use: $.item.id, $.item.name, $.item.metadata.date, $.item.metadata.user
+      ❌ Source outputs: "items": "array of processed items"
+      ❌ Transform CANNOT use: $.item.anything (fields not declared)
```

### Fix #3: Add Aggregate Field Path Validation

**Add to CRITICAL AGGREGATE RULES:**

```
- The "field" parameter for sum/min/max/avg must reference a field path declared in source outputs
- If source outputs don't enumerate nested fields, you cannot use nested paths like "result.amount"
- Example:
  ✅ Source outputs: "items": "array where each item has: {result: {amount}}"
  ✅ Aggregate field: "result.amount"
  ❌ Source outputs: "items": "array of items"
  ❌ Aggregate field: "result.amount" ← field not declared
```

### Fix #4: Add Validation Example to Section 8

**Add new example D:**

```
D) EXPLICIT SCHEMA DECLARATION FOR DOWNSTREAM REFS:

WRONG (implicit schema):
{
  "id": "process_items",
  "outputs": {
    "results": "array of processed items"  ← Too vague
  }
}
// Later step:
{
  "transform": {
    "source": { "ref": "$.process_items.results" },
    "expr": { "op": "gt", "left": { "ref": "$.item.amount" }, "right": 50 }
    // ❌ ERROR: $.item.amount not declared in "array of processed items"
  }
}

CORRECT (explicit schema):
{
  "id": "process_items",
  "outputs": {
    "results": "array where each item has: {id, name, amount, status, metadata: {date, user}}"
  }
}
// Later step:
{
  "transform": {
    "source": { "ref": "$.process_items.results" },
    "expr": { "op": "gt", "left": { "ref": "$.item.amount" }, "right": 50 }
    // ✅ VALID: amount is declared in schema
  }
}
```

---

## Summary: Issues to Fix in Prompt

| Issue | Category | Severity | Fix Required |
|-------|----------|----------|--------------|
| #1-6 | Implicit Schema in Transforms/Aggregates | 🔴 Critical | Add explicit schema declaration format |
| #7 | Nested Loop Scoping | 🟡 Medium | Add clarity on nested structure dependencies |
| #8 | Workflow Inefficiency | 🟢 Low | Not a validation error, but suboptimal |
| #9 | AI Generate Input Semantics | 🟡 Medium | Clarify multi-input handling vs single input field |

---

## Next Steps

1. ✅ Update prompt with Fix #1-4 (explicit schema declaration rules)
2. ✅ Re-generate Intent Contract with updated prompt
3. ✅ Verify all implicit schema violations are resolved
4. ✅ Move to Phase 2: Capability Binding (binding semantic ops to plugin actions)
5. ✅ Move to Phase 3: IR Compilation (convert Intent Contract to executable IR)

---

**Status:** 🔴 BLOCKING - Must fix prompt before proceeding to compiler phases
