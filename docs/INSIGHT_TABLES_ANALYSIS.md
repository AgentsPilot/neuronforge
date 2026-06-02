# Insight Tables Analysis & Recommendations

> **Date:** 2026-06-01
> **Issue:** Current insight system doesn't compare executions over time to show trends

---

## Current Architecture

### Two-Table Design

**`execution_insights`** - Current active state (deduplicated)
- Stores ONE record per unique insight
- Purpose: Show user what insights are currently active
- Deduplication: By title (within 7 days)
- Fields: `execution_ids[]` - array of all executions that contributed to this insight

**`execution_insight_runs`** - Historical time-series log
- Stores ONE record per execution per insight
- Purpose: Track how insights evolve over time
- No deduplication: Every execution creates new records
- Fields: `this_run_count`, `last_run_count` - for tracking frequency changes

---

## The Problem

### User's Example
"We had two runs: one with 8 critical tasks, then it dropped to 3, but the insight never showed it."

### Root Cause
The **BusinessInsightGenerator** receives metrics but **doesn't compare them to previous runs** to detect trends:

```typescript
// Current flow in BusinessInsightGenerator.ts
generate(agent, trends, recentMetrics, detectedPatterns) {
  // ❌ Receives last 30 execution metrics
  // ❌ But only looks at AGGREGATE trends (7-day averages)
  // ❌ Doesn't compare "this run vs last run"

  // Example: If critical tasks dropped from 8 → 3:
  // - execution_insight_runs STORES both snapshots (8, then 3)
  // - But LLM prompt only gets: "Recent average: 5.5 critical tasks"
  // - Never gets: "Last run: 8 tasks → This run: 3 tasks (dropped 63%!)"
}
```

---

## What's Missing

### 1. **Run-to-Run Comparison**

The LLM needs to see:
```json
{
  "current_run": {
    "critical_tasks": 3,
    "total_items": 15,
    "duration_ms": 2400
  },
  "previous_run": {
    "critical_tasks": 8,
    "total_items": 20,
    "duration_ms": 2100
  },
  "changes": {
    "critical_tasks": -5,  // Dropped by 5
    "critical_tasks_pct": -62.5,  // 62.5% decrease
    "total_items": -5,
    "total_items_pct": -25.0
  }
}
```

**Current state:** LLM never receives this comparison data.

### 2. **Trend Detection Over Time**

For meaningful business insights, the LLM should see:
```json
{
  "last_7_runs": [
    {"run": 1, "critical_tasks": 10},
    {"run": 2, "critical_tasks": 9},
    {"run": 3, "critical_tasks": 8},  // ← Previous
    {"run": 4, "critical_tasks": 3},  // ← Current (sudden drop!)
  ],
  "trend": "decreasing",
  "volatility": "high",  // Sudden 62% drop is unusual
  "pattern": "step_change"  // Not gradual decline
}
```

**Current state:** TrendAnalyzer only looks at 7-day aggregates, not individual run progression.

### 3. **Context-Aware Insights**

The system should generate insights like:
- ✅ "Critical task volume **dropped 63%** (8 → 3 tasks) - investigate data source changes"
- ✅ "Processing time **increased 40%** despite handling 25% fewer items - performance regression detected"
- ✅ "**Zero complaints** for 3 consecutive days after averaging 15/day - process improvement working!"

**Current state:** Insights are generic, not tied to specific run-to-run changes.

---

## Available Data

### ✅ We Already Capture Everything Needed

**`execution_insight_runs` table has:**
```sql
-- Run-specific snapshots (one per execution)
this_run_count INTEGER,        -- Items in this run
last_run_count INTEGER,        -- Items in previous run
pattern_data JSONB,            -- Run-specific metrics
created_at TIMESTAMPTZ         -- When this run happened
```

**`execution_metrics` table has:**
```sql
-- Per-execution metrics
total_items INTEGER,           -- Items processed
duration_ms INTEGER,           -- Execution time
items_by_field JSONB,          -- Field-level breakdowns (e.g., {critical: 8, normal: 12})
field_names TEXT[],            -- Available fields
time_saved_seconds NUMERIC,    -- ROI calculation
executed_at TIMESTAMPTZ        -- Run timestamp
```

**Problem:** This data exists but **isn't being passed to the LLM** for analysis!

---

## Recommended Architecture Changes

### Option 1: Enhance BusinessInsightGenerator (Recommended)

**Change:** Pass run-to-run comparison data to the LLM

**Implementation:**

1. **Fetch Previous Run Metrics** (in `InsightAnalyzer.ts`):
```typescript
// Before calling businessGenerator.generate()
const { data: currentMetrics } = await supabase
  .from('execution_metrics')
  .select('*')
  .eq('execution_id', executionId)
  .single();

const { data: previousMetrics } = await supabase
  .from('execution_metrics')
  .select('*')
  .eq('agent_id', agentId)
  .order('executed_at', { ascending: false })
  .limit(2);  // Get last 2 runs

const comparison = {
  current: currentMetrics,
  previous: previousMetrics[1],  // Second most recent
  changes: calculateChanges(currentMetrics, previousMetrics[1])
};
```

2. **Update LLM Prompt** (in `BusinessInsightGenerator.ts`):
```typescript
const prompt = `
Analyze this workflow execution and generate business insights.

