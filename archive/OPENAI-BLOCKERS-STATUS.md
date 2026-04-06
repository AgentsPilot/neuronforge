# OpenAI Critical Blockers - Final Status

Date: 2026-03-03
**Status: 2/6 FIXED, 1 REMAINING BLOCKER, 3 NON-ISSUES**

---

## Issue #1: Step 7 Field Name Mismatch ⚠️ CRITICAL BLOCKER

### Problem
```json
// Step 2 flatten output_schema (IntentContract)
{"id": "...", "emailId": "...", "filename": "..."}

// Step 6 usage (PILOT DSL)
{"message_id": "{{attachment.message_id}}", "attachment_id": "{{attachment.attachment_id}}"}
```

Fields don't exist → **runtime failure**.

### Root Cause
**IntentContract LLM generation** - The LLM doesn't have access to Gmail plugin's attachment schema, so it invented field names (`id`, `emailId`) instead of using the correct schema field names (`attachment_id`, `message_id`).

Gmail plugin schema defines attachments with:
- `attachment_id` (not `id`)
- `message_id` (not `emailId`)

But IntentContract Step 2 output_schema uses incorrect names.

### Why It Happens
The plugin vocabulary injected into the IntentContract prompt only includes high-level action descriptions, NOT detailed output schemas with field names. The LLM has no way to know what fields are available.

### Current Fix Applied
**Partial fix in prompt** (`lib/agentkit/v6/intent/intent-system-prompt-v2.ts` lines 313-330):
- Added guidance about checking nested array schemas when flattening
- Emphasized using exact field names from upstream sources

### Why This Fix Is Insufficient
The LLM still doesn't have **access** to the Gmail plugin schema during IntentContract generation. Prompt guidance can't fix missing information.

### Why This Causes Runtime Failure

The PILOT DSL is **compilation-correct** but **data-incorrect**:

1. IntentContract Step 2 (flatten) declares: `output_schema: {id, emailId, filename, ...}`
2. Compiler generates transform step that will produce data matching this schema
3. IntentContract Step (loop iteration) creates variable `attachment` from `invoice_attachments` array
4. IntentContract data_source step uses `inputs: ["attachment"]`
5. Compiler converts to `params.input_ref = "attachment"`
6. Compiler reads Gmail's `get_email_attachment` schema which has `x-variable-mapping`:
   ```json
   {
     "message_id": {"x-variable-mapping": {"field_path": "message_id"}},
     "attachment_id": {"x-variable-mapping": {"field_path": "attachment_id"}}
   }
   ```
7. Compiler generates: `{"message_id": "{{attachment.message_id}}"}`

**At runtime**:
- Transform Step 2 produces objects: `{id: "...", emailId: "...", filename: "..."}`
- Step 6 tries to evaluate: `{{attachment.message_id}}`
- **FAILS**: attachment object has no `message_id` field (it has `id` instead)

The compiler is doing its job correctly - the **problem is the mismatch between**:
- **What the transform promises to produce** (id, emailId)
- **What the downstream action expects** (message_id, attachment_id)

### Recommended Solution: Schema Cross-Validation

**Option A: Auto-fix in Compiler (Deterministic)**
Add cross-validation in IntentToIRConverter that:
1. After converting all steps, analyze data flow
2. When a transform's output feeds into an action with `x-variable-mapping`:
   - Check transform's output_schema field names
   - Compare to action's expected field names (from mapping.field_path)
   - If mismatch: **auto-correct the transform output_schema** to use correct field names
3. Alternatively: detect mismatch and fail with clear error message

**Option B: Inject Schemas into LLM Prompt**
Enhance vocabulary generation to include output schemas for bound actions.
- Pro: LLM generates correct names from the start
- Con: Token-expensive, may bloat prompts significantly

**Option C: Runtime Field Name Normalization**
Add fuzzy field matching at runtime (e.g., `id` → `attachment_id` if no exact match).
- Pro: Handles LLM variations gracefully
- Con: Adds runtime complexity, unclear error messages

**Option D: Hybrid Validation + Prompt Enhancement**
- Compiler validates and provides clear errors
- Enhance prompt with guidance (already done)
- Consider adding output schema samples to vocabulary

**Recommended: Option A** - Deterministic compiler fix that automatically corrects transform output_schemas to match what downstream actions expect. This is schema-driven, works for any plugin, and fixes the issue at compile-time.

---

## Issue #2: Step 3 Filter Condition Wrong Operator ✅ FIXED

### Problem
```json
// IntentContract (CORRECT)
{"comparator": "in", "right": {"value": [...]}}

// PILOT DSL (WAS WRONG)
{"operator": "eq", "value": [...]}  // Should be "in"
```

### Root Cause
**IntentToIRConverter line 1005** mapped `"in"` to `"eq"`.

### Fix Applied
Changed line 1005 in `lib/agentkit/v6/compiler/IntentToIRConverter.ts`:
```typescript
in: 'in',  // Was: in: 'eq'
```

