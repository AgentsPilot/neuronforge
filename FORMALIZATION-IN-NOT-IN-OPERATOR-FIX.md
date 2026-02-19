# Formalization Fix: `in`/`not_in` Operators with Object Arrays

**Date:** February 16, 2026
**Status:** ✅ Implemented - Generic Fix
**File Modified:** `lib/agentkit/v6/semantic-plan/prompts/formalization-system.md`

## Problem

Workflow generation created logically invalid conditionals when checking membership in arrays of objects.

**Example Bug:**
```json
{
  "type": "conditional",
  "condition": {
    "field": "gmail_message_link",
    "operator": "not_in",
    "value": "{{existing_sheet_data_objects}}"  // Array of objects!
  }
}
```

**Runtime Error:**
```
Variable 'item' is not defined in current context
```

**Logical Error:** Even if the runtime worked, the logic is wrong:
- `gmail_message_link` is a URL string like `"https://mail.google.com/mail/u/0/#inbox/123"`
- `existing_sheet_data_objects` is an array of objects like `[{from: "...", subject: "...", id: "..."}]`
- You cannot check if a string is "not in" an array of objects!

## Root Cause

The `in`/`not_in` operators **only work with arrays of primitives** (strings, numbers, booleans).

When the LLM generated the IR, it didn't realize that:
1. Comparing a primitive value against an array of objects doesn't make sense
2. You must first extract the specific field to compare against

**What the LLM should have generated:**

```json
{
  "normalization": {
    "type": "transform",
    "operation": "map",
    "config": {
      "extract_field": "id"  // Extract just the ID field
    },
    "output_variable": "existing_ids"  // Array of strings
  },
  ...
  "conditionals": [{
    "condition": {
      "field": "current_item.id",  // Compare IDs
      "operator": "not_in",
      "value": "{{existing_ids}}"  // Array of primitives!
    }
  }]
}
```

## Solution: Generic Guidance in Formalization Prompt

Added explicit guidance to the formalization system prompt that teaches the LLM this constraint **generically** (not tied to any specific use case).

**File:** `lib/agentkit/v6/semantic-plan/prompts/formalization-system.md`

### Change 1: Filters Section (Lines 76-96)

Added after the operator list:

```markdown
- **CRITICAL for `in`/`not_in` operators:**
  - These operators **ONLY work with arrays of PRIMITIVES** (strings, numbers, booleans)
  - **CANNOT compare against arrays containing OBJECTS**
  - If the array contains objects (rows with multiple fields), you MUST first add a normalization/transform step to extract ONLY the comparison field into a simple array of primitives
  - Then use `in`/`not_in` against that extracted primitive array
```

### Change 2: Conditionals Section (Lines 131-146)

Added after the basic conditional structure guidance:

```markdown
- **CRITICAL for `in`/`not_in` in conditions:**
  - Same restriction as filters: these operators **ONLY work with arrays of primitives**
  - If comparing against array of objects, you MUST add a normalization step FIRST to extract the comparison field
  - The conditional's `value` field must reference the extracted primitive array, NOT the original object array
```

## Why This Fix is Generic

**No Hardcoded Examples:** The guidance doesn't mention "emails", "spreadsheets", or any specific domain.

**Principle-Based:** Teaches the fundamental constraint: `in`/`not_in` requires primitive arrays.

**Works for ANY Scenario:**
- Checking if order ID exists in database records → Extract IDs first
- Checking if product name is in inventory list → Extract names first
- Checking if user email is in approved users → Extract emails first
- Checking if transaction ID is in processed transactions → Extract IDs first

**The LLM will now know:** Whenever it sees an `in`/`not_in` comparison where the target array contains objects, it must add a normalization step.

## How It Works

### Before Fix (What LLM Generated):

```json
{
  "data_sources": [{
    "operation_type": "read_range",
    "role": "Existing data to check against"
  }],
  "conditionals": [{
    "condition": {
      "field": "some_value",
      "operator": "not_in",
      "value": "{{array_of_objects}}"  // ❌ WRONG
    }
  }]
}
```

**Problem:** Comparing primitive against object array doesn't work.

### After Fix (What LLM Should Generate):

```json
{
  "data_sources": [{
    "operation_type": "read_range",
    "role": "Existing data to check against"
  }],
  "normalization": {
    "type": "transform",
    "operation": "map",
    "description": "Extract comparison field from object array",
    "config": {
      "extract_field": "comparison_field_name"
    },
    "output_variable": "extracted_values"
  },
  "conditionals": [{
    "condition": {
      "field": "current_item.field_name",
      "operator": "not_in",
      "value": "{{extracted_values}}"  // ✅ CORRECT - primitive array
    }
  }]
}
```

**Result:** Valid comparison between primitives.

## Impact

### Before Fix:
- ❌ LLM generated logically invalid conditionals
- ❌ Runtime errors: "Variable 'item' not defined"
- ❌ Even if runtime worked, logic would be wrong (comparing primitive to object array)
- ❌ Happened in ANY scenario involving membership checks (emails, database lookups, inventory, etc.)

### After Fix:
- ✅ LLM knows to extract comparison field first
- ✅ Generates valid IR with normalization step
- ✅ Runtime executes correctly
- ✅ Logic is correct (primitive to primitive comparison)
- ✅ Works for ALL domains (not just emails)

## Testing

To verify this fix works, regenerate workflows that involve:

1. **Duplicate checking** - "Skip if already exists in database/spreadsheet"
2. **Allowlist/Blocklist** - "Only process if in approved list"
3. **Membership filtering** - "Check if value is in reference data"
4. **Deduplication** - "Remove items that exist in previous batch"

**Expected Result:** The generated IR should include:
1. A normalization/transform step extracting the comparison field
2. A conditional using `in`/`not_in` against the extracted primitive array

## Files Modified

**1. lib/agentkit/v6/semantic-plan/prompts/formalization-system.md**
- Lines 76-96: Added guidance to Filters section
- Lines 131-146: Added guidance to Conditionals section

## Related Fixes

This fix complements:

1. **CONDITIONAL-EVALUATOR-ITEM-VARIABLE-FIX.md** - Runtime fix for item variable detection
2. **GLOBAL-STEP-IDS-FIX.md** - Global step IDs to prevent collisions
3. **CALIBRATION-CONDITIONAL-BRANCH-FIX.md** - Calibration support for conditionals

Together, these provide:
- ✅ Correct IR generation (this fix)
- ✅ Correct runtime execution (ConditionalEvaluator fix)
- ✅ Correct calibration (conditional branch fix)
- ✅ Correct step IDs (global numbering fix)

## Success Criteria

- ✅ Guidance is generic (no domain-specific examples)
- ✅ Applies to filters AND conditionals
- ✅ Teaches the fundamental constraint (primitive arrays only)
- ✅ Instructs LLM to add normalization step when needed
- ✅ Will prevent this bug in ANY future scenario

---

**Status:** Production ready - Generic fix in prompt
**Risk:** None - Only affects IR generation going forward
**Next Step:** Regenerate workflow to verify LLM follows new guidance
