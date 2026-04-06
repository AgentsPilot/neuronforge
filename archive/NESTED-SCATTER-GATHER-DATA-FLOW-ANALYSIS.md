# Nested Scatter-Gather Data Flow Analysis

**Date**: February 18, 2026
**Status**: ⚠️ POTENTIAL ISSUES IDENTIFIED

## Workflow Structure

```
Step 1: search_emails → email_results
Step 2: create_folder → drive_folder
Step 3: scatter-gather (emails) → all_email_results
  ├─ itemVariable: current_email
  ├─ input: {{email_results.emails}}
  └─ Step 4: scatter-gather (attachments) → email_attachment_results
       ├─ itemVariable: current_attachment
       ├─ input: {{current_email.attachments}}
       └─ Steps 5-12: Process each attachment
```

## Data Flow Trace

### Level 1: Email Loop (Step 3)

**Input**: `email_results.emails`
```json
[
  {
    "id": "email123",
    "from": "vendor@example.com",
    "subject": "Invoice #12345",
    "attachments": [
      { "attachment_id": "att1", "filename": "invoice.pdf", "mimeType": "application/pdf" },
      { "attachment_id": "att2", "filename": "receipt.jpg", "mimeType": "image/jpeg" }
    ]
  },
  // ... more emails
]
```

**Loop Variable**: `current_email` = each email object

**Nested Steps**: Step 4 (inner scatter-gather)

**Expected Output** (from ParallelExecutor.gatherResults):
```json
all_email_results = [
  {
    // Merged: original email + nested scatter-gather result
    "id": "email123",
    "from": "vendor@example.com",
    "subject": "Invoice #12345",
    "attachments": [ /* original attachments array */ ],
    "email_attachment_results": [ /* results from Step 4 */ ]
  },
  // ... more email results
]
```

### Level 2: Attachment Loop (Step 4)

**Input**: `current_email.attachments`
```json
[
  { "attachment_id": "att1", "filename": "invoice.pdf", "mimeType": "application/pdf" },
  { "attachment_id": "att2", "filename": "receipt.jpg", "mimeType": "image/jpeg" }
]
```

**Loop Variable**: `current_attachment` = each attachment object

**Nested Steps**: Steps 5-12 (conditionals + plugin actions)

**Expected Output** (from ParallelExecutor.gatherResults):
```json
email_attachment_results = [
  {
    // Merged: original attachment + step results
    "attachment_id": "att1",
    "filename": "invoice.pdf",
    "mimeType": "application/pdf",
    "attachment_content": { /* from step6 */ },
    "uploaded_file": { /* from step7 */ },
    "share_result": { "web_view_link": "..." /* from step8 */ },
    "transaction_data": { /* from step9 */ },
    "sheets_result": { /* from step12, only if amount > $50 */ }
  },
  {
    "attachment_id": "att2",
    "filename": "receipt.jpg",
    "mimeType": "image/jpeg",
    // ... same structure
  }
]
```

## Critical Issues Identified

### 🔴 ISSUE 1: Nested Scatter-Gather Result Structure (CRITICAL)

**Problem**: The workflow expects Step 4 output to be named `email_attachment_results` and accessible within Step 3's gathered results.

**Step 4 Definition**:
```json
{
  "id": "step4",
  "type": "scatter_gather",
  "gather": {
    "operation": "collect",
    "outputKey": "email_attachment_results"
  },
  "output_variable": "email_attachment_results"  // ✅ Added by our fix
}
```

**How ParallelExecutor Merges Results** (lines 349-388):

When Step 3 executes, it calls `executeScatterItem` for each email. Inside each iteration:
1. Execute Step 4 (nested scatter-gather)
2. Step 4 returns an array of attachment results
3. `itemResults` = `{ step4: [...attachment results...] }`

**Merge Logic** (line 357-374):
```typescript
if (stepResultKeys.length === 1) {
  // Single step: Merge original item with step output data
  const stepKey = stepResultKeys[0];  // "step4"
  const stepData = itemResults[stepKey];  // [...attachment results...]

  if (typeof item === 'object' && typeof stepData === 'object' && !Array.isArray(stepData)) {
    mergedResult = { ...item, ...stepData };  // ✅ Works for objects
  } else {
    // Step data is not an object, keep structure as-is
    mergedResult = itemResults;  // ❌ PROBLEM: returns { step4: [...] }
  }
}
```

**The Issue**:
- Step 4 returns an **array** (scatter-gather collect operation)
- Array fails the `!Array.isArray(stepData)` check
- Falls to `mergedResult = itemResults` → Returns `{ step4: [...] }` instead of merging

**Expected**:
```json
{
  "id": "email123",
  "from": "vendor@example.com",
  "email_attachment_results": [ /* attachment results */ ]
}
```

**Actual**:
```json
{
  "id": "email123",
  "from": "vendor@example.com",
  "step4": [ /* attachment results */ ]  // ❌ WRONG KEY
}
```

### 🔴 ISSUE 2: output_variable Not Used for Nested Scatter-Gather

**Problem**: Step 4 has `output_variable: "email_attachment_results"` but this is only registered in the **item context**, not used for merging.

**ParallelExecutor.executeScatterItem** (lines 328-334):
```typescript
// Register output_variable if specified
const outputVariable = (step as any).output_variable;
if (outputVariable && itemContext.setVariable) {
  itemContext.setVariable(outputVariable, output.data);  // ✅ Sets variable in context
  logger.debug({ stepId: step.id, outputVariable }, 'Registered output variable in scatter context');
}
```

