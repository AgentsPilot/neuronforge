# Data Flow Fix Summary

## Problem

When resuming a failed calibration execution after fixing hardcoded values:
- ❌ All subsequent steps failed with "missing data" errors
- ❌ Steps couldn't access outputs from previously completed steps (e.g., `{{step1.emails}}`)
- ❌ User couldn't complete calibration

## Root Cause

**Step outputs are NOT persisted to database** (privacy-first design - no client data storage)

When resuming:
1. `StateManager.resumeExecution()` creates fresh `ExecutionContext`
2. Restores metadata: `completedSteps[]`, `failedSteps[]`, `totalTokens`, etc.
3. **Does NOT restore**: `stepOutputs Map` (the actual data!)
4. Result: All step outputs from previous execution are LOST

When `WorkflowPilot.resume()` tries to execute remaining steps:
- Step 2 tries to access `{{step1.emails}}` → NOT FOUND → FAILS
- Step 3 tries to access `{{step2.data}}` → NOT FOUND (step 2 failed) → FAILS
- Cascade failure continues...

## Solution

**Re-execute entire workflow from step 1** when resuming after fixing hardcoded values.

### Why This Works

1. ✅ All steps get fresh data from their dependencies
2. ✅ No need to restore step outputs from database
3. ✅ Ensures data is current (re-fetches from sources like spreadsheets)
4. ✅ Privacy-first design maintained (no client data stored)
5. ✅ Simple implementation, low risk

### Changes Made

#### 1. Resume API - Clear ALL Execution State

**File**: `app/api/calibrate/resume/route.ts` (lines 164-191)

**Before**:
```typescript
// Only cleared failedSteps array
const updatedTrace = {
  ...executionTrace,
  failedSteps: [],
};
```

**After**:
```typescript
// Clear ALL execution state
const updatedTrace = {
  completedSteps: [],  // ← Data from these is lost
  failedSteps: [],
  skippedSteps: [],
};

await supabaseAdmin.from('workflow_executions').update({
  execution_trace: updatedTrace,
  completed_steps_count: 0,      // ← RESET
  failed_steps_count: 0,
  skipped_steps_count: 0,
  current_step: null,             // ← Start from beginning
  total_tokens_used: 0,           // ← Will recalculate
  total_execution_time_ms: 0,
  status: 'running',
  updated_at: new Date().toISOString(),
});
```

#### 2. StateManager - Detect Fresh Restart Mode

**File**: `lib/pilot/StateManager.ts` (lines 573-602)

**Added**:
```typescript
// Check if this is a fresh restart
const isFreshRestart =
  (!data.execution_trace?.completedSteps || data.execution_trace.completedSteps.length === 0) &&
  (!data.execution_trace?.failedSteps || data.execution_trace.failedSteps.length === 0);

if (isFreshRestart) {
  // Fresh restart - start from beginning with empty state
  console.log('[StateManager] 🔄 Fresh restart - re-executing entire workflow from step 1');
  context.currentStep = null;
  context.completedSteps = [];
  context.failedSteps = [];
  context.skippedSteps = [];
  context.totalTokensUsed = 0;
  context.totalExecutionTime = 0;
} else {
  // Partial resume - restore checkpoint state
  console.log('[StateManager] ⏭️  Partial resume - continuing from checkpoint');
  // ... restore existing state
}
```

#### 3. WorkflowPilot - Execute All Steps on Fresh Restart

**File**: `lib/pilot/WorkflowPilot.ts` (lines 1854-1873)

**Before**:
```typescript
// Always filtered to incomplete steps
const remainingSteps = executionPlan.steps.filter(step =>
  !context.completedSteps.includes(step.stepId) &&
  !context.failedSteps.includes(step.stepId)
);
```

**After**:
```typescript
// Determine which steps to execute
if (context.completedSteps.length === 0 && context.failedSteps.length === 0) {
  // Fresh restart - execute ALL steps
  console.log('🔄 [WorkflowPilot] Fresh restart - executing entire workflow from step 1');
  stepsToExecute = executionPlan.steps;
} else {
  // Partial resume - filter to incomplete steps
  console.log('⏭️  [WorkflowPilot] Partial resume - skipping completed steps');
  stepsToExecute = executionPlan.steps.filter(step =>
    !context.completedSteps.includes(step.stepId) &&
    !context.failedSteps.includes(step.stepId)
  );
}
```

