# What Data The LLM Sees - Current State

> **Date:** 2026-06-01
> **Question:** "Which data is injected to the LLM?"

---

## Data Flow

```
InsightAnalyzer.analyze()
  ↓
  Fetches: Last 30 execution_metrics (line 121-126)
  ↓
  Passes to: BusinessInsightGenerator.generate()
  ↓
  LLM receives: recentMetrics array (30 executions)
```

---

## What The LLM Actually Receives

### 1. Workflow Context
```typescript
// Source: agent.created_from_prompt OR agent.workflow_purpose OR agent.description
"Monitor critical Gmail emails and categorize them by priority"
```

### 2. Trend Analysis (7-Day Aggregates)
```json
{
  "baseline": {
    "avg_items_per_execution": 12.5,
    "avg_duration_ms": 3200,
    "typical_category_distribution": { "high_priority": 30, "normal": 70 }
  },
  "detected_metric": {
    "step_name": "Gmail Search",
    "recent_average": 8.0,
    "historical_average": 12.5,
    "change_percent": -36.0
  },
  "volume_change_7d": -0.36,
  "is_volume_spike": false,
  "is_volume_drop": true,
  "duration_change_7d": 0.05,
  "empty_result_rate": 0.0,
  "failure_rate": 0.0,
  "category_shift_7d": { "high_priority": -10 }
}
```

### 3. Recent Execution Samples (Last 30 Runs)
```json
[
  {
    "items": 3,
    "duration_ms": 2400,
    "has_empty_results": false,
    "field_counts": { "high_priority": 2, "normal": 1 }
  },
  {
    "items": 8,
    "duration_ms": 2100,
    "has_empty_results": false,
    "field_counts": { "high_priority": 5, "normal": 3 }
  },
  {
    "items": 10,
    "duration_ms": 3100,
    "has_empty_results": false,
    "field_counts": { "high_priority": 4, "normal": 6 }
  }
  // ... 27 more executions
]
```

---

## The Problem

### ❌ What LLM DOESN'T See

**Run-to-run comparison:**
```json
// THIS IS NOT SENT TO THE LLM:
{
  "current_run": {
    "execution_id": "abc-123",
    "items": 3,
    "high_priority": 2,
    "executed_at": "2026-06-01T10:00:00Z"
  },
  "previous_run": {
    "execution_id": "abc-122",
    "items": 8,
    "high_priority": 5,
    "executed_at": "2026-06-01T09:00:00Z"
  },
  "changes": {
    "items": -5,             // Dropped by 5
    "items_pct": -62.5,      // 62.5% decrease
    "high_priority": -3,      // Lost 3 critical items
    "high_priority_pct": -60.0
  }
}
```

**Sequential progression:**
```json
// THIS IS NOT SENT TO THE LLM:
{
  "last_5_runs": [
    { "run": 1, "items": 10, "high_priority": 4 },
    { "run": 2, "items": 9,  "high_priority": 5 },
    { "run": 3, "items": 8,  "high_priority": 5 },  // ← Previous
    { "run": 4, "items": 3,  "high_priority": 2 }   // ← Current (SUDDEN DROP!)
  ],
  "pattern": "sudden_drop",  // Not gradual decline
  "volatility": "high"
}
```

---

## What LLM DOES See (Current)

### Format in the Prompt (lines 293-294)

```javascript
## Recent Execution Samples (Last 30 runs - metadata only)
[
  {
    "items": 3,
    "duration_ms": 2400,
    "has_empty_results": false,
    "field_counts": {
      "high_priority": 2,
      "normal": 1
    }
  },
  {
    "items": 8,
    "duration_ms": 2100,
    "has_empty_results": false,
    "field_counts": {
      "high_priority": 5,
      "normal": 3
    }
  },
  // ... 28 more runs
]
```

**Problem:**
- ✅ LLM CAN see all 30 runs
- ❌ But they're in a **flat array** with NO ordering context
- ❌ No `executed_at` timestamps
- ❌ No indication of which is "current" vs "previous"
- ❌ No pre-calculated deltas

**Result:** The LLM would have to:
1. Guess which execution is most recent
2. Manually calculate changes between runs
3. Detect patterns in unordered data

**Why This Fails:**
- LLMs are better at interpreting pre-calculated data than doing math
- Without timestamps, can't tell if drops are sudden or gradual
- Without ordering, can't see "8 → 3" progression

---

## Comparison: What SHOULD Be Sent

### Recommended Prompt Addition

