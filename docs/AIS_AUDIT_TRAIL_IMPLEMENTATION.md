# AIS Audit Trail Implementation

## Overview

The AIS (Agent Intensity System) now has comprehensive audit trail logging using the existing enterprise-grade audit trail system.

## What Gets Audited

### 1. Individual Agent Score Events

- **`AIS_SCORE_CALCULATED`**: When an agent's intensity score is first calculated (severity: info)
- **`AIS_SCORE_UPDATED`**: When scores change due to new executions (severity: info)
- **`AIS_SCORE_RECALCULATED`**: When a user manually refreshes an agent's score (severity: info)

**Captured Data:**
- Creation score, execution score, combined score
- All three multipliers
- **Normalization ranges used at time of calculation** (NEW!)
  - Creation ranges: workflow_steps, plugins, io_fields
  - Execution ranges: token_volume, token_peak, iterations, duration_ms, plugin_count, plugins_per_run, workflow_steps, branches
- Before/after comparison (for updates)
- Deltas showing exact changes
- Reason for the change

**Why capture normalization ranges?**
When you manually refresh the normalization table, the audit log will show you:
1. What ranges were used when the score was originally calculated
2. What the new ranges are after your refresh
3. How the score changed as a result

This lets you track back and understand: "This agent's score went from 6.5 to 7.2 because we changed the token_volume range from {min: 100, max: 5000} to {min: 100, max: 3000}"

### 2. System-Wide Normalization Events

- **`AIS_NORMALIZATION_REFRESH_STARTED`**: Admin updates normalization ranges (severity: warning)
- **`AIS_NORMALIZATION_REFRESH_COMPLETED`**: Ranges successfully updated (severity: warning)
- **`AIS_SCORES_BULK_RECALCULATED`**: All agents recalculated after normalization (severity: warning)

**Captured Data:**
- **BEFORE snapshot**: All agent scores before the change
- **AFTER snapshot**: All agent scores after the change
- Old vs new normalization ranges
- Number of agents affected
- Summary of changes per agent
- Reason for the refresh

## Key Features

### 1. **Capturing Previous State on Normalization Refresh**

Before updating normalization ranges, the system:
```typescript
// 1. Snapshot current scores of ALL agents
const agentScoresSnapshot = await snapshotAllAgentScores(supabase);

// 2. Snapshot current normalization ranges
const oldRanges = await snapshotNormalizationRanges(supabase);

// 3. Log the start with both snapshots
await logAISNormalizationRefreshStarted(userId, oldRanges, agentScoresSnapshot, reason);

// 4. Update the ranges
// ... perform update ...

// 5. Get new ranges
const newRanges = await snapshotNormalizationRanges(supabase);

// 6. Log completion
await logAISNormalizationRefreshCompleted(userId, oldRanges, newRanges);

// 7. Recalculate all agents
// ... recalculate ...

// 8. Snapshot after recalculation
const afterSnapshot = await snapshotAllAgentScores(supabase);

// 9. Log the bulk recalculation with before/after
await logAISScoresBulkRecalculated(userId, agentScoresSnapshot, afterSnapshot);
```

This captures:
- ✅ Complete state before the change
- ✅ What changed (ranges)
- ✅ Complete state after the change
- ✅ Per-agent deltas

### 2. **Track Back Capability**

Admins can query audit logs to:
- See when scores changed and why
- Compare before/after states
- Identify which normalization refresh caused a score change
- Understand the impact of range updates

Example queries:
```typescript
// Get all AIS events for a specific agent
await auditQuery({
  entityType: 'agent',
  entityId: 'agent-id-here',
  action: [
    'AIS_SCORE_CALCULATED',
    'AIS_SCORE_UPDATED',
    'AIS_SCORE_RECALCULATED'
  ]
});

// Get all normalization refresh events
await auditQuery({
  entityType: 'system',
  action: [
    'AIS_NORMALIZATION_REFRESH_STARTED',
    'AIS_NORMALIZATION_REFRESH_COMPLETED',
    'AIS_SCORES_BULK_RECALCULATED'
  ],
  severity: 'warning'
});
```

## Implementation Files

### Core Files
- **`lib/audit/events.ts`**: Defines AIS event types and metadata
- **`lib/audit/ais-helpers.ts`**: Helper functions for logging AIS events
- **`lib/services/AuditTrailService.ts`**: Existing enterprise audit service (unchanged)

### Helper Functions