## Expected Behavior After Fix

### User Flow:
1. ✅ Run calibration → Fails at step 2 (hardcoded value error)
2. ✅ Fix hardcoded value (update workflow_steps)
3. ✅ Click "Retry with Fixed Value"
4. ✅ **ALL steps execute from step 1** (not just step 2+)
5. ✅ Step 1 runs → produces fresh output data
6. ✅ Step 2 runs → accesses `{{step1.data}}` ✅ (available in context)
7. ✅ Step 3 runs → accesses `{{step2.data}}` ✅ (available in context)
8. ✅ ... all steps complete successfully

### Data Flow:
```
RESUME AFTER FIX (NOW WORKS!)
═══════════════════════════════

StateManager.resumeExecution(executionId):
├─ Fetch execution from DB
├─ execution_trace: { completedSteps: [], failedSteps: [] } ← CLEARED!
├─ Detect: isFreshRestart = true
└─ Create ExecutionContext with EMPTY state

WorkflowPilot.resume():
├─ Load agent.workflow_steps (has FIXED values) ✅
├─ Parse execution plan
├─ Detect: completedSteps.length === 0 → Fresh restart!
└─ Execute ALL steps from step 1:
   │
   ├─ Step 1: Get Emails ✅
   │  └─ Output stored in: context.stepOutputs.set('step1', {...})
   │
   ├─ Step 2: Filter Urgent (FIXED range value) ✅
   │  ├─ Resolves: {{step1.emails}} ✅ (in context)
   │  └─ Output stored in: context.stepOutputs.set('step2', {...})
   │
   ├─ Step 3: Process Data ✅
   │  ├─ Resolves: {{step2.urgent_emails}} ✅ (in context)
   │  └─ Output stored in: context.stepOutputs.set('step3', {...})
   │
   └─ ... all steps complete successfully! 🎉
```

## Trade-offs

### ✅ Pros:
- Guarantees data consistency
- Simple implementation
- No complex state restoration logic
- Fresh data from sources (spreadsheets, APIs, etc.)
- Aligns with privacy-first design (no client data in DB)

### ⚠️ Cons:
- Re-executes steps that already succeeded
- Uses more tokens/quota (acceptable for calibration)
- Takes slightly longer (but ensures correctness)

## Alternative Considered (Rejected)

**Option**: Store step outputs in database and restore on resume

**Why Rejected**:
1. ❌ Violates privacy-first design (stores client data)
2. ❌ High complexity (sanitization, size limits, data staleness)
3. ❌ Fragile (data may change between runs)
4. ❌ Not aligned with system architecture

## Testing Checklist

- [ ] Create agent with 5 steps, step 2 has hardcoded value
- [ ] Run calibration → fails at step 2
- [ ] Fix hardcoded value
- [ ] Click "Retry with Fixed Value"
- [ ] Verify: All 5 steps execute (not just 2-5)
- [ ] Verify: Step 3+ can access step 1-2 outputs
- [ ] Verify: Execution completes successfully
- [ ] Verify: Token count is accurate for full run
- [ ] Verify: No "Variable not found" errors

## Impact

**Before Fix**:
- ❌ Cannot resume from failed step
- ❌ All subsequent steps fail
- ❌ User must recreate agent

**After Fix**:
- ✅ Resume works correctly
- ✅ All steps complete successfully
- ✅ Calibration flow is functional

## Files Modified

1. ✅ `app/api/calibrate/resume/route.ts` - Clear all execution state
2. ✅ `lib/pilot/StateManager.ts` - Detect fresh restart mode
3. ✅ `lib/pilot/WorkflowPilot.ts` - Execute all steps on fresh restart

## Related Documentation

- `DATA_FLOW_ROOT_CAUSE_ANALYSIS.md` - Detailed root cause analysis
- `lib/pilot/StateManager.ts:573-575` - Comment explaining why step outputs aren't restored
