# Convergence Detection for Calibration Loop

> **Last Updated**: 2026-04-21

## Overview

Convergence detection prevents infinite fix loops in the auto-calibration system by tracking which fixes have been applied to which steps and detecting circular dependencies.

## Problem Statement

Without convergence detection, the calibration system could enter infinite loops where:
1. Fix A is applied to Step 1 in iteration N
2. Fix A causes Issue B in Step 1
3. Fix B is applied to Step 1 in iteration N+1
4. Fix B reverts Fix A, recreating the original Issue A
5. Fix A is applied again in iteration N+2
6. **Loop continues until MAX_ITERATIONS (10) is reached**

This wastes compute resources, delays user feedback, and can fail to surface the actual root cause issue.

## Solution: Fix History Tracking

The convergence detection system maintains a `Map<stepId, Set<fixType>>` that tracks which fix types have been applied to each step.

### Implementation

**File**: `/app/api/v2/calibrate/batch/route.ts`

**Lines**: 233-257

```typescript
// CONVERGENCE DETECTION: Track which fixes were applied to which steps
// Key: stepId, Value: Set of fix types applied
const fixHistory = new Map<string, Set<string>>();

function trackFix(stepId: string, fixType: string): boolean {
  if (!fixHistory.has(stepId)) {
    fixHistory.set(stepId, new Set());
  }

  const fixes = fixHistory.get(stepId)!;

  // If we've seen this fix before on this step, we're in a loop
  if (fixes.has(fixType)) {
    logger.warn({
      sessionId,
      stepId,
      fixType,
      previousFixes: Array.from(fixes)
    }, 'Convergence issue detected: same fix applied multiple times to same step');
    return false; // Indicates convergence failure
  }

  fixes.add(fixType);
  return true; // Fix is new, can proceed
}
```

### Integration Points

Convergence checks are added before applying each fix type:

| Fix Type | Check Location | Fix Identifier |
|----------|----------------|----------------|
| **add_flatten_field** | Line ~1390 | `'add_flatten_field'` |
| **fix_parameter_reference** | Line ~1428 | `'fix_parameter_reference:{{fromRef}}'` |
| **parameter_rename** | Line ~1521 | `'parameter_rename:{{oldKey}}→{{newKey}}'` |
| **add_extraction_fallback** | Line ~1591 | `'add_extraction_fallback:{{field}}'` |

## Fix Identifier Design

Fix identifiers are designed to be **specific enough to catch true loops** while **generic enough to allow legitimate retries**:

### Good Identifiers (Specific)

✅ `'fix_parameter_reference:{{item.url}}'` - Catches loops on specific field reference

✅ `'parameter_rename:file_url→file_content'` - Catches loops on specific parameter rename

✅ `'add_extraction_fallback:invoice_number'` - Catches loops on specific field

### Bad Identifiers (Too Generic)

❌ `'fix_parameter_reference'` - Would block ALL parameter fixes after first one

❌ `'parameter_rename'` - Would block ALL renames after first one

## Behavior

### When Convergence Failure Detected

```typescript
if (!canApplyFix) {
  logger.warn({
    issueId: issue.id,
    stepId: proposal.targetStepId,
    fixType: 'add_flatten_field'
  }, 'CONVERGENCE FAILURE: Skipping fix that was already applied in previous iteration');
  continue; // Skip this fix, move to next
}
```

**Actions taken:**
1. Log warning with full context (sessionId, stepId, fixType, previousFixes)
2. **Skip the fix** (continue to next issue)
3. Do NOT increment `fixesAppliedThisRound`
4. Continue processing remaining fixes

**End result:**
- Iteration completes with fewer fixes applied
- If no other fixes were applied, loop exits with remaining unfixable issues
- User sees the convergence-failed issue as "requires user input"

### When Convergence Succeeds

```typescript
const canApplyFix = trackFix(stepId, fixType);
if (canApplyFix) {
  // Apply fix normally
  fixesAppliedThisRound++;
  logger.info({ ... }, 'Auto-fix applied');
}
```

**Actions taken:**
1. Fix is recorded in history
2. Fix is applied to workflow
3. Counter incremented
4. Loop continues normally

## Example Scenario

### Without Convergence Detection (Old Behavior)

