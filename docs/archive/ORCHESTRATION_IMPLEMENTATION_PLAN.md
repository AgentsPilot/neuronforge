# Intelligent Orchestration System - Implementation Plan

**Status:** In Progress
**Started:** 2025-11-11
**Timeline:** 12-16 weeks (6 phases)
**Risk Level:** LOW-MEDIUM (phased rollout with feature flags)

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Implementation Phases](#implementation-phases)
4. [Integration Points](#integration-points)
5. [Testing Strategy](#testing-strategy)
6. [Rollout Strategy](#rollout-strategy)
7. [Success Metrics](#success-metrics)
8. [Risk Mitigation](#risk-mitigation)

---

## Executive Summary

### Goal
Upgrade NeuronForge's agent orchestration system with intelligent routing, token governance, and adaptive execution based on AIS scores.

### Key Benefits
- **30-40% token cost reduction** via smart compression and budgeting
- **Adaptive routing** based on agent complexity (AIS scores)
- **Intent-based execution** optimizes each step type
- **Circuit breaker prevention** eliminates "token limit exceeded" errors
- **Extensible handler system** for future optimization strategies

### Approach
6-phase incremental implementation with feature flags at each step. No backward compatibility concerns (MVP0). Comprehensive integration with existing systems (audit, memory, AIS, tokens, pricing).

---

## Architecture Overview

### Current State
```
Agent Execution
├── WorkflowPilot (orchestration)
│   ├── StepExecutor (by step.type)
│   ├── ParallelExecutor
│   └── ConditionalEvaluator
└── runAgentKit (single LLM call)

Existing Systems
├── Memory (MemoryInjector, MemorySummarizer)
├── AIS (agent_intensity_metrics)
├── Audit (AuditTrailService)
├── Tokens (pricing.ts, token_usage)
└── Plugins (PluginManagerV2)
```

### Target State
```
Agent Execution
├── Orchestrator (universal entry point)
│   ├── IntentClassifier → Detect intent type
│   ├── TokenBudgetManager → Allocate budgets
│   ├── AISRouter → Route by complexity
│   ├── HandlerRegistry → Route by intent
│   │   ├── ExtractHandler
│   │   ├── SummarizeHandler
│   │   ├── GenerateHandler
│   │   ├── ValidateHandler
│   │   └── SendHandler
│   └── TokenCompressor → Smart compression
└── Enhanced Systems (integrated)
    ├── Memory (budget-aware)
    ├── AIS (orchestration metrics)
    ├── Audit (orchestration events)
    └── Tokens (budget tracking)
```

### Intent Types
```typescript
export type IntentType =
  | 'extract'     // Data retrieval (plugins, APIs)
  | 'summarize'   // Content condensation (compression)
  | 'generate'    // Content creation (LLM)
  | 'validate'    // Data quality checks
  | 'send'        // Output delivery (email, sheets)
  | 'transform'   // Data manipulation
  | 'conditional' // Logic branching
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
**Goal:** Add infrastructure without changing behavior
**Risk:** LOW (additive only)

#### Deliverables
1. **Types & Interfaces** (`/lib/orchestration/types.ts`)
   ```typescript
   export type IntentType = 'extract' | 'summarize' | 'generate' | 'validate' | 'send'

   export interface TokenBudget {
     allocated: number
     used: number
     remaining: number
     compressed: boolean
   }

   export interface CompressionPolicy {
     enabled: boolean
     ratio: number // 0.0-1.0
     minQualityScore: number
   }

   export interface OrchestrationMetadata {
     intent: IntentType
     tokenBudget: number
     compressionPolicy?: CompressionPolicy
     routingTier?: 'fast' | 'balanced' | 'capable'
   }
   ```

2. **Intent Classifier** (`/lib/orchestration/IntentClassifier.ts`)
   - Classify step intent from step definition
   - Detect compression opportunities
   - Estimate token consumption
   - **No execution changes yet**

3. **Token Budget Manager** (`/lib/orchestration/TokenBudgetManager.ts`)
   - Calculate budget allocation
   - Track consumption
   - Flag overages
   - **No enforcement yet**

4. **Database Schema**
   ```sql
   -- supabase/migrations/20250112_orchestration_foundation.sql

   CREATE TABLE orchestration_intents (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     step_type TEXT NOT NULL,
     intent TEXT NOT NULL,
     complexity_score NUMERIC,
     estimated_tokens INTEGER,
     compression_recommended BOOLEAN DEFAULT FALSE,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE workflow_executions
     ADD COLUMN intent_classification JSONB,
     ADD COLUMN token_budget_allocated INTEGER,
     ADD COLUMN token_budget_used INTEGER;

   ALTER TABLE workflow_step_executions
     ADD COLUMN intent TEXT,
     ADD COLUMN token_budget_step INTEGER;
   ```

5. **Integration**
   - Add to `WorkflowPilot` constructor (disabled by feature flag)
   - Feature flag: `orchestration_intents_enabled = false`
   - Log classifications to console only

#### Tests
```typescript
// tests/orchestration/IntentClassifier.test.ts
describe('IntentClassifier', () => {
  test('classifies extract intent from plugin actions')
  test('classifies summarize intent from AI processing')
  test('classifies generate intent from LLM steps')
  test('detects compression opportunities')
  test('estimates token consumption accurately')
})

// tests/orchestration/TokenBudgetManager.test.ts
describe('TokenBudgetManager', () => {
  test('allocates budget proportionally')
  test('tracks consumption per step')
  test('flags budget overages')
  test('reserves budget for memory context')
})
```

#### Success Criteria
- [ ] All types defined and documented
- [ ] Intent classifier working (95%+ accuracy on test cases)
- [ ] Budget manager allocating correctly
- [ ] Zero production impact
- [ ] Unit tests passing (100%)

---

### Phase 2: Token Governance (Weeks 3-5)
**Goal:** Prevent runaway token consumption
**Risk:** MEDIUM (changes execution flow)

#### Deliverables
1. **Token Compressor** (`/lib/orchestration/TokenCompressor.ts`)
   ```typescript
   export class TokenCompressor {
     async compress(
       content: string,
       targetTokens: number,
       quality: number
     ): Promise<CompressedContent> {
       // Use mini model to summarize
       // Preserve semantic meaning
       // Track compression ratio
     }
   }
   ```

2. **Modified StepExecutor** (`/lib/pilot/StepExecutor.ts`)
   - Check budget before execution
   - Apply compression if approaching limit
   - Log budget warnings

3. **Modified runAgentKit** (`/lib/agentkit/runAgentKit.ts`)
   - Honor token budget per iteration
   - Apply compression to tool responses

4. **Database Schema**
   ```sql
   -- supabase/migrations/20250126_token_governance.sql

   CREATE TABLE token_budgets (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_id UUID NOT NULL REFERENCES agents(id),
     execution_id UUID NOT NULL REFERENCES workflow_executions(id),
     step_id TEXT NOT NULL,
     allocated_tokens INTEGER NOT NULL,
     used_tokens INTEGER DEFAULT 0,
     compression_applied BOOLEAN DEFAULT FALSE,
     compression_ratio NUMERIC,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX idx_token_budgets_execution ON token_budgets(execution_id);
   ```

5. **Integration**
   - Feature flag: `token_governance_enabled = false`
   - Graceful degradation (warn, don't fail)
   - Track savings in metrics

#### Tests
```typescript
// tests/orchestration/TokenCompressor.test.ts
describe('TokenCompressor', () => {
  test('truncates verbose outputs')
  test('summarizes large context')
  test('preserves semantic meaning')
  test('respects quality threshold')
})

// Integration tests
describe('Token Governance Integration', () => {
  test('respects budget per step')
  test('applies compression when needed')
  test('prevents circuit breaker')
  test('maintains execution quality')
})
```

#### Success Criteria
- [ ] Compression working (preserves meaning)
- [ ] Budget enforcement active
- [ ] 30-40% token savings measured
- [ ] Zero execution failures due to compression
- [ ] Integration tests passing

---

### Phase 3: Intent Routing (Weeks 6-8)
**Goal:** Route steps to optimal execution path
**Risk:** MEDIUM (changes step execution logic)

#### Deliverables
1. **Intent Handlers** (`/lib/orchestration/IntentHandlers/`)
   ```typescript
   // ExtractHandler.ts
   export class ExtractHandler extends BaseHandler {
     async execute(step: WorkflowStep, context: ExecutionContext) {
       // Optimize data retrieval
       // No LLM needed for most extractions
       // Fast, deterministic execution
     }
   }

   // SummarizeHandler.ts
   export class SummarizeHandler extends BaseHandler {
     async execute(step: WorkflowStep, context: ExecutionContext) {
       // Smart compression
       // Quality-aware summarization
       // Budget-conscious LLM calls
     }
   }

   // GenerateHandler.ts
   export class GenerateHandler extends BaseHandler {
     async execute(step: WorkflowStep, context: ExecutionContext) {
       // Content creation
       // Guardrails (length, format, quality)
       // Retry logic for quality issues
     }
   }

   // ValidateHandler.ts
   export class ValidateHandler extends BaseHandler {
     async execute(step: WorkflowStep, context: ExecutionContext) {
       // Schema validation
       // Data quality checks
       // Type coercion
     }
   }

   // SendHandler.ts
   export class SendHandler extends BaseHandler {
     async execute(step: WorkflowStep, context: ExecutionContext) {
       // Delivery optimization
       // Batching
       // Retry logic
     }
   }
   ```

2. **Handler Registry** (`/lib/orchestration/HandlerRegistry.ts`)
   ```typescript
   export class HandlerRegistry {
     private handlers: Map<IntentType, BaseHandler> = new Map()

     register(intent: IntentType, handler: BaseHandler) { ... }
     get(intent: IntentType): BaseHandler | null { ... }
     execute(step: WorkflowStep, context: ExecutionContext) { ... }
   }
   ```

3. **Modified StepExecutor**
   - Route by intent (not just step.type)
   - Apply intent-specific optimizations
   - Fallback to default if no handler

4. **Database Schema**
   ```sql
   -- supabase/migrations/20250209_intent_handlers.sql

   CREATE TABLE orchestration_handlers (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     intent TEXT NOT NULL UNIQUE,
     handler_class TEXT NOT NULL,
     optimization_level TEXT DEFAULT 'standard',
     enabled BOOLEAN DEFAULT TRUE,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   INSERT INTO orchestration_handlers (intent, handler_class) VALUES
     ('extract', 'ExtractHandler'),
     ('summarize', 'SummarizeHandler'),
     ('generate', 'GenerateHandler'),
     ('validate', 'ValidateHandler'),
     ('send', 'SendHandler');
   ```

5. **Integration**
   - Feature flag: `intent_routing_enabled = false`
   - Fallback to existing logic
   - Preserve audit trail

#### Tests
```typescript
// tests/orchestration/IntentHandlers.test.ts
describe('Intent Handlers', () => {
  test('ExtractHandler optimizes retrieval')
  test('SummarizeHandler applies compression')
  test('GenerateHandler enforces guardrails')
  test('ValidateHandler catches errors')
  test('SendHandler batches operations')
})

// Integration tests
describe('Intent Routing Integration', () => {
  test('routes extract to ExtractHandler')
  test('falls back if handler missing')
  test('preserves audit trail')
  test('tracks handler metrics')
})
```

#### Success Criteria
- [ ] All handlers implemented
- [ ] Routing working correctly
- [ ] Execution quality maintained
- [ ] Handler metrics tracked
- [ ] Integration tests passing

---

### Phase 4: AIS Routing (Weeks 9-11)
**Goal:** Route based on agent complexity
**Risk:** LOW (leverages existing AIS system)

#### Deliverables
1. **AIS Router** (`/lib/orchestration/AISRouter.ts`)
   ```typescript
   export class AISRouter {
     async route(agent: Agent, step: WorkflowStep): Promise<RoutingDecision> {
       const ais = await this.getAgentAIS(agent.id)

       if (ais < 5.0) return { tier: 'fast', model: 'gpt-4o-mini' }
       if (ais < 7.5) return { tier: 'balanced', model: 'gpt-4o' }
       return { tier: 'capable', model: 'claude-sonnet' }
     }
   }
   ```

2. **Modified WorkflowPilot**
   - Query AIS before execution
   - Pass AIS to IntentClassifier
   - Adjust budgets by tier

3. **Database Schema**
   ```sql
   -- supabase/migrations/20250223_ais_routing.sql

   ALTER TABLE workflow_executions
     ADD COLUMN ais_score_at_execution NUMERIC,
     ADD COLUMN routing_tier TEXT,
     ADD COLUMN routing_reason TEXT;

   CREATE INDEX idx_workflow_executions_ais
     ON workflow_executions(ais_score_at_execution);
   ```

4. **Integration**
   - Feature flag: `ais_routing_enabled = false`
   - Coordinate with per-step routing
   - Fallback if AIS unavailable

#### Tests
```typescript
// tests/orchestration/AISRouter.test.ts
describe('AISRouter', () => {
  test('routes low AIS to fast tier')
  test('routes high AIS to capable tier')
  test('adjusts as AIS evolves')
  test('handles missing AIS gracefully')
})

// Integration tests
describe('AIS Routing Integration', () => {
  test('coordinates with per-step routing')
  test('respects user model preferences')
  test('tracks routing decisions')
})
```

#### Success Criteria
- [ ] AIS routing working
- [ ] Coordination with existing routing
- [ ] Cost optimization visible
- [ ] Quality maintained
- [ ] Integration tests passing

---

### Phase 5: Handler Registry Pattern (Weeks 12-13)
**Goal:** Make handlers pluggable and extensible
**Risk:** LOW (refactoring only)

#### Deliverables
1. **Enhanced HandlerRegistry**
   - Dynamic handler registration
   - Handler lifecycle (init, execute, cleanup)
   - Configuration support

2. **BaseHandler** (`/lib/orchestration/IntentHandlers/BaseHandler.ts`)
   ```typescript
   export abstract class BaseHandler {
     abstract execute(
       step: WorkflowStep,
       context: ExecutionContext
     ): Promise<StepOutput>

     async validate(step: WorkflowStep): Promise<boolean> { ... }
     async rollback(step: WorkflowStep, context: ExecutionContext): Promise<void> { ... }

     // Shared utilities
     protected compress(content: string, budget: number): Promise<string> { ... }
     protected trackMetrics(metrics: HandlerMetrics): Promise<void> { ... }
   }
   ```

3. **Refactored Handlers**
   - Extend BaseHandler
   - Implement lifecycle methods
   - Add handler-specific config

#### Tests
```typescript
// tests/orchestration/HandlerRegistry.test.ts
describe('HandlerRegistry', () => {
  test('registers and retrieves handlers')
  test('handles missing handlers')
  test('supports dynamic registration')
  test('validates handler interface')
})

// tests/orchestration/BaseHandler.test.ts
describe('BaseHandler', () => {
  test('provides common interface')
  test('supports rollback on failure')
  test('tracks handler metrics')
})
```

#### Success Criteria
- [ ] Registry pattern working
- [ ] Handlers refactored
- [ ] Extensibility validated
- [ ] Zero regressions
- [ ] Tests passing

---

### Phase 6: Agent Creation Pipeline (Weeks 14-16)
**Goal:** Generate intent-aware agents
**Risk:** LOW (enhances existing pipeline)

#### Deliverables
1. **Enhanced Agent Creation** (`/lib/agentkit/analyzePrompt-v3-direct.ts`)
   ```typescript
   const systemPrompt = `...

   # INTELLIGENT ORCHESTRATION
   For each workflow step, classify its intent:
   - "extract" → Retrieve data (search_emails, read_sheet)
   - "summarize" → Condense/analyze data
   - "generate" → Create content (drafts, reports)
   - "validate" → Check data quality
   - "send" → Deliver outputs (send_email)

   Return:
   {
     "id": "step1",
     "operation": "Search emails",
     "type": "plugin_action",
     "intent": "extract",
     "token_budget": 500,
     ...
   }
   `
   ```

2. **Modified Generation API** (`/app/api/generate-agent-v2/route.ts`)
   - Store intent metadata
   - Enable orchestration by default

#### Tests
```typescript
// tests/agentkit/analyzePrompt-intents.test.ts
describe('Agent Creation with Intents', () => {
  test('classifies extract intent')
  test('classifies summarize intent')
  test('suggests token budgets')
  test('backward compatible')
})
```

#### Success Criteria
- [ ] Intent detection working
- [ ] New agents orchestration-ready
- [ ] Token budgets suggested
- [ ] Tests passing

---

## Integration Points

### 1. Audit Trail System ✅
**Current:** `AuditTrailService` logs 20+ event types
**Enhancement:**
- Add orchestration events:
  - `ORCHESTRATION_INTENT_CLASSIFIED`
  - `ORCHESTRATION_TOKEN_BUDGET_ALLOCATED`
  - `ORCHESTRATION_TOKEN_COMPRESSED`
  - `ORCHESTRATION_HANDLER_EXECUTED`
  - `ORCHESTRATION_AIS_ROUTED`
- Preserve batched, non-blocking logging

**Code Changes:**
```typescript
// lib/audit/events.ts
export const AUDIT_EVENTS = {
  // ... existing events
  ORCHESTRATION_INTENT_CLASSIFIED: 'orchestration.intent_classified',
  ORCHESTRATION_TOKEN_COMPRESSED: 'orchestration.token_compressed',
  // ...
}
```

---

### 2. Memory System ✅
**Current:** `MemoryInjector` injects ~800 tokens
**Enhancement:**
- Token budget accounts for memory context
- Compression applies to memory if needed
- `MemorySummarizer` creates execution summaries

**Code Changes:**
```typescript
// lib/orchestration/TokenBudgetManager.ts
calculateBudget(agent: Agent, memoryTokens: number): TokenBudget {
  const totalBudget = agent.token_limit || 10000
  const memoryReserved = memoryTokens
  const stepBudget = (totalBudget - memoryReserved) / agent.steps.length
  // ...
}
```

---

### 3. AIS System ✅
**Current:** 3-score system (execution, creation, combined)
**Enhancement:**
- Add orchestration metrics:
  - `orchestration_efficiency` (token savings)
  - `token_governance_score` (budget adherence)
  - `handler_effectiveness` (routing quality)
- Preserve existing 5-component execution score

**Code Changes:**
```typescript
// lib/utils/updateAgentIntensity.ts
async function updateAgentIntensityMetrics(agent: Agent, execution: Execution) {
  // ... existing metrics

  // NEW: Orchestration metrics
  const orchestrationEfficiency = calculateTokenSavings(execution)
  const tokenGovernanceScore = calculateBudgetAdherence(execution)

  // Include in execution_score calculation
  executionScore = weighted_average([
    tokenEfficiency,
    executionSpeed,
    pluginReliability,
    workflowComplexity,
    memoryUsage,
    orchestrationEfficiency  // NEW
  ])
}
```

---

### 4. Token Tracking ✅
**Current:** `BaseProvider` auto-tracks all AI API calls
**Enhancement:**
- Track token budgets in new `token_budgets` table
- Compression stats tracked separately
- Pricing calculations via existing `pricing.ts`

**Code Changes:**
```typescript
// lib/orchestration/TokenBudgetManager.ts
async trackBudgetUsage(
  executionId: string,
  stepId: string,
  allocated: number,
  used: number,
  compressed: boolean
) {
  await supabase.from('token_budgets').insert({
    execution_id: executionId,
    step_id: stepId,
    allocated_tokens: allocated,
    used_tokens: used,
    compression_applied: compressed,
    compression_ratio: compressed ? (used / allocated) : 1.0
  })
}
```

---

### 5. Plugin System ✅
**Current:** `PluginManagerV2`, `PluginExecuterV2`
**Enhancement:**
- Intent handlers optimize plugin usage
- ExtractHandler routes plugin actions deterministically
- No changes to plugin execution itself

**Code Changes:**
```typescript
// lib/orchestration/IntentHandlers/ExtractHandler.ts
async execute(step: WorkflowStep, context: ExecutionContext) {
  if (step.type === 'action') {
    // Deterministic plugin execution (no LLM)
    return await PluginExecuterV2.execute(step.plugin, step.action, step.params)
  }
  // ...
}
```

---

## Testing Strategy

### Unit Tests (100% coverage target)
```
tests/orchestration/
├── IntentClassifier.test.ts
├── TokenBudgetManager.test.ts
├── TokenCompressor.test.ts
├── AISRouter.test.ts
├── HandlerRegistry.test.ts
├── BaseHandler.test.ts
└── IntentHandlers/
    ├── ExtractHandler.test.ts
    ├── SummarizeHandler.test.ts
    ├── GenerateHandler.test.ts
    ├── ValidateHandler.test.ts
    └── SendHandler.test.ts
```

### Integration Tests
```
tests/integration/orchestration/
├── end-to-end-orchestration.test.ts
├── memory-integration.test.ts
├── audit-integration.test.ts
├── token-tracking-integration.test.ts
├── ais-routing-integration.test.ts
└── plugin-execution-integration.test.ts
```

### Performance Tests
```
tests/performance/orchestration/
├── token-savings.test.ts (measure compression)
├── routing-overhead.test.ts (measure latency)
├── budget-enforcement.test.ts (measure checks)
└── handler-execution.test.ts (measure handler overhead)
```

### Regression Tests
```
tests/regression/
├── existing-agents.test.ts (run 100 old agents)
├── agentkit-compatibility.test.ts (AgentKit unchanged)
└── plugin-execution.test.ts (plugins work identically)
```

---

## Rollout Strategy

### Feature Flags (Database-Driven)
```sql
-- system_config table
INSERT INTO system_config (key, value, description) VALUES
  ('orchestration_intents_enabled', 'false', 'Enable intent classification'),
  ('token_governance_enabled', 'false', 'Enable token budget enforcement'),
  ('intent_routing_enabled', 'false', 'Enable intent-based routing'),
  ('ais_routing_enabled', 'false', 'Enable AIS-based routing');
```

### Rollout Timeline
```
Week 1-2:  Phase 1 (Foundation) → Staging only
Week 3-5:  Phase 2 (Token Governance) → 5% of new agents
Week 6-8:  Phase 3 (Intent Routing) → 25% of new agents
Week 9-11: Phase 4 (AIS Routing) → 50% of new agents
Week 12-13: Phase 5 (Handler Registry) → 75% of new agents
Week 14-16: Phase 6 (Agent Creation) → 100% of new agents

Week 17-18: Monitor, assess, offer opt-in for old agents
```

### Rollback Plan
Each phase can be rolled back independently:
1. Feature flag OFF → Zero impact
2. Remove new database columns → Safe (nullable)
3. Delete new tables → Safe (not used)
4. Revert code changes → Git rollback

---

## Success Metrics

### Functional Metrics
- [ ] Intent classification accuracy > 95%
- [ ] Token budget adherence > 90% (within 10% of allocated)
- [ ] Compression quality score > 4.5/5 (user ratings)
- [ ] Zero regression in existing functionality
- [ ] Execution success rate maintained or improved

### Performance Metrics
- [ ] Token savings: 30-40% average reduction
- [ ] Orchestration overhead: < 50ms per step
- [ ] Intent classification: < 100ms per workflow
- [ ] AIS routing: < 20ms per decision
- [ ] Handler execution: < 30ms overhead

### Business Metrics
- [ ] Cost savings: 30% reduction in token costs
- [ ] Scalability: Support 10x more executions
- [ ] Developer velocity: 50% faster agent creation
- [ ] Customer satisfaction: > 4.5/5 rating
- [ ] Circuit breaker triggers reduced by 80%

---

## Risk Mitigation

### High Risk: Breaking Changes
**Risk:** New system breaks existing agents
**Mitigation:**
- Feature flags for every phase
- Comprehensive regression tests
- Gradual rollout (5% → 25% → 50% → 100%)
- Instant rollback capability

### Medium Risk: Performance Degradation
**Risk:** Orchestration adds latency
**Mitigation:**
- Performance benchmarks before/after
- Overhead monitoring dashboards
- Circuit breakers (fallback to direct execution)
- Caching for intent classification

### Low Risk: Integration Failures
**Risk:** Existing systems break
**Mitigation:**
- Integration tests for every phase
- Mocked external dependencies
- Staging environment validation
- Canary deployments

---

## Monitoring & Observability

### Dashboards
```
Orchestration Health
├── Intent distribution (extract/summarize/generate/validate/send)
├── Token savings (compression effectiveness)
├── Budget adherence (steps within budget)
└── Routing effectiveness (AIS tier utilization)

Performance Impact
├── Orchestration overhead (ms per step)
├── Compression latency (ms per step)
├── Intent classification time (ms per workflow)
└── Handler execution time (ms per step)

Cost Optimization
├── Token cost per execution (before/after)
├── Compression ratio distribution
├── Budget utilization (allocated vs used)
└── ROI calculation (savings vs overhead)
```

### Alerts
```
Critical:
- Orchestration system down (fallback to direct execution)
- Handler failure rate > 5%

Warning:
- Budget overage rate > 10%
- Compression quality score < 4.0
- Routing overhead > 50ms
- Intent classification failing
```

---

## Documentation

### Developer Docs
```markdown
# Intelligent Orchestration System

## Quick Start
1. Enable feature flags in system_config
2. Create agent with intent annotations
3. Monitor orchestration metrics
4. Adjust budgets if needed

## Intent Types
- extract: Data retrieval (fast, deterministic)
- summarize: Content condensation (compression)
- generate: Content creation (LLM)
- validate: Data quality checks (schema)
- send: Output delivery (batching)

## Token Governance
- Automatic budget allocation
- Smart compression when needed
- Circuit breaker prevention

## AIS-Based Routing
- Low AIS (<5.0): Fast models, aggressive compression
- Mid AIS (5.0-7.5): Balanced models, moderate compression
- High AIS (>7.5): Capable models, minimal compression
```

### User Docs
```markdown
# Token Optimization (Auto-Applied)

Your agents now include smart token optimization:

## What's New
- Automatic budget allocation per step
- Smart compression for verbose outputs
- No more "token limit exceeded" errors

## How It Works
1. System analyzes your workflow
2. Allocates token budgets per step
3. Applies compression if needed
4. You see savings in execution details

## Quality Guarantee
- Semantic meaning preserved
- Critical data never truncated
- Can disable per agent if needed

## Token Savings
- Average: 30-40% reduction
- High: 50-60% for verbose workflows
```

---

## Next Steps

### Immediate (Week 1)
1. Create `/lib/orchestration/types.ts`
2. Implement `IntentClassifier`
3. Implement `TokenBudgetManager`
4. Add database migrations
5. Add unit tests

### Short Term (Weeks 2-5)
1. Implement `TokenCompressor`
2. Modify `StepExecutor` for budget checks
3. Enable token governance in staging
4. Measure token savings

### Medium Term (Weeks 6-11)
1. Implement intent handlers
2. Implement AIS routing
3. Roll out to 50% of new agents
4. Monitor quality and performance

### Long Term (Weeks 12-16)
1. Refactor to handler registry pattern
2. Enhance agent creation pipeline
3. Roll out to 100% of new agents
4. Offer opt-in for old agents

---

## Appendices

### A. Database Schema Changes

See `supabase/migrations/` for detailed SQL:
- `20250112_orchestration_foundation.sql`
- `20250126_token_governance.sql`
- `20250209_intent_handlers.sql`
- `20250223_ais_routing.sql`

### B. Type Definitions

See `/lib/orchestration/types.ts` for:
- `IntentType`
- `TokenBudget`
- `CompressionPolicy`
- `OrchestrationMetadata`
- `HandlerInterface`

### C. Configuration

See `system_config` table for:
- Feature flags
- Token budget multipliers
- Compression quality thresholds
- Routing tier definitions

---

**Document Version:** 1.0
**Last Updated:** 2025-11-11
**Owner:** NeuronForge Engineering Team
**Status:** Implementation In Progress
