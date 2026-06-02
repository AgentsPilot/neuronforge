# Insight System Fix - Balanced Approach (Quality + Efficiency)

> **Date:** 2026-06-01
> **Goal:** Give LLM enough context for useful insights while managing token cost

---

## Key Insight: LLMs Need Context, Not Just Deltas

**Bad approach:**
```
Current: 3 items
Previous: 8 items
Change: -5 items
```
❌ LLM sees the drop but doesn't know if this is:
- Normal variation (fluctuates 5-10 items daily)
- Sudden anomaly (usually stable at 8-10)
- Gradual decline (was 20, then 15, then 10, now 8, now 3)

**Better approach:**
```
Last 7 runs: [10, 9, 8, 8, 8, 8, 3]
Pattern: SUDDEN DROP (was stable at 8, dropped to 3)
Historical range: 7-11 items (last 30 days)
This is OUTSIDE normal range (3 < 7)
```
✅ LLM can distinguish between:
- **Normal fluctuation** - "Slight dip, within normal range"
- **Sudden anomaly** - "Dropped 63% in one run - investigate immediately"
- **Gradual decline** - "Volume decreasing steadily over 2 weeks"

---

## Recommended: "Last 7 Runs" Approach

### What to Send (Token-Efficient Context)

```javascript
## EXECUTION PROGRESSION

**Last 7 Runs (most recent first):**
Run 1 (2h ago):  3 items in 2.4s  | critical: 2, normal: 1    ← CURRENT
Run 2 (4h ago):  8 items in 2.1s  | critical: 5, normal: 3    ← PREVIOUS
Run 3 (6h ago):  8 items in 3.1s  | critical: 5, normal: 3
Run 4 (8h ago):  9 items in 2.8s  | critical: 5, normal: 4
Run 5 (10h ago): 8 items in 2.9s  | critical: 4, normal: 4
Run 6 (12h ago): 10 items in 3.2s | critical: 4, normal: 6
Run 7 (14h ago): 9 items in 2.7s  | critical: 5, normal: 4

**Pattern Analysis:**
- Runs 2-7 were stable: 8-10 items (avg 8.7)
- Run 1 dropped to 3 items: -62.5% from previous
- This is a SUDDEN DROP, not gradual decline
- Critical items: 2 (was 4-5, dropped 60%)

**Historical Context (last 30 days):**
- Typical range: 7-11 items per run
- Average: 8.5 items
- This run (3 items) is BELOW typical range

**What This Means:**
- Volume was STABLE for last 6 runs (8-10 items)
- Sudden drop in latest run (3 items)
- Something CHANGED recently - not normal variation
```

**Token estimate:** ~400 tokens (vs 200 for 2-run comparison, vs 2000 for 30-run dump)

---

## Why 7 Runs Is The Sweet Spot

### Gives LLM Enough Context To Detect:

1. **Sudden Drops/Spikes**
```
[10, 10, 9, 10, 10, 10, 3]  ← ANOMALY (sudden)
[10, 9, 8, 7, 6, 5, 4]      ← TREND (gradual)
[10, 10, 10, 10, 10, 10, 10] ← STABLE (no change)
```

2. **Step Changes**
```
[10, 10, 10, 10, 3, 3, 3]   ← LEVEL SHIFT (permanent change)
[10, 10, 10, 3, 10, 10, 10]  ← BLIP (temporary anomaly)
```

3. **Volatility**
```
[10, 3, 12, 2, 9, 4, 11]    ← HIGH VOLATILITY (erratic)
[10, 9, 10, 10, 9, 10, 9]   ← LOW VOLATILITY (stable)
```

4. **Positive Trends** (celebratory insights!)
```
[10, 8, 6, 4, 2, 1, 0]      ← "Zero complaints 🎉 - great job!"
[5, 10, 15, 20, 25, 30, 35] ← "Lead volume up 7x - scaling well!"
```

