# Calibration Issue Collection Bug Fix - February 18, 2026

**Status**: ✅ FIXED

## Issue

Calibration completed but **hardcoded values weren't detected**. Error in logs:

```
❌ [WorkflowPilot] Issue collection failed (non-critical): Cannot read properties of undefined (reading 'find')
```

## Root Cause

**File**: `lib/pilot/WorkflowPilot.ts` (line 829)

The code tried to access `this.workflowSteps.find()` but `this.workflowSteps` was **never initialized** (undefined).

```typescript
// ❌ BEFORE (line 829):
const failedStepDef = this.workflowSteps.find(s => s.id === failedStepId || s.step_id === failedStepId);
//                    ^^^^^^^^^^^^^^^^^^
//                    undefined! Property doesn't exist on WorkflowPilot class
```

**Why This Broke**:
- `this.workflowSteps` is not a property of the `WorkflowPilot` class
- The correct location is `agent.pilot_steps` (passed as parameter)
- This caused the entire issue collection to fail with an error
- As a result, hardcoded values were never detected

## How It Worked Before

Good question! This code was likely added recently during calibration improvements. Let me check when this was introduced:

The issue collection code in the error handler (lines 820-851) was part of batch calibration enhancements. The bug was introduced when we added the step name/type lookup but used the wrong property.

## Fix Applied

Updated to use `agent.pilot_steps` instead of non-existent `this.workflowSteps`:

```typescript
// ✅ AFTER (lines 828-831):
const failedStepId = error.stepId || context.currentStep || 'unknown';
const pilotSteps = agent.pilot_steps || agent.workflow_steps || [];  // ← Get steps from agent
const failedStepDef = pilotSteps.find(s => s.id === failedStepId || s.step_id === failedStepId);
const failedStepName = failedStepDef?.name || failedStepId;
const failedStepType = failedStepDef?.type || 'unknown';
```

## Additional Fix: HardcodeDetector

While investigating, we also found and fixed a related bug in `HardcodeDetector.ts`:

**File**: `lib/pilot/shadow/HardcodeDetector.ts`

The HardcodeDetector was using `step.id` directly instead of checking `step_id` first:

```typescript
// ❌ BEFORE (line 225):
this.traverseObject(step, step.id, step.id, ...)
//                        ^^^^^^^
// Should check step_id first since compiled DSL uses step_id

// ✅ AFTER:
const stepId = step.step_id || step.id  // Check step_id first
this.traverseObject(step, stepId, stepId, ...)
```

**Note**: Current workflows have both `id` and `step_id` fields, so this wasn't breaking yet, but it's good practice to check the primary field first.

## Impact

**Before Fix**:
```
User runs calibration → Workflow fails → Issue collection crashes
❌ Error: Cannot read properties of undefined (reading 'find')
❌ Hardcoded values: 0 (never detected)
❌ User sees no suggestions for parameterization
```

**After Fix**:
```
User runs calibration → Workflow fails → Issue collection succeeds
✅ Execution error collected with proper step name/type
✅ Hardcoded values detected: 1
   • spreadsheet_id = "1pM8WbXtPgaYq..." (step12)
     Suggested: Convert to input parameter "spreadsheet_id"
✅ User sees both execution errors AND parameterization suggestions
```

## Testing

### Test Case: Workflow with Hardcoded Values

**Workflow**:
- Step 12: Google Sheets append_rows with hardcoded `spreadsheet_id`
- Step fails before reaching step 12 (e.g., step 13 fails with VARIABLE_RESOLUTION_ERROR)

**Before Fix**:
```
❌ Issue collection failed (non-critical): Cannot read properties of undefined (reading 'find')
Hardcoded values detected: 0
```

**After Fix**:
```
✅ Collected execution error issue: invalid_step_order, auto-repair: false
✅ Detected 1 hardcoded values (after failure)
   • step12.params.spreadsheet_id = "1pM8WbXtPgaYq..."
     Category: resource_ids
     Priority: critical
     Suggested: Convert to input parameter
```

## Files Modified

1. [lib/pilot/WorkflowPilot.ts](lib/pilot/WorkflowPilot.ts:829) - ✅ Fixed `this.workflowSteps` → `agent.pilot_steps`
2. [lib/pilot/shadow/HardcodeDetector.ts](lib/pilot/shadow/HardcodeDetector.ts:225) - ✅ Fixed `step.id` → `step.step_id || step.id`

## Why User Asked "How Come It Failed Now"

**Answer**: This is a **newly introduced bug** from recent calibration enhancements. The code path:

```
lib/pilot/WorkflowPilot.ts lines 820-851
```

was added to collect issues after workflow failure in batch calibration mode. When we added the step name/type lookup (line 829), we incorrectly referenced `this.workflowSteps` which doesn't exist.

**Timeline**:
1. ✅ Original calibration worked (no issue collection after failure)
2. ❌ Added issue collection → introduced `this.workflowSteps` bug
3. ✅ Fixed by using `agent.pilot_steps` instead

## Related Issues

This fix resolves both:
1. Issue collection crash (primary)
2. Hardcoded values not being detected (secondary effect)

Now users will see:
- ✅ Execution errors with proper context
- ✅ Hardcoded values that should be parameterized
- ✅ Complete calibration feedback for workflow improvements
