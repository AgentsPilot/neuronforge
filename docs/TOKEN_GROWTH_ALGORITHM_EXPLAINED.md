# Token Complexity Growth-Based Algorithm Explained

**Date:** 2025-11-07
**Purpose:** Explain why token subdimensions don't use simple weighted averages

---

## Overview

Unlike other complexity dimensions (execution, plugin, workflow, memory), **token complexity uses a sophisticated growth-based algorithm** instead of simple weighted averages. This is why the admin UI token subdimension controls (volume, peak, I/O) **don't actually do anything**.

---

## The Growth-Based Algorithm

### Step 1: Calculate Historical Baseline

**Code:** [updateAgentIntensity.ts:347-365](../lib/utils/updateAgentIntensity.ts:347-365)

```typescript
// Query ALL historical executions for this agent
const allExecutions = await supabase
  .from('token_usage')
  .select('output_tokens')
  .eq('agent_id', agentId)
  .eq('activity_type', 'agent_execution')

// Calculate baseline as average of ALL executions
const totalOutputTokens = allExecutions.reduce((sum, e) => sum + e.output_tokens, 0);
const baselineOutputTokens = totalOutputTokens / allExecutions.length;
```

**Why baseline matters:** Instead of looking at absolute token counts, we measure **how much this execution differs from the agent's historical pattern**.

---

### Step 2: Calculate Growth Rate

**Code:** [updateAgentIntensity.ts:376](../lib/utils/updateAgentIntensity.ts:376)

```typescript
// Growth rate as percentage increase/decrease from baseline
const growthRate = ((currentOutputTokens - baselineOutputTokens) / baselineOutputTokens) * 100;
```

**Examples:**
- Baseline: 1000 tokens, Current: 1250 tokens → Growth: +25%
- Baseline: 1000 tokens, Current: 2000 tokens → Growth: +100%
- Baseline: 1000 tokens, Current: 800 tokens → Growth: -20%

---

### Step 3: Apply Growth Tier Thresholds

**Code:** [updateAgentIntensity.ts:379-403](../lib/utils/updateAgentIntensity.ts:379-403)

**Database-Driven Thresholds:**
```
output_token_growth_monitor_threshold: 25%    (default)
output_token_growth_rescore_threshold: 50%    (default)
output_token_growth_upgrade_threshold: 100%   (default)
```

**Tier Logic:**
```typescript
if (growthRate < 25%) {
  alertLevel: 'none'
  adjustment: 0           // No complexity increase
}
else if (growthRate >= 25% && growthRate < 50%) {
  alertLevel: 'monitor'
  adjustment: +0.2        // Small complexity bump
}
else if (growthRate >= 50% && growthRate < 100%) {
  alertLevel: 'rescore'
  adjustment: +0.75       // Medium complexity bump
}
else { // growthRate >= 100%
  alertLevel: 'upgrade'
  adjustment: +1.25       // Large complexity bump
}
```

**What this means:**
- Agent using 24% more tokens than usual: No penalty
- Agent using 60% more tokens: +0.75 complexity increase
- Agent using 150% more tokens: +1.25 complexity increase (forces upgrade to better model)

---

### Step 4: Calculate Base Token Efficiency

**Code:** [updateAgentIntensity.ts:439-450](../lib/utils/updateAgentIntensity.ts:439-450)

```typescript
// Token efficiency score from I/O ratio
// Lower ratio (concise output) = higher efficiency = lower complexity
const tokenEfficiencyScore = normalizeToScale(
  ioRatio,              // output_tokens / input_tokens
  0.5,                  // min (concise)
  3.0,                  // max (verbose)
  10,                   // inverted scale
  0                     // high ratio = low score
);

// Base complexity (70% weight to efficiency)
const baseComplexity = tokenEfficiencyScore * 0.7;
```

**Example:**
- I/O ratio = 0.6 (concise) → efficiency = 9.2/10 → base = 6.44
- I/O ratio = 2.5 (verbose) → efficiency = 1.7/10 → base = 1.19

---

### Step 5: Quality Metrics Amplification

**Code:** [updateAgentIntensity.ts:455-483](../lib/utils/updateAgentIntensity.ts:455-483)

If agent is **struggling** (low success, high retries), amplify the growth adjustment:

```typescript
let qualityMultiplier = 1.0;

// If success rate < 80% (default threshold)
if (successRate < quality_success_threshold) {
  qualityMultiplier += 0.3;  // Add 30% to multiplier
}

// If retry rate > 30% (default threshold)
if (retryRate > quality_retry_threshold) {
  qualityMultiplier += 0.2;  // Add 20% to multiplier
}

// Apply multiplier to growth adjustment
growthAdjustment = growthAdjustment * qualityMultiplier;
```

**Example Scenario:**
- Growth adjustment: +0.75 (rescore tier)
- Success rate: 70% (below 80% threshold)
- Retry rate: 40% (above 30% threshold)
- Quality multiplier: 1.0 + 0.3 + 0.2 = 1.5
- **Final adjustment: 0.75 × 1.5 = 1.125**

This means struggling agents get penalized harder for token growth.

---

### Step 6: Final Token Complexity Score

**Code:** [updateAgentIntensity.ts:486](../lib/utils/updateAgentIntensity.ts:486)

```typescript
// Final score: base efficiency + amplified growth adjustment
const tokenComplexityScore = clamp(
  baseComplexity + growthAdjustment,
  0,
  10
);
```

