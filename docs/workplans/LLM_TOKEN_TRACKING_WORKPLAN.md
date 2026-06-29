# LLM Token Tracking & Cost Visibility Workplan

> **Last Updated**: 2026-06-26
> **Status**: Planned (Not Started)
> **Priority**: P0 for Gap Fixes, P1-P2 for Enhancements

## Overview

This workplan addresses complete visibility into LLM token consumption and costs across the AgentPilot platform, enabling accurate tracking of every dollar spent on LLM calls.

---

## Current Architecture

### LLM Providers (5 Total)

| Provider | Location | Models |
|----------|----------|--------|
| OpenAI | `lib/ai/providers/openai.ts` | gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o3-mini |
| Anthropic | `lib/ai/providers/anthropic.ts` | claude-sonnet-4-20250514, claude-3-5-haiku |
| Kimi (Moonshot) | `lib/ai/providers/kimi.ts` | moonshot-v1-128k, moonshot-v1-32k |
| Groq | `lib/ai/providers/groq.ts` | llama-3.3-70b-versatile |
| Mistral | `lib/ai/providers/mistral.ts` | mistral-large-latest |

### Core Tracking Infrastructure

#### 1. ProviderFactory Pattern
**File:** `lib/ai/providerFactory.ts`
- Singleton factory managing all provider instances
- Providers extend `BaseProvider` which has automatic tracking

#### 2. BaseProvider.callWithTracking()
**File:** `lib/ai/providers/baseProvider.ts`
- Automatic token tracking wrapper for all LLM calls
- Calls `AIAnalyticsService.track()` after each completion

#### 3. AIAnalyticsService
**File:** `lib/analytics/aiAnalytics.ts`
- Tracks 40+ fields per LLM call
- Persists to `ai_calls` table
- Fields: user_id, provider, model_name, input_tokens, output_tokens, cost_usd, feature, component, activity_type, execution_id, latency_ms, etc.

#### 4. Pricing System
**File:** `lib/ai/pricing.ts`
- Three-tier pricing resolution:
  1. Database-backed (`ai_model_pricing` table, 5-min cache)
  2. Fallback hardcoded rates
  3. Default rate
- `calculateCost(provider, modelName, inputTokens, outputTokens)`

#### 5. Pilot Credits System
**File:** `lib/utils/pricingConfig.ts`
- `pilot_credit_cost_usd`: $0.00048 per credit
- `tokens_per_pilot_credit`: 10 tokens per credit
- `tokensToPilotCredits(tokens)` → `Math.ceil(tokens / config.tokens_per_pilot_credit)`

**File:** `lib/services/CreditService.ts`
- `chargeForExecution(userId, agentId, tokens, intensityScore)`
- Intensity multiplier: `1.0 + (intensityScore / 10)` (range 1.0-2.0x)

---

## All LLM Call Sites (28 Identified)

### Category 1: Agent Creation Flow
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Process message | `app/api/agent-creation/process-message/route.ts` | ✅ | agent_creation |
| Generate intent | `lib/agentkit/v6/intent/generate-intent.ts` | ✅ | v6_intent |
| Intent validation | `lib/agentkit/v6/intent/validate-intent.ts` | ✅ | v6_validation |

