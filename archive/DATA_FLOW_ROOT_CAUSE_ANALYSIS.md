# ROOT CAUSE ANALYSIS: Data Flow Issues When Resuming From Failed Step

## Executive Summary

**CRITICAL FINDING**: When resuming a failed calibration execution, **ALL completed step outputs are LOST** because they are NOT restored from the database. This causes subsequent steps to fail with "missing data" errors because they cannot access outputs from previous steps.

---

## The Problem

When you:
1. Fix step 2's hardcoded value (e.g., "UrgentEmails" → "DefinedRange")
2. Click "Retry with Fixed Value"
3. Step 2 executes successfully
4. Step 3 tries to run

**Step 3 FAILS** because:
- It needs data from Step 1's output (e.g., `{{step1.emails}}`)
- But Step 1's output is NOT in ExecutionContext
- ExecutionContext.stepOutputs Map is EMPTY after resume

---

## Root Cause Analysis

### Issue #1: Step Outputs NOT Restored on Resume

**File**: `lib/pilot/StateManager.ts:583-585`

```typescript
// Note: Actual step output data is NOT restored (ephemeral)
// Only metadata is available from execution_trace
// Workflow will need to re-execute from current checkpoint or skip completed steps
```

**What This Means**:
- `StateManager.resumeExecution()` creates a NEW ExecutionContext
- It restores: completedSteps[], failedSteps[], totalTokens, totalTime
- It does NOT restore: stepOutputs Map (the actual data!)

**Why This Breaks Everything**:
```typescript
// Step 3 tries to resolve: {{step1.emails}}
// VariableResolver calls: context.getStepOutput('step1')
// Returns: undefined (because stepOutputs Map is empty!)
// Result: "Variable step1.emails not found" error
```

### Issue #2: Step Outputs NOT Persisted to Database

**File**: `lib/pilot/StepExecutor.ts:410-422`

Step outputs are recorded in `workflow_step_executions` table but:

```typescript
await this.stateManager.updateStepExecution(
  context.executionId,
  step.id,
  'completed',
  {
    success: true,
    execution_time: executionTime,
    tokens_used: tokensUsed || undefined,
    item_count: Array.isArray(result) ? result.length : undefined,
    output_data: outputData, // ⚠️ SANITIZED! Only first 10 keys, arrays limited to 3 items
    completed_at: new Date().toISOString(),
  }
);
```

**Problems**:
1. **Sanitized**: Only stores first 10 keys, arrays truncated to 3 items
2. **Not used for resume**: `StateManager.resumeExecution()` doesn't query this table
3. **Incomplete data**: Cannot be used to reconstruct full StepOutput

### Issue #3: WorkflowPilot.resume() Assumes Fresh Start

**File**: `lib/pilot/WorkflowPilot.ts:1854-1858`

```typescript
// 3. Filter to only incomplete steps (skip completed and failed)
const remainingSteps = executionPlan.steps.filter(step =>
  !context.completedSteps.includes(step.stepId) &&
  !context.failedSteps.includes(step.stepId)
);
```

**The Logic**:
- Skip steps in `completedSteps[]` (assume they already ran)
- Execute only remaining steps

**The Problem**:
- Skipped steps' outputs are NOT available in context
- Remaining steps that depend on skipped steps will FAIL

### Issue #4: Fix-Hardcode API Updates workflow_steps but Execution Uses Stale Data

**Previously identified issue** (NOW FIXED):
- We updated both `pilot_steps` AND `workflow_steps` fields
- WorkflowPilot now loads fresh agent from DB

**But still broken because**: Even with correct workflow definition, data from previous steps is lost!

---

## Data Flow Diagram (Current - BROKEN)

