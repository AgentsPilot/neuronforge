# Filter Operation Generation Bug - Wrong Transform Type

**Date:** February 17, 2026
**Severity:** 🔴 CRITICAL
**Type:** Workflow Generation Bug
**Impact:** Filtering logic not applied - all items pass through instead of filtered subset

---

## Problem Statement

The workflow is appending ALL emails from Gmail search instead of only emails containing the user-specified keywords (`angry`, `refund`, `complaint`, `not working`).

**User Observation:**
> "only one of them is with the parameter angry"

Out of 10 emails appended, only 1 actually contains "angry" in the snippet. The other 9 should have been filtered out.

**Root Cause:** Step 4 uses `"operation": "set"` instead of `"operation": "filter"`, causing the condition logic to be ignored.

---

## Current Workflow (BROKEN)

### Step 4 - Transform with "set" operation
```json
{
  "id": "step4",
  "name": "Transform",
  "type": "transform",
  "operation": "set",  // ❌ WRONG - "set" doesn't apply conditions!
  "input": "{{gmail_results.emails}}",
  "config": {
    "condition": {
      "conditionType": "complex_or",
      "conditions": [
        { "field": "snippet", "operator": "contains", "value": "{{input.value_complaint}}" },
        { "field": "snippet", "operator": "contains", "value": "{{input.value_refund}}" },
        { "field": "snippet", "operator": "contains", "value": "{{input.value_angry}}" },
        { "field": "snippet", "operator": "contains", "value": "{{input.value_not_working}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_complaint}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_refund}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_angry}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_not_working}}" }
      ]
    }
  },
  "output_variable": "complaint_emails"
}
```

### What "set" Operation Does

The `set` transform operation **assigns a value** to the output. It does NOT filter items based on a condition.

**From the code:**
```typescript
case 'set':
  // Just returns the input as-is
  return input;
```

The `config.condition` is **completely ignored** by the `set` operation!

**Result:** All 10 emails from Gmail search are passed through to `complaint_emails`, regardless of whether they contain the keywords.

---

## Expected Workflow (FIXED)

### Step 4 - Transform with "filter" operation
```json
{
  "id": "step4",
  "name": "Filter Emails",
  "type": "transform",
  "operation": "filter",  // ✅ CORRECT - "filter" applies the condition!
  "input": "{{gmail_results.emails}}",
  "config": {
    "condition": {
      "conditionType": "complex_or",
      "conditions": [
        { "field": "snippet", "operator": "contains", "value": "{{input.value_complaint}}" },
        { "field": "snippet", "operator": "contains", "value": "{{input.value_refund}}" },
        { "field": "snippet", "operator": "contains", "value": "{{input.value_angry}}" },
        { "field": "snippet", "operator": "contains", "value": "{{input.value_not_working}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_complaint}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_refund}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_angry}}" },
        { "field": "subject", "operator": "contains", "value": "{{input.value_not_working}}" }
      ]
    }
  },
  "output_variable": "complaint_emails"
}
```

### What "filter" Operation Does

The `filter` transform operation **evaluates the condition for each item** and only keeps items where the condition returns `true`.

**Expected flow:**
1. Gmail returns 10 emails
2. Filter checks each email:
   - Email 1: snippet contains "angry"? NO. Subject contains "angry"? NO. Skip all other keywords? NO → **FILTERED OUT**
   - Email 2: snippet contains "angry"? YES → **KEPT** ✅
   - Email 3: snippet contains "refund"? NO. Subject contains any keyword? NO → **FILTERED OUT**
   - ... (and so on)
3. Only emails matching at least one keyword are kept

**Result:** Only 1 email (the one with "angry") passes the filter and gets appended to the sheet ✅

---

## Why This Bug Happened

The LLM workflow generator made an incorrect operation type selection:

**What the LLM should have done:**
1. Recognize that user wants to filter emails by keywords
2. Generate a `transform` step with `operation: "filter"`
3. Include the condition config with OR logic for all keywords

**What the LLM actually did:**
1. Recognized the need to filter emails ✅
2. Generated correct condition config with OR logic ✅
3. **BUT** used `operation: "set"` instead of `"filter"` ❌