### Category 2: V6 Pipeline (Agent Generation)
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Pipeline orchestrator | `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | ✅ | v6_pipeline |
| Capability binder | `lib/agentkit/v6/capabilityBinder/CapabilityBinderV2.ts` | ✅ | v6_capability |
| IR converter | `lib/agentkit/v6/ir/IntentToIRConverter.ts` | ✅ | v6_ir |
| Ambiguity detector | `lib/agentkit/v6/AmbiguityDetector.ts` | ✅ | v6_ambiguity |
| Schema generator | `lib/agentkit/v6/SchemaGenerator.ts` | ✅ | v6_schema |

### Category 3: Workflow Execution (Pilot Engine)
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Step executor | `lib/pilot/StepExecutor.ts` | ✅ | execution |
| LLM decision steps | `lib/pilot/StepExecutor.ts` (llm_decision) | ✅ | execution_llm |
| Transform steps | `lib/pilot/StepExecutor.ts` (transform) | ✅ | execution_transform |
| Workflow pilot | `lib/pilot/WorkflowPilot.ts` | ✅ | execution |

### Category 4: Effort Estimation
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Effort estimator | `lib/effort-estimator/EffortEstimator.ts` | ✅ | effort_estimation |

### Category 5: Calibration (Post-Creation)
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Semantic validator | `lib/pilot/shadow/ConstrainedSemanticValidator.ts` | ✅ | calibration |
| Shadow agent | `lib/pilot/shadow/ShadowAgent.ts` | ✅ | calibration |
| Repair engine | `lib/pilot/shadow/RepairEngine.ts` | ✅ | calibration |

### Category 6: Insights & AI Advisor ⚠️ UNTRACKED
| Call Site | File | Tracked? | Issue |
|-----------|------|----------|-------|
| Business insight generator | `lib/pilot/insight/BusinessInsightGenerator.ts` | ❌ **NO** | Direct Anthropic SDK call |
| Automation advisor | `lib/pilot/insight/AutomationAdvisor.ts` | ❌ **NO** | Direct Anthropic SDK call |
| Correlation engine | `lib/pilot/insight/CorrelationEngine.ts` | ❌ **NO** | Direct Anthropic SDK call |
| Predictive analytics | `lib/pilot/insight/PredictiveAnalytics.ts` | ❌ **NO** | Direct Anthropic SDK call |
| Insight prioritizer | `lib/pilot/insight/InsightPrioritizer.ts` | ❌ **NO** | Direct Anthropic SDK call |

### Category 7: Orchestration
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Orchestration service | `lib/orchestration/OrchestrationService.ts` | ✅ | orchestration |
| Model router | `lib/orchestration/ModelRouter.ts` | ✅ | orchestration |

### Category 8: Chat & Completion APIs
| Call Site | File | Tracked? | Feature Tag |
|-----------|------|----------|-------------|
| Chat completions | `app/api/v2/chat/completions/route.ts` | ✅ | chat |
| Streaming completions | `app/api/v2/chat/stream/route.ts` | ✅ | chat_stream |

---

## 🔴 CRITICAL GAPS IDENTIFIED

### Gap 1: Insight System Bypasses ProviderFactory
**Impact:** 5 LLM call sites completely untracked
**Files:**
- `lib/pilot/insight/BusinessInsightGenerator.ts`
- `lib/pilot/insight/AutomationAdvisor.ts`
- `lib/pilot/insight/CorrelationEngine.ts`
- `lib/pilot/insight/PredictiveAnalytics.ts`
- `lib/pilot/insight/InsightPrioritizer.ts`

**Problem:** These files import and use the Anthropic SDK directly:
```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
const response = await client.messages.create({ ... });
```

**Why this matters:**
- No cost tracking → invisible spend
- No token counting → can't bill users accurately
- No feature attribution → can't optimize

### Gap 2: No Feature-Level Cost Aggregation
**Current:** Token usage tracked per-call but no easy way to aggregate by feature
**Missing:** Dashboard showing "Agent Creation: $X, Execution: $Y, Insights: $Z"

### Gap 3: Intensity Multiplier Not Auditable
**Current:** `CreditService.chargeForExecution()` applies intensity multiplier
**Issue:** Multiplier calculation not persisted → hard to audit billing

### Gap 4: Pricing Updates Require Code Deploy
**Current:** `ai_model_pricing` table exists but fallback hardcoded rates are stale
**Issue:** When provider prices change, hardcoded fallbacks may be used if DB lookup fails

---

## Implementation Plan

### Phase 1: Fix Untracked Insight LLM Calls (P0)

#### Step 1.1: Refactor BusinessInsightGenerator to use ProviderFactory
**File:** `lib/pilot/insight/BusinessInsightGenerator.ts`

```typescript
// Before:
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
const response = await client.messages.create({ model: 'claude-sonnet-4-20250514', ... });