```
FIRST EXECUTION (FAILS AT STEP 2)
═══════════════════════════════════

Step 1: Get Emails ✅
├─ Executes successfully
├─ Output: { emails: [...100 emails...] }
├─ Stored in: context.stepOutputs.set('step1', output)
└─ Recorded in DB: workflow_step_executions (sanitized to 3 emails)

Step 2: Filter Urgent Emails ❌
├─ Tries to access: {{step1.emails}}
├─ Resolves from: context.getStepOutput('step1') ✅ (in memory)
├─ FAILS: "Range 'UrgentEmails' not found"
└─ Execution stops with status='failed'

ExecutionContext saved to DB:
├─ execution_trace: { completedSteps: ['step1'], failedSteps: ['step2'] }
├─ total_tokens_used: 1000
├─ total_execution_time_ms: 5000
└─ stepOutputs: NOT SAVED ❌

══════════════════════════════════════════════════════════════════

USER FIXES HARDCODED VALUE
═══════════════════════════
- Changes "UrgentEmails" → "DefinedRange"
- Updates workflow_steps AND pilot_steps ✅
- Clicks "Retry with Fixed Value"

══════════════════════════════════════════════════════════════════

RESUME EXECUTION (BREAKS IMMEDIATELY!)
═══════════════════════════════════════

StateManager.resumeExecution(executionId):
├─ Fetch workflow_executions from DB
├─ Fetch agent from DB (has UPDATED workflow_steps) ✅
├─ Create NEW ExecutionContext
├─ Restore from DB:
│  ├─ completedSteps: ['step1'] ✅
│  ├─ failedSteps: ['step2']
│  ├─ totalTokensUsed: 1000
│  └─ totalExecutionTime: 5000
└─ stepOutputs: EMPTY Map() ❌❌❌

Resume API clears failed steps:
├─ execution_trace.failedSteps = [] ✅
└─ Status = 'running' ✅

WorkflowPilot.resume():
├─ Parse workflow (agent.workflow_steps) ✅ (has fix)
├─ Filter remaining steps:
│  └─ remainingSteps = ['step2', 'step3', 'step4', ...]
│     (step1 is in completedSteps, so it's SKIPPED)
│
└─ Execute step2:
   ├─ Uses FIXED workflow definition ✅
   ├─ Tries to resolve: {{step1.emails}}
   ├─ Calls: context.getStepOutput('step1')
   ├─ Returns: undefined ❌❌❌
   └─ ERROR: "Variable step1.emails not found"

RESULT: Step 2 STILL FAILS (different error now!)
```

---

## Why All Steps Failed After Step 2

You reported: "all steps failed after step 2"

**Explanation**:
1. Step 2 tried to access `{{step1.emails}}` → NOT FOUND → FAILED
2. Step 3 tried to access `{{step2.urgent_emails}}` → NOT FOUND (step 2 failed) → FAILED
3. Step 4 tried to access `{{step3.data}}` → NOT FOUND → FAILED
4. ... cascade failure continues

**Chain Reaction**:
```
Step 1 (completed before) → output LOST on resume
  ↓ (missing data)
Step 2 (retried) → FAILS (can't find step1.emails)
  ↓ (failed, no output)
Step 3 → FAILS (can't find step2.data)
  ↓ (failed, no output)
Step 4 → FAILS (can't find step3.data)
  ↓
...
```

---

## What SHOULD Happen

### Option A: Re-execute ALL Steps (Safest)

```typescript
// On resume after fixing hardcoded value:
1. Clear ALL execution state (completed/failed/skipped steps)
2. Reset stepOutputs Map
3. Execute ENTIRE workflow from step 1 with FIXED workflow_steps
4. All steps get fresh data from their dependencies
```

**Pros**:
- Guaranteed data consistency
- Simple implementation
- No data loss issues

**Cons**:
- Re-runs steps that already succeeded
- Uses more tokens/quota
- Takes longer

### Option B: Restore Step Outputs from Database (Complex)

```typescript
// On resume:
1. Query workflow_step_executions for completed steps
2. Reconstruct StepOutput objects from output_data
3. Populate context.stepOutputs Map
4. Resume from failed step
```

**Pros**:
- Faster (skips completed steps)
- More efficient token usage

**Cons**:
- **BROKEN**: output_data is sanitized (incomplete!)
- Cannot reconstruct full StepOutput
- High complexity
- Fragile (data may be stale)

### Option C: Hybrid - Re-execute Dependencies Only

```typescript
// On resume:
1. Analyze failed step's dependencies
2. Re-execute only required upstream steps
3. Then retry failed step
```

**Pros**:
- Balances efficiency and correctness
- Fresher data than option B

**Cons**:
- Complex dependency analysis
- May still re-execute many steps

---

## Recommended Fix: Option A (Re-execute All Steps)

### Why Option A?

1. **Calibration Context**: Users expect to test the FULL workflow after making changes
2. **Data Freshness**: Re-running ensures all data is current (e.g., if spreadsheet changed)
3. **Simplicity**: Minimal code changes, low risk of bugs
4. **User Expectations**: After fixing hardcoded value, user wants to see "does my workflow work now?"

### Implementation

#### Change 1: Update Resume API to Clear All State