---

## Implementation

### Step 1: Fetch Last 7 + Historical Stats

```typescript
// File: lib/pilot/insight/InsightAnalyzer.ts
// Around line 120-135

// Fetch last 7 runs for progression analysis
const { data: last7Runs } = await this.supabase
  .from('execution_metrics')
  .select('*')
  .eq('agent_id', agentId)
  .order('executed_at', { ascending: false })
  .limit(7);

if (!last7Runs || last7Runs.length < 2) {
  console.log('[InsightAnalyzer] Not enough runs for progression analysis (need 2+)');
  return;
}

// Fetch last 30 days for historical baseline (lightweight query - just stats)
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const { data: historicalStats } = await this.supabase
  .from('execution_metrics')
  .select('total_items, duration_ms')
  .eq('agent_id', agentId)
  .gte('executed_at', thirtyDaysAgo.toISOString())
  .order('executed_at', { ascending: false });

// Calculate historical baseline
const historicalBaseline = calculateBaseline(historicalStats);

// Build progression context
const progressionContext = {
  last7Runs: last7Runs.map(run => ({
    total_items: run.total_items,
    duration_ms: run.duration_ms,
    field_counts: run.items_by_field || {},
    executed_at: run.executed_at,
    time_ago: getTimeAgo(run.executed_at),
  })),
  pattern: detectPattern(last7Runs),
  historicalBaseline: {
    avg_items: historicalBaseline.avgItems,
    typical_range: historicalBaseline.range,
    is_current_within_range: isWithinRange(last7Runs[0], historicalBaseline),
  },
};

businessInsights = await businessGenerator.generate(
  agent,
  trends,
  progressionContext,  // ✅ 7 runs + pattern + baseline
  sortedPatterns
);
```

### Step 2: Pattern Detection Helper

```typescript
function detectPattern(runs: ExecutionMetrics[]): {
  type: 'stable' | 'sudden_drop' | 'sudden_spike' | 'gradual_decline' | 'gradual_increase' | 'step_change' | 'volatile';
  description: string;
  severity: 'normal' | 'attention' | 'critical';
} {
  const items = runs.map(r => r.total_items);

  // Calculate volatility (coefficient of variation)
  const mean = items.reduce((a, b) => a + b, 0) / items.length;
  const variance = items.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / items.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;

  // High volatility (CV > 0.3)
  if (cv > 0.3) {
    return {
      type: 'volatile',
      description: 'Volume fluctuates significantly between runs',
      severity: 'attention',
    };
  }

  const current = items[0];
  const previous = items[1];
  const recent5Avg = items.slice(1, 6).reduce((a, b) => a + b, 0) / 5;

  // Sudden drop (>40% from stable baseline)
  const dropFromBaseline = ((current - recent5Avg) / recent5Avg) * 100;
  if (dropFromBaseline < -40) {
    return {
      type: 'sudden_drop',
      description: `Volume dropped ${Math.abs(dropFromBaseline).toFixed(0)}% from stable baseline of ${recent5Avg.toFixed(1)} items`,
      severity: 'critical',
    };
  }

  // Sudden spike (>40% from stable baseline)
  if (dropFromBaseline > 40) {
    return {
      type: 'sudden_spike',
      description: `Volume spiked ${dropFromBaseline.toFixed(0)}% from stable baseline of ${recent5Avg.toFixed(1)} items`,
      severity: 'attention',
    };
  }

  // Gradual decline (decreasing trend over 7 runs)
  const isDecreasing = items.every((val, i) => i === 0 || val <= items[i - 1]);
  if (isDecreasing && items[0] < items[6] * 0.7) {
    return {
      type: 'gradual_decline',
      description: `Volume declining steadily from ${items[6]} to ${items[0]} over 7 runs`,
      severity: 'attention',
    };
  }

  // Gradual increase (increasing trend over 7 runs)
  const isIncreasing = items.every((val, i) => i === 0 || val >= items[i - 1]);
  if (isIncreasing && items[0] > items[6] * 1.3) {
    return {
      type: 'gradual_increase',
      description: `Volume increasing steadily from ${items[6]} to ${items[0]} over 7 runs`,
      severity: 'normal',
    };
  }

  // Step change (sudden shift that persists)
  const first3Avg = items.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const last3Avg = items.slice(4, 7).reduce((a, b) => a + b, 0) / 3;
  const stepChange = ((first3Avg - last3Avg) / last3Avg) * 100;
  if (Math.abs(stepChange) > 30) {
    return {
      type: 'step_change',
      description: `Volume shifted from ${last3Avg.toFixed(1)} to ${first3Avg.toFixed(1)} (${stepChange > 0 ? '+' : ''}${stepChange.toFixed(0)}%)`,
      severity: 'attention',
    };
  }

  // Stable
  return {
    type: 'stable',
    description: `Volume stable around ${mean.toFixed(1)} items (±${stdDev.toFixed(1)})`,
    severity: 'normal',
  };
}
```

