# Next Steps: Testing Data Flow Reasoning Protocol

**Date:** February 19, 2026
**Status:** Implementation Complete - Ready for Testing

---

## Current State

### ✅ COMPLETED (Day 1)
- Data Flow Reasoning Protocol inserted into formalization-system-v4.md
- 5 validation protocols added (Field Reference, Variable Scope, AI Boundaries, File Operations, Transforms)
- Cross-references added to link with existing sections
- Backup created
- Analysis completed showing no conflicts with existing instructions

### 🎯 NEXT: Day 2 Testing

**The error log you showed indicates the IR was generated BEFORE the new protocols were added.**

The error:
```
Transform node 'record_transaction_under_50' uses operation 'map' which requires array input,
but variable 'extracted_data' is declared as type 'object'
```

**This is EXACTLY the bug that Protocol 5 should prevent!**

---

## Day 2 Testing Plan

### Test Setup

**Goal:** Verify that new Data Flow Reasoning Protocol fixes all 4 bugs

**Test Workflow:** Invoice extraction from Gmail attachments (your exact Enhanced Prompt)

### Expected Bug Fixes

**Bug #1: Variable Scope Error**
- **Before:** `{{current_attachment.message_id}}` (wrong scope - attachment doesn't have message_id)
- **After:** `{{current_email.message_id}}` (correct scope - email has message_id)
- **Fixed by:** Protocol 1 (Field Reference Validation) + Protocol 2 (Variable Scope Resolution)

**Bug #2: Wrong Field Name**
- **Before:** `{{attachment_content.extracted_text}}` (field doesn't exist)
- **After:** `{{attachment_content.data}}` (correct field name from schema)
- **Fixed by:** Protocol 4 (File Operation Output Validation)

**Bug #3 & #4: AI Metadata Fields**
- **Before:** AI output_schema includes `drive_link`, `source_sender`, `source_subject`, `filename`
- **After:** AI output_schema has ONLY extractable fields (`vendor`, `amount`, `date`, etc.)
- **Fixed by:** Protocol 3 (AI Operation Boundaries)

**Additional Bug (from your log): Transform Type Mismatch**
- **Before:** `map` transform used on `object` variable
- **After:** Should detect that `extracted_data` is object, not array - either change variable type or use different operation
- **Fixed by:** Protocol 5 (Transform Operation Validation)

---

## How to Test

### Step 1: Clear any cached workflows

Ensure the system is using the NEW formalization-system-v4.md (with Data Flow Reasoning Protocol)

### Step 2: Generate IR for invoice workflow

Use your existing Enhanced Prompt for the invoice extraction workflow.

The IRFormalizer should now:
1. **Read the Data Flow Reasoning Protocol** (lines 54-441)
2. **Apply validation protocols** before generating each node
3. **Generate correct IR** with:
   - Correct variable scopes (Protocol 2)
   - Correct field references (Protocol 1)
   - AI output schema WITHOUT metadata (Protocol 3)
   - Correct file operation field names (Protocol 4)
   - Correct transform operations (Protocol 5)

### Step 3: Inspect Generated IR

Check for:

**✅ Field References:**
```json
// Should use current_email.message_id (not current_attachment.message_id)
{
  "step_id": "mark_processed",
  "config": {
    "message_id": "{{current_email.message_id}}"  // ✅ Correct scope
  }
}
```

**✅ File Operation Fields:**
```json
// Should use attachment_content.data (not extracted_text)
{
  "step_id": "extract_invoice",
  "ai": {
    "input": "{{attachment_content.data}}"  // ✅ Correct field name
  }
}
```

**✅ AI Output Schema:**
```json
// Should NOT include drive_link, source_sender, etc.
{
  "step_id": "extract_invoice",
  "ai": {
    "output_schema": {
      "properties": {
        "vendor": {...},
        "amount": {...},
        "date": {...}
        // ✅ NO drive_link, NO source_sender, NO filename
      }
    }
  }
}
```

**✅ Transform Operations:**
```json
// Should NOT use map on object variables
{
  "step_id": "record_transaction",
  // If extracted_data is object, should NOT have map transform
  // OR variable declaration should be array type
}
```

### Step 4: Verify Compilation Success

After IR generation, compilation should:
- ✅ NOT fail with "field doesn't exist" errors
- ✅ NOT fail with "variable scope" errors
- ✅ NOT fail with "map requires array" errors
- ✅ Successfully compile to DSL

### Step 5: Execute Workflow

After successful compilation:
- ✅ Workflow should execute without runtime errors
- ✅ Variables should resolve correctly (no undefined references)
- ✅ Data should flow correctly through all nodes

---

## Debugging If Bugs Still Occur

### If Bug #1 Still Occurs (scope error):

**Check:**
1. Is IRFormalizer loading the NEW prompt? (Check file timestamp)
2. Is Protocol 2 being applied? (Add logging to see if LLM is reading the protocol)
3. Does the LLM's response show it followed the 4-step validation?

**Possible fixes:**
- Strengthen Protocol 2 wording with more explicit examples
- Add a "STOP and validate" checkpoint before each node generation

### If Bug #2 Still Occurs (wrong field name):

**Check:**
1. Is Protocol 4 being applied?
2. Did the LLM check the file operation output_schema?
3. Is the plugin schema accessible in the prompt context?

**Possible fixes:**
- Add more explicit "CHECK THE SCHEMA" reminders
- Show exact schema lookup process in Protocol 4

### If Bug #3 & #4 Still Occur (AI metadata):

**Check:**
1. Is Protocol 3 being applied?
2. Did the LLM categorize each field (AI-extractable vs metadata)?
3. Are the examples clear enough?

**Possible fixes:**
- Add more metadata field examples (webViewLink, folder_id, etc.)
- Strengthen the "AI CANNOT access workflow state" principle

### If Transform Bug Still Occurs:

**Check:**
1. Is Protocol 5 being applied?
2. Did the LLM check the variable type before choosing transform operation?
3. Is the variable declaration correct?

**Possible fixes:**
- Add more examples of transform type mismatches
- Strengthen validation for variable type vs operation type compatibility

---

## Success Criteria

### Immediate Success (Day 2)
- [ ] Bug #1 fixed: No scope errors in generated IR
- [ ] Bug #2 fixed: Correct field names used (attachment_content.data)
- [ ] Bug #3 & #4 fixed: AI output schema has NO metadata fields
- [ ] Transform bug fixed: No map on object variables
- [ ] IR compiles successfully (no compilation errors)
- [ ] Workflow executes successfully

### If ANY bugs persist:
- [ ] Analyze WHY the protocol didn't prevent it
- [ ] Strengthen protocol wording
- [ ] Add more explicit validation checkpoints
- [ ] Re-test

---

## Your Error Log Analysis

**From the error log you showed:**

```
Transform record_transaction_under_50 appears unnecessary: map operation requires array input,
but 'extracted_data' is object
```

**This tells us:**

1. ✅ **Compiler caught the error** (good - validation is working)
2. ❌ **IR generation created the bug** (bad - protocols should have prevented this)
3. 🎯 **This IR was likely generated BEFORE the new protocols were added**

**Protocol 5 should prevent this by:**

```
STEP 1: Understand transform type capabilities
- map: Transform each item in array → Output: array (same length)

STEP 2: Validate input/output types
- Input MUST be array

STEP 3: Before using map transform, CHECK:
- Is the input variable type "array"?
- If not, use a different operation or fix variable declaration
```

**If this bug still occurs AFTER regenerating with new prompt:**
- We need to strengthen Protocol 5 with more explicit "STOP and check variable type" language
- Add a validation checklist that LLM MUST complete before generating transform nodes

---

## Recommended Immediate Action

**1. Regenerate the IR using the NEW formalization-system-v4.md**

This will test if the Data Flow Reasoning Protocol prevents the bugs.

**2. Check the generated IR for all 5 bugs:**
- Bug #1: Scope errors
- Bug #2: Wrong field names
- Bug #3 & #4: AI metadata fields
- Bug #5: Transform type mismatches (like the map on object error)

**3. If bugs are fixed:**
- ✅ Proceed to Day 3-4 testing (diverse workflows)
- ✅ Document which protocols successfully prevented which bugs

**4. If bugs persist:**
- ❌ Analyze WHY the protocol didn't work
- ❌ Strengthen protocol wording
- ❌ Add more explicit validation steps
- ❌ Re-test

---

## Expected Outcome

**With Data Flow Reasoning Protocol:**
- LLM should VALIDATE before generating each node
- Protocols act as checklists that force schema lookups
- Bugs should be PREVENTED at IR generation time (not caught at compilation)

**Without Data Flow Reasoning Protocol:**
- LLM pattern-matches from examples
- Bugs slip through to compilation
- Compiler catches some bugs, but after wasted LLM time

**The goal:** Move bug detection from COMPILATION TIME to GENERATION TIME via systematic validation.

---

## Next Communication

After you regenerate the IR with the new prompt, please share:

1. **Did all 5 bugs get fixed?**
   - Scope errors
   - Field name errors
   - AI metadata errors
   - Transform type errors

2. **Did any NEW bugs appear?**

3. **Did the LLM show evidence of following the protocols?**
   - Can you see validation steps in the reasoning?
   - Did it check schemas before generating references?

4. **Is the IR quality better overall?**

This will tell us if the protocols are working as designed, or if we need to strengthen them.
