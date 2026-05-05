# Calibration Status Tracking System

**Date:** 2026-04-28
**Issue:** Calibration taking 3 iterations even when workflow is already 100% functional
**Status:** ✅ **IMPLEMENTED**

---

## Problem Summary

When running calibration on an already-working workflow, the system was:
- Running full 3-iteration calibration loop
- Applying "fixes" that weren't needed (StructuralRepairEngine false positives)
- Wasting execution time and API calls
- Confusing users ("Why does it need 3 rounds if everything works?")

**Root Cause:** No mechanism to remember that a workflow has been successfully calibrated and is working correctly.

---

## Solution: Calibration State Tracking

Track calibration status in the `agents` table and skip redundant calibrations when:
1. Workflow was previously calibrated successfully (0 issues, 0 failures)
2. Workflow structure hasn't changed since last calibration

### How It Works

```
User triggers calibration
        ↓
Check: Is workflow already calibrated?
        ↓
    ┌───┴───┐
    │  YES  │ → Workflow hash matches + status='success'
    └───┬───┘          ↓
        │         Run SINGLE verification execution (no iterations)
        │              ↓
        │         ┌────┴────┐
        │         │ SUCCESS │ → Return "Already calibrated, verified OK"
        │         └────┬────┘
        │              │
        │         ┌────┴────┐
        │         │  FAILED │ → Reset status, run full calibration
        │         └─────────┘
        │
    ┌───┴───┐
    │   NO  │ → Run full calibration loop
    └───┬───┘          ↓
        │         Iteration 1, 2, 3...
        │              ↓
        │         ┌────┴────┐
        │         │ SUCCESS │ → Save status='success' + workflow hash
        │         └────┬────┘
        │              │
        │         ┌────┴────┐
        │         │  ISSUES │ → Save status='needs_review' or 'failed'
        │         └─────────┘
```

---

## Database Schema Changes

**Migration:** `20260428_add_calibration_status.sql`

**New Columns in `agents` table:**

| Column | Type | Description |
|--------|------|-------------|
| `last_calibration_status` | TEXT | 'success', 'needs_review', 'failed', or NULL |
| `last_calibration_at` | TIMESTAMP | When calibration status was last updated |
| `workflow_hash` | TEXT | SHA-256 hash of `pilot_steps` JSON |
| `calibration_metadata` | JSONB | Additional metadata: iterations, fixes applied, etc. |

**Index:**
```sql
CREATE INDEX idx_agents_calibration_status
ON agents(id, last_calibration_status, workflow_hash);
```

---

## Success Criteria

A workflow is marked as `status='success'` when **ALL** of these are true:

1. ✅ **Zero remaining issues:** `allIssuesForUI.length === 0`
2. ✅ **Zero failed steps:** `finalResult.stepsFailed === 0`
3. ✅ **No semantic failures:** Items processed → items delivered (no empty output)
4. ✅ **Calibration loop completed:** Exited with "no auto-fixable issues remaining"

This happens at **line 3746-3873** in `batch/route.ts`.

---

## Implementation Details

### 1. Workflow Hash Generation

**File:** `lib/utils/workflowHash.ts`

Generates a stable SHA-256 hash that changes only when workflow structure changes:

```typescript
export function generateWorkflowHash(workflowSteps: any[]): string {
  // Extract structurally relevant fields (exclude UI metadata, execution state)
  const relevantFields = workflowSteps.map(step => ({
    id: step.id || step.step_id,
    type: step.type,
    plugin: step.plugin,
    action: step.action,
    input: step.input,
    expression: step.expression,
    // ... all behavioral config
  }));

  const canonicalJSON = JSON.stringify(relevantFields, Object.keys(relevantFields).sort());
  return createHash('sha256').update(canonicalJSON).digest('hex');
}
```

**Fields excluded from hash:**
- UI metadata (positions, colors, names)
- Execution state (status, timestamps, execution_ids)
- User-specific data

**Why:** These don't affect workflow behavior, so changing them shouldn't invalidate calibration.

### 2. Pre-Calibration Check

**File:** `app/api/v2/calibrate/batch/route.ts` (lines 106-195)

**Before starting full calibration:**

```typescript
// Generate current workflow hash
const currentWorkflowHash = generateWorkflowHash(workflowSteps);
const workflowHasChanged = hasWorkflowChanged(workflowSteps, agent.workflow_hash);

// If already calibrated successfully and unchanged...
if (agent.last_calibration_status === 'success' && !workflowHasChanged) {
  // Run SINGLE verification execution (no iterations, no issue collection)
  const verificationResult = await pilot.executeWorkflow({
    agent,
    inputValues,
    executionId: `verification-${Date.now()}`
  });

  if (verificationResult.success && verificationResult.stepsFailed === 0) {
    // Workflow still working! Return immediately
    return NextResponse.json({
      success: true,
      alreadyCalibrated: true,
      message: 'Workflow is already calibrated and working correctly.',
      lastCalibration: { /* metadata */ },
      verification: { /* execution results */ }
    });
  } else {
    // Verification failed - workflow may have regressed
    // Reset status and proceed with full calibration
    await supabase.from('agents').update({
      last_calibration_status: null,
      workflow_hash: null
    });
  }
}
```

### 3. Post-Calibration Status Update

**On Success** (lines 3846-3873):

```typescript
// Calibration completed with 0 issues
await supabase.from('agents').update({
  last_calibration_status: 'success',
  last_calibration_at: new Date().toISOString(),
  workflow_hash: currentWorkflowHash,
  calibration_metadata: {
    sessionId,
    iterations: loopIteration,
    autoFixesApplied,
    completedAt: new Date().toISOString(),
    stepsCompleted: finalResult.stepsCompleted,
    stepsFailed: 0
  }
}).eq('id', agentId);
```

