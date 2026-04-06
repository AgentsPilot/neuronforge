# Critical Blockers - Root Cause Analysis

Date: 2026-03-03
**Status: MULTIPLE CRITICAL ISSUES IDENTIFIED**

## Summary

OpenAI identified 6 critical issues, revealing systemic problems in:
1. **LLM field name generation** - Not following plugin schemas
2. **Condition conversion** - Compiler mapping issues
3. **Config reference generation** - Hardcoded values instead of references

---

## Issue #1: Step 7 Field Name Mismatch (BLOCKER)

### Problem
```json
// Step 2 output schema
{"id": "...", "emailId": "...", "filename": "..."}

// Step 7 usage
{"message_id": "{{attachment_ref.message_id}}", "attachment_id": "{{attachment_ref.attachment_id}}"}
```

Fields don't exist → **runtime failure**.

### Root Cause
**LLM is not preserving Gmail plugin schema field names**.

Gmail plugin schema clearly defines attachments have:
- `attachment_id` (not `id`)
- `message_id` (not `emailId`)

But IntentContract Step 2 output_schema uses:
- `id`
- `emailId`

### Why Our Fix Didn't Work
Our prompt guidance says "preserve upstream field names", but it's too generic. The LLM doesn't know it needs to look at the NESTED attachment schema within the email response.

### Proper Fix
The prompt needs to be more specific about nested schemas:

```
When flattening nested arrays from a data_source output:
1. Check the plugin's output schema for the NESTED array structure
2. Use the EXACT field names from the nested schema
3. Example: If search_emails returns emails.attachments[], use the field names from the "attachments" array schema
```

**But this is still guidance-based**. The real solution is **schema validation** in the compiler.

---

## Issue #2: Step 3 Filter Condition Wrong Operator (BLOCKER)

### Problem
```json
// IntentContract (CORRECT)
{
  "where": {
    "comparator": "in",
    "right": {"value": ["application/pdf", "image/jpeg", ...]}
  }
}

// PILOT DSL (WRONG)
{
  "operator": "eq",  // Should be "in"
  "value": [...]
}
```

Using `eq` with an array doesn't work. Need `in` operator.

### Root Cause
**IntentToIRConverter line 1005** maps `"in"` to `"eq"`:

```typescript
const map: Record<string, SimpleCondition['operator']> = {
  // ...
  in: 'eq', // ← WRONG!
}
```

### Fix
Change line 1005:
```typescript
in: 'in',  // Preserve 'in' operator
```

And ensure the IR SimpleCondition type supports `'in'` as an operator.

---

## Issue #3: Step 3 & 11 Filter Field Reference Wrong (BLOCKER)

### Problem
```json
// PILOT DSL (WRONG)
{
  "field": "all_attachments.mimeType"  // Points to whole array
}

// Should be (CORRECT)
{
  "field": "item.mimeType"  // Points to current item in loop
}
```

### Root Cause
**ExecutionGraphCompiler line 1114-1116** directly renames `variable` to `field`:

```typescript
if (result.variable) {
  result.field = result.variable  // Copies full path: "all_attachments.mimeType"
  delete result.variable
}
```

But for filter operations, the runtime iterates over items, so it needs `item.field_name`.

### Fix
Detect when a condition is part of a filter transform and convert the field reference:

```typescript
// In transformConditionObject or where transform conditions are generated
if (isFilterContext && result.variable) {
  // Extract just the field name from variable like "array_name.field_name"
  const fieldName = result.variable.split('.').pop()
  result.field = `item.${fieldName}`
} else if (result.variable) {
  result.field = result.variable
}
delete result.variable
```

**Problem**: We need to know the context (is this a filter transform?) when converting conditions.

**Better solution**: Pass context through the conversion chain so we know when we're inside a filter operation.

---

## Issue #4: Step 5 Hardcoded spreadsheet_id (BLOCKER)

### Problem
```json
{
  "spreadsheet_id": "google_sheet_id",  // Literal string
  "parent_id": "google_sheet_id"        // Literal string
}

// Should be
{
  "spreadsheet_id": "{{config.google_sheet_id}}",
  "tab_name": "{{config.sheet_tab_name}}"
}
```

