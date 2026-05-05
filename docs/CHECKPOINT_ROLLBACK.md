# Checkpoint and Rollback Mechanism

> **Last Updated**: 2026-04-21

## Overview

The checkpoint/rollback system prevents calibration from making things worse by saving agent state before each iteration and detecting regression patterns (increasing issue counts).

## Problem Statement

Without checkpoints, the calibration system could:
1. Apply fixes that introduce **more issues** than they solve
2. Get progressively worse over iterations
3. End with a more broken workflow than it started with
4. Provide no recovery mechanism to undo bad fixes

### Example Scenario

```
Iteration 1: 2 issues detected
  - Fix A applied

Iteration 2: 5 issues detected (Fix A introduced 4 new issues!)
  - Fix B, C, D, E applied to handle new issues

Iteration 3: 12 issues detected (Fixes B-E introduced 8 more issues!)
  - Workflow is now WORSE than before calibration started
  - No way to recover the "good state" from Iteration 1
```

## Solution: Checkpoint Before, Rollback on Regression

The system:
1. **Saves agent state** at the beginning of each iteration (before fixes)
2. **Updates checkpoint** with issue count after execution
3. **Detects regression** when issue count increases over 3 consecutive iterations
4. **Rolls back** to the iteration with the fewest issues
5. **Clears fix history** to allow re-attempting fixes with new context

## Implementation

### Data Structures

**File**: `/app/api/v2/calibrate/batch/route.ts`

**Lines**: 257-283

```typescript
interface Checkpoint {
  iteration: number;
  agent: Agent;           // Deep clone of agent state
  issueCount: number;     // Total issues detected in this iteration
  timestamp: string;      // ISO timestamp
}

const checkpoints: Checkpoint[] = [];
```

### Core Functions

#### createCheckpoint()

**Lines**: 285-303

Saves a deep clone of agent state before any validation/execution:

```typescript
function createCheckpoint(agent: Agent, iteration: number, issueCount: number): void {
  // Deep clone agent to prevent mutations
  const checkpoint: Checkpoint = {
    iteration,
    agent: JSON.parse(JSON.stringify(agent)),
    issueCount,
    timestamp: new Date().toISOString()
  };

  checkpoints.push(checkpoint);

  logger.debug({
    sessionId,
    iteration,
    issueCount,
    checkpointCount: checkpoints.length
  }, 'Checkpoint created');
}
```

**Why deep clone?**
- `JSON.parse(JSON.stringify(agent))` creates completely independent copy
- Prevents mutations from affecting saved checkpoints
- Safe even if fixes modify nested objects in pilot_steps

#### rollbackToCheckpoint()

**Lines**: 305-323

Retrieves saved agent state from a specific iteration:

```typescript
function rollbackToCheckpoint(targetIteration: number): Agent | null {
  const checkpoint = checkpoints.find(c => c.iteration === targetIteration);

  if (checkpoint) {
    logger.info({
      sessionId,
      targetIteration,
      currentIteration: loopIteration,
      issueCount: checkpoint.issueCount
    }, 'Rolling back to checkpoint');
    return checkpoint.agent;
  }

  logger.warn({
    sessionId,
    targetIteration,
    availableCheckpoints: checkpoints.map(c => c.iteration)
  }, 'Checkpoint not found for rollback');
  return null;
}
```

#### detectRegressionPattern()

**Lines**: 325-350

Analyzes last 3 checkpoints to detect if issue count is increasing:

```typescript
function detectRegressionPattern(): { hasRegression: boolean; rollbackTo?: number } {
  if (checkpoints.length < 3) {
    return { hasRegression: false };
  }

  // Check if issue count is increasing over last 3 iterations
  const lastThree = checkpoints.slice(-3);
  const isIncreasing = lastThree[0].issueCount < lastThree[1].issueCount &&
                      lastThree[1].issueCount < lastThree[2].issueCount;

  if (isIncreasing) {
    logger.warn({
      sessionId,
      issueTrend: lastThree.map(c => ({ iteration: c.iteration, issues: c.issueCount }))
    }, 'Regression detected: issue count increasing over last 3 iterations');

    // Rollback to the iteration with fewest issues
    const best = lastThree.reduce((min, curr) => curr.issueCount < min.issueCount ? curr : min);
    return { hasRegression: true, rollbackTo: best.iteration };
  }

  return { hasRegression: false };
}
```

**Detection criteria:**
- Requires **3 consecutive checkpoints** (iterations 1, 2, 3)
- Regression if: `issues(iter1) < issues(iter2) < issues(iter3)`
- Returns iteration with **minimum issue count** as rollback target

## Integration Points

### 1. Checkpoint Creation (Start of Iteration)

**Line**: 340

```typescript
while (loopIteration < MAX_ITERATIONS) {
  loopIteration++;
  logger.info({ sessionId, agentId, loopIteration }, `Auto-calibration iteration ${loopIteration}`);

  // CHECKPOINT: Save agent state at beginning of iteration (before any validation/execution)
  // Issue count will be updated after execution
  createCheckpoint(currentAgent, loopIteration, 0);
```

