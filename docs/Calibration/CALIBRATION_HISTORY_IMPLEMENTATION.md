# Calibration History Table Implementation

> **Created**: 2026-04-28
> **Status**: ✅ Code Complete - Migration Pending

## Overview

Moved calibration tracking from `agents` table columns to a dedicated `calibration_history` table for comprehensive analytics and V6 quality tracking.

---

## Changes Summary

### 1. Database Migration

**File**: `supabase/migrations/20260428_calibration_history_table.sql`

**What it does:**
- Drops old columns from `agents` table:
  - `last_calibration_status`
  - `last_calibration_at`
  - `calibration_metadata`
  - `validation_metadata`
- Keeps only:
  - `workflow_hash` - for change detection
  - `last_successful_calibration_id` - FK to calibration_history
- Creates new `calibration_history` table with:
  - Full calibration run data (status, iterations, issues, metrics)
  - V6 quality tracking fields (`v6_version`, `model_used`)
  - JSONB metadata for validation fixes
  - Comprehensive indexes for analytics
  - RLS policies for security
  - Analytics view `calibration_success_metrics`

**Status**: ⏳ **MIGRATION NOT YET APPLIED** (Docker not running)

**To apply migration:**
```bash
# Local database
npx supabase db push --local

# Production (after testing)
npx supabase db push --linked
```

---

### 2. New Repository

**File**: `lib/repositories/CalibrationHistoryRepository.ts`

**Methods:**
- `create(record)` - Insert new calibration record
- `getLastSuccessful(agentId, userId)` - Get most recent successful calibration
- `getByAgent(agentId, userId, limit)` - Get calibration history for agent
- `getBySession(sessionId, userId)` - Get calibration by session
- `getSuccessMetrics(userId, days)` - Get analytics from view
- `isWorkflowCalibrated(agentId, userId, workflowHash)` - Check if hash calibrated

**Status**: ✅ Complete

---

### 3. Batch Calibration API Updates

**File**: `app/api/v2/calibrate/batch/route.ts`

#### Change 1: Import CalibrationHistoryRepository
**Line**: ~19
```typescript
import { CalibrationHistoryRepository } from '@/lib/repositories/CalibrationHistoryRepository';
```

#### Change 2: Pre-Calibration Check (Fast Path)
**Lines**: ~106-125
```typescript
// Before: Checked agents.last_calibration_status
const lastSuccessful = await calibrationHistoryRepo.getLastSuccessful(agentId, user.id);

// After: Query calibration_history for last successful run
if (lastSuccessful && !workflowHasChanged) {
  // Run single verification execution
  // Return early if still working
}
```

**Impact**: No more agent table columns needed for fast path check

#### Change 3: Remove Reset Operations
**Lines**: ~166-195
```typescript
// Before: Reset agents.last_calibration_status to null
// After: No reset needed - calibration_history is append-only
```

**Impact**: Simpler code, preserves all historical data

#### Change 4: Store Validation Metadata for History
**Lines**: ~907-920
```typescript
// Before: Saved validation_metadata to agents table
const validationMetadata = {
  validatedAt: new Date().toISOString(),
  layer1Fixes: layer1Fixes,
  layer2HighConfidenceFixes,
  // ... all fix metadata
};

// After: Store in variable, include in calibration_history.metadata
```

**Impact**: Validation fixes tracked per calibration run, not just last one

#### Change 5: Success Status → Calibration History
**Lines**: ~3845-3882
```typescript
// Before:
await supabase.from('agents').update({
  last_calibration_status: 'success',
  last_calibration_at: new Date().toISOString(),
  workflow_hash: currentWorkflowHash,
  calibration_metadata: { sessionId, iterations, ... }
})

// After:
const historyRecord = await calibrationHistoryRepo.create({
  agent_id: agentId,
  session_id: sessionId,
  user_id: user.id,
  workflow_hash: currentWorkflowHash,
  workflow_step_count: workflowSteps.length,
  status: 'success',
  iterations: loopIteration,
  auto_fixes_applied: autoFixesApplied,
  issues_found: [],
  issues_fixed: [],
  issues_remaining: [],
  execution_time_ms: finalResult.executionTimeMs,
  steps_completed: finalResult.stepsCompleted,
  steps_failed: 0,
  steps_skipped: finalResult.stepsSkipped,
  metadata: validationMetadata,
  completed_at: new Date().toISOString()
});

// Update agent with reference to successful calibration
await supabase.from('agents').update({
  workflow_hash: currentWorkflowHash,
  last_successful_calibration_id: historyRecord.id
})
```

**Impact**: Complete historical record, agent table stays lean

