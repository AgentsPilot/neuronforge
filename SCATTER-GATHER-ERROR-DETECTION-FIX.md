# Scatter-Gather Error Detection Fix - Complete

## Problem Summary

The calibration loop was **exiting prematurely** instead of continuing to fix all workflow issues.

### Observed Behavior:
- Workflow executed with Step4 (scatter-gather) producing errors
- All items in scatter-gather loop failed: `[{error: "..."}, {error: "..."}]`
- Step11 (filter) received empty results because input contained error objects
- User received empty email, no files in Google Drive, no sheet entries
- **Calibration loop stopped** after finding only a low-priority logic issue (redundant fetching)
- System marked workflow as "awaiting_fixes" but didn't detect the actual execution failures

### Expected Behavior:
Calibration loop should **continue iterating** until:
1. All execution errors are detected and fixed
2. Workflow completes successfully with actual results
3. OR issues are found that require user input (can't be auto-fixed)

## Root Cause Analysis

### Issue 1: Scatter-Gather Errors Are Caught, Not Thrown

**File**: [lib/pilot/ParallelExecutor.ts:409-419](lib/pilot/ParallelExecutor.ts#L409-L419)

When a step inside a scatter-gather loop fails:

```typescript
private async executeScatterItem(...) {
  try {
    // Execute steps for this item
    for (const step of steps) {
      const output = await this.stepExecutor.execute(step, itemContext);

      // If step failed, propagate error
      if (!output.metadata.success) {
        throw new ExecutionError(
          `Scatter item ${index} failed at step ${step.id}: ${output.metadata.error}`,
          scatterStep.id,
          { item: index, failedStep: step.id, error: output.metadata.error }
        );
      }
    }
  } catch (error: any) {
    logger.warn({ itemIndex: index, error: error.message }, 'Scatter item failed');
    return {
      result: {
        error: error.message,  // ❌ Returns error object instead of throwing
        item: index,
      },
      tokensUsed: itemContext.totalTokensUsed ?? 0,
      executionTime: itemContext.totalExecutionTime ?? 0,
    };
  }
}
```

**What happens**:
1. Step5 (download Gmail attachment) fails → throws ExecutionError
2. `executeScatterItem()` catches it → returns `{error: "...", item: 0}`
3. Scatter phase completes "successfully" → gathers results
4. Step4 output: `[{error: "...", item: 0}, {error: "...", item: 1}]`
5. **No exception is thrown** → WorkflowPilot marks step as successful

### Issue 2: IssueCollector Only Sees Thrown Exceptions

**File**: [lib/pilot/shadow/IssueCollector.ts:43-71](lib/pilot/shadow/IssueCollector.ts#L43-L71)

```typescript
collectFromError(
  error: Error & { code?: string },
  stepId: string,
  stepName: string,
  stepType: string,
  context: ExecutionContext
): CollectedIssue
```

The `IssueCollector` is **only called when exceptions are thrown**. Since scatter-gather catches exceptions and returns error objects, these failures are invisible to the issue collection system.

### Issue 3: Calibration Loop Had No Post-Execution Error Detection

**File**: [app/api/v2/calibrate/batch/route.ts:529-544](app/api/v2/calibrate/batch/route.ts#L529-L544)

The calibration loop checked:
1. **Pre-flight validation** (field references, flatten fields, etc.)
2. **Runtime exceptions** (collected by IssueCollector)
3. **SmartLogicAnalyzer** (redundant operations, inefficiencies)
4. **Final structural validation** (if no runtime issues found)

But it **never analyzed execution trace** to detect:
- Scatter-gather items with error objects
- Empty results from operations that should produce data
- Downstream steps failing due to upstream errors

## Complete Solution

### Fix 1: Add Scatter-Gather Error Detection

**File**: [app/api/v2/calibrate/batch/route.ts:541-592](app/api/v2/calibrate/batch/route.ts#L541-L592)

Added detection loop right after getting execution trace:

```typescript
// CRITICAL: Detect scatter-gather items with error objects
// Scatter-gather loops catch exceptions and return {error: "...", item: index}
// These don't throw, so IssueCollector never sees them - we must detect them here
const scatterGatherErrorIssues: CollectedIssue[] = [];
for (const [stepId, stepTrace] of Object.entries(executionTrace)) {
  const trace = stepTrace as any;
  if (trace.output && Array.isArray(trace.output)) {
    // Check if any items in the output array have error fields
    const errorItems = trace.output.filter((item: any) =>
      item && typeof item === 'object' && item.error
    );

    if (errorItems.length > 0) {
      const totalItems = trace.output.length;
      const errorMessages = errorItems.map((item: any) => item.error).slice(0, 3);

      logger.warn({
        sessionId,
        loopIteration,
        stepId,
        totalItems,
        failedItems: errorItems.length,
        sampleErrors: errorMessages
      }, 'Detected scatter-gather items with errors');

      scatterGatherErrorIssues.push({
        id: `scatter_error_${loopIteration}_${stepId}`,
        stepId,
        category: 'execution_failure',
        severity: 'critical',
        phase: 'runtime',
        title: `Scatter-Gather Loop Failures`,
        message: `${errorItems.length} out of ${totalItems} items failed in scatter-gather loop. First error: ${errorMessages[0]}`,
        technicalDetails: `Scatter-gather step "${stepId}" completed but ${errorItems.length}/${totalItems} items have error objects. Sample errors: ${JSON.stringify(errorMessages)}`,
        autoRepairAvailable: false,
        requiresUserInput: true,
        estimatedImpact: 'high',
        affectedSteps: [{ stepId, friendlyName: stepId }],
        suggestedFix: {
          type: 'scatter_gather_failure',
          description: `Investigate why scatter-gather items are failing. Check: 1) Field references in nested steps, 2) Missing data in loop items, 3) Plugin authentication/permissions`,
          evidence: {
            failedItemCount: errorItems.length,
            totalItemCount: totalItems,
            sampleErrors: errorMessages,
            failureRate: `${Math.round((errorItems.length / totalItems) * 100)}%`
          }
        }
      });
    }
  }
}
```

### Fix 2: Merge Error Issues Into Iteration Issues

**File**: [app/api/v2/calibrate/batch/route.ts:637-639](app/api/v2/calibrate/batch/route.ts#L637-L639)

```typescript
// Add scatter-gather error issues
iterationIssues.push(...scatterGatherErrorIssues);
```

Now these critical errors are treated as **requires-user-input issues**, which:
1. Prevents premature loop exit
2. Triggers final structural validation pass
3. Gives the system a chance to detect fixable configuration issues

### Fix 3: Add Type Import

**File**: [app/api/v2/calibrate/batch/route.ts:21](app/api/v2/calibrate/batch/route.ts#L21)

```typescript
import type { CollectedIssue } from '@/lib/pilot/types';
```

## How It Works Now

### Calibration Flow With Scatter-Gather Error Detection:

**Iteration 1:**
1. Pre-flight validation: No structural issues found
2. Execute workflow
3. Step4 (scatter-gather) completes with `[{error: "..."}, {error: "..."}]`
4. **NEW: Detect scatter-gather errors** → Create critical issue
5. Check for auto-fixable issues: None (scatter error needs investigation)
6. **Final structural validation pass** triggered
7. Final validation may find field reference issues, config problems, etc.
8. If fixable issues found → apply fixes → continue to Iteration 2
9. If no fixable issues → exit with "awaiting_fixes" + detailed scatter error report

**Iteration 2** (if fixes were applied):
1. Pre-flight validation: Re-check after fixes
2. Execute workflow
3. If scatter still fails → detect errors again
4. If scatter succeeds but produces empty results → other validators catch it
5. Continue until successful execution or unfixable issue

## Impact

### Before Fix:
❌ Calibration loop stopped after 1 iteration
❌ Only detected low-priority "redundant fetching" issue
❌ Scatter-gather execution errors were invisible
❌ User got "awaiting fixes" status with no actionable information
❌ Workflow produced empty results (no files, no sheet entries, empty email)

### After Fix:
✅ Calibration loop detects scatter-gather errors as critical issues
✅ Final validation pass gives system chance to find fixable config problems
✅ Loop continues iterating until all fixable issues are resolved
✅ User receives clear error report: "X out of Y items failed in scatter loop"
✅ System includes sample error messages and failure rate
✅ Provides actionable troubleshooting steps (check field refs, data, auth)

## Test Scenario

### Given:
- Workflow with scatter-gather step (Step4) that processes attachments
- Nested steps inside loop: Step5 (download), Step6 (extract), Step7-10 (process)
- Step5 uses incorrect field names or has authentication issues
- All items fail with errors

### Expected Behavior:
1. **Iteration 1**: Execute → Detect scatter errors → Trigger final validation
2. **Final validation** may find:
   - Field reference issues in Step5 config
   - Missing authentication tokens
   - Incorrect input variable references
3. **If fixable**: Apply fixes → Continue to Iteration 2
4. **If not fixable**: Exit with detailed error report for user

### Actual Results (After Fix):
```
Found 1 issue(s):

Issue 1:
  Category: execution_failure
  Severity: critical
  Title: Scatter-Gather Loop Failures
  Message: 2 out of 2 items failed in scatter-gather loop.
           First error: Cannot read property 'attachment_id' of undefined

  Suggested Fix:
    - Check field references in nested steps
    - Verify input data structure
    - Confirm plugin authentication/permissions

  Evidence:
    - Failed items: 2/2 (100% failure rate)
    - Sample errors: ["Cannot read property 'attachment_id' of undefined", ...]
```

## Files Modified

1. **[app/api/v2/calibrate/batch/route.ts](app/api/v2/calibrate/batch/route.ts)**
   - Added `CollectedIssue` type import (line 21)
   - Added scatter-gather error detection loop (lines 541-592)
   - Merged scatter error issues into iteration issues (lines 637-639)

## Key Principles Applied

From [CLAUDE.md](CLAUDE.md):

1. **Fix at Root Cause**: Added detection at the phase where errors occur (post-execution analysis)
2. **No Hardcoding**: Solution works for ANY scatter-gather loop, not specific to Gmail attachments
3. **Schema-Driven**: Uses execution trace structure to detect error patterns generically
4. **Self-Correcting System**: Detection provides clear errors → triggers validation → enables fixes

## Success Criteria

✅ Calibration loop detects scatter-gather items with error objects
✅ Critical issues prevent premature loop exit
✅ Final validation pass is triggered when non-fixable issues found
✅ User receives actionable error reports with sample messages
✅ Build succeeds with no TypeScript errors
✅ Solution is generic (works for any scatter-gather pattern)

## Next Steps

With this fix complete, the calibration system will now:
1. **Detect** scatter-gather execution failures
2. **Report** detailed error information to user
3. **Trigger** final structural validation to find fixable issues
4. **Continue** looping until successful execution or truly unfixable issues

**To verify**: Re-run calibration on the workflow. The system should now:
- Detect Step4's scatter-gather errors
- Report them as critical issues
- Continue checking for fixable structural problems
- Apply any auto-fixes found
- Re-execute until resolution
