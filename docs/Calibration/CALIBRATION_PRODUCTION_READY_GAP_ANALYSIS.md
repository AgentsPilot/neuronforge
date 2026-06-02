# Calibration Production-Ready Gap Analysis

> **Created**: 2026-04-28
> **Critical Issues**: View is empty + Production-ready workflows need special handling

---

## Issue 1: `calibration_success_metrics` View is Empty

### Why It's Empty
`calibration_success_metrics` is a **VIEW** (not a table) that aggregates data from `calibration_history`:

```sql
CREATE OR REPLACE VIEW calibration_success_metrics AS
SELECT
  DATE_TRUNC('day', created_at) as date,
  status,
  COUNT(*) as count,
  AVG(iterations) as avg_iterations,
  AVG(auto_fixes_applied) as avg_fixes,
  AVG(execution_time_ms) as avg_execution_time_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY iterations) as median_iterations
FROM calibration_history                    -- ← Source table
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at), status
ORDER BY date DESC, status;
```

**The view is empty because:**
1. ❌ `calibration_history` table doesn't exist yet (migration not applied)
2. ❌ Even after migration, table will be empty until first calibration runs
3. ❌ View only shows last 30 days of data

### Solution
The view will automatically populate once:
1. Migration is applied (`20260428_calibration_history_table.sql`)
2. Users run calibrations (data gets inserted into `calibration_history`)
3. View aggregates that data

**No action needed** - this is expected behavior for a new table.

---

## Issue 2: Production-Ready Workflows - Preventing Unnecessary Calibrations

### The Problem

**Scenario:**
1. User creates workflow
2. Runs calibration → All issues fixed → `status: 'success'`, `quality_score: 100`
3. **User DOES NOT mark as production_ready yet** (still testing)
4. User runs calibration again (by mistake or on purpose)
5. Current code: Fast path triggers → "Already calibrated, skipping"

**Why this is wrong:**
- Workflow is NOT production-ready yet
- User might want to test more, see the full calibration output
- Fast path prevents them from seeing calibration details again

### Current Fast Path Logic (Lines 112-157)

```typescript
if (lastSuccessful && !workflowHasChanged) {
  // Fast path: Skip calibration
  return { alreadyCalibrated: true };
}
```

**Missing check:** `production_ready` status

---

## Solution: Enhanced Fast Path with Production-Ready Check

### Database Schema Update

The `agents` table already has `production_ready`:
```sql
production_ready BOOLEAN DEFAULT false,
production_ready_at TIMESTAMP WITH TIME ZONE
```

But we should also track this in `calibration_history`:

```sql
ALTER TABLE calibration_history
ADD COLUMN marked_production_ready BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN marked_production_ready_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN calibration_history.marked_production_ready IS
'True if workflow was marked production_ready after this calibration';

COMMENT ON COLUMN calibration_history.marked_production_ready_at IS
'When workflow was marked production_ready (may be null if not marked yet)';
```

### Enhanced Fast Path Logic

```typescript
// 5a. Check if workflow is already calibrated and production-ready
const { generateWorkflowHash, hasWorkflowChanged } = await import('@/lib/utils/workflowHash');
const currentWorkflowHash = generateWorkflowHash(workflowSteps);
const workflowHasChanged = hasWorkflowChanged(workflowSteps, agent.workflow_hash || null);

// Check calibration history for existing successful calibration
const calibrationHistoryRepo = new CalibrationHistoryRepository(supabase);
const { data: lastSuccessful } = await calibrationHistoryRepo.getLastSuccessful(agentId, user.id);

// CRITICAL: Only use fast path if workflow is production-ready AND fully calibrated
const isProductionReady = agent.production_ready === true;
const isFullyCalibrated = lastSuccessful &&
                          !workflowHasChanged &&
                          lastSuccessful.calibration_quality_score === 100; // ← NEW field (see other analysis)

if (isProductionReady && isFullyCalibrated) {
  logger.info({
    agentId,
    lastCalibrationAt: lastSuccessful.created_at,
    workflowHash: currentWorkflowHash,
    calibrationId: lastSuccessful.id,
    productionReady: true,
    qualityScore: lastSuccessful.calibration_quality_score
  }, 'Production-ready workflow with perfect calibration - running verification only');

  // Run single verification execution
  const pilot = new WorkflowPilot(supabase, {
    enableBatchCalibration: false,
    enableSmartContinuation: false
  });

  const verificationResult = await pilot.executeWorkflow({
    agent,
    inputValues,
    executionId: `verification-${Date.now()}`
  });

  if (verificationResult.success && verificationResult.stepsFailed === 0) {
    logger.info({
      agentId,
      executionId: verificationResult.executionId,
      stepsCompleted: verificationResult.stepsCompleted
    }, 'Verification successful - production workflow still working');

    return NextResponse.json({
      success: true,
      alreadyCalibrated: true,
      productionReady: true,
      executionId: verificationResult.executionId,
      message: 'Production-ready workflow verified successfully. No calibration needed.',
      lastCalibration: {
        status: 'success',
        calibratedAt: lastSuccessful.created_at,
        iterations: lastSuccessful.iterations,
        autoFixesApplied: lastSuccessful.auto_fixes_applied,
        qualityScore: lastSuccessful.calibration_quality_score
      },
      verification: {
        stepsCompleted: verificationResult.stepsCompleted,
        stepsFailed: 0,
        executionTimeMs: verificationResult.executionTimeMs
      }
    });
  } else {
    // Verification failed - workflow may have regressed
    logger.warn({
      agentId,
      stepsFailed: verificationResult.stepsFailed,
      errors: verificationResult.errors
    }, 'Production workflow verification failed - running full calibration');

    // Continue to full calibration (don't return early)
  }
} else if (lastSuccessful && !workflowHasChanged && !isProductionReady) {
  // Workflow is calibrated but NOT production-ready
  // User might be testing - allow full calibration but inform them
  logger.info({
    agentId,
    lastCalibrationAt: lastSuccessful.created_at,
    productionReady: false,
    qualityScore: lastSuccessful.calibration_quality_score
  }, 'Workflow is calibrated but not production-ready - allowing full calibration for testing');

  // Don't return early - let full calibration run
  // But we could optionally add a warning in the response
} else if (workflowHasChanged) {
  logger.info({
    agentId,
    lastStatus: lastSuccessful?.status,
    workflowChanged: true,
    lastCalibrationId: lastSuccessful?.id
  }, 'Workflow has changed since last calibration - running full calibration');

  // Continue to full calibration
}

// Continue with regular calibration flow...
```