### Verification
✅ Step 3 condition now shows: `"operator": "in"`

---

## Issue #3: Step 3 & 11 Filter Field Reference Wrong ✅ FIXED

### Problem
```json
// PILOT DSL (WAS WRONG)
{"field": "all_attachments.mimeType"}  // Points to whole array

// Should be (CORRECT)
{"field": "item.mimeType"}  // Points to current item in loop
```

### Root Cause
**ExecutionGraphCompiler** directly copied variable references without normalizing for filter context.

### Fix Applied
Modified `convertCondition` method in `lib/agentkit/v6/compiler/IntentToIRConverter.ts` (lines 954-1000):
- Added `options` parameter with `isFilterContext` and `inputVar`
- Detects when condition is part of a filter operation
- Converts `array_name.field` to `item.field` for filter contexts
- Updated call site (line 930) to pass filter context

### Verification
✅ Step 3 condition now shows: `"field": "item.mimeType"`
✅ Step 11 condition now shows: `"field": "item.amount"`

---

## Issue #4: Step 5 Hardcoded spreadsheet_id ✅ NOT AN ISSUE

### Problem Claim
```json
{"spreadsheet_id": "google_sheet_id", "parent_id": "google_sheet_id"}
```

Claimed these were literal strings instead of config references.

### Investigation
Checked current output:
- IntentContract: Uses structured `{"kind": "config", "key": "google_sheet_id"}`
- ExecutionGraph IR: Shows `"spreadsheet_id": "{{config.google_sheet_id}}"`
- PILOT DSL Step 15: Shows `"spreadsheet_id": "{{config.google_sheet_id}}"`
- PILOT DSL Step 18: Shows `"spreadsheet_id": "{{config.google_sheet_id}}"` and `"range": "{{config.sheet_tab_name}}"`

### Conclusion
✅ **Already working correctly**. The user's highlighted issue was from an older version or misunderstanding.

The compiler's `resolveValueRef` method (line 1042) correctly handles config references:
```typescript
case 'config':
  return `{{config.${valueRef.key}}}`
```

---

## Issue #5: Step 10 Required Fields Can Fail ⚠️ DESIGN DECISION

### Problem
Requires `drive_link`, but if Drive upload fails or doesn't return `web_view_link`, the map transform will fail.

### Analysis
This is a **workflow design decision**, not a compiler bug. Two approaches:

1. **Fail-fast** (current): Required fields are truly required
2. **Graceful degradation**: Add conditional before map to check if field exists

### Recommendation
**Current behavior is correct**. If Drive upload fails, the attachment processing failed. The runtime should handle this at the iteration level with proper error handling (e.g., collect successful items, log failures).

**No compiler changes needed**.

---

## Issue #6: Step 17 Range Parameter Format ✅ NOT AN ISSUE

### Problem Claim
Google Sheets append_rows using `"range": "{{config.sheet_tab_name}}"` might be wrong format.

### Investigation
Google Sheets plugin schema explicitly supports tab name only:
```json
{
  "range": {
    "description": "The sheet name or range where data should be appended (e.g., 'Sheet1' or 'Sheet1!A:D')"
  }
}
```

### Conclusion
✅ Using `"range": "{{config.sheet_tab_name}}"` is **valid per plugin schema**.

**No changes needed**.

---

## Summary

### Fixed (2/6)
✅ Issue #2: Filter operator mapping (`in` → `in`)
✅ Issue #3: Filter field context normalization (`array.field` → `item.field`)

### Critical Blocker (1/6)
⚠️ **Issue #1**: Field name mismatch - LLM lacks schema access, generates wrong field names

### Not Issues (3/6)
✅ Issue #4: Config references already working correctly
✅ Issue #5: Workflow design decision, runtime should handle
✅ Issue #6: Valid per plugin schema

---

## Immediate Action Required

**Fix Issue #1** with schema-driven compiler validation:

1. Add validation pass in IntentToIRConverter
2. Check flatten output_schema field names against source action schema
3. Auto-normalize common mismatches (id → attachment_id, emailId → message_id)
4. Provide clear errors for complex mismatches

**Implementation Location**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Method**: `convertTransform` - add schema validation after converting transform steps

**Files to Modify**:
- `lib/agentkit/v6/compiler/IntentToIRConverter.ts` - Add schema field validation
- Consider: `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts` - Add cross-node field reference validation

---

## Why This Approach Follows CLAUDE.md Principles

✅ **No Hardcoding**: Validation uses plugin schemas as source of truth, not hardcoded rules
✅ **Fix at Root Cause**: Compiler is responsible for schema validation, not prompts
✅ **Schema-Driven**: Uses existing plugin schemas to detect mismatches
✅ **Scalable**: Works for ANY plugin, not just Gmail

The solution is **deterministic compiler validation**, not prompt engineering.
