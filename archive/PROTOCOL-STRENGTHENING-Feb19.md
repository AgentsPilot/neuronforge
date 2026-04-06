# Data Flow Reasoning Protocol - Strengthening (Feb 19, 2026)

**Status:** Protocol 5 strengthened after test failure
**Test Result:** Transform bug still occurred despite initial protocol
**Action Taken:** Added explicit "STOP and CHECK" validation steps

---

## Test Result Analysis

### Bug That Occurred

```
Transform node 'record_transaction_under_50' uses operation 'map' which requires array input,
but variable 'extracted_data' is declared as type 'object'
```

**IR Generated:**
```json
{
  "variables": [
    {"name": "extracted_data", "type": "object", "scope": "loop"}
  ],
  "nodes": {
    "record_transaction_under_50": {
      "type": "operation",
      "operation_type": "transform",
      "transform": {
        "type": "map",  // ❌ Requires array!
        "input": "{{extracted_data}}"  // ❌ Is object!
      }
    }
  }
}
```

**Why This Failed:**
- Protocol 5 existed but LLM didn't follow it
- Wording wasn't strong enough ("understand", "validate")
- No explicit "STOP and CHECK" command
- No example of this exact bug pattern

---

## Strengthening Changes Made

### Change #1: Added Mandatory Validation Header

**Before:**
```markdown
**Before generating ANY node configuration, you MUST validate data flow using these protocols.**
```

**After:**
```markdown
🛑 MANDATORY VALIDATION: Before generating ANY node configuration, you MUST:
1. STOP and read the relevant protocol below
2. Follow the validation steps EXACTLY
3. Check schemas and variable declarations BEFORE generating
4. If validation fails → FIX the issue, do NOT generate incorrect IR
```

**Why:** More forceful, action-oriented language

---

### Change #2: Added "STOP! Check variable type" Step

**Before Protocol 5 STEP 2:**
```markdown
**STEP 2: Validate input/output types**
- Input MUST be array (except flatten)
```

**After Protocol 5 STEP 2:**
```markdown
**STEP 2: STOP! Check the input variable type in your variables declaration**
- BEFORE writing "transform": {"type": "map", ...}
- GO TO the variables array
- FIND the input variable you're using
- CHECK its declared type
- If type is NOT "array" → DO NOT use map/filter/reduce/deduplicate/sort/group_by!
```

**Why:** Explicit command to STOP and look up variable declaration

---

### Change #3: Added Validation Checklist Example

**New addition:**
```markdown
Example validation checklist:

Planning to use: "transform": {"type": "map", "input": "{{extracted_data}}"}

STOP! Check variable declaration:
1. Find in variables array: {"name": "extracted_data", "type": "object", ...}
2. Variable type is "object"
3. Map requires "array" input
4. ❌ CANNOT use map transform
5. ✅ OPTIONS:
   - If extracted_data should be array → FIX variable declaration type
   - If extracted_data is truly object → DON'T use transform, use direct variable reference
```

**Why:** Shows EXACT steps to follow for validation

---

### Change #4: Added Real Bug Example

**Replaced generic "Map Transform" example with:**

❌ **WRONG (using map on object variable):**
```json
// Variable declaration shows this is an OBJECT:
{"name": "extracted_data", "type": "object", "scope": "loop"}

// ❌ WRONG - Cannot use map on object!
{
  "step_id": "record_transaction",
  "type": "operation",
  "operation_type": "transform",
  "transform": {
    "type": "map",  // ❌ Map requires ARRAY input!
    "input": "{{extracted_data}}"  // ❌ This is type "object"!
  }
}
// Compilation will FAIL: "map requires array input, but extracted_data is object"
```

✅ **CORRECT (validated variable type first):**
```json
// Variable declaration shows this is an ARRAY:
{"name": "raw_items", "type": "array", "scope": "global"}

// ✅ CORRECT - Map on array variable
{
  "operation": {
    "operation_type": "transform",
    "transform": {
      "type": "map",
      "input": "{{raw_items}}",  // ✅ Type is "array"
    }
  }
}
```

**Why:** Shows the EXACT bug that just occurred and how to avoid it

---

### Change #5: Added 🛑 CRITICAL Warning

**Added to Protocol 5 header:**
```markdown
🛑 CRITICAL: Before generating ANY transform operation, you MUST validate the input variable type!
```

**Why:** Visual indicator that this is non-negotiable

---

## Expected Impact

### Before Strengthening:
- LLM read Protocol 5 but didn't follow validation steps
- Generated `map` transform without checking variable type
- Compilation failed with type mismatch error

### After Strengthening:
- **STOP** command forces LLM to pause
- **Validation checklist** provides exact steps
- **Real bug example** shows consequences of skipping validation
- **🛑 symbols** make it visually impossible to miss

---

## Next Test

**Action:** Regenerate IR for the same invoice workflow

**Expected Outcome:**
1. LLM reads strengthened Protocol 5
2. When planning `record_transaction_under_50` node:
   - STOPS at Protocol 5 STEP 2
   - Checks `extracted_data` variable declaration
   - Sees it's type "object"
   - Recognizes map requires type "array"
   - Does NOT generate map transform
   - Either:
     - Fixes variable declaration to array, OR
     - Skips transform and uses direct variable reference

**Success Criteria:**
- ✅ NO "map requires array" compilation error
- ✅ All variables used in transforms match required types
- ✅ IR compiles successfully

---

## Other Bugs to Check

After regeneration, also verify:

1. **Bug #1 (scope):** `{{current_email.message_id}}` (not `current_attachment.message_id`)
2. **Bug #2 (field name):** `{{attachment_content.data}}` (not `extracted_text`)
3. **Bug #3 & #4 (AI metadata):** AI output_schema has NO `drive_link`, `source_sender`, etc.

---

## If Bug Still Occurs

### Possible Reasons:
1. LLM still skipping validation steps (need even stronger language)
2. Validation steps are unclear (need simpler instructions)
3. Example doesn't match the exact scenario (need more examples)

### Next Strengthening Options:
1. Add "DO NOT PROCEED" before each transform generation
2. Require LLM to "show your validation work" in IR comments
3. Add pre-validation checklist that must be completed
4. Make Protocol 5 the FIRST section (before other protocols)
5. Add repetition: "Check type BEFORE generating transform"

---

## Files Modified

1. **formalization-system-v4.md** (lines 54-441)
   - Added mandatory validation header
   - Strengthened Protocol 5 with STOP command
   - Added validation checklist example
   - Added real bug example

---

## Timeline

- **11:58 AM:** Initial Data Flow Reasoning Protocol inserted
- **5:24 PM:** Test run - transform bug still occurred
- **5:26 PM:** Protocol 5 strengthened with STOP commands and real bug example
- **Next:** Regenerate IR and test again

---

## Success Metrics

**Current state:**
- Transform bug: ❌ OCCURRING (map on object)
- Compilation: ❌ FAILING

**Target state:**
- Transform bug: ✅ FIXED (no map on object)
- Compilation: ✅ PASSING
- IR quality: ✅ ALL variables properly typed

---

## Learning

**Key insight:** Protocols need to be IMPERATIVE, not descriptive.

**Ineffective language:**
- "Validate input/output types"
- "Understand transform capabilities"
- "Ensure correct types"

**Effective language:**
- "🛑 STOP! Check the input variable type"
- "BEFORE writing transform, GO TO variables array"
- "If type is NOT array → DO NOT use map"

**The difference:** Commands that force action vs suggestions that can be ignored.
