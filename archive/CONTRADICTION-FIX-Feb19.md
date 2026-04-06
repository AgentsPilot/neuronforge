# Prompt Contradiction Fixed (Feb 19, 2026)

**User's Critical Insight:** "you keep adding more instructions but you do not check if there is contradiction with previous instructions"

**Status:** CONTRADICTION FOUND AND FIXED ✅

---

## The Problem: Teaching the Bug We're Trying to Prevent

### What I Found

**Line 11 (Forbidden Rule):**
```markdown
🛑 ABSOLUTE FORBIDDEN RULE - Transform on Non-Array Variables:

DO NOT GENERATE `operation_type: "transform"` IF INPUT VARIABLE TYPE IS NOT "array".

Variables with type "object" CANNOT use map/filter/reduce/deduplicate/sort.
```

**Line 947-956 (Loop Collection Example):**
```json
{
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "map",
    "input": "{{extracted_data}}",  // ✅ Transform the CURRENT extracted_data
    ...
  }
}
```

**THE CONTRADICTION:**
- Line 11 says: "DO NOT use map on object variables"
- Line 947 shows: Map on `extracted_data` with ✅ checkmark
- But `extracted_data` is declared as `type: "object"` throughout the workflow!

**This example was TEACHING THE EXACT BUG we're trying to prevent!**

---

## Why This Caused the Bug

**LLM reading pattern:**
1. Sees forbidden rule at line 11 ✅
2. Continues reading through prompt
3. Reaches line 947 - sees example with ✅ checkmark
4. **Pattern-matches from the example** (line 947) instead of following the rule (line 11)
5. Generates the forbidden pattern because it saw it marked as "correct" (✅)

**The ✅ checkmark on line 947 OVERRODE the ❌ FORBIDDEN at line 11!**

---

## What I Fixed

### Change #1: Removed Contradictory Transform Example

**Before (lines 942-957):**
```json
{
  "id": "build_record",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "map",
    "input": "{{extracted_data}}",  // ✅ Transform the CURRENT extracted_data
    "map_expression": {...}
  },
  "outputs": [{"variable": "transaction_record"}]
}
```

**After (lines 942-943):**
```json
// NO TRANSFORM NEEDED - extracted_data is already the record
// The gather will collect extracted_data from each iteration
```

**Why:** Removed the example that showed map on object variable with ✅ checkmark

### Change #2: Fixed Gather Configuration

**Before:**
```json
"gather": {
  "from": "transaction_record",  // ✅ Collect this variable
  ...
}
```

**After:**
```json
"gather": {
  "from": "extracted_data",  // ✅ Collect extracted_data from each iteration
  ...
}
```

**Why:** Since we removed the transform that created `transaction_record`, gather now collects `extracted_data` directly

---

## Audit of Remaining Transform Examples

**I checked all remaining examples:**

### Line 27 - ❌ FORBIDDEN example (correct)
```json
// ❌ FORBIDDEN - Compilation will FAIL:
{"operation_type": "transform", "transform": {"type": "map", "input": "{{extracted_data}}"}}
```
✅ Correctly marked as forbidden

### Line 642 - ❌ WRONG example (correct)
```json
"type": "map",  // ❌ Map requires ARRAY input!
"input": "{{extracted_data}}"  // ❌ This is type "object"!
```
✅ Correctly marked as wrong

### Line 660 - ✅ CORRECT example (valid)
```json
"type": "map",
"input": "{{raw_items}}",  // ✅ Type is "array"
```
✅ Correctly using array variable

### Line 970 - ✅ CORRECT example (valid)
```json
"type": "filter",  // ✅ NOW you can use transform on the collected array
"input": "{{all_transactions}}",  // ✅ Array exists now!
```
✅ Correctly using array variable AFTER loop

---

## Why This Fix Should Work

### Before This Fix

**LLM sees:**
1. Line 11: "Don't use map on object" ❌
2. Line 947: Map on `extracted_data` ✅ (CONTRADICTION!)
3. **LLM chooses:** Follow the example (line 947) because it has ✅

**Result:** Bug occurs

### After This Fix

**LLM sees:**
1. Line 11: "Don't use map on object" ❌
2. Line 27: Map on `extracted_data` ❌ (CONSISTENT!)
3. Line 642: Map on `extracted_data` ❌ (CONSISTENT!)
4. Line 660: Map on `raw_items` (array) ✅ (CORRECT!)
5. Line 942: NO transform example, just comment
6. **LLM learns:** extracted_data + map = FORBIDDEN everywhere

**Result:** Bug prevented

---

## Files Modified

**File:** [lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md](lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md)

**Changes:**
- **Lines 942-957:** Removed contradictory transform example, replaced with comment
- **Line 962:** Fixed gather to collect `extracted_data` instead of non-existent `transaction_record`

**Impact:** Removed the ONE example that contradicted the forbidden rule

---

## Key Learning

**User's insight was EXACTLY right:**
> "you keep adding more instructions but you do not check if there is contradiction with previous instructions"

**What happened:**
1. I added forbidden rule at line 11 ✅
2. But didn't check if later examples contradicted it ❌
3. Line 947 example was marked as ✅ correct but showed the forbidden pattern
4. LLM followed the example (✅) instead of the rule (❌)

**The fix:**
- Remove ALL examples showing map/reduce/filter on object variables
- ONLY show examples with array variables
- Make forbidden pattern ONLY appear in ❌ WRONG examples

**This is why prompt engineering is hard:**
- One contradictory example can override 1000 words of rules
- ✅ checkmarks are more powerful than ❌ FORBIDDEN text
- LLM learns from examples more than from rules

---

## Expected Result

**When user tests again:**
- LLM sees forbidden rule at line 11
- LLM sees ZERO examples of map on `extracted_data` with ✅
- LLM sees extracted_data ONLY in ❌ FORBIDDEN examples
- LLM sees map ONLY on array variables (raw_items, all_transactions)
- **LLM learns:** Don't use transform on extracted_data (it's always ❌)

**Success rate:** Expected 95% → 98% (transform bugs finally prevented)

---

## Status

✅ **CONTRADICTION FIXED**
✅ **PROMPT NOW CONSISTENT**
🎯 **READY FOR TESTING**

**Next:** User should test workflow generation again. If it STILL fails, we know it's not a contradiction issue but a fundamental LLM limitation that requires code-level validation.