**File**: `app/api/calibrate/resume/route.ts`

**Current** (lines 164-186):
```typescript
// Clear the failedSteps array and update execution status
const updatedTrace = {
  ...executionTrace,
  failedSteps: [], // Clear failed steps so they'll be retried
};

await supabaseAdmin
  .from('workflow_executions')
  .update({
    execution_trace: updatedTrace,
    failed_steps_count: 0,
    status: 'running',
    updated_at: new Date().toISOString(),
  })
  .eq('id', executionId);
```

**Should be**:
```typescript
// CLEAR ALL EXECUTION STATE - re-execute entire workflow
const updatedTrace = {
  completedSteps: [],  // ← CLEAR completed steps
  failedSteps: [],     // ← CLEAR failed steps
  skippedSteps: [],    // ← CLEAR skipped steps
};

await supabaseAdmin
  .from('workflow_executions')
  .update({
    execution_trace: updatedTrace,
    completed_steps_count: 0,      // ← RESET
    failed_steps_count: 0,          // ← RESET
    skipped_steps_count: 0,         // ← RESET
    current_step: null,             // ← RESET
    total_tokens_used: 0,           // ← RESET (will recalculate)
    total_execution_time_ms: 0,     // ← RESET (will recalculate)
    status: 'running',
    updated_at: new Date().toISOString(),
  })
  .eq('id', executionId);

requestLogger.info('Cleared ALL execution state - will re-execute entire workflow');
```

#### Change 2: Update StateManager to Support Fresh Resume

**File**: `lib/pilot/StateManager.ts:564-586`

**Current**:
```typescript
// Reconstruct ExecutionContext from checkpoint
const context = new ExecutionContext(
  data.id,
  agent,
  data.user_id,
  data.session_id,
  data.input_values || {}
);

// Restore state
context.status = 'running';
context.currentStep = data.current_step;
context.completedSteps = data.execution_trace?.completedSteps || [];
context.failedSteps = data.execution_trace?.failedSteps || [];
context.skippedSteps = data.execution_trace?.skippedSteps || [];
context.totalTokensUsed = data.total_tokens_used || 0;
context.totalExecutionTime = data.total_execution_time_ms || 0;
context.startedAt = new Date(data.started_at);
```

**Should be** (add fresh start mode):
```typescript
// Reconstruct ExecutionContext from checkpoint
const context = new ExecutionContext(
  data.id,
  agent,
  data.user_id,
  data.session_id,
  data.input_values || {}
);

// Restore state
context.status = 'running';

// Check if this is a fresh restart (all arrays empty = user fixed workflow and wants full retry)
const isFreshRestart =
  (!data.execution_trace?.completedSteps || data.execution_trace.completedSteps.length === 0) &&
  (!data.execution_trace?.failedSteps || data.execution_trace.failedSteps.length === 0);

if (isFreshRestart) {
  // Fresh restart - start from beginning with empty state
  console.log('[StateManager] Fresh restart detected - starting from step 1');
  context.currentStep = null;
  context.completedSteps = [];
  context.failedSteps = [];
  context.skippedSteps = [];
  context.totalTokensUsed = 0;
  context.totalExecutionTime = 0;
  // Keep original startedAt to track total time including retries
} else {
  // Partial resume - restore checkpoint state
  console.log('[StateManager] Partial resume - continuing from checkpoint');
  context.currentStep = data.current_step;
  context.completedSteps = data.execution_trace?.completedSteps || [];
  context.failedSteps = data.execution_trace?.failedSteps || [];
  context.skippedSteps = data.execution_trace?.skippedSteps || [];
  context.totalTokensUsed = data.total_tokens_used || 0;
  context.totalExecutionTime = data.total_execution_time_ms || 0;
}

context.startedAt = new Date(data.started_at);
```

#### Change 3: Update WorkflowPilot.resume() to Handle Fresh Start

**File**: `lib/pilot/WorkflowPilot.ts:1854-1858`

**Current**:
```typescript
// 3. Filter to only incomplete steps (skip completed and failed)
const remainingSteps = executionPlan.steps.filter(step =>
  !context.completedSteps.includes(step.stepId) &&
  !context.failedSteps.includes(step.stepId)
);
```

