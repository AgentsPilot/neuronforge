# HardcodeDetector Bug Fix - February 18, 2026

**Status**: ✅ FIXED

## Issue

Calibration completed but hardcoded values weren't detected. Error in logs:

```
❌ [WorkflowPilot] Issue collection failed (non-critical): Cannot read properties of undefined (reading 'find')
```

## Root Cause

**File**: `lib/pilot/shadow/HardcodeDetector.ts`

The HardcodeDetector was using `step.id` but compiled DSL uses `step_id`:

```typescript
// ❌ BEFORE (line 173):
const stepId = step.id || step.step_id  // Wrong order!

// ❌ BEFORE (line 225):
this.traverseObject(step, step.id, step.id, ...)  // step.id is undefined!

// ❌ BEFORE (line 239):
locations: [{ stepId: step.id, path, paramName, parentPath }]  // undefined!
```

**Why This Broke**:
- Compiled DSL from ExecutionGraphCompiler uses `step_id` field
- HardcodeDetector was checking `step.id` first (undefined)
- Caused `.find()` calls to fail on undefined stepId

## Fix Applied

Updated HardcodeDetector to use `step_id` first (correct order):

### Fix 1: Line 173 (stepNameMap creation)

```typescript
// ✅ AFTER:
const stepId = step.step_id || step.id  // Correct order
const stepName = step.name || step.label || `Step ${index + 1}`
stepNameMap.set(stepId, stepName)
```

### Fix 2: Lines 224-225 (processStep function)

```typescript
// ✅ AFTER:
const processStep = (step: any) => {
  const stepId = step.step_id || step.id  // Extract once
  this.traverseObject(step, stepId, stepId, (value, path, context, paramName, parentPath) => {
    // ...
  })
}
```

### Fix 3: Line 239 (occurrence creation)

```typescript
// ✅ AFTER:
occurrences.push({
  value,
  locations: [{ stepId, path, paramName, parentPath }],  // Uses extracted stepId
  context: context
})
```

## Impact

**Before Fix**:
- Hardcoded values detection failed silently
- Users didn't see parameterization suggestions
- Calibration couldn't prompt user to convert hardcoded values to inputs

**After Fix**:
- Hardcoded values properly detected
- Users see suggestions to parameterize
- Calibration shows which values should be user inputs

## Testing

### Test Case: Workflow with Hardcoded Spreadsheet ID

**Setup**:
```json
{
  "step_id": "step12",
  "type": "action",
  "plugin": "google_sheets",
  "action": "append_rows",
  "params": {
    "spreadsheet_id": "1pM8WbVv...",  // ← Hardcoded
    "range": "Sheet1!A:E",
    "values": "{{step11.data}}"
  }
}
```

**Before Fix**:
```
❌ Error: Cannot read properties of undefined (reading 'find')
Hardcoded values: 0
```

**After Fix**:
```
✅ Hardcoded values: 1
  • spreadsheet_id = "1pM8WbVv..." (step12)
    Suggested: Convert to input parameter
```

## Related Files

- [lib/pilot/shadow/HardcodeDetector.ts](lib/pilot/shadow/HardcodeDetector.ts) - ✅ Fixed (3 locations)
- [lib/pilot/WorkflowPilot.ts](lib/pilot/WorkflowPilot.ts) - Calls collectHardcodedValues
- [lib/pilot/shadow/IssueCollector.ts](lib/pilot/shadow/IssueCollector.ts) - Uses HardcodeDetector

## Notes

This was a simple but critical bug - the field name order mattered because:
- V6 IR compiler (`ExecutionGraphCompiler`) generates DSL with `step_id`
- V4/V5 legacy DSL used `id`
- Fallback pattern should check the primary format first

**Prevention**: Add type guards to ensure step IDs are never undefined:

```typescript
if (!stepId) {
  console.warn('[HardcodeDetector] Step missing ID:', step)
  return
}
```
