# Calibration System Gap - Variable Resolution Errors

**Date**: February 18, 2026
**Issue**: Calibration didn't catch `VARIABLE_RESOLUTION_ERROR`

## What Happened

User ran workflow in production and got:
```
Unknown variable reference root: all_email_results
Step step13 failed: Unknown variable reference root: all_email_results
```

**Expected**: Calibration should have caught this during batch test and suggested a fix

**Actual**: Error only appeared when running in production mode

## Root Cause Analysis

### 1. FailureClassifier Gap

**File**: [lib/pilot/shadow/FailureClassifier.ts](lib/pilot/shadow/FailureClassifier.ts:286-292)

**Issue**: `VARIABLE_RESOLUTION_ERROR` was not being classified correctly

**Before**:
```typescript
private isInvalidStepOrder(code: string, msg: string): boolean {
  if (code === 'DEPENDENCY_NOT_MET' || code === 'INVALID_STEP_ORDER') return true;
  // ❌ Missing: VARIABLE_RESOLUTION_ERROR detection
  ...
}
```

**After** (Fixed):
```typescript
private isInvalidStepOrder(code: string, msg: string): boolean {
  if (code === 'DEPENDENCY_NOT_MET' || code === 'INVALID_STEP_ORDER') return true;

  // ✅ NEW: Variable resolution errors indicate missing dependencies
  if (code === 'VARIABLE_RESOLUTION_ERROR') return true;
  if (msg.includes('unknown variable reference')) return true;
  if (msg.includes('variable') && (msg.includes('not found') || msg.includes('not defined'))) return true;

  ...
}
```

### 2. RepairEngine Limitation

**File**: [lib/pilot/shadow/RepairEngine.ts](lib/pilot/shadow/RepairEngine.ts:100-117)

**Issue**: RepairEngine only handles `data_shape_mismatch`, not structural issues

```typescript
proposeRepair(classification: FailureClassification, ...): RepairProposal {
  // Only repair data_shape_mismatch failures
  if (classification.category !== 'data_shape_mismatch') {
    return { action: 'none', description: `Repair not applicable for ${classification.category}` };
  }
  ...
}
```

**Why This Matters**:
- Variable resolution errors are **structural issues** (missing `output_variable` in DSL)
- RepairEngine is designed for **runtime data fixes** (extracting arrays from objects, etc.)
- **Cannot be fixed by modifying data** - requires **workflow regeneration**

### 3. Calibration Flow Gap

**Current Flow**:
1. ✅ Batch calibration runs
2. ✅ Detects errors (now with our fix)
3. ✅ Classifies as `invalid_step_order`
4. ❌ **RepairEngine says "not applicable"**
5. ❌ **User sees error but no suggested fix**

**Missing Step**:
When `invalid_step_order` is detected due to variable resolution errors, calibration should:
- Detect that the issue is a compiler bug (missing `output_variable`)
- Suggest **workflow regeneration** instead of data fixes
- Show user: "This workflow needs to be regenerated to include recent fixes"

## Why Calibration Didn't Catch It

### During Batch Calibration

**What Happens**:
1. Workflow runs in batch mode with `continueOnError: true`
2. Step 13 fails with `VARIABLE_RESOLUTION_ERROR`
3. IssueCollector collects the issue
4. FailureClassifier classifies it (now as `invalid_step_order` after our fix)
5. RepairEngine is called but returns "not applicable"
6. **Issue is shown to user but without a clear fix**

**What Should Happen**:
1-5. Same as above
6. **Detect that this is a compiler issue**
7. **Suggest workflow regeneration**
8. **Show user: "Regenerate workflow to apply recent fixes"**

### During Production Run

**What Happens**:
1. Workflow runs in production mode with `continueOnError: false`
2. Step 13 fails with `VARIABLE_RESOLUTION_ERROR`
3. **Workflow stops immediately** (no calibration system active)
4. **User sees raw error**

## Solutions Implemented

### Fix 1: FailureClassifier Enhancement ✅

Added `VARIABLE_RESOLUTION_ERROR` detection to `isInvalidStepOrder()`:

```typescript
// Detect variable resolution errors
if (code === 'VARIABLE_RESOLUTION_ERROR') return true;
if (msg.includes('unknown variable reference')) return true;
```

**Impact**: Calibration will now correctly classify these errors as dependency issues

### Fix 2: Workflow Regeneration (User Action Required)

**Why Needed**: The compiled DSL is missing `output_variable` field on scatter-gather steps

**How to Fix**:
1. Edit workflow
2. Save (triggers recompilation)
3. New DSL will include `output_variable` field
4. Variable resolution will work

## What Still Needs Implementation