```typescript
// For individual agent events
logAISScoreCalculated(agentId, agentName, userId, metrics)
logAISScoreUpdated(agentId, agentName, userId, oldMetrics, newMetrics, reason)
logAISManualRefresh(agentId, agentName, userId, oldMetrics, newMetrics)

// For normalization events
snapshotAllAgentScores(supabase) // Returns snapshot of all agents
snapshotNormalizationRanges(supabase) // Returns snapshot of ranges
logAISNormalizationRefreshStarted(userId, oldRanges, agentScoresSnapshot, reason)
logAISNormalizationRefreshCompleted(userId, oldRanges, newRanges)
logAISScoresBulkRecalculated(userId, beforeSnapshot, afterSnapshot)
```

## Integration Points

### 1. AgentIntensityService ✅ COMPLETED
Audit logging integrated in:
- ✅ `trackCreationCosts()` - Logs AIS_SCORE_CALCULATED after creation score calculation
- ✅ `updateMetricsFromExecution()` - Logs AIS_SCORE_UPDATED with before/after when scores change (threshold: 0.01)
- ⏳ Manual refresh endpoint - Log AIS_SCORE_RECALCULATED (TODO: needs API endpoint)

### 2. Admin Normalization Refresh API
Create endpoint that:
1. Captures snapshots (scores + ranges)
2. Logs refresh started
3. Updates ranges
4. Logs refresh completed
5. Recalculates all agents
6. Logs bulk recalculation with deltas

## Database Schema

Uses existing `audit_trail` table:
```sql
CREATE TABLE audit_trail (
  id UUID PRIMARY KEY,
  user_id UUID,
  actor_id UUID,
  action TEXT NOT NULL, -- 'AIS_SCORE_CALCULATED', etc.
  entity_type TEXT NOT NULL, -- 'agent', 'system'
  entity_id TEXT,
  resource_name TEXT,
  changes JSONB, -- before/after snapshots
  details JSONB, -- additional context
  ip_address TEXT,
  user_agent TEXT,
  session_id TEXT,
  severity TEXT, -- 'info', 'warning', 'critical'
  compliance_flags TEXT[], -- ['SOC2']
  hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Compliance

All AIS events are tagged with:
- **SOC2** compliance flag
- Appropriate severity levels
- Tamper detection (optional)

## Benefits

1. **Full Traceability**: Every score change is logged
2. **Debugging**: Can trace back why a score changed
3. **Transparency**: Show users their score history
4. **Compliance**: SOC2-compliant audit trail
5. **Impact Analysis**: Understand effect of normalization changes
6. **Rollback Support**: Data exists to understand previous states

## Next Steps

1. ✅ DONE: Integrate logging into `AgentIntensityService.ts`
   - Added audit logging to trackCreationCosts()
   - Added audit logging to updateMetricsFromExecution()
   - Fixed TypeScript error by adding design_stats to getIntensityBreakdown()
2. ⏳ TODO: Create admin API endpoint for normalization refresh with audit trail
3. ⏳ TODO (Optional): Add UI for viewing AIS audit history
4. ⏳ TODO (Optional): Set up alerts for unusual score changes

## Manual Normalization Refresh Flow

When admin clicks "Refresh" in the normalization table:

```typescript
// Step 1: Capture BEFORE state
const beforeScores = await snapshotAllAgentScores(supabase);
const oldRanges = await snapshotNormalizationRanges(supabase);

// Step 2: Log refresh started with full snapshot
await logAISNormalizationRefreshStarted(userId, oldRanges, beforeScores, 'Admin manual refresh');

// Step 3: Update ranges in database
await supabase
  .from('ais_normalization_ranges')
  .update({ best_practice_min: newMin, best_practice_max: newMax })
  .eq('range_key', 'token_volume');

// Step 4: Get new ranges
const newRanges = await snapshotNormalizationRanges(supabase);

// Step 5: Log ranges updated
await logAISNormalizationRefreshCompleted(userId, oldRanges, newRanges);

// Step 6: Recalculate ALL agent scores with new ranges
for (const agent of allAgents) {
  await AgentIntensityService.recalculateScores(supabase, agent.id);
}

// Step 7: Capture AFTER state
const afterScores = await snapshotAllAgentScores(supabase);

