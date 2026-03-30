# Critical Fix: Parameter Rename Handler in Runtime Fix Loop

## Problem Discovered

Scatter-gather error detection was working perfectly, creating auto-fixable issues with `parameter_rename` proposals, but the calibration loop was NOT applying the fixes and continuing.

**Root Cause**: The parameter rename fix handler was ONLY in the "final validation" section, NOT in the main runtime fix application loop.

## Evidence from Logs

User's logs showed successful detection:
```json
{
  "msg": "Detected scatter-gather items with errors",
  "stepId": "step4",
  "totalItems": 2,
  "failedItems": 2
}

{
  "msg": "Detected auto-fixable parameter mismatch in scatter-gather nested step",
  "stepId": "step6",
  "wrongParam": "file_url",
  "correctParam": "file_content"
}
```

Then logs ended - no fix application, no iteration 2, no loop continuation.

User confirmed: "there is no more log what I have pasted is the issues until the end of the log. I think the calibration is not running in loop"

## Code Structure Analysis

### File: `app/api/v2/calibrate/batch/route.ts`

**Two separate fix application sections exist:**

#### Section 1: Final Validation Pass (Lines 888-976)
- Runs when `autoFixableIssues.length === 0`
- Performs one more structural validation before exiting
- **HAS** parameter_rename handler (lines 930-952)
- Only processes issues from `finalStructuralIssues`

#### Section 2: Runtime Fix Application (Lines 991-1100+)
- Runs when `autoFixableIssues.length > 0`
- Applies fixes from runtime/execution issues
- **MISSING** parameter_rename handler (until this fix)
- Handles: `add_flatten_field`, `fix_field_name`, `fix_parameter_reference`, data_shape_mismatch

### The Gap

Scatter-gather error issues:
1. ✅ Are detected after execution (line 531-566)
2. ✅ Are added to `iterationIssues` (line 729)
3. ✅ Are classified as `autoFixableIssues` (lines 732-737)
4. ✅ Reach runtime fix application loop (line 999)
5. ❌ **NOT HANDLED** - no `proposal.type === 'parameter_rename'` handler existed

Result: Loop iterates over the issue, skips it (no matching handler), applies 0 fixes, then likely exits.

## The Fix

**Added parameter_rename handler to runtime fix application loop (after line 1067):**

```typescript
// Handle parameter_rename fixes (scatter-gather errors)
else if (proposal.type === 'parameter_rename') {
  const change = proposal.changes?.[0];
  if (change && change.action === 'rename_key') {
    const targetStep = findStepByIdRecursive(updatedSteps, change.stepId);
    if (targetStep && targetStep.config && change.path) {
      const pathParts = change.path.split('.');
      if (pathParts[0] === 'config' && pathParts.length === 2) {
        const oldKey = pathParts[1];
        const newKey = change.newKey;
        if (oldKey in targetStep.config && newKey) {
          // Rename the key: copy value to new key and delete old key
          targetStep.config[newKey] = targetStep.config[oldKey];
          delete targetStep.config[oldKey];
          fixesAppliedThisRound++;
          logger.info({
            issueId: issue.id,
            stepId: change.stepId,
            oldKey,
            newKey,
            value: targetStep.config[newKey]
          }, 'Auto-applied: parameter_rename');
        }
      }
    }
  }
}
```

**Location**: `app/api/v2/calibrate/batch/route.ts`, inserted after line 1067 (right before data_shape_mismatch handlers)

## Why This Works

**Proposal Structure**:
```typescript
{
  type: 'parameter_rename',  // ← Checked in new handler
  stepId: 'step6',
  confidence: 0.95,
  changes: [{
    stepId: 'step6',
    path: 'config.file_url',
    oldValue: '{{attachment_content.data}}',
    newValue: '{{attachment_content.data}}',
    newKey: 'file_content',  // ← New parameter name
    action: 'rename_key',    // ← Specific action
    reasoning: '...'
  }]
}
```