### Root Cause
**IntentContract artifact step** has:
```json
{
  "artifact": {
    "type": "spreadsheet",
    "strategy": "use_existing",
    "destination_ref": "google_sheet_id"  // This is a CONFIG KEY, not a variable ref!
  }
}
```

The compiler is treating `"google_sheet_id"` as a literal string instead of recognizing it as a config reference.

### Fix
The compiler's `convertArtifact` method needs to detect when `destination_ref` is a config key and wrap it appropriately:

```typescript
if (step.artifact.destination_ref) {
  // Check if this references a config key
  if (step.artifact.destination_ref in workflowConfig) {
    params.spreadsheet_id = `{{config.${step.artifact.destination_ref}}}`
  } else {
    // It's a variable reference
    params.spreadsheet_id = this.resolveRefName(step.artifact.destination_ref, ctx)
  }
}
```

**But**: We don't have access to workflowConfig in the converter. Need a better approach.

**Real issue**: The IntentContract schema for artifact is ambiguous. `destination_ref` should use the ValueRef structure:

```json
{
  "artifact": {
    "destination_ref": {
      "kind": "config",
      "key": "google_sheet_id"
    }
  }
}
```

Not:
```json
{
  "artifact": {
    "destination_ref": "google_sheet_id"  // Ambiguous - is this a string or a ref?
  }
}
```

---

## Issue #5: Step 10 Required Fields Can Fail (Risk)

### Problem
Requires `drive_link`, but if Drive upload fails or doesn't return `web_view_link`, the map transform will fail.

### Analysis
This is a **workflow design decision**, not a compiler bug. Two approaches:

1. **Fail-fast** (current): Required fields are truly required
2. **Graceful degradation**: Add conditional before map

**Our position**: This is correct behavior. If Drive upload fails, the attachment processing failed. The runtime should handle this at the iteration level with proper error handling.

**No compiler changes needed**.

---

## Issue #6: Step 17 Range Parameter Format (Not an Issue)

Google Sheets plugin schema explicitly supports tab name only:
```json
{
  "description": "The sheet name or range where data should be appended (e.g., 'Sheet1' or 'Sheet1!A:D')"
}
```

Using `"range": "{{config.sheet_tab_name}}"` is valid.

**No changes needed**.

---

## Required Fixes

### High Priority (Breaks Execution)

1. **Fix `in` operator mapping** (IntentToIRConverter.ts line 1005)
   ```typescript
   in: 'in',  // Not 'eq'
   ```

2. **Fix filter field references** (ExecutionGraphCompiler.ts)
   - Detect filter context
   - Convert `array_name.field` to `item.field`

3. **Fix hardcoded config values** (IntentToIRConverter.ts convertArtifact)
   - Detect config references in destination_ref
   - Generate `{{config.key}}` references

4. **Fix LLM field name generation** (intent-system-prompt-v2.ts)
   - Add specific guidance about nested array schemas
   - Emphasize checking plugin schemas for exact field names

### Implementation Strategy

**Option A: Fix in Compiler (Deterministic)**
- Pro: Works immediately, no LLM changes needed
- Con: Compiler becomes more complex, harder to maintain

**Option B: Fix in Prompt (LLM)**
- Pro: LLM learns correct patterns, generates better IntentContracts
- Con: Requires regeneration, not immediate

**Option C: Hybrid**
- Compiler fixes for structural issues (operator mapping, field references)
- Prompt improvements for semantic issues (field names)
- Schema validation to catch errors early

**Recommendation**: Option C - Fix critical compiler bugs immediately, improve prompts for next generation.

---

## Immediate Actions

1. Fix `in` operator mapping (1-line change)
2. Fix filter field context (moderate complexity)
3. Fix config reference detection (moderate complexity)
4. Add IntentContract validation that catches field name mismatches before compilation

**Timeline**: Issues #1-3 are critical blockers that prevent execution. Must fix before production.