**THIS RUN vs LAST RUN:**
- Total items: ${comparison.current.total_items} (was ${comparison.previous.total_items}, ${comparison.changes.total_items_pct}%)
- Critical tasks: ${comparison.current.items_by_field.critical || 0} (was ${comparison.previous.items_by_field.critical || 0})
- Duration: ${comparison.current.duration_ms}ms (was ${comparison.previous.duration_ms}ms, ${comparison.changes.duration_pct}%)

**WHAT TO LOOK FOR:**
1. Sudden drops/spikes (>30% change) - investigate data source issues
2. Step changes in field distributions - business process changes
3. Zero values after consistent activity - operational anomalies
4. Positive trends - celebrate improvements!

Generate insights that explain WHAT CHANGED and WHY it matters.
`;
```

3. **Update Insight Types** (add new comparative types):
```typescript
export type InsightType =
  | 'volume_trend'           // Existing
  | 'operational_anomaly'    // Existing
  | 'sudden_drop'           // NEW: >40% decrease in one run
  | 'sudden_spike'          // NEW: >40% increase in one run
  | 'step_change'           // NEW: Sustained level shift
  | 'positive_trend'        // NEW: Improvement over time
  | 'negative_trend';       // NEW: Degradation over time
```

**Benefits:**
- ✅ Uses existing data (no schema changes)
- ✅ LLM can detect "8 → 3" drops immediately
- ✅ Generates actionable, specific insights
- ✅ Works for all metric types (items, duration, field distributions)

---

### Option 2: Add Run Comparison Service (Alternative)

Create a dedicated comparison engine that pre-computes deltas:

```typescript
// lib/pilot/insight/RunComparator.ts
export class RunComparator {
  async compareRuns(agentId: string, currentExecutionId: string) {
    // Fetch current + previous metrics
    // Calculate all deltas
    // Detect anomalies (>30% changes, zero values, etc.)
    // Return structured comparison for LLM

    return {
      significant_changes: [
        {
          field: 'critical_tasks',
          current: 3,
          previous: 8,
          change_pct: -62.5,
          severity: 'high',  // >50% change
          direction: 'decrease'
        }
      ],
      anomalies: [
        {
          type: 'sudden_drop',
          field: 'critical_tasks',
          description: 'Dropped 63% in one run'
        }
      ]
    };
  }
}
```

**Benefits:**
- ✅ Structured, deterministic anomaly detection
- ✅ Can add statistical analysis (standard deviations, outlier detection)
- ✅ Faster than LLM-only analysis

**Drawbacks:**
- ❌ More code to maintain
- ❌ Less flexible than LLM interpretation

---

## Immediate Action Items

### 1. Fix Empty ROI Matrix (Original Issue)
**Status:** In progress
- Populate `time_saved_hours_per_week`, `cost_saved_usd_per_week` when creating insights
- Data already available in `execution_metrics.time_saved_seconds`

### 2. Add Run Comparison to Insights (New Issue)
**Priority:** High
**Approach:** Option 1 (enhance BusinessInsightGenerator)

**Steps:**
1. Update `InsightAnalyzer.analyze()` to fetch last 2 execution metrics
2. Calculate run-to-run deltas
3. Pass comparison data to `BusinessInsightGenerator`
4. Update LLM prompt to analyze changes
5. Add new insight types: `sudden_drop`, `sudden_spike`, `step_change`

**Estimated LOC:** ~150 lines
**Files to modify:**
- `lib/pilot/insight/InsightAnalyzer.ts` (+40 lines)
- `lib/pilot/insight/BusinessInsightGenerator.ts` (+80 lines)
- `lib/pilot/insight/types.ts` (+10 lines)
- `lib/pilot/insight/detectors/ChangeDetector.ts` (NEW, +100 lines - optional helper)

---

## Example Output After Fix

### Before (Current)
```
Title: "High volume of critical tasks detected"
Description: "Recent executions show an average of 5.5 critical tasks per run"
Business Impact: "Processing critical items requires attention"
Recommendation: "Monitor critical task queue regularly"
```
❌ Generic, doesn't explain the change

### After (With Run Comparison)
```
Title: "Critical task volume dropped 63% - investigate data source"
Description: "Critical tasks decreased from 8 to 3 in the latest run (62.5% drop). This sudden decrease may indicate:
- Data source filter changes
- Upstream process completing tasks faster
- Potential data pipeline issue"
Business Impact: "Unexpected drop could signal data quality issues or missed tasks. If intentional, this represents improved efficiency."
Recommendation: "Verify with upstream team if this decrease is expected. If not, check data source connections and filters."
Severity: "high"
Type: "sudden_drop"
```
✅ Specific, actionable, explains the change

---

## Conclusion

**Current Problem:** The insight system captures all execution data but **doesn't compare runs** before generating insights. The LLM only sees aggregated trends, not "this run vs last run" changes.

**Root Cause:** `BusinessInsightGenerator` receives recent metrics but doesn't calculate or analyze run-to-run deltas.

**Solution:** Pass previous run data + calculated deltas to the LLM, update prompt to focus on changes.

**Impact:** Users will see insights like "Volume dropped 63%" instead of "Average volume is 5.5"