#### Change 6: Failure Status → Calibration History
**Lines**: ~3960-4010
```typescript
// Before:
await supabase.from('agents').update({
  last_calibration_status: hasCriticalIssues ? 'needs_review' : 'failed',
  calibration_metadata: { sessionId, iterations, issuesRemaining, ... }
})

// After:
await calibrationHistoryRepo.create({
  agent_id: agentId,
  status: calibrationStatus,
  iterations: loopIteration,
  auto_fixes_applied: autoFixesApplied,
  issues_found: allIssuesForUI,
  issues_fixed: prioritized.autoRepairs,
  issues_remaining: [...prioritized.critical, ...prioritized.warnings],
  metadata: {
    ...validationMetadata,
    issuesSummary: {
      critical: summary.critical,
      warnings: summary.warnings,
      autoRepairs: summary.autoRepairs,
      requiresUserAction: summary.requiresUserAction
    }
  },
  completed_at: new Date().toISOString()
});

// Update agent workflow hash (no last_successful_calibration_id)
await supabase.from('agents').update({
  workflow_hash: currentWorkflowHash
})
```

**Impact**: Failed calibrations tracked with full issue details

---

## Data Migration Path

### Current Data in `agents` Table

Columns that exist now (will be dropped):
- `last_calibration_status` - TEXT
- `last_calibration_at` - TIMESTAMP
- `calibration_metadata` - JSONB
- `validation_metadata` - JSONB

### After Migration

**Agents table will have:**
- `workflow_hash` - TEXT (existing or new)
- `last_successful_calibration_id` - UUID FK to calibration_history

**New `calibration_history` table:**
- All future calibrations stored here
- Historical data from `agents` columns is **NOT** migrated (fresh start)

**Rationale**: Old columns didn't have enough data for meaningful migration. Clean start with comprehensive tracking going forward.

---

## Analytics Capabilities

### 1. Success Rate Tracking

```sql
SELECT
  DATE_TRUNC('day', created_at) as date,
  status,
  COUNT(*) as calibrations,
  AVG(iterations) as avg_iterations,
  AVG(auto_fixes_applied) as avg_auto_fixes
FROM calibration_history
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY date, status
ORDER BY date DESC;
```

### 2. Common Issues Detection

```sql
-- Find most common issue types
SELECT
  jsonb_array_elements(issues_found)->>'type' as issue_type,
  COUNT(*) as occurrences
FROM calibration_history
WHERE status IN ('failed', 'needs_review')
GROUP BY issue_type
ORDER BY occurrences DESC
LIMIT 10;
```

### 3. Agent Quality Metrics

```sql
-- Agents with highest failure rates
SELECT
  agent_id,
  COUNT(*) as total_calibrations,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
  ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM calibration_history
GROUP BY agent_id
HAVING COUNT(*) >= 3
ORDER BY success_rate ASC
LIMIT 20;
```

### 4. V6 Quality Correlation (Future)

When `v6_version` and `model_used` are populated:

```sql
-- Compare calibration success by model
SELECT
  model_used,
  COUNT(*) as calibrations,
  AVG(iterations) as avg_iterations,
  ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM calibration_history
WHERE model_used IS NOT NULL
GROUP BY model_used
ORDER BY success_rate DESC;
```

---

## Testing Plan

### 1. First Calibration (Success)
1. Create new agent with workflow
2. Run calibration → should succeed
3. Check `calibration_history` table:
   ```sql
   SELECT * FROM calibration_history WHERE agent_id = '<agent-id>' ORDER BY created_at DESC LIMIT 1;
   ```
4. Verify `agents.last_successful_calibration_id` is set
5. Verify `agents.workflow_hash` matches

### 2. Second Calibration (Fast Path)
1. Run calibration again on same agent (no workflow changes)
2. Should return early with `alreadyCalibrated: true`
3. Should run single verification execution
4. Should NOT create new calibration_history record

### 3. Calibration After Workflow Change
1. Modify agent workflow
2. Run calibration
3. Should detect workflow change via hash comparison
4. Should run full calibration (not fast path)
5. Should create new calibration_history record

### 4. Failed Calibration
1. Create agent with intentional issues
2. Run calibration → should fail or need review
3. Check `calibration_history`:
   - `status` should be 'failed' or 'needs_review'
   - `issues_found` should contain issue objects
   - `issues_remaining` should have unfixed issues
4. Verify `agents.last_successful_calibration_id` is NULL (no successful calibration)

### 5. Analytics Queries
1. Run calibrations on multiple agents
2. Query `calibration_success_metrics` view
3. Test issue aggregation queries
4. Verify indexes are used (EXPLAIN ANALYZE)

