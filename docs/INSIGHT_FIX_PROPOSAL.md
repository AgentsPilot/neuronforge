# Insight System Fix - Minimal Token Approach

> **Date:** 2026-06-01
> **Goal:** Show useful business insights (like "8 tasks → 3 tasks") with minimal token cost

---

## Problem Summary

**User's need:** "Show that volume dropped from 8 to 3 critical tasks"

**Current state:** LLM sees 30 runs but can't tell which is "current" vs "previous"

**Token concern:** Don't want to send massive amounts of data to LLM

---

## Current Token Usage

### What's Sent Now (Estimated ~2,500 tokens)

```javascript
// Workflow context: ~100 tokens
"Monitor critical Gmail emails and categorize by priority"

// Trend summary: ~300 tokens
{
  baseline: {...},
  detected_metric: {...},
  volume_change_7d: -0.36,
  duration_change_7d: 0.05,
  // ... more aggregates
}

// 30 execution samples: ~2,000 tokens
[
  {"items": 3, "duration_ms": 2400, "field_counts": {...}},
  {"items": 8, "duration_ms": 2100, "field_counts": {...}},
  // ... 28 more
]
```

**Problem:** Those 30 samples are mostly ignored - LLM can't use them effectively without ordering

---

## Proposed Solution: Smart Compression

### Only Send 3 Runs (Not 30) + Deltas

**New approach:** Send only what matters for business insights:
1. **Current run** (most recent)
2. **Previous run** (one before)
3. **7-day average** (for context)
4. **Pre-calculated deltas** (changes)

### Token Savings

**Before:** ~2,500 tokens (30 runs + trends)
**After:** ~800 tokens (2 runs + deltas + trends)
**Savings:** 68% reduction (1,700 tokens saved)

---

## Implementation

### Step 1: Change Data Preparation (InsightAnalyzer.ts)

**Current:**
```typescript
// Sends all 30 metrics
const { data: recentMetrics } = await this.supabase
  .from('execution_metrics')
  .select('*')
  .eq('agent_id', agentId)
  .order('executed_at', { ascending: false })
  .limit(30);  // ❌ Too much data

businessInsights = await businessGenerator.generate(
  agent,
  trends,
  recentMetrics as any,  // All 30 runs
  sortedPatterns
);
```

**New:**
```typescript
// Fetch last 2 runs + calculate deltas
const { data: recentMetrics } = await this.supabase
  .from('execution_metrics')
  .select('*')
  .eq('agent_id', agentId)
  .order('executed_at', { ascending: false })
  .limit(2);  // ✅ Only need 2 for comparison

if (!recentMetrics || recentMetrics.length < 2) {
  // Not enough data for comparison - skip business insights
  console.log('[InsightAnalyzer] Not enough runs for comparison (need 2+)');
  return;
}

// Calculate run-to-run changes
const currentRun = recentMetrics[0];
const previousRun = recentMetrics[1];

const comparison = {
  current: {
    total_items: currentRun.total_items,
    duration_ms: currentRun.duration_ms,
    field_counts: currentRun.items_by_field || {},
    executed_at: currentRun.executed_at,
  },
  previous: {
    total_items: previousRun.total_items,
    duration_ms: previousRun.duration_ms,
    field_counts: previousRun.items_by_field || {},
    executed_at: previousRun.executed_at,
  },
  deltas: {
    total_items: currentRun.total_items - previousRun.total_items,
    total_items_pct: previousRun.total_items > 0
      ? ((currentRun.total_items - previousRun.total_items) / previousRun.total_items) * 100
      : 0,
    duration_ms: currentRun.duration_ms - previousRun.duration_ms,
    duration_pct: previousRun.duration_ms > 0
      ? ((currentRun.duration_ms - previousRun.duration_ms) / previousRun.duration_ms) * 100
      : 0,
    field_deltas: calculateFieldDeltas(
      currentRun.items_by_field || {},
      previousRun.items_by_field || {}
    ),
  }
};

businessInsights = await businessGenerator.generate(
  agent,
  trends,
  comparison,  // ✅ Just 2 runs + deltas
  sortedPatterns
);
```

### Step 2: Update Prompt (BusinessInsightGenerator.ts)

**Current prompt (~2,000 tokens for 30 runs):**
```javascript
## Recent Execution Samples (Last 30 runs - metadata only)
[
  {"items": 3, "duration_ms": 2400, ...},
  {"items": 8, "duration_ms": 2100, ...},
  // ... 28 more (mostly ignored by LLM)
]
```

**New prompt (~200 tokens for 2 runs + deltas):**
```javascript
## THIS RUN vs LAST RUN

**Current Run (${currentRun.executed_at}):**
- Total items: ${current.total_items}
- Processing time: ${(current.duration_ms / 1000).toFixed(1)}s
- Field breakdown: ${JSON.stringify(current.field_counts)}

**Previous Run (${previousRun.executed_at}):**
- Total items: ${previous.total_items}
- Processing time: ${(previous.duration_ms / 1000).toFixed(1)}s
- Field breakdown: ${JSON.stringify(previous.field_counts)}

**CHANGES (Current vs Previous):**
${deltas.total_items_pct > 30 || deltas.total_items_pct < -30
  ? `⚠️ SIGNIFICANT CHANGE: `
  : ''}Total items: ${deltas.total_items} (${deltas.total_items_pct > 0 ? '+' : ''}${deltas.total_items_pct.toFixed(1)}%)
- Processing time: ${deltas.duration_ms}ms (${deltas.duration_pct > 0 ? '+' : ''}${deltas.duration_pct.toFixed(1)}%)
${Object.entries(deltas.field_deltas).map(([field, delta]) =>
  `- ${field}: ${delta.current} (was ${delta.previous}, ${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}%)`
).join('\n')}

**7-Day Average (for context):**
- Average items: ${trends.metric_value_recent.toFixed(1)}
- Average duration: ${(trends.baseline.avg_duration_ms / 1000).toFixed(1)}s

**YOUR TASK:**
Analyze the changes above and generate insights that explain:
1. WHY the volume changed (if significant >30% change)
2. WHAT this means for the business
3. WHAT action the user should take
```