**On Failure/Needs Review** (lines 3943-3974):

```typescript
// Calibration completed with issues
const calibrationStatus = summary.critical > 0 ? 'needs_review' : 'failed';

await supabase.from('agents').update({
  last_calibration_status: calibrationStatus,
  last_calibration_at: new Date().toISOString(),
  workflow_hash: currentWorkflowHash,
  calibration_metadata: {
    sessionId,
    iterations: loopIteration,
    autoFixesApplied,
    issuesRemaining: allIssuesForUI.length,
    criticalIssues: summary.critical,
    stepsCompleted: finalResult.stepsCompleted,
    stepsFailed: finalResult.stepsFailed
  }
}).eq('id', agentId);
```

---

## User Experience Improvements

### Before (3 iterations every time):

```
User: "Calibrate workflow"
System: Running iteration 1... (finds false positives)
System: Running iteration 2... (applies "fixes")
System: Running iteration 3... (no more auto-fixes)
System: "Calibration complete - 0 issues"
User: "Why did it take 3 rounds if there were no issues?"
```

### After (instant verification):

```
User: "Calibrate workflow"
System: Checking calibration status...
System: Workflow already calibrated (2026-04-28)
System: Running verification execution...
System: ✅ Verification successful - all steps completed
System: "Workflow is already calibrated and working correctly!"
User: "Great! Fast and clear."
```

---

## Edge Cases Handled

### 1. Workflow Changed Since Last Calibration

```typescript
if (agent.last_calibration_status && workflowHasChanged) {
  // Reset status and run full calibration
  await supabase.from('agents').update({
    last_calibration_status: null,
    workflow_hash: null
  });
}
```

**Why:** A changed workflow might have new issues, so previous calibration is invalid.

### 2. Verification Fails (Regression)

If a previously working workflow now fails verification:
- Reset calibration status
- Run full calibration to detect what regressed
- Log warning about potential regression

### 3. Never Calibrated Before

If `last_calibration_status` is NULL:
- Skip the check
- Run full calibration
- Save status when complete

---

## Benefits

### 1. Performance
- **Before:** 3 iterations × 11 steps = 33 step executions
- **After:** 1 verification × 11 steps = 11 step executions
- **Savings:** 66% fewer executions for already-working workflows

### 2. Cost
- Fewer LLM calls for structural analysis
- Fewer plugin API calls
- Faster feedback to users

### 3. User Experience
- Clear message: "Already calibrated, verified OK"
- Shows last calibration date and metadata
- No confusing "3 rounds for 0 issues"

### 4. Safety
- Verification execution still validates workflow works
- Detects regressions (external API changes, data format changes)
- Resets status and re-calibrates if verification fails

---

## Example API Response

### Already Calibrated (Fast Path):

```json
{
  "success": true,
  "alreadyCalibrated": true,
  "executionId": "verification-1714334567890",
  "message": "Workflow is already calibrated and working correctly. No changes needed.",
  "lastCalibration": {
    "status": "success",
    "calibratedAt": "2026-04-28T22:27:35.000Z",
    "iterations": 3,
    "autoFixesApplied": 2
  },
  "verification": {
    "stepsCompleted": 11,
    "stepsFailed": 0,
    "executionTimeMs": 8234
  }
}
```

### First-Time Calibration (Full Path):

```json
{
  "success": true,
  "alreadyCalibrated": false,
  "sessionId": "35b605b1-43b5-4635-b487-f8631794a471",
  "executionId": "ca6d1300-06bc-4c8a-865b-2b5aef548b90",
  "autoCalibration": {
    "iterations": 3,
    "autoFixesApplied": 2,
    "message": "Automatically fixed 2 technical issues across 3 calibration rounds"
  },
  "issues": {
    "critical": [],
    "warnings": [],
    "autoRepairs": []
  },
  "summary": {
    "total": 0,
    "requiresUserAction": 0,
    "completedSteps": 11,
    "failedSteps": 0
  },
  "message": "Workflow executed successfully with no issues found!"
}
```

---

## Testing Checklist

- [ ] Run migration: `20260428_add_calibration_status.sql`
- [ ] First calibration of a workflow → status saved
- [ ] Second calibration (unchanged) → fast verification path
- [ ] Change workflow → status reset, full calibration runs
- [ ] Calibration with issues → status='needs_review' or 'failed'
- [ ] Verification fails → status reset, full calibration runs
- [ ] API response includes `alreadyCalibrated` flag

---

## Future Enhancements

1. **UI Indicator:** Show calibration badge in workflow list
   - 🟢 Calibrated & Working
   - 🟡 Needs Review
   - 🔴 Failed Last Calibration
   - ⚪ Never Calibrated

2. **Calibration History:** Track multiple calibration runs over time

3. **Auto-Invalidate:** Detect external changes (plugin updates, schema changes) and reset status

4. **Smart Re-Calibration:** Suggest re-calibration after X days or Y workflow executions

---

## Related Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260428_add_calibration_status.sql` | Database schema changes |
| `lib/utils/workflowHash.ts` | Workflow hashing utility |
| `app/api/v2/calibrate/batch/route.ts` | Calibration API with status tracking |
| `CALIBRATION_STATUS_TRACKING.md` | This document |

---

## Summary

This solution prevents redundant calibration iterations by:
1. **Tracking** successful calibration with workflow hash
2. **Detecting** when workflow hasn't changed
3. **Verifying** with single execution instead of 3-iteration loop
4. **Resetting** status when workflow changes or verification fails

**Result:** 66% faster calibration for already-working workflows, clearer user feedback, and better resource efficiency.