```javascript
## CURRENT EXECUTION vs PREVIOUS EXECUTION

**This Run (Most Recent):**
- Total items: 3
- High priority items: 2 (67% of total)
- Processing time: 2.4 seconds
- Executed at: 2026-06-01 10:00 AM

**Last Run:**
- Total items: 8
- High priority items: 5 (63% of total)
- Processing time: 2.1 seconds
- Executed at: 2026-06-01 09:00 AM

**Changes:**
- Total items: -5 items (↓ 62.5%) ⚠️ SIGNIFICANT DROP
- High priority items: -3 items (↓ 60.0%)
- Processing time: +0.3s (↑ 14.3%)

**Progression (Last 5 Runs):**
1. Run -4: 10 items, 4 high priority
2. Run -3: 9 items, 5 high priority
3. Run -2: 8 items, 5 high priority
4. Run -1: 8 items, 5 high priority  ← Previous
5. Run 0:  3 items, 2 high priority  ← Current ⚠️ SUDDEN DROP

**Pattern Analysis:**
- Type: SUDDEN_DROP (not gradual decline)
- Volatility: HIGH (>50% change in one run)
- Likely causes: Data source filter changed, upstream process issue, missing data

## YOUR TASK:
Explain why the sudden drop from 8 → 3 items happened and what the user should check.
```

---

## Code Location

**Where metrics are fetched:**
```typescript
// File: lib/pilot/insight/InsightAnalyzer.ts
// Lines: 121-126

const { data: recentMetrics } = await this.supabase
  .from('execution_metrics')
  .select('*')
  .eq('agent_id', agentId)
  .order('executed_at', { ascending: false })  // ✅ ORDERED by time
  .limit(30);

// ❌ BUT then passed as flat array to LLM without ordering context
businessInsights = await businessGenerator.generate(
  agent,
  trends,
  recentMetrics as any,  // ← Array of 30 runs
  sortedPatterns
);
```

**Where prompt is built:**
```typescript
// File: lib/pilot/insight/BusinessInsightGenerator.ts
// Lines: 239-244

const formattedMetrics = recentMetrics.slice(0, 30).map(m => ({
  items: m.total_items,
  duration_ms: m.duration_ms,
  has_empty_results: m.has_empty_results,
  field_counts: m.items_by_field,
  // ❌ Missing: executed_at (timestamp)
  // ❌ Missing: run index (position in sequence)
  // ❌ Missing: delta vs previous run
}));
```

---

## Available Data (Already in Database)

### execution_metrics table HAS:
```sql
SELECT
  execution_id,
  agent_id,
  executed_at,          -- ✅ Timestamp
  total_items,          -- ✅ Item count
  duration_ms,          -- ✅ Duration
  items_by_field,       -- ✅ Field-level counts
  time_saved_seconds    -- ✅ ROI data
FROM execution_metrics
WHERE agent_id = 'agent-123'
ORDER BY executed_at DESC
LIMIT 30;
```

**Result:**
```
execution_id | executed_at          | total_items | items_by_field
-------------|---------------------|-------------|------------------
abc-124      | 2026-06-01 10:00:00 | 3          | {high: 2, normal: 1}
abc-123      | 2026-06-01 09:00:00 | 8          | {high: 5, normal: 3}
abc-122      | 2026-06-01 08:00:00 | 8          | {high: 5, normal: 3}
abc-121      | 2026-06-01 07:00:00 | 9          | {high: 5, normal: 4}
abc-120      | 2026-06-01 06:00:00 | 10         | {high: 4, normal: 6}
...
```

✅ **Everything needed for run-to-run comparison EXISTS**
❌ **But it's not being extracted and formatted for the LLM**

---

## Summary

### Current State

**Data Fetched:**
- ✅ Last 30 execution_metrics (ordered by time)
- ✅ TrendAnalyzer computes 7-day aggregates
- ✅ Detected patterns from rule-based detectors

**Data Sent to LLM:**
- ✅ 7-day trend summary (aggregates)
- ✅ 30 execution samples (flat array)
- ❌ NO run-to-run comparison
- ❌ NO sequential progression
- ❌ NO timestamps (can't tell "this run" from "last run")
- ❌ NO pre-calculated deltas

**Result:**
- LLM sees: "Recent average: 5.5 items per run"
- LLM doesn't see: "Last run: 8 items → This run: 3 items (dropped 62.5%)"

### The Fix

**Add to prompt:**
1. Mark first execution as "Current Run"
2. Mark second execution as "Previous Run"
3. Calculate deltas: `current - previous`
4. Show last 5-7 runs in sequential order
5. Flag anomalies: >30% change = "SIGNIFICANT", >50% = "CRITICAL"

**Impact:**
- ❌ Before: "Volume averaging 5.5 items - monitor regularly"
- ✅ After: "Volume dropped 63% (8→3 items) - investigate data source immediately"