**Timing**: Immediately after iteration counter increments, **before** any validation or execution.

**Why here?**
- Captures "clean state" before any fixes applied
- If rollback needed, returns to exactly this state

### 2. Regression Detection & Rollback

**Lines**: 342-359

```typescript
  // REGRESSION DETECTION: Check if we're making things worse
  const regressionCheck = detectRegressionPattern();
  if (regressionCheck.hasRegression && regressionCheck.rollbackTo) {
    logger.warn({
      sessionId,
      loopIteration,
      rollbackTo: regressionCheck.rollbackTo
    }, 'Regression detected - rolling back to best checkpoint');

    const rolledBackAgent = rollbackToCheckpoint(regressionCheck.rollbackTo);
    if (rolledBackAgent) {
      currentAgent = rolledBackAgent;

      // Clear fix history for steps that were rolled back
      // This allows those fixes to be re-attempted with new context
      fixHistory.clear();

      logger.info({
        sessionId,
        loopIteration,
        rollbackTo: regressionCheck.rollbackTo
      }, 'Rollback complete - continuing from checkpoint');
    }
  }
```

**Timing**: After checkpoint created, **before** validation starts.

**Why clear fix history?**
- Rollback creates a "fresh start" opportunity
- Same fixes might succeed with different ordering/context
- Prevents convergence detection from blocking valid retries

### 3. Checkpoint Update (After Issue Collection)

**Lines**: 1229-1242

```typescript
  logger.info({
    sessionId,
    loopIteration,
    totalIssues: iterationIssues.length,
    autoFixable: autoFixableIssues.length,
    requiresUserInput: requiresUserInputIssues.length
  }, 'Issue classification complete');

  // UPDATE CHECKPOINT: Now that we have issue count, update the checkpoint
  if (checkpoints.length > 0) {
    const currentCheckpoint = checkpoints[checkpoints.length - 1];
    if (currentCheckpoint.iteration === loopIteration) {
      currentCheckpoint.issueCount = iterationIssues.length;
      logger.debug({
        sessionId,
        loopIteration,
        issueCount: iterationIssues.length
      }, 'Updated checkpoint with issue count');
    }
  }
```

**Timing**: After execution completes and issues are classified.

**Why update?**
- Checkpoint created with `issueCount: 0` (unknown at creation time)
- Actual count needed for regression detection
- Uses total issues (auto-fixable + requires-user-input)

## Behavior Examples

### Example 1: Normal Progress (No Rollback)

```
Iteration 1:
  - Checkpoint: agent state, 0 issues
  - Execution: 5 issues detected
  - Update checkpoint: 5 issues
  - Apply 3 auto-fixes

Iteration 2:
  - Checkpoint: agent state (with 3 fixes applied), 0 issues
  - Execution: 2 issues detected (progress!)
  - Update checkpoint: 2 issues
  - Apply 2 auto-fixes

Iteration 3:
  - Checkpoint: agent state (with 5 fixes total), 0 issues
  - Execution: 0 issues detected (success!)
  - Update checkpoint: 0 issues
  - Exit loop: calibration complete ✓

Checkpoints: [
  { iteration: 1, issueCount: 5 },
  { iteration: 2, issueCount: 2 },
  { iteration: 3, issueCount: 0 }
]

Regression check: 5 > 2 > 0 (decreasing) → No regression
```

### Example 2: Regression Detected & Rollback

```
Iteration 1:
  - Checkpoint: agent state, 0 issues
  - Execution: 3 issues detected
  - Update checkpoint: 3 issues
  - Apply 2 auto-fixes

Iteration 2:
  - Checkpoint: agent state (with 2 fixes), 0 issues
  - Execution: 6 issues detected (regression! fixes introduced 5 new issues)
  - Update checkpoint: 6 issues
  - Apply 4 auto-fixes (trying to fix new issues)

Iteration 3:
  - Checkpoint: agent state (with 6 fixes), 0 issues
  - Execution: 10 issues detected (worse! fixes introduced 8 more issues)
  - Update checkpoint: 10 issues
  - Regression detection: 3 < 6 < 10 (increasing trend) ✓

Iteration 4:
  - Checkpoint: agent state, 0 issues
  - 🔄 REGRESSION DETECTED
  - Best checkpoint: Iteration 1 (3 issues)
  - Rollback to Iteration 1 agent state
  - Clear fix history (allow retrying different fixes)
  - Continue execution...

Checkpoints: [
  { iteration: 1, issueCount: 3 },  ← Best
  { iteration: 2, issueCount: 6 },
  { iteration: 3, issueCount: 10 },
  { iteration: 4, issueCount: 0 }   ← Will be updated after execution
]
```

### Example 3: Oscillation Pattern

