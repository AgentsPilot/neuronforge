# Pilot Per-Step Routing - Complete Implementation Plan

**Date**: November 3, 2025
**Status**: Ready for Implementation
**Estimated Time**: 12 hours
**Risk Level**: Low (feature flags, gradual rollout)

---

## Table of Contents

1. [Decision Matrix](#decision-matrix)
2. [Pre-Implementation Verification](#pre-implementation-verification)
3. [Implementation Phases](#implementation-phases)
4. [Phase 1: Database Schema](#phase-1-database-schema--configuration)
5. [Phase 2: Task Complexity Analyzer](#phase-2-task-complexity-analyzer)
6. [Phase 3: Per-Step Model Router](#phase-3-per-step-model-router)
7. [Phase 4: StepExecutor Integration](#phase-4-integrate-with-stepexecutor)
8. [Phase 5: AgentKit Updates](#phase-5-update-agentkit)
9. [Phase 6: Audit Trail & Memory](#phase-6-audit-trail--memory-integration)
10. [Phase 7: Admin UI](#phase-7-admin-ui--analytics)
11. [Phase 8: Testing](#phase-8-testing--validation)
12. [Rollout Strategy](#rollout-strategy)
13. [Success Metrics](#success-metrics)

---

## Decision Matrix

### Control Flow Logic

```
┌──────────────┬──────────────────┬─────────────────────────────┐
│ Pilot        │ Global Routing   │ Routing Used                │
│ Enabled?     │ Enabled?         │                             │
├──────────────┼──────────────────┼─────────────────────────────┤
│ YES          │ YES              │ Per-Step Routing (ALWAYS)   │
│ YES          │ NO               │ Per-Step Routing (ALWAYS)   │
│ NO           │ YES              │ Global AIS Routing          │
│ NO           │ NO               │ Default Model (gpt-4o)      │
└──────────────┴──────────────────┴─────────────────────────────┘
```

### Key Points

- **When Pilot is enabled**: ALWAYS use Per-Step Routing (ignore global routing setting)
- **When Pilot is disabled**: Check global routing setting → Use global or default
- **Philosophy**: Pilot = granular optimization, Non-Pilot = global optimization

---

## Pre-Implementation Verification

### ✅ Verification Complete

Based on comprehensive system analysis:

- **Recent Changes**: Memory system integration (Nov 2) - NO conflicts
- **Uncommitted Changes**: UI/UX improvements - LOW conflict risk
- **Authentication**: No recent auth changes - SAFE to proceed
- **Routing System**: Already implemented (Oct 30) - Will extend, not replace
- **Memory Integration**: Lines 223-232 in runAgentKit.ts - **MUST PRESERVE**

### Critical Files Analysis

#### Will Modify:
- `/lib/agentkit/runAgentKit.ts` - Add modelOverride parameter
- `/lib/pilot/StepExecutor.ts` - Add per-step routing logic
- `/lib/pilot/WorkflowPilot.ts` - Initialize routing system

#### Will Create:
- `/lib/pilot/TaskComplexityAnalyzer.ts` - NEW
- `/lib/pilot/PerStepModelRouter.ts` - NEW
- `/app/admin/pilot-routing/page.tsx` - NEW
- Database tables and views - NEW

#### Must Preserve:
- Memory integration (lines 223-232 in runAgentKit.ts)
- Global AIS routing (when Pilot disabled)
- Analytics tracking
- Audit trail

---

## Implementation Phases

### Timeline

| Phase | Description | Time | Priority |
|-------|-------------|------|----------|
| 1 | Database Schema & Configuration | 30 min | Critical |
| 2 | Task Complexity Analyzer | 2 hours | Critical |
| 3 | Per-Step Model Router | 2 hours | Critical |
| 4 | StepExecutor Integration | 1.5 hours | Critical |
| 5 | AgentKit Updates | 1 hour | Critical |
| 6 | Audit Trail & Memory | 1 hour | High |
| 7 | Admin UI & Analytics | 2 hours | Medium |
| 8 | Testing & Validation | 2 hours | Critical |

**Total**: 12 hours

---

## PHASE 1: Database Schema & Configuration

### 1.1 Create Tables

#### Table 1: `pilot_task_complexity_config`

```sql
CREATE TABLE IF NOT EXISTS pilot_task_complexity_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_type TEXT NOT NULL UNIQUE,
  needs_llm BOOLEAN NOT NULL DEFAULT true,
  base_complexity DECIMAL(3,1) NOT NULL DEFAULT 5.0,
  complexity_weights JSONB NOT NULL DEFAULT '{
    "prompt_length": 0.15,
    "data_size": 0.15,
    "condition_count": 0.20,
    "context_depth": 0.20,
    "reasoning_depth": 0.20,
    "output_complexity": 0.10
  }'::jsonb,
  tier_thresholds JSONB NOT NULL DEFAULT '{
    "tier1_max": 3.9,
    "tier2_max": 6.9
  }'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pilot_complexity_step_type ON pilot_task_complexity_config(step_type);

COMMENT ON TABLE pilot_task_complexity_config IS 'Configuration for analyzing Pilot step complexity to determine optimal model tier';
```

#### Table 2: `pilot_routing_config`

```sql
CREATE TABLE IF NOT EXISTS pilot_routing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pilot_routing_config_key ON pilot_routing_config(config_key);

COMMENT ON TABLE pilot_routing_config IS 'Configuration for per-step model routing in Pilot workflows';
```

#### Table 3: `pilot_step_routing_history`

```sql
CREATE TABLE IF NOT EXISTS pilot_step_routing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL,
  step_id TEXT NOT NULL,
  step_name TEXT,
  step_type TEXT NOT NULL,
  complexity_score DECIMAL(3,1),
  complexity_factors JSONB,
  recommended_tier TEXT,
  selected_tier TEXT,
  selected_model TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  tokens_used INTEGER,
  cost_usd DECIMAL(10,6),
  routing_reason TEXT,
  routing_strategy TEXT,
  agent_id UUID,
  agent_ais_score DECIMAL(3,1),
  routing_source TEXT DEFAULT 'pilot_per_step',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pilot_routing_execution ON pilot_step_routing_history(execution_id);
CREATE INDEX idx_pilot_routing_agent ON pilot_step_routing_history(agent_id);
CREATE INDEX idx_pilot_routing_model ON pilot_step_routing_history(selected_model);
CREATE INDEX idx_pilot_routing_tier ON pilot_step_routing_history(selected_tier);
CREATE INDEX idx_pilot_routing_created ON pilot_step_routing_history(created_at DESC);
CREATE INDEX idx_pilot_routing_source ON pilot_step_routing_history(routing_source);

COMMENT ON TABLE pilot_step_routing_history IS 'Audit trail for per-step routing decisions in Pilot workflows';
```

### 1.2 Seed Configuration

```sql
-- Seed step type complexity configuration
INSERT INTO pilot_task_complexity_config (step_type, needs_llm, base_complexity) VALUES
('llm_decision', true, 6.0),
('ai_processing', true, 5.5),
('conditional', true, 4.0),
('enrichment', true, 5.0),
('comparison', true, 4.5),
('switch', true, 3.5),
('action', false, 0.0),
('delay', false, 0.0),
('validation', false, 3.0),
('transform', false, 2.0),
('loop', false, 2.5),
('parallel_group', false, 3.0),
('scatter_gather', true, 6.5),
('sub_workflow', false, 4.0),
('human_approval', false, 0.0)
ON CONFLICT (step_type) DO NOTHING;

-- Seed routing configuration
INSERT INTO pilot_routing_config (config_key, config_value, description) VALUES
('routing_strategy', '"balanced"', 'Routing strategy: conservative | balanced | aggressive'),
('strategy_weights', '{
  "conservative": {"ais": 0.6, "step": 0.4},
  "balanced": {"ais": 0.4, "step": 0.6},
  "aggressive": {"ais": 0.2, "step": 0.8}
}'::jsonb, 'Weights for routing strategies'),
('tier_thresholds', '{"tier1_max": 3.9, "tier2_max": 6.9}'::jsonb, 'Complexity thresholds for tier assignment'),
('tier1_models', '[
  {"model":"gpt-4o-mini","provider":"openai","priority":1,"cost_per_1k_tokens":0.00015}
]'::jsonb, 'Tier 1 models (low complexity)'),
('tier2_models', '[
  {"model":"claude-3-haiku-20240307","provider":"anthropic","priority":1,"cost_per_1k_tokens":0.00025}
]'::jsonb, 'Tier 2 models (medium complexity)'),
('tier3_models', '[
  {"model":"gpt-4o","provider":"openai","priority":1,"cost_per_1k_tokens":0.005}
]'::jsonb, 'Tier 3 models (high complexity)')
ON CONFLICT (config_key) DO NOTHING;

-- Add system configuration flag
INSERT INTO system_settings_config (config_key, config_value, value_type, description, category) VALUES
('pilot_per_step_routing_enabled', 'true', 'boolean', 'Enable per-step model routing when Pilot is active', 'pilot')
ON CONFLICT (config_key) DO NOTHING;
```

### 1.3 Create Analytics Views

```sql
-- View 1: Routing Source Comparison
CREATE OR REPLACE VIEW routing_source_comparison AS
WITH pilot_stats AS (
  SELECT
    DATE(created_at) as date,
    'Pilot Per-Step' as routing_type,
    COUNT(*) as execution_count,
    SUM(tokens_used) as total_tokens,
    AVG(tokens_used) as avg_tokens,
    SUM(cost_usd) as total_cost_usd
  FROM pilot_step_routing_history
  WHERE routing_source = 'pilot_per_step'
  GROUP BY DATE(created_at)
)
SELECT * FROM pilot_stats
ORDER BY date DESC;

-- View 2: Tier Distribution
CREATE OR REPLACE VIEW pilot_tier_distribution AS
SELECT
  selected_tier,
  selected_model,
  COUNT(*) as step_count,
  AVG(complexity_score) as avg_complexity,
  AVG(agent_ais_score) as avg_agent_ais,
  SUM(tokens_used) as total_tokens,
  AVG(tokens_used) as avg_tokens_per_step,
  SUM(cost_usd) as total_cost_usd
FROM pilot_step_routing_history
WHERE routing_source = 'pilot_per_step'
GROUP BY selected_tier, selected_model
ORDER BY selected_tier, total_tokens DESC;

-- View 3: Step Type Analysis
CREATE OR REPLACE VIEW pilot_step_type_analysis AS
SELECT
  step_type,
  COUNT(*) as step_count,
  AVG(complexity_score) as avg_complexity,
  COUNT(CASE WHEN selected_tier = 'tier1' THEN 1 END) as tier1_count,
  COUNT(CASE WHEN selected_tier = 'tier2' THEN 1 END) as tier2_count,
  COUNT(CASE WHEN selected_tier = 'tier3' THEN 1 END) as tier3_count,
  SUM(tokens_used) as total_tokens,
  AVG(tokens_used) as avg_tokens,
  SUM(cost_usd) as total_cost_usd
FROM pilot_step_routing_history
WHERE routing_source = 'pilot_per_step'
GROUP BY step_type
ORDER BY total_tokens DESC;

-- View 4: Cost Savings Estimate
CREATE OR REPLACE VIEW pilot_cost_savings AS
WITH pilot_actual AS (
  SELECT
    SUM(cost_usd) as actual_cost
  FROM pilot_step_routing_history
  WHERE routing_source = 'pilot_per_step'
),
pilot_if_tier3 AS (
  SELECT
    SUM(tokens_used * 0.005 / 1000) as projected_cost
  FROM pilot_step_routing_history
  WHERE routing_source = 'pilot_per_step'
)
SELECT
  pa.actual_cost,
  pt.projected_cost,
  pt.projected_cost - pa.actual_cost as savings,
  ROUND(((pt.projected_cost - pa.actual_cost) / NULLIF(pt.projected_cost, 0) * 100)::numeric, 2) as savings_percentage
FROM pilot_actual pa, pilot_if_tier3 pt;
```

---

## PHASE 2: Task Complexity Analyzer

### File: `/lib/pilot/TaskComplexityAnalyzer.ts`

**Purpose**: Analyzes individual Pilot steps to determine complexity (0-10 scale) and recommended model tier.

**Key Features**:
- Step type classification (LLM vs non-LLM)
- 6 complexity factors: prompt_length, data_size, condition_count, context_depth, reasoning_depth, output_complexity
- Weighted scoring algorithm
- Tier mapping (tier1/tier2/tier3)
- Database-driven configuration
- 5-minute cache

**Core Methods**:
- `analyzeStepComplexity()` - Main entry point
- `calculateComplexityFactors()` - Calculate all 6 factors
- `calculateWeightedScore()` - Weighted average
- `mapComplexityToTier()` - Map score to tier

**Configuration**: Reads from `pilot_task_complexity_config` table

---

## PHASE 3: Per-Step Model Router

### File: `/lib/pilot/PerStepModelRouter.ts`

**Purpose**: Selects optimal model for each Pilot step based on complexity analysis and routing strategy.

**Key Features**:
- 3 routing strategies: conservative, balanced, aggressive
- Agent AIS + Step Complexity weighting
- Model tier configuration (tier1/tier2/tier3)
- Fallback logic for errors
- Database-driven configuration
- 5-minute cache

**Core Methods**:
- `selectModelForStep()` - Main entry point
- `calculateEffectiveComplexity()` - Weighted average of AIS and step complexity
- `mapComplexityToTier()` - Map to tier
- `getModelForTier()` - Get model from tier config
- `getFallbackModel()` - Safe fallback on errors

**Configuration**: Reads from `pilot_routing_config` table

**Routing Strategies**:
- **Conservative**: 60% agent AIS, 40% step complexity (safer, higher costs)
- **Balanced**: 40% agent AIS, 60% step complexity (default)
- **Aggressive**: 20% agent AIS, 80% step complexity (max savings)

---

## PHASE 4: Integrate with StepExecutor

### File: `/lib/pilot/StepExecutor.ts`

**Changes Required**:

1. **Add Imports**
   ```typescript
   import { TaskComplexityAnalyzer } from './TaskComplexityAnalyzer';
   import { PerStepModelRouter, type ModelSelection } from './PerStepModelRouter';
   ```

2. **Add Class Properties**
   ```typescript
   private complexityAnalyzer: TaskComplexityAnalyzer;
   private stepRouter: PerStepModelRouter;
   private agentAIS: number | null = null;
   private perStepRoutingEnabled: boolean = true;
   ```

3. **Initialize in Constructor**
   ```typescript
   this.complexityAnalyzer = new TaskComplexityAnalyzer(supabase);
   this.stepRouter = new PerStepModelRouter(supabase);
   ```

4. **Add `initialize()` Method**
   - Fetch agent AIS once per execution (performance optimization)
   - Check if per-step routing enabled
   - Cache results in class properties

5. **Modify `executeLLMDecision()` Method**
   - Call `stepRouter.selectModelForStep()` to get model selection
   - Pass `modelSelection` to `runAgentKit()`
   - Track routing decision in `pilot_step_routing_history`

6. **Add `trackStepRouting()` Method**
   - Insert routing decision into `pilot_step_routing_history`
   - Calculate cost estimate
   - Non-blocking (async, catch errors)

### File: `/lib/pilot/WorkflowPilot.ts`

**Changes Required**:

1. **Call `initialize()`** before executing steps
   ```typescript
   await this.stepExecutor.initialize(agent.id, userId);
   ```

2. **Cache Memory Context** (performance optimization)
   - Load memory once per execution
   - Store in `context.memoryContext`
   - Reuse for all steps

---

## PHASE 5: Update AgentKit

### File: `/lib/agentkit/runAgentKit.ts`

**Changes Required**:

1. **Add Import**
   ```typescript
   import type { ModelSelection } from '@/lib/pilot/PerStepModelRouter';
   ```

2. **Update Function Signature**
   ```typescript
   export async function runAgentKit(
     userId: string,
     agent: {...},
     userInput: string,
     inputValues?: Record<string, any>,
     sessionId?: string,
     modelOverride?: ModelSelection // NEW parameter
   ): Promise<AgentKitExecutionResult>
   ```

3. **Modify Routing Logic** (around line 163)
   ```typescript
   // PRIORITY 1: Pilot per-step override
   if (modelOverride) {
     selectedModel = modelOverride.model;
     selectedProvider = modelOverride.provider;
     routingSource = 'pilot_per_step';
   }
   // PRIORITY 2: Global AIS routing
   else if (ROUTING_ENABLED) {
     // ... existing global routing logic
   }
   // PRIORITY 3: Default model
   else {
     selectedModel = AGENTKIT_CONFIG.model;
     selectedProvider = 'openai';
   }
   ```

4. **Preserve Memory Integration** (lines 223-232)
   - **CRITICAL**: Do not modify memory loading logic
   - Add support for cached memory context (from Pilot)
   - Check for `_pilotMemoryContext` in inputValues

5. **Update Analytics Tracking**
   - Add routing metadata: `routing_source`, `routing_tier`, `routing_complexity`

---

## PHASE 6: Audit Trail & Memory Integration

### 6.1 Audit Trail Events

**File**: `/lib/audit/events.ts`

**Add Events**:
- `PILOT_STEP_ROUTING` - Per-step routing decision
- `PILOT_ROUTING_FALLBACK` - Fallback to safe default
- `ROUTING_CONFIG_UPDATED` - Configuration changes

**Logging**: Track all routing decisions with full context

### 6.2 Memory Integration

**Problem**: Pilot calls `runAgentKit()` multiple times (once per LLM step), causing memory to be loaded repeatedly.

**Solution**: Cache memory context in `ExecutionContext`

**Changes**:

1. **`/lib/pilot/types.ts`** - Add `memoryContext` to ExecutionContext
2. **`/lib/pilot/WorkflowPilot.ts`** - Load memory once, cache in context
3. **`/lib/agentkit/runAgentKit.ts`** - Check for cached memory before loading
4. **`/lib/pilot/StepExecutor.ts`** - Pass cached memory to runAgentKit

**Performance Impact**: Eliminates N memory loads (where N = number of LLM steps)

---

## PHASE 7: Admin UI & Analytics

### File: `/app/admin/pilot-routing/page.tsx`

**Features**:

1. **Configuration Section**
   - Routing strategy selector (conservative/balanced/aggressive)
   - Tier threshold inputs (tier1_max, tier2_max)
   - Model tier configuration (tier1/tier2/tier3 models)
   - Save button with validation

2. **Cost Savings Summary**
   - Actual cost (with per-step routing)
   - Projected cost (if all steps used tier3)
   - Savings amount
   - Savings percentage

3. **Tier Distribution**
   - Visual breakdown (bar chart)
   - Step count per tier
   - Cost per tier
   - Average complexity per tier

4. **Step Type Analysis**
   - Table showing step types
   - Tier distribution per step type
   - Token usage per step type
   - Cost per step type

5. **Recent Routing Decisions**
   - Table of recent routing decisions
   - Step name, type, complexity, tier, model
   - Searchable and filterable

**Tech Stack**: React, TailwindCSS, Lucide icons

---

## PHASE 8: Testing & Validation

### 8.1 Unit Tests

**Files**:
- `/tests/pilot/TaskComplexityAnalyzer.test.ts`
- `/tests/pilot/PerStepModelRouter.test.ts`

**Test Coverage**:
- Non-LLM step detection
- Complexity scoring accuracy
- Tier mapping logic
- Routing strategy calculation
- Fallback behavior
- Configuration caching

### 8.2 Integration Tests

**Files**:
- `/tests/pilot/PerStepRouting.integration.test.ts`

**Test Coverage**:
- End-to-end routing flow
- Pilot → StepExecutor → runAgentKit
- Memory context caching
- Audit trail logging
- Analytics tracking

### 8.3 Manual Testing Checklist

- [ ] **Pilot disabled, global routing enabled** → Global AIS routing works
- [ ] **Pilot disabled, global routing disabled** → Default model (gpt-4o) used
- [ ] **Pilot enabled, global routing enabled** → Per-step routing used (ignores global)
- [ ] **Pilot enabled, global routing disabled** → Per-step routing used
- [ ] **Simple steps** → Route to tier1 (gpt-4o-mini)
- [ ] **Medium steps** → Route to tier2 (claude-haiku)
- [ ] **Complex steps** → Route to tier3 (gpt-4o)
- [ ] **Routing history** → Tracked correctly in database
- [ ] **Cost calculations** → Accurate estimates
- [ ] **Memory context** → Cached (not reloaded per step)
- [ ] **Audit trail** → Events logged
- [ ] **Analytics views** → Show correct data
- [ ] **Admin UI** → Configuration saves and loads
- [ ] **Fallback logic** → Safe defaults on errors
- [ ] **Performance** → No significant slowdown (<10ms overhead per step)

---

## Rollout Strategy

### Stage 1: Development & Testing (Week 1)
- Implement all phases
- Unit tests pass
- Integration tests pass
- Manual testing complete

### Stage 2: Staging Deployment (Week 2)
- Deploy to staging environment
- Run Pilot with per-step routing on test agents
- Monitor: success rate, token consumption, costs
- Tune thresholds and weights

### Stage 3: Limited Production (Week 3)
- Enable for 5-10 test agents in production
- Monitor closely
- Compare: Pilot agents vs non-Pilot agents
- Gather user feedback

### Stage 4: Gradual Rollout (Week 4-5)
- 25% of Pilot agents
- 50% of Pilot agents
- 75% of Pilot agents
- Fine-tune based on data

### Stage 5: Full Production (Week 6+)
- 100% of Pilot agents
- Continuous monitoring
- Optimize based on analytics
- Document learnings

---

## Success Metrics

### Primary KPIs (Pilot Agents)

1. **Token Reduction**: Target 30-50% vs global routing
2. **Cost Savings**: Target 40-65% vs global routing
3. **Quality Maintenance**: Success rate ±2% of baseline
4. **Performance**: <10ms overhead per step

### Comparison KPIs

1. Pilot per-step routing vs Global AIS routing
2. Tier distribution (tier1/tier2/tier3 usage)
3. Token consumption by routing source
4. Cost per execution by routing source

### Operational KPIs

1. Routing decision latency
2. Fallback frequency (error rate)
3. Cache hit rate (config, agent AIS)
4. Database query performance

---

## Expected Outcomes

### Token Reduction (Conservative Estimates)

**Example**: Agent with AIS = 7.0, 10 Pilot steps

**Current** (No Pilot, Global Routing):
- All execution uses gpt-4o
- Estimated: ~50K tokens

**With Pilot + Per-Step Routing**:
- 5 simple steps → gpt-4o-mini → ~10K tokens
- 3 medium steps → claude-haiku → ~9K tokens
- 2 complex steps → gpt-4o → ~10K tokens
- **Total**: ~29K tokens
- **Reduction**: ~42% tokens, ~60% cost

**System-Wide** (assuming 40% of agents use Pilot):
- Non-Pilot agents: No change
- Pilot agents: 30-50% token reduction
- Overall: 12-20% token reduction

---

## Risk Assessment

### Low Risk ✅
- Backward compatible (Pilot is opt-in)
- Non-Pilot agents completely unchanged
- Extensive logging and tracking
- Clear fallback logic
- Simplified decision tree

### Medium Risk ⚠️
- Complexity scoring accuracy (mitigate: shadow mode, tuning)
- Model tier configuration errors (mitigate: validation, defaults)
- Performance impact (mitigate: caching, optimization)

### High Risk ❌
- None identified (clear separation, gradual rollout)

---

## Files Changed Summary

### New Files
- `/lib/pilot/TaskComplexityAnalyzer.ts`
- `/lib/pilot/PerStepModelRouter.ts`
- `/app/admin/pilot-routing/page.tsx`
- `/tests/pilot/TaskComplexityAnalyzer.test.ts`
- `/tests/pilot/PerStepModelRouter.test.ts`
- `/tests/pilot/PerStepRouting.integration.test.ts`

### Modified Files
- `/lib/pilot/StepExecutor.ts`
- `/lib/pilot/WorkflowPilot.ts`
- `/lib/pilot/types.ts`
- `/lib/agentkit/runAgentKit.ts`
- `/lib/audit/events.ts`

### Database Changes
- 3 new tables
- 4 new views
- Seed data for configuration

---

## Conclusion

This implementation provides a **comprehensive, database-driven, performance-optimized** solution for per-step routing that:

✅ **Clear Control Flow**: Pilot enabled = Per-step routing (always)
✅ **Reduces Token Consumption**: 30-50% reduction for Pilot agents
✅ **Maintains Quality**: Right model for right task
✅ **Preserves Existing Behavior**: Non-Pilot agents unchanged
✅ **Avoids Hardcoding**: All configuration in database
✅ **Ensures Performance**: Caching and async operations
✅ **Enables Optimization**: Comprehensive analytics
✅ **Supports Safe Rollout**: Feature flags and gradual rollout

**Ready for implementation!** 🚀
