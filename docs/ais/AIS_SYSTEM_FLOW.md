# Complete AIS System - Step by Step Flow

## Overview
The Agent Intensity System (AIS) calculates complexity scores (0-10) for agents based on their actual execution metrics, which are then used to determine pricing multipliers (1.0x-2.0x).

---

## STEP 1: User Runs an Agent

**What Happens**: User clicks "Run" on an agent

**Code Location**: [run-agent/route.ts:256](../app/api/run-agent/route.ts#L256)

**Data Collected**:
```typescript
{
  agent_id: "abc-123",
  user_id: "user-456",
  tokens_used: 2500,           // ← Raw metric
  execution_duration_ms: 15000, // ← Raw metric
  iterations_count: 3,          // ← Raw metric
  plugins_used: ["gmail", "slack"], // ← Raw metric
  tool_calls_count: 5,          // ← Raw metric
  workflow_steps: 8,            // ← Raw metric
  was_successful: true
}
```

**These are RAW METRICS** - just numbers, not scores yet!

---

## STEP 2: Calculate Intensity Score

**Code Location**: [updateAgentIntensity.ts:131-145](../lib/utils/updateAgentIntensity.ts#L131-L145)

### 2A: Fetch Active Ranges

```typescript
// Line 131: Get ranges from database
const ranges = await getAISRanges(supabase);

// This calls: get_active_ais_ranges() SQL function
// Which reads the mode flag and returns appropriate ranges
```

**Mode Flag Determines Ranges**:
- **Mode = 0 (best_practice)**: Returns hardcoded industry standards
- **Mode = 1 (dynamic)**: Returns calculated ranges from YOUR real data

**Example ranges returned**:
```typescript
{
  token_volume: { min: 0, max: 5000 },  // ← From ais_normalization_ranges table
  iterations: { min: 1, max: 10 },      // ← From ais_normalization_ranges table
  plugin_count: { min: 0, max: 10 },    // ← From ais_normalization_ranges table
  workflow_steps: { min: 0, max: 20 }   // ← From ais_normalization_ranges table
  // ... 15 total ranges
}
```

### 2B: Normalize Raw Metrics to 0-10 Scores

**Purpose of `ais_normalization_ranges`**: Convert raw numbers to 0-10 scale

**Example - Token Score**:
```typescript
// Agent used 2500 tokens
// Range from table: min=0, max=5000

token_score = (2500 - 0) / (5000 - 0) * 10 = 5.0
```

**Do this for all 4 components**:

```typescript
// Line 134-137: Calculate component scores
token_complexity_score = calculateTokenComplexity(
  avgTokens: 2500,
  peakTokens: 3000,
  ioRatio: 2.5,
  ranges // ← Uses normalization ranges!
) → Returns 5.2 (0-10 scale)

execution_complexity_score = calculateExecutionComplexity(
  avgIterations: 3,
  avgDuration: 15000,
  successRate: 95,
  retryRate: 0.5,
  ranges // ← Uses normalization ranges!
) → Returns 6.1 (0-10 scale)

plugin_complexity_score = calculatePluginComplexity(
  uniquePlugins: 2,
  avgPluginsPerRun: 2,
  orchestrationOverhead: 800,
  ranges // ← Uses normalization ranges!
) → Returns 4.8 (0-10 scale)

workflow_complexity_score = calculateWorkflowComplexity(
  steps: 8,
  branches: 2,
  loops: 1,
  parallel: 0,
  ranges // ← Uses normalization ranges!
) → Returns 5.5 (0-10 scale)
```

### 2C: Calculate Overall Intensity Score (Weighted Average)

```typescript
// Line 140-145: Combine with weights
intensity_score = (
  5.2 * 0.35 +  // Token (35% weight)
  6.1 * 0.25 +  // Execution (25% weight)
  4.8 * 0.25 +  // Plugin (25% weight)
  5.5 * 0.15    // Workflow (15% weight)
) = 5.45 (final score, 0-10 scale)
```

---

## STEP 3: Save to Database

**Code Location**: [updateAgentIntensity.ts:148-181](../lib/utils/updateAgentIntensity.ts#L148-L181)

**Saved to `agent_intensity_metrics` table**:
```sql
UPDATE agent_intensity_metrics SET
  intensity_score = 5.45,              -- ← Overall score
  token_complexity_score = 5.2,        -- ← Component scores
  execution_complexity_score = 6.1,
  plugin_complexity_score = 4.8,
  workflow_complexity_score = 5.5,
  total_tokens_used = 12500,           -- ← Cumulative raw metrics
  avg_tokens_per_run = 2500,
  total_executions = 5,
  -- ... all other metrics
  last_calculated_at = NOW()
WHERE agent_id = 'abc-123';
```

---

## STEP 4: Display to User (Agent Page UI)

**Code Location**: Agent details page shows `AgentIntensityCard` component

**API Call**: `GET /api/agents/abc-123/intensity`

**What User Sees**:
```
┌─────────────────────────────────┐
│ Agent Complexity Score: 5.45/10 │
│ Pricing Multiplier: 1.55x       │
├─────────────────────────────────┤
│ Token Complexity:    5.2 (35%)  │
│ Execution Complexity: 6.1 (25%) │
│ Plugin Complexity:   4.8 (25%)  │
│ Workflow Complexity: 5.5 (15%)  │
└─────────────────────────────────┘
```

**This is for INFORMATION only** - shows user how complex their agent is!

---

## STEP 5: Calculate Pricing

**Code Location**: [CreditService.ts:344-405](../lib/services/CreditService.ts#L344-L405)

**How Pricing Uses Intensity Score**:

```typescript
async chargeForExecution(
  userId: string,
  agentId: string,
  tokens: number,           // Raw tokens used: 2500
  intensityScore: number    // From database: 5.45
) {
  // Base cost: 1 credit per 10 tokens
  const baseCredits = Math.ceil(2500 / 10) = 250 credits

  // Intensity multiplier: 1.0 to 2.0 range
  const intensityMultiplier = 1.0 + (5.45 / 10) = 1.545x

  // Final cost with complexity adjustment
  const finalCredits = Math.ceil(250 * 1.545) = 387 credits

  // Charge the user
  deduct 387 credits from balance
}
```

**Why Intensity Affects Pricing**:
- Simple agent (score 2.0): 250 credits × 1.2 = **300 credits**
- Medium agent (score 5.45): 250 credits × 1.545 = **387 credits**
- Complex agent (score 9.0): 250 credits × 1.9 = **475 credits**

More complex agents use more system resources → cost more!

---

## 📊 What is `ais_normalization_ranges` Used For?

**Answer**: It's used in **STEP 2B** to convert raw metrics into normalized 0-10 scores.

### Why We Need Normalization

**Without normalization** (comparing raw numbers):
```
Agent A: 1000 tokens, 2 plugins, 5 steps
Agent B: 15000ms duration, 1 iteration, 3 branches

Which is more complex? Can't compare! Different units!
```

**With normalization** (all on 0-10 scale):
```
Agent A: token_score=2.0, plugin_score=2.0, workflow_score=2.5 → 2.1 overall
Agent B: execution_score=5.0, execution_score=1.0, workflow_score=3.0 → 3.2 overall

Agent B is more complex! ✓
```

### Is it Used for Pricing?

**Indirectly, YES!**

```
Raw Metrics (tokens, duration, plugins)
    ↓
ais_normalization_ranges (normalize to 0-10)
    ↓
Intensity Score (5.45)
    ↓
Pricing Multiplier (1.545x)
    ↓
Final Price (387 credits)
```

**The ranges don't set prices directly**, but they determine the intensity score, which determines the pricing multiplier!

---

## 🔄 How Mode Flag Controls Everything

### Mode 0 (Best Practice)
```
ais_normalization_ranges returns best_practice_min/max columns
    ↓
Uses industry standard ranges (same for everyone)
    ↓
Agent with 2500 tokens gets score 5.0
    ↓
Pricing multiplier: 1.5x
```

### Mode 1 (Dynamic)
```
ais_normalization_ranges returns dynamic_min/max columns
    ↓
Uses YOUR actual data ranges (95th percentile)
    ↓
Agent with 2500 tokens gets score 6.8 (if your agents use less tokens typically)
    ↓
Pricing multiplier: 1.68x (MORE expensive!)
```

**The mode flag changes the ranges, which changes the scores, which changes the pricing!**

---

## Summary - Complete Flow

1. Agent runs → collect raw metrics (2500 tokens, 3 iterations, etc.)
2. Fetch ranges from `ais_normalization_ranges` (based on mode flag)
3. Normalize metrics to 0-10 scores using ranges
4. Calculate weighted average → `intensity_score = 5.45`
5. Save to `agent_intensity_metrics` table
6. Show user in UI (informational)
7. Use `intensity_score` for pricing → 1.545x multiplier
8. Charge credits = `base_cost × multiplier`

---

## Mode Flag Reference

| Mode | `active_mode` Value | Columns Used | Description |
|------|---------------------|--------------|-------------|
| **Best Practice** | `0` | `best_practice_min`, `best_practice_max` | Industry standards, same for all users |
| **Dynamic** | `1` | `dynamic_min`, `dynamic_max` | Learned from YOUR production data (95th percentile) |

---

## Key Tables

- **`ais_normalization_ranges`**: Stores min/max ranges for all 15 metrics, contains both best_practice and dynamic columns, plus `active_mode` flag
- **`agent_intensity_metrics`**: Stores calculated scores and cumulative metrics for each agent
- **`pricing_config`**: Contains legacy plugin-tier pricing (OLD system, being phased out)

---

## Database Functions

- **`get_active_ais_ranges()`**: Reads `active_mode` flag and returns appropriate min/max columns
- **`update_dynamic_ais_ranges()`**: Calculates 95th percentile from real data and updates `dynamic_min/max` columns