**Complete Example:**

**Scenario:** Agent with token usage spike
- Historical baseline: 1000 output tokens (average)
- Current execution: 1800 output tokens (+80% growth)
- I/O ratio: 1.2 (moderate verbosity)
- Success rate: 75% (struggling)
- Retry rate: 35% (high)

**Calculation:**
1. Base efficiency: ioRatio 1.2 → efficiency 7.0 → base = 4.9
2. Growth rate: +80% → rescore tier → adjustment = +0.75
3. Quality amplification:
   - Success penalty: +0.3
   - Retry penalty: +0.2
   - Multiplier: 1.5
   - Adjusted growth: 0.75 × 1.5 = 1.125
4. **Final: 4.9 + 1.125 = 6.025/10**

---

## Why Simple Weighted Averages Don't Work Here

### Other Dimensions (Execution, Plugin, Workflow, Memory)

**Pattern:** Weighted average of observable metrics
```typescript
// Example: Execution complexity
const score = (
  iterationScore * 0.35 +
  durationScore * 0.30 +
  failureScore * 0.20 +
  retryScore * 0.15
);
```

**Why it works:** These are **independent, measurable factors** that combine linearly.

### Token Complexity (Growth-Based)

**Pattern:** Base efficiency + adaptive growth penalty + quality amplification

**Why it's different:**
1. **Historical context matters** - 1000 tokens might be normal for one agent, alarming for another
2. **Growth patterns are non-linear** - 2x growth is worse than 2× the penalty of 1.5x growth
3. **Quality feedback loop** - Struggling agents get penalized harder for token spikes
4. **Adaptive thresholds** - What counts as "excessive" changes based on agent's history

**Simple weighted average would fail because:**
- Volume alone doesn't indicate complexity (1M tokens normal for doc generator, alarming for calculator)
- Peak doesn't account for typical behavior (peak of 10K could be routine spike or major issue)
- I/O ratio doesn't capture growth patterns

---

## Database-Driven Configuration (What IS Configurable)

Even though it's not a simple weighted average, **the growth algorithm IS database-driven**:

### Growth Thresholds (Configurable via Admin UI)
```sql
output_token_growth_monitor_threshold: 25%    -- When to start watching
output_token_growth_rescore_threshold: 50%    -- When to bump complexity
output_token_growth_upgrade_threshold: 100%   -- When to force upgrade
```

### Growth Adjustments (Configurable via Admin UI)
```sql
output_token_growth_monitor_adjustment: 0.2   -- Small penalty
output_token_growth_rescore_adjustment: 0.75  -- Medium penalty
output_token_growth_upgrade_adjustment: 1.25  -- Large penalty
```

### Quality Thresholds (Configurable via Admin UI)
```sql
quality_success_threshold: 80%                -- Success rate to trigger penalty
quality_retry_threshold: 30%                  -- Retry rate to trigger penalty
quality_success_multiplier: 0.3               -- How much to amplify
quality_retry_multiplier: 0.2                 -- How much to amplify
```

### I/O Ratio Range (Database-driven)
```sql
token_io_ratio_min: 0.5   -- Concise output
token_io_ratio_max: 3.0   -- Verbose output
```

---

## What Token Subdimension Weights Would Mean (If They Existed)

**Admin UI shows these controls:**
- `token_volume_weight: 0.5` (50%)
- `token_peak_weight: 0.3` (30%)
- `token_io_weight: 0.2` (20%)

**What users THINK this means:**
```typescript
tokenComplexity = (
  volumeScore * 0.5 +
  peakScore * 0.3 +
  ioScore * 0.2
);
```

**What ACTUALLY happens:**
```typescript
// Volume and peak are NOT used in scoring at all
// Only I/O ratio is used, and only as BASE efficiency
// Growth pattern dominates the score
tokenComplexity = (baseEfficiency_from_ioRatio * 0.7) + growthAdjustment;
```

**Result:** The UI controls are **misleading** - changing them has zero effect.

---

## Recommendations

### Option 1: Remove Misleading UI Controls
Remove token subdimension weight controls from admin UI since they don't affect calculations.

### Option 2: Document the Actual Algorithm
Add explanatory text in admin UI:
```
⚠️ Token complexity uses a growth-based algorithm, not weighted averages.
Configure growth thresholds and quality amplification instead.
```

### Option 3: Simplify Algorithm (Not Recommended)
Change token complexity to use simple weighted average like other dimensions. **This would lose the adaptive, context-aware behavior that makes it valuable.**

---

## Summary

**Token complexity is special because:**
1. ✅ It adapts to each agent's historical baseline
2. ✅ It penalizes unexpected growth patterns
3. ✅ It amplifies penalties for struggling agents
4. ✅ It's still database-driven (just not via subdimension weights)

**Token subdimension weights in admin UI:**
- ❌ Don't affect calculations
- ❌ Are misleading to users
- ❌ Should be removed or documented

**What IS configurable:**
- ✅ Growth thresholds (25%, 50%, 100%)
- ✅ Growth adjustments (0.2, 0.75, 1.25)
- ✅ Quality amplification (80% success, 30% retry)
- ✅ I/O ratio ranges (0.5 to 3.0)

---

**File Reference:** [updateAgentIntensity.ts:338-493](../lib/utils/updateAgentIntensity.ts:338-493)
**Algorithm Type:** Adaptive growth-based with quality amplification
**Status:** Fully functional and database-driven (but not via subdimension weights)