// After:
import { getProviderFactory } from '@/lib/ai/providerFactory';
const factory = getProviderFactory();
const provider = factory.getProvider('anthropic');
const response = await provider.complete({
  model: 'claude-sonnet-4-20250514',
  messages: [...],
  metadata: { feature: 'business_insights', component: 'BusinessInsightGenerator' }
});
```

#### Step 1.2: Refactor AutomationAdvisor
**File:** `lib/pilot/insight/AutomationAdvisor.ts`
Same pattern as Step 1.1

#### Step 1.3: Refactor CorrelationEngine
**File:** `lib/pilot/insight/CorrelationEngine.ts`
Same pattern as Step 1.1

#### Step 1.4: Refactor PredictiveAnalytics
**File:** `lib/pilot/insight/PredictiveAnalytics.ts`
Same pattern as Step 1.1

#### Step 1.5: Refactor InsightPrioritizer
**File:** `lib/pilot/insight/InsightPrioritizer.ts`
Same pattern as Step 1.1

---

### Phase 2: Enhance Feature Attribution (P1)

#### Step 2.1: Standardize Feature Tags
**File:** `lib/ai/types.ts` (NEW or extend existing)

```typescript
export type LLMFeatureTag =
  | 'agent_creation'
  | 'v6_pipeline'
  | 'v6_intent'
  | 'v6_capability'
  | 'v6_ir'
  | 'v6_validation'
  | 'execution'
  | 'execution_llm_decision'
  | 'execution_transform'
  | 'calibration'
  | 'effort_estimation'
  | 'business_insights'
  | 'ai_advisor'
  | 'correlation_analysis'
  | 'predictive_analytics'
  | 'chat'
  | 'orchestration';