---

## Backwards Compatibility

### Breaking Changes

❌ **API consumers checking `agents.last_calibration_status`**
- Field no longer exists
- Solution: Query `calibration_history` or use `last_successful_calibration_id`

❌ **Direct queries to `agents.calibration_metadata`**
- Field no longer exists
- Solution: Join with `calibration_history` table

### Non-Breaking

✅ **Batch calibration API responses**
- Response format unchanged
- Still returns `success`, `sessionId`, `issues`, `summary`

✅ **Workflow hash detection**
- Still works via `agents.workflow_hash`
- Fast path optimization preserved

---

## Future Enhancements

### 1. V6 Version Tracking
Add to agent creation flow:
```typescript
const v6Version = process.env.V6_VERSION || 'v6.2.1';
await calibrationHistoryRepo.create({
  // ...
  v6_version: v6Version,
  // ...
});
```

### 2. Model Tracking
Track which LLM model was used:
```typescript
const modelUsed = factory.getDefaultModel('openai'); // e.g., "gpt-4o-2024-11-20"
await calibrationHistoryRepo.create({
  // ...
  model_used: modelUsed,
  // ...
});
```

### 3. Issue Pattern Detection
Automated detection of recurring issue patterns:
```typescript
// Find agents with similar issues
const { data: patterns } = await supabase.rpc('detect_issue_patterns', {
  threshold: 3, // Minimum occurrences
  days: 30
});
```

### 4. Calibration Recommendations
Smart recommendations based on history:
```typescript
// "This workflow structure has a 70% failure rate in past calibrations"
// "Consider using find_or_create action instead of create"
```

---

## Migration Rollback Plan

If issues arise, rollback by:

1. **Drop calibration_history table:**
   ```sql
   DROP TABLE IF EXISTS calibration_history CASCADE;
   DROP VIEW IF EXISTS calibration_success_metrics;
   ```

2. **Re-add old columns to agents:**
   ```sql
   ALTER TABLE agents
   ADD COLUMN IF NOT EXISTS last_calibration_status TEXT,
   ADD COLUMN IF NOT EXISTS last_calibration_at TIMESTAMP WITH TIME ZONE,
   ADD COLUMN IF NOT EXISTS calibration_metadata JSONB DEFAULT '{}',
   ADD COLUMN IF NOT EXISTS validation_metadata JSONB DEFAULT '{}';
   ```

3. **Revert code changes in batch/route.ts**
   - Use git to restore previous version
   - Or manually revert the 6 changes listed above

---

## Performance Considerations

### Indexes Created

1. `idx_calibration_history_agent_id` - Agent history queries (MOST COMMON)
2. `idx_calibration_history_status` - Analytics by status
3. `idx_calibration_history_issues_found` - GIN index for issue pattern search
4. `idx_calibration_history_workflow_hash` - Regression detection
5. `idx_calibration_history_user_id` - User-specific analytics
6. `idx_calibration_history_session_id` - Session lookup

### Query Performance

Fast path check (pre-calibration):
```sql
-- Before: SELECT FROM agents WHERE id = ?
-- After: SELECT FROM calibration_history WHERE agent_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1
```
**Impact**: ~5-10ms additional latency (acceptable for 66% reduction in calibration iterations)

### Storage Growth

Estimated storage per calibration:
- Base record: ~500 bytes
- Issues JSONB: ~5-50KB (varies by issue count)
- Metadata JSONB: ~2-10KB

**Total**: ~10-60KB per calibration

For 1000 agents × 3 calibrations each = ~30-180MB

**Mitigation**: Consider archiving calibrations older than 90 days

---

## Status

✅ CalibrationHistoryRepository created
✅ Migration created
✅ Batch API updated
✅ Pre-calibration check updated
✅ Success/failure status tracking updated
✅ Validation metadata moved to history
⏳ Migration pending (Docker not running)
⬜ Testing pending
⬜ V6 version tracking (future)
⬜ Model tracking (future)

---

## Next Steps

1. **Apply migration**:
   ```bash
   # Start Docker
   # Then: npx supabase db push --local
   ```

2. **Test all scenarios**:
   - First calibration
   - Fast path (unchanged workflow)
   - Workflow change detection
   - Failed calibration

3. **Verify analytics queries**:
   - Test `calibration_success_metrics` view
   - Run example analytics queries
   - Check index usage

4. **Monitor performance**:
   - Fast path latency
   - Storage growth
   - Query performance

5. **Add V6 tracking** (optional):
   - Add `V6_VERSION` env var
   - Track in calibration_history.v6_version
   - Track model_used from provider factory