---

## Complete Decision Matrix

| Condition | Action | Reason |
|-----------|--------|--------|
| **No previous calibration** | Full calibration | Never calibrated before |
| **Workflow changed** | Full calibration | Hash mismatch → workflow modified |
| **Input schema changed** | Full calibration | New field → may need fixes |
| **Production-ready = false** | Full calibration | User testing → allow re-calibration |
| **Production-ready = true + Quality = 100 + Hash matches** | Verification only | Fast path ✅ |
| **Production-ready = true + Quality < 100** | Full calibration | Had issues before → re-check |
| **Production-ready = true + Verification fails** | Full calibration | Regression detected |

---

## Updated Calibration History Schema

### Add to Migration

```sql
-- Track production-ready status at calibration time
ALTER TABLE calibration_history
ADD COLUMN marked_production_ready BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN marked_production_ready_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN calibration_quality_score INTEGER CHECK (calibration_quality_score >= 0 AND calibration_quality_score <= 100),
ADD COLUMN input_schema_hash TEXT;

-- Add index for production-ready fast path queries
CREATE INDEX idx_calibration_history_production_ready
ON calibration_history(agent_id, marked_production_ready, calibration_quality_score)
WHERE marked_production_ready = true;

-- Comments
COMMENT ON COLUMN calibration_history.marked_production_ready IS
'True if workflow was marked production_ready after this calibration';

COMMENT ON COLUMN calibration_history.marked_production_ready_at IS
'When workflow was marked production_ready (null if not marked)';

COMMENT ON COLUMN calibration_history.calibration_quality_score IS
'Quality: 100=perfect (0 issues), 95=excellent (all auto-fixed), 75=good (minor warnings), 40=needs review, 0=failed';

COMMENT ON COLUMN calibration_history.input_schema_hash IS
'SHA-256 hash of agent.input_schema - detects input changes that invalidate workflow';
```

---

## When to Update `marked_production_ready`

### Option 1: User Explicitly Marks as Production-Ready

When user clicks "Mark as Production Ready" button:

```typescript
// In the API that marks agent as production_ready
await supabase
  .from('agents')
  .update({
    production_ready: true,
    production_ready_at: new Date().toISOString()
  })
  .eq('id', agentId);

// ALSO update the last calibration record
if (agent.last_successful_calibration_id) {
  await supabase
    .from('calibration_history')
    .update({
      marked_production_ready: true,
      marked_production_ready_at: new Date().toISOString()
    })
    .eq('id', agent.last_successful_calibration_id);
}
```

### Option 2: Auto-mark During Perfect Calibration

If calibration is perfect (quality = 100) and user doesn't intervene:

```typescript
// In batch/route.ts after successful calibration
if (calibrationQualityScore === 100 && agent.production_ready !== true) {
  // Suggest to user: "Workflow is perfect! Mark as production-ready?"
  // Or auto-mark with notification
}
```

---

## Quality Score Calculation (Required for Fast Path)

```typescript
function calculateCalibrationQualityScore(result: {
  status: string;
  issues_found: any[];
  issues_remaining: any[];
  steps_failed: number;
  auto_fixes_applied: number;
}): number {
  // Failed calibration
  if (result.status === 'failed') {
    return 0;
  }

  // Perfect - no issues found at all
  if (result.status === 'success' &&
      result.issues_found.length === 0 &&
      result.steps_failed === 0) {
    return 100;
  }

  // Excellent - all issues auto-fixed
  if (result.status === 'success' &&
      result.issues_remaining.length === 0 &&
      result.steps_failed === 0) {
    return 95;
  }

  // Good - only minor warnings remain
  const criticalRemaining = result.issues_remaining.filter(
    (i: any) => i.severity === 'high' || i.severity === 'critical'
  ).length;

  if (result.status === 'success' &&
      criticalRemaining === 0 &&
      result.steps_failed === 0) {
    return 75;
  }

  // Needs review - has critical issues or failed steps
  if (result.status === 'needs_review' || criticalRemaining > 0) {
    return 40;
  }

  // Default for any other "success" with issues
  return 50;
}
```