```

#### Step 2.2: Update AIAnalyticsService Interface
**File:** `lib/analytics/aiAnalytics.ts`

Ensure `feature` field is required (not optional):
```typescript
interface AIAnalyticsPayload {
  feature: LLMFeatureTag; // Make required
  // ... other fields
}
```

#### Step 2.3: Create Feature Cost Aggregation Query
**File:** `lib/repositories/AIAnalyticsRepository.ts` (NEW or extend)

```typescript
async getFeatureCostBreakdown(userId: string, dateRange: DateRange): Promise<FeatureCostBreakdown[]> {
  const { data } = await this.supabase
    .from('ai_calls')
    .select('feature, sum(cost_usd) as total_cost, sum(input_tokens + output_tokens) as total_tokens')
    .eq('user_id', userId)
    .gte('created_at', dateRange.start)
    .lte('created_at', dateRange.end)
    .group('feature');
  return data;
}
```

---

### Phase 3: Audit Trail for Billing (P1)

#### Step 3.1: Persist Intensity Multiplier
**File:** `lib/services/CreditService.ts`

Add `intensity_multiplier` to the credit deduction record:
```typescript
await this.supabase.from('credit_transactions').insert({
  user_id: userId,
  agent_id: agentId,
  tokens_used: tokens,
  intensity_score: intensityScore,
  intensity_multiplier: 1.0 + (intensityScore / 10), // Persist for audit
  credits_charged: finalCredits,
  // ...
});
```

#### Step 3.2: Add Billing Audit API
**File:** `app/api/v2/billing/audit/route.ts` (NEW)

Endpoint to query credit transactions with full breakdown:
- Tokens used
- Intensity multiplier applied
- Credits charged
- LLM feature attribution

---

### Phase 4: Pricing Resilience (P2)

#### Step 4.1: Update Fallback Prices
**File:** `lib/ai/pricing.ts`

Update hardcoded fallback prices to match current provider rates (as of June 2026):
```typescript
const FALLBACK_PRICES: Record<string, ModelPricing> = {
  'openai:gpt-4o': { input: 2.50, output: 10.00 }, // per 1M tokens
  'openai:gpt-4o-mini': { input: 0.15, output: 0.60 },
  'anthropic:claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'anthropic:claude-3-5-haiku': { input: 1.00, output: 5.00 },
  // ... etc
};
```

#### Step 4.2: Add Pricing Health Check
**File:** `app/api/v2/admin/pricing-health/route.ts` (NEW)

Endpoint to compare DB prices vs fallback vs actual provider pricing:
- Flag stale prices
- Alert if fallback is being used frequently

---

### Phase 5: Cost Visibility Dashboard (P2)

#### Step 5.1: Create Cost Analytics API
**File:** `app/api/v2/analytics/llm-costs/route.ts` (NEW)

```typescript
// Response shape:
{
  total_cost_usd: number;
  total_tokens: number;
  by_feature: {
    [feature: string]: { cost_usd: number; tokens: number; call_count: number }
  };
  by_provider: {
    [provider: string]: { cost_usd: number; tokens: number }
  };
  by_model: {
    [model: string]: { cost_usd: number; tokens: number }
  };
  time_series: Array<{ date: string; cost_usd: number }>;
}
```

#### Step 5.2: Create Admin Cost Dashboard Component
**File:** `components/v2/admin/LLMCostsDashboard.tsx` (NEW)

Visualize:
- Total spend over time
- Breakdown by feature (pie chart)
- Breakdown by provider
- Top-spending agents
- Cost per execution trend

---

## Database Schema Additions

### New: credit_transactions audit columns
```sql
ALTER TABLE credit_transactions
ADD COLUMN IF NOT EXISTS intensity_multiplier NUMERIC,
ADD COLUMN IF NOT EXISTS feature TEXT;
```

### New: ai_calls feature index
```sql
CREATE INDEX IF NOT EXISTS idx_ai_calls_feature ON ai_calls(feature);
CREATE INDEX IF NOT EXISTS idx_ai_calls_user_feature ON ai_calls(user_id, feature);
```

---

## Files to Modify

| Priority | File | Action |
|----------|------|--------|
| 🔴 P0 | `lib/pilot/insight/BusinessInsightGenerator.ts` | Refactor to use ProviderFactory |
| 🔴 P0 | `lib/pilot/insight/AutomationAdvisor.ts` | Refactor to use ProviderFactory |
| 🔴 P0 | `lib/pilot/insight/CorrelationEngine.ts` | Refactor to use ProviderFactory |
| 🔴 P0 | `lib/pilot/insight/PredictiveAnalytics.ts` | Refactor to use ProviderFactory |
| 🔴 P0 | `lib/pilot/insight/InsightPrioritizer.ts` | Refactor to use ProviderFactory |
| 🟡 P1 | `lib/ai/types.ts` | Add LLMFeatureTag type |
| 🟡 P1 | `lib/analytics/aiAnalytics.ts` | Require feature field |
| 🟡 P1 | `lib/services/CreditService.ts` | Persist intensity_multiplier |
| 🟡 P1 | `app/api/v2/billing/audit/route.ts` | **CREATE** - Billing audit API |
| 🟢 P2 | `lib/ai/pricing.ts` | Update fallback prices |
| 🟢 P2 | `app/api/v2/analytics/llm-costs/route.ts` | **CREATE** - Cost analytics API |
| 🟢 P2 | `components/v2/admin/LLMCostsDashboard.tsx` | **CREATE** - Admin dashboard |

---

## Success Criteria

1. ✅ All 28 LLM call sites tracked (including 5 currently untracked insight calls)
2. ✅ Every LLM call has a `feature` tag for attribution
3. ✅ Intensity multiplier persisted for billing audit
4. ✅ API endpoint to query cost breakdown by feature/provider/model
5. ✅ Admin dashboard showing total LLM spend
6. ✅ No direct provider SDK usage outside of `lib/ai/providers/`

---

## Testing Plan

### Unit Tests
1. Verify ProviderFactory.getProvider() returns tracked provider
2. Verify AIAnalyticsService.track() persists feature field
3. Verify CreditService persists intensity_multiplier

### Integration Tests
1. Call BusinessInsightGenerator → verify ai_calls record created with feature='business_insights'
2. Call AutomationAdvisor → verify ai_calls record created
3. Query llm-costs API → verify aggregation is correct

### Manual Testing
1. Run agent execution with LLM steps
2. Generate AI advisor report
3. Check ai_calls table → all calls should be present
4. Query /api/v2/analytics/llm-costs → totals should match

---

## Appendix: Current Pricing (Reference)

### Pilot Credits
- 1 Pilot Credit = 10 tokens
- 1 Pilot Credit = $0.00048
- Intensity multiplier: 1.0 - 2.0x based on workflow complexity

### Model Pricing (per 1M tokens, as of June 2026)
| Provider | Model | Input | Output |
|----------|-------|-------|--------|
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| Anthropic | claude-sonnet-4-20250514 | $3.00 | $15.00 |
| Anthropic | claude-3-5-haiku | $1.00 | $5.00 |
| Groq | llama-3.3-70b | $0.59 | $0.79 |
| Mistral | mistral-large | $2.00 | $6.00 |
| Kimi | moonshot-v1-128k | $0.84 | $0.84 |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-26 | Initial creation | Created workplan from codebase scan identifying 28 LLM call sites, 5 untracked |