**Handler Logic**:
1. Check if `proposal.type === 'parameter_rename'` ✅
2. Get first change from `proposal.changes[0]` ✅
3. Verify `change.action === 'rename_key'` ✅
4. Find target step using `findStepByIdRecursive()` ✅
5. Parse path to get config key name ✅
6. Rename: `config[newKey] = config[oldKey]; delete config[oldKey];` ✅
7. Increment `fixesAppliedThisRound` ✅
8. Log the fix ✅

**After fix applied**:
- `fixesAppliedThisRound > 0` (line 1123+)
- Updates agent in database with fixed workflow
- Continues to next iteration
- Re-executes workflow with correct parameter

## Expected Flow Now

### Iteration 1: Detection & Fix
1. Execute workflow with `file_url` parameter
2. Step6 fails: "file_url not implemented. Please pass file_content parameter"
3. Scatter-gather catches error, returns `{error: "...", item: 0}`
4. Scan step outputs finds error array
5. Parse error message extracts: wrongParam="file_url", correctParam="file_content"
6. Search nested steps finds step6 has `config.file_url`
7. Create auto-fixable issue with parameter_rename proposal
8. **NEW**: Runtime fix loop handles parameter_rename
9. **NEW**: Renames `file_url` → `file_content` in step6 config
10. **NEW**: Updates database with fixed workflow
11. **NEW**: Logs "Auto-applied: parameter_rename"
12. **NEW**: Continue to iteration 2

### Iteration 2: Verification
1. Re-execute workflow with `file_content` parameter
2. Step6 succeeds - document extraction works
3. All scatter items complete successfully
4. No errors detected
5. Exit with status `completed`

## Testing Required

Please trigger calibration again. You should now see:

### Expected Logs (Iteration 1):
```
Scanning step outputs for scatter-gather errors
Detected scatter-gather items with errors
Detected auto-fixable parameter mismatch in scatter-gather nested step
Issue classification complete (autoFixable: 1, requiresUserInput: 0)
Auto-applying runtime fixes (fixCount: 1)
Auto-applied: parameter_rename (stepId: step6, oldKey: file_url, newKey: file_content)
Applied 1 fixes - skipping execution, will re-validate in next iteration
```

### Expected Logs (Iteration 2):
```
Starting calibration iteration 2
Pre-flight validation complete (issues: 0)
Executing workflow with batch calibration mode
Workflow execution successful
Workflow executed successfully with no issues - calibration complete!
```

### Expected Result:
- ✅ Parameter renamed from `file_url` to `file_content`
- ✅ Workflow executes successfully
- ✅ Files uploaded to Google Drive
- ✅ Sheet rows added
- ✅ Digest email sent with content
- ✅ Final status: `completed` with "1 fix applied across 2 iterations"

## Files Modified

**`app/api/v2/calibrate/batch/route.ts`**:
- **Lines 1068-1094**: Added parameter_rename handler to runtime fix application loop
- Inserted between `fix_parameter_reference` handler and `data_shape_mismatch` handlers

## Impact

**Before**:
- ❌ Scatter-gather errors detected
- ❌ Auto-fixable issues created
- ❌ Runtime fix loop skipped them (no handler)
- ❌ 0 fixes applied
- ❌ Loop likely exited prematurely
- ❌ Workflow remained broken

**After**:
- ✅ Scatter-gather errors detected
- ✅ Auto-fixable issues created
- ✅ Runtime fix loop handles them
- ✅ Fixes applied and logged
- ✅ Loop continues to iteration 2
- ✅ Workflow executes successfully

## Related Documentation

- `CRITICAL-FIX-STEP-OUTPUT-SCANNING.md`: Fixed scanning result.output instead of executionTrace
- `SCATTER-GATHER-PARAMETER-MISMATCH-AUTO-FIX.md`: Original implementation of error detection
- `COMPLETE-AUTO-FIX-CALIBRATION-FLOW.md`: Full end-to-end calibration flow