// Step 8: Log bulk recalculation with deltas
await logAISScoresBulkRecalculated(userId, beforeScores, afterScores);
```

**Result:** You can now query the audit trail to see:
- Which ranges changed
- How each agent's score changed
- What normalization values were used before/after

## Implementation Status

### ✅ Completed
- Created audit event types in `lib/audit/events.ts` (6 new events)
- Created helper functions in `lib/audit/ais-helpers.ts`
- Integrated audit logging into `AgentIntensityService.ts`
  - trackCreationCosts() logs AIS_SCORE_CALCULATED with normalization ranges
  - updateMetricsFromExecution() logs AIS_SCORE_UPDATED with before/after comparison and normalization ranges
- Fixed missing design_stats in IntensityBreakdown type implementation
- All audit logs include complete metric snapshots AND normalization ranges used
- **NEW**: Normalization ranges are captured in every score calculation/update for full traceability

### ⏳ Pending
- Admin API endpoint for normalization refresh (needs the flow above)
- Manual score recalculation endpoint with audit logging
- UI for viewing audit trail (optional)

## Example Audit Log Entries

### 1. Score Calculated (with normalization ranges)
```json
{
  "id": "uuid",
  "user_id": "user-123",
  "action": "AIS_SCORE_CALCULATED",
  "entity_type": "agent",
  "entity_id": "agent-abc",
  "resource_name": "Email Assistant",
  "details": {
    "creation_score": 5.2,
    "execution_score": 5.0,
    "combined_score": 5.06,
    "creation_multiplier": 1.52,
    "execution_multiplier": 1.50,
    "combined_multiplier": 1.506,
    "reason": "Initial calculation",
    "normalization_ranges": {
      "creation_workflow_steps": { "min": 1, "max": 10 },
      "creation_plugins": { "min": 0, "max": 5 },
      "creation_io_fields": { "min": 0, "max": 10 },
      "token_volume": { "min": 0, "max": 50000 },
      "token_peak": { "min": 0, "max": 20000 },
      "iterations": { "min": 1, "max": 10 },
      "duration_ms": { "min": 100, "max": 60000 },
      "plugin_count": { "min": 0, "max": 10 },
      "plugins_per_run": { "min": 0, "max": 5 },
      "workflow_steps": { "min": 0, "max": 20 },
      "branches": { "min": 0, "max": 10 }
    }
  },
  "severity": "info",
  "compliance_flags": ["SOC2"],
  "created_at": "2025-01-29T10:00:00Z"
}
```

**Why this matters:** When you refresh normalization later, you can compare these ranges to the new ones and see exactly why the score changed.

### 2. Normalization Refresh Started
```json
{
  "id": "uuid",
  "user_id": "admin-user-id",
  "action": "AIS_NORMALIZATION_REFRESH_STARTED",
  "entity_type": "system",
  "entity_id": "ais_normalization_ranges",
  "resource_name": "AIS Normalization Ranges",
  "details": {
    "reason": "Updating token_volume range based on latest usage patterns",
    "affected_agents_count": 156,
    "agent_scores_snapshot": [
      {
        "agent_id": "abc",
        "agent_name": "Email Assistant",
        "creation_score": 5.2,
        "execution_score": 6.8,
        "combined_score": 6.3,
        "combined_multiplier": 1.63
      }
      // ... all 156 agents
    ],
    "old_ranges": [
      {
        "range_key": "token_volume",
        "best_practice_min": 0,
        "best_practice_max": 50000,
        "inverted": false
      }
    ]
  },
  "severity": "warning",
  "compliance_flags": ["SOC2"],
  "created_at": "2025-01-29T11:00:00Z"
}
```

### 3. Score Updated (with new normalization ranges)
```json
{
  "id": "uuid",
  "user_id": "user-123",
  "action": "AIS_SCORE_UPDATED",
  "entity_type": "agent",
  "entity_id": "agent-abc",
  "resource_name": "Email Assistant",
  "changes": {
    "before": {
      "creation_score": 5.2,
      "execution_score": 6.8,
      "combined_score": 6.3,
      "combined_multiplier": 1.63
    },
    "after": {
      "creation_score": 5.2,
      "execution_score": 7.5,
      "combined_score": 6.81,
      "combined_multiplier": 1.681
    },
    "delta": {
      "creation_score": 0.0,
      "execution_score": 0.7,
      "combined_score": 0.51,
      "combined_multiplier": 0.051
    }
  },
  "details": {
    "reason": "Post-execution recalculation",
    "total_executions": 42,
    "total_tokens_used": 125000,
    "normalization_ranges": {
      "token_volume": { "min": 0, "max": 30000 },
      // ... other ranges (NEW MAX is 30000 instead of 50000!)
    }
  },
  "severity": "info",
  "created_at": "2025-01-29T11:05:00Z"
}
```

**Analysis:** You can see the score went up because `token_volume.max` changed from 50000 to 30000, making this agent's 125000 tokens appear more complex relative to the new range.

## Notes

- All audit logging is **non-blocking** (uses batching and queues)
- Failed audit logs don't break the main flow
- Retention policy: 365 days (configurable)
- Critical events retained for 7 years
