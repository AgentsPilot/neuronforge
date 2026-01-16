# AIS 3-Score System - Comprehensive Implementation Plan

**Date:** 2025-01-29
**Version:** 1.0
**Status:** Ready for Implementation

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [The 3-Score System](#the-3-score-system)
4. [Intelligent Model Routing](#intelligent-model-routing)
5. [Database Changes](#database-changes)
6. [Code Changes](#code-changes)
7. [Implementation Phases](#implementation-phases)
8. [Testing Strategy](#testing-strategy)
9. [Risk Mitigation](#risk-mitigation)
10. [Rollback Plan](#rollback-plan)

---

## Executive Summary

### Current State
- **Single Score:** `intensity_score` (0-10) combines creation and execution data
- **All agents use gpt-4o:** No model routing, fixed model for all executions
- **Immediate pricing:** Default 5.0 score for new agents (1.5x multiplier)

### Future State
- **Three Scores:**
  1. **Creation Score** (0-10) - Design-based complexity (available immediately)
  2. **Execution Score** (0-10) - Runtime-based complexity (after executions)
  3. **Combined Score** (0-10) - Intelligent blend (30% creation + 70% execution)

- **Intelligent Model Routing:**
  - **Low complexity agents** (score < 4.0) → **gpt-4o-mini** ($0.15/$0.60 per 1M tokens)
  - **Medium complexity agents** (score 4.0-7.0) → **gpt-4o** ($2.50/$10.00 per 1M tokens)
  - **High complexity agents** (score > 7.0) → **gpt-4o** (premium quality)

- **Adaptive Score Selection:**
  - 0 executions → Use **creation_score** for routing
  - 1-10 executions → Use **combined_score** for routing
  - 11+ executions → Use **execution_score** for routing

### Business Impact
- **Cost Savings:** 35-45% reduction in LLM costs
- **Fair Pricing:** Simple agents get lower scores immediately
- **Better UX:** Faster responses for simple agents (gpt-4o-mini is faster)
- **Quality:** Complex agents still use premium models

---

## System Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. AGENT CREATION                                           │
│    User creates agent → Calculate creation_score            │
│    Available immediately: creation_score = 6.2              │
│    Routing decision: creation_score (6.2) → Use gpt-4o      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. FIRST EXECUTION (Run #1)                                │
│    Run agent with gpt-4o (from creation_score routing)     │
│    Calculate execution_score = 4.8                          │
│    Calculate combined_score = (6.2×0.3) + (4.8×0.7) = 5.22 │
│    Routing decision: combined_score (5.22) → Use gpt-4o     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. LEARNING PHASE (Runs #2-10)                             │
│    Each run updates execution_score                         │
│    Combined_score adjusts: execution weight increases       │
│    Routing decision: Still using combined_score             │
│    Example after 5 runs: combined = 5.1 → Use gpt-4o       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. MATURE AGENT (Runs #11+)                                │
│    Agent has reliable execution data                        │
│    Execution_score stabilized at 4.5                        │
│    Routing decision: execution_score (4.5) → Use gpt-4o     │
│    If score drops to 3.5 → Switch to gpt-4o-mini!          │
└─────────────────────────────────────────────────────────────┘
```

---

## The 3-Score System

### Score Definitions

#### 1. Creation Score (0-10)
**When Available:** Immediately after agent is created
**Based On:** Agent design complexity (one-time calculation)
**Components:**
- **Creation Complexity (50% weight):** Token volume during generation
  - Normalizes `creation_tokens_used` (0-10000 range)
  - More tokens = more complex agent design

- **Creation Efficiency (50% weight):** Tokens per creation phase
  - Normalizes tokens/phase (0-5000 range)
  - Lower tokens per phase = higher efficiency = lower score

**Formula:**
```typescript
creation_score = (creation_complexity × 0.5) + (creation_efficiency × 0.5)
```

**Example:**
```
Agent created with 7500 tokens across 4 phases
- Creation complexity: normalize(7500, 0, 10000) = 7.5
- Creation efficiency: normalize(1875, 0, 5000) = 3.75 (inverted: 6.25)
- Creation score: (7.5 × 0.5) + (6.25 × 0.5) = 6.875
```

#### 2. Execution Score (0-10)
**When Available:** After agent has been executed
**Based On:** Actual runtime metrics (average across all runs)
**Components (4 components from current AIS):**
- **Token Complexity (35% weight):** Avg tokens, peak tokens, I/O ratio
- **Execution Complexity (25% weight):** Iterations, duration, failure rate, retries
- **Plugin Complexity (25% weight):** Plugin count, plugins per run, orchestration time
- **Workflow Complexity (15% weight):** Steps, branches, loops, parallel executions

**Formula:**
```typescript
execution_score =
  (token_complexity × 0.35) +
  (execution_complexity × 0.25) +
  (plugin_complexity × 0.25) +
  (workflow_complexity × 0.15)
```

**Example:**
```
Agent executed 5 times, averages:
- Token complexity: 5.2
- Execution complexity: 6.1
- Plugin complexity: 4.8
- Workflow complexity: 5.5
- Execution score: (5.2×0.35) + (6.1×0.25) + (4.8×0.25) + (5.5×0.15) = 5.45
```

#### 3. Combined Score (0-10)
**When Available:** After first execution
**Based On:** Weighted blend of creation + execution scores
**Weights:** 30% creation + 70% execution (execution matters more over time)

**Formula:**
```typescript
combined_score = (creation_score × 0.3) + (execution_score × 0.7)
```

**Example:**
```
creation_score = 6.875
execution_score = 5.45
combined_score = (6.875 × 0.3) + (5.45 × 0.7) = 5.8775
```

---

## Intelligent Model Routing

### Routing Decision Logic

#### Phase 1: New Agent (0 Executions)
**Use:** `creation_score`
**Why:** No execution data yet, must use design-based estimate

```typescript
function selectModelForNewAgent(creation_score: number): string {
  if (creation_score < 4.0) return 'gpt-4o-mini';
  if (creation_score < 7.0) return 'gpt-4o';
  return 'gpt-4o';
}
```

**Example:**
```
Simple email agent: creation_score = 3.2 → gpt-4o-mini ✓
Standard workflow: creation_score = 5.5 → gpt-4o ✓
Complex multi-plugin: creation_score = 8.1 → gpt-4o ✓
```

#### Phase 2: Learning Agent (1-10 Executions)
**Use:** `combined_score`
**Why:** Blends design intent with early execution data

```typescript
function selectModelForLearningAgent(
  creation_score: number,
  execution_score: number,
  total_executions: number
): string {
  // Calculate combined score
  const combined_score = (creation_score × 0.3) + (execution_score × 0.7);

  if (combined_score < 4.0) return 'gpt-4o-mini';
  if (combined_score < 7.0) return 'gpt-4o';
  return 'gpt-4o';
}
```

**Example:**
```
Agent designed as complex (creation=7.0) but executes simply (execution=3.5)
- After 1 run: combined = (7.0×0.3) + (3.5×0.7) = 4.55 → gpt-4o
- After 5 runs: execution stabilizes at 3.2
  combined = (7.0×0.3) + (3.2×0.7) = 4.34 → gpt-4o
- After 10 runs: Still combined, but execution dominates
```

#### Phase 3: Mature Agent (11+ Executions)
**Use:** `execution_score`
**Why:** Trust actual runtime data, creation no longer relevant

```typescript
function selectModelForMatureAgent(
  execution_score: number,
  success_rate: number
): string {
  // If unreliable, fall back to combined_score
  if (success_rate < 80) {
    return selectModelForLearningAgent(/* ... */);
  }

  if (execution_score < 4.0) return 'gpt-4o-mini';
  if (execution_score < 7.0) return 'gpt-4o';
  return 'gpt-4o';
}
```

**Example:**
```
Agent has 20 executions, 95% success rate
- Execution score stabilized at 3.8
- Use execution_score (3.8) → gpt-4o-mini ✓ (cost savings!)
```

### Complete Routing Function

```typescript
function getActiveScoreAndModel(
  agent_id: string
): {
  active_score: number;
  score_type: 'creation' | 'execution' | 'combined';
  selected_model: string;
  reasoning: string;
} {
  // Fetch metrics from database
  const metrics = await getAgentIntensityMetrics(agent_id);

  const {
    creation_score,
    execution_score,
    combined_score,
    total_executions,
    success_rate
  } = metrics;

  // PHASE 1: New agent (no executions)
  if (total_executions === 0) {
    const model = creation_score < 4.0 ? 'gpt-4o-mini' : 'gpt-4o';
    return {
      active_score: creation_score,
      score_type: 'creation',
      selected_model: model,
      reasoning: `New agent. Using design-based creation score (${creation_score.toFixed(1)}).`
    };
  }

  // PHASE 2: Learning agent (1-10 executions)
  if (total_executions <= 10) {
    const model = combined_score < 4.0 ? 'gpt-4o-mini' : 'gpt-4o';
    return {
      active_score: combined_score,
      score_type: 'combined',
      selected_model: model,
      reasoning: `Learning phase (${total_executions} runs). Using combined score (${combined_score.toFixed(1)}).`
    };
  }

  // PHASE 3: Mature agent (11+ executions)
  // If reliable, use execution score
  if (success_rate >= 80) {
    const model = execution_score < 4.0 ? 'gpt-4o-mini' : 'gpt-4o';
    return {
      active_score: execution_score,
      score_type: 'execution',
      selected_model: model,
      reasoning: `Mature agent (${total_executions} runs, ${success_rate.toFixed(1)}% success). Using execution score (${execution_score.toFixed(1)}).`
    };
  }

  // PHASE 3b: Mature but unreliable (fall back to combined)
  const model = combined_score < 4.0 ? 'gpt-4o-mini' : 'gpt-4o';
  return {
    active_score: combined_score,
    score_type: 'combined',
    selected_model: model,
    reasoning: `Mature but variable performance (${total_executions} runs, ${success_rate.toFixed(1)}% success). Using combined score (${combined_score.toFixed(1)}).`
  };
}
```

### Model Routing Thresholds

| Score Range | Selected Model | Cost (Input/Output per 1M) | Use Case |
|-------------|----------------|----------------------------|----------|
| **0.0 - 3.9** | gpt-4o-mini | $0.15 / $0.60 | Simple agents: email, data retrieval |
| **4.0 - 6.9** | gpt-4o | $2.50 / $10.00 | Standard agents: workflows, multi-step |
| **7.0 - 10.0** | gpt-4o | $2.50 / $10.00 | Complex agents: many plugins, long workflows |

**Note:** High complexity agents (7.0+) also use gpt-4o for quality. Future: Add premium model (gpt-4-turbo or o1) for ultra-complex.

### Cost Savings Example

**Scenario:** 100 agents, 1000 executions/month

**Current (all gpt-4o):**
```
1000 executions × 2500 avg tokens × $2.50/1M = $6.25/month (input)
1000 executions × 500 avg tokens × $10.00/1M = $5.00/month (output)
Total: $11.25/month
```

**With Routing (30% to mini, 70% to gpt-4o):**
```
Mini (300 executions):
  300 × 2500 × $0.15/1M = $0.1125 (input)
  300 × 500 × $0.60/1M = $0.09 (output)
  Subtotal: $0.2025

GPT-4o (700 executions):
  700 × 2500 × $2.50/1M = $4.375 (input)
  700 × 500 × $10.00/1M = $3.50 (output)
  Subtotal: $7.875

Total: $8.0775/month
Savings: $3.17/month (28% reduction)
```

**Annual Savings:** $38/month at scale = **$456/year**

---

## Database Changes

### Migration: `supabase/migrations/20250129_add_three_score_system.sql`

```sql
-- =====================================================
-- PART 1: Add New Columns to agent_intensity_metrics
-- =====================================================

ALTER TABLE agent_intensity_metrics
  -- Three score system
  ADD COLUMN IF NOT EXISTS creation_score DECIMAL(4,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS execution_score DECIMAL(4,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS combined_score DECIMAL(4,2) DEFAULT 5.0,

  -- Creation component scores
  ADD COLUMN IF NOT EXISTS creation_complexity_score DECIMAL(4,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS creation_token_efficiency_score DECIMAL(4,2) DEFAULT 5.0,

  -- Model routing fields
  ADD COLUMN IF NOT EXISTS active_score_type VARCHAR(20) DEFAULT 'creation',
  ADD COLUMN IF NOT EXISTS recommended_model VARCHAR(50) DEFAULT 'gpt-4o',
  ADD COLUMN IF NOT EXISTS routing_reasoning TEXT;

-- =====================================================
-- PART 2: Add Indexes for Performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_agent_intensity_creation_score
  ON agent_intensity_metrics(creation_score);
CREATE INDEX IF NOT EXISTS idx_agent_intensity_execution_score
  ON agent_intensity_metrics(execution_score);
CREATE INDEX IF NOT EXISTS idx_agent_intensity_combined_score
  ON agent_intensity_metrics(combined_score);
CREATE INDEX IF NOT EXISTS idx_agent_intensity_active_score_type
  ON agent_intensity_metrics(active_score_type);

-- =====================================================
-- PART 3: Backfill Existing Data
-- =====================================================

-- Set combined_score = intensity_score for all existing agents
UPDATE agent_intensity_metrics
SET combined_score = intensity_score
WHERE combined_score = 5.0 AND intensity_score != 5.0;

-- For agents with creation tokens, estimate creation_score
UPDATE agent_intensity_metrics
SET creation_score = LEAST(10.0, GREATEST(0.0,
    (creation_tokens_used / 1000.0) -- Simple normalization
))
WHERE creation_tokens_used > 0 AND creation_score = 5.0;

-- For agents with executions, set execution_score = intensity_score
UPDATE agent_intensity_metrics
SET execution_score = intensity_score,
    active_score_type = CASE
      WHEN total_executions = 0 THEN 'creation'
      WHEN total_executions <= 10 THEN 'combined'
      ELSE 'execution'
    END
WHERE total_executions > 0 AND execution_score = 5.0;

-- Recalculate combined_score for updated agents
UPDATE agent_intensity_metrics
SET combined_score = (creation_score * 0.3) + (execution_score * 0.7)
WHERE (creation_score != 5.0 OR execution_score != 5.0)
  AND combined_score != ((creation_score * 0.3) + (execution_score * 0.7));

-- Update intensity_score to match combined_score (backward compat)
UPDATE agent_intensity_metrics
SET intensity_score = combined_score
WHERE intensity_score != combined_score;

-- =====================================================
-- PART 4: Add Creation Normalization Ranges
-- =====================================================

INSERT INTO ais_normalization_ranges (
  range_key, category, description,
  best_practice_min, best_practice_max,
  dynamic_min, dynamic_max,
  active_mode, min_executions_threshold
) VALUES
  ('creation_volume', 'creation', 'Total tokens used during agent creation',
   0, 10000, NULL, NULL, 0, 10),
  ('creation_efficiency', 'creation', 'Efficiency of creation process (tokens per phase)',
   0, 5000, NULL, NULL, 0, 10)
ON CONFLICT (range_key) DO NOTHING;

-- =====================================================
-- PART 5: Add Comment for Deprecation
-- =====================================================

COMMENT ON COLUMN agent_intensity_metrics.intensity_score IS
  'DEPRECATED: Use combined_score instead. Kept for backward compatibility. Will be removed in v2.0';
```

---

## Code Changes

### File 1: `/lib/types/intensity.ts`

**Add new interfaces:**

```typescript
// Creation component scores (2 components)
export interface CreationComponentScores {
  creation_complexity: {
    score: number;
    weight: number;
    weighted_score: number;
  };
  creation_efficiency: {
    score: number;
    weight: number;
    weighted_score: number;
  };
}

// Model routing result
export interface ModelRoutingDecision {
  active_score: number;
  score_type: 'creation' | 'execution' | 'combined';
  selected_model: string;
  reasoning: string;
}
```

**Update `AgentIntensityMetrics`:**

```typescript
export interface AgentIntensityMetrics {
  // ... existing fields ...

  // THREE SCORE SYSTEM
  creation_score: number;        // NEW: 0-10 score for creation
  execution_score: number;       // NEW: 0-10 score for execution
  combined_score: number;        // NEW: Weighted combination

  /**
   * @deprecated Use combined_score instead. Kept for backward compatibility.
   */
  intensity_score: number;       // DEPRECATED

  // CREATION COMPONENTS
  creation_complexity_score: number;          // NEW
  creation_token_efficiency_score: number;    // NEW

  // MODEL ROUTING
  active_score_type: 'creation' | 'execution' | 'combined';  // NEW
  recommended_model: string;                                  // NEW
  routing_reasoning: string;                                  // NEW

  // ... rest unchanged ...
}
```

**Update `IntensityBreakdown`:**

```typescript
export interface IntensityBreakdown {
  // THREE SCORES
  creation_score: number;              // NEW
  execution_score: number;             // NEW
  combined_score: number;              // NEW

  creation_multiplier: number;         // NEW
  execution_multiplier: number;        // NEW
  combined_multiplier: number;         // NEW

  /**
   * @deprecated Use combined_score instead
   */
  overall_score: number;               // DEPRECATED
  /**
   * @deprecated Use combined_multiplier instead
   */
  pricing_multiplier: number;          // DEPRECATED

  // COMPONENT BREAKDOWNS
  creation_components: CreationComponentScores;   // NEW
  execution_components: IntensityComponentScores; // RENAMED

  // MODEL ROUTING
  routing_decision: ModelRoutingDecision;         // NEW

  // ... rest unchanged ...
}
```

**Add weight constants:**

```typescript
export const CREATION_WEIGHTS = {
  CREATION_COMPLEXITY: 0.5,
  CREATION_EFFICIENCY: 0.5,
} as const;

export const EXECUTION_WEIGHTS = {
  TOKEN_COMPLEXITY: 0.35,
  EXECUTION_COMPLEXITY: 0.25,
  PLUGIN_COMPLEXITY: 0.25,
  WORKFLOW_COMPLEXITY: 0.15,
} as const;

export const COMBINED_WEIGHTS = {
  CREATION: 0.3,
  EXECUTION: 0.7,
} as const;

// Model routing thresholds
export const MODEL_ROUTING_THRESHOLDS = {
  MINI_MAX: 4.0,    // Scores below 4.0 use gpt-4o-mini
  STANDARD_MAX: 7.0, // Scores below 7.0 use gpt-4o
} as const;
```

### File 2: `/lib/services/ModelRouterService.ts` (NEW FILE)

```typescript
import { createClient } from '@/lib/supabase/client';
import type { AgentIntensityMetrics, ModelRoutingDecision } from '@/lib/types/intensity';
import { MODEL_ROUTING_THRESHOLDS } from '@/lib/types/intensity';

export class ModelRouterService {
  /**
   * Select optimal model for agent execution based on intensity scores
   */
  static async selectModelForAgent(agent_id: string): Promise<ModelRoutingDecision> {
    const supabase = createClient();

    // Fetch intensity metrics
    const { data: metrics, error } = await supabase
      .from('agent_intensity_metrics')
      .select('*')
      .eq('agent_id', agent_id)
      .single();

    if (error || !metrics) {
      // Default to gpt-4o if no metrics
      return {
        active_score: 5.0,
        score_type: 'creation',
        selected_model: 'gpt-4o',
        reasoning: 'No metrics found. Using default model.'
      };
    }

    return this.selectModelFromMetrics(metrics);
  }

  /**
   * Select model based on intensity metrics
   */
  static selectModelFromMetrics(metrics: AgentIntensityMetrics): ModelRoutingDecision {
    const {
      creation_score,
      execution_score,
      combined_score,
      total_executions,
      success_rate
    } = metrics;

    // PHASE 1: New agent (0 executions)
    if (total_executions === 0) {
      const model = this.selectModelByScore(creation_score);
      return {
        active_score: creation_score,
        score_type: 'creation',
        selected_model: model,
        reasoning: `New agent. Using design-based creation score (${creation_score.toFixed(1)}).`
      };
    }

    // PHASE 2: Learning agent (1-10 executions)
    if (total_executions <= 10) {
      const model = this.selectModelByScore(combined_score);
      return {
        active_score: combined_score,
        score_type: 'combined',
        selected_model: model,
        reasoning: `Learning phase (${total_executions} runs). Using combined score (${combined_score.toFixed(1)}).`
      };
    }

    // PHASE 3: Mature agent (11+ executions)
    // If reliable, use execution score
    if (success_rate >= 80) {
      const model = this.selectModelByScore(execution_score);
      return {
        active_score: execution_score,
        score_type: 'execution',
        selected_model: model,
        reasoning: `Mature agent (${total_executions} runs, ${success_rate.toFixed(1)}% success). Using execution score (${execution_score.toFixed(1)}).`
      };
    }

    // PHASE 3b: Mature but unreliable (fall back to combined)
    const model = this.selectModelByScore(combined_score);
    return {
      active_score: combined_score,
      score_type: 'combined',
      selected_model: model,
      reasoning: `Mature but variable performance (${total_executions} runs, ${success_rate.toFixed(1)}% success). Using combined score (${combined_score.toFixed(1)}).`
    };
  }

  /**
   * Select model based on score value
   */
  private static selectModelByScore(score: number): string {
    if (score < MODEL_ROUTING_THRESHOLDS.MINI_MAX) {
      return 'gpt-4o-mini';
    }
    if (score < MODEL_ROUTING_THRESHOLDS.STANDARD_MAX) {
      return 'gpt-4o';
    }
    return 'gpt-4o'; // High complexity also uses gpt-4o
  }

  /**
   * Update routing decision in database (optional, for caching)
   */
  static async updateRoutingDecision(
    agent_id: string,
    decision: ModelRoutingDecision
  ): Promise<void> {
    const supabase = createClient();

    await supabase
      .from('agent_intensity_metrics')
      .update({
        active_score_type: decision.score_type,
        recommended_model: decision.selected_model,
        routing_reasoning: decision.reasoning,
        updated_at: new Date().toISOString()
      })
      .eq('agent_id', agent_id);
  }
}
```

### File 3: `/lib/agentkit/runAgentKit.ts`

**Add model parameter:**

```typescript
// CHANGE: Add optional model override parameter
export async function runAgentKit(
  userId: string,
  agent: AgentFromDatabase,
  input: Record<string, any>,
  connectedPlugins: ConnectedPluginDetail[],
  sessionId: string,
  modelOverride?: string  // NEW: Allow model selection from router
): Promise<AgentKitResult> {
  try {
    // ... existing setup code ...

    // NEW: Use model override if provided, otherwise use default
    const selectedModel = modelOverride || AGENTKIT_CONFIG.model;

    console.log(`🤖 [AGENTKIT] Using model: ${selectedModel}`);

    // ... existing iteration loop ...

    const completion = await openaiProvider.chatCompletion(
      {
        model: selectedModel,  // CHANGED: Use selected model
        messages: messages,
        tools: tools,
        tool_choice: "auto",
        temperature: AGENTKIT_CONFIG.temperature,
      },
      // ... rest unchanged
    );

    // ... rest of function unchanged ...
  }
}
```

### File 4: `/app/api/run-agent/route.ts`

**Add model routing before execution:**

```typescript
import { ModelRouterService } from '@/lib/services/ModelRouterService';

export async function POST(request: Request) {
  try {
    // ... existing code to get agent, user, input ...

    // NEW: Select optimal model based on intensity scores
    console.log('🔀 [ROUTING] Selecting optimal model for agent...');
    const routingDecision = await ModelRouterService.selectModelForAgent(agent.id);

    console.log('🔀 [ROUTING] Decision:', {
      score: routingDecision.active_score,
      type: routingDecision.score_type,
      model: routingDecision.selected_model,
      reasoning: routingDecision.reasoning
    });

    // NEW: Pass selected model to AgentKit
    const result = await runAgentKit(
      user.id,
      agent,
      input,
      connectedPluginsDetails,
      sessionId,
      routingDecision.selected_model  // NEW: Pass model override
    );

    // ... existing code to handle result ...

    // NEW: Update routing decision in database
    await ModelRouterService.updateRoutingDecision(agent.id, routingDecision);

    // ... rest unchanged ...
  }
}
```

### File 5: `/lib/services/AgentIntensityService.ts`

**Add creation score calculation to `trackCreationCosts()`:**

```typescript
static async trackCreationCosts(
  supabaseClient: SupabaseClient,
  creationData: AgentCreationData
): Promise<AgentIntensityMetrics | null> {
  try {
    // ... existing code to calculate creation_cost_usd ...

    // NEW: Fetch ranges from database
    const ranges = await this.getAISRanges(supabaseClient);

    // NEW: Calculate creation component scores
    const creationComplexity = this.normalizeToScale(
      creationData.tokens_used,
      ranges.creation_volume?.min || 0,
      ranges.creation_volume?.max || 10000,
      0,
      10
    );

    const avgTokensPerPhase = creationData.tokens_used / 4; // Assume 4 phases
    const creationEfficiency = this.normalizeToScale(
      avgTokensPerPhase,
      ranges.creation_efficiency?.min || 0,
      ranges.creation_efficiency?.max || 5000,
      10, // Inverted: lower tokens = higher efficiency = higher score
      0
    );

    // NEW: Calculate overall creation_score
    const creation_score = this.clamp(
      (creationComplexity * 0.5) + (creationEfficiency * 0.5),
      0,
      10
    );

    console.log('✅ [AIS] Creation score calculated:', {
      tokens: creationData.tokens_used,
      complexity: creationComplexity.toFixed(2),
      efficiency: creationEfficiency.toFixed(2),
      creation_score: creation_score.toFixed(2)
    });

    // Update database with creation costs AND scores
    const { data, error } = await supabaseClient
      .from('agent_intensity_metrics')
      .update({
        creation_tokens_used: creationData.tokens_used,
        total_creation_cost_usd: creation_cost_usd,
        creation_score,                                    // NEW
        creation_complexity_score: creationComplexity,     // NEW
        creation_token_efficiency_score: creationEfficiency, // NEW
        active_score_type: 'creation',                     // NEW
        updated_at: new Date().toISOString(),
      })
      .eq('agent_id', creationData.agent_id)
      .select()
      .single();

    // ... rest unchanged ...
  }
}

// NEW: Add helper method to fetch ranges
private static async getAISRanges(
  supabaseClient: SupabaseClient
): Promise<Record<string, { min: number; max: number }>> {
  try {
    const { data, error } = await supabaseClient.rpc('get_active_ais_ranges');

    if (error || !data) {
      console.warn('[AIS] Failed to fetch ranges, using fallback');
      return this.getDefaultRanges();
    }

    const ranges: Record<string, { min: number; max: number }> = {};
    data.forEach((row: any) => {
      ranges[row.range_key] = {
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value)
      };
    });

    return ranges;
  } catch (error) {
    console.error('[AIS] Error fetching ranges:', error);
    return this.getDefaultRanges();
  }
}
```

---

## Implementation Phases

### Phase 1: Database & Foundation (Day 1)
**Goal:** Set up infrastructure without changing behavior

**Tasks:**
1. ✅ Run database migration SQL
2. ✅ Verify migration successful (check Supabase)
3. ✅ Update `/lib/types/intensity.ts` with new interfaces
4. ✅ Verify TypeScript compilation passes
5. ✅ Deploy to staging (no behavior changes yet)

**Success Criteria:**
- New columns exist in database
- Old code still works (backward compatible)
- No errors in staging

---

### Phase 2: Backend - Score Calculation (Day 2)
**Goal:** Calculate all 3 scores, populate database

**Tasks:**
1. ✅ Update `/lib/services/AgentIntensityService.ts`
   - Add creation score calculation to `trackCreationCosts()`
   - Add `getAISRanges()` method
2. ✅ Update `/lib/utils/updateAgentIntensity.ts`
   - Calculate execution_score (rename from intensity_score)
   - Calculate combined_score
   - Keep intensity_score synced
3. ✅ Test creation flow: Create agent, verify creation_score calculated
4. ✅ Test execution flow: Run agent, verify all 3 scores calculated
5. ✅ Deploy to staging

**Success Criteria:**
- New agents have creation_score > 0
- Executed agents have execution_score and combined_score
- intensity_score = combined_score (backward compat)

---

### Phase 3: Model Routing Logic (Day 3)
**Goal:** Implement intelligent routing without enabling it

**Tasks:**
1. ✅ Create `/lib/services/ModelRouterService.ts`
   - Implement `selectModelForAgent()`
   - Implement `selectModelFromMetrics()`
   - Implement score-to-model logic
2. ✅ Update `/lib/agentkit/runAgentKit.ts`
   - Add `modelOverride` parameter
   - Use override if provided
3. ✅ Add feature flag: `ENABLE_MODEL_ROUTING=false` (off by default)
4. ✅ Test routing logic in shadow mode (log decisions but don't apply)
5. ✅ Deploy to staging

**Success Criteria:**
- Routing decisions logged but not applied
- Can see what model WOULD be selected
- No impact on actual executions (still use gpt-4o)

---

### Phase 4: API & UI Updates (Day 4)
**Goal:** Update frontend to display 3 scores

**Tasks:**
1. ✅ Update `/app/api/agents/[id]/intensity/route.ts`
   - Return all 3 scores in API response
   - Include routing decision
2. ✅ Update `/components/agents/AgentIntensityCard.tsx`
   - Show 3-score grid
   - Display creation/execution/combined separately
   - Show which score is active
   - Show recommended model
3. ✅ Test UI displays correctly
4. ✅ Deploy to staging

**Success Criteria:**
- UI shows all 3 scores
- Users can see creation score immediately
- Users can see which score is used for routing

---

### Phase 5: Enable Routing (Day 5 - CRITICAL)
**Goal:** Enable model routing in production

**Tasks:**
1. ✅ Run backfill script: Calculate scores for all existing agents
2. ✅ Verify backfill successful (check database)
3. ✅ Enable feature flag: `ENABLE_MODEL_ROUTING=true`
4. ✅ Update `/app/api/run-agent/route.ts`
   - Call `ModelRouterService.selectModelForAgent()`
   - Pass selected model to `runAgentKit()`
5. ✅ Deploy to production with extensive monitoring
6. ✅ Monitor for 24 hours:
   - Check routing decisions
   - Verify cost savings
   - Watch for errors
   - Monitor quality (success rates)

**Success Criteria:**
- Agents routed to correct models based on scores
- Cost savings visible in analytics
- No increase in error rates
- Quality maintained

---

### Phase 6: Monitoring & Optimization (Week 2)
**Goal:** Fine-tune thresholds and monitor performance

**Tasks:**
1. ✅ Analyze routing distribution
   - How many agents use mini vs gpt-4o?
   - Are thresholds (4.0, 7.0) optimal?
2. ✅ Measure cost savings
   - Compare actual costs before/after
   - Calculate ROI
3. ✅ Monitor quality metrics
   - Success rates by model
   - User satisfaction
4. ✅ Adjust thresholds if needed
5. ✅ Create monitoring dashboard

**Success Criteria:**
- 25-35% of agents use gpt-4o-mini
- Cost savings of 30-40%
- No degradation in quality
- Dashboard shows real-time routing stats

---

## Testing Strategy

### Unit Tests

```typescript
// Test creation score calculation
describe('AgentIntensityService.trackCreationCosts', () => {
  it('should calculate creation_score from token volume', async () => {
    const result = await AgentIntensityService.trackCreationCosts(/* ... */);
    expect(result.creation_score).toBeGreaterThan(0);
    expect(result.creation_score).toBeLessThanOrEqual(10);
  });
});

// Test model routing logic
describe('ModelRouterService.selectModelFromMetrics', () => {
  it('should route new agent based on creation score', () => {
    const metrics = {
      creation_score: 3.5,
      execution_score: 5.0,
      combined_score: 5.0,
      total_executions: 0,
      success_rate: 0
    };
    const decision = ModelRouterService.selectModelFromMetrics(metrics);
    expect(decision.score_type).toBe('creation');
    expect(decision.selected_model).toBe('gpt-4o-mini');
  });

  it('should route mature agent based on execution score', () => {
    const metrics = {
      creation_score: 7.0,
      execution_score: 3.8,
      combined_score: 4.66,
      total_executions: 15,
      success_rate: 95
    };
    const decision = ModelRouterService.selectModelFromMetrics(metrics);
    expect(decision.score_type).toBe('execution');
    expect(decision.selected_model).toBe('gpt-4o-mini');
  });
});
```

### Integration Tests

```typescript
describe('Three-Score System with Routing', () => {
  it('should route agent lifecycle correctly', async () => {
    // 1. Create agent
    const agent = await createAgent(/* ... */);
    const metrics1 = await getMetrics(agent.id);
    expect(metrics1.creation_score).toBeGreaterThan(0);
    expect(metrics1.active_score_type).toBe('creation');

    // 2. Get routing decision
    const decision1 = await ModelRouterService.selectModelForAgent(agent.id);
    expect(decision1.score_type).toBe('creation');

    // 3. Run agent first time
    await runAgent(agent.id, decision1.selected_model);
    const metrics2 = await getMetrics(agent.id);
    expect(metrics2.execution_score).not.toBe(5.0);
    expect(metrics2.combined_score).not.toBe(5.0);
    expect(metrics2.active_score_type).toBe('combined');

    // 4. Run agent 10 more times
    for (let i = 0; i < 10; i++) {
      const decision = await ModelRouterService.selectModelForAgent(agent.id);
      await runAgent(agent.id, decision.selected_model);
    }

    // 5. Check mature agent routing
    const metrics3 = await getMetrics(agent.id);
    expect(metrics3.total_executions).toBe(11);
    expect(metrics3.active_score_type).toBe('execution');

    const decision3 = await ModelRouterService.selectModelForAgent(agent.id);
    expect(decision3.score_type).toBe('execution');
  });
});
```

---

## Risk Mitigation

### High-Risk Items

#### 1. Model Routing Errors (HIGH)
**Risk:** Wrong model selected, quality degradation
**Impact:** User complaints, poor agent performance
**Mitigation:**
- Shadow mode first (log decisions without applying)
- Gradual rollout (10% → 50% → 100%)
- Monitor success rates by model
- Quick rollback via feature flag

#### 2. Pricing Calculation Errors (HIGH)
**Risk:** Wrong multiplier, incorrect charges
**Impact:** Revenue loss or user complaints
**Mitigation:**
- Keep intensity_score synced with combined_score
- Extensive pricing tests
- Compare old vs new calculations
- Monitor transaction logs

#### 3. Database Migration Failures (MEDIUM)
**Risk:** Migration fails, database inconsistent
**Impact:** System down, data corruption
**Mitigation:**
- Test on staging first
- Full database backup
- Run during low-traffic period
- Rollback script ready

#### 4. Score Calculation Bugs (MEDIUM)
**Risk:** Incorrect scores lead to wrong routing
**Impact:** Cost savings lost, quality issues
**Mitigation:**
- Unit tests for all calculations
- Validate scores in range 0-10
- Log all score calculations
- Manual spot-checks

---

## Rollback Plan

### Immediate Rollback (Within Hours)

**If routing causes issues:**
```typescript
// Set feature flag to false
ENABLE_MODEL_ROUTING = false

// All agents revert to gpt-4o
// No code deployment needed
```

### Code Rollback (Within 1 Day)

**If scores are wrong:**
```sql
-- Revert to using intensity_score only
UPDATE agent_intensity_metrics
SET combined_score = intensity_score,
    execution_score = intensity_score,
    creation_score = 5.0,
    active_score_type = 'execution';
```

**Git revert:**
```bash
git revert <commit-hash>
git push origin main
# Redeploy previous version
```

### Database Rollback (Last Resort)

```sql
-- Remove new columns (destructive, only if necessary)
ALTER TABLE agent_intensity_metrics
  DROP COLUMN IF EXISTS creation_score,
  DROP COLUMN IF EXISTS execution_score,
  DROP COLUMN IF EXISTS combined_score,
  DROP COLUMN IF EXISTS creation_complexity_score,
  DROP COLUMN IF EXISTS creation_token_efficiency_score,
  DROP COLUMN IF EXISTS active_score_type,
  DROP COLUMN IF EXISTS recommended_model,
  DROP COLUMN IF EXISTS routing_reasoning;

-- Remove creation ranges
DELETE FROM ais_normalization_ranges
WHERE range_key IN ('creation_volume', 'creation_efficiency');
```

---

## Success Metrics

### Phase 1-2: Score Calculation
- ✅ 100% of new agents have creation_score > 0
- ✅ 100% of executed agents have execution_score and combined_score
- ✅ intensity_score = combined_score (backward compat)
- ✅ No errors in production logs

### Phase 3-4: Routing Logic & UI
- ✅ Routing decisions logged for 100% of executions
- ✅ UI displays all 3 scores correctly
- ✅ Users see which score is active
- ✅ Shadow mode runs for 3 days without errors

### Phase 5: Production Routing
- ✅ 25-35% of agents routed to gpt-4o-mini
- ✅ 65-75% of agents routed to gpt-4o
- ✅ Cost savings of 30-40%
- ✅ Success rate maintained (no decrease >2%)
- ✅ Average response time improved (mini is faster)

### Week 2: Optimization
- ✅ Thresholds optimized based on data
- ✅ Monitoring dashboard live
- ✅ Documentation updated
- ✅ Team trained on new system

---

## Next Steps

1. **Review this plan** with team
2. **Approve database migration** SQL
3. **Set up feature flag** infrastructure
4. **Schedule implementation** (5 days + 1 week monitoring)
5. **Assign tasks** to developers
6. **Create monitoring dashboard**
7. **Prepare rollback procedures**

---

## Appendix: Key Formulas

### Creation Score
```
creation_score = (creation_complexity × 0.5) + (creation_efficiency × 0.5)

Where:
- creation_complexity = normalize(creation_tokens_used, 0, 10000)
- creation_efficiency = normalize_inverted(tokens_per_phase, 0, 5000)
```

### Execution Score
```
execution_score =
  (token_complexity × 0.35) +
  (execution_complexity × 0.25) +
  (plugin_complexity × 0.25) +
  (workflow_complexity × 0.15)
```

### Combined Score
```
combined_score = (creation_score × 0.3) + (execution_score × 0.7)
```

### Model Selection
```
if score < 4.0: use gpt-4o-mini
if 4.0 <= score < 7.0: use gpt-4o
if score >= 7.0: use gpt-4o
```

### Active Score Selection
```
if total_executions == 0: use creation_score
if total_executions <= 10: use combined_score
if total_executions > 10 AND success_rate >= 80: use execution_score
else: use combined_score
```

---

**End of Document**