**Should be**:
```typescript
// 3. Determine which steps to execute
let stepsToExecute: ExecutionStep[];

if (context.completedSteps.length === 0 && context.failedSteps.length === 0) {
  // Fresh restart - execute ALL steps
  console.log('🔄 [WorkflowPilot] Fresh restart - executing entire workflow');
  stepsToExecute = executionPlan.steps;
} else {
  // Partial resume - filter to only incomplete steps
  console.log('⏭️  [WorkflowPilot] Partial resume - skipping completed steps');
  stepsToExecute = executionPlan.steps.filter(step =>
    !context.completedSteps.includes(step.stepId) &&
    !context.failedSteps.includes(step.stepId)
  );
}

const remainingSteps = stepsToExecute;
```

---

## Alternative: Add Option to UI

**Better UX**: Let user choose:

```typescript
// Repair Options UI (after parameter error detected):
┌────────────────────────────────────────────────────┐
│ Step 2 Failed: Range 'UrgentEmails' not found     │
├────────────────────────────────────────────────────┤
│ How would you like to proceed?                     │
│                                                     │
│ 🔄 Re-run Entire Workflow (Recommended)            │
│    ✓ Ensures all data is fresh                     │
│    ✓ Tests complete workflow after fix             │
│    ⚠  Uses more tokens                             │
│                                                     │
│ ⚡ Continue from Failed Step (Advanced)            │
│    ✓ Faster, skips completed steps                 │
│    ⚠  May fail if data from previous steps needed  │
│                                                     │
│ ✏️  Edit Workflow (Manual)                         │
│    Navigate to wizard to edit step definitions     │
└────────────────────────────────────────────────────┘
```

**Implementation**:
- Add `resumeMode: 'full' | 'partial'` parameter to `/api/calibrate/resume`
- Default to `'full'` for safety
- Advanced users can choose `'partial'` if they know their fix doesn't affect data flow

---

## Impact Analysis

### Current State (BROKEN)
- ❌ Cannot resume from failed step after fixing hardcoded value
- ❌ All subsequent steps fail with "missing data" errors
- ❌ User cannot complete calibration without recreating agent

### After Fix (Option A)
- ✅ Resume re-executes entire workflow with fixed definition
- ✅ All steps have access to fresh data
- ✅ Calibration completes successfully
- ⚠️  Uses more tokens (acceptable for calibration)

### After Fix (UI Option)
- ✅ User has control over resume strategy
- ✅ Power users can optimize for speed
- ✅ Default behavior is safe (full re-run)

---

## Testing Plan

### Test Case 1: Basic Resume After Fix
1. Create agent with 5 steps (step 2 has hardcoded value)
2. Run calibration → fails at step 2
3. Fix hardcoded value
4. Click "Retry with Fixed Value"
5. **Expected**: All 5 steps execute successfully
6. **Verify**: Step 3+ can access step 1-2 outputs

### Test Case 2: Verify Data Freshness
1. Agent reads from spreadsheet in step 1
2. Fails at step 3 (hardcoded value)
3. Update spreadsheet (add new row)
4. Fix hardcoded value and retry
5. **Expected**: Step 1 reads NEW data from spreadsheet
6. **Verify**: Final output includes new row

### Test Case 3: Token Tracking
1. Run calibration → fails at step 5 (used 1000 tokens for steps 1-4)
2. Fix and retry
3. **Expected**: Token count resets to 0, then counts up as steps re-execute
4. **Verify**: Final total_tokens_used is accurate for full run

---

## Files to Modify

1. ✅ `/app/api/calibrate/resume/route.ts` (lines 164-186) - Clear all state
2. ✅ `/lib/pilot/StateManager.ts` (lines 564-586) - Support fresh restart mode
3. ✅ `/lib/pilot/WorkflowPilot.ts` (lines 1854-1858) - Execute all steps on fresh restart

**Optional** (for UI option):
4. `/app/api/calibrate/resume/route.ts` - Add `resumeMode` parameter
5. `/app/v2/sandbox/[agentId]/page.tsx` - Add UI toggle for resume mode
6. `/components/v2/insights/HardcodeRepairModal.tsx` - Show resume mode options

---

## Summary

**Root Cause**: ExecutionContext.stepOutputs Map is NOT restored on resume, causing all dependent steps to fail with "missing data" errors.

**Recommended Fix**: Re-execute entire workflow from step 1 after fixing hardcoded values (clear all execution state).

**Why This Works**: Guarantees data consistency, ensures fresh data, aligns with user expectations for calibration testing.

**Risk**: Very Low - Simple state reset, no data restoration logic needed.

**User Impact**: Positive - Calibration actually works after fixing hardcoded values!