```
Iteration 1: 5 issues
Iteration 2: 3 issues (better)
Iteration 3: 7 issues (worse)
Iteration 4: 4 issues (better)
Iteration 5: 9 issues (worse)

Regression check at iteration 5:
  - Last 3: [4, 9, ?] → Only 2 checkpoints, need 3
  - No rollback yet

Iteration 6: 12 issues
Regression check at iteration 6:
  - Last 3: [4, 9, 12] → 4 < 9 < 12 (increasing) ✓
  - Rollback to Iteration 4 (4 issues)
```

## Limitations & Edge Cases

### 1. Three-Iteration Window

**Issue**: Regression detection requires 3 consecutive iterations.

**Impact**: Early regressions (iterations 1-2) won't be detected.

**Mitigation**: Acceptable trade-off - need statistical confidence that trend is real, not noise.

### 2. Memory Usage

**Issue**: Each checkpoint stores full agent object (can be large for complex workflows).

**Impact**: ~10KB per checkpoint × 10 iterations = ~100KB max (negligible).

**Mitigation**: Checkpoints are in-memory only, cleared after calibration completes.

### 3. False Positives

**Issue**: Transient spike in issues could trigger false regression.

**Scenario**:
```
Iteration 1: 5 issues
Iteration 2: 6 issues (new scatter-gather error introduced)
Iteration 3: 7 issues (parameter mismatch from fix)
→ Rollback triggered, but issues would have been auto-fixed
```

**Mitigation**: Three-iteration window reduces false positives. Most transient issues are fixed within 1-2 iterations.

### 4. Rollback Clears All Fix History

**Issue**: Clearing entire `fixHistory` Map might allow convergence issues to re-appear.

**Benefit**: Fresh start allows trying different fix ordering/combinations.

**Mitigation**: Convergence detection still active - if same fix re-applied, it will be blocked.

## Future Enhancements

### 1. Selective Fix History Clearing

Instead of clearing **all** fix history, clear only fixes applied **after** the rollback point:

```typescript
function clearFixHistoryAfter(rollbackIteration: number): void {
  // Find fixes applied after rollback point and remove them
  // Keep fixes from before rollback (those were "good")
}
```

### 2. Adaptive Regression Threshold

Instead of strict "increasing over 3 iterations", use percentage increase:

```typescript
function detectRegressionPattern(): { hasRegression: boolean; rollbackTo?: number } {
  if (checkpoints.length < 3) return { hasRegression: false };

  const lastThree = checkpoints.slice(-3);
  const percentIncrease = (lastThree[2].issueCount - lastThree[0].issueCount) / lastThree[0].issueCount;

  // Regression if issue count increased by >50% over 3 iterations
  if (percentIncrease > 0.5) {
    return { hasRegression: true, rollbackTo: lastThree[0].iteration };
  }

  return { hasRegression: false };
}
```

### 3. Checkpoint Persistence

For long-running calibrations, persist checkpoints to database:

```typescript
async function createCheckpoint(agent: Agent, iteration: number, issueCount: number): Promise<void> {
  const checkpoint = { ... };

  // Save to database
  await supabase
    .from('calibration_checkpoints')
    .insert({
      session_id: sessionId,
      iteration,
      agent_state: checkpoint.agent,
      issue_count: issueCount,
      timestamp: checkpoint.timestamp
    });

  checkpoints.push(checkpoint);
}
```

**Benefit**: Survive server restarts, allow manual rollback from UI.

## Metrics

### Logged Data

Every checkpoint operation logs:
- `sessionId` - Calibration session
- `iteration` - Iteration number
- `issueCount` - Total issues detected (updated after execution)
- `checkpointCount` - Total checkpoints saved

Every rollback logs:
- `sessionId` - Calibration session
- `currentIteration` - Iteration where regression detected
- `rollbackTo` - Target iteration for rollback
- `issueTrend` - Array of `{ iteration, issues }` showing the trend

### Analysis Queries

To find calibration sessions with rollbacks:

```sql
-- Find sessions that triggered rollback
SELECT DISTINCT session_id, count(*) as rollback_count
FROM calibration_logs
WHERE message LIKE '%Regression detected - rolling back%'
GROUP BY session_id
ORDER BY rollback_count DESC;

-- Find average issue counts before/after rollback
SELECT
  json_extract(metadata, '$.rollbackTo') as rollback_to_iteration,
  avg(json_extract(metadata, '$.issueCount')) as avg_issues_after_rollback
FROM calibration_logs
WHERE message = 'Rollback complete - continuing from checkpoint'
GROUP BY rollback_to_iteration;
```

## Testing

### Test Cases

| Scenario | Expected Behavior | Verifies |
|----------|-------------------|----------|
| **Issues decreasing (5→3→0)** | No rollback triggered | Normal progress detection |
| **Issues increasing (3→6→10)** | Rollback to iteration with min issues | Regression detection |
| **Oscillation (5→3→7→4→9→12)** | Rollback after 3 consecutive increases | Three-iteration window |
| **Early regression (10→20)** | No rollback (only 2 iterations) | Minimum checkpoint requirement |
| **Rollback to iteration 1** | Agent state restored, fix history cleared | Rollback mechanism |

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-21 | Initial implementation | Added checkpoint/rollback to batch calibration route with regression detection |