### Step 3: Updated LLM Prompt

```typescript
function buildProgressionPrompt(
  workflowContext: string,
  progression: ProgressionContext,
  trends: TrendMetrics
): string {
  const runs = progression.last7Runs;

  return `You are a business intelligence analyst helping users understand their workflow automation.

# Workflow Purpose
${workflowContext}

# EXECUTION PROGRESSION (Last 7 Runs)

${runs.map((run, i) => {
  const label = i === 0 ? '← CURRENT RUN' : i === 1 ? '← PREVIOUS RUN' : '';
  return `Run ${i + 1} (${run.time_ago}): ${run.total_items} items in ${(run.duration_ms / 1000).toFixed(1)}s | ${formatFieldCounts(run.field_counts)} ${label}`;
}).join('\n')}

**Pattern Detected:**
- Type: ${progression.pattern.type.toUpperCase()}
- ${progression.pattern.description}
- Severity: ${progression.pattern.severity}

**Historical Context (Last 30 Days):**
- Typical volume: ${progression.historicalBaseline.typical_range.min}-${progression.historicalBaseline.typical_range.max} items
- Average: ${progression.historicalBaseline.avg_items.toFixed(1)} items
- Current run (${runs[0].total_items} items) is ${
  progression.historicalBaseline.is_current_within_range
    ? 'WITHIN normal range ✓'
    : 'OUTSIDE normal range ⚠️'
}

**7-Day Trends:**
- Volume change: ${trends.volume_change_7d > 0 ? '+' : ''}${(trends.volume_change_7d * 100).toFixed(1)}%
- Processing time change: ${trends.duration_change_7d > 0 ? '+' : ''}${(trends.duration_change_7d * 100).toFixed(1)}%
- Empty results: ${(trends.empty_result_rate * 100).toFixed(1)}%
- Failed runs: ${(trends.failure_rate * 100).toFixed(1)}%

# YOUR TASK

Generate 0-3 business insights based on the progression above.

**IMPORTANT RULES:**

1. **Only generate insights for SIGNIFICANT changes:**
   - sudden_drop or sudden_spike → MUST generate insight (high severity)
   - gradual_decline/increase > 30% → Generate insight (medium severity)
   - step_change > 30% → Generate insight (medium severity)
   - stable or small changes → Return ZERO insights (workflow is healthy)

2. **Be specific about the progression:**
   - ❌ BAD: "Volume decreased"
   - ✅ GOOD: "Volume dropped 63% (from stable 8 items to 3) in latest run"

3. **Explain the pattern:**
   - Sudden drop → "Check for data source changes, filters, or upstream issues"
   - Gradual decline → "Investigate if this trend is expected or indicates declining engagement"
   - Sudden spike → "Verify if spike is positive (more leads) or concerning (more errors)"
   - Step change → "Volume shifted to new level - confirm if this is intentional"

