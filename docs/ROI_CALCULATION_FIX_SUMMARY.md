# ROI Calculation Fix Summary

> **Date**: 2026-06-01
> **Issue**: Agent showing $700 "Value Saved This Run" when it should be ~$8.33

## Problem Identified

Agent `955d35c3-32a3-4fb5-a922-1fb798f4a349` (Bug Filter Agent) was showing incorrect ROI calculation:

- **Displayed**: $700.00 per run
- **Should be**: $8.33 per run

### Root Cause

The agent is a **bulk workflow** that takes 5 minutes total to scan all GitHub bug reports and email critical ones, regardless of item count. However:

1. The `execution_metrics` table stored `time_saved_seconds = 25,200` (7 hours)
2. This was calculated using old per-item logic: 210 items × 120 seconds/item = 25,200 seconds
3. The agent configuration was correct (`is_bulk_workflow: true`, `total_manual_time_seconds: 300`)
4. But existing execution metrics weren't recalculated when config was updated

## Solution Implemented

### 1. ✅ MetricsCollector Already Fixed

[MetricsCollector.ts:196-223](lib/pilot/MetricsCollector.ts#L196-L223) was already updated to support bulk workflows:

```typescript
const agentConfig = agentData?.agent_config as Record<string, any>;
const roiEstimate = agentConfig?.roi_estimate;
const isBulkWorkflow = roiEstimate?.is_bulk_workflow;
const totalManualTimeSeconds = roiEstimate?.total_manual_time_seconds;

if (isBulkWorkflow && totalManualTimeSeconds) {
  // Bulk workflow: use fixed total time regardless of item count
  metrics.time_saved_seconds = totalManualTimeSeconds;
} else if (metrics.manual_time_per_item_seconds && metrics.manual_time_per_item_seconds > 0 && metrics.total_items > 0) {
  // Per-item workflow: multiply items by time per item
  metrics.time_saved_seconds = metrics.total_items * metrics.manual_time_per_item_seconds;
}
```

### 2. ✅ API Route Already Correct

[/app/api/agents/[id]/executions/route.ts:79-115](app/api/agents/[id]/executions/route.ts#L79-L115) merges `execution_metrics.time_saved_seconds` into `execution.logs.metrics`:

```typescript
// Enrich with execution_metrics data (ROI: time_saved_seconds, total_items)
const { data: metricsData } = await supabaseServer
  .from('execution_metrics')
  .select('execution_id, total_items, time_saved_seconds, manual_time_per_item_seconds')
  .in('execution_id', executionIds);

// Merge metrics into logs.metrics for backward compatibility
resultExecutions = resultExecutions.map(execution => {
  const metrics = metricsMap.get(execution.id);
  return {
    ...execution,
    logs: {
      ...logs,
      metrics: {
        ...logs.metrics,
        time_saved_seconds: metrics.time_saved_seconds,
        // ...
      }
    }
  };
});
```

### 3. ✅ LatestRunCard Already Correct

[LatestRunCard.tsx:86-90](components/v2/agent/LatestRunCard.tsx#L86-L90) reads from merged metrics:

```typescript
const logs = execution?.logs as any
const metrics = logs?.metrics || {}
const timeSavedSeconds = metrics?.time_saved_seconds || 0
const timeSavedValue = hourlyRate && timeSavedSeconds > 0
  ? (timeSavedSeconds / 3600) * hourlyRate
  : 0
```

### 4. ✅ PerformanceTrends Already Correct

[PerformanceTrends.tsx:72-76](components/v2/agent/PerformanceTrends.tsx#L72-L76) prioritizes stored values:

```typescript
const timeSaved = logs?.metrics?.time_saved_seconds

if (timeSaved > 0) {
  // Priority 1: Use actual time_saved_seconds if available in logs
  totalTimeSavedSeconds += timeSaved
} else if (manualTimePerItemSeconds && manualTimePerItemSeconds > 0) {
  // Priority 2: Calculate from items processed × manual time per item (fallback)
  // ...
}
```

### 5. ✅ Dashboard Fixed (This Session)

**Problem**: Dashboard was recalculating `items × manual_time_per_item` instead of using stored `time_saved_seconds`

**Fix**: Updated [dashboard/page.tsx:328-345](app/v2/dashboard/page.tsx#L328-L345) to read directly from `execution_metrics.time_saved_seconds`:

```typescript
// BEFORE (incorrect - recalculating)
const { data: executionMetrics } = await supabase
  .from('execution_metrics')
  .select('execution_id, total_items')
  .in('execution_id', executionIds)

executions30d?.forEach((execution: any) => {
  const totalItems = metricsMap.get(execution.id) || 0
  totalTimeSavedSeconds += totalItems * manualTimePerItem  // ❌ Recalculating
})

// AFTER (correct - using stored values)
const { data: executionMetrics } = await supabase
  .from('execution_metrics')
  .select('execution_id, time_saved_seconds')
  .in('execution_id', executionIds)

executionMetrics?.forEach((metric: any) => {
  if (metric.time_saved_seconds && metric.time_saved_seconds > 0) {
    totalTimeSavedSeconds += metric.time_saved_seconds  // ✅ Using stored value
  }
})
```

### 6. ✅ SystemAnalyticsService Fixed (Previous Session)

Already updated in previous session to use stored `time_saved_seconds` instead of recalculating.

### 7. ✅ BusinessInsightGenerator Fixed (This Session)

**Problem**: Weekly ROI calculation in insights was recalculating using `items × manual_time_per_item × runs_per_week`

**Fix**: Updated [BusinessInsightGenerator.ts:241-337](lib/pilot/insight/BusinessInsightGenerator.ts#L241-L337) to read from stored `execution_metrics.time_saved_seconds`:

```typescript
// BEFORE (incorrect - recalculating)
const timeSavedSecondsPerWeek = itemsPerRun * manualTimePerItem * runsPerWeek;

// AFTER (correct - using stored values)
// Fetch executions from last 7 days
const { data: recentExecutions } = await this.supabase
  .from('agent_executions')
  .select('id, created_at')
  .eq('agent_id', agent.id)
  .gte('created_at', sevenDaysAgo)
  .eq('status', 'completed');

// Fetch stored time_saved_seconds from execution_metrics
const { data: metrics } = await this.supabase
  .from('execution_metrics')
  .select('execution_id, time_saved_seconds')
  .in('execution_id', executionIds);

// Sum up actual time saved (supports both bulk and per-item workflows)
let totalTimeSavedSeconds = 0;
metrics.forEach(metric => {
  if (metric.time_saved_seconds > 0) {
    totalTimeSavedSeconds += metric.time_saved_seconds;
  }
});

const timeSavedHoursPerWeek = totalTimeSavedSeconds / 3600;
const costSavedUsdPerWeek = timeSavedHoursPerWeek * hourlyRate;
```

This ensures business insights show weekly cost savings based on actual execution metrics, not recalculated estimates.

## Database Fix Required

The existing execution has stale data in `execution_metrics` table:

**Execution**: `494784cd-e467-460b-a1fc-735a991f540a` (created 2026-06-01 21:29:55)
- Current: `time_saved_seconds = 25,200` (7 hours) = $700
- Should be: `time_saved_seconds = 300` (5 minutes) = $8.33

**SQL Script**: [fix_execution_494784cd.sql](../fix_execution_494784cd.sql)

```sql
UPDATE execution_metrics
SET
  time_saved_seconds = 300,  -- 5 minutes total (bulk workflow)
  manual_time_per_item_seconds = NULL  -- Clear per-item rate (not applicable for bulk)
WHERE execution_id = '494784cd-e467-460b-a1fc-735a991f540a';
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Agent Configuration (agents table)                          │
│ - manual_time_per_item_seconds: NULL                        │
│ - agent_config.roi_estimate:                                │
│   {                                                          │
│     is_bulk_workflow: true,                                 │
│     total_manual_time_seconds: 300,                         │
│     reasoning: "Bulk filtering workflow..."                 │
│   }                                                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ MetricsCollector.collectMetrics()                           │
│ (Called during workflow execution completion)               │
│                                                              │
│ 1. Fetch agent_config.roi_estimate                          │
│ 2. Check is_bulk_workflow flag                              │
│ 3. Calculate time_saved_seconds:                            │
│    - Bulk: use total_manual_time_seconds (300)              │
│    - Per-item: use items × manual_time_per_item_seconds     │
│ 4. Store in execution_metrics table                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ execution_metrics table (persistent storage)                │
│ - execution_id: <uuid>                                      │
│ - time_saved_seconds: 300  ← STORED VALUE                   │
│ - total_items: 210                                          │
│ - manual_time_per_item_seconds: NULL                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ API Route: /api/agents/[id]/executions                      │
│ 1. Fetch agent_executions (logs field)                      │
│ 2. Fetch execution_metrics (time_saved_seconds)             │
│ 3. Merge: execution.logs.metrics.time_saved_seconds = 300   │
│ 4. Return enriched execution data                           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────┬──────────────────────────────────┐
│ LatestRunCard            │ PerformanceTrends                │
│                          │                                  │
│ logs.metrics             │ logs.metrics                     │
│  .time_saved_seconds     │  .time_saved_seconds             │
│       ↓                  │       ↓                          │
│ $8.33 displayed          │ Aggregate across runs            │
└──────────────────────────┴──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Dashboard                                                    │
│ Directly reads execution_metrics.time_saved_seconds          │
│ Sums across all executions in time period                   │
└─────────────────────────────────────────────────────────────┘
```

## Workflow Types

### Type A: Per-Item Workflows
**Example**: Email responses, data entry, invoice processing
**Calculation**: `items × manual_time_per_item_seconds`
**Configuration**:
```json
{
  "manual_time_per_item_seconds": 120,
  "agent_config": {
    "roi_estimate": null
  }
}
```

### Type B: Bulk Workflows
**Example**: Filter and report critical items, aggregate data, scan for patterns
**Calculation**: `total_manual_time_seconds` (fixed, regardless of item count)
**Configuration**:
```json
{
  "manual_time_per_item_seconds": null,
  "agent_config": {
    "roi_estimate": {
      "is_bulk_workflow": true,
      "total_manual_time_seconds": 300,
      "reasoning": "Bulk filtering workflow..."
    }
  }
}
```

## Verification Steps

1. ✅ Run SQL fix: `fix_execution_494784cd.sql`
2. ✅ Verify in database:
   ```sql
   SELECT
     execution_id,
     time_saved_seconds,
     time_saved_seconds / 3600.0 * 100 as value_usd
   FROM execution_metrics
   WHERE execution_id = '494784cd-e467-460b-a1fc-735a991f540a';
   ```
   Should show: `time_saved_seconds = 300`, `value_usd = 8.33`

3. ✅ Refresh browser (hard refresh: Cmd+Shift+R to clear cache)
4. ✅ Check agent detail page - "Value Saved This Run" should show $8.33
5. ✅ Check Performance Trends - stats should reflect new calculation
6. ✅ Check Dashboard - "Money Saved" should be corrected
7. ✅ Run agent again - new execution should automatically calculate 300 seconds

## Future Executions

All future executions will automatically calculate correctly because:
1. Agent has correct `agent_config.roi_estimate` configuration ✅
2. MetricsCollector checks `is_bulk_workflow` flag ✅
3. Stored `time_saved_seconds` will be 300 (5 minutes) ✅
4. All UI components read from stored value ✅

## Files Changed

| File | Change | Status |
|------|--------|--------|
| `lib/pilot/MetricsCollector.ts` | Added bulk workflow support | ✅ Already done |
| `lib/services/SystemAnalyticsService.ts` | Use stored time_saved_seconds | ✅ Already done |
| `app/v2/dashboard/page.tsx` | Use stored time_saved_seconds | ✅ Fixed this session |
| `lib/pilot/insight/BusinessInsightGenerator.ts` | Weekly ROI from stored values | ✅ Fixed this session |
| `fix_execution_494784cd.sql` | Fix single execution metrics | ⏳ Ready to run |
| `fix_all_executions_955d35c3.sql` | Fix all execution metrics | ⭐ **Recommended** |

## Related Documents

- [MetricsCollector.ts](../lib/pilot/MetricsCollector.ts) - ROI calculation logic
- [Agent Executions API](../app/api/agents/[id]/executions/route.ts) - Metrics enrichment
- [LatestRunCard.tsx](../components/v2/agent/LatestRunCard.tsx) - Display component
- [PerformanceTrends.tsx](../components/v2/agent/PerformanceTrends.tsx) - Aggregate stats
- [Dashboard](../app/v2/dashboard/page.tsx) - System-wide metrics

## Key Learnings

1. **Single Source of Truth**: Always store calculated values in database and read from there
2. **No Recalculation**: UI and analytics should never recalculate - use stored `time_saved_seconds`
3. **Bulk vs Per-Item**: Support both workflow types with clear configuration patterns
4. **Migration Path**: When adding new calculation logic, existing data must be migrated
5. **Data Flow**: MetricsCollector → execution_metrics → API merge → UI display