---

## Helper Function: calculateFieldDeltas

```typescript
function calculateFieldDeltas(
  currentFields: Record<string, number>,
  previousFields: Record<string, number>
): Record<string, { current: number; previous: number; delta: number; pct: number }> {
  const allFields = new Set([
    ...Object.keys(currentFields),
    ...Object.keys(previousFields)
  ]);

  const deltas: Record<string, any> = {};

  for (const field of allFields) {
    const current = currentFields[field] || 0;
    const previous = previousFields[field] || 0;
    const delta = current - previous;
    const pct = previous > 0 ? ((current - previous) / previous) * 100 : 0;

    // Only include fields with significant changes (>20%) or important fields
    if (Math.abs(pct) > 20 || field.includes('critical') || field.includes('priority')) {
      deltas[field] = { current, previous, delta, pct };
    }
  }

  return deltas;
}
```

---

## Example Output

### Before (Generic)
```
Title: "High volume of critical tasks detected"
Description: "Recent executions show an average of 5.5 critical tasks"
Business Impact: "Processing critical items requires attention"
Recommendation: "Monitor critical task queue"
Severity: "medium"
```

### After (Specific with Run Comparison)
```
Title: "Critical task volume dropped 63% - investigate data source"
Description: "Critical tasks decreased from 8 to 3 in the latest run. This sudden 62.5% drop may indicate data source filter changes, upstream process completing tasks faster, or a potential data pipeline issue."
Business Impact: "Unexpected 63% drop could signal data quality issues or missed tasks. If intentional, represents improved efficiency."
Recommendation: "Verify with upstream team if this decrease is expected. Check Gmail filter settings and data source connections."
Severity: "high"
Type: "operational_anomaly"
```

---

## Token Analysis

### Before
```
Workflow context:        100 tokens
Trend summary:           300 tokens
30 execution samples:  2,000 tokens
Technical patterns:      100 tokens
Instructions:            200 tokens
─────────────────────────────────
TOTAL:                 2,700 tokens
```

### After
```
Workflow context:        100 tokens
Trend summary:           300 tokens
2 runs + deltas:         200 tokens  ← 90% reduction here
Technical patterns:      100 tokens
Instructions:            200 tokens
─────────────────────────────────
TOTAL:                   900 tokens  ← 67% reduction
```

**Cost savings per insight generation:**
- Before: 2,700 input tokens × $0.003/1K = **$0.0081**
- After: 900 input tokens × $0.003/1K = **$0.0027**
- **Savings: 67% ($0.0054 per call)**

If agent runs 100 times/week with insights enabled:
- Before: $0.81/week
- After: $0.27/week
- **Savings: $0.54/week per agent**

---

## Implementation Steps

### 1. Update InsightAnalyzer.ts (~30 lines)
```typescript
// Around line 120-135
// Change from fetching 30 to fetching 2 + calculate deltas
```

### 2. Update BusinessInsightGenerator.ts (~50 lines)
```typescript
// Around line 230-260
// Change buildBusinessInsightPrompt() signature
// Update prompt to show current vs previous
```

### 3. Add helper function (~20 lines)
```typescript
// New file: lib/pilot/insight/RunComparator.ts
// OR add to BusinessInsightGenerator.ts
```

**Total LOC: ~100 lines**

---

## Alternative: Even More Aggressive

If we want **maximum** token savings:

### Ultra-Minimal Approach

**Only send deltas, not raw data:**

```javascript
## CHANGES FROM LAST RUN

- Total items: -5 (↓62.5%) ⚠️ SIGNIFICANT DROP
- Critical items: -3 (↓60.0%)
- Processing time: +300ms (↑14.3%)

**Context:**
- 7-day average: 5.5 items
- This is UNUSUAL - typical variation is ±15%

**Generate insight explaining why items dropped suddenly**
```

**Token count: ~100 tokens** (vs 2,000 tokens for 30 runs)
**Savings: 95%**

---

## Recommendation

**Go with the "Smart Compression" approach:**

✅ **Pros:**
- 67% token reduction (good enough)
- Gives LLM enough context to understand the situation
- Shows both current state AND change
- Enables specific, actionable insights

❌ **Don't use Ultra-Minimal:**
- LLM needs some absolute numbers for context
- "Dropped by 5" is less useful than "Dropped from 8 to 3"
- Small incremental savings vs risk of worse insights

---

## Next Steps

1. **Implement comparison logic** in InsightAnalyzer
2. **Update prompt** in BusinessInsightGenerator
3. **Test with real agent** that has volume changes
4. **Verify token usage** in logs

Want me to implement this now?