### Enhancement 1: RepairEngine for Structural Issues

**New Category**: `workflow_regeneration_needed`

```typescript
// In RepairEngine.proposeRepair()
if (classification.category === 'invalid_step_order') {
  // Check if error is about missing variables
  if (error.message.includes('unknown variable reference')) {
    return {
      action: 'regenerate_workflow',
      description: 'This workflow needs to be regenerated to include recent compiler fixes',
      confidence: 1.0,
      targetStepId: failedStepId,
      risk: 'none',
      reason: 'Scatter-gather output variables are not properly registered in the compiled workflow'
    };
  }
}
```

### Enhancement 2: Smart Detection in IssueCollector

**Check for Known Compiler Bugs**:

```typescript
// In IssueCollector.collectFromError()
if (classification.category === 'invalid_step_order' &&
    error.message.includes('unknown variable reference')) {

  // Extract variable name from error message
  const match = error.message.match(/Unknown variable reference root: (\w+)/);
  if (match) {
    const missingVar = match[1];

    // Check if this looks like a scatter-gather output
    if (this.isScatterGatherOutput(missingVar, context.agent.pilot_steps)) {
      suggestedFix = {
        type: 'regenerate_workflow',
        message: `The variable "${missingVar}" is a scatter-gather output that wasn't properly registered. Regenerate your workflow to fix this.`,
        confidence: 0.95
      };
    }
  }
}

private isScatterGatherOutput(varName: string, steps: any[]): boolean {
  // Check if any scatter-gather step has this output_variable in gather.outputKey
  return steps.some(step =>
    step.type === 'scatter_gather' &&
    step.gather?.outputKey === varName
  );
}
```

### Enhancement 3: Calibration UI Update

**Show Clear Regeneration Button**:

```tsx
{issue.category === 'invalid_step_order' && issue.suggestedFix?.type === 'regenerate_workflow' && (
  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
    <p className="text-sm text-blue-900 dark:text-blue-100 mb-2">
      This workflow was compiled before recent fixes were applied.
    </p>
    <button
      onClick={handleRegenerateWorkflow}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
    >
      Regenerate Workflow
    </button>
  </div>
)}
```

## Testing Scenarios

### Test Case 1: Missing output_variable (Current Issue)

**Setup**: Workflow with scatter-gather but missing `output_variable` field

**Before Fix**:
- Calibration: Shows generic error, no suggested fix
- Production: Crashes with `VARIABLE_RESOLUTION_ERROR`

**After Classification Fix**:
- Calibration: Classifies as `invalid_step_order` ✅
- RepairEngine: Says "not applicable" ⚠️
- User sees error but no clear fix path

**After Full Fix** (when enhancements implemented):
- Calibration: Classifies as `invalid_step_order` ✅
- RepairEngine: Suggests "regenerate_workflow" ✅
- User sees button to regenerate ✅
- One-click fix ✅

### Test Case 2: Typo in Variable Name

**Setup**: Step uses `{{email_results}}` but should be `{{all_email_results}}`

**Expected**:
- Calibration catches it
- Classifies as `invalid_step_order`
- Suggests: "Did you mean 'all_email_results'?" (fuzzy match)
- Shows available variables

### Test Case 3: Missing Step Dependency

**Setup**: Step 5 uses `{{step4.data}}` but step 4 is missing

**Expected**:
- Calibration catches it
- Classifies as `missing_step`
- Suggests: "Add a step before step 5 that provides the required data"

## Summary

### What We Fixed ✅
1. FailureClassifier now detects `VARIABLE_RESOLUTION_ERROR`
2. Classifies as `invalid_step_order` (correct category)

### What Still Needs Work 🚧
1. RepairEngine doesn't propose fixes for structural issues
2. No smart detection of compiler bugs vs user errors
3. No "Regenerate Workflow" button in calibration UI
4. No fuzzy matching for typos in variable names

### Immediate Workaround ✅
User can manually regenerate the workflow to apply recent compiler fixes

### Long-Term Solution 🎯
Implement enhancements 1-3 above to make calibration automatically detect and suggest workflow regeneration for compiler-related issues

## Related Files

- [lib/pilot/shadow/FailureClassifier.ts](lib/pilot/shadow/FailureClassifier.ts) - ✅ Fixed
- [lib/pilot/shadow/RepairEngine.ts](lib/pilot/shadow/RepairEngine.ts) - 🚧 Needs enhancement
- [lib/pilot/shadow/IssueCollector.ts](lib/pilot/shadow/IssueCollector.ts) - 🚧 Needs smart detection
- [components/v2/calibration/CalibrationSetup.tsx](components/v2/calibration/CalibrationSetup.tsx) - 🚧 Needs UI update