```
Iteration 1:
  - Issue: "file_url not implemented, use file_content"
  - Fix: Rename config.file_url → config.file_content ✓
  - Persist to DB

Iteration 2:
  - Issue: "file_content not found in upstream data" (hypothetical)
  - Fix: Rename config.file_content → config.file_url ✓
  - Persist to DB

Iteration 3:
  - Issue: "file_url not implemented, use file_content" (SAME AS ITERATION 1)
  - Fix: Rename config.file_url → config.file_content ✓
  - Persist to DB

... loop continues until iteration 10
```

### With Convergence Detection (New Behavior)

```
Iteration 1:
  - Issue: "file_url not implemented, use file_content"
  - Fix: Rename config.file_url → config.file_content ✓
  - trackFix('step_123', 'parameter_rename:file_url→file_content') → true
  - Persist to DB

Iteration 2:
  - Issue: "file_content not found in upstream data" (hypothetical)
  - Fix: Rename config.file_content → config.file_url ✓
  - trackFix('step_123', 'parameter_rename:file_content→file_url') → true
  - Persist to DB

Iteration 3:
  - Issue: "file_url not implemented, use file_content" (SAME AS ITERATION 1)
  - Fix: Rename config.file_url → config.file_content
  - trackFix('step_123', 'parameter_rename:file_url→file_content') → false ❌
  - ⚠️ CONVERGENCE FAILURE DETECTED
  - Skip fix, continue to next issue

Iteration 3 (continued):
  - No more auto-fixable issues
  - Loop exits with: "Issue with parameter file_url - requires user review"
```

**User sees:**
- Calibration completes in 3 iterations (not 10)
- Clear indication that there's a conflict with parameter naming
- Can investigate why the workflow needs both file_url and file_content

## Metrics

### Logged Data

Every convergence check logs:
- `sessionId` - Calibration session
- `stepId` - Step where fix would be applied
- `fixType` - Type of fix being attempted
- `previousFixes` - Array of all fix types already applied to this step (only on failure)

### Analysis Queries

To find calibration sessions with convergence issues:

```sql
-- Find sessions with convergence failures
SELECT DISTINCT session_id, count(*) as failure_count
FROM calibration_logs
WHERE message LIKE '%CONVERGENCE FAILURE%'
GROUP BY session_id
ORDER BY failure_count DESC;

-- Find most common fix types that hit convergence
SELECT
  json_extract(metadata, '$.fixType') as fix_type,
  count(*) as occurrence_count
FROM calibration_logs
WHERE message LIKE '%CONVERGENCE FAILURE%'
GROUP BY fix_type
ORDER BY occurrence_count DESC;
```

## Testing

### Test Cases

| Scenario | Expected Behavior | Verifies |
|----------|-------------------|----------|
| **Single fix type applied twice to same step** | Second application blocked | Basic convergence detection |
| **Two different fix types on same step** | Both succeed | Fix type specificity |
| **Same fix type on different steps** | Both succeed | Step isolation |
| **Parameter rename A→B then B→A** | Both succeed (different identifiers) | Identifier specificity |
| **Parameter rename A→B twice** | Second blocked | Duplicate prevention |

### Manual Testing

1. Create agent with scatter-gather step using `file_url` parameter
2. Run calibration - should rename to `file_content`
3. Manually revert database change back to `file_url`
4. Run calibration again
5. **Expected**: Convergence failure detected on iteration 2

## Future Enhancements

### Checkpoint/Rollback System

Instead of just blocking fixes, implement rollback:

```typescript
const checkpoints: Agent[] = [];

function createCheckpoint(agent: Agent, iteration: number) {
  checkpoints.push({
    iteration,
    agent: JSON.parse(JSON.stringify(agent))
  });
}

function rollback(toIteration: number): Agent {
  const checkpoint = checkpoints.find(c => c.iteration === toIteration);
  if (checkpoint) {
    logger.info({ toIteration }, 'Rolling back to checkpoint');
    return checkpoint.agent;
  }
  throw new Error('Checkpoint not found');
}
```

### Root Cause Analysis

When convergence failure is detected, analyze the conflict:

```typescript
if (!canApplyFix) {
  // Analyze why this fix is being re-applied
  const rootCause = analyzeConvergenceFailure({
    stepId,
    fixType,
    previousFixes: Array.from(fixHistory.get(stepId) || []),
    currentIssue: issue
  });

  logger.warn({ rootCause }, 'Convergence failure root cause identified');

  // Surface to user with explanation
  issue.requiresUserInput = true;
  issue.userGuidance = rootCause.explanation;
}
```

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-21 | Initial implementation | Added convergence detection to 4 fix types in batch calibration route |