**Possible reasons:**
- LLM confused "set the filtered emails" (intent) with "set operation" (implementation)
- Prompt doesn't clearly distinguish when to use `filter` vs `set`
- Training data may have examples using `set` incorrectly

---

## Fix Required

### Immediate Fix (Manual)
Change Step 4's operation from `"set"` to `"filter"` in the workflow JSON.

### Long-Term Fix (Prompt Engineering)
Add clear guidance to the formalization prompt about when to use each transform operation:

**Transform Operations:**
- `filter` - Keep only items matching a condition (returns subset of input array)
- `map` - Transform each item (returns array of same length with modified items)
- `set` - Assign a static value or variable reference (NOT for filtering!)
- `rows_to_objects` - Convert 2D array to array of objects

**When to use `filter`:**
- User wants to "filter", "find", "keep only", "remove", "exclude"
- Condition should be evaluated for each item
- Output is a subset of input

**When to use `set`:**
- Assign a constant value
- Rename/copy a variable
- Extract a field from an object (NOT an array)

---

## Impact Assessment

### Before Fix
- ❌ All 10 emails appended to sheet (100% false positives)
- ❌ Sheet fills with irrelevant data
- ❌ User gets notifications for non-complaint emails
- ❌ Filtering logic completely ignored

### After Fix
- ✅ Only 1 email appended (the one with "angry")
- ✅ Sheet contains only relevant complaint emails
- ✅ User only notified about actual complaints
- ✅ Filtering logic works as intended

---

## Related Issues

This is the **third workflow generation issue** we've found:

1. **Duplicate Detection Prompt Fix** - LLM generating `values[-1]` instead of `values[*][4]`
2. **Loop Wrapped Output Fix** - LLM not using `path` navigation for nested arrays
3. **Filter Operation Bug** (THIS ISSUE) - LLM using `set` instead of `filter`

**Common Pattern:** LLM generates structurally correct workflow with correct condition logic, but chooses **wrong operation type or syntax**.

**Solution:** More explicit prompt guidance about operation type selection, with clear ❌ WRONG vs ✅ CORRECT examples.

---

## Recommended Prompt Addition

Add to `formalization-system-v4.md` after transform operations section:

### 🔴 CRITICAL: Transform Operation Selection

**COMMON BUG PATTERN:** Using `set` operation when `filter` is needed.

#### ❌ WRONG - Using "set" with condition

```json
{
  "type": "transform",
  "operation": "set",  // ❌ WRONG - "set" ignores conditions!
  "input": "{{items}}",
  "config": {
    "condition": {
      "field": "status",
      "operator": "eq",
      "value": "active"
    }
  }
}
```

**Why this is WRONG:**
- `set` operation does NOT evaluate conditions
- Condition config is ignored completely
- All items pass through unfiltered

#### ✅ CORRECT - Using "filter" with condition

```json
{
  "type": "transform",
  "operation": "filter",  // ✅ CORRECT - "filter" applies condition!
  "input": "{{items}}",
  "config": {
    "condition": {
      "field": "status",
      "operator": "eq",
      "value": "active"
    }
  }
}
```

**Why this is CORRECT:**
- `filter` evaluates condition for each item
- Only items where condition returns true are kept
- Output is filtered subset of input

#### Operation Selection Rules

**Use `filter` when:**
- User wants to keep only items matching criteria
- Keywords: "filter", "find", "keep only", "where", "matching"
- Condition should be evaluated per item
- Output is subset of input array

**Use `map` when:**
- User wants to transform/modify each item
- Keywords: "transform", "convert", "extract fields", "calculate"
- Same number of output items as input
- Each output item derived from corresponding input item

**Use `set` when:**
- Assigning a static value or simple variable reference
- NO per-item evaluation needed
- Extracting a field from a single object (not array)
- Renaming/copying a variable

---

**Status:** Bug Identified - Needs Manual Fix
**Risk:** High - Completely breaks filtering functionality
**Recommendation:** Fix immediately in current workflow, add prompt guidance to prevent future occurrences

**Bug identified:** February 17, 2026
**Fix type:** Change `"operation": "set"` to `"operation": "filter"` in Step 4