4. **Consider workflow purpose:**
   - Complaints/Errors: LOW volume = GOOD (celebrate!), HIGH volume = BAD
   - Leads/Sales: HIGH volume = GOOD, LOW volume = BAD

5. **Return ZERO insights if workflow is healthy:**
   - Stable pattern with no significant changes
   - Small fluctuations within normal range
   - Example: [10, 9, 10, 10, 9, 10, 9] → NO INSIGHT NEEDED

# Output Format

\`\`\`json
{
  "insights": [
    {
      "type": "operational_anomaly" | "volume_trend" | "category_shift" | "scale_opportunity",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Specific title referencing the change (max 60 chars)",
      "description": "What happened in the last 7 runs (2-3 sentences)",
      "business_impact": "Why this matters (1 sentence)",
      "recommendation": "Specific action to take (1-2 sentences)",
      "confidence": 0.7-0.95
    }
  ]
}
\`\`\`

**If no significant changes detected, return empty array:**
\`\`\`json
{
  "insights": []
}
\`\`\`
`;
}
```

---

## Token Analysis

### Before (Current System)
```
Workflow context:        100 tokens
Trend summary:           300 tokens
30 execution dump:     2,000 tokens  ← Mostly wasted
Instructions:            200 tokens
─────────────────────────────────
TOTAL:                 2,600 tokens
```

### After (7-Run Progression)
```
Workflow context:        100 tokens
Trend summary:           300 tokens
7-run progression:       400 tokens  ← Efficient + useful
Pattern detection:        50 tokens
Historical baseline:      50 tokens
Instructions:            300 tokens  ← More detailed
─────────────────────────────────
TOTAL:                 1,200 tokens  ← 54% reduction
```

**But more importantly:** Quality goes up because LLM can:
- Distinguish sudden vs gradual changes
- See stability before the change
- Understand if current value is within/outside normal range
- Generate celebratory insights for positive trends

---

## Example Outputs

### Scenario 1: Sudden Drop (8 → 3)
```json
{
  "insights": [
    {
      "type": "operational_anomaly",
      "severity": "high",
      "title": "Critical task volume dropped 63% - investigate data source",
      "description": "Critical tasks were stable at 8-10 items for the past 6 runs, then suddenly dropped to 3 in the latest run (62.5% decrease). This is outside the normal range of 7-11 items.",
      "business_impact": "Sudden drop may indicate data source filter changes, Gmail connection issues, or missing tasks that require attention.",
      "recommendation": "Check Gmail filter settings and verify no emails are being missed. Review data source connection logs for errors.",
      "confidence": 0.92
    }
  ]
}
```

### Scenario 2: Gradual Decline
```
Last 7: [4, 6, 8, 10, 12, 14, 16]

Insight:
"Customer complaints declining 75% over 7 days 🎉 - process improvements working!"
Severity: LOW (good news)
Type: volume_trend
```

### Scenario 3: Stable (No Insight)
```
Last 7: [10, 9, 10, 10, 9, 10, 9]

Output: { "insights": [] }
Reasoning: Volume stable around 9.7 items, within normal range, no action needed
```

---

## Summary

**Balanced Approach:**
- ✅ Send 7 runs (not 30, not 2)
- ✅ Include pattern detection (sudden vs gradual)
- ✅ Include historical baseline (normal range)
- ✅ 54% token reduction vs current
- ✅ Much better insight quality

**Key Benefits:**
1. LLM can detect SUDDEN vs GRADUAL changes
2. Can generate celebratory insights (volume down for complaints = good!)
3. Can skip generating insights when workflow is healthy
4. Can be specific: "dropped from stable 8 to 3" vs vague "volume decreased"

**Implementation: ~150 lines total**
- Pattern detection helper: ~80 lines
- InsightAnalyzer changes: ~40 lines
- Prompt updates: ~30 lines