**But the merge logic doesn't use this** - it only uses `itemResults[stepKey]`.

### 🔴 ISSUE 3: Step 13 Expects Specific Structure

**Step 13 Input**: `{{all_email_results}}`

**Expected Structure** (from WORKFLOW-ANALYSIS):
```json
[
  {
    "email": { /* current_email data */ },
    "email_attachment_results": [  // ✅ Named correctly
      {
        "attachment": { /* current_attachment data */ },
        "transaction_data": { /* ... */ },
        "share_result": { "web_view_link": "..." }
      }
    ]
  }
]
```

**Actual Structure** (with current merge logic):
```json
[
  {
    // ❌ Email fields flattened (might be OK)
    "id": "email123",
    "from": "vendor@example.com",
    "subject": "Invoice #12345",
    "step4": [  // ❌ WRONG: Should be "email_attachment_results"
      {
        "attachment_id": "att1",
        "transaction_data": { /* ... */ },
        "share_result": { "web_view_link": "..." }
      }
    ]
  }
]
```

**Impact**: Step 13 AI will receive `step4` instead of `email_attachment_results`, making it harder to parse.

## Root Cause Analysis

The ParallelExecutor merge logic (lines 364-374) doesn't handle the case where:
1. A scatter-gather step returns an array
2. That array should be merged into the parent item with a specific key name (from `output_variable`)

**Current Logic**:
- If step result is an object → Merge fields
- If step result is an array → Keep as `{ stepId: array }`

**Needed Logic**:
- If step result is an array AND step has `output_variable` → Merge as `{ output_variable: array }`
- Otherwise → Keep as `{ stepId: array }`

## Proposed Fix

**File**: [lib/pilot/ParallelExecutor.ts](lib/pilot/ParallelExecutor.ts)
**Lines**: 357-374

**Change**:
```typescript
if (stepResultKeys.length === 1) {
  const stepKey = stepResultKeys[0];
  const stepData = itemResults[stepKey];
  const step = steps.find(s => s.id === stepKey);  // Get step definition
  const outputVariable = (step as any)?.output_variable;

  if (typeof item === 'object' && item !== null && typeof stepData === 'object' && stepData !== null && !Array.isArray(stepData)) {
    // Step data is an object - merge fields
    mergedResult = { ...item, ...stepData };
    logger.debug({
      originalFields: Object.keys(item).slice(0, 5),
      stepFields: Object.keys(stepData).slice(0, 5),
      mergedFields: Object.keys(mergedResult).slice(0, 10)
    }, 'Merged original item with step result');
  } else if (Array.isArray(stepData) && outputVariable) {
    // ✅ NEW: Step data is an array with output_variable - merge with custom key
    mergedResult = {
      ...item,
      [outputVariable]: stepData
    };
    logger.debug({
      originalFields: Object.keys(item).slice(0, 5),
      outputVariable,
      arrayLength: stepData.length
    }, 'Merged original item with array result using output_variable');
  } else {
    // Step data is not an object or no output_variable - keep structure as-is
    mergedResult = itemResults;
  }
}
```

## Impact of Fix

### Before Fix
```json
{
  "id": "email123",
  "from": "vendor@example.com",
  "step4": [ /* attachment results */ ]  // ❌
}
```

### After Fix
```json
{
  "id": "email123",
  "from": "vendor@example.com",
  "email_attachment_results": [ /* attachment results */ ]  // ✅
}
```

### Step 13 Impact
- ✅ AI receives correctly named `email_attachment_results` field
- ✅ Easier to parse and generate summary
- ✅ Matches expected structure from requirements

## Alternative: Use Step Output Directly

**Without This Fix**, Step 13 would need to reference:
- `{{all_email_results[].step4[]}}` ❌ Confusing, references internal step ID

**With This Fix**, Step 13 can reference:
- `{{all_email_results[].email_attachment_results[]}}` ✅ Semantic, matches domain

## Testing Checklist

After applying fix:
- [ ] Step 3 gather produces `all_email_results` with `email_attachment_results` field
- [ ] Step 4 gather produces `email_attachment_results` array
- [ ] Step 13 receives correct structure
- [ ] Console logs show "Merged original item with array result using output_variable"

## Severity Assessment

**Severity**: 🟡 MEDIUM-HIGH

**Why Not Critical**:
- Workflow will execute (no crash)
- Data is present, just under wrong key name
- Step 13 AI might still parse it (but less reliably)

**Why Not Low**:
- Breaks semantic structure expectations
- Makes data harder to work with
- Step 13 prompt would need to know about `step4` instead of semantic names

## Related Issues

This is similar to the `output_variable` fix for scatter-gather steps, but at a different level:
- **Previous Fix**: Top-level scatter-gather steps need `output_variable` to be accessible by name
- **This Fix**: Nested scatter-gather results need `output_variable` to be merged with correct key name

Both fixes ensure `output_variable` is respected throughout the execution pipeline.

## Recommendation

**Priority**: HIGH (should be fixed before production use)

**Reason**: The workflow is designed with semantic field names (`email_attachment_results`) that make the data structure self-documenting. Returning `step4` instead breaks this design and makes Step 13's AI task significantly harder.

**Estimated Fix Time**: 10 minutes (simple conditional in merge logic)