---

## Summary of Required Changes

### 1. Database Migration
```sql
ALTER TABLE calibration_history
ADD COLUMN marked_production_ready BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN marked_production_ready_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN calibration_quality_score INTEGER CHECK (calibration_quality_score >= 0 AND calibration_quality_score <= 100),
ADD COLUMN input_schema_hash TEXT,
ADD COLUMN v6_version TEXT,
ADD COLUMN model_used TEXT;
```

### 2. Update Batch Calibration API

**Lines 112-157** - Enhanced fast path check:
```typescript
const isProductionReady = agent.production_ready === true;
const isFullyCalibrated = lastSuccessful?.calibration_quality_score === 100;

if (isProductionReady && isFullyCalibrated && !workflowHasChanged) {
  // Fast path: verification only
}
```

**Lines 3854-3874** - Save quality score and hashes:
```typescript
const qualityScore = calculateCalibrationQualityScore({
  status: 'success',
  issues_found: [],
  issues_remaining: [],
  steps_failed: 0,
  auto_fixes_applied: autoFixesApplied
});

const inputSchemaHash = generateInputSchemaHash(agent.input_schema);

await calibrationHistoryRepo.create({
  // ... existing fields
  calibration_quality_score: qualityScore,
  input_schema_hash: inputSchemaHash,
  marked_production_ready: agent.production_ready === true,
  marked_production_ready_at: agent.production_ready_at,
  v6_version: process.env.V6_VERSION || null,
  model_used: null // TODO: get from provider factory
});
```

### 3. Create Hash Utilities

**File:** `lib/utils/workflowHash.ts` (add to existing file)

```typescript
export function generateInputSchemaHash(inputSchema: any): string {
  if (!inputSchema) return '';

  // Normalize schema (remove UI metadata)
  const normalized = Array.isArray(inputSchema)
    ? inputSchema.map(field => ({
        name: field.name,
        type: field.type,
        required: field.required,
        description: field.description
      }))
    : inputSchema;

  const canonicalJSON = JSON.stringify(normalized, Object.keys(normalized).sort());
  return createHash('sha256').update(canonicalJSON).digest('hex');
}

export function hasInputSchemaChanged(
  currentSchema: any,
  lastCalibrationHash: string | null
): boolean {
  if (!lastCalibrationHash) return true;
  const currentHash = generateInputSchemaHash(currentSchema);
  return currentHash !== lastCalibrationHash;
}
```

---

## Testing Scenarios

### Scenario 1: Non-Production Workflow
1. Create workflow
2. Run calibration → success, quality = 100
3. production_ready = false
4. Run calibration again
5. **Expected**: Full calibration runs (user is testing)

### Scenario 2: Production Workflow - Perfect
1. Create workflow
2. Run calibration → success, quality = 100
3. Mark as production_ready = true
4. Run calibration again
5. **Expected**: Fast path → verification only

### Scenario 3: Production Workflow - Regression
1. Production workflow (quality = 100)
2. Run calibration → verification fails
3. **Expected**: Full calibration runs (detected regression)

### Scenario 4: Production Workflow - Changed
1. Production workflow (quality = 100)
2. User edits workflow
3. Run calibration
4. **Expected**: Full calibration (workflow_hash changed)

### Scenario 5: Production Workflow - Input Schema Changed
1. Production workflow (quality = 100)
2. User adds required input field
3. Run calibration
4. **Expected**: Full calibration (input_schema_hash changed)

---

## Benefits

### 1. Correct Fast Path Behavior
- ✅ Production workflows: Fast verification
- ✅ Testing workflows: Full calibration allowed
- ✅ Changed workflows: Always recalibrate
- ✅ Regressions: Detected and handled

### 2. Better Analytics
- Track when workflows become production-ready
- Correlate production-ready status with quality scores
- Monitor production workflow stability

### 3. Better UX
- Users can test freely without fast path blocking them
- Clear distinction between "testing" and "production" modes
- Production workflows are protected but verified

---

## Implementation Priority

### Critical (Block Release)
1. ✅ `calibration_quality_score` calculation and storage
2. ✅ `production_ready` check in fast path logic
3. ✅ `input_schema_hash` generation and comparison

### High Priority (Next Sprint)
4. ⬜ `marked_production_ready` tracking in calibration_history
5. ⬜ `v6_version` and `model_used` tracking
6. ⬜ Update "Mark as Production Ready" API to update calibration_history

### Medium Priority (Future)
7. ⬜ UI indicator: "This workflow is production-ready and verified"
8. ⬜ Analytics dashboard for production workflow health
